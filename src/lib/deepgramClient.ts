// ============================================================================
// deepgramClient.ts
// ----------------------------------------------------------------------------
// Direct browser → Deepgram client. Uses the async API which returns a
// request_id immediately, then we poll a separate endpoint until results are
// ready. No callback URL = no server required.
//
// SECURITY NOTE
// ─────────────
// This file uses VITE_DEEPGRAM_API_KEY from .env. Anything prefixed with
// VITE_ is baked into the JavaScript bundle and visible to anyone who opens
// DevTools. This is fine for local development on your own machine. For a
// production deployment, replace this with a tiny backend proxy (Node/Express,
// Cloudflare Worker, or even a single Vercel serverless function) that holds
// the key server-side and forwards requests.
// ============================================================================

const DEEPGRAM_API_BASE = 'https://api.deepgram.com/v1';

export interface DeepgramOptions {
  model: string;             // e.g. 'nova-3'
  smart_format: boolean;
  diarize: boolean;
  punctuate: boolean;
  utterances: boolean;
  filler_words: boolean;
  numerals: boolean;
  utt_split: number;
  keyterms: string[];
}

export interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
  punctuated_word?: string;
}

export interface DeepgramUtterance {
  start: number;
  end: number;
  confidence: number;
  channel: number;
  transcript: string;
  words: DeepgramWord[];
  speaker?: number;
  id: string;
}

export interface DeepgramResponse {
  metadata: {
    request_id: string;
    duration: number;
    channels: number;
    models: string[];
  };
  results: {
    channels: Array<{
      alternatives: Array<{
        transcript: string;
        confidence: number;
        words: DeepgramWord[];
      }>;
    }>;
    utterances?: DeepgramUtterance[];
  };
}

export const DEFAULT_OPTIONS: DeepgramOptions = {
  model: 'nova-3',
  smart_format: true,
  diarize: true,
  punctuate: true,
  utterances: true,
  filler_words: true,
  numerals: true,
  utt_split: 0.8,
  keyterms: [],
};

// ----------------------------------------------------------------------------
// buildQueryString — translate options to Deepgram's URL params.
// Nova-3 uses 'keyterm', Nova-2 uses 'keywords'. Phonetic mappings (a -> b)
// are post-processing concepts only; Deepgram has no native equivalent.
// ----------------------------------------------------------------------------
function buildQueryString(opts: DeepgramOptions): string {
  const params = new URLSearchParams();
  params.set('model', opts.model);
  params.set('language', 'en-US');
  if (opts.smart_format) params.set('smart_format', 'true');
  if (opts.diarize) params.set('diarize', 'true');
  if (opts.punctuate) params.set('punctuate', 'true');
  if (opts.utterances) params.set('utterances', 'true');
  if (opts.filler_words) params.set('filler_words', 'true');
  if (opts.numerals) params.set('numerals', 'true');
  if (opts.utt_split > 0) params.set('utt_split', String(opts.utt_split));

  const keyParamName = opts.model.startsWith('nova-3') ? 'keyterm' : 'keywords';
  for (const raw of opts.keyterms) {
    const term = raw.trim();
    if (!term || term.includes(' -> ')) continue;
    if (keyParamName === 'keyterm') {
      // Nova-3: no boost notation — strip any ":N" suffix
      const stripped = term.replace(/:\d+(\.\d+)?$/, '').trim();
      if (stripped) params.append('keyterm', stripped);
    } else {
      params.append('keywords', term);
    }
  }
  return params.toString();
}

// ----------------------------------------------------------------------------
// transcribe — submit audio synchronously and wait for the response.
// Deepgram's sync endpoint blocks the HTTP connection until processing is
// done. For depositions under ~30 minutes this typically returns in 5-15
// seconds. For longer files, use transcribeAsync() instead.
// ----------------------------------------------------------------------------
export async function transcribe(
  audioBlob: Blob,
  options: Partial<DeepgramOptions> = {},
  apiKey?: string,
): Promise<DeepgramResponse> {
  const key = apiKey ?? import.meta.env.VITE_DEEPGRAM_API_KEY;
  if (!key) {
    throw new Error(
      'VITE_DEEPGRAM_API_KEY is not set. Add it to your .env file.',
    );
  }

  const fullOpts: DeepgramOptions = { ...DEFAULT_OPTIONS, ...options };
  const url = `${DEEPGRAM_API_BASE}/listen?${buildQueryString(fullOpts)}`;

  console.log('[Deepgram] sending blob — size MB:', (audioBlob.size / 1024 / 1024).toFixed(2), '| type:', audioBlob.type || '(none)');
  console.log('[Deepgram] url:', url);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${key}`,
      'Content-Type': audioBlob.type || 'audio/wav',
    },
    body: audioBlob,
  });

  console.log('[Deepgram] response status:', res.status);

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[Deepgram] error body:', errText.slice(0, 400));
    throw new Error(`Deepgram error ${res.status}: ${errText.slice(0, 400)}`);
  }

  const data = (await res.json()) as DeepgramResponse;
  console.log('[Deepgram] response json:', data);
  return data;
}

// ----------------------------------------------------------------------------
// parseUtterances — extract a flat array of utterances from Deepgram's
// response, falling back to grouping words by speaker if `utterances: true`
// wasn't enabled.
// ----------------------------------------------------------------------------
export interface ParsedUtterance {
  id: string;
  sequence_index: number;
  speaker_id: number;
  start_time: number;
  end_time: number;
  transcript: string;
  confidence: number;
}

export function parseUtterances(response: DeepgramResponse): ParsedUtterance[] {
  const utts = response.results.utterances;
  if (utts && utts.length > 0) {
    return utts.map((u, i) => ({
      id: u.id ?? `utt_${i}`,
      sequence_index: i,
      speaker_id: u.speaker ?? 0,
      start_time: u.start,
      end_time: u.end,
      transcript: u.transcript,
      confidence: u.confidence,
    }));
  }

  // Fallback: group consecutive words by speaker
  const words = response.results.channels?.[0]?.alternatives?.[0]?.words ?? [];
  const grouped: ParsedUtterance[] = [];
  let current: ParsedUtterance | null = null;
  let seq = 0;

  for (const w of words) {
    const speaker = w.speaker ?? 0;
    if (!current || current.speaker_id !== speaker) {
      if (current) grouped.push(current);
      current = {
        id: `utt_${seq}`,
        sequence_index: seq++,
        speaker_id: speaker,
        start_time: w.start,
        end_time: w.end,
        transcript: w.punctuated_word ?? w.word,
        confidence: w.confidence,
      };
    } else {
      current.end_time = w.end;
      current.transcript += ' ' + (w.punctuated_word ?? w.word);
      // Average confidence across the utterance
      current.confidence = (current.confidence + w.confidence) / 2;
    }
  }
  if (current) grouped.push(current);

  return grouped;
}
