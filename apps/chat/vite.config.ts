import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const srcEntry = (pkg: string) =>
  fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Consume the workspace packages from SOURCE (not their bundled dist). Vite then
    // sees the real per-file module graph, so React Fast Refresh works per component
    // file instead of bailing on core's mixed-export `dist/index.js` ("ActionHarness
    // export is incompatible"). It also drops the rebuild-dist-then-restart dance —
    // editing core/agui/adapter source hot-reloads directly.
    alias: {
      '@arete-desktop/core': srcEntry('core'),
      '@arete-desktop/agui': srcEntry('agui'),
      '@arete-desktop/adapter-primereact': srcEntry('adapter-primereact'),
    },
    // Single instance of React and the A2UI libs across app + workspace sources, so
    // hooks and the contexts that cross the core→adapter boundary share identity.
    dedupe: ['react', 'react-dom', '@a2ui/react', '@a2ui/web_core'],
  },
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
