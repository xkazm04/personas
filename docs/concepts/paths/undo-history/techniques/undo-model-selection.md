---
layer: technique
subject: undo-history
technique: undo-model-selection
status: forged
laws: [derivation-names-recomputation]
shared_with: []
---

# Undo model selection

Choosing between command-inverse and snapshot undo is the first and heaviest
decision in the subject, and it should be made by arithmetic, not by
architectural fashion. Both models are correct when their assumptions hold;
each collapses in a specific, predictable way when they don't. The job is to
price both against the actual document, the actual operations, and the actual
budget — then commit, in writing, so the next operation added to the system
knows which contract it must satisfy.

## Command-inverse: pay per change, owe an inverse forever

Each user operation is recorded as a command object carrying enough
information to construct its inverse. Undo pops the stack and executes the
inverse; redo re-executes the forward command.

**What it costs:** memory proportional to the *change* — a one-character edit
in a huge document stores one character's worth of history. This is the model
that scales to large documents, long sessions, and high-frequency edits.

**Where it collapses:**

- **Inverses that are hard to derive.** "Insert text" inverts trivially.
  "Apply a filter that quantizes values" does not — the operation destroyed
  information, so the inverse must capture the destroyed portion at execution
  time, which is a snapshot wearing a command costume. Operations with
  fan-out (an edit that triggers reflow, renumbering, cascade deletion) need
  inverses for the whole cascade or they restore a state that never existed.
- **The dual-maintenance tax.** Every inverse is a second implementation of
  the forward operation's semantics, and the two drift precisely when someone
  changes the forward path and forgets its mirror. An inverse is a stored
  derivation of the forward operation, and it must name how it stays in sync
  — a shared definition both directions derive from, or a test that
  round-trips every command through do/undo/redo and compares states
  ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
  A command set without a round-trip test is a set of unverified claims.
- **Baseline dependence.** An inverse is only valid against the exact state
  its forward op produced. Anything that mutates state outside the command
  system — a collaborative peer, a background process, a migration — silently
  invalidates the stack. Command-inverse demands that *every* write goes
  through the command door; one bypass writer poisons the whole history.

## Snapshot: pay per document, owe nothing

Before (or after) each step, capture the relevant state; undo restores the
capture wholesale. There is no inverse code, so there is nothing to drift:
restoration is structurally guaranteed to reproduce the captured state.

**What it costs:** memory proportional to the *document* × stack depth. The
model's ceiling is exactly that product.

**Where it collapses:**

- **Large documents.** A multi-megabyte state snapshotted per keystroke at
  eighty steps of depth is a memory incident with a feature flag.
- **High-frequency steps** — unless coalescing (the gesture-coalescing
  technique) keeps the step count near the intention count, which it should
  be doing anyway.
- **State that must not be captured.** Snapshots grab everything in reach,
  including things undo must not touch — live handles, in-flight async,
  view state. A snapshot model needs an explicit *slice* defining what is
  captured (the undo-scope technique), or restore will resurrect ghosts.

**When it simply wins:** when the document is small — and "small" is bigger
than intuition says. A working state measured in tens or hundreds of
kilobytes, snapshotted per *gesture* (not per event) into a bounded stack of
some dozens of entries, costs single-digit megabytes at worst. For that price
you get undo that is correct by construction, add-an-operation-for-free (new
operations need zero undo code), and immunity to the drift and bypass-writer
failure modes above. Most editing surfaces in an application — settings
composers, small canvases, list arrangements, form-like documents — live
comfortably under this ceiling, and choosing command-inverse for them buys
risk with no return.

## The hybrid, and structural sharing

Real systems mix models per operation class: inverses for the cheap,
well-understood local edits; snapshots for the tangled, information-destroying
ones. The stack stores a uniform step interface (apply-backward /
apply-forward) and each entry chooses its representation. Two refinements
change the arithmetic enough to re-run it:

- **Structural sharing.** If state is immutable-persistent, a "snapshot" is a
  reference, and consecutive snapshots share every unchanged branch. This
  collapses snapshot cost from document-size to change-size — effectively
  command-inverse pricing with snapshot correctness — and is the strongest
  argument for immutable state in editing surfaces.
- **Delta compression.** Storing diffs between consecutive snapshots buys
  memory back at the price of restore time (walking deltas) and a second
  code path that can drift. It is command-inverse re-derived mechanically —
  safer than hand-written inverses, costlier than sharing.

## Decision procedure

1. Measure the captured slice's realistic size (not the whole app state — the
   *undoable* slice after scoping).
2. Multiply by the stack bound (the stack-policy technique). Under a few
   megabytes total: **snapshot; stop here.**
3. Over budget: can the state be made persistent/shared? If yes, snapshot
   with sharing.
4. Still over: hybrid — snapshot the operations whose inverses would be
   research projects, commands for the rest, round-trip tests for every
   command.
5. Record the decision and its arithmetic next to the stack implementation.
   The numbers go stale; the next person re-runs them instead of
   re-guessing.

## Prohibitions

1. No hand-written inverse without a do/undo/redo round-trip test.
2. No command-inverse system with writers that bypass the command door.
3. No per-keystroke snapshots of document-scale state — coalesce first,
   then price.
4. No model choice justified by "what editors do" — editors with
   gigabyte documents and forty years of command infrastructure are not
   your arithmetic.
