export interface TranscriptPart {
  id: string;
  job_id: string;
  part_index: number;
  storage_path: string;
  deepgram_request_id: string | null;
  status: 'submitted' | 'complete' | 'failed';
  raw_result: unknown | null;
  duration_seconds: number;
  error_message: string | null;
  submitted_at: string;
  completed_at: string | null;
}

export interface TranscriptDiff {
  id: string;
  job_id: string;
  source_version_id: string | null;
  target_version_id: string | null;
  source_stage: string;
  target_stage: string;
  utterance_id: string | null;
  change_type: 'insert' | 'delete' | 'modify' | 'speaker_change' | 'punctuation' | 'confidence_change' | 'no_change';
  original_text: string | null;
  modified_text: string | null;
  speaker_id: number | null;
  new_speaker_id: number | null;
  start_time: number | null;
  end_time: number | null;
  confidence: number | null;
  change_source: 'deterministic' | 'ai' | 'human' | 'system';
  ai_rationale: string | null;
  ai_risk_level: 'low' | 'medium' | 'high' | 'critical' | null;
  review_status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface DiffReview {
  id: string;
  diff_id: string;
  job_id: string;
  action: 'approve' | 'reject' | 'flag' | 'comment';
  reviewer_note: string | null;
  previous_status: string | null;
  new_status: string | null;
  created_at: string;
}

export interface TranscriptVersionRow {
  id: string;
  job_id: string;
  stage: 'raw' | 'grouped' | 'deterministic' | 'ai_suggested' | 'approved' | 'exported';
  version_number: number;
  utterances_snapshot: unknown;
  word_count: number;
  created_by: string;
  notes: string | null;
  created_at: string;
}

// Converts an interface to a homomorphic mapped type so supabase-js generic
// constraints resolve correctly. Interfaces used directly as Row types can
// fail conditional type checks inside postgrest's Insert/Update overloads.
type Expand<T> = { [K in keyof T]: T[K] };

export interface SpeakerTurn {
  id: string;
  job_id: string;
  speaker_id: number;
  start_time: number;
  end_time: number;
  joined_text: string;
  confidence: number;
  sequence_index: number;
  member_count: number;
  source_utterance_ids: string[];
  member_utterances: unknown;
  grouping_meta: unknown;
  grouping_version: number;
  created_at: string;
}

export interface Database {
  public: {
    Views: Record<never, never>;
    Functions: {
      increment_parts_completed: {
        Args: { p_job_id: string };
        Returns: { parts_completed: number; parts_total: number }[];
      };
    };
    Tables: {
      transcript_parts: {
        Row: Expand<TranscriptPart>;
        Insert: Partial<Omit<TranscriptPart, 'id' | 'submitted_at'>>;
        Update: Partial<Omit<TranscriptPart, 'id' | 'submitted_at'>>;
        Relationships: never[];
      };
      transcript_versions: {
        Row: Expand<TranscriptVersionRow>;
        Insert: Partial<Omit<TranscriptVersionRow, 'id' | 'created_at' | 'version_number'>>;
        Update: Partial<Omit<TranscriptVersionRow, 'id' | 'created_at'>>;
        Relationships: never[];
      };
      transcript_diffs: {
        Row: Expand<TranscriptDiff>;
        Insert: Partial<Omit<TranscriptDiff, 'id' | 'created_at'>>;
        Update: Partial<Omit<TranscriptDiff, 'id' | 'created_at'>>;
        Relationships: never[];
      };
      diff_reviews: {
        Row: Expand<DiffReview>;
        Insert: Partial<Omit<DiffReview, 'id' | 'created_at'>>;
        Update: Partial<Omit<DiffReview, 'id' | 'created_at'>>;
        Relationships: never[];
      };
      transcript_words: {
        Row: Expand<TranscriptWord>;
        Insert: Partial<Omit<TranscriptWord, 'id' | 'created_at'>>;
        Update: Partial<Omit<TranscriptWord, 'id' | 'created_at'>>;
        Relationships: never[];
      };
      word_reviews: {
        Row: Expand<WordReview>;
        Insert: Partial<Omit<WordReview, 'id' | 'created_at'>>;
        Update: Partial<Omit<WordReview, 'id' | 'created_at'>>;
        Relationships: never[];
      };
      reporters: {
        Row: Expand<Reporter>;
        Insert: Partial<Omit<Reporter, 'id' | 'created_at' | 'updated_at'>>;
        Update: Partial<Omit<Reporter, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: never[];
      };
      cases: {
        Row: Expand<Case>;
        Insert: Partial<Omit<Case, 'id' | 'created_at' | 'updated_at'>>;
        Update: Partial<Omit<Case, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: never[];
      };
      transcription_jobs: {
        Row: Expand<TranscriptionJob>;
        Insert: Partial<Omit<TranscriptionJob, 'id' | 'created_at' | 'updated_at'>>;
        Update: Partial<Omit<TranscriptionJob, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: never[];
      };
      utterances: {
        Row: Expand<Utterance>;
        Insert: Partial<Omit<Utterance, 'id' | 'created_at'>>;
        Update: Partial<Omit<Utterance, 'id' | 'created_at'>>;
        Relationships: never[];
      };
      speaker_mappings: {
        Row: Expand<SpeakerMapping>;
        Insert: Partial<Omit<SpeakerMapping, 'id' | 'created_at' | 'updated_at'>>;
        Update: Partial<Omit<SpeakerMapping, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: never[];
      };
      speaker_turns: {
        Row: Expand<SpeakerTurn>;
        Insert: Partial<Omit<SpeakerTurn, 'id' | 'created_at'>>;
        Update: Partial<Omit<SpeakerTurn, 'id' | 'created_at'>>;
        Relationships: never[];
      };
      template_configs: {
        Row: Expand<TemplateConfig>;
        Insert: Partial<Omit<TemplateConfig, 'id' | 'created_at' | 'updated_at'>>;
        Update: Partial<Omit<TemplateConfig, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: never[];
      };
      utterance_corrections: {
        Row: Expand<UtteranceCorrection>;
        Insert: Partial<Omit<UtteranceCorrection, 'id' | 'created_at'>>;
        Update: Partial<Omit<UtteranceCorrection, 'id' | 'created_at'>>;
        Relationships: never[];
      };
      ai_suggestions: {
        Row: Expand<AiSuggestion>;
        Insert: Partial<Omit<AiSuggestion, 'id' | 'created_at'>>;
        Update: Partial<Omit<AiSuggestion, 'id' | 'created_at'>>;
        Relationships: never[];
      };
    };
  };
}

export interface Reporter {
  id: string;
  name: string;
  csr_number: string;
  credentials: string;
  firm: string;
  address: string;
  phone: string;
  email: string;
  expiration_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Case {
  id: string;
  cause_number: string;
  plaintiff: string;
  defendant: string;
  case_style: string;
  court_type: string;
  county: string;
  state_name: string;
  judicial_district: string;
  deposition_date: string | null;
  scheduled_start_time: string;
  location_name: string;
  method: string;
  witness_full_name: string;
  defense_attorney: string;
  state_bar_no: string;
  firm_name: string;
  address: string;
  phone: string;
  represents: string;
  ordered_by: string;
  ordering_firm: string;
  reporter_id: string | null;
  case_folder: string;
  created_at: string;
  updated_at: string;
}

export interface DeepgramOptions {
  smart_format: boolean;
  diarize: boolean;
  punctuate: boolean;
  paragraphs: boolean;
  utterances: boolean;
  filler_words: boolean;
  numerals: boolean;
  utt_split: number;
  keyterms: string[];
}

export type AiReviewState = 'not_reviewed' | 'pending' | 'has_suggestion' | 'accepted' | 'rejected' | 'skipped';

export interface TranscriptionJob {
  id: string;
  case_id: string | null;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  model: string;
  processing_mode: string;
  source_file_name: string;
  source_file_path: string;
  storage_path: string;
  progress: number;
  phase: string;
  error_message: string | null;
  raw_deepgram_json: Record<string, unknown> | null;
  word_count: number;
  low_confidence_count: number;
  duration_seconds: number;
  logs: string[];
  export_count: number;
  last_exported_at: string | null;
  transcript_version: number;
  deepgram_options: DeepgramOptions;
  parts_total: number;
  parts_completed: number;
  created_at: string;
  updated_at: string;
}

export interface Utterance {
  id: string;
  job_id: string;
  speaker_id: number;
  start_time: number;
  end_time: number;
  transcript: string;
  confidence: number;
  words: WordToken[];
  sequence_index: number;
  reviewed: boolean;
  corrected_transcript: string | null;
  edited: boolean;
  edited_at: string | null;
  review_state: 'unreviewed' | 'reviewed' | 'flagged' | 'approved';
  original_transcript: string | null;
  ai_review_state: AiReviewState;
  ai_reviewed_transcript: string | null;
  part_index: number;
  created_at: string;
}

export interface UtteranceCorrection {
  id: string;
  utterance_id: string;
  job_id: string;
  previous_text: string;
  corrected_text: string;
  previous_speaker_id: number | null;
  new_speaker_id: number | null;
  correction_type: 'text_edit' | 'speaker_reassign' | 'review_state_change' | 'deterministic_correction' | 'ai_suggestion_accepted' | 'ai_suggestion_rejected';
  created_at: string;
}

export type AiSuggestionCategory =
  | 'punctuation'
  | 'sentence_boundary'
  | 'speaker_drift'
  | 'proper_noun'
  | 'interruption'
  | 'low_confidence'
  | 'fragment'
  | 'review_required';

export type AiReviewStatus = 'pending' | 'accepted' | 'rejected' | 'edited';

export interface AiSuggestion {
  id: string;
  utterance_id: string;
  job_id: string;
  source_text: string;
  suggested_text: string;
  category: AiSuggestionCategory;
  reason: string;
  confidence: number;
  has_change: boolean;
  review_status: AiReviewStatus;
  human_edited_text: string | null;
  model_used: string;
  review_run_id: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface WordToken {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
  punctuated_word?: string;
}

export interface SpeakerMapping {
  id: string;
  job_id: string;
  speaker_id: number;
  mapped_name: string;
  confidence_pct: number;
  quick_fills: string[];
  part_index: number;
  created_at: string;
  updated_at: string;
}

// ─── Word-level review system ─────────────────────────────────────────────────

export type WordFlag =
  | 'low_confidence'
  | 'proper_noun'
  | 'speaker_drift'
  | 'interruption'
  | 'review_required'
  | 'approved';

export type WordReviewAction = 'mark_reviewed' | 'edit' | 'flag' | 'unflag' | 'revert';

export interface TranscriptWord {
  id: string;
  utterance_id: string;
  job_id: string;
  speaker_id: number;
  sequence_index: number;
  utterance_index: number;
  text: string;
  punctuated_word: string | null;
  start_time: number;
  end_time: number;
  confidence: number;
  reviewed: boolean;
  edited: boolean;
  original_text: string | null;
  corrected_text: string | null;
  flags: WordFlag[];
  created_at: string;
}

export interface WordReview {
  id: string;
  word_id: string;
  job_id: string;
  utterance_id: string;
  action: WordReviewAction;
  previous_text: string | null;
  new_text: string | null;
  flag_added: string | null;
  flag_removed: string | null;
  created_at: string;
}

// Confidence threshold constants — used across review components
export const CONFIDENCE_HIGH = 0.85;
export const CONFIDENCE_MED  = 0.70;
export const CONFIDENCE_LOW  = 0.50;

export type ConfidenceTier = 'high' | 'medium' | 'low' | 'critical';

export function getConfidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= CONFIDENCE_HIGH) return 'high';
  if (confidence >= CONFIDENCE_MED)  return 'medium';
  if (confidence >= CONFIDENCE_LOW)  return 'low';
  return 'critical';
}

export interface TemplateConfig {
  id: string;
  case_id: string;
  active_templates: {
    titlePageTexas: boolean;
    titlePageFederal: boolean;
    appearances: boolean;
    indexChronological: boolean;
  };
  block_toggles: Record<string, boolean>;
  manual_fields: Record<string, string>;
  created_at: string;
  updated_at: string;
}
