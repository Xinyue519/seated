import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Real mode (`npm start`): forward API calls to the Go backend.
    // Mock mode never calls /api, so this is unused there.
    proxy: { '/api': process.env.SEATED_API_TARGET ?? 'http://localhost:8080' },
  },
});
