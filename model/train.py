import pandas as pd
import numpy as np
import os
import sys
import json
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier
from sklearn.metrics import classification_report, accuracy_score, f1_score
import onnxmltools
from onnxmltools.convert.common.data_types import FloatTensorType
from imblearn.over_sampling import SMOTE

def get_file_paths(folder_path, start_date, end_date):
    """Generates a list of existing CSV file paths within a date range."""
    dates = pd.date_range(start=start_date, end=end_date)
    filepaths_to_process = []
    print("Searching for data files...")
    for date in dates:
        date_str = date.strftime('%Y-%m-%d')
        filepath = os.path.join(folder_path, f"{date_str}.csv")
        if os.path.exists(filepath):
            filepaths_to_process.append(filepath)
    return filepaths_to_process

def preprocess_data(df):
    """Preprocesses a single DataFrame chunk."""
    # This function remains largely the same, but it's crucial that it works on a single df.
    # Make a copy to avoid SettingWithCopyWarning
    df = df.copy()

    missing_percent = df.isnull().sum() / len(df)
    columns_to_drop_by_threshold = missing_percent[missing_percent > 0.5].index.tolist()
    df.drop(columns=columns_to_drop_by_threshold, inplace=True, errors='ignore')

    # Ensure 'date' and 'serial_number' columns exist before processing
    if 'date' not in df.columns or 'serial_number' not in df.columns:
        # Depending on your data, you might want to skip this file or handle the error
        print(f"Warning: 'date' or 'serial_number' not in chunk. Skipping sorting and ffill.")
        return df

    df['date'] = pd.to_datetime(df['date'])
    df.sort_values(by=['serial_number', 'date'], inplace=True)

    smart_cols = [col for col in df.columns if 'smart_' in col and '_raw' in col]
    if smart_cols:
        df[smart_cols] = df.groupby('serial_number')[smart_cols].ffill()
        df[smart_cols] = df.groupby('serial_number')[smart_cols].bfill()

    df.dropna(inplace=True)

    df = df.drop(columns=['date', 'serial_number', 'model', 'capacity_bytes'], errors='ignore')

    # Drop columns with zero variance
    zero_variance_cols = [col for col in df.columns if df[col].nunique() <= 1]
    df = df.drop(columns=zero_variance_cols, errors='ignore')

    return df

