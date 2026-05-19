// ============================================================================
// audioCompress.ts  — ffmpeg.wasm edition
// ----------------------------------------------------------------------------
// Compresses any audio or video file to a small mono MP3 ready for Deepgram.
// Uses ffmpeg.wasm, which handles every codec / container combination court
// reporters encounter in the wild — MP4 (H.264 or HEVC), M4A (AAC or ALAC),
// MP3, WAV, FLAC, OGG, MOV, WebM, AVI, AIFF, and a dozen others.
//
// Pipeline:
//     input file (any format)
//       → ffmpeg.wasm
//       → 64 kbps mono MP3 @ 16 kHz
//       → Deepgram
//
// Sizes:
//   1 hour of audio  →  ~30 MB MP3
//   2 hour deposition →  ~60 MB MP3
//   Compared to a 1.3 GB stereo WAV input, that's a 20× reduction.
//
// First-time cost: the WASM binary (~32 MB) is downloaded from a CDN on
// first use, then cached by the browser indefinitely. Subsequent uses load
// from cache in ~1 second.
//
// Module-level singleton: we keep one FFmpeg instance alive across calls so
// the WASM only loads once per page session.
// ============================================================================

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// toBlobURL fetches the CDN file and re-hosts it as a same-origin blob URL.
// This sidesteps any remaining COEP/CORP edge cases by making the script
// appear to come from the same origin, which the worker loader always accepts.
const FFMPEG_CORE_VERSION = '0.12.6';
const FFMPEG_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

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
    const ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
      if (import.meta.env.DEV || /error/i.test(message)) {
        console.log('[ffmpeg]', message);
      }
    });

    onProgress?.({
      phase: 'loading_ffmpeg',
      percent: 0,
      message: 'Downloading audio processor (~32 MB, one-time)...',
    });

    // toBlobURL fetches from CDN and returns a same-origin blob:// URL.
    // The ffmpeg worker loader always accepts same-origin scripts, so this
    // works regardless of COEP policy variant (require-corp or credentialless).
    const [coreURL, wasmURL, workerURL] = await Promise.all([
      toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
      toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
      toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.worker.js`, 'text/javascript'),
    ]);

    onProgress?.({
      phase: 'loading_ffmpeg',
      percent: 80,
      message: 'Initializing audio processor...',
    });

    await ffmpeg.load({ coreURL, wasmURL, workerURL });

    onProgress?.({
      phase: 'loading_ffmpeg',
      percent: 100,
      message: 'Audio processor ready.',
    });

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
  // ffmpeg reports progress as a float 0-1; we map it to the 10-95% band
  // (leaving 0-10 for loading and 95-100 for finalizing).
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
    //   -vn            disable video (extract audio only — important for MP4/MOV)
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
    // ffmpeg.wasm may return data backed by SharedArrayBuffer (its worker
    // memory). Copy into a fresh Uint8Array so the Blob constructor doesn't
    // choke on the SAB type, and so the memory survives if ffmpeg cleans up.
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
    // Detach the progress listener so it doesn't fire on the next run
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
