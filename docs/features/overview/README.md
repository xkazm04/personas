# Overview

Overview is the operational dashboard for what the system is doing: executions, approvals, messages, durable events, knowledge, health, leaderboard scoring, incidents, observability, SLA, and usage.

## Page host

`src/features/overview/components/dashboard/OverviewPage.tsx` is the page host. It wraps all overview tabs in `OverviewFilterProvider`, starts `useExecutionDashboardPipeline()`, and lazy-loads each major tab inside an `ErrorBoundary`.

The active tab comes from `useOverviewStore().overviewTab`. Sidebar-visible tabs are declared in `overviewItems` in `src/features/shared/components/layout/sidebar/sidebarData.ts`; some additional submodules exist for internal cards or development views.

## Visible tabs

| Tab | Behavior | Implementation |
| --- | --- | --- |
| Mission control | Mission-control home (Triage / Vitals / activity Stream panes), summary widgets, knowledge/recent change/routine/fleet cards. (The L2 sidebar tab reads "Mission control"; it remains the overview root, `overviewTab === 'home'`.) The header persona selector scopes the success ring, traffic sparkline, Instruments traffic chart, and activity Stream to that persona — and highlights the persona's row in the Top Performers leaderboard when it ranks; the ring, sparkline and traffic chart use that persona's full-period metrics from `get_overview_bundle`. The KPI tiles and Triage counts stay fleet-wide and carry a **Fleet** tag. The Triage pane is a ranked work queue — open items are ordered by urgency (alerts → pipeline-sync failures → reviews → messages), the top item gets an accent and an "Up next" tag, and a header "Most urgent" button jumps straight to it. The bottom status strip's errors / runs / synced fields are click-through shortcuts to the Health, Executions, and Observability tabs. The activity Stream pane filters by execution status (All / Done / Failed / Running). The Instruments Traffic chart carries an inline 7d/30d/90d range switch (re-queries the dashboard window), and the Vitals "Runs" tile shows a recent-momentum trend arrow. **Fleet optimization** sits directly under the header (its single highest-priority recommendation), with per-recommendation **Open Lab** (jump into the affected agent's Lab in model-comparison/matrix mode to test alternative models) and **Ask Athena** (forward the suggestion to the companion so Athena can investigate and drive the Lab herself) actions; it replaced the resume-tour panel that used to live there. **Upcoming Routines** lists only genuinely-upcoming runs (a next-run time in the future, or pending first run) — stale past/overdue rows are dropped. A header **Customize** popover toggles visibility of Fleet optimization plus the below-the-fold sections (Activity heatmap, Instruments, Memory suggestions, Routines & vault changes); the choice persists per device. | `sub_missionControl/DashboardHomeMissionControl.tsx`, `sub_missionControl/cards/*`, `components/dashboard/HomeCustomizePopover.tsx`, `components/dashboard/widgets/*` |
| Inbox | Unified triage view that aggregates pending items from four sources (manual-review approvals, unread messages, output artifacts, open healing issues) into Today / This Week / Snoozed / Resolved swimlanes. Keyboard triage (J/K move, Enter open, A approve, R reject/resolve, S snooze, X select, Esc clear), per-row chips, and a floating bulk-action toolbar. Snooze persists in localStorage; resolved is session-local. Reuses `useUnifiedInbox` from simple-mode for the source aggregation. | `sub_inbox/InboxTriagePage.tsx` plus `components/`, `hooks/`, `libs/` |
| Activity / Executions | Global execution list and metrics. List columns are user-resizable. A **Model** column shows which model ran each execution (shortened id — `sonnet-4`, `gemma4`; hover for the full id) and its header is a per-model dropdown filter over the loaded rows; when a run didn't record `model_used` the column falls back to the persona's configured model (`model_profile`) so it isn't perpetually blank (`—` only when neither is known). A **Cost** column shows each run's `cost_usd` as locale-aware currency (`—` when zero/unknown). The execution detail modal's status bar carries the same model chip; its Message view shows a **provenance badge** on the agent's report (`UserMessageCard` + `ExecutionDetailModal/provenance.ts`) — green "N sources" when the report appends a `## Sources` section you can audit, muted-amber "Unsourced" when it carries figures but no sources (UAT P7 F-NO-PROVENANCE). The metrics dashboard carries a **Business value** section (`ValueRollupSection.tsx`) above the cost-anomaly list: value-delivered rate, cost-per-value-delivered, and the per-window outcome distribution — derived from each run's `business_outcome` self-assessment via the `get_value_rollup` IPC command (simulations excluded). It answers "did these runs earn their cost", which raw execution counts can't. Below the fleet KPI cards an **Athena** lane (`AthenaUsageSection.tsx`) surfaces the assistant's *own* spend for the same window — turns, cost, tokens, avg cost/turn — broken down by action type (chat vs proactive vs headless triage) and compared against fleet spend, from the `companion_get_usage_dashboard` IPC command (direction 6 auditability; data from the `companion_turn` ledger). | `sub_activity/components/GlobalExecutionList.tsx`, `ExecutionRow.tsx`, `ExecutionMetricsDashboard.tsx`, `ValueRollupSection.tsx`, `AthenaUsageSection.tsx`, `useExecutionMetrics.ts`, `useAthenaUsage.ts` |
| Approvals | Manual review inbox, focused decision flow, bulk actions, triage player | `sub_manual-review` |
| Messages | Message list + detail modal, read/delete/count behavior. A single flat list (the threaded view was removed) with resizable, filterable columns; the persona-icon fallback shows initials rather than a generic robot. The detail modal renders both the message body and the linked pending-decision prose through the same Markdown renderer. | `sub_messages`, `commands/communication/messages.rs` |
| Events | Durable event log with search/filter and detail modal. Table columns are user-resizable. | `sub_events`, `commands/communication/events.rs` |
| Knowledge | A three-way **Memories · Patterns · Graph** subtab nav. **Memories** is the persona memory inspector — a dense, sortable KPI-strip + matrix layout (the former Baseline list and the prototype variant switcher were retired 2026-06-17); **Graph** is an SVG cluster view of the same memories grouped by category; **Patterns** is the execution-extracted knowledge graph (tool sequences, failure patterns, model insights, annotations) — restored to the UI via `KnowledgeHub` after a refactor had orphaned it. Its summary KPI tiles double as one-click type filters (Total clears the filter), and the type filter applies to the default fleet-wide view too. Patterns are free-text searchable (pattern key / annotation text) and sortable by confidence, run count, or recency. A **Needs review** spotlight badge (count from `summary.unverified_annotation_count`) appears when annotations await verification and toggles a filter down to those pending annotations. | `components/dashboard/cards/KnowledgeHub.tsx`, `sub_memories`, `sub_knowledge` |
| Health | Persona health as a space-efficient **Vitals Ledger** table (one persona per row, thin composite heartbeat bar, healthy personas hidden by default to focus on issues; expand a row for the segmented success/healing/stability/budget breakdown) over a unified insight band (predictive alerts, burn-rate, cascade chains). Header toggles to Status-page and SLA-reliability views. | `sub_health`, `sub_health/components/heartbeats` |
| Director | The Director coaching command center (relocated here from a top-level sidebar section). Thin subheader (scope + Brain memory toggle + add-to-scope + review-all + 7/30/90-day period selector), portfolio scorecard (value rate + a delivered/partial/blocked/no-input value-breakdown bar / avg verdict / cost-per-value / score distribution with a portfolio-average marker / model efficiency / issues-by-category rollup), and one coaching table with a portfolio attention-triage bar whose chips — plus the score-distribution bars — click-to-filter the roster; each starred agent row shows score · trend · value · attention tags, clicking opens a per-agent detail modal with category-tagged verdict history. See `docs/features/director/README.md`. | `sub_director` |
| Leaderboard | Persona rankings as a **scorecard matrix** — one row per persona, one column per metric (Overall composite + five weighted dimensions: Success, Health, Speed, Cost, Activity). Each cell pairs the normalized 0–100 score (heatmap-tinted, with a within-tier magnitude bar) with a ≤1-decimal raw measurement (success %, latency, $/run, runs/7d) or a qualitative grade where the raw would just echo the score (Overall→tier, Health→grade). Click any column header to sort the whole board by that metric; a dashed **fleet-average** row anchors the bottom as a benchmark and a colour legend keys the tiers. If every agent shares the same Speed value the column flags itself `tied` (a known per-persona-latency mapping gap — latency is currently aggregated fleet-wide). Empty/single-agent states keep the radar view. | `sub_leaderboard` |
| Certification | **Dev-only.** Read-only viewer over the team-autonomy eval/certification bundles in `docs/test/runs/` — per-team certification status, sortable run history, and per-run detail (dimensions, gates, standards compliance, grounding, trajectory, judge panel). Hidden from production builds. | `sub_certification`, `commands/eval_runs.rs` |

