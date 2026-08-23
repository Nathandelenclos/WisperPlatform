import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client always calls `/api` through a relative path: same origin in production (the
// reverse proxy routes `/api` to the API), development proxy here.
// This file is not part of the typecheck: `@types/node` is not a dependency of the web
// package, so `process` is not typed in it.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Covers `/api/auth/*` (better-auth) and the SSE stream of events.
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
});
