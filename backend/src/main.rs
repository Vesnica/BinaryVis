use axum::{extract::DefaultBodyLimit, Extension, Router};
use server::handlers::AppState;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tracing::info;

mod config;
mod core;
mod error;
mod protocol;
mod sampling;
mod server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    // 加载配置
    let config = config::Config::from_env()?;

    info!("Starting BinaryVis backend server");
    info!("Configuration: {:?}", config);

    // 初始化应用状态
    let state = Arc::new(AppState {
        file_manager: Arc::new(core::FileManager::new(
            config.upload_dir.clone(),
            config.max_file_size,
        )),
        cache: Arc::new(core::Cache::new(config.cache_size)),
        config: config.clone(),
    });

    // 构建路由
    let app = Router::new()
        .nest("/api", server::api_routes())
        .nest("/ws", server::ws_routes())
        .layer(Extension(state))
        .layer(CorsLayer::permissive())
        // 设置请求体大小限制为配置中的 max_file_size
        .layer(DefaultBodyLimit::max(config.max_file_size));

    // 启动服务器
    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    info!("Server listening on {}", addr);

    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
