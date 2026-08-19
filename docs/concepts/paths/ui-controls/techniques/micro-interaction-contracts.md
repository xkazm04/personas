---
layer: technique
subject: ui-controls
technique: micro-interaction-contracts
status: forged
laws:
  - identity-survives-reuse
shared_with: []
---

# Micro-interaction contracts

The small controls look trivial and are not: each one carries a state
machine, a timing window, and a semantic promise, and every hand-rolled copy
drops at least one of the three. This technique writes the contracts down —
per control, precisely enough to test — so the primitive can implement each
one *once* and every adopter inherits it. Timing constants come from the
motion side of the token vocabulary, not from magic numbers per call site.

## The copy affordance

Copying is an async write to a shared system resource that can fail, and a
press with no visible consequence. The contract:

1. **Feedback window.** On success the control transforms — icon swap,
   label swap, or check state — for a bounded window (on the order of one to
   two seconds), then reverts on its own. The window is the receipt; the
   revert is what makes the control obviously reusable. And the receipt
   follows the **verified write, not the attempt**: a copy of an empty
   payload, or a write the platform rejected, gets no success flash —
   claiming success for a no-op is theater, and users calibrate on it.
2. **Re-press during the window is idempotent** — it re-copies and restarts
   the window; it never stacks timers into a flicker.
3. **Failure is not silence.** Clipboard access can be denied; a failed copy
   shows a distinct failure state or routes to the error surface — never
   the success check, never nothing.
4. **The confirmation is announced.** The visual swap is invisible to a
   screen reader; the state change is mirrored to an assistive announcement
   (the live-region machinery is the accessibility subject's; the
   *obligation* is this contract's).
5. **One implementation.** The temptation signature is a raw clipboard call
   in feature code; each one re-answers the four points above, usually
   answering none.

## The tooltip

A tooltip is a hover/focus-revealed, **non-interactive** description of its
trigger. The contract:

- **Open delay, no close race.** Opening waits a beat (roughly half a
  second) so pointer traffic across the screen does not strobe tooltips;
  once one is open, moving to an adjacent trigger opens the next one
  without the delay (warm mode). Closing tolerates the pointer crossing the
  gap between trigger and tip.
- **Focus opens it too.** Keyboard focus shows the tooltip; it dismisses on
  the escape key without moving focus.
- **It is never the only carrier of essential information.** A tooltip
  supplements a visible affordance; content a user *must* see cannot live
  behind hover.
- **It contains no interactive content.** The moment a tip needs a button
  or a link it is a popover — a different control with focus management and
  an explicit dismiss, owned by the layered-surface subject
  ([modal-stack](../../modal-stack/modal-stack.md), whose
  anchored-positioning technique also owns the flip-and-clamp geometry a
  tooltip borrows).
- **The native title attribute is not a tooltip** — undelayed, unstyled,
  untouchable by keyboard, invisible to touch. Its presence in feature code
  is a temptation signature, same as the raw clipboard call.

## The toggle

The toggle's contract is **semantic before it is visual**:

- A **switch** applies its effect *immediately* — flip it, the system
  changes now, no submit step. Its two labels are states, not options.
- A **checkbox** is a deferred assertion, collected and committed by a
  surrounding form.

Styling a checkbox to look like a switch inside a form promises immediacy
and delivers a pending draft; wiring a switch that only takes effect on
save promises a draft and delivers surprise. The primitive should make the
choice explicit — a switch control and a checkbox control, not one control
with a `looksLikeSwitch` flag — and the switch's accessible role, state
wiring, and keyboard activation are minted inside it. If flipping the
switch triggers async work, the busy contract applies (the shared
action-busy-states technique): disable during flight and settle to the
*actual* resulting state, never optimistically hold a state the backend
then contradicts silently.

## The stepper

A numeric stepper is a bounded counter with two entry modes, and the
contract is mostly about their reconciliation:

- **Bounds are enforced at every door**: the increment/decrement buttons
  clamp and disable at the limits; typed input is reconciled — parsed,
  clamped, or rejected with feedback — at commit time (blur or submit),
  not on every keystroke while the user is mid-edit.
- **Two event tiers, declared.** The control emits a *live draft* event on
  every keystroke and step, and a *settled commit* event once per
  interaction (blur, confirm key, button release) that fires only when the
  value actually changed. Expensive consequences — persistence, network,
  recomputation — bind to the commit tier; wiring them to the draft tier
  turns holding the increment button into a request storm. A stepper that
  offers only one event forces every consumer to reinvent the debounce.
- **Step affordances repeat on hold**, with acceleration if ranges are
  large; each emitted value still respects the bounds.
- **The empty field is a state, not a zero.** While the user has cleared
  the field to retype, the control holds an indeterminate draft; coercing
  it to a bound mid-edit fights the user's keyboard.

## The tab strip

A tab strip is a single-selection control over sibling panels:

- **Selection model is explicit.** Either selection follows focus
  (automatic activation — right for cheap, local panels) or focus and
  selection are separate and activation is a deliberate keypress (manual
  activation — right when switching panels is expensive or destructive).
  Pick per strip, on purpose.
- **One tab stop, arrows within.** The strip occupies one position in the
  tab order; arrow keys move between tabs (the roving-focus model owned by
  the accessibility subject).
- **Tabs are keyed by identity, not index.** Panels get inserted, removed,
  and reordered; a selection stored as "tab 2" silently switches the
  user's context when the set changes
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
- **Tab ↔ panel wiring is real.** The relationship the roles promise
  (which panel this tab controls) is wired, not implied by adjacency — a
  strip that announces itself as tabs while pointing at nothing is worse
  than a list of buttons.

## The disabled control explains itself

An upward lesson from practice, absent from most component libraries: a
disabled action with no stated reason makes the user hunt for the blocker.
The contract — when a control is disabled for a reason the user can act on,
the control carries that reason, surfaced on hover *and* keyboard focus.
The mechanical subtlety is why this belongs to the primitive: a natively
disabled control is inert — it receives no pointer events and cannot take
focus — so the reason needs a **focusable carrier around the control**
(a wrapper that takes the tab stop, announces the disabled state, and hosts
the explanation tooltip) while the control itself lets hover fall through.
No call site gets that right ad hoc; a `disabledReason` seam on the button
primitive gets it right everywhere at once. The form subject's related
prohibition (never use a disabled submit as the error surface) still
stands — this contract is for the cases where disabled is *correct*, and
turns the remaining mystery-grey buttons into explained ones.

## Why these live in one technique

Individually each contract fits on a card; collectively they are the
argument for the library. Nobody hand-rolling a copy button *decides* to
skip the failure state and the announcement — they never enumerate the
contract at all. The primitive is where the enumeration happened once,
which is exactly what makes the shadow copy a downgrade even when it looks
identical in a demo.
