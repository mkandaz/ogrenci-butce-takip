import { Capacitor } from '@capacitor/core';

/**
 * Checks whether the app is running in a native Capacitor runtime (iOS/Android)
 * vs a standard web browser.
 * @param {object|null} customCapacitor - Optional mock/override for testing
 * @returns {boolean}
 */
export function isNativePlatform(customCapacitor = null) {
  try {
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
