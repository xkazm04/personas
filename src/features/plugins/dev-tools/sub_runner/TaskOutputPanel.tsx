import { useRef, useEffect, useState } from 'react';
import { Code2, FileText } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';

interface TaskOutputPanelProps {
  taskId: string;
  lines: string[];
  isRunning: boolean;
}

export function TaskOutputPanel({ taskId: _taskId, lines, isRunning }: TaskOutputPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'raw' | 'rendered'>('raw');

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  if (lines.length === 0 && !isRunning) return null;

  const fullText = lines.join('\n');

  return (
    <div className="mt-2 border border-border/20 rounded-lg overflow-hidden bg-background/80">
      <div className="flex items-center justify-between px-2.5 py-1 bg-secondary/30 border-b border-border/15">
        <span className="text-[10px] font-mono text-foreground">{lines.length} lines</span>
        <div className="flex items-center gap-1.5">
          {isRunning && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400/70">
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
              streaming
            </span>
          )}
          <button
            onClick={() => setViewMode(viewMode === 'raw' ? 'rendered' : 'raw')}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
            title={viewMode === 'raw' ? 'Switch to rendered markdown' : 'Switch to raw log'}
          >
            {viewMode === 'raw' ? (
              <FileText className="w-3 h-3" />
            ) : (
              <Code2 className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      {viewMode === 'raw' ? (
        <div
          ref={scrollRef}
          className="max-h-48 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap"
        >
          {lines.map((line, i) => (
            <div key={i} className="hover:bg-secondary/20">{line}</div>
          ))}
          {isRunning && <span className="inline-block w-1.5 h-3 bg-primary/60 animate-pulse" />}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="max-h-48 overflow-y-auto p-3 text-md"
        >
          <MarkdownRenderer content={fullText} />
          {isRunning && <span className="inline-block w-1.5 h-3 bg-primary/60 animate-pulse ml-1" />}
        </div>
      )}
    </div>
  );
}
