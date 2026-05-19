# 05 — Export Rules

**Purpose.** Define what the Export stage produces, where pagination happens, and how the Python backend is used.

---

## The export deliverable

When the user clicks Export in Stage 5, they get a downloaded package containing:

- The full transcript as a UFM-compliant `.docx` (the primary deliverable)
- Optionally: the same transcript as Markdown and HTML (lightweight previews)
- Optionally: any insertion pages they selected (title page, appearances, index, certification, signature grid) as separate `.docx` files OR merged into the main document
- A small `manifest.json` listing what's in the package

The user chooses whether to download these as individual files or as a single ZIP.

---

## Where pagination happens

**Pagination happens at export time, not in the editor.**

The workspace editor shows utterances flowing naturally. There are no page breaks, no 25-lines-per-page enforcement, no rolling line numbers visible during editing. The reporter sees a clean continuous transcript.

When the user clicks Export, the Python backend (or the frontend's HTML/Markdown generator) computes pagination as part of building the output. This means:

- Page breaks are computed once, at export
- Line numbers are computed once, at export
- Exhibit references that point to "page 14, line 9" are resolved using export-time pagination
- The user never sees pagination drift while editing

If the user re-exports after more edits, pagination is recomputed. This is fine — the export is the final artifact, and pagination is a property of the export, not the live document.

---

## Three export targets

### 1. Markdown

Simple plain text. One utterance per paragraph. Speaker labels in bold. Q. / A. on their own paragraphs. Used for quick review or copy/paste.

```markdown
**MR. DAVIS:** Good afternoon, Doctor Leifer. Would you please introduce yourself to the members of the jury?

**Q.** And how are you currently employed?

**A.** Well, I do two things. I am on the faculty of Trinity University here in San Antonio, Texas.
```

Built in TypeScript. No backend call needed. Fast.

### 2. HTML

Same as Markdown but with proper headers, simple inline CSS for monospace, optional line numbering. Used for printable previews and email-friendly versions.

Built in TypeScript. No backend call needed.

### 3. DOCX (the real deliverable)

UFM-compliant Word document with:

- Texas UFM page layout (margins, 25 lines per page, page numbering)
- Proper speaker labels and Q./A. formatting
- Low-confidence tokens highlighted in yellow (the `‹LC:word›` marker system from the Python project)
- Caption / title page (from selected insertion templates)
- Appearances page
- Index (chronological)
- Witness setup page
- Body of the transcript
- Reporter's certification
- Optional signature page

Built in the Python backend by calling the existing `clean_format.docx_writer` and `ufm_engine.populator.populate` modules.

---

## The export request flow

```
User clicks Export in Stage 5
        │
        ▼
Frontend gathers:
  - All utterances for the job (working layer)
  - Speaker mapping
  - Case meta
  - Selected insertion pages
  - Reporter signature
        │
        ▼
Frontend POSTs to Python backend:
  POST http://localhost:8000/export-docx
  Body: { utterances, speakerNames, caseMeta, insertionPages, signature }
        │
        ▼
Python backend:
  1. Optionally runs Anthropic cleanup pass over the transcript
     (only if user toggled "AI cleanup" — off by default in v1)
  2. Loads the selected UFM templates from /assets/ufm_templates/
  3. Populates the templates with case meta + signature
  4. Renders the transcript body with low-confidence highlighting
  5. Concatenates: title page → appearances → index → body → certification
  6. Returns the .docx as a binary response
        │
        ▼
Frontend receives the binary, creates a Blob URL,
triggers download with the case name as filename
```

---

## What "AI cleanup" means at export

In v1, the AI cleanup pass is **off by default**. The reporter has already reviewed deterministic suggestions in the workspace, accepted what they wanted, rejected the rest. The export should produce what the reporter signed off on.

If the reporter toggles "Run AI cleanup pass before DOCX export" in the Export screen, the Python backend:

1. Takes the working transcript with low-confidence markers wrapped (`‹LC:word›`)
2. Sends it to Anthropic with the 683-line cleanup prompt
3. Receives the cleaned text back
4. Preserves the `‹LC:word›` markers verbatim per prompt instructions
5. Writes the DOCX with those markers rendered as yellow-highlighted runs

This is the *optional* second AI pass. It is more aggressive than the deterministic suggestions in the workspace but still strictly verbatim (no paraphrasing, no filler removal).

For v1, recommend the reporter **leave this off**. The deterministic suggestions in the workspace are enough. AI cleanup at export is a v1.5 feature.

---

## What gets sent to the Python backend on export

```typescript
interface ExportDocxRequest {
  job_id: string;
  case_meta: IntakeRecord;
  speaker_names: Record<number, string>;
  speaker_roles: Record<string, string>;
  utterances: Array<{
    sequence_index: number;
    transcript: string;              // working_transcript with LC markers
    speaker_name: string;
    qa_role: 'Q' | 'A' | null;
    start_time: number;
  }>;
  insertion_pages: {
    title_page: 'tx_state' | 'federal' | null;
    appearances: boolean;
    index_chronological: boolean;
    witness_setup: 'standard' | 'interpreter' | null;
    signature_grid: boolean;
    certification: 'tx_sig_required' | 'tx_sig_waived' | 'federal_frcp' | null;
  };
  signature: {
    reporter_name: string;
    csr_number: string;
    csr_expiration: string;
    certification_date: string;
  };
  run_ai_cleanup: boolean;           // Default false in v1
}
```

The Python endpoint returns a DOCX binary stream with `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

---

## What gets sent for the simpler exports

The Markdown and HTML exports are built entirely in the browser. No backend call. They use only the data already in IndexedDB.

This means even if the Python backend is down or not running, the user can still get a Markdown or HTML export of their work. Only the DOCX export requires the backend.

---

## Failure modes

What if the Python backend is unreachable?

- The Export screen shows a warning: "DOCX export unavailable — Python backend not responding. Markdown and HTML exports still work."
- The user can still proceed with the lightweight exports
- The user is told to check that the backend is running (e.g., "Run `python -m uvicorn main:app --reload` in the `depo_pro_backend` folder")

What if the Anthropic API call fails during AI cleanup?

- The backend falls back to exporting without cleanup
- The response includes a header `X-AI-Cleanup-Status: failed` and a JSON sidecar with the error
- The user sees a warning but gets a usable DOCX

---

## Filenames

Generated DOCX filenames follow this pattern:

```
{Witness_Last_First}_Deposition_{YYYY-MM-DD}.docx
```

For example: `Leifer_Jack_Deposition_2026-05-18.docx`

This matches the existing Python project's `clean_format/docx_writer.py` naming convention.

---

## Insertion pages mapping

The user selects insertion pages in Stage 5. Each selection maps to a Python template:

| User selection | Template file | Source |
|---------------|---------------|--------|
| Title page (Texas) | `title_page_tx_state.docx` | UFM Figure 17 |
| Title page (Federal) | `title_page_federal.docx` | — |
| Appearances | `appearances.docx` | UFM Figure 18 |
| Index (chronological) | `index_chronological.docx` | UFM Figure 22 |
| Witness setup (standard) | `witness_setup_standard.docx` | UFM Figure 23 |
| Witness setup (interpreter) | `witness_setup_interpreter.docx` | UFM Figure 27 |
| Signature grid | `changes_signature_grid.docx` | UFM Figure 19 |
| Witness acknowledgment | `witness_acknowledgment_notary.docx` | UFM Figure 19A |
| Certification (TX, sig required) | `cert_tx_sig_required.docx` | UFM Figure 20 |
| Certification (TX, sig waived) | `cert_tx_sig_waived.docx` | UFM Figure 21 |
| Certification (Federal) | `cert_federal_frcp.docx` | — |
| Certification (nonappearance) | `cert_nonappearance.docx` | UFM Figure 24 |
| Further certification TRCP 203 | `further_cert_trcp_203.docx` | UFM Figure 20B |

The templates and manifest live at `depo_pro_bolt/assets/ufm_templates/` after the asset transplant (Phase 0.5).

---

## Success criterion for this document

You can answer:
1. Where does pagination happen?
2. What does the user get when DOCX export is unavailable?
3. Why is "AI cleanup at export" off by default in v1?

---

## Next

Read `06_GOVERNANCE_CLAUDE.md`. This is the document that every AI tool working on the project must read.
