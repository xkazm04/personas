// Fixtures and ribbon segments (PORTED from bp src/engine/render/plan.ts makeGeom / healthMarks / lensVerdict /
// paintTile / ribSeg, near verbatim at u = 1): a feature's stage fill and stroke (ink only), its trouble cloud or
// watch tick, the delta triangle when its stage moved in the last week, the lens marks, the "?" over the unmeasured,
// and at fixture scale its code, evidence line, name (doubling at L3) and trouble stamp.
// EDIT (port): bp's blast-radius and GA filters and its swarm chips are not brought (no such modes here). Time travel
// (Stage D) is bp's: the stage is the one on the drawn date (e.stageOf), and the trouble marks, lens verdicts and live
// values speak of now only; the delta window is the rail's View days (bp S.delta).
import type { Feature } from '../standard/load';
import type { TileNode } from '../model/layout';
import { clamp, smooth } from './camera';
import type { Engine } from './Engine';
import { cloud, stageFill, stageStroke } from './glyphs';
import { composeGeneral, expandedRect, lensContent, lensMarks, type MarkArgs, type Rect, type TileGeom } from './lens';
import { unknownFill } from './patterns';
import { drawText } from './text';
import { deltaWin } from './travel';
import { sxv, syv, type View } from './view';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const GEO: TileGeom = { x: 0, y: 0, w: 0, h: 0, form: 'tile', u: 1, k: 1, strip: { x: 0, y: 0, w: 0, h: 0 }, body: { x: 0, y: 0, w: 0, h: 0 }, text: false };
function makeGeom(x: number, y: number, w: number, h: number, form: 'ribbon' | 'tile', k: number): TileGeom {
  const u = 1, g = GEO, s = g.strip, b = g.body;
  g.x = x; g.y = y; g.w = w; g.h = h; g.form = form; g.u = u; g.k = k;
  g.text = form === 'tile' && w >= 100 * u && h >= 44 * u;
  if (form === 'tile') { s.x = x + 6 * u; s.y = y + 3 * u; s.w = w - 12 * u; s.h = clamp(h * 0.07, 3 * u, 6 * u); b.x = x + 3 * u; b.y = y + 3 * u; b.w = w - 6 * u; b.h = h - 6 * u; }
  else { s.x = x; s.y = y; s.w = w; s.h = Math.min(3 * u, h * 0.2); b.x = x + 1; b.y = y + 1; b.w = Math.max(0, w - 2); b.h = Math.max(0, h - 2); }
  return g;
}

/** bp: did the feature's stage move within the recent window (the View's days) that ends on the drawn date? */
const moved = (e: Engine, f: Feature): boolean => !!deltaWin(f, e.day, e.viewDays);

export function healthMarks(e: Engine, ctx: CanvasRenderingContext2D, h: string, x: number, y: number, w: number, hh: number, compact: boolean, a: number): void {
  const th = e.th, ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * a;
  if (compact) {
    if (h === 'bad') { ctx.fillStyle = th.red; ctx.fillRect(x, y - 3, w, 3); }
    else if (h === 'watch') { ctx.fillStyle = th.amber; ctx.fillRect(x, y - 3, w, 2); }
  } else if (h === 'bad') {
    ctx.strokeStyle = th.red; ctx.lineWidth = w < 40 ? 1.3 : 1.8; ctx.lineJoin = 'round';
    const r = clamp(w / 14, 2.4, 6); cloud(ctx, x - r * 0.8, y - r * 0.8, w + r * 1.6, hh + r * 1.6, r); ctx.stroke();
  } else if (h === 'watch' && w >= 22) {
    ctx.strokeStyle = th.amber; ctx.lineWidth = 2; ctx.lineCap = 'round';
    const tx = x + w - 12; ctx.beginPath(); ctx.moveTo(tx, y - 2); ctx.lineTo(tx + 4, y - 7); ctx.moveTo(tx + 5, y - 2); ctx.lineTo(tx + 9, y - 7); ctx.stroke(); ctx.lineCap = 'butt';
  }
  ctx.globalAlpha = ga;
}

