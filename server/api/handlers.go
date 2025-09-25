package api

import (
	"dzap-backend/core"
	"dzap-backend/realtime"
	"encoding/json"
	"log"
	"net/http"
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
			hub.Broadcast <- []byte("SUCCESS: Drive sanitization finished.")
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
