import { useState } from 'react';
import type { DbPersonaExecution } from '@/lib/types/types';
import { ChevronDown, ChevronRight, Clock, Calendar, FileText, AlertCircle, Search, ListTree } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatTimestamp, formatDuration, EXECUTION_STATUS_COLORS, badgeClass } from '@/lib/utils/formatters';
import { ExecutionInspector } from '@/features/agents/sub_executions/ExecutionInspector';

interface ExecutionDetailProps {
  execution: DbPersonaExecution;
}

export function ExecutionDetail({ execution }: ExecutionDetailProps) {
  const [activeTab, setActiveTab] = useState<'detail' | 'inspector'>('detail');
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
              <div>
                <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-medium ${EXECUTION_STATUS_COLORS[execution.status] ? badgeClass(EXECUTION_STATUS_COLORS[execution.status]!) : ''}`}>
                  {execution.status}
                </span>
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
          {execution.error_message && (
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
