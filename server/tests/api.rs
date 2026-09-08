//! Integration tests: drive the real axum router over HTTP + WebSocket.
//!
//! SAFETY MODEL: these tests never touch a real block device.
//! - /api/wipe is only ever called with `/dev/nonexistent-*` paths, which
//!   fail at the lsblk detection stage BEFORE anything is opened for write.
//! - The real overwrite logic against a writable target is covered by unit
//!   tests (temp files in /tmp) and by the QEMU end-to-end harness.

use futures_util::StreamExt;
use serde_json::{Value, json};
use tokio::net::TcpListener;

/// Spin up the real router on an ephemeral localhost port.
async fn spawn_server() -> String {
    let hub = server::realtime::Hub::new();
    let app = server::build_router(hub);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn drives_endpoint_returns_storage_and_mobile_keys() {
    let base = spawn_server().await;
    let resp = reqwest::get(format!("{base}/api/drives")).await.unwrap();
    assert_eq!(resp.status(), 200);

    let body: Value = resp.json().await.unwrap();
    assert!(body.get("storage").is_some(), "missing 'storage': {body}");
    assert!(body.get("mobile").is_some(), "missing 'mobile': {body}");

    // If storage detection worked, drives must match the Go JSON shape.
    if let Some(drives) = body["storage"].as_array() {
        for d in drives {
            for key in [
                "name",
                "model",
                "size",
                "type",
                "isMounted",
                "isFrozen",
                "isOSDrive",
                "partitions",
            ] {
                assert!(d.get(key).is_some(), "drive missing {key}: {d}");
            }
            assert!(d["name"].as_str().unwrap().starts_with("/dev/"));
        }
    }
}

#[tokio::test]
async fn wipe_methods_for_unknown_device_is_404_json_error() {
    let base = spawn_server().await;
    let resp = reqwest::get(format!("{base}/api/drive/nonexistent0/wipe-methods"))
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert!(
        body["error"].as_str().unwrap().contains("not found"),
        "unexpected: {body}"
    );
}

#[tokio::test]
async fn health_for_unknown_device_reports_na_not_500() {
    // smartctl fails on a nonexistent device; the Go server returns 200
    // with predictedStatus "N/A" in that case.
    let base = spawn_server().await;
    let resp = reqwest::get(format!("{base}/api/drive/nonexistent0/health"))
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["predictedStatus"], json!("N/A"));
    assert_eq!(body["smartStatus"], json!("Not available"));
    assert!(body["smartAttributes"].as_object().unwrap().is_empty());
}

#[tokio::test]
async fn wipe_accepts_202_and_broadcasts_error_for_unknown_device() {
    let base = spawn_server().await;
    let ws_url = base.replacen("http", "ws", 1) + "/ws";
    let (mut ws, _) = tokio_tungstenite::connect_async(&ws_url).await.unwrap();

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{base}/api/wipe"))
        .json(&json!({
            "DevicePath": "/dev/nonexistent0",
            "Method": "overwrite_1_pass",
            "DeviceSerial": "",
            "DeviceType": "",
            "DeviceModel": "Integration Test",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 202);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], json!("Wipe process started"));

    // The failure must arrive over the websocket as "ERROR: ...".
    let msg = tokio::time::timeout(std::time::Duration::from_secs(10), ws.next())
        .await
        .expect("timed out waiting for ws broadcast")
        .unwrap()
        .unwrap();
    let text = msg.into_text().unwrap();
    assert!(
        text.starts_with("ERROR:") && text.contains("nonexistent0"),
        "unexpected ws message: {text}"
    );
}

#[tokio::test]
async fn wipe_rejects_malformed_body_with_json_error() {
    let base = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{base}/api/wipe"))
        .header("Content-Type", "application/json")
        .body("this is not json")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert!(
        body["error"]
            .as_str()
            .unwrap()
            .contains("Invalid request body")
    );
}

#[tokio::test]
async fn pause_and_abort_without_active_wipe_error_cleanly() {
    let base = spawn_server().await;
    let client = reqwest::Client::new();
    for endpoint in ["pause", "abort"] {
        let resp = client
            .post(format!("{base}/api/wipe/{endpoint}"))
            .json(&json!({"deviceId": "/dev/nonexistent0"}))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 500, "endpoint {endpoint}");
        let body: Value = resp.json().await.unwrap();
        assert!(
            body["error"]
                .as_str()
                .unwrap()
                .contains("no active wipe found"),
            "endpoint {endpoint}: {body}"
        );
    }
}

#[tokio::test]
async fn unmount_unknown_device_errors_without_side_effects() {
    let base = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{base}/api/unmount"))
        .json(&json!({"device": "/dev/nonexistent0"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 500);
    let body: Value = resp.json().await.unwrap();
    assert!(
        body["error"]
            .as_str()
            .unwrap()
            .contains("not found in lsblk output"),
        "unexpected: {body}"
    );
}

#[tokio::test]
async fn certificates_list_is_json_array() {
    let base = spawn_server().await;
    let resp = reqwest::get(format!("{base}/api/certificates"))
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert!(body.is_array(), "expected array, got: {body}");
}

#[tokio::test]
async fn certificate_generate_placeholder_acknowledges() {
    let base = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{base}/api/certificate/generate"))
        .json(&json!({"model": "M", "serial": "S", "method": "overwrite_1_pass"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(
        body["message"],
        json!("Certificate generation request received")
    );
}

#[tokio::test]
async fn cors_allows_cross_origin_frontend() {
    let base = spawn_server().await;
    let client = reqwest::Client::new();
    // The frontend on :3000 preflights POST /api/wipe.
    let resp = client
        .request(reqwest::Method::OPTIONS, format!("{base}/api/wipe"))
        .header("Origin", "http://localhost:3000")
        .header("Access-Control-Request-Method", "POST")
        .header("Access-Control-Request-Headers", "content-type")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let allow = resp
        .headers()
        .get("access-control-allow-origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        allow == "*" || allow == "http://localhost:3000",
        "unexpected ACAO: {allow:?}"
    );
}

#[tokio::test]
async fn multiple_ws_clients_all_receive_broadcast() {
    let base = spawn_server().await;
    let ws_url = base.replacen("http", "ws", 1) + "/ws";
    let (mut ws1, _) = tokio_tungstenite::connect_async(&ws_url).await.unwrap();
    let (mut ws2, _) = tokio_tungstenite::connect_async(&ws_url).await.unwrap();

    let client = reqwest::Client::new();
    client
        .post(format!("{base}/api/wipe"))
        .json(&json!({
            "DevicePath": "/dev/nonexistent1",
            "Method": "overwrite_1_pass",
        }))
        .send()
        .await
        .unwrap();

    for (i, ws) in [&mut ws1, &mut ws2].into_iter().enumerate() {
        let msg = tokio::time::timeout(std::time::Duration::from_secs(10), ws.next())
            .await
            .unwrap_or_else(|_| panic!("client {i} timed out"))
            .unwrap()
            .unwrap();
        let text = msg.into_text().unwrap();
        assert!(text.contains("nonexistent1"), "client {i}: {text}");
    }
}
