import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, FileText, Loader2, Copy, Check } from 'lucide-react';
import { getExecutionLog } from '@/api/agents/executions';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';

interface ExecutionLogViewerProps {
  executionId: string;
  personaId: string | null;
}

export function ExecutionLogViewer({ executionId, personaId }: ExecutionLogViewerProps) {
  const [showLog, setShowLog] = useState(false);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyLog = useCallback(() => {
    if (!logContent) return;
    navigator.clipboard.writeText(logContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* ignore */ });
  }, [logContent]);

  const handleToggleLog = useCallback(async () => {
    if (showLog) {
      setShowLog(false);
      return;
    }
    setShowLog(true);
    if (logContent !== null) return;
    setLogLoading(true);
    setLogError(null);
    try {
      const content = await getExecutionLog(executionId, personaId ?? '');
      setLogContent(content ?? 'Log file is empty or was not found.');
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Failed to load log');
    } finally {
      setLogLoading(false);
    }
  }, [showLog, logContent, executionId]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={handleToggleLog}
          className="flex items-center gap-2 typo-body text-foreground/90 hover:text-foreground transition-colors"
        >
          {showLog ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <FileText className="w-4 h-4" />
          Execution Log
        </button>
        <button
            onClick={async () => {
              if (!logContent) {
                try {
                  const content = await getExecutionLog(executionId, personaId ?? '');
                  setLogContent(content ?? '');
                  if (content) { navigator.clipboard.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {}); }
                } catch { /* ignore */ }
              } else {
                handleCopyLog();
              }
            }}
            className="p-1 rounded-lg hover:bg-secondary/50 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            title="Copy log to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
      </div>
      {showLog && (
          <div>
            {logLoading && (
              <div className="animate-fade-slide-in flex items-center gap-2 p-4 bg-background/50 border border-border/30 rounded-xl typo-body text-muted-foreground/80">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading log...
              </div>
            )}
            {logError && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl typo-code text-red-300/80">
                {logError}
              </div>
            )}
            {logContent !== null && !logLoading && (
              <div className="p-4 bg-background/50 border border-border/30 rounded-xl typo-code overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
                {logContent.split('\n').map((line, i) => {
                  const style = classifyLine(line);
                  const cls = TERMINAL_STYLE_MAP[style];
                  return (
                    <div key={i} className={cls || 'text-foreground/90'}>
                      {line}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
    </div>
  );
}
