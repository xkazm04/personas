---
layer: technique
subject: realtime-events
technique: event-registry
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Event registry

The registry is the answer to the question "what events exist?" — and the
technique is making sure that question has exactly one answer, everywhere,
forever. An event system's names are a closed vocabulary
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)),
and the registry is the single artifact where that vocabulary is defined:
every name, its payload shape, and — where they matter — its emission sites
and intended audience.

## Why string literals at emit sites are a defect, not a style choice

Without a registry, the vocabulary is the union of every string literal ever
passed to an emit or subscribe call. That set has no owner, so it has no
review surface: nobody can enumerate it, nobody approves additions to it, and
its two failure modes are both silent. A producer renames an event and every
subscriber to the old name keeps listening to a channel that will never fire
again. A subscriber typos a name and waits forever. Both present identically
at runtime: *nothing happens*. An event system's natural failure mode is
indistinguishable from its natural idle mode
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)) —
which is precisely why the names must be checkable *before* runtime. A
registry converts "nothing happened" from an unfalsifiable shrug into a
compile-time or gate-time error.

## The payload is half the contract

A name without a payload shape is half a contract, and the missing half is
the half that breaks consumers. The registry binds each name to one declared
payload type, and the binding is directional: the consumer is entitled to the
declared shape because the registry promised it — not because recently
observed payloads happened to have those fields. The distinction matters at
change time: when a payload evolves, the registry is where the change is
made, reviewed, and propagated; consumers relying on observation get no
signal at all until they break.

Payload discipline that pays for itself:

- **Identity over state.** Prefer payloads that carry *which thing changed*
  (ids, names, coarse kind) over payloads that carry the thing's new state.
  Identity payloads age well — they feed invalidation (see
  [push-vs-refetch-reconciliation](push-vs-refetch-reconciliation.md)) and
  never go stale in flight. State payloads are a cache with no invalidation
  story.
- **Closed variants over open bags.** If one name can carry several shapes,
  it is several events sharing a name; split them, or make the variant tag a
  first-class discriminant in the registry.
- **No secrets in transit.** Events fan out to audiences the emitter cannot
  enumerate — that is the point of a bus. Anything in a payload should be
  publishable to every current and future subscriber, including diagnostic
  ones that log.

## Mirroring across a language boundary

The vocabulary almost always has to exist on both sides of at least one
language boundary — the producing runtime and the consuming runtime do not
share a type system. The wrong answer is two hand-maintained lists, which is
one vocabulary implemented as a race
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):
they drift exactly when someone adds an event and finds only one list.

Two right answers, in order of preference:

1. **Generate the mirror** from the authority as a build step. Drift is
   structurally impossible; the cost is build machinery.
2. **Gate the mirror**: both sides keep their idiomatic definition, and an
   automated parity check fails the build when the sets of names diverge.
   Cheaper to adopt in an existing system, and honest as long as the gate
   reads the *actual artifacts* both runtimes consume — not a doc, not a
   sample — because a gate over a proxy passes exactly when the proxy drifts
   ([gate-sees-target](../../_laws.md#gate-sees-target)).

Either way, the authority is declared: one side is canonical and the other
mirrors it. A symmetric "keep them in sync" instruction with no declared
master is how both sides end up half-right.

## Naming: families with anchored boundaries

Names are namespaced by family with an explicit segment separator
(`domain:thing-happened` or equivalent), because family structure is what
wildcard subscription anchors to (see the matching rules in the
[golden path](../realtime-events.md)). Discipline that prevents later grief:

- The separator is structural, not cosmetic — matching machinery anchors at
  separators, never at raw string prefixes, or `job` matches `jobless`.
- Past tense for facts (`thing-completed`), because an event states what
  happened; imperative names (`update-thing`) are commands wearing event
  clothing and belong on a call boundary.
- A name, once shipped, is an API. Renames are migrations with a
  deprecation window, not refactors.

## Producers the compile-time authority cannot reach

A registry's guarantees flow through derivation: producers that *import* the
vocabulary cannot misspell it. But grown systems acquire producers that mint
names at runtime — configuration-driven pipelines, user-authored automations,
and above all generative components that write event names as text. For these
the registry is advisory, and the observed failure is **separator and casing
drift**: three spellings of the same fact, each starving the subscribers who
spelled it the other way, silently.

Two honest responses, and the choice is a declared design decision:

- **Enforce at the door**: the publication path validates runtime-minted
  names against the registry (or its family grammar) and rejects or quarantines
  what does not parse. Strongest; requires the door to exist (one publication
  chokepoint) and a policy for rejected facts.
- **Canonicalize at the match**: declare a normal form (case, separators) and
  compare subscriptions to events in normal form, so stylistic variants of one
  name converge while genuinely different words stay distinct. Weaker — it
  repairs spelling, not vocabulary — but it converts a silent starvation class
  into a non-event.

What is not a response: exact matching against an uncontrolled producer
population. That combination is a standing bet that free-text spelling stays
converged, and it loses quietly.

## What the registry knows beyond names

A registry earns its keep when it can answer operational questions, so the
strongest form records, per event: the payload contract, the family, which
side emits it, and whether it is internal or crosses a boundary. That last
flag is a security and stability boundary — boundary-crossing events are a
public API surface with external subscribers you cannot see, and the
registry is the only place where "can I change this?" has an answer.

## The gate

The registry's promises are only as good as the gate that enforces them, run
where drift is introduced (the build or pre-merge), failing on:

- a name emitted or subscribed anywhere that is not in the registry;
- registry entries on the two sides of a mirrored boundary diverging;
- (strong form) a payload produced that does not satisfy the declared shape.

Zero findings from a gate that scanned zero emit sites is not a pass
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)) —
the gate asserts it found the emit sites before it reports them clean.
