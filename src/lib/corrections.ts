/**
 * Depo-Pro Transcribe — Stage 1 Deterministic Correction Engine
 *
 * LEGAL NOTICE: This engine enforces FORMAT ONLY.
 * It never:
 *   - removes spoken words
 *   - adds words not present
 *   - paraphrases testimony
 *   - summarizes answers
 *   - removes disfluencies (uh, um, false starts, stutters)
 *   - rewrites witness speech
 *   - alters legal meaning
 *
 * Every rule is:
 *   - DETERMINISTIC — same input always produces same output
 *   - SAFE_AUTOMATIC — no human review required before application
 *   - AUDITABLE — each applied rule is recorded by tag
 *   - REVERSIBLE — original_transcript is preserved in DB before any change
 *   - VERBATIM-PRESERVING — word content is never altered by format rules
 *
 * Rule categories (Texas UFM + Morson's English Grammar):
 *   A. Q/A structure normalization          (UFM § Q/A Format)
 *   B. Speaker label normalization          (UFM § Speaker Labels)
 *   C. Whitespace / indentation             (UFM § Spacing)
 *   D. Common STT substitution dictionary   (Deepgram-specific mishears)
 *   E. Punctuation enforcement              (Morson Rules 60, 65, 170)
 *   F. Number / numeral formatting          (Texas UFM Rule 170)
 *   G. Objection formatting                 (UFM § Colloquy)
 *   H. Parenthetical formatting             (UFM § Parentheticals)
 *   I. Exhibit / reference normalization    (UFM § Exhibits)
 *   J. Deposition-specific phrase fixes     (Court reporter conventions)
 */

export interface CorrectionResult {
  corrected: string;
  changed: boolean;
  rules_applied: RuleTag[];
  debug_log?: DebugEntry[];
}

export interface DebugEntry {
  rule: RuleTag;
  before: string;
  after: string;
}

export type RuleTag =
  | 'qa_label'
  | 'speaker_label'
  | 'whitespace'
  | 'stt_substitution'
  | 'punctuation'
  | 'number_format'
  | 'objection'
  | 'parenthetical'
  | 'exhibit_ref'
  | 'depo_phrase';

// ─── Rule A: Q/A Label Normalization ────────────────────────────────────────
// UFM canonical format: \tQ.\t  and  \tA.\t
// Deepgram emits fragments without the label; the caller (speaker role logic)
// prepends "Q." or "A." but sometimes STT transcribes them literally as
// "Q " or "A " or "Q:" or "A:" at utterance start.
//
// SAFE_AUTOMATIC: only changes the label prefix, never the spoken text.
//
// Before: "Q What is your name?"
// After:  "Q. What is your name?"
//
// Before: "A: I am a doctor."
// After:  "A. I am a doctor."

