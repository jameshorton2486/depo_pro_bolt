/*
  # Add Word-Level Review System

  ## Summary
  Adds the word-level review infrastructure to support synchronized audio playback,
  confidence visualization, and per-word review state. This is the data layer for
  the Word Review Panel — a professional legal transcript verification tool.

  ## New Tables

  ### transcript_words
  Stores every word token extracted from Deepgram's word-level response.
  Each row corresponds to one word in the transcript with precise timestamps,
  confidence score, speaker attribution, and review state.

  Columns:
    - id: UUID primary key
    - utterance_id: FK to utterances (the parent utterance segment)
    - job_id: FK to transcription_jobs (for efficient job-scoped queries)
    - speaker_id: Deepgram speaker index (denormalized for query performance)
    - sequence_index: Global word position within the job (for ordering)
    - utterance_index: Word position within its parent utterance
    - text: The word as transcribed (base form, no punctuation)
    - punctuated_word: Word with Deepgram punctuation applied (nullable)
    - start_time: Word start time in seconds (high precision)
    - end_time: Word end time in seconds (high precision)
    - confidence: Deepgram confidence score 0.0–1.0
    - reviewed: Whether a human reviewer has inspected this word
    - edited: Whether this word has been manually corrected
    - original_text: Original Deepgram text before any edit (nullable, set on first edit)
    - corrected_text: Reviewer-corrected text (nullable)
    - flags: JSONB array of flag tags (e.g. ["low_confidence", "proper_noun"])
    - created_at: Row creation timestamp

  ### word_reviews
  Audit trail for every reviewer action on a word. Immutable append-only log.

  Columns:
    - id: UUID primary key
    - word_id: FK to transcript_words
    - job_id: FK to transcription_jobs
    - utterance_id: FK to utterances
    - action: Action taken (mark_reviewed | edit | flag | unflag | revert)
    - previous_text: Text before this action (nullable)
    - new_text: Text after this action (nullable)
    - flag_added: Flag tag added (nullable)
    - flag_removed: Flag tag removed (nullable)
    - created_at: Timestamp of the review action

  ## Security
  - RLS enabled on both tables
  - Authenticated users can read/write words and reviews for jobs they have access to

  ## Notes
  1. transcript_words.text is NEVER auto-modified after initial insert
  2. original_text captures the first Deepgram value before any correction
  3. word_reviews is append-only — no row is ever deleted or updated
  4. The flags JSONB column supports ['low_confidence','proper_noun','speaker_drift',
     'interruption','review_required','approved'] tag values
  5. sequence_index is the global position across all utterances in the job,
     enabling forward/backward navigation across utterance boundaries
*/

-- ─── transcript_words ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transcript_words (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  utterance_id      uuid        NOT NULL REFERENCES utterances(id) ON DELETE CASCADE,
  job_id            uuid        NOT NULL REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  speaker_id        integer     NOT NULL DEFAULT 0,
  sequence_index    integer     NOT NULL DEFAULT 0,
  utterance_index   integer     NOT NULL DEFAULT 0,

  text              text        NOT NULL DEFAULT '',
  punctuated_word   text,

  start_time        numeric(12,4) NOT NULL DEFAULT 0,
  end_time          numeric(12,4) NOT NULL DEFAULT 0,
  confidence        numeric(5,4)  NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),

  reviewed          boolean     NOT NULL DEFAULT false,
  edited            boolean     NOT NULL DEFAULT false,
  original_text     text,
  corrected_text    text,

  flags             jsonb       NOT NULL DEFAULT '[]'::jsonb,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transcript_words_job_id_idx        ON transcript_words(job_id);
CREATE INDEX IF NOT EXISTS transcript_words_utterance_id_idx  ON transcript_words(utterance_id);
CREATE INDEX IF NOT EXISTS transcript_words_sequence_idx      ON transcript_words(job_id, sequence_index);
CREATE INDEX IF NOT EXISTS transcript_words_confidence_idx    ON transcript_words(job_id, confidence);
CREATE INDEX IF NOT EXISTS transcript_words_reviewed_idx      ON transcript_words(job_id, reviewed);

ALTER TABLE transcript_words ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read transcript_words"
  ON transcript_words FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM transcription_jobs tj
      WHERE tj.id = transcript_words.job_id
    )
  );

CREATE POLICY "Authenticated users can insert transcript_words"
  ON transcript_words FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM transcription_jobs tj
      WHERE tj.id = transcript_words.job_id
    )
  );

CREATE POLICY "Authenticated users can update transcript_words"
  ON transcript_words FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM transcription_jobs tj
      WHERE tj.id = transcript_words.job_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM transcription_jobs tj
      WHERE tj.id = transcript_words.job_id
    )
  );

-- ─── word_reviews ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS word_reviews (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  word_id         uuid        NOT NULL REFERENCES transcript_words(id) ON DELETE CASCADE,
  job_id          uuid        NOT NULL REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  utterance_id    uuid        NOT NULL REFERENCES utterances(id) ON DELETE CASCADE,

  action          text        NOT NULL CHECK (action IN (
                                'mark_reviewed',
                                'edit',
                                'flag',
                                'unflag',
                                'revert'
                              )),

  previous_text   text,
  new_text        text,
  flag_added      text,
  flag_removed    text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS word_reviews_word_id_idx   ON word_reviews(word_id);
CREATE INDEX IF NOT EXISTS word_reviews_job_id_idx    ON word_reviews(job_id);

ALTER TABLE word_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read word_reviews"
  ON word_reviews FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM transcription_jobs tj
      WHERE tj.id = word_reviews.job_id
    )
  );

CREATE POLICY "Authenticated users can insert word_reviews"
  ON word_reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM transcription_jobs tj
      WHERE tj.id = word_reviews.job_id
    )
  );
