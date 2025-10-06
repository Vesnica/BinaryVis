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
        <p class="error-message">${error.message || error}</p>
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
