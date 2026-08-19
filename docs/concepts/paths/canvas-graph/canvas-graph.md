---
layer: golden-path
subject: canvas-graph
status: forged
techniques:
  - viewport-transform
  - render-budget
  - direct-manipulation
  - graph-layout
  - edge-management
  - canvas-accessibility
evidence:
  - src/features/teams/sub_mastermind/lib/CanvasShell.tsx        # canonical canvas shell: culling, memoized islands, stable callbacks, kb cursor
  - src/features/teams/sub_mastermind/lib/useCanvasCamera.ts     # one transform authority: render-free pan, rAF-coalesced zoom-to-cursor, mid-pan commit
  - src/features/teams/sub_mastermind/lib/useIslandDrag.ts       # gesture loan on a node drag: capture, 4px threshold, world conversion, commit-on-release
  - src/features/teams/sub_mastermind/lib/tidyLayout.ts          # deterministic bounded auto-layout; user-pinned positions as fixed anchors
  - src/features/teams/sub_mastermind/lib/layoutStore.ts         # one versioned layout document, v1→v2 migration, author (provenance) field
  - src/features/overview/sub_patterns/canvas/useGraphCanvas.ts   # wheel-ownership lesson (container→svg), capture-at-threshold, trailing-click suppression, LOD
  - src/features/overview/sub_patterns/hierarchy/graph/HierarchyNexus.tsx  # shared geometry for links + nodes; cross-cluster edges only in focused dimension
counter_evidence:
  - src/features/teams/sub_mastermind/lib/GroupLayer.tsx         # group-body drag with no travel threshold — the click-vs-drag defect the standard names
deviations:
  - w7-canvas-graph   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Canvas & node-graph editing

A pan/zoom node surface is the surface you reach for when the user's job is
**understanding and editing relationships** — a topology of entities and the
connections between them — and when *spatial memory* is part of how they will
work: "the ingestion cluster lives top-left, the failure path hangs off the
right edge." The canvas trades the guarantees of a scrolling document (linear
order, native scrolling, native find) for two things no other surface offers:
direct manipulation of structure, and a stable geography the user builds up
over sessions.

That definition decides when *not* to build one:

- **A table or list** when the records have no meaningful topology — a set of
  items with attributes is a comparison job, not a relationship job, and a
  canvas forced onto it becomes a scatter of cards the user must tidy for no
  payoff.
- **A tree view** when the structure is a strict hierarchy the user navigates
  but does not rewire. An outline with indentation does everything a canvas
  does for hierarchy, at a fraction of the cost, with native scrolling and
  keyboard behavior for free.
- **A generated diagram** when the graph is read-only and the layout carries
  no user intent. If nobody ever drags a node, you do not need an editor —
  you need a renderer, and layout becomes a pure function you can run
  anywhere.
- **A form or wizard** when the structure is small and fixed. Three boxes
  and two arrows are not a graph problem; they are a settings problem wearing
  a graph costume.

The failure modes in both directions are real. A canvas where topology does
not matter is busywork — the user maintains a layout that encodes nothing. A
tree or table where topology *does* matter forces the relationship model into
prose, tooltips, and the user's head.

## The world transform is the one coordinate authority

Every canvas has two coordinate spaces: **screen space** (where pointer events
arrive, where pixels are painted) and **world space** (where nodes and edges
actually live). The mapping between them is a single transform — a pan offset
and a zoom scale — and that transform must be the *only* authority for
conversion, owned by one module through which every screen↔world conversion
passes.

This is the load-bearing decision of the whole subject. The moment two
features do their own coordinate math — a drag handler dividing by scale here,
a context-menu placement adding an offset there, a minimap inverting the
transform its own way — they disagree the first time the transform changes
shape (a clamped zoom, a centered origin, a device-pixel correction), and
every symptom looks like a different bug: drops land beside the cursor,
guides draw a few pixels off, zoom drifts toward a corner. One conversion
authority turns a whole class of geometry bugs into one function with tests.
The full contract — including zoom-to-point, which is nothing but a change of
basis through that one authority — is the
[viewport-transform](techniques/viewport-transform.md) technique.

## Two rendering regimes: gesture time and rest

A canvas lives under two very different performance contracts, and conflating
them is the classic architecture mistake.

**At rest**, the canvas is ordinary declarative UI: state describes nodes,
edges, and the viewport; rendering derives from state; updates flow through
the normal commit path. Everything is inspectable, undoable, and testable.

**During a gesture** — a pan, a pinch, a node drag — the contract inverts.
The surface must track the pointer at the display's refresh rate, and a full
declarative commit per pointer event cannot be guaranteed to hold that budget
on a populated canvas. The fast path is imperative: mutate the container's
transform directly as events arrive, and *commit to declarative state at most
once per animation frame, or once at gesture end*. The declarative world is
the truth; the imperative path is a bounded, well-marked loan against it that
is always repaid at the next commit.

The discipline that keeps this honest: the imperative path touches only the
transform (and the dragged node's provisional position) — never the model.
Anything that mutates nodes, edges, or selection goes through the state
owner, where undo-history and persistence can see it.

## The render budget

A canvas's cost is multiplicative — nodes × (edges per node) × (formatting +
reactivity) — and it is paid on the hottest possible path: pointer movement.
The budget rules, in order of leverage:

