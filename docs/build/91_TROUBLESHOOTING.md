# 91 — Troubleshooting

**Purpose.** A catalog of the errors you're most likely to hit while following the Phase documents, with specific fixes. Search this file (Ctrl+F) for the error text you're seeing.

**If your error isn't here:** copy the exact error message and bring it to Claude in chat. Don't paraphrase — copy literally.

---

## Frontend — `npm` and Node.js issues

### `npm` is not recognized as an internal or external command

Node.js isn't installed or isn't on your PATH.

```powershell
node --version
```

If that also fails, install Node from https://nodejs.org/ (LTS version). Check the box "Add to PATH" during install. **Close all PowerShell windows and open a fresh one** — the PATH update doesn't apply to existing windows.

### `npm install` fails with `EACCES` or `permission denied`

Run PowerShell as Administrator:
1. Close all PowerShell windows
2. Right-click PowerShell in Start menu → "Run as administrator"
3. Navigate back to your project: `cd C:\Users\james\PycharmProjects\depo_pro_bolt`
4. Try again: `npm install`

### `npm install` fails with `unable to resolve dependency tree` or `ERESOLVE`

```powershell
npm install --legacy-peer-deps
```

This is common with React projects where one library requires React 18 and another requires React 17. The flag tells npm to use the older, looser resolution algorithm.

### `npm install` hangs forever

Cancel with Ctrl+C, then:

```powershell
npm cache clean --force
del package-lock.json
rmdir /s /q node_modules
npm install
```

If still hanging, you may be behind a corporate proxy. Check with your IT, or try a different network.

### Port 5173 is already in use

Another Vite dev server is running. Either:

**Option A** — Close the other server. Find the PowerShell window with the running dev server and Ctrl+C.

**Option B** — Use a different port. Edit `vite.config.ts`:

```typescript
export default defineConfig({
  // ...
  server: {
    port: 5174,  // changed from default 5173
  },
});
```

Save and restart `npm run dev`. The new URL will be `http://localhost:5174`.

### `npm run dev` says it's running but the browser shows "This site can't be reached"

The dev server may have started on a different port. Look at the actual output — it will say `Local: http://localhost:XXXX/`. Use that port, not 5173.

If the output says it's on 5173 but the browser still can't reach it, your firewall is blocking it. Allow Node.js through Windows Defender Firewall:
1. Windows Search → "Windows Defender Firewall"
2. "Allow an app or feature through Windows Defender Firewall"
3. Find Node.js, check both Private and Public, click OK

---

## Frontend — TypeScript and React errors

### `Module not found: Can't resolve 'lucide-react'`

```powershell
npm install lucide-react
```

### `Module not found: Can't resolve '@/components/...'` or path alias errors

Your `tsconfig.json` and `vite.config.ts` need to agree on path aliases. Easiest fix: use relative paths (`../components/...`) instead of `@/components/...`. If you want aliases, both files need matching configuration.

### `Property 'X' does not exist on type 'Y'`

Your types are out of sync with your code. Two options:

1. **Update the type:** Open `src/types/...` and add the missing property
2. **Cast the value:** `(value as any).X` — quick fix, not recommended long-term

This usually happens after copying TypeScript code from an AI without updating the type file.

### Blank white page when opening `http://localhost:5173`

Open DevTools (F12) → Console tab. The actual error will be there. The most common causes:

- **`Unexpected token` in `cleanup_prompt.ts`** — you didn't escape backticks or `${}` sequences when porting the Python prompt. Open the file in a real editor (VS Code) and look for unescaped sequences.
- **`Cannot read property of undefined`** — your code references a prop or state field that doesn't exist. Check the line number in the error.
- **`Failed to fetch` for Deepgram** — your `.env` is missing the Deepgram key. Run `type .env` to verify.

### `useEffect` warnings or infinite loops

You created an effect that updates state without a proper dependency array. Example of the bug:

```typescript
// BAD — runs forever
useEffect(() => {
  setX(someValue);
});

// GOOD — runs only when someValue changes
useEffect(() => {
  setX(someValue);
}, [someValue]);
```

---

## IndexedDB issues

### Data disappears between sessions

You're using Incognito/Private mode. IndexedDB is cleared when private windows close. Use a normal browser window for development.

### "QuotaExceededError" when storing audio

Browsers limit IndexedDB to roughly 50% of free disk space, but enforce a per-origin quota that can be smaller. To check usage:

In the browser console:
```javascript
navigator.storage.estimate().then(console.log)
```

If you're near the quota, delete old jobs. In v1, there's no UI for this yet — open DevTools → Application → IndexedDB → delete the `depopro_local` database to wipe everything.

