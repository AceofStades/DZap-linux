// Port of server-go/main.go
use server::build_router;
use server::core::certificate;
use server::realtime::Hub;

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
    certificate::init();

    let hub = Hub::new();
    let app = build_router(hub);

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
