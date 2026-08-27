import { useState, useCallback, useMemo } from 'react';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import { ChevronDown, ChevronRight, FileText, Loader2, AlertTriangle } from 'lucide-react';
import { CopyButton } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { getExecutionLog } from '@/api/agents/executions';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';
import { silentCatch } from '@/lib/silentCatch';

interface ExecutionLogViewerProps {
  executionId: string;
  personaId: string | null;
  /** When true, the backend flagged this log file as possibly incomplete
   *  (dropped output due to a write error) — surface a warning banner. */
  logTruncated?: boolean;
}

export function ExecutionLogViewer({ executionId, personaId, logTruncated = false }: ExecutionLogViewerProps) {
  const { t } = useTranslation();
  const [showLog, setShowLog] = useState(false);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyLog = useCallback(() => {
    const doCopy = (content: string) => {
      copyText(content).then(() => {
        setCopied(true);
        setLogError(null);
        setTimeout(() => setCopied(false), 2000);
      }).catch((err) => {
        silentCatch('ExecutionLogViewer:copyText')(err);
        setLogError(t.agents.executions.copy_log_failed);
      });
    };
    if (logContent !== null) {
      doCopy(logContent);
    } else {
      getExecutionLog(executionId, personaId ?? '').then((content) => {
        setLogContent(content ?? '');
        doCopy(content ?? '');
      }).catch((err) => {
        silentCatch('ExecutionLogViewer:getExecutionLog')(err);
        setLogError(t.agents.executions.copy_log_failed);
      });
    }
  }, [logContent, executionId, personaId, t.agents.executions.copy_log_failed]);

  // Splitting + classifying the whole log is O(lines) and was re-run on every
  // render -- including the copied-state flip that fires twice per copy.
  const styledLines = useMemo(() => {
    if (logContent === null) return null;
    return logContent.split('\n').map((line) => ({
      line,
      cls: TERMINAL_STYLE_MAP[classifyLine(line)] || 'text-foreground/90',
    }));
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
      // Store the record, never a UI string: the empty-log NOTICE is rendered
      // below from `logContent === ''`. Storing the translated placeholder here
      // put it in state, so Copy handed the investigator "No log output" as if
      // it were the log — and the copy-first path (which stores '') disagreed
      // with this one about the same fact.
      setLogContent(content ?? '');
    } catch (err) {
      setLogError(err instanceof Error ? err.message : t.agents.executions.failed_to_load_log);
    } finally {
      setLogLoading(false);
    }
  }, [showLog, logContent, executionId, personaId, t.agents.executions.failed_to_load_log]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={handleToggleLog}
          aria-expanded={showLog}
          className="flex items-center gap-2 typo-body text-foreground/90 hover:text-foreground transition-colors"
        >
          {showLog ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <FileText className="w-4 h-4" />
          {t.agents.executions.execution_log}
        </button>
        <CopyButton copied={copied} onCopy={handleCopyLog} tooltip={t.agents.executions.copy_log_tooltip} />
      </div>
      {/* Outside the disclosure: a Copy that fails while the log is COLLAPSED
          used to set this message into a branch that was not rendered, so the
          action failed in silence. */}
      {logError && (
        <div className="mb-2 p-4 bg-red-500/10 border border-red-500/20 rounded-modal typo-code text-red-300/80">
          {logError}
        </div>
      )}
      {showLog && (
          <div>
            {logTruncated && (
              <div className="animate-fade-slide-in flex items-center gap-2 mb-2 p-2.5 bg-status-warning/10 border border-status-warning/25 rounded-modal typo-body text-status-warning">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {t.agents.executions.log_truncated_banner}
              </div>
            )}
            {logLoading && (
              <div className="animate-fade-slide-in flex items-center gap-2 p-4 bg-background/50 border border-border/30 rounded-modal typo-body text-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t.agents.executions.loading_log}
              </div>
            )}
            {logContent === '' && !logLoading && !logError && (
              <div className="p-4 bg-background/50 border border-border/30 rounded-modal typo-body text-foreground">
                {t.agents.executions.log_empty}
              </div>
            )}
            {styledLines !== null && logContent !== '' && !logLoading && (
              <div className="p-4 bg-background/50 border border-border/30 rounded-modal typo-code overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
                {styledLines.map((entry, i) => (
                  <div key={i} className={entry.cls}>
                    {entry.line}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
    </div>
  );
}
