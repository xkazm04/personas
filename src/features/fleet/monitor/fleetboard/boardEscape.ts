// boardEscape — the Board's one level in the Monitor's Escape chain.
//
// PersonaMonitor owns Escape (a modal above it first, then the drawer, then the
// remote drawer, then the Monitor itself). The Board adds ONE level between the
// drawers and closing: while a team is zoomed, Escape returns to the fleet and
// the Monitor stays open. The Board is a lazy chunk whose props are a frozen
// contract, so the level travels through this seam instead of a prop: the
// mounted Board registers a "back" step while it has somewhere to go back to,
// and the Monitor's handler asks it before closing. A tiny module on purpose:
// PersonaMonitor imports it statically without pulling the Board's chunk in.
//
// A latch, not state: one Board is mounted at a time, a registration is
// removed by the same Board that made it, and a stale step (a Board that
// unmounted) can never be left behind because unregistering is the cleanup of
// the effect that registered it.

type BackStep = () => void;

let step: BackStep | null = null;

/** Register the Board's back step; returns the unregister to run on cleanup. */
export function registerBoardBack(back: BackStep): () => void {
  step = back;
  return () => {
    if (step === back) step = null;
  };
}

/** Take the Board's back step if it has one. True = Escape was consumed. */
export function takeBoardBack(): boolean {
  if (!step) return false;
  step();
  return true;
}
