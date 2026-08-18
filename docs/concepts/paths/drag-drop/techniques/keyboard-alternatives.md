---
layer: technique
subject: drag-drop
technique: keyboard-alternatives
status: forged
laws: []
shared_with: []
---

# Keyboard alternatives

A drag is a gesture wrapped around an operation — *move X to position P* /
*into container C*. And on the dominant platforms this is not an
enhancement question: **the native drag machinery has no keyboard entry
point at all** — no key combination starts a drag on a focused draggable;
this has been measured, not assumed. Focusing the item, labeling it,
decorating it with grab semantics changes nothing: the gesture simply
cannot be entered without a pointer. So the keyboard path is necessarily a
**second control invoking the same operation**, not a focusable version of
the same gesture — and a team that has not defined the operation apart from
the gesture has nothing for that second control to call.

The operation must be reachable without the gesture:
for keyboard users, for assistive-technology users, for anyone whose motor
precision makes a sustained pointer hold hostile, and for automation driving
the surface. This is not a parallel accessibility feature appended after the
pointer path ships; it is the proof the operation exists independently of
its gesture. A design that cannot say what the keyboard equivalent *does*
has not defined its operation — and that gap will surface in the pointer
path too, as drops nobody can state the semantics of.

## The grab-move-drop model

The keyboard interaction mirrors the drag lifecycle deliberately — same
mode, same exits, different input:

- **Grab.** With focus on the item (or its handle), an activation key enters
  the mode. The item shows the same lifted treatment the pointer path uses;
  the surface is now in the drag mode with everything that implies
  ([drag-lifecycle](drag-lifecycle.md) — singleton mode, named cleanup, all
  of it).
- **Move.** Arrow keys step the item through *candidate positions* — the
  same positions the pointer's insertion indicator would preview, drawn with
  the same preview treatment. Where containers are targets, the same keys
  (or a modifier) step across containers. Each step is a preview, not a
  commit: the arrangement has not changed yet.
- **Drop.** The activation key again commits at the previewed position —
  entering the identical statement-of-identities path the pointer drop uses
  ([payload-and-identity](payload-and-identity.md)), through the same
  validation door ([ownership-boundaries](ownership-boundaries.md)). One
  operation, two inputs; two code paths is a bug factory where the keyboard
  path decays unnoticed.
- **Cancel.** Escape exits the mode and the item returns to its true
  position — exactly the pointer path's cancel.

Focus management is part of the contract: focus rides with the grabbed item
through every step, and after drop or cancel it rests on the item in its
final position — not on the container, not lost to the document root. A
keyboard move that strands focus forces the user to re-navigate to the thing
they just moved, which is the gesture equivalent of teleporting the pointer.

## Announce every transition

Visual preview is invisible to a screen reader; the mode must narrate
itself through the assistive layer's live announcements:

- on grab: what was picked up, and how to move, drop, and cancel — the
  instructions are announced *at grab time*, because this modal grammar is
  not discoverable by exploration;
- on each move: the new candidate position, with context — "after Deploy
  pipeline, position 4 of 9" or "moved to lane Review, position 2 of 3" —
  positions numbered within the *current* arrangement, containers by their
  accessible names;
- on drop: confirmation of where it landed — and for request-posture drops,
  the pending state and later the authority's answer are announced too; a
  rejection that is only drawn is a rejection a non-visual user never hears;
- on cancel: that the item returned, and to where.

The draggable item itself declares its grabbed/not-grabbed state through the
accessibility layer, so its mode is inspectable, not only narrated.

The inverse discipline matters as much: **never declare what cannot be
operated.** A grip element that announces itself as a button to assistive
technology but cannot receive focus or respond to a key is a *false
affordance* — worse than an unlabeled decoration, because it promises a
control that does not exist and spends the user's effort discovering the
lie. Semantics follow capability; add the role and the label in the same
change that adds the focusability and the handler, never ahead of it.

## Alternatives beyond the mirror

The grab-move-drop mirror is the floor, and for some populations it is still
expensive — a fifty-step arrow journey is no gift. Offer *operation-shaped*
alternatives where the surface's verbs allow, and route them through the
same statement path:

- a **move-to menu** on the item (send to container, move to top/bottom)
  for container-dominant surfaces — often faster than any drag for every
  user, which is the tell that the drag was the accelerator, not the
  operation;
- **explicit position editing** where order is the point and precision
  matters;
- **cut-and-paste semantics** (pick up here, navigate freely, put down
  there) for long-distance moves that would fight edge auto-scroll.

These are not redundancy; they are the operation showing up honestly in the
interface's command vocabulary. The gesture stays the delightful path — the
vocabulary is what makes it optional.
