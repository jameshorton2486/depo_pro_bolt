import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

export interface AudioPlaybackHandle {
  seekTo: (seconds: number) => void;
  playRegion: (start: number, end: number, contextPad?: number) => void;
  getCurrentTime: () => number;
  isPlaying: () => boolean;
}

interface AudioPlaybackControlsProps {
  audioUrl: string | null;
  onTimeUpdate: (currentTime: number) => void;
  onReady: (duration: number) => void;
  className?: string;
}

const AudioPlaybackControls = forwardRef<AudioPlaybackHandle, AudioPlaybackControlsProps>(
  ({ audioUrl, onTimeUpdate, onReady, className = '' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WaveSurfer | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [volume, setVolume] = useState(1);
    const [playbackRate, setPlaybackRate] = useState(1);
    const regionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const timeUpdateRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const clearRegionTimer = () => {
      if (regionTimerRef.current) { clearTimeout(regionTimerRef.current); regionTimerRef.current = null; }
    };

    const startTimePolling = useCallback(() => {
      if (timeUpdateRef.current) clearInterval(timeUpdateRef.current);
      timeUpdateRef.current = setInterval(() => {
        if (wsRef.current) {
          const t = wsRef.current.getCurrentTime();
          setCurrentTime(t);
          onTimeUpdate(t);
        }
      }, 50);
    }, [onTimeUpdate]);

    const stopTimePolling = useCallback(() => {
      if (timeUpdateRef.current) { clearInterval(timeUpdateRef.current); timeUpdateRef.current = null; }
    }, []);

    useEffect(() => {
      if (!containerRef.current || !audioUrl) return;

      setLoading(true);
      setError(null);

      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: '#334155',       // slate-700
        progressColor: '#0ea5e9',   // sky-500
        cursorColor: '#38bdf8',     // sky-400
        height: 48,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
        interact: true,
        hideScrollbar: false,
        minPxPerSec: 50,
      });

      wsRef.current = ws;

      ws.on('ready', (dur) => {
        setDuration(dur);
        setLoading(false);
        onReady(dur);
      });

      ws.on('play', () => { setIsPlaying(true); startTimePolling(); });
      ws.on('pause', () => { setIsPlaying(false); stopTimePolling(); });
      ws.on('finish', () => { setIsPlaying(false); stopTimePolling(); clearRegionTimer(); });

      ws.on('error', (err) => {
        setError(`Audio error: ${String(err)}`);
        setLoading(false);
      });

      ws.load(audioUrl);

      return () => {
        stopTimePolling();
        clearRegionTimer();
        ws.destroy();
        wsRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioUrl]);

    useEffect(() => {
      if (wsRef.current) wsRef.current.setVolume(volume);
    }, [volume]);

    useEffect(() => {
      if (wsRef.current) wsRef.current.setPlaybackRate(playbackRate);
    }, [playbackRate]);

    useImperativeHandle(ref, () => ({
      seekTo(seconds: number) {
        if (!wsRef.current || !duration) return;
        wsRef.current.seekTo(Math.min(1, Math.max(0, seconds / duration)));
      },
      playRegion(start: number, end: number, contextPad = 2) {
        if (!wsRef.current || !duration) return;
        clearRegionTimer();
        const from = Math.max(0, start - contextPad);
        wsRef.current.seekTo(from / duration);
        wsRef.current.play();
        const playDuration = (end + contextPad - from) * 1000;
        regionTimerRef.current = setTimeout(() => {
          if (wsRef.current?.isPlaying()) wsRef.current.pause();
        }, playDuration / playbackRate);
      },
      getCurrentTime() {
        return wsRef.current?.getCurrentTime() ?? 0;
      },
      isPlaying() {
        return wsRef.current?.isPlaying() ?? false;
      },
    }), [duration, playbackRate]);

    const togglePlay = useCallback(() => {
      if (!wsRef.current) return;
      clearRegionTimer();
      wsRef.current.playPause();
    }, []);

    const skip = useCallback((sec: number) => {
      if (!wsRef.current || !duration) return;
      clearRegionTimer();
      const next = Math.min(duration, Math.max(0, wsRef.current.getCurrentTime() + sec));
      wsRef.current.seekTo(next / duration);
    }, [duration]);

    const formatTime = (s: number) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
      return `${m}:${String(sec).padStart(2,'0')}`;
    };

    const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
      <div className={`flex flex-col gap-2 bg-slate-900 rounded-xl border border-slate-800 p-3 ${className}`}>
        {/* Waveform */}
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 rounded z-10">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <svg className="w-3.5 h-3.5 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Loading audio…
              </div>
            </div>
          )}
          {error && (
            <div className="h-12 flex items-center justify-center text-xs text-rose-400 bg-rose-500/5 rounded border border-rose-500/20">
              {error}
            </div>
          )}
          {!audioUrl && !error && (
            <div className="h-12 flex items-center justify-center text-xs text-slate-600 border border-slate-800 rounded border-dashed">
              No audio loaded
            </div>
          )}
          <div
            ref={containerRef}
            className={[
              'rounded overflow-hidden',
              !audioUrl || error ? 'hidden' : '',
            ].join(' ')}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-2">
          {/* Transport */}
          <button
            onClick={() => skip(-5)}
            disabled={!audioUrl || loading}
            title="Back 5s"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"/>
            </svg>
          </button>

          <button
            onClick={togglePlay}
            disabled={!audioUrl || loading}
            title={isPlaying ? 'Pause' : 'Play'}
            className="w-8 h-8 rounded-full bg-sky-600 hover:bg-sky-500 disabled:opacity-30 text-white flex items-center justify-center transition-colors shadow-md shadow-sky-600/20"
          >
            {isPlaying ? (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          <button
            onClick={() => skip(5)}
            disabled={!audioUrl || loading}
            title="Forward 5s"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z"/>
            </svg>
          </button>

          {/* Time display */}
          <span className="text-[11px] font-mono text-slate-400 tabular-nums ml-1">
            {formatTime(currentTime)}
            <span className="text-slate-600 mx-0.5">/</span>
            {formatTime(duration)}
          </span>

          {/* Progress bar (secondary) */}
          <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden mx-1 cursor-pointer"
            onClick={(e) => {
              if (!wsRef.current || !duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              wsRef.current.seekTo(Math.min(1, Math.max(0, pct)));
            }}
          >
            <div
              className="h-full bg-sky-500 rounded-full transition-none"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Playback rate */}
          <select
            value={playbackRate}
            onChange={e => setPlaybackRate(Number(e.target.value))}
            className="text-[10px] bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-slate-300 focus:outline-none cursor-pointer"
            title="Playback speed"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => (
              <option key={r} value={r}>{r}×</option>
            ))}
          </select>

          {/* Volume */}
          <div className="flex items-center gap-1">
            <svg className="w-3 h-3 text-slate-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
            </svg>
            <input
              type="range" min={0} max={1} step={0.05} value={volume}
              onChange={e => setVolume(Number(e.target.value))}
              className="w-14 h-1 accent-sky-500 cursor-pointer"
              title="Volume"
            />
          </div>
        </div>
      </div>
    );
  }
);

AudioPlaybackControls.displayName = 'AudioPlaybackControls';
export default AudioPlaybackControls;