/** What the lens in view says about the feature as a whole: `na` fades the tile; unmeasured lays the "?" (returned as `unk`). */
export function lensVerdict(e: Engine, f: Feature): { fade: number; unk: number } {
  const top = e.mixS.top;
  let measured = false, unknown = false;
  for (const l of e.plan.lenses) {
    if (measured) break;
    const h = f.lens[l.id]?.h ?? 'unmeasured';
    if (h === 'unmeasured') unknown = true; else if (h !== 'na') measured = true;
  }
  const hl = top ? f.lens[top]?.h ?? 'unmeasured' : null;
  return { fade: hl === 'na' ? 0.35 : 1, unk: top ? (hl === 'unmeasured' ? 1 : 0) : !measured && unknown ? 1 : 0 };
}

const SLOT: Rect = { x: 0, y: 0, w: 0, h: 0 }, EXP: Rect = { x: 0, y: 0, w: 0, h: 0 }, BLEND: Rect = { x: 0, y: 0, w: 0, h: 0 };
/** Every lens present in the mix, on one tile or ribbon segment (bp plan.ts lensMarks). */
function marks(e: Engine, ctx: CanvasRenderingContext2D, g: TileGeom, f: Feature): void {
  const ls = e.plan.lenses, ga = ctx.globalAlpha, live = e.live(f), m = e.mixS, st = e.stageOf(f), now = e.isNow;
  for (let i = 0; i < ls.length; i++) {
    const d = ls[i]!, p = m.p(d.id);
    if (p <= 0.004) continue;
    const x = m.x(d.id), slot = composeGeneral(g, ls.length, i, SLOT), exp = expandedRect(g, EXP);
    let r: Rect, w: number;
    if (slot) { r = BLEND; r.x = lerp(slot.x, exp.x, x); r.y = lerp(slot.y, exp.y, x); r.w = lerp(slot.w, exp.w, x); r.h = lerp(slot.h, exp.h, x); w = p; }
    else { if (x <= 0.004) continue; r = exp; w = p * x; }
    if (r.w < 1 || r.h < 1) continue;
    const a: MarkArgs = { ctx, th: e.th, tile: g, f, d, slot, r, w, x, live, st, now };
    ctx.save(); lensMarks(a); ctx.restore();
    ctx.globalAlpha = ga;
  }
}

function deltaMark(e: Engine, ctx: CanvasRenderingContext2D, xw: number, y: number, ds: number): void {
  ctx.fillStyle = e.th.delta; ctx.beginPath();
  ctx.moveTo(xw + 1, y - ds * 1.2); ctx.lineTo(xw + 1 + ds * 0.7, y + ds * 0.3); ctx.lineTo(xw + 1 - ds * 0.7, y + ds * 0.3); ctx.closePath(); ctx.fill();
}

export function ribSeg(e: Engine, ctx: CanvasRenderingContext2D, f: Feature, x: number, y: number, w: number, h: number, a0: number, k: number): void {
  const th = e.th, st = e.stageOf(f), vd = st && e.isNow ? lensVerdict(e, f) : { fade: 1, unk: 0 }, aa = a0 * vd.fade;
  if (aa <= 0.01) return;
  ctx.globalAlpha = aa;
  ctx.fillStyle = th.tileBase; ctx.fillRect(x, y, w, h);
  const Lv = e.live(f);
  stageFill(ctx, th, st, x, y, w, h, Lv.rolloutPct, Lv.progressPct);
  if (!st || st === 'specified' || st === 'idea') { stageStroke(ctx, th, st, aa, 1); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.setLineDash([]); ctx.globalAlpha = aa; }
  if (st && e.isNow) healthMarks(e, ctx, e.mixS.top ? f.lens[e.mixS.top]?.h ?? 'unmeasured' : f.health, x, y, w, h, true, 1);
  if (st && moved(e, f)) deltaMark(e, ctx, x + w * 0.9, y, clamp((w * 0.9) / 9, 4, 8));
  const g = makeGeom(x, y, w, h, 'ribbon', k);
  marks(e, ctx, g, f);
  ctx.globalAlpha = aa;
  if (vd.unk > 0.004) unknownFill(ctx, th, g.body.x, g.body.y, g.body.w, g.body.h, 1, aa * Math.min(1, vd.unk));
  ctx.globalAlpha = 1;
}

