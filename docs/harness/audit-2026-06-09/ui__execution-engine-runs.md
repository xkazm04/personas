# UI Perfectionist — execution-engine-runs
> Total: 6
> Severity: 1 critical, 2 high, 2 medium, 1 low

## 1. Fetch failure is indistinguishable from "no runs yet" — error-blind empty state
- **Severity**: critical
- **Category**: missing-state
- **File**: src/features/agents/sub_executions/components/list/ExecutionList.tsx:383
- **Scenario**: The execution-summary fetch throws (offline, DB locked, IPC error). `fetchExecutions` swallows it into a global error handler and leaves `executions` empty with `loading=false` (executionSlice.ts:518-521). The list then renders the cheerful "Agent ready / Try it now" empty state — the user believes the agent simply has no history, with no indication anything failed and no retry affordance.
- **Root cause**: `useExecutionList` exposes only `{ executions, loading }` and never surfaces `executionsError`. `ExecutionList` has exactly two branches — `loading` skeleton (line 293) and `executions.length === 0` empty state (line 383) — with no error branch in between.
- **Impact**: error-blind
- **Fix sketch**: Plumb the store's `error`/`errorKind` (or a per-fetch error) through `useExecutionList`, and add a third branch before the empty state: an error card (e.g. `AlertCircle`, `text-status-error` chrome matching TraceInspector.tsx:42) with a "Retry" button calling `refresh()`. Only fall through to "Agent ready" when the fetch genuinely succeeded with zero rows.

## 2. Status badge drops its icon and "running" pulse — status conveyed by color + label only
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/agents/sub_executions/components/list/ExecutionListRow.tsx:59
- **Scenario**: Every row's status pill renders only `statusEntry.label` as colored text. The `EXECUTION_STATUS_MAP` defines a distinct `icon` per state (Loader2/CheckCircle2/XCircle/Pause/AlertTriangle) and a `pulse: true` flag for `running` (formatters.ts:106-114), but the row ignores both. Running rows look static and identical-in-shape to completed/failed ones; the only differentiator is hue.
- **Root cause**: The badge markup hand-rolls `<span>{statusEntry.label}</span>` instead of also rendering `statusEntry.icon` and honoring `statusEntry.pulse`. Color-only status fails WCAG 1.4.1 for color-blind users, and the rich `StatusIcon`/`pulse` design that already exists elsewhere (ExecutionSummaryCard.tsx:96) is unused here.
- **Impact**: inaccessible
- **Fix sketch**: Render the icon inside the pill — `<Icon className={statusEntry.pulse ? 'animate-spin' : ''} />` for `running` (Loader2) plus the label — so shape disambiguates state. Reuse this badge as a shared component (see #3). Honor `prefers-reduced-motion` for the spin.

## 3. Status badge / retry / simulated markup duplicated across desktop + mobile (and other views)
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/agents/sub_executions/components/list/ExecutionListRow.tsx:116
- **Scenario**: The `{chevron}{statusBadge}{retryBadge}{simulatedBadge}` cluster is emitted twice in one file — once for the desktop grid row (line 116) and once for the mobile card (line 154) — and the status-pill concept is re-implemented again with different shape in ExecutionSummaryCard.tsx:96-99. A change to badge geometry, the new icon (#2), or a new status must be made in 3+ places, inviting drift.
- **Root cause**: No extracted `<ExecutionStatusBadge status>` / `<RetryBadge>` / `<SimulatedBadge>` primitives; the badge JSX is inlined per call site.
- **Impact**: inconsistency
- **Fix sketch**: Extract a single `ExecutionStatusBadge` (driven by `getStatusEntry`, rendering icon + label + pulse) plus `RetryBadge`/`SimulatedBadge` into `components/`, and consume them from both row variants and the summary card. One source of truth for the run-status visual language.

## 4. Raw Tailwind color literals bypass the semantic status token system
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/agents/sub_executions/detail/inspector/SpanRow.tsx:51
- **Scenario**: The list/formatters use semantic tokens (`text-status-error`, `text-status-success`, `bg-status-processing/10`), but sibling run-history views render the same concepts with raw literals: `text-red-400` / `bg-red-500/5` (SpanRow.tsx:26,51), `text-emerald-400` (ExecutionListRow.tsx:175), `text-indigo-400`/`text-pink-400` (ExecutionListFilters.tsx:99,103), `text-green-400`/`text-orange-400`/`text-blue-400` (ExecutionSummaryCard.tsx:38,65,74), `text-amber-300` (SpanRow.tsx:55; ExecutionSummaryCard.tsx:146). "Error red" and "success green" therefore have multiple slightly-different values across one feature, and won't re-theme.
- **Root cause**: Inconsistent adoption of the `status-*` / `brand-*` design tokens — raw palette classes were used ad hoc instead of the semantic equivalents already proven in formatters.ts.
- **Impact**: inconsistency
- **Fix sketch**: Replace raw literals with the matching semantic tokens (`red-*`→`status-error`, `emerald/green-*`→`status-success`, `amber/orange-*`→`status-warning`, `blue/indigo-*`→`status-info`). The compare A/B chips already model this correctly (ExecutionListRow.tsx:52-54) — apply the same discipline everywhere.

## 5. Desktop "Started" column uses static timestamps while mobile auto-updates — live-list inconsistency
- **Severity**: medium
- **Category**: polish
- **File**: src/features/agents/sub_executions/components/list/ExecutionListRow.tsx:119
- **Scenario**: The desktop grid renders the start time via static `formatTimestamp(execution.started_at)` (line 119), but the mobile card renders the same field with the self-ticking `<RelativeTime>` component (line 155). On the desktop table — the primary surface — a freshly started run shows a frozen absolute time that never refreshes to "just now / 5s ago" as the list live-updates, so the most recent run reads as stale.
- **Root cause**: Two different time renderers for the same column across breakpoints; the relative, live-friendly one was only wired into mobile.
- **Impact**: unpolished
- **Fix sketch**: Use `<RelativeTime timestamp={execution.started_at}>` on desktop too (with a tooltip exposing the absolute time), matching mobile and giving the live-updating list a recency cue without jank.

## 6. Log viewer has no empty/affordance for executions that produced no captured output
- **Severity**: low
- **Category**: missing-state
- **File**: src/features/agents/sub_executions/detail/views/ExecutionLogViewer.tsx:86
- **Scenario**: When a run has no log file, `getExecutionLog` resolves to `''` (or `null`→ falls back to `log_empty` only inside the toggle handler at line 52). On the copy path the empty string is set silently; on the view path the content block (line 86) renders an empty bordered box with no message. The user expands "Execution Log", sees a blank panel, and can't tell if it's empty-by-design or broken.
- **Root cause**: The `logContent !== null && !logLoading` branch renders the split-by-line output unconditionally, with no guard for empty/whitespace content distinct from the loading and error branches.
- **Impact**: confusion
- **Fix sketch**: Add an explicit empty branch when `logContent.trim() === ''` — a centered muted message (e.g. `FileText` + `e.log_empty`) consistent with the trace "no_trace_data" empty state (TraceInspector.tsx:49-58), instead of an empty box.