### Incidents inbox (`sub_incidents`)

The Incidents tab is a cross-source triage inbox: failure-shaped rows from seven audit streams (alerts, tool errors, credential failures, healing misses, provider failovers, policy drops, healing issues) are promoted into one `open → acknowledged → in_progress → resolved/dismissed` list. It is written to read for **non-technical users**:

- **Rows are a compact one-row-per-incident table.** Each incident is a single scannable row with its own columns — Incident (title), Persona, State, Days (age), Actions — built on the shared Overview table primitives (`IncidentTableHeader` + `ColumnResize` / `PersonaColumnFilter` / `ColumnDropdownFilter` / `SortableColumnHeader`, the same kit as Activity and Events). The Persona and State columns filter in-header and the Days column sorts in-header; the row click opens the detail modal. The full `detail` payload (prose, `key=value` fragments, JSON) lives in that modal, normalized by `libs/incidentDetail.ts`. The column layout is shared via `libs/incidentColumns.ts`.
- **The detail modal breaks JSON down** into a labelled fact grid (`IncidentDetailBreakdown.tsx`), with the original JSON behind a collapsed "raw data" toggle for power users (reuses `sub_events/HighlightedJson`).
- **Severity survives without colour** — instead of a priority text tag, each row carries a colour-blind-safe `StatusShape` glyph (a distinct shape per tier) + a severity-tinted source glyph + the row's left gutter accent. The shape's tooltip holds the plain-language urgency framing ("Needs attention now / Important / Worth a look / Minor"), and the Critical KPI tile leads with the same framing when any critical incident is open. (The standalone always-visible urgency legend was removed — the per-row shape carries it; severity is filtered from the slim severity dropdown.)
- **Incidents group by a switchable lens** (`libs/groupIncidents.ts`, `IncidentAgentGroup.tsx`) — by agent ("which of my agents needs me?"), by severity ("what's most urgent?"), by source ("what kind of thing is failing?"), or a flat recency list. A group-by toggle in the list toolbar drives all four; groups are collapsible and ordered worst-severity-first (the agent-less "No agent" bucket sorts last), each header a single collapse toggle.
- **Filters are compact dropdowns** — status, severity, source, and time are single-select dropdowns built on the shared themed `ColumnDropdownFilter` (replacing the earlier wall of chips so the bar reads at a glance); severity and source resolve through `tokenLabel` / `sourceTableLabel`, so a user filters by "Critical" or "Tool", not `tool_execution_audit_log`.
- **Each incident says what to do** — the detail modal leads with a guidance callout keyed off the source stream (`incidentGuidance` → `tool` / `credential` / `provider` / …). Resolving offers one-tap note presets ("Fixed", "Transient — ignored", …), and closed rows show their resolution note inline as a recap. Fact values render smartly (timestamps → relative time, URLs as links, per-fact copy).
- **The inbox remembers how you left it** — collapse-all / expand-all plus per-group collapse state, the active group-by lens, the Days-column sort, and the stable filter view (status / severity / source) all persist to `localStorage` (`incidents:collapsed-groups`, `:group-mode`, `:oldest-first`, `:filters`). Transient `since` / per-agent filters are intentionally not persisted, so the inbox never reopens into a stale or surprising deep-filter. Per-group headers stay sticky while scrolling.
- **Navigable by keyboard and time** — keyboard triage (j/k move, Enter open, A acknowledge, R resolve, Esc clear) over the visible rows, announced to screen readers via a polite aria-live region, and an "All time / Last 24 hours / Last 7 days" time-range dropdown wired to the `since` filter.
- **The KPI header is a control surface** — the Open / Critical / Acked / Resolved tiles (`IncidentsInboxKpiHeader.tsx`) are buttons that jump the inbox to exactly the slice each counts; the matching tile stays lit. (The severity-distribution bar and its `High 2 / Medium 7` legend were removed — severity now reads per-row and filters from the slim severity dropdown.)
- **Reset in one click** — each filter dropdown carries its own clear, and a single "Clear filters" button appears once the view is narrowed past the resting open-only state (`IncidentsFilterBar.tsx`).
- **Triage a cluster in context** — the detail modal lists the agent's other still-active incidents as a clickable list (selecting one swaps the modal to it), plus a "View all from this agent" action that filters the whole inbox to that agent.
- **New since your last visit** — leaving the inbox stamps a last-seen time; on return, a "N new since your last visit" marker highlights freshly-arrived incidents with a Mark-seen action.
- **Nothing rots unseen** — active incidents open past three days carry a "Stale" tag and amber age, and the sortable **Days** column reorders incidents within each group so the longest-waiting work can be pulled to the top.

