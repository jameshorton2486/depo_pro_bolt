// ============================================================================
// CaseIntakePanel.tsx — UFM-aware case intake UI
// Handles NOD upload, reporter notes upload, field editing, keyterm review
// ============================================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import type { IntakeRecord, AttorneyAppearance } from '../types/intake';
import { parseNODText } from '../lib/nodParser';
import { parseReporterNotes } from '../lib/reporterNotesParser';
import { saveIntake, listIntakes, deleteIntake, createEmptyIntake } from '../lib/intakeStore';

// ────────────────────────────────────────────────────────────────────────────
// Text extraction — routes by file extension
// Supports: .pdf, .docx, .doc, .txt, .text
// ────────────────────────────────────────────────────────────────────────────

async function extractText(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'pdf') return extractPDFText(file);
  if (ext === 'docx' || ext === 'doc') return extractDocxText(file);
  if (ext === 'txt' || ext === 'text') return extractTxtText(file);

  throw new Error(`Unsupported file type ".${ext}". Upload a PDF, DOCX, or TXT file.`);
}

async function extractPDFText(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let lastY: number | null = null;
    for (const item of content.items) {
      if ('str' in item) {
        const y = (item.transform as number[])[5];
        if (lastY !== null && Math.abs(y - lastY) > 4) lines.push('\n');
        lines.push(item.str);
        lastY = y;
      }
    }
    pages.push(lines.join(''));
  }

  return pages.join('\n\n--- PAGE BREAK ---\n\n');
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

function extractTxtText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read text file.'));
    reader.readAsText(file);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  subtitle,
  open,
  onToggle,
  badge,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  badge?: string;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/50 hover:bg-slate-800 rounded-lg transition-colors text-left group"
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-200">{title}</span>
          {badge && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">
              {badge}
            </span>
          )}
        </div>
        {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <span className={`text-slate-500 transition-transform ${open ? 'rotate-90' : ''} text-sm`}>▶</span>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500/60 resize-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500/60"
        />
      )}
    </div>
  );
}

