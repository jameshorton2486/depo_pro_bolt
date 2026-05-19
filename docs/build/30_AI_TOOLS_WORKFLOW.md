# 30 — AI Tools Workflow

**Purpose.** Show you how to use Bolt, Claude (in chat), Claude Code, ChatGPT, and Codex together efficiently so you don't burn tokens unnecessarily. Read this before starting heavy development work.

---

## The four AI tools you have and what each is best at

### Bolt

**Best for:** Visual UI work. Adding components, changing styles, tweaking layouts. Bolt has the React + Tailwind context loaded, and its preview shows your changes immediately.

**Bad for:** Complex multi-file refactors, pure logic work, large file edits. Bolt regenerates files on every change, and a 1,000-line component eats tokens fast.

**Token economics:** Roughly the most expensive per change because Bolt edits whole files and re-renders previews. Use it sparingly.

### Claude (in chat at claude.ai)

**Best for:** Architecture decisions, code review, writing complex pure-logic modules, debugging, generating exact file contents you can paste. This is where you ask "design the suggestion cassette component" or "write a function that does X."

**Bad for:** Live editing your codebase (Claude doesn't have access to your files unless you paste them in).

**Token economics:** Free up to your daily limit on free tier; Pro plan covers serious work. Way cheaper per change than Bolt.

### Claude Code (terminal-based, runs locally on your Windows machine)

**Best for:** Live file editing on your local machine. Can read your entire codebase, run commands, edit multiple files in one task. The cheapest way to do real coding work once you're comfortable with PowerShell.

**Bad for:** Visual design iteration (no preview).

**How to get it:** https://docs.claude.com/en/docs/claude-code. Install via `npm install -g @anthropic-ai/claude-code` once Node is installed. Then run `claude` from inside your project folder.

**Token economics:** Pay per use through your Anthropic API key. Bulk work is cheaper than Bolt by a large margin because Claude Code only loads the files it actually needs.

### ChatGPT / Codex

**Best for:** Second opinions, quick syntax help, brainstorming when stuck. Codex can run code in a sandbox to verify it works.

**Bad for:** Anything requiring your codebase context.

**Token economics:** ChatGPT Plus monthly fee covers heavy use. Free tier works for occasional help.

---

## The right tool for each kind of task

| Task | Use |
|------|-----|
| "Make this button blue" | Bolt |
| "Add a stage progression bar to the header" | Bolt |
| "Tweak this Tailwind class until the spacing looks right" | Bolt |
| "Build the entire Suggestions mode component" | Claude (in chat), paste result locally |
| "Write the IndexedDB schema migration" | Claude (in chat) |
| "Port this Python regex to TypeScript" | Claude (in chat) |
| "Refactor my 992-line CaseIntakePanel into 6 smaller files" | Claude Code (local) |
| "Find every place I'm writing to raw_transcript and fix it" | Claude Code (local) |
| "Run the tests and fix the failures" | Claude Code (local) or Codex |
| "Is this approach right architecturally?" | Claude in chat, or ChatGPT for second opinion |
| "Why is this error happening?" | Claude in chat — paste the error |
| "Verify this code runs correctly" | Codex |

---

## A typical day's workflow

Pretend you're building Phase 5 (Suggestions mode). Here's how to budget tools:

**Step 1 (Claude in chat):** "Design the Suggestion mode component. Use the data shapes in `03_TRANSCRIPT_MODEL.md`. Give me the full TypeScript file."

Claude writes the file. You read it. If it's right, copy it. If something's off, iterate in chat.

**Step 2 (Local file work):** Paste Claude's code into the right file on your machine. Open it in VS Code, PyCharm, or any editor.

**Step 3 (PowerShell):** `npm run dev` and refresh the browser. See what it actually looks like.

**Step 4 (Bolt, optional):** If the styling is off and you want to iterate visually, open Bolt and ask "tweak the cassette card to use amber instead of sky-blue accents and add more spacing between the buttons." Bolt edits the file. Bolt's GitHub sync pushes the change. You pull it locally (`git pull`) and continue.

**Step 5 (Claude in chat or Codex):** If you hit a bug, paste the error to Claude. If Claude suggests a fix you want to verify works, hand it to Codex to run.

**Step 6 (Local):** Commit and push with git from PowerShell.

This pattern minimizes Bolt usage — you use it only for visual iteration after the logic is correct.

---

## When to use Claude vs ChatGPT for the same question

Both are good. Some heuristics:

- **First take:** Whichever you have credits/quota for. Both will give you reasonable answers.
- **Long-context tasks** (paste a big file, ask for refactor): Claude. The context window is larger and it follows complex instructions more reliably.
- **Code verification** (does this run?): ChatGPT/Codex has built-in code execution. Claude is text-only.
- **Domain-specific reasoning** (UFM rules, deposition workflow): Both are fine. Claude's responses tend to be more thorough; ChatGPT's tend to be more direct.
- **Second opinion when stuck:** Use whichever you didn't ask first. Sometimes a fresh perspective unsticks you.

You should not treat them as competitors. Use them as a small team.

---

## Anti-patterns — things that waste tokens

**Don't do these things:**

1. **Don't paste your entire codebase into Bolt as context.** Bolt already has it. You're paying for re-tokenization.

2. **Don't ask Bolt to "review" your code.** Bolt is built for editing, not analysis. Take that to Claude.

3. **Don't ask Claude to "look at my repo." Claude doesn't have access.** Either paste the files, or use Claude Code locally where it has filesystem access.

4. **Don't make 20 small changes in Bolt when you could batch them into one.** Each Bolt change has fixed token overhead. "Change the button color, fix the spacing, update the icon, add a tooltip" is one prompt, not four.

5. **Don't ask the same AI the same question twice expecting different results.** If Claude said no, asking again won't change the answer. Ask a different AI, or rephrase the question with more context.

6. **Don't paste massive log files into prompts.** Most of the log is irrelevant. Extract the error and the surrounding 10 lines. That's enough.

7. **Don't ask AI to do tasks you can do faster yourself.** "Rename the file" — just do it. "Run npm install" — just run it. Save AI for the things only AI can do.

---

## The single most important habit

**Read the AI's output before pasting it into your project.**

AI tools are confident generators. They will sometimes write code that looks right but is subtly wrong — wrong import path, wrong function name, wrong type. If you paste blindly, you spend hours debugging code you didn't read.

When Claude gives you a file, do this:

1. Skim the imports — are they sensible?
2. Skim the exported function/component signatures — do they match what you asked for?
3. Glance at any tricky logic — does it look reasonable?
4. **Then** paste it.

This 30-second check saves enormous time.

---

## How to format prompts to AI

Bad prompt: "make my app better"

Better prompt: "In `src/stages/Workspace.tsx`, add a button next to the 'Continue to Certification' button labeled 'Run AI Suggestions.' When clicked, it should call `runDeterministicCorrections()` from `src/lib/corrections.ts` over all utterances in the active job and write any suggestions to IndexedDB. The button should be disabled while the call is running and show a spinner."

The good prompt has:

- A specific file path
- The exact behavior you want
- The function/module names involved
- The expected state (disabled, spinner)

The more specific you are, the less the AI guesses, and the less you have to iterate.

---

## When to switch tools mid-task

You're using Bolt. It's spent three rounds trying to get the same component right and is going in circles. **Switch to Claude in chat.** Paste the broken component, paste the error, ask for a fix. Then bring the fix back to Bolt or paste it locally.

You're using Claude in chat. The component is right but you don't know how to wire it into your existing code. **Switch to Claude Code locally.** It can see your full project.

You're using Claude Code. It's stuck on a strange Windows-specific path issue. **Switch to ChatGPT.** Sometimes a different model has seen the same problem.

The tools are interchangeable enough that you should switch freely. The cost is your attention, not money.

---

## How to handle running out of tokens

If you hit Bolt's free token limit:

- You can continue with Claude Code locally — it doesn't use Bolt's quota
- Your code is on GitHub (because of the Bolt-GitHub sync); pull it and work locally
- Resume Bolt usage next month, or upgrade if the project warrants it

If you hit Anthropic API limits (Claude Code):

- Switch to ChatGPT for that day
- Or continue manually — most coding work is doable without AI; AI just makes it faster

If you hit Claude.ai chat limits:

- Wait for the reset (usually 5 hours)
- Or switch to ChatGPT
- Or upgrade to Pro plan

You should never lose progress to running out of tokens, because **your code is on GitHub** at every step.

---

## Practical commit hygiene

Commit small. Commit often. Commit before every AI interaction that might break things.

```powershell
git status                       # see what's changed
git add .                        # stage all changes
git commit -m "Phase 5: WIP - adding suggestion cassette"
git push                         # back up to GitHub
```

If an AI session breaks things, `git checkout .` reverts to the last commit. If you committed two minutes ago, you lose two minutes of work. If you didn't commit for three hours, you lose three hours.

This is the discipline that makes AI-assisted development safe.

---

## When to ask Claude for the next batch of docs

The current documentation batch covers through Phase 2 (visual chrome). When you're done with Phase 2 and want to continue:

1. Confirm Phase 2 is committed and pushed
2. Open Claude (in chat) and say: "I completed Phase 2 of the Depo-Pro build. Here's the current state: [briefly describe what works]. Please send the next batch — Phase 3 through Phase 10."

Claude will produce another package of detailed documents. The pattern continues until v1 is done.

---

## Summary

The four tools have different strengths. Use the right one for each task. Read AI output before pasting it. Commit often. Don't burn Bolt tokens on tasks Bolt isn't good at. When in doubt, switch tools.

You can build this whole project with $20-50 in API costs if you use the tools intelligently. You can also blow through $500 in tokens if you don't. The difference is workflow discipline, not money.

---

## Next

If you haven't started Phase 0 yet, go to `10_PHASE_0_LOCAL_SETUP.md` and begin.

If you've completed Phase 2 and want the next batch of documents, ask Claude in chat.