## Additional overview modules


The active tab comes from `useOverviewStore().overviewTab`. Sidebar-visible tabs are declared in `overviewItems` in `src/features/shared/components/layout/sidebar/sidebarData.ts`; some additional submodules exist for internal cards or development views.

## Visible tabs

| Tab | Behavior | Implementation |
| --- | --- | --- |
| Dashboard | Mission-control home (Triage / Vitals / activity Stream panes), summary widgets, knowledge/recent change/routine/fleet cards. The header persona selector scopes the success ring, traffic sparkline, Instruments traffic chart, and activity Stream to that persona — and highlights the persona's row in the Top Performers leaderboard when it ranks; the ring, sparkline and traffic chart use that persona's full-period metrics from `get_overview_bundle`. The KPI tiles and Triage counts stay fleet-wide and carry a **Fleet** tag. The Triage pane is a ranked work queue — open items are ordered by urgency (alerts → pipeline-sync failures → reviews → messages), the top item gets an accent and an "Up next" tag, and a header "Most urgent" button jumps straight to it. The bottom status strip's errors / runs / synced fields are click-through shortcuts to the Health, Executions, and Observability tabs. The activity Stream pane filters by execution status (All / Done / Failed / Running). The Instruments Traffic chart carries an inline 7d/30d/90d range switch (re-queries the dashboard window), and the Vitals "Runs" tile shows a recent-momentum trend arrow. A header **Customize** popover toggles visibility of the below-the-fold sections (Activity heatmap, Instruments, Memory suggestions, Fleet optimization, Routines & vault changes); the choice persists per device. | `components/dashboard/DashboardHomeMissionControl.tsx`, `components/dashboard/HomeCustomizePopover.tsx`, `cards/*`, `widgets/*` |
| Inbox | Unified triage view that aggregates pending items from four sources (manual-review approvals, unread messages, output artifacts, open healing issues) into Today / This Week / Snoozed / Resolved swimlanes. Keyboard triage (J/K move, Enter open, A approve, R reject/resolve, S snooze, X select, Esc clear), per-row chips, and a floating bulk-action toolbar. Snooze persists in localStorage; resolved is session-local. Reuses `useUnifiedInbox` from simple-mode for the source aggregation. | `sub_inbox/InboxTriagePage.tsx` plus `components/`, `hooks/`, `libs/` |
| Activity / Executions | Global execution list and metrics. List columns are user-resizable. A **Model** column shows which model ran each execution (shortened id — `sonnet-4`, `gemma4`; hover for the full id) and its header is a per-model dropdown filter over the loaded rows; when a run didn't record `model_used` the column falls back to the persona's configured model (`model_profile`) so it isn't perpetually blank (`—` only when neither is known). A **Cost** column shows each run's `cost_usd` as locale-aware currency (`—` when zero/unknown). The execution detail modal's status bar carries the same model chip; its Message view shows a **provenance badge** on the agent's report (`UserMessageCard` + `ExecutionDetailModal/provenance.ts`) — green "N sources" when the report appends a `## Sources` section you can audit, muted-amber "Unsourced" when it carries figures but no sources (UAT P7 F-NO-PROVENANCE). The metrics dashboard carries a **Business value** section (`ValueRollupSection.tsx`) above the cost-anomaly list: value-delivered rate, cost-per-value-delivered, and the per-window outcome distribution — derived from each run's `business_outcome` self-assessment via the `get_value_rollup` IPC command (simulations excluded). It answers "did these runs earn their cost", which raw execution counts can't. Below the fleet KPI cards an **Athena** lane (`AthenaUsageSection.tsx`) surfaces the assistant's *own* spend for the same window — turns, cost, tokens, avg cost/turn — broken down by action type (chat vs proactive vs headless triage) and compared against fleet spend, from the `companion_get_usage_dashboard` IPC command (direction 6 auditability; data from the `companion_turn` ledger). | `sub_activity/components/GlobalExecutionList.tsx`, `ExecutionRow.tsx`, `ExecutionMetricsDashboard.tsx`, `ValueRollupSection.tsx`, `AthenaUsageSection.tsx`, `useExecutionMetrics.ts`, `useAthenaUsage.ts` |
| Approvals | Manual review inbox, focused decision flow, bulk actions, triage player. A header **Delete all** icon button (shown when there are reviews) hard-deletes every review after a danger confirm dialog (`delete_all_manual_reviews`; review messages cascade) — distinct from **Clear stale**, which only auto-resolves old *pending* reviews. A **Dev Tools backlog** group at the top (`BacklogInboxGroup`) surfaces pending scanned ideas across all projects (`dev_tools_list_pending_ideas`) for inline accept/reject (`dev_tools_accept_idea` / `dev_tools_reject_idea`, which persist + write a team learning memory), so reviews + backlog candidates are triaged in one place. Reviews that a capability's `review_policy` resolved automatically (`trust_llm` / `auto_triage`) now carry an amber **Auto-resolved** badge on the row and in the detail header (`AutoResolvedBadge`, detected from the backend's `reviewer_notes` markers), with a banner naming the policy + the auto_triage evaluator's reasoning — so the silent bypass of the human queue is visible (UAT P5 F-NO-CONFIDENCE-AUTORESOLVE). | `sub_manual-review` |
| Messages | Message list + detail modal, read/delete/count behavior. A single flat list (the threaded view was removed) with resizable, filterable columns; the persona-icon fallback shows initials. A header **Delete all** icon button (shown only when non-empty) hard-deletes every message after a danger confirm dialog (`delete_all_messages`; deliveries cascade) — for clearing test data. | `sub_messages`, `commands/communication/messages.rs` |
| Events | Durable event log with search/filter and detail modal. Table columns are user-resizable. | `sub_events`, `commands/communication/events.rs` |
| Knowledge | A three-way **Memories · Patterns · Graph** subtab nav. **Memories** is the persona memory inspector — a dense, sortable KPI-strip + matrix layout (the former Baseline list and the prototype variant switcher were retired 2026-06-17); **Graph** is an SVG cluster view of the same memories grouped by category; **Patterns** is the execution-extracted knowledge graph (tool sequences, failure patterns, model insights, annotations) — restored to the UI via `KnowledgeHub` after a refactor had orphaned it. Its summary KPI tiles double as one-click type filters (Total clears the filter), and the type filter applies to the default fleet-wide view too. Patterns are free-text searchable (pattern key / annotation text) and sortable by confidence, run count, or recency. A **Needs review** spotlight badge (count from `summary.unverified_annotation_count`) appears when annotations await verification and toggles a filter down to those pending annotations. | `components/dashboard/cards/KnowledgeHub.tsx`, `sub_memories`, `sub_knowledge` |
| Health | Persona health as a space-efficient **Vitals Ledger** table (one persona per row, thin composite heartbeat bar, healthy personas hidden by default to focus on issues; expand a row for the segmented success/healing/stability/budget breakdown) over a unified insight band (predictive alerts, burn-rate, cascade chains). Header toggles to Status-page and SLA-reliability views. | `sub_health`, `sub_health/components/heartbeats` |
| Director | The Director coaching command center (relocated here from a top-level sidebar section). Thin subheader (scope + Brain memory toggle + add-to-scope + review-all + 7/30/90-day period selector), portfolio scorecard (value rate + a delivered/partial/blocked/no-input value-breakdown bar / avg verdict / cost-per-value / score distribution with a portfolio-average marker / model efficiency / issues-by-category rollup), and one coaching table with a portfolio attention-triage bar whose chips — plus the score-distribution bars — click-to-filter the roster; each starred agent row shows score · trend · value · attention tags, clicking opens a per-agent detail modal with category-tagged verdict history. See `docs/features/director/README.md`. | `sub_director` |
| Leaderboard | Persona rankings as a **scorecard matrix** — one row per persona, one column per metric (Overall composite + five weighted dimensions: Success, Health, Speed, Cost, Activity). Each cell pairs the normalized 0–100 score (heatmap-tinted, with a within-tier magnitude bar) with a ≤1-decimal raw measurement (success %, latency, $/run, runs/7d) or a qualitative grade where the raw would just echo the score (Overall→tier, Health→grade). Click any column header to sort the whole board by that metric; a dashed **fleet-average** row anchors the bottom as a benchmark and a colour legend keys the tiers. If every agent shares the same Speed value the column flags itself `tied` (a known per-persona-latency mapping gap — latency is currently aggregated fleet-wide). Empty/single-agent states keep the radar view. | `sub_leaderboard` |

