import { createPortal } from 'react-dom';
import { useGuidanceRunner } from '../guidance/useGuidanceRunner';
import { TrackedGlowRing } from './TrackedGlowRing';
import { GuideCaption } from './GuideCaption';
import { OrbDecisionBubble } from './OrbDecisionBubble';
import { OrbUnreadBubble } from './OrbUnreadBubble';
import { RemoteJobNoticeChip } from './RemoteJobNoticeChip';
import { DecisionDriver } from '../decision/useDecisionQueue';

/**
 * Root-level host for Athena's guided-walkthrough overlays. Mounted once in
 * `App.tsx` and portal'd to `document.body` so its contents float above app
 * content (and escape any `transform`/`overflow` ancestor) regardless of the
 * current route.
 *
 * Hosts the walkthrough runner (`useGuidanceRunner`, which drives the orb +
 * highlight per step) and renders only what an active walkthrough needs:
 *  - `TrackedGlowRing source="guide"` — the non-dimming walkthrough ring
 *    (renders nothing unless `guidanceHighlightTestId` is set).
 *  - `TrackedGlowRing source="flash"` — the proactive one-shot "look here" ring
 *    (renders nothing unless `flashHighlightTestId` is set); fires on
 *    navigate/compose. Same primitive, different store slot + CSS treatment.
 *  - `GuideCaption` — the narration card + Back/Pause/Skip/Stop controls
 *    (renders nothing unless a walkthrough is active).
 *  - `OrbDecisionBubble` / `OrbUnreadBubble` — the two surfaces that dock
 *    above the orb. Mutually exclusive by construction: the unread bubble
 *    stands down whenever a decision is pending, because a question aimed at
 *    the operator outranks news.
 *  - `RemoteJobNoticeChip` — the ambient "a paired device asked Athena to run
 *    something" notice (renders nothing unless one is live). Docks BELOW the
 *    orb so it never competes with the caption or the decision bubble — and,
 *    being below, it does not contend with the two bubbles above either.
 *
 * The layer itself is `pointer-events-none`; interactive children opt back in.
 * Distinct from `AthenaOrbLayer` (which only mounts while `state === 'minimized'`)
 * because a highlight must be able to appear over any screen, orb or not.
 */
export default function AthenaGuideLayer() {
  useGuidanceRunner();
  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[60]"
      aria-live="polite"
      data-testid="athena-guide-layer"
    >
      <TrackedGlowRing source="guide" />
      <TrackedGlowRing source="flash" />
      <GuideCaption />
      <OrbDecisionBubble />
      <OrbUnreadBubble />
      <RemoteJobNoticeChip />
      <DecisionDriver />
    </div>,
    document.body,
  );
}
