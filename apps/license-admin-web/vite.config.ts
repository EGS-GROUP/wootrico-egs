import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Admin panel for the license server. In dev it proxies admin/auth calls to the
// license-server (default port 4000); in prod the license-server serves this
// build at its own origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/admin': { target: 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
