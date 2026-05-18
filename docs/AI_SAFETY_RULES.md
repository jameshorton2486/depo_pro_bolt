# AI Safety Rules — Depo-Pro Transcribe

## Legal Context

This system produces **official court records**. Deposition transcripts are admitted as evidence, used in summary judgment motions, quoted in appellate briefs, and may determine case outcomes. Any error in the transcript that was caused by an AI system creates professional liability for the court reporter and potential legal harm to the parties.

**The AI layer exists to ASSIST, not to AUTHOR.**

---

## The Verbatim Integrity Principle

Every word a witness speaks is part of the legal record. The AI system may not:

- Remove words
- Add words
- Reorder words
- Paraphrase what was said
- Substitute synonyms
- Smooth grammar
- Expand or contract speech forms

This applies even when the transcript text appears grammatically incorrect, semantically redundant, or stylistically poor. The witness's actual words — including their imperfections — are the record.

### Specifically Preserved

The following are **not errors**. The AI must never flag them for removal:

| Speech form | Example | Why preserved |
|-------------|---------|---------------|
| Filler words | "uh, um, you know, like" | Verbatim testimony |
| False starts | "I -- I don't know" | Verbatim testimony |
| Stutters | "he -- he said" | Verbatim testimony |
| Hesitations | "it was... I think..." | Verbatim testimony |
| Colloquialisms | "gonna, wanna, kinda" | Actual words spoken |
| Incomplete answers | "Well, I —" | Verbatim testimony |
| Repetitions | "And then and then he left" | Verbatim testimony |

### What May Be Suggested (with human approval)

| Change type | Example | Category |
|-------------|---------|----------|
| Missing comma | "Well I think so" → "Well, I think so" | `punctuation` |
| Missing period | "I don't know I wasn't there" → suggestion to split | `sentence_boundary` |
| Misspelled proper noun | "Bexar County" vs "Bear County" | `proper_noun` |
| Interruption marker | "word word --" not marked | `interruption` |
| Speaker drift | Utterance labeled wrong speaker | `speaker_drift` |
| STT recognition error | Low-confidence word with likely correction | `low_confidence` |

---

## Safety Validator

Every suggestion produced by the AI model passes through a programmatic validator before reaching the database (`validateSuggestion` in `supabase/functions/ai-review/index.ts`).

### Validator Logic

```
Strip punctuation from both source and suggestion
Compare word sets

BLOCK if: any source word is absent from suggestion  → "Word removed: X"
BLOCK if: any suggestion word is absent from source  → "Word added: X"
BLOCK if: |word_count_delta| > 1                     → "Word count changed: N → M"
```

Blocked suggestions are stored as `has_change: false` with `category: 'review_required'` and a reason explaining what the safety check caught. They are never silently discarded — the reviewer sees that a suggestion was blocked and why.

### Why Word-Set Comparison

The validator checks word presence (not order) because:
1. Punctuation changes shift the parsed word boundaries slightly
2. Contraction splitting is not a concern since colloquial forms are preserved
3. Order changes would indicate paraphrasing, which the model is prohibited from doing

The `>1` word count tolerance handles the rare case where a punctuation change causes a contraction to be tokenized differently (e.g., `it's` → `it 's`).

---

## System Prompt Safety Boundaries

The model receives a system prompt that functions as a contractual boundary. The key prohibitions are repeated both in the positive (what TO do) and negative (what NEVER to do) forms:

**Positive obligations:**
- Preserve every spoken word verbatim
- Preserve disfluencies, stutters, false starts, hesitations
- Preserve colloquial speech forms
- Only suggest punctuation changes or flag recognition errors

**Absolute prohibitions:**
- Remove any word
- Add any word not present in source
- Rewrite, paraphrase, or rephrase
- Smooth grammar or improve readability
- Remove filler words
- Summarize or condense answers
- Merge separate sentences
- Infer what the speaker "meant to say"
- Change verb tenses, subject/object, or structure
- Add words even when a sentence seems grammatically incomplete

The system prompt is defined as the constant `SYSTEM_PROMPT` in `supabase/functions/ai-review/index.ts`. Changes to this prompt require review by the court reporter QA process.

---

## Human Review Requirement

**No AI suggestion auto-applies.**

The acceptance flow for every suggestion:
1. Reviewer sees the original text and suggested text side-by-side (word-level diff)
2. Reviewer sees the category, confidence score, and reason
3. Reviewer must explicitly click Accept, Reject, or Edit
4. Only after acceptance does `ai_reviewed_transcript` get populated
5. Every action is recorded in `utterance_corrections` with a timestamp

There is no batch auto-accept based on confidence threshold. There is a "Accept All Visible" bulk action, but it is:
- Only available when the reviewer has filtered to `pending` suggestions
- Scoped to visible (filtered) suggestions only
- Still writes a full audit record for every accepted suggestion

---

## Audit Trail

Every reviewer action produces a record in `utterance_corrections`:

```
correction_type = 'ai_suggestion_accepted'
  previous_text  = ai_suggestions.source_text (snapshot at review time)
  corrected_text = ai_suggestions.suggested_text (or human_edited_text if edited)

correction_type = 'ai_suggestion_rejected'
  previous_text  = ai_suggestions.source_text
  corrected_text = ai_suggestions.source_text  (unchanged)
```

The `ai_suggestions` table also retains:
- `review_status`: pending / accepted / rejected / edited
- `reviewed_at`: timestamp of the reviewer action
- `human_edited_text`: if the reviewer modified the suggestion before accepting

This produces two independent audit paths:
1. `utterance_corrections` — chronological log of all changes to any utterance
2. `ai_suggestions` — full log of every AI suggestion and its disposition

---

## Category Risk Levels

Not all suggestion categories carry equal risk. Reviewers should apply proportional scrutiny:

| Category | Risk | Notes |
|----------|------|-------|
| `punctuation` | Low | Punctuation-only, word set unchanged |
| `sentence_boundary` | Low–Medium | Flagging only; split requires separate manual action |
| `proper_noun` | Medium | Verify against case documents before accepting |
| `interruption` | Low | Adds `--` marker where likely missing |
| `low_confidence` | High | May involve word substitution; read carefully |
| `speaker_drift` | High | Affects Q/A structure; must verify with audio |
| `fragment` | Informational | No change suggested; informational flag only |
| `review_required` | Variable | Safety-blocked or ambiguous; always read the reason |

---

## What To Do If AI Suggestions Seem Wrong

1. **Reject the suggestion** — this is always safe
2. **Edit the suggestion** — type the correct text before saving
3. **Check the audio** — the transcript review panel shows timestamps; use the source recording to verify
4. **Do not accept** a suggestion you haven't verified against the audio or case documents

A rejected suggestion is not a failure. The purpose of the AI layer is to surface candidates for human review — the human reviewer makes the final determination on every change.
