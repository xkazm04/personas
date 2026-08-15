# Metric definition

> **Topic path:** `product-surfaces` › `metrics-and-charts` › `metric-definition`
> **Composed:** 2026-08-15 · **Leaf recurrence:** 37
> **Sweep:** 953 `.rs` and 3,790 `.ts`/`.tsx` files walked by two independent matchers; every
> Rust site computing a field named `success_rate` read in full (17), plus 16 more of the same
> shape under other names; 10 client-side recomputations read in full; the census engine's
> `rules.json` (84 rules) and `lib/engine.mjs` read for overlap and fail-loud semantics.
> **The central claims are EXECUTED, not asserted** — against a read-only copy of the operator's
> live 347 MB `personas.db` (2,188 executions, 2026-06-03 → 06-26), replaying each definition's
> own SQL side by side. Convergence measured against `../personas-web`, `../brainiac` and
> `../personas-cloud`.
> **Shared facts cited:** [`shared-facts.json`](../shared-facts.json) — 963 Rust files, 4,829
> `.ts`, 2,104 `.tsx`, 1,135 lint warnings / 0 errors at `211d519bb`.

---

## 1. Trigger

You are in this situation when you say or type any of:

- "what does this number actually count?" / "why does the dashboard say 89% and the digest say 96%?"
- "add a success rate to this panel" / "show the failure rate for this trigger"
- "is that last 24 hours, or today?" / "which timezone is this day?"
- "this metric looks wrong" / "these two screens disagree"
- "it says 0% but nothing has run yet"

**The "if you are about to write X" test.** If you are about to write a `/` whose numerator is a
count and whose denominator is another count — or a `WHERE status IN (…)` that will end up under
a percent sign, or a `datetime('now', '-N days')`, or an `else { 0.0 }` after a `> 0` guard — you
are here.

### The seam: confirmed, and it holds in both directions

[`chart-component.md`](./chart-component.md) drew this boundary before this path existed and
[`proportional-bar-list.md`](./proportional-bar-list.md) re-measured it. The discriminating
question is:

> **Does decoding a mark require a scale the mark itself does not carry?**

**Yes** → `chart-component`. **No, because the mark carries its own denominator and prints its
value beside it** → `proportional-bar-list`. **There is no mark at all — the question is what the
number counts, over what window, from what source** → **here**.

`chart-component.md:41` predicted this leaf inherits *"derivation, window, unit, and
comparability."* It does, and the sweep sharpened the seam in the one direction the siblings could
not see. Both of them own a *geometry* whose denominator is a property of the picture: the bar
list's denominator is chosen so a track means something, and the chart's domain is chosen so a
position means something. **Neither can be wrong about the world.** A bar drawn against
share-of-max and one drawn against share-of-total encode identical ratios
([`proportional-bar-list.md:304-316`](./proportional-bar-list.md), executed). This leaf's
denominators are *not* interchangeable: on this repo's live data, `completed / (completed+failed)`
and `completed / COUNT(*)` differ by **0.90 pp** today and by **17.8 pp** at 20% in-flight load
(§7 D1), and `personas.rs`'s definition differs from `sla.rs`'s by **up to 32 percentage points**
for **51 of 59 personas** (§7 D2). **The sibling leaves own encodings that cannot lie; this leaf
owns a number that can.**

### The fourth sibling: `metric-tile` (recurrence 32, unwritten)

It is the **rendering** of what this path **defines**, and the seam is checkable:

> **If you change it, does the number change, or only its appearance?**

| Change | Owner |
| --- | --- |
| the status set in the denominator, the window's length or its calendar, the unit (0–1 vs 0–100), whether an empty sample is `0` or absent | **`metric-definition`** (this path) |
| the tile's label, its icon, its delta arrow and tone, its sparkline, its skeleton, its grid span | `metric-tile` |

`KpiTile` (`overview/components/shared/KpiTile.tsx`, 32 call sites) is `metric-tile`'s primitive
and this path never mentions it again. `resolveMetricPercent`
(`overview/libs/metricIdentity.ts:43`) is **this** path's, because it decides a unit. One
consequence worth stating so the two do not overlap: `KpiTile` takes a `numericValue` and a
`format` callback, and **cannot tell a measured 0 from an unmeasured one** — that is not a tile
defect, it is this path's Gap 1 arriving at the tile.

### Boundaries with paths that already exist

| Territory | Owner | Do not restate |
| --- | --- | --- |
| Rendering a number — separators, locale, precision, the `%`/`$` glyph, `<Numeric>` | [`number-and-cost-formatting.md`](./number-and-cost-formatting.md) | The seam is the moment a `f64`/`number` leaves the store. **This path owns what the number is; that one owns what it looks like.** |
| Where a *money* figure comes from, how it is stored, and what a budget cap reads | [`llm-spend-accounting.md`](./llm-spend-accounting.md) §2, §7.D | Its P1 (provenance), P3 (unknown ≠ zero) and P4 (re-aggregate, never increment) are the money-shaped instance of this leaf's general condition. §8 Gap 2 is where they meet. |
| Whether the query that computes a metric is *timed* | [`query-latency-instrumentation.md`](./query-latency-instrumentation.md) | It owns `timed_query!`. This path owns the metric that instrument itself produces (§7 D8). |
| How a timestamp is stored and rendered | [`timestamp-storage.md`](./timestamp-storage.md), [`timestamp-display.md`](./timestamp-display.md) | They own the column type and the "3 minutes ago" string. **This path owns the day boundary a metric is bucketed on** (§7 D4, D5). |
| Whether a rate's *bar* is honest | [`proportional-bar-list.md`](./proportional-bar-list.md) | |

---

## 2. The one way

**Define the metric once, in one named place, with its window and its unit, and make "no
sample" a value the type can carry.** Concretely: before you write the division, write down four
things and keep them together — the **numerator predicate**, the **denominator predicate**, the
**window** (its length *and* its calendar), and the **unit** (0–1 or 0–100, and say which). Put
them in a named artifact that the computation reads, not in a comment beside one of the several
computations: this repo already has `overview/libs/metricIdentity.ts`, which names a metric's
source, `timeWindow`, `numeratorField` and `denominatorField` and hands them to one
`resolveMetricPercent` — three metrics use it and thirty-three do not, and that ratio is the whole
defect surface. **Choose the denominator by what the number claims**, and for a success rate that
means the *decided* set (`completed + failed`) — not `COUNT(*)`, because a run still in flight is
neither a success nor a failure and counting it deflates a healthy fleet exactly while it is
busiest; this repo states that rule in a comment at `digest.rs:150-152`, in a module note at
`fleetHealth.ts:8-19`, in a test named `success_rate_excludes_cancelled_runs`
(`sla.rs:1311`) and in a user-facing tooltip (`en.json` → `overview.sla.success_rate_tooltip`),
and then violates it in six places including 160 lines below that same comment. **Make the window
explicit and pick one calendar**: "last N days" from wall-clock now, or N calendar days in a
stated zone — never a local-midnight `Date` serialized through `toISOString()`, which turns
1 August into 31 July for every user east of UTC (§7 D5, executed). **Return an absent value, not
a zero, when the sample is empty** — `Option<f64>` in Rust, `number | null` in TypeScript, all the
way to a rendered `—`; a rate over zero runs is not 0%, and this repo has 34 sites that say it is.
Finally, **stamp the provenance when the number is a substitute**: `personaHealthSlice.ts:50`'s
`successRateSource: 'measured' | 'proxy' | 'unknown'` is the right shape and the only one in the
app, and a number whose provenance is not carried will be read as measured.

---

## 3. Mandated primitives

Never invent a name here. These exist today, and their adopter counts are the finding.

