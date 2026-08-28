import { GLYPH_DIMENSIONS, type GlyphDimension } from "@/features/shared/glyph/types";

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
 * DIRECTION MATTERS, and it used to run the wrong way. `CELL_KEY_TO_DIM` was
 * the hand-maintained map and `DIM_TO_CELL_KEY` was reversed out of it with
 * `Object.fromEntries(...) as Record<GlyphDimension, string>` — an assertion
 * that *claimed* all eight dimensions were covered while deriving from a
 * partial, hand-kept list. Drop a dim's row and the reversal still succeeds,
 * the assertion still compiles, and `DIM_TO_CELL_KEY[dim]` hands a call site
 * `undefined` behind a type that says `string`.
 *
 * So the dim-keyed map is now the declared one: its `Record<GlyphDimension,
 * string>` annotation is a real compile-time totality gate — add a ninth
 * dimension to `GLYPH_DIMENSIONS` and this file stops compiling until the
 * dimension has a cell key. `CELL_KEY_TO_DIM` is derived from it, so the two
 * directions cannot drift.
 */
export const DIM_TO_CELL_KEY: Record<GlyphDimension, string> = {
  trigger: "triggers",
  task: "use-cases",
  connector: "connectors",
  message: "messages",
  review: "human-review",
  memory: "memory",
  event: "events",
  error: "error-handling",
};

/**
 * Cell keys that are NOT the canonical key for their dimension but must still
 * resolve to it on the forward lookup. `sample-output` shares the `task`
 * petal with `use-cases`; only `use-cases` comes back on the reverse.
 *
 * This is the collision the old `Object.fromEntries` reversal handled by
 * relying on last-key-wins ordering. Making it an explicit alias table means
 * the behaviour survives someone re-ordering the literal.
 */
const CELL_KEY_ALIASES: Record<string, GlyphDimension> = {
  "sample-output": "task",
};

export const CELL_KEY_TO_DIM: Record<string, GlyphDimension> = {
  ...CELL_KEY_ALIASES,
  ...Object.fromEntries(
    GLYPH_DIMENSIONS.map((dim) => [DIM_TO_CELL_KEY[dim], dim]),
  ),
};
