# Media Pipeline Architecture — Depo-Pro Transcribe

## Overview

Depo-Pro Transcribe uses a **server-side-only, async callback** media processing architecture. The browser is responsible for file selection and upload only. All transcription, stitching, and grouping happens in Supabase Edge Functions after the upload completes.

---

## Current Architecture

```
User selects file(s) (browser)
        │
        ▼
Basic type/size validation (browser)
        │
        ▼
Direct upload to Supabase Storage — original file, unchanged
  /audio-files/jobs/{timestamp}_part{n}_{filename}
        │
        ▼
DB: transcription_jobs row created (status = 'pending')
        │
        ▼
Edge function invoked: transcribe-audio
  Returns in < 5 seconds regardless of audio length
        │
        ├── For EACH part independently:
        │     6-hour signed URL → Deepgram async submission
        │     transcript_parts row inserted with request_id
        │     (No audio bytes pass through the edge function)
        │
        ▼
job.status = 'processing', phase = 'Awaiting Deepgram (0/N)'
        │
        ▼
Deepgram processes each part asynchronously
        │
        ▼ (for each part, when Deepgram is done)
transcribe-callback invoked by Deepgram
        │
        ├── HMAC token verified
        ├── Part result persisted to transcript_parts
        ├── job.parts_completed incremented
        │
        └── When ALL parts complete:
              Build global timeline with cumulative time offsets
              Insert utterances (globally sequenced, time-shifted)
              Run speaker-turn grouping pass
              Insert speaker_turns
              Insert speaker_mappings (per part_index × speaker_id)
              job.status = 'complete'
        │
        ▼
Client polls → loads transcript → TranscriptEditor
```

---

## Why Per-Part Async Transcription (Not Byte Stitching)

### Old approach (removed): byte concatenation

The previous multi-part path downloaded all audio files into the edge function's memory, concatenated the raw bytes using `Uint8Array.set`, and POSTed the combined buffer to Deepgram. This had two critical defects:

| Defect | Impact |
|--------|--------|
| Naive byte concatenation | Produces valid output for MP3 only; silently corrupts WAV, MP4, MOV, M4A, AAC, FLAC (these are container formats — you cannot concatenate them as raw bytes) |
| Synchronous Deepgram fetch | Edge function waits for the full Deepgram response; any deposition longer than ~5–6 minutes exceeds the Supabase function runtime budget and is killed, leaving the job in `status='processing'` forever |

### New approach: per-part async

Each uploaded file is submitted to Deepgram as its own independent async job. Deepgram fires a callback when each part finishes. The edge function stitches the **transcript JSON**, not the audio bytes — this is always correct regardless of container format.

Time offset stitching:
```
part 0 utterances: start/end as-is (offset = 0)
part 1 utterances: start/end += part0.duration_seconds
part 2 utterances: start/end += part0.duration_seconds + part1.duration_seconds
...
```

The global timeline looks identical to a single-file transcription.

---

## Why Browser FFmpeg Was Removed

The previous version ran FFmpeg WebAssembly in the browser. This was removed because:

| Problem | Impact |
|---------|--------|
| 2–8 hour depositions load GBs of video into browser RAM | Tab crash, OOM kill |
| WASM 32-bit address space | Hard ceiling on file size |
| Single-threaded WASM | Freezes the UI during encode |
| Multi-threaded WASM requires SharedArrayBuffer | Requires COOP/COEP headers on every deployment host |
| FFmpeg CDN dependency | CDN outage breaks all uploads |
| No recovery if encode fails mid-way | Original file not uploaded; operation must restart |

Deepgram natively supports all common video and audio container formats — client-side transcoding is unnecessary.

---

## Storage Layout

```
audio-files/                    ← Supabase Storage bucket
└── jobs/
    └── {timestamp}_part{n}_{safe_filename}
        e.g. 1716000000000_part1_depo_garza.mp4
```

Files are never renamed or transformed during upload. The original format is preserved.

---

## Supported File Formats

| Format | Notes |
|--------|-------|
| MP3 | Deepgram native |
| WAV | Deepgram native |
| FLAC | Deepgram native |
| M4A | Deepgram native |
| AAC | Deepgram native |
| MP4 | Deepgram accepts video with audio track |
| MOV | Deepgram accepts video with audio track |
| AVI | Deepgram native |

There is **no combined size limit** — each file is submitted independently. A 10-part, 50 GB deposition is handled identically to a 1-part, 100 MB one.

---

## Speaker Identity Across Parts

Deepgram diarization is run independently per part. Speaker `0` in part 1 may or may not be the same person as speaker `0` in part 2 — Deepgram cannot know.

Speaker mappings are stored per `(part_index, speaker_id)`:
- Single-part: `Speaker 0`, `Speaker 1`
- Multi-part: `Speaker 0 (Part 1)`, `Speaker 0 (Part 2)`, etc.

The reporter merges cross-part speakers manually in the speaker labeling UI. Automated cross-part speaker identity resolution is a future enhancement.

---

## Future Enhancements

| Enhancement | Priority | Notes |
|-------------|----------|-------|
| Watchdog cron for stuck jobs | High | Poll Deepgram API for parts not completing within 30 min |
| Cross-part speaker merging UI | Medium | Let reporter link Part 1 Speaker 0 = Part 2 Speaker 0 |
| Tus resumable upload protocol | Medium | Supabase Storage supports tus for large file reliability |
| Server-side audio normalization | Low | FFmpeg in edge function for problem files |
