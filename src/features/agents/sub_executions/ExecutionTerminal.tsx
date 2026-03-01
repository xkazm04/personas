import type { ReactNode } from 'react';
import { TerminalHeader } from '@/features/shared/components/TerminalHeader';
import { TerminalSearchBar, useTerminalFilter } from '@/features/shared/components/TerminalSearchBar';
import { TerminalBody } from '@/features/shared/components/TerminalBody';
import type { TerminalEmptyState } from '@/features/shared/components/TerminalBody';
import { useCopyToClipboard } from '@/hooks/utility/useCopyToClipboard';

interface ExecutionTerminalProps {
  lines: string[];
  isRunning: boolean;
  onStop?: () => void;
  /** Optional label shown in the header (e.g. exec ID). */
  label?: string;
  /** Whether the terminal is in fullscreen mode (fixed inset-0). */
  isFullscreen?: boolean;
  /** Callback to toggle fullscreen mode. */
  onToggleFullscreen?: () => void;
  /** Pixel max-height for the scrollable body (resizable mode). */
  terminalHeight?: number;
  /** Mouse-down handler for the drag-to-resize handle. */
  onResizeStart?: (e: React.MouseEvent) => void;
  /** Rendered between the search bar and terminal body (e.g. phase strip). */
  children?: ReactNode;
  /** Context-aware empty state for the terminal body. */
  emptyState?: TerminalEmptyState;
}

export function ExecutionTerminal({
  lines,
  isRunning,
  onStop,
  label,
  isFullscreen = false,
  onToggleFullscreen,
  terminalHeight,
  onResizeStart,
  children,
  emptyState,
}: ExecutionTerminalProps) {
  const { copied, copy: copyToClipboard } = useCopyToClipboard();
  const { filter, setFilter, isLineVisible, isFiltering } = useTerminalFilter();

  const handleCopyLog = () => copyToClipboard(lines.join('\n'));

  return (
    <div className={
      isFullscreen
        ? 'fixed inset-0 z-50 flex flex-col bg-background'
        : 'border border-border/30 rounded-2xl overflow-hidden bg-background shadow-[0_0_30px_rgba(0,0,0,0.3)]'
    }>
      <TerminalHeader
        isRunning={isRunning}
        lineCount={lines.length}
        onCopy={handleCopyLog}
        copied={copied}
        onStop={onStop}
        label={label}
        onToggleFullscreen={onToggleFullscreen}
        isFullscreen={isFullscreen}
      />

      <TerminalSearchBar filter={filter} onChange={setFilter} />

      {/* Slot: phase strip or other between-header-and-body content */}
      {children}

      <TerminalBody
        lines={lines}
        isRunning={isRunning}
        isLineVisible={isLineVisible}
        isFiltering={isFiltering}
        showSummaryLines
        showCursor
        enableUnseenCounter
        flexFill={isFullscreen}
        maxHeightPx={!isFullscreen ? terminalHeight : undefined}
        emptyState={emptyState}
      />

      {/* Drag-to-resize handle */}
      {!isFullscreen && onResizeStart && (
        <div
          onMouseDown={onResizeStart}
          className="h-2 cursor-row-resize bg-transparent hover:bg-primary/15 transition-colors group flex items-center justify-center"
        >
          <div className="w-8 h-0.5 rounded-full bg-muted-foreground/15 group-hover:bg-primary/40 transition-colors" />
        </div>
      )}
    </div>
  );
}
