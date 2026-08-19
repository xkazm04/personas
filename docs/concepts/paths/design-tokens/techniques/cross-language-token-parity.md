---
layer: technique
subject: design-tokens
technique: cross-language-token-parity
status: forged
laws:
  - one-authority-per-vocabulary
  - gate-sees-target
---

# Cross-language token parity

The styling layer is not the only consumer of design tokens. Real products
consume the same vocabulary from the **scripting layer** too: layout math
that needs the spacing grid, an animation-completion wait that needs a
duration, a chart or canvas that needs the color roles, a virtualizer that
needs the row height, a drag threshold that needs a radius. The moment a
token exists as a style variable *and* as a constant in code, one vocabulary
has two hand-maintained copies — and per
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary),
that is not redundancy but a race with a delay fuse. This technique is about
defusing it.

## Why this drift is worse than most

Token drift across runtimes has two properties that make it nastier than
ordinary duplication:

1. **It fails silently and visually.** A script that waits 200ms for a
   transition declared at 300ms doesn't throw — it removes the element
   mid-animation, or measures a layout mid-settle, or fires a follow-up
   before the first motion lands. The bug reads as "feels glitchy", is
   rarely reported, and never points at the constant.
2. **The retune finds only one copy.** Vocabularies drift precisely when
   someone changes them — a motion retune, a spacing rebase, a palette
   shift — and the person doing it works in one runtime. The other copy
   isn't wrong *yet*; it becomes wrong at the retune, which is the moment
   nobody is looking at it.

## The strategies, ranked

**1. One source, generated mirrors (strongest).** The vocabulary lives in one
authored artifact — a token definition file, or the style layer itself — and
the other runtime's copy is *generated* from it as part of the build, never
edited by hand. Drift is structurally impossible; the generated copy is build
output, and a stale generation is caught by the same freshness gates that
protect any generated code. The costs are a codegen step and the discipline
that nobody edits the mirror (which the gate below should enforce anyway).

**2. Runtime readback (strong, narrower).** The scripting layer reads the
value out of the *live* style system at runtime — resolving the variable off
the scope root — so there is only ever one copy anywhere. This is the only
strategy that automatically tracks *theme-dependent* values (a chart reading
color roles must re-read on theme switch, and readback makes that a
subscription rather than a sync). Costs: a resolution step at runtime, values
arriving as strings needing parsing, and care around reading before the
binding is stamped (the startup-ordering problem from
[theme-architecture](theme-architecture.md)).

**3. Gated mirror (acceptable floor).** Both copies are hand-authored, and an
automated check compares them — enumerating both sets and failing on any
member missing or unequal. This is the minimum honest arrangement, and it is
subject to [gate-sees-target](../../_laws.md#gate-sees-target): the check must
parse the *actual artifacts both runtimes consume*, not a doc that describes
them, and it must fail loudly when it finds zero tokens on either side (a
parity checker that parses nothing and reports parity is the empty-success
lie). Mirror-comparison gates rot when the file they parse moves; pin them to
the authority, not to a path someone remembers to update.

**4. Hand-sync with a comment (not a strategy).** "Keep in sync with the
style layer" written above a constant is a wish. It works until the first
retune performed by someone who didn't write the comment — that is, it works
until it matters.

## Choosing per token class

- **Theme-varying values** (colors, anything a theme rebinds): runtime
  readback, because a generated constant is wrong the moment the user
  switches theme.
- **Theme-stable structure** (spacing grid, radius ladder, durations, row
  heights): generation from one source, because these are needed at times
  and in places where readback is awkward (module init, non-UI code, tests).
- **Durations specifically** deserve one more rule: scripts should prefer
  *completion events over timed waits* wherever the platform offers them —
  a wait derived from a token is parity-correct but still a race against
  frame scheduling; an event is neither. Use the token for the declaration,
  the event for the observation.

## The vocabulary boundary is part of parity

Parity is not only value equality — it is *set* equality. The scripting copy
enumerating twelve durations when the authority defines nine means three
phantom tokens exist in one runtime only, and consumers there are building on
vocabulary the design system never issued. A parity gate therefore checks
three things: same members, same values, and — where generation is used — that
the mirror carries its provenance ("generated from X, do not edit") so a
hand-edit is visible in review even before the gate runs.
