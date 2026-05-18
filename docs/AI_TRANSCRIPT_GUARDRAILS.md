# AI Transcript Guardrails — Depo-Pro Transcribe

## Purpose

This document enumerates every technical and procedural guardrail that prevents the AI review layer from corrupting the legal record. It is the reference document for auditing the system's safety properties.

---

## Guardrail 1: Immutable Raw Transcript

**Where enforced:** Database schema

The `utterances.transcript` column is populated once from the Deepgram response and is never written to again by any application code path. No migration, edge function, or React component calls `.update({ transcript: ... })`.

The export pipeline resolves transcript text using this priority chain:
```
ai_reviewed_transcript ?? corrected_transcript ?? transcript
```

If no human-accepted AI text exists, the deterministic correction (Stage 1) is used. If no Stage 1 correction exists, the raw Deepgram text is used. The raw text is always the final fallback and is never absent.

---

## Guardrail 2: Suggestion-Only Output

**Where enforced:** `supabase/functions/ai-review/index.ts`

The edge function writes exclusively to the `ai_suggestions` table. It does not write to `utterances.transcript`, `utterances.corrected_transcript`, or any other utterance text column.

The only utterance columns the edge function writes are:
- `utterances.ai_review_state` — state machine column (not transcript text)

`utterances.ai_reviewed_transcript` is only written by the frontend (`AiReviewPanel.tsx`) in direct response to a human reviewer clicking Accept or Save Edit.

---

## Guardrail 3: Safety Validator

**Where enforced:** `validateSuggestion()` in `supabase/functions/ai-review/index.ts`

Before any suggestion is stored in `ai_suggestions`, it passes a word-set validator:

```typescript
// Strip punctuation from both sides
const clean = (w: string) => w.replace(/[^a-zA-Z0-9'-]/g, "").toLowerCase();

// Fail: word removed
for (const w of sourceClean) {
  if (!suggestedClean.includes(w)) return { safe: false, reason: `Word removed: "${w}"` };
}

// Fail: word added
for (const w of suggestedClean) {
  if (!sourceClean.includes(w)) return { safe: false, reason: `Word added: "${w}"` };
}

// Fail: word count shifted significantly
if (Math.abs(sourceClean.length - suggestedClean.length) > 1) {
  return { safe: false, reason: `Word count changed: ${N} → ${M}` };
}
```

A failed validation does not silently drop the suggestion. It stores a `review_required` record with `has_change: false` and a reason explaining what was blocked. The reviewer sees it.

---

## Guardrail 4: Category Allowlist

**Where enforced:** `supabase/functions/ai-review/index.ts`

The model may only return suggestions in these eight categories:

```typescript
const ALLOWED_CATEGORIES = new Set([
  "punctuation", "sentence_boundary", "speaker_drift", "proper_noun",
  "interruption", "low_confidence", "fragment", "review_required",
]);
```

Any category value outside this set is coerced to `"review_required"`. This prevents the model from inventing category labels that might confuse the reviewer or bypass UI filtering logic.

---

## Guardrail 5: System Prompt Non-Negotiables

**Where enforced:** `SYSTEM_PROMPT` constant in `supabase/functions/ai-review/index.ts`

The system prompt contains explicit prohibitions repeated twice — once as positive obligations and once as absolute never-dos. Key non-negotiable language:

> "YOU MUST NEVER: Remove any word from the transcript / Add any word not present in the source / Rewrite, paraphrase, or rephrase testimony / Smooth grammar or improve readability / Remove filler words or hesitation speech / Summarize or condense answers"

The prompt also explicitly instructs the model that `suggested_text` must contain **only spoken words** — no Q./A. labels, no speaker names. This prevents the model from accidentally suggesting structural changes that belong to the formatting layer.

The system prompt is a constant in source code. It is not dynamically constructed from database values and cannot be altered by user input.

---

## Guardrail 6: No Auto-Apply

**Where enforced:** `src/components/AiReviewPanel.tsx`

The frontend has no code path that applies suggestions without an explicit user action. The `handleAccept`, `handleReject`, and `handleEdit` functions are only callable from button `onClick` handlers inside `SuggestionCard`.

The "Accept All Visible" bulk action (`handleAcceptAll`) requires:
1. `filterStatus === 'pending'` (reviewer must be in the pending view)
2. The reviewer to click a button labeled "Accept All N Visible Suggestions"
3. `s.has_change === true` for each suggestion (no-change suggestions excluded from bulk)

