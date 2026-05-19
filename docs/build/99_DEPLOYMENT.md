# 99 — Web Deployment

**Purpose.** When the local app works end-to-end, move it onto the web. This is Phase 11 from the outline. Don't read this document until all phases through 10 are complete.

**Time estimate.** 2-4 hours.

**Prerequisites.** All ten build phases complete. App runs locally with both frontend (port 5173) and backend (port 8000). A working DOCX export.

---

## The deployment topology

```
                            ┌────────────────────────┐
                            │  User's browser        │
                            │                        │
                            │  https://yourapp       │
                            │    .vercel.app         │
                            └──────┬─────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐
   │ Vercel           │  │ Vercel function  │  │ Railway / Render│
   │ (static frontend)│  │ /api/deepgram    │  │ (Python backend)│
   │                  │  │ (proxy)          │  │                 │
   │ React app served │  │                  │  │ FastAPI service │
   │ from CDN         │  │ Hides Deepgram   │  │                 │
   │                  │  │ key from browser │  │                 │
   └──────────────────┘  └────────┬─────────┘  └─────────┬───────┘
                                  │                      │
                                  ▼                      ▼
                         ┌──────────────────┐  ┌─────────────────┐
                         │  Deepgram API    │  │  Anthropic API  │
                         └──────────────────┘  └─────────────────┘
```

Two services to deploy:
1. **Vercel** hosts the React frontend (static files) and a small serverless proxy for Deepgram
2. **Railway** (or Render, Fly.io) hosts the Python FastAPI backend

---

## Step 1 — Move Deepgram behind a proxy

In local development, the browser calls Deepgram directly with `VITE_DEEPGRAM_API_KEY` baked into the bundle. **That's not safe for production** — anyone who opens DevTools can extract your API key.

Add a Vercel serverless function at `api/deepgram-transcribe.ts` in the `depo_pro_bolt` repo root:

```powershell
mkdir api
notepad api\deepgram-transcribe.ts
```

Content:

```typescript
/**
 * Vercel serverless function that proxies Deepgram requests.
 * Hides DEEPGRAM_API_KEY from the browser.
 *
 * Browser POSTs an audio blob to /api/deepgram-transcribe with query params.
 * This function forwards to Deepgram with the secret key, returns the response.
 */

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
  maxDuration: 300, // 5 min max
};

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const search = url.searchParams.toString();

  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  if (!deepgramKey) {
    return new Response('Server misconfigured: DEEPGRAM_API_KEY missing', {
      status: 500,
    });
  }

  const dgUrl = `https://api.deepgram.com/v1/listen?${search}`;
  const dgRes = await fetch(dgUrl, {
    method: 'POST',
    headers: {
      Authorization: `Token ${deepgramKey}`,
      'Content-Type': req.headers.get('content-type') || 'audio/*',
    },
    body: req.body,
    // @ts-ignore — duplex needed for streaming bodies in fetch
    duplex: 'half',
  });

  return new Response(dgRes.body, {
    status: dgRes.status,
    headers: { 'Content-Type': dgRes.headers.get('content-type') || 'application/json' },
  });
}
```

Update `src/lib/deepgramClient.ts` so the production build uses the proxy and dev uses the direct call:

```typescript
const isDev = import.meta.env.DEV;
const endpoint = isDev
  ? 'https://api.deepgram.com/v1/listen'
  : '/api/deepgram-transcribe';

const headers: Record<string, string> = {
  'Content-Type': file.type || 'audio/*',
};
if (isDev) {
  headers.Authorization = `Token ${import.meta.env.VITE_DEEPGRAM_API_KEY}`;
}
```

After this change, the browser only sees the proxy URL in production. The Deepgram key never reaches the client.

---

## Step 2 — Push the changes

```powershell
git add api/ src/lib/deepgramClient.ts
git commit -m "Phase 11 prep: Vercel proxy for Deepgram"
git push
```

---

## Step 3 — Deploy the frontend to Vercel

1. Go to https://vercel.com and sign in with your GitHub account
2. Click **"Add New..."** → **"Project"**
3. Find `depo_pro_bolt` in the repo list and click **Import**
4. Vercel will detect Vite automatically. Defaults are fine:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
5. Expand **Environment Variables** and add:

| Name | Value |
|------|-------|
| `DEEPGRAM_API_KEY` | Your Deepgram key (no `VITE_` prefix — this is server-side) |
| `VITE_BACKEND_URL` | Leave blank for now; we'll fill it after Step 5 |

6. Click **Deploy**

Vercel builds the project and gives you a URL like `https://depo-pro-bolt-abc123.vercel.app`. Visit it. The frontend should load. **Don't try to transcribe yet** — the backend isn't deployed.

---

## Step 4 — Prepare the Python backend for deployment

