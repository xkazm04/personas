// The key plan (bp src/engine/render/keyplan.ts): the whole site as wing outlines with the camera's view box on it,
// or, on the L4 sheet, the feature's fixture marked. Drawn on its own small canvas, outside the engine's frame.
import type { Layout } from '../model/layout';
import type { Camera } from './camera';
import type { CanvasTheme } from './theme';

export function drawKeyPlan(cv: HTMLCanvasElement, L: Layout, th: CanvasTheme, cam: Camera | null, fid?: string): void {
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const d = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
  const g = cv.getContext('2d');
  if (!g) return;
  g.scale(d, d);
  const Lw = L.world, k = Math.min((r.width - 6) / Lw.w, (r.height - 6) / Lw.h), ox = (r.width - Lw.w * k) / 2, oy = 3;
  g.strokeStyle = th.inkA(0.7); g.lineWidth = 1;
  for (const W of L.wings) g.strokeRect(ox + W.x * k + 0.5, oy + W.y * k + 0.5, W.w * k, W.h * k);
  if (fid) {
    const T = L.TILE[fid];
    if (T) { g.fillStyle = th.focus; g.fillRect(ox + T.x * k - 1, oy + T.y * k - 1, Math.max(4, T.w * k + 2), Math.max(4, T.h * k + 2)); }
    return;
  }
  if (!cam) return;
  const x0 = cam.wx(0), y0 = cam.wy(0), x1 = cam.wx(cam.FW), y1 = cam.wy(cam.FH);
  g.strokeStyle = th.focus; g.lineWidth = 1.5; g.strokeRect(ox + x0 * k, oy + y0 * k, (x1 - x0) * k, (y1 - y0) * k);
}
