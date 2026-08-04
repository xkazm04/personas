import type { PersonaExecution } from '@/lib/types/types';
import { formatDuration } from '@/lib/utils/formatters';
import { AlertCircle, Activity } from 'lucide-react';
import { ScrollShadowContainer } from '@/features/shared/components/display/ScrollShadowContainer';
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
  const {
    trace,
    unifiedTrace,
    loading,
    error,
    collapsedSpans,
    toggleSpan,
    visibleNodes,
    totalMs,
    childrenMap,
  } = useTraceData(execution.id, execution.persona_id);

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-modal typo-code text-red-300/80">
        {tx(e.failed_to_load_trace, { error })}
      </div>
    );
  }

  // Law 1 (docs/design/overview-loading.md): a fetch only ever ghosts into
  // emptiness. Once spans are on screen — including pipeline spans the store
  // already holds while the backend fetch is still in flight — they stay.
  const hasSpans = (unifiedTrace?.spans.length ?? 0) > 0;
  const showGhost = loading && !hasSpans;

  // Empty state only once settled, so a slow fetch never flashes "no trace".
  if (!showGhost && !hasSpans) {
    return (
      <div className="text-center py-10">
        <div className="w-12 h-12 mx-auto mb-3 rounded-modal bg-secondary/60 border border-primary/20 flex items-center justify-center">
          <Activity className="w-6 h-6 text-foreground" />
        </div>
        <p className="typo-body text-foreground">{e.no_trace_data}</p>
        <p className="typo-body text-foreground mt-1 max-w-[320px] mx-auto">{e.trace_empty_hint}</p>
      </div>
    );
  }

  // TraceSummary requires a full ExecutionTrace shape (input_tokens / evicted_span_count).
  // When only the live pipelineTrace is available (no backend trace yet), skip the
  // summary panel rather than fabricating fields.
  const showSummary = trace !== null;

  return (
    <div className="space-y-4">
      {showSummary && trace && <TraceSummary trace={trace} model={execution.model_used} />}

      {/* Time axis header */}
      <div className="rounded-modal border border-primary/20 bg-secondary/30 overflow-hidden">
        <div className="grid grid-cols-[minmax(200px,1fr)_minmax(200px,2fr)] gap-2 px-2 py-1.5 border-b border-primary/10 bg-secondary/40">
          <div className="typo-code text-foreground uppercase tracking-wider">
            {e.span}
          </div>
          <div className="flex justify-between typo-code text-foreground uppercase tracking-wider">
            <span>{e.zero_ms}</span>
            {/* The axis end is unknown until spans land; the slot stays so the
                header geometry never shifts when it fills in. */}
            <span>{hasSpans ? formatDuration(totalMs) : ''}</span>
          </div>
        </div>

        {/* Span rows — ghosts render UNDER the axis chrome above, never instead of it */}
        <ScrollShadowContainer className="max-h-[500px] overflow-y-auto" wrapperClassName="relative">
          {showGhost ? (
            <TraceGhostRows label={e.loading_trace} />
          ) : visibleNodes.map((node) => (
              <div className="animate-fade-slide-in"
                key={node.span.span_id}
                style={{ contentVisibility: 'auto', containIntrinsicSize: '0 32px' }}
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
        </ScrollShadowContainer>
      </div>

      {/* Error details */}
      {unifiedTrace?.spans.some(s => s.error) && (
        <div className="space-y-2">
          <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="w-2.5 h-2.5 text-red-400" />
            {e.errors}
          </div>
          {unifiedTrace.spans
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

// ---------------------------------------------------------------------------
// TraceGhostRows — the cold state for the span region, per
// docs/design/overview-loading.md (laws 3 + 5). It replaces a centered
// `LoadingSpinner`, which took over the whole tab and hid the time-axis chrome.
//
// Ghosts sit UNDER the real axis header in the real row geometry, and enter via
// `animate-fade-in` (fill-mode: both) behind a staggered delay starting at
// 120ms — opacity is held at 0 through the delay, so a fetch that resolves
// quickly paints no ghost at all. That delay IS the anti-flash: no timers, no
// minimum display. No `animate-pulse`; the entrance stagger is the only motion.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
/** Deterministic width variation so ghosts read as spans, not a barcode. */
const GHOST_NAME_WIDTHS = ['w-40', 'w-28', 'w-36', 'w-32'];
/** Indent pattern mimicking the tree's depth nesting. */
const GHOST_INDENTS = [0, 16, 32, 16, 32, 48, 16, 0];
/** Bar widths as a fraction of the waterfall track. */
const GHOST_BAR_WIDTHS = ['70%', '45%', '30%', '55%', '25%', '40%', '60%', '35%'];

function TraceGhostRows({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label}>
      {GHOST_INDENTS.map((indent, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="grid grid-cols-[minmax(200px,1fr)_minmax(200px,2fr)] gap-2 items-center px-2 py-1 animate-fade-in"
          style={{ height: 32, animationDelay: `${120 + i * 35}ms` }}
        >
          <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: `${indent}px` }}>
            <span className="w-4 flex-shrink-0" />
            <span className={`h-4 w-16 flex-shrink-0 ${GHOST_BAR}`} />
            <span className={`h-3 ${GHOST_NAME_WIDTHS[i % GHOST_NAME_WIDTHS.length]} max-w-full ${GHOST_BAR}`} />
          </div>
          <div className="relative h-5 w-full">
            <div className="absolute inset-0 bg-primary/5 rounded" />
            <div
              className={`absolute top-0.5 bottom-0.5 ${GHOST_BAR}`}
              style={{ left: `${i * 6}%`, width: GHOST_BAR_WIDTHS[i % GHOST_BAR_WIDTHS.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
