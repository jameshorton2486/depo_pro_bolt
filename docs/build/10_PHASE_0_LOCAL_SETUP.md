# 10 — Phase 0: Local Setup

**Purpose.** Get the existing Bolt app running on your Windows 11 machine. **Do not skip this phase.** Every subsequent phase assumes the app already runs locally.

**Time estimate.** 30 minutes if Node.js is already installed. 60 minutes if not.

**Prerequisites.** PowerShell, internet connection, Deepgram API key.

---

## Step 1 — Install Node.js (if you don't have it)

Open PowerShell and run:

```powershell
node --version
```

If you see `v18.x.x` or higher (e.g., `v20.11.1`), skip to Step 2.

If you get an error or the version is below 18:

1. Open your browser to https://nodejs.org/
2. Click the green "LTS" button (currently Node 20)
3. Run the installer. Accept all defaults. **Check the box that says "Automatically install the necessary tools"** when it appears.
4. After installation completes, **close all PowerShell windows** and open a fresh one.
5. Run `node --version` again. It should now show v20.x.x.

---

## Step 2 — Install Git (if you don't have it)

```powershell
git --version
```

If you see a version, skip to Step 3.

If not:

1. Browser to https://git-scm.com/download/win
2. Run the installer. Accept all defaults.
3. Close and reopen PowerShell. Run `git --version` again.

---

## Step 3 — Clone the repo

Decide where you want the project. You said you use `C:\Users\james\PycharmProjects` for code. We'll put it there.

```powershell
cd C:\Users\james\PycharmProjects
git clone https://github.com/jameshorton2486/depo_pro_bolt.git
cd depo_pro_bolt
```

You should now be in `C:\Users\james\PycharmProjects\depo_pro_bolt`. Run `dir` (or `ls`) and confirm you see files like `package.json`, `src/`, `docs/`, `README.md`.

---

## Step 4 — Install npm dependencies

```powershell
npm install
```

This downloads about 200 packages into a `node_modules/` folder. Takes 1-3 minutes depending on your internet speed.

If you see warnings about deprecated packages, ignore them. If you see actual errors (red text saying "ERR!"), copy the error and bring it to Claude. Common errors:

- **"unable to resolve dependency tree"** — try `npm install --legacy-peer-deps` instead
- **"ENOENT: no such file or directory"** — make sure you're in the right folder; run `pwd` and verify
- **"permission denied"** — close PowerShell and reopen as Administrator (right-click PowerShell icon → "Run as administrator"), then retry

When `npm install` finishes cleanly, you'll see a summary line like `added 245 packages in 47s`. Move to Step 5.

---

## Step 5 — Create your `.env` file

The app needs your Deepgram API key. The repo does not ship with one (that's correct — never check API keys into git).

In PowerShell, in the `depo_pro_bolt` folder:

```powershell
notepad .env
```

Notepad will ask if you want to create the file since it doesn't exist. Click Yes.

Paste this exact content into the file:

```
VITE_DEEPGRAM_API_KEY=PASTE_YOUR_DEEPGRAM_KEY_HERE
VITE_BACKEND_URL=http://localhost:8000
```

Now go to https://console.deepgram.com/ in your browser, sign in, find your API key (or create a new one), and copy it. Paste it into the `.env` file in place of `PASTE_YOUR_DEEPGRAM_KEY_HERE`. The line should look like:

```
VITE_DEEPGRAM_API_KEY=a1b2c3d4e5f6...
```

Save the file (Ctrl+S) and close Notepad.

**Verify** the `.env` file was created correctly:

```powershell
type .env
```

You should see your key. If you see literally `PASTE_YOUR_DEEPGRAM_KEY_HERE`, you didn't paste your real key — go back and fix it.

---

## Step 6 — Start the dev server

```powershell
npm run dev
```

You should see output like this:

```
  VITE v5.x.x  ready in 423 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

If you see this, the dev server is running. **Leave this PowerShell window open** — closing it stops the server.

If you see errors instead:

- **"Port 5173 already in use"** — another process is using the port. Either close the other process, or edit `vite.config.ts` to use a different port. Easiest fix: close any other Vite/Bolt dev servers you have running.
- **"Cannot find module..."** — `npm install` didn't complete. Stop the server (Ctrl+C), run `npm install` again, then `npm run dev`.

---

## Step 7 — Open the app in your browser

Open Chrome or Edge and navigate to:

```
http://localhost:5173
```

You should see the Depo-Pro app. It currently has two tabs at the top: **Case Intake** and **Transcribe**.

If you see a blank white page, open the browser's DevTools (F12), click the Console tab, and look for red error messages. The most common issue is a missing Deepgram key — the app will load but transcription won't work. That's fine for this phase. We just need the app to load.

---

## Step 8 — Test Case Intake

Click the **Case Intake** tab.

You should see a form with sections for case information, deposition details, attorneys, reporter, billing. There's an "Upload NOD" button.

If you have a real Notice of Deposition PDF, drop it on the upload area. The app should:

1. Show "Parsing..."
2. After a few seconds, fill in the case fields from the document
3. Display extracted keyterms below

If you don't have a real NOD, you can skip this — you just need to confirm the form loads without errors.

---

## Step 9 — Test Transcribe

Click the **Transcribe** tab.

You should see a drop zone for audio files.

If you have a short audio file (under 5 minutes recommended for testing):

1. Drop it on the upload area
2. The app should show "Processing..." then "Uploading..." then "Transcribing..."
3. After completion, you'll see utterances with speaker labels

If transcription fails:

- Check the Console (F12 → Console) for error messages
- Confirm your Deepgram key is correct (`type .env` in PowerShell)
- Confirm you have Deepgram credits (check your Deepgram dashboard)

If you don't have an audio file handy, you can record 30 seconds of yourself on your phone, send it to yourself via email or AirDrop, and use that.

---

## Step 10 — Stop and restart the server

Just to make sure you know how:

1. Click on the PowerShell window where `npm run dev` is running
2. Press `Ctrl+C`
3. Confirm the server stops
4. Run `npm run dev` again
5. The browser will auto-reload when you visit `localhost:5173`

You will be doing this many times during the build. It's normal.

---

## Step 11 — Commit your `.env` reminder

Your `.env` file is in `.gitignore` so it won't be committed (good — your API key shouldn't be in git). But you should add a reminder file so anyone (including future you) knows what's needed.

```powershell
notepad .env.example
```

Create the file with this content:

```
# Copy this file to .env and fill in real values
VITE_DEEPGRAM_API_KEY=
VITE_BACKEND_URL=http://localhost:8000
```

Save and close.

Now commit:

```powershell
git add .env.example
git commit -m "Add .env.example template"
git push
```

If Bolt's GitHub sync is on, you'll see this commit appear in the repo within seconds.

---

## Success criterion

All of these are true:

1. `npm run dev` starts cleanly and you can visit `http://localhost:5173`
2. The Case Intake tab loads without errors
3. The Transcribe tab loads without errors
4. You can stop the server with Ctrl+C and restart it
5. You can find your way around in PowerShell (`cd`, `dir`, `type`, `git status`)

If all five are true, you're done with Phase 0. Take a short break.

---

## What if something doesn't work

Don't proceed to Phase 0.5 until Phase 0 is solid. The next phase assumes the dev server runs.

Open `91_TROUBLESHOOTING.md` and look for your symptom. If it's not listed there, bring the exact error message to Claude in chat. Don't paraphrase — copy the error literally.

---

## Next

Read `11_PHASE_0_5_ASSET_TRANSPLANT.md`. That phase copies reusable assets from your existing Python project into the Bolt repo.
