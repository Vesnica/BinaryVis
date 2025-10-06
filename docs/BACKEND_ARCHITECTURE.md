# 后端架构设计文档

## 1. 技术栈

### 核心依赖
- **Rust 1.75+**: 系统编程语言
- **Tokio 1.35+**: 异步运行时
- **Axum 0.7+**: Web 框架
- **Tower**: 中间件和服务组合
- **Memmap2 0.9+**: 内存映射文件
- **Rayon 1.8+**: 数据并行处理

### 工具库
- **rmp-serde**: MessagePack 序列化
- **bytes**: 字节操作
- **rand**: 随机数生成
- **tracing**: 结构化日志
- **anyhow**: 错误处理

## 2. 项目结构

```
backend/
├── Cargo.toml                 # 项目配置
├── Cargo.lock                # 依赖锁定（gitignore）
├── .env                      # 环境配置（gitignore）
├── src/
│   ├── main.rs               # 程序入口
│   ├── config.rs             # 配置管理
│   ├── error.rs              # 错误定义
│   ├── server/
│   │   ├── mod.rs           # 服务器模块导出
│   │   ├── routes.rs        # 路由定义
│   │   ├── handlers.rs      # HTTP 请求处理器
│   │   └── websocket.rs     # WebSocket 处理
│   ├── core/
│   │   ├── mod.rs           # 核心模块导出
│   │   ├── file_manager.rs  # 文件管理（上传/删除/mmap）
│   │   ├── sampler.rs       # 采样器特征定义
│   │   └── cache.rs         # LRU 缓存实现
│   ├── sampling/
│   │   ├── mod.rs           # 采样模块导出
│   │   └── uniform.rs       # 均匀采样实现
│   └── protocol/
│       ├── mod.rs           # 协议模块导出
│       └── messages.rs      # MessagePack 消息定义
├── uploads/                  # 上传文件目录（gitignore）
└── target/                   # 编译输出（gitignore）
```

## 3. 核心模块设计

### 3.1 主程序入口

```rust
// src/main.rs
use axum::{Router, Extension};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tracing::{info, error};

mod config;
mod error;
mod server;
mod core;
mod sampling;
mod protocol;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    // 加载配置
    let config = config::Config::from_env()?;

    // 初始化应用状态
    let state = Arc::new(AppState::new(config.clone()));

    // 构建路由
    let app = Router::new()
        .nest("/api", server::routes::api_routes())
        .nest("/ws", server::routes::ws_routes())
        .layer(Extension(state))
        .layer(CorsLayer::permissive());

    // 启动服务器
    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    info!("Server listening on {}", addr);

    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

pub struct AppState {
    pub config: config::Config,
    pub file_manager: Arc<core::FileManager>,
    pub cache: Arc<core::Cache>,
}

impl AppState {
    pub fn new(config: config::Config) -> Self {
        Self {
            file_manager: Arc::new(core::FileManager::new(
                config.upload_dir.clone(),
                config.max_file_size,
            )),
            cache: Arc::new(core::Cache::new(config.cache_size)),
            config,
        }
    }
}
```

### 3.2 错误处理

```rust
// src/error.rs
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
```

### 3.3 文件管理器

```rust
// src/core/file_manager.rs
use memmap2::{Mmap, MmapOptions};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

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

    // 保存上传的文件
    pub async fn save_file(&self, data: &[u8], filename: &str) -> Result<String> {
        // 检查大小限制
        if data.len() > self.max_file_size {
            return Err(AppError::FileTooLarge(data.len()));
        }

        // 生成唯一文件名
        let file_id = Uuid::new_v4().to_string();
        let path = self.upload_dir.join(&file_id);

        // 写入文件
        let mut file = fs::File::create(&path)
            .await
            .map_err(AppError::FileAccess)?;

        file.write_all(data)
            .await
            .map_err(AppError::FileAccess)?;

        Ok(file_id)
    }

    // 内存映射文件
    pub fn mmap_file(&self, file_id: &str) -> Result<Arc<Mmap>> {
        let path = self.upload_dir.join(file_id);

        if !path.exists() {
            return Err(AppError::FileNotFound(file_id.to_string()));
        }

        let file = File::open(&path)
            .map_err(AppError::FileAccess)?;

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
            created: metadata.created()
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
```

