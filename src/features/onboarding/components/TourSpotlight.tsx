import { useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import { useTrackedElementRect } from '@/hooks/utility/interaction/useTrackedElementRect';

const PADDING = 8;
const BORDER_RADIUS = 12;

/**
 * Spotlight contract (pinned 2026-04-20):
 * - Follows exactly one DOM node: the element matching
 *   `[data-testid="${tourHighlightTestId}"]`.
 * - Re-measures on: scroll, resize, and DOM mutations inside an ancestor of
 *   the target (NOT document.body — onboarding-era CPU wins matter).
 * - When the target unmounts for good (after a short re-appear retry window),
 *   the spotlight auto-dismisses the tour instead of trapping the UI behind a
 *   stale cut-out that overlays nothing clickable.
 *
 * The element-tracking core (measure + observer + missing-target retry) now
 * lives in the shared `useTrackedElementRect` hook, also used by Athena's
 * non-dimming `AthenaGuideGlow`. This component owns only the dimming visual.
 */
export default function TourSpotlight() {
  const tourActive = useSystemStore((s) => s.tourActive);
  const highlightTestId = useSystemStore((s) => s.tourHighlightTestId);
  // Tour store exposes a dismissTour action; we call it if the target disappears.
  const dismissTour = useSystemStore((s) => s.dismissTour);

  const onMissing = useCallback(() => {
    // Auto-end the tour so the user isn't stuck behind a stale mask.
    // `dismissTour` is idempotent, so racing mutations can't stack dismissals.
    try {
      dismissTour?.();
    } catch (err) {
      silentCatch('features/onboarding/components/TourSpotlight:catch1')(err);
    }
  }, [dismissTour]);

  const rect = useTrackedElementRect(highlightTestId, {
    padding: PADDING,
    active: tourActive,
    onMissing,
  });

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
