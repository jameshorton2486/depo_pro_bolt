# Legal Audit Trail

## Purpose

Every modification to a deposition transcript must be traceable. A legal transcript is a
court record. Any change — regardless of source — must preserve:

1. What the original text was
2. What it was changed to
3. Who or what made the change
4. When the change occurred
5. Whether AI was involved
6. Whether the change was reviewed and approved

---

## Tables

### `utterance_corrections`

Records every human edit to an utterance (text changes, speaker reassignments, review state
changes, AI acceptance/rejection). Append-only.

Fields: `utterance_id`, `job_id`, `previous_text`, `corrected_text`, `previous_speaker_id`,
`new_speaker_id`, `correction_type`, `created_at`

Correction types: `text_edit | speaker_reassign | review_state_change | deterministic_correction | ai_suggestion_accepted | ai_suggestion_rejected`

### `transcript_versions`

Immutable snapshots of the full utterance array at each processing stage.
Provides rollback capability and before/after comparison at any granularity.

### `transcript_diffs`

Structured diff records between two versions. One row per changed utterance.
Carries timestamps, speaker attribution, change source, AI metadata, and review status.

### `diff_reviews`

Append-only log of every reviewer decision on a diff item.
Action types: `approve | reject | flag | comment`

### `word_reviews`

Append-only audit log of word-level review actions (mark_reviewed, edit, flag, unflag, revert).

---

## Immutability Rules

- `utterance_corrections` — INSERT only, never UPDATE or DELETE
- `diff_reviews` — INSERT only, never UPDATE or DELETE
- `word_reviews` — INSERT only, never UPDATE or DELETE
- `transcript_versions` — INSERT only; snapshots are never modified

The current editable state lives in `utterances` and `transcript_words`.
The history lives in the append-only tables above.

---

## Answering Legal Questions

The audit trail must allow a reviewer or attorney to answer:

| Question | Where to find it |
|---|---|
| What did the original transcript say? | `transcript_versions` (stage = 'raw') |
| What did AI suggest? | `ai_suggestions` + `transcript_versions` (stage = 'ai_suggested') |
| Which AI suggestions were accepted? | `utterance_corrections` (type = 'ai_suggestion_accepted') |
| Which were rejected? | `utterance_corrections` (type = 'ai_suggestion_rejected') |
| Who edited a specific passage? | `utterance_corrections` (created_at + correction_type) |
| Was a speaker label changed? | `utterance_corrections` (type = 'speaker_reassign') |
| Was the original wording preserved? | Compare any version snapshot |
| What is the approved final text? | `transcript_versions` (stage = 'approved') |

---

## Non-Repudiation

No version or correction record can be deleted through normal application flows.
Row Level Security policies block DELETE operations on audit tables.

If a record must be corrected (data entry error), an additional correction record is
inserted — the original record remains.
