# Golden path — Scoring and thresholds

> **Topic path:** `product-surfaces` › `metrics-and-charts` › `scoring-and-thresholds`
> [situation spine](../situation-spine.md) · recurrence 27 · risk **MEDIUM** · sides: **client**
> (spine also carries `twoSided: true` — see §12.1) · convergence: **mixed** ·
> dimensions: **function · code-quality · ui**
> `mergedFrom`: *Weighted composite score* + *Entity health grading* + *Grade and tier banding* +
> *Threshold rule engine*
> Composed 2026-08-16 against `master` @ `b4a05049e`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` under `src/` walked by **two independent matchers**
> (the census engine and a private file-content walker with its own comment filter); all **953**
> `.rs` across `src-tauri/{src,db,engine,core}` for the scoring functions and their SQL.
> `compositeHealthScore.ts`, `useStatusPageData.ts`, `StatusPageView.tsx`, `heartbeats/model.ts`,
> `leaderboardScoring.ts`, `credentialHealthScore.ts`, `useHealthCheck.ts`, `personaThresholds.ts`,
> `personaStats.ts`, `statusTokens.ts`, `KPIDashboard.tsx`, `KpiDetailModal.tsx`,
> `db/src/repos/core/personas.rs`, `engine/rotation.rs`, `core/src/score_weights.rs` and
> `engine/fitness_driver.rs` read in full. All **14** locale files scanned for the measurement-source
> vocabulary.
>
> **Measured by execution, not by reading.** Every score below was **replayed** — the app's own
> weights, its own sub-score curves, its own band boundaries — against a read-only **copy** of the
> operator's live 347 MB `personas.db`, copied 2026-08-16 22:30 UTC with the app running; the live
> file was never opened for write and the copies were deleted afterwards. 78 personas,
> 2,188 executions, 205 healing issues, 25 credentials, 41 KPI measurements.
> **§0 publishes the verdict on screen beside the verdict that is earned.**
>
> **`cargo` was not run.** Every Rust claim is static or replayed in SQL/JS.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It found **one sibling meaningfully ahead of this
> repo** (§6) and inverted two clauses of the brief (§12).
>
> **Shared facts cited:** [`shared-facts.json`](../shared-facts.json) — 963 Rust files, 4,828 `.ts`,
> 2,104 `.tsx`, 1,135 lint warnings / 0 errors.
>
> **Settles:** what a number has to earn before it is allowed to become a verdict.

---

## 0. The headline

**Eight credentials that nothing has ever successfully probed render a green "healthy" dot at
80/100 — and the sub-score that was hardened *specifically to stop that* is outvoted 60:40 by its
two neighbours, three and eight lines below it, in the same file, under the same weights object.**

`src/features/vault/shared/utils/credentialHealthScore.ts` composes three sub-scores at
`0.4 / 0.4 / 0.2` (`:21-23`). All three face the same question — *what do you score when the source
said nothing?* — and answer it three different ways:

```ts
function healthcheckScore(result: HealthResult | null): number {
  if (result === null) return 50;                    // :38  untested = neutral
  // "a connector with no live probe is UNVERIFIABLE — that is neutral evidence,
  //  not health. Scoring it 100 made the composite dot claim 'healthy' for
  //  credentials nothing ever checked"                  :39-45
  if (result.state === 'unverifiable') return 50;    // :46
  …
}
function anomalySubScore(anomaly: AnomalyScore | null): number {
  if (!anomaly) return 100;                          // :52  "no data = assume healthy"
  …
}
function rotationSubScore(status: RotationStatus | null): number {
  if (!status || !status.policy_enabled || !status.next_rotation_at) return 100;  // :57
  …
}
```

Replayed against the operator's 25 live credentials:

| | value | why |
|---|---:|---|
| anomaly sub-score = **100** | **25 / 25** | `credential_events` holds **0 rows**, so `rotation.rs:274` returns `Remediation::Healthy` for every credential |
| rotation sub-score = **100** | **25 / 25** | **0** enabled rotation policies exist (2 rows, both `enabled = 0`) |
| …so the share of the composite awarded for **absence of evidence** | **60 %** | `0.4 + 0.2` |
| lowest score reachable on this install | **60** | `0 × 0.4 + 100 × 0.4 + 100 × 0.2` |
| tiers that are therefore **structurally unreachable** | **2 of 4** | `degraded` (≤ 45) and `critical` (≤ 20) — `tierFromScore`, `:69-73` |
| credentials whose live probe **failed** and which render **amber "warning"**, not critical | **2** | `gmail`, `google_calendar` — `hc = 0`, composite **60** |
| credentials never verified (`state: 'unverifiable'`) rendering a **green "healthy"** dot | **8** | `hc = 50`, composite **80**, tier `healthy` (> 70) |
| observed score range across all 25 | **60 – 100** | |

**The 2026 hardening pass is on screen and it did not hold.** Someone found this exact defect,
wrote the incident into a five-line comment at `:39-45`, and changed *one* of the three sub-scores
from 100 to 50. The composite still says "healthy" for a credential nothing has verified, because
the other two sub-scores carry 60 % of the weight and both still pay full marks for silence. **A
correct sub-score cannot outvote its silent neighbours.**

### One layer down, the same shape, twice

`src-tauri/src/engine/rotation.rs:262-276` computes a staleness flag and then does not use it:

```rust
let data_stale = latest_ts
    .map(|lt| (now - lt) > chrono::Duration::minutes(10))
    .unwrap_or(true);                                       // :269-272