The module follows three primary navigation modes:

1. **Persona Monitor** (title-bar overlay) — the live fleet grid described above.
2. **Overview dashboard** (this page) — metrics, charts, and analytics.
3. **Manual review** — the human-in-the-loop approval queue.
4. **Memories** — the persona memory inspector described above.

| `sub_usage` | Usage charts, period comparison, tool usage pivoting |
| `sub_memories` | Memory list, conflict review, merge actions. The baseline list is a grid table with user-resizable columns. A **tier filter** (Active set / Core / Active / Working / Archived) gates what's shown — the default "Active set" view excludes archived memories; archived rows render muted with a badge + a **Restore** action (the Director archives duplicate/low-value memories via `tier='archive'`; see `docs/features/director/README.md` → Memory curation). A header **Delete all** icon button (shown only when non-empty) clears memories after a danger confirm dialog (`delete_all_memories`) — for clearing test data. **It deliberately preserves the user-pinned `core` tier**: `delete_all` runs `DELETE … WHERE tier != 'core'`, so a single click can never wipe the authoritative identity memories the MEMORY CONTRACT says only the user may remove one at a time (mirrors how `archive_by_ids` and run-lifecycle GC keep core). |
| `sub_cron_agents` | Schedule-focused persona cards |
| `sub_analytics` | Rotation analytics helpers/panels, plus the GitHub-style 365-day **execution heatmap** (`ExecutionHeatmap.tsx`) embedded on the dashboard (fleet aggregate, respects the persona filter) and on each per-persona Activity tab. Backed by the `get_execution_heatmap` IPC command, which serves a 1-hour server-side cached daily aggregation plus derived insights (longest streak, dormant-since, peak day, week-over-week trend). Hovering a day cell shows its run count/cost in a cell-anchored floating tooltip (it no longer reflows a text line below the grid). |

