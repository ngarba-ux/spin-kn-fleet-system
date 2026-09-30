import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Service worker: the app shell loads with no signal, so drivers can
    // reopen the app in the field and keep recording.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png'],
      manifest: {
        name: 'SPIN-KN Fleet',
        short_name: 'SPIN Fleet',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#065f46',
        icons: [{ src: '/logo.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
  ],
});