let remediation = if entries.is_empty() || count_1h == 0 {
    Remediation::Healthy                                    // :274-276
} else if …
```

`data_stale` is `true` on **25 of 25** live credentials. It is serialized, shipped over IPC, and read
by **neither** the Rust verdict on the line below it **nor** the TypeScript score that consumes it.
An empty ledger and a healthy one produce the same enum, and the field that could tell them apart is
travelling alongside, ignored.

### And the same question, answered oppositely, for a persona

The two composites that judge a *persona* disagree about the same nothing by **70 points**:

| For a persona with zero terminal executions | verdict | site |
|---|---:|---|
| `compute_trust_score` | **0.0 / 100** — the floor | `db/src/repos/core/personas.rs:1483-1485` |
| `computeCompositeHealth` | **70 / 100** — above the `critical` line | `compositeHealthScore.ts:359-372`, replayed |
| live population in that state | **19 of 78 (24 %)** | |

Of those 70 points, **70 come from four sub-scores whose input is a count of problems** — latency
100 (because `p95_duration_ms ?? 0` and 0 ms is faster than excellent), cost anomalies 100, healing
100, stability 100 — and 0 from the one sub-score that knows the sample is empty. `grade`
short-circuits to `'unknown'` at `:417`, correctly; the **number does not**, and
`computeGlobalScore` (`useStatusPageData.ts:37-40`) averages all 78 including the 19 it just
labelled unknown, while its sibling `computeGlobalUptime` fourteen lines below filters
`uptimePercent != null`.

> **This is the third time this repo has fixed one half of that pair.** `19f56eb2e` (2026-08-16,
> hours before this sweep) suppressed `globalScore` when a *fetch rejects* — and left the per-entry
> case, where the entry itself already carries `hasSlaData: false`. The commit's own comment records
> the lesson and the lesson has not finished landing: *"Nullability, not discipline, is what
> propagated that fix."* `uptimePercent` is `number | null`, so it was fixed everywhere. `score` is
> `number`, so it has now been fixed twice and is still wrong.

### The one badge that exists to surface low trust fires only on the never-measured

`src/features/home/sub_cockpit/widgets/personaStats.ts:204`:

```ts
if (p.trust_score < 0.5) {
  return { kind: 'low_trust', label: 'Low trust', tone: 'bad' };
}
```

`trust_score` is **0–100** (`personas.rs:35` — *"must sum to 100"*, weights 50/20/15/15). Replayed:

| | value |
|---|---:|
| range of the **59 measured** trust scores | **79.6 – 100.0** |
| measured personas the `< 0.5` test would ever flag | **0** |
| personas it flags today | **7** — every one of them a never-measured persona persisted at the `0.0` floor |
| personas it would flag after a refresh | **19** — all 19 of the never-measured |
| personas dropped from the Trigger Studio's `healthyPersonas` purely by this test | **7** (`useStudioComposer.ts:74`) |

**The threshold is off by 100× and the score has no dynamic range below 79, so the two errors
conceal each other**: a band that can never fire on a bad score, applied to a score that is never
bad, on a scale where the only value below the boundary is the one that means "no data".

And the verdict is persisted, so it also goes stale: **12 of the 19** never-measured personas carry
an old score of up to **88.75**, because `refresh_trust_score` (`personas.rs:1546`) runs only on
execution completion. A persona that has never run is therefore stored as either the worst possible
verdict or a stale good one. It is never stored as *unknown*.

### The denominator of the whole problem

| | count |
|---|---:|
| sites in `src/` mapping a number onto a categorical verdict (label or tone) | **225** |
| …that are a **multi-band ladder with bare numeric boundaries at the call site** (census rule) | **52** in **37** files |
| …of those, that put an explicit *unmeasured* arm in front of the ladder | **9 (17 %)** |
| distinct three-way boundary sets used to band **a 0–100 quality number** | **10** across 22 sites |
| the declared single source of truth for that banding | `GRADE_THRESHOLDS` (`compositeHealthScore.ts:133`) |
| files that import it | **1** outside its own module (`useHealthCheck.ts:62-64`) |
| files that import `computeGrade`, the function it feeds | **4** |
| **files that import `computeGrade` and re-inline its numbers anyway** | **1** — `StatusPageView.tsx`, importing at `:10`, re-typing `80` and `50` at `:194-195` |
| weighted composites in the repo (15 TS + 9 Rust) | **24** |
| …with any assertion that the weights sum to their nominal total | **4** (two of them in one file) |
| …whose doc comment *states* a required total with nothing enforcing it | **2** — `SCORE_WEIGHTS`, `TRUST_W_*` |
| sub-scores of the form `MAX − problems × k` (silence ⇒ full marks) | **18** (11 TS, 7 Rust) |
| user-configurable thresholds, against ~430 compile-time ones | **11 (≈ 2 %)** |

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path,
primitive name or count. Each clause names its warrant.

> **P1 — physics, and the clause everything else follows from.** **A score must be able to say "I
> don't know", or it will say "fine".** Almost every sub-score is a penalty subtracted from a
> ceiling, so a source that fails to deliver bad news is arithmetically identical to a source
> delivering good news. Absence must be a value the sub-score can return and the composite must
> handle — not a zero penalty.
> *Warrant: measured here as 18 penalty-shaped sub-scores, 60 % of one live composite constant at
> full marks, and two of four tiers unreachable; independently reinvented as an explicit
> `failed ⇒ exclude + warn` rule in one sibling repo and committed as a live bug in another, where a
> null latency probe skips the deduction block and scores better than a fast device.*
>
> **P2 — physics.** **Decide what a missing input does ONCE, for the whole composite, not per
> sub-score.** The per-sub-score answer is where the drift is, because each author faces the question
> alone and answers it from local intuition — full marks, zero, or a neutral midpoint. Three answers
> inside one weighted sum is not three opinions; it is one broken scale.
> *Warrant: three sub-scores in one file, sixteen lines apart, returning 50 / 100 / 100 for the same
> "no data"; a sibling with the same three-way split (100 for one pillar, 0 for its neighbour) and
> the only repo that answered once has zero band disagreements.*
>
> **P3 — physics.** **Absence is not the bottom of the scale.** Ranking an unmeasured subject as the
> worst is the mirror of ranking it as the best, and it is worse in one respect: it is *actionable*.
> Something downstream will route around it, demote it, or badge it — on the strength of no evidence.
> *Warrant: a persisted 0.0 trust verdict on 24 % of live subjects, gating which of them a builder UI
> offers; the same subject scored 70/100 by the other composite in the same product.*
>
> **P4 — physics.** **A band boundary is a decision about the world; write it down once, where the
> formula is, and import it.** Boundaries copied to the render site do not stay copies. They are the
> only part of a scoring system that a designer will nudge, and nudging one of eight copies produces
> a product that grades the same number differently on two screens.
> *Warrant: 10 distinct boundary sets for one kind of 0–100 number here, 22 % of live subjects
> rendered a different tone by two of them; three disagreeing grade functions in one sibling, one of
> which imports the shared constants and then redefines the function two lines below.*
>
> **P5 — physics.** **Declared weights must be asserted, not commented.** "Must sum to 100" in a doc
> comment is not a constraint; it is a wish with a paper trail. Weights are edited by people adding a
> dimension, and adding a dimension is exactly when the sum breaks.
> *Warrant: 24 composites, 4 assertions; the two weight sets whose comments state a required total
> are among the twenty with no check, and one of them is contradicted by a second weighting of the
> same three metrics elsewhere in the same binary.*
>
> **P6 — ergonomics.** **Render the verdict the system computed; never re-derive one from the number
> beside it.** If both the score and its grade cross the boundary, use the grade. Re-banding a
> supplied score guarantees a viewport in which the headline and the chart disagree about the same
> subject.
> *Warrant: one sibling renders a server grade in its header and re-bands the same score in the trend
> line, so 82 is "Watch" and "Healthy" simultaneously; the same shape here in a file that imports the
> banding function it re-inlines.*
>
> **P7 — ergonomics.** **A sub-score is not a composite; do not band it with the composite's
> thresholds.** The boundaries that make a weighted average mean something are calibrated on the
> weighted average. Applied to a dimension they produce a breakdown panel that contradicts the total
> it decomposes.
> *Warrant: a five-row breakdown showing four green 100s and one red 0 for a subject the same
> component has just labelled "unknown".*
>
> **P8 — ergonomics.** **A monotonic curve, not a step, wherever the quantity is continuous.** A step
> band on a continuous input creates a region where the subject's score improves as its situation
> worsens. This repo caught one such curve and left the step bands that shadow it.
> *Warrant: a budget curve rewritten because ratio 0.79 scored 21 and 0.81 scored 30, with the
> written reasoning preserved — and three UI chips still banding the same ratio at the removed knee.*
>
> **Scale condition.** P1, P2, P3, P5 and P6 are correctness on day one, at any size. P4 and P7 bite
> the moment a second surface renders the same concept. P8 bites only in the band it creates, which
> is why it survives review.

---

## 1. Trigger

- "Give this a health score." / "add a trust score" / "how do I grade this?"
- "What counts as healthy here?" / "should that be 80 or 90?"
- "Make the dot go red when it's bad."
- "Why is this green? It's clearly broken." / "why does the header say degraded and the bar say ok?"
- "Weight success more than cost." / "add a fourth dimension to the score."
- "It's showing 0 — but it's never run."

**If you are about to write** a comparison of a number against a numeric literal whose *consequent
is a word or a colour a user will read* — `>= 80 ? 'healthy'`, `> 0.8 ? 'text-status-error'`,
`< 3 ? 'critical'` — **or a sum of terms multiplied by fractions**, **or `100 - something * k`**,
**you are in this situation.**

You are **not** in this situation when the question is what the number counts
([`metric-definition`](./metric-definition.md)), how many there are
([`aggregate-count-display`](./aggregate-count-display.md)), how it was made
([`data-provenance-disclosure`](./data-provenance-disclosure.md)), or what the badge looks like once
the token exists ([`status-and-severity-badges`](./status-and-severity-badges.md)).

### The seam test

> **Would changing it change the number, or change the verdict the number earns?**

| Territory | Owner | Do not restate |
|---|---|---|
| The numerator/denominator predicate, the window, the unit, `Option<f64>` for an empty *sample* | [`metric-definition`](./metric-definition.md) | It owns **what a measurement is**. This path owns **what a measurement is worth**. Its rule is Rust-only; mine is TS-only; **file overlap measured at 0 %**. Its `else { 0.0 }` and this path's `MAX − problems × k` are the same conflation pointing in opposite directions: it collapses *unmeasured* into *worst*, this one collapses *unmeasured* into *best*. §8 Gap 1 is where they meet. |
| The cardinality behind a badge, `N of M`, `?? 0` on a count | [`aggregate-count-display`](./aggregate-count-display.md) | Its P4 (*"an unknown count is not zero"*) is this path's P1 applied to a cardinality instead of a verdict. **1 shared file of 37 (2.7 %).** It owns the number in the pill; this owns the colour of the pill. |
| Whether the pixel says how the number was made — measured / proxied / simulated, staleness | [`data-provenance-disclosure`](./data-provenance-disclosure.md) | **The order matters and it is the opposite of the intuitive one.** Disclosing that a sub-score is a placeholder does not stop it being weighted. **Remove the fabricated input from the composite first; disclose what remains.** §6 has the composition defect in full. |
| The closed vocabulary itself — the `CHECK`, the ts-rs union, `tokenLabel`, the pill | [`status-and-severity-badges`](./status-and-severity-badges.md) | It owns a token you were *given*. **This path is what produces the token.** Its chain starts where this one ends. **2 shared files of 37 (5.4 %).** |
| Whether a rate's *bar* or a chart's *scale* is honest | [`proportional-bar-list`](./proportional-bar-list.md) · [`chart-component`](./chart-component.md) | They own encodings that cannot be wrong about the world. A verdict can. |
| Separators, locale, the `%` glyph | [`number-and-cost-formatting`](./number-and-cost-formatting.md) | It owns how `82.4` is drawn. This owns whether `82.4` is "healthy". |
| What a *failed read* becomes | [`partial-failure-read-envelope`](./partial-failure-read-envelope.md) | It owns the read's envelope. This owns what the score does with an envelope that came back empty — which, per §0, is where the envelope's value is thrown away. |

---

## 2. The one way

**Decide once, for the whole composite, what an unmeasured input is worth — and make every
sub-score able to say it.** Concretely: (a) **type every sub-score `number | null` / `Option<f64>`
and return `null` when its source said nothing**, distinguishing *there is no problem* from *nobody
asked*; a penalty subtracted from a ceiling must never be the way absence is expressed. (b) **Drop
the null dimensions and renormalize the surviving weights** rather than folding in a fabricated
neutral or a fabricated full-marks — `leaderboardScoring.ts:136-147` does exactly this and says why
on the line. (c) **Refuse the verdict, not just the number, when too little was measured**: carry
the count of contributing dimensions beside the score and short-circuit the grade to `unknown`, the
way `hasSlaData` already does at `compositeHealthScore.ts:417` — and then make the *score* obey the
same short-circuit, which today it does not. (d) **Put every band boundary in one exported constant
next to the formula and import it** — this repo has `GRADE_THRESHOLDS` and it has one external
consumer; the fix is adoption, not invention. (e) **Never re-band a number the system already
graded**: if the payload carries a grade, render the grade. (f) **Assert the weight sum**, at module
load in dev and in a test, the way `compositeHealthScore.ts:107-122` does — a comment saying "must
sum to 100" is the two Rust weight sets' only protection and neither of them has it. (g) **Keep
sub-score curves monotonic**; a step band on a continuous input creates a region where the subject
improves by getting worse, and this repo has already paid for that once (`:220-226`). (h) **Band a
sub-score, if you must, with thresholds calibrated for a sub-score** — the composite's are not
transferable. (i) **When a threshold encodes a product judgement someone will want to change, make
it data** — 11 of ~430 are, and the ones that are (alert rules, KPI `crit_at`) are the ones users
actually tune.

If you must get one right first: **(a)**. (b), (c) and (d) are all unreachable while a sub-score's
type cannot express the thing they need to react to.

---

## 3. Mandated primitives

Every one of these exists today. The adopter counts are the finding.

| Primitive | What it gives you | Adopters |
|---|---|---|
| **`features/overview/sub_health/libs/compositeHealthScore.ts:133-138` — `GRADE_THRESHOLDS`** | **The band table**, `{ healthy: 80, degraded: 50 }`, with the incident in the comment above it: *"Previously `computeGrade` was duplicated verbatim in three places and re-inlined a fourth; this collapses them so a threshold change lands everywhere at once."* | **1** external file (`useHealthCheck.ts:62-64`) — and the fourth re-inline is **still present**, in the one file that imports the function (§7 D3) |
| **`compositeHealthScore.ts:238-243` — `computeGrade(score)`** | **THE score → grade function.** Four bands including `unknown`, keyed off `GRADE_THRESHOLDS`. | **4** files (`model.ts:53` aliased `gradeFromScore`, `StatusPageView.tsx:52`, `personaHealthSlice.ts:468`, and `primitives.tsx:43` via the alias) |
| **`compositeHealthScore.ts:66-74`, `:93-98`, `:104-122` — `WEIGHTS` / `HEARTBEAT_WEIGHTS` + the dev-time sum throw** | **The only weight-sum invariant in the repo.** Two named weight objects, two exported `sumWeights` helpers, and a module-load `throw` when either drifts off 1.0 by more than `1e-9` — plus tests at `compositeHealthScore.test.ts:48` and `:72`. The comment explains it is stripped in production because `import.meta.env.DEV` is statically false. **Copy this block into any new composite.** | 2 weight sets, **0** other composites |
| **`features/overview/sub_leaderboard/libs/leaderboardScoring.ts:130-148`** | **The exemplar: drop-and-renormalize.** Two dimensions are excluded from the weighted sum when their input has no real baseline, and the surviving weights are renormalized by `totalWeight` — *"folding a flat 50 into the weighted score across the fleet flattens the ranking and masks real performance. Drop the dimension and renormalize the remaining weights so the composite reflects only the dimensions with real data."* **This is the whole path in nine lines of comment and one divisor.** | 1 |
| **`compositeHealthScore.ts:220-231` — `scoreBudget`** | **The monotonicity rule, with its own incident attached**: *"The previous curve (`ratio > 0.8 ? 30 : (1-ratio)*100`) was NON-monotonic: ratio 0.79 scored 21 but 0.81 scored 30 — the score jumped UP as the budget got worse, so a persona could improve its health by overspending. Removed."* | **2** (`computeHeartbeatScore`, `model.ts:73`) — and **3 UI chips still band the same ratio at the removed 0.8 knee** (§7 D5) |
| **`compositeHealthScore.ts:351-352` + `:417` — `hasSlaData`** | **The refusal**, half-built. A boolean on the entry saying whether the subject had any measurable input at all, used to short-circuit `grade` to `'unknown'` *"rather than running the weighted formula against fabricated defaults"*. The right idea; it gates the grade and not the score (§7 D1). | 1 |
| **`compositeHealthScore.ts:389-391` — `uptimePercent: number \| null`** | **The one sub-metric in the module whose absence is in its type**, `null` when no day has data — *"an untouched persona has no uptime to report, not a perfect one."* It is also the only one whose consumer got the fix for free (`useStatusPageData.ts:48-54`). | 1, and that is the point |
| **`features/vault/shared/utils/credentialHealthScore.ts:37-49` — `healthcheckScore`** | **Neutral-not-flattering, with the incident written down**: `null` and `'unverifiable'` both return **50**, because *"Scoring it 100 made the composite dot claim 'healthy' for credentials nothing ever checked."* **The reasoning is correct and complete; §0 is what happened to it.** | 1 (outvoted by its two neighbours) |
| **`features/agents/sub_health/useHealthCheck.ts:42-64` — `HEALTH_SCORING`** | **Every coefficient of a penalty score, named**: `errorPenalty` 25, `warningPenalty`, `infoPenalty`, `minScore`, `maxScore`, and cutoffs **derived from `GRADE_THRESHOLDS`** rather than re-typed. The best-named scoring constant set in the app. | 1 (its own module) |
| **`src-tauri/core/src/score_weights.rs:31-35` — `SCORE_WEIGHTS`** + `lab_get_score_weights` | **The only cross-language weight transport in the repo**: Rust owns the values, the frontend mirror (`lib/eval/evalFramework.ts:52-54`) is *seeded at app startup from the command* rather than hand-copied, with a comment recording that the "keep in sync" mirror it replaced was the defect. | 1 frontend mirror — and **contradicted inside Rust** (§7 D7) |
| **`src-tauri/db/src/repos/core/personas.rs:30-45`** | Every trust-score coefficient named and doc-commented, including the rejected alternative for `HEALTH_FAILING_RATIO`. | its own module |

**Explicitly NOT primitives:**

- **`src/lib/personas/personaThresholds.ts`.** It reads like the shared threshold module this path
  asks for — `TRUST_WEIGHTS`, `HEALING_PENALTY_PER_FAILURE`, `VOLUME_FULL_CREDIT_RUNS`,
  `TRUST_SAMPLE_SIZE`, `HEALTH_FAILING_MIN`, `TRUST_TIERS` — each with a doc comment transcribing the
  Rust formula. **Measured: 6 of its 7 exports have zero consumers anywhere in `src/`.** Only
  `getTrustTier` is imported (2 sites). It is a hand-maintained copy of `personas.rs:30-45` that
  nothing reads and nothing checks, and its file header cites a path (`src-tauri/src/db/repos/...`)
  that does not exist. Do not import it expecting it to be authoritative; do not add to it.
- **`compositeHealthScore.ts:291-295` — `dayStatusFromRate`.** A second, disagreeing opinion about
  `success_rate` inside the module that already has `scoreSuccessRate` (§7 D4).
- **`leaderboardScoring.ts:97-102` — `assignTier`.** 80/60/40 → elite/strong/average/developing. A
  fourth band set over a 0–100 score, in the file that is otherwise this path's exemplar.
- **`src/lib/design/statusTokens.ts:193-206` — `rateToHealth` / `latencyToHealth`.** Genuinely shared
  mappers in the design layer, and the **strictest** boundaries in the app (`>= 0.99` healthy,
  `< 50 ms` healthy). They are not wrong; they are a fifth and sixth opinion nobody reconciled.

---

## 4. Steps

1. **Write the composite's absence policy down before the first sub-score.** One sentence: *"a
   dimension with no input is excluded and the remaining weights are renormalized"* is the answer
   this repo's own exemplar reached and the answer a sibling reached independently. Put it in the
   module header.
2. **Type every sub-score `number | null` (TS) / `Option<f64>` (Rust).** Not `number` with a
   sentinel. `null` when the source returned nothing, and — this is the part that gets skipped —
   `null` when the *fetch failed*, which is a different thing from an empty result and must not be
   flattened before it reaches you.
3. **Never express absence as a zero penalty.** If the sub-score is `MAX − problems × k`, the
   argument `0` must be reachable only from a real count. If the count came from `xs ?? []`, you have
   already lost the distinction — fix it at the read, not at the score.
4. **Compose by dropping nulls and renormalizing.** `leaderboardScoring.ts:138-148` is the shape:
   build `Array<[value, weight]>`, push only the dimensions with data, divide by the surviving
   `totalWeight`. **And then stop** — do not substitute a neutral, do not substitute a full mark.
5. **Refuse the verdict below a coverage floor.** Carry `contributingDimensions` beside the score and
   return `null`/`unknown` when it is too low. A composite from one of five dimensions is not a
   lower-confidence composite; it is a different measurement wearing the same scale.
6. **Assert the weight sum at module load in dev, and in a test.** `compositeHealthScore.ts:104-122`
   is 19 lines. Copy it. A comment saying "must sum to 100" has protected nothing in this repo,
   twice.
7. **Put the boundaries in one exported const beside the formula and import it everywhere.**
   `GRADE_THRESHOLDS` + `computeGrade`. If your concept genuinely needs different bands, give them
   their own named const with a comment saying why they differ — not a literal at a render site.
8. **Render the grade the system computed.** If the payload has `grade`, use `grade`. If you are
   about to write `score >= 80 ?` in a component, check whether the object beside it already carries
   the answer — in `StatusPageView.tsx` and `QuickStatsBar.tsx` it does.
9. **Band a sub-score with sub-score thresholds, or not at all.** The composite's `healthy: 80` was
   calibrated on a weighted average of five dimensions; a 100-vs-0 dimension is not on that scale.
10. **Keep the curve monotonic** and, if you replace a step with a curve, leave the old step's
    counter-example in the comment — `scoreBudget:220-226` is why that convention survives.
11. **Ask whether the threshold is a product decision.** If a user would ever want it different, it
    belongs in the database with the rest of the alert rules, not in a `const`.
12. **Write the test that pins the absence policy, not the arithmetic.** The assertion to copy is
    `useStatusPageData.test.ts:33` (`computeGlobalScore([])` is `null`) and `:43-48`
    (`computeGlobalUptime` is `null` for entries with no activity) — both named for the distinction
    they protect.

### Can the type make the wrong call impossible? — asked before §9

**Split answer. Yes, decisively, for the absence axis — and the sibling cohort validates it.
No for the boundary axis, and Q3 is why.**

**T1 — make a sub-score's absence unrepresentable as a number.**

```ts
// today, ×18 (§0):                          // the fix, already present in this repo:
function scoreHealing(open: number) {        function scoreHealing(open: number | null) {
  return clamp(100 - open * 20, 0, 100);       return open == null ? null : clamp(100 - open * 20, 0, 100);
}                                            }
// caller: healingByPersona.get(id) ?? []    // caller must now distinguish "no issues" from "no answer"
```

Held against the corpus's seven qualifications:

- **Q1 — a required prop carries only what it encodes.** `number | null` encodes *"there may be no
  input"*. It encodes **nothing** about the boundary, the weight, or the scale — which is why §2 (d),
  (f) and (h) are separate mandates. This is the same qualification
  [`metric-definition`](./metric-definition.md) earned on `successRateSource`, arriving from the
  other side: there the tag was closed and the *unit* leaked; here the absence closes and the
  *boundary* leaks.
- **Q2 — requiredness is orthogonal to closedness.** Making the sub-score argument required changes
  nothing; the wrong value is `0`, and `0` is a perfectly good `number`.
- **Q3 — a type nobody constructs constrains nothing, and this decides the scope.** The 18
  penalty-shaped sub-scores live in **8 modules** — `compositeHealthScore.ts` (7),
  `credentialHealthScore.ts` (2), `useHealthCheck.ts`, `kpiMath.ts`, `personas.rs` (2),
  `rotation.rs`, `fitness_driver.rs` (3), `kpi_derivation.rs` — and each has **1–3 call sites**. That
  is small, closed and reachable; the edit lands. A general `Score` newtype across the 225 verdict
  sites does **not** meet Q3: there is no shared numeric wrapper in `src/lib/`, and inventing one
  that 225 call sites must adopt is a refactor, not a type. **Ship the nullable sub-score in the
  8 scoring modules; treat the wrapper as direction.**
- **Q4 — a type anyone can construct authenticates nothing.** `number | null` does not stop a caller
  passing `xs.length` where `xs` is an empty array from a failed read. That residue is real and it is
  what §9 ratchets from the other end.
- **Q5/Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is **the ceiling
  default**, not the number. Compare the two composites in this repo: `computeCompositeHealth` hands
  each sub-score a pre-defaulted count (`?? 0`, `?? []`) and gets five fabricated dimensions;
  `computeLeaderboard` withholds the dimension itself (`if (hasSpeed) parts.push(...)`) and gets a
  composite that only reflects real data. **Same repo, same era, same kind of composite. Withholding
  works — but only the freedom to invent the input, never the input.**
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value voluntarily.**
  Nothing *forces* `healingByPersona.get(id) ?? []`. The caller volunteers it. So the nullable
  sub-score alone is inert unless the **composite** changes too: `null` must cause a *drop*, not a
  coercion. **Both edits or neither** — and the drop half is `leaderboardScoring.ts:138-148`, which
  already exists.

**T2 — an `AbsenceAware` composite helper**, which is the construction that reaches the composition
half as well:

```ts
type Dimension = { key: string; score: number | null; weight: number };
function compose(dims: Dimension[], minDimensions: number):
  { score: number; covered: number } | null;   // null when coverage is too thin
