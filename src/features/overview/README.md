# Overview Feature — Sub-folder Boundaries

This directory hosts ~20 sub-modules that all render "what the system is doing." They look similar (timelines, trees, badges) but consume **three different data sources** and serve **three different user questions**. Putting a panel in the wrong folder is the leading cause of duplicated tree-rendering logic in this codebase.

Read this before adding a new panel or extending an existing one.

## The three tiers

```
  ┌───────────────────────┐        ┌───────────────────────┐        ┌───────────────────────┐
  │    sub_realtime       │  ───►  │      sub_events       │  ───►  │   sub_observability   │
  │                       │        │                       │        │                       │
  │  Live event bus       │        │  Durable event log    │        │  Trace + healing      │
  │  (in-memory, <1s)     │        │  (SQLite, queryable)  │        │  (structured spans)   │
  │                       │        │                       │        │                       │
  │  "What is happening   │        │  "What happened and   │        │  "Why did it happen   │
  │   right now?"         │        │   can I search it?"   │        │   and how do I fix?"  │
  └───────────────────────┘        └───────────────────────┘        └───────────────────────┘
        RealtimeEvent                    PersonaEvent                  SystemTrace / UnifiedSpan
        (useRealtimeEvents)              (searchEvents API)            HealingTimelineEvent
        ProcessingInfo                   EventFilterInput              operationType / span tree
        grouped by chainId               grouped by filter             grouped by traceId
```

Data flows left-to-right: the event bus emits `RealtimeEvent`s that are persisted as `PersonaEvent` rows; the execution pipeline emits structured `UnifiedSpan`s that build into `SystemTrace`s; the healing engine correlates both and produces `HealingTimelineEvent`s. Never reach across tiers in the opposite direction (e.g. do not render a trace span tree from realtime events — use the trace engine).

## Per-folder intent

### `sub_realtime/` — live event-bus visualization
- **Data source**: `useRealtimeEvents` / `useEventBusListener` (in-memory ring buffer; `globalThis` event bus surviving HMR).
- **Model**: `RealtimeEvent`, `ProcessingInfo`, `DiscoveredSource` from `libs/visualizationHelpers.ts`. Grouping key is `chainId`.
- **Visual style**: animated SVG, comet trails, swim lanes, orbit rings. Ephemeral — events fade after `FADE_AFTER_MS`.
- **Panels**: `EventBusVisualization`, `SwimLaneVisualization`, `TimelinePlayer`, `RealtimeStatsBar`, `EventDetailDrawer`.
- **User question**: "Is the system alive right now? What's firing this second?"

### `sub_events/` — persisted event log
- **Data source**: `searchEvents` over `EventFilterInput` (SQLite-backed); saved views via `listSavedViewsByType`.
- **Model**: `PersonaEvent` binding. Grouping key is the user's filter (type, persona, time range).
- **Visual style**: paginated list, JSON drill-down modal, saved filter chips.
- **Panels**: `EventLogList`, `EventLogItem`, `EventDetailModal`.
- **User question**: "Find me the event where X happened yesterday."

### `sub_observability/` — trace engine + healing + metrics
- **Data source**: `useSystemTraces` (trace engine), `HealingTimelineEvent` bindings, IPC perf, alert rules, anomaly detection.
- **Model**: `UnifiedSpan` + `SystemTrace` from `@/lib/execution/pipeline`, grouped by `traceId` and `operationType`. Spans are a true tree (`buildSpanTree` / `flattenTree` in `features/agents/sub_executions/libs/traceHelpers`).
- **Visual style**: expand/collapse span trees, severity badges, healing narratives grouped by `chain_id`, metric charts.
- **Panels**: `SystemTraceViewer`, `HealingTimeline`, `ObservabilityDashboard`, `AlertRulesPanel`, `AnomalyDrilldownPanel`, `IpcPerformancePanel`, `SpendOverview`, `MetricsCharts`.
- **User question**: "What went wrong, what's the root cause, and is the healer already on it?"

## Decision rubric — "where does my new panel belong?"

Walk the questions top-down. Stop at the first **yes**.

1. **Does it read from `useRealtimeEvents` / `useEventBusListener` and show sub-second animation?**
   → `sub_realtime/`. Reuse `visualizationHelpers`, `useAnimatedEvents`, `EventLogSidebar`.

2. **Does it query historical `PersonaEvent` rows through `searchEvents` with filters or saved views?**
   → `sub_events/`. Reuse `useEventLog`, `EventLogItem`.

3. **Does it render `UnifiedSpan` trees, `SystemTrace`s, `HealingTimelineEvent`s, alerts, or aggregated metrics?**
   → `sub_observability/`. Reuse `buildSpanTree` / `flattenTree` from `features/agents/sub_executions/libs/traceHelpers` — **do not re-implement tree flattening**.

4. **Does it belong to a narrower existing domain?** (executions, usage, SLA, health, memories, knowledge, activity, cron, leaderboard, manual-review, messages, analytics, timeline)
   → Use that `sub_*/` folder.

5. **None of the above?** Add a new `sub_<domain>/` folder. Do not pile it into `sub_realtime`, `sub_events`, or `sub_observability` "because it kind of fits."

## Anti-patterns seen in PRs

- Building a span-tree renderer inside `sub_realtime/` by flattening `ProcessingInfo` chains. → Move to `sub_observability/` and use the trace engine.
- Querying `searchEvents` from a `sub_realtime` component because "we also want history." → Split into two panels across the two folders, or lift the query into `sub_events/libs` and import.
- Duplicating `SEVERITY_COLORS` / `HEALING_CATEGORY_COLORS`. → Import from `@/lib/utils/formatters` or `@/features/overview/shared/eventVisuals`.
- Adding a feature-scoped `i18n/` under a sub-folder. → All new strings go into `src/i18n/en.ts` per the root CLAUDE.md.
