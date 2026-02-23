import { useState, useCallback, useEffect, useMemo } from 'react';
import type { DbPersonaExecution } from '@/lib/types/types';
import { ChevronDown, ChevronRight, Clock, Calendar, FileText, AlertCircle, Search, ListTree, Lightbulb, RotateCw, RefreshCw, Key, Zap, Settings, ArrowRight, Shield, Loader2, Brain } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatTimestamp, formatDuration, EXECUTION_STATUS_COLORS, badgeClass, MEMORY_CATEGORY_COLORS } from '@/lib/utils/formatters';
import { ExecutionInspector } from '@/features/agents/sub_executions/ExecutionInspector';
import { usePersonaStore } from '@/stores/personaStore';
import { getExecutionLog } from '@/api/executions';
import { listMemoriesByExecution } from '@/api/memories';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import type { LucideIcon } from 'lucide-react';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';
import hljs from 'highlight.js/lib/core';
import jsonLang from 'highlight.js/lib/languages/json';

hljs.registerLanguage('json', jsonLang);

/** Check whether a raw JSON string parses into a non-empty array or object. */
function hasNonEmptyJson(raw: string | null | undefined, type: 'array' | 'object'): boolean {
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (type === 'array') {
      return Array.isArray(parsed) && parsed.length > 0;
    }
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed as Record<string, unknown>).length > 0;
  } catch {
    return type === 'object' ? !!raw : false;
  }
}

interface ErrorAction {
  label: string;
  icon: LucideIcon;
  /** Navigation target: which sidebar section + optional sub-navigation */
  navigate: 'vault' | 'triggers' | 'persona-settings';
}

const ERROR_PATTERNS: Array<{ pattern: RegExp; summary: string; guidance: string; action?: ErrorAction }> = [
  { pattern: /api key/i, summary: 'API key issue detected.', guidance: 'Check that your API key is valid and hasn\'t expired.', action: { label: 'Go to Vault', icon: Key, navigate: 'vault' } },
  { pattern: /invalid.*key|invalid_api_key|authentication|unauthorized|401/i, summary: 'Authentication failed.', guidance: 'Your API key may be invalid or expired.', action: { label: 'Go to Vault', icon: Key, navigate: 'vault' } },
  { pattern: /rate.?limit|429|too many requests/i, summary: 'Rate limit reached.', guidance: 'The API rate limit was hit. Try reducing the trigger frequency.', action: { label: 'Edit Triggers', icon: Zap, navigate: 'triggers' } },
  { pattern: /timeout|timed?\s*out|ETIMEDOUT|ESOCKETTIMEDOUT/i, summary: 'The operation timed out.', guidance: 'The request took too long. Adjust the timeout in persona settings.', action: { label: 'Persona Settings', icon: Settings, navigate: 'persona-settings' } },
  { pattern: /ECONNREFUSED|ECONNRESET|ENOTFOUND|network|DNS/i, summary: 'Network connection failed.', guidance: 'Could not reach the server. Check your internet connection and that the target service is available.' },
  { pattern: /permission.?denied|forbidden|403/i, summary: 'Permission denied.', guidance: 'The tool or API denied access. Verify your credentials have the necessary permissions.', action: { label: 'Check Credentials', icon: Shield, navigate: 'vault' } },
  { pattern: /quota|billing|payment|insufficient.?funds|402/i, summary: 'Account quota or billing issue.', guidance: 'Your API account may have reached its spending limit. Check your account billing status.' },
  { pattern: /spawn\s+ENOENT|command not found|not recognized/i, summary: 'Required command not found.', guidance: 'A system command needed for this execution is not installed. Check that all required CLI tools are available on your system.' },
  { pattern: /exit\s+code\s+1|exited?\s+with\s+1/i, summary: 'The process exited with an error.', guidance: 'The underlying process reported a failure. Check the execution log for more details.' },
  { pattern: /ENOMEM|out of memory/i, summary: 'Out of memory.', guidance: 'The system ran out of memory. Try closing other applications or reducing the task complexity.' },
  { pattern: /500|internal.?server.?error/i, summary: 'The remote server encountered an error.', guidance: 'The API returned a server error. This is usually temporary — try again in a few minutes.' },
  { pattern: /JSON|parse|unexpected token/i, summary: 'Failed to parse response data.', guidance: 'The response was not in the expected format. This may indicate an API change or malformed data.' },
  { pattern: /credential|secret|token/i, summary: 'Credential issue.', guidance: 'A required credential may be missing or invalid.', action: { label: 'Go to Vault', icon: Key, navigate: 'vault' } },
];

