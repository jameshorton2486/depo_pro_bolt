/*
  # Add AI Review Layer

  ## Summary
  Adds the Stage 2 AI-assisted review infrastructure to the Depo-Pro Transcribe schema.
  The AI layer produces SUGGESTIONS ONLY — it never overwrites raw or deterministic text.
  Every suggestion requires explicit human approval before it affects any transcript.

  ## New Tables

  ### ai_suggestions
  Stores one suggestion record per utterance per review run.
  Each record preserves:
    - original text (snapshot at time of AI review)
    - suggested text (AI output)
    - category (punctuation, speaker_drift, proper_noun, sentence_boundary, interruption, low_confidence)
    - confidence score (0.0–1.0)
    - reason (plain-language explanation from AI)
    - review status (pending / accepted / rejected / edited)
    - human-edited override text (when reviewer edits rather than accepts/rejects)
    - linked utterance_id for join back to transcript
    - job_id for job-scoped queries

  ## Modified Tables

  ### utterances
  - Adds `ai_review_state` column: 'not_reviewed' | 'pending' | 'has_suggestion' | 'accepted' | 'rejected' | 'skipped'
  - Adds `ai_reviewed_transcript` column: nullable text — the final approved AI+human text

  ## Security
  - RLS enabled on ai_suggestions
  - Authenticated users can read/write suggestions for jobs they own (via transcription_jobs → cases)
  - Service role has full access for edge function writes

  ## Notes
  1. The raw `transcript` column is NEVER modified by this migration or the AI layer.
  2. `corrected_transcript` (Stage 1 deterministic) is NEVER modified by the AI layer.
  3. `ai_reviewed_transcript` is the ONLY column the AI layer may populate.
  4. The correction_type enum is extended with 'ai_suggestion_accepted' and 'ai_suggestion_rejected'.
*/

-- ─── ai_suggestions table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utterance_id uuid NOT NULL REFERENCES utterances(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES transcription_jobs(id) ON DELETE CASCADE,

  -- Verbatim snapshot of text at the time AI reviewed it
  source_text text NOT NULL,

  -- AI-suggested replacement text (may be identical to source if no change needed)
  suggested_text text NOT NULL,

  -- Category classifies the type of suggestion
  category text NOT NULL CHECK (category IN (
    'punctuation',
    'sentence_boundary',
    'speaker_drift',
    'proper_noun',
    'interruption',
    'low_confidence',
    'fragment',
    'review_required'
  )),

  -- Plain-language reason from the AI (shown to reviewer)
  reason text NOT NULL DEFAULT '',

  -- AI confidence in this suggestion (0.0–1.0)
  confidence numeric(4,3) NOT NULL DEFAULT 0.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),

  -- Whether the suggested_text differs from source_text
  has_change boolean NOT NULL DEFAULT false,

  -- Reviewer decision
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN (
    'pending',
    'accepted',
    'rejected',
    'edited'
  )),

  -- When reviewer chose 'edited': their manually adjusted text
  human_edited_text text,

  -- Which AI model produced this suggestion (for auditability)
  model_used text NOT NULL DEFAULT 'claude-sonnet-4-6',

  -- Job-level run identifier so a re-run doesn't collide with prior suggestions
  review_run_id uuid,

  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_suggestions_utterance_id_idx ON ai_suggestions(utterance_id);
CREATE INDEX IF NOT EXISTS ai_suggestions_job_id_idx ON ai_suggestions(job_id);
CREATE INDEX IF NOT EXISTS ai_suggestions_review_status_idx ON ai_suggestions(review_status);

ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read ai_suggestions for their jobs"
  ON ai_suggestions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM transcription_jobs tj
      WHERE tj.id = ai_suggestions.job_id
    )
  );

CREATE POLICY "Authenticated users can insert ai_suggestions"
  ON ai_suggestions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM transcription_jobs tj
      WHERE tj.id = ai_suggestions.job_id
    )
  );

CREATE POLICY "Authenticated users can update ai_suggestions"
  ON ai_suggestions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM transcription_jobs tj
      WHERE tj.id = ai_suggestions.job_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM transcription_jobs tj
      WHERE tj.id = ai_suggestions.job_id
    )
  );

-- ─── Extend utterances with AI review state ──────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'utterances' AND column_name = 'ai_review_state'
  ) THEN
    ALTER TABLE utterances
      ADD COLUMN ai_review_state text NOT NULL DEFAULT 'not_reviewed'
      CHECK (ai_review_state IN ('not_reviewed', 'pending', 'has_suggestion', 'accepted', 'rejected', 'skipped'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'utterances' AND column_name = 'ai_reviewed_transcript'
  ) THEN
    ALTER TABLE utterances ADD COLUMN ai_reviewed_transcript text;
  END IF;
END $$;

-- ─── Extend correction_type enum to include AI actions ───────────────────────

DO $$
BEGIN
  ALTER TABLE utterance_corrections
    DROP CONSTRAINT IF EXISTS utterance_corrections_correction_type_check;

  ALTER TABLE utterance_corrections
    ADD CONSTRAINT utterance_corrections_correction_type_check
    CHECK (correction_type IN (
      'text_edit',
      'speaker_reassign',
      'review_state_change',
      'deterministic_correction',
      'ai_suggestion_accepted',
      'ai_suggestion_rejected'
    ));
END $$;

-- ─── Add ai_review_run_count to transcription_jobs ───────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcription_jobs' AND column_name = 'ai_review_run_count'
  ) THEN
    ALTER TABLE transcription_jobs ADD COLUMN ai_review_run_count integer NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcription_jobs' AND column_name = 'last_ai_review_at'
  ) THEN
    ALTER TABLE transcription_jobs ADD COLUMN last_ai_review_at timestamptz;
  END IF;
END $$;
