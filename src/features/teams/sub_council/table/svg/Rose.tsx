// The rose: the whole council in one figure.
//
//   wedge WIDTH  = the member's weight (the wedges close the circle)
//   wedge REACH  = its score
//   the ring     = the admitting threshold
//   an arc       = its floor, dotted when the floor is only advisory
//   striped      = carried from an earlier round, not re-measured
//   hatched at FULL reach = NOT MEASURED - absence is never a low score
//
// Ported from `docs/design/council-reference/index.html` `rose()`. Pure: it
// takes seats and draws; it fetches nothing and holds no state.
import { useId } from 'react';

import type { Seat } from '../runModel';

const TAU = Math.PI * 2;

export interface RoseProps {
  seats: Seat[];
  /** The admitting overall, drawn as the ring. */
  threshold: number;
  /** Null draws "no overall" in the hub rather than a zero. */
  overall: number | null;
  size: number;
  /** The seat under the reader right now; null dims nothing. */
  selectedIndex?: number | null;
  /** The 54 px queue-row form: no labels, no hub, no floor arcs. */
  mini?: boolean;
  /** Read by the seat tabs; the mini form is decorative and passes nothing. */
  onSelectSeat?: (index: number) => void;
  label: string;
  notMeasuredLabel: string;
  noOverallLabel: string;
  overallLabel: string;
}

function wedgePath(c: number, radius: number, from: number, to: number): string {
  const x0 = c + Math.cos(from) * radius;
  const y0 = c + Math.sin(from) * radius;
  const x1 = c + Math.cos(to) * radius;
  const y1 = c + Math.sin(to) * radius;
  const big = to - from > Math.PI ? 1 : 0;
  return `M${c} ${c}L${x0.toFixed(1)} ${y0.toFixed(1)}A${radius} ${radius} 0 ${big} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}Z`;
}

function arcPath(c: number, radius: number, from: number, to: number): string {
  const x0 = (c + Math.cos(from) * radius).toFixed(1);
  const y0 = (c + Math.sin(from) * radius).toFixed(1);
  const x1 = (c + Math.cos(to) * radius).toFixed(1);
  const y1 = (c + Math.sin(to) * radius).toFixed(1);
  return `M${x0} ${y0}A${radius} ${radius} 0 0 1 ${x1} ${y1}`;
}

