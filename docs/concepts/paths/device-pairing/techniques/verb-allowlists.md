---
layer: technique
subject: device-pairing
technique: verb-allowlists
status: forged
laws: [one-authority-per-vocabulary, count-carries-predicate]
shared_with: []
---

# Verb allowlists

A paired principal's authority is a **written list of verbs**, enumerated
before the first device is ever paired. The tempting alternative — "the
remote request is the operator's own intent, arriving over a different
keyboard, so let it do what the operator can do" — is true about intent
and false about blast radius: the other keyboard is attached to a device
that can be lost, left unlocked, or phished, and the population that can
reach it is a network, not a person. Enumerate the verbs, and make the
enumeration structural.

## Closed grammar: unpermitted actions fail to parse

The strong form of an allowlist is a **closed action grammar**: the remote
write surface deserializes requests into a closed sum type with one
variant per permitted verb, and anything else fails at parse time. The
difference from a permission check is architectural:

- a *check* is code that runs after parsing — it can be forgotten, ordered
  wrong, or bypassed by a new endpoint;
- a *grammar* refuses at the type boundary — an unlisted verb is not
  "denied", it is **unrepresentable**; there is no handler to reach, no
  parameters get parsed, and no code path exists on which the question was
  skipped.

The verb set is a closed vocabulary with exactly one definition — the
type itself — and every consumer (dispatcher, audit, documentation)
derives from it
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
Adding a verb is a visible design event: a new variant, reviewed as the
security decision it is, not a string compared somewhere. Pin the closure
with tests from both sides — the permitted verbs parse, and a sampler of
plausible-but-forbidden actions (spawn, broadcast, raw-write) fails to
deserialize. The negative half is the test that matters; the positive half
only proves the feature works.

## Reads are a projection, not a window

What a paired principal *sees* is a purpose-built **projection**: display
labels, coarse states, timestamps, the specific items awaiting its
decision. Never transcripts, never filesystem paths, never credentials,
never raw terminal bytes. The projection is designed top-down from the
remote use case ("glance and approve") rather than bottom-up from what the
local store contains — the difference between exporting a view and
exporting the database. Version the projection shape explicitly; the
remote client is a separately-shipped artifact and the projection is a
protocol.

The projection rule has a quiet corollary for *labels*: a display label
falls back through name-like fields, never through path-like ones — the
fallback chain is part of the security review, because "label = title or
name or path" leaks the path exactly when the first two are unset.

## Writes act only on what the projection showed

Every remote write names its target, and the target must be **currently
visible in the principal's own projection**, checked at execution time on
the granting side:

- a remote approval must reference an item that is *presently pending*
  and of a *remotely-answerable kind* — recomputed from the same filter
  that builds the projection, so the two cannot drift — never an
  arbitrary identifier the remote side happens to know;
- a remote reply reaches only a target in the state that accepts replies
  (a session actually awaiting input) — typing into a running process
  from a remote device is never right, and the state check enforces at
  execution what the projection promised at render;
- the check re-derives visibility at execution time rather than trusting
  that the remote client only offers buttons for visible things — the
  client is unauthenticated code on an untrusted device; its UI is a
  courtesy, not a control.

Free-text fields crossing the boundary are hostile: strip control
characters (terminal escape sequences are remote-code-execution against a
terminal), cap lengths, and normalize before anything downstream sees the
text. And every act — success or failure — writes a ledger row naming the
device, the verb, the target, and the outcome, so the sentence "device X
performed N remote acts" always carries its predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)).

## The borrowed-control trap

The subtlest failure in remote-surface design is the **borrowed control**:
a safety argument of the form "everything that constrains this action
locally still constrains it here, unchanged and unduplicated". The
sentence is true on the day it is written — and it creates a dependency
with no import, no test, and no reference the other subsystem's
maintainer can follow. When the local constraint is later refactored,
renamed, or deleted — reasoned about locally, correctly — the remote
surface's safety argument rots silently, and it rots toward
permissiveness.

The discipline: for each verb, list the controls its safety depends on,
and for each either (a) enforce it *in the remote path's own code*, or
(b) write a test in the remote path's suite that fails when the borrowed
control disappears — a reference the deleter's build will follow even
though the deleter never read this file. A borrowed control that is
neither re-enforced nor tested is prose, and should be counted as absent
in any honest review of what bounds a paired device.

## Scope the allowlist per pairing, not per surface

The verb grammar defines the *ceiling* — the most any paired principal
can ever do. Individual pairings may hold subsets: the scopes narrowed at
approval arrive here as the grant that gates which verbs this credential
may invoke. Keep the two layers distinct in code and in review: the
grammar is this subject's structural boundary; the per-grant scope check
is the [authorization](../../authorization/authorization.md) subject
consuming what the ceremony minted. When the two disagree, the narrower
wins — a scoped-down pairing must not reach a verb the grammar permits,
and no scope string can conjure a verb the grammar lacks.
