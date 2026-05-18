import { useState, useRef, useCallback, useEffect } from 'react';
import { compressAudio, formatBytes } from '../lib/audioCompress';
import type { CompressionProgress } from '../lib/audioCompress';
import { transcribe, parseUtterances, DEFAULT_OPTIONS } from '../lib/deepgramClient';
import type { DeepgramOptions } from '../lib/deepgramClient';
import {
  saveJob,
  listJobs,
  deleteJob,
  saveUtterances,
  getUtterances,
  updateUtterance,
} from '../lib/localStore';
import type { StoredJob, StoredUtterance } from '../lib/localStore';

// ─── Types ────────────────────────────────────────────────────────────────────

type AppPhase =
  | 'idle'
  | 'compressing'
  | 'transcribing'
  | 'done'
  | 'error';

interface TranscriptState {
  job: StoredJob;
  utterances: StoredUtterance[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LARGE_FILE_WARN_BYTES = 500 * 1024 * 1024; // 500 MB

const SPEAKER_COLORS = [
  'text-sky-300',
  'text-emerald-300',
  'text-amber-300',
  'text-rose-300',
  'text-violet-300',
  'text-teal-300',
  'text-orange-300',
  'text-pink-300',
];

function speakerColor(speakerId: number) {
  return SPEAKER_COLORS[speakerId % SPEAKER_COLORS.length];
}

function defaultSpeakerName(id: number) {
  return `SPEAKER ${id + 1}`;
}

// ─── RTF Export ───────────────────────────────────────────────────────────────

function exportRtf(utterances: StoredUtterance[], speakerNames: Record<number, string>) {
  const lines: string[] = [];
  for (const u of utterances) {
    const name = speakerNames[u.speaker_id] ?? defaultSpeakerName(u.speaker_id);
    const text = (u.corrected_transcript ?? u.transcript).replace(/[\\{}]/g, '\\$&');
    lines.push(`{\\b ${name}:}\\par`);
    lines.push(`${text}\\par\\par`);
  }
  const body = lines.join('\n');
  const rtf = `{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}\\f0\\fs24\n${body}\n}`;
  const blob = new Blob([rtf], { type: 'application/rtf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'transcript.rtf';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-slate-400 mb-1.5">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-sky-500 rounded-full transition-all duration-300"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

interface UtteranceRowProps {
  utterance: StoredUtterance;
  speakerName: string;
  speakerColorClass: string;
  onEdit: (text: string) => void;
  onSpeakerClick: () => void;
}

function UtteranceRow({ utterance, speakerName, speakerColorClass, onEdit, onSpeakerClick }: UtteranceRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  const text = utterance.corrected_transcript ?? utterance.transcript;

  const startEdit = () => {
    setDraft(text);
    setEditing(true);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const commitEdit = () => {
    setEditing(false);
    if (draft.trim() !== text) {
      onEdit(draft.trim());
    }
  };

  const mins = Math.floor(utterance.start_time / 60);
  const secs = Math.floor(utterance.start_time % 60);
  const timestamp = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return (
    <div className="group flex gap-3 py-3 border-b border-slate-800/60 last:border-0">
      <div className="w-10 shrink-0 pt-0.5">
        <span className="text-[10px] font-mono text-slate-600 tabular-nums">{timestamp}</span>
      </div>
      <div className="flex-1 min-w-0">
        <button
          onClick={onSpeakerClick}
          className={`text-xs font-bold tracking-widest uppercase mb-1 hover:opacity-70 transition-opacity ${speakerColorClass}`}
        >
          {speakerName}
        </button>
        {editing ? (
          <textarea
            ref={taRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
              if (e.key === 'Escape') { setEditing(false); }
            }}
            rows={Math.max(2, Math.ceil(draft.length / 80))}
            className="w-full bg-slate-800 border border-sky-500/50 rounded-lg px-3 py-2 text-sm text-slate-100 resize-none focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        ) : (
          <p
            onDoubleClick={startEdit}
            className={`text-sm leading-relaxed text-slate-200 cursor-text select-text ${
              utterance.edited ? 'italic' : ''
            }`}
          >
            {text}
          </p>
        )}
      </div>
      <button
        onClick={startEdit}
        className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300"
        title="Edit utterance"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
        </svg>
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SimpleTranscribe() {
  const [phase, setPhase] = useState<AppPhase>('idle');
  const [compressionProgress, setCompressionProgress] = useState<CompressionProgress | null>(null);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState<TranscriptState | null>(null);
  const [recentJobs, setRecentJobs] = useState<StoredJob[]>([]);
  const [speakerNames, setSpeakerNames] = useState<Record<number, string>>({});
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [showRecent, setShowRecent] = useState(false);
  const [largeFileWarning, setLargeFileWarning] = useState('');
  const [opts, setOpts] = useState<DeepgramOptions>(DEFAULT_OPTIONS);
  const [showOptions, setShowOptions] = useState(false);

  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  // Load recent jobs on mount
  useEffect(() => {
    listJobs().then(setRecentJobs);
  }, []);

  const loadJob = async (job: StoredJob) => {
    const utts = await getUtterances(job.id);
    setTranscript({ job, utterances: utts });
    setSpeakerNames(job.speaker_names ?? {});
    setPhase('done');
    setShowRecent(false);
  };

  const handleFile = useCallback(async (file: File) => {
    setError('');
    setLargeFileWarning('');
    abortRef.current = false;

    if (file.size > LARGE_FILE_WARN_BYTES) {
      setLargeFileWarning(
        `This file is ${formatBytes(file.size)}. Files over 500 MB may fail during browser decoding. ` +
        `If it fails, extract the audio track in Audacity first (File → Export → MP3).`
      );
    }

    // ── Compress ──────────────────────────────────────────────────────────────
    setPhase('compressing');
    setCompressionProgress({ phase: 'reading', percent: 0 });

    let compressed;
    try {
      compressed = await compressAudio(file, p => setCompressionProgress(p));
    } catch (err) {
      setPhase('error');
      setError(`Compression failed: ${String(err)}`);
      return;
    }

    if (abortRef.current) return;

    // ── Transcribe ────────────────────────────────────────────────────────────
    setPhase('transcribing');
    setTranscribeProgress(10);

    // Fake progress while waiting for Deepgram (sync endpoint blocks)
    const ticker = setInterval(() => {
      setTranscribeProgress(p => Math.min(p + 2, 85));
    }, 800);

    let dgResponse;
    try {
      dgResponse = await transcribe(compressed.blob, opts);
    } catch (err) {
      clearInterval(ticker);
      setPhase('error');
      setError(`Transcription failed: ${String(err)}`);
      return;
    }

    clearInterval(ticker);
    setTranscribeProgress(100);

    if (abortRef.current) return;

    // ── Parse & persist ───────────────────────────────────────────────────────
    const parsed = parseUtterances(dgResponse);
    const speakerIds = [...new Set(parsed.map(u => u.speaker_id))].sort((a, b) => a - b);
    const names: Record<number, string> = {};
    for (const id of speakerIds) names[id] = defaultSpeakerName(id);

    const jobId = dgResponse.metadata.request_id ?? crypto.randomUUID();
    const job: StoredJob = {
      id: jobId,
      created_at: new Date().toISOString(),
      source_file_name: file.name,
      source_file_size: file.size,
      compressed_size: compressed.outputSize,
      duration_sec: compressed.durationSec,
      status: 'complete',
      phase: 'Complete',
      word_count: parsed.reduce((n, u) => n + u.transcript.split(/\s+/).length, 0),
      speaker_count: speakerIds.length,
      speaker_names: names,
      deepgram_options: opts as unknown as Record<string, unknown>,
      deepgram_request_id: dgResponse.metadata.request_id,
    };

    const stored = parsed.map(u => ({ ...u, job_id: jobId } as StoredUtterance));

    await saveJob(job);
    await saveUtterances(jobId, parsed);

    setSpeakerNames(names);
    setTranscript({ job, utterances: stored });
    setPhase('done');
    setRecentJobs(await listJobs());
  }, [opts]);

  // Drag & drop
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  const handleUtteranceEdit = async (jobId: string, seqIdx: number, text: string) => {
    await updateUtterance(jobId, seqIdx, { corrected_transcript: text });
    setTranscript(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        utterances: prev.utterances.map(u =>
          u.sequence_index === seqIdx
            ? { ...u, corrected_transcript: text, edited: true }
            : u
        ),
      };
    });
  };

  const commitSpeakerRename = async () => {
    if (renamingId === null) return;
    const name = renameDraft.trim() || defaultSpeakerName(renamingId);
    const next = { ...speakerNames, [renamingId]: name };
    setSpeakerNames(next);
    setRenamingId(null);

    if (transcript) {
      const updated: StoredJob = { ...transcript.job, speaker_names: next };
      await saveJob(updated);
      setTranscript(prev => prev ? { ...prev, job: updated } : prev);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    await deleteJob(jobId);
    setRecentJobs(await listJobs());
    if (transcript?.job.id === jobId) {
      setTranscript(null);
      setPhase('idle');
    }
  };

  const resetToIdle = () => {
    abortRef.current = true;
    setPhase('idle');
    setTranscript(null);
    setCompressionProgress(null);
    setTranscribeProgress(0);
    setError('');
    setLargeFileWarning('');
    setSpeakerNames({});
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col min-h-0">

      {/* Toolbar */}
      {phase === 'done' && transcript && (
        <div className="bg-slate-900/60 border-b border-slate-800/60 px-6 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-200 truncate">{transcript.job.source_file_name}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {transcript.utterances.length} utterances &middot; {transcript.job.speaker_count} speaker{transcript.job.speaker_count !== 1 ? 's' : ''} &middot; {formatBytes(transcript.job.compressed_size)} compressed
            </p>
          </div>
          <button
            onClick={() => exportRtf(transcript.utterances, speakerNames)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors border border-slate-700/60"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            Export RTF
          </button>
          <button
            onClick={resetToIdle}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors border border-slate-700/60"
          >
            New File
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* Left sidebar — speaker labels (only when transcript is loaded) */}
        {phase === 'done' && transcript && (
          <div className="w-56 shrink-0 bg-slate-900/40 border-r border-slate-800/60 p-4 overflow-y-auto">
            <p className="text-[10px] font-bold tracking-widest uppercase text-slate-500 mb-3">Speakers</p>
            <div className="flex flex-col gap-2">
              {[...new Set(transcript.utterances.map(u => u.speaker_id))].sort().map(id => {
                const name = speakerNames[id] ?? defaultSpeakerName(id);
                return (
                  <div key={id} className="group">
                    {renamingId === id ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={e => setRenameDraft(e.target.value)}
                        onBlur={commitSpeakerRename}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitSpeakerRename();
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className="w-full bg-slate-800 border border-sky-500/50 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                    ) : (
                      <button
                        onClick={() => { setRenamingId(id); setRenameDraft(name); }}
                        className={`w-full text-left text-xs font-bold tracking-wide px-2 py-1.5 rounded-lg hover:bg-slate-800 transition-colors ${speakerColor(id)}`}
                        title="Click to rename"
                      >
                        {name}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800/60">
              <p className="text-[10px] font-bold tracking-widest uppercase text-slate-500 mb-2">Options</p>
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none mb-1.5">
                <input
                  type="checkbox"
                  checked={opts.diarize}
                  onChange={e => setOpts(o => ({ ...o, diarize: e.target.checked }))}
                  className="accent-sky-500"
                />
                Speaker diarization
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none mb-1.5">
                <input
                  type="checkbox"
                  checked={opts.filler_words}
                  onChange={e => setOpts(o => ({ ...o, filler_words: e.target.checked }))}
                  className="accent-sky-500"
                />
                Filler words
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={opts.numerals}
                  onChange={e => setOpts(o => ({ ...o, numerals: e.target.checked }))}
                  className="accent-sky-500"
                />
                Numerals
              </label>
            </div>
          </div>
        )}

        {/* Main content area */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* Idle — drop zone */}
          {phase === 'idle' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6">

              {largeFileWarning && (
                <div className="w-full max-w-xl bg-amber-950/60 border border-amber-700/50 rounded-xl px-4 py-3 flex gap-3 text-sm text-amber-200">
                  <svg className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.96-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z"/>
                  </svg>
                  <span>{largeFileWarning}</span>
                </div>
              )}

              <div
                ref={dropRef}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onClick={() => fileInputRef.current?.click()}
                className="w-full max-w-xl border-2 border-dashed border-slate-700 hover:border-sky-500/60 rounded-2xl p-12 flex flex-col items-center gap-4 cursor-pointer transition-colors group"
              >
                <div className="w-14 h-14 rounded-2xl bg-slate-800 group-hover:bg-slate-700/80 flex items-center justify-center transition-colors">
                  <svg className="w-7 h-7 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
                  </svg>
                </div>
                <div className="text-center">
                  <p className="font-semibold text-slate-200 text-sm">Drop audio or video file here</p>
                  <p className="text-xs text-slate-500 mt-1">MP3, WAV, M4A, MP4, MOV, FLAC, OGG &middot; up to ~500 MB</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,video/*"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>

              {/* Options toggle */}
              <div className="w-full max-w-xl">
                <button
                  onClick={() => setShowOptions(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-2"
                >
                  <svg className={`w-3.5 h-3.5 transition-transform ${showOptions ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                  </svg>
                  Transcription options
                </button>
                {showOptions && (
                  <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4 grid grid-cols-2 gap-x-6 gap-y-2.5">
                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                      <input type="checkbox" checked={opts.diarize} onChange={e => setOpts(o => ({ ...o, diarize: e.target.checked }))} className="accent-sky-500" />
                      Speaker diarization
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                      <input type="checkbox" checked={opts.smart_format} onChange={e => setOpts(o => ({ ...o, smart_format: e.target.checked }))} className="accent-sky-500" />
                      Smart formatting
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                      <input type="checkbox" checked={opts.punctuate} onChange={e => setOpts(o => ({ ...o, punctuate: e.target.checked }))} className="accent-sky-500" />
                      Punctuation
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                      <input type="checkbox" checked={opts.filler_words} onChange={e => setOpts(o => ({ ...o, filler_words: e.target.checked }))} className="accent-sky-500" />
                      Filler words
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                      <input type="checkbox" checked={opts.numerals} onChange={e => setOpts(o => ({ ...o, numerals: e.target.checked }))} className="accent-sky-500" />
                      Numerals
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                      <input type="checkbox" checked={opts.utterances} onChange={e => setOpts(o => ({ ...o, utterances: e.target.checked }))} className="accent-sky-500" />
                      Utterances
                    </label>
                    <div className="col-span-2">
                      <label className="block text-xs text-slate-500 mb-1">Model</label>
                      <select
                        value={opts.model}
                        onChange={e => setOpts(o => ({ ...o, model: e.target.value }))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      >
                        <option value="nova-3">Nova 3 (recommended)</option>
                        <option value="nova-2">Nova 2</option>
                        <option value="enhanced">Enhanced</option>
                        <option value="base">Base</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-slate-500 mb-1">Keyterms (one per line)</label>
                      <textarea
                        rows={3}
                        value={opts.keyterms.join('\n')}
                        onChange={e => setOpts(o => ({ ...o, keyterms: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }))}
                        placeholder="e.g. Home Depot&#10;Delia Garza"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 resize-none focus:outline-none focus:ring-1 focus:ring-sky-500 placeholder-slate-600"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Recent jobs */}
              {recentJobs.length > 0 && (
                <div className="w-full max-w-xl">
                  <button
                    onClick={() => setShowRecent(v => !v)}
                    className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-2"
                  >
                    <svg className={`w-3.5 h-3.5 transition-transform ${showRecent ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                    </svg>
                    Recent transcripts ({recentJobs.length})
                  </button>
                  {showRecent && (
                    <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl overflow-hidden divide-y divide-slate-800/60">
                      {recentJobs.map(job => (
                        <div key={job.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors group/row">
                          <button onClick={() => loadJob(job)} className="flex-1 min-w-0 text-left">
                            <p className="text-sm font-medium text-slate-200 truncate">{job.source_file_name}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {new Date(job.created_at).toLocaleString()} &middot; {job.word_count ?? '?'} words
                            </p>
                          </button>
                          <button
                            onClick={() => handleDeleteJob(job.id)}
                            className="opacity-0 group-hover/row:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-rose-900/40 text-slate-600 hover:text-rose-400"
                            title="Delete"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Processing state */}
          {(phase === 'compressing' || phase === 'transcribing') && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
              <div className="w-full max-w-sm flex flex-col gap-5">
                <div className="text-center mb-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-950/60 border border-sky-800/40 text-sky-300 text-xs font-semibold mb-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                    {phase === 'compressing' ? 'Compressing audio' : 'Transcribing'}
                  </div>
                  <p className="text-slate-400 text-sm">
                    {phase === 'compressing'
                      ? 'Converting to 16 kHz mono WAV...'
                      : 'Sending to Deepgram Nova 3...'}
                  </p>
                </div>

                {phase === 'compressing' && compressionProgress && (
                  <ProgressBar
                    value={compressionProgress.percent}
                    label={compressionProgress.phase.charAt(0).toUpperCase() + compressionProgress.phase.slice(1)}
                  />
                )}

                {phase === 'transcribing' && (
                  <ProgressBar value={transcribeProgress} label="Transcribing" />
                )}

                <button
                  onClick={resetToIdle}
                  className="text-xs text-slate-600 hover:text-slate-400 transition-colors mt-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Error state */}
          {phase === 'error' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8">
              <div className="w-full max-w-sm bg-rose-950/60 border border-rose-700/50 rounded-2xl p-6 text-center">
                <div className="w-10 h-10 rounded-full bg-rose-900/60 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                </div>
                <p className="font-semibold text-rose-200 mb-2">Something went wrong</p>
                <p className="text-sm text-rose-300/80 mb-5 font-mono break-words">{error}</p>
                <button
                  onClick={resetToIdle}
                  className="px-4 py-2 bg-rose-800/60 hover:bg-rose-700/60 rounded-lg text-sm font-semibold text-rose-100 transition-colors"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* Transcript view */}
          {phase === 'done' && transcript && (
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="max-w-3xl mx-auto">
                {transcript.utterances.map(u => (
                  <UtteranceRow
                    key={u.sequence_index}
                    utterance={u}
                    speakerName={speakerNames[u.speaker_id] ?? defaultSpeakerName(u.speaker_id)}
                    speakerColorClass={speakerColor(u.speaker_id)}
                    onEdit={text => handleUtteranceEdit(transcript.job.id, u.sequence_index, text)}
                    onSpeakerClick={() => { setRenamingId(u.speaker_id); setRenameDraft(speakerNames[u.speaker_id] ?? defaultSpeakerName(u.speaker_id)); }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