/** General's stamp when a feature is in trouble (bad): the worst lens's reason with "+N", then shorter forms. */
function stampOf(e: Engine, f: Feature, maxW: number, font: string): string | null {
  const t = f.trouble;
  if (!t.length || t[0]!.h !== 'bad') return null;
  const t0 = t[0]!, more = t.length > 1 ? ' +' + (t.length - 1) : '', sh = t0.short ? [t0.short + more, t0.short] : [];
  return fitStamp(e, [t0.why + more, t0.why, ...sh], (e.plan.LENS[t0.lens]?.name ?? t0.lens) + more, maxW, font);
}
/** The first candidate that fits, else the last cut at a word with an ellipsis (2+ words), else `last`. */
function fitStamp(e: Engine, cands: readonly string[], last: string | null, maxW: number, font: string): string | null {
  for (const c of cands) { const s = e.tx.fit([c], maxW, font); if (s) return s; }
  const words = (cands[cands.length - 1] ?? '').split(' ');
  for (let n = words.length - 1; n >= 2; n--) { const s = e.tx.fit([words.slice(0, n).join(' ').replace(/[,;:]$/, '') + '…'], maxW, font); if (s) return s; }
  return last ? e.tx.fit([last], maxW, font) : null;
}

export function paintTile(e: Engine, ctx: CanvasRenderingContext2D, v: View, T: TileNode, alphaMul: number): void {
  const f = T.f, th = e.th, k = v.k, x = sxv(v, T.x), y = syv(v, T.y), w = T.w * k, h = T.h * k;
  if (x > v.c1x + 10 || y > v.c1y + 10 || x + w < v.c0x - 10 || y + h < v.c0y - 10) return;
  const st = e.stageOf(f), vd = st && e.isNow ? lensVerdict(e, f) : { fade: 1, unk: 0 }, a = alphaMul * vd.fade;
  if (a <= 0.01) return;
  ctx.globalAlpha = a;
  const g = makeGeom(x, y, w, h, 'tile', k), Lv = e.live(f);
  ctx.fillStyle = th.tileBase; ctx.fillRect(x, y, w, h);
  stageFill(ctx, th, st, x, y, w, h, Lv.rolloutPct, Lv.progressPct);
  stageStroke(ctx, th, st, a, w < 30 ? 1 : 1.5); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.setLineDash([]); ctx.globalAlpha = a;
  const top = e.mixS.top;
  if (st && e.isNow) healthMarks(e, ctx, top ? f.lens[top]?.h ?? 'unmeasured' : f.health, x, y, w, h, false, 1);
  if (st && moved(e, f)) deltaMark(e, ctx, x + w, y, clamp(w / 9, 4, 8));
  marks(e, ctx, g, f);
  ctx.globalAlpha = a;
  if (vd.unk > 0.004) unknownFill(ctx, th, g.body.x, g.body.y, g.body.w, g.body.h, 1, a * Math.min(1, vd.unk));
  ctx.textBaseline = 'alphabetic';
  e.budget.of++;
  if (!g.text) { ctx.globalAlpha = 1; return; }
  e.budget.names++;
  paintWords(e, ctx, T, g, a);
  ctx.globalAlpha = 1;
}

