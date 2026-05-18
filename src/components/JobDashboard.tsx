import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { TranscriptionJob } from '../lib/database.types';

interface JobWithCase extends TranscriptionJob {
  case_witness?: string;
  case_number?: string;
}

interface JobDashboardProps {
  onReopenJob: (job: TranscriptionJob) => void;
}

type StatusFilter = 'all' | 'complete' | 'processing' | 'pending' | 'failed';

function formatDuration(seconds: number): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_CONFIG = {
  complete:   { label: 'Complete',   dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  processing: { label: 'Processing', dot: 'bg-sky-500 animate-pulse', text: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/20' },
  pending:    { label: 'Pending',    dot: 'bg-amber-500 animate-pulse', text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  failed:     { label: 'Failed',     dot: 'bg-rose-500', text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
};

function buildDiagnosticExport(job: JobWithCase): string {
  const lines: string[] = [];
  lines.push(`=== Depo-Pro Job Diagnostic Export ===`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(``);
  lines.push(`Job ID:       ${job.id}`);
  lines.push(`Status:       ${job.status}`);
  lines.push(`Phase:        ${job.phase ?? '—'}`);
  lines.push(`Progress:     ${job.progress ?? 0}%`);
  lines.push(`Parts:        ${job.parts_completed ?? 0}/${job.parts_total ?? 1}`);
  lines.push(`Model:        ${job.model ?? '—'}`);
  lines.push(`Source File:  ${job.source_file_name}`);
  lines.push(`Storage Path: ${job.storage_path ?? '—'}`);
  lines.push(`Witness:      ${job.case_witness ?? '—'}`);
  lines.push(`Case Number:  ${job.case_number ?? '—'}`);
  lines.push(`Created:      ${job.created_at}`);
  lines.push(`Updated:      ${(job as JobWithCase & { updated_at?: string }).updated_at ?? '—'}`);
  lines.push(``);
  if (job.error_message) {
    lines.push(`=== Error Message ===`);
    lines.push(job.error_message);
    lines.push(``);
  }
  lines.push(`=== Deepgram Options ===`);
  lines.push(JSON.stringify(job.deepgram_options ?? {}, null, 2));
  lines.push(``);
  lines.push(`=== Pipeline Log (${(job.logs ?? []).length} entries) ===`);
  for (const line of (job.logs ?? [])) {
    lines.push(line);
  }
  return lines.join('\n');
}

export default function JobDashboard({ onReopenJob }: JobDashboardProps) {
  const [jobs, setJobs] = useState<JobWithCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [logsModalJob, setLogsModalJob] = useState<JobWithCase | null>(null);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJobs = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    const { data, error } = await supabase
      .from('transcription_jobs')
      .select(`
        *,
        cases (
          witness_full_name,
          cause_number
        )
      `)
      .order('created_at', { ascending: false })
      .limit(200);

    if (!error && data) {
      const mapped = data.map((j: unknown) => {
        const row = j as TranscriptionJob & { cases?: Record<string, string> | null };
        return {
          ...row,
          case_witness: row.cases?.witness_full_name ?? '',
          case_number: row.cases?.cause_number ?? '',
        };
      });
      setJobs(mapped);
      // Stop polling once no jobs are in an active state
      const hasActive = mapped.some(j => j.status === 'processing' || j.status === 'pending');
      if (!hasActive && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    if (showSpinner) setLoading(false);
  }, []);

  const loadJobs = useCallback(() => fetchJobs(true), [fetchJobs]);

  const handleDeleteJob = async (jobId: string) => {
    setDeletingJobId(jobId);
    try {
      // Delete child rows first (FK constraints), then the job itself
      await supabase.from('speaker_turns').delete().eq('job_id', jobId);
      await supabase.from('utterances').delete().eq('job_id', jobId);
      await supabase.from('speaker_mappings').delete().eq('job_id', jobId);
      await supabase.from('transcription_jobs').delete().eq('id', jobId);
      setJobs(prev => prev.filter(j => j.id !== jobId));
      if (selectedJobId === jobId) setSelectedJobId(null);
    } finally {
      setDeletingJobId(null);
      setConfirmDeleteId(null);
    }
  };

  // On mount: load immediately, then poll every 3s while any job is active
  useEffect(() => {
    fetchJobs(true).then(() => {
      // Start polling — fetchJobs will clear the interval itself once all jobs settle
      pollRef.current = setInterval(() => fetchJobs(false), 3000);
    });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchJobs]);

  const filtered = jobs.filter(j => {
    if (statusFilter !== 'all' && j.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        j.source_file_name.toLowerCase().includes(q) ||
        (j.case_witness ?? '').toLowerCase().includes(q) ||
        (j.case_number ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const counts = {
    all: jobs.length,
    complete: jobs.filter(j => j.status === 'complete').length,
    processing: jobs.filter(j => j.status === 'processing').length,
    pending: jobs.filter(j => j.status === 'pending').length,
    failed: jobs.filter(j => j.status === 'failed').length,
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950">
      {/* Header */}
      <div className="bg-slate-900/60 border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-white">Job History</h2>
            <p className="text-xs text-slate-400 mt-0.5">{jobs.length} transcription jobs total</p>
          </div>
          <button
            onClick={loadJobs}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition-colors disabled:opacity-50"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Status filters */}
          <div className="flex gap-1">
            {(['all', 'complete', 'processing', 'pending', 'failed'] as StatusFilter[]).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all ${
                  statusFilter === s
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-950 text-slate-500 border border-slate-800 hover:text-slate-300'
                }`}
              >
                {s} {s !== 'all' && <span className="ml-0.5 opacity-70">({counts[s]})</span>}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by witness, case number, or file..."
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-sky-500 focus:outline-none w-64"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
            Loading jobs...
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-slate-600">
            <svg className="w-8 h-8 mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">No jobs found</p>
            {statusFilter !== 'all' && <p className="text-xs mt-1">Try changing the filter</p>}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-900/80 border-b border-slate-800 sticky top-0 z-10">
                <th className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Witness / Case</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">File</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Model</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Duration</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Words</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Version</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map(job => {
                const sc = STATUS_CONFIG[job.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
                const isSelected = selectedJobId === job.id;
                return (
                  <tr
                    key={job.id}
                    onClick={() => setSelectedJobId(prev => prev === job.id ? null : job.id)}
                    className={`transition-colors cursor-pointer ${
                      isSelected ? 'bg-slate-800/60' : 'hover:bg-slate-900/60'
                    }`}
                  >
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${sc.bg} ${sc.text} ${sc.border}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                        {sc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-slate-200">{job.case_witness || '—'}</div>
                      <div className="text-slate-500 text-[10px]">{job.case_number || 'No case linked'}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="text-slate-300 truncate max-w-48" title={job.source_file_name}>
                        {job.source_file_name}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono text-[10px] border border-slate-700">
                        {job.model}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-400 font-mono tabular-nums">
                      {formatDuration(job.duration_seconds)}
                    </td>
                    <td className="px-4 py-3.5 text-slate-300 font-mono tabular-nums">
                      {job.word_count > 0 ? job.word_count.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-slate-400 font-mono">v{job.transcript_version}</span>
                      {job.export_count > 0 && (
                        <span className="ml-1.5 text-[9px] text-slate-500">({job.export_count}x exported)</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-slate-400 tabular-nums">
                      {formatDate(job.created_at)}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        {job.status === 'complete' && (
                          <button
                            onClick={e => { e.stopPropagation(); onReopenJob(job); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold rounded-lg transition-colors"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                            Open
                          </button>
                        )}
                        {job.status === 'failed' && (
                          <span className="text-[10px] text-rose-400 italic truncate max-w-[100px]" title={job.error_message ?? ''}>
                            {job.error_message ? job.error_message.slice(0, 35) + '…' : 'Failed'}
                          </span>
                        )}
                        {(job.status === 'processing' || job.status === 'pending') && (
                          <span className="text-[10px] text-amber-400 font-mono">{job.progress}%</span>
                        )}

                        {/* View Logs */}
                        <button
                          onClick={e => { e.stopPropagation(); setLogsModalJob(job); }}
                          title="View pipeline logs and diagnostic info"
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          Logs
                        </button>

                        {/* Delete */}
                        {confirmDeleteId === job.id ? (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <span className="text-[10px] text-rose-400 font-semibold">Delete?</span>
                            <button
                              onClick={e => { e.stopPropagation(); handleDeleteJob(job.id); }}
                              disabled={deletingJobId === job.id}
                              className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold rounded transition-colors disabled:opacity-50"
                            >
                              {deletingJobId === job.id ? '…' : 'Yes'}
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}
                              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-[10px] font-bold rounded transition-colors"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={e => { e.stopPropagation(); setConfirmDeleteId(job.id); }}
                            disabled={deletingJobId === job.id}
                            title="Delete job"
                            className="p-1.5 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pipeline Diagnostic Log Modal */}
      {logsModalJob && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setLogsModalJob(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white">Pipeline Diagnostic Log</h3>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  {logsModalJob.source_file_name} &bull; Job <span className="font-mono">{logsModalJob.id}</span>
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(buildDiagnosticExport(logsModalJob)).then(() => {
                      setCopyConfirmed(true);
                      setTimeout(() => setCopyConfirmed(false), 2000);
                    });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  {copyConfirmed ? 'Copied!' : 'Copy All'}
                </button>
                <button
                  onClick={() => setLogsModalJob(null)}
                  className="text-slate-500 hover:text-slate-200 p-1 rounded transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Status summary grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Status', value: logsModalJob.status },
                  { label: 'Phase', value: logsModalJob.phase ?? '—' },
                  { label: 'Parts', value: `${logsModalJob.parts_completed ?? 0}/${logsModalJob.parts_total ?? 1}` },
                  { label: 'Model', value: logsModalJob.model ?? '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">{label}</div>
                    <div className="text-sm text-slate-100 mt-1 font-mono truncate" title={value}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Error message — only on failed */}
              {logsModalJob.status === 'failed' && logsModalJob.error_message && (
                <div className="bg-rose-950/40 border border-rose-800/60 rounded-lg p-4">
                  <div className="text-[10px] uppercase tracking-wide text-rose-400 font-bold mb-1.5">Error Message</div>
                  <div className="text-sm text-rose-100 font-mono whitespace-pre-wrap break-words leading-relaxed">
                    {logsModalJob.error_message}
                  </div>
                </div>
              )}

              {/* Pipeline log */}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-2">
                  Pipeline Log <span className="text-slate-600 normal-case font-normal">({(logsModalJob.logs ?? []).length} entries)</span>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-[11px] text-slate-300 max-h-80 overflow-y-auto">
                  {(logsModalJob.logs ?? []).length === 0 ? (
                    <div className="text-slate-600 italic">No log entries recorded.</div>
                  ) : (
                    <div className="space-y-0.5">
                      {(logsModalJob.logs ?? []).map((line, idx) => (
                        <div
                          key={idx}
                          className={`leading-relaxed whitespace-pre-wrap break-words ${
                            line.includes('[ERROR]') || line.includes('FAILED') || line.includes('failed')
                              ? 'text-rose-300'
                              : line.includes('[STALE]') || line.includes('[WARN]')
                              ? 'text-amber-300'
                              : line.includes('[UPLOAD]') || line.includes('[ASYNC]') || line.includes('[SUBMIT]')
                              ? 'text-sky-300'
                              : 'text-slate-300'
                          }`}
                        >
                          {line}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Metadata */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Created</div>
                  <div className="text-slate-300 font-mono mt-0.5">{logsModalJob.created_at}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Updated</div>
                  <div className="text-slate-300 font-mono mt-0.5">
                    {(logsModalJob as JobWithCase & { updated_at?: string }).updated_at ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Storage Path</div>
                  <div className="text-slate-300 font-mono mt-0.5 truncate" title={logsModalJob.storage_path ?? ''}>
                    {logsModalJob.storage_path || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Source File</div>
                  <div className="text-slate-300 font-mono mt-0.5 truncate" title={logsModalJob.source_file_name}>
                    {logsModalJob.source_file_name}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
