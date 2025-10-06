use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_upload_dir")]
    pub upload_dir: PathBuf,
    #[serde(default = "default_max_file_size")]
    pub max_file_size: usize,
    #[serde(default = "default_max_sample_size")]
    pub max_sample_size: usize,
    #[serde(default = "default_cache_size")]
    pub cache_size: usize,
    #[serde(default = "default_max_connections")]
    pub max_connections: usize,
}

fn default_port() -> u16 {
    3000
}
fn default_upload_dir() -> PathBuf {
    PathBuf::from("./uploads")
}
fn default_max_file_size() -> usize {
    10 * 1024 * 1024 * 1024 // 10GB
}
fn default_max_sample_size() -> usize {
    128 * 1024 * 1024 // 128MB
}
fn default_cache_size() -> usize {
    512 * 1024 * 1024 // 512MB
}
fn default_max_connections() -> usize {
    100
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        dotenv::dotenv().ok();

        let config = Self {
            port: std::env::var("PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(default_port),
            upload_dir: std::env::var("UPLOAD_DIR")
                .ok()
                .map(PathBuf::from)
                .unwrap_or_else(default_upload_dir),
            max_file_size: std::env::var("MAX_FILE_SIZE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(default_max_file_size),
            max_sample_size: std::env::var("MAX_SAMPLE_SIZE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(default_max_sample_size),
            cache_size: std::env::var("CACHE_SIZE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(default_cache_size),
            max_connections: std::env::var("MAX_CONNECTIONS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(default_max_connections),
        };

        Ok(config)
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            port: default_port(),
            upload_dir: default_upload_dir(),
            max_file_size: default_max_file_size(),
            max_sample_size: default_max_sample_size(),
            cache_size: default_cache_size(),
            max_connections: default_max_connections(),
        }
    }
}
