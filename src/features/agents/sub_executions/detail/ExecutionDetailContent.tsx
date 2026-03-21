import { useState } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import { ChevronDown, ChevronRight, Clock, Calendar, Shield, RotateCw, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatTimestamp, formatDuration, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { useSystemStore } from "@/stores/systemStore";
import { isTerminalState } from '@/lib/execution/executionState';
import { maskSensitiveJson } from '@/lib/utils/sanitizers/maskSensitive';
import { Button } from '@/features/shared/components/buttons';
import { HighlightedJsonBlock } from './inspector/HighlightedJsonBlock';
import { ErrorExplanationCard } from './ErrorExplanationCard';
import { ExecutionMemories } from './views/ExecutionMemories';
import { ExecutionLogViewer } from './views/ExecutionLogViewer';

interface ExecutionDetailContentProps {
  execution: PersonaExecution;
  hasInputData: boolean;
  hasOutputData: boolean;
}

export function ExecutionDetailContent({ execution, hasInputData, hasOutputData }: ExecutionDetailContentProps) {
  const setRerunInputData = useSystemStore((s) => s.setRerunInputData);

  const [showRaw, setShowRaw] = useState(false);
  const [showInputData, setShowInputData] = useState(false);
  const [showOutputData, setShowOutputData] = useState(false);

  return (
    <div className="space-y-4 divide-y divide-primary/10 [&>*]:pt-4 [&>*:first-child]:pt-0">
      {/* Status Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl border border-primary/10 overflow-hidden bg-primary/5">
        <div className="space-y-1.5 p-3 bg-background">
          <div className="typo-code text-muted-foreground/80 uppercase tracking-wider">Status</div>
          <div className="flex items-center gap-2">
            <span className={`inline-block px-2 py-0.5 rounded-lg typo-heading ${badgeClass(getStatusEntry(execution.status))}`}>
              {getStatusEntry(execution.status).label}
            </span>
            {execution.retry_count > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title={`Healing retry #${execution.retry_count} of original execution`}>
                <RefreshCw className="w-2.5 h-2.5" />
                Retry #{execution.retry_count}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-1.5 p-3 bg-background">
          <div className="typo-code text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Duration
          </div>
          <div className="typo-code text-foreground">
            {formatDuration(execution.duration_ms)}
          </div>
        </div>

        <div className="space-y-1.5 p-3 bg-background">
          <div className="typo-code text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Started
          </div>
          <div className="typo-body text-foreground">
            {formatTimestamp(execution.started_at)}
          </div>
        </div>

        <div className="space-y-1.5 p-3 bg-background">
          <div className="typo-code text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Completed
          </div>
          <div className="typo-body text-foreground">
            {formatTimestamp(execution.completed_at)}
          </div>
        </div>
      </div>

      {/* Masked / Raw toggle */}
      {(execution.error_message || hasInputData || hasOutputData) && (
        <div className="flex justify-end">
          <Button
            onClick={() => setShowRaw(!showRaw)}
            variant="ghost"
            size="sm"
            icon={<Shield className="w-3 h-3" />}
            className={showRaw
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              : 'bg-secondary/30 text-muted-foreground/60 border-primary/10 hover:text-muted-foreground/80'
            }
            title={showRaw ? 'Sensitive values are visible' : 'Sensitive values are masked'}
          >
            {showRaw ? 'Raw' : 'Masked'}
          </Button>
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
        <Button
          onClick={() => setRerunInputData(execution.input_data || '{}')}
          variant="primary"
          size="sm"
          icon={<RotateCw className="w-3.5 h-3.5" />}
        >
          {execution.status === 'cancelled' ? 'Re-run execution' : 'Re-run with same input'}
        </Button>
      )}

      {/* Input Data */}
      {hasInputData && (
        <div>
          <Button
            onClick={() => setShowInputData(!showInputData)}
            variant="ghost"
            size="sm"
            icon={showInputData ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            className="mb-2 text-foreground/90 hover:text-foreground"
          >
            Input Data
          </Button>
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
          <Button
            onClick={() => setShowOutputData(!showOutputData)}
            variant="ghost"
            size="sm"
            icon={showOutputData ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            className="mb-2 text-foreground/90 hover:text-foreground"
          >
            Output Data
          </Button>
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
    </div>
  );
}