```

Every §7 deviation about fabricated inputs becomes unspellable: a `null` dimension cannot be
weighted, and a composite over too few dimensions cannot produce a number at all. `ascent` reached
this construction independently (§6) and added the piece this repo lacks — a `warnings` array
naming which dimension was excluded and why, so the UI can say *"scored on 3 of 5"* instead of
silently returning a comparable-looking number.

**T3 — NO for the boundary axis.** No type distinguishes `score >= 80` from
`score >= GRADE_THRESHOLDS.healthy`; both are `boolean`. The reachable approximations are (i) making
the graded value a branded type whose only comparison operator is the shared `computeGrade`, which
fails Q3 at 225 sites, and (ii) a lint/census signal on the literal. **That residue is exactly what
§9 gates.**

**Propose T1 immediately (18 sites, 6 modules, a legal fix already present twice in this repo and
independently in a sibling), T2 as the direction, and §9's census rule as the ratchet holding the
boundary line until T3 becomes possible.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A sub-score of the form `MAX − problems × k`** | A source that fails to deliver bad news is arithmetically indistinguishable from a source delivering good news. **18 sites.** Executed: 60 % of every live credential's composite is awarded for absence of evidence, and the two failing credentials render amber. §0, §7 D2. |
| **`?? 0` / `?? []` on the input to a penalty score** | The zero-penalty is created one line before the score, so the score never sees the distinction it needs. `compositeHealthScore.ts:343, 353, 354` — three of five dimensions defaulted before use. |
| **A neutral or full-marks substitute folded into a weighted sum** | It does not lower confidence, it flattens the ranking — and the substituted subject scores *closer to the mean than the data allows*. `leaderboardScoring.ts:130-135` is nine lines of comment explaining this and is the only site in the repo that acts on it. |
| **Absence scored as the FLOOR** | The mirror of the above, and worse because it is actionable. `compute_trust_score` returns **0.0** for a persona with no terminal rows and persists it; 19 of 78 subjects, feeding a UI gate. §7 D6. |
| **Two composites over the same subject with opposite absence policies** | The same 19 personas are worth **0/100** to one score and **70/100** to the other. Nothing reconciles them because neither states its policy. §0. |
| **Comparing a score against a boundary in the wrong unit** | `p.trust_score < 0.5` against a 0–100 scale: **0 true positives possible, 7 firings, all on never-measured subjects.** The badge and the score are each broken in a way that hides the other. §7 D6. |
| **A band boundary re-typed as a literal at the render site** | **52 sites, 37 files, 10 distinct boundary sets for one kind of 0–100 number.** Executed: 22 % of live personas get a different tone from two of them. §9. |
| **Re-inlining a band in the file that imports its function** | `StatusPageView.tsx` imports `computeGrade` at `:10` and re-types `80`/`50` at `:194-195` — the fourth duplicate the SSOT comment says was collapsed. Convergent: a sibling imports three shared constants and redefines the grading function two lines below. §7 D3. |
| **Banding a sub-score with the composite's thresholds** | `ScoreBreakdown` renders each of five dimensions against `80`/`50`. For a persona with no SLA data that is four green **100**s and one red **0**, under a header the same component has just labelled "unknown". §7 D1. |
| **Re-deriving a verdict the payload already carries** | `QuickStatsBar.tsx:50` bands `successRate` at 80/50; `:57`, seven lines below, renders `healthGrade` — the computed verdict — for the same persona. One chip trusts the system, the next re-litigates it. |
| **Two opinions about one quantity inside one module** | `scoreSuccessRate` (`:170-175`) and `dayStatusFromRate` (`:291-295`) both band `success_rate`. At 95 % the day bar is **green** and the score is **70/100 (degraded)**; at 80 % the day bar is **amber** and the score is **30/100 (critical)**. §7 D4. |
| **A step band shadowing a curve that was rewritten to remove it** | `scoreBudget` deleted its `0.8` knee for non-monotonicity, with the counter-example in the comment. Three UI chips still band `budgetRatio` at `> 0.8 / > 0.5`. §7 D5. |
| **`must sum to 100` in a doc comment** | Two weight sets say it; neither is checked; one is contradicted by a second weighting of the same three metrics 40 lines into a different crate. §7 D7. |
| **A staleness flag computed and not consulted** | `rotation.rs:269-272` computes `data_stale`, `:274` decides `Healthy` without it, and the TS composite ignores it too. **`true` on 25 of 25 live credentials.** §0. |
| **Testing a closed union by naming the members you distrust** | An `ai-compose` measurement drew as a solid production line until 2026-08-16 because a `!== 'simulation'` test predated the sixth arm. Fixed at `KPIDashboard.tsx:170` by inverting it to name the members that *are* measurements — **copy the inversion, not the set.** §7 D8. |
| **A threshold module nobody imports** | `personaThresholds.ts` transcribes the Rust trust formula into six exported constants with **zero consumers**. A mirror that nothing reads cannot drift *loudly*. |
| **A tier whose bottom band means two things** | `TRUST_TIERS`'s own doc says L0 is *"brand-new or poorly performing"* — the conflation admitted in the comment and shipped anyway. |

---

## 6. Evidence

**The ONE site to copy: `src/features/overview/sub_leaderboard/libs/leaderboardScoring.ts:130-148`.**

```ts
// Speed & cost only contribute to the composite when there's a real baseline
// AND the agent has data — scoreSpeed/scoreCostEfficiency return a neutral 50
// otherwise (fine for the dimension display, which shows '—'), but folding a
// flat 50 into the weighted score across the fleet flattens the ranking and
// masks real performance. Drop the dimension and renormalize the remaining
// weights so the composite reflects only the dimensions with real data.
const hasSpeed = fleetAvgLatency > 0 && signal.avgLatencyMs > 0;
const hasCost = fleetAvgCost > 0 && signal.dailyBurnRate > 0;
const parts: Array<[number, number]> = [
  [successScore, WEIGHTS.success], [healthScore, WEIGHTS.health], [activityScore, WEIGHTS.activity],
];
if (hasSpeed) parts.push([speedScore, WEIGHTS.speed]);
if (hasCost) parts.push([costScore, WEIGHTS.cost]);
const totalWeight = parts.reduce((sum, [, w]) => sum + w, 0);
const composite = Math.round(parts.reduce((sum, [v, w]) => sum + v * w, 0) / totalWeight);
```

Five things to copy: (1) the composite is built from a **list of surviving dimensions**, not a fixed
sum, so a missing one is *absent* rather than *neutral*; (2) the divisor is the **surviving** weight,
so the scale stays 0–100 without inventing a value; (3) the comment **names the rejected alternative
and its failure mode** — "flattens the ranking and masks real performance"; (4) it distinguishes the
*display* value (a neutral 50 with a `'—'` raw) from the *composite* value (excluded), which is the
distinction §7 D1's five-row breakdown panel loses; (5) the two `has*` predicates check the fleet
baseline **and** the subject's own data, because either one being absent makes the dimension
meaningless.

**Secondary exemplars, each for one property:**

| Site | What to copy |
|---|---|
| `compositeHealthScore.ts:104-122` | **The weight-sum invariant.** A dev-time `throw` on `\|Σw − 1.0\| > 1e-9` for **both** weight sets, plus exported `sumWeights`/`sumHeartbeatWeights` so a test can assert the same thing. 19 lines; the only one in 24 composites. |
| `compositeHealthScore.ts:220-231` | **Monotonicity, with the counter-example preserved.** *"ratio 0.79 scored 21 but 0.81 scored 30 — the score jumped UP as the budget got worse, so a persona could improve its health by overspending."* |
| `credentialHealthScore.ts:37-49` | **Neutral-not-flattering, and the reasoning for it.** *"a connector with no live probe is UNVERIFIABLE — that is neutral evidence, not health."* Correct in isolation; §0 is what its neighbours did to it. |
| `useHealthCheck.ts:49-64` | **Every coefficient named, and the cutoffs *derived* from `GRADE_THRESHOLDS` rather than re-typed** — the only place in `src/` that reaches for the shared band instead of copying its numbers. |
| `useStatusPageData.ts:37-54` | **The pair that shows the mechanism.** Two sibling functions, 14 lines apart, one returning `null` for an empty input and one for a filtered-empty input — and their tests (`useStatusPageData.test.ts:33`, `:43-48`) are named for the distinction, not the arithmetic. |
| `lib/eval/evalFramework.ts:62-80` ↔ `commands/execution/lab.rs:1411-1418` | **Transport the weights, don't mirror them.** The frontend fetches `lab_get_score_weights` at startup; the hardcoded values remain only as a pre-fetch fallback, and the comment records that the "keep in sync" mirror was the defect. |
| `KPIDashboard.tsx:161-174` | **How to test a closed union that will grow.** *"Testing a closed union by naming the members you distrust is the failure mode … The durable form is to name the members that ARE measurements, so a new arm defaults to 'not measured'."* |
| `compositeHealthScore.ts:28-34, :71-73, :205-215` | **A sub-score replaced because it was not independent.** `slaComplianceScore` re-scored the value `successRateScore` already used — *"55% of the composite was one metric double-counted"* — and was replaced by a streak-based `stabilityScore`. Independence of dimensions is a property to check, and this is the only place in the repo that checked it. |

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** `personas-cloud` (51 tracked files, no
`.tsx`) has **zero numeric scoring** — its only "health" is a binary `'healthy' | 'degraded'` state
flag (`orchestrator/src/db.ts:1052`) and its only threshold is a named rate limit. It is reported as
a **structural absence**, not counted as a choice.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **Every scoring codebase disagrees with itself about at least one band** | **PHYSICS (4/4)** | brainiac **3** disagreeing `grade_of` for one number (`brainiac-core/src/health.rs:112-119` at-risk floor **50**; `brainiac-server/src/console.rs:2733-2740` at **55**; `console/src/health/KnowledgeHealth.tsx:116` at **80/60**) — so 50–54 is "At risk" to the core and "Critical" to the endpoint every leader reads. vibeman **2** (5 tiers at `projectHealthEngine.ts:52-57`, 4 at `GroupHealthBar.tsx:36-38`). personas-web **2** (80/60/40 at `healthScoreColor.ts` vs 70/40 at `kpiPrimitives.tsx:147`). Here **10** for one kind of 0–100 number. **ascent is the only repo with zero.** |
| 2 | **The shadow appears exactly where the reason was not written down** | **PHYSICS (3/3 where a shadow exists)** | brainiac's `console.rs:2731` **imports three constants from the registry** (`use brainiac_core::health::{LIBRARY_DORMANT_DAYS, …}`) and redefines `grade_of` two lines later, uncommented — and it is the shadow that serves the HTTP API while the registry's own copy is reachable only from its test. **`StatusPageView.tsx` is the identical shape**: imports `computeGrade` at `:10`, re-types its numbers at `:194`. personas-web's `leaderboardStyles.tsx:5-32` duplicates the canonical `healthScoreColor.ts` byte-equivalently, importing nothing. |
| 3 | **A silent input scores as full marks** | **PHYSICS (2/4 as a live bug, 4/4 as a hazard)** | vibeman `remote/batchDispatcher.ts:99-104`: `score = 100` then `if (metrics.latencyMs !== null) { if (> 500) score -= 30 … }` — **a null latency skips the whole deduction block, so an unreachable device outscores a 100 ms one** — while `topologyBuilder.ts:110-111` in the same repo answers the identical null correctly with `return 'unknown'`. brainiac splits it deliberately: `currency_pillar` returns **100** for an empty corpus ("vacuously current") and its neighbour `liquidity_pillar` returns **0**. Here: 18 sites. |
| 4 | **A missing dimension should be EXCLUDED and the weights renormalized** | **PHYSICS, reinvented with the same reasoning** | `ascent/src/lib/scoring/engine.ts:93-102`: *"folding a placeholder 0 would deflate the overall as if the repo genuinely scored 0"* → the dimension returns `[]`, and `model.ts:283-287` / `:301-312` renormalize it out, with `:296-299` recording that charging 0 at full weight *"deflated the axis and flipped the posture"*. **`leaderboardScoring.ts:130-148` is the same construction, same argument, no shared document.** Two teams, two stacks. |
| 5 | **A weight sum must be asserted, not commented** | **MINORITY (2/4), and both did it dev-only** | `ascent/src/lib/maturity/model.ts:228-236` + `:362-366` — `weightsAreValid()` checks the base dimensions **and every archetype lens** to `< 1e-9`, throwing when `NODE_ENV !== "production"`, with the comment recording that validating only the base weights *"left the real ones unchecked"*. `compositeHealthScore.ts:104-122` is the same construction under `import.meta.env.DEV`. **brainiac, vibeman and personas-web assert nothing** — and vibeman's docstring says "equal weights" one line above `0.3/0.25/0.25/0.2`. |
| 6 | **A client re-derives a verdict the server already computed** | **PHYSICS (3/4)** | brainiac's `KnowledgeHealthResponse` carries **both** `score` and `grade` (`console.rs:2705-2718`); `KnowledgeHealth.tsx` uses the server `grade` for the headline (`:36-45`) and **re-derives one at `:116`** for the trend line — so **82 is "Watch" in the header and "Healthy" in the chart, in one viewport**. vibeman `GroupHealthBar.tsx:36-38` re-bands a server score. Here, `QuickStatsBar.tsx:50` re-bands `successRate` seven lines above rendering `healthGrade`. |
| 7 | **Thresholds are hardcoded rather than configurable** | **PHYSICS (4/4), with one live exception** | ascent alone has working per-org thresholds (`Organization.alertOverallDrop` / `gatePolicy`, `prisma/schema.prisma:52-57`), plus a `sanitizeGatePolicy` (`gate.ts:159-164`) that rejects a `<= 0` floor because *"an always-pass gate that still LOOKS configured"* is the failure mode. **vibeman has a `health_score_config` table with `category_weights` and `thresholds` columns and no code that reads it.** brainiac and personas-web: zero. Here: 11 of ~430. |
| 8 | **A rubric version pinned to the cache key** | **`ascent` ALONE (1/5), and it is the better answer** | `ascent/src/lib/maturity/model.ts:27` — `SCORING_RUBRIC_VERSION = "r1"`, folded into the scan cache key, so editing a boundary busts every cached score fleet-wide. **No other repo in the cohort — including this one — can tell a score computed under the old rubric from one computed under the new.** |
| 9 | **The correct shape exists in the codebase and is not the default** | **PHYSICS (4/4)** | Every repo contains at least one sub-score that refuses to fabricate, sitting beside several that do — brainiac's two pillars, vibeman's `topologyBuilder` vs `batchDispatcher`, ascent's `engine.ts:171-175` degenerate-scan warning, and here `credentialHealthScore.ts:37-49` three lines above `:51-54`. **The knowledge is never missing. The default is.** |

**Physics — keep as doctrine:** clauses 1, 2, 3, 4, 6, 7, 9.
**Reported as MINORITY / this-repo-behind:** clauses 5 and 8.
**Personas is ahead** on exactly two things: the **weight-sum invariant** (shared only with ascent)
and the **written-down rejected alternative** — `scoreBudget:220-226`, `leaderboardScoring:130-135`,
`credentialHealthScore:39-45` and `compositeHealthScore:28-34` are four incidents preserved at the
site of the fix, which is more than any sibling. Personas is **behind `ascent`** on the two clauses
that matter most: exclusion-and-renormalization as the *default* rather than one module's local
choice, and a versioned rubric.

> **The strongest external result is clause 9, and it reframes the whole document.** In four
> codebases, the correct handling of a silent input is always already present, usually within a few
> lines of the incorrect handling, often with a comment explaining why. **What varies is not
> knowledge, it is which answer a new sub-score inherits by default.** That is why §2 mandates a
> composite-level absence policy (P2) rather than a per-sub-score rule, and why §9 gates the
> boundary — the only half of this leaf a machine can see.

### The composition defects with the neighbouring paths — offered upward

**(i) with [`data-provenance-disclosure`](./data-provenance-disclosure.md).** Its prescription is to
*disclose* how a number was made. Following it here produces a credential dot that is correctly
labelled "estimated / no probe" **and still green at 80/100**, because disclosure is a property of
the pixel and the fabricated 100s are already inside the weighted sum. **Order matters and it is the
opposite of the intuitive one: remove the fabricated dimension from the composite first, disclose the
reduced coverage second.** The clause both paths need: *a provenance tag on a composite describes the
composite, not its inputs — an input whose provenance is "unmeasured" must not be an input.*

**(ii) with [`metric-definition`](./metric-definition.md).** Its §9 ratchets `else { 0.0 }` — an
unmeasured *rate* rendered as a confident zero. This path's §0 is the same conflation with the sign
flipped: an unmeasured *penalty* rendered as full marks. **Fixing only one of them relocates the
error rather than removing it**, and this repo demonstrates it live: `successRateScore` correctly
scores **0** for a null rate (its half of the fix landed) while the four penalty dimensions beside it
score **100**, so the composite lands at 70 — a number neither path would endorse. **They must land
T1 together**; the two rules are one edit in two languages against two directions of the same
conflation.

**(iii) with [`aggregate-count-display`](./aggregate-count-display.md).** Its P4 (*"an unknown count
is not zero, and zero is not nothing"*) is upstream of this path's P1: every one of the 18
penalty-shaped sub-scores takes a **count** as its input, and `?? 0` on that count is where the
absence is destroyed — one layer before any scoring code can see it. Its rule needs a lookup keyed
by an entity; mine needs a render-site ladder; **1 shared file of 37**. The clause: *fixing a count's
nullability is not cosmetic if a score consumes it — it is the only place the score's absence policy
can be enforced.*

---

## 7. Deviations

Every entry is live on `master` @ `b4a05049e`, verified by reading the file and — where a number is
quoted — by replay against a read-only copy of the operator's database. All shipped under a green
`npm run check` (0 errors, 1,135 warnings — [`shared-facts.json`](../shared-facts.json)) and a green
census. **Per the campaign's no-destructive-applies rule, nothing here was applied; each entry is
written so someone can act later.**

### D1 — The status-page composite scores four dimensions it did not measure · **executed, 19 of 78**

`compositeHealthScore.ts:341-372`. For a persona with no SLA row (`hasSlaData === false`):

| dimension | weight | input | score |
|---|---:|---|---:|
| success rate | 0.30 | `null` → guarded at `:359` | **0** |
| latency | 0.15 | `sla?.p95_duration_ms ?? 0` (`:353`) — 0 ms is faster than `LATENCY_EXCELLENT_MS` | **100** |
| cost anomalies | 0.15 | a **global** count attributed evenly to every persona (`:345`) | **100** |
| healing | 0.15 | `healingByPersona.get(id) ?? []` (`:343`) | **100** |
| stability | 0.25 | `Number(sla?.consecutive_failures ?? 0)` (`:354`) | **100** |
| **composite** | | | **70 / 100** |

`grade` short-circuits to `'unknown'` at `:417` — correctly, and the comment says why. **The `score`
field does not**, and it is the field `computeGlobalScore` averages.

Replayed against the live corpus (78 personas, 59 with SLA rows, 205 healing issues):

| | value |
|---|---:|
| global score as shipped (all 78 entries) | **68** → `degraded` |
| global score over the 59 measured entries | **67** → `degraded` |
| the 19 unknown entries' mean contribution | **70** each |
| shipped grade distribution | unknown **19** · critical **9** · degraded **39** · healthy **11** |

The averaging error is small **today** because 70 happens to sit near the fleet mean. It is
unbounded in the case the score exists for: **a fresh install with personas and no runs reads
70/100 → `degraded`**, not `unknown` — and 70 is above the `critical` cutoff of 50, so the app's
answer to "nothing has ever run here" is *"mildly unhealthy"*.

**Downstream, in the same view:** `StatusPageView.tsx:164-168` renders each dimension through
`ScoreBreakdown`, which bands it at `:194-195` with the composite's `80`/`50`. For those 19 personas
the expanded row shows **four green 100s and one red 0** under a header the same component labelled
"unknown".

**Fix (note, not applied):** exclude `!hasSlaData` entries from `computeGlobalScore` the way
`computeGlobalUptime` excludes `uptimePercent == null`, and make the four penalty sub-scores return
`null` for an unread source so the composite can drop them (T1 + `leaderboardScoring`'s divisor).

### D2 — The credential composite: 60 % constant, two tiers unreachable · **executed, 25 of 25**

Full replay in §0. `credentialHealthScore.ts:51-54` and `:56-67` both return **100** for their
absent input; both fire on every live credential; together they carry `0.4 + 0.2 = 0.6` of the
composite. Floor = **60** → `warning`; `degraded` (≤ 45) and `critical` (≤ 20) cannot occur. Two
credentials with a **failed** probe (`gmail`, `google_calendar`) render **60 / warning**; eight never
probed render **80 / healthy**, a green dot.

**Fix (note):** `anomalySubScore(null)` and `rotationSubScore(no policy)` return `null`; `compose`
drops them and renormalizes; the tier is refused below a coverage floor. With the anomaly and
rotation dimensions dropped, the two failed credentials score **0 / critical** and the eight
unverified score **50** with a "1 of 3 dimensions" caveat — which is the truth.

### D3 — The fourth re-inline is in the file that imports the function · **`StatusPageView.tsx`**

`compositeHealthScore.ts:124-131` states the SSOT and its history:

> *"Previously `computeGrade` was duplicated verbatim in three places and re-inlined a fourth; this
> collapses them so a threshold change lands everywhere at once."*

`StatusPageView.tsx:10` imports `computeGrade`; `:52` uses it correctly for the header;
`:194-195` re-types `80` and `50` as literals. **The fourth re-inline survived the collapse that
named it**, and it now bands a *sub*-score with a *composite* threshold (D1). Convergent with
brainiac's `console.rs:2731` importing the constants and shadowing the function two lines below —
same shape, two repos, no shared document.

`GRADE_THRESHOLDS` has **1** external importer against **52** inline band ladders.

### D4 — Two opinions about `success_rate` inside one module · **executed**

`scoreSuccessRate` (`:170-175`, knees at 0.99 / 0.95 / 0.80) and `dayStatusFromRate` (`:291-295`,
knees at 0.95 / 0.70) both consume a success rate, 120 lines apart:

| rate | `scoreSuccessRate` → band | `dayStatusFromRate` |
|---:|---|---|
| 99 % | 100 → healthy | operational |
| **95 %** | **70 → degraded** | **operational** |
| 90 % | 57 → degraded | degraded |
| **80 %** | **30 → critical** | **degraded** |
| 70 % | 26 → critical | degraded |
| 50 % | 19 → critical | outage |

At 95 % the same number paints a **green** uptime cell and an **amber** score. At 80 % it paints
**amber** and **red**. Repo-wide there are **six** answers to "what success rate is healthy",
spanning 0.40 to 0.99 — `statusTokens.ts:194` (≥ 0.99), `dayStatusFromRate` (≥ 0.95),
`VitalsLedger.tsx:177` / `RowDetail.tsx:48` (≥ 90 on a 0–100 scale), `defaultCockpit.ts:52-53`
(≥ 80), `personas.rs:33` `HEALTH_FAILING_RATIO = 0.6` (failing at ≤ 0.40 success), and
`optimizer.rs:215` (< 0.5 underperformer).

**Measured consequence of just two of them:** banding the 59 live personas' success rates with
`QuickStatsBar.tsx:50`'s 80/50 and `VitalsLedger.tsx:177`'s 90/70 gives a **different tone for 13
personas (22 %)** — 11 good→warn, 2 warn→bad.

### D5 — The 30-day uptime bar is per-persona for activity and fleet-wide for health · **executed, 42.9 %**

`compositeHealthScore.ts:375-379`:

```ts
const dailyStatuses = last30.map(pt => {
  const hasActivity = pt.persona_costs.some(c => c.persona_id === persona.id);
  if (!hasActivity) return 'no-data';
  return dayStatusFromRate(pt.success_rate);   // <- pt is a GLOBAL daily point
});
```

`hasActivity` is per-persona; `pt.success_rate` is the **fleet's** rate for that day. Replayed:

- **403** persona-day cells rendered across the last 30 buckets;
- **173 (42.9 %)** carry a day-status that differs from that persona's own rate for that day;
- worst per-persona divergence: one persona renders **50 %** uptime where its own rows say **100 %**.

And `uptimePercent` (`:389-391`) counts `'degraded'` days as up, so **a persona failing 29 % of its
runs every day for 30 days renders 100 % uptime.** On the live corpus the last 30 buckets are
9 operational · 6 degraded · 2 outage — six of the seventeen active days are amber and all six count
as up.

### D6 — `trust_score`: the floor for absence, and a band 100× off · **executed, 19 and 7**

Full replay in §0.

- `personas.rs:1483-1485` — `if rows.is_empty() { return Ok(0.0); }`. **19 of 78** personas are in
  that state. `0.0` is not a low score; it is the same value a persona would get by failing every run
  with a maxed budget and a 5-failure streak, which is unreachable on this corpus.
- `refresh_trust_score` (`:1546`) runs only on execution completion, so the verdict is also stale:
  **12 of those 19** carry an old score of up to **88.75**.
- `personaStats.ts:204` — `p.trust_score < 0.5` on a 0–100 scale. Measured range of the 59 real
  scores: **79.6 – 100.0**. Firings: **7** today, **19** after a refresh, **100 %** of them
  never-measured; **0** possible on a genuinely low score.
- `useStudioComposer.ts:74` — `healthyPersonas = personas.filter(p => attentionFor(p) === null)`, so
  those 7 are dropped from the Trigger Studio's offer list.
- `TRUST_TIERS` (`personaThresholds.ts:95-101`) bands them "L0", documented as *"brand-new or poorly
  performing"* — the conflation named in the comment.

**A third status vocabulary in the same function, and it is the undefended one.** The brief named the
two clauses 32 lines apart (`:1470` `status IN ('completed','failed')` and `:1502`
`status IN ('completed','failed','incomplete','cancelled')`). Both are defensible: the first is the
outcome window, the second is a spend window and an incomplete run still cost money. **The clause
with no defence is the third, 47 lines below the first** — `:1516-1517` selects **every** status and
`take_while(|s| s == "failed")`, so any non-failed row at the head resets the streak to zero and
awards the full 15 healing points. Live: **5 of 59** personas currently have a non-terminal head row
(3 `incomplete`, 2 `cancelled`); none of them has a terminal failure streak behind it today, so this
is **latent, not live** — but the exposure is one queued run away.

**And 20 of the 100 trust points are unearned by construction.** `:1508-1511`:
`_ => 1.0, // no budget set = full marks`. Live: **0 of 78** personas have `max_budget_usd > 0`, so
**78 of 78 receive the full cost-discipline award for a dimension nobody configured.** Combined with
the healing and volume dimensions, that is why the 59 measured scores span only **79.6 – 100**.

