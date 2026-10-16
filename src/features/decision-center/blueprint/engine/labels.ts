// Place labels (PORTED from bp src/engine/render/plan.ts drawBayTags / drawRoomLabels / drawWingLabels /
// drawChronology, near verbatim at u = 1): boxed bay tags (code | NAME | count), room names (on a 92% label plate
// when they float) with their 13 px aggregate line, wing titles with the circled letter, the RFI pin with the
// wing's waiting count, the 7 px stacked stage bar and "N features · N live · ..." with a right-aligned
// "N in trouble" on a halo, and the chronology rule under the building. Every word comes from `e.words`.
// EDIT (port): bp's swarm line (agent survey marks driven by its simulation) has no data here, so the wing's RFI
// pin stands alone on that line; bp's room illustrations and campus building label are not brought. bp keeps 38 px
// clear of a room's pin while its simulation runs; here the room pins are the waiting work, so the room is kept
// clear whenever any work is waiting.
import type { Feature } from '../standard/load';
import { generalHealth } from '../standard/present';
import { counts, healthOf } from '../model/aggregates';
import { BH, RH } from '../model/layout';
import type { BldNode } from '../model/layout';
import { clamp } from './camera';
import type { Engine } from './Engine';
import { drawHealthBar, drawStageBar, glyphPin } from './glyphs';
import { drawText } from './text';
import { onView, rs, type SRect, type View } from './view';

const scratch: SRect = { x: 0, y: 0, w: 0, h: 0 };

interface Agg { c: ReturnType<typeof counts>; general: string[]; generalShort: string[]; lens: string[] | null; lensShort: string[] | null; trouble: number }

/** bp aggParts: stage parts (bp stageParts), and under a lens its rollup word, bad and watch counts. */
function aggParts(e: Engine, fs: readonly Feature[]): Agg {
  const c = counts(fs), top = e.mixS.top, W = e.words;
  const stages = [W.live(c.live + c.flagged), W.building(c.build), W.onPaper(c.paper)];
  let lens: string[] | null = null, lensShort: string[] | null = null, trouble = fs.filter((f) => f.health === 'bad').length;
  if (top) {
    const hc = healthOf(fs, top), parts = [W.verdict(generalHealth(fs.map((f) => f.lens[top]?.h ?? 'unmeasured'))).toLowerCase()];
    if (hc.bad) parts.push(W.bad(hc.bad));
    if (hc.watch) parts.push(W.toWatch(hc.watch));
    lens = [W.featuresN(c.n), ...parts]; lensShort = [String(c.n), ...parts]; trouble = hc.bad;
  }
  return { c, general: [W.featuresN(c.n), ...stages], generalShort: [String(c.n), ...stages], lens, lensShort, trouble };
}

/** Proposed (not yet decided) work under a feature set that the current sheet shows, and how many are high risk. */
function asksOf(e: Engine, fs: readonly Feature[]): { n: number; high: boolean } {
  let n = 0, high = false;
  for (const f of fs) for (const p of e.waitingOf(f)) if (p.status === 'proposed' && e.mixS.p(p.lens)) { n++; if ((p.risk ?? 0) >= 4) high = true; }
  return { n, high };
}

export function drawLabels(e: Engine, ctx: CanvasRenderingContext2D, v: View): void {
  const B = e.plan.L.bld;
  drawBayTags(e, ctx, v, B); drawRoomLabels(e, ctx, v, B); drawWingLabels(e, ctx, v, B); drawChronology(e, ctx, v, B);
}

function drawBayTags(e: Engine, ctx: CanvasRenderingContext2D, v: View, B: BldNode): void {
  const { th, tx } = e, k = v.k;
  if (BH * k < 23) return;
  const cf = tx.f(12, 500, true), nf = tx.f(13.5, 600);
  ctx.globalAlpha = clamp((BH * k - 23) / 12, 0, 1);
  for (const W of B.wings) for (const R of W.rooms) for (const Bay of R.bays) {
    const r = rs(v, Bay, scratch); if (!onView(v, r)) continue;
    const code = Bay.cap.code, nm = Bay.cap.name.toUpperCase(), cw = tx.w(code, cf) + 12, nw = tx.w(nm, nf, 0.7) + 12, cnt = String(Bay.tiles.length), kw = tx.w(cnt, cf) + 12;
    let full = cw + nw + kw;
    const th2 = 22, x = r.x, y = r.y + Math.max(1, (BH * k - th2) / 2 - 3), showCode = !!code && full <= r.w;
    if (!showCode && nw <= r.w) full = nw; else if (!showCode) continue;
    ctx.fillStyle = th.labelBg; ctx.fillRect(x, y, full, th2);
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, full - 1, th2 - 1);
    let xx = x;
    if (showCode) { drawText(ctx, code, xx + 6, y + 15.5, cf, th.inkA(0.72)); xx += cw; ctx.beginPath(); ctx.moveTo(xx + 0.5, y); ctx.lineTo(xx + 0.5, y + th2); ctx.stroke(); }
    drawText(ctx, nm, xx + 6, y + 16, nf, th.inkHi, null, 0.7); xx += nw;
    if (showCode) { ctx.beginPath(); ctx.moveTo(xx + 0.5, y); ctx.lineTo(xx + 0.5, y + th2); ctx.stroke(); drawText(ctx, cnt, xx + 6, y + 15.5, cf, th.inkA(0.72)); }
  }
  ctx.globalAlpha = 1;
}

