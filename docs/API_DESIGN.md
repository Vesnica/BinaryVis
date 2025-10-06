# API 接口设计文档

## 1. 概述

### 1.1 基础信息
- **Base URL**: `http://localhost:3000`
- **WebSocket URL**: `ws://localhost:3000/ws`
- **协议**: HTTP/1.1, WebSocket
- **序列化格式**:
  - HTTP: JSON
  - WebSocket: MessagePack

### 1.2 错误处理
所有 API 遵循 Fast-Fail 原则，错误直接返回，不做降级处理。

错误响应格式：
```json
{
  "error": "错误描述信息",
  "code": 400
}
```

状态码：
- `200`: 成功
- `400`: 请求参数错误
- `404`: 资源不存在
- `413`: 文件太大
- `500`: 服务器内部错误

## 2. HTTP API

### 2.1 文件上传

**POST** `/api/upload`

上传二进制文件到服务器。

**请求**：
- Content-Type: `multipart/form-data`
- 字段：
  - `file`: 二进制文件（必需）
  - `name`: 文件名（可选）

**限制**：
- 最大文件大小：10GB

**响应**：
```json
{
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "example.bin",
  "size": 1048576
}
```

**错误**：
- `413`: 文件超过 10GB 限制
- `400`: 未提供文件

**示例**：
```javascript
const formData = new FormData();
formData.append('file', file);

const response = await fetch('/api/upload', {
  method: 'POST',
  body: formData
});
```

### 2.2 获取文件信息

**GET** `/api/files/:id`

获取已上传文件的元数据。

**参数**：
- `id`: 文件 ID (UUID)

**响应**：
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "size": 1048576,
  "created": 1704067200
}
```

**错误**：
- `404`: 文件不存在

### 2.3 删除文件

**DELETE** `/api/files/:id`

删除服务器上的文件。

**参数**：
- `id`: 文件 ID (UUID)

**响应**：
```json
{
  "message": "File deleted successfully"
}
```

**错误**：
- `404`: 文件不存在

### 2.4 同步采样

**POST** `/api/sample/:id`

对文件进行采样（同步方式，适合小采样）。

**参数**：
- `id`: 文件 ID (UUID)

**请求体**：
```json
{
  "sample_size": 1048576,  // 采样大小（字节）
  "method": "uniform"       // 采样方法（可选，默认 uniform）
}
```

**响应**：
```json
{
  "data": "base64编码的采样数据",
  "size": 1048576
}
```

**错误**：
- `404`: 文件不存在
- `400`: 采样大小无效（必须 1MB - 128MB）

### 2.5 健康检查

**GET** `/api/health`

检查服务器健康状态。

**响应**：
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### 2.6 获取指标

**GET** `/api/metrics`

获取服务器性能指标。

**响应**：
```json
{
  "requests_total": 12345,
  "bytes_processed": 1073741824,
  "cache_hits": 1000,
  "cache_misses": 500,
  "active_connections": 5,
  "cache_usage": {
    "entries": 10,
    "total_size": 10485760,
    "capacity": 536870912
  }
}
```

## 3. WebSocket API

### 3.1 连接建立

**URL**: `ws://localhost:3000/ws/:file_id`

建立 WebSocket 连接用于流式传输采样数据。

**参数**：
- `file_id`: 文件 ID (UUID)

**连接流程**：
```javascript
const ws = new WebSocket(`ws://localhost:3000/ws/${fileId}`);
ws.binaryType = 'arraybuffer';

ws.onopen = () => {
  console.log('Connected');
};

ws.onerror = (error) => {
  console.error('Connection failed:', error);
};
```

### 3.2 消息格式

所有 WebSocket 消息使用 MessagePack 编码。

**基础消息结构**：
```typescript
interface Message {
  type: 'data' | 'control' | 'error';
  id: string;        // UUID
  timestamp: number; // Unix 时间戳（毫秒）
  payload: any;      // 具体内容
}
```

### 3.3 采样请求

客户端发送采样请求，服务器流式返回数据。

**请求消息**：
```typescript
{
  type: 'control',
  id: '...',
  timestamp: Date.now(),
  payload: {
    command: 'sample',
    params: {
      sample_size: 134217728,  // 128MB
      method: 'uniform'
    }
  }
}
```

**数据响应**（多个）：
```typescript
{
  type: 'data',
  id: '...',
  timestamp: Date.now(),
  payload: {
    offset: 0,         // 数据偏移量
    total: 134217728,  // 总大小
    chunk: Uint8Array  // 数据块（256KB）
  }
}
```

数据会分多个块发送，每块 256KB。客户端需要根据 `offset` 和 `total` 组装完整数据。

### 3.4 支持的控制命令

当前版本仅支持 `sample` 命令，未实现暂停/恢复/停止等流控命令。

**已实现**：
- `sample` - 采样请求

**未实现（预留）**：
- `pause` - 暂停传输
- `resume` - 恢复传输
- `stop` - 停止传输

### 3.5 错误消息

服务器遇到错误时发送错误消息。

```typescript
{
  type: 'error',
  id: '...',
  timestamp: Date.now(),
  payload: {
    code: 404,
    message: 'File not found',
    details: {
      file_id: '...'
    }
  }
}
```

## 4. 使用示例

### 4.1 完整工作流（JavaScript）

```javascript
// 1. 上传文件
async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }

  return await response.json();
}

