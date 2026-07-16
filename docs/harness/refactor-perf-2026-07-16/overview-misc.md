# overview (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 4 medium / 2 low)
> Context group: Observability & Monitoring | Files read: 30 | Missing: 4

Missing files (skipped): `src/features/overview/libs/anomalySeverity.ts`, `src/features/overview/sub_analytics/libs/useChartSeries.ts`, `src/features/overview/sub_cron_agents/CronAgentsPage.tsx` (only the `components/` copy exists), `src/features/overview/sub_knowledge/knowledgeTypes.ts` (types live in `libs/knowledgeHelpers.ts`). Context map is stale for these.

## 1. Two parallel JSON syntax-highlighter implementations render the same overview surfaces inconsistently
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_events/HighlightedJson.tsx:5
- **Scenario**: The execution detail (`ExecutionDetailContent.tsx:149`) renders raw JSON via `HighlightedJsonBlock` (highlight.js + sanitize + `dangerouslySetInnerHTML`), while the event detail (`EventDetailContent.tsx:53`) renders payload JSON via a completely separate hand-rolled regex tokenizer in `HighlightedJson`. Same feature area, same "pretty-print + colorize JSON" job, two divergent color schemes and copy-button affordances.
- **Root cause**: `HighlightedJson` was written locally under `sub_events` instead of reusing (or extending) the existing shared `HighlightedJsonBlock` from the agents inspector.
- **Impact**: Double maintenance for any JSON-rendering fix (masking, wrapping, theme), visually inconsistent token colors between the Execution and Event modals, and the regex tokenizer is a second place where malformed-JSON edge cases must be handled.
- **Fix sketch**: Pick one implementation as the shared primitive (the hljs-based `HighlightedJsonBlock` is more robust and already sanitized), move it to `features/shared/components/display/`, add the optional hover CopyButton wrapper that `HighlightedJson` provides, then replace `HighlightedJson` usage in `EventDetailContent` and delete the regex version.

## 2. `cronHelpers.formatRelative` re-implements the shared relative-time formatter with hard-coded English
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_cron_agents/libs/cronHelpers.ts:8
- **Scenario**: `CronAgentCard` shows "next in 2h / last 3d ago" via this local helper while every neighboring overview table (`MessageList`, `EventLogList`, `ChannelDeliveryPill`) uses the shared `RelativeTime` / `formatRelativeTime` from `@/lib/utils/formatters`. On a non-English locale the cron page keeps English "ago"/"in" strings and slightly different rounding than the rest of the dashboard.
- **Root cause**: A one-off helper predating (or ignoring) the shared formatter; it duplicates the same ms→m/h/d bucketing logic and bypasses the i18n layer entirely (`t`/`tx` are unused for these strings).
- **Impact**: Localization gap plus drift risk — a fix to relative-time rounding or wording in the shared formatter never reaches the cron page.
- **Fix sketch**: Replace `formatRelative` calls in `CronAgentCard.tsx:92/99` with the shared `RelativeTime` component (or `formatRelativeTime` for future timestamps if the shared one supports them — extend it if not) and delete `formatRelative`. `formatInterval` is genuinely cron-specific and can stay.

## 3. Every keystroke in the Knowledge search re-renders all visible `KnowledgeRow`s with fresh JSON parses and unstable callbacks
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/overview/sub_knowledge/components/KnowledgeRow.tsx:182
- **Scenario**: Typing in the Knowledge Graph search box (`KnowledgeGraphDashboard` `search` state) re-renders the dashboard on every keystroke; each visible virtualized row receives a brand-new `onMutated={() => { void fetchData(); }}` closure (KnowledgeGraphDashboard.tsx:429 and :458), so even a `memo` wrapper couldn't bail out — and `KnowledgeRow` isn't memoized anyway. Each render re-runs `parseJsonOrDefault(entry.pattern_data)` plus the framer-motion tree the dashboard's own comment calls "heavy".
- **Root cause**: Un-memoized row component + per-row inline arrow props + unmemoized `pattern_data` parse inside the row body.
- **Impact**: The progressive-reveal mitigation only helps initial mount; interactive filtering/searching still pays JSON.parse × visible rows × keystroke. Bounded by virtualization (~10-15 rows) but this is the hottest interaction on the page.
- **Fix sketch**: Wrap `KnowledgeRow` in `React.memo`; hoist `onMutated` to a single `useCallback` in the dashboard (`const refetch = useCallback(() => { void fetchData(); }, [fetchData])`) passed to all rows; move the `patternData`/`recentResults` derivation into `useMemo(..., [entry.pattern_data])` inside the row.

