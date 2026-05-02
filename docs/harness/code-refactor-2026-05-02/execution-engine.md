# Code Refactor Scan — Execution Engine (frontend shell)

> Scanned: 2026-05-02 | Findings: 8 | Files reviewed: ~22

## Summary

The frontend execution shell is small (3 components + 1 store slice) and the store slice is exemplary — exhaustiveness-checked enums, key-collision guards, good doc-comments, and a paired test that catches new statuses at compile time. Refactor health concentrates instead in `ExecutionMiniPlayer.tsx` (the file is doing too many jobs in one component, and subscribes to the structured-event stream twice for the same execution) and in `PreRunPreview.tsx`, which is shipped, fully wired internally, but has zero call sites in the app — it and its hook are dead code. Three dominant patterns: (1) **dead surfaces still present in lazy-imported chunk graph**, (2) **duplicate hook subscriptions because helper sub-components reach for the same data the parent already has**, (3) **inline branching in a single component where extracting two named subcomponents would clarify the simple-vs-power split**.

## 1. `PreRunPreview` component + companion hook are unreferenced

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/execution/components/PreRunPreview.tsx:1-175`
- **Scenario**: `PreRunPreview` is exported but no source file imports it — the only mentions outside the file itself are CHANGELOG and harness scan docs that critique it. Its companion hook `src/hooks/execution/usePreRunCheck.ts` is imported only by this dead component, so both are orphaned.
- **Root cause**: A "PreRunPreview popover in the editor header (Starter tier)" was added per CHANGELOG #31 but the editor-header integration was either reverted or never landed; the component was left behind. Three prior harness scans (dev-experience, bug-hunt, ambiguity) all flag bugs in it (Enter-confirms-when-not-ready, missing focus trap, Intl reallocated each render) — wasted reviewer effort because the code is unreachable.
- **Impact**: ~175 LOC of UI plus a hook ship in the bundle behind nothing. Future readers (and automated scans) keep filing tickets against unreachable code. CHANGELOG implies a feature exists that doesn't.
- **Fix sketch**:
  - Delete `src/features/execution/components/PreRunPreview.tsx`.
  - Delete `src/hooks/execution/usePreRunCheck.ts` (verify no other consumers — ripgrep currently shows none in `src/`).
  - Either add the missing wiring (planned spot is the editor header per CHANGELOG) in a new PR, or remove the CHANGELOG #31 line.
  - If keeping for a near-term restore, move both files to a `_unused/` folder and add a README explaining why.

## 2. `ExecutionMiniPlayer` subscribes to the same execution stream twice

- **Severity**: high
- **Category**: duplication
- **File**: `src/features/execution/components/ExecutionMiniPlayer.tsx:43-44, 142-144`
- **Scenario**: `ExecutionMiniPlayer` calls `useReasoningTrace(activeExecutionId)` and `useExecutionSummary(...)` for the Power-mode summary card. It then renders `<SimpleExecutionView activeExecutionId={...} />` which calls **the same two hooks again** with the same id. Each `useReasoningTrace` registers its own `listen(EventName.EXECUTION_EVENT, ...)` (see `useStructuredStream.ts:43`) and maintains its own `entries` array up to 500 items.
- **Root cause**: When Simple mode was added (see `SimpleExecutionView` extracted as a private function above the default export) the author wired the trace hooks into the inner component instead of lifting the data through props.
- **Impact**: Two Tauri event listeners for the same execution_id, two parallel 500-entry arrays, two re-render trees on every event. Power-mode users unaffected; Simple-mode users pay double. Also a correctness smell — if entries diverge (e.g. one mounts late) the summary card and the inline summary disagree.
- **Fix sketch**:
  - Lift `useReasoningTrace` + `useExecutionSummary` to the parent and pass `traceEntries`, `traceLive`, `executionSummary` into `SimpleExecutionView` as props.
  - Or invert: gate so Simple mode renders the hooks, Power mode renders them once at parent, never both.
  - Either way, ensure the structured-event listener is registered exactly once per active execution.

## 3. `ExecutionMiniPlayer` is a 386-line "god component" mixing five concerns

- **Severity**: medium
- **Category**: structure
- **File**: `src/features/execution/components/ExecutionMiniPlayer.tsx:119-386`
- **Scenario**: One default-exported component handles: drag-and-drop positioning math (lines 153-208), simple-vs-power tier branching (lines 314-336), background executions strip (lines 295-311), pipeline dots strip (lines 326-336), collapsed last-line preview (lines 339-350), expanded scrollable terminal (lines 353-376), and trailing summary card (lines 378-383). The simple/power split is done with five separate `{!isSimple && (...)}` conditional blocks scattered through the JSX.
- **Root cause**: Component grew incrementally — `SimpleExecutionView` was extracted (good), but the corresponding `PowerExecutionView` was never extracted, leaving the asymmetry where one mode is a function and the other is inline.
- **Impact**: Reader cost: cannot scan the file in one pass. Test cost: prior harness scans (dev-experience.md #1) flag that drag clamping, hasContent gate, and stop-button wiring are untested precisely because the surface area is too large. Bundle: useEffect hooks + memos all run regardless of which branch renders.
- **Fix sketch**:
  - Extract `PowerExecutionView` (the `!isSimple` branches) as a sibling to `SimpleExecutionView`.
  - Extract `useDraggablePosition(initialPos, setter)` as a custom hook — drag math is generic and likely needed elsewhere.
  - Extract `<BackgroundExecutionsBar />` (lines 295-311) — self-contained.
  - Target: top-level `ExecutionMiniPlayer` becomes ~80 lines: pinned/hasContent gate → header → mode switch.

## 4. `SimpleExecutionView` is a private inner function declared in a default-export module

- **Severity**: low
- **Category**: structure
- **File**: `src/features/execution/components/ExecutionMiniPlayer.tsx:32-117`
- **Scenario**: `SimpleExecutionView` is defined as a non-exported `function` ahead of the default-exported `ExecutionMiniPlayer`. It is 86 lines, calls 4 hooks, and is logically a peer of the (yet-to-be-extracted) Power view.
- **Root cause**: Same growth pattern as finding #3 — extracted partway, not into its own file.
- **Impact**: File reads top-down as "helper, helper, helper, then the real thing." Newcomers expect the default export at the top; here they have to scroll past two helpers. Cannot import for tests in isolation.
- **Fix sketch**:
  - Move `SimpleExecutionView` into a sibling file, e.g. `src/features/execution/components/SimpleExecutionView.tsx`, and export named.
  - Have `ExecutionMiniPlayer.tsx` import it. Pair with #3's `PowerExecutionView` extraction for symmetry.

## 5. `PipelineDots` puts React `key` on the wrong element inside `<Tooltip>`

- **Severity**: medium
- **Category**: cleanup
- **File**: `src/features/execution/components/PipelineDots.tsx:32-53`
- **Scenario**:
  ```tsx
  {PIPELINE_STAGES.map((stage) => {
    // ...
    return (
      <Tooltip content={STAGE_META[stage].label} placement="bottom">
        <div key={stage} ... />
      </Tooltip>
    );
  })}
  ```
  The `key` is on the inner `<div>`, but React requires the key on the **outermost** element returned from `map`. Currently each `<Tooltip>` has no key, so React falls back to index-based reconciliation.
- **Root cause**: Probably a copy of an earlier version that didn't have the `<Tooltip>` wrapper, then `<Tooltip>` was added without moving the key.
- **Impact**: React dev-mode warning (probably suppressed somewhere), and any future change that reorders `PIPELINE_STAGES` causes Tooltip state (e.g. open/closed, animation) to bleed across stages because indices stayed stable but identities changed. Low-frequency bug but real.
- **Fix sketch**:
  - Move `key={stage}` to the `<Tooltip>` element.
  - Drop the `key` from the inner div.

## 6. Two parallel `TerminalBody` + `classifyLine` implementations exist

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/execution/components/ExecutionMiniPlayer.tsx:364-371` (uses `@/lib/utils/terminalColors`); compare with `src/features/shared/components/progress/TerminalBody.tsx:1-74` (private `classifyLine` + `LINE_STYLES`)
- **Scenario**: `ExecutionMiniPlayer` correctly imports the canonical `classifyLine` and `TERMINAL_STYLE_MAP` from `@/lib/utils/terminalColors`, matching `src/features/shared/components/terminal/TerminalBody.tsx`. But there's a **second** `TerminalBody` at `src/features/shared/components/progress/TerminalBody.tsx` that ships its own private `classifyLine` (different keyword list — `transform_questions`, `[milestone]`, etc.) and its own `LINE_STYLES` map. Two terminal-line classifiers with drifting rules.
- **Root cause**: Two terminal-rendering surfaces (the agents/execution one and the wizard-progress one) evolved independently; the canonical extraction in `lib/utils/terminalColors.ts` reached one but not the other.
- **Impact**: A line that says `error` colors red in `ExecutionMiniPlayer` but a line containing `[milestone]` is "marker"-cyan only in the progress surface. Bugs filed against one stay open on the other. The `progress/TerminalBody.tsx` is technically out of scope here, but `ExecutionMiniPlayer` is the primary justification for the canonical lib — leaving the progress copy unmigrated leaks the duplication.
- **Fix sketch**:
  - Migrate `src/features/shared/components/progress/TerminalBody.tsx` to use `@/lib/utils/terminalColors` (`classifyLine`, `TERMINAL_STYLE_MAP`).
  - If the progress surface needs `[milestone]` and `transform_questions` keywords, add them to the canonical `classifyLine` so both surfaces benefit.
  - Delete the local `LINE_STYLES` map.

