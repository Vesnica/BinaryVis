import { CONFIG } from './config.js';
import { ErrorHandler } from './core/ErrorHandler.js';
import { WebSocketClient } from './core/WebSocketClient.js';
import { DataManager } from './core/DataManager.js';
import { Renderer } from './rendering/Renderer.js';
import { ControlPanel } from './ui/ControlPanel.js';
import { i18n } from './i18n/i18n.js';
import './styles/main.css';

class BinaryVisApp {
  constructor() {
    this.fileId = null;
    this.currentFileFingerprint = null; // 当前文件的指纹
    this.wsClient = null;
    this.dataManager = new DataManager();
    this.renderer = null;
    this.controlPanel = null;
  }

  // 简单哈希函数（DJB2 算法）
  hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i); // hash * 33 + c
    }
    // 转换为无符号32位整数，然后转为16进制
    return (hash >>> 0).toString(16);
  }

  // 生成文件指纹（基于文件名哈希、大小、修改时间）
  getFileFingerprint(file) {
    // 对文件名进行哈希，避免特殊字符问题
    const nameHash = this.hashString(file.name);
    // 使用名称哈希、大小和最后修改时间创建唯一标识
    return `${nameHash}_${file.size}_${file.lastModified}`;
  }

  async init() {
    // 初始化错误处理
    ErrorHandler.init();

    // 更新页面标题和语言属性
    document.title = i18n.t('page.title');
    document.documentElement.lang = i18n.getLanguage();
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.content = i18n.t('page.description');
    }

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
      console.log('========== DATA COMPLETE ==========');
      console.log('  Total data size:', data.length, 'bytes');
      console.log('  Updating visualization...');

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

      console.log('  Visualization updated successfully');
      this.controlPanel.setButtonEnabled(true);
    });

    // 启动状态更新循环
    this.startStatusUpdate();

    console.log('BinaryVis initialized');
  }

  // 处理文件选择
  async handleFileSelect(file) {
    try {
      console.log('========== Selecting file:', file.name, '==========');

      // 生成文件指纹
      const fingerprint = this.getFileFingerprint(file);
      console.log('  File fingerprint:', fingerprint);

      // 🔒 立即禁用采样按钮
      this.controlPanel.setButtonEnabled(false);
      this.controlPanel.updateFileInfo(file, true);

      // 关闭旧的 WebSocket 连接
      if (this.wsClient) {
        console.log('  Disconnecting old WebSocket');
        this.wsClient.disconnect();
        this.wsClient = null;
      }

      // 清空旧数据
      this.dataManager.clear();
      console.log('  DataManager cleared');

      // 第一步：检查后端是否已有此文件
      console.log('  Checking if file exists on server...');
      const checkResponse = await fetch(
        `${CONFIG.API_URL}/check?fingerprint=${encodeURIComponent(fingerprint)}`
      );

      if (!checkResponse.ok) {
        throw new Error('Failed to check file fingerprint');
      }

      const checkResult = await checkResponse.json();

      if (checkResult.exists) {
        // 文件已存在，直接使用
        console.log('  ⚡ File already exists on server!');
        console.log('  File ID:', checkResult.file_id);
        console.log('  Skipping upload');

        this.fileId = checkResult.file_id;
        this.currentFileFingerprint = fingerprint;

        // 立即显示已就绪
        this.controlPanel.updateFileInfo(file, false);
        this.controlPanel.setButtonEnabled(true);
        return;
      }

      // 文件不存在，需要上传
      console.log('  File does not exist, uploading...');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('fingerprint', fingerprint);

      const uploadResponse = await fetch(`${CONFIG.API_URL}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json();
        throw new Error(error.error);
      }

      const uploadResult = await uploadResponse.json();
      const oldFileId = this.fileId;
      this.fileId = uploadResult.file_id;
      this.currentFileFingerprint = fingerprint;

      console.log('  ✅ File upload COMPLETE!');
      console.log('  Old file ID:', oldFileId);
      console.log('  NEW file ID:', this.fileId);
      console.log('  File size:', uploadResult.size, 'bytes');

      // 更新文件信息显示为已就绪
      this.controlPanel.updateFileInfo(file, false);

      // 🔓 文件上传成功后，启用采样按钮
      this.controlPanel.setButtonEnabled(true);
      console.log('  Sample button ENABLED - ready to sample');
    } catch (error) {
      console.error('File operation failed:', error);
      // 操作失败时清除文件信息和指纹
      this.currentFileFingerprint = null;
      const fileInfo = document.getElementById('file-info');
      fileInfo.innerHTML = `<div style="color: #f44336;">${i18n.t('file.operationFailed')}</div>`;
      // 失败也要启用按钮，让用户可以重试
      this.controlPanel.setButtonEnabled(true);
      ErrorHandler.handleError(error);
    }
  }

  // 处理采样请求
  async handleSample(sampleSize) {
    if (!this.fileId) {
      alert(i18n.t('file.selectFile'));
      return;
    }

    try {
      console.log('========== Starting SAMPLE ==========');
      console.log('  Sample size:', sampleSize);
      console.log('  Current file ID:', this.fileId);
      this.controlPanel.setButtonEnabled(false);

      // 重置数据管理器
      this.dataManager.clear();
      console.log('  DataManager cleared for sampling');

      // 关闭并重建 WebSocket 连接（确保使用新的 file_id）
      if (this.wsClient) {
        console.log('  Closing existing WebSocket connection');
        this.wsClient.disconnect();
        this.wsClient = null;
      }

      const wsUrl = `${CONFIG.WS_URL}/${this.fileId}`;
      console.log('  Creating WebSocket with URL:', wsUrl);
      this.wsClient = new WebSocketClient(wsUrl);
      window.wsClient = this.wsClient;

      // 注册数据消息处理器
      this.wsClient.on('data', (payload) => {
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
          console.log('Data transfer complete');
        }
      });

      await this.wsClient.connect();
      console.log('WebSocket connected');

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
