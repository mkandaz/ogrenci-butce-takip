/**
 * LocalStorage erişim kısıtlamalarına veya kotalarına karşı güvenli sarmalayıcı (SafeStorage)
 * Gizli sekme veya tarayıcı izin engellerinde uygulamanın çökmesini engeller.
 */
export const SafeStorage = {
  memoryFallback: {},
  getItem(key) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch (err) {
      console.warn(`SafeStorage getItem("${key}") hatası:`, err);
    }
    return Object.prototype.hasOwnProperty.call(this.memoryFallback, key)
      ? this.memoryFallback[key]
      : null;
  },
  setItem(key, value) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
        return true;
      }
    } catch (err) {
      console.warn(`SafeStorage setItem("${key}") hatası:`, err);
    }
    this.memoryFallback[key] = String(value);
    return false;
  },
  removeItem(key) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (err) {
      console.warn(`SafeStorage removeItem("${key}") hatası:`, err);
    }
    delete this.memoryFallback[key];
  }
};
