---
layer: technique
subject: proactive-nudges
technique: nudge-identity-dedup
status: forged
laws:
  - identity-survives-reuse
shared_with: []
---

# Nudge identity & dedup

The identity a nudge carries so the system can recognize "I have already
said this" — the mechanism behind the subject's bluntest rule: the same
news twice is spam by definition. Budgets ration volume; identity rations
*repetition*, which volume caps cannot see (five slots spent on the same
message is legal by budget and still spam).

## The key: kind + subject reference

A nudge's dedup identity is the pair **(kind, subject-ref)**:

- **kind** — which evaluator's judgment this is ("unresolved-incident",
  "maintenance-due", "review-waiting"). The closed set of kinds is the
  same vocabulary the budget and efficacy layers key on — one authority,
  every layer derives.
- **subject-ref** — a stable reference to the thing the nudge is about:
  the incident's id, the review's id, or a well-known singleton token for
  kinds whose subject is the system itself ("maintenance-due" has one
  subject: now).

What the key must *not* contain, per
[identity-survives-reuse](../../_laws.md#identity-survives-reuse):

- **The message text.** Payloads get reworded; a copy edit must not make
  old news new. Identity is semantic, not textual.
- **Timestamps or tick counters.** An identity that includes "when I
  noticed" is unique per noticing, which is to say it dedups nothing.
- **Queue position or delivery channel.** Identity precedes and survives
  both.

The subject-ref must itself survive the operations its entity undergoes —
if the underlying record can be re-created with a new id for the same
real-world situation (a flapping condition closing and reopening), decide
explicitly whether that is "the same news" (key on the stable situation)
or "new news" (key on the fresh id). This is a per-kind judgment made at
kind-definition time; left implicit, it is made by accident in both
directions at once.

## The three behaviors identity funds

1. **Dedup at admission.** A candidate whose identity matches a live
   notice (queued or within cooldown) is coalesced, not enqueued. The
   live notice may absorb an updated payload (below), and a
   times-noticed counter ticks — evidence for efficacy and cap tuning.
2. **Per-identity cooldown after delivery.** Delivery starts a cooldown
   clock for that identity; while it runs, re-noticing the same identity
   is suppressed even though the condition persists. Cooldown length is
   per-kind data. This is the general suppression shape owned by
   scheduling's cooldown-and-debounce; here the key is fixed by
   definition to the nudge identity, and the state-predicate variant is
   usually the better fit: *while the delivered nudge sits unresolved in
   front of the user, say nothing more* — the artifact's lifecycle, not a
   tuned window, defines "already raised."
3. **Superseding.** A newer candidate with the same identity but changed
   substance **replaces** the queued notice — same identity, updated
   payload, original created-at retained for expiry honesty, a
   superseded-count incremented. The user gets the current state of the
   story once; stacking gives them the story's edit history as separate
   interruptions, newest last.

## Supersede vs stack — the rule

Replace when the new candidate is *the same story, updated* (same
identity). Stack when it is *a different story about the same entity* —
which by construction has a different kind, hence a different identity.
The design pressure to "merge related nudges" across kinds belongs in
payload composition at delivery time (one delivery mentioning both), not
in identity, where it destroys the audit trail of which judgment fired.

## Decision rules

- Mint identity at candidate creation, in the evaluator's output path —
  never at delivery, and never derived from whatever is convenient at
  the presentation tier.
- Persist identity with the notice; restart must not re-mint. The
  classic failure is boot-time re-noticing under fresh identities,
  producing a morning burst of déjà vu.
- The delivered-nudge record keeps its identity forever; efficacy
  attribution ("this kind, this subject, ignored three times") is a join
  on identity and dies without it.
- Cross-tier dedup is downstream's job (the presentation layer dedups
  its own toasts and ledger entries) but it keys on the identity this
  layer minted — one key, every tier.
