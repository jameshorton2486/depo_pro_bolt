// audioCompress.ts — bypass mode
// FFmpeg compression is skipped; the original file is returned as-is.
// Deepgram's prerecorded API handles large files natively.

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

export async function compressAudio(
  file: File,
  onProgress?: (p: CompressionProgress) => void,
): Promise<CompressionResult> {
  console.log('[audioCompress] bypass mode — sending original file to Deepgram');
  onProgress?.({ phase: 'done', percent: 100, message: 'Ready.' });
  return {
    blob: file,
    inputSize: file.size,
    outputSize: file.size,
    durationSec: 0,
    compressionRatio: 1,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