### D7 — `SCORE_WEIGHTS` is contradicted inside its own binary · **`0.4/0.4/0.2` vs `0.3/0.4/0.3`**

`src-tauri/core/src/score_weights.rs:14-35` declares itself, twice, *"**This is the single source of
truth**"*, and does the right thing across the language boundary — the frontend mirror is seeded at
startup from `lab_get_score_weights` rather than hand-copied, with the comment recording that the
"keep in sync" mirror was the defect.

`src-tauri/src/engine/fitness_driver.rs:337-341` weights **the same three metrics**:

```rust
let weighted: Vec<(f64, f64)> = [
    (tool_accuracy, 0.3),
    (output_quality, 0.4),
    (protocol_compliance, 0.3),
]
```

Bare literals, no reference to `SCORE_WEIGHTS`, no comment explaining the divergence. Its output
feeds `MeasuredFitness.quality` (`:127-148`), which drives persona evolution. **The frontend agrees
with the declared SSOT and the evolution engine does not.**

Ironically, `renorm_composite` is otherwise the *best* composite in the Rust tree: it takes
`Option<i32>` per metric, `filter_map`s the `None`s away, and divides by the surviving weight — T1
and step 4 of §4, already written. It carries this path's prescription and the wrong constants.

Also unasserted: `TRUST_W_*` (`personas.rs:35`, *"must sum to 100"*, nothing checks it) and
`SCORE_WEIGHTS` itself (no Rust-side assertion at all; only the TS mirror's test at
`evalFramework.test.ts:95` covers the values). **24 composites, 4 assertions, and the two whose
comments state a required total are among the twenty with none.**

