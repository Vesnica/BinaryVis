# 前端架构设计文档

## 1. 技术栈

### 核心依赖
- **Vite 5.x**: 构建工具和开发服务器
- **Three.js r160+**: 3D 渲染引擎
- **MessagePack**: 二进制数据序列化

### 开发工具
- **JavaScript ES2022**: 不使用 TypeScript，保持简单
- **原生 CSS**: 不引入 CSS 框架
- **原生 DOM API**: 控制面板使用原生 JavaScript

## 2. 项目结构

```
frontend/
├── index.html                  # 入口 HTML
├── package.json               # 项目配置
├── vite.config.js            # Vite 配置
├── node_modules/              # 依赖（gitignore）
├── src/
│   ├── main.js               # 应用入口（BinaryVisApp 类）
│   ├── config.js             # 全局配置
│   ├── core/
│   │   ├── DataManager.js    # 数据管理（分块组装）
│   │   ├── WebSocketClient.js # WebSocket 通信
│   │   └── ErrorHandler.js   # 错误处理
│   ├── rendering/
│   │   ├── Renderer.js       # 主渲染器（Three.js 封装）
│   │   ├── TrigramRenderer.js # Trigram 渲染（点云）
│   │   └── Shaders.js        # 着色器代码（GLSL）
│   ├── ui/
│   │   └── ControlPanel.js   # 控制面板（原生 JS）
│   └── styles/
│       └── main.css          # 全局样式
└── dist/                      # 构建输出（gitignore）
```

## 3. 核心模块设计

### 3.1 数据管理器 (DataManager)

实际实现采用**固定大小缓冲区 + 分块组装**的策略。

```javascript
// src/core/DataManager.js
export class DataManager {
  constructor() {
    this.buffer = null;         // 固定大小的 Uint8Array
    this.receivedSize = 0;      // 已接收字节数
    this.totalSize = 0;         // 总字节数
    this.onDataCallback = null; // 完成回调
  }

  // 初始化缓冲区
  initialize(totalSize) {
    this.buffer = new Uint8Array(totalSize);
    this.totalSize = totalSize;
    this.receivedSize = 0;
  }

  // 添加数据块（从 WebSocket 接收）
  addChunk(offset, chunk) {
    if (!this.buffer) {
      throw new Error('Buffer not initialized');
    }

    // 复制数据块到缓冲区
    this.buffer.set(chunk, offset);
    this.receivedSize += chunk.length;

    // 检查是否接收完整
    if (this.receivedSize >= this.totalSize) {
      if (this.onDataCallback) {
        this.onDataCallback(this.buffer);
      }
      return true; // 传输完成
    }

    return false; // 继续等待
  }

  // 注册数据完成回调
  onData(callback) {
    this.onDataCallback = callback;
  }

  // 获取进度
  getProgress() {
    if (this.totalSize === 0) return 0;
    return (this.receivedSize / this.totalSize) * 100;
  }

  // 清空数据
  clear() {
    this.buffer = null;
    this.receivedSize = 0;
    this.totalSize = 0;
  }
}
```

### 3.2 WebSocket 客户端

实际实现使用 **@msgpack/msgpack** 库进行消息序列化。

```javascript
// src/core/WebSocketClient.js
import { encode as msgpackEncode, decode as msgpackDecode } from '@msgpack/msgpack';

export class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map();
  }

  // 连接服务器
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        resolve();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onmessage = (event) => {
        try {
          // 解码 MessagePack 消息
          const message = msgpackDecode(new Uint8Array(event.data));

          // 再解码嵌套的 payload
          const payload = msgpackDecode(message.payload);

          // 分发到注册的处理器
          const handler = this.handlers.get(message.type);
          if (handler) {
            handler(payload);
          }
        } catch (error) {
          console.error('Message decode error:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.ws = null;
      };
    });
  }

  // 发送消息
  send(type, payload) {
    const message = {
      type,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      payload: msgpackEncode(payload) // 先编码 payload
    };

    const packed = msgpackEncode(message); // 再编码整个消息

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(packed);
    } else {
      throw new Error('WebSocket not connected');
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
}
```

### 3.3 主渲染器