// 2. 建立 WebSocket 连接
function connectWebSocket(fileId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:3000/ws/${fileId}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => resolve(ws);
    ws.onerror = (err) => reject(err);
  });
}

// 3. 请求采样
async function requestSample(ws, sampleSize) {
  const message = {
    type: 'control',
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    payload: {
      command: 'sample',
      params: {
        sample_size: sampleSize,
        method: 'uniform'
      }
    }
  };

  const packed = msgpack.encode(message);
  ws.send(packed);
}

// 4. 接收数据
function receiveData(ws, onData) {
  const chunks = new Map();
  let totalSize = 0;

  ws.onmessage = (event) => {
    const message = msgpack.decode(new Uint8Array(event.data));

    if (message.type === 'data') {
      const { offset, total, chunk } = message.payload;

      chunks.set(offset, chunk);
      totalSize = total;

      // 检查是否接收完整
      let receivedSize = 0;
      for (const [_, chunk] of chunks) {
        receivedSize += chunk.length;
      }

      if (receivedSize >= totalSize) {
        // 组装完整数据
        const fullData = assembleChunks(chunks, totalSize);
        onData(fullData);
      }
    } else if (message.type === 'error') {
      console.error('Server error:', message.payload);
      throw new Error(message.payload.message);
    }
  };
}

// 5. 完整示例
async function visualizeFile(file) {
  try {
    // 上传文件
    const { file_id } = await uploadFile(file);
    console.log('File uploaded:', file_id);

    // 连接 WebSocket
    const ws = await connectWebSocket(file_id);
    console.log('WebSocket connected');

    // 设置数据接收
    receiveData(ws, (data) => {
      console.log('Received sample:', data.length, 'bytes');
      // 调用渲染函数
      renderer.updateData(data);
    });

    // 请求采样
    await requestSample(ws, 1024 * 1024); // 1MB

  } catch (error) {
    console.error('Visualization failed:', error);
    // Fast-fail: 直接报错，不尝试恢复
    throw error;
  }
}
```

### 4.2 错误处理示例

```javascript
// Fast-fail 错误处理
class ApiClient {
  async request(url, options = {}) {
    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response.json();
      // 直接失败，不重试，不降级
      throw new Error(`API Error ${error.code}: ${error.error}`);
    }

    return response.json();
  }

  handleWebSocketError(error) {
    console.error('WebSocket error:', error);

    // 不自动重连
    // 不使用备用方案
    // 直接通知用户
    showErrorModal({
      title: 'Connection Failed',
      message: error.message,
      action: 'reload' // 仅提供刷新选项
    });

    throw error; // 继续向上传播
  }
}
```

## 5. 性能考虑

### 5.1 限制和配额

| 资源 | 限制 |
|-----|------|
| 最大文件大小 | 10 GB |
| 最大采样大小 | 128 MB |
| WebSocket 消息大小 | 1 MB |
| 数据块大小 | 256 KB |
| 最大并发连接 | 100 |
| 请求超时 | 30 秒 |

### 5.2 缓存策略

- HTTP 采样请求结果缓存 5 分钟
- WebSocket 采样结果在服务器缓存
- 缓存键：`file_id + sample_size`

### 5.3 传输优化

- 使用 MessagePack 减少数据大小（比 JSON 小 30-50%）
- 分块传输避免内存峰值
- 256KB 块大小平衡延迟和吞吐量

## 6. 安全性

### 6.1 输入验证

- 文件 ID 必须是有效的 UUID
- 采样大小必须在 1MB - 128MB 范围内
- 文件名经过清理，防止路径遍历

### 6.2 资源限制

当前版本未实现速率限制，依赖底层 TCP 流控和 Axum 框架的连接管理。

**计划中的限制**：
- 单个连接最多 10 个并发采样请求
- 文件上传速率限制：10 个/分钟
- WebSocket 消息速率限制：100 个/秒

### 6.3 错误信息

错误消息不包含敏感信息：
- 不暴露文件系统路径
- 不暴露内部实现细节
- 不包含堆栈跟踪（生产环境）

## 7. 版本控制

当前版本：`v1.0.0`

未来可能的版本升级：
- 添加 API 版本前缀：`/api/v1/`
- 通过 Header 指定版本：`X-API-Version: 1`
- WebSocket 子协议：`Sec-WebSocket-Protocol: binaryvis-v1`