### "VersionError" when opening the database

You bumped the IndexedDB version but the upgrade callback didn't handle the migration. Fix the upgrade function in `src/lib/localStore.ts` to create any missing object stores. Or, for development only: delete the database in DevTools → Application → IndexedDB and let it recreate.

---

## Deepgram errors

### `401 Unauthorized` from Deepgram

Your API key is wrong or expired. In PowerShell:

```powershell
type .env
```

Confirm `VITE_DEEPGRAM_API_KEY=` has your actual key. Then check the key works at https://console.deepgram.com/ — try the "Try the API" feature with your key.

If the key works on Deepgram's site but not in your app, you need to **restart the Vite dev server**. Vite reads `.env` only at startup. Ctrl+C the running server, then `npm run dev` again.

### `402 Payment Required` or `403 Forbidden`

Your Deepgram credits are exhausted. Top up at https://console.deepgram.com/.

### Transcription completes but only the first 30 seconds show up

You sent a long file synchronously when Deepgram returned a partial result. Long files should use Deepgram's async endpoint with polling. For v1, keep test files under 10 minutes; longer-file support is a Phase 7+ improvement.

### "CORS" error in console when calling Deepgram

The current Bolt setup calls Deepgram directly from the browser, which Deepgram allows (their API has permissive CORS). If you're getting a CORS error, you're probably using an old endpoint URL. Confirm `src/lib/deepgramClient.ts` uses `https://api.deepgram.com/v1/listen`.

---

## Python backend errors

### `'uvicorn' is not recognized`

You're not in the virtual environment. Look at your PowerShell prompt — it should start with `(.venv)`. If it doesn't:

```powershell
cd C:\Users\james\PycharmProjects\depo_pro_backend
.\.venv\Scripts\Activate.ps1
```

### `Set-ExecutionPolicy` error when activating venv

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Answer Y. Then retry `.\.venv\Scripts\Activate.ps1`.

### `ImportError: No module named 'fastapi'`

Inside the venv, install missing packages:

```powershell
pip install fastapi uvicorn[standard] python-multipart python-dotenv anthropic python-docx httpx
```

### `ImportError: No module named 'clean_format'` or `ufm_engine`

The `DEPO_TRANSCRIBE_PATH` in your backend's `.env` is wrong or the path doesn't exist. Verify:

```powershell
type .env
dir C:\Users\james\PycharmProjects\depo_transcribe
```

Both must work. The path in `.env` must match the actual folder.

### Backend starts but the React app can't reach it

In a new PowerShell window:

```powershell
curl http://localhost:8000/
```

If that works but the React app shows a network error, it's a CORS issue. Confirm `depo_pro_backend/.env` has:

```
DEPO_PRO_FRONTEND_ORIGIN=http://localhost:5173
```

And confirm `main.py` reads it and passes it to CORSMiddleware. Restart the backend after any `.env` change.

### `anthropic.APIError: 401`

Your `ANTHROPIC_API_KEY` is wrong. Check at https://console.anthropic.com/. After updating `.env`, restart the backend.

### `anthropic.RateLimitError`

You're sending too many requests too fast. Anthropic free tier has aggressive limits. Either:
- Wait a minute and retry
- Upgrade to a paid tier
- Add backoff/retry logic in the backend (not needed for v1; just wait)

---

## Git and GitHub issues

### `git push` rejected with `non-fast-forward`

Someone else (probably Bolt) pushed changes you don't have locally. Pull first:

```powershell
git pull --rebase
```

If that creates conflicts, resolve them (open the files with `<<<<<<<` markers, decide which version to keep, save, then `git add` and `git rebase --continue`).

### `Bolt and my local code are out of sync`

This happens when you edit in Bolt and locally without pulling. Easiest recovery:

1. Commit your local changes: `git add . ; git commit -m "WIP local changes"`
2. Pull Bolt's version: `git pull --rebase`
3. Resolve any conflicts
4. Push: `git push`

If you want to throw away local changes and take Bolt's version:

```powershell
git fetch origin
git reset --hard origin/main
```

**Warning:** that destroys uncommitted local work.

### `Permission denied (publickey)` when pushing

Your git is trying to push via SSH but your SSH keys aren't set up. Easiest fix: use HTTPS. In PowerShell:

```powershell
git remote set-url origin https://github.com/jameshorton2486/depo_pro_bolt.git
git push
```

You'll be prompted to authenticate. Use a personal access token from https://github.com/settings/tokens (not your password) when asked.

---

## Bolt-specific issues

### Bolt and GitHub are out of sync

Check the Bolt sync status indicator. If it's broken, disconnect and reconnect the integration in Bolt's project settings.

