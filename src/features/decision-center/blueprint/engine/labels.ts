// Place labels (PORTED from bp src/engine/render/plan.ts drawBayTags / drawRoomLabels / drawWingLabels /
// drawChronology, via the prototype): bay tags (code, name, count, waiting), room names on paper, wing titles with
// letter bubbles, the stage or health bar and the stats line above each wing, and the chronology rule. Every word
// comes from `e.words`; nothing here owns a string.
import type { Feature } from '../standard/load';
import { counts, healthOf } from '../model/aggregates';
import { BH, RH } from '../model/layout';
import type { BldNode } from '../model/layout';
import { clamp } from './camera';
import type { Engine } from './Engine';
import { drawHealthBar, drawStageBar, glyphPin } from './glyphs';
import { drawText } from './text';

interface Agg { c: ReturnType<typeof counts>; general: string[]; short: string[]; lens: string[] | null; trouble: number }

function aggParts(e: Engine, fs: readonly Feature[]): Agg {
  const c = counts(fs), top = e.mixS.top, w = e.words;
  const bad = fs.filter((f) => (top ? f.lens[top]?.h === 'bad' : f.health === 'bad')).length;
  const stages = [w.live(c.live), w.building(c.build)];
  if (c.flagged) stages.push(w.partlyOpen(c.flagged));
  stages.push(w.onPaper(c.paper));
  if (c.dep) stages.push(w.demolish(c.dep));
  const hc = top ? healthOf(fs, top) : null;
  return {
    c, general: [w.features(c.n), ...stages], short: [String(c.n), ...stages],
    lens: hc ? [w.features(c.n), w.good(hc.good), w.watch(hc.watch), w.bad(hc.bad), w.unmeasured(hc.na + hc.unmeasured)] : null, trouble: bad,
  };
}

/** Proposed (not yet decided) work under a feature set that the current sheet shows. */
function waitingCount(e: Engine, fs: readonly Feature[]): number {
  let n = 0;
  for (const f of fs) for (const p of e.waitingOf(f)) if (p.status === 'proposed' && e.mixS.p(p.lens)) n++;
  return n;
}

export function drawLabels(e: Engine, ctx: CanvasRenderingContext2D): void {
  const B = e.plan.L.bld;
  drawBayTags(e, ctx, B); drawRoomLabels(e, ctx, B); drawWingLabels(e, ctx, B); drawChronology(e, ctx, B);
}

function drawBayTags(e: Engine, ctx: CanvasRenderingContext2D, B: BldNode): void {
  const { th, tx, cam } = e, k = cam.k;
  if (BH * k < 23) return;
  const cf = tx.f(12, 500, true), nf = tx.f(13.5, 600);
  ctx.globalAlpha = clamp((BH * k - 23) / 12, 0, 1);
  for (const W of B.wings) for (const R of W.rooms) for (const Bay of R.bays) {
    const r = cam.rs(Bay);
    if (!e.onView(r)) continue;
    const code = Bay.cap.code, nm = Bay.cap.name.toUpperCase(), cw = tx.w(code, cf) + 12, nw = tx.w(nm, nf, 0.7) + 12, cnt = String(Bay.tiles.length), kw = tx.w(cnt, cf) + 12;
    let full = cw + nw + kw;
    const th2 = 22, x = r.x, y = r.y + Math.max(1, (BH * k - th2) / 2 - 3), showCode = !!code && full <= r.w;
    if (!showCode && nw <= r.w) full = nw; else if (!showCode) continue;
    const wait = waitingCount(e, Bay.feats);
    ctx.fillStyle = th.labelBg; ctx.fillRect(x, y, full, th2); ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, full - 1, th2 - 1);
    let xx = x;
    if (showCode) { drawText(ctx, code, xx + 6, y + 15.5, cf, th.inkA(0.72)); xx += cw; ctx.beginPath(); ctx.moveTo(xx + 0.5, y); ctx.lineTo(xx + 0.5, y + th2); ctx.stroke(); }
    drawText(ctx, nm, xx + 6, y + 16, nf, th.inkHi, null, 0.7); xx += nw;
    if (showCode) { ctx.beginPath(); ctx.moveTo(xx + 0.5, y); ctx.lineTo(xx + 0.5, y + th2); ctx.stroke(); drawText(ctx, cnt, xx + 6, y + 15.5, cf, th.inkA(0.72)); xx += kw; }
    // the bay's waiting work, stated beside its feature count
    const ws = wait ? e.words.waiting(wait) : '';
    if (wait && xx + 30 + tx.w(ws, cf) < r.x + r.w) { glyphPin(ctx, th, xx + 12, y + 19, 'med', true, 0.7, 0, 0, cf); drawText(ctx, ws, xx + 24, y + 15.5, cf, th.amber2, th.halo); }
  }
  ctx.globalAlpha = 1;
}

