# AI Review Architecture — Depo-Pro Transcribe

## Overview

Depo-Pro Transcribe implements a four-layer transcript pipeline. The AI review layer is Stage 2 — it operates **after** deterministic cleanup and **before** human sign-off. It never touches the raw transcript.

```
Raw Deepgram JSON
       │
       ▼
Stage 0 — Raw Storage
  utterances.transcript  (immutable after write)
       │
       ▼
Stage 1 — Deterministic Correction Engine (src/lib/corrections.ts)
  utterances.corrected_transcript
  Rules: Q/A labels, speaker labels, whitespace, STT substitutions,
         punctuation, number format, objections, parentheticals,
         exhibit refs, depo phrases
  Safety: SAFE_AUTOMATIC — no human approval required
       │
       ▼
Stage 2 — AI Review (supabase/functions/ai-review/index.ts)
  ai_suggestions table  ← suggestions only, no overwrite
  utterances.ai_reviewed_transcript  ← populated only after human accepts
  Safety: SUGGESTION_ONLY — every change requires explicit human approval
       │
       ▼
Stage 3 — Human Review (src/components/AiReviewPanel.tsx)
  Reviewer sees: word-level diff, category, confidence, reason
  Actions: accept / reject / edit / skip
  Audit: utterance_corrections table — every action logged
       │
       ▼
Stage 4 — Export
  RTF/DOCX emitter uses approved corrections only
```

---

## Components

### Edge Function: `supabase/functions/ai-review/index.ts`

- Receives a `jobId` (and optional `utteranceIds` for targeted re-review)
- Loads all utterances for the job ordered by `sequence_index`
- Loads speaker mappings to provide human-readable labels to the model
- Marks utterances as `ai_review_state = 'pending'`
- Batches utterances in groups of 8 with a 2-utterance context window on each side
- Calls Claude with a strict system prompt (see `SYSTEM_PROMPT` constant)
- Parses the JSON response and runs a safety validator on each suggestion
- Persists to `ai_suggestions` table; updates `ai_review_state` per utterance
- Returns: `{ reviewRunId, totalReviewed, suggestionsWithChanges, failedCount }`

**Batch processing:**
All batches are dispatched concurrently via `Promise.all`. Each batch is independent — no shared state between batches. Persistence (suggestion inserts + utterance state updates) is also fully parallelized.

### Safety Validator: `validateSuggestion(source, suggested)`

Hard-fail conditions that block a suggestion from being stored:
1. Any source word not present in the suggestion (word removed)
2. Any suggestion word not present in the source (word added)
3. Word count delta greater than 1

This validator is the last line of defense before a suggestion reaches the database. It is intentionally strict: a suggestion that changes wording is silently converted to a `review_required` flag with `has_change: false`.

### React Panel: `src/components/AiReviewPanel.tsx`

- Two tabs: **Run Review** and **Suggestions**
- Suggestions tab: filterable by status (pending/accepted/rejected/all) and category
- Per-suggestion: category badge, confidence meter, word-level diff view, accept/reject/edit actions
- Bulk accept: single `Promise.all` — 3 DB operations regardless of N suggestions
- Audit: every accept/reject writes to `utterance_corrections` with `correction_type: 'ai_suggestion_accepted'|'ai_suggestion_rejected'`

### Word-Level Diff: `computeWordDiff(source, suggested)`

- LCS-based diff tokenizing on whitespace
- Output: `DiffSegment[]` — `same | removed | added`
- Rendered as: strikethrough rose for removed, emerald for added, neutral for same
- Reviewer always sees the original vs. suggestion side-by-side — no blind acceptance

---

## Database Schema

### `ai_suggestions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | PK |
| `utterance_id` | uuid | FK → utterances |
| `job_id` | uuid | FK → transcription_jobs |
| `source_text` | text | Verbatim snapshot at time of AI review |
| `suggested_text` | text | AI suggestion (identical to source if no change) |
| `category` | text | See categories below |
| `reason` | text | Plain-language explanation shown to reviewer |
| `confidence` | numeric(4,3) | 0.0–1.0 |
| `has_change` | boolean | Whether suggested_text ≠ source_text |
| `review_status` | text | pending / accepted / rejected / edited |
| `human_edited_text` | text | Reviewer's manual override when status = 'edited' |
| `model_used` | text | e.g. `claude-sonnet-4-6` |
| `review_run_id` | uuid | Groups suggestions from the same review run |
| `reviewed_at` | timestamptz | When the reviewer acted |

### `utterances` (AI columns added in migration 20260517101939)

| Column | Type | Description |
|--------|------|-------------|
| `ai_review_state` | text | not_reviewed / pending / has_suggestion / accepted / rejected / skipped |
| `ai_reviewed_transcript` | text | Approved AI+human text; null until accepted |

### `utterance_corrections` (extended correction_type)

Extended enum values:
- `ai_suggestion_accepted` — reviewer accepted or edited the AI suggestion
- `ai_suggestion_rejected` — reviewer rejected the AI suggestion

---

## Suggestion Categories

| Category | Description | Auto-applies? |
|----------|-------------|---------------|
| `punctuation` | Comma, period, question mark, dash, ellipsis fix | No — reviewer required |
| `sentence_boundary` | Run-on that should be split; uses `\|` as split marker | No |
| `speaker_drift` | Utterance may belong to a different speaker | No |
| `proper_noun` | Misspelled proper noun, legal entity, or medical term | No |
| `interruption` | Probable interruption not marked with `--` | No |
| `low_confidence` | Probable STT recognition error given context | No |
| `fragment` | Incomplete fragment (informational only) | No |
| `review_required` | Ambiguous — requires human judgment | No |

---

## Review Run Lifecycle

1. User clicks **Run Stage 2 AI Review** in the panel
2. Frontend POSTs `{ jobId }` to `/functions/v1/ai-review`
3. Edge function processes, writes `ai_suggestions`, returns `reviewRunId`
4. Frontend calls `loadSuggestions(reviewRunId)` — loads only suggestions from that run
5. Suggestions tab shown with `filterStatus = 'pending'` pre-selected
6. Reviewer acts on each suggestion (accept / reject / edit)
7. Accepted suggestions populate `utterances.ai_reviewed_transcript`
8. Every action is written to `utterance_corrections` for audit

---

## Re-run Behavior

A second run of AI review produces a new `review_run_id`. Prior suggestions are not deleted — they remain in `ai_suggestions` with whatever review_status they had. The frontend loads only the latest run's suggestions by default. Prior runs remain queryable for audit.

---

## Transcript Integrity Guarantees

| Layer | Column written | Source ever modified? |
|-------|---------------|----------------------|
| Stage 0 raw | `utterances.transcript` | Never |
| Stage 1 deterministic | `utterances.corrected_transcript` | Never touches `transcript` |
| Stage 2 AI | `ai_suggestions.suggested_text` | Never touches `transcript` or `corrected_transcript` |
| Stage 3 human accept | `utterances.ai_reviewed_transcript` | Never touches `transcript` |
| Export | Reads `ai_reviewed_transcript` ?? `corrected_transcript` ?? `transcript` | Read-only |

The raw Deepgram transcript is immutable for the lifetime of the job.