```javascript
// src/rendering/Renderer.js
import * as THREE from 'three';

export class Renderer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = null;
    this.renderer = null;
    this.activeVisualization = null;
    this.animationId = null;

    this.init();
  }

  init() {
    // 创建渲染器
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // 性能优先
      alpha: false
    });

    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    // 创建相机
    this.camera = new THREE.PerspectiveCamera(
      45,
      width / height,
      0.01,
      100
    );
    this.camera.position.set(0, 0, 5);

    // 场景设置
    this.scene.background = new THREE.Color(0x000000);

    // 窗口大小调整
    window.addEventListener('resize', () => this.onResize());
  }

  // 设置可视化类型
  setVisualization(type, data) {
    // 清理旧的可视化
    if (this.activeVisualization) {
      this.activeVisualization.dispose();
      this.scene.remove(this.activeVisualization.mesh);
    }

    // 创建新的可视化
    switch (type) {
      case 'trigram':
        this.activeVisualization = new TrigramRenderer(data);
        break;
      case 'digram':
        this.activeVisualization = new DigramRenderer(data);
        break;
      default:
        throw new Error(`Unknown visualization type: ${type}`);
    }

    this.scene.add(this.activeVisualization.mesh);
    this.startAnimation();
  }

  // 更新数据
  updateData(data) {
    if (!this.activeVisualization) {
      throw new Error('No active visualization');
    }
    this.activeVisualization.updateData(data);
  }

  // 开始动画循环
  startAnimation() {
    if (this.animationId) return;

    const animate = () => {
      this.animationId = requestAnimationFrame(animate);

      if (this.activeVisualization) {
        this.activeVisualization.update();
      }

      this.renderer.render(this.scene, this.camera);
    };

    animate();
  }

  // 停止动画
  stopAnimation() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  // 窗口大小调整
  onResize() {
    const { width, height } = this.container.getBoundingClientRect();

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }

  // 清理资源
  dispose() {
    this.stopAnimation();

    if (this.activeVisualization) {
      this.activeVisualization.dispose();
    }

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
```

### 3.4 Trigram 渲染器

```javascript
// src/rendering/TrigramRenderer.js
import * as THREE from 'three';
import { vertexShader, fragmentShader } from './Shaders.js';

export class TrigramRenderer {
  constructor(data) {
    this.data = data;
    this.mesh = null;
    this.geometry = null;
    this.material = null;
    this.shape = 'cube'; // cube, cylinder, sphere
    this.morphFactor = 0;
    this.targetMorphFactor = 0;

    this.init();
  }

  init() {
    const maxPoints = 50000000; // 5000万点上限

    // 使用实例化几何体
    this.geometry = new THREE.InstancedBufferGeometry();

    // 基础点几何体
    const baseGeometry = new THREE.BufferGeometry();
    baseGeometry.setAttribute('position',
      new THREE.Float32BufferAttribute([0, 0, 0], 3));

    this.geometry.index = baseGeometry.index;
    this.geometry.attributes = baseGeometry.attributes;

    // 实例化属性 - 每个点的位置
    const positions = new Float32Array(maxPoints * 3);
    const positionAttribute = new THREE.InstancedBufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('instancePosition', positionAttribute);

    // 实例化属性 - 每个点的颜色
    const colors = new Float32Array(maxPoints * 3);
    const colorAttribute = new THREE.InstancedBufferAttribute(colors, 3);
    colorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('instanceColor', colorAttribute);

    // 自定义材质
    this.material = new THREE.RawShaderMaterial({
      uniforms: {
        morphFactor: { value: 0 },
        pointSize: { value: 2.0 },
        brightness: { value: 1.0 },
        colorBegin: { value: new THREE.Color(0x0000ff) },
        colorEnd: { value: new THREE.Color(0xff0000) }
      },
      vertexShader,
      fragmentShader,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      transparent: true
    });

    // 创建点云
    this.mesh = new THREE.Points(this.geometry, this.material);

    // 初始化数据
    if (this.data) {
      this.updateData(this.data);
    }
  }

  // 更新数据
  updateData(data) {
    const positions = this.geometry.attributes.instancePosition.array;
    const colors = this.geometry.attributes.instanceColor.array;

    const pointCount = Math.floor(data.length / 3);

    for (let i = 0; i < pointCount; i++) {
      const idx = i * 3;

      // 读取三个字节作为坐标
      const x = data[idx] / 255;
      const y = data[idx + 1] / 255;
      const z = data[idx + 2] / 255;

      // 设置位置
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;

      // 设置颜色（基于位置的渐变）
      const t = i / pointCount;
      colors[idx] = t;
      colors[idx + 1] = 0.5;
      colors[idx + 2] = 1 - t;
    }

    // 更新缓冲区
    this.geometry.attributes.instancePosition.needsUpdate = true;
    this.geometry.attributes.instanceColor.needsUpdate = true;

    // 设置实际渲染的点数
    this.geometry.instanceCount = pointCount;
  }

  // 设置形状
  setShape(shape) {
    this.shape = shape;

    switch (shape) {
      case 'cube':
        this.targetMorphFactor = 0;
        break;
      case 'cylinder':
        this.targetMorphFactor = 1;
        break;
      case 'sphere':
        this.targetMorphFactor = 2;
        break;
    }
  }

  // 更新动画
  update() {
    // 平滑过渡形状
    const delta = this.targetMorphFactor - this.morphFactor;
    this.morphFactor += delta * 0.1;
    this.material.uniforms.morphFactor.value = this.morphFactor;

    // 自动旋转
    if (this.mesh) {
      this.mesh.rotation.y += 0.005;
    }
  }

  // 清理资源
  dispose() {
    if (this.geometry) {
      this.geometry.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
  }
}
```

