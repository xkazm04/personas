/**
 * Pure SVG radar chart for comparing agent score dimensions.
 * Supports 1-2 overlaid entries with labeled axes.
 */

import type { LeaderboardEntry } from '../libs/leaderboardScoring';

interface ScoreRadarProps {
  entries: LeaderboardEntry[];    // 1 or 2 entries to overlay
  size?: number;
  /** Optional fleet-average reference, drawn as a dashed neutral polygon
   *  behind the data so a single agent can be read against the fleet. Must be
   *  aligned to the AXES order (success, health, speed, cost, activity). */
  benchmarkValues?: number[] | null;
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

export function ScoreRadar({ entries, size = 200, benchmarkValues }: ScoreRadarProps) {
  const cx = size / 2;
  const cy = size / 2;
  const maxRadius = size * 0.38;
  const labelOffset = size * 0.46;
  const gridLevels = [25, 50, 75, 100];
  // Axis labels sit just outside the chart radius and were being clipped by a
  // tight `0 0 size size` viewBox (most visible in the single-persona view,
  // where "Success" / "Activity" ran off the edge). Pad the viewBox
  // symmetrically so every label has room; width/height stay `size` so the
  // rendered footprint is unchanged for all callers.
  const pad = size * 0.18;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-pad} ${-pad} ${size + pad * 2} ${size + pad * 2}`}
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

      {/* Fleet-average reference (dashed, behind the data) */}
      {benchmarkValues && benchmarkValues.length === AXIS_COUNT && (
        <polygon
          points={makePolygonPoints(cx, cy, benchmarkValues, maxRadius)}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 3"
          className="text-foreground/40"
        />
      )}

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

      {/* Axis labels — promoted from 10px low-contrast to 11px on the
          high-contrast foreground token for legibility on small panels. */}
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
            className="fill-foreground text-[11px] font-medium"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}
