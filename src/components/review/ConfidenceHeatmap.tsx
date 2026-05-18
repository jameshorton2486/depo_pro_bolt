import React, { useMemo, useCallback } from 'react';
import type { TranscriptWord } from '../../lib/database.types';
import { getConfidenceTier } from '../../lib/database.types';

interface ConfidenceHeatmapProps {
  words: TranscriptWord[];
  totalDuration: number;
  currentTime: number;
  onSeek: (seconds: number) => void;
  height?: number;
}

const TIER_COLORS: Record<string, string> = {
  high:     '#22c55e20', // emerald very faint
  medium:   '#f59e0b60', // amber
  low:      '#f97316a0', // orange
  critical: '#ef4444',   // rose solid
};

export default function ConfidenceHeatmap({
  words,
  totalDuration,
  currentTime,
  onSeek,
  height = 20,
}: ConfidenceHeatmapProps) {
  // Build 200-bucket histogram for performance
  const BUCKETS = 300;
  const buckets = useMemo(() => {
    if (!totalDuration || words.length === 0) return null;
    const arr: { minConf: number; count: number; hasLow: boolean }[] = Array.from(
      { length: BUCKETS },
      () => ({ minConf: 1, count: 0, hasLow: false })
    );
    for (const w of words) {
      const idx = Math.min(BUCKETS - 1, Math.floor((w.start_time / totalDuration) * BUCKETS));
      arr[idx].count++;
      if (w.confidence < arr[idx].minConf) arr[idx].minConf = w.confidence;
      if (w.confidence < 0.7) arr[idx].hasLow = true;
    }
    return arr;
  }, [words, totalDuration]);

  const lowConfWordCount = useMemo(
    () => words.filter(w => w.confidence < 0.7).length,
    [words]
  );
  const criticalWordCount = useMemo(
    () => words.filter(w => w.confidence < 0.5).length,
    [words]
  );
  const unreviewedLowCount = useMemo(
    () => words.filter(w => w.confidence < 0.7 && !w.reviewed).length,
    [words]
  );

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!totalDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, pct * totalDuration));
  }, [totalDuration, onSeek]);

  const playheadPct = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  if (!buckets) {
    return (
      <div className="h-5 bg-slate-900 rounded border border-slate-800 border-dashed flex items-center justify-center text-[9px] text-slate-600">
        No word data
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Stats row */}
      <div className="flex items-center gap-4 text-[10px]">
        <span className="text-slate-500">{words.length.toLocaleString()} words</span>
        {lowConfWordCount > 0 && (
          <span className="flex items-center gap-1 text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            {lowConfWordCount} low conf
          </span>
        )}
        {criticalWordCount > 0 && (
          <span className="flex items-center gap-1 text-rose-400">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            {criticalWordCount} critical
          </span>
        )}
        {unreviewedLowCount > 0 && (
          <span className="text-slate-500">{unreviewedLowCount} unreviewed flags</span>
        )}
      </div>

      {/* Heatmap bar */}
      <div
        className="relative w-full rounded overflow-hidden cursor-pointer select-none"
        style={{ height }}
        onClick={handleClick}
        title="Click to seek audio"
        role="slider"
        aria-label="Confidence heatmap — click to seek"
      >
        {/* Background */}
        <div className="absolute inset-0 bg-slate-900 rounded" />

        {/* Confidence segments */}
        <div className="absolute inset-0 flex">
          {buckets.map((b, i) => {
            const tier = getConfidenceTier(b.minConf);
            const color = b.count === 0 ? 'transparent' : TIER_COLORS[tier];
            return (
              <div
                key={i}
                style={{
                  width: `${100 / BUCKETS}%`,
                  backgroundColor: color,
                  height: b.count > 0 ? `${Math.min(100, 40 + b.count * 15)}%` : '0%',
                  alignSelf: 'flex-end',
                }}
              />
            );
          })}
        </div>

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-px bg-sky-400 pointer-events-none z-10"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="w-2 h-2 rounded-full bg-sky-400 -translate-x-[3px] -translate-y-px" />
        </div>
      </div>
    </div>
  );
}
