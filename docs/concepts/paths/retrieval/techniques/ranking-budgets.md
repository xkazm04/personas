---
layer: technique
subject: retrieval
technique: ranking-budgets
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Ranking budgets

Retrieval spends someone else's scarce resource: rows in a pane the user will
actually scan, tokens in a context window that costs attention on every
call. The budget is the contract with that consumer — how much retrieval may
hand over, measured in the consumer's units — and how it is allocated across
lanes decides whether the slice is the best available or merely full.

## Quotas waste what budgets allocate

The intuitive allocation is per-lane quotas: five lexical seats, five
semantic, three recent. Quotas are attractive because they make each lane's
contribution predictable — and wrong for the same reason, twice over:

- **Dry-lane waste.** When a lane has two genuinely relevant candidates, its
  quota pads the slice with its third-through-fifth best regardless. The
  seats are spent, the slice is full, and nothing flags that a third of it is
  filler — full-but-mediocre is invisible in every operational metric.
- **Rich-lane starvation.** When one lane holds the eight best answers, its
  quota caps it at five and hands three seats to lanes carrying weaker
  candidates. The consumer never learns what was withheld.

Both defects come from deciding the allocation *before seeing the
candidates*. A **shared budget** decides after: every lane contributes what
it honestly has (post-[floor](relevance-floors.md)), fusion produces one
order, and the budget is cut once at the end. Seats flow to relevance
wherever it lives, query by query — a quota is a prior; a budget cut is a
posterior.

The legitimate exceptions are **tier minimums, not lane quotas**: the
always-include tier is guaranteed presence because its value is
non-comparable with scored candidates, and a small recency bridge may be
reserved because recency is a deliberately different axis than relevance
(the same reasoning
[recall-injection](../../agent-memory/techniques/recall-injection.md) applies
to its three memory tiers). Reserve for *kinds of value the ranking cannot
express* — never as a fairness scheme between lanes competing on the same
axis.

## Overfetch, then select

A shared budget only works if lanes bring more candidates than their eventual
share — otherwise the cut has nothing to choose between and the "budget"
degenerates back into whatever each lane happened to fetch. Each lane
retrieves a multiple of the plausible final slice (small multiples suffice;
the gain flattens fast), then fusion, dedup, and the cut select down. The
overfetch also pre-funds attrition the lane cannot foresee: candidates lost
to cross-lane dedup, to floors applied after fetch, and to consumer-side
filters (permissions, scope) that run between retrieval and presentation.
Sizing the overfetch factor is an eval question, not a taste question —
measured by how often the final slice would have changed had the factor been
larger.

## Budget in the consumer's units

A budget denominated in items is honest only while items are the same size.
When they vary — chunks of different lengths packed into a context window —
"top ten items" can be a tenth of the window or three times it. The budget
must be denominated in what the consumer actually spends (tokens, characters,
rows of fixed height), and the cut packs by value density, not count:
walk the fused order, admit each item whose cost fits the remaining budget,
and account for every admission. Two disciplines at the cut line:

- **Truncate items only at honest seams.** A chunk half-included to squeeze
  under the line is a new, worse chunk — the boundary damage
  [chunking-and-indexing](chunking-and-indexing.md) worked to avoid,
  reintroduced at the last stage. Prefer dropping the item; truncate only at
  a structural seam, labeled as truncated.
- **The cut reports itself**, per
  [count-carries-predicate](../../_laws.md#count-carries-predicate): "12 of
  31 candidates admitted, cut by token budget" is a slice the consumer can
  reason about; a bare twelve results teaches the false lesson that twelve
  was all there was. What was excluded, and why, is part of the result.

## Marginal value: the tenth near-duplicate is worth nothing

Rank-ordered admission has a blind spot: relevance scores are computed
per-item, but the budget's return is measured over the *set*. Five chunks
saying the same thing score identically and are worth one seat, not five —
each admission's value is conditional on what is already admitted. Past
dedup-by-identity (fusion's job), the cut can apply diversity pressure:
penalize candidates too similar to already-admitted ones, or cap admissions
per source. This matters most for context-packing consumers, where redundant
admissions don't just waste seats but actively dilute the consumer's
attention over the informative ones — the reason the memory subject prefers
fewer, stronger items over more, weaker ones. Like every knob in this stage,
diversity pressure is tuned by
[measurement](retrieval-evaluation.md), not by feel: it trades recall of
corroborating evidence for coverage, and which side of that trade is right is
a property of the consumer, not of the corpus.
