import { useEffect, useState } from 'react';

/**
 * How many parts of the sheet are drawn: the first at once, then one more
 * every `stepMs`, from the moment this drawing (`key`) first appeared, up to
 * `total`; `stepMs` 0 (reduced motion) draws everything at once. A new key
 * starts over.
 *
 * Studio's `useBuildUp` has the same contract but measures elapsed time with
 * `Date.now()`; the page harness pins the clock (`page.clock.setFixedTime`), so
 * there it never advances past the first part. This counts timer ticks
 * instead, which a pinned clock leaves running.
 */
export function useDrawSteps(key: string, total: number, stepMs: number): number {
  const instant = stepMs <= 0;
  const [state, setState] = useState(() => ({ key, n: 1 }));
  if (state.key !== key) {
    // A new drawing: its build-up starts now (React's adjust-on-prop pattern).
    setState({ key, n: 1 });
  }
  const n = state.key === key ? state.n : 1;

  useEffect(() => {
    if (instant || n >= total) return;
    const timer = window.setTimeout(() => setState((s) => (s.key === key ? { key, n: s.n + 1 } : s)), stepMs);
    return () => window.clearTimeout(timer);
  }, [instant, n, total, stepMs, key]);

  return instant ? total : Math.min(total, n);
}
