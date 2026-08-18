---
layer: technique
subject: design-tokens
technique: theme-architecture
status: forged
laws:
  - derivation-names-recomputation
  - one-authority-per-vocabulary
---

# Theme architecture

A theme is a complete set of role→value bindings and nothing more. This
technique covers how bindings are scoped, switched, derived, and kept honest —
and the small set of structural mistakes that make theming permanently
painful.

## Rebinding at a scope boundary

Themes work through runtime-resolvable style variables: roles are declared as
variables at a scope root, components reference the variables, and switching
themes swaps the binding set at the root. No component re-renders differently,
no markup forks, no stylesheet is swapped wholesale. The scope root is usually
the document root; nested scopes (a preview pane rendering a different theme
than the app around it) fall out for free when bindings are scoped variables
rather than global constants — which is itself a reason to prefer variables
over build-time substitution.

The one absolute: **components never branch on the theme's identity.** A
component that asks "am I in dark mode?" has hardcoded an answer the token
layer exists to own; every future theme (high-contrast, brand, user-derived)
must now special-case that component. When a component genuinely needs a
different *value* in dark themes, that is a role the themes should bind
differently — push the decision up into the binding set, where it is
enumerable and provable, rather than down into a conditional, where it is
neither.

## The three-state preference model

User theme preference is not binary. There are three states — explicit light,
explicit dark, and *follow the platform* — and the third is the default for
users who never open the setting, which makes it the most common state and
the least tested one. The model that works:

- The **default scope** (no explicit choice stamped) carries the complete
  light binding set and a platform-preference override that rebinds to dark.
- An **explicit choice** stamps the scope root and must win over the platform
  preference in *both* directions: explicit light under a dark-preferring
  platform, explicit dark under a light-preferring one.

The characteristic defect of this model is the **binding defined in only one
state**: a role introduced inside the dark override block, or bound only under
an explicit-choice stamp, resolves to nothing (or to an ancestor's stale
value) in the states its author didn't test. The completeness rule is
per-state: every role, bound in every reachable state, and a gate — not a
reviewer — proves it. This is theme-level
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary):
the role vocabulary is the authority, and each theme is a consumer that must
implement all of it.

## Startup: the flash of the wrong theme

Theme choice is persisted, and persistence is read at startup — but rendering
usually starts first. The gap paints the default theme for a frame or two,
then snaps to the user's choice: the flash-of-wrong-theme, most visible and
most complained about as a white flash for dark-theme users. The fix is
ordering, not speed: the persisted binding must be stamped onto the scope root
*before first paint* — an inline read ahead of the app's own boot, or a
render gate — and the persisted value must include the resolved third state
(follow-platform), not just explicit choices. A theme system that flashes at
every launch is announcing that its binding order is wrong; no amount of
transition polish fixes an ordering bug.

## Derived themes name their derivation

User-created themes — pick a seed color, get a full theme — are the strongest
argument for the role layer and the sharpest test of it. The generator is an
algorithm from seed to complete binding set: tone ladders for surfaces, hue
handling for accents, *computed* on-colors (the foreground for each colored
surface must be chosen by contrast arithmetic, never fixed), and status roles
that stay semantically stable (danger reads as danger in every derived theme).

Two contract clauses, both instances of
[derivation-names-recomputation](../../_laws.md#derivation-names-recomputation):

1. **Store the seed and the algorithm version, not just the output.** A
   derived theme stored as a flat binding snapshot is orphaned the day a new
   role is added — nobody can regenerate it, so it becomes the one theme
   missing the role, permanently. With the seed stored, adding a role means
   re-running derivation for every stored theme.
2. **Derived themes pass the same gates as authored ones** — completeness and
   contrast floors — *at derivation time*, with the generator adjusting (tone
   shifts, clamping) until they pass or refusing seeds that cannot. A
   generator that can emit an unreadable theme has moved the product's
   accessibility floor into the user's hands.

## Transitions and the cost of switching

Rebinding at a root is instant and atomic — every surface flips in the same
frame, which is exactly right. Animating a theme switch (cross-fading
bindings) is rarely worth its cost: it forces every bound value through
interpolable representations and turns an atomic rebind into a choreography
problem. If a transition is wanted, fade a *veil* over the switch rather than
interpolating tokens. And honor reduced-motion by skipping even that.

## What a theme may never contain

- **Structural variants** — different layout, different components, different
  copy per theme. Themes bind values; structure belongs to the components.
- **New vocabulary** — a role that exists only in one theme is a private
  dialect; the vocabulary is defined once, above all themes.
- **Consumer knowledge** — a binding tuned for one specific screen ("make
  this table's header work") is a component bug being paid for in the theme.
  Bindings answer roles, not call sites.
