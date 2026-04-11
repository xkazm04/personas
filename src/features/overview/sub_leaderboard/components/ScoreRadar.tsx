/**
 * Pure SVG radar chart for comparing agent score dimensions.
 * Supports 1-2 overlaid entries with labeled axes.
 */

import type { LeaderboardEntry } from '../libs/leaderboardScoring';

interface ScoreRadarProps {
  entries: LeaderboardEntry[];    // 1 or 2 entries to overlay
  size?: number;
}

const AXES = ['Success', 'Health', 'Speed', 'Cost', 'Activity'];
const AXIS_COUNT = AXES.length;
const ANGLE_STEP = (2 * Math.PI) / AXIS_COUNT;
const START_ANGLE = -Math.PI / 2; // start at top

const COLORS = [
  { stroke: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.15)' },
  { stroke: '#06b6d4', fill: 'rgba(6, 182, 212, 0.12)' },
];

function polarToCartesian(cx: number, cy: number, radius: number, angleIndex: number): [number, number] {
  const angle = START_ANGLE + angleIndex * ANGLE_STEP;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function makePolygonPoints(cx: number, cy: number, values: number[], maxRadius: number): string {
  return values
    .map((v, i) => {
      const r = (v / 100) * maxRadius;
      const [x, y] = polarToCartesian(cx, cy, r, i);
      return `${x},${y}`;
    })
    .join(' ');
}

export function ScoreRadar({ entries, size = 200 }: ScoreRadarProps) {
  const cx = size / 2;
  const cy = size / 2;
  const maxRadius = size * 0.38;
  const labelOffset = size * 0.46;
  const gridLevels = [25, 50, 75, 100];

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="select-none"
      data-testid="score-radar"
    >
      {/* Grid circles */}
      {gridLevels.map((level) => (
        <polygon
          key={`grid-${level}`}
          points={Array.from({ length: AXIS_COUNT }, (_, i) => {
            const r = (level / 100) * maxRadius;
            const [x, y] = polarToCartesian(cx, cy, r, i);
            return `${x},${y}`;
          }).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.5"
          className="text-primary/10"
        />
      ))}

      {/* Axis lines */}
      {AXES.map((_, i) => {
        const [x, y] = polarToCartesian(cx, cy, maxRadius, i);
        return (
          <line
            key={`axis-${i}`}
            x1={cx} y1={cy} x2={x} y2={y}
            stroke="currentColor" strokeWidth="0.5"
            className="text-primary/10"
          />
        );
      })}

      {/* Data polygons */}
      {entries.slice(0, 2).map((entry, ei) => {
        const values = entry.dimensions.map((d) => d.value);
        const points = makePolygonPoints(cx, cy, values, maxRadius);
        const color = COLORS[ei]!;
        return (
          <g key={entry.personaId}>
            <polygon points={points} fill={color.fill} stroke={color.stroke} strokeWidth="1.5" />
            {/* Dots at each vertex */}
            {values.map((v, i) => {
              const r = (v / 100) * maxRadius;
              const [x, y] = polarToCartesian(cx, cy, r, i);
              return <circle key={i} cx={x} cy={y} r="3" fill={color.stroke} />;
            })}
          </g>
        );
      })}

      {/* Axis labels */}
      {AXES.map((label, i) => {
        const [x, y] = polarToCartesian(cx, cy, labelOffset, i);
        const textAnchor = x < cx - 5 ? 'end' : x > cx + 5 ? 'start' : 'middle';
        const dy = y < cy - 5 ? '-0.3em' : y > cy + 5 ? '1em' : '0.35em';
        return (
          <text
            key={label}
            x={x} y={y}
            textAnchor={textAnchor}
            dominantBaseline="central"
            dy={dy}
            className="fill-muted-foreground/60 text-[10px]"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}