### D8 — A six-arm union with five labels · **14 of 14 locales**

`dev_kpi_measurements.source` is `CHECK(source IN ('evaluator','manual','scan','health_snapshot','simulation','ai-compose'))`
— verified against the live DDL. `'ai-compose'` was widened in by
`widen_kpi_measurement_source_with_ai_compose` (`incremental.rs:8223-8296`), a careful rebuild that
re-creates the table from its own stored DDL and refuses if the CHECK is not the expected shape.

The chart half was fixed the same day (`KPIDashboard.tsx:161-174`, and the comment there is the
model for how to test a growing union). **The label half was not.** `t.kpis.measurement_source` has
**5 arms in all 14 locale files**; `KpiDetailModal.tsx:319` renders `sourceLabels[m.source] ?? m.source`,
so an `ai-compose` measurement shows the raw machine token `ai-compose` in every language.
`MeasureSetupModal.tsx:76` writes that arm today. Live corpus: 41 measurements, all `evaluator`, so
this is **latent**.

This is a `status-and-severity-badges`-shaped effect with a `scoring-and-thresholds`-shaped cause:
the arm exists because a *provenance* distinction was needed for a *chart* decision, and the label
table was never part of the same change.

### D9 — Ten band sets for one kind of number · **52 sites / 37 files, executed tabulation**

