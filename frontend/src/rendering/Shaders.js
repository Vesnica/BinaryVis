export const vertexShader = `
precision highp float;

// Three.js 内置变量,无需声明:
// - attribute vec3 position
// - uniform mat4 modelViewMatrix
// - uniform mat4 projectionMatrix

attribute vec3 instancePosition;
attribute float vPos;

uniform float c_cyl;
uniform float c_sph;
uniform float pointSizeFactor;
uniform float c_psiz; // 点大小缩放开关: 0.0=固定大小, 1.0=根据距离缩放

varying float v_pos;
varying float v_factor;

const float TAU = 3.1415926535897932384626433832795 * 2.0;

// 坐标系统转换 (与 Veles 相同)
vec3 apply_coord_system(vec3 vert) {
  vec3 cube_pos = vert * vec3(2.0, 2.0, 2.0) - vec3(1.0, 1.0, 1.0);

  // 圆形坐标 (用于圆柱和球体)
  vec2 a1_pos = vec2(cos(vert.x * TAU), sin(vert.x * TAU));

  // 半圆坐标 (用于球体)
  vec2 a2_pos = vec2(sin(vert.y * TAU / 2.0), cos(vert.y * TAU / 2.0));

  vec3 cylinder_pos = vec3(a1_pos * vert.y, vert.z * 2.0 - 1.0);
  vec3 sphere_pos = vec3(a1_pos * a2_pos.x, a2_pos.y) * vert.z;

  // 插值
  vec3 final_pos = cube_pos * (1.0 - c_cyl - c_sph);
  final_pos += cylinder_pos * c_cyl;
  final_pos += sphere_pos * c_sph;
  return final_pos;
}

void main() {
  v_pos = vPos;

  vec3 transformed = apply_coord_system(instancePosition);
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // 点大小计算 (与 Veles 相同)
  float point_size = pointSizeFactor / gl_Position.w;

  // 限制点大小上限,防止缩放过近时点过大
  const float MAX_POINT_SIZE = 100.0;
  if (point_size > MAX_POINT_SIZE) {
    point_size = MAX_POINT_SIZE;
  }

  // 根据 c_psiz 在固定大小(1.0)和缩放大小之间插值
  // c_psiz = 0.0: 固定1像素
  // c_psiz = 1.0: 根据距离缩放
  point_size = mix(1.0, point_size, c_psiz);

  // 确保点至少可见
  if (point_size < 1.0) {
    gl_PointSize = 1.0;
    v_factor = point_size * point_size;
  } else {
    gl_PointSize = point_size;
    v_factor = 1.0;
  }
}
`;

export const fragmentShader = `
precision highp float;

varying float v_pos;
varying float v_factor;

uniform float c_brightness;
uniform vec3 c_color_begin;
uniform vec3 c_color_end;

void main() {
  // 圆形点,边缘清晰
  vec2 cxy = 2.0 * gl_PointCoord - 1.0;
  float dist = dot(cxy, cxy);

  // 硬边缘,不做抗锯齿淡化
  if (dist > 1.0) {
    discard;
  }

  // 颜色渐变
  vec3 color = v_pos * c_color_end + (1.0 - v_pos) * c_color_begin;

  gl_FragColor = vec4(color, 1.0) * c_brightness * v_factor;
}
`;
