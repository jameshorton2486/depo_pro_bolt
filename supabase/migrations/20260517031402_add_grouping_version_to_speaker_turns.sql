/*
  # Add grouping_version to speaker_turns

  ## Summary
  Adds a grouping_version column to speaker_turns so that re-runs of the
  grouping pass with different heuristics (threshold changes, logic changes)
  can be tracked and compared without overwriting prior results.

  This supports regression comparison: query WHERE grouping_version = N to
  isolate turns produced by a specific version of the grouper.

  ## Changes
  - speaker_turns: add `grouping_version` (integer, default 1)

  ## Notes
  - Version 1 = initial implementation (gap threshold 1.2s, speaker-change-only splits)
  - Increment this constant in the edge function when grouping logic changes
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'speaker_turns' AND column_name = 'grouping_version'
  ) THEN
    ALTER TABLE speaker_turns ADD COLUMN grouping_version integer NOT NULL DEFAULT 1;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_speaker_turns_grouping_version
  ON speaker_turns(job_id, grouping_version);
