# Depo-Pro — Build Documentation Package

**Start here. Read this entire document before touching code.**

---

## What this package is

This is a complete, sequential set of instructions for building Depo-Pro. It assumes:

- You have the Bolt-built React app at `https://github.com/jameshorton2486/depo_pro_bolt`
- You have the Python `depo_transcribe` project locally (with mature prompts, UFM templates, style guide)
- You have a Deepgram API key
- You have an Anthropic API key
- You're on Windows 11 with PowerShell
- You have Node.js 18+ and Python 3.11+ available (or can install them)

If any of those are not true, fix that before starting Phase 0.

---

## How to use these documents

The documents are numbered. **Read and act on them in order.** Do not skip ahead.

1. Read the document fully before doing anything it tells you to do.
2. Each document ends with a **"Success criterion"** section. You are not done with that document until the success criterion is met.
3. If something breaks, go to `91_TROUBLESHOOTING.md`.
4. If you get stuck for more than 30 minutes, stop and come back to Claude in chat with the exact error message.

---

## The plan in one paragraph

We are building a **hybrid system**. A React + TypeScript web app (the Bolt project) handles the user interface — case intake, audio upload, transcript workspace, suggestions, audio review, certification. A small Python backend (built from the existing `depo_transcribe` codebase) handles the heavy work — the Anthropic cleanup pass, UFM template population, DOCX export. They communicate over HTTP on your local machine. When you're ready to deploy, the React app goes to Vercel and the Python backend goes to Railway or Render. The result is a working, locally-runnable product that you can later move to the web with minimal changes.

---

## The document set

### Foundation (read all of these first)

| # | Document | Purpose |
|---|----------|---------|
| 00 | `00_START_HERE.md` | This document |
| 01 | `01_MVP_SCOPE.md` | What is and isn't in version 1. Locked. |
| 02 | `02_ARCHITECTURE.md` | How the pieces fit together |
| 03 | `03_TRANSCRIPT_MODEL.md` | Data shapes — what an utterance, job, correction looks like |
| 04 | `04_WORKSPACE_RULES.md` | How the transcript workspace behaves |
| 05 | `05_EXPORT_RULES.md` | What export does, how pagination works |
| 06 | `06_GOVERNANCE_CLAUDE.md` | Rules any AI working on this project must follow |

### Setup phases (do these in order)

| # | Document | What you'll do |
|---|----------|----------------|
| 10 | `10_PHASE_0_LOCAL_SETUP.md` | Get the existing Bolt app running on your Windows machine |
| 11 | `11_PHASE_0_5_ASSET_TRANSPLANT.md` | Copy the Python project's reusable assets into the Bolt repo |
| 12 | `12_PHASE_1_PYTHON_BACKEND.md` | Set up the FastAPI service that exposes Python functionality |

### Build phases

| # | Document | What you'll build |
|---|----------|-------------------|
| 20 | `20_PHASE_2_VISUAL_CHROME.md` | New App.tsx with five-stage progression bar and layer badges |
| 90 | `90_NEXT_PHASES.md` | Outline of phases 3 through 10 (we'll detail these in follow-up batches) |

### Operations

| # | Document | When to read |
|---|----------|--------------|
| 30 | `30_AI_TOOLS_WORKFLOW.md` | When you're ready to use Bolt, Claude, ChatGPT, and Codex together efficiently |
| 91 | `91_TROUBLESHOOTING.md` | When something breaks |
| 99 | `99_DEPLOYMENT.md` | When the local app works end-to-end and you want it on the web |

---

## What I'm NOT giving you in this batch

To keep this manageable, this first batch gets you through Phase 2 (visual chrome). Once Phase 2 is complete and you confirm it works, ask Claude for the next batch: **Phase 3 (intake refactor) through Phase 10 (export)**. Those phases have their own detailed documents that will follow the same pattern as Phase 2.

---

## Today's first action

Open `01_MVP_SCOPE.md` and read it.

After that, read documents 02 through 06 in order. They are short — most are 2-4 pages. Don't skim. These are the contracts that prevent the project from drifting.

When all six foundation documents are read, open `10_PHASE_0_LOCAL_SETUP.md` and follow it step by step.

---

## A final note before you begin

You have invested significant work in this project across multiple iterations. The plan in these documents is intentionally **smaller** than what you may have imagined the final product to be. That is the point. We are building a working v1 that you can use and show to people. Features that don't make this list go on a `WISHLIST.md` for v2. **Do not negotiate the MVP scope with yourself while building.** If a feature isn't in `01_MVP_SCOPE.md`, it doesn't go in v1.

That single rule is what will get this project finished.

Begin.
