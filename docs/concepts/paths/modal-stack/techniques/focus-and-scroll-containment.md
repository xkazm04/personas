---
layer: technique
subject: modal-stack
technique: focus-and-scroll-containment
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Focus and scroll containment

A modal overlay's claim — *the page beneath is suspended* — must hold in
every input channel at once: pointer, keyboard, scroll wheel, and assistive
navigation. Visual dimming asserts the claim; containment is what makes it
true. Every piece of containment set up on open names its teardown on close —
this is the technique where forgotten reapers hurt most, because the damage
(a page that no longer scrolls, focus lost to the void) outlives the overlay
that caused it.

## Focus: enter, cycle, return

**Enter.** On open, keyboard focus moves into the overlay — to the most
useful starting point, in this order of preference: the primary input if the
overlay exists to collect one; otherwise the least-dangerous prominent
control; otherwise the overlay container itself (focusable for this purpose,
with its accessible name announcing what just opened). Never auto-focus the
destructive action: pre-arming "Delete" means the enter key the user was
still holding from the previous screen fires it.

**Cycle.** While the overlay is up, tab and shift-tab cycle within it —
wrapping at the ends, never escaping into the dimmed page. A dimmed page that
still receives focus is worse than undimmed: sighted keyboard users watch
their focus vanish into surfaces they were told are inactive.

**Return.** On close, focus returns to the element that invoked the overlay.
The invoker is captured **at open** — not looked up at close, when the
answer would be "some control inside the overlay that is about to unmount",
which resolves to nothing and dumps focus at the document root, the silent
reset that strands keyboard and screen-reader users back at the top of the
page. If the invoker itself is gone by close time (the row was deleted, the
list refreshed), fall back to the nearest surviving landmark — the list, the
section — never to the void.

Restore has **two exit branches, and both must be wired**: the overlay can
close while its component stays alive (a flag flips), or it can close by
being torn down entirely (its owner disappears while it is open). A restore
hooked only to the flag-flip silently skips the teardown branch — and
whichever branch a given call site uses is invisible at the restore's own
code, so the gap survives review and ships broadly. The complication that
makes this a design decision rather than a one-liner: exit *choreography*.
When close plays a leaving animation, a restore bound naively to teardown
fires mid-animation, moving focus while the panel is still painted. Decide
explicitly: input authority (and therefore focus) transfers at the *close
event*, and the lingering visuals are already inert — then make both
branches deliver exactly one restore, never zero, never two.

## Scroll: lock beneath, contain within

While a modal overlay is up, the page beneath does not scroll:

- **Lock, and compensate.** Suppressing the page's scrollbar changes the
  viewport width; uncompensated, the whole page shifts sideways on every
  open and back on every close — the twitch users can't name but always
  notice. Reserve the vanished scrollbar's width for the lock's duration.
- **Preserve position.** Lock techniques that move or re-anchor the page
  must restore the exact scroll offset on release; an overlay that teleports
  the page to the top on close costs the user their place.
- **Contain internal scroll.** Long overlay content scrolls *inside* the
  overlay; reaching the end of that inner scroll must not chain into the
  page. And the overlay's chrome behaves like any surface's chrome: title
  and actions stay reachable while the middle scrolls — a confirm action
  that lives three screens down an inner scroll is a hidden exit.
- **The strongest lock is not needing one.** An application shell whose
  *page* never scrolls at all — every scrollable region is an inner pane —
  dissolves the entire lock/compensate/restore problem structurally: there
  is nothing to lock. Where that shell is the design, say so explicitly, so
  the absence of a lock reads as a decision rather than an omission — and
  re-derive the lock the day the shell changes, or the day this standard is
  carried to a product whose page does scroll.

## Inertness: the other channels

Pointer blocking by a backdrop handles the mouse. Two channels remain:

- **Assistive traversal.** Screen-reader virtual navigation does not follow
  focus traps; unless the background is explicitly marked inert to assistive
  technology, an assistive user can wander the dimmed page, interacting with
  surfaces that sighted users are told are suspended. The background must be
  marked inert as a whole (with the overlay layer excluded), and restored on
  close.
- **Find-and-navigate features.** In-page find, focus-by-shortcut, spatial
  navigation — anything that can land focus in the background needs the same
  inert marking to be redirected. A trap that only intercepts the tab key is
  a fence with one plank.

## Containment is stack-aware

Exactly **one** overlay traps at a time: the topmost *modal* entry.

- When a second modal pushes on top, the first releases its trap (but keeps
  its state and its captured invoker); the new top establishes its own. On
  pop, containment devolves to the new top in reverse order — each layer
  restoring what it captured, LIFO, like the unwinding it is.
- Non-modal entries above a modal (a popover opened from inside a dialog)
  scope focus more loosely: focus may cycle through the popover and its
  parent dialog as one region, because the popover suspends nothing.
- The scroll lock is *reference-counted, not toggled*. Two stacked modals
  each "lock" the page; the first close must not unlock it while the second
  still stands. The naive boolean lock produces exactly that — the classic
  scrolling-background-behind-a-modal bug — and its mirror image, the page
  that stays locked forever because one closer forgot. Acquire on push,
  release on pop, count the holders.

## Restore is the acceptance test

Every containment act pairs with its restoration, and the pair is testable:
open an overlay from a focused control mid-page, interact, close — the page
scrolls again from the same offset, focus sits on the invoking control, and
assistive traversal sees the full page. Run the same test with two stacked
overlays closed in both orders. Products fail the *second* half of this test
far more often than the first; setup without named teardown is the default
bug, not the exotic one.
