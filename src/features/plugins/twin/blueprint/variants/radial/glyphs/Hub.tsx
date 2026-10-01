/**
 * The centre of the anatomy: a neutral disc carrying the twin's initial (its
 * sigil), ringed by readiness on the declared 0..100 domain. The initial takes
 * the largest type token the disc holds and is dropped, never shrunk below a
 * token, when the disc is too small for one.
 */
import { ShareArc, type RadialIds } from './primitives';
import { RING } from '../radialGeometry';

interface HubProps {
  cx: number;
  cy: number;
  R: number;
  initial: string;
  /** 0..100. */
  readiness: number;
  ids: RadialIds;
}

/**
 * The largest type token whose capital fits a disc of at least `minR` px: a
 * hero capital needs ~40 px of radius, a heading capital ~15. Below the last
 * row the initial is dropped, never set in a size off the type scale.
 */
const INITIAL_TOKENS: ReadonlyArray<{ minR: number; token: string }> = [
  { minR: 40, token: 'typo-hero' },
  { minR: 15, token: 'typo-heading' },
];

export function Hub({ cx, cy, R, initial, readiness, ids }: HubProps) {
  const r = RING.hub * R;
  const token = INITIAL_TOKENS.find((t) => r >= t.minR)?.token ?? null;
  return (
    <g className="rd-hub" data-testid="radial-hub">
      <circle className="rd-hub-disc" cx={cx} cy={cy} r={r} />
      <circle className="rd-hub-inner" cx={cx} cy={cy} r={Math.max(1, r - 5)} />
      {token && initial && (
        <text className={`rd-hub-initial ${token}`} x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
          {initial}
        </text>
      )}
      <ShareArc
        band={{ cx, cy, r0: RING.ready0 * R, r1: RING.ready1 * R, a0: 0, a1: 360 }}
        value={readiness}
        fullAt={100}
        ids={ids}
        testId="radial-readiness"
      />
    </g>
  );
}
