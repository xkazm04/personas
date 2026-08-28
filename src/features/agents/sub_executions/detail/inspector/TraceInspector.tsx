import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PersonaExecution } from '@/lib/types/types';
import { formatDuration, formatCount } from '@/lib/utils/formatters';
import { AlertCircle, Activity, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { ScrollShadowContainer } from '@/features/shared/components/display/ScrollShadowContainer';
import { getSpanTypeConfig, isSpanFailure, spanTypeLabel } from './traceInspectorTypes';
import { SpanRow } from './SpanRow';
import { TraceSummary } from './TraceSummary';
import { useTraceData } from './useTraceData';
import { useTranslation } from '@/i18n/useTranslation';


interface TraceInspectorProps {
  execution: PersonaExecution;
}

/**
 * Cards rendered for errored spans.
 *
 * A run that fails inside a retry loop can put thousands of errored spans in
 * one trace (the tracer's ceiling is 10,000), and every card carries the full
 * error text in a wrapping `<pre>`. Uncapped, this section grew without limit
 * exactly when a run went pathological — below a waterfall that is itself
 * capped at 500px. The budget and the cut are stated together: a truncated
 * list that does not say it was truncated is the defect, not the cap.
 */
const MAX_ERROR_CARDS = 50;

/**
 * Fixed row geometry for the waterfall. Every row is a single line — the name
 * is `truncate`d and the badges are inline — so one constant describes the
 * whole list and the virtualizer needs no per-row measurement. It is also the
 * height `TraceGhostRows` already used, so the cold state and the settled list
 * occupy identical space.
 */
const SPAN_ROW_HEIGHT = 32;

/**
 * Below this many visible rows the plain map is cheaper than a virtualizer
 * (and keeps the per-row entrance animation, which reads as noise once rows
 * are recycled on scroll). Mirrors `VirtualizedTableBody`'s own threshold.
 */
const VIRTUALIZE_THRESHOLD = 50;

/** Rows kept outside the viewport on each side so a fast scroll never tears. */
const SPAN_ROW_OVERSCAN = 12;

export function TraceInspector({ execution }: TraceInspectorProps) {
  const { t, tx, language } = useTranslation();
  const e = t.agents.executions;
  const {
    trace,
    traceIsSynthetic,
    unifiedTrace,
    loading,
    error,
    retry,
    collapsedSpans,
    toggleSpan,
    visibleNodes,
    totalMs,
    childrenMap,
    droppedSpanEvents,
    spanEventBufferCap,
  } = useTraceData(execution.id, execution.persona_id);

  // The one definition of "which spans failed" for this view: the summary tile
  // counts exactly the spans listed below it. Folding the tile's number from a
  // different span set is how the two disagreed.
  //
  // `isSpanFailure` -- not `s.error` truthiness -- is what keeps the tracer's
  // force-close marker out of both. A cancelled run leaves open spans stamped
  // with UNCLOSED_SPAN_SENTINEL, which is bookkeeping, not a run error.
  const errorSpans = useMemo(
    () => (unifiedTrace?.spans ?? []).filter(isSpanFailure),
    [unifiedTrace],
  );
  const shownErrorSpans = errorSpans.length > MAX_ERROR_CARDS
    ? errorSpans.slice(0, MAX_ERROR_CARDS)
    : errorSpans;

  // `contentVisibility: 'auto'` skips layout and paint for offscreen rows but
  // never skips element creation, React reconcile, or SpanRow's propsEqual —
  // and every live span event rebuilds the unified trace, so that O(N) cost
  // was paid per event against a 10,000-span ceiling, on a RUNNING execution.
  // Virtualizing bounds the created set to the window regardless of N.
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = visibleNodes.length > VIRTUALIZE_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: visibleNodes.length,
    // The scroll element is ScrollShadowContainer's INNER div (the one that
    // carries overflow-y-auto), reached through its `scrollRef` prop — the
    // outer wrapper only positions the gradients and never scrolls.
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SPAN_ROW_HEIGHT,
    overscan: SPAN_ROW_OVERSCAN,
    enabled: shouldVirtualize,
  });

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-modal typo-code text-red-300/80 space-y-2">
        <div>{tx(e.failed_to_load_trace, { error })}</div>
        <Button variant="secondary" size="xs" onClick={retry} icon={<RefreshCw className="w-3 h-3" />}>
          {t.common.retry}
        </Button>
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
  // summary panel rather than fabricating fields — and the same rule covers the
  // SHELL `useTraceData` synthesizes for a still-running execution: it exists so
  // live spans have somewhere to land, and it has measured nothing, so it must
  // not paint a duration/cost/token strip.
  const showSummary = trace !== null && !traceIsSynthetic;

  return (
    <div className="space-y-4">
      {showSummary && trace && (
        <TraceSummary
          trace={trace}
          model={execution.model_used}
          errorCount={errorSpans.length}
          spanCount={unifiedTrace?.spans.length ?? 0}
        />
      )}

      {/* The frontend half of the truncation pair. TraceSummary warns on the
          BACKEND ceiling (`evicted_span_count`); this warns when the live
          fetch-window buffer overflowed, which clips exactly the same derived
          numbers with none of the same visibility. */}
      {droppedSpanEvents > 0 && (
        <div
          className="rounded-card border border-yellow-500/40 bg-yellow-500/10 p-3 flex items-center gap-2"
          data-testid="trace-live-events-dropped"
        >
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <span className="typo-body text-yellow-200/90">
            {tx(droppedSpanEvents === 1 ? e.live_events_dropped : e.live_events_dropped_other, {
              count: formatCount(droppedSpanEvents, { language, precision: 0 }),
              limit: formatCount(spanEventBufferCap, { language, precision: 0 }),
            })}
          </span>
        </div>
      )}

      {/* Time axis header */}
      <div className="rounded-modal border border-primary/20 bg-secondary/30 overflow-hidden">
        {/* The span grid has a ~400px intrinsic minimum (two minmax(200px,...)
            columns). Without a horizontal scroller a narrow window crushes the
            name column instead of letting the user pan the waterfall. */}
        <div className="overflow-x-auto">
          <div className="min-w-[420px]">
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
            <ScrollShadowContainer className="max-h-[500px] overflow-y-auto" wrapperClassName="relative" scrollRef={scrollRef}>
              {showGhost ? (
                <TraceGhostRows label={e.loading_trace} />
              ) : shouldVirtualize ? (
                /* Spacer of the full list height so the scrollbar describes the
                   whole trace; only the windowed rows exist as elements. */
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const node = visibleNodes[virtualRow.index]!;
                    return (
                      <div
                        key={node.span.span_id}
                        data-testid="trace-span-row"
                        data-index={virtualRow.index}
                        className="absolute inset-x-0 top-0"
                        style={{ height: SPAN_ROW_HEIGHT, transform: `translateY(${virtualRow.start}px)` }}
                      >
                        <SpanRow
                          node={node}
                          totalMs={totalMs}
                          expanded={!collapsedSpans.has(node.span.span_id)}
                          onToggle={toggleSpan}
                          hasChildren={childrenMap.has(node.span.span_id)}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : visibleNodes.map((node) => (
                  <div className="animate-fade-slide-in"
                    key={node.span.span_id}
                    data-testid="trace-span-row"
                    style={{ height: SPAN_ROW_HEIGHT }}
                  >
                    <SpanRow
                      node={node}
                      totalMs={totalMs}
                      expanded={!collapsedSpans.has(node.span.span_id)}
                      onToggle={toggleSpan}
                      hasChildren={childrenMap.has(node.span.span_id)}
                    />
                  </div>
                ))}
            </ScrollShadowContainer>
          </div>
        </div>
      </div>

      {/* Error details */}
      {errorSpans.length > 0 && (
        <div className="space-y-2">
          <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="w-2.5 h-2.5 text-red-400" />
            {e.errors}
          </div>
          {shownErrorSpans
            .map((span) => {
              const config = getSpanTypeConfig(span.span_type);
              return (
                <div key={span.span_id} className="p-3 bg-red-500/5 border border-red-500/15 rounded-card">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`inline-flex px-1.5 py-0.5 typo-code uppercase rounded border ${config.bg} ${config.color} ${config.border}`}>
                      {spanTypeLabel(t, span.span_type)}
                    </span>
                    <span className="typo-code text-foreground">{span.name}</span>
                  </div>
                  <pre className="typo-code text-red-300/80 whitespace-pre-wrap break-words">
                    {span.error}
                  </pre>
                </div>
              );
            })}
          {errorSpans.length > shownErrorSpans.length && (
            <div className="typo-code text-foreground px-1" data-testid="trace-error-cards-capped">
              {tx(e.error_cards_capped, { shown: shownErrorSpans.length, total: errorSpans.length })}
            </div>
          )}
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
