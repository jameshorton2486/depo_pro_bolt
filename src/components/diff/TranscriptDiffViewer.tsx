import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TranscriptionJob, SpeakerMapping, AiSuggestion } from '../../lib/database.types';
import type { TranscriptStage, TranscriptVersion, DiffResult } from '../../lib/diff/transcriptDiffEngine';
import type { UtteranceDiffItem } from '../../lib/diff/utteranceDiffEngine';
import {
  loadTranscriptVersions,
  loadVersionForStage,
  computeDiff,
  recordDiffReview,
  stageLabel,
} from '../../lib/diff/transcriptDiffEngine';
import { supabase } from '../../lib/supabase';
import TranscriptVersionSelector from './TranscriptVersionSelector';
import DiffLine from './DiffLine';
import DiffSidebar, { type DiffFilter } from './DiffSidebar';
import ChangeInspector from './ChangeInspector';
import DiffTimeline from './DiffTimeline';
import DiffPlaybackControls, { type DiffPlaybackHandle } from './DiffPlaybackControls';
import ReviewDecisionPanel from './ReviewDecisionPanel';

interface TranscriptDiffViewerProps {
  job: TranscriptionJob;
  speakerMappings: SpeakerMapping[];
  onClose: () => void;
}

export default function TranscriptDiffViewer({
  job,
  speakerMappings,
  onClose,
}: TranscriptDiffViewerProps) {
  const [versions, setVersions] = useState<TranscriptVersion[]>([]);
  const [sourceStage, setSourceStage] = useState<TranscriptStage>('raw');
  const [targetStage, setTargetStage] = useState<TranscriptStage>('deterministic');
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [filter, setFilter] = useState<DiffFilter>('all');
  const [focusedChangeId, setFocusedChangeId] = useState<string | null>(null);
  const [selectedChangeIds, setSelectedChangeIds] = useState<Set<string>>(new Set());
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [activePanel, setActivePanel] = useState<'sidebar' | 'inspector' | 'review'>('sidebar');

  const audioRef = useRef<DiffPlaybackHandle>(null);
  const listParentRef = useRef<HTMLDivElement>(null);
  const speakerNameMap = useMemo(
    () => new Map(speakerMappings.map(m => [m.speaker_id, m.mapped_name])),
    [speakerMappings],
  );
  const getName = (id: number) => speakerNameMap.get(id) ?? `Speaker ${id}`;

  // Load versions and audio URL
  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      const [versionData, signedUrl] = await Promise.all([
        loadTranscriptVersions(job.id),
        supabase.storage.from('audio-files').createSignedUrl(job.storage_path, 3600)
          .then(r => r.data?.signedUrl ?? null),
      ]);
      if (cancelled) return;
      setVersions(versionData);
      setAudioUrl(signedUrl);

      // Pick sensible defaults
      const available = new Set(versionData.map(v => v.stage));
      const defaultSrc = (['raw', 'grouped', 'deterministic'] as TranscriptStage[]).find(s => available.has(s));
      const defaultTgt = (['approved', 'ai_suggested', 'deterministic'] as TranscriptStage[]).find(s => available.has(s) && s !== defaultSrc);
      if (defaultSrc) setSourceStage(defaultSrc);
      if (defaultTgt) setTargetStage(defaultTgt);
      setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, [job.id, job.storage_path]);

  // Compute diff whenever stage selection changes
  useEffect(() => {
    if (versions.length === 0) return;
    let cancelled = false;
    async function run() {
      setComputing(true);
      const [src, tgt] = await Promise.all([
        loadVersionForStage(job.id, sourceStage),
        loadVersionForStage(job.id, targetStage),
      ]);
      if (cancelled || !src || !tgt) { setComputing(false); return; }

      // Load AI suggestions if relevant
      let aiSuggestions: AiSuggestion[] | undefined;
      if (targetStage === 'ai_suggested') {
        const { data } = await supabase
          .from('ai_suggestions')
          .select('*')
          .eq('job_id', job.id);
        aiSuggestions = (data as AiSuggestion[] | null) ?? undefined;
      }

      const result = computeDiff(src, tgt, speakerMappings, aiSuggestions);
      if (!cancelled) {
        setDiffResult(result);
        setFocusedChangeId(null);
        setSelectedChangeIds(new Set());
      }
      setComputing(false);
    }
    run();
    return () => { cancelled = true; };
  }, [versions, sourceStage, targetStage, job.id, speakerMappings]);

  const filteredItems = useMemo(() => {
    if (!diffResult) return [];
    switch (filter) {
      case 'insert':         return diffResult.items.filter(i => i.changeType === 'insert');
      case 'delete':         return diffResult.items.filter(i => i.changeType === 'delete');
      case 'modify':         return diffResult.items.filter(i => i.changeType === 'modify');
      case 'speaker_change': return diffResult.items.filter(i => i.changeType === 'speaker_change');
      case 'punctuation':    return diffResult.items.filter(i => i.changeType === 'punctuation');
      case 'ai':             return diffResult.items.filter(i => i.changeSource === 'ai');
      case 'high_risk':      return diffResult.items.filter(i => i.aiRiskLevel === 'high' || i.aiRiskLevel === 'critical');
      case 'pending':        return diffResult.items.filter(i => i.reviewStatus === 'pending');
      case 'approved':       return diffResult.items.filter(i => i.reviewStatus === 'approved');
      case 'rejected':       return diffResult.items.filter(i => i.reviewStatus === 'rejected');
      default:               return diffResult.items;
    }
  }, [diffResult, filter]);

  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 100,
    overscan: 10,
  });

  const focusedItem = useMemo(
    () => diffResult?.items.find(i => i.changeId === focusedChangeId) ?? null,
    [diffResult, focusedChangeId],
  );

  const handleSelectChange = useCallback((item: UtteranceDiffItem) => {
    setFocusedChangeId(item.changeId);
    setActivePanel('inspector');
    if (item.startTime != null) audioRef.current?.seekTo(item.startTime);
    // Scroll virtual list to item
    const idx = filteredItems.findIndex(i => i.changeId === item.changeId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' });
  }, [filteredItems, virtualizer]);

  const handleReviewAction = useCallback((changeId: string, action: 'approve' | 'reject') => {
    if (!diffResult) return;
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    setDiffResult(prev => prev ? {
      ...prev,
      items: prev.items.map(i => i.changeId === changeId ? { ...i, reviewStatus: newStatus } : i),
    } : prev);
  }, [diffResult]);

  const handleBulkApprove = useCallback(async (changeIds: string[]) => {
    for (const id of changeIds) {
      await recordDiffReview(id, job.id, 'approve', undefined, 'pending', 'approved');
    }
    const idSet = new Set(changeIds);
    setDiffResult(prev => prev ? {
      ...prev,
      items: prev.items.map(i => idSet.has(i.changeId) ? { ...i, reviewStatus: 'approved' } : i),
    } : prev);
    setSelectedChangeIds(new Set());
  }, [job.id]);

  const handleBulkReject = useCallback(async (changeIds: string[]) => {
    for (const id of changeIds) {
      await recordDiffReview(id, job.id, 'reject', undefined, 'pending', 'rejected');
    }
    const idSet = new Set(changeIds);
    setDiffResult(prev => prev ? {
      ...prev,
      items: prev.items.map(i => idSet.has(i.changeId) ? { ...i, reviewStatus: 'rejected' } : i),
    } : prev);
    setSelectedChangeIds(new Set());
  }, [job.id]);

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 shrink-0 bg-slate-900">
        <span className="text-sm font-bold text-slate-200">Transcript Diff Viewer</span>
        {diffResult && (
          <span className="text-[11px] text-slate-500">
            {stageLabel(sourceStage)} → {stageLabel(targetStage)}
            <span className="ml-2 text-slate-600">({diffResult.summary.total} changes)</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition-colors border border-slate-700"
          >
            Close
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <svg className="w-6 h-6 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <span className="text-[11px] text-slate-500">Loading transcript versions…</span>
          </div>
        </div>
      ) : versions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm space-y-3 px-6">
            <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <p className="text-slate-400 text-sm font-semibold">No transcript versions yet</p>
            <p className="text-slate-600 text-xs leading-relaxed">
              Transcript versions are automatically captured as you process and review this deposition.
              Re-run processing stages to generate version history.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Diff list */}
          <div className="flex flex-col flex-1 overflow-hidden border-r border-slate-800">
            {/* Version selector + audio */}
            <div className="px-4 py-3 border-b border-slate-800 shrink-0 space-y-3">
              <TranscriptVersionSelector
                versions={versions}
                sourceStage={sourceStage}
                targetStage={targetStage}
                onSourceChange={setSourceStage}
                onTargetChange={setTargetStage}
              />
              <DiffPlaybackControls
                ref={audioRef}
                audioUrl={audioUrl}
                onTimeUpdate={setCurrentTime}
                onReady={setDuration}
              />
              {diffResult && duration > 0 && (
                <DiffTimeline
                  items={diffResult.items}
                  totalDuration={duration}
                  currentTime={currentTime}
                  focusedChangeId={focusedChangeId}
                  onSeek={t => audioRef.current?.seekTo(t)}
                  onSelectChange={handleSelectChange}
                />
              )}
            </div>

            {/* Diff lines */}
            {computing ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <svg className="w-4 h-4 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Computing diff…
                </div>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-slate-600 text-xs">
                  {diffResult?.summary.total === 0 ? 'No differences between these stages.' : 'No changes match this filter.'}
                </p>
              </div>
            ) : (
              <div ref={listParentRef} className="flex-1 overflow-y-auto">
                <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                  {virtualizer.getVirtualItems().map(vRow => {
                    const item = filteredItems[vRow.index];
                    return (
                      <div
                        key={item.changeId}
                        data-index={vRow.index}
                        ref={virtualizer.measureElement}
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vRow.start}px)` }}
                      >
                        <DiffLine
                          item={item}
                          sourceSpeakerName={getName(item.speakerId)}
                          targetSpeakerName={item.newSpeakerId != null ? getName(item.newSpeakerId) : undefined}
                          isFocused={item.changeId === focusedChangeId}
                          onSelect={handleSelectChange}
                          onPlayRegion={(s, e) => audioRef.current?.playRegion(s, e)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right panel */}
          <div className="w-72 shrink-0 flex flex-col overflow-hidden">
            {/* Panel tab bar */}
            <div className="flex border-b border-slate-800 shrink-0">
              {([
                { key: 'sidebar', label: 'Queue' },
                { key: 'inspector', label: 'Inspector' },
                { key: 'review', label: 'Decisions' },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActivePanel(tab.key)}
                  className={[
                    'flex-1 py-2 text-[10px] font-bold uppercase tracking-wide transition-colors',
                    activePanel === tab.key
                      ? 'text-sky-400 border-b-2 border-sky-500 -mb-px'
                      : 'text-slate-500 hover:text-slate-300',
                  ].join(' ')}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-hidden">
              {activePanel === 'sidebar' && diffResult && (
                <DiffSidebar
                  result={diffResult}
                  filter={filter}
                  onFilterChange={setFilter}
                  focusedChangeId={focusedChangeId}
                  onJumpTo={handleSelectChange}
                />
              )}
              {activePanel === 'inspector' && focusedItem ? (
                <ChangeInspector
                  item={focusedItem}
                  sourceSpeakerName={getName(focusedItem.speakerId)}
                  targetSpeakerName={focusedItem.newSpeakerId != null ? getName(focusedItem.newSpeakerId) : undefined}
                  jobId={job.id}
                  onReviewAction={handleReviewAction}
                  onPlayRegion={(s, e) => audioRef.current?.playRegion(s, e)}
                />
              ) : activePanel === 'inspector' ? (
                <div className="flex items-center justify-center h-full text-slate-600 text-xs">
                  Select a change to inspect.
                </div>
              ) : null}
              {activePanel === 'review' && diffResult && (
                <div className="overflow-y-auto h-full p-3">
                  <ReviewDecisionPanel
                    items={diffResult.items}
                    onBulkApprove={handleBulkApprove}
                    onBulkReject={handleBulkReject}
                    selectedChangeIds={selectedChangeIds}
                    onToggleSelect={id => setSelectedChangeIds(prev => {
                      const next = new Set(prev);
                      next.has(id) ? next.delete(id) : next.add(id);
                      return next;
                    })}
                    onSelectAll={() => {
                      const pending = diffResult.items.filter(i => i.reviewStatus === 'pending').map(i => i.changeId);
                      setSelectedChangeIds(new Set(pending));
                    }}
                    onClearSelection={() => setSelectedChangeIds(new Set())}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
