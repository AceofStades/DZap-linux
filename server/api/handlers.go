package api

import (
	"dzap-backend/core"
	"dzap-backend/realtime"
	"encoding/json"
	"net/http"
)

var hub *realtime.Hub

func RegisterHub(h *realtime.Hub) {
	hub = h
}

func GetDrivesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	drives, err := core.DetectDrives()
	if err != nil {
		http.Error(w, "Failed to detect drives: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(drives)
}

func WipeDriveHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method != http.MethodPost {
		http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
		return
	}

	var config core.WipeConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	go func() {
		progressChan := make(chan string)
		go func() {
			for msg := range progressChan {
				hub.Broadcast <- []byte(msg)
			}
		}()

		err := core.SanitizeDrive(config, progressChan)
		if err != nil {
			hub.Broadcast <- []byte("ERROR: " + err.Error())
		} else {
			hub.Broadcast <- []byte("SUCCESS: Drive sanitization finished.")
		}
	}()

	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"status": "Wipe process started"})
}
