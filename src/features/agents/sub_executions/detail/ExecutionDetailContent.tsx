import { useState } from 'react';
import type { DbPersonaExecution } from '@/lib/types/types';
import { ChevronDown, ChevronRight, Clock, Calendar, Shield, RotateCw, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatTimestamp, formatDuration, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { usePersonaStore } from '@/stores/personaStore';
import { isTerminalState } from '@/lib/execution/executionState';
import { maskSensitiveJson } from '@/lib/utils/sanitizers/maskSensitive';
import { HighlightedJsonBlock } from './HighlightedJsonBlock';
import { ErrorExplanationCard } from './ErrorExplanationCard';
import { ExecutionMemories } from './ExecutionMemories';
import { ExecutionLogViewer } from './ExecutionLogViewer';

interface ExecutionDetailContentProps {
  execution: DbPersonaExecution;
  hasInputData: boolean;
  hasOutputData: boolean;
}

export function ExecutionDetailContent({ execution, hasInputData, hasOutputData }: ExecutionDetailContentProps) {
  const setRerunInputData = usePersonaStore((s) => s.setRerunInputData);

  const [showRaw, setShowRaw] = useState(false);
  const [showInputData, setShowInputData] = useState(false);
  const [showOutputData, setShowOutputData] = useState(false);

  return (
    <>
      {/* Status Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="space-y-1.5">
          <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider">Status</div>
          <div className="flex items-center gap-2">
            <span className={`inline-block px-2 py-0.5 rounded-lg text-sm font-medium ${badgeClass(getStatusEntry(execution.status))}`}>
              {getStatusEntry(execution.status).label}
            </span>
            {execution.retry_count > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title={`Healing retry #${execution.retry_count} of original execution`}>
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

      {/* Masked / Raw toggle */}
      {(execution.error_message || hasInputData || hasOutputData) && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowRaw(!showRaw)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-xl border transition-colors ${
              showRaw
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                : 'bg-secondary/30 text-muted-foreground/60 border-primary/10 hover:text-muted-foreground/80'
            }`}
            title={showRaw ? 'Sensitive values are visible' : 'Sensitive values are masked'}
          >
            <Shield className="w-3 h-3" />
            {showRaw ? 'Raw' : 'Masked'}
          </button>
        </div>
      )}

      {/* Error Message */}
      {execution.error_message && (
        <ErrorExplanationCard
          errorMessage={execution.error_message}
          showRaw={showRaw}
          personaId={execution.persona_id}
        />
      )}

      {/* Re-run Button */}
      {isTerminalState(execution.status) && (
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
      <ExecutionMemories executionId={execution.id} executionStatus={execution.status} />

      {/* Log File */}
      {execution.log_file_path && (
        <ExecutionLogViewer executionId={execution.id} personaId={execution.persona_id} />
      )}
    </>
  );
}
