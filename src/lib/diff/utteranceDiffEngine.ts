import type { Utterance } from '../database.types';
import { diffWordSequences, type WordDiffToken } from './wordDiffEngine';
import { flattenUtteranceWords } from './diffNormalization';

export type ChangeType =
  | 'insert'
  | 'delete'
  | 'modify'
  | 'speaker_change'
  | 'punctuation'
  | 'confidence_change'
  | 'no_change';

export type ChangeSource = 'deterministic' | 'ai' | 'human' | 'system';

export interface UtteranceDiffItem {
  changeId: string;
  changeType: ChangeType;
  originalText: string | null;
  modifiedText: string | null;
  speakerId: number;
  newSpeakerId: number | null;
  startTime: number;
  endTime: number;
  confidence: number;
  utteranceId: string | null;
  sourceStage: string;
  targetStage: string;
  changeSource: ChangeSource;
  aiRationale: string | null;
  aiRiskLevel: 'low' | 'medium' | 'high' | 'critical' | null;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  wordDiff: WordDiffToken[] | null;
}

let _seq = 0;
function nextId() { return `diff_${Date.now()}_${++_seq}`; }

/**
 * Compute structured diffs between two ordered lists of utterances.
 * Aligns by sequence_index and produces word-level diff tokens for each pair.
 */
export function diffUtterances(
  source: Utterance[],
  target: Utterance[],
  sourceStage: string,
  targetStage: string,
  changeSource: ChangeSource = 'system',
): UtteranceDiffItem[] {
  const results: UtteranceDiffItem[] = [];

  // Build lookup by sequence_index for O(1) alignment
  const sourceMap = new Map(source.map(u => [u.sequence_index, u]));
  const targetMap = new Map(target.map(u => [u.sequence_index, u]));

  const allIndexes = new Set([
    ...source.map(u => u.sequence_index),
    ...target.map(u => u.sequence_index),
  ]);

  for (const idx of Array.from(allIndexes).sort((a, b) => a - b)) {
    const src = sourceMap.get(idx) ?? null;
    const tgt = targetMap.get(idx) ?? null;

    if (!src && tgt) {
      // Pure insertion
      results.push({
        changeId: nextId(),
        changeType: 'insert',
        originalText: null,
        modifiedText: tgt.corrected_transcript ?? tgt.transcript,
        speakerId: tgt.speaker_id,
        newSpeakerId: null,
        startTime: tgt.start_time,
        endTime: tgt.end_time,
        confidence: tgt.confidence,
        utteranceId: tgt.id,
        sourceStage,
        targetStage,
        changeSource,
        aiRationale: null,
        aiRiskLevel: null,
        reviewStatus: 'pending',
        wordDiff: null,
      });
      continue;
    }

    if (src && !tgt) {
      // Pure deletion
      results.push({
        changeId: nextId(),
        changeType: 'delete',
        originalText: src.corrected_transcript ?? src.transcript,
        modifiedText: null,
        speakerId: src.speaker_id,
        newSpeakerId: null,
        startTime: src.start_time,
        endTime: src.end_time,
        confidence: src.confidence,
        utteranceId: src.id,
        sourceStage,
        targetStage,
        changeSource,
        aiRationale: null,
        aiRiskLevel: null,
        reviewStatus: 'pending',
        wordDiff: null,
      });
      continue;
    }

    if (!src || !tgt) continue;

    const srcText = src.corrected_transcript ?? src.transcript;
    const tgtText = tgt.corrected_transcript ?? tgt.transcript;
    const speakerChanged = src.speaker_id !== tgt.speaker_id;
    const textChanged = srcText !== tgtText;

    if (!speakerChanged && !textChanged) {
      // No visible change — skip to keep diff lists lean
      continue;
    }

    // Compute word-level diff
    const srcWords = flattenUtteranceWords([src]);
    const tgtWords = flattenUtteranceWords([tgt]);
    const wordDiff = diffWordSequences(srcWords, tgtWords);

    let changeType: ChangeType = 'no_change';
    if (speakerChanged && textChanged) changeType = 'modify';
    else if (speakerChanged) changeType = 'speaker_change';
    else if (textChanged) changeType = classifyTextChange(srcText, tgtText, wordDiff);

    results.push({
      changeId: nextId(),
      changeType,
      originalText: srcText,
      modifiedText: tgtText,
      speakerId: src.speaker_id,
      newSpeakerId: speakerChanged ? tgt.speaker_id : null,
      startTime: src.start_time,
      endTime: src.end_time,
      confidence: src.confidence,
      utteranceId: src.id,
      sourceStage,
      targetStage,
      changeSource,
      aiRationale: null,
      aiRiskLevel: null,
      reviewStatus: 'pending',
      wordDiff,
    });
  }

  return results;
}

function classifyTextChange(_src: string, _tgt: string, wordDiff: WordDiffToken[]): ChangeType {
  const hasPuncOnly = wordDiff.every(t => t.op === 'equal' || t.op === 'punctuation');
  if (hasPuncOnly) return 'punctuation';
  return 'modify';
}

/**
 * Assign AI metadata to diff items produced from AI suggestion stage.
 * Call this after diffUtterances when sourceStage = 'deterministic' and targetStage = 'ai_suggested'.
 */
export function annotateAiDiffs(
  items: UtteranceDiffItem[],
  suggestions: { utteranceId: string; reason: string; confidence: number }[],
): UtteranceDiffItem[] {
  const suggMap = new Map(suggestions.map(s => [s.utteranceId, s]));
  return items.map(item => {
    if (!item.utteranceId) return item;
    const sugg = suggMap.get(item.utteranceId);
    if (!sugg) return item;
    const risk = sugg.confidence >= 0.85 ? 'low'
      : sugg.confidence >= 0.7 ? 'medium'
      : sugg.confidence >= 0.5 ? 'high'
      : 'critical';
    return { ...item, aiRationale: sugg.reason, aiRiskLevel: risk as UtteranceDiffItem['aiRiskLevel'], changeSource: 'ai' as ChangeSource };
  });
}
