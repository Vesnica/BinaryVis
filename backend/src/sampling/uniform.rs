use crate::core::sampler::{SampleMetadata, SampleResult, Sampler};
use crate::error::Result;
use memmap2::Mmap;
use rand::prelude::*;
use rayon::prelude::*;
use std::sync::Arc;

pub struct UniformSampler;

impl Sampler for UniformSampler {
    fn sample(&self, data: Arc<Mmap>, target_size: usize) -> Result<SampleResult> {
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
        let window_size = (target_size as f64).sqrt().floor() as usize;

        // 确保 window_size 至少为 1，避免除以零
        let window_size = window_size.max(1);

        let windows_count = target_size / window_size;

        // 如果计算出的窗口数为 0，说明目标大小太小，返回全部数据
        if windows_count == 0 {
            return Ok(SampleResult {
                data: data.to_vec(),
                metadata: SampleMetadata {
                    original_size: data_size,
                    sample_size: data_size,
                    method: "full".to_string(),
                },
            });
        }

        // 生成随机窗口位置
        let mut rng = thread_rng();
        let max_offset = data_size.saturating_sub(windows_count * window_size);

        // 如果 max_offset 为 0，说明数据大小刚好等于采样大小，返回全部数据
        if max_offset == 0 && windows_count * window_size == data_size {
            return Ok(SampleResult {
                data: data.to_vec(),
                metadata: SampleMetadata {
                    original_size: data_size,
                    sample_size: data_size,
                    method: "full".to_string(),
                },
            });
        }

        let mut windows: Vec<usize> = (0..windows_count)
            .map(|_| {
                if max_offset == 0 {
                    0
                } else {
                    rng.gen_range(0..=max_offset)
                }
            })
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

        let result_len = result.len();

        Ok(SampleResult {
            data: result,
            metadata: SampleMetadata {
                original_size: data_size,
                sample_size: result_len,
                method: "uniform".to_string(),
            },
        })
    }
}
