import { memo, useCallback } from 'react';
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { getSpanTypeConfig } from './traceInspectorTypes';
import type { SpanNode } from './traceInspectorTypes';
import { WaterfallBar } from './WaterfallBar';
import { Numeric } from '@/features/shared/components/display/Numeric';

interface SpanRowProps {
  node: SpanNode;
  totalMs: number;
  expanded: boolean;
  /** Stable across renders -- takes the span id so the parent needs no per-row closure. */
  onToggle: (spanId: string) => void;
  hasChildren: boolean;
}

function SpanRowImpl({ node, totalMs, expanded, onToggle, hasChildren }: SpanRowProps) {
  const { span, depth } = node;
  const config = getSpanTypeConfig(span.span_type);
  const handleToggle = useCallback(() => onToggle(span.span_id), [onToggle, span.span_id]);

  return (
    <div
      className={`group grid grid-cols-[minmax(200px,1fr)_minmax(200px,2fr)] gap-2 items-center px-2 py-1 hover:bg-secondary/30 rounded transition-colors ${
        span.error ? 'bg-red-500/5' : ''
      }`}
    >
      {/* Left: name + type badge */}
      <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: `${depth * 16}px` }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={handleToggle}
            aria-expanded={expanded}
            /* The span name is system/user data, not UI copy -- combined with
               aria-expanded a screen reader announces "<name>, button,
               collapsed/expanded", so no translated string is needed. */
            aria-label={span.name}
            className="p-0.5 rounded hover:bg-primary/10 flex-shrink-0"
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3 text-foreground" />
            ) : (
              <ChevronRight className="w-3 h-3 text-foreground" />
            )}
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}

        <span className={`inline-flex px-1.5 py-0.5 typo-code uppercase rounded border ${config.bg} ${config.color} ${config.border} flex-shrink-0`}>
          {config.label}
        </span>

        <span className="typo-code text-foreground/85 truncate" title={span.name}>
          {span.name}
        </span>

        {span.error && (
          <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
        )}

        {/* A missing cost and a free step are different facts. `cost_usd > 0`
            hid both, so a genuinely $0.0000 step looked identical to one the
            tracer never priced. Only null means "unknown" — and unknown prints
            nothing rather than a column of em-dashes, because today the tracer
            attributes cost to the root span alone (every `end_span` call in
            src-tauri/src/engine/runner/mod.rs passes `None`), so all but one
            row would carry a placeholder. */}
        {span.cost_usd != null && (
          <span className="typo-code text-amber-400/70 flex-shrink-0">
            $<Numeric value={span.cost_usd} precision={4} />
          </span>
        )}
      </div>

      {/* Right: waterfall bar */}
      <WaterfallBar span={span} totalMs={totalMs} />
    </div>
  );
}

/**
 * Every live span event rebuilds the unified trace, so `node` and `node.span`
 * are always fresh object references -- a reference-equality memo would never
 * hit. Compare the fields the row actually renders instead; a growing trace
 * then only re-renders the rows whose own data moved.
 */
function propsEqual(a: SpanRowProps, b: SpanRowProps): boolean {
  if (
    a.totalMs !== b.totalMs ||
    a.expanded !== b.expanded ||
    a.hasChildren !== b.hasChildren ||
    a.onToggle !== b.onToggle ||
    a.node.depth !== b.node.depth
  ) {
    return false;
  }
  const x = a.node.span;
  const y = b.node.span;
  return (
    x.span_id === y.span_id &&
    x.name === y.name &&
    x.span_type === y.span_type &&
    x.start_ms === y.start_ms &&
    x.end_ms === y.end_ms &&
    x.duration_ms === y.duration_ms &&
    x.cost_usd === y.cost_usd &&
    x.error === y.error
  );
}

export const SpanRow = memo(SpanRowImpl, propsEqual);
