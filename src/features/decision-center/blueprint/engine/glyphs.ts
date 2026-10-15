// The drawing's marks (PORTED from bp src/engine/render/glyphs.ts and lens-glyph.ts, with the prototype's
// approved-not-built pennant): lens glyphs by NAME or by a custom 16x16 path, pennants, clouds, stage fills and
// strokes, and the two bars (stage, health). Colour only through the theme.
import type { GlyphName } from '../standard/types';
import type { Counts, HealthCounts } from '../model/aggregates';
import type { CanvasTheme } from './theme';

/** The glyph a manifest asked for: a shared name, a custom path, or null (drawn as a small ring). */
export type GlyphSpec = GlyphName | { path: string } | null;

// A custom glyph is an SVG path in a 16x16 box from a manifest: untrusted input. It was checked at load
// (path commands and numbers only, at most 2048 characters) and is only ever parsed by Path2D.
const PATHS = new Map<string, Path2D | null>();
function customPath(d: string): Path2D | null {
  let p = PATHS.get(d);
  if (p === undefined) {
    try { p = d.length <= 2048 ? new Path2D(d) : null; } catch { p = null; }
    PATHS.set(d, p);
  }
  return p;
}

const TAU = 6.2832;

/** One lens glyph in the square (x, y, s). `lwMax` caps the stroke (1.8 for the strip; the large trouble flags pass more). */
export function glyph(ctx: CanvasRenderingContext2D, g: GlyphSpec, x: number, y: number, s: number, col: string, lwMax = 1.8): void {
  const lw = s < 9 ? 1.1 : Math.min(lwMax, s * 0.13);
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (g === null || typeof g === 'object') {
    const p = g ? customPath(g.path) : null;
    if (p) { const k = s / 16; ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.lineWidth = lw / k; ctx.stroke(p); ctx.restore(); }
    else { ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.36, 0, TAU); ctx.stroke(); }
    ctx.lineCap = 'butt';
    return;
  }
  ctx.beginPath();
  switch (g) {
    case 'bars': {
      const bw = s * 0.24, gap = (s - bw * 3) / 2;
      ctx.rect(x, y + s * 0.58, bw, s * 0.42); ctx.rect(x + bw + gap, y + s * 0.3, bw, s * 0.7); ctx.rect(x + 2 * (bw + gap), y, bw, s);
      ctx.fill(); ctx.lineCap = 'butt';
      return;
    }
    case 'set-square':
      ctx.moveTo(x + lw / 2, y + lw / 2); ctx.lineTo(x + lw / 2, y + s - lw / 2); ctx.lineTo(x + s - lw / 2, y + s - lw / 2); ctx.closePath();
      ctx.moveTo(x + s * 0.26, y + s * 0.5); ctx.lineTo(x + s * 0.26, y + s * 0.74); ctx.lineTo(x + s * 0.5, y + s * 0.74);
      break;
    case 'brackets':
      ctx.moveTo(x + s * 0.34, y + s * 0.12); ctx.lineTo(x + s * 0.02, y + s * 0.5); ctx.lineTo(x + s * 0.34, y + s * 0.88);
      ctx.moveTo(x + s * 0.66, y + s * 0.12); ctx.lineTo(x + s * 0.98, y + s * 0.5); ctx.lineTo(x + s * 0.66, y + s * 0.88);
      break;
    case 'pulse':
      ctx.moveTo(x, y + s * 0.55); ctx.lineTo(x + s * 0.26, y + s * 0.55); ctx.lineTo(x + s * 0.42, y + s * 0.05);
      ctx.lineTo(x + s * 0.6, y + s * 0.95); ctx.lineTo(x + s * 0.74, y + s * 0.55); ctx.lineTo(x + s, y + s * 0.55);
      break;
    case 'padlock':
      ctx.rect(x + s * 0.12, y + s * 0.46, s * 0.76, s * 0.54); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + s * 0.27, y + s * 0.48); ctx.lineTo(x + s * 0.27, y + s * 0.3);
      ctx.arc(x + s * 0.5, y + s * 0.3, s * 0.23, Math.PI, 0); ctx.lineTo(x + s * 0.73, y + s * 0.48);
      break;
    case 'check':
      ctx.moveTo(x + s * 0.06, y + s * 0.55); ctx.lineTo(x + s * 0.38, y + s * 0.88); ctx.lineTo(x + s * 0.96, y + s * 0.1);
      break;
    case 'stopwatch': {
      // Performance (bp's 7th built-in lens): a dial with a crown and one hand. The crown is filled so it never
      // reads as the plain ring a missing glyph falls back to.
      const cx = x + s * 0.5, cy = y + s * 0.6, r = s * 0.38;
      ctx.rect(cx - s * 0.16, y, s * 0.32, s * 0.12); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, y + s * 0.1); ctx.lineTo(cx, cy - r);
      ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU);
      ctx.moveTo(cx, cy); ctx.lineTo(cx + r * 0.62, cy - r * 0.5);
      break;
    }
    default:
      ctx.arc(x + s / 2, y + s / 2, s * 0.36, 0, TAU);
  }
  ctx.stroke(); ctx.lineCap = 'butt';
}

