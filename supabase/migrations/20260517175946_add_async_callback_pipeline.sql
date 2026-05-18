/*
  # Async Deepgram Callback Pipeline

  Adds the data model needed to submit each uploaded audio part to Deepgram as a
  separate async job and stitch the resulting transcripts when all parts finish.

  ## Changes

  ### New Table: transcript_parts
  One row per uploaded audio part per job. Holds Deepgram request_id, status,
  raw JSON result, and reported duration. The callback function uses this table
  to track which parts have landed and trigger finalization when all are complete.

  Columns:
  - id: UUID primary key
  - job_id: FK to transcription_jobs
  - part_index: 0-based ordering of this part in the multi-file upload
  - storage_path: Supabase storage path for this part
  - deepgram_request_id: returned by Deepgram on async submission
  - status: submitted | complete | failed
  - raw_result: full Deepgram JSON response (JSONB)
  - duration_seconds: Deepgram-reported duration for this part
  - error_message: set when status = 'failed'
  - submitted_at / completed_at: timestamps

  ### Modified: transcription_jobs
  - parts_total: how many parts were submitted (default 1)
  - parts_completed: how many callbacks have landed (default 0)

  ### Modified: utterances
  - part_index: which audio part this utterance came from (default 0)

  ### Modified: speaker_mappings
  - part_index: which part this speaker was detected in (default 0)

  ## Security
  - RLS enabled on transcript_parts
  - Mirrors existing policy style (anon + authenticated full access for single-user app)
*/

-- ---------------------------------------------------------------------------
-- transcript_parts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transcript_parts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               uuid NOT NULL REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  part_index           integer NOT NULL,
  storage_path         text NOT NULL,
  deepgram_request_id  text,
  status               text NOT NULL DEFAULT 'submitted'
                         CHECK (status IN ('submitted', 'complete', 'failed')),
  raw_result           jsonb,
  duration_seconds     numeric DEFAULT 0,
  error_message        text,
  submitted_at         timestamptz DEFAULT now(),
  completed_at         timestamptz,
  UNIQUE (job_id, part_index)
);

CREATE INDEX IF NOT EXISTS transcript_parts_job_id_idx
  ON transcript_parts(job_id);

ALTER TABLE transcript_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon select transcript_parts"
  ON transcript_parts FOR SELECT TO anon USING (true);
CREATE POLICY "Anon insert transcript_parts"
  ON transcript_parts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon update transcript_parts"
  ON transcript_parts FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon delete transcript_parts"
  ON transcript_parts FOR DELETE TO anon USING (true);
CREATE POLICY "Auth select transcript_parts"
  ON transcript_parts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert transcript_parts"
  ON transcript_parts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update transcript_parts"
  ON transcript_parts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete transcript_parts"
  ON transcript_parts FOR DELETE TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- transcription_jobs: add part counters
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcription_jobs' AND column_name = 'parts_total'
  ) THEN
    ALTER TABLE transcription_jobs ADD COLUMN parts_total integer NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcription_jobs' AND column_name = 'parts_completed'
  ) THEN
    ALTER TABLE transcription_jobs ADD COLUMN parts_completed integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- utterances: add part_index for multi-part jobs
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'utterances' AND column_name = 'part_index'
  ) THEN
    ALTER TABLE utterances ADD COLUMN part_index integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- speaker_mappings: add part_index for multi-part jobs
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'speaker_mappings' AND column_name = 'part_index'
  ) THEN
    ALTER TABLE speaker_mappings ADD COLUMN part_index integer NOT NULL DEFAULT 0;
  END IF;
END $$;
