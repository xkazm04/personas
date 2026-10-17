/**
 * The room a rail flyout takes from the plan. The flyout measures its own width and writes it on the plan element
 * (`data-fly-w`, 0 when it is closed or leaving); the plan canvas reads it into the safe area's right inset and
 * re-fits the camera when it changes. A plain attribute, because the flyout and the canvas are siblings in the sheet
 * and the engine's `safe()` hook reads the DOM anyway (safeOf measures the title block the same way).
 */
export const FLY_ATTR = 'data-fly-w';

/** The least plan width worth fitting beside a flyout: below it the panel lies over the plan, as in bp. */
export const MIN_PLAN_W = 480;

export function setFlyRoom(plan: Element | null, px: number): void {
  if (!plan) return;
  const v = String(Math.max(0, Math.round(px)));
  if (plan.getAttribute(FLY_ATTR) !== v) plan.setAttribute(FLY_ATTR, v);
}

export function flyRoomOf(plan: Element | null | undefined): number {
  const n = Number(plan?.getAttribute(FLY_ATTR));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The inset the flyout takes: its width when the plan keeps MIN_PLAN_W beside it, else 0 (it covers the plan, as bp's does). */
export function flyInset(fly: number, planW: number): number {
  return fly > 0 && planW - fly >= MIN_PLAN_W ? fly : 0;
}