### 3.4 采样器实现

```rust
// src/sampling/uniform.rs
use crate::core::sampler::{Sampler, SampleResult};
use memmap2::Mmap;
use rand::prelude::*;
use rayon::prelude::*;
use std::sync::Arc;

pub struct UniformSampler;

impl Sampler for UniformSampler {
    fn sample(
        &self,
        data: Arc<Mmap>,
        target_size: usize,
    ) -> Result<SampleResult> {
        let data_size = data.len();

        // 如果文件小于目标大小，返回全部数据
        if data_size <= target_size {
            return Ok(SampleResult {
                data: data.to_vec(),
                metadata: SampleMetadata {
                    original_size: data_size,
                    sample_size: data_size,
                    method: "full".to_string(),
                },
            });
        }

        // 计算采样参数
        let window_size = (target_size as f64).sqrt() as usize;
        let windows_count = target_size / window_size;

        // 生成随机窗口位置
        let mut rng = thread_rng();
        let max_offset = data_size.saturating_sub(windows_count * window_size);

        let mut windows: Vec<usize> = (0..windows_count)
            .map(|_| rng.gen_range(0..=max_offset))
            .collect();

        // 排序窗口位置
        windows.sort_unstable();

        // 调整位置避免重叠
        for i in 0..windows_count {
            windows[i] += i * window_size;
        }

        // 并行提取数据
        let chunks: Vec<Vec<u8>> = windows
            .par_iter()
            .map(|&offset| {
                let end = (offset + window_size).min(data_size);
                data[offset..end].to_vec()
            })
            .collect();

        // 合并数据
        let mut result = Vec::with_capacity(target_size);
        for chunk in chunks {
            result.extend_from_slice(&chunk);
        }

        Ok(SampleResult {
            data: result,
            metadata: SampleMetadata {
                original_size: data_size,
                sample_size: result.len(),
                method: "uniform".to_string(),
            },
        })
    }
}

// 采样器特征
// src/core/sampler.rs
use std::sync::Arc;
use memmap2::Mmap;
use serde::{Serialize, Deserialize};

pub trait Sampler: Send + Sync {
    fn sample(
        &self,
        data: Arc<Mmap>,
        target_size: usize,
    ) -> Result<SampleResult>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampleResult {
    pub data: Vec<u8>,
    pub metadata: SampleMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampleMetadata {
    pub original_size: usize,
    pub sample_size: usize,
    pub method: String,
}
```

### 3.5 LRU 缓存实现

```rust
// src/core/cache.rs
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;

pub struct Cache {
    capacity: usize,
    store: Mutex<CacheStore>,
}

struct CacheStore {
    map: HashMap<u64, CacheEntry>,
    order: VecDeque<u64>,
    total_size: usize,
}

struct CacheEntry {
    data: Vec<u8>,
    size: usize,
}

impl Cache {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            store: Mutex::new(CacheStore {
                map: HashMap::new(),
                order: VecDeque::new(),
                total_size: 0,
            }),
        }
    }

    // 生成缓存键
    pub fn make_key(file_id: &str, sample_size: usize) -> u64 {
        let mut hasher = DefaultHasher::new();
        file_id.hash(&mut hasher);
        sample_size.hash(&mut hasher);
        hasher.finish()
    }

    // 获取缓存
    pub fn get(&self, key: u64) -> Option<Vec<u8>> {
        let mut store = self.store.lock().unwrap();

        if let Some(entry) = store.map.get(&key) {
            // 更新访问顺序
            store.order.retain(|&k| k != key);
            store.order.push_back(key);

            Some(entry.data.clone())
        } else {
            None
        }
    }

    // 插入缓存
    pub fn put(&self, key: u64, data: Vec<u8>) {
        let mut store = self.store.lock().unwrap();
        let size = data.len();

        // 如果已存在，先删除旧的
        if let Some(old_entry) = store.map.remove(&key) {
            store.total_size -= old_entry.size;
            store.order.retain(|&k| k != key);
        }

        // 清理空间直到能容纳新数据
        while store.total_size + size > self.capacity && !store.order.is_empty() {
            if let Some(evict_key) = store.order.pop_front() {
                if let Some(entry) = store.map.remove(&evict_key) {
                    store.total_size -= entry.size;
                }
            }
        }

        // 插入新数据
        if store.total_size + size <= self.capacity {
            store.map.insert(key, CacheEntry { data, size });
            store.order.push_back(key);
            store.total_size += size;
        }
    }

    // 清空缓存
    pub fn clear(&self) {
        let mut store = self.store.lock().unwrap();
        store.map.clear();
        store.order.clear();
        store.total_size = 0;
    }

    // 获取缓存统计
    pub fn stats(&self) -> CacheStats {
        let store = self.store.lock().unwrap();
        CacheStats {
            entries: store.map.len(),
            total_size: store.total_size,
            capacity: self.capacity,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CacheStats {
    pub entries: usize,
    pub total_size: usize,
    pub capacity: usize,
}
```

