import { ADHOC_TOPIC } from './walkthroughs';
import { getAnchor } from './anchorCatalog';
import { navigateToSection } from './appActions';
import { getActiveTranslations } from '@/i18n/useTranslation';
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
  const wt: GuidanceWalkthrough = {
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
  // When Athena points at a nav item without opening it (no `route`, but a
  // `dest`), offer a "Take me there" CTA that navigates to the section. Content
  // anchors (with a `route`) already took the user there, so they get no CTA.
  if (!anchor.route && anchor.dest) {
    const dest = anchor.dest;
    wt.cta = {
      label: () => getActiveTranslations().plugins.companion.guide_take_me_there,
      onSelect: () => navigateToSection(dest),
    };
  }
  return wt;
}

/** One step of a `compose_walkthrough` — an anchor id + the line to narrate. */
export interface ComposedStep {
  anchor: string;
  narration: string;
}

/** Multi-step walkthrough for the `compose_walkthrough` op — Athena's
 *  runtime-assembled tour. Steps whose anchor isn't in the catalog or whose
 *  narration is blank are dropped (the backend validated already; this is
 *  belt-and-suspenders). Returns null if no valid steps remain. */
export function buildComposedWalkthrough(
  steps: ComposedStep[],
  title?: string,
): GuidanceWalkthrough | null {
  const built = steps
    .map((s, i) => {
      const anchor = getAnchor(s.anchor);
      const text = s.narration?.trim() ?? '';
      if (!anchor || !text) return null;
      return {
        id: `step-${i}`,
        narration: () => text,
        highlightTestId: anchor.testId,
        navigateRoute: anchor.route,
        orbAnchor: 'auto' as const,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  if (built.length === 0) return null;
  const heading = title?.trim() ?? '';
  return {
    topic: ADHOC_TOPIC,
    title: () => heading,
    steps: built,
  };
}
