---
layer: technique
subject: diff-comparison
technique: presentation-modes
status: forged
laws: [count-carries-predicate, one-authority-per-vocabulary]
shared_with: []
---

# Presentation modes

One difference, three honest renderings — chosen by what the reader is
*doing*, not by what the data made convenient. The reviewer needs both
contexts whole; the reader-of-a-story needs one flow with changes marked
in place; the triager needs a number small enough to decide "look or move
on". Serving the wrong mode to an audience does not distort the data — it
misallocates the scarcest resource on the surface, the reader's attention:
the triager drowns in a two-pane review layout, the reviewer squints at a
count that hides everything they came to judge.

## Side-by-side: the review mode

Two full renditions, aligned row by row, differences highlighted in
place. This is the mode for **judgment under responsibility** — approving
a promotion, reviewing an edit — because judgment needs *context*: what
surrounds the change, what stayed the same, whether the change is local
or part of a pattern. Its disciplines:

- **Alignment is the product.** Corresponding regions sit opposite each
  other; unchanged stretches collapse behind expanders (with visible
  "N unchanged" labels — collapsed is not hidden) so the changes carry
  the visual rhythm.
- **Both sides render fully**, including what is absent from the other
  side: an element present only in the baseline occupies real space
  opposite a gap, because "this used to exist" is a finding with the same
  rank as "this is new".
- It is the widest mode, and it degrades worst on narrow surfaces —
  side-by-side crushed into two forty-character gutters is neither side
  by anything. Below a width the layout cannot honestly serve, switch to
  inline rather than miniaturize.

## Inline: the narrative mode

One reading flow with removals and additions marked in sequence. This is
the mode for **understanding a change as a story** — what happened here,
in reading order — and for prose generally, where the reader's task is to
read the *result* while noticing the edits. It trades away the baseline's
independent existence: the old state exists only as annotations on the
new. That trade is right when the reader's primary text is the candidate,
wrong when the two states have equal standing (use side-by-side) —
which is also why inline is the natural mode for narrow surfaces and
embedded contexts.

## Summary counts: the triage mode

Added / removed / changed, as numbers, one line per compared entity. This
is the mode for **deciding where to look** across many comparisons — a
batch of runs, a fleet of entities — where the reader's question is not
"what changed" but "which of these is worth opening". Two disciplines
keep counts from lying:

- **A count carries its predicate** ([_laws:
  count-carries-predicate_](../../_laws.md#count-carries-predicate)):
  "3 changed" states its unit (fields? elements? sections?), its level,
  and its exclusions — "3 fields changed (field level, volatile fields
  excluded)" — or it will be compared against a count computed under a
  different predicate and the comparison of comparisons will be
  fiction.
- **Zero is a claim.** A row showing 0/0/0 asserts "compared, no
  differences" — it must be visually distinct from "not compared" and
  "comparison failed" (diff-honesty owns the trichotomy; this mode is
  where it is most often violated, because dashboards love zeros).

## The escalation path

The modes are floors of one building, not rival buildings. Triage counts
open into the full diff; the full diff can collapse back to its summary.
A summary that cannot be expanded is an unauditable claim — the reader
must either trust it blind or reconstruct the comparison elsewhere, and
both outcomes indict the surface. The escalation also preserves state:
opening detail from a count lands on the *same pair, level, and
parameters* the count was computed under, or the detail will contradict
the summary that launched it and teach the reader to trust neither.

## One change-kind vocabulary, one direction convention

Added, removed, changed, moved, unchanged, not-compared: one closed
vocabulary, defined once, rendered identically on every comparison
surface in the product ([_laws:
one-authority-per-vocabulary_](../../_laws.md#one-authority-per-vocabulary)).
Every kind gets a glyph or label *in addition to* color — color-only
encoding excludes color-blind readers from the product's entire
comparison layer, and diff surfaces are the single worst offender in most
products because red/green is their tradition.

Direction is a convention, stated once and never varied: the candidate is
read *against* the baseline, additions are candidate-side surplus, and
every surface agrees. The pair technique owns naming the sides; this
technique owns that the visual language never flips. A product where one
surface's green means "new" and another's means "kept" has two diff
languages, and readers fluent in both will still misread the one they
visit less.
