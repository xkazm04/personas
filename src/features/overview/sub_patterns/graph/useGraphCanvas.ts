// Pan/zoom camera for the topic-graph canvases — the shared "movement" half of
// the PoE-tree feel. One camera, three very different skies.
//
// Behaviours (all pointer-first, no library):
// - drag anywhere pans; wheel zooms anchored at the cursor (the world point
//   under the pointer stays under the pointer, which is what makes zooming
//   feel like leaning in rather than teleporting)
// - double-click / Reset returns to the fitted home view
// - zoom is clamped; the camera state is plain {x, y, k} in CSS pixels applied
//   as one `<g transform>` — no per-node springs, so a thousand nodes cost one
//   transform update per frame
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface Camera {
  x: number;
  y: number;
  k: number;
}

export interface GraphCanvas {
  /** Attach to the scroll/gesture container (the div wrapping the svg). */
  containerRef: (el: HTMLDivElement | null) => void;
  size: { width: number; height: number };
  camera: Camera;
  isPanning: boolean;
  /** Spread onto the svg element. */
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onDoubleClick: () => void;
  };
  zoomBy: (factor: number) => void;
  reset: () => void;
  /** World → container-pixel projection, for HTML overlays (hover cards). */
  project: (wx: number, wy: number) => { x: number; y: number };
}

const MIN_K = 0.22;
const MAX_K = 4;

export function useGraphCanvas(opts?: { initialK?: number }): GraphCanvas {
  const initialK = opts?.initialK ?? 0.85;
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, k: initialK });
  const [isPanning, setIsPanning] = useState(false);
  const drag = useRef<{ px: number; py: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  // Wheel must be a native non-passive listener: React's synthetic onWheel is
  // passive by default, and a zoom that cannot preventDefault scrolls the
  // Overview page underneath the canvas on every notch.
  useEffect(() => {
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setCamera((c) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, c.k * Math.exp(-e.deltaY * 0.0016)));
        const s = k / c.k;
        // Anchor the world point under the cursor.
        return { k, x: cx - (cx - c.x) * s, y: cy - (cy - c.y) * s };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [el]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, moved: false };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    // A 3px slop keeps node clicks from registering as micro-pans.
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    d.moved = true;
    setIsPanning(true);
    d.px = e.clientX;
    d.py = e.clientY;
    setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  }, []);

  const onPointerUp = useCallback(() => {
    drag.current = null;
    setIsPanning(false);
  }, []);

  const reset = useCallback(() => setCamera({ x: 0, y: 0, k: initialK }), [initialK]);

  const zoomBy = useCallback((factor: number) => {
    setCamera((c) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, c.k * factor));
      const s = k / c.k;
      // Button zoom anchors at the viewport centre.
      return { k, x: c.x * s, y: c.y * s };
    });
  }, []);

  const project = useCallback(
    (wx: number, wy: number) => ({
      x: size.width / 2 + camera.x + wx * camera.k,
      y: size.height / 2 + camera.y + wy * camera.k,
    }),
    [size, camera],
  );

  return useMemo(
    () => ({
      containerRef: setEl,
      size,
      camera,
      isPanning,
      handlers: { onPointerDown, onPointerMove, onPointerUp, onDoubleClick: reset },
      zoomBy,
      reset,
      project,
    }),
    [size, camera, isPanning, onPointerDown, onPointerMove, onPointerUp, reset, zoomBy, project],
  );
}

/** Counter-scale for labels: text shrinks/grows far slower than geometry, the
 *  PoE trick that keeps names readable at 0.3× and non-billboard at 3×.
 *  Apply as `transform={scale(labelScale(k))}` on a text group. */
export function labelScale(k: number): number {
  return Math.pow(Math.max(k, 0.001), -0.62);
}

/** Level-of-detail opacity ramp: 0 below `from`, 1 above `to`. */
export function lod(k: number, from: number, to: number): number {
  return Math.max(0, Math.min(1, (k - from) / (to - from)));
}
