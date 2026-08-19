---
layer: technique
subject: canvas-graph
technique: direct-manipulation
status: forged
laws: [identity-survives-reuse]
shared_with: []
---

# Direct manipulation

Dragging, connecting, selecting, and snapping are the product surface of a
node editor — the reason it is an editor and not a picture. The mechanics
below are the difference between an editor that feels machined and one that
feels haunted; every one of them is invisible when right and infuriating when
wrong. The general drag-and-drop discipline (drop targets, ghosts, cancel
semantics across arbitrary surfaces) is its own subject — drag-drop; this
technique is the canvas-specific core.

## Pointer capture: the drag outlives the element

The first rule of any canvas drag: **capture the pointer on drag start.**
Without capture, the drag dies the moment the pointer leaves the element that
started it — which happens on the first fast flick, the first pass over an
overlay, the first excursion beyond the window edge. The symptoms without
capture are signature: nodes that "let go" mid-drag, drags that stick to the
cursor forever because the release happened outside and was never heard,
hover states flickering across every element the drag passes over.

With capture, the initiating element receives every subsequent pointer event
until release, no matter where the pointer travels. Release the capture in
every exit path — completion, cancel, and disconnection — or the next
interaction starts with a stale capture ("who releases this" is a question to
answer at capture time, not later).

**When to capture depends on who else needs the stream.** On an element that
is itself the whole gesture target — a node's drag handle — capture at press.
But on a *surface* whose press might become a pan while its children own
their own clicks, capturing at press retargets the entire pointer stream —
including the eventual click — at the surface, and child clicks silently stop
firing; every tap reads as "background". There, capture at the moment the
movement threshold converts the press into a drag, not before. And after any
pan or drag ends, **suppress the trailing click**: releasing a drag over a
node must not select it — the platform will still synthesize a click from
that press-release pair unless the gesture layer eats it.

## Click vs drag: a movement threshold, not a timer

A node is both clickable (select, open) and draggable (move), and the same
press begins either. Disambiguate by **movement**: a press is a click until
the pointer travels beyond a small threshold from its origin — a few pixels,
in *screen* space, so the threshold feels identical at every zoom — and
becomes a drag the moment it crosses. Two invariants:

- **No model mutation before the threshold.** If the position updates from
  the first pointer event, every selection click nudges the node a
  sub-pixel amount — and every click dirties the document, pollutes the undo
  history, and triggers a persistence write.
- **The click fires on release only if the threshold was never crossed** —
  not "if the drag was short". A slow careful two-pixel adjustment is a drag;
  a fast sloppy click with one pixel of travel is a click.

Timing-based disambiguation (long-press-to-drag) belongs to touch idioms, not
to pointer-first canvases; a timer on a mouse makes both gestures feel
laggy.

## Drag math goes through the transform

The pointer moves in screen space; the node lives in world space. The delta
applied to the node is the pointer delta converted through the one transform
authority — at half zoom, a 10-pixel pointer move is a 20-unit world move.
Compute the drag as *(original world position + converted delta from the
gesture origin)*, not as an accumulation of per-event deltas: accumulation
drifts under event coalescing and rounding, and breaks outright if the zoom
changes mid-drag.

Multi-node drags apply one converted delta to every member of the selection,
keyed by node identity
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)) — never
by position in a list that reorders under the drag.

A node drag is the same imperative loan the camera gesture takes (see
viewport-transform): the dragged element moves imperatively, the model
position commits once on release, and the loan is guarded against unrelated
re-renders reconciling the element back to its stale committed position
mid-drag.

## Snapping and alignment guides

Tidy layouts should be cheap, and snapping is how: while dragging, search
nearby nodes for aligned edges and centers within a small screen-space
tolerance; when found, draw a guide line through the aligned pair and snap
the dragged position to it. The rules that keep snapping helpful instead of
sticky:

- **Tolerance in screen space** (it must feel the same at every zoom), the
  snapped result stored in world space.
- **Candidates from the visible set**, not the whole graph — snapping to an
  offscreen node draws a guide to nowhere.
- **The guide is the feedback.** Snap without a visible guide feels like
  stickiness; a guide without snap is a suggestion the user cannot take.
- **A modifier disables it.** Precision placement must remain possible;
  snapping the user cannot escape is a constraint, not an aid.
- Optionally, a coarse grid as the fallback snap when no alignment candidate
  is near — one or the other wins per frame, never both.

## Connecting: ports, targets, and the provisional edge

Edge creation is a drag from a port (or node boundary) that ends on a target.
The mechanics:

- **Hit targets exceed visuals.** A port drawn at six pixels is pressed at
  sixteen; the drawn dot is a label, the interactive area is a promise.
  During a connection drag, valid targets *grow* — the whole target node
  becomes droppable, not just its port.
- **The provisional edge renders from gesture start**, following the cursor,
  visually distinct from committed edges — the user is drawing a
  relationship and needs to see it.
- **Validity is shown live**: eligible targets highlight as the cursor
  approaches; an ineligible drop (type mismatch, cycle, duplicate) shows its
  refusal during the hover, not as a rejection toast after release.
- **Release anywhere else cancels** — cleanly, with no half-created edge in
  the model. The provisional edge was never model state; it was gesture
  state.

## Selection: click, toggle, marquee

Single click selects and deselects the rest; a modifier click toggles
membership; a drag on empty canvas draws a marquee selecting what it
encloses (or intersects — pick one and keep it). The marquee is a
world-space rectangle rendered in screen space, and marquee-drag on empty
space vs pan-drag on empty space must be explicitly assigned (commonly:
bare drag pans, modifier drag or a mode toggle marquees). Selection is a set
of node identities, never of positions or indices.

## Escape hatches

Escape cancels the in-flight gesture — drag returns the nodes to their
origin, connection discards the provisional edge, marquee vanishes — and the
model is untouched, because none of these gestures wrote to the model before
completing. Gestures that mutate as they go cannot cancel cleanly; that is
the deep reason the gesture layer stays provisional until commit, and it is
what makes each completed gesture exactly one undoable transaction (the
contract that undo-history formalizes: one gesture, one history entry — never
sixty position updates).
