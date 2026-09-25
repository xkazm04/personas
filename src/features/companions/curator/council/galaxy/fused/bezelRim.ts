// The bezel's rim and what sits on it: the lit glass edge with its compass
// ticks, the amber blips where waiting decisions lie, and the pick that turns
// a pointer on the rim into an arc (radius picks the band, angle the arc).
// Split from `bezelPaint.ts`; the numbers are the winner's.
import type { DialIndex, DialMotion, DialNode } from './bezelDial';
import type { BezelScene } from './bezelPaint';
import type { InstrumentColors } from './tokenColors';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export function bandRadii(s: Pick<BezelScene, 'rg' | 'sc' | 'thick'>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let at = s.rg + 7 * s.sc;
  for (let i = 0; i < 4; i += 1) {
    const t = s.thick[i] ?? 8;
    out.push([at, at + t]);
    at += t + 4 * s.sc;
  }
  return out;
}

export function paintRim(g: CanvasRenderingContext2D, s: BezelScene, _ro: number, col: InstrumentColors): void {
  const { cx, cy, rg, sc } = s;
  const L = col.light;
  const ig = g.createRadialGradient(cx, cy, Math.max(0, rg - 30 * sc), cx, cy, rg);
  ig.addColorStop(0, 'rgba(0,0,0,0)');
  ig.addColorStop(1, L ? 'rgba(14,116,144,0.07)' : 'rgba(34,211,238,0.07)');
  g.fillStyle = ig;
  g.beginPath();
  g.arc(cx, cy, rg, 0, TAU);
  g.fill();
  const rim = g.createConicGradient(-Math.PI / 2, cx, cy);
  rim.addColorStop(0, col.accent);
  rim.addColorStop(0.5, col.purple);
  rim.addColorStop(1, col.accent);
  g.strokeStyle = rim;
  g.lineWidth = 1.5;
  g.globalAlpha = L ? 0.6 : 0.75;
  if (!L) {
    g.shadowColor = col.accent;
    g.shadowBlur = 12;
  }
  g.beginPath();
  g.arc(cx, cy, rg, 0, TAU);
  g.stroke();
  g.shadowBlur = 0;
  g.globalAlpha = 1;
  g.strokeStyle = L ? col.fg : col.star;
  g.lineWidth = 1;
  for (let d = 0; d < 360; d += 10) {
    const a = d * DEG;
    const l = (d % 90 === 0 ? 9 : 4) * Math.max(0.7, sc);
    g.globalAlpha = d % 90 === 0 ? 0.45 : 0.2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (rg - l), cy + Math.sin(a) * (rg - l));
    g.lineTo(cx + Math.cos(a) * rg, cy + Math.sin(a) * rg);
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** Where the decisions waiting on the person lie on the dial: static at rest. */
export function paintBlips(g: CanvasRenderingContext2D, s: BezelScene, ro: number, ix: DialIndex, dial: DialMotion, col: InstrumentColors): void {
  const { cx, cy, sc } = s;
  const rOut = ro + 7 * sc;
  if (!col.light) {
    g.shadowColor = col.warn;
    g.shadowBlur = 8;
  }
  for (const st of s.waiting) {
    const sp = ix.span.get(st);
    if (!sp) continue;
    const a = (dial.angle(sp[0]) + dial.sweep(sp) / 2) * DEG;
    g.fillStyle = col.warn;
    g.globalAlpha = 0.95;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
    g.lineTo(cx + Math.cos(a - 0.018) * (rOut + 10 * sc), cy + Math.sin(a - 0.018) * (rOut + 10 * sc));
    g.lineTo(cx + Math.cos(a + 0.018) * (rOut + 10 * sc), cy + Math.sin(a + 0.018) * (rOut + 10 * sc));
    g.closePath();
    g.fill();
    g.globalAlpha = 0.4;
    g.strokeStyle = col.warn;
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(cx + Math.cos(a) * (rOut + 5), cy + Math.sin(a) * (rOut + 5), 6, 0, TAU);
    g.stroke();
  }
  g.shadowBlur = 0;
  g.globalAlpha = 1;
}

/** Radius picks the band, angle picks the arc. Null inside the glass. */
export function pickArc(x: number, y: number, s: BezelScene, ix: DialIndex, dial: DialMotion): DialNode | null {
  const d = Math.hypot(x - s.cx, y - s.cy);
  if (d < s.rg + 3) return null;
  const radii = bandRadii(s);
  let b = -1;
  radii.forEach(([r0, r1], i) => {
    if (d >= r0 - 2 && d <= r1 + 2) b = i;
  });
  if (b < 0) return null;
  const a = Math.atan2(y - s.cy, x - s.cx) / DEG;
  for (const n of ix.bands[b] as DialNode[]) {
    const sp = ix.span.get(n);
    if (!sp) continue;
    const a0 = dial.angle(sp[0]);
    const a1 = a0 + dial.sweep(sp);
    if (a1 - a0 < 1e-4) continue;
    let t = a;
    while (t < a0) t += 360;
    while (t > a0 + 360) t -= 360;
    if (t >= a0 && t <= a1) return n;
  }
  return null;
}
