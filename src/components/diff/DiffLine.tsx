import type { UtteranceDiffItem } from '../../lib/diff/utteranceDiffEngine';
import WordDiff from './WordDiff';

interface DiffLineProps {
  item: UtteranceDiffItem;
  sourceSpeakerName: string;
  targetSpeakerName?: string;
  isFocused: boolean;
  onSelect: (item: UtteranceDiffItem) => void;
  onPlayRegion?: (start: number, end: number) => void;
}

const CHANGE_TYPE_STYLES: Record<string, { border: string; bg: string; badge: string; label: string }> = {
  insert:            { border: 'border-l-emerald-500', bg: 'bg-emerald-500/5',  badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', label: 'Inserted' },
  delete:            { border: 'border-l-rose-500',    bg: 'bg-rose-500/5',     badge: 'bg-rose-500/20 text-rose-300 border-rose-500/30',           label: 'Deleted' },
  modify:            { border: 'border-l-amber-500',   bg: 'bg-amber-500/5',    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',         label: 'Modified' },
  speaker_change:    { border: 'border-l-sky-500',     bg: 'bg-sky-500/5',      badge: 'bg-sky-500/20 text-sky-300 border-sky-500/30',               label: 'Speaker Change' },
  punctuation:       { border: 'border-l-slate-500',   bg: 'bg-slate-800/40',   badge: 'bg-slate-700 text-slate-400 border-slate-600',               label: 'Punctuation' },
  confidence_change: { border: 'border-l-teal-500',    bg: 'bg-teal-500/5',     badge: 'bg-teal-500/20 text-teal-300 border-teal-500/30',             label: 'Confidence' },
  no_change:         { border: 'border-l-slate-700',   bg: '',                  badge: 'bg-slate-800 text-slate-500 border-slate-700',               label: 'No Change' },
};

const RISK_BADGE: Record<string, string> = {
  critical: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  high:     'bg-orange-500/20 text-orange-300 border-orange-500/30',
  medium:   'bg-amber-500/20 text-amber-300 border-amber-500/30',
  low:      'bg-slate-700 text-slate-400 border-slate-600',
};

function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(1);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${sec.padStart(4,'0')}`;
  return `${m}:${sec.padStart(4,'0')}`;
}

export default function DiffLine({
  item,
  sourceSpeakerName,
  targetSpeakerName,
  isFocused,
  onSelect,
  onPlayRegion,
}: DiffLineProps) {
  const style = CHANGE_TYPE_STYLES[item.changeType] ?? CHANGE_TYPE_STYLES.modify;

  return (
    <div
      onClick={() => onSelect(item)}
      className={[
        'border-l-2 px-4 py-3 cursor-pointer transition-all',
        style.border,
        style.bg,
        'border-b border-slate-800/60',
        isFocused ? 'ring-1 ring-inset ring-sky-500/40' : 'hover:bg-slate-800/30',
      ].join(' ')}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {/* Change type badge */}
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${style.badge}`}>
          {style.label}
        </span>

        {/* AI source indicator */}
        {item.changeSource === 'ai' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-violet-500/15 text-violet-300 border-violet-500/30 font-semibold">
            AI
          </span>
        )}

        {/* Risk level */}
        {item.aiRiskLevel && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${RISK_BADGE[item.aiRiskLevel]}`}>
            {item.aiRiskLevel.toUpperCase()} RISK
          </span>
        )}

        {/* Speaker */}
        <span className="text-[10px] text-slate-500 font-mono">
          {sourceSpeakerName}
          {item.newSpeakerId !== null && targetSpeakerName && (
            <span className="ml-1 text-sky-400"> → {targetSpeakerName}</span>
          )}
        </span>

        {/* Timestamp */}
        <span className="text-[10px] font-mono text-slate-600 ml-auto">
          {formatTime(item.startTime)}
        </span>

        {/* Play button */}
        {onPlayRegion && item.startTime !== undefined && (
          <button
            onClick={e => { e.stopPropagation(); onPlayRegion(item.startTime, item.endTime); }}
            className="ml-1 w-5 h-5 rounded bg-slate-800 hover:bg-sky-600/30 border border-slate-700 hover:border-sky-500/40 flex items-center justify-center transition-colors"
            title="Play this region"
          >
            <svg className="w-2.5 h-2.5 text-slate-400 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
        )}
      </div>

      {/* Text diff area */}
      <div className="space-y-1.5">
        {/* Deleted text */}
        {(item.changeType === 'delete' || item.changeType === 'modify') && item.originalText && (
          <div className="flex gap-2">
            <span className="text-rose-500 font-mono text-[11px] shrink-0 mt-0.5 select-none">−</span>
            <p className="text-[12px] leading-relaxed font-mono text-rose-300 line-through decoration-rose-500/60">
              {item.originalText}
            </p>
          </div>
        )}

        {/* Inserted / modified text */}
        {(item.changeType === 'insert' || item.changeType === 'modify') && item.modifiedText && (
          <div className="flex gap-2">
            <span className="text-emerald-500 font-mono text-[11px] shrink-0 mt-0.5 select-none">+</span>
            <p className="text-[12px] leading-relaxed font-mono text-emerald-300">
              {item.modifiedText}
            </p>
          </div>
        )}

        {/* Punctuation or speaker change — show both side-by-side */}
        {(item.changeType === 'punctuation' || item.changeType === 'speaker_change') && (
          <div className="flex gap-3 items-start">
            {item.originalText && (
              <p className="text-[12px] font-mono text-slate-500 line-through decoration-slate-600/60">
                {item.originalText}
              </p>
            )}
            {item.modifiedText && (
              <>
                <span className="text-slate-600 text-[10px] mt-0.5">→</span>
                <p className="text-[12px] font-mono text-slate-300">{item.modifiedText}</p>
              </>
            )}
          </div>
        )}

        {/* Word-level inline diff */}
        {item.wordDiff && item.changeType === 'modify' && (
          <div className="mt-2 pt-2 border-t border-slate-800/60">
            <WordDiff tokens={item.wordDiff} />
          </div>
        )}
      </div>

      {/* AI rationale */}
      {item.aiRationale && (
        <p className="mt-2 text-[10px] text-violet-400/70 italic border-l border-violet-500/20 pl-2">
          AI: {item.aiRationale}
        </p>
      )}
    </div>
  );
}
