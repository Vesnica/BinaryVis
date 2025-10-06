// 动态构建 WebSocket URL（使用与页面相同的 host 和 port，通过 Vite proxy）
const getWsUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host; // 包含端口号
  return `${protocol}//${host}/ws`;
};

export const CONFIG = {
  API_URL: '/api',  // 相对路径，通过 Vite proxy 转发
  WS_URL: getWsUrl(),  // WebSocket 也通过 Vite proxy 转发
  MAX_FILE_SIZE: 10 * 1024 * 1024 * 1024, // 10GB
  MAX_SAMPLE_SIZE: 128 * 1024 * 1024, // 128MB
  DEFAULT_SAMPLE_SIZE: 1 * 1024 * 1024, // 1MB
  CHUNK_SIZE: 256 * 1024, // 256KB
};

// 默认颜色配置
export const DEFAULT_COLORS = {
  BEGIN: '#ff7f00', // 橙色 RGB(255, 127, 0)
  END: '#00c0ff',   // 青色 RGB(0, 192, 255)
  BEGIN_HEX: 0xff7f00,
  END_HEX: 0x00c0ff,
};
