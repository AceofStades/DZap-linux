// Library root: exposes the app so integration tests can drive the router.
pub mod api;
pub mod core;
pub mod realtime;

#[cfg(test)]
mod api_test;
#[cfg(test)]
mod realtime_test;

use axum::Router;
use axum::routing::{get, post};
use tower_http::cors::CorsLayer;

pub fn build_router(hub: realtime::Hub) -> Router {
    Router::new()
        .route("/api/drives", get(api::get_drives_handler))
        .route("/api/wipe/preflight", post(api::preflight_wipe_handler))
        .route("/api/wipe", post(api::wipe_drive_handler))
        .route("/api/wipe/pause", post(api::pause_wipe_handler))
        .route("/api/wipe/abort", post(api::abort_wipe_handler))
        .route("/api/certificates", get(api::list_certificates_handler))
        .route(
            "/api/certificate/generate",
            post(api::generate_certificate_handler),
        )
        .route("/api/certificate", post(api::certificate_handler))
        .route("/api/unmount", post(api::unmount_drive_handler))
        .route(
            "/api/drive/{name}/health",
            get(api::get_drive_health_handler),
        )
        .route(
            "/api/drive/{name}/wipe-methods",
            get(api::get_wipe_methods_handler),
        )
        .route("/ws", get(api::ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(hub)
}
