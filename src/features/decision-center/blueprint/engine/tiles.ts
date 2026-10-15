// Fixtures and ribbons (PORTED from bp src/engine/render/plan.ts paintTile / ribbon + flags' health marks, via the
// prototype): a feature as a fixture tile at room level and deeper, as a ribbon segment above it. Stage is the
// fill and stroke, health the cloud or tick, the General strip one lens glyph per lens in the colour of its verdict.
import type { Feature } from '../standard/load';
import type { TileNode } from '../model/layout';
import { clamp, smooth } from './camera';
import type { Engine } from './Engine';
import { cloud, glyph, stageFill, stageStroke } from './glyphs';
import { drawText } from './text';

type H = Feature['health'];

export function healthMarks(e: Engine, ctx: CanvasRenderingContext2D, h: H, x: number, y: number, w: number, hh: number, compact: boolean): void {
  const th = e.th;
  if (compact) {
    if (h === 'bad') { ctx.fillStyle = th.red; ctx.fillRect(x, y - 3, w, 3); }
    else if (h === 'watch') { ctx.fillStyle = th.amber; ctx.fillRect(x, y - 3, w, 2); }
  } else if (h === 'bad') {
    ctx.strokeStyle = th.red; ctx.lineWidth = w < 40 ? 1.3 : 1.8; ctx.lineJoin = 'round';
    const r = clamp(w / 14, 2.4, 6);
    cloud(ctx, x - r * 0.8, y - r * 0.8, w + r * 1.6, hh + r * 1.6, r); ctx.stroke();
  } else if (h === 'watch' && w >= 22) {
    ctx.strokeStyle = th.amber; ctx.lineWidth = 2; ctx.lineCap = 'round';
    const tx = x + w - 12;
    ctx.beginPath(); ctx.moveTo(tx, y - 2); ctx.lineTo(tx + 4, y - 7); ctx.moveTo(tx + 5, y - 2); ctx.lineTo(tx + 9, y - 7); ctx.stroke(); ctx.lineCap = 'butt';
  }
}

/** How a feature reads under the current sheet: faded when the lens does not apply, hatched with `?` when unmeasured. */
export function verdict(e: Engine, f: Feature): { fade: number; unk: 0 | 1 } {
  const top = e.mixS.top;
  let measured = false, unknown = false;
  for (const l of e.plan.lenses) {
    if (measured) break;
    const h = f.lens[l.id]?.h;
    if (h === 'unmeasured') unknown = true; else if (h !== 'na') measured = true;
  }
  const hl = top ? f.lens[top]?.h : null;
  return { fade: hl === 'na' ? 0.35 : 1, unk: (!measured && unknown && !top) || hl === 'unmeasured' ? 1 : 0 };
}

/** General's strip: one slot per lens across the top edge, its glyph in the colour of its verdict. */
function strip(e: Engine, ctx: CanvasRenderingContext2D, f: Feature, x: number, y: number, w: number, h: number, a: number): void {
  const th = e.th, ls = e.plan.lenses, n = ls.length, sw = (w - 12) / n, gs = clamp(Math.min(sw * 0.55, h * 0.13), 5, 10), top = e.mixS.top;
  for (let i = 0; i < n; i++) {
    const l = ls[i]!, v = f.lens[l.id]?.h ?? 'unmeasured', cx = x + 6 + sw * (i + 0.5);
    const col = v === 'bad' ? th.red : v === 'watch' ? th.amber : v === 'good' ? th.inkA(0.9) : th.inkA(0.42);
    ctx.globalAlpha = a * (top && top !== l.id ? 0.35 : 1) * (v === 'na' ? 0.6 : 1);
    glyph(ctx, l.glyph, cx - gs / 2, y + 3.5, gs, col, 1.4);
    if (v === 'good') { ctx.fillStyle = col; ctx.fillRect(cx - gs / 2, y + 3.5 + gs + 2, gs, 1.2); }
  }
  ctx.globalAlpha = a;
}

/** The value a lens sheet prints on a tile: "<measure label> <value>", else the verdict word. */
function lensWord(e: Engine, f: Feature, lensId: string): string {
  const L = e.plan.LENS[lensId], fl = f.lens[lensId];
  const m = L?.measures, val = m && fl ? fl.v[m.key] : undefined;
  if (m && val !== undefined) return `${m.label.toUpperCase()} ${val}${m.type === 'percent' ? '%' : ''}`;
  return e.words.verdict(fl?.h ?? 'unmeasured').toUpperCase();
}

