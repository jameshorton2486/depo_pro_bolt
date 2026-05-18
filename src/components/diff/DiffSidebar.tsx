import { useMemo } from 'react';
import type { UtteranceDiffItem } from '../../lib/diff/utteranceDiffEngine';
import type { DiffResult } from '../../lib/diff/transcriptDiffEngine';

export type DiffFilter = 'all' | 'insert' | 'delete' | 'modify' | 'speaker_change' | 'punctuation' | 'ai' | 'high_risk' | 'pending' | 'approved' | 'rejected';

interface DiffSidebarProps {
  result: DiffResult;
  filter: DiffFilter;
  onFilterChange: (f: DiffFilter) => void;
  focusedChangeId: string | null;
  onJumpTo: (item: UtteranceDiffItem) => void;
}

const FILTER_CONFIG: { key: DiffFilter; label: string; color: string; getCount: (r: DiffResult) => number }[] = [
  { key: 'all',            label: 'All Changes',    color: 'text-slate-300', getCount: r => r.summary.total },
  { key: 'delete',         label: 'Deletions',      color: 'text-rose-400',    getCount: r => r.summary.deletions },
  { key: 'insert',         label: 'Insertions',     color: 'text-emerald-400', getCount: r => r.summary.insertions },
  { key: 'modify',         label: 'Modifications',  color: 'text-amber-400',   getCount: r => r.summary.modifications },
  { key: 'speaker_change', label: 'Speaker Changes',color: 'text-sky-400',     getCount: r => r.summary.speakerChanges },
  { key: 'punctuation',    label: 'Punctuation',    color: 'text-slate-400',   getCount: r => r.summary.punctuationChanges },
  { key: 'ai',             label: 'AI Generated',   color: 'text-violet-400',  getCount: r => r.summary.aiGenerated },
  { key: 'high_risk',      label: 'High Risk',      color: 'text-orange-400',  getCount: r => r.summary.highRisk },
  { key: 'pending',        label: 'Pending Review', color: 'text-amber-300',   getCount: r => r.items.filter(i => i.reviewStatus === 'pending').length },
  { key: 'approved',       label: 'Approved',       color: 'text-emerald-300', getCount: r => r.items.filter(i => i.reviewStatus === 'approved').length },
  { key: 'rejected',       label: 'Rejected',       color: 'text-rose-300',    getCount: r => r.items.filter(i => i.reviewStatus === 'rejected').length },
];

const CHANGE_COLORS: Record<string, string> = {
  insert:         'border-l-emerald-500 text-emerald-300',
  delete:         'border-l-rose-500 text-rose-300',
  modify:         'border-l-amber-500 text-amber-300',
  speaker_change: 'border-l-sky-500 text-sky-300',
  punctuation:    'border-l-slate-500 text-slate-400',
  no_change:      'border-l-slate-700 text-slate-600',
};

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(0).padStart(2, '0');
  return `${m}:${sec}`;
}

