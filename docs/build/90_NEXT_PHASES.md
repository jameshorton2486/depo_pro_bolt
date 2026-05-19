# 90 — Next Phases: Outline

**Purpose.** Brief outline of Phases 3 through 10. Each will get its own detailed document (like Phase 2 got `20_PHASE_2_VISUAL_CHROME.md`) when you ask Claude for the next batch.

**When to read this.** Skim it now to understand the road ahead. Don't try to build from it — wait for the detailed documents.

---

## Phase 3 — Refactor CaseIntakePanel

**Time:** 90 minutes. **Tools:** Claude Code (local) or Claude in chat.

The current `src/components/CaseIntakePanel.tsx` is 992 lines in one file. Split it into:

- `src/stages/CaseIntake.tsx` (orchestrator, ~150 lines)
- `src/stages/intake/NodUpload.tsx`
- `src/stages/intake/CaseInfoForm.tsx`
- `src/stages/intake/DepositionDetailsForm.tsx`
- `src/stages/intake/AppearancesForm.tsx`
- `src/stages/intake/ReporterJobForm.tsx`
- `src/stages/intake/BillingForm.tsx`
- `src/stages/intake/KeytermReview.tsx`

Why: smaller files cost less per AI edit, are easier to reason about, and make Phase 4 changes safer.

**Success criterion:** Case Intake works identically to before, but `git ls-files src/stages/intake/` shows multiple files.

---

## Phase 4 — Workspace Shell

**Time:** 3-4 hours. **Tools:** Claude in chat + Bolt for visual polish.

The single biggest phase. Replace `WorkspacePlaceholder` with the real Workspace screen:

- Three-column layout (left rail, center transcript, right rail)
- Mode tab bar (Edit | Suggestions | Audio Review | Formatting)
- Center transcript display reading from IndexedDB
- Left rail showing speaker list, navigation, NOD entities
- Right rail starts as a provenance log
- Active mode is tracked in state; switching modes changes only the right rail

This phase introduces the full `Job` type from `03_TRANSCRIPT_MODEL.md` and bumps IndexedDB to v4 with the new stores (suggestions, corrections_memory, provenance, audio_blobs).

**Also in this phase:** wire Stage 2 (Transcribe) to advance to Stage 3 (Workspace) after a successful transcription.

**Success criterion:** After transcribing, the Workspace opens. You can see your utterances. Mode tabs are clickable. Switching modes doesn't reload the transcript.

---

## Phase 5 — Edit Mode

**Time:** 2-3 hours. **Tools:** Claude in chat.

Make transcript text editable in Edit mode:

- Click any utterance → it becomes an inline textarea
- Edit and click away (blur) → saves to `working_transcript`
- Provenance event written on every save
- Undo (Ctrl+Z) walks back the last edit
- Optimistic UI: edit appears immediately; save happens in background

**Success criterion:** Fix a typo in an utterance, close the browser, reopen, the fix is still there.

---

## Phase 6 — Suggestions Mode

**Time:** 3-4 hours. **Tools:** Claude in chat + Claude Code for the corrections engine.

Build the inline suggestion cassette workflow:

1. After transcription completes, run the deterministic corrections engine (ported from Python `spec_engine`) over every utterance. Write any proposed changes to the `suggestions` store.
2. In Suggestions mode, the right rail shows the next pending suggestion as a cassette.
3. Accept → apply to working transcript, advance to next suggestion.
4. Reject → mark rejected, advance.
5. Accept + Remember → apply AND add to Correction Memory (per reporter).

This phase requires porting the regex rules from `depo_transcribe/spec_engine/` to TypeScript. Claude in chat can do the port; Claude Code can run the tests.

**Success criterion:** Accept a suggestion → utterance text changes. Accept+Remember a similar correction → next time the same misheard word appears in a different case, it's auto-suggested.

---

## Phase 7 — Audio Review Mode

**Time:** 2-3 hours. **Tools:** Claude in chat.

Add audio playback synced at the utterance level:

- The audio Blob is stored in IndexedDB (`audio_blobs` store) at transcription time
- In Audio Review mode, an `<audio>` element loads from the Blob
- Each utterance has a clickable timecode (e.g., `02:14:33`)
- Click timecode → audio seeks
- During playback, the currently-playing utterance highlights
- Keyboard: Space (play/pause), J/L (seek ±3s), N (next flag), F (toggle flag)
- "Mark reviewed" button advances to next unreviewed utterance

No waveform. No word-level highlighting. Utterance-level only.

**Success criterion:** Click a timecode → audio plays from there. The utterance highlights as audio reaches it.

---

## Phase 8 — Formatting Mode

**Time:** 2 hours. **Tools:** Claude in chat.

Speaker management and Q/A structure:

