import { useMemo } from 'react';
import type { TranscriptWord, WordFlag } from '../../lib/database.types';
import { getConfidenceTier } from '../../lib/database.types';

interface ReviewSidebarProps {
  words: TranscriptWord[];
  focusedWordId: string | null;
  onJumpToWord: (word: TranscriptWord) => void;
  onMarkReviewed: (word: TranscriptWord) => Promise<void>;
  filterMode: ReviewFilter;
  onFilterChange: (f: ReviewFilter) => void;
}

export type ReviewFilter = 'all_flags' | 'critical' | 'low' | 'unreviewed' | 'edited';

const FLAG_LABELS: Record<WordFlag, string> = {
  low_confidence:  'Low Conf',
  proper_noun:     'Proper Noun',
  speaker_drift:   'Speaker Drift',
  interruption:    'Interruption',
  review_required: 'Review Required',
  approved:        'Approved',
};

interface QueueItem {
  word: TranscriptWord;
  tier: string;
  reason: string;
}

export default function ReviewSidebar({
  words,
  focusedWordId,
  onJumpToWord,
  onMarkReviewed,
  filterMode,
  onFilterChange,
}: ReviewSidebarProps) {
  const queue: QueueItem[] = useMemo(() => {
    const filtered = words.filter(w => {
      switch (filterMode) {
        case 'critical':    return w.confidence < 0.5;
        case 'low':         return w.confidence < 0.7;
        case 'unreviewed':  return w.confidence < 0.85 && !w.reviewed;
        case 'edited':      return w.edited;
        case 'all_flags':
        default:            return w.confidence < 0.85 || w.flags.length > 0 || w.edited;
      }
    });

    return filtered.map(w => ({
      word: w,
      tier: getConfidenceTier(w.confidence),
      reason: w.flags.length > 0
        ? FLAG_LABELS[w.flags[0]] ?? w.flags[0]
        : getConfidenceTier(w.confidence) === 'critical'
          ? 'Critical'
          : getConfidenceTier(w.confidence) === 'low'
            ? 'Low confidence'
            : 'Medium confidence',
    }));
  }, [words, filterMode]);

  const stats = useMemo(() => ({
    total:    words.length,
    reviewed: words.filter(w => w.reviewed).length,
    critical: words.filter(w => w.confidence < 0.5).length,
    low:      words.filter(w => w.confidence >= 0.5 && w.confidence < 0.7).length,
    edited:   words.filter(w => w.edited).length,
    flagged:  words.filter(w => w.flags.length > 0).length,
  }), [words]);

  const reviewPct = stats.total > 0
    ? Math.round((stats.reviewed / stats.total) * 100)
    : 0;

  const FILTERS: { key: ReviewFilter; label: string; count: number; color: string }[] = [
    { key: 'all_flags',  label: 'All Issues',  count: queue.length,    color: 'text-slate-300' },
    { key: 'critical',   label: 'Critical',    count: stats.critical,  color: 'text-rose-400' },
    { key: 'low',        label: 'Low Conf',    count: stats.low + stats.critical, color: 'text-amber-400' },
    { key: 'unreviewed', label: 'Unreviewed',  count: words.filter(w => w.confidence < 0.85 && !w.reviewed).length, color: 'text-sky-400' },
    { key: 'edited',     label: 'Edited',      count: stats.edited,    color: 'text-emerald-400' },
  ];

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(1);
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${sec.padStart(4,'0')}`;
    return `${m}:${sec.padStart(4,'0')}`;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      {/* Header stats */}
      <div className="px-3 py-3 border-b border-slate-800 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Review Queue</span>
          <span className="text-[10px] text-slate-500 font-mono">{stats.reviewed}/{stats.total}</span>
        </div>
        {/* Progress bar */}
        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-sky-500 rounded-full transition-all duration-500"
            style={{ width: `${reviewPct}%` }}
          />
        </div>
        <div className="text-[9px] text-slate-600 text-right">{reviewPct}% reviewed</div>

        {/* Stat pills */}
        <div className="grid grid-cols-3 gap-1">
          {[
            { label: 'Critical', val: stats.critical, color: 'text-rose-400 bg-rose-500/10' },
            { label: 'Low',      val: stats.low,      color: 'text-amber-400 bg-amber-500/10' },
            { label: 'Edited',   val: stats.edited,   color: 'text-emerald-400 bg-emerald-500/10' },
          ].map(s => (
            <div key={s.label} className={`text-center rounded-md py-1 ${s.color}`}>
              <div className="text-sm font-bold">{s.val}</div>
              <div className="text-[8px] uppercase tracking-wide">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter chips */}
      <div className="px-3 py-2 flex flex-wrap gap-1 border-b border-slate-800 shrink-0">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => onFilterChange(f.key)}
            className={[
              'px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide transition-all',
              filterMode === f.key
                ? 'bg-sky-600 text-white'
                : `${f.color} bg-slate-900 border border-slate-800 hover:border-slate-700`,
            ].join(' ')}
          >
            {f.label}
            {f.count > 0 && <span className="ml-1 opacity-70">{f.count}</span>}
          </button>
        ))}
      </div>

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto">
        {queue.length === 0 && (
          <div className="text-center py-12 text-slate-600 text-xs">
            {filterMode === 'edited' ? 'No edits yet.' : 'No flagged words.'}
          </div>
        )}
        {queue.map(({ word, tier, reason }) => {
          const isFocused = word.id === focusedWordId;
          const tierColor =
            tier === 'critical' ? 'border-l-rose-500 bg-rose-500/5' :
            tier === 'low'      ? 'border-l-orange-400 bg-orange-500/5' :
            tier === 'medium'   ? 'border-l-amber-400 bg-amber-500/5' :
                                  'border-l-slate-600 bg-slate-900/40';

          return (
            <div
              key={word.id}
              onClick={() => onJumpToWord(word)}
              className={[
                'flex flex-col gap-0.5 px-3 py-2 border-l-2 border-b border-slate-800/60 cursor-pointer transition-all',
                tierColor,
                isFocused ? 'ring-1 ring-inset ring-sky-500/40 bg-sky-500/5' : 'hover:bg-slate-800/40',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={[
                  'text-[12px] font-mono font-semibold',
                  word.edited ? 'italic' : '',
                  tier === 'critical' ? 'text-rose-300' : tier === 'low' ? 'text-orange-300' : tier === 'medium' ? 'text-amber-200' : 'text-slate-200',
                ].join(' ')}>
                  {word.corrected_text ?? word.punctuated_word ?? word.text}
                </span>
                <span className="text-[9px] font-mono text-slate-500 shrink-0 tabular-nums">
                  {formatTime(word.start_time)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-slate-500">{reason}</span>
                <span className="text-[9px] font-mono text-slate-600">
                  {Math.round(word.confidence * 100)}%
                </span>
              </div>
              {word.flags.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-0.5">
                  {word.flags.slice(0, 3).map(f => (
                    <span key={f} className="text-[8px] px-1 rounded bg-slate-800 text-slate-400 border border-slate-700">
                      {FLAG_LABELS[f] ?? f}
                    </span>
                  ))}
                </div>
              )}
              {/* Reviewed toggle */}
              <button
                onClick={e => { e.stopPropagation(); onMarkReviewed(word); }}
                className={[
                  'self-start mt-0.5 text-[8px] px-1.5 py-0.5 rounded border transition-colors',
                  word.reviewed
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                    : 'text-slate-500 bg-slate-900 border-slate-800 hover:border-slate-700',
                ].join(' ')}
              >
                {word.reviewed ? '✓ Reviewed' : 'Mark reviewed'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
