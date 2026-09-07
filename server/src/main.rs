// Port of server-go/main.go
mod api;
mod core;
mod realtime;

use axum::Router;
use axum::routing::{get, post};
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() {
    // Initialize the ONNX runtime. Non-fatal if unavailable: the health
    // endpoint will simply skip model-based predictions.
    if let Err(e) = init_onnx() {
        eprintln!("Warning: Failed to initialize ONNX runtime: {e}");
    }

    if unsafe { libc::geteuid() } != 0 {
        eprintln!("\n[FATAL] Root privileges are required. Please run with sudo.\n");
        std::process::exit(1);
    }

    // Load or generate the application private key (fatal on error).
    core::certificate::init();

    let hub = realtime::Hub::new();

    let app = Router::new()
        .route("/api/drives", get(api::get_drives_handler))
        .route("/api/wipe", post(api::wipe_drive_handler))
        .route("/api/wipe/pause", post(api::pause_wipe_handler))
        .route("/api/wipe/abort", post(api::abort_wipe_handler))
        .route("/api/certificates", get(api::list_certificates_handler))
        .route(
            "/api/certificate/generate",
            post(api::generate_certificate_handler),
        )
        .route("/api/unmount", post(api::unmount_drive_handler))
        .route("/api/certificate", post(api::certificate_handler))
        .route("/api/drive/{name}/health", get(api::get_drive_health_handler))
        .route(
            "/api/drive/{name}/wipe-methods",
            get(api::get_wipe_methods_handler),
        )
        .route("/ws", get(api::ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(hub);

    let listener = match tokio::net::TcpListener::bind("localhost:8080").await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to start server: {e}");
            std::process::exit(1);
        }
    };

    eprintln!("DZap backend server starting on http://localhost:8080");
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("Failed to start server: {e}");
        std::process::exit(1);
    }
}

fn init_onnx() -> Result<(), String> {
    ort::init_from("/usr/lib/onnxruntime.so")
        .map_err(|e| e.to_string())?
        .commit();
    Ok(())
}
