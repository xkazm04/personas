---
layer: technique
subject: canvas-graph
technique: canvas-accessibility
status: forged
laws: []
shared_with: []
---

# Canvas accessibility

An infinite pan/zoom surface inherits none of the accessibility a document
gets for free: no reading order, no scroll-into-view, no native find, no
sequential focus that means anything spatially. Whatever the canvas offers
non-pointer and non-visual users exists because it was designed. The good
news: a node graph has *more* usable structure than most visual surfaces —
it is a set of named entities with typed relationships — and the design move
that unlocks everything is to expose the **graph**, not the geometry.

## The focus model

- **The canvas is one focusable region** with an accessible name saying what
  it contains ("Pipeline editor, 24 steps, 31 connections"). Tabbing reaches
  the canvas once — not once per node; a hundred nodes in the page's tab
  order make the surface a wall that keyboard users must arrow through to
  reach whatever is after it.
- **Inside the region, focus is roving**: arrow keys and shortcuts move a
  single active-node cursor among nodes; the canvas remembers the active
  node across blur and refocus. The active node is always scrolled *and
  panned* into view — focus the user cannot see is focus lost.
- **Focus is not selection.** The cursor travels; selection is an explicit
  act on the focused node (with the modifier grammar mirroring the pointer
  one). Conflating them makes exploration destructive.

## Navigation: spatial and topological

Offer both axes, because both questions are real:

- **Spatial** — arrow keys move to the nearest node in that screen
  direction. This matches the user's visual map and is the intuitive
  default.
- **Topological** — distinct shortcuts walk the *graph*: to a node's
  outgoing targets, incoming sources, siblings, or back along the path just
  walked. For the user who cannot see the picture, topology is the truthful
  structure; spatial neighbors on an infinite surface can be semantically
  unrelated.

Supplement both with a **search/jump palette** — type a node's name, land on
it, canvas panned to frame it. On a large graph, search is the primary
navigation for everyone, not an accessibility concession.

## Operations without a pointer

Every mutation the pointer can perform has a keyboard path:

- **Move**: arrow keys (with a modifier) nudge the focused/selected nodes by
  a small world-space step; a larger modifier steps coarser. Nudging emits
  the same model transitions as a drag — one undoable move per key gesture.
- **Connect**: a "start connection" shortcut on the focused node enters a
  pick mode; navigation then travels *eligible targets only*, with the same
  live validity the provisional edge shows visually; confirm creates the
  edge, escape cancels.
- **Edit, delete, open**: the focused node's actions are reachable via
  shortcuts and via a context menu key — never hover-only affordances.
- **Zoom and fit are real buttons** (and shortcuts): zoom in, zoom out,
  fit-to-content, fit-to-selection, reset. Gesture-only zoom strands anyone
  without a wheel or trackpad — including anyone at a keyboard.

## What the screen reader hears

- Nodes announce as themselves: name, kind, state, and degree ("Validate
  order — step — 2 inputs, 3 outputs — selected"), not as unlabeled shapes.
- Moving focus announces the node just landed on; connecting announces the
  candidate and its eligibility; completing announces the created edge in
  relationship terms ("connected Validate order to Send invoice").
- Selection changes announce the running count ("3 nodes selected").
- The *graph as text* is the deep answer: an inspectable, ordered list view
  of nodes and their connections — the same model, document-shaped — is both
  the strongest assistive rendering and a useful power feature (outline
  panel) for sighted users. When the canvas view and the list view are two
  renderings of one model, neither can go stale.

## Motion and comfort

Entrance cascades, zoom animations, and pan glides respect the platform's
reduced-motion preference — an infinite surface animating its whole world
transform is one of the strongest vestibular triggers in UI. With reduced
motion: cuts instead of glides, and fit-to-content jumps instantly. High
zoom is also a low-vision feature — nothing may break at maximum zoom (text
clipping, layout falling apart), because for some users that is the only
usable scale.