The local source README at `src/features/overview/README.md` defines folder boundaries: realtime, persisted events, and observability are separate tiers and should not be mixed.

## Quick Answer popover (title-bar)

The title-bar attention button (`ProcessActivityIndicator`) is **split** so the user never has to navigate back to a draft just to unblock it. When something needs a direct answer — a build/adoption persona is waiting on a question, or a human review is pending — clicking it opens the lightweight **Quick Answer** popover (`src/features/shared/components/layout/quick-answer/`) so the user can respond and keep working wherever they are. When the only attention left is drafts-ready / unread messages (or nothing), the click opens the full-screen Persona Monitor instead; the popover also links back to it, so both stay reachable.

- **Pending questions** are read live from `matrixBuildSlice.buildSessions` — the single source of truth — so a question raised while the user is on another screen still surfaces, and the badge count no longer depends on the matrix surface being mounted (it neither undercounts when the user is elsewhere nor double-counts the `input_required` process the matrix pushes while mounted). Simple questions (options / free-text) are answered inline and batch-submitted through the route-independent `answerBuildQuestion` IPC (the escaping/batch payload is shared with the matrix surface via `src/lib/build/answerPayload.ts`). Complex questions (connector picker, file/URL attachment, webhook source) deep-link to the builder.
- **Human reviews** reuse the Monitor's `useMonitorData` (local + cloud) for inline approve/reject.
- The badge counts pending questions + pending reviews + unread messages + drafts-ready. Live work (`running`) shows as a pulsing ring, not a count.

