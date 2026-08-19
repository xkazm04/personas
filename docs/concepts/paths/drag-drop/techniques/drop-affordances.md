---
layer: technique
subject: drag-drop
technique: drop-affordances
status: forged
laws: []
shared_with: []
---

# Drop affordances

Drag & drop draws no persistent chrome; feedback *is* the interface. Each
lifecycle stage owes the user the answer to one question, and the craft is in
answering all of them without turning the surface into a light show.

## Before: what is draggable?

Drag features are invisible by default — nothing about a list row announces
that it can be carried. Grabbability must be drawn:

- **A handle** where the item is otherwise interactive: a dedicated grip
  region with the conventional texture (dots, bars), visible on hover or
  focus at minimum, always-visible on surfaces where dragging is a primary
  verb. The handle also *narrows the arming surface* (see
  [drag-lifecycle](drag-lifecycle.md)), so it earns its pixels twice.
- **A cursor that offers the grab** over the draggable region, switching to
  the grabbing form while held.
- **A lift on press** — slight scale or shadow on the armed item — telling
  the user the thing is now in hand before it has moved a pixel. On touch,
  where there is no hover and no cursor, the lift *is* the arming cue.

An undiscoverable drag is a feature that exists only for users who already
know; treat discoverability as part of the feature's definition of done.

## During: what would happen right now?

The moment the drag activates, the surface answers continuously:

- **Valid targets announce themselves** — every container that would accept
  this payload brightens or outlines *at drag start*, not merely under the
  pointer. The user is choosing a destination; showing candidates only on
  arrival makes them scan by trial.
- **The target under the pointer distinguishes itself** from the merely
  valid: a stronger treatment on the container the drop would enter.
- **The exact position is previewed.** For ordered lists, an insertion
  indicator — a line or an opening gap between the two records the drop
  would land between — updated as the pointer moves. The preview is a
  *promise*: the drop must land exactly where the indicator said, or the
  affordance is training users to distrust it. One indicator at a time,
  always between the true neighbors, computed from the same geometry the
  drop handler will use.
- **The dragged item leaves a trace at home** — its origin renders as a
  placeholder (dimmed or hollow) rather than closing up, so the user retains
  the option to understand "back" and cancel confidently.

## The drag representation

What travels with the pointer is a **representation**, not the live item: a
lightweight visual (the item's silhouette, slightly translucent, slightly
scaled) that reads as "in hand" and never intercepts the pointer's own
hit-testing — the classic self-inflicted bug is a preview that sits under
the pointer and blocks every target from ever being hovered. For multi-item
drags, a stacked representation with a count badge; ten full row-visuals in
hand reads as an error.

## Invalid ground refuses out loud

A target that cannot accept the payload must *communicate* refusal, not sit
inert: the no-drop cursor over it, a muted or barred treatment on the
container, and — where the reason is knowable and the surface can afford it
— a short statement of why. Silence is the worst option: the user hovers,
sees nothing, drops, and nothing happens, with no way to distinguish "not
allowed" from "broken". Distinguish two cases deliberately: *not a target*
(neutral, unlit) versus *a target that refuses this payload* (visible
refusal). Both exist on every surface; drawing them identically hides the
existence of the rule the user just tripped on.

## Edges scroll

Long lists and boards exceed the viewport, and the pointer cannot drop on
what it cannot reach. Nearing the scrollable edge during a drag scrolls the
container — proportionally to proximity, capped, and stopping the instant
the pointer retreats or the mode exits (a leaked auto-scroll is the worst
residue a drag leaves; its cleanup is the lifecycle's problem, named there).
Without edge scrolling, "move this to a distant position" is impossible by
drag, and users discover that mid-gesture, holding an item with nowhere to
go.

## After: did it take?

The drop closes the loop:

- **Commit settles.** The item animates from the release point into its
  final slot — a short, decisive motion that confirms *where it went*. An
  instant teleport loses the thread between gesture and result; a slow float
  makes the interface feel drugged.
- **Cancel returns.** The item animates back to origin, visibly retracing,
  so cancellation reads as "returned safely", not "glitched".
- **Deferred outcomes look deferred.** When the drop is a request awaiting
  an authority (see [ownership-boundaries](ownership-boundaries.md)), the
  item shows a pending treatment in its new position rather than pretending
  the world already changed.

All of this respects the user's motion preferences: on reduced-motion
settings, settles and returns become instant state changes with the same
informational content — the *answer* is mandatory, the choreography is not.
