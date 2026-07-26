/**
 * The traced route glyph that runs alongside the roadmap hero, isolated behind its
 * own module so it lazy-loads with the roadmap tab rather than sitting in the eager
 * entry chunk (see GoalsEmptyGlyph for the same reasoning).
 *
 * Reads bottom-to-top the way the lanes below it do: amber node = the item shipping
 * NOW, teal = NEXT, hollow ring = LATER, dashes trailing off past the last one. The
 * `pulse` ambient loop is legitimate here and only here on this surface — the hero is
 * by definition the in-progress item, so breathing accents describe real work. The
 * idle lanes get a static glyph instead.
 */
import { MotionizedGlyph } from '@/features/shared/components/display/MotionizedGlyph';
import { ROADMAP_ROUTE_GLYPH } from '@/features/shared/glyph/glyphs/roadmapRouteGlyph';

/**
 * The traced canvas is 1024² with wide empty margins around a tall composition;
 * this window crops to the route itself so it can render as a narrow vertical rail.
 */
const RAIL_VIEWBOX = '345 145 310 840';

export default function RoadmapRouteRail() {
  return (
    <MotionizedGlyph
      data={ROADMAP_ROUTE_GLYPH.data}
      viewBox={RAIL_VIEWBOX}
      className="h-auto w-9 shrink-0 self-stretch"
      spread={0.9}
      ambient="pulse"
      glow
    />
  );
}
