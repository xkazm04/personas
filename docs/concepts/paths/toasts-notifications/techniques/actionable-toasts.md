---
layer: technique
subject: toasts-notifications
technique: actionable-toasts
status: forged
laws: []
shared_with: []
---

# Actionable toasts

A toast interrupts the user to deliver news; if the news implies a next
step, the toast is the single best moment to offer it — context is at its
peak and the remedy is one gesture away. A toast that names a problem and
offers no path to it ("connection failed", dismiss) converts that moment
into homework: the user must remember the message, find the relevant
surface, and reconstruct what to do there. The technique is making the
toast **a door to the fix, not a dead end**.

## One action, and it lands at the remedy

- **At most one primary action.** A toast is a doorway, not a workspace;
  two buttons plus dismiss is a dialog wearing a toast's clothes. If the
  situation genuinely needs choices, the action opens the surface where
  the choice belongs.
- **The action lands the user at the fix, not near it.** "Open settings"
  when the remedy is one specific credential is a scavenger hunt with a
  head start. The action deep-links: the failing item opened, the relevant
  section focused, the offending field highlighted. Every hop between the
  toast and the remedy sheds users.
- **The action names its verb.** "Retry", "Reconnect", "Review", "Undo" —
  never "OK" (which asserts consent to nothing) and never "Details"
  when the honest label is "Fix".
- **Dismiss stays separate.** The dismissal affordance and the action
  affordance are visually and semantically distinct targets; a toast where
  the whole body is the action *and* swipe-to-dismiss lives on the same
  surface will misfire in both directions.

## Actionability changes lifetime

The golden path's rule — a message requiring action must not evaporate —
lands concretely here:

- **Awareness + optional shortcut** (success with "View"): normal dwell.
  The action is a convenience; missing it costs nothing.
- **Obligation** (re-authenticate, review a failure, approve a request):
  no auto-dismissal. The toast persists until acted on or explicitly
  dismissed — and explicit dismissal is *deferral, not resolution*: the
  obligation stays live in the durable ledger, unread, still claiming
  attention. The user may clear their screen; they may not accidentally
  clear their duties.

## Races the design must survive

An actionable toast has three clocks running — dwell, the user's reach for
the button, and the world changing underneath — and the races between them
are the technique's hard part:

- **Action vs expiry.** The dwell timer and the user's cursor race; the
  toast must not vanish under a pointer en route. Attention pausing the
  clock (see [queue-discipline](queue-discipline.md)) covers hover; for
  keyboard and assistive-technology users, focus anywhere within the toast
  pauses it equally.
- **Action vs staleness.** By the time the user clicks "Retry", the
  operation may have already succeeded via background recovery, or the
  entity may be gone. Toast actions are **idempotent or verified**: the
  handler re-checks the condition before re-acting, and a stale action
  degrades to a no-op with a quiet acknowledgment — never a second failure
  toast for acting on old news.
- **Action vs navigation.** The user may have navigated since the toast
  appeared; the action must carry its own full addressing (which entity,
  which surface) rather than assuming the originating context is still
  mounted. An action that throws because its parent surface unmounted is a
  toast holding a dangling pointer.

## The undo window

The highest-value actionable toast inverts a confirmation dialog:
**act immediately, offer recovery** — delete now, show "Deleted — Undo"
for a generous window. It removes friction from the common case (the user
meant it) while keeping the rare case (they did not) recoverable.

Its contract is strict, because the dwell time *is* the promise:

- The window is generous (seconds, not moments), pauses on attention, and
  the action is keyboard-reachable for its whole life.
- **Undo restores, fully.** If restoration cannot be guaranteed —
  cascading effects already propagated, remote systems already told — the
  operation was not undoable, and pretending otherwise with a best-effort
  undo is worse than a confirmation dialog. Choose the pattern by the
  operation's true reversibility, not by fashion.
- The destructive operation may be *deferred* behind the window (committed
  only on expiry) or *committed-then-compensated*; deferral is simpler and
  safer where the domain allows it, but then expiry — including expiry by
  application shutdown — must reliably commit, or "deleted" items resurrect.
- Undo-availability ends *visibly* (the toast leaves); a hidden grace
  period that sometimes honors a late undo is a slot machine.

## Every action is also a ledger action

When an actionable toast has a durable twin (it always does, per the
actionability rule), the action affordance appears on the ledger entry too,
and acting in either place resolves both — same identity, same handler,
same idempotence. The toast is the fast path to the action, never the only
path; otherwise missing the toast silently downgrades the user from "one
click to fix" to "find it yourself", which is exactly the gap the ledger
exists to close.
