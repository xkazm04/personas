# Proportional bar list

> **Topic path:** `product-surfaces` › `metrics-and-charts` › `proportional-bar-list`
> **Composed:** 2026-08-15 · **Leaf recurrence:** 44
> **Sweep:** 4,829 `.ts`/`.tsx` files walked by two independent matchers (a whole-content
> regex and a character-level bracket matcher); 109 inline percentage-width bar sites in
> 101 files enumerated; ~35 read in full; every sibling-derived denominator traced to its
> defining statement. The central arithmetic claim was **executed**, not asserted — against
> real rows from a read-only copy of the live 347 MB `personas.db`, replaying the repo's own
> `group_by` SQL (`src-tauri/db/src/repos/llm_spend.rs:200-228`). Convergence measured
> against `../personas-web` (30 data bars) and `../brainiac/console` (7), each classified
> by denominator, accessibility, degenerate-input guard and truncation scope.
> **Shared facts cited:** [`shared-facts.json`](../shared-facts.json) — 4,829 `.ts` files,
> 2,104 `.tsx` files, 1,135 lint warnings / 0 errors at `211d519bb`.

---

## 1. Trigger

You are in this situation when you say or type any of:

- "show the top 10 personas by cost" / "break spend down by tier"
- "add a bar to each row so you can see the mix at a glance"
- "which category dominates?" / "what share of the total is this?"
- "why is the first row always full?"
- "this distribution strip doesn't add up"

**The "if you are about to write X" test.** If you are about to write
`` style={{ width: `${...}%` }} `` on an element inside a repeated row — or a
`const max… = ` / `const total… = ` whose only consumer is such a width — you are here.

### The seam: confirmed, and it holds

[`chart-component.md`](./chart-component.md) drew the boundary before this path was
written and grounded it in code. The discriminating question is:

> **Does decoding a mark require a scale the mark itself does not carry?**

**Yes** → `chart-component`. **No, because the mark carries its own denominator and prints
its value beside it** → here. **No mark at all** → `metric-definition`, still unwritten.

**The seam holds, and the sweep strengthened it in a way the sibling path could not
see.** `chart-component` cited `LlmSpendSection.tsx:68` printing `fmtCost(row.cost_usd)`
on the bar row versus `CostSparkline.tsx` printing no number anywhere. I measured the
whole population rather than the two exemplars: **77 of 109 bar sites (71%) print a
numeric text equivalent inside the row**; the sparkline population prints one at
essentially none. The property the seam names is not an accident of two files — it is a
71% / ~0% split across two disjoint populations. That is as close to a structural seam as
a measurement gets.

The seam also earns a correction it deserves in both directions:

- **The 29% that print no number are not thereby charts.** `SkillContextsModal.tsx:68`
  divides by a `maxNodes` the reader never sees, and `MarkdownRenderer.tsx:168` divides by
  a `max` computed three lines up. They are bar lists that have *failed* their own
  contract, not sparklines. §7 D5 lists all 32.
- **`factoryPrimitives.tsx:12` `Sparkline` and `:28`'s `Math.max(...data)` are
  `chart-component`'s**, even though the same file's `HealthBar` (`:54`) is mine. The
  question is asked per mark, not per file — exactly as that path states.

### Boundaries with paths that already exist

| Territory | Owner | Do not restate |
| --- | --- | --- |
| Rendering the **value** — currency, percent, compact counts, locale | [`number-and-cost-formatting.md`](./number-and-cost-formatting.md) §3 `:201`, §4 `:227`, §7.E `:555` | It owns `<Numeric>` and every formatter. **This path owns the geometry and the denominator.** |
| Any mark needing an external, developer-chosen domain — sparklines, axes, series colour | [`chart-component.md`](./chart-component.md) §1 `:35`, §9 `:636` | Including the `sample-derived-plot-scale` census rule. |
| Whether the *rows* are the right rows — capping, paging, filtering an array the fetch capped | [`filtering-and-search.md`](./filtering-and-search.md) `:76`, `:147`, `:183` | This path only measures the interaction (§7 D2, and it clears the repo). |
| The list's loading ghost, empty state, and row-entrance cascade | [`page-loading.md`](./page-loading.md) `:53`; [`empty-and-demo-states.md`](./empty-and-demo-states.md) | `UnifiedTable`, `RevealItem`. |
| Announcing a *change* out loud | [`screen-reader-announcements.md`](./screen-reader-announcements.md) `:53` | A bar is static content, not an event. §7 D5 is about the text equivalent, not the live region. |

---

## 2. The one way

**Name the denominator, in code and on screen, before you draw anything.** Compute it in a
named binding whose name says what it is — `maxAtDepth`, `totalUnits`, `SCORE_MAX` — never
inline in the `style` prop, and never as `rows[0]`, which is an *ordinal*, not an extremum:
it is correct only under a sort the component does not own, does not assert and cannot see,
and it is wrong by up to **454%** against this repo's own live data the moment that sort
changes (§7 D1). Then choose the denominator by the question the list answers, and say
which you chose in a comment beside it: **share-of-largest-sibling** when the question is
*"which of these is biggest"* — the right answer for a flat distribution, where
share-of-total would render every row as a 1% sliver — and **share-of-total** when the
question is *"how is this whole divided"*, which is the only case where the empty remainder
of the track means anything. Both encode identically up to a constant factor, so **the
choice is not about accuracy; it is about what the track means**, and the reader has no way
to find out but your label. Never mix the two families inside one screen without labelling
each, and never render a fourth family — a per-row denominator, each row divided by its own
target — in the same visual language as the first two, because that is the one shape where
two equal-looking bars really do mean unequal things. Print the actual value on every row
(`<Numeric>` per [`number-and-cost-formatting.md`](./number-and-cost-formatting.md)), mark
the bar `aria-hidden`, and let the number be the accessible content. Clamp the geometry to
`[0, 100]` and show the true number when they disagree, guard the zero denominator with
`|| 1`, and resist a minimum-width floor above ~2% — it is a lie about small values that
grows as the list gets longer.

---

## 3. Mandated primitives

**There is no shared proportional-bar primitive in this repository.** This is the leaf's
root gap (§8 Gap 1) and it is stated here rather than papered over: `src/features/shared/
components/` contains ~115 catalogued primitives and **not one** of them is a bar, meter or
distribution strip. `CATALOG.md` has no such row. Every one of the 109 sites is a hand-roll.

So the mandated list is a list of what to *compose*, and one shape to copy:

