---
layer: technique
subject: design-tokens
technique: density-and-scale-axes
status: forged
laws:
  - one-authority-per-vocabulary
  - gate-sees-target
---

# Density and scale axes

Themes rebind color; they are the famous axis. But user-controlled appearance
is wider than hue: text scale for users who need larger type, density for
users who want more rows on screen, brightness and contrast adjustments for
users whose environment or vision demands them. Each of these is an **axis**:
an independent dimension of appearance the user sets once and the whole
product honors. This technique is about implementing axes as token
transforms — and about the combinatorial obligation that axes create.

## An axis is a token transform, not a component variant

The wrong implementation arrives first and naturally: a `compact` variant on
the table, a `large-text` prop on the card, a per-surface toggle wired to a
setting. It fails the same way per-theme component forks fail — every new
surface must remember every axis, coverage decays from day one, and the
setting becomes "works on the screens someone tested".

The right implementation is the theming move again: an axis **rebinds part of
the token vocabulary at the scope root**. Density rebinds the spacing roles
(and row-height / control-height roles); text scale rebinds the type recipes'
size bindings; brightness adjusts the surface ramp. Components consume the
same roles as always and never learn the axis exists. The axis's reach is
then *provable* — it reaches exactly the consumers of the roles it rebinds —
instead of aspirational.

Corollary: **an axis is only as complete as token adoption.** A hardcoded gap
that a color theme would have exposed as an off-shade is exposed by a density
axis as a row that refuses to compact. Axes are, in this sense, a live audit
of the enforcement technique — every raw value is a place the axis stops.

## Which roles each axis owns

Axes stay orthogonal only if each owns a disjoint slice of the vocabulary:

- **Text scale** rebinds type recipe sizes — and, critically, everything
  sized *relative to text* follows automatically if spacing near text uses
  text-relative units. Containers sized in absolute units clip scaled text;
  the axis therefore has a unit-discipline prerequisite: text containers
  size in text-relative terms, or the axis produces overflow instead of
  accessibility.
- **Density** rebinds the spacing roles and the control/row height roles. It
  does *not* touch type sizes (that is the text-scale axis) — compact means
  less air, not smaller words. The two compose: compact + large text is a
  legitimate and common combination (a power user with presbyopia), and it
  only works if the axes never rebind each other's roles.
- **Brightness/contrast** adjusts the surface and foreground ramps within a
  theme — a dimmer dark, a higher-contrast light — without being a separate
  theme. Implemented as a bounded transform on the ramp, not as N×M
  hand-authored theme variants. The tempting third implementation — a
  **whole-surface pixel filter** applied over the rendered output — is a
  trap with two teeth: it escapes the token layer entirely, so every gate
  that reads token *values* now measures colors that never reach the screen
  ([gate-sees-target](../../_laws.md#gate-sees-target) — a contrast audit
  over the declarations passes while the filtered pixels fail); and it
  destroys derived hierarchies, clamping distinct foreground tints into one
  value so that the product's carefully tiered emphasis becomes a no-op. If
  brightness must be an axis, it rebinds the ramp — the same door every
  other axis uses — so the gates and the screen keep seeing the same
  numbers.

One rule spans all three: an axis rebinding a role another axis also rebinds
is a hidden coupling — the last-applied wins, the settings screen lies, and
the bug reports read as haunted. Disjoint ownership per axis is
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
applied between the axes themselves.

## The matrix obligation

Axes multiply states: themes × density steps × text scales × contrast
settings. Nobody hand-tests the full product against the full matrix, so the
obligations must be structural:

- **Gates run per-axis-combination where cheap.** The contrast floor is
  recomputed for the brightness axis's extremes, not just the theme's
  defaults; completeness checks cover each axis's rebinding set.
- **Layouts must be scale-tolerant by construction** — minimum sizes instead
  of fixed sizes, wrapping tolerated, scroll containment where wrapping is
  impossible. The text-scale axis at its maximum is the honest stress test:
  run the product's key screens there once per release rather than
  discovering it from a support ticket.
- **Floors bound the axes.** Density's most compact step still meets minimum
  target sizes for touch and pointer accuracy; brightness's dimmest step
  still meets the contrast floor. An axis whose extreme violates an
  accessibility floor has its range wrong, and the range is clamped at the
  vocabulary, not in each consumer.

## Persistence and the platform

Axes are preferences, so the theming lessons apply verbatim: persisted with
the theme choice, stamped before first paint (no flash of default density for
a compact user), and defaulted from the platform's own signals where they
exist — the platform text-scale and contrast preferences are the default
binding for their axes, with explicit in-product choice overriding, exactly
parallel to the three-state model in
[theme-architecture](theme-architecture.md). A product that ignores the
platform's text-scale signal until the user finds the in-app setting has
made its most vision-impaired users do the most navigation to fix it.
