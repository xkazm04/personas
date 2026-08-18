---
layer: technique
subject: authorization
technique: privilege-tiers
status: forged
laws: [one-authority-per-vocabulary, count-carries-predicate]
shared_with: []
---

# Privilege tiers

A privilege tier is a named, ordered level of trust a caller must present
before an operation will run. The technique has three load-bearing
properties, and losing any one of them collapses it back into ad-hoc
judgment: the vocabulary is **closed**, the assignment is **total**, and the
ordering is **monotone**.

## Closed vocabulary

Three to five tiers, defined in exactly one place, each with a one-sentence
meaning a reviewer can hold in their head. A workable canonical ladder:

- **public** — any caller on the dispatch surface; the operation's own
  semantics are its only protection. Reads of non-sensitive state,
  UI-support queries.
- **privileged** — requires proof that the call arrives over a trusted
  channel (the injected session proof, below the dispatch gate). Mutations,
  anything touching user data, anything spending resources.
- **elevated / externally-granted** — privileged, plus an out-of-band grant:
  a per-caller key, a user confirmation, a scope issued to a specific
  consumer. Operations whose blast radius exceeds the application itself —
  exercising stored credentials, executing external effects, administrative
  surface.

The set is closed in the
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
sense: one authoritative definition, every consumer — the gate, the audit
log, the assignment table, the documentation — derives from it. Adding a
tier is a design review, because each new tier doubles the number of
questions every future assignment must answer. When pressure arrives to add
tier number six ("this operation is *almost* privileged but…"), the correct
response is almost always a **scope**, not a tier: tiers grade channels,
scopes bound actions, and most "in-between" cases are a privileged operation
that needs a narrower capability, not a new trust level.

## Total assignment

**Every operation names its tier; an unclassified operation is a build
error, not a default.** This is where tier systems live or die. A system
with a default tier — even default-privileged — reintroduces the silent
widening that default-deny exists to kill: the sensitive operation someone
forgot to classify ships at the default, and nothing complains. Totality is
enforced mechanically (the
[declarative-requirements](declarative-requirements.md) technique carries
the how), and the enforcement produces the technique's central artifact:
**the assignment table** — every operation, its tier, extractable by a tool
rather than compiled by a human.

The table is what makes tier counts auditable claims instead of vibes.
"Forty-one operations are public" is only a finding when it carries its
predicate ([count-carries-predicate](../../_laws.md#count-carries-predicate)):
counted from the extracted table at a stated revision, cross-checked against
the dispatch registry, so the number can be recomputed by the next reviewer
rather than believed.

## Monotone ordering

Tiers are ordered, and the gate's check is a comparison: the channel's
proven level must meet or exceed the operation's demanded level. Monotone
means a caller who can do a tier-N thing can do every tier-below-N thing —
no lattices, no exceptions, no "privileged but not for this caller". The
moment tier membership depends on *which* caller rather than *how trusted*
the channel is, the design is smuggling scopes into the tier axis, and both
axes lose their audit story. Keep the axes orthogonal: **tier = how much the
channel is trusted; scope = which capabilities this grant carries.** The
gate checks tier first (cheap, universal), scope second (per-grant, only
where declared).

## Assignment discipline

The tier of an operation is decided by its **worst reachable effect**, not
its common case. The questions, in order:

1. Can this operation, with any argument combination, mutate state, disclose
   data beyond the caller's own view, spend money, or touch the machine
   outside the application's own store? If yes → at least privileged.
2. Does it exercise an ambient power — stored credentials, external effects,
   process execution — whose damage lands outside the application? If yes →
   elevated, and usually also a scope.
3. Otherwise public — and "public" still deserves the question "what does an
   attacker learn by calling this in a loop?"

Two rules of inheritance close the classic loopholes:

- **A preview inherits the tier of the action it previews.** The dry-run,
  the impact report, the "what would this delete" enumeration — each
  discloses the reconnaissance an attacker needs for the real action. A
  preview cheaper than its action makes reconnaissance cheaper than the
  attack; classify them together.
- **A health probe or test inherits the tier of the resource it exercises.**
  An operation that *feels* read-only to its caller but spends a stored
  credential, makes an outbound call, or touches a live external system is
  classified by what it exercises, not by what it returns.

Two review smells that the table makes visible: a **public mutation** (almost
always a misclassification) and an **elevated read** (sometimes right —
reading a decrypted secret — but each one deserves its line of
justification). The periodic audit is a diff review of the table, which is
the entire point: reviewing a table beats re-reading every handler, every
quarter, forever.

## Downgrades are the dangerous direction

Raising an operation's tier is safe and boring. Lowering one is a security
decision wearing a refactor's clothes: the diff is one word, the effect is
"content rendered in the UI can now reach this". Tier downgrades get the
same review weight as removing an authentication check, and the audit trail
of the assignment table (version history of one small file, in the ideal
case) is what makes the downgrade findable when the question is asked a year
later.
