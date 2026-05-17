# Perf-Optimizer Scan — Templates Catalog & n8n Adoption

> Project: Personas (frontend-only)
> Scope: 7 paths in src/ (`features/templates/components`, `i18n`, `sub_diagrams`, `sub_generated`, `sub_n8n`, `sub_recipes`, `api/templates`)
> Total: 10 findings (C: 2 / H: 5 / M: 2 / L: 1)

## Scope notes

- The `features/templates/i18n` path does **not** exist in the tree — i18n strings live under `src/i18n/en` and are pulled via `useTranslation()` instead. No findings against that subpath.
- Existing perf scaffolding is decent: there's a `reviewParseCache` WeakMap, `TemplateVirtualList` uses `@tanstack/react-virtual`, and `WorkflowThumbnail` uses `IntersectionObserver` lazy-render. The bugs below are leaks past those guards rather than missing infrastructure.
- 224 source files in scope.

---

## 1. `computeAdoptionReadiness` re-parses `design_result` for every template on every credential change

- **Severity**: critical
- **Category**: algorithmic
- **File**: `src/features/templates/sub_generated/shared/adoptionReadiness.ts:20` (call site: `src/features/templates/sub_generated/gallery/cards/useGalleryActions.ts:45-51`)
- **Scenario**: User opens Templates → catalog mounts. The gallery hook builds a `readinessScores` `Map` by iterating **every loaded item** and calling `computeAdoptionReadiness(...)`, which `JSON.parse`s `review.design_result` (a fat IR blob — full structured prompt, suggested_connectors, capabilities, etc.) inside `getRequiredConnectorCategories`. This deps on `installedConnectorNames` + `credentialServiceTypes`, so adding/removing a single credential re-parses every review's design_result from scratch.
- **Root cause**: `adoptionReadiness.ts:20` uses raw `JSON.parse(review.design_result)` instead of the existing `getCachedDesignResult(review)` WeakMap (`reviewParseCache.ts:34`). The cache was built to avoid exactly this work, but the readiness path bypasses it.
- **Impact**: With 50 loaded reviews (default page size, line 57 of `GeneratedReviewsTab.tsx`), each credential save triggers 50 JSON.parses of multi-KB blobs. `coverageCounts` (line 53) depends on `readinessScores` too, propagating the cost. Same gotcha in `extractSignals` (`templateComplexity.ts:53-57`) which parses `design_result` + 3 other JSON fields per call — and `useTemplateCardData` calls `computeDifficulty`/`computeSetupLevel`/`estimateSetupMinutes` (lines 89/91/93) which means **4 parses per card per render** for the comfortable list.
- **Fix sketch**: Route `getRequiredConnectorCategories` through `getCachedDesignResult(review)` and pass the parsed `designResult` into `computeDifficulty` etc. Promote a memoized `signals` getter on the cache (extend `reviewParseCache` with a `signals?: ComplexitySignals` field). One-line change to `adoptionReadiness.ts`, ~20 LOC to `templateComplexity.ts`.

---

## 2. `ChronologyAdoptionView` re-parses `review.design_result` on every render

- **Severity**: critical
- **Category**: data-layer
- **File**: `src/features/templates/sub_generated/adoption/ChronologyAdoptionView.tsx:458-465`
- **Scenario**: User clicks "Adopt" → modal opens. This component is the entire questionnaire/UC picker/glyph flow — it re-renders on every keystroke in any answer, every UC toggle, every credential change. Each render hits an inline IIFE that runs `JSON.parse(review.design_result)`.
- **Root cause**: `designResult` is computed by a non-memoized inline arrow at line 458 (`const designResult = (() => { try { return JSON.parse(review.design_result)... })()`). The component then derives ~20 useMemos from `designResult`, but those memos can never hit cache because `designResult` is a new object reference every render. Same pattern at line 467-472 for `templateGoal`.
- **Impact**: Design results for v3 templates can be ~20-40 KB JSON. Re-parsing on every UC pick, every questionnaire keystroke, every credential answer — easily 50+ re-parses per adoption flow. All `useMemo`s downstream are effectively dead.
- **Fix sketch**: Wrap in `useMemo(() => parseJsonSafe<Record<string, unknown>>(review.design_result, null), [review.design_result])` (or, better, use the existing `getCachedDesignResult(review)` cache which is already populated when the user opens the row from the gallery). Same fix for `templateGoal`. ~5 LOC.

---

## 3. `RecipesPage` always fires `fetchRecipes()` on mount even when 291-entry catalog is already loaded

- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/features/templates/sub_recipes/RecipesPage.tsx:38-40`
- **Scenario**: User navigates Templates → Recipes tab. Recipes were already seeded at boot (`recipeSlice` from `pipelineStore`). `useEffect(() => { fetchRecipes()...}, [fetchRecipes])` fires unconditionally on every mount.
- **Root cause**: No staleness/empty check. `fetchRecipes` (`recipeSlice.ts:40`) hits `list_recipes` (full payload, ~291 rows × prompt_template JSON) and overwrites `state.recipes`. The replaced array breaks `recipeDefinitionsToRecipes` memo identity (`RecipesPage.tsx:44`), forcing the adapter to re-parse all 291 `prompt_template` blobs.
- **Impact**: Every time the user toggles between Recipes/Generated/n8n tabs, ~300 prompt_template JSON parses run on the main thread. Also a redundant IPC round-trip.
- **Fix sketch**: Guard with `if (definitions.length === 0) fetchRecipes()...`. Or move the fetch into `pipelineStore` lifecycle (it's already seeded on boot). 2-line change.

---

## 4. `useGalleryActions.readinessScores` not keyed on `getCachedDesignResult` cache, re-runs on every filter toggle

- **Severity**: high
- **Category**: re-render
- **File**: `src/features/templates/sub_generated/gallery/cards/useGalleryActions.ts:45-77`
- **Scenario**: User opens density toggle / coverage filter / component filter. The hook's `availableComponents` memo (line 65) calls `getCachedLightFields` + `deriveArchCategories` for every item; `readinessScores` (line 45) calls `computeAdoptionReadiness` for every item; `displayItems` (line 88) iterates again applying filters AND for component filtering calls `deriveArchCategories(connectors)` a **second time per item**.
- **Root cause**: Three nested `useMemo`s walk `allItems` independently. `displayItems` (line 88-127) recomputes `deriveArchCategories(connectors)` inside the filter predicate (line 106) — it already computed this in `availableComponents`. Same loop, different consumer.
- **Impact**: With ~150 templates loaded after a few `fetchMore` cycles, each filter chip click runs 3 full passes over the array. The compact density list rebinds `gallery.setSortBy('name')` (line 65) which dirties many upstream memos too.
- **Fix sketch**: Build a single `enrichedItems` memo with `{ review, connectors, categories, archCategoryKeys: Set<string>, readinessScore }` once per `allItems` change. Subsequent filter memos consume from `enrichedItems` without re-deriving. ~30 LOC refactor.

---

## 5. `useConnectorStatuses` ping-pongs `setStatuses` on every credential mutation

- **Severity**: high
- **Category**: re-render
- **File**: `src/features/templates/sub_n8n/edit/useConnectorStatuses.ts:140-171`
- **Scenario**: User on the n8n Edit step adds/links a credential. Adding a credential mutates `vaultStore.credentials` (subscribed at line 66), which dirties `credentialsByIdMap`, `credentialsByServiceType`, `matchedCredByConnector`, etc. The `useEffect` at line 140 detects new dependencies and calls `setStatuses(...)` — building a fresh array of `ConnectorStatus` objects every time, **even when no field actually changed**.
- **Root cause**: The mapping creates a new `{ name, n8nType, credentialId, credentialName, hasConnectorDef, testing, result }` object for every connector on every dependency change. `setStatuses` doesn't bail-out on equality; React commits the state update; the auto-test `useEffect` (line 198) then fires, triggering more state updates.
- **Impact**: Each credential save in a wizard with ≥5 connectors causes ~3-5 status re-build cycles. Auto-test loop (line 198) further fires healthcheck IPC calls because `lastAutoCredential !== credentialId` comparisons may flap if `credentialId` is recomputed from a different source.
- **Fix sketch**: Diff the new array against `prev` inside `setStatuses` and return `prev` when shallow-equal. Or move statuses to derived state via `useMemo` and keep only `testing`/`result` in a separate `Map<connectorName, {testing, result}>` state (those are the only fields that actually mutate post-link).

---

## 6. `FlowDiagram` and `FlowNodeCard` lack `React.memo`; full BFS layout re-runs on hover/click

- **Severity**: high
- **Category**: re-render
- **File**: `src/features/templates/sub_diagrams/FlowDiagram.tsx:9-147`, `src/features/templates/sub_diagrams/FlowNodeCard.tsx:8-34`
- **Scenario**: User opens ActivityDiagramModal, clicks a node to see the popover. `ActivityDiagramModal` setState (`inspectedNode`, `popoverPos`) re-renders the modal; `FlowDiagram` is a child and re-runs without memo. The internal `adjacency`/`layers`/`nodeMap`/`interLayerLabels` useMemos are keyed on `flow.edges` / `flow.nodes` (stable references), so they skip — but the body still renders ~N FlowNodeCards, each of which calls into `NODE_TYPE_META` lookup and re-creates `truncatedLabel`.
- **Root cause**: `export default function FlowDiagram(...)` — no `memo` wrapper. `FlowNodeCard` likewise. With ≥50-node flows (real-world n8n imports), every popover toggle = 50 button DOM reconciliations.
- **Impact**: Visible jank on diagram modal node click for ≥30-node flows; popover positioning feels sticky.
- **Fix sketch**: Wrap both in `memo(...)`. `FlowNodeCard` already has stable props (`node`, `onClick`), and `onClick` from parent should be stabilized with `useCallback` in `ActivityDiagramModal:88-105` (currently defined inline).

---

## 7. `TemplateDetailModal` re-parses `use_case_flows` + `suggested_adjustment` on every render

- **Severity**: high
- **Category**: data-layer
- **File**: `src/features/templates/sub_generated/gallery/modals/TemplateDetailModal.tsx:110-115`
- **Scenario**: User opens the template detail modal, switches between Overview / Prompt / Connectors tabs. Tab switch is a setState in the parent → modal body re-renders → lines 110/111 fire `parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, [])` and `parseJsonSafe(review.suggested_adjustment, null)` outside any memo.
- **Root cause**: Inline parsing right above the `BaseModal` return. `designResult` correctly uses the cache (line 109), but the two sibling fields don't.
- **Impact**: Real flows arrays for non-trivial templates are 4-8 KB JSON. Each tab click re-parses. Compounds with the difficulty/setup memos (lines 103, 105) which themselves re-parse via `computeDifficulty`/`estimateSetupMinutes` — see Finding #1.
- **Fix sketch**: Wrap in `useMemo`s keyed on the raw strings, or extend `reviewParseCache` to carry `useCaseFlows` and `adjustment`. 4 LOC.

---

## 8. `ExpandedRowContent` stringify→parse roundtrip on `use_case_flows` fallback

- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/templates/sub_generated/gallery/cards/ExpandedRowContent.tsx:41-48` (also in `useTemplateCardData.ts:41-46`)
- **Scenario**: When `review.use_case_flows` is empty but the design result carries `use_case_flows`, the code does `parseJsonSafe<UseCaseFlow[]>(JSON.stringify(raw.use_case_flows), [])` — stringify the parsed object only to re-parse it.
- **Root cause**: Defensive coercion, probably from when the cache returned a string. `getCachedDesignResult` returns a typed `AgentIR`; `raw.use_case_flows` is already an array.
- **Impact**: Each comfortable-row expansion runs an extra serialize/deserialize round of the flows blob (can be 5-15 KB). Small but unnecessary and runs on every row open.
- **Fix sketch**: `return (raw?.use_case_flows as UseCaseFlow[] | undefined) ?? []` — cast and return. 1-line fix per call site.