1. **Pan and zoom must not re-render nodes.** The viewport moving is a change
   to *one container's transform*, not to any node. A canvas that re-renders
   every node on pan is already dead; no memoization downstream can save it.
2. **Cull to the viewport, with margins.** Only elements intersecting the
   visible world-rectangle (plus an overscan margin so entrances are not
   visible) get rendered at all. Culling is a world-space query against the
   one transform authority.
3. **Nodes re-render on their own changes only.** Identity-keyed, memoized,
   fed referentially stable callbacks — a callback rebuilt on every parent
   render silently defeats the memoization of every node it touches.
4. **Detail is a function of zoom.** Labels, ports, badges, and shadows
   disappear below the scale where they are legible; far-out views draw
   simplified geometry.

The full ladder, and the measurements that decide how far to climb it, are in
[render-budget](techniques/render-budget.md).

## Layout is data with a lifecycle

Node positions are **user data**, not rendering incidentals. The user spent
minutes arranging the graph so it matches the model in their head; discarding
that arrangement on reload is losing their work as surely as dropping the
text of a document. Consequences:

- **Positions persist**, keyed by durable node identity — never by array
  order, which insertion and deletion scramble.
- **The persisted layout is versioned and migrated** like any other stored
  state, because node shapes, default sizes, and coordinate conventions
  change across releases; a layout written by last year's build must load
  correctly or degrade explicitly, never silently scramble. This inherits the
  whole discipline of
  [client-state](../client-state/client-state.md) persistence.
- **Auto-layout is a suggestion, never a dictator.** An algorithm may propose
  positions — on first load, for nodes that have never been placed, or on
  explicit user request — but it must not overwrite placements the user made.
  The dividing line is provenance: track which positions are user-authored
  and which are generated, and let the algorithm touch only the latter.
- **New nodes need a placement policy.** Something with no saved position
  must land somewhere sensible (near its neighbors, in the visible viewport,
  not at the origin under everything else) — the canvas equivalent of a
  cursor position.

Algorithms, tradeoffs, and the persistence contract are in
[graph-layout](techniques/graph-layout.md).

## Edges are the scalability cliff

Nodes scale roughly linearly with content; edges scale with *relationships*,
which in real graphs grow super-linearly and cross each other. Every canvas
that dies visually dies as a hairball, and hairball control is a **design
duty, not a rendering trick**: decide which edges deserve ink at which zoom
level and in which focus context, rather than drawing all of them faintly and
calling it done. Edge geometry must also be *derived from node geometry
through shared code* — the anchor a link attaches to and the border the node
draws must come from one computation, or the two drift and every edge floats
a few pixels off its node. Routing, level-of-detail, focus-context rendering,
and edge hit-testing are the [edge-management](techniques/edge-management.md)
technique. Where an edge encodes a quantity (weight, volume, recency), the
encoding rules come from [data-viz](../data-viz/data-viz.md).

## Direct manipulation is the product

The canvas exists so users can grab structure and change it. The interaction
layer has non-obvious mechanics that separate a solid editor from a flaky
one: pointer capture so a drag survives leaving the element and the window;
click-vs-drag disambiguation by movement threshold, not timing; drag deltas
converted through the transform authority so a node tracks the cursor at any
zoom; snapping and alignment guides that make tidy layouts cheap; connection
gestures whose targets are larger than their visuals. Every mutation the
interaction layer produces is a first-class state transition — named,
undoable (the contract that undo-history formalizes), and persisted. The
mechanics live in [direct-manipulation](techniques/direct-manipulation.md).

## Accessibility posture

An infinite surface has no native reading order, so accessibility must be
designed, not inherited. The canvas is focusable and announces itself; nodes
are reachable in a deliberate keyboard order; selection, movement, and
connection are all operable without a pointer; zoom and fit controls exist as
real buttons, not gesture-only affordances. Screen-reader users get the
*graph*, not the geometry: what is selected, what it connects to, where focus
can go next. The model is
[canvas-accessibility](techniques/canvas-accessibility.md).

## The techniques

- [viewport-transform](techniques/viewport-transform.md) — the one coordinate
  authority: screen↔world conversion, zoom-to-point, gesture-time imperative
  updates with per-frame commit, and wheel-event ownership.
- [render-budget](techniques/render-budget.md) — culling, memoization, stable
  callbacks, zoom-dependent detail: keeping frame cost flat as the graph
  grows.
- [direct-manipulation](techniques/direct-manipulation.md) — drag, connect,
  snap, and select mechanics: pointer capture, click-vs-drag thresholds,
  alignment guides.
- [graph-layout](techniques/graph-layout.md) — auto-layout as suggestion,
  layout persistence and migration, placement policy for new nodes.
- [edge-management](techniques/edge-management.md) — routing, shared anchor
  geometry, level-of-detail, and hairball control as a design duty.
- [canvas-accessibility](techniques/canvas-accessibility.md) — focus model,
  keyboard navigation, and non-pointer operation on an infinite surface.
