import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 4101,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4100',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (res && 'writeHead' in res && !res.headersSent) {
              res.writeHead(503, {
                'Content-Type': 'application/json',
              });
              res.end(
                JSON.stringify({
                  error: 'Backend bridge server is unreachable',
                  message:
                    'Could not connect to http://127.0.0.1:4100. Ensure the server is running (run `npm run dev` or `npm run dev:server`).',
                })
              );
            }
          });
        },
      },
    },
  },
});
