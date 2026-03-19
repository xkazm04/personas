import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, FileText, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
      <button
        onClick={handleToggleLog}
        className="flex items-center gap-2 typo-body text-foreground/90 hover:text-foreground transition-colors mb-2"
      >
        {showLog ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <FileText className="w-4 h-4" />
        Execution Log
      </button>
      <AnimatePresence>
        {showLog && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {logLoading && (
              <div className="flex items-center gap-2 p-4 bg-background/50 border border-border/30 rounded-xl typo-body text-muted-foreground/80">
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
