import type { PersonaExecution } from '@/lib/types/types';
import { formatDuration } from '@/lib/utils/formatters';
import { AlertCircle, Activity } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { getSpanTypeConfig } from './traceInspectorTypes';
import { SpanRow } from './SpanRow';
import { TraceSummary } from './TraceSummary';
import { useTraceData } from './useTraceData';
import { useTranslation } from '@/i18n/useTranslation';

interface TraceInspectorProps {
  execution: PersonaExecution;
}

export function TraceInspector({ execution }: TraceInspectorProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const { trace, loading, error, collapsedSpans, toggleSpan, visibleNodes, totalMs, childrenMap } =
    useTraceData(execution.id, execution.persona_id);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-foreground">
        <LoadingSpinner size="lg" label="Loading trace" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-modal typo-code text-red-300/80">
        {tx(e.failed_to_load_trace, { error })}
      </div>
    );
  }

  if (!trace || trace.spans.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="w-12 h-12 mx-auto mb-3 rounded-modal bg-secondary/60 border border-primary/20 flex items-center justify-center">
          <Activity className="w-6 h-6 text-foreground" />
        </div>
        <p className="typo-body text-foreground">{e.no_trace_data}</p>
        <p className="typo-body text-foreground mt-1">{e.trace_spans_appear}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TraceSummary trace={trace} />

      {/* Time axis header */}
      <div className="rounded-modal border border-primary/20 bg-secondary/30 overflow-hidden">
        <div className="grid grid-cols-[minmax(200px,1fr)_minmax(200px,2fr)] gap-2 px-2 py-1.5 border-b border-primary/10 bg-secondary/40">
          <div className="typo-code text-foreground uppercase tracking-wider">
            {e.span}
          </div>
          <div className="flex justify-between typo-code text-foreground uppercase tracking-wider">
            <span>0ms</span>
            <span>{formatDuration(totalMs)}</span>
          </div>
        </div>

        {/* Span rows */}
        <div className="max-h-[500px] overflow-y-auto">
          {visibleNodes.map((node) => (
              <div className="animate-fade-slide-in"
                key={node.span.span_id}
              >
                <SpanRow
                  node={node}
                  totalMs={totalMs}
                  expanded={!collapsedSpans.has(node.span.span_id)}
                  onToggle={() => toggleSpan(node.span.span_id)}
                  hasChildren={childrenMap.has(node.span.span_id)}
                />
              </div>
            ))}
        </div>
      </div>

      {/* Error details */}
      {trace.spans.some(s => s.error) && (
        <div className="space-y-2">
          <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="w-2.5 h-2.5 text-red-400" />
            {e.errors}
          </div>
          {trace.spans
            .filter(s => s.error)
            .map((span) => {
              const config = getSpanTypeConfig(span.span_type);
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
      )}
    </div>
  );
}