## 7. `processActivitySlice` carries dead `processPromoted` flow if queue->run path is the only path

- **Severity**: low
- **Category**: dead-code
- **File**: `src/stores/slices/processActivitySlice.ts:84, 297-315`
- **Scenario**: `processPromoted` mutates a `queued` row's `status` to `running` and resets `startedAt`. Wired by `eventBridge.ts:435`. Worth verifying that the queue→run pipeline emits a separate `processStarted` (which would overwrite the row anyway) or relies on this method exclusively. If `processStarted` is called for the same execution after queueing, then `processPromoted` is dead — its set is overwritten on the next event.
- **Root cause**: Queue lifecycle was designed before `processStarted` was made idempotent for "already-keyed" rows; the promotion path may be the legacy artefact.
- **Impact**: If dead, ~20 LOC of slice + an event subscription doing nothing. If live, this is fine — but it should be documented which it is. Currently the slice has good doc comments on `clearNonActive`, `enrichProcess`, `findUniqueProcessKey`, but nothing here.
- **Fix sketch**:
  - Trace one full lifecycle (queue → start → end) end-to-end and either delete `processPromoted` + the bridge handler, or add a doc-comment explaining "this is the only running-transition for queued-first executions; `processStarted` is skipped on the promote path".

## 8. `findProcessKey` exported behavior is "lossy on ambiguity"; `findUniqueProcessKey` is "strict" — name doesn't telegraph the contract

