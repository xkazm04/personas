import { useEffect, useState } from "react";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { GlyphDimension } from "@/features/shared/glyph";

/** Sequential petal-lighting sweep that runs while the build is in
 *  `isBuildingOnly` (analyzing / resolving with no pending questions).
 *  One petal lights up per `intervalMs`, advances through
 *  GLYPH_DIMENSIONS in order, wraps. Independent of `petalStates` so
 *  it doesn't fight with the per-petal "pending" pulse used during
 *  awaiting_input.
 *
 *  Returns the currently-lit dimension (or `null` when inactive). The
 *  consumer is responsible for translating that into a visual cue —
 *  e.g. a brighter halo on the matching petal.
 *
 *  When `active` flips false, returns `null` immediately so any
 *  in-flight glow can fade out as part of the orbit's exit choreography
 *  (issue #3: "glyphs are all turned off"). */
export function useBuildingPetalSweep(
  active: boolean,
  intervalMs: number = 5000,
): GlyphDimension | null {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      // Reset so the next activation starts at the top, and the consumer
      // sees `null` for the rest of this off-window.
      setIndex(0);
      return;
    }
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % GLYPH_DIMENSIONS.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);

  if (!active) return null;
  return GLYPH_DIMENSIONS[index] ?? null;
}