/** A cloud outline (bp: a trouble mark round a feature). */
export function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath(); ctx.moveTo(x, y);
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.round(len / (r * 2.2))), nx = (y1 - y0) / len, ny = -(x1 - x0) / len;
    for (let i = 1; i <= n; i++) {
      const ax = x0 + (x1 - x0) * (i - 1) / n, ay = y0 + (y1 - y0) * (i - 1) / n, bx = x0 + (x1 - x0) * i / n, by = y0 + (y1 - y0) * i / n;
      ctx.quadraticCurveTo((ax + bx) / 2 + nx * r * 1.5, (ay + by) / 2 + ny * r * 1.5, bx, by);
    }
  };
  edge(x, y, x + w, y); edge(x + w, y, x + w, y + h); edge(x + w, y + h, x, y + h); edge(x, y + h, x, y);
  ctx.closePath();
}

export type PinState = 'med' | 'high' | 'ok';

/** A request for information pinned to its place: pole and pennant, optional count (bp glyphPin). State `ok`: an item approved here and not yet built flies a mint pennant with a check. */
export function glyphPin(ctx: CanvasRenderingContext2D, th: CanvasTheme, x: number, y: number, state: PinState, emph: boolean, s: number, count: number, ring: number, font: string): void {
  let col = state === 'ok' ? th.mint : state === 'high' ? th.red : th.amber, hgt = 19 * s, wd = 12 * s;
  if (!emph) { col = th.inkA(0.62); hgt *= 0.8; wd *= 0.8; }
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (ring) {
    const ga = ctx.globalAlpha;
    ctx.strokeStyle = col; ctx.globalAlpha = ga * (1 - ring) * 0.9; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y - hgt * 0.55, 10 + ring * 14, 0, TAU); ctx.stroke(); ctx.globalAlpha = ga;
  }
  const flag = () => { ctx.beginPath(); ctx.moveTo(x, y - hgt); ctx.lineTo(x + wd, y - hgt * 0.74); ctx.lineTo(x, y - hgt * 0.48); ctx.closePath(); };
  ctx.strokeStyle = th.glyphEdge; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - hgt); ctx.stroke();
  flag(); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - hgt); ctx.stroke();
  ctx.fillStyle = col; flag(); ctx.fill();
  if (state === 'ok' && emph) {
    ctx.strokeStyle = th.glyphEdge; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x + 2, y - hgt * 0.75); ctx.lineTo(x + wd * 0.38, y - hgt * 0.6); ctx.lineTo(x + wd * 0.7, y - hgt * 0.92); ctx.stroke();
  }
  if (count > 0) {
    const bx = x - 8, by = y - hgt + 4;
    ctx.fillStyle = emph ? th.inkHi : th.inkA(0.85); ctx.strokeStyle = th.glyphEdge; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(bx, by, count > 99 ? 11 : 8.5, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center'; ctx.font = font; ctx.fillStyle = th.paper; ctx.fillText(String(count), bx, by + 4.2); ctx.textAlign = 'left';
  }
  ctx.lineCap = 'butt';
}