## Footer system-load gauge

The footer's bottom-right cluster shows a small **system-load gauge** (`SystemLoadFooterIcon`) — a CPU icon plus two thin bars (CPU on top, used-RAM below) tinted green / amber / red. It is a *soft, advisory* signal answering **"does this machine have headroom for more local work?"** — a cue to orchestrate more agents or ease off. It is intentionally **not** coupled to the concurrency/rate limits, because host load is influenced by every other process on the PC; treat it as a hint, never a hard gate.

- **Backend**: the `get_system_metrics` IPC command (`src-tauri/src/commands/infrastructure/system_metrics.rs`) samples host CPU% + memory via the `sysinfo` crate from one persistent `System` (CPU usage + memory only — never enumerates processes). It returns raw numbers and a `sampleValid` flag (CPU% needs two samples to be meaningful).
- **Frontend**: polls every ~2s while the window is visible, then EMA-smooths and applies a green/amber/red **hysteresis** band so the gauge doesn't flicker at a cusp — all in the pure, unit-tested `systemLoad.ts`. Hovering shows exact numbers (`CPU 42% · RAM 61% (6.1 GB free)`) plus the headroom hint.
- Memory headroom uses **available** RAM (reclaimable-cache-aware), not free RAM. Most valuable in `desktop-full` builds where local embedding/ONNX compute actually consumes CPU/RAM.