export function Rose({
  seats,
  threshold,
  overall,
  size,
  selectedIndex = null,
  mini = false,
  onSelectSeat,
  label,
  notMeasuredLabel,
  noOverallLabel,
  overallLabel,
}: RoseProps) {
  const uid = useId().replace(/:/g, '');
  const c = size / 2;
  const R = mini ? c - 3 : c - Math.max(52, Math.round(size * 0.21));
  const weighted = seats.reduce((n, s) => n + s.weight, 0) || 1;

  let angle = -Math.PI / 2;
  const drawn = seats.map((seat, i) => {
    const span = (seat.weight / weighted) * TAU;
    const from = angle + 0.02;
    const to = angle + span - 0.02;
    const mid = angle + span / 2;
    angle += span;
    return { seat, i, from, to, mid, on: selectedIndex === i };
  });

  const hubR = size > 300 ? 46 : 34;
  // Same reason as the wedge labels: an SVG `<text>` cannot host a span.
  const overallText = overall == null ? '' : overall.toFixed(2);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      style={{ overflow: 'visible', color: 'var(--foreground)' }}
      className="flex-none max-w-full"
    >
      <defs>
        <pattern
          id={`${uid}-nm`}
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--muted-dark)" strokeWidth="2" strokeOpacity="0.55" />
        </pattern>
        <pattern
          id={`${uid}-carried`}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="8" height="8" fill="var(--primary)" fillOpacity="0.25" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="var(--primary)" strokeWidth="3" />
        </pattern>
      </defs>

      <circle cx={c} cy={c} r={R} fill="var(--card-bg)" stroke="var(--border)" />

      {drawn.map(({ seat, i, from, to, mid, on }) => (
        <g key={seat.name}>
          {seat.score == null ? (
            <path
              d={wedgePath(c, R, from, to)}
              fill={`url(#${uid}-nm)`}
              stroke="var(--muted-dark)"
              strokeDasharray="4 4"
              strokeWidth={on ? 2.5 : 1}
              className="cursor-pointer"
              onClick={onSelectSeat ? () => onSelectSeat(i) : undefined}
            />
          ) : (
            <path
              d={wedgePath(c, Math.max(4, seat.score * R), from, to)}
              fill={
                seat.state === 'carried'
                  ? `url(#${uid}-carried)`
                  : seat.floorHit
                    ? 'var(--status-error)'
                    : 'var(--primary)'
              }
              fillOpacity={selectedIndex == null || on ? 0.92 : 0.5}
              stroke={on ? 'var(--foreground)' : 'var(--background)'}
              strokeWidth={on ? 2.5 : 1.2}
              className="cursor-pointer"
              onClick={onSelectSeat ? () => onSelectSeat(i) : undefined}
            />
          )}
          {seat.floor != null && !mini ? (
            <path
              d={arcPath(c, seat.floor * R, from, to)}
              fill="none"
              stroke={seat.advisory ? 'var(--muted)' : 'var(--status-error)'}
              strokeWidth="2.5"
              strokeDasharray={seat.advisory ? '2 4' : undefined}
            />
          ) : null}
          {!mini ? (
            <RoseLabel
              c={c}
              R={R}
              mid={mid}
              name={seat.name}
              score={seat.score}
              on={on}
              notMeasuredLabel={notMeasuredLabel}
            />
          ) : null}
        </g>
      ))}

      <circle
        cx={c}
        cy={c}
        r={Number((threshold * R).toFixed(1))}
        fill="none"
        stroke="var(--foreground)"
        strokeWidth={mini ? 1.2 : 2}
      />

      {!mini ? (
        <>
          <circle cx={c} cy={c} r={hubR} fill="var(--background)" stroke="var(--border)" />
          <text
            x={c}
            y={c + (overall == null ? 4 : 2)}
            textAnchor="middle"
            fontSize={overall == null ? 13 : size > 300 ? 30 : 22}
            fontWeight={800}
            fill={overall == null ? 'var(--muted-dark)' : 'currentColor'}
          >
            {overall == null ? noOverallLabel : overallText}
          </text>
          {overall != null && size > 300 ? (
            <text x={c} y={c + 21} textAnchor="middle" fontSize={13} fill="var(--muted-dark)">
              {overallLabel}
            </text>
          ) : null}
        </>
      ) : null}
    </svg>
  );
}

function RoseLabel({
  c,
  R,
  mid,
  name,
  score,
  on,
  notMeasuredLabel,
}: {
  c: number;
  R: number;
  mid: number;
  name: string;
  score: number | null;
  on: boolean;
  notMeasuredLabel: string;
}) {
  // Formatted outside the JSX: `<Numeric>` renders a span, which an SVG
  // `<text>` cannot host, so the figure is prepared here instead.
  const scoreText = score == null ? '' : score.toFixed(2);
  const lx = c + Math.cos(mid) * (R + 14);
  const ly = c + Math.sin(mid) * (R + 14);
  const anchor = Math.cos(mid) > 0.3 ? 'start' : Math.cos(mid) < -0.3 ? 'end' : 'middle';
  const dy = Math.sin(mid) > 0.5 ? 15 : Math.sin(mid) < -0.5 ? -18 : 0;
  return (
    <>
      <text
        x={lx.toFixed(1)}
        y={(ly + dy).toFixed(1)}
        textAnchor={anchor}
        fontSize={15}
        fontWeight={on ? 800 : 660}
        fill="currentColor"
        style={{ textTransform: 'capitalize' }}
      >
        {name}
      </text>
      <text
        x={lx.toFixed(1)}
        y={(ly + dy + 20).toFixed(1)}
        textAnchor={anchor}
        fontSize={score == null ? 13 : 18}
        fontWeight={800}
        fill={score == null ? 'var(--muted-dark)' : 'currentColor'}
      >
        {score == null ? notMeasuredLabel : scoreText}
      </text>
    </>
  );
}

export default Rose;
