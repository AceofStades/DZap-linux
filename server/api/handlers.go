package api

import (
	"dzap-backend/core"
	"dzap-backend/realtime"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

var hub *realtime.Hub

func RegisterHub(h *realtime.Hub) {
	hub = h
}

// respondWithError is a helper to ensure all error responses are in a consistent JSON format.
func respondWithError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func GetDrivesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")

	drives, err := core.DetectDevices()
	if err != nil {
		log.Printf("ERROR in GetDrivesHandler: %v", err) // ADDED LOGGING
		respondWithError(w, http.StatusInternalServerError, "Failed to detect drives: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(drives)
}

func GetDriveHealthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	driveName := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/drive/"), "/health")
	devicePath := "/dev/" + driveName

	result, err := core.PredictDriveHealth(devicePath)
	if err != nil {
		log.Printf("ERROR in GetDriveHealthHandler: %v", err) // ADDED LOGGING
		respondWithError(w, http.StatusInternalServerError, "Failed to predict health: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func WipeDriveHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Invalid request method")
		return
	}

	var config core.WipeConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		log.Printf("ERROR in WipeDriveHandler (decoding body): %v", err) // ADDED LOGGING
		respondWithError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	go func() {
		progressChan := make(chan string)
		go func() {
			for msg := range progressChan {
				hub.Broadcast <- []byte(msg)
			}
		}()

		err := core.SanitizeDevice(config, progressChan)
		if err != nil {
			log.Printf("ERROR in WipeDriveHandler (sanitization): %v", err) // ADDED LOGGING
			hub.Broadcast <- []byte("ERROR: " + err.Error())
		} else {
			doneMsg, _ := json.Marshal(map[string]string{
				"status":   "done",
				"deviceId": config.DevicePath,
			})
			hub.Broadcast <- doneMsg
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"status": "Wipe process started"})
}

func GetWipeMethodsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	// The identifier is the last part of the path before /wipe-methods
	parts := strings.Split(r.URL.Path, "/")
	identifier := parts[len(parts)-2]

	// Assume it could be a storage device first
	devicePath := "/dev/" + identifier
	methods, err := core.GetWipeMethods(devicePath)
	if err != nil {
		// If that fails, assume it might be a mobile device serial
		methods, err = core.GetWipeMethods(identifier)
		if err != nil {
			log.Printf("ERROR in GetWipeMethodsHandler for identifier '%s': %v", identifier, err)
			respondWithError(w, http.StatusNotFound, "Device not found or methods unavailable: "+err.Error())
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(methods)
}

type CertRequest struct {
	Model  string `json:"model"`
	Serial string `json:"serial"`
	Method string `json:"method"`
}

func GenerateCertificateHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Invalid request method")
		return
	}

	var req CertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	// For now, logHash can be a dummy value.
	logHash := "dummy-hash-for-now"

	cert, err := core.GenerateCertificate(req.Model, req.Serial, req.Method, logHash)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to generate certificate: "+err.Error())
		return
	}

	configDir, err := os.UserConfigDir()
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Could not get user config directory: "+err.Error())
		return
	}
	certsDir := filepath.Join(configDir, "DZap", "certificates")
	if err := os.MkdirAll(certsDir, 0700); err != nil {
		respondWithError(w, http.StatusInternalServerError, "Could not create certificates directory: "+err.Error())
		return
	}

	certFile := filepath.Join(certsDir, fmt.Sprintf("%s-%d.json", cert.Data.DeviceSerial, cert.Data.Timestamp.Unix()))

	certJSON, err := json.MarshalIndent(cert, "", "  ")
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to marshal certificate: "+err.Error())
		return
	}
	if err := os.WriteFile(certFile, certJSON, 0644); err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to save certificate: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(cert)
}

func ListCertificatesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	configDir, err := os.UserConfigDir()
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Could not get user config directory: "+err.Error())
		return
	}
	certsDir := filepath.Join(configDir, "DZap", "certificates")

	files, err := os.ReadDir(certsDir)
	if err != nil {
		// If dir doesn't exist, return empty list, not an error
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]core.SignedCertificate{})
		return
	}

	var certs []core.SignedCertificate
	for _, file := range files {
		if !file.IsDir() && strings.HasSuffix(file.Name(), ".json") {
			data, err := os.ReadFile(filepath.Join(certsDir, file.Name()))
			if err != nil {
				continue // Skip files that can't be read
			}
			var cert core.SignedCertificate
			if err := json.Unmarshal(data, &cert); err == nil {
				certs = append(certs, cert)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(certs)
}

type certRequest struct {
	Model   string `json:"model"`
	Serial  string `json:"serial"`
	Method  string `json:"method"`
	LogHash string `json:"logHash"`
}

func UnmountDriveHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Invalid request method")
		return
	}

	var req struct {
		DevicePath string `json:"devicePath"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Error decoding unmount request JSON: %v", err)
		respondWithError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if err := core.UnmountDevice(req.DevicePath); err != nil {
		log.Printf("Error unmounting device %s: %v\n", req.DevicePath, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to unmount device: "+err.Error())
		return
	}

	log.Printf("Successfully processed unmount for device %s\n", req.DevicePath)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "Device unmounted successfully"})
}

func CertificateHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Invalid request method")
		return
	}

	var req certRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	// In a real app, the logHash would be more meaningful
	signedCert, err := core.GenerateCertificate(req.Model, req.Serial, req.Method, "placeholder_hash")
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to generate certificate: "+err.Error())
		return
	}

	// Check if user requested PDF format
	if r.URL.Query().Get("format") == "pdf" {
		pdfBytes, err := signedCert.GeneratePDF()
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to generate PDF: "+err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", "attachment; filename=certificate.pdf")
		w.Write(pdfBytes)
	} else {
		// Default to JSON
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(signedCert)
	}
}