### 3.6 HTTP 路由和处理器

> **注意**：以下代码为设计文档，实际实现与此基本一致。主要差异：
> - Base64 编码使用 `base64::engine::general_purpose::STANDARD`
> - 指标接口仅返回缓存统计信息
> - 详细实现见 `src/server/handlers.rs` 和 `src/server/routes.rs`

### 3.7 WebSocket 处理

```rust
// src/server/websocket.rs
use axum::{
    extract::{ws::{WebSocket, WebSocketUpgrade, Message}, Extension, Path},
    response::Response,
};
use futures::{sink::SinkExt, stream::StreamExt};
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{info, error};

pub async fn websocket_handler(
    ws: WebSocketUpgrade,
    Extension(state): Extension<Arc<AppState>>,
    Path(file_id): Path<String>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state, file_id))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>, file_id: String) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(100);

    // 发送任务
    let send_task = tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            if sender.send(Message::Binary(data)).await.is_err() {
                break;
            }
        }
    });

    // 接收任务
    let recv_state = state.clone();
    let recv_tx = tx.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            match msg {
                Ok(Message::Binary(data)) => {
                    if let Err(e) = handle_message(
                        &recv_state,
                        &file_id,
                        data,
                        &recv_tx,
                    ).await {
                        error!("Error handling message: {}", e);
                        break; // Fast-fail
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    break; // Fast-fail
                }
                _ => {}
            }
        }
    });

    // 等待任务完成
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }
}

async fn handle_message(
    state: &Arc<AppState>,
    file_id: &str,
    data: Vec<u8>,
    tx: &mpsc::Sender<Vec<u8>>,
) -> Result<()> {
    // 解析消息
    let message: protocol::Message = rmp_serde::from_slice(&data)
        .map_err(|_| AppError::InvalidMessage)?;

    match message.type_field {
        protocol::MessageType::SampleRequest => {
            let request: protocol::SampleRequest = rmp_serde::from_slice(&message.payload)
                .map_err(|_| AppError::InvalidMessage)?;

            // 执行采样
            let sample = perform_sampling(
                state,
                file_id,
                request.sample_size,
            ).await?;

            // 分块发送
            stream_sample(tx, sample).await?;
        }
        protocol::MessageType::Control => {
            // 处理控制消息
            handle_control_message(state, message.payload).await?;
        }
        _ => {
            return Err(AppError::InvalidMessage);
        }
    }

    Ok(())
}

async fn perform_sampling(
    state: &Arc<AppState>,
    file_id: &str,
    sample_size: usize,
) -> Result<Vec<u8>> {
    // 检查缓存
    let cache_key = Cache::make_key(file_id, sample_size);
    if let Some(cached) = state.cache.get(cache_key) {
        info!("Cache hit for file {} size {}", file_id, sample_size);
        return Ok(cached);
    }

    // 内存映射文件
    let mmap = state.file_manager.mmap_file(file_id)?;

    // 执行采样
    let sampler = UniformSampler;
    let result = sampler.sample(mmap, sample_size)?;

    // 更新缓存
    state.cache.put(cache_key, result.data.clone());

    Ok(result.data)
}

async fn stream_sample(
    tx: &mpsc::Sender<Vec<u8>>,
    sample: Vec<u8>,
) -> Result<()> {
    const CHUNK_SIZE: usize = 256 * 1024; // 256KB per chunk

    let total = sample.len();
    let mut offset = 0;

    while offset < total {
        let end = (offset + CHUNK_SIZE).min(total);
        let chunk = &sample[offset..end];

        let message = protocol::DataMessage {
            offset,
            total,
            chunk: chunk.to_vec(),
        };

        let packed = rmp_serde::to_vec(&message)
            .map_err(|e| AppError::Internal(e.into()))?;

        tx.send(packed).await
            .map_err(|_| AppError::ConnectionClosed)?;

        offset = end;

        // 小延迟避免拥塞
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    }

    Ok(())
}
```

