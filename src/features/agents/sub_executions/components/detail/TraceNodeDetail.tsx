import { useMemo } from 'react';
import type { UnifiedTrace } from '@/lib/execution/pipeline';
import { formatDuration } from '@/lib/utils/formatters';
import { Clock, DollarSign, AlertCircle, Activity } from 'lucide-react';
import { getSpanConfig } from '../../libs/traceHelpers';
import { useTranslation } from '@/i18n/useTranslation';

// Trace summary cards

export function TraceSummary({ trace }: { trace: UnifiedTrace }) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const stats = useMemo(() => {
    const rootSpan = trace.spans.find(s => s.span_type === 'execution');
    const toolCalls = trace.spans.filter(s => s.span_type === 'tool_call');
    const totalCost = rootSpan?.cost_usd ?? 0;
    const errors = trace.spans.filter(s => s.error != null);

    return { totalCost, toolCallCount: toolCalls.length, errorCount: errors.length };
  }, [trace.spans]);

  const totalMs = trace.completedAt ? trace.completedAt - trace.startedAt : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 3xl:gap-4 4xl:gap-5">
      <div className="rounded-card border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {e.duration}
        </div>
        <div className="typo-code text-foreground/90">
          {formatDuration(totalMs)}
        </div>
      </div>

      <div className="rounded-card border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
          <DollarSign className="w-2.5 h-2.5" />
          {e.cost}
        </div>
        <div className="typo-code text-foreground/90">
          {stats.totalCost > 0 ? `$${stats.totalCost.toFixed(4)}` : '-'}
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
    </div>
  );
}

// Trace error details section

export function TraceErrors({ trace }: { trace: UnifiedTrace }) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const errorSpans = trace.spans.filter(s => s.error);
  if (errorSpans.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
        <AlertCircle className="w-2.5 h-2.5 text-red-400" />
        {e.errors}
      </div>
      {errorSpans.map((span) => {
        const config = getSpanConfig(span.span_type);
        return (
          <div key={span.span_id} className="p-3 bg-red-500/5 border border-red-500/15 rounded-card">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`inline-flex px-1.5 py-0.5 typo-code uppercase rounded border ${config.bg} ${config.color} ${config.border}`}>
                {config.label}
              </span>
              <span className="typo-code text-foreground">{span.name}</span>
            </div>
            <pre className="typo-code text-red-300/80 whitespace-pre-wrap break-words">
              {span.error}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
