import { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';

/** Replay terminal panel — shows log lines up to current scrub position. */
export function ReplayTerminalPanel({
  visibleLines,
  totalLines,
}: {
  visibleLines: Array<{ index: number; text: string; timestamp_ms: number }>;
  totalLines: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
        <Terminal className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="text-sm font-medium text-muted-foreground/70">Output</span>
        <span className="ml-auto text-sm tabular-nums text-muted-foreground/60">
          {visibleLines.length}/{totalLines} lines
        </span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 font-mono text-sm leading-relaxed"
      >
        {visibleLines.map((line) => {
          const style = classifyLine(line.text);
          const cls = TERMINAL_STYLE_MAP[style];
          return (
            <div key={line.index} className={cls || 'text-foreground/90'}>
              {line.text || '\u00A0'}
            </div>
          );
        })}
        {visibleLines.length === 0 && (
          <div className="text-muted-foreground/60 italic">Scrub forward to see output...</div>
        )}
      </div>
    </div>
  );
}
