---
layer: technique
subject: ui-controls
technique: variant-discipline
status: forged
laws:
  - one-authority-per-vocabulary
shared_with: []
---

# Variant discipline

A shared control needs to look different in different places — smaller in a
toolbar, destructive in a delete flow, quiet in a footer. The undisciplined
answer is an open styling channel; the disciplined answer is **variants as a
closed, enumerated set**, each name bound to a bundle of design tokens. The
difference decides whether the library can ever evolve: a closed set can be
audited, migrated, and re-themed in one place; an open channel means every
call site is a private variant the library cannot see.

## Axes are few, orthogonal, and named for intent

A control's variant space is a handful of axes, each an enum:

- **Tone / intent** — what the action means: neutral, primary, destructive,
  ghost/quiet. Named for *meaning*, not for color: a `danger` variant can be
  re-themed; a `red` variant is a lie waiting for a palette change.
- **Size / density** — drawn from the token system's size ladder, so a
  "small" button and a "small" input agree about what small means.
- **Emphasis** — solid / outline / bare, if the design language has that
  dimension at all.

Axes must be orthogonal: any tone at any size. The moment two axes
interact ("destructive only exists in solid"), either the design language
has a real rule — encode it, reject the invalid pair loudly — or the axes
were mis-drawn. And the axis count stays small on purpose: every added axis
multiplies the audit surface for theming, contrast, and focus states.

## Enums, not boolean flags

`isPrimary`, `isDanger`, `isQuiet` accumulate one release at a time until a
call site passes two of them and the control resolves the contradiction by
prop order — an answer nobody chose. An enum cannot contradict itself:
`tone="danger"` closes the question. Booleans are acceptable only for true
independent bits (disabled, full-width); anything that is secretly a choice
among alternatives is an enum being smuggled in one flag at a time.

## Variant names are a governed vocabulary

The variant set is a closed vocabulary with exactly one authoritative
definition — the control's own type/definition — and every consumer derives
from it ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
Consequences:

- **The mapping variant → tokens lives in one place**, inside the
  primitive, not sprinkled per call site. Re-theming a tone is one edit.
- **Adding a variant is a design decision, not a call-site convenience.**
  The pull request that adds `tone="warning"` is a change to the design
  language and gets reviewed as one — otherwise the set inflates until it
  is an open channel with extra steps.
- **Retiring a variant is a migration**, with the old name mapped or
  failing loudly — never silently falling through to a default that looks
  almost right.

## Size includes the pointer

One axis practice adds that textbooks omit: the size ladder must answer
for **coarse pointers**. Icon-only controls sized for a mouse are
micro-targets under touch; the size variant, not the call site, is where
the coarse-pointer bump (to the platform minimum hit area) is encoded, so
every icon button in the tree meets the target size without any consumer
knowing the rule exists.

## The escape hatch is explicit and observable

Real products need overrides — a marketing page, a one-off density fix. The
discipline is not "no escape hatch"; it is: the hatch is **one named door**
(a style/class passthrough), it composes *over* the variant rather than
replacing it, and its use is grep-able so a census can count how often the
closed set failed its consumers. A high override count on one control is
not consumer misbehavior; it is a missing variant telling you its name.
What the hatch may not do is reach the control's internals — geometry,
focus ring, state colors — because those carry the contract (see
[composition-contracts](composition-contracts.md)).

## The test

Two questions audit any control's variant discipline in a minute: *Can you
enumerate every visual form this control ships in, from its definition
alone?* If not, there is an open channel. *If the design team renames a
tone or reworks a size ladder, how many files change?* If the answer is
more than the primitive and the token definitions, call sites are holding
copies of the vocabulary.