export function paintTile(e: Engine, ctx: CanvasRenderingContext2D, T: TileNode, alphaMul: number): void {
  const f = T.f, th = e.th, k = e.cam.k, tx = e.tx, cam = e.cam;
  const x = cam.sx(T.x), y = cam.sy(T.y), w = T.w * k, h = T.h * k;
  if (x > cam.FW + 10 || y > cam.FH + 10 || x + w < -10 || y + h < -10) return;
  const st = f.stage, vd = verdict(e, f);
  const a = alphaMul * vd.fade;
  if (a <= 0.01) return;
  ctx.globalAlpha = a;
  const rr = Math.min(th.radius * k * 1.5, 7);
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, rr); ctx.clip();
  ctx.fillStyle = th.tileBase; ctx.fillRect(x, y, w, h);
  stageFill(ctx, th, st, x, y, w, h);
  if (st === 'live' && h > 20) { ctx.fillStyle = th.alpha(th.live, 0.85); ctx.fillRect(x, y + h - Math.max(2, 3 * k), w, Math.max(2, 3 * k)); }
  ctx.restore();
  stageStroke(ctx, th, st, a, w < 30 ? 1 : 1.5); ctx.beginPath(); ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, rr); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = a;
  const m = e.mixS, hl = m.top ? f.lens[m.top]?.h ?? 'unmeasured' : f.health;
  healthMarks(e, ctx, hl, x, y, w, h, false);
  if (w >= 60) strip(e, ctx, f, x, y, w, h, a);
  if (vd.unk) { const q = th.pattern('q', 30, th.inkA(1), 1); if (q) { ctx.globalAlpha = a * 0.16; ctx.fillStyle = q; ctx.fillRect(x + 3, y + 3, w - 6, h - 6); ctx.globalAlpha = a; } }
  e.budget.of++;
  if (!(w >= 100 && h >= 44)) { ctx.globalAlpha = 1; return; }
  e.budget.names++;
  const ta = a * clamp((w - 100) / 14, 0, 1) * clamp((h - 44) / 8, 0, 1);
  const bigA = clamp((w - 150) / 16, 0, 1) * clamp((h - 64) / 8, 0, 1) >= 0.5;
  const hy = y + 3 + clamp(h * 0.07, 3, 6) + 12 + 8;
  ctx.globalAlpha = ta;
  if (bigA) {
    const mono = tx.f(12, 500, true), word = st ? e.words.stage(st).toUpperCase() : e.words.notDrawn.toUpperCase();
    ctx.textAlign = 'right';
    const ev = tx.fit([m.top ? lensWord(e, f, m.top) : word], w - 14, mono);
    if (ev) drawText(ctx, ev, x + w - 7, hy, mono, m.top ? e.accentOf(m.top) : th.ink);
    ctx.textAlign = 'left';
    let stamp: string | null = null;
    if (m.top) { const lv = f.lens[m.top]; if (lv && (lv.h === 'bad' || lv.h === 'watch')) stamp = lv.short || lv.why; }
    else if (f.trouble[0]?.h === 'bad') stamp = (f.trouble[0].short || f.trouble[0].why) + (f.trouble.length > 1 ? ' +' + (f.trouble.length - 1) : '');
    const l3 = smooth(0.78, 0.94, k / cam.fitKOf(T.bay));
    const roomH = h - (hy - y) - 8 - (stamp ? 20 : 6);
    let lh = 0, nf = '', lines: string[] | null = null;
    for (let ns = Math.round(2 * clamp(13.5 + (w - 150) / 60, 14, 17) * (1 + l3)) / 2; ns >= 14; ns -= 2) {
      lh = ns * 1.16; nf = tx.f(ns, 500); lines = tx.wrap(f.name, w - 14, nf, Math.max(1, Math.floor(roomH / lh)));
      if (lines) break;
    }
    if (!lines) { nf = tx.f(14, 500); lh = 16.2; lines = tx.wrap(f.name, w - 14, nf, Math.max(1, Math.floor(roomH / lh))) || [f.name]; }
    lines.forEach((ln, i) => drawText(ctx, ln, x + 7, hy + 6 + lh * (i + 0.82), nf, th.inkHi));
    if (stamp) {
      const sf = tx.f(13, 600), s = tx.fit([stamp], w - 40, sf) || tx.fit([stamp.split(' ').slice(0, 4).join(' ') + '…'], w - 40, sf);
      if (s) drawText(ctx, s, x + 7, y + h - 7, sf, th.red2, th.halo);
    }
  } else {
    const nf2 = tx.f(13, 500), l2 = 15, lines2 = tx.wrap(f.name, w - 12, nf2, Math.max(1, Math.floor((h - 12 - (hy - y - 12)) / l2)));
    if (lines2) {
      const top2 = hy - 12 + (h - (hy - y - 12) - lines2.length * l2) / 2;
      lines2.forEach((ln, j) => drawText(ctx, ln, x + 6, top2 + l2 * (j + 0.78), nf2, th.inkHi));
    }
  }
  ctx.globalAlpha = 1;
}

export function ribSeg(e: Engine, ctx: CanvasRenderingContext2D, f: Feature, x: number, y: number, w: number, h: number, a0: number): void {
  const th = e.th, st = f.stage, vd = verdict(e, f), aa = a0 * vd.fade;
  if (aa <= 0.01) return;
  ctx.globalAlpha = aa; ctx.fillStyle = th.tileBase; ctx.fillRect(x, y, w, h);
  stageFill(ctx, th, st, x, y, w, h);
  if (!st || st === 'specified' || st === 'idea') { stageStroke(ctx, th, st, aa, 1); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.setLineDash([]); ctx.globalAlpha = aa; }
  const m = e.mixS;
  healthMarks(e, ctx, m.top ? f.lens[m.top]?.h ?? 'unmeasured' : f.health, x, y, w, h, true);
  if (vd.unk && w > 10) { ctx.globalAlpha = aa * 0.34; ctx.fillStyle = th.ink; ctx.font = `600 12px ${th.sans}`; ctx.textAlign = 'center'; ctx.fillText('?', x + w / 2, y + h / 2 + 4); ctx.textAlign = 'left'; }
  ctx.globalAlpha = 1;
}
