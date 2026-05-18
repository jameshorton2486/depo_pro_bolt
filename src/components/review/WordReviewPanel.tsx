import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { supabase } from '../../lib/supabase';
import type {
  TranscriptWord,
  WordReview,
  WordFlag,
  Utterance,
  SpeakerMapping,
  TranscriptionJob,
} from '../../lib/database.types';
import TranscriptWordToken, { ConfidenceLegend } from './TranscriptWord';
import AudioPlaybackControls, { type AudioPlaybackHandle } from './AudioPlaybackControls';
import ConfidenceHeatmap from './ConfidenceHeatmap';
import ReviewSidebar, { type ReviewFilter } from './ReviewSidebar';

interface WordReviewPanelProps {
  job: TranscriptionJob;
  utterances: Utterance[];
  speakerMappings: SpeakerMapping[];
  onClose: () => void;
}

interface UtteranceWithWords {
  utterance: Utterance;
  words: TranscriptWord[];
  speakerName: string;
  role: 'Q' | 'A' | 'REPORTER';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSpeakerRole(name: string): 'Q' | 'A' | 'REPORTER' {
  const n = name.toUpperCase();
  if (/\bWITNESS\b|\bDEPONENT\b/.test(n)) return 'A';
  if (/\bREPORTER\b|\bNOTARY\b|\bCLERK\b|\bOFFICER\b/.test(n)) return 'REPORTER';
  return 'Q';
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

// ─── Keyboard shortcut hook ───────────────────────────────────────────────────

function useKeyboardShortcuts(handlers: Record<string, () => void>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT','TEXTAREA','SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      const key = [
        e.ctrlKey ? 'ctrl+' : '',
        e.altKey ? 'alt+' : '',
        e.key.toLowerCase(),
      ].join('');
      handlers[key]?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlers]);
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WordReviewPanel({
  job,
  utterances,
  speakerMappings,
  onClose,
}: WordReviewPanelProps) {
  const [words, setWords] = useState<TranscriptWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeWordId, setActiveWordId] = useState<string | null>(null);
  const [focusedWordId, setFocusedWordId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<ReviewFilter>('all_flags');
  const [showSidebar, setShowSidebar] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [keyboardShortcutsVisible, setKeyboardShortcutsVisible] = useState(false);

  const audioRef = useRef<AudioPlaybackHandle>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Map<string, HTMLElement>>(new Map());

  const speakerNameMap = useMemo(
    () => new Map(speakerMappings.map(m => [m.speaker_id, m.mapped_name])),
    [speakerMappings],
  );

  const getSpeakerName = useCallback(
    (id: number) => speakerNameMap.get(id) ?? `Speaker ${id}`,
    [speakerNameMap],
  );

  // ── Load words from DB ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const load = async () => {
      // Try to load from transcript_words table first
      const { data, error } = await supabase
        .from('transcript_words')
        .select('*')
        .eq('job_id', job.id)
        .order('sequence_index');

      if (cancelled) return;

      if (error) {
        setLoadError(`Failed to load words: ${error.message}`);
        setLoading(false);
        return;
      }

      if (data && data.length > 0) {
        setWords(data as TranscriptWord[]);
        setLoading(false);
        return;
      }

      // transcript_words table is empty — extract from utterances.words JSONB
      // and persist so future loads are fast
      const extractedWords = extractAndPersistWords(utterances, job.id);
      setWords(await extractedWords);
      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [job.id, utterances]);

