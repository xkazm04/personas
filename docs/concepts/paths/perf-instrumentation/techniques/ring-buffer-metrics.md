---
layer: technique
subject: perf-instrumentation
technique: ring-buffer-metrics
status: forged
laws: [creation-names-reaper, derivation-names-recomputation, count-carries-predicate]
shared_with: []
---

# Ring-buffer metrics

The default data structure for in-process metrics is a **fixed-size ring of
raw records per metric key**. Not a running average, not a streaming
quantile sketch, not an unbounded log — a window of the last N complete
records (duration, timestamp, outcome flags), overwritten in place as new
ones arrive. The ring is chosen because it satisfies three duties at once:
constant memory forever, constant-time writes on the hot path, and raw
records that any statistic can be re-derived from later.

## The bound is the retention policy

A ring buffer is [creation-names-reaper](../../_laws.md#creation-names-reaper)
made structural: the reaper is the write pointer. Nothing has to remember to
trim; there is no cleanup task to forget, no growth curve to notice in a
heap snapshot six weeks in. This matters most precisely where metrics are
gathered — long-lived interactive processes — because a metrics store is the
one allocation site guaranteed to be exercised by *every* feature, so an
unbounded one becomes the process's dominant leak while wearing the badge of
observability. Size the ring from the question it answers: enough samples
for a stable tail percentile (hundreds, not tens), small enough that
per-key × key-count × record-size is a number someone has approved.

## Bounded records under unbounded keys is still a leak

Per-key rings move the growth from records to **keys**. If the key is drawn
from a closed vocabulary (operation names, table names, phase names), the
map is bounded by construction. If the key embeds anything open-ended — an
argument, an identifier, a path — cardinality explodes and the rings
multiply without bound. The rules: key by the closed name of the operation,
never by its arguments; if open-ended keying is genuinely needed, cap the
key count with an eviction rule (least-recently-written) and count the
evictions, because a silently rotating key space changes what "the metrics"
even cover.

There is a second shape that solves cardinality by construction: **one
shared ring, grouped by key at read time**. All records land in a single
window carrying their key as a field; per-key statistics are derived by
partitioning the window when asked. Memory is bounded no matter what the
keys do — the trade is that the *window* is now shared: a chatty key
evicts a quiet key's entire history, so per-key sample counts vary wildly
and the n beside each key's p95 stops being a nicety and becomes the
difference between a statistic and an artifact. Both shapes are honest
when their window predicate is stated; the shared-ring form tends to be
independently reinvented at multiple layers of the same system, which
speaks for its simplicity — one allocation, one bound, no per-key
bookkeeping.

## Store records, derive statistics at read time

The ring holds **raw records**; percentiles, means, and rates are computed
when asked, by sorting or scanning a copy of the window. This is
[derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)
applied to statistics: every displayed number names its recomputation — "sort
the current window, take the nearest-rank element" — and can be re-derived,
re-questioned, or extended (add a p99 next month without having planned for
it) because the inputs still exist. The inverted design — updating a stored
aggregate on every write and discarding the record — is cheaper per write
and bankrupt at read time: it cannot answer any question it was not built
for, cannot exclude a category of record retroactively (see
[semantic-flags-over-heuristics](semantic-flags-over-heuristics.md)), and
its one number can never be audited. Read-time derivation costs a sort of N
elements; for rings sized in the hundreds this is microseconds, paid only
when a human is looking.

State the percentile method once and use it everywhere: nearest-rank on the
sorted window is the honest default (it returns an *observed* value, never
an interpolated fiction between two samples). Whichever is chosen, two
panels computing "p95" two different ways is a vocabulary split — the same
disease [one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
names, wearing numbers.

## Eviction honesty

A wrapped ring answers for **the last N records**, not for "since startup" —
and every consumer must know which claim it is reading
([count-carries-predicate](../../_laws.md#count-carries-predicate)). The
practical consequences:

- A derived rate ("timeout rate 4%") is a rate *over the window*; after a
  burst of traffic the window may cover ninety seconds, after a quiet night
  it may cover nine hours. Surfaces that render the rate render the window's
  actual time span or its sample count beside it.
- Facts that must survive eviction — lifetime totals, "worst ever",
  since-startup counts — do not live in the ring. They are separate
  monotonic counters, updated at write time, labeled as lifetime values.
  Mixing the two ("total calls" computed from a wrapped ring) silently
  converts a lifetime claim into a window claim the day the ring first
  wraps, which is exactly the day traffic became interesting.
- Before the ring fills, n < N: derive over what exists and disclose the n.
  A p95 over 7 samples is the 7th sample.

## Write-path discipline

The write happens on the hot path — often inside the very call being
measured — so it is constant-time and allocation-light: stamp a monotonic
clock, fill a fixed-shape record, advance an index. No formatting, no
serialization, no sorting, no lock held across anything slower than the
copy. Everything expensive is deferred to read time, where it is paid by
the one asker who wants the answer instead of by every operation measured.
