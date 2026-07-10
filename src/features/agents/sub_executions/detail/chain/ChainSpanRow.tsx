import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import { ChevronRight, CheckCircle2, XCircle } from 'lucide-react';
import { formatDuration, formatCost } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

interface ChainSpanRowProps {
  trace: ExecutionTrace;
  index: number;
  isCurrent: boolean;
  onOpen: () => void;
}

/**
 * One persona's span in a chain trace: derived status (any errored span → failed),
 * span count, duration and summed cost. Click-throughs to that execution's detail
 * unless it's the run currently being viewed.
 */
export function ChainSpanRow({ trace, index, isCurrent, onOpen }: ChainSpanRowProps) {
  const { t, tx, language } = useTranslation();
  const e = t.agents.executions;
  const hasError = trace.spans.some((s) => s.error);
  const cost = trace.spans.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);
  const StatusIcon = hasError ? XCircle : CheckCircle2;
  const statusClass = hasError ? 'text-status-error' : 'text-status-success';

  return (
    <button
      onClick={onOpen}
      disabled={isCurrent}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
        isCurrent ? 'bg-primary/10 cursor-default' : 'hover:bg-secondary/40'
      }`}
    >
      <span className="typo-code text-foreground tabular-nums w-5 text-right">{index + 1}</span>
      <StatusIcon className={`w-4 h-4 flex-shrink-0 ${statusClass}`} />
      <span className="typo-code text-foreground">#{trace.execution_id.slice(0, 8)}</span>
      {isCurrent && (
        <span className="typo-code px-1.5 py-0.5 rounded-card bg-primary/15 text-primary/80 border border-primary/20">
          {e.chain_current}
        </span>
      )}
      <span className="typo-code text-foreground ml-auto whitespace-nowrap">{tx(e.chain_spans_count, { count: trace.spans.length })}</span>
      <span className="typo-code text-foreground w-16 text-right">{formatDuration(trace.total_duration_ms)}</span>
      <span className="typo-code text-foreground w-20 text-right">{formatCost(cost, { precision: 4, language })}</span>
      {isCurrent
        ? <span className="w-3.5 h-3.5 flex-shrink-0" />
        : <ChevronRight className="w-3.5 h-3.5 text-foreground flex-shrink-0" />}
    </button>
  );
}
