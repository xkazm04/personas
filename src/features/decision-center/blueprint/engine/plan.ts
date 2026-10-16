// The static plan (PORTED from bp src/engine/render/plan.ts: drawGrid, drawRibbons, drawBuildings, buildWallPaths,
// featRect, near verbatim for one building at u = 1): the 40/200 world-unit grid in accent, wing floors by their
// built share, ribbons crossfading into fixtures, bay rules, thick ink walls and the outline's 5 px diagonal hatch
// over the poche. Everything here is drawn into the cached raster (static-cache.ts), never per frame in a gesture.
// EDIT (port): bp's variant decoration (drawDecor), its campus scale (several buildings) and its simulation patch
// test (patchMiss) are not brought: one product, one building, no simulation here.
import { RH } from '../model/layout';
import type { Layout } from '../model/layout';
import { counts } from '../model/aggregates';
import { clamp } from './camera';
import type { Engine } from './Engine';
import { paintTile, ribSeg } from './tiles';
import { onView, rs, sxv, syv, type SRect, type View } from './view';

export interface Walls { rooms: Path2D; wings: Path2D; outline: Path2D; bays: Path2D }

const scratch: SRect = { x: 0, y: 0, w: 0, h: 0 };

/** World-space wall geometry, built once per layout. */
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

export function drawGrid(e: Engine, ctx: CanvasRenderingContext2D, v: View): void {
  const k = v.k, th = e.th;
  for (const [step, a] of [[40, 0.045], [200, 0.09]] as const) {
    const sp = step * k; if (sp < 9) continue;
    ctx.strokeStyle = th.alpha(th.accent, a * clamp((sp - 9) / 12, 0, 1) * (th.mode === 'dark' ? 1 : 0.9)); ctx.lineWidth = 1; ctx.beginPath();
    const wx0 = v.x + (v.c0x - v.FW / 2) / k, wy0 = v.y + (v.c0y - v.FH / 2) / k;
    const x0 = Math.floor(wx0 / step) * step, y0 = Math.floor(wy0 / step) * step;
    for (let x = x0; sxv(v, x) < v.c1x; x += step) { const X = Math.round(sxv(v, x)) + 0.5; ctx.moveTo(X, v.c0y); ctx.lineTo(X, v.c1y); }
    for (let y = y0; syv(v, y) < v.c1y; y += step) { const Y = Math.round(syv(v, y)) + 0.5; ctx.moveTo(v.c0x, Y); ctx.lineTo(v.c1x, Y); }
    ctx.stroke();
  }
}

function drawRibbons(e: Engine, ctx: CanvasRenderingContext2D, v: View, alpha: number): void {
  const k = v.k;
  for (const W of e.plan.L.bld.wings) {
    if (!onView(v, rs(v, W, scratch), 20)) continue;
    for (const R of W.rooms) {
      if (!onView(v, rs(v, R, scratch), 20)) continue;
      for (const Bay of R.bays) {
        const rb = Bay.rib, x = sxv(v, rb.x), y = syv(v, rb.y), w = rb.w * k, h = rb.h * k, n = Bay.tiles.length, sw = w / n;
        if (y > v.c1y + 10 || y + h < v.c0y - 10 || x > v.c1x + 10 || x + w < v.c0x - 10) continue;
        for (let i = 0; i < n; i++) ribSeg(e, ctx, Bay.tiles[i]!.f, x + i * sw + 1, y, sw - 2, h, alpha, k);
        ctx.globalAlpha = alpha * 0.55; ctx.strokeStyle = e.th.inkA(0.7); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.globalAlpha = 1;
      }
    }
  }
}

function screenPath(world: Path2D, v: View): Path2D {
  const p = new Path2D();
  p.addPath(world, new DOMMatrix([v.k, 0, 0, v.k, v.FW / 2 - v.x * v.k, v.FH / 2 - v.y * v.k]));
  return p;
}

export function drawBuildings(e: Engine, ctx: CanvasRenderingContext2D, v: View): void {
  const k = v.k, th = e.th, lod = e.cam.lod(k), B = e.plan.L.bld;
  if (!onView(v, rs(v, B, scratch), 140)) return;
  for (const W of B.wings) {
    const r = rs(v, W, scratch), c0 = counts(W.feats), sh = (c0.live + c0.flagged) / Math.max(1, c0.n);
    ctx.fillStyle = th.inkA(0.02 + 0.075 * sh); ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  if (lod < 0.995) drawRibbons(e, ctx, v, 1 - lod);
  if (lod > 0.005) {
    for (const W of B.wings) {
      if (!onView(v, rs(v, W, scratch), 20)) continue;
      for (const R of W.rooms) {
        if (!onView(v, rs(v, R, scratch), 20)) continue;
        for (const Bay of R.bays) for (const T of Bay.tiles) paintTile(e, ctx, v, T, lod);
      }
    }
  }
  const paths = e.walls;
  if (k > 0.12) { ctx.strokeStyle = th.inkA(0.5); ctx.lineWidth = 1; ctx.stroke(screenPath(paths.bays, v)); }
  const wi = clamp(6 * k, 1.2, 6), ww = clamp(10 * k, 2, 10), wo = clamp(18 * k, 3.5, 18);
  ctx.strokeStyle = th.ink; ctx.lineJoin = 'miter';
  ctx.lineWidth = wi; ctx.stroke(screenPath(paths.rooms, v));
  ctx.lineWidth = ww; ctx.stroke(screenPath(paths.wings, v));
  const out = screenPath(paths.outline, v);
  ctx.lineWidth = wo; ctx.stroke(out);
  if (wo > 6) { const p = th.pattern({ kind: 'diag', size: 5, color: th.inkA(0.75), lw: 1.1, bg: th.poche }); if (p) { ctx.lineWidth = wo - 4; ctx.strokeStyle = p; ctx.stroke(out); } }
}

/** The screen rect of a feature at a LOD: its tile when fixtures are drawn, else its ribbon segment. */
export function featRect(e: Engine, v: View, fid: string, lod: number, out?: SRect): SRect | null {
  const T = e.plan.L.TILE[fid]; if (!T) return null;
  const r = out ?? { x: 0, y: 0, w: 0, h: 0 };
  if (lod > 0.5) return rs(v, T, r);
  const rb = T.bay.rib, n = T.bay.tiles.length, sw = (rb.w * v.k) / n;
  r.x = sxv(v, rb.x) + T.bi * sw; r.y = syv(v, rb.y); r.w = sw; r.h = rb.h * v.k;
  return r;
}
