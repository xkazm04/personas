---
layer: golden-path
subject: eval-harness
status: forged
techniques:
  - scenario-design
  - assertion-vs-judgment
  - judge-stability
  - comparison-modes
  - eval-economics
  - certification-levels
evidence:
  - src-tauri/engine/src/test_runner/       # the canonical manifestation: deliberately-scoped scenario cache key (excludes prompt text — UAT 2026-07-20 exam-drift incident at :57-74), LAB_CELL_CONCURRENCY=4 fan-out semaphore, pinned LAB_MODEL, never-cache-empty guard (:412-415), one run_lab_loop behind arena/A-B/eval/matrix/consensus modes
  - src-tauri/engine/src/output_assertions.rs # the deterministic band (contains/regex/json-path/json-schema) + evaluate_assertions_dry: challenger scoring writes no evidence rows
  - src/features/agents/sub_lab/libs/evalAggregation.ts # version×model grid, null scores excluded from averages, composite formula pinned by a golden test, declared winner = top of pre-declared sort
  - src/stores/slices/agents/labSlice.ts      # LabMode = arena|ab|matrix|eval|versions|breed|evolve|regression; per-mode run lifecycles
  - src-tauri/db/src/quality_gate.rs          # deterministic content gate (reject/tag/warn) over model submissions, config not code
  - evals/README.md                           # the golden-set tier: deterministic contract evals over agent specs/prompt builders, wired pre-push
  - vitest.evals.config.ts                    # the cheap tier runs inside the deterministic lane's own runner
  - scripts/test/judge-packet.mjs             # per-run judge packet: everything the judge reads, assembled reproducibly into one artifact
  - scripts/test/athena-model-bench.mjs       # model×effort matrix cells, reps per cell, deterministic validator first — LLM judge deliberately deferred
  - uat/README.md                             # L1 theoretical (code-derived surface) gating L2 empirical (live harness); "verification vs evaluation" stated at the top
  - docs/development/model-effort-guide.md    # judge disagreement ρ=0.50, own-family-first bias, effort inversion on design work, the descoped arm
counter_evidence: []
deviations:
  - w8-eval-harness   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Evaluation & benchmarking

An eval harness runs agents or models against declared scenarios and scores
the results — repeatably. The last word is the whole subject. Anyone can run
a model once and form an opinion; an eval harness exists so that the same
question, asked next month against a new version, produces an answer that is
*comparable* to this month's. Everything in this standard — pinned inputs,
versioned scenarios, pinned judges, declared aggregation — is in service of
comparability across time, because an eval whose numbers cannot be compared
across versions measures nothing except the mood of the run.

The subject boundary, stated up front. The
[test-harness](../test-harness/test-harness.md) subject owns deterministic
suite machinery — lanes, fixtures, isolation, scheduling — and explicitly
defers the non-deterministic lane to this subject: what changes when the
system under test does not return the same output twice. Composite score
arithmetic — weights, normalization, gap ranking — belongs to
[scoring-rubrics](../scoring-rubrics/scoring-rubrics.md); this subject decides
*what gets scored and how the measurement stays honest*, then hands the
numbers over. Pulling a machine-readable verdict out of a judge's prose is the
[structured-output](../structured-output/structured-output.md) subject's
extraction problem; this subject only insists the verdict channel exists.

## Non-determinism changes the contract

A deterministic test asserts a fact: given this input, that output, pass or
fail. A non-deterministic system voids that contract. The same scenario, run
twice, produces different outputs — sometimes cosmetically different,
sometimes different in the property being measured. Three consequences
follow, and each one restructures the harness:

