import { CONFIG } from './config.js';
import { ErrorHandler } from './core/ErrorHandler.js';
import { WebSocketClient } from './core/WebSocketClient.js';
import { DataManager } from './core/DataManager.js';
import { Renderer } from './rendering/Renderer.js';
import { ControlPanel } from './ui/ControlPanel.js';
import './styles/main.css';

class BinaryVisApp {
  constructor() {
    this.fileId = null;
    this.wsClient = null;
    this.dataManager = new DataManager();
    this.renderer = null;
    this.controlPanel = null;
  }

  async init() {
    // 初始化错误处理
    ErrorHandler.init();

    // 初始化渲染器
    const renderContainer = document.getElementById('render-container');
    this.renderer = new Renderer(renderContainer);
    window.renderer = this.renderer;

    // 初始化控制面板
    const controlContainer = document.getElementById('control-panel');
    this.controlPanel = new ControlPanel(controlContainer);

    // 注册控制面板事件
    this.controlPanel.on('onFileSelect', (file) => this.handleFileSelect(file));
    this.controlPanel.on('onSample', (sampleSize) =>
      this.handleSample(sampleSize)
    );
    this.controlPanel.on('onShapeChange', (shape) =>
      this.renderer.setShape(shape)
    );
    this.controlPanel.on('onPointSizeChange', (size) =>
      this.renderer.setPointSize(size)
    );
    this.controlPanel.on('onBrightnessChange', (brightness) =>
      this.renderer.setBrightness(brightness)
    );
    this.controlPanel.on('onColorBeginChange', (color) =>
      this.renderer.setColorBegin(color)
    );
    this.controlPanel.on('onColorEndChange', (color) =>
      this.renderer.setColorEnd(color)
    );
    this.controlPanel.on('onScaledPointsChange', (enabled) =>
      this.renderer.setScaledPoints(enabled)
    );

    // 注册数据管理器回调
    this.dataManager.onData((data) => {
      console.log('Received complete data:', data.length, 'bytes');
      this.renderer.setVisualization('trigram', data);

      // 应用当前的 UI 设置
      const pointSize = parseFloat(document.getElementById('point-size').value);
      const brightness = parseInt(document.getElementById('brightness').value);
      const colorBegin = document.getElementById('color-begin').value;
      const colorEnd = document.getElementById('color-end').value;
      const scaledPoints = document.getElementById('scaled-points').checked;

      // 获取当前选中的形状
      const activeShapeBtn = document.querySelector('.shape-btn.active');
      const shape = activeShapeBtn ? activeShapeBtn.dataset.shape : 'cube';

      // 应用所有设置
      this.renderer.setShape(shape);
      this.renderer.setPointSize(pointSize);
      this.renderer.setBrightness(brightness / 50); // 转换为控制面板期望的格式
      this.renderer.setColorBegin(colorBegin);
      this.renderer.setColorEnd(colorEnd);
      this.renderer.setScaledPoints(scaledPoints);

      this.controlPanel.setButtonEnabled(true);
    });

    // 启动状态更新循环
    this.startStatusUpdate();

    console.log('BinaryVis initialized');
  }

  // 处理文件选择
  async handleFileSelect(file) {
    try {
      console.log('Uploading file:', file.name);

      // 关闭旧的 WebSocket 连接
      if (this.wsClient) {
        this.wsClient.disconnect();
        this.wsClient = null;
      }

      // 清空旧数据
      this.dataManager.clear();

      // 上传文件
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${CONFIG.API_URL}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error);
      }

      const result = await response.json();
      this.fileId = result.file_id;

      console.log('File uploaded, ID:', this.fileId);

      // 文件上传成功，启用采样按钮
      this.controlPanel.setButtonEnabled(true);
    } catch (error) {
      console.error('File upload failed:', error);
      ErrorHandler.handleError(error);
    }
  }

  // 处理采样请求
  async handleSample(sampleSize) {
    if (!this.fileId) {
      alert('请先上传文件');
      return;
    }

    try {
      console.log('Starting sample, size:', sampleSize);
      this.controlPanel.setButtonEnabled(false);

      // 重置数据管理器
      this.dataManager.clear();

      // 建立 WebSocket 连接
      if (!this.wsClient) {
        const wsUrl = `${CONFIG.WS_URL}/${this.fileId}`;
        this.wsClient = new WebSocketClient(wsUrl);
        window.wsClient = this.wsClient;

        // 注册数据消息处理器
        this.wsClient.on('data', (payload) => {
          console.log('Received data chunk:', payload.offset, '/', payload.total);
          console.log('Chunk type:', typeof payload.chunk, 'length:', payload.chunk?.length);

          // 初始化缓冲区
          if (!this.dataManager.buffer) {
            console.log('Initializing buffer with size:', payload.total);
            this.dataManager.initialize(payload.total);
          }

          // 确保 chunk 是 Uint8Array
          const chunk = payload.chunk instanceof Uint8Array
            ? payload.chunk
            : new Uint8Array(payload.chunk);

          // 添加数据块
          const complete = this.dataManager.addChunk(
            payload.offset,
            chunk
          );

          // 更新进度
          this.controlPanel.updateStatus({
            progress: this.dataManager.getProgress(),
          });

          if (complete) {
            console.log('Data transfer complete, calling onData callback');
          }
        });

        await this.wsClient.connect();
        console.log('WebSocket connected');
      }

      // 发送采样请求
      this.wsClient.send('control', {
        command: 'sample',
        params: {
          sample_size: sampleSize,
          method: 'uniform',
        },
      });

      console.log('Sample request sent');
    } catch (error) {
      console.error('Sampling failed:', error);
      this.controlPanel.setButtonEnabled(true);
      ErrorHandler.handleError(error);
    }
  }

  // 启动状态更新
  startStatusUpdate() {
    setInterval(() => {
      this.controlPanel.updateStatus({
        fps: this.renderer.getFPS(),
        pointCount: this.renderer.getPointCount(),
      });
    }, 100);
  }
}

// 启动应用
const app = new BinaryVisApp();
app.init().catch((error) => {
  console.error('Failed to initialize app:', error);
  ErrorHandler.handleError(error);
});