Open `depo_pro_backend` in PowerShell:

```powershell
cd C:\Users\james\PycharmProjects\depo_pro_backend
```

### Step 4a — Generate `requirements.txt`

Inside the venv:

```powershell
.\.venv\Scripts\Activate.ps1
pip freeze > requirements.txt
```

Open `requirements.txt` and verify it lists fastapi, uvicorn, anthropic, python-docx, python-dotenv, httpx, python-multipart at minimum. Save.

### Step 4b — Add a `Procfile` for Railway

```powershell
notepad Procfile
```

Content (one line, no extension):

```
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

### Step 4c — The depo_transcribe import problem

The backend imports from `depo_transcribe`. On Railway, that folder doesn't exist. Two options:

**Option A (simpler):** Copy the needed files into `depo_pro_backend` itself. Specifically:
- `depo_transcribe/clean_format/prompt.py` → `depo_pro_backend/imported/prompt.py`
- `depo_transcribe/ufm_engine/populator/populate.py` → `depo_pro_backend/imported/populate.py`
- The 13 UFM templates → `depo_pro_backend/imported/ufm_templates/figures/`
- `depo_transcribe/ufm_engine/templates/manifest.json` → `depo_pro_backend/imported/ufm_templates/manifest.json`

Update `main.py` and the route files to import from `imported.` instead of doing the `sys.path.insert` trick.

**Option B (advanced):** Add `depo_transcribe` as a git submodule. More elegant but more setup. For v1, do Option A.

```powershell
mkdir imported
mkdir imported\ufm_templates
mkdir imported\ufm_templates\figures
copy ..\depo_transcribe\clean_format\prompt.py imported\prompt.py
copy ..\depo_transcribe\ufm_engine\populator\populate.py imported\populate.py
copy ..\depo_transcribe\ufm_engine\templates\manifest.json imported\ufm_templates\manifest.json
copy ..\depo_transcribe\ufm_engine\templates\figures\*.docx imported\ufm_templates\figures\
```

Create empty `__init__.py` files so Python treats `imported` as a package:

```powershell
type nul > imported\__init__.py
```

Update the route files (`routes/cleanup.py`, `routes/populate.py`, `routes/export.py`) to import from `imported.` rather than `clean_format.` or `ufm_engine.`.

For example, in `routes/cleanup.py`:

```python
# OLD
from clean_format.prompt import CLEAN_FORMAT_SYSTEM_PROMPT

