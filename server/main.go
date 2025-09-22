package main

import (
	"dzap-backend/api"
	"dzap-backend/realtime"
	"log"
	"net/http"
	"os"
)

func main() {
	if os.Geteuid() != 0 {
		log.Fatalf("\n[FATAL] Root privileges are required. Please run with sudo.\n")
	}

	hub := realtime.NewHub()
	go hub.Run()

	api.RegisterHub(hub)

	http.HandleFunc("/api/drives", api.GetDrivesHandler)
	http.HandleFunc("/api/wipe", api.WipeDriveHandler)
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		realtime.ServeWs(hub, w, r)
	})

	log.Println("DZap backend server starting on http://localhost:8080")
	if err := http.ListenAndServe("localhost:8080", nil); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