/** A fixture's words: code and evidence line, the name (twice its plan size at L3) and the trouble stamp. */
function paintWords(e: Engine, ctx: CanvasRenderingContext2D, T: TileNode, g: TileGeom, a: number): void {
  const { x, y, w, h, k } = g, f = T.f, th = e.th, tx = e.tx, top = e.isNow ? e.mixS.top : null, W = e.words, st = e.stageOf(f);
  const ta = a * clamp((w - 100) / 14, 0, 1) * clamp((h - 44) / 8, 0, 1);
  const bigA = clamp((w - 150) / 16, 0, 1) * clamp((h - 64) / 8, 0, 1) >= 0.5;
  if (ta <= 0.004) return;
  const hy = g.strip.y + g.strip.h + 12;
  ctx.globalAlpha = ta;
  if (!bigA) {
    const nf2 = tx.f(13, 500), l2 = 15, lines2 = tx.wrap(f.name, w - 12, nf2, Math.max(1, Math.floor((h - 8 - (hy - y - 12)) / l2)));
    if (lines2) { const t2 = hy - 12 + (h - (hy - y - 12) - lines2.length * l2) / 2; lines2.forEach((l, i) => drawText(ctx, l, x + 6, t2 + l2 * (i + 0.78), nf2, th.inkHi)); }
    return;
  }
  const mono = tx.f(12, 500, true), code = f.code, idw = code ? tx.w(code, mono) : -10, Lv = e.live(f);
  const now = e.isNow, ev = !st ? [W.notDrawn.toUpperCase()] : now && st === 'flagged' && Lv.rolloutPct < 100 ? [W.stage(st).toUpperCase(), W.pct(Lv.rolloutPct)] : now && st === 'in-dev' ? [W.stage(st).toUpperCase(), W.pct(Math.round(Lv.progressPct))] : [W.stage(st).toUpperCase()];
  const d = top ? e.plan.LENS[top] : undefined, lensC = d && st ? lensContent(W, d, f, Lv) : null;
  const room = w - 16 - idw - 10, gFit = tx.fit(ev, room, mono), lFit = lensC ? tx.fit(lensC.parts, room, mono) : null;
  const showId = !!code && !(lensC ? lFit == null : gFit == null), roomW = showId ? room : w - 14;
  if (showId) drawText(ctx, code, x + 7, hy, mono, th.inkA(0.9));
  ctx.textAlign = 'right';
  const s = lensC ? (showId ? lFit : tx.fit(lensC.parts, roomW, mono)) : showId ? gFit : tx.fit(ev, roomW, mono);
  if (s) drawText(ctx, s, x + w - 7, hy, mono, lensC ? e.accentOf(top) : th.ink);
  ctx.textAlign = 'left';
  const sf = tx.f(12.5, 600), stamp = lensC ? (lensC.stamp ? fitStamp(e, [lensC.stamp], null, w - 14, sf) : null) : st && e.isNow ? stampOf(e, f, w - 14, sf) : null;
  // at L3 (the camera at the bay's fit) the title is twice its plan size; it steps back down 2 px at a time to fit
  const l3 = smooth(0.78, 0.94, k / e.cam.fitKOf(T.bay)), roomH = h - (hy - y) - 8 - (stamp ? 20 : 6);
  let ns = Math.round(2 * clamp(13.5 + (w - 150) / 60, 14, 17) * (1 + l3)) / 2, lh = 0, nf = '', lines: string[] | null = null;
  for (; ns >= 14; ns -= 2) { lh = ns * 1.16; nf = tx.f(ns, 500); lines = tx.wrap(f.name, w - 14, nf, Math.max(1, Math.floor(roomH / lh))); if (lines) break; }
  if (!lines) { nf = tx.f(14, 500); lh = 16.2; lines = tx.wrap(f.name, w - 14, nf, Math.max(1, Math.floor(roomH / lh))); }
  if (lines) lines.forEach((l, i) => drawText(ctx, l, x + 7, hy + 6 + lh * (i + 0.82), nf, th.inkHi));
  if (stamp) drawText(ctx, stamp, x + 7, y + h - 7, sf, th.red2, th.halo);
}
