/** useCamera - the camera move between the sheet and a frame's inner layer.
 *
 *  Pushing in: the whole sheet (sigil included) scales 2.5x about the frame it
 *  is entering and fades out, while the layer grows out of that same point a
 *  beat later. Pulling out is the exact reverse. Both moves animate the
 *  `transform` string and `opacity` only: framer hands those to WAAPI, so they
 *  run on the compositor and a React commit mid-move cannot stall them. No
 *  `filter: blur()` anywhere: a blur on a stage-sized, 2.5x-scaled tree was
 *  re-rasterised on every frame of every pulse under it (the "cycling lag").
 *  The sheet reads as defocused anyway: it is a frozen picture scaled up. Moving from one layer
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
export const SHEET_MOVE_REDUCED = { duration: 0.2 };
export const SHEET_PUSHED = { transform: "scale(2.5)", opacity: 0 };
export const SHEET_PUSHED_REDUCED = { transform: "scale(1)", opacity: 0 };
export const SHEET_REST = { transform: "scale(1)", opacity: 1 };

/** The layer itself: grows from a third of its size, lagging the sheet a beat. */
export const LAYER_MOVE = { duration: 0.55, ease: [0.25, 0.8, 0.25, 1] as const, delay: 0.12 };
export const LAYER_HIDDEN = { opacity: 0, transform: "scale(0.34)" };
export const LAYER_SHOWN = { opacity: 1, transform: "scale(1)" };

/** Out, one beat on the sheet, then in: the 0.6 s pull-out, then a breath at
 *  rest where the woken sheet shows the frame that just changed developing. */
const SWAP_BEAT_MS = 1000;

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
