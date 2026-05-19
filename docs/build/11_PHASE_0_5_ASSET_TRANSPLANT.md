# 11 — Phase 0.5: Asset Transplant

**Purpose.** Copy the reusable, language-agnostic assets from the Python `depo_transcribe` project into the Bolt repo. These assets — the style guide, legal dictionary, UFM templates, manifest, and prompts — are months of refined work that should not be recreated.

**Time estimate.** 30 minutes.

**Prerequisites.** Phase 0 complete. You have both `depo_transcribe` and `depo_pro_bolt` cloned locally.

---

## What we're copying

| From `depo_transcribe` | To `depo_pro_bolt` | Why |
|------------------------|---------------------|-----|
| `docs/transcription_standards/depo_pro_style.md` | `docs/transcription_standards/depo_pro_style.md` | The 1,030-line house style guide |
| `docs/MORSON_RULE_IMPLEMENTATION.md` | `docs/MORSON_RULE_IMPLEMENTATION.md` | Morson rule reference |
| `docs/UFM_RULE_IMPLEMENTATION.md` | `docs/UFM_RULE_IMPLEMENTATION.md` | UFM rule reference |
| `docs/REGEX_RULE_ENGINE.md` | `docs/REGEX_RULE_ENGINE.md` | Engine design notes |
| `core/legal_dictionary.json` | `src/lib/data/legal_dictionary.json` | Common ASR mishearings |
| `ufm_engine/templates/figures/*.docx` | `assets/ufm_templates/figures/*.docx` | 13 UFM templates |
| `ufm_engine/templates/manifest.json` | `assets/ufm_templates/manifest.json` | Template manifest |
| `ufm_engine/templates/reporter_profile.schema.json` | `assets/ufm_templates/reporter_profile.schema.json` | Reporter profile schema |
| `ufm_engine/templates/template_selections.schema.json` | `assets/ufm_templates/template_selections.schema.json` | Selection schema |
| `clean_format/prompt.py` (CLEAN_FORMAT_SYSTEM_PROMPT string) | `src/prompts/cleanup_prompt.ts` | The 683-line Anthropic cleanup prompt |

---

## Step 1 — Open both projects in File Explorer

Open two File Explorer windows:

1. `C:\Users\james\PycharmProjects\depo_transcribe` (your existing Python project)
2. `C:\Users\james\PycharmProjects\depo_pro_bolt` (the Bolt React project from Phase 0)

Keep them side by side. We'll be dragging files between them.

---

## Step 2 — Create the destination folders

In `depo_pro_bolt`, create these new folders:

```powershell
cd C:\Users\james\PycharmProjects\depo_pro_bolt
mkdir docs\transcription_standards
mkdir src\lib\data
mkdir src\prompts
mkdir assets
mkdir assets\ufm_templates
mkdir assets\ufm_templates\figures
```

You can also do this in File Explorer. Whichever feels easier.

If `docs/` already exists, `mkdir docs` will error — that's fine, just skip that line.

---

## Step 3 — Copy the documentation files

Copy these four files from `depo_transcribe` to `depo_pro_bolt`:

| Source | Destination |
|--------|-------------|
| `depo_transcribe\docs\transcription_standards\depo_pro_style.md` | `depo_pro_bolt\docs\transcription_standards\depo_pro_style.md` |
| `depo_transcribe\docs\MORSON_RULE_IMPLEMENTATION.md` | `depo_pro_bolt\docs\MORSON_RULE_IMPLEMENTATION.md` |
| `depo_transcribe\docs\UFM_RULE_IMPLEMENTATION.md` | `depo_pro_bolt\docs\UFM_RULE_IMPLEMENTATION.md` |
| `depo_transcribe\docs\REGEX_RULE_ENGINE.md` | `depo_pro_bolt\docs\REGEX_RULE_ENGINE.md` |

In File Explorer: select all four files, Ctrl+C to copy, navigate to the destination, Ctrl+V to paste.

Or in PowerShell:

```powershell
cd C:\Users\james\PycharmProjects\depo_pro_bolt

copy ..\depo_transcribe\docs\transcription_standards\depo_pro_style.md docs\transcription_standards\
copy ..\depo_transcribe\docs\MORSON_RULE_IMPLEMENTATION.md docs\
copy ..\depo_transcribe\docs\UFM_RULE_IMPLEMENTATION.md docs\
copy ..\depo_transcribe\docs\REGEX_RULE_ENGINE.md docs\
```

---

## Step 4 — Copy the legal dictionary

```powershell
copy ..\depo_transcribe\core\legal_dictionary.json src\lib\data\legal_dictionary.json
```

---

## Step 5 — Copy the UFM templates

```powershell
copy ..\depo_transcribe\ufm_engine\templates\manifest.json assets\ufm_templates\manifest.json
copy ..\depo_transcribe\ufm_engine\templates\reporter_profile.schema.json assets\ufm_templates\reporter_profile.schema.json
copy ..\depo_transcribe\ufm_engine\templates\template_selections.schema.json assets\ufm_templates\template_selections.schema.json
copy ..\depo_transcribe\ufm_engine\templates\figures\*.docx assets\ufm_templates\figures\
```

