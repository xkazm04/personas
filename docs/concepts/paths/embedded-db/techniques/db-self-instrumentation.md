---
layer: technique
subject: embedded-db
technique: db-self-instrumentation
status: forged
laws: [count-carries-predicate, derivation-names-recomputation]
shared_with: []
---

# Database self-instrumentation

No monitoring agent watches an embedded store. The application either
measures its own database behavior or the subject's performance discourse is
folklore — "the app feels slow after a few weeks" with nothing to interrogate.
This technique is the database specialization of the general
self-measurement discipline owned by
[perf-instrumentation](../../perf-instrumentation/perf-instrumentation.md):
the storage substrate, write-path budget, and read-time-derivation rules are
inherited wholesale from
[ring-buffer-metrics](../../perf-instrumentation/techniques/ring-buffer-metrics.md)
and are not restated here. What follows is only what the database layer
adds: what to key by, what "slow" means for a local store, which
database-specific facts to record, and who consumes the result.

## Key by table or operation family — a closed vocabulary

The keying rule from the ring discipline (closed vocabulary, never
arguments) has a specific right answer here: **the table or the named
operation family** (per-table reads, per-table writes, named maintenance
ops). Never the statement text — statements embed values, which is
unbounded cardinality, and near-duplicate statements shatter one logical
hot path across many keys. Per-table keying also makes the metrics
*converse with the rest of the subject*: the accounting report from
[storage-accounting-and-pruning](storage-accounting-and-pruning.md) says
which table is big, the rings say which is slow, and the join of the two
("big AND degrading") is the strongest prune-or-index signal the subject
produces. Pool acquisition from
[connection-pooling](connection-pooling.md) is its own key — the wait for
a connection must never be folded into query time, because the two have
disjoint remedies.

## "Slow" for a local store is single-digit milliseconds

Thresholds calibrated for networked databases (100ms, 1s) are deaf here: an
embedded read is microseconds-to-low-milliseconds, so a local query that
takes 50ms is *pathological* — a missing index, a lock convoy, a checkpoint
storm — while sitting comfortably under any server-derived threshold. Set
the slow-operation line per operation family, an order of magnitude above
that family's healthy p95, single-digit milliseconds for indexed point
reads. And per [count-carries-predicate](../../_laws.md#count-carries-predicate),
a slow-operation count travels with its predicate — "N operations over X ms
on table T within the current window" — or it gets quoted as "N slow
queries" in a conversation where everyone assumes a different X.

Two database-specific facts are worth their bytes in every record beyond
duration and outcome: **rows touched** (separates "the query got slower"
from "the table got bigger" — the remedy for one is an index, for the other
a pruning policy) and **lock or busy waits** (separates engine work from
contention; a p95 driven by lock waits indicts the pool sizing or a
writer-hog, not the query plan).

## The instrument holds a privileged position — budget accordingly

Database instrumentation wraps the hottest chokepoint in the process — every
data operation passes through it — so the ring discipline's write-path
budget applies at its strictest: constant-time record, no formatting, no
lock shared with the measured path. The one addition the database layer
makes: the instrument must not *use the database*. Metrics that write to a
metrics table turn every measured operation into two operations, contend
for the very locks being measured, and recurse the instrument into its own
signal. In-memory rings, exported on demand; if history must persist, it is
flushed in the quiet window like any other maintenance write.

## Consumers: the numbers must land somewhere with a decision attached

Instrumentation nobody reads decays into ballast. The subject has three
standing consumers, each attached to a decision:

- **The warn channel** — threshold breaches (slow-op line, pool-wait line)
  emit a rate-limited diagnostic naming key, duration, and threshold. This
  is the only push-mode consumer; everything else is pull. Rate limiting
  must itself be counted: a per-key budget per window, and when the window
  rolls over having suppressed events, one summary line carrying the
  suppressed count and the worst suppressed duration. Silent suppression
  converts "a burst happened" into "nothing happened," which is the
  instrument lying in exactly the moment it exists for — a retry storm's
  hundredth slow query is noise, but the fact that there *were* a hundred
  is the finding.
- **The maintenance gate** — [quiet-window-maintenance](quiet-window-maintenance.md)
  reads the activity picture, and its passes write their own records back
  into the same store; degradation trends (checkpoint durations growing)
  are its escalation evidence.
- **The diagnostic surface** — an on-demand report (a debug view, a support
  bundle section) deriving p95s, slow counts, and window spans from the
  rings, each figure naming its recomputation per
  [derivation-names-recomputation](../../_laws.md#derivation-names-recomputation).
  This is what turns "it feels slow" support threads into "table T's write
  p95 is 40× its baseline" — the difference between an afternoon of
  guessing and a one-line fix.
