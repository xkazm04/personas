---
layer: technique
subject: modal-stack
technique: layering-and-precedence
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Layering and precedence

When two surfaces overlap, which one wins is a product decision — and like
every decision that many components must agree on, it survives only as **one
authoritative scale defined in one place**. The moment individual components
pick their own layer numbers, the product enters a bidding war: someone's
`999` loses to someone's `9999`, the fix is `99999`, and every collision is
resolved by whoever edited last rather than by policy. The bugs then surface
at the *interactions between overlay families* — the toast behind the dialog
scrim, the dropdown under the sticky header, the tour highlight fighting the
confirmation — precisely the places no single component owns.

## One scale, semantic bands

The authority is a small closed vocabulary of **named bands**, ordered by
precedence, defined once and consumed by every surface:

```
base content
  < sticky chrome        (headers, toolbars, docked panels)
  < dropdowns/popovers   (anchored, non-modal)
  < modal dialogs        (and their backdrops)
  < notifications        (toasts, banners)
  < guided tours         (spotlights, coach marks)
  < critical alerts      (the one layer that outranks everything)
```

The exact bands are per product; what is non-negotiable is their properties:

- **Names, not numbers, at use sites.** A surface declares "I am a modal";
  it never writes a layer number. The mapping from band to number lives with
  the scale's single definition, where it can be re-spaced without touching
  a hundred call sites.
- **Closed vocabulary.** Adding a band is a design decision made at the
  authority, with an argument about where it ranks — not a constant invented
  in a leaf component on a deadline. (The deadline constant is how every
  bidding war starts.)
- **Within a band, the stack orders.** Two dialogs both say "modal"; the one
  pushed later renders above. Ordering inside a band is the overlay stack's
  job — the band scale exists only to rank *families*, so it stays small.
- **Detachment and precedence are two decisions; never fuse them into one
  flag.** Where a surface renders (inline vs at the layer root) and where it
  ranks are independent questions. A single boolean that decides both —
  "detached surfaces get the high base, inline ones the low base" — splits
  the product into two incomparable ladders separated by a gulf no stack
  depth can cross: stack order says one surface is on top while paint order
  draws it underneath, and every author who hits the gulf escapes it with a
  hand-picked number just past the far base. When workaround constants start
  clustering just above one of the bases, that is this fusion being paid
  for, one surface at a time.

## Precedence is policy, not paint order

The band scale answers "who is on top". The harder questions are behavioral —
what the lower surface *does* about it — and each named pair is a decision:

- **Toast during a modal.** Notifications outrank dialogs visually, but a
  toast must not steal focus from a modal, and a toast carrying an action
  competing with a modal's actions is two surfaces shouting. Policy options:
  render toasts above but inert to focus; or queue non-critical toasts until
  the modal closes. Either is defensible; unchosen is not.
- **Tour versus modal.** A guided tour spotlighting a control that a dialog
  now covers is nonsense. Policy: tours pause (or advance) when a modal
  opens; a tour never opens over an unrelated modal.
- **Popover crossing a band boundary.** A popover opened from *inside* a
  modal must render above that modal — its band position ("dropdowns below
  modals") describes page-level popovers, not children of a dialog. This is
  the case that reveals whether layering is truly stack-aware: the child's
  effective layer derives from its parent entry's position in the stack, not
  from its family's default band.
- **Backdrops belong to their entry.** Each modal's dim layer sits
  immediately beneath *that* modal, above everything below it — so stacked
  dialogs deepen the dimming naturally, and closing the top one restores
  exactly one level. One global backdrop toggled by "any modal open?" cannot
  express two stacked modals honestly (and its close logic is the boolean
  scroll-lock bug wearing paint — release requires counting holders, per the
  containment technique).

## The context trap

In layered rendering systems, layer values compete only within the same
**stacking scope**; an ancestor that establishes its own scope (via effects
like transforms, filters, reduced opacity, or an explicit layer of its own)
seals its children in — no number, however large, escapes it. This is the
mechanical reason the band scale alone is insufficient and overlays render at
a **layer root** near the top of the surface tree (the anchored-positioning
technique's escape): at the root, bands compete in one shared scope, and the
scale's promise actually binds.

Two disciplines follow:

- Overlay layer roots are ordered at the root by band, so band precedence is
  enforced structurally even before numbers are consulted.
- A surface that suddenly ranks wrong despite a correct band almost always
  acquired a scope-creating ancestor — an animation's leftover transform is
  the classic — and the fix is removing or relocating the scope, not raising
  the number. Raising the number is the bidding war's opening move, and it
  cannot work: the number is sealed inside the scope.

## What this technique refuses

- Raw layer numbers at use sites, including "temporary" ones.
- Per-feature layer scales ("the editor's numbers", "the dashboard's
  numbers") — two authorities over one vocabulary is the drift race the law
  names.
- Resolving a precedence bug by increment. Every such fix is evidence the
  authority is being bypassed; find the bypass.
