import type { Utterance } from '../database.types';

export interface NormalizedWord {
  text: string;
  punctuated: string;
  startTime: number;
  endTime: number;
  confidence: number;
  speakerId: number;
  utteranceId: string;
  utteranceIndex: number; // index within utterance
  globalIndex: number;    // index across all utterances
}

export interface NormalizedUtterance {
  id: string;
  speakerId: number;
  startTime: number;
  endTime: number;
  text: string;
  confidence: number;
  sequenceIndex: number;
  words: NormalizedWord[];
}

/** Strip leading/trailing whitespace, collapse internal whitespace, lowercase for comparison */
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Remove punctuation from a word for pure word comparison */
export function stripPunctuation(word: string): string {
  return word.replace(/[^\w'-]/g, '').toLowerCase();
}

/** Convert utterances to a flat ordered array of normalized words */
export function flattenUtteranceWords(utterances: Utterance[]): NormalizedWord[] {
  const result: NormalizedWord[] = [];
  let globalIndex = 0;
  for (const utt of utterances) {
    const text = utt.corrected_transcript ?? utt.transcript;
    if (!utt.words || utt.words.length === 0) {
      // Synthesize word tokens from transcript text when word-level data is absent
      const tokens = text.trim().split(/\s+/);
      const duration = utt.end_time - utt.start_time;
      const avgDur = tokens.length > 0 ? duration / tokens.length : 0;
      tokens.forEach((token, i) => {
        result.push({
          text: token,
          punctuated: token,
          startTime: utt.start_time + i * avgDur,
          endTime: utt.start_time + (i + 1) * avgDur,
          confidence: utt.confidence,
          speakerId: utt.speaker_id,
          utteranceId: utt.id,
          utteranceIndex: i,
          globalIndex: globalIndex++,
        });
      });
    } else {
      utt.words.forEach((w, i) => {
        result.push({
          text: w.word,
          punctuated: w.punctuated_word ?? w.word,
          startTime: w.start,
          endTime: w.end,
          confidence: w.confidence,
          speakerId: w.speaker ?? utt.speaker_id,
          utteranceId: utt.id,
          utteranceIndex: i,
          globalIndex: globalIndex++,
        });
      });
    }
  }
  return result;
}

/** Convert utterances to normalized form for structural comparison */
export function normalizeUtterances(utterances: Utterance[]): NormalizedUtterance[] {
  return utterances.map(u => ({
    id: u.id,
    speakerId: u.speaker_id,
    startTime: u.start_time,
    endTime: u.end_time,
    text: u.corrected_transcript ?? u.transcript,
    confidence: u.confidence,
    sequenceIndex: u.sequence_index,
    words: (u.words ?? []).map((w, i) => ({
      text: w.word,
      punctuated: w.punctuated_word ?? w.word,
      startTime: w.start,
      endTime: w.end,
      confidence: w.confidence,
      speakerId: w.speaker ?? u.speaker_id,
      utteranceId: u.id,
      utteranceIndex: i,
      globalIndex: 0, // filled by caller if needed
    })),
  }));
}
