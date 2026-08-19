---
layer: technique
subject: usage-analytics
technique: batching-and-quota
status: forged
laws: [count-carries-predicate, creation-names-reaper]
shared_with: []
---

# Batching and quota

The unit of transmission for usage analytics is the **session summary**: one
record per session, flushed when the session ends, carrying counters
accumulated locally. This is not an optimization of per-event transmission —
it is a different architecture, and the three arguments for it (cost,
privacy, robustness) each independently suffice.

## Why per-interaction transmission is wrong

- **Cost.** Every click as a network call multiplies infrastructure and
  quota spend by the interaction rate — typically three to five orders of
  magnitude over one summary per session. Vendor pricing and self-hosted
  ingest capacity are both denominated in events; a product that transmits
  per click is buying its own telemetry at retail, forever.
- **Privacy.** Even with immaculate payloads, per-event transmission leaks
  through *timing*: arrival times at the collector reconstruct the user's
  rhythm — when they work, how long they linger, what follows what. A
  summary has one timestamp and no sequence. The aggregation promise of
  [privacy-scrubbing](privacy-scrubbing.md) is only structural when the
  transport unit is the aggregate.
- **Robustness.** A pipeline touched on every interaction has its failure
  surface in the product's hot path. Accumulating into local counters is
  synchronous, allocation-cheap, and cannot fail visibly; the network is
  touched once, at the edge of the session, where nothing user-facing
  depends on it.

## The accumulator

The in-session state is a set of named counters and gauges, keyed by the
event vocabulary: visit counts per surface, activation counts, duration
accumulators, first-seen flags. Increment is fire-and-forget from the emit
door. Two disciplines keep the accumulator honest:

- **Bounded cardinality by construction.** Keys come from closed
  vocabularies ([event-taxonomy](event-taxonomy.md)), so the accumulator's
  size is fixed by the registry, not by user behavior. A counter keyed by
  anything unbounded is a slow memory leak and a privacy hole at once.
- **The summary states its window.** A flushed record carries what it
  counted and over what span — session start, end, and the vocabulary
  version in force — so downstream aggregation never merges records whose
  predicates differ
  ([law: a count carries its predicate](../../_laws.md#count-carries-predicate)).

## Flush: session end, and the ends nobody plans for

"Session end" is plural in practice, and each shape needs an owner:

- **Orderly shutdown** — the normal flush point. The summary is finalized,
  handed to the sink, done. Shutdown paths are given a short, bounded window
  to hand off — analytics may never be the reason quitting feels slow, so
  the handoff must be fast and abandonable, not awaited indefinitely.
- **Abrupt death** — crash, kill, power loss. The summary in memory is
  simply gone unless the accumulator checkpoints. The cheap middle ground is
  periodic persistence of the running counters to local storage, with the
  *next* launch flushing any orphaned checkpoint as a "recovered session"
  summary, marked as such.
- **The long-lived session** — a session lasting days defeats "flush at
  end". A maximum accumulation window (flush and reset every N hours of
  activity) bounds both data loss and summary staleness.

Every timer, listener, and checkpoint created for this machinery names its
teardown at creation — flush hooks deregistered, intervals cancelled,
checkpoints deleted after successful flush
([law: creation names its reaper](../../_laws.md#creation-names-reaper)); an
analytics layer that leaks its own plumbing is measuring the product it is
degrading.

## Loss tolerance is declared, not discovered

Session-summary batching accepts that some summaries die with their
sessions. This is the correct trade — the data is directional product
signal, not a ledger — but "acceptable loss" is a number, not a shrug:

- **Instrument the loss itself.** Sessions started can be counted cheaply
  and locally (a checkpoint at start); summaries received are known at the
  sink. The gap is the loss rate. A loss rate that moves is a defect
  signal — a new crash, a broken flush path — even when the absolute level
  is fine.
- **Never buy durability with privacy or hot-path cost.** Escalating to
  per-event durable spooling to chase the last few percent of completeness
  reintroduces exactly the trail and the overhead this architecture exists
  to avoid. If a measurement genuinely requires ledger-grade delivery, it is
  not usage analytics and does not belong in this pipeline.

## Quota is a budget with a name

Whatever the destination charges — requests, events, bytes, rows — the
analytics layer owns a stated budget: expected summaries per installation
per day, expected summary size, and the ceiling the product refuses to
cross. New events and new fields are priced against it at design time (one
more counter per session is nearly free; anything per-interaction is not).
The budget check belongs in review of registry changes, because that is
where volume is decided; by the time the bill or the rate-limit arrives,
the decision is months old.
