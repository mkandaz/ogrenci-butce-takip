import './styles/main.css';
import { registerSW } from 'virtual:pwa-register';
import { BudgetStore } from './store/BudgetStore.js';
import { UIManager } from './components/UIManager.js';
import { shouldRegisterPWA } from './utils/platform.js';

// PWA Service Worker Kaydı: Web tarayıcısında aktif, Capacitor yerel iOS ortamında kapalı
let updateSW = null;

if (shouldRegisterPWA()) {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      console.log('[PWA] Yeni bir uygulama sürümü mevcut. Otomatik güncelleniyor...');
    },
    onOfflineReady() {
      console.log('[PWA] Uygulama tamamen çevrimdışı çalışmaya hazır!');
    }
  });

  // Sekme yeniden görünür olduğunda arka planda yeni sürüm kontrolü
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && typeof updateSW === 'function') {
        updateSW();
      }
    });
  }
} else {
  console.info('[PWA] Capacitor yerel platform tespit edildi; Service Worker kaydı atlandı.');
}

// Uygulamayı Başlat
document.addEventListener('DOMContentLoaded', () => {
  const store = new BudgetStore();
  window.app = new UIManager(store);
});