| Primitive | What it gives you |
| --- | --- |
| **`overview/sub_patterns/KnowledgeTree.tsx:118-149` → `railMeta`** | **The shape to copy.** A `useMemo` that computes the denominator once, names it (`maxAtDepth`), states in a comment which denominator it chose *and why it rejected the other*, and returns a `share` in 0..1. The only site in the repo that does all three. |
| **`shared/components/display/FacetedDecisionTable.tsx:79` → `nodeMeta`** | The one prop signature in the repo that takes normalisation **out** of the drawing component: `nodeMeta?: (path, count) => { share: number; pending: number } \| null`. The consumer owns the denominator; the primitive owns only geometry. Its limits are §4's type answer. |
| **`shared/components/display/Numeric`** | The row's printed value. Required — it is the accessible content and the seam's own condition. Locale handling and unit vocabulary belong to [`number-and-cost-formatting.md`](./number-and-cost-formatting.md), not here. |
| **`shared/components/display/Tooltip`** | Per-segment disclosure on a stacked strip, where there is no room for a label. `QuickDispatchLedger.tsx:75` is the model: every segment carries its own name + covered + units. |
| **`shared/components/display/UnifiedTable`** (`columns` + `data` + `isLoading`) | When the bar list is a table. You get the ghost-under-header, empty-flash safety and row cascade for free — see [`page-loading.md`](./page-loading.md). Do not hand-roll them beside a bar. |
| **`overview/sub_certification/components/DimensionBars.tsx:12-31` → `DimBar`** | The reference handling of an **out-of-domain** value: `// Bars can exceed 100 … clamp the visual width but show the true number`, plus a distinct `—` rendering for `null`. Copy this behaviour, not the component (it is feature-local and single-purpose). |

**Explicitly NOT primitives:**

- **`teams/sub_factory/factoryPrimitives.tsx` `HealthBar` (`:54`) / `KpiBarRating`
  (`:276`)** — feature-local, undocumented denominators, and `HealthBar` carries a hard
  `Math.max(2, value)` floor. Not exported as shared and should not be adopted as such.
- **`shared/components/progress/EstimatedProgressBar`** — a *progress* bar. Its
  denominator is definitionally the task's own completion; it belongs to
  [`long-running-job-progress.md`](./long-running-job-progress.md). Reaching for it to draw
  a comparative row is the category error §5 names first.
- **`role="progressbar"`** — semantically wrong on a comparative bar. Nothing is
  progressing. Its 6 uses in the bar population (`DeckTopBar.tsx:236`,
  `PhaseIndicator.tsx:50`, `UpdateBanner.tsx:169`, `DesignReviewRunner.tsx:146`) are all
  genuine progress bars and all correct.

---

## 4. Steps

1. **Ask the seam question (§1).** If the mark needs a scale it does not carry and you
   will not print the number, stop — you are building a `chart-component`.
2. **Decide what the list is asking**, and write it down as one of two sentences:
   *"which of these is biggest"* (→ share-of-largest-sibling) or *"how is this whole
   divided"* (→ share-of-total). If you cannot pick, you do not yet know what the list is
   for. A stacked strip is always the second; a ranked top-N is usually the first.
3. **Compute the denominator in one named binding, above the render, over the FULL set.**
   `Math.max(1, ...rows.map(r => r.v))` or `rows.reduce((s, r) => s + r.v, 0) || 1`. The
   `1` floor is the divide-by-zero guard and costs one character. **Never `rows[0]`** —
   §7 D1.
4. **Slice or filter for display *after* the denominator is computed, never before — and
   print both scopes.** `FactoryObservabilityTab.tsx:99-102` then `:119` is the correct
   order and this repo gets it right at every site (§7 D2 — a cleared hypothesis). The best
   spelling found anywhere is `brainiac/console`'s `DisputeBench.tsx:178-187`, which
   computes the strip over the *full* backlog while the rows below page, and puts both
   numbers in the header: **`{total} disputed · {rows.length} shown`**. One line, and the
   scope mismatch stops being invisible. Adopt it.
5. **Write the comment that names the choice.** One line, beside the binding, in
   `KnowledgeTree.tsx:133-135`'s form: what the denominator is, and what the other option
   would have done. This is the entire correctness surface and a compiler cannot hold it.
6. **Draw the row: label, track, bar, value.** Track gets `overflow-hidden`; bar gets
   `aria-hidden="true"`; the value goes in the row as `<Numeric>` with `tabular-nums`.
   **And then stop** — do not add `role="progressbar"`, `aria-valuenow`, or a `title=`.
7. **Clamp the geometry, print the truth.** `Math.min(100, Math.max(0, pct))`. When a value
   exceeds the domain the bar saturates and the number tells the truth
   (`DimensionBars.tsx:13-15`).
8. **Handle the three degenerate shapes before shipping.** An **empty** list → the empty
   state, not a bar list of nothing. A **single row** → under share-of-largest it renders a
   full bar against no peer; either suppress the bar or fall back to share-of-total. An
   **all-zero** list → every bar is 0-width and reads as a broken fetch; say "no activity"
   instead. Measured coverage in this repo: 2/109, 1/109 (§7 D4).
9. **Resist the minimum-width floor.** `Math.max(2, pct)` makes a 0.1% row indistinguishable
   from a 2% row, and the error compounds as the list grows: ten floored rows in a
   share-of-total strip consume 20% of a track that must sum to 100%. If a zero row must be
   visible, give the *track* a visible ground, not the bar a fake width.
10. **Never mix families on one screen without labelling both.** §7 D3 is one file that does.

### Can the primitive's signature make the wrong call impossible?

**The contract requires this answered before §9
([`golden-path-contract.md:165-184`](../golden-path-contract.md)). Answer: partly — and
this repo already contains the experiment that shows exactly how far a type gets, because
someone already made the required-prop move and it did not carry the property.**

`FacetedDecisionTable.tsx:79` is the good design:

```ts
/** `share` (0..1 of the largest sibling) draws a bar … */   // :73
nodeMeta?: (path: string, count: number) => { share: number; pending: number } | null;
```

The drawing component **cannot** compute a denominator — there is no array in scope. The
caller must supply an already-normalised `share`. That is the factory-owns-the-dangerous-
parameter move, and it works: its one consumer (`KnowledgeTree.tsx:118-149`) is the best
bar-list code in the repository.

**And `share` is still a bare `number`.** Inside the returned object it is *required* —
you cannot omit it — and it encodes only "a fraction". A caller passing share-of-total, or
share-of-a-sliced-page, or a raw 0..100 percentage, type-checks perfectly and renders a
plausible picture. The denominator convention lives in a **doc comment**, which is exactly
where this path found every other defect living. This is the corpus's two earned
distinctions arriving together in one signature:

- **A required prop only carries the property it actually encodes.** `share` is required
  and carries *nothing* about the denominator. Contrast `MetricChart.height`
  ([`chart-component.md:207-213`](./chart-component.md)), where the required prop *is* the
  property — 3/3 — while its optional siblings sit at 27% and 0%. Requiredness bought
  compliance there because the prop and the property were the same thing.
- **Requiredness is orthogonal to closedness.** `number` is an open type. Making it
  required closes nothing.

**T1 — the type change that would close it.** Replace the bare number with a two-member
closed union that names the denominator, and make the drawing component read it:

```ts
type Share =
  | { of: 'largest-sibling'; value: number }   // track full ⇒ this row is the biggest
  | { of: 'total'; value: number };            // track full ⇒ this row is everything
nodeMeta?: (path: string, count: number) => { share: Share; pending: number } | null;
```

