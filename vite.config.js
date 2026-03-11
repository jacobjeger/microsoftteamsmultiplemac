import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        settings: resolve(__dirname, 'src/settings/index.html'),
        browser: resolve(__dirname, 'src/browser/index.html'),
        hub: resolve(__dirname, 'src/hub/index.html'),
      },
    },
  },
});
