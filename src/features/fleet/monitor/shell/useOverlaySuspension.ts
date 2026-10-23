import { useEffect, useState } from 'react';

/**
 * How long the hide waits for the exit fade. The fade is 0.16s (PersonaMonitor);
 * a little slack past it means the overlay is still painted for the whole
 * animation and goes `content-visibility: hidden` only once it is already
 * fully transparent.
 */
const HIDE_AFTER_EXIT_MS = 220;

/* OVERLAY SUSPENSION — the mirror of App.tsx's "C5 — SHELL SUSPENSION".
 *
 * `TrayOverlays` keeps the Monitor mounted from the first open onward, so
 * "closed" has to mean something other than "gone". It means what C5 already
 * means one level up, pointed the other way: `inert` + `content-visibility:
 * hidden`, so the browser skips paint, layout and hit-testing for the whole
 * subtree and drops it out of the a11y tree, while React state, effects and
 * every scroll offset inside stay alive. Reopening is therefore instant and
 * lands on the same view, the same scroll position and the same selection —
 * which `display: none` would not give us.
 *
 * `invisible` (visibility: hidden) rides along because this element is NOT
 * the shell: it is a fixed, fully-opaque, z-50 sheet covering the app.
 * `content-visibility: hidden` only skips the CONTENTS — the element itself
 * would still paint its own `bg-background` over everything and still be the
 * hit-test target for every click in the app. `pointer-events-none` is the
 * belt to that braces, because an `inert` element is not hit-tested as a
 * target but is also not transparent to what is behind it.
 *
 * THE ASYMMETRY IS THE SAME ONE C5 MAKES, INVERTED. C5 delays suspending the
 * shell past the overlay's ENTRANCE so nothing visibly vanishes mid-fade,
 * and restores immediately on close so the exit fade plays over live
 * content. Here it is this overlay that fades: hiding is DELAYED past its
 * own 0.16s exit fade (so the fade is seen), showing is IMMEDIATE (so the
 * entrance fade plays over an already-live subtree). Both directions keep
 * the rule: never suspend something that is still animating.
 *
 * Returns `hidden`: true once the overlay is closed AND its fade has played.
 */
export function useOverlaySuspension(visible: boolean): boolean {
  const [hidden, setHidden] = useState(!visible);
  useEffect(() => {
    if (visible) {
      setHidden(false);
      return;
    }
    const id = setTimeout(() => setHidden(true), HIDE_AFTER_EXIT_MS);
    return () => clearTimeout(id);
  }, [visible]);
  return hidden;
}
