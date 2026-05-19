# 06 — CLAUDE.md (Governance for AI Tools)

**Purpose.** This is the project's governance document. **Every AI tool that works on this codebase must read this first.** Save it as `CLAUDE.md` at the root of the `depo_pro_bolt` repository. Bolt, Claude (in chat), Claude Code, Cursor, and ChatGPT/Codex should all be pointed at this file before they make any change.

---

## Save this file at: `depo_pro_bolt/CLAUDE.md`

When you create a new file in your repo named `CLAUDE.md`, paste the entire content below into it. Start the file with `# Depo-Pro` and end with the "Safe Change Checklist". Everything between is the governance.

---

```markdown
# Depo-Pro

## Purpose

Depo-Pro is a hybrid web application that turns deposition audio into a clean, certified, UFM-compliant Word document. It has two parts:

- **React + TypeScript frontend** (this repo) — handles the user interface, audio upload, Deepgram transcription, transcript workspace, and certification workflow
- **Python FastAPI backend** (separate repo: `depo_pro_backend`) — handles the Anthropic cleanup pass, UFM template population, and DOCX export. Imports logic from the existing `depo_transcribe` desktop app.

This frontend stores data in IndexedDB locally. It never persists data to a cloud database. There is no authentication; this is a single-user local app for v1.

## Scope and rules

Read `docs/01_MVP_SCOPE.md` before suggesting any feature. If a feature is not in the MVP scope, the answer is "v2." Do not propose adding features outside the scope.

Read `docs/04_WORKSPACE_RULES.md` before changing anything in the workspace. The eight workspace rules are non-negotiable.

## Architecture

### Frontend layers

- `src/stages/` — one component per app stage (CaseIntake, Transcribe, Workspace, Certification, Export)
- `src/workspace/modes/` — one component per workspace mode (Edit, Suggestions, AudioReview, Formatting)
- `src/workspace/panels/` — shared workspace panels (LeftRail, RightRail, TranscriptCenter)
- `src/components/` — reusable atomic components (LayerBadges, StageProgress, SuggestionCassette)
- `src/lib/` — pure logic modules (localStore for IndexedDB, deepgramClient, corrections engine, pythonBackend client)
- `src/prompts/` — text constants for AI calls
- `src/types/` — TypeScript type definitions

### Backend interactions

The frontend calls the Python backend at `import.meta.env.VITE_BACKEND_URL` (default `http://localhost:8000`) for three operations only:

- `POST /cleanup` — Anthropic cleanup over a transcript (used at export only, optional)
- `POST /populate-templates` — fill UFM templates with case data
- `POST /export-docx` — produce the final UFM-compliant DOCX

Any other backend operation requires updating this document first.

## Change Rules

1. **Stay in your layer.** UI components do not call IndexedDB directly — they call functions in `src/lib/localStore.ts`. The `lib/` modules do not import from `src/components/` or `src/stages/`.

2. **Raw is immutable.** No code path may write to `Utterance.raw_transcript`, `Utterance.raw_speaker_id`, or `Utterance.words` after the initial transcription writes them. If you need to make a change, write to the `working_*` fields.

3. **Every state change is a provenance event.** When working transcript text or speaker assignment changes, write a `ProvenanceEvent` row.

4. **No new dependencies without justification.** Tailwind is the only CSS framework. Lucide is the only icon library. Don't add a UI kit, a state library (Redux/Zustand/etc.), or a router unless explicitly approved.

5. **Type everything.** New code is TypeScript with explicit types on exported functions and React component props. Avoid `any` unless interfacing with an untyped third-party library.

6. **Don't introduce a backend dependency for a frontend-only feature.** If something can be done in the browser, do it in the browser. The Python backend exists for things the browser can't do well (DOCX generation, Anthropic with API key safety).

7. **One feature per pull request.** Don't combine "add Audio Review mode" with "refactor IntakePanel" in the same change.

## Code Style

- 2-space indentation
- Single quotes for strings except JSX (which uses double per Tailwind convention)
- Semicolons everywhere
- Function components, not class components
- Named exports for components and utilities (default exports only for entry points)
- File names: kebab-case for non-components (`local-store.ts`), PascalCase for components (`LayerBadges.tsx`)
- Imports sorted: third-party first, then `~/` aliases, then relative paths

