# Overview Feature — Sub-folder Boundaries

This directory hosts ~20 sub-modules that all render "what the system is doing." They look similar (timelines, trees, badges) but consume **two different data sources** and serve **two different user questions**. Putting a panel in the wrong folder is the leading cause of duplicated tree-rendering logic in this codebase.

Read this before adding a new panel or extending an existing one.

## The two tiers

```
        sub_events           --->     sub_observability
        ----------                    -----------------
  Durable event log                   Trace + healing
  (SQLite, queryable)                 (structured spans)

  "What happened and                  "Why did it happen
   can I search it?"                   and how do I fix?"

  PersonaEvent                        SystemTrace / UnifiedSpan
  (searchEvents API)                  HealingTimelineEvent
  EventFilterInput                    operationType / span tree
  grouped by filter                   grouped by traceId
```

Data flows left-to-right: `PersonaEvent` rows are persisted and searched here; the execution pipeline emits structured `UnifiedSpan`s that build into `SystemTrace`s; the healing engine correlates both and produces `HealingTimelineEvent`s. Never reach across tiers in the opposite direction (e.g. do not render a trace span tree from an event row -- use the trace engine).

> **The live tier is no longer in this directory.** `sub_realtime/` (animated
> event-bus visualization: comet trails, swim lanes, orbit rings) was deleted
> across `7c47bbc0b` / `2d533a13c` / `3f4355d0c`, and with it
> `visualizationHelpers`, `EventLogSidebar` and the `RealtimeEvent` /
> `ProcessingInfo` models. The surviving live surface is the **Live Stream tab**
> at `src/features/triggers/sub_live_stream/LiveStreamTab.tsx`. Both it and
> `sub_events/libs/useEventLog.ts` subscribe through the same
> `@/hooks/realtime/useEventBusListener`.
>
> What survives an HMR reload there is **not** a `globalThis` event bus -- there
> is no `globalThis` key anywhere in `src/hooks/realtime/`, and this file
> asserted one until 2026-09-02. What survives is the module-scope closure inside
> `createSingletonListener`: a **refcounted** subscriber set that holds exactly
> one native Tauri `listen()` for as long as at least one consumer is mounted,
> tears it down when the last one unmounts, and buffers up to 50 payloads (with
> a counted, reported drop total) that arrive before any subscriber exists.

## Per-folder intent

### `sub_events/` — persisted event log
- **Data source**: `searchEvents` over `EventFilterInput` (SQLite-backed); saved views via `listSavedViewsByType`.
- **Model**: `PersonaEvent` binding. Grouping key is the user's filter (type, persona, time range).
- **Visual style**: paginated list, JSON drill-down modal, saved filter chips.
- **Panels**: `EventLogList`, `EventDetailContent`, `EventDetailModal`.
- **User question**: "Find me the event where X happened yesterday."

### `sub_observability/` — trace engine + healing + metrics
- **Data source**: `useSystemTraces` (trace engine), `HealingTimelineEvent` bindings, IPC perf, alert rules, anomaly detection.
- **Model**: `UnifiedSpan` + `SystemTrace` from `@/lib/execution/pipeline`, grouped by `traceId` and `operationType`. Spans are a true tree (`buildSpanTree` / `flattenTree` in `features/agents/sub_executions/libs/traceHelpers`).
- **Visual style**: expand/collapse span trees, severity badges, healing narratives grouped by `chain_id`, metric charts.
- **Panels**: `SystemTraceViewer`, `HealingTimeline`, `ObservabilityDashboard`, `AlertRulesPanel`, `AnomalyDrilldownPanel`, `IpcPerformancePanel`, `SpendOverview`, `MetricsCharts`.
- **User question**: "What went wrong, what's the root cause, and is the healer already on it?"

## Decision rubric — "where does my new panel belong?"

Walk the questions top-down. Stop at the first **yes**.

1. **Does it show sub-second live activity off the event bus and nothing else?**
   → Not this directory. Extend the Live Stream tab at
   `features/triggers/sub_live_stream/`, subscribing through
   `@/hooks/realtime/useEventBusListener` so it shares the one native listener.

2. **Does it query historical `PersonaEvent` rows through `searchEvents` with filters or saved views?**
   → `sub_events/`. Reuse `useEventLog`, `EventDetailContent`.

3. **Does it render `UnifiedSpan` trees, `SystemTrace`s, `HealingTimelineEvent`s, alerts, or aggregated metrics?**
   → `sub_observability/`. Reuse `buildSpanTree` / `flattenTree` from `features/agents/sub_executions/libs/traceHelpers` — **do not re-implement tree flattening**.

4. **Does it belong to a narrower existing domain?** (executions, usage, SLA, health, memories, knowledge, activity, cron, leaderboard, manual-review, messages, analytics, timeline)
   → Use that `sub_*/` folder.

5. **None of the above?** Add a new `sub_<domain>/` folder. Do not pile it into `sub_events` or `sub_observability` "because it kind of fits."

## Anti-patterns seen in PRs

- Building a span-tree renderer out of live bus events. → Use the trace engine in `sub_observability/`.
- Querying `searchEvents` from the Live Stream tab because "we also want history." → Split into two panels across the two surfaces, or lift the query into `sub_events/libs` and import.
- Duplicating `SEVERITY_COLORS` / `HEALING_CATEGORY_COLORS`. → Import from `@/lib/utils/formatters` or `@/features/overview/shared/eventVisuals`.
- Adding a feature-scoped `i18n/` under a sub-folder. → All new strings go into `src/i18n/en.ts` per the root CLAUDE.md.
