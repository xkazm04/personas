/** useSheetSleep - puts the contact sheet to sleep while a layer is open.
 *
 *  The camera used to push a LIVE sheet: the sigil, eight frames and the
 *  casting call kept re-rendering (the build clock ticks twice a second),
 *  kept running their pulse loops and kept re-measuring their layout boxes,
 *  all under a 2.5x scale and a 5 px blur filter, so every pulse frame
 *  re-rasterised and re-blurred the whole stage. Now the sheet sleeps:
 *
 *    awake    live, as before;
 *    falling  the push is running: the sheet is frozen (its React tree does
 *             not re-render, its CSS loops are paused), so the camera moves
 *             one static composited picture with transform + opacity only;
 *    asleep   the push has landed behind the opaque layer: the sheet is also
 *             `visibility: hidden`, so nothing under the layer paints;
 *    waking   the pull-out is running: visible again, still frozen, so the
 *             pull moves the same static picture back to rest.
 *
 *  It wakes (re-renders with everything that changed while it slept) only once
 *  the pull-out has landed at rest, where the frame that just changed is seen
 *  developing. The camera's own `onAnimationComplete` ends a move; a timer
 *  backs it up so a move that never ran can never leave the sheet asleep. */
import { useCallback, useEffect, useState } from "react";
import type { Shot } from "../useCamera";

export type SleepPhase = "awake" | "falling" | "asleep" | "waking";

const REST_ORIGIN = "50% 50%";
const originOf = (shot: Shot) => `${shot.x}px ${shot.y}px`;

export function useSheetSleep(shot: Shot | null, moveMs: number) {
  const pushed = shot !== null;
  const [phase, setPhase] = useState<SleepPhase>(pushed ? "asleep" : "awake");
  const [wasPushed, setWasPushed] = useState(pushed);
  // The point the camera pushed about. It is kept through the pull-out: the
  // camera's target clears the moment the pull starts, and snapping the origin
  // back to the centre mid-move made the whole sheet jump sideways.
  const [origin, setOrigin] = useState(shot ? originOf(shot) : REST_ORIGIN);

  // Derived state, adjusted during render so the freeze lands in the SAME
  // render as the push (a frozen tree must never render the pushed state).
  if (wasPushed !== pushed) {
    setWasPushed(pushed);
    setPhase(pushed ? "falling" : "waking");
  }
  if (shot && originOf(shot) !== origin) setOrigin(originOf(shot));

  const onMoveEnd = useCallback(() => {
    setPhase((p) => (p === "falling" ? "asleep" : p === "waking" ? "awake" : p));
  }, []);

  useEffect(() => {
    if (phase !== "falling" && phase !== "waking") return;
    const h = window.setTimeout(onMoveEnd, moveMs + 250);
    return () => window.clearTimeout(h);
  }, [phase, moveMs, onMoveEnd]);

  return {
    phase,
    /** The sheet's React tree holds its last awake render. */
    frozen: phase !== "awake",
    /** Nothing under the open layer paints. */
    hidden: phase === "asleep",
    origin,
    onMoveEnd,
  };
}
