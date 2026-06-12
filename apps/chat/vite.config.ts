import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The Tauri shell injects the backend origin (window.__ARETE_API_BASE__) and the
  // frontend calls it absolutely, so no /api dev proxy is needed.
  server: {
    port: 5173,
    // The Tauri webview loads a fixed devUrl (:5173). Fail loudly if the port is
    // taken (e.g. an orphaned dev server) instead of silently drifting to 5174,
    // which leaves the window pointed at the wrong/stale vite (blank surfaces).
    strictPort: true,
  },
});
