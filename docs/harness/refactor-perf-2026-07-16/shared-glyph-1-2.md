# shared/glyph [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 3 medium / 3 low)
> Context group: Shared UI & Design System | Files read: 34 | Missing: 0

## 1. GlyphOrbitProgress can never reach "off" — its own effect cleanup cancels the completion timer

- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/shared/glyph/persona-sigil/GlyphOrbitProgress.tsx:52
- **Scenario**: A build finishes (`active` flips false while `mode === "loading"`). The effect sets `mode = "completing"` and schedules the 600ms timer that should land on `"off"`. But `mode` is in the effect's dependency array, so the state change immediately re-runs the effect; the cleanup runs first and calls `window.clearTimeout(completionTimerRef.current)` — cancelling the timer milliseconds after it was set, long before its 600ms deadline.
- **Root cause**: The cleanup unconditionally clears the completion timer on every dependency change, and `setMode("completing")` itself is a dependency change. The re-run then matches neither branch (`active` is false, `mode !== "loading"`), so no replacement timer is ever scheduled.
- **Impact**: `mode` sticks at `"completing"` forever: the component never returns `null`, leaving an invisible (opacity-0) SVG + two framer-motion elements permanently mounted over every sigil that has completed a build. The documented "fade then unmount" contract silently doesn't happen; repeated builds recover only because `active === true` resets to `"loading"`.
- **Fix sketch**: Move the timeout out of the cross-cutting cleanup: schedule it inside the `!active && mode === "loading"` branch and clear it only in a dedicated effect keyed on unmount (`useEffect(() => () => clearTimeout(ref.current), [])`), or drop `mode` from the deps and derive transitions from `active` alone. Verify by logging `mode` — it should reach `"off"` ~600ms after `active` flips false.

## 2. Duplicate CELL_KEY_TO_DIM map in GlyphQuestionPanel bypasses the canonical single source of truth

- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/shared/glyph/GlyphQuestionPanel.tsx:13
- **Scenario**: `persona-sigil/cellDimMap.ts` was explicitly created (glyph-convergence P4) as "the single source of truth" for the build-engine cell-key → dimension contract, and its doc comment says other copies were re-pointed at it. `GlyphQuestionPanel.tsx` still carries its own private `CELL_KEY_TO_DIM` literal — and it already diverges: the canonical map has a `"sample-output" → task` entry the local copy lacks.
- **Root cause**: The dedup pass that consolidated the from-scratch and adoption copies missed this third copy inside the same feature directory.
- **Impact**: A question with `cellKey === "sample-output"` (or any future cell key added only to the canonical map) gets no dim match here, so the question card falls back to the generic blue tint instead of the dimension colour. Any future contract change must now be made twice or the surfaces drift.
- **Fix sketch**: Delete the local map and `import { CELL_KEY_TO_DIM } from './persona-sigil/cellDimMap'` (the module is already in this feature's tree; check for import-cycle via the `persona-sigil` barrel and import the file directly if needed).

## 3. GlyphPetalIcons is unmemoized — every hover flip re-reconciles all 8 aura SVG trees on the hero sigil

- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/shared/glyph/persona-sigil/GlyphPetalIcons.tsx:23
- **Scenario**: Moving the mouse across the hero sigil (PersonaHero, up to 880px, a primary surface in view/adoption/scratch modes) fires `onHoverDim` per petal enter/leave. Each state change re-renders GlyphSigilCanvas; GlyphHeroSigil's petals are memoized (`HeroPetal = memo(...)`) precisely to avoid this, but GlyphPetalIcons is not — all 8 petal stacks re-render, each containing an AnimatePresence, a glow span, and a CustomArt aura (DimAuras components that rebuild their decoration trees, e.g. TriggerAura's 12-tick loop, ~20-40 SVG nodes each).
- **Root cause**: The memoization effort stopped at the petal-path layer; the icon/aura overlay — the heavier of the two layers — re-renders wholesale because hover state is threaded through an unmemoized component whose per-dim work isn't split.
- **Impact**: ~200-300 SVG/DOM node reconciliations per hover transition on a hot interaction path; visible as wasted main-thread time when sweeping the cursor across petals, multiplied when the build sweep (`sweepDim` ticking every 5s) also re-renders the full set.
- **Fix sketch**: Extract the per-dim body of the `GLYPH_DIMENSIONS.map` into a `memo`'d `PetalIcon` component taking `{ dim, state, isHovered, isActive, isSwept, dimOther, x, y }` primitives (mirror the HeroPetal pattern). Optionally also `memo` the DimAuras components — their output depends only on `size`/`iconOpacity`.

