---
layer: application
subject: scoring-rubrics
technique: gap-ranking
stack: react
---

# Gap ranking — the improve plan's impact-per-effort and the twin's foundation tie-break

Two independent gap rankers in this repo implement complementary halves of
the technique; together they cover almost the whole contract.

## Impact per effort, in rubric space

`src/features/teams/sub_factory/passport/improve/improvePlan.ts` turns every
below-target rubric dimension across the whole project fleet into a ranked
`PlanItem`:

```ts
const estGoldenLift = Math.round((weight * (1 - dim.progress) / SUM_W) * 100);
...
estGoldenLift, priority: estGoldenLift / (map.tier + 1), action, passport: p,
```

This is the technique's impact computation done in the right space: the lift
is *distance-to-target × the dimension's rubric weight, over total weight* —
composite points, not raw units — so a small shortfall on a weight-3
dimension can legitimately outrank a chasm on a weight-1 dimension. Effort is
the coarse ordinal the technique recommends (`tier`: 0 config · 1 scan · 2
connector · 3 full deploy, declared in the `DIM_ACTION` map beside the kind
of lever that closes each gap), and the ranking key is exactly the quotient:
`priority = estGoldenLift / (tier + 1)`. Each gap is a computed object
carrying dimension, lift, tier, and — where one exists — the one-click
`action`, so the top row *is* the next action ("what's the single best thing
to do next, across all my apps?", per the file's own header). Items whose
gap has no available lever are dropped rather than ranked as unactionable
nouns — the technique's "if you cannot phrase it as an action, don't ship
the noun" rule, enforced structurally.

The gap: the final `items.sort((a, b) => b.priority - a.priority)` has no
deterministic tie-break chain. Equal priorities fall back to engine-stable
insertion order (project iteration order × rubric declaration order), which
is reproducible for a fixed input list but reshuffles if the fleet's
iteration order changes — the technique wants the chain to end in a stable
identity (`projectId`, `dimKey`), which both exist on the item.

## Severity first, then a stable lean toward foundations

`src/features/plugins/twin/shared/readinessGaps.ts` is the other half —
small, but the ordering contract is complete and documented in its header:

```ts
// Empty (severity 1) before partial (severity 0); tie-break by foundation priority.
return out.sort((a, b) => (b.severity - a.severity) || (a.priority - b.priority));
```

Severity is a declared override sitting above the quotient (an empty
milestone outranks any partial one), and the tie-break is the technique's
prerequisite-structure rule verbatim: the static `priority` ranks
foundations first (identity → tone → brain → channels → memories), so the
recommended sequence is buildable, not just individually attractive. The
comparator is total and stable — same readiness, same list, every run.
`gapScoreDelta` names each gap's lift in score points ("+20% / +10%"), and
the same ranked list feeds both the score-badge popover and the hero "next
step" nudge, so the badge and the nudge can never disagree about what to do
next — one ranking, two renderings.

## Read together

`improvePlan` has the economics (impact-per-effort in rubric space) but an
incomplete tie-break; `readinessGaps` has the deterministic ordering and
severity/foundation structure but a fixed effort model (every milestone
costs the same). A new gap ranker in this repo should take the quotient from
the first file and the comparator discipline from the second.