### 3.5 着色器代码

```javascript
// src/rendering/Shaders.js

export const vertexShader = `
#version 300 es
precision highp float;

in vec3 position;
in vec3 instancePosition;
in vec3 instanceColor;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float morphFactor;
uniform float pointSize;

out vec3 vColor;

const float PI = 3.141592653589793;
const float TAU = PI * 2.0;

vec3 transformCoords(vec3 pos) {
  // 立方体坐标
  vec3 cube = pos * 2.0 - 1.0;

  // 圆柱体坐标
  float angle = pos.x * TAU;
  vec3 cylinder = vec3(
    cos(angle) * pos.y,
    sin(angle) * pos.y,
    pos.z * 2.0 - 1.0
  );

  // 球体坐标
  float theta = pos.x * TAU;
  float phi = pos.y * PI;
  vec3 sphere = vec3(
    sin(phi) * cos(theta),
    sin(phi) * sin(theta),
    cos(phi)
  ) * pos.z;

  // 形状插值
  if (morphFactor < 1.0) {
    return mix(cube, cylinder, morphFactor);
  } else {
    return mix(cylinder, sphere, morphFactor - 1.0);
  }
}

void main() {
  vec3 transformed = transformCoords(instancePosition);
  vec4 mvPosition = modelViewMatrix * vec4(transformed + position, 1.0);

  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = pointSize * (1.0 / -mvPosition.z);

  vColor = instanceColor;
}
`;

export const fragmentShader = `
#version 300 es
precision highp float;

in vec3 vColor;

uniform float brightness;
uniform vec3 colorBegin;
uniform vec3 colorEnd;

out vec4 fragColor;

void main() {
  // 圆形点
  vec2 center = gl_PointCoord - vec2(0.5);
  float dist = length(center);

  if (dist > 0.5) {
    discard;
  }

  // 渐变颜色
  vec3 color = mix(colorBegin, colorEnd, vColor.x);

  // 边缘淡化
  float alpha = 1.0 - smoothstep(0.4, 0.5, dist);

  fragColor = vec4(color * brightness, alpha);
}
`;
```

## 4. UI 控制面板

### 4.1 控制面板结构

```javascript
// src/ui/ControlPanel.js
export class ControlPanel {
  constructor(container) {
    this.container = container;
    this.callbacks = {};
    this.init();
  }

  init() {
    this.container.innerHTML = `
      <div class="control-panel">
        <!-- 文件选择 -->
        <div class="control-group">
          <h3>文件输入</h3>
          <input type="file" id="file-input" accept="*/*">
          <div id="file-info"></div>
        </div>

        <!-- 采样控制 -->
        <div class="control-group">
          <h3>采样设置</h3>
          <label>
            采样大小 (MB):
            <input type="range" id="sample-size"
                   min="1" max="128" value="1" step="1">
            <span id="sample-size-value">1</span>
          </label>
        </div>

        <!-- 可视化类型 -->
        <div class="control-group">
          <h3>可视化类型</h3>
          <div class="radio-group">
            <label>
              <input type="radio" name="vis-type" value="trigram" checked>
              Trigram (3D)
            </label>
            <label>
              <input type="radio" name="vis-type" value="digram">
              Digram (2D)
            </label>
          </div>
        </div>

        <!-- 形状选择 -->
        <div class="control-group">
          <h3>几何形状</h3>
          <div class="button-group">
            <button data-shape="cube" class="active">立方体</button>
            <button data-shape="cylinder">圆柱体</button>
            <button data-shape="sphere">球体</button>
          </div>
        </div>

        <!-- 渲染参数 -->
        <div class="control-group">
          <h3>渲染设置</h3>
          <label>
            点大小:
            <input type="range" id="point-size"
                   min="1" max="10" value="2" step="0.5">
          </label>
          <label>
            亮度:
            <input type="range" id="brightness"
                   min="0" max="100" value="50">
          </label>
        </div>

        <!-- 相机控制 -->
        <div class="control-group">
          <h3>相机模式</h3>
          <div class="button-group">
            <button data-camera="auto" class="active">自动旋转</button>
            <button data-camera="manual">手动控制</button>
            <button data-camera="free">自由飞行</button>
          </div>
        </div>

        <!-- 状态信息 -->
        <div class="control-group">
          <h3>状态</h3>
          <div id="status-info">
            <div>FPS: <span id="fps">0</span></div>
            <div>点数: <span id="point-count">0</span></div>
            <div>内存: <span id="memory">0</span> MB</div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  attachEventListeners() {
    // 文件选择
    const fileInput = document.getElementById('file-input');
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && this.callbacks.onFileSelect) {
        this.callbacks.onFileSelect(file);
      }
    });

    // 采样大小
    const sampleSize = document.getElementById('sample-size');
    sampleSize.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      document.getElementById('sample-size-value').textContent = value;
      if (this.callbacks.onSampleSizeChange) {
        this.callbacks.onSampleSizeChange(value * 1024 * 1024);
      }
    });

    // 其他控件事件绑定...
  }

  // 注册回调
  on(event, callback) {
    this.callbacks[event] = callback;
  }

  // 更新状态显示
  updateStatus(status) {
    if (status.fps !== undefined) {
      document.getElementById('fps').textContent = status.fps.toFixed(1);
    }
    if (status.pointCount !== undefined) {
      document.getElementById('point-count').textContent =
        status.pointCount.toLocaleString();
    }
    if (status.memory !== undefined) {
      document.getElementById('memory').textContent =
        (status.memory / 1024 / 1024).toFixed(1);
    }
  }
}
```

## 5. 错误处理

### 5.1 全局错误处理

```javascript
// src/core/ErrorHandler.js
export class ErrorHandler {
  static init() {
    // 捕获未处理的错误
    window.addEventListener('error', (event) => {
      this.handleError(event.error);
      event.preventDefault();
    });

    // 捕获未处理的 Promise 拒绝
    window.addEventListener('unhandledrejection', (event) => {
      this.handleError(event.reason);
      event.preventDefault();
    });
  }

