// The ring drawn around the light the portrait already carries.
//
// One grammar for all three: the ring's body is what the companion HOLDS
// (Athena herself, one tick per agent for Overseer - lit when starred), the
// beads on it are what waits for you, and a slow turn means its loop runs.
// Colour comes from `--hl-ring`, which `heartlight.css` sets per column and
// per state, so the ring is restyled without touching this file. It is a
// variable rather than `currentColor` because the winner leaves the svg's own
// inherited colour alone and paints the strokes.
import type { RingSpec } from './landingModel';

const R = 40;

/** A circular arc from `a0` to `a1` degrees (0 = twelve o'clock) at radius `r`. */
function arc(a0: number, a1: number, r: number): string {
  const point = (a: number): [number, number] => [
    Math.cos(((a - 90) * Math.PI) / 180) * r,
    Math.sin(((a - 90) * Math.PI) / 180) * r,
  ];
  const [x0, y0] = point(a0);
  const [x1, y1] = point(a1);
  const sweep = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${sweep} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** At most twelve beads are drawn; the exact number stays printed beside the ring. */
const MAX_BEADS = 12;
/** One tick per agent stops being legible long before the ring runs out of room. */
const MAX_TICKS = 60;

function Ticks({ total, lit, glow }: { total: number; lit: number; glow: string }) {
  const n = Math.min(total, MAX_TICKS);
  const span = 360 / n;
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const a = span * i + span * 0.5;
        const isLit = i < lit;
        return (
          <path
            key={i}
            d={arc(a - span * 0.3, a + span * 0.3, R)}
            stroke={isLit ? 'var(--hl-ring)' : 'var(--hl-tick-dim)'}
            strokeWidth={isLit ? 3.4 : 2.2}
            strokeLinecap="round"
            fill="none"
            filter={isLit ? glow : undefined}
          />
        );
      })}
    </>
  );
}

function BrokenRing({ spec }: { spec: Extract<RingSpec, { kind: 'broken' }> }) {
  const n = Math.min(spec.ticks, MAX_TICKS);
  const span = n > 0 ? 312 / n : 0;
  return (
    <>
      <path d={arc(24, 336, R)} fill="none" stroke="var(--hl-cold-ink)" strokeWidth={1.4} strokeDasharray="3 4" opacity={0.75} />
      {Array.from({ length: n }, (_, i) => {
        const a = 24 + span * i + span * 0.5;
        return (
          <path
            key={i}
            d={arc(a - span * 0.28, a + span * 0.28, R + 7)}
            stroke="var(--hl-cold-ink)"
            strokeWidth={3}
            fill="none"
            opacity={0.45}
          />
        );
      })}
      {/* The missing piece sits in the gap: a hollow star (an agent nobody
          starred) or a hollow page (a registry nobody mapped). */}
      {spec.missing === 'star' ? (
        <path
          transform={`translate(0 ${-R}) scale(.9)`}
          d="M0-7 L2 -2.2 7.2-2.2 3-.9 4.6 5 0 1.8 -4.6 5 -3 -.9 -7.2-2.2 -2 -2.2Z"
          fill="none"
          stroke="var(--hl-ink)"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      ) : (
        <rect x={-5} y={-R - 6} width={10} height={12} rx={1.5} fill="none" stroke="var(--hl-ink)" strokeWidth={1.2} />
      )}
    </>
  );
}

export interface HeartRingProps {
  id: string;
  spec: RingSpec;
  /** Beads on the orbit: what waits for you. */
  beads: number;
  /** An active companion's ring glows and haloes; every other one does not. */
  lit: boolean;
}

export function HeartRing({ id, spec, beads, lit }: HeartRingProps) {
  const glowId = `hl-glow-${id}`;
  const haloId = `hl-halo-${id}`;
  const glow = lit ? `url(#${glowId})` : undefined;
  const drawn = Math.min(beads, MAX_BEADS);

  return (
    <svg className="hl-heart" data-role="heart" viewBox="-60 -60 120 120" aria-hidden="true">
      <defs>
        <radialGradient id={haloId}>
          <stop offset="0" style={{ stopColor: 'var(--hl-acc)' }} stopOpacity=".45" />
          <stop offset="1" style={{ stopColor: 'var(--hl-acc)' }} stopOpacity="0" />
        </radialGradient>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {lit && <circle className="hl-halo" r={R + 14} fill={`url(#${haloId})`} />}

      {spec.kind === 'drawing' && (
        <>
          <circle
            className="hl-draw"
            r={R}
            fill="none"
            stroke="var(--hl-ring)"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeDasharray="1.5 7"
            opacity={0.7}
          />
          <circle cx={0} cy={-R} r={2.6} fill="var(--hl-ring)" filter={`url(#${glowId})`} />
        </>
      )}

      {spec.kind === 'broken' && <BrokenRing spec={spec} />}

      {(spec.kind === 'ticks' || spec.kind === 'circle') && (
        <g className="hl-spin">
          {spec.kind === 'ticks' ? (
            <Ticks total={spec.total} lit={spec.lit} glow={glow ?? ''} />
          ) : (
            <circle r={R} fill="none" stroke="var(--hl-ring)" strokeWidth={1.8} filter={glow} />
          )}
        </g>
      )}

      {drawn > 0 && (
        <g className="hl-beads">
          {Array.from({ length: drawn }, (_, i) => {
            const a = ((i * 26 - (drawn - 1) * 13 - 90) * Math.PI) / 180;
            return (
              <circle
                key={i}
                cx={(Math.cos(a) * (R + 12)).toFixed(2)}
                cy={(Math.sin(a) * (R + 12)).toFixed(2)}
                r={3.4}
                fill="var(--hl-bead)"
                stroke="var(--hl-acc)"
                strokeWidth={1.6}
                filter={glow}
              />
            );
          })}
        </g>
      )}
    </svg>
  );
}
