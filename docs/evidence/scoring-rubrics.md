---
subject: scoring-rubrics
evidence:
  - src/features/teams/sub_factory/passport/improve/goldenStandard.ts   # explicit RUBRIC vector, per-archetype targets, breakdown + belowTarget kept for explanation
  - src/features/teams/sub_factory/passport/improve/goldenStandard.test.ts  # pinning tests: full passport = 100 for every archetype, empty = below on every weighted dim, solo bar ≤ org bar
  - src/features/teams/sub_factory/passport/improve/improvePlan.ts      # impact-per-effort ranking: estGoldenLift (weight × gap / total weight) ÷ effort tier
  - src/features/overview/sub_leaderboard/libs/leaderboardScoring.ts    # WEIGHTS summing to 1, cohort-relative inverted normalization, drop-and-renormalize for unmeasured dims (rationale on the line)
  - src/features/overview/sub_health/libs/compositeHealthScore.ts       # the weight-sum assertion at module load — "must sum to 1.0" as code, not comment
  - src/features/teams/sub_kpis/kpiMath.ts                              # 'unmeasured' as a first-class verdict state; declared mirror of the engine-side twin
  - src-tauri/src/engine/kpi_derivation.rs                              # the other half of that twin — comment-coupled, separate test suites, no shared-fixture parity gate
counter_evidence:
  - src/features/vault/shared/utils/credentialHealthScore.ts            # three answers to "source said nothing" (50/100/100) sixteen lines apart in one weighted sum — 60% of the composite pays full marks for silence
deviations:
  - w5-scoring-rubrics   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w3-data-viz   # kpiMath ↔ kpi_derivation cross-language twin has no shared-fixture parity gate — registered in golden-path-deferred-fixes.md
---

# Scoring Rubrics - evidence

How this codebase measures against the [`scoring-rubrics`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
