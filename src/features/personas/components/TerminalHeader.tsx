import { useState, useEffect, useRef } from 'react';
import { Square, Copy, Check } from 'lucide-react';

interface TerminalHeaderProps {
  isRunning: boolean;
  lineCount: number;
  onCopy: () => void;
  copied: boolean;
  onStop?: () => void;
  /** Optional label shown next to the traffic lights (e.g. execution ID) */
  label?: string;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  if (hours > 0) {
    const hh = String(hours).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function TerminalHeader({ isRunning, lineCount, onCopy, copied, onStop, label }: TerminalHeaderProps) {
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(0);

  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now();
      setElapsed(0);
      const id = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current);
      }, 1000);
      return () => clearInterval(id);
    }
  }, [isRunning]);

  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-secondary/40 border-b border-border/20">
      <div className="flex items-center gap-2.5">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-amber-500/80" />
          <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
        </div>
        <span className="text-xs text-muted-foreground/50 ml-1 font-mono">
          {isRunning ? (
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Running
              <span className="text-muted-foreground/30">{formatElapsed(elapsed)}</span>
              <span className="text-muted-foreground/30">({lineCount} lines)</span>
            </span>
          ) : (
            <>
              {`Completed (${lineCount} lines)`}
              {label && <span className="text-muted-foreground/30 ml-2">{label}</span>}
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {!isRunning && lineCount > 0 && (
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted-foreground/50 hover:text-foreground/70 transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy Log'}
          </button>
        )}

        {isRunning && onStop && (
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 px-3 py-1 bg-red-500/15 hover:bg-red-500/25 border border-red-500/20 text-red-400 rounded-lg text-xs font-medium transition-colors"
          >
            <Square className="w-3 h-3" />
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