| Primitive | What it gives you | Adopters |
| --- | --- | --- |
| **`features/overview/libs/metricIdentity.ts`** — `MetricIdentity`, `SUCCESS_RATE_IDENTITIES`, `resolveMetricPercent(identity, values)` | **The metric-definition registry.** An identity names `source`, `timeWindow`, `numeratorField`, `denominatorField`, and `kind: 'ratio' \| 'precomputed_ratio'` — the last of which is the **unit** decision, typed. `resolveMetricPercent` owns the ×100 and the `denominator <= 0` guard, so no call site re-decides either. It honestly declares that three *different* success rates exist rather than pretending there is one. | **3** call sites (`useExecutionMetrics.ts:113`, `DashboardHomeMissionControl.tsx:141`, `:161`) |
| **`features/home/sub_welcome/lib/fleetHealth.ts:53` — `fleetSuccessRatePct(completed, failed)`** | **The exemplar signature.** Returns `number \| null`; `null` when `completed + failed === 0`, with the doc comment (`:44-52`) naming the denominator *and* the required rendering: *"callers should render a neutral no-data affordance ('—'), NOT a misleading confident '0%'."* Its module note (`:1-19`) is the clearest statement of the terminal-denominator rule in the repo, including the worked case: *"5 completed + 5 running would read '50%' instead of the honest '100% of finished runs'."* Tested at `fleetHealth.test.ts:52`. | **1** (`defaultCockpit.ts:82`) |
| **`db/src/repos/communication/sla.rs:60-88` — `get_persona_reliability`** | The Rust exemplar for a *decided* denominator: SQL filters `status IN ('completed','failed')`, `decided = successful + failed`, and the struct field carries the rule in its own doc comment (`:24-31`). `PersonaReliability.total_decided` is exported alongside the rate **so a consumer can see the sample size** — the only metric struct in the repo that does this. | its own callers |
| **`db/src/repos/communication/sla.rs:1308-1372`** — the denominator-policy test block | Three assertions (`success_rate_excludes_cancelled_runs`) pinning the per-persona, global and daily rates to the *same* rule, with the failure message spelling the definition out: *"success_rate must be successful / (successful + failed); cancelled rows are excluded"*. **Copy this test, not just the formula.** | — |
| **`stores/slices/overview/personaHealthSlice.ts:50`** — `successRateSource: 'measured' \| 'proxy' \| 'unknown'` | **The provenance union.** A closed type saying whether the number was measured from this subject's own rows, substituted from a fleet aggregate, or absent. Its doc comment (`:33-49`) explains each arm and why the UI must distinguish them. | 1 feature (`SuccessSourceBadge.tsx`, rendered at `VitalsLedger.tsx:211`, `RowDetail.tsx:45`) |
| **`db/src/repos/execution/executions.rs:1665` — `MONTHLY_SPEND_PREDICATE`** | The one place a metric's **full predicate** (status set + window + exclusion) is a single exported `&'static str` shared verbatim by a gate and a display. [`llm-spend-accounting.md:193`](./llm-spend-accounting.md) mandates it for money; it is the shape every metric wants. | 2 (the gate + the UI feed) |
| **`sla.rs:14-30` — `local_day_modifier` / the `?1` day offset** | The correct way to bucket by the *user's* day: the frontend sends `-new Date().getTimezoneOffset()` (`api/overview/sla.ts:16-21`) and SQLite does `DATE(created_at, ?1)`. One calendar, chosen explicitly, applied server-side. | 6 uses, **1 file** |
| **`i18n` keys `overview.sla.success_rate_tooltip` and `overview.heartbeats.no_data_tooltip`** | The definition, shown to the user: *"Success rate = successful / (successful + failed). Cancelled runs are excluded…"* and *"No completed or failed runs for this persona in the window — the success rate is a placeholder, not measured."* **2 of 19,112 leaf keys.** | 1 card each |

**Explicitly NOT primitives:**

- **`db/src/repos/execution/metrics.rs:410` — `get_summary_with_conn`.** It emits
  `total_executions = COUNT(*)` with **no status filter**, plus `successful` and `failed`
  separately, and **no rate at all**. That is a defensible payload and a trap: every consumer
  picks its own denominator, and four of them picked differently (§7 D1).
- **`db/src/repos/core/personas.rs:1383-1396`** — `PersonaHealth.success_rate`. Last **10** rows,
  **any** status. The most-seen success rate in the app and the one that agrees with nothing.
- **`teams/sub_kpis/kpiMath.ts`** — KPI *progress* against a target, not a metric over a sample.
  Different leaf; it is `long-running-job-progress`-shaped.

---

## 4. Steps

1. **Ask the seam question (§1).** If the thing you are adding changes only how the number looks,
   stop — that is `metric-tile` or `number-and-cost-formatting`.
2. **Write the four facts down before the division**: numerator predicate, denominator predicate,
   window (length **and** calendar), unit. If you cannot state all four you do not yet know what
   the number means.
3. **Look for an existing identity.** `SUCCESS_RATE_IDENTITIES` already holds three; if yours is
   one of them, import it. If it is genuinely new, **add an entry rather than a division** —
   that is the whole point of the registry and it is why it has an `id`.
4. **Choose the decided denominator for anything called a rate of outcomes.** `completed + failed`.
   Non-terminal rows are not failures. If you have a reason to include cancelled, write the reason
   next to the predicate, as `sla.rs:24-26` does.
5. **Compute it once, server-side, and pass the counts *and* the rate.** `PersonaReliability`
   (`sla.rs:22-33`) is the model: it ships `total_decided` beside `success_rate` so the consumer can
   judge the sample instead of re-deriving the ratio. **And then stop** — do not recompute in the
   component. Ten client-side recomputations exist and eight of them disagree with the backend
   (§7 D3).
6. **Make the empty sample absent, not zero.** `Option<f64>` / `number | null`, propagated to a
   rendered `—`. `fleetSuccessRatePct` is the signature to copy.
7. **Pin the window's calendar explicitly.** Either wall-clock-relative (`now - N days`, no day
   alignment, honest about partial edges) or calendar days in a **stated** zone. If it is the
   user's day, send the offset and bucket server-side (`api/overview/sla.ts:16-21` →
   `DATE(created_at, ?1)`). **Never build a boundary from local calendar parts and serialize it
   with `toISOString()`** — §7 D5.
8. **Declare the unit at the boundary.** `overall_success_rate` is 0–1; `successRate` on the health
   signal is 0–100; both are `number`. Name the field for its unit (`…Pct`, `…Ratio`) or make the
   identity carry it (`kind: 'precomputed_ratio'`). §7 D6 is what happens otherwise.
9. **Stamp provenance when the number is a substitute.** If you fall back to a fleet average, a
   default, or a stub, carry a tag like `successRateSource` and render it.
10. **Write the definition where a reader can reach it** — a tooltip for the user, a doc comment
    on the field for the developer. Two of 34 ratio sites do the second; two of 26 user-facing
    strings do the first.
11. **Write the test that pins the denominator, not the arithmetic.** `sla.rs:1311`'s
    `success_rate_excludes_cancelled_runs` and brainiac's
    `answered_rate_distinguishes_no_demand_from_total_failure` are the two examples in four repos.

### Can the primitive's signature make the wrong call impossible?

**The contract requires this answered before §9
([`golden-path-contract.md:165-184`](../golden-path-contract.md)). Answer: for the absence half,
yes — decisively, and three of four repos independently made the same type change. For the
denominator and window halves, no — and the corpus's own qualifications explain exactly why, with
a controlled experiment inside one file to prove it.**

**T1 — make the empty sample unrepresentable as a zero.** Every rate returns
`Option<f64>` / `number | null`, and the consumer must decide.

```rust
// today, ×34 (§9):                       // the fix, already present at team_synthesis.rs:931:
let rate = if decided > 0 {               (decided > 0).then(|| successful as f64 / decided as f64)
    successful as f64 / decided as f64    // -> Option<f64>; the caller cannot ignore None
} else { 0.0 };                           //
```

This is not a preference. **`brainiac` wrote the same signature, with the same reasoning, with no
shared document** (`brainiac-store/src/retrieval_events.rs:116-122`):

> *"`None` when there is no demand yet — deliberately not 0.0, because 'no questions asked' and
> 'every question failed' must not render the same."*

…and pinned it with a test literally named
`answered_rate_distinguishes_no_demand_from_total_failure` (`:551-560`), carried it through
`?? null` (`observatory-data.ts:40`) to `{pct === null ? "—" : …}` (`Observatory.tsx:476`), and
omitted the whole tile when the data is absent because *"an invented 0% answered-rate would be a
worse lie than a missing tile"* (`Observatory.tsx:433-434`). `personas-cloud` reached the same place
by a different route: `db.ts:1659` `resolved > 0 ? completed / resolved : null`, typed
`number | null` all the way to the wire at `protocol.ts:88`. And this repo already has it once,
in `fleetSuccessRatePct`. **Four codebases, three of them arriving independently at the same
signature: this is physics, not taste.**

**Now the five qualifications this corpus has earned, applied rather than restated:**

- **A required prop carries only what it actually encodes.** `Option<f64>` encodes *"there may be
  no sample."* It does **not** encode which denominator produced the sample, nor which window.
  `sla.rs`'s `success_rate` and `personas.rs`'s `success_rate` would both be `Option<f64>` and
  would still differ by 32 pp.
- **Requiredness is orthogonal to closedness.** `f64` is open. Wrapping it in `Option` closes the
  *absence* axis and nothing else.
- **A type nobody constructs constrains nothing.** `MetricIdentity` is a real closed shape with a
  `kind` union — and `SUCCESS_RATE_IDENTITIES` has **3 entries against 33 metric sites**. The type
  is fine; almost nobody constructs one.
- **A type anyone can construct authenticates nothing.** `successRateSource` is a closed union and
  the *right* design — and `personaHealthSlice.ts:398` assigns the `'proxy'` arm a value in the
  wrong unit (§7 D6). The tag is honest about provenance and silent about scale.
- **Withholding beats requiring — and this repo contains the controlled experiment.**
  `metrics.rs:410`'s `get_summary` **withholds the rate** and hands out `successful`, `failed` and
  `total_executions`. Four consumers then chose four denominators. Its neighbour
  `sla.rs:60-88` **withholds the counts' ambiguity instead**: it filters the rows in SQL, computes
  the rate, and exports `total_decided` so the consumer can judge the sample but cannot re-derive
  a different ratio. Same repo, same era, same table. **Every consumer of the second agrees;
  the consumers of the first do not.** Withholding works — but only when you withhold *the
  dangerous freedom*, not *the answer*. Handing out raw counts is withholding the answer, and it
  produced the defect.

**T2 — a `Rate` newtype that carries its own definition**, which is the only construction that
reaches the denominator and window halves:

```rust
pub struct Rate {
    value: Option<f64>,          // absence, closed
    unit: Unit,                  // Ratio01 | Percent0100 — closed
    denominator: Denominator,    // Decided | AllRows | Declared(&'static str) — closed
    window: Window,              // WallClock(days) | CalendarDays { days, tz_offset_min } | LastNRows(n)
    provenance: Provenance,      // Measured | Proxy(&'static str) | Unobserved
}
```

Every §7 deviation becomes a compile error or a visible field: D1 (four denominators) cannot be
spelled without stating which; D2 (window vs window) is a field the reader can see; D5 (mixed
calendars) forces a zone; D6 (unit bug) cannot type-check; D7 (unlabelled proxy) is
`Provenance::Proxy`. **This is a real change and it is the leaf's honest answer**, and it is the
same construction [`llm-spend-accounting.md:955-969`](./llm-spend-accounting.md) proposed for
`Spend` and then declined as more invasive than it was worth. That path had one execution table
and one estimator. **This one has 33 metric sites, 4 denominators and 4 calendars, so the trade
lands the other way** — and the cheap first step is not the newtype but the registry that already
exists: move `MetricIdentity` out of `features/overview/libs/` into a shared module, add
`unit` and `denominator` as closed unions, and route the next metric through it instead of a
division.

**Propose T1 immediately (34 sites, one legal fix, a destination three repos independently
validated) and T2 as the direction; §9's census rule is the ratchet that holds T1's line until it
lands.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| `COUNT(*)` as the denominator of a success rate | A run still `running` or `queued` is neither a success nor a failure, so a healthy fleet's rate **falls while it is busiest** — the one moment somebody is watching. Measured: 0.90 pp on this snapshot (1.0% non-terminal) and **17.8 pp at 20% in-flight**. `digest.rs:150-152` explains this in a comment and `digest.rs:314` does it anyway. |
| Shipping the counts and letting each consumer divide | `get_summary` returns `successful`, `failed` and `total_executions` and **no rate**. Four consumers, four denominators, two units. The payload is not neutral — it is a fork in the road with no signpost. |
| A second definition of a metric that already has one | `personas.rs:1394` (last 10 rows, any status) and `personas.rs:1489` (last 50 rows, decided) are **the same concept, in the same file, 95 lines apart**. One paints the health badge; the other is 50% of the persisted `trust_score`. |
| A window measured in *rows* presented as a window in *time* | `PersonaHealth` is "the last 10 runs"; the SLA dashboard is "the last N days". Both render as "success rate" with no qualifier. On live data this is **the dominant divergence — 7.71 pp mean, 32 pp max, 48 of 59 personas** — 6.8× larger than the denominator effect. |
| A day bucket built from local calendar parts and serialized with `toISOString()` | `new Date(2026, 7, 1).toISOString().slice(0,10)` is **`"2026-07-31"`** in CEST. Executed. August starts in July for every user east of UTC. |
| Two calendars for the same series | `metrics.rs:1183` buckets with `DATE(e.created_at)` (UTC); `sla.rs:643` buckets with `DATE(created_at, ?1)` (the user's day). **17 of 17 day buckets differ; the largest per-day success-rate divergence is 12.09 pp.** |
| `created_at >= datetime('now', '-N days')` against an RFC3339 column | It is a **string** comparison. `created_at` is `'2026-06-26T16:34:02.8+00:00'`; the boundary is `'2026-06-26 12:00:00'`. At index 10, `'T'` (0x54) beats `' '` (0x20) **before any time digit is read**, so every row on the boundary day is included whatever its time. Executed: 160 rows matched where 70 are actually after the instant — **90 over-included, 2.3×**. |
| `else { 0.0 }` after a `> 0` guard on a rate | "Nothing has run yet" and "everything failed" render as the same 0%. **34 sites.** A persona that has never executed and one that failed every run are the same pixel. |
| `Math.max(1, n)` inlined as the divisor | Worse than the above: it fabricates a denominator instead of declaring absence, so there is no branch to fix later. `useRealtimeEvents.ts:83` guards on `total` (all statuses) and divides by `Math.max(delivered + failed, 1)` — a 60-second window holding 10 pending events reports **0% success** for a queue that has not failed once. |
| A rate assigned in two units on two branches of one `if` | `personaHealthSlice.ts:395` writes `rel.success_rate * 100`; `:398` writes `dashboard.overall_success_rate` — which is 0–1. The field is documented `// 0-100%` at `:34`. Every proxied persona reads ~0.89 instead of ~89 and trips `healthCheckSlice.ts:137`'s `successRate < 80`. |
| A metric derived from a table that does not contain the thing being measured | `fleetOptimizer.ts:127-130` builds a "success rate" from **open healing issues** and renders it as literal copy: `"…with only ${Math.round(worst.successRate)}% success rate"`. |
| A rollup whose denominator is a hardcoded vocabulary | `policy_evidence.rs:62` sets `failed = runs - completed` over a 4-status set, so `incomplete` and `cancelled` are **reported as failures** — and that number is the fallback `quality_basis` for model-routing proposals (`policy_tuning.rs:227`). A model gets demoted for runs the user cancelled. |
| Six percentile implementations | `sla.rs:820` (nearest-rank, `None` on empty), `metrics.rs:859` (**linear interpolation**, `0.0`), `baselines.rs:102`, `api_proxy.rs:426`, `bench.rs:94`, `perf.rs:184`. `sla.rs`'s p95 and `metrics.rs`'s p95 over the same durations return different numbers. |
| A metric computed on every event and rendered nowhere | `getDbPerformance` (`api/system/system.ts:96`) has **0 callers**; `hasFailureSpike` (`fleetHealth.ts:80`) is referenced only by its own test. Both convergent — see §7 D8. |