### 3.7 HTTP 路由

```rust
// src/server/routes.rs
use axum::{
    Router,
    routing::{get, post},
};

pub fn api_routes() -> Router {
    Router::new()
        .route("/upload", post(handlers::upload_file))
        .route("/files/:id", get(handlers::get_file_info))
        .route("/files/:id", delete(handlers::delete_file))
        .route("/sample/:id", post(handlers::sample_file))
        .route("/health", get(handlers::health_check))
        .route("/metrics", get(handlers::get_metrics))
}

pub fn ws_routes() -> Router {
    Router::new()
        .route("/:id", get(websocket::websocket_handler))
}

// src/server/handlers.rs
use axum::{
    extract::{Extension, Path, Multipart},
    Json,
    response::IntoResponse,
};
use std::sync::Arc;

pub async fn upload_file(
    Extension(state): Extension<Arc<AppState>>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>> {
    while let Some(field) = multipart.next_field().await
        .map_err(|e| AppError::BadRequest(e.to_string()))? {

        let name = field.name().unwrap_or("").to_string();
        let filename = field.file_name().unwrap_or("unknown").to_string();
        let data = field.bytes().await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;

        // 保存文件
        let file_id = state.file_manager
            .save_file(&data, &filename)
            .await?;

        return Ok(Json(UploadResponse {
            file_id,
            filename,
            size: data.len(),
        }));
    }

    Err(AppError::BadRequest("No file provided".to_string()))
}

pub async fn sample_file(
    Extension(state): Extension<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<SampleRequest>,
) -> Result<Json<SampleResponse>> {
    // 验证采样大小
    if request.sample_size > state.config.max_sample_size {
        return Err(AppError::InvalidSampleSize(request.sample_size));
    }

    // 执行采样
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
        data: base64::encode(&data),
        size: data.len(),
    }))
}

pub async fn health_check() -> impl IntoResponse {
    Json(json!({
        "status": "healthy",
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}
```

## 4. 配置管理

```rust
// src/config.rs
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub port: u16,
    pub upload_dir: PathBuf,
    pub max_file_size: usize,
    pub max_sample_size: usize,
    pub cache_size: usize,
    pub max_connections: usize,
}

impl Config {
    pub fn from_env() -> Result<Self, envy::Error> {
        envy::from_env()
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            port: 3000,
            upload_dir: PathBuf::from("./uploads"),
            max_file_size: 10 * 1024 * 1024 * 1024, // 10GB
            max_sample_size: 128 * 1024 * 1024,     // 128MB
            cache_size: 512 * 1024 * 1024,          // 512MB
            max_connections: 100,
        }
    }
}
```

## 5. 性能优化

### 5.1 并发处理
- 使用 Tokio 异步运行时处理 I/O
- Rayon 并行处理采样计算
- 多线程工作池处理 CPU 密集任务

### 5.2 内存管理
- 内存映射避免大文件全部加载
- LRU 缓存减少重复计算
- 流式传输减少内存峰值

