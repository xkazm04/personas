import { useEffect, useState } from "react";
import { useMotion } from "@/hooks/utility/interaction/useMotion";

/** The pace of a drawing: one step per `draw` ms, `catchUp` ms while more than
 *  `BACKLOG` steps are queued (a burst of data, or a reopened session), so the
 *  drawing is timed like Studio's build-up yet never falls far behind the build. */
export const DRAFT_STEP_MS = { draw: 1100, catchUp: 380 } as const;
const BACKLOG = 4;

/**
 * How many of `total` steps are drawn. Unlike Studio's `useBuildUp` (a count
 * derived from the drawing's start time), this one QUEUES: a step that arrives
 * late is still drawn one beat after the previous one, never all at once, so a
 * persona build whose data lands in bursts still reads as being drawn. The
 * total may grow at any time; it may also shrink (a reset), which clamps. A new
 * `key` (a new build session) starts over from zero. Reduced motion draws all.
 */
export function useDraftSteps(key: string, total: number, pace: { draw: number; catchUp: number } = DRAFT_STEP_MS): number {
  const { shouldAnimate } = useMotion();
  const [state, setState] = useState(() => ({ key, count: 0 }));
  if (state.key !== key) setState({ key, count: 0 });
  const count = Math.min(state.key === key ? state.count : 0, total);

  useEffect(() => {
    if (!shouldAnimate || count >= total) return;
    const ms = total - count > BACKLOG ? pace.catchUp : pace.draw;
    // The first step of a drawing lands at once; the rest one beat apart.
    const timer = window.setTimeout(() => setState((s) => (s.key === key ? { key, count: Math.min(total, s.count + 1) } : s)), count === 0 ? 0 : ms);
    return () => window.clearTimeout(timer);
  }, [key, count, total, shouldAnimate, pace.draw, pace.catchUp]);

  return shouldAnimate ? count : total;
}
