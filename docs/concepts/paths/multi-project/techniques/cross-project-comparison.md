---
layer: technique
subject: multi-project
technique: cross-project-comparison
status: forged
laws: [count-carries-predicate, one-authority-per-vocabulary, identity-survives-reuse]
shared_with: []
---

# Cross-project comparison

A portfolio that can show N projects will be asked to rank them — for
attention, for investment, for pride — and ranking heterogeneous projects on
raw measures is confidently wrong: every raw number (files, commits, tests,
issues) varies with stack, age, and size before it varies with anything the
ranking is *for*. Comparison is therefore a construction, and the machinery
for building it soundly is owned by
[scoring-rubrics](../../scoring-rubrics/scoring-rubrics.md) — weights,
[normalization](../../scoring-rubrics/techniques/normalization.md),
[unmeasured-honesty](../../scoring-rubrics/techniques/unmeasured-honesty.md),
explanation. This technique owns what changes when the things being scored
are whole projects: the shared dimension set, the anchor policy, and the
comparison surface itself.

## One dimension set, defined at portfolio scope

Cross-project comparison exists only if every project is measured on **the
same dimensions, defined once, at portfolio scope**
([one authority per vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The moment one project carries "deployment readiness" and another carries
"release maturity" — same idea, different local vocabularies — the
comparison surface is joining synonyms by hope. Dimensions therefore live in
a portfolio-level registry (name, definition, measurement procedure, scale),
and each project holds *scores against* that registry, never private
dimension definitions of its own.

Heterogeneity is handled inside the measurement, not by forking dimensions:
"test discipline" is one dimension whose measurement procedure may branch by
stack, not three stack-flavored dimensions. Where a dimension genuinely
cannot apply to a class of project, it is recorded **not-applicable** for
those projects — a third verdict distinct from both a low score and
unmeasured — and composites exclude it with the same honesty they owe
unmeasured dimensions.

## Fleet-relative or fixed anchors — decide per dimension, then say so

Every normalized score answers "compared to what," and portfolios have
exactly two coherent answers:

- **Fleet-relative** — graded against the current cohort (rank,
  percentile, distance from the fleet median). Suits **triage**: "which of
  my projects is weakest" is a relative question. Its cost: scores move
  when *other* projects move; a project can decay in rank while improving
  in fact; and the semantics degrade at small N — a percentile among four
  projects is mostly noise wearing a uniform.
- **Fixed anchors** — graded against absolute standards ("a project at 80
  has automated releases and a monitored error budget"). Suits **progress**:
  the number holds meaning across time, survives cohort churn, and can be
  promised to someone. Its cost: anchors need authoring and periodic
  recalibration, and a fleet can be uniformly far from them, which is
  honest but demoralizing.

The technique's demand is not one choice — it is that the choice is made
**per dimension, recorded in the dimension registry, and rendered with the
score**. The defect it forbids is mixing silently: a composite that blends
fleet-relative and fixed-anchor components produces a number that is neither
comparable across time nor across projects, and no reader can tell. A score
that travels — into a wall card, a review, a plan — carries its anchor
policy the way any count carries its predicate
([count carries its predicate](../../_laws.md#count-carries-predicate)).
Where both views are wanted (they usually are), show two labelled numbers;
never average them.

Portfolios also amplify a hazard the rubric machinery already knows:
**changing the shared rubric steps every project's composite at once**, and
score history renders that step as if the whole fleet moved on the same
day. The [rubric-stability](../../scoring-rubrics/techniques/rubric-stability.md)
discipline therefore applies with interest here — introduce a new dimension
*visible but unweighted* first, then fold it into composites in a change
that says so, or the portfolio's trend lines become a record of rubric
edits wearing the costume of progress.

## Unmeasured honesty, amplified by admission

Portfolios permanently contain projects at different measurement depths —
yesterday's admission has no scores, a dormant project has stale ones. The
[unmeasured-honesty](../../scoring-rubrics/techniques/unmeasured-honesty.md)
rules apply unchanged (unmeasured is a verdict, never zero-filled into a
composite), with two portfolio-specific corollaries. **Coverage is a
comparison precondition:** a ranking rendered over projects with 100%, 60%,
and 10% dimension coverage is not one ranking but three guesses; the surface
states each project's coverage and visibly separates fully-scored members
from partially-scored ones rather than interleaving them as if commensurate.
**Staleness is per-project:** each score carries its measured-when, and a
comparison between a fresh score and a quarter-old one says so — projects
age at different rates, and the portfolio surface is where that asymmetry
becomes visible.

## The comparison surface

The output shape that earns trust is a **matrix — projects × dimensions —
with drill-through**: cells carry the normalized verdict plus its recency;
rows carry coverage and the composite (with its anchor policy); every cell
opens to the evidence behind it, because a comparison nobody can interrogate
becomes politics. Ranking views derive from the same scored data, joined by
minted project key end to end
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)) — a
comparison table that matches scores to projects by display name will
eventually compare one project against its own former name, the join defect
this subject exists to kill. And gaps ranked across the portfolio ("which
single dimension of which project is the highest-leverage fix this week")
reuse [gap-ranking](../../scoring-rubrics/techniques/gap-ranking.md) with
the project as one more grouping key.

One ranking is portfolio-native and easy to miss: **the divergence between
two composites on the same project.** A project scoring high on operational
maturity but low on automation readiness (or the reverse) is often more
actionable than any project that is uniformly weak — the divergence names
*which kind* of investment the project can absorb right now. A portfolio
wall that can sort by largest axis gap turns two rubrics into a third
instrument neither provides alone; the same predicate rule applies (the
sort names which axes, which anchor policies).
