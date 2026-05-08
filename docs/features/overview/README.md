# Overview

Overview is the operational dashboard for what the system is doing: executions, approvals, messages, durable events, knowledge, health, leaderboard scoring, incidents, observability, SLA, and usage.

## Page host

`src/features/overview/components/dashboard/OverviewPage.tsx` is the page host. It wraps all overview tabs in `OverviewFilterProvider`, starts `useExecutionDashboardPipeline()`, and lazy-loads each major tab inside an `ErrorBoundary`.

The active tab comes from `useOverviewStore().overviewTab`. Sidebar-visible tabs are declared in `overviewItems` in `src/features/shared/components/layout/sidebar/sidebarData.ts`; some additional submodules exist for internal cards or development views.

## Visible tabs

| Tab | Behavior | Implementation |
| --- | --- | --- |
| Dashboard | Mission-control home, summary widgets, knowledge/recent change/routine/fleet cards | `components/dashboard/DashboardHome.tsx`, `cards/*`, `widgets/*` |
| Activity / Executions | Global execution list and metrics | `sub_activity/components/GlobalExecutionList.tsx`, `ExecutionRow.tsx`, `useExecutionMetrics.ts` |
| Approvals | Manual review inbox, focused decision flow, bulk actions, triage player | `sub_manual-review` |
| Messages | Message list, thread/detail modal, read/delete/count behavior | `sub_messages`, `commands/communication/messages.rs` |
| Events | Durable event log with search/filter and detail modal | `sub_events`, `commands/communication/events.rs` |
| Knowledge | Knowledge rows, graph dashboard, annotations | `sub_knowledge` |
| Health | Persona health cards, heartbeat, predictive alerts, burn-rate/cascade views | `sub_health` |
| Leaderboard | Persona rankings, podium, radar score details | `sub_leaderboard` |

## Additional overview modules

| Module | Purpose |
| --- | --- |
| `sub_incidents` | Incident inbox, taxonomy, filters, actions |
| `sub_realtime` | Live in-memory event-bus visualization |
| `sub_observability` | Trace/healing/metrics/alerts dashboards |
| `sub_sla` | SLA cards and dashboard |
| `sub_usage` | Usage charts, period comparison, tool usage pivoting |
| `sub_memories` | Memory list, conflict review, merge actions |
| `sub_cron_agents` | Schedule-focused persona cards |
| `sub_analytics` | Rotation analytics helpers/panels, plus the GitHub-style 365-day **execution heatmap** (`ExecutionHeatmap.tsx`) embedded on the dashboard (fleet aggregate, respects the persona filter) and on each per-persona Activity tab. Backed by the `get_execution_heatmap` IPC command, which serves a 1-hour server-side cached daily aggregation plus derived insights (longest streak, dormant-since, peak day, week-over-week trend). |

The local source README at `src/features/overview/README.md` defines folder boundaries: realtime, persisted events, and observability are separate tiers and should not be mixed.

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
