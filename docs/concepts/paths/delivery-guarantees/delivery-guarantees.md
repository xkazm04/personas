---
layer: golden-path
subject: delivery-guarantees
status: forged
techniques:
  - guarantee-selection
  - atomic-claiming
  - stuck-reaping
  - retry-escalation
  - dead-letter-design
  - non-delivery-ledgers
evidence:
  - src-tauri/src/engine/background.rs                          # atomic-claim tick, two-snapshot stuck reaper, EventGateReason typed non-delivery ledger
  - src-tauri/db/src/repos/communication/events.rs              # conditional-write claim_pending, one-UPDATE reap verdict, bounded retry→dead_letter, TOCTOU-guarded manual redrive w/ lineage
  - src/features/triggers/sub_dead_letter/DeadLetterTab.tsx     # triage surface: failure-mode clustering, filters, bulk retry/discard with per-item typed failure reporting
  - src-tauri/db/src/repos/resources/cloud_webhook_watermarks.rs # restart-safe dedup watermark so upstream redelivery doesn't duplicate
counter_evidence:
  - src-tauri/db/src/audit_incidents_promoter.rs                # the parallel failure inbox: promotes without retry/redrive verbs; the voluminous failure class routes here while the DLQ's class never occurs
deviations:
  - w9-delivery-guarantees   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-background-jobs   # claims record no holder/timestamp — anonymous claims force the heuristic two-snapshot reaper (anchor in docs/concepts/golden-path-deferred-fixes.md)
---

# Delivery guarantees & dead-letter

An event has been accepted. Ingress did its job — authenticated the sender,
validated the shape, wrote the event down, acknowledged receipt (that boundary
belongs to webhook-ingestion; this path begins one step later). The subject of
this path is the promise the system makes **after** acceptance: that the event
will be processed approximately once, that processing failure will not be
silent, and that an event the system decides *not* to process leaves a reason
behind. Acceptance without this discipline is the worst of both worlds — the
sender believes the work is done, and nothing guarantees it ever will be.

The stakes are quiet, which is what makes them dangerous. A dropped event does
not crash anything. A double-processed event does not log an error — it sends
the second notification, charges the second fee, appends the duplicate row, and
each individual incident looks like operator confusion rather than a systemic
defect. **Delivery bugs present as mysteries, not as failures**, and they
present far from the code that caused them. The entire discipline below exists
to convert those mysteries back into states: an event in this system is always
in exactly one named state, every transition is recorded, and every terminal
state that is not success carries a reason.

## The core stance: name your guarantee, then earn it

Every processing pipeline delivers each accepted event exactly once, at most
once, or at least once — whether or not anyone chose. The naive pipeline
chooses by accident, differently on different days: it is at-most-once when the
process dies after claiming and before finishing, and at-least-once when a
timeout fires and a second worker picks up work the first is still doing. The
accidental guarantee is the union of the failure modes, which is to say it is
no guarantee at all.

> **Exactly-once delivery across a boundary is an illusion. Honest systems are
> at-least-once with idempotent effects, or at-most-once with accepted loss —
> and the choice is made per event class, in writing, by analyzing what a
> duplicate of *this* event's effect costs.**

The consequences of that stance form the spine of this subject:

1. **The guarantee is selected, per event class, from the three honest
   postures.** At-most-once for events whose duplicate is worse than their
   loss; at-least-once plus deduplication for events that must not be lost;
   the exactly-once *experience* only ever emerges from at-least-once delivery
   composed with idempotent or deduplicated effects (see guarantee-selection).
2. **The claim is atomic and carries evidence.** The transition from *pending*
   to *processing* is a single conditional write that exactly one worker can
   win, and the winning claim records who holds it and since when. A claim
   without holder and timestamp forces every later question — is this stuck?
   whose is it? — to be answered by guessing (see atomic-claiming).
3. **Stuck is a state you plan for, not a surprise you debug.** Claimed-then-
   died work is a certainty at scale, so the design ships with a reaper: a
   supervised sweep with an explicit policy for what a stale claim becomes —
   requeued, dead-lettered, or discarded — and evidence-based criteria for
   *stale* (see stuck-reaping).
4. **Retries are counted, bounded, and escalate.** Each failed attempt
   increments a persisted counter; the counter has a threshold; crossing the
   threshold is a state transition into the dead-letter lane, not a bigger
   number. A retry counter that increments forever is a dead letter without
   the letter — the failure is permanent in every sense except visibility
   (see retry-escalation). How long to wait *between* attempts is the
   [retry-backoff](../retry-backoff/retry-backoff.md) subject's discipline;
   this path owns the count and the escalation.
5. **The dead letter is a destination, not a void.** Events that exhaust their
   retries land as complete, triageable records on a surface a human actually
   looks at, with per-item and bulk retry/discard verbs. A dead-letter lane
   nobody can see is a `/dev/null` with extra steps (see dead-letter-design).