- Right-click utterance → context menu with "Reassign speaker to..." options
- Speaker mapping table in the right rail
- Toggle Q. / A. labels per utterance
- Merge/split utterances (drag handle)

**Success criterion:** Reassign all utterances by speaker 1 to "Dr. Leifer" → label updates throughout. Toggle Q/A on an attorney's utterance → label appears.

---

## Phase 9 — Certification

**Time:** 2 hours. **Tools:** Bolt + Claude.

Stage 4 of the app:

- Pre-lock checklist (low-confidence reviewed, speakers mapped, suggestions resolved, format checked)
- Reporter signature input fields (name, CSR, expiration, date)
- Insertion page selection (title page type, appearances yes/no, index yes/no, etc.)
- Big Lock button — disabled until checklist complete and signature filled
- On lock: write `job.certified_at`, flip `job.layer` to 'certified', make workspace read-only

**Success criterion:** Click Lock → workspace becomes read-only. Header badge flips from Working to Certified.

---

## Phase 10 — Export

**Time:** 3-4 hours. **Tools:** Both frontend and backend.

Stage 5 of the app:

- Frontend builds Markdown and HTML exports purely in the browser
- Frontend calls Python backend `POST /export-docx` for the real DOCX
- Backend uses the UFM templates from `assets/ufm_templates/figures/`
- Backend populates with case data and signature
- Backend produces the final transcript .docx with low-confidence highlighting
- Frontend downloads the result

This phase requires the Python backend (Phase 1) to be working. If you skipped Phase 1 earlier, do it now.

**Success criterion:** Click Export → DOCX downloads. Open it in Word. It matches the workspace content with proper formatting, page numbering, and any selected insertion pages.

---

## Phase 11 — Web Deployment

**Time:** 2-4 hours. **Tools:** Vercel and Railway dashboards, plus a small backend proxy.

When the local app works end-to-end:

- Deploy the React frontend to Vercel (connects directly to your GitHub repo, auto-builds on push)
- Deploy the Python backend to Railway (or Render, Fly.io, Cloudflare Workers)
- Add a tiny serverless function or backend route that proxies Deepgram calls so the Deepgram API key isn't exposed in the browser bundle
- Update `VITE_BACKEND_URL` to the deployed backend URL

**Success criterion:** You can share a URL with someone, they open it, they can use Depo-Pro without you running anything locally.

This is covered in detail in `99_DEPLOYMENT.md`.

---

## The shape of v1 when all phases are done

- Frontend: ~30 TypeScript files, mostly under 200 lines each
- Backend: ~10 Python files, all small wrappers
- Tests: at least one happy-path test per phase
- Deployed at: a Vercel URL + a Railway URL
- Costs: $0-30/month depending on Deepgram and Anthropic usage

---

## How long will all this take, realistically?

If you're working part-time alongside your other projects:

- **2-3 weeks** if you have AI tools doing most of the writing and you're doing the integration work
- **4-6 weeks** if you're learning React/TypeScript along the way
- **2-3 days** for an experienced React developer doing it full-time

The longest stretches are Phase 4 (Workspace Shell) and Phase 10 (Export). Don't be surprised if those each take a week of part-time work.

---

## What might go wrong

The most common pitfalls:

1. **Scope creep.** You see something cool and decide to add it. Resist. Add to `WISHLIST.md`.

2. **Over-engineering a feature you'll rebuild later.** Phase 6's Correction Memory doesn't need to be perfect — it just needs to work. Don't optimize the storage layer in Phase 6 when Phase 10 might restructure it.

3. **Trying to build offline mode, multi-user, or sync.** These are explicitly out of v1 (see `01_MVP_SCOPE.md`). Don't.

4. **Skipping commits.** Commit after each working sub-feature. Push to GitHub. If you go a day without committing, you're doing it wrong.

5. **Not testing on real data.** Test with a real 30-minute deposition audio, not a 30-second sample. Real-world issues only show up at real-world scale.

---

## When to ask Claude for the next batch

After you've completed Phase 2 and confirmed:
- Five stages visible in the progress bar
- Layer badges in the header
- Footer in place
- Existing tabs (Case Intake, Transcribe) still work
- Everything committed and pushed

Come back to Claude and say:

> "I've completed Phase 2. The visual chrome works. I'm ready for the next batch — Phase 3 through Phase 10. Send detailed docs for each."

Claude will produce another 8-document batch, similar to this one. Don't ask for them all at once before you're ready — you'll get stale by the time you reach them.

---

## Next

If you're done with all the foundation documents (01-06) and Phase 0 / 0.5 / 1 / 2, you're ready to build.

If you've completed Phase 2 and want to keep going, ask Claude for the next batch.

If something is broken right now, go to `91_TROUBLESHOOTING.md`.
