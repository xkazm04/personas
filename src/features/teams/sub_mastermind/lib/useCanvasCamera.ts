// Infinite-canvas camera for the Mastermind SVG: wheel zoom-to-cursor (native
// non-passive listener — React's synthetic onWheel can't preventDefault),
// pointer-capture drag panning, double-click zoom, and fit-to-bounds.
// World→screen: screen = world * z + (x, y).
//
// Render-free navigation (round 14):
//   • PAN is translate-only and fully render-free — the world <g> transform is
//     written imperatively through `worldRef` during the drag; React state is
//     committed exactly once on release. No island re-renders while panning.
//   • WHEEL zoom coalesces to ≤1 committed state update per animation frame
//     (accumulated factor flushed in a rAF). Counter-scaled layers genuinely
//     need `z` at render, so zoom keeps rendering — just not once per event.
//   • Button zoom / double-click / fit stay synchronous single commits.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import type { Camera } from './types';

const MIN_Z = 0.06;
const MAX_Z = 3;

const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

/** Serialize a camera into the world <g>'s SVG transform. */
const camTransform = (c: Camera) => `translate(${c.x} ${c.y}) scale(${c.z})`;

export interface CameraControl {
  cam: Camera;
  /** Live camera — updated every frame INCLUDING mid-pan (when `cam` state is
   *  intentionally stale for render-freedom). Read this for gesture-time world
   *  math (rubber-band, note placement) that must track an in-progress pan. */
  camRef: RefObject<Camera>;
  panning: boolean;
  /** Frame the given world bounds. `animate` tweens there linearly (~380ms)
   *  instead of jumping; any wheel/drag input cancels the tween. */
  fit: (b: { minX: number; minY: number; maxX: number; maxY: number }, animate?: boolean) => void;
  /** Zoom by a factor around the viewport centre (toolbar +/− buttons). */
  zoomBy: (factor: number) => void;
  handlers: {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
    onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
    onPointerCancel: (e: React.PointerEvent<SVGSVGElement>) => void;
    onDoubleClick: (e: React.MouseEvent<SVGSVGElement>) => void;
  };
}

export function useCanvasCamera(
  svgRef: RefObject<SVGSVGElement | null>,
  /** The world <g> whose transform is driven imperatively during a pan. When
   *  omitted (unit tests, non-SVG hosts) pan falls back to state commits. */
  worldRef?: RefObject<SVGGElement | null>,
): CameraControl {
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, z: 0.5 });
  const camRef = useRef(cam);
  const drag = useRef<{ id: number; sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null);
  // Keep the live camera synced to committed state — EXCEPT mid-pan, when camRef
  // holds the uncommitted pan position that the imperative transform is driven
  // from (a `setPanning` re-render must not clobber it back to the stale cam).
  if (!drag.current?.moved) camRef.current = cam;
  const [panning, setPanning] = useState(false);
  const animFrame = useRef<number | null>(null);
  const zoomFrame = useRef<number | null>(null);
  // Accumulated wheel intent for the current frame: combined factor + last pivot.
  const zoomAccum = useRef<{ px: number; py: number; factor: number } | null>(null);

  const cancelTween = useCallback(() => {
    if (animFrame.current !== null) cancelAnimationFrame(animFrame.current);
    animFrame.current = null;
  }, []);
  useEffect(() => cancelTween, [cancelTween]);

  /** Write the live camera to the world <g> without a React commit (pan path). */
  const applyLive = useCallback((c: Camera) => {
    worldRef?.current?.setAttribute('transform', camTransform(c));
  }, [worldRef]);

  // If a re-render from some OTHER state (fleet poll, hover) lands mid-pan, React
  // reconciles the <g> transform back to the (stale) committed cam. Re-assert the
  // live one so the pan never visibly snaps back.
  useLayoutEffect(() => {
    if (drag.current?.moved) applyLive(camRef.current);
  });

  /** Linear camera tween (per the double-click-zoom brief: no sudden jump). */
  const animateTo = useCallback((target: Camera, duration = 380) => {
    cancelTween();
    const from = camRef.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setCam({
        x: from.x + (target.x - from.x) * t,
        y: from.y + (target.y - from.y) * t,
        z: from.z + (target.z - from.z) * t,
      });
      animFrame.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    animFrame.current = requestAnimationFrame(step);
  }, [cancelTween]);

  // Zoom toward a screen-space pivot, keeping the world point under it fixed.
  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    setCam((c) => {
      const z = clampZ(c.z * factor);
      const k = z / c.z;
      return { z, x: px - (px - c.x) * k, y: py - (py - c.y) * k };
    });
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    // Coalesce a burst of wheel events into ONE state commit per animation frame:
    // multiply the factors, keep the latest pivot, flush in a rAF.
    const flushZoom = () => {
      zoomFrame.current = null;
      const a = zoomAccum.current;
      zoomAccum.current = null;
      if (a) zoomAt(a.px, a.py, a.factor);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelTween();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const prev = zoomAccum.current;
      zoomAccum.current = { px, py, factor: prev ? prev.factor * factor : factor };
      if (zoomFrame.current === null) zoomFrame.current = requestAnimationFrame(flushZoom);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current);
      zoomFrame.current = null;
      zoomAccum.current = null;
    };
  }, [svgRef, zoomAt, cancelTween]);

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    cancelTween();
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: camRef.current.x, cy: camRef.current.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [cancelTween]);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 3) {
      d.moved = true;
      setPanning(true);
    }
    if (d.moved) {
      const next = { ...camRef.current, x: d.cx + dx, y: d.cy + dy };
      camRef.current = next;
      // Render-free pan: drive the world transform directly; commit on release.
      if (worldRef?.current) applyLive(next);
      else setCam(next);
    }
  }, [worldRef, applyLive]);

  const endDrag = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (d?.id !== e.pointerId) return;
    drag.current = null;
    // Commit the imperatively-panned position exactly once.
    if (d.moved && worldRef?.current) setCam(camRef.current);
    setPanning(false);
  }, [worldRef]);

  const onDoubleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.shiftKey ? 1 / 1.7 : 1.7);
  }, [zoomAt]);

  const zoomBy = useCallback((factor: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, factor);
  }, [svgRef, zoomAt]);

  const fit = useCallback((b: { minX: number; minY: number; maxX: number; maxY: number }, animate = false) => {
    const el = svgRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (!width || !height) return;
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const z = Math.min(0.9, Math.max(0.12, Math.min(width / bw, height / bh)));
    const target = { z, x: width / 2 - ((b.minX + b.maxX) / 2) * z, y: height / 2 - ((b.minY + b.maxY) / 2) * z };
    if (animate) animateTo(target);
    else setCam(target);
  }, [svgRef, animateTo]);

  return {
    cam,
    camRef,
    panning,
    fit,
    zoomBy,
    handlers: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onDoubleClick },
  };
}