## 4. EmptyCapabilitySigil renders a fully invisible dead block (opacity-0 wedges + empty groups) and duplicates the wedge-path formula

- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/shared/glyph/CapabilitySigil.tsx:261
- **Scenario**: The first `GLYPH_DIMENSIONS.map` block in `EmptyCapabilitySigil` renders, per dimension, a `<g opacity={0}>` containing a `fill="none"` path and an empty nested `<g transform>` — 24 SVG elements that can never be visible. The `wedgePath` computed at lines 242-248 is used only by these invisible paths, and it is a byte-for-byte duplicate of the wedge formula in `CapabilitySigil` (lines 77-89).
- **Root cause**: Leftover scaffolding from when the empty tile mirrored the wedge variant; the visible dots were added as a second map and the first was blanked instead of removed.
- **Impact**: Dead render work per empty grid slot and a duplicated geometry formula that must be edited in two places if the wedge shape is ever retuned.
- **Fix sketch**: Delete the first map block and the `wedgePath`/`innerHalfW`/`midR`/`midHalfW`/`tipHalfW` locals from `EmptyCapabilitySigil`. If the wedge is ever needed there again, extract a shared `buildWedgePath(size)` helper next to the geometry constants and use it from both components.

## 5. GlyphHeroSigil accepts a `hoveredDim` prop it never uses

- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/shared/glyph/persona-sigil/GlyphHeroSigil.tsx:10
- **Scenario**: `GlyphHeroSigilProps` declares `hoveredDim: GlyphDimension | null` and GlyphSigilCanvas dutifully passes it, but the component's destructuring omits it and no petal receives hover state (hover visuals live entirely in GlyphPetalIcons).
- **Root cause**: Hover rendering migrated to the icon overlay layer; the prop contract was never trimmed.
- **Impact**: Misleading API — a reader (or memoization effort) assumes the petal layer reacts to hover. Verified within this context: the only caller is GlyphSigilCanvas.tsx:39.
- **Fix sketch**: Remove `hoveredDim` from `GlyphHeroSigilProps` and from the GlyphSigilCanvas call site. If the petal layer should ever show hover, wire it through HeroPetal instead (it is already memoized to take per-petal booleans).

## 6. CapabilitySigil recomputes geometry and re-renders all 8 petals on every per-petal hover, per instance in lists

- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/shared/glyph/CapabilitySigil.tsx:56
- **Scenario**: Each CapabilitySigil holds local `hoveredDim` state; entering/leaving any petal re-renders the whole SVG, rebuilding the `wedgePath` template string, the `new Set(uc.dimensions)`, and all 8 petal elements. The component is instantiated once per row in UseCaseRow lists and once per tab in CapabilityTabBar, and UseCaseRow additionally re-renders it (with `isHovered` flips) on whole-row hover.
- **Root cause**: Per-render recomputation of size-only-dependent geometry plus undifferentiated petal rendering; contrast with InteractiveSigil, which caches geometry by `size` at module scope for exactly this reason (see its header comment).
- **Impact**: Bounded — ~8 small SVG nodes per hover per tile — but it is the same pattern the codebase already fixed once, and it multiplies across every capability row/tab on screen.
- **Fix sketch**: Hoist `wedgePath` (and the radius constants) into a module-level cache keyed by `size` like InteractiveSigil's `getGeometry`, and compute `present` with `useMemo` on `uc.dimensions`. Full per-petal memoization is optional; the geometry hoist alone removes the string-building from the hot path.
