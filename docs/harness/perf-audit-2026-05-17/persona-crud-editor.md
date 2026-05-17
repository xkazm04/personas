# Perf-Optimizer Scan — Persona CRUD & Editor

> Project: Personas (frontend-only)
> Scope: 12 paths in src/
> Total: 9 findings (2 critical / 4 high / 2 medium / 1 low)

## Scope notes

- `src/features/agents/PersonasPage.tsx` does not exist; the actual page lives at `src/features/personas/PersonasPage.tsx` (reviewed). `PersonaOverviewPage.tsx` is the persona *list* surface (also reviewed for context — used after `selectPersona(null)`).
- High-traffic editor surface is in `EditorBody` + `PersonaEditorHeader`; `PersonaEditor.tsx` itself is a 10-line shell, so re-render hotspots are concentrated in `EditorBody`, `useEditorDraft`, `useEditorSave`, and `useEffectivePersona`.
- `useEditorSave` is the actual autosave wiring (referenced by `useEditorDraft`) and was read alongside the requested 12 files because the autosave focus area is meaningless without it.

---

## 1. `preparationFingerprint` JSON.stringify on every keystroke

- **Severity**: critical
- **Category**: re-render | algorithmic
- **File**: `src/features/agents/sub_editor/hooks/useEditorDraft.ts:48`
- **Scenario**: User typing in any text field in the editor (name, description, structured prompt, etc.).
- **Root cause**: `preparationFingerprint` is computed *during render* with `JSON.stringify({ id, systemPrompt, structuredPrompt, designContext, modelProfile, tools: tools.map(t=>t.id).sort(), automations: automations.map(a=>a.id).sort() })`. `useEditorDraft` is called on every keystroke (because `draft` lives inside it and `patch` calls `setDraft`). Every keystroke therefore JSON-stringifies the entire persona body, plus allocates two `.map().sort()` arrays. For a 4 KB structured prompt that is multi-KB of allocation per character.
- **Impact**: Visible input lag on slow machines and on personas with large `structured_prompt` / `design_context`. The fingerprint is *only* used as a dep of the `preparePersonaExecution` effect (which fires once 800 ms after a stable state), so 99 % of the work is thrown away.
- **Fix sketch**: Move the fingerprint into a `useMemo` that depends on the primitive source fields (`selectedPersona?.id`, `selectedPersona?.system_prompt`, etc.). Better: skip stringify and pass an array dep `[id, systemPromptLen, structuredPromptLen, modelProfile, toolsKey]` where `toolsKey` is a cheap `tools?.length ?? 0`. Or hoist into a selector inside the store keyed off `selectedPersonaId`.

---

## 2. `useEffectivePersona` re-allocates merged persona on every keystroke

- **Severity**: critical
- **Category**: re-render
- **File**: `src/features/agents/sub_editor/libs/useEffectivePersona.ts:21`
- **Scenario**: Any keystroke in the editor (typing in the description field, model dropdown change, anywhere).
- **Root cause**: The `useMemo` has `[selectedPersona, draft, baseline]` as deps. `draft` is a fresh object reference after every `patch()` call (because `patch` does `{...prev, ...updates}`). The memo therefore *always* re-runs and returns a brand-new merged `PersonaWithDetails` object reference, which then propagates through `PersonaEditorHeader` (which holds `effective` and reads `.icon`, `.name`, `.color`, `.description`, `.enabled`) and into `ContentHeader`, `PersonaAvatar`, `AccessibleToggle`. None of those are memoized.
- **Impact**: Every keystroke in *any* field repaints the header + avatar + toggle, even when only e.g. `maxConcurrent` changed. Combined with finding #1 and #3, the header is the primary lag contributor.
- **Fix sketch**: Compute and depend on the *primitive* fields rather than the whole draft: `useMemo(..., [selectedPersona, draft.name, draft.description, draft.icon, draft.color, draft.enabled, baseline.name, baseline.description, baseline.icon, baseline.color, baseline.enabled])`. Or: lift the diff into selectors so only mutated fields change identity.

---

## 3. `PersonaEditorHeader` re-renders on every keystroke despite only display-field overrides

