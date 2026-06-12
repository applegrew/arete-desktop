import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The Tauri shell injects the backend origin (window.__ARETE_API_BASE__) and the
  // frontend calls it absolutely, so no /api dev proxy is needed.
  server: {
    port: 5173,
  },
});
