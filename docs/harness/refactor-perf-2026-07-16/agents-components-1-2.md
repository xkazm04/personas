# agents/components [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 4 medium / 1 low)
> Context group: Persona Authoring & Design | Files read: 34 | Missing: 0

## 1. ViewPresetBar component is dead code — file survives only as a type/constant carrier
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/components/allPersonas/ViewPresetBar.tsx:69
- **Scenario**: Grep across `src/` shows `ViewPresetBar` (the component) is never rendered anywhere. Every import of the file (`PersonaOverviewPage`, `PersonaOverviewToolbar`, `PersonaOverviewFilters`, `PersonaOverviewColumns`) pulls only `DEFAULT_VIEW_CONFIG` and the `AgentListViewConfig` type.
- **Root cause**: The persona-overview toolbar was rebuilt (search + chips + quick-toggles in `PersonaOverviewToolbar`) and the saved-views dropdown was never re-wired; the component, its 5 `SMART_PRESETS`, and the `createSavedView`/`deleteSavedView`/`listSavedViewsByType('agent_list')` call sites (~230 LOC) were left behind.
- **Impact**: A whole feature surface (saved views incl. persistence API calls) that looks alive but is unreachable — future editors will maintain it, translators keep `t.agents.view_presets.*` keys alive, and the `agent_list` saved-view rows in SQLite are write-only orphans. Note: `isDefault` in it also disagrees with `DEFAULT_VIEW_CONFIG` (checks `sortKey === 'name'` while the default is `'lastRun'`), further evidence it rotted.
- **Fix sketch**: Either re-mount `<ViewPresetBar currentConfig={view} onApplyConfig={setView} />` in `PersonaOverviewPage`'s toolbar row (product decision), or delete the component + `SMART_PRESETS` and move `AgentListViewConfig` / `DEFAULT_VIEW_CONFIG` into a small `viewConfig.ts` so the four type-importers stop depending on a dead component file. Verify no dynamic use of the `agent_list` view_type on the Rust side before dropping the API wiring.

## 2. PersonaOverviewCardList item selector scans the full personas array per card per store update (O(n²))
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/components/allPersonas/PersonaOverviewCardList.tsx:119
- **Scenario**: On mobile/compact layout, each `PersonaOverviewCardItem` subscribes to the agent store with `persona: s.personas.find((persona) => persona.id === id)`. Every store mutation (health poll, trigger-count refresh, build-phase tick) runs this linear `find` in N card subscribers → N×N comparisons, plus a `useShallow` object rebuild per card.
- **Root cause**: The card takes only `id` and re-derives the persona inside its Zustand selector instead of receiving the `Persona` object its parent already holds (`data.map((p) => ...)` has `p` in hand).
- **Impact**: With a large fleet (the constellation view caps at 200 for a reason) every background store update costs tens of thousands of iterations in selector evaluation on the mobile list — wasted CPU on a battery-sensitive layout, though bounded and not user-visible at small N.
- **Fix sketch**: Pass `persona={p}` down from `PersonaOverviewCardList` (it already maps over `data`) and keep the store selector to the per-id scalar lookups (`personaHealthMap[id]`, `personaTriggerCounts[id]`, `personaLastRun[id]`, build fields), which are O(1). `memo` on the item then keeps re-renders scoped to rows whose persona reference actually changed.

## 3. UnifiedBuildEntry keeps a never-read useState for the quick config — every config change re-renders the whole build surface
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/components/matrix/UnifiedBuildEntry.tsx:684
- **Scenario**: `const [, setGlyphQuickConfig] = useState<QuickConfigState>(...)` — the state value is discarded (empty destructure slot); all reads go through `glyphQuickConfigRef`. Yet `handleQuickConfigChange` calls `setGlyphQuickConfig(c)` on every picker interaction (frequency toggle, connector select, channel change), forcing a full re-render of `UnifiedBuildEntry` and its heavy `GlyphCinemaLayout`/`GlyphDialogueCinemaLayout` subtree each time.
- **Root cause**: Leftover state from before the ref-based pattern was adopted (the same file already uses the ref-mirror pattern for `intentText`/`contextText` deliberately); the setter was kept while the value was dropped.
- **Impact**: Unnecessary re-render of the app's most complex interactive surface on every quick-config click during persona creation — measurable jank risk on the hot build path, and misleading code (looks like reactive state, isn't).
- **Fix sketch**: Delete the `useState` and have `handleQuickConfigChange` only write `glyphQuickConfigRef.current = c`. If some child genuinely needs reactive quick-config state, it should own it locally — nothing in this component's render reads it.

