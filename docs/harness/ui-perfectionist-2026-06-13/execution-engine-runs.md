> Total: 9 findings (0 critical, 4 high, 4 medium, 1 low)

## 1. Run status rendered raw (`{summary.status}`) instead of StatusBadge/statusTokens
- **Severity**: high
- **Category**: reuse
- **File**: src/features/agents/sub_executions/detail/views/ExecutionSummaryCard.tsx:96-100
- **Problem**: The summary card prints the raw status string (`{summary.status}`) inside a hand-assembled icon+text+`capitalize` block colored from `getStatusEntry(...).text/.bg/.border`. The list row (`ExecutionListRow.tsx:60-65`) builds yet another bespoke status pill via `badgeClass(statusEntry)`. So the same run-state is presented three different ways (summary card text, list pill, runner header) — no shared `StatusBadge`/`StatusDot`. The catalog has exactly this: `StatusBadge` ("Status pill mapping a status token to label + color. Use with tokenLabel()") and `StatusDot`. Status is the single most-scanned attribute of a run list/detail; three inconsistent renderings is the most visible deviation on this surface.
- **Fix sketch**: Replace the hand-built pill/text in both `ExecutionSummaryCard` and `ExecutionListRow` with `StatusBadge` (and `StatusDot` for the compact mobile/row variant), driven by `statusTokens` + `tokenLabel()`. Retire the local `badgeClass`/`getStatusEntry`-styled markup so all three surfaces share one vocabulary.

