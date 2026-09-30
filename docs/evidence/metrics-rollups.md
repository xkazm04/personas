---
subject: metrics-rollups
evidence:
  - src-tauri/src/commands/communication/observability/metrics.rs   # windows clamped at the door (1..365); overview bundle = summary+series+spend in ONE deferred transaction; health bundle with per-source error envelope disambiguating null-failed from null-valid; spend boundary deliberately UTC to match the budget gate's predicate
  - src-tauri/db/src/repos/communication/sla.rs                     # sla_daily rollup: idempotent recompute-and-replace writer, ONE shared local-day-boundary function for writer/backfill/reader, freeze-before-prune sequencing, durable-tail + fresh-head merge picking the more complete source per day
  - src-tauri/db/src/repos/execution/metrics.rs                     # server-side day bucketing (storage-engine GROUP BY); heatmap buckets by caller-local day with same modifier in SELECT and GROUP BY, echoes window_days + generated_at, bounded TTL cache keyed by (days, persona, zone)
  - src-tauri/db/src/migrations/incremental/                      # sla_daily backfill reuses the exact runtime rollup writer, so backfilled and live rows share one definition (recomputation named, once)
  - src/features/overview/sub_usage/libs/periodComparison.ts        # the 2x-window single-fetch comparison: one read, split locally, previous period as ghost series
  - src/features/overview/libs/computeTrends.ts                     # comparison discipline: returns null rather than fabricate a trend from a single loaded window; previous=0 branches before dividing
  - src/features/overview/sub_usage/libs/pivotToolUsage.ts          # client pivoting for presentation shape only — transposes already-aggregated rows, no new numbers
counter_evidence:
  - src/features/overview/libs/computeTrends.ts                     # same file, other face: ordinal-index period split assumes a dense series while the feed is group-by-sparse (boundary drifts by the count of quiet days); avgField takes unweighted means of daily means and daily p50s
deviations:
  - w5-metrics-rollups   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Metrics Rollups - evidence

How this codebase measures against the [`metrics-rollups`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
