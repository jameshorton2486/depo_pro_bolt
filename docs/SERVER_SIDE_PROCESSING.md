# Server-Side Processing — Depo-Pro Transcribe

## Overview

All media processing in Depo-Pro Transcribe executes server-side across two Supabase Edge Functions. The browser does not transform, transcode, or process audio in any way.

---

## Async Callback Architecture

The pipeline uses **Deepgram async callback mode**. The `transcribe-audio` function submits each audio part to Deepgram and returns in under 5 seconds — no timeout risk regardless of audio length. Deepgram pushes results back via HTTP POST to `transcribe-callback` when each part finishes.

```
Client → uploads N files → invokes transcribe-audio (POST)

transcribe-audio:
  for each part i in 0..N-1:
    - create 6-hour signed URL
    - compute HMAC token for (jobId, i)
    - POST to Deepgram async with callback URL + token
    - Deepgram returns { request_id } immediately
    - persist request_id in transcript_parts row
  job.status = 'processing', phase = 'Awaiting Deepgram (0/N parts)'
  return 200 in < 5 seconds

Deepgram processes each part asynchronously, then POSTs results to:
  /functions/v1/transcribe-callback?jobId=&partIndex=&token=

transcribe-callback (one invocation per finished part):
  - verify HMAC token (timing-safe)
  - idempotency check: skip if already complete
  - persist raw_result on transcript_parts row
  - increment job.parts_completed
  - if all N parts complete → run stitch + grouping + finalization
  - return 200
```

---

## Edge Function: `transcribe-audio`

**Location:** `supabase/functions/transcribe-audio/index.ts`  
**JWT verification:** required (called by authenticated browser client)  
**Trigger:** HTTP POST from the browser after upload and job creation

**Input:**
```json
{
  "jobId": "uuid",
  "storagePath": "jobs/timestamp_part1_filename.mp4",
  "storagePaths": ["jobs/..._part1_...", "jobs/..._part2_..."],
  "model": "nova-3",
  "deepgramOptions": { "diarize": true, "utterances": true, ... }
}
```

**Behavior:**
1. Validates inputs — fails with 400 if jobId or storagePath missing
2. Fails with 503 if `DEEPGRAM_API_KEY` or `DEEPGRAM_CALLBACK_SECRET` not set
3. For each path: creates a **6-hour** signed URL, signs an HMAC callback token, submits to Deepgram async
4. Inserts a `transcript_parts` row with the Deepgram `request_id`
5. Updates job phase and returns 200 immediately

**No mock mode** — missing `DEEPGRAM_API_KEY` returns 503 with a clear error message.

---

## Edge Function: `transcribe-callback`

**Location:** `supabase/functions/transcribe-callback/index.ts`  
**JWT verification:** DISABLED — Deepgram callbacks do not carry a Supabase JWT  
**Trigger:** HTTP POST from Deepgram when a part finishes processing

**Security:** HMAC-SHA256 token in the callback URL query string. Tokens are generated in `transcribe-audio` using `DEEPGRAM_CALLBACK_SECRET` and verified in `transcribe-callback`. Forged or replayed callbacks return 401 without touching any DB state.

**Idempotency:** If a part row already has `status = 'complete'` and `raw_result IS NOT NULL`, the function returns `200 { alreadyComplete: true }` without any DB writes. Deepgram retries on 5xx — duplicate deliveries are safe.

---

## Required Secrets

| Secret | Purpose |
|--------|---------|
| `DEEPGRAM_API_KEY` | Authenticate Deepgram API submissions |
| `DEEPGRAM_CALLBACK_SECRET` | HMAC signing key for callback URL tokens |
| `SUPABASE_URL` | Pre-populated in Supabase Edge Function runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Pre-populated in Supabase Edge Function runtime |

To generate `DEEPGRAM_CALLBACK_SECRET`:
```bash
openssl rand -base64 48
```

This secret is stored as a Supabase Edge Function secret and never committed to source control.

---

## Finalization Pass (runs in `transcribe-callback`)

When the last part lands, `transcribe-callback` runs the finalization pass:

### Step A — Load all parts ordered by `part_index`
### Step B — Compute cumulative time offsets
```
part 0 offset = 0
part 1 offset = part 0 duration_seconds
part 2 offset = part 0 + part 1 duration_seconds
...
```
### Step C — Build flat globally-sequenced utterance list
Each utterance's `start_time`, `end_time`, and word timestamps are shifted by `+offset` for its part. Speaker IDs remain local to each part (they are separate Deepgram diarization runs).

### Step D — Insert utterances (batches of 100)
### Step E — Run `groupSpeakerTurns` over the global list
The 1.2s gap threshold applies across part boundaries — parts naturally produce gaps > 1.2s which become new speaker turns (correct behavior).

### Step F — Insert speaker_turns
### Step G — Build speaker mappings
One row per unique `(part_index, speaker_id)` combination. Labels:
- Single-part: `Speaker 0`, `Speaker 1`
- Multi-part: `Speaker 0 (Part 1)`, `Speaker 0 (Part 2)`, etc.

`confidence_pct` is a real duration-weighted average of Deepgram confidence scores — not random.

### Step H — Finalize job
`status = 'complete'`, `progress = 100`, full log written.

---

## Processing Phases (visible in UI)

| Phase string | Meaning |
|---|---|
| `Submitting N parts to Deepgram...` | transcribe-audio submitting async jobs |
| `Awaiting Deepgram (0/N parts)` | All submitted, waiting for first callback |
| `Awaiting Deepgram (k/N parts)` | k parts have returned |
| `Stitching transcripts...` | All parts landed, building global timeline |
| `Grouping speaker turns...` | Running grouper on stitched utterances |
| `Building speaker map...` | Inserting speaker_mappings |
| `Complete` | Done |

---

## Deepgram Options

| Option | Default | Purpose |
|--------|---------|---------|
| `diarize` | true | Speaker separation |
| `utterances` | true | Utterance segmentation |
| `punctuate` | true | Punctuation prediction |
| `smart_format` | true | Number/time formatting |
| `filler_words` | true | Preserve uh/um/you know |
| `numerals` | true | Numeric transcription |
| `utt_split` | 0.8s | Utterance silence threshold |
| `keyterms` | [] | Case-specific vocabulary boosting |

---

## Error Handling

| Failure | Behavior |
|---------|----------|
| Missing `DEEPGRAM_API_KEY` | 503 with clear message — no mock fallback |
| Missing `DEEPGRAM_CALLBACK_SECRET` | 503 with clear message |
| Signed URL creation fails | Part fails, job marked failed |
| Deepgram submission returns 4xx/5xx | Part marked failed, job marked failed, no further parts submitted |
| Invalid HMAC on callback | 401 returned, no DB state modified |
| Malformed JSON in callback body | Part and job marked failed, 400 returned |
| Deepgram never delivers callback | Job remains at `parts_completed < parts_total` indefinitely (TODO: watchdog cron — see below) |
| Finalization fails (DB error etc.) | Job marked failed, 200 returned to Deepgram (prevents retry of already-delivered data) |

---

## Known Limitations / TODOs

- **Watchdog cron not implemented:** If Deepgram never fires a callback for a part (network issue, endpoint unreachable during brief downtime), the job will remain stuck at `Awaiting Deepgram`. A future improvement should poll `https://api.deepgram.com/v1/projects/{id}/requests/{request_id}` for jobs older than 30 minutes and manually trigger finalization.
- **Speaker merging across parts:** Speakers in part 2 are treated as distinct from speakers in part 1. The reporter must manually merge them in the speaker labeling UI. Cross-part speaker identity resolution is a future enhancement.
