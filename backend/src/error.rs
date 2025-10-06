use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::fmt;

#[derive(Debug)]
pub enum AppError {
    // 文件相关错误
    FileNotFound(String),
    FileTooLarge(usize),
    FileAccess(std::io::Error),

    // 采样错误
    #[allow(dead_code)]
    SamplingFailed(String),
    InvalidSampleSize(usize),

    // 系统错误
    Internal(anyhow::Error),
    BadRequest(String),

    // WebSocket错误
    ConnectionClosed,
    InvalidMessage,
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::FileNotFound(path) => write!(f, "File not found: {}", path),
            Self::FileTooLarge(size) => write!(f, "File too large: {} bytes", size),
            Self::FileAccess(e) => write!(f, "File access error: {}", e),
            Self::SamplingFailed(msg) => write!(f, "Sampling failed: {}", msg),
            Self::InvalidSampleSize(size) => write!(f, "Invalid sample size: {}", size),
            Self::Internal(e) => write!(f, "Internal error: {}", e),
            Self::BadRequest(msg) => write!(f, "Bad request: {}", msg),
            Self::ConnectionClosed => write!(f, "Connection closed"),
            Self::InvalidMessage => write!(f, "Invalid message format"),
        }
    }
}

impl std::error::Error for AppError {}

// Fast-fail: 直接返回错误，不做降级
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::FileNotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            Self::FileTooLarge(_) => (StatusCode::PAYLOAD_TOO_LARGE, self.to_string()),
            Self::FileAccess(_) => (StatusCode::FORBIDDEN, self.to_string()),
            Self::InvalidSampleSize(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            Self::BadRequest(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };

        let body = Json(json!({
            "error": message,
            "code": status.as_u16(),
        }));

        (status, body).into_response()
    }
}

// 便捷的Result类型
pub type Result<T> = std::result::Result<T, AppError>;
