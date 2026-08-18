---
layer: technique
subject: modal-stack
technique: destructive-confirmation
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Destructive confirmation

A confirmation dialog spends the user's attention to buy protection against
irreversible loss. Both sides of that trade are real: under-confirmation
leaks destruction into single misclicks, and over-confirmation trains users
to click through — which silently disarms the one confirmation that matters.
The technique is knowing when the trade is worth it, and making the dialog
actually do its job when it is.

## Confirm, undo, or neither

The decision is a function of **reversibility** and **blast radius**:

- **Reversible** actions get **undo, not confirmation**. Archiving,
  removing an item from a view, muting — perform immediately, announce with
  an undo affordance. Undo is strictly better where it is possible: it costs
  attention only in the rare case the user erred, instead of on every
  execution. A confirmation on a reversible action is friction purchased
  for nothing.
- **Irreversible with small blast radius** — deleting one draft, discarding
  one form's edits — gets a **lightweight confirmation**: a small dialog or
  inline/anchored confirm, one line, two actions.
- **Irreversible with large blast radius** — deleting a project and its
  history, revoking credentials in use, actions affecting other people —
  gets **heavyweight confirmation** with friction proportional to the loss
  (below).
- **Routine and expected** consequences of an explicit gesture (closing a
  tab with no unsaved work, stopping a process the user just started) get
  **neither**. Confirming what the user obviously intends is how
  confirmation blindness is manufactured.

The count of confirmations a user sees per day is a budget. Every cheap one
spent is armor removed from the expensive one.

## The dialog names the object and the consequence

A confirmation that says "Are you sure?" verifies only that the user can
click twice. The dialog must state, specifically:

- **What** will be affected — the object by name ("Delete *Q3 launch
  plan*?"), never by pronoun ("this item"). Bulk actions state the count
  *with its predicate*: "Delete 12 archived drafts?" — the number, what it
  counts, and (when filters are in play) the scope it was counted over. "12
  selected" and "12 matching the filter" are different sets, and destroying
  the wrong one is the exact catastrophe this dialog exists to prevent.
- **What happens** — the consequence in concrete terms ("removes the
  project, its 34 runs, and its share links"), including whether it is
  permanent. If the system genuinely cannot recover it, say so; if there is
  a grace window, say that instead — the truthful version changes what the
  user checks before confirming.
- **The verbs, on the actions.** The confirming action is labelled with the
  verb — "Delete project", "Revoke key" — never "OK" or "Yes". Verb labels
  are self-checking: a user who reads only the button still learns what it
  does. The safe action is likewise concrete ("Keep project"), and *cancel
  must genuinely cancel* — no side effects on the decline path.

## Structure inside the stack

A confirmation is an ordinary overlay entry and obeys every subject rule,
plus postures of its own:

- **The safe action is the default.** Initial focus and the enter key belong
  to the non-destructive choice; the destructive action is deliberately *not*
  pre-armed (the containment technique's never-auto-focus-the-destructive
  rule exists for this dialog). The destructive action is visually distinct
  in the design language's danger treatment — one such treatment,
  everywhere, so the red action reads as red-action reflexively.
- **Light dismissal means "keep".** Escape and outside click resolve as the
  safe choice. A dismissal that destroys is indefensible.
- **One confirmation, once.** A confirm on top of a confirm means the first
  one was mis-scoped. Equally, confirming *again* after the user answered a
  guard (discard changes → "really discard?") is the stack punishing the
  user for its own architecture.
- **Confirm-then-fail is worse than fail.** The dialog's confirm action
  performs the operation through the ordinary busy-state discipline (the
  pressed control shows it is working, double-press is disarmed) and reports
  failure honestly inside the same surface — not a dialog that closes
  optimistically while the deletion quietly dies behind it.

## Friction proportional to blast radius

For the largest losses, a two-action dialog is not enough — users answer
dialogs faster than they read them. Escalations, in order:

- **Typed confirmation**: the user types the object's name (or a fixed
  phrase) to arm the destructive action. This converts recognition into
  recall — it cannot be done blind — and naming the object one more time is
  itself a scope check. Reserve it for the genuinely catastrophic; a typed
  confirm on routine deletions is the blindness machine again.
- **Explicit scope acknowledgment**: for actions affecting other people or
  live systems, a checkbox restating the consequence ("I understand 4
  teammates lose access") that must be checked before the verb enables.
- **Delay or hold**: a short enforced pause (a hold-to-confirm, a countdown
  on the destructive button) where typing is unavailable. Weaker than typed
  confirmation, better than nothing.

Never stack all of them by reflex; pick the one whose cost matches the loss.

## What this technique refuses

- "Are you sure?" with "Yes/No" — no object, no consequence, no verb.
- Confirmation as a substitute for undo where undo is achievable.
- Destructive defaults: focus, enter, or visual prominence pre-arming the
  losing move.
- A bulk count without its predicate and scope.
- Dialogs that confirm the action and then perform it somewhere the user
  cannot see fail.
