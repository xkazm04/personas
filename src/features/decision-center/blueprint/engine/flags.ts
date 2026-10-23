// Trouble flags (PORTED from bp src/engine/render/flags.ts, near verbatim at u = 1): every lens that is bad or on
// watch for a feature raises a flag over it, drawn at the live camera on top of every other layer at an on-screen
// size that does not shrink with the zoom (32 px on the site plan, up to 44 px over large tiles; watch is 0.8 of
// bad). Flags that would collide merge into one cluster flag with a count. Over a tile, flags stand in registry
// order across its top edge; on a ribbon segment, over its middle. A flag steps clear of the room label in its
// header, of a room label pinned to the top of the view, and of the wing's title stack.
// EDIT (port): bp's `?flags=0` switch and its GA / lens-key dimming filters are not brought.
import type { RoomNode, WingNode } from '../model/layout';
import { RH } from '../model/layout';
import { clamp } from './camera';
import type { Engine } from './Engine';
import { glyph } from './glyphs';
import { featRect } from './plan';
import { drawText } from './text';
import type { FlagBox } from './types';
import { sxv, syv, type SRect, type View } from './view';

const sizeOf = (r: SRect, tile: boolean): number => (tile ? clamp(r.w * 0.12, 32, 44) : 32);
const tipOf = (s: number) => s * 0.26;
const sr: SRect = { x: 0, y: 0, w: 0, h: 0 }, tb: SRect = { x: 0, y: 0, w: 0, h: 0 };

/** Step the body (x, width w, top y, height s) clear of a box, to whichever side is nearer. */
function clear(x: number, y: number, w: number, s: number, bx: number, by: number, bw: number, bh: number): number {
  if (!(x < bx + bw && x + w > bx && y < by + bh && y + s > by)) return x;
  const r = bx + bw + 3, l = bx - w - 3;
  return r - x <= x - l ? r : l;
}
/** The room's label pinned to the top of the view (not in its header): where labels.ts draws it, or null. */
function pinnedBox(e: Engine, v: View, R: RoomNode, out: SRect): SRect | null {
  const k = v.k, hh = RH * k, ry = syv(v, R.y), rh = R.h * k, fs = clamp(hh * 0.36, 14, 26), ls = fs * 0.06;
  const maxW = R.w * k - 28 - (e.pinsDrawn() ? 38 : 0), tw = e.tx.w(R.d.name.toUpperCase(), e.tx.f(fs, 600), ls);
  if (tw > maxW * 2 || maxW <= 0) return null;
  const blockH = (tw > maxW ? 2 : 1) * fs * 1.08;
  if (hh < blockH + 14) return null;
  const y = Math.max(ry + 8, Math.min(Math.max(v.c0y, e.cam.SAFE.t) + 8, ry + rh - blockH - 30));
  if (y <= ry + 8) return null;
  out.x = sxv(v, R.x) + 8; out.y = y - 3; out.w = Math.min(tw, maxW) + 12; out.h = blockH + 8;
  return out;
}
/** The wing's title stack above it (bubble, name; up to two lines), generously. */
function wingBox(e: Engine, v: View, W: WingNode, out: SRect): SRect | null {
  const ww = W.w * v.k;
  if (ww < 80) return null;
  const base = syv(v, W.y) - 10, tw = 28 + e.tx.w(W.def.name.toUpperCase(), e.tx.f(18, 600), 1);
  out.x = sxv(v, W.x) + 6; out.w = Math.min(tw, ww - 14); out.y = base - 108; out.h = 74;
  return out;
}

// bad before watch, then left to right: the first flag placed in a spot keeps it
const byPlace = (p: FlagBox, q: FlagBox) => Number(q.bad) - Number(p.bad) || p.tipX - q.tipX;

/** Lay out this frame's flags (clustered), in draw order reversed: index 0 is drawn last, on top. */
export function layoutFlags(e: Engine, v: View, lod: number): FlagBox[] {
  const m = e.mixS, ids = e.plan.lenses.map((l) => l.id), n = ids.length, tile = lod > 0.5;
  // merge distance: generous on the site and wing plans (a few markers per room), tight over tiles
  const gap = tile ? 4 : 4 + 22 * (1 - lod / 0.5);
  const cands: FlagBox[] = [], out: FlagBox[] = [];
  for (const f of e.plan.S.features) {
    if (!f.trouble.length) continue;
    const r = featRect(e, v, f.id, lod, sr); if (!r) continue;
    if (r.x > v.FW + 60 || r.x + r.w < -60 || r.y > v.FH + 80 || r.y < -80) continue;
    const S = sizeOf(r, tile), tl = e.plan.L.TILE[f.id];
    for (const t of f.trouble) {
      if (!m.p(t.lens)) continue;
      const li = ids.indexOf(t.lens); if (li < 0) continue;
      const s = t.h === 'bad' ? S : S * 0.8, w = s * 1.1, tip = tipOf(s);
      const tipX = tile ? r.x + r.w * ((li + 0.5) / n) : r.x + r.w / 2, tipY = r.y + (tile ? 2 : 0);
      let x = tipX - w / 2;
      const lb = tl?.room.labelBox;
      if (lb) {
        const lx = sxv(v, lb.x), ly = syv(v, lb.y), lw = lb.w * v.k, lh = lb.h * v.k, y = tipY - tip - s;
        if (x < lx + lw && x + w > lx && y < ly + lh && y + s > ly) x = Math.max(x, lx + lw + 3);
      } else if (tl) {
        const pb = pinnedBox(e, v, tl.room, tb);
        if (pb) x = clear(x, tipY - tip - s, w, s, pb.x, pb.y, pb.w, pb.h);
      }
      if (tl) { const wb = wingBox(e, v, tl.wing, tb); if (wb) x = clear(x, tipY - tip - s, w, s, wb.x, wb.y, wb.w, wb.h); }
      cands.push({ x, y: tipY - tip - s, w, h: s, tipX, tipY, bad: t.h === 'bad', lens: t.lens, fid: f.id, fids: [f.id], lenses: [t.lens] });
    }
  }
  cands.sort(byPlace);
  for (const c of cands) {
    const hit = out.find((o) => c.x < o.x + o.w + gap && c.x + c.w + gap > o.x && c.y < o.y + o.h + tipOf(o.h) + gap && c.y + c.h + tipOf(c.h) + gap > o.y);
    if (hit) { hit.fids.push(c.fid); hit.lenses.push(c.lens); } else out.push(c);
  }
  return out;
}

/** Draw the flags of this frame; `hot` is the hovered one's key (drawn a little larger). */
export function drawFlags(e: Engine, ctx: CanvasRenderingContext2D, flags: readonly FlagBox[], hot: string | null): void {
  if (!flags.length) return;
  const th = e.th, nf = e.tx.f(12, 700, true);
  ctx.save();
  for (let i = flags.length - 1; i >= 0; i--) {
    const F = flags[i]!, kk = hot === F.fid + '|' + F.lens ? 1.12 : 1;
    const s = F.h * kk, w = F.w * kk, tip = tipOf(s), x = F.x + (F.w - w) / 2, y = F.tipY - tip - s;
    const col = F.bad ? th.red : th.amber, r = Math.min(5, s * 0.2), pw = Math.min(6, w * 0.2);
    // the pointer's base stays under the body when the body stepped aside from a label
    const bx = clamp(F.tipX, x + r + pw, x + w - r - pw), lead = Math.abs(bx - F.tipX) > pw * 1.5;
    if (lead) {
      // stepped far aside: a leader line to a dot on the feature, like a callout on a drawing
      ctx.beginPath(); ctx.moveTo(bx, y + s - 1); ctx.lineTo(F.tipX, F.tipY);
      ctx.strokeStyle = th.paper; ctx.lineWidth = 4.5; ctx.lineCap = 'round'; ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(F.tipX, F.tipY, 3.2, 0, 6.2832); ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = th.paper; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.beginPath(); ctx.roundRect(x, y, w, s, r);
    if (!lead) { ctx.moveTo(bx - pw, y + s - 0.5); ctx.lineTo(F.tipX, F.tipY); ctx.lineTo(bx + pw, y + s - 0.5); }
    // a paper halo keeps the flag off any stage fill, wall or neighbouring tile
    ctx.lineJoin = 'round'; ctx.strokeStyle = th.paper; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.fillStyle = col; ctx.fill();
    const gs = s * 0.6;
    glyph(ctx, e.plan.LENS[F.lens]?.glyph ?? null, x + (w - gs) / 2, y + (s - gs) / 2, gs, th.paper, Math.max(1.8, s * 0.085));
    const cnt = F.fids.length;
    if (cnt > 1) {
      // the cluster's count, a tag on the flag's top right corner (12 px text: the floor)
      const label = cnt > 99 ? '99+' : String(cnt), tw = e.tx.w(label, nf), bh = 17, bw = Math.max(bh, tw + 9), tx = x + w - bw * 0.55, ty = y - bh * 0.45;
      ctx.beginPath(); ctx.roundRect(tx, ty, bw, bh, bh / 2);
      ctx.fillStyle = th.paper; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.textAlign = 'center'; drawText(ctx, label, tx + bw / 2, ty + bh * 0.72, nf, th.inkHi); ctx.textAlign = 'left';
    }
  }
  ctx.restore();
}

/** The topmost flag at (px, py) in the given frame's flags, with a few px of slack. */
export function flagAt(flags: readonly FlagBox[], px: number, py: number): FlagBox | null {
  for (const F of flags) if (px >= F.x - 3 && px <= F.x + F.w + 3 && py >= F.y - 3 && py <= F.tipY + 3) return F;
  return null;
}
