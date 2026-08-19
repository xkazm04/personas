---
layer: technique
subject: guided-tours
technique: overlay-precedence
status: forged
laws: []
shared_with: []
---

# Overlay precedence — the tour as a citizen

A running tour is an overlay living in a product full of other overlays:
dialogs that open from user actions the tour itself encouraged, toasts that
arrive on their own schedule, critical alerts that outrank everything. Where
the tour *ranks* is not this subject's decision — the product keeps one
layering authority with named bands, and the tour registers into its band
there
([layering-and-precedence](../../modal-stack/techniques/layering-and-precedence.md),
owned by [modal-stack](../../modal-stack/modal-stack.md)). What this
technique owns is the tour's **conduct**: what it does at each collision the
band scale makes visible.

## Conduct at each collision

- **A modal opens during a tour.** The band scale says who paints on top;
  conduct says the tour must not fight. If the modal is the *expected result*
  of the current step ("open the settings dialog"), the tour either completes
  the step and continues inside, or holds quietly until the dialog closes —
  declared per step, because only the author knows whether the tour follows
  the user in or waits outside. If the modal is *unrelated* — an error, a
  confirmation from background work — the tour pauses: spotlight released,
  dimming yielded, resuming when the interruption resolves. A spotlight
  circling a control underneath an unrelated dialog is nonsense on screen,
  and two dimming layers deep is a product that looks broken.
- **Toasts during a tour.** Announcements may paint per the band scale, but
  they never steal focus from the tour and never advance or pause it.
  Conversely the tour's dimming must not make an actionable notification
  unreachable — if the product queues non-critical toasts under modals, the
  same policy serves under tours.
- **Critical alerts outrank coaching, always.** Whatever the product defines
  as its top band — data-loss warnings, session expiry — preempts the tour
  unconditionally. The tour pauses and offers resume; it never contests the
  alert for attention. Coaching is the most interruptible content in the
  product, because it is the only content the user did not ask to see now or
  cannot get back later.

## The focus policy: guide, don't trap

Modal dialogs trap focus legitimately: the world beneath them is suspended,
so focus cycling inside is honest. A tour is different in kind — its entire
purpose is that the product beneath remains **live**, because the current
step may be asking the user to operate it. So the tour must not run a modal
focus trap while pointing into interactive territory:

- **Focus moves to the step's guidance when a step opens** — so keyboard and
  assistive users know the step exists and can reach its controls — but the
  anchored element and the path to it remain reachable. A tour whose target
  is unreachable by keyboard is coaching only mouse users.
- **The tour never holds focus it cannot release.** Every path out of a step
  — advance, skip, exit, degradation, pause-for-modal — restores focus to
  the product deterministically. The tour that exits leaving focus on a
  removed element has broken keyboard navigation as a parting gift.
- **The dimmed region is inert to pointers but the anchor's cutout is not**
  — the spotlight is a hole in the shield, not a picture of one. If the step
  is explanatory and the product should not be operated, that is a declared
  step property, not an accident of what the shield happened to cover.

## Escape semantics

The escape key is the most contested input in an overlay-rich product, and
the tour's claim on it is the weakest:

- **When the tour is the topmost surface**, escape exits the tour — one
  gesture, complete restoration, per the subject's skippability rule. Not
  "escape advances the step"; users pressing escape are leaving, and
  reinterpreting the leave gesture as anything else is hostility.
- **When anything sits above the tour** — a dialog, an alert — escape
  belongs to that surface, routed by the product's stack discipline (one
  press, topmost layer only). The paused tour does not consume the press on
  its way through.
- **Exit restores everything**: dimming gone, focus returned, scroll
  released, any held anchors released. The tour's teardown must be as
  unconditional as the never-strand invariant — runnable from any state,
  including mid-degradation and mid-navigation.

## What this technique refuses

- The tour minting its own layer number instead of registering with the
  product's layering authority.
- A full focus trap during steps that ask the user to operate the product.
- Contesting an unrelated modal or a critical alert for visual or input
  priority.
- Escape reinterpreted as anything but leave, when the tour is topmost.
- Teardown that assumes a happy path — exit must work from every state the
  tour can occupy.
