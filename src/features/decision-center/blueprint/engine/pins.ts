// Pins (PORTED from bp src/engine/render/dynamic.ts drawPins, via the prototype): one pennant per room on the site
// and wing plans, one per item on a fixture; waiting work flies amber (red when risk is high), approved-not-built
// work flies mint. Plus the focus ring: the current item's fixture, always where the eye was sent.
import type { Engine } from './Engine';
import { glyphPin } from './glyphs';

/** Items at or above this risk (the store's 1-10) fly the high pennant. */
const HIGH_RISK = 4;

export function drawPins(e: Engine, ctx: CanvasRenderingContext2D, now: number): void {
  const { th, cam } = e, lod = cam.lod(), pf = e.tx.f(12, 600, true), m = e.mixS;
  if (lod < 0.995) {
    ctx.save(); ctx.globalAlpha = 1 - lod;
    for (const R of e.plan.L.rooms) {
      let n = 0, emph = 0, ok = 0;
      for (const f of R.feats) for (const p of e.waitingOf(f)) {
        if (p.status === 'proposed') { n++; if (m.p(p.lens)) emph++; } else ok++;
      }
      if (!n && !ok) continue;
      const r = cam.rs(R);
      if (!e.onView(r, 30)) continue;
      glyphPin(ctx, th, r.x + r.w - 22, r.y + 32, n ? 'med' : 'ok', emph > 0 || (!n && ok > 0), 0.9, m.top ? emph : n, 0, pf);
    }
    ctx.restore();
  }
  if (lod > 0.005) {
    ctx.save(); ctx.globalAlpha = lod;
    for (const T of e.plan.L.tiles) {
      const ws = e.waitingOf(T.f);
      if (!ws.length) continue;
      const r = cam.rs(T);
      if (!e.onView(r, 20) || r.w < 40) continue;
      const max = Math.max(1, Math.floor((r.w - 30) / 18));
      ws.slice(0, max).forEach((p, j) => {
        const cur = e.focus?.pid === p.id, ring = cur && !cam.reduced() ? (now / 1200) % 1 : 0;
        glyphPin(ctx, th, r.x + r.w - 12 - j * 18, r.y + r.h - 5, p.status === 'approved' ? 'ok' : (p.risk ?? 0) >= HIGH_RISK ? 'high' : 'med', m.p(p.lens) === 1, 0.85, j === max - 1 && ws.length > max ? ws.length : 0, ring, pf);
      });
    }
    ctx.restore();
  }
}

export function drawFocus(e: Engine, ctx: CanvasRenderingContext2D, now: number): void {
  if (!e.focus) return;
  const r = e.featRect(e.focus.fid, e.cam.lod());
  if (!r) return;
  const th = e.th, p = e.cam.reduced() ? 0.5 : 0.5 + 0.5 * Math.sin(now / 320);
  ctx.save(); ctx.strokeStyle = th.focus; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.95;
  ctx.strokeRect(r.x - 5, r.y - 5, r.w + 10, r.h + 10);
  ctx.globalAlpha = 0.35 * p; ctx.lineWidth = 7; ctx.strokeRect(r.x - 9, r.y - 9, r.w + 18, r.h + 18);
  ctx.restore();
  if (e.hot) {
    const hr = e.featRect(e.hot, e.cam.lod());
    if (hr) { ctx.strokeStyle = th.inkHi; ctx.lineWidth = 1.5; ctx.strokeRect(hr.x - 2.5, hr.y - 2.5, hr.w + 5, hr.h + 5); }
  }
}
