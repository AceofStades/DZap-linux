package main

import (
	"dzap-backend/api"
	"dzap-backend/realtime"
	"log"
	"net/http"
	"os"
	"strings"
)

func main() {
	if os.Geteuid() != 0 {
		log.Fatalf("\n[FATAL] Root privileges are required. Please run with sudo.\n")
	}

	hub := realtime.NewHub()
	go hub.Run()
	api.RegisterHub(hub)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/drives", api.GetDrivesHandler)
	mux.HandleFunc("/api/wipe", api.WipeDriveHandler)
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		realtime.ServeWs(hub, w, r)
	})
	mux.HandleFunc("/api/drive/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/health") {
			api.GetDriveHealthHandler(w, r)
		} else {
			http.NotFound(w, r)
		}
	})

	log.Println("DZap backend server starting on http://localhost:8080")
	if err := http.ListenAndServe("localhost:8080", mux); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
