import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import { formatDuration } from '@/lib/utils/formatters';
import { SPAN_TYPE_CONFIG } from './traceInspectorTypes';

export function WaterfallBar({ span, totalMs }: { span: TraceSpan; totalMs: number }) {
  if (!totalMs || totalMs === 0) return null;

  const leftPct = (span.start_ms / totalMs) * 100;
  const widthPct = span.duration_ms != null
    ? Math.max((span.duration_ms / totalMs) * 100, 0.5)
    : Math.max(((totalMs - span.start_ms) / totalMs) * 100, 0.5);

  const config = SPAN_TYPE_CONFIG[span.span_type];

  return (
    <div className="relative h-5 w-full">
      {/* Track */}
      <div className="absolute inset-0 bg-primary/5 rounded" />
      {/* Bar */}
      <div
        className={`absolute top-0.5 bottom-0.5 rounded ${span.error ? 'bg-red-500/40' : config.bg} transition-all`}
        style={{
          left: `${leftPct}%`,
          width: `${widthPct}%`,
          minWidth: '2px',
        }}
      />
      {/* Duration label */}
      {span.duration_ms != null && (
        <span
          className="absolute top-0 typo-code text-muted-foreground/60 leading-5 whitespace-nowrap"
          style={{ left: `${Math.min(leftPct + widthPct + 0.5, 85)}%` }}
        >
          {formatDuration(span.duration_ms)}
        </span>
      )}
    </div>
  );
}
