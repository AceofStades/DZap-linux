// Port of server-go/api/handlers.go
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::core::{certificate, drives, predict, wiper};
use crate::realtime::Hub;

/// Helper to ensure all error responses are in a consistent JSON format.
fn error_response(code: StatusCode, message: &str) -> Response {
    (
        code,
        Json(json!({ "error": message })),
    )
        .into_response()
}

pub async fn get_drives_handler() -> Response {
    match tokio::task::spawn_blocking(drives::detect_devices).await {
        Ok(devices) => Json(devices).into_response(),
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Failed to detect drives: {e}"),
        ),
    }
}

pub async fn get_drive_health_handler(Path(drive_name): Path<String>) -> Response {
    let device_path = format!("/dev/{drive_name}");

    match tokio::task::spawn_blocking(move || predict::predict_drive_health(&device_path)).await {
        Ok(Ok(result)) => Json(result).into_response(),
        Ok(Err(e)) => {
            drives::log_line(&format!("ERROR in get_drive_health_handler: {e}"));
            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to predict health: {e}"),
            )
        }
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Failed to predict health: {e}"),
        ),
    }
}

pub async fn wipe_drive_handler(
    State(hub): State<Hub>,
    body: Result<Json<wiper::WipeConfig>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(config) = match body {
        Ok(c) => c,
        Err(e) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                &format!("Invalid request body: {e}"),
            )
        }
    };

    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Forward progress messages to all websocket clients.
    let hub_fwd = hub.clone();
    tokio::spawn(async move {
        while let Some(msg) = progress_rx.recv().await {
            hub_fwd.broadcast(msg);
        }
    });

    let device_path = config.device_path.clone();
    tokio::task::spawn_blocking(move || {
        let result = wiper::sanitize_device(config, &progress_tx);
        match result {
            Err(e) => {
                drives::log_line(&format!("ERROR in wipe_drive_handler (sanitization): {e}"));
                hub.broadcast(format!("ERROR: {e}"));
            }
            Ok(()) => {
                hub.broadcast(
                    json!({
                        "status": "done",
                        "deviceId": device_path,
                    })
                    .to_string(),
                );
            }
        }
        drop(progress_tx);
    });

    (
        StatusCode::ACCEPTED,
        Json(json!({ "status": "Wipe process started" })),
    )
        .into_response()
}

pub async fn get_wipe_methods_handler(Path(identifier): Path<String>) -> Response {
    // Assume it could be a storage device first
    let device_path = format!("/dev/{identifier}");
    let methods = tokio::task::spawn_blocking(move || {
        wiper::get_wipe_methods(&device_path)
            // If that fails, assume it might be a mobile device serial
            .or_else(|_| wiper::get_wipe_methods(&identifier))
    })
    .await;

    match methods {
        Ok(Ok(methods)) => Json(methods).into_response(),
        Ok(Err(e)) => {
            drives::log_line(&format!("ERROR in get_wipe_methods_handler: {e}"));
            error_response(
                StatusCode::NOT_FOUND,
                &format!("Device not found or methods unavailable: {e}"),
            )
        }
        Err(e) => error_response(
            StatusCode::NOT_FOUND,
            &format!("Device not found or methods unavailable: {e}"),
        ),
    }
}

pub async fn generate_certificate_handler(
    body: Result<Json<serde_json::Value>, axum::extract::rejection::JsonRejection>,
) -> Response {
    // This is a placeholder.
    let Json(data) = match body {
        Ok(d) => d,
        Err(e) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                &format!("Invalid request body: {e}"),
            )
        }
    };

    // For now, just log the data.
    println!("Received data for certificate generation: {data:?}");

    Json(json!({ "message": "Certificate generation request received" })).into_response()
}

#[derive(Debug, Deserialize)]
pub struct DeviceIdRequest {
    #[serde(rename = "deviceId", alias = "DeviceId", alias = "deviceID")]
    device_id: String,
}