After this you should have 13 `.docx` files in `assets\ufm_templates\figures\`. Verify with:

```powershell
dir assets\ufm_templates\figures\
```

You should see exactly 13 `.docx` files: appearances.docx, cert_federal_frcp.docx, cert_nonappearance.docx, cert_tx_sig_required.docx, cert_tx_sig_waived.docx, changes_signature_grid.docx, further_cert_trcp_203.docx, index_chronological.docx, title_page_federal.docx, title_page_tx_state.docx, witness_acknowledgment_notary.docx, witness_setup_interpreter.docx, witness_setup_standard.docx.

If you have fewer than 13, check the Python project to confirm those files exist there.

---

## Step 6 — Convert the Anthropic prompt to a TypeScript constant

This is the most valuable transplant. The 683-line cleanup prompt in `clean_format/prompt.py` needs to be exported as a TypeScript string.

### Step 6a — Create the TypeScript file

```powershell
notepad src\prompts\cleanup_prompt.ts
```

Notepad will offer to create the file. Click Yes.

### Step 6b — Open the Python source

In a separate window, open `C:\Users\james\PycharmProjects\depo_transcribe\clean_format\prompt.py` in any text editor (Notepad, VS Code, PyCharm, whatever).

### Step 6c — Copy the prompt content

The Python file looks like:

```python
"""docstring..."""

CLEAN_FORMAT_SYSTEM_PROMPT = r"""ROLE

You are a forensic deposition scopist...
...
"""
```

You want to copy the **entire content between the `r"""` markers** — everything from `ROLE` to the closing `"""`. That's the actual prompt text. Don't include the variable name or the triple-quote markers themselves.

### Step 6d — Paste into the TypeScript file

In Notepad with `cleanup_prompt.ts` open, paste this header:

```typescript
/**
 * Anthropic cleanup pass prompt for Depo-Pro export.
 *
 * Source of truth: ported from depo_transcribe/clean_format/prompt.py
 * If you need to update this prompt, update both files and document why.
 *
 * Used by: src/lib/pythonBackend.ts (sent to backend /cleanup endpoint)
 *          which forwards to Anthropic with this as the system message.
 */

