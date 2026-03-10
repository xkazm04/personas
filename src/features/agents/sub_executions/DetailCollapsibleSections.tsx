import { useState, useCallback, useEffect } from 'react';
import type { DbPersonaExecution } from '@/lib/types/types';
import { ChevronDown, ChevronRight, FileText, Loader2, Brain } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MEMORY_CATEGORY_COLORS } from '@/lib/utils/formatters';
import { getExecutionLog } from '@/api/agents/executions';
import { listMemoriesByExecution } from '@/api/overview/memories';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';
import { isTerminalState } from '@/lib/execution/executionState';
import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import { maskSensitiveJson } from '@/lib/utils/sanitizers/maskSensitive';
import { HighlightedJsonBlock } from './comparison/HighlightedJsonBlock';
import { hasNonEmptyJson } from './executionDetailHelpers';

interface DetailCollapsibleSectionsProps {
  execution: DbPersonaExecution;
  showRaw: boolean;
}

export function DetailCollapsibleSections({ execution, showRaw }: DetailCollapsibleSectionsProps) {
  const [showInputData, setShowInputData] = useState(false);
  const [showOutputData, setShowOutputData] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const [executionMemories, setExecutionMemories] = useState<PersonaMemory[]>([]);
  const [showMemories, setShowMemories] = useState(false);
  const [memoriesLoaded, setMemoriesLoaded] = useState(false);

  useEffect(() => {
    if (isTerminalState(execution.status) && execution.status !== 'cancelled') {
      listMemoriesByExecution(execution.id)
        .then((memories) => {
          setExecutionMemories(memories);
          setMemoriesLoaded(true);
        })
        .catch(() => setMemoriesLoaded(true));
    }
  }, [execution.id, execution.status]);

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
      const content = await getExecutionLog(execution.id, execution.persona_id);
      setLogContent(content ?? 'Log file is empty or was not found.');
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Failed to load log');
    } finally {
      setLogLoading(false);
    }
  }, [showLog, logContent, execution.id]);

  const hasInputData = hasNonEmptyJson(execution.input_data, 'object');
  const hasOutputData = hasNonEmptyJson(execution.output_data, 'object');

  return (
    <>
      {/* Input Data */}
      {hasInputData && (
        <div>
          <button
            onClick={() => setShowInputData(!showInputData)}
            className="flex items-center gap-2 text-sm text-foreground/90 hover:text-foreground transition-colors mb-2"
          >
            {showInputData ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Input Data
          </button>
          <AnimatePresence>
            {showInputData && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <HighlightedJsonBlock raw={showRaw ? execution.input_data : maskSensitiveJson(execution.input_data) as string | null} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Output Data */}
      {hasOutputData && (
        <div>
          <button
            onClick={() => setShowOutputData(!showOutputData)}
            className="flex items-center gap-2 text-sm text-foreground/90 hover:text-foreground transition-colors mb-2"
          >
            {showOutputData ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Output Data
          </button>
          <AnimatePresence>
            {showOutputData && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <HighlightedJsonBlock raw={showRaw ? execution.output_data : maskSensitiveJson(execution.output_data) as string | null} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Memories Created */}
      {memoriesLoaded && executionMemories.length > 0 && (
        <div>
          <button
            onClick={() => setShowMemories(!showMemories)}
            className="flex items-center gap-2 text-sm text-foreground/90 hover:text-foreground transition-colors mb-2"
          >
            {showMemories ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <Brain className="w-4 h-4 text-violet-400" />
            Memories Created ({executionMemories.length})
          </button>
          <AnimatePresence>
            {showMemories && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-1.5">
                {executionMemories.map((mem) => {
                  const defaultCat = { label: 'Fact', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' };
                  const cat = MEMORY_CATEGORY_COLORS[mem.category] ?? defaultCat;
                  return (
                    <div key={mem.id} className="p-3 bg-violet-500/5 border border-violet-500/15 rounded-xl">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex px-1.5 py-0.5 text-sm font-mono uppercase rounded border ${cat.bg} ${cat.text} ${cat.border}`}>
                          {cat.label}
                        </span>
                        <span className="text-sm font-medium text-foreground/90">{stripHtml(mem.title)}</span>
                      </div>
                      <p className="text-sm text-foreground/70 line-clamp-2">{stripHtml(mem.content)}</p>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Log File */}
      {execution.log_file_path && (
        <div>
          <button
            onClick={handleToggleLog}
            className="flex items-center gap-2 text-sm text-foreground/90 hover:text-foreground transition-colors mb-2"
          >
            {showLog ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <FileText className="w-4 h-4" />
            Execution Log
          </button>
          <AnimatePresence>
            {showLog && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                {logLoading && (
                  <div className="flex items-center gap-2 p-4 bg-background/50 border border-border/30 rounded-xl text-sm text-muted-foreground/80">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading log...
                  </div>
                )}
                {logError && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300/80 font-mono">
                    {logError}
                  </div>
                )}
                {logContent !== null && !logLoading && (
                  <div className="p-4 bg-background/50 border border-border/30 rounded-xl text-sm overflow-x-auto font-mono max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
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
      )}
    </>
  );
}
