/**
 * Empty-lane glyph for a NOW/NEXT/LATER column with nothing in it — an empty
 * waypoint bracket on the trail, with the path dashing onward past it. Replaces a
 * bare em-dash in a dashed box.
 *
 * `fade-pop`, not `staggered-draw`: at 48px a per-path stagger across six paths is
 * noise rather than a reveal. And deliberately no ambient loop — an empty lane is
 * idle, so a breathing or drifting accent would imply work that isn't happening.
 */
import { MotionizedGlyph } from '@/features/shared/components/display/MotionizedGlyph';
import { ROADMAP_WAYPOINT_GLYPH } from '@/features/shared/glyph/glyphs/roadmapWaypointGlyph';

export default function RoadmapLaneEmptyGlyph() {
  return (
    <MotionizedGlyph
      data={ROADMAP_WAYPOINT_GLYPH.data}
      viewBox={ROADMAP_WAYPOINT_GLYPH.viewBox}
      className="h-12 w-12"
      entrance="fade-pop"
    />
  );
}
