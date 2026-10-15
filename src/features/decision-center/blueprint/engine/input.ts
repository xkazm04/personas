// Pointer input on the plan: drag pans, the wheel zooms about the cursor (a trackpad's small deltas pan), a click
// selects, a double click descends. Returns the unsubscribe.
import type { Engine } from './Engine';

export function wireInput(e: Engine): () => void {
  const cv = e.cv;
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null, lastClick = 0;
  const local = (ev: PointerEvent | WheelEvent) => { const b = cv.getBoundingClientRect(); return { px: ev.clientX - b.left, py: ev.clientY - b.top }; };
  const down = (ev: PointerEvent) => { cv.setPointerCapture(ev.pointerId); drag = { x: ev.clientX, y: ev.clientY, cx: e.cam.x, cy: e.cam.y, moved: false }; e.cam.anim = null; };
  const move = (ev: PointerEvent) => {
    const { px, py } = local(ev);
    if (drag) {
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) { e.cam.x = drag.cx - dx / e.cam.k; e.cam.y = drag.cy - dy / e.cam.k; e.cam.clampToWorld(); e.dirty = true; }
      return;
    }
    const F = e.flagAt(px, py), T = F ? null : e.tileAt(px, py), hk = F ? F.fid + '|' + F.lens : null, ht = F ? F.fid : T ? T.id : null;
    if (hk !== e.hotFlag || ht !== e.hot) { e.hotFlag = hk; e.hot = ht; e.dirty = true; }
    e.hooks.hover(F, T, px, py);
    cv.style.cursor = F || T ? 'pointer' : 'grab';
  };
  const leave = () => { e.hot = null; e.hotFlag = null; e.dirty = true; e.hooks.hover(null, null, 0, 0); };
  const up = (ev: PointerEvent) => {
    const d = drag; drag = null;
    if (!d || d.moved) return;
    const { px, py } = local(ev), t = performance.now(), dbl = t - lastClick < 450;
    lastClick = t;
    const F = e.flagAt(px, py);
    if (F) { e.hooks.flag(F); return; }
    const T = e.tileAt(px, py);
    if (dbl) { e.hooks.descend(T, px, py); return; }
    e.hooks.click(T, e.roomAt(px, py));
  };
  const wheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const { px, py } = local(ev);
    if (ev.ctrlKey || Math.abs(ev.deltaY) >= 50 || ev.deltaMode) e.cam.zoomAt(px, py, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0016)));
    else { e.cam.anim = null; e.cam.x += ev.deltaX / e.cam.k; e.cam.y += ev.deltaY / e.cam.k; e.cam.clampToWorld(); }
    e.dirty = true;
  };
  cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerleave', leave);
  cv.addEventListener('pointerup', up); cv.addEventListener('wheel', wheel, { passive: false });
  return () => {
    cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerleave', leave);
    cv.removeEventListener('pointerup', up); cv.removeEventListener('wheel', wheel);
  };
}
