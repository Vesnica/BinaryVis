# BinaryVis

<div align="center">
  <img src="docs/images/BinaryVis.png" alt="BinaryVis 可视化效果" width="800"/>

  **二进制数据 3D 可视化系统**

  使用 Rust 后端 + Three.js 前端实现

  [![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
  [![Rust](https://img.shields.io/badge/rust-1.75%2B-orange.svg)](https://www.rust-lang.org/)
  [![Node](https://img.shields.io/badge/node-18%2B-green.svg)](https://nodejs.org/)
</div>

---

## 项目概述

BinaryVis 是一个基于 Web 的二进制数据 3D 可视化工具，通过将二进制数据映射到 3D 空间，帮助用户识别数据中的模式和结构。

> **灵感来源**: 本项目受 [Veles](https://github.com/codilime/veles) 启发，使用现代 Web 技术栈重新实现了二进制可视化功能。

### 核心功能

- **Trigram 三元图可视化**: 将连续 3 字节映射到 3D 坐标
- **实时采样**: 对大文件进行智能降采样（最大 128MB）
- **多种几何形状**: 立方体、圆柱体、球体，支持平滑过渡
- **流式传输**: WebSocket 实时数据传输
- **高性能渲染**: 支持千万级点云实时渲染

## 技术栈

### 后端
- Rust 1.75+
- Axum 0.7+ (Web 框架)
- Tokio (异步运行时)
- Rayon (并行处理)
- MessagePack (数据序列化)

### 前端
- Vite 5.0 (构建工具)
- Three.js r160+ (3D 渲染)
- JavaScript ES2022
- 原生 CSS

## 项目结构

```
BinaryVis/
├── backend/                 # Rust 后端
│   ├── src/
│   │   ├── main.rs         # 程序入口
│   │   ├── config.rs       # 配置管理
│   │   ├── error.rs        # 错误处理
│   │   ├── core/           # 核心模块
│   │   │   ├── file_manager.rs
│   │   │   ├── cache.rs
│   │   │   └── sampler.rs
│   │   ├── sampling/       # 采样算法
│   │   │   └── uniform.rs
│   │   ├── protocol/       # 通信协议
│   │   │   └── messages.rs
│   │   └── server/         # HTTP/WebSocket 服务器
│   │       ├── routes.rs
│   │       ├── handlers.rs
│   │       └── websocket.rs
│   ├── Cargo.toml
│   └── .env
│
└── frontend/               # 前端应用
    ├── src/
    │   ├── main.js        # 应用入口
    │   ├── config.js      # 配置
    │   ├── core/          # 核心模块
    │   │   ├── DataManager.js
    │   │   ├── WebSocketClient.js
    │   │   └── ErrorHandler.js
    │   ├── rendering/     # 渲染模块
    │   │   ├── Renderer.js
    │   │   ├── TrigramRenderer.js
    │   │   └── Shaders.js
    │   ├── ui/            # UI 组件
    │   │   └── ControlPanel.js
    │   └── styles/
    │       └── main.css
    ├── index.html
    ├── package.json
    └── vite.config.js
```

## 快速开始

### 环境要求

- Rust 1.75+（建议 1.75 或更高版本）
- Node.js 18+
- npm 或 yarn

### 一键启动（推荐）

```bash
# 在项目根目录运行启动脚本
./start.sh
```

启动脚本会自动：
1. 启动后端服务器（后台运行）
2. 安装前端依赖（如果需要）
3. 启动前端开发服务器

前端将在 `http://localhost:5173` 启动（默认会自动在浏览器中打开）

### 手动启动

#### 1. 后端启动

```bash
cd backend

# 创建上传目录
mkdir -p uploads

# 运行后端服务器（开发模式）
cargo run

# 或编译发布版本
cargo build --release
cargo run --release
```

后端服务器将在 `http://0.0.0.0:3000` 启动

#### 2. 前端启动

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端开发服务器将在 `http://localhost:5173` 启动

### 使用方法

1. 打开浏览器访问 `http://localhost:5173`
2. **上传文件**：点击"选择文件"按钮选择要可视化的二进制文件
3. **设置采样大小**：使用滑块调整采样大小（1-128 MB）
4. **开始采样**：点击"开始采样"按钮，等待数据通过 WebSocket 流式传输
5. **查看可视化**：数据加载完成后将自动渲染为 3D 点云
6. **调整显示**：使用控制面板调整可视化参数：
   - **几何形状**：立方体、圆柱体、球体（平滑过渡）
   - **点大小**：调整点的渲染大小
   - **亮度**：控制点的亮度
   - **颜色渐变**：起始和结束颜色
   - **缩放模式**：启用/禁用深度缩放

### 性能说明

- **最大支持 50M 点**：可视化最多支持 5000 万个点
- **实时渲染**：使用 WebGL 实现 GPU 加速渲染
- **流式传输**：WebSocket 分块传输，每块 256KB
- **智能采样**：对大文件自动降采样到指定大小

## 配置

### 后端配置

编辑 `backend/.env` 文件：

```env
PORT=3000
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10737418240      # 10GB
MAX_SAMPLE_SIZE=134217728      # 128MB
CACHE_SIZE=536870912           # 512MB
MAX_CONNECTIONS=100
RUST_LOG=info
```

### 前端配置

编辑 `frontend/src/config.js`：

```javascript
export const CONFIG = {
  API_URL: 'http://localhost:3000/api',
  WS_URL: 'ws://localhost:3000/ws',
  MAX_FILE_SIZE: 10 * 1024 * 1024 * 1024, // 10GB
  MAX_SAMPLE_SIZE: 128 * 1024 * 1024,     // 128MB
  DEFAULT_SAMPLE_SIZE: 1 * 1024 * 1024,   // 1MB
};
```

## API 接口

### HTTP API

- `POST /api/upload` - 上传文件（multipart/form-data）
- `GET /api/files/:id` - 获取文件信息
- `DELETE /api/files/:id` - 删除文件
- `POST /api/sample/:id` - 同步采样（小数据量）
- `GET /api/health` - 健康检查
- `GET /api/metrics` - 获取缓存和性能指标

### WebSocket API

- `ws://localhost:3000/ws/:file_id` - WebSocket 连接
- **消息格式**：使用 MessagePack（Map 格式）编码
- **控制命令**：
  - `sample` - 请求采样数据
- **数据传输**：分块流式传输，每块 256KB

详细 API 文档见 [docs/API_DESIGN.md](docs/API_DESIGN.md)

## 性能指标

| 指标 | 目标值 |
|-----|--------|
| 最大文件大小 | 10 GB |
| 最大采样大小 | 128 MB |
| 目标帧率 | 60 FPS |
| 采样延迟 | < 500ms (1GB → 1MB) |

## 设计原则

- **Fast-Fail**: 遇到异常直接报错，不做降级处理
- **最小依赖**: 仅使用必要的第三方库
- **高性能**: 支持千万级点云实时渲染
- **简洁架构**: 前后端直连，无中间代理

## 故障排查

### 后端问题

1. **端口被占用**: 修改 `.env` 中的 `PORT` 配置
2. **上传目录权限**: 确保 `uploads` 目录可写
3. **依赖缺失**: 运行 `cargo build` 重新安装

### 前端问题

1. **无法连接后端**: 检查后端是否启动，确认 URL 配置
2. **WebSocket 连接失败**: 确认防火墙设置
3. **渲染性能差**: 降低采样大小，检查显卡驱动

## 开发

### 构建生产版本

```bash
# 后端
cd backend
cargo build --release

# 前端
cd frontend
npm run build
```

### 代码格式化

```bash
# Rust
cargo fmt

# JavaScript
npm run format  # 如果配置了 prettier
```

## 许可证

本项目仅用于学习和研究目的。

## 项目特点

### 技术亮点

1. **高性能采样**：
   - 使用 `memmap2` 内存映射大文件，避免全量加载
   - Rayon 并行计算加速采样过程
   - LRU 缓存减少重复计算

2. **流式数据传输**：
   - WebSocket 双向通信
   - MessagePack 二进制序列化（比 JSON 小 30-50%）
   - 256KB 分块传输，平衡延迟和吞吐量

3. **GPU 加速渲染**：
   - 自定义 GLSL 着色器
   - Three.js `BufferGeometry` 高效渲染
   - 加性混合（Additive Blending）实现亮度叠加效果

4. **Fast-Fail 设计**：
   - 遇到错误直接报错，不做降级
   - 简化错误处理逻辑
   - 便于调试和问题定位

### 架构特色

- **前后端分离**：Rust 后端 + JavaScript 前端
- **最小依赖**：仅使用必要的第三方库
- **原生技术栈**：前端不使用框架，使用原生 JavaScript + CSS
- **类型安全**：Rust 提供编译时类型检查

## 相关文档

- [系统设计](docs/SYSTEM_DESIGN.md)
- [后端架构](docs/BACKEND_ARCHITECTURE.md)
- [前端架构](docs/FRONTEND_ARCHITECTURE.md)
- [API 设计](docs/API_DESIGN.md)
- [任务列表](docs/TODO.md)

## 参考项目

本项目的设计灵感来自 [Veles](https://github.com/codilime/veles) - 一个由 CodiLime 开发的开源二进制分析和可视化工具。

### Veles vs BinaryVis 对比

| 特性 | Veles | BinaryVis |
|------|-------|-----------|
| **技术栈** | C++14 + Qt5 + Python3 | Rust + Axum + Three.js |
| **架构** | 桌面应用 | Web 应用 |
| **部署** | 需要安装客户端 | 浏览器访问即可 |
| **渲染引擎** | OpenGL (Qt) | WebGL (Three.js) |
| **数据传输** | 本地文件 | WebSocket 流式传输 |
| **采样算法** | 内置多种算法 | 均匀采样 |
| **可视化类型** | Trigram, Digram, Hex | Trigram (计划扩展) |
| **跨平台** | Windows/Linux/macOS | 任何支持 WebGL 的浏览器 |

### 致谢

感谢 [Veles](https://github.com/codilime/veles) 项目提供的优秀设计思路和可视化理念。BinaryVis 在保持核心可视化原理的同时，采用了更现代的 Web 技术栈，使其更易于部署和使用。
