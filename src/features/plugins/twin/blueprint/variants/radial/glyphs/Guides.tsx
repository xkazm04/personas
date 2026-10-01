/**
 * The anatomy plate's construction lines: hairline circles at the ring's
 * boundaries, dashed separators between the quadrants, and a fine degree
 * scale just outside the figure. Drawn under every mark, at the faintest line
 * weight, so the quantities read first.
 */
import { RING, polar, spokePath } from '../radialGeometry';

const SCALE_STEP = 5;

interface GuidesProps {
  cx: number;
  cy: number;
  R: number;
  /** Hairline circles as fractions of R (default: the anatomy ring's boundaries). */
  circles?: readonly number[];
  /** Dashed quadrant separators (L1 and stage only: L2 is one section). */
  axes?: boolean;
}

export function Guides({ cx, cy, R, circles = [RING.main0, RING.main1, RING.band0, RING.band1], axes = true }: GuidesProps) {
  const scale0 = R + Math.max(5, R * 0.025);
  const scale1 = scale0 + Math.max(3, R * 0.012);
  return (
    <g className="rd-guides" aria-hidden>
      {circles.map((f) => (
        <circle key={f} className="rd-guide" cx={cx} cy={cy} r={f * R} />
      ))}
      {axes && [0, 90, 180, 270].map((deg) => (
        <path key={deg} className="rd-guide-axis" d={spokePath(cx, cy, RING.ready1 * R + 4, scale1 + 6, deg)} />
      ))}
      {Array.from({ length: 360 / SCALE_STEP }, (_, k) => {
        const deg = k * SCALE_STEP;
        if (axes && deg % 90 === 0) return null;
        const a = polar(cx, cy, scale0, deg);
        const b = polar(cx, cy, deg % 15 === 0 ? scale1 + 2 : scale1, deg);
        return <line key={deg} className="rd-guide-tick" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
      })}
    </g>
  );
}
