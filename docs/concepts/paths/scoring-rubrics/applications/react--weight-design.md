---
layer: application
subject: scoring-rubrics
technique: weight-design
stack: react
---

# Weight design — three rubric vectors, and the one that asserts its sum

This repo carries several live composites; three show the technique's spectrum
from good to canonical, and one supplies the assertion the others still owe.

## The golden-standard rubric: an explicit, per-cohort vector

`src/features/teams/sub_factory/passport/improve/goldenStandard.ts` opens with
the technique's thesis as a comment — "makes 'golden' an explicit, tunable
spec instead of magic numbers buried in the score weights" — and delivers it:

```ts
export const RUBRIC: RubricDim[] = [
  { key: 'context', label: 'Context coverage', weight: 3,
    pos: (p) => scalePos(GRAPH_SCALE, ...),
    target: { solo: 0.5, team: 1, org: 1 } },
  ...
```

One declaration, thirteen dimensions, weights readable side by side (3 / 2 /
1 — relative importance at a glance). The `target: Record<Archetype, number>`
field is the technique's "per-cohort targets are weights in disguise" rule
implemented correctly: the solo/team/org expectations live *in the same
artifact*, same format, same review path as the weights — not as inline
exceptions at call sites. Several dimensions carry their rationale as a
comment ("Solo gets by on a README; teams need structure; orgs need managed
source→doc coupling"), which is exactly the one-line-per-weight discipline —
though not yet on every row.

`scoreAgainstRubric` computes the total dynamically (`totalW = dims.reduce...`)
rather than trusting a declared sum — a defensible alternative to sum
discipline: with integer importance weights and a computed denominator, the
sum cannot drift, at the cost of the "what does a new dimension displace?"
conversation the fixed budget forces. The pinning tests
(`goldenStandard.test.ts`) hold the vector's *behavior*: a fully instrumented
project scores 100 under every archetype, an empty one is below target on
every weighted dimension, and the solo bar is provably no harder than org.

## The leaderboard: a stated sum, held by convention

`src/features/overview/sub_leaderboard/libs/leaderboardScoring.ts`:

```ts
const WEIGHTS = {
  success: 0.30, health: 0.20, speed: 0.20, cost: 0.20, activity: 0.10,
} as const;
```

The file header states the policy in prose (30/20/20/20/10) and the type
comment says `weight: number; // 0-1 (sums to 1)` — but nothing asserts it.
This is the "wish with a paper trail" the technique warns about: the sum
holds today because nobody has added a sixth dimension yet, and the day
someone does is exactly the day the comment stops being true.

## The assertion the others should copy

`src/features/overview/sub_health/libs/compositeHealthScore.ts` closes that
gap for its own two vectors:

```ts
// Weights (must sum to 1.0 — asserted at module load in dev)
...
  `compositeHealthScore WEIGHTS must sum to 1.0 but sum to ${total}. `
```

A module-load, dev-only check that fails fast when either weight set drifts —
the technique's "sum is stated and asserted" rule as running code. The delta
between this file and `leaderboardScoring.ts` is the whole point: same repo,
same convention, and only the one with the assertion is actually protected.

## What no vector here has yet

None of the three carries a **rubric version**, and none of the stored
composites (golden-%, leaderboard score) stamps the vector that produced it.
Weight edits to `RUBRIC` silently re-score every passport history the next
time it renders — the versioning half of the technique is the open gap, not
the vector half.
