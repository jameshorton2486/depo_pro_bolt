# 01 — MVP Scope (Locked)

**Purpose.** This document defines exactly what is and is not in version 1 of Depo-Pro. It is locked. Do not modify it during the build. If you decide a feature must change scope, update this document first, then update the build, in that order.

---

## The five stages of the app

Version 1 has exactly five stages:

1. **Case Intake** — gather case metadata, parse the Notice of Deposition, build the keyterm dictionary
2. **Transcribe** — upload audio, send to Deepgram, store raw transcript
3. **Transcript Workspace** — the heart of the app, where the reporter does their work
4. **Certification** — pre-lock checklist, signature, lock the working transcript
5. **Export** — produce Markdown, HTML, and DOCX outputs

No sixth stage. No separate "AI Assist" stage. No separate "Insertion Pages" stage — insertion pages are part of Certification and Export.

---

## The Transcript Workspace has exactly four modes

Inside the Workspace, the user switches between four modes. The transcript itself never reloads when modes change; only the right-hand panel changes.

1. **Edit** — free editing of transcript text
2. **Suggestions** — review inline AI suggestions with Accept / Reject / Accept + Remember
3. **Audio Review** — utterance-level synced playback
4. **Formatting** — speaker reassignment, Q/A label toggling, paragraph merge/split

---

## What v1 includes

### Stage 1 — Case Intake
- Drop a Notice of Deposition (PDF, DOCX, or TXT)
- Auto-extract case style, cause number, parties, attorneys, witness, date, location
- Manual edit of all extracted fields
- Auto-extract keyterms (proper nouns, firms, addresses, technical terms)
- Manual add/remove of keyterms
- Save to IndexedDB; case persists across browser refresh

### Stage 2 — Transcribe
- Drop an audio file (MP3, WAV, M4A, MP4)
- Send directly to Deepgram with Nova-3 model
- Pass extracted keyterms as Deepgram boost terms
- Speaker diarization enabled
- Word-level timestamps and confidence scores enabled
- Store raw Deepgram JSON immutably in IndexedDB
- Store derived utterances (one per speaker turn) in IndexedDB

### Stage 3 — Workspace
- Persistent three-column layout (left rail, center transcript, right rail)
- Four mode tabs; switching modes changes only the right panel
- Layer badges in header (Raw locked / Working active / Certified pending)
- **Edit mode:** click-to-edit any utterance text inline; saves on blur
- **Suggestions mode:** inline cassettes show one suggestion at a time per utterance with three actions (Accept, Reject, Accept + Remember); Correction Memory is stored per-reporter
- **Audio Review mode:** click utterance timecode to seek audio; currently-playing utterance highlights; space bar plays/pauses
- **Formatting mode:** right-click utterance for speaker reassignment; toggle Q./A. labels on/off
- Autosave every change; provenance log records who changed what and when

### Stage 4 — Certification
- Pre-lock checklist (low-confidence reviewed, speakers mapped, AI suggestions resolved, format validated)
- Reporter signature input field
- Choose which insertion pages to generate (title page, appearances, index, witness setup, signature grid, certification)
- Lock button flips the job from Working to Certified
- Locked transcripts are read-only in the workspace

### Stage 5 — Export
- Markdown export (plain text, useful for review)
- HTML export (printable, useful for email/web)
- DOCX export (the real deliverable — uses Python backend with UFM templates)
- Insertion pages bundled into a single output package
- Download as individual files or a single zip

---

## What v1 does NOT include

Each of the following is explicitly deferred to v2 or beyond. **Do not build any of these in v1.**

- Smooth word-by-word highlighting during audio playback (utterance-level only)
- Audio waveform visualization
- Virtualized transcript rendering for 300+ page transcripts (naive rendering only)
- Live UFM pagination in the editor (pagination happens at export time)
- Real-time AI suggestion regeneration (suggestions are computed once after transcription)
- LLM-driven AI suggestions in the Workspace (deterministic rule-based suggestions only in v1; LLM cleanup happens at export time via the Python backend)
- Correction Memory pattern detection or rule promotion (just save the corrections; no learning)
- Multi-user collaboration
- Cloud sync / Supabase / any backend other than the local Python service
- Authentication / user accounts
- Errata sheet workflow (v2)
- Read-and-sign workflow with deponent (v2)
- Video deposition support (audio-only in v1)
- Multi-day depositions / volume management (v2)
- Search-and-replace across transcripts (v2)
- Find-in-transcript (v2)
- Custom UFM template editing inside the app (templates come from the Python project's existing files)
- E-Trans / Case CATalyst / PTX format export (v2)
- Word index / alphabetical witness index generation (v2)
- Real-time transcription during live deposition (v2)
- Mobile UI (desktop only in v1)

---

## Performance budget

- **Audio file size:** up to 200 MB tested, up to 500 MB best-effort
- **Audio duration:** up to 2 hours synchronously; longer files require Deepgram async polling (which is fine to implement when needed, but don't over-engineer for v1)
- **Transcript size:** up to 100 pages renders naively without performance work; beyond that may stutter but should still work
- **Browser support:** Chrome and Edge on Windows. Firefox should work but is not tested. Safari is out of scope for v1.

---

## Quality gates

These are the things that must work end-to-end before v1 is considered shippable:

1. Drop an NOD → fields populate → save → reopen later, case is still there
2. Drop a 5-minute audio file → transcription completes → utterances appear in workspace
3. Edit an utterance → close browser → reopen → edit persisted
4. Accept an AI suggestion → utterance changes → Correction Memory has the entry
5. Click an utterance timecode in Audio Review → audio seeks → utterance highlights as it plays
6. Reassign a speaker → label updates throughout the transcript
7. Click Lock → workspace becomes read-only, layer badge flips to Certified
8. Click Export → DOCX file downloads with proper UFM formatting and matches the workspace content

If any of these eight things doesn't work, v1 is not done. If all eight work, v1 is done — even if some "nice to have" features aren't built.

---

## Why this scope

The previous iterations of this project drifted toward "CAT software + litigation management + AI research platform + transcription engine + workflow automation suite all at once." Every one of those is a real product. None of them is what you can finish alone in a reasonable timeframe.

What you can finish: a reporter-grade tool that turns a deposition audio file into a clean, certified UFM-compliant DOCX with human-supervised AI assistance. That is genuinely valuable. That is v1.

Everything else is v2.

---

## Success criterion for this document

You have read the entire scope list. You agree (or you negotiate changes here in the document, not later). You can name the five stages and four workspace modes from memory.

---

## Next

Read `02_ARCHITECTURE.md`.
