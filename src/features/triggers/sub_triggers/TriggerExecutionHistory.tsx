import { useState, useEffect, useRef } from 'react';
import {
  History, ChevronDown, ChevronRight, AlertTriangle,
  RefreshCw, RotateCcw, CheckCircle2, XCircle,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { formatDuration, formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { useTriggerHistory } from '../hooks/useTriggerHistory';
import { TriggerHealthSparkline } from './TriggerHealthSparkline';
import { JsonPayloadBlock } from './JsonPayloadBlock';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';

// --- Execution Row --------------------------------------------------

interface ExecutionRowProps {
  exec: PersonaExecution;
  isExpanded: boolean;
  onToggle: () => void;
  onReplay: () => void;
  isReplaying: boolean;
  replayResult: { success: boolean; message: string } | null;
}

function ExecutionRow({ exec, isExpanded, onToggle, onReplay, isReplaying, replayResult }: ExecutionRowProps) {
  const { t } = useTranslation();
  const statusEntry = getStatusEntry(exec.status);
  const StatusIcon = statusEntry.icon;
  const hasPayload = exec.input_data || exec.output_data || exec.error_message;

  return (
    <div className="rounded-modal bg-background/30 border border-hair overflow-hidden">
      {/* Summary row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 typo-body hover:bg-surface-1 transition-colors"
      >
        {hasPayload ? (
          isExpanded
            ? <ChevronDown className="w-3 h-3 text-ink-1 flex-shrink-0" />
            : <ChevronRight className="w-3 h-3 text-ink-1 flex-shrink-0" />
        ) : (
          <div className="w-3 h-3 flex-shrink-0" />
        )}
        <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${statusEntry.text} ${statusEntry.pulse ? 'animate-pulse' : ''}`} />
        <span className={`px-1.5 py-0.5 rounded-interactive typo-body ${badgeClass(statusEntry)}`}>
          {statusEntry.label}
        </span>
        <span className="text-ink-1 font-mono">
          {formatDuration(exec.duration_ms)}
        </span>
        {exec.retry_count > 0 && (
          <span className="text-status-warning typo-body">{t.triggers.retry_hash}{exec.retry_count}</span>
        )}
        <span className="text-ink-1 ml-auto typo-body">
          {formatRelativeTime(exec.started_at)}
        </span>
      </button>

      {/* Expanded detail */}
      {isExpanded && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="px-3 pb-2.5 pt-1 space-y-2 border-t border-hair">
              {/* Metadata line */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 typo-body text-ink-1">
                <span className="font-mono">{exec.id.slice(0, 12)}</span>
                {exec.model_used && <span>{t.triggers.model_colon} {exec.model_used}</span>}
                {(exec.input_tokens > 0 || exec.output_tokens > 0) && (
                  <span>{exec.input_tokens}{'→'}{exec.output_tokens} tokens</span>
                )}
                {exec.cost_usd != null && exec.cost_usd > 0 && <span><Numeric value={exec.cost_usd} unit="usd" /></span>}
              </div>

              {/* Payloads */}
              <JsonPayloadBlock label="Input" data={exec.input_data} labelClassName="typo-body" />
              <JsonPayloadBlock label="Output" data={exec.output_data} labelClassName="typo-body" />
              {exec.error_message && (
                <div className="space-y-1">
                  <div className="typo-eyebrow text-status-error">Error</div>
                  <div className="px-2.5 py-2 rounded-card bg-status-error/5 border border-status-error/10 typo-code text-status-error whitespace-pre-wrap break-all">
                    {exec.error_message}
                  </div>
                </div>
              )}

              {/* Replay + result */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onReplay(); }}
                  disabled={isReplaying}
                  className="flex items-center gap-1.5 px-2.5 py-1 typo-body text-role-external hover:text-role-external hover:bg-role-external/10 rounded-card border border-role-external/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title={t.triggers.replay_button_title}
                >
                  {isReplaying
                    ? <LoadingSpinner size="xs" />
                    : <RotateCcw className="w-3 h-3" />}
                  {isReplaying ? t.triggers.replaying_label : t.triggers.replay_label}
                </button>
                {replayResult && (
                  <span className={`flex items-center gap-1 typo-body ${replayResult.success ? 'text-status-success' : 'text-status-error'}`}>
                    {replayResult.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {replayResult.message}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

// --- Main Component -------------------------------------------------

interface TriggerExecutionHistoryProps {
  triggerId: string;
  personaId: string;
  /** Whether the section starts open (replaces the old activityOpen toggle) */
  defaultOpen?: boolean;
}

export function TriggerExecutionHistory({ triggerId, personaId, defaultOpen = false }: TriggerExecutionHistoryProps) {
  const { t } = useTranslation();
  const history = useTriggerHistory(triggerId, personaId);
  const [open, setOpen] = useState(defaultOpen);

  // Auto-fetch once per (open, trigger). Guarding on executions.length === 0
  // with the whole history object in deps treated an empty result as "never
  // fetched", so a trigger that never fired refetched in an infinite IPC loop
  // while its section was open.
  const fetchedForRef = useRef<string | null>(null);
  const { fetch: fetchHistory } = history;
  useEffect(() => {
    if (open && fetchedForRef.current !== triggerId) {
      fetchedForRef.current = triggerId;
      void fetchHistory();
    }
  }, [open, triggerId, fetchHistory]);

  const toggle = () => setOpen((v) => !v);

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 pt-1 border-t border-hair typo-body text-ink-1 hover:text-ink-3 transition-colors w-full"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <History className="w-3 h-3" />
        {t.triggers.execution_history}
        {history.stats.totalRuns > 0 && (
          <span className="text-ink-1 ml-1">({history.stats.totalRuns})</span>
        )}
      </button>

      {open && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="space-y-1.5 pt-1">
              {history.loading ? (
                <div className="flex items-center gap-2 py-2 typo-body text-ink-1">
                  <LoadingSpinner size="xs" />
                  {t.triggers.loading_history}
                </div>
              ) : history.error ? (
                <div className="flex items-center gap-2 py-2 typo-body text-status-warning">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  {t.triggers.could_not_load_history}
                  <button
                    type="button"
                    onClick={() => void history.fetch()}
                    className="ml-auto flex items-center gap-1 typo-body text-ink-1 hover:text-ink-1 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry
                  </button>
                </div>
              ) : history.executions.length === 0 ? (
                <EmptyState art="runs" size="sm" title={t.triggers.no_executions_recorded} />
              ) : (
                <>
                  <TriggerHealthSparkline executions={history.executions} />
                  {history.executions.map((exec) => (
                    <ExecutionRow
                      key={exec.id}
                      exec={exec}
                      isExpanded={history.expandedId === exec.id}
                      onToggle={() => history.toggleExpanded(exec.id)}
                      onReplay={() => void history.replay(exec)}
                      isReplaying={history.replaying === exec.id}
                      replayResult={history.replayResult?.id === exec.id ? history.replayResult : null}
                    />
                  ))}
                  {/* Refresh button */}
                  <button
                    type="button"
                    onClick={() => void history.fetch()}
                    disabled={history.loading}
                    className="flex items-center gap-1.5 w-full justify-center py-1.5 typo-body text-ink-1 hover:text-ink-3 transition-colors"
                  >
                    <RefreshCw className={`w-3 h-3 ${history.loading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </>
              )}
            </div>
          </div>
        )}
    </>
  );
}

