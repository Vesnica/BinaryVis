export class DataManager {
  constructor() {
    this.buffer = null;
    this.metadata = null;
    this.chunks = new Map();
    this.totalSize = 0;
    this.receivedSize = 0;
    this.onDataCallback = null;
  }

  // 初始化数据缓冲区
  initialize(totalSize) {
    this.totalSize = totalSize;
    this.receivedSize = 0;
    this.buffer = new Uint8Array(totalSize);
    this.chunks.clear();
  }

  // 添加数据块
  addChunk(offset, chunk) {
    if (!this.buffer) {
      throw new Error('Buffer not initialized');
    }

    // 将数据块写入缓冲区
    this.buffer.set(chunk, offset);
    this.receivedSize += chunk.length;

    // 检查是否接收完整
    if (this.receivedSize >= this.totalSize) {
      if (this.onDataCallback) {
        this.onDataCallback(this.buffer);
      }
      return true;
    }

    return false;
  }

  // 获取数据
  getData() {
    return this.buffer;
  }

  // 设置数据回调
  onData(callback) {
    this.onDataCallback = callback;
  }

  // 清空数据
  clear() {
    this.buffer = null;
    this.metadata = null;
    this.chunks.clear();
    this.totalSize = 0;
    this.receivedSize = 0;
  }

  // 获取进度
  getProgress() {
    if (this.totalSize === 0) return 0;
    return this.receivedSize / this.totalSize;
  }
}
