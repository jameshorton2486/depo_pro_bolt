// Shared transcript processing helpers used by transcribe-callback.
// Extracted from transcribe-audio to keep both functions lean.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeepgramOptions {
  smart_format: boolean;
  diarize: boolean;
  punctuate: boolean;
  paragraphs: boolean;
  utterances: boolean;
  filler_words: boolean;
  numerals: boolean;
  utt_split: number;
  keyterms: string[];
}

export interface RawUtterance {
  id?: string;
  speaker: number;
  start: number;
  end: number;
  transcript: string;
  confidence: number;
  words?: unknown[];
  part_index?: number;
}

export interface SpeakerTurn {
  speaker_id: number;
  start_time: number;
  end_time: number;
  joined_text: string;
  confidence: number;
  sequence_index: number;
  member_count: number;
  source_utterance_ids: string[];
  member_utterances: RawUtterance[];
  grouping_meta: GroupingMeta;
}

export interface GroupingMeta {
  threshold_used: number;
  gaps: number[];
  merge_reasons: string[];
  had_terminal_punct_split: boolean;
  had_overlap_split: boolean;
}

export interface GroupingDebugEntry {
  raw_index: number;
  speaker_id: number;
  start: number;
  end: number;
  gap_to_next: number | null;
  confidence: number;
  transcript_preview: string;
  merge_decision: "merge" | "split_speaker" | "split_gap" | "split_punct" | "split_overlap" | "boundary";
  turn_index: number;
}

