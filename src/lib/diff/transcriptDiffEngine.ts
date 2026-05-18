import type { Utterance, SpeakerMapping, AiSuggestion } from '../database.types';
import { diffUtterances, annotateAiDiffs, type UtteranceDiffItem, type ChangeSource } from './utteranceDiffEngine';
import { extractSpeakerChanges, type SpeakerChangeRecord } from './speakerDiffEngine';
import { supabase } from '../supabase';

export type TranscriptStage =
  | 'raw'
  | 'grouped'
  | 'deterministic'
  | 'ai_suggested'
  | 'approved'
  | 'exported';

export interface TranscriptVersion {
  id: string;
  jobId: string;
  stage: TranscriptStage;
  versionNumber: number;
  utterancesSnapshot: Utterance[];
  wordCount: number;
  createdBy: string;
  notes: string | null;
  createdAt: string;
}

export interface DiffResult {
  sourceStage: TranscriptStage;
  targetStage: TranscriptStage;
  items: UtteranceDiffItem[];
  speakerChanges: SpeakerChangeRecord[];
  summary: {
    total: number;
    insertions: number;
    deletions: number;
    modifications: number;
    punctuationChanges: number;
    speakerChanges: number;
    aiGenerated: number;
    highRisk: number;
  };
}

/** Source of truth for stage ordering */
const STAGE_ORDER: TranscriptStage[] = [
  'raw', 'grouped', 'deterministic', 'ai_suggested', 'approved', 'exported',
];

export function stageLabel(stage: TranscriptStage): string {
  const labels: Record<TranscriptStage, string> = {
    raw: 'Raw Deepgram',
    grouped: 'Speaker Grouped',
    deterministic: 'Deterministic Cleanup',
    ai_suggested: 'AI Suggestions',
    approved: 'Approved',
    exported: 'Final Export',
  };
  return labels[stage];
}

export function stageColor(stage: TranscriptStage): string {
  const colors: Record<TranscriptStage, string> = {
    raw: 'text-slate-400',
    grouped: 'text-sky-400',
    deterministic: 'text-teal-400',
    ai_suggested: 'text-violet-400',
    approved: 'text-emerald-400',
    exported: 'text-amber-400',
  };
  return colors[stage];
}

export function stageBadgeClass(stage: TranscriptStage): string {
  const classes: Record<TranscriptStage, string> = {
    raw: 'bg-slate-800 text-slate-300 border-slate-700',
    grouped: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    deterministic: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
    ai_suggested: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
    approved: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    exported: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  };
  return classes[stage];
}

/**
 * Persist a transcript version snapshot to the DB.
 * Call this each time utterances advance to a new stage.
 */
export async function persistTranscriptVersion(
  jobId: string,
  stage: TranscriptStage,
  utterances: Utterance[],
  createdBy = 'system',
  notes?: string,
): Promise<string | null> {
  const wordCount = utterances.reduce((sum, u) => {
    const text = u.corrected_transcript ?? u.transcript;
    return sum + text.trim().split(/\s+/).filter(Boolean).length;
  }, 0);

  const { data, error } = await supabase
    .from('transcript_versions')
    .insert({
      job_id: jobId,
      stage,
      utterances_snapshot: utterances as unknown as Record<string, unknown>[],
      word_count: wordCount,
      created_by: createdBy,
      notes: notes ?? null,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[DiffEngine] Failed to persist version:', error.message);
    return null;
  }
  return data?.id ?? null;
}

/** Load all versions for a job, ordered by creation time */
export async function loadTranscriptVersions(jobId: string): Promise<TranscriptVersion[]> {
  const { data, error } = await supabase
    .from('transcript_versions')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];

  return data.map(row => ({
    id: row.id,
    jobId: row.job_id,
    stage: row.stage as TranscriptStage,
    versionNumber: row.version_number,
    utterancesSnapshot: (row.utterances_snapshot as unknown as Utterance[]) ?? [],
    wordCount: row.word_count,
    createdBy: row.created_by,
    notes: row.notes,
    createdAt: row.created_at,
  }));
}

/** Load most recent version for a given stage */
export async function loadVersionForStage(
  jobId: string,
  stage: TranscriptStage,
): Promise<TranscriptVersion | null> {
  const { data, error } = await supabase
    .from('transcript_versions')
    .select('*')
    .eq('job_id', jobId)
    .eq('stage', stage)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    jobId: data.job_id,
    stage: data.stage as TranscriptStage,
    versionNumber: data.version_number,
    utterancesSnapshot: (data.utterances_snapshot as unknown as Utterance[]) ?? [],
    wordCount: data.word_count,
    createdBy: data.created_by,
    notes: data.notes,
    createdAt: data.created_at,
  };
}

