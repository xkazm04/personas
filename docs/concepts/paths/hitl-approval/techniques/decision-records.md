---
layer: technique
subject: hitl-approval
technique: decision-records
status: forged
laws: [identity-survives-reuse, deletion-is-not-repair, failure-not-empty-success]
shared_with: []
---

# Decision records

A verdict that exists only as a state flip answers one question — "may this
proceed?" — and then is gone. A decision *record* answers the questions that
arrive later, which are the ones that matter: who authorized this, what
exactly did they authorize, what were they shown when they said yes, and does
that authorization cover the thing now being attempted. The record is the
memory of the approval mechanism, and a mechanism without memory re-litigates
or over-extends every decision it has ever produced.

## The record's shape

Five fields are load-bearing; systems that drop one develop the corresponding
blindness:

| Field | Without it |
| --- | --- |
| **who** — the authenticated decider (a person, or a named grant acting for one) | accountability dissolves into "the system approved it" |
| **verdict** — approved, rejected, edited-then-approved, expired, withdrawn | outcomes collapse into a boolean that cannot distinguish refusal from timeout |
| **when** — decision time, alongside ask time | latency is invisible; nobody learns that decisions take three days |
| **what, exactly** — the gated entity's identity *and* the version/fingerprint of the content or bound parameters at decision time | approval floats free of its object and drifts onto whatever the object becomes |
| **what was shown** — the disclosure the decider saw | "informed consent" cannot be demonstrated, only asserted |

The **why** — a reason, mandatory on rejection, optional on approval — is the
sixth field and the cheapest telemetry in the subject: rejection reasons are
what tune triggers, and an edited-then-approved diff is a correction signal no
other instrument captures.

## Bound to a version, keyed to an identity

The record points at the gated entity by durable identity and pins the
content by version or fingerprint
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). Both
halves are necessary: identity without version lets an approval follow an
object through arbitrary mutation; version without identity lets an approval
be replayed against a copy. The executor's check at the door is then
mechanical — same entity, same fingerprint, verdict says open — and anything
else re-closes the gate. This is the record doing enforcement work, not just
archival work.

## The reuse boundary

An approval is a fact about one tuple: **this actor approved this action on
this target at this version in this context**. Every extension beyond the
tuple is a new decision:

- approval of one item is not approval of the next item of the same kind —
  *unless* a recorded consent grant explicitly covers the kind;
- approval given in one context (one project, one workspace, one run) stops
  at the context edge;
- approval of a plan is not approval of the actions the plan turned out to
  require — per-boundary gates exist precisely because plans drift.

The boundary is enforced structurally, not by good taste: the door matches
the attempted action against the record's tuple, and a mismatch asks. Where
broader reuse is *wanted*, the instrument is an explicit scoped grant (the
consent-gates technique), which is itself a record with these same fields —
never an inference from past verdicts. Inferred consent is scope creep with
a paper trail that appears, on audit, to justify it.

## Append-only, superseded not edited

Decision records are immutable. A reversed decision — approval withdrawn,
rejection reconsidered — is a **new record that supersedes the old one**, so
the trail reads: approved at T1 by A, revoked at T2 by B, re-approved at T3.
Editing or deleting a verdict in place destroys exactly the evidence the
record exists to preserve, and deleting embarrassing decisions is the audit-
trail version of deleting a failing test
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)). The
supersedence chain also carries the operational truth the flip cannot: at any
moment, the *effective* verdict is the head of the chain, and the history is
the account of how it got there.

## The write is part of the gate

The record is written **in the same atomic step as the state transition** —
a verdict recorded without the transition, or a transition without the
record, is corruption in opposite directions, and both must be impossible
rather than unlikely. When the write fails, no verdict happened: the item is
still pending, the surface says so, and the human clicks again
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)). The
tempting shortcut — flip the state now, log the record on a queue for later —
produces gates whose openings have no witnesses precisely on the days the
logging pipeline is unhealthy, which are the days someone will want the
witnesses.

## Records feed the trigger loop

The record set is the dataset for keeping the mechanism alive. Approval rates
near 100% over a meaningful window say a trigger is below the judgment
threshold — the gate is collecting clicks, not decisions — and belongs at a
higher threshold or inside a consent grant. Rejection clusters say the
opposite: the machine keeps proposing something humans keep refusing, which
is a defect upstream of the gate. Decision latency says whether the queue and
its notifications are working. None of these can be read from state flips;
all of them fall out of records with the six fields, which is the argument
for the six fields.