function getErrorExplanation(errorMessage: string): { summary: string; guidance: string; action?: ErrorAction } | null {
  for (const { pattern, summary, guidance, action } of ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return { summary, guidance, action };
    }
  }
  return null;
}

function HighlightedJsonBlock({ raw }: { raw: string | null }) {
  const html = useMemo(() => {
    if (!raw) return null;
    try {
      const pretty = JSON.stringify(JSON.parse(raw), null, 2);
      return hljs.highlight(pretty, { language: 'json' }).value;
    } catch {
      return null;
    }
  }, [raw]);

  if (!html) {
    return (
      <pre className="p-4 bg-background/50 border border-border/30 rounded-xl text-sm text-foreground/90 overflow-x-auto font-mono">
        {raw ?? ''}
      </pre>
    );
  }

  return (
    <pre
      className="json-highlight p-4 bg-background/50 border border-border/30 rounded-xl text-sm overflow-x-auto font-mono"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

interface ExecutionDetailProps {
  execution: DbPersonaExecution;
}

export function ExecutionDetail({ execution }: ExecutionDetailProps) {
  const setRerunInputData = usePersonaStore((s) => s.setRerunInputData);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const [activeTab, setActiveTab] = useState<'detail' | 'inspector'>('detail');

  const handleErrorAction = useCallback((action: ErrorAction) => {
    switch (action.navigate) {
      case 'vault':
        setSidebarSection('credentials');
        break;
      case 'triggers':
        setSidebarSection('events');
        break;
      case 'persona-settings':
        if (execution.persona_id) {
          selectPersona(execution.persona_id);
          setEditorTab('settings');
        }
        break;
    }
  }, [execution.persona_id, setSidebarSection, setEditorTab, selectPersona]);
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
    // Fetch memories created by this execution (only for completed/finished)
    if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'incomplete') {
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
    if (logContent !== null) return; // already fetched
    setLogLoading(true);
    setLogError(null);
    try {
      const content = await getExecutionLog(execution.id);
      setLogContent(content ?? 'Log file is empty or was not found.');
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Failed to load log');
    } finally {
      setLogLoading(false);
    }
  }, [showLog, logContent, execution.id]);

  const hasToolSteps = hasNonEmptyJson(execution.tool_steps, 'array');
  const hasInputData = hasNonEmptyJson(execution.input_data, 'object');
  const hasOutputData = hasNonEmptyJson(execution.output_data, 'object');

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      {hasToolSteps && (
        <div className="flex gap-1 p-1 rounded-xl bg-secondary/40 border border-primary/10 w-fit">
          <button
            onClick={() => setActiveTab('detail')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'detail'
                ? 'bg-primary/15 text-foreground/90 border border-primary/25'
                : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'
            }`}
          >
            <ListTree className="w-3.5 h-3.5" />
            Detail
          </button>
          <button
            onClick={() => setActiveTab('inspector')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'inspector'
                ? 'bg-primary/15 text-foreground/90 border border-primary/25'
                : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            Inspector
          </button>
        </div>
      )}

      {/* Inspector Tab */}
      {activeTab === 'inspector' && hasToolSteps ? (
        <ExecutionInspector execution={execution} />
      ) : (
        <>
          {/* Status Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider">Status</div>
              <div className="flex items-center gap-2">
                <span className={`inline-block px-2 py-0.5 rounded-md text-sm font-medium ${EXECUTION_STATUS_COLORS[execution.status] ? badgeClass(EXECUTION_STATUS_COLORS[execution.status]!) : ''}`}>
                  {execution.status}
                </span>
                {execution.retry_count > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title={`Healing retry #${execution.retry_count} of original execution`}>
                    <RefreshCw className="w-2.5 h-2.5" />
                    Retry #{execution.retry_count}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Duration
              </div>
              <div className="text-sm text-foreground font-mono">
                {formatDuration(execution.duration_ms)}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Started
              </div>
              <div className="text-sm text-foreground">
                {formatTimestamp(execution.started_at)}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Completed
              </div>
              <div className="text-sm text-foreground">
                {formatTimestamp(execution.completed_at)}
              </div>
            </div>
          </div>

          {/* Error Message */}
          {execution.error_message && (() => {
            const explanation = getErrorExplanation(execution.error_message);
            return (
              <div className="space-y-2">
                {explanation && (
                  <div className="p-3.5 bg-amber-500/8 border border-amber-500/15 rounded-xl">
                    <div className="flex items-start gap-2.5">
                      <Lightbulb className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-amber-300/90">{explanation.summary}</p>
                        <p className="text-sm text-amber-300/60 mt-1">{explanation.guidance}</p>
                        {explanation.action && (() => {
                          const ActionIcon = explanation.action.icon;
                          return (
                            <button
                              onClick={() => handleErrorAction(explanation.action!)}
                              className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 hover:text-amber-200 transition-all group"
                            >
                              <ActionIcon className="w-3.5 h-3.5" />
                              {explanation.action.label}
                              <ArrowRight className="w-3 h-3 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono font-medium text-red-400 mb-1.5 uppercase tracking-wider">Error</div>
                      <pre className="text-sm text-red-300/80 whitespace-pre-wrap break-words font-mono">
                        {execution.error_message}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Re-run Button */}
          {(execution.status === 'completed' || execution.status === 'failed' || execution.status === 'error' || execution.status === 'cancelled' || execution.status === 'incomplete') && (
            <button
              onClick={() => setRerunInputData(execution.input_data || '{}')}
              className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl bg-primary/10 text-primary/80 border border-primary/15 hover:bg-primary/20 hover:text-primary transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
              {execution.status === 'cancelled' ? 'Re-run execution' : 'Re-run with same input'}
            </button>
          )}

          {/* Input Data */}
          {hasInputData && (
            <div>
              <button
                onClick={() => setShowInputData(!showInputData)}
                className="flex items-center gap-2 text-sm text-foreground/90 hover:text-foreground transition-colors mb-2"
              >
                {showInputData ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                Input Data
              </button>

              <AnimatePresence>
                {showInputData && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <HighlightedJsonBlock raw={execution.input_data} />
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
                {showOutputData ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                Output Data
              </button>

              <AnimatePresence>
                {showOutputData && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <HighlightedJsonBlock raw={execution.output_data} />
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
                {showMemories ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <Brain className="w-4 h-4 text-violet-400" />
                Memories Created ({executionMemories.length})
              </button>

              <AnimatePresence>
                {showMemories && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-1.5"
                  >
                    {executionMemories.map((mem) => {
                      const defaultCat = { label: 'Fact', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' };
                      const cat = MEMORY_CATEGORY_COLORS[mem.category] ?? defaultCat;
                      return (
                        <div
                          key={mem.id}
                          className="p-3 bg-violet-500/5 border border-violet-500/15 rounded-xl"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`inline-flex px-1.5 py-0.5 text-sm font-mono uppercase rounded border ${cat.bg} ${cat.text} ${cat.border}`}>
                              {cat.label}
                            </span>
                            <span className="text-sm font-medium text-foreground/90">{mem.title}</span>
                          </div>
                          <p className="text-sm text-foreground/70 line-clamp-2">{mem.content}</p>
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
                {showLog ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <FileText className="w-4 h-4" />
                Execution Log
              </button>

              <AnimatePresence>
                {showLog && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
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
      )}
    </div>
  );
}
