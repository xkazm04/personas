---
layer: technique
subject: admission-queue
technique: priority-and-fairness
status: forged
laws: [identity-survives-reuse, count-carries-predicate]
shared_with: []
---

# Priority and fairness

Queue order is a policy even when nobody wrote one: plain arrival order
*is* a scheduling policy, and under mixed workloads it is usually the
wrong one. The moment requests differ in urgency or in origin, the
designer owes the queue two explicit answers — **who goes first**
(priority) and **who may occupy how much** (fairness) — plus the repair
for the pathology both answers create (starvation).

## Priority: ordering by urgency

Priority levels exist because wait tolerance differs by orders of
magnitude across request classes. The person watching a screen tolerates
seconds; the nightly batch tolerates hours; putting them in one
arrival-ordered line optimizes neither. Discipline for the levels:

- **Few, named, and meaningful.** Two or three levels with stated
  semantics ("interactive: a human is waiting", "standard", "bulk:
  deadline is a day") outperform a numeric free-for-all. Open numeric
  scales suffer priority inflation — every caller's work is important to
  its caller, and within a release cycle everything is maximum.
- **Assigned by the class of the request, not the mood of the call
  site.** The mapping from request kind to level has one authority;
  scattering level choices across call sites re-creates the vocabulary
  drift this corpus's laws exist to kill.
- **Priority orders the wait; it does not skip the gate.** A
  high-priority request still receives the same three-verdict admission —
  it queues ahead, it does not stampede past depth bounds or host
  pressure. (The one principled exception: reject-by-class shed, where
  the bound itself is priority-aware — that interaction is
  [depth-bounds-and-shed](depth-bounds-and-shed.md)'s ground.)

## Fairness: bounding occupancy per origin

Priority is about urgency; fairness is about **origins** — tenants, users,
features, projects — and the queue's duty not to let one origin buy the
whole line at the price of showing up first. The failure is quiet: one
eager origin enqueues fifty requests, every gauge reads healthy (depth
fine, throughput fine), and forty-nine other origins each experience a
dead system. Aggregates hide it by construction
([count-carries-predicate](../../_laws.md#count-carries-predicate): "depth
50" without "of which 48 from one origin" is the number that conceals the
outage).

The instrument is the **per-origin cap**: each origin may hold at most K
units of occupancy — running plus queued — and requests beyond K are
refused with the over-quota reason or held in a per-origin overflow that
does not consume shared positions. Two subtleties:

- **Cap the occupancy, not the submission.** An origin resubmitting a
  refused request costs nothing; an origin *holding* fifty positions
  costs everyone. The cap counts held capacity.
- **Snapshot the cap at enqueue.** The origin's limit is read once, when
  the entry joins, and travels with the entry. Re-reading configuration
  at every drain decision makes promotion order depend on config timing —
  an entry admitted under one limit and promoted under another is a
  race with a policy.

## Starvation, and aging as the repair

Every preference mechanism starves whatever it deprioritizes. Strict
priority starves the lowest class the moment upper-class arrivals are
continuous; per-origin caps starve nobody but can hold work back
indefinitely under sustained same-origin demand. The designed repair is
**aging**: an entry's effective priority rises with time waited, so
nothing waits unboundedly regardless of class. Aging converts "low
priority" from "may never run" into "runs later" — which is what every
caller assumed it meant. Where aging is rejected (a genuinely
sacrificial class that *should* starve under load), that is a legitimate
choice made in writing — the class's callers must know their tier means
"only in slack".

The starvation test is measurable, not rhetorical: **oldest-wait per
class and per origin**, watched over time. If any class's oldest-wait
grows without bound while the system serves others, starvation is
occurring, whatever the design intended. That instrument lives in
[wait-telemetry](wait-telemetry.md).

## Identity under reordering

Priority and fairness *reorder the queue*, and reordering is where weak
entry identity dies
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
Position is not identity: an entry's position changes on every promotion,
every shed, every priority bump, so anything keyed by position — a
cancellation, a status query, a duplicate check — targets whoever happens
to stand there now. Entries carry identity minted at enqueue; position is
a *view*, recomputed freely; cancellation and query address the identity.
The same discipline covers requeue: an entry that is parked and
re-admitted, or refused and legitimately resubmitted, is a **new
admission of the same logical request**, and the design says which
identity persists (the logical request's, for dedup) and which is fresh
(the queue entry's, for this wait).

## Fairness is layered, like the caps it extends

A per-origin cap inside one queue arbitrates that queue. It cannot see
demand the origin routes around it — other queues, other hosts, direct
execution paths. Fairness enforced at one gate while other doors admit
freely is fairness in name; the set of doors must be enumerable, and the
policy applied where they converge. (At the process layer, the same
layered-caps reasoning appears in
[concurrency-and-slots](../../subprocess-lifecycle/techniques/concurrency-and-slots.md)
— global cap for the machine, per-class and
per-tenant for the mix and the fairness; this technique is the
queue-side face of that structure.)