### Bolt regenerated a file I didn't want changed

Two options:

**Option A** — Undo in Bolt's history (top-left corner has undo).

**Option B** — Revert locally:
```powershell
git checkout HEAD -- src/path/to/file.tsx
git push
```

Bolt will pull this change and update its preview.

### Bolt is making the same mistake repeatedly

Switch tools. Open Claude in chat (or Claude Code locally), paste the file Bolt keeps breaking, and ask Claude to write the correct version. Then paste that into Bolt or commit it directly via git.

Don't argue with Bolt for more than three rounds. Each round costs tokens.

### Out of Bolt tokens

You're not stuck. Your code is on GitHub. Pull it locally and continue with Claude Code or any editor:

```powershell
cd C:\Users\james\PycharmProjects\depo_pro_bolt
git pull
# Now edit locally with VS Code, Cursor, etc.
```

You only need Bolt for visual preview during UI iteration. For logic work, you don't need Bolt at all.

---

## PowerShell issues

### `cd` command doesn't work the way you expect

PowerShell paths use backslashes (`C:\Users\james\...`). Forward slashes also work in most cases. Quotes around paths with spaces:

```powershell
cd "C:\Users\james\PycharmProjects\depo_pro_bolt"
```

### You closed PowerShell and lost your dev server

That's normal. Start a fresh PowerShell:

```powershell
cd C:\Users\james\PycharmProjects\depo_pro_bolt
npm run dev
```

There's nothing to "recover" — Vite's state lives in memory and rebuilds on demand.

### You ran a long command and want to cancel

Ctrl+C. If that doesn't work, close the PowerShell window and open a new one.

---

## "It worked yesterday and now it doesn't"

90% of the time, one of these is the cause:

1. **You restarted your machine and forgot to start the dev server.** Run `npm run dev`.
2. **A dependency updated.** Run `npm install` in the project folder.
3. **You changed `.env` and didn't restart the dev server.** Ctrl+C and `npm run dev` again.
4. **You pulled changes that broke something.** Run `git log -5` to see recent commits. If a recent commit looks suspect, run `git revert <commit-hash>` to undo it.
5. **Your browser cached old JavaScript.** Hard-reload with Ctrl+Shift+R.

---

## Audio playback issues

### Audio file uploads but doesn't play

The audio Blob might not be stored in IndexedDB yet. Open DevTools → Application → IndexedDB → `depopro_local` → `audio_blobs`. There should be one row per job.

If empty, the upload code didn't save the Blob. Check `src/lib/localStore.ts` for the `saveAudio` function.

### Audio plays but seeking doesn't work

The `<audio>` element needs `preload="metadata"` or `preload="auto"` to support seeking before fully buffered. Check your audio element JSX.

### Audio plays in Chrome but not Edge (or vice versa)

Codec issue. WAV and MP3 work in both. M4A works in Chrome but not always in Edge. For testing, prefer MP3.

---

## Performance issues

### Editing feels slow after 200+ utterances

The transcript view re-renders every utterance on every keystroke. This is the v1 trade-off — we deferred virtualization. Workarounds:

- Don't edit while the page has all 200+ rendered. Use the Find feature (Ctrl+F in browser) to jump to a section, edit there.
- For very large transcripts, accept that v1 will be slower than commercial CAT software.

Virtualization (rendering only visible utterances) is a v2 feature.

### Audio playback stutters

Either:
- Your audio file is very large and IndexedDB is paging it from disk
- Your browser is throttling background tabs (don't hide the Depo-Pro tab while audio plays)

---

## When all else fails

Three steps, in order:

1. **Read the error.** Most errors tell you exactly what's wrong. Read the whole message, not just the first line.

2. **Check if it's a known issue.** Search this file (Ctrl+F) for keywords from the error.

3. **Bring it to Claude.** Open a chat, paste:
   - The exact error message
   - What command you ran
   - What file you were editing
   - What you expected to happen

Don't paraphrase. Don't summarize. Don't say "it's broken." Copy the literal error text. Claude can almost always diagnose from there.

---

## How to capture an error properly

When something fails in PowerShell:

1. Click the PowerShell window
2. Right-click the title bar → Edit → Select All
3. Right-click again → Copy
4. Paste into Claude

When something fails in the browser:

1. F12 → Console tab
2. Find the red error message
3. Right-click → "Copy message" or "Copy stack trace"
4. Paste into Claude

When something fails visually but no error:

1. Take a screenshot (Windows: `Win+Shift+S`)
2. Describe what you expected vs what you see
3. Send both to Claude

---

## Next

When the immediate problem is fixed, go back to the Phase document you were working on.
