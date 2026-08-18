---
layer: technique
subject: audit-logging
technique: best-effort-with-accounting
status: forged
laws: [failure-not-empty-success, count-carries-predicate]
shared_with: []
---

# Best-effort with accounting

Two non-negotiable requirements collide at every audit write. The trail
must never fail the action it records — an observer that takes down the
observed has inverted its purpose. And the trail must never *silently*
miss an action — a ledger with unknown gaps is not evidence, it is a
sample of unknown bias presented as a census. Most implementations honor
the first requirement and stop; this technique is the second half, and
the second half is what separates a trail an auditor trusts from one
they merely receive.

## Half one: the write never blocks the action

The audit insert is wrapped so that no failure of the ledger — storage
contention, a full disk, a serialization bug — propagates into the
recorded operation's result. This is a deliberate ranking of harms:
losing one record is a bounded, countable loss; failing every operation
in the product because the ledger hiccuped is an outage caused by the
accountability system. The wrap is total (no exception class escapes)
and the operation's latency budget is protected too — an audit store
that turns slow must not make every user action slow, which is why
ledgers under load move the write off the operation's critical path
(buffered, flushed asynchronously), accepting the accounting obligations
below.

The rank ordering has one honest exception, decided per ledger and
written down: a domain where the record *legally must* precede the action
(rare, and the requirement will name itself loudly) is not running
best-effort audit — it is running a transaction in which the record is a
participant, a different design with different costs. Every ledger that
has not explicitly claimed that exception is best-effort.

## Half two: every miss is counted, and the count is surfaced

Swallowing the failure is where the naive implementation ends and where
the trail's integrity quietly dies: each infrastructure hiccup now
punches an invisible hole, and the holes cluster at the worst times —
under load, during incidents — which is exactly when the trail will
later be read. The fix
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):
the catch block does two things, always —

1. **increments a durable counter** of failed audit writes, keyed by
   ledger and failure class, kept somewhere that does not share fate
   with the ledger whose failure it counts (a counter stored next to the
   records it counts misses exactly the failures that matter);
2. **emits to the diagnostic channel** so an engineer can pursue the
   cause — the diagnostic line is for repair, the counter is for
   honesty, and neither substitutes for the other.

"Surfaced" means on a health surface someone actually watches — the same
dashboard that shows the system's other integrity signals — not
retrievable-in-principle. The number's meaning is its contract
([count-carries-predicate](../../_laws.md#count-carries-predicate)):
"audit-write failures, per ledger, since T" — a predicate that lets a
reviewer say "the trail for window W has at most N known gaps," which is
the strongest statement a best-effort trail can truthfully make, and a
perfectly acceptable one. Trails lose their authority not by having
gaps but by having gaps that surprise.

A non-zero counter is an operational signal with a required response:
alert past a threshold, investigate the failure class, and — for
domains that warrant it — write a gap-marker record into the ledger
once it recovers ("N writes failed between T1 and T2"), so the trail
itself discloses its blind window to future readers who never saw the
dashboard.

## Buffering changes the accounting, not the obligation

Moving writes off the critical path introduces new loss modes that the
counter must also cover: records buffered but not yet flushed die with a
crash; a bounded buffer overflows under burst. The rules:

- a bounded buffer that drops **counts every drop** (an unbounded buffer
  merely relocates the outage to memory);
- flush failure re-enters the retry-or-count path — retried with a cap,
  then counted, never retried forever (an eternal retry queue is an
  unbounded buffer wearing a different name);
- crash loss is bounded by flush interval, and that bound is a stated
  property of the ledger ("at most the last K seconds of records can be
  lost to a crash"), because a stated bound is something an auditor can
  reason about and an unstated one is a surprise.

## The paradox, restated as a contract

The deliverable of this technique is one sentence the team can say to an
auditor with a straight face: *"Audit writes never block operations; every
failed or dropped write is counted; the counter is on our health surface;
here is its current value and here is what we do when it rises."* Both
halves, verifiable. An implementation that can only say the first clause
has built the easy 80% and skipped the 20% that was the point.
