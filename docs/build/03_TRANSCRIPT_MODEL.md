# 03 — Transcript Model

**Purpose.** Define the exact data shapes used throughout the app. Every component reads and writes data that conforms to these types. If a new type is needed, add it here first.

---

## TypeScript interfaces

These go in `src/types/model.ts` in the Bolt project. The current Bolt project has some of these already (`src/types/intake.ts`); this document is the canonical source — update existing files to match.

### Job

A "job" is one deposition. Everything (utterances, corrections, exports) belongs to a job.

```typescript
export interface Job {
  id: string;                          // ULID or UUID
  created_at: string;                  // ISO timestamp
  updated_at: string;                  // ISO timestamp

  // Stage tracking
  stage: 'intake' | 'transcribe' | 'workspace' | 'certification' | 'exported';
  layer: 'raw' | 'working' | 'certified';
  certified_at?: string;               // ISO timestamp; set when reporter locks
  certified_by?: string;               // Reporter name from signature input

  // Case metadata (mirrors IntakeRecord from existing src/types/intake.ts)
  case_meta: IntakeRecord;

  // Source files
  source_audio_name: string;
  source_audio_size: number;
  source_audio_duration_sec: number;

  // Deepgram metadata
  deepgram_request_id?: string;
  deepgram_options: Record<string, unknown>;

  // Status
  status: 'processing' | 'complete' | 'failed';
  error_message?: string;

  // Counts (cached for UI)
  utterance_count: number;
  word_count: number;
  speaker_count: number;

  // Speaker mapping: Deepgram speaker_id (0, 1, 2...) → human name
  speaker_names: Record<number, string>;

  // Speaker roles: maps speaker_name → 'attorney_plaintiff' | 'attorney_defense' | 'witness' | 'reporter' | 'videographer' | 'interpreter' | 'judge' | 'other'
  speaker_roles: Record<string, string>;
}
```

### Utterance

One speaker turn from Deepgram. The fundamental unit of the transcript.

```typescript
export interface Utterance {
  // Identity
  job_id: string;
  sequence_index: number;              // 0-based, monotonically increasing within a job

  // Source data (immutable after write — the Raw Layer)
  raw_transcript: string;              // What Deepgram produced
  raw_speaker_id: number;              // Deepgram's speaker_id
  start_time: number;                  // Seconds from start of audio
  end_time: number;                    // Seconds
  confidence: number;                  // 0.0 - 1.0, mean across words

  // Word-level data (immutable, optional for UI use)
  words: UtteranceWord[];

  // Working layer (mutable)
  working_transcript: string;          // Initially copy of raw_transcript
  working_speaker_id: number;          // Initially copy of raw_speaker_id; can be reassigned
  qa_role?: 'Q' | 'A' | null;          // Used by Formatting mode to assign Q. or A. labels

  // Edit tracking
  has_human_edit: boolean;             // True if working_transcript ≠ raw_transcript
  has_accepted_suggestion: boolean;    // True if at least one AI suggestion was accepted
  flag: boolean;                       // User-set flag for "come back to this"

  // Review state
  reviewed: boolean;                   // User has marked this utterance reviewed in Audio Review mode
}

export interface UtteranceWord {
  word: string;                        // Raw text
  punctuated_word?: string;            // With punctuation
  start: number;                       // Seconds
  end: number;                         // Seconds
  confidence: number;                  // 0.0 - 1.0
  speaker_id?: number;
}
```

### Suggestion

A proposed change to an utterance. Suggestions are generated once after transcription completes and stored in IndexedDB. The Suggestions mode reads from this table.

```typescript
export interface Suggestion {
  id: string;                          // ULID
  job_id: string;
  utterance_sequence_index: number;    // Which utterance this applies to

  // The change
  source_text: string;                 // The text in the utterance this targets
  proposed_text: string;               // The replacement text
  category: SuggestionCategory;
  confidence: number;                  // 0.0 - 1.0
  rationale: string;                   // Short human-readable explanation

  // Origin
  source: 'deterministic' | 'legal_dict' | 'case_keyterm' | 'correction_memory';

  // State
  state: 'pending' | 'accepted' | 'rejected';
  decided_at?: string;
  remembered?: boolean;                // Set true if accepted with "+ Remember"
}

export type SuggestionCategory =
  | 'proper_noun'        // From case metadata or keyterms
  | 'legal_term'         // From legal dictionary
  | 'qa_label'           // Q/A structure
  | 'speaker_label'      // Speaker formatting
  | 'punctuation'        // Morson punctuation
  | 'number_format'      // Numerals per UFM/Morson
  | 'objection'          // Objection formatting
  | 'parenthetical'      // Parenthetical formatting
  | 'exhibit_ref'        // Exhibit references
  | 'memory';            // From Correction Memory
```

### Correction Memory entry

When a user clicks "Accept + Remember" on a suggestion, an entry is added here. Future jobs by the same reporter get suggestions seeded from this list.

```typescript
export interface CorrectionMemoryEntry {
  id: string;
  reporter_id: string;                 // Reporter name or CSR number
  original: string;                    // What Deepgram heard
  replacement: string;                 // What it should be
  category: SuggestionCategory;
  scope: 'reporter' | 'case';          // Reporter-wide or just this case
  case_id?: string;                    // If scope is 'case'
  created_at: string;
  use_count: number;                   // Incremented each time this is applied
}
```

### Provenance Event

Every change to a transcript creates a provenance event. This is the legal audit trail.

