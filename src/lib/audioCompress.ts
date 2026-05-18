// ============================================================================
// audioCompress.ts
// ----------------------------------------------------------------------------
// Compresses any audio/video file to 16 kHz mono 16-bit WAV using only the
// Web Audio API. No ffmpeg.wasm, no SharedArrayBuffer, no special headers.
//
// Why 16 kHz mono?
//   - Deepgram's models are trained at 16 kHz. Higher sample rates buy you
//     nothing for speech recognition.
//   - Mono is fine — depositions are speech, not music.
//   - This shrinks a typical 2-hour stereo WAV from ~1.3 GB to ~230 MB.
//     Plenty of headroom under Deepgram's 2 GB hard limit.
//
// Limits:
//   - decodeAudioData() loads the entire file into RAM. Browser can typically
//     handle source files up to ~500 MB; beyond that, split the file in
//     Audacity first.
// ============================================================================

const TARGET_SAMPLE_RATE = 16000;
const TARGET_CHANNELS = 1;

export interface CompressionResult {
  blob: Blob;
  inputSize: number;
  outputSize: number;
  durationSec: number;
  compressionRatio: number;
}

export interface CompressionProgress {
  phase: 'reading' | 'decoding' | 'resampling' | 'encoding' | 'done';
  percent: number;
}

/**
 * Compress an audio or video file to 16 kHz mono WAV.
 * Returns a Blob ready to send to Deepgram.
 */
export async function compressAudio(
  file: File,
  onProgress?: (p: CompressionProgress) => void,
): Promise<CompressionResult> {
  // ── 1. Read file into memory ──────────────────────────────────────────────
  onProgress?.({ phase: 'reading', percent: 5 });
  const arrayBuffer = await file.arrayBuffer();

  // ── 2. Decode using the platform's built-in decoder ──────────────────────
  // Supports MP3, WAV, M4A, AAC, FLAC (Chrome/Firefox), OGG, and the audio
  // tracks of MP4/MOV containers. Throws if the codec isn't recognized.
  onProgress?.({ phase: 'decoding', percent: 20 });
  const decodeContext = new AudioContext();
  let decodedBuffer: AudioBuffer;
  try {
    decodedBuffer = await decodeContext.decodeAudioData(arrayBuffer);
  } finally {
    // Free the decode context once we have the PCM data
    await decodeContext.close().catch(() => {});
  }

  const durationSec = decodedBuffer.duration;

  // ── 3. Resample to 16 kHz mono using OfflineAudioContext ─────────────────
  onProgress?.({ phase: 'resampling', percent: 50 });
  const targetLength = Math.ceil(durationSec * TARGET_SAMPLE_RATE);
  const offlineContext = new OfflineAudioContext(
    TARGET_CHANNELS,
    targetLength,
    TARGET_SAMPLE_RATE,
  );

  const source = offlineContext.createBufferSource();
  source.buffer = decodedBuffer;

  // If source is stereo, downmix to mono via the channel merger's averaging.
  // OfflineAudioContext with TARGET_CHANNELS=1 handles this automatically when
  // we connect a multi-channel source to a mono destination.
  source.connect(offlineContext.destination);
  source.start(0);

  const resampledBuffer = await offlineContext.startRendering();

  // ── 4. Encode to WAV ──────────────────────────────────────────────────────
  onProgress?.({ phase: 'encoding', percent: 85 });
  const wavBlob = audioBufferToWav(resampledBuffer);

  onProgress?.({ phase: 'done', percent: 100 });

  return {
    blob: wavBlob,
    inputSize: file.size,
    outputSize: wavBlob.size,
    durationSec,
    compressionRatio: file.size / wavBlob.size,
  };
}

// ============================================================================
// audioBufferToWav — encode an AudioBuffer to a 16-bit PCM WAV Blob.
// ----------------------------------------------------------------------------
// The WAV format is dead simple: 44-byte header + raw PCM samples.
// This works for any sample rate / channel count, but we only use 16k mono.
// ============================================================================

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);            // chunk size
  view.setUint16(20, 1, true);             // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);            // bits per sample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channels and convert float32 [-1, 1] → int16 [-32768, 32767]
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(buffer.getChannelData(ch));
  }

  let offset = headerSize;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ============================================================================
// Utility — format bytes for display
// ============================================================================

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
