import { useElapsedTimer } from '@/hooks';
import { formatElapsed } from '@/lib/utils/formatters';
import { Square, X, Minus, Plus } from 'lucide-react';
import { CopyButton } from '../buttons';
import { Tooltip } from '../display/Tooltip';

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
  /** Close / collapse the terminal panel */
  onClose?: () => void;
  /** Minimize to a single-line summary strip */
  onMinimize?: () => void;
}


export function TerminalHeader({ isRunning, lineCount, onCopy, copied, onStop, label, onToggleFullscreen, isFullscreen, onClose, onMinimize }: TerminalHeaderProps) {
  const elapsed = useElapsedTimer(isRunning, 1000);

  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-secondary/40 border-b border-border/20">
      <div className="flex items-center gap-2.5">
        <div className="group/dots flex gap-1.5">
          {onClose ? (
            <Tooltip content="Close">
              <button
                onClick={onClose}
                className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center cursor-pointer transition-colors"
              >
                <X className="w-2 h-2 text-red-900 opacity-0 group-hover/dots:opacity-100 transition-opacity" />
              </button>
            </Tooltip>
          ) : (
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
          )}
          {onMinimize ? (
            <Tooltip content="Minimize">
              <button
                onClick={onMinimize}
                className="w-3 h-3 rounded-full bg-amber-500/80 hover:bg-amber-500 flex items-center justify-center cursor-pointer transition-colors"
              >
                <Minus className="w-2 h-2 text-amber-900 opacity-0 group-hover/dots:opacity-100 transition-opacity" />
              </button>
            </Tooltip>
          ) : (
            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
          )}
          {onToggleFullscreen ? (
            <Tooltip content={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              <button
                onClick={onToggleFullscreen}
                className="w-3 h-3 rounded-full bg-emerald-500/80 hover:bg-emerald-500 flex items-center justify-center cursor-pointer transition-colors"
              >
                <Plus className="w-2 h-2 text-emerald-900 opacity-0 group-hover/dots:opacity-100 transition-opacity" />
              </button>
            </Tooltip>
          ) : (
            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
          )}
        </div>
        <span className="typo-code text-muted-foreground/90 ml-1">
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
        {!isRunning && lineCount > 0 && (
          <CopyButton
            copied={copied}
            onCopy={onCopy}
            label="Copy Log"
            copiedLabel="Copied"
            iconSize="w-3 h-3"
            className="px-2.5 py-1 typo-body text-muted-foreground/90 hover:text-foreground/95"
          />
        )}

        {isRunning && onStop && (
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 px-3 py-1 bg-red-500/15 hover:bg-red-500/25 border border-red-500/20 text-red-400 rounded-xl typo-heading transition-colors"
          >
            <Square className="w-3 h-3" />
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
