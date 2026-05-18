import { useState, useRef } from 'react';
import SimpleTranscribe from './components/SimpleTranscribe';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

export default function App() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastCounter = useRef(0);

  const dismissToast = (id: number) =>
    setToasts(prev => prev.filter(t => t.id !== id));

  // Exposed for child components via context if needed later
  const _notify = (message: string, type: Toast['type'] = 'success') => {
    const id = ++toastCounter.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => dismissToast(id), type === 'error' ? 14000 : 8000);
  };
  void _notify; // suppress unused warning until wired to children

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased">

      {/* Toast stack */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
          {toasts.map(toast => (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3.5 shadow-2xl border backdrop-blur-sm ${
                toast.type === 'error'
                  ? 'bg-rose-950/95 border-rose-500/40'
                  : 'bg-slate-900/95 border-slate-700/80'
              }`}
            >
              <div className={`mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${
                toast.type === 'error' ? 'bg-rose-500' : 'bg-emerald-500'
              }`}>
                {toast.type === 'error' ? (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                ) : (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                )}
              </div>
              <p className={`flex-1 text-sm leading-snug font-medium ${
                toast.type === 'error' ? 'text-rose-100' : 'text-slate-200'
              }`}>{toast.message}</p>
              <button
                onClick={() => dismissToast(toast.id)}
                className={`shrink-0 mt-0.5 transition-colors ${
                  toast.type === 'error' ? 'text-rose-400/60 hover:text-rose-200' : 'text-slate-500 hover:text-slate-200'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <header className="bg-slate-900/80 backdrop-blur-md border-b border-slate-800/80 px-6 py-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center font-bold text-white shadow-lg shadow-sky-600/20 text-sm">
            D
          </div>
          <div>
            <h1 className="text-base font-bold tracking-wide text-white">DEPO-PRO</h1>
            <p className="text-[10px] text-slate-400 font-semibold tracking-wider -mt-0.5 uppercase">Transcribe Platform</p>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-950 border border-slate-800/80">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs text-slate-300 font-medium">Nova 3</span>
        </div>
      </header>

      <SimpleTranscribe />
    </div>
  );
}
