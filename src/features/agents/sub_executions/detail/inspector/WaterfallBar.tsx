import type { UnifiedSpan } from '@/lib/execution/pipeline';
import { formatDuration } from '@/lib/utils/formatters';
import { getSpanTypeConfig } from './traceInspectorTypes';

/** Minimum visible bar width, in percent of the track. */
const MIN_WIDTH_PCT = 0.5;

/**
 * Track geometry for one span, clamped to the track.
 *
 * Pipeline spans and backend engine spans are timestamped by different clocks,
 * so skew (or a span that outlives the reported total) can produce a start past
 * 100% or a start+width beyond the track, which paints a bar spilling out of
 * its row. Clamp both ends: left into [0, 100 - MIN_WIDTH_PCT], width into
 * [MIN_WIDTH_PCT, 100 - left].
 */
export function waterfallGeometry(
  startMs: number,
  durationMs: number | null | undefined,
  totalMs: number,
): { leftPct: number; widthPct: number } {
  const rawLeft = (startMs / totalMs) * 100;
  const leftPct = Math.min(Math.max(rawLeft, 0), 100 - MIN_WIDTH_PCT);

  const rawWidth = durationMs != null
    ? (durationMs / totalMs) * 100
    : ((totalMs - startMs) / totalMs) * 100;
  const widthPct = Math.min(Math.max(rawWidth, MIN_WIDTH_PCT), 100 - leftPct);

  return { leftPct, widthPct };
}

export function WaterfallBar({ span, totalMs }: { span: UnifiedSpan; totalMs: number }) {
  if (!totalMs || totalMs === 0) return null;

  const { leftPct, widthPct } = waterfallGeometry(span.start_ms, span.duration_ms, totalMs);

  const config = getSpanTypeConfig(span.span_type);

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
          className="absolute top-0 typo-code text-foreground leading-5 whitespace-nowrap"
          style={{ left: `${Math.min(leftPct + widthPct + 0.5, 85)}%` }}
        >
          {formatDuration(span.duration_ms)}
        </span>
      )}
    </div>
  );
}