- **Severity**: high
- **Category**: re-render
- **File**: `src/features/agents/sub_editor/components/PersonaEditorHeader.tsx:38`
- **Scenario**: User types in Settings/Model/Prompt fields.
- **Root cause**: The header receives `draft`, `baseline`, `patch`, `setBaseline` as props from `EditorBody`. `EditorBody` itself re-renders every keystroke (it owns `draft` state via the `useEditorDraft` hook). The header is not `React.memo`'d, and even if it were, all four props change identity per keystroke (`draft` is a new object, `patch`/`setBaseline` are stable, `baseline` is stable). On top of the props, the header subscribes to `selectedPersona`, `applyPersonaOp`, `credentials`, calls `useEffectivePersona` (#2), `useParsedDesignContext`, and computes a `readiness` memo with a `new Set(...)` and `[...new Set(missingCreds)]`. None of this needs to recompute per keystroke.
- **Impact**: Three layers of unnecessary work per character: header function body, `readiness` `useMemo` (deps include `credentials` and three nullable arrays from `selectedPersona`), and the children `QuickStatsBar` + `LabQualityBadge`. Translates directly to typing latency on slow machines.
- **Fix sketch**: (a) Wrap `PersonaEditorHeader` in `React.memo` with custom equality on the *primitive* display fields. (b) Or hoist the header out of the `draft`-owning component — pass only the field overrides the header actually displays. (c) Split readiness into a dedicated `useMemo` keyed off the primitive lengths and credential service-type set.

---

## 4. `QuickStatsBar` fires `listExecutions(personaId, 10)` on every persona switch with no cache

- **Severity**: high
- **Category**: duplicate-call | data-layer
- **File**: `src/features/agents/sub_editor/hooks/useQuickStats.ts:24`
- **Scenario**: User clicks any persona; navigates away; clicks back. Or switches between personas in the sidebar.
- **Root cause**: `useQuickStats` runs `listExecutions(personaId, 10)` in a `useEffect([personaId])` with zero caching. The store already has `executionsCache` (see `personaSlice.ts:303`), populated by `prefetchPersona`, but `useQuickStats` ignores it entirely. The IPC fires every time the editor mounts the header — including the very common A → B → A toggle, and including remounts after tab/wizard transitions.
- **Impact**: One redundant IPC per persona switch. Scales with switch frequency, not persona count. Also creates a small avalanche on first mount: `fetchDetail` (already running) + `listExecutions` here + `useHealthCheck` ping in `EditorTabBar` HealthBadge — all racing.
- **Fix sketch**: Read from `useAgentStore((s) => s.executionsCache[personaId])` first; fall back to `listExecutions` only when missing or stale (e.g. `executionsCacheAt[personaId] < Date.now() - 30_000`). Or call `prefetchPersona` on hover/focus and let `useQuickStats` be a pure selector.

---

## 5. `selectPersona` always re-fires `fetchDetail` even when `detailCache[id]` is fresh

- **Severity**: high
- **Category**: duplicate-call | data-layer
- **File**: `src/stores/slices/agents/personaSlice.ts:484`
- **Scenario**: User clicks persona A, then B, then A. Or: sidebar rapid-fire while still loading.
- **Root cause**: `selectPersona(id)` *always* calls `get().fetchDetail(id)` if `id` is truthy. The `deriveSelectedPersona(...)` call already populates `selectedPersona` from the cache synchronously, so the IPC is redundant when `detailCache[id]` exists. `prefetchPersona` does have a `hasFreshDetail` check (line 250) — but `selectPersona` doesn't.
- **Impact**: One IPC round-trip per click on the sidebar, even for personas freshly fetched 200 ms ago. With 30+ personas this becomes noticeable during exploratory sidebar browsing. Also resets `isLoading` to true (line 191) which can flash a loading state over an already-rendered editor.
- **Fix sketch**: In `selectPersona`, skip `fetchDetail` when `state.detailCache[id]` exists *and* was loaded recently (track a `detailCacheAt` map). For absolute freshness, fire a `requestIdleCallback`-deferred background refresh rather than blocking the foreground.

---

## 6. `SubTabSurface` unmount/remount of lazy tab on every tab switch

- **Severity**: high
- **Category**: re-render | data-layer
- **File**: `src/features/agents/sub_editor/components/SubTabSurface.tsx:13`
- **Scenario**: User clicks between editor tabs (Activity → Design → Settings → Lab).
- **Root cause**: `<AnimatePresence mode="wait">` with `motion.div` keyed on `tabId` *fully unmounts* the previous tab subtree on every switch. Each lazy tab (`ActivityTab`, `LabTab`, `DesignTab`, `PersonaSettingsTab`) has its own data-fetch effects (executions list, lab tests, health checks, design context parsing). Every return-to-tab triggers a re-fetch + re-suspense. Also blows away local state (form scroll position, expanded accordion state, sub-tab selection inside `DesignHub`).
- **Impact**: Network/IPC fan-out on every tab toggle. Tab switches feel like cold loads instead of cached views. Compounds with finding #4 because the header (where QuickStatsBar lives) *doesn't* unmount but its data re-fetches anyway when persona switches inside the tab change.
- **Fix sketch**: Replace AnimatePresence mode-wait with always-mounted hidden tabs (`display: none` / CSS opacity transitions), or cache tab content in a `Map<tabId, ReactNode>` and only switch visibility. Alternative: use `framer-motion`'s `mode="popLayout"` and `key` stably so React reconciles in place. Or: keep AnimatePresence visually but hoist data fetches into a tab-scoped Zustand slice that survives unmount.

