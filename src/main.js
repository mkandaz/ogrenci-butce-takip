import './styles/main.css';
import { registerSW } from 'virtual:pwa-register';
import { BudgetStore } from './store/BudgetStore.js';
import { UIManager } from './components/UIManager.js';

// PWA Service Worker Kaydı (Çevrimdışı Önbellek ve Otomatik Güncelleme)
const updateSW = registerSW({
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

// Uygulamayı Başlat
document.addEventListener('DOMContentLoaded', () => {
  const store = new BudgetStore();
  window.app = new UIManager(store);
});