## Don't do

- Don't paraphrase, summarize, or "improve readability" of transcript text in any deterministic code path. Verbatim is the legal posture.
- Don't remove filler words ("um", "uh", "you know") deterministically. They are testimony.
- Don't generate AI suggestions in batch behind the scenes. Suggestions appear when the user opens Suggestions mode and clicks an utterance.
- Don't add a "Confirm" dialog for every action. Autosave is the default. Confirm only for destructive operations (delete job, reset corrections memory).
- Don't add telemetry, analytics, or anything that calls a third-party endpoint other than Deepgram (frontend) and Anthropic (backend only).

## Tech Stack

| Area | Tool |
|------|------|
| Build tool | Vite |
| Frontend framework | React 18 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS |
| Icons | Lucide React |
| Local DB | IndexedDB (custom wrapper in `src/lib/localStore.ts`) |
| Speech-to-text | Deepgram Nova-3 via direct browser fetch |
| AI cleanup | Anthropic Claude via Python backend |
| DOCX | Python `python-docx` via backend |
| PDF intake | `pdfjs-dist` (browser) |
| DOCX intake | `mammoth` (browser) |
| Backend framework | FastAPI |
| Backend runtime | Python 3.11+ |

## Environment variables

Frontend `.env`:
```
VITE_DEEPGRAM_API_KEY=...
VITE_BACKEND_URL=http://localhost:8000
```

Backend `.env`:
```
ANTHROPIC_API_KEY=...
DEPO_PRO_FRONTEND_ORIGIN=http://localhost:5173
```

Never check `.env` into git. The `.gitignore` already excludes it.

## Run

Frontend:
```powershell
npm install
npm run dev
# Opens http://localhost:5173
```

Backend:
```powershell
cd ../depo_pro_backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload
# Opens http://localhost:8000
```

## Test

Frontend:
```powershell
npm test
```

Backend:
```powershell
pytest
```

## Safe Change Checklist

Before committing a change, verify:

- [ ] Does the change stay within the correct layer (no UI importing IndexedDB, no lib importing UI)?
- [ ] If the change affects an `Utterance`, do `raw_*` fields remain untouched?
- [ ] If a transcript-mutating action was added, does it write a `ProvenanceEvent`?
- [ ] If a feature was added, is it in the MVP scope (`docs/01_MVP_SCOPE.md`)?
- [ ] If a workspace rule is affected, is the change consistent with `docs/04_WORKSPACE_RULES.md`?
- [ ] Did the change add a new dependency? If yes, was it absolutely necessary?
- [ ] Are types added or updated in `src/types/`?
- [ ] Do existing tests still pass?
```

---

## Why this document matters

You will be using multiple AI tools to build this project. Each one has its own context window, its own training cutoff, and its own tendencies. Without a shared governance document, they will drift:

- Bolt might add a sixth stage because it looks balanced
- Claude might suggest a state management library because the prop drilling looks long
- ChatGPT might add filler-word removal because it reads as a feature improvement
- Codex might write tests against an old version of the data model

CLAUDE.md is the contract that prevents this. Before any AI tool makes a change, you point it at this document and it reads it.

In Bolt, you can do this by:
1. Creating a file called `CLAUDE.md` in the repo root with the content above
2. At the start of each new Bolt session, telling Bolt: "Read CLAUDE.md and the scope documents in `docs/` before making any change."

In Claude (in chat), do this by:
1. Pasting the relevant document into the conversation when you ask for code

In Cursor / Claude Code locally, the file is automatically read because it's named `CLAUDE.md`.

---

## Success criterion for this document

You have created `depo_pro_bolt/CLAUDE.md` with the content from the fenced block above. The first thing any AI sees when working on the repo is this file.

---

## Next

Read `10_PHASE_0_LOCAL_SETUP.md` and follow it step by step.

That document gets the existing Bolt app running on your Windows machine. After that, you'll move into the asset transplant (`11`) and backend setup (`12`), then begin building the visual chrome (`20`).