function drawRoomLabels(e: Engine, ctx: CanvasRenderingContext2D, v: View, B: BldNode): void {
  const { th, tx } = e, k = v.k, top = e.mixS.top, pins = e.pinsDrawn();
  for (const W of B.wings) {
    const a = clamp((W.w * k - 100) / 8, 0, 1);
    for (const R of W.rooms) R.labelBox = null;
    if (a <= 0) continue;
    for (const R of W.rooms) {
      const r = rs(v, R, scratch); if (!onView(v, r)) continue;
      const hh = RH * k, nm = R.d.name.toUpperCase(), maxW = r.w - 28 - (pins ? 38 : 0);
      let fs = clamp(hh * 0.36, 14, 26), ls = fs * 0.06, lines = tx.wrap(nm, maxW, tx.f(fs, 600), 2, ls);
      if (!lines && fs > 14) { fs = 14; ls = 0.8; lines = tx.wrap(nm, maxW, tx.f(14, 600), 2, ls); }
      if (!lines) continue;
      // at the smallest size the label fades out over the last 24 px of width it needs, instead of vanishing
      let fa = 1;
      if (fs <= 14 && !tx.wrap(nm, maxW - 24, tx.f(fs, 600), 2, ls)) {
        let lo = maxW - 24, hi = maxW;
        for (let i = 0; i < 4; i++) { const mid = (lo + hi) / 2; if (tx.wrap(nm, mid, tx.f(fs, 600), 2, ls)) hi = mid; else lo = mid; }
        fa = clamp((maxW - hi) / 24, 0, 1);
        if (fa <= 0.01) continue;
      }
      const aa = a * fa; ctx.globalAlpha = aa;
      const lh = fs * 1.08, blockH = lines.length * lh, inHeader = hh >= blockH + 14, topLimit = Math.max(v.c0y, e.cam.SAFE.t) + 8, x = r.x + 14;
      let y = Math.max(r.y + 8, Math.min(topLimit, r.y + r.h - blockH - 30));
      if (y > r.y + 8 && !inHeader) y = r.y + 8;
      const pw = Math.max(...lines.map((l) => tx.w(l, tx.f(fs, 600), ls)));
      if (!inHeader || y > r.y + 8) { ctx.fillStyle = th.alpha(th.labelBg, 0.92); ctx.fillRect(x - 6, y - 3, pw + 12, blockH + 8); }
      // world units, so the flags (drawn at the live camera) can find it between rasters
      const ox = v.FW / 2 - v.x * k, oy = v.FH / 2 - v.y * k;
      if (y === r.y + 8) R.labelBox = { x: (x - 6 - ox) / k, y: (y - 3 - oy) / k, w: (pw + 12) / k, h: (blockH + 8) / k };
      lines.forEach((l, i) => drawText(ctx, l, x, y + lh * (i + 0.8), tx.f(fs, 600), th.inkHi, null, ls));
      if (inHeader && hh >= blockH + 34 && y === r.y + 8) {
        const ag = aggParts(e, R.feats), af = tx.f(13, 500), avail = r.w - 28 - (ag.trouble ? 92 : 0) - (r.w > 420 && hh > 70 ? 110 : 0) - (pins ? 38 : 0);
        const s = tx.fit(ag.lens ?? ag.general, avail, af);
        if (s) drawText(ctx, s, x, y + blockH + 17, af, ag.lens ? e.accentOf(top) : th.inkA(0.8));
        if (ag.trouble && s) drawText(ctx, e.words.inTrouble(ag.trouble), x + tx.w(s, af) + 12, y + blockH + 17, tx.f(13, 600), th.red2);
      }
      ctx.globalAlpha = 1;
    }
  }
}

