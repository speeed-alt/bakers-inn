import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: "The Baker's Inn",
        // Home screens truncate at roughly 12 characters.
        short_name: "Baker's Inn",
        description: "Till, daily orders and closing reports for The Baker's Inn",
        theme_color: '#17171a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          // Without a maskable entry Android drops the icon into a white circle
          // and shaves its corners. This one is drawn to be cropped.
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: { port: 5173 },
})
