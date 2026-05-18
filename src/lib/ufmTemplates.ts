// ============================================================================
// ufmTemplates.ts — UFM (Universal Format for Depositions) template builders
// Covers:
//   Fig. 03 — Title Page
//   Fig. 04 — Appearances Page
//   Fig. 05 — Reporter Certificate
// ============================================================================

import type {
  IntakeRecord,
  CaseInfo,
  AttorneyAppearance,
  BillingInfo,
} from '../types/intake';

// ────────────────────────────────────────────────────────────────────────────
// Fig. 03 — Title Page
// ────────────────────────────────────────────────────────────────────────────

export interface UFMTitlePage {
  court: string;
  district: string;
  division: string;
  caseCaption: string;
  plaintiff: string;
  defendant: string;
  causeNumber: string;
  noticeTitle: string;
  depositionType: string;
  deponentName: string;
  depositionDate: string;
  depositionTime: string;
  depositionLocation: string;
  reportingAgency: string;
  state: string;
}

export function buildTitlePage(intake: IntakeRecord): UFMTitlePage {
  const { caseInfo, depositionDetails, reporterJobDetails } = intake;

  const depositionType = depositionDetails.isZoom
    ? 'ORAL/ZOOM DEPOSITION'
    : 'ORAL DEPOSITION';

  return {
    court: caseInfo.court,
    district: caseInfo.district,
    division: caseInfo.division,
    caseCaption: buildCaseCaption(caseInfo),
    plaintiff: caseInfo.plaintiff,
    defendant: caseInfo.defendant,
    causeNumber: caseInfo.causeNumber,
    noticeTitle: depositionDetails.noticeTitle ||
      `${depositionType} OF ${depositionDetails.deponent.name.toUpperCase()}`,
    depositionType,
    deponentName: depositionDetails.deponent.name,
    depositionDate: depositionDetails.date,
    depositionTime: depositionDetails.time,
    depositionLocation: depositionDetails.location,
    reportingAgency: reporterJobDetails?.reporter?.agency ?? '',
    state: caseInfo.state,
  };
}

function buildCaseCaption(caseInfo: CaseInfo): string {
  const lines: string[] = [];
  if (caseInfo.plaintiff) lines.push(caseInfo.plaintiff);
  lines.push('Plaintiff,');
  lines.push('vs.');
  if (caseInfo.causeNumber) lines.push(`CIVIL ACTION NO.: ${caseInfo.causeNumber}`);
  if (caseInfo.defendant) lines.push(caseInfo.defendant);
  lines.push('Defendants.');
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// Fig. 04 — Appearances Page
// ────────────────────────────────────────────────────────────────────────────

export interface UFMAppearancesPage {
  groups: AppearanceGroup[];
}

export interface AppearanceGroup {
  side: 'Plaintiff' | 'Defendant' | 'Other';
  represents: string;
  attorneys: AttorneyAppearance[];
}

export function buildAppearancesPage(appearances: AttorneyAppearance[]): UFMAppearancesPage {
  const groups = new Map<string, AppearanceGroup>();

  for (const app of appearances) {
    const key = `${app.side}::${app.represents}`;
    if (!groups.has(key)) {
      groups.set(key, {
        side: app.side,
        represents: app.represents,
        attorneys: [],
      });
    }
    groups.get(key)!.attorneys.push(app);
  }

  // Order: Plaintiff first, then Defendant, then Other
  const ordered = [...groups.values()].sort((a, b) => {
    const order = { Plaintiff: 0, Defendant: 1, Other: 2 };
    return (order[a.side] ?? 3) - (order[b.side] ?? 3);
  });

  return { groups: ordered };
}

// ────────────────────────────────────────────────────────────────────────────
// Fig. 05 — Reporter Certificate
// ────────────────────────────────────────────────────────────────────────────

export interface UFMReporterCertificate {
  reporterName: string;
  csrNumber: string;
  agency: string;
  state: string;
  deponentName: string;
  depositionDate: string;
  causeNumber: string;
  certificationText: string;
}

export function buildReporterCertificate(
  intake: IntakeRecord,
): UFMReporterCertificate {
  const reporter = intake.reporterJobDetails?.reporter;
  const { depositionDetails, caseInfo } = intake;

  const reporterName = reporter?.reporterName ?? '';
  const csrNumber = reporter?.csrNumber ?? '';
  const agency = reporter?.agency ?? '';
  const state = caseInfo.state || 'Texas';

  const certificationText = buildCertificationText({
    reporterName,
    csrNumber,
    state,
    deponentName: depositionDetails.deponent.name,
    depositionDate: depositionDetails.date,
    causeNumber: caseInfo.causeNumber,
    caseStyle: caseInfo.caseStyle,
    isZoom: depositionDetails.isZoom,
  });

  return {
    reporterName,
    csrNumber,
    agency,
    state,
    deponentName: depositionDetails.deponent.name,
    depositionDate: depositionDetails.date,
    causeNumber: caseInfo.causeNumber,
    certificationText,
  };
}

interface CertTextInput {
  reporterName: string;
  csrNumber: string;
  state: string;
  deponentName: string;
  depositionDate: string;
  causeNumber: string;
  caseStyle: string;
  isZoom: boolean;
}

function buildCertificationText(input: CertTextInput): string {
  const { reporterName, csrNumber, state, deponentName, depositionDate, causeNumber, caseStyle, isZoom } = input;

  const name = reporterName || '___________________________';
  const csr = csrNumber ? `CSR No. ${csrNumber}` : 'CSR No. ____________';
  const date = depositionDate || '____________';
  const deponent = deponentName || '____________';
  const cause = causeNumber ? `Cause No. ${causeNumber}` : 'Cause No. ____________';
  const zoomClause = isZoom
    ? ' The deposition was conducted remotely via Zoom video conferencing. The witness appeared remotely and was duly sworn by the undersigned remotely.'
    : '';

  return `I, ${name}, ${csr}, a Certified Court Reporter in and for the State of ${state}, do hereby certify that the foregoing is a true and correct transcript of the proceedings in the above-captioned matter in ${cause}, ${caseStyle}, taken on ${date} before me, wherein the witness, ${deponent}, was duly sworn to testify the truth, the whole truth, and nothing but the truth.${zoomClause}

I further certify that I am neither attorney nor counsel for, nor related to or employed by, any of the parties to the action in which this deposition was taken, and further that I am not a relative or employee of any attorney or counsel employed by the parties hereto or financially interested in the action.

Given under my hand and seal this _____ day of ____________, ______.

____________________________
${name}
Certified Court Reporter
${csr}
State of ${state}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Copy / Billing summary
// ────────────────────────────────────────────────────────────────────────────

export interface UFMBillingSummary {
  orderingAttorney: string;
  orderingFirm: string;
  orderingContact: string;
  formats: string[];
  delivery: string;
  copies: UFMCopyLine[];
}

export interface UFMCopyLine {
  recipient: string;
  firm: string;
  email: string;
  formats: string[];
  delivery: string;
}

export function buildBillingSummary(billing: Partial<BillingInfo>): UFMBillingSummary {
  return {
    orderingAttorney: billing?.orderingAttorney ?? '',
    orderingFirm: billing?.orderingFirm ?? '',
    orderingContact: [billing?.orderingPhone, billing?.orderingEmail].filter(Boolean).join(' | '),
    formats: billing?.format ?? [],
    delivery: billing?.delivery ?? '',
    copies: (billing?.copyOrders ?? []).map(o => ({
      recipient: o.attorneyName,
      firm: o.firmName,
      email: o.email,
      formats: o.format,
      delivery: o.delivery,
    })),
  };
}
