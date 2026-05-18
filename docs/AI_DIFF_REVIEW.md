# AI Diff Review System

## Safety Principles

AI-generated changes are never applied silently. Every AI modification flows through the
diff review system and requires explicit human approval before becoming part of the
final transcript.

The AI is a **suggestion engine**, not an editor. It cannot write to the approved transcript.

---

## How AI Changes Appear in Diffs

When the diff engine compares `deterministic` → `ai_suggested` stages, all detected
changes are automatically tagged with `change_source: 'ai'`.

Each AI diff item carries:

- `aiRationale`: the AI's stated reason for the suggestion
- `aiRiskLevel`: `low | medium | high | critical` based on suggestion confidence
- `reviewStatus`: always starts as `pending`

---

## Risk Classification

| AI Confidence | Risk Level | Visual Indicator |
|---|---|---|
| ≥ 0.85 | `low` | Slate badge |
| ≥ 0.70 | `medium` | Amber badge |
| ≥ 0.50 | `high` | Orange badge |
| < 0.50 | `critical` | Rose badge |

**High and critical risk changes must never be bulk-approved.**
The Review Decisions panel will warn when high-risk changes are present in the selection.

---

## Review Workflow

1. Open **Diff Viewer** from the transcript editor toolbar.
2. Select `deterministic` → `ai_suggested` comparison.
3. Filter by "AI Generated" in the sidebar.
4. For each AI change:
   - Click to open in **Change Inspector**
   - Review original text, AI modification, rationale, and risk level
   - Play audio for the affected region (±5s context)
   - Approve or reject
5. Bulk-approve low-risk changes once individually verified.
6. Reject any AI change that alters testimony meaning.

---

## What AI May NOT Do

- Insert words not present in the audio
- Delete testimony content
- Reassign speaker attributions
- Change dates, names, or numbers without high confidence
- Apply changes that alter the legal meaning of testimony

These constraints are enforced at the AI prompt level (see `AI_SAFETY_RULES.md`)
and validated by the word-set safety check before any suggestion is stored.

---

## Audit Trail

Every approval and rejection is written to `diff_reviews` with:
- The diff item ID
- The action (`approve` / `reject`)
- The previous and new status
- A timestamp
- An optional reviewer note

This audit trail is permanent and cannot be modified.
