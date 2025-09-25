package core

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strconv"
	"strings"

	ort "github.com/yalue/onnxruntime_go"
)

// smartData is a more flexible struct that can handle both NVMe and SATA data.
type smartData struct {
	Device struct {
		Type     string `json:"type"`
		Protocol string `json:"protocol"`
	} `json:"device"`
	SmartStatus struct {
		Passed bool `json:"passed"`
	} `json:"smart_status"`
	AtaSmartAttributes struct {
		Table []struct {
			ID    int    `json:"id"`
			Name  string `json:"name"`
			Value int    `json:"value"`
			Raw   struct {
				Value int `json:"value"`
			} `json:"raw"`
		} `json:"table"`
	} `json:"ata_smart_attributes"`
	NvmeSmartHealthInformationLog struct {
		Temperature      int `json:"temperature"`
		PercentageUsed   int `json:"percentage_used"`
		DataUnitsWritten int `json:"data_units_written"`
		PowerOnHours     int `json:"power_on_hours"`
	} `json:"nvme_smart_health_information_log"`
}

// SmartAttribute holds the raw and normalized values for a S.M.A.R.T. attribute
type SmartAttribute struct {
	Name  string `json:"name"`
	Value int    `json:"value"`
}

// PredictionResult is what we'll send to the frontend
type PredictionResult struct {
	PredictedStatus    string                    `json:"predictedStatus"`
	FailureProbability float32                   `json:"failureProbability"`
	SmartStatus        string                    `json:"smartStatus"`
	SmartAttributes    map[string]SmartAttribute `json:"smartAttributes"`
}

func PredictDriveHealth(devicePath string) (*PredictionResult, error) {
	cmd := exec.Command("smartctl", "-a", "-j", devicePath)
	out, err := cmd.Output()
	if err != nil {
		// If smartctl fails, it could be a USB drive or a device that doesn't support S.M.A.R.T.
		return &PredictionResult{
			PredictedStatus: "N/A",
			SmartStatus:     "Not available",
			SmartAttributes: make(map[string]SmartAttribute),
		}, nil
	}

	var data smartData
	if err := json.Unmarshal(out, &data); err != nil {
		return nil, fmt.Errorf("failed to parse S.M.A.R.T. data: %w", err)
	}

	result := &PredictionResult{
		PredictedStatus:    "Healthy", // Default to Healthy
		FailureProbability: 0,
		SmartAttributes:    make(map[string]SmartAttribute),
	}

	if data.SmartStatus.Passed {
		result.SmartStatus = "Passed"
	} else {
		result.SmartStatus = "Failing"
		result.PredictedStatus = "At Risk"
	}

	// Handle different drive types
	if data.Device.Type == "nvme" {
		result.SmartAttributes["Temperature"] = SmartAttribute{Name: "Temperature", Value: data.NvmeSmartHealthInformationLog.Temperature}
		result.SmartAttributes["Percentage Used"] = SmartAttribute{Name: "Percentage Used", Value: data.NvmeSmartHealthInformationLog.PercentageUsed}
		result.SmartAttributes["Data Units Written"] = SmartAttribute{Name: "Data Units Written", Value: data.NvmeSmartHealthInformationLog.DataUnitsWritten}
		result.SmartAttributes["Power On Hours"] = SmartAttribute{Name: "Power On Hours", Value: data.NvmeSmartHealthInformationLog.PowerOnHours}
	} else if data.Device.Type == "sat" { // SATA drive
		// For SATA drives, we can use the ONNX model
		for _, attr := range data.AtaSmartAttributes.Table {
			switch attr.ID {
			case 5, 9, 177, 194, 241:
				result.SmartAttributes[attr.Name] = SmartAttribute{Name: attr.Name, Value: attr.Raw.Value}
			}
		}
		runSataPrediction(result, &data)
	} else {
		result.SmartStatus = "Not supported"
	}

	return result, nil
}

// runSataPrediction runs the ONNX model for SATA drives.
func runSataPrediction(result *PredictionResult, data *smartData) {
	// This block will attempt to run the prediction, but will not return an error if it fails.
	// It will log the error and the function will return the result with just the S.M.A.R.T. data.
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Recovered from panic in runSataPrediction: %v", r)
		}
	}()

	featureMapFile, err := os.ReadFile("../model/feature_map.json")
	if err != nil {
		log.Printf("Warning: could not load feature_map.json: %v", err)
		return
	}
	var featureMap map[string]string
	if err := json.Unmarshal(featureMapFile, &featureMap); err != nil {
		log.Printf("Warning: could not parse feature_map.json: %v", err)
		return
	}

	featureNames := make([]string, len(featureMap))
	for key, value := range featureMap {
		index, err := strconv.Atoi(strings.TrimPrefix(value, "f"))
		if err != nil {
			log.Printf("Warning: could not parse feature index from %s", value)
			continue
		}
		if index < len(featureNames) {
			featureNames[index] = key
		}
	}

	inputTensor := make([]float32, len(featureNames))
	smartValues := make(map[string]int)
	for _, attr := range data.AtaSmartAttributes.Table {
		keyRaw := fmt.Sprintf("smart_%d_raw", attr.ID)
		keyNorm := fmt.Sprintf("smart_%d_normalized", attr.ID)
		smartValues[keyRaw] = attr.Raw.Value
		smartValues[keyNorm] = attr.Value
	}

	for i, feature := range featureNames {
		if val, ok := smartValues[feature]; ok {
			inputTensor[i] = float32(val)
		} else {
			inputTensor[i] = 0 // Handle missing values
		}
	}

	inputShape := ort.NewShape(1, int64(len(featureNames)))
	input, err := ort.NewTensor(inputShape, inputTensor)
	if err != nil {
		log.Printf("Warning: failed to create ONNX input tensor: %v", err)
		return
	}
	defer input.Destroy()

	outputShape := ort.NewShape(1, 2)
	output, err := ort.NewEmptyTensor[float32](outputShape)
	if err != nil {
		log.Printf("Warning: failed to create ONNX output tensor: %v", err)
		return
	}
	defer output.Destroy()

	model, err := ort.NewSession[float32]("../model/drive_failure_model.onnx",
		[]string{"float_input"}, []string{"output_probability"},
		[]*ort.Tensor[float32]{input}, []*ort.Tensor[float32]{output})
	if err != nil {
		log.Printf("Warning: failed to create ONNX session: %v", err)
		return
	}
	defer model.Destroy()

	err = model.Run()
	if err != nil {
		log.Printf("Warning: failed to run model prediction: %v", err)
		return
	}

	probabilities := output.GetData()
	failureProbability := probabilities[1]

	result.FailureProbability = failureProbability
	if failureProbability > 0.5 {
		result.PredictedStatus = "At Risk"
	} else {
		result.PredictedStatus = "Healthy"
	}
}
