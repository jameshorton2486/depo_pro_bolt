// ============================================================================
// reporterNotesParser.ts — parse court reporter worksheet / intake notes PDF
// ============================================================================

import type {
  ParsedReporterNotes,
  ReporterInfo,
  ReporterJobDetails,
  BillingInfo,
  CopyOrder,
} from '../types/intake';
import { normalizePDFText } from './nodParser';
import { extractKeyterms } from './keytermExtractor';

// ────────────────────────────────────────────────────────────────────────────
// Main parser
// ────────────────────────────────────────────────────────────────────────────

export function parseReporterNotes(rawText: string): ParsedReporterNotes {
  const text = normalizePDFText(rawText);

  const reporter = parseReporterInfo(text);
  const jobDetails = parseJobDetails(text, reporter);
  const billing = parseBilling(text);

  // Extract keyterms from names in the notes
  const fakeInput = {
    caseInfo: {
      causeNumber: '',
      caseStyle: billing.orderingFirm + ' ' + jobDetails.location,
      plaintiff: extractCaseStyle(text, 'plaintiff'),
      defendant: extractCaseStyle(text, 'defendant'),
      courtType: '' as const,
      court: '',
      district: '',
      division: '',
      county: '',
      state: 'Texas',
    },
    depositionDetails: {
      deponent: { name: parseDeponent(text), role: 'Witness' },
      date: jobDetails.date,
      time: jobDetails.scheduledStartTime,
      location: jobDetails.location,
      method: jobDetails.location.toLowerCase().includes('zoom') ? 'zoom' as const : 'in-person' as const,
      isZoom: /zoom/i.test(jobDetails.location),
      noticeTitle: '',
    },
    appearances: billing.copyOrders.map(o => ({
      side: 'Plaintiff' as const,
      attorneyName: o.attorneyName,
      firmName: o.firmName,
      address: o.address,
      phone: o.phone,
      email: o.email,
      represents: '',
    })),
    additionalText: text,
  };

  const { deepgramKeyterms } = extractKeyterms(fakeInput);

  return { reporter, jobDetails, billing, deepgramKeyterms };
}

// ────────────────────────────────────────────────────────────────────────────
// Reporter info
// ────────────────────────────────────────────────────────────────────────────

