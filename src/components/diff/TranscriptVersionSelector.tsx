import React from 'react';
import type { TranscriptStage } from '../../lib/diff/transcriptDiffEngine';
import { stageLabel, stageBadgeClass, STAGE_ORDER } from '../../lib/diff/transcriptDiffEngine';
import type { TranscriptVersion } from '../../lib/diff/transcriptDiffEngine';

interface TranscriptVersionSelectorProps {
  versions: TranscriptVersion[];
  sourceStage: TranscriptStage;
  targetStage: TranscriptStage;
  onSourceChange: (s: TranscriptStage) => void;
  onTargetChange: (s: TranscriptStage) => void;
}

function VersionBadge({ stage, versions }: { stage: TranscriptStage; versions: TranscriptVersion[] }) {
  const v = versions.find(x => x.stage === stage);
  return (
    <div className={`flex flex-col gap-0.5 px-3 py-1.5 rounded border text-center min-w-0 ${stageBadgeClass(stage)}`}>
      <span className="text-[11px] font-bold truncate">{stageLabel(stage)}</span>
      {v ? (
        <span className="text-[9px] opacity-60 font-mono">{v.wordCount.toLocaleString()} words</span>
      ) : (
        <span className="text-[9px] opacity-40 italic">not available</span>
      )}
    </div>
  );
}

export default function TranscriptVersionSelector({
  versions,
  sourceStage,
  targetStage,
  onSourceChange,
  onTargetChange,
}: TranscriptVersionSelectorProps) {
  const availableStages = new Set(versions.map(v => v.stage));

  return (
    <div className="flex flex-col gap-3 p-4 bg-slate-900 border border-slate-800 rounded-xl">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Compare Stages</span>

      {/* Stage pipeline visualization */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STAGE_ORDER.map((stage, i) => {
          const available = availableStages.has(stage);
          const isSource = stage === sourceStage;
          const isTarget = stage === targetStage;
          return (
            <React.Fragment key={stage}>
              {i > 0 && (
                <svg className="w-3 h-3 text-slate-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
              <button
                disabled={!available}
                onClick={() => {
                  // Click sets source if not already source, then target
                  if (stage === sourceStage) return;
                  if (stage === targetStage) { onTargetChange(sourceStage); onSourceChange(stage); return; }
                  // If stage is after source, set as target; else set as new source
                  const srcIdx = STAGE_ORDER.indexOf(sourceStage);
                  const stageIdx = STAGE_ORDER.indexOf(stage);
                  if (stageIdx > srcIdx) onTargetChange(stage);
                  else { onSourceChange(stage); }
                }}
                className={[
                  'flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg border transition-all text-center min-w-[80px]',
                  !available ? 'opacity-30 cursor-not-allowed border-slate-800 bg-slate-900' :
                  isSource ? 'border-sky-500/40 bg-sky-500/10 ring-1 ring-sky-500/30' :
                  isTarget ? 'border-emerald-500/40 bg-emerald-500/10 ring-1 ring-emerald-500/30' :
                  `${stageBadgeClass(stage)} hover:opacity-90 cursor-pointer`,
                ].join(' ')}
                title={available ? `Select ${stageLabel(stage)}` : 'Stage not available'}
              >
                <span className="text-[10px] font-semibold leading-tight">{stageLabel(stage)}</span>
                {isSource && <span className="text-[8px] text-sky-400 uppercase tracking-wide">FROM</span>}
                {isTarget && <span className="text-[8px] text-emerald-400 uppercase tracking-wide">TO</span>}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Dropdowns for explicit selection */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[9px] uppercase tracking-wide text-slate-500 font-bold">From</label>
          <select
            value={sourceStage}
            onChange={e => onSourceChange(e.target.value as TranscriptStage)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-300 focus:outline-none focus:border-sky-500/50"
          >
            {STAGE_ORDER.filter(s => availableStages.has(s)).map(s => (
              <option key={s} value={s}>{stageLabel(s)}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[9px] uppercase tracking-wide text-slate-500 font-bold">To</label>
          <select
            value={targetStage}
            onChange={e => onTargetChange(e.target.value as TranscriptStage)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-300 focus:outline-none focus:border-emerald-500/50"
          >
            {STAGE_ORDER.filter(s => availableStages.has(s)).map(s => (
              <option key={s} value={s}>{stageLabel(s)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Version badges */}
      <div className="grid grid-cols-2 gap-2">
        <VersionBadge stage={sourceStage} versions={versions} />
        <VersionBadge stage={targetStage} versions={versions} />
      </div>
    </div>
  );
}
