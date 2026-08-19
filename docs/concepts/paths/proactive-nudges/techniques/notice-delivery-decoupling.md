---
layer: technique
subject: proactive-nudges
technique: notice-delivery-decoupling
status: forged
laws:
  - creation-names-reaper
  - failure-not-empty-success
shared_with: []
---

# Notice/delivery decoupling

The queue between noticing and interrupting — the structure that lets
evaluation run eagerly while delivery obeys budget and quiet policy,
without the suppressed signal being lost. Coupling the two acts is the
root defect of naive proactive systems: "evaluate, and deliver unless
blocked" collapses under any suppression into "evaluate, and forget."

## The pipeline

```
evaluators ──candidates──▶ [dedup/supersede] ──▶ notice queue ──▶ [policy gate] ──▶ delivery
                                                      ▲                │
                                                      └── deferred ────┘
```

- **Admission:** a candidate that survives dedup becomes a **notice** —
  a durable record with identity, payload, priority class, created-at,
  and expiry. Durable means it survives restart; a proactive system that
  loses its pending thoughts on every relaunch re-notices everything at
  boot, which manifests as the classic startup nudge-burst.
- **The policy gate** runs at delivery attempts: is the budget claimable?
  is the window open (or does this priority class cross it)? A notice
  that fails the gate returns to the queue as **deferred** — with the
  reason recorded, so "why didn't it tell me?" has an answer.
- **Window-open re-delivery:** when a blocking condition lifts — quiet
  window ends, day boundary resets the budget — the queue is drained
  through the gate again, oldest-eligible first by priority class. This
  is the payoff of the whole decoupling: the signal noticed at 02:00
  arrives at 07:01, not never.

## Aged notices are re-validated, then delivered or expired

A deferred notice is a claim about the world at notice time, and the
world moves. Two counterweights keep late delivery honest:

- **Re-validation before late delivery.** If the notice's subject can be
  cheaply re-checked (the incident got resolved overnight; the pending
  review was completed), check it at the gate and drop the notice —
  recorded as *obsolete*, not delivered as false news. Two equivalent
  implementations, pick per kind: re-run the originating evaluator at
  the gate and require it to still produce the same identity; or —
  often cleaner — keep the deferral window deliberately short and let
  expiry do the work, because the evaluator is idempotent: if the
  condition still holds, the next evaluation pass re-notices it with
  freshly derived text, and if it resolved itself, nothing re-fires —
  which is the correct outcome, reached without any gate-time recheck.
  The expire-and-refire form has one prerequisite: it only works for
  evaluator-driven kinds. A notice with no re-fire path (an explicit
  user-requested future check-in) must get a far more generous expiry,
  because expiring it destroys a promise nothing will restate.
- **Expiry.** Every notice carries an expiry set at admission — the
  reaper named at creation
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)).
  Expiry length is a property of the kind: "your long-running task
  finished" stays deliverable for a day; "you might want to look at this
  right now" decays in hours. Expired notices leave a trace with the
  count and reason; a silently shrinking queue is indistinguishable from
  a delivery bug
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

## Queue pressure

The queue's depth is a policy signal, and pressure gets an explicit
response rather than an emergent one:

- **Bounded depth per kind.** A kind whose evaluator produces faster than
  its budget drains does not grow an unbounded backlog; superseding (a
  newer notice replaces the older for the same identity) keeps most kinds
  at depth ≤ 1 per subject, and a hard per-kind bound with
  oldest-eviction-with-trace backstops the rest.
- **Pressure may legitimately influence delivery aggressiveness** — a
  deep queue of undelivered high-class notices is a reason to deliver at
  the next legal opportunity rather than waiting for an ideal moment —
  but never to breach budget or quiet policy. Pressure argues for
  *promptness within the rules*, not for exceptions.

## Decision rules

- One queue, all kinds. Per-kind side channels ("this kind is special,
  it delivers directly") are the decoupling's death by exemption — every
  policy gate must sit on the only road.
- Run the expiry sweep **before** the dedup check at admission, in the
  same pass. A row that has aged past its window is no longer a live
  claim on its identity; retiring it first lets the evaluator restate
  its case immediately instead of losing a full evaluation cycle to a
  ghost — the "dead tick" defect, invisible in testing and chronic in
  production.
- The delivery act is idempotent per notice identity: a crash between
  delivery and marking-delivered must not double-deliver on recovery;
  mark first or deliver-with-dedup at the presentation tier.
- Deferral reasons are enumerable (budget-kind, budget-global, quiet,
  awaiting-revalidation) and queryable; the operator view of the queue is
  part of the technique, not an afterthought.
