import { createPortal } from 'react-dom';
import { useGuidanceRunner } from '../guidance/useGuidanceRunner';
import { AthenaGuideGlow } from './AthenaGuideGlow';
import { GuideCaption } from './GuideCaption';

/**
 * Root-level host for Athena's guided-walkthrough overlays. Mounted once in
 * `App.tsx` and portal'd to `document.body` so its contents float above app
 * content (and escape any `transform`/`overflow` ancestor) regardless of the
 * current route.
 *
 * Hosts the walkthrough runner (`useGuidanceRunner`, which drives the orb +
 * highlight per step) and renders only what an active walkthrough needs:
 *  - `AthenaGuideGlow` — the non-dimming element ring (renders nothing unless
 *    `guidanceHighlightTestId` is set).
 *  - `GuideCaption` — the narration card + Pause/Skip/Stop controls (renders
 *    nothing unless a walkthrough is active).
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
      <AthenaGuideGlow />
      <GuideCaption />
    </div>,
    document.body,
  );
}
