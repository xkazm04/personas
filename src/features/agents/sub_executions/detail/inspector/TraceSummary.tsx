import { useMemo } from 'react';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import { formatDuration } from '@/lib/utils/formatters';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Clock, DollarSign, Zap, AlertCircle, Activity, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText } from '@/i18n/DebtText';


export function TraceSummary({ trace }: { trace: ExecutionTrace }) {
  const { t } = useTranslation();
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
            <DebtText k="auto_trace_incomplete_715361d5" /> <Numeric value={evicted} /> span{evicted !== 1 ? 's' : ''} <DebtText k="auto_evicted_limit_10_000_cb8cd8c5" />
          </span>
        </div>
      )}
    </div>
  );
}
