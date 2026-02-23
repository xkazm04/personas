import { useEffect, useRef, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, Timer, DollarSign, ArrowDown } from 'lucide-react';
import { classifyLine, TERMINAL_STYLE_MAP, parseSummaryLine } from '@/lib/utils/terminalColors';
import type { TerminalLineStyle } from '@/lib/utils/terminalColors';
import { motion, AnimatePresence } from 'framer-motion';

interface TerminalBodyProps {
  lines: string[];
  isRunning?: boolean;
  /** Return whether a line with a given style is visible under the current filter. */
  isLineVisible?: (line: string, style: TerminalLineStyle) => boolean;
  /** True when a non-trivial filter is active (dims non-matching lines). */
  isFiltering?: boolean;
  /** Max height CSS class. Defaults to "max-h-[500px]". Ignored when maxHeightPx or flexFill is set. */
  maxHeightClass?: string;
  /** Dynamic pixel max-height (for resizable terminals). Overrides maxHeightClass. */
  maxHeightPx?: number;
  /** Grow to fill available flex height (fullscreen mode). Overrides maxHeightClass and maxHeightPx. */
  flexFill?: boolean;
  /** Show summary-line rendering with status icons (PersonaRunner style). */
  showSummaryLines?: boolean;
  /** Show animated cursor when running. */
  showCursor?: boolean;
  /** Enable unseen-line counter FAB when user scrolls away from bottom. */
  enableUnseenCounter?: boolean;
}

export function TerminalBody({
  lines,
  isRunning = false,
  isLineVisible,
  isFiltering = false,
  maxHeightClass = 'max-h-[500px]',
  maxHeightPx,
  flexFill = false,
  showSummaryLines = false,
  showCursor = false,
  enableUnseenCounter = false,
}: TerminalBodyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const lastSeenLineCount = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (containerRef.current && shouldAutoScroll.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    if (enableUnseenCounter && !shouldAutoScroll.current) {
      const newLines = lines.length - lastSeenLineCount.current;
      if (newLines > 0) setUnseenCount((c) => c + newLines);
    }
    lastSeenLineCount.current = lines.length;
  }, [lines.length, enableUnseenCounter]);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
      shouldAutoScroll.current = isAtBottom;
      if (isAtBottom && enableUnseenCounter) setUnseenCount(0);
    }
  }, [enableUnseenCounter]);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      shouldAutoScroll.current = true;
      setUnseenCount(0);
    }
  }, []);

  const scrollClass = flexFill
    ? 'flex-1 min-h-0 overflow-y-auto text-sm bg-background font-mono'
    : `${maxHeightPx === undefined ? maxHeightClass : ''} overflow-y-auto text-sm bg-background font-mono`;
  const scrollStyle = !flexFill && maxHeightPx !== undefined ? { maxHeight: maxHeightPx } : undefined;

  return (
    <div className={flexFill ? 'relative flex-1 flex flex-col min-h-0' : 'relative'}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={scrollClass}
        style={scrollStyle}
      >
        {lines.length === 0 ? (
          <div className="p-6 text-muted-foreground/80 text-center">
            No output yet...
          </div>
        ) : (
          <div className="px-4 py-3 space-y-0.5">
            {lines.map((line, i) => {
              if (!line.trim()) return <div key={i} className="h-2" />;
              const style = classifyLine(line);
              const visible = isLineVisible ? isLineVisible(line, style) : true;

              if (showSummaryLines && style === 'summary') {
                const summary = parseSummaryLine(line);
                if (summary) {
                  const isSuccess = summary.status === 'completed';
                  const isFailed = summary.status === 'failed';
                  return (
                    <div key={i} className={`border-t border-primary/15 pt-2 mt-2 transition-opacity ${isFiltering && !visible ? 'opacity-20' : ''}`}>
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          {isSuccess ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : isFailed ? (
                            <XCircle className="w-3.5 h-3.5 text-red-400" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-amber-400" />
                          )}
                          <span className={`font-semibold capitalize ${isSuccess ? 'text-emerald-400/90' : isFailed ? 'text-red-400/90' : 'text-amber-400/90'}`}>
                            {summary.status}
                          </span>
                        </div>
                        {summary.duration_ms != null && (
                          <div className="flex items-center gap-1.5 text-muted-foreground/80">
                            <Timer className="w-3 h-3" />
                            <span>{(summary.duration_ms / 1000).toFixed(1)}s</span>
                          </div>
                        )}
                        {summary.cost_usd != null && (
                          <div className="flex items-center gap-1.5 text-muted-foreground/80">
                            <DollarSign className="w-3 h-3" />
                            <span>${summary.cost_usd.toFixed(4)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
              }

              return (
                <div key={i} className={`text-sm leading-5 whitespace-pre-wrap break-words ${TERMINAL_STYLE_MAP[style]} transition-opacity ${isFiltering && !visible ? 'opacity-20' : ''}`}>
                  {line}
                </div>
              );
            })}
            {showCursor && isRunning && (
              <div className="text-muted-foreground/80 animate-pulse">{'>'} _</div>
            )}
          </div>
        )}
      </div>

      {/* Jump-to-bottom FAB */}
      {enableUnseenCounter && (
        <AnimatePresence>
          {unseenCount > 0 && (
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              onClick={scrollToBottom}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/90 text-foreground text-sm font-medium shadow-lg shadow-primary/20 hover:bg-primary transition-colors backdrop-blur-sm"
            >
              <ArrowDown className="w-3 h-3" />
              {unseenCount} new line{unseenCount !== 1 ? 's' : ''} below
            </motion.button>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
