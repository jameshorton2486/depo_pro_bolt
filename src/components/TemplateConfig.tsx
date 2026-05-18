import { Icons } from './Icons';
import type { Reporter, TemplateConfig as TemplateConfigType } from '../lib/database.types';

interface TemplateConfigProps {
  config: Partial<TemplateConfigType>;
  reporters: Reporter[];
  selectedReporterId: string;
  caseFolder: string;
  onReporterChange: (id: string) => void;
  onConfigChange: (updates: Partial<TemplateConfigType>) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}

const BLOCK_LABELS: Record<string, string> = {
  block_subpoena_duces_tecum: 'Subpoena Duces Tecum',
  block_videotaped: 'Videotaped Deposition',
  block_remote: 'Remote / Virtual Proceeding',
  block_volume: 'Volume Designation',
  block_also_present: 'Also Present (Appearances)',
  block_credentials_suffix: 'Reporter Credentials Suffix',
  block_firm_signature_block: 'Firm Signature Block',
};

const BLOCK_SECTION: Record<string, string> = {
  block_subpoena_duces_tecum: '[Title Page Elements]',
  block_videotaped: '[Title Page Elements]',
  block_remote: '[Title Page Elements]',
  block_volume: '[Title Page Elements]',
  block_also_present: '[Appearances Elements]',
  block_credentials_suffix: "[Reporter's Certification]",
  block_firm_signature_block: "[Reporter's Certification]",
};

const DEFAULT_TOGGLES: Record<string, boolean> = {
  block_subpoena_duces_tecum: false,
  block_videotaped: true,
  block_remote: true,
  block_volume: false,
  block_also_present: true,
  block_credentials_suffix: true,
  block_firm_signature_block: true,
};

const DEFAULT_TEMPLATES = {
  titlePageTexas: true,
  titlePageFederal: false,
  appearances: true,
  indexChronological: true,
};