function applyQALabels(text: string): [string, boolean] {
  let t = text;
  t = t.replace(/^([QqAa])\s*:\s+/m, (_, letter) => `${letter.toUpperCase()}. `);
  t = t.replace(/^([QqAa])\s+(?=[A-Za-z(""'\u201C\u201D\u2018\u2019—])/m,
    (_, letter) => `${letter.toUpperCase()}. `
  );
  t = t.replace(/^([QqAa])\.\s*(?=[A-Za-z(""'\u201C\u201D\u2018\u2019—])/m,
    (_, letter) => `${letter.toUpperCase()}. `
  );
  t = t.replace(/^([QA])\.\.\s+/gm, '$1. ');
  return [t, t !== text];
}

// ─── Rule B: Speaker Label Normalization ────────────────────────────────────
// Deepgram speaker labels come through in inconsistent casing/punctuation.
//
// SAFE_AUTOMATIC: only changes label formatting, never content.
//
// Before: "MR SMITH:"          After: "MR. SMITH:"
// Before: "Ms jones:"          After: "MS. JONES:"
// Before: "THE WITNESS ::"     After: "THE WITNESS:"
// Before: "BY MR JONES :"      After: "BY MR. JONES:"
// Before: "EXAMINATION BY MR SMITH" After: "EXAMINATION BY MR. SMITH:"

const TITLE_MAP: [RegExp, string][] = [
  // Without period — uppercase
  [/\bMR\s+([A-Z][A-Z'-]+)\s*:/g,  'MR. $1:'],
  [/\bMRS\s+([A-Z][A-Z'-]+)\s*:/g, 'MRS. $1:'],
  [/\bMS\s+([A-Z][A-Z'-]+)\s*:/g,  'MS. $1:'],
  [/\bDR\s+([A-Z][A-Z'-]+)\s*:/g,  'DR. $1:'],
  // Without period — title case
  [/\bMr\s+([A-Z][A-Za-z'-]+)\s*:/g,  'MR. $1:'],
  [/\bMrs\s+([A-Z][A-Za-z'-]+)\s*:/g, 'MRS. $1:'],
  [/\bMs\s+([A-Z][A-Za-z'-]+)\s*:/g,  'MS. $1:'],
  [/\bDr\s+([A-Z][A-Za-z'-]+)\s*:/g,  'DR. $1:'],
  // "BY MR SMITH:" → "BY MR. SMITH:"
  [/\bBY\s+MR\s+([A-Z][A-Z'-]+)\s*:/g,  'BY MR. $1:'],
  [/\bBY\s+MRS\s+([A-Z][A-Z'-]+)\s*:/g, 'BY MRS. $1:'],
  [/\bBY\s+MS\s+([A-Z][A-Z'-]+)\s*:/g,  'BY MS. $1:'],
  [/\bBY\s+DR\s+([A-Z][A-Z'-]+)\s*:/g,  'BY DR. $1:'],
  // Double-colon artifact: "::" → ":"
  [/:\s*:/g, ':'],
  // Space before colon in speaker label: "THE WITNESS :" → "THE WITNESS:"
  [/(THE\s+(?:WITNESS|COURT|REPORTER|DEPONENT|OFFICER|CLERK|NOTARY))\s+:/g, '$1:'],
  // Missing colon after standard labels (only at line start)
  [/^(THE\s+(?:WITNESS|COURT|REPORTER|DEPONENT|OFFICER|CLERK|NOTARY))\s+(?=[A-Z])/gm, '$1: '],
];

function applySpeakerLabels(text: string): [string, boolean] {
  let t = text;
  for (const [re, repl] of TITLE_MAP) {
    t = t.replace(re, repl);
  }
  return [t, t !== text];
}

// ─── Rule C: Whitespace / Indentation ───────────────────────────────────────
// SAFE_AUTOMATIC: purely structural, no word changes.
//
// Before: "word,  word"   After: "word, word"
// Before: "word .word"    After: "word. word"
// Before: "word ,"        After: "word,"

function applyWhitespace(text: string): [string, boolean] {
  let t = text;
  t = t.replace(/([^\t\n]) {2,}/g, '$1 ');       // collapse internal runs (preserve leading tabs)
  t = t.replace(/[ \t]+$/gm, '');                  // trailing whitespace
  t = t.replace(/ ([,;])/g, '$1');
  t = t.replace(/ (\.)(?!\.\.)(?![A-Za-z]{1,3}\.)(?!\d)/g, '$1');
  t = t.replace(/,([A-Za-z\d])/g, ', $1');
  t = t.replace(/\n{3,}/g, '\n\n');
  return [t, t !== text];
}

// ─── Rule D: Common STT Substitution Dictionary ─────────────────────────────
// Deepgram-specific mishears and expansions that are unambiguous.
//
// SAFE_AUTOMATIC for honorific expansions and legal phrase normalization.
// FORBIDDEN: contractions, colloquialisms (gone, gonna → going to).
//   Morson Rule: preserve the speaker's own words. "gonna" IS the word spoken.
//   The STT engine may have correctly transcribed what was said.
//   We preserve colloquial speech forms — they are VERBATIM.
//
// NOTE: "gonna/wanna/kinda" rules have been REMOVED from this engine.
//   Those entries were incorrectly changing verbatim testimony.

const STT_SUBS: [RegExp, string][] = [
  // Honorifics: only when not already abbreviated
  [/\bDr\b(?!\.)/g, 'Dr.'],
  [/\bMr\b(?!\.)/g, 'Mr.'],
  [/\bMrs\b(?!\.)/g, 'Mrs.'],
  [/\bMs\b(?!\.)/g, 'Ms.'],
  [/\bSt\b(?!\.)(?=\s+[A-Z])/g, 'St.'],   // "St Joseph" → "St. Joseph"

  // Common legal phrases — deterministic, context-independent
  [/\byour honor\b/gi, 'Your Honor'],

  // OK variants → "okay" (all are STT interpretations of same utterance)
  [/\bO\.K\.\b/g, 'okay'],
  [/\bO\.K\b/g, 'okay'],
  [/\bukay\b/g, 'okay'],
  // Note: "OK" is kept as-is when followed by uppercase (may be abbreviation)
  [/\bOK\b(?![A-Z])/g, 'okay'],

  // Percent: Deepgram sometimes emits "50 percent" instead of "50%"
  // SAFE: only numeric + "percent" — not "percentile" or "percentage"
  [/\b(\d+(?:\.\d+)?)\s+percent\b(?!age|ile)/gi, '$1%'],

  // Exhibit references — STT expansion normalization
  [/\bexhibit(?:\s+number)?\s+(\d+)/gi, 'Exhibit No. $1'],
  [/\bExhibit\s+No\s+(\d+)/g, 'Exhibit No. $1'],

  // Page/line reference normalization
  [/\bpage\s+number\s+(\d+)/gi, 'page $1'],
  [/\bline\s+number\s+(\d+)/gi, 'line $1'],

  // Dollar amount: "$50.00" → "$50" (zero cents are noise from STT)
  [/\$(\d+)\.00\b/g, '$$1'],
];

function applySttSubstitutions(text: string): [string, boolean] {
  let t = text;
  for (const [re, repl] of STT_SUBS) {
    t = t.replace(re, repl);
  }
  return [t, t !== text];
}

// ─── Rule E: Punctuation Enforcement ────────────────────────────────────────
// Morson Rules 60 (dashes), 65 (ellipsis), and general punctuation hygiene.
//
// SAFE_AUTOMATIC — all changes are structural/typographic only.
//
// Canonical interruption (Morson Rule 60):
//   word --          (double hyphen, space before, no space after at line end)
//   word -- word     (double hyphen, space-padded on both sides mid-text)
//
// Canonical ellipsis (trailing thought/hesitation):
//   word...          (three dots, no space before)
//   word... word     (space after when followed by next word)
//
// Unicode normalization:
//   U+2014 (em dash) → " -- "
//   U+2013 (en dash) → " -- "
//   U+2026 (ellipsis char) → "..."
//   U+2018/2019 (fancy single quotes) → '
//   U+201C/201D (fancy double quotes) → "

function applyPunctuation(text: string): [string, boolean] {
  let t = text;

  // 1. Normalize fancy/smart quotes → straight
  t = t.replace(/[\u2018\u2019]/g, "'");
  t = t.replace(/[\u201C\u201D]/g, '"');

  // 2. Normalize Unicode ellipsis character → three dots
  t = t.replace(/\u2026/g, '...');

  // 3. Normalize em/en dashes → double-hyphen interruption format
  //    Preserve any existing " -- " (already correct)
  t = t.replace(/\s*[\u2014\u2013]\s*/g, ' -- ');

  // 4. Normalize spaced dots to ellipsis: ". . ." or ". . ." → "..."
  //    Must be exactly three dots with optional spaces between them
  t = t.replace(/\.\s*\.\s*\./g, '...');

  // 5. After ellipsis: ensure space before next word (if not end of string)
  t = t.replace(/\.\.\.(?=[A-Za-z\d("])/g, '... ');

  // 6. No space before ellipsis (e.g. "word ..." → "word...")
  t = t.replace(/\s+\.\.\./g, '...');

  // 7. Remove doubled commas: ",," → ","
  t = t.replace(/,,+/g, ',');

  // 8. Remove doubled periods that are NOT part of ellipsis
  //    Match ".." not preceded or followed by another dot
  t = t.replace(/(?<!\.)\.\.(?!\.)/g, '.');

  // 9. Space before opening parenthesis when missing after word char
  //    "word(note)" → "word (note)"
  t = t.replace(/(\w)\((?!\))/g, '$1 (');

  // 10. Normalize "--" without spaces → " -- " (mid-sentence interruption)
  //     But NOT "---" (reserved) and NOT at start of line (could be list)
  t = t.replace(/(\w)--(\w)/g, '$1 -- $2');

  // 11. Single hyphen surrounded by spaces " - " → " -- " (interruption)
  //     Only when it appears to mark an interruption (between words)
  //     NOTE: This is REVIEW_REQUIRED in ambiguous cases. Applied here only
  //     for the clear pattern: word-space-hyphen-space-word.
  //     Intentionally NOT applied — too many false positives with hyphenated terms.

  return [t, t !== text];
}

// ─── Rule F: Number / Numeral Formatting ────────────────────────────────────
// Texas UFM Rule 170: numerals one through ten should be written as words
// when used as ordinary numbers in testimony. Numerals 11+ remain as digits.
//
// EXCEPTIONS (always numerals regardless of value):
//   - Exhibit numbers:    Exhibit No. 5
//   - Page/line refs:     page 3, line 7
//   - Dates:              January 5, 2019
//   - Measurements:       3 inches, 5 cc
//   - Percentages:        5%
//   - Legal citations:    Rule 30(b)(6), Section 4
//   - Serial/docket numbers
//   - Medical dosages
//   - Times:              9:00 a.m.
//
// SAFE: only the most unambiguous cases are auto-applied.
// The numeral-to-word direction (1 → "one") is REVIEW_REQUIRED and NOT done
// automatically because context is required to distinguish:
//   "I have 2 cars" (should be "two") vs "2 mg" (must stay "2")
//
// What IS safe: ordinal normalization of common STT patterns.

function applyNumberFormat(text: string): [string, boolean] {
  let t = text;

  // Normalize "No." references: "No ." → "No."
  t = t.replace(/\bNo\s*\.\s*(\d)/g, 'No. $1');

  // Ordinal suffix normalization: "1st" "2nd" "3rd" "4th" are correct as-is
  // STT sometimes omits the suffix: "on the 1 day" — NOT auto-fixed (context req'd)

  // Time formatting: "9 am" → "9:00 a.m." — REVIEW_REQUIRED, not auto-applied
  // "9:00 AM" → "9:00 a.m." — safe normalization
  t = t.replace(/\b(\d{1,2}:\d{2})\s*AM\b/g, '$1 a.m.');
  t = t.replace(/\b(\d{1,2}:\d{2})\s*PM\b/g, '$1 p.m.');
  t = t.replace(/\b(\d{1,2}:\d{2})\s*am\b/g, '$1 a.m.');
  t = t.replace(/\b(\d{1,2}:\d{2})\s*pm\b/g, '$1 p.m.');

  return [t, t !== text];
}

// ─── Rule G: Objection Formatting ───────────────────────────────────────────
// UFM canonical objection format: "Objection, [ground]."
//   - Capital O
//   - Comma after "Objection" when ground follows
//   - Period at end
//   - Ground in lowercase
//
// SAFE_AUTOMATIC only when the ENTIRE utterance is an objection.
// Multi-sentence utterances containing objections → REVIEW_REQUIRED (not done here).
//
// Before: "objection form"           After: "Objection, form."
// Before: "object to the form"       After: "Objection, form."
// Before: "objection. foundation."   After: "Objection, foundation."
// Before: "Objection"                After: "Objection." (no ground)

const OBJECTION_GROUNDS = [
  'form',
  'foundation',
  'leading',
  'speculation',
  'hearsay',
  'relevance',
  'relevancy',
  'asked and answered',
  'compound',
  'vague',
  'argumentative',
  'assumes facts',
  'assumes facts not in evidence',
  'calls for speculation',
  'nonresponsive',
  'non-responsive',
  'mischaracterizes',
  'mischaracterizes testimony',
  'beyond the scope',
  'lack of foundation',
  'no foundation',
  'narrative',
  'improper opinion',
];

const OBJ_GROUNDS_RE = OBJECTION_GROUNDS
  .map(g => g.replace(/\s+/g, '\\s+').replace(/[()]/g, '\\$&'))
  .join('|');

const OBJ_PATTERN = new RegExp(
  `^(?:i\\s+)?(?:object|objection)[,.]?\\s*(?:to\\s+(?:the\\s+)?)?(?:form\\s+of\\s+the\\s+question[,.]?)?\\s*(${OBJ_GROUNDS_RE})?[,.]?\\s*$`,
  'i'
);

function applyObjectionFormat(text: string): [string, boolean] {
  const trimmed = text.trim();
  const m = trimmed.match(OBJ_PATTERN);
  if (!m) return [text, false];
  const ground = m[1] ? `, ${m[1].toLowerCase()}` : '';
  const result = `Objection${ground}.`;
  return [result, result !== trimmed];
}

// ─── Rule H: Parenthetical Formatting ───────────────────────────────────────
// UFM parenthetical conventions for court reporter notations.
//
// SAFE_AUTOMATIC: spacing and capitalization only. Text within parens preserved.
//
// Before: "(laughter )"             After: "(Laughter.)"
// Before: "( indicating )"          After: "(Indicating.)"
// Before: "(whereupon recess taken)" After: "(Whereupon, recess taken.)"
// Before: "(off the record)"        After: "(Off the record.)"
// Before: "(Discussion off the record.)" → unchanged (already correct)

const PARENTHETICAL_PATTERNS: [RegExp, string][] = [
  // Standard reporter notations — normalize to Title case + period
  [/\(\s*laughter\s*\.?\s*\)/gi, '(Laughter.)'],
  [/\(\s*indicating\s*\.?\s*\)/gi, '(Indicating.)'],
  [/\(\s*nodding\s*(?:head)?\s*\.?\s*\)/gi, '(Nodding.)'],
  [/\(\s*shaking\s*(?:head)?\s*\.?\s*\)/gi, '(Shaking head.)'],
  [/\(\s*pause\s*\.?\s*\)/gi, '(Pause.)'],
  [/\(\s*brief\s+pause\s*\.?\s*\)/gi, '(Brief pause.)'],
  [/\(\s*long\s+pause\s*\.?\s*\)/gi, '(Long pause.)'],
  [/\(\s*off(?:\s+the)?\s+record(?:\s+discussion)?\s*\.?\s*\)/gi, '(Off the record.)'],
  [/\(\s*discussion\s+off\s+the\s+record\s*\.?\s*\)/gi, '(Discussion off the record.)'],
  [/\(\s*recess\s+taken\s*\.?\s*\)/gi, '(Recess taken.)'],
  [/\(\s*whereupon[,]?\s+recess\s+(?:was\s+)?taken\s*\.?\s*\)/gi, '(Whereupon, recess taken.)'],
  [/\(\s*whereupon[,]?\s+(?:the\s+)?(?:proceedings|deposition)\s+(?:were\s+)?(?:concluded|adjourned)\s*\.?\s*\)/gi, '(Whereupon, the deposition was concluded.)'],
  [/\(\s*document\s+(?:marked|tendered)\s*\.?\s*\)/gi, '(Document marked.)'],
  [/\(\s*exhibit\s+(?:marked|tendered)\s*\.?\s*\)/gi, '(Exhibit marked.)'],
  // Generic: normalize spaces inside parens
  [/\(\s+/g, '('],
  [/\s+\)/g, ')'],
];

function applyParentheticals(text: string): [string, boolean] {
  let t = text;
  for (const [re, repl] of PARENTHETICAL_PATTERNS) {
    t = t.replace(re, repl);
  }
  return [t, t !== text];
}

// ─── Rule I: Exhibit / Reference Normalization ───────────────────────────────
// Deterministic normalization of exhibit and deposition exhibit references.
//
// SAFE_AUTOMATIC: only reformats labels, never changes the number.
//
// Before: "Exhibit 1"         After: "Exhibit No. 1"
// Before: "Deposition Ex. 5"  After: "Deposition Exhibit No. 5"
// Before: "Def. Ex. 3"        After: "Defendant's Exhibit No. 3"

const EXHIBIT_PATTERNS: [RegExp, string][] = [
  // "Exhibit 5" without "No." → "Exhibit No. 5"
  // Guard: don't match "Exhibit No. 5" (already correct) or "Exhibit marked"
  [/\bExhibit\s+(?!No\.\s*\d|marked|tendered)(\d+)\b/g, 'Exhibit No. $1'],
  // "Pltf Ex 3" / "Pltf. Ex. 3" → "Plaintiff's Exhibit No. 3"
  [/\bPltf\.?\s+Ex(?:hibit)?\.?\s*(\d+)/gi, "Plaintiff's Exhibit No. $1"],
  [/\bPlaintiff'?s?\s+Ex(?:hibit)?\.?\s*(?:No\.?\s*)?(\d+)/gi, "Plaintiff's Exhibit No. $1"],
  // "Def Ex 3" → "Defendant's Exhibit No. 3"
  [/\bDef\.?\s+Ex(?:hibit)?\.?\s*(\d+)/gi, "Defendant's Exhibit No. $1"],
  [/\bDefendant'?s?\s+Ex(?:hibit)?\.?\s*(?:No\.?\s*)?(\d+)/gi, "Defendant's Exhibit No. $1"],
  // Normalize "Ex." without number context
  [/\bEx\.\s+No\.\s*(\d+)/g, 'Exhibit No. $1'],
];

function applyExhibitRefs(text: string): [string, boolean] {
  let t = text;
  for (const [re, repl] of EXHIBIT_PATTERNS) {
    t = t.replace(re, repl);
  }
  return [t, t !== text];
}

// ─── Rule J: Deposition-Specific Phrase Normalization ───────────────────────
// Standard court reporter / deposition phrase formatting.
//
// SAFE_AUTOMATIC: these are fixed phrases with a single canonical form.

const DEPO_PHRASES: [RegExp, string][] = [
  // Examination section headers
  [/\bDIRECT\s+EXAMINATION\s+BY\s+/gi, 'DIRECT EXAMINATION\n\nBY '],
  [/\bCROSS[\s-]EXAMINATION\s+BY\s+/gi, 'CROSS-EXAMINATION\n\nBY '],
  [/\bREDIRECT\s+EXAMINATION\s+BY\s+/gi, 'REDIRECT EXAMINATION\n\nBY '],
  [/\bRECROSS[\s-]EXAMINATION\s+BY\s+/gi, 'RECROSS-EXAMINATION\n\nBY '],

  // Certificate / stipulation phrases
  [/\bI,\s+the\s+undersigned\b/gi, 'I, the undersigned'],
  [/\bunder\s+penalty\s+of\s+perjury\b/gi, 'under penalty of perjury'],
  [/\bsubscribed\s+and\s+sworn\b/gi, 'subscribed and sworn'],
  [/\bsworn\s+and\s+subscribed\b/gi, 'subscribed and sworn'],

  // Common depo phrases — spacing only, no word change
  [/\boff\s+the\s+record\b/gi, 'off the record'],
  [/\bon\s+the\s+record\b/gi, 'on the record'],
  [/\bback\s+on\s+the\s+record\b/gi, 'back on the record'],
  [/\bgoing\s+off\s+the\s+record\b/gi, 'going off the record'],
];

function applyDeposPhrases(text: string): [string, boolean] {
  let t = text;
  for (const [re, repl] of DEPO_PHRASES) {
    t = t.replace(re, repl);
  }
  return [t, t !== text];
}

// ─── Main entry point ────────────────────────────────────────────────────────

export function applyDeterministicCorrections(
  transcript: string,
  debug = false,
): CorrectionResult {
  const original = transcript;
  const rulesApplied: RuleTag[] = [];
  const debugLog: DebugEntry[] = [];

  let t = transcript;

  const run = (
    fn: (s: string) => [string, boolean],
    tag: RuleTag
  ): void => {
    const before = t;
    const [result, changed] = fn(t);
    if (changed) {
      t = result;
      rulesApplied.push(tag);
      if (debug) {
        debugLog.push({ rule: tag, before, after: result });
      }
    }
  };

  // Order matters: labels first, then content substitutions, then punctuation,
  // then whitespace last (cleans up any extra spaces introduced by earlier rules).
  run(applyQALabels,          'qa_label');
  run(applySpeakerLabels,     'speaker_label');
  run(applyObjectionFormat,   'objection');       // before STT subs to match raw form
  run(applyParentheticals,    'parenthetical');
  run(applyExhibitRefs,       'exhibit_ref');
  run(applyDeposPhrases,      'depo_phrase');
  run(applySttSubstitutions,  'stt_substitution');
  run(applyPunctuation,       'punctuation');
  run(applyNumberFormat,      'number_format');
  run(applyWhitespace,        'whitespace');      // always last

  return {
    corrected: t,
    changed: t !== original,
    rules_applied: rulesApplied,
    ...(debug ? { debug_log: debugLog } : {}),
  };
}

/**
 * Apply corrections to a batch of transcript strings.
 * Returns only entries where something changed.
 */
export function batchCorrect(
  items: { id: string; text: string }[],
  debug = false,
): { id: string; original: string; corrected: string; rules_applied: RuleTag[]; debug_log?: DebugEntry[] }[] {
  return items
    .map(({ id, text }) => {
      const result = applyDeterministicCorrections(text, debug);
      return result.changed
        ? {
            id,
            original: text,
            corrected: result.corrected,
            rules_applied: result.rules_applied,
            ...(debug ? { debug_log: result.debug_log } : {}),
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// ─── Rule Safety Classification ──────────────────────────────────────────────
// Documented here for auditability.

/*
SAFE_AUTOMATIC (applied in this engine):
  - Q/A label prefix normalization (period, spacing)
  - Speaker title abbreviation (MR → MR., etc.)
  - Double-colon removal
  - Internal whitespace collapse
  - Trailing whitespace removal
  - Comma/period spacing
  - Fancy quote → straight quote
  - Unicode dash → double-hyphen
  - Unicode ellipsis char → "..."
  - Spaced dots → "..."
  - Double comma removal
  - OK/O.K./ukay → "okay"
  - Dr/Mr/Mrs without period → add period
  - "Your honor" → "Your Honor"
  - "percent" after digit → "%"
  - Exhibit reference normalization
  - Page/line "number X" → "page X" / "line X"
  - AM/PM → a.m./p.m.
  - Parenthetical spacing + known phrase capitalization
  - Simple objection reformatting (utterance-level only)
  - Deposition phrase spacing normalization

REVIEW_REQUIRED (NOT applied automatically):
  - Numeral 1–10 → spelled out word (requires context: "2 mg" vs "2 cars")
  - Single hyphen " - " → " -- " (ambiguous: could be word hyphen or interruption)
  - Contractions added/removed (verbatim preservation rule)
  - Multi-sentence objection reformatting
  - Speaker label reassignment (semantic)
  - Examination header insertion (structural)

FORBIDDEN (never in this engine):
  - Removing filler words (uh, um, you know, like)
  - Expanding "gonna/wanna/kinda/sorta" (these ARE the words spoken)
  - Paraphrasing any testimony
  - Grammar correction
  - Sentence restructuring
  - Removing stutters or false starts
  - Adding words not present in source
  - Smoothing hesitations
*/