`of` is closed, so a caller must state the denominator to compile, and the component can
render the distinction — a full-height track for `'total'`, an open-ended one for
`'largest-sibling'`. The mixed-family defect (§7 D3) becomes visible at the type level
rather than being a thing a reader must notice. This is a real change with one consumer
today, which is precisely when to make it.

**T2 — extract the shape as a shared primitive** (§8 Gap 1) whose props are
`{ rows, value, denominator: 'max' | 'total', label, format }`, with `denominator`
**required and closed**. Sixteen hand-rolled comparative bar lists collapse to one call
site and the census rule below becomes unnecessary rather than merely satisfied.

**Propose T1 and T2 as the fix; §9's census rule is the ratchet that holds the line until
they land.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| `const maxCost = rows[0]?.cost` | **Not a maximum — an ordinal.** Correct only while a `ORDER BY` the component never sees keeps holding. Computed against this repo's live `dev_llm_spend` with the sort inverted, one row's width becomes **454%**; `overflow-hidden` clips it to a full bar and nothing anywhere reports a problem. `Math.max(1, ...rows.map(…))` is unconditionally correct and one line. |
| The denominator computed inline in the `style` prop | It gets no name, so it gets no comment, so the choice is never stated and never reviewed. Every one of the 32 no-number sites (§7 D5) does this. |
| Two denominator families in one screen with nothing distinguishing them | The reader calibrates on the first bar they read. `AthenaUsageSection.tsx:127` is share-of-total under the label *"{athena} of {total} total spend this window"*; `:148` is share-of-largest, twenty lines below, in the same visual language. The second bar's full row reads as "all of Athena's spend". |
| A per-row denominator (each row over its own target) drawn like a comparative bar | **The one family that destroys ratios.** Share-of-max and share-of-total both preserve every pairwise ratio exactly (§7 D0, executed). Per-row normalisation does not: `dev_goals` has **6 of its top 20 goals all rendering 100%-full bars** for six different amounts of work. Nothing on screen says the bars are not comparable. It is also the *majority* family in `personas-web` — 10 of 19 bar-list sites — where it produces "19 independent gauges wearing the visual costume of a ranked list". |
| Slicing or **filtering** rows, then computing the denominator from what survives | Bars re-normalise to the visible subset while the header prints the full count. This repo does **not** do this (§7 D2) — but `personas-web` does, and it is worth seeing why it is invisible: `SLABreachLog.tsx:50-58` computes `maxDuration` over `filtered`, so **changing the severity filter silently re-anchors every bar** and the same breach renders a different length under "all" than under "minor". Nothing is wrong at any single line. |
| A denominator applied upstream and forgotten at the view | `personas-web`'s `LeaderboardTable.tsx:101` draws `persona.composite` as if it were an absolute score. Three of that composite's five dimensions were already max-normalised against the cohort in the data layer (`supabaseApi.ts:791-808`). The view has no way to know, and no comment records it. Normalise in one place, and name it there. |
| `Math.max(2, pct)` / `Math.max(5, pct)` as a visibility floor | A lie about small values that scales with list length. 10 sites; the worst is `Math.max(5, sim.similarity * 100)` — every similarity below 5% renders identically. |
| A bar with no number anywhere in the row | The bar is then the *only* carrier of the value, and it is a `<div>` with no role, no name and no text — absent from the accessibility tree entirely. Not "poorly labelled": **absent**. 32 sites. |
| `role="progressbar"` on a comparative bar | Nothing is progressing. It promises `aria-valuenow`/`aria-valuemax` semantics the mark does not have, and a screen reader will read "N percent" of a denominator the user was never told. |
| A stacked strip built over a hardcoded vocabulary array | `TeamCertCard.tsx:37` sums only the four members of `VERDICT_ORDER`. A fifth verdict is excluded from **both** numerator and denominator — it vanishes *and* silently inflates the other four to 100%. |
| `title={...}` as the bar's explanation | [`tooltip.md`](./tooltip.md) territory, and it is unreachable by keyboard and untranslated. Use `display/Tooltip` or print the number. |

---

## 6. Evidence

**The ONE site to copy: `src/features/overview/sub_patterns/KnowledgeTree.tsx:118-149`,
consumed by `src/features/shared/components/display/FacetedDecisionTable.tsx:339-349`.**

It is the only bar list in the repository that states its denominator, states the
alternative, and says why it rejected it — in the code, at the binding:

> *"Largest sibling per depth is the bar's denominator: comparing a cluster against the
> whole corpus would make every cluster look like a sliver."* — `:133-135`

- **The denominator is named and computed once** — `maxAtDepth` (`:135`), a `Map` from tree
  depth to that level's peak, built in a `useMemo` over the full item set (`:118-140`).
- **The peer group is right.** Not the global maximum — the maximum *among siblings at the
  same depth*. A leaf is compared to leaves. No other site in the repo scopes its
  denominator to a peer group at all.
- **Zero denominator guarded** — `peak > 0 ? count / peak : 0` (`:145`).
- **The value is printed** — `FacetedDecisionTable.tsx:336` renders `count` in
  `tabular-nums`, with the undecided count beside it (`:334`).
- **The bar is `aria-hidden="true"`** (`:343`) — correct, because the number carries the
  content, and a decorative mark that repeats it would be a second utterance.
- **Normalisation happens outside the drawing component** (`:79`) — the design move §4
  builds T1 on top of.

And its own claim is independently confirmed by execution: on this repo's live
`dev_contexts` table (391 groups), Σ/max is **102**, so the share-of-total spelling
`KnowledgeTree`'s comment rejects would render the modal average row at **1%** — a sliver,
exactly as predicted.

Secondary exemplars, each for one property:

| Site | What to copy |
| --- | --- |
| `overview/sub_certification/components/DimensionBars.tsx:12-31` | Out-of-domain handling: clamp the geometry, print the true number, render `null` as `—` with a distinct grey track. The comment at `:13-14` explains why. |
| `overview/sub_director/components/ValueLeakBar.tsx:55-79` | A stacked strip that declares itself: `// Stacked proportion bar — decorative; the legend below is the semantic content`, `aria-hidden` on the strip (`:56`), and a legend giving **every** segment its name, its count via `<Numeric>`, its rounded share, and a `Tooltip` explaining the band. The complete text equivalent. |
| `teams/sub_factory/passport/improve/QuickDispatchLedger.tsx:48,73-87` | `totalUnits` with a `|| 1` guard, computed over the whole group set; per-segment `Tooltip` carrying name + covered + units; the aggregate `%` printed at `:90`. Correct share-of-total. |
| `teams/sub_factory/l2/FactoryObservabilityTab.tsx:99-102` | Denominators computed over the **full** set at `:99-102`, display sliced at `:119` and `:153`, with an explicit `+{n} more` at `:137`/`:170`. The correct ordering — and `:102`'s `Math.max(...)` sits one line below `:101`'s `rows[0]`, so the file contains both spellings of the same idea. |
| `overview/sub_health/components/heartbeats/VitalsLedger.tsx:281` | `const total = model.counts.all \|\| 1` — the denominator taken from an authoritative precomputed total rather than re-derived from what happens to be rendered. |
| `plugins/dev-tools/sub_lifecycle/competitions/StrategyLeaderboard.tsx:35` | `Math.max(1, ...stats.map(s => s.wins))` — the correct spelling of the extremum, with the divide-by-zero floor built in. |

