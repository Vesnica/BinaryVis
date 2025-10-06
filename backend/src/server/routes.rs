use axum::{routing::{delete, get, post}, Router};

pub fn api_routes() -> Router {
    Router::new()
        .route("/upload", post(super::handlers::upload_file))
        .route("/files/:id", get(super::handlers::get_file_info))
        .route("/files/:id", delete(super::handlers::delete_file))
        .route("/sample/:id", post(super::handlers::sample_file))
        .route("/health", get(super::handlers::health_check))
        .route("/metrics", get(super::handlers::get_metrics))
}

pub fn ws_routes() -> Router {
    Router::new().route("/:id", get(super::websocket::websocket_handler))
}
