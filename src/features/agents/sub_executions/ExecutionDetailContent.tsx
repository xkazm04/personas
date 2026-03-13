import { useState, useCallback } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import { Clock, Calendar, RotateCw, RefreshCw, Shield } from 'lucide-react';
import { formatTimestamp, formatDuration, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { isTerminalState } from '@/lib/execution/executionState';
import { sanitizeErrorMessage } from '@/lib/utils/sanitizers/maskSensitive';
import { ErrorExplanationCard } from './ErrorExplanationCard';
import { DetailCollapsibleSections } from './DetailCollapsibleSections';
import {
  type ErrorAction,
  getErrorExplanation,
  hasNonEmptyJson,
} from './executionDetailHelpers';

interface ExecutionDetailContentProps {
  execution: PersonaExecution;
}

export function ExecutionDetailContent({ execution }: ExecutionDetailContentProps) {
  const setRerunInputData = useSystemStore((s) => s.setRerunInputData);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const selectPersona = useAgentStore((s) => s.selectPersona);

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

  const [showRaw, setShowRaw] = useState(false);

  const hasInputData = hasNonEmptyJson(execution.input_data, 'object');
  const hasOutputData = hasNonEmptyJson(execution.output_data, 'object');

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
          errorDisplay={showRaw ? execution.error_message : sanitizeErrorMessage(execution.error_message)}
          explanation={getErrorExplanation(execution.error_message)}
          onAction={handleErrorAction}
        />
      )}

      {/* Re-run Button */}
      {isTerminalState(execution.status) && (
        <button
          onClick={() => setRerunInputData(execution.input_data || '{}')}
          className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors"
        >
          <RotateCw className="w-3.5 h-3.5" />
          {execution.status === 'cancelled' ? 'Re-run execution' : 'Re-run with same input'}
        </button>
      )}

      <DetailCollapsibleSections execution={execution} showRaw={showRaw} />
    </>
  );
}
