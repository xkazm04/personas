// Trouble flags (PORTED from bp src/engine/render/flags.ts): per feature and lens, red for bad and amber for watch,
// drawn above the fixture (or its ribbon segment) with the lens glyph on them, and CLUSTERED with a count when two
// would collide. A flag steps aside from the room's label box.
import { clamp } from './camera';
import type { Engine } from './Engine';
import { glyph } from './glyphs';
import { drawText } from './text';
import type { FlagBox } from './types';

export function layoutFlags(e: Engine): FlagBox[] {
  const lod = e.cam.lod(), tile = lod > 0.5, m = e.mixS, ids = e.plan.lenses.map((l) => l.id), n = ids.length;
  const cands: FlagBox[] = [], out: FlagBox[] = [];
  const gap = tile ? 4 : 4 + 22 * (1 - lod / 0.5), { cam } = e;
  for (const f of e.plan.S.features) {
    if (!f.trouble.length) continue;
    const r = e.featRect(f.id, lod);
    if (!r || r.x > cam.FW + 60 || r.x + r.w < -60 || r.y > cam.FH + 80 || r.y < -80) continue;
    const S = tile ? clamp(r.w * 0.12, 32, 44) : 32, T = e.plan.L.TILE[f.id];
    for (const t of f.trouble) {
      if (!m.p(t.lens)) continue;
      const li = ids.indexOf(t.lens), s = t.h === 'bad' ? S : S * 0.8, w = s * 1.1, tip = s * 0.26;
      const tipX = tile ? r.x + r.w * ((li + 0.5) / n) : r.x + r.w / 2, tipY = r.y + (tile ? 2 : 0);
      let x = tipX - w / 2;
      const lb = T?.room.labelBox;
      if (lb) {
        const lx = cam.sx(lb.x), ly = cam.sy(lb.y), lw = lb.w * cam.k, lh = lb.h * cam.k, y = tipY - tip - s;
        if (x < lx + lw && x + w > lx && y < ly + lh && y + s > ly) x = Math.max(x, lx + lw + 3);
      }
      cands.push({ x, y: tipY - tip - s, w, h: s, tipX, tipY, bad: t.h === 'bad', lens: t.lens, fid: f.id, fids: [f.id], lenses: [t.lens] });
    }
  }
  cands.sort((p, q) => Number(q.bad) - Number(p.bad) || p.tipX - q.tipX);
  for (const c of cands) {
    const hit = out.find((o) => c.x < o.x + o.w + gap && c.x + c.w + gap > o.x && c.y < o.y + o.h + o.h * 0.26 + gap && c.y + c.h + c.h * 0.26 + gap > o.y);
    if (hit) { hit.fids.push(c.fid); hit.lenses.push(c.lens); } else out.push(c);
  }
  return out;
}

export function drawFlags(e: Engine, ctx: CanvasRenderingContext2D): void {
  const { th } = e, nf = e.tx.f(12, 700, true);
  ctx.save();
  for (let i = e.flags.length - 1; i >= 0; i--) {
    const F = e.flags[i]!, kk = e.hotFlag === F.fid + '|' + F.lens ? 1.12 : 1;
    const s = F.h * kk, w = F.w * kk, tip = s * 0.26, x = F.x + (F.w - w) / 2, y = F.tipY - tip - s;
    const col = F.bad ? th.red : th.amber, r = Math.min(5, s * 0.2), pw = Math.min(6, w * 0.2), bx = clamp(F.tipX, x + r + pw, x + w - r - pw), lead = Math.abs(bx - F.tipX) > pw * 1.5;
    if (lead) {
      ctx.beginPath(); ctx.moveTo(bx, y + s - 1); ctx.lineTo(F.tipX, F.tipY); ctx.strokeStyle = th.paper; ctx.lineWidth = 4.5; ctx.lineCap = 'round'; ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(F.tipX, F.tipY, 3.2, 0, 6.2832); ctx.fillStyle = col; ctx.fill();
    }
    ctx.beginPath(); ctx.roundRect(x, y, w, s, r);
    if (!lead) { ctx.moveTo(bx - pw, y + s - 0.5); ctx.lineTo(F.tipX, F.tipY); ctx.lineTo(bx + pw, y + s - 0.5); }
    ctx.lineJoin = 'round'; ctx.strokeStyle = th.paper; ctx.lineWidth = 3.5; ctx.stroke(); ctx.fillStyle = col; ctx.fill();
    const gs = s * 0.6;
    glyph(ctx, e.plan.LENS[F.lens]?.glyph ?? null, x + (w - gs) / 2, y + (s - gs) / 2, gs, th.glyphEdge, Math.max(1.8, s * 0.085));
    if (F.fids.length > 1) {
      const label = F.fids.length > 99 ? '99+' : String(F.fids.length), tw = e.tx.w(label, nf), bh = 17, bw = Math.max(bh, tw + 9), cx = x + w - bw * 0.55, cy = y - bh * 0.45;
      ctx.beginPath(); ctx.roundRect(cx, cy, bw, bh, bh / 2); ctx.fillStyle = th.paper; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.textAlign = 'center'; drawText(ctx, label, cx + bw / 2, cy + bh * 0.72, nf, th.inkHi); ctx.textAlign = 'left';
    }
  }
  ctx.restore();
}

export function flagAt(flags: readonly FlagBox[], px: number, py: number): FlagBox | null {
  for (const F of flags) if (px >= F.x - 3 && px <= F.x + F.w + 3 && py >= F.y - 3 && py <= F.tipY + 3) return F;
  return null;
}
