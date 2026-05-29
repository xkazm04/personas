import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Viewport-space rectangle of a tracked element, optionally inflated by a
 * uniform `padding`. `x`/`y` are the top-left in `getBoundingClientRect`
 * coordinates (fixed-position friendly).
 */
export interface TrackedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UseTrackedElementRectOptions {
  /** Inflate the measured rect by this many px on every side (default 0). */
  padding?: number;
  /** When false the hook is dormant and always returns null (default true). */
  active?: boolean;
  /**
   * Called once when the target can't be found after the retry window — e.g.
   * the element unmounted for good (route left the view, modal closed). NOT
   * called for transient disconnects that re-appear within the retry budget.
   * Omit to silently clear the rect (the common case for an ambient glow).
   */
  onMissing?: () => void;
}

// Mirrors tourSlice's TOUR_TEST_ID_PATTERN — kept local so this generic hook
// carries no dependency on the onboarding store slice. Defense-in-depth: every
// known caller already validates the id at its setter, but a stray value must
// never reach querySelector and throw a SyntaxError that kills tracking for the
// rest of the session.
const TESTID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// A target can briefly disconnect between view transitions (the anchor unmounts,
// then re-mounts at a new DOM node with the same testid). Give it a short window
// to reappear before declaring it gone — pulled verbatim from TourSpotlight's
// hard-won step-transition handling (commit fc763c86d).
const MISSING_TARGET_RETRY_MS = 500;
const MAX_MISSING_TARGET_RETRIES = 4;

/**
 * Track a single DOM element (matched by `[data-testid="${testId}"]`) and
 * return its live viewport rect, re-measuring on scroll, resize, and DOM
 * mutations inside an ancestor of the target. The element keeps its own
 * stacking context untouched — the caller renders a `fixed` overlay from the
 * returned rect.
 *
 * This is the shared measurement core behind both the onboarding
 * `TourSpotlight` (dimming cutout) and Athena's `TrackedGlowRing` (non-dimming
 * ring). It owns rect math + observer lifecycle + the missing-target retry; the
 * callers own the visual.
 */
export function useTrackedElementRect(
  testId: string | null,
  opts: UseTrackedElementRectOptions = {},
): TrackedRect | null {
  const { padding = 0, active = true, onMissing } = opts;
  const [rect, setRect] = useState<TrackedRect | null>(null);
  const rafRef = useRef<number>(0);
  // Hold the latest onMissing in a ref so changing the callback identity
  // doesn't tear down and rebuild the observer/listeners every render.
  const onMissingRef = useRef(onMissing);
  onMissingRef.current = onMissing;

  const enabled = active && !!testId;

  const measure = useCallback((): Element | null => {
    if (!testId || !TESTID_PATTERN.test(testId)) {
      setRect(null);
      return null;
    }
    const matches = document.querySelectorAll(`[data-testid="${testId}"]`);
    if (matches.length === 0) {
      setRect(null);
      return null;
    }
    if (matches.length > 1 && typeof console !== 'undefined') {
      // Ambiguous testid — we ring the first match, which is sometimes the
      // wrong node when a testid is rendered twice (sticky header + body).
      console.warn(
        `[useTrackedElementRect] data-testid="${testId}" matched ${matches.length} elements; tracking the first`,
      );
    }
    const el = matches[0];
    if (!el || !el.isConnected) {
      setRect(null);
      return null;
    }
    const r = el.getBoundingClientRect();
    setRect({
      x: r.x - padding,
      y: r.y - padding,
      width: r.width + padding * 2,
      height: r.height + padding * 2,
    });
    return el;
  }, [testId, padding]);

  useEffect(() => {
    if (!enabled) {
      setRect(null);
      return;
    }

    let currentTarget: Element | null = null;
    let observer: MutationObserver | null = null;
    let missingRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let missingRetryCount = 0;

    const clearMissingRetry = () => {
      if (missingRetryTimer !== null) {
        clearTimeout(missingRetryTimer);
        missingRetryTimer = null;
      }
      missingRetryCount = 0;
    };

    const reportMissing = () => {
      clearMissingRetry();
      setRect(null);
      onMissingRef.current?.();
    };

    const reattachObserver = () => {
      observer?.disconnect();
      if (!currentTarget) return;
      // Scope to an ancestor so unrelated background rendering (toasts, chat
      // streaming, build events) can't force repeated rAF re-measures.
      const scope = currentTarget.parentElement ?? currentTarget;
      observer = new MutationObserver(handleReposition);
      observer.observe(scope, { childList: true, subtree: true });
    };

    const scheduleMissingRetry = () => {
      if (missingRetryTimer !== null) return; // already scheduled
      if (missingRetryCount >= MAX_MISSING_TARGET_RETRIES) {
        reportMissing();
        return;
      }
      missingRetryCount++;
      missingRetryTimer = setTimeout(() => {
        missingRetryTimer = null;
        const found = measure();
        if (found) {
          currentTarget = found;
          missingRetryCount = 0;
          reattachObserver();
        } else {
          scheduleMissingRetry();
        }
      }, MISSING_TARGET_RETRY_MS);
    };

    function handleReposition() {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (currentTarget && !currentTarget.isConnected) {
          scheduleMissingRetry();
          return;
        }
        const found = measure();
        if (!found) {
          scheduleMissingRetry();
        } else if (found !== currentTarget) {
          currentTarget = found;
          clearMissingRetry();
          reattachObserver();
        } else {
          clearMissingRetry();
        }
      });
    }

    // Initial measure with a short delay so layout has settled after a view
    // change (the testid may not be mounted on the same frame as activation).
    const timer = setTimeout(() => {
      currentTarget = measure();
      if (!currentTarget) {
        reportMissing();
        return;
      }
      reattachObserver();
    }, 100);

    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);

    return () => {
      clearTimeout(timer);
      clearMissingRetry();
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
      observer?.disconnect();
    };
  }, [enabled, measure]);

  return rect;
}
