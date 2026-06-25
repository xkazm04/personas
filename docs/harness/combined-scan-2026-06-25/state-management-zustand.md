# State Management (Zustand) — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: state-management-zustand | Group: Platform Foundation
> Total: 5 | Critical: 0 | High: 1 | Medium: 3 | Low: 1

> Note on scope: the listed `personaStore.ts` / `slices/.../index.ts` paths do not exist. The "global store" is physically five `create()` stores (`agentStore`, `overviewStore`, `pipelineStore`, `vaultStore`, `systemStore`) composed from per-domain slices, plus `selectors/`. Findings cover the real files.

## 1. Dead icon-assign guard (`v1` key never written) re-runs a full `listPersonas()` re-fetch on every `fetchPersonas`
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / redundant-IPC / dead-guard
- **File**: src/stores/slices/agents/personaSlice.ts:138 (guard) vs src/lib/icons/autoAssignIcons.ts:15
- **Scenario**: App calls `fetchPersonas()` (mount, refresh, `network:personas-changed`, etc.). The guard reads `localStorage.getItem('personas-icon-auto-assigned-v1')`. Nothing in the codebase ever writes the `v1` key — `autoAssignPersonaIcons` only reads/writes `ASSIGNMENT_KEY = 'personas-icon-auto-assigned-v2'` (autoAssignIcons.ts:15,57,76,102). So `needsAssignment` is `true` forever. Every `fetchPersonas` therefore enters the block and runs `autoAssignPersonaIcons(personas).then(async () => { const updated = await listPersonas(); set({ personas: updated, selectedPersona: … }) })`.
- **Root cause**: Version-key mismatch between the call-site guard (`v1`) and the implementation's own idempotence key (`v2`). The inner heavy DB writes are still protected by the `v2` check, but the *outer* guard — whose whole job is to avoid even calling the routine and the trailing re-fetch — is permanently bypassed.
- **Impact**: Every persona load fires a second redundant `listPersonas()` IPC round-trip and a second `set({ personas })` that replaces the array with a fresh reference, re-rendering every persona subscriber a second time. This is exactly the IPC stampede the `requestIdleCallback` deferral above it was added to prevent. Permanent, not one-time.
- **Fix sketch**: Change the guard to `'personas-icon-auto-assigned-v2'` (single source of truth), or better, have `autoAssignPersonaIcons` return a boolean `{ didAssign }` and only run the trailing `listPersonas()` re-fetch when it actually mutated icons. Delete the redundant localStorage read at the call site entirely since the routine self-guards.
- **Value**: impact=5 effort=1

## 2. Design-context selectors claim `Object.is` ref-stability, but the underlying `parseDesignContext` LRU(1) is a shared global that other persona components evict every render
- **Severity**: High
- **Lens**: bug-hunter + ambiguity-guardian
- **Category**: re-render-storm / perf-cliff / false-invariant
- **File**: src/stores/selectors/personaSelectors.ts:21-33 (root cache at src/features/agents/sub_lab/use-cases/UseCasesList.tsx:36-43)
- **Scenario**: `useParsedDesignContext` / `useSelectedUseCases` / `useSelectedCredentialLinks` are zustand selectors `(s) => parseDesignContext(s.selectedPersona?.design_context)…`. Their doc-comment (personaSelectors.ts:6-11) asserts "the same `design_context` string always returns the exact same object" — but `parseDesignContext` caches exactly ONE entry (`_cachedRaw`/`_cachedResult`). Components like `PersonaConfigPanel.tsx:77`, `AddPersonaModal.tsx:86/103`, `ExpandedDrawer.tsx:78`, and `useAutomationSetup.ts:94` call `parseDesignContext` with a *different* persona's string. Each such call overwrites the single cache slot.
- **Root cause**: A module-global LRU(1) cannot provide reference stability for N concurrent distinct inputs. As soon as any sibling parses a different persona, the next evaluation of the selector hook re-parses and returns a brand-new object → `Object.is(prev,next)` fails → the subscribing component re-renders even though `design_context` did not change.
- **Impact**: The `agentStore` is high-churn (executions, chat streaming, telemetry ticks all `set()` into it). With a multi-persona view co-mounted alongside the Design panel, the Design panel's selectors return fresh refs on the contended ticks, re-rendering the panel and its subtree during streaming — a real perf cliff. The asserted invariant is also a tribal-knowledge trap: future code "trusts" the comment and skips its own memoization.
- **Fix sketch**: Either (a) bump the cache to a small `Map`-based LRU keyed by raw string (size ≥ number of personas typically parsed), or (b) make the selectors stable independent of the cache — `useMemo` over the raw string in the consuming hook, or store a derived `parsedDesignContext` on `selectedPersona` when it is built in `deriveSelectedPersona`. Update/remove the over-strong doc guarantee.
- **Value**: impact=6 effort=2

