import { useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from '@/i18n/useTranslation';

// -- Shared line classification --

type LineStyle = 'error' | 'system' | 'success' | 'marker' | 'default';

const LINE_STYLES: Record<LineStyle, { text: string; dot: string }> = {
  error:   { text: 'text-red-400/80',     dot: 'bg-red-400' },
  system:  { text: 'text-amber-400/70',   dot: 'bg-amber-400' },
  success: { text: 'text-emerald-400/80', dot: 'bg-emerald-400' },
  marker:  { text: 'text-cyan-300/80',    dot: 'bg-cyan-400' },
  default: { text: 'text-blue-400/80',    dot: 'bg-blue-400/40' },
};

function classifyLine(line: string): LineStyle {
  const lower = line.toLowerCase();
  if (lower.includes('transform_questions') || lower.includes('transform_persona') || lower.includes('[milestone]')) return 'marker';
  if (lower.includes('error') || lower.includes('failed') || lower.includes('failure') || lower.includes('[warn]')) return 'error';
  if (lower.includes('[system]') || lower.includes('starting') || lower.includes('initializing')) return 'system';
  if (lower.includes('complete') || lower.includes('success') || lower.includes('finished') || lower.includes('done') || lower.includes('\u2713')) return 'success';
  return 'default';
}

interface TerminalBodyProps {
  lines: string[];
}

export function useTerminalScroll(lines: string[]) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    if (terminalRef.current && shouldAutoScroll.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  const handleTerminalScroll = () => {
    if (terminalRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      shouldAutoScroll.current = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
    }
  };

  return { terminalRef, handleTerminalScroll };
}

const ESTIMATED_ROW_HEIGHT = 22;
const OVERSCAN = 12;

export function TerminalBody({ lines }: TerminalBodyProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  useEffect(() => {
    if (shouldAutoScroll.current && lines.length > 0) {
      virtualizer.scrollToIndex(lines.length - 1, { align: 'end' });
    }
  }, [lines.length, virtualizer]);

  const handleScroll = useCallback(() => {
    if (parentRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
      shouldAutoScroll.current = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
    }
  }, []);

  if (lines.length === 0) {
    return <div className="p-4 text-foreground text-center typo-body">{t.shared.progress_extra.no_output}</div>;
  }

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className="max-h-[200px] overflow-y-auto typo-code bg-background"
    >
      <div className="relative w-full p-3" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const line = lines[row.index] ?? '';
          const style = classifyLine(line);
          const colors = LINE_STYLES[style];
          return (
            <div
              key={row.index}
              ref={virtualizer.measureElement}
              data-index={row.index}
              className="absolute left-3 right-3 flex items-start gap-2 py-px"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <span className="text-foreground/90 select-none flex-shrink-0 w-8 text-right">
                {(row.index + 1).toString().padStart(3, ' ')}
              </span>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[5px] ${colors.dot}`} />
              <span className={`${colors.text} break-all`}>{line}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
