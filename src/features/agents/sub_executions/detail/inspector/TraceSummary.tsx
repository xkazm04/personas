import { useMemo } from 'react';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import { formatDuration, formatCount } from '@/lib/utils/formatters';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Clock, DollarSign, Zap, AlertCircle, Activity, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { CostBreakdownBar } from './CostBreakdownBar';

/**
 * Span ceiling the backend tracer evicts past — `MAX_SPANS` in
 * `src-tauri/core/src/trace.rs`. Interpolated into the eviction warning so the
 * figure lives in one place instead of being baked into 14 translated
 * sentences (the previous copy hardcoded "10,000" in every locale).
 */
const MAX_TRACE_SPANS = 10_000;

/**
 * `errorCount` is supplied by the caller and never recomputed here.
 *
 * The tile used to fold `trace.spans` itself while `TraceInspector` listed its
 * error cards from the UNIFIED trace (pipeline spans merged in). Those are
 * different span sets, so a run that failed in a frontend pipeline stage --
 * `traceStage(trace, 'validate', undefined, String(err))` in
 * `stores/slices/agents/executionSlice.ts:488` -- printed "0" in the Errors
 * tile with the error card rendered directly beneath it. One number, one place
 * that states the rule.
 */
export function TraceSummary({ trace, model, errorCount }: { trace: ExecutionTrace; model?: string | null; errorCount: number }) {
  const { t, tx, language } = useTranslation();
  const e = t.agents.executions;
  const stats = useMemo(() => {
    const rootSpan = trace.spans.find(s => s.span_type === 'execution');
    const toolCalls = trace.spans.filter(s => s.span_type === 'tool_call');
    // `null` is "we could not price this run"; `0` is "this run was free" --
    // the same rule SpanRow states per row. Coercing null to 0 and then
    // testing `> 0` collapsed both into one dash, so a genuinely free run was
    // reported as unpriced. The nullable measure stays nullable to the tile.
    const totalCost = rootSpan?.cost_usd ?? null;
    // The tokens obeyed the OPPOSITE rule to the cost three lines above, on the
    // same object, for the same reason. Every abort path calls
    // `trace.finalize(None, None, None, Some(err))`, which leaves input_tokens
    // and output_tokens null — so an aborted run read "Cost -" beside
    // "Tokens 0": one honest dash and one fabricated measurement describing the
    // same missing number. Nullable in, nullable out.
    const totalInput = rootSpan?.input_tokens ?? null;
    const totalOutput = rootSpan?.output_tokens ?? null;
    const totalTokens =
      totalInput == null && totalOutput == null ? null : (totalInput ?? 0) + (totalOutput ?? 0);

    return { totalCost, totalInput, totalOutput, totalTokens, toolCallCount: toolCalls.length };
  }, [trace.spans]);

  const evicted = trace.evicted_span_count ?? 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <div className="rounded-card border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {e.duration}
        </div>
        <div className="typo-code text-foreground/90">
          {formatDuration(trace.total_duration_ms)}
        </div>
      </div>

      <div className="rounded-card border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
          <DollarSign className="w-2.5 h-2.5" />
          {e.cost}
        </div>
        <div className="typo-code text-foreground/90" data-testid="trace-cost">
          {stats.totalCost != null ? <>$<Numeric value={stats.totalCost} precision={4} /></> : '-'}
        </div>
      </div>

      <div className="rounded-card border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" />
          {e.tokens}
        </div>
        <div className="typo-code text-foreground/90" data-testid="trace-tokens">
          {stats.totalTokens != null ? <Numeric value={stats.totalTokens} /> : '-'}
        </div>
      </div>

      <div className="rounded-card border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
          <Activity className="w-2.5 h-2.5" />
          {e.spans}
        </div>
        <div className="typo-code text-foreground/90">
          {trace.spans.length}
        </div>
      </div>

      <div className="rounded-card border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" />
          {e.errors}
        </div>
        <div className={`typo-code ${errorCount > 0 ? 'text-red-400' : 'text-foreground/90'}`} data-testid="trace-error-count">
          {errorCount}
        </div>
      </div>

      {/* What the money went to. The tracer only ever attributes cost to the
          root span (see the per-span note in SpanRow), so the finest
          decomposition this trace can honestly support is input vs output —
          apportioned from the SAME total shown in the Cost tile above, never
          recomputed.

          `actualCostUsd` anchors the bar on a MEASURED price and estimates
          when there isn't one. A measured $0 is not an anchor it can scale,
          so it still falls through to the estimate — behaviour unchanged by
          the null/zero split above. */}
      {model && stats.totalTokens != null && stats.totalTokens > 0 && (
        <div className="col-span-2 md:col-span-5 rounded-card border border-primary/20 bg-secondary/40 p-3">
          <CostBreakdownBar
            model={model}
            inputTokens={stats.totalInput ?? 0}
            outputTokens={stats.totalOutput ?? 0}
            actualCostUsd={stats.totalCost ? stats.totalCost : null}
          />
        </div>
      )}

      {evicted > 0 && (
        <div className="col-span-2 md:col-span-5 rounded-card border border-yellow-500/40 bg-yellow-500/10 p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <span className="typo-body text-yellow-200/90">
            {tx(evicted === 1 ? e.trace_incomplete : e.trace_incomplete_other, {
              count: formatCount(evicted, { language, precision: 0 }),
              limit: formatCount(MAX_TRACE_SPANS, { language, precision: 0 }),
            })}
          </span>
        </div>
      )}
    </div>
  );
}
