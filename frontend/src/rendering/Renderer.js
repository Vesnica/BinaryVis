import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TrigramRenderer } from './TrigramRenderer.js';

export class Renderer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.activeVisualization = null;
    this.animationId = null;
    this.stats = {
      fps: 0,
      lastTime: performance.now(),
      frames: 0,
    };

    this.init();
  }

  init() {
    // 创建渲染器
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // 性能优先
      alpha: false,
    });

    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    // 创建相机
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100);
    this.camera.position.set(0, 0, 5);

    // 延迟调用 onResize 确保容器尺寸正确
    setTimeout(() => this.onResize(), 0);

    // 创建轨道控制器
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0); // 显式设置旋转中心
    this.controls.enableDamping = true; // 启用阻尼效果
    this.controls.dampingFactor = 0.05;
    // 立方体范围[-1,1]³,对角线半径√3≈1.73,需要留出空间避免穿过相机
    this.controls.minDistance = 1.8; // 略大于√3,防止立方体顶点穿过相机
    this.controls.maxDistance = 6.5; // 与 Veles 一致
    this.controls.autoRotate = true; // 自动旋转
    this.controls.autoRotateSpeed = 1.0; // 旋转速度

    // 严格限制缩放范围，防止越界
    this.controls.enableZoom = true;
    this.controls.zoomSpeed = 1.0;
    this.controls.minZoom = 0; // 不限制缩放比例，只限制距离
    this.controls.maxZoom = Infinity;

    // 监听交互事件,拖动时停止自动旋转
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
    });

    this.controls.addEventListener('end', () => {
      this.controls.autoRotate = true;
    });


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

  // 设置形状
  setShape(shape) {
    if (this.activeVisualization) {
      this.activeVisualization.setShape(shape);
    }
  }

  // 设置点大小
  setPointSize(size) {
    if (this.activeVisualization) {
      this.activeVisualization.setPointSize(size);
    }
  }

  // 设置亮度
  setBrightness(brightness) {
    if (this.activeVisualization) {
      this.activeVisualization.setBrightness(brightness);
    }
  }

  // 设置起始颜色
  setColorBegin(color) {
    if (this.activeVisualization) {
      this.activeVisualization.setColorBegin(color);
    }
  }

  // 设置结束颜色
  setColorEnd(color) {
    if (this.activeVisualization) {
      this.activeVisualization.setColorEnd(color);
    }
  }

  // 设置点大小缩放开关
  setScaledPoints(enabled) {
    if (this.activeVisualization) {
      this.activeVisualization.setScaledPoints(enabled);
    }
  }

  // 开始动画循环
  startAnimation() {
    if (this.animationId) return;

    const animate = () => {
      this.animationId = requestAnimationFrame(animate);

      // 更新控制器
      if (this.controls) {
        this.controls.update();
      }

      if (this.activeVisualization) {
        this.activeVisualization.update();
      }

      this.renderer.render(this.scene, this.camera);

      // 更新 FPS
      this.stats.frames++;
      const currentTime = performance.now();
      if (currentTime >= this.stats.lastTime + 1000) {
        this.stats.fps = Math.round(
          (this.stats.frames * 1000) / (currentTime - this.stats.lastTime)
        );
        this.stats.frames = 0;
        this.stats.lastTime = currentTime;
      }
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

  // 获取 FPS
  getFPS() {
    return this.stats.fps;
  }

  // 获取点数
  getPointCount() {
    if (this.activeVisualization && this.activeVisualization.geometry) {
      const drawRange = this.activeVisualization.geometry.drawRange;
      return drawRange ? drawRange.count : 0;
    }
    return 0;
  }

  // 窗口大小调整
  onResize() {
    const { width, height } = this.container.getBoundingClientRect();

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);

    // 通知可视化对象更新点大小
    if (this.activeVisualization && this.activeVisualization.onResize) {
      this.activeVisualization.onResize(width, height);
    }
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
