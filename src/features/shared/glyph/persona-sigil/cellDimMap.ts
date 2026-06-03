import type { GlyphDimension } from "@/features/shared/glyph/types";

/**
 * Canonical mapping between the build-engine's cell-key vocabulary and the
 * 8 persona-sigil dimensions.
 *
 * Glyph-convergence P4: this map was duplicated byte-for-byte in the
 * from-scratch flow (`agents/sub_glyph/glyphLayoutHelpers.ts`) and the
 * seeded/adoption flow (`templates/.../persona-layout/PersonaLayoutBuild.tsx`,
 * whose comment explicitly noted it was "kept local"). Both now re-export
 * from here so the cell→dim contract has a single source of truth — the seam
 * the eventual unified build surface hangs on.
 *
 * Note `sample-output` is listed FIRST and shares the `task` petal with
 * `use-cases`; the `Object.fromEntries` reverse below relies on last-key-wins
 * so `task` resolves back to `use-cases` (only the forward lookup picks up the
 * sample-output entry).
 */
export const CELL_KEY_TO_DIM: Record<string, GlyphDimension> = {
  "sample-output": "task",
  "use-cases": "task",
  connectors: "connector",
  triggers: "trigger",
  "human-review": "review",
  messages: "message",
  memory: "memory",
  "error-handling": "error",
  events: "event",
};

export const DIM_TO_CELL_KEY: Record<GlyphDimension, string> = Object.fromEntries(
  Object.entries(CELL_KEY_TO_DIM).map(([k, v]) => [v, k]),
) as Record<GlyphDimension, string>;
