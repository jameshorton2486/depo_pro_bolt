import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { AiSuggestion, AiSuggestionCategory, AiReviewStatus, Utterance } from '../lib/database.types';

interface AiReviewPanelProps {
  jobId: string;
  utterances: Utterance[];
  onUtterancesChange: (utterances: Utterance[]) => void;
}

// ─── Word-level diff ─────────────────────────────────────────────────────────

type DiffSegment =
  | { type: 'same'; text: string }
  | { type: 'removed'; text: string }
  | { type: 'added'; text: string };

function computeWordDiff(source: string, suggested: string): DiffSegment[] {
  const srcWords = source.split(/(\s+)/);
  const sugWords = suggested.split(/(\s+)/);
  const n = srcWords.length;
  const m = sugWords.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = srcWords[i] === sugWords[j]
        ? 1 + dp[i + 1][j + 1]
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && srcWords[i] === sugWords[j]) {
      segments.push({ type: 'same', text: srcWords[i++] });
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      segments.push({ type: 'added', text: sugWords[j++] });
    } else {
      segments.push({ type: 'removed', text: srcWords[i++] });
    }
  }

  // Collapse adjacent same-type segments
  return segments.reduce<DiffSegment[]>((acc, seg) => {
    const last = acc[acc.length - 1];
    if (last?.type === seg.type) { last.text += seg.text; return acc; }
    return [...acc, { ...seg }];
  }, []);
}

// ─── Category badge config ────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<AiSuggestionCategory, { label: string; color: string; bg: string; border: string }> = {
  punctuation:       { label: 'Punctuation',      color: 'text-sky-300',     bg: 'bg-sky-500/10',     border: 'border-sky-500/25' },
  sentence_boundary: { label: 'Sentence Boundary', color: 'text-violet-300',  bg: 'bg-violet-500/10',  border: 'border-violet-500/25' },
  speaker_drift:     { label: 'Speaker Drift',     color: 'text-amber-300',   bg: 'bg-amber-500/10',   border: 'border-amber-500/25' },
  proper_noun:       { label: 'Proper Noun',       color: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25' },
  interruption:      { label: 'Interruption',      color: 'text-orange-300',  bg: 'bg-orange-500/10',  border: 'border-orange-500/25' },
  low_confidence:    { label: 'Low Confidence',    color: 'text-rose-300',    bg: 'bg-rose-500/10',    border: 'border-rose-500/25' },
  fragment:          { label: 'Fragment',          color: 'text-slate-300',   bg: 'bg-slate-700/40',   border: 'border-slate-600/40' },
  review_required:   { label: 'Review Required',   color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30' },
};

// ─── Shared DB write helpers ──────────────────────────────────────────────────

async function insertCorrectionAudit(
  s: AiSuggestion,
  jobId: string,
  correctionType: 'ai_suggestion_accepted' | 'ai_suggestion_rejected',
  correctedText: string,
) {
  await supabase.from('utterance_corrections').insert({
    utterance_id: s.utterance_id,
    job_id: jobId,
    previous_text: s.source_text,
    corrected_text: correctedText,
    correction_type: correctionType,
    previous_speaker_id: null,
    new_speaker_id: null,
  });
}

async function applyUtteranceAcceptance(
  s: AiSuggestion,
  newText: string,
  now: string,
  originalTranscript: string,
) {
  await supabase.from('utterances').update({
    ai_reviewed_transcript: newText,
    ai_review_state: 'accepted',
    corrected_transcript: newText,
    edited: true,
    edited_at: now,
    original_transcript: originalTranscript,
  }).eq('id', s.utterance_id);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 55 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-slate-400">{pct}%</span>
    </div>
  );
}

