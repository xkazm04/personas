import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CheckCircle2, XCircle, Timer, DollarSign, ArrowDown, ChevronRight, Clock, Wifi, AlertCircle } from 'lucide-react';
import { classifyLine, TERMINAL_STYLE_MAP, parseSummaryLine } from '@/lib/utils/terminalColors';
import type { TerminalLineStyle } from '@/lib/utils/terminalColors';
import { motion, AnimatePresence } from 'framer-motion';

/** Terminal empty state describing the current execution context. */
export type TerminalEmptyState =
  | 'idle'
  | 'connecting'
  | { kind: 'queued'; position: number; depth?: number }
  | 'failed';

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
  /** Context-aware empty state. Defaults to 'idle'. */
  emptyState?: TerminalEmptyState;
}

// Estimated row height — the virtualizer dynamically measures actual heights
const ESTIMATED_ROW_HEIGHT = 22;
const OVERSCAN = 30;

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
  emptyState = 'idle',
}: TerminalBodyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const lastSeenLineCount = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);

  // Pre-classify lines so we don't re-classify inside the render loop
  const classified = useMemo(
    () => lines.map((line) => ({ line, style: classifyLine(line) })),
    [lines],
  );

  // Total item count: lines + optional cursor row at the end
  const itemCount = classified.length + (showCursor && isRunning ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // Auto-scroll to bottom when new lines arrive (if sticky)
  useEffect(() => {
    if (shouldAutoScroll.current && itemCount > 0) {
      virtualizer.scrollToIndex(itemCount - 1, { align: 'end' });
    }
    if (enableUnseenCounter && !shouldAutoScroll.current) {
      const newLines = lines.length - lastSeenLineCount.current;
      if (newLines > 0) setUnseenCount((c) => c + newLines);
    }
    lastSeenLineCount.current = lines.length;
  }, [itemCount, enableUnseenCounter, lines.length, virtualizer]);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
      shouldAutoScroll.current = isAtBottom;
      if (isAtBottom && enableUnseenCounter) setUnseenCount(0);
    }
  }, [enableUnseenCounter]);

  const scrollToBottom = useCallback(() => {
    if (itemCount > 0) {
      virtualizer.scrollToIndex(itemCount - 1, { align: 'end' });
    }
    shouldAutoScroll.current = true;
    setUnseenCount(0);
  }, [virtualizer, itemCount]);

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
        {lines.length === 0 && !(showCursor && isRunning) ? (
          <div className="p-6 font-mono text-center">
            {emptyState === 'idle' && (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-1.5 text-muted-foreground/60">
                  <ChevronRight className="w-3.5 h-3.5 text-emerald-400/60" />
                  <span className="text-sm">Press Enter or click Play to start</span>
                  <span className="inline-block w-[2px] h-4 bg-emerald-400/70 animate-[blink-caret_1s_step-end_infinite]" />
                </div>
              </div>
            )}
            {emptyState === 'connecting' && (
              <div className="flex flex-col items-center gap-2">
                <Wifi className="w-4 h-4 text-blue-400/60 animate-pulse" />
                <span className="text-sm text-muted-foreground/60">
                  Connecting to provider
                  <span className="inline-flex w-6 text-left animate-[ellipsis_1.5s_steps(3,end)_infinite] overflow-hidden">...</span>
                </span>
              </div>
            )}
            {typeof emptyState === 'object' && emptyState.kind === 'queued' && (
              <div className="flex flex-col items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400/60 animate-pulse" />
                <span className="text-sm text-amber-300/60">
                  Queued at position {emptyState.position}{emptyState.depth != null ? ` of ${emptyState.depth}` : ''}
                </span>
              </div>
            )}
            {emptyState === 'failed' && (
              <div className="flex flex-col items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400/60" />
                <span className="text-sm text-red-400/60">Connection failed — check provider settings and retry</span>
              </div>
            )}
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const idx = virtualRow.index;

              // Cursor row (last virtual item when running)
              if (idx >= classified.length) {
                return (
                  <div
                    key="__cursor__"
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute left-0 right-0 px-4"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <div className="text-muted-foreground/80 animate-pulse leading-5 py-[1px]">{'>'} _</div>
                  </div>
                );
              }

              const { line, style } = classified[idx]!;

              // Empty line spacer
              if (!line.trim()) {
                return (
                  <div
                    key={idx}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute left-0 right-0 px-4"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <div className="h-2" />
                  </div>
                );
              }

              const visible = isLineVisible ? isLineVisible(line, style) : true;

              // Summary line with status icons
              if (showSummaryLines && style === 'summary') {
                const summary = parseSummaryLine(line);
                if (summary) {
                  const isSuccess = summary.status === 'completed';
                  const isFailed = summary.status === 'failed';
                  return (
                    <div
                      key={idx}
                      ref={virtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="absolute left-0 right-0 px-4"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <div className={`border-t border-primary/15 pt-2 mt-2 transition-opacity ${isFiltering && !visible ? 'opacity-20' : ''}`}>
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
                    </div>
                  );
                }
              }

              // Standard line
              return (
                <div
                  key={idx}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 right-0 px-4"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className={`text-sm leading-5 whitespace-pre-wrap break-words py-[1px] ${TERMINAL_STYLE_MAP[style]} transition-opacity ${isFiltering && !visible ? 'opacity-20' : ''}`}>
                    {line}
                  </div>
                </div>
              );
            })}
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
