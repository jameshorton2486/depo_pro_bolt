import React, { useMemo, useCallback } from 'react';
import type { UtteranceDiffItem } from '../../lib/diff/utteranceDiffEngine';

interface DiffTimelineProps {
  items: UtteranceDiffItem[];
  totalDuration: number;
  currentTime: number;
  focusedChangeId: string | null;
  onSeek?: (seconds: number) => void;
  onSelectChange?: (item: UtteranceDiffItem) => void;
  height?: number;
}

const CHANGE_COLORS: Record<string, string> = {
  insert:         '#22c55e',
  delete:         '#ef4444',
  modify:         '#f59e0b',
  speaker_change: '#38bdf8',
  punctuation:    '#64748b',
  no_change:      '#1e293b',
};

export default function DiffTimeline({
  items,
  totalDuration,
  currentTime,
  focusedChangeId,
  onSeek,
  onSelectChange,
  height = 28,
}: DiffTimelineProps) {
  const playheadPct = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  // Build sparse markers — one per change item, positioned by start_time
  const markers = useMemo(() => {
    if (!totalDuration) return [];
    return items
      .filter(i => i.startTime != null && i.startTime <= totalDuration)
      .map(i => ({
        item: i,
        pct: (i.startTime / totalDuration) * 100,
        color: CHANGE_COLORS[i.changeType] ?? CHANGE_COLORS.modify,
        isHighRisk: i.aiRiskLevel === 'high' || i.aiRiskLevel === 'critical',
      }));
  }, [items, totalDuration]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!totalDuration || !onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, pct * totalDuration));
  }, [totalDuration, onSeek]);

  if (!totalDuration) return null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wide text-slate-600 font-bold">Change Timeline</span>
        <span className="text-[9px] text-slate-600 font-mono">{items.length} changes</span>
      </div>

      <div
        className="relative w-full rounded overflow-hidden cursor-pointer select-none bg-slate-900 border border-slate-800"
        style={{ height }}
        onClick={handleClick}
        role="slider"
        aria-label="Diff timeline — click to seek"
        title="Click to seek audio to this point"
      >
        {/* Change markers */}
        {markers.map(({ item, pct, color, isHighRisk }) => {
          const isFocused = item.changeId === focusedChangeId;
          return (
            <div
              key={item.changeId}
              className="absolute top-0 bottom-0 transition-all"
              style={{
                left: `${pct}%`,
                width: isHighRisk ? '3px' : '2px',
                backgroundColor: color,
                opacity: isFocused ? 1 : 0.7,
                zIndex: isFocused ? 5 : 1,
              }}
              onClick={e => {
                e.stopPropagation();
                onSelectChange?.(item);
                onSeek?.(item.startTime);
              }}
              title={`${item.changeType}: ${item.originalText?.slice(0, 40) ?? item.modifiedText?.slice(0, 40) ?? ''}`}
            >
              {isHighRisk && (
                <div
                  className="absolute -top-px left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
              )}
            </div>
          );
        })}

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-px bg-sky-400 pointer-events-none z-10"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="w-2 h-2 rounded-full bg-sky-400 -translate-x-[3px] -translate-y-px" />
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap">
        {Object.entries(CHANGE_COLORS).filter(([k]) => k !== 'no_change').map(([type, color]) => (
          <span key={type} className="flex items-center gap-1 text-[8px] text-slate-600">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
            {type.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
    </div>
  );
}