  static handleError(error) {
    console.error('Fatal error:', error);

    // 停止所有活动
    if (window.renderer) {
      window.renderer.stopAnimation();
    }

    if (window.wsClient) {
      window.wsClient.disconnect();
    }

    // 显示错误对话框
    this.showErrorModal(error);

    // Fast-fail: 不尝试恢复
    throw error;
  }

  static showErrorModal(error) {
    const modal = document.createElement('div');
    modal.className = 'error-modal';
    modal.innerHTML = `
      <div class="error-content">
        <h2>⚠️ 错误</h2>
        <p class="error-message">${error.message}</p>
        <details>
          <summary>详细信息</summary>
          <pre>${error.stack || 'No stack trace available'}</pre>
        </details>
        <button onclick="location.reload()">刷新页面</button>
      </div>
    `;

    document.body.appendChild(modal);
  }
}
```

## 6. 性能优化

### 6.1 渲染优化策略

1. **实例化渲染**: 使用 `InstancedBufferGeometry` 减少 draw call
2. **动态 LOD**: 根据相机距离调整渲染细节
3. **视锥体剔除**: 只渲染可见区域的点
4. **批量更新**: 累积多个数据更新，批量提交到 GPU

### 6.2 内存管理

1. **环形缓冲区**: 固定大小，自动覆盖旧数据
2. **按需加载**: 大文件分块加载
3. **及时释放**: 不再使用的资源立即 dispose

## 7. 开发和调试

### 7.1 开发配置

```javascript
// vite.config.js
export default {
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true
      }
    }
  },
  build: {
    target: 'es2022',
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three']
        }
      }
    }
  }
};
```

### 7.2 调试工具

```javascript
// src/utils/Debug.js
export class Debug {
  static init() {
    if (import.meta.env.DEV) {
      // 性能监控
      this.stats = new Stats();
      document.body.appendChild(this.stats.dom);

      // Three.js 调试
      window.THREE = THREE;

      // 内存监控
      this.memoryMonitor = setInterval(() => {
        if (performance.memory) {
          console.log('Memory:', {
            used: (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
            total: (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
            limit: (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB'
          });
        }
      }, 5000);
    }
  }
}
```

## 8. CSS 样式

```css
/* src/styles/main.css */
:root {
  --bg-primary: #0a0a0a;
  --bg-secondary: #1a1a1a;
  --text-primary: #ffffff;
  --text-secondary: #888888;
  --border-color: #333333;
  --accent-color: #4a9eff;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
}

#app {
  display: flex;
  height: 100vh;
}

/* 控制面板 */
.control-panel {
  width: 300px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  padding: 20px;
  overflow-y: auto;
}

.control-group {
  margin-bottom: 20px;
}

.control-group h3 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
  color: var(--text-secondary);
  text-transform: uppercase;
}

/* 渲染容器 */
#render-container {
  flex: 1;
  position: relative;
}

/* 错误弹窗 */
.error-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.error-content {
  background: var(--bg-secondary);
  padding: 30px;
  border-radius: 8px;
  max-width: 600px;
  max-height: 80vh;
  overflow: auto;
}
```