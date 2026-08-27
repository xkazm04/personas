import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { ChainStopReason } from '@/lib/bindings/ChainStopReason';
import { Link2, AlertCircle, CircleSlash } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { formatCost } from '@/lib/utils/formatters';
import { ChainSpanRow } from './ChainSpanRow';

interface ChainTraceViewProps {
  traces: ExecutionTrace[];
  loading: boolean;
  error: string | null;
  partial: boolean;
  stopReasons: ChainStopReason[];
  chainCostUsd: number;
  currentExecutionId: string;
  onOpenExecution: (executionId: string) => void;
}

/**
 * Chain-trace viewer: ordered per-persona spans for every run sharing a
 * chain_trace_id, with status/cost/duration and click-through to each run's
 * detail. Also surfaces the chain's total cost and the structured stop reasons
 * that explain why the relay did not continue (suppressed handoff, cycle,
 * depth/budget ceiling, unmet predicate, quarantine). Handles loading, broken
 * (error), empty, and partial-chain states.
 */
export function ChainTraceView({ traces, loading, error, partial, stopReasons, chainCostUsd, currentExecutionId, onOpenExecution }: ChainTraceViewProps) {
  const { t, tx, language } = useTranslation();
  const e = t.agents.executions;

  // Cold load: the chain header stays put and the row region ghosts UNDER it
  // (docs/design/overview-loading.md laws 3 + 5). This branch used to render a
  // centred `feedback/LoadingSpinner`, which returns null -- so the whole tab
  // was a blank 4rem box for the length of the fetch.
  if (loading) {
    return (
      <div className="space-y-3">
        <ChainHeader title={e.chain_title} subtitle={e.chain_subtitle} />
        <div
          role="status"
          aria-label={e.chain_loading}
          className="rounded-modal border border-primary/20 bg-secondary/30 divide-y divide-primary/10 overflow-hidden"
        >
          {CHAIN_GHOST_ROWS.map((i) => (
            <div
              key={i}
              aria-hidden="true"
              className="flex items-center gap-3 px-3 py-2.5 animate-fade-in"
              style={{ animationDelay: `${120 + i * 35}ms` }}
            >
              <span className={`h-3 w-3 ${GHOST_BAR}`} />
              <span className="h-4 w-4 rounded-full bg-primary/[0.06]" />
              <span className={`h-3 w-24 ${GHOST_BAR}`} />
              <span className={`h-3 w-14 ml-auto ${GHOST_BAR}`} />
              <span className={`h-3 w-16 ${GHOST_BAR}`} />
            </div>
          ))}
        </div>
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
      <div className="flex items-start justify-between gap-3">
        <ChainHeader title={e.chain_title} subtitle={e.chain_subtitle} />
        {chainCostUsd > 0 && (
          <div className="text-right flex-shrink-0">
            <p className="typo-caption text-foreground">{e.chain_total_cost}</p>
            <p className="typo-code text-foreground tabular-nums">{formatCost(chainCostUsd, { precision: 4, language })}</p>
          </div>
        )}
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

      {stopReasons.length > 0 && (
        <div className="rounded-modal border border-primary/15 bg-secondary/20 p-3 space-y-2">
          <p className="typo-caption text-foreground flex items-center gap-1.5">
            <CircleSlash className="w-3.5 h-3.5" />{e.chain_ended_because}
          </p>
          <ul className="space-y-1.5">
            {stopReasons.map((reason) => (
              <li key={reason.id} className="flex items-start gap-2 typo-body text-foreground">
                <span className="typo-code px-1.5 py-0.5 rounded-card bg-primary/10 text-foreground/90 border border-primary/15 whitespace-nowrap flex-shrink-0">
                  {tokenLabel(t, 'chain_stop', reason.reason_token)}
                </span>
                {reason.detail && <span className="text-foreground/90">{reason.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {partial && (
        <div className="flex items-center gap-2 p-2.5 bg-status-warning/10 border border-status-warning/25 rounded-modal typo-body text-status-warning">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{e.chain_partial}
        </div>
      )}
    </div>
  );
}

/** Ghost row geometry mirrors ChainSpanRow's `px-3 py-2.5` chain rows. */
const GHOST_BAR = 'rounded bg-primary/[0.06]';
const CHAIN_GHOST_ROWS = [0, 1, 2];

/** The chain heading, rendered identically while loading and once settled. */
function ChainHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <p className="typo-heading text-foreground/90 flex items-center gap-2">
        <Link2 className="w-4 h-4" />{title}
      </p>
      <p className="typo-body text-foreground mt-0.5">{subtitle}</p>
    </div>
  );
}
