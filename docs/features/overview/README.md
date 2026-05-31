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
| Activity / Executions | Global execution list and metrics. List columns are user-resizable. The metrics dashboard carries a **Business value** section (`ValueRollupSection.tsx`) above the cost-anomaly list: value-delivered rate, cost-per-value-delivered, and the per-window outcome distribution — derived from each run's `business_outcome` self-assessment via the `get_value_rollup` IPC command (simulations excluded). It answers "did these runs earn their cost", which raw execution counts can't. | `sub_activity/components/GlobalExecutionList.tsx`, `ExecutionRow.tsx`, `ExecutionMetricsDashboard.tsx`, `ValueRollupSection.tsx`, `useExecutionMetrics.ts` |
| Approvals | Manual review inbox, focused decision flow, bulk actions, triage player | `sub_manual-review` |
| Messages | Message list, thread/detail modal, read/delete/count behavior. Flat-view columns are user-resizable. | `sub_messages`, `commands/communication/messages.rs` |
| Events | Durable event log with search/filter and detail modal. Table columns are user-resizable. | `sub_events`, `commands/communication/events.rs` |
| Knowledge | Knowledge rows, graph dashboard, annotations | `sub_knowledge` |
| Health | Persona health cards, heartbeat, predictive alerts, burn-rate/cascade views | `sub_health` |
| Director | The Director coaching command center (relocated here from a top-level sidebar section). Thin subheader (scope + Brain memory toggle + add-to-scope + review-all), portfolio scorecard (value rate / avg verdict / cost-per-value / score distribution / model efficiency), and one coaching table consolidating Roster + Attention + Reviews — each starred agent row shows score · trend · value · attention tags, clicking opens a per-agent detail modal with full verdict history. See `docs/features/director/README.md`. | `sub_director` |
| Leaderboard | Persona rankings, podium, radar score details | `sub_leaderboard` |
| Certification | **Dev-only.** Read-only viewer over the team-autonomy eval/certification bundles in `docs/test/runs/` — per-team certification status, sortable run history, and per-run detail (dimensions, gates, standards compliance, grounding, trajectory, judge panel). Hidden from production builds. | `sub_certification`, `commands/eval_runs.rs` |

## Additional overview modules


The active tab comes from `useOverviewStore().overviewTab`. Sidebar-visible tabs are declared in `overviewItems` in `src/features/shared/components/layout/sidebar/sidebarData.ts`; some additional submodules exist for internal cards or development views.

## Visible tabs

| Tab | Behavior | Implementation |
| --- | --- | --- |
| Dashboard | Mission-control home (Triage / Vitals / activity Stream panes), summary widgets, knowledge/recent change/routine/fleet cards. The header persona selector scopes the success ring, traffic sparkline, Instruments traffic chart, and activity Stream to that persona — and highlights the persona's row in the Top Performers leaderboard when it ranks; the ring, sparkline and traffic chart use that persona's full-period metrics from `get_overview_bundle`. The KPI tiles and Triage counts stay fleet-wide and carry a **Fleet** tag. The Triage pane is a ranked work queue — open items are ordered by urgency (alerts → pipeline-sync failures → reviews → messages), the top item gets an accent and an "Up next" tag, and a header "Most urgent" button jumps straight to it. The bottom status strip's errors / runs / synced fields are click-through shortcuts to the Health, Executions, and Observability tabs. The activity Stream pane filters by execution status (All / Done / Failed / Running). The Instruments Traffic chart carries an inline 7d/30d/90d range switch (re-queries the dashboard window), and the Vitals "Runs" tile shows a recent-momentum trend arrow. A header **Customize** popover toggles visibility of the below-the-fold sections (Activity heatmap, Instruments, Memory suggestions, Fleet optimization, Routines & vault changes); the choice persists per device. | `components/dashboard/DashboardHomeMissionControl.tsx`, `components/dashboard/HomeCustomizePopover.tsx`, `cards/*`, `widgets/*` |
| Inbox | Unified triage view that aggregates pending items from four sources (manual-review approvals, unread messages, output artifacts, open healing issues) into Today / This Week / Snoozed / Resolved swimlanes. Keyboard triage (J/K move, Enter open, A approve, R reject/resolve, S snooze, X select, Esc clear), per-row chips, and a floating bulk-action toolbar. Snooze persists in localStorage; resolved is session-local. Reuses `useUnifiedInbox` from simple-mode for the source aggregation. | `sub_inbox/InboxTriagePage.tsx` plus `components/`, `hooks/`, `libs/` |
| Activity / Executions | Global execution list and metrics. List columns are user-resizable. The metrics dashboard carries a **Business value** section (`ValueRollupSection.tsx`) above the cost-anomaly list: value-delivered rate, cost-per-value-delivered, and the per-window outcome distribution — derived from each run's `business_outcome` self-assessment via the `get_value_rollup` IPC command (simulations excluded). It answers "did these runs earn their cost", which raw execution counts can't. | `sub_activity/components/GlobalExecutionList.tsx`, `ExecutionRow.tsx`, `ExecutionMetricsDashboard.tsx`, `ValueRollupSection.tsx`, `useExecutionMetrics.ts` |
| Approvals | Manual review inbox, focused decision flow, bulk actions, triage player. A header **Delete all** icon button (shown when there are reviews) hard-deletes every review after a danger confirm dialog (`delete_all_manual_reviews`; review messages cascade) — distinct from **Clear stale**, which only auto-resolves old *pending* reviews. A **Dev Tools backlog** group at the top (`BacklogInboxGroup`) surfaces pending scanned ideas across all projects (`dev_tools_list_pending_ideas`) for inline accept/reject (`dev_tools_accept_idea` / `dev_tools_reject_idea`, which persist + write a team learning memory), so reviews + backlog candidates are triaged in one place. | `sub_manual-review` |
| Messages | Message list, thread/detail modal, read/delete/count behavior. Flat-view columns are user-resizable. A header **Delete all** icon button (shown only when non-empty) hard-deletes every message after a danger confirm dialog (`delete_all_messages`; deliveries cascade) — for clearing test data. | `sub_messages`, `commands/communication/messages.rs` |
| Events | Durable event log with search/filter and detail modal. Table columns are user-resizable. | `sub_events`, `commands/communication/events.rs` |
| Knowledge | Knowledge rows, graph dashboard, annotations | `sub_knowledge` |
| Health | Persona health cards, heartbeat, predictive alerts, burn-rate/cascade views | `sub_health` |
| Director | The Director coaching command center (relocated here from a top-level sidebar section). Thin subheader (scope + Brain memory toggle + add-to-scope + review-all), portfolio scorecard (value rate / avg verdict / cost-per-value / score distribution / model efficiency), and one coaching table consolidating Roster + Attention + Reviews — each starred agent row shows score · trend · value · attention tags, clicking opens a per-agent detail modal with full verdict history. See `docs/features/director/README.md`. | `sub_director` |
| Leaderboard | Persona rankings, podium, radar score details | `sub_leaderboard` |

