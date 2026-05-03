import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // fail if port is taken (Electron waits for exactly this port)
  },
  base: './', // required so Electron can load built assets from the filesystem
});