6. **Every non-delivery has a recorded reason.** Skipped by policy, gated by a
   condition, suppressed by a duplicate check, expired by staleness — each is
   a typed reason token written where an operator can query it, never a silent
   drop and never a bare null. Silence and skip must be spelled differently
   (see non-delivery-ledgers).

## The event lifecycle — one state machine, no informal states

Every accepted event lives on this spine:

| State | Meaning | Legal exits |
|---|---|---|
| **pending** | accepted, not yet claimed | → processing (atomic claim) · → skipped (gated, with reason) |
| **processing** | claimed by an identified holder | → done · → pending (retry, counter +1) · → dead-lettered (threshold) |
| **done** | effects applied | terminal |
| **skipped** | deliberately not processed; reason recorded | terminal (or replayable — the reason token says which) |
| **dead-lettered** | retries exhausted or failure classified permanent | → pending (operator retry) · → discarded (operator verdict) |

Three rules govern the machine. First, **there are no informal states**: "the
row is old and nobody touched it" is not a state, it is a defect in the
machine's coverage — the reaper's job is to force such limbo back onto the
spine. Second, **every transition away from success writes its reason at
transition time**, because the context that explains a failure evaporates
minutes after it happens. Third, **terminal is terminal only with a verdict**:
an event may leave the system as *done*, as *skipped with a reason*, or as
*discarded by an operator who saw it* — never by quietly aging out of
attention.

## Duplicates arrive from above; own your half

At-least-once composes across layers. The upstream sender redelivers on missed
acknowledgments; the ingress layer may accept the same logical event twice;
your own retry machinery re-runs handlers. The discipline is the same at every
seam: **the consumer of a delivery is responsible for making redelivery
harmless**, using an identity that survives the trip (law:
identity-survives-reuse). For events crossing a restart boundary, a persisted
watermark — the last position durably processed — turns "replay everything
since the checkpoint" from a duplicate storm into a no-op. Deduplication
without durable identity is a bloom filter that resets at the worst moment.

## Where this path meets its neighbors

- **Ingress** — webhook-ingestion owns everything before acceptance:
  authentication, validation, the acknowledgment contract with the sender, and
  the decision of what "accepted" means. This path takes over at the first
  durable write.
- **Why a scheduled thing didn't fire** — the sibling
  [scheduling](../scheduling/scheduling.md) subject owns the why-didn't-it-run
  ledger for time-driven work, including the distinction between a skip that
  can be replayed and one that consumed its moment
  ([schedule-observability](../scheduling/techniques/schedule-observability.md)).
  The non-delivery-ledgers technique here is the same instinct applied to
  event-driven work, and deliberately shares its vocabulary discipline.
- **Outbound fan-out** — once processing *emits* something to many listeners,
  the watermarks and catch-up semantics belong to
  [realtime-events](../realtime-events/realtime-events.md)
  ([outbound-fan-out](../realtime-events/techniques/outbound-fan-out.md)).
  This path guarantees the processing; that one guarantees the telling.
- **Claim mechanics in general** — locks, leases, and single-writer
  arbitration as a general discipline belong to concurrency-guards. This
  path's atomic-claiming technique is that discipline specialized to work
  items: what the claim row must *contain* so the rest of this subject
  (reaping, escalation) can function.
- **The room the work runs in** — the supervised loop that polls for due
  events, the panic isolation around a handler, and the health telemetry of
  the processing loop itself are
  [background-jobs](../background-jobs/background-jobs.md). This path defines
  the transitions; that one keeps the machine that drives them alive.
- **Waiting between attempts** — delay computation, jitter, and classification
  of failures as retryable at all are
  [retry-backoff](../retry-backoff/retry-backoff.md). The seam is precise:
  retry-backoff decides *whether and when* the next attempt happens; this path
  decides *how many* attempts exist and what exhaustion becomes.

## What "done" looks like for this subject

A processing pipeline meets the bar when: every event class has a named
guarantee, chosen by duplicate-effect analysis rather than inherited from the
transport; the pending→processing transition is a conditional write exactly
one worker can win, and the claim records holder and timestamp; a supervised
reaper returns claimed-then-died work to the spine under a written policy, and
its criteria for *stuck* rest on claim evidence rather than folklore
thresholds; retry counters are persisted, bounded, and their exhaustion is a
transition to a dead-letter record — never a counter quietly passing ten
thousand; the dead-letter lane is a surface with a triage workflow, per-item
and bulk verbs, partial-failure reporting on the bulk verbs, and a retention
policy that names its reaper; and every accepted event that will never be
processed says why, in a typed token an operator can group by, so that the
question "where did my event go?" is a query, not an investigation.
