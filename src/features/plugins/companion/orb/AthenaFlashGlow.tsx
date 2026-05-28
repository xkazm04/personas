import { useReducedMotion } from 'framer-motion';
import { useTrackedElementRect } from '@/hooks/utility/interaction/useTrackedElementRect';
import { useCompanionStore } from '../companionStore';

const GLOW_PADDING = 6;
const BORDER_RADIUS = 12;

/**
 * Proactive one-shot "look here" ring — the lightweight cousin of
 * `AthenaGuideGlow`. Rings the element matching `flashHighlightTestId` (set by
 * `flashHighlight`) for a couple of seconds when Athena navigates or composes a
 * surface, then auto-clears from the store. No orb, no caption — just a brief
 * attention pulse so the user's eye lands on what she just brought up.
 *
 * Shares the element-tracking core (`useTrackedElementRect`) and the
 * `athena-guide-glow` keyframe with the walkthrough glow, but is driven by its
 * own store slot and never coexists with a walkthrough (the store skips the
 * flash while one is active). Pointer-events-none; static under reduced motion.
 */
export function AthenaFlashGlow() {
  const testId = useCompanionStore((s) => s.flashHighlightTestId);
  const reduceMotion = useReducedMotion();
  const rect = useTrackedElementRect(testId, {
    padding: GLOW_PADDING,
    active: !!testId,
  });

  if (!testId || !rect) return null;

  return (
    <div
      data-testid="athena-flash-glow"
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
