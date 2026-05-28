import { useReducedMotion } from 'framer-motion';
import { useTrackedElementRect } from '@/hooks/utility/interaction/useTrackedElementRect';
import { useCompanionStore } from '../companionStore';

const GLOW_PADDING = 6;
const BORDER_RADIUS = 12;

/**
 * Which store slot drives this ring:
 *  - `guide`  — `guidanceHighlightTestId`: the persistent highlight a guided
 *    walkthrough rings on its current step (breathing halo + lock-on reticle).
 *  - `flash`  — `flashHighlightTestId`: the proactive one-shot "look here" pulse
 *    fired on navigate/compose (brighter, self-clearing after ~2.4s).
 */
export type GlowSource = 'guide' | 'flash';

const TESTID_ATTR: Record<GlowSource, string> = {
  // Consumed by the test-automation bridge (`bridge.ts` glowRect) — do not rename.
  guide: 'athena-guide-glow',
  flash: 'athena-flash-glow',
};

/**
 * Athena's non-dimming element highlight — a soft breathing halo with crisp
 * animated corner brackets that "lock on" to the target, drawn around the
 * element matching the store's highlight testid. Unlike the onboarding
 * `TourSpotlight`, it does NOT dim or block the screen: everything stays visible
 * and clickable, so it reads like Athena *pointing* at a thing, not a modal.
 *
 * This is the single highlight primitive behind BOTH the walkthrough ring
 * (`source="guide"`) and the proactive flash (`source="flash"`) — they differ
 * only by which store slot feeds the testid and which CSS treatment plays
 * (`.athena-ring--guide` breathes continuously; `.athena-ring--flash` double-
 * pulses then the store clears it). Each instance subscribes to exactly one
 * store field, so a guide change never re-renders the flash ring and vice versa.
 *
 * Tracking (rect + observer + missing-target retry) is shared with TourSpotlight
 * via `useTrackedElementRect`. Rendered inside `AthenaGuideLayer`'s body portal
 * so it escapes any `transform`/`overflow` ancestor; pointer-events-none, so it
 * never intercepts the click on the element it rings (the walkthrough's
 * click-to-advance depends on that). Static (no animation) under
 * `prefers-reduced-motion`.
 */
export function TrackedGlowRing({ source }: { source: GlowSource }) {
  const testId = useCompanionStore((s) =>
    source === 'guide' ? s.guidanceHighlightTestId : s.flashHighlightTestId,
  );
  const reduceMotion = useReducedMotion();
  const rect = useTrackedElementRect(testId, {
    padding: GLOW_PADDING,
    active: !!testId,
  });

  if (!testId || !rect) return null;

  return (
    <div
      data-testid={TESTID_ATTR[source]}
      aria-hidden
      className="pointer-events-none fixed"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      {/* keyed by testId so the lock-on animation replays each time the ring
          re-targets a new element (the wrapper stays mounted and just moves). */}
      <div
        key={testId}
        className={`athena-ring athena-ring--${source} ${reduceMotion ? 'athena-ring--static' : ''}`}
        style={{ borderRadius: BORDER_RADIUS }}
      >
        <span className="athena-ring__corner athena-ring__corner--tl" />
        <span className="athena-ring__corner athena-ring__corner--tr" />
        <span className="athena-ring__corner athena-ring__corner--bl" />
        <span className="athena-ring__corner athena-ring__corner--br" />
      </div>
    </div>
  );
}
