import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { getSpanTypeConfig } from './traceInspectorTypes';
import type { SpanNode } from './traceInspectorTypes';
import { WaterfallBar } from './WaterfallBar';

export function SpanRow({
  node,
  totalMs,
  expanded,
  onToggle,
  hasChildren,
}: {
  node: SpanNode;
  totalMs: number;
  expanded: boolean;
  onToggle: () => void;
  hasChildren: boolean;
}) {
  const { span, depth } = node;
  const config = getSpanTypeConfig(span.span_type);

  return (
    <div
      className={`group grid grid-cols-[minmax(200px,1fr)_minmax(200px,2fr)] gap-2 items-center px-2 py-1 hover:bg-secondary/30 rounded transition-colors ${
        span.error ? 'bg-red-500/5' : ''
      }`}
    >
      {/* Left: name + type badge */}
      <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: `${depth * 16}px` }}>
        {hasChildren ? (
          <button onClick={onToggle} className="p-0.5 rounded hover:bg-primary/10 flex-shrink-0">
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

        {span.cost_usd != null && span.cost_usd > 0 && (
          <span className="typo-code text-amber-400/70 flex-shrink-0">
            ${span.cost_usd.toFixed(4)}
          </span>
        )}
      </div>

      {/* Right: waterfall bar */}
      <WaterfallBar span={span} totalMs={totalMs} />
    </div>
  );
}
