# Golden path — Anomaly marker

> Situation node: `product-surfaces/monitoring-surfaces/anomaly-marker` ·
> [situation spine](../situation-spine.md) · recurrence **8** · risk **MEDIUM** ·
> sides: **client** (**contradicted** — see [§12.1](#121--sidesclient-contradicted-again-and-the-marker-is-the-only-client-part)) ·
> convergence: **mixed** (**not tested** — see [§12.5](#125--what-was-not-done)) ·
> dimensions: **ui · function · performance**
> Composed 2026-08-17 against `master` @ `6c97502d3`. **Mode-2 short form** — spine header,
> §0, §2, §7, §9, §12. The quality core is unchanged: two implementations of every count, a
> positive control, hand verification, re-extraction from the finished document.
>
> **Sweep size.** Both daily-cost anomaly detectors in `db/src/repos/execution/metrics.rs`
> (`detect_rolling_anomalies` `:885-926`, `detect_chart_anomalies` `:929-943`, `detect_anomalies`
> `:947-991`, and the inline σ detector at `:1404-1445`) transcribed line by line into JavaScript
> and replayed against real data. Every frontend consumer of the word *anomaly* opened — **21
> files** across `src/features/overview/**`, `src/features/vault/**` and `src/lib/bindings/**`.
>
> **Measured by execution.** A read-only **copy** of the operator's live `personas.db` (347 MB),
> taken 2026-08-17 with the app running; the live file was never opened for write and **the copy
> was deleted at the end of composition**. `get_chart_data`'s exact `GROUP BY DATE(created_at)`
> SQL was replayed at each of the four ranges the `DayRangePicker` offers (1 / 7 / 30 / 90) plus
> two beyond it, and both detectors were run over the resulting point series.
>
> **Primed, then verified.** Three claims arrived from `scoring-and-thresholds` and
> `credential-rotation-and-revocation`. **All three verified** — `anomalySubScore` returns `100`
> on no data; `AnomalyScorePanel`'s `Record<string, …>` disarms a PascalCase union; `credential_events`
> holds 0 rows against 25 live credentials. They are **cited here, not re-derived**.

---

## 0 The headline: two detectors, one quantity, 9 marks against 1 — and at the range the app opens on, neither can mark anything

Daily execution cost is judged for anomalousness by **two** independent detectors, in the same
Rust file, over the same rows, on two different Overview tabs.

| | **A** — Observability tab | **B** — Activity tab |
| --- | --- | --- |
| source | `metrics.rs:929-943` `detect_chart_anomalies` → `MetricsChartData.anomalies` | `metrics.rs:1404-1445`, inline in `get_execution_dashboard` → `cost_anomalies` |
| window | **5** preceding points | **7** preceding points |
| minimum samples | **1** | **3** |
| statistic | **% deviation** from the mean | **σ** from the mean |
| fires when | `> +100 %` **or** `< −50 %` | `> +2 σ` **only** |
| zero handling | `if value == 0.0 { continue }` (`:895-898`) | none |
| execution link | `\|_\| None` — always null | top execution ids per date, **and rendered** |
| rendered as | a pulsing `ReferenceDot` on the cost chart (`sub_observability/MetricsCharts.tsx:108-128`) | a highlighted x-axis date (`sub_activity/MetricsCharts.tsx:67`) + a card list (`ExecutionMetricsDashboard.tsx:111-118`) |

Replayed over this install's **17 days** with executions:

```
   1d  points=  0   A= 0   B= 0
   7d  points=  0   A= 0   B= 0
  30d  points=  0   A= 0   B= 0     <-- the app's DEFAULT range
  90d  points= 17   A= 9   B= 1     agree on 1 · A-only 8 · B-only 0
```

**A marks 9 of the 17 days. B marks 1. They agree about one day.** Seven of A's nine marks are
*drops* — a direction B cannot express, because it has no lower bound.

A's positive rate is **9 of 16 judgeable points (56.3 %)**. A detector that marks more than half
of what it sees is not marking outliers; it is marking the data. The cause is arithmetic and
visible in the constants: a `< −50 %` lower bound means *any day below half the running mean is
an anomaly*, and daily spend on a locally-driven desktop app is bursty by construction.

And the range matters more than either threshold. `chart_points` exist only for days that
*have* executions (`GROUP BY DATE(created_at)`, no gap filling); the last execution on this
install was **2026-06-26**, 52 days before composition. So at 1 d, 7 d and the **default 30 d**
(`OverviewFilterContext.tsx:44`) the series is empty and **no marker of either kind can appear**.
The only range that renders anything is 90 d, where A paints 9 pulsing diamonds across a
two-and-a-half-week band in June.

Two more properties, both structural rather than data-dependent:

- **A cannot see a drop to zero.** `detect_rolling_anomalies` opens with
  `let value = extract_value(&items[i]); if value == 0.0 { continue; }` (`:894-898`). The single
  most alarming thing a cost or throughput series can do — go to zero — is the one value the
  detector skips, and it skips it *before* computing the deviation that would have been exactly
  −100 %. The lower bound exists and cannot reach the bottom of its own range.
- **"a rolling 5-day window" is a rolling 5-*point* window.** The docstring at `:929-930` says
  days. The code indexes `items`, and `items` are days-with-activity. Measured on this install:
  **1 of 16 adjacent point pairs is more than one calendar day apart, the largest gap is 8 days,
  and the worst calendar span of a "5-day window" is 12 days.** A quiet week silently widens the
  baseline it is compared against.

The spine's `why` for this leaf is *"outliers marked on a chart and clickable through to a root
cause."* The click-through exists (`useAnomalyDrilldown.ts:35-60` → `AnomalyDrilldownPanel`) and
is well built — a sequence guard against out-of-order responses, with the failure it prevents
written down. But `MetricAnomaly.execution_id` — the field the detector fills with the worst
execution of that day — **has zero readers in the entire frontend.** The drilldown sends
`date`, `metric`, `value`, `baseline`, `deviation_pct` and re-correlates by date on the server.
The link is computed, serialized, typed, shipped across IPC, and dropped.

---

## 2 The one way (compact)

**Decide what "unusual" means for this series before you pick a threshold, put the decision in
one named detector, and make a mark carry its own justification and its own way back to the
cause.** Concretely: (a) **one** detector per quantity — if two surfaces show the same series,
they call the same function, because two detectors over one quantity is a disagreement the user
sees as a bug in the data; (b) index the baseline by **time**, not by array position — a rolling
window over a gap-filled series, or an explicit `date - N days` predicate, so a quiet week does
not widen the baseline; (c) **zero is a value, not an exemption** — a series that drops to zero
is the case the detector exists for, and `if value == 0 { continue }` removes it; distinguish
*no sample that day* (no row: skip) from *a sample of zero* (judge it); (d) choose the statistic
from the series' distribution and **assert the resulting positive rate in a test** — a rolling
σ threshold and a fixed-percentage threshold disagree by an order of magnitude on bursty data,
and the only honest way to pick is to run both over the real corpus and look at how many days
get marked; (e) a mark carries `date`, `value`, `baseline`, the statistic, **and the identity of
the thing that caused it** — and the drilldown consumes that identity rather than re-deriving a
correlation by date; (f) the marker's own visual state must distinguish *no anomalies* from
*no data*, because at every range this app opens on, the second is what is actually happening.

Downstream of the mark — the badge, the tier, the colour — belongs to
[`scoring-and-thresholds`](./scoring-and-thresholds.md) and
[`status-and-severity-badges`](./status-and-severity-badges.md). Do not add a fourth band table
here.

---

## 7 Deviations

### D1 — two detectors, one quantity, 9 marks versus 1 · executed

Both live in `db/src/repos/execution/metrics.rs`. A (`:929-943`) is 5-point / ±100 % / −50 %; B
(`:1404-1445`) is 7-point / ≥3 samples / +2 σ, upward only. Over the same 17 days: **A = 9,
B = 1, intersection = 1**. A user who reads the Activity tab and then the Observability tab sees
one anomalous day become nine, with no affordance anywhere telling them the two charts asked
different questions.

Neither detector is wrong on its own terms. The defect is that there are two.

### D2 — the drop-to-zero exemption · read, structural

`metrics.rs:894-898`. `value == 0.0 → continue`, evaluated before the baseline is computed. The
`-50.0` lower bound can therefore reach −99.9 % and never −100 %. On this install the exemption
costs nothing (**0 zero-cost days in 365 d of chart points**), which is exactly why it will
survive: it is invisible until the first day the fleet stops, which is the first day anyone
wants a marker.

The neighbouring guard, `if baseline == 0.0 { continue }` (`:906-908`), is correct — a division
by zero. The `value` guard was almost certainly written beside it by analogy and does something
entirely different.

### D3 — "5-day rolling window" is 5 points · executed

`detect_chart_anomalies`'s docstring (`:929-930`) says *"a rolling 5-day window"*. The
implementation is `let start = i.saturating_sub(window)` over the `chart_points` array
(`:900-901`), and `get_chart_data`'s SQL emits one point **per day that has rows**
(`:761-774`, `GROUP BY DATE(created_at)`). Measured on 365 d of this install's data: **1 of 16
adjacent pairs spans more than one calendar day; the largest single gap is 8 days; the worst
calendar span of a "5-day window" is 12 days**, ending 2026-06-25. The comment and the code
agree on any dense series and diverge silently on a sparse one — and a locally-driven desktop
app's series is sparse by nature.

The same defect, one order worse, in B: a 7-point window with a `< 3 samples` guard means B's
baseline can span an arbitrary amount of calendar time and it will never notice.

### D4 — at the default range there is no series, so there are no markers · executed

`OverviewFilterContext.tsx:44` initialises `dayRange` to **30**; `DayRangePicker.tsx:10-15`
offers 1 / 7 / 30 / 90. Replayed: chart points at 1 d / 7 d / 30 d = **0 / 0 / 0**; at 90 d =
**17**. So the Observability chart's entire anomaly feature is reachable only by clicking the
one range the user is least likely to pick, and at the other three the chart shows nothing while
saying nothing about why.

`MetricsCharts.tsx:174-182` gates the whole anomaly summary strip on `costAnomalies.length > 0`,
so the surface is silent in both the *no anomalies* and *no data* cases — the empty-state
cascade [`empty-and-demo-states`](./empty-and-demo-states.md) prescribes, collapsed to one arm.

### D5 — a 56 % positive rate, and no test asserts one · executed

**9 of 16 judgeable points marked.** Nothing in the tree measures this. `detect_rolling_anomalies`
has no unit test; the thresholds `100.0, -50.0` are passed as **bare positional arguments** at
both call sites (`:939-940`, `:988-989`) with no named constant, no comment on how they were
chosen, and no fixture. B's `2.0` is a bare literal inside the loop (`:1428`).

A detector's threshold is not a preference — it is a claim about the distribution of the series,
and it is testable in one assertion (see §9's instrument spec).

### D6 — the marker computes a link to the cause and throws it away · read

`MetricAnomaly` (`bindings/MetricAnomaly.ts:6`) carries `execution_id: string | null`.
`detect_anomalies` fills it from a per-date worst-execution map (`:975-987`);
`detect_chart_anomalies` passes `|_| None`, so **every anomaly on the Observability chart has
`execution_id: null` by construction**. And it does not matter, because a grep for readers of
that field across `src/**` returns **zero**: `useAnomalyDrilldown.ts:42-49` sends
`{anomalyDate, anomalyMetric, anomalyValue, anomalyBaseline, anomalyDeviationPct, personaId}`
and the backend re-derives the correlation from the date.

`DashboardCostAnomaly` gets this right — it carries `execution_ids` (plural) and
`MetricsCards.tsx:28-32` renders them as links. Two anomaly types, one drops its link, and the
one that drops it is the one on the chart the spine's `why` is about.

### D7 — error-rate and latency anomalies exist and can never reach a chart · executed, 36 would fire

`detect_anomalies` (`:947-991`) emits three metrics: `cost`, `error_rate`, `latency`. It is
called from exactly one place — `get_prompt_performance` (`:996+`), the per-persona prompt
dashboard. The Observability chart's consumer then does
`anomalies.filter((a) => a.metric === 'cost')` (`sub_observability/MetricsCharts.tsx:80`), which
is a no-op there because `detect_chart_anomalies` only ever produces `"cost"`.

Replayed across all 78 personas over 365 days: the error-rate detector **would emit 36 anomalies
across the 59 personas that have at least one daily point**. None of them is rendered on any
chart in the app.

Worse, the thresholds are shared. `error_rate` is a **percentage**, and it is judged by the same
`+100 % / −50 %` *relative* deviation as dollars — so an error rate moving from 1 % to 2.5 % is a
+150 % anomaly, and one moving from 40 % to 55 % is not. Passing a percentage through a
percent-deviation detector is a category error that the positional-argument call site makes
invisible at the point of use.

### D8 — the credential anomaly panel cannot render any severity but "Healthy" · cited, verified

Not re-derived — this is `credential-rotation-and-revocation` §7 (P1 E) and
`scoring-and-thresholds` D10, re-verified here because it is this leaf's second marker surface:

- `bindings/Remediation.ts:6` is `"Healthy" | "BackoffRetry" | "PreemptiveRotation" | "RotateThenAlert" | "Disable"` — **PascalCase**, serde-derived.
- `AnomalyScorePanel.tsx:6-12` declares `REMEDIATION_LABELS: Record<string, …>` keyed
  `healthy` / `backoff_retry` / `preemptive_rotation` / `rotate_then_alert` / `disable` —
  **snake_case**, and typed `Record<string, …>`, which is what disarms the union.
- `:17` is `REMEDIATION_LABELS[score.remediation] ?? REMEDIATION_LABELS.healthy!` — so **every**
  value misses, and the fallback is the *good* one: a credential the backend has classified
  `Disable` renders an emerald "healthy" chip.

Typing it `Record<Remediation, …>` makes all five keys a compile error — the type-over-gate fix,
one word.

The sibling map gets it right: `credentialHealthScore.ts:27-33` `REMEDIATION_SCORE` is
`Record<Remediation, number>` with PascalCase keys. **Two maps over one enum, in one feature,
disagreeing on casing, and only the typed one is correct.**

### D9 — `anomalySubScore(null) === 100`, with the comment saying so · cited, verified

`credentialHealthScore.ts:51-54`:

```ts
function anomalySubScore(anomaly: AnomalyScore | null): number {
  if (!anomaly) return 100; // no data = assume healthy
  return REMEDIATION_SCORE[anomaly.remediation] ?? 50;
}
```

Verified against the live copy: `credential_events` holds **0 rows** against **25** live
credentials, so this branch is the one that runs. Its sibling `healthcheckScore` was hardened for
exactly this reason and returns `50` for "untested", with a comment recording the fix
(*"Scoring it 100 made the composite dot claim 'healthy' for credentials nothing ever checked"*)
— and it is outvoted 60:40 by `anomalySubScore` and `rotationSubScore`, three and eight lines
below it, under the same weights object. `scoring-and-thresholds` D2 owns this; recorded here
because the anomaly sub-score is *this* leaf's contribution to it.

### D10 — cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **`useAnomalyDrilldown` is correct.** Its `fetchSeqRef` sequence guard (`:27-33`) prevents an
  earlier response overwriting a later one, and the comment names the exact user-visible failure
  ("*the user sees B's metadata paired with A's correlated events*"). This is the best
  stale-response guard read during this batch.
- **The rAF ingest in `LiveStreamTab` is not this leaf's.** Checked and left alone; see
  [`live-event-console`](./live-event-console.md) §7 D1.
- **`percentile()` (`metrics.rs:857-873`) is a correct linear-interpolation percentile** with
  explicit `len==0` and `len==1` arms. No defect.
- **The per-scope snapshot cache and `MissedTickBehavior::Delay`** in the alert evaluator are
  exemplary and are cited as such by two other paths. Not touched here.
- **`AnomalyDrilldownPanel.tsx:5` imports `feedback/LoadingSpinner`**, which renders `null`. Real,
  and it belongs to the loading doctrine, not to this leaf — recorded for traceability only.

---

## 9 The missing gate — a reasoned decline, with the numbers

**No census rule is proposed for this leaf.** Two candidate signals were built and measured;
both failed, in different ways, and the failures are more useful than a weak rule would be.

**Candidate 1 — "a `Record<string, …>` presentation map keyed in the wrong case against a
PascalCase ts-rs union" (D8).** Implemented: parse every `src/lib/bindings/*.ts` for a string
union whose members are *all* PascalCase; for each module importing one, find
`Record<string, …>` object literals and flag those with ≥2 keys matching the union's members in
snake_case.

- ts-rs string unions in this repo whose members are all PascalCase: **3**
  (`ConnectionState`, `ErrorClass`, `Remediation`).
- Matches: **0** — including on `AnomalyScorePanel.tsx`, the file the signal was written from.

The reason is instructive: `AnomalyScorePanel` imports `AnomalyScore` **from
`@/api/vault/rotation`**, not `Remediation` from `@/lib/bindings/`. The union reaches it
structurally, through a field type, never by name. **A signal keyed on an import statement
cannot see a type that arrives as a field.** Widening it to "any module transitively reaching a
PascalCase union" makes the denominator most of the app and the precision unmeasurable.
Population **3** is also too small to ratchet: one new PascalCase enum moves the rule by 33 %.

**Candidate 2 — "a rolling-deviation detector with positional magic thresholds" (D5, D7).**
Population in the entire tree: **2** call sites (`metrics.rs:939-940` and the inline σ loop at
`:1428`). A census rule over a population of two is a note with a runner attached.

**And the leaf's four largest findings are not countable at all.** D1 (two detectors), D4 (no
data at the default range), D6 (a field with zero readers) and D5 (a 56 % positive rate) are all
*absences or comparisons between two artifacts*, which the census "cannot assert" by
construction. Counting the presence of a detector says nothing about whether a second one
disagrees with it.

### The instrument that would work, specified

A **test**, in the detector's own crate, that asserts the *positive rate* over a fixture corpus:

1. Fix a corpus — the committed fixture series, or a synthetic one with a declared distribution.
2. Run every registered detector over it.
3. Assert (a) each detector's marked fraction is inside a stated band (e.g. 2–15 % of judgeable
   points), and (b) **any two detectors over the same quantity agree on ≥ 90 % of marks.**

(b) is the one that fails today, immediately and loudly, and it is the assertion no amount of
counting can substitute for. Note the trap [`client-rule-mirroring`](./client-rule-mirroring.md)
records: if each detector ships its *own* fixtures, both suites stay green forever while they
drift. **One corpus, N detectors.** And per the contract's fail-loud requirement, the test must
fail if the corpus yields zero judgeable points — otherwise it passes on an empty fixture exactly
the way the Observability chart currently passes on an empty range.

---

## 12 Corrections

### 12.1 — `sides: "client"` contradicted again, and the marker is the only client part

Every deviation from D1 to D7 is in one Rust file. The client's entire contribution to this leaf
is `MetricsCharts.tsx:80` (a filter that is a no-op), `:108-128` (the `ReferenceDot`), and
`useAnomalyDrilldown.ts` (which is correct). D8/D9 are client-side and are cited from other
paths, not found here.

Ledger: this is the **ninth** contradiction of `sides: "client"` against two upholdings. It
matches the mode `alert-rule-editor` §12.1 identified an hour earlier in the same batch — the
label names *where the pixel is*, and for a monitoring surface the pixel is never where the
answer lives.

### 12.2 — the brief's three primed leads: two verified, one re-scoped

- *"`anomalySubScore` returns 100 on no data (25/25 live, `credential_events` 0 rows)"* —
  **verified exactly.** D9.
- *"`AnomalyScorePanel.tsx:6-17` renders an emerald 'Healthy' chip for a `Disable`-level
  credential because a `Record<string,…>` lookup disarmed the union"* — **verified exactly**, and
  the sibling map `REMEDIATION_SCORE` was found to be typed correctly, which makes the pair the
  cleanest available demonstration of the type-over-gate rule. D8.
- *"`data_stale` has three readers licensing three conclusions"* — **not re-derived.** It is
  `scoring-and-thresholds` D10 and it is about the credential composite, not about a marker. This
  leaf's only contact with `data_stale` is `AnomalyScorePanel.tsx:29`, which renders it as a
  "stale" pill — correct behaviour at that one site.

### 12.3 — the brief's own question, answered, and the answer is worse than the question

The brief asked: *"where anomaly markers render, and whether any marker can currently fire at
all."*

**Six surfaces render something called an anomaly**, and they are not one feature:

| surface | type | source |
| --- | --- | --- |
| `sub_observability/MetricsCharts.tsx:108` | `MetricAnomaly` | detector A |
| `sub_activity/MetricsCharts.tsx:67` + `MetricsCards.tsx` + `ExecutionMetricsDashboard.tsx:111` | `DashboardCostAnomaly` | detector B |
| `sub_health/useStatusPageData.ts:181` `costAnomalyCount` | `DashboardCostAnomaly` | detector B, counted |
| `libs/fleetOptimizer.ts:177` `recentAnomalies` | `DashboardCostAnomaly` | detector B, filtered by date |
| `vault/.../AnomalyScorePanel.tsx` | `AnomalyScore` / `Remediation` | the credential healthcheck ring buffer |
| `sub_analytics/RotationOverviewPanel.tsx:173` `stats.anomalies` | a rotation statistic | neither detector |

Plus `LedgerAnomalyScore` and `DigestAnomaly` in `src/lib/bindings/`, which are two more
vocabularies for the word.

**Can any of them fire?** Detector A: only at the 90 d range, where it fires on 9 of 17 days.
Detector B: 1 day, same range. The credential panel: it fires — and renders emerald "Healthy"
whatever it says (D8). So the honest answer is "yes, and you would not be able to tell":
the one marker that is currently reachable is over-firing at 56 %, and the one that fires
correctly is mislabelled at 100 %.

### 12.4 — a measurement corrected during composition

The first replay of detector A reported the wrong denominator. Counting "9 anomalies out of 17
points" implies a 53 % rate, but the first point can never be marked (`preceding.is_empty()` →
`continue`, `:902-904`) and neither can a zero-value point (D2). The judgeable denominator is
**16**, giving **56.3 %**. The direction of the error was to *understate* the rate — and it
agreed with the thesis, which per the doctrine is the condition under which a measurement most
needs re-running. Re-run, and it got worse.

### 12.5 — what was not done

- **The convergence oracle was not run.** The node claims `convergence: mixed`; untested here.
  This is a Mode-2 batch of three leaves sharing one measurement pass and the sibling sweep was
  the item cut. Recorded as owed, and deliberately **not** reported as a silence — an unrun sweep
  is not evidence in either direction.
- **No fix was applied**, per the campaign's no-destructive-applies rule. D8's fix
  (`Record<string, …>` → `Record<Remediation, …>`) is one word and changes what a live surface
  shows; it belongs in [`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md).
- **§1, §3, §4, §5, §6 and §8 are omitted** by the short-form tier. Nothing measured was dropped
  to fit; what is missing is prose, not evidence.
