package core

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"

	ort "github.com/yalue/onnxruntime_go"
)

// smartData represents the JSON structure from smartctl
type smartData struct {
	SmartStatus struct {
		Passed bool `json:"passed"`
	} `json:"smart_status"`
	AtaSmartAttributes struct {
		Table []struct {
			ID  int `json:"id"`
			Raw struct {
				Value int `json:"value"`
			} `json:"raw"`
		} `json:"table"`
	} `json:"ata_smart_attributes"`
}

// PredictionResult is what we'll send to the frontend
type PredictionResult struct {
	PredictedStatus    string  `json:"predictedStatus"`
	FailureProbability float32 `json:"failureProbability"`
	SmartStatus        string  `json:"smartStatus"`
}

func PredictDriveHealth(devicePath string) (*PredictionResult, error) {
	// 1. Get S.M.A.R.T. data as JSON
	cmd := exec.Command("smartctl", "-a", "-j", devicePath)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get S.M.A.R.T. data: %w", err)
	}

	var data smartData
	if err := json.Unmarshal(out, &data); err != nil {
		return nil, fmt.Errorf("failed to parse S.M.A.R.T. data: %w", err)
	}

	// 2. Load the feature map
	featureMapFile, err := os.ReadFile("../model/feature_map.json")
	if err != nil {
		return nil, fmt.Errorf("could not load feature_map.json: %w", err)
	}
	var featureMap []string
	json.Unmarshal(featureMapFile, &featureMap)

	// 3. Preprocess data into a tensor for the model
	inputTensor := make([]float32, len(featureMap))
	smartValues := make(map[string]int)
	for _, attr := range data.AtaSmartAttributes.Table {
		keyRaw := fmt.Sprintf("smart_%d_raw", attr.ID)
		smartValues[keyRaw] = attr.Raw.Value
	}

	for i, feature := range featureMap {
		if val, ok := smartValues[feature]; ok {
			inputTensor[i] = float32(val)
		} else {
			inputTensor[i] = 0 // Handle missing values by inputting zero.
		}
	}

	// 4. Run the ONNX model
	ort.SetSharedLibraryPath("/usr/lib/onnxruntime.so") // Adjust path if your install location is different.

	inputShape := ort.NewShape(1, int64(len(featureMap)))
	input, err := ort.NewTensor(inputShape, inputTensor)
	if err != nil {
		return nil, err
	}
	defer input.Destroy()

	outputShape := ort.NewShape(1, 2)
	output, err := ort.NewEmptyTensor[float32](outputShape)
	if err != nil {
		return nil, err
	}
	defer output.Destroy()

	model, err := ort.NewSession[float32]("../model/drive_failure_model.onnx",
		[]string{"float_input"}, []string{"output_probability"},
		[]*ort.Tensor[float32]{input}, []*ort.Tensor[float32]{output})
	if err != nil {
		return nil, fmt.Errorf("failed to create ONNX session: %w", err)
	}
	defer model.Destroy()

	err = model.Run()
	if err != nil {
		return nil, fmt.Errorf("failed to run model prediction: %w", err)
	}

	probabilities := output.GetData()
	failureProbability := probabilities[1] // The model outputs probabilities for [class_0, class_1], where class_1 is failure.

	result := &PredictionResult{
		FailureProbability: failureProbability,
	}

	if failureProbability > 0.5 {
		result.PredictedStatus = "At Risk"
	} else {
		result.PredictedStatus = "Healthy"
	}

	if data.SmartStatus.Passed {
		result.SmartStatus = "Passed"
	} else {
		result.SmartStatus = "Failing"
	}

	return result, nil
}