Grouping the 52 census matches by the scale of the quantity they band:

| scale | sites | distinct boundary sets |
|---|---:|---:|
| 0–1 ratio | 11 | **8** |
| 0–10 count/rating | 9 | **7** |
| 0–100 score or percentage | 31 | **16** (of which **10** band a quality score or percentage across 22 sites) |
| absolute (ms) | 1 | 1 |

The 0–100 quality sets: `80/50` ×6 · `70/40` ×3 · `80/40` ×3 · `90/70` ×2 · `70/45` ×2 · `80/60` ×2 ·
`90/75` · `85/70` · `65/30` · `78/55`. Exactly one of them (`80/50`) is the value `GRADE_THRESHOLDS`
declares, and **6 of those 8 sites re-type it as literals** rather than importing it.

**43 of the 52 (83 %) have no unmeasured arm in front of the ladder** — the value goes straight into
the first comparison, so `null` coerces and `0` bands as the worst. The 9 that do
(`FactoryOverviewTab.tsx:91`'s `errs === null ? 'unmeasured'` is the cleanest) are the shape to copy.

### D10 — `data_stale` computed, shipped, and consulted by nobody · **25 of 25 live**

`rotation.rs:269-272` computes it; `:274` decides `Remediation::Healthy` without it;
`AnomalyScore.data_stale` crosses ts-rs; `credentialHealthScore.ts` never reads it. **`true` on all
25 live credentials.** The field that could separate "the ledger says healthy" from "the ledger has
not been written in 10 minutes" is present at every hop and read at none.

### D11 — A threshold mirror with zero readers · **6 of 7 exports**

`src/lib/personas/personaThresholds.ts` transcribes `personas.rs:30-45` into `TRUST_WEIGHTS`,
`HEALING_PENALTY_PER_FAILURE`, `VOLUME_FULL_CREDIT_RUNS`, `TRUST_SAMPLE_SIZE`, `HEALTH_FAILING_MIN`
and `TRUST_TIERS`, each with a doc comment. Measured: **6 of the 7 exports have zero consumers**
anywhere in `src/`; only `getTrustTier` is imported (2 sites). Its header cites
`src-tauri/src/db/repos/core/personas.rs` — a path that does not exist (the crate was extracted to
`src-tauri/db/`). A mirror nothing reads cannot drift loudly, and this one has already drifted
quietly: it is a faithful copy of the current Rust values with a stale pointer to where they live.

### D12 — Cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"The band boundaries are scattered with no owner."** They have one — `GRADE_THRESHOLDS` — with
  its history and its rejected alternative in the comment above it, plus `computeGrade` collapsed out
  of three duplicates and a fourth inline. The artifact is right; **the defect is 1 external importer
  against 52 inline ladders.** The path's job is to route people to it.
- **"Nobody asserts the weights."** `compositeHealthScore.ts:104-122` does, for both of its weight
  sets, at module load and in tests. It is 1 of 24 composites and it is the model.
- **"The Rust half is the problem."** It is not. Rust's named-to-bare threshold ratio is ≈ **1 : 2.7**
  against TypeScript's ≈ **1 : 7.5**, and the best absence-handling composite in the repo
  (`renorm_composite`) is Rust. **The band-mapping layer is where nearly all the bare verdict
  literals live, and it is client-side** — which is why the spine's `sides: client` is right and why
  §9's rule is TS-only.
- **The serde-casing scare I created and then refuted.** My first replay of the credential composite
  produced `anomalySubScore = 50` for all 25, because `Remediation` has **two** serializations —
  `as_str()` (`rotation.rs:169-179`) writes snake_case into the persisted ledger snapshot, while
  serde derives PascalCase for the IPC payload — and `REMEDIATION_SCORE` is keyed PascalCase. I read
  the persisted snapshot, matched nothing, and fell into the `?? 50` fallback. **The rendered path is
  correct**; the dot reads the IPC payload. Recorded here because the latent hazard is real (`LedgerAnomalyScore`
  has a ts-rs binding, so the snake_case form *can* reach the frontend) and because a two-implementation
  disagreement caught it — hand-verification against the enum definition, not agreement, is what
  resolved it.
- **"`compute_trust_score` treats `incomplete` as terminal in one clause and not another, 32 lines
  apart."** Both clauses are defensible (§7 D6). **The undefended clause is the third, 47 lines
  apart, with no status filter at all.**
- **Two of the brief's five primed leads describe a state that no longer exists.** See §12.

---

## 8. Gaps

**Gap 1 — Nothing owns "what is an unmeasured input worth", so 18 authors owned 18 answers.** There
is no shared composer, no `Dimension` type, no coverage field. Each sub-score meets the question
alone and answers it from local intuition — 50, 100, or 0 — and the weighted sum then treats all
three as equally earned. **Every deviation about a fabricated score is downstream of this**: D1
(four fabricated dimensions), D2 (60 % constant), D6 (the floor), D7's `renorm_composite` being both
the best construction and the wrong constants. T2 in §4 is the fix and T1 is the first step.
`ascent` closed this gap with one module and the whole class of disagreement went with it.

**Gap 2 — A composite cannot express its own coverage, so a partial score is indistinguishable from
a complete one.** `renorm_composite` and `computeLeaderboard` both renormalize correctly and both
return a bare number: a subject scored on one dimension of three and one scored on three of three
produce the same type on the same scale. `ascent/src/lib/scoring/engine.ts:97-102` pushes a
`warnings` entry naming the excluded dimension and `:171-175` refuses to call a fully-failed scan an
L1 result — that is the missing half, and it is cheap: one `covered: number` field beside the score
captures most of it. It is also the exact shape [`metric-definition`](./metric-definition.md) §8
Gap 3 asks for (`PersonaReliability.total_decided` beside `success_rate`), arriving at a composite
instead of a rate.

**Gap 3 — There is no way to say "this boundary was calibrated for this scale", so a sub-score gets
banded with the composite's thresholds.** `computeGrade(score)` takes a `number`. Nothing in its
signature says the number must be a five-dimension weighted average, and `ScoreBreakdown` passes it
one dimension. A branded `CompositeScore` would reach this and fails Q3 at the render sites; the
reachable version is a second named const (`SUBSCORE_THRESHOLDS`) with a comment, which is a
five-line edit nobody has needed badly enough to make.

**Gap 4 — The census can find a band, but not that two bands are the same concept.** The sharpest
defect in this leaf (D4's 95 % rendering green-and-amber; the 22 % tone disagreement between
`QuickStatsBar` and `VitalsLedger`) is a *relation between two sites*. A regex sees `>= 80 ?` and
`>= 90 ?`; it cannot know both consume a persona success rate. The durable answer is T2's typed
dimension plus a shared band constant; the cheap one is a **cross-module test** in the shape of
`alert_evaluator.rs:403`'s `error_rate_uses_decided_denominator`, asserting that two surfaces grade
the same fixture identically. Recorded here rather than pretended into a signal.

**Gap 5 — The weight-sum invariant is dev-only in both repos that have one, so it cannot catch a
production-only weight source.** `import.meta.env.DEV` and `NODE_ENV !== "production"` both compile
the check away in the shipped bundle. That is correct for a static const and wrong the moment weights
become configurable (§2 (i) asks for exactly that). If `FitnessObjective`'s user-settable weights
(`genome.rs:93-130`, which only *warn* on `|Σ − 1.0| > 0.05` and never reject) are the direction, the
invariant has to move to the write path.

**Gap 6 — The census rule keys on a TypeScript ternary idiom and cannot see three real spellings of
the same condition.** An `if/else if` chain, a `switch`, a lookup array walked with `.find(b => v >= b.min)`
(which is what `getTrustTier` does — the *compliant* shape), and the Rust `match` arms at
`healing.rs:268` / `dev_tools.rs:5928`. The rule's population is 52; the honest population of "a
verdict boundary written where it is drawn" is larger and I did not find a proxy for the rest with
acceptable precision. Stated so an adopting repo re-derives rather than trusting a green run.

---

## 9. The missing gate

**The condition to enforce:** *a multi-band verdict — a grade, a tone, a status word — is decided by
bare numeric boundaries written at the site that renders it, so the band table exists only where it
is drawn and cannot be changed in one place.* Not "a score exists"; not "what a missing input is
worth" (that is a type, T1, and a relation, Gap 4). The one thing in this leaf that is a countable
string and that this repo gets wrong 52 times.

**Checked first that it is not already gated.** `scripts/census/rules.json` holds **135 rules**. None
has an `id`, title or signal containing `score`, `grade`, `band`, `threshold`, `tier`, `weight`,
`verdict` or `severity` in this sense. **File overlap measured** by running my rule and each
candidate neighbour through the real engine in one invocation:

| neighbour rule | its files | shared with mine | % of mine |
|---|---:|---:|---:|
| `empty-sample-as-confident-zero` ([metric-definition](./metric-definition.md)) | 16 | **0** | **0 %** — Rust-only by construction |
| `estimate-typed-as-measurement` ([data-provenance-disclosure](./data-provenance-disclosure.md)) | 11 | **0** | **0 %** |
| `sample-derived-plot-scale` ([chart-component](./chart-component.md)) | 7 | **0** | **0 %** |
| `ordinal-denominator-in-bar-list` ([proportional-bar-list](./proportional-bar-list.md)) | 4 | **0** | **0 %** |
| `absent-entity-count-as-zero` ([aggregate-count-display](./aggregate-count-display.md)) | 30 | 1 | 2.7 % |
| `untranslatable-token-label` ([status-and-severity-badges](./status-and-severity-badges.md)) | 38 | 2 | 5.4 % |
| `locale-blind-percent` ([number-and-cost-formatting](./number-and-cost-formatting.md)) | 55 | 3 | 8.1 % |
| `illegible-foreground-alpha` ([theming-and-contrast](./theming-and-contrast.md)) | 183 | 6 | 16.2 % |
| `hand-rolled-disabled-state` ([design-token-usage](./design-token-usage.md)) | 361 | 6 | 16.2 % |
| `typo-token-overpainted` (same) | 824 | 20 | 54.1 % |

The four rules about *numbers* share **zero** files. The last row is high only because
`typo-token-overpainted` matches 824 of 4,829 files — any rule keyed on render code overlaps it; the
conditions are orthogonal.

**Signals I designed, measured, and rejected — the rejections are the finding:**

| Candidate | Result | Why rejected |
|---|---|---|
| `MAX − problems × k` (the leaf's structural defect) | **5 matches / 1 file** in TS, **0** in Rust with the literal-coefficient form | The condition is the most important one in the document and its *syntactic* population is five lines in one file. The other 13 spell it with a named constant, an early return, or a `filter_map`. Per the corpus's own reasoning ([`llm-spend-accounting.md:715-717`](./llm-spend-accounting.md)) a counter spends its authority on a population this small while the fix is a type. **Named in §0 and D2 with the executed demonstration instead; this is what T1 is for.** |
| a comparison against a bare literal yielding *any* string | 250+ matches, hand-sampled | **~30 % precision.** Dominated by `.length > 60 ? slice(…)` truncation and `> 0 ? 's' : ''` pluralization. Fires on correct content. |
| the same, requiring the literal to be non-zero | still contaminated | `> 1 ? 's were' : ' was'` survives; single-comparison sites are as often a boolean test as a band. |
| **the same, requiring a SECOND comparison against a second bare literal** (a multi-band ladder) | **52 / 37 files, 96 % precision before exclusions, 100 % after** | **Shipped.** The second boundary is the discriminator: one comparison is a test, two is a band table. |
| the mixed-unit threshold (`trust_score < 0.5` on a 0–100 scale, D6) | 1 match | Population of one and the fix is one character. Named in D6. |
| an unasserted weight object | no regex form | Proving "nothing asserts this sum" is an absence, which the census cannot express (doctrine §4). It belongs in an ESLint rule that can see the module's exports, or in a test. Named in Gap 5. |

**The shipped signal is the ladder, not the comparison.** A single `x >= 80 ? 'a' : 'b'` is
ambiguous — it may be a threshold test, a truncation, or a pluralization. **Two boundaries in one
expression is a band table**, and a band table written at a render site is the condition. Requiring
the gap between them to exclude `$`, `{` and `}` keeps the matcher out of template-literal
interpolation, which is where the one surviving pluralization false positive lived.

**Validated standalone** against the real engine
(`node scripts/census/run-census.mjs --rules <scratch>/rules-scoring-thresholds-stK7.json --check`):
`inline-verdict-band` → **37 files / 52 matches**, exit 0;
`named-verdict-band-positive-control` → **7 files / 8 matches**. **Re-extracted from this finished
document by parsing its own fenced blocks and re-run: identical — 37 / 52 and 7 / 8.** The `walked`
figure moved 4,831 → 4,829 between the two runs because a concurrent session was editing the tree;
the rule counts did not, which is the property that matters and the reason `floor` is set well below
either.

**Verified by a second independent implementation — and the two disagreed, which is how the pattern
got its final shape.** The verifier is a private file-content walker with its own directory traversal,
its own URL-safe comment stripper and its own regex assembly, importing nothing from
`lib/engine.mjs`.

- **The census's line-oriented sibling reported 46 / 32; the file-content walker reported 54 / 38.**
  The eight extra are ladders whose `:` falls on the **next line** after the first arm — Prettier
  splits a long `className` ternary across lines, and a line-oriented matcher cannot see the second
  boundary. This is [`golden-path-contract.md:160-163`](../golden-path-contract.md)'s
  "match whole file content, never line-by-line" arriving from the opposite direction: there the
  line-oriented matcher **undercounted 63 of 67**, here it undercounts **8 of 54**, and in both cases
  the miss reads as a clean codebase. The census engine matches whole-file content, so the shipped
  count is 54 minus the two exclusions below.
- **Hand-verified all 54.** Two false positives: `KpiTile.tsx:178`
  (`absPct >= 1000 ? '999+%' : absPct < 0.1 ? '<0.1%'` — a display truncation, both arms are
  formatting for one delta) and `TestReportModal.tsx:350` (`unverified.length > 1 ? 's were' : ' was'`
  reaching across a `${…}` boundary). The `${}` exclusion in the gap removes the second; the first is
  its file's only match and is excluded by path with a reason. **52 remaining, 100 % precision by
  hand count.** Both implementations then agree at 37 / 52 exactly.

**Fail-loud properties** — not asserted, **executed** against the working tree with exit codes
captured:

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified) | **0** | `census OK — 2 rule(s), 9662 file-visits, 60 surviving violation(s) across 44 file(s)` |
| baseline deflated (a rise) | **1** | `[drift] files rose 5 -> 37 (+32). New violations of …scoring-and-thresholds.md` |
| baseline inflated (a silent drop) | **1** | `[drift] files dropped 99 -> 37 (-62) without the baseline moving` |
| `floor` raised to 9000 | **1** | `[structural] walked 4831 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 2000` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 2000` |
| `goldenPath` removed | **1** | `missing grounding — a rule needs "goldenPath" … or "principle"` |
| `exclude` path renamed | **1** | `[structural] exclude "…/MOVED.tsx" matched no file. The exemption is stale` |
| `exclude` `reason` shortened to `"x"` | **1** | `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| **POSITIVE CONTROL — pattern → the COMPLIANT form** | **1** | `[drift] files dropped 37 -> 7 (-30) without the baseline moving` |
| **control given a baseline** | **1** | `must NOT carry a baseline — it exists to fail` |

**Where this runs.** `npm run census:check` is a **pre-push job** (`lefthook.yml`, `golden-path-census`)
and a step of `npm run check`. Both execute on the developer's machine. Per the campaign's §9
calibration this matters: `ci.yml` is red on pre-existing failures, so a CI-only gate would run
nowhere. This one runs before every push, and the hook's own comment records why it was moved there —
*"it was enforced NOWHERE: `census:check` lives only inside `npm run check`, which nothing runs
automatically."*

**How this gate could still fail, stated so the next repo can re-derive it.** The signal proxies for
*"a band boundary lives where the pixel is drawn"*, and it keys on this repo's TypeScript idiom: a
chained conditional expression with two numeric literals and quoted string arms. A repo that spells
the same defect as an `if/else if` chain, a `switch`, a lookup array walked with `.find()`, a
`match` in Rust, or CSS-in-JS breakpoints will match nothing while the condition is present at scale
— the exact portability failure [`golden-path-contract.md:34-60`](../golden-path-contract.md)
documents. **An adopting repo must re-derive its own proxy, and should check the positive control's
population before trusting a green run.** Gap 6 lists the four spellings this rule is blind to here.

**The positive control** carries no `baseline` by design. It matches the *compliant* spelling this
path prescribes — a verdict chosen by comparing against a **named** threshold constant
(`HEALTH_SCORING.unhealthyCutoff`, `TREND_NEUTRAL_BAND`, `BIO_MIN_CHARS`, `BLOAT_TOKENS`,
`STALE_AFTER_DAYS`, `MONITOR_DEFAULT_ABOVE`) — 8 matches in 7 files. The two rules differ in exactly
one respect: whether the boundary has a name. If any regex, walk or engine change broke the
comparison-to-string matcher family, the control goes to zero and the run fails structurally. Its
recall is deliberately narrow — it does not match a `.find(b => v >= b.min)` table walk or an
`if/else` chain — because a liveness probe wants a stable, exactly-understood population rather than
coverage. **It must never be given a baseline.**

**On severity.** This is proposed at the census layer, which is a ratchet, not an `"error"`. The
count may not rise; the existing 52 are a backlog. No argument from warning volume is made or
intended — and specifically, the fact that all 52 render a *plausible* colour is why this is a
ratchet and not an alarm: the defect is invisible at every individual site and legible only as a
population of ten disagreeing band sets.

```json
{
  "id": "inline-verdict-band",
  "goldenPath": "docs/concepts/golden-paths/scoring-and-thresholds.md",
  "title": "A multi-band VERDICT (tone, grade, label) is decided by bare numeric boundaries written at the render site, so the band table exists only where it is drawn",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:>=|<=|>|<)\\s*(?:0\\.\\d*[1-9]\\d*|[1-9]\\d*(?:\\.\\d+)?)\\s*\\?\\s*['\"][^'\"\\n]*['\"]\\s*:[^?;\\n${}]{0,90}?(?:>=|<=|>|<)\\s*(?:0\\.\\d*[1-9]\\d*|[1-9]\\d*(?:\\.\\d+)?)\\s*\\?",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a chained ternary mapping a number onto TWO OR MORE categorical outcomes with bare numeric boundaries written at the call site. THE SECOND COMPARISON IS THE DISCRIMINATOR: one comparison against a literal is ambiguous (a boolean test, a `.length > 60` truncation, a `> 1 ? 's' : ''` pluralization — all measured, all rejected at ~30% precision); two boundaries in one expression is a BAND TABLE. Zero is excluded from both literals so `c.red > 0 ? 'red' : c.yellow > 0 ? 'yellow'` (presence tests, not bands) does not match. The gap between the arms forbids `$`, `{` and `}` so the matcher cannot cross a template-literal interpolation — that was the one surviving false positive. PROXY FOR the stack-free condition: a band boundary lives where the pixel is drawn rather than beside the formula, so it cannot be changed in one place. Measured 2026-08-16: 52 sites in 37 files use TEN distinct three-way boundary sets to band one kind of 0-100 quality number, of which exactly one set (80/50) is the value GRADE_THRESHOLDS declares — and 6 of the 8 sites using it re-type it as literals. 43 of the 52 (83%) have no unmeasured arm in front of the ladder. Replayed against the operator's live database: banding the 59 measured personas' success rates with QuickStatsBar.tsx:50 (80/50) and VitalsLedger.tsx:177 (90/70) renders a DIFFERENT tone for 13 of them (22%). LEGAL FIX: import the shared band — GRADE_THRESHOLDS + computeGrade (compositeHealthScore.ts:133,238), whose own comment records that computeGrade was already collapsed out of three duplicates and a fourth inline; or, if the concept genuinely needs different bands, declare a named const beside the formula with a comment saying why it differs. If the payload already carries a grade, render the grade. CONVERGENT: brainiac/brainiac-server/src/console.rs:2731 imports three constants from its health registry and redefines grade_of two lines below, so 50-54 grades 'At risk' from the core and 'Critical' from the API; brainiac console/src/health/KnowledgeHealth.tsx:116 re-derives a grade the server already sent, rendering 82 as 'Watch' in the header and 'Healthy' in the chart. ascent/src/lib/maturity/model.ts is the counter-example with ZERO band disagreements and a SCORING_RUBRIC_VERSION wired into its cache key. PRECONDITION (must be re-derived per repo): this repo spells a band as a chained TypeScript conditional expression with quoted string arms. A repo using an if/else-if chain, a switch, a `.find(b => v >= b.min)` table walk, or Rust match arms will score zero while the condition is present at scale."
  },
  "exclude": [
    {
      "path": "src/features/overview/components/shared/KpiTile.tsx",
      "reason": "the file's only match is a display truncation, not a verdict: absPct >= 1000 renders the string '999+%' and absPct < 0.1 renders '<0.1%'. Both arms are number-formatting for one delta, owned by number-and-cost-formatting.md, and neither arm picks a tone, grade or status word"
    }
  ],
  "baseline": { "files": 37, "matches": 52 },
  "floor": 2000
}
```

```json
{
  "id": "named-verdict-band-positive-control",
  "goldenPath": "docs/concepts/golden-paths/scoring-and-thresholds.md",
  "title": "POSITIVE CONTROL - a verdict chosen by comparing against a NAMED threshold constant rather than a bare literal",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:>=|<=|>|<)\\s*(?:[A-Z][A-Z0-9_]{2,}|[A-Za-z_][A-Za-z0-9_]*\\.[a-z][A-Za-z0-9_]*(?:Cutoff|Threshold|healthy|degraded|Band|Limit))\\s*\\?\\s*['\"][^'\"\\n]*['\"]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL, deliberately carrying NO baseline. Matches the CORRECT spelling this path prescribes: a categorical outcome chosen by comparing against a NAMED threshold constant rather than a bare numeric literal. Present at useHealthCheck.test.ts:87-88 (HEALTH_SCORING.unhealthyCutoff / .degradedCutoff, themselves derived from GRADE_THRESHOLDS), compositeHealthScore.ts:404 (TREND_NEUTRAL_BAND), useTwinReadiness.ts:64 (BIO_MIN_CHARS), FleetContextPill.tsx:61 (BLOAT_TOKENS), fleetGridView.ts:45 (MONITOR_DEFAULT_ABOVE), populateDispatch.ts:83 (STALE_AFTER_DAYS), MonitorLedger.tsx:65 (FIRST_NUMERIC_COL) - 8 matches in 7 files. It exists to prove the sibling rule's comparison-to-string matcher family is alive: inline-verdict-band distinguishes itself from this one ONLY by whether the boundary has a name, so if a regex or walk change ever broke the comparison match, this control goes to zero and the run fails structurally. Recall is deliberately narrow - it does not match a `.find(b => v >= b.min)` table walk (which is how getTrustTier does it, and which is also compliant), an if/else chain, or a Rust match - because a liveness probe wants a stable, exactly-understood population, not coverage. It must never be given a baseline."
  },
  "floor": 2000
}
```

**Three conditions in this leaf I am refusing to gate, with the measurement that justifies each
refusal:**

1. **A sub-score that awards full marks for silence** (§0, D1, D2) is the leaf's most important
   defect and its syntactic population is **5 lines in 1 file**. The other 13 of the 18 spell it with
   a named coefficient, an early return, or a `filter_map` over `Option`. A regex that caught all 18
   would have to understand what "no input" means, which is a type question. **T1 is the answer;
   a counter is not.**
2. **Two band sets grading the same concept** (D4, D9) is a *relation between two sites*, not a
   string. `>= 80 ?` and `>= 90 ?` are individually well-formed and jointly contradictory, and no
   regex can know both consume a persona success rate. The durable answer is a shared band constant;
   the cheap one is a cross-module test in the shape of `alert_evaluator.rs:403`. Recorded in Gap 4.
3. **An unasserted weight sum** (D7, Gap 5) is an **absence**, which the census cannot express by
   construction (doctrine §4). Proving "nothing checks that these four constants sum to 100" needs a
   module-level view, not a pattern. It belongs in an ESLint rule that can read the exports, or —
   better and cheaper — in the 19-line dev-time throw that `compositeHealthScore.ts:104-122` already
   ships and that 22 of 24 composites could copy today.

---

## 12. Corrections to the brief

**12.1 — The spine says `sides: client` and also `twoSided: true`; `client` is right, and the
measurement inverts the usual expectation.** Rust's named-to-bare threshold ratio is ≈ **1 : 2.7**;
TypeScript's is ≈ **1 : 7.5**. The best absence-handling composite in the repo (`renorm_composite`,
`fitness_driver.rs:337-347`) is Rust, and Rust holds 250 named threshold constants against
TypeScript's 157. **The Rust half is real but it is the healthier half**; the client half owns the
band-mapping layer where 224 of the bare verdict literals live and where all 52 census matches are.
The path is written client-first with the Rust half in D6, D7 and D10 rather than fused.