if __name__ == "__main__":
    folder_path = r'/mnt/2TB HDD/DataSets/Drive-Failure'
    start_date = '2020-01-01'
    end_date = '2025-06-06'

    # --- Checkpointing and Data Loading Logic ---
    checkpoint_path = "drive_failure_sampled_data.parquet"
    df_final = None

    if os.path.exists(checkpoint_path):
        print(f"✅ Found checkpoint file. Loading pre-processed data from '{checkpoint_path}'...")
        df_final = pd.read_parquet(checkpoint_path)
        print("Data loaded successfully from checkpoint.")
    else:
        print(f"No checkpoint file found. Starting full data processing...")
        # Define what fraction of each file to sample. Adjust based on your RAM.
        sampling_fraction = 0.05

        all_file_paths = get_file_paths(folder_path, start_date, end_date)

        if not all_file_paths:
            print("No CSV files found in the specified date range. Exiting.")
            exit()

        total_files = len(all_file_paths)
        print(f"Found {total_files} files to process.")

        list_of_failures = []
        list_of_non_failure_samples = []

        for i, filepath in enumerate(all_file_paths):
            filename = os.path.basename(filepath)

            progress = (i + 1) / total_files
            bar_length = 50
            filled_length = int(bar_length * progress)
            bar = '█' * filled_length + '-' * (bar_length - filled_length)
            sys.stdout.write(f'\rProcessing Chunk {i+1}/{total_files}: {filename} |{bar}| {progress:.2%} Complete')
            sys.stdout.flush()

            try:
                # Load one file, specifying dtype for column 5 to avoid warnings
                df_chunk = pd.read_csv(filepath, dtype={5: str})
                df_processed_chunk = preprocess_data(df_chunk)

                if not df_processed_chunk.empty and 'failure' in df_processed_chunk.columns:
                    # Separate failures from non-failures
                    df_failures = df_processed_chunk[df_processed_chunk['failure'] == 1]
                    df_non_failures = df_processed_chunk[df_processed_chunk['failure'] == 0]

                    # Keep ALL failure events
                    if not df_failures.empty:
                        list_of_failures.append(df_failures)

                    # Sample from the non-failure events
                    if not df_non_failures.empty:
                        list_of_non_failure_samples.append(
                            df_non_failures.sample(frac=sampling_fraction, random_state=42)
                        )

            except Exception as e:
                print(f"\nError processing {filepath}: {e}")

        print("\n\nChunk processing complete.")

        if not list_of_failures and not list_of_non_failure_samples:
            print("No data was successfully processed and sampled. Exiting.")
            exit()

        print("Combining all failure events and non-failure samples...")
        # Combine all failures with the samples of non-failures
        df_final = pd.concat(list_of_failures + list_of_non_failure_samples, ignore_index=True)
        print("Final DataFrame created successfully.")

        print("Performing final cleaning on the combined DataFrame...")
        initial_rows = len(df_final)
        df_final.dropna(subset=['failure'], inplace=True)
        rows_dropped = initial_rows - len(df_final)
        if rows_dropped > 0:
            print(f"Dropped {rows_dropped} rows with NaN in the 'failure' column.")

        df_final['failure'] = df_final['failure'].astype(int)
        print("Target column 'failure' cleaned and cast to integer.")

        print("Converting feature columns to numeric types for consistent storage...")
        feature_cols = [col for col in df_final.columns if col != 'failure']
        df_final[feature_cols] = df_final[feature_cols].apply(pd.to_numeric, errors='coerce')

        df_final.fillna(0, inplace=True)
        print("Feature columns cleaned and coerced to numeric types.")

        print(f"Saving processed data to checkpoint file: '{checkpoint_path}'")
        df_final.to_parquet(checkpoint_path)
        print("Checkpoint saved. Future runs will be much faster.")

    # --- Model Training (Now uses data from checkpoint or fresh processing) ---

    print("\nFinal Preprocessed DataFrame (from samples):")
    # print(df_final.head().to_markdown(index=False, numalign="left", stralign="left"))
    print(f"\nFinal DataFrame shape: {df_final.shape}")

    if 'failure' in df_final.columns:
        y = df_final['failure']
        X = df_final.drop(columns=['failure'])
    else:
        print("Error: 'failure' column not found in the preprocessed data.")
        exit()

    # --- FIX: Rename features for XGBoost ONNX compatibility ---
    print("\nRenaming features for ONNX compatibility...")
    original_feature_names = X.columns.tolist()
    # Create a mapping from original name to new generic name ('f0', 'f1', etc.)
    feature_map = {orig_name: f'f{i}' for i, orig_name in enumerate(original_feature_names)}

    # Save this map to a file so your Go application knows how to order the features
    map_filename = "feature_map.json"
    with open(map_filename, 'w') as f:
        json.dump(feature_map, f, indent=4)
    print(f"Feature map saved to '{map_filename}'. This is crucial for your Go project!")

    # Apply the new names to the DataFrame
    X.columns = [feature_map[col] for col in X.columns]
    print("Features renamed successfully.")


    if len(y.unique()) > 1:
        # First, split the data into training and testing sets
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

        # --- Using SMOTE to balance the training data ---
        print("\nApplying SMOTE to balance the training data...")
        print(f"Original training data shape: {X_train.shape}")
        print(f"Original training data distribution:\n{y_train.value_counts()}")

        smote = SMOTE(random_state=42)
        X_train_resampled, y_train_resampled = smote.fit_resample(X_train, y_train)

        print("\nSMOTE applied successfully.")
        print(f"Resampled training data shape: {X_train_resampled.shape}")
        print(f"Resampled training data distribution:\n{y_train_resampled.value_counts()}")

        print("\nBuilding and training the XGBoost model on the resampled data...")
        # XGBoost is often a stronger model for tabular data like this
        model = XGBClassifier(
            n_estimators=100,
            random_state=42,
            n_jobs=-1,
            # use_label_encoder=False and eval_metric='logloss' are now deprecated/default in newer versions
            # but are kept for compatibility.
        )
        model.fit(X_train_resampled, y_train_resampled)
        print("XGBoost model trained successfully.")

        # IMPORTANT: We predict on the original, unmodified test set
        y_pred = model.predict(X_test)

        print("\nModel Evaluation:")
        print(f"Accuracy: {accuracy_score(y_test, y_pred):.4f}")
        print(f"F1 Score (Weighted): {f1_score(y_test, y_pred, average='weighted', zero_division=0):.4f}")
        print("Classification Report:\n", classification_report(y_test, y_pred, zero_division=0))

        print("\nConverting and saving the model to ONNX format...")
        try:
            # This line now uses the FloatTensorType imported from onnxmltools
            initial_type = [('float_input', FloatTensorType([None, X_train.shape[1]]))]
            onx = onnxmltools.convert.convert_xgboost(model, initial_types=initial_type)

            model_filename = "drive_failure_model.onnx"
            with open(model_filename, "wb") as f:
                f.write(onx.SerializeToString())

            print(f"✅ Model successfully saved as {model_filename}")

        except Exception as e:
            print(f"❌ An error occurred during ONNX conversion: {e}")
    else:
        print("The target variable 'failure' contains only one class in the sample. Cannot train.")
