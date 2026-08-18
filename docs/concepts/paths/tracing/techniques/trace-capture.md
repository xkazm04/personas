---
layer: technique
subject: tracing
technique: trace-capture
status: forged
laws: [failure-not-empty-success, count-carries-predicate, creation-names-reaper]
shared_with: []
---

# Trace capture

Capture is the producer's side of tracing: deciding what opens a span, paying
for the recording without distorting the thing recorded, buffering spans on
their way to durable storage, and bounding all of it so a pathological run
saturates its trace instead of the system. Capture is also where the honesty
guarantees are won or lost — a viewer can only render what capture preserved,
and can only be honest about what capture admitted to dropping.

## What opens a span

A span is opened for a **unit of work with a beginning, an end, and an owner
who will close it**. The three-part test filters most bad candidates:

- *A meaningful operation*, not a code boundary. Function calls are too fine;
  "the run" alone is too coarse. The right granularity is the one a human
  investigating slowness would want to point at: a model call, a tool
  invocation, a retrieval, a stage, a queue wait, a subagent's whole turn.
- *An owner who closes it.* Every open has a matching close on **every** exit
  path — success, failure, cancellation, early return. The reliable shape is
  structural (a scope guard, a wrapper that closes on drop or on function
  exit), not disciplinary (remembering to close in each branch). An unclosed
  span is worse than no span: it renders as eternally running and poisons
  every duration rollup above it. And the close targets **the handle the open
  returned** — never "the most recent open span of this kind". Closing by
  scan is a stack discipline imposed on a stream that is not a stack: under
  interleaved operations (several opens before any close, results arriving
  out of order) it silently swaps durations between spans instead of failing,
  which is the worst possible failure mode for a measuring instrument.
- *Worth its cost.* Opening a span in a loop that iterates ten thousand times
  per run is a self-inflicted denial of service on the trace store. Per-item
  work that fine gets one span for the batch, with counts as attributes.

Retries deserve their own statement: each attempt is its **own span**, a
sibling under the operation that is being retried, carrying its ordinal as an
attribute. Folding attempts into one span with a mutated end time erases
exactly the pattern — how many attempts, how spaced, which failed how — that
the retry policy's observers need
([retry-backoff](../../retry-backoff/retry-backoff.md) owns the policy;
the trace is where the policy's behavior becomes visible).

## Capture cost: the recording must not distort the recorded

The act of capturing must be cheap relative to the work measured — cheap
enough that tracing stays on in production, because a trace that only exists
in development describes a system nobody ships. The standing rules:

- **Open and close are constant-time appends** to an in-memory structure.
  Nothing on the hot path serializes, compresses, or touches durable storage.
- **Durable writes are batched and deferred** — at span close into a buffer,
  flushed on size or interval, and force-flushed at finalization. The
  producer's latency budget never contains a storage round-trip.
- **But deferral has a hard limit: durability must not be conditioned on the
  run ending the way the writer expects.** The tempting shape — accumulate
  everything in memory, write once at finalization — has a coverage profile
  that is exactly inverted: orderly completions are recorded perfectly, while
  crashes, external kills, process restarts, and watchdog-reaped zombies —
  the runs a human most needs to reconstruct — leave nothing, because they
  never reach the one write. Spans (or bounded batches of them) become
  durable **as they close**, so a run that dies mid-flight still leaves
  everything up to the death. The in-memory tree remains as a live-render
  cache; it must not be the only copy.
- **The trace store is fed asynchronously, and its failure is contained.**
  A full buffer or a failed flush degrades the *trace* (with a marker — see
  below), never the run. Work must not fail because its observation failed.

## Ceilings: bounded capture with a confession

Every budget has a ceiling and every ceiling has a confession:

- **A span ceiling per trace.** A runaway loop or unbounded fan-out hits the
  ceiling; subsequent opens are counted but not stored; the trace carries a
  truncation marker with the count of spans shed. A tree that was truncated
  and a tree that completed must never look alike.
- **An attribute budget per span**, with oversize values clipped and flagged
  on the span itself.
- **A duration for orphan closure.** Finalization sweeps every span still
  open and closes it with status *interrupted* — never *ok*, never *failed*
  (nothing reported failure; the world stopped). A crash between flushes
  loses at most one buffer's worth, and the settled trace says the run ended
  abnormally rather than presenting the surviving prefix as a complete run.

## Sampling honesty

When volume forces sampling, the decision is made **once, at the root** —
head-based, so a trace is captured whole or not at all; a randomly-thinned
tree is structurally useless. The decision and the rate are recorded **on the
trace**, because every count later derived from sampled traces must carry its
predicate — "N traces at rate R" scales honestly; a bare N from an unstated
sample is a number that will be reused for a claim it cannot support
([count-carries-predicate](../../_laws.md#count-carries-predicate)).
Tail-biased escapes are legitimate and common — always keep failed or
anomalously slow traces regardless of the roll — but the bias is itself
recorded, or the error rate computed from kept traces becomes fiction.

## Absence is not emptiness

A run whose trace is missing and a run that was traced doing very little must
be distinguishable at a glance
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
Capture therefore writes the **root span first**, at run start — not at run
end — so that even a crashed, unflushed run leaves a root that says "this run
began and its trace is incomplete". A viewer that finds no trace for a run
states "not captured" (with the reason when known: sampled out, capture
failed, predates instrumentation), never an empty waterfall that reads as
"this run did nothing".

## Retention names its reaper

Traces are the highest-volume structured record most products keep: spans per
run × runs per day compounds quietly. At the moment the trace store is
created, the policy that destroys its contents is named — age-based deletion,
per-entity caps, summarize-then-shed — and wired, not deferred
([creation-names-reaper](../../_laws.md#creation-names-reaper)). Two
sub-rules: deletion respects the tree (a trace is shed whole, never leaving
dangling children), and any rollup meant to outlive its trace is computed
*before* the reaper runs, at which point it becomes a stored derivation whose
recomputation is gone — so it must say so.
