import React from 'react';
import { Icons } from './Icons';
import type { Case, Reporter } from '../lib/database.types';

interface CaseIntakeProps {
  caseData: Partial<Case>;
  reporters: Reporter[];
  onCaseChange: (updates: Partial<Case>) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}

export default function CaseIntake({ caseData, reporters, onCaseChange, onSave, saving }: CaseIntakeProps) {
  const f = (key: keyof Case) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    onCaseChange({ [key]: e.target.value });
  };

  const inputCls = "w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none transition-colors";
  const warnInputCls = "w-full bg-slate-950 border border-amber-500/50 rounded-lg px-3.5 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none transition-colors";
  const labelCls = "block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1";

  return (
    <div className="flex-1 p-6 overflow-y-auto max-w-5xl mx-auto w-full space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-bold text-white tracking-wide">CASE INTAKE REVIEW</h2>
          <p className="text-xs text-slate-400 mt-1">Review and edit case metadata. Changes sync immediately to transcription output.</p>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-xs font-semibold rounded-lg text-white flex items-center gap-2 transition-colors"
        >
          <Icons.Sparkles />
          {saving ? 'Saving...' : 'Save Case'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 columns: Main forms */}
        <div className="lg:col-span-2 space-y-6">

          {/* Title Page Section */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="bg-slate-950 px-5 py-3 border-b border-slate-800 flex justify-between items-center">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Title Page Layout (UFM Fig. 03)</span>
              <span className="text-[10px] text-sky-400 font-bold bg-sky-500/10 px-2.5 py-0.5 rounded border border-sky-500/10">Active Structure</span>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className={labelCls}>Cause Number</label>
                <input type="text" value={caseData.cause_number ?? ''} onChange={f('cause_number')} className={inputCls} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Plaintiff</label>
                  <input type="text" value={caseData.plaintiff ?? ''} onChange={f('plaintiff')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Defendant</label>
                  <input type="text" value={caseData.defendant ?? ''} onChange={f('defendant')} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Case Style</label>
                <textarea rows={2} value={caseData.case_style ?? ''} onChange={f('case_style')} className={`${inputCls} font-mono resize-none`} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="col-span-2">
                  <label className={labelCls}>Court Type</label>
                  <input type="text" value={caseData.court_type ?? ''} onChange={f('court_type')} className={inputCls} />
                </div>
                <div>
                  <label className={`${labelCls} flex items-center gap-1.5`}>
                    County
                    {!caseData.county && <span className="text-amber-400"><Icons.Alert /></span>}
                  </label>
                  <input type="text" placeholder="e.g. Bexar" value={caseData.county ?? ''} onChange={f('county')} className={caseData.county ? inputCls : warnInputCls} />
                </div>
                <div>
                  <label className={labelCls}>State</label>
                  <input type="text" value={caseData.state_name ?? ''} onChange={f('state_name')} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={`${labelCls} flex items-center gap-1.5`}>
                  Judicial District
                  {!caseData.judicial_district && <span className="text-amber-400"><Icons.Alert /></span>}
                </label>
                <input type="text" placeholder="e.g. 73rd" value={caseData.judicial_district ?? ''} onChange={f('judicial_district')} className={caseData.judicial_district ? inputCls : warnInputCls} />
              </div>
            </div>
          </div>

          {/* Appearances Section */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="bg-slate-950 px-5 py-3 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Appearances (UFM Fig. 04)</span>
            </div>
            <div className="p-5 space-y-4">
              <div className="border-b border-slate-800 pb-3 mb-2 flex items-center justify-between">
                <h4 className="text-xs font-bold text-sky-400 uppercase tracking-wide">Defense Counsel</h4>
                <span className="text-[10px] text-slate-400 font-mono">Mapped to Voice Cluster 1</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Attorney Name</label>
                  <input type="text" value={caseData.defense_attorney ?? ''} onChange={f('defense_attorney')} className={inputCls} />
                </div>
                <div>
                  <label className={`${labelCls} flex items-center gap-1.5`}>
                    State Bar No. (SBOT)
                    {!caseData.state_bar_no && <span className="text-amber-400"><Icons.Alert /></span>}
                  </label>
                  <input type="text" placeholder="e.g. 24089942" value={caseData.state_bar_no ?? ''} onChange={f('state_bar_no')} className={caseData.state_bar_no ? inputCls : warnInputCls} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Firm Name</label>
                  <input type="text" value={caseData.firm_name ?? ''} onChange={f('firm_name')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Phone</label>
                  <input type="text" value={caseData.phone ?? ''} onChange={f('phone')} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Address</label>
                <input type="text" value={caseData.address ?? ''} onChange={f('address')} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Represents</label>
                <input type="text" value={caseData.represents ?? ''} onChange={f('represents')} className={inputCls} />
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Deposition Details */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="bg-slate-950 px-5 py-3 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Deposition Details</span>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className={labelCls}>Date of Deposition</label>
                <input type="date" value={caseData.deposition_date ?? ''} onChange={f('deposition_date')} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Start Time</label>
                  <input type="text" placeholder="09:00 AM" value={caseData.scheduled_start_time ?? ''} onChange={f('scheduled_start_time')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Method</label>
                  <input type="text" value={caseData.method ?? ''} onChange={f('method')} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Witness Full Name</label>
                <input type="text" value={caseData.witness_full_name ?? ''} onChange={f('witness_full_name')} className={`${inputCls} font-semibold text-white`} />
              </div>
              <div>
                <label className={labelCls}>Location</label>
                <input type="text" value={caseData.location_name ?? ''} onChange={f('location_name')} className={inputCls} />
              </div>
            </div>
          </div>

          {/* Reporter Certificate */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="bg-slate-950 px-5 py-3 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Reporter's Certificate</span>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className={labelCls}>Assigned Reporter</label>
                <select
                  value={caseData.reporter_id ?? ''}
                  onChange={f('reporter_id')}
                  className={`${inputCls} font-semibold`}
                >
                  <option value="">-- Select Reporter --</option>
                  {reporters.map(r => (
                    <option key={r.id} value={r.id}>{r.name} — {r.firm}</option>
                  ))}
                </select>
              </div>
              {caseData.reporter_id && (() => {
                const rep = reporters.find(r => r.id === caseData.reporter_id);
                if (!rep) return null;
                return (
                  <div className="bg-sky-500/5 border border-sky-500/20 p-3 rounded-lg text-xs text-sky-300 leading-relaxed space-y-1">
                    <p className="font-bold text-sky-200">{rep.name} <span className="text-sky-400">({rep.credentials})</span></p>
                    <p>CSR: {rep.csr_number} — Exp: {rep.expiration_date}</p>
                    <p className="text-slate-400">{rep.firm}</p>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Copy / Billing */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="bg-slate-950 px-5 py-3 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Copy / Billing</span>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className={labelCls}>Ordered By</label>
                <input type="text" value={caseData.ordered_by ?? ''} onChange={f('ordered_by')} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Ordering Firm</label>
                <input type="text" value={caseData.ordering_firm ?? ''} onChange={f('ordering_firm')} className={inputCls} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