---

## 7. Deviations

Every item below shipped under a green `npm run check` (0 errors, 1,135 warnings —
[`shared-facts.json`](../shared-facts.json)).

### D0 — A premise of this path's brief is wrong, and the executed arithmetic is the finding

The brief that commissioned this path asserted: *"The denominator is the correctness bug…
share of the total, of the visible page, or of the max row — all three ship in real apps
and they mean different things."*

**They mean different things to a reader. They are the same encoding.** Computed against
real rows from the live database, replaying `llm_spend.rs:200-228`'s own SQL:

| Real list (30-day window) | rows | Σ/max | share-of-max bars sum to | top row's true share | ratio row0:row1 under MAX | under TOTAL |
| --- | --- | --- | --- | --- | --- | --- |
| `dev_llm_spend` by source | 2 | 1.22 | **122%** of one track | 81.9% | 4.5357 | **4.5357** |
| `dev_llm_spend` by trigger | 5 | 1.22 | **122%** | 81.9% | 5.3625 | **5.3625** |
| `dev_llm_spend` by model | 2 | 1.00 | 100% | 99.6% | 225.7971 | **225.7971** |
| healing issues by category | 3 | 1.13 | **113%** | 88.3% | 7.8696 | **7.8696** |
| `dev_contexts` per name | 391 | **102.00** | **10,200%** | 1.0% | 1.0000 | **1.0000** |

Every pairwise ratio is **identical to machine precision** under both denominators. Max-
and total-normalisation differ by exactly one constant factor, Σ/max, and that factor
cancels in every comparison a reader makes *between* bars. So:

- **The denominator choice does not corrupt the comparison.** Ranking, relative lengths and
  every "twice as long" judgement survive both.
- **It corrupts one specific reading: how full the track is.** Under share-of-max the
  remainder of the track means nothing at all, and the factor by which a full bar overstates
  its share ranges from **1.00× to 102×** on this repo's own data — invisible, and it moves
  as the data moves.
- **The genuinely ratio-destroying family is a fourth one the brief did not name:** a
  per-row denominator. §5 row 4; `dev_goals` renders six identical full bars for six
  different amounts of work.

The prescription in §2 survives — *name it, label it, don't mix families* — but it is
justified by what the **track** means, not by an arithmetic error in the bars. A path that
argued "wrong denominator ⇒ wrong picture" would have been wrong, and would have sent
readers hunting for a bug that is not there.

### D1 — The denominator is an ordinal, not an extremum · **4 files, 4 statements**

The signal in §9. Reported as **the floor statement with its consequent divisor**, and
confirmed identically by two independent implementations.

| Statement | Consequent | Reach |
| --- | --- | --- |
| `AthenaUsageSection.tsx:138` `const maxCost = topActions[0]?.costUsd \|\| 1;` | `:139 (row.costUsd / maxCost) * 100` | Athena cost-by-action list |
| `LlmSpendSection.tsx:60` `const maxCost = rows[0]?.cost_usd \|\| 1;` | `:73 (row.cost_usd / maxCost) * 100` | **Two lists** — `renderBars` is called at `:110` and `:117`, and `byTrigger` is `.slice(0, 8)` at `:50` |
| `MetricsCharts.tsx:154` `const maxCost = data.top_personas[0]?.total_cost \|\| 1;` | `:155 (p.total_cost / maxCost) * 100` | Top-Personas-by-Cost, over a backend `.take(5)` (`metrics.rs:1390`) |
| `FactoryObservabilityTab.tsx:101` `const maxCost = byFeature[0]?.[1].cost ?? 0;` | `:131 (e.cost / maxCost) * 100` | Cost-by-feature; **`:102` one line below uses `Math.max(...)` for the sibling panel** |

Every one is *currently* correct, and that is the point. Each depends on a sort it does not
own: `llm_spend.rs:213` `ORDER BY 3 DESC`, `metrics.rs:1383-1387`'s in-memory
`sort_by(total_cost desc)`, `FactoryObservabilityTab.tsx:95`'s
`.sort((a, b) => b[1].cost - a[1].cost)`. Only the last is in the same file. Nothing asserts
the invariant and nothing would notice its loss: computed against the live database with the
order inverted, one `by_source` row's width becomes **454%**, which `overflow-hidden` on the
track renders as a perfectly ordinary full bar.

`FactoryObservabilityTab.tsx:101-102` is the cleanest evidence that this is a slip and not a
policy — the two spellings of the same idea sit on adjacent lines, by the same author, in
the same commit.

### D2 — The page/denominator hazard: **looked for, and not found.** 0 sites

[`filtering-and-search.md:183`](./filtering-and-search.md) found 13 surfaces evaluating a
filter over an array their own fetch had capped, and the brief predicted a bar list would
have the same defect with a visual consequence. **I checked every sliced bar list and this
repo does not have it.**

| Site | Slice | Denominator computed over |
| --- | --- | --- |
| `FactoryObservabilityTab.tsx:119`, `:153` | `.slice(0, 12)` | **full** set at `:99-102`, before the slice |
| `RejectionPatternsPanel.tsx:69` | `.slice(0, 3)` | **full** population — `total = totalRejected` counted across every rejection at `:53`, including buckets that never render |
| `LlmSpendSection.tsx:50` | `.slice(0, 8)` | the slice — but `rows[0]` is the global max because the SQL sorts descending |
| `MetricsCharts.tsx:153` | backend `.take(5)` | the page — same reason |

Reported as a cleared hypothesis. Two things are worth carrying away anyway. First, the two
"safe" rows are safe **because of D1's unstated sort contract**: max-normalisation is
robust to truncation only while the truncation is taken from the top. Second,
`RejectionPatternsPanel` is the model — it counts the denominator over everything and then
truncates the display, so the three visible bars are honest shares of the whole and
correctly sum to less than 100%.

### D3 — Two denominator families, one screen, no label · **1 file, 2 bars, 21 lines apart**

`AthenaUsageSection.tsx`:

- `:127` — `(totals.costUsd / fleetCost) * 100`. **Share of total**, under the heading
  `a.vs_fleet` and the hint `vs_fleet_hint`, which reads verbatim:
  **`"{athena} of {total} total spend this window"`** (`en.json:7427`). The label teaches the
  reader that a full track means "all the spend".
- `:148` — `(row.costUsd / maxCost) * 100`. **Share of largest sibling**, under
  `cost_by_action` (`en.json:7428`), which says nothing about a denominator. The top row's
  bar is always full.

