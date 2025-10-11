import { DEFAULT_COLORS } from '../config.js';
import { i18n } from '../i18n/i18n.js';

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
          <h3>${i18n.t('panel.fileInput')}</h3>
          <input type="file" id="file-input" accept="*/*">
          <div id="file-info" class="file-info"></div>
        </div>

        <!-- 采样控制 -->
        <div class="control-group">
          <h3>${i18n.t('panel.samplingSettings')}</h3>
          <label>
            ${i18n.t('panel.sampleSize')}
            <input type="range" id="sample-size"
                   min="1" max="128" value="1" step="1">
            <span id="sample-size-value">1</span>
          </label>
          <button id="sample-button" class="btn-primary" disabled>${i18n.t('panel.startSampling')}</button>
        </div>

        <!-- 可视化类型 -->
        <div class="control-group">
          <h3>${i18n.t('panel.visualizationType')}</h3>
          <div class="radio-group">
            <label>
              <input type="radio" name="vis-type" value="trigram" checked>
              Trigram (3D)
            </label>
          </div>
        </div>

        <!-- 形状选择 -->
        <div class="control-group">
          <h3>${i18n.t('panel.geometryShape')}</h3>
          <div class="button-group">
            <button data-shape="cube" class="shape-btn active">${i18n.t('panel.cube')}</button>
            <button data-shape="cylinder" class="shape-btn">${i18n.t('panel.cylinder')}</button>
            <button data-shape="sphere" class="shape-btn">${i18n.t('panel.sphere')}</button>
          </div>
        </div>

        <!-- 渲染参数 -->
        <div class="control-group">
          <h3>${i18n.t('panel.renderSettings')}</h3>
          <label>
            <input type="checkbox" id="scaled-points" checked>
            ${i18n.t('panel.scalePoints')}
          </label>
          <label>
            ${i18n.t('panel.pointSize')}
            <input type="range" id="point-size"
                   min="0.5" max="5" value="1.5" step="0.1">
            <span id="point-size-value">1.5</span>
          </label>
          <label>
            ${i18n.t('panel.brightness')}
            <input type="range" id="brightness"
                   min="0" max="100" value="50">
            <span id="brightness-value">50</span>
          </label>
        </div>

        <!-- 颜色设置 -->
        <div class="control-group">
          <h3>${i18n.t('panel.colorSettings')}</h3>
          <label>
            ${i18n.t('panel.colorBegin')}
            <input type="color" id="color-begin" value="${DEFAULT_COLORS.BEGIN}">
          </label>
          <label>
            ${i18n.t('panel.colorEnd')}
            <input type="color" id="color-end" value="${DEFAULT_COLORS.END}">
          </label>
          <button id="reset-colors" class="btn-secondary">${i18n.t('panel.resetColors')}</button>
        </div>

        <!-- 状态信息 -->
        <div class="control-group">
          <h3>${i18n.t('panel.status')}</h3>
          <div id="status-info" class="status-info">
            <div>${i18n.t('panel.fps')} <span id="fps">0</span></div>
            <div>${i18n.t('panel.pointCount')} <span id="point-count">0</span></div>
            <div>${i18n.t('panel.progress')} <span id="progress">0%</span></div>
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
        this.updateFileInfo(file);
      }
    });

    // 采样按钮
    const sampleButton = document.getElementById('sample-button');
    sampleButton.addEventListener('click', () => {
      if (this.callbacks.onSample) {
        const sampleSize =
          parseInt(document.getElementById('sample-size').value) *
          1024 *
          1024;
        this.callbacks.onSample(sampleSize);
      }
    });

    // 采样大小
    const sampleSize = document.getElementById('sample-size');
    sampleSize.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      document.getElementById('sample-size-value').textContent = value;
    });

    // 缩放点大小开关
    const scaledPoints = document.getElementById('scaled-points');
    const pointSizeSlider = document.getElementById('point-size');

    scaledPoints.addEventListener('change', (e) => {
      const enabled = e.target.checked;

      // 根据开关状态启用/禁用点大小滑块
      pointSizeSlider.disabled = !enabled;

      if (this.callbacks.onScaledPointsChange) {
        this.callbacks.onScaledPointsChange(enabled);
      }
    });

    // 初始状态：根据复选框状态设置滑块
    pointSizeSlider.disabled = !scaledPoints.checked;

    // 形状切换
    const shapeButtons = document.querySelectorAll('.shape-btn');
    shapeButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const shape = e.target.dataset.shape;

        // 更新按钮状态
        shapeButtons.forEach((b) => b.classList.remove('active'));
        e.target.classList.add('active');

        if (this.callbacks.onShapeChange) {
          this.callbacks.onShapeChange(shape);
        }
      });
    });

    // 点大小
    const pointSize = document.getElementById('point-size');
    pointSize.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      document.getElementById('point-size-value').textContent =
        value.toFixed(1);
      if (this.callbacks.onPointSizeChange) {
        this.callbacks.onPointSizeChange(value);
      }
    });

    // 亮度
    const brightness = document.getElementById('brightness');
    brightness.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      document.getElementById('brightness-value').textContent = value;
      if (this.callbacks.onBrightnessChange) {
        this.callbacks.onBrightnessChange(value / 50);
      }
    });

    // 起始颜色
    const colorBegin = document.getElementById('color-begin');
    colorBegin.addEventListener('input', (e) => {
      const color = e.target.value;
      if (this.callbacks.onColorBeginChange) {
        this.callbacks.onColorBeginChange(color);
      }
    });

    // 结束颜色
    const colorEnd = document.getElementById('color-end');
    colorEnd.addEventListener('input', (e) => {
      const color = e.target.value;
      if (this.callbacks.onColorEndChange) {
        this.callbacks.onColorEndChange(color);
      }
    });

    // 恢复默认颜色
    const resetColors = document.getElementById('reset-colors');
    resetColors.addEventListener('click', () => {
      const defaultColorBegin = DEFAULT_COLORS.BEGIN;
      const defaultColorEnd = DEFAULT_COLORS.END;

      colorBegin.value = defaultColorBegin;
      colorEnd.value = defaultColorEnd;

      if (this.callbacks.onColorBeginChange) {
        this.callbacks.onColorBeginChange(defaultColorBegin);
      }
      if (this.callbacks.onColorEndChange) {
        this.callbacks.onColorEndChange(defaultColorEnd);
      }
    });
  }

  // 注册回调
  on(event, callback) {
    this.callbacks[event] = callback;
  }

  // 更新文件信息
  updateFileInfo(file, uploading = false) {
    const fileInfo = document.getElementById('file-info');
    const sizeMB = (file.size / 1024 / 1024).toFixed(2);

    if (uploading) {
      fileInfo.innerHTML = `
        <div><strong>${file.name}</strong></div>
        <div>${i18n.t('panel.fileSize')} ${sizeMB} MB</div>
        <div style="color: #ffa500;">${i18n.t('file.uploading')}</div>
      `;
    } else {
      fileInfo.innerHTML = `
        <div><strong>${file.name}</strong></div>
        <div>${i18n.t('panel.fileSize')} ${sizeMB} MB</div>
        <div style="color: #4caf50;">${i18n.t('file.ready')}</div>
      `;
    }
  }

  // 更新状态显示
  updateStatus(status) {
    if (status.fps !== undefined) {
      document.getElementById('fps').textContent = status.fps.toFixed(0);
    }
    if (status.pointCount !== undefined) {
      document.getElementById('point-count').textContent =
        status.pointCount.toLocaleString();
    }
    if (status.progress !== undefined) {
      document.getElementById('progress').textContent =
        (status.progress * 100).toFixed(1) + '%';
    }
  }

  // 设置按钮状态
  setButtonEnabled(enabled) {
    const sampleButton = document.getElementById('sample-button');
    sampleButton.disabled = !enabled;
  }
}
