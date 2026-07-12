import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import { Link2, AlertCircle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';
import { ChainSpanRow } from './ChainSpanRow';

interface ChainTraceViewProps {
  traces: ExecutionTrace[];
  loading: boolean;
  error: string | null;
  partial: boolean;
  currentExecutionId: string;
  onOpenExecution: (executionId: string) => void;
}

/**
 * Chain-trace viewer: ordered per-persona spans for every run sharing a
 * chain_trace_id, with status/cost/duration and click-through to each run's
 * detail. Handles loading, broken (error), empty, and partial-chain states.
 */
export function ChainTraceView({ traces, loading, error, partial, currentExecutionId, onOpenExecution }: ChainTraceViewProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-foreground">
        <LoadingSpinner size="lg" label={e.chain_loading} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-status-error/10 border border-status-error/20 rounded-modal typo-code text-status-error">
        {tx(e.chain_failed, { error })}
      </div>
    );
  }

  if (traces.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="w-12 h-12 mx-auto mb-3 rounded-modal bg-secondary/60 border border-primary/20 flex items-center justify-center">
          <Link2 className="w-6 h-6 text-foreground" />
        </div>
        <p className="typo-body text-foreground">{e.chain_empty}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="typo-heading text-foreground/90 flex items-center gap-2">
          <Link2 className="w-4 h-4" />{e.chain_title}
        </p>
        <p className="typo-body text-foreground mt-0.5">{e.chain_subtitle}</p>
      </div>

      <div className="rounded-modal border border-primary/20 bg-secondary/30 divide-y divide-primary/10 overflow-hidden">
        {traces.map((trace, idx) => (
          <ChainSpanRow
            key={trace.trace_id}
            trace={trace}
            index={idx}
            isCurrent={trace.execution_id === currentExecutionId}
            onOpen={() => onOpenExecution(trace.execution_id)}
          />
        ))}
      </div>

      {partial && (
        <div className="flex items-center gap-2 p-2.5 bg-status-warning/10 border border-status-warning/25 rounded-modal typo-body text-status-warning">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{e.chain_partial}
        </div>
      )}
    </div>
  );
}
