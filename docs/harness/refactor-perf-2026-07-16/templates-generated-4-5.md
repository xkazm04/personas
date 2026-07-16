# templates/generated [4/5] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 4 medium / 2 low)
> Context group: Templates & Recipes | Files read: 34 | Missing: 0

## 1. Monthly-cron "0 H D * *" parse/format logic duplicated across two adoption bridges
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/templates/sub_generated/adoption/persona-layout/composerScheduleToTriggerSelection.ts:51
- **Scenario**: `composerScheduleToTriggerSelection` formats the monthly escape-hatch cron (`\`0 ${hourOfDay} ${day} * *\``, line 51) and `triggerSelectionToComposerSchedule` best-effort parses it back (lines 82–90). `adoptionDimHelpers.ts` `scheduleLabelFromSelection` (lines 47–58) contains a second, independently written copy of the exact same best-effort parse (`split(/\s+/)`, `Number(parts[1])`, `Number(parts[2])`, NaN guards).
- **Root cause**: The monthly cadence rides `customCron` with no shared codec; each consumer re-implements the tiny grammar inline.
- **Impact**: If the monthly cron shape ever changes (e.g. minute support, `L` for last day), one site will drift and either the schedule modal reseed or the left-panel summary label will silently disagree with the actual trigger.
- **Fix sketch**: Add `formatMonthlyCron(hour, day)` / `parseMonthlyCron(cron): {hour, day} | null` next to `TriggerSelection` (e.g. in `useCasePickerShared` or a small `monthlyCron.ts`), and use them in all three places: the format at composerScheduleToTriggerSelection.ts:51, the parse at lines 82–90, and the parse in adoptionDimHelpers.ts:49–57.

## 2. adoptionReadiness re-parses design_result raw instead of reusing the cached parse, and carries an unused parameter
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/templates/sub_generated/shared/adoptionReadiness.ts:20
- **Scenario**: `getRequiredConnectorCategories` does a bare `JSON.parse(review.design_result)` in try/catch — the same payload `reviewParseCache.getCachedDesignResult` already parses and caches per review, and the same file already imports `parseJsonSafe` for the fallback path. `computeAdoptionReadiness` also declares `_installedConnectorNames` which is never used but forces every caller (reviewParseCache.ts:65–80, useTemplateCardData.ts:72) to thread the set through.
- **Root cause**: The readiness computation was written against the raw row instead of the existing cached-parse seam; the installed-connectors set survived an earlier per-connector design that moved to category-level checks.
- **Impact**: `design_result` is the heaviest JSON blob on a review; parsing it twice (once for the card's design, once for readiness) wastes work per gallery card and duplicates the parse-error policy. The dead parameter widens the API of three call sites for nothing.
- **Fix sketch**: Have `computeAdoptionReadiness` accept the already-parsed `AgentIR | null` (callers get it from `getCachedDesignResult`) or at minimum use `parseJsonSafe` for consistency; drop `_installedConnectorNames` from the signature and from `getCachedReadinessScore`'s `compute` contract.

## 3. normalizeTag is an identity no-op kept alive in the tag-derivation hot loop
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/templates/sub_generated/gallery/shared/deriveTemplateCategoryTags.ts:40
- **Scenario**: `normalizeTag(tag) { return tag; }` — its own comment says "Catalog is fully snake_case; no alias translation needed." Every pill push routes through it anyway.
- **Root cause**: Leftover seam from a de-branding/alias pass that ended up needing no translation table.
- **Impact**: Pure noise: a reader hunting for where tags get normalized finds a function that does nothing; the indirection also splits `key` vs `rawKey` in `push` for no observable difference.
- **Fix sketch**: Delete `normalizeTag`, use `rawKey` directly in `push`, and fold the "fully snake_case" note into the file header comment if worth keeping.

## 4. RecommendedCarousel JSON-parses connectors_used per template on every render, bypassing the existing WeakMap cache
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/templates/sub_generated/gallery/explore/RecommendedCarousel.tsx:33
- **Scenario**: Inside the `.map`, `parseJsonSafe(tmpl.connectors_used, [])` runs for every recommended template on every render of the explore shelf — which re-renders whenever the parent gallery re-renders (search keystrokes, filter toggles, modal open/close), not just when recommendations change.
- **Root cause**: The component predates (or ignores) `reviewParseCache.getCachedLightFields`, which exists precisely to parse `connectors_used` once per review object and is what sibling `CompactRow` and `buildComparison` use.
- **Impact**: Repeated JSON.parse of the same strings on a hot re-render path; also a consistency hazard — the carousel's parse-failure behavior can drift from what the cards show for the same review.
- **Fix sketch**: Replace the inline parse with `const { connectors } = getCachedLightFields(tmpl);` from `../cards/reviewParseCache`. One-line change, drops the `parseJsonOrDefault` import.

## 5. Per-row category derivation (deriveTemplateCategoryTags + deriveArchCategories) recomputed on every gallery re-render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/templates/sub_generated/gallery/cards/CompactRow.tsx:28
- **Scenario**: `CompactRow` computes `deriveArchCategories(connectors)` and its child `TemplateCategoryPills` computes `deriveTemplateCategoryTags(connectors)` (TemplateCategoryPills.tsx:27) in the render body. Both walk the connector list, hit the builtin-connector catalog, and build sets/arrays. The list is virtualized (TemplateVirtualList), but every visible row re-runs both derivations on each search keystroke, filter change, and scroll-driven re-render.
- **Root cause**: The derivations are pure functions of the review's connectors, yet nothing memoizes them per review — while the file right next door (`reviewParseCache.ts`) already established the WeakMap-per-review caching pattern for exactly this class of data.
- **Impact**: Bounded but repeated waste on the gallery's hottest render path (typing in search re-renders all visible rows); results are deterministic per review so it's 100% redundant work after the first paint.
- **Fix sketch**: Extend `CachedReviewFields` with lazily computed `archCategories` and `categoryPills` (or add `getCachedCategoryTags(review)` beside `getCachedLightFields`), and have `CompactRow` pass the precomputed pills into `TemplateCategoryPills` (accept `tags` as an optional prop, falling back to derivation for non-review callers).

## 6. PersonaChronologyGlyph callbacks depend on the whole props object, defeating downstream memoization during build streaming
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/templates/sub_generated/adoption/glyph/PersonaChronologyGlyph.tsx:51
- **Scenario**: `handleRefineDimension` uses `[props, rows]` and `wrappedOnStartTest` uses `[props]` as useCallback deps. `props` is a fresh object every parent render, so both callbacks — and the spread `hubProps` object — get new identities on each render. During an active build, phase/status props change frequently, so `GlyphGrid` receives a new `onRefineDimension` and `ChronologyCommandHub` new props each tick even when the relevant inputs didn't change.
- **Root cause**: Depending on the props object instead of the specific fields used (`props.onRefine`, `props.onStartTest`).
- **Impact**: Any `memo` on `GlyphGrid`/`ChronologyCommandHub` or their children is nullified while a build streams updates — the noisiest render window this view has. Cost is bounded to this subtree, hence Low.
- **Fix sketch**: Destructure `const { onRefine, onStartTest } = props;` and use `[onRefine, rows]` / `[onStartTest]` as deps; memoize `hubProps` with useMemo keyed on `props` fields actually consumed, or pass `startTestLabelOverride`/`onStartTest` as separate props to avoid the spread-object churn.