**Pass/fail becomes a distribution.** The honest result of an eval is not "it
passed" but "it passed k of N runs under these conditions." A single run
proves nothing in either direction: one success is compatible with a 20%
success rate, one failure with 95%. The harness therefore runs each cell N
times with N *declared* — and the aggregation (mean, median, worst-of-N,
pass-rate against a threshold) declared alongside it, because a score that
travels without its aggregation rule will be compared against a score
computed differently
([_laws: count-carries-predicate_](../_laws.md#count-carries-predicate)).

**Repeatability is engineered, not assumed.** Whatever *can* be pinned, is:
input fixtures frozen, sampling seeds fixed where the platform honors them,
temperature and generation parameters recorded in the run artifact.
Whatever cannot be pinned is *surrounded* — repeated trials, declared
aggregation, and variance reported next to the mean. The residual
non-determinism is stated, not hidden: a harness that silently averages away
variance is telling you the system is more stable than it is.

**Flakiness stops being noise and becomes signal.** In a deterministic suite,
intermittent failure indicates a defect in the test or the harness. Here,
variance across identical runs *is a measurement* — of the system's
stability under the scenario. The harness records it as a first-class output
rather than retrying until green.

## The judge is inside the system under measurement

Where a property cannot be asserted mechanically, a model judges another
model's output — and the moment that happens, the judge is a component of the
instrument, with all the obligations instruments carry. An unpinned judge
makes every score incomparable across time: when the judge silently upgrades,
scores shift with no change in the system under test, and the trend line —
the most valuable artifact the harness produces — becomes fiction.

So the judge is **pinned** (model, version, parameters, rubric, exemplars —
the whole packet), its **drift is measured** rather than assumed away
(re-score a frozen anchor set on a schedule; movement in anchor scores is
judge drift by construction, since the anchors did not change), and its
**biases are treated as known systematics**: judges disagree with each other
far more than their confident tone suggests, and they measurably prefer
outputs from their own model family. A verdict from a single judge of the
same family as the candidate is a conflict of interest wearing a lab coat.
The full discipline is [judge-stability](techniques/judge-stability.md).

And one bias belongs in the golden path itself because it is about *you*,
not the judge: **confidence is weak evidence — the judge's and yours.** A
judge will score work highly while its own reasoning log contains
unsubstantiated claims against it. A green verification gate that asserts
data round-tripped is not a gate on behavior: it confirms numbers landed in
an artifact, not that the artifact means anything
([_laws: gate-sees-target_](../_laws.md#gate-sees-target)). The corrective
is unglamorous and non-negotiable — a human, or at minimum a different
instrument, periodically observes the *actual outputs* the scores summarize.
Every mature eval practice converges on the same ritual: read the transcripts.

## Scenarios are versioned fixtures

A scenario — the input, the context, the expected-property declaration — is a
fixture with an identity, and that identity must survive everything the
harness does to it: reordering, reuse across suites, regeneration
([_laws: identity-survives-reuse_](../_laws.md#identity-survives-reuse)).
Scores attach to scenario identities; a scenario that silently changes
under a stable name poisons every historical comparison made through it.

Scenarios come from two sources with opposite failure modes. **Captured
reality** — real transcripts, real defect reports, real inputs that once
broke production — is representative by construction but accumulates slowly
and clusters around what already went wrong. **Generation** — a model
synthesizing scenarios from a specification — scales coverage cheaply but
inherits the generator's blind spots and adds a second source of
non-determinism. The mature harness uses both, and treats generated
scenarios with a specific discipline: they are **cached, and the cache key
is deliberately scoped**. The key includes what defines the scenario's
identity — the specification, the generator's version, the seed — and
*deliberately excludes* the candidate-specific material the scenario will be
run against. That exclusion is the point: when the system under test changes
version, the scenarios stay fixed, so the version delta is measured against
a constant instrument instead of a regenerated one. A cache key that
accidentally includes candidate material regenerates the exam whenever the
student changes — every comparison silently becomes apples to oranges. The
key's scope, and what invalidates it, is written down where the cache lives
([_laws: derivation-names-recomputation_](../_laws.md#derivation-names-recomputation)).
Full treatment in [scenario-design](techniques/scenario-design.md).

## Assert what you can, judge only what you must

Between "exact string match" and "ask a judge" lies a wide band of
deterministic assertions — schema validity, required and forbidden content,
bounds, invariants over extracted fields — and every property that can live
in that band, should. Deterministic assertions are free to run, immune to
judge drift, and their failures are self-explanatory. The judge is reserved
for properties that genuinely resist mechanization: tone, faithfulness,
helpfulness, quality-against-a-rubric. The layering — assertions as a cheap
outer gate, judgment inside it, and a structured verdict channel so scores
are machine-readable — is [assertion-vs-judgment](techniques/assertion-vs-judgment.md).

The comparison *shape* is a separate decision: absolute scoring against a
rubric, pairwise arenas producing win-rates, or full matrix runs across
model × variant × scenario. Each answers a different question and each has
a characteristic way of lying; [comparison-modes](techniques/comparison-modes.md)
carries the decision table.

## Certification has levels

Expensive empirical evaluation is gated behind cheap theoretical passes. The
first level reasons over a *derived model* of the system — its declared
surface, its wiring, its contracts — and is cheap enough to run broadly and
in parallel; the second level drives the *live system* and observes actual
behavior, at real cost, serially where the product demands it. The levels
are ordered by the same logic as any fidelity ladder: catch what a static
pass can see before paying for the empirical run, but never mistake the
first level for the second — only the live level observes behavior, and a
candidate certified theoretically has been certified against a proxy
([_laws: gate-sees-target_](../_laws.md#gate-sees-target)). Promotion
criteria between levels are declared, not vibes-based; the design is
[certification-levels](techniques/certification-levels.md).

## Eval spend is budgeted, because a stopped eval is worse than none

Every cell in the eval matrix costs real money and real minutes, and the
matrix grows multiplicatively — models × variants × scenarios × N trials.
Left unmanaged, the suite's cost curve crosses the team's patience curve,
someone stops running it, and the organization keeps *citing* results that
are no longer being produced. A stale eval is worse than no eval: it
manufactures confidence with no instrument behind it
([_laws: failure-not-empty-success_](../_laws.md#failure-not-empty-success)
at suite granularity — "we have evals" must be distinguishable from "we ran
them").

The controls are structural, not disciplinary: **mock execution modes** so
the harness's own logic is testable at zero model cost, **caches with
declared lifetimes** so repeated runs reuse expensive intermediates,
**fan-out caps** so a matrix run cannot stampede a rate limit or a budget,
and a **cadence tiered by cost** — the cheap golden set on every change, the
full matrix on a schedule, the live certification on demand. The economics
are a design input, not an afterthought: [eval-economics](techniques/eval-economics.md).

## The techniques

- [scenario-design](techniques/scenario-design.md) — captured vs generated
  scenarios, versioned fixture identity, deliberately scoped cache keys,
  coverage of the ugly cases.
- [assertion-vs-judgment](techniques/assertion-vs-judgment.md) — the
  deterministic band, when a judge is genuinely necessary, rubric-anchored
  judgment, the structured verdict channel.
- [judge-stability](techniques/judge-stability.md) — the pinned judge
  packet, anchor-set drift measurement, inter-judge disagreement, the
  own-family preference bias.
- [comparison-modes](techniques/comparison-modes.md) — absolute vs pairwise
  vs matrix, win-rates and their pathologies, declared winners and declared
  aggregation.
- [eval-economics](techniques/eval-economics.md) — mock modes, cache
  lifetimes, fan-out caps, tiered cadence, the budget as a design input.
- [certification-levels](techniques/certification-levels.md) — theoretical
  passes gating empirical ones, promotion criteria, what only the live level
  can see.
