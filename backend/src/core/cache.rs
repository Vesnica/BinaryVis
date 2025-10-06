use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::sync::Mutex;

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
            let data = entry.data.clone();

            // 更新访问顺序
            store.order.retain(|&k| k != key);
            store.order.push_back(key);

            Some(data)
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
    #[allow(dead_code)]
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