- **Severity**: low
- **Category**: naming
- **File**: `src/stores/slices/processActivitySlice.ts:137-180`
- **Scenario**: Two helpers with near-identical signatures: `findProcessKey` returns the *first* prefix-matching key when multiple exist (used by `enrichProcess`/`updateProcessStatus`), `findUniqueProcessKey` refuses ambiguity (used by `processEnded`). The names suggest the second is just "a unique variant of the first" — but the actual semantic difference is **safety**: one is silently lossy, the other rejects.
- **Root cause**: The `Unique` modifier got tacked on when the lossy version was discovered to corrupt activity-dock state (per the doc comment), rather than renaming the lossy one.
- **Impact**: Low. The doc comments are good and the test coverage prevents regressions. But a future caller picking between the two by name alone may grab the lossy one without reading the comment. This is a "trap-named" pair.
- **Fix sketch**:
  - Rename `findProcessKey` → `findProcessKeyLoose` (or `findFirstProcessKey`) and `findUniqueProcessKey` → `findProcessKeyStrict`.
  - Update both call sites (`enrichProcess`, `updateProcessStatus`, `processEnded`).
  - Or leave names but add a 1-line block comment above each: `// LOSSY: returns first match. Use ...Strict for end-of-life mutations.`

> Total: 8 findings (2 high, 4 medium, 2 low)
