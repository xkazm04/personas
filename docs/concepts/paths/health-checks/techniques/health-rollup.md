---
layer: technique
subject: health-checks
technique: health-rollup
status: forged
laws: [count-carries-predicate, derivation-names-recomputation]
shared_with: []
---

# Health rollup

Nobody reads forty verdicts. The moment a system runs more than a handful of
checks, a summary is demanded — one light, one number, one word — and the
summary is where health reporting either stays honest or becomes theater.
The general mathematics of composite scores (weights, normalization,
banding, thresholds) belongs to the scoring-rubrics subject; what lives here
is the health-specific discipline: what a *health* summary may claim, and
what it must never hide.

## A rollup names its failing members

The first honesty rule, and the one most often broken: **the summary is a
door, not a wall**. "Health: 73" or "Status: degraded" with no path to
*which* checks produced that verdict is a mood ring — it induces anxiety
without enabling action, which is strictly worse than either the detail or
nothing. Every rollup keeps an unbroken drill-down: summary → the members
that dragged it down → each member's verdict, evidence, and remediation
(see [remediation-affordances](remediation-affordances.md)). This is
[count-carries-predicate](../../_laws.md#count-carries-predicate) applied to
health: a number that travels — onto a dashboard, into a notification —
carries what was counted and which members failed, or it will be read as a
claim it does not support.

## Choose the aggregation for the consumer's question

Aggregation functions answer different questions; pick per consumer, not one
for all:

- **Worst-of** answers "may I proceed?" — the gate question. One hard
  failure fails the launch regardless of how healthy the average is;
  ninety-nine greens do not offset the missing runtime. Gates use worst-of,
  always, over the subset of checks they declare as blocking.
- **Weighted composite** answers "how healthy, roughly?" — the trend
  question. Legitimate when members genuinely differ in consequence, and
  only when the weights are stated where the score is shown or one link
  away. A weighted score with private weights is unfalsifiable.
- **Counts by state** ("12 healthy · 2 failed · 3 unknown") answers "what
  is the shape of the problem?" — often the honest middle: more legible
  than forty rows, less lossy than one number.

Severity tiers (critical / degraded / advisory) are a vocabulary and get one
authoritative definition; a member's tier is assigned where the check is
defined, not re-judged by each summary that consumes it.

## The undetermined member is surfaced, never laundered

The rollup inherits the three-state problem in aggregate form (see
[three-state-outcomes](three-state-outcomes.md)), and both collapses recur
here wearing summary clothes:

- counting unverifiable members as failed turns a probe outage into a
  board-wide incident;
- counting them as healthy — or excluding them from the denominator, the
  subtle variant — inflates the score exactly when visibility is lost,
  which is when the score matters most. "9 of 10 passing, 30 unverifiable"
  and "9 of 40 passing" must not render the same.

The honest summary carries the undetermined count *as itself*: "healthy
(3 unverified)" or a score annotated with its coverage. A gate decides
explicitly whether unverifiable blocks (pre-flight for critical work:
usually yes; a glanceable dashboard: no, but shown). Suppressed members
(see [remediation-affordances](remediation-affordances.md)) are likewise
disclosed in the summary, not silently promoted to green.

## A rollup is a derivation, with a timestamp of its own

The composite is computed from member verdicts that each carry an age — so
the rollup's effective age is its **stalest contributing member**, and it
says so ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)):
the summary names how it is recomputed (re-run the members, re-aggregate)
and offers that recomputation wherever it is rendered. A dashboard-level
"refresh" that re-aggregates cached members without re-probing is a
different operation from "re-check everything", and surfaces that conflate
the two produce the confident-but-stale composite — the two-state lie,
promoted to the fleet level.

## Rendering the summary

How the score or status displays — meter, badge, banded color, trend line,
and the accessibility rules for each — is the
[data-viz](../../data-viz/data-viz.md) subject's ground. The health-specific
constraint it must carry: the three states keep distinct encodings all the
way up (unknown is never green's hue or red's), and banded thresholds on a
composite are stated, not implied by color alone.
