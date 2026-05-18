// ============================================================================
// SimpleTranscribe.tsx
// ----------------------------------------------------------------------------
// A complete, local-first transcription UI in one file.
//
// Flow:
//   1. User drops an audio/video file
//   2. We compress it in-browser (ffmpeg.wasm → 64 kbps 16 kHz mono MP3)
//   3. We POST it directly to Deepgram
//   4. We display the transcript, save it to IndexedDB
//   5. User can label speakers and export to RTF
//
// Everything happens client-side. No server, no Supabase, no edge functions.
// ============================================================================

import { useState, useEffect, useRef } from 'react';
import { compressAudio, formatBytes, type CompressionProgress } from '../lib/audioCompress';
import {
  transcribe,
  parseUtterances,
  DEFAULT_OPTIONS,
  type DeepgramOptions,
} from '../lib/deepgramClient';
import {
  saveJob, getJob, listJobs, deleteJob,
  saveUtterances, getUtterances, updateUtterance,
  type StoredJob, type StoredUtterance,
} from '../lib/localStore';

type Phase = 'idle' | 'compressing' | 'uploading' | 'transcribing' | 'complete' | 'failed';

const ACCEPTED_EXTENSIONS = '.mp3,.mp4,.wav,.flac,.m4a,.mov,.avi,.aac,.ogg,.webm';

interface Props {
  initialKeyterms?: string[];
}

