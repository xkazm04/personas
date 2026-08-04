import { useMemo } from 'react';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import { formatDuration, formatCount } from '@/lib/utils/formatters';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Clock, DollarSign, Zap, AlertCircle, Activity, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Span ceiling the backend tracer evicts past — `MAX_SPANS` in
 * `src-tauri/core/src/trace.rs`. Interpolated into the eviction warning so the
 * figure lives in one place instead of being baked into 14 translated
 * sentences (the previous copy hardcoded "10,000" in every locale).
 */
const MAX_TRACE_SPANS = 10_000;

export function TraceSummary({ trace }: { trace: ExecutionTrace }) {
  const { t, tx, language } = useTranslation();
  const e = t.agents.executions;
  const stats = useMemo(() => {
    const rootSpan = trace.spans.find(s => s.span_type === 'execution');
    const toolCalls = trace.spans.filter(s => s.span_type === 'tool_call');
    const totalCost = rootSpan?.cost_usd ?? 0;
    const totalInput = rootSpan?.input_tokens ?? 0;
    const totalOutput = rootSpan?.output_tokens ?? 0;
    const errors = trace.spans.filter(s => s.error != null);

    return { totalCost, totalInput, totalOutput, toolCallCount: toolCalls.length, errorCount: errors.length };
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
        <div className="typo-code text-foreground/90">
          {stats.totalCost > 0 ? <>$<Numeric value={stats.totalCost} precision={4} /></> : '-'}
        </div>
      </div>

      <div className="rounded-card border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" />
          {e.tokens}
        </div>
        <div className="typo-code text-foreground/90">
          <Numeric value={stats.totalInput + stats.totalOutput} />
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
        <div className={`typo-code ${stats.errorCount > 0 ? 'text-red-400' : 'text-foreground/90'}`}>
          {stats.errorCount}
        </div>
      </div>

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
