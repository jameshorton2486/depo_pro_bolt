# 02 — Architecture

**Purpose.** Describe how the pieces of Depo-Pro fit together, what runs where, and what talks to what.

---

## The hybrid model

Depo-Pro is a **hybrid system**:

- A **React + TypeScript web app** that runs in your browser (the "frontend")
- A **Python FastAPI service** that runs on `localhost:8000` (the "backend")
- Two third-party APIs: **Deepgram** (speech-to-text) and **Anthropic** (cleanup pass)
- **IndexedDB** in the browser as the local database

Both the frontend and backend run on your Windows machine when you develop. When you deploy, the frontend goes to Vercel and the backend goes to Railway (or similar). The browser always talks to whichever backend is configured.

---

## Why hybrid

Two reasons:

1. **The Python project is mature where the React project is not.** The 683-line Anthropic cleanup prompt, the UFM template population code, the DOCX writer with low-confidence highlighting — these took months of refinement in the Python project. Re-implementing them in JavaScript would take more weeks than is worth spending.

2. **Browser limits.** A browser cannot easily generate UFM-compliant DOCX with content controls. The Python `docx` library does this natively. Trying to do this in JavaScript would be fragile.

The hybrid pattern lets each side do what it's best at:

- React handles live UI: typing, mode switching, clicking, drag-drop, IndexedDB
- Python handles batch operations: LLM call, DOCX generation, UFM template population

---

## The data flow, end to end

```
┌─────────────────────────────────────────────────────────────────┐
│                          BROWSER                                │
│                                                                 │
│  React app (Vite dev server on localhost:5173)                 │
│   • Case Intake form                                            │
│   • Audio file upload                                           │
│   • Transcript Workspace (4 modes)                              │
│   • Certification screen                                        │
│   • Export controls                                             │
│                                                                 │
│  IndexedDB                                                      │
│   • Jobs                                                        │
│   • Utterances (raw + working)                                  │
│   • Corrections                                                 │
│   • Correction Memory                                           │
│   • Audio file (Blob)                                           │
│                                                                 │
└──┬─────────────────────────────────────────────────┬────────────┘
   │                                                 │
   │  HTTPS                                          │  HTTP (local)
   │                                                 │
   ▼                                                 ▼
┌─────────────────────┐                ┌────────────────────────────┐
│   Deepgram API      │                │  Python FastAPI backend    │
│   (Nova-3)          │                │  localhost:8000            │
│                     │                │                            │
│   POST /listen      │                │  POST /cleanup             │
│   → returns         │                │   → calls Anthropic        │
│     transcript      │                │                            │
│     with word       │                │  POST /populate-templates  │
│     timestamps      │                │   → fills UFM .docx files  │
│     and confidence  │                │                            │
│                     │                │  POST /export-docx         │
└─────────────────────┘                │   → builds final transcript│
                                       │     .docx                  │
                                       │                            │
                                       └────────┬───────────────────┘
                                                │
                                                │  HTTPS
                                                ▼
                                       ┌────────────────────────────┐
                                       │   Anthropic API            │
                                       │   (Claude)                 │
                                       │                            │
                                       │   POST /v1/messages        │
                                       │   → cleanup pass           │
                                       └────────────────────────────┘
```

---

## What lives where

### In the browser (React app)

- All user interface
- All workspace editing
- All audio playback
- Case intake parsing (PDF/DOCX/TXT → fields) using `pdfjs-dist` and `mammoth`
- Deepgram API calls (direct, browser-to-Deepgram, with the API key in `.env`)
- Local storage of audio files, transcripts, corrections (IndexedDB)
- Deterministic regex-based suggestions (ported from Python `spec_engine`)

### In the Python backend (FastAPI service)

- Anthropic cleanup pass (uses the existing 683-line prompt)
- UFM template population (fills the 13 `.docx` templates with case data)
- DOCX export of the full deposition transcript with proper formatting and low-confidence highlighting
- Optional: any future server-side AI operations

### In Deepgram

- Audio → transcript with word-level timestamps and confidence
- Speaker diarization
- Keyterm boosting from the case dictionary

### In Anthropic (via the Python backend)

- Final cleanup pass over the transcript before export
- Enforces verbatim posture, low-confidence marker preservation, proper noun corrections from case metadata

---

## What never crosses boundaries

These are deliberate constraints that keep the system safe:

