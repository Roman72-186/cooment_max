import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // В dev-режиме проксируем запросы к бэкенду
      '/api': {
        target: 'https://sushi-house-39.online',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
