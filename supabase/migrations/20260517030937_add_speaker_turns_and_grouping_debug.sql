/*
  # Speaker Turn Grouping — speaker_turns table and grouping debug log

  ## Summary
  Adds the infrastructure for the speaker-turn grouping pass that runs after
  Deepgram utterance extraction. Raw utterances remain untouched in the existing
  utterances table. Grouped turns are stored separately so both can be inspected
  and diffed for auditing and future regression testing.

  ## New Table: speaker_turns
  Each row is one merged speaker turn — one or more consecutive same-speaker
  Deepgram utterances that were collapsed into a single logical unit.

  Columns:
  - `id`                   (uuid, pk)
  - `job_id`               (uuid, fk → transcription_jobs)
  - `speaker_id`           (integer) — Deepgram diarization speaker index
  - `start_time`           (float8) — earliest start_time of member utterances
  - `end_time`             (float8) — latest end_time of member utterances
  - `joined_text`          (text) — concatenation of member transcript texts,
                                    verbatim, no words added or removed
  - `confidence`           (float8) — minimum confidence of member utterances
  - `sequence_index`       (integer) — ordering index among all turns for this job
  - `member_count`         (integer) — how many raw utterances were merged
  - `source_utterance_ids` (uuid[]) — ordered array of raw utterances.id values
  - `member_utterances`    (jsonb) — full copy of each member utterance object
                                     for verbatim audit without joins
  - `grouping_meta`        (jsonb) — diagnostics: gap sizes, merge decisions,
                                     threshold used, flags
  - `created_at`           (timestamptz)

  ## transcription_jobs — new columns
  - `grouping_debug_log` (jsonb): machine-readable per-utterance diagnostic log
    capturing speaker_id, timestamps, gap, merge decision, and transcript for
    every input utterance processed by the grouper. Enables deterministic
    regression comparison.
  - `speaker_turn_count` (integer): number of speaker turns produced by grouper.
  - `grouping_threshold_used` (float8): the gap threshold that was active for
    this job's grouping pass.

  ## Security
  RLS enabled; same anon+authenticated open policies as other tables in this
  single-user reporter application.

  ## Indexes
  - speaker_turns(job_id, sequence_index) for ordered turn retrieval
  - speaker_turns(job_id, speaker_id) for per-speaker filtering
*/

-- speaker_turns table
CREATE TABLE IF NOT EXISTS speaker_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  speaker_id integer NOT NULL DEFAULT 0,
  start_time float8 NOT NULL DEFAULT 0,
  end_time float8 NOT NULL DEFAULT 0,
  joined_text text NOT NULL DEFAULT '',
  confidence float8 NOT NULL DEFAULT 0,
  sequence_index integer NOT NULL DEFAULT 0,
  member_count integer NOT NULL DEFAULT 1,
  source_utterance_ids uuid[] NOT NULL DEFAULT '{}',
  member_utterances jsonb NOT NULL DEFAULT '[]',
  grouping_meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE speaker_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon users can select speaker_turns"
  ON speaker_turns FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can insert speaker_turns"
  ON speaker_turns FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon users can update speaker_turns"
  ON speaker_turns FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon users can delete speaker_turns"
  ON speaker_turns FOR DELETE TO anon USING (true);

CREATE POLICY "Authenticated users can select speaker_turns"
  ON speaker_turns FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert speaker_turns"
  ON speaker_turns FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update speaker_turns"
  ON speaker_turns FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete speaker_turns"
  ON speaker_turns FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_speaker_turns_job_sequence
  ON speaker_turns(job_id, sequence_index);

CREATE INDEX IF NOT EXISTS idx_speaker_turns_job_speaker
  ON speaker_turns(job_id, speaker_id);

-- New columns on transcription_jobs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcription_jobs' AND column_name = 'grouping_debug_log'
  ) THEN
    ALTER TABLE transcription_jobs ADD COLUMN grouping_debug_log jsonb;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcription_jobs' AND column_name = 'speaker_turn_count'
  ) THEN
    ALTER TABLE transcription_jobs ADD COLUMN speaker_turn_count integer;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcription_jobs' AND column_name = 'grouping_threshold_used'
  ) THEN
    ALTER TABLE transcription_jobs ADD COLUMN grouping_threshold_used float8;
  END IF;
END $$;