export interface TranscriptPartRow {
  part_index: number;
  raw_result: Record<string, unknown>;
  duration_seconds: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const USE_SPEAKER_TURN_GROUPING = true;
export const GROUPING_VERSION = 1;
export const DEFAULT_GAP_THRESHOLD = 1.2;
const TERMINAL_PUNCT_RE = /[.!?]\s*$/;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function joinTexts(prev: string, next: string): string {
  if (!prev) return next;
  if (!next) return prev;
  const sep = TERMINAL_PUNCT_RE.test(prev) ? "  " : " ";
  return prev + sep + next;
}

export function extractRawUtterances(dgResult: Record<string, unknown>): RawUtterance[] {
  try {
    const results = dgResult?.results as Record<string, unknown>;
    if (!results) return [];

    const utterances = results?.utterances as RawUtterance[];
    if (Array.isArray(utterances) && utterances.length > 0) {
      return utterances.map(u => ({
        speaker: u.speaker ?? 0,
        start: u.start ?? 0,
        end: u.end ?? 0,
        transcript: u.transcript ?? "",
        confidence: u.confidence ?? 0,
        words: u.words ?? [],
      }));
    }

    const channels = results?.channels as Array<Record<string, unknown>>;
    if (Array.isArray(channels) && channels.length > 0) {
      const alternatives = channels[0]?.alternatives as Array<Record<string, unknown>>;
      if (Array.isArray(alternatives) && alternatives.length > 0) {
        const words = alternatives[0]?.words as Array<Record<string, unknown>>;
        if (Array.isArray(words)) {
          const grouped: RawUtterance[] = [];
          let current: RawUtterance | null = null;
          for (const word of words) {
            const speaker = (word.speaker as number) ?? 0;
            if (!current || current.speaker !== speaker) {
              if (current) grouped.push(current);
              current = {
                speaker,
                start: word.start as number ?? 0,
                end: word.end as number ?? 0,
                transcript: (word.word as string) ?? "",
                confidence: (word.confidence as number) ?? 0.9,
                words: [word],
              };
            } else {
              current.end = (word.end as number) ?? current.end;
              current.transcript += ` ${word.word ?? ""}`;
              current.words!.push(word);
            }
          }
          if (current) grouped.push(current);
          return grouped;
        }
      }
    }
  } catch (_e) {
    // fall through
  }
  return [];
}

export function shiftWordTimes(words: unknown[], offset: number): unknown[] {
  return (words ?? []).map(w => {
    const r = { ...(w as Record<string, unknown>) };
    if (typeof r.start === "number") r.start = r.start + offset;
    if (typeof r.end === "number") r.end = r.end + offset;
    return r;
  });
}

export function groupSpeakerTurns(
  rawUtterances: RawUtterance[],
  gapThreshold: number = DEFAULT_GAP_THRESHOLD,
): { turns: SpeakerTurn[]; debugLog: GroupingDebugEntry[] } {
  if (rawUtterances.length === 0) return { turns: [], debugLog: [] };

  const turns: SpeakerTurn[] = [];
  const debugLog: GroupingDebugEntry[] = [];

  let currentTurn: SpeakerTurn | null = null;
  let turnIndex = 0;

  for (let i = 0; i < rawUtterances.length; i++) {
    const u = rawUtterances[i];
    const next = rawUtterances[i + 1] ?? null;
    const gapToNext = next !== null ? +(next.start - u.end).toFixed(4) : null;

    let mergeDecision: GroupingDebugEntry["merge_decision"] = "boundary";

    if (currentTurn !== null) {
      const prevU = currentTurn.member_utterances[currentTurn.member_utterances.length - 1];
      const gap = +(u.start - prevU.end).toFixed(4);
      const speakerChanged = u.speaker !== currentTurn.speaker_id;
      const gapTooLarge = gap > gapThreshold;
      const hasOverlap = u.start < prevU.end;

      if (speakerChanged) mergeDecision = "split_speaker";
      else if (hasOverlap) mergeDecision = "split_overlap";
      else if (gapTooLarge) mergeDecision = "split_gap";
      else mergeDecision = "merge";
    }

    if (currentTurn === null || mergeDecision !== "merge") {
      if (currentTurn !== null) {
        turns.push(currentTurn);
        turnIndex++;
      }
      currentTurn = {
        speaker_id: u.speaker,
        start_time: u.start,
        end_time: u.end,
        joined_text: u.transcript,
        confidence: u.confidence,
        sequence_index: turnIndex,
        member_count: 1,
        source_utterance_ids: [],
        member_utterances: [{ ...u }],
        grouping_meta: {
          threshold_used: gapThreshold,
          gaps: [],
          merge_reasons: [],
          had_terminal_punct_split: false,
          had_overlap_split: mergeDecision === "split_overlap",
        },
      };
    } else {
      const prevU = currentTurn.member_utterances[currentTurn.member_utterances.length - 1];
      const gap = +(u.start - prevU.end).toFixed(4);
      const hadTerminal = TERMINAL_PUNCT_RE.test(prevU.transcript);
      currentTurn.end_time = Math.max(currentTurn.end_time, u.end);
      currentTurn.joined_text = joinTexts(currentTurn.joined_text, u.transcript);
      currentTurn.confidence = Math.min(currentTurn.confidence, u.confidence);
      currentTurn.member_count += 1;
      currentTurn.member_utterances.push({ ...u });
      currentTurn.grouping_meta.gaps.push(gap);
      currentTurn.grouping_meta.merge_reasons.push(
        hadTerminal ? `gap=${gap}s (terminal punct, continued)` : `gap=${gap}s (fragment continued)`,
      );
      if (!currentTurn.grouping_meta.had_terminal_punct_split && hadTerminal) {
        currentTurn.grouping_meta.had_terminal_punct_split = true;
      }
    }

    debugLog.push({
      raw_index: i,
      speaker_id: u.speaker,
      start: u.start,
      end: u.end,
      gap_to_next: gapToNext,
      confidence: u.confidence,
      transcript_preview: u.transcript.slice(0, 120),
      merge_decision: currentTurn !== null && mergeDecision === "merge" ? "merge" : mergeDecision === "boundary" ? "boundary" : mergeDecision,
      turn_index: turnIndex,
    });
  }

  if (currentTurn !== null) turns.push(currentTurn);

  return { turns, debugLog };
}

// ---------------------------------------------------------------------------
// Finalization pass — called by transcribe-callback when all parts land
// ---------------------------------------------------------------------------

export async function finalizeTranscript(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  parts: TranscriptPartRow[],
): Promise<void> {
  const pipelineStart = Date.now();
  console.log(`[PIPELINE] Finalize start for job ${jobId} with ${parts.length} part(s)`);

  // Step A — sort parts by index (should already be ordered but be safe)
  const sortedParts = [...parts].sort((a, b) => a.part_index - b.part_index);

  // Step B — compute cumulative time offsets
  const cumulativeOffsets: number[] = [];
  let running = 0;
  for (const p of sortedParts) {
    cumulativeOffsets[p.part_index] = running;
    running += Number(p.duration_seconds);
  }
  const totalDuration = running;
  console.log(`[PIPELINE] Total duration: ${totalDuration.toFixed(1)}s across ${sortedParts.length} part(s)`);

  // Step C — build flat globally-sequenced utterance list
  const allUtterances: RawUtterance[] = [];
  let globalSequence = 0;

  for (const part of sortedParts) {
    const offset = cumulativeOffsets[part.part_index];
    const rawUtterances = extractRawUtterances(part.raw_result);
    for (const u of rawUtterances) {
      allUtterances.push({
        ...u,
        start: u.start + offset,
        end: u.end + offset,
        words: shiftWordTimes(u.words ?? [], offset),
        part_index: part.part_index,
      });
      globalSequence++;
    }
  }

  console.log(`[PIPELINE] ${allUtterances.length} total utterances across all parts`);

  // Step D — insert utterances in batches of 100
  const utteranceRows = allUtterances.map((u, idx) => ({
    job_id: jobId,
    part_index: u.part_index ?? 0,
    speaker_id: u.speaker,
    start_time: u.start,
    end_time: u.end,
    transcript: u.transcript,
    confidence: u.confidence,
    words: u.words ?? [],
    sequence_index: idx,
  }));

  const insertedIds: string[] = [];
  for (let i = 0; i < utteranceRows.length; i += 100) {
    const { data: inserted, error } = await supabase
      .from("utterances")
      .insert(utteranceRows.slice(i, i + 100))
      .select("id");
    if (error) {
      console.error(`[PIPELINE] Utterance insert error batch ${i}:`, error.message);
      throw new Error(`Utterance insert failed: ${error.message}`);
    }
    if (inserted) insertedIds.push(...inserted.map((r: { id: string }) => r.id));
  }
  console.log(`[PIPELINE] Utterances inserted: ${insertedIds.length} (${Date.now() - pipelineStart}ms elapsed)`);

  // Step E — group speaker turns across global utterance list
  await supabase.from("transcription_jobs")
    .update({ phase: "Grouping speaker turns...", progress: 75 })
    .eq("id", jobId);

  const { turns: speakerTurns, debugLog: groupingDebugLog } = USE_SPEAKER_TURN_GROUPING
    ? groupSpeakerTurns(allUtterances, DEFAULT_GAP_THRESHOLD)
    : {
        turns: allUtterances.map((u, idx) => ({
          speaker_id: u.speaker,
          start_time: u.start,
          end_time: u.end,
          joined_text: u.transcript,
          confidence: u.confidence,
          sequence_index: idx,
          member_count: 1,
          source_utterance_ids: [] as string[],
          member_utterances: [{ ...u }],
          grouping_meta: {
            threshold_used: 0,
            gaps: [],
            merge_reasons: [],
            had_terminal_punct_split: false,
            had_overlap_split: false,
          },
        })),
        debugLog: [] as GroupingDebugEntry[],
      };

  // Map inserted IDs back onto turns
  let rawIdx = 0;
  for (const turn of speakerTurns) {
    const ids: string[] = [];
    for (let m = 0; m < turn.member_count; m++) {
      if (rawIdx < insertedIds.length) ids.push(insertedIds[rawIdx++]);
    }
    turn.source_utterance_ids = ids;
  }

  // Step F — insert speaker turns
  const speakerTurnRows = speakerTurns.map(t => ({
    job_id: jobId,
    speaker_id: t.speaker_id,
    start_time: t.start_time,
    end_time: t.end_time,
    joined_text: t.joined_text,
    confidence: t.confidence,
    sequence_index: t.sequence_index,
    member_count: t.member_count,
    source_utterance_ids: t.source_utterance_ids,
    member_utterances: t.member_utterances,
    grouping_meta: t.grouping_meta,
    grouping_version: GROUPING_VERSION,
  }));

  console.log(`[PIPELINE] Inserting ${speakerTurnRows.length} speaker turns in ${Math.ceil(speakerTurnRows.length / 100)} batch(es)`);
  let speakerTurnsInserted = 0;
  for (let i = 0; i < speakerTurnRows.length; i += 100) {
    const batch = speakerTurnRows.slice(i, i + 100);
    const { error } = await supabase.from("speaker_turns").insert(batch);
    if (error) {
      console.error(`[PIPELINE] Speaker turn insert error (batch starting at ${i}):`, error.message);
      throw new Error(`speaker_turns insert failed at batch ${i}: ${error.message}`);
    }
    speakerTurnsInserted += batch.length;
    console.log(`[PIPELINE] Speaker turns batch ${i}–${i + batch.length - 1} inserted OK`);
  }
  console.log(`[PIPELINE] Inserted ${speakerTurnsInserted} speaker_turns rows (${Date.now() - pipelineStart}ms elapsed)`);

  // Step G — build speaker mappings keyed by (job_id, part_index, speaker_id)
  await supabase.from("transcription_jobs")
    .update({ phase: "Building speaker map...", progress: 88 })
    .eq("id", jobId);

  const seen = new Set<string>();
  const mappingRows: Record<string, unknown>[] = [];

  for (const u of allUtterances) {
    const key = `${u.part_index}:${u.speaker}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Weighted confidence average over all utterances for this (part, speaker)
    const samples = allUtterances.filter(x => x.part_index === u.part_index && x.speaker === u.speaker);
    const totalWeight = samples.reduce((s, x) => s + (x.end - x.start), 0);
    const weightedSum = samples.reduce((s, x) => s + x.confidence * (x.end - x.start), 0);
    const confPct = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0;

    const label = sortedParts.length > 1
      ? `Speaker ${u.speaker} (Part ${(u.part_index ?? 0) + 1})`
      : `Speaker ${u.speaker}`;

    mappingRows.push({
      job_id: jobId,
      part_index: u.part_index ?? 0,
      speaker_id: u.speaker,
      mapped_name: label,
      confidence_pct: confPct,
      quick_fills: ["THE REPORTER", "THE WITNESS", "COUNSEL"],
    });
  }

  if (mappingRows.length > 0) {
    const { error } = await supabase.from("speaker_mappings").insert(mappingRows);
    if (error) {
      console.error(`[PIPELINE] Speaker mapping insert error:`, error.message);
      throw new Error(`speaker_mappings insert failed: ${error.message}`);
    }
    console.log(`[PIPELINE] Inserted ${mappingRows.length} speaker_mappings rows (${Date.now() - pipelineStart}ms elapsed)`);
  }

  // Step H — finalize job
  const wordCount = allUtterances.reduce((acc, u) => acc + u.transcript.trim().split(/\s+/).filter(Boolean).length, 0);
  const lowConfCount = allUtterances.filter(u => u.confidence < 0.8).length;
  const mergedCount = allUtterances.length - speakerTurns.length;
  const avgMembersPerTurn = speakerTurns.length > 0
    ? (allUtterances.length / speakerTurns.length).toFixed(1)
    : "1.0";

  const { error: finalizeError } = await supabase.from("transcription_jobs").update({
    status: "complete",
    phase: "Complete",
    progress: 100,
    raw_deepgram_json: { parts: sortedParts.map(p => ({ part_index: p.part_index, result: p.raw_result })) },
    word_count: wordCount,
    low_confidence_count: lowConfCount,
    duration_seconds: totalDuration,
    grouping_debug_log: groupingDebugLog,
    speaker_turn_count: speakerTurns.length,
    grouping_threshold_used: DEFAULT_GAP_THRESHOLD,
    logs: [
      `[ASYNC] ${sortedParts.length} part(s) transcribed independently, results stitched`,
      `[STITCH] Total duration: ${totalDuration.toFixed(1)}s across ${sortedParts.length} part(s)`,
      `[RAW] ${allUtterances.length} utterances across all parts`,
      USE_SPEAKER_TURN_GROUPING
        ? `[GROUPER] ${allUtterances.length} utterances → ${speakerTurns.length} turns (${mergedCount} merged, avg ${avgMembersPerTurn} per turn, threshold ${DEFAULT_GAP_THRESHOLD}s)`
        : `[GROUPER] Grouping disabled — passthrough mode`,
      `[PARSE] ${wordCount} words — ${lowConfCount} low-confidence segment${lowConfCount !== 1 ? "s" : ""}`,
    ].filter(Boolean),
  }).eq("id", jobId);

  if (finalizeError) {
    console.error(`[PIPELINE] Finalize update error:`, finalizeError.message);
    throw new Error(`Job finalize failed: ${finalizeError.message}`);
  }

  console.log(`[PIPELINE] Finalize complete in ${Date.now() - pipelineStart}ms — job ${jobId}: ${wordCount} words, ${speakerTurns.length} turns`);
}