## 3. `enabledPlugins` is a `Set` excluded from persist — user toggles silently reset each launch, and naïvely persisting it would JSON-serialize to `{}`
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: persistence-gap / latent-serialization-bug / inconsistency
- **File**: src/stores/slices/system/uiSlice.ts:458-471 ; src/stores/systemStore.ts:55-129 (partialize — `enabledPlugins` absent)
- **Scenario**: `togglePlugin` enables/disables plugin modules via a `Set<PluginTab>`. The sibling UI state `pluginTab` IS in the systemStore `partialize` whitelist, so plugin *navigation* survives restart — but `enabledPlugins` is not, so a user who disables a plugin (e.g. to declutter the Plugins grid) finds it re-enabled on the next launch.
- **Root cause**: Two coupled inconsistencies. (1) The enable/disable set is omitted from `partialize` while the related `pluginTab` is persisted — an undocumented, probably-unintended asymmetry. (2) The state is a `Set`. The same file/store deliberately stores `monitorCollapsedGroups`, `disabledStationIds`, and `homeHiddenSections` as `string[]` *because* (their own comments, uiSlice.ts:154-160) the persist middleware JSON-serializes and "a Set would be stringified to `{}`". So a future maintainer who "fixes" the persistence by adding `enabledPlugins` to `partialize` will rehydrate `{}` instead of a Set, and every `enabledPlugins.has(...)` / `new Set(state.enabledPlugins)` call will throw or silently mis-behave.
- **Impact**: Lost user setting today; a latent crash/blank-plugins regression the moment someone persists it the obvious way.
- **Fix sketch**: Decide the contract explicitly. If it should persist, convert to `string[]` (or a custom `storage` serializer like `disabledStationIds`) and add to `partialize`. If it is intentionally session-only, add a one-line comment matching the `keyboardNavActive` "deliberately NOT persisted" note so the asymmetry is documented.
- **Value**: impact=4 effort=3

## 4. `updateManualReview` re-fetches with no status argument, discarding whatever filter the list view had applied
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-inconsistency / dropped-parameter
- **File**: src/stores/slices/overview/overviewSlice.ts:287-295 (refetch at :291; signature at :260 `fetchManualReviews(status?)`)
- **Scenario**: The reviews list calls `fetchManualReviews(status)` to populate a filtered view (e.g. only `pending`). When the user resolves an item, `updateManualReview` runs `await get().fetchManualReviews()` with **no** status — `listManualReviews(undefined, undefined)` returns ALL statuses. The store's `manualReviews` (and `manualReviewsTotal`) are then replaced with the unfiltered set.
- **Root cause**: The active filter is a parameter passed per call, not stored, and the post-mutation refetch doesn't thread it through. The action has no memory of the current filter.
- **Impact**: After acting on one review under an active filter, the list silently repopulates with items that don't match the filter (and `manualReviewsTotal` jumps), so the UI shows the wrong set until the component re-applies its filter. Confusing, and the just-resolved item may reappear because the unfiltered fetch includes resolved rows.
- **Fix sketch**: Persist the last-applied filter in the slice (`manualReviewStatusFilter`) and have `updateManualReview` call `fetchManualReviews(get().manualReviewStatusFilter)`; or accept the active status as an argument to `updateManualReview` and forward it.
- **Value**: impact=4 effort=2

## 5. `systemStore` omits `error`/`isLoading` from its CoreState initializer, silently depending on `uiSlice` being the de-facto owner
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: slice-composition-coupling / init-order-assumption
- **File**: src/stores/systemStore.ts:32-34 (top-level init) ; only `uiSlice` initializes them: src/stores/slices/system/uiSlice.ts:332-333
- **Scenario**: Every other domain store (vaultStore.ts:13-17, agentStore.ts:25-28, pipelineStore.ts:13-16, overviewStore.ts:23-27) seeds all four `CoreState` fields (`error`, `errorKind`, `isLoading`, `sliceErrors`) at the top of its initializer. `systemStore` seeds only `errorKind` and `sliceErrors`; its `error: null` / `isLoading: false` come solely from the spread of `createUiSlice` (the only system slice that initializes them as state — every other system slice only writes `error` inside async actions).
- **Root cause**: Undocumented assumption that `uiSlice` owns the shared `CoreState.error`/`isLoading` for the whole composite SystemStore. `error`/`isLoading` look like generic per-store boilerplate that a refactor could reasonably remove from `UiSlice` (they duplicate `CoreState`), or reorder another slice ahead of it.
- **Impact**: Currently correct, but fragile: if `uiSlice` drops those two fields (or is reordered after a slice that reads `error` during init), `SystemStore.error` becomes `undefined` rather than `null`, violating the `CoreState.error: string \| null` contract — `error == null` guards still pass, but `error === null` checks and error banners that branch on `null` vs `undefined` break with no compiler signal (both satisfy the type).
- **Fix sketch**: Add `error: null, isLoading: false` to the `systemStore` top-level initializer to match the other four stores, making `CoreState` self-seeded and independent of slice composition order. Then `uiSlice`'s duplicate `error`/`isLoading` can be dropped.
- **Value**: impact=3 effort=2