Same component, same card idiom, same `h-1.5`/`h-2` rounded track, same session. Twenty-one
lines after being told a full bar means *all of it*, the reader is shown a full bar that
means *the biggest of these*. This is the repo's own controlled experiment in the mixed-family
defect and it is why §2 mandates the label rather than the denominator.

**And it is not local.** Both sibling repos do the same thing, independently:
`personas-web`'s `/dashboard/sla` route stacks `SLATargetGrid.tsx:126` (SELF — an absolute
0–1 in-SLA rate) above `SLABreachDetail.tsx:32` (MAX — relative to the longest breach on
screen) in one viewport with identical `h-1.5 rounded-full` styling; `brainiac/console`'s
`Observatory.tsx` normalises bar *width* against the corpus total (`:248`) and matrix *heat*
against the largest sibling (`:394`) under one heading. **Three repos, three teams, and not
one site in any of them labels which denominator its bar uses.** That is the single
strongest convergence result in this path, and it is a shared zero rather than a shared
practice — see Convergence.

### D4 — Degenerate shapes are almost entirely unguarded · **109 sites measured**

| Guard | Sites | Share |
| --- | --- | --- |
| Divide-by-zero (`\|\| 1`, `?? 1`, `> 0 ?`) | 41 | 38% |
| Negative clamp (`Math.max(0, …)`) | 12 | 11% |
| Single-row list (`length === 1` / `< 1`) | **2** | **2%** |
| All-zero list | **1** | **1%** |

The single-row case is the one that matters and is the one nobody handles: under
share-of-largest a one-row list renders a full bar against no peer — the mark says
"maximal" and there is nothing it is maximal against. Executed on the live data, both
`by_source` and `by_trigger` degrade to exactly this whenever the window contains one
group. The two sites that do guard (`ArenaResultsView.tsx`, `AthenaUsageSection.tsx`) guard
for other reasons. **Both sibling repos are at zero** — `brainiac/console`'s
`RuleDetail.tsx:162` renders a rule fetched *once* as a full-width bar beside the label
`1`, visually identical to a rule fetched 4,000 times. Universal blind spot, not local.

Negative values are the one dimension where this repo is ahead: 12 clamped sites here
versus **0 at any render site in either sibling**, where a negative score interpolates to
`width: -12%` — CSS-invalid, silently dropped, no bar, no error.

Zero-valued rows are worse than unguarded — they are *indistinguishable*. A 0-width bar
inside a visible track looks the same as a bar that failed to render, and 62% of sites do
not even guard the zero denominator that produces `NaN%` (which CSS drops, yielding a
missing bar and no error anywhere).

### D5 — 32 bars carry no number and therefore no accessible content · **29% of sites**

Measured across all 109 sites: **77 (71%) render a numeric text equivalent inside the row**
(`<Numeric>`, `tabular-nums`, a formatter call, or a `title`); **32 (29%) render a bar and
no number anywhere near it.**

**And this repo is the worst of the three on the metric that matters.** Numbers printed
beside the bar: `brainiac/console` **7/7 (100%)**, `personas-web` **17/19 (89%)**, here
**77/109 (71%)**. Both siblings are ahead, and `brainiac/console`'s `Observatory.tsx:263-264`
is the only site in any of the three repos that prints **both** the raw count and the
derived share next to the bar — the reader can recover the denominator by division. Copy
that.

**The aria statistics are a red herring and I am reporting them as one.** The raw counts —
6 `role="progressbar"`, 12 `aria-hidden`, 2 `aria-label`, **89 (82%) nothing** — invite the
conclusion that 82% of bars are accessibility defects.
[`screen-reader-announcements.md`](./screen-reader-announcements.md) found `aria-*` coverage
thin and the brief expected the same here. But a `<div>` or `<span>` with no role, no
accessible name and no text content is **already absent from the accessibility tree**;
adding `aria-hidden` changes nothing for a reader. The 12 sites that do add it
(`ValueLeakBar.tsx:56`, `FacetedDecisionTable.tsx:343`, `MonitorRow.tsx:98`, …) are
documenting intent for the next developer, which is worth doing, not repairing a defect.

The real defect is the 32 where the bar is the sole carrier of the value. A partial roster,
all confirmed by reading:

`SkillContextsModal.tsx:68` (prints a note *count*, never the share; the `maxNodes`
denominator is invisible) · `MarkdownRenderer.tsx:168` · `ScenarioDetailPanel.tsx:100` ·
`ArenaResultsView.tsx:57` · `CapabilityRowSummary.tsx:33` · `SttPanel.tsx:448` ·
`CrossProjectMetadataModal.tsx:438` · `heartbeats/primitives.tsx:26` ·
`SystemTraceViewer.tsx:181` · `QueryResultTable.tsx:72` · `OverviewTab.tsx:200` ·
`RateLimitDashboard.tsx:128` · `CompositePartialMatchIndicator.tsx:75` ·
`factoryPrimitives.tsx:300`.

### D6 — Minimum-width floors distort small values · **10 sites**

| Site | Floor | Consequence |
| --- | --- | --- |
| `CrossProjectMetadataModal.tsx:438` | **5%** | Every similarity below 5% renders identically to 5% |
| `passportWidgets.tsx:91` | 3% | |
| `WorkspacePulse.tsx:55`, `FacetedDecisionTable.tsx:346`, `factoryPrimitives.tsx:58`/`:293`/`:300` | 2% | |
| `TaskCard.tsx:196`, `SystemLoadFooterIcon.tsx:98`, `progressShared.tsx:252` | 0% | Correct — these are `Math.max(0, …)` clamps, not floors |

Seven genuine floors. `FacetedDecisionTable.tsx:346` compounds it with `Math.round`, so
anything under 0.5% is first rounded to 0 and then floored to 2. In a share-of-total strip
the floors accumulate: ten floored segments consume 20% of a track that is supposed to sum
to exactly 100%.

### D7 — A stacked strip normalised over a closed vocabulary · **1 file**

`TeamCertCard.tsx:37`: `const total = VERDICT_ORDER.reduce((s, v) => s + (counts[v] ?? 0), 0)`
where `VERDICT_ORDER` is the hardcoded 4-tuple `['PRODUCTION', 'PROMISING', 'NOT-READY',
'BROKEN']` (`:7`) and `counts` is a `Record<string, number | undefined>`. A verdict outside
those four is dropped from the numerator **and** the denominator: it disappears from the
strip *and* silently inflates the remaining four to 100%. The strip's own arithmetic
conceals the omission — it will always add up.

### D8 — Sixteen comparative bar lists, sixteen hand-rolls, zero shared primitives

| Denominator family | Sites | Files |
| --- | --- | --- |
| Share of largest sibling | 14 | 12 |
| Share of total | 10 | 9 |
| Declared constant (`/ 10`, `/ maxScale`, `/ score.max`) | 5 | 5 |
| Per-row (progress, rate, score) rendered in a list | ~30 | ~28 |
| Single progress / quota bars (out of scope) | ~50 | — |

