// ============================================================================
// audioCompress.ts  — ffmpeg.wasm edition (locally hosted core)
// ----------------------------------------------------------------------------
// Compresses any audio or video file to a small mono MP3 ready for Deepgram.
// Uses ffmpeg.wasm, which handles every codec / container combination court
// reporters encounter in the wild — MP4 (H.264 or HEVC), M4A (AAC or ALAC),
// MP3, WAV, FLAC, OGG, MOV, WebM, AVI, AIFF, and a dozen others.
//
// Loading strategy
// ────────────────
// The ffmpeg-core JS and WASM files are installed locally as the
// @ffmpeg/core npm package and loaded via Vite's `?url` asset imports.
// Vite serves them at same-origin URLs, which sidesteps every CORS and
// cross-origin-isolation issue that plagues CDN-based loading.
//
// Pipeline:
//     input file (any format) → ffmpeg.wasm → 64 kbps mono MP3 → Deepgram
// ============================================================================

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

// Vite's `?url` suffix tells the bundler to serve these as static assets
// and give us back the URL string at runtime. Same-origin, no CORS.
// Note: @ffmpeg/core 0.12.10 is the single-thread build, which means it
// works without SharedArrayBuffer — the COOP/COEP headers in vite.config.ts
// are still a good idea for forward compatibility but no longer strictly
// required for ffmpeg to load.
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

// Singleton — built lazily on first use, reused thereafter
let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

export interface CompressionResult {
  blob: Blob;
  inputSize: number;
  outputSize: number;
  durationSec: number;
  compressionRatio: number;
}

export interface CompressionProgress {
  phase: 'loading_ffmpeg' | 'reading' | 'compressing' | 'encoding' | 'done';
  percent: number;
  message?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Lazy-load ffmpeg.wasm. Returns the same instance on every call.
// ────────────────────────────────────────────────────────────────────────────
async function getFFmpeg(
  onProgress?: (p: CompressionProgress) => void,
): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    onProgress?.({
      phase: 'loading_ffmpeg',
      percent: 0,
      message: 'Loading audio processor (one-time, ~32 MB)...',
    });

    const ffmpeg = new FFmpeg();

    // Surface ffmpeg's error/warning logs to the browser console
    ffmpeg.on('log', ({ message }) => {
      if (message.includes('Error') || message.includes('error')) {
        console.warn('[ffmpeg]', message);
      }
    });

    onProgress?.({
      phase: 'loading_ffmpeg',
      percent: 30,
      message: 'Initializing audio processor...',
    });

    // coreURL and wasmURL come from Vite's asset pipeline — they point at
    // same-origin URLs and bypass all cross-origin-isolation complications.
    try {
      await ffmpeg.load({ coreURL, wasmURL });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Reset the singleton so a retry can attempt to load again
      ffmpegLoadPromise = null;
      throw new Error(
        `Failed to load audio processor: ${msg}. ` +
        `Check that vite.config.ts has COOP/COEP headers and the dev server was restarted.`,
      );
    }

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return ffmpegLoadPromise;
}

/**
 * Compress an audio or video file to a small mono MP3.
 * Works on every input format ffmpeg supports — essentially everything.
 */
export async function compressAudio(
  file: File,
  onProgress?: (p: CompressionProgress) => void,
): Promise<CompressionResult> {
  const ffmpeg = await getFFmpeg(onProgress);

  // Hook ffmpeg's progress events into our UI progress callback.
  // ffmpeg reports progress as a float 0-1; we map it to the 10-95% band.
  const progressHandler = ({ progress }: { progress: number }) => {
    const safe = Math.max(0, Math.min(1, progress));
    onProgress?.({
      phase: 'compressing',
      percent: 10 + Math.round(safe * 85),
      message: `Compressing audio... ${Math.round(safe * 100)}%`,
    });
  };
  ffmpeg.on('progress', progressHandler);

  try {
    // ── 1. Write the input file into ffmpeg's virtual filesystem ─────────
    onProgress?.({ phase: 'reading', percent: 5, message: 'Reading file...' });
    const inputName = `input${getExtension(file.name) || '.bin'}`;
    const outputName = 'output.mp3';
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    // ── 2. Run ffmpeg ─────────────────────────────────────────────────────
    // Command breakdown:
    //   -i <input>     input file
    //   -vn            disable video (extract audio only — for MP4/MOV)
    //   -ac 1          mix down to mono
    //   -ar 16000      resample to 16 kHz (Deepgram's preferred rate)
    //   -b:a 64k       audio bitrate 64 kbps (plenty for speech)
    //   -f mp3         force MP3 container
    //   -y             overwrite output if it exists
    await ffmpeg.exec([
      '-i', inputName,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '64k',
      '-f', 'mp3',
      '-y',
      outputName,
    ]);

    // ── 3. Read the compressed output ────────────────────────────────────
    onProgress?.({ phase: 'encoding', percent: 95, message: 'Finalizing...' });
    const data = await ffmpeg.readFile(outputName);
    // ffmpeg.wasm may return data backed by SharedArrayBuffer. Copy into a
    // fresh Uint8Array so Blob is happy and memory persists after cleanup.
    const sourceBytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
    const bytes = new Uint8Array(sourceBytes.length);
    bytes.set(sourceBytes);
    const blob = new Blob([bytes], { type: 'audio/mpeg' });

    // ── 4. Probe duration from the MP3 header via a hidden <audio> tag ───
    const durationSec = await probeDuration(blob);

    // ── 5. Clean up the virtual files so memory doesn't grow ─────────────
    try {
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch {
      // Non-fatal — ffmpeg may have already cleaned up
    }

    onProgress?.({ phase: 'done', percent: 100 });

    return {
      blob,
      inputSize: file.size,
      outputSize: blob.size,
      durationSec,
      compressionRatio: file.size / blob.size,
    };
  } finally {
    ffmpeg.off('progress', progressHandler);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function getExtension(filename: string): string {
  const m = filename.match(/\.[^.\\/]+$/);
  return m ? m[0].toLowerCase() : '';
}

/** Read the duration of an MP3 blob via a hidden <audio> element. Fast. */
function probeDuration(blob: Blob): Promise<number> {
  return new Promise(resolve => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const d = isFinite(audio.duration) ? audio.duration : 0;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    audio.src = url;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
