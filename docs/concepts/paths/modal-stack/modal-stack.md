---
layer: golden-path
subject: modal-stack
status: forged
techniques:
  - stack-ownership
  - dismissal-semantics
  - focus-and-scroll-containment
  - anchored-positioning
  - layering-and-precedence
  - destructive-confirmation
evidence:
  - src/lib/ui/ModalStackContext.tsx                                  # the app-wide overlay stack registry: minted ids, depth/total/isTopmost, subscriber notification
  - src/lib/ui/BaseModal.tsx                                          # the one modal host: dialog semantics, topmost-only escape, focus capture/cycle/restore, depth-derived layer
  - src/features/shared/components/overlays/ConfirmDestructiveModal.tsx  # friction proportional to blast radius: type-to-confirm, detail rows, blast-radius slot
counter_evidence:
  - src/features/templates/sub_generated/adoption/chronology/TestReportModal.tsx  # hand-rolled overlay outside the stack, z-bumped past the host's portal base to win a paint fight
deviations:
  - w1-modal-stack   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Modal & overlay stack

An overlay is any surface that renders **above** the page and claims some share
of the user's attention and input. The family is wide — dialogs, sheets and
drawers, popovers and menus, tooltips, toasts, guided-tour highlights,
full-screen takeovers — but it organizes cleanly along two axes:

- **Input claim.** A *modal* overlay suspends everything beneath it: the page
  is still visible but no longer interactive, and the user must resolve the
  overlay to continue. A *non-modal* overlay floats above the page while the
  page keeps working — a tooltip, a toast, an inspector panel.
- **Anchoring.** A *centered* overlay addresses the whole task (a dialog, a
  takeover); an *anchored* overlay addresses one control (a popover, a menu, a
  tooltip) and is positioned relative to it.

Those two axes decide almost everything else — dismissal policy, focus
behavior, layer precedence — which is why the standard treats the overlay
family as one subject with one owned structure, not as a bag of unrelated
widgets.

## When a modal is the right tool at all

Modality is the most expensive gesture in an interface: it discards the user's
visual context, interrupts their locomotion, and asserts that *nothing you were
doing matters more than this*. That assertion is sometimes true. A modal is
justified when:

- **The user cannot meaningfully continue without answering** — a required
  decision blocks the path (choose a target, resolve a conflict, authenticate).
- **The action is destructive or irreversible** and deserves a deliberate,
  isolated confirmation (its own technique below).
- **The sub-task needs protected space** — a short, focused form whose inline
  rendering would corrupt or clutter the context it came from, and whose
  half-finished state should not be left lying around in the page.

Everything else has a better home:

- **Inline expansion** when the content is detail about something already on
  screen — accordion rows, expanding panels. The user keeps their place.
- **A dedicated page or route** when the task is long, multi-step, or worth
  linking to. A modal that grows tabs, its own navigation, or a scrollbar for
  a full workflow is a page trapped in a box — give it an address and a back
  button.
- **A popover** when the user is making a lightweight choice scoped to one
  control — pick a value, confirm a small action, filter a list. Light to
  open, light to dismiss.
- **A non-modal panel** for reference material the user consults *while*
  working — help, documentation, a property inspector. Blocking the work to
  show help about the work is self-defeating.
- **A toast** for information that requires no decision. If the only button is
  "OK", it is not a dialog; it is an announcement wearing a dialog's cost.

The failure modes run in both directions. Overuse turns the product into a
corridor of interruptions where users click through confirmations blind —
training them to dismiss is training them to dismiss the one that matters.
Underuse leaks destructive actions into single misclicks and scatters
half-finished sub-tasks through the page.

## The stack is one owned structure

At any moment the open overlays form an ordered stack: a dialog, above it a
popover opened from inside the dialog, above that a confirmation guarding the
dialog's close. That stack **exists whether or not the code models it** — the
only choice is whether it is owned in one place or reconstructed by accident
from scattered state.

The scattered form is the classic defect: each surface keeps its own
`is-open` boolean, each invents its own dismissal wiring, and nobody can
answer *what is on top right now*. The symptoms are recognizable anywhere —
one escape press closes three layers at once; an outside click on a nested
popover also kills the dialog under it; two dialogs fight over focus; a
confirmation appears *behind* the surface it is confirming. Every one of those
is the same root cause: ordering exists in the pixels but not in the state.

The standard is a single owned stack — typed entries, pushed and popped
through one door, rendered as a fold over the structure, with the topmost
entry alone owning input. Everything downstream (escape routing, outside-click
scoping, focus containment, layering) becomes a query against this one
structure instead of a negotiation between strangers. The full contract is the
[stack-ownership](techniques/stack-ownership.md) technique.