export default function TemplateConfig({
  config,
  reporters,
  selectedReporterId,
  caseFolder,
  onReporterChange,
  onConfigChange,
  onSave,
  saving,
}: TemplateConfigProps) {
  const activeTemplates = config.active_templates ?? DEFAULT_TEMPLATES;
  const blockToggles = (config.block_toggles ?? DEFAULT_TOGGLES) as Record<string, boolean>;
  const manualFields = (config.manual_fields ?? {}) as Record<string, string>;
  const currentReporter = reporters.find(r => r.id === selectedReporterId);

  const inputCls = "w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none transition-colors";
  const labelCls = "block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1.5";

  const setManualField = (key: string, val: string) => {
    onConfigChange({ manual_fields: { ...manualFields, [key]: val } });
  };

  const setTemplate = (key: keyof typeof DEFAULT_TEMPLATES, val: boolean) => {
    onConfigChange({ active_templates: { ...activeTemplates, [key]: val } });
  };

  const setBlock = (key: string, val: boolean) => {
    onConfigChange({ block_toggles: { ...blockToggles, [key]: val } });
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto max-w-5xl mx-auto w-full space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-200">Template Master Configurations</h2>
            <p className="text-xs text-slate-400">Assemble structural block templates, assign cert signatures, and configure output.</p>
          </div>
          <div className="flex items-center gap-3">
            {caseFolder && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wide hidden md:block">Case Folder:</span>
                <span className="text-xs font-mono bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-slate-300 truncate max-w-xs">{caseFolder}</span>
              </div>
            )}
            <button
              onClick={onSave}
              disabled={saving}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-xs font-semibold rounded-lg text-white flex items-center gap-2 transition-colors shrink-0"
            >
              <Icons.Check /> {saving ? 'Saving...' : 'Save Config'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: Reporter Profiles + Structure Frameworks */}
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Icons.Users /> Reporter Profiles
            </h3>
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Selected Assigned Reporter</label>
                <select
                  value={selectedReporterId}
                  onChange={(e) => onReporterChange(e.target.value)}
                  className={`${inputCls} font-semibold`}
                >
                  {reporters.map(rep => (
                    <option key={rep.id} value={rep.id}>{rep.name} — {rep.firm}</option>
                  ))}
                </select>
              </div>

              {currentReporter && (
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2.5 font-mono text-xs">
                  <div className="flex justify-between items-start border-b border-slate-800 pb-2">
                    <div>
                      <p className="font-bold text-slate-100">{currentReporter.name}</p>
                      <p className="text-[10px] text-slate-400">{currentReporter.credentials}</p>
                    </div>
                    <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded text-[10px] font-bold border border-emerald-500/20">Active</span>
                  </div>
                  <div className="space-y-1.5 text-slate-300 text-[11px] leading-relaxed">
                    <p><span className="text-slate-500">CSR:</span> {currentReporter.csr_number} <span className="text-amber-400">(Exp {currentReporter.expiration_date})</span></p>
                    <p><span className="text-slate-500">Firm:</span> {currentReporter.firm}</p>
                    <p><span className="text-slate-500">Phone:</span> {currentReporter.phone}</p>
                    <p><span className="text-slate-500">Email:</span> {currentReporter.email}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Icons.Details /> Structure Frameworks
            </h3>
            <div className="space-y-3">
              {(Object.entries(activeTemplates) as Array<[keyof typeof DEFAULT_TEMPLATES, boolean]>).map(([key, val]) => (
                <label key={key} className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg cursor-pointer hover:border-slate-700 transition-colors">
                  <span className="text-xs text-slate-300">{
                    key === 'titlePageTexas' ? 'Title Page (Texas State Court)' :
                    key === 'titlePageFederal' ? 'Title Page (Federal Court)' :
                    key === 'appearances' ? 'Appearances' :
                    'Index (Chronological)'
                  }</span>
                  <input
                    type="checkbox"
                    checked={val}
                    onChange={(e) => setTemplate(key, e.target.checked)}
                    className="w-4 h-4 accent-sky-500 rounded border-slate-800 focus:ring-0"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Column 2: Block Token Configurator */}
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <h3 className="text-sm font-bold text-white mb-1.5 flex items-center gap-2">
              <Icons.Sliders /> Block Token Configurator
            </h3>
            <p className="text-xs text-slate-400 mb-4">Toggle optional boilerplate blocks based on deposition notice requirements.</p>
            <div className="space-y-3 font-mono text-[11px]">
              {Object.entries(blockToggles).map(([blockKey, blockVal]) => (
                <div
                  key={blockKey}
                  className="flex items-center justify-between p-2.5 bg-slate-950 border border-slate-800 rounded-lg hover:border-slate-700 transition-colors"
                >
                  <div className="truncate pr-4">
                    <span className="text-sky-400 font-semibold">{BLOCK_LABELS[blockKey] ?? blockKey}</span>
                    <span className="block text-[9px] text-slate-500 mt-0.5">{BLOCK_SECTION[blockKey] ?? '[Misc]'}</span>
                  </div>
                  <button
                    onClick={() => setBlock(blockKey, !blockVal)}
                    className={`w-10 h-6 rounded-full transition-colors relative flex items-center shrink-0 ${blockVal ? 'bg-sky-600' : 'bg-slate-800'}`}
                  >
                    <span className={`w-4 h-4 rounded-full bg-white shadow-md transition-transform ${blockVal ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Column 3: Manual Fields */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
            <Icons.Edit /> Manual Fields
          </h3>
          <p className="text-xs text-slate-400 mb-4">Fields not derived from the Notice document. Leave blank to use defaults.</p>
          <div className="space-y-3.5">
            <div>
              <label className={labelCls}>Custodial Attorney</label>
              <input type="text" value={manualFields.custodialAttorney ?? ''} onChange={e => setManualField('custodialAttorney', e.target.value)} className={inputCls} placeholder="Enter Attorney..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Cost Amount ($)</label>
                <input type="number" value={manualFields.costAmount ?? ''} onChange={e => setManualField('costAmount', e.target.value)} className={inputCls} placeholder="0.00" />
              </div>
              <div>
                <label className={labelCls}>Cost Payor Party</label>
                <input type="text" value={manualFields.costPayorParty ?? ''} onChange={e => setManualField('costPayorParty', e.target.value)} className={inputCls} placeholder="Plaintiff / Defendant" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Transcript Submitted Date</label>
              <input type="date" value={manualFields.transcriptSubmittedDate ?? ''} onChange={e => setManualField('transcriptSubmittedDate', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Transcript Return-By Date</label>
              <input type="date" value={manualFields.transcriptReturnByDate ?? ''} onChange={e => setManualField('transcriptReturnByDate', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Served-On Date</label>
              <input type="date" value={manualFields.servedOnDate ?? ''} onChange={e => setManualField('servedOnDate', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Certification Date</label>
              <input type="date" value={manualFields.certificationDate ?? ''} onChange={e => setManualField('certificationDate', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Witness At Instance Of</label>
              <input type="text" value={manualFields.witnessAtInstanceOf ?? ''} onChange={e => setManualField('witnessAtInstanceOf', e.target.value)} className={inputCls} placeholder="Plaintiff / Defendant" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
