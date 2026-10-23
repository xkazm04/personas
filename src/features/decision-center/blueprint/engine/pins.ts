// The dynamic layer under the flags (PORTED from bp src/engine/render/dynamic.ts drawPins / drawOverlays selBox
// and hover / drawFocus, at u = 1), drawn at the live camera every frame: one RFI pennant per room on the site and
// wing plans and one per item on a fixture (bp's decisions are this sheet's waiting work: proposed flies amber, red
// at high risk; approved-not-built flies mint), the hover outline, the selection's dashed box in the lens accent,
// the current item's amber pulse, and the picked items' accent rings (bp drawTargets).
// EDIT (port): bp's agents, pulses, heat, conduits, breaches, previews and releases are driven by its simulation
// (scans.ts, simwatch.ts); the snapshot carries none of that, so they are not brought.
import type { Engine } from './Engine';
import { glyphPin } from './glyphs';
import { featRect } from './plan';
import { onView, rs, type SRect, type View } from './view';

/** Items at or above this risk (the store's 1-10) fly the high pennant. */
const HIGH_RISK = 4;
const sr: SRect = { x: 0, y: 0, w: 0, h: 0 }, sr2: SRect = { x: 0, y: 0, w: 0, h: 0 };
const phase = (e: Engine, t: number) => (e.cam.reduced() ? 0 : t % 1);

export function drawPins(e: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number): void {
  const th = e.th, pf = e.tx.f(12, 600, true), m = e.mixS;
  if (lod < 0.995) {
    ctx.save();
    for (const R of e.plan.L.rooms) {
      let n = 0, emph = 0, hi = false, ok = 0;
      for (const f of R.feats) for (const p of e.waitingOf(f)) {
        if (p.status !== 'proposed') { ok++; continue; }
        n++;
        if (m.p(p.lens)) { emph++; if ((p.risk ?? 0) >= HIGH_RISK) hi = true; }
      }
      if (!n && !ok) continue;
      const r = rs(v, R, sr); if (!onView(v, r, 30)) continue;
      ctx.globalAlpha = 1 - lod;
      glyphPin(ctx, th, r.x + r.w - 18, r.y + 32, !n ? 'ok' : hi ? 'high' : emph ? 'med' : 'low', n ? emph > 0 : true, 0.9, n || ok, 0, pf);
    }
    ctx.restore();
  }
  if (lod > 0.005) {
    ctx.save(); ctx.globalAlpha = lod;
    for (const T of e.plan.L.tiles) {
      const ws = e.waitingOf(T.f); if (!ws.length) continue;
      const r = rs(v, T, sr); if (!onView(v, r, 20) || r.w < 40) continue;
      const max = Math.max(1, Math.floor((r.w - 30) / 18));
      ws.slice(0, max).forEach((p, j) => {
        const ring = e.focus?.pid === p.id ? phase(e, now / 1200) : 0;
        const state = p.status === 'approved' ? 'ok' : (p.risk ?? 0) >= HIGH_RISK ? 'high' : 'med';
        glyphPin(ctx, th, r.x + r.w - 12 - j * 18, r.y + r.h - 5, state, m.p(p.lens) === 1, 0.85, j === max - 1 && ws.length > max ? ws.length : 0, ring, pf);
      });
    }
    ctx.restore();
  }
}

/** Hover and selection (bp drawOverlays): the hovered fixture in ink-hi, the selected one in a dashed box in the lens accent. */
export function drawOverlays(e: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number): void {
  const th = e.th, sel = e.focus?.fid;
  if (sel && e.plan.L.TILE[sel]) {
    const r = featRect(e, v, sel, lod, sr);
    if (r) {
      const pad = Math.min(14, Math.max(5, r.w * 0.12));
      ctx.save(); ctx.strokeStyle = e.accentOf(e.mixS.top); ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = e.cam.reduced() ? 0 : -((now / 40) % 1000) * 0.6;
      ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2); ctx.restore();
    }
  }
  if (e.hot && e.plan.L.TILE[e.hot]) {
    const r = featRect(e, v, e.hot, lod, sr);
    if (r) { ctx.strokeStyle = th.inkHi; ctx.lineWidth = 2.5; ctx.strokeRect(r.x, r.y, r.w, r.h); }
  }
}

/**
 * The picked items (bp drawTargets): every feature a picked work item stands on, filled faintly in the accent and
 * ringed with a moving accent dash; a room whose every feature is picked is ringed whole instead.
 */
export function drawTargets(e: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number): void {
  const ids = e.pickedF;
  if (!ids.size) return;
  const th = e.th;
  ctx.save(); ctx.strokeStyle = th.accent; ctx.lineWidth = 2; ctx.setLineDash([7, 4]);
  ctx.lineDashOffset = e.cam.reduced() ? 0 : -((performance.now() / 40) % 1000);
  for (const R of e.plan.L.rooms) {
    let c = 0;
    for (const f of R.feats) if (ids.has(f.id)) c++;
    if (!c) continue;
    const r = rs(v, R, sr); if (!onView(v, r, 10)) continue;
    if (c === R.feats.length && R.feats.length > 1) { ctx.fillStyle = th.alpha(th.accent, 0.09); ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8); continue; }
    for (const f of R.feats) {
      if (!ids.has(f.id)) continue;
      const fr = featRect(e, v, f.id, lod, sr2); if (!fr) continue;
      ctx.fillStyle = th.alpha(th.accent, 0.14); ctx.fillRect(fr.x, fr.y, fr.w, fr.h); ctx.strokeRect(fr.x - 2, fr.y - 2, fr.w + 4, fr.h + 4);
    }
  }
  ctx.restore();
}

/** The current item (bp drawFocus over an open decision): an amber ring pulsing out from the fixture's centre. */
export function drawFocus(e: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number): void {
  const F = e.focus;
  if (!F || !F.pid) return;
  const fr = featRect(e, v, F.fid, lod, sr); if (!fr) return;
  const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2, pu = phase(e, now / 1100);
  ctx.save(); ctx.strokeStyle = e.th.amber; ctx.globalAlpha = 1 - pu; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx, cy, 12 + pu * 26, 0, 6.2832); ctx.stroke(); ctx.restore();
}
