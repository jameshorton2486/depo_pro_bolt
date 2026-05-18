import { useMemo } from 'react';
import type { UtteranceDiffItem } from '../../lib/diff/utteranceDiffEngine';

interface ReviewDecisionPanelProps {
  items: UtteranceDiffItem[];
  onBulkApprove: (changeIds: string[]) => void;
  onBulkReject: (changeIds: string[]) => void;
  selectedChangeIds: Set<string>;
  onToggleSelect: (changeId: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

export default function ReviewDecisionPanel({
  items,
  onBulkApprove,
  onBulkReject,
  selectedChangeIds,
  onToggleSelect: _onToggleSelect,
  onSelectAll,
  onClearSelection,
}: ReviewDecisionPanelProps) {
  const stats = useMemo(() => ({
    total: items.length,
    pending: items.filter(i => i.reviewStatus === 'pending').length,
    approved: items.filter(i => i.reviewStatus === 'approved').length,
    rejected: items.filter(i => i.reviewStatus === 'rejected').length,
    highRisk: items.filter(i => i.aiRiskLevel === 'high' || i.aiRiskLevel === 'critical').length,
  }), [items]);

  const selectedItems = items.filter(i => selectedChangeIds.has(i.changeId));
  const pendingSelected = selectedItems.filter(i => i.reviewStatus === 'pending');

  return (
    <div className="flex flex-col gap-3 p-4 bg-slate-900 border border-slate-800 rounded-xl">
      {/* Stats row */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">Review Status</span>
        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-semibold">
          {stats.pending} pending
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-semibold">
          {stats.approved} approved
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20 font-semibold">
          {stats.rejected} rejected
        </span>
        {stats.highRisk > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-orange-500/10 text-orange-300 border border-orange-500/20 font-semibold">
            {stats.highRisk} high-risk
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${stats.total > 0 ? (stats.approved / stats.total) * 100 : 0}%` }}
        />
        <div
          className="h-full bg-rose-500 transition-all"
          style={{ width: `${stats.total > 0 ? (stats.rejected / stats.total) * 100 : 0}%` }}
        />
      </div>

      {/* Selection controls */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500">
          {selectedChangeIds.size > 0 ? `${selectedChangeIds.size} selected` : 'No selection'}
        </span>
        <button
          onClick={onSelectAll}
          className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 transition-colors"
        >
          Select All Pending
        </button>
        {selectedChangeIds.size > 0 && (
          <button
            onClick={onClearSelection}
            className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Bulk actions */}
      {selectedChangeIds.size > 0 && (
        <div className="flex items-center gap-2">
          <button
            disabled={pendingSelected.length === 0}
            onClick={() => onBulkApprove(pendingSelected.map(i => i.changeId))}
            className="flex-1 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold transition-all disabled:opacity-40"
          >
            Approve {pendingSelected.length} Selected
          </button>
          <button
            disabled={pendingSelected.length === 0}
            onClick={() => onBulkReject(pendingSelected.map(i => i.changeId))}
            className="flex-1 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 text-[11px] font-bold transition-all disabled:opacity-40"
          >
            Reject {pendingSelected.length} Selected
          </button>
        </div>
      )}

      {/* Warning for high-risk unreviewed */}
      {stats.highRisk > 0 && stats.pending > 0 && (
        <div className="flex items-start gap-2 px-2 py-2 rounded bg-orange-500/8 border border-orange-500/20">
          <svg className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19h-17L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
          </svg>
          <p className="text-[10px] text-orange-300 leading-relaxed">
            {stats.highRisk} high-risk change{stats.highRisk !== 1 ? 's' : ''} require individual review before approval.
            Bulk-approve only after reviewing each high-risk item.
          </p>
        </div>
      )}
    </div>
  );
}
