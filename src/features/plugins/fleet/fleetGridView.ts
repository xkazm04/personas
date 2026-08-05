/**
 * Which view the fullscreen grid overlay lands on — the one place that truth
 * lives, so the overlay's switcher, the footer cluster, and any future opener
 * agree on it.
 *
 * Three inputs, in priority order:
 * 1. A one-shot REQUEST (`requestGridView`) — e.g. the footer click promises
 *    "opens the monitor ledger", so it requests `monitor` for exactly the next
 *    open. Consumed on resolve; never recorded as the operator's preference.
 * 2. The operator's EXPLICIT pick from the overlay switcher — wins on every
 *    later open for the rest of the app run.
 * 3. The fleet-size default: past a dozen live sessions the tiles are smaller
 *    than a useful terminal and the ledger is the better first read.
 *
 * Module-scoped on purpose (same lifetime as the old in-overlay state):
 * survives overlay close/reopen, resets with the app.
 */

export type GridViewId = 'tiles' | 'monitor';

/** Above this many live sessions the grid defaults to the monitor ledger. */
export const MONITOR_DEFAULT_ABOVE = 12;

let lastGridView: GridViewId = 'tiles';
let explicitPick = false;
let requestedView: GridViewId | null = null;

/** The operator chose a view in the overlay switcher — their pick wins from now on. */
export function recordGridViewPick(view: GridViewId): void {
  lastGridView = view;
  explicitPick = true;
}

/** Ask for a specific view on the NEXT overlay open only. Does not touch the
 *  operator's standing preference. */
export function requestGridView(view: GridViewId): void {
  requestedView = view;
}

/** What the next open would land on, without consuming the one-shot request.
 *  For render-time initializers that must stay side-effect-free. */
export function peekGridViewOnOpen(sessionCount: number): GridViewId {
  if (requestedView) return requestedView;
  if (explicitPick) return lastGridView;
  return sessionCount > MONITOR_DEFAULT_ABOVE ? 'monitor' : 'tiles';
}

/** Resolve the landing view for an open that is actually happening — consumes
 *  a pending one-shot request. */
export function resolveGridViewOnOpen(sessionCount: number): GridViewId {
  const view = peekGridViewOnOpen(sessionCount);
  requestedView = null;
  return view;
}