---

## 6. Evidence

**The ONE site to copy: `src/features/home/sub_welcome/lib/fleetHealth.ts:1-60`, consumed by
`src/features/home/sub_cockpit/defaultCockpit.ts:81-83`.**

It is the only metric in the repository that states its denominator, states *why*, encodes absence
in its return type, prescribes the rendering, and has a test pinning the contract:

> *"DENOMINATOR (read this first): every ratio below … is computed over TERMINAL executions only,
> i.e. `completed + failed`. … Counting non-terminal rows in the denominator is wrong both ways: it
> dilutes a real failure spike below the firing threshold AND paints a calm-but-low green success
> rate during normal activity (e.g. 5 completed + 5 running would read '50%' instead of the honest
> '100% of finished runs')."* — `:8-19`

- **The denominator is named, and the rejected alternative is named** (`:8-19`, `:48`).
- **Absence is in the type** — `number | null`, `null` when `terminal === 0` (`:56-59`).
- **The rendering is prescribed in the doc comment** — *"render a neutral no-data affordance ('—'),
  NOT a misleading confident '0%'"* (`:49-51`) — and the consumer obeys:
  `defaultCockpit.ts:111` `value: successRate ?? '—'`, with the `%` unit suppressed at `:112`
  when the value is absent.
- **Tested by meaning** — `fleetHealth.test.ts:52` asserts `fleetSuccessRatePct(0, 0)` is `null`,
  separately from `(0, 5) → 0` at `:61`.
