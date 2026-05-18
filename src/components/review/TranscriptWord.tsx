import React, { useState, useRef, useCallback } from 'react';
import type { TranscriptWord, ConfidenceTier, WordFlag } from '../../lib/database.types';
import { getConfidenceTier, CONFIDENCE_HIGH, CONFIDENCE_MED, CONFIDENCE_LOW } from '../../lib/database.types';

interface TranscriptWordProps {
  word: TranscriptWord;
  isActive: boolean;       // currently playing in audio
  isFocused: boolean;      // keyboard-selected in review queue
  speakerName: string;
  onClickWord: (word: TranscriptWord) => void;
  onEditWord: (word: TranscriptWord, newText: string) => Promise<void>;
  onMarkReviewed: (word: TranscriptWord) => Promise<void>;
  onToggleFlag: (word: TranscriptWord, flag: WordFlag) => Promise<void>;
}

// Confidence tier → visual styling
const TIER_STYLES: Record<ConfidenceTier, { text: string; bg: string; border: string; dot: string }> = {
  high:     { text: 'text-slate-200',   bg: '',                        border: '',                          dot: 'bg-emerald-500' },
  medium:   { text: 'text-amber-200',   bg: 'bg-amber-500/10',         border: 'border-b border-amber-400/40', dot: 'bg-amber-400' },
  low:      { text: 'text-orange-300',  bg: 'bg-orange-500/15',        border: 'border-b border-orange-400/60', dot: 'bg-orange-400' },
  critical: { text: 'text-rose-300',    bg: 'bg-rose-500/20',          border: 'border-b-2 border-rose-400',   dot: 'bg-rose-500' },
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tier = getConfidenceTier(value);
  const color = tier === 'high' ? 'bg-emerald-500' : tier === 'medium' ? 'bg-amber-400' : tier === 'low' ? 'bg-orange-400' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <div className="w-14 h-1 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] font-mono text-slate-400">{pct}%</span>
    </div>
  );
}

