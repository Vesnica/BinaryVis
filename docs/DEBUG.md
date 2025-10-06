# BinaryVis 调试指南

## 问题排查步骤

### 1. 检查后端是否正常运行

```bash
cd backend
cargo run --release
```

应该看到：
```
Starting BinaryVis backend server
Configuration: Config { ... }
Server listening on 0.0.0.0:3000
```

测试健康检查：
```bash
curl http://localhost:3000/api/health
```

### 2. 检查前端是否正常启动

```bash
cd frontend
npm install
npm run dev
```

应该看到：
```
VITE v5.x.x  ready in xxx ms
➜  Local:   http://localhost:5173/
```

### 3. 浏览器控制台检查

打开浏览器开发者工具 (F12)，查看：

#### Console 标签页
应该看到的日志：
1. 文件上传后：
   ```
   Uploading file: test.bin
   File uploaded, ID: xxx-xxx-xxx
   ```

2. 点击"开始采样"后：
   ```
   Starting sample, size: 1048576
   WebSocket connected
   Sample request sent
   ```

3. 接收数据时：
   ```
   Received WebSocket message, type: data
   Decoded payload: {offset: 0, total: xxx, chunk: Uint8Array(xxx)}
   Received data chunk: 0 / xxx
   Chunk type: object length: xxx
   Initializing buffer with size: xxx
   ```

4. 完成时：
   ```
   Data transfer complete, calling onData callback
   Received complete data: xxx bytes
   ```

#### Network 标签页
检查网络请求：

1. **文件上传请求**:
   - URL: `http://localhost:3000/api/upload`
   - Method: POST
   - Status: 200
   - Response: `{"file_id":"xxx","filename":"xxx","size":xxx}`

2. **WebSocket 连接**:
   - URL: `ws://localhost:3000/ws/{file_id}`
   - Status: 101 Switching Protocols
   - Messages: 应该看到多条二进制消息

#### Console 警告和错误
常见问题：

1. **No handler registered for message type: xxx**
   - 说明消息类型不匹配
   - 检查后端发送的 `message.type` 是否为 `"data"`

2. **WebSocket not connected**
   - WebSocket 连接失败
   - 检查后端是否运行
   - 检查文件 ID 是否正确

3. **Buffer not initialized**
   - 数据管理器未正确初始化
   - 检查是否收到了第一个数据块

### 4. 后端日志检查

查看 `backend.log` 或控制台输出：

```bash
tail -f backend.log
```

应该看到：
```
INFO WebSocket connected
INFO Received control message: sample
INFO Cache miss for file xxx size xxx
INFO Streaming sample data...
```

### 5. 常见问题修复

#### 问题: 上传文件后按钮仍然禁用
**原因**: 文件上传成功但按钮未启用
**修复**: 已在 main.js:84 修改为 `setButtonEnabled(true)`

#### 问题: 点击采样后无反应
**原因**: WebSocket 连接失败或消息未正确发送
**检查**:
1. 浏览器控制台是否有错误
2. Network 标签是否看到 WebSocket 连接
3. 后端是否收到消息

#### 问题: 收到数据但不显示图像
**原因**:
1. Three.js 渲染器未正确初始化
2. 数据未传递给渲染器
3. 渲染器报错

**检查**:
1. 控制台是否有 Three.js 相关错误
2. 是否看到 "Received complete data" 日志
3. 是否看到 WebGL 相关错误

### 6. 手动测试脚本

创建测试文件：
```bash
# 100 字节
dd if=/dev/urandom of=test_100b.bin bs=100 count=1

# 1KB
dd if=/dev/urandom of=test_1kb.bin bs=1024 count=1

# 100KB
dd if=/dev/urandom of=test_100kb.bin bs=102400 count=1

# 1MB
dd if=/dev/urandom of=test_1mb.bin bs=1048576 count=1
```

### 7. MessagePack 调试

如果怀疑 MessagePack 编解码问题，可以在浏览器控制台测试：

```javascript
import { encode, decode } from '@msgpack/msgpack';

// 测试编码解码
const testData = { type: 'data', payload: new Uint8Array([1,2,3]) };
const encoded = encode(testData);
const decoded = decode(encoded);
console.log(decoded);
```

### 8. 验证采样算法

小文件测试要点：
- 文件 <= 采样大小：应返回完整数据
- window_size 计算：`sqrt(sample_size)` 并向下取整，最小为 1
- windows_count 计算：`sample_size / window_size`
- 如果 windows_count = 0，返回完整数据

### 9. Three.js 渲染检查

在控制台检查渲染器：
```javascript
// 检查渲染器是否存在
console.log(window.renderer);

// 检查点数
console.log(window.renderer.getPointCount());

// 检查 FPS
console.log(window.renderer.getFPS());
```

### 10. 完整测试流程

```bash
# 1. 启动后端
cd backend
cargo run --release &

# 2. 启动前端
cd frontend
npm run dev

# 3. 打开浏览器
# 访问 http://localhost:5173

# 4. 上传文件
# 选择一个二进制文件

# 5. 点击"开始采样"
# 观察控制台输出

# 6. 检查可视化
# 应该看到 3D 点云在旋转
```

## 预期行为

### 小文件 (< 1MB)
- 上传成功，返回 file_id
- 点击采样，WebSocket 连接成功
- 后端返回完整文件数据 (method: "full")
- 前端接收并显示可视化

### 大文件 (> 1MB)
- 上传成功，返回 file_id
- 点击采样，WebSocket 连接成功
- 后端执行采样算法 (method: "uniform")
- 分块传输数据 (每块 256KB)
- 前端组装并显示可视化

## 关键代码位置

- 前端 WebSocket 客户端: `frontend/src/core/WebSocketClient.js`
- 前端数据管理: `frontend/src/core/DataManager.js`
- 前端主逻辑: `frontend/src/main.js`
- 后端采样算法: `backend/src/sampling/uniform.rs`
- 后端 WebSocket: `backend/src/server/websocket.rs`
- 后端消息协议: `backend/src/protocol/messages.rs`