export const CLEANUP_PROMPT = `ROLE

You are a forensic deposition scopist preparing a legally defensible verbatim
Texas deposition transcript from raw Deepgram speech-to-text output. Your work
product is evidence in a legal proceeding...
`;
```

Replace the truncated prompt body with the **full content** copied from the Python file. Important conversion rules:

1. Wrap the entire prompt in a TypeScript **backtick template literal**: `` `...` ``
2. **Escape any backtick characters in the original prompt** by replacing `` ` `` with `` \` ``. The prompt likely doesn't have any but check.
3. **Escape any `${` sequences** by replacing them with `\${`. Again, unlikely but check.
4. **Preserve all Unicode characters** (the `‹` and `›` characters for LC markers are critical — those are U+2039 and U+203A).
5. **Preserve all formatting** — line breaks, indentation, ASCII art separators.

Save the file.

### Step 6e — Verify

```powershell
type src\prompts\cleanup_prompt.ts
```

You should see a TypeScript file starting with the doc comment and `export const CLEANUP_PROMPT`. The body should look like the original Python prompt content.

### Step 6f — Alternative: ask Claude to convert it for you

If the manual conversion feels error-prone, do this instead:

1. In a Claude conversation, paste the full content of `clean_format/prompt.py`
2. Ask: "Convert this Python prompt file to a TypeScript module that exports a single CLEANUP_PROMPT constant. Wrap in backticks, escape any backticks or ${} sequences in the source, preserve all Unicode."
3. Claude will produce the converted file. Paste that into `src/prompts/cleanup_prompt.ts`.

---

## Step 7 — Add a TypeScript helper to load the legal dictionary

Create `src/lib/legalDictionary.ts`:

```powershell
notepad src\lib\legalDictionary.ts
```

Content:

```typescript
/**
 * Legal dictionary — common ASR mishearings for deposition transcripts.
 *
 * Source: src/lib/data/legal_dictionary.json (ported from depo_transcribe)
 * Used as a baseline correction layer; per-case keyterms take priority.
 */

import legalDict from './data/legal_dictionary.json';

interface LegalDictionary {
  _comment: string;
  spellings: Record<string, string>;
}

const dict = legalDict as LegalDictionary;

/**
 * Returns the canonical spelling for a token, or undefined if no mapping.
 * Case-insensitive lookup.
 */
export function lookupLegalDictionary(token: string): string | undefined {
  const normalized = token.toLowerCase().trim();
  for (const [misheard, correct] of Object.entries(dict.spellings)) {
    if (misheard.toLowerCase() === normalized) {
      return correct;
    }
  }
  return undefined;
}

/**
 * Returns all entries as a flat array, useful for batch processing.
 */
export function getAllLegalDictionaryEntries(): Array<{
  misheard: string;
  correct: string;
}> {
  return Object.entries(dict.spellings).map(([misheard, correct]) => ({
    misheard,
    correct,
  }));
}
```

Save and close.

---

## Step 8 — Add the project's CLAUDE.md

Create `CLAUDE.md` in the **root** of `depo_pro_bolt` (not in `docs/`):

```powershell
notepad CLAUDE.md
```

Paste the content from `06_GOVERNANCE_CLAUDE.md` — specifically the fenced markdown block (the part between the triple backticks). Save and close.

---

## Step 9 — Add this documentation package

If you haven't already, create `depo_pro_bolt/docs/build/` and copy all the files from this documentation package into it. The phase docs (00 through 99) live there for reference.

---

## Step 10 — Verify everything

Your `depo_pro_bolt` folder should now have:

```
depo_pro_bolt/
├── CLAUDE.md                        ← NEW (Step 8)
├── package.json
├── .env                             (from Phase 0)
├── .env.example                     (from Phase 0)
├── README.md
├── docs/                            ← EXPANDED
│   ├── MORSON_RULE_IMPLEMENTATION.md
│   ├── UFM_RULE_IMPLEMENTATION.md
│   ├── REGEX_RULE_ENGINE.md
│   ├── transcription_standards/
│   │   └── depo_pro_style.md
│   ├── build/                       ← NEW (Step 9 — this doc package)
│   │   ├── 00_START_HERE.md
│   │   ├── 01_MVP_SCOPE.md
│   │   └── ... (the other docs)
│   └── (existing docs from Bolt project)
├── assets/                          ← NEW
│   └── ufm_templates/
│       ├── manifest.json
│       ├── reporter_profile.schema.json
│       ├── template_selections.schema.json
│       └── figures/
│           ├── appearances.docx
│           ├── cert_federal_frcp.docx
│           └── (11 more .docx files)
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── lib/
│   │   ├── deepgramClient.ts
│   │   ├── localStore.ts
│   │   ├── legalDictionary.ts       ← NEW (Step 7)
│   │   ├── data/                    ← NEW
│   │   │   └── legal_dictionary.json
│   │   └── (existing lib files)
│   ├── prompts/                     ← NEW
│   │   └── cleanup_prompt.ts        ← NEW (Step 6)
│   ├── components/
│   ├── types/
│   └── ...
```

Verify with:

```powershell
dir CLAUDE.md
dir assets\ufm_templates\figures\*.docx | measure-object | select Count
dir docs\transcription_standards\depo_pro_style.md
dir src\lib\data\legal_dictionary.json
dir src\prompts\cleanup_prompt.ts
```

The `.docx` count should be 13.

---

## Step 11 — Commit the transplant

```powershell
git add CLAUDE.md docs/ assets/ src/lib/data/ src/lib/legalDictionary.ts src/prompts/
git status
```

`git status` will show you everything that's about to be committed. Review it. You should see:

- New file: `CLAUDE.md`
- New file: many things in `docs/`
- New file: many things in `assets/`
- New file: `src/lib/data/legal_dictionary.json`
- New file: `src/lib/legalDictionary.ts`
- New file: `src/prompts/cleanup_prompt.ts`

If anything unexpected is in the list (like `.env` or `node_modules/`), stop and check your `.gitignore`. Those should never be committed.

When the list looks right:

```powershell
git commit -m "Phase 0.5: transplant Python project assets

- UFM templates and manifest
- House style guide
- Legal dictionary
- Anthropic cleanup prompt as TS constant
- CLAUDE.md governance"

git push
```

Bolt's GitHub sync will pick this up automatically.

---

## Step 12 — Verify the dev server still works

This step is critical. Sometimes adding files breaks things.

```powershell
npm run dev
```

The app should start as before. Open `http://localhost:5173` and confirm the two tabs still load. If something breaks, the most likely culprit is a syntax error in `cleanup_prompt.ts` (unescaped backticks or `${}`). Open the browser console (F12) and look for the error.

---

## Success criterion

All of these are true:

1. `CLAUDE.md` exists at the root of `depo_pro_bolt`
2. `assets/ufm_templates/figures/` contains exactly 13 `.docx` files
3. `docs/transcription_standards/depo_pro_style.md` exists and is the 1,030-line style guide
4. `src/lib/data/legal_dictionary.json` exists
5. `src/prompts/cleanup_prompt.ts` exists and contains the 683-line prompt as a TypeScript export
6. `npm run dev` still starts cleanly
7. The Bolt app still loads at `localhost:5173`
8. Your last commit on GitHub shows all the new files

---

## Next

Read `12_PHASE_1_PYTHON_BACKEND.md`. That phase creates the FastAPI service that will eventually do the DOCX export.

If you want to defer the backend until you actually need it (which is fine — the frontend can be built without it), skip ahead to `20_PHASE_2_VISUAL_CHROME.md`. You'll need the backend before Stage 5 (Export) works, but Stages 1-4 don't require it.
