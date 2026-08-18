---
layer: technique
subject: delivery-guarantees
technique: guarantee-selection
status: forged
laws:
  - identity-survives-reuse
shared_with: []
---

# Guarantee selection

Before any claiming, retrying, or dead-lettering machinery is built, one
question decides the shape of all of it: **when this event's processing is
uncertain, do we prefer to risk doing it twice, or to risk not doing it at
all?** Every pipeline answers this; most answer it by accident, and the
accidental answer changes with the failure mode — lost on crash-after-claim,
duplicated on timeout-and-redeliver. The technique is making the answer a
decision: per event class, in writing, derived from what a duplicate effect
actually costs.

## The three honest postures

| Posture | Promise | Cost accepted | Machinery required |
|---|---|---|---|
| **At-most-once** | never a duplicate effect | events can vanish on failure | acknowledge/consume *before* processing; no redelivery; loss must still be *visible* (see non-delivery-ledgers) |
| **At-least-once** | never a lost event | handlers may run twice for one event | acknowledge/complete *after* processing; redelivery on doubt; duplicate effects are the handler's problem |
| **At-least-once + deduplicated effects** | the *experience* of exactly-once | the full dedup discipline, forever | stable event identity + an idempotency check at every effect boundary |

There is no fourth row. "Exactly-once delivery" across a process or network
boundary is not a posture, it is a claim that the acknowledgment and the
effect commit atomically — which holds only when both live in the same
transactional store. The moment an effect escapes that store (a call to an
external service, a message to another process, a file written elsewhere),
the atomicity is gone and the system is back to choosing between the first
two rows. Systems that advertise exactly-once are describing the third row
and hiding the dedup machinery in the fine print; systems that *believe* they
have exactly-once without that machinery have at-least-once with
undiagnosed duplicate-effect bugs.

## Duplicate-effect analysis — the deciding instrument

For each event class, walk the handler and list its effects. For each effect,
ask what a second execution does:

- **Naturally idempotent** — set a flag, upsert by key, overwrite a
  derivation. A duplicate is free. These effects impose no constraint on the
  posture.
- **Idempotent given identity** — append a row, send to a queue, create a
  resource. A duplicate is harmless *if* the effect carries the event's
  identity and the receiving side deduplicates on it. This is where law
  identity-survives-reuse earns its keep: the identity must be minted once,
  at acceptance, and survive redelivery, retry, and restart — a fresh id per
  attempt makes every attempt look like a new event and defeats the dedup it
  was supposed to enable.
- **Amplifying** — send a notification, charge, trigger an external workflow,
  spawn expensive work. A duplicate has a real cost, borne by someone outside
  the system. These effects force either at-most-once for the class, or an
  idempotency barrier directly in front of the effect (a recorded "this
  event's notification was sent" checked before sending, written after).

The class's posture is dictated by its worst effect. A handler that is 90%
idempotent writes and one un-deduplicated notification is an amplifying
handler.

## Decision rules

- **Choose per event class, not per pipeline.** One transport can carry
  classes with different postures. A metrics tick can be at-most-once (a lost
  sample is noise); a provisioning command in the same queue cannot. Forcing
  one posture onto all classes either gold-plates the noise or corrupts the
  commands.
- **At-most-once still owes a record.** Choosing to tolerate loss is
  legitimate; letting the loss be silent is not. The class's ledger entry
  (see non-delivery-ledgers) is what distinguishes "we chose to drop under
  pressure" from "we have a bug."
- **Dedup state is durable or it is decorative.** An in-memory seen-set
  protects against duplicates until the restart — which is exactly when
  upstream redelivers everything since its last acknowledgment. The dedup
  horizon must cover the redelivery horizon: a persisted watermark (last
  position durably processed) or a persisted seen-window keyed by event
  identity. State that resets at the moment of maximum duplication is a
  guarantee that fails only when tested.
- **Write the posture where the next maintainer will trip on it.** The class's
  guarantee belongs in the handler's contract, not in the original author's
  memory. The recurring failure: a handler built carefully idempotent, then
  extended a year later with one non-idempotent effect by someone who was
  never told duplicates arrive on purpose.