- **The Anthropic API key never goes to the browser.** It lives in the Python backend's `.env`. The browser cannot exfiltrate it because the browser never sees it.
- **The Deepgram API key is in the browser during local development.** This is acceptable for `localhost`. For production deployment, the Deepgram call also gets moved behind the Python backend (or a serverless proxy). This change is documented in `99_DEPLOYMENT.md`.
- **The raw Deepgram JSON is never modified.** It is written once to IndexedDB and read-only thereafter. All editing happens in a separate "working" copy. This is the "raw is immutable" rule from `04_WORKSPACE_RULES.md`.

---

## The three transcript layers

You will see references to three layers throughout the documents:

| Layer | What it is | Where it lives | Who writes it |
|-------|-----------|----------------|---------------|
| **Raw** | The original Deepgram output | IndexedDB `utterances` table, field `raw_transcript` | Written once after transcription. Never modified. |
| **Working** | The transcript as the reporter edits it | IndexedDB `utterances` table, field `working_transcript` | Updated on every edit, AI suggestion accept, speaker reassignment |
| **Certified** | The frozen, locked transcript | IndexedDB `jobs` table, field `certified_at` timestamp + working transcript at that moment | Set once when the reporter clicks Lock in Stage 4. After this, working transcript becomes read-only. |

Visually in the header, these are shown as three badges. The active layer is highlighted.

---

## File layout when everything is built

```
depo_pro_bolt/                    # The React app (existing Bolt project)
├── docs/                         # Documentation (canonical specs, this package)
├── public/
├── assets/
│   └── ufm_templates/            # The 13 .docx templates from the Python project
├── src/
│   ├── App.tsx                   # Stage router
│   ├── main.tsx
│   ├── stages/
│   │   ├── CaseIntake.tsx
│   │   ├── Transcribe.tsx
│   │   ├── Workspace.tsx         # The big one
│   │   ├── Certification.tsx
│   │   └── Export.tsx
│   ├── workspace/
│   │   ├── modes/
│   │   │   ├── EditMode.tsx
│   │   │   ├── SuggestionsMode.tsx
│   │   │   ├── AudioReviewMode.tsx
│   │   │   └── FormattingMode.tsx
│   │   └── panels/
│   │       ├── LeftRail.tsx
│   │       ├── RightRail.tsx
│   │       └── TranscriptCenter.tsx
│   ├── components/
│   │   ├── LayerBadges.tsx
│   │   ├── StageProgress.tsx
│   │   └── SuggestionCassette.tsx
│   ├── lib/
│   │   ├── deepgramClient.ts
│   │   ├── localStore.ts         # IndexedDB wrapper
│   │   ├── corrections.ts        # Ported from Python spec_engine
│   │   ├── legalDictionary.ts    # Imported from JSON
│   │   ├── pythonBackend.ts      # HTTP client for the FastAPI service
│   │   └── ...
│   ├── prompts/
│   │   └── cleanup_prompt.ts     # The 683-line prompt as a TS constant
│   └── types/
│       └── ...

depo_pro_backend/                 # The Python FastAPI service (new, lightweight)
├── pyproject.toml
├── .env                          # ANTHROPIC_API_KEY lives here
├── main.py                       # FastAPI app
├── routes/
│   ├── cleanup.py                # POST /cleanup
│   ├── populate.py               # POST /populate-templates
│   └── export.py                 # POST /export-docx
├── lib/
│   ├── cleanup_logic.py          # Imports from depo_transcribe/clean_format
│   ├── template_population.py    # Imports from depo_transcribe/ufm_engine
│   └── docx_export.py
└── assets/
    └── ufm_templates/            # Same 13 .docx templates

depo_transcribe/                  # Your existing Python project (unchanged)
                                  # depo_pro_backend imports from this
```

---

## Why both projects coexist

You **do not delete the Python `depo_transcribe` project**. The new `depo_pro_backend` is a thin FastAPI wrapper that imports functions from `depo_transcribe`. This way:

- The Python project keeps working as a desktop app for any cases you process today
- The new backend service adds the HTTP layer without modifying the underlying logic
- If the FastAPI service breaks, the desktop app still works

This is the safest possible migration path.

---

## Success criterion for this document

You can sketch the diagram above on paper from memory. You know what runs in the browser, what runs in Python, and what runs in third-party APIs.

---

## Next

Read `03_TRANSCRIPT_MODEL.md`.