export default function TranscriptWordToken({
  word,
  isActive,
  isFocused,
  speakerName,
  onClickWord,
  onEditWord,
  onMarkReviewed,
  onToggleFlag,
}: TranscriptWordProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tier = getConfidenceTier(word.confidence);
  const styles = TIER_STYLES[tier];
  const displayText = word.corrected_text ?? word.punctuated_word ?? word.text;

  const startEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(displayText);
    setEditing(true);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 20);
  }, [displayText]);

  const commitEdit = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === displayText) { setEditing(false); return; }
    setSaving(true);
    try {
      await onEditWord(word, trimmed);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [editValue, displayText, onEditWord, word]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { commitEdit(); }
    if (e.key === 'Escape') { setEditing(false); }
    e.stopPropagation();
  }, [commitEdit]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(2);
    return `${m}:${sec.padStart(5, '0')}`;
  };

  if (editing) {
    return (
      <span className="inline-flex items-center mx-0.5">
        <input
          ref={inputRef}
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitEdit}
          disabled={saving}
          className="bg-sky-900 border border-sky-400 rounded px-1 py-0 text-xs font-mono text-sky-100 focus:outline-none min-w-[3rem] max-w-[12rem]"
          style={{ width: `${Math.max(3, editValue.length + 1)}ch` }}
        />
      </span>
    );
  }

  return (
    <span
      className="relative inline-flex items-start mx-[2px] group"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* The word token itself */}
      <span
        role="button"
        tabIndex={0}
        onClick={() => onClickWord(word)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClickWord(word); }}
        className={[
          'inline-block px-[3px] py-[1px] rounded cursor-pointer select-none transition-all duration-100',
          'text-[13px] leading-relaxed font-mono',
          styles.text,
          styles.bg,
          styles.border,
          isActive
            ? 'ring-1 ring-sky-400 bg-sky-400/20 text-sky-100 shadow-sm'
            : 'hover:bg-slate-700/60 hover:ring-1 hover:ring-slate-500',
          isFocused
            ? 'ring-2 ring-amber-400 bg-amber-500/10'
            : '',
          word.reviewed ? 'opacity-70' : '',
          word.edited ? 'italic' : '',
        ].filter(Boolean).join(' ')}
      >
        {displayText}
        {/* Reviewed check overlay */}
        {word.reviewed && (
          <span className="ml-0.5 text-[8px] text-emerald-500/60" aria-hidden>✓</span>
        )}
      </span>

      {/* Confidence dot — shown for non-high-confidence words */}
      {tier !== 'high' && (
        <span
          className={`absolute -top-1 -right-0.5 w-1.5 h-1.5 rounded-full ${styles.dot} ring-1 ring-slate-950 pointer-events-none`}
          aria-hidden
        />
      )}

      {/* Hover tooltip */}
      {showTooltip && (
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 pointer-events-none"
          role="tooltip"
        >
          <span className="flex flex-col gap-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 shadow-2xl min-w-[140px] text-left">
            {/* Original vs corrected */}
            <span className="text-[10px] font-bold text-slate-300 font-mono">
              {word.corrected_text ? (
                <>
                  <span className="line-through text-slate-500">{word.original_text ?? word.text}</span>
                  {' → '}
                  <span className="text-emerald-300">{word.corrected_text}</span>
                </>
              ) : (
                <span>{word.text}</span>
              )}
            </span>
            <ConfidenceBar value={word.confidence} />
            <span className="text-[9px] text-slate-500 font-mono">
              {formatTime(word.start_time)} – {formatTime(word.end_time)}
            </span>
            <span className="text-[9px] text-slate-500">{speakerName}</span>
            {word.flags.length > 0 && (
              <span className="flex gap-1 flex-wrap mt-0.5">
                {word.flags.map(f => (
                  <span key={f} className="text-[8px] px-1 py-0 rounded bg-amber-500/20 text-amber-300 border border-amber-500/25">{f}</span>
                ))}
              </span>
            )}
            {/* Tooltip actions */}
            <span className="flex gap-1 mt-1 pt-1 border-t border-slate-800">
              <button
                onPointerDown={e => { e.preventDefault(); onMarkReviewed(word); }}
                className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-500/20 transition-colors pointer-events-auto"
              >
                {word.reviewed ? 'Unmark' : 'Reviewed'}
              </button>
              <button
                onPointerDown={e => { e.preventDefault(); startEdit(e as unknown as React.MouseEvent); }}
                className="text-[9px] px-1.5 py-0.5 rounded bg-sky-600/20 hover:bg-sky-600/40 text-sky-400 border border-sky-500/20 transition-colors pointer-events-auto"
              >
                Edit
              </button>
              <button
                onPointerDown={e => { e.preventDefault(); onToggleFlag(word, 'review_required'); }}
                className="text-[9px] px-1.5 py-0.5 rounded bg-amber-600/20 hover:bg-amber-600/40 text-amber-400 border border-amber-500/20 transition-colors pointer-events-auto"
              >
                Flag
              </button>
            </span>
          </span>
          {/* Arrow */}
          <span className="block w-2 h-2 bg-slate-900 border-b border-r border-slate-700 rotate-45 mx-auto -mt-1.5" aria-hidden />
        </span>
      )}
    </span>
  );
}

// ─── Confidence legend component ─────────────────────────────────────────────

export function ConfidenceLegend() {
  return (
    <div className="flex items-center gap-4 text-[10px] text-slate-400">
      <span className="font-semibold text-slate-500 uppercase tracking-wider text-[9px]">Confidence</span>
      {[
        { tier: 'high' as ConfidenceTier,     label: `≥${Math.round(CONFIDENCE_HIGH * 100)}%`, color: 'bg-emerald-500' },
        { tier: 'medium' as ConfidenceTier,   label: `≥${Math.round(CONFIDENCE_MED * 100)}%`,  color: 'bg-amber-400' },
        { tier: 'low' as ConfidenceTier,      label: `≥${Math.round(CONFIDENCE_LOW * 100)}%`,  color: 'bg-orange-400' },
        { tier: 'critical' as ConfidenceTier, label: `<${Math.round(CONFIDENCE_LOW * 100)}%`,  color: 'bg-rose-500' },
      ].map(({ label, color }) => (
        <span key={label} className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full ${color}`} />
          {label}
        </span>
      ))}
    </div>
  );
}
