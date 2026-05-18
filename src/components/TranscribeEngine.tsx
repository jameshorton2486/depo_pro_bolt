import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as tus from 'tus-js-client';
import { Icons } from './Icons';
import { supabase } from '../lib/supabase';
import type { Case, Reporter, TranscriptionJob, Utterance, SpeakerMapping, DeepgramOptions } from '../lib/database.types';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
import { batchCorrect } from '../lib/corrections';

interface SpeakerTurnPreview {
  speaker_id: number;
  sample_texts: string[];
  turn_count: number;
  total_duration: number;
}
import TranscriptEditor from './TranscriptEditor';

interface TranscribeEngineProps {
  caseData: Partial<Case>;
  reporters: Reporter[];
  onNavigateCaseIntake: () => void;
  initialJob?: TranscriptionJob | null;
}

type Step = 1 | 2 | 3 | 4;

const ACCEPTED_TYPES = [
  'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/x-flac',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/x-aac',
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'application/octet-stream',
];

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

interface TusUploadResult {
  ok: boolean;
  durationMs: number;
  bytesUploaded: number;
  finalUrl: string;
  errorMessage?: string;
}


function tusUpload(
  supabaseUrl: string,
  bearerToken: string,
  bucketName: string,
  objectPath: string,
  file: File,
  onProgress: (percent: number, bytesUploaded: number, bytesTotal: number) => void,
): Promise<TusUploadResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const upload = new tus.Upload(file, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${bearerToken}`,
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName,
        objectName: objectPath,
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
      },
      chunkSize: 6 * 1024 * 1024, // 6 MB — required by Supabase TUS implementation
      onError: (err) => {
        resolve({
          ok: false,
          durationMs: Date.now() - startTime,
          bytesUploaded: 0,
          finalUrl: '',
          errorMessage: `TUS error: ${err.message || String(err)}`,
        });
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        if (bytesTotal > 0) {
          const percent = Math.round((bytesUploaded / bytesTotal) * 100);
          onProgress(percent, bytesUploaded, bytesTotal);
        }
      },
      onSuccess: () => {
        resolve({
          ok: true,
          durationMs: Date.now() - startTime,
          bytesUploaded: file.size,
          finalUrl: upload.url ?? '',
          errorMessage: undefined,
        });
      },
    });

    // Start fresh — do not resume any previous attempt for this path
    upload.findPreviousUploads().then(() => {
      upload.start();
    }).catch(() => {
      upload.start();
    });
  });
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 100);
  if (h > 0) return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}.${ms.toString().padStart(2,'0')}`;
}

