# Code Refactor Scan — Agent Chat & Tool Runner

> Scanned: 2026-05-02 | Findings: 9 | Files reviewed: ~55

## Summary

The chat / launchpad / tool-runner / API surface is in good shape — small, single-responsibility components with clean Zustand wiring and well-commented edge-case handling. The execution-detail / replay subtree, in contrast, is the dominant refactor problem: **it currently exists as two parallel implementations** (`detail/` + `replay/` + `trace/` vs. `components/detail/` + `components/replay/`) that are independently maintained, share the same component names, and have already started drifting (PipelineWaterfall fallback behaviour, TraceInspector live-merge logic). The two trees are reached via different entry points — the modal goes through `detail/ExecutionDetail.tsx`, the index re-export goes through `components/list/ExecutionDetail.tsx` → `components/detail/DetailSteps.tsx` — so end-users see different UIs depending on where the same execution is opened. On top of that there are several truly dead files (the `detail/views/Execution*` subgraph, `runnerHelpers` vs `runnerTypes` duplication, two `CostSparkline` files, two `executionListConstants`/`useExecutionDetail` re-export shims, and `replay/ReplayHelpers.ts`). Cleaning the duplicates and picking one canonical path is the single highest-leverage move available here.

## 1. Two parallel `ExecutionDetail` implementations rendered from different entry points

- **Severity**: high
- **Category**: duplication
- **File**: `src/features/agents/sub_executions/detail/ExecutionDetail.tsx:1-50` and `src/features/agents/sub_executions/components/detail/DetailSteps.tsx:1-175`
- **Scenario**: `ExecutionDetailModal` (used by Overview activity drawer, etc.) imports from `detail/ExecutionDetail.tsx` — a 50-line composition that delegates tabs, content, header, and metadata to extracted components in the same folder. The package `index.ts` exports a different `ExecutionDetail` that goes through `components/list/ExecutionDetail.tsx` (a one-line re-export) → `components/detail/DetailSteps.tsx` — a 175-line monolith. The Overview's `ExecutionRow` consumes the second one. Same execution, two visually different detail views depending on origin.
- **Root cause**: A refactor split the monolithic `DetailSteps.tsx` into per-concern components under `detail/` but the original was never deleted, and only the modal was switched to the new path. The barrel `index.ts` still points at the old one.
- **Impact**: Bug fixes / i18n / status-icon updates that land in one variant silently miss the other. New developers cannot tell which is canonical (both look "current"). UX is inconsistent across surfaces.
- **Fix sketch**:
  - Pick `detail/ExecutionDetail.tsx` (the smaller, decomposed one) as canonical.
  - Update `sub_executions/index.ts:6` to re-export from `./detail/ExecutionDetail`.
  - Delete `components/list/ExecutionDetail.tsx` (the re-export shim) and `components/detail/DetailSteps.tsx`.
  - Verify `components/detail/DetailHeader`, `DetailMetadata` are still imported by `detail/ExecutionDetailContent.tsx` or move them under `detail/`.

## 2. Two parallel `replay/` and `components/replay/` trees with diverging behaviour

- **Severity**: high
- **Category**: duplication
- **File**: `src/features/agents/sub_executions/replay/*` vs `src/features/agents/sub_executions/components/replay/*`
- **Scenario**: `ReplaySandbox.tsx`, `ReplayToolPanel.tsx`, and `PipelineWaterfall.tsx` all exist twice with near-identical bodies. They have already drifted: `replay/PipelineWaterfall.tsx:36` falls back to `buildSyntheticTrace(execution)` when no live trace exists, while `components/replay/PipelineWaterfall.tsx:23-28` returns `null` and shows the empty state. `components/detail/TraceInspector.tsx` carries 100+ extra lines of live `EXECUTION_TRACE_SPAN` listener / unified-trace merge logic that `detail/inspector/TraceInspector.tsx` does not.
- **Root cause**: Same as Finding 1 — split-and-keep refactor. The `replay/` tree is consumed only by `detail/ExecutionDetail.tsx`; the `components/replay/` tree is consumed only by `components/detail/DetailSteps.tsx`.
- **Impact**: User opens the same execution from two surfaces and sees different waterfalls / trace data / fallback rendering. Future replay features must be implemented twice or accidentally land only on one side.
- **Fix sketch**:
  - Decide which `PipelineWaterfall` semantics are correct (synthetic-trace fallback yes/no) and which `TraceInspector` is canonical (the one with live merge logic appears richer).
  - Collapse to one canonical `replay/` folder consumed by the chosen `ExecutionDetail`.
  - Delete the loser. Move `trace/` (StageBar, SubSpanBar, stageColors, SyntheticTrace) under the survivor or under a shared util module if both need it.

