// The row grows into the layer (B/1's transition, which the owner asked to keep:
// "nice animated transition"). Where the browser has view transitions the row
// and the layer share one name and the browser morphs one into the other; the
// React commit happens synchronously inside the transition callback, so the
// "new" snapshot is the rendered layer. Without them, or under reduced motion,
// the update is applied at once and the caller falls back to a cross-fade.

import { flushSync } from 'react-dom';

const NAME = 'cad-deed';

type ViewTransitionDoc = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * @param from the element the deed grows out of (a row, a parcel), or the
 *   layer when closing
 * @param to called after the update to find the element it lands on
 * @returns true when a view transition ran, false when the caller should play
 *   its own fallback
 */
export function runDeedTransition(
  update: () => void,
  from: HTMLElement | null,
  to: () => HTMLElement | null,
  dir: 'in' | 'out',
): boolean {
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || prefersReducedMotion()) {
    flushSync(update);
    return false;
  }
  if (from) from.style.viewTransitionName = NAME;
  const root = document.documentElement;
  root.classList.add(`cad-vt-${dir}`);
  let landed: HTMLElement | null = null;
  const vt = doc.startViewTransition(() => {
    if (from) from.style.viewTransitionName = '';
    flushSync(update);
    landed = to();
    if (landed) landed.style.viewTransitionName = NAME;
  });
  // A skipped transition rejects `finished`; the cleanup is the same either way.
  const done = () => {
    if (landed) landed.style.viewTransitionName = '';
    if (from) from.style.viewTransitionName = '';
    root.classList.remove(`cad-vt-${dir}`);
  };
  vt.finished.then(done, done);
  return true;
}
