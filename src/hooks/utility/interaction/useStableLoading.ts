import { useEffect, useRef, useState } from 'react';

export interface StableLoadingOptions {
  /**
   * If `loading` clears within this window, the placeholder is never shown —
   * fast / cached loads render straight to content with no flash. Default 140ms.
   */
  graceMs?: number;
  /**
   * Once the placeholder is shown it stays visible at least this long, even if
   * `loading` clears sooner — a placeholder can never appear-and-vanish in a
   * jarring blink. Default 420ms.
   */
  minVisibleMs?: number;
}

/**
 * Smooths a raw boolean `loading` flag into a **stable** "show placeholder"
 * flag that neither flashes nor blinks — the timing spine of the Overview
 * golden loading pattern (`docs/design/overview-loading.md`).
 *
 * - **Anti-flash:** stays `false` for the first `graceMs`. A load that resolves
 *   inside that window renders content directly — no placeholder at all.
 * - **Anti-blink:** once it flips `true` it stays `true` for at least
 *   `minVisibleMs`, so a shown placeholder can never vanish in a single frame.
 *
 * Render the static frame unconditionally, then gate only the data region on
 * the returned flag: `const showLoading = useStableLoading(loading)`.
 *
 * It governs *which* state renders, not *how* it animates — the reveal
 * components (`Reveal` / `LoadingReveal`) collapse motion under reduced-motion.
 */
export function useStableLoading(
  loading: boolean,
  options: StableLoadingOptions = {},
): boolean {
  const { graceMs = 140, minVisibleMs = 420 } = options;
  const [showLoading, setShowLoading] = useState(false);
  // Timestamp the placeholder became visible, so we can enforce min-visible.
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (loading) {
      if (showLoading) return; // already visible — nothing to schedule
      // Defer showing until grace elapses; a fast load clears this timer first.
      const graceTimer = setTimeout(() => {
        shownAtRef.current = Date.now();
        setShowLoading(true);
      }, graceMs);
      return () => clearTimeout(graceTimer);
    }

    // loading === false
    if (!showLoading) return; // never crossed grace — nothing to hide
    const shownAt = shownAtRef.current ?? Date.now();
    const remaining = minVisibleMs - (Date.now() - shownAt);
    if (remaining <= 0) {
      shownAtRef.current = null;
      setShowLoading(false);
      return;
    }
    const hideTimer = setTimeout(() => {
      shownAtRef.current = null;
      setShowLoading(false);
    }, remaining);
    return () => clearTimeout(hideTimer);
  }, [loading, showLoading, graceMs, minVisibleMs]);

  return showLoading;
}