---

## Guardrail 7: Diff Visibility

**Where enforced:** `computeWordDiff()` and `DiffView` in `src/components/AiReviewPanel.tsx`

Every suggestion with `has_change: true` renders a word-level diff before the accept/reject buttons appear. The reviewer cannot click Accept without first seeing exactly what changed.

Suggestions with `has_change: false` (informational flags) do not show an Accept button at all — they show the reason text only. This prevents a reviewer from accidentally "accepting" a no-change flag under the mistaken impression it will apply a correction.

---

## Guardrail 8: Audit Completeness

**Where enforced:** `handleAccept`, `handleReject`, `handleEdit` in `src/components/AiReviewPanel.tsx`

Every reviewer action — accept, reject, or edit — calls `insertCorrectionAudit()`, which writes to `utterance_corrections` before the local state update. The DB write happens inside `Promise.all` with the utterance update, meaning both succeed or both fail atomically.

The correction record captures:
- `previous_text`: the source text at the time of the AI review
- `corrected_text`: the accepted or rejected text
- `correction_type`: `ai_suggestion_accepted` or `ai_suggestion_rejected`
- `created_at`: server timestamp

This audit record is permanent and survives any future re-run of AI review or re-export.

---

## Guardrail 9: `original_transcript` Preservation

**Where enforced:** `handleAccept`, `handleEdit` in `src/components/AiReviewPanel.tsx` and `applyUtteranceAcceptance()`

When an AI suggestion is accepted, the utterance update includes:

```typescript
original_transcript: u.original_transcript ?? u.transcript
```

If `original_transcript` is already set (from a prior Stage 1 correction), it is preserved unchanged. If it has not been set yet, the raw Deepgram text is captured as the original. This ensures the baseline always traces back to the raw STT output, regardless of how many times an utterance has been edited.

---

## Guardrail 10: Context Window Isolation

**Where enforced:** `buildUserPrompt()` in `supabase/functions/ai-review/index.ts`

Utterances in the context window (2 before, 2 after each batch) are explicitly labeled `[CONTEXT]` in the prompt and the model is instructed: "do not suggest changes" for context utterances. The `parseSuggestions()` function then filters the parsed response to only accept suggestion objects whose `utterance_id` appears in the `batchIds` array — context utterance IDs are excluded from the allowlist.

This prevents the model from returning suggestions for context utterances that the review run did not intend to process.

---

## Guardrail 11: Re-run Isolation

**Where enforced:** Database schema (`review_run_id` column) and `loadSuggestions()` in `AiReviewPanel.tsx`

Each review run generates a unique `review_run_id` UUID. The frontend loads suggestions filtered to the latest run ID. Prior run suggestions are retained in the database but are not shown in the default view.

This means a re-run after rejection does not silently re-create already-rejected suggestions in the active review queue. The reviewer explicitly sees the new run's suggestions and can compare against prior run history if needed.

---

## Failure Modes and Their Handling

| Failure | Detection | Handling |
|---------|-----------|---------|
| Claude API timeout or error | `try/catch` per batch | Batch IDs added to `failedUtteranceIds`; state set to `not_reviewed`; returned in `failedCount` |
| Claude returns malformed JSON | `parseSuggestions()` returns `[]` | Missing suggestions stored as `review_required` with `has_change: false` |
| Safety validator blocks suggestion | `validateSuggestion()` returns `safe: false` | Stored as `review_required` with reason; never has `has_change: true` |
| Category outside allowlist | Check against `ALLOWED_CATEGORIES` Set | Coerced to `review_required` |
| Model suggests word change | Safety validator catches it | Blocked; stored with reason |
| DB insert error | `console.error` per chunk | Non-fatal; partial inserts succeed; run still returns success with accurate counts |

The system is designed to fail safely: a partial or failed AI review leaves the transcript in its Stage 1 deterministic state, which is always valid and exportable.

---

## Prohibited Future Changes

The following changes to this codebase would violate the safety contract and require court reporter QA sign-off before deployment:

1. Writing to `utterances.transcript` from any code path
2. Writing to `utterances.corrected_transcript` from the AI review edge function
3. Adding a confidence-threshold auto-apply (applying without human click)
4. Removing the safety validator from the edge function
5. Removing the word-level diff from suggestion cards
6. Changing `correction_type` enum values in a way that loses audit trail continuity
7. Deleting `original_transcript` preservation from acceptance handlers
8. Making the system prompt dynamically user-editable without audit logging