## 2. Durations / costs / token counts hand-formatted with toFixed / toLocaleString instead of Numeric
- **Severity**: high
- **Category**: reuse
- **File**: src/features/agents/sub_executions/detail/views/ExecutionSummaryCard.tsx:105,112,119 (also TraceSummary.tsx:43,53; SpanRow.tsx:56; CostBreakdownBar.tsx:40-41; ExecutionInspector.tsx:45,55; PersonaRunner.tsx:191-192; ExecutionListRow.tsx:186-187)
- **Problem**: Numeric run metrics are formatted ad-hoc all over the surface: `(durationMs/1000).toFixed(1)+'s'`, `'$'+costUsd.toFixed(4)`, `totalTokens.toLocaleString()+' tokens'`, `input_tokens.toLocaleString()`. The catalog mandates `Numeric` ("Canonical number/percent/count display — locale + precision + unit. Use instead of raw toFixed/toLocaleString"). The hand-rolled versions skip tabular figures (columns of costs/durations don't align), ignore locale (`toFixed` is always `.`), and drift in precision (cost is `.toFixed(4)` here but `.toFixed(2)/.toFixed(3)` in ExecutionPreviewPanel:14-15). In a scannable runs table, misaligned non-tabular numbers read as not-world-class.
- **Fix sketch**: Route every duration/cost/token/percent through `Numeric` (with `unit`/`precision`/`percent` props) — or the existing `formatDuration`/`formatCost` helpers already imported in `ExecutionListRow` — and use tabular-figure styling so cost/duration columns align vertically. Consolidate the divergent cost precisions onto one rule.

## 3. Status pill color duplicated as raw `text-red-400` / amber / blue literals instead of statusTokens
- **Severity**: high
- **Category**: token
- **File**: src/features/agents/sub_executions/detail/inspector/TraceSummary.tsx:72,78-82; SpanRow.tsx:25,51,55; CostBreakdownBar.tsx:23-25,31-37; ExecutionSummaryCard.tsx:64,67,74,146-153; ExecutionListRow.tsx:167,181,201-202
- **Problem**: Status/semantic color is repeatedly expressed as raw Tailwind literals that duplicate `statusTokens`: error as `text-red-400`/`bg-red-500/5`/`bg-red-500/10`, warning as `text-amber-400`/`bg-yellow-500/10`/`text-yellow-200`, info as `text-blue-400`. `statusTokens.ts` is the documented single source of truth for success/warning/error/info → text/bg/border/ring/icon. These literals don't track theme changes and produce inconsistent error reds (`red-400` vs `red-500/5` vs `red-300/80` in ExecutionLogViewer:82). The error-message text in the list even uses `text-red-400/70` (ExecutionListRow.tsx:167,202) instead of `text-status-error` used elsewhere in the same file.
- **Fix sketch**: Replace all raw red/amber/yellow/blue status literals with `statusTokens.error/.warning/.info` class sets (`.text/.bg/.border`). The row already uses `text-status-error`/`bg-status-info` for badges — extend that consistently to error text, trace errors, span errors, and the cost-breakdown legend.

## 4. ExecutionLogViewer rebuilds a terminal log surface instead of using the terminal/ catalog
- **Severity**: high
- **Category**: reuse
- **File**: src/features/agents/sub_executions/detail/views/ExecutionLogViewer.tsx:73-98
- **Problem**: This viewer hand-rolls a log/terminal pane: a `<div>` with `whitespace-pre-wrap`, manual `logContent.split('\n').map(...)` line rendering, per-line `classifyLine`/`TERMINAL_STYLE_MAP` coloring, a bespoke loading row (`Loader2` + text), and a raw error `<div>`. Right next door, `ExecutionTerminal.tsx` correctly composes `TerminalHeader`/`TerminalSearchBar`/`TerminalBody` from `@/features/shared/components/terminal/`. So the *same product* shows execution output two completely different ways — the runner gets search, copy, line-count, fullscreen, unseen-counter, empty-state; the detail log viewer gets none of that and a different visual frame. This is the clearest "import what exists; never hand-roll" violation on the surface.
- **Fix sketch**: Render the log through `TerminalBody` (passing `lines={logContent.split('\n')}`) inside the terminal frame, reusing `TerminalHeader`'s copy/line-count affordances, so detail-log and runner output share one terminal catalog presentation. Drop the manual map + bespoke loading/error blocks.

## 5. Hand-built error and empty states with hard-coded English instead of EmptyState/ErrorBanner
- **Severity**: medium
- **Category**: state-coverage
- **File**: src/features/agents/sub_executions/components/list/ExecutionList.tsx:383-407
- **Problem**: The list's error and empty states are bespoke flex columns (icon-in-rounded-square + heading + body + button) with `bg-red-500/5`/`border-red-500/20` literals, and the error variant hard-codes untranslated English ("Couldn't load runs", "The execution history failed to load…", "Retry") behind `eslint-disable custom/no-hardcoded-jsx-text` — inconsistent with the fully-i18n empty state directly below it. The catalog provides `EmptyState` and `ErrorBanner`; these two blocks reimplement them with token deviations and a localization regression.
- **Fix sketch**: Replace both blocks with `EmptyState` (icon=`Rocket`, action=Try-it) and `ErrorBanner`/`EmptyState`-error (statusTokens.error, retry action), and move the English strings into `t.agents.executions.*` so the error path matches the localized empty path.

## 6. ExecutionLogViewer loading uses a raw spinner row, no skeleton; copy uses bespoke setTimeout instead of catalog state
- **Severity**: medium
- **Category**: state-coverage
- **File**: src/features/agents/sub_executions/detail/views/ExecutionLogViewer.tsx:75-80,22-39
- **Problem**: While the log loads, the surface shows a single `Loader2 animate-spin` + text row — there's no shape-matched skeleton for the multi-line log block, so content pops in (a layout jump) once loaded, unlike `ExecutionList` which deliberately uses `TableSkeleton` "so loaded rows swap in without a layout shift." Separately, copy feedback is a manual `setTimeout(…2000)` toggling local `copied` state, duplicating the behavior `CopyButton`/`useCopyToClipboard` already encapsulate (and the component imports both yet reimplements the timer).
- **Fix sketch**: Show a `ListSkeleton` (several muted lines) in the log frame while loading; let `useCopyToClipboard`'s built-in `copied` flag drive `CopyButton` instead of the hand-rolled `setTimeout`.

## 7. Tool-call / file-change list markers built from raw green/orange/blue literals, not eventTokens/statusTokens
- **Severity**: medium
- **Category**: token
- **File**: src/features/agents/sub_executions/detail/views/ExecutionSummaryCard.tsx:38,64,67,74,76
- **Problem**: The tool-call marker is a raw `text-green-400` "▶", and file-change markers/counts use `text-orange-400`/`text-blue-400` ("modified"/"read") as bare literals. These category colors are exactly what `eventTokens`/`statusTokens` exist to standardize; as literals they don't theme and drift from the inspector's own span colors (`getSpanTypeConfig`) which are token-driven. The result is the same "tool call" concept colored one way in the summary card and another in the trace inspector.
- **Fix sketch**: Drive these markers from the shared span/event token config (`getSpanTypeConfig`/`eventTokens`) or `statusTokens.success/.info`, matching the inspector so tool-call and file I/O coloring is consistent across summary and trace views.

## 8. Inspector rows are a hand-built CSS-grid list with no virtualization, skeleton, or shared row separator
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/agents/sub_executions/detail/inspector/SpanRow.tsx:22-26 (rendered in TraceInspector)
- **Problem**: Span/waterfall rows are a bespoke `grid grid-cols-[minmax(200px,1fr)_minmax(200px,2fr)]` with `hover:bg-secondary/30` and no shared separator token. Traces can hold up to 10,000 spans (TraceSummary warns about eviction at that limit), yet there's no `GroupedVirtualList`/virtualization and no `ListSkeleton` while the trace loads — a long trace renders every row to DOM. Row dividers also bypass `listTokens.ROW_SEPARATOR` (`border-primary/[0.06]`), the documented separator used app-wide; the list relies on hover-only differentiation.
- **Frame fix sketch**: Render spans through `GroupedVirtualList` (or the catalog virtual list) with `ROW_SEPARATOR` between rows and a `ListSkeleton` loading state, so large traces stay scannable and performant and align with the app's standard list chrome.

## 9. List header + rows hand-rolled as 12-col grids instead of UnifiedTable
- **Severity**: low
- **Category**: reuse
- **File**: src/features/agents/sub_executions/components/list/ExecutionList.tsx:411-419 + ExecutionListRow.tsx:90-134
- **Problem**: The executions table is a hand-built `grid grid-cols-12` header plus matching per-row grids, with manually-synced `col-span-*` values that must be kept in lockstep across three places (header, row, and the `EXECUTION_TABLE_SKELETON_COLUMNS` comment at ExecutionList.tsx:29-39 literally documents this fragile mirroring). Row separators use `border-primary/10` rather than `listTokens.ROW_SEPARATOR`. The catalog's `UnifiedTable` exists to own column definitions, header, sticky behavior, and separators in one place. (Scoped low because the current implementation is otherwise polished — sticky header, density tokens, shape-matched skeleton — so this is an architectural-consistency nit, not a visible defect.)
- **Fix sketch**: Migrate to `UnifiedTable` with a single column descriptor array (status/capability/duration/started/tokens/cost) feeding header, rows, and skeleton, and adopt `ROW_SEPARATOR` for dividers — eliminating the manually-synced col-spans.
