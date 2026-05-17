# Perf-Optimizer Scan — Connector Catalog, MCP Gateways & Recipes

> Project: Personas (frontend-only)
> Scope: 5 paths in src/
> Total: 7 findings (1 critical / 4 high / 2 medium / 0 low)

## Scope notes
- Scoped to `src/features/vault/sub_catalog/components` + 4 API files. The `picker/` subdirectory is the connector catalog grid that ships these perf-sensitive hot paths; the rest of `sub_catalog/` (autoCred, design, foraging, negotiator, schemas, forms) is largely modal/wizard UI and is mostly skipped except where it consumes the in-scope APIs (e.g. `RecipeConfidenceBanner`, `IdleSuggestions`).
- Light cross-file reads of `useCredentialViewFSM` (search filter), `credentialRecipeRegistry`, and `GatewayMembersModal` to trace API call sites — included as evidence for findings but not the focus of fixes.

## 1. Catalog filter pipeline rebuilds 5 filtered arrays per keystroke without debounce
- **Severity**: critical
- **Category**: re-render
- **File**: `src/features/vault/sub_catalog/components/picker/usePickerFilters.ts:81-105` (plus search source `src/features/vault/shared/hooks/useCredentialViewFSM.ts:362`)
- **Scenario**: User types in the catalog search box (Ctrl/Cmd+K) with ~200 connectors loaded. Each keystroke pushes a new `searchTerm` through `CredentialPicker` -> `useCredentialViewFSM` re-runs the search-`filter()` -> `connectors` prop identity changes -> `usePickerFilters` re-runs **six** memos (`purposeBase`, `categoryBase`, `connectedBase`, `licenseBase`, `filteredConnectors`, + `applyFilters` deps), each iterating the whole catalog 1–4× and calling `getLicenseTier`, `getPurposeForConnector`, `connectorMatchesAudience` per connector per pass.
- **Root cause**: No debounce on `credentialSearch`. `applyFilters` is a `useCallback` so any state change invalidates all four `*Base` memos which all depend on it. Per keystroke the worst-case work is O(N × passes) ≈ 200 × 5 passes × ~3 helper calls = ~3k function calls plus four allocations of N-sized arrays — all under input-blocking sync work since React typed input handlers commit synchronously.
- **Impact**: With ~200 connectors the filter pipeline runs on the keystroke critical path; perceived input lag and dropped frames on the search input. Scales linearly with catalog growth; built-in connector seeding pushes this number up over time.
- **Fix sketch**: (a) Debounce `credentialSearch` -> FSM dispatch by ~120ms (keep raw value in the input for snappy display). (b) Collapse `purposeBase/categoryBase/connectedBase/licenseBase` into a single pass that computes all four count maps simultaneously — currently each runs an independent `applyFilters` then a second loop. (c) Memoize a precomputed `connectorIndex` keyed by name with `{purpose, tier, audiences, lowercaseLabel, lowercaseName, lowercaseCategory}` outside the search loop to avoid recomputing `getLicenseTier`/`getPurposeForConnector` N× per keystroke.

