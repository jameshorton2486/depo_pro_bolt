# 04 — Workspace Rules

**Purpose.** Specify the behavior of the Transcript Workspace screen. Every UI component in the workspace must obey these rules.

---

## The eight workspace rules

These are non-negotiable. They protect the legal defensibility of the transcript.

### Rule 1 — One living transcript

The workspace shows one transcript at a time, and that transcript is the same transcript regardless of which mode is active. Switching modes does not load a different transcript, generate a new transcript, or produce a "view" of a transcript. There is one transcript, and the user is working on it.

### Rule 2 — Raw is immutable

The `raw_transcript` and `raw_speaker_id` fields on every utterance are written once during transcription and never written again. No UI action — not editing, not accepting a suggestion, not reassigning a speaker, not even an unhandled error — may overwrite raw data. If your code is about to write to a `raw_*` field, you have a bug.

### Rule 3 — Working is mutable until certified

The `working_transcript`, `working_speaker_id`, and `qa_role` fields are mutable while the job's `layer` is `working`. They become read-only when `layer` is `certified`. This is enforced at the UI layer (the inputs become disabled, the click handlers no-op) — there is no database constraint.

### Rule 4 — Modes change only the right panel

The center transcript display and the left rail are identical in every mode. Switching modes changes only what appears in the right panel and, in some modes, the keyboard shortcuts active in the center. The transcript itself does not re-render when modes change.

### Rule 5 — AI may suggest, humans certify

The system never modifies the working transcript without explicit human action. AI-generated suggestions appear as inline cassettes; the human clicks Accept (or Reject, or Accept + Remember). There is no "Auto-apply all suggestions above 0.9 confidence" button. There is no background process that applies suggestions when the user isn't looking.

### Rule 6 — Every change creates a provenance event

Every edit, every speaker reassignment, every suggestion acceptance, every suggestion rejection writes one row to the `provenance` store. This is the legal audit trail. If a change happens without a provenance event, that's a bug.

### Rule 7 — Autosave is on, always

The user does not click Save. Every change persists to IndexedDB immediately. If the user closes the browser mid-sentence, the partial edit is preserved. There is no concept of "unsaved changes" in this app.

### Rule 8 — Undo works for human edits, not for AI accepts

The Undo button (Ctrl+Z) reverses the user's last manual edit. It does not undo an accepted AI suggestion — to reverse one of those, the user opens the suggestion in the Suggestions mode again and changes the decision. This asymmetry is intentional: undoing an AI accept is rarer and has different audit implications.

---

## What each mode does

### Edit mode

- Click any utterance text to edit it inline (textarea or contenteditable)
- Save on blur or after 1 second of inactivity
- Shift+Enter inserts a line break within an utterance
- Enter alone moves to the next utterance
- Backspace at start of utterance does NOT merge with previous utterance (use Formatting mode for that)
- The right panel shows: provenance log for the currently-focused utterance, plus recent edits across the job

### Suggestions mode

- The center transcript shows utterances; ones with pending suggestions get a subtle visual treatment (underline-wavy on the target text, an info icon in the gutter)
- Click an utterance with a pending suggestion → the right panel shows the suggestion cassette
- The cassette has three buttons: Accept (Enter), Reject (Esc), Accept + Remember (Cmd/Ctrl+Enter)
- Suggestions are processed one at a time — clicking Accept advances to the next utterance with a pending suggestion
- "Up next" preview in the right panel shows the next three pending suggestions
- The right panel also shows a small Correction Memory list

### Audio Review mode

- The right panel shows playback controls (play/pause, ±5 second seek, speed selector)
- Click any utterance's timecode → audio seeks to that utterance's start time
- During playback, the utterance whose `start_time <= currentTime < end_time` is highlighted (subtle background tint)
- Space bar plays/pauses
- J / L seek backward/forward by 3 seconds
- N moves to the next flagged utterance
- F toggles the current utterance's flag
- "Mark reviewed" button sets `utterance.reviewed = true` and advances to the next unreviewed utterance

### Formatting mode

- Right-click any utterance for a context menu: "Reassign speaker to..." with the list of known speakers plus "New speaker..."
- Each utterance shows toggleable Q. / A. labels in the left margin
- Drag-handle on each utterance for merge/split (split: click handle, then click position in text; merge: click handle on second utterance, choose "Merge into previous")
- The right panel shows speaker mapping table — for each Deepgram speaker_id, a text field for the human name and a dropdown for the role
- "Apply mapping" button updates all utterances with the new speaker names

---

## The header

Three things always visible at the top of the workspace:

1. **Case context** (left): case name, cause number, witness
2. **Mode tabs** (center): Edit | Suggestions | Audio Review | Formatting, with a count badge on Suggestions ("22 pending") and Issues (if you add an Issues mode later — defer for v1)
3. **Layer badges** (right): three small badges showing Raw (always locked), Working (active when `job.layer === 'working'`), Certified (active when `job.layer === 'certified'`)

---

## The footer

One line, persistently visible:

```
Autosaved · Raw immutable · AI may suggest, humans certify
```

This is the system's commitment, in chrome. It tells the reporter what they can trust.

---

## What happens when the user clicks "Continue to Certification"

The workspace doesn't unload. It stays open. The Certification screen opens as a modal or a separate route, but the workspace state is preserved. If the user goes back to the workspace, they're exactly where they left off.

This is important. The workspace is the home screen; everything else is a side trip.

---

## What happens when the job is locked

When `job.layer` becomes `certified`:

- Edit mode disables all input
- Suggestions mode shows existing decisions but hides Accept/Reject buttons
- Audio Review mode still works (audio review is read-only by nature)
- Formatting mode disables speaker reassignment
- The header layer badge flips from Working (amber) to Certified (green)
- The footer text changes the last sentence to "Working layer locked at {certified_at}"

---

## Performance notes

The workspace is not optimized for 30,000-word transcripts in v1. Render naively. If a real test transcript stutters, that's a v2 concern (virtualized lists, etc.). Do not pre-optimize.

---

## Success criterion for this document

You can answer:
1. What changes when the user switches modes?
2. What does "AI may suggest, humans certify" mean in concrete code terms?
3. Where does the audit trail live?

---

## Next

Read `05_EXPORT_RULES.md`.
