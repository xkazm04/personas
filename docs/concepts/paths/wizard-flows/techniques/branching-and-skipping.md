---
layer: technique
subject: wizard-flows
technique: branching-and-skipping
status: forged
laws: [one-authority-per-vocabulary, identity-survives-reuse]
shared_with: []
---

# Branching and skipping

The dependence that justifies a wizard is also its hardest problem: answers
reshape the path. A choice on step two decides whether steps four and five
exist; an edit to step one can falsify everything the user said after it.
Implementations that improvise here produce the wizard's two signature
data bugs — answers from a branch the user turned off riding into the
commit, and a revisit that silently destroys an afternoon of downstream
answers. Both are prevented by the same move: branching is *modeled*, as
declared predicates and declared dependencies, not scattered through
navigation handlers.

## Relevance is a declared predicate

Each conditional step carries a **relevance predicate** over the answers,
declared in the step registry beside the step it governs
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The currently-relevant sequence — what the user walks, what the indicator
counts, what the commit assembles from — is derived by filtering the
registry through the predicates. One authority; navigation, progress, and
commit cannot disagree about which steps exist.

The scattered alternative fails on its second consumer: "next" computes the
follow-on step with an inline conditional, the indicator hard-codes the
full list, the commit reads every answer ever collected — three private
opinions about the path, drifting independently.

Because relevance changes the *positions* of steps, everything keyed by
position corrupts when a branch flips. Step identity is a stable name;
indices are computed at render time from the relevant sequence
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).

## Skipped is not deleted — but it must not be committed

When a branch turns a step off, its already-collected answers pose a
question with two defensible answers and one indefensible one:

- **Retain, excluded** (usually right): keep the answers in the model so a
  user who flips the branch back does not re-type them, but derive the
  commit payload from *relevant steps only*, so retained-but-irrelevant
  data cannot leak into the commitment. Retention is a courtesy to the
  user; exclusion is a correctness rule for the system.
- **Clear on branch change** (sometimes right): when the irrelevant answers
  are sensitive, or their presence in any later surface would mislead,
  clear them — visibly, at the moment of the branch change.
- **Retain and commit anyway** (the bug): the commit reads the raw answer
  map instead of deriving through relevance, and the system of record
  receives configuration for a mode the user switched off. This is the
  wizard's version of committing half-consistent state, and it is the
  default outcome of *not deciding* — which is why the exclusion rule
  belongs in the commit assembler, not in the goodwill of each branch
  handler.

## Revisit semantics: invalidate dependents, precisely

Going back and changing an answer is a supported operation — a wizard that
forbids it has chosen restart as its only edit mechanism, which for a
high-stakes flow means users abandon rather than correct. The question is
what a changed answer does to later ones.

The policy space has two lazy poles and a correct middle:

- **Invalidate nothing** — later answers built on the old value ride into
  the commit. Cheapest to build, silently wrong.
- **Invalidate everything after** — the blast radius punishes edits so
  brutally that users stop making them; the flow is "editable" in
  documentation only.
- **Invalidate the dependents** — the step registry declares which steps'
  answers depend on which; an edit invalidates exactly its transitive
  dependents, marking them *needs attention* rather than erasing them where
  the old answer can still be shown for reconfirmation. Reconfirming a
  still-valid answer is one click; re-entering an erased one is the whole
  step again.

Dependency declarations are the price of the correct middle, and they are
cheap where they matter: most wizards have a handful of load-bearing edges
(the selection that determines what later steps configure), not a dense
graph. Where a true dependency is fine-grained — one field of a later step,
not the whole step — invalidation can be field-level, but step-level is an
honest default.

## Destruction is announced before, not discovered after

When an edit *will* discard or invalidate downstream answers, the flow says
so before applying it — what will be affected, in step names the user
recognizes — and offers the choice. When a branch change *would* clear
retained answers, same rule. The warning is derived from the same
dependency declarations that drive the invalidation, so it can be specific;
a generic "this may affect later steps" on every edit is fatigue in
warning's clothing, and users click through it exactly like any other
un-read gate.

After an invalidation, the progress surface carries the news: formerly
complete steps show *needs attention* (see
[progress-communication](progress-communication.md)), the commit gate
re-closes until they are reconfirmed, and the first invalidated step is one
jump away. Invalidation the user has to hunt for is invalidation that
reaches the review step as a surprise.
