import { useReducedMotion } from 'framer-motion';
import { useTrackedElementRect } from '@/hooks/utility/interaction/useTrackedElementRect';
import { useCompanionStore } from '../companionStore';

const GLOW_PADDING = 6;
const BORDER_RADIUS = 12;

/**
 * Athena's non-dimming element highlight — a pulsing accent ring drawn around
 * the element matching `[data-testid="${guidanceHighlightTestId}"]` during a
 * guided walkthrough. Unlike the onboarding `TourSpotlight`, this does NOT dim
 * or block the rest of the screen: the user can still see and click everything.
 * It reads like Athena pointing at a thing, not a modal trapping the UI.
 *
 * Tracking (rect + observer + missing-target retry) is shared with TourSpotlight
 * via `useTrackedElementRect`. Rendered inside `AthenaGuideLayer`'s body portal
 * so it escapes any `transform`/`overflow` ancestor. Pointer-events-none, so it
 * never intercepts clicks on the element it rings. Static (no pulse) under
 * `prefers-reduced-motion`.
 */
export function AthenaGuideGlow() {
  const testId = useCompanionStore((s) => s.guidanceHighlightTestId);
  const reduceMotion = useReducedMotion();
  const rect = useTrackedElementRect(testId, {
    padding: GLOW_PADDING,
    active: !!testId,
  });

  if (!testId || !rect) return null;

  return (
    <div
      data-testid="athena-guide-glow"
      aria-hidden
      className={`pointer-events-none fixed border-2 border-primary ${
        reduceMotion ? 'athena-guide-glow-static' : 'athena-guide-glow-pulse'
      }`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        borderRadius: BORDER_RADIUS,
      }}
    />
  );
}
