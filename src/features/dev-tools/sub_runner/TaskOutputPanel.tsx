import { useRef, useEffect } from 'react';

interface TaskOutputPanelProps {
  taskId: string;
  lines: string[];
  isRunning: boolean;
}

export function TaskOutputPanel({ taskId: _taskId, lines, isRunning }: TaskOutputPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  if (lines.length === 0 && !isRunning) return null;

  return (
    <div className="mt-2 border border-border/20 rounded-lg overflow-hidden bg-background/80">
      <div className="flex items-center justify-between px-2.5 py-1 bg-secondary/30 border-b border-border/15">
        <span className="text-[10px] font-mono text-muted-foreground/50">{lines.length} lines</span>
        {isRunning && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-400/70">
            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
            streaming
          </span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="max-h-48 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed text-foreground/70 whitespace-pre-wrap"
      >
        {lines.map((line, i) => (
          <div key={i} className="hover:bg-secondary/20">{line}</div>
        ))}
        {isRunning && <span className="inline-block w-1.5 h-3 bg-primary/60 animate-pulse" />}
      </div>
    </div>
  );
}
