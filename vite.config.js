import fs from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function multiPageCleanUrlsPlugin() {
  return {
    name: 'multi-page-clean-urls',
    closeBundle() {
      const pages = ['hakkinda', 'nasil-calisir', 'gizlilik'];
      pages.forEach(p => {
        const nested = resolve(__dirname, `dist/${p}/index.html`);
        const flat = resolve(__dirname, `dist/${p}.html`);
        if (fs.existsSync(nested)) {
          fs.copyFileSync(nested, flat);
        }
      });
    }
  };
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        hakkinda: resolve(__dirname, 'hakkinda/index.html'),
        nasilCalisir: resolve(__dirname, 'nasil-calisir/index.html'),
        gizlilik: resolve(__dirname, 'gizlilik/index.html')
      }
    }
  },
  plugins: [
    multiPageCleanUrlsPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon-32x32.png', 'apple-touch-icon.png', 'icons/*.png', 'brand/*.svg', 'og-image.png'],
      manifest: {
        name: 'Muvazene — Bütçeni Gör, Sonrasını Dengele',
        short_name: 'Muvazene',
        description: 'Kişisel Bütçe ve Nakit Akışı Planlama',
        theme_color: '#356B57',
        background_color: '#F6F5F1',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'tr',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/icons/icon-maskable-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/icons/icon-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/(hakkinda|nasil-calisir|gizlilik)($|\/)/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 yıl
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ]
});
