import { useState, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { Utterance, SpeakerMapping, TranscriptionJob, Case, Reporter, UtteranceCorrection } from '../lib/database.types';
import { batchCorrect } from '../lib/corrections';
import AiReviewPanel from './AiReviewPanel';
import WordReviewPanel from './review/WordReviewPanel';
import TranscriptDiffViewer from './diff/TranscriptDiffViewer';

interface TranscriptEditorProps {
  job: TranscriptionJob;
  utterances: Utterance[];
  speakerMappings: SpeakerMapping[];
  caseData: Partial<Case>;
  reporters: Reporter[];
  onUtterancesChange: (utterances: Utterance[]) => void;
  onExport: () => void;
}

type ReviewState = 'unreviewed' | 'reviewed' | 'flagged' | 'approved';
type FilterMode = 'all' | 'unreviewed' | 'flagged' | 'low_confidence' | 'edited';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const REVIEW_STATE_CONFIG: Record<ReviewState, { label: string; color: string; bg: string; border: string }> = {
  unreviewed: { label: 'Unreviewed', color: 'text-slate-400', bg: 'bg-slate-800', border: 'border-slate-700' },
  reviewed:   { label: 'Reviewed',   color: 'text-sky-400',   bg: 'bg-sky-500/10',   border: 'border-sky-500/30' },
  flagged:    { label: 'Flagged',    color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  approved:   { label: 'Approved',   color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
};

export default function TranscriptEditor({
  job,
  utterances,
  speakerMappings,
  caseData,
  reporters,
  onUtterancesChange,
  onExport,
}: TranscriptEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [corrections, setCorrections] = useState<Record<string, UtteranceCorrection[]>>({});
  const [showHistoryFor, setShowHistoryFor] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [applyingCorrections, setApplyingCorrections] = useState(false);
  const [lastCorrectionCount, setLastCorrectionCount] = useState<number | null>(null);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showWordReview, setShowWordReview] = useState(false);
  const [showDiffViewer, setShowDiffViewer] = useState(false);
  const [speakerEditId, setSpeakerEditId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentReporter = reporters.find(r => r.id === caseData.reporter_id);

  const speakerNameMap = useMemo(
    () => new Map(speakerMappings.map(m => [m.speaker_id, m.mapped_name])),
    [speakerMappings],
  );

  const getMappedName = useCallback(
    (speakerId: number) => speakerNameMap.get(speakerId) ?? `Speaker ${speakerId}`,
    [speakerNameMap],
  );

  const getSpeakerRole = useCallback((mappedName: string): 'Q' | 'A' | 'REPORTER' => {
    const n = mappedName.toUpperCase();
    if (/\bWITNESS\b|\bDEPONENT\b/.test(n)) return 'A';
    if (/\bREPORTER\b|\bNOTARY\b|\bCLERK\b|\bOFFICER\b/.test(n)) return 'REPORTER';
    return 'Q';
  }, []);

  const startEdit = (u: Utterance) => {
    setEditingId(u.id);
    setEditText(u.corrected_transcript ?? u.transcript);
    setSpeakerEditId(null);
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }, 50);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const saveEdit = async (u: Utterance) => {
    if (editText.trim() === (u.corrected_transcript ?? u.transcript)) {
      cancelEdit();
      return;
    }
    setSaving(prev => ({ ...prev, [u.id]: true }));
    const previousText = u.corrected_transcript ?? u.transcript;
    const originalTranscript = u.original_transcript ?? u.transcript;

    const { error } = await supabase.from('utterances').update({
      corrected_transcript: editText.trim(),
      edited: true,
      edited_at: new Date().toISOString(),
      original_transcript: originalTranscript,
      review_state: u.review_state === 'unreviewed' ? 'reviewed' : u.review_state,
    }).eq('id', u.id);

    if (!error) {
      await supabase.from('utterance_corrections').insert({
        utterance_id: u.id,
        job_id: job.id,
        previous_text: previousText,
        corrected_text: editText.trim(),
        correction_type: 'text_edit',
      });

      onUtterancesChange(utterances.map(x =>
        x.id === u.id
          ? { ...x, corrected_transcript: editText.trim(), edited: true, edited_at: new Date().toISOString(), original_transcript: originalTranscript, review_state: x.review_state === 'unreviewed' ? 'reviewed' : x.review_state }
          : x
      ));
    }
    setSaving(prev => ({ ...prev, [u.id]: false }));
    cancelEdit();
  };

  const setReviewState = async (u: Utterance, state: ReviewState) => {
    const { error } = await supabase.from('utterances').update({ review_state: state }).eq('id', u.id);
    if (!error) {
      onUtterancesChange(utterances.map(x => x.id === u.id ? { ...x, review_state: state } : x));
    }
  };

  const reassignSpeaker = async (u: Utterance, newSpeakerId: number) => {
    const { error } = await supabase.from('utterances').update({ speaker_id: newSpeakerId }).eq('id', u.id);
    if (!error) {
      await supabase.from('utterance_corrections').insert({
        utterance_id: u.id,
        job_id: job.id,
        previous_text: u.corrected_transcript ?? u.transcript,
        corrected_text: u.corrected_transcript ?? u.transcript,
        previous_speaker_id: u.speaker_id,
        new_speaker_id: newSpeakerId,
        correction_type: 'speaker_reassign',
      });
      onUtterancesChange(utterances.map(x => x.id === u.id ? { ...x, speaker_id: newSpeakerId } : x));
    }
    setSpeakerEditId(null);
  };

  const loadCorrections = async (utteranceId: string) => {
    if (corrections[utteranceId]) {
      setShowHistoryFor(prev => prev === utteranceId ? null : utteranceId);
      return;
    }
    const { data } = await supabase
      .from('utterance_corrections')
      .select('*')
      .eq('utterance_id', utteranceId)
      .order('created_at', { ascending: false });
    if (data) setCorrections(prev => ({ ...prev, [utteranceId]: data as UtteranceCorrection[] }));
    setShowHistoryFor(prev => prev === utteranceId ? null : utteranceId);
  };

  const markAllReviewed = async () => {
    setBulkSaving(true);
    const ids = filteredUtterances.filter(u => u.review_state === 'unreviewed').map(u => u.id);
    if (ids.length > 0) {
      await supabase.from('utterances').update({ review_state: 'reviewed' }).in('id', ids);
      onUtterancesChange(utterances.map(u => ids.includes(u.id) ? { ...u, review_state: 'reviewed' } : u));
    }
    setBulkSaving(false);
  };

  const applyCorrections = async () => {
    setApplyingCorrections(true);
    try {
      const items = utterances.map(u => ({
        id: u.id,
        text: u.corrected_transcript ?? u.transcript,
      }));
      const changed = batchCorrect(items);
      if (changed.length === 0) {
        setLastCorrectionCount(0);
        return;
      }

      // Write all changed utterances to Supabase in parallel
      const now = new Date().toISOString();
      await Promise.all(
        changed.map(async ({ id, original, corrected, rules_applied }) => {
          const utt = utterances.find(u => u.id === id)!;
          const originalTranscript = utt.original_transcript ?? utt.transcript;
          await supabase.from('utterances').update({
            corrected_transcript: corrected,
            edited: true,
            edited_at: now,
            original_transcript: originalTranscript,
          }).eq('id', id);
          await supabase.from('utterance_corrections').insert({
            utterance_id: id,
            job_id: job.id,
            previous_text: original,
            corrected_text: corrected,
            correction_type: 'deterministic_correction',
            previous_speaker_id: null,
            new_speaker_id: null,
          });
          void rules_applied; // logged in correction record implicitly via corrected_text diff
        })
      );

      // Update local state
      const changedMap = new Map(changed.map(c => [c.id, c.corrected]));
      onUtterancesChange(
        utterances.map(u =>
          changedMap.has(u.id)
            ? {
                ...u,
                corrected_transcript: changedMap.get(u.id)!,
                edited: true,
                edited_at: now,
                original_transcript: u.original_transcript ?? u.transcript,
              }
            : u
        )
      );
      setLastCorrectionCount(changed.length);
    } finally {
      setApplyingCorrections(false);
    }
  };

  const filteredUtterances = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return utterances.filter(u => {
      if (q) {
        const text = (u.corrected_transcript ?? u.transcript).toLowerCase();
        if (!text.includes(q) && !getMappedName(u.speaker_id).toLowerCase().includes(q)) return false;
      }
      if (filterMode === 'unreviewed') return u.review_state === 'unreviewed';
      if (filterMode === 'flagged') return u.review_state === 'flagged';
      if (filterMode === 'low_confidence') return u.confidence < 0.8;
      if (filterMode === 'edited') return u.edited;
      return true;
    });
  }, [utterances, filterMode, searchQuery, getMappedName]);

  const stats = useMemo(() => ({
    total: utterances.length,
    reviewed: utterances.filter(u => u.review_state === 'reviewed' || u.review_state === 'approved').length,
    flagged: utterances.filter(u => u.review_state === 'flagged').length,
    lowConf: utterances.filter(u => u.confidence < 0.8).length,
    edited: utterances.filter(u => u.edited).length,
  }), [utterances]);

  const reviewPct = stats.total > 0 ? Math.round((stats.reviewed / stats.total) * 100) : 0;

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Main transcript column */}
      <div className="flex flex-col flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="bg-slate-900/60 border-b border-slate-800 px-5 py-3 flex flex-wrap items-center gap-3 shrink-0">
        {/* Stats bar */}
        <div className="flex items-center gap-4 text-[11px] font-semibold">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            <span className="text-slate-400">{stats.total} segments</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-sky-500" />
            <span className="text-sky-400">{stats.reviewed} reviewed</span>
          </div>
          {stats.flagged > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-amber-400">{stats.flagged} flagged</span>
            </div>
          )}
          {stats.lowConf > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span className="text-rose-400">{stats.lowConf} low conf</span>
            </div>
          )}
          {stats.edited > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-emerald-400">{stats.edited} edited</span>
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="flex-1 min-w-32 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-500 rounded-full transition-all duration-500"
              style={{ width: `${reviewPct}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-400 font-mono w-8 shrink-0">{reviewPct}%</span>
        </div>

        {/* Filter chips */}
        <div className="flex gap-1">
          {(['all', 'unreviewed', 'flagged', 'low_confidence', 'edited'] as FilterMode[]).map(f => (
            <button
              key={f}
              onClick={() => setFilterMode(f)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${
                filterMode === f
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-950 text-slate-500 border border-slate-800 hover:text-slate-300'
              }`}
            >
              {f === 'low_confidence' ? 'Low Conf' : f}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search transcript..."
          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-sky-500 focus:outline-none w-44"
        />

        {/* Actions */}
        <div className="flex gap-2 ml-auto items-center">
          {/* Stage 1 corrections button */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={applyCorrections}
              disabled={applyingCorrections || utterances.length === 0}
              title="Run deterministic formatting corrections: Q/A labels, speaker labels, STT substitutions, punctuation, objection normalization"
              className="px-3 py-1.5 bg-slate-950 hover:bg-amber-500/10 text-amber-400 hover:text-amber-300 text-[10px] font-bold rounded-lg border border-amber-500/20 hover:border-amber-500/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              {applyingCorrections ? 'Applying…' : 'Stage 1 Corrections'}
            </button>
            {lastCorrectionCount !== null && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                lastCorrectionCount > 0
                  ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                  : 'text-slate-500 bg-slate-900 border-slate-800'
              }`}>
                {lastCorrectionCount > 0 ? `${lastCorrectionCount} fixed` : 'clean'}
              </span>
            )}
          </div>

          <div className="w-px h-4 bg-slate-700" />

          <button
            onClick={markAllReviewed}
            disabled={bulkSaving}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold rounded-lg border border-slate-700 transition-colors disabled:opacity-50"
          >
            {bulkSaving ? 'Saving...' : 'Mark All Reviewed'}
          </button>
          <button
            onClick={onExport}
            className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold rounded-lg transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export RTF
          </button>

          <div className="w-px h-4 bg-slate-700" />

          {/* Stage 2 AI Review toggle */}
          <button
            onClick={() => { setShowAiPanel(p => !p); setShowWordReview(false); }}
            title="Stage 2 AI Review — punctuation suggestions, speaker drift detection, proper noun flags"
            className={`px-3 py-1.5 text-[10px] font-bold rounded-lg border transition-all flex items-center gap-1.5 ${
              showAiPanel
                ? 'bg-sky-600 text-white border-sky-500'
                : 'bg-slate-950 hover:bg-sky-500/10 text-sky-400 hover:text-sky-300 border-sky-500/20 hover:border-sky-500/40'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
            AI Review
          </button>

          {/* Word-level review toggle */}
          <button
            onClick={() => { setShowWordReview(p => !p); setShowAiPanel(false); }}
            title="Word-Level Review — audio sync, confidence visualization, word-by-word verification"
            className={`px-3 py-1.5 text-[10px] font-bold rounded-lg border transition-all flex items-center gap-1.5 ${
              showWordReview
                ? 'bg-emerald-600 text-white border-emerald-500'
                : 'bg-slate-950 hover:bg-emerald-500/10 text-emerald-400 hover:text-emerald-300 border-emerald-500/20 hover:border-emerald-500/40'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
            </svg>
            Word Review
          </button>

          {/* Transcript Diff Viewer toggle */}
          <button
            onClick={() => { setShowDiffViewer(p => !p); setShowWordReview(false); setShowAiPanel(false); }}
            title="Transcript Diff Viewer — compare stages, audit changes, review AI modifications"
            className={`px-3 py-1.5 text-[10px] font-bold rounded-lg border transition-all flex items-center gap-1.5 ${
              showDiffViewer
                ? 'bg-teal-600 text-white border-teal-500'
                : 'bg-slate-950 hover:bg-teal-500/10 text-teal-400 hover:text-teal-300 border-teal-500/20 hover:border-teal-500/40'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
            Diff Viewer
          </button>
        </div>
      </div>

      {/* Document Header */}
      <div className="bg-slate-950/60 px-8 py-4 border-b border-slate-800/50 text-center shrink-0">
        <p className="text-xs font-bold tracking-widest text-slate-300 uppercase">
          Deposition of {caseData.witness_full_name ?? 'Unknown Witness'}
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5">
          Cause No. {caseData.cause_number || '—'} &nbsp;|&nbsp; {caseData.deposition_date || '—'}
          {currentReporter && <> &nbsp;|&nbsp; Reporter: {currentReporter.name}</>}
        </p>
      </div>

      {/* Utterance List */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5">
        {filteredUtterances.length === 0 && (
          <div className="text-center py-20 text-slate-600 text-sm">
            No segments match the current filter.
          </div>
        )}

        {filteredUtterances.map((u, idx) => {
          const isEditing = editingId === u.id;
          const isSpeakerEditing = speakerEditId === u.id;
          const isLowConf = u.confidence < 0.8;
          const rs = REVIEW_STATE_CONFIG[u.review_state as ReviewState] ?? REVIEW_STATE_CONFIG.unreviewed;
          const displayText = u.corrected_transcript ?? u.transcript;
          const speakerName = getMappedName(u.speaker_id);
          // Only show speaker label when the speaker changes from the previous row
          const prevU = idx > 0 ? filteredUtterances[idx - 1] : null;
          const showSpeakerLabel = !prevU || prevU.speaker_id !== u.speaker_id;
          const role = getSpeakerRole(speakerName);
          const qaMarker = role === 'Q' ? 'Q.' : role === 'A' ? 'A.' : null;

          return (
            <div
              key={u.id}
              className={`group rounded-xl border transition-all ${
                isEditing
                  ? 'border-sky-500/60 bg-slate-900 shadow-lg shadow-sky-500/5'
                  : `${rs.border} bg-slate-900/40 hover:bg-slate-900/80 hover:border-slate-700`
              }`}
            >
              <div className="flex items-start gap-3 px-4 py-3">
                {/* Review state indicator */}
                <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
                  <div className={`w-2 h-2 rounded-full ${
                    u.review_state === 'approved' ? 'bg-emerald-400' :
                    u.review_state === 'reviewed' ? 'bg-sky-400' :
                    u.review_state === 'flagged' ? 'bg-amber-400' :
                    'bg-slate-600'
                  }`} />
                </div>

                {/* Timestamp */}
                <div className="text-[10px] font-mono text-slate-500 pt-0.5 w-14 shrink-0 tabular-nums">
                  {formatTime(u.start_time)}
                </div>

                {/* Speaker — only rendered when speaker changes */}
                <div className="w-36 shrink-0 pt-0.5">
                  {isSpeakerEditing ? (
                    <select
                      autoFocus
                      className="w-full bg-slate-800 border border-sky-500 rounded-md px-1.5 py-1 text-[10px] font-bold text-sky-300 focus:outline-none"
                      defaultValue={u.speaker_id}
                      onChange={e => reassignSpeaker(u, parseInt(e.target.value))}
                      onBlur={() => setSpeakerEditId(null)}
                    >
                      {speakerMappings.map(m => (
                        <option key={m.speaker_id} value={m.speaker_id}>{m.mapped_name}</option>
                      ))}
                    </select>
                  ) : showSpeakerLabel ? (
                    <button
                      onClick={() => setSpeakerEditId(u.id)}
                      className="flex items-baseline gap-1.5 text-left hover:opacity-80 transition-opacity"
                      title="Click to reassign speaker"
                    >
                      {qaMarker && (
                        <span className="text-[11px] font-black text-slate-200 tracking-tight shrink-0 font-mono">
                          {qaMarker}
                        </span>
                      )}
                      <span className="text-[10px] font-bold text-sky-400 tracking-wide uppercase leading-tight">
                        {speakerName}
                      </span>
                    </button>
                  ) : (
                    // Continuation row — faint reassign target, no repeated label
                    <button
                      onClick={() => setSpeakerEditId(u.id)}
                      className="flex items-baseline gap-1.5 text-left opacity-0 group-hover:opacity-40 transition-opacity"
                      title="Click to reassign speaker"
                    >
                      {qaMarker && (
                        <span className="text-[10px] font-black text-slate-500 tracking-tight shrink-0 font-mono">
                          {qaMarker}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-600 uppercase leading-tight">
                        {speakerName}
                      </span>
                    </button>
                  )}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <textarea
                      ref={textareaRef}
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Escape') cancelEdit();
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEdit(u);
                      }}
                      rows={3}
                      className="w-full bg-slate-950 border border-sky-500/50 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-sky-400 resize-none leading-relaxed font-mono"
                    />
                  ) : (
                    <p
                      className={`text-xs leading-relaxed cursor-text select-text ${
                        isLowConf ? 'text-amber-300/80' : u.edited ? 'text-emerald-200' : 'text-slate-200'
                      }`}
                      onDoubleClick={() => startEdit(u)}
                      title="Double-click to edit"
                    >
                      {displayText}
                    </p>
                  )}

                  {/* Edit action bar */}
                  {isEditing && (
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => saveEdit(u)}
                        disabled={saving[u.id]}
                        className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold rounded-md transition-colors disabled:opacity-50"
                      >
                        {saving[u.id] ? 'Saving...' : 'Save (Ctrl+Enter)'}
                      </button>
                      <button onClick={cancelEdit} className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold rounded-md transition-colors">
                        Cancel (Esc)
                      </button>
                      {u.original_transcript && u.original_transcript !== (u.corrected_transcript ?? u.transcript) && (
                        <span className="text-[10px] text-slate-500 ml-1">
                          Original: <span className="text-slate-400 italic">{u.original_transcript.length > 60 ? u.original_transcript.slice(0, 60) + '…' : u.original_transcript}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Correction history */}
                  {showHistoryFor === u.id && corrections[u.id] && (
                    <div className="mt-2 space-y-1.5 bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Correction History</p>
                      {corrections[u.id].length === 0 && (
                        <p className="text-[10px] text-slate-600 italic">No corrections recorded.</p>
                      )}
                      {corrections[u.id].map(c => (
                        <div key={c.id} className="text-[10px] text-slate-400 border-l-2 border-slate-700 pl-2">
                          <span className="text-slate-500 font-mono">{new Date(c.created_at).toLocaleString()}</span>
                          {c.correction_type === 'text_edit' && (
                            <> — <span className="text-slate-500 italic">manual edit</span> <span className="line-through text-slate-600">{c.previous_text.length > 50 ? c.previous_text.slice(0, 50) + '…' : c.previous_text}</span> → <span className="text-emerald-400">{c.corrected_text.length > 50 ? c.corrected_text.slice(0, 50) + '…' : c.corrected_text}</span></>
                          )}
                          {c.correction_type === 'deterministic_correction' && (
                            <> — <span className="text-amber-500/80 italic">Stage 1 auto</span> <span className="line-through text-slate-600">{c.previous_text.length > 50 ? c.previous_text.slice(0, 50) + '…' : c.previous_text}</span> → <span className="text-amber-300">{c.corrected_text.length > 50 ? c.corrected_text.slice(0, 50) + '…' : c.corrected_text}</span></>
                          )}
                          {c.correction_type === 'speaker_reassign' && (
                            <> — Speaker reassigned: <span className="text-sky-400">S{c.previous_speaker_id} → S{c.new_speaker_id}</span></>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right meta + actions */}
                <div className="flex flex-col items-end gap-1.5 shrink-0 ml-2">
                  {/* Confidence */}
                  <div className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                    isLowConf ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-slate-500 bg-slate-900 border-slate-800'
                  }`}>
                    {Math.round(u.confidence * 100)}%
                  </div>

                  {/* Badges */}
                  <div className="flex gap-1">
                    {u.edited && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">EDITED</span>
                    )}
                  </div>

                  {/* Action buttons (visible on hover or during editing) */}
                  <div className={`flex gap-1 transition-opacity ${isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    {!isEditing && (
                      <button
                        onClick={() => startEdit(u)}
                        className="p-1 rounded-md bg-slate-800 hover:bg-sky-600 text-slate-400 hover:text-white transition-colors"
                        title="Edit text"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    )}

                    {/* Review state cycle */}
                    <div className="relative">
                      <select
                        value={u.review_state}
                        onChange={e => setReviewState(u, e.target.value as ReviewState)}
                        className={`appearance-none text-[9px] font-bold px-1.5 py-1 rounded-md border cursor-pointer focus:outline-none ${rs.bg} ${rs.color} ${rs.border}`}
                        title="Set review state"
                      >
                        <option value="unreviewed">Unreviewed</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="flagged">Flagged</option>
                        <option value="approved">Approved</option>
                      </select>
                    </div>

                    {/* History button */}
                    <button
                      onClick={() => loadCorrections(u.id)}
                      className={`p-1 rounded-md transition-colors ${showHistoryFor === u.id ? 'bg-sky-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200'}`}
                      title="View correction history"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div>{/* end main transcript column */}

      {/* Stage 2 AI Review Panel — slides in from the right */}
      {showAiPanel && (
        <div className="w-80 shrink-0 border-l border-slate-800 overflow-hidden flex flex-col">
          <AiReviewPanel
            jobId={job.id}
            utterances={utterances}
            onUtterancesChange={onUtterancesChange}
          />
        </div>
      )}

      {/* Word-Level Review Panel — full overlay */}
      {showWordReview && (
        <div className="absolute inset-0 z-30 bg-slate-950 flex flex-col">
          <WordReviewPanel
            job={job}
            utterances={utterances}
            speakerMappings={speakerMappings}
            onClose={() => setShowWordReview(false)}
          />
        </div>
      )}

      {/* Transcript Diff Viewer — full overlay */}
      {showDiffViewer && (
        <div className="absolute inset-0 z-30 bg-slate-950 flex flex-col">
          <TranscriptDiffViewer
            job={job}
            speakerMappings={speakerMappings}
            onClose={() => setShowDiffViewer(false)}
          />
        </div>
      )}
    </div>
  );
}
