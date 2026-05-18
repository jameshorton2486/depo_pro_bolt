# Transcript Diff Engine Architecture

## Overview

The diff engine computes structured, word-level differences between any two transcript stages
in the processing pipeline. It is purpose-built for legal deposition transcripts and preserves
speaker attribution, timestamps, and utterance relationships through every diff operation.

This is **not** a text-blob diff. Every change record carries:

- Timestamp range (start_time / end_time)
- Speaker attribution (before and after)
- Utterance relationship
- Source artifact identity
- Change classification
- AI metadata when applicable

---

## Files

```
src/lib/diff/
├── transcriptDiffEngine.ts    — Top-level orchestration, DB persistence, version management
├── utteranceDiffEngine.ts     — Utterance-level structural diff
├── wordDiffEngine.ts          — Word-level LCS-based diff with punctuation detection
├── speakerDiffEngine.ts       — Speaker change extraction and risk classification
└── diffNormalization.ts       — Text normalization, word flattening utilities
```

---

## Stage Pipeline

Transcript stages in order:

```
raw → grouped → deterministic → ai_suggested → approved → exported
```

Any two adjacent or non-adjacent stages can be compared. The engine always computes a
forward diff: source is the "before" and target is the "after."

---

## Diff Computation

### 1. Utterance Alignment

Utterances are aligned by `sequence_index`. This is stable across pipeline stages because
the grouping algorithm preserves sequence ordering from the raw Deepgram output.

If an utterance exists in source but not target → `delete` item  
If an utterance exists in target but not source → `insert` item  
If both exist → proceed to word-level diff

### 2. Word-Level Diff

Uses the LCS (Longest Common Subsequence) Myers-algorithm variant operating on word tokens.

Comparison key: `stripPunctuation(word)` — punctuation differences produce `punctuation` op items,
not false word mismatches.

Output operations:
- `equal` — word unchanged
- `insert` — word added in target
- `delete` — word removed in target
- `modify` — adjacent delete+insert merged into single modify token
- `punctuation` — same word content, different punctuation

### 3. Speaker Change Detection

Detected by comparing `speaker_id` between aligned utterance pairs.
Speaker reassignments are risk-classified:
- **High risk**: any swap between Q/A roles (testimony attribution)
- **Low risk**: reporter/clerk role changes

---

## Change Source Classification

| Stage transition | Change source |
|---|---|
| Any → deterministic | `deterministic` |
| Any → ai_suggested  | `ai` |
| Any → approved      | `human` |
| Other               | `system` |

---

## AI Risk Levels

AI-generated changes are assigned a risk level based on the AI suggestion confidence:

| Confidence | Risk |
|---|---|
| ≥ 0.85 | low |
| ≥ 0.70 | medium |
| ≥ 0.50 | high |
| < 0.50 | critical |

High and critical risk changes must be individually inspected before bulk approval.

---

## Performance

- Utterance alignment: O(n) with Map lookup by sequence_index
- Word diff (LCS): O(n·m) where n, m = word counts per utterance
- Virtual rendering: `@tanstack/react-virtual` virtualizes the diff list
- DB persistence: batched in groups of 200 rows

For very long depositions (10,000+ utterances), compute the diff lazily on demand and
cache the result keyed on `(sourceVersionId, targetVersionId)`.
