---
layer: golden-path
subject: design-tokens
status: forged
techniques:
  - token-taxonomy
  - theme-architecture
  - cross-language-token-parity
  - token-enforcement
  - motion-tokens
  - density-and-scale-axes
evidence:
  - .claude/Design.md                                       # the canonical token reference: typo recipes, semantic radii, elevation, spacing tokens
  - src/lib/utils/designTokens.ts                           # script-layer vocabulary: spacing/motion/status/border tokens, density-variable consumers
  - src/stores/themeStore.ts                                # one owner for every appearance axis: theme, text-scale, density, brightness, contrast, cvd, motion
  - src/styles/typography.css                               # type recipes (typo-*): size+weight+line-height+tracking as one named unit
  - src/lib/theme/deriveCustomTheme.ts                      # seed→complete-binding-set derivation; stores config not snapshot, re-derives at boot
  - scripts/check-themes.mjs                                # the contrast floor as a gate: parses the shipped stylesheet, hard-fails AA text pairs per theme
counter_evidence:
  - eslint.config.js                                        # the raw-value bans at warn-level (":96-101") — advisory by construction at both gates; the decay the enforcement technique names
deviations:
  - w3-design-tokens   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Design tokens & theming

Every rendered surface is a stream of visual decisions: this gray, this gap,
this corner radius, this shadow, this duration. Left alone, those decisions are
made anonymously — a raw value typed at a call site, stating *what* it is but
never *why* — and an interface accumulates thousands of them, each one an
unnamed fork of some earlier decision, drifting a shade or two per quarter
until nothing lines up and nobody can say which of the fourteen grays is the
real one.

A **design token** is a visual decision given a name. The name records the
intent (`surface-raised`, `radius-interactive`, `duration-fast`), the binding
records the current answer, and every consumer references the name. That one
indirection is the entire foundation: it is what makes themes possible, what
makes a redesign a rebinding instead of a hunt, what makes consistency a
structural property instead of a review-time aspiration, and what gives an
accessibility floor a place to attach.

## Two layers, one direction

A mature token system has exactly two layers, and value flows through them in
one direction:

- **Raw scales (primitives).** Ordered ramps with no meaning attached: a color
  ramp from near-white to near-black, a spacing grid on a fixed base unit, a
  radius ladder, a duration ladder, a type-size scale. Raw scales exist so
  that every value in the product is drawn from a small, deliberate set —
  but they carry no intent, and **components never consume them directly**.
- **Semantic roles.** Named purposes bound to raw values: `surface` and
  `surface-raised`, `foreground` and `foreground-muted`, `accent`, `danger`,
  `border`, `radius-input`, `elevation-2`, `duration-base`, `space-card`.
  Roles are what components consume, and roles are what themes rebind.

Both failure directions are real. Raw values inline in components make theming
impossible and drift inevitable — that is the obvious one. The subtler decay is
**role proliferation**: minting a new role per call site (`button-cancel-hover-
border-gray`) until the semantic layer is just raw values wearing name tags,
with all of the indirection's cost and none of its leverage. A role earns
existence by *recurring intent*, not by existing usage; the discipline of when
a token deserves to exist is the [token-taxonomy](techniques/token-taxonomy.md)
technique.

## The taxonomy: closed vocabularies per axis

Tokens are not one flat bag; they organize into axes, and each axis is a closed
vocabulary with its own grammar and its own authority:

| Axis | What it names | Typical shape |
| --- | --- | --- |
| **Color roles** | surfaces, foregrounds, borders, accents, status meanings | role → value per theme |
| **Spacing** | the rhythm between things | a grid on one base unit, plus named layout roles (card padding, section gap) |
| **Radius** | how much a class of element rounds | per element class (interactive, input, card, modal), not per instance |
| **Elevation** | visual depth ordering | a small ladder (3–5 levels), each pairing shadow with its layering meaning |
| **Typography** | text roles | *recipes* (size + weight + line-height + tracking as one named unit), not loose size values |
| **Motion** | how long and with what character things move | duration ladder + easing vocabulary |

Each vocabulary being *closed* is the point: a finite, enumerable set means a
gate can check membership, a theme can prove completeness, and a new teammate
can learn the whole set. An open-ended axis — any value allowed, tokens merely
suggested — is not a token system; it is a naming convention with optimism.
This is [one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)
applied to pixels.

## One authority per token, consumers gated

Every token has exactly one authoritative definition. The hard case is not two
stylesheets — it is that real products consume tokens from **two runtimes**:
the styling layer (rules, variables, utility classes) and the scripting layer
(layout math, animation waits, chart palettes, canvas drawing). A duration that
exists as a style variable *and* as a numeric constant in code is one
vocabulary with two hand-maintained copies, and it will drift exactly when
someone retunes the motion system and finds only one of them. The mirror must
be generated from the authority or gated against it — never trusted to
discipline. That containment strategy is
[cross-language-token-parity](techniques/cross-language-token-parity.md).

