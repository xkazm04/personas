---
layer: technique
subject: docs-sync
technique: source-doc-mapping
status: forged
laws: [one-authority-per-vocabulary, derivation-names-recomputation, gate-sees-target]
shared_with: []
---

# Source→doc mapping

Every synchronization mechanism downstream — the change-boundary nag, the
rot scan, the catch-up pass — asks the same question first: *which documents
does this source area couple to?* This technique is the answer's storage
format and its failure modes. The answer is **data**: one declared artifact,
one entry per feature area, extended in the same change that adds the area
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
applied to coupling — two places that each half-know the coupling are a race,
not redundancy).

## The entry is a coupling record, not a path pair

A useful entry declares more than "this directory ↔ that document":

- **source matchers** — globs over the areas whose change creates the
  obligation;
- **one or more target types** — the reference document (required), plus
  optional coupled surfaces: the onboarding flows that walk this feature,
  the marketing module that explains it (see
  [coupled-surface-inventory](coupled-surface-inventory.md));
- for indirect targets, a **registry**: tour-flow ids resolve through a
  flow table that names the step artifact and the completion event, so the
  nag can say *which* tour and *which* step, not "some tour, somewhere."

Two hygiene notes, both measured. First: a data format without comments
grows comment-shaped members — a registry keyed by ids that also holds a
`_comment` key makes every naive key count wrong by one (39 keys, 38 flows;
the count was a measurement of the counter, not the registry). Second: keep
optional target types honest — an entry model with three target slots where
two sit empty on most entries (20 of 37 declared no flows; 13 of 37 no
marketing module) is not wrong, but every consumer must treat absence as
"not coupled," never as "nothing to check was checked."

## The map is the real gate: coverage, not membership

A registry-driven check can only ever be as good as the registry's
completeness, and completeness is precisely what nothing measures by
default. The exemplar's numbers: **1,421 of 4,304 source files (33.0%)
matched no entry at all** — including the entire shared-component library
(229 files), the entire data layer (131), and every state-store slice (57).
Meanwhile the surface's one live checker validated that all 77 paths the map
*named* resolved on disk — exit 0, working exactly as designed — because
validating what a map names is structurally incapable of seeing what the map
omits. Only an inventory of what *should* be mapped finds the hole
([gate-sees-target](../../_laws.md#gate-sees-target): the gate's target is
the coupling universe, not the map's contents).

The coverage gate, specified:

- for each top-level feature area, assert that at least one entry claims it —
  an unmapped area is a failure, with an explicit, reasoned allowlist for
  true exceptions;
- assert the walked population against a floor — a coverage checker that
  walks zero directories reports perfect coverage;
- assert every entry matches at least one live file — a stale glob is a dead
  entry wearing a live one's clothes.

## Prefer derivation where convention holds

Where a naming convention couples source to doc mechanically — feature
directory *x* ↔ the feature-docs tree's entry for *x* — **derive** the pair
and let the map hold only exceptions
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation):
the convention *is* the recomputation). Measured in the exemplar: 12 of the
map's 37 entries were exactly that mechanical correspondence written out by
hand. Deriving them removes 12 hand-maintained couplings, and — the deeper
win — makes them **self-repairing under rename**, which is the declared
map's characteristic death:

> With rename detection on, one window held **982 renames**, of which **318
> crossed an entry boundary** and **51 stripped a document of coverage
> entirely** — whole component trees moving from a mapped feature area into
> an unmapped shared area, eight files at a time, one doc's coverage
> silently deleted per move. A declared layout is a bet that the layout
> stops moving. It never does.

A derived coupling recomputes from the *current* layout on every evaluation;
a declared one describes the layout on the day someone last edited the map.

## The map travels without its machine

Coupling maps are cheap to copy and satisfying to have, which makes them the
half of the practice that crosses repository boundaries while the
enforcement stays home. The measured case: a sibling repository carried a
byte-compatible map — twelve entries, all twelve resolving, in *better*
health than the original because it never grew the partially-populated
optional fields — and **zero mechanism reading it**: no hook, no checker, no
consumer anywhere in its tree. When auditing a practice's spread, ask
whether the *enforcement* travelled, not whether the artifact did; a map
without a reader is a good intention in a syntax that parses.
