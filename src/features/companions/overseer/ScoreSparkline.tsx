import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { scoreTone, sparklinePoints } from './directorScore';

/**
 * Inline SVG sparkline for a 0–5 Director-score series, anchored to the fixed
 * 0–5 range (see directorScore). Colored by the latest score's tone, with a
 * trailing dot. Requires `scores.length >= 2`. No charting library. Pass
 * `tooltip` to wrap it in a hover tooltip (e.g. the readable score series) — the
 * line shows the shape, the tooltip shows the actual numbers.
 */
export function ScoreSparkline({
  scores,
  width = 56,
  height = 16,
  pad = 1.5,
  className,
  tooltip,
}: {
  scores: number[];
  width?: number;
  height?: number;
  pad?: number;
  className?: string;
  tooltip?: string;
}) {
  if (scores.length < 2) return null;
  const { points, lastX, lastY } = sparklinePoints(scores, width, height, pad);
  const tone = scoreTone(scores[scores.length - 1]!);
  const svg = (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`inline-block align-middle flex-shrink-0 ${className ?? ''}`}
      data-testid="verdict-trend-sparkline"
    >
      {/* faint baseline at score 0 */}
      <line x1={0} y1={height - pad} x2={width} y2={height - pad} stroke="var(--border)" strokeWidth="0.5" />
      <polyline
        points={points}
        fill="none"
        stroke={tone.color}
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r="1.6" fill={tone.color} />
    </svg>
  );
  return tooltip ? <Tooltip content={tooltip}>{svg}</Tooltip> : svg;
}