- **It knows what the backend sends it** (`:11-15`): *"`get_metrics_summary` reports
  `totalExecutions = COUNT(*)` (all statuses) … separately."* It reads the payload's shape
  correctly and refuses the trap.

Secondary exemplars, each for one property:

| Site | What to copy |
| --- | --- |
| `db/src/repos/communication/sla.rs:1311-1372` | The denominator **test**: three assertions pinning per-persona, global and daily rates to one rule, with the definition in the failure message. |
| `db/src/repos/communication/sla.rs:22-33` | Exporting `total_decided` **beside** `success_rate`, so the consumer can judge the sample without re-deriving the ratio. |
| `src/engine/digest.rs:150-153` | The four-line comment that is the clearest statement of the rule in the Rust tree — *"rows still queued/running/cancelled … are neither a success nor a failure and would otherwise deflate the rate."* |
| `src/commands/execution/alert_evaluator.rs:403-413` | A test named `error_rate_uses_decided_denominator`, whose comment states it is *"parity with the SLA repo and alertSlice"* — a metric definition asserted **across modules**. |
| `overview/libs/metricIdentity.ts:12-40` | Three success rates given three **ids**, each with its `source`, `timeWindow` and denominator fields. Honest plurality beats a false singular. |
| `overview/libs/fleetOptimizer.test.ts:1-8` | A whole test file whose subject is *"the `overall_success_rate` unit convention"*. The unit is the thing under test. |
| `stores/slices/overview/personaHealthSlice.ts:33-50` | The provenance union and its doc comment: *"Two personas in the same fleet will show identical successRate even when one is healthy and one is failing — UI must surface this caveat."* |
| `overview/libs/computeTrends.ts:42-47, 86-96` | A period-over-period comparison that returns `null` unless a real second fetch happened, and suppresses the delta for *average* metrics when the prior window is empty (a `+100%` is meaningful for a sum and meaningless for a rate). |
| `api/overview/sla.ts:16-21` | Sending `-new Date().getTimezoneOffset()` so day bucketing happens once, server-side, in a stated zone. |

---

## 7. Deviations

Every item below shipped under a green `npm run check` (0 errors, 1,135 warnings —
[`shared-facts.json`](../shared-facts.json)) and a green `cargo test`. Live figures are from a
read-only copy of `personas.db` (2,188 executions: 1,928 completed, 238 failed, 20 incomplete,
2 cancelled).

### D0 — A premise of the brief is corrected, and the executed decomposition is the finding

The brief asked whether two surfaces compute "the same" metric differently, and named the
denominator as the defect shape. **They do — and the denominator is the smaller half.** Computing
`personas.rs`'s `PersonaHealth.success_rate` and `sla.rs`'s `PersonaReliability.success_rate`
against the same live rows, then decomposing the gap:

| Component | mean \|divergence\| | max | personas affected |
| --- | ---: | ---: | ---: |
| **Total** (what the two surfaces actually show) | **8.10 pp** | **32.0 pp** | **51 / 59 (86%)** |
| …attributable to the **window** (last-10-rows vs the full window) | **7.71 pp** | 32.0 pp | 48 / 59 |
| …attributable to the **denominator** (any-status vs decided) | 1.13 pp | 10.0 pp | 7 / 59 |

**The window is 6.8× the denominator.** `personas.rs`'s window sees **573 rows against `sla.rs`'s
2,166 — 26.5%** of the same corpus. A reader hunting the denominator would have found a 1 pp
effect and concluded the metrics broadly agree; they disagree by up to 32 points, and the reason
is that one of them is not a time window at all.

This does **not** clear the denominator — §7 D1 shows it is a structural bug whose magnitude is
proportional to in-flight load, which this snapshot happens to have almost none of. It reorders
the two: **the window is the live defect; the denominator is the latent one.** §2 mandates both
because they fail at different times.

### D1 — Four denominators for one metric name · **17 Rust sites, 4 denominators**

| Denominator | Sites | Examples |
| --- | ---: | --- |
| `completed + failed` (decided) | 11 | `sla.rs:73,119,468,519,802,1002` · `digest.rs:154,160` · `alert_evaluator.rs:95` · `metrics.rs:1367,1453` (SQL pre-filters to the two statuses at `:1195`) |
| `COUNT(*)`, no status filter | 4 | `digest.rs:314,320` · `executions.rs:919` · `optimizer.rs:83` |
| last **10** rows, any status | 1 | `personas.rs:1394` |
| `COUNT(*)` over 4 statuses, remainder reported as failures | 1 | `policy_evidence.rs:63` (`failed = runs - completed`, `:62`) |

Sixteen more metrics of the same shape ship under other names (`resolve_rate`, `win_rate`,
`accept_rate`, `value_delivered_rate`, `pass_rate`, …), for **33 success-rate-shaped metrics**
in the Rust tree.

**The controlled experiment is inside one file.** `src/engine/digest.rs` builds one
`PerformanceDigest` and renders it in one notification body:

- `:154` — the **global** rate: `success / terminal`, `terminal = success + failed`, preceded by
  the comment at `:150-152` explaining why `COUNT(*)` is wrong.
- `:314` — the **per-persona trend rows** in the same struct: `success / total`, where `total` is
  the bare `COUNT(*)` selected at `:248` with no status filter.

Same author, same file, 160 lines apart, one email. Executed on the live corpus (top 20 personas
by volume): **4 of 20 trend rows already disagree with the headline's own rule**, worst 4 pp — and
this snapshot contains only **22 non-terminal rows of 2,188 (1.0%)**. The gap is linear in
in-flight load:

| non-terminal share | trend row says | headline says | gap |
| ---: | ---: | ---: | ---: |
| 0% | 89.0% | 89.0% | 0.0 pp |
| 5% | 84.6% | 89.0% | 4.5 pp |
| 10% | 80.1% | 89.0% | 8.9 pp |
| 20% | 71.2% | 89.0% | **17.8 pp** |

**A second instance, on one payload.** `alert_evaluator.rs:96` and `executions.rs:919` both call
`metrics_repo::get_summary` and divide its fields. The first uses `decided`; the second uses
`total`. `alert_evaluator.rs:403` ships a test named `error_rate_uses_decided_denominator`
asserting *"parity with the SLA repo and alertSlice"*. So an alert can fire "success rate below
threshold" while the advisory context handed to the LLM for that same persona reports a higher
number, from the same snapshot, in the same process.

### D2 — Two windows for one metric, in one file · **`personas.rs`, 95 lines apart**

| | Window | Statuses | Consumer |
| --- | --- | --- | --- |
| `personas.rs:1394` `PersonaHealth.success_rate` | last **10** rows (`ROW_NUMBER() … rn <= 10`, `:1319`) | **any** — `ranked` selects every row | the persona card's health badge |
| `personas.rs:1489` `compute_trust_score` | last **50** rows (`:1470`) | `status IN ('completed','failed')` | 50 of 100 points of the persisted `personas.trust_score` (`TRUST_W_SUCCESS = 50.0`) |

Neither is the SLA dashboard's window (last N days). **Three windows, one name.** The frontend adds
a fourth: `useQuickStats.ts:76` fetches 50 rows and slices to **10**, then divides by all of them
(`:94`) — and its numerator matches `status === 'completed' || status === 'success'`, where
`'success'` is a status the backend never writes for `persona_executions`.

### D3 — Ten client-side recomputations, eight disagreeing · **frontend**

`get_summary`'s payload carries counts and no rate, so ten components divide it themselves. The
sharpest pair is two tiles both labelled "Success rate", reading the **same object**:

| Surface | Expression | Denominator | Empty |
| --- | --- | --- | --- |
| Home cockpit — `defaultCockpit.ts:82` → `fleetHealth.ts:57` | `Math.round((completed / (completed + failed)) * 100)` | **decided** | `'—'` (`:111`) |
| Observability tile — `useObservabilityData.ts:96-98` | `((summary.successfulExecutions / summary.totalExecutions) * 100).toFixed(1)` | **all statuses** | the string `'0'` |

With 5 completed and 5 running, Home reads **100%** and Observability reads **50%**. The module
that defines the correct rule is 1 import away and has 1 adopter.

