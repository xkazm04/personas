---
layer: technique
subject: diff-comparison
technique: pair-and-baseline-selection
status: forged
laws: [identity-survives-reuse, count-carries-predicate]
shared_with: []
---

# Pair & baseline selection

Every diff has a hidden third input: **who chose the pair, and why**. The
two visible inputs are states; the invisible one is the question — and the
baseline *is* the question. "This run compared with the previous run" asks
"did we just regress?"; the same run compared with the promoted version
asks "is this ready to replace what ships?"; compared with a sibling
candidate it asks "which direction should we take?". A surface that swaps
baselines without saying so swaps questions without asking — the reader
receives correct differences that answer something they never asked, which
is worse than an error because it is indistinguishable from the answer they
wanted.

## The baseline species

Each species answers a different question, and a comparison surface should
know which one it is serving:

- **Temporal** — the previous state of the same entity. Question: *what
  just changed?* The default for history browsing and audit.
- **Lifecycle** — the promoted/active/production state. Question: *what
  would shipping this change?* The default for review-before-promotion;
  which state holds that role is the versioning subject's single active
  pointer, consumed here, never re-derived here.
- **Ancestral** — the common ancestor of two concurrent lines. Question:
  *who changed what, relative to the point we agreed on?* Two concurrent
  edits diffed pairwise cannot distinguish "A changed it" from "B changed
  it" — only the three-way diff against the ancestor recovers authorship
  of each difference. This is the shape the sync subject's conflict
  handling consumes.
- **Declared** — an expectation, contract, or manifest. Question: *does
  reality match the promise?* A distinct species with its own technique
  (drift-against-declared), because the left side is not a state that ever
  existed — it is an intention.
- **Sibling** — another candidate for the same slot. Question: *how do the
  alternatives differ?* The descriptive half of an arena; the judging half
  belongs to the eval subject.

## The pair is displayed, and the sides are named by role

The surface states what is compared against what — as content, not
tooltip-depth trivia: identities and versions of both sides, visible
before any difference is read. And the two sides carry **role names** —
baseline/candidate, declared/actual, mine/theirs — not positional ones.
"Left" and "right" are facts about the monitor; roles are facts about the
question. Direction follows from role: additions are things the candidate
has that the baseline lacks, and that convention holds across every
comparison surface in the product, because a reader who has to re-derive
the sign of each surface will eventually get one backwards — and a
backwards diff is perfectly plausible-looking misinformation.

## Identity across the pair

Pairing two states of "the same entity" presumes the entity has an
identity that survived the interval — minted once, carried through rename,
reorder, and restore ([_laws:
identity-survives-reuse_](../../_laws.md#identity-survives-reuse)). The
degenerate failure is positional pairing: comparing "the third item then"
with "the third item now" silently compares different entities after one
insertion, and every cell of the resulting diff is a lie with correct
formatting. The same law applies inside collections (list alignment by
key, owned by semantic-level-selection) and at the top: a comparison
surface keyed by display position is destroyed by its first re-sort.

Two degenerate pairs deserve explicit guards rather than accidental
rendering. **Self-comparison** — the pair (X, X), usually the residue of a
defaulting bug — produces an empty diff indistinguishable from "no
changes"; detect it and label it ("comparing a version with itself"), never
render it as a finding. **Cross-entity comparison** — two states that do
not share an identity — is sometimes legitimate (comparing two different
entities' configurations is a real task) but must be *labeled* as
cross-entity, because "changed" language presumes continuity that is not
there; the honest vocabulary for a cross-entity pair is "differs", not
"changed".

## A baseline is chosen by the question, never by the data

The subtlest failure in this technique is a baseline picked by a property
of the *results*: whichever candidate produced the longer output,
whichever comparison happened to be non-empty, whichever version exists.
Measured example: a surface with two legitimate baselines (committed
branch tip, uncommitted working state) computed both diffs and displayed
whichever *string was longer in bytes*. Two semantically different answers
to "what changed", selected by length — and the reader saw one of them
with no marker of which. A baseline selected by the data is not selected;
it is an accident dressed as a decision, and it flips silently as the data
moves. When two baselines are both legitimate, either the surface offers
the choice with the roles named, or the default is fixed by the question
and the other is one action away.

## The default has an owner, and the choice is remembered

Most readers never change the baseline, so the default *is* the product
decision. It is chosen per surface from the audience's dominant question
(review surfaces default to lifecycle; history surfaces default to
temporal), recorded as a decision, and displayed even when defaulted —
"compared with previous version" costs one line and prevents the silent
wrong-question failure entirely.

When the reader does re-choose, the choice persists for the context in
which it was made — an operator triaging a batch against a specific
baseline should not re-pick it for every item. But persistence has a decay
rule: a remembered baseline that no longer exists (pruned, retired) falls
back to the default *loudly*, because silently substituting a different
baseline is the swap-the-question failure again, this time performed by
the memory feature.

## Aggregates inherit the pair

When comparisons roll up — "12 entities changed since the baseline" — the
count's predicate includes the pair selection: *which* baseline, chosen
*how*, at *what* level ([_laws:
count-carries-predicate_](../../_laws.md#count-carries-predicate)). A
rollup that mixes per-entity baselines (some compared to previous, some to
promoted, whichever existed) is not a count of anything; it is several
questions' answers added together. Either normalize the baseline across
the set before counting, or partition the count by baseline species and
say so.
