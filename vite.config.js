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
  build: {
    rollupOptions: {
      output: {
        // Split the dependencies away from the app.
        //
        // As one file, every deploy made all three outlets re-download the
        // Firebase SDK — the great majority of the bundle — over mobile data,
        // to receive a change to a screen. Split out, the libraries keep their
        // content hash across releases and stay in the browser cache, so a
        // normal deploy ships only the app chunk. The libraries change when
        // they are actually upgraded, which is a handful of times a year.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules[\\/](@firebase|firebase|idb)[\\/]/.test(id)) return 'firebase'
          if (/node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'react'
          }
          return undefined
        },
      },
    },
  },
  server: { port: 5173 },
})
