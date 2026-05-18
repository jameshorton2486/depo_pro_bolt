/*
  # Transcript Diff System

  Implements structured transcript diff tracking and versioning for legal deposition transcripts.

  ## New Tables

  ### transcript_versions
  Immutable snapshots of each transcript stage. Every time a transcript advances to a new
  stage (raw → grouped → deterministic → ai_suggested → approved → exported), a version
  record is written. This preserves the full, auditable lineage.

  Columns:
  - id: UUID primary key
  - job_id: FK to transcription_jobs
  - stage: enum stage name (raw | grouped | deterministic | ai_suggested | approved | exported)
  - version_number: monotonically increasing integer per job
  - utterances_snapshot: JSONB array — full frozen copy of utterances at this stage
  - word_count: word count at this stage
  - created_by: 'system' | 'ai' | user identifier
  - notes: optional human annotation
  - created_at: timestamp

  ### transcript_diffs
  Structured diff records between two transcript versions. Each row captures one word-level
  or utterance-level change between a source and target stage.

  Columns:
  - id: UUID primary key
  - job_id: FK to transcription_jobs
  - source_version_id: FK to transcript_versions (the "before")
  - target_version_id: FK to transcript_versions (the "after")
  - source_stage: stage label of the source version
  - target_stage: stage label of the target version
  - utterance_id: the utterance this change belongs to (nullable for structural changes)
  - change_type: enum (insert | delete | modify | speaker_change | punctuation | confidence_change)
  - original_text: text before change
  - modified_text: text after change
  - speaker_id: speaker attribution (before)
  - new_speaker_id: for speaker_change type
  - start_time: timestamp of the affected region
  - end_time: end of the affected region
  - confidence: word/utterance confidence at time of diff
  - change_source: 'deterministic' | 'ai' | 'human' | 'system'
  - ai_rationale: reasoning if change_source = 'ai'
  - ai_risk_level: 'low' | 'medium' | 'high' | 'critical' for AI changes
  - review_status: 'pending' | 'approved' | 'rejected'
  - created_at

  ### diff_reviews
  Append-only audit log of every reviewer decision on a diff item.

  Columns:
  - id: UUID primary key
  - diff_id: FK to transcript_diffs
  - job_id: FK to transcription_jobs
  - action: 'approve' | 'reject' | 'flag' | 'comment'
  - reviewer_note: optional free-text
  - previous_status: status before this action
  - new_status: status after this action
  - created_at

  ## Security
  - RLS enabled on all three tables
  - Authenticated users can manage records for their own jobs
*/

-- ── transcript_versions ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transcript_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid NOT NULL REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  stage               text NOT NULL CHECK (stage IN ('raw','grouped','deterministic','ai_suggested','approved','exported')),
  version_number      integer NOT NULL DEFAULT 1,
  utterances_snapshot jsonb NOT NULL DEFAULT '[]',
  word_count          integer NOT NULL DEFAULT 0,
  created_by          text NOT NULL DEFAULT 'system',
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcript_versions_job_id  ON transcript_versions(job_id);
CREATE INDEX IF NOT EXISTS idx_transcript_versions_stage   ON transcript_versions(job_id, stage);

ALTER TABLE transcript_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert transcript versions"
  ON transcript_versions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM transcription_jobs WHERE id = job_id)
  );

CREATE POLICY "Authenticated users can select transcript versions"
  ON transcript_versions FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM transcription_jobs WHERE id = job_id)
  );

-- ── transcript_diffs ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transcript_diffs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            uuid NOT NULL REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  source_version_id uuid REFERENCES transcript_versions(id) ON DELETE SET NULL,
  target_version_id uuid REFERENCES transcript_versions(id) ON DELETE SET NULL,
  source_stage      text NOT NULL,
  target_stage      text NOT NULL,
  utterance_id      uuid REFERENCES utterances(id) ON DELETE SET NULL,
  change_type       text NOT NULL CHECK (change_type IN (
    'insert','delete','modify','speaker_change','punctuation','confidence_change','no_change'
  )),
  original_text     text,
  modified_text     text,
  speaker_id        integer,
  new_speaker_id    integer,
  start_time        double precision,
  end_time          double precision,
  confidence        double precision,
  change_source     text NOT NULL DEFAULT 'system' CHECK (change_source IN ('deterministic','ai','human','system')),
  ai_rationale      text,
  ai_risk_level     text CHECK (ai_risk_level IN ('low','medium','high','critical')),
  review_status     text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcript_diffs_job_id          ON transcript_diffs(job_id);
CREATE INDEX IF NOT EXISTS idx_transcript_diffs_utterance_id    ON transcript_diffs(utterance_id);
CREATE INDEX IF NOT EXISTS idx_transcript_diffs_change_type     ON transcript_diffs(job_id, change_type);
CREATE INDEX IF NOT EXISTS idx_transcript_diffs_review_status   ON transcript_diffs(job_id, review_status);
CREATE INDEX IF NOT EXISTS idx_transcript_diffs_source_target   ON transcript_diffs(job_id, source_stage, target_stage);

ALTER TABLE transcript_diffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert transcript diffs"
  ON transcript_diffs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM transcription_jobs WHERE id = job_id)
  );

CREATE POLICY "Authenticated users can select transcript diffs"
  ON transcript_diffs FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM transcription_jobs WHERE id = job_id)
  );

CREATE POLICY "Authenticated users can update transcript diffs"
  ON transcript_diffs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM transcription_jobs WHERE id = job_id))
  WITH CHECK (EXISTS (SELECT 1 FROM transcription_jobs WHERE id = job_id));

-- ── diff_reviews ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS diff_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diff_id         uuid NOT NULL REFERENCES transcript_diffs(id) ON DELETE CASCADE,
  job_id          uuid NOT NULL REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  action          text NOT NULL CHECK (action IN ('approve','reject','flag','comment')),
  reviewer_note   text,
  previous_status text,
  new_status      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diff_reviews_diff_id ON diff_reviews(diff_id);
CREATE INDEX IF NOT EXISTS idx_diff_reviews_job_id  ON diff_reviews(job_id);

ALTER TABLE diff_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert diff reviews"
  ON diff_reviews FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM transcription_jobs WHERE id = job_id)
  );

CREATE POLICY "Authenticated users can select diff reviews"
  ON diff_reviews FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM transcription_jobs WHERE id = job_id)
  );
