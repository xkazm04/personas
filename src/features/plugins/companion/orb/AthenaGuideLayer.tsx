import { createPortal } from 'react-dom';
import { AthenaGuideGlow } from './AthenaGuideGlow';

/**
 * Root-level host for Athena's guided-walkthrough overlays. Mounted once in
 * `App.tsx` and portal'd to `document.body` so its contents float above app
 * content (and escape any `transform`/`overflow` ancestor) regardless of the
 * current route.
 *
 * Always mounted, but renders only what an active walkthrough needs:
 *  - `AthenaGuideGlow` — the non-dimming element ring (renders nothing unless
 *    `guidanceHighlightTestId` is set).
 *  - (Phase 3) the narration caption + Stop/Skip controls and the walkthrough
 *    runner that drives the orb + highlight per step.
 *
 * The layer itself is `pointer-events-none`; interactive children opt back in.
 * Distinct from `AthenaOrbLayer` (which only mounts while `state === 'minimized'`)
 * because a highlight must be able to appear over any screen, orb or not.
 */
export default function AthenaGuideLayer() {
  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[60]"
      aria-live="polite"
      data-testid="athena-guide-layer"
    >
      <AthenaGuideGlow />
    </div>,
    document.body,
  );
}
