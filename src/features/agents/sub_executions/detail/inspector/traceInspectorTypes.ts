import type { SpanType } from '@/lib/bindings/SpanType';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import type { UnifiedSpan } from '@/lib/execution/pipeline';
import type { Translations } from '@/i18n/en';
import { SYSTEM_OPERATION_CONFIG } from '../../libs/traceHelpers';
import type { SpanNode as SpanNodeType } from '../../libs/traceHelpers';

// Re-export the canonical UnifiedSpan-based tree helpers + SpanNode type
// from libs/traceHelpers so the inspector and SystemTraceViewer share one
// implementation. (Earlier, this file shipped a parallel TraceSpan-based
// copy of buildSpanTree/flattenTree/SpanNode that drifted.)
export type { SpanNode } from '../../libs/traceHelpers';
export { buildSpanTree, flattenTree } from '../../libs/traceHelpers';

// ============================================================================
// Collapse / visibility derivation
// ============================================================================

/**
 * `span_id -> parent_span_id` index, built once per trace.
 *
 * The collapse walk needs to climb the ancestor chain of every node. Resolving
 * each hop with `spans.find(...)` made that O(n) per hop — quadratic against
 * the backend tracer's 10,000-span ceiling (`src-tauri/core/src/trace.rs`).
 */
export function buildParentIndex(spans: UnifiedSpan[]): Map<string, string | null> {
  const index = new Map<string, string | null>();
  for (const span of spans) {
    index.set(span.span_id, span.parent_span_id ?? null);
  }
  return index;
}

/**
 * Filter a flattened span list down to the nodes no collapsed ancestor hides.
 *
 * Ancestor chains are resolved through `parentIndex` (O(1) per hop) and each
 * chain verdict is memoised for the whole path, so the pass is O(n) amortised
 * regardless of tree depth. A malformed trace with a parent cycle terminates
 * via the path-length bound rather than spinning forever.
 */
export function computeVisibleNodes(
  nodes: SpanNodeType[],
  collapsedSpans: ReadonlySet<string>,
  parentIndex: ReadonlyMap<string, string | null>,
): SpanNodeType[] {
  if (collapsedSpans.size === 0) return nodes;

  // span_id -> "this span or one of its ancestors is collapsed"
  const chainCollapsed = new Map<string, boolean>();

  const isChainCollapsed = (startId: string | null): boolean => {
    const path: string[] = [];
    let current = startId;
    let verdict = false;

    while (current) {
      const cached = chainCollapsed.get(current);
      if (cached !== undefined) {
        verdict = cached;
        break;
      }
      if (collapsedSpans.has(current)) {
        chainCollapsed.set(current, true);
        verdict = true;
        break;
      }
      path.push(current);
      if (path.length > parentIndex.size) break; // cycle guard
      current = parentIndex.get(current) ?? null;
    }

    for (const id of path) chainCollapsed.set(id, verdict);
    return verdict;
  };

  return nodes.filter((node) => !isChainCollapsed(node.span.parent_span_id ?? null));
}

// ============================================================================
// Live span-event application
// ============================================================================

/** Payload of the `execution-trace-span` Tauri event. */
export interface TraceSpanEvent {
  execution_id: string;
  span: TraceSpan;
  event_type: string;
}

/** A buffered span event awaiting the initial trace fetch. */
export type BufferedSpanEvent = Pick<TraceSpanEvent, 'span' | 'event_type'>;

/**
 * Apply one live `execution-trace-span` event to a flat span list.
 *
 * Pure and idempotent on `span_id`, which is what lets the same event be
 * replayed out of a buffer over a freshly fetched trace that may already
 * contain it (see `useTraceData`'s fetch-window buffer).
 *
 * Rules:
 *  - `start` for an unknown span appends it.
 *  - `start` for a span already present is a no-op (dedupe).
 *  - `end` for a known span replaces it with the completed record.
 *  - `end` for a span we never saw a `start` for still materialises the span
 *    — dropping it would lose a leaf whose start event was missed (e.g. it
 *    arrived while the listener was still registering).
 *  - Any other `event_type` is ignored.
 *
 * Returns the input array by reference when nothing changed, so callers can
 * use identity to skip a state update.
 */
export function applySpanEvent(
  spans: TraceSpan[],
  span: TraceSpan,
  eventType: string,
): TraceSpan[] {
  if (eventType !== 'start' && eventType !== 'end') return spans;

  const idx = spans.findIndex((s) => s.span_id === span.span_id);
  if (idx === -1) {
    return [...spans, span];
  }
  if (eventType === 'end') {
    const next = [...spans];
    next[idx] = span;
    return next;
  }
  return spans;
}

// ============================================================================
// Span type config
// ============================================================================

