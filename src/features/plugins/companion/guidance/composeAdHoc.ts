import { ADHOC_TOPIC } from './walkthroughs';
import { getAnchor } from './anchorCatalog';
import type { GuidanceWalkthrough } from './types';

/**
 * Builders for Athena's runtime-composed walkthroughs — the ones she assembles
 * on the fly from the anchor catalog rather than the static registry. The
 * caption/runner narration callbacks ignore their `t` argument here because the
 * text is a literal string Athena authored for this turn (already in the user's
 * language — she replies in their locale), not a translation key.
 */

/** Single-step walkthrough for the `point_at` op. Returns null if the anchor
 *  isn't in the catalog (the catalog is the frontend source of truth for the
 *  testid + route; the backend allow-list mirrors its keys). */
export function buildPointAtWalkthrough(
  anchorId: string,
  narration: string,
): GuidanceWalkthrough | null {
  const anchor = getAnchor(anchorId);
  if (!anchor) return null;
  const text = narration.trim();
  return {
    topic: ADHOC_TOPIC,
    title: () => text,
    steps: [
      {
        id: 'point',
        narration: () => text,
        highlightTestId: anchor.testId,
        navigateRoute: anchor.route,
        orbAnchor: 'auto',
      },
    ],
  };
}