pub async fn pause_wipe_handler(
    body: Result<Json<DeviceIdRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(req) = match body {
        Ok(r) => r,
        Err(e) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                &format!("Invalid request body: {e}"),
            )
        }
    };

    match wiper::pause_wipe(&req.device_id) {
        Ok(()) => Json(json!({ "message": "Wipe pause request received" })).into_response(),
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Failed to pause wipe: {e}"),
        ),
    }
}

pub async fn abort_wipe_handler(
    body: Result<Json<DeviceIdRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(req) = match body {
        Ok(r) => r,
        Err(e) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                &format!("Invalid request body: {e}"),
            )
        }
    };

    match wiper::abort_wipe(&req.device_id) {
        Ok(()) => Json(json!({ "message": "Wipe abort request received" })).into_response(),
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Failed to abort wipe: {e}"),
        ),
    }
}

pub async fn list_certificates_handler() -> Response {
    let Some(config_dir) = dirs::config_dir() else {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not get user config directory",
        );
    };
    let certs_dir = config_dir.join("DZap").join("certificates");

    let mut certs: Vec<certificate::SignedCertificate> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&certs_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() || path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(data) = std::fs::read_to_string(&path) else {
                continue; // Skip files that can't be read
            };
            if let Ok(cert) = serde_json::from_str::<certificate::SignedCertificate>(&data) {
                certs.push(cert);
            }
        }
    }

    Json(certs).into_response()
}

#[derive(Debug, Deserialize)]
pub struct UnmountRequest {
    #[serde(alias = "Device")]
    device: String,
}

pub async fn unmount_drive_handler(
    body: Result<Json<UnmountRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(req) = match body {
        Ok(r) => r,
        Err(e) => {
            drives::log_line(&format!("Error decoding unmount request JSON: {e}"));
            return error_response(
                StatusCode::BAD_REQUEST,
                &format!("Invalid request body: {e}"),
            );
        }
    };

    let device = req.device.clone();
    match tokio::task::spawn_blocking(move || drives::unmount_device(&device)).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            drives::log_line(&format!("Error unmounting device {}: {e}", req.device));
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to unmount device: {e}"),
            );
        }
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to unmount device: {e}"),
            );
        }
    }

    drives::log_line(&format!(
        "Successfully processed unmount for device {}",
        req.device
    ));
    Json(json!({ "status": "Device unmounted successfully" })).into_response()
}

#[derive(Debug, Deserialize)]
pub struct CertRequest {
    pub model: String,
    pub serial: String,
    pub method: String,
    #[serde(rename = "logHash", alias = "LogHash", default)]
    #[allow(dead_code)]
    pub log_hash: String,
}

/// Port of the Go `CertificateHandler`. Supports `?format=pdf`.
pub async fn certificate_handler(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    body: Result<Json<CertRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(req) = match body {
        Ok(r) => r,
        Err(e) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                &format!("Invalid request body: {e}"),
            )
        }
    };

    // In a real app, the logHash would be more meaningful
    let signed_cert = match certificate::generate_certificate(
        &req.model,
        &req.serial,
        &req.method,
        "placeholder_hash",
    ) {
        Ok(c) => c,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to generate certificate: {e}"),
            )
        }
    };

    // Check if user requested PDF format
    if params.get("format").is_some_and(|f| f == "pdf") {
        match signed_cert.generate_pdf() {
            Ok(pdf_bytes) => (
                StatusCode::OK,
                [
                    ("Content-Type", "application/pdf"),
                    (
                        "Content-Disposition",
                        "attachment; filename=certificate.pdf",
                    ),
                ],
                pdf_bytes,
            )
                .into_response(),
            Err(e) => error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to generate PDF: {e}"),
            ),
        }
    } else {
        // Default to JSON
        Json(signed_cert).into_response()
    }
}

pub async fn ws_handler(ws: WebSocketUpgrade, State(hub): State<Hub>) -> impl IntoResponse {
    ws.on_upgrade(move |mut socket| async move {
        let mut rx = hub.sender.subscribe();
        loop {
            match rx.recv().await {
                Ok(msg) => {
                    if socket
                        .send(axum::extract::ws::Message::Text(msg.into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    })
}