  // ── Extract words from utterances.words JSONB and persist ──────────────────
  const extractAndPersistWords = useCallback(async (
    utts: Utterance[],
    jobId: string,
  ): Promise<TranscriptWord[]> => {
    const rows: Omit<TranscriptWord, 'id' | 'created_at'>[] = [];
    let globalSeq = 0;

    for (const utt of utts) {
      const tokens = utt.words ?? [];
      tokens.forEach((token, uttIdx) => {
        rows.push({
          utterance_id: utt.id,
          job_id: jobId,
          speaker_id: token.speaker ?? utt.speaker_id,
          sequence_index: globalSeq++,
          utterance_index: uttIdx,
          text: token.word,
          punctuated_word: token.punctuated_word ?? null,
          start_time: token.start,
          end_time: token.end,
          confidence: token.confidence,
          reviewed: false,
          edited: false,
          original_text: null,
          corrected_text: null,
          flags: [],
        });
      });
    }

    if (rows.length === 0) return [];

    // Batch insert in chunks of 500
    const CHUNK = 500;
    const insertedIds: string[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { data } = await supabase
        .from('transcript_words')
        .insert(rows.slice(i, i + CHUNK))
        .select('id');
      if (data) insertedIds.push(...data.map((r: { id: string }) => r.id));
    }

    // Re-fetch to get server-assigned IDs
    const { data: inserted } = await supabase
      .from('transcript_words')
      .select('*')
      .eq('job_id', jobId)
      .order('sequence_index');
    return (inserted ?? []) as TranscriptWord[];
  }, []);

  // ── Get signed audio URL ────────────────────────────────────────────────────
  useEffect(() => {
    if (!job.storage_path) return;
    supabase.storage
      .from('audio-files')
      .createSignedUrl(job.storage_path, 7200)
      .then(({ data }) => {
        if (data?.signedUrl) setAudioUrl(data.signedUrl);
      });
  }, [job.storage_path]);

