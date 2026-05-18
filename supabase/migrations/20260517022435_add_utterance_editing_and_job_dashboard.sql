/*
  # Utterance Editing, Correction History, and Job Dashboard Support

  ## Summary
  Upgrades the utterances table to a full structured "utterance-object" architecture
  supporting in-UI editing, review workflows, and persistent correction history.

  ## Changes

  ### 1. utterances table — new columns
  - `edited` (boolean): marks whether the utterance text has been manually corrected
  - `review_state` (text): workflow state — 'unreviewed' | 'reviewed' | 'flagged' | 'approved'
  - `edited_at` (timestamptz): timestamp of last manual edit
  - `original_transcript` (text): immutable copy of raw Deepgram text, preserved on first edit

  ### 2. utterance_corrections table (new)
  Full audit trail for every correction made to an utterance.
  - `id` (uuid, pk)
  - `utterance_id` (uuid, fk → utterances)
  - `job_id` (uuid, fk → transcription_jobs)
  - `previous_text` (text): text before this correction
  - `corrected_text` (text): text after this correction
  - `previous_speaker_id` (int): speaker before reassignment (null if no change)
  - `new_speaker_id` (int): speaker after reassignment (null if no change)
  - `correction_type` (text): 'text_edit' | 'speaker_reassign' | 'review_state_change'
  - `created_at` (timestamptz)

  ### 3. transcription_jobs table — new columns
  - `export_count` (integer): number of times exported
  - `last_exported_at` (timestamptz): timestamp of last export
  - `transcript_version` (integer): increments on each save/finalization

  ## Security
  - RLS enabled on utterance_corrections with same anon+authenticated open policies
    (single-user reporter application)
  - Indexes added for fast lookup by utterance_id and job_id
*/

-- Add editing columns to utterances
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'utterances' AND column_name = 'edited'
  ) THEN
    ALTER TABLE utterances ADD COLUMN edited boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'utterances' AND column_name = 'review_state'
  ) THEN
    ALTER TABLE utterances ADD COLUMN review_state text NOT NULL DEFAULT 'unreviewed';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'utterances' AND column_name = 'edited_at'
  ) THEN
    ALTER TABLE utterances ADD COLUMN edited_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'utterances' AND column_name = 'original_transcript'
  ) THEN
    ALTER TABLE utterances ADD COLUMN original_transcript text;
  END IF;
END $$;

-- Add dashboard columns to transcription_jobs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcription_jobs' AND column_name = 'export_count'
  ) THEN
    ALTER TABLE transcription_jobs ADD COLUMN export_count integer NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcription_jobs' AND column_name = 'last_exported_at'
  ) THEN
    ALTER TABLE transcription_jobs ADD COLUMN last_exported_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcription_jobs' AND column_name = 'transcript_version'
  ) THEN
    ALTER TABLE transcription_jobs ADD COLUMN transcript_version integer NOT NULL DEFAULT 1;
  END IF;
END $$;

-- Utterance corrections audit trail table
CREATE TABLE IF NOT EXISTS utterance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utterance_id uuid NOT NULL REFERENCES utterances(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  previous_text text NOT NULL DEFAULT '',
  corrected_text text NOT NULL DEFAULT '',
  previous_speaker_id integer,
  new_speaker_id integer,
  correction_type text NOT NULL DEFAULT 'text_edit',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE utterance_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon users can select utterance_corrections"
  ON utterance_corrections FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can insert utterance_corrections"
  ON utterance_corrections FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon users can update utterance_corrections"
  ON utterance_corrections FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon users can delete utterance_corrections"
  ON utterance_corrections FOR DELETE TO anon USING (true);

CREATE POLICY "Authenticated users can select utterance_corrections"
  ON utterance_corrections FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert utterance_corrections"
  ON utterance_corrections FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update utterance_corrections"
  ON utterance_corrections FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete utterance_corrections"
  ON utterance_corrections FOR DELETE TO authenticated USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_utterance_corrections_utterance_id ON utterance_corrections(utterance_id);
CREATE INDEX IF NOT EXISTS idx_utterance_corrections_job_id ON utterance_corrections(job_id);
CREATE INDEX IF NOT EXISTS idx_utterances_review_state ON utterances(job_id, review_state);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_status ON transcription_jobs(status, created_at DESC);
