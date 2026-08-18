---
layer: technique
subject: triage-queues
technique: queue-lifecycle
status: forged
laws:
  - creation-names-reaper
  - deletion-is-not-repair
  - derivation-names-recomputation
shared_with: []
---

# Queue lifecycle

A queue is a flow, and flows are designed at their boundaries: what may
enter, what must leave, and what every transition records. This technique
owns the item's whole arc — arrival, deduplication, residence, resolution,
expiry — under one governing rule: **every item, at the moment it enters
the queue, has a named exit**
([creation-names-reaper](../../_laws.md#creation-names-reaper)). An item
that can only leave "when someone gets to it" has no reaper; multiply it by
a producer that raises faster than operators resolve, and the queue's death
by accumulation is not a risk but a schedule.

## Arrival: dedup before display

Producers repeat themselves. Monitors re-detect the same condition every
cycle; scanners re-raise the same finding every run; retries re-emit the
same failure. Deduplication at the entrance folds repeats into one item
with an occurrence count and a last-seen timestamp — which is not merely
tidier but *more actionable*: "this has fired 40 times since Tuesday" is
judgment-relevant information that 40 separate rows actively conceal, while
also burying the rest of the queue. Dedup requires a declared identity-of-
condition (which fields make two raisings "the same item") — this is the
adapter's knowledge, per source, applied at the one entrance. A deduped
item that receives a new occurrence after being resolved is a *new* item:
folding into a resolved item would hide a recurrence, and recurrence is
signal.

## Residence: the badge must be recomputable

While items sit in the queue, the rest of the product wants a number — a
badge, a headline count, a per-source breakdown. Every such displayed count
is a derived value and must name its recomputation: derived live from the
remaining-set, or, where cached for cheap display, refreshed by a stated
trigger from the same source of truth the queue itself reads
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
The badge that drifts from the queue — showing 3 when the queue shows 0 —
teaches the operator to distrust both, and by the fatigue economics of the
golden path, distrust is the one unrecoverable failure.

## Resolution is a record, not a removal

A verdict does not delete the item; it transitions it to a terminal state
*recorded at the owning system* — resolved, dismissed, escalated, with
when and by what. Three things depend on this being a record:

- **Dedup integrity.** "Have we seen and dismissed this before" is only
  answerable if dismissals persist.
- **Producer feedback.** The dismissal rate per source — the golden path's
  instrument for detecting predicate-violating producers — is computed
  from resolution records.
- **Undo.** The reversible half of [bulk-triage](bulk-triage.md) restores
  a recorded state; there is nothing to restore after a deletion.

## Expiry: aging out is a policy, not a purge

Items the operator never reaches must eventually leave — but expiry has one
safe shape: a *stated* policy (age threshold per severity class), moving
the item to a *distinct terminal state* (expired, not resolved), *visible*
in the resolution records it leaves behind. Auto-expiry that masquerades as
resolution poisons every metric downstream — the dismissal-rate instrument,
the "was this handled" audit, the dedup memory — because it books the
operator's judgment on items no one judged.

And expiry must never become the system's coping mechanism for
over-production. A queue that stays navigable only because expiry deletes
the backlog is not healthy; it is discarding the evidence of a producer
that violates the actionable predicate
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)). The
expiry rate per source belongs on the same instrument panel as the
dismissal rate: both point at entrance-discipline defects, and the repair
is at the entrance — tune or demote the producer — not at the exit.
Special caution where a garbage collector shares its terminal vocabulary
with human verdicts: an automated sweep writing the *same* "resolved" state
an operator writes erases the distinction every downstream consumer of
those records depends on.

**All exits over one queue compose into a single de facto policy, and that
policy must be designed as one.** The population one exit declines is
exactly the population the remaining exits inherit. The canonical measured
failure: an automated triage door that deliberately refuses high-severity
items — "left for a human" — combined with an age-based sweep, written
independently, that reads no severity at all. Each module is individually
correct; together they guarantee the sweep's intake is *dominated by the
items the first policy protected*, quietly disposing of precisely the
decisions judged too important to automate — and, where those items held
other work, orphaning it without resumption. Review every exit against
every other exit: enumerate the doors out of the queue, compute which
population each one actually receives (not which it was written for), and
make the severities the system protects converge on a human or an
escalation, never on the janitor.

## The way back: deep links both directions

The queue is a router of attention, not a system of record. Every item
carries the address of its origin — the incident's page, the finding's
rule, the message's thread — so judgment can drill down when the summary is
not enough, and so the *origin* surface can show that its object currently
sits in the queue. The link must survive the item's departure: resolution
records that point back at their origin are what make last month's "why was
this dismissed?" answerable at all.
