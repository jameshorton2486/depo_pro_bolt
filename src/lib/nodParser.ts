// ============================================================================
// nodParser.ts — deterministic Notice of Deposition (NOD) text parser
// ============================================================================

import type {
  ParsedNOD,
  CaseInfo,
  DepositionDetails,
  AttorneyAppearance,
} from '../types/intake';
import { extractKeyterms } from './keytermExtractor';

// ────────────────────────────────────────────────────────────────────────────
// Text normalization
// ────────────────────────────────────────────────────────────────────────────

export function normalizePDFText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Collapse runs of spaces (but preserve newlines)
    .replace(/[^\S\n]+/g, ' ')
    // Remove soft-hyphen artifacts
    .replace(/\u00AD/g, '')
    // Normalize quotation marks
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .trim();
}

// ────────────────────────────────────────────────────────────────────────────
// Case info extraction
// ────────────────────────────────────────────────────────────────────────────

function parseCaseInfo(text: string): CaseInfo {
  const result: CaseInfo = {
    causeNumber: '',
    caseStyle: '',
    plaintiff: '',
    defendant: '',
    courtType: '',
    court: '',
    district: '',
    division: '',
    county: '',
    state: 'Texas',
  };

  // Cause / civil action number
  const causeMatch = text.match(
    /(?:CIVIL\s+ACTION\s+NO\.?|CAUSE\s+NO\.?|CASE\s+NO\.?)\s*:?\s*([A-Z0-9\-:]+(?:-[A-Z]+)?)/i,
  );
  if (causeMatch) result.causeNumber = causeMatch[1].trim();

  // Court type + name
  if (/UNITED\s+STATES\s+DISTRICT\s+COURT/i.test(text)) {
    result.courtType = 'federal';
    result.court = 'UNITED STATES DISTRICT COURT';
  } else if (/DISTRICT\s+COURT/i.test(text)) {
    result.courtType = 'state';
    result.court = 'DISTRICT COURT';
  } else if (/COUNTY\s+COURT/i.test(text)) {
    result.courtType = 'county';
    result.court = 'COUNTY COURT';
  }

  // District
  const districtMatch = text.match(
    /(?:WESTERN|EASTERN|NORTHERN|SOUTHERN|CENTRAL)\s+DISTRICT\s+OF\s+(?:TEXAS|[A-Z]+)/i,
  );
  if (districtMatch) result.district = districtMatch[0].trim();

  // Division
  const divisionMatch = text.match(/([A-Z\s]+)\s+DIVISION/i);
  if (divisionMatch) result.division = divisionMatch[1].trim() + ' DIVISION';

  // Plaintiff — look for the name that appears before "Plaintiff,"
  const plaintiffMatch = text.match(
    /^([A-Z][A-Z\s,\.]+?)\s*\n+\s*(?:Plaintiff|PLAINTIFF)/m,
  );
  if (plaintiffMatch) {
    result.plaintiff = plaintiffMatch[1].replace(/,\s*$/, '').trim();
  }

  // Defendant — name before "Defendant" or "Defendants"
  const defendantMatch = text.match(
    /vs?\.\s+(?:CIVIL[^\n]*\n+)?([A-Z][A-Z\s,\.\/\-&]+?)\s*\n+\s*(?:Defendant|DEFENDANT)/im,
  );
  if (defendantMatch) {
    result.defendant = defendantMatch[1]
      .replace(/,\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // State
  const stateMatch = text.match(/STATE\s+OF\s+([A-Z]+)/i);
  if (stateMatch) {
    result.state = capitalize(stateMatch[1]);
  } else if (/TEXAS/i.test(text)) {
    result.state = 'Texas';
  }

  // County
  const countyMatch = text.match(/([A-Z]+(?:\s+[A-Z]+)?)\s+COUNTY/i);
  if (countyMatch) result.county = capitalize(countyMatch[1]);

  // Build case style
  if (result.plaintiff && result.defendant) {
    result.caseStyle = `${result.plaintiff} v. ${result.defendant}`;
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Deposition details extraction
// ────────────────────────────────────────────────────────────────────────────

function parseDepositionDetails(text: string, caseInfo: CaseInfo): DepositionDetails {
  const result: DepositionDetails = {
    deponent: { name: '', role: 'Witness' },
    date: '',
    time: '',
    location: '',
    method: '',
    isZoom: false,
    noticeTitle: '',
  };

  // Notice title — e.g. "NOTICE OF INTENTION TO TAKE ... DEPOSITION OF HEATH THOMAS"
  const titleMatch = text.match(
    /NOTICE\s+OF\s+(?:INTENTION\s+TO\s+TAKE\s+)?(?:ORAL\s+\/?\s+)?(?:ZOOM\s+)?DEPOSITION\s+OF\s+([A-Z][A-Z\s]+)/i,
  );
  if (titleMatch) {
    result.noticeTitle = titleMatch[0].trim();
    result.deponent.name = titleMatch[1].trim();
  }

  // Deponent from structured "Deponent: Name" block
  const deponentMatch = text.match(/Deponent\s*:\s+([^\n]+)/i);
  if (deponentMatch) result.deponent.name = deponentMatch[1].trim();

  // Date
  const dateMatch = text.match(
    /Date\s*:\s+(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i,
  );
  if (dateMatch) result.date = dateMatch[1].replace(',', '').trim();

  // Time
  const timeMatch = text.match(/Time\s*:\s+(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?(?:\s*\(Central Time\))?)/i);
  if (timeMatch) {
    result.time = timeMatch[1]
      .replace(/\(Central Time\)/i, '')
      .replace(/\./g, '')
      .trim();
  }

  // Location / method
  const locationMatch = text.match(/Location\s*:\s+([^\n]+)/i);
  if (locationMatch) {
    const loc = locationMatch[1].trim();
    result.location = loc;
    if (/zoom/i.test(loc)) {
      result.isZoom = true;
      result.method = 'zoom';
    } else {
      result.method = 'in-person';
    }
  }

  // Check body text for Zoom mentions
  if (!result.isZoom && /via\s+zoom|zoom\s+deposition|remotely|video\s+teleconfer/i.test(text)) {
    result.isZoom = true;
    result.method = 'zoom';
  }

  // Fallback deponent from title
  if (!result.deponent.name && caseInfo.plaintiff) {
    result.deponent.name = caseInfo.plaintiff;
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Attorney appearances extraction
// ────────────────────────────────────────────────────────────────────────────

function parseAppearances(text: string, caseInfo: CaseInfo): AttorneyAppearance[] {
  const appearances: AttorneyAppearance[] = [];
  const seen = new Set<string>();

  // Each attorney block typically looks like:
  //   FIRM NAME, PLLC/P.C./etc
  //   Attorney Name
  //   State Bar No. NNNNNNN
  //   Address
  //   Phone: XXX-XXX-XXXX
  //   Email: xxx@xxx.com
  //   ATTORNEYS FOR PLAINTIFF/DEFENDANT

  // Split text into candidate blocks by double newlines
  const blocks = text.split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const combined = lines.join(' ');

    // Must contain a name-like pattern and some contact info
    const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(combined);
    const hasPhone = /\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}/.test(combined);
    const hasBarNo = /State\s+Bar\s+No\./i.test(combined);

    if (!hasEmail && !hasPhone && !hasBarNo) continue;

    const appearance = extractAttorneyBlock(lines, caseInfo);
    if (appearance && !seen.has(appearance.email.toLowerCase() + appearance.attorneyName.toLowerCase())) {
      seen.add(appearance.email.toLowerCase() + appearance.attorneyName.toLowerCase());
      appearances.push(appearance);
    }
  }

  // Fallback: scan for "TO: Defendant ... attorney of record, Name, FIRM" pattern
  const toMatch = text.match(
    /TO:\s+(?:Defendant|Plaintiff)[^,]*,\s+(?:by and through its attorney of record,\s+)?([A-Z][a-z]+(?:\s+[A-Z]\.?\s+[A-Z][a-z]+)?),\s+([A-Z][A-Z\s,&]+?(?:P\.C\.|PLLC|L\.L\.P|LLP|LLC))[,\.]?\s+([^\n]+)/i,
  );
  if (toMatch) {
    const name = toMatch[1].trim();
    const firm = toMatch[2].trim();
    const addressRaw = toMatch[3].trim();
    if (!seen.has(('' + name).toLowerCase())) {
      seen.add(name.toLowerCase());
      appearances.push({
        side: 'Defendant',
        attorneyName: name,
        firmName: firm,
        address: addressRaw,
        phone: '',
        email: '',
        represents: caseInfo.defendant || 'Defendant',
      });
    }
  }

  return appearances;
}

function extractAttorneyBlock(lines: string[], caseInfo: CaseInfo): AttorneyAppearance | null {
  const combined = lines.join(' ');
  const result: AttorneyAppearance = {
    side: 'Plaintiff',
    attorneyName: '',
    firmName: '',
    address: '',
    phone: '',
    email: '',
    represents: '',
  };

  // Determine side
  if (/ATTORNEYS?\s+FOR\s+DEFENDANT/i.test(combined)) {
    result.side = 'Defendant';
    result.represents = caseInfo.defendant || 'Defendant';
  } else if (/ATTORNEYS?\s+FOR\s+PLAINTIFF/i.test(combined)) {
    result.side = 'Plaintiff';
    result.represents = caseInfo.plaintiff || 'Plaintiff';
  }

  // Firm name — line ending in PLLC, P.C., LLC, LLP, P.C., etc.
  const firmPattern = /^([A-Z][A-Z\s,&\-\.\/]+(?:PLLC|P\.C\.|LLC|LLP|L\.L\.P\.|INC\.|CORP\.))\s*$/m;
  const firmMatch = lines.find(l => firmPattern.test(l));
  if (firmMatch) result.firmName = firmMatch.trim();

  // Attorney name — look for "/s/ Name" or "Name\nState Bar No."
  const sigMatch = combined.match(/\/s\/\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s+[A-Z][a-z]+)+)/);
  if (sigMatch) {
    result.attorneyName = sigMatch[1].trim();
  } else {
    // Look for all-caps NAME followed by State Bar or address pattern
    const capsNameMatch = combined.match(/\b([A-Z]{2,}(?:\s+[A-Z]\.?\s+[A-Z]{2,})+)\b/);
    if (capsNameMatch) {
      result.attorneyName = titleCase(capsNameMatch[1]);
    }
  }

  // State Bar No.
  const barMatch = combined.match(/State\s+Bar\s+No\.?\s*([0-9]+)/i);
  if (barMatch) result.stateBarNo = barMatch[1];

  // Phone
  const phoneMatch = combined.match(/(?:Tel|Phone|Ph)[\s.:]*(\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4})/i);
  if (phoneMatch) result.phone = phoneMatch[1].trim();

  // Email
  const emailMatch = combined.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) result.email = emailMatch[1].trim();

  // Address — lines that look like street address
  const addressLines: string[] = [];
  for (const line of lines) {
    if (/^\d+\s+[A-Z]/.test(line) || /(?:Suite|Ste\.?|Ave|Street|Blvd|Drive|Rd|Road|Place|Plaza)\b/i.test(line)) {
      addressLines.push(line);
    } else if (addressLines.length > 0 && /^[A-Z][a-z]+,?\s+[A-Z]{2}\s+\d{5}/.test(line)) {
      addressLines.push(line);
    }
  }
  result.address = addressLines.join(', ');

  if (!result.attorneyName && !result.firmName) return null;

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Main parser
// ────────────────────────────────────────────────────────────────────────────

export function parseNODText(rawText: string): ParsedNOD {
  const text = normalizePDFText(rawText);

  const caseInfo = parseCaseInfo(text);
  const depositionDetails = parseDepositionDetails(text, caseInfo);
  const appearances = parseAppearances(text, caseInfo);

  const { deepgramKeyterms, confirmedSpellings, phoneticMappings } =
    extractKeyterms({ caseInfo, depositionDetails, appearances });

  return {
    caseInfo,
    depositionDetails,
    appearances,
    reporterInfo: {},
    deepgramKeyterms,
    confirmedSpellings,
    phoneticMappings,
    rawText: text,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
