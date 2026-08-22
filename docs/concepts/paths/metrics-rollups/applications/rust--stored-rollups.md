---
layer: application
subject: metrics-rollups
technique: stored-rollups
stack: rust
---

# Stored rollups in the SLA reliability pipeline

The `sla_daily` table is this repo's cleanest end-to-end instance of the
technique — a stored derivation that names all of its recomputation paths and
shares one bucket definition across every writer and reader. An independent
audit replayed at the machine's real UTC offset measured it **403 of 403
buckets exact** against a raw recompute (the first pass of that same audit,
run at the wrong offset, reported 276/500 divergent — the auditor-offset
lesson in the technique comes directly from this incident; see
`docs/concepts/golden-path-deferred-fixes.md`, the derivation-registry entry).

## The pieces, mapped

- **The rollup table** — `src-tauri/db/src/migrations/incremental/:4225`
  creates `sla_daily (persona_id, day, total, successful, failed, cancelled,
  timed_count, duration_sum_ms, cost_sum_usd, updated_at)` with
  `PRIMARY KEY (persona_id, day)`. Note what it stores: **composable parts**
  (counts, sums, and `timed_count` — the denominator for latency), never a
  finished ratio. `PersonaStats` in
  `src-tauri/db/src/repos/communication/sla.rs:258` carries the doctrine in a
  comment: the global avg-latency rollup must weight by `timed_count`, not
  `total_executions`.

- **The incremental path, idempotent by construction** —
  `upsert_sla_daily_conn` (`sla.rs:631-666`) is a single
  `INSERT … SELECT … GROUP BY persona_id, DATE(created_at, ?1) ON CONFLICT
  DO UPDATE SET total = excluded.total, …`. Every call recomputes each
  day-bucket from source rows and *replaces* — no `count = count + ?`
  anywhere — so the maintenance tick can run it every cycle without
  double-counting, and re-running it *is* the repair procedure.

- **One bucket definition, three consumers** — `local_day_modifier`
  (`sla.rs:593-595`) is the single source of truth for "which local day does
  this UTC timestamp fall on", applied identically by the rollup writer, the
  migration backfill, and the trend reader. The block comment at
  `sla.rs:574-585` states the split-brain failure it prevents (a UTC-8 user's
  Tuesday splitting across two chart columns at 16:00 local).

- **Freeze-before-prune sequencing** — the doc comment on `upsert_sla_daily`
  (`sla.rs:611-623`) makes the ordering explicit: the maintenance tick must
  roll up **before** `cleanup_old_executions`, so an about-to-be-pruned day
  gets one final accurate rollup and is then frozen. Past the execution
  retention window, `sla_daily` is deliberately the only surviving record —
  the "primary record wearing a derivation's schema" case, documented at the
  site that creates it.

- **The backfill path reuses the runtime writer** — the migration
  (`incremental.rs:4240-4246`) backfills history by calling
  `upsert_sla_daily_conn` itself, so backfilled and live-written rows share
  one definition by construction rather than by porting.

- **The live-edge seam** — `load_daily_trend` (`sla.rs:692-810`) merges the
  **durable tail** (`sla_daily` rows) with a **fresh head** (windowed raw
  recompute including today's partial day), per local day, keeping the
  higher-`total` source via the `consider` closure (`sla.rs:718-723`). The
  window boundary is computed once as a local day and converted back to a UTC
  instant with the *inverse* modifier (`sla.rs:706-716`) so both sources
  cover exactly the same local days — the shared-boundary rule applied at the
  seam.

## The residual gap (cross-referenced, not re-registered)

The merge computes exactly which source won each day — and then
`SlaDailyPoint` drops it: the wire type has fields for date/counts/rate and
none for provenance, so no downstream surface can mark stored-final vs
live-partial days. This is the provenance finding registered under the
**data-viz** deviations anchor (`w3-data-viz` context in
`docs/concepts/golden-path-deferred-fixes.md`); the same function also spells
a zero-decided day as `success_rate: 0.0` (`sla.rs:802-806`) while the
percentile helper forty lines below (`sla.rs:816-819`) returns `None` for
empty input and documents why — both halves of the
[aggregate-honesty](../techniques/aggregate-honesty.md) empty-denominator
rule, three screens apart.
