import { useRef, useEffect, useState } from 'react';
import { Code2, FileText } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { RichMarkdown } from '@/features/shared/components/editors/RichMarkdown';
import { useTranslation } from '@/i18n/useTranslation';

interface TaskOutputPanelProps {
  taskId: string;
  lines: string[];
  isRunning: boolean;
}

export function TaskOutputPanel({ taskId: _taskId, lines, isRunning }: TaskOutputPanelProps) {
  const { t, tx } = useTranslation();
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
    <div className="mt-2 border border-border/20 rounded-card overflow-hidden bg-background/80">
      <div className="flex items-center justify-between px-2.5 py-1 bg-surface-1 border-b border-border/15">
        <span className="typo-caption text-foreground">{tx(lines.length === 1 ? t.plugins.dev_runner.output_lines_one : t.plugins.dev_runner.output_lines_other, { count: lines.length })}</span>
        <div className="flex items-center gap-1.5">
          {isRunning && (
            <span className="flex items-center gap-1 typo-caption text-status-success">
              <span className="w-1 h-1 rounded-full bg-status-success animate-pulse" />
              {t.plugins.dev_runner.output_streaming}
            </span>
          )}
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'raw' ? 'rendered' : 'raw')}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded typo-caption text-foreground hover:text-foreground hover:bg-surface-1 transition-colors"
            title={viewMode === 'raw' ? t.plugins.dev_runner.output_show_rendered : t.plugins.dev_runner.output_show_raw}
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
          className="max-h-48 overflow-y-auto p-2 typo-caption text-foreground whitespace-pre-wrap"
        >
          {lines.map((line, i) => (
            <div key={i} className="hover:bg-surface-1">{line}</div>
          ))}
          {isRunning && <span className="inline-block w-1.5 h-3 bg-primary/60 animate-pulse" />}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="max-h-48 overflow-y-auto p-3 typo-body"
        >
          {/* Plain while it streams: a block tag is only readable once its
              closing fence has arrived, and a half-written `:::stats` would
              flash "could not be shown" on every chunk. Rich once finished. */}
          {isRunning ? <MarkdownRenderer content={fullText} /> : <RichMarkdown content={fullText} />}
          {isRunning && <span className="inline-block w-1.5 h-3 bg-primary/60 animate-pulse ml-1" />}
        </div>
      )}
    </div>
  );
}
