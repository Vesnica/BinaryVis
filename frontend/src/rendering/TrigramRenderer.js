import * as THREE from 'three';
import { vertexShader, fragmentShader } from './Shaders.js';
import { DEFAULT_COLORS } from '../config.js';

export class TrigramRenderer {
  constructor(data) {
    this.data = data;
    this.mesh = null;
    this.geometry = null;
    this.material = null;
    this.shape = 'cube'; // cube, cylinder, sphere
    this.targetCyl = 0;
    this.targetSph = 0;
    this.targetPsiz = 1.0; // 目标点大小缩放值
    this.currentPointSize = 1.5; // 缓存当前点大小滑块值
    this.currentBrightness = 1.0; // 缓存当前亮度滑块值

    this.init();
  }

  init() {
    const maxPoints = 50000000; // 5000万点上限

    // 使用普通几何体 (每个点都是独立的,不需要实例化)
    this.geometry = new THREE.BufferGeometry();

    // 点位置属性
    const positions = new Float32Array(maxPoints * 3);
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('instancePosition', positionAttribute);

    // 点在数据中的相对位置 (用于颜色渐变)
    const vPosArray = new Float32Array(maxPoints);
    const vPosAttribute = new THREE.BufferAttribute(vPosArray, 1);
    vPosAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('vPos', vPosAttribute);

    // 临时使用简单材质测试
    const USE_SIMPLE_MATERIAL = false;

    if (USE_SIMPLE_MATERIAL) {
      // 简单材质测试 - 使用标准的 position 属性
      this.material = new THREE.PointsMaterial({
        size: 0.02,
        color: 0xffffff,
        sizeAttenuation: true,
      });
      console.log('Using simple PointsMaterial for testing');

      // 简单材质需要重命名属性为标准的 position
      this.useSimpleMaterial = true;
    } else {
      this.useSimpleMaterial = false;
      // 自定义材质
      this.material = new THREE.ShaderMaterial({
        uniforms: {
          c_cyl: { value: 0.0 },
          c_sph: { value: 0.0 },
          c_psiz: { value: 1.0 }, // 点大小缩放开关: 1.0=开启, 0.0=固定1像素
          pointSizeFactor: { value: 9.0 }, // 默认点大小 (1.5 * 6.0)
          c_brightness: { value: 0.0001 }, // 初始亮度,会在数据加载后重新计算
          c_color_begin: { value: new THREE.Color(DEFAULT_COLORS.BEGIN_HEX) },
          c_color_end: { value: new THREE.Color(DEFAULT_COLORS.END_HEX) },
        },
        vertexShader,
        fragmentShader,
        blending: THREE.AdditiveBlending,
        depthTest: true,  // 启用深度测试,与 Veles 一致
        depthWrite: false, // 不写入深度,允许加性混合
        transparent: true,
      });

    }

    // 创建点云
    this.mesh = new THREE.Points(this.geometry, this.material);

    // 禁用视锥体剔除 - 防止相机靠近时整个点云被错误剔除
    // 这样即使包围球部分在视锥体外，点云仍会渲染，GPU会逐点裁剪
    this.mesh.frustumCulled = false;

    // 初始化数据
    if (this.data) {
      this.updateData(this.data);
    }
  }

  // 更新数据
  updateData(data) {
    const pointCount = Math.floor(data.length / 3);

    // 如果使用简单材质,需要使用标准 position 属性
    if (this.useSimpleMaterial) {
      // 重新创建几何体的 position 属性
      const positions = new Float32Array(pointCount * 3);

      for (let i = 0; i < pointCount; i++) {
        const idx = i * 3;
        // 读取三个字节作为坐标,映射到 [-1, 1] 范围
        positions[idx] = (data[idx] + 0.5) / 256.0 * 2.0 - 1.0;
        positions[idx + 1] = (data[idx + 1] + 0.5) / 256.0 * 2.0 - 1.0;
        positions[idx + 2] = (data[idx + 2] + 0.5) / 256.0 * 2.0 - 1.0;
      }

      this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    } else {
      // 自定义着色器使用 instancePosition
      const positions = this.geometry.attributes.instancePosition.array;
      const vPosArray = this.geometry.attributes.vPos.array;

      for (let i = 0; i < pointCount; i++) {
        const idx = i * 3;

        // 读取三个字节作为坐标 (与 Veles 相同: (byte + 0.5) / 256)
        const x = (data[idx] + 0.5) / 256.0;
        const y = (data[idx + 1] + 0.5) / 256.0;
        const z = (data[idx + 2] + 0.5) / 256.0;

        // 设置位置
        positions[idx] = x;
        positions[idx + 1] = y;
        positions[idx + 2] = z;

        // 设置在数据中的相对位置 (用于颜色渐变)
        vPosArray[i] = i / (pointCount - 1);
      }

      this.geometry.attributes.instancePosition.needsUpdate = true;
      this.geometry.attributes.vPos.needsUpdate = true;
    }

    // 设置绘制范围 (只渲染实际的点数)
    this.geometry.setDrawRange(0, pointCount);

    this.data = data;
  }

