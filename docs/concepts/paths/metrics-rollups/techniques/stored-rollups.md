---
layer: technique
subject: metrics-rollups
technique: stored-rollups
status: forged
laws: [derivation-names-recomputation, failure-not-empty-success]
shared_with: []
---

# Stored rollups

A rollup materializes the fold: one stored row per bucket per key — day ×
metric, day × entity — precomputed so that a year of history is 365 reads
instead of a scan over millions of events. Products reach for it when
interactive aggregation stops being interactive, and it works. But storing a
derivation creates a **second copy of the truth that the log no longer
enforces**, and everything in this technique exists to keep that copy honest.

The governing law is [a stored derivation names its
recomputation](../../_laws.md#derivation-names-recomputation). Applied here it
is a checklist with no optional rows: for every rollup table someone can name
**the code that rebuilds one bucket, the trigger that runs it, the horizon
inside which it re-runs, and the procedure that rebuilds everything.** A
rollup missing any of the four is not "mostly fine" — it is a divergence with
a fuse, because the log keeps moving and the derived copy only moves when
something moves it.

## The rollup is derived, never authoritative

- The raw log remains the source of truth for as long as retention keeps it.
  Any dispute between log and rollup is settled by recomputing the rollup
  from the log — never by patching the rollup by hand, which converts a
  recomputable derivation into an unexplainable artifact.
- Where retention *does* expire raw events, the rollup becomes the only
  surviving record — a legitimate design, but it must be explicit: past the
  retention horizon the rollup is a **primary record wearing a derivation's
  schema**, it can never be rebuilt, and both the recomputation paths and
  the consumers (which now read two different kinds of truth under one
  table) must know where that horizon sits. The ordering constraint this
  creates is part of the recomputation contract: **the final recompute of a
  bucket runs before the retention reaper prunes its source rows** — a
  bucket frozen *after* pruning is frozen at whatever staleness the last
  cycle happened to leave, permanently. The rollup writer and the reaper
  are a sequenced pair, not two independent schedules.
- A rollup row's schema states its predicate — what was counted, at what
  grain, in which zone, under which definition version. An undocumented
  rollup column is the metric-fork problem frozen into storage.

## Recomputation paths — all three, named

1. **The incremental path** keeps the near edge current: fold the events of
   a bucket and write the result. It runs on a schedule or on write
   activity; either way it is **idempotent per bucket** — recompute-and-
   replace keyed by (bucket, key), never increment-in-place. Increments
   double-count on retry, and every scheduled system retries. Idempotence is
   also what makes the path safe to re-run for repair: the fix for a
   suspect bucket is the same code as the nightly run.
2. **The late-event path** answers the question the incremental path cannot:
   what happens when an event arrives, is corrected, or is deleted *after*
   its bucket was rolled up — a client flushing hours late, a backdated
   import, a retraction. The honest designs: re-roll a trailing **reopen
   window** of N buckets every cycle (simple, bounds staleness by N), or
   track touched buckets and re-roll exactly those (precise, needs a dirty
   set). The dishonest design is the default one: nothing, and the rollup
   silently understates history wherever lateness happened. The reopen
   horizon is part of the product's accuracy claim: "final after N days" is
   a statement users and alerting both depend on, so it is written down,
   not discovered.
3. **The backfill path** rebuilds at scale: first deployment over an
   existing log, a definition change, recovery from a bug. It is a batch
   walk of the same per-bucket recompute (idempotence makes restart safe),
   it runs bounded (chunked, resumable, throttled), and a definition change
   backfills **all history or none** — a rollup half-rebuilt under a new
   definition draws a step discontinuity through every chart at the
   deployment date, indistinguishable from a real product event.

The recomputation jobs themselves are owned background work — scheduling,
overlap protection, and failure alerting per
[background-jobs](../../background-jobs/background-jobs.md). One clause
matters enough to restate here: a rollup job that fails must fail loudly. A
silently skipped nightly roll produces a chart with a plausible dip at the
far right — [failure spelled exactly like empty
success](../../_laws.md#failure-not-empty-success), rendered to the user as
data.

## The live-edge seam

History is served from the rollup; the current bucket is still filling and
must be folded live from the log. Every rollup-backed series therefore has a
**seam**, and the seam has rules:

- The splice point is computed, not assumed: everything at or after the last
  *finalized* bucket comes live, everything before it comes stored. An
  off-by-one at the seam double-counts or drops exactly one bucket —
  typically yesterday, the bucket users look at most.
- Both sides of the seam use the same derivation and the same bucket
  arithmetic ([bucketing-strategy](bucketing-strategy.md)); the seam is
  where a definition drift between the live fold and the rollup job becomes
  a visible kink in the line. The strongest form derives both sides' bucket
  boundaries from **one shared function**, so the stored fold and the live
  fold cannot disagree about which day a timestamp belongs to.
- The same discipline binds anyone *auditing* the rollup. A parity check
  that recomputes buckets from the raw log using a different day boundary
  than the writer used will report hundreds of plausible disagreements
  against a table that is exact — and every wrong offset produces a
  believable divergence, because mis-bucketed events land in adjacent days
  in numbers that look like drift. Verify the audit's bucket definition
  against the writer's before believing the audit.
- Which side answered survives into the result. The stored side is final;
  the live side is partial and still moving — a distinction
  [aggregate-honesty](aggregate-honesty.md) requires the wire format to
  carry, and a merge that drops it leaves consumers presenting two
  populations as one series.

## Smells

- A rollup table and no one can point to the code that rebuilds one of its
  rows.
- `count = count + ?` anywhere in the rollup writer.
- A metric definition change shipped without a backfill decision recorded —
  the step in the charts arrives three weeks later as a mystery.
- Yesterday's total that changes when you refresh (seam overlap) or a
  permanent slight undercount versus the raw log (no late-event path).
- A rollup job whose failure produces no page, no alert, and a normal-looking
  chart.