function drawWingLabels(e: Engine, ctx: CanvasRenderingContext2D, v: View, B: BldNode): void {
  const { th, tx } = e, k = v.k, top = e.mixS.top;
  const vis = B.wings.filter((W) => W.w * k >= 80);
  if (!vis.length) return;
  let FS = 14, ML = 2;
  for (let f1 = 22; f1 >= 14 && ML === 2; f1--) if (vis.every((W) => tx.wrap(W.def.name.toUpperCase(), W.w * k - 34, tx.f(f1, 600), 1, f1 * 0.05))) { FS = f1; ML = 1; }
  if (ML === 2) for (let f2 = 20; f2 >= 14; f2--) if (vis.every((W) => tx.wrap(W.def.name.toUpperCase(), W.w * k - 34, tx.f(f2, 600), 2, f2 * 0.05))) { FS = f2; break; }
  for (const W of B.wings) {
    const a = clamp((W.w * k - 80) / 10, 0, 1); if (a <= 0) continue;
    const r = rs(v, W, scratch); if (r.x > v.c1x || r.x + r.w < v.c0x) continue;
    const base = r.y - 10, x = r.x + 6, wdt = r.w - 14;
    if (base < v.c0y - 10 || base > v.c1y + 120) continue;
    ctx.globalAlpha = a;
    const ag = aggParts(e, W.feats);
    if (top) drawHealthBar(ctx, th, x, base - 6, wdt, 7, healthOf(W.feats, top)); else drawStageBar(ctx, th, x, base - 6, wdt, 7, ag.c);
    const af = tx.f(13, 500), tf = tx.f(13, 600), parts = ag.lens ?? ag.general, shortParts = ag.lensShort ?? ag.generalShort;
    const trS = ag.trouble ? e.words.inTrouble(ag.trouble) : '', tr = ag.trouble ? tx.w(trS, tf) + 10 : 0;
    let s = tx.fit(parts, wdt - tr, af);
    if (s && !s.includes('·')) s = tx.fit(shortParts, wdt - tr, af) ?? s;
    if (s) drawText(ctx, s, x, base - 14, af, ag.lens ? e.accentOf(top) : th.ink, th.halo);
    if (ag.trouble) { ctx.textAlign = 'right'; drawText(ctx, trS, x + wdt, base - 14, tf, th.red2, th.halo); ctx.textAlign = 'left'; }
    // the swarm line's place: the wing's RFI pin and how many asks wait there (bp draws it beside the agent survey marks)
    const asks = asksOf(e, W.feats), sy = base - 32;
    if (asks.n) {
      const askF = tx.f(13, 600, true), askW = tx.w(String(asks.n), askF) + 26;
      glyphPin(ctx, th, x + wdt - askW + 8, sy + 4, asks.high ? 'high' : 'med', true, 0.62, 0, 0, tx.f(12, 600, true));
      drawText(ctx, String(asks.n), x + wdt - askW + 22, sy, askF, asks.high ? th.red2 : th.amber2, th.halo);
    }
    const nm = W.def.name.toUpperCase(), ly = base - (asks.n ? 56 : 38);
    let fs = FS, lines = tx.wrap(nm, W.w * k - 34, tx.f(fs, 600), ML, fs * 0.05), bub = true;
    if (!lines) { fs = 12.5; lines = tx.wrap(nm, wdt, tx.f(fs, 600), 2, 0.5); bub = false; }
    if (bub) {
      ctx.beginPath(); ctx.arc(x + 11, ly - 7, 11, 0, 7); ctx.fillStyle = th.labelBg; ctx.fill(); ctx.strokeStyle = th.ink; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.textAlign = 'center'; drawText(ctx, W.def.letter, x + 11, ly - 2.5, tx.f(13, 500, true), th.ink); ctx.textAlign = 'left';
    }
    if (lines) lines.slice().reverse().forEach((l, i) => drawText(ctx, l, x + (bub ? 28 : 0), ly - i * fs * 1.1, tx.f(fs, 600), th.inkHi, th.halo, bub ? fs * 0.05 : 0.5));
  }
  ctx.globalAlpha = 1;
}

function drawChronology(e: Engine, ctx: CanvasRenderingContext2D, v: View, B: BldNode): void {
  const { th, tx } = e, r = rs(v, B, scratch);
  if (r.w < 560) return;
  const y = r.y + r.h + 22; if (y > e.cam.SAFE.b - 26) return;
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = th.inkA(0.55); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); ctx.stroke();
  ctx.fillStyle = th.inkA(0.75); ctx.beginPath(); ctx.moveTo(r.x + r.w + 6, y); ctx.lineTo(r.x + r.w - 4, y - 4); ctx.lineTo(r.x + r.w - 4, y + 4); ctx.fill();
  const f = tx.f(12, 500, true), t1 = e.words.oldestWork.toUpperCase(), t2 = e.words.newestWork.toUpperCase(), t3 = e.words.chronology.toUpperCase();
  for (const [t, px, al] of [[t1, r.x, 'left'], [t2, r.x + r.w - 10, 'right'], [t3, r.x + r.w / 2, 'center']] as const) {
    const w0 = tx.w(t, f), x0 = al === 'left' ? px : al === 'right' ? px - w0 : px - w0 / 2;
    if (al === 'center' && tx.w(t1, f) + tx.w(t2, f) + w0 + 60 > r.w) continue;
    ctx.fillStyle = th.paper; ctx.fillRect(x0 - 6, y - 8, w0 + 12, 16);
    ctx.textAlign = al; drawText(ctx, t, px, y + 4.5, f, th.inkA(0.8));
  }
  ctx.textAlign = 'left'; ctx.globalAlpha = 1;
}