Full share-of-largest roster: `LlmSpendSection.tsx:73` · `AthenaUsageSection.tsx:148` ·
`sub_activity/MetricsCharts.tsx:165` · `FactoryObservabilityTab.tsx:131`, `:164` ·
`CategoryRollup.tsx:44` · `DirectorCoachingTab.tsx:345` · `StrategyLeaderboard.tsx:62` ·
`SkillContextsModal.tsx:68` · `MarkdownRenderer.tsx:168` · `MonitorRow.tsx:99` ·
`IpcPerformancePanel.tsx:46` · `CompareMetrics.tsx:96`, `:107`.

Full share-of-total roster: `TeamCertCard.tsx:48` · `VitalsLedger.tsx:285` ·
`QuickDispatchLedger.tsx:79` · `ValueLeakBar.tsx:61` · `RejectionPatternsPanel.tsx:123` ·
`CostBreakdownBar.tsx:66`, `:70` · `AthenaUsageSection.tsx:127` ·
`BacklogFocusDeck.tsx:154` · `OperationalThread.tsx:56`.

`CATALOG.md` offers nothing to route them to. Note that the two implementations disagreed
usefully here: a bracket matcher found only **26 of 109** sites lexically inside a `.map()`
callback, because the row is frequently extracted into its own component
(`MonitorRow.tsx`, `AnomalyDrilldownPanel.tsx`'s `CorrelatedEventRow`, `DimBar`,
`LatencyBar`). A gate keyed on `.map` proximity would have missed three quarters of the
population.

---

## 8. Gaps

**Gap 1 — Nothing owns the denominator, because nothing owns the bar.** `shared/components/`
has ~115 primitives and no bar. `CATALOG.md` has no row to find. So 109 authors each
invented a projection, and the four denominator families in D8 are the result. Every other
deviation is downstream of this: D1 (an ordinal denominator) because nobody had a signature
to pass a real one to; D3 (mixed families in one file) because nothing named the family;
D5 (32 numberless bars) because nothing bundled the value with the mark; D6 (seven floors)
because each author re-decided visibility alone. **This is the root cause the second pass
surfaced, and T2 in §4 is the fix.**

**Gap 2 — The denominator is not expressible in a type, only in a comment.**
`FacetedDecisionTable.tsx:79` makes the right architectural move — normalisation is the
caller's job — and then types the result as `number`, so the one fact that matters travels
in prose (`:73`). Every share is assignable to every other share. T1 closes it for one
consumer; the general form needs the shared primitive of Gap 1.

**Gap 3 — The sort contract that D1 depends on is not expressible either.** Three of D1's
four sites depend on an ordering established in Rust, crossing an IPC boundary that
transmits `Array<LlmSpendGroup>` — a type with no notion of sortedness. A `SortedDesc<T>`
newtype on the TypeScript side, or an assertion at the fetch boundary, would make the
dependency visible; today the only place the invariant is written down is `llm_spend.rs:198`'s
doc comment *"cost-desc"*, on the other side of the bridge. This is
[`bridge-type-contract.md`](./bridge-type-contract.md) territory that no path currently
claims.

**Gap 4 — A bar list has no accessible *structure*, only accessible *content*.** §2's
prescription — print the number, hide the mark — gives a screen-reader user every value,
and gives them **as a flat sequence of labels and numbers**. The sighted reader gets the
distribution's shape in one glance; the non-sighted reader gets a list and must hold it in
memory. `<table>` with `role="columnheader"` would recover some of it, and
[`tables.md`](./tables.md) owns that. But the *shape* — "one row dominates", "this is
long-tailed", "these three are equal" — has no text equivalent anywhere in any of the three
repos surveyed, and none of the eleven `aria-*` spellings in the population attempts one.
This is not solvable by a lint; it is a piece of summarisation nobody has written.

**Gap 5 — The choice §2 asks you to make cannot be made from the code.** Whether a list
answers *"which is biggest"* or *"how is the whole divided"* is a product question, and it
changes with the data: Σ/max is 1.00 for `by_model` (where share-of-max and share-of-total
are visually identical) and 102 for `dev_contexts` (where share-of-total is unusable). A
primitive could offer `denominator: 'auto'` that picks by Σ/max — and it would then change
the meaning of the picture as the data drifted, without telling anyone. **No automatic
answer is safe here**, which is why §2 mandates a stated choice and §9 gates the spelling
rather than the choice.

**Gap 6 — The census rule cannot see the condition, only one idiom of it.** §9 keys on
`const max… = arr[0]`. A denominator taken as `arr.at(0)`, `[first] = rows`, `sorted.shift()`,
or a backend-supplied `max_cost` field is the same defect and matches nothing. Recall is
bounded by idiom; §9 states the condition so an adopting repo can re-derive its own proxy.

---

## 9. The missing gate

**The condition to enforce:** *a proportional bar's denominator is an **ordinal** — the
first element of a collection — rather than a computed extremum.* Not "a bar exists", not
"which denominator was chosen" (§2 says both are legitimate and D0 proves it), but the one
thing in this leaf that is a latent correctness bug rather than a labelling choice, and the
one this repo gets wrong four times.

**Checked first that it is not already gated.** `scripts/census/rules.json` held **81 rules**
when scanned and **82** an hour later (parallel composers land into it — hence the contract's
rule that a path publishes its block rather than editing the file). None has an `id`, title
or signal containing `bar`, `width`, `share`, `denominator`,
`proportion`, `rank`, `leaderboard`, `distribution` or `meter`. Three neighbours were read in
full to be sure:

- **`locale-blind-percent`** — its pattern opens with a negative lookbehind that *explicitly
  excludes* `width|height|left|right|inset|…` followed by a percent. This leaf's entire
  territory is deliberately carved out of it. Zero overlap by construction.
- **`hand-assembled-currency`** (`\$\$\{|\$\s*<Numeric\b`) — matches the printed value, never
  the geometry.
- **`sample-derived-plot-scale`** ([`chart-component.md:636`](./chart-component.md)) — its
  signal is `= Math.min(...ident)` paired with `|| 1`. My four sites contain no `Math.min`
  spread at all; the two populations are disjoint. Verified by running both rules in one
  census invocation: 7 files and 4 files, no shared path.

**Signals I designed, measured, and rejected — the rejections are the finding:**

| Candidate | Result | Why rejected |
| --- | --- | --- |
| `width: \`…/ max…%\`` — any max-normalised bar | 7 files / 9 matches | **Every one is legitimate.** D0 proves share-of-largest is a correct encoding. A baseline here records `CategoryRollup`, `StrategyLeaderboard` and `SkillContextsModal` — three of the better bar lists — as violations. This is the fire-on-correct-content trap. |
| `Math.max(2, …)` visibility floors | 7 genuine + 3 `Math.max(0, …)` clamps that are correct | 70% precision, and the 3 false positives are the *recommended* spelling from §4 step 7. Not shippable. |
| A bar with no `<Numeric>`/number in the row (D5) | 32 sites | Requires a JSX-scope proximity judgement a whole-content regex cannot make; my measurement used a ±2,300-char window, which is a heuristic, not a matcher. Belongs in ESLint (an AST can find the enclosing JSX element) — recorded, not shipped. |
| `const max… = arr[0]` with no consequent | 4 files / 4 matches, 100% precision | Shippable, but it is a *statement without its consequent*: it would also match a `maxRow` taken for display rather than division. Superseded by the version below. |

