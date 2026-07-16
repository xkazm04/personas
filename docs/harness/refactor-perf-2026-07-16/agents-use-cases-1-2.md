# agents/use_cases [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 3 medium / 1 low)
> Context group: Persona Authoring & Design | Files read: 22 | Missing: 12

Note: 12 of the 34 listed files no longer exist (the entire `components/schedule/` directory — SubscriptionList, DayTimeGrid, UseCaseSubscriptions, ScheduleBuilder, ScheduleModePanels, UseCaseSubscriptionForm, SchedulePreview — plus `libs/scheduleHelpers.ts`, `core/UseCaseTestRunner.tsx`, `core/DefaultModelSection.tsx`, `detail/UseCaseModelOverride.tsx`, `detail/UseCaseModelOverrideForm.tsx`). The context map for this slice is ~35% stale and should be regenerated.

## 1. Manual-run money-path logic duplicated between PersonaLayoutView and useUseCaseDetail
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_use_cases/components/persona-layout/PersonaLayoutView.tsx:229
- **Scenario**: `handleRunActiveCapability` (lines 229–280) is a line-for-line re-implementation of `useUseCaseDetail.handleManualRun` (useUseCaseDetail.ts:95–178): the synchronous `runInFlightRef` reentrancy guard, the `MANUAL_RUN_DEDUPE_MS` idempotency-key window (the constant itself is declared twice, once in each file), the budget-block gate + toast, and the raw `executePersona` IPC call. The comments in both files openly say "Mirrors" the other.
- **Root cause**: The view-mode "Run now" button was added by copying the detail hook's body instead of extracting the shared behavior.
- **Impact**: This is a paid-execution (real CLI spawn) money path with a budget-enforcement gate — the two copies have already drifted slightly (the hook has a stale-persona re-check the view copy lacks; the view copy lacks the `logger.info` success trace). A future fix to the budget gate or dedupe window applied to one copy will silently miss the other.
- **Fix sketch**: Extract a `useManualPersonaRun()` hook in `libs/` that owns `runInFlightRef`, `lastRunRef`, `MANUAL_RUN_DEDUPE_MS`, the budget gate + toast, and the `executePersona` call, taking `(personaId, useCaseId, inputs)` at call time. Both call sites shrink to input-derivation + one hook call; the stale-persona re-check becomes shared behavior for free.

## 2. useUseCasesTab: ~half the hook's API is dead, including a never-attached scroll ref and a no-op onRerun
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_use_cases/libs/useUseCasesTab.ts:11
- **Scenario**: The hook has exactly one caller (PersonaLayoutView.tsx:65, verified by grep across src/), which destructures 9 of the 19 returned fields. `expandedHistoryIds`/`expandedConfigIds` + their memoized maps, `toolRunnerOpen`, `handleToggleHistory`, `handleToggleConfig`, and `handleExecutionFinished` are never consumed. `executionPanelRef` is never attached to any DOM node, so the `scrollIntoView` inside `handleExecute` (line 43) is a guaranteed no-op behind a 100ms setTimeout; `handleExecute` also silently drops its `_sampleInput` argument. `handleRerun` is an empty stub yet is wired through `UseCaseDetailExpanded → UseCaseHistory` as `onRerun`, so the history panel's re-run affordance does nothing.
- **Root cause**: Leftovers from the pre-persona-layout Use Cases tab (list with expandable history/config rows and an execution panel) that the PersonaLayout migration replaced.
- **Impact**: ~40 lines of dead state/memo machinery runs on every render of the hook; the no-op `handleRerun` is a functional trap (looks wired, does nothing) that will absorb debugging time.
- **Fix sketch**: Delete the unused state, memos, ref, and handlers; slim the return to the 9 consumed fields. Either implement `handleRerun` (call the shared manual-run path from finding 1 with the provided `inputData`) or remove the `onRerun` prop chain so UseCaseHistory hides the re-run button. Verify with tsc after trimming.

## 3. Dim-card icon-chip shell copy-pasted 6× across the dim-card family
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_use_cases/components/recipes-prototype/shared/UseCaseDetailExpanded.tsx:380
- **Scenario**: The 18×18 icon chip with inline styles (`background: active ? color+'1f' : 'rgba(148,163,184,0.12)'`, matching border, `#94a3b8` fallback icon color) plus the surrounding `rounded-card border bg-secondary/30 px-3 py-2` shell is duplicated in `DimCard`, `ToggleDimCard`, and `ReviewDimCard` (all in UseCaseDetailExpanded.tsx), in `ConnectorDimCard`'s trigger and its `ReadOnlyShell` (ConnectorDimCard.tsx:100, 200), and in `NotificationsDimCard` (NotificationsDimCard.tsx:85). Separately, `referencedConnectors` in displayUseCase.ts:202 re-implements the longest-prefix matching that `matchConnectorKey` (line 110) already provides.
- **Root cause**: Each interactive card variant was cloned from the read-only `DimCard` and re-styled in place.
- **Impact**: Six copies of magic rgba/hex values means any dim-card visual change (theming, sizing, dark-mode token migration) must be applied in six spots; they are already the kind of hardcoded-hex the project's design-system backlog flags.
- **Fix sketch**: Extract a `DimCardChrome` (or `DimIconChip` + shell) component in the shared folder taking `{ dim/color, icon, title, active, headerRight?, children }`; rebase the five variants on it. In displayUseCase.ts, replace the inner loop of `referencedConnectors` with `matchConnectorKey(hint)`.