/** Compute a full diff between two transcript versions */
export function computeDiff(
  source: TranscriptVersion,
  target: TranscriptVersion,
  speakerMappings: SpeakerMapping[],
  aiSuggestions?: AiSuggestion[],
): DiffResult {
  const changeSource = deriveChangeSource(source.stage, target.stage);

  let items = diffUtterances(
    source.utterancesSnapshot,
    target.utterancesSnapshot,
    source.stage,
    target.stage,
    changeSource,
  );

  if (changeSource === 'ai' && aiSuggestions) {
    items = annotateAiDiffs(
      items,
      aiSuggestions.map(s => ({
        utteranceId: s.utterance_id,
        reason: s.reason,
        confidence: s.confidence,
      })),
    );
  }

  const speakerChanges = extractSpeakerChanges(items, speakerMappings);

  const summary = {
    total: items.length,
    insertions: items.filter(i => i.changeType === 'insert').length,
    deletions: items.filter(i => i.changeType === 'delete').length,
    modifications: items.filter(i => i.changeType === 'modify').length,
    punctuationChanges: items.filter(i => i.changeType === 'punctuation').length,
    speakerChanges: items.filter(i => i.changeType === 'speaker_change').length,
    aiGenerated: items.filter(i => i.changeSource === 'ai').length,
    highRisk: items.filter(i => i.aiRiskLevel === 'high' || i.aiRiskLevel === 'critical').length,
  };

  return { sourceStage: source.stage, targetStage: target.stage, items, speakerChanges, summary };
}

function deriveChangeSource(_src: TranscriptStage, tgt: TranscriptStage): ChangeSource {
  if (tgt === 'ai_suggested') return 'ai';
  if (tgt === 'deterministic') return 'deterministic';
  if (tgt === 'approved') return 'human';
  return 'system';
}

/** Persist diff items to the DB */
export async function persistDiffItems(
  jobId: string,
  sourceVersionId: string,
  targetVersionId: string,
  items: UtteranceDiffItem[],
): Promise<void> {
  if (items.length === 0) return;

  const rows = items.map(item => ({
    job_id: jobId,
    source_version_id: sourceVersionId,
    target_version_id: targetVersionId,
    source_stage: item.sourceStage,
    target_stage: item.targetStage,
    utterance_id: item.utteranceId,
    change_type: item.changeType,
    original_text: item.originalText,
    modified_text: item.modifiedText,
    speaker_id: item.speakerId,
    new_speaker_id: item.newSpeakerId,
    start_time: item.startTime,
    end_time: item.endTime,
    confidence: item.confidence,
    change_source: item.changeSource,
    ai_rationale: item.aiRationale,
    ai_risk_level: item.aiRiskLevel,
    review_status: item.reviewStatus,
  }));

  // Insert in batches of 200
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await supabase.from('transcript_diffs').insert(batch);
    if (error) console.error('[DiffEngine] Failed to persist diffs batch:', error.message);
  }
}

/** Load persisted diffs for a job, optionally filtered by stage pair */
export async function loadPersistedDiffs(
  jobId: string,
  sourceStage?: TranscriptStage,
  targetStage?: TranscriptStage,
): Promise<UtteranceDiffItem[]> {
  let query = supabase
    .from('transcript_diffs')
    .select('*')
    .eq('job_id', jobId)
    .order('start_time', { ascending: true });

  if (sourceStage) query = query.eq('source_stage', sourceStage);
  if (targetStage) query = query.eq('target_stage', targetStage);

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map(row => ({
    changeId: row.id,
    changeType: row.change_type as UtteranceDiffItem['changeType'],
    originalText: row.original_text,
    modifiedText: row.modified_text,
    speakerId: row.speaker_id ?? 0,
    newSpeakerId: row.new_speaker_id,
    startTime: row.start_time ?? 0,
    endTime: row.end_time ?? 0,
    confidence: row.confidence ?? 1,
    utteranceId: row.utterance_id,
    sourceStage: row.source_stage,
    targetStage: row.target_stage,
    changeSource: row.change_source as ChangeSource,
    aiRationale: row.ai_rationale,
    aiRiskLevel: row.ai_risk_level as UtteranceDiffItem['aiRiskLevel'],
    reviewStatus: row.review_status as UtteranceDiffItem['reviewStatus'],
    wordDiff: null, // not persisted; recomputed on demand
  }));
}

/** Write a reviewer decision for a diff item */
export async function recordDiffReview(
  diffId: string,
  jobId: string,
  action: 'approve' | 'reject' | 'flag' | 'comment',
  note?: string,
  previousStatus?: string,
  newStatus?: string,
): Promise<void> {
  await supabase.from('diff_reviews').insert({
    diff_id: diffId,
    job_id: jobId,
    action,
    reviewer_note: note ?? null,
    previous_status: previousStatus ?? null,
    new_status: newStatus ?? null,
  });
}

export { STAGE_ORDER };
