import { useState, useCallback, useEffect } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import { ChevronDown, ChevronRight, FileText, Loader2, Brain } from 'lucide-react';
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
  execution: PersonaExecution;
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
            className="flex items-center gap-2 typo-body text-foreground/90 hover:text-foreground transition-colors mb-2"
          >
            {showInputData ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Input Data
          </button>
          {showInputData && (
              <div className="animate-fade-slide-in">
                <HighlightedJsonBlock raw={showRaw ? execution.input_data : maskSensitiveJson(execution.input_data) as string | null} />
              </div>
            )}
        </div>
      )}

      {/* Output Data */}
      {hasOutputData && (
        <div>
          <button
            onClick={() => setShowOutputData(!showOutputData)}
            className="flex items-center gap-2 typo-body text-foreground/90 hover:text-foreground transition-colors mb-2"
          >
            {showOutputData ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Output Data
          </button>
          {showOutputData && (
              <div className="animate-fade-slide-in">
                <HighlightedJsonBlock raw={showRaw ? execution.output_data : maskSensitiveJson(execution.output_data) as string | null} />
              </div>
            )}
        </div>
      )}

      {/* Memories Created */}
      {memoriesLoaded && executionMemories.length > 0 && (
        <div>
          <button
            onClick={() => setShowMemories(!showMemories)}
            className="flex items-center gap-2 typo-body text-foreground/90 hover:text-foreground transition-colors mb-2"
          >
            {showMemories ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <Brain className="w-4 h-4 text-violet-400" />
            Memories Created ({executionMemories.length})
          </button>
          {showMemories && (
              <div className="animate-fade-slide-in space-y-1.5">
                {executionMemories.map((mem) => {
                  const defaultCat = { label: 'Fact', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' };
                  const cat = MEMORY_CATEGORY_COLORS[mem.category] ?? defaultCat;
                  return (
                    <div key={mem.id} className="p-3 bg-violet-500/5 border border-violet-500/15 rounded-xl">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex px-1.5 py-0.5 typo-code uppercase rounded border ${cat.bg} ${cat.text} ${cat.border}`}>
                          {cat.label}
                        </span>
                        <span className="typo-heading text-foreground/90">{stripHtml(mem.title)}</span>
                      </div>
                      <p className="typo-body text-foreground/70 line-clamp-2">{stripHtml(mem.content)}</p>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      )}

      {/* Log File */}
      {execution.log_file_path && (
        <div>
          <button
            onClick={handleToggleLog}
            className="flex items-center gap-2 typo-body text-foreground/90 hover:text-foreground transition-colors mb-2"
          >
            {showLog ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <FileText className="w-4 h-4" />
            Execution Log
          </button>
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
      )}
    </>
  );
}
