/** useCamera - the camera move between the sheet and a frame's inner layer.
 *
 *  Pushing in: the whole sheet (sigil included) scales 2.5x about the frame it
 *  is entering, fades and defocuses, while the layer grows out of that same
 *  point a beat later. Pulling out is the exact reverse. Moving from one layer
 *  straight to another (the next question, a petal while a question is open)
 *  never pans across a pushed-in sheet: the camera pulls all the way out, holds
 *  one beat so the frame that just changed is seen developing, and pushes into
 *  the next one. Reduced motion keeps the fades and drops scale, blur and beat. */
import { useEffect, useRef, useState } from "react";

/** A camera target: a stable key per layer, and the point (stage px) to push about. */
export interface Shot { key: string; x: number; y: number }

export interface Rect { x: number; y: number; w: number; h: number }

export const shotAt = (key: string, r: Rect): Shot => ({ key, x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The sheet behind a layer. */
export const SHEET_MOVE = { duration: 0.6, ease: [0.3, 0.7, 0.2, 1] as const };
export const SHEET_PUSHED = { scale: 2.5, opacity: 0.16, filter: "blur(5px)" };
export const SHEET_PUSHED_REDUCED = { scale: 1, opacity: 0.2, filter: "blur(0px)" };
export const SHEET_REST = { scale: 1, opacity: 1, filter: "blur(0px)" };

/** The layer itself: grows from a third of its size, lagging the sheet a beat. */
export const LAYER_MOVE = { duration: 0.55, ease: [0.25, 0.8, 0.25, 1] as const, delay: 0.12 };
export const LAYER_HIDDEN = { opacity: 0, scale: 0.34, filter: "blur(6px)" };
export const LAYER_SHOWN = { opacity: 1, scale: 1, filter: "blur(0px)" };

/** Out, one beat on the sheet, then in. Matches the pull-out plus a breath. */
const SWAP_BEAT_MS = 650;

/** Returns the shot the camera is actually on, which lags `target` through a
 *  full pull-out whenever one layer hands over to another. */
export function useCamera(target: Shot | null, reduce: boolean): Shot | null {
  const [onKey, setOnKey] = useState<string | null>(target?.key ?? null);
  const onRef = useRef(onKey);
  onRef.current = onKey;
  const targetKey = target?.key ?? null;

  useEffect(() => {
    const current = onRef.current;
    if (current === targetKey) return;
    if (current === null || targetKey === null || reduce) { setOnKey(targetKey); return; }
    setOnKey(null);
    const h = window.setTimeout(() => setOnKey(targetKey), SWAP_BEAT_MS);
    return () => window.clearTimeout(h);
  }, [targetKey, reduce]);

  // Pulling out is immediate: the frame the target left is never shown pushed-in.
  return target && onKey === target.key ? target : null;
}
