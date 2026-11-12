import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // './' makes the build work from any folder, including GitHub Pages.
  base: './',
  // three.js + MediaPipe make one big bundle; that's expected for this app.
  build: { chunkSizeWarningLimit: 2000 },
  server: {
    // Lets you open it from your phone on the same Wi-Fi (camera needs https there, see README).
    host: true,
  },
});