## Dismissal is a contract, not a reflex

Every overlay declares how it may be closed — escape, outside click, explicit
control, programmatic completion — and the policy follows from the overlay's
kind and the user's investment in it:

- **Light surfaces dismiss lightly.** A menu or popover holding no user input
  closes on escape, outside click, or scroll-away without ceremony. Making a
  menu hard to close is hostile.
- **Invested surfaces dismiss deliberately.** A dialog holding typed input
  does not evaporate on a stray click; discarding work requires either an
  explicit close or a guard that asks.
- **Dismissal targets the top of the stack, only.** One escape press closes
  one layer. An outside click is judged against the *topmost* overlay's
  territory, and territory includes the overlay's own anchor and children.

Cancel, dismiss, and complete are three different exits with three different
meanings, and callers awaiting a result must be able to tell them apart. The
[dismissal-semantics](techniques/dismissal-semantics.md) technique holds the
full contract, including the unsaved-changes guard.

## Containment: the world beneath is suspended honestly

A modal overlay claims the input; the implementation must make that claim true
in every channel, not just visually:

- **Focus is contained.** Keyboard focus enters the overlay on open, cycles
  within it, and returns to the invoking control on close. A dimmed page that
  still receives tab focus is a lie told to keyboard users.
- **Scroll is contained.** The page beneath does not scroll while a modal is
  up; scrolling inside the overlay stays inside it.
- **The background is inert** to pointers *and* to assistive technology. A
  screen-reader user who can still wander the dimmed page is not experiencing
  the modality that sighted users are.

Containment is stack-aware: exactly one overlay — the topmost modal — traps at
a time, and each layer's containment releases in reverse order as the stack
unwinds. The mechanics are the
[focus-and-scroll-containment](techniques/focus-and-scroll-containment.md)
technique.

## Layer order is a policy, not a lottery

When surfaces overlap, which wins is a product decision: content, then sticky
chrome, then anchored popovers, then modal dialogs, then notifications, then
guided tours, then critical alerts — one scale, defined once, consumed
everywhere. The moment two components each pick their own large number, the
product enters a bidding war that only ever escalates, and the bugs appear at
the *interactions*: the toast under the dialog scrim, the tour highlight
fighting the confirmation, the dropdown clipped by its own container. Within a
band, order is the stack's order. The scale and the precedence rules live in
the [layering-and-precedence](techniques/layering-and-precedence.md)
technique.

## Anchored overlays are derived surfaces

A popover's position is not state; it is a **derivation** from its anchor's
geometry, a placement preference, and the viewport's edges — recomputed when
any input moves, with declared collision behavior (flip, shift, or resize) and
a declared answer for what happens when the anchor scrolls away. Anchored
overlays also escape clipped containers by rendering at a layer root, which is
precisely what makes the owned layer scale necessary. The geometry contract is
the [anchored-positioning](techniques/anchored-positioning.md) technique.

## Accessibility posture

Overlays are where accessibility debts concentrate, because every channel —
focus, reading order, announcements — must be redirected at once:

- A modal overlay carries dialog semantics and an accessible name; its opening
  is announced, and assistive reading is scoped to it while it is up.
- The dismiss affordances are real controls — reachable, labelled, operable by
  keyboard — not decorative glyphs with click handlers.
- Anchored overlays declare their relationship to the anchor (expanded state
  on the trigger, ownership of the popup), so the connection audible users
  cannot see is stated where they can hear it.
- Reduced-motion preferences apply to overlay enter/exit choreography the same
  as anywhere else: the states still change; the theater settles instantly.

## The techniques

- [stack-ownership](techniques/stack-ownership.md) — the stack as one typed
  structure: push/pop through a single door, top-of-stack input ownership,
  sub-modals, lifecycle and the navigation reaper.
- [dismissal-semantics](techniques/dismissal-semantics.md) — escape, outside
  click, explicit close, programmatic completion; cancel vs dismiss vs
  complete; the unsaved-changes guard as a stack citizen.
- [focus-and-scroll-containment](techniques/focus-and-scroll-containment.md) —
  trap, initial focus, focus return, scroll lock and layout compensation,
  background inertness, stack-aware release.
- [anchored-positioning](techniques/anchored-positioning.md) — position as a
  derivation: placement preference, collision handling, tether-or-dismiss on
  scroll, escaping clipped containers.
- [layering-and-precedence](techniques/layering-and-precedence.md) — one owned
  layer scale, semantic bands, precedence between overlay families, the
  stacking-context trap.
- [destructive-confirmation](techniques/destructive-confirmation.md) — when to
  confirm vs undo, naming the object and consequence, verb-labelled actions,
  friction proportional to blast radius.
