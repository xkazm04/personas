---
layer: technique
subject: modal-stack
technique: anchored-positioning
status: forged
laws: [derivation-names-recomputation]
shared_with: []
---

# Anchored positioning

A popover, menu, or tooltip is positioned *relative to the control it
serves*. That position is not state — it is a **derivation** from three
inputs: the anchor's current geometry, a placement preference, and the
viewport's edges. Treating it as state (measure once at open, store
coordinates, hope) is the root of the whole defect family: the popover that
drifts off its anchor on scroll, overlaps the very control it describes, or
renders half outside the screen. A derivation names when it is recomputed;
this technique is that schedule plus the collision policy.

## Escape the clip, keep the anchor

Anchored overlays render at a **layer root** — a mount point at the top of
the surface tree — not inline beside their anchor. Inline rendering inherits
every ancestor's clipping and scrolling: the menu is sheared off by its
container's overflow, trapped under a sibling's layer, or dragged by an
intermediate scroller. Rendering at the root trades those problems for one
obligation: the geometric link to the anchor must now be maintained by
computation, because the tree no longer provides it. That trade is the
technique.

Detachment has a second cost: the overlay is no longer the anchor's child in
the accessibility tree or the event tree. The relationship must be restated
explicitly — the anchor declares its expanded state and its ownership of the
popup, and outside-click judgment treats anchor plus overlay as one territory
(the dismissal technique's rule; detachment is *why* that rule needs
stating).

## The placement algorithm

1. **Preference.** Each overlay declares a preferred side and alignment
   relative to the anchor — below-start for menus, above-center for
   tooltip-like surfaces, per design convention. Consistency here is a
   product trait: menus that open downward *except sometimes* feel haunted.
2. **Measure.** Take the anchor's geometry and the overlay's rendered size —
   the real size, measured, not an assumed constant that a longer label or a
   translated string will falsify. One honest exception: an overlay that
   *caps its own height* by contract (a list capped at N units, scrolling
   inside) may legitimately make the flip decision against that declared
   cap, because the cap is a promise the overlay keeps, not a guess about
   content.
3. **Collide and resolve.** If the preferred placement overflows the
   viewport (or a declared boundary), apply the declared fallback, in order:
   - **Flip** to the opposite side when the opposite side has room.
   - **Shift** along the aligned axis to stay on-screen while still touching
     the anchor.
   - **Resize** as the last resort for tall list-like content: cap the
     overlay at the available space and scroll inside it. A menu that
     extends past the bottom of the screen has unreachable items — resize is
     not cosmetic.
4. **Commit atomically.** Position and visibility land together. Rendering
   at a default corner for one frame and then jumping to the anchor is the
   flicker that reads as cheapness; measure while hidden, then show placed.

The pointer/arrow, when the design uses one, aligns with the **anchor**, not
with the overlay's center — after a shift, those differ, and an arrow
pointing at nothing defeats its purpose.

## The recomputation schedule

The derivation's inputs move; the technique names each mover and its
response:

- **Anchor moves or resizes** (layout change, container resize, content
  reflow) → reposition. Watch the anchor's geometry, not just the window's.
- **Overlay resizes** (async content arrives, a section expands) →
  reposition; the collision resolution may change outcome entirely.
- **Viewport resizes** → reposition.
- **An ancestor of the anchor scrolls** → the fork in the road:
  - **Track** — recompute per scroll frame so the overlay rides with its
    anchor. Right for tightly-coupled, short-lived surfaces (a tooltip, an
    inline autocomplete) where detaching visually breaks the link.
  - **Dismiss** — close on ancestor scroll. Right for menus and richer
    popovers: the user scrolling away is a statement of moved attention, and
    tracking a heavy popover across a fast scroll is both costly and weird.
  - What is not acceptable is the unpicked third: neither tracking nor
    dismissing, leaving the overlay hovering where the anchor used to be —
    attached to a coordinate instead of a control.
- **Anchor leaves the visible region entirely** (scrolled out, collapsed,
  removed) → dismiss, even under the tracking policy. An overlay pointing at
  an off-screen or dead anchor is orphaned; if the anchor is *removed*, this
  is the owner-death rule from stack ownership arriving via geometry.

## Nesting and chains

Anchored overlays nest — a menu opens a submenu, a popover opens a picker.
Each child anchors to *its* trigger inside the parent, renders at the same
layer root, and sits above its parent in the stack. The chain closes root-ward:
dismissing a parent dismisses its children (they are anchored to territory
that is vanishing), while dismissing a child returns to the parent intact —
the stack's ordinary LIFO, driven by geometry's ownership.

Submenu-grade nesting adds one pointer subtlety worth naming: moving
diagonally from a parent item toward an open submenu momentarily leaves the
parent item's bounds. Immediate-close-on-leave makes submenus unusable for
precise pointing; a short grace interval or an intent region (tolerate travel
toward the submenu) is the difference between polish and frustration.

## What this technique refuses

- Stored coordinates with no recomputation schedule — position computed once
  at open and never again.
- Assumed sizes — placement math against constants that real content,
  translation, or user font settings will falsify.
- Per-surface bespoke positioning code. The algorithm above is one shared
  mechanism with declared preferences; five hand-rolled variants is five
  collision policies diverging.