## 4. PersonaHealthIndicator.tsx has no importers anywhere
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/components/allPersonas/PersonaHealthIndicator.tsx:28
- **Scenario**: Grep over `src/` finds zero imports of `PersonaHealthIndicator`; the only external mention is a stale comment in `lib/personas/personaThresholds.ts`. Health display in the overview now goes through `StatusBadge` / `HEALTH_STYLES` (PersonaOverviewBadges) and the constellation's ring colors.
- **Root cause**: The avatar-with-health-ring treatment was superseded by badge-based health rendering during the overview redesign, and the component was orphaned rather than removed.
- **Impact**: ~73 LOC of dead UI (with its own health-status vocabulary — 'dormant', 'mixed' — that drifts from the live `HEALTH_STYLES` labels), inflating the surface reviewers and i18n sweeps must reason about.
- **Fix sketch**: Delete the file and fix the comment in `personaThresholds.ts`. No dynamic-import risk: the identifier appears nowhere else. Cross-context callers already checked repo-wide via grep.

## 5. usePersonaActions returns handleDelete and handleEdit that no caller consumes
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/components/allPersonas/PersonaOverviewActions.tsx:38
- **Scenario**: The hook's sole consumer (`PersonaOverviewPage`) destructures `modal, handleBatchDelete, handleDeleteDrafts, handleBatchArchive, handleBatchRestore, draftIds` — `handleDelete` (the full single-persona confirm flow with typed-name confirmation and `BlastRadiusPanelLazy`) and `handleEdit` are built on every render and never used.
- **Root cause**: Per-row delete/edit actions moved off this list (row click routes through `handleRowClick`/`selectPersona`; deletion is batch-only here), but the hook kept the old single-item handlers.
- **Impact**: ~30 LOC of dead handler incl. a lazy blast-radius fetch path that looks load-bearing; the `useCallback` dependency lists make edits to the hook riskier than they need to be.
- **Fix sketch**: Drop `handleDelete` and `handleEdit` from the hook (and the now-unused `BlastRadiusPanelLazy` / `getPersonaBlastRadius` imports if nothing else in the file uses them). If a per-row delete is ever reintroduced, the batch-delete confirm pattern is the template. One-consumer hook, so the change is contained; confirm with a repo grep before removing since `handleDelete` is a common name (done for this context — only this hook returns it).

## 6. PersonaConfigPanel recomputes per-row capability model/provider dedup on every render
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/components/allPersonas/PersonaConfigPanel.tsx:469
- **Scenario**: Inside `visibleRows.map`, each render rebuilds `capModels` (`Set` dedup) and `capProviderKeys` (which runs `deriveProviderKey` → up to 4 regex tests per capability). Typing in the filter input re-renders the whole table per keystroke, redoing this for every visible row (~142 personas × capabilities in the reported fleet).
- **Root cause**: `capConfigsByPersona` is properly memoized over `rows`, but the derived per-persona model/provider arrays are computed inline in the row JSX instead of alongside it.
- **Impact**: Bounded but avoidable CPU per keystroke on the config tab (regex work scales with personas × capabilities); no correctness issue.
- **Fix sketch**: Extend the `capConfigsByPersona` memo to precompute `{ configs, capModels, capProviderKeys }` per persona id in the same pass, or extract a memoized `<PersonaConfigRow>` component keyed on `row` + `configs`. Either keeps filter typing O(visible rows) string work only.
