---
layer: technique
subject: canvas-graph
technique: edge-management
status: forged
laws: [identity-survives-reuse]
shared_with: []
---

# Edge management

Nodes are content; edges are the *point* — the relationships the canvas
exists to show — and they are also where every canvas dies at scale. Edge
count grows with relationships, relationships grow super-linearly in real
graphs, and edges cross each other in ways nodes never overlap. Managing
them has three parts: geometry (where an edge attaches and how it travels),
economy (which edges deserve ink, when), and interaction (how the user
addresses a one-pixel-wide object).

## Edge identity

An edge is an entity with its own durable identity — not "the pair
(source, target)". Parallel edges between the same nodes, an edge whose
endpoint is retargeted by the user, and per-edge state (selection, labels,
styling, provenance) all break under pair-identity
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
Mint edge ids at creation, exactly as for nodes.

## Shared anchor geometry — links and nodes cannot drift

The single most common visual defect in node editors is edges that attach a
few pixels off their nodes — floating anchors, arrowheads buried under
borders, links pointing at where the node *used* to be sized. The root cause
is always the same: node rendering and edge rendering each own a copy of the
node's geometry (size, border, port offsets), and the copies drifted.

The fix is structural: **one geometry function** — given a node, return its
bounds and anchor points — consumed by node rendering, edge rendering,
hit-testing, culling, and layout alike. When a node's size becomes dynamic
(content-driven height), the geometry function is where measurement feeds
in, and everything downstream stays agreed. If an edge and its node can
disagree about where the node's edge is, they eventually will; the technique
is making that disagreement inexpressible.

Anchor *choice* is part of geometry too: an edge attaches at the port it was
drawn from when ports are semantic (typed inputs/outputs), or at the
boundary point facing the other endpoint when attachment is free — recomputed
as nodes move, so edges never enter a node's back.

## Routing

- **Straight lines** are the honest default for sparse graphs — cheapest,
  and the eye follows them without help.
- **Curves** (a soft horizontal-out/horizontal-in sweep between nodes)
  read as "flow" and separate visually where straight lines would overlap;
  they are the diagramming-tool convention for directed pipelines.
- **Orthogonal routing** (axis-aligned segments) reads as "circuit" and
  suits dense technical graphs, at the cost of a real routing algorithm the
  moment obstacles must be avoided.
- **Full obstacle-avoiding routing is a last resort** — expensive, unstable
  under drag (routes flip as nodes move, which reads as flicker), and
  usually a symptom that the layout, not the routing, needs work.

Whatever the shape: arrowheads sit *at the anchor*, outside the node border,
oriented along the final segment; edge labels sit at a stable parametric
point along the path and must not swim as endpoints move slightly.

## The hairball is a design problem

Past a few hundred visible edges, no routing trick saves the picture. The
duty is editorial — decide which edges deserve ink in the current view:

- **Focus-context rendering**: when a node (or cluster) is selected or
  hovered, its edges render at full strength and everything else recedes to
  near-invisible. The user reads one neighborhood at a time; the canvas
  should render one neighborhood at a time.
- **Focused-dimension rendering**: when edges carry kinds (data flow,
  control, reference), draw one kind at a time by default and offer the
  union as an explicit mode. Cross-cluster edges in particular earn ink only
  when the clusters they connect are in context — drawn always, they are the
  hairball.
- **Zoom-aware detail**: far out, edges thin, lose arrowheads and labels,
  and low-weight edges drop entirely; the far view shows structure, the
  near view shows detail. (The rendering-cost side of this lives in
  render-budget; here it is a legibility decision.)
- **Aggregation**: many edges between the same two clusters collapse into
  one weighted bundle edge, expandable on focus. Where the weight itself is
  information, encode it honestly — thickness and opacity scales are
  [data-viz](../../data-viz/data-viz.md) territory.

The test of edge economy: pick a node and ask "what does this connect to?"
— answerable at a glance in any view size, or the economy has failed.

## Interacting with edges

A rendered edge is one or two pixels wide; nobody can press it. Hit-test
edges against a **fat invisible stroke** (eight-plus pixels in screen space,
so it feels the same at every zoom) along the same path geometry. Selected
and hovered edges thicken and lift visually — feedback that the thin thing
was really addressed. Edge context actions (delete, retarget, relabel) hang
off that selection; retargeting is a drag of the endpoint that reuses the
connection gesture from direct-manipulation, provisional edge and live
validity included.
