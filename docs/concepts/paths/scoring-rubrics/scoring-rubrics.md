---
layer: golden-path
subject: scoring-rubrics
status: forged
techniques:
  - weight-design
  - normalization
  - unmeasured-honesty
  - gap-ranking
  - rubric-stability
  - score-explanation
evidence:
  - src/features/teams/sub_factory/passport/improve/goldenStandard.ts   # explicit RUBRIC vector, per-archetype targets, breakdown + belowTarget kept for explanation
  - src/features/teams/sub_factory/passport/improve/goldenStandard.test.ts  # pinning tests: full passport = 100 for every archetype, empty = below on every weighted dim, solo bar ≤ org bar
  - src/features/teams/sub_factory/passport/improve/improvePlan.ts      # impact-per-effort ranking: estGoldenLift (weight × gap / total weight) ÷ effort tier
  - src/features/overview/sub_leaderboard/libs/leaderboardScoring.ts    # WEIGHTS summing to 1, cohort-relative inverted normalization, drop-and-renormalize for unmeasured dims (rationale on the line)
  - src/features/overview/sub_health/libs/compositeHealthScore.ts       # the weight-sum assertion at module load — "must sum to 1.0" as code, not comment
  - src/features/teams/sub_kpis/kpiMath.ts                              # 'unmeasured' as a first-class verdict state; declared mirror of the engine-side twin
  - src-tauri/src/engine/kpi_derivation.rs                              # the other half of that twin — comment-coupled, separate test suites, no shared-fixture parity gate
  - src/features/plugins/twin/shared/readinessGaps.ts                   # severity-first gap ordering with a stable tie-break toward foundations; gapScoreDelta names the lift
  - src/features/plugins/dev-tools/sub_lifecycle/competitions/qualityScore.ts  # per-gate breakdown whose parts visibly sum to the total (25+30+20+15+10)
counter_evidence:
  - src/features/vault/shared/utils/credentialHealthScore.ts            # three answers to "source said nothing" (50/100/100) sixteen lines apart in one weighted sum — 60% of the composite pays full marks for silence
deviations:
  - w5-scoring-rubrics   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w3-data-viz   # kpiMath ↔ kpi_derivation cross-language twin has no shared-fixture parity gate — registered in golden-path-deferred-fixes.md
---

# Scoring rubrics & composite indices

A composite score is a **decision instrument**: many heterogeneous signals
reduced to one comparable, explainable number so that a person (or an
automated policy) can rank options and pick the next action. That purpose is
the whole design contract. A score that ranks nothing — that no gate reads,
no sort key consumes, no "do this next" derives from — is decoration wearing
the costume of measurement, and decoration that *looks* like measurement is
worse than none, because readers extend it the trust owed to instruments.
The first question for any proposed score is therefore not "what should the
weights be" but **"which decision changes when this number changes?"** If the
honest answer is "none", delete the number and show the underlying signals
directly; a small table of facts beats a fabricated summary of them.

The subject sits between two neighbors whose boundaries are already drawn.
[Health checks](../health-checks/health-checks.md) own the *health* summary —
what a fleet-of-probes rollup may claim, which aggregation answers which
consumer question — and its
[health-rollup](../health-checks/techniques/health-rollup.md) technique
explicitly defers the composite mathematics (weights, normalization, banding)
to this subject; that hand-off is honored here in full. On the other side,
[charts & data visualization](../data-viz/data-viz.md) owns the *identity and
display* of any number that travels — one derivation per named metric, parity
gates where two runtimes must both compute it
([metric-identity](../data-viz/techniques/metric-identity.md)), and the
honesty rules of the pixels that render it. This subject owns what happens in
between: how many true numbers become one true number.

## A score is a claim with named parts

Every composite decomposes into the same four decisions, and each is a place
to be honest or to smuggle in a lie:

1. **Which signals participate** — the dimension set. Leaving a dimension out
   is a judgment; the rubric states its dimensions so the omission is
   visible, not discovered.
2. **How each signal becomes comparable** — normalization. Raw signals arrive
   in incompatible units, opposite polarities, and wildly different ranges;
   the mapping into a common scale is where most composite lies are born,
   because a plausible-looking mapping can silently decide the ranking before
   any weight is applied. This is the hardest honest step, and it gets its
   own discipline: [normalization](techniques/normalization.md).
3. **How much each signal matters** — the weight vector. Weights are policy,
   not arithmetic: each one is a claim that dimension A matters twice what
   dimension B does, and claims need owners, rationales, and version history.
   The vector is an explicit, owned artifact —
   [weight-design](techniques/weight-design.md).
