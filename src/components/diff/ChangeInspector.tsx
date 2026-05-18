import React, { useState } from 'react';
import type { UtteranceDiffItem } from '../../lib/diff/utteranceDiffEngine';
import { stageLabel } from '../../lib/diff/transcriptDiffEngine';
import WordDiff from './WordDiff';
import { recordDiffReview } from '../../lib/diff/transcriptDiffEngine';

interface ChangeInspectorProps {
  item: UtteranceDiffItem;
  sourceSpeakerName: string;
  targetSpeakerName?: string;
  jobId: string;
  onReviewAction: (changeId: string, action: 'approve' | 'reject', note?: string) => void;
  onPlayRegion?: (start: number, end: number) => void;
}

function Field({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wide font-bold text-slate-500">{label}</span>
      <span className={`text-[11px] text-slate-300 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${sec.toFixed(2).padStart(5,'0')}`;
  return `${m}:${sec.toFixed(2).padStart(5,'0')}`;
}

const RISK_STYLES: Record<string, string> = {
  critical: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  high:     'bg-orange-500/20 text-orange-300 border-orange-500/30',
  medium:   'bg-amber-500/20 text-amber-300 border-amber-500/30',
  low:      'bg-slate-700 text-slate-400 border-slate-600',
};

export default function ChangeInspector({
  item,
  sourceSpeakerName,
  targetSpeakerName,
  jobId,
  onReviewAction,
  onPlayRegion,
}: ChangeInspectorProps) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAction = async (action: 'approve' | 'reject') => {
    setSubmitting(true);
    const prevStatus = item.reviewStatus;
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await recordDiffReview(item.changeId, jobId, action, note || undefined, prevStatus, newStatus);
    onReviewAction(item.changeId, action, note || undefined);
    setNote('');
    setSubmitting(false);
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2 shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Change Inspector</span>
        <span className={[
          'ml-auto text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase',
          item.reviewStatus === 'approved' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
          item.reviewStatus === 'rejected' ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' :
          'text-amber-300 bg-amber-500/10 border-amber-500/20',
        ].join(' ')}>
          {item.reviewStatus}
        </span>
      </div>

      <div className="px-4 py-3 space-y-4">
        {/* Change metadata */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Change Type" value={item.changeType.replace(/_/g, ' ')} />
          <Field label="Source" value={item.changeSource === 'ai' ? 'AI System' : item.changeSource} />
          <Field label="From Stage" value={stageLabel(item.sourceStage as Parameters<typeof stageLabel>[0])} />
          <Field label="To Stage" value={stageLabel(item.targetStage as Parameters<typeof stageLabel>[0])} />
        </div>

        {/* Timing */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Time" value={formatTime(item.startTime)} mono />
          <Field label="End Time" value={formatTime(item.endTime)} mono />
          <Field label="Confidence" value={`${Math.round(item.confidence * 100)}%`} mono />
          {item.aiRiskLevel && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-wide font-bold text-slate-500">Risk Level</span>
              <span className={`text-[11px] px-2 py-0.5 rounded border inline-block w-fit font-bold ${RISK_STYLES[item.aiRiskLevel]}`}>
                {item.aiRiskLevel.toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {/* Speaker */}
        <div>
          <span className="text-[9px] uppercase tracking-wide font-bold text-slate-500 block mb-1">Speaker Attribution</span>
          <div className="flex items-center gap-2 p-2 rounded bg-slate-900 border border-slate-800">
            <span className="text-[11px] text-slate-300">{sourceSpeakerName}</span>
            {item.newSpeakerId !== null && targetSpeakerName && (
              <>
                <svg className="w-3 h-3 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
                <span className="text-[11px] text-sky-300">{targetSpeakerName}</span>
              </>
            )}
          </div>
        </div>

        {/* Original text */}
        {item.originalText && (
          <div>
            <span className="text-[9px] uppercase tracking-wide font-bold text-slate-500 block mb-1">Original Text</span>
            <div className="p-2.5 rounded bg-rose-500/5 border border-rose-500/20">
              <p className="text-[12px] font-mono text-rose-200 leading-relaxed">{item.originalText}</p>
            </div>
          </div>
        )}

        {/* Modified text */}
        {item.modifiedText && (
          <div>
            <span className="text-[9px] uppercase tracking-wide font-bold text-slate-500 block mb-1">Modified Text</span>
            <div className="p-2.5 rounded bg-emerald-500/5 border border-emerald-500/20">
              <p className="text-[12px] font-mono text-emerald-200 leading-relaxed">{item.modifiedText}</p>
            </div>
          </div>
        )}

        {/* Word-level diff */}
        {item.wordDiff && item.wordDiff.length > 0 && (
          <div>
            <span className="text-[9px] uppercase tracking-wide font-bold text-slate-500 block mb-1">Word-Level Diff</span>
            <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
              <WordDiff tokens={item.wordDiff} />
            </div>
          </div>
        )}

        {/* AI rationale */}
        {item.aiRationale && (
          <div>
            <span className="text-[9px] uppercase tracking-wide font-bold text-slate-500 block mb-1">AI Rationale</span>
            <div className="p-2.5 rounded bg-violet-500/5 border border-violet-500/20">
              <p className="text-[11px] text-violet-300 italic leading-relaxed">{item.aiRationale}</p>
            </div>
          </div>
        )}

        {/* Audio playback */}
        {onPlayRegion && (
          <button
            onClick={() => onPlayRegion(Math.max(0, item.startTime - 5), item.endTime + 5)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-800 hover:bg-sky-600/20 border border-slate-700 hover:border-sky-500/30 text-slate-300 hover:text-sky-300 transition-all text-[11px] font-semibold"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
            Play Region (±5s context)
          </button>
        )}

        {/* Review actions */}
        <div className="pt-2 border-t border-slate-800 space-y-2">
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional reviewer note…"
            rows={2}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-[11px] text-slate-300 placeholder-slate-600 resize-none focus:outline-none focus:border-sky-500/50"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={submitting || item.reviewStatus === 'approved'}
              onClick={() => handleAction('approve')}
              className="py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold transition-all disabled:opacity-40"
            >
              Approve
            </button>
            <button
              disabled={submitting || item.reviewStatus === 'rejected'}
              onClick={() => handleAction('reject')}
              className="py-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 text-[11px] font-bold transition-all disabled:opacity-40"
            >
              Reject
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
