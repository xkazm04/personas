---
layer: technique
subject: ipc-contract
technique: generated-type-contracts
status: forged
laws: [one-authority-per-vocabulary, derivation-names-recomputation, failure-not-empty-success]
shared_with: []
---

# Generated type contracts

Two language worlds need the same shapes; only one of them may *define* those
shapes. This technique turns the boundary's data contract from a convention
("keep both sides matching") into an artifact ("one side is machinery output"),
and then deals honestly with the new failure modes that machinery introduces.

## Decision 1: which side authors

Hand-maintained mirror declarations are two authorities for one vocabulary —
a race with a delay fuse
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
So exactly one side authors every crossing shape. Choose by ownership of
meaning, not by tooling convenience:

- **The engine authors** (the strong default). The engine world owns
  persistence, domain invariants, and the operations themselves; its
  declarations are already the closest thing to truth. Generating the
  interface world's declarations from engine annotations means a change to a
  domain shape *mechanically* breaks the interface compile until the interface
  adapts — which is the entire point. Drift becomes a compile error instead of
  a runtime surprise.
- **A neutral schema authors** (interface-definition files, both sides
  generated). Correct when the boundary has more than two consumers, or when
  the two worlds are peers with no clear domain owner. It buys symmetry at the
  cost of a third artifact, a third toolchain, and a place for shapes to exist
  that neither world actually uses. For a two-world single product it is
  usually ceremony.
- **The interface authors** — almost never. The interface world is a consumer
  of domain shapes, not their origin; inverting the direction makes the
  persistence layer chase presentation types.

Whichever direction: the generated side is **read-only by policy**. A hand
edit to a generated file is drift wearing the contract's own uniform, and the
next regeneration silently erases it. Mark the artifacts as generated, and
make the drift gate the enforcement.

## Decision 2: commit the artifacts, or generate on every build

**Generate-on-build** guarantees freshness by construction — the consumer can
never compile against a stale contract — but it hides the contract from code
review (a shape change produces no reviewable diff on the consuming side),
couples every build of the consuming world to the producing world's toolchain,
and makes "what changed at the boundary" unanswerable from history.

**Committed artifacts** make every contract change a visible diff a reviewer
can read and a historian can find, decouple the consumer's build from the
producer's toolchain, and let boundary changes be reasoned about in review —
at the price that committed output *can* go stale, which is a new invariant
that needs its own gate.

The principal-grade default for a single-repo, two-world product: **commit the
artifacts and gate the freshness** (the gate is the
[drift-gates](drift-gates.md) technique). Review visibility of boundary
changes is worth more than freshness-by-construction, because boundary changes
are exactly the ones a second pair of eyes should see — and the gate buys back
the freshness guarantee that committing gave up.

## Regeneration is one exact command

A committed-artifact contract stands on one operational rule: **the stored
derivation names its recomputation**
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
There is exactly one documented command that regenerates everything, and it is
the same command the gate runs. Near-miss invocations — the right tool with a
missing flag, a partial target, the wrong working scope — are the classic trap,
because a generator invoked over an empty target set does not error: it
regenerates **nothing**, prints nothing alarming, and leaves the tree clean.
"Ran the generator, no diff, nothing to commit" is indistinguishable from
"already up to date" unless the instrument is asserted
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)) — so
the generator (or its wrapper) must report *how many* artifacts it touched or
verified, and both the human workflow and the gate must treat zero as a
failure of the run, never as cleanliness.

Two corollaries:

- **The command lives beside the annotation.** Whoever adds an exported shape
  learns the regeneration command in the same paragraph; a contribution guide
  that documents the annotation but not the exact command manufactures the
  no-op trap for every new contributor.
- **One output root.** The generator writes to exactly one directory, declared
  in exactly one place. Two output roots — a legacy one and a current one,
  both committed — will drift from each other, and consumers will import from
  whichever one autocomplete finds first. Retire the loser physically (delete,
  and block its recreation), not by convention.

## Fidelity: the generator describes the wire, not the source

A generator translates the authoring world's types into the consuming world's —
and the trap is that a translation can be perfectly faithful to the *source
type system* while being false about the *transport*. The canonical instance is
integer width: the source declares a 64-bit integer, the consuming language has
an arbitrary-precision integer type, and a "correct" generator emits it — but
the serialization format in the middle carries plain numbers with a 53-bit safe
range, so the arbitrary-precision type **never arrives**. The consumer's
compiler now enforces a fiction; call sites accrete coercions to satisfy a type
that reality contradicts, dead guard branches that can never execute, and —
the deepest reach — test fixtures constructed to match the false type, so the
test suite certifies behavior against inputs that cannot occur.

The rules:

- **The wire format's limits are clauses of the contract.** Decide once how
  each boundary-hostile source type (wide integers, byte arrays, timestamps,
  raw dynamic documents) crosses, and encode that decision where it cannot be
  skipped — a dedicated boundary type whose translation and serialization are
  both correct beats a per-field annotation that must be remembered at every
  use, because the annotation forgotten is invisible and the type absent is a
  compile error.
- **When the generated type and the runtime disagree, fix the source.** The
  generated declaration is authoritative about *shape*; the source field is
  authoritative about *value*; a disagreement means the source declared
  something the transport cannot carry. The one forbidden move is forking the
  contract on the consumer side — a hand-written "corrected" mirror of a
  generated type is a second authority that starts drifting the day it is
  written, patching the symptom at the layer that cannot fix it.

## Coverage: crossing must be one declaration, not two

Serialization and description are usually independent opt-ins: one marker puts
a type on the wire, another registers it with the generator. Everything with
the first and not the second is **on the wire but invisible to the contract**
— it looks exactly like a properly-declared type (named, documented, casing
annotated), the transport delivers it happily, and the consumer hand-authors
its shape because there is nothing to import. This near-miss class survives
review precisely because the code reads as correct. The structural fix is a
single composite crossing declaration — one marker that expands to
serialization *plus* generation *plus* the wire casing — so "crossable" is one
decision and the halfway state is unrepresentable. Where that is not yet in
place, the inventory gate (in [drift-gates](drift-gates.md)) must compare the
set of types operations actually return against the set the generator knows.

## Generate the bindings between vocabularies, not just the vocabularies

Shapes and operation names are usually generated separately, which leaves the
**association** between them unstated: the call machinery accepts any declared
name and any claimed return type, in any combination, so a call site can name a
real operation and assert an arbitrary shape for it. Close it by generating the
mapping itself — an operation-name → return-shape table emitted by the same
machinery that already knows both — and constraining the call wrapper's return
type through that table. Every hand-asserted response type then becomes a
compile error, and an operation whose return shape the generator cannot
describe becomes *impossible to call in a typed way*, which is the correct
pressure: it forces the fix to the authoring side rather than letting the
consumer paper over it.

## What generation does not solve

A generator is additive by temperament: it writes what the source declares
*now* and never deletes what the source *used to* declare. Three consequences
land in the [drift-gates](drift-gates.md) technique — the untracked-new-file
blind spot, the orphan population, and the inventory check — but one belongs
here: **deleting or renaming an authored shape is a contract change too**, and
the author's definition of done must include regenerating and committing the
*removals*. A contract directory that only ever grows is not a contract; it is
an attic.
