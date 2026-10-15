// The static plan (PORTED from bp src/engine/render/plan.ts): the 40 px grid, wing fills, ribbons at the site and
// wing levels, fixtures at room level and deeper, bay rules, double walls with poche, the wing outline, and the
// drafting sheet's registration ticks at every wing corner.
import { RH } from '../model/layout';
import type { Layout } from '../model/layout';
import { counts } from '../model/aggregates';
import { clamp } from './camera';
import type { Engine } from './Engine';
import { paintTile, ribSeg } from './tiles';

export interface Walls { rooms: Path2D; wings: Path2D; outline: Path2D; bays: Path2D }

export function buildWalls(L: Layout): Walls {
  const rooms = new Path2D(), wings = new Path2D(), outline = new Path2D(), bays = new Path2D();
  const B = L.bld;
  for (const W of B.wings) { wings.rect(W.x, W.y, W.w, W.h); for (const R of W.rooms) rooms.rect(R.x, R.y, R.w, R.h); }
  outline.moveTo(B.x, B.y); outline.lineTo(B.x + B.w, B.y);
  for (let i = B.wings.length - 1; i >= 0; i--) { const W = B.wings[i]!; outline.lineTo(W.x + W.w, W.y + W.h); outline.lineTo(W.x, W.y + W.h); }
  outline.closePath();
  for (const W of B.wings) for (const R of W.rooms) for (const Bay of R.bays) {
    if (Bay.y <= R.y + RH + 1) continue;
    bays.moveTo(R.x + 6, Bay.y - 2); bays.lineTo(R.x + R.w - 6, Bay.y - 2);
  }
  return { rooms, wings, outline, bays };
}

export function drawGrid(e: Engine, ctx: CanvasRenderingContext2D): void {
  const { cam, th } = e;
  for (const [step, a] of [[40, 0.045], [200, 0.09]] as const) {
    const sp = step * cam.k;
    if (sp < 9) continue;
    ctx.strokeStyle = th.alpha(th.grid, a * clamp((sp - 9) / 12, 0, 1) * (th.mode === 'dark' ? 1.6 : 1.2)); ctx.lineWidth = 1; ctx.beginPath();
    const x0 = Math.floor(cam.wx(0) / step) * step, y0 = Math.floor(cam.wy(0) / step) * step;
    for (let x = x0; cam.sx(x) < cam.FW; x += step) { const X = Math.round(cam.sx(x)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, cam.FH); }
    for (let y = y0; cam.sy(y) < cam.FH; y += step) { const Y = Math.round(cam.sy(y)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(cam.FW, Y); }
    ctx.stroke();
  }
}

function screenPath(e: Engine, world: Path2D): Path2D {
  const { cam } = e, p = new Path2D(), k = cam.k;
  p.addPath(world, new DOMMatrix([k, 0, 0, k, cam.FW / 2 - cam.x * k, cam.FH / 2 - cam.y * k]));
  return p;
}

function drawRibbons(e: Engine, ctx: CanvasRenderingContext2D, alpha: number): void {
  const { cam, th } = e, k = cam.k;
  for (const W of e.plan.L.bld.wings) for (const R of W.rooms) for (const Bay of R.bays) {
    const rb = Bay.rib, x = cam.sx(rb.x), y = cam.sy(rb.y), w = rb.w * k, h = rb.h * k, n = Bay.tiles.length, sw = w / n;
    if (!e.onView({ x, y, w, h }, 10)) continue;
    for (let i = 0; i < n; i++) ribSeg(e, ctx, Bay.tiles[i]!.f, x + i * sw + 1, y, sw - 2, h, alpha);
    ctx.globalAlpha = alpha * 0.55; ctx.strokeStyle = th.inkA(0.7); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.globalAlpha = 1;
  }
}

export function drawBuildings(e: Engine, ctx: CanvasRenderingContext2D): void {
  const { cam, th } = e, k = cam.k, lod = cam.lod(), B = e.plan.L.bld;
  for (const W of B.wings) {
    const r = cam.rs(W), c0 = counts(W.feats), sh = (c0.live + c0.flagged) / Math.max(1, c0.n);
    ctx.fillStyle = th.inkA(0.02 + 0.075 * sh); ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  if (lod < 0.995) drawRibbons(e, ctx, 1 - lod);
  if (lod > 0.005) for (const T of e.plan.L.tiles) paintTile(e, ctx, T, lod);
  if (k > 0.12) { ctx.strokeStyle = th.inkA(0.5); ctx.lineWidth = 1; ctx.stroke(screenPath(e, e.walls.bays)); }
  const wi = clamp(6 * k, 1.2, 6), ww = clamp(10 * k, 2, 10), wo = clamp(18 * k, 3.5, 18);
  ctx.strokeStyle = th.ink; ctx.lineJoin = 'miter';
  ctx.lineWidth = wi; ctx.stroke(screenPath(e, e.walls.rooms));
  ctx.lineWidth = ww; ctx.stroke(screenPath(e, e.walls.wings));
  const out = screenPath(e, e.walls.outline);
  if (th.glow) { ctx.save(); ctx.shadowColor = th.accent; ctx.shadowBlur = 14; ctx.lineWidth = wo; ctx.stroke(out); ctx.restore(); }
  else { ctx.lineWidth = wo; ctx.stroke(out); }
  if (wo > 6) { const p = th.pattern('diag', 5, th.inkA(0.75), 1.1, th.poche); if (p) { ctx.lineWidth = wo - 4; ctx.strokeStyle = p; ctx.stroke(out); } }
  // the drafting sheet's registration ticks: a cross at every wing corner, as on the Twin sheet's panels
  ctx.strokeStyle = th.inkA(0.85); ctx.lineWidth = 1.2; ctx.beginPath();
  for (const W of B.wings) {
    for (const [cx, cy] of [[W.x, W.y], [W.x + W.w, W.y], [W.x, W.y + W.h], [W.x + W.w, W.y + W.h]] as const) {
      const X = cam.sx(cx), Y = cam.sy(cy), t = clamp(14 * k, 5, 12) + wo / 2;
      ctx.moveTo(X - t - 4, Y); ctx.lineTo(X - wo / 2 - 2, Y); ctx.moveTo(X + wo / 2 + 2, Y); ctx.lineTo(X + t + 4, Y);
      ctx.moveTo(X, Y - t - 4); ctx.lineTo(X, Y - wo / 2 - 2); ctx.moveTo(X, Y + wo / 2 + 2); ctx.lineTo(X, Y + t + 4);
    }
  }
  ctx.stroke();
}