The module follows three primary navigation modes:

1. **Persona Monitor** (title-bar overlay) — the live fleet grid described above.
2. **Overview dashboard** (this page) — metrics, charts, and analytics.
3. **Manual review** — the human-in-the-loop approval queue.
4. **Memories** — the persona memory inspector described above.

| `sub_usage` | Usage charts, period comparison, tool usage pivoting |
| `sub_memories` | Memory list, conflict review, merge actions. The baseline list is a grid table with user-resizable columns. A **tier filter** (Active set / Core / Active / Working / Archived) gates what's shown — the default "Active set" view excludes archived memories; archived rows render muted with a badge + a **Restore** action (the Director archives duplicate/low-value memories via `tier='archive'`; see `docs/features/director/README.md` → Memory curation). |
| `sub_cron_agents` | Schedule-focused persona cards |
| `sub_analytics` | Rotation analytics helpers/panels, plus the GitHub-style 365-day **execution heatmap** (`ExecutionHeatmap.tsx`) embedded on the dashboard (fleet aggregate, respects the persona filter) and on each per-persona Activity tab. Backed by the `get_execution_heatmap` IPC command, which serves a 1-hour server-side cached daily aggregation plus derived insights (longest streak, dormant-since, peak day, week-over-week trend). Hovering a day cell shows its run count/cost in a cell-anchored floating tooltip (it no longer reflows a text line below the grid). |

The local source README at `src/features/overview/README.md` defines folder boundaries: realtime, persisted events, and observability are separate tiers and should not be mixed.

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

`UnifiedTable` (`src/features/shared/components/display/UnifiedTable.tsx`) is the golden-standard list/table primitive — it carries column sorting (click a header's arrow), dropdown filters, inline column search, optional virtual scrolling, resizable columns, zebra rows, and a sticky header. Overview tables are converging onto it so they share one look and one set of behaviors. Props worth knowing: `density` (`comfortable` default / `compact` for data-dense panels), `rowAccent(row)` for a per-row status-accent left border (the running/failed markers on the Activity list — now used across Events, Messages, Memories, IPC, Rotation, Incidents, and System Trace), `stickyHeader` (default on), `borderless` (drop the card border when embedding inside another card), `ariaLabel` (sets `role="table"`), and `defaultSortKey`/`defaultSortDir` (open on a meaningful sort). When a `tableId` is set the active sort is also persisted to `localStorage` under `table-sort:<tableId>` (alongside the `table-col-widths:<tableId>` resize state), so a user's chosen column/direction survives reload. The **Tool Performance** panel (`sub_usage/ToolPerformancePanel.tsx`) and the **IPC Performance** panel's by-command and slowest-calls tabs (`sub_observability/IpcPerformancePanel.tsx`) use it, so every column there is now click-to-sort. Tool Performance also filters by tool type (the column header's filter dropdown), and the IPC by-command tab filters by p95 latency band (`< 50 ms` / `50–200 ms` / `200 ms – 1 s` / `≥ 1 s`).

## Data source boundaries

Overview has three event-related tiers:

- `sub_realtime`: in-memory/live event bus, answering "what is happening now?"
- `sub_events`: persisted `PersonaEvent` rows, answering "what happened and can I search it?"
- `sub_observability`: traces, healing, alerts, and metrics, answering "why did it happen and how do I fix it?"

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
