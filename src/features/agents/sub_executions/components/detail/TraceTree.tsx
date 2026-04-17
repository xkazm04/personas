import type { UnifiedSpan } from '@/lib/execution/pipeline';
import { formatDuration } from '@/lib/utils/formatters';
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { getSpanConfig, type SpanNode } from '../../libs/traceHelpers';

// Waterfall bar component

function WaterfallBar({ span, totalMs }: { span: UnifiedSpan; totalMs: number }) {
  if (!totalMs || totalMs === 0) return null;

  const leftPct = (span.start_ms / totalMs) * 100;
  const widthPct = span.duration_ms != null
    ? Math.max((span.duration_ms / totalMs) * 100, 0.5)
    : Math.max(((totalMs - span.start_ms) / totalMs) * 100, 0.5);

  const config = getSpanConfig(span.span_type);

  return (
    <div className="relative h-5 w-full">
      <div className="absolute inset-0 bg-primary/5 rounded" />
      <div
        className={`absolute top-0.5 bottom-0.5 rounded ${span.error ? 'bg-red-500/40' : config.bg} transition-all`}
        style={{
          left: `${leftPct}%`,
          width: `${widthPct}%`,
          minWidth: '2px',
        }}
      />
      {span.duration_ms != null && (
        <span
          className="absolute top-0 typo-code text-foreground leading-5 whitespace-nowrap"
          style={{ left: `${Math.min(leftPct + widthPct + 0.5, 85)}%` }}
        >
          {formatDuration(span.duration_ms)}
        </span>
      )}
    </div>
  );
}

// Span row component

interface SpanRowProps {
  node: SpanNode;
  totalMs: number;
  expanded: boolean;
  onToggle: () => void;
  hasChildren: boolean;
}

export function SpanRow({
  node,
  totalMs,
  expanded,
  onToggle,
  hasChildren,
}: SpanRowProps) {
  const { span, depth } = node;
  const config = getSpanConfig(span.span_type);

  return (
    <div
      className={`group grid grid-cols-[minmax(200px,1fr)_minmax(200px,2fr)] gap-2 items-center px-2 py-1 hover:bg-secondary/30 rounded transition-colors ${
        span.error ? 'bg-red-500/5' : ''
      }`}
    >
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

      <WaterfallBar span={span} totalMs={totalMs} />
    </div>
  );
}
