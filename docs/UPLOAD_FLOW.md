# Upload Flow — Depo-Pro Transcribe

## Overview

The upload flow is intentionally minimal. The browser's only responsibilities are file selection, basic validation, obtaining a presigned upload URL, and job creation. No media processing occurs client-side, and audio bytes never pass through any edge function.

---

## Step-by-Step Flow

### 1. File Selection

User selects one or more files via drag-and-drop or the file picker.

**Accepted extensions:** `.mp3`, `.wav`, `.flac`, `.m4a`, `.aac`, `.mp4`, `.mov`, `.avi`

**Validation (client-side only):**
- File type must match accepted MIME types or extension list
- Multiple files accepted — each transcribed independently, stitched into one timeline
- No size limit enforced client-side (server enforces 5 GB per part)

### 2. Presigned Upload to Supabase Storage

Direct anon access to the audio-files bucket is disabled. Uploads use a two-step flow:

**Step 2a — Get an upload URL.** The browser POSTs file metadata to the `create-upload-url` edge function. The function uses the service role to call `createSignedUploadUrl` and returns a short-lived PUT URL plus the storage path.

```
POST /functions/v1/create-upload-url
{
  "jobScopeId": "<uuid>",
  "partIndex": 0,
  "filename": "heath_thomas.m4a",
  "contentType": "audio/x-m4a",
  "fileSize": 82477056
}
→ { "uploadUrl": "https://...", "token": "...", "path": "<uuid>/part_00_heath_thomas.m4a" }
```

**Step 2b — PUT the file.** The browser does a single PUT to the returned URL. Bytes go directly browser → Supabase Storage CDN. No edge function memory is consumed.

```
PUT {uploadUrl}
Content-Type: audio/x-m4a
<raw bytes>
```

**Storage path layout:**

    {jobScopeId}/part_{NN}_{safe_filename}

- `jobScopeId` is a fresh UUID per job, generated on the browser
- `part_{NN}` is zero-padded to two digits, preserving part order
- `safe_filename` has any character outside `[\w.\-]` replaced with underscore, leading dots stripped

This layout has three properties: (a) no millisecond collisions, ever; (b) namespaced by job, easy to list/delete an entire job's files; (c) ready to swap `jobScopeId` for `auth.uid()` when authentication is added.

**Progress tracking:**
Multiple files upload sequentially, each preceded by a URL-request step.

### 3. Transcription Job Creation

After all files are uploaded, a single `transcription_jobs` record is created:

```typescript
{
  case_id: caseData.id ?? null,
  status: 'pending',
  model: 'nova-3',            // user-selected
  processing_mode: '...',
  source_file_name: '...',
  storage_path: primaryPath,  // first file path
  phase: 'Queued',
  deepgram_options: { ... },
}
```

### 4. Edge Function Invocation (`transcribe-audio`)

The browser invokes `transcribe-audio` with:

```json
{
  "jobId": "uuid",
  "storagePath": "<jobScopeId>/part_00_...",
  "storagePaths": ["<jobScopeId>/part_00_...", "<jobScopeId>/part_01_..."],
  "model": "nova-3",
  "deepgramOptions": { ... }
}
```

**The edge function returns in under 5 seconds.** It submits each part to Deepgram async and immediately returns `{ success: true, partsSubmitted: N }`. The browser switches to polling mode without waiting for transcription to complete.

### 5. Async Deepgram Processing

Deepgram processes each part independently. When a part finishes, Deepgram POSTs the result to `transcribe-callback`. The callback function:
- Verifies the HMAC token
- Persists the result to `transcript_parts`
- Increments `job.parts_completed`
- Triggers finalization when all parts are complete

### 6. Progress Polling

The client polls `transcription_jobs` every 2 seconds:
- `status`: pending → processing → complete / failed
- `phase`: human-readable processing stage
- `progress`: 0–100 percentage
- `parts_completed` / `parts_total`: per-part progress for multi-part jobs

**Polling stops** when `status` is `complete` or `failed`.

---

## Phase Progression

| Phase string | Meaning |
|---|---|
| `Queued` | Job created, waiting for edge function |
| `Submitting N parts to Deepgram...` | transcribe-audio running |
| `Awaiting Deepgram (0/N parts)` | All submitted, no callbacks yet |
| `Awaiting Deepgram (k/N parts)` | k of N parts have returned |
| `Stitching transcripts...` | Building global timeline |
| `Grouping speaker turns...` | Grouper running on stitched utterances |
| `Building speaker map...` | Creating speaker_mappings |
| `Complete` | Transcript ready for review |

---

## Multi-Part Upload

When a deposition was recorded in multiple segments, users can upload all parts together.

**Upload behavior:**
- Each file gets its own presigned URL and uploads to its own storage path
- `part_00`, `part_01`, etc. suffixes preserve order
- All paths passed to the edge function as `storagePaths[]`
- Each part is submitted to Deepgram independently as a separate async job
- Results are stitched using cumulative time offsets after all callbacks land

**There is no practical file size limit** for multi-part jobs — each part is submitted independently via a presigned URL; no audio bytes pass through any edge function.

---

## Error Handling

| Error | Recovery |
|-------|----------|
| File type rejected | Immediate UI notification; file not added to queue |
| `create-upload-url` rejects content type | Error notification; upload aborted |
| `create-upload-url` rejects file size | Error notification; upload aborted |
| PUT to storage fails | Error notification; job not created; user can retry |
| `DEEPGRAM_API_KEY` not set | 503 with clear message; job marked failed |
| `DEEPGRAM_CALLBACK_SECRET` not set | 503 with clear message; job marked failed |
| Deepgram submission fails for a part | That part and the whole job marked failed; remaining parts not submitted |
| Invalid HMAC on callback | 401 returned; no DB state modified |
| Deepgram never fires callback | Job remains stuck at `Awaiting Deepgram` (watchdog TODO) |
| Finalization DB error | Job marked failed; raw results preserved in `transcript_parts` |

---

## Storage Lifecycle

| File type | Path | Lifecycle |
|-----------|------|-----------|
| Original upload | `{jobScopeId}/part_{NN}_{name}` | Permanent — legal record |
| Transcript artifacts | DB tables | Permanent |

The original uploaded media is never deleted or overwritten. This is required for legal defensibility.

---

## Security

- The audio-files bucket has no anon or authenticated direct policies. All uploads must go through the `create-upload-url` edge function.
- Presigned upload URLs expire in approximately 2 hours.
- Edge functions read files using the service role, which bypasses RLS.
- `create-upload-url` validates content type (allowlist), file size (1 byte – 5 GB), filename (sanitized), and jobScopeId (UUID format) before issuing any URL.
- Signed URLs for Deepgram access: **6-hour expiry** (extended from 1 hour to outlast async processing)
- Callback URLs include HMAC-SHA256 token: forged callbacks return 401 without DB access
- Future hardening: add Supabase Auth and replace the `jobScopeId` UUID with `auth.uid()` in both the path scheme and a per-user RLS policy. No other code needs to change.

---

## Removed: Browser-Side FFmpeg and Byte Stitching

Prior to this architecture:
1. The browser ran FFmpeg WebAssembly to convert video files — removed due to memory exhaustion on long depositions
2. Multi-part files were stitched as raw bytes in the edge function — removed because raw byte concatenation corrupts WAV, MP4, MOV, M4A, AAC, and FLAC files

Both have been replaced by per-part async transcription with transcript-level JSON stitching.
