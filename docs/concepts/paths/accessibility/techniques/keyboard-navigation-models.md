---
layer: technique
subject: accessibility
technique: keyboard-navigation-models
status: forged
laws: [identity-survives-reuse, deletion-is-not-repair]
shared_with: []
---

# Keyboard navigation models

Keyboard operation fails at scale not from missing handlers but from a
missing *model*: every widget improvising its own focus behavior until
the tab order is a random walk and no user can predict what the next
keystroke does. The model that works is old, standardized, and worth
stating as doctrine because products keep rediscovering fragments of it.

## Tab between widgets; arrows within them

The foundational split:

- **Tab and Shift+Tab move between widgets** — the coarse hop from
  control to control. A screen with 200 interactive elements and 200 tab
  stops is unusable by keyboard exactly as a screen with no stops is: the
  cost of reaching anything grows linearly with everything.
- **Arrow keys move within a composite widget** — a toolbar, tab strip,
  listbox, grid, tree, or menu is *one* tab stop from the outside; once
  focus enters, arrows traverse its members, Home/End jump to its edges,
  and Tab exits to the *next widget*, not the next member.

Everything else in this technique is machinery for honoring that split.

## Roving focus inside composites

The standard implementation of "one stop outside, arrows inside" is the
**roving tabindex**: exactly one member of the composite is
tab-reachable at any time (tabindex 0), all others are focusable only
programmatically (tabindex −1), and arrow keys move both the focus and
the "reachable" designation together. Re-entering the composite later
lands on the member the user left, not the first one — position is state
the widget remembers.

Two disciplines keep roving focus correct:

- **The active position is keyed by member identity, never index**
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
  Composites are lists, and lists resort, filter, insert, and refresh; an
  index-keyed position silently teleports focus to a different item after
  any of those, which for a non-visual user is being moved without being
  told. When the remembered member disappears, fall to its nearest
  surviving neighbor — never to "whatever now occupies slot 3".
- **The pattern ships as one shared mechanism**, consumed by every
  composite, not re-derived per widget — this is the primitive-level
  rule ([primitive-level-a11y](primitive-level-a11y.md)) applied to a
  behavior instead of a component. Hand-rolled arrow-key handlers are
  where wrap-around, Home/End, and orientation handling silently
  diverge.

The alternative pattern — a container that keeps focus and points at a
virtual active descendant — trades focus movement for attribute updates;
it suits widgets whose members are virtualized or too numerous to focus.
Either is fine; a half of each is not.

## Focus order is document order

Tab order follows the order elements appear in the document, and the
robust rule is to **make that the visual reading order** rather than
overriding it: positive tab-index values create a parallel ordering that
every future edit silently breaks, and layout systems that visually
reorder content without reordering the document produce a tab sequence
that jumps diagonally across the screen. When a design demands a visual
order that diverges from document order, fix the document, not the
tab-index — and when content appears dynamically (a revealed panel, an
inserted row), it appears in the position of the sequence where it will
be encountered, not appended at the end.

Focus must also always be *somewhere visible*: when the focused element
is removed — a deleted row, a closed panel — focus moves deliberately to
the nearest meaningful survivor (next row, list container, heading), not
dropped to the document body, which strands keyboard users at the top of
the page. Every surface that destroys focusable content owns that
handoff.

## Shortcuts are accelerators, never the only path

Keyboard shortcuts serve power users; they do not discharge the
equivalence obligation, because shortcuts are invisible and equivalence
requires a *discoverable* path (visible, focusable controls reachable by
tab). Discipline for the shortcut layer itself:

- **Discoverable somewhere structural** — a shortcut reference surface
  (a palette, a help overlay, tooltips on the controls they accelerate),
  not tribal knowledge.
- **Never steal typing** — single-character shortcuts are suppressed
  while focus is in any text-entry context; a shortcut that fires
  mid-sentence is a false affordance in reverse (an operation the user
  did not ask for).
- **Respect platform grammar** — modifier conventions and reserved
  system combinations belong to the operating system and assistive
  technology first; colliding with a screen reader's own key map makes
  the feature unreachable for exactly the users who most need keys.

## Escape hatches

Keyboard traversal is linear, so the model owes users exits and
express lanes:

- **A skip link** — the first tab stop of the shell jumps past chrome to
  the main content, because "press Tab thirty times to reach the page"
  is the linear-traversal tax made policy. Structural landmarks (main,
  navigation regions) provide the same express lanes to screen-reader
  navigation.
- **Escape backs out** — of the composite, the overlay, the mode, in
  LIFO order; the dismissal semantics and the one legitimate focus trap
  (the overlay stack) are owned by
  [focus-and-scroll-containment](../../modal-stack/techniques/focus-and-scroll-containment.md).
  Outside that deliberate containment, focus is never trapped: any
  widget focus can enter, Tab can leave.

## The false-affordance ban and the visibility floor

Two absolutes close the model:

- **Focusable implies operable.** An element that takes a tab stop
  contracts to do something on activation. Decorative or inert elements
  are removed from the tab order, not left as landmines that spend the
  user's keystrokes and trust. The audit is mechanical: walk the tab
  order and activate everything; every stop that does nothing is a
  defect of the worst class, because it looks exactly like the product
  working.
- **Focus is always visible.** The focus indicator is the keyboard
  user's cursor; removing it because it "looks unpolished" — the single
  most common accessibility regression in styling passes — blinds
  navigation entirely, and is
  [deletion-is-not-repair](../../_laws.md#deletion-is-not-repair) in its
  purest visual form: the indicator was the visibility, not the blemish.
  Restyle it to meet the design language and the contrast floor;
  never remove it without a replacement that is at least as visible.
