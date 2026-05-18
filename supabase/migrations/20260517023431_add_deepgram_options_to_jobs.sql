/*
  # Add deepgram_options to transcription_jobs

  ## Summary
  Adds a JSONB column to store all Deepgram API options configured at job creation time.
  This persists the exact parameters sent to Deepgram so jobs are reproducible and auditable.

  ## Changes

  ### transcription_jobs — new column
  - `deepgram_options` (jsonb): stores smart_format, diarize, punctuate, paragraphs,
    utterances, filler_words, numerals, keyterms, utt_split, and any future options
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcription_jobs' AND column_name = 'deepgram_options'
  ) THEN
    ALTER TABLE transcription_jobs ADD COLUMN deepgram_options jsonb NOT NULL DEFAULT '{
      "smart_format": true,
      "diarize": true,
      "punctuate": true,
      "paragraphs": true,
      "utterances": true,
      "filler_words": true,
      "numerals": true,
      "utt_split": 0.8,
      "keyterms": []
    }'::jsonb;
  END IF;
END $$;
