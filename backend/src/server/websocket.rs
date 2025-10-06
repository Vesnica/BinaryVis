use crate::core::{Cache, Sampler};
use crate::error::{AppError, Result};
use crate::protocol::{ControlMessage, DataMessage, ErrorMessage, Message, MessageType, SampleRequest};
use crate::sampling::UniformSampler;
use crate::server::handlers::AppState;
use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        Extension, Path,
    },
    response::Response,
};
use futures::{sink::SinkExt, stream::StreamExt};
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{error, info};
use uuid::Uuid;

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
            if sender.send(WsMessage::Binary(data)).await.is_err() {
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
                Ok(WsMessage::Binary(data)) => {
                    if let Err(e) = handle_message(&recv_state, &file_id, data, &recv_tx).await {
                        error!("Error handling message: {}", e);
                        // 发送错误消息
                        let _ = send_error(&recv_tx, e).await;
                        break; // Fast-fail
                    }
                }
                Ok(WsMessage::Close(_)) => break,
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
    let message: Message = rmp_serde::from_slice(&data).map_err(|_| AppError::InvalidMessage)?;

    match message.type_field {
        MessageType::Control => {
            let control: ControlMessage =
                rmp_serde::from_slice(&message.payload).map_err(|_| AppError::InvalidMessage)?;

            match control.command.as_str() {
                "sample" => {
                    let params = control.params.ok_or(AppError::BadRequest(
                        "Missing sample parameters".to_string(),
                    ))?;

                    let request: SampleRequest = serde_json::from_value(params)
                        .map_err(|e| AppError::BadRequest(e.to_string()))?;

                    // 执行采样
                    let sample = perform_sampling(state, file_id, request.sample_size).await?;

                    // 分块发送
                    stream_sample(tx, sample).await?;
                }
                _ => {
                    return Err(AppError::BadRequest(format!(
                        "Unknown command: {}",
                        control.command
                    )));
                }
            }
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
    // 验证采样大小
    if sample_size > state.config.max_sample_size {
        return Err(AppError::InvalidSampleSize(sample_size));
    }

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

async fn stream_sample(tx: &mpsc::Sender<Vec<u8>>, sample: Vec<u8>) -> Result<()> {
    const CHUNK_SIZE: usize = 256 * 1024; // 256KB per chunk

    let total = sample.len();
    let mut offset = 0;

    while offset < total {
        let end = (offset + CHUNK_SIZE).min(total);
        let chunk = &sample[offset..end];

        let data_msg = DataMessage {
            offset,
            total,
            chunk: chunk.to_vec(),
        };

        // 使用 Map 格式序列化,与外层 Message 保持一致
        let mut payload = Vec::new();
        data_msg.serialize(&mut rmp_serde::Serializer::new(&mut payload).with_struct_map())
            .map_err(|e| AppError::Internal(e.into()))?;

        let message = Message {
            type_field: MessageType::Data,
            id: Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().timestamp() as u64,
            payload,
        };

        // 使用命名格式序列化，而不是数组格式
        let mut packed = Vec::new();
        message.serialize(&mut rmp_serde::Serializer::new(&mut packed).with_struct_map())
            .map_err(|e| AppError::Internal(e.into()))?;

        tx.send(packed)
            .await
            .map_err(|_| AppError::ConnectionClosed)?;

        offset = end;

        // 小延迟避免拥塞
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    }

    Ok(())
}

async fn send_error(tx: &mpsc::Sender<Vec<u8>>, error: AppError) -> Result<()> {
    let error_msg = ErrorMessage {
        code: 500,
        message: error.to_string(),
        details: None,
    };

    // 使用 Map 格式序列化,与外层 Message 保持一致
    let mut payload = Vec::new();
    error_msg.serialize(&mut rmp_serde::Serializer::new(&mut payload).with_struct_map())
        .map_err(|e| AppError::Internal(e.into()))?;

    let message = Message {
        type_field: MessageType::Error,
        id: Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().timestamp() as u64,
        payload,
    };

    // 使用命名格式序列化
    let mut packed = Vec::new();
    message.serialize(&mut rmp_serde::Serializer::new(&mut packed).with_struct_map())
        .map_err(|e| AppError::Internal(e.into()))?;

    tx.send(packed)
        .await
        .map_err(|_| AppError::ConnectionClosed)?;

    Ok(())
}
