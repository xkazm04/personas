---
layer: technique
subject: canvas-graph
technique: graph-layout
status: forged
laws: [identity-survives-reuse, derivation-names-recomputation]
shared_with: []
---

# Graph layout

Layout answers two different questions that must never share one code path:
*where should nodes go when nobody has placed them* (an algorithm's job), and
*where did the user put them* (a datastore's job). The subject-level rule —
auto-layout is a suggestion, never a dictator — becomes concrete here as a
provenance bit, a persistence contract, and a placement policy.

## Provenance: user-authored beats generated

Every stored position carries (explicitly, or implicitly by which store it
lives in) whether it was **user-authored** or **generated**. The rules fall
out of the bit:

- An auto-layout pass may move generated positions freely; it touches
  user-authored positions only on an explicit "re-layout" command — and even
  then, that command is one undoable transaction, because it is about to
  destroy spatial memory the user built.
- Better still, user-authored positions participate in the algorithm as
  **fixed anchors**: they exert forces (or occupy slots) but never move, so
  the generated layout arranges itself *around* the user's arrangement
  instead of ignoring it. When collisions must be resolved between an
  anchored node and a free one, the free one takes the whole correction;
  between two anchors, nothing moves — the user's explicit layout wins even
  over overlap.
- The moment the user drags a node, its position flips to user-authored and
  stays there.
- "Reset layout" is the deliberate, confirmed doorway back to all-generated —
  offered, not sprung.

A canvas that re-runs auto-layout on load "to tidy up" and thereby moves
user-placed nodes teaches users their arrangement is disposable; they stop
arranging, and the product loses the entire spatial-memory payoff the canvas
was chosen for.

## Choosing the algorithm

Pick by the graph's true shape, not by demo aesthetics:

- **Layered / tree ("tidy") layouts** for graphs with dominant direction —
  pipelines, hierarchies, dependency flows. They produce stable, readable,
  *deterministic* results: same graph in, same layout out. Determinism
  matters more than beauty, because a layout that shuffles on every run
  destroys spatial memory even for generated positions.
- **Force-directed layouts** for genuinely undirected, cluster-shaped graphs.
  They reveal clustering that layered layouts hide, at a price: they are
  iterative, nondeterministic unless seeded, and can shuffle dramatically
  under small input changes. If forces are used, seed them for
  repeatability, run them to convergence *off the interaction path*, and
  treat the result as a one-time proposal to store — never as a live
  simulation the user's arrangement fights against.
- **Hybrids** (layered within clusters, coarse placement across them) when
  the graph has both a flow and communities.

In every case the algorithm's output enters the model through the same door
as a user drag — positions written to the store, provenance marked generated
— so that undo, persistence, and rendering see one kind of change. And a
generated layout is a stored derivation of the graph, so its recomputation
trigger is named
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)):
on explicit request, or on arrival of unplaced nodes — never "whenever the
graph re-renders".

## Placement policy for new nodes

A node created without a position must land:

- **near its topological neighbors** if it has any (beside the node it was
  spawned from, downstream of the node it connects to);
- **inside the visible viewport** otherwise — the user must see what they
  just made without hunting for it;
- **not on top of an existing node** — probe outward (spiral or ring) from
  the candidate point until clear space is found.

The origin is the worst possible default: every unplaced node stacks at the
same point, and the stack is usually offscreen. The placement policy is the
canvas's cursor — the small piece of intelligence that makes creation feel
located instead of lost.

## Persistence: layout is a document

Positions persist keyed by **durable node identity**
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)) — never
array order, never display label. The persisted artifact is a small document
with a lifecycle, inheriting the full discipline of
[persistence-and-migration](../../client-state/techniques/persistence-and-migration.md):

- **Versioned.** Node default sizes change, anchor conventions change,
  coordinate origins change; a version field is what lets a reader know
  which convention a stored layout speaks.
- **Migrated or explicitly degraded.** A layout from an old version either
  migrates cleanly or falls back to generated layout *with the fallback
  visible* — silently mis-scaled restoration (every node 40 units off
  because the default size changed) is worse than an honest re-layout.
- **Reconciled against the live graph on load.** Stored positions for nodes
  that no longer exist are dropped; live nodes with no stored position go
  through the placement policy. A layout store is an index over the graph,
  and an index is reconciled, not trusted.
- **Written per completed gesture**, not per pointer event — the drag's
  commit point is the persistence point.

The viewport (pan, zoom) may persist too — restoring the user's last framing
is a courtesy — but it is a preference, not part of the layout document, and
losing it must cost nothing.

## Shared geometry: one function for nodes and edges

Wherever layout computes node placement, edge anchoring must read the *same*
geometry — the same size constants, the same port offsets, the same bounds
function. The moment layout owns one copy of "how big is a node" and edge
rendering owns another, the two drift on the first size change and every
edge floats slightly off its node. This is the layout-side half of the rule
stated in edge-management; it belongs to both because the drift is created
here and observed there.
