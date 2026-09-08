use crate::api::{CertRequest, certificate_handler};
use crate::core::certificate;
use axum::Json;
use axum::body::to_bytes;
use axum::extract::Query;
use axum::http::{StatusCode, header};
use std::collections::HashMap;

fn request() -> CertRequest {
    CertRequest {
        model: "API Model".to_string(),
        serial: "API-SERIAL".to_string(),
        method: "overwrite_1_pass".to_string(),
        log_hash: "ignored-by-current-handler".to_string(),
    }
}

#[tokio::test]
async fn certificate_handler_returns_signed_json() {
    certificate::init_for_tests();

    let response = certificate_handler(Query(HashMap::new()), Ok(Json(request()))).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");

    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["data"]["deviceModel"], "API Model");
    assert_eq!(body["data"]["deviceSerial"], "API-SERIAL");
    assert_eq!(body["data"]["wipeMethod"], "overwrite_1_pass");
    assert_eq!(body["data"]["verificationHash"], "placeholder_hash");
    assert_eq!(body["signature"].as_str().unwrap().len(), 512);
    assert!(
        body["publicKey"]
            .as_str()
            .unwrap()
            .starts_with("-----BEGIN PUBLIC KEY-----")
    );
}

#[tokio::test]
async fn certificate_handler_returns_downloadable_pdf() {
    certificate::init_for_tests();
    let response = certificate_handler(
        Query(HashMap::from([("format".to_string(), "pdf".to_string())])),
        Ok(Json(request())),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/pdf");
    assert_eq!(
        response.headers()[header::CONTENT_DISPOSITION],
        "attachment; filename=certificate.pdf"
    );
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert!(bytes.starts_with(b"%PDF-1.4\n"));
    assert!(bytes.windows(5).any(|window| window == b"%%EOF"));
}
