import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The Tauri shell injects the backend origin (window.__ARETE_API_BASE__) and the
  // frontend calls it absolutely, so no /api dev proxy is needed.
  server: {
    // 5173 (vite's default) is commonly taken by other local apps, so this project
    // uses 5273. Must stay in sync with tauri.conf.json `devUrl`.
    port: 5273,
    // The Tauri webview loads a fixed devUrl (:5273). Fail loudly if the port is
    // taken (e.g. an orphaned dev server) instead of silently drifting to 5274,
    // which leaves the window pointed at the wrong/stale vite (blank surfaces).
    strictPort: true,
  },
});
