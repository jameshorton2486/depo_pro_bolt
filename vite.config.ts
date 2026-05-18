import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers
// are REQUIRED for ffmpeg.wasm to work. They enable SharedArrayBuffer, which
// ffmpeg uses for its worker threading. Without these headers you'll see
// "SharedArrayBuffer is not defined" errors and ffmpeg.wasm will refuse to load.
//
// For production deployment (Vercel, Netlify, Cloudflare Pages, etc.) you'll
// need to configure the same headers on the host.
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  // ffmpeg.wasm pulls in its own worker scripts at runtime; don't let Vite
  // pre-bundle them.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