function drawRoomLabels(e: Engine, ctx: CanvasRenderingContext2D, B: BldNode): void {
  const { th, tx, cam } = e, k = cam.k;
  for (const W of B.wings) {
    const a = clamp((W.w * k - 100) / 8, 0, 1);
    for (const R of W.rooms) R.labelBox = null;
    if (a <= 0) continue;
    for (const R of W.rooms) {
      const r = cam.rs(R);
      if (!e.onView(r)) continue;
      const hh = RH * k, nm = R.d.name.toUpperCase(), maxW = r.w - 28 - 26;
      let fs = clamp(hh * 0.36, 14, 26), ls = fs * 0.06, lines = tx.wrap(nm, maxW, tx.f(fs, 600), 2, ls);
      if (!lines && fs > 14) { fs = 14; ls = 0.8; lines = tx.wrap(nm, maxW, tx.f(14, 600), 2, ls); }
      if (!lines) continue;
      ctx.globalAlpha = a;
      const lh = fs * 1.08, blockH = lines.length * lh, inHeader = hh >= blockH + 14, topLimit = Math.max(0, cam.SAFE.t) + 8, x = r.x + 14;
      let y = Math.max(r.y + 8, Math.min(topLimit, r.y + r.h - blockH - 30));
      if (y > r.y + 8 && !inHeader) y = r.y + 8;
      const pw = Math.max(...lines.map((l) => tx.w(l, tx.f(fs, 600), ls)));
      if (!inHeader || y > r.y + 8) { ctx.fillStyle = th.alpha(th.labelBg, 0.92); ctx.fillRect(x - 6, y - 3, pw + 12, blockH + 8); }
      if (y === r.y + 8) R.labelBox = { x: cam.wx(x - 6), y: cam.wy(y - 3), w: (pw + 12) / k, h: (blockH + 8) / k };
      lines.forEach((l, i) => drawText(ctx, l, x, y + lh * (i + 0.8), tx.f(fs, 600), th.inkHi, null, ls));
      if (inHeader && hh >= blockH + 34 && y === r.y + 8) {
        const ag = aggParts(e, R.feats), af = tx.f(13, 500), avail = r.w - 28 - (ag.trouble ? 92 : 0) - 40;
        const s = tx.fit(ag.lens ?? ag.general, avail, af), top = e.mixS.top;
        if (s) drawText(ctx, s, x, y + blockH + 17, af, top ? e.accentOf(top) : th.inkA(0.8));
        if (ag.trouble && s) drawText(ctx, e.words.inTrouble(ag.trouble), x + tx.w(s, af) + 12, y + blockH + 17, tx.f(13, 600), th.red2);
      }
      ctx.globalAlpha = 1;
    }
  }
}