Others: `useTriggerHistory.ts:54` (success% over all rows, beside a failure **count** over a
different base, so the two cannot sum to 100); `BulkRerunReport.tsx:25`;
`DashboardHomeMissionControl.tsx:141` vs `:161` (the **same `<SuccessRing>`** flips between a
50-row unwindowed feed ratio and a 30-day windowed ratio when the persona filter toggles — both
through the *same* `SUCCESS_RATE_IDENTITIES.dashboardRecentExecutions` identity, whose declared
`timeWindow` is `'recent-50-or-filtered'`, which is not a time window);
`useRealtimeEvents.ts:81-85`; `fleetOptimizer.ts:127-130`.

### D4 — Two calendars for one daily series · **17 of 17 buckets differ**

`metrics.rs:1183` buckets the daily success series with `DATE(e.created_at)` — **UTC**.
`sla.rs:643`/`:760` bucket theirs with `DATE(created_at, ?1)` where `?1` is the caller's local-day
modifier — **the user's day**. Executed against the live corpus:

- **17 distinct day buckets; 17 of 17 have a different row count** under the two spellings.
- Largest per-day success-rate divergence: **12.09 pp** on 2026-06-09 (UTC 40/58 = 69.0% vs local
  77/95 = 81.1%).
- **290 of 2,188 rows (13.3%)** fall on a different calendar day under the two frames.
- Worst single-day count divergence: 2026-06-05 renders **46 runs** in the UTC frame and **98** in
  the local frame — **113%**.

Repo-wide: **6 local-day `DATE(x, ?)` uses, all in `sla.rs`** — against **14 bare `DATE()` uses
across 7 files**. The correct pattern exists in exactly one file.

### D5 — Local calendar parts serialized as a UTC day key · **2 files, both executed**

**(i) `src/lib/types/timeRange.ts:33 + :38`.** `toISO = (d) => d.toISOString().slice(0, 10)`
applied to `new Date(year, month - 1, 1)`. Executed under `TZ=Europe/Prague`:

```
calendar-month start, local : Sat Aug 01 2026 00:00:00 GMT+0200
serialized via toISOString  : 2026-07-31    <-- what the API receives
```

**August starts on 31 July.** This is the exact defect the brief cited, present here and absent in
all three siblings. `:53`'s `rolling-days` has the same shape. The module's own docstring says
*"Budget enforcement uses calendar-month boundaries"*, while the backend gate pins the month to
**UTC** `datetime('now', 'start of month')` (`executions.rs:1665`), so the label and the gate can
disagree by a day in the other direction too.

**(ii) `src/features/schedules/components/ScheduleRowHistoryPanel.tsx:158-176`.** One function
holds both frames:

- `:160-161` — `start = new Date(); start.setHours(0,0,0,0)` → **local** midnight.
- `:165` — `dateKey: d.toISOString().slice(0, 10)` → the **UTC** date of that local midnight.
- `:166` — `dateLabel: d.toLocaleDateString(...)` → the **local** date of the same instant.
- `:175` — rows are indexed by `new Date(tsRaw).toISOString().slice(0, 10)`.

So each bar is **labelled** with one day and **keyed** to the previous one for any user east of
UTC, and 13.3% of live rows land in the wrong bar.

### D6 — One field, two units, chosen by a branch · **live, with a downstream consequence**

`stores/slices/overview/personaHealthSlice.ts`, field documented `successRate: number; // 0-100%`
(`:34`):

```ts
if (rel && rel.total_decided > 0) {
  successRate = rel.success_rate * 100;            // :395  0..1 -> 0..100  ✅
} else if (totalExecs > 0 && dashboard?.overall_success_rate !== undefined) {
  successRate = dashboard.overall_success_rate;    // :398  0..1, NOT scaled ❌
}
```

`overall_success_rate` is a 0–1 ratio — produced at `metrics.rs:1454` as `completed / total`,
declared as such by `fleetOptimizer.ts:278-281` (which multiplies by 100), and the subject of a
dedicated test file (`fleetOptimizer.test.ts:1-8`, *"the `overall_success_rate` unit convention"*).
Consequence: every persona on the `'proxy'` path carries `successRate ≈ 0.89` where consumers
expect ≈ 89 — `healthCheckSlice.ts:137` (`successRate < 80` → unhealthy, now **always** true),
`compositeHealthScore.ts:254` (clamped to `[0,100]`), `leaderboardScoring.ts:124` (30% of the
composite), `VitalsLedger.tsx:177` (`>= 90`/`>= 70` tone bands).

The provenance union is doing its job — the badge correctly says "fleet avg". It cannot say
"in a different unit", because the tag encodes provenance and the unit is untyped.

### D7 — Fields that are structurally unable to say "no measurement" · **81%**

Metric-named `pub` fields in the Rust tree (`*rate*`, `*score*`, `*avg*`, `p50`/`p95`/`p99`):

| Type | Count |
| --- | ---: |
| `Option<f64>` — can distinguish "no sample" | **23** |
| bare `f64` — cannot | **100** |

**81% of metric fields conflate "0" with "no data"**, and 34 sites (§9) actively perform that
conflation. Live consequence: **19 of 78 personas (24%)** have zero decided executions, so their
success rate is a 0/0 — and both definitions return `0.0`. On the health page a persona that has
never run is indistinguishable from one that failed every run, except in the one feature that
carries `successRateSource` and renders the `no_data_tooltip`.

### D8 — Metrics computed and never surfaced · **2, both convergent**

- **`get_db_performance`** — registered as a Tauri command (`lib.rs:3020`), implemented at
  `commands/infrastructure/system/mod.rs:79`, wrapped at `api/system/system.ts:96`, and called by
  **nothing**. Confirming the inherited finding from
  [`query-latency-instrumentation.md`](./query-latency-instrumentation.md). `navCatalog.ts:79`
  already records it: *"the backend's `getDbPerformance` both unreachable."*
- **`hasFailureSpike`** (`fleetHealth.ts:80`) — 30 lines of documented threshold policy
  (`FAILURE_SPIKE_MIN_EXECUTIONS`, `FAILURE_SPIKE_RATIO_THRESHOLD`) with 8 test cases and **zero
  production callers**. The best-documented metric in the app is not rendered.

### D9 — The definition is almost never written down where anyone can reach it