## 4. EventRenameModal fires up to 2 IPC listener-count queries per row on every keystroke
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/agents/sub_use_cases/components/core/EventRenameModal.tsx:63
- **Scenario**: The effect's dependency is the string `rows.map(r => `${r.from}|${r.to}`).join(',')`, so every single keystroke in either input re-runs it, and it issues `countEventListeners` (a Tauri IPC that scans subscriptions/triggers in SQLite) for the `from` AND `to` of every non-empty row — typing a 12-char event name with 3 alias rows configured fires ~36–72 IPC round trips. The comment claims "whenever the user finishes typing" but there is no debounce. Responses also race: an earlier slow query can resolve after a later one and overwrite counts for text the user has since changed (per-row staleness isn't checked, only whole-effect `cancelled`).
- **Root cause**: Missing debounce on a keystroke-keyed effect, and a fan-out that re-queries all rows instead of only the row that changed.
- **Impact**: Bursty IPC + repeated SQLite scans while typing in a modal; on large event tables the advisory counts flicker and can display stale numbers, which directly feed the "N consumers will be affected" warning that drives a destructive choice (delete subscriptions).
- **Fix sketch**: Debounce the effect ~300ms (setTimeout in the effect, cleared in cleanup, is enough). Track a per-row query token (or compare `r.from`/`r.to` at resolve time) so late responses for edited text are discarded. Optionally query only rows whose from/to actually changed since the last run.

## 5. Every policy/notification/connector toggle triggers a full persona-detail refetch
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: data-layer
- **File**: src/features/agents/sub_use_cases/components/recipes-prototype/shared/usePolicyControls.ts:87
- **Scenario**: `usePolicyControls.persist`, `NotificationsDimCard.handleToggle` (NotificationsDimCard.tsx:48), `ConnectorDimCard.handleRebind` (ConnectorDimCard.tsx:61), `TileModelStrip.handleSelect` (TileModelStrip.tsx:60), and `useCapabilityToggle.applyToggle` (useCapabilityToggle.ts:60) each follow a targeted single-field write with `await fetchDetail(personaId)` — a full persona detail fetch (design context JSON, triggers, etc.) that replaces `selectedPersona` and re-renders the entire persona layout tree (tag bar, hero sigil, left rail, all dim cards, TilePolicyToggles per row).
- **Root cause**: No optimistic/partial store update path — the only way for other consumers to see the change is a whole-detail reload, as the usePolicyControls docstring acknowledges.
- **Impact**: Two IPC round trips plus a full-tree re-render per click on what are rapid-fire toggle affordances (the tile toggles are designed for quick flips across many capabilities); on personas with large design contexts each flip re-parses the whole context JSON. The awaited refetch also keeps the button in its `pending` state longer than the actual write.
- **Fix sketch**: Add a store-level `patchSelectedUseCase(personaId, useCaseId, partial)` that applies the known mutation to `selectedPersona.design_context` in place (the write payload is fully known client-side), and use it after a successful write; fall back to `fetchDetail` only on error or for cascade-bearing operations (enable/disable). `mutateSingleUseCase` already computes the next use-case object, so the patch can reuse its result.

## 6. matchConnectorKey re-sorts CONNECTOR_META keys on every call
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: algorithm
- **File**: src/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase.ts:112
- **Scenario**: `matchConnectorKey` does `Object.keys(CONNECTOR_META).sort(...)` per invocation, and it is called once per tool hint per use case inside `toDisplayUseCase`; `referencedConnectors` (line 206) performs the same sort once more per use case. `toDisplayUseCase` runs for every use case whenever `rawUseCases` or `personaConnectors` changes (i.e., after every fetchDetail — see finding 5, which multiplies this).
- **Root cause**: The sorted key list is derived from a module-constant map but computed inside the hot helper instead of once at module scope.
- **Impact**: Bounded (CONNECTOR_META is small), but it is repeated allocation + sort on a path that re-runs after every toggle/refetch; trivially avoidable.
- **Fix sketch**: Hoist `const CONNECTOR_KEYS_BY_LENGTH = Object.keys(CONNECTOR_META).sort((a, b) => b.length - a.length);` to module scope and use it in both `matchConnectorKey` and `referencedConnectors` (which should itself delegate to `matchConnectorKey`, per finding 3).
