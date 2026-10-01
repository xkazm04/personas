/**
 * The overflow chevron's geometry: an arrowhead at a polar position pointing
 * outward (`out`) or along the arc, clockwise (`cw`). Pure; drawn by
 * `Chevrons` in primitives.tsx.
 */
import { polar } from '../radialGeometry';

/** Degrees one pixel of arc spans at radius `r`. */
export const DEG_PER_PX = (r: number) => (r > 0 ? 180 / (Math.PI * r) : 0);

const f = (n: number) => Math.round(n * 100) / 100;

export function chevronPath(cx: number, cy: number, r: number, deg: number, size: number, dir: 'out' | 'cw'): string {
  const half = size / 2;
  const dDeg = half * DEG_PER_PX(r);
  const [tip, armA, armB] =
    dir === 'out'
      ? [polar(cx, cy, r + half, deg), polar(cx, cy, r - half, deg - dDeg), polar(cx, cy, r - half, deg + dDeg)]
      : [polar(cx, cy, r, deg + dDeg), polar(cx, cy, r - half, deg - dDeg), polar(cx, cy, r + half, deg - dDeg)];
  return `M${f(armA.x)} ${f(armA.y)} L${f(tip.x)} ${f(tip.y)} L${f(armB.x)} ${f(armB.y)}`;
}