## Resizable table columns

The Events, Activity, Messages, and Memories tables support drag-to-resize columns. The shared primitive is `src/features/shared/components/display/ColumnResize.tsx` — `useColumnWidths(tableId)` holds per-table px overrides and `ColumnResizeHandle` is the divider rendered on each column header's right edge. Drag a divider to resize; double-click it to restore the default width. Overrides persist to `localStorage` under `table-col-widths:<tableId>` (`overview-events`, `overview-activity`, `overview-messages`, `overview-memories`). `UnifiedTable` enables this whenever a `tableId` prop is passed; the custom grid tables in Activity, Messages, and the Memories baseline view wire the hook directly. The Memories table header and each `MemoryRow` share one grid template so columns stay aligned. Knowledge's annotation view is an expandable card list (not a column grid) and is intentionally excluded.

## Sticky group headers

The **Activity / Executions**, **Events**, and **Memories** lists bucket their (chronologically ordered) rows under sticky date headers — **Today / Yesterday / This week / This month / Older** — so you can orient by time instead of scanning timestamps row-by-row (the wayfinding Gmail and Linear use). The active group's header stays pinned to the top of the list while its bucket scrolls.

The shared primitive is `src/features/shared/components/display/GroupedVirtualList.tsx`, built on the existing TanStack virtualizer so it stays smooth at 1000+ rows. Pure bucketing/flattening helpers live alongside it in `grouping.ts` (`timeGroupKey`, `timeGroupLabels`, `buildGroupRows` — a consecutive-run group-by that makes no global-sort assumption). Activity and the Memories baseline view (custom grid lists) render `GroupedVirtualList` directly; the Events log opts in through `UnifiedTable`'s additive `groupBy` prop, which routes to an isolated `GroupedTableBody` that reuses the same grouping core — so tables that don't pass `groupBy` are unchanged. Grouping runs over the already-sorted rows, so it composes with the resizable-column sort and the per-list scroll-position restoration.

## Shared table standard (`UnifiedTable`)

