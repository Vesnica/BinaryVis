use crate::error::Result;
use memmap2::Mmap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub trait Sampler: Send + Sync {
    fn sample(&self, data: Arc<Mmap>, target_size: usize) -> Result<SampleResult>;
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
