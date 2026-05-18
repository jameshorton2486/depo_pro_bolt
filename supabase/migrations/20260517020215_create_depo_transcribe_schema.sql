/*
  # Depo-Transcribe Schema

  ## Overview
  Core schema for Depo-Transcribe, a legal transcript production application.

  ## Tables

  ### reporters
  Court reporter profiles used for certificates and metadata.
  - id, name, csr_number, credentials, firm, address, phone, email, expiration_date

  ### cases
  Deposition case records with all legal metadata.
  - cause_number, plaintiff, defendant, case_style, court_type, county, state, judicial_district
  - deposition_date, witness_name, location, method, defense_attorney fields, billing fields

  ### transcription_jobs
  Tracks each transcription run including status, model, and deepgram configuration.
  - links to case, tracks file path, deepgram model, processing mode, status, progress

  ### utterances
  Word-level and segment-level transcript data from Deepgram.
  - speaker_id, start_time, end_time, transcript text, confidence, word-level JSON

  ### speaker_mappings
  Maps Deepgram speaker IDs to named legal participants per job.
  - speaker_id (0,1,2...), mapped_name, confidence_pct

  ### template_configs
  Per-case template and block toggle configuration.

  ## Security
  RLS enabled on all tables. Policies allow authenticated users to manage their own data.
  For this single-user reporter application, policies allow all authenticated users full access.
*/

-- Reporters table
CREATE TABLE IF NOT EXISTS reporters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  csr_number text NOT NULL DEFAULT '',
  credentials text NOT NULL DEFAULT '',
  firm text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  expiration_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE reporters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can select reporters"
  ON reporters FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert reporters"
  ON reporters FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update reporters"
  ON reporters FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete reporters"
  ON reporters FOR DELETE
  TO authenticated
  USING (true);

-- Also allow anon for demo purposes (single-user app)
CREATE POLICY "Anon users can select reporters"
  ON reporters FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon users can insert reporters"
  ON reporters FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon users can update reporters"
  ON reporters FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon users can delete reporters"
  ON reporters FOR DELETE
  TO anon
  USING (true);

-- Cases table
CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cause_number text NOT NULL DEFAULT '',
  plaintiff text NOT NULL DEFAULT '',
  defendant text NOT NULL DEFAULT '',
  case_style text NOT NULL DEFAULT '',
  court_type text NOT NULL DEFAULT 'DISTRICT COURT',
  county text NOT NULL DEFAULT '',
  state_name text NOT NULL DEFAULT 'Texas',
  judicial_district text NOT NULL DEFAULT '',
  deposition_date date,
  scheduled_start_time text NOT NULL DEFAULT '',
  location_name text NOT NULL DEFAULT '',
  method text NOT NULL DEFAULT '',
  witness_full_name text NOT NULL DEFAULT '',
  defense_attorney text NOT NULL DEFAULT '',
  state_bar_no text NOT NULL DEFAULT '',
  firm_name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  represents text NOT NULL DEFAULT '',
  ordered_by text NOT NULL DEFAULT '',
  ordering_firm text NOT NULL DEFAULT '',
  reporter_id uuid REFERENCES reporters(id),
  case_folder text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon users can select cases"
  ON cases FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can insert cases"
  ON cases FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon users can update cases"
  ON cases FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon users can delete cases"
  ON cases FOR DELETE TO anon USING (true);

CREATE POLICY "Authenticated users can select cases"
  ON cases FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert cases"
  ON cases FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update cases"
  ON cases FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete cases"
  ON cases FOR DELETE TO authenticated USING (true);

-- Transcription jobs table
CREATE TABLE IF NOT EXISTS transcription_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES cases(id),
  status text NOT NULL DEFAULT 'pending',
  model text NOT NULL DEFAULT 'nova-3',
  processing_mode text NOT NULL DEFAULT 'ENHANCED (Dual Pass)',
  source_file_name text NOT NULL DEFAULT '',
  source_file_path text NOT NULL DEFAULT '',
  storage_path text NOT NULL DEFAULT '',
  progress integer NOT NULL DEFAULT 0,
  phase text NOT NULL DEFAULT 'Idle',
  error_message text,
  raw_deepgram_json jsonb,
  word_count integer DEFAULT 0,
  low_confidence_count integer DEFAULT 0,
  duration_seconds numeric DEFAULT 0,
  logs jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE transcription_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon users can select jobs"
  ON transcription_jobs FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can insert jobs"
  ON transcription_jobs FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon users can update jobs"
  ON transcription_jobs FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon users can delete jobs"
  ON transcription_jobs FOR DELETE TO anon USING (true);