function DiffView({ source, suggested }: { source: string; suggested: string }) {
  if (source === suggested) {
    return <span className="text-slate-400 text-xs italic">No text changes — metadata/flag only</span>;
  }
  const segments = computeWordDiff(source, suggested);
  return (
    <span className="font-mono text-sm leading-relaxed">
      {segments.map((seg, i) => {
        if (seg.type === 'removed') {
          return <span key={i} className="bg-rose-500/20 text-rose-300 line-through rounded px-0.5 mx-0.5">{seg.text}</span>;
        }
        if (seg.type === 'added') {
          return <span key={i} className="bg-emerald-500/20 text-emerald-300 rounded px-0.5 mx-0.5">{seg.text}</span>;
        }
        return <span key={i} className="text-slate-300">{seg.text}</span>;
      })}
    </span>
  );
}

interface SuggestionCardProps {
  suggestion: AiSuggestion;
  utterance: Utterance | undefined;
  onAccept: (s: AiSuggestion) => Promise<void>;
  onReject: (s: AiSuggestion) => Promise<void>;
  onEdit: (s: AiSuggestion, text: string) => Promise<void>;
}

function SuggestionCard({ suggestion: s, utterance, onAccept, onReject, onEdit }: SuggestionCardProps) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(s.suggested_text);
  const cat = CATEGORY_CONFIG[s.category] ?? CATEGORY_CONFIG.review_required;

  const speakerTime = utterance
    ? `${Math.floor(utterance.start_time / 60)}:${String(Math.floor(utterance.start_time % 60)).padStart(2, '0')}`
    : null;

  const handle = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div className={`rounded-xl border ${cat.border} ${cat.bg} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cat.border} ${cat.color}`}>
            {cat.label}
          </span>
          {speakerTime && <span className="text-[10px] font-mono text-slate-500">{speakerTime}</span>}
          <ConfidenceMeter value={s.confidence} />
        </div>
        {s.review_status !== 'pending' && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            s.review_status === 'accepted' || s.review_status === 'edited'
              ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/25'
              : 'text-rose-400 bg-rose-500/10 border border-rose-500/25'
          }`}>
            {s.review_status.toUpperCase()}
          </span>
        )}
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">{s.reason}</p>

      {s.has_change && (
        <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-800/60 space-y-2">
          <div className="text-[9px] font-bold tracking-widest text-slate-600 uppercase">Suggested Change</div>
          <DiffView source={s.source_text} suggested={s.suggested_text} />
        </div>
      )}

      {editing && (
        <textarea
          value={editText}
          onChange={e => setEditText(e.target.value)}
          rows={3}
          className="w-full bg-slate-950 border border-sky-500/40 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500 resize-none"
          autoFocus
        />
      )}

      {s.review_status === 'pending' && (
        <div className="flex gap-2">
          {s.has_change && !editing && (
            <button
              disabled={busy}
              onClick={() => handle(() => onAccept(s))}
              className="flex-1 py-1.5 text-[10px] font-bold bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 rounded-lg transition-all disabled:opacity-40"
            >
              Accept
            </button>
          )}
          {editing ? (
            <>
              <button
                disabled={busy || !editText.trim()}
                onClick={() => handle(() => onEdit(s, editText.trim()))}
                className="flex-1 py-1.5 text-[10px] font-bold bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 border border-sky-500/30 rounded-lg transition-all disabled:opacity-40"
              >
                Save Edit
              </button>
              <button
                disabled={busy}
                onClick={() => { setEditing(false); setEditText(s.suggested_text); }}
                className="py-1.5 px-3 text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 rounded-lg transition-all"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                disabled={busy}
                onClick={() => setEditing(true)}
                className="py-1.5 px-3 text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-all disabled:opacity-40"
              >
                Edit
              </button>
              <button
                disabled={busy}
                onClick={() => handle(() => onReject(s))}
                className="py-1.5 px-3 text-[10px] font-bold bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/20 rounded-lg transition-all disabled:opacity-40"
              >
                Reject
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

type PanelTab = 'suggestions' | 'run';
type FilterStatus = 'pending' | 'accepted' | 'rejected' | 'all';

export default function AiReviewPanel({ jobId, utterances, onUtterancesChange }: AiReviewPanelProps) {
  const [tab, setTab] = useState<PanelTab>('run');
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');
  const [filterCategory, setFilterCategory] = useState<AiSuggestionCategory | 'all'>('all');
  // Total utterances reviewed is server-reported (not derivable from suggestions which
  // are filtered to has_change:true only); kept as plain state, not derived.
  const [totalReviewed, setTotalReviewed] = useState<number | null>(null);

  const pendingCount = suggestions.filter(s => s.review_status === 'pending').length;
  const acceptedCount = suggestions.filter(s => s.review_status === 'accepted' || s.review_status === 'edited').length;
  const rejectedCount = suggestions.filter(s => s.review_status === 'rejected').length;

  const loadSuggestions = useCallback(async (runId?: string) => {
    setLoadingSuggestions(true);
    try {
      let q = supabase
        .from('ai_suggestions')
        .select('*')
        .eq('job_id', jobId)
        .eq('has_change', true)
        .order('created_at', { ascending: false });
      if (runId) q = q.eq('review_run_id', runId);
      const { data } = await q;
      if (data) setSuggestions(data as AiSuggestion[]);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [jobId]);

  const runReview = async () => {
    setRunning(true);
    setRunProgress('Sending transcript to AI review...');
    setTab('suggestions');
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/ai-review`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => 'unknown error');
        throw new Error(`AI review failed: ${err.slice(0, 200)}`);
      }
      const result = await res.json();
      setTotalReviewed(result.totalReviewed);
      setRunProgress(null);
      await loadSuggestions(result.reviewRunId);
      setFilterStatus('pending');
    } catch (err) {
      setRunProgress(`Error: ${String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const updateLocalSuggestion = (id: string, patch: Partial<AiSuggestion>) =>
    setSuggestions(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));

  const updateLocalUtterance = (utteranceId: string, patch: Partial<Utterance>) =>
    onUtterancesChange(utterances.map(u => u.id === utteranceId ? { ...u, ...patch } : u));

  const getOriginalTranscript = (utteranceId: string) => {
    const u = utterances.find(x => x.id === utteranceId);
    return u?.original_transcript ?? u?.transcript ?? '';
  };

  const handleAccept = useCallback(async (s: AiSuggestion) => {
    const now = new Date().toISOString();
    const uttPatch = {
      ai_reviewed_transcript: s.suggested_text,
      ai_review_state: 'accepted' as const,
      corrected_transcript: s.suggested_text,
      edited: true,
      edited_at: now,
      original_transcript: getOriginalTranscript(s.utterance_id),
    };
    await Promise.all([
      applyUtteranceAcceptance(s, s.suggested_text, now, uttPatch.original_transcript),
      insertCorrectionAudit(s, jobId, 'ai_suggestion_accepted', s.suggested_text),
      supabase.from('ai_suggestions').update({ review_status: 'accepted', reviewed_at: now }).eq('id', s.id),
    ]);
    updateLocalSuggestion(s.id, { review_status: 'accepted', reviewed_at: now });
    updateLocalUtterance(s.utterance_id, uttPatch);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, utterances]);

  const handleReject = useCallback(async (s: AiSuggestion) => {
    const now = new Date().toISOString();
    await Promise.all([
      supabase.from('ai_suggestions').update({ review_status: 'rejected', reviewed_at: now }).eq('id', s.id),
      supabase.from('utterances').update({ ai_review_state: 'rejected' }).eq('id', s.utterance_id),
      insertCorrectionAudit(s, jobId, 'ai_suggestion_rejected', s.source_text),
    ]);
    updateLocalSuggestion(s.id, { review_status: 'rejected', reviewed_at: now });
    updateLocalUtterance(s.utterance_id, { ai_review_state: 'rejected' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const handleEdit = useCallback(async (s: AiSuggestion, humanText: string) => {
    const now = new Date().toISOString();
    const originalTranscript = getOriginalTranscript(s.utterance_id);
    const uttPatch = {
      ai_reviewed_transcript: humanText,
      ai_review_state: 'accepted' as const,
      corrected_transcript: humanText,
      edited: true,
      edited_at: now,
      original_transcript: originalTranscript,
    };
    await Promise.all([
      applyUtteranceAcceptance(s, humanText, now, originalTranscript),
      supabase.from('ai_suggestions').update({ review_status: 'edited', human_edited_text: humanText, reviewed_at: now }).eq('id', s.id),
      insertCorrectionAudit(s, jobId, 'ai_suggestion_accepted', humanText),
    ]);
    updateLocalSuggestion(s.id, { review_status: 'edited', human_edited_text: humanText, reviewed_at: now });
    updateLocalUtterance(s.utterance_id, uttPatch);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, utterances]);

  const handleAcceptAll = useCallback(async () => {
    const pending = visibleSuggestions.filter(s => s.review_status === 'pending' && s.has_change);
    if (pending.length === 0) return;
    const now = new Date().toISOString();
    const ids = pending.map(s => s.id);
    const uttIds = pending.map(s => s.utterance_id);

    const correctionRows = pending.map(s => ({
      utterance_id: s.utterance_id,
      job_id: jobId,
      previous_text: s.source_text,
      corrected_text: s.suggested_text,
      correction_type: 'ai_suggestion_accepted' as const,
      previous_speaker_id: null,
      new_speaker_id: null,
    }));

    await Promise.all([
      // Bulk-update all affected utterances
      ...pending.map(s =>
        applyUtteranceAcceptance(s, s.suggested_text, now, getOriginalTranscript(s.utterance_id))
      ),
      // Single bulk insert for all audit rows
      supabase.from('utterance_corrections').insert(correctionRows),
      // Bulk mark suggestions accepted
      supabase.from('ai_suggestions').update({ review_status: 'accepted', reviewed_at: now }).in('id', ids),
      // Bulk update utterance ai_review_state
      supabase.from('utterances').update({ ai_review_state: 'accepted' }).in('id', uttIds),
    ]);

    const acceptedMap = new Map(pending.map(s => [s.utterance_id, s.suggested_text]));
    setSuggestions(prev => prev.map(s => ids.includes(s.id) ? { ...s, review_status: 'accepted' as AiReviewStatus, reviewed_at: now } : s));
    onUtterancesChange(utterances.map(u =>
      acceptedMap.has(u.id)
        ? { ...u, corrected_transcript: acceptedMap.get(u.id)!, ai_review_state: 'accepted' as const, edited: true, edited_at: now }
        : u
    ));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, utterances, suggestions, filterStatus, filterCategory]);

  const visibleSuggestions = suggestions.filter(s => {
    if (filterStatus !== 'all' && s.review_status !== filterStatus) return false;
    if (filterCategory !== 'all' && s.category !== filterCategory) return false;
    return true;
  });

  const usedCategories = [...new Set(suggestions.map(s => s.category))] as AiSuggestionCategory[];

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
            <span className="text-xs font-bold text-slate-200">Stage 2 AI Review</span>
          </div>
          <span className="text-[9px] text-slate-600 font-mono">Suggestion-only — never rewrites</span>
        </div>
        <div className="flex gap-1">
          {(['run', 'suggestions'] as PanelTab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); if (t === 'suggestions' && suggestions.length === 0) loadSuggestions(); }}
              className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${
                tab === t ? 'bg-sky-600 text-white' : 'bg-slate-900 text-slate-500 border border-slate-800 hover:text-slate-300'
              }`}
            >
              {t === 'suggestions' ? `Suggestions${pendingCount > 0 ? ` (${pendingCount})` : ''}` : 'Run Review'}
            </button>
          ))}
        </div>
      </div>

      {/* Tab: Run Review */}
      {tab === 'run' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-300">What AI Review Does</p>
            <ul className="space-y-1.5 text-[11px] text-slate-400">
              {[
                'Suggests punctuation corrections (commas, periods, dashes, ellipses)',
                'Flags probable speech-to-text recognition errors',
                'Identifies likely speaker diarization mistakes',
                'Suggests capitalization fixes for proper nouns',
                'Flags interruptions and sentence boundaries',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-emerald-500 mt-0.5">+</span>
                  {item}
                </li>
              ))}
            </ul>
            <div className="border-t border-slate-800 pt-3">
              <p className="text-xs font-semibold text-slate-300 mb-1.5">What AI Review Never Does</p>
              <ul className="space-y-1.5 text-[11px] text-slate-500">
                {[
                  'Remove filler words, stutters, or hesitations',
                  'Rewrite or paraphrase testimony',
                  'Silently apply any change — every suggestion requires your approval',
                  'Remove false starts or disfluencies',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-rose-500 mt-0.5">-</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {totalReviewed !== null && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex gap-4">
              <div className="text-center">
                <div className="text-lg font-bold text-slate-200">{totalReviewed}</div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider">Reviewed</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-sky-400">{suggestions.length}</div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider">Suggestions</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-emerald-400">{acceptedCount}</div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider">Accepted</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-rose-400">{rejectedCount}</div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider">Rejected</div>
              </div>
            </div>
          )}

          {runProgress && (
            <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl px-4 py-3 text-xs text-sky-300 flex items-center gap-2">
              <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {runProgress}
            </div>
          )}

          <button
            onClick={runReview}
            disabled={running || utterances.length === 0}
            className="w-full py-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-sky-600/10"
          >
            {running ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Running AI Review...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                </svg>
                Run Stage 2 AI Review
              </>
            )}
          </button>

          <p className="text-[10px] text-slate-600 text-center leading-relaxed">
            Reviews {utterances.length} utterances in batches of 8 with surrounding context.
            Approximately {Math.ceil(utterances.length / 8 * 6)} seconds.
          </p>
        </div>
      )}

      {/* Tab: Suggestions */}
      {tab === 'suggestions' && (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800/60 flex gap-2 flex-wrap shrink-0">
            <div className="flex gap-1">
              {(['pending', 'accepted', 'rejected', 'all'] as FilterStatus[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilterStatus(f)}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide transition-all ${
                    filterStatus === f ? 'bg-sky-600 text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            {usedCategories.length > 1 && (
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => setFilterCategory('all')}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide transition-all ${filterCategory === 'all' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:text-slate-400'}`}
                >
                  All types
                </button>
                {usedCategories.map(c => {
                  const cfg = CATEGORY_CONFIG[c];
                  return (
                    <button
                      key={c}
                      onClick={() => setFilterCategory(c)}
                      className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide transition-all border ${
                        filterCategory === c ? `${cfg.bg} ${cfg.color} ${cfg.border}` : 'text-slate-600 border-transparent hover:text-slate-400'
                      }`}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {loadingSuggestions && (
              <div className="text-center py-12 text-slate-600 text-xs">Loading suggestions...</div>
            )}
            {!loadingSuggestions && suggestions.length === 0 && (
              <div className="text-center py-12 space-y-2">
                <p className="text-slate-600 text-xs">No suggestions yet.</p>
                <button onClick={() => setTab('run')} className="text-sky-500 hover:text-sky-400 text-xs transition-colors">
                  Run AI Review to generate suggestions
                </button>
              </div>
            )}
            {!loadingSuggestions && suggestions.length > 0 && visibleSuggestions.length === 0 && (
              <div className="text-center py-12 text-slate-600 text-xs">
                No {filterStatus !== 'all' ? filterStatus : ''} suggestions
                {filterCategory !== 'all' ? ` in category "${filterCategory}"` : ''}.
              </div>
            )}
            {visibleSuggestions.map(s => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                utterance={utterances.find(u => u.id === s.utterance_id)}
                onAccept={handleAccept}
                onReject={handleReject}
                onEdit={handleEdit}
              />
            ))}
          </div>

          {pendingCount > 1 && filterStatus === 'pending' && (
            <div className="px-4 py-2 border-t border-slate-800/60 shrink-0">
              <button
                onClick={handleAcceptAll}
                className="w-full py-1.5 text-[10px] font-bold bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 rounded-lg transition-all"
              >
                Accept All {visibleSuggestions.filter(s => s.review_status === 'pending' && s.has_change).length} Visible Suggestions
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
