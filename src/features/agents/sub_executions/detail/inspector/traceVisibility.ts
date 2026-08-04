/**
 * Pure helpers for trace-row visibility.
 *
 * Resolving "is any ancestor of this span collapsed?" used to walk the whole
 * span array once per hop (`spans.find`), which is O(n^2 * depth) on traces
 * that can carry up to 10k spans. Building the parent lookup once per trace
 * turns each hop into a Map read.
 */
import type { UnifiedSpan } from '@/lib/execution/pipeline';

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
