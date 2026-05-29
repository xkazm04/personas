import { scoreTone, sparklinePoints } from './directorScore';

/**
 * Inline SVG sparkline for a 0–5 Director-score series, anchored to the fixed
 * 0–5 range (see directorScore). Colored by the latest score's tone, with a
 * trailing dot. Requires `scores.length >= 2`. No charting library.
 */
export function ScoreSparkline({
  scores,
  width = 56,
  height = 16,
  pad = 1.5,
  className,
}: {
  scores: number[];
  width?: number;
  height?: number;
  pad?: number;
  className?: string;
}) {
  if (scores.length < 2) return null;
  const { points, lastX, lastY } = sparklinePoints(scores, width, height, pad);
  const tone = scoreTone(scores[scores.length - 1]!);
  return (
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
}
