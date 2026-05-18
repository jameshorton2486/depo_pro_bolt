import { useRef, forwardRef, useImperativeHandle, useEffect, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';

export interface DiffPlaybackHandle {
  seekTo: (seconds: number) => void;
  playRegion: (start: number, end: number) => void;
  getCurrentTime: () => number;
}

interface DiffPlaybackControlsProps {
  audioUrl: string | null;
  onTimeUpdate: (t: number) => void;
  onReady: (duration: number) => void;
  className?: string;
}

const DiffPlaybackControls = forwardRef<DiffPlaybackHandle, DiffPlaybackControlsProps>(
  ({ audioUrl, onTimeUpdate, onReady, className = '' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WaveSurfer | null>(null);
    const [playing, setPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [loading, setLoading] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const regionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [rate, setRate] = useState(1);

    const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
    const stopRegion = () => { if (regionTimerRef.current) { clearTimeout(regionTimerRef.current); regionTimerRef.current = null; } };

    const startPoll = useCallback(() => {
      stopPoll();
      pollRef.current = setInterval(() => {
        const t = wsRef.current?.getCurrentTime() ?? 0;
        setCurrentTime(t);
        onTimeUpdate(t);
      }, 50);
    }, [onTimeUpdate]);

    useEffect(() => {
      if (!containerRef.current || !audioUrl) return;
      setLoading(true);
      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: '#1e293b',
        progressColor: '#0ea5e9',
        cursorColor: '#38bdf8',
        height: 36,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
      });
      wsRef.current = ws;
      ws.on('ready', dur => { setDuration(dur); setLoading(false); onReady(dur); });
      ws.on('play', () => { setPlaying(true); startPoll(); });
      ws.on('pause', () => { setPlaying(false); stopPoll(); });
      ws.on('finish', () => { setPlaying(false); stopPoll(); stopRegion(); });
      ws.on('error', () => setLoading(false));
      ws.load(audioUrl);
      return () => { stopPoll(); stopRegion(); ws.destroy(); wsRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioUrl]);

    useEffect(() => { wsRef.current?.setPlaybackRate(rate); }, [rate]);

    useImperativeHandle(ref, () => ({
      seekTo(seconds) {
        if (!wsRef.current || !duration) return;
        wsRef.current.seekTo(Math.min(1, Math.max(0, seconds / duration)));
      },
      playRegion(start, end) {
        if (!wsRef.current || !duration) return;
        stopRegion();
        wsRef.current.seekTo(start / duration);
        wsRef.current.play();
        const ms = ((end - start) * 1000) / rate;
        regionTimerRef.current = setTimeout(() => { wsRef.current?.isPlaying() && wsRef.current.pause(); }, ms);
      },
      getCurrentTime() { return wsRef.current?.getCurrentTime() ?? 0; },
    }), [duration, rate]);

    const skip = (sec: number) => {
      if (!wsRef.current || !duration) return;
      stopRegion();
      wsRef.current.seekTo(Math.min(1, Math.max(0, (wsRef.current.getCurrentTime() + sec) / duration)));
    };

    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2,'0')}`;
    const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
      <div className={`flex flex-col gap-2 bg-slate-900 rounded-xl border border-slate-800 p-3 ${className}`}>
        {/* Waveform */}
        <div className="relative min-h-[36px]">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-4 h-4 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            </div>
          )}
          {!audioUrl && (
            <div className="h-9 flex items-center justify-center text-[11px] text-slate-600 border border-slate-800 rounded border-dashed">
              No audio loaded
            </div>
          )}
          <div ref={containerRef} className={!audioUrl ? 'hidden' : 'rounded overflow-hidden'} />
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <button onClick={() => skip(-5)} disabled={!audioUrl} className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 disabled:opacity-30 transition-colors">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"/>
            </svg>
          </button>

          <button
            onClick={() => { stopRegion(); wsRef.current?.playPause(); }}
            disabled={!audioUrl}
            className="w-7 h-7 rounded-full bg-sky-600 hover:bg-sky-500 disabled:opacity-30 text-white flex items-center justify-center transition-colors shadow-md shadow-sky-600/20"
          >
            {playing ? (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            ) : (
              <svg className="w-3 h-3 translate-x-px" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>

          <button onClick={() => skip(5)} disabled={!audioUrl} className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 disabled:opacity-30 transition-colors">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z"/>
            </svg>
          </button>

          <span className="text-[10px] font-mono text-slate-400 tabular-nums">{fmt(currentTime)}<span className="text-slate-600 mx-0.5">/</span>{fmt(duration)}</span>

          <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden cursor-pointer"
            onClick={e => {
              if (!wsRef.current || !duration) return;
              const r = e.currentTarget.getBoundingClientRect();
              wsRef.current.seekTo((e.clientX - r.left) / r.width);
            }}
          >
            <div className="h-full bg-sky-500 rounded-full" style={{ width: `${pct}%` }} />
          </div>

          <select
            value={rate}
            onChange={e => setRate(Number(e.target.value))}
            className="text-[10px] bg-slate-800 border border-slate-700 rounded px-1 py-1 text-slate-300 focus:outline-none"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => <option key={r} value={r}>{r}×</option>)}
          </select>
        </div>
      </div>
    );
  }
);

DiffPlaybackControls.displayName = 'DiffPlaybackControls';
export default DiffPlaybackControls;
