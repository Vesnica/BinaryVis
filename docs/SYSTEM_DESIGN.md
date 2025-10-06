# BinaryVis - 二进制数据 3D 可视化系统设计文档

## 1. 系统概述

BinaryVis 是一个基于 Web 的二进制数据 3D 可视化系统，通过将二进制数据映射到 3D 空间，帮助用户识别数据中的模式和结构。系统采用 Rust 后端 + JavaScript/Three.js 前端架构，支持大文件的实时采样和流式渲染。

### 1.1 核心功能

- **Trigram 三元图可视化**: 将连续 3 字节映射到 3D 坐标
- **Digram 二元图可视化**: 将连续 2 字节映射到 2D 平面
- **实时采样**: 对大文件进行智能降采样（最大 128MB）
- **多种几何形状**: 立方体、圆柱体、球体，支持平滑过渡
- **交互式视角控制**: 自动旋转、轨迹球、自由飞行模式
- **流式传输**: WebSocket 实时数据传输

### 1.2 设计原则

- **Fast-Fail**: 遇到异常直接报错，不做降级处理
- **最小依赖**: 仅使用必要的第三方库
- **高性能**: 支持千万级点云实时渲染
- **简洁架构**: 前后端直连，暂不引入反向代理

## 2. 系统架构

```
┌──────────────────────────────────────────────┐
│              浏览器客户端                      │
├──────────────────────────────────────────────┤
│                                              │
│  ┌─────────────┐     ┌──────────────────┐  │
│  │   控制面板   │     │  3D 渲染引擎      │  │
│  │  (Vanilla)  │────▶│   (Three.js)     │  │
│  └─────────────┘     └──────────────────┘  │
│          │                    ▲              │
│          │                    │              │
│          ▼                    │              │
│  ┌──────────────────────────────────────┐  │
│  │         数据管理层                     │  │
│  │  - ArrayBuffer 管理                   │  │
│  │  - 增量更新队列                       │  │
│  └──────────────────────────────────────┘  │
│                    │                         │
└────────────────────┼─────────────────────────┘
                     │
                WebSocket
                     │
┌────────────────────┼─────────────────────────┐
│                    ▼                         │
│              Rust 后端服务                    │
├──────────────────────────────────────────────┤
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │           HTTP/WebSocket 服务器        │  │
│  │              (axum + tokio)           │  │
│  └─────────────┬────────────────────────┘  │
│                │                             │
│  ┌─────────────▼─────────────┐              │
│  │      文件管理模块          │              │
│  │   - 内存映射 (mmap)       │              │
│  │   - 分块读取              │              │
│  └─────────────┬─────────────┘              │
│                │                             │
│  ┌─────────────▼─────────────┐              │
│  │      采样引擎              │              │
│  │   - UniformSampler         │              │
│  │   - 并行处理 (rayon)      │              │
│  └─────────────┬─────────────┘              │
│                │                             │
│  ┌─────────────▼─────────────┐              │
│  │      内存缓存              │              │
│  │   - LRU Cache              │              │
│  │   - 采样结果缓存          │              │
│  └───────────────────────────┘              │
│                                              │
└──────────────────────────────────────────────┘
```

## 3. 数据流设计

### 3.1 文件上传流程

```
用户选择文件
    │
    ▼
[前端] 读取文件元信息
    │
    ├─> 小文件 (< 10MB): 直接上传
    │       │
    │       ▼
    │   [后端] 接收并缓存完整文件
    │
    └─> 大文件 (>= 10MB): 分块上传
            │
            ▼
        [后端] 流式接收并 mmap 映射
```

### 3.2 采样流程

```
[后端] 接收采样请求
    │
    ▼
检查缓存 (LRU)
    │
    ├─> 命中: 返回缓存结果
    │
    └─> 未命中: 执行采样
            │
            ▼
        计算采样参数
            │
            ├─> window_size = sqrt(sample_size)
            ├─> windows_count = sample_size / window_size
            └─> 随机选择窗口位置
                    │
                    ▼
            并行提取数据 (rayon)
                    │
                    ▼
            组装采样结果
                    │
                    ▼
            更新缓存并返回
```

### 3.3 渲染数据流

```
[后端] 采样完成
    │
    ▼
WebSocket 分块推送 (每块 256KB)
    │
    ▼
[前端] 接收数据块
    │
    ▼
解码并存入 RingBuffer
    │
    ▼
批量更新 GPU Buffer
    │
    ├─> 更新 InstancedBufferAttribute
    ├─> 计算坐标变换
    └─> 触发重新渲染
```

## 4. 性能指标

### 4.1 设计目标

| 指标 | 目标值 | 说明 |
|-----|--------|-----|
| 最大文件大小 | 10 GB | 单文件上传限制 |
| 最大采样大小 | 128 MB | 约 4400 万个点 |
| 默认采样大小 | 1 MB | 约 34 万个点 |
| 目标帧率 | 60 FPS | 中端显卡 (GTX 1660) |
| WebSocket 延迟 | < 100ms | 局域网环境 |
| 采样延迟 | < 500ms | 1GB 文件采样到 1MB |

### 4.2 内存使用

**前端内存占用**：
- 采样数据: 128 MB (最大)
- GPU 缓冲区: ~512 MB (位置 + 颜色 + 索引)
- 应用状态: ~50 MB
- **总计**: < 1 GB

**后端内存占用**：
- 文件映射: 按需分页加载
- LRU 缓存: 512 MB (可配置)
- 连接状态: ~10 MB/连接
- **总计**: < 2 GB (10 个并发连接)

## 5. 错误处理策略

遵循 Fast-Fail 原则：

### 5.1 前端错误处理

