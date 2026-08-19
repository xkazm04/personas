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
  /** Attach to the svg itself — the wheel-zoom target. Overlays (modal,
   *  rails) are DOM children of the CONTAINER, so a container-level wheel
   *  listener would zoom the sky under a scrolling modal; the svg receives
   *  only its own events. */
  svgRef: (el: SVGSVGElement | null) => void;
  size: { width: number; height: number };
  camera: Camera;
  isPanning: boolean;
  /** Spread onto the svg element. */
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
  zoomBy: (factor: number) => void;
  reset: () => void;
  /** Animated camera move that lands world point (wx,wy) at the viewport
   *  centre at zoom k — the Google-Maps "lean in" the drill-down rides on.
   *  Any manual pan/wheel cancels it (the user always wins the camera). */
  flyTo: (wx: number, wy: number, k: number, ms?: number) => void;
  /** World → container-pixel projection, for HTML overlays (hover cards). */
  project: (wx: number, wy: number) => { x: number; y: number };
}

const MIN_K = 0.22;
const MAX_K = 4;

export function useGraphCanvas(opts?: { initialK?: number }): GraphCanvas {
  const initialK = opts?.initialK ?? 0.85;
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, k: initialK });
  const [isPanning, setIsPanning] = useState(false);
  const drag = useRef<{ px: number; py: number; moved: boolean } | null>(null);

  // Mirror + animation handle for flyTo: the rAF loop needs the live camera
  // without re-subscribing, and any manual gesture must cancel the flight.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const flight = useRef<number | null>(null);
  const cancelFlight = useCallback(() => {
    if (flight.current !== null) {
      cancelAnimationFrame(flight.current);
      flight.current = null;
    }
  }, []);

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
  // Overview page underneath the canvas on every notch. It lives on the SVG,
  // not the container — the cluster modal and the playbooks rail are DOM
  // children of the container, and bubbling follows the DOM, so a container
  // listener turned every scroll inside an overlay into a canvas zoom.
  useEffect(() => {
    if (!svgEl) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelFlight();
      const rect = svgEl.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setCamera((c) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, c.k * Math.exp(-e.deltaY * 0.0016)));
        const s = k / c.k;
        // Anchor the world point under the cursor.
        return { k, x: cx - (cx - c.x) * s, y: cy - (cy - c.y) * s };
      });
    };
    svgEl.addEventListener('wheel', onWheel, { passive: false });
    return () => svgEl.removeEventListener('wheel', onWheel);
  }, [svgEl, cancelFlight]);

  // Click-vs-pan discipline. Pointer capture is taken ONLY once a real pan
  // starts (past the slop): capturing on pointerdown retargets the whole
  // pointer stream — including the eventual click — at the svg, so node
  // clicks never fired and every tap read as "background". After a pan ends,
  // the trailing click is suppressed so releasing a drag over a node doesn't
  // select it.
  const suppressClick = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    cancelFlight();
    drag.current = { px: e.clientX, py: e.clientY, moved: false };
  }, [cancelFlight]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    // A 3px slop keeps node clicks from registering as micro-pans.
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    if (!d.moved) {
      d.moved = true;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setIsPanning(true);
    }
    d.px = e.clientX;
    d.py = e.clientY;
    setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  }, []);

  const onPointerUp = useCallback(() => {
    suppressClick.current = drag.current?.moved ?? false;
    drag.current = null;
    setIsPanning(false);
  }, []);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  const flyTo = useCallback(
    (wx: number, wy: number, k: number, ms = 520) => {
      cancelFlight();
      const from = { ...cameraRef.current };
      const kk = Math.min(MAX_K, Math.max(MIN_K, k));
      // Centring world point (wx,wy) means x = -wx·k (transform origin is the
      // viewport centre).
      const to = { x: -wx * kk, y: -wy * kk, k: kk };
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / ms);
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // easeInOutCubic
        setCamera({
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
          k: from.k + (to.k - from.k) * e,
        });
        flight.current = p < 1 ? requestAnimationFrame(step) : null;
      };
      flight.current = requestAnimationFrame(step);
    },
    [cancelFlight],
  );

  const reset = useCallback(() => flyTo(0, 0, initialK, 460), [flyTo, initialK]);

  const zoomBy = useCallback((factor: number) => {
    cancelFlight();
    setCamera((c) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, c.k * factor));
      const s = k / c.k;
      // Button zoom anchors at the viewport centre.
      return { k, x: c.x * s, y: c.y * s };
    });
  }, [cancelFlight]);

  // Never leave a flight running after unmount.
  useEffect(() => cancelFlight, [cancelFlight]);

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
      svgRef: setSvgEl,
      size,
      camera,
      isPanning,
      handlers: { onPointerDown, onPointerMove, onPointerUp, onClickCapture },
      zoomBy,
      reset,
      flyTo,
      project,
    }),
    [size, camera, isPanning, onPointerDown, onPointerMove, onPointerUp, onClickCapture, reset, zoomBy, flyTo, project],
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
