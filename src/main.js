import './styles/main.css';
import { registerSW } from 'virtual:pwa-register';
import { BudgetStore } from './store/BudgetStore.js';
import { UIManager } from './components/UIManager.js';

// PWA Service Worker Kaydı (Çevrimdışı Önbellek ve Otomatik Güncelleme)
registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log('Yeni bir uygulama sürümü mevcut. Yenileniyor...');
  },
  onOfflineReady() {
    console.log('Uygulama tamamen çevrimdışı çalışmaya hazır!');
  }
});

// Uygulamayı Başlat
document.addEventListener('DOMContentLoaded', () => {
  const store = new BudgetStore();
  window.app = new UIManager(store);
});
