---
layer: technique
subject: canvas-graph
technique: render-budget
status: forged
laws: [identity-survives-reuse, derivation-names-recomputation]
shared_with: []
---

# Render budget

A canvas pays its rendering cost on the hottest path in UI — continuous
pointer movement — and its cost is multiplicative: nodes × edges × (label
formatting + reactivity + paint). The budget is a ladder, climbed only as far
as measurement forces, but with one difference from ordinary list surfaces:
**rung 1 is not optional.** A scrolling list that re-renders too much is
sluggish; a canvas that re-renders on pan is unusable, because pan *is* the
primary interaction. The ladder for list-shaped surfaces is
[performance](../../table/techniques/performance.md); this technique is the
canvas-specific variant.

## Rung 0 — measure the actual shape

Establish: node count and edge count at the high percentile (not the demo
graph), the cost of one node render, and *what re-renders on a pan step, a
zoom step, a single-node drag, and a selection change*. The last one is the
diagnostic that matters — each of those interactions has a correct answer
("nothing", "nothing", "one node plus its edges", "the nodes entering and
leaving the selection") and the distance between the correct answer and the
measured answer is the entire optimization backlog, already prioritized.

## Rung 1 — pan and zoom touch one element

The viewport moving is a change to the *container's* transform, never to any
node. Nodes position themselves in world coordinates, once; the container
maps world to screen. During a gesture the transform updates imperatively
(see viewport-transform); at commit, the only declarative consequence should
be the culling set, not node re-renders.

This rung is structural, not incremental: if node components receive the
transform as an input — because they compute their own screen positions —
then every pan invalidates every node *by construction*, and no memoization
can recover it. The transform belongs to the container; nodes must not know
it exists.

## Rung 2 — cull to the visible world rectangle

Render only elements intersecting the visible world rectangle, expanded by
an overscan margin (so entrances happen offscreen) — a world-space query
against the transform authority's derived rectangle, cheap enough to run per
commit. Two canvas-specific rules:

- **An edge is visible if any part of its geometry crosses the viewport**,
  even when both endpoints are far outside. Culling edges by endpoint
  visibility deletes exactly the long cross-graph links the user is trying
  to follow.
- **Culling churn is reuse.** As the user pans, elements enter and leave the
  culled set constantly; keyed-by-identity rendering
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)) is what
  keeps re-entry cheap and keeps per-node state (hover, entrance animation,
  edit affordances) from landing on the wrong node after churn.

Cull *before* formatting: a node outside the viewport should cost a rectangle
test, not a rectangle test plus a formatted label it will never paint.

Two cold-start corollaries: before the viewport has been measured, the
culled set is **empty, not everything** — a first pass that mounts the whole
world only for the second pass to cull it is pure waste, and on a populated
graph it is the first-open freeze. And when the initial framing legitimately
shows many elements at once, mount them in **waves under a frame budget**
(a slice per frame, sized by how long the previous slice actually took,
filling nearest-to-center first) so the area the user is looking at paints
first and the main thread never blocks for the whole set.

Culling reads *committed* viewport state, which goes stale during a
render-free pan — so sustained gestures make interim commits by travel
distance (sized against the overscan margin; see viewport-transform), or the
user pans across empty sea where culled content should be. The margin and
the commit cadence are one budget decided together.

## Rung 3 — nodes re-render on their own changes only

- **Memoize node rendering on identity + version.** A node re-renders when
  its own data, position, or selection membership changes — never when a
  sibling's does.
- **Referentially stable callbacks.** The interaction callbacks handed to
  every node (select, drag-start, connect, open) must be stable across
  renders; a callback rebuilt on each parent render is a memoization-defeater
  multiplied by node count. Stabilize them by having the callback take the
  node's identity as an argument, rather than baking a fresh closure per
  node.
- **Nodes read their own state.** A node that subscribes to the whole
  canvas's state — the full selection set, the full node map — re-renders on
  every change by construction. Pass each node its record and its own
  booleans, derived outside.
- **Derive the render list, and name its inputs.** The culled, z-ordered
  sequence is a cached derivation of (nodes, edges, viewport rectangle,
  selection); recompute exactly when a named input changes
  ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
  A derivation that recomputes "whenever anything re-runs" is rung 1's bug
  wearing rung 3's clothes.

## Rung 4 — detail is a function of zoom

Below the scale where text is legible, labels are pure cost: stop rendering
them — or counter-scale them: labels that shrink sub-linearly with the zoom
(a fractional power of the scale) stay readable far out without becoming
billboards up close, which keeps names useful across a wider zoom range than
a hard visibility cutoff. Fade thresholds should be ramps, not steps —
detail that pops in at an exact scale draws attention to itself on every
zoom crossing. The same for ports, badges, avatars, shadows, and rounded detail —
each has a zoom threshold below which it becomes noise the user cannot read
but the renderer still pays for. Far-out views draw simplified geometry
(rects for nodes, straight segments for curved edges). This is the canvas
version of virtualizing cell content rather than rows: the *element* stays,
its expensive interior goes.

Level-of-detail is also a legibility feature, not just a budget one — the
far-out view exists so the user can see structure, and structure reads
better without ten thousand illegible labels. Edge-specific detail policy
(which links deserve ink at which zoom) belongs to edge-management.

## Anti-patterns worth naming

- Nodes computing their own screen positions from the transform — every pan
  renders the world (the structural defeat; no downstream fix exists).
- Culling nodes but drawing all edges, or culling edges by endpoint
  visibility.
- A fresh closure per node per render, then memoizing harder to compensate.
- Formatting labels for culled elements.
- Entrance animations keyed by render order, replaying on every culling
  re-entry — animation state keyed by anything but node identity.
- Reaching for a full canvas-rasterization rewrite before measuring whether
  rungs 1–3 were ever actually in place.