**The shipped signal is the statement WITH its consequent**, joined by a backreference: a
binding *named* `max*` assigned `something[0]`, **and** that same binding used as a divisor
within the next ~2,500 characters. The backreference is what makes the pairing exact — it is
not "a max-ish name near a division", it is *this* binding divided by. The window had to be
widened from 900 to 2,500 to reach `FactoryObservabilityTab.tsx:101 → :131` (30 lines);
precision stayed at 4/4 at both widths.

**Validated standalone** against the real engine
(`node scripts/census/run-census.mjs --rules <scratch>/rules-proportional-bar-list-probe.json --verbose`):
`ordinal-denominator-in-bar-list` → **4 files / 4 matches / 4,829 walked**;
`declared-bar-denominator-positive-control` → **20 files / 20 matches**; 9,658 file-visits,
1.5 s wall, `census OK`. Re-extracted from this finished document and re-run: identical.

**Verified by a second independent implementation** — a character-level bracket matcher
that resolves each width expression's enclosing scope and then walks backwards to the
denominator's defining statement — which reported the same four files. It also *disagreed*
usefully elsewhere: it found only 26 of 109 sites lexically inside a `.map()`, which is how
I learned that a `.map`-proximity signal would miss three quarters of the population
(D8). Two implementations disagreeing is what made that measurable.

**Fail-loud properties**, inherited from the census engine rather than re-derived: a run
fails on a rising count, on a *silently dropping* count, on a walk seeing fewer than `floor`
files, on a rule matching zero files anywhere, and on a stale `exclude`. Surviving counts
print on success.

**How this gate could still fail, stated so the next repo can re-derive it.** The signal
proxies for *"the denominator is an ordinal, not an extremum"*, and it keys on the idiom
this repo happens to use: a `max`-prefixed `const` bound to `[0]`. A repo spelling the same
defect as `rows.at(0)`, `const [first] = rows`, `sorted.shift()`, `head(rows)`, or a
backend-supplied `max_cost` column will match nothing while the condition is present at
scale — the exact portability failure
[`golden-path-contract.md:34-60`](../golden-path-contract.md) documents. It is also blind to
the same defect under a different variable name (`peak`, `top`, `biggest`); widening the name
class was measured and admits false positives from `const topRow = rows[0]` used for
display. **An adopting repo must re-derive its own proxy for the condition, and should check
the positive control's population before trusting a green run.**

**The positive control** carries no `baseline` by design. It matches the *correct* spelling
this path prescribes — a `max`-named binding assigned `Math.max(` over a **spread** of the
sibling set. The two rules differ in exactly one respect: whether the right-hand side is an
index or an extremum. If any regex, walk or engine change ever broke the
`const <max-name> =` matcher family, the control goes to zero matches and the run fails
structurally. Its recall is deliberately narrow — it does not match `Math.max(a, b, 1)`
(`CompareMetrics.tsx:86`) or a denominator arriving as a prop (`MonitorRow.tsx:99`) —
because a liveness probe wants a stable, exactly-understood population, not coverage.

**On severity.** This is proposed at the census layer, which is a ratchet, not an `"error"`.
The count may not rise; the existing four are a backlog, not a build break. No argument from
warning volume is made or intended — and specifically, the fact that all four sites are
currently *rendering correctly* is why this is a ratchet and not a lint: the defect is
latent, and a latent defect earns a ceiling, not an alarm.

```json
{
  "id": "ordinal-denominator-in-bar-list",
  "goldenPath": "docs/concepts/golden-paths/proportional-bar-list.md",
  "title": "A proportional bar's denominator is the FIRST ROW rather than a computed extremum, so the geometry silently depends on a sort the component does not own",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\b(?:const|let)\\s+(max[A-Za-z0-9_$]*)\\s*(?::[^=\\n]*)?=\\s*[A-Za-z0-9_$.]+\\s*\\[\\s*0\\s*\\][^\\n]*[\\s\\S]{0,2500}?/\\s*\\1\\b",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a binding NAMED max* assigned the FIRST ELEMENT of a collection, AND (backreference) that same binding used as a divisor within ~2500 chars. The consequent is required so the match is a DENOMINATOR and not any first row: `const topRow = rows[0]` taken for display cannot match. The name+index mismatch is the defect — the binding claims an extremum and holds an ordinal, so the bar's geometry is correct only while an ORDER BY the component never sees keeps holding (llm_spend.rs:213, metrics.rs:1383, FactoryObservabilityTab.tsx:95 — only the last is in the same file). Measured against the live database with that order inverted, one row computes width 454%, which overflow-hidden clips to an ordinary full bar with no error anywhere. Math.max(1, ...rows.map(f)) is unconditionally correct and one line. Condition proxied: the denominator is an ordinal, not an extremum. An adopting repo must re-derive this proxy for its own idiom (rows.at(0), const [first] = rows, sorted.shift(), head(rows), a backend-supplied max column)."
  },
  "baseline": { "files": 4, "matches": 4 },
  "floor": 4000
}
```

```json
{
  "id": "declared-bar-denominator-positive-control",
  "goldenPath": "docs/concepts/golden-paths/proportional-bar-list.md",
  "title": "POSITIVE CONTROL — a bar denominator computed as an extremum over the sibling set",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\b(?:const|let)\\s+[A-Za-z0-9_$]*[Mm]ax[A-Za-z0-9_$]*\\s*(?::[^=\\n]*)?=\\s*(?:useMemo\\(\\s*\\(\\)\\s*=>\\s*)?Math\\.max\\(\\s*(?:[\\d.]+\\s*,\\s*)?\\.\\.\\.",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL, deliberately carrying NO baseline. Matches the CORRECT spelling this path prescribes: a max-named binding assigned Math.max over a SPREAD of the sibling set, optionally with a leading numeric floor (Math.max(1, ...rows.map(f))). It exists to prove the sibling rule's matcher family is alive: ordinal-denominator-in-bar-list distinguishes itself from this one ONLY by whether the right-hand side is an index or an extremum, so if a regex or walk change ever made the `const <max-name> =` prefix stop matching, this control goes to zero and the run fails structurally. Recall is deliberately narrow — it does not match Math.max(a, b, 1) (CompareMetrics.tsx:86) or a denominator arriving as a prop (MonitorRow.tsx:99) — because a liveness probe wants a stable, exactly-understood population, not coverage. It must never be given a baseline."
  },
  "floor": 4000
}
```

**Three conditions in this leaf that I am refusing to gate, with the measurement that
justifies each refusal:**