export default function DiffSidebar({
  result,
  filter,
  onFilterChange,
  focusedChangeId,
  onJumpTo,
}: DiffSidebarProps) {
  const filteredItems = useMemo(() => {
    switch (filter) {
      case 'insert':         return result.items.filter(i => i.changeType === 'insert');
      case 'delete':         return result.items.filter(i => i.changeType === 'delete');
      case 'modify':         return result.items.filter(i => i.changeType === 'modify');
      case 'speaker_change': return result.items.filter(i => i.changeType === 'speaker_change');
      case 'punctuation':    return result.items.filter(i => i.changeType === 'punctuation');
      case 'ai':             return result.items.filter(i => i.changeSource === 'ai');
      case 'high_risk':      return result.items.filter(i => i.aiRiskLevel === 'high' || i.aiRiskLevel === 'critical');
      case 'pending':        return result.items.filter(i => i.reviewStatus === 'pending');
      case 'approved':       return result.items.filter(i => i.reviewStatus === 'approved');
      case 'rejected':       return result.items.filter(i => i.reviewStatus === 'rejected');
      default:               return result.items;
    }
  }, [result.items, filter]);

  const reviewedCount = result.items.filter(i => i.reviewStatus !== 'pending').length;
  const reviewPct = result.summary.total > 0 ? Math.round((reviewedCount / result.summary.total) * 100) : 0;

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Summary stats */}
      <div className="px-3 py-3 border-b border-slate-800 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Diff Summary</span>
          <span className="text-[10px] text-slate-500 font-mono">{result.summary.total} changes</span>
        </div>
        {/* Review progress */}
        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${reviewPct}%` }} />
        </div>
        <div className="text-[9px] text-slate-600 text-right">{reviewPct}% reviewed</div>

        {/* Stat pills */}
        <div className="grid grid-cols-2 gap-1">
          {[
            { label: 'Deleted',  val: result.summary.deletions,   color: 'text-rose-400 bg-rose-500/10' },
            { label: 'Inserted', val: result.summary.insertions,  color: 'text-emerald-400 bg-emerald-500/10' },
            { label: 'Modified', val: result.summary.modifications, color: 'text-amber-400 bg-amber-500/10' },
            { label: 'AI',       val: result.summary.aiGenerated, color: 'text-violet-400 bg-violet-500/10' },
          ].map(s => (
            <div key={s.label} className={`text-center rounded-md py-1 ${s.color}`}>
              <div className="text-sm font-bold">{s.val}</div>
              <div className="text-[8px] uppercase tracking-wide">{s.label}</div>
            </div>
          ))}
        </div>

        {result.summary.highRisk > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-orange-500/10 border border-orange-500/20">
            <svg className="w-3 h-3 text-orange-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19h-17L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
            </svg>
            <span className="text-[10px] text-orange-300 font-semibold">{result.summary.highRisk} high-risk changes</span>
          </div>
        )}
      </div>

      {/* Filter chips */}
      <div className="px-3 py-2 flex flex-wrap gap-1 border-b border-slate-800 shrink-0">
        {FILTER_CONFIG.map(fc => {
          const count = fc.getCount(result);
          if (count === 0 && fc.key !== 'all') return null;
          return (
            <button
              key={fc.key}
              onClick={() => onFilterChange(fc.key)}
              className={[
                'px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide transition-all',
                filter === fc.key
                  ? 'bg-sky-600 text-white'
                  : `${fc.color} bg-slate-900 border border-slate-800 hover:border-slate-700`,
              ].join(' ')}
            >
              {fc.label}
              {count > 0 && <span className="ml-1 opacity-70">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto">
        {filteredItems.length === 0 && (
          <div className="text-center py-12 text-slate-600 text-xs">No changes match this filter.</div>
        )}
        {filteredItems.map(item => {
          const colorClass = CHANGE_COLORS[item.changeType] ?? CHANGE_COLORS.modify;
          const isFocused = item.changeId === focusedChangeId;

          return (
            <div
              key={item.changeId}
              onClick={() => onJumpTo(item)}
              className={[
                'flex flex-col gap-0.5 px-3 py-2 border-l-2 border-b border-slate-800/60 cursor-pointer transition-all',
                colorClass,
                isFocused ? 'ring-1 ring-inset ring-sky-500/40 bg-sky-500/5' : 'hover:bg-slate-800/40',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono font-semibold truncate">
                  {item.originalText?.slice(0, 40) ?? item.modifiedText?.slice(0, 40) ?? '—'}
                  {((item.originalText?.length ?? 0) > 40 || (item.modifiedText?.length ?? 0) > 40) && '…'}
                </span>
                <span className="text-[9px] font-mono text-slate-500 shrink-0">{formatTime(item.startTime)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500 capitalize">{item.changeType.replace(/_/g, ' ')}</span>
                {item.changeSource === 'ai' && (
                  <span className="text-[8px] text-violet-400 font-bold">AI</span>
                )}
                {item.aiRiskLevel && item.aiRiskLevel !== 'low' && (
                  <span className="text-[8px] text-orange-400 font-bold uppercase">{item.aiRiskLevel}</span>
                )}
                <span className={[
                  'ml-auto text-[8px] px-1.5 py-0.5 rounded border font-semibold uppercase',
                  item.reviewStatus === 'approved' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                  item.reviewStatus === 'rejected' ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' :
                  'text-slate-500 bg-slate-800 border-slate-700',
                ].join(' ')}>
                  {item.reviewStatus}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
