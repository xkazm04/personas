---
layer: technique
subject: design-tokens
technique: token-taxonomy
status: forged
laws:
  - one-authority-per-vocabulary
---

# Token taxonomy

A token system lives or dies on its vocabulary design: which names exist, what
grammar they follow, and — hardest — which names are *refused*. This technique
is the discipline of the name layer.

## Raw scales are for authors of roles, not authors of components

The primitive layer (a color ramp, a spacing grid, a radius ladder) exists to
constrain the *semantic* layer to a small deliberate set of values. Its
audience is whoever defines roles and themes. The moment a component consumes
a primitive directly — "step 6 of the gray ramp" — it has made an anonymous
decision with a tokenized accent: the value is disciplined, but the *intent*
is unrecorded, and a theme cannot rebind what it cannot interpret. Step 6 of
gray means something different on a dark canvas than a light one; only a role
name (`border-subtle`) carries enough intent for a theme to answer correctly.

Rule: **primitives feed roles; roles feed components; nothing skips a layer.**

## The naming grammar

Names are read thousands of times and written once, so optimize for the
reader. A workable grammar, in decreasing order of significance:

```
<axis>-<role>[-<variant>][-<state>]
```

- `surface`, `surface-raised`, `surface-sunken`
- `foreground`, `foreground-muted`, `foreground-on-accent`
- `radius-interactive`, `radius-card`, `radius-modal`
- `duration-fast`, `duration-base`, `easing-enter`
- `space-card`, `space-section`

Two hard rules inside the grammar:

1. **Never encode the value in the name.** `blue-button` and `gray-200-border`
   die the day the design shifts: either the name lies (`blue-button` is now
   violet) or a rename sweeps every consumer. Names carry intent; bindings
   carry values.
2. **Never encode the call site in the name.** `settings-page-header-border`
   is not a role, it is a street address. Roles describe a *class* of use
   (`border-subtle`) that any surface may claim; addresses guarantee the
   vocabulary grows linearly with the interface and collapses under its own
   count.

Status colors deserve their own note: `danger`, `warning`, `success`, `info`
are semantic roles even though they feel like colors, because their meaning
("this is destructive") is what themes must preserve while values move. The
pairing rule applies doubly here — every status role needs its on-color
(`foreground-on-danger`), or dark themes will improvise one.

## When a token earns existence

The semantic layer stays useful only if admission is guarded. A candidate
token earns a name when **all three** hold:

1. **Recurring intent** — the same *decision* (not the same value) appears at
   several independent call sites. Two sites sharing a value by coincidence
   are not a role; three sites sharing a reason are.
2. **Theme-variance or policy-variance** — the answer could plausibly differ
   by theme, density, or future redesign. A value that is physically fixed
   (a hairline is one device pixel everywhere, forever) gains little from
   role indirection.
3. **A owner-answerable definition** — someone can state, in one sentence,
   when a component should use this role instead of its neighbors. If the
   distinction between `foreground-muted` and `foreground-subtle` cannot be
   stated, one of them is noise, and consumers will choose by dice roll.

The inverse discipline matters as much: when a call site needs a value no role
covers, the *default* answer is "use the nearest role" — a new token is minted
only when the three tests pass. An escape hatch for the genuine one-off should
exist, be syntactically loud, and be countable (see
[token-enforcement](token-enforcement.md)); an invisible escape hatch is how
role proliferation's mirror image — raw-value proliferation — comes back.

## Typography: recipes, not ingredients

Type is the axis where loose tokens fail most reliably. Size, weight,
line-height, and tracking are not independent decisions — a readable
combination is designed as a unit, and letting call sites mix a size token
with a freely chosen weight recreates the drift inside the token system.
The unit of typographic vocabulary is the **recipe**: a named text role
(`label`, `body`, `title`, `code-inline`) that sets the whole cluster at once.
Consumers pick a recipe; nobody composes ingredients. When a call site needs
"the label recipe but heavier", that is either a new recipe earning its
existence (the three tests) or a design inconsistency asking for permission.

A recipe is also where a semantic *change* is most dangerous: softening a
recipe (dropping its weight, loosening its tracking) alters every consumer,
including consumers whose local overrides the old recipe was masking — see the
golden path's migration section. Recipes concentrate power; treat their edits
as migrations.

## Each axis is one closed vocabulary

The taxonomy's axes — color roles, spacing, radius, elevation, type recipes,
motion — are each a closed set with exactly one authoritative definition, per
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary).
Closedness is what makes the rest of the subject work: a gate can test
membership ("is this a known role?"), a theme can be proven complete ("does it
bind every role?"), and parity across runtimes can be checked ("do both copies
enumerate the same set?"). An axis that admits ad-hoc members is not a
vocabulary; it is a suggestion, and every downstream guarantee built on it is
a suggestion too.

## Anti-patterns, named

- **The name-tagged raw value** — a token per call site, semantics layer as
  street directory. Detected by vocabulary growth tracking interface growth.
- **The value-named token** — `gray-700-text`. Detected by any color word or
  number in a semantic name.
- **The twin roles** — two roles no one can tell apart, splitting consumers
  randomly. Detected by asking for the one-sentence distinction.
- **The skipped layer** — components on primitives. Detected by any primitive
  reference outside role/theme definitions.
- **The open axis** — "we mostly use the spacing grid". *Mostly* is the tell;
  membership either gates or it doesn't.
