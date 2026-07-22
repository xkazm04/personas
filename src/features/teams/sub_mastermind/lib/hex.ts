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
