import { useState, useCallback } from 'react';
import type { DbPersonaExecution } from '@/lib/types/types';
import { ChevronDown, ChevronRight, Clock, Calendar, FileText, AlertCircle, Search, ListTree, Lightbulb, RotateCw, RefreshCw, Key, Zap, Settings, ArrowRight, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatTimestamp, formatDuration, EXECUTION_STATUS_COLORS, badgeClass } from '@/lib/utils/formatters';
import { ExecutionInspector } from '@/features/agents/sub_executions/ExecutionInspector';
import { usePersonaStore } from '@/stores/personaStore';
import type { LucideIcon } from 'lucide-react';

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

  const hasToolSteps = (() => {
    if (!execution.tool_steps) return false;
    try {
      const parsed = JSON.parse(execution.tool_steps);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  })();

  const formatJson = (data: string | null) => {
    if (!data) return '';
    try {
      const parsed = JSON.parse(data);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return data;
    }
  };

  const hasInputData = (() => {
    if (!execution.input_data) return false;
    try {
      const parsed = JSON.parse(execution.input_data);
      return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
    } catch {
      return !!execution.input_data;
    }
  })();

  const hasOutputData = (() => {
    if (!execution.output_data) return false;
    try {
      const parsed = JSON.parse(execution.output_data);
      return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
    } catch {
      return !!execution.output_data;
    }
  })();

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
                : 'text-muted-foreground/50 hover:text-foreground/70 border border-transparent'
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
                : 'text-muted-foreground/50 hover:text-foreground/70 border border-transparent'
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
              <div className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-wider">Status</div>
              <div className="flex items-center gap-2">
                <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-medium ${EXECUTION_STATUS_COLORS[execution.status] ? badgeClass(EXECUTION_STATUS_COLORS[execution.status]!) : ''}`}>
                  {execution.status}
                </span>
                {execution.retry_count > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title={`Healing retry #${execution.retry_count} of original execution`}>
                    <RefreshCw className="w-2.5 h-2.5" />
                    Retry #{execution.retry_count}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-wider flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Duration
              </div>
              <div className="text-sm text-foreground font-mono">
                {formatDuration(execution.duration_ms)}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-wider flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Started
              </div>
              <div className="text-sm text-foreground">
                {formatTimestamp(execution.started_at)}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-wider flex items-center gap-1">
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
                        <p className="text-xs text-amber-300/60 mt-1">{explanation.guidance}</p>
                        {explanation.action && (() => {
                          const ActionIcon = explanation.action.icon;
                          return (
                            <button
                              onClick={() => handleErrorAction(explanation.action!)}
                              className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 hover:text-amber-200 transition-all group"
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
                      <div className="text-[11px] font-mono font-medium text-red-400 mb-1.5 uppercase tracking-wider">Error</div>
                      <pre className="text-xs text-red-300/80 whitespace-pre-wrap break-words font-mono">
                        {execution.error_message}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Re-run Button */}
          {(execution.status === 'completed' || execution.status === 'failed' || execution.status === 'error' || execution.status === 'cancelled') && (
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
                className="flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground transition-colors mb-2"
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
                    <pre className="p-4 bg-background/50 border border-border/30 rounded-xl text-xs text-foreground/70 overflow-x-auto font-mono">
                      {formatJson(execution.input_data)}
                    </pre>
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
                className="flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground transition-colors mb-2"
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
                    <pre className="p-4 bg-background/50 border border-border/30 rounded-xl text-xs text-foreground/70 overflow-x-auto font-mono">
                      {formatJson(execution.output_data)}
                    </pre>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Log File */}
          {execution.log_file_path && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/40">
              <FileText className="w-4 h-4" />
              <span className="font-mono">{execution.log_file_path}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