4. **What the number means to the reader** — banding, breakdown, and the
   derived next action. A score that cannot explain itself breeds two
   pathologies at once: distrust from readers who cannot audit it, and gaming
   from actors who optimize the number instead of the thing. The breakdown
   ships with the composite, always —
   [score-explanation](techniques/score-explanation.md).

## Unmeasured is never zero

The most common composite defect, in both of its mirror forms: a signal that
was not measured enters the arithmetic as **zero**, and the average quietly
punishes absence as failure — or the dimension is scored as a **penalty
subtracted from a ceiling**, and absence, delivering no bad news, quietly
collects full marks. The second form is subtler and often worse: a composite
dominated by penalty-shaped dimensions reports "fine" precisely when its
instruments have gone silent. Zero is a measurement — "we looked, and there
was nothing". Missing is a different fact — "we did not look", or "we looked
and could not tell". A composite that conflates them, in either direction,
fabricates a verdict exactly where it has the least evidence, and it does so
invisibly, because the output is still a well-formed number. A score must be
able to say "I don't know", or it will say "fine". The discipline — null propagation rules, coverage
disclosed beside every score, refusal to rank entities below a coverage
floor — is [unmeasured-honesty](techniques/unmeasured-honesty.md). It is the
same law that governs a gap in a plotted line and an unverifiable member in a
health rollup, applied at the point where the arithmetic would otherwise
launder the gap away.

## The score's output is an ordering of actions

Because the score exists to rank actions, the terminal artifact is rarely the
number itself — it is the **ordered list of gaps**: which dimension, closed
next, buys the most improvement for the least effort. Impact-per-effort
ordering, severity weighting, and deterministic tie-breaks (a re-run over
unchanged inputs must produce the same order, or the instrument itself
generates churn) live in [gap-ranking](techniques/gap-ranking.md). The
ranked gaps typically feed an operator's work queue — the
[triage queue](../triage-queues/triage-queues.md) discipline governs what
happens after the ranking leaves this subject.

## A rubric is a contract, and contracts are pinned

The moment a score is stored, compared over time, or computed in two places,
the rubric stops being an implementation detail and becomes an interface.
Historical scores are only interpretable if the rubric that produced them is
recoverable; twin implementations (a backend aggregating, a frontend
previewing) only stay twins under a parity gate over shared fixtures; and a
"small tweak" to a weight or a normalization anchor silently re-scores every
stored history unless versions say otherwise. Golden fixtures, pinning tests,
and cross-implementation parity are [rubric-stability](techniques/rubric-stability.md).

## What good looks like, compressed

- The score names the decision it drives, and someone can point at the gate,
  sort, or recommendation that consumes it.
- The weight vector is a checked-in artifact: weights sum to a stated total,
  each carries a one-line rationale, and changes are versioned events.
- Every rendered composite is one interaction away from its per-dimension
  breakdown, and the breakdown names the top gap as an action, not a number.
- A missing signal surfaces as missing — in the breakdown, in the coverage
  disclosure, and in the arithmetic (excluded and renormalized, never zeroed).
- Normalization declares its reference frame: what maps to the floor, what
  maps to the ceiling, and whether the frame is the cohort's current spread
  (comparison) or a fixed anchor (tracking).
- The rubric has fixtures: known inputs with hand-verified outputs, run as a
  gate wherever the rubric is implemented.

## The techniques

- [weight-design](techniques/weight-design.md) — the weight vector as an
  explicit owned artifact: sum discipline, per-dimension rationale,
  versioned changes, sensitivity checks.
- [normalization](techniques/normalization.md) — incomparable units into one
  scale: polarity inversion, clamping, cohort-relative vs fixed anchors, and
  which reference frame serves which question.
- [unmeasured-honesty](techniques/unmeasured-honesty.md) — missing is not
  zero: null propagation, coverage disclosure, the coverage floor below
  which ranking is refused.
- [gap-ranking](techniques/gap-ranking.md) — from score to next action:
  impact-per-effort ordering, severity weighting, stable tie-breaks.
- [rubric-stability](techniques/rubric-stability.md) — pinning the contract:
  golden fixtures, parity gates across twin implementations, rubric
  versioning so history stays interpretable.
- [score-explanation](techniques/score-explanation.md) — the breakdown
  rendering contract and the derived next action; explanation as the
  structural defense against gaming and distrust.
