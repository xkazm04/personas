---
layer: technique
subject: hitl-approval
technique: review-queues
status: forged
laws: [failure-not-empty-success, count-carries-predicate, creation-names-reaper]
shared_with: []
---

# Review queues

A gate produces questions; the queue is where questions wait to be answered.
Scattered pending items — one surfaced in a toast, one buried in a detail
view, one visible only if the right tab happens to be open — produce the
characteristic failure of half-built approval systems: work stalls not
because a human said no but because no human ever saw the question. The queue
is the mechanism's inbox, and it has one job: **every pending decision,
one surface, enough context to decide in place.**

## One surface, complete by construction

The queue's completeness must be structural: it renders *the pending set from
the system of record*, not a curated feed that gates opt into. When a new
gate class is added, its items appear in the queue because pending state is
where the queue looks — not because someone remembered to wire a
notification. A queue that can be incomplete converts every missed wiring
into an invisible stall, and stalls at human-decision boundaries are the
slowest bugs in any system to diagnose, because both parties believe they are
waiting on the other.

Completeness has a display corollary: the badge. The number that draws the
human to the queue carries its predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)) —
"pending *your* decision", not a grab-bag of unread things — and it derives
from the same query the queue renders. A badge that says three where the
queue shows two teaches the human the badge lies, and a lying badge is
uninstalled attention.

## Context to decide in place

Each queue item carries what a responsible person needs to render the verdict
*without leaving the queue*:

- **the thing itself** — the content, diff, or bound parameters under
  decision, not a title that links to a hunt;
- **why it is gated** — which trigger fired: first use, spend threshold,
  external visibility, low confidence. The reason calibrates the scrutiny;
- **provenance** — which agent or process asks, in the course of what task,
  triggered by what;
- **consequence framing** — the impact disclosure, in the units of
  consequence (recipients, amounts, reversibility);
- **the clock** — when it was asked and when it expires, so triage can order
  by urgency honestly.

An item that requires navigating elsewhere to understand will be decided
without navigating elsewhere. That is not a prediction about lazy users; it
is a queue-design constant, and the design either budgets for it or launders
blind approvals through it.

## Batch verdicts: legitimate and illegitimate

Homogeneous items are one decision. Twenty pending items of the same shape,
same risk class, and same provenance — twenty routine records from the same
scan, twenty messages of the same template — are honestly decidable as a
group, and forcing twenty clicks where one judgment occurred *manufactures*
fatigue. Support select-all-of-a-kind and a single verdict.

The boundary is homogeneity. Batch approval across *heterogeneous* items —
"approve all" over a mixed queue of spend, deletion, and outbound messages —
is not a decision, it is the rubber stamp with better ergonomics. The surface
should make the homogeneous batch easy (group by kind and provenance, verdict
per group) and the heterogeneous sweep deliberately absent. If operators
routinely want the sweep, that is not a UI request; it is data that the
triggers fire too often, and the fix belongs at the trigger.

## The verdict write must land

The click is the mechanism's whole point, so its persistence is engineered
like a payment, not like a preference:

- **Verdict and state transition commit together.** The decision record and
  the gate's `pending → open/rejected` move are one atomic write. A verdict
  recorded without the transition strands an approved item as pending; a
  transition without the record produces an unaudited approval — both are
  corruption, not lag.
- **Failure is loud and the item stays.** If the write fails, the item
  remains visibly pending and the surface says the verdict did not land
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
  The forbidden outcome is optimistic removal: the human saw it leave, the
  store never heard, and the question is now invisible to the only person
  who could answer it.
- **Concurrent verdicts resolve to one winner.** Two reviewers deciding the
  same item race; the second write must observe the state moved and report
  "already decided by X", never overwrite. The queue reflects decisions made
  elsewhere by removing settled items on refresh — a queue is a view of
  state, not a copy of it.

## Queue hygiene

A pending item is created state and names its reaper
([creation-names-reaper](../../_laws.md#creation-names-reaper)). Items expire
on the schedule the gate declared, resolving to the safe default (deny or
hold, never proceed), and the expiry is itself recorded — "expired
unanswered" is an outcome the audit trail must distinguish from "rejected".
Two structural rules govern the reaping:

- **Expiry is a write, not a read-side filter.** Hiding stale items from the
  list, or refusing them at the executor, leaves them alive — pending to
  every query, absent from every screen, unanswerable by anyone. An expired
  item gets a status transition with a reason, performed by a sweep.
- **One clock for every hold in the system.** When one queue expires in days,
  a second never expires, and a third auto-resolves on a schedule nobody
  connected to the other two, the operator generalizes from whichever queue
  they saw first — and the generalization is wrong twice. Two queues with two
  expiry policies are worse than two with none, because now the operator
  *believes* items expire. Pick the policy once, apply it to every hold, and
  let genuine exceptions be declared, not accreted.
An unbounded queue where dead questions accumulate under live ones does
double damage: it buries the decisions that still matter, and it normalizes
scrolling past pending items, which is fatigue's front door.

Ordering completes the hygiene: the default sort puts *expiring-soonest and
highest-consequence first*, because the queue's job is to spend the human's
next minute where judgment matters most. Chronological order is an archive's
job; the queue is triage.
