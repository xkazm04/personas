// PROTOTYPE ROUND (spark council-readout), direction B. The small real rose a
// scorecard leads with: the same geometry as `table/svg/Rose` (petal WIDTH =
// the member's weight so the petals close the circle, petal REACH = its
// score), plus what its `mini` form leaves out at this size: each member's
// floor cut across its own petal (dotted while advisory, red when hit) and
// the bar as one ring. A member nobody measured is a hatched petal at full
// reach - absence is never a short petal. A lite round draws hollow.
import { useId } from 'react';

import type { Seat } from '../../../table/runModel';

const TAU = Math.PI * 2;

function point(c: number, r: number, a: number): string {
  return `${(c + Math.cos(a) * r).toFixed(1)} ${(c + Math.sin(a) * r).toFixed(1)}`;
}

function petal(c: number, r: number, from: number, to: number): string {
  return `M${c} ${c}L${point(c, r, from)}A${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${point(c, r, to)}Z`;
}

function arc(c: number, r: number, from: number, to: number): string {
  return `M${point(c, r, from)}A${r} ${r} 0 0 1 ${point(c, r, to)}`;
}

interface Props {
  /** Null while the round is read: the plate and the bar ring only. */
  seats: Seat[] | null;
  threshold: number;
  size: number;
  lite: boolean;
}

export function CardRose({ seats, threshold, size, lite }: Props) {
  const uid = useId().replace(/:/g, '');
  const c = size / 2;
  const R = c - 2;
  const total = seats?.reduce((n, s) => n + s.weight, 0) || 1;
  const big = size > 90;
  let angle = -Math.PI / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="sc-rose">
      <defs>
        <pattern id={`${uid}-nm`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" stroke="var(--muted)" strokeWidth="1.2" />
        </pattern>
      </defs>
      {/* The plate is the full reach, 1.0: a petal touching it scored 1. */}
      <circle
        cx={c}
        cy={c}
        r={R}
        fill="color-mix(in srgb, var(--foreground) 6%, transparent)"
        stroke="color-mix(in srgb, var(--foreground) 22%, transparent)"
      />
      {(seats ?? []).map((seat) => {
        const span = (seat.weight / total) * TAU;
        const from = angle;
        const to = angle + span;
        angle += span;
        const tone = seat.floorHit ? 'var(--status-error)' : 'var(--primary)';
        return (
          <g key={seat.name}>
            {seat.score == null ? (
              <path d={petal(c, R, from, to)} fill={`url(#${uid}-nm)`} stroke="var(--panel)" strokeWidth={2} />
            ) : (
              <path
                d={petal(c, Math.max(3, seat.score * R), from, to)}
                fill={lite ? `color-mix(in srgb, ${tone} 18%, transparent)` : tone}
                stroke={lite ? tone : 'var(--panel)'}
                strokeWidth={lite ? 1.5 : 2}
                strokeDasharray={lite ? '3 2' : undefined}
                strokeLinejoin="round"
              />
            )}
            {seat.floor != null ? (
              <path
                d={arc(c, seat.floor * R, from + 0.06, to - 0.06)}
                fill="none"
                stroke={seat.floorHit ? 'var(--foreground)' : 'var(--panel)'}
                strokeWidth={big ? 3 : 2.2}
                strokeDasharray={seat.advisory ? '2 2.5' : undefined}
                strokeLinecap="round"
              />
            ) : null}
          </g>
        );
      })}
      <circle
        cx={c}
        cy={c}
        r={(threshold * R).toFixed(1)}
        fill="none"
        stroke="var(--foreground)"
        strokeWidth={big ? 2 : 1.6}
        strokeDasharray={seats ? undefined : '3 3'}
      />
    </svg>
  );
}

export default CardRose;