CREATE POLICY "Authenticated users can select jobs"
  ON transcription_jobs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert jobs"
  ON transcription_jobs FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update jobs"
  ON transcription_jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete jobs"
  ON transcription_jobs FOR DELETE TO authenticated USING (true);

-- Utterances table
CREATE TABLE IF NOT EXISTS utterances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  speaker_id integer NOT NULL DEFAULT 0,
  start_time numeric NOT NULL DEFAULT 0,
  end_time numeric NOT NULL DEFAULT 0,
  transcript text NOT NULL DEFAULT '',
  confidence numeric NOT NULL DEFAULT 0,
  words jsonb DEFAULT '[]'::jsonb,
  sequence_index integer NOT NULL DEFAULT 0,
  reviewed boolean NOT NULL DEFAULT false,
  corrected_transcript text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE utterances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon users can select utterances"
  ON utterances FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can insert utterances"
  ON utterances FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon users can update utterances"
  ON utterances FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon users can delete utterances"
  ON utterances FOR DELETE TO anon USING (true);

CREATE POLICY "Authenticated users can select utterances"
  ON utterances FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert utterances"
  ON utterances FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update utterances"
  ON utterances FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete utterances"
  ON utterances FOR DELETE TO authenticated USING (true);

-- Speaker mappings table
CREATE TABLE IF NOT EXISTS speaker_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  speaker_id integer NOT NULL DEFAULT 0,
  mapped_name text NOT NULL DEFAULT '',
  confidence_pct integer NOT NULL DEFAULT 0,
  quick_fills jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(job_id, speaker_id)
);

ALTER TABLE speaker_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon users can select speaker_mappings"
  ON speaker_mappings FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can insert speaker_mappings"
  ON speaker_mappings FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon users can update speaker_mappings"
  ON speaker_mappings FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon users can delete speaker_mappings"
  ON speaker_mappings FOR DELETE TO anon USING (true);

CREATE POLICY "Authenticated users can select speaker_mappings"
  ON speaker_mappings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert speaker_mappings"
  ON speaker_mappings FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update speaker_mappings"
  ON speaker_mappings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete speaker_mappings"
  ON speaker_mappings FOR DELETE TO authenticated USING (true);

-- Template configs table
CREATE TABLE IF NOT EXISTS template_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES cases(id) ON DELETE CASCADE UNIQUE,
  active_templates jsonb NOT NULL DEFAULT '{"titlePageTexas":true,"titlePageFederal":false,"appearances":true,"indexChronological":true}'::jsonb,
  block_toggles jsonb NOT NULL DEFAULT '{"block_subpoena_duces_tecum":false,"block_videotaped":true,"block_remote":true,"block_volume":false,"block_also_present":true,"block_credentials_suffix":true,"block_firm_signature_block":true}'::jsonb,
  manual_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE template_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon users can select template_configs"
  ON template_configs FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can insert template_configs"
  ON template_configs FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon users can update template_configs"
  ON template_configs FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon users can delete template_configs"
  ON template_configs FOR DELETE TO anon USING (true);

CREATE POLICY "Authenticated users can select template_configs"
  ON template_configs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert template_configs"
  ON template_configs FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update template_configs"
  ON template_configs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete template_configs"
  ON template_configs FOR DELETE TO authenticated USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_case_id ON transcription_jobs(case_id);
CREATE INDEX IF NOT EXISTS idx_utterances_job_id ON utterances(job_id);
CREATE INDEX IF NOT EXISTS idx_utterances_sequence ON utterances(job_id, sequence_index);
CREATE INDEX IF NOT EXISTS idx_speaker_mappings_job_id ON speaker_mappings(job_id);

-- Seed default reporters
INSERT INTO reporters (name, csr_number, credentials, firm, address, phone, email, expiration_date)
VALUES
  ('Miah Bardot', '12129', 'CSR, RPR', 'SA Legal', '7234 Hovingham, San Antonio, Texas 78257', '469 740-9603', 'ilovemycourtreporter@gmail.com', '2026-06-30'),
  ('David Miller', '14285', 'CSR, CRR, FCRR', 'Lone Star Reporting', '900 Congress Ave, Austin, Texas 78701', '512 555-0199', 'david.miller@lonestarreporting.com', '2027-11-15')
ON CONFLICT DO NOTHING;
