---
layer: technique
subject: concurrency-guards
technique: guard-key-design
status: forged
laws:
  - identity-survives-reuse
  - one-authority-per-vocabulary
shared_with: []
---

# Guard key design

A guard is a membership test over keys. Before any primitive is chosen, the
design question is what the key *is*: which properties of an invocation place
it in the same equivalence class as another. That choice — not the lock
implementation — determines every behavior the guard exhibits, and it is the
part no library can supply.

## The identity axes

A guard key is composed from a subset of these axes, each included or excluded
on purpose:

- **Entity** — which record, resource, or account the operation acts on. Almost
  always included: refreshing credential A and credential B are different
  operations; refreshing credential A twice is the duplicate.
- **Operation kind** — what is being done. Included when different operations
  on one entity may safely overlap (reading while refreshing); excluded when
  any two operations on the entity conflict (two writers of any kind).
- **Arguments** — the parameters that change the effect. Included for
  request-dedup ("same query in flight — join it"); excluded for exclusive
  sections ("only one rebuild at a time, whatever the options").
- **Initiator** — who asked. Almost always *excluded*: two users triggering the
  same refresh is precisely the duplicate the guard exists to stop. Include it
  only when the operation's effect is genuinely per-initiator.

The composed key must be stable across the invocation's lifetime and across
retries of the same intent (law: identity-survives-reuse). A key containing a
timestamp, a random id, or an attempt counter is unique per call by
construction — the membership test can never hit, and the guard silently
guards nothing. Attempt identity matters, but it belongs on the *result* (see
attempt-attribution), never in the *guard key*.

## The two failure directions

Key granularity fails invisibly in both directions, and the symptoms point away
from the cause:

- **Too broad** — the key omits an axis that actually separates independent
  work. One key for "sync" serializes every account's sync behind whichever
  started first. The symptom is latency and queueing under load, which gets
  investigated as a performance problem; nobody suspects the guard, because
  the guard is "working."
- **Too narrow** — the key includes an axis that should not separate work.
  Keying by full argument list admits two "duplicates" that differ in an
  argument the effect ignores; keying by initiator admits one per user. The
  symptom is the original duplication bug, now intermittent, now filed as
  "the guard doesn't always work."

The test for a proposed key: enumerate two invocations that *must* serialize
and confirm they collide; enumerate two that *must not* and confirm they miss.
If either enumeration is hard to produce, the equivalence class is not yet
understood — which means the guard is being installed before the design exists.

## Key vocabularies are closed sets

When guards multiply, their keys become a vocabulary — and like any vocabulary,
it needs one authority (law: one-authority-per-vocabulary). Keys assembled ad
hoc at call sites from string fragments drift: one site writes the entity id
first, another writes the kind first, and the two never collide with each
other despite naming the same operation. The remedies, in order of strength:

- **Constructor functions** — a key is built only by a named function per
  operation family, so the composition rule lives in one place.
- **A closed enumeration of flow kinds** — where the guarded operations are
  known at design time, the "kind" axis is an enumerated type, not a free
  string; adding a guarded operation means extending the enumeration, which is
  visible in review, rather than minting a string, which is not.
- **A registry of active keys that can be listed** — whatever the composition
  rule, the running set is inspectable, so "what is guarded right now?" is a
  query, not an archaeology project.

## Scope follows key

The key also decides where guard state must live. A key whose duplicates can
only originate in one process (one UI, one event loop) is served by an
in-process set. A key whose duplicates can originate in two processes — two
app instances, an app and a background worker, two parallel automation
sessions — needs shared substrate, whatever the in-process code does (see
cross-process-exclusion). Deciding this per key, at design time, prevents the
classic false comfort: an in-process guard around an operation whose real
duplicate arrives from another process entirely.

## Decision rules

- Write the equivalence class in words before writing the key in code: "two X
  are the same operation when …". If the sentence is hard, the key is a guess.
- Prefer the narrowest key that still catches every real duplicate — breadth
  serializes strangers, and serialized strangers are debugged as performance.
- Never put per-invocation identity (timestamps, attempt ids, random nonces)
  into a guard key; that is attribution's job, and in a key it nullifies the
  guard.
- Build keys through one constructor per operation family; free-form string
  assembly at call sites is a vocabulary with no authority.
- Revisit the key when the operation's fan-out changes: an operation that
  gains a second entry point (a scheduler, a remote trigger) may have gained
  a cross-process duplicate its key was never scoped for.
