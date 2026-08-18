---
layer: technique
subject: audit-logging
technique: retention-and-partitioning
status: forged
laws: [creation-names-reaper, count-carries-predicate]
shared_with: []
---

# Retention and partitioning

An audit trail without retention policy grows until something else — the
disk, query latency, a privacy complaint — imposes one at the worst
possible moment. An audit trail with one *global* policy averages
incompatible obligations: security events a reviewer needs for a year and
routine operational events nobody reads after a week either both cost a
year of storage or both vanish in a week. This technique is the pair of
decisions that prevents both failures: **each ledger states its own
horizon, and the horizon is enforced by the same path that inserts
records.**

## Retention is enforced at insert

The reaper for audit records is not a scheduled cleanup job someone
configures later; it is part of the insert path
([creation-names-reaper](../../_laws.md#creation-names-reaper) applied
literally — the door that admits record N retires the records beyond the
horizon, so admission and expiry are one code path that cannot drift
apart). The properties this buys:

- **The bound is an invariant, not a trend.** The ledger's size is
  maintained continuously; there is no window in which a burst outruns a
  nightly job, and no failure mode in which the cleanup job silently
  stops running while inserts continue (a scheduled reaper that dies
  produces no error — only growth, noticed at the disk-full incident).
- **The policy is discoverable where writers look.** A contributor
  reading the door reads the horizon; policy-in-code at the chokepoint
  beats policy-in-a-runbook every time someone new asks "how long do we
  keep these?"

Horizons come in two shapes and mature ledgers usually state both: an
**age bound** (records older than D are retired — the shape compliance
obligations use) and a **count bound** per ledger or per key (at most K
records — the shape that hard-caps storage and query cost against a
runaway writer). A count bound *scoped per key* — per credential, per
actor, per entity — has a property worth naming: a noisy entity trims
only its own history, and cannot evict the quiet entity's evidence.
Enforcing the trim inside the insert keeps its cost amortized and small
(the trim condition is checked on the code path that changed the
answer).

Trimming coexists with append-only because retirement is not repair:
whole records beyond a stated horizon leave by policy, which is a
different act — visible, uniform, content-blind — from editing or
deleting a record *because of what it says*. The door exposes the
horizon-trim; it still exposes no targeted delete. Where the ledger is
hash-chained, trims land on checkpoint boundaries (see
[append-only-design](append-only-design.md)).

## Partition by obligation, not by convenience

Ledgers are separated **by domain**, where a domain is defined by its
retention obligation and its reader: security-relevant actions,
credential lifecycle events, configuration changes, operational
housekeeping. The forcing argument is that a single pooled ledger makes
every retention decision a compromise: the longest obligation sets the
storage bill for all domains, or the cheapest domain's horizon quietly
truncates the one that mattered. Separate ledgers give each domain its
own horizon, its own volume budget, its own access rules for readers (a
support role that may read operational events has no business in the
security ledger), and independent failure — one domain's runaway writer
fills its own cap.

The counterweight is real and gets stated: partitioning multiplies doors
(each ledger has one — the chokepoint discipline applies per ledger),
and incident reconstruction often needs a **cross-ledger timeline**. So
partitioned records share a common core schema (actor, action, subject,
time, outcome, origin) and correlation handles, so a reader can merge
ledgers by time and correlate by handle without the ledgers sharing
storage. Partition storage and policy; standardize shape.

## Tagging keeps aggregates honest

Within a ledger, records carry an **origin tag** — which subsystem
emitted them — as a first-class field from day one. The failure this
prevents is subtle and recurrent: a dashboard counts "administrative
actions this week," a new subsystem starts writing to the same ledger,
and the count silently absorbs events its predicate never meant
([count-carries-predicate](../../_laws.md#count-carries-predicate) — a
count whose population can grow without its predicate changing is a
number drifting away from its own meaning). With origin tags, every
aggregate filters explicitly, new origins are visible as new tag values
the moment they appear, and retention can even differ *within* a ledger
by origin where obligations demand it without splitting storage.

Origin tags come from a controlled vocabulary with one authority — the
tag is an enum the door validates, not a free string each writer
invents, or the tag set fragments into synonyms and the aggregates it
was meant to protect miscount anyway.

## Deletion requests meet the immutable ledger

Privacy-driven erasure and append-only retention collide head-on, and
the resolution belongs in the design, not in the crisis: the ledger
holds **identifiers, not personal attributes** (see
[write-path-sanitization](write-path-sanitization.md)), so erasure of a
person resolves to erasing the mutable record the identifier points at —
the trail keeps "actor 7f3 deleted project 12" while "actor 7f3" ceases
to resolve to a person. Where regulation demands more, the horizon
itself is the argument: a stated, enforced, short-as-obligations-allow
retention window is the difference between "we keep it as long as the
law requires" and "we keep it forever," and only the first survives a
privacy review.
