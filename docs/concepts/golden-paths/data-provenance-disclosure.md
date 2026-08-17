# Golden path — Data provenance disclosure

> **Topic path:** `product-surfaces` › `metrics-and-charts` › `data-provenance-disclosure`
> [situation spine](../situation-spine.md) · recurrence 14 · risk **HIGH** · sides: **client**
> (spine also carries `twoSided: true` — see §12.1) · convergence: **mixed** ·
> dimensions: **ui · function · resilience · code-quality**
> `mergedFrom`: *Data provenance disclosure* + ***Machine-decision provenance*** — the second half
> is not optional and is measured here in full (§7 D5–D8).
> Composed 2026-08-16 against `master` @ `4f5621830`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` under `src/` (2,104 `.tsx`) and all **953** `.rs` across
> the four sibling crates `src-tauri/{src,db,engine,core}`. Every call site of every labelled-number
> primitive in the app was extracted with a **balanced-bracket open-tag parser** and inspected for
> which disclosure prop it passes — `StatCard` (32), `KpiTile` (32), `SlaCard` (4), `Numeric` (212),
> `AnimatedCounter` (15), `ConfidenceArc` (2). All **19,112** `en.json` leaf keys classified for
> provenance copy. All **244** live SQLite tables checked for a provenance column.
> `SLADashboard.tsx`, `SLACard.tsx`, `sla.rs`, `StalenessIndicator.tsx`, `SuccessSourceBadge.tsx`,
> `AthenaComposedBadge.tsx`, `AutoResolvedBadge.tsx`, `ComposedByBadge`, `ModelBadge.tsx`,
> `ProvenanceBadge.tsx`, `CostBreakdownBar.tsx`, `CostAccrualOverlay.tsx`, `KPIDashboard.tsx`,
> `kpiDetailParts.tsx`, `KpiDetailModal.tsx`, `credentialGraph.ts`, `backlogModel.ts`,
> `ExecutionPreviewPanel.tsx` and `pricing.ts` read in full.
>
> **Measured by execution, not by reading.** `get_sla_dashboard_with_offset`
> (`db/src/repos/communication/sla.rs:311-572`) — its window query, its per-persona aggregate, its
> global roll-up **and** `load_daily_trend`'s two-source merge — was transcribed **verbatim** into
> one script and replayed at all five `DAY_OPTIONS` against a read-only **copy** of the operator's
> live 347 MB `personas.db` (copied 2026-08-16 12:12 UTC; the app was running and the live file was
> never opened for write). 78 personas, 2,188 executions, 500 `sla_daily` rollup rows.
> **§0 publishes the number the user sees beside the number that is true.**
>
> **`cargo` was not run.** Every Rust claim is static or replayed in SQL.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It **inverted the brief on its single most
> confident claim** (§12.2) and inverted a clause of a sibling golden path composed hours earlier
> (§12.3).
>
> **Shared facts cited:** [`shared-facts.json`](../shared-facts.json).
>
> **Settles:** whether the pixel says how the number was made.

---

## 0. The headline

**On one card and one chart six lines apart in the same component, the Agent Reliability dashboard
prints two populations that differ by 32.1%, and nothing on screen — no badge, no caption, no
tooltip, no field in the wire type — says they are different populations.**

Replayed against the live database at `days=90` (`SLADashboard.tsx:139` and `:146-152`):

| what the screen renders | over what | true of |
|---|---|---|
| `SlaCard` "Success Rate" — **89.0%**, sub-caption **"1928/2166 executions"**, "59 active agents" | `persona_executions` only, windowed | **2,168** terminal rows |
| `DailyTrendChart` — *"Daily Success Rate — 90 Days"*, 17 points | `sla_daily` rollups **∪** raw, merged max-by-total | **2,865** rows — **+697, +32.1%** |

**697 of the executions in that chart do not exist in `persona_executions` at all.** They are frozen
rollup rows preserved past per-persona retention (`cleanup_old_executions(retention_days,
min_keep_per_persona)`, `db/src/repos/execution/executions.rs:1946-1990`) — which is the durable
tail working exactly as designed (`sla.rs:611-622`). The rollup is arguably the *truer* number. That
is the point: **from the screen you cannot tell which of the two is answering your question, and
they are 32 points apart.**

Per point, the divergence is not uniform:

| day | chart shows | live rows | phantom | chart rate | live rate | Δ |
|---|---:|---:|---:|---:|---:|---:|
| 2026-06-07 | 65 | 41 | 24 | **80.0%** | 87.8% | **−7.8 pp** |
| 2026-06-08 | 284 | 190 | 94 | **83.1%** | 78.4% | **+4.7 pp** |
| 2026-06-06 | 131 | 51 | 80 | 99.2% | 100.0% | −0.8 pp |
| 2026-06-03 | 312 | 194 | 118 | 90.7% | 89.2% | +1.5 pp |
| … | | | | | | |
| **12 of 17 points** render a **different rate** than their surviving rows would. |

### Where the provenance died — and it was computed, then thrown away

`load_daily_trend` (`sla.rs:692-800`) merges the two sources through a closure literally named
`consider`, which **decides, per day, which source won** (`:718-723`):

```rust
let mut consider = |day: String, acc: DayAcc| match by_day.get(&day) {
    Some(existing) if existing.total >= acc.total => {}
    _ => { by_day.insert(day, acc); }
};
```

The function's own docstring reasons about the difference at length — *"a sealed rollup is complete
while a same-day raw recompute may be stale-low … max-by-total picks the more complete source for
each day automatically"* (`:686-691`). **It knows. It computes the answer. And then it drops it**,
because `SlaDailyPoint` (`src/lib/bindings/SlaDailyPoint.ts`) is
`{ date, total, successful, failed, cancelled, success_rate }` — six fields, none of which can say
*rollup* or *raw*. On this install **17 of 17** points resolved to the rollup and the user has no
way to know that.

### And the freshness of a chart point is not a scalar

The tail query (`sla.rs:727-732`) selects `SUM(total)` and does not select `updated_at` at all. It
could not usefully: the day `2026-06-03` is **56 rollup rows** whose `updated_at` ranges from
**2026-08-03 18:56** to **2026-08-16 11:59**. One point on the chart is a mixture of 13 different
vintages. There is no single "as of" to render — which is a real modelling problem, not laziness,
and it is §8 Gap 3.

### The disclosure primitive is silent in exactly the case it was mounted for

`src/features/shared/components/feedback/StalenessIndicator.tsx` is the app's staleness badge.
Line 33:

```ts
if (!fetchedAt) return null;      // <- before the error arm
```

`applyPipelineResults` stamps `pipelineFetchedAt[source]` **only on success**
(`src/stores/slices/overview/overviewSlice.ts:203-208`). So a source that has **never** succeeded
has no `fetchedAt`, and the badge renders `null`. At
`DashboardHomeMissionControl.tsx:298` the component is mounted **inside the pipeline-error banner**,
with `hasError` hardcoded `true`:

```tsx
actions={<StalenessIndicator fetchedAt={pipelineFetchedAt[source]} hasError label={source} />}
```

**The one component in this repo whose job is to say "this data may be stale or failed" renders
nothing for a source that has never worked.** `personas-web` wrote the same component
independently and put its `error` arm **above** the null-guard (`StalenessIndicator.tsx:52-66`),
so its badge fires. Same name, same concept, no shared code, opposite ordering — §6 clause 2.

### Then look at the denominator

Every labelled-number primitive in the app, with the disclosure props its call sites actually pass:

| primitive | call sites | files | caption | tooltip | scope | provenance slot exists? |
|---|---:|---:|---:|---:|---:|---|
| `Numeric` (`display/Numeric.tsx`) | **212** | 111 | — | **0** | — | **no such prop** |
| `KpiTile` (`overview/components/shared/KpiTile.tsx`) | **32** | 9 | 4 (`subtitle`) | **0** | — | no |
| `StatCard` (`display/StatCard.tsx`) | **32** | 9 | **6** (`hint`, optional) | **0** | — | `hint` is the closest thing |
| `SlaCard` (`sub_sla/SLACard.tsx`) | **4** | 1 | **4** (`sub` — **required**) | **4** | **2** | yes, and used |
| `AnimatedCounter` | 15 | 10 | — | 1 | — | no |
| `ConfidenceArc` | 2 | 2 | 0 (`showLabel`) | — | — | value is 0–100 confidence, unlabelled |

**`SlaCard` is the only one whose caption is a required prop, and it is the only one every call site
fills.** 4/4 carry a tooltip; 2/4 carry a `scope` pill reading *"All-time"* on the two cards that do
**not** move with the window picker. The two *shared* tiles have **64 call sites between them and
zero tooltips**. That is `FacetedDecisionTable.emptyTitle` again
([contract](../golden-path-contract.md#prefer-a-type-over-a-gate--checked-three-times)), on a
different prop, with the same result.

And the whole disclosure surface, counted three ways:

| | count | of |
|---|---:|---|
| render sites carrying a provenance marker beside a value (census control, §9) | **28** in **22** files | 2,104 `.tsx` |
| `en.json` keys that state how a displayed number was produced | **≈28** | **19,112** leaf keys (0.15%) |
| `en.json` keys pairing a **rate** with its **sample size** | **3** | 19,112 |
| `(n=…)` rendered beside a number anywhere in the app | **1** (`PolicyProposalsSection.tsx:202`) | — |
| `StalenessIndicator` render sites | **5**, all in **2** files | 77 files hold a `setInterval` |
| persisted fields recording machine authorship | **18** | of which **0** have a closed type in Rust |
| model-identity **storage** sites : **render** surfaces | **11 : 5** | and the split is exact — see §7 D6 |

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count. Each clause names its warrant.

> **P1 — physics.** **A number's provenance is part of the number.** How it was produced —
> measured, estimated, proxied, machine-composed — is not metadata *about* the value; it is the
> half of the value that tells the reader what they are entitled to conclude. A surface that shows
> the digits and withholds the provenance has shown the reader half of a fact and let them believe
> it is all of it.
> *Warrant: 3 of 5 sibling repos independently grew a closed provenance union; the arms they chose
> (`measured` / `allocated` / `simulated`, `measured` / `proxy` / `unknown`) partition the same
> space with no shared document.*
>
> **P2 — physics, and the sharpest clause here.** **Provenance must be a property of the value, not
> of the prose next to it.** A caption, a panel title, a header chip and a footnote are all
> positional couplings that nothing enforces: they break under re-layout, under reuse of the value
> in a second surface, under a screenshot of the tile, under translation, and under any consumer
> that reads the field instead of the page. If the only thing distinguishing an estimate from a
> measurement is which words happen to sit beside it, the distinction is decoration.
> *Warrant: measured here as a controlled pair — one estimator's two outputs rendered in one grid,
> one labelled "(est.)" and its sibling not; and across the cohort, three of four UI repos mark
> some estimates and leave others unmarked **inside the same file**.*
>
> **P3 — physics.** **Two numbers on one screen over two different populations must say so.** The
> moment a surface assembles values from sources with different windows, different retention, or
> different sample sets, the reader will compare them — that is what a dashboard is for. The
> comparison is the product; an undisclosed population difference silently corrupts it.
> *Warrant: executed here at 32.1% between a card and the chart directly beneath it.*
>
> **P4 — physics.** **Freshness is a distribution, not a timestamp.** An aggregate's "as of" is the
> *oldest* member's, never the newest's and rarely a single instant. A surface that stamps one time
> on a rolled-up number is asserting a currency it does not have.
> *Warrant: one chart point here is 56 rows spanning 13 days of write vintages, reduced by `SUM()`
> to a single figure with no `updated_at` selected at all.*
>
> **P5 — ergonomics, and the one that makes the rest survive.** **Put the provenance in the type,
> beside the value, at every hop.** A field named `estimated_x` typed identically to the
> measurement beside it will be summed with it, averaged with it, and rendered like it, because
> nothing ever asked. Naming is not typing: a name survives until the first alias.
> *Warrant: an estimate and a measurement declared 18 lines apart in one struct, both bare numbers,
> are added together and divided by a third to gate two safety warnings.*
>
> **P6 — physics.** **A closed provenance union must be consumed by testing the TRUSTED arm, never
> an untrusted one.** `if (source === 'measured') hide the badge` stays correct forever; `if (source
> === 'simulated') show the badge` silently mislabels every arm added after it. Unions get widened;
> consumers do not get revisited.
> *Warrant: measured live — a six-arm union widened by a schema migration, with the render still
> testing one arm, so the newest arm renders as production truth.*
>
> **P7 — physics.** **"A machine did this" is provenance, and naming the machine is the part that
> matters.** A badge saying an agent acted is worth less than the identity of what acted, on what
> evidence, and how sure it was. Without those, the badge is a disclaimer rather than a disclosure —
> it tells the reader to distrust without telling them what to check.
> *Warrant: the one sibling that names provider **and** model on generated content carries it into
> its PDF and its share link; every other repo in the cohort, including this one, stops at the
> agent's name — and this repo stores the model on 214 live rows and renders it zero times.*
>
> **P8 — ergonomics.** **Precision is a claim about provenance.** Decimal places assert resolution.
> A figure derived from a character-count heuristic and a hardcoded price table, rendered to four
> decimals, asserts a measurement precision nothing behind it can support.
> *Warrant: universal violation — 4 of 4 UI repos in the cohort, with no shared formatting
> discipline anywhere.*
>
> **Scale condition.** P2, P3 and P6 are correctness on day one. P1 and P5 bite the first time a
> second producer feeds the same field. P4 bites the first time a value is cached or rolled up. P7
> and P8 bite the first time someone acts on the number.

---

## 1. Trigger

- "Where did this number come from?" / "is that real or is it guessing?"
- "Add the estimated cost to the run preview." / "show projected monthly spend."
- "The dashboard says 89% but the chart under it looks different."
- "Is this data live? When did it last refresh?"
- "Did a human approve this, or did the model?" / "which model wrote this?"
- "It says 100% but it's only seen two runs."

**If you are about to write** a value into JSX whose name contains *estimated*, *projected*,
*simulated*, *proxy*, *inferred*, *composed*, *auto*, or *synthetic* — or to render a number that
came from a **rollup, a cache, a fallback, a fleet average, a default, or a model** — **you are in
this situation.**

You are **not** in this situation when the question is what the number counts (that is
[`metric-definition`](./metric-definition.md)), what a failed source resolves to
([`partial-failure-read-envelope`](./partial-failure-read-envelope.md)), or what the tile looks like
(`metric-tile`, unwritten).

### Boundaries with the adjacent leaves

The seam test, and it is checkable: **would changing it change the number, or change what the
reader is entitled to conclude from it?**

| Territory | Owner | Do not restate |
|---|---|---|
| The numerator, the denominator, the window's length, the unit, whether an empty sample is `0` or absent | [`metric-definition`](./metric-definition.md) | It **chooses** the window; **this path puts the window on screen.** Its §7 D0 executed the decomposition — the window moves the number **6.8×** more than the denominator, and *"almost nothing displays its window"* is this leaf's problem, not its. |
| What a failed source's value becomes; per-source error envelopes; aggregates over survivors | [`partial-failure-read-envelope`](./partial-failure-read-envelope.md) | It owns **completeness**. This owns **provenance**. Its P4 (*"disclose at the level of the thing that is wrong"*) is the direct ancestor of P2 here, and its `StalenessIndicator` deviation (D7) is re-measured here with a defect **inside** the component (§0, §7 D2). |
| What the number *looks like* — separators, locale, the `%`/`$` glyph | [`number-and-cost-formatting`](./number-and-cost-formatting.md) | It owns rendering. This owns **how many digits the provenance can support** (P8). |
| Whether a mark needs a scale the mark does not carry | [`chart-component`](./chart-component.md) · [`proportional-bar-list`](./proportional-bar-list.md) | They own encodings that **cannot lie about the world**. This owns whether the encoding says *which world* — a dashed vs solid stroke for simulated vs measured is **this** path's (§6). |
| Where money comes from and what a budget cap reads | [`llm-spend-accounting`](./llm-spend-accounting.md) | Its P1 is provenance for money specifically. §7 D3 here is that P1 arriving on a *pre-flight estimate* instead of a total. |
| Whether a hover explanation should be a `title=` or a `<Tooltip>` | [`tooltip`](./tooltip.md) | **They collide — see §6 "The composition defect".** 4 of the 5 provenance affordances in this app deliver their explanation through `title=`. |
| Whether the operator learns a read failed | [`swallowed-error-telemetry`](./swallowed-error-telemetry.md) | It asks *can the operator learn*. This asks *can the reader tell*. |

## 2. The one way

**Decide what makes this number trustworthy before you write it, and carry that decision in the
type all the way to the pixel — never in the prose beside it.** Concretely: (a) **give any value
that can be produced more than one way a closed provenance discriminator** — a union with an arm per
producer (`'measured' | 'proxy' | 'unknown'` is the shape this repo already ships, and a sibling
independently chose `'measured' | 'allocated' | 'simulated'`), declared on the same struct as the
value and, if the value is persisted, closed at the storage layer too — this repo does that once,
with a SQL `CHECK`, and widening it is a migration. (b) **Consume that union by testing the TRUSTED
arm** (`if (source === 'measured') return null`), never an untrusted one, so the next arm anybody
adds discloses by default (P6). (c) **Render the marker as part of the value's own element** — a
badge inside the tile, a suffix on the numeral, a dashed stroke on the series, a hollow dot — never
as a panel header, a section title or a footnote, because those are positional couplings that do not
survive re-layout, reuse, or a screenshot (P2). (d) **Ship the sample size beside any rate** and the
**window beside any windowed figure**; the repo has one string that does all three at once
(*"{rate}% of auto-fixes held across {attempted} attempts in the window"*) and it is the model. (e)
**When two numbers on one surface cover different populations, say so on both** — a `scope` pill is
four lines and this repo already has one. (f) **Stamp freshness from the OLDEST contributing member,
not the newest**, and if you cannot name a single "as of", say the range rather than a point (P4).
(g) **When a machine produced it, name the machine, the evidence and the sample** — "Athena did
this" is a disclaimer; *"composed by `claude-sonnet-4-6`, n=12, evidence snapshot `abc123`"* is a
disclosure the reader can act on (P7). (h) **Round to the resolution your provenance supports** — a
cost derived from `text.len() / 3.8` and a hardcoded price table does not get four decimal places
(P8). Then stop: do not add a second boolean beside the union, do not put the provenance only in a
`title=`, and do not solve it with a page-level banner.

If you must get one right first: **(c)**. (a) and (b) are what make (c) *maintainable*, but a
correctly-typed provenance union that never reaches a pixel — which is what this repo has in three
of its four unions — is a comment with extra compile time.

## 3. Mandated primitives

Every one of these exists today. The adopter counts are the finding.

| Primitive | What it gives you | Adopters |
|---|---|---|
| **`stores/slices/overview/personaHealthSlice.ts:50`** — `successRateSource: 'measured' \| 'proxy' \| 'unknown'` | **The provenance union.** A closed type saying whether a rate was measured from this subject's own rows, substituted from a fleet aggregate, or absent, with a doc comment (`:33-49`) explaining each arm and why the UI must distinguish them. Independently reinvented in `ascent` as `Fidelity` (§6). | **1 feature** |
| **`overview/sub_health/…/SuccessSourceBadge.tsx`** | **The correct consumer, and the shape to copy.** `if (source === 'measured') return null` (`:22`) — it tests the **trusted** arm, so every future arm discloses by default (P6). Uses `<Tooltip>`, not `title=`; renders a chip with distinct copy per arm. | **2** (`VitalsLedger.tsx:211`, `RowDetail.tsx:45`) |
| **`dev_kpi_measurements.source`** — SQL `CHECK(source IN ('evaluator','manual','scan','health_snapshot','simulation','ai-compose'))` | **Provenance closed at the STORAGE layer** — the only such column in 244 live tables. Adding an arm is a schema migration with its own guard (`db/src/migrations/incremental.rs:8232-8280`, which refuses to rebuild if the DDL is not the shape it was written against). Its sibling `env CHECK IN ('local','test','production')` carries a stated invariant: *"simulation rows are 'local'/'test' ONLY — a simulated value never claims the production channel."* | 1 table; rendered as a chip on every measurement (`KpiDetailModal.tsx:319`) |
| **`teams/sub_kpis/kpiDetailParts.tsx:216-224`** + **`KPIDashboard.tsx:343`** | **Provenance encoded in the MARK.** The simulated series is a dashed polyline with **hollow** dots over the solid measurement line — *"visually subordinate to the solid production truth line"* — and the dashboard's Recharts line does `strokeDasharray={simulated ? '6 4' : undefined}` with a legend suffix (`:330`). This is P2 done properly on a chart and the strongest craft in the repo on this leaf. | 2 charts |
| **`overview/sub_sla/components/SLACard.tsx:7-38`** | **The tile that cannot omit its caption.** `sub: string` is **required**; `scope?: string` renders an "All-time" pill on numbers that do **not** move with the window picker (`:14-19`); `tooltip?` carries the denominator policy. 4/4 call sites pass `sub` and `tooltip`. Compare `StatCard.hint` (optional → 6/32) and `KpiTile` (no caption → 0/32). | 4 |
| **`shared/components/feedback/AthenaComposedBadge.tsx`** | **The shared machine-authorship badge**, `@catalog`-tagged: *"Provenance badge for anything Athena composed, diagnosed, or handled autonomously … so 'an AI did this' reads identically everywhere."* Three closed arms (`composed \| diagnosed \| handled`), caller-supplied localized label, optional `title` for the rationale. | **8** |
| **`overview/sub_manual-review/components/AutoResolvedBadge.tsx`** | **A machine decision that bypassed a human queue, made visible** — *"so the silent bypass of the human queue is no longer invisible in the UI. (UAT P5 — F-NO-CONFIDENCE-AUTORESOLVE.)"* Distinguishes `trust_llm` from `auto_triage`. The docstring names the confidence gap as a known defect rather than hiding it. | 2 |
| **`teams/sub_kpis/KPIConnectWizard.tsx:45` — `ComposedByBadge`** | **Deterministic vs model-composed, in two colours and two icons** — ⚡ + success-green for `'recipe'`, ✨ + primary for `'llm'`. No tooltip needed; the distinction is the badge. | 3 |
| **`shared/glyph/ModelBadge.tsx:65-82`** | **The only component in the app that names a model tier on a value AND exposes the rationale** — `title={rationale ? \`${model}\n\n${rationale}\` : model}`. | **1** (`GlyphCard.tsx:139`) |
| **`settings/sub_network/components/ProvenanceBadge.tsx`** | **Origin provenance for imported content** — source peer display name + peer id + bundle hash + `Verified: Yes/No`. The only affordance in the app that discloses *where a thing came from* rather than *how it was computed*. | 1 |
| **`shared/components/feedback/StalenessIndicator.tsx`** | **Freshness beside data.** `fetchedAt` + `hasError` → an amber "N minutes ago · refresh failed" chip; `null` when fresh. i18n'd, props-only. **Read §0 and §7 D2 before adopting: its null-guard precedes its error arm, so it is silent for a never-fetched source.** | **5**, in 2 files |
| **`settings/sub_engine/…/PolicyProposalsSection.tsx:196-222`** | **The best evidence surface in the app.** Per-candidate quality with its sample size — `<Numeric value={c.avgLabQuality} precision={1} /> (n={c.labSamples})` — plus `evidenceSnapshotId` on the composed badge, `qualityBasis`, `incumbentRuns`, and a healing note pairing a rate with its attempt count. The **only** `(n=…)` in 2,104 `.tsx` files. | 1 |
| **`agents/sub_executions/detail/inspector/CostBreakdownBar.tsx`** | **Three honesty decisions in 100 lines**: an amber chip when the pricing table did not recognise the model (`:44`); `canSplit = pricedTotal > 0` refusing to draw a 50/50 bar *"which asserted a decomposition nobody measured"* (`:29-33`); and `actualCostUsd ?? pricedTotal` so the table supplies only the **ratio**, *"never a second total"* (`:14-20`). | 1 |
| **`agents/sub_executions/replay/CostAccrualOverlay.tsx:76-108`** | **Two provenance channels on one graphic, correctly separated**: an `isSynthetic` badge for *"the trace timing was reconstructed"*, and a **dash pattern applied unconditionally** for *"the curve's SHAPE is always a proportional reconstruction … regardless of `isSynthetic`"* (`:98-104`). The comment is the clearest statement of P2 in the tree. | 1 (+ `PipelineWaterfall.tsx:103`) |
| **`en.json` → `settings.engine.tuning_healing_note`** | *"Healing context: {rate}% of auto-fixes held across {attempted} attempts in the window."* — **a rate, its sample size and its window in one sentence.** The model string for (d). | 1 |

**Explicitly NOT primitives:**

- **`display/Numeric.tsx` (212 render sites).** It renders `null` as an em dash — correct — and has
  **no prop of any kind** for provenance, coverage, staleness or estimate-ness. Routing a caller
  here satisfies `number-and-cost-formatting` and does nothing for this leaf. §8 Gap 1.
- **`display/KpiTile.tsx` (32 sites).** `subtitle` exists only at `card-rich` density and is not a
  provenance slot; there is no tooltip.
- **`display/ConfidenceArc.tsx`.** It draws a 0–100 confidence and `showLabel` defaults **false**;
  both call sites leave it false, so a confidence renders as an unlabelled arc.
- **A `Sparkles` icon.** 331 AI-icon render sites in `src/`; **≈22** are a claim about a specific
  value's provenance. **≈1 in 15.** The other 309 are feature branding, and in `personas-web` and
  `vibeman` the ratio is 0 in 20 (§6 clause 6).

## 4. Steps

1. **Name the producers before you name the field.** How many ways can this value come to exist?
   Measured from this subject's own rows; substituted from an aggregate; computed from a heuristic;
   composed by a model; read from a frozen rollup; defaulted. If the answer is more than one, you
   need (2).
2. **Add the discriminator to the same struct as the value**, as a closed union with an arm per
   producer — not a `boolean`, which cannot grow, and not a free `String`, which is what all 18
   machine-authorship fields in this repo are (§7 D5).
3. **Close it at the storage layer too if the value is persisted.** A SQL `CHECK` makes an
   unrecognised arm a write error instead of a render surprise. `dev_kpi_measurements` is the model.
4. **Ask whether the type can make the wrong render impossible — before writing the gate.** See
   below. For the *estimate/measurement* axis it can and it is one wrapper; for the *disclosure*
   axis it cannot, and §9 says so.
5. **Consume the union by testing the trusted arm.** `if (source === 'measured') return null`. Never
   `if (source === 'simulation') showBadge` — §7 D4 is the live cost of getting this backwards.
6. **Put the marker inside the value's own element.** A badge in the tile, a `≈` on the numeral, a
   dash pattern on the stroke, a hollow dot. Not the panel header. Not a footnote. **And then
   stop** — one marker, at the value.
7. **Add the sample size to any rate and the window to any windowed figure.** `(n=42)`,
   `"1928/2166 executions"`, `"— 90 Days"`. If a figure does *not* move with the window control,
   give it a `scope` pill; two of the four SLA cards need one and have one.
8. **Stamp freshness from the oldest contributing member.** If the value is a rollup of rows with
   different write times, carry the min, or carry the range, or carry nothing — but never the max.
9. **When a machine produced it, plumb the model through the view-model.** The field usually already
   exists; the mapper drops it. `backlogModel.ts:53-68` maps 18 fields off `DevIdea` and omits
   `provider` and `model`, which are populated on 214 of 236 live rows.
10. **Round to your provenance.** `fmtCost(v, { precision: 4 })` is defensible on a billed amount and
    is not defensible on `text.len() / 3.8 × a hardcoded price table`.
11. **Test the untrusted arm, not the happy one.** One test where `source` is the *newest* arm you
    added. The KPI dashboard has none, which is why D4 shipped.
12. **And then stop.** Do not add a page-level "some data may be estimated" banner, do not put the
    provenance only in a `title=`, and do not delete the number — a withheld number with a reason
    beats a fabricated one, but a disclosed number beats both.

### Can the type make the wrong call impossible? — asked before §9

**Split answer, and the split is the finding.**

**T1 — YES for the estimate/measurement axis, and it is one wrapper.** The bad state is not "an
estimate exists"; it is **"an estimate and a measurement are the same type, so they compose."** The
proof is one struct:

```rust
// src-tauri/engine/src/cost.rs:84-102 — ExecutionPreview
pub estimated_input_tokens: u64,   // "Approximate input token count."   <- text.len() / 3.8
pub estimated_total_cost: f64,     // "Estimated total cost (USD)."      <- x a hardcoded price table
pub monthly_spend: f64,            // "Current monthly spend for this persona (USD)."  <- a DB read
pub budget_limit: f64,             // "Monthly budget limit (USD, 0 = unlimited)."     <- config
```

Four `f64`s. Eighteen lines apart. The consumer adds two of them and divides by a third:

```ts
const budgetPct = preview.budget_limit > 0
  ? ((preview.monthly_spend + preview.estimated_total_cost) / preview.budget_limit) * 100 : 0;
const overBudget = budgetPct > 100;      // gates a warning
const nearBudget = budgetPct > 80;       // gates a warning
```
— `ExecutionPreviewPanel.tsx:72-75`

**A measurement and a character-count heuristic are summed, and the sum gates two safety warnings.**
Nothing in the type system objected, because in this repo the provenance lives in the *name* and
names do not survive an arithmetic operator. Make it `Estimated<f64>` (or, cheapest,
`estimated_total_cost: Estimate` where `Estimate` is a newtype with a private field and no `Add<f64>`
impl) and the line stops compiling until somebody decides whether an estimate may enter a budget
gate. Held against the seven qualifications:

- **Q1 (a type carries only what it encodes)** — holds, and this is the qualification's *own worked
  example* re-measured: `successRateSource` is a correctly-closed union that did not prevent a 100×
  unit bug because the **unit** lived in the number ([`metric-definition` §7 D6](./metric-definition.md)).
  `Estimated<T>` encodes *"not measured"* and encodes nothing about scale, freshness or sample size —
  which is why (d), (f) and (h) in §2 are separate mandates and not folded in.
- **Q2 (requiredness ≠ closedness)** — this is a *closedness* edit on the value's provenance axis.
  Making `monthly_spend` required changes nothing; it already is.
- **Q3 (a type nobody constructs constrains nothing)** — **check this one carefully, because it
  nearly kills the proposal.** `ExecutionPreview` has **1** construction site
  (`engine/src/cost.rs:106`) and its estimate fields have **1** consumer, so the wrapper reaches
  everything. The *general* `Estimated<T>` across the 20 sites in §9 does **not** meet Q3 today —
  there is no shared numeric wrapper in `src/lib/` and inventing one that 20 sites must adopt is a
  refactor, not a type. **So: ship the newtype on `ExecutionPreview` (where it is total) and treat
  the general form as direction, not prescription.**
- **Q5/Q6 (withhold the dangerous freedom, not the answer)** — the dangerous freedom is `+` between
  an estimate and a measurement, not the estimate itself. A newtype that still exposes `.value()`
  keeps the feature and removes the accident.

**T2 — NO for the disclosure axis, and that is this leaf's structural result.** No type can make
"the pixel says so" mandatory, because the render is a free-form JSX tree. The nearest reachable
thing is **a primitive whose disclosure slot is required** — `SlaCard.sub: string` gets 4/4;
`StatCard.hint?` gets 6/32; `KpiTile` with no slot gets 0/32. That is a 3-point controlled
experiment inside one repo on one prop concept, and it points the same way as
`FacetedDecisionTable.emptyTitle`. **The fix that would move the most pixels is one edit at
`Numeric`** — a `provenance?: 'measured' | 'estimated' | 'proxy' | 'simulated'` prop that renders a
`≈` or a dimmed suffix — because it is the destination 212 call sites already reach. Per the
contract's fifth §9 failure mode: **fix the destination before ratcheting the callers.** Today a
gate routing anyone to `Numeric` points at a component that is *incapable of saying the true thing*.

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **Two figures on one surface over two populations, undisclosed** | The reader compares them — that is what the surface is for. Executed: an SLA card reading 89.0% over 2,166 runs sits six lines above a chart summing **2,865**, of which **697 no longer exist in the executions table**. §7 D1. |
| **An estimate and a measurement declared as the same numeric type** | They get added. `monthly_spend + estimated_total_cost` gates the over-budget and near-budget warnings on a persona's run preview. §7 D3. |
| **`if (source === '<untrusted arm>') disclose`** | The union gets widened and the consumer does not. Live: a six-arm `CHECK`ed union whose render tests `=== 'simulation'`, so an **LLM-composed** KPI reading draws as a **solid production line**. §7 D4. |
| **Provenance in the panel header, the section title, or a footnote** | Positional coupling. A panel titled "Revocation Simulation" containing a bold `$` figure labelled "Daily Cost Impact" tells a scanner nothing; the estimate-ness does not survive the tile being read on its own. §7 D3. |
| **Provenance in a `title=` and nowhere else** | Hover-only, touch-invisible, screenshot-invisible, and counted as a violation by [`tooltip`](./tooltip.md)'s own census rule — which **4 of the 5** provenance affordances in this app trip. §6, §8 Gap 4. |
| **A machine-authorship badge that names the agent but not the model** | "Athena composed this" tells the reader to distrust without telling them what to check. The model is stored on **214 of 236** live backlog rows and rendered **zero** times. §7 D6. |
| **A `boolean` or a free `String` for authorship** | 18 persisted machine-authorship fields in this repo; **0** have a closed Rust type; 5 of them have no doc comment naming the legal values at all, so the vocabulary is unknowable from the type. §7 D5. |
| **Stamping an aggregate's freshness from its newest member** | `MAX(updated_at)` over a day bucket reports 2026-08-16 for a point whose oldest contributing row was written 2026-08-03. The number looks current because one of its 56 members is. §7 D2. |
| **A null-guard above the error arm in a staleness component** | The badge disappears in exactly the case it was mounted for — a source that has *never* fetched. §0, §7 D2. |
| **A rate with no sample size** | `100%` over two runs and `100%` over two thousand are the same pixels. **3 of 19,112** i18n strings pair a rate with its sample; **1** JSX site renders `(n=…)`. |
| **Decimals beyond the provenance** | `$0.0234` from `text.len() / 3.8` × a hardcoded list-price table asserts a resolution nothing behind it has. Universal across the cohort (4 of 4 UI repos). §6 clause 7. |
| **`estimated: false` meaning "the lookup succeeded"** | `estimateCost()` returns `estimated: false` for any model its **hardcoded price table** recognises (`pricing.ts:56-71`). The flag is honest about its own definition and reads, at the call site, as *"this is not an estimate"* — which is Q1 exactly. §7 D3. |
| **A page-level "some values may be estimated" banner** | The reader who copies the number does not copy the banner. P2. |

## 6. Evidence

**The ONE site to copy: `src/features/teams/sub_kpis/` — the KPI measurement chain, end to end.**

It is the only place in this repo where provenance is closed at the database, carried on the wire,
and encoded in the mark:

```sql
-- live DDL, dev_kpi_measurements
source TEXT NOT NULL DEFAULT 'manual'
  CHECK(source IN ('evaluator','manual','scan','health_snapshot','simulation','ai-compose')),
env    TEXT NOT NULL DEFAULT 'production'
  CHECK(env IN ('local','test','production')),
evidence TEXT,
```

```tsx
// kpiDetailParts.tsx:216-224 — the simulated overlay: dashed + hollow dots,
// visually subordinate to the solid production truth line
<polyline points={model.simLine} stroke="#8B5CF6" strokeDasharray="5 4" opacity="0.85" />
{model.simDots.map((p, i) => (
  <circle key={i} cx={p.x} cy={p.y} r="2.2" fill="var(--background)" stroke="#8B5CF6" />
))}
{/* the measurement line */}
<polyline points={model.line} stroke="var(--primary)" strokeWidth="1.5" />
```

Six decisions worth copying: (1) the provenance vocabulary is a **`CHECK` constraint**, so an
unknown arm is a write error; (2) widening it is a **migration with a shape guard** that refuses to
rebuild if the DDL is not what it was written against (`incremental.rs:8247-8254`); (3) a **second,
orthogonal axis** (`env`) carries a stated invariant — *"a simulated value never claims the
production channel"*; (4) the marker is **in the mark**, not in a caption — dashed stroke, hollow
dot, legend suffix (`KPIDashboard.tsx:330,343`); (5) the doctrine is written next to the control it
governs — *"Production is authoritative; test/local are the simulated channels"* (`:249`); (6) every
individual measurement carries its own chip in the history list (`KpiDetailModal.tsx:313-320`), so
the provenance survives at row level as well as series level.

**Then read §7 D4**, which is the one thing this chain gets wrong, and it is a one-line fix.

**Secondary exemplars, each for one property:**

| Site | What to copy |
|---|---|
| `overview/sub_health/.../SuccessSourceBadge.tsx:22` | **Test the trusted arm.** `if (source === 'measured') return null` — silence means measured, and every future arm discloses by default. Nine words, and it is P6. |
| `overview/sub_sla/components/SLACard.tsx:7-19` | **A required caption and a `scope` pill.** `sub: string` (required) + `scope?: string` on figures that do *not* move with the window control. The prop comment states the rule: *"so users can tell at a glance which numbers are bound to the selected time window and which are not."* |
| `agents/sub_executions/replay/CostAccrualOverlay.tsx:98-104` | **Two provenance facts, two channels, and the comment that distinguishes them.** The badge is about the *timing*; the dash is about the *shape* and is unconditional. Most surfaces collapse these into one flag. |
| `agents/sub_executions/detail/inspector/CostBreakdownBar.tsx:29-33` | **Refusing to render a decomposition nobody measured**, in a comment: *"Otherwise we show the total alone rather than a fabricated 50/50 bar … which asserted a decomposition nobody measured."* |
| `settings/sub_engine/.../PolicyProposalsSection.tsx:200-222` | **Evidence beside the claim**: per-candidate quality with `(n={c.labSamples})`, an `evidenceSnapshotId` on the badge, and a healing note pairing a rate with its attempt count and its window. |
| `overview/.../AutoResolvedBadge.tsx:10-14` | **Naming your own gap in the docstring** — *"(UAT P5 — F-NO-CONFIDENCE-AUTORESOLVE.)"* A known-missing confidence value recorded where the next author will read it. |
| `shared/components/feedback/AthenaComposedBadge.tsx:4-9` | **One shared badge so "an AI did this" reads identically everywhere** — `@catalog`-tagged, three closed arms, caller-supplied localized label. 8 sites and it is the app's most-adopted provenance affordance. |
| `en.json → plugins.dev_tools.llm_cost_note` | *"Costs are token×price estimates from {tool}, not billed amounts."* The single best provenance sentence in 19,112 keys — and see §7 D3 for the four cost surfaces that need it and do not have it. |
| `en.json → plugins.dev_tools.slot_qscore_tooltip` | *"Heuristic estimate from task status + diff size, not a build/test/lint run — Build: {build}/25 · Tests: {tests}/30 …"* Names the method, names what it is **not**, and shows the components. |

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** `personas-cloud` has **zero `.tsx`
files** — it is headless, so the render-side clauses are structurally absent there and are reported
as such rather than counted as a choice.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **A closed provenance union on a value** | **PHYSICS (3/5), and the arms agree** | `ascent/src/lib/integrations/providers.ts:11` — `type Fidelity = "measured" \| "allocated" \| "simulated"`, persisted at `prisma/schema.prisma:764`, resolved at `aiDeliveryModel.ts:117`, rendered by `FidelityBadge` (`aiShared.tsx:28`) whose `allocated` copy is *"Provider reports above repo level; Ascent distributes it to repos by AI-attributed PR volume"* — **that is the proxied arm, named by its mechanism.** `brainiac/console/src/lib/demo-fallback.ts` — `DemoResult<T> { data: T; live: boolean }` with the contract in its header: *"a maintainer never sees fabricated tokens / memories / graph nodes without a prominent warning."* `vibeman/src/app/db/models/types.ts:26` — `progress_source?: 'manual' \| 'inferred' \| 'hybrid'`. Here: `successRateSource`. **Four repos, four domains, one shape, no shared document.** Silent: `personas-web` (grepped `provenance`, `is_estimate`, `'measured'`, `'proxy'`, `'estimated'` — one hit, `source: "mock"` in a demo file). |
| 2 | **A freshness marker rendered beside the data** | **PHYSICS (4/5) — the strongest convergence in the fleet, and it INVERTS the brief** | Four repos reinvented it in four shapes with no shared code. `personas-web/src/components/dashboard/StalenessIndicator.tsx` — **same component name, same concept, 7 render sites** (vs this repo's 5), i18n'd, and it **pauses its 10 s tick while the tab is hidden** then catches up on resume (`:41-50`). `ascent` — `src/lib/ui.ts:194 timeAgo` / `:222 freshness`, ~13 sites incl. a `QuotaStaleNotice` banner. `brainiac` — one shared formatter + 3 hand copies; `Archive.tsx:307` renders *"as of {date} · {n} true then"*. `vibeman` — six hand-rolled `ago()` functions, no shared component. |
| 2b | **…and `personas-web`'s ordering is BETTER than ours** | **this repo is BEHIND** | `personas-web/StalenessIndicator.tsx:52-66` puts the `error` arm **above** the `fetchedAt === null` return; ours puts the null-guard first (`:33`), so a never-fetched failing source renders nothing. §0. |
| 3 | **The window displayed beside the number** | **MINORITY (3/5)** | `ascent/src/lib/window.ts:52-54` makes the window a first-class object with `title` / `comparisonLabel` / `reviewTitle` per key, rendered as `· last {n}d` on **eight** stat lines and carried into PDFs and share links. `brainiac/console/src/observatory/Observatory.tsx:449` `last {d.windowDays} days`. `vibeman` 3 literals. **The instructive negative is `personas-web`**: it has a full `DateRangePreset` union, a chip-group control and per-preset keys in 18 locales — and never prints the selected window beside a number. Its tiles say only `trendLabel="vs last period"`. **The window is a query parameter that happens to be spelled in the UI as a button.** |
| 4 | **The sample size displayed beside a rate** | **MINORITY bordering on SILENCE (2/5, one trivial)** | Only `ascent`, and it goes further than displaying — it **refuses**: `src/lib/analyze/pulls.ts:143-146` *"Require a meaningful sample before deriving a governance RATE … 5 is the minimum where the rate isn't dominated by one PR; below it stays null"*, surfaced as `sub={pr.avgAiGovernedRate == null ? "small sample" : "governed AI"}` (`PrSignalsBand.tsx:76`) and `trend confidence — low data (n={forecast.points})` (`Trajectory.tsx:94`), whose comment explains *"on < 3 distinct scan days the R² is mathematically 1 regardless of noise."* Everywhere else **the denominator is in scope at the moment of render and is deliberately discarded** — `personas-web/app/dashboard/home/page.tsx:80` computes `total > 0 ? Math.round((completed/total)*100) : 0` and `VitalsConsole.tsx:129` renders the ring bare; `vibeman/PollingDashboard.tsx:128` → `:187` the same. |
| 5 | **An estimate visually distinguished from a measurement** | **MINORITY (3/5), and internally inconsistent in every one** | All three repos that mark *some* estimates leave others unmarked **in the same file**: `vibeman/src/app/Claude/components/CostEstimation.tsx` tildes the duration at `:47` and the token count at `:111` and renders the **dollar figure bare** at `:90` — the most derived number on the card. Same shape here (§7 D3). Nobody in the cohort has a shared "this is an estimate" primitive; the tilde is applied by whoever wrote that JSX. `brainiac` is silence — LLM confidences render as `conf {m.confidence.toFixed(2)}` (`MemoryInspector.tsx:55`) with no marker at all. |
| 6 | **Machine authorship disclosed, and the model NAMED** | **MINORITY (2/5) — `ascent` is in a different category and this repo is behind** | `ascent/src/components/report/ReportHeader.tsx:81` renders `engine: {report.engine.provider} · {report.engine.model}`; `:63-69` distinguishes the keyless deterministic demo (*"scores are computed from deterministic signals, not LLM-written analysis"*); `src/lib/org/briefing.ts:21` computes an **engine mix** — *"Claude CLI ×18, Mock ×2"* — with a dedicated `engineMixDegraded` predicate for *"the 'mock-degraded quarter' an examiner must see"*, and carries all of it into the PDF (`report-document.tsx:123`), the share link and the copy-for-LLM markdown. `brainiac` discloses fabricated-vs-real thoroughly (5 `DemoBanner` pages + per-series `· demo trend`) and **never names a model**. |
| 6b | **⚠ `Sparkles` as decoration, not provenance** | **PHYSICS AS A NON-SIGNAL (5/5)** | 20+ `Sparkles` in `personas-web` and 12+ "AI-generated" strings in `vibeman` are **branding in every single instance** — heroes, buttons, section headers, one textarea placeholder. Here it is 331 icon sites to ≈22 provenance claims. **An AI icon is not an AI disclosure anywhere in this fleet.** |
| 7 | **⚠ Precision beyond provenance** | **UNIVERSAL VIOLATION (4 of 4 UI repos)** | `vibeman/CostEstimation.tsx:34` `$${cost.toFixed(2)}` where `:60` guesses output tokens as `inputTokens * 2.5` against a table `:21` self-labels *"approximate, as of 2024"* — two guesses, rendered to the cent. `personas-web/SLATargetGrid.tsx:120` `{(target.timeInSLA * 100).toFixed(2)}%` on a compliance rate served from `mock-dashboard-data`. `brainiac` `.toFixed(2)` on LLM confidences ×3. `ascent` violates it too and is the only repo that **pairs the over-precise numeral with a hedge** (a footnote at `usageDashboard.tsx:210`, the calibration MAE in a tooltip at `ModelScorecard.tsx:52`). **There is no shared rounding discipline anywhere in the fleet.** |
| 8 | **A substituted value flagged all the way to the render** | **PHYSICS for the labeled form (2/5, independently), VIOLATION in the other two** | `ascent` invents per-repo AI spend by allocation (`aiDeliveryModel.ts:147-151`) and even by `hash(row.fullName)` (`:154-161`) — and then `withholdAllocatedRoi` (`delivery/page.tsx:53`) **suppresses the ROI figure entirely** in allocated mode. `brainiac` routes every read-surface swap through one `withDemoFallback` helper with a **documented deliberate exception**: write surfaces hard-stop rather than degrade, because a fabricated queue wired to real approve/reject buttons is dangerous. Against that: `personas-web/PerformanceMetricsGrid.tsx:26-28` renders `$0.00 / 0 / 0.0%` from `?? 0` with `trendLabel="vs last period"` beside it. |

**Physics — keep as doctrine:** clauses 1, 2, 6b, 7, 8 (7 as a defect, 6b as a non-signal).
**Reported as MINORITY:** clauses 3, 4, 5, 6 — and on 4 and 6 **`ascent` is meaningfully ahead of
this repo**: it refuses to compute a rate below a sample floor and says so on screen, and it names
the provider and model on generated content and carries that into every export.
**Personas is ahead** on exactly one thing: **provenance closed at the storage layer**
(`dev_kpi_measurements`'s `CHECK`). No sibling closes a provenance vocabulary in SQL;
`ascent` persists `fidelity` as a bare `String` with the arms in a `//` comment
(`prisma/schema.prisma:764`).

> **The strongest external result is clause 2, and it is not agreement — it is a repo we assumed we
> led.** The brief, and [`partial-failure-read-envelope` §6 clause 10](./partial-failure-read-envelope.md),
> both state that **no sibling has a component that renders staleness and Personas does.**
> `personas-web/src/components/dashboard/StalenessIndicator.tsx` exists, has the same name, has
> **two more render sites**, is internationalized, and handles the case ours drops. Two composers,
> two sweeps, one wrong conclusion each — see §12.3.

> **The counter-example that keeps it honest is `ascent`'s refusal**, and it is worth stating
> because it is the opposite of everything else in this document. `pulls.ts:143-146` does not
> disclose a low-sample rate; it **declines to produce one**, returning `null` below n=5, and the UI
> renders the words *"small sample"* where the percentage would have been. **Disclosure is the
> second-best answer. The best answer is not computing a number your sample cannot support** — and
> the same repo does the same thing one level up by withholding an ROI figure in allocated mode. A
> doctrine that says "always disclose" would have talked them out of the better move.

### The composition defect with the neighbouring path — offered upward

[`tooltip.md`](./tooltip.md)'s census rule `native-title-tooltip` counts `title=` as a violation:
**571 files / 1,108 matches**, the second-largest rule in the registry. Measured against this leaf's
primitives:

| provenance affordance | `native-title-tooltip` matches |
|---|---:|
| `SLACard.tsx` (the `scope` + denominator tooltip) | **3** |
| `StalenessIndicator.tsx` | 1 |
| `ModelBadge.tsx` (model id + rationale) | 1 |
| `ProvenanceBadge.tsx` (peer, bundle hash, signature) | 1 |
| `AutoResolvedBadge.tsx` | 1 |
| `SuccessSourceBadge.tsx` (uses `<Tooltip>`) | **0** |

**Five of the six places this repo discloses provenance do it through the primitive a neighbouring
golden path is ratcheting away.** The two paths are individually right and collide: `tooltip.md` is
correct that `title=` is hover-only, un-stylable and inaccessible on touch; this path is correct
that provenance must travel with the value. The reconciliation already exists in the tree —
`SuccessSourceBadge` wraps `<Tooltip>` and scores zero — so the clause is one sentence:
**disclose with `<Tooltip>`, and never let the tooltip be the *only* channel** (P2). Offered upward
rather than filed as a deviation here, per doctrine §6.

## 7. Deviations

Every entry is live on `master` @ `4f5621830`, verified by reading the file, by replay, or against a
read-only copy of the operator's database. All shipped under a green `npm run check`.

### D1 — Two populations, one screen, 32.1% apart · **executed**

`SLADashboard.tsx:139` (card) vs `:146-152` (chart), fed by `sla.rs:311-572`. Full replay in §0.
The card's population is `persona_executions` post-retention (2,168); the chart's is
`sla_daily ∪ persona_executions` merged max-by-total (2,865, of which **697 exist in no execution
row**). 12 of 17 chart points render a different success rate than their surviving rows.

Mechanics, for the fix: `load_daily_trend`'s `consider` closure already *knows* which source won
per day; it discards the answer because `SlaDailyPoint` has no field to carry it.

**Fix, three lines:** add `source: DayPointSource` (`Rollup | Raw`) to `SlaDailyPoint` and set it in
`consider`; render rollup-sourced points with a distinct stroke (the KPI chart's dashed pattern is
the in-repo precedent); add a `scope` pill to the trend card the way the two healing cards already
have one. The type change is the load-bearing part — without it the render has nothing to read.

### D2 — The staleness component is silent for a never-fetched source · **5 sites, 2 files**

`StalenessIndicator.tsx:33` returns `null` when `!fetchedAt`; `overviewSlice.ts:203-208` stamps
`pipelineFetchedAt[source]` only on success. `DashboardHomeMissionControl.tsx:298` mounts the badge
inside the pipeline-error banner with `hasError` hardcoded `true` — so for a source that has never
succeeded the badge is blank. §0.

Two more residuals in the same component: `STALE_THRESHOLD_MS = 5 * 60_000` means a surface
refreshing every 60 s shows nothing until the fifth consecutive failure; and its label is computed
from a single `fetchedAt` scalar, which cannot express P4's distribution.

**Fix:** move the `hasError` branch above the null-guard, exactly as `personas-web`'s independent
implementation does (`StalenessIndicator.tsx:52-66`). Four lines.

### D3 — Cost estimates: four surfaces, four different disclosure standards · **live**

`engine/src/cost.rs` derives a run's cost from `CHARS_PER_TOKEN: f64 = 3.8` (`:11`) and a hardcoded
model→price table (`:15-60`). The same concept has a **second** hardcoded table in the frontend
(`src/lib/utils/platform/pricing.ts`). What reaches the user:

| surface | what it renders | marked? |
|---|---|---|
| `ExecutionPreviewPanel.tsx:88-90` — collapsed summary | `$0.02` + a sibling `<span>{e.est}</span>` (*"est."*) | **yes**, as adjacent prose in a separate element (P2) |
| `ExecutionPreviewPanel.tsx:131` — expanded grid | `fmtCost(estimated_input_cost)` under label **"Input Cost"** | **no** |
| `ExecutionPreviewPanel.tsx:135` — the cell beside it | `fmtCost(estimated_output_cost)` under label **"Output Cost (est.)"** | **yes** |
| `ExecutionPreviewPanel.tsx:132` — same grid | `fmtCost(monthly_spend)` — a **measured** DB read, same font, same formatter | n/a — and indistinguishable from its two estimated neighbours |
| `IntentResultExtras.tsx:196` | `<Numeric value={rec.estimated_cost_per_run_usd} precision={3} />` under **"Est. Cost/Run"** | yes |
| `SimulationPanel.tsx:50,56` | `estimatedDailyExecutionsLost` and `estimatedDailyRevenueLost` as bold figures under **"Daily Execs Lost"** / **"Daily Cost Impact"** | **no** — the panel title *"Revocation Simulation"* is the only signal, 30 lines up |
| `AlertsPanel.tsx:57` | `-<Numeric value={r.estimatedSaving} unit="usd"/>` per month — **and renders `r.confidence * 100` right beneath it** | **no**: it discloses the confidence and not the estimate-ness |

**`estimated_input_cost` and `estimated_output_cost` come from the same estimator, are rendered by
the same formatter in adjacent cells of one grid, and exactly one of them says "(est.)".** That is
P2 measured as a controlled pair.

`estimateCost()` (`pricing.ts:49-82`) compounds it: it returns `estimated: false` whenever its
**hardcoded table** recognises the model — so the flag reads at the call site as *"this is not an
estimate"* when it means *"the lookup succeeded"*. The only string in the app that says the true
thing is `plugins.dev_tools.llm_cost_note` — *"Costs are token×price estimates from {tool}, not
billed amounts"* — and it lives in a different feature.

`SimulationPanel`'s two figures are also arithmetically thin: `estimatedDailyExecutionsLost` is
`Σ round(recentExecutions / 7)` and `estimatedDailyRevenueLost` is `Σ dailyBurnRate`, rounded to
two decimals (`credentialGraph.ts:323-331`). A 7-day extrapolation, rendered as `$X.XX`.

### D4 — A six-arm provenance union consumed by testing one arm · **live, one line**

`dev_kpi_measurements.source` has six arms. `KPIDashboard.tsx:161`:

```ts
const simulated = ms.some((m) => m.source === 'simulation');
```

`'ai-compose'` — an **LLM-composed measurement**, added to the `CHECK` by
`widen_kpi_measurement_source_with_ai_compose` (`incremental.rs:8232`) — is not `'simulation'`, so
it drives `strokeDasharray={simulated ? '6 4' : undefined}` to `undefined` and the legend suffix to
nothing. **A model-composed KPI reading draws as a solid production line, identical to a connector
measurement.** The migration widened the vocabulary and the render was never revisited — P6, in the
wild, in the one place this repo does provenance best. Latent on this install (41 measurement rows,
all `evaluator` / `production`) and live the moment an AI-composed measurement lands.

**Fix:** `const trusted = new Set(['evaluator','manual','scan','health_snapshot']); const simulated =
ms.some(m => !trusted.has(m.source));` — one line, and it fails safe on every future arm.

### D5 — Machine authorship is 18 free strings and zero closed types

| | count |
|---|---:|
| persisted fields recording that a machine produced a row | **18** |
| …with a closed Rust type (`enum`) | **0** |
| …with a doc comment naming the legal values | 11 |
| …with **no** doc comment at all (vocabulary unknowable from the type) | **5** — incl. `DevIdea.provider`, `DevIdea.model`, `team_assignment.source`, and 3 `ResearchLab.generated_by` fields |
| Rust `enum`s named `*Source` / `*Origin` that exist | 6 — **none of them is authorship** (`PersonaTrustOrigin`, `ConfigSource`, `LiveRoadmapSource`, `ForageSource`, `StationSource`) |
| identifiers grepped that return **zero hits** anywhere in `src/` or `src-tauri/` | `author_type`, `is_ai`, `ai_generated`, `proposed_by`, `decided_by`, `is_simulated`, `authored_by`, `produced_by` |
| **closed provenance unions in TypeScript** | **1** — `successRateSource`, declared twice (`personaHealthSlice.ts:50, :393`) |

The near-miss is worth naming because it shows the vocabulary exists and the type does not:
`WorkspaceKnowledge.provenance` (`src/lib/bindings/WorkspaceKnowledge.ts:75`) is `string | null`,
and its doc comment carries the whole schema —
*"JSON `{ actor_kind: 'human'|'agent'|'miner', session_key?, scan_id?, model_ref? }`"*. Three
authorship arms **and a model reference**, fully specified, in a comment above an opaque string,
because the column is a JSON blob. Nothing validates it, nothing renders it, and a typo in
`actor_kind` is a runtime shrug.

**`persona_memories` has no authorship column at all** (`db/src/migrations/schema.rs:517-528`).
Memories are LLM-extracted from execution output; the only provenance is `source_execution_id`.
**6,535 live rows**, and the settings copy elsewhere in the app calls them *"AI-generated memories"*
(`en.json:11589`) while the row itself carries no such flag.

**`persona_healing_issues.source` is `NULL` on 205 of 205 live rows.** The per-issue attribution
chip (`IssuesList.tsx:82,90`, which distinguishes `director` / `oauth`) therefore fires on **zero**
rows, while the SLA dashboard renders **"Auto-Fixed: 26"** with an all-time scope pill and a tooltip
naming *"the healing engine"* — a subsystem, never a strategy or a model. The strategy that decided
**is** computed (`engine/mod.rs:3124`) and goes only into a transient notification payload. And
`engine/ai_healing.rs:560` writes `suggested_fix = NULL`, so on exactly the LLM-authored rows the
one explanatory field is empty.

### D6 — Model identity: stored 11 ways, rendered 5, and the split is exact

| | |
|---|---|
| storage sites | **11** — `persona_executions.model_used`, `dev_ideas.model` + `.provider`, `companion_turn.model`, three `embedding_model` columns, four `lab_*_results.model_id/provider`, BYOM audit |
| render surfaces | **5** — execution detail, global execution list, LLM calls table, trigger history, BYOM audit log (+ cockpit facts, lab versions table, `ModelBadge`) |

> **If the artifact is an execution, the model is stored and shown. If the artifact is a thing the
> execution *produced* — an idea, a hypothesis, a finding, a memory, a report section, a healing
> fix, a triage verdict — the model is either not stored at all or stored and never shown.**

The sharpest instance: **`dev_ideas.model` and `.provider` are populated on 214 of 236 live rows**
(all `claude` / `claude-sonnet-4-6`), are exported to `src/lib/bindings/DevIdea.ts`, and
`backlogModel.ts:53-68` — the view-model every backlog surface reads — maps **18 fields and omits
both**. Zero `.tsx` in `src/` renders `idea.provider` or `idea.model`. The app knows exactly which
model wrote each backlog item and never says.

`AthenaVerdictCard` compounds it: the wire type `BacklogVerdict` is
`{ ideaId, title, verdict, reason }` — **four fields, no model, no confidence, no evidence** — so
the surface where a user accepts or rejects a model's judgement about their backlog cannot name the
judge, on rows that carry the judge's identity.

**Embedding model is stored on 3 tables and rendered 0 times**, and the mismatch guard
(`memories.rs:1797-1815`) silently **drops** KNN hits produced by a stale model. A recall can be
filtered and the user is never told the sample shrank.

### D7 — 20 values the code calls estimates, typed identically to measurements · **§9's population**

11 files. Six of them are ts-rs bindings, i.e. the wire contract:
`ExecutionPreview.ts:22,26,30`, `ExecutionDashboardData.ts:9`, `NightRun.ts:29`
(`projectedCostUsd` sitting beside `monthSpendUsd`), `PerformanceDigest.ts:46`, `RoutingClaim.ts:8`.
The consequence is executed in §4: `monthly_spend + estimated_total_cost` gates two warnings.

Two independent implementations reconcile at **20 matches / 11 files** with identical per-file line
sets (§9).

### D8 — `Numeric` is the destination and it cannot carry provenance · **212 sites**

`display/Numeric.tsx` has **212** render sites across 111 files and no prop for staleness, coverage,
sample size, or estimate-ness; **0** call sites pass even `title`. Every §7 deviation that renders
through `Numeric` (D3's `estimatedSaving`, `estimatedDailyRevenueLost`, `estimated_cost_per_run_usd`)
had nowhere to put the marker except sibling prose. **This is upstream of most of this section** —
see §8 Gap 1.

### D9 — The sample size is computed, used, and discarded

`get_persona_reliability` exports `total_decided` beside `success_rate`
(`sla.rs:22-33`) — the only metric struct in the repo that ships its own sample size — and
`SLADashboard.tsx:89` renders it as *"1928/2166 executions"*. That is one card. Elsewhere:

- **3 of 19,112** `en.json` keys pair a rate with its sample size
  (`overview.sla.executions_summary`, `settings.engine.tuning_healing_note`,
  `vault.token_metrics.fallback_used`). The other 11 `{n}/{total}` strings are step counters.
- **1** JSX site renders `(n=…)` — `PolicyProposalsSection.tsx:202`, and it is hardcoded English
  rather than an i18n key.
- `ConfidenceArc` (`display/ConfidenceArc.tsx`) renders a 0–100 confidence as an arc with
  `showLabel` defaulting **false**; both call sites leave it false, so the app's one confidence
  visualisation renders **no number and no sample**.

### D10 — Window disclosure is one card's local convention

`SlaCard`'s `scope` pill and `windowed_tooltip` are the whole mechanism, on 4 tiles in 1 file. The
other 60 shared-tile call sites (`StatCard` 32, `KpiTile` 32, minus overlap) pass no scope and no
tooltip, while many are windowed: `ExecutionMetricsDashboard.tsx:92-95`, `LlmSpendSection.tsx:101-104`
and `AthenaUsageSection.tsx:98-101` all render four tiles each off a range-filtered fetch with the
range named nowhere in the tile. This is [`metric-definition` §7 D0](./metric-definition.md)'s
executed finding — the window moves the number **6.8×** more than the denominator — arriving at the
pixel with no channel to travel through.

### D11 — Cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"`sla_daily` over-reports by 32% because DST mints a parallel bucket generation."** The 32.1%
  is real and the cause is not DST. All **403** current rollup rows match a raw recompute at
  `+120` exactly and **0** match `+60` or `+0`; the offset has been constant. The 697 extra rows are
  **95 frozen keys** whose raw executions were pruned by `cleanup_old_executions`'s per-persona
  `min_keep` policy. The rollup is doing its documented job; the defect is that nothing says which
  points came from it. §12.4.
- **"`load_daily_trend`'s max-by-total *prefers* the inflated bucket."** It prefers the **larger**
  bucket, which on this data is the more complete one. The merge is correct. What is missing is the
  disclosure of which one won.
- **The i18n layer is not the weak link.** `agents.executions.est` (*"est."*) is translated in all
  **14** locales — `ca.` in German, `概算` in Japanese, `ориент.` in Russian. The estimate marker
  does not vanish under translation; it vanishes under *layout*, because it is a separate element.
- **`empty-sample-as-confident-zero`'s condition is not this one.** It is Rust-only and keys on
  `if n > 0 { … } else { 0.0 }`. Zero file overlap with anything here (§9). "This sample is empty"
  and "this value was not measured" are different claims and need different fixes.

## 8. Gaps

**Gap 1 — Nothing in the shared layer can render a provenance marker, so 212 call sites had
nowhere to put one.** `Numeric` (212 sites), `KpiTile` (32) and `StatCard` (32) between them are the
app's number-rendering surface and none has a provenance prop. Every deviation in §7 D3 and D9 is
downstream of this. **The single highest-leverage fix in this document is one prop on one
primitive**: `Numeric`'s `provenance?: 'measured' | 'estimated' | 'proxy' | 'simulated'` rendering a
`≈` prefix or a dimmed suffix, plus a matching optional on `StatCard`/`KpiTile`. Per the contract's
fifth §9 failure mode, this must land **before** any gate routes callers to those components —
today arriving at the shared primitive does not let you tell the truth.

**Gap 2 — There is no shared "estimate" wrapper, so `Estimated<T>` fails Q3 as a general
prescription.** `src/lib/` and `src/features/shared/` contain no numeric newtype; `Vec<Result<..>>`
and `Option<T>`-plus-sibling-flag are the only absence idioms in the tree, and each partial-expressive
type in 953 `.rs` files has a construction count of exactly 1 (measured by
[`partial-failure-read-envelope` §8 Gap 4](./partial-failure-read-envelope.md)). So §4's T1 is
prescribed **only** where it is total — `ExecutionPreview`, 1 construction site, 1 consumer — and the
general form is direction. A prescription that 20 sites must adopt a type nobody has written is an
invention, and the corpus has ruled against those.

**Gap 3 — Freshness of an aggregate is unrepresentable in every shape this repo has.** P4 says the
"as of" is the oldest member's; `StalenessIndicator` takes a single `fetchedAt: number | undefined`,
`pipelineFetchedAt` is a `Record<string, number>` of scalars, and `sla_daily`'s tail query does not
select `updated_at` at all. One live chart point is 56 rows spanning 13 days of write times. Fixing
this needs a `{ oldest, newest, n }` shape, not a timestamp — and no primitive in the repo or in any
of the five siblings has one. **Reported as a genuine limitation, not a backlog item.**

**Gap 4 — The disclosure channel this repo actually uses is the one a neighbouring path is
removing.** 5 of 6 provenance affordances deliver their explanation via `title=`, which
`native-title-tooltip` counts (571 files / 1,108 matches). `<Tooltip>` is the sanctioned
replacement and `SuccessSourceBadge` proves it works — but a hover-only tooltip is a weak home for
provenance regardless (P2), and neither path currently prescribes a **visible** channel for the
explanation as opposed to the flag. §6.

**Gap 5 — The census cannot see the coupling this leaf is about.** The violating condition is *"the
number is rendered and the marker is not"*, which is an **absence** adjacent to a presence — and
worse, in this repo **the marker and the value share a vocabulary**: `estimated_no_trace` is a
disclosure and `estimated_total_cost` is a value, and both are `x.estimated*` in JSX. A first
candidate signal (26 matches) was **50% precise and five of its false positives were the disclosure
strings themselves**. §9 measures this and declines it; what would work is a checker that reads
`en.json` *values* alongside the render sites, which the census by construction cannot do.

**Gap 6 — Confidence has no home.** `ConfidenceArc` exists with 2 call sites and no label;
`BacklogVerdict` has no confidence field; `AutoResolvedBadge`'s own docstring names the gap
(`F-NO-CONFIDENCE-AUTORESOLVE`). Across the cohort only `ascent` renders a confidence with its
caveat (`Trajectory.tsx:94-101`, *"trend confidence {n}% · noisy"*), and it got there by measuring
that its R² was mathematically 1 below n=3. **A confidence number without a sample size is a second
undisclosed estimate**, which is why §2 (d) mandates the sample and not the confidence.

## 9. The missing gate

**The condition to enforce:** *a value the code itself identifies as an estimate, projection or
simulation is declared in the same type as the measurements beside it, so nothing downstream — no
compiler, no consumer, no renderer — can tell them apart, and they compose arithmetically.*

Not "the pixel discloses" — that is the leaf's real condition and it is **not lexically checkable
here**, for a reason worth stating precisely (below). This is the half that is.

**Checked first that it is not already gated.** `scripts/census/rules.json` holds **113** rules.
None has an `id`, title or signal containing `provenance`, `estimate`, `projected`, `simulated`,
`staleness`, `fresh`, `sample`, or `model` in this sense. Five neighbours were opened and their
**file sets re-measured against mine, not assumed**:

| neighbour rule | its files | overlap with my 11 | why it is a different condition |
|---|---:|---:|---|
| `empty-sample-as-confident-zero` ([`metric-definition`](./metric-definition.md)) | — | **0 (0%)** | roots `src-tauri/**`, `.rs`. It asks *"was the sample empty?"*; this asks *"was there a measurement at all?"*. Semantically the nearest neighbour and it cannot see a line of this. |
| `bigint-binding-field` ([`persisted-model-struct`](./persisted-model-struct.md)) | 142 | **2 (18%)** | same two binding files (`ExecutionPreview.ts`, `NightRun.ts`), disjoint signal — it matches the literal token `bigint`; none of my 20 matches is a bigint. |
| `unknown-money-as-zero` ([`llm-spend-accounting`](./llm-spend-accounting.md)) | 13 | **1 (9%)** | matches money identifiers collapsed by `?? 0` / `unwrap_or(0`. No match of mine is a coalescing operator. |
| `hand-assembled-currency` / `locale-blind-percent` ([`number-and-cost-formatting`](./number-and-cost-formatting.md)) | 39 / 57 | **1 (9%)** each | they own the *rendering* of a number; this owns its *declaration*. |
| `ipc-payload-typed-inline` ([`bridge-type-contract`](./bridge-type-contract.md)) | 12 | **1 (9%)** | matches an inline payload shape at an IPC call; disjoint. |

**Maximum overlap 18% (2 files)**, well under the 83% that got a previous gate correctly declined.

**The signal is the DECLARATION, not the render**, and that is deliberate: the render form is where
the vocabulary collides with the disclosure (Gap 5); the declaration is unambiguous. It matches a
member/annotation pair whose *name* begins with a non-measurement word and whose *type* is bare
`number`.

**Precision hand-verified 20/20 on the stated condition.** Every match was read. All 20 are a value
the producing code names an estimate, projection, prediction or approximation, declared as a plain
`number`. Two virtualization row-height hints (`estimateItemSize`, `estimateSize`) are excluded by
path **with reasons** rather than pattern-tuned away, because a pixel measurement genuinely has no
provenance to disclose.

**Verified by a second independent implementation — and this is where I state the doctrine's
warning against my own result.** The verifier is a line-oriented member classifier: it walks each
line, steps *left* from every `:` over an optional `?` and an identifier, steps *right* over the
annotation head, and classifies the pair — importing nothing from `lib/engine.mjs` and using no
regex over the line. It reports **20 matches in 11 files with identical per-file line sets, zero
disagreement.**

**Agreement here is weaker evidence than usual and I am not going to pretend otherwise.** Both
implementations key on the same word list, so **their recall is bounded identically** — the exact
failure the doctrine names. I probed that bound with a second vocabulary (`runway`, `eta`,
`burnRate`, `heuristic`, `inferred`, `derived`, `assumed`, `allocated`, `extrapolated`,
`hypothetical`, `expected`, …): **37 hits in 30 files, of which ~4 are genuine misses** — the rest
are goal `target`s, which are declared aims rather than estimates. The named misses:
`etaMs: number` (`artist/sub_media_studio/types.ts:262`), `derived_quality_score: number`
(`bindings/TemplatePerformance.ts:6`), and — most instructive — **`burn_rate: number | null` on
`bindings/ExecutionDashboardData.ts:9`, the same line as a match**. Two projections in one struct,
one caught by the word list and one missed. True recall ≈ 20/24 ≈ **83%**.

**Fail-loud properties — executed, with exit codes captured**, against the working tree:

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified) | **0** | `census OK — 2 rule(s), 9658 file-visits, 43 surviving violation(s) across 30 file(s)` |
| baseline deflated (a rise) | **1** | `[drift] files rose 5 -> 11 (+6). New violations of …data-provenance-disclosure.md` |
| baseline inflated (a silent drop) | **1** | `[drift] files dropped 90 -> 11 (-79) without the baseline moving` |
| `floor` raised to 9000 | **1** | `[structural] walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 500` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 500` |
| `goldenPath` removed | **1** | `missing grounding — a rule needs "goldenPath" … or "principle"` |
| `exclude` path renamed | **1** | `[structural] exclude "…/MOVED.tsx" matched no file. The exemption is stale` |
| `exclude` `reason` shortened to `"x"` | **1** | `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| **POSITIVE CONTROL — pattern → the COMPLIANT form** | **1** | `[drift] files rose 11 -> 19 (+8)` |
| **control given a baseline** | **1** | `must NOT carry a baseline — it exists to fail` |

**Where it executes.** `npm run census:check` is part of **`npm run check`**, which the agent runs
before opening a PR, and of the `golden-path-census` pre-push job. That matters here: `ci.yml` runs
its Rust tests now but is **still red on 10 pre-existing failures**, so a gate that only runs in CI
effectively runs nowhere. This one runs on the developer's machine before the branch leaves it.

**How this gate could still fail, stated so the next repo re-derives rather than trusting a green
run.** The signal proxies for *"an estimate is indistinguishable from a measurement in the type"*
and keys on **this repo's habit of putting the provenance in the identifier**. A repo that names the
field `cost` and records the estimate-ness in a sibling column, in a doc comment, or nowhere will
match zero while the condition is present at scale — `ascent` is exactly that repo and would score
**0**, despite carrying a three-arm `Fidelity` union, because its estimated spend field is called
`estimatedCostUsd` in one place and `spendCents` in another. **An adopting repo must re-derive its
own proxy and should check the control's population before trusting a green run.**

**The positive control partitions the app, and its number is the finding.** Pointed at the compliant
form over the same roots and extensions — a value whose *type* can say how it was produced (a
closed union with a `'measured'`/`'simulated'`/`'proxy'`/`'allocated'`/`'composed'` arm; a
provenance boolean; a field literally named `successRateSource` / `measurementSource` /
`provenance` / `fidelity`) — it returns **23 matches in 19 files**. So the population is
**20 estimates typed as measurements (11 files) : 23 values whose type carries provenance
(19 files)**, and the two must move in opposite directions as the codebase improves. If the
violating count falls and the control does not rise, a field was renamed rather than typed.

```json
{
  "id": "estimate-typed-as-measurement",
  "goldenPath": "docs/concepts/golden-paths/data-provenance-disclosure.md",
  "title": "A value the code itself names an estimate/projection is declared as a bare `number`, identical in type to the measurements beside it — so nothing downstream can tell them apart and they compose arithmetically",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\b(?:estimated?|projected|projection|forecast|predicted|approx|synthetic|simulated)[A-Za-z0-9_]*\\s*\\??\\s*:\\s*number\\b",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A type-member declaration whose NAME begins with a non-measurement word (estimate/estimated/projected/projection/forecast/predicted/approx/synthetic/simulated) and whose ANNOTATION is a bare `number`. PROXY FOR the stack-free condition: provenance lives in the identifier, and an identifier does not survive an arithmetic operator — so an estimate and a measurement of the same quantity are the same type and will be added, averaged and rendered alike. WHAT THE MATCH COSTS, executed rather than reasoned: src-tauri/engine/src/cost.rs:84-102 declares `estimated_input_tokens: u64` (= text.len() / a CHARS_PER_TOKEN constant of 3.8), `estimated_total_cost: f64` (= those tokens x a hardcoded model->price table), `monthly_spend: f64` (a real DB read) and `budget_limit: f64` (config) as four indistinguishable numbers eighteen lines apart; ExecutionPreviewPanel.tsx:72-75 then computes `((preview.monthly_spend + preview.estimated_total_cost) / preview.budget_limit) * 100` and gates the overBudget (>100) and nearBudget (>80) warnings on the result. A MEASUREMENT AND A CHARACTER-COUNT HEURISTIC ARE SUMMED, AND THE SUM GATES TWO SAFETY WARNINGS. PRECISION 20/20 on the stated condition, every match hand-read. SIX of the eleven files are ts-rs bindings, i.e. the wire contract itself (ExecutionPreview.ts:22,26,30; ExecutionDashboardData.ts:9; NightRun.ts:29 where projectedCostUsd sits beside monthSpendUsd; PerformanceDigest.ts:46; RoutingClaim.ts:8), so the collapse happens at the boundary and every consumer inherits it. TWO INDEPENDENT IMPLEMENTATIONS RECONCILE AT 20 with identical per-file line sets: this regex, and a line-oriented member classifier that steps LEFT from every ':' over an optional '?' and an identifier and RIGHT over the annotation head, importing nothing from lib/engine.mjs. AGREEMENT IS WEAK EVIDENCE HERE AND IS REPORTED AS SUCH: both key on the same word list, so recall is bounded identically. A second-vocabulary probe (runway|eta|burnRate|heuristic|inferred|derived|assumed|allocated|extrapolated|hypothetical) returned 37 hits in 30 files of which ~4 are genuine misses -- etaMs (artist/sub_media_studio/types.ts:262), derived_quality_score (bindings/TemplatePerformance.ts:6), and burn_rate on bindings/ExecutionDashboardData.ts:9, WHICH IS THE SAME LINE AS A MATCH. True recall ~20/24 ~83%. LEGAL FIX: a newtype that withholds the dangerous freedom rather than the value -- an `Estimated<T>` / `Estimate` with a private field and no Add<f64> impl, so summing an estimate with a measurement stops compiling until somebody decides. Ship it where it is TOTAL (ExecutionPreview has ONE construction site at engine/src/cost.rs:106 and one consumer, so the wrapper reaches everything); the general form does not meet the corpus's Q3 today because src/lib/ contains no shared numeric wrapper -- see the path's Gap 2. CONVERGENT: ascent's src/lib/integrations/providers.ts:11 `type Fidelity = 'measured' | 'allocated' | 'simulated'` is persisted (prisma/schema.prisma:764) and rendered (FidelityBadge, aiShared.tsx:28) and its `allocated` arm names the proxy mechanism outright; vibeman's db/models/types.ts:26 `progress_source?: 'manual' | 'inferred' | 'hybrid'`; brainiac's DemoResult<T>{data,live}. Three repos, three domains, one shape, no shared document. WHAT THIS RULE CANNOT SEE, stated so nobody trusts it further: it does NOT see whether the PIXEL discloses -- that condition is an absence adjacent to a presence AND, in this repo, the marker and the value share a vocabulary (`e.estimated_no_trace` is a disclosure string and `preview.estimated_total_cost` is a value; both are `x.estimated*` in JSX). A render-side candidate was built, run through the real engine, and measured at 26 matches with 50% precision, FIVE of whose false positives were the disclosure strings themselves; it is refused in this path's Section 9 with the numbers. It also cannot see the Rust half (9 matches over 953 .rs files, too small to ratchet) nor a provenance union consumed by testing an untrusted arm (KPIDashboard.tsx:161, a relation between a CHECK constraint and a render, not a string). PORTABILITY WARNING: ascent -- the repo with the best provenance types in the cohort -- would score ZERO here, because it puts the estimate-ness in a sibling union rather than in the identifier. Do NOT silence a match by renaming the field to drop the estimate word: that removes the only provenance the value currently has."
  },
  "exclude": [
    {
      "path": "src/features/shared/components/display/GroupedVirtualList.tsx",
      "reason": "estimateItemSize is a virtualizer row-height hint in CSS pixels, never a value shown to a user — a layout measurement has no provenance to disclose"
    },
    {
      "path": "src/features/plugins/dev-tools/sub_context/contextMapPerf.tsx",
      "reason": "estimateSize is the same virtualizer row-height hint, measured in pixels for layout"
    }
  ],
  "baseline": { "files": 11, "matches": 20 },
  "floor": 500
}
```

```json
{
  "id": "estimate-typed-as-measurement-positive-control",
  "goldenPath": "docs/concepts/golden-paths/data-provenance-disclosure.md",
  "title": "POSITIVE CONTROL — a value whose TYPE can say how it was produced",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": ":\\s*'(?:measured|estimated|proxy|simulated|composed|allocated)'(?:\\s*\\|\\s*'[a-z_-]+')+|\\b(?:isSynthetic|isEstimate|isSimulated|estimated|simulated|partial|degraded)\\s*\\??\\s*:\\s*boolean\\b|\\b(?:successRateSource|measurementSource|provenance|fidelity)\\s*\\??\\s*:",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL, deliberately carrying NO baseline. Matches the COMPLIANT form of the same condition over the same roots and extensions: a value whose TYPE carries how it was produced — a closed union with a measured/estimated/proxy/simulated/composed/allocated arm, a provenance boolean (isSynthetic on CostAccrualOverlay.tsx:24, estimated on pricing.ts:41, partial on useChainTrace.ts:16), or a field named successRateSource / measurementSource / provenance / fidelity. Returns 23 matches in 19 files against the violating rule's 20 in 11, so the population PARTITIONS 20 estimates-typed-as-measurements : 23 values whose type can speak, and the two counts must move in OPPOSITE directions as the codebase improves. If estimate-typed-as-measurement falls while this stays flat, a field was RENAMED rather than typed — which removes the only provenance the value had. THE NUMBER IS ITSELF THE FINDING: the app's entire type-level provenance vocabulary is 23 declarations across 19 files, and the CLOSED-UNION arm of it is ONE union in two declarations (personaHealthSlice.ts:50 and :393, both successRateSource) — everything else is a boolean (isSynthetic, simulated, partial, degraded, estimated) or an opaque field (WorkspaceKnowledge.provenance is typed `string | null` with the real vocabulary — actor_kind 'human'|'agent'|'miner' plus model_ref — documented only in a doc comment because the column is a JSON blob). Against that: 212 Numeric render sites and 64 shared-tile call sites with nowhere to put a marker at all. It exists to prove the member-declaration matcher family is alive: the two rules differ in exactly one respect, whether the provenance is in the identifier or in the type, so if an engine or walk change ever broke member matching this control goes to zero and the run fails structurally. Recall is deliberately narrow — it does not match the SQL CHECK on dev_kpi_measurements.source (the strongest provenance construct in the repo, and not TypeScript), nor Rust enums — because a liveness probe wants a stable, exactly-understood population rather than coverage. It must never be given a baseline."
  },
  "floor": 500
}
```

Validated standalone via `node scripts/census/run-census.mjs --rules <a private scratch registry with
a filename unique to this composer>`, never against the shared `rules.json`; the runner reports
**20 matches / 11 files** for the rule and **23 / 19** for the control, over **9,658 file-visits**
(2 × 4,829). **Re-extracted from this finished document and re-run: identical counts.**

### Three conditions in this leaf I am refusing to gate, with the measurement that justifies each

1. **"An estimate rendered at the pixel without a marker" — refused at 50% precision, and the
   failure mode is new and worth recording.** I built it (a balanced JSX expression-container
   matcher requiring an estimate-named property access with a quantity noun), ran it through the
   real engine, and got **26 matches in 13 files**. **Thirteen are values and thirteen are not — and
   five of the false positives are the disclosure strings themselves**: `{e.estimated_no_trace}`,
   `{e.simulated_badge}`, `{t.schedules.projected}`, `{t.triggers.simulated_event}`. In this repo
   **the way you disclose an estimate is to render an i18n key named after the estimate**, so a
   lexical signal for "this is an estimate" matches the admission and the offence with equal
   enthusiasm. A tightened variant (requiring the container to be in text position or a `value=`
   prop) reached **10 matches / 5 files at 10/10 on the stated condition** — but four of those ten
   *are* disclosed, by adjacent prose the matcher cannot read, so it would fire on correct content
   at 40%. **A gate that fires on its own compliant form is worse than no gate**, and this one does
   it twice over. What would work is a different instrument: a checker that reads `en.json` *values*
   alongside the render sites and asserts that a JSX element rendering an estimate-named field
   contains, or is a sibling of, a key whose English value matches `/est\.|estimat|approx|~|≈|
   projected|simulated/`. That is an allowlist-covers-a-set condition, which the census cannot
   express by construction — the same reason `check-csp-hosts.mjs` exists as a script.
2. **"A provenance union consumed by testing an untrusted arm"** (D4) is the leaf's sharpest live
   defect and is **not a string**. It is a relation between a SQL `CHECK` list six arms long and a
   `===` against one of them, in a different language, three layers away. A pattern narrowed to
   provenance-ish field names compared against a literal returns **507 matches in 181 files** — the
   word `source` is overloaded across event routing, config inheritance and credential wizards — and
   the correct spelling (`SuccessSourceBadge.tsx:22`) is syntactically identical to the wrong one.
   The durable answer is §4's step 5 plus a test on the newest arm; recorded in D4 with the one-line
   fix rather than pretended into a signal.
3. **The Rust half** returns **9 matches in 5 files** (`pub estimated…: f64`), five of them the one
   `ExecutionPreview` struct. A population of five files where the fix is one newtype is the same
   trade [`llm-spend-accounting`](./llm-spend-accounting.md) made for its price-table rule and
   [`metric-definition`](./metric-definition.md) made for its calendar-day rule. Named in §4 T1
   instead, where the executed consequence is attached to it.

### The type, alongside the ratchet

The gate counts the **declaration**. Two things it cannot reach, and both are edits rather than
counts:

- **`Numeric` needs a `provenance` prop** (§8 Gap 1). 212 render sites inherit a disclosure channel
  from one edit, and no ratchet would move a single one. **This must land before any gate routes
  callers to it** — the contract's fifth §9 failure mode, and here the destination is measurably
  incapable of saying the true thing.
- **`KPIDashboard.tsx:161` must test the trusted arm** (§7 D4). One line, and it fails safe on every
  arm anybody adds to the `CHECK` afterwards. The union is already closed at the database; the only
  broken part is the consumer.

## 12. Corrections to the brief

1. **The spine says `sides: "client"` and `twoSided: true` in the same leaf, and — as for the
   adjacent leaf, independently — the evidence says `twoSided` is right.** The single strongest
   provenance construct in the app is a **SQL `CHECK` constraint** (`dev_kpi_measurements.source`)
   whose whole value is that it makes an unrecognised arm a *write* error; the sharpest type defect
   is four `f64`s in a Rust struct (`engine/src/cost.rs:84-102`) whose damage appears in a
   `budgetPct` computed in TypeScript three files away; and the headline defect is a Rust merge
   function discarding a provenance it computed, visible only as two disagreeing numbers on a React
   page. **A client-only reading of this leaf would have missed all three.** Recommend flipping
   `sides` to `both`. [`partial-failure-read-envelope` §12.1](./partial-failure-read-envelope.md)
   reached the identical conclusion about the identical field pairing — two composers, two leaves,
   same correction.
2. **"`sla_daily` over-reports by 32% because DST mints a parallel bucket generation, and
   `load_daily_trend` merges max-by-total so it *prefers* the inflated one" — the number is exactly
   right and both causal claims are wrong.** Executed: `sla_daily` holds 2,865 against 2,168 raw
   terminal rows, **+32.1%** — the brief's figure to one decimal. But **all 403** current rollup rows
   match a raw recompute at offset `+120` **exactly** and **zero** match `+60` or `+0`, so no
   parallel offset generation exists; the operator's zone has been CEST throughout the write window
   (rollup generations 2026-08-03 → 2026-08-16). The 697 extra rows are **95 frozen `(persona, day)`
   keys**, all in 2026-06-03…06-14, whose raw executions were removed by
   `cleanup_old_executions(retention_days, min_keep_per_persona)` — a **per-persona** cap, which is
   precisely why some personas lost old days and others did not. And `load_daily_trend` does not
   *prefer the inflated* bucket; it prefers the **larger**, which on this data is the **more
   complete** one. **The merge is correct and the retention is correct. What is missing is the
   disclosure**, which is why this belongs to this leaf and not to a bug report. A correct mechanism
   that silently changes what a number means is the exact shape of this situation.
3. **"`StalenessIndicator` exists and has 5 render sites; Personas is ahead of all five siblings on
   it" — half right, and the second half is inverted.** Five render sites confirmed, in two files.
   But `personas-web/src/components/dashboard/StalenessIndicator.tsx` exists under **the same
   component name**, has **7** render sites, is internationalized, has a dedicated `error` arm, and
   **pauses its 10-second tick while the tab is hidden**. `ascent` has ~13 sites via two shared
   helpers. Freshness is the **most convergent clause in the whole sweep — 4 of 5 repos, four
   independent shapes** — and Personas is not leading it. This also corrects
   [`partial-failure-read-envelope` §6 clause 10](./partial-failure-read-envelope.md), composed
   hours earlier at `629a914af`, which states *"No sibling has a component that renders the
   staleness. Personas does."* **Two composers swept the same five repos and each concluded Personas
   was ahead.** The likely cause is that both searched for the *behaviour* (retain-stale-then-mark)
   rather than the *name*; the sibling's component is a default export in a `dashboard/` folder and
   its call sites pass only `fetchedAt`. Worth recording as an oracle technique: **grep for the
   concept's obvious component name, not only for its mechanism.**
4. **"Measure adoption against the number of surfaces that need it" — done, and the more useful
   number is not adoption.** 5 sites against 77 `setInterval` files is the ratio, but the sharper
   finding is **inside** the component: it returns `null` when `fetchedAt` is undefined, and
   `pipelineFetchedAt` is stamped only on success, so the badge is blank for a source that has never
   worked — which is exactly the case `DashboardHomeMissionControl.tsx:298` mounts it for. **Adoption
   was the wrong question; correctness at n=5 was the finding.**
5. **"`successRateSource` is a correctly-closed union that did not prevent a 100× unit bug — that is
   qualification 1 in the wild" — confirmed, and there is now a *second* instance in this leaf with
   a different mechanism, which sharpens Q1.** `estimateCost()` (`pricing.ts:49-82`) returns a
   closed `{ estimated: boolean }` that is **honest about its own definition and misleading at every
   call site**: `estimated: false` means *"my hardcoded price table recognised this model"*, not
   *"this is a measurement"*. So `CostBreakdownBar.tsx:84` gates its subscription note on
   `!estimated` — correctly, by the flag's real meaning — while the same `!estimated` reads to a
   maintainer as "this is real". **Q1's usual statement is "the tag encodes less than you think";
   this case is "the tag encodes something *else* than you think", and no amount of closing the
   union fixes it.** The fix is naming (`priceTableHit`), not typing.
6. **"Whether a proxied or estimated value is visually distinguishable from a measured one" — yes,
   in exactly two places, and both encode it in the mark rather than in prose.** `kpiDetailParts.tsx:216-224`
   (dashed polyline + hollow dots for simulated, solid for measured) and `KPIDashboard.tsx:343`
   (`strokeDasharray`) are the answer, and `EventBlock.tsx:17` does the same for projected schedule
   slots (`borderStyle` + `opacity: 0.7`). Everywhere else the distinction is a word beside the
   number. **The two that work are both charts, and neither is a tile** — which is why §8 Gap 1
   names `Numeric` as the highest-leverage fix rather than adding a fourth chart convention.
7. **"Whether any number is displayed with more precision than its provenance supports" — yes, and
   it is the only clause in this sweep that is a UNIVERSAL violation.** 4 of 4 UI repos in the
   cohort. Here: `fmtCost(v, { precision: 4 })` → `$0.0234` on a figure whose chain is
   `text.len() / 3.8` → a hardcoded price table; `credentialGraph.ts:355` rounds a 7-day
   extrapolation of a burn rate to **two decimals** and renders it as `$X.XX` of "Daily Cost Impact".
   Nobody in the fleet has a shared rounding discipline, and only `ascent` pairs an over-precise
   numeral with a hedge. It is P8 and it is physics as a defect.
8. **A correction to my own instrument, offered because the doctrine asks for it.** My first
   render-side candidate reported **26 matches** and I would have baselined it. Hand-reading every
   match showed **13 were not numbers at all** — five of them the disclosure strings this path
   exists to promote. The second implementation would not have caught it: both were lexical and
   would have agreed. **What caught it was reading all 26**, which is the only step in the doctrine's
   measurement rules that has no automated substitute. The tightened variant then reached 10/10 on
   its stated condition and *still* fired on four correctly-disclosed sites, which is what moved the
   gate from the render to the declaration. **The rule I shipped is not the rule I set out to
   write, and the gap between them is Gap 5.**