---

## 7. `PersonaOverviewPage` recomputes filter/sort on every render and runs O(N) selection sync

- **Severity**: medium
- **Category**: algorithmic | re-render
- **File**: `src/features/agents/components/persona/PersonaOverviewPage.tsx:65`
- **Scenario**: User on the "All Agents" list with many personas; types in search box or toggles a filter.
- **Root cause**: (a) `usePersonaListFilters({ personas, view, search, ... })` is called every render — typing in the search box triggers a full re-filter, plus a downstream `useEffect` that builds `new Set(filteredData.map(...))` and `new Set([...prev].filter(...))` on each filter pass to prune selections. (b) `allSelected` is `filteredData.every(...)` recomputed inline. (c) `DataGrid` receives a new `getRowAccent` closure on every render (line 175) so row memoization (if any) is defeated. `pageSize=25` (line 185) limits *render* cost but the upstream filter still runs the full list.
- **Impact**: Scales with persona count. At 50+ personas with active search, each keystroke filters + dual-Set-builds + re-renders the grid. Not editor-typing-laggy, but list-page-laggy.
- **Fix sketch**: (a) `useMemo` the filter result keyed off primitive view fields. (b) Memoize `getRowAccent` with `useCallback`. (c) Replace the Set-pruning effect with a derived value (`useMemo` + filter on `selectedIds.intersection(visibleIds)`). (d) Virtualize via the `DataGrid`'s existing paginator instead of rendering all 25 rows-per-page eagerly inside Framer-Motion children.

---

## 8. `EditorTabBar` filter/map runs on every keystroke and uses `layoutId` motion underline

- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/agents/sub_editor/components/EditorTabBar.tsx:95`
- **Scenario**: User typing in editor; sidebar layout changes (rare).
- **Root cause**: `EditorTabBar` receives `dirtyTabs` (a new array reference whenever `useEditorDirtyState` notifies — which happens on every dirty-state flip), and runs `tabDefs.filter(...).map(...)` inline, plus an `isTabDirty(tab.id, dirtyTabs)` call per tab. Each tab also renders a `<motion.div layoutId="personaEditorTab">` underline — `layoutId` triggers Framer Motion layout measurement on every parent re-render. The bar receives a new `dirtyTabs` array on every dirty-flip but no `React.memo`, so EditorBody re-renders (which happen per keystroke) flow into the bar.
- **Impact**: Layout measurement + small filter cost on every keystroke. Mostly micro, but `layoutId` is one of the more expensive Framer features and the bar is always visible.
- **Fix sketch**: `React.memo(EditorTabBar)` with shallow-compare on `dirtyTabs.length + connectorsMissing + failedTabs.length + activeTabId`. Compute the filtered tab list once via `useMemo([tier])`. Consider plain CSS for the active underline (`absolute` div positioned by the active button's class) instead of `layoutId`.

---

## 9. `fetchPersonas` autoAssignIcons fires a second `listPersonas()` round-trip

- **Severity**: low
- **Category**: duplicate-call
- **File**: `src/stores/slices/agents/personaSlice.ts:139`
- **Scenario**: First launch after install, or after the `personas-icon-auto-assigned-v1` localStorage flag is cleared.
- **Root cause**: After `fetchPersonas` succeeds it kicks off `autoAssignPersonaIcons(personas).then(async () => { const updated = await listPersonas(); set(...) })`. The flag gating this is *only* set inside `autoAssignPersonaIcons` (presumed), so during the brief window between first `fetchPersonas()` and the localStorage write, parallel `fetchPersonas` calls (e.g. `runStartup` + `storeBusWiring` + `ChannelsBaseline.useEffect`) all enter the auto-assign branch.
- **Impact**: 1–3 extra `list_personas` IPC + a re-render with the same payload on first launch. One-time per machine, not user-visible after install completes.
- **Fix sketch**: Move the gate check to *before* invoking `autoAssignPersonaIcons` and set the localStorage flag synchronously up-front; or guard with an in-flight `Promise` so only one auto-assign pass runs per session.