1. **Mixed denominator families on one screen** (D3) is the leaf's sharpest defect — and
   convergence says it is the *universal* one, reinvented independently in all three repos
   surveyed, with zero labelled sites in ~150 bars. It is still not gateable here. It is a
   relation between two sites in a render tree, not a string; and it is a population of
   **one** in this repo, while the census engine **fails a rule that matches zero files
   anywhere** — so the moment `AthenaUsageSection.tsx` is fixed the gate would break the
   build. A gate whose success condition destroys it is a worse artifact than the two-line
   label fix, which is named in D3. The durable answer is T1's closed union (§4), which
   makes the condition a type error rather than a count.
2. **The 32 numberless bars** (D5) is a real, countable-in-principle defect and belongs in
   ESLint, not the census: deciding whether a number is rendered "in the same row" requires
   the enclosing JSX element, which an AST has and a whole-content regex does not. My own
   measurement used a character-window heuristic and I am not baselining a heuristic. Recorded
   in D5 with the roster so the rule can be written against a known answer.
3. **Which denominator was chosen** is not gateable *and should not be*, which D0 establishes
   by execution rather than taste. Share-of-largest and share-of-total preserve identical
   ratios; the right choice depends on Σ/max, which ranges 1.00–102 across this repo's own
   live data and moves as the data moves (Gap 5). A rule preferring either would fire on
   correct content in half the codebase.

---

## Convergence

Measured against `../personas-web` (30 data bars, 19 in lists) and `../brainiac/console`
(7 bars, 5 in lists), neither of which has ever seen this document.

| | this repo | personas-web | brainiac/console |
| --- | --- | --- | --- |
| Bar-list sites | ~40 of 109 | 19 of 30 | 5 of 7 |
| Share of largest sibling | 14 | 2 | 3 |
| Share of total | 10 | 1 | 2 |
| Declared constant | 5 | 6 | 0 |
| **Per-row (SELF)** | ~30 | **10 (53%)** | 2 |
| Shared bar primitive with adopters | **0** | **0** (one exists, `kpiPrimitives.tsx:133`, **0 call sites**) | **0** |
| A site that **labels which denominator it used** | **0** | **0** | **0** |
| `<progress>` / `<meter>` | 0 / 0 | 0 / 0 | 0 / 0 |
| Single-row guard | 2 / 109 | **0** | **0** |
| Negative-value clamp at the render site | 12 | **0** | 1 |
| Minimum-width floors | 7 | 4 | 4 |
| Number printed beside the bar | **71%** | 89% | **100%** |

**Reinvented independently — treat as physics:**

| Clause | Evidence across three repos |
| --- | --- |
| **Mixing denominator families in one view, unlabelled** | Here: `AthenaUsageSection.tsx:127` vs `:148`. `personas-web`: `/dashboard/sla` stacks a SELF gauge over a MAX bar in identical styling. `brainiac`: `Observatory.tsx:248` (total) vs `:394` (max) under one heading. **Three teams, three instances, zero shared documents.** |
| **Nobody labels the denominator — 0 / 0 / 0** | Not one site in ~150 bars across three codebases says what its track means. This is the leaf's defining defect and it is universal. |
| **A single-row list is unguarded — 2 / 0 / 0** | `brainiac`'s `RuleDetail.tsx:162` draws a rule used *once* identically to one used 4,000 times. |
| **A minimum-width floor gets added and never revisited — 7 / 4 / 4** | Same instinct everywhere; largest is `personas-web`'s 8% (`LanesView.tsx:65`). |
| **The value gets printed beside the bar — 71% / 89% / 100%** | The seam condition `chart-component` derived from two files here holds as a strong majority in all three. |
| **`Math.max(1, ...xs)` as the extremum spelling** | `brainiac` writes it three times verbatim (`RuleDetail.tsx:68`, `SkillsCatalog.tsx:105`, `Archive.tsx:640`); this repo writes it at `StrategyLeaderboard.tsx:35`, `SkillContextsModal.tsx:34`, `DirectorCoachingTab.tsx:281`. Identical idiom, no shared document. |

**Where convergence contradicts me — reported as required:**

- **I was going to file "no shared bar primitive" as local calibration, and I was wrong.**
  The reasoning was that 109 hand-rolls is a symptom of this repo's 4,829 files. But
  `brainiac/console` has **zero** bar primitives across **7** bars — and copy-pastes the same
  `Math.max(3, (u.uses / maxUses) * 100)` line verbatim between two modules — while
  `personas-web` has one primitive (`kpiPrimitives.tsx:133` `KpiBar`) with **zero adopters**,
  whose `width` prop is the container's CSS width and whose denominator is computed
  *internally* from the row's own baseline and cannot be supplied by the caller. **At 7 bars,
  30 bars and 109 bars, all three arrive at no usable primitive.** Gap 1 is physics, T2 is
  doctrine, and the failure mode is now specific: the one attempt anywhere put the
  denominator *inside* the component, which is exactly the move
  `FacetedDecisionTable.tsx:79` avoided and is why that signature — not `KpiBar`'s — is the
  one to generalise.
- **The brief's premise that "the denominator is the correctness bug" has no external
  support, because D0 shows it is not true.** Max- and total-normalisation preserve every
  pairwise ratio exactly. What survives is narrower and now *strongly* supported: name it,
  label it, don't mix families — the last of which all three repos violate.
- **The brief predicted a bar list computing its denominator from a capped page, by analogy
  to `filtering-and-search.md`'s 13 surfaces. It is absent here (§7 D2) and present in the
  sibling.** `personas-web`'s `SLABreachLog.tsx:50-58` computes `maxDuration` over the
  *severity-filtered* set, so flipping the filter re-anchors every bar and the same breach
  renders a different length. The hazard is real; this repo simply does not have it, and
  saying so is the finding. Its converse is the best line of code found in any of the three:
  `brainiac`'s `DisputeBench.tsx:186-187` scopes the strip to the full backlog *on purpose*
  while the rows page, and prints `{total} disputed · {rows.length} shown`.

**Where the raw count would mislead any adopting repo.** 82% "no `aria-*`" sounds like a
finding and is not one — an unnamed `<div>` is already outside the accessibility tree.
29% "no number in the row" is the finding. An adopting repo that copies the aria metric will
manufacture ~80 false defects and miss the ~30 real ones. §7 D5 states this in place so it
travels with the head.

**A controlled experiment inside one interface still beats all of it.**
`FacetedDecisionTable.tsx:79`'s `nodeMeta` is the only bar signature in any of the three
repos that takes normalisation *out* of the drawing component, and its single consumer
(`KnowledgeTree.tsx:118-149`) is the only bar list in any of the three that names its
denominator, scopes its peer group, and explains the alternative it rejected — **1 of 1**
against **0 of ~150**. Same mechanism as `MetricChart.height` (3/3) and `createLazySection`
(22/22 vs 2/31): when the signature forces the caller to *supply* the dangerous value, the
caller thinks about it. And the same caveat, visible in the same file — `share` is required
and typed `number`, so the property it was meant to guarantee is not encoded. **Requiredness
bought the thinking; only closedness would have bought the guarantee.** That is why §4's T1
is a union and not a rename.
