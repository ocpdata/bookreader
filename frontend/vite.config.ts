import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5500,
    strictPort: true, // el CORS del bucket S3 solo permite este origen
    // changeOrigin: false conserva el Host original (localhost:5500): el backend compara el Origin de las
    // peticiones que cambian datos con el Host, igual que detrás de Nginx en producción.
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
})
