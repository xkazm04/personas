---
layer: technique
subject: async-ui-states
technique: action-busy-states
status: forged
laws: []
shared_with: []
---

# Action busy states

When the user activates a control that starts asynchronous work — save, send,
retry, approve, test connection — the control itself must answer one question
immediately: **did my press register?** The answer is a busy state *on the
control*, and it has a precise contract. This is the one place in an async
product where a spinner is not just allowed but required; everything banned
for loading surfaces is mandatory here, because the question is different.

## The contract of a pressed control

1. **Acknowledgment is immediate and in place.** The moment the operation
   starts, the control shows a real, visible busy affordance — a small
   spinner where the icon was, or beside the label. Not a global overlay, not
   a toast, not a cursor change: the feedback lives on the thing pressed,
   because that is where the user is looking.
2. **The control disarms.** Busy means disabled — a second press must be
   structurally impossible, because the double-submit is the actual defect
   this state exists to prevent. Duplicate orders, double sends, and repeated
   mutations are all one unguarded button.
3. **Geometry holds.** The control keeps its width and height while busy.
   Swapping a label for a spinner that reflows the layout makes the whole
   region twitch at exactly the moment the user is watching it. Reserve the
   space; overlay or replace within fixed bounds.
4. **The label may tell the truth** — "Saving…" instead of "Save" — but the
   spinner is not optional when the label changes; text alone is too easy to
   miss and unavailable to a glance.
5. **Announced, not just drawn.** The control exposes its busy state to
   assistive technology, and disabling is paired with that announcement — a
   control that silently disables reads as broken to a non-visual user.
   Completion (success or failure) is announced too; a sighted user sees the
   spinner stop, and the non-visual equivalent is a live-region message.

## The disarm is synchronous

The double-submit guard has a timing requirement the visual state cannot
meet: a fast double-press lands *before* any state-driven re-render can
disable the control. A busy flag that travels through the rendering cycle —
set state, wait for the next paint, control now disabled — leaves a window
of one frame or more exactly where the defect lives, and users double-click
inside it routinely. The guard is therefore armed synchronously, in the
activation event itself, before any asynchronous work starts; the visible
busy state may lag a frame behind, but the second press must already find
the door closed.

## Tie the state to the operation, not to a flag

The busy state must derive from the operation's actual lifetime. The
canonical implementation takes the operation itself (the pending work) and
manages busy/disarm/restore internally; the call site provides only the
action. Hand-managed boolean flags around each call site fail in the ways
hand-managed state always fails:

- forgetting the failure path, so one thrown error leaves the button spinning
  forever;
- forgetting the flag entirely on the next button someone adds — the
  convention only works when the easy path is the correct one;
- **fire-and-forget disarms the guard silently.** Wrapping the operation so
  its result is discarded — starting the work without handing its lifetime to
  the control — leaves a button that looks wired but never disables and never
  spins. The plumbing looks identical at the call site; only the behavior
  under a double-press differs. This is the most common way a correct busy
  control degrades during refactoring.

## Scope: the item pressed, not the collection

A per-item action (approve this row, delete this entry) owns a per-item busy
state, keyed by the item's identity. A single scalar flag shared across the
collection lights up every sibling's button when one is pressed — visibly
wrong — or, guarded lazily, disables nothing. The state's scope equals the
action's scope, always.

When busy legitimately spans more than the pressed control — two controls
drive one operation, or the operation outlives the control's own lifetime —
do not lift a boolean. Register the operation in shared state **keyed by the
entity's identity**: added before the work starts, removed on both the
success and the failure path, with each control reading its own key's
membership. One flag never drives two different actions, and a per-entity
operation is never signalled by a scalar.

An operation measured in minutes graduates out of the control altogether:
hand its lifetime to an application-level activity surface that survives
navigation, return the control to actionable, and point at where progress
now lives. A button is an acknowledgment surface, not a progress monitor.

## The ending matters as much as the start

- **Success:** the control returns to actionable. If the action's meaning has
  changed (saved → save again vs saved → done), the control says so; a brief
  success settle (a check, a tick of confirmation) is worth more than a toast
  for actions whose effect is not otherwise visible.
- **Failure:** the control returns to actionable *and the failure is
  surfaced* — on or near the control, not only in a distant log. A button
  that stops spinning and does nothing else has swallowed the failure; the
  user's only theory is "it worked". See
  [failure-states](failure-states.md) for the honesty rules.
- **No infinite busy.** The operation's lifetime must be bounded — a timeout
  that returns the control to actionable with a failure beats a spinner that
  never stops. An eternally busy control is the action-scale version of the
  eternal ghost: a hang, dressed as diligence.

## Optimistic updates are a different bargain

Applying the result before the operation confirms — optimistic mutation — is
a legitimate variant with its own contract: the change renders immediately,
the control may skip the busy state entirely, and in exchange the
implementation owes a *visible rollback* on failure, restoring the prior
state and saying why. Optimism without rollback is not optimism; it is
writing fiction into the interface. Prefer the busy-state contract for
destructive or costly actions, optimism for cheap reversible toggles.
