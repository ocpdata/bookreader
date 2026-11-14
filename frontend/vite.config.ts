import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5500,
    strictPort: true, // el CORS del bucket S3 solo permite este origen
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
})
