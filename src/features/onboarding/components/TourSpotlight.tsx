import { useEffect, useRef, useState, useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';

interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PADDING = 8;
const BORDER_RADIUS = 12;

/**
 * Spotlight contract (pinned 2026-04-20):
 * - Follows exactly one DOM node: the element matching
 *   `[data-testid="${tourHighlightTestId}"]`.
 * - Re-measures on: scroll, resize, and DOM mutations inside an ancestor of
 *   the target (NOT document.body — onboarding-era CPU wins matter).
 * - When the target unmounts, the spotlight auto-dismisses the tour instead of
 *   trapping the UI behind a stale cut-out that overlays nothing clickable.
 */
export default function TourSpotlight() {
  const tourActive = useSystemStore((s) => s.tourActive);
  const highlightTestId = useSystemStore((s) => s.tourHighlightTestId);
  // Tour store exposes an dismissTour action; we call it if the target disappears.
  const dismissTour = useSystemStore((s) => s.dismissTour);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const rafRef = useRef<number>(0);

  const measure = useCallback((): Element | null => {
    if (!highlightTestId) {
      setRect(null);
      return null;
    }
    const el = document.querySelector(`[data-testid="${highlightTestId}"]`);
    if (!el || !el.isConnected) {
      setRect(null);
      return null;
    }
    const r = el.getBoundingClientRect();
    setRect({
      x: r.x - PADDING,
      y: r.y - PADDING,
      width: r.width + PADDING * 2,
      height: r.height + PADDING * 2,
    });
    return el;
  }, [highlightTestId]);

  useEffect(() => {
    if (!tourActive || !highlightTestId) {
      setRect(null);
      return;
    }

    let currentTarget: Element | null = null;
    let observer: MutationObserver | null = null;

    const dismissForMissingTarget = () => {
      setRect(null);
      // Auto-end the tour so the user isn't stuck behind a stale mask.
      // `dismissTour` is idempotent, so racing mutations can't stack dismissals.
      try { dismissTour?.(); } catch { /* intentional: dismissTour may be a no-op */ }
    };

    const handleReposition = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        // If the target vanished (sidebar collapse, route change, modal close),
        // bail out of the tour rather than rendering a mask over nothing.
        if (currentTarget && !currentTarget.isConnected) {
          dismissForMissingTarget();
          return;
        }
        const found = measure();
        if (!found) {
          dismissForMissingTarget();
        } else if (found !== currentTarget) {
          // Target re-mounted at a new node — re-scope observer.
          currentTarget = found;
          reattachObserver();
        }
      });
    };

    const reattachObserver = () => {
      observer?.disconnect();
      if (!currentTarget) return;
      // Scope to an ancestor of the target so background rendering (toasts,
      // chat streaming, build events) can't force repeated rAF re-measures.
      const scope = currentTarget.parentElement ?? currentTarget;
      observer = new MutationObserver(handleReposition);
      observer.observe(scope, { childList: true, subtree: true });
    };

    // Initial measure with delay for layout
    const timer = setTimeout(() => {
      currentTarget = measure();
      if (!currentTarget) {
        dismissForMissingTarget();
        return;
      }
      reattachObserver();
    }, 100);

    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
      observer?.disconnect();
    };
  }, [tourActive, highlightTestId, measure, dismissTour]);

  if (!tourActive || !rect) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  return (
    <div
      data-testid="tour-spotlight"
      className="fixed inset-0 z-[9998] pointer-events-none"
      aria-hidden
    >
      <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <mask id="tour-spotlight-mask">
            <rect x="0" y="0" width={vw} height={vh} fill="white" />
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx={BORDER_RADIUS}
              ry={BORDER_RADIUS}
              fill="black"
            />
          </mask>
        </defs>
        {/* Semi-transparent overlay with cutout */}
        <rect
          x="0"
          y="0"
          width={vw}
          height={vh}
          fill="rgba(0,0,0,0.35)"
          mask="url(#tour-spotlight-mask)"
        />
        {/* Pulsing border around target */}
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={BORDER_RADIUS}
          ry={BORDER_RADIUS}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="2"
          strokeOpacity="0.5"
          className="animate-pulse"
        />
      </svg>
    </div>
  );
}
