// PORTED from bp apps/web/src/engine/render/plan.ts @ 93f30b0 (compareMarks, the replayed health of the trouble marks)
// and apps/web/src/engine/render/dynamic.ts @ 93f30b0 (outlineIf, the readiness scope outline) (spark bp-sync, WP2).
// EDIT (port): at u = 1 (Personas has no UI scale); bp's crossfade between General and the lens (mixS.topD) is not
// brought (the lens switches at once here, Engine.mix), so markHealth answers one health; bp's `dimFn` becomes the
// engine's `scope` set. Colours are the engine theme's (the `--bp-*` tokens read by theme.ts): accent and paper.
// What the sheet's comparison, replay and readiness draw on the plan. The compare chips sit in the static raster (the
// raster re-keys on the comparison, Engine.setCompare); the scope outline is drawn on the dynamic layer every frame.
import type { Feature } from '../standard/load';
import type { Health } from '../standard/types';
import { clamp } from './camera';
import type { Engine } from './Engine';
import { featRect } from './plan';
import { onView, type SRect, type View } from './view';

const sr: SRect = { x: 0, y: 0, w: 0, h: 0 };

/**
 * The health a feature's trouble marks draw (bp plan.ts): at now its live health (General, or the lens's); on a past
 * date the health replayed by today's rules over that date's readings (engine/replay.ts), and null where it could not
 * be replayed: a pair with an input not read by then draws nothing, never today's health.
 */
export function markHealth(e: Engine, f: Feature): Health | null {
  const top = e.mixS.top;
  if (e.isNow) return top ? f.lens[top]?.h ?? 'unmeasured' : f.health;
  const past = e.replay?.row(f.id);
  if (!past) return null;
  return top ? e.replay!.healthUnder(past, top) : past.health;
}

/**
 * What changed on this feature between the pinned baseline and the travelled date (Engine.cmp), as distinct marks in
 * the accent ink on a paper chip at the tile's bottom-left: a diamond for a stage change, a triangle for a numeric move
 * (pointing the way the first moved metric went), a ring for a first observation, a short bar for a replayed health
 * move. Never a fill: the tile keeps its stage colour and its place. Tiles too small for the chip carry none (the
 * place's label counts them).
 */
export function compareMarks(e: Engine, ctx: CanvasRenderingContext2D, f: Feature, x: number, y: number, w: number, h: number): void {
  const c = e.cmp?.byId.get(f.id); if (!c) return;
  const th = e.th, s = clamp(w / 11, 8, 12), gap = s * 0.45;
  const n = (c.stage ? 1 : 0) + (c.moves.length ? 1 : 0) + (c.firsts.length ? 1 : 0) + (c.health.length ? 1 : 0);
  const cw = n * s + (n + 1) * gap, ch = s + 2 * gap;
  if (w < cw + 6 || h < ch + 6) return;
  const x0 = x + 3, y0 = y + h - ch - 3, ga = ctx.globalAlpha;
  ctx.fillStyle = th.paper; ctx.strokeStyle = th.accent; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.roundRect(x0, y0, cw, ch, ch / 2); ctx.fill(); ctx.stroke();
  let gx = x0 + gap; const cy = y0 + ch / 2, r = s / 2;
  ctx.fillStyle = th.accent;
  if (c.stage) { ctx.beginPath(); ctx.moveTo(gx + r, cy - r); ctx.lineTo(gx + s, cy); ctx.lineTo(gx + r, cy + r); ctx.lineTo(gx, cy); ctx.closePath(); ctx.fill(); gx += s + gap; }
  const m0 = c.moves[0];
  if (m0) {
    const up = m0.b.value > m0.a.value;
    ctx.beginPath();
    if (up) { ctx.moveTo(gx + r, cy - r); ctx.lineTo(gx + s, cy + r); ctx.lineTo(gx, cy + r); } else { ctx.moveTo(gx, cy - r); ctx.lineTo(gx + s, cy - r); ctx.lineTo(gx + r, cy + r); }
    ctx.closePath(); ctx.fill(); gx += s + gap;
  }
  if (c.firsts.length) { ctx.beginPath(); ctx.arc(gx + r, cy, r * 0.78, 0, 6.2832); ctx.lineWidth = 1.8; ctx.stroke(); gx += s + gap; }
  // a replayed health move: a short bar (the plan's health marks are bars too), in the accent, never red or amber
  if (c.health.length) ctx.fillRect(gx, cy - s * 0.18, s, s * 0.36);
  ctx.globalAlpha = ga;
}

/** The readiness scope (bp outlineIf with the GA filter): an amber outline round every feature readiness reads. */
export function drawScope(e: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number): void {
  const sc = e.scope; if (!sc || !sc.size) return;
  ctx.save();
  ctx.strokeStyle = e.th.amber; ctx.lineWidth = 1.6;
  for (const id of sc) {
    const r = featRect(e, v, id, lod, sr);
    if (r && onView(v, r, 0)) ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
  }
  ctx.restore();
}