**12.2 — Two of the five primed leads describe a state that no longer exists, and the third is
partly wrong.**

- *"A failed read raised a status score 5 points and flipped DEGRADED to HEALTHY."* **Fixed hours
  before this sweep**, at `useStatusPageData.ts:186-205` (`19f56eb2e`, 2026-08-16). I re-ran the
  counterfactual independently and reproduce the direction and magnitude — **+5 points** with the
  healing fetch rejected — so the finding was real. **What survives, and what the brief's framing
  hid, is that the fix covers the fetch and not the entry**: 19 personas that carry
  `hasSlaData: false` still contribute a fabricated **70** to `computeGlobalScore` (§0, D1). The
  primed lead was a *closed* case whose *open* half is bigger.
- *"`computeGlobalScore` averaged over survivors while `computeGlobalUptime`, 14 lines away, filtered
  no-data entries."* Same commit. The observation that **nullability, not discipline, propagated the
  fix** is the most valuable sentence in the brief and it is now a comment in the source — and it is
  *still* true, because `score` is still `number` and has now been patched twice.
- *"`compute_trust_score` treats `incomplete` as terminal in one clause and not in another, 32 lines
  apart."* The two clauses are at `:1470` and `:1502` — exactly 32 lines — and **both are
  defensible**: one is an outcome window, the other a spend window, and an incomplete run still cost
  money. **The undefended clause is the third**, at `:1516-1517`, 47 lines below the first, which has
  no status filter at all and lets any non-failed row reset the failure streak to zero. Latent today
  (5 of 59 personas have a non-terminal head row; none has a streak behind it) and one queued run
  from live.
