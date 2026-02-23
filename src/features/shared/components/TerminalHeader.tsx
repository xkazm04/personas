import { useElapsedTimer } from '@/hooks';
import { formatElapsed } from '@/lib/utils/formatters';
import { Square, Copy, Check, Maximize2, Minimize2 } from 'lucide-react';

interface TerminalHeaderProps {
  isRunning: boolean;
  lineCount: number;
  onCopy: () => void;
  copied: boolean;
  onStop?: () => void;
  /** Optional label shown next to the traffic lights (e.g. execution ID) */
  label?: string;
  /** Callback to toggle fullscreen mode */
  onToggleFullscreen?: () => void;
  /** Whether the terminal is currently in fullscreen mode */
  isFullscreen?: boolean;
}


export function TerminalHeader({ isRunning, lineCount, onCopy, copied, onStop, label, onToggleFullscreen, isFullscreen }: TerminalHeaderProps) {
  const elapsed = useElapsedTimer(isRunning, 1000);

  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-secondary/40 border-b border-border/20">
      <div className="flex items-center gap-2.5">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-amber-500/80" />
          <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
        </div>
        <span className="text-sm text-muted-foreground/90 ml-1 font-mono">
          {isRunning ? (
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Running
              <span className="text-muted-foreground/80">{formatElapsed(elapsed, 'clock')}</span>
              <span className="text-muted-foreground/80">({lineCount} lines)</span>
            </span>
          ) : (
            <>
              {`Completed (${lineCount} lines)`}
              {label && <span className="text-muted-foreground/80 ml-2">{label}</span>}
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            className="flex items-center px-2 py-1 text-muted-foreground/70 hover:text-foreground/90 transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        )}
        {!isRunning && lineCount > 0 && (
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 text-sm text-muted-foreground/90 hover:text-foreground/95 transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy Log'}
          </button>
        )}

        {isRunning && onStop && (
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 px-3 py-1 bg-red-500/15 hover:bg-red-500/25 border border-red-500/20 text-red-400 rounded-lg text-sm font-medium transition-colors"
          >
            <Square className="w-3 h-3" />
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
