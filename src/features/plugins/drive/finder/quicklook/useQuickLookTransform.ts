import { useCallback, useEffect, useRef, useState } from "react";

export interface Transform {
  zoom: number;
  rotation: number;
  panX: number;
  panY: number;
}

export const IDENTITY: Transform = { zoom: 1, rotation: 0, panX: 0, panY: 0 };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.25;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Pure step: zoom by `factor`, anchored at an origin relative to the centre. */
export function zoomTransform(
  prev: Transform,
  factor: number,
  originX?: number,
  originY?: number,
): Transform {
  const next = clamp(prev.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (next === prev.zoom) return prev;
  if (next <= MIN_ZOOM) return { ...prev, zoom: next, panX: 0, panY: 0 };
  if (originX !== undefined && originY !== undefined) {
    const scale = next / prev.zoom;
    return {
      ...prev,
      zoom: next,
      panX: originX - scale * (originX - prev.panX),
      panY: originY - scale * (originY - prev.panY),
    };
  }
  return { ...prev, zoom: next };
}

export function rotateTransform(prev: Transform): Transform {
  return { ...prev, rotation: (prev.rotation + 90) % 360 };
}

export function isIdentity(t: Transform): boolean {
  return t.zoom === 1 && t.rotation === 0 && t.panX === 0 && t.panY === 0;
}

/**
 * Per-path transform memory (parity with the classic lightbox): stepping
 * prev/next restores the zoom / rotation / pan each image had, so two
 * screenshots can both be pre-zoomed to compare a region. The map lives for
 * the modal's lifetime and clears on unmount.
 */
export function useQuickLookTransform(pathKey: string) {
  const memory = useRef<Map<string, Transform>>(new Map());
  const [transform, setRaw] = useState<Transform>(IDENTITY);

  const setTransform = useCallback(
    (next: Transform | ((prev: Transform) => Transform)) => {
      setRaw((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        if (pathKey) memory.current.set(pathKey, resolved);
        return resolved;
      });
    },
    [pathKey],
  );

  useEffect(() => {
    if (!pathKey) return;
    setRaw(memory.current.get(pathKey) ?? IDENTITY);
  }, [pathKey]);

  const zoomBy = useCallback(
    (factor: number, originX?: number, originY?: number) =>
      setTransform((prev) => zoomTransform(prev, factor, originX, originY)),
    [setTransform],
  );
  const rotate = useCallback(() => setTransform(rotateTransform), [setTransform]);
  const reset = useCallback(() => setTransform(IDENTITY), [setTransform]);
  const pan = useCallback(
    (panX: number, panY: number) => setTransform((prev) => ({ ...prev, panX, panY })),
    [setTransform],
  );

  return { transform, zoomBy, rotate, reset, pan };
}
