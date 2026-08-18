---
layer: technique
subject: delivery-guarantees
technique: dead-letter-design
status: forged
laws:
  - creation-names-reaper
  - deletion-is-not-repair
  - failure-not-empty-success
shared_with: []
---

# Dead-letter design

The dead-letter lane is where the pipeline's honesty becomes visible: every
event the system promised to process and could not, held as a complete record
in front of a human who can decide. The name misleads twice. It is not
*dead* — most of its contents are retryable the moment someone fixes the
cause — and it is not a *letterbox* — a table nobody opens is
indistinguishable from the silent drop it was built to prevent. **The dead
letter is a destination with a workflow, not a void with a schema.** Design
the record, the surface, the verbs, and the retention as one artifact;
shipping the record without the surface is the most common half-build in this
subject.

## Anatomy of the record

A dead-letter record must let a human decide *retry, discard, or fix-first*
without consulting any other system:

- **the original payload, whole** — the event as accepted, not a summary.
  Redelivery needs it verbatim; diagnosis needs the field that broke the
  handler. If payloads are large, the record holds a durable reference whose
  lifetime exceeds the record's own retention — a reference that expires
  first turns the record into a tombstone;
- **the event's identity and provenance** — the id minted at acceptance,
  the source, the event type; everything dedup and correlation key on;
- **the failure story** — final error verbatim, attempt count, first-seen
  and last-attempt timestamps, and *how* it escalated (exhaustion, permanent
  classification, reaped crashes, staleness). Escalation kind is the first
  triage split: crashes and validation rejections route to different humans;
- **lineage** — if this event was redriven before and died again, the record
  says so. Repeat offenders are a different class of problem than first
  arrivals;
- **triage state** — untouched, investigating, redriven, discarded-by. The
  lane is a queue humans work, and queues need workflow state or two
  operators triage the same record.

## The surface and its verbs

The lane earns its existence at the surface: a visible, filterable view —
by event type, source, escalation kind, age — with per-record inspect and
two verbs. One display move multiplies the operator: **cluster records by
similarity of their failure story** (tokenize the error, strip the volatile
parts — ids, ports, timestamps — group what remains), so a 400-record outage
reads as three causes rather than 400 rows. Cohorts get dead-lettered by one
cause and fixed by one fix; the surface should present them that way.

**Redrive** re-enqueues the event as pending with its original identity and
payload, resets the attempt campaign, records lineage (see
retry-escalation's reset rule). The redrive contract is honest about what it
does not do: it does not fix the cause. Redriving into an unchanged handler
manufactures the same dead letter with a longer history — useful exactly
once, as a diagnostic.

**Discard** is a human verdict, recorded with who and why. It is the *only*
legitimate exit that destroys the obligation, precisely because a person saw
the record first — automated deletion of unprocessed work anywhere else in
the pipeline is the silent drop this subject exists to prevent (law:
deletion-is-not-repair — and when a human *has* judged the record, discard
is not repair either, it is triage; the law forbids deleting the evidence
*instead of* judging it).

**Bulk forms of both verbs are mandatory at scale** — outages dead-letter
cohorts, and cohorts get fixed by one cause — and bulk verbs carry a
non-negotiable contract: **partial-failure reporting.** "Redrive these 400"
will succeed for 397; the response names the 3 and why, and the 3 remain in
the lane in a state that says redrive-failed. A bulk verb that reports only
a total, or worse only success, re-creates inside the triage tool the exact
silent-loss failure mode the lane was built against.

## Retention names its reaper

The lane grows during exactly the incidents that make it valuable, so it
needs its own lifecycle (law: creation-names-reaper): a retention window per
escalation kind, an explicit policy for what expiry does — and expiry is a
*second* dead-lettering decision, not a rolling delete. Aging out a record
nobody triaged is the system giving up twice; at minimum the expiry writes a
non-delivery ledger entry (see non-delivery-ledgers) so the loss survives as
a reason even after the payload is gone. A lane with no retention policy has
one anyway — the store's disk — enforced at the worst possible moment.

## Decision rules

- **The lane is monitored by count and by age.** Two alarms: arrivals-rate
  (a burst is an active incident) and oldest-untouched (a stale queue means
  the workflow, not the pipeline, is broken). A dead-letter lane without
  alarms relies on someone visiting a page they only visit when alarmed.
- **Bind the lane to the failures you actually have.** The measured failure
  mode: a beautifully built lane — clustering, bulk verbs, per-item outcome
  reporting — wired to the one failure class that never occurs, while the
  failure class with all the volume accumulates in a parallel inbox that has
  weaker verbs and no retry, and goes unacknowledged for months. Every
  terminal failure class in the system routes to *some* surface with triage
  verbs; when a second failure store grows next to the lane, either give it
  the lane's verbs or route its contents through the lane. Two queues split
  the attention neither can afford alone.
- **Per-class lanes when audiences differ.** One physical table is fine; one
  undifferentiated *view* is not, once records route to different fixers.
  The filter set is the router.
- **Test the redrive path before the incident.** Redrive is exercised rarely
  and under pressure; an untested redrive that corrupts identity or skips
  dedup turns triage into a duplicate-effect incident. The redrive must go
  through the same acceptance door as a fresh event, minus the re-minting of
  identity.
- **The lane is evidence, not shame.** A healthy pipeline dead-letters
  things — senders send garbage, dependencies die permanently, payloads age
  out. Zero dead letters forever means either perfection or a threshold set
  to infinity, and only one of those exists (law: failure-not-empty-success
  applies to the lane itself — verify the escalation path fires, or the
  empty lane is unfalsifiable).
