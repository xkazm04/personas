import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import { ChevronRight, CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
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
  // `null` is "we could not price this span"; `0` is "this span was free".
  // Folding with `?? 0` printed a confident $0.0000 for a chain step where
  // NOTHING was priced — indistinguishable from a genuinely free run, and
  // today the tracer prices the root span alone, so that was the common case.
  // The count of spans the fold could not measure travels with the sum.
  const { cost, pricedSpans } = trace.spans.reduce(
    (acc, s) => (s.cost_usd == null
      ? acc
      : { cost: acc.cost + s.cost_usd, pricedSpans: acc.pricedSpans + 1 }),
    { cost: 0, pricedSpans: 0 },
  );
  // Same rule as the cost column, applied to the status icon it sits next to.
  // `hasError` is the only evidence this row had, so ExecutionTrace carrying no
  // status field meant "still running", "cancelled", "failed without writing a
  // span error" and "no spans at all" ALL fell through to a definitive green
  // tick. Only `finalize()` stamps the root span's `end_ms`
  // (`src-tauri/core/src/trace.rs`), so a closed root is the one positive piece
  // of evidence available that the run actually finished — anything else is
  // unknown, and unknown is not success.
  const rootSpan = trace.spans.find((s) => s.parent_span_id === null);
  const settled = !!rootSpan && rootSpan.end_ms != null;
  const StatusIcon = hasError ? XCircle : settled ? CheckCircle2 : CircleDashed;
  const statusClass = hasError
    ? 'text-status-error'
    : settled
      ? 'text-status-success'
      : 'text-foreground';

  // Six fixed-width slots on one non-wrapping line clipped this row below
  // ~420px, against a parent that hides its overflow. The rest of the detail
  // view degrades deliberately for a narrow window (the aside is `lg:`-gated,
  // the waterfall pans inside its own scroller); this row wraps instead — the
  // metrics group drops to a second line rather than off the edge.
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={isCurrent}
      className={`w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left transition-colors ${
        isCurrent ? 'bg-primary/10 cursor-default' : 'hover:bg-secondary/40'
      }`}
      data-testid="chain-span-row"
    >
      <span className="typo-code text-foreground tabular-nums w-5 text-right flex-shrink-0">{index + 1}</span>
      <StatusIcon className={`w-4 h-4 flex-shrink-0 ${statusClass}`} data-testid="chain-span-status" />
      <span className="typo-code text-foreground flex-shrink-0">#{trace.execution_id.slice(0, 8)}</span>
      {isCurrent && (
        <span className="typo-code px-1.5 py-0.5 rounded-card bg-primary/15 text-primary/80 border border-primary/20 flex-shrink-0">
          {e.chain_current}
        </span>
      )}
      <span className="typo-code text-foreground ml-auto whitespace-nowrap flex-shrink-0">{tx(e.chain_spans_count, { count: trace.spans.length })}</span>
      <span className="typo-code text-foreground w-16 text-right flex-shrink-0">{formatDuration(trace.total_duration_ms)}</span>
      <span className="typo-code text-foreground w-20 text-right flex-shrink-0" data-testid="chain-span-cost">
        {pricedSpans > 0 ? formatCost(cost, { precision: 4, language }) : '-'}
      </span>
      {isCurrent
        ? <span className="w-3.5 h-3.5 flex-shrink-0" />
        : <ChevronRight className="w-3.5 h-3.5 text-foreground flex-shrink-0" />}
    </button>
  );
}
