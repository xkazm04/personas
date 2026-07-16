# triggers/studio [1/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 1 medium / 3 low)
> Context group: Execution & Orchestration | Files read: 18 | Missing: 0

## 1. Entire Dispatch-console subtree (RoutingView tree) is unreachable dead code
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/triggers/sub_studio/routing/EventCanvas.tsx:17
- **Scenario**: `EventCanvas` (the only consumer of `UnifiedRoutingView` → `routing/RoutingView.tsx`) has zero importers in all of `src/` (grep confirms only self-references and comments). `TriggersPage.tsx` renders only `TriggerStudioCanvas` → `StudioPatchbay`; no tab mounts `EventCanvas`. `StudioPatchbay`'s header comment ("the compose-only Switchboard baseline was retired at consolidation") confirms the consolidation happened but the losing view was never deleted.
- **Root cause**: The prototype consolidation kept `StudioPatchbay` as the winner but left the whole alternate Dispatch console tree in place: `EventCanvas.tsx`, `UnifiedRoutingView.tsx`, and `routing/layouts/routing/` — `RoutingView.tsx`, `EventRow.tsx`, `ExpandedDrawer.tsx`, `GroupPanel.tsx`, `RoutingTableHeader.tsx`, `useRoutingFilters.ts`, plus their siblings referenced only from inside this tree (`Toolbar`, `ClassPillsBar`, `SourceStack`, `ListenerStack`, `PulseDot`, `groupRows`, `accent`, `types`, `routing/index.ts`).
- **Impact**: ~16 files / well over 1000 LOC of unmaintained UI that still compiles, still gets swept by refactors and i18n passes, and misleads readers (both `RoutingView.tsx:2` and `StudioPatchbay` claim to be "the only view"). It also drags dead deps (`buildActivityMap`, filter machinery) into every audit.
- **Fix sketch**: Delete `EventCanvas.tsx`, `UnifiedRoutingView.tsx`, and the `routing/layouts/routing/` directory plus the tree-only siblings listed above. Keep the pieces `StudioPatchbay` actually uses: `useRoutingState.ts`, `buildEventRows.ts`, `routingHelpers.tsx`, `AddPersonaModal.tsx`, `DisconnectDialog.tsx`, `RenameEventDialog.tsx`. Verify with `tsc` + a final grep for each deleted symbol (no dynamic-import strings reference these; checked `sub_studio/routing` path strings too). Cross-context caution: confirm no test files or lazy() imports outside `src/` reference `EventCanvas` before deleting.

## 2. StudioPatchbay duplicates useRoutingState's data fetch and mirrors it through prop→state effects
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/triggers/sub_studio/StudioPatchbay.tsx:66
- **Scenario**: On mount, `StudioPatchbay` fetches `listAllTriggers()` + `listEvents(1000)` into its own state, passes them as `initialTriggers/initialEvents` into `useRoutingState`, which copies them back into its own state via two sync effects (useRoutingState.ts:63-64) and separately fetches subscriptions — while its `reload()` already performs the exact same three fetches.
- **Root cause**: `useRoutingState` was designed to serve multiple "variants" that owned their own initial fetch; now that `StudioPatchbay` is the only live consumer (see finding 1), the initial fetch in the component and the reload in the hook are the same logic living in two places, with two copies of the data.
- **Impact**: Two sources of truth that silently desync — after any `routing.reload()` (every commit/disconnect/rename) StudioPatchbay's local `triggers`/`events` are stale (harmless today only because nothing else reads them); plus a mount render cascade where `buildEventRows` over up to 1000 events recomputes for each sync effect firing (empty → triggers/events → subscriptions).
- **Fix sketch**: Move the initial load into `useRoutingState` — call `reload()` in a mount effect there, drop `initialTriggers/initialEvents` props and the two sync effects, and delete StudioPatchbay's local `triggers`/`events` state and its load effect. One owner, one fetch path, one derivation pass per data arrival.

## 3. buildEventRows doc comment points to a gutted file for its core heuristic
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: stale-comment
- **File**: src/features/triggers/sub_studio/routing/layouts/buildEventRows.ts:5
- **Scenario**: The header says "Inference heuristic documented in UnifiedRoutingView.tsx's top-of-file comment; maintain both in sync" — but `UnifiedRoutingView.tsx` is now a 29-line re-export shim with no heuristic documentation, so the promised spec no longer exists.
- **Root cause**: The view refactor that shrank `UnifiedRoutingView.tsx` to a shim moved the code but not the documentation contract the sibling file relies on.
- **Impact**: Anyone changing the emitter/listener direction-inference rules (Step 4) follows the pointer to nothing; the "maintain both in sync" instruction is unfulfillable.
- **Fix sketch**: Inline the inference-heuristic description into `buildEventRows.ts` itself (it is the implementation, so the doc belongs here) and delete the dangling pointer. If finding 1 is executed, `UnifiedRoutingView.tsx` disappears anyway.

## 4. AddPersonaModal re-parses design_context JSON on every render in the capability step
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/triggers/sub_studio/routing/layouts/AddPersonaModal.tsx:102
- **Scenario**: While the capability step is open, `capabilityOptions` calls `parseDesignContext(capabilityStep.design_context)` (a JSON.parse of the persona's full design context, which can be large) as a plain expression — it re-runs on every re-render of the modal, and every parent (`StudioPatchbay`) re-render propagates down since the modal is not memoized. `handlePersonaPick` parses the same document again immediately before setting the step.
- **Root cause**: The derivation is written as a bare ternary instead of `useMemo`, and the pick handler doesn't reuse its own parse result.
- **Impact**: Repeated JSON.parse + filter of a potentially multi-KB document on a hot render path (StudioPatchbay re-renders on any agent/pipeline store change while the modal is open). Bounded, but pure waste.
- **Fix sketch**: `const capabilityOptions = useMemo(() => capabilityStep ? (parseDesignContext(capabilityStep.design_context).useCases ?? []).filter(uc => uc.enabled !== false) : [], [capabilityStep])`. In `handlePersonaPick`, compute `enabledUseCases` once and stash it alongside `capabilityStep` (or just rely on the memo).

## 5. commitAll commits draft links serially, one round-trip at a time
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: serial-io
- **File**: src/features/triggers/sub_studio/useStudioComposer.ts:149
- **Scenario**: "Save all" iterates `committableLinks` with `await commitLink(link, { silent: true })` inside a for-loop, so N pending routes = N sequential `createTrigger` IPC round-trips; the ledger updates only as each one lands.
- **Root cause**: Sequential awaits where the commits are independent (each creates its own trigger; no ordering dependency between links).
- **Impact**: With a handful of drafts the delay is small, but a batch of 10+ links multiplies the Tauri invoke latency linearly and keeps the "Save all" interaction pending longer than necessary.
- **Fix sketch**: Run `const results = await Promise.allSettled(committableLinks.map(l => commitLink(l, { silent: true })))` and count fulfilled `true` results for the toast. `commitLink` already handles its own per-link error toast and `committing` set bookkeeping, so parallelizing is safe; keep the single success toast after the batch resolves.