# NEW
from imported.prompt import CLEAN_FORMAT_SYSTEM_PROMPT
```

### Step 4d — Update CORS for the production frontend

In `main.py`, the `DEPO_PRO_FRONTEND_ORIGIN` env var needs to accept both your local dev URL and your Vercel URL. Update:

```python
FRONTEND_ORIGINS = [
    "http://localhost:5173",
    os.environ.get("DEPO_PRO_FRONTEND_ORIGIN", "").rstrip("/"),
]
FRONTEND_ORIGINS = [o for o in FRONTEND_ORIGINS if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Step 4e — Push the backend to a new GitHub repo

If you didn't already, create a repo at https://github.com/new called `depo_pro_backend`:

```powershell
cd C:\Users\james\PycharmProjects\depo_pro_backend
git init
git add .
git status
```

Verify `.env` is NOT in the list. Then:

```powershell
git commit -m "Prepare for Railway deployment"
git branch -M main
git remote add origin https://github.com/jameshorton2486/depo_pro_backend.git
git push -u origin main
```

---

## Step 5 — Deploy the backend to Railway

1. Go to https://railway.app and sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Find `depo_pro_backend` and select it
4. Railway detects the Python project from `requirements.txt` and `Procfile`. It starts building.
5. While it builds, click your project → **Variables** and add:

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | Your Anthropic key |
| `DEPO_PRO_FRONTEND_ORIGIN` | Your Vercel URL from Step 3 (e.g., `https://depo-pro-bolt-abc123.vercel.app`) |

6. After deploy completes, Railway shows a URL like `https://depo-pro-backend-production-xyz.up.railway.app`. Visit it. You should see the JSON health check response.

If the deployment fails:
- Click **Deployments** → the latest deployment → **View Logs**
- The error is usually in the build log (missing dependency) or the runtime log (env var missing)
- Common fix: confirm `requirements.txt` includes everything needed

---

## Step 6 — Wire frontend to backend

Now that you have the Railway URL, go back to Vercel:

1. Open your Vercel project → **Settings** → **Environment Variables**
2. Edit `VITE_BACKEND_URL` and set it to your Railway URL (no trailing slash)
3. Save
4. Go to **Deployments** → click the latest one → **... menu** → **Redeploy** (Vercel needs to rebuild with the new env var)

---

## Step 7 — Test end-to-end

Open your Vercel URL in a fresh browser window. Try the full flow:

1. **Case Intake:** drop an NOD → fields populate → save
2. **Transcribe:** drop a short audio file → transcription completes
3. **Workspace:** edit an utterance → close tab → reopen → edit persisted
4. **Certification:** click Lock → working layer becomes read-only
5. **Export:** click Export → DOCX downloads

If any step fails, open DevTools (F12) → Network tab → find the failed request → look at the response. Common issues:

- **Network error on Deepgram call:** the proxy isn't configured. Check that `/api/deepgram-transcribe.ts` exists in the repo root and Vercel rebuilt after you added it.
- **CORS error on backend call:** the Railway env `DEPO_PRO_FRONTEND_ORIGIN` doesn't exactly match your Vercel URL. Compare them character-for-character.
- **500 on export:** the backend can't find the UFM templates. Confirm `imported/ufm_templates/figures/` made it into the git push.

---

## Step 8 — Set up a custom domain (optional)

If you own a domain like `depopro.com`:

**For the frontend:**
1. Vercel project → **Settings** → **Domains**
2. Add `app.depopro.com` (or whatever subdomain)
3. Vercel shows you DNS records to add at your registrar
4. Add them, wait 5-30 minutes for propagation

**For the backend:**
1. Railway project → **Settings** → **Networking** → **Custom Domain**
2. Add `api.depopro.com`
3. Follow the DNS instructions
4. Update Vercel's `VITE_BACKEND_URL` to the new domain, redeploy

---

## Step 9 — Monitor costs

After a week of use, check both dashboards:

**Vercel:** Free tier covers most small apps. Watch for "function invocations" — if the Deepgram proxy gets a lot of traffic, you may hit limits.

**Railway:** $5/month free tier credit. Python backends with low traffic typically cost $5-15/month.

**Deepgram:** Pay-as-you-go. Roughly $0.25 per hour of audio transcribed.

**Anthropic:** Pay-as-you-go. The cleanup pass on a 100-page transcript is roughly $0.05-0.20 depending on model.

For a court reporter doing ~10 depositions a month, total infrastructure cost should be under $25/month.

---

## Step 10 — Set up auto-deploys

By default, both Vercel and Railway auto-deploy on every push to `main`. This is what you want — push changes, they go live within 2-3 minutes.

If you want a staging environment:
1. Create a `develop` branch in both repos
2. In Vercel, configure preview deployments for non-main branches (automatic)
3. In Railway, create a second service pointed at the `develop` branch

This way you can push experimental work to `develop` without affecting the live app.

---

## Things that change after deployment

- **The Deepgram API key only lives in Vercel env vars.** Update it there, not in your local `.env`.
- **The Anthropic API key only lives in Railway env vars.** Update it there.
- **Local `.env` is still used for local development.** Both environments can coexist.
- **Your local IndexedDB and the production IndexedDB are separate.** A case you create locally doesn't appear in production, and vice versa.

---

## When something breaks in production

1. Check both Vercel and Railway deployment dashboards for failed builds
2. Look at recent commits — was anything pushed that might have broken it?
3. Revert if needed: `git revert <bad-commit-hash> ; git push`
4. Check Vercel function logs and Railway logs for runtime errors
5. Test locally with the same env vars to reproduce

The production environment is just two services running your code. There's no magic. If something works locally and doesn't work in production, the difference is almost always an environment variable or a missing file.

---

## v2 deployment improvements

For v1, the setup above is enough. Things you may want later:

- **Persistent storage on the backend** for case data backups (currently each user's data lives only in their browser)
- **User accounts** if you want multi-user
- **Better Anthropic rate limiting** if usage grows
- **A waveform service** if you add waveform visualization
- **Background workers** for long transcription jobs

None of these belong in v1.

---

## Success criterion

All of these are true:

1. Your Vercel URL loads the frontend
2. Your Railway URL returns the backend health check
3. The full flow (intake → transcribe → edit → export) works on the Vercel URL
4. The Deepgram API key is not visible in your frontend bundle (verify with browser DevTools → Sources → search for "DEEPGRAM")
5. You can share the Vercel URL with someone and they can use the app without you running anything locally

---

## What's next

You have a deployed v1 of Depo-Pro. The features in `01_MVP_SCOPE.md` are live.

From here:

- **Use it for real cases.** That's the only way to find what v1.5 should be.
- **Maintain a `WISHLIST.md`** at the root of the repo with feature ideas. Don't build them — write them down. After three months of real use, the patterns of what matters will be obvious.
- **Watch your costs** for the first month. Adjust if usage is heavy.
- **Tell people.** If this saves you time, it'll save other reporters time too.

You built it. Now ship it.