- *"`dev_kpi_measurements.source` is a six-arm CHECK'd union; a chart tested one arm."* **Chart half
  fixed** the same day (`KPIDashboard.tsx:161-174`, and the inversion it applies is the model this
  path recommends). **Label half not fixed**: `t.kpis.measurement_source` has **5 arms in all 14
  locales**, so an `ai-compose` measurement renders the raw machine token (D8).
- *"Thresholds live as bare numbers in many places — measure how many are named, shared, or
  configurable, and whether any two disagree."* **Confirmed and quantified**: TS ≈ 12 % named,
  ~2 % configurable repo-wide, and **ten distinct boundary sets for one kind of 0–100 number**, with
  22 % of live subjects rendered a different tone by two of them.

**12.3 — The brief's framing of the defect as `100 − problems × k` is correct about the mechanism
and understates the reach.** It is not only that a failed source scores as good news; it is that
**60 % of one live composite is a constant**, that **two of its four tiers are unreachable**, and
that **the sub-score hardened against exactly this failure is outvoted by its own neighbours in the
same file**. The mechanism is the brief's; the magnitude required replay.

**12.4 — A correction to my own work, recorded because it is the kind that hides.** My first replay
of the credential composite reported `anomalySubScore = 50` for all 25 credentials and a tier
distribution including `degraded`. It was wrong: `Remediation` has **two** serializations — snake_case
via `as_str()` into the persisted ledger, PascalCase via serde over IPC — and I read the persisted
one, matched none of `REMEDIATION_SCORE`'s PascalCase keys, and landed in its `?? 50` fallback. The
rendered path is the IPC one and is correct. **Two implementations agreeing would not have caught
this; opening the enum definition did.** The latent hazard is real and is noted in D12: the
snake_case form has a ts-rs binding of its own, so it *can* reach the frontend, where the same
lookup would silently return 50 for every arm.

**12.5 — The convergence oracle found a sibling ahead of this repo on the leaf's central question,
which the brief did not anticipate.** `ascent/src/lib/maturity/model.ts` + `scoring/engine.ts` own
the formulas, the band table, three weight lenses and a `SCORING_RUBRIC_VERSION` folded into the scan
cache key; exclude failed dimensions with a user-visible warning and renormalize; persist per-org
thresholds with a sanitizer that rejects an always-pass gate; and have **zero** band disagreements,
with the one unavoidable duplicate pinned by a test. This repo has the better *incident record* —
four rejected alternatives preserved at the site of the fix, more than any sibling — and the weaker
*default*. Reported as a direction, not as taste.