  // ── Track active word based on playback time ──────────────────────────────
  useEffect(() => {
    if (words.length === 0) return;
    // Binary search for the current word
    let lo = 0, hi = words.length - 1, found: TranscriptWord | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const w = words[mid];
      if (currentTime >= w.start_time && currentTime <= w.end_time) { found = w; break; }
      if (currentTime < w.start_time) hi = mid - 1;
      else lo = mid + 1;
    }
    setActiveWordId(found?.id ?? null);
  }, [currentTime, words]);

  // Auto-scroll to active word
  useEffect(() => {
    if (!activeWordId) return;
    const el = wordRefs.current.get(activeWordId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeWordId]);

  // ── Review actions ──────────────────────────────────────────────────────────
  const updateWord = useCallback((id: string, patch: Partial<TranscriptWord>) => {
    setWords(prev => prev.map(w => w.id === id ? { ...w, ...patch } : w));
  }, []);

  const appendReview = useCallback(async (review: Omit<WordReview, 'id' | 'created_at'>) => {
    await supabase.from('word_reviews').insert(review);
  }, []);

  const handleClickWord = useCallback((word: TranscriptWord) => {
    setFocusedWordId(word.id);
    // Play ±3s context around word
    if (audioRef.current) {
      audioRef.current.playRegion(word.start_time, word.end_time, 3);
    }
  }, []);

  const handleEditWord = useCallback(async (word: TranscriptWord, newText: string) => {
    const firstEdit = !word.edited;
    const patch: Partial<TranscriptWord> = {
      corrected_text: newText,
      edited: true,
      original_text: firstEdit ? (word.original_text ?? word.text) : word.original_text,
    };
    await supabase.from('transcript_words').update(patch).eq('id', word.id);
    await appendReview({
      word_id: word.id,
      job_id: job.id,
      utterance_id: word.utterance_id,
      action: 'edit',
      previous_text: word.corrected_text ?? word.text,
      new_text: newText,
      flag_added: null,
      flag_removed: null,
    });
    updateWord(word.id, patch);
  }, [job.id, appendReview, updateWord]);

  const handleMarkReviewed = useCallback(async (word: TranscriptWord) => {
    const newVal = !word.reviewed;
    await supabase.from('transcript_words').update({ reviewed: newVal }).eq('id', word.id);
    await appendReview({
      word_id: word.id,
      job_id: job.id,
      utterance_id: word.utterance_id,
      action: 'mark_reviewed',
      previous_text: null,
      new_text: null,
      flag_added: null,
      flag_removed: null,
    });
    updateWord(word.id, { reviewed: newVal });
  }, [job.id, appendReview, updateWord]);

  const handleToggleFlag = useCallback(async (word: TranscriptWord, flag: WordFlag) => {
    const hasFlag = word.flags.includes(flag);
    const newFlags = hasFlag
      ? word.flags.filter(f => f !== flag)
      : [...word.flags, flag];
    await supabase.from('transcript_words').update({ flags: newFlags }).eq('id', word.id);
    await appendReview({
      word_id: word.id,
      job_id: job.id,
      utterance_id: word.utterance_id,
      action: hasFlag ? 'unflag' : 'flag',
      previous_text: null,
      new_text: null,
      flag_added: hasFlag ? null : flag,
      flag_removed: hasFlag ? flag : null,
    });
    updateWord(word.id, { flags: newFlags });
  }, [job.id, appendReview, updateWord]);

  // ── Queue navigation ────────────────────────────────────────────────────────
  const reviewQueue = useMemo(
    () => words.filter(w => w.confidence < 0.85 || w.flags.length > 0),
    [words],
  );

  const navigateQueue = useCallback((direction: 1 | -1) => {
    if (reviewQueue.length === 0) return;
    const idx = reviewQueue.findIndex(w => w.id === focusedWordId);
    const nextIdx = idx === -1
      ? (direction === 1 ? 0 : reviewQueue.length - 1)
      : Math.max(0, Math.min(reviewQueue.length - 1, idx + direction));
    const nextWord = reviewQueue[nextIdx];
    setFocusedWordId(nextWord.id);
    if (audioRef.current) audioRef.current.playRegion(nextWord.start_time, nextWord.end_time, 3);
    const el = wordRefs.current.get(nextWord.id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [reviewQueue, focusedWordId]);

  useKeyboardShortcuts({
    'arrowdown': () => navigateQueue(1),
    'arrowup':   () => navigateQueue(-1),
    'n':         () => navigateQueue(1),
    'p':         () => navigateQueue(-1),
    ' ':         () => audioRef.current?.seekTo(audioRef.current.getCurrentTime()),
    'r':         () => { const f = words.find(w => w.id === focusedWordId); if (f) handleMarkReviewed(f); },
    'arrowleft': () => audioRef.current?.seekTo(Math.max(0, currentTime - 5)),
    'arrowright':() => audioRef.current?.seekTo(currentTime + 5),
  });

  // ── Group words by utterance for rendering ─────────────────────────────────
  const utteranceGroups = useMemo((): UtteranceWithWords[] => {
    const wordsByUtterance = new Map<string, TranscriptWord[]>();
    for (const w of words) {
      const arr = wordsByUtterance.get(w.utterance_id) ?? [];
      arr.push(w);
      wordsByUtterance.set(w.utterance_id, arr);
    }
    return utterances
      .filter(u => wordsByUtterance.has(u.id))
      .map(u => {
        const name = getSpeakerName(u.speaker_id);
        return {
          utterance: u,
          words: wordsByUtterance.get(u.id) ?? [],
          speakerName: name,
          role: getSpeakerRole(name),
        };
      });
  }, [words, utterances, getSpeakerName]);

  // ── Virtualized utterance list ─────────────────────────────────────────────
  const virtualizer = useVirtualizer({
    count: utteranceGroups.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });

  const handleJumpToWord = useCallback((word: TranscriptWord) => {
    setFocusedWordId(word.id);
    if (audioRef.current) audioRef.current.playRegion(word.start_time, word.end_time, 3);
    // Find the utterance group index and scroll to it
    const groupIdx = utteranceGroups.findIndex(g => g.utterance.id === word.utterance_id);
    if (groupIdx >= 0) virtualizer.scrollToIndex(groupIdx, { align: 'center' });
    setTimeout(() => {
      const el = wordRefs.current.get(word.id);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 150);
  }, [utteranceGroups, virtualizer]);

  // ── Loading / error states ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-950 text-slate-400 text-sm gap-3">
        <svg className="w-4 h-4 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        Loading word-level review data…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-950 gap-3 text-center px-8">
        <p className="text-rose-400 text-sm">{loadError}</p>
        <button onClick={onClose} className="px-4 py-2 bg-slate-800 rounded-lg text-xs text-slate-300">Close</button>
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-950 gap-3 text-center px-8">
        <p className="text-slate-400 text-sm">No word-level data available for this job.</p>
        <p className="text-slate-600 text-xs">Word data is populated from the Deepgram word-level response. Older jobs may not have word tokens stored.</p>
        <button onClick={onClose} className="px-4 py-2 bg-slate-800 rounded-lg text-xs text-slate-300">Back to Editor</button>
      </div>
    );
  }

  const focusedWord = words.find(w => w.id === focusedWordId);
  const queueIdx = reviewQueue.findIndex(w => w.id === focusedWordId);

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden">

      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-slate-900/80 border-b border-slate-800 px-4 py-2 flex items-center gap-3">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors text-xs"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
          Transcript Editor
        </button>

        <span className="h-3 w-px bg-slate-700" />

        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-sky-500" />
          <span className="text-xs font-semibold text-slate-200">Word-Level Review</span>
        </div>

        <div className="flex-1" />

        {/* Queue nav */}
        {reviewQueue.length > 0 && (
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => navigateQueue(-1)}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              title="Previous flagged word (↑ / P)"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7"/>
              </svg>
            </button>
            <span className="text-slate-500 font-mono text-[10px] tabular-nums px-1">
              {queueIdx >= 0 ? `${queueIdx + 1}/` : ''}{reviewQueue.length} flagged
            </span>
            <button
              onClick={() => navigateQueue(1)}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              title="Next flagged word (↓ / N)"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
              </svg>
            </button>
          </div>
        )}

        {/* Panel toggles */}
        <button
          onClick={() => setShowHeatmap(p => !p)}
          title="Toggle confidence heatmap"
          className={`p-1.5 rounded transition-colors ${showHeatmap ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
          </svg>
        </button>

        <button
          onClick={() => setShowSidebar(p => !p)}
          title="Toggle review sidebar"
          className={`p-1.5 rounded transition-colors ${showSidebar ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
          </svg>
        </button>

        <button
          onClick={() => setKeyboardShortcutsVisible(p => !p)}
          title="Keyboard shortcuts"
          className="p-1.5 rounded bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M20 12a8 8 0 11-16 0 8 8 0 0116 0z"/>
          </svg>
        </button>
      </div>

      {/* Keyboard shortcuts overlay */}
      {keyboardShortcutsVisible && (
        <div className="shrink-0 bg-slate-900 border-b border-slate-800 px-4 py-2 flex flex-wrap gap-x-6 gap-y-1 text-[10px] text-slate-400">
          {[
            ['↓ / N', 'Next flagged'], ['↑ / P', 'Prev flagged'],
            ['← / →', 'Seek ±5s'],    ['R', 'Mark reviewed'],
            ['Space', 'Play/pause'],   ['Click word', 'Play ±3s context'],
          ].map(([key, label]) => (
            <span key={key} className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 font-mono text-[9px] text-slate-300">{key}</kbd>
              <span>{label}</span>
            </span>
          ))}
        </div>
      )}

      {/* ── Focused word info bar ──────────────────────────────────────────── */}
      {focusedWord && (
        <div className="shrink-0 bg-slate-900/60 border-b border-slate-800 px-4 py-2 flex items-center gap-4 text-xs">
          <span className="font-mono font-bold text-sky-300 text-sm">
            "{focusedWord.corrected_text ?? focusedWord.punctuated_word ?? focusedWord.text}"
          </span>
          <span className="text-slate-500 font-mono text-[10px]">
            {formatTime(focusedWord.start_time)} – {formatTime(focusedWord.end_time)}
          </span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            focusedWord.confidence >= 0.85 ? 'text-emerald-400 border-emerald-500/25 bg-emerald-500/10' :
            focusedWord.confidence >= 0.70 ? 'text-amber-400 border-amber-500/25 bg-amber-500/10' :
            focusedWord.confidence >= 0.50 ? 'text-orange-400 border-orange-500/25 bg-orange-500/10' :
                                              'text-rose-400 border-rose-500/25 bg-rose-500/10'
          }`}>
            {Math.round(focusedWord.confidence * 100)}% conf
          </span>
          <span className="text-slate-500 text-[10px]">{getSpeakerName(focusedWord.speaker_id)}</span>
          <div className="flex-1" />
          <button
            onClick={() => handleMarkReviewed(focusedWord)}
            className={`text-[10px] px-2.5 py-1 rounded-lg border transition-all ${
              focusedWord.reviewed
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : 'text-slate-400 bg-slate-800 border-slate-700 hover:border-sky-500'
            }`}
          >
            {focusedWord.reviewed ? '✓ Reviewed' : 'Mark Reviewed (R)'}
          </button>
        </div>
      )}

      {/* ── Audio + heatmap zone ──────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pt-3 pb-2 space-y-2 border-b border-slate-800">
        <AudioPlaybackControls
          ref={audioRef}
          audioUrl={audioUrl}
          onTimeUpdate={setCurrentTime}
          onReady={setAudioDuration}
        />
        {showHeatmap && words.length > 0 && (
          <ConfidenceHeatmap
            words={words}
            totalDuration={audioDuration}
            currentTime={currentTime}
            onSeek={s => audioRef.current?.seekTo(s)}
          />
        )}
        <ConfidenceLegend />
      </div>

      {/* ── Main body: transcript + sidebar ──────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Transcript column */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto px-4 py-4"
            style={{ contain: 'strict' }}
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map(vItem => {
                const group = utteranceGroups[vItem.index];
                if (!group) return null;
                const { utterance: utt, words: uttWords, speakerName, role } = group;
                const qaMarker = role === 'Q' ? 'Q.' : role === 'A' ? 'A.' : null;
                const isActiveSpeakerBlock = uttWords.some(w => w.id === activeWordId);

                return (
                  <div
                    key={vItem.key}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vItem.start}px)`,
                    }}
                  >
                    <div className={[
                      'rounded-xl border px-4 py-3 mb-2 transition-all',
                      isActiveSpeakerBlock
                        ? 'border-sky-500/30 bg-sky-500/5'
                        : 'border-slate-800/60 bg-slate-900/30',
                    ].join(' ')}>
                      {/* Speaker label */}
                      <div className="flex items-center gap-2 mb-1.5">
                        {qaMarker && (
                          <span className="text-[11px] font-black text-slate-300 font-mono">{qaMarker}</span>
                        )}
                        <button
                          onClick={() => audioRef.current?.playRegion(utt.start_time, utt.end_time, 1)}
                          className="text-[10px] font-bold text-sky-400 uppercase tracking-wide hover:text-sky-300 transition-colors flex items-center gap-1"
                          title="Play utterance"
                        >
                          {speakerName}
                          <svg className="w-2.5 h-2.5 opacity-50" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z"/>
                          </svg>
                        </button>
                        <span className="text-[9px] font-mono text-slate-600 ml-auto tabular-nums">
                          {formatTime(utt.start_time)}
                        </span>
                      </div>

                      {/* Words */}
                      <div
                        className="flex flex-wrap gap-y-1 leading-loose"
                        ref={el => {
                          // register refs for each word inside
                          if (el) {
                            uttWords.forEach(w => {
                              const span = el.querySelector(`[data-word-id="${w.id}"]`) as HTMLElement;
                              if (span) wordRefs.current.set(w.id, span);
                            });
                          }
                        }}
                      >
                        {uttWords.map(w => (
                          <span key={w.id} data-word-id={w.id}>
                            <TranscriptWordToken
                              word={w}
                              isActive={w.id === activeWordId}
                              isFocused={w.id === focusedWordId}
                              speakerName={speakerName}
                              onClickWord={handleClickWord}
                              onEditWord={handleEditWord}
                              onMarkReviewed={handleMarkReviewed}
                              onToggleFlag={handleToggleFlag}
                            />
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        {showSidebar && (
          <div className="w-64 shrink-0 border-l border-slate-800 overflow-hidden flex flex-col">
            <ReviewSidebar
              words={words}
              focusedWordId={focusedWordId}
              onJumpToWord={handleJumpToWord}
              onMarkReviewed={handleMarkReviewed}
              filterMode={filterMode}
              onFilterChange={setFilterMode}
            />
          </div>
        )}
      </div>
    </div>
  );
}
