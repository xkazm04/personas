// Hex + placement geometry for the Mastermind canvas. Pure math, no React.

const D2R = Math.PI / 180;

/** SVG points string for a regular hexagon centred at (cx, cy).
 *  Pointy-top by default; `flat` rotates to flat-top; `rotate` adds degrees. */
export function hexPoints(cx: number, cy: number, r: number, flat = false, rotate = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * 60 + (flat ? 0 : 30) + rotate) * D2R;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** Positions for n satellite nodes around a core: the first 6 on ring 1
 *  (hex-neighbour spokes, starting at 12 o'clock), overflow on ring 2 between
 *  the ring-1 spokes so clusters never overlap. */
export function satellitePositions(n: number, r1: number, r2: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < Math.min(6, n); k++) {
    const a = (-90 + k * 60) * D2R;
    out.push({ x: r1 * Math.cos(a), y: r1 * Math.sin(a) });
  }
  for (let k = 0; k < n - 6; k++) {
    const a = (-60 + k * 120) * D2R;
    out.push({ x: r2 * Math.cos(a), y: r2 * Math.sin(a) });
  }
  return out;
}

/** Deterministic 0..1 hash of a string — stable per-slug jitter/rotation. */
export function hash01(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

/** Sunflower-spiral placement: island i on a golden-angle spiral with per-slug
 *  jitter — deterministic, collision-free at SPACING, organically uneven. */
export function spiralPlace(i: number, slug: string, spacing = 560): { x: number; y: number } {
  if (i === 0) return { x: 0, y: 0 };
  const r = spacing * Math.sqrt(i) * 0.82;
  const a = i * 2.39996 + (hash01(slug) - 0.5) * 0.6;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}
