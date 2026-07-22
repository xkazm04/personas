// Infinite-canvas camera for the Mastermind SVG: wheel zoom-to-cursor (native
// non-passive listener — React's synthetic onWheel can't preventDefault),
// pointer-capture drag panning, double-click zoom, and fit-to-bounds.
// World→screen: screen = world * z + (x, y).
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { Camera } from './types';

const MIN_Z = 0.06;
const MAX_Z = 3;

const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

export interface CameraControl {
  cam: Camera;
  panning: boolean;
  fit: (b: { minX: number; minY: number; maxX: number; maxY: number }) => void;
  handlers: {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
    onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
    onPointerCancel: (e: React.PointerEvent<SVGSVGElement>) => void;
    onDoubleClick: (e: React.MouseEvent<SVGSVGElement>) => void;
  };
}

export function useCanvasCamera(svgRef: RefObject<SVGSVGElement | null>): CameraControl {
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, z: 0.5 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const drag = useRef<{ id: number; sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);

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
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [svgRef, zoomAt]);

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: camRef.current.x, cy: camRef.current.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 3) {
      d.moved = true;
      setPanning(true);
    }
    if (d.moved) setCam((c) => ({ ...c, x: d.cx + dx, y: d.cy + dy }));
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setPanning(false);
  }, []);

  const onDoubleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.shiftKey ? 1 / 1.7 : 1.7);
  }, [zoomAt]);

  const fit = useCallback((b: { minX: number; minY: number; maxX: number; maxY: number }) => {
    const el = svgRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (!width || !height) return;
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const z = Math.min(0.9, Math.max(0.12, Math.min(width / bw, height / bh)));
    setCam({ z, x: width / 2 - ((b.minX + b.maxX) / 2) * z, y: height / 2 - ((b.minY + b.maxY) / 2) * z });
  }, [svgRef]);

  return {
    cam,
    panning,
    fit,
    handlers: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onDoubleClick },
  };
}
