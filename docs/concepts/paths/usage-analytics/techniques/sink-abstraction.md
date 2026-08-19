---
layer: technique
subject: usage-analytics
technique: sink-abstraction
status: forged
laws: [failure-not-empty-success, one-validation-door]
shared_with: []
---

# Sink abstraction

The sink is the seam between measurement and destination. Everything above it
— the emit door, the accumulator, the flush — is product code with one owner
and one shape; everything below it is deployment policy: a local store today,
a self-hosted collector next quarter, a vendor the quarter after, nothing at
all for the user who opted out. The technique is keeping that seam narrow,
honest about failure, and impossible to route around.

## The contract

A sink implements one small interface: **accept a finished session summary**.
Deliberately absent from the contract:

- **No per-event ingestion.** The sink receives aggregates
  ([batching-and-quota](batching-and-quota.md)); a sink interface that
  accepts raw events invites the next integration to bypass aggregation,
  and with it the privacy posture.
- **No response the product waits on.** Acceptance is fire-and-forget with
  bounded internal retry; no user-visible path may ever block on, or branch
  on, sink acceptance. The product must behave identically whether the sink
  is fast, slow, or dead.
- **No knowledge of the destination in call sites.** Exactly one place —
  composition at startup — decides which sink is live. Product code records
  measurements; it never chooses where they go. All summaries reach the sink
  through the same flush path that the emit door feeds
  ([law: one validation door](../../_laws.md#one-validation-door)); a second
  route to a destination is an unscrubbed export waiting to happen.

The seam only concentrates the concern if nothing beside it offers the
bypass. The subtle failure is not a caller deliberately routing around the
sink — it is the analytics layer's own public surface *re-exporting the raw
destination helpers* next to the safe interface, so the natural import is the
unswitchable door and every call site that takes it is correct-looking and
outside the consent switch. Withholding the dangerous export is the
mechanism; a convention asking callers not to use it is not.

The default sink ships scrubbed-by-construction: it accepts only the summary
shape, and the summary shape only admits allowlisted fields
([privacy-scrubbing](privacy-scrubbing.md)). A sink cannot transmit what the
contract cannot express — that is the point of typing the seam.

## The null sink is a first-class citizen

Opt-out is implemented as a sink, not as a flag checked at call sites: the
user who declines gets a null sink that satisfies the contract and discards.
This buys three properties at once:

- **Call sites are consent-blind.** No `if consented` branches scattered
  through product code — the decision is made once, where the sink is chosen.
- **The measurement layer stays exercised.** Counters accumulate identically
  for everyone, so local-only insight still works for opted-out users, and
  the code path does not rot into an untested branch.
- **Silence is deliberate and marked.** The null sink is *chosen* silence.
  It must remain distinguishable — in logs, in diagnostics, in the
  operator's mental model — from a sink that is failing. "No data because
  the user said no" and "no data because the flush has thrown for a month"
  are different facts and must never share a spelling
  ([law: failure spelled differently from empty success](../../_laws.md#failure-not-empty-success)).

## Failure at the sink: invisible to users, visible to operators

A sink failure is the textbook background error, and it gets the background
error's treatment — the discipline this product's
[error handling](../../error-handling/error-handling.md) standard defines:

- **Never user-facing.** No toast, no dialog, no degraded flow because
  telemetry could not be delivered. Analytics is the one subsystem whose
  failures are categorically not the user's problem.
- **Never silent to operators.** The failure goes through the background
  [error door](../../error-handling/techniques/error-doors.md) — logged,
  counted, visible in diagnostics. The trap is that a dead sink produces
  dashboards that look like declining usage; a team that cannot distinguish
  "users left" from "telemetry died" will investigate the wrong one. The
  loss-rate instrumentation from
  [batching-and-quota](batching-and-quota.md) is the cross-check: sessions
  observed locally versus summaries delivered.
- **Bounded persistence, then surrender.** A failed flush may retry with
  backoff and may spool a small, capped number of summaries locally for the
  next attempt. The cap is real: analytics never grows an unbounded local
  queue, and beyond the cap the oldest summaries are dropped — loss is
  tolerated by design, and the drop is counted.

## The layer must be observable somewhere a developer sits

A common and correct privacy choice — the remote destination is only armed in
shipped builds — has a structural side effect: if the shipped destination is
the *only* sink, then no developer ever observes an event the layer produces,
and every defect in it (a surface that never emits, a rollup that never
flushes, a denominator computed against a stale catalog) is unfalsifiable in
the only environment anyone runs. The remedy is a development sink behind the
same seam — writing to a local log or store — so the event stream can be
watched in an afternoon. This is not a nice-to-have; a pipeline nobody can
observe is a pipeline whose green status means nothing
([law: failure spelled differently from empty success](../../_laws.md#failure-not-empty-success)).

## Multiple destinations, one discipline

When more than one destination is live — a local history store plus a remote
collector is the common pair — compose sinks behind the same seam (a fan-out
sink), rather than teaching call sites about plurality. Each destination
keeps its own failure accounting; one destination's outage never blocks
another. And every added remote destination is a privacy decision, not a
plumbing one: it re-opens the [privacy-scrubbing](privacy-scrubbing.md)
review, because the audit promise — "we can enumerate everywhere this data
goes in one sitting" — is only as good as the sink roster's brevity.
