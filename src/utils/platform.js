import { Capacitor } from '@capacitor/core';

/**
 * Checks whether the app is running in a native Capacitor runtime (iOS/Android)
 * vs a standard web browser.
 * @param {object|null} customCapacitor - Optional mock/override for testing
 * @returns {boolean}
 */
export function isNativePlatform(customCapacitor = null) {
  try {
    if (typeof window !== 'undefined' && typeof window.__FORCE_NATIVE_SHELL__ === 'boolean') {
      return window.__FORCE_NATIVE_SHELL__;
    }
    const cap = customCapacitor || (typeof window !== 'undefined' && window.Capacitor) || Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function') {
      return cap.isNativePlatform();
    }
  } catch (err) {
    console.warn('[Platform] isNativePlatform check error:', err);
  }
  return false;
}

/**
 * PWA Service Worker should only be registered in standard web browser environments.
 * In native Capacitor runtime, web assets are bundled locally into the native IPA/APK
 * and Workbox service worker caching could interfere with native packaging and updates.
 * @param {object|null} customCapacitor - Optional mock/override for testing
 * @returns {boolean}
 */
export function shouldRegisterPWA(customCapacitor = null) {
  return !isNativePlatform(customCapacitor);
}

/**
 * Applies or removes the .platform-native CSS class to the document body
 * based on whether native platform mode is active.
 * @param {object|null} customCapacitor - Optional mock/override for testing
 * @returns {boolean} Whether platform-native was applied
 */
export function applyPlatformShellClass(customCapacitor = null) {
  const isNative = isNativePlatform(customCapacitor);
  if (typeof document !== 'undefined') {
    if (document.body) {
      if (isNative) {
        document.body.classList.add('platform-native');
      } else {
        document.body.classList.remove('platform-native');
      }
    }
    if (document.documentElement) {
      if (isNative) {
        document.documentElement.classList.add('platform-native');
      } else {
        document.documentElement.classList.remove('platform-native');
      }
    }
  }
  return isNative;
}
