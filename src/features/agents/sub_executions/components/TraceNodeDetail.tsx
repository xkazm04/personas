import { useMemo } from 'react';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import { formatDuration } from '@/lib/utils/formatters';
import { Clock, DollarSign, Zap, AlertCircle, Activity } from 'lucide-react';
import { SPAN_TYPE_CONFIG } from '../libs/traceHelpers';

// Trace summary cards

export function TraceSummary({ trace }: { trace: ExecutionTrace }) {
  const stats = useMemo(() => {
    const rootSpan = trace.spans.find(s => s.span_type === 'execution');
    const toolCalls = trace.spans.filter(s => s.span_type === 'tool_call');
    const totalCost = rootSpan?.cost_usd ?? 0;
    const totalInput = rootSpan?.input_tokens ?? 0;
    const totalOutput = rootSpan?.output_tokens ?? 0;
    const errors = trace.spans.filter(s => s.error != null);

    return { totalCost, totalInput, totalOutput, toolCallCount: toolCalls.length, errorCount: errors.length };
  }, [trace.spans]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 3xl:gap-4 4xl:gap-5">
      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-sm font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          Duration
        </div>
        <div className="text-sm font-mono text-foreground/90">
          {formatDuration(trace.total_duration_ms)}
        </div>
      </div>

      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-sm font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <DollarSign className="w-2.5 h-2.5" />
          Cost
        </div>
        <div className="text-sm font-mono text-foreground/90">
          {stats.totalCost > 0 ? `$${stats.totalCost.toFixed(4)}` : '-'}
        </div>
      </div>

      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-sm font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" />
          Tokens
        </div>
        <div className="text-sm font-mono text-foreground/90">
          {(stats.totalInput + stats.totalOutput).toLocaleString()}
        </div>
      </div>

      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-sm font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <Activity className="w-2.5 h-2.5" />
          Spans
        </div>
        <div className="text-sm font-mono text-foreground/90">
          {trace.spans.length}
        </div>
      </div>

      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-sm font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" />
          Errors
        </div>
        <div className={`text-sm font-mono ${stats.errorCount > 0 ? 'text-red-400' : 'text-foreground/90'}`}>
          {stats.errorCount}
        </div>
      </div>
    </div>
  );
}

// Trace error details section

export function TraceErrors({ trace }: { trace: ExecutionTrace }) {
  const errorSpans = trace.spans.filter(s => s.error);
  if (errorSpans.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-sm font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
        <AlertCircle className="w-2.5 h-2.5 text-red-400" />
        Errors
      </div>
      {errorSpans.map((span) => {
        const config = SPAN_TYPE_CONFIG[span.span_type];
        return (
          <div key={span.span_id} className="p-3 bg-red-500/5 border border-red-500/15 rounded-lg">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`inline-flex px-1.5 py-0.5 text-sm font-mono uppercase rounded border ${config.bg} ${config.color} ${config.border}`}>
                {config.label}
              </span>
              <span className="text-sm font-mono text-foreground/80">{span.name}</span>
            </div>
            <pre className="text-sm text-red-300/80 font-mono whitespace-pre-wrap break-words">
              {span.error}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