## Theming is token redefinition — never component forks

A theme is a **complete set of role→value bindings**, and switching themes
rebinds roles at a scope boundary. Nothing else changes: no component renders
differently by theme, no markup forks, no per-theme variants of a surface.
The moment a component asks "which theme am I in?", the indirection has
failed — the component has smuggled a raw decision back inside itself, and
every future theme must now know about that component.

Three consequences follow:

1. **Completeness is per-theme and provable.** Every theme defines every role.
   A role defined only in one theme's override block is a landmine that
   detonates as the default in every other theme.
2. **Derived themes name their derivation.** A user-created theme generated
   from a seed color is a stored derivation — the algorithm (tone ladders,
   hue rotation, auto-computed on-colors) must be invokable again, or the
   theme becomes an orphan the moment a new role is added
   ([derivation-names-recomputation](../_laws.md#derivation-names-recomputation)).
3. **The system-preference state is part of the model.** "Follow the
   platform" is a third state alongside explicit light and explicit dark, and
   binding completeness must hold in all three.

The full architecture — scope stamping, startup without a flash of the wrong
theme, custom-theme validation — is
[theme-architecture](techniques/theme-architecture.md).

## The contrast floor is in the contract

Color roles do not float free; they come in **pairs with obligations**. A
foreground role is defined *against* the surfaces it may appear on, and the
pair carries a minimum contrast ratio as part of the token contract — not as a
review-time nicety. This matters structurally because theming multiplies the
risk: every new theme, and every user-derived theme, re-answers every pairing
at once. A hand-checked palette survives its author; it does not survive its
hundredth descendant. The floor must therefore be *checked by a gate that
reads the actual theme definitions*, runs on every theme including derived
ones, and fails the build — a contract clause nobody can silently waive.

## Enforcement, or decay

A token system without a gate is a token system in decay. The mechanism is
mundane: a deadline commit inlines one raw value "temporarily"; the next
author copies the nearest existing code; within a year the semantic layer is
one option among several and the drift the tokens existed to prevent is back,
now *harder* to fix because half the product speaks each dialect.

The gate is a lint-shaped rule: **raw values that have a semantic equivalent
are errors**. And the enforcement level is not a detail — an advisory
(warn-level) rule that no build gate counts enforces nothing *by
construction*; it shapes authoring through editor feedback but stops no
commit, and the decay proceeds through exactly the commits that ignored the
squiggle. Where legacy debt makes error-level adoption abrupt, the answer is a
ratchet (baseline the debt, fail on increase), never a permanent advisory.
The full enforcement design — what the gate must read, how it fails, the
escape-hatch policy — is [token-enforcement](techniques/token-enforcement.md).

## A token change is a migration, not an edit

The same property that makes a token valuable — many consumers referencing one
name — makes changing it a wide-radius event. Two kinds of change, two
obligations:

- **Rebinding** (the name keeps its meaning, the value moves): safe by
  design *if* consumers were honest. The audit is for consumers that
  compensated locally — a hand-tuned offset somewhere that baked in the old
  value and now double-corrects.
- **Semantic change** (the name's meaning shifts — a recipe softens, a role
  narrows): this must sweep every consumer, **including the ones the old
  definition was suppressing**. A token that previously overrode local
  styling can, when softened, silently hand control back to hundreds of
  dormant local declarations — utilities that were inert under the old
  binding go live at once, and nothing fails loudly. The blast radius of a
  token change is defined by what referenced it *and* what it overrode; a
  change review that only greps for the name finds half the radius.

Deprecation follows the same shape: a token is removed only after its
consumers are migrated and a gate proves zero references remain — deleting the
definition first converts every consumer into a silent fallback
([deletion-is-not-repair](../_laws.md#deletion-is-not-repair)).

## The techniques

- [token-taxonomy](techniques/token-taxonomy.md) — the two layers, the naming
  grammar, when a token earns existence, and the anti-patterns that hollow a
  semantic layer out.
- [theme-architecture](techniques/theme-architecture.md) — themes as binding
  sets, scope stamping, the three-state system-preference model, custom-theme
  derivation and validation.
- [cross-language-token-parity](techniques/cross-language-token-parity.md) —
  one vocabulary consumed by styles and scripts, kept from drifting by
  generation or gating.
- [token-enforcement](techniques/token-enforcement.md) — the decay mechanism,
  the raw-value ban, the advisory-level trap, contrast gates, escape hatches.
- [motion-tokens](techniques/motion-tokens.md) — duration ladders, easing
  vocabularies, and reduced-motion as a token-layer decision.
- [density-and-scale-axes](techniques/density-and-scale-axes.md) — user-
  controlled brightness, text-scale, and density as orthogonal token axes
  that must compose.
