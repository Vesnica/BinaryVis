import { encode, decode } from '@msgpack/msgpack';

export class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map();
    this.messageQueue = [];
  }

  // 连接服务器
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.flushMessageQueue();
        resolve();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        // Fast-fail: 不自动重连
        this.ws = null;
      };
    });
  }

  // 发送消息
  send(type, payload) {
    const message = {
      type,
      id: this.generateId(),
      timestamp: Date.now(),
      payload: encode(payload),
    };

    const packed = encode(message);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(packed);
    } else {
      // Fast-fail: 连接断开直接报错
      throw new Error('WebSocket not connected');
    }
  }

  // 处理消息
  handleMessage(data) {
    const message = decode(new Uint8Array(data));

    console.log('Received WebSocket message, type:', message.type);

    if (message.type === 'error') {
      // Fast-fail: 错误直接抛出
      // payload 已经是 Uint8Array,需要再次 decode
      const errorPayload = decode(new Uint8Array(message.payload));
      throw new Error(`Server error: ${errorPayload.message}`);
    }

    const handler = this.handlers.get(message.type);
    if (handler) {
      // payload 字段是用 serde_bytes 序列化的,已经是字节数组
      // 需要将其转换为 Uint8Array 后再 decode
      const payload = decode(new Uint8Array(message.payload));
      console.log('Decoded payload:', payload);
      handler(payload);
    } else {
      console.warn('No handler registered for message type:', message.type);
    }
  }

  // 注册消息处理器
  on(type, handler) {
    this.handlers.set(type, handler);
  }

  // 断开连接
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // 生成唯一 ID
  generateId() {
    // 优先使用 crypto.randomUUID (安全上下文)
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    // 非安全上下文的降级方案
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // 清空消息队列
  flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift();
      this.ws.send(msg);
    }
  }
}
