# shared/glyph [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 2 findings (0 critical / 0 high / 1 medium / 1 low)
> Context group: Shared UI & Design System | Files read: 4 | Missing: 0

## 1. `DIM_LABEL` map duplicated verbatim in sub_glyph, bypassing the localization path
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/shared/glyph/persona-sigil/dimLabel.ts:12 (canonical) vs src/features/agents/sub_glyph/glyphLayoutHelpers.ts:10
- **Scenario**: `dimLabel.ts` documents itself as "the English fallback source" behind `useGlyphDimText()`, yet `glyphLayoutHelpers.ts:10-19` carries a byte-identical copy of the same 8-entry map, consumed by `GlyphAnswerCard.tsx:78`. If a dimension caption is ever reworded (e.g. `trigger: 'When'` → `'Schedule'`), only one copy gets updated and the build-question card silently drifts from petal captions / sigil-edit modal / orbit labels.
- **Root cause**: The "Glyph-convergence P4" consolidation in glyphLayoutHelpers.ts deduplicated `CELL_KEY_TO_DIM`/`DIM_TO_CELL_KEY` into `persona-sigil/cellDimMap.ts` but left `DIM_LABEL` behind as a second English source. The copy also renders raw English instead of routing through `t.agents.glyph_dim_label`, so GlyphAnswerCard never localizes while every other glyph surface does.
- **Impact**: Two sources of truth for user-facing copy plus a localization hole on the build-question card — a maintenance hazard exactly of the kind the dimLabel.ts docblock exists to prevent.
- **Fix sketch**: Delete the local map in glyphLayoutHelpers.ts and re-export the canonical one (`export { DIM_LABEL } from '@/features/shared/glyph/persona-sigil'`), mirroring how `CELL_KEY_TO_DIM` was converged, so existing importers keep working. Better still, have `GlyphAnswerCard` (a React component) call `useGlyphDimText()` for the label so it localizes like `AdoptionAnswerCard.tsx:146`'s siblings; keep `DIM_LABEL` only as the hook's fallback.

## 2. `DIM_META` encodes each dimension color twice (hex + Tailwind class)
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/shared/glyph/dimMeta.ts:12
- **Scenario**: Every entry pairs a raw hex (`color: '#fbbf24'`) with a hand-matched Tailwind class (`colorClass: 'text-amber-400'`). Changing a dimension's hue requires editing two encodings that nothing verifies stay in sync; a mismatch shows as SVG strokes in one color and icon/text tint in another.
- **Root cause**: SVG art needs a literal color while icon/text consumers were written against Tailwind utility classes, so the same value was captured in both notations instead of deriving one from the other.
- **Impact**: Bounded drift hazard across 8 entries; purely a maintenance/consistency cost, no runtime effect.
- **Fix sketch**: Keep `color` as the single source and drop `colorClass`, having the few `colorClass` consumers apply `style={{ color: meta.color }}` instead (Tailwind cannot be derived from hex at runtime, so hex must be the canonical form). Do it opportunistically — it touches consumers outside this context, so verify call sites first.

*(perf-optimizer lens: no findings — these files are static constant maps and a single O(1) pure helper `stackOffset`; nothing allocates, re-renders, queries, or leaks.)*
