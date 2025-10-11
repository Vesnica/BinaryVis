import { translations } from './translations.js';

/**
 * 简单的国际化工具类
 */
class I18n {
  constructor() {
    this.currentLanguage = this.detectLanguage();
    console.log('Detected language:', this.currentLanguage);
  }

  /**
   * 检测浏览器语言
   */
  detectLanguage() {
    // 获取浏览器语言
    const browserLang = navigator.language || navigator.userLanguage;

    // 支持的语言列表
    const supportedLanguages = Object.keys(translations);

    // 精确匹配（例如 zh-CN）
    if (supportedLanguages.includes(browserLang)) {
      return browserLang;
    }

    // 模糊匹配（例如 zh 匹配 zh-CN）
    const langPrefix = browserLang.split('-')[0];
    const matchedLang = supportedLanguages.find(lang =>
      lang.startsWith(langPrefix)
    );

    if (matchedLang) {
      return matchedLang;
    }

    // 默认英文
    return 'en';
  }

  /**
   * 获取翻译文本
   * @param {string} key - 翻译键
   * @param {object} params - 可选的参数替换
   * @returns {string} 翻译后的文本
   */
  t(key, params = {}) {
    const langData = translations[this.currentLanguage];
    let text = langData?.[key];

    // 如果当前语言没有翻译，回退到英文
    if (!text && this.currentLanguage !== 'en') {
      text = translations['en'][key];
    }

    // 如果还是没有，返回键本身
    if (!text) {
      console.warn(`Missing translation for key: ${key}`);
      return key;
    }

    // 替换参数
    Object.keys(params).forEach(param => {
      text = text.replace(`{${param}}`, params[param]);
    });

    return text;
  }

  /**
   * 切换语言
   * @param {string} lang - 语言代码
   */
  setLanguage(lang) {
    if (translations[lang]) {
      this.currentLanguage = lang;
      console.log('Language changed to:', lang);
    } else {
      console.warn('Unsupported language:', lang);
    }
  }

  /**
   * 获取当前语言
   */
  getLanguage() {
    return this.currentLanguage;
  }
}

// 导出单例
export const i18n = new I18n();
