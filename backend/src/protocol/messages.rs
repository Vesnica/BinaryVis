use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    #[serde(rename = "type")]
    pub type_field: MessageType,
    pub id: String,
    pub timestamp: u64,
    #[serde(with = "serde_bytes")]
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MessageType {
    Data,
    Control,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataMessage {
    pub offset: usize,
    pub total: usize,
    #[serde(with = "serde_bytes")]
    pub chunk: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlMessage {
    pub command: String,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampleRequest {
    pub sample_size: usize,
    pub method: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorMessage {
    pub code: u16,
    pub message: String,
    pub details: Option<serde_json::Value>,
}