`UnifiedTable` (`src/features/shared/components/display/UnifiedTable.tsx`) is the golden-standard list/table primitive — it carries column sorting (click a header's arrow), dropdown filters, inline column search, optional virtual scrolling, resizable columns, zebra rows, and a sticky header. Overview tables are converging onto it so they share one look and one set of behaviors. Props worth knowing: `density` (`comfortable` default / `compact` for data-dense panels), `rowAccent(row)` for a per-row status-accent left border (the running/failed markers on the Activity list — now used across Events, Messages, Memories, IPC, Rotation, Incidents, and System Trace), `stickyHeader` (default on), `borderless` (drop the card border when embedding inside another card), `ariaLabel` (sets `role="table"`), `defaultSortKey`/`defaultSortDir` (open on a meaningful sort), and `onEndReached` (infinite scroll — fires when the table's own virtualized scroll container nears the bottom; the **Events** log wires it to fetch older events as you scroll, which replaced the old manual "load older" button). When a `tableId` is set the active sort is also persisted to `localStorage` under `table-sort:<tableId>` (alongside the `table-col-widths:<tableId>` resize state), so a user's chosen column/direction survives reload. The **Tool Performance** panel (`sub_usage/ToolPerformancePanel.tsx`) and the **IPC Performance** panel's by-command and slowest-calls tabs (`sub_observability/IpcPerformancePanel.tsx`) use it, so every column there is now click-to-sort. Tool Performance also filters by tool type (the column header's filter dropdown), and the IPC by-command tab filters by p95 latency band (`< 50 ms` / `50–200 ms` / `200 ms – 1 s` / `≥ 1 s`).

## Data source boundaries

Overview has three event-related tiers:

- `sub_realtime`: in-memory/live event bus, answering "what is happening now?"
- `sub_events`: persisted `PersonaEvent` rows, answering "what happened and can I search it?"
- `sub_observability`: traces, healing, alerts, and metrics, answering "why did it happen and how do I fix it?" Carries the **Athena health** panel (`AthenaHealthPanel.tsx`, fed by `companion_get_health` via `useAthenaHealth.ts`) — Athena's operational quality rather than spend: the triage funnel (drop / digest / attention / deep-dive + parse failures — is the signal economy filtering?), the proactive economy (delivered / engaged / dismissed + engaged-rate + budget), and job/turn-error health (direction 6 auditability). Alerting on Athena-specific metric keys is a deferred follow-up.

New panels should pick the narrowest existing submodule. Do not render trace trees from realtime events; use the trace engine and `sub_observability` helpers.

## Backend dependencies

Overview reads from:

- Execution commands and repositories for activity, traces, cost, status, and cancellation.
- Communication commands for events, messages, observability alerts, prompt lab, digest, and SLA.
- Core memory/knowledge commands for memories and knowledge dashboards.
- Notification helpers for delivery stats and channel tests.

Feature-specific contracts remain in [execution](../execution/README.md), [events](../events/README.md), and [personas](../personas/README.md).

## Certification Command Center (dev-only)

`sub_certification` is a **read-only viewer** over the team-autonomy
evaluation/certification framework's on-disk bundles. The eval logic stays in
the host-side CLI harness (`scripts/test/`) — which needs git, `npm
build/lint/test`, and the test-automation bridge — and writes immutable JSON
bundles to `docs/test/runs/<runId>/`. This tab only *reads* those bundles; it
never runs an eval. The bundle JSON is the shared contract between the CLI
writer and the Rust reader.

**Three views** (`sub_certification/CertificationCommandCenter.tsx`):
- **Overview** — one `TeamCertCard` per team: a 3-pip certification streak, the
  latest verdict, and a verdict-distribution bar over the team's held-out runs.
- **Run History** — a sortable `UnifiedTable` of every run (verdict, score,
  gate markers, started-at). Click a row to drill in.
- **Detail** — deterministic dimensions, build/lint/test gates + delivered
  increment, **standards & branching compliance** (§7 — on code-track runs whose
  bound project declares a `standards_config` policy: a per-rule pass/fail
  breakdown of the pre-commit gates + branch-base flow the team was told to
  honor, with an overall compliance %), citation grounding, score trajectory,
  and (when scored) the LLM-judge panel.

**Three commands** (`src-tauri/src/commands/eval_runs.rs` — unauthenticated,
filesystem-only reads, acceptable because the surface is dev-only):
- `list_eval_runs` → run summaries, newest first.
- `get_cert_status` → per-team streak / `certified` flag / verdict counts.
- `get_eval_run(runId)` → full per-run detail (reads only `scorecard.json` +
  `run.json`, plus cheap same-team summaries for the trajectory; never the
  large `executions.json` / `events.json` / `repo.patch`).

**Source resolution:** `PERSONAS_EVAL_RUNS_DIR` env → `docs/test/runs` (dev cwd
= repo root) → walk up from the executable. No directory found → an empty
state. **Certification rule:** a team is *certified* after **3 consecutive
PRODUCTION verdicts on held-out seeds** (the streak is capped at 3).

The tab is gated `devOnly` in the sidebar and is not present in packaged
installers.

## Progressive loading (no big-bang tables)

Overview tables that can hold 100–1000+ rows (Messages, Human Review,
Knowledge) render **frame-first** and fill in over a short window instead of
blocking on one large render:

- **`ListSkeleton`** (`shared/components/layout`) — the panel's `ContentHeader`
  paints immediately and shimmer rows fill the body while the first page loads;
  no full-panel spinner that hides the chrome.
- **`useProgressiveReveal(total, { resetKey, initialCount })`**
  (`hooks/utility/interaction`) — hands already-fetched rows to the (virtualized)
  list in time-spread chunks sized so any list length settles in ≈2s. Slice the
  data to `reveal.count` before feeding `useVirtualList`. Resets on filter/view
  change; chases realtime arrivals and "load more" pages. An `aria-hidden`
  `AnimatedCounter` "n / total" pill shows the fill resolving.
- **Per-item entrance (`RevealItem` + `useRevealTracker`).** Each row fades in
  individually with a small staggered delay (`order = index - reveal.newSince`)
  as it enters, rather than a whole chunk appearing at once. Entry is tracked
  per row id, so scrolling a virtualized list never replays the fade; the
  cascade replays on a filter/view change.
- `prefers-reduced-motion` and off-screen tabs reveal everything instantly.

This complements the **L0/L1/L2 layered fetch** (`useLayeredList`,
`docs/architecture/overview-layered-fetch.md`): layered fetch bounds how much
data is *loaded*; progressive reveal bounds how fast loaded rows are *mounted*.
