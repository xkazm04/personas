---
layer: technique
subject: embedded-db
technique: quiet-window-maintenance
status: forged
laws: [gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Quiet-window maintenance

Embedded engines need periodic maintenance the same way server engines do —
journal checkpoints so sidecars do not grow without bound, compaction so
deleted space is reclaimed, statistics refresh so the planner stays honest.
On a server these run in negotiated windows. In a user-facing process the
window must be **found, not scheduled**: the technique is to gate every
maintenance pass on a live measurement of whether the application is busy,
taken at the moment the pass would start and re-taken while it runs.

## An activity gauge, not a timer

A bare timer ("compact every N hours") is scheduling by wall clock, and wall
clocks do not know about interactions; over enough sessions the timer is
guaranteed to fire mid-click, and the resulting stall is charged to the
feature the user was touching. The replacement is an **activity gauge**: a
cheap, always-current count of in-flight foreground work — requests being
handled, an interaction in progress, jobs the user is waiting on —
incremented and decremented at the application's own front doors.

The law here is [gate-sees-target](../../_laws.md#gate-sees-target): the
gate must observe *actual demand for the machine*, not a proxy for it.
Proxies that fail in practice: time-of-day (users work at night),
"idle since last query" measured inside the database layer (misses CPU-bound
foreground work that will need the database in 200ms), OS-level idle
(screensaver-grade signals fire while a long export runs). The gauge should
be fed by the same instrumentation spine the application already trusts —
and pool saturation from [connection-pooling](connection-pooling.md) is
itself a strong busy signal.

Two-condition gate as the standard form: run when **the gauge reads zero**
AND **a minimum interval since the last pass has elapsed**. The interval
bounds cost; the gauge bounds interference. Neither alone is the technique —
the interval alone is the timer failure, and the gauge alone runs
maintenance in every momentary gap, turning idle detection into a busy loop.

## Defer politely, but not forever

When the gate says busy, the pass is deferred, and deferral needs its own
policy or quiet-window maintenance degrades into no maintenance — a heavily
used application may present no perfect window for days while its journal
sidecar grows. The standard is an **escalation ladder**: prefer true quiet;
past a staleness bound, accept "quieter" (run at a reduced chunk size during
low activity); past a hard bound tied to a measurable harm (sidecar bytes,
reclaimable-space ratio), run regardless and say so. The hard bound must be
stated in terms of the harm, not elapsed time — "the journal exceeds X" is a
reason a human can weigh; "it has been a week" is a timer sneaking back in.

Deferral is also an *outcome*, and
[failure-not-empty-success](../../_laws.md#failure-not-empty-success)
applies: "ran and found nothing to do," "deferred because busy," and
"attempted and failed" are three different results. A maintenance log that
only records successes cannot distinguish a healthy store from a scheduler
that has been deferring for a month, and the discovery arrives as a
disk-full report.

## Chunk, yield, re-check

The user does not stay away because maintenance started. Long passes must be
built as **resumable chunks** with the gauge re-read between chunks: process
a bounded slice, check the gauge, continue or yield. Yielding must be safe
at every chunk boundary — each chunk leaves the store consistent, and a pass
abandoned halfway is merely incomplete, never corrupt. Engines generally
support this shape natively for journal checkpoints (bounded page batches)
and via incremental variants for space reclamation; full-store rewrites that
cannot be chunked are quiet-window-only *and* need the store to be otherwise
idle, which is exactly why they should be rare and evidence-driven rather
than routine.

Priority matters as much as chunking: the maintenance thread runs at
background priority, and it must never hold the writer's lock across a
gauge re-check. The pass yields the lock, then re-evaluates — the reverse
order keeps the user waiting on the very check meant to protect them.

## Record every pass

Each pass — run, deferred, failed — appends a record: trigger (interval
elapsed, threshold breached, escalation rung), gauge reading, duration,
work done (pages checkpointed, bytes reclaimed), and outcome. This is the
subject's flight recorder, kept in the same bounded self-instrumentation
store as query metrics ([db-self-instrumentation](db-self-instrumentation.md)).
It answers the two questions that otherwise become folklore: "is maintenance
actually running?" and "was that stall at 14:03 us?" — the second being the
question that decides whether quiet-window gating is trusted or quietly
disabled by the next engineer who suspects it.

## What runs in the window

The window is for work that competes with the user: checkpointing the
write-ahead journal (the routine one — see
[journal-and-durability-modes](journal-and-durability-modes.md) for why the
sidecar grows and what "passive" vs "restart" checkpoint aggressiveness
trades), incremental space reclamation after large prunes (the heavy tail of
[storage-accounting-and-pruning](storage-accounting-and-pruning.md)),
statistics refresh, and integrity sweeps. The window is *not* for correctness
work: anything the application needs for correct operation — schema
migration, crash recovery — runs at its own mandated moment regardless of
activity, because "we deferred recovery politely" is not a sentence anyone
wants to say.
