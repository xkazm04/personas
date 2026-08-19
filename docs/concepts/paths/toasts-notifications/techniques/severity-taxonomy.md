---
layer: technique
subject: toasts-notifications
technique: severity-taxonomy
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Severity taxonomy

Every out-of-band message carries exactly one severity level from a closed
vocabulary, and that one classification drives every presentation decision
the message will ever face. The technique is the design of that vocabulary
and the discipline that keeps it singular.

## The level set

Five levels cover nearly every product; more is a smell, fewer loses a
distinction consumers need:

| Level | Defining question: *what if the user never sees this?* | Typical examples |
|---|---|---|
| **info** | nothing — pure awareness | background sync finished, a peer joined |
| **success** | they miss confirmation of their own action | saved, sent, connected |
| **warning** | something will degrade if unaddressed | credential expiring, quota near limit, degraded fallback active |
| **error** | something already failed | save rejected, job failed, connection lost |
| **critical** | the product cannot do its job until a human acts | data integrity risk, security event, unrecoverable subsystem down |

The set is **closed**: a message that fits no level is evidence the level
definitions need revisiting *once*, centrally — not evidence that this call
site should invent `error-but-softer`. An open set decays into a palette,
and a palette answers no consumer's question.

Closed also means **attested, not aspirational**. A level that no real
message ever earns is not completeness — it is an unused word that authors
will eventually bend to mean something ("info, but make it stick around").
Independent products converge on a smaller transient-tier vocabulary than
designers expect — pure *info* frequently earns zero call sites, because a
message with no consequence and no confirmation value usually should not
interrupt at all. Derive the set from the consequence table; delete levels
the table cannot distinguish.

## Assignment by consequence, not vibe

The failure mode of every severity system is inflation: authors reach for
the loudest level available because *their* message feels important, and
within a year everything is a warning and warnings mean nothing. The
defense is that assignment is answerable by a test, not a feeling — the
*if-never-seen* question in the table above. Two corollaries:

- **Severity is about the user's stake, not the system's effort.** A retry
  loop that recovered after eleven attempts is *info* (or nothing at all);
  a one-line validation rejection of the user's own submission is *error*.
  How hard the system worked is invisible and irrelevant.
- **Recovered problems demote.** A condition that was warning-level while
  live is at most info-level as news of its resolution. Announcing
  recoveries at the severity of the original problem doubles the alarm
  volume for zero added obligation.
- **The level is a claim, and claims have tense.** A positive level asserts
  the operation *completed*; showing it before unawaited work finishes is a
  false statement with a head start on its own correction — and the
  correction, if it comes, arrives as a separate message the user has no
  reason to connect to the first. Optimistic flows have two honest shapes:
  await the work before claiming, or keep the optimistic order and write
  copy that names the stage actually reached ("queued", "cancelling —
  cleaning up"), never the past tense — with a compensating failure message
  attached to the work that was not awaited.

## One authority, one mapping table

The level set is defined in exactly one place, and every consumer derives
from it ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The derivations worth centralizing form one mapping table per product:

| Level → | visual encoding | dwell | dismissibility | ledger record | OS-escalation eligible | announcement politeness |
|---|---|---|---|---|---|---|
| info | neutral | short | auto | no (unless flagged) | no | polite |
| success | positive | short | auto | no | no | polite |
| warning | cautionary | long | auto, ledger twin | yes | if actionable | polite |
| error | negative | long | explicit or acted | yes | if user-initiated op | assertive only if blocking |
| critical | maximum contrast | none — persists | acted only | yes, pinned | yes | assertive |

The exact cells are product decisions; the *structure* is not: one row per
level, one column per presentation channel, and no call site reaching past
the table. When a message needs different presentation, the author's only
lever is choosing a different level — which forces the honest conversation
("is this actually critical?") instead of the quiet fork ("critical dwell,
info color").

Visual encoding derives from the product's semantic design vocabulary
(status colors, iconography) — the severity table maps level to *semantic
token*, and the token system maps to pixels. Two vocabularies, each with
one authority, composed; never a hex value in the severity table and never
a severity conditional in a component picking colors ad hoc.

## Severity is not actionability

The taxonomy answers "how much does this matter"; a separate, orthogonal
bit answers "must the user do something". The pair, not severity alone,
decides transience (see the golden path's decision table): an *info*-level
message can be action-required (an approval request is not bad news, but it
must not evaporate), and an *error* can be awareness-only (a background
retry that will proceed without the user). Systems that overload severity
to imply actionability end up unable to express exactly these two cells,
and authors respond by lying about severity to get the persistence they
need — which is how inflation starts.

## Crossing boundaries

Where messages originate in more than one process or language, the level
set must cross the boundary *as the vocabulary, not as prose*: a shared
enumeration mirrored by contract (ideally generated from the single
authority), never re-derived by matching message strings on the far side.
A boundary that stringifies severity reintroduces per-consumer
classification — the exact disease the single vocabulary cures.
