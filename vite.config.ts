import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ============================================================================
// vite.config.ts
// ----------------------------------------------------------------------------
// The Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers
// enable SharedArrayBuffer, which ffmpeg.wasm needs for its worker threads.
//
// COEP value choice
// ─────────────────
// We use 'credentialless' rather than 'require-corp'. credentialless is more
// permissive — it allows loading cross-origin resources without requiring
// them to opt-in via CORP headers, by silently stripping credentials. This
// matches what bolt.new's WebContainer environment serves, and works equally
// well in standard Vite dev servers and production hosts.
//
// For production deployment (Vercel, Netlify, etc.), configure the same
// two headers on the host.
// ============================================================================

export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  // The @ffmpeg packages contain their own worker scripts that should not be
  // pre-bundled by Vite. @ffmpeg/core is loaded via ?url imports as a static
  // asset, so it must NOT be in optimizeDeps.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  // Tell Vite to treat the ffmpeg-core WASM as an asset, not try to parse it
  assetsInclude: ['**/*.wasm'],
});