## 3. Entire `detail/views/Execution*` subgraph is dead code

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/agents/sub_executions/detail/views/ExecutionList.tsx`, `ExecutionRow.tsx`, `ExecutionListHeader.tsx`, `ExecutionExpandedDetail.tsx`, `useExecutionListState.ts`, `CostSparkline.tsx`
- **Scenario**: `detail/views/ExecutionList.tsx` is a fully-formed alternate `ExecutionList` (uses `useExecutionListState`, `ExecutionRow`, `ExecutionListHeader`, `ExecutionExpandedDetail`) that nothing outside the folder imports. Project-wide grep for `detail/views/Execution(List|Row|Header)` returns zero hits. Only `ExecutionSummaryCard`, `ExecutionMemories`, `ExecutionLogViewer` from this folder are referenced externally — the rest is orphaned.
- **Root cause**: Looks like a half-completed extraction that was never wired up; the live `ExecutionList` lives at `components/list/ExecutionList.tsx`.
- **Impact**: Six files (~hundreds of lines) of plausible-looking React appear in search results, mislead future readers into editing the wrong copy, and silently rot.
- **Fix sketch**:
  - Delete `detail/views/ExecutionList.tsx`, `ExecutionRow.tsx`, `ExecutionListHeader.tsx`, `ExecutionExpandedDetail.tsx`, `useExecutionListState.ts`, `CostSparkline.tsx`.
  - Keep `ExecutionSummaryCard.tsx`, `ExecutionMemories.tsx`, `ExecutionLogViewer.tsx` (used by `ExecutionMiniPlayer` and the shared modal content).
  - Promote the survivors out of `views/` since the rest of the folder no longer makes sense as a directory.

## 4. `runnerHelpers.ts` and `runnerTypes.tsx` define the same things twice

- **Severity**: high
- **Category**: duplication
- **File**: `src/features/agents/sub_executions/libs/runnerHelpers.ts` and `src/features/agents/sub_executions/runnerTypes.tsx`
- **Scenario**: Both files define `HealingEventPayload`, `PhaseEntry`, `ToolCallDot`, `dotColor`, `PHASE_META`, `detectPhaseFromLine` — same names, same shapes. They have already diverged: `runnerTypes.tsx` adds `labelKey: string` to `PHASE_META` for i18n (e.g. `'agents.executions.phase_thinking'`), while `runnerHelpers.ts` has only the hardcoded English `label`. `RunnerStreamView.tsx`, `RunnerToolCalls.tsx`, `useRunnerState.ts` import from `runnerHelpers`; `HealingCard.tsx`, `ExecutionSummaryCard.tsx` import from `runnerTypes`.
- **Root cause**: i18n migration patched one file but not the other; the two now coexist permanently because at least one consumer imports from each.
- **Impact**: Phase labels rendered from `RunnerStreamView` are not translated, while phase labels rendered from `HealingCard` are. New phases or healing event fields must be added in both files or split-brain bugs appear.
- **Fix sketch**:
  - Make `runnerTypes.tsx` (the i18n-aware copy) canonical.
  - Update the three `runnerHelpers` consumers to import from `runnerTypes` instead.
  - Delete `libs/runnerHelpers.ts`.

## 5. Two byte-identical `CostSparkline` components, plus matching duplication in re-export shims

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/agents/sub_executions/detail/views/CostSparkline.tsx` and `src/features/agents/sub_executions/components/list/ExecutionListItem.tsx`
- **Scenario**: Two SVG sparkline components with identical bodies. They live under different folder hierarchies because they were duplicated alongside the `ExecutionList`/`ExecutionListRow` clone. The misnamed `ExecutionListItem.tsx` (its only export is `CostSparkline`, not anything called `ExecutionListItem`) is imported by `components/list/ExecutionListRow.tsx:8`. Separately, `detail/executionDetailTypes.ts` and `libs/useExecutionDetail.ts` are byte-identical re-export shims for the same `errorExplanation` + `parseJson` symbols, and `detail/executionListConstants.ts` defines a `TEMPLATE_SAMPLE_INPUT` that already exists inline in `libs/useExecutionList.ts:6` (and is not imported from the constants file anywhere).
- **Root cause**: Repeated copy-paste during the parallel-tree split (Findings 1-3). Re-export shims were probably created as compatibility layers during a rename and never collapsed.
- **Impact**: Same logic must be maintained in two places. Misnamed file (`ExecutionListItem` exporting `CostSparkline`) is actively misleading to anyone using file search.
- **Fix sketch**:
  - Pick one `CostSparkline.tsx` (the standalone file is better named than `ExecutionListItem.tsx`); delete the duplicate; rename the survivor's containing folder if it's now the only file there.
  - Delete `detail/executionDetailTypes.ts` (or `libs/useExecutionDetail.ts`) — keep one shim and update imports.
  - Delete `detail/executionListConstants.ts` (already inlined in `libs/useExecutionList.ts`).

