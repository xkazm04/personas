/**
 * The traced goals glyph, isolated behind its own module so it can be lazy-loaded.
 * GoalsTimeline is imported by two separate lazy chunks (GoalsPage and the fleet
 * Stream); a static glyph import would hoist ~12KB gzipped of path
 * data into the eager entry chunk. Loading it only when the empty state actually
 * renders keeps it out of the entry — the glyph animates itself in regardless, so the
 * one-frame Suspense gap is invisible.
 */
import { MotionizedGlyph } from '@/features/shared/components/display/MotionizedGlyph';
import { GOALS_GLYPH } from '@/features/shared/glyph/glyphs/goalsGlyph';

export default function GoalsEmptyGlyph() {
  return <MotionizedGlyph data={GOALS_GLYPH.data} viewBox={GOALS_GLYPH.viewBox} spread={1} className="w-36 h-36 mb-2" />;
}