function DropZone({
  label,
  accept,
  onFile,
  fileName,
  loading,
}: {
  label: string;
  accept: string;
  onFile: (f: File) => void;
  fileName?: string;
  loading?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => !loading && ref.current?.click()}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition ${
        loading
          ? 'border-sky-500/50 opacity-60 cursor-wait'
          : 'border-slate-700 hover:border-sky-500/70'
      }`}
    >
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]); }} />
      {loading ? (
        <p className="text-xs text-sky-400 animate-pulse">Parsing document...</p>
      ) : fileName ? (
        <>
          <p className="text-xs font-semibold text-sky-400 truncate">{fileName}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Click to replace</p>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-400">{label}</p>
          <p className="text-[10px] text-slate-600 mt-0.5">PDF, DOCX, or TXT</p>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────

interface Props {
  onKeytermsSaved?: (keyterms: string[]) => void;
  onIntakeLinked?: (intakeId: string) => void;
}

export default function CaseIntakePanel({ onKeytermsSaved, onIntakeLinked }: Props) {
  const [intake, setIntake] = useState<IntakeRecord>(createEmptyIntake);
  const [savedIntakes, setSavedIntakes] = useState<IntakeRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Section open states — all collapsed until a document is parsed
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    titlePage: false,
    depositionDetails: false,
    appearances: false,
    billing: false,
    reporterInfo: false,
    videoInterp: false,
    keyterms: false,
    recentIntakes: false,
  });

  // PDF parsing state
  const [nodLoading, setNodLoading] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Keyterm editing state
  const [keytermInput, setKeytermInput] = useState('');

  const toggleSection = (key: string) =>
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    listIntakes().then(setSavedIntakes).catch(console.error);
  }, []);

  // Deep-update helper
  const update = useCallback(<K extends keyof IntakeRecord>(key: K, value: IntakeRecord[K]) => {
    setIntake(prev => ({ ...prev, [key]: value }));
  }, []);

  const updateCaseInfo = (field: string, value: string) => {
    setIntake(prev => ({
      ...prev,
      caseInfo: { ...prev.caseInfo, [field]: value },
    }));
  };

  const updateDepo = (field: string, value: string | boolean) => {
    setIntake(prev => ({
      ...prev,
      depositionDetails: {
        ...prev.depositionDetails,
        [field]: value,
      },
    }));
  };

  const updateDeponent = (field: string, value: string) => {
    setIntake(prev => ({
      ...prev,
      depositionDetails: {
        ...prev.depositionDetails,
        deponent: { ...prev.depositionDetails.deponent, [field]: value },
      },
    }));
  };

  // ── New Deposition ────────────────────────────────────────────────────────
  const handleNewDeposition = () => {
    const hasData =
      intake.nodSource ||
      intake.notesSource ||
      intake.caseInfo.causeNumber ||
      intake.depositionDetails.deponent.name ||
      intake.appearances.length > 0;

    if (hasData && !confirm('Start a new deposition? Unsaved changes will be lost.')) return;

    setIntake(createEmptyIntake());
    setOpenSections({
      titlePage: false,
      depositionDetails: false,
      appearances: false,
      billing: false,
      reporterInfo: false,
      videoInterp: false,
      keyterms: false,
      recentIntakes: false,
    });
    setParseError(null);
    setKeytermInput('');
  };

  // ── NOD upload ────────────────────────────────────────────────────────────
  const handleNOD = async (file: File) => {
    setNodLoading(true);
    setParseError(null);
    try {
      const text = await extractText(file);
      const parsed = parseNODText(text);
      setIntake(prev => ({
        ...prev,
        caseInfo: { ...prev.caseInfo, ...parsed.caseInfo },
        depositionDetails: { ...prev.depositionDetails, ...parsed.depositionDetails },
        appearances: mergeAppearances(prev.appearances, parsed.appearances),
        deepgramKeyterms: dedupeKeyterms([...prev.deepgramKeyterms, ...parsed.deepgramKeyterms]),
        confirmedSpellings: [...new Set([...prev.confirmedSpellings, ...parsed.confirmedSpellings])],
        phoneticMappings: [...prev.phoneticMappings, ...parsed.phoneticMappings],
        nodSource: file.name,
      }));
      setOpenSections(prev => ({ ...prev, titlePage: true, depositionDetails: true, appearances: true, keyterms: true }));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    } finally {
      setNodLoading(false);
    }
  };

  // ── Reporter notes upload ─────────────────────────────────────────────────
  const handleReporterNotes = async (file: File) => {
    setNotesLoading(true);
    setParseError(null);
    try {
      const text = await extractText(file);
      const parsed = parseReporterNotes(text);
      setIntake(prev => ({
        ...prev,
        reporterJobDetails: { ...prev.reporterJobDetails, ...parsed.jobDetails },
        billing: { ...prev.billing, ...parsed.billing },
        deepgramKeyterms: dedupeKeyterms([...prev.deepgramKeyterms, ...parsed.deepgramKeyterms]),
        notesSource: file.name,
      }));
      setOpenSections(prev => ({ ...prev, billing: true, reporterInfo: true }));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    } finally {
      setNotesLoading(false);
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      await saveIntake(intake);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 2500);
      const list = await listIntakes();
      setSavedIntakes(list);
      onIntakeLinked?.(intake.id);
    } catch {
      setSaveMsg('Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Keyterms ──────────────────────────────────────────────────────────────
  const addKeyterm = () => {
    const t = keytermInput.trim();
    if (!t) return;
    update('deepgramKeyterms', dedupeKeyterms([...intake.deepgramKeyterms, t]));
    setKeytermInput('');
  };

  const removeKeyterm = (t: string) => {
    update('deepgramKeyterms', intake.deepgramKeyterms.filter(k => k !== t));
  };

  // ── Appearances ───────────────────────────────────────────────────────────
  const updateAppearance = (idx: number, field: keyof AttorneyAppearance, value: string) => {
    const next = intake.appearances.map((a, i) =>
      i === idx ? { ...a, [field]: value } : a,
    );
    update('appearances', next);
  };

  const addAppearance = () => {
    update('appearances', [
      ...intake.appearances,
      {
        side: 'Plaintiff' as const,
        attorneyName: '',
        firmName: '',
        address: '',
        phone: '',
        email: '',
        represents: '',
      },
    ]);
  };

  const removeAppearance = (idx: number) => {
    update('appearances', intake.appearances.filter((_, i) => i !== idx));
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const keytermCount = intake.deepgramKeyterms.length;

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-3 border-b border-slate-800/80 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Case Intake</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">UFM-formatted · Auto-populates from NOD</p>
        </div>
        <div className="flex items-center gap-2">
          {saveMsg && (
            <span className={`text-xs font-semibold ${saveMsg === 'Saved' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {saveMsg}
            </span>
          )}
          <button
            onClick={handleNewDeposition}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition"
          >
            New Deposition
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition"
          >
            {saving ? 'Saving...' : 'Save Intake'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">

        {/* ── Upload row ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Extract from NOD
            </p>
            <DropZone
              label="Drop NOD here"
              accept=".pdf,.docx,.doc,.txt,.text"
              onFile={handleNOD}
              fileName={intake.nodSource}
              loading={nodLoading}
            />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Reporter Notes
            </p>
            <DropZone
              label="Drop reporter notes here"
              accept=".pdf,.docx,.doc,.txt,.text"
              onFile={handleReporterNotes}
              fileName={intake.notesSource}
              loading={notesLoading}
            />
          </div>
        </div>

        {parseError && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-xs text-rose-300">
            Parse error: {parseError}
          </div>
        )}

        {/* ── Empty state prompt ────────────────────────────────────────── */}
        {!intake.nodSource && !intake.notesSource && (
          <div className="border border-dashed border-slate-800 rounded-xl p-6 text-center">
            <p className="text-sm font-semibold text-slate-400">Upload a NOD or reporter notes above to auto-populate fields</p>
            <p className="text-xs text-slate-600 mt-1.5">Or expand any section below to fill in manually</p>
          </div>
        )}

        {/* ── UFM Fig. 03 — Title Page ──────────────────────────────────── */}
        <div className="space-y-2">
          <SectionHeader
            title="UFM Fig. 03 — Title Page"
            subtitle="Court, parties, cause number"
            open={openSections.titlePage}
            onToggle={() => toggleSection('titlePage')}
            badge={intake.caseInfo.causeNumber ? intake.caseInfo.causeNumber : undefined}
          />
          {openSections.titlePage && (
            <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cause Number" value={intake.caseInfo.causeNumber} onChange={v => updateCaseInfo('causeNumber', v)} placeholder="25-cv-00598-OLG" />
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Court Type</label>
                  <select
                    value={intake.caseInfo.courtType}
                    onChange={e => updateCaseInfo('courtType', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
                  >
                    <option value="">Select...</option>
                    <option value="Federal District Court">Federal District Court</option>
                    <option value="State District Court">State District Court</option>
                    <option value="County Court">County Court</option>
                    <option value="County Court at Law">County Court at Law</option>
                    <option value="Probate Court">Probate Court</option>
                    <option value="Family Court">Family Court</option>
                    <option value="Justice Court">Justice Court</option>
                    <option value="Arbitration">Arbitration</option>
                    <option value="Administrative">Administrative</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
              <Field label="Court" value={intake.caseInfo.court} onChange={v => updateCaseInfo('court', v)} placeholder="UNITED STATES DISTRICT COURT" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="District" value={intake.caseInfo.district} onChange={v => updateCaseInfo('district', v)} placeholder="WESTERN DISTRICT OF TEXAS" />
                <Field label="Division" value={intake.caseInfo.division} onChange={v => updateCaseInfo('division', v)} placeholder="SAN ANTONIO DIVISION" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="County" value={intake.caseInfo.county} onChange={v => updateCaseInfo('county', v)} placeholder="Bexar" />
                <Field label="State" value={intake.caseInfo.state} onChange={v => updateCaseInfo('state', v)} placeholder="Texas" />
              </div>
              <Field label="Plaintiff" value={intake.caseInfo.plaintiff} onChange={v => updateCaseInfo('plaintiff', v)} placeholder="DELIA GARZA" />
              <Field label="Defendant" value={intake.caseInfo.defendant} onChange={v => updateCaseInfo('defendant', v)} placeholder="HOME DEPOT U.S.A., INC." multiline />
            </div>
          )}
        </div>

        {/* ── Deposition Details ────────────────────────────────────────── */}
        <div className="space-y-2">
          <SectionHeader
            title="Deposition Details"
            subtitle="Deponent, date, time, location"
            open={openSections.depositionDetails}
            onToggle={() => toggleSection('depositionDetails')}
            badge={intake.depositionDetails.deponent.name || undefined}
          />
          {openSections.depositionDetails && (
            <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Deponent Name" value={intake.depositionDetails.deponent.name} onChange={v => updateDeponent('name', v)} placeholder="Heath Thomas" />
                <Field label="Role" value={intake.depositionDetails.deponent.role} onChange={v => updateDeponent('role', v)} placeholder="Witness" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date" value={intake.depositionDetails.date} onChange={v => updateDepo('date', v)} placeholder="April 30, 2026" />
                <Field label="Time" value={intake.depositionDetails.time} onChange={v => updateDepo('time', v)} placeholder="1:30 PM" />
              </div>
              <Field label="Location" value={intake.depositionDetails.location} onChange={v => updateDepo('location', v)} placeholder="Via Zoom" />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={intake.depositionDetails.isZoom}
                    onChange={e => updateDepo('isZoom', e.target.checked)}
                    className="accent-sky-500"
                  />
                  <span className="text-xs text-slate-300">Via Zoom / Remote</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* ── UFM Fig. 04 — Appearances ─────────────────────────────────── */}
        <div className="space-y-2">
          <SectionHeader
            title="UFM Fig. 04 — Appearances"
            subtitle="Attorneys, firms, contact info"
            open={openSections.appearances}
            onToggle={() => toggleSection('appearances')}
            badge={intake.appearances.length > 0 ? `${intake.appearances.length} counsel` : undefined}
          />
          {openSections.appearances && (
            <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-4 space-y-4">
              {intake.appearances.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-2">No appearances yet. Upload NOD or add manually.</p>
              )}
              {intake.appearances.map((app, idx) => (
                <div key={idx} className="border border-slate-800 rounded-lg p-3 space-y-2 relative">
                  <div className="flex items-center justify-between mb-1">
                    <select
                      value={app.side}
                      onChange={e => updateAppearance(idx, 'side', e.target.value as AttorneyAppearance['side'])}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-semibold"
                    >
                      <option value="Plaintiff">Plaintiff</option>
                      <option value="Defendant">Defendant</option>
                      <option value="Other">Other</option>
                    </select>
                    <button onClick={() => removeAppearance(idx)} className="text-slate-600 hover:text-rose-400 text-sm">×</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Attorney Name" value={app.attorneyName} onChange={v => updateAppearance(idx, 'attorneyName', v)} />
                    <Field label="Firm Name" value={app.firmName} onChange={v => updateAppearance(idx, 'firmName', v)} />
                  </div>
                  <Field label="Address" value={app.address} onChange={v => updateAppearance(idx, 'address', v)} />
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Phone" value={app.phone} onChange={v => updateAppearance(idx, 'phone', v)} />
                    <Field label="Email" value={app.email} onChange={v => updateAppearance(idx, 'email', v)} />
                  </div>
                  <Field label="Represents" value={app.represents} onChange={v => updateAppearance(idx, 'represents', v)} />
                </div>
              ))}
              <button
                onClick={addAppearance}
                className="w-full py-2 border border-dashed border-slate-700 hover:border-sky-500/60 rounded-lg text-xs text-slate-400 hover:text-sky-400 transition"
              >
                + Add Appearance
              </button>
            </div>
          )}
        </div>

        {/* ── UFM Fig. 05 / Reporter Info ───────────────────────────────── */}
        <div className="space-y-2">
          <SectionHeader
            title="UFM Fig. 05 — Reporter Certificate"
            subtitle="Reporter name, CSR number, agency"
            open={openSections.reporterInfo}
            onToggle={() => toggleSection('reporterInfo')}
            badge={intake.reporterJobDetails?.reporter?.csrNumber ? `CSR ${intake.reporterJobDetails.reporter.csrNumber}` : undefined}
          />
          {openSections.reporterInfo && (
            <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Reporter Name"
                  value={intake.reporterJobDetails?.reporter?.reporterName ?? ''}
                  onChange={v => setIntake(prev => ({
                    ...prev,
                    reporterJobDetails: {
                      ...prev.reporterJobDetails,
                      reporter: { ...(prev.reporterJobDetails?.reporter ?? { reporterName: '', csrNumber: '', agency: '', certifications: [] }), reporterName: v },
                    },
                  }))}
                  placeholder="Miah Bardot"
                />
                <Field
                  label="CSR Number"
                  value={intake.reporterJobDetails?.reporter?.csrNumber ?? ''}
                  onChange={v => setIntake(prev => ({
                    ...prev,
                    reporterJobDetails: {
                      ...prev.reporterJobDetails,
                      reporter: { ...(prev.reporterJobDetails?.reporter ?? { reporterName: '', csrNumber: '', agency: '', certifications: [] }), csrNumber: v },
                    },
                  }))}
                  placeholder="12129"
                />
              </div>
              <Field
                label="Agency"
                value={intake.reporterJobDetails?.reporter?.agency ?? ''}
                onChange={v => setIntake(prev => ({
                  ...prev,
                  reporterJobDetails: {
                    ...prev.reporterJobDetails,
                    reporter: { ...(prev.reporterJobDetails?.reporter ?? { reporterName: '', csrNumber: '', agency: '', certifications: [] }), agency: v },
                  },
                }))}
                placeholder="S.A. Legal Solutions"
              />
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Sch. Start Time"
                  value={intake.reporterJobDetails?.scheduledStartTime ?? ''}
                  onChange={v => setIntake(prev => ({
                    ...prev,
                    reporterJobDetails: { ...prev.reporterJobDetails, scheduledStartTime: v },
                  }))}
                  placeholder="1:30 PM"
                />
                <div className="flex items-center gap-4 mt-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={intake.reporterJobDetails?.csr ?? false}
                      onChange={e => setIntake(prev => ({
                        ...prev,
                        reporterJobDetails: { ...prev.reporterJobDetails, csr: e.target.checked },
                      }))}
                      className="accent-sky-500"
                    />
                    <span className="text-xs text-slate-300">CSR</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Videographer & Interpreter ────────────────────────────────── */}
        <div className="space-y-2">
          <SectionHeader
            title="Videographer & Interpreter"
            subtitle="Video operator and interpreter contact info"
            open={openSections.videoInterp}
            onToggle={() => toggleSection('videoInterp')}
            badge={
              intake.videographer?.name && intake.interpreter?.name
                ? 'Both'
                : intake.videographer?.name
                ? 'Video'
                : intake.interpreter?.name
                ? 'Interp.'
                : undefined
            }
          />
          {openSections.videoInterp && (
            <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-4 space-y-4">

              {/* Videographer */}
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Videographer</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Name"
                    value={intake.videographer?.name ?? ''}
                    onChange={v => setIntake(prev => ({ ...prev, videographer: { ...prev.videographer, name: v } }))}
                    placeholder="John Doe"
                  />
                  <Field
                    label="Company"
                    value={intake.videographer?.company ?? ''}
                    onChange={v => setIntake(prev => ({ ...prev, videographer: { ...prev.videographer, company: v } }))}
                    placeholder="Video Pros LLC"
                  />
                  <Field
                    label="Phone"
                    value={intake.videographer?.phone ?? ''}
                    onChange={v => setIntake(prev => ({ ...prev, videographer: { ...prev.videographer, phone: v } }))}
                    placeholder="(210) 555-0100"
                  />
                  <Field
                    label="Email"
                    value={intake.videographer?.email ?? ''}
                    onChange={v => setIntake(prev => ({ ...prev, videographer: { ...prev.videographer, email: v } }))}
                    placeholder="video@example.com"
                  />
                </div>
              </div>

              <div className="border-t border-slate-800/60" />

              {/* Interpreter */}
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Interpreter</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Name"
                    value={intake.interpreter?.name ?? ''}
                    onChange={v => setIntake(prev => ({ ...prev, interpreter: { ...prev.interpreter, name: v } }))}
                    placeholder="Maria Gomez"
                  />
                  <Field
                    label="Language"
                    value={intake.interpreter?.language ?? ''}
                    onChange={v => setIntake(prev => ({ ...prev, interpreter: { ...prev.interpreter, language: v } }))}
                    placeholder="Spanish"
                  />
                  <Field
                    label="Company"
                    value={intake.interpreter?.company ?? ''}
                    onChange={v => setIntake(prev => ({ ...prev, interpreter: { ...prev.interpreter, company: v } }))}
                    placeholder="Lingua Services"
                  />
                  <Field
                    label="Phone"
                    value={intake.interpreter?.phone ?? ''}
                    onChange={v => setIntake(prev => ({ ...prev, interpreter: { ...prev.interpreter, phone: v } }))}
                    placeholder="(210) 555-0200"
                  />
                  <Field
                    label="Email"
                    value={intake.interpreter?.email ?? ''}
                    onChange={v => setIntake(prev => ({ ...prev, interpreter: { ...prev.interpreter, email: v } }))}
                    placeholder="interp@example.com"
                  />
                </div>
              </div>

            </div>
          )}
        </div>

        {/* ── Copy / Billing ────────────────────────────────────────────── */}
        <div className="space-y-2">
          <SectionHeader
            title="Copy / Billing"
            subtitle="Ordering attorney, format, copies"
            open={openSections.billing}
            onToggle={() => toggleSection('billing')}
            badge={intake.billing?.orderingAttorney || undefined}
          />
          {openSections.billing && (
            <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Ordering Attorney" value={intake.billing?.orderingAttorney ?? ''} onChange={v => setIntake(prev => ({ ...prev, billing: { ...prev.billing, orderingAttorney: v } }))} placeholder="Steven A. Nunez" />
                <Field label="Ordering Firm" value={intake.billing?.orderingFirm ?? ''} onChange={v => setIntake(prev => ({ ...prev, billing: { ...prev.billing, orderingFirm: v } }))} placeholder="Brain & Spine..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone" value={intake.billing?.orderingPhone ?? ''} onChange={v => setIntake(prev => ({ ...prev, billing: { ...prev.billing, orderingPhone: v } }))} />
                <Field label="Email" value={intake.billing?.orderingEmail ?? ''} onChange={v => setIntake(prev => ({ ...prev, billing: { ...prev.billing, orderingEmail: v } }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Delivery</label>
                  <select
                    value={intake.billing?.delivery ?? ''}
                    onChange={e => setIntake(prev => ({ ...prev, billing: { ...prev.billing, delivery: e.target.value } }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200"
                  >
                    <option value="">Select...</option>
                    <option value="Standard">Standard</option>
                    <option value="Rush">Rush</option>
                  </select>
                </div>
                <Field label="Ordered By" value={intake.billing?.orderedBy ?? ''} onChange={v => setIntake(prev => ({ ...prev, billing: { ...prev.billing, orderedBy: v } }))} placeholder="Tiffany Netcher" />
              </div>

              {/* Copy orders */}
              {(intake.billing?.copyOrders ?? []).length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Copy Orders</p>
                  <div className="space-y-2">
                    {(intake.billing?.copyOrders ?? []).map((o, i) => (
                      <div key={i} className="bg-slate-950 border border-slate-800 rounded p-2.5 text-xs">
                        <p className="font-semibold text-slate-200">{o.attorneyName || 'Attorney'}</p>
                        <p className="text-slate-400">{o.firmName}</p>
                        <p className="text-slate-500">{o.email}</p>
                        <p className="text-slate-600 mt-0.5">{o.format.join(', ')} · {o.delivery}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Deepgram Keyterms ─────────────────────────────────────────── */}
        <div className="space-y-2">
          <SectionHeader
            title="Deepgram Keyterms"
            subtitle="Auto-extracted names and unusual spellings"
            open={openSections.keyterms}
            onToggle={() => toggleSection('keyterms')}
            badge={keytermCount > 0 ? `${keytermCount} terms` : undefined}
          />
          {openSections.keyterms && (
            <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  value={keytermInput}
                  onChange={e => setKeytermInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addKeyterm()}
                  placeholder="Add term and press Enter"
                  className="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500/60"
                />
                <button onClick={addKeyterm} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded transition">Add</button>
              </div>

              {intake.deepgramKeyterms.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {intake.deepgramKeyterms.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-500/10 border border-sky-500/30 rounded text-xs text-sky-300">
                      {t}
                      <button onClick={() => removeKeyterm(t)} className="hover:text-rose-400 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-600 text-center py-2">Upload a NOD to auto-generate keyterms</p>
              )}

              {intake.confirmedSpellings.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Confirmed Unusual Spellings</p>
                  <div className="flex flex-wrap gap-1.5">
                    {intake.confirmedSpellings.map(t => (
                      <span key={t} className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-300">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {intake.phoneticMappings.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Phonetic Corrections</p>
                  <div className="space-y-1">
                    {intake.phoneticMappings.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-rose-400 font-mono">{m.phonetic}</span>
                        <span className="text-slate-600">→</span>
                        <span className="text-emerald-400 font-mono">{m.correct}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {intake.deepgramKeyterms.length > 0 && (
                <button
                  onClick={() => onKeytermsSaved?.(intake.deepgramKeyterms)}
                  className="w-full py-2 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-600/40 text-sky-400 text-xs font-semibold rounded-lg transition"
                >
                  Use These Keyterms for Transcription
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Recent Intakes ────────────────────────────────────────────── */}
        {savedIntakes.length > 0 && (
          <div className="space-y-2">
            <SectionHeader
              title="Recent Intakes"
              open={openSections.recentIntakes}
              onToggle={() => toggleSection('recentIntakes')}
              badge={`${savedIntakes.length}`}
            />
            {openSections.recentIntakes && (
              <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-3 space-y-1.5">
                {savedIntakes.map(saved => (
                  <div
                    key={saved.id}
                    className={`flex items-center gap-2 p-2 rounded text-xs ${
                      saved.id === intake.id
                        ? 'bg-sky-500/10 border border-sky-500/30'
                        : 'bg-slate-950/50 border border-slate-800/50'
                    }`}
                  >
                    <button
                      onClick={() => setIntake(saved)}
                      className="flex-1 text-left"
                    >
                      <p className="font-semibold text-slate-200">
                        {saved.caseInfo.caseStyle || saved.depositionDetails.deponent.name || 'Untitled'}
                      </p>
                      <p className="text-slate-500 text-[10px]">
                        {saved.caseInfo.causeNumber && `${saved.caseInfo.causeNumber} · `}
                        {new Date(saved.updatedAt).toLocaleString()}
                      </p>
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm('Delete this intake?')) return;
                        await deleteIntake(saved.id);
                        const list = await listIntakes();
                        setSavedIntakes(list);
                        if (saved.id === intake.id) setIntake(createEmptyIntake());
                      }}
                      className="text-slate-600 hover:text-rose-400"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setIntake(createEmptyIntake())}
                  className="w-full py-1.5 border border-dashed border-slate-700 hover:border-sky-500/50 rounded text-xs text-slate-500 hover:text-sky-400 transition mt-1"
                >
                  + New Intake
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────────────

function dedupeKeyterms(terms: string[]): string[] {
  const seen = new Map<string, string>();
  for (const t of terms) {
    const key = t.toLowerCase().trim();
    if (key && !seen.has(key)) seen.set(key, t);
  }
  return [...seen.values()];
}

function mergeAppearances(existing: AttorneyAppearance[], incoming: AttorneyAppearance[]): AttorneyAppearance[] {
  const seen = new Set(existing.map(a => (a.email + a.attorneyName).toLowerCase()));
  const novel = incoming.filter(a => !seen.has((a.email + a.attorneyName).toLowerCase()));
  return [...existing, ...novel];
}
