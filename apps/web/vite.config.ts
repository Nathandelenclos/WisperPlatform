import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le client appelle toujours `/api` en chemin relatif : même origine en production
// (le reverse proxy route `/api` vers l'API), proxy de développement ici.
// Ce fichier n'est pas inclus dans le typecheck : `@types/node` n'est pas une
// dépendance du paquet web, `process` n'y est donc pas typé.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Inclut `/api/auth/*` (better-auth) et le flux SSE des événements.
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
});
