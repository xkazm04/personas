import type { DbPersonaExecution } from '@/lib/types/types';
import { formatDuration } from '@/lib/utils/formatters';
import { AlertCircle, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SPAN_TYPE_CONFIG } from './traceInspectorTypes';
import { SpanRow } from './SpanRow';
import { TraceSummary } from './TraceSummary';
import { useTraceData } from './useTraceData';

interface TraceInspectorProps {
  execution: DbPersonaExecution;
}

export function TraceInspector({ execution }: TraceInspectorProps) {
  const { trace, loading, error, collapsedSpans, toggleSpan, visibleNodes, totalMs, childrenMap } =
    useTraceData(execution.id, execution.persona_id);

  if (loading) return null;

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300/80 font-mono">
        Failed to load trace: {error}
      </div>
    );
  }

  if (!trace || trace.spans.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/60 border border-primary/20 flex items-center justify-center">
          <Activity className="w-6 h-6 text-muted-foreground/60" />
        </div>
        <p className="text-sm text-muted-foreground/80">No trace data recorded</p>
        <p className="text-sm text-muted-foreground/60 mt-1">Trace spans appear during execution</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TraceSummary trace={trace} />

      {/* Time axis header */}
      <div className="rounded-xl border border-primary/20 bg-secondary/30 overflow-hidden">
        <div className="grid grid-cols-[minmax(200px,1fr)_minmax(200px,2fr)] gap-2 px-2 py-1.5 border-b border-primary/10 bg-secondary/40">
          <div className="text-sm font-mono text-muted-foreground/60 uppercase tracking-wider">
            Span
          </div>
          <div className="flex justify-between text-sm font-mono text-muted-foreground/60 uppercase tracking-wider">
            <span>0ms</span>
            <span>{formatDuration(totalMs)}</span>
          </div>
        </div>

        {/* Span rows */}
        <div className="max-h-[500px] overflow-y-auto">
          <AnimatePresence initial={false}>
            {visibleNodes.map((node) => (
              <motion.div
                key={node.span.span_id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.1 }}
              >
                <SpanRow
                  node={node}
                  totalMs={totalMs}
                  expanded={!collapsedSpans.has(node.span.span_id)}
                  onToggle={() => toggleSpan(node.span.span_id)}
                  hasChildren={childrenMap.has(node.span.span_id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Error details */}
      {trace.spans.some(s => s.error) && (
        <div className="space-y-2">
          <div className="text-sm font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="w-2.5 h-2.5 text-red-400" />
            Errors
          </div>
          {trace.spans
            .filter(s => s.error)
            .map((span) => {
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
      )}
    </div>
  );
}
