# 12 — Phase 1: Python Backend Setup

**Purpose.** Stand up the small FastAPI service that the React app will call for DOCX export and Anthropic cleanup. This phase can be **deferred** if you want — Stages 1 through 4 of the React app don't need the backend. You'll need it when you implement Stage 5 (Export).

**Time estimate.** 60 minutes (90 if Python isn't installed).

**Prerequisites.** Phases 0 and 0.5 complete. Anthropic API key.

**When to do this phase.** Either now, or right before you start Phase 10 (Export). Either is valid. If you're impatient to see UI progress, skip ahead to Phase 2.

---

## Step 1 — Install Python (if needed)

```powershell
python --version
```

If you see `Python 3.11.x` or higher, skip to Step 2.

If not, or if the version is too old:

1. Browser to https://www.python.org/downloads/
2. Download Python 3.12 (or whatever the current stable is, as long as it's 3.11+)
3. Run the installer. **Important: check "Add python.exe to PATH"** before clicking Install Now.
4. Close all PowerShell windows. Open a fresh one. Run `python --version` again.

---

## Step 2 — Create the backend project folder

We're creating a **new** project for the backend. It lives next to `depo_pro_bolt` and `depo_transcribe`.

```powershell
cd C:\Users\james\PycharmProjects
mkdir depo_pro_backend
cd depo_pro_backend
```

---

## Step 3 — Create a Python virtual environment

A virtual environment keeps this project's Python packages separate from your system Python.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

After activation, your PowerShell prompt should show `(.venv)` at the start. That means you're using the virtual environment.

If you get an error about scripts being disabled:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Answer Y when prompted. Then retry `.\.venv\Scripts\Activate.ps1`.

---

## Step 4 — Install the Python dependencies

Still inside the activated venv:

```powershell
pip install fastapi uvicorn[standard] python-multipart python-dotenv anthropic python-docx httpx
```

This installs:

- **fastapi** — the web framework
- **uvicorn** — the server that runs FastAPI
- **python-multipart** — for handling file uploads
- **python-dotenv** — for `.env` file loading
- **anthropic** — official Anthropic Python SDK
- **python-docx** — for DOCX manipulation
- **httpx** — modern HTTP client (used by the existing `depo_transcribe` project too)

If you want pinned versions later, you can generate a `requirements.txt`. For now, install latest.

---

## Step 5 — Create the project files

In `depo_pro_backend`, create these files. I'll give you the content for each.

### `.env`

```powershell
notepad .env
```

Content:

```
ANTHROPIC_API_KEY=PASTE_YOUR_ANTHROPIC_KEY_HERE
DEPO_PRO_FRONTEND_ORIGIN=http://localhost:5173
DEPO_TRANSCRIBE_PATH=C:\Users\james\PycharmProjects\depo_transcribe
```

Get your Anthropic key from https://console.anthropic.com/ and paste it in.

Save and close.

### `.gitignore`

```powershell
notepad .gitignore
```

Content:

```
.venv/
__pycache__/
*.pyc
.env
.pytest_cache/
*.log
output/
```

Save.

### `main.py`

```powershell
notepad main.py
```

Content:

```python
"""
Depo-Pro Backend — FastAPI service for DOCX export and Anthropic cleanup.

This is a thin HTTP wrapper. The real logic lives in the existing
depo_transcribe project (see DEPO_TRANSCRIBE_PATH in .env). This service
imports from that project rather than duplicating its code.

Run:
    .\.venv\Scripts\Activate.ps1
    uvicorn main:app --reload
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

# Make the existing depo_transcribe project importable.
DEPO_TRANSCRIBE_PATH = os.environ.get("DEPO_TRANSCRIBE_PATH")
if DEPO_TRANSCRIBE_PATH and Path(DEPO_TRANSCRIBE_PATH).exists():
    sys.path.insert(0, DEPO_TRANSCRIBE_PATH)
    print(f"[depo_pro_backend] depo_transcribe importable from {DEPO_TRANSCRIBE_PATH}")
else:
    print(f"[depo_pro_backend] WARNING: DEPO_TRANSCRIBE_PATH not set or does not exist")
    print(f"[depo_pro_backend] Some endpoints will return 501 Not Implemented")


app = FastAPI(
    title="Depo-Pro Backend",
    description="DOCX export, Anthropic cleanup, UFM template population",
    version="0.1.0",
)


# CORS — allow the frontend dev server to call this backend
FRONTEND_ORIGIN = os.environ.get("DEPO_PRO_FRONTEND_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Health check. Confirms the backend is running."""
    anthropic_key_present = bool(os.environ.get("ANTHROPIC_API_KEY"))
    depo_transcribe_path_ok = bool(DEPO_TRANSCRIBE_PATH) and Path(DEPO_TRANSCRIBE_PATH).exists()
    return {
        "status": "ok",
        "service": "depo_pro_backend",
        "version": "0.1.0",
        "anthropic_key_configured": anthropic_key_present,
        "depo_transcribe_path_ok": depo_transcribe_path_ok,
    }


# Import route modules (they register their own endpoints on `app`)
from routes import cleanup, populate, export  # noqa: E402
```

Save and close.

### `routes/__init__.py`

```powershell
mkdir routes
notepad routes\__init__.py
```

Content: just leave it empty. Save.

### `routes/cleanup.py`

```powershell
notepad routes\cleanup.py
```

Content:

```python
"""
POST /cleanup — Run Anthropic cleanup pass over a transcript.

Accepts the working transcript with LC markers wrapped. Sends to Anthropic
with the cleanup prompt. Returns cleaned text with LC markers preserved.

This endpoint is OPTIONAL in v1. The frontend can skip it and produce
DOCX from the working transcript as-is.
"""

import os
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel

from main import app


class CleanupRequest(BaseModel):
    transcript: str
    case_meta: dict[str, Any]
    model: str = "claude-opus-4-7"  # Or whatever is current


class CleanupResponse(BaseModel):
    cleaned_transcript: str
    model_used: str
    input_tokens: int | None = None
    output_tokens: int | None = None


@app.post("/cleanup", response_model=CleanupResponse)
async def cleanup_endpoint(req: CleanupRequest):
    """Run Anthropic cleanup pass."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")

    # Lazy import so the server can boot even if depo_transcribe path is wrong
    try:
        from clean_format.prompt import CLEAN_FORMAT_SYSTEM_PROMPT
    except ImportError as e:
        raise HTTPException(
            status_code=501,
            detail=f"Could not import depo_transcribe cleanup prompt: {e}",
        )

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)

    # Build the user message containing case metadata + transcript
    user_message = (
        f"CASE METADATA\n"
        f"{format_case_meta(req.case_meta)}\n\n"
        f"RAW TRANSCRIPT\n"
        f"{req.transcript}"
    )

    response = client.messages.create(
        model=req.model,
        max_tokens=8000,
        system=CLEAN_FORMAT_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    cleaned = response.content[0].text if response.content else ""
    return CleanupResponse(
        cleaned_transcript=cleaned,
        model_used=response.model,
        input_tokens=response.usage.input_tokens if response.usage else None,
        output_tokens=response.usage.output_tokens if response.usage else None,
    )


def format_case_meta(meta: dict[str, Any]) -> str:
    """Format the case metadata block for inclusion in the prompt."""
    lines = []
    for key, value in meta.items():
        if value:
            lines.append(f"  {key}: {value}")
    return "\n".join(lines)
```

Save and close.

### `routes/populate.py`

```powershell
notepad routes\populate.py
```

Content:

```python
"""
POST /populate-templates — Populate UFM templates with case data.

Returns a ZIP of populated .docx files.
"""

import io
import zipfile
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from main import app


class PopulateRequest(BaseModel):
    templates: list[str]  # template ids from the manifest
    fields: dict[str, Any]
    block_toggles: dict[str, bool] = {}


# Templates live at depo_pro_backend/../depo_pro_bolt/assets/ufm_templates/figures/
# Or you can use the depo_transcribe copy directly. For now we use depo_transcribe's.
import os
DEPO_TRANSCRIBE_PATH = os.environ.get("DEPO_TRANSCRIBE_PATH")
TEMPLATES_DIR = (
    Path(DEPO_TRANSCRIBE_PATH) / "ufm_engine" / "templates" / "figures"
    if DEPO_TRANSCRIBE_PATH else None
)


@app.post("/populate-templates")
async def populate_templates_endpoint(req: PopulateRequest):
    """Populate the requested templates and return them as a zip."""
    if not TEMPLATES_DIR or not TEMPLATES_DIR.exists():
        raise HTTPException(
            status_code=501,
            detail=f"Templates directory not found: {TEMPLATES_DIR}",
        )

    try:
        from ufm_engine.populator.populate import populate
    except ImportError as e:
        raise HTTPException(
            status_code=501,
            detail=f"Could not import ufm_engine.populator: {e}",
        )

    # Build a zip in memory containing each populated template
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for template_id in req.templates:
            src = TEMPLATES_DIR / f"{template_id}.docx"
            if not src.exists():
                continue  # silently skip missing; could also raise

            # Write to a temp file, read back, add to zip
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
                tmp_path = Path(tmp.name)

            try:
                populate(
                    template_path=src,
                    output_path=tmp_path,
                    fields=req.fields,
                    block_toggles=req.block_toggles,
                )
                zf.write(tmp_path, arcname=f"{template_id}.docx")
            finally:
                tmp_path.unlink(missing_ok=True)

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=ufm_templates.zip"},
    )
```

Save and close.

### `routes/export.py`

```powershell
notepad routes\export.py
```

Content:

```python
"""
POST /export-docx — Produce the final UFM-compliant deposition .docx.

This is the main deliverable. Frontend POSTs the full job state and
selected insertion pages; backend returns a single .docx download.
"""

from typing import Any

from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from main import app


class Utterance(BaseModel):
    sequence_index: int
    transcript: str  # working_transcript, may contain ‹LC:...› markers
    speaker_name: str
    qa_role: str | None = None  # 'Q', 'A', or None
    start_time: float


class InsertionPages(BaseModel):
    title_page: str | None = None  # 'tx_state' | 'federal' | None
    appearances: bool = True
    index_chronological: bool = True
    witness_setup: str | None = "standard"  # 'standard' | 'interpreter' | None
    signature_grid: bool = False
    certification: str | None = "tx_sig_required"


class Signature(BaseModel):
    reporter_name: str
    csr_number: str
    csr_expiration: str
    certification_date: str


class ExportDocxRequest(BaseModel):
    job_id: str
    case_meta: dict[str, Any]
    speaker_names: dict[str, str] = {}  # JSON keys are strings in Pydantic
    speaker_roles: dict[str, str] = {}
    utterances: list[Utterance]
    insertion_pages: InsertionPages
    signature: Signature
    run_ai_cleanup: bool = False


@app.post("/export-docx")
async def export_docx_endpoint(req: ExportDocxRequest):
    """Build and return the final deposition .docx."""

    # PHASE 1 stub: assemble a minimal but real .docx with the transcript body
    # only. Real UFM template integration comes when the frontend Phase 10
    # (Export) is built.

    try:
        from docx import Document
        from docx.shared import Inches, Pt
    except ImportError as e:
        raise HTTPException(status_code=501, detail=f"python-docx not available: {e}")

    doc = Document()

    # Set basic Texas UFM-ish page layout
    for section in doc.sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.75)
        section.right_margin = Inches(1.0)

    # Title block (placeholder — real version uses UFM template)
    title = doc.add_paragraph()
    title_run = title.add_run(
        f"DEPOSITION OF {req.case_meta.get('witness_name', 'WITNESS')}"
    )
    title_run.bold = True
    title_run.font.size = Pt(14)

    doc.add_paragraph(
        f"Cause No. {req.case_meta.get('cause_number', '')}\n"
        f"{req.case_meta.get('case_style', '')}"
    )

    doc.add_paragraph()  # spacer

    # Body
    for u in req.utterances:
        para = doc.add_paragraph()
        if u.qa_role in ("Q", "A"):
            label_run = para.add_run(f"\t{u.qa_role}.\t")
            label_run.bold = True
        else:
            label_run = para.add_run(f"{u.speaker_name}:  ")
            label_run.bold = True
        para.add_run(u.transcript)

    # Save to bytes
    import io
    buf = io.BytesIO()
    doc.save(buf)

    witness_last = (
        req.case_meta.get("witness_name", "Unknown").split()[-1]
        if req.case_meta.get("witness_name") else "Unknown"
    )
    depo_date = req.case_meta.get("depo_date", "Date")
    filename = f"{witness_last}_Deposition_{depo_date}.docx"

    return Response(
        content=buf.getvalue(),
        media_type=(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
```

Save and close.

---

## Step 6 — Test the server starts

```powershell
uvicorn main:app --reload
```

You should see output like:

```
INFO:     Will watch for changes in these directories: ['C:\\Users\\james\\PycharmProjects\\depo_pro_backend']
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [12345] using StatReload
[depo_pro_backend] depo_transcribe importable from C:\Users\james\PycharmProjects\depo_transcribe
INFO:     Started server process [12346]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

If you see errors, the most common are:

- `ImportError: No module named 'main'` — make sure you're in the `depo_pro_backend` folder
- `ANTHROPIC_API_KEY not configured` — check your `.env` has the key

---

## Step 7 — Verify the health endpoint

In a **separate** PowerShell window (leave the server running in the first one):

```powershell
curl http://localhost:8000/
```

Or just open `http://localhost:8000/` in your browser. You should see JSON like:

```json
{
  "status": "ok",
  "service": "depo_pro_backend",
  "version": "0.1.0",
  "anthropic_key_configured": true,
  "depo_transcribe_path_ok": true
}
```

If both `anthropic_key_configured` and `depo_transcribe_path_ok` are `true`, you're good. If either is `false`, fix that before moving on.

---

## Step 8 — View the auto-generated API docs

FastAPI generates documentation automatically. Visit:

```
http://localhost:8000/docs
```

You'll see an interactive page listing your three endpoints (`/cleanup`, `/populate-templates`, `/export-docx`) with their request schemas and "Try it out" buttons. This is genuinely useful for testing — you can hit endpoints right from the browser.

---

## Step 9 — Initialize git for the backend

```powershell
git init
git add .
git status
```

Confirm `.env` is NOT in the list of files to commit. Then:

```powershell
git commit -m "Initial commit: depo_pro_backend FastAPI service"
```

You can optionally push this to a new GitHub repo. From `https://github.com/new`, create a repo called `depo_pro_backend`, then:

```powershell
git remote add origin https://github.com/jameshorton2486/depo_pro_backend.git
git branch -M main
git push -u origin main
```

---

## Step 10 — How to run the full stack

From now on, when you want to run the full stack, you'll need two PowerShell windows:

**Window 1 — Frontend:**
```powershell
cd C:\Users\james\PycharmProjects\depo_pro_bolt
npm run dev
```

**Window 2 — Backend:**
```powershell
cd C:\Users\james\PycharmProjects\depo_pro_backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload
```

The frontend at `localhost:5173` will call the backend at `localhost:8000` for DOCX operations.

---

## Success criterion

All of these are true:

1. `python --version` shows 3.11+
2. The `depo_pro_backend` folder exists with a `.venv/` and `main.py`
3. `uvicorn main:app --reload` starts cleanly
4. `http://localhost:8000/` returns JSON with both `anthropic_key_configured: true` and `depo_transcribe_path_ok: true`
5. `http://localhost:8000/docs` shows the FastAPI interactive docs with three endpoints listed
6. You can run frontend and backend at the same time in two PowerShell windows

---

## What's not done yet

This phase set up the **scaffolding**. The endpoint logic is partially stubbed:

- `/cleanup` works fully (it calls Anthropic with the imported prompt)
- `/populate-templates` works for templates that exist (uses the existing `ufm_engine.populator`)
- `/export-docx` produces a basic .docx but doesn't yet integrate the UFM insertion pages — that gets enhanced in Phase 10

The frontend will call these endpoints from Phase 10 onward. For now, they exist and respond, which is enough.

---

## Next

Read `20_PHASE_2_VISUAL_CHROME.md`. That phase changes the React app's main shell to match the prototype design — five stages, layer badges, mode tabs.