### 5.3 网络优化
- WebSocket 分块传输大数据
- MessagePack 二进制序列化
- 连接池管理

## 6. 测试策略

### 6.1 单元测试

```rust
// tests/sampling.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_uniform_sampling() {
        let data = vec![0u8; 1024 * 1024]; // 1MB
        let sampler = UniformSampler;
        let result = sampler.sample(Arc::new(data), 1024).unwrap();

        assert_eq!(result.data.len(), 1024);
        assert_eq!(result.metadata.method, "uniform");
    }

    #[test]
    fn test_cache_lru() {
        let cache = Cache::new(1024);

        cache.put(1, vec![0u8; 512]);
        cache.put(2, vec![0u8; 512]);
        cache.put(3, vec![0u8; 512]); // 应该驱逐 key=1

        assert!(cache.get(1).is_none());
        assert!(cache.get(2).is_some());
        assert!(cache.get(3).is_some());
    }
}
```

### 6.2 基准测试

```rust
// benches/sampling.rs
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn benchmark_sampling(c: &mut Criterion) {
    let data = vec![0u8; 100 * 1024 * 1024]; // 100MB
    let sampler = UniformSampler;

    c.bench_function("sample_1mb_from_100mb", |b| {
        b.iter(|| {
            sampler.sample(
                black_box(Arc::new(data.clone())),
                black_box(1024 * 1024)
            )
        })
    });
}

criterion_group!(benches, benchmark_sampling);
criterion_main!(benches);
```

## 7. 部署配置

### 7.1 开发环境

```toml
# .env.development
PORT=3000
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10737418240
MAX_SAMPLE_SIZE=134217728
CACHE_SIZE=536870912
MAX_CONNECTIONS=100
RUST_LOG=debug
```

### 7.2 生产环境

```toml
# .env.production
PORT=3000
UPLOAD_DIR=/data/uploads
MAX_FILE_SIZE=10737418240
MAX_SAMPLE_SIZE=134217728
CACHE_SIZE=2147483648
MAX_CONNECTIONS=1000
RUST_LOG=info
```

### 7.3 Dockerfile

```dockerfile
# 构建阶段
FROM rust:1.75 as builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release

# 运行阶段
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/binaryvis-backend /app/

ENV PORT=3000
EXPOSE 3000

CMD ["./binaryvis-backend"]
```

## 8. 监控和日志

### 8.1 结构化日志

```rust
use tracing::{info, warn, error, debug};

// 请求日志
info!(
    method = %request.method(),
    path = %request.uri().path(),
    "Incoming request"
);

// 性能日志
debug!(
    file_id = %file_id,
    sample_size = sample_size,
    duration_ms = elapsed.as_millis(),
    "Sampling completed"
);

// 错误日志
error!(
    error = %e,
    file_id = %file_id,
    "Failed to process file"
);
```

### 8.2 指标收集

```rust
// src/utils/metrics.rs
use std::sync::atomic::{AtomicU64, Ordering};

pub struct Metrics {
    pub requests_total: AtomicU64,
    pub bytes_processed: AtomicU64,
    pub cache_hits: AtomicU64,
    pub cache_misses: AtomicU64,
    pub active_connections: AtomicU64,
}

impl Metrics {
    pub fn new() -> Self {
        Self {
            requests_total: AtomicU64::new(0),
            bytes_processed: AtomicU64::new(0),
            cache_hits: AtomicU64::new(0),
            cache_misses: AtomicU64::new(0),
            active_connections: AtomicU64::new(0),
        }
    }

    pub fn to_json(&self) -> serde_json::Value {
        json!({
            "requests_total": self.requests_total.load(Ordering::Relaxed),
            "bytes_processed": self.bytes_processed.load(Ordering::Relaxed),
            "cache_hits": self.cache_hits.load(Ordering::Relaxed),
            "cache_misses": self.cache_misses.load(Ordering::Relaxed),
            "active_connections": self.active_connections.load(Ordering::Relaxed),
        })
    }
}
```