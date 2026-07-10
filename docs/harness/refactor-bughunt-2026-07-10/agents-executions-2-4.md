> Context: agents/executions [2/4]
> Total: 7
> Critical: 0  High: 0  Medium: 2  Low: 5

## 1. Live HealingCard renders untranslated raw severity (i18n regression)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/agents/sub_executions/components/runner/RunnerToolCalls.tsx:46
- **Scenario**: The actually-rendered HealingCard (the one PersonaRunner imports, see finding 2) prints the severity badge as `{notification.severity}` — the raw backend enum string. The *unused* canonical copy at `detail/HealingCard.tsx:69` renders it through `tokenLabel(t, 'severity', notification.severity)`. So for any non-English user (or any locale re-labeling of severity), the badge shows the untranslated backend token while the rest of the card is localized.
- **Root cause**: When HealingCard was duplicated into the runner file, the i18n token lookup was dropped; the divergence went unnoticed because the correct version is dead code.
- **Impact**: UX / i18n — inconsistent, untranslated severity label in a user-facing healing notification.
- **Fix sketch**: In `RunnerToolCalls.tsx` wrap severity with `tokenLabel(t, 'severity', notification.severity)` (import from `@/i18n/tokenMaps`), matching the detail version — then collapse the duplicate per finding 2.

## 2. Dead duplicate files: detail/HealingCard.tsx and detail/AiHealingCounters.tsx
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/agents/sub_executions/detail/HealingCard.tsx:1-145, src/features/agents/sub_executions/detail/AiHealingCounters.tsx (whole file)
- **Scenario**: Grepped every `HealingCard`/`AiHealingCounters` reference in src/. The only importer is `PersonaRunner.tsx:19` which pulls both from `./RunnerToolCalls`. Neither `detail/HealingCard.tsx` nor `detail/AiHealingCounters.tsx` is imported anywhere (no barrel re-export either). They are byte-for-behavior near-duplicates of the copies inside `RunnerToolCalls.tsx`.
- **Root cause**: Component was copied into the runner folder (with the i18n fix, finding 1) but the originals under `detail/` were never deleted, so three copies of two components now drift independently.
- **Impact**: Maintainability — the "better" (i18n-correct) copy is the dead one; future edits are likely to land in the wrong file (as finding 1 shows already happened in reverse).
- **Fix sketch**: Delete `detail/HealingCard.tsx` and `detail/AiHealingCounters.tsx` after porting their i18n `tokenLabel` severity fix into the live `RunnerToolCalls.tsx` copies.

## 3. Runner files are misnamed vs their contents
- **Lens**: code-refactor
- **Severity**: low
- **Category**: misplaced-file
- **File**: src/features/agents/sub_executions/components/runner/RunnerToolCalls.tsx, src/features/agents/sub_executions/components/runner/RunnerStreamView.tsx
- **Scenario**: `RunnerToolCalls.tsx` exports `HealingCard` + `AiHealingCounters` (no tool-call UI at all). `RunnerStreamView.tsx` exports `RunnerPhaseTimeline` (a phase waterfall, not a stream view). Verified by reading both files and confirming the export names via grep.
- **Root cause**: Files were repurposed/renamed by content but the filenames were never updated.
- **Impact**: Maintainability — grep-by-filename and mental navigation are misleading; a reader looking for tool-call rendering opens the wrong file.
- **Fix sketch**: Rename to match exports (e.g. `HealingCard.tsx`, `RunnerPhaseTimeline.tsx`) or move `HealingCard`/`AiHealingCounters` into their own file; update the two imports in `PersonaRunner.tsx`.

## 4. TimelineScrubber leaks window pointer listeners on unmount mid-drag
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/features/agents/sub_executions/replay/TimelineScrubber.tsx:29-49
- **Scenario**: `handlePointerDown` attaches `pointermove`/`pointerup` listeners to `window` and only removes them in the `onUp` handler. If the component unmounts while a drag is in progress (e.g. the user closes the replay tab while scrubbing), `onUp` never fires, so the listeners survive and keep invoking `onScrub` (a stale closure over the unmounted component's props) on the next pointer move. There is also no `pointercancel` handler.
- **Root cause**: No `useEffect` cleanup ties the window listeners to component lifetime; teardown depends solely on receiving `pointerup`.
- **Impact**: UX / minor leak — stray listener + `onScrub` calls after unmount; harmless in most flows but accumulates across mount/unmount cycles.
- **Fix sketch**: Track the active move/up handlers in a ref and remove them in a `useEffect(() => () => cleanup(), [])`; optionally add a `pointercancel` listener alongside `pointerup`.

## 5. ExecutionLogViewer swallows copy errors and gives no feedback on empty log
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/features/agents/sub_executions/detail/views/ExecutionLogViewer.tsx:22-39
- **Scenario**: In `handleCopyLog`, when `logContent` is null it fetches the log, sets it, and only copies `if (content)`. If the log is legitimately empty (`''`) nothing is copied and no "copied" state is set — the copy button silently no-ops. Additionally every clipboard/`getExecutionLog` failure is swallowed by `.catch(() => {})` / `.catch(() => { /* ignore */ })`, so a failed copy looks identical to a successful one.
- **Root cause**: Copy path optimizes for the happy case; empty and error branches were never surfaced.
- **Impact**: UX — user clicks copy, nothing lands on the clipboard, and there is no error indication.
- **Fix sketch**: Show a transient error state on catch (reuse the existing `logError` pattern) and set `copied` feedback even for empty content, or disable the copy button when there is no content to copy.

## 6. diffLines set-based diff collapses duplicate lines and mis-orders additions
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/agents/sub_executions/libs/comparisonHelpers.ts:38-56
- **Scenario**: `diffLines` builds `Set(linesA)`/`Set(linesB)` and marks membership. Consequences: (a) a line that appears N times in A but once in B is still marked entirely `same`; (b) a line present in both but at a different position is `same`, hiding real reordering; (c) all `added` lines are appended after all of A's lines rather than shown in position. For terminal-output comparison this can present two genuinely different runs as nearly identical.
- **Root cause**: Membership-set diff instead of a sequence (LCS) diff; acceptable as "simple" but understated in accuracy.
- **Impact**: UX / correctness — the comparison view can under-report differences between executions.
- **Fix sketch**: Either document the limitation at the call site, or replace with a line-level LCS diff for positional accuracy and duplicate handling.

## 7. Inconsistent duplicate cost/token formatters
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/agents/sub_executions/libs/comparisonHelpers.ts:22-29, src/features/agents/sub_executions/components/runner/ExecutionPreviewPanel.tsx:12-22
- **Scenario**: `fmtCost`/`fmtTokens` exist in both places with *different* behavior — comparisonHelpers formats cost to 4 decimals and tokens as `k`; ExecutionPreviewPanel formats cost to 2 decimals and tokens as `K`/`M`. Both render cost/token figures in the same executions feature, so the same value can display differently depending on the panel.
- **Root cause**: Each component grew its own money/number formatter rather than sharing one.
- **Impact**: Maintainability / minor UX inconsistency in how costs and token counts are displayed across the feature.
- **Fix sketch**: Extract a single `formatCost`/`formatTokens` (with an explicit precision option) into a shared util and have both call sites use it; decide one canonical presentation.