## 6. `replay/ReplayHelpers.ts` is unused

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/agents/sub_executions/replay/ReplayHelpers.ts:1-15`
- **Scenario**: Exports `formatMs`, `formatCost`, `SPEED_OPTIONS`. Project-wide grep for the file path returns zero importers. The same three exports exist (and are used) at `libs/useReplayState.ts` (consumed by `components/replay/ReplayTransport.tsx:12` and `ReplayTimeline.tsx:6`).
- **Root cause**: Likely the `replay/` side of the parallel-tree split was supposed to use this module but the actual `replay/ReplayTransportControls.tsx` / etc. import from elsewhere. The helpers file was forgotten.
- **Impact**: Tiny but real — search results pollute, future readers wonder which `formatMs` to use.
- **Fix sketch**:
  - Confirm zero importers.
  - Delete `replay/ReplayHelpers.ts`.

## 7. ChatBubbles re-defines its own operation-line predicate, drifting from `chatAdvisoryDispatch.extractOperations`

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/agents/sub_chat/ChatBubbles.tsx:10-13` and `src/features/agents/sub_chat/libs/chatAdvisoryDispatch.ts:81-136`
- **Scenario**: `ChatBubbles` defines a one-line `isOperationLine` (just `startsWith('{"op"')`) that strips advisory operation JSON from displayed messages. `chatAdvisoryDispatch.extractOperations` does the actual extraction with multi-line accumulation, control-character sanitisation, dedup, code-block awareness, and 50KB cap. The shallow predicate misses any operation JSON that begins with whitespace or unusual key ordering, while the parser handles it.
- **Root cause**: The display-side filter and the dispatch-side parser were written separately and predate the multi-line accumulator.
- **Impact**: Multi-line operation JSON whose first line doesn't start with `{"op"` after trim leaks into the visible transcript even though it was correctly dispatched. Conversely, a JSON-like line that starts with `{"op"` but isn't really an op gets hidden from the user.
- **Fix sketch**:
  - Export an `isOperationStart(line: string): boolean` from `chatAdvisoryDispatch.ts` that ChatBubbles imports, OR
  - Have `chatAdvisoryDispatch` return a `Set<string>` of operation-line offsets / texts as part of its result, and have the chat slice strip those exact ranges before persisting.
  - At minimum, share the predicate so the two sides cannot drift further.

## 8. OpsSidebar `assertions` badge code path is permanently dead, panel-count comment is stale

- **Severity**: low
- **Category**: dead-code
- **File**: `src/features/agents/sub_chat/OpsSidebar.tsx:62-74` and `:128-134`
- **Scenario**: `OpsBadges` declares an optional `assertions: { failCount }` field, and `getBadge` has a branch for it (`badges.assertions.failCount > 0 → bg-red-400`). But the only caller (`ChatTab.tsx:66-69`) constructs `OpsBadges` with only `run` and `health` — `assertions` is never populated, so the branch is unreachable. The keyboard-shortcut comment at `OpsSidebar.tsx:62` says "Ctrl+1-5 switch panels" but `PANEL_ORDER` has 6 entries and the loop accepts `1..PANEL_ORDER.length`, so Ctrl+6 also works.
- **Root cause**: Assertions panel was added to `PANEL_ORDER` and got a typed badge slot, but the badge wiring in ChatTab was never finished. The comment was written when there were 5 panels and not updated when `director` was added.
- **Impact**: Reader confusion — looks like assertions surface failure counts to the icon rail when they don't. Comment is misleading.
- **Fix sketch**:
  - Either wire up `assertions: { failCount: ... }` from a real selector in ChatTab, or drop the unused branch + the optional field.
  - Update the keyboard-shortcut comment to "Ctrl+1-N where N is panel count" or just say "Ctrl+1-6".

## 9. Console.warn in advisory dispatch and stray console.warn in experiment bridge

- **Severity**: low
- **Category**: cleanup
- **File**: `src/features/agents/sub_chat/libs/chatAdvisoryDispatch.ts:128` and `src/features/agents/sub_chat/hooks/useExperimentBridge.ts:126`
- **Scenario**: Both files use raw `console.warn(...)` for diagnostics. The codebase's convention elsewhere in this scope (e.g. `replay/ReplaySandbox.tsx:12`, `components/list/ExecutionList.tsx:17`, `components/replay/ReplaySandbox.tsx:10`) is to construct a logger via `createLogger('replay-sandbox')` from `@/lib/log`.
- **Root cause**: Files predate the `createLogger` convention or were copied from a context that didn't use it.
- **Impact**: Inconsistent log surface — these warnings won't appear in whatever sink `createLogger` plugs into, and they aren't tagged with a module name.
- **Fix sketch**:
  - `const logger = createLogger('advisory-dispatch')` and `const logger = createLogger('experiment-bridge')`.
  - Replace `console.warn(...)` with `logger.warn(...)`.

> Total: 9 findings (4 high, 3 medium, 2 low)
