# agents/executions [2/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 3 medium / 2 low)
> Context group: Execution & Orchestration | Files read: 17 | Missing: 1

## 1. Replay terminal re-parses and re-highlights every visible line on every playback tick
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/sub_executions/replay/ReplayTerminalPanel.tsx:122
- **Scenario**: During replay playback or scrubbing, `visibleLines` changes many times per second. Each render calls `highlightLine()` for every visible line — trying `JSON.parse` + `JSON.stringify(…, null, 2)` on JSON-looking lines and running a heavy backtracking-prone inline-JSON regex (`/^(.*?)(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})(.*)$/`) on every other line. `JsonHighlight`'s internal `useMemo`s do not help because a fresh element is created per render.
- **Root cause**: Per-line highlight work is done inline in the parent's render body with no per-line memoization; the whole line list re-renders whenever the scrub position advances by one line.
- **Impact**: O(visible lines) parse/regex/stringify per playback frame. For a replay with hundreds–thousands of log lines (agent executions routinely emit large protocol logs), scrubbing towards the end burns CPU quadratically over the session and makes the scrubber feel janky.
- **Fix sketch**: Extract a `const TerminalLine = memo(({ index, text }) => …)` component that computes `classifyLine` + `highlightLine` inside itself; since `line.text` is immutable per index, `memo` makes each already-rendered line free on subsequent ticks. Optionally cache `highlightLine` results in a `Map<number, ReactNode>` keyed by line index for scrub-backwards reuse.

## 2. Component files named after components they do not contain (RunnerToolCalls = HealingCard, RunnerStreamView = RunnerPhaseTimeline)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/agents/sub_executions/components/runner/RunnerToolCalls.tsx:8
- **Scenario**: A developer looking for the healing notification card opens `detail/HealingCard.tsx` (still referenced by the context map — the file no longer exists) or greps for a `RunnerToolCalls` component that was deleted; instead `RunnerToolCalls.tsx` exports `HealingCard` + `AiHealingCounters`, and `RunnerStreamView.tsx` exports only `RunnerPhaseTimeline` (a `globals.css` comment even still points at "RunnerStreamView" for the timeline shimmer).
- **Root cause**: Components were moved/rewritten into existing files without renaming the files; the old `detail/HealingCard.tsx` was deleted while its content landed under a leftover filename.
- **Impact**: Pure navigation/maintenance hazard: file names actively lie about their contents, and stale references (context map, CSS comment) accumulate around them.
- **Fix sketch**: Rename `RunnerToolCalls.tsx` → `HealingCard.tsx` and `RunnerStreamView.tsx` → `RunnerPhaseTimeline.tsx`, update the two imports in `PersonaRunner.tsx` and the `globals.css` comment, and refresh the context map entry (it also still lists the deleted `detail/HealingCard.tsx`).

## 3. Duplicated fmtCost/fmtTokens formatters with inconsistent output
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_executions/components/runner/ExecutionPreviewPanel.tsx:12
- **Scenario**: `ExecutionPreviewPanel.tsx:12-22` defines local `fmtCost`/`fmtTokens`; `libs/comparisonHelpers.ts:22-29` exports another `fmtCost`/`fmtTokens` used by `ExecutionComparison`. They disagree: preview renders `$0.0X`/`1.2K`/`1.2M`, comparison renders `$0.0123` (4 decimals)/`1.2k` (lowercase, no M tier).
- **Root cause**: Two features independently grew tiny money/token formatters instead of sharing one utility next to `formatDuration` in `@/lib/utils/formatters`.
- **Impact**: The same execution's cost/tokens display differently between the preview panel and the comparison view (e.g. `$0.012` vs `$0.0123`, `12.3K` vs `12.3k`), and future fixes (currency locale, thresholds) must be applied twice.
- **Fix sketch**: Move one canonical `fmtCost`/`fmtTokens` pair into `@/lib/utils/formatters` (pick the comparison variants or unify casing/precision deliberately), re-export or import from both call sites, and delete the local copies. Verify no other context imports the `comparisonHelpers` versions before removing the exports there.

## 4. ExecutionLogViewer re-splits and re-classifies the whole log on every unrelated re-render, with no line memoization
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/sub_executions/detail/views/ExecutionLogViewer.tsx:97
- **Scenario**: With the log expanded, clicking Copy sets `copied=true` and again `false` 2s later; each state flip re-renders the component, which re-runs `logContent.split('\n')` and `classifyLine` per line and rebuilds the full DOM list. Execution logs are unbounded (whole CLI transcript), so this can be thousands of lines.
- **Root cause**: The split + classify pipeline lives inline in JSX with no `useMemo` on `logContent`, and every line is a fresh element each render.
- **Impact**: Bounded but real: a multi-MB log means a noticeable main-thread stall (string split + N regex classifications + N-node reconcile) on every copy click or parent re-render while the section is open.
- **Fix sketch**: `const lines = useMemo(() => logContent?.split('\n') ?? [], [logContent])` and memoize the classified rows (same `TerminalLine` component as finding #1 would serve both viewers). For very large logs consider capping initial render with a "show all" affordance, since the container is scroll-capped at `max-h-96` anyway.

## 5. HealingCard countdown recreates its interval every second
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: timer-churn
- **File**: src/features/agents/sub_executions/components/runner/RunnerToolCalls.tsx:22
- **Scenario**: While a retry backoff counts down, the effect has `countdown` in its dependency array, so each 1-second tick tears down the interval and creates a new one; the inner `clearInterval(timer)` at 0 is then redundant with the cleanup.
- **Root cause**: Interval effect depends on the state it mutates instead of running the interval once and stopping inside the callback.
- **Impact**: Negligible CPU, but the pattern is a maintenance trap (double-clear logic, easy to introduce a leak when editing) on a component that appears on every healing retry.
- **Fix sketch**: Depend only on `[isRetry, notification.backoff_seconds]`: start one interval when a retry notification arrives, decrement with the functional updater, and `clearInterval` in cleanup plus when the updater hits 0. This also lets the separate reset effect at line 30 fold into the same effect.

## 6. Dead ternary branch in BudgetRecoveryCard getResetLabel
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_executions/components/runner/BudgetRecoveryCard.tsx:20
- **Scenario**: `getResetLabel` returns `budget_reset_tomorrow` when `diffDays === 1` on line 19; line 20 then re-tests `diffDays === 1` to choose between `budget_reset_in_days_one` and `..._other`, so the `_one` branch is unreachable.
- **Root cause**: A singular/plural template selection survived after an early-return for the singular case was added above it.
- **Impact**: Dead branch plus a translation key (`budget_reset_in_days_one`) that appears used but never renders — misleading for translators and future i18n cleanup.
- **Fix sketch**: Replace line 20 with `const tpl = t.execution.budget_reset_in_days_other;` (or drop the early return and keep the one/other selection — pick one mechanism). Check whether `budget_reset_in_days_one` is referenced elsewhere before removing it from the catalogs.
