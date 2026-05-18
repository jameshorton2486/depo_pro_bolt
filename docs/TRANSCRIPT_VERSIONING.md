# Transcript Versioning

## Purpose

Every time a deposition transcript advances to a new processing stage, a version snapshot
is written to the `transcript_versions` table. This creates an immutable, ordered audit trail
from raw Deepgram output to final export.

No stage ever overwrites a prior stage. A version is append-only.

---

## Stages

| Stage | Trigger | Created by |
|---|---|---|
| `raw` | Deepgram transcription complete | system |
| `grouped` | Speaker grouping algorithm runs | system |
| `deterministic` | Batch correction rules applied | system |
| `ai_suggested` | AI review pass completes | ai |
| `approved` | Human reviewer approves changes | human |
| `exported` | Transcript exported to PDF/DOCX | system |

---

## Schema: `transcript_versions`

```sql
id                  uuid PRIMARY KEY
job_id              uuid NOT NULL  -- FK → transcription_jobs
stage               text NOT NULL  -- one of the 6 stages above
version_number      integer        -- auto-incremented per job
utterances_snapshot jsonb          -- full frozen array of Utterance objects
word_count          integer        -- word count at this stage
created_by          text           -- 'system' | 'ai' | reviewer name
notes               text           -- optional human annotation
created_at          timestamptz
```

The `utterances_snapshot` column stores a complete frozen copy of the utterances array
at that stage, including all corrections applied up to that point.

---

## Usage

### Persisting a version (TypeScript)

```typescript
import { persistTranscriptVersion } from '../lib/diff/transcriptDiffEngine';

// After deterministic corrections are applied:
await persistTranscriptVersion(job.id, 'deterministic', utterances, 'system');

// After AI review completes:
await persistTranscriptVersion(job.id, 'ai_suggested', utterances, 'ai');

// After human approval:
await persistTranscriptVersion(job.id, 'approved', utterances, reviewer.name);
```

### Loading versions

```typescript
import { loadTranscriptVersions, loadVersionForStage } from '../lib/diff/transcriptDiffEngine';

const allVersions = await loadTranscriptVersions(job.id);
const detVersion = await loadVersionForStage(job.id, 'deterministic');
```

---

## Rollback

To roll back to any prior stage, load the target version's `utterances_snapshot` and
restore it as the current utterance set. The original data is never deleted.

Rollback must be performed deliberately by a human reviewer — it is never automatic.
