/*
  # Add deterministic_correction type to utterance_corrections

  ## Summary
  Adds 'deterministic_correction' as a valid correction_type in the
  utterance_corrections table. This supports the Stage 1 deterministic
  rule engine (corrections.ts) which auto-applies structural, formatting,
  and STT-substitution corrections before human review.

  ## Changes
  - utterance_corrections.correction_type: adds 'deterministic_correction'
    to the allowed enum values

  ## Notes
  The existing check constraint is dropped and recreated to include the
  new value. No data is altered. No tables are added or removed.
*/

DO $$
BEGIN
  -- Drop the existing check constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'utterance_corrections'
      AND column_name = 'correction_type'
  ) THEN
    ALTER TABLE utterance_corrections
      DROP CONSTRAINT IF EXISTS utterance_corrections_correction_type_check;
  END IF;

  -- Re-add the check constraint with the new value included
  ALTER TABLE utterance_corrections
    ADD CONSTRAINT utterance_corrections_correction_type_check
    CHECK (correction_type IN (
      'text_edit',
      'speaker_reassign',
      'review_state_change',
      'deterministic_correction'
    ));
END $$;
