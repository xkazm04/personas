---
layer: technique
subject: canvas-graph
technique: viewport-transform
status: forged
laws: [one-authority-per-vocabulary, derivation-names-recomputation]
shared_with: []
---

# Viewport transform

The viewport transform is the pair *(pan offset, zoom scale)* that maps world
coordinates — where nodes and edges live — to screen coordinates — where
pixels paint and pointer events arrive. Everything about a canvas that feels
"solid" (drops landing under the cursor, zoom pinned to the pointer, guides
drawn exactly on borders) is this technique done right; most of what feels
"haunted" is this technique done twice.

## One conversion authority

All screen↔world conversion lives in **one module**: `toWorld(point)`,
`toScreen(point)`, and their rectangle variants, all reading the same
transform state. Nothing else in the codebase multiplies or divides by the
scale, ever.

This is [one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
applied to geometry: the transform is a closed vocabulary of exactly one
entry, and every consumer derives from it. The failure mode of duplicating it
is characteristic — each hand-rolled conversion is *individually plausible*
(what is hard about dividing by scale?), and each one silently disagrees the
day the transform grows a wrinkle: a clamp, a centered origin, a
content-fit offset, a device-pixel correction. Then the bugs present as five
unrelated symptoms — drag ghosting, misplaced menus, a minimap that lies —
and get five local patches instead of one fix.

Two derived values also belong to the authority, because they are pure
functions of it: the **visible world rectangle** (what culling queries — a
stored copy that is not recomputed when the transform changes is a stale
derivation, per
[derivation-names-recomputation](../../_laws.md#derivation-names-recomputation))
and the **fit-to-content transform** (the pan/scale that frames a given world
rectangle with margins).

## Zoom-to-point

Zoom must pin the point under the cursor: the world position under the
pointer before the zoom is still under the pointer after. This is a
three-line change of basis, and it must be written once, in the authority:

1. Convert the cursor's screen position to world space with the *old*
   transform.
2. Apply the new scale (clamped to the min/max range).
3. Recompute the pan so that the same world point maps back to the same
   screen position under the *new* scale.

Every zoom entry point — wheel, pinch, keyboard shortcuts, zoom buttons,
double-click — routes through this one operation, differing only in which
point they pin (the cursor for pointer gestures; the viewport center for
buttons and keys). A zoom that scales about the origin instead of the cursor
is the single most recognizable "amateur canvas" tell: the content rockets
toward a corner and the user must pan back after every zoom step.

Clamp the scale in the authority, not at call sites — an unclamped path (a
trackpad pinch, an inertial wheel) will otherwise zoom to a scale where
floating-point geometry and text rendering both degrade.

## Gesture-time updates: imperative, then committed

During a pan or pinch the transform changes on every pointer event —
potentially several per frame — and the render path must keep up on a
populated canvas. The contract:

- **During the gesture**, write the transform imperatively to the one
  container element that carries it. No model updates, no full declarative
  commit per event. The visual result is a single composited transform
  change — the cheapest operation the platform offers.
- **Commit to declarative state at most once per animation frame**
  (coalescing intermediate events), or once at gesture end for the cheapest
  correct variant. The committed state is the truth: culling, minimaps,
  persistence, and anything else reading the viewport read *state*, not the
  element.
- **The gesture path is a loan, always repaid.** At commit, element and state
  agree exactly. Nothing outside the gesture handler ever reads the element's
  transform back — if the element is the only place a value lives, the
  declarative world has quietly stopped being the truth. (The gesture layer
  itself keeps one live mutable copy of the in-progress transform for its own
  math — rubber-band rectangles, provisional placement — because committed
  state is deliberately stale mid-gesture.)
- **Guard the loan against reconciliation.** In a declarative framework, any
  unrelated re-render that lands mid-gesture (a background poll, a hover
  elsewhere) will rewrite the container's transform back to the *stale
  committed* value, and the view visibly snaps backward under the user's
  hand. The imperative path therefore re-asserts the live transform after
  every render for as long as the gesture is active — a one-line guard that
  is invisible until the day it is missing.
- **On a sustained gesture, commit periodically anyway.** "Commit at rest"
  alone means everything derived from committed state — the culling window
  above all — goes stale for the whole gesture, and a long pan drags across
  blank, culled world. Trigger an interim commit every time the viewport has
  traveled some fraction of the cull margin; the gesture stays render-free
  frame-to-frame while the derived world follows in coarse steps.

The same pattern applies to dragging a node: the node's provisional position
moves imperatively; the model position commits per frame or on release.

One more ownership rule: **the user always wins the camera.** Programmatic
travel — fit-to-content, an animated fly-to — is a tween that any manual
wheel or drag input cancels immediately, and a canceled tween still resolves
whatever was awaiting it (callers observe wherever the camera ended up, not a
promise that never settles). A camera that fights the user's input to finish
its animation feels possessed; one that ignores completion callbacks on
cancel leaks stuck program logic.

## Wheel and gesture event ownership

Wheel events are the canvas's zoom input, and they carry two traps.

**Ownership follows bubbling, not appearance.** A wheel listener must be
attached where the event dispatch path actually delivers events for the
pixels the canvas occupies — which is determined by the document tree, not by
what visually appears frontmost. Overlays, portaled layers, and stacked
surfaces can sit visually above the canvas while their events bubble through
an entirely different ancestor chain; conversely, the canvas can receive
wheel events that a visually-covering panel "should" have consumed. The
symptom is unmistakable once seen: scrolling inside an overlay zooms the
canvas behind it. The fix is structural — attach the listener to the element
that is genuinely the event target's ancestor for canvas pixels and only
those, and stop treating visual stacking as event routing. Layering and
precedence for stacked surfaces is its own subject; see
[layering-and-precedence](../../modal-stack/techniques/layering-and-precedence.md).

**Preventing default scroll requires an active listener.** Platforms treat
wheel listeners as passive by default so pages scroll smoothly; a canvas that
wants the wheel for zoom must register a non-passive listener and cancel the
default, or the page scrolls *and* the canvas zooms. Decide the wheel policy
explicitly — zoom on bare wheel (diagramming convention) or scroll on wheel
with a modifier for zoom (document convention) — and apply it consistently;
mixed policies across surfaces in one product retrain the user's hands
against themselves.

Trackpad pinch typically arrives as a modifier-flagged wheel stream; route it
to zoom-to-point regardless of the bare-wheel policy.

## Anti-patterns worth naming

- Scale math scattered across features — the five-symptom geometry haunt.
- Zoom about the origin, or zoom-to-point re-derived (differently) per entry
  point.
- Reading the container's transform back as a source of truth.
- Committing the full declarative pipeline on every pointer event, then
  buying frames back with memoization heroics downstream.
- A wheel listener placed by visual intuition, discovered the day an overlay
  scrolls the sky behind it.
- Unbounded zoom range, discovered at scale 0.0001 as a blank screen with no
  way home (pair the clamp with a fit-to-content escape hatch).
