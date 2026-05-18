// ============================================================================
// keytermExtractor.ts — deterministic keyterm + phonetic mapping generation
// ============================================================================

import type {
  CaseInfo,
  DepositionDetails,
  AttorneyAppearance,
  PhoneticMapping,
} from '../types/intake';

interface ExtractInput {
  caseInfo: CaseInfo;
  depositionDetails: DepositionDetails;
  appearances: AttorneyAppearance[];
  additionalText?: string;
}

interface ExtractResult {
  deepgramKeyterms: string[];
  confirmedSpellings: string[];
  phoneticMappings: PhoneticMapping[];
}

// Common short words to skip (too generic to help Deepgram)
const STOPWORDS = new Set([
  'the', 'and', 'for', 'inc', 'llc', 'pllc', 'llp', 'plc', 'pc',
  'vs', 'via', 'per', 'pro', 'law', 'firm', 'sir', 'mrs', 'mr', 'ms',
  'dr', 'of', 'at', 'in', 'on', 'by', 'co', 'san', 'los',
]);

// ────────────────────────────────────────────────────────────────────────────
// Main extractor
// ────────────────────────────────────────────────────────────────────────────

export function extractKeyterms(input: ExtractInput): ExtractResult {
  const candidates = new Map<string, string>(); // lowercase key → original casing

  const add = (term: string) => {
    const t = term.trim();
    if (!t || t.length < 3) return;
    const key = t.toLowerCase();
    if (STOPWORDS.has(key)) return;
    if (!candidates.has(key)) candidates.set(key, t);
  };

  // ── Deponent name ─────────────────────────────────────────────────────────
  const deponentName = input.depositionDetails.deponent.name;
  if (deponentName) {
    add(deponentName);
    // Add each part of the name separately (surname priority)
    for (const part of splitName(deponentName)) add(part);
  }

  // ── Plaintiff & defendant names ───────────────────────────────────────────
  if (input.caseInfo.plaintiff) {
    add(input.caseInfo.plaintiff);
    for (const part of splitName(input.caseInfo.plaintiff)) add(part);
  }
  if (input.caseInfo.defendant) {
    // Split on A/K/A, AND, commas
    const parts = input.caseInfo.defendant
      .split(/\bA\/K\/A\b|,|\bAND\b/i)
      .map(p => p.trim())
      .filter(Boolean);
    for (const p of parts) {
      add(p);
      for (const sub of splitName(p)) add(sub);
    }
  }

  // ── Attorney names and firm names ─────────────────────────────────────────
  for (const app of input.appearances) {
    if (app.attorneyName) {
      add(app.attorneyName);
      for (const part of splitName(app.attorneyName)) add(part);
    }
    if (app.firmName) {
      add(app.firmName);
      // Also add each meaningful word in firm name
      for (const word of app.firmName.split(/[\s,&]+/)) {
        if (word.length > 3 && !/^(?:law|firm|pllc|llc|pllp|p\.c\.|attorneys|lawyers)$/i.test(word)) {
          add(word);
        }
      }
    }
  }

  // ── Court / location ──────────────────────────────────────────────────────
  if (input.caseInfo.division) add(input.caseInfo.division);

  // ── Additional free text scan ──────────────────────────────────────────────
  if (input.additionalText) {
    for (const term of scanForProperNouns(input.additionalText)) {
      add(term);
    }
  }

  // ── Build ordered output (surnames first, then full names, then firms) ────
  const deepgramKeyterms = orderKeyterms([...candidates.values()], input);

  // ── Confirmed spellings = unusual/non-English surnames ────────────────────
  const confirmedSpellings = deepgramKeyterms.filter(t => isUnusualSpelling(t));

  // ── Phonetic mappings ─────────────────────────────────────────────────────
  const phoneticMappings = buildPhoneticMappings(deepgramKeyterms);

  return { deepgramKeyterms, confirmedSpellings, phoneticMappings };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function splitName(name: string): string[] {
  // Returns surname + first name as separate tokens
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts;
  // Last part is typically the surname (highest priority)
  return [parts[parts.length - 1], name];
}

function orderKeyterms(terms: string[], input: ExtractInput): string[] {
  // Priority score: surname > full-name > firm > generic
  const score = (t: string): number => {
    const lower = t.toLowerCase();
    // Exact deponent surname = highest
    const deponentParts = input.depositionDetails.deponent.name.toLowerCase().split(/\s+/);
    if (deponentParts.includes(lower)) return 100;
    // Other names from parties/attorneys
    const plaintiffParts = input.caseInfo.plaintiff.toLowerCase().split(/\s+/);
    const defendantParts = input.caseInfo.defendant.toLowerCase().split(/\s+/);
    if (plaintiffParts.includes(lower) || defendantParts.includes(lower)) return 80;
    // Unusual spellings (hard to transcribe correctly)
    if (isUnusualSpelling(t)) return 70;
    // Firm names
    if (/pllc|p\.c\.|llc|llp/i.test(t)) return 40;
    return 50;
  };

  return [...new Set(terms)]
    .sort((a, b) => score(b) - score(a));
}

function scanForProperNouns(text: string): string[] {
  // Capture Title-cased words/phrases that are likely proper nouns
  const results: string[] = [];
  const matches = text.matchAll(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b/g);
  for (const m of matches) {
    const candidate = m[1].trim();
    if (candidate.split(/\s+/).length <= 4) results.push(candidate);
  }
  return results;
}

function isUnusualSpelling(term: string): boolean {
  // Flag terms that are phonetically tricky (uncommon letter combos for English)
  const lower = term.toLowerCase();
  const unusual = [
    /cukj/i, /ckj/i, /nez$/, /rado$/, /rber$/, /herber/i,
    /alvar/i, /piazz/i, /cozort/i, /nunez/i, /garza/i,
    /[aeiou]{3,}/, // triple vowel combos
    /xz|zx|bj|kj/i,
  ];
  return unusual.some(re => re.test(lower));
}

// Phonetic mappings: how Deepgram might mistranscribe → correct
const PHONETIC_RULES: Array<{ pattern: RegExp; misheard: (m: RegExpMatchArray) => string }> = [
  // Cukjati → Cookjati / Cook-jati
  { pattern: /cukjati/i, misheard: () => 'Cookjati' },
  { pattern: /cukjati/i, misheard: () => 'Cukeyati' },
  // Nunez → New-nez / Noon-ez
  { pattern: /nunez/i, misheard: () => 'Noonez' },
  { pattern: /nunez/i, misheard: () => 'New-nez' },
  // Herber → Herbert
  { pattern: /herber\b/i, misheard: () => 'Herbert' },
  // Alvarado → Alvaredo
  { pattern: /alvarado/i, misheard: () => 'Alvaredo' },
  // Piazza → Piaza
  { pattern: /piazza/i, misheard: () => 'Piaza' },
  // Garza → Garsa
  { pattern: /garza/i, misheard: () => 'Garsa' },
  // Cozort → Cosort
  { pattern: /cozort/i, misheard: () => 'Cosort' },
];

function buildPhoneticMappings(keyterms: string[]): PhoneticMapping[] {
  const mappings: PhoneticMapping[] = [];
  for (const term of keyterms) {
    for (const rule of PHONETIC_RULES) {
      if (rule.pattern.test(term)) {
        const m = term.match(rule.pattern);
        if (m) {
          const misheard = rule.misheard(m);
          if (misheard.toLowerCase() !== term.toLowerCase()) {
            mappings.push({ phonetic: misheard, correct: term });
          }
        }
      }
    }
  }
  return mappings;
}