  // 设置形状
  setShape(shape) {
    this.shape = shape;

    // 使用 Veles 的方式: c_cyl 和 c_sph 控制插值
    let targetCyl = 0;
    let targetSph = 0;

    switch (shape) {
      case 'cube':
        targetCyl = 0;
        targetSph = 0;
        break;
      case 'cylinder':
        targetCyl = 1;
        targetSph = 0;
        break;
      case 'sphere':
        targetCyl = 0;
        targetSph = 1;
        break;
    }

    this.targetCyl = targetCyl;
    this.targetSph = targetSph;
  }

  // 设置点大小
  setPointSize(size) {
    this.currentPointSize = size; // 缓存滑块值
    if (this.material.uniforms) {
      // 自定义着色器材质
      // Veles 使用: 0.01 * min(width, height)
      // 我们用滑块值作为倍数调整
      const baseSize = this.getBasePointSize();
      this.material.uniforms.pointSizeFactor.value = size * baseSize;
    } else if (this.material.size !== undefined) {
      // 简单材质
      this.material.size = size * 0.01;
    }
  }

  // 获取基础点大小 (基于视口尺寸)
  getBasePointSize() {
    // 从全局 renderer 获取视口尺寸
    const renderer = window.renderer;
    if (renderer && renderer.renderer) {
      const size = new THREE.Vector2();
      renderer.renderer.getSize(size);
      // Veles 使用: 0.01 * min(width, height)
      return 0.01 * Math.min(size.x, size.y);
    }
    // 默认值 (假设 600px 高度)
    return 6.0;
  }

  // 设置亮度
  setBrightness(brightness) {
    this.currentBrightness = brightness; // 缓存滑块值
    if (this.material.uniforms) {
      // 自定义着色器材质
      // brightness 从 ControlPanel 传入,范围 0-2 (value/50)
      // 我们的滑块是 0-100,映射到 25-103 (Veles 范围)
      const brightnessValue = brightness * 50; // 滑块值转为整数 (0-100)
      const brightnessInt = Math.round(brightnessValue * 0.78 + 25); // 映射到 25-103
      const dataSize = this.geometry.drawRange.count || 1;

      // 改进的亮度计算公式：
      // 以1M点为基准，其他数据量使用 x / k^0.7 缩放
      // 其中 x 是基准亮度，k 是相对于1M的倍数
      const baseDataSize = 1000000; // 1M点作为基准
      const baseBrightness = Math.pow(brightnessInt, 3) / baseDataSize;

      const k = dataSize / baseDataSize; // 计算数据量倍数
      let c_brightness = baseBrightness / Math.pow(k, 0.5);

      // 固定点大小模式下，亮度放大2倍（因为固定1像素点更小，需要更高亮度）
      // 使用 targetPsiz 而不是 c_psiz.value，因为后者有平滑过渡延迟
      const isFixedPointSize = this.targetPsiz < 0.5; // targetPsiz接近0表示固定点大小
      if (isFixedPointSize) {
        c_brightness *= 2.0;
      }

      // 限制亮度范围，防止极端情况
      const MIN_BRIGHTNESS = 0.01;  // 最小亮度
      const MAX_BRIGHTNESS = 1.0;    // 最大亮度
      c_brightness = Math.max(MIN_BRIGHTNESS, Math.min(MAX_BRIGHTNESS, c_brightness));

      this.material.uniforms.c_brightness.value = c_brightness;
    } else if (this.material.opacity !== undefined) {
      // 简单材质用透明度模拟亮度
      this.material.opacity = brightness;
      this.material.transparent = true;
    }
  }

  // 窗口大小改变时重新计算点大小
  onResize() {
    // 重新应用点大小 (会重新计算 baseSize)
    this.setPointSize(this.currentPointSize);
  }

  // 更新动画
  update() {
    // 只有自定义着色器材质才有 uniforms
    if (!this.material.uniforms) return;

    // 平滑过渡形状
    if (this.targetCyl !== undefined) {
      const deltaCyl = this.targetCyl - this.material.uniforms.c_cyl.value;
      this.material.uniforms.c_cyl.value += deltaCyl * 0.1;
    }

    if (this.targetSph !== undefined) {
      const deltaSph = this.targetSph - this.material.uniforms.c_sph.value;
      this.material.uniforms.c_sph.value += deltaSph * 0.1;
    }

    // 平滑过渡点大小缩放
    if (this.targetPsiz !== undefined) {
      const deltaPsiz = this.targetPsiz - this.material.uniforms.c_psiz.value;
      this.material.uniforms.c_psiz.value += deltaPsiz * 0.1;
    }
  }

  // 设置旋转速度
  setRotationSpeed(speed) {
    this.rotationSpeed = speed;
  }

  // 设置起始颜色
  setColorBegin(colorHex) {
    if (this.material.uniforms) {
      this.material.uniforms.c_color_begin.value.set(colorHex);
    }
  }

  // 设置结束颜色
  setColorEnd(colorHex) {
    if (this.material.uniforms) {
      this.material.uniforms.c_color_end.value.set(colorHex);
    }
  }

  // 设置点大小缩放开关
  setScaledPoints(enabled) {
    if (this.material.uniforms) {
      // 平滑过渡到目标值
      this.targetPsiz = enabled ? 1.0 : 0.0;

      // 重新计算亮度（因为固定点大小模式需要2倍亮度补偿）
      this.setBrightness(this.currentBrightness);
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