---

## 9. `n8nWizardTransformHandlers.handleTransform` JSON.stringifies vault state synchronously on click

- **Severity**: medium
- **Category**: async-coordination
- **File**: `src/features/templates/sub_n8n/hooks/useN8nWizardTransformHandlers.ts:38-46`
- **Scenario**: User clicks "Generate" in the n8n wizard. The handler synchronously builds 4 stringified payloads inside the click handler: `parserJson = JSON.stringify(state.parsedResult)` (entire AgentIR), plus `connectorsJson`, `credentialsJson`, `userAnswersJson`. All four serialize on the main thread before the IPC `invoke` is issued.
- **Root cause**: Hot path on transform start, all sequential. For a 25-node n8n workflow with ~50 vault credentials, this is ~50-150 KB of JSON serialization on a UI-blocking thread before the spinner can appear.
- **Impact**: 100-300 ms "Generate" button click latency before any animation/feedback. The optimistic `dispatch({ type: 'TRANSFORM_STARTED' })` on line 30 happens before the stringify, but `await transform.startTransformStream(transformId)` (line 29) is also synchronous-ish, so the UI does eventually update — but the user perceives a hang.
- **Fix sketch**: Move stringification after `dispatch({ type: 'TRANSFORM_STARTED' })` so React paints the spinner first, then `requestIdleCallback(() => stringify+invoke)`. Or break the four stringifies up and yield with `await Promise.resolve()` between them.

---

## 10. `StreamingSections` recomputes counts on every section push

- **Severity**: low
- **Category**: re-render
- **File**: `src/features/templates/sub_n8n/widgets/StreamingSections.tsx:144-157`
- **Scenario**: During n8n transform streaming, the backend pushes ~6-10 sections (identity/prompt/tools/triggers/connectors/design_context). Each push appends to `streamingSections` array → `StreamingSections` re-renders → `useMemo` (line 144) loops the array to count valid/warning/error.
- **Root cause**: O(N) loop per push. N is tiny (≤10), so this is sub-millisecond — but the *real* issue is the surrounding `SectionRow` (line 83) has a custom equality check that uses array length comparison (`errors.length === errors.length`) which is a false-equal trap if the backend mutates errors in place vs replacing the array. The `memo` may silently miss updates for cases where validation messages change but length stays the same.
- **Impact**: Cosmetic — minor wasted re-renders. The bigger latent risk is the `prev.section !== next.section` guard at line 122 followed by content checks that can mis-match.
- **Fix sketch**: Accumulate counts on a reducer side-by-side with the array, or change `SectionRow` memo equality to deep-compare the validation object contents (or reference the entire validation object: `prev.section.validation === next.section.validation` if the backend builds a fresh validation object per push).