export default function TranscribeEngine({ caseData, reporters, onNavigateCaseIntake, initialJob }: TranscribeEngineProps) {
  const [step, setStep] = useState<Step>(1);
  const [model, setModel] = useState('nova-3');
  const [processingMode, setProcessingMode] = useState('ENHANCED (Dual Pass)');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [deepgramOptions, setDeepgramOptions] = useState<DeepgramOptions>({
    smart_format: true,
    diarize: true,
    punctuate: true,
    paragraphs: true,
    utterances: true,
    filler_words: true,
    numerals: true,
    utt_split: 0.8,
    keyterms: [],
  });
  const [keytermInput, setKeytermInput] = useState('');
  const [notesText, setNotesText] = useState('');
  const [confirmedSpellings, setConfirmedSpellings] = useState<string[]>([]);
  const [docFiles, setDocFiles] = useState<{ name: string; text: string }[]>([]);
  const [docParsing, setDocParsing] = useState(false);
  // Terms suggested by the AI layer — tracked separately so chips can show provenance
  const [aiKeyterms, setAiKeyterms] = useState<Set<string>>(new Set());
  // Phonetic mappings (spoken -> written) returned by AI — displayed as a distinct list
  const [phoneticMappings, setPhoneticMappings] = useState<string[]>([]);
  const [aiEnhancing, setAiEnhancing] = useState(false);
  const docFileInputRef = useRef<HTMLInputElement>(null);

  const [job, setJob] = useState<TranscriptionJob | null>(null);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [speakerMappings, setSpeakerMappings] = useState<SpeakerMapping[]>([]);
  const [speakerPreviews, setSpeakerPreviews] = useState<SpeakerTurnPreview[]>([]);
  const [loadingPreviews, setLoadingPreviews] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [, setJobStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' }[]>([]);
  const toastCounterRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentReporter = reporters.find(r => r.id === caseData.reporter_id);

  const dismissToast = (id: number) =>
    setToasts(prev => prev.filter(t => t.id !== id));

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastCounterRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    const duration = type === 'error' ? 14000 : 8000;
    setTimeout(() => dismissToast(id), duration);
  };

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // Auto-run Stage 1 deterministic corrections on freshly-loaded utterances.
  // Runs silently in the background after job completion — never blocks the UI.
  // Each changed utterance is written to DB and logged for audit.
  const autoRunCorrections = async (
    uttData: Utterance[],
    jobId: string,
  ): Promise<Utterance[]> => {
    const items = uttData.map(u => ({ id: u.id, text: u.corrected_transcript ?? u.transcript }));
    const changed = batchCorrect(items);
    if (changed.length === 0) return uttData;

    const now = new Date().toISOString();
    await Promise.all(
      changed.map(async ({ id, original, corrected }) => {
        const utt = uttData.find(u => u.id === id)!;
        await supabase.from('utterances').update({
          corrected_transcript: corrected,
          edited: true,
          edited_at: now,
          original_transcript: utt.original_transcript ?? utt.transcript,
        }).eq('id', id);
        await supabase.from('utterance_corrections').insert({
          utterance_id: id,
          job_id: jobId,
          previous_text: original,
          corrected_text: corrected,
          correction_type: 'deterministic_correction',
          previous_speaker_id: null,
          new_speaker_id: null,
        });
      })
    );

    const changedMap = new Map(changed.map(c => [c.id, c.corrected]));
    const updatedUtterances = uttData.map(u =>
      changedMap.has(u.id)
        ? { ...u, corrected_transcript: changedMap.get(u.id)!, edited: true, edited_at: now, original_transcript: u.original_transcript ?? u.transcript }
        : u
    );

    addLog(`[STAGE1] Auto-applied ${changed.length} deterministic format correction${changed.length !== 1 ? 's' : ''} (Q/A labels, speaker labels, punctuation, objections, parentheticals)`);
    return updatedUtterances;
  };

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Poll job status during processing
  const startPolling = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('transcription_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();

      if (!data) return;
      setJob(data as TranscriptionJob);

      if (Array.isArray(data.logs)) {
        setLogs(data.logs as string[]);
      }

      // Stale detection — warn if no DB update in 10 min while still processing
      const updatedAt = (data as TranscriptionJob & { updated_at?: string }).updated_at;
      if (updatedAt && data.status === 'processing') {
        const ageMs = Date.now() - new Date(updatedAt).getTime();
        if (ageMs > 10 * 60 * 1000) {
          const ageMin = Math.round(ageMs / 60000);
          const lastWarnKey = `stale-warn-${jobId}`;
          const lastWarnAt = (window as unknown as Record<string, number>)[lastWarnKey] ?? 0;
          if (Date.now() - lastWarnAt > 5 * 60 * 1000) {
            addLog(`[STALE] Job has been in phase "${data.phase}" for ${ageMin} minutes with no updates — check edge function logs`);
            console.warn(`[STALE] Job ${jobId} stuck in phase "${data.phase}" for ${ageMin} min`);
            (window as unknown as Record<string, number>)[lastWarnKey] = Date.now();
          }
        }
      }

      if (data.status === 'complete') {
        clearInterval(pollRef.current!);
        stopElapsedTimer();
        setStep(3);
        // Fetch utterances and speaker mappings
        const [{ data: utteranceData }, { data: mappingData }] = await Promise.all([
          supabase.from('utterances').select('*').eq('job_id', jobId).order('sequence_index'),
          supabase.from('speaker_mappings').select('*').eq('job_id', jobId).order('speaker_id'),
        ]);
        if (mappingData) setSpeakerMappings(mappingData as SpeakerMapping[]);
        if (utteranceData) {
          const corrected = await autoRunCorrections(utteranceData as Utterance[], jobId);
          setUtterances(corrected);
        }
        notify('Transcription complete. Proceed to speaker labeling.');
      } else if (data.status === 'failed') {
        clearInterval(pollRef.current!);
        stopElapsedTimer();
        notify(data.error_message ?? 'Transcription failed.', 'error');
        setStep(1);
        setUploading(false);
      }
    }, 2000);
  }, []);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
  }, []);

  const startElapsedTimer = () => {
    const start = Date.now();
    setJobStartedAt(start);
    setElapsed(0);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
  };

  const stopElapsedTimer = () => {
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
  };

  // Reopen a completed job from the dashboard
  useEffect(() => {
    if (!initialJob || initialJob.status !== 'complete') return;
    (async () => {
      setJob(initialJob);
      setStep(4);
      const [{ data: uttData }, { data: mapData }] = await Promise.all([
        supabase.from('utterances').select('*').eq('job_id', initialJob.id).order('sequence_index'),
        supabase.from('speaker_mappings').select('*').eq('job_id', initialJob.id).order('speaker_id'),
      ]);
      if (uttData) setUtterances(uttData as Utterance[]);
      if (mapData) setSpeakerMappings(mapData as SpeakerMapping[]);
    })();
  }, [initialJob]);

  const setOption = <K extends keyof DeepgramOptions>(key: K, val: DeepgramOptions[K]) => {
    setDeepgramOptions(prev => ({ ...prev, [key]: val }));
  };

  const addKeyterm = (term: string) => {
    const t = term.trim();
    if (!t) return;
    setDeepgramOptions(prev => ({
      ...prev,
      keyterms: prev.keyterms.includes(t) ? prev.keyterms : [...prev.keyterms, t],
    }));
  };

  const removeKeyterm = (term: string) => {
    setDeepgramOptions(prev => ({ ...prev, keyterms: prev.keyterms.filter(k => k !== term) }));
  };


  const extractStructuredNodTerms = (text: string) => {
    if (!text.trim()) return;

    // Credential / honorific suffixes to strip from person names before
    // extracting the surname chip.
    const CREDENTIAL_SUFFIX = /\s*,?\s*\b(?:Esq\.?|Jr\.?|Sr\.?|II|III|IV|V|M\.D\.?|Ph\.?D\.?|J\.D\.?|R\.N\.?|D\.O\.?|D\.C\.?|LCSW|LPC|CPA|P\.E\.?)\b.*$/i;

    // Entity suffixes that mark firm names.
    const ENTITY_SUFFIX = /\b(?:P\.?L\.?L\.?C\.?|P\.?C\.?|L\.?L\.?C\.?|L\.?L\.?P\.?|Inc\.?|Corp\.?|Ltd\.?|PLLC|LLC|LLP)\b/i;

    // Common words that appear in firm names but are never surnames.
    const NOT_A_SURNAME = new Set([
      'law','firm','legal','group','office','offices','associates','partners',
      'partners','services','solutions','management','consulting','advisors',
      'brain','spine','personal','injury','lawyers','attorneys','counselors',
      'professional','national','international','american','texas','san','antonio',
      'notice','take','oral','further','given','record','submitted','respectfully',
      'please','thank','also','all','any','each','every','more','most',
      'this','that','these','those','pursuant','accordance','herein','thereof',
      'wherein','whereas','therefore','plaintiff','defendant','petitioner',
      'respondent','court','district','division','county','state','united','states',
    ]);

    const surnames = new Map<string, string>(); // lowercase → display form
    const spellings = new Map<string, string>(); // lowercase → full string

    const addSurname = (raw: string) => {
      // Strip credentials, punctuation tails
      const name = raw.trim()
        .replace(CREDENTIAL_SUFFIX, '')
        .replace(/[^A-Za-z\s'-]/g, '')
        .trim();
      if (name.length < 2) return;
      const words = name.split(/\s+/);
      const surname = words[words.length - 1];
      if (surname.length < 2) return;
      const key = surname.toLowerCase();
      if (NOT_A_SURNAME.has(key)) return;
      // Prefer mixed-case over ALL-CAPS
      const existing = surnames.get(key);
      const isBetter = !existing || (existing === existing.toUpperCase() && surname !== surname.toUpperCase());
      if (isBetter) surnames.set(key, surname);
      // Full name goes to confirmed spellings
      const fullKey = name.toLowerCase();
      const fullExisting = spellings.get(fullKey);
      const fullIsBetter = !fullExisting || (fullExisting === fullExisting.toUpperCase() && name !== name.toUpperCase());
      if (fullIsBetter) spellings.set(fullKey, name);
    };

    const addFirmSpelling = (raw: string) => {
      const cleaned = raw.trim().replace(/\s+/g, ' ').replace(/[^A-Za-z0-9\s&',.-]/g, '').trim();
      if (cleaned.length < 4) return;
      const key = cleaned.toLowerCase();
      const existing = spellings.get(key);
      if (!existing || (existing === existing.toUpperCase() && cleaned !== cleaned.toUpperCase())) {
        spellings.set(key, cleaned);
      }
      // Extract the last all-caps or Title-case word of the firm as a surname chip
      // e.g. "Cukjati Law Firm, PLLC" → "Cukjati"
      const nameWithoutSuffix = cleaned.replace(ENTITY_SUFFIX, '').replace(/,\s*$/, '').trim();
      const firmWords = nameWithoutSuffix.split(/\s+/);
      // Walk backward to find the first non-noise proper word
      for (let i = firmWords.length - 1; i >= 0; i--) {
        const w = firmWords[i].replace(/[^A-Za-z]/g, '');
        if (w.length >= 3 && !NOT_A_SURNAME.has(w.toLowerCase()) && /^[A-Z]/.test(firmWords[i])) {
          const key2 = w.toLowerCase();
          const existing2 = surnames.get(key2);
          const display = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
          if (!existing2) surnames.set(key2, display);
          break;
        }
      }
    };

    // ── Pass 1: Witness / deponent name ──────────────────────────────────
    // "NOTICE TO TAKE ... DEPOSITION OF [NAME]"
    // "deposition of [Name]"
    const witnessPatterns: RegExp[] = [
      /(?:deposition|examination|testimony)\s+of\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4})/gi,
      /(?:deponent|witness)\s*[:–—]\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/gi,
      /notice\s+to\s+take[^,\n]{0,80},?\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})/gi,
    ];
    for (const re of witnessPatterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) addSurname(m[1]);
    }

    // ── Pass 2: Attorney names — anchored to bar numbers and signatures ───
    // "State Bar No." / "Bar No." / "/s/ NAME" / "By: /s/ NAME"
    const attorneyPatterns: RegExp[] = [
      /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s*\n[^\n]{0,80}(?:State\s+Bar|Bar\s+No\.?|SBN)\s*[:#]?\s*\d/gi,
      /\/s\/\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})/gi,
      /^BY:\s*(?:\/s\/)?\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})/gim,
    ];
    for (const re of attorneyPatterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) addSurname(m[1]);
    }

    // ── Pass 3: Firm names — anchored to entity suffixes ─────────────────
    const firmPattern = /([A-Z][A-Za-z0-9.&',\s-]{3,80}?)\s*,?\s*(?:P\.?L\.?L\.?C\.?|P\.?C\.?|L\.?L\.?C\.?|L\.?L\.?P\.?|PLLC|LLC|LLP|Inc\.?|Corp\.?)\b/g;
    firmPattern.lastIndex = 0;
    let fm: RegExpExecArray | null;
    while ((fm = firmPattern.exec(text)) !== null) {
      const full = fm[0].trim().replace(/\s+/g, ' ');
      if (full.split(/\s+/).length >= 2) addFirmSpelling(full);
    }

    // ── Pass 4: Defendant / plaintiff names from case caption ─────────────
    // "Plaintiff DELIA GARZA" / "Defendant HOME DEPOT U.S.A., INC."
    // We want the human party names (not corporate defendants — those are
    // already caught by firmPattern above).
    const partyPattern = /(?:plaintiff|defendant|petitioner|respondent)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})/gi;
    partyPattern.lastIndex = 0;
    let pm: RegExpExecArray | null;
    while ((pm = partyPattern.exec(text)) !== null) {
      const candidate = pm[1].trim();
      // Skip if it looks like a firm (contains entity suffix)
      if (!ENTITY_SUFFIX.test(candidate)) addSurname(candidate);
    }

    // ── Merge into chip list, dedup against existing ──────────────────────
    const newSurnames = [...surnames.values()]
      .filter(t => !deepgramOptions.keyterms.some(k => k.toLowerCase() === t.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const newSpellings = [...spellings.values()]
      .filter(s => !confirmedSpellings.some(c => c.toLowerCase() === s.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    if (newSurnames.length > 0) {
      setDeepgramOptions(prev => ({ ...prev, keyterms: [...prev.keyterms, ...newSurnames] }));
    }
    if (newSpellings.length > 0) {
      setConfirmedSpellings(prev => [...prev, ...newSpellings]);
    }

    const total = newSurnames.length + newSpellings.length;
    if (total > 0) {
      notify(`Parsed ${newSurnames.length} surname${newSurnames.length !== 1 ? 's' : ''}, ${newSpellings.length} full spelling${newSpellings.length !== 1 ? 's' : ''}.`);
    } else {
      notify('No new terms found in the document.', 'error');
    }
  };

  const handleAiEnhance = async () => {
    const text = notesText.trim() || docFiles.map(f => f.text).join('\n\n').trim();
    if (!text) {
      notify('Paste or upload a NOD first, then click Enhance with AI.', 'error');
      return;
    }
    setAiEnhancing(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/enhance-keyterms`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documentText: text }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`AI enhance failed (${res.status}): ${errText.slice(0, 200)}`);
      }
      const { keywords }: { keywords: string[] } = await res.json();

      // Split into two buckets:
      //   phonetic mappings: contain " -> "
      //   keyterms: everything else (strip optional :N boost for display but keep for API)
      const newMappings: string[] = [];
      const newTerms: string[] = [];
      for (const kw of keywords) {
        if (kw.includes(' -> ')) {
          newMappings.push(kw);
        } else {
          newTerms.push(kw);
        }
      }

      // Merge keyterms — deduplicate case-insensitively
      const existingLower = new Set(deepgramOptions.keyterms.map(k => k.toLowerCase()));
      const freshTerms = newTerms.filter(t => {
        // Strip boost suffix for dedup check: "Cukjati:3" → "cukjati"
        const bare = t.replace(/:\d+$/, '').trim().toLowerCase();
        return !existingLower.has(bare) && !existingLower.has(t.toLowerCase());
      });

      if (freshTerms.length > 0) {
        setAiKeyterms(prev => {
          const next = new Set(prev);
          for (const t of freshTerms) next.add(t);
          return next;
        });
        setDeepgramOptions(prev => ({ ...prev, keyterms: [...prev.keyterms, ...freshTerms] }));
      }

      // Merge phonetic mappings
      const existingMappingsLower = new Set(phoneticMappings.map(m => m.toLowerCase()));
      const freshMappings = newMappings.filter(m => !existingMappingsLower.has(m.toLowerCase()));
      if (freshMappings.length > 0) {
        setPhoneticMappings(prev => [...prev, ...freshMappings]);
        // Phonetic mappings are NOT sent to Deepgram — handled by post-transcription
        // correction layer (batchCorrect). Deepgram has no "if you hear X write Y" concept.
      }

      const total = freshTerms.length + freshMappings.length;
      if (total > 0) {
        notify(`AI added ${freshTerms.length} term${freshTerms.length !== 1 ? 's' : ''}, ${freshMappings.length} phonetic mapping${freshMappings.length !== 1 ? 's' : ''}.`);
      } else {
        notify('AI found no new terms beyond what was already parsed.');
      }
    } catch (err) {
      notify(String(err), 'error');
    } finally {
      setAiEnhancing(false);
    }
  };

  /** Extract plain text from a TXT, DOCX, or PDF file. */
  const extractTextFromFile = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const name = file.name.toLowerCase();

      if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv')) {
        const reader = new FileReader();
        reader.onload = e => resolve((e.target?.result as string) ?? '');
        reader.onerror = reject;
        reader.readAsText(file);
        return;
      }

      if (name.endsWith('.docx') || name.endsWith('.doc')) {
        // DOCX is a ZIP; extract text nodes from word/document.xml using a simple regex
        const reader = new FileReader();
        reader.onload = e => {
          try {
            const ab = e.target?.result as ArrayBuffer;
            // Convert ArrayBuffer to binary string for zip traversal
            const bytes = new Uint8Array(ab);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

            // Find the PK local file entry for "word/document.xml"
            const docXmlStart = binary.indexOf('word/document.xml');
            if (docXmlStart === -1) { resolve(''); return; }

            // The compressed data begins a few bytes after the filename in the local header
            // Walk forward to find the actual XML — look for the <?xml or <w:document marker
            const searchFrom = docXmlStart + 20;
            const xmlMarker = binary.indexOf('<w:', searchFrom);
            if (xmlMarker === -1) { resolve(''); return; }

            // Grab a generous chunk after the marker (document.xml can be large)
            const chunk = binary.slice(xmlMarker, xmlMarker + 500000);
            // Strip all XML tags, leaving only text content
            const text = chunk
              .replace(/<w:br[^>]*\/>/g, '\n')
              .replace(/<w:p[ >][^>]*>/g, '\n')
              .replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&apos;/g, "'")
              .replace(/\r?\n{3,}/g, '\n\n')
              .trim();
            resolve(text);
          } catch {
            resolve('');
          }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
        return;
      }

      if (name.endsWith('.pdf')) {
        const reader = new FileReader();
        reader.onload = async e => {
          try {
            const ab = e.target?.result as ArrayBuffer;
            const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
            const pages: string[] = [];
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const content = await page.getTextContent();
              const pageText = content.items
                .map((item: unknown) => (item as { str: string }).str)
                .join(' ');
              pages.push(pageText);
            }
            resolve(pages.join('\n\n'));
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
        return;
      }

      // Fallback: try reading as text
      const reader = new FileReader();
      reader.onload = e => resolve((e.target?.result as string) ?? '');
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const handleDocFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setDocParsing(true);
    const results: { name: string; text: string }[] = [];
    let combinedText = '';
    for (const file of Array.from(files)) {
      try {
        const text = await extractTextFromFile(file);
        results.push({ name: file.name, text });
        combinedText += '\n\n' + text;
      } catch {
        notify(`Could not read ${file.name}`, 'error');
      }
    }
    setDocFiles(prev => [...prev, ...results]);
    setDocParsing(false);
    if (combinedText.trim()) {
      extractStructuredNodTerms(combinedText);
      setNotesText(prev => prev ? prev + '\n\n' + combinedText.trim() : combinedText.trim());
    }
  };

  const removeDocFile = (name: string) => {
    setDocFiles(prev => prev.filter(f => f.name !== name));
  };

  const isValidAudioFile = (file: File) =>
    ACCEPTED_TYPES.includes(file.type) || !!file.name.match(/\.(mp3|mp4|wav|flac|m4a|mov|avi|aac)$/i);

  const addFiles = (incoming: File[]) => {
    const valid = incoming.filter(f => {
      if (!isValidAudioFile(f)) {
        notify(`Unsupported file: ${f.name}`, 'error');
        return false;
      }
      return true;
    });
    if (valid.length === 0) return;
    setSelectedFiles(prev => [...prev, ...valid]);
  };

  const removeFile = (idx: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const moveFile = (idx: number, dir: -1 | 1) => {
    setSelectedFiles(prev => {
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) addFiles(files);
  };

  const handleStartTranscription = async () => {
    if (selectedFiles.length === 0) {
      notify('Please select at least one audio or video file.', 'error');
      return;
    }

    setUploading(true);
    setLogs([]);
    setStep(2);
    setUploadProgress(0);

    const jobScopeId = crypto.randomUUID();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const combinedName = selectedFiles.length === 1
      ? selectedFiles[0].name
      : `${selectedFiles[0].name} + ${selectedFiles.length - 1} more`;

    // -----------------------------------------------------------------------
    // Step 1 — Create the job row BEFORE anything else so failures are tracked
    // -----------------------------------------------------------------------
    let newJobId = '';
    try {
      const { data: jobData, error: jobError } = await supabase
        .from('transcription_jobs')
        .insert({
          case_id: caseData.id ?? null,
          status: 'pending',
          model,
          processing_mode: processingMode,
          source_file_name: combinedName,
          source_file_path: combinedName,
          storage_path: '',
          progress: 0,
          phase: 'Preparing...',
          logs: [],
          deepgram_options: deepgramOptions,
        })
        .select()
        .maybeSingle();

      if (jobError || !jobData) throw new Error(`Failed to create job record: ${jobError?.message}`);
      newJobId = jobData.id as string;
      setJob(jobData as TranscriptionJob);
    } catch (err) {
      notify(`Could not create job: ${String(err)}`, 'error');
      setUploading(false);
      setStep(1);
      return;
    }

    // -----------------------------------------------------------------------
    // persistLog — writes a timestamped line to both local state and the DB job
    // row so failure logs are visible in the inspector even if the tab crashes.
    // -----------------------------------------------------------------------
    const persistedLogs: string[] = [];
    const persistLog = async (line: string) => {
      const stamped = `[${new Date().toLocaleTimeString()}] ${line}`;
      persistedLogs.push(stamped);
      addLog(line);
      await supabase
        .from('transcription_jobs')
        .update({ logs: [...persistedLogs] })
        .eq('id', newJobId);
    };

    const failAndStop = async (errMsg: string) => {
      console.error('[TranscribeEngine] Fatal:', errMsg);
      await persistLog(`[ERROR] ${errMsg}`);
      await supabase
        .from('transcription_jobs')
        .update({ status: 'failed', phase: 'Failed', error_message: errMsg, logs: persistedLogs })
        .eq('id', newJobId);
      notify(errMsg, 'error');
      setUploading(false);
      setStep(1);
    };

    // -----------------------------------------------------------------------
    // Step 2 — Prepare files for direct Deepgram upload (no compression).
    //          Audio goes browser → Deepgram directly, bypassing Supabase Storage
    //          on the critical path. Deepgram accepts up to 2 GB per request.
    // -----------------------------------------------------------------------
    const uploadFiles: File[] = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const rawFile = selectedFiles[i];
      const partLabel = selectedFiles.length > 1 ? ` (part ${i + 1}/${selectedFiles.length})` : '';
      await persistLog(`[UPLOAD] Preparing${partLabel}: ${rawFile.name} — ${formatFileSize(rawFile.size)}`);
      uploadFiles.push(rawFile);
      setUploadProgress(Math.round(((i + 1) / selectedFiles.length) * 10));
    }

    // -----------------------------------------------------------------------
    // Step 3 — Get a short-lived Deepgram JWT + per-part callback URLs
    //          from the edge function. This is a fast call (<1s).
    // -----------------------------------------------------------------------
    let tempKey = '';
    let partCallbackUrls: string[] = [];
    let baseDeepgramUrl = '';
    let ttlSeconds = 600;

    await persistLog(`[TOKEN] Requesting Deepgram JWT from edge function...`);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const prepRes = await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token ?? anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobId: newJobId,
          partsCount: uploadFiles.length,
          model,
          deepgramOptions,
        }),
      });

      if (!prepRes.ok) {
        const errBody = await prepRes.text().catch(() => '(unreadable)');
        await failAndStop(`Edge function error ${prepRes.status}: ${errBody.slice(0, 400)}`);
        return;
      }

      const prepData = await prepRes.json();
      tempKey = prepData.tempKey;
      partCallbackUrls = prepData.partCallbackUrls;
      baseDeepgramUrl = prepData.baseDeepgramUrl;
      ttlSeconds = prepData.ttlSeconds ?? 600;

      if (!tempKey || !partCallbackUrls?.length || !baseDeepgramUrl) {
        await failAndStop('Edge function returned incomplete token data');
        return;
      }

      const ttlMinutes = Math.round(ttlSeconds / 60);
      await persistLog(`[TOKEN] Deepgram JWT acquired — TTL ${ttlMinutes} minute${ttlMinutes !== 1 ? 's' : ''}`);
    } catch (tokenErr) {
      await failAndStop(`Could not acquire Deepgram token: ${String(tokenErr).slice(0, 300)}`);
      return;
    }

    setUploadProgress(25);
    startElapsedTimer();
    startPolling(newJobId);
    setUploading(false);
    setUploadProgress(30);

    addLog(`Model: ${model} | Mode: ${processingMode}`);
    if (uploadFiles.length > 1) {
      addLog(`[ASYNC] ${uploadFiles.length} parts will be transcribed independently and stitched into a single timeline`);
    }

    // -----------------------------------------------------------------------
    // Step 4 — POST each file directly to Deepgram with Bearer JWT auth.
    //          Audio bytes go browser → Deepgram in one hop.
    //          Deepgram processes async and POSTs the result to transcribe-callback.
    // -----------------------------------------------------------------------
    const deepgramRequestIds: string[] = [];
    try {
      for (let i = 0; i < uploadFiles.length; i++) {
        const cf = uploadFiles[i];
        const partLabel = uploadFiles.length > 1 ? ` part ${i + 1}/${uploadFiles.length}` : '';
        const callbackUrl = partCallbackUrls[i];

        await persistLog(`[UPLOAD] Sending${partLabel} to Deepgram directly: ${cf.name} (${formatFileSize(cf.size)})`);

        const dgUrl = `${baseDeepgramUrl}&callback=${encodeURIComponent(callbackUrl)}&callback_method=post`;

        const uploadStart = Date.now();
        const RETRY_DELAYS = [0, 5000, 15000, 45000];
        let dgRes: Response | null = null;
        let lastUploadErr = '';
        for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
          if (attempt > 0) {
            await persistLog(`[UPLOAD]   Retrying in ${RETRY_DELAYS[attempt] / 1000}s (attempt ${attempt + 1}/${RETRY_DELAYS.length})...`);
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          }
          try {
            dgRes = await fetch(dgUrl, {
              method: 'POST',
              headers: {
                // JWT from /v1/auth/grant — must use Bearer scheme, NOT Token
                Authorization: `Bearer ${tempKey}`,
                'Content-Type': cf.type || 'audio/mpeg',
              },
              body: cf,
            });
            if (dgRes.ok) break;
            // 4xx errors are not retryable (auth, bad request)
            if (dgRes.status >= 400 && dgRes.status < 500) break;
            lastUploadErr = `HTTP ${dgRes.status}`;
          } catch (fetchErr) {
            lastUploadErr = String(fetchErr);
            dgRes = null;
          }
        }

        if (!dgRes || !dgRes.ok) {
          const errText = dgRes ? await dgRes.text().catch(() => '') : lastUploadErr;
          throw new Error(`Deepgram rejected part ${i + 1} — ${errText.slice(0, 300)}`);
        }

        const dgBody = await dgRes.json() as { request_id: string };
        const requestId = dgBody.request_id;
        deepgramRequestIds.push(requestId);

        const uploadSec = ((Date.now() - uploadStart) / 1000).toFixed(1);
        await persistLog(`[UPLOAD]   Accepted by Deepgram in ${uploadSec}s — request_id=${requestId}`);
        await persistLog(`[UPLOAD]   Deepgram is processing async — awaiting callback`);

        // Record the request_id on the transcript_parts row
        await supabase
          .from('transcript_parts')
          .update({ deepgram_request_id: requestId })
          .eq('job_id', newJobId)
          .eq('part_index', i);

        setUploadProgress(Math.round(30 + ((i + 1) / uploadFiles.length) * 55));
      }
    } catch (uploadErr) {
      await failAndStop(`Deepgram upload failed: ${String(uploadErr).slice(0, 500)}`);
      return;
    }

    await persistLog(`[ASYNC] ${uploadFiles.length} part${uploadFiles.length !== 1 ? 's' : ''} submitted to Deepgram — awaiting async callbacks`);

    await supabase
      .from('transcription_jobs')
      .update({
        phase: `Awaiting Deepgram (0/${uploadFiles.length} parts)`,
        progress: 20,
        logs: persistedLogs,
      })
      .eq('id', newJobId);

    setUploadProgress(100);

    // -----------------------------------------------------------------------
    // Step 5 — Background archive: upload original files to storage.
    //          This is non-blocking — transcription is already in flight.
    //          Storage is for audit/retention only, not for transcription.
    // -----------------------------------------------------------------------
    (async () => {
      try {
        for (let i = 0; i < uploadFiles.length; i++) {
          const cf = uploadFiles[i];
          const safeName = cf.name.replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '').slice(0, 200);
          const archivePath = `${jobScopeId}/part_${String(i).padStart(2, '0')}_${safeName}`;

          const archiveResult = await tusUpload(supabaseUrl, anonKey, 'audio-files', archivePath, cf, () => {});
          if (archiveResult.ok) {
            await supabase
              .from('transcript_parts')
              .update({ storage_path: archivePath })
              .eq('job_id', newJobId)
              .eq('part_index', i);
            console.log(`[ARCHIVE] Part ${i + 1} archived to ${archivePath}`);
          } else {
            console.warn(`[ARCHIVE] Part ${i + 1} archive failed (non-fatal): ${archiveResult.errorMessage}`);
          }
        }
      } catch (archiveErr) {
        // Archive failure is never fatal — transcript is already in flight
        console.warn('[ARCHIVE] Background archive error (non-fatal):', archiveErr);
      }
    })();
  };

  const handleUpdateSpeaker = async (mappingId: string, newName: string) => {
    setSpeakerMappings(prev => prev.map(m => m.id === mappingId ? { ...m, mapped_name: newName } : m));
  };

  const handleApplySpeakers = async () => {
    if (!job) return;
    for (const mapping of speakerMappings) {
      await supabase
        .from('speaker_mappings')
        .update({ mapped_name: mapping.mapped_name })
        .eq('id', mapping.id);
    }
    setStep(4);
    notify('Speaker labels applied to transcript draft.');
  };

  const loadSpeakerPreviews = async () => {
    if (!job) return;
    setLoadingPreviews(true);
    try {
      // Pull speaker_turns grouped by speaker_id for preview text
      const { data } = await supabase
        .from('speaker_turns')
        .select('speaker_id, joined_text, start_time, end_time, sequence_index')
        .eq('job_id', job.id)
        .order('sequence_index');

      if (!data || data.length === 0) {
        // Fall back to raw utterances if no speaker_turns yet
        const { data: uttData } = await supabase
          .from('utterances')
          .select('speaker_id, transcript, start_time, end_time')
          .eq('job_id', job.id)
          .order('sequence_index');

        if (uttData) {
          const byId: Record<number, SpeakerTurnPreview> = {};
          for (const u of uttData) {
            if (!byId[u.speaker_id]) byId[u.speaker_id] = { speaker_id: u.speaker_id, sample_texts: [], turn_count: 0, total_duration: 0 };
            byId[u.speaker_id].turn_count += 1;
            byId[u.speaker_id].total_duration += (u.end_time - u.start_time);
            if (byId[u.speaker_id].sample_texts.length < 3) byId[u.speaker_id].sample_texts.push(u.transcript);
          }
          setSpeakerPreviews(Object.values(byId).sort((a, b) => a.speaker_id - b.speaker_id));
        }
        return;
      }

      const byId: Record<number, SpeakerTurnPreview> = {};
      for (const t of data) {
        if (!byId[t.speaker_id]) byId[t.speaker_id] = { speaker_id: t.speaker_id, sample_texts: [], turn_count: 0, total_duration: 0 };
        byId[t.speaker_id].turn_count += 1;
        byId[t.speaker_id].total_duration += (t.end_time - t.start_time);
        if (byId[t.speaker_id].sample_texts.length < 3) byId[t.speaker_id].sample_texts.push(t.joined_text);
      }
      setSpeakerPreviews(Object.values(byId).sort((a, b) => a.speaker_id - b.speaker_id));
    } finally {
      setLoadingPreviews(false);
    }
  };

  const resetProcess = (skipConfirm = false) => {
    const needsConfirm = !skipConfirm && (step > 1 || selectedFiles.length > 0 || deepgramOptions.keyterms.length > 0 || docFiles.length > 0);
    if (needsConfirm && !window.confirm('Clear everything and start a new job? All unsaved progress will be lost.')) return;
    setStep(1);
    setJob(null);
    setUtterances([]);
    setSpeakerMappings([]);
    setSpeakerPreviews([]);
    setLogs([]);
    setSelectedFiles([]);
    setUploadProgress(0);
    setElapsed(0);
    setJobStartedAt(null);
    setNotesText('');
    setDocFiles([]);
    setKeytermInput('');
    setConfirmedSpellings([]);
    setAiKeyterms(new Set());
    setPhoneticMappings([]);
    setDeepgramOptions({
      smart_format: true,
      diarize: true,
      punctuate: true,
      paragraphs: true,
      utterances: true,
      filler_words: true,
      numerals: true,
      utt_split: 0.8,
      keyterms: [],
    });
    if (pollRef.current) clearInterval(pollRef.current);
    stopElapsedTimer();
  };

  const getMappedName = (speakerId: number): string => {
    return speakerMappings.find(m => m.speaker_id === speakerId)?.mapped_name ?? `Speaker ${speakerId}`;
  };

  const getSpeakerRole = (mappedName: string): 'Q' | 'A' | 'REPORTER' => {
    const n = mappedName.toUpperCase();
    if (/\bWITNESS\b|\bDEPONENT\b/.test(n)) return 'A';
    if (/\bREPORTER\b|\bNOTARY\b|\bCLERK\b|\bOFFICER\b/.test(n)) return 'REPORTER';
    return 'Q';
  };

  /** Escape special RTF characters in a plain-text string. */
  const rtfEscape = (text: string): string =>
    text
      .replace(/\\/g, '\\\\')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      // Convert non-ASCII to Unicode RTF escapes
      .replace(/[^\x00-\x7F]/g, c => {
        const cp = c.codePointAt(0)!;
        return `\\u${cp >= 32768 ? cp - 65536 : cp}?`;
      });

  const exportTranscript = async () => {
    if (utterances.length === 0) return;

    // -----------------------------------------------------------------------
    // RTF tab stops (in twips: 1 inch = 1440 twips)
    //   Left tabs:     0.5" = 720   1.0" = 1440   1.5" = 2160
    //   Centered tab:  3.25" from left margin = 4680
    //   (page: 8.5" wide, 1.25" left margin → text starts at 1800 twips
    //    center of 6" text area = 3", absolute = 1800 + 4320 = 6120 twips
    //    but Word measures tab stops from left margin, so 3" = 4320 twips)
    // -----------------------------------------------------------------------
    const TAB_STOPS =
      '\\tql\\tx720\\tql\\tx1440\\tql\\tx2160\\tqc\\tx4320';

    // Paragraph format string reused for every Q/A line
    const paraFmt = `\\pard ${TAB_STOPS}\\sl480\\slmult1\\fi0\\li0 `;

    const rtfParagraphs: string[] = [];

    // Header block (centered, bold)
    const headerFmt = '\\pard\\qc\\sb240\\sa120 ';
    rtfParagraphs.push(
      `${headerFmt}{\\b DEPOSITION OF ${rtfEscape((caseData.witness_full_name ?? '').toUpperCase())}}\\par`,
      `${headerFmt}CAUSE NO. ${rtfEscape(caseData.cause_number ?? '')} | DATE: ${rtfEscape(caseData.deposition_date ?? '')}\\par`,
      currentReporter
        ? `${headerFmt}REPORTER: ${rtfEscape(currentReporter.name.toUpperCase())}\\par`
        : '',
      '\\pard\\qc\\sb120\\sa120 \\emdash\\emdash\\emdash\\par',
    );

    // Body — Q/A formatted turns
    let prevSpeakerId: number | null = null;

    for (const u of utterances) {
      const mappedName = getMappedName(u.speaker_id);
      const role = getSpeakerRole(mappedName);
      const text = rtfEscape(u.corrected_transcript ?? u.transcript);
      const speakerChanged = u.speaker_id !== prevSpeakerId;
      prevSpeakerId = u.speaker_id;

      let para: string;

      if (role === 'REPORTER') {
        // Reporter lines: speaker name bold, then text — no Q/A marker
        if (speakerChanged) {
          para = `${paraFmt}{\\b ${rtfEscape(mappedName.toUpperCase())}}\\tab ${text}\\par`;
        } else {
          // Continuation — indent to align with text column
          para = `${paraFmt}\\tab\\tab ${text}\\par`;
        }
      } else {
        // Q or A lines: \tab Q.\tab text
        const marker = role === 'Q' ? 'Q.' : 'A.';
        if (speakerChanged) {
          para = `${paraFmt}\\tab {\\b ${marker}}\\tab ${text}\\par`;
        } else {
          // Continuation of same speaker — no repeated Q./A., indent to text column
          para = `${paraFmt}\\tab\\tab ${text}\\par`;
        }
      }

      rtfParagraphs.push(para);
    }

    // Assemble full RTF document
    const rtf = [
      '{\\rtf1\\ansi\\deff0',
      '{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}}',
      '{\\colortbl ;\\red0\\green0\\blue0;}',
      '\\widowctrl\\hyphauto',
      // Page setup: 8.5"×11", 1.25" left/right margins, 1" top/bottom
      '\\paperw12240\\paperh15840\\margl1800\\margr1800\\margt1440\\margb1440',
      '\\f0\\fs24\\cf1',
      ...rtfParagraphs.filter(Boolean),
      '}',
    ].join('\n');

    const blob = new Blob([rtf], { type: 'application/rtf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(caseData.witness_full_name ?? 'deposition').replace(/\s+/g, '_')}_transcript.rtf`;
    a.click();

    if (job) {
      await supabase.from('transcription_jobs').update({
        export_count: (job.export_count ?? 0) + 1,
        last_exported_at: new Date().toISOString(),
      }).eq('id', job.id);
      setJob(prev => prev ? { ...prev, export_count: (prev.export_count ?? 0) + 1 } : prev);
    }
  };

  return (
    <div className="flex-1 flex flex-col xl:flex-row h-[calc(100vh-73px)] overflow-hidden">

      {/* Toast stack */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
          {toasts.map(toast => (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3.5 shadow-2xl border backdrop-blur-sm animate-[fadeSlideIn_0.2s_ease-out] ${
                toast.type === 'error'
                  ? 'bg-rose-950/95 border-rose-500/40 shadow-rose-900/30'
                  : 'bg-slate-900/95 border-slate-700/80'
              }`}
            >
              {/* Icon */}
              <div className={`mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${
                toast.type === 'error' ? 'bg-rose-500' : 'bg-emerald-500'
              }`}>
                {toast.type === 'error' ? (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                ) : (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                )}
              </div>

              {/* Message */}
              <p className={`flex-1 text-sm leading-snug font-medium ${
                toast.type === 'error' ? 'text-rose-100' : 'text-slate-200'
              }`}>
                {toast.message}
              </p>

              {/* Dismiss */}
              <button
                onClick={() => dismissToast(toast.id)}
                className={`shrink-0 mt-0.5 transition-colors ${
                  toast.type === 'error'
                    ? 'text-rose-400/60 hover:text-rose-200'
                    : 'text-slate-500 hover:text-slate-200'
                }`}
                aria-label="Dismiss"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Left Control Column */}
      <div className="w-full xl:w-[48%] bg-slate-900/40 p-6 flex flex-col border-r border-slate-800 overflow-y-auto">

        {/* Step Indicator */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
              Deposition Workspace
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 font-mono">STEP {step} OF 4</span>
              <button
                onClick={() => resetProcess()}
                title="Clear all and start a new job"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold tracking-wide text-slate-400 hover:text-rose-400 bg-slate-950 hover:bg-rose-500/10 border border-slate-800 hover:border-rose-500/30 transition-all"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                New Job
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
            {([1, 2, 3, 4] as Step[]).map((s, i) => {
              const labels = ['1. Setup', '2. Processing', '3. Speakers', '4. Review'];
              const enabled = s === 1 || (s === 2 && step >= 2) || (s === 3 && step >= 3) || (s === 4 && step >= 4);
              return (
                <button
                  key={s}
                  disabled={!enabled}
                  onClick={() => enabled && setStep(s)}
                  className={`py-2 rounded-lg text-center text-xs transition-all disabled:opacity-40 ${
                    step === s ? 'bg-sky-600 text-white font-medium shadow-md' : 'text-slate-400 hover:bg-slate-900'
                  }`}
                >
                  {labels[i]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 1: Setup */}
        {step === 1 && (
          <div className="space-y-5">
            {/* File Upload */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all shadow-xl">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="p-2 bg-sky-500/10 text-sky-400 rounded-lg"><Icons.Upload /></div>
                <div>
                  <h3 className="text-sm font-bold text-slate-200">1. Source Media</h3>
                  <p className="text-[11px] text-slate-400">
                    {selectedFiles.length > 1
                      ? `${selectedFiles.length} files — each transcribed independently and stitched into one timeline`
                      : 'Upload audio or video file(s) for transcription'}
                  </p>
                </div>
                <span className="ml-auto text-[10px] text-slate-500 font-semibold bg-slate-950 px-2 py-1 rounded border border-slate-800">MP3, MP4, WAV, FLAC, M4A</span>
              </div>

              {/* Drop zone — always visible, adds to list */}
              <div
                onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  isDragOver
                    ? 'border-sky-500 bg-sky-500/5'
                    : selectedFiles.length > 0
                      ? 'border-slate-700 hover:border-sky-600/40 hover:bg-slate-950/40 py-4'
                      : 'border-slate-700 hover:border-sky-600/50 hover:bg-slate-950/50 p-8'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,.mp4,.wav,.flac,.m4a,.mov,.avi,.aac"
                  multiple
                  className="hidden"
                  onChange={e => {
                    if (e.target.files?.length) {
                      addFiles(Array.from(e.target.files));
                      e.target.value = '';
                    }
                  }}
                />
                <div className="flex flex-col items-center gap-1.5">
                  <div className={`rounded-full flex items-center justify-center transition-all ${
                    selectedFiles.length > 0
                      ? 'w-8 h-8 bg-sky-500/10 text-sky-400'
                      : 'w-10 h-10 bg-slate-800 text-slate-400'
                  }`}>
                    <Icons.Upload />
                  </div>
                  {selectedFiles.length > 0 ? (
                    <>
                      <p className="text-xs font-semibold text-sky-400">+ Add more files</p>
                      <p className="text-[10px] text-slate-600">Drop here or click to browse — files are added in order</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-slate-300">Drop file(s) here or click to browse</p>
                      <p className="text-xs text-slate-500">MP3, MP4, WAV, FLAC, M4A, MOV, AVI &nbsp;·&nbsp; Multiple files are transcribed independently and stitched</p>
                    </>
                  )}
                </div>
              </div>

              {/* File list */}
              {selectedFiles.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {selectedFiles.map((f, i) => (
                    <div
                      key={`${f.name}-${i}`}
                      className="flex items-center gap-2.5 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2.5 group"
                    >
                      {/* Sequence badge */}
                      <div className="w-5 h-5 rounded-full bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
                        <span className="text-[9px] font-black text-sky-400 tabular-nums">{i + 1}</span>
                      </div>

                      {/* File info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate">{f.name}</p>
                        <p className="text-[10px] text-slate-500">{(f.size / 1024 / 1024).toFixed(1)} MB &nbsp;·&nbsp; {f.type || 'audio'}</p>
                      </div>

                      {/* Reorder + remove */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => moveFile(i, -1)}
                          disabled={i === 0}
                          className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-200 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                          title="Move up"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          onClick={() => moveFile(i, 1)}
                          disabled={i === selectedFiles.length - 1}
                          className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-200 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                          title="Move down"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <button
                          onClick={() => removeFile(i)}
                          className="p-1 rounded hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 transition-colors ml-0.5"
                          title="Remove"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Total size summary */}
                  {selectedFiles.length > 1 && (
                    <div className="flex items-center justify-between px-3 py-1.5 border-t border-slate-800/60 mt-1">
                      <span className="text-[10px] text-slate-500">
                        {selectedFiles.length} files &nbsp;·&nbsp; {(selectedFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB total
                      </span>
                      <span className="text-[9px] font-bold text-amber-400/70 bg-amber-500/5 border border-amber-500/15 px-1.5 py-0.5 rounded">
                        ASYNC STITCH IN ORDER
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Engine Config */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all shadow-xl">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="p-2 bg-sky-500/10 text-sky-400 rounded-lg"><Icons.Engine /></div>
                <div>
                  <h3 className="text-sm font-bold text-slate-200">2. Engine Configuration</h3>
                  <p className="text-[11px] text-slate-400">Deepgram model &amp; API parameter fine-tuning</p>
                </div>
                <div className="ml-auto flex items-center gap-1 bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full text-[10px] font-medium border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  API Ready
                </div>
              </div>

              {/* Model + Processing Mode */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1.5">Transcription Model</label>
                  <select
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 font-semibold focus:border-sky-500 focus:outline-none"
                  >
                    <option value="nova-3">Nova-3 (Best / General)</option>
                    <option value="nova-3-medical">Nova-3 Medical</option>
                    <option value="nova-2">Nova-2 (Legacy)</option>
                    <option value="nova-2-medical">Nova-2 Medical (Legacy)</option>
                  </select>
                  {(model === 'nova-3-medical' || model === 'nova-2-medical') && (
                    <p className="text-[10px] text-sky-400 mt-1">Medical model: optimized for clinical terminology, drug names, and anatomical terms.</p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1.5">Processing Intensity</label>
                  <select
                    value={processingMode}
                    onChange={e => setProcessingMode(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 font-semibold focus:border-sky-500 focus:outline-none"
                  >
                    <option value="ENHANCED (Dual Pass)">Enhanced (Dual Pass)</option>
                    <option value="STANDARD (Fast Pass)">Standard (Fast Pass)</option>
                    <option value="LOW-QUALITY FIX">Noisy Audio Preset</option>
                  </select>
                </div>
              </div>

              {/* Feature Toggles */}
              <div className="mb-4">
                <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-2">Deepgram Feature Flags</label>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {(
                    [
                      { key: 'smart_format',  label: 'Smart Format',  desc: 'Auto-formats numbers, dates, currencies' },
                      { key: 'diarize',       label: 'Diarize',       desc: 'Speaker identification' },
                      { key: 'punctuate',     label: 'Punctuate',     desc: 'Add punctuation to transcript' },
                      { key: 'utterances',    label: 'Utterances',    desc: 'Return per-utterance segments' },
                      { key: 'filler_words',  label: 'Filler Words',  desc: 'Include um, uh, and other fillers' },
                      { key: 'numerals',      label: 'Numerals',      desc: 'Convert spoken numbers to digits' },
                    ] as { key: keyof DeepgramOptions; label: string; desc: string }[]
                  ).map(({ key, label, desc }) => (
                    <label key={key} className="flex items-start gap-2.5 cursor-pointer group">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={deepgramOptions[key] as boolean}
                        onClick={() => setOption(key, !deepgramOptions[key] as DeepgramOptions[typeof key])}
                        className={`relative mt-0.5 w-8 h-4 rounded-full transition-colors shrink-0 focus:outline-none ${
                          deepgramOptions[key] ? 'bg-sky-600' : 'bg-slate-700'
                        }`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                          deepgramOptions[key] ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                      </button>
                      <div className="min-w-0">
                        <span className="text-[11px] font-semibold text-slate-200">{label}</span>
                        <p className="text-[10px] text-slate-500 leading-tight">{desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* utt_split */}
              <div className="mb-4">
                <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1.5">
                  Utterance Split Threshold
                  <span className="ml-2 normal-case font-normal text-slate-500">(utt_split) — seconds of silence between speakers</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0.1"
                    max="3.0"
                    step="0.1"
                    value={deepgramOptions.utt_split}
                    onChange={e => setOption('utt_split', parseFloat(e.target.value))}
                    className="flex-1 accent-sky-500"
                  />
                  <input
                    type="number"
                    min="0.1"
                    max="3.0"
                    step="0.1"
                    value={deepgramOptions.utt_split}
                    onChange={e => setOption('utt_split', parseFloat(e.target.value) || 0.8)}
                    className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 font-mono text-center focus:border-sky-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-500 shrink-0">sec</span>
                </div>
              </div>

              {/* Key Terms */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1.5">
                  Key Term Prompting
                  <span className="ml-2 normal-case font-normal text-slate-500">— boosts recognition accuracy for specific words</span>
                </label>

                {/* Manual entry */}
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={keytermInput}
                    onChange={e => setKeytermInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { addKeyterm(keytermInput); setKeytermInput(''); } }}
                    placeholder="Type term and press Enter..."
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-sky-500 focus:outline-none"
                  />
                  <button
                    onClick={() => { addKeyterm(keytermInput); setKeytermInput(''); }}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
                  >
                    Add
                  </button>
                </div>

                {/* Document upload + paste area */}
                <div className="mb-2 space-y-2">
                  {/* File drop zone */}
                  <div
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); handleDocFileSelect(e.dataTransfer.files); }}
                    onClick={() => docFileInputRef.current?.click()}
                    className="border border-dashed border-slate-700 hover:border-sky-500/60 bg-slate-950 rounded-lg px-4 py-3 cursor-pointer transition-all flex items-center gap-3 group"
                  >
                    <input
                      ref={docFileInputRef}
                      type="file"
                      multiple
                      accept=".txt,.md,.csv,.doc,.docx,.pdf"
                      className="hidden"
                      onChange={e => handleDocFileSelect(e.target.files)}
                    />
                    <div className="w-8 h-8 rounded-lg bg-slate-800 group-hover:bg-sky-500/10 text-slate-500 group-hover:text-sky-400 flex items-center justify-center shrink-0 transition-colors">
                      {docParsing ? (
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-400 border-t-transparent animate-spin block" />
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-slate-300 group-hover:text-white transition-colors">
                        {docParsing ? 'Extracting text…' : 'Upload NOD or Court Reporter Notes'}
                      </p>
                      <p className="text-[10px] text-slate-600 mt-0.5">TXT, DOCX, DOC, PDF — drag & drop or click to browse</p>
                    </div>
                    {docFiles.length > 0 && (
                      <span className="ml-auto text-[10px] font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-full shrink-0">
                        {docFiles.length} file{docFiles.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {/* Uploaded file chips */}
                  {docFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-1">
                      {docFiles.map(f => (
                        <span key={f.name} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-lg text-[10px] text-slate-300 font-medium max-w-xs">
                          <svg className="w-3 h-3 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className="truncate">{f.name}</span>
                          <button
                            onClick={e => { e.stopPropagation(); removeDocFile(f.name); }}
                            className="text-slate-500 hover:text-rose-400 transition-colors shrink-0 ml-0.5"
                          >
                            &times;
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Paste fallback */}
                  <textarea
                    value={notesText}
                    onChange={e => setNotesText(e.target.value)}
                    placeholder="…or paste Notice of Deposition or case notes here to auto-extract key terms (proper names, medical terms, legal entities)..."
                    rows={3}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:border-sky-500 focus:outline-none resize-none leading-relaxed"
                  />
                  {/* Two-button row: deterministic parse + AI enhance */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { extractStructuredNodTerms(notesText); setNotesText(''); }}
                      disabled={!notesText.trim() && docFiles.length === 0}
                      className="flex-1 py-1.5 bg-sky-600/20 hover:bg-sky-600/30 text-sky-400 text-[10px] font-bold rounded-lg border border-sky-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Parse Key Terms
                    </button>
                    <button
                      onClick={handleAiEnhance}
                      disabled={(!notesText.trim() && docFiles.length === 0) || aiEnhancing}
                      className="flex-1 py-1.5 bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 text-[10px] font-bold rounded-lg border border-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                    >
                      {aiEnhancing ? (
                        <>
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                          </svg>
                          Enhancing…
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
                          </svg>
                          Enhance with AI
                        </>
                      )}
                    </button>
                  </div>

                  {/* Legend */}
                  <div className="flex items-center gap-3 px-0.5">
                    <span className="flex items-center gap-1 text-[9px] text-slate-600">
                      <span className="w-2 h-2 rounded-sm bg-sky-500/20 border border-sky-500/30 inline-block"/>
                      Regex-parsed
                    </span>
                    <span className="flex items-center gap-1 text-[9px] text-slate-600">
                      <span className="w-2 h-2 rounded-sm bg-emerald-500/15 border border-emerald-500/25 inline-block"/>
                      AI-suggested
                    </span>
                    <span className="flex items-center gap-1 text-[9px] text-slate-600">
                      <span className="w-2 h-2 rounded-sm bg-amber-500/15 border border-amber-500/25 inline-block"/>
                      Phonetic mapping
                    </span>
                  </div>
                </div>

                {/* Deepgram keyterm chips — sent to Deepgram API */}
                {deepgramOptions.keyterms.length > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                        Deepgram Keyterms ({deepgramOptions.keyterms.length})
                      </p>
                      <button
                        onClick={() => { setDeepgramOptions(prev => ({ ...prev, keyterms: [] })); setAiKeyterms(new Set()); }}
                        className="text-[10px] text-slate-600 hover:text-rose-400 transition-colors"
                      >
                        Clear all
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-950 rounded-lg border border-slate-800">
                      {deepgramOptions.keyterms.map(term => {
                        const isAi = aiKeyterms.has(term);
                        // Strip boost suffix for display: "Cukjati:3" → "Cukjati  :3"
                        const boostMatch = term.match(/^(.+?):(\d)$/);
                        const displayLabel = boostMatch ? boostMatch[1] : term;
                        const boostSuffix = boostMatch ? boostMatch[2] : null;
                        return (
                          <span
                            key={term}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-md border ${
                              isAi
                                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                                : 'bg-sky-500/10 text-sky-300 border-sky-500/20'
                            }`}
                          >
                            {isAi && (
                              <svg className="w-2.5 h-2.5 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
                              </svg>
                            )}
                            {displayLabel}
                            {boostSuffix && (
                              <span className="opacity-50 font-normal ml-0.5">:{boostSuffix}</span>
                            )}
                            <button
                              onClick={() => {
                                removeKeyterm(term);
                                setAiKeyterms(prev => { const n = new Set(prev); n.delete(term); return n; });
                              }}
                              className="hover:text-rose-400 transition-colors ml-0.5 opacity-60 hover:opacity-100"
                            >&times;</button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Phonetic mappings — spoken → written, sent to Deepgram as keyterms */}
                {phoneticMappings.length > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                        <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
                        </svg>
                        Phonetic Mappings ({phoneticMappings.length})
                      </p>
                      <button
                        onClick={() => {
                          setPhoneticMappings([]);
                          setDeepgramOptions(prev => ({
                            ...prev,
                            keyterms: prev.keyterms.filter(k => !k.includes(' -> ')),
                          }));
                        }}
                        className="text-[10px] text-slate-600 hover:text-rose-400 transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="space-y-1">
                      {phoneticMappings.map(m => {
                        const [spoken, written] = m.split(' -> ');
                        return (
                          <div
                            key={m}
                            className="flex items-center gap-2 px-2.5 py-1.5 bg-amber-500/5 border border-amber-500/15 rounded-lg"
                          >
                            <span className="text-[10px] text-amber-300/70 font-mono italic">{spoken}</span>
                            <svg className="w-3 h-3 text-amber-500/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12"/>
                            </svg>
                            <span className="text-[10px] text-amber-200 font-semibold flex-1">{written}</span>
                            <button
                              onClick={() => {
                                setPhoneticMappings(prev => prev.filter(x => x !== m));
                                setDeepgramOptions(prev => ({
                                  ...prev,
                                  keyterms: prev.keyterms.filter(k => k !== m),
                                }));
                              }}
                              className="text-slate-600 hover:text-rose-400 transition-colors text-xs"
                            >&times;</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Confirmed spellings — full names/firms for reference, not sent to Deepgram */}
                {confirmedSpellings.length > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                        Confirmed Spellings ({confirmedSpellings.length})
                      </p>
                      <button
                        onClick={() => setConfirmedSpellings([])}
                        className="text-[10px] text-slate-600 hover:text-rose-400 transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-950/60 rounded-lg border border-slate-800/60">
                      {confirmedSpellings.map(s => (
                        <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-800/60 text-slate-400 text-[10px] rounded-md border border-slate-700/60">
                          {s}
                          <button
                            onClick={() => setConfirmedSpellings(prev => prev.filter(c => c !== s))}
                            className="text-slate-600 hover:text-rose-400 transition-colors ml-0.5"
                          >&times;</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Linked Case Metadata */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-sky-500/10 text-sky-400 rounded-lg"><Icons.Details /></div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-200">3. Synced Case Metadata</h3>
                    <p className="text-[11px] text-slate-400">Live linkage to Case Intake Review</p>
                  </div>
                </div>
                <button
                  onClick={onNavigateCaseIntake}
                  className="flex items-center gap-1.5 bg-slate-950 text-sky-400 border border-sky-500/20 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-slate-900"
                >
                  <Icons.Edit /> Edit Case
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Cause Number</label>
                  <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-lg text-xs font-semibold text-white">{caseData.cause_number || 'Not Configured'}</div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Deposition Date</label>
                  <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-lg text-xs font-semibold text-white">{caseData.deposition_date || 'Not Configured'}</div>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Witness / Deponent</label>
                <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-lg text-xs font-semibold text-sky-300">{caseData.witness_full_name || 'No Deponent Assigned'}</div>
              </div>
            </div>

            <button
              onClick={handleStartTranscription}
              disabled={selectedFiles.length === 0 || uploading}
              className="w-full py-4 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-sky-600/10 flex items-center justify-center gap-3"
            >
              <Icons.Play />
              {uploading ? 'Uploading...' : 'Execute Transcription Pipeline'}
            </button>
          </div>
        )}

        {/* Step 2: Processing */}
        {step === 2 && (() => {
          const progress = job?.progress ?? uploadProgress;
          const phase = job?.phase ?? 'Uploading...';
          const isComplete = job?.status === 'complete';
          const isFailed = job?.status === 'failed';

          // Estimated duration: Deepgram typically processes at ~5-10x realtime for Nova-3
          // We don't know audio length yet, but we can extrapolate from elapsed vs progress
          const estimatedTotal = progress > 5 && elapsed > 3
            ? Math.round((elapsed / progress) * 100)
            : null;
          const estimatedRemaining = estimatedTotal !== null
            ? Math.max(0, estimatedTotal - elapsed)
            : null;

          const formatSecs = (s: number) => s >= 60
            ? `${Math.floor(s / 60)}m ${s % 60}s`
            : `${s}s`;

          // Pipeline phases with order and descriptions
          const PHASES = [
            { id: 'compress',  label: 'Compress',         desc: 'Re-encoding large file to 32 kbps mono for upload', match: ['COMPRESS', 'Compressing', 'Decoding audio'] },
            { id: 'upload',    label: 'Upload',           desc: 'Transferring media to secure storage',          match: ['Upload', 'Uploading', 'Queued'] },
            { id: 'submit',    label: 'Submit',           desc: 'Submitting parts to Deepgram async pipeline',   match: ['Submitting', 'Submitted'] },
            { id: 'deepgram',  label: 'Awaiting',         desc: 'Deepgram processing audio asynchronously',      match: ['Awaiting Deepgram', 'Awaiting'] },
            { id: 'stitch',    label: 'Stitch',           desc: 'Stitching part transcripts into global timeline', match: ['Stitching', 'Grouping'] },
            { id: 'parse',     label: 'Parse',            desc: 'Extracting utterances and building speaker map', match: ['Parsing', 'Parse', 'speaker', 'Speaker', 'Building'] },
            { id: 'complete',  label: 'Complete',         desc: 'Transcript ready for review',                   match: ['Complete'] },
          ];

          const activePhaseIdx = (() => {
            if (isComplete) return PHASES.length - 1;
            for (let i = PHASES.length - 1; i >= 0; i--) {
              if (PHASES[i].match.some(m => phase.toLowerCase().includes(m.toLowerCase()))) return i;
            }
            return 0;
          })();

          return (
            <div className="space-y-4">
              {/* Main status card */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      {!isComplete && !isFailed && (
                        <span className="inline-flex h-3 w-3 shrink-0">
                          <span className="animate-ping absolute h-3 w-3 rounded-full bg-sky-400 opacity-75" />
                          <span className="relative rounded-full h-3 w-3 bg-sky-500" />
                        </span>
                      )}
                      {isComplete ? 'Transcription Complete' : isFailed ? 'Transcription Failed' : 'Processing Deposition Audio'}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <p className="text-[11px] text-slate-400">
                        {isComplete
                          ? `Completed in ${formatSecs(elapsed)} — ${job?.word_count?.toLocaleString() ?? 0} words extracted`
                          : isFailed
                          ? job?.error_message ?? 'An error occurred'
                          : phase}
                      </p>
                      {!isComplete && !isFailed && job && (job.parts_total ?? 1) > 1 && (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 shrink-0">
                          {job.parts_completed ?? 0} / {job.parts_total} parts complete
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Timer */}
                  <div className="text-right shrink-0">
                    <div className="text-lg font-mono font-bold text-white tabular-nums">{formatSecs(elapsed)}</div>
                    <div className="text-[10px] text-slate-500">elapsed</div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mb-3">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Progress</span>
                    <div className="flex items-center gap-3">
                      {estimatedRemaining !== null && !isComplete && (
                        <span className="text-[10px] text-slate-500">
                          ~{formatSecs(estimatedRemaining)} remaining
                        </span>
                      )}
                      <span className="text-xs font-bold font-mono text-sky-400">{progress}%</span>
                    </div>
                  </div>
                  <div className="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                    <div
                      style={{ width: `${progress}%` }}
                      className={`h-full rounded-full transition-all duration-700 ${
                        isComplete ? 'bg-emerald-500' : isFailed ? 'bg-rose-500' : 'bg-sky-500'
                      } ${!isComplete && !isFailed ? 'relative overflow-hidden' : ''}`}
                    >
                      {!isComplete && !isFailed && (
                        <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_1.5s_infinite]" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Pipeline phase steps */}
                <div className="flex items-center gap-1 mt-4">
                  {PHASES.map((ph, idx) => {
                    const done = idx < activePhaseIdx || isComplete;
                    const active = idx === activePhaseIdx && !isComplete;
                    return (
                      <React.Fragment key={ph.id}>
                        <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 transition-all ${
                            done ? 'bg-emerald-500 text-white' :
                            active ? 'bg-sky-500 text-white ring-2 ring-sky-400/30 ring-offset-1 ring-offset-slate-900' :
                            'bg-slate-800 text-slate-500'
                          }`}>
                            {done ? (
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : active ? (
                              <span className="animate-pulse">•</span>
                            ) : (
                              idx + 1
                            )}
                          </div>
                          <span className={`text-[9px] font-semibold text-center leading-tight truncate w-full text-center ${
                            done ? 'text-emerald-400' : active ? 'text-sky-400' : 'text-slate-600'
                          }`}>{ph.label}</span>
                        </div>
                        {idx < PHASES.length - 1 && (
                          <div className={`h-px flex-1 max-w-6 mb-3.5 transition-colors ${done ? 'bg-emerald-500/40' : 'bg-slate-800'}`} />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* ETA info box */}
                {!isComplete && !isFailed && (
                  <div className="mt-4 bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 flex items-center gap-3">
                    <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                    </svg>
                    <div className="text-[10px] text-slate-400 leading-relaxed">
                      {progress < 20
                        ? 'Audio is uploading and being submitted to Deepgram — the edge function returns in seconds and processing continues in the cloud.'
                        : progress < 60
                        ? 'Deepgram is processing audio asynchronously. Results are delivered via callback when ready — no timeout risk regardless of audio length.'
                        : 'Stitching and grouping transcript parts. Utterances and speaker clusters are being organized.'}
                      {estimatedRemaining !== null && estimatedRemaining > 5 && (
                        <> Estimated time remaining: <strong className="text-slate-300">{formatSecs(estimatedRemaining)}</strong>.</>
                      )}
                    </div>
                  </div>
                )}

                {isComplete && (
                  <div className="mt-4">
                    <button
                      onClick={() => setStep(3)}
                      className="w-full py-3 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-all shadow-md"
                    >
                      Proceed to Speaker Labeling <Icons.ArrowRight />
                    </button>
                  </div>
                )}
              </div>

              {/* Log output */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
                <div className="bg-slate-900/60 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Icons.Terminal /> Pipeline Log
                  </span>
                  <div className="flex items-center gap-3">
                    {!isComplete && !isFailed && <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />}
                    {isComplete && <span className="text-[10px] text-emerald-400 font-bold">DONE</span>}
                    {isFailed && <span className="text-[10px] text-rose-400 font-bold">FAILED</span>}
                    <span className="text-[9px] text-slate-600">{(() => {
                      const total = logs.length + (job?.logs?.length ?? 0);
                      return total > 0 ? `${total} entries` : '';
                    })()}</span>
                  </div>
                </div>

                {/* Full error banner when failed */}
                {isFailed && job?.error_message && (
                  <div className="mx-3 mt-3 bg-rose-500/8 border border-rose-500/25 rounded-lg px-3.5 py-3">
                    <p className="text-[10px] font-bold text-rose-400 uppercase tracking-wide mb-1">Error Detail</p>
                    <p className="text-xs text-rose-200 leading-relaxed font-mono break-all whitespace-pre-wrap">
                      {job.error_message}
                    </p>
                  </div>
                )}

                <div ref={logRef} className="p-4 h-64 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-1 leading-relaxed">
                  {/* Frontend-emitted logs (upload phase, job creation) */}
                  {logs.map((log, i) => {
                    const isErr = log.includes('ERROR') || log.includes('failed') || log.includes('WARN');
                    const isOk  = log.includes('SUCCESS') || log.includes('complete') || log.includes('Complete') || log.includes('created') || log.includes('Stored');
                    return (
                      <div key={`fe-${i}`} className={`border-l-2 pl-2.5 py-0.5 ${
                        isErr ? 'border-rose-500/60 text-rose-300' :
                        isOk  ? 'border-emerald-500/50 text-emerald-300' :
                                'border-sky-500/20 text-slate-400'
                      }`}>
                        {log}
                      </div>
                    );
                  })}

                  {/* DB-stored logs from the edge function (appear after polling) */}
                  {(job?.logs ?? []).length > 0 && (
                    <>
                      {logs.length > 0 && (
                        <div className="border-l-2 border-slate-700/40 pl-2.5 py-0.5 text-slate-600 italic">
                          — edge function output —
                        </div>
                      )}
                      {(job!.logs as string[]).map((entry, i) => {
                        const isErr = entry.includes('ERROR') || entry.includes('failed') || entry.includes('WARN');
                        const isOk  = entry.includes('SUCCESS') || entry.includes('complete') || entry.includes('Complete') || entry.includes('DONE') || entry.includes('PARSE') || entry.includes('DEEPGRAM');
                        const isSys = entry.startsWith('[SYS]') || entry.startsWith('[STITCH]') || entry.startsWith('[GROUPER]') || entry.startsWith('[KEYTERMS]') || entry.startsWith('[AUDIO]') || entry.startsWith('[RAW]') || entry.startsWith('[ASYNC]');
                        return (
                          <div key={`db-${i}`} className={`border-l-2 pl-2.5 py-0.5 ${
                            isErr ? 'border-rose-500/60 text-rose-300' :
                            isOk  ? 'border-emerald-500/50 text-emerald-300' :
                            isSys ? 'border-slate-600/60 text-slate-500' :
                                    'border-sky-500/20 text-slate-400'
                          }`}>
                            {entry}
                          </div>
                        );
                      })}
                    </>
                  )}

                  {/* Waiting indicator */}
                  {(!job || job.status === 'processing' || job.status === 'pending') && (
                    <div className="flex items-center gap-2 text-slate-600 italic pt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-600 animate-pulse" />
                      Awaiting pipeline updates...
                    </div>
                  )}
                </div>
              </div>

              {/* Keep-alive notice */}
              {!isComplete && !isFailed && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 border border-amber-500/15 rounded-lg">
                  <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <span className="text-[10px] text-amber-400/80">Keep this tab open — processing continues in the cloud and will complete even if the page is briefly hidden.</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Step 3: Speaker Labeling */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-200">Diarization Match & Speaker Mapping</h3>
                  <p className="text-[11px] text-slate-400">Map voice clusters to named deposition participants</p>
                </div>
                {job && (
                  <span className="bg-sky-500/10 text-sky-400 px-3 py-1 rounded-full text-[10px] font-bold border border-sky-500/20">
                    {speakerMappings.length} Speakers Detected
                  </span>
                )}
              </div>

              {/* Populate Speakers button */}
              <button
                onClick={loadSpeakerPreviews}
                disabled={loadingPreviews}
                className="w-full mb-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors flex items-center justify-center gap-2"
              >
                {loadingPreviews ? (
                  <>
                    <span className="w-3 h-3 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                    Loading speaker samples...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                    </svg>
                    Populate Speakers from Transcript
                  </>
                )}
              </button>

              {/* Speaker turn previews — shown after Populate is clicked */}
              {speakerPreviews.length > 0 && (
                <div className="mb-4 space-y-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Transcript Samples per Speaker</p>
                  {speakerPreviews.map(preview => (
                    <div key={preview.speaker_id} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-sky-500/20 flex items-center justify-center text-[9px] font-bold text-sky-400">
                            S{preview.speaker_id}
                          </div>
                          <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wide">Speaker {preview.speaker_id}</span>
                        </div>
                        <span className="text-[9px] text-slate-600 font-mono">
                          {preview.turn_count} turn{preview.turn_count !== 1 ? 's' : ''} &nbsp;·&nbsp; {Math.round(preview.total_duration)}s total
                        </span>
                      </div>
                      <div className="space-y-1">
                        {preview.sample_texts.slice(0, 2).map((text, i) => (
                          <p key={i} className="text-[10px] text-slate-400 leading-relaxed italic line-clamp-2">
                            "{text.length > 140 ? text.slice(0, 140) + '…' : text}"
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {job && (
                <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl mb-4 text-xs text-slate-300 leading-relaxed">
                  <span className="font-bold text-sky-400">Case participants:</span>{' '}
                  {caseData.witness_full_name && <>Witness: <strong>{caseData.witness_full_name.toUpperCase()}</strong>{caseData.defense_attorney || currentReporter ? ' | ' : ''}</>}
                  {caseData.defense_attorney && <>Counsel: <strong>{caseData.defense_attorney.toUpperCase()}</strong>{currentReporter ? ' | ' : ''}</>}
                  {currentReporter && <>Reporter: <strong>{currentReporter.name.toUpperCase()}</strong></>}
                </div>
              )}

              <div className="space-y-4">
                {(() => {
                  const isMultiPart = (job?.parts_total ?? 1) > 1;
                  const partGroups = isMultiPart
                    ? [...new Set(speakerMappings.map(m => m.part_index ?? 0))].sort((a, b) => a - b)
                    : [null];

                  return partGroups.flatMap(partIdx => {
                    const groupMappings = partIdx === null
                      ? speakerMappings
                      : speakerMappings.filter(m => (m.part_index ?? 0) === partIdx);

                    return [
                      ...(partIdx !== null ? [
                        <div key={`part-header-${partIdx}`} className="flex items-center gap-2 pt-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Part {partIdx + 1}</span>
                          <div className="flex-1 h-px bg-slate-800" />
                        </div>
                      ] : []),
                      ...groupMappings.map(mapping => {
                        const preview = speakerPreviews.find(p => p.speaker_id === mapping.speaker_id);
                        return (
                    <div key={mapping.id} className="bg-slate-950 p-4 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors">
                      <div className="flex justify-between items-center mb-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-400">
                            S{mapping.speaker_id}
                          </div>
                          <span className="text-xs font-bold text-slate-200 uppercase tracking-wide">Voice cluster {mapping.speaker_id}</span>
                          {preview && (
                            <span className="text-[9px] text-slate-600 font-mono">
                              {preview.turn_count} turn{preview.turn_count !== 1 ? 's' : ''} · {Math.round(preview.total_duration)}s
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">Match: {mapping.confidence_pct}%</span>
                      </div>

                      {/* Inline sample if previews loaded */}
                      {preview && preview.sample_texts[0] && (
                        <p className="text-[10px] text-slate-500 italic mb-2 leading-relaxed line-clamp-2 border-l-2 border-slate-700 pl-2">
                          "{preview.sample_texts[0].length > 120 ? preview.sample_texts[0].slice(0, 120) + '…' : preview.sample_texts[0]}"
                        </p>
                      )}

                      <input
                        type="text"
                        value={mapping.mapped_name}
                        onChange={e => handleUpdateSpeaker(mapping.id, e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg px-3 py-2 text-xs text-white font-medium transition-colors"
                        placeholder="Map to actual name..."
                      />
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className="text-[10px] text-slate-500 mr-1 uppercase font-bold">Quick fill:</span>
                        {['THE REPORTER', 'THE WITNESS', 'COUNSEL', caseData.defense_attorney?.toUpperCase() ?? '', caseData.witness_full_name?.toUpperCase() ?? '']
                          .filter(Boolean)
                          .filter((v, i, a) => a.indexOf(v) === i)
                          .map((fill, i) => (
                            <button
                              key={i}
                              onClick={() => handleUpdateSpeaker(mapping.id, fill)}
                              className={`text-[10px] px-2.5 py-1 rounded-md border transition-colors ${
                                mapping.mapped_name.toUpperCase() === fill.toUpperCase()
                                  ? 'bg-sky-600/20 border-sky-500 text-sky-300 font-semibold'
                                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                              }`}
                            >
                              {fill}
                            </button>
                          ))}
                      </div>
                    </div>
                  );
                      }), // close groupMappings.map
                    ]; // close partGroups.flatMap return array
                  }); // close partGroups.flatMap
                })()} {/* close IIFE */}
              </div>

              <div className="mt-6 flex gap-3">
                <button onClick={() => setStep(1)} className="flex-1 py-3 border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-lg transition-colors">
                  Back to Setup
                </button>
                <button onClick={handleApplySpeakers} className="flex-1 py-3 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg shadow-md flex items-center justify-center gap-2 transition-all">
                  <Icons.Check /> Apply Mappings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Transcript Editor */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-center gap-3">
              <div className="w-8 h-8 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center shrink-0">
                <Icons.Check />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">Transcript Ready for Review</p>
                {job && (
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {job.word_count.toLocaleString()} words &nbsp;·&nbsp; {speakerMappings.length} speakers &nbsp;·&nbsp;
                    {job.low_confidence_count > 0
                      ? <span className="text-amber-400">{job.low_confidence_count} low-confidence segments</span>
                      : <span className="text-emerald-400">No low-confidence flags</span>
                    }
                  </p>
                )}
              </div>
              <span className="text-[10px] font-mono text-slate-500 shrink-0">v{job?.transcript_version ?? 1}</span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-400 leading-relaxed">
              <span className="font-bold text-slate-300">How to edit:</span> Double-click any utterance to edit its text.
              Click a speaker name to reassign. Use the review state dropdown to track your progress.
              All changes are saved and tracked automatically.
            </div>

            <button onClick={() => resetProcess()} className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 text-slate-400 text-xs font-semibold border border-slate-800 rounded-xl transition-colors">
              Start New Transcription Job
            </button>
          </div>
        )}
      </div>

      {/* Right Column: Editor in Step 4, Preview otherwise */}
      {step === 4 && job ? (
        <div className="flex-1 flex flex-col h-full overflow-hidden border-l border-slate-800">
          <TranscriptEditor
            job={job}
            utterances={utterances}
            speakerMappings={speakerMappings}
            caseData={caseData}
            reporters={reporters}
            onUtterancesChange={setUtterances}
            onExport={exportTranscript}
          />
        </div>
      ) : (
        <div className="flex-1 bg-slate-950 p-6 flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-800">
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Icons.Details /> Live Transcript Preview
              </h2>
              <p className="text-xs text-slate-400">
                {utterances.length > 0
                  ? `${utterances.length} utterance segments — ${job?.word_count ?? 0} words`
                  : 'Preview will populate as the job processes'}
              </p>
            </div>
          </div>

          <div className="flex-1 bg-slate-900/60 rounded-xl border border-slate-800 p-6 overflow-y-auto font-mono text-xs text-slate-300 leading-relaxed shadow-inner">
            <div className="border border-slate-800 p-4 rounded-lg bg-slate-950/40 mb-6 text-center text-slate-400 space-y-1">
              <p className="font-bold tracking-widest text-white">DEPOSITION OF {(caseData.witness_full_name ?? 'UNKNOWN WITNESS').toUpperCase()}</p>
              <p className="text-[10px]">CAUSE NO. {caseData.cause_number || '—'} | DATE: {caseData.deposition_date || '—'}</p>
              {currentReporter && <p className="text-[10px] italic">REPORTER: {currentReporter.name.toUpperCase()}</p>}
            </div>

            {utterances.length > 0 ? (
              <div className="space-y-4">
                {utterances.map((u, idx) => {
                  const isLowConf = u.confidence < 0.8;
                  const prevU = idx > 0 ? utterances[idx - 1] : null;
                  const showLabel = !prevU || prevU.speaker_id !== u.speaker_id;
                  const mappedName = getMappedName(u.speaker_id);
                  const role = getSpeakerRole(mappedName);
                  const qaMarker = role === 'Q' ? 'Q.' : role === 'A' ? 'A.' : null;
                  return (
                    <div key={u.id} className={`flex gap-4 p-2.5 rounded-lg hover:bg-slate-900/40 transition-colors ${isLowConf ? 'border-l-2 border-amber-500/40' : ''}`}>
                      <div className="w-36 shrink-0 select-none flex items-baseline gap-1.5">
                        {showLabel ? (
                          <>
                            {qaMarker && <span className="text-[11px] font-black text-slate-200 font-mono shrink-0">{qaMarker}</span>}
                            <span className="font-bold text-sky-400 tracking-wide text-[11px]">{mappedName}</span>
                          </>
                        ) : null}
                      </div>
                      <div className="flex-1">
                        <span className="text-slate-500 select-none mr-2">[{formatTime(u.start_time)}]</span>
                        <span className={isLowConf ? 'text-amber-300/80' : 'text-slate-200'}>
                          {u.corrected_transcript ?? u.transcript}
                        </span>
                        {isLowConf && (
                          <span className="ml-2 text-[9px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                            LOW CONF {Math.round(u.confidence * 100)}%
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-5">
                {[
                  { speaker: 'THE REPORTER', time: '00:00:00', text: 'We are on the record. Will counsel please state their appearances.' },
                  { speaker: 'COUNSEL', time: '00:00:11', text: 'Steven Nunez appearing on behalf of the defendants.' },
                  { speaker: 'THE REPORTER', time: '00:00:20', text: 'Will the witness please raise their right hand and state their name for the record.' },
                  { speaker: 'THE WITNESS', time: '00:00:32', text: 'My name is Heath Thomas.' },
                ].map((line, i) => (
                  <div key={i} className="flex gap-4 p-2.5 rounded-lg opacity-50">
                    <div className="w-28 shrink-0 font-bold text-sky-400 tracking-wide select-none text-[11px]">{line.speaker}</div>
                    <div className="flex-1">
                      <span className="text-slate-500 select-none mr-2">[{line.time}]</span>
                      {line.text}
                    </div>
                  </div>
                ))}
                <div className="mt-8 text-center text-slate-600 text-xs italic">
                  Upload and process an audio file to see the live transcript here
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