## 2. `useRecipeIndicators` fetches every cached recipe on every mount, no shared store
- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/features/vault/sub_catalog/components/picker/useRecipeIndicators.ts:18-34`
- **Scenario**: Every mount of `CredentialPicker` fires `listCredentialRecipes()` (an unbounded IPC call returning the full recipe list). The picker is mounted on every catalog visit, on every FSM `CANCEL_FORM`/`GO_CATALOG` round-trip, and the data is also implicitly needed by `credentialRecipeRegistry.ts` which keeps its own per-connector `memoryCache` populated by `getCredentialRecipe`. Two independent caches over the same data; no invalidation contract between them.
- **Root cause**: No store-backed cache. `useState(new Map)` is local to the hook and discarded on unmount. `silentCatch` swallows the failure so a slow IPC keeps the picker showing zero recipe indicators until resolution.
- **Impact**: Extra IPC + JSON deserialization on every navigation back to the catalog. With a few dozen recipes the payload is small but the round-trip is synchronous w.r.t. the indicator badges (bottom-right of every card) — first paint shows no badges, then a layout shift when the response lands.
- **Fix sketch**: Move the recipe map into `vaultStore` (or a dedicated `recipeStore` slice) populated once on app boot and updated through `saveRecipeFromDesign`/`useCredentialRecipe`. The hook becomes a zustand selector. Bonus: this lets `credentialRecipeRegistry.memoryCache` be replaced by the same store, eliminating dual cache drift.

## 3. `popularityScore` recomputed in-sort: N log N × O(map lookups) on every filter/search change
- **Severity**: high
- **Category**: algorithmic
- **File**: `src/features/vault/sub_catalog/components/picker/usePickerFilters.ts:192-227`
- **Scenario**: When `sortMode === 'popular'`, the comparator calls `popularityScore(a)` and `popularityScore(b)` per `localeCompare` pair — `N log N` calls. Each call does 3 map gets + an additive. Combined with the existing per-keystroke filter pipeline (finding #1), this stacks: every keystroke re-sorts the filtered output even when sort mode hasn't changed.
- **Root cause**: Score is not precomputed. `sortConnectors` allocates `list.slice()` then sorts in place; could decorate-sort-undecorate to compute each connector's score exactly once per render.
- **Impact**: At 200 connectors, ~1500 score calls per keystroke when popular sort is active. Each is cheap individually but compounds with finding #1 on the same render.
- **Fix sketch**: Precompute `scoresByName = useMemo(() => Map<string, number>, [credentialUsageByType, recipeIndicators, viewCounts])`. Then comparator reads `scoresByName.get(a.name) - scoresByName.get(b.name)`. Same pattern for `recently_added` (parse `created_at` once into a precomputed map keyed by id).

## 4. `useMemo(() => Date.now(), [filteredConnectors])` defeats memo and re-derives `isNew` per render
- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/vault/sub_catalog/components/picker/PickerGrid.tsx:19`
- **Scenario**: `now` is memoized against `filteredConnectors` identity. But `filteredConnectors` identity changes on every keystroke (finding #1), so `now` ticks on every render anyway, and the prop `isNew` passed to each `ConnectorCard` shifts by milliseconds each render. Combined with the lack of `React.memo` on `ConnectorCard`, all N cards re-render on every keystroke even when none of their data changed.
- **Root cause**: Pseudo-memo pattern. Intent was "stable within a render batch", but the dep gates churn instead of stability. `ConnectorCard` is also a heavy component (multiple `motion.*` nodes with framer-motion `Variants`, `useMotion()`, `useTranslation()`, `getAuthMethods`/`getLicenseTier`/`isDesktopBridge` per render) and not memoized.
- **Impact**: All ~200 framer-motion subtrees reconcile per keystroke; layout/style recompute dominates. Visible jank when typing fast.
- **Fix sketch**: (a) Compute `now` once outside the component (or `useRef` set on mount). (b) Wrap `ConnectorCard` in `React.memo` with a custom equality on `connector.id`, `isOwned`, `isNew`, `recipeIndicator?.usageCount`. (c) Hoist the static `cardVariants`/`badgeSubtle`/`badgeStrong`/`labelVariants` objects (already module-scoped — good) but pass `onPickType` via stable callback from parent (already done via `useCallback`).

## 5. Inline `allApps.find()` and `arr.some()` over members in render
- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/vault/sub_catalog/components/desktop/DiscoveryAppList.tsx:89` (also `src/features/vault/sub_credentials/components/picker/ResourcePicker.tsx:212-213` — outside scope but pattern documented)
- **Scenario**: `CapabilityApprovalCard` is given `allApps.find((a) => a.connector_name === selectedApp)!` inline; computed on every parent render even though only the selected app matters. Low connector count today (desktop bridges only) but the same anti-pattern repeats in `ResourcePicker` where `stalePicks` does `picked.filter(p => !st.items.some(i => i.id === p.id))` — O(P × I) per render per spec.
- **Root cause**: Render-time lookups without memoization. Acceptable for small N, but pattern leaks across the codebase.
- **Impact**: Negligible today; matters when desktop bridges or scoped-resources lists grow. Scoped resource picker with 200 picker items × dozens of picks would already feel sticky.
- **Fix sketch**: `const selectedManifest = useMemo(() => allApps.find(...), [allApps, selectedApp])`. For `ResourcePicker`, precompute a `Set<itemId>` per spec and use `Set.has`.

## 6. `RecipeConfidenceBanner` re-fires IPC on every instruction keystroke
- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/features/vault/sub_catalog/components/design/phases/RecipeConfidenceBanner.tsx:21-39`
- **Scenario**: The `useEffect` depends on `instruction`, which is wired to the textarea in `IdlePhase` (`onChange={(e) => onInstructionChange(e.target.value)}`). Every keystroke fires `getCredentialRecipe(normalized)` against the IPC bridge. No debounce, no abort, no in-flight dedupe. The normalized key only changes when the user finishes a token, but the IPC fires on every character.
- **Root cause**: Direct effect on raw input value. The `cancelled` flag avoids stale state writes but does not cancel in-flight Tauri commands; under fast typing the request queue grows.
- **Impact**: Bursty IPC traffic + SQLite hits while typing. Each `get_credential_recipe` walks the recipes table. On WebView2/Tauri this serializes through the command bridge and competes with whatever else the design phase is doing.
- **Fix sketch**: (a) Debounce `instruction` -> `normalized` lookup by ~250ms. (b) Use `lookupRecipe` from `credentialRecipeRegistry.ts` instead of raw `getCredentialRecipe` so the in-memory cache is consulted first. (c) Track an in-flight promise keyed by `normalized` and reuse it within the debounce window.

## 7. `GatewayMembersModal` refreshes the entire members + credentials list after every mutation
- **Severity**: medium
- **Category**: data-layer
- **File**: `src/features/vault/sub_credentials/components/gateway/GatewayMembersModal.tsx:64-79, 100-160`
- **Scenario**: After every `addMcpGatewayMember`, `removeMcpGatewayMember`, `setMcpGatewayMemberEnabled` the modal awaits `refresh()` which calls `Promise.all([listMcpGatewayMembers, listCredentials])`. `listCredentials` is unrelated to the mutation and can be hundreds of rows; it gets re-fetched on every toggle. The modal is locked behind `isPending` while this round-trips.
- **Root cause**: Coarse "refetch everything" pattern instead of optimistic update on the local `members` array (which has all the fields needed to reflect a toggle).
- **Impact**: Each gateway-member toggle pays a full credentials-list IPC + JSON deserialize. With many vault credentials and a slow disk this is the wait the admin sees when flipping a gateway member on/off.
- **Fix sketch**: Optimistically mutate `members` for `setMcpGatewayMemberEnabled` (single boolean flip). For add/remove, only refetch `listMcpGatewayMembers` — `allCreds` only needs refetching when an external credential is created or deleted (not on gateway mutations). Wire `allCreds` to `vaultStore.credentials` so the modal subscribes to the existing source of truth.
