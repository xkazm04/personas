---
layer: technique
subject: schema-driven-ui
technique: emitter-registry-sync
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target, identity-survives-reuse]
shared_with: []
---

# Emitter–registry sync

A schema-driven surface has two parties speaking one language: the emitter (a
model composing specs) and the renderer (the registry realizing them). The
language is the node vocabulary — and the moment the emitter's copy of that
language is maintained by hand next to the registry's, the pattern has two
authorities for one vocabulary and the standard failure is scheduled: someone
adds a kind, updates one side, and the drift surfaces as a rising drop rate
that nobody connects to the change.

## One authority, derived documentation

The registry is the authority ([registry-mapping](registry-mapping.md)). The
emitter's instructions — the list of kinds it may use, each kind's config
contract, when to choose which, worked examples — are **generated from the
registry entries**, from the same per-kind descriptions and config contracts
the validator enforces. Keeping the emitting model's working vocabulary
current is the prompt side's discipline (prompt-assembly's
capability-documentation technique — documenting a capability surface to a
model from its single source of truth); this technique is the rendering side's
half: *make the registry generatable-from*, so the prompt side has one place
to read.

The generated documentation carries the vocabulary version, and the emitter is
instructed to stamp that version on every spec it produces. Now the handshake
is checkable end to end: a spec arrives claiming version N; the validation
door knows its own version; mismatch is a measurable condition rather than a
silent quality decline.

## Validate at dispatch, not only at render

The renderer's validation door protects the surface. But the *emitting* side
has its own gate-shaped obligation: when an agent turn produces a spec that
will be stored and rendered later, validating **at dispatch** — before the
spec is accepted into storage — is what puts the failure next to its cause. A
kind hallucinated at dispatch and caught at dispatch is a correctable model
turn (retry, repair, or refuse); the same kind caught days later by a render
in front of a user is a mystery with cold provenance. A pipeline that stores
emitted specs unvalidated has a gate that never sees its target until the
target is in production. Dispatch-time validation reuses the same door — same
vocabulary, same per-kind contracts — not a parallel reimplementation, or the
two validators become the two-authorities problem in a new costume.

## The drop ledger closes the loop

Drift between emitter and registry announces itself in the repair pass's
ledger ([spec-validation-and-repair](spec-validation-and-repair.md)):
`unknown-kind` spikes after a vocabulary change mean the generated docs
weren't regenerated or redeployed; persistent config failures on one kind mean
its emitter-facing description and its validator disagree — a defect in the
registry entry itself, fixable in one place because there is one place. Treat
the ledger as the sync monitor: it is the only instrument that watches the
two parties actually converse, rather than checking either side alone.

## When agent and human edit the same spec

Composable surfaces invite two writers: the agent recomposes the document;
the human pins, hides, reorders, tweaks. Both edit the *same stored spec*,
and the write discipline is document concurrency, not UI state:

- **Read-modify-write under a write lock or compare-and-swap.** Each writer
  reads the current document version, applies its edit, and writes back only
  if the version is unchanged; otherwise it re-reads and reapplies. Blind
  last-writer-wins — the agent regenerating the whole blob over the human's
  pin, or the human's edit clobbering a concurrent recomposition — silently
  discards one author's intent, and the discarded author is usually the
  human, which reads as the product ignoring its user.
- **Node identity survives recomposition.** Human intent attaches to nodes
  ("pin *this* tile"), and agent recomposition reorders, regenerates, and
  reuses nodes. Pins keyed by position, or by content equality, misfire the
  first time the agent reshuffles; node ids are minted once, at node
  creation, and preserved by the emitter when it revises an existing
  document. The emitter's instructions say so explicitly — id preservation
  is part of the generated vocabulary documentation, not folklore.
  And when a recomposition merge carries preserved human-authored nodes
  forward into the fresh document, it dedupes them against freshly composed
  equivalents — respecting the human must not render the same content twice.
- **Human edits are constraints on the emitter, not merge conflicts.** A pin
  is not just data to preserve; it is an instruction the next recomposition
  must respect. The re-composition prompt therefore includes the current
  document *with its human-authored constraints marked*, so the agent
  composes around them rather than over them. A recomposition that unpins
  what the human pinned is a sync failure even when no write was lost.