| Where a reader might look | Sites that define the denominator |
| --- | --- |
| A doc comment within 20 lines above the ratio | **2 of 34** (`digest.rs:150-152`, and `healing.rs:916`'s one-liner) |
| A user-facing string, out of 19,112 `en.json` leaf keys | **2** — `overview.sla.success_rate_tooltip` (rendered on **one** card, `SLADashboard.tsx:139`) and `overview.heartbeats.no_data_tooltip` |
| Out of 26 `en.json` strings mentioning "success rate" | **2** explain what the number counts |
| `docs/` | 24 of 1,175 `.md` files mention a success rate near a denominator — and 18 of those are dated `harness/` scan reports, not reference documentation |

### D10 — Six percentile implementations, three algorithms, two empty conventions

| Site | Algorithm | Empty input |
| --- | --- | --- |
| `sla.rs:820-828` | nearest-rank, `.round()` | **`None`** (deliberate, commented `:816-819`) |
| `metrics.rs:859-875` | **linear interpolation** | `0.0` |
| `baselines.rs:102-118` | linear interpolation | `0.0` (worked around at `:187-193`) |
| `api_proxy.rs:426-432` | nearest-rank, `u64` | `0` |
| `bench.rs:94-102` | nearest-rank | `Duration::ZERO` |
| `perf.rs:184-188` | `ceil(n × 0.95) − 1` | `0.0` |

`sla.rs`'s p95 and `metrics.rs`'s p95 over the same persona's same durations return different
numbers. Their row filters also differ within one struct: `PersonaSlaStats.avg_duration_ms`
includes `cancelled` (`sla.rs:347`) and `p95_duration_ms` does not (`sla.rs:379`).

### D11 — The window boundary is a string comparison · **55 sites**

`created_at` is stored as RFC3339 with a `T` separator (`'2026-06-26T16:34:02.835+00:00'`).
`datetime('now', ?)` returns `'YYYY-MM-DD HH:MM:SS'` with a space. SQLite compares TEXT with BINARY
collation, and `'T'` (0x54) sorts above `' '` (0x20) at index 10 — **before any time digit is
read**. Executed:

| Comparison | Rows matched |
| --- | ---: |
| `created_at >= '2026-06-26 12:00:00'` (the app's spelling) | **160** |
| `julianday(created_at) >= julianday('2026-06-26 12:00:00')` (the truth) | **70** |
| over-included | **90 (2.3×)** |

The over-inclusion is bounded by one day's rows and only bites when the boundary lands on a day
that has data — at `-60 days` it was 57 rows of 412 (**16%**); at `-52 days` (an empty day) it was
zero. **55 sites in 17 files** use this spelling, including `MONTHLY_SPEND_PREDICATE`. It is a
`timestamp-storage.md`-shaped cause with a `metric-definition`-shaped effect: the window is not the
window that was asked for. Reported here because no path currently owns it.

### D12 — Cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"The metric registry does not exist."** It does — `overview/libs/metricIdentity.ts`, with
  `timeWindow`, `numeratorField`, `denominatorField` and a typed unit. The defect is that it has
  **3 identities and 3 call sites** against 33 metric sites, and that one of its three call-site
  pairs feeds two different windows through one identity (D3). The path's job is to route people
  to it, not to invent one.
- **"No metric definition reaches the user."** Two do. One tooltip states the formula and the
  cancelled-row exclusion verbatim; one states that a placeholder is a placeholder. Both are
  correct and both are on a single card.
- **Zero-guards are not the gap.** I expected unguarded divisions producing `NaN%`. There are
  essentially none: every ratio site in the Rust tree carries a `> 0` guard, and the frontend
  guards nearly everywhere. **The guard is present and its *value* is wrong** — which is a
  different defect and needs a different fix (a type, not a check).
- **The `new Date(y, m, 1)` month-boundary shape is mostly fine here.** Of the four sites, three
  (`grouping.ts:39`, `groupByDay.ts:29`, `calendarHelpers.ts:71`) compare with `.getTime()` in the
  local frame throughout and are correct. Only `timeRange.ts:38` serializes. I set out to file
  four and found one.

---

## 8. Gaps

**Gap 1 — Nothing owns a metric's definition, so 33 authors owned 33 of them.** `metricIdentity.ts`
is the right artifact in the wrong place (`features/overview/libs/`, so no other feature finds it),
covering the wrong scope (3 of 33), and missing two of the four facts a definition needs — it
carries `timeWindow` as a free string (`'recent-50-or-filtered'`, `'selected-day-range'`) and does
not carry the unit except as the `kind` discriminator. **Every other deviation is downstream of
this**: D1 (four denominators) because nothing named one; D2/D4 (four windows, two calendars)
because `timeWindow` is prose; D3 (ten recomputations) because the payload ships counts and the
registry is unreachable; D6 (the unit bug) because `number` is open. T2 in §4 is the fix and
T1 is the first step.

**Gap 2 — "unknown" is unrepresentable in 81% of metric fields, and this is the same gap
[`llm-spend-accounting.md`](./llm-spend-accounting.md) found in money.** That path's Gap 1 is
`ExecutionMetrics.cost_usd: f64` destroying a `None` that both ends of its pipe could carry; its
closing line is *"make absence representable at every hop, not just at the ends."* This leaf is the
general case: 100 bare `f64` metric fields against 23 `Option<f64>`, and 34 sites manufacturing a
confident zero. **The two paths should land T1 together** — they are one edit repeated, and the
money instance already has an executed cost figure attached to it.

**Gap 3 — There is no way to express "this window" in a type, so a window is a comment.**
`PersonaHealth.success_rate` (10 rows), `compute_trust_score` (50 rows), `get_persona_reliability`
(N days) and `get_summary` (N days, different N) are all `f64` fields named `success_rate`. Nothing
in any signature distinguishes them, nothing in the ts-rs binding distinguishes them, and the
frontend merges them into one `PersonaHealthSignal`. `PersonaReliability.total_decided`
(`sla.rs:31`) is the only field in the repo that lets a consumer see the sample it is judging;
generalising *that* is cheaper than the full `Window` union and captures most of the value.

**Gap 4 — The two calendars cannot be reconciled without deciding whose day it is, and nothing
records the decision.** `sla.rs` sends the browser's offset; `metrics.rs` uses UTC; the budget gate
uses UTC `start of month`; `timeRange.ts` uses local parts. All four are defensible in isolation.
The gap is that **no artifact states which one the product means**, so the next author picks by
proximity. This needs a written decision (a `DAY_BOUNDARY` constant plus one paragraph), not a
lint.

**Gap 5 — The census cannot express "these two definitions must agree".** The sharpest defect in
this leaf (D1's `digest.rs:154` vs `:314`, D3's cockpit vs observability) is a *relation between two
sites*, not a string. A regex can find each division; it cannot know they are the same metric. The
durable answer is T2's `Denominator` union, which makes the disagreement a type mismatch — or, much
more cheaply, a **cross-module test** in the shape of `alert_evaluator.rs:403`'s
`error_rate_uses_decided_denominator`, which is the only assertion in the repo that pins one
definition across two modules.

**Gap 6 — The census rule keys on a Rust idiom and cannot see the frontend half.** §9's signal
matches `if n > 0 { … } else { 0.0 }`. The TypeScript spelling (`: 0`, `?? 0`, `Math.max(1, n)` in
the divisor) is the same condition — roughly 20 sites per the frontend sweep — and needs its own
proxy, or better an ESLint rule that can see the return type. Stated so an adopting repo re-derives
rather than trusting a green run.

---

## 9. The missing gate

**The condition to enforce:** *a rate or average over an EMPTY sample is materialized as the number
zero, so "nothing has happened yet" and "everything failed" render identically.* Not "a metric
exists", not "which denominator was chosen" (that is a relation, Gap 5) — the one thing in this
leaf that is a correctness bug at any scale rather than a judgement call, and the one this repo
gets wrong 34 times.

**Checked first that it is not already gated.** `scripts/census/rules.json` holds **84 rules**. None
has an `id`, title or signal containing `metric`, `rate`, `denominator`, `window`, `definition`,
`success`, `average` or `percent` in this sense. Three neighbours were read in full:

- **`unknown-money-as-zero`** ([`llm-spend-accounting.md:758`](./llm-spend-accounting.md)) — matches
  money-named identifiers collapsed by `unwrap_or(0` / `?? 0` / `|| 0`. Mine is an `if/else` block
  containing a cast and a division; no `unwrap_or` and no money noun. **Verified disjoint** by
  running both in one invocation: no shared path.
- **`locale-blind-percent`** — matches a rounded number welded to a `%` glyph. It owns the
  *rendering*; this owns the *value*.
- **`sample-derived-plot-scale`** ([`chart-component.md:636`](./chart-component.md)) — `Math.min`
  spread paired with `|| 1`, TS only. Disjoint.

**Signals I designed, measured, and rejected — the rejections are the finding:**

| Candidate | Result | Why rejected |
| --- | --- | --- |
| `success*/total*` — a success count over an all-status total | 16 files / 19 matches | **63% precision.** Seven matches are *progress* fractions (`TourProgressArc.tsx:15`, `useStepProgress.ts:66`, `setupInstructionHelpers.tsx:99`, `NegotiatorGuidingPhase.tsx:60`, `run-harness.ts:116`), where dividing completed steps by total steps is exactly right. Fires on correct content. |
| the same, requiring a `fail*` binding within ~600 chars (the discriminator that removes progress bars) | 4 files / 5 matches | Precision recovered, but the population collapsed to 4 — and it still misses `digest.rs:314`, the leaf's sharpest site, because that file's `failed` count is 60 lines away in a different function. Recall too low to baseline. |
| local-calendar Date → `toISOString()` day key (D5) | 2 files / 2 matches, **100% precision** | Real and shippable, and the population is **two**. Per the corpus's own reasoning ([`llm-spend-accounting.md:715-717`](./llm-spend-accounting.md), C4), a counter spends its authority on a population of two while the fix is two lines. Named in D5 instead. |
| a rate from two array lengths at a render site | 1 file / 1 match, and it is a test | Dead signal. |

**The shipped signal is the guard WITH its consequent** — a `> 0` guard whose *then* branch performs
an integer→float division and whose *else* branch is the literal `0.0`. The consequent is what makes
the match a **metric** rather than any zero default: without the `as f64 … /` requirement the
pattern would match every defensive numeric fallback in the tree.

**Validated standalone** against the real engine
(`node scripts/census/run-census.mjs --rules <scratch>/rules-metric-definition-final-mdX9.json --check`):
`empty-sample-as-confident-zero` → **16 files / 34 matches / 953 walked**, exit 0;
`absent-sample-as-absent-value-positive-control` → **3 files / 5 matches**. Re-extracted from this
finished document and re-run: identical.

**Verified by a second independent implementation — and the two disagreed twice, which is where the
signal came from.** The verifier is a line-oriented four-state automaton with its own walker and its
own comment filter, importing nothing from `lib/engine.mjs`.

- **First run: 3 matches against the census's 27.** The automaton anchored the guard to the start of
  a line. **In Rust `if` is an expression**, so 24 of 27 sites are in expression position —
  `let rate = if n > 0 {`, or a struct field `success_rate: if bucket.total > 0 {`. A
  statement-anchored matcher finds **11%** of this condition. The verifier was wrong; fixed.
- **Second run: 34 against the census's 27.** Now the *census regex* was wrong. It required
  `as f64 /` — the cast on the **numerator**. Seven sites cast the **denominator** instead
  (`total_cost / total_executions as f64`), because their numerator is already a float. Among the
  seven was `personas.rs:1394` — one of this document's two headline divergences. The regex was
  widened to accept the cast on either side; **both implementations now report 16 files / 34
  matches exactly.**

Neither error would have been visible with one implementation: the first looks like a clean
codebase, the second like a complete count.

**Fail-loud properties** — not asserted, **executed** against the working tree with exit codes
captured:

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified) | **0** | `census OK — 16 files / 34 matches / 953 walked` |
| baseline deflated (a rise) | **1** | `[drift] files rose 5 -> 14 (+9). New violations of …metric-definition.md` |
| baseline inflated (a silent drop) | **1** | `[drift] files dropped 99 -> 14 (-85) without the baseline moving` |
| `floor` raised to 5000 | **1** | `[structural] walked 953 files but floor is 5000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 500` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 500` |
| `goldenPath` removed | **1** | `missing grounding — a rule needs "goldenPath" … or "principle"` |
| `exclude` path renamed | **1** | `[structural] exclude "…/MOVED.rs" matched no file. The exemption is stale` |
| `exclude` `reason` shortened to `"x"` | **1** | `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| **POSITIVE CONTROL — pattern → the COMPLIANT form** | **1** | `[drift] files dropped 14 -> 3 (-11) without the baseline moving` |
| **control given a baseline** | **1** | `must NOT carry a baseline — it exists to fail` |

**How this gate could still fail, stated so the next repo can re-derive it.** The signal proxies for
*"an empty sample is rendered as a confident zero"*, and it keys on this repo's Rust idiom: an
`if n > 0` expression, an `as f64` cast, and a literal `0.0` else-arm. A repo that spells the same
defect as `checked_div().unwrap_or(0.0)`, as a `match` on a count, as TypeScript's `: 0` /
`?? 0` / `Math.max(1, n)` (Gap 6 — roughly 20 sites here that this rule cannot see), or as SQL's
`COALESCE(x / NULLIF(y, 0), 0)` will match nothing while the condition is present at scale — the
exact portability failure [`golden-path-contract.md:34-60`](../golden-path-contract.md) documents.
**An adopting repo must re-derive its own proxy, and should check the positive control's population
before trusting a green run.**

**The positive control** carries no `baseline` by design. It matches the *correct* spelling this
path prescribes and that three repos independently converged on: `(n > 0).then(|| …)`, which yields
`Option<f64>`. The two rules differ in exactly one respect — whether the empty branch produces a
number or an absence. If any regex, walk or engine change ever broke the guard-matcher family, the
control goes to zero matches and the run fails structurally. Its recall is deliberately narrow: it
does **not** match `ratings.rs:95`'s `None` return or `computeTrends.ts`'s TS equivalents, because a
liveness probe wants a stable, exactly-understood population rather than coverage. **It must never
be given a baseline.**

**On severity.** This is proposed at the census layer, which is a ratchet, not an `"error"`. The
count may not rise; the existing 34 are a backlog. No argument from warning volume is made or
intended — and specifically, the fact that 34 of 34 currently render a *plausible* 0% is why this is
a ratchet and not an alarm: the defect is invisible at every individual site and only legible as a
population.

```json
{
  "id": "empty-sample-as-confident-zero",
  "goldenPath": "docs/concepts/golden-paths/metric-definition.md",
  "title": "A rate or average over an EMPTY sample is materialized as the number 0, so \"nothing has happened yet\" and \"everything failed\" render identically",
  "roots": ["src-tauri/src", "src-tauri/db", "src-tauri/engine", "src-tauri/core"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\bif\\s+[A-Za-z0-9_.()]+\\s*>\\s*0(?:\\.0)?\\s*\\{\\s*\\n[^\\n{}]*?(?:as f64[^\\n{}]*/|/[^\\n{}]*as f64)[^\\n{}]*\\n\\s*\\}\\s*else\\s*\\{\\s*\\n\\s*0\\.0\\s*,?\\s*\\n\\s*\\}",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a `> 0` guard whose THEN branch performs an integer-to-float division (the cast may sit on either side of the slash) and whose ELSE branch is the literal 0.0. THE CONSEQUENT IS REQUIRED so the match is a METRIC and not any defensive numeric fallback: without the `as f64 ... /` requirement the pattern matches every zero-default in the tree. NOTE the cast may be on the numerator (`successful as f64 / decided as f64`) OR the denominator (`total_cost / total_executions as f64`); requiring only the first drops 7 of 34 sites, including personas.rs:1394 — found by a second independent implementation disagreeing. In Rust `if` is an EXPRESSION, so the guard is usually NOT line-initial (`let r = if n > 0 {`, `success_rate: if n > 0 {`); a statement-anchored matcher finds 3 of 34. PROXY FOR the stack-free condition: a metric over an empty sample is rendered as a confident zero, so a subject that has never been measured is indistinguishable from one that failed every measurement. Live consequence measured 2026-08-15: 19 of 78 personas have zero decided executions and render 0% success, identical to total failure; 81% of metric-named pub fields (100 bare f64 vs 23 Option<f64>) cannot express the difference. LEGAL FIX: return Option<f64> — `(decided > 0).then(|| successful as f64 / decided as f64)` — and render None as an em dash. The repo already has this signature at team_synthesis.rs:931, lab/ratings.rs:308 and (in TS) fleetHealth.ts:53, whose doc comment prescribes the rendering. CONVERGENT: brainiac's retrieval_events.rs:116-122 returns Option<f64> with the comment 'deliberately not 0.0, because no questions asked and every question failed must not render the same' plus a test named answered_rate_distinguishes_no_demand_from_total_failure; personas-cloud types the same field `number | null` to the wire at protocol.ts:88. PRECONDITION (must be re-derived per repo): this repo spells the defect as an `if n > 0 { .. } else { 0.0 }` expression. A repo using checked_div().unwrap_or(0.0), a match on the count, TS `: 0` / `?? 0` / `Math.max(1, n)`, or SQL COALESCE(x / NULLIF(y,0), 0) scores zero while the condition is present."
  },
  "exclude": [
    {
      "path": "src-tauri/src/commands/infrastructure/system_metrics.rs",
      "reason": "the one defensible member of this population: mem_used_percent guards `total > 0` on sysinfo's total_memory(), which is never 0 on a running host, so the else arm is unreachable rather than a no-sample rendering"
    }
  ],
  "baseline": { "files": 16, "matches": 34 },
  "floor": 500
}
```

```json
{
  "id": "absent-sample-as-absent-value-positive-control",
  "goldenPath": "docs/concepts/golden-paths/metric-definition.md",
  "title": "POSITIVE CONTROL — a ratio whose empty-sample branch yields an ABSENT value rather than a zero",
  "roots": ["src-tauri/src", "src-tauri/db", "src-tauri/engine", "src-tauri/core"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\(\\s*[A-Za-z0-9_.()]+\\s*>\\s*0(?:\\.0)?\\s*\\)\\s*\\.\\s*then\\(\\s*\\|\\|",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL, deliberately carrying NO baseline. Matches the CORRECT spelling this path prescribes: a sample-size guard expressed as `(n > 0).then(|| ...)`, which yields Option<f64> and forces the consumer to decide what absence renders as. Present at team_synthesis.rs:931, lab/ratings.rs:308 and :310, doc_rot.rs:662-663. It exists to prove the sibling rule's guard-matcher family is alive: empty-sample-as-confident-zero distinguishes itself from this one ONLY by whether the empty branch produces a number or an absence, so if a regex or walk change ever broke the `> 0` guard match, this control goes to zero and the run fails structurally. Recall is deliberately narrow — it does not match an early `return None`, a `match` on the count, or the TypeScript `number | null` equivalents — because a liveness probe wants a stable, exactly-understood population, not coverage. It must never be given a baseline."
  },
  "floor": 500
}
```

**Three conditions in this leaf I am refusing to gate, with the measurement that justifies each
refusal:**

1. **Two definitions of one metric disagreeing** (D1, D3) is the leaf's sharpest defect and is
   **not a string**. It is a relation between `digest.rs:154` and `digest.rs:314`, or between
   `defaultCockpit.ts:82` and `useObservabilityData.ts:97` — two divisions that are individually
   well-formed and jointly contradictory. No regex can know they are the same metric. The durable
   answer is T2's `Denominator` union; the cheap one is a cross-module test in the shape of
   `alert_evaluator.rs:403`. Recorded in Gap 5 rather than pretended into a signal.
2. **The mixed local/UTC day key** (D5) is a perfectly precise signal — I built it, ran it through
   the real engine, and it reports **2 files / 2 matches with 100% precision**. I am not shipping it
   because the population is two and the fix is two lines, which is the same trade
   [`llm-spend-accounting.md:715`](./llm-spend-accounting.md) made for its price-table rule. Both
   sites are named in D5 with the executed demonstration.
3. **A metric computed and never rendered** (D8) has a population of two and no regex form: proving
   `getDbPerformance` has no callers requires a reference graph, not a pattern. It belongs in a
   dead-export check (`ts-prune`-shaped) covering the whole `api/` surface, which is a different
   mechanism and a different leaf.

---

## Convergence

Measured against `../personas-web`, `../brainiac` and `../personas-cloud`, none of which has seen
this document.

| | this repo | personas-web | brainiac | personas-cloud |
| --- | --- | --- | --- | --- |
| A metric-**definition** artifact | `metricIdentity.ts`, **3 of 33** | **none** | **`brainiac-core/src/health.rs`** — argued registry, 6 behavioural tests, 3 delegating callers | two collectors named `metrics.ts`, no definitions |
| Files computing a user-visible metric | ~33 Rust + ~48 TS | **24** | ~14 | **4** |
| Success-rate implementations | **17** (+16 same-shape) | **7** (+2 renamed clones, +1 constant) | **1** | **3** |
| Distinct denominators for one metric | **4** | 2 | 1 (but **4 grade-band sets**) | 2 |
| Unit disagreement (0–1 vs 0–100) | ✓ `personaHealthSlice.ts:398` | ✓ `supabaseApi.ts:797` vs `:552` | — | ✓ `db.ts:1659` vs `metrics.ts:219` |
| Empty sample renders | **`0.0`** ×34 | **`0`** everywhere + `Math.max(1,n)` divisors | **`—`**, enforced by `Option<f64>` + a 3-state contract test | **`null`** in JSON — but `?? 0` at the Prometheus boundary |
| Definition documented at the site | **2 / 34** | 6 / 24 | **12 / 14** | 3 / 12 (and the one doc comment is **attached to the wrong function**, `db.ts:1571-1574`) |
| Definition shown to the **user** | 2 tooltips, 1 card | **0** (`MetricCard.tsx` has no description prop) | **`PILLAR_COPY`** renders what each number asks under every pillar | no UI |
| Dead metric | `getDbPerformance`, `hasFailureSpike` | `ToolUsageSummary.successRate`, the whole `/api/observability` client | **`health::grade_of`** — the registry's own function | `perPersona[].successRate`, `.hourlyHeatmap` |
| local-parts `Date` → `toISOString()` | ✓ `timeRange.ts:38` | **absent** (near-miss on a mock fixture) | **absent** | **absent** |

**Reinvented independently — treat as physics:**

| Clause | Evidence across four repos |
| --- | --- |
| **A rate over an empty sample must be ABSENT, not zero** | brainiac: `Option<f64>` + *"deliberately not 0.0, because 'no questions asked' and 'every question failed' must not render the same"* + a test named for that distinction + `?? null` + `"—"` + tile omission. personas-cloud: `: null` at `db.ts:1638/1659/1700` and `metrics.ts:214/218/269`, typed `number \| null` to the wire. Here: `fleetSuccessRatePct → number \| null` with the same reasoning in its doc comment. **Three teams, three languages, zero shared documents, one signature.** This is the strongest-supported clause in the path and it is exactly what §9 ratchets. |
| **Every codebase disagrees with itself about at least one metric definition** | 4 denominators here · all-rows vs completed+failed in personas-web · cancelled-in vs cancelled-out in personas-cloud · 4 grade-band sets in brainiac. **Four for four.** Not one repo has a single definition per metric. |
| **The disagreement is a local copy, and it appears wherever the reason was not written down** | brainiac's `console.rs:2731` imports three constants from the registry and *not* `grade_of`, then redefines it two lines later with a different band — the shadow has no comment, and it is the only undocumented site in that file. Here, `digest.rs:314` sits 160 lines below the comment explaining why it is wrong. |
| **The unit is untyped and drifts** | 0–1 vs 0–100 collisions in three of four repos, each between a "raw" path and a "display" path, none with the unit in a name or a type. |
| **The metric nobody renders gets computed anyway** | Four repos, four dead metrics, one of them (brainiac's `grade_of`) *the registry's own function*. |

**Where convergence contradicts me — reported as required:**

- **I was going to prescribe "build a metric registry" as the headline fix, and brainiac refutes the
  simple version.** It *has* the registry this path asks for — `health.rs`, one file, no IO, with a
  header arguing *"the formulas exist exactly once, here … a gate that disagrees with the dashboard
  it is named after is indefensible"*, six tests asserting behaviour, and three callers that
  delegate with comments explaining why. **And its `grade_of` is dead**, shadowed by
  `console.rs:2733`, which differs in exactly one band — a score of 50–54 grades "At risk" by the
  registry and "Critical" by the endpoint every leader actually reads. The same repo forked its age
  formatter **seven** ways, so the review-queue age measured against a 48h SLO renders as `2d 16h`
  on one screen and `3.2d` on another. **A registry does not prevent a shadow; it just makes the
  shadow diagnosable.** What survives: the registry is necessary, and the thing that actually held
  the line in brainiac is narrower — *the sites that carry a written reason are the sites that did
  not drift*. That is why §4 step 2 asks for four written facts and §2 mandates the comment, and why
  §9 gates the one condition a machine can see rather than the registry's adoption.
- **The brief's "August started on 2026-07-31" trap is real here and is NOT convergent.** All three
  siblings are clean: zero `new Date(y, m, …)` constructions anywhere in brainiac or
  personas-cloud, and personas-web's only near-miss (`usageViewData.ts:15-23`, local `setDate` →
  `toISOString`) is on a mock fixture. So `timeRange.ts:38` is **local calibration, not physics** —
  a genuine bug in this repo with no external support for the *pattern*, which is why §9 refuses to
  gate it and D5 names it for a two-line fix instead.
- **Fewer metric sites did not mean fewer definitions.** I expected the 24-file personas-web to be
  the worst and the 4-file personas-cloud to be clean. personas-cloud has the **cleanest** no-data
  typing of any of the four and still ships a live denominator disagreement between its SQL
  (cancelled excluded, `db.ts:1616`) and its Prometheus collector (cancelled included,
  `metrics.ts:132-134`). **Small surface area suppressed the volume of drift, not the fact of it** —
  which is the argument against treating this leaf's 33 sites as merely a size problem.
- **The one thing this repo is best at, and it is worth defending.** `personaHealthSlice.ts:50`'s
  `successRateSource: 'measured' | 'proxy' | 'unknown'` has **no analogue in any sibling**. brainiac
  labels a *chart* as schematic (`RotCurve.tsx:183`) and personas-web labels a *number* as a proxy
  in a comment (`supabaseApi.ts:756-757`), but neither carries provenance in a type that reaches the
  UI. Under the naive reading a clause with no trace elsewhere is local calibration; here the
  sibling data says the opposite — all four repos substitute a fleet average or a stub somewhere,
  and only one of them can say so in its type. Recorded as a strength to generalise (T2's
  `Provenance`), not as taste.

**A controlled experiment inside one file still beats all of it.** `src/engine/digest.rs` computes
one metric two ways, 160 lines apart, in one struct, rendered in one email: `:154` with the terminal
denominator and a four-line comment explaining why `COUNT(*)` is wrong, and `:314` with `COUNT(*)`.
Same author, same commit era, same file. Nothing about repo size, team size, language or tooling
varies. **The variable is whether the reason was written down at the site of the division** — it was
at `:150-152` and it was not at `:314`. That is the same mechanism as brainiac's undocumented
`grade_of` shadow, as `metricIdentity.ts`'s 3-of-33 adoption, and as
`fleetSuccessRatePct`'s single consumer: in every case the definition existed, in writing, one
import or one scroll away, and the next author divided anyway.