function drawWingLabels(e: Engine, ctx: CanvasRenderingContext2D, B: BldNode): void {
  const { th, tx, cam } = e, k = cam.k;
  const vis = B.wings.filter((W) => W.w * k >= 80);
  if (!vis.length) return;
  let FS = 14, ML = 2;
  for (let f1 = 22; f1 >= 14 && ML === 2; f1--) if (vis.every((W) => tx.wrap(W.def.name.toUpperCase(), W.w * k - 34, tx.f(f1, 600), 1, f1 * 0.05))) { FS = f1; ML = 1; }
  if (ML === 2) for (let f2 = 20; f2 >= 14; f2--) if (vis.every((W) => tx.wrap(W.def.name.toUpperCase(), W.w * k - 34, tx.f(f2, 600), 2, f2 * 0.05))) { FS = f2; break; }
  const top = e.mixS.top;
  for (const W of B.wings) {
    const a = clamp((W.w * k - 80) / 10, 0, 1);
    if (a <= 0) continue;
    const r = cam.rs(W);
    if (r.x > cam.FW || r.x + r.w < 0) continue;
    const base = r.y - 10, x = r.x + 6, wdt = r.w - 14;
    if (base < -10 || base > cam.FH + 120) continue;
    ctx.globalAlpha = a;
    const ag = aggParts(e, W.feats);
    if (top) drawHealthBar(ctx, th, x, base - 6, wdt, 7, healthOf(W.feats, top)); else drawStageBar(ctx, th, x, base - 6, wdt, 7, ag.c);
    const af = tx.f(13, 500), tf = tx.f(13, 600), troubleS = ag.trouble ? e.words.inTrouble(ag.trouble) : '', trW = ag.trouble ? tx.w(troubleS, tf) + 10 : 0;
    // the wing's waiting work rides the stats line, right-aligned before any trouble count: never over the wing's name
    const asks = waitingCount(e, W.feats), askF = tx.f(12, 600, true), askW = asks ? tx.w(String(asks), askF) + 24 : 0;
    let s = tx.fit(ag.lens ?? ag.general, wdt - trW - askW, af);
    if (s && !s.includes('·') && !top) s = tx.fit(ag.short, wdt - trW - askW, af) || s;
    if (asks) { const ax = x + wdt - trW - askW + 6; glyphPin(ctx, th, ax, base - 11, 'med', true, 0.62, 0, 0, askF); drawText(ctx, String(asks), ax + 12, base - 14, askF, th.amber2, th.halo); }
    if (s) drawText(ctx, s, x, base - 14, af, top ? e.accentOf(top) : th.ink, th.halo);
    if (ag.trouble) { ctx.textAlign = 'right'; drawText(ctx, troubleS, x + wdt, base - 14, tf, th.red2, th.halo); ctx.textAlign = 'left'; }
    const nm = W.def.name.toUpperCase();
    let fs = FS, lines = tx.wrap(nm, W.w * k - 34, tx.f(fs, 600), ML, fs * 0.05), bub = true;
    const ly = base - 38;
    if (!lines) { fs = 12.5; lines = tx.wrap(nm, wdt, tx.f(fs, 600), 2, 0.5); bub = false; }
    if (bub) {
      ctx.beginPath(); ctx.arc(x + 11, ly - 7, 11, 0, 7); ctx.fillStyle = th.labelBg; ctx.fill(); ctx.strokeStyle = th.ink; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.textAlign = 'center'; drawText(ctx, W.def.letter, x + 11, ly - 2.5, tx.f(13, 500, true), th.ink); ctx.textAlign = 'left';
    }
    if (lines) lines.slice().reverse().forEach((l, i) => drawText(ctx, l, x + (bub ? 28 : 0), ly - i * fs * 1.1, tx.f(fs, 600), th.inkHi, th.halo, bub ? fs * 0.05 : 0.5));
  }
  ctx.globalAlpha = 1;
}

function drawChronology(e: Engine, ctx: CanvasRenderingContext2D, B: BldNode): void {
  const { th, tx, cam } = e, r = cam.rs(B);
  if (r.w < 560) return;
  const y = r.y + r.h + 22;
  if (y > cam.SAFE.b - 26) return;
  ctx.globalAlpha = 0.95; ctx.strokeStyle = th.inkA(0.55); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); ctx.stroke();
  ctx.fillStyle = th.inkA(0.75); ctx.beginPath(); ctx.moveTo(r.x + r.w + 6, y); ctx.lineTo(r.x + r.w - 4, y - 4); ctx.lineTo(r.x + r.w - 4, y + 4); ctx.fill();
  const f = tx.f(12, 500, true), { oldestWork: t1, newestWork: t2, chronology: t3 } = e.words;
  const marks: [string, number, CanvasTextAlign][] = [[t1.toUpperCase(), r.x, 'left'], [t2.toUpperCase(), r.x + r.w - 10, 'right'], [t3.toUpperCase(), r.x + r.w / 2, 'center']];
  for (const [text, px, al] of marks) {
    const w0 = tx.w(text, f), x0 = al === 'left' ? px : al === 'right' ? px - w0 : px - w0 / 2;
    if (al === 'center' && tx.w(t1.toUpperCase(), f) + tx.w(t2.toUpperCase(), f) + w0 + 60 > r.w) continue;
    ctx.fillStyle = th.paper; ctx.fillRect(x0 - 6, y - 8, w0 + 12, 16); ctx.textAlign = al; drawText(ctx, text, px, y + 4.5, f, th.inkA(0.8));
  }
  ctx.textAlign = 'left'; ctx.globalAlpha = 1;
}