## 4. `EventLogList` rebuilds the entire column config (with embedded filter JSX) on every render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/overview/sub_events/components/EventLogList.tsx:143
- **Scenario**: `columns` is a plain array literal recreated on every render, embedding freshly-constructed `filterComponent` elements and `render` closures; `STATUS_OPTIONS` (line 59) and `typeOptions` (line 125) are likewise rebuilt. Each search-box keystroke re-renders the component (controlled input), handing `UnifiedTable` an entirely new `columns` prop identity every time.
- **Root cause**: Column/option definitions live inline in the render body instead of `useMemo`, so referential stability is lost even though their inputs (filters, translations) change rarely.
- **Impact**: Any memoization inside `UnifiedTable` (header cells, column filters) is defeated during typing and realtime event pushes — the whole table header + visible rows reconcile per keystroke on what is a high-frequency screen (live event bus pushes up to 200 rows).
- **Fix sketch**: Wrap `columns` in `useMemo` keyed on `[triggerFilter, triggerOptions, typeOptions, statusFilter, typeFilter, selectedPersonaId, personas, t]`, and hoist `STATUS_OPTIONS` into the existing `useMemo` pattern used for `SOURCE_TYPE_LABELS`. Cheap change, no behavior difference.

## 5. Unused animation exports in `libs/animations.ts`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/libs/animations.ts:54
- **Scenario**: Repo-wide grep shows only `fadeUp`, `staggerContainer` (DashboardHomeMissionControl) and `pageTransition` (OverviewPage) are imported. `revealFromBelow`, `TRANSITION_INSTANT`, and `TRANSITION_SLOW` (used only by the dead `revealFromBelow`) have zero external consumers. A separate `TRANSITION_SLOW` also exists in `@/lib/utils/animation/animationPresets.ts`, compounding the confusion about which timing-token module is canonical.
- **Root cause**: Tokens/variants scaffolded ahead of need and never adopted.
- **Impact**: Dead surface area plus a naming collision with the app-wide `animationPresets.ts` tokens — a future author can import the wrong `TRANSITION_SLOW` (number vs. transition object).
- **Fix sketch**: Delete `revealFromBelow`, `TRANSITION_INSTANT`, and `TRANSITION_SLOW` from this module (verify no dynamic use — these are static imports only). Longer term, consider folding the two remaining variants into `animationPresets.ts` so there is one timing-token module.

## 6. `MessageDetailModal` fetches all pending reviews for the persona and filters client-side per message
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: overfetch
- **File**: src/features/overview/sub_messages/components/MessageDetailModal.tsx:290
- **Scenario**: Opening a message (and every arrow-key navigation to the next message, and every approve/reject via `reloadReviews`) calls `listManualReviews(persona_id, 'pending')` — the full pending set for the persona — then keeps only rows matching one `execution_id` in JS.
- **Root cause**: No execution-scoped query variant is used; the linkage filter lives in the frontend.
- **Impact**: For personas with a large pending-review backlog, each modal open/navigation transfers and deserializes the whole list over Tauri IPC to display typically 0-2 rows. Bounded today, but it scales with backlog size and fires on a per-keypress navigation path (ArrowLeft/ArrowRight).
- **Fix sketch**: Add/reuse a `listManualReviewsByExecution(execution_id, status)` command (SQLite already indexes reviews by execution for the parallel `listMemoriesByExecution` pattern) and call that from `reloadReviews`; keep the client filter as a fallback only.