type Stage = string | null;

export function stageFill(ctx: CanvasRenderingContext2D, th: CanvasTheme, st: Stage, x: number, y: number, w: number, h: number): void {
  if (st === 'live') { ctx.fillStyle = th.alpha(th.live, 0.16); ctx.fillRect(x, y, w, h); }
  else if (st === 'flagged') {
    ctx.fillStyle = th.inkA(0.3); ctx.fillRect(x, y, w * 0.5, h);
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(x + w * 0.5, y); ctx.lineTo(x + w * 0.5, y + h); ctx.stroke(); ctx.setLineDash([]);
  } else if (st === 'in-review') { const p = th.pattern('cross', 5, th.inkA(0.55), 0.8); if (p) { ctx.fillStyle = p; ctx.fillRect(x, y, w, h); } }
  else if (st === 'in-dev') { const q = th.pattern('diag', 7, th.alpha(th.build, 0.6), 1); if (q) { ctx.fillStyle = q; ctx.fillRect(x, y, w, h); } }
  else if (st === 'deprecated') { ctx.strokeStyle = th.alpha(th.dep, 0.8); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.stroke(); }
}

export function stageStroke(ctx: CanvasRenderingContext2D, th: CanvasTheme, st: Stage, a: number, lw: number): void {
  ctx.strokeStyle = th.ink; ctx.lineWidth = lw;
  if (!st) { ctx.globalAlpha = a * 0.35; ctx.setLineDash([1, 3]); }
  else if (st === 'specified') ctx.setLineDash([5, 3]);
  else if (st === 'idea') { ctx.setLineDash([1.5, 2.5]); ctx.globalAlpha = a * 0.8; }
  else ctx.setLineDash([]);
}

export function drawStageBar(ctx: CanvasRenderingContext2D, th: CanvasTheme, x: number, y: number, w: number, h: number, c: Counts): void {
  const segs: [number, string | null][] = [[c.live, th.inkA(0.85)], [c.flagged, th.inkA(0.5)], [c.build, null], [c.paper + c.none, th.inkA(0.08)], [c.dep, th.alpha(th.red, 0.4)]];
  const tot = segs.reduce((a, s) => a + s[0], 0) || 1;
  let xx = x;
  for (const s of segs) {
    const sw = w * s[0] / tot;
    if (sw <= 0) continue;
    if (s[1] == null) { ctx.fillStyle = th.inkA(0.12); ctx.fillRect(xx, y, sw, h); const p = th.pattern('diag', 7, th.inkA(0.6), 1); if (p) { ctx.fillStyle = p; ctx.fillRect(xx, y, sw, h); } }
    else { ctx.fillStyle = s[1]; ctx.fillRect(xx, y, sw, h); }
    xx += sw;
  }
  ctx.strokeStyle = th.inkA(0.55); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function drawHealthBar(ctx: CanvasRenderingContext2D, th: CanvasTheme, x: number, y: number, w: number, h: number, c: HealthCounts): void {
  const segs: [number, string][] = [[c.good, th.inkA(0.62)], [c.watch, th.amber], [c.bad, th.red], [c.na + c.unmeasured, th.inkA(0.12)]];
  const tot = segs.reduce((a, s) => a + s[0], 0) || 1;
  let xx = x;
  for (const s of segs) { const sw = w * s[0] / tot; if (sw <= 0) continue; ctx.fillStyle = s[1]; ctx.fillRect(xx, y, sw, h); xx += sw; }
  ctx.strokeStyle = th.inkA(0.55); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
