---
layer: technique
subject: drag-drop
technique: drag-lifecycle
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Drag lifecycle

A drag is a state machine, and writing it down as one is the difference
between an implementation and a pile of event handlers. The states:

> **idle** → **armed** (press on a draggable) → **dragging** (threshold
> crossed) → **over-target** (a valid target under the pointer) →
> **dropped** or **cancelled** → **idle**

Every transition is named, every state knows its exits, and — the part that
separates shipped-quality from demo-quality — **every path back to idle runs
the same cleanup**. Implementations that handle drop and cancel with separate
ad-hoc teardown code diverge within a quarter: one path clears the highlight,
the other forgets; one stops the auto-scroll, the other leaks it.

## Armed is not dragging

The press that might become a drag must not *be* a drag yet, or every click
on a draggable item becomes a micro-drag: selections fire spuriously, click
handlers race drop handlers, and items twitch under normal clicking. The
**armed** state exists to disambiguate:

- **Distance threshold** — the pointer must travel a few pixels from the
  press point before the drag activates. Below the threshold, release means
  *click* and the click behavior (select, open) fires normally.
- **Time threshold (touch)** — on touch surfaces the same finger means
  scroll, so activation is a long-press, with a visible arming cue (a lift, a
  pulse) so the user knows the mode is about to engage.
- **Handles narrow the arming surface.** When the item itself is interactive
  (it contains buttons, links, editable text), arm only from a dedicated
  handle. A wholly-draggable interactive card is a fight between two gesture
  vocabularies on the same pixels, and the user loses it.

Arming that never activates must resolve cleanly: release below threshold is
a click, movement that begins as a scroll stays a scroll. The click-vs-drag
decision is made *once*, at threshold, not re-litigated per handler.

## Enumerate the cancel paths — all of them

Commit is one exit. Cancel is many, and each one is a real event that will
happen to real users:

- **Explicit cancel** — the escape key mid-drag. Non-negotiable; it is the
  user's emergency exit and its absence turns a mis-grab into a forced drop.
- **Drop on nothing** — release outside every valid target. This is a cancel,
  not an error: the item returns to origin, visibly, and no operation fires.
- **Focus and visibility loss** — the window blurs, a dialog interrupts, the
  surface unmounts mid-drag. The mode cannot survive losing its host;
  teardown runs as if cancelled.
- **The system takes the gesture away** — pointer capture is revoked, a
  system gesture intercepts, the input stream cancels. This is a cancel,
  and only a cancel: committing the last-known position when the gesture
  was *taken* rather than *released* is inventing an intent the user never
  expressed. Measured implementations get this wrong in exactly one
  direction — routing the cancellation event into the commit path.
- **The world moved** — the dragged entity is deleted or the target list is
  replaced by another actor while the drag is in flight. The drag holds an
  identity (see [payload-and-identity](payload-and-identity.md)); when that
  identity stops resolving, the only honest exit is cancel-with-explanation,
  never a drop onto a ghost.

A useful audit: list every way the mode can end, and for each, name which
exit door it maps to. Any ending that maps to neither commit nor cancel is a
bug already written, waiting for its user.

## Cleanup is a named reaper, not a scatter

A live drag owns resources: global listeners captured for the duration,
a drag preview element, target highlight state, an auto-scroll timer, a
scroll-position lock, a body-level cursor override. Per the law that
everything created names its reaper, the drag machinery has **one teardown
routine**, written next to the setup, invoked on *every* exit — commit,
every cancel variant, and unmount. The symptom of scattered cleanup is
always the same set of hauntings: a lane that stays highlighted, a page that
keeps auto-scrolling, a cursor stuck as a grab-hand, a phantom preview
floating after the pointer is gone.

One trap deserves naming because it defeats even disciplined teardown:
**do not hang cleanup solely on the dragged element's own end-of-drag
event.** A *successful* drop often removes or re-parents the source element
— the item moved, so its origin unmounts — and on common platforms the end
event then never fires on it. Teardown keyed only to that event runs on
cancel but not on success, which is why "the moved item stays ghosted"
is such a widespread defect. The drop handler and the end-event handler
both route into the one reaper, which is idempotent precisely so both may
call it.

Auto-scroll deserves specific mention because it is the most-leaked resource
in the category: it is started implicitly (pointer nears an edge), it has no
visual object of its own, and a leaked one keeps moving the page after the
mode ended — the single most disorienting residue a drag can leave.

## One drag at a time

The mode is a singleton. A second press while a drag is live (a second
pointer, a stray touch, a synthetic event) must be inert or must cancel the
first — never spawn a second concurrent drag. Concurrent drags double every
resource above and produce drop races no reconciliation logic anticipates.
Enforce it structurally: the drag state lives in one place, and entering
**armed** is refused while the machine is not idle.

## The mode announces itself

Entering and leaving the mode is information the rest of the surface needs:
scrolling may need locking or redirecting to edge auto-scroll, hover states
elsewhere should suspend (the pointer is busy), and text selection must be
disabled for the duration — the classic residue of skipping this is a page
full of accidentally-selected text after every drag. These suspensions are
resources too; they belong to the same reaper.