function parseReporterInfo(text: string): ReporterInfo {
  const result: ReporterInfo = {
    reporterName: '',
    csrNumber: '',
    agency: '',
    certifications: [],
  };

  // CSR number — "CSR 12129" or "CSR #12129" or "CSR No. 12129"
  const csrMatch = text.match(/CSR\s*(?:#|No\.?)?\s*([0-9]{4,6})/i);
  if (csrMatch) result.csrNumber = csrMatch[1];

  // Agency name — typically near the top or on header
  // Look for firm names with known agency patterns
  const agencyMatch = text.match(
    /(?:Court\s+Reporting|Reporting\s+Services?|Legal\s+Solutions?|Steno)\s*(?:Agency|LLC|PLLC|Inc\.?)?\s*(?:\n|:|\s{3,})?([A-Z][A-Za-z\s&,\.]+?)(?:\n|$)/im,
  );
  if (agencyMatch) {
    result.agency = agencyMatch[1].trim();
  } else {
    // Look for "S.A. LEGAL SOLUTIONS" pattern from the sample PDF header
    const headerAgency = text.match(/([A-Z][A-Z\.\s]+(?:LEGAL|REPORTING|SOLUTIONS|STENO)[A-Z\.\s]*)/i);
    if (headerAgency) result.agency = headerAgency[1].trim();
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Job details
// ────────────────────────────────────────────────────────────────────────────

function parseJobDetails(text: string, reporter: ReporterInfo): ReporterJobDetails {
  const result: ReporterJobDetails = {
    reporter,
    date: '',
    scheduledStartTime: '',
    location: '',
    csr: false,
    interpreter: false,
    conferenceRoom: false,
  };

  // Date — "4/30/2026" or "April 30, 2026"
  const dateMatch = text.match(
    /(?:^|\s)(\d{1,2}\/\d{1,2}\/\d{4}|[A-Za-z]+ \d{1,2},? \d{4})(?:\s|$)/m,
  );
  if (dateMatch) result.date = dateMatch[1].trim();

  // Scheduled start time
  const timeMatch = text.match(/(?:Sch(?:eduled)?\s+Start\s+Time[:\s]+|Start\s+Time[:\s]+)(\d{1,2}:\d{2}\s*[APap][Mm]?)/);
  if (timeMatch) result.scheduledStartTime = timeMatch[1].trim();

  // Location
  const locationMatch = text.match(/Location\s*:\s*([^\n]+)/i);
  if (locationMatch) result.location = locationMatch[1].trim();
  if (!result.location && /via\s*zoom/i.test(text)) result.location = 'Via Zoom';

  // CSR checkbox
  result.csr = /CSR\s*:\s*Yes/i.test(text) || /\bCSR\b/.test(text);

  // Appearance
  const appMatch = text.match(/Appearance\s*:\s*([^\n]+)/i);
  if (appMatch) result.appearance = appMatch[1].trim();

  // CNA
  const cnaMatch = text.match(/CNA\s*:\s*([^\n]+)/i);
  if (cnaMatch) result.cna = cnaMatch[1].trim();

  // Read & Sign
  result.readAndSign = /Read\s*&?\s*Sign\s*:\s*(?!Signature)/i.test(text);
  result.signatureWaived = /Signature\s+Waived/i.test(text);

  // Exhibit count
  const exhibitMatch = text.match(/Exhibit\s+Count\s*:\s*([^\n]+)/i);
  if (exhibitMatch) result.exhibitCount = exhibitMatch[1].trim();

  // Pages
  const pagesMatch = text.match(/Pages\s*:\s*(\d+)/i);
  if (pagesMatch) result.pages = pagesMatch[1];

  // Video/Med/Tech
  const videoMatch = text.match(/Video\s*\/?\s*Med\s*\/?\s*Tech\s*:\s*([^\n]+)/i);
  if (videoMatch) result.videoMedTech = videoMatch[1].trim();

  // Interpreter
  result.interpreter = /Interpreter\s*:\s*Y(?:es)?/i.test(text);

  // Conference Room
  result.conferenceRoom = /Conference\s+Room\s*:\s*Y(?:es)?/i.test(text);

  // Travel miles
  const milesMatch = text.match(/Travel\s+Miles\s*:\s*([^\n]+)/i);
  if (milesMatch) result.travelMiles = milesMatch[1].trim();

  // Parking
  const parkingMatch = text.match(/Parking\s*:\s*([^\n]+)/i);
  if (parkingMatch) result.parking = parkingMatch[1].trim();

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Billing
// ────────────────────────────────────────────────────────────────────────────

function parseBilling(text: string): BillingInfo {
  const result: BillingInfo = {
    orderingAttorney: '',
    orderingFirm: '',
    orderingAddress: '',
    orderingPhone: '',
    orderingEmail: '',
    format: [],
    delivery: '',
    copyOrders: [],
    orderedBy: '',
  };

  // Ordering attorney
  const orderMatch = text.match(/Ordering\s+Attorney\s*:\s*([^\n]+)/i);
  if (orderMatch) result.orderingAttorney = orderMatch[1].trim();

  // Ordering firm
  const firmMatch = text.match(/Firm\s*:\s*\n?\s*([^\n]+)/i);
  if (firmMatch) result.orderingFirm = firmMatch[1].trim();

  // Ordering phone
  const phoneMatch = text.match(/Phone\s*:\s*(\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4})/i);
  if (phoneMatch) result.orderingPhone = phoneMatch[1].trim();

  // Ordering email
  const emailMatch = text.match(/Email\s*:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (emailMatch) result.orderingEmail = emailMatch[1].trim();

  // Format
  if (/Original/i.test(text)) result.format.push('Original');
  if (/E-?Trans/i.test(text)) result.format.push('E-Trans');
  if (/Hard\s*Copy/i.test(text)) result.format.push('Hard Copy');

  // Delivery
  if (/Rush/i.test(text)) result.delivery = 'Rush';
  else if (/Standard/i.test(text)) result.delivery = 'Standard';

  // Ordered by
  const orderedByMatch = text.match(/O(?:r)?dered\s+by\s*:\s*([^\n]+)/i);
  if (orderedByMatch) result.orderedBy = orderedByMatch[1].trim();

  // Copy orders — extract all "Copy Attorney:" blocks
  result.copyOrders = parseCopyOrders(text);

  return result;
}

function parseCopyOrders(text: string): CopyOrder[] {
  const orders: CopyOrder[] = [];

  // Split on "Copy Attorney:" markers
  const chunks = text.split(/Copy\s+Attorney\s*:/i);
  // Skip the first chunk (before first Copy Attorney)
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const order: CopyOrder = {
      attorneyName: '',
      firmName: '',
      address: '',
      phone: '',
      email: '',
      format: [],
      delivery: 'Standard',
      copy: false,
    };

    // Attorney name — first non-empty line or inline after colon
    const nameMatch = chunk.match(/^\s*([A-Z][a-z]+(?:\s+[A-Z]\.?\s+[A-Z][a-z]+)*)/);
    if (nameMatch) order.attorneyName = nameMatch[1].trim();

    // Firm name
    const firmMatch = chunk.match(/Firm\s*:\s*\n?\s*([^\n]+)/i);
    if (firmMatch) order.firmName = firmMatch[1].trim();

    // Phone
    const phoneMatch = chunk.match(/\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}/);
    if (phoneMatch) order.phone = phoneMatch[0];

    // Email
    const emailMatch = chunk.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) order.email = emailMatch[1];

    // Address
    const addressMatch = chunk.match(/(\d+\s+[^\n]+(?:Suite|Ste\.?|Ave|Street)[^\n]*)/i);
    if (addressMatch) order.address = addressMatch[1].trim();

    // Format
    if (/Original/i.test(chunk)) order.format.push('Original');
    if (/E-?Trans/i.test(chunk)) order.format.push('E-Trans');
    if (/Hard\s*Copy/i.test(chunk)) order.format.push('Hard Copy');

    // Delivery
    order.delivery = /Rush/i.test(chunk) ? 'Rush' : 'Standard';

    // Rush due date
    const rushMatch = chunk.match(/Rush\s+Due\s*:\s*([^\n]+)/i);
    if (rushMatch) order.rushDue = rushMatch[1].trim();

    // Copy checkbox
    order.copy = /Copy\?\s*\n?\s*(?:Yes|Y\b)/i.test(chunk);

    if (order.attorneyName || order.firmName || order.email) {
      orders.push(order);
    }
  }

  return orders;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function parseDeponent(text: string): string {
  const match = text.match(/Deponent\s*:\s*([^\n]+)/i);
  return match ? match[1].trim() : '';
}

function extractCaseStyle(text: string, role: 'plaintiff' | 'defendant'): string {
  const styleMatch = text.match(/Case\/Style\s*:\s*([^\n]+)/i);
  if (!styleMatch) return '';
  const style = styleMatch[1];
  if (role === 'plaintiff') {
    const m = style.match(/^([^v]+?)\s+v\./i);
    return m ? m[1].trim() : '';
  } else {
    const m = style.match(/v\.\s+(.+)$/i);
    return m ? m[1].trim() : '';
  }
}
