import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  server: {
    port: 8000,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        editor: resolve(__dirname, 'index.html'),
        phone: resolve(__dirname, 'phone.html')
      }
    }
  }
})