export default function SimpleTranscribe({ initialKeyterms = [] }: Props) {
  // ── UI state ─────────────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // ── Deepgram options (collapsible advanced panel) ───────────────────────
  const [options, setOptions] = useState<DeepgramOptions>({
    ...DEFAULT_OPTIONS,
    keyterms: initialKeyterms,
  });
  const [keytermInput, setKeytermInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(initialKeyterms.length > 0);

  // ── Results ──────────────────────────────────────────────────────────────
  const [currentJob, setCurrentJob] = useState<StoredJob | null>(null);
  const [utterances, setUtterances] = useState<StoredUtterance[]>([]);
  const [recentJobs, setRecentJobs] = useState<StoredJob[]>([]);

  // ── Editing state ────────────────────────────────────────────────────────
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load recent jobs on mount ───────────────────────────────────────────
  useEffect(() => {
    listJobs().then(setRecentJobs).catch(console.error);
  }, []);

  const log = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const reset = () => {
    setFile(null);
    setPhase('idle');
    setProgress(0);
    setStatusMessage('');
    setError(null);
    setLogs([]);
    setCurrentJob(null);
    setUtterances([]);
    setEditingIdx(null);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Main pipeline
  // ──────────────────────────────────────────────────────────────────────────
  const runPipeline = async () => {
    if (!file) return;
    setError(null);
    setLogs([]);
    const jobId = crypto.randomUUID();
    const startTime = Date.now();

    try {
      // ── Step 1: Compress ───────────────────────────────────────────────
      setPhase('compressing');
      log(`[INPUT] ${file.name} (${formatBytes(file.size)})`);
      log(`[COMPRESS] Compressing to 16 kHz mono MP3 (64 kbps)...`);

      const compressed = await compressAudio(file, (p: CompressionProgress) => {
        // compression progress occupies 0-60% of overall pipeline
        setProgress(p.percent * 0.6);
        setStatusMessage(p.message ?? capitalize(p.phase.replace(/_/g, ' ')) + '...');
      });

      log(
        `[COMPRESS] ${formatBytes(compressed.inputSize)} → ${formatBytes(compressed.outputSize)} ` +
        `(${compressed.compressionRatio.toFixed(1)}× smaller, ${compressed.durationSec.toFixed(0)}s of audio)`,
      );

      // ── Step 2: Send to Deepgram ───────────────────────────────────────
      setPhase('transcribing');
      setProgress(65);
      setStatusMessage('Sending to Deepgram...');
      log(`[DEEPGRAM] Uploading ${formatBytes(compressed.outputSize)} to ${options.model}...`);

      const response = await transcribe(compressed.blob, options);
      setProgress(90);

      log(`[DEEPGRAM] Response received — request_id=${response.metadata.request_id}`);
      log(`[DEEPGRAM] Duration ${response.metadata.duration.toFixed(1)}s, channels=${response.metadata.channels}`);

      // ── Step 3: Parse and save ─────────────────────────────────────────
      setStatusMessage('Saving transcript...');
      const parsed = parseUtterances(response);
      const wordCount = parsed.reduce((sum, u) => sum + u.transcript.split(/\s+/).length, 0);
      const speakers = new Set(parsed.map(u => u.speaker_id));

      const job: StoredJob = {
        id: jobId,
        created_at: new Date().toISOString(),
        source_file_name: file.name,
        source_file_size: file.size,
        compressed_size: compressed.outputSize,
        duration_sec: compressed.durationSec,
        status: 'complete',
        phase: 'Complete',
        word_count: wordCount,
        speaker_count: speakers.size,
        deepgram_options: options as unknown as Record<string, unknown>,
        deepgram_request_id: response.metadata.request_id,
        speaker_names: Object.fromEntries(
          [...speakers].map(id => [id, `Speaker ${id}`]),
        ),
      };

      await saveJob(job);
      await saveUtterances(jobId, parsed);

      const stored = await getUtterances(jobId);
      setCurrentJob(job);
      setUtterances(stored);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log(`[DONE] ${parsed.length} utterances, ${wordCount} words, ${speakers.size} speakers — took ${elapsed}s total`);

      setProgress(100);
      setPhase('complete');

      // Refresh the recent jobs list
      listJobs().then(setRecentJobs);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      log(`[ERROR] ${raw}`);

      // Translate common error types into actionable messages
      let msg = raw;
      if (/SharedArrayBuffer is not defined/i.test(raw)) {
        msg =
          'Browser is missing cross-origin isolation. Check that ' +
          'vite.config.ts includes COOP/COEP headers and restart "npm run dev".';
      } else if (/failed to fetch.*ffmpeg/i.test(raw) || /toBlobURL/i.test(raw)) {
        msg = 'Could not download audio processor. Check internet connection and retry.';
      } else if (/Deepgram error 401/i.test(raw)) {
        msg = 'Deepgram rejected the API key. Check VITE_DEEPGRAM_API_KEY in .env.';
      } else if (/Deepgram error 4\d\d/i.test(raw)) {
        msg = `Deepgram rejected the request: ${raw}`;
      }

      setError(msg);
      setPhase('failed');
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Speaker name editing
  // ──────────────────────────────────────────────────────────────────────────
  const updateSpeakerName = async (speakerId: number, name: string) => {
    if (!currentJob) return;
    const updated = {
      ...currentJob,
      speaker_names: { ...currentJob.speaker_names, [speakerId]: name },
    };
    setCurrentJob(updated);
    await saveJob(updated);
  };

  const startEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditText(utterances[idx].corrected_transcript ?? utterances[idx].transcript);
  };

  const saveEdit = async () => {
    if (editingIdx === null || !currentJob) return;
    const u = utterances[editingIdx];
    await updateUtterance(currentJob.id, u.sequence_index, {
      corrected_transcript: editText,
    });
    setUtterances(prev =>
      prev.map((u, i) => (i === editingIdx ? { ...u, corrected_transcript: editText, edited: true } : u)),
    );
    setEditingIdx(null);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Reopen a past job
  // ──────────────────────────────────────────────────────────────────────────
  const reopenJob = async (jobId: string) => {
    const job = await getJob(jobId);
    if (!job) return;
    const utts = await getUtterances(jobId);
    setCurrentJob(job);
    setUtterances(utts);
    setPhase('complete');
    setFile(null);
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm('Delete this transcript permanently?')) return;
    await deleteJob(jobId);
    setRecentJobs(await listJobs());
    if (currentJob?.id === jobId) reset();
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Export to plain text and RTF
  // ──────────────────────────────────────────────────────────────────────────
  const exportText = () => {
    if (!currentJob || utterances.length === 0) return;
    const lines = utterances.map(u => {
      const name = currentJob.speaker_names[u.speaker_id] ?? `Speaker ${u.speaker_id}`;
      const text = u.corrected_transcript ?? u.transcript;
      const ts = formatTime(u.start_time);
      return `[${ts}] ${name}: ${text}`;
    });
    downloadBlob(
      new Blob([lines.join('\n\n')], { type: 'text/plain' }),
      `${currentJob.source_file_name.replace(/\.[^.]+$/, '')}_transcript.txt`,
    );
  };

  const exportRtf = () => {
    if (!currentJob || utterances.length === 0) return;
    const rtf = generateRtf(utterances, currentJob);
    downloadBlob(
      new Blob([rtf], { type: 'application/rtf' }),
      `${currentJob.source_file_name.replace(/\.[^.]+$/, '')}_transcript.rtf`,
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Keyterm management
  // ──────────────────────────────────────────────────────────────────────────
  const addKeyterm = () => {
    const t = keytermInput.trim();
    if (!t || options.keyterms.includes(t)) return;
    setOptions({ ...options, keyterms: [...options.keyterms, t] });
    setKeytermInput('');
  };
  const removeKeyterm = (t: string) => {
    setOptions({ ...options, keyterms: options.keyterms.filter(k => k !== t) });
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────────
  const isProcessing = phase === 'compressing' || phase === 'uploading' || phase === 'transcribing';
  const speakerIds = currentJob ? Object.keys(currentJob.speaker_names).map(Number).sort() : [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-white">DEPO-PRO <span className="text-sky-400">Simple</span></h1>
          <p className="text-sm text-slate-400 mt-1">Local-first deposition transcription · Browser → Deepgram direct · No server required</p>
        </header>

        {initialKeyterms.length > 0 && (
          <div className="mb-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs">
            <span className="text-emerald-400 font-semibold">{initialKeyterms.length} keyterms loaded from Case Intake</span>
            <span className="text-slate-500">({initialKeyterms.slice(0, 4).join(', ')}{initialKeyterms.length > 4 ? '...' : ''})</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Left column: upload + options ──────────────────────────── */}
          <div className="space-y-4">
            {/* Upload box */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-bold text-slate-200 mb-3">1. Audio File</h2>

              <div
                onClick={() => !isProcessing && fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); }}
                onDrop={e => {
                  e.preventDefault();
                  if (isProcessing) return;
                  const dropped = e.dataTransfer.files[0];
                  if (dropped) setFile(dropped);
                }}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${
                  isProcessing
                    ? 'border-slate-800 opacity-50 cursor-not-allowed'
                    : 'border-slate-700 hover:border-sky-500'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_EXTENSIONS}
                  className="hidden"
                  onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); }}
                />
                {file ? (
                  <>
                    <p className="text-sm font-semibold text-sky-400 truncate">{file.name}</p>
                    <p className="text-xs text-slate-500 mt-1">{formatBytes(file.size)}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-slate-300">Drop file here or click to browse</p>
                    <p className="text-xs text-slate-500 mt-1">MP3, MP4, WAV, FLAC, M4A, MOV</p>
                  </>
                )}
              </div>

              {file && !isProcessing && phase !== 'complete' && (
                <button
                  onClick={runPipeline}
                  className="w-full mt-3 py-2.5 bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold rounded-lg"
                >
                  Start Transcription
                </button>
              )}
            </div>

            {/* Advanced options */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between text-sm font-bold text-slate-200"
              >
                2. Deepgram Options
                <span className="text-slate-500">{showAdvanced ? '−' : '+'}</span>
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Model</label>
                    <select
                      value={options.model}
                      onChange={e => setOptions({ ...options, model: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-sm text-slate-200"
                    >
                      <option value="nova-3">Nova-3 (best)</option>
                      <option value="nova-3-medical">Nova-3 Medical</option>
                      <option value="nova-2">Nova-2</option>
                      <option value="nova-2-medical">Nova-2 Medical</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {(['diarize', 'punctuate', 'smart_format', 'utterances', 'filler_words', 'numerals'] as const).map(k => (
                      <label key={k} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={options[k] as boolean}
                          onChange={e => setOptions({ ...options, [k]: e.target.checked })}
                          className="accent-sky-500"
                        />
                        <span className="text-slate-300">{k}</span>
                      </label>
                    ))}
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Key Terms (proper names, jargon)</label>
                    <div className="flex gap-1">
                      <input
                        value={keytermInput}
                        onChange={e => setKeytermInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addKeyterm()}
                        placeholder="Type and Enter"
                        className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
                      />
                      <button onClick={addKeyterm} className="px-2 py-1 bg-slate-800 text-xs rounded text-slate-200">Add</button>
                    </div>
                    {options.keyterms.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {options.keyterms.map(t => (
                          <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-500/10 border border-sky-500/30 rounded text-xs text-sky-300">
                            {t}
                            <button onClick={() => removeKeyterm(t)} className="hover:text-rose-400">×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Recent jobs */}
            {recentJobs.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h2 className="text-sm font-bold text-slate-200 mb-3">Recent Transcripts</h2>
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {recentJobs.map(j => (
                    <div key={j.id} className={`flex items-center gap-2 p-2 rounded text-xs ${currentJob?.id === j.id ? 'bg-sky-500/10 border border-sky-500/30' : 'bg-slate-950 border border-slate-800'}`}>
                      <button onClick={() => reopenJob(j.id)} className="flex-1 text-left min-w-0">
                        <p className="font-semibold text-slate-200 truncate">{j.source_file_name}</p>
                        <p className="text-slate-500 text-[10px]">{j.word_count} words · {new Date(j.created_at).toLocaleString()}</p>
                      </button>
                      <button onClick={() => handleDeleteJob(j.id)} className="text-slate-600 hover:text-rose-400">×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Right column: status / results ─────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            {/* Status bar — visible while processing or on failure */}
            {(isProcessing || phase === 'failed') && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-slate-200">{statusMessage || phase}</span>
                  <span className="text-xs font-mono text-sky-400">{Math.round(progress)}%</span>
                </div>
                <div className="h-2 bg-slate-950 rounded overflow-hidden">
                  <div className={`h-full transition-all ${phase === 'failed' ? 'bg-rose-500' : 'bg-sky-500'}`} style={{ width: `${progress}%` }} />
                </div>

                {error && (
                  <div className="mt-3 bg-rose-500/10 border border-rose-500/30 rounded p-3 text-xs text-rose-300">
                    <p className="font-bold mb-1">Error</p>
                    <p className="font-mono break-all">{error}</p>
                  </div>
                )}

                {logs.length > 0 && (
                  <div className="mt-3 bg-slate-950 border border-slate-800 rounded p-2 max-h-32 overflow-y-auto font-mono text-[10px] text-slate-400 space-y-0.5">
                    {logs.map((l, i) => <div key={i}>{l}</div>)}
                  </div>
                )}
              </div>
            )}

            {/* Results — speaker labels + transcript */}
            {phase === 'complete' && currentJob && (
              <>
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-bold text-emerald-300">Transcript Ready</p>
                    <p className="text-xs text-slate-400">{currentJob.word_count.toLocaleString()} words · {speakerIds.length} speakers · {formatTime(currentJob.duration_sec)}</p>
                  </div>
                  <button onClick={exportText} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 rounded">Export TXT</button>
                  <button onClick={exportRtf} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-xs font-bold text-white rounded">Export RTF</button>
                  <button onClick={reset} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">New</button>
                </div>

                {/* Speaker labels */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                  <h3 className="text-sm font-bold text-slate-200 mb-3">Speaker Labels</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {speakerIds.map(sid => (
                      <div key={sid} className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 font-mono w-12">S{sid}</span>
                        <input
                          value={currentJob.speaker_names[sid] ?? ''}
                          onChange={e => updateSpeakerName(sid, e.target.value)}
                          placeholder={`Speaker ${sid}`}
                          className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Transcript */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                  <h3 className="text-sm font-bold text-slate-200 mb-3">Transcript <span className="text-xs font-normal text-slate-500">(double-click to edit)</span></h3>
                  <div className="space-y-3 max-h-[60vh] overflow-y-auto font-mono text-xs">
                    {utterances.map((u, i) => {
                      const name = currentJob.speaker_names[u.speaker_id] ?? `Speaker ${u.speaker_id}`;
                      const text = u.corrected_transcript ?? u.transcript;
                      const lowConf = u.confidence < 0.8;
                      return (
                        <div key={i} className={`flex gap-3 p-2 rounded ${lowConf ? 'border-l-2 border-amber-500/50' : ''} ${u.edited ? 'bg-sky-500/5' : ''}`}>
                          <div className="w-28 shrink-0">
                            <p className="font-bold text-sky-400 text-[11px]">{name}</p>
                            <p className="text-slate-600 text-[10px]">[{formatTime(u.start_time)}]</p>
                          </div>
                          <div className="flex-1" onDoubleClick={() => startEdit(i)}>
                            {editingIdx === i ? (
                              <div>
                                <textarea
                                  value={editText}
                                  onChange={e => setEditText(e.target.value)}
                                  rows={3}
                                  className="w-full bg-slate-950 border border-sky-500 rounded p-2 text-xs text-slate-200"
                                  autoFocus
                                />
                                <div className="flex gap-2 mt-1">
                                  <button onClick={saveEdit} className="px-2 py-0.5 bg-sky-600 text-xs text-white rounded">Save</button>
                                  <button onClick={() => setEditingIdx(null)} className="px-2 py-0.5 text-xs text-slate-400">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <p className={`leading-relaxed ${lowConf ? 'text-amber-300/90' : 'text-slate-200'}`}>{text}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Idle empty state */}
            {phase === 'idle' && (
              <div className="bg-slate-900 border border-slate-800 border-dashed rounded-xl p-12 text-center">
                <p className="text-sm text-slate-400">Upload a file to begin.</p>
                <p className="text-xs text-slate-600 mt-2">Audio is compressed locally before sending to Deepgram. Nothing is uploaded to any server other than Deepgram's transcription API.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ----------------------------------------------------------------------------
// generateRtf — produces a Q/A-formatted RTF transcript.
// Tab-stops match standard Texas court reporter layout (Q. and A. at 1", body
// at 1.5"). Double-spaced 12-pt Times New Roman.
// ----------------------------------------------------------------------------
function generateRtf(utts: StoredUtterance[], job: StoredJob): string {
  const escape = (text: string): string =>
    text
      .replace(/\\/g, '\\\\')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/[^\x00-\x7F]/g, c => {
        const cp = c.codePointAt(0)!;
        return `\\u${cp >= 32768 ? cp - 65536 : cp}?`;
      });

  const TAB_STOPS = '\\tql\\tx720\\tql\\tx1440\\tql\\tx2160';
  const paraFmt = `\\pard ${TAB_STOPS}\\sl480\\slmult1\\fi0\\li0 `;

  const getRole = (name: string): 'Q' | 'A' | 'OTHER' => {
    const n = name.toUpperCase();
    if (/WITNESS|DEPONENT/.test(n)) return 'A';
    if (/REPORTER|NOTARY|CLERK|OFFICER/.test(n)) return 'OTHER';
    return 'Q';
  };

  const lines: string[] = [];
  // Header
  lines.push(`\\pard\\qc\\sb240\\sa120 {\\b TRANSCRIPT OF ${escape(job.source_file_name.toUpperCase())}}\\par`);
  lines.push(`\\pard\\qc\\sa120 Generated ${escape(new Date(job.created_at).toLocaleString())}\\par`);
  lines.push(`\\pard\\qc\\sb120\\sa120 \\emdash\\emdash\\emdash\\par`);

  // Body
  let prevSpeakerId: number | null = null;
  for (const u of utts) {
    const name = job.speaker_names[u.speaker_id] ?? `Speaker ${u.speaker_id}`;
    const role = getRole(name);
    const text = escape(u.corrected_transcript ?? u.transcript);
    const speakerChanged = u.speaker_id !== prevSpeakerId;
    prevSpeakerId = u.speaker_id;

    if (role === 'OTHER') {
      if (speakerChanged) {
        lines.push(`${paraFmt}{\\b ${escape(name.toUpperCase())}}\\tab ${text}\\par`);
      } else {
        lines.push(`${paraFmt}\\tab\\tab ${text}\\par`);
      }
    } else {
      const marker = role === 'Q' ? 'Q.' : 'A.';
      if (speakerChanged) {
        lines.push(`${paraFmt}\\tab {\\b ${marker}}\\tab ${text}\\par`);
      } else {
        lines.push(`${paraFmt}\\tab\\tab ${text}\\par`);
      }
    }
  }

  return [
    '{\\rtf1\\ansi\\deff0',
    '{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}}',
    '\\paperw12240\\paperh15840\\margl1800\\margr1800\\margt1440\\margb1440',
    '\\f0\\fs24',
    ...lines,
    '}',
  ].join('\n');
}