/**
 * Colour + fallback-label table for the engine's span vocabulary.
 *
 * The `label` strings here are NOT what the UI renders — `status_tokens.span_type`
 * in the translation catalog is the authority, and `spanTypeLabel()` below is the
 * only sanctioned reader. They survive as the last-resort fallback for a span
 * type the catalog has not caught up with, which is also why the merged
 * `SPAN_TYPE_CONFIG` (which folds in the 18 system-operation entries, still
 * English-only) keeps working unchanged.
 */
const ENGINE_SPAN_CONFIG: Record<SpanType, { label: string; color: string; bg: string; border: string }> = {
  execution:             { label: 'Execution',      color: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25' },
  prompt_assembly:       { label: 'Prompt',          color: 'text-violet-400',  bg: 'bg-violet-500/15',  border: 'border-violet-500/25' },
  credential_resolution: { label: 'Credentials',     color: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/25' },
  cli_spawn:             { label: 'CLI Spawn',       color: 'text-cyan-400',    bg: 'bg-cyan-500/15',    border: 'border-cyan-500/25' },
  tool_call:             { label: 'Tool Call',       color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' },
  protocol_dispatch:     { label: 'Protocol',        color: 'text-pink-400',    bg: 'bg-pink-500/15',    border: 'border-pink-500/25' },
  chain_evaluation:      { label: 'Chain Eval',      color: 'text-orange-400',  bg: 'bg-orange-500/15',  border: 'border-orange-500/25' },
  stream_processing:     { label: 'Stream',          color: 'text-sky-400',     bg: 'bg-sky-500/15',     border: 'border-sky-500/25' },
  outcome_assessment:    { label: 'Outcome',         color: 'text-lime-400',    bg: 'bg-lime-500/15',    border: 'border-lime-500/25' },
  healing_analysis:      { label: 'Healing',         color: 'text-red-400',     bg: 'bg-red-500/15',     border: 'border-red-500/25' },
  pipeline_stage:        { label: 'Pipeline Stage',  color: 'text-teal-400',    bg: 'bg-teal-500/15',    border: 'border-teal-500/25' },
};

/** Merged config covering engine spans and system operations. */
export const SPAN_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ...ENGINE_SPAN_CONFIG,
  ...SYSTEM_OPERATION_CONFIG,
};

const FALLBACK_CONFIG = { label: 'Unknown', color: 'text-gray-400', bg: 'bg-gray-500/15', border: 'border-gray-500/25' };

/** Get config for any span type (engine, pipeline, or system operation). */
export function getSpanTypeConfig(spanType: string): { label: string; color: string; bg: string; border: string } {
  return SPAN_TYPE_CONFIG[spanType] ?? FALLBACK_CONFIG;
}

/**
 * The translated badge label for a span type.
 *
 * Every waterfall row and every error card leads with this badge, so authoring
 * the names beside their colours meant twelve English words rendering
 * identically in all 14 locales on the busiest surface in the app. The names now
 * live in `status_tokens.span_type`; the config table's own `label` is the
 * fallback for anything the catalog does not cover (the system-operation half of
 * `SPAN_TYPE_CONFIG`), and the raw token is the last resort.
 */
export function spanTypeLabel(t: Translations, spanType: string): string {
  const catalog = t.status_tokens.span_type as Record<string, string | undefined>;
  const translated = catalog[spanType];
  if (translated) return translated;
  const cfg = SPAN_TYPE_CONFIG[spanType];
  if (cfg) return cfg.label;
  return catalog.unknown ?? FALLBACK_CONFIG.label;
}

// ============================================================================
// Failure vs. the tracer's own bookkeeping
// ============================================================================

/**
 * The tracer's force-close marker — NOT an engine failure.
 *
 * `TraceCollector::finalize` (`src-tauri/core/src/trace.rs`) stamps this exact
 * string into `span.error` for every span still open when the run ended, which
 * is the ordinary outcome of cancelling a run mid-tool-call. Treating `error`
 * truthiness as "this span failed" therefore inflated the Errors tile and
 * painted red cards reading "span not properly closed" — the tracer's own
 * housekeeping rendered to the user as run errors on the most-consulted
 * diagnostic surface.
 *
 * The string is the contract until the backend carries a typed field (which
 * would need a ts-rs binding regen); keep it byte-identical to the Rust literal.
 */
export const UNCLOSED_SPAN_SENTINEL = 'span not properly closed';

/** True only for a real failure; the force-close sentinel is excluded. */
export function isSpanFailure(span: { error?: string | null }): boolean {
  return !!span.error && span.error !== UNCLOSED_SPAN_SENTINEL;
}

/** True when the tracer force-closed this span at finalize (e.g. a cancelled run). */
export function isSpanUnclosed(span: { error?: string | null }): boolean {
  return span.error === UNCLOSED_SPAN_SENTINEL;
}
