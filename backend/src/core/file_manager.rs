use crate::error::{AppError, Result};
use memmap2::{Mmap, MmapOptions};
use std::fs::File;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::io::AsyncWriteExt;

pub struct FileManager {
    upload_dir: PathBuf,
    max_file_size: usize,
}

impl FileManager {
    pub fn new(upload_dir: PathBuf, max_file_size: usize) -> Self {
        Self {
            upload_dir,
            max_file_size,
        }
    }

    // 检查指纹对应的文件是否存在
    pub async fn check_fingerprint(&self, fingerprint: &str) -> bool {
        let path = self.upload_dir.join(fingerprint);
        path.exists()
    }

    // 保存上传的文件（使用指纹作为文件名）
    pub async fn save_file(&self, data: &[u8], fingerprint: &str) -> Result<String> {
        // 检查大小限制
        if data.len() > self.max_file_size {
            return Err(AppError::FileTooLarge(data.len()));
        }

        // 使用指纹作为文件名（天然去重）
        let file_id = fingerprint.to_string();
        let path = self.upload_dir.join(&file_id);

        // 如果文件已存在，直接返回file_id（去重）
        if path.exists() {
            tracing::info!("File with fingerprint {} already exists, skipping write", fingerprint);
            return Ok(file_id);
        }

        // 确保上传目录存在
        fs::create_dir_all(&self.upload_dir)
            .await
            .map_err(AppError::FileAccess)?;

        // 写入文件
        let mut file = fs::File::create(&path)
            .await
            .map_err(AppError::FileAccess)?;

        file.write_all(data)
            .await
            .map_err(AppError::FileAccess)?;

        tracing::info!("File saved with fingerprint: {}", fingerprint);
        Ok(file_id)
    }

    // 内存映射文件
    pub fn mmap_file(&self, file_id: &str) -> Result<Arc<Mmap>> {
        let path = self.upload_dir.join(file_id);

        if !path.exists() {
            return Err(AppError::FileNotFound(file_id.to_string()));
        }

        let file = File::open(&path).map_err(AppError::FileAccess)?;

        let mmap = unsafe {
            MmapOptions::new()
                .map(&file)
                .map_err(AppError::FileAccess)?
        };

        Ok(Arc::new(mmap))
    }

    // 获取文件信息
    pub async fn get_file_info(&self, file_id: &str) -> Result<FileInfo> {
        let path = self.upload_dir.join(file_id);

        let metadata = fs::metadata(&path)
            .await
            .map_err(|_| AppError::FileNotFound(file_id.to_string()))?;

        Ok(FileInfo {
            id: file_id.to_string(),
            size: metadata.len() as usize,
            created: metadata
                .created()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0),
        })
    }

    // 删除文件
    pub async fn delete_file(&self, file_id: &str) -> Result<()> {
        let path = self.upload_dir.join(file_id);

        fs::remove_file(&path)
            .await
            .map_err(|_| AppError::FileNotFound(file_id.to_string()))?;

        Ok(())
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FileInfo {
    pub id: String,
    pub size: usize,
    pub created: u64,
}
