import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ============================================================================
// vite.config.ts
// ----------------------------------------------------------------------------
// The Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers
// are REQUIRED for ffmpeg.wasm to work. They enable SharedArrayBuffer, which
// ffmpeg uses for its worker threading. Without these headers you'll see
// "SharedArrayBuffer is not defined" errors in the console and ffmpeg.wasm
// will refuse to load.
//
// These headers only affect the dev server. For production deployment
// (Vercel, Netlify, Cloudflare Pages, etc.) you'll need to configure the
// same headers on the host — most have a vercel.json / _headers / similar
// config file for this.
// ============================================================================

export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // ffmpeg.wasm pulls in its own worker scripts at runtime; don't let Vite
  // pre-bundle them.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
