/**
 * Pure helpers behind the trace inspector: live span-event merging, and
 * trace-row visibility.
 *
 * Resolving "is any ancestor of this span collapsed?" used to walk the whole
 * span array once per hop (`spans.find`), which is O(n^2 * depth) on traces
 * that can carry up to 10k spans. Building the parent lookup once per trace
 * turns each hop into a Map read.
 *
 * They live outside the hook so both are directly testable.
 */
import type { UnifiedSpan } from '@/lib/execution/pipeline';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';

/**
 * Fold one live `execution-trace-span` event into the current span list.
 *
 * Returns the SAME array when nothing changed so callers can bail out of a
 * state update. An `end` whose `start` never arrived (dropped event, or the
 * detail tab subscribing mid-span) is appended rather than dropped -- silently
 * ignoring it made the span vanish from the live view entirely.
 */
export function mergeSpanEvent(
  spans: TraceSpan[],
  span: TraceSpan,
  eventType: string,
): TraceSpan[] {
  if (eventType !== 'start' && eventType !== 'end') return spans;

  const existingIdx = spans.findIndex((s) => s.span_id === span.span_id);
  if (existingIdx === -1) return [...spans, span];

  // A duplicate `start` is a no-op; an `end` supersedes the row we have.
  if (eventType !== 'end') return spans;
  const next = [...spans];
  next[existingIdx] = span;
  return next;
}

/** span_id -> parent_span_id (null for roots), built once per trace. */
export function buildParentMap(spans: UnifiedSpan[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const s of spans) {
    map.set(s.span_id, s.parent_span_id ?? null);
  }
  return map;
}

/**
 * True when any ancestor of `parentSpanId`'s chain (inclusive) is collapsed.
 * Guards against malformed traces with a parent cycle so the walk always ends.
 */
export function isAncestorCollapsed(
  parentSpanId: string | null | undefined,
  parentMap: Map<string, string | null>,
  collapsedSpans: ReadonlySet<string>,
): boolean {
  let current = parentSpanId ?? null;
  const seen = new Set<string>();
  while (current) {
    if (collapsedSpans.has(current)) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = parentMap.get(current) ?? null;
  }
  return false;
}
