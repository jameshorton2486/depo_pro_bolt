import { stripPunctuation } from './diffNormalization';

export type WordDiffOp = 'equal' | 'insert' | 'delete' | 'modify' | 'punctuation';

export interface WordDiffToken {
  op: WordDiffOp;
  /** Present for 'equal', 'delete', 'modify', 'punctuation' */
  original: string | null;
  /** Present for 'equal', 'insert', 'modify', 'punctuation' */
  modified: string | null;
  startTime: number;
  endTime: number;
  confidence: number;
  speakerId: number;
  utteranceId: string;
}

interface WordItem {
  text: string;
  punctuated: string;
  startTime: number;
  endTime: number;
  confidence: number;
  speakerId: number;
  utteranceId: string;
}

/**
 * Myers diff algorithm adapted for word sequences.
 * Returns edit operations transforming `source` into `target`.
 */
export function diffWordSequences(
  source: WordItem[],
  target: WordItem[],
): WordDiffToken[] {
  const n = source.length;
  const m = target.length;

  if (n === 0 && m === 0) return [];

  // LCS-based diff via edit distance with backtrack
  // Build edit script using patience-style LCS
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (stripPunctuation(source[i - 1].text) === stripPunctuation(target[j - 1].text)) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const ops: WordDiffToken[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const src = source[i - 1];
    const tgt = target[j - 1];

    if (
      i > 0 &&
      j > 0 &&
      stripPunctuation(src.text) === stripPunctuation(tgt.text)
    ) {
      // Words are the same (ignoring punctuation) — check for punctuation change
      const puncChanged = src.punctuated !== tgt.punctuated;
      ops.unshift({
        op: puncChanged ? 'punctuation' : 'equal',
        original: src.punctuated,
        modified: tgt.punctuated,
        startTime: src.startTime,
        endTime: src.endTime,
        confidence: src.confidence,
        speakerId: src.speakerId,
        utteranceId: src.utteranceId,
      });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({
        op: 'insert',
        original: null,
        modified: tgt.punctuated,
        startTime: tgt.startTime,
        endTime: tgt.endTime,
        confidence: tgt.confidence,
        speakerId: tgt.speakerId,
        utteranceId: tgt.utteranceId,
      });
      j--;
    } else {
      ops.unshift({
        op: 'delete',
        original: src.punctuated,
        modified: null,
        startTime: src.startTime,
        endTime: src.endTime,
        confidence: src.confidence,
        speakerId: src.speakerId,
        utteranceId: src.utteranceId,
      });
      i--;
    }
  }

  // Merge adjacent delete+insert pairs into 'modify'
  return mergeModify(ops);
}

function mergeModify(ops: WordDiffToken[]): WordDiffToken[] {
  const result: WordDiffToken[] = [];
  let i = 0;
  while (i < ops.length) {
    if (
      ops[i].op === 'delete' &&
      i + 1 < ops.length &&
      ops[i + 1].op === 'insert'
    ) {
      result.push({
        op: 'modify',
        original: ops[i].original,
        modified: ops[i + 1].modified,
        startTime: ops[i].startTime,
        endTime: ops[i].endTime,
        confidence: ops[i].confidence,
        speakerId: ops[i].speakerId,
        utteranceId: ops[i].utteranceId,
      });
      i += 2;
    } else {
      result.push(ops[i]);
      i++;
    }
  }
  return result;
}

/** Count changed tokens by type */
export function summarizeWordDiff(tokens: WordDiffToken[]) {
  const counts = { insertions: 0, deletions: 0, modifications: 0, punctuationChanges: 0 };
  for (const t of tokens) {
    if (t.op === 'insert')      counts.insertions++;
    else if (t.op === 'delete') counts.deletions++;
    else if (t.op === 'modify') counts.modifications++;
    else if (t.op === 'punctuation') counts.punctuationChanges++;
  }
  return counts;
}
