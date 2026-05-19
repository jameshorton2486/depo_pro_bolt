// ============================================================================
// intake.ts — shared type definitions for case intake, NOD parsing, and UFM
// ============================================================================

export interface CaseInfo {
  causeNumber: string;
  caseStyle: string;
  plaintiff: string;
  defendant: string;
  courtType: string;
  court: string;
  district: string;
  division: string;
  county: string;
  state: string;
}

export interface VideographerInfo {
  name: string;
  company: string;
  phone: string;
  email: string;
}

export interface InterpreterInfo {
  name: string;
  language: string;
  company: string;
  phone: string;
  email: string;
}

export interface DeponentInfo {
  name: string;
  role: string; // e.g. "Witness", "Plaintiff", "Defendant"
}

export interface DepositionDetails {
  deponent: DeponentInfo;
  date: string;
  time: string;
  location: string;
  method: 'in-person' | 'zoom' | 'hybrid' | '';
  isZoom: boolean;
  noticeTitle: string;
}

export interface AttorneyAppearance {
  side: 'Plaintiff' | 'Defendant' | 'Other';
  attorneyName: string;
  stateBarNo?: string;
  firmName: string;
  address: string;
  phone: string;
  fax?: string;
  email: string;
  represents: string;
}

export interface ReporterInfo {
  reporterName: string;
  csrNumber: string;
  agency: string;
  certifications: string[];
}

export interface CopyOrder {
  attorneyName: string;
  firmName: string;
  address: string;
  phone: string;
  email: string;
  format: string[];      // ['Original', 'E-Trans', 'Hard Copy']
  delivery: string;      // 'Standard' | 'Rush'
  rushDue?: string;
  copy: boolean;
}

export interface BillingInfo {
  orderingAttorney: string;
  orderingFirm: string;
  orderingAddress: string;
  orderingPhone: string;
  orderingEmail: string;
  format: string[];
  delivery: string;
  rushDue?: string;
  orderedBy?: string;
  copyOrders: CopyOrder[];
}

export interface ReporterJobDetails {
  reporter: ReporterInfo;
  date: string;
  scheduledStartTime: string;
  location: string;
  csr: boolean;
  appearance?: string;
  cna?: string;
  readAndSign?: boolean;
  signatureWaived?: boolean;
  sendTo?: string;
  videoMedTech?: string;
  pages?: string;
  exhibitCount?: string;
  bw?: string;
  color?: string;
  interpreter: boolean;
  conferenceRoom: boolean;
  travelMiles?: string;
  parking?: string;
  notes?: string;
}

export interface PhoneticMapping {
  phonetic: string;  // how Deepgram might hear it
  correct: string;   // correct spelling
}

export interface ParsedNOD {
  caseInfo: CaseInfo;
  depositionDetails: DepositionDetails;
  appearances: AttorneyAppearance[];
  reporterInfo: Partial<ReporterInfo>;
  deepgramKeyterms: string[];
  confirmedSpellings: string[];
  phoneticMappings: PhoneticMapping[];
  rawText: string;
}

export interface ParsedReporterNotes {
  reporter: ReporterInfo;
  jobDetails: ReporterJobDetails;
  billing: BillingInfo;
  deepgramKeyterms: string[];
}

export interface IntakeRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  caseInfo: CaseInfo;
  depositionDetails: DepositionDetails;
  appearances: AttorneyAppearance[];
  reporterJobDetails: Partial<ReporterJobDetails>;
  billing: Partial<BillingInfo>;
  videographer?: Partial<VideographerInfo>;
  interpreter?: Partial<InterpreterInfo>;
  deepgramKeyterms: string[];
  confirmedSpellings: string[];
  phoneticMappings: PhoneticMapping[];
  nodSource?: string;     // filename of uploaded NOD
  notesSource?: string;   // filename of uploaded reporter notes
  linkedJobId?: string;   // ID of the transcription job if already run
}