```javascript
class ErrorBoundary {
  static handle(error) {
    // 直接显示错误，不尝试恢复
    console.error('Fatal error:', error);

    // 显示错误对话框
    showErrorModal({
      title: 'Visualization Error',
      message: error.message,
      stack: error.stack,
      action: 'reload' // 仅提供刷新选项
    });

    // 停止所有渲染
    renderer.dispose();

    // 不尝试重连或降级
    throw error;
  }
}
```

### 5.2 后端错误处理

```rust
// 使用 Result 类型，错误直接向上传播
pub async fn handle_sample(file: &Path, size: usize) -> Result<Vec<u8>, Error> {
    let file = File::open(file)
        .map_err(|e| Error::FileAccess(e))?; // 不尝试其他路径

    let mmap = unsafe { MmapOptions::new().map(&file) }
        .map_err(|e| Error::MemoryMap(e))?; // 不回退到普通读取

    let sample = sampler.sample(&mmap, size)
        .map_err(|e| Error::Sampling(e))?; // 不使用默认采样

    Ok(sample)
}
```

## 6. 安全性设计

### 6.1 输入验证

- **文件大小限制**: 硬性限制 10GB
- **采样大小限制**: 最大 128MB
- **文件类型检查**: 仅接受二进制文件
- **路径遍历防护**: 严格验证文件路径

### 6.2 资源限制

- **连接数限制**: 最多 100 个并发 WebSocket
- **请求频率限制**: 每秒最多 10 个采样请求
- **内存限制**: 单进程最大 4GB
- **CPU 限制**: 采样任务最多使用 80% CPU

## 7. 可扩展性考虑

### 7.1 未来扩展点

1. **可视化类型**：
   - 添加 N-gram 支持 (N > 3)
   - 熵值热力图
   - 字节频率分布

2. **采样算法**：
   - 重要性采样
   - 自适应采样
   - 基于熵的采样

3. **渲染优化**：
   - LOD (Level of Detail)
   - 八叉树空间划分
   - GPU 计算着色器

### 7.2 模块化设计

每个模块独立实现，通过明确的接口通信：

- **采样器接口**: `trait Sampler`
- **渲染器接口**: `class Renderer`
- **传输协议**: MessagePack over WebSocket
- **缓存接口**: `trait Cache`

## 8. 开发和测试策略

### 8.1 开发阶段

1. **Phase 1**: 核心功能 (2 周)
   - 基础 Rust 服务器
   - 简单文件上传
   - UniformSampler 实现
   - 基础 Three.js 点云渲染

2. **Phase 2**: 实时传输 (1 周)
   - WebSocket 集成
   - 流式数据传输
   - 增量渲染更新

3. **Phase 3**: 交互功能 (1 周)
   - 控制面板 UI
   - 相机控制器
   - 形状变换动画

4. **Phase 4**: 优化和测试 (1 周)
   - 性能优化
   - 错误处理
   - 集成测试

### 8.2 测试策略

- **单元测试**: 采样算法、坐标变换
- **集成测试**: 文件上传、WebSocket 通信
- **性能测试**: 不同文件大小的采样速度
- **渲染测试**: 不同点数的帧率测试
- **压力测试**: 并发连接、大文件处理

## 9. 部署架构

### 9.1 开发环境

```bash
# 前端开发服务器
npm run dev  # Vite dev server at :5173

# 后端开发服务器
cargo run    # Rust server at :3000

# 前端连接到后端
WS_URL=ws://localhost:3000/ws
```

### 9.2 生产部署 (未来)

```yaml
# docker-compose.yml
version: '3.8'
services:
  frontend:
    build: ./frontend
    ports:
      - "80:80"
    environment:
      - API_URL=http://backend:3000

  backend:
    build: ./backend
    ports:
      - "3000:3000"
    volumes:
      - ./uploads:/data/uploads
    environment:
      - MAX_FILE_SIZE=10737418240  # 10GB
      - CACHE_SIZE=536870912        # 512MB
      - MAX_CONNECTIONS=100
```

## 10. 监控和日志

### 10.1 指标收集

- **性能指标**: 帧率、渲染时间、采样时间
- **资源指标**: 内存使用、CPU 使用、缓存命中率
- **业务指标**: 文件处理数、活跃连接数

### 10.2 日志级别

- **ERROR**: 致命错误，需要立即处理
- **WARN**: 异常但可恢复的情况
- **INFO**: 重要业务事件
- **DEBUG**: 详细调试信息

## 附录 A: 技术栈详情

### 前端技术栈
- **构建工具**: Vite 5.x
- **3D 引擎**: Three.js r160+
- **语言**: JavaScript ES2022
- **样式**: 原生 CSS (无框架)

### 后端技术栈
- **语言**: Rust 1.75+
- **异步运行时**: Tokio 1.35+
- **Web 框架**: Axum 0.7+
- **序列化**: MessagePack (rmp-serde)
- **并行处理**: Rayon 1.8+
- **内存映射**: memmap2 0.9+

## 附录 B: 通信协议

### WebSocket 消息格式

```typescript
// TypeScript 定义
interface Message {
  type: 'data' | 'control' | 'error';
  id: string;        // 消息 ID
  timestamp: number; // Unix 时间戳
  payload: any;      // MessagePack 编码
}

// 数据消息
interface DataMessage {
  offset: number;    // 数据偏移
  total: number;     // 总大小
  chunk: Uint8Array; // 数据块
}

// 控制消息
interface ControlMessage {
  command: 'start' | 'stop' | 'pause' | 'resume';
  params?: any;
}

// 错误消息
interface ErrorMessage {
  code: number;
  message: string;
  details?: any;
}
```