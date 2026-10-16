// The key plan (PORTED from bp src/engine/render/keyplan.ts renderBase + draw): every room filled by its built share,
// a red mark in the corner of a room with features in trouble, the building outline, the waiting work as amber
// pennant ticks, and the camera's view (the part of the canvas the chrome leaves free) as an amber box. On the L4
// sheet the feature's fixture is marked instead of the view. Drawn on its own small canvas, outside the engine's
// frame; bp caches the base in a bitmap, this one is a few dozen rects and draws it whole.
import { counts } from '../model/aggregates';
import type { Layout } from '../model/layout';
import type { Work } from '../model/work';
import type { Camera } from './camera';
import type { CanvasTheme } from './theme';

export function drawKeyPlan(cv: HTMLCanvasElement, L: Layout, th: CanvasTheme, cam: Camera | null, fid?: string, work?: Work): void {
  const b = cv.getBoundingClientRect();
  if (!b.width || !b.height) return;
  const d = window.devicePixelRatio || 1, W = b.width, H = b.height;
  cv.width = Math.round(W * d); cv.height = Math.round(H * d);
  const g = cv.getContext('2d');
  if (!g) return;
  g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H);
  const Wd = L.world, s = Math.min((W - 12) / Wd.w, (H - 10) / Wd.h), ox = (W - Wd.w * s) / 2 - Wd.x * s, oy = (H - Wd.h * s) / 2 - Wd.y * s;
  for (const R of L.rooms) {
    const cc = counts(R.feats), share = (cc.live + cc.flagged) / Math.max(1, cc.n);
    g.fillStyle = th.inkA(0.06 + share * 0.3); g.fillRect(R.x * s + ox, R.y * s + oy, R.w * s, R.h * s);
    const bad = R.feats.filter((f) => f.health === 'bad').length;
    if (bad) { g.fillStyle = th.alpha(th.red, Math.min(0.85, 0.35 + bad * 0.15)); g.fillRect(R.x * s + ox + R.w * s - 4, R.y * s + oy + 1, 3, 3); }
    g.strokeStyle = th.inkA(0.55); g.lineWidth = 0.6; g.strokeRect(R.x * s + ox, R.y * s + oy, R.w * s, R.h * s);
  }
  const B = L.bld;
  g.strokeStyle = th.ink; g.lineWidth = 1.2; g.strokeRect(B.x * s + ox, B.y * s + oy, B.w * s, B.h * s);
  if (work) {
    g.fillStyle = th.amber;
    for (const p of work.items) {
      if (p.status !== 'proposed') continue;
      const T = L.TILE[p.fid]; if (!T) continue;
      const px = (T.x + T.w) * s + ox, py = T.y * s + oy;
      g.beginPath(); g.moveTo(px, py - 4); g.lineTo(px + 4, py - 2); g.lineTo(px, py); g.fill();
    }
  }
  if (fid) {
    const T = L.TILE[fid];
    if (T) { g.fillStyle = th.amber; g.fillRect(T.x * s + ox - 1, T.y * s + oy - 1, Math.max(4, T.w * s + 2), Math.max(4, T.h * s + 2)); }
    return;
  }
  if (!cam) return;
  const S = cam.SAFE, vx = cam.wx(S.l) * s + ox, vy = cam.wy(S.t) * s + oy, vw = ((S.r - S.l) / cam.k) * s, vh = ((S.b - S.t) / cam.k) * s;
  g.fillStyle = th.alpha(th.amber, 0.14); g.fillRect(vx, vy, vw, vh);
  g.strokeStyle = th.amber; g.lineWidth = 1.4; g.strokeRect(vx, vy, vw, vh);
}
