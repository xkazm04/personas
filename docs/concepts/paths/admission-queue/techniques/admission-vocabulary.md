---
layer: technique
subject: admission-queue
technique: admission-vocabulary
status: forged
laws: [one-authority-per-vocabulary, failure-not-empty-success]
shared_with: []
---

# Admission vocabulary

The admission decision is the queue's entire external contract, and it is a
**closed vocabulary**: every request that reaches the gate receives exactly
one of three verdicts, each verdict carries its own payload, and each
obligates the caller differently. Get this vocabulary right and every other
technique in the subject has a place to report its outcome; get it wrong —
collapse two verdicts, return a bare boolean, throw on refusal — and the
queue's most important behaviors become indistinguishable from its bugs.

## The three verdicts

**Admitted.** Capacity existed and is now held for this request; execution
begins. The payload is the run's identity — the handle the caller will use
to observe, cancel, and correlate. The caller's obligation: stop waiting on
the *queue* and start observing the *execution*; those are different
components with different telemetry, and the handoff point is exactly here.

**Queued.** The request will run later, and the verdict says *behind what*:
a position, a depth, or an honest wait estimate. "You are waiting" without
"behind N" is not actionable — the caller cannot decide whether to keep
waiting, cancel, or escalate. The payload is position plus the entry's
identity (so the wait can be cancelled or queried later). The caller's
obligation: treat this as a promise held by the queue — do **not**
resubmit, because resubmission of a queued request is how callers convert
one unit of demand into N.

**Refused.** The request will never run *from this submission*, and the
verdict says *why*, from a closed reason taxonomy. The payload is the
reason; the caller's obligation is reason-dependent, which is the whole
argument for reasons-as-data.

## Refusal reasons are data, not prose

The reason taxonomy is small, closed, and machine-readable, because each
reason routes to a different caller reaction:

| Reason | Meaning | Correct caller reaction |
| --- | --- | --- |
| **queue-full** | depth bound reached; shed policy refused this arrival | back off and retry later; reduce submission rate |
| **over-quota** | this tenant/class exceeded its budget | reduce demand or wait for the budget window; retrying sooner is self-harm |
| **resource-pressure** | the host gate is closed | retry after a delay; the condition is environmental and will clear |
| **draining** | the system is shutting down; no new promises | resubmit to the next incarnation, or fail over |
| **invalid** | the request could never run (malformed, unauthorized) | do not retry; fix the request |

Free-text reasons fail twice: callers cannot branch on them, and two
emitting sites drift into two spellings of the same condition
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
— the taxonomy has one definition, and every gate that refuses draws from
it). The retryable/non-retryable split above is the load-bearing bit: a
caller that retries `invalid` loops forever, and a caller that abandons on
`resource-pressure` gives up on work that thirty seconds of patience would
have completed. Classification for retry is retry-backoff's subject; the
queue's duty is to emit reasons precise enough to classify.

## Refusal is a result, not an exception

Shed, quota, and pressure refusals are the queue *working as designed* —
they are the system's healthy immune response to overload. Modeling them as
thrown errors mingles them with genuine faults (the queue's own storage
failed, the gate crashed) in every log, every alert, and every caller's
error path
([failure-not-empty-success](../../_laws.md#failure-not-empty-success),
applied in reverse: designed refusal must also be spelled differently from
malfunction). The verdict is a **return value** with three arms; exceptions
are reserved for the queue itself breaking. A practical test: if the
on-call engineer would page on it, it may be an exception; if the caller
should branch on it, it is a verdict.

## One gate, one vocabulary

Admission is frequently a *composition* of gates — depth check, quota
check, host-pressure check, drain check — and the composition must still
emit one verdict from the one vocabulary. Two failure shapes to refuse:

- **Per-gate vocabularies.** Each check inventing its own result type
  forces every caller to normalize N vocabularies into one, and each caller
  normalizes differently. The gates report *into* the shared verdict; the
  reason field says which gate spoke.
- **Vocabulary bypass.** A second entry point that admits work without
  passing the gate — a debug path, an internal caller, a migration script —
  is not an exception to the vocabulary; it is a writer that skipped the
  door. The set of paths that can start work must be enumerable, and all of
  them speak the verdict.

## The verdict is atomic, and it comes first

Two sequencing rules keep the vocabulary honest at the mechanics level:

- **Check-and-take is one operation.** The verdict "admitted" *is* the
  acquisition of capacity — a gate that first asks "is there room?" and
  then, separately, takes the room has opened a window in which N
  simultaneous arrivals all see room for one. The admission call returns
  the verdict and, when the verdict is admitted, has already claimed the
  seat; there is no legal state between.
- **The verdict precedes the durable record.** Writing "started" into
  persistent storage *before* asking the gate creates a record that
  survives refusal — a run that every later reader believes is in flight
  and that nothing will ever finish. The honest order is verdict first,
  record second, and the record spells the verdict's own vocabulary: a
  queued entry is durably *queued*, not optimistically *running*.

## The verdict is also the record

Whatever the queue tells the caller, it tells its own telemetry: every
verdict is countable by outcome and reason, because "how often do we
refuse, and why" is the first question of capacity planning and the first
sign of an approaching incident. A queue that refuses silently — returns
refusals to callers but keeps no aggregate — has the data and discards it
at the moment of maximum value.
