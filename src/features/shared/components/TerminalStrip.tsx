import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, X, Copy, Check } from 'lucide-react';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';
import { useCopyToClipboard } from '@/hooks/utility/useCopyToClipboard';

// ── Types ─────────────────────────────────────────────────────────────

interface TerminalStripProps {
  /** Single line shown in the collapsed strip (typically the latest log entry). */
  lastLine: string;
  /** Full log lines rendered in the expanded panel. */
  lines: string[];
  /** Whether the underlying process is still running. */
  isRunning: boolean;
  /** Controlled expand/collapse state. */
  isExpanded: boolean;
  /** Toggle expand/collapse callback. */
  onToggle: () => void;
  /** Clear/dismiss callback. Hidden while running. */
  onClear?: () => void;
  /** Optional slot rendered before the last-line text (counters, badges, progress). */
  counters?: ReactNode;
  /**
   * Return a Tailwind class string for a given log line.
   * Defaults to the shared `classifyLine` + `TERMINAL_STYLE_MAP` mapping used
   * by CliOutputPanel and ExecutionTerminal.
   */
  lineClassName?: (line: string) => string;
  /** Max-height class for the expanded panel. Default `"max-h-40"`. */
  expandedMaxHeight?: string;
}

// ── Default line classifier ───────────────────────────────────────────

function defaultLineClassName(line: string): string {
  return TERMINAL_STYLE_MAP[classifyLine(line)];
}

// ── Component ─────────────────────────────────────────────────────────

export function TerminalStrip({
  lastLine,
  lines,
  isRunning,
  isExpanded,
  onToggle,
  onClear,
  counters,
  lineClassName = defaultLineClassName,
  expandedMaxHeight = 'max-h-40',
}: TerminalStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { copied, copy } = useCopyToClipboard();

  // Auto-scroll expanded panel on new lines
  useEffect(() => {
    if (isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isExpanded, lines.length]);

  return (
    <div className="border-b border-primary/8 bg-secondary/10 shrink-0">
      {/* ── Collapsed strip (always visible) ──────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2">
        {/* Running indicator */}
        {isRunning && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
        )}

        {/* Consumer-provided counters / badges */}
        {counters}

        {/* Last log line */}
        <span className="flex-1 font-mono text-[11px] text-muted-foreground/50 truncate">
          {lastLine}
        </span>

        {/* Copy log */}
        {!isRunning && lines.length > 0 && (
          <button
            onClick={() => copy(lines.join('\n'))}
            className="p-1 rounded hover:bg-secondary/40 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors shrink-0"
            title="Copy log"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        )}

        {/* Expand / collapse */}
        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-secondary/40 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors shrink-0"
          title={isExpanded ? 'Collapse log' : 'Expand log'}
        >
          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {/* Clear / dismiss */}
        {!isRunning && onClear && lines.length > 0 && (
          <button
            onClick={onClear}
            className="p-1 rounded hover:bg-secondary/40 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors shrink-0"
            title="Dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* ── Expanded log panel ────────────────────────────────────── */}
      {isExpanded && (
        <div
          ref={scrollRef}
          className={`${expandedMaxHeight} overflow-y-auto px-4 pb-2 font-mono text-[11px] leading-4 space-y-px border-t border-primary/5`}
        >
          {lines.map((line, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap break-words ${lineClassName(line)}`}
            >
              {line}
            </div>
          ))}
          {isRunning && (
            <div className="text-blue-400/40 animate-pulse">{'>'} _</div>
          )}
        </div>
      )}
    </div>
  );
}
