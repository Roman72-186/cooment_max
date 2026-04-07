import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // В dev-режиме проксируем запросы к бэкенду
      '/api': {
        target: 'https://89.169.2.231',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
