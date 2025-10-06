use crate::config::Config;
use crate::core::{Cache, FileManager, Sampler};
use crate::error::{AppError, Result};
use crate::sampling::UniformSampler;
use axum::{
    extract::{Extension, Multipart, Path},
    response::IntoResponse,
    Json,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;

pub struct AppState {
    pub config: Config,
    pub file_manager: Arc<FileManager>,
    pub cache: Arc<Cache>,
}

#[derive(Debug, Serialize)]
pub struct UploadResponse {
    file_id: String,
    filename: String,
    size: usize,
}

pub async fn upload_file(
    Extension(state): Extension<Arc<AppState>>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        let filename = field.file_name().unwrap_or("unknown").to_string();
        let data = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;

        // 保存文件
        let file_id = state.file_manager.save_file(&data, &filename).await?;

        return Ok(Json(UploadResponse {
            file_id,
            filename,
            size: data.len(),
        }));
    }

    Err(AppError::BadRequest("No file provided".to_string()))
}

pub async fn get_file_info(
    Extension(state): Extension<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<crate::core::FileInfo>> {
    let info = state.file_manager.get_file_info(&id).await?;
    Ok(Json(info))
}

pub async fn delete_file(
    Extension(state): Extension<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>> {
    state.file_manager.delete_file(&id).await?;
    Ok(Json(json!({
        "message": "File deleted successfully"
    })))
}

#[derive(Debug, Deserialize)]
pub struct SampleRequestBody {
    sample_size: usize,
    #[allow(dead_code)]
    method: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SampleResponse {
    data: String,
    size: usize,
}

pub async fn sample_file(
    Extension(state): Extension<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<SampleRequestBody>,
) -> Result<Json<SampleResponse>> {
    // 验证采样大小
    if request.sample_size > state.config.max_sample_size {
        return Err(AppError::InvalidSampleSize(request.sample_size));
    }

    // 检查缓存
    let cache_key = Cache::make_key(&id, request.sample_size);

    let data = if let Some(cached) = state.cache.get(cache_key) {
        cached
    } else {
        let mmap = state.file_manager.mmap_file(&id)?;
        let sampler = UniformSampler;
        let result = sampler.sample(mmap, request.sample_size)?;

        state.cache.put(cache_key, result.data.clone());
        result.data
    };

    Ok(Json(SampleResponse {
        data: base64::engine::general_purpose::STANDARD.encode(&data),
        size: data.len(),
    }))
}

pub async fn health_check() -> impl IntoResponse {
    Json(json!({
        "status": "healthy",
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

pub async fn get_metrics(Extension(state): Extension<Arc<AppState>>) -> impl IntoResponse {
    let cache_stats = state.cache.stats();

    Json(json!({
        "cache_usage": {
            "entries": cache_stats.entries,
            "total_size": cache_stats.total_size,
            "capacity": cache_stats.capacity,
        }
    }))
}
