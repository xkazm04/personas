import { useCallback, useEffect, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useTrackedElementRect } from '@/hooks/utility/interaction/useTrackedElementRect';

const PADDING = 8;
const BORDER_RADIUS = 12;

/**
 * Spotlight contract (pinned 2026-04-20):
 * - Follows exactly one DOM node: the element matching
 *   `[data-testid="${tourHighlightTestId}"]`.
 * - Re-measures on: scroll, resize, and DOM mutations inside an ancestor of
 *   the target (NOT document.body — onboarding-era CPU wins matter).
 * - When the target can't be found (initial anchor-miss or anchored-then-gone),
 *   the spotlight no longer dismisses the tour. It flags `tourHighlightMissing`
 *   so the panel shows a "not on screen yet" note while the tour stays alive;
 *   the overlay is `pointer-events-none`, so an absent cut-out never traps the
 *   UI. (Earlier this path called `dismissTour`, which was too aggressive — it
 *   killed the whole tour on a transient/never-present anchor.)
 *
 * The element-tracking core (measure + observer + missing-target retry) now
 * lives in the shared `useTrackedElementRect` hook, also used by Athena's
 * non-dimming `TrackedGlowRing`. This component owns only the dimming visual.
 */
export default function TourSpotlight() {
  const tourActive = useSystemStore((s) => s.tourActive);
  const highlightTestId = useSystemStore((s) => s.tourHighlightTestId);
  const setHighlightMissing = useSystemStore((s) => s.setHighlightMissing);

  // Flag (don't dismiss) when the target can't be found, so the tour survives.
  const onMissing = useCallback(() => {
    setHighlightMissing(true);
  }, [setHighlightMissing]);

  const rect = useTrackedElementRect(highlightTestId, {
    padding: PADDING,
    active: tourActive,
    onMissing,
  });

  // Keep the flag in sync: clear optimistically whenever the highlight changes
  // (the tracker re-assesses), and whenever the target is actually found.
  useEffect(() => {
    setHighlightMissing(false);
  }, [highlightTestId, setHighlightMissing]);
  useEffect(() => {
    if (rect) setHighlightMissing(false);
  }, [rect, setHighlightMissing]);

  // Glide the cut-out between steps. The tracker holds the previous rect during
  // its ~100ms re-measure on a highlight change, so the rect jumps old→new and a
  // CSS transition animates that jump. Gate it to a short window after the
  // highlight changes so live scroll/resize tracking stays instant (no lag), and
  // let the global prefers-reduced-motion rule collapse it to instant.
  const [transitioning, setTransitioning] = useState(false);
  useEffect(() => {
    if (!highlightTestId) { setTransitioning(false); return; }
    setTransitioning(true);
    const id = window.setTimeout(() => setTransitioning(false), 500);
    return () => window.clearTimeout(id);
  }, [highlightTestId]);

  if (!tourActive || !rect) return null;

  const glide = transitioning
    ? 'x 0.35s ease, y 0.35s ease, width 0.35s ease, height 0.35s ease'
    : undefined;

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
              style={{ transition: glide }}
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
          style={{ transition: glide }}
        />
      </svg>
    </div>
  );
}