```typescript
export interface ProvenanceEvent {
  id: string;
  job_id: string;
  utterance_sequence_index?: number;   // Optional — global events have no utterance
  timestamp: string;
  actor: 'deepgram' | 'human' | 'ai_deterministic' | 'ai_llm';
  actor_name?: string;                 // Reporter name for 'human' events
  event_type: ProvenanceEventType;
  details: Record<string, unknown>;    // Free-form, varies by event type
}

export type ProvenanceEventType =
  | 'transcription_complete'
  | 'utterance_edited'
  | 'speaker_reassigned'
  | 'suggestion_accepted'
  | 'suggestion_rejected'
  | 'suggestion_remembered'
  | 'utterance_flagged'
  | 'utterance_reviewed'
  | 'job_certified'
  | 'export_generated';
```

---

## IndexedDB schema

These are the object stores in the `depopro_local` IndexedDB database. Database version is now **4** (the current Bolt code uses version 3; bumping to 4 adds the new stores).

| Store | Key | Indexes | Notes |
|-------|-----|---------|-------|
| `jobs` | `id` | `created_at`, `stage`, `layer` | One row per deposition |
| `utterances` | `[job_id, sequence_index]` | `job_id` | One row per speaker turn |
| `suggestions` | `id` | `job_id`, `[job_id, state]` | One row per proposed change |
| `corrections_memory` | `id` | `reporter_id`, `[reporter_id, original]` | Reporter's learned corrections |
| `provenance` | `id` | `job_id`, `[job_id, timestamp]` | Audit log |
| `audio_blobs` | `job_id` | (none) | Raw audio Blob for playback |

The schema upgrade in `localStore.ts` needs to be updated. The current code at `src/lib/localStore.ts` defines version 3 with two stores (`jobs`, `utterances`). Phase 4 (Workspace Shell) will bump this to version 4 and add the four new stores.

---

## How the layers map to the data

The "three layers" from the architecture document map to specific fields:

| Layer | Where it lives |
|-------|----------------|
| **Raw** | `Utterance.raw_transcript` + `Utterance.raw_speaker_id` + `Utterance.words` |
| **Working** | `Utterance.working_transcript` + `Utterance.working_speaker_id` + `Utterance.qa_role` |
| **Certified** | `Job.certified_at` flag — when set, the working layer becomes read-only |

The raw fields are written once during transcription. They are never updated by application code. The working fields start as copies of the raw fields and update on every edit. When certified, the working fields are frozen by enforcing read-only at the UI layer (no database constraint — UI prevents writes).

---

## Examples

### Example: a new job after transcription completes

```typescript
const job: Job = {
  id: '01H8X...',
  created_at: '2026-05-19T10:00:00.000Z',
  updated_at: '2026-05-19T10:15:00.000Z',
  stage: 'workspace',
  layer: 'working',
  case_meta: { /* ...IntakeRecord... */ },
  source_audio_name: 'leifer_deposition.mp3',
  source_audio_size: 147_829_120,
  source_audio_duration_sec: 9480,
  deepgram_request_id: 'abc-123',
  deepgram_options: { model: 'nova-3', diarize: true, /* ... */ },
  status: 'complete',
  utterance_count: 847,
  word_count: 28_447,
  speaker_count: 3,
  speaker_names: { 0: 'Mr. Davis', 1: 'Dr. Leifer', 2: 'Ms. Reyes' },
  speaker_roles: {
    'Mr. Davis': 'attorney_plaintiff',
    'Dr. Leifer': 'witness',
    'Ms. Reyes': 'attorney_defense',
  },
};
```

### Example: an utterance with an accepted suggestion

```typescript
const utterance: Utterance = {
  job_id: '01H8X...',
  sequence_index: 9,
  raw_transcript: 'I am on the faculty of Trinaty University here in San Antonio, Texas.',
  raw_speaker_id: 1,
  start_time: 134.5,
  end_time: 138.2,
  confidence: 0.62,
  words: [ /* ... */ ],
  working_transcript: 'I am on the faculty of Trinity University here in San Antonio, Texas.',
  working_speaker_id: 1,
  qa_role: 'A',
  has_human_edit: false,
  has_accepted_suggestion: true,
  flag: false,
  reviewed: true,
};
```

The suggestion that produced this change:

```typescript
const suggestion: Suggestion = {
  id: '01H8Y...',
  job_id: '01H8X...',
  utterance_sequence_index: 9,
  source_text: 'Trinaty',
  proposed_text: 'Trinity',
  category: 'proper_noun',
  confidence: 0.94,
  rationale: 'Matches NOD keyterm "Trinity University"',
  source: 'case_keyterm',
  state: 'accepted',
  decided_at: '2026-05-19T10:12:33.000Z',
  remembered: true,
};
```

And the corresponding correction memory entry:

```typescript
const memory: CorrectionMemoryEntry = {
  id: '01H8Z...',
  reporter_id: 'Miah Bardot · CSR 12129',
  original: 'Trinaty',
  replacement: 'Trinity',
  category: 'proper_noun',
  scope: 'reporter',
  created_at: '2026-05-19T10:12:33.000Z',
  use_count: 1,
};
```

---

## Success criterion for this document

You can answer these questions without looking:
1. Where does the raw Deepgram output live and what guarantees its immutability?
2. What does "Accept + Remember" produce in the database?
3. How many object stores are in IndexedDB at v1?

---

## Next

Read `04_WORKSPACE_RULES.md`.
