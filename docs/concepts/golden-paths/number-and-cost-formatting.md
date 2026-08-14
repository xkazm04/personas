# Golden path — Number and cost formatting

> Situation node: `ui-system/copy-and-vocabulary/number-and-cost-formatting` · [situation spine](../situation-spine.md)
> Composed 2026-08-14. **Recurrence 176.**
> Sweep: `src/lib/utils/formatters.ts` (480 lines) and `display/Numeric.tsx` read in full and then
> **executed** — the real module was transpiled with the repo's own TypeScript and every formatter
> called against nulls, zeros, negatives and all 14 shipped locales, so the behaviour claims below
> are observed rather than reasoned about. Plus: `AnimatedCounter`, `SpringCount`, `KpiTile`,
> `RelativeTime`, `AbsoluteTime`, `useFormattedDate`, `eslint-rules/prefer-numeric.cjs` and both
> numeric test files read in full; a **full `npx eslint` run over all 4,829 files** counted per rule;
> a brace-and-quote-aware parse of every `<Numeric>` / `<KpiTile>` / `<StatCard>` /
> `<AnimatedCounter>` / `<Stat>` opening tag in all 2,104 `.tsx`; every one of the 212 `.toFixed()`
> sites classified by what sits either side of its interpolation; and a convergence census of
> **`personas-web`** (Next.js, 1,029 source files) and **`personas-cloud`** (Node/Fly.io monorepo,
> 48 source files).
> Dimensions: **ui · function · cost · code-quality**.
> **Settles:** who decides what a number looks like on screen — the call site or the number layer.
>
> Counts below were measured during composition. Where they touch
> [`shared-facts.json`](../shared-facts.json) they reproduce it exactly (4,829 files, 1,135 warnings,
> 0 errors, 246 files with findings). **Two of the brief's three hypotheses failed and are corrected
> in §7.0.** Deviations become `violating` cells.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
every clause carries its **warrant**, so an adopting repo can tell physics from local calibration.
No file path, primitive name or count appears below this line until the head ends.

> **P1 — physics.** A number a person reads is not the number; it is a *rendering* of the number in a
> convention that the reader's locale owns — separator, grouping, sign placement, symbol position,
> spacing. The code that holds the number must hand it to a layer that knows the convention. A call
> site that decides the convention has decided it for one locale and guessed for the rest.
>
> **P2 — physics, and the reason P1 is not merely tidy.** Rounding is a *contract about loss*, and
> the amount of loss a reader can tolerate is a property of the quantity, not of the widget. A
> rendering that discards magnitude the reader needed is not a style defect — it is a false
> statement — and at the call site it is textually indistinguishable from a correct one, because
> both are a number followed by a glyph.
>
> **P3 — physics.** A quantity with a unit is one value, not two. The instant a currency symbol, a
> percent sign, a magnitude suffix or a minus sign is *concatenated* to an already-formatted number,
> the pair can no longer be re-ordered, re-spaced, re-signed or re-denominated — and each of those
> is something some locale, or some future requirement, will demand.
>
> **P4 — physics.** *Zero*, *unknown*, and *too small to show at this precision* are three different
> facts about the world. A formatter that maps two of them to the same glyph has destroyed
> information the reader needs and left them no way to detect the loss.
>
> **P5 — ergonomics, with a measured cause.** A shared formatter that *accepts* a locale but
> *defaults* to a specific one is a locale-blind formatter with extra steps. The default is what
> ships, because passing the locale requires the call site to know that it must — and the call site
> that knew would not have needed the primitive.
>
> > **P5 IS NOW IMPLEMENTED — landed 2026-08-14, confirmed by a second stack.** The
> > convergence run against `politicas` (Next.js) measured the cost of the old
> > default: of 197 value-driven `<Numeric>` sites **8** passed `language`, and of 27
> > direct `formatCost` callers **4** did — so ~96% of the app rendered en-US
> > separators across 14 locales, seven of which use a decimal comma. `politicas`
> > binds the locale inside its `useFormat()` hook, so there is no argument to
> > forget, and its off-token rate is 1 in 827.
> >
> > Fixed the same way: `<Numeric>` now defaults `language` from
> > `useTranslation().language` (reactive, and 57 shared components already consume
> > that hook), and the four `?? 'en'` defaults in `formatters.ts` now read an
> > `activeLanguage()` helper off the i18n store so non-React callers get it too.
> > The prop survives as a genuine override for a fixed-locale export preview.
> > **One edit at the primitive corrected ~212 call sites**, which is the whole
> > argument of P5 stated as a diff.
>
> **P6 — governance.** A checker that keys on *where a formatting call sits in the syntax tree*
> rather than on *what the call produces* can always be narrowed until it reports zero. The
> population it narrows away is not random: it is the reusable formatter helpers, which is precisely
> where formatting concentrates.
>
> **P7 — governance.** Two display primitives that disagree about where the locale comes from will
> disagree on the same screen, in the same row, and no gate will ever notice, because each one is
> internally consistent.
>
> **Scale condition.** P1, P3 and P5 begin to pay from the second locale. P2 and P4 pay from the
> first unit of real money — they are correctness at any scale. P6 and P7 bite as soon as more than
> one display primitive exists.

**Warrant evidence — the sibling reinvented the idiom, the defect, and the proportion.**
`personas-web` (Next.js, separate remote, no shared package) and `personas-cloud` (Node + Fly.io,
no UI at all) were censused independently. Neither has seen this document.

- **`` `$${x.toFixed(n)}` `` is convergent, and it is a shared trap.** `personas-web` has it 11
  times; `personas-cloud` has exactly one `.toFixed()` in its entire 48-file tree and it is
  `` `$${request.maxBudgetUsd.toFixed(2)} USD` `` (`packages/shared/src/prompt.ts:639`). Three
  codebases, three stacks, one idiom. **And in both UI repos it rounds sub-unit money to a displayed
  zero at roughly the same rate — 22 of 40 here, 6 of 11 there.** A defect two independent teams
  reach by different routes is a property of the problem, not of either team. **P2 and P3 are
  physics.**
- **Multiple precisions for the same quantity is convergent.** `personas-web` renders cost at
  **five** precisions (`format.ts:12` 4dp, `knowledgeDenseFormat.ts:20` 3dp,
  `ObservabilitySpendPieChart.tsx:20` 2dp, `AthenaUsageCard.tsx:113` *no precision at all — the raw
  float reaches the axis*, plus a special-cased `"$0.0000"`), and `formatCost`/`formatKnowledgeCost`
  are both applied to `avgCostUsd`-shaped data. This repo ships **five** too (0,1,2,3,4 decimals).
  **P2 again.**
- **The locale is available and thrown away, in both.** `personas-web`'s
  `useTranslation.ts:87` returns `{ t, language }` over the *same fourteen languages*; **1 of its
  151 call sites destructures `language`, and it uses it to pick an audio track.** Zero of its
  number, percent or currency renders are locale-aware. Here: **20 of 1,505.** Two teams built the
  locale channel and neither wired it to the number layer. **P5 is physics, and it is a shared
  trap.**
- **Duration suffixes hardcoded in one language is convergent.** `personas-web` has **four**
  competing duration ladders (`format.ts:1`, `knowledgeDenseFormat.ts:13`, `slaFormat.ts:39`,
  `LatencyChart.tsx:26`) that disagree with each other — one chart formats the same latency at 1dp
  on its axis and 2dp in its own tooltip — and every unit suffix is an English literal. This repo
  has six ladders with the same property.
- **The gate goes blind in the same place, by a different mechanism.** `personas-web`'s
  hardcoded-string reporter filters on `hasLetters(value)` (`/[A-Za-z]/`), so a literal `%`, `$` or
  bare digit is invisible to it by construction — which is why 30 percent sites and 46 `$` sites
  survive a CI that runs i18n coverage on every push. Here the ESLint rule was narrowed until it
  reported zero (§7.B). **Same hole, two unrelated causes. P6 is physics.**

**What did NOT converge, and is therefore this repo's own investment.**
**`Intl.NumberFormat` appears zero times in `personas-web` and zero times in `personas-cloud`.**
Neither sibling has any locale-aware number path at all. This repo has one — a cached
`Intl.NumberFormat` layer with a currency/percent/compact/count vocabulary — and it is genuinely
ahead. Likewise **a numeric *component*** (`<Numeric>`) has no analogue anywhere: `personas-web`'s
`MetricCard` and `StatBadge` take an already-formatted `string`, and its `useAnimatedNumber` hands
back a raw `number` for the caller to format. **So `formatCost`/`formatDuration` as shared
*functions* is convergent (both repos reinvented both names); `<Numeric>` as a *component*, and the
`Intl` layer behind it, are local calibration — adopt the principle, and note that this repo already
built the thing the others are missing.**

**The negative control is clean.** `personas-cloud` has 0 `.tsx`, 0 `Intl`, 0 `locale`, 0 percent
renders and 0 duration formatting. Money is `REAL` float in SQLite (`db.ts:246,362,412`), returned
as raw JSON scalars. Its absence is *structural* — a headless orchestrator has no display layer —
which is what makes it the right control rather than a counterexample. One thing it shares with both
UI repos: **`cents` appears zero times in all three.** No repo stores money as an integer.

---

## 1. Trigger

- "show the cost of this run", "add a spend column", "put the token count in the header"
- "this percentage should have one decimal", "the KPI tile overflows when the number gets big"
- "show how long it took", "display the file size", "add a $ next to it"
- "the number jitters when it updates" / "the column isn't aligned"
- **If you are about to type `.toFixed(`, `.toLocaleString(`, `Math.round(` next to a `%`, a `$`
  immediately before a `{`, `/ 1000` next to a `k`, or `/ 1024` next to `MB`** — you are in this
  situation.
- If you are about to write a `format={(v) => …}` / `tickFormatter` / `formatFn` callback for a
  chart, a slider or a KPI tile, you are in this situation — **and it is the one place the existing
  lint rule deliberately does not look** (§7.B).

You are **not** in this situation for: SVG geometry (`` `${x.toFixed(1)},${y.toFixed(1)}` `` in a
path or points attribute — 33 sites, all legitimate), a CSS length or percentage
(`style={{ width: `${pct}%` }}` — ~195 sites, layout not display), a number written into an LLM
prompt or a log line, a numeric value persisted to SQLite, or a `data-testid`.

Boundaries with the neighbouring paths, stated because all four leaves touch the same JSX:

- **[`i18n-string-authoring.md`](./i18n-string-authoring.md)** owns the *words* around the number —
  `"agents"`, `"per month"`, `"of budget"`, the `tx(t.x, { count })` plural. This path owns the
  *digits and their unit glyph*. The seam is sharp and it has a defect on it: `formatInterval()`
  returns `"1 hour 1 minute"` and `formatRelativeTime()` returns `"2h ago"` / `"just now"` /
  `"Never"` — English words emitted by the number layer, which is this path's primitive producing
  that path's condition (§7.F).
- **[`design-token-usage.md`](./design-token-usage.md)** owns `tabular-nums` / `font-data` /
  `text-right` — how the digits *look*. This path owns what the digits *say*. `<Numeric>` is one of
  the very few primitives that spans both, and its typographic half is the half that works.
- **[`status-and-severity-badges.md`](./status-and-severity-badges.md)** owns a closed vocabulary
  resolved through `tokenLabel`. A number is an *open* vocabulary: there is no catalog of
  `1,234.56`, so the answer is a formatter, not a lookup. Where the two meet — a KPI tile with a
  status-coloured figure — the colour is that path's and the figure is this one's.

---

## 2. The one way

**Hand the raw number and the active locale to the number layer, and let it emit the whole string
including the unit glyph.** In a component write
`const { t, language } = useTranslation()` and then
`<Numeric value={n} unit="usd|percent|ratio|count|compact|ms|s|plain" language={language} />` — the
`language` prop is not optional in practice, because **`Numeric` defaults to `'en'` and 206 of its
215 call sites take that default** (§7.A), which is how a German user reads `1,234.56` where their
locale says `1.234,56`. Outside JSX, call the same formatters directly —
`formatCost(usd, { language })`, `formatPercent(v, { language })`,
`formatCount(n, { language })`, `formatCompactNumber(n, { language })` from
`@/lib/utils/formatters` — never `.toFixed()`, never `.toLocaleString()` with no argument (that
reads the *operating system's* locale, which drifts from the language the user picked in the app),
and never a hand-built `Intl.NumberFormat`. **Never concatenate a unit glyph to a formatted
number**: `` `$${x.toFixed(2)}` `` and `$<Numeric value={x}/>` are the same defect — they nail the
symbol to the left of the digits, which is wrong in de/fr/cs/vi/id, and they re-decide the rounding
per call site. For money specifically, **guard the zero** (`{cost > 0 && <Numeric …/>}`) because
`unit="usd"` runs `formatCost`'s `'auto'` precision, which renders an exact `0` as `"<$0.001"`
(§7.C) — and **do not pass `precision` with `unit="usd"`, `"ms"` or `"s"`, because
`formatNumeric` silently drops it** (9 sites do this today). For a magnitude that can outgrow its
tile use `unit="compact"` and *not* a hand-rolled `/1000 + 'k'` — Intl's compact notation is
`1.2M` in en but `1,2 Mio.` in de, `123.5万` in zh, `12.3 लाख` in hi, and no `+ 'k'` will ever produce
those.

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`src/features/shared/components/display/Numeric.tsx`** — `<Numeric value unit precision language align as title/>` | The display primitive. **215 tags / 112 files.** Emits `font-data` + an inline `fontVariantNumeric: tabular-nums lining-nums` so digits never jitter, and delegates the string to `formatNumeric`. For `unit="compact"` it auto-fills `title` with the full-precision grouped value, so the exact number is one hover away. |
| **`src/lib/utils/formatters.ts:389` — `formatNumeric(value, unit, { language, precision })`** | The one unit→string dispatch. `NumericUnit` = `ms \| s \| usd \| percent \| ratio \| count \| compact \| plain`. Null/NaN → `—` for every unit, which is the right shape. |
| **`formatters.ts:102` — `formatCost(usd, { precision: 2\|4\|'auto', language })`** | USD through `Intl` currency style, so the glyph lands where the locale puts it: `$1,234.50` (en) · `1.234,50 $` (de) · `1 234,50 $US` (fr) · `US$1.234,50` (id). At `precision: 2` it emits **`<$0.01`** for a sub-cent amount rather than `$0.00` — the sub-cent guard the 22 hand-rolled sites lack. |
| **`formatters.ts:294` — `formatPercent(v, { fromRatio, precision, language })`** | Intl percent style. Gets the things concatenation cannot: `42,5 %` in de/fr/cs (comma **and** the space before the sign) and the bidi marks in ar. Fixed precision by default so right-aligned columns stay flush. |
| **`formatters.ts:312` — `formatCount(v, { language, precision })`** | Locale grouping. Genuinely different per locale, not just cosmetic: `1,234,567.5` (en) · `1.234.567,5` (de) · `1 234 567,5` (fr/cs) · **`12,34,567.5` (hi — lakh grouping)**. |
| **`formatters.ts:341` — `formatCompactNumber(v, { language, precision, threshold })`** and **`formatters.ts:361` — `compactWithTitle(v, opts)`** | Intl compact notation above a 10,000 threshold (below it the grouped figure is kept, because `1,234` reads better than `1.2K`). `compactWithTitle` returns `{display, title}` — the canonical KPI-tile pairing. |
| **`formatters.ts:71-91` — the module-scope `Intl.NumberFormat` cache** | `getNumberFormat(locale, options)` memoizes by locale + the option fields actually varied. `Intl.NumberFormat` construction is one of the most expensive stdlib constructors and `AnimatedCounter` calls its `formatFn` on every rAF tick. **Use the formatters; do not new up your own.** |
| **`formatters.ts:444` — `formatDuration(v, { unit, precision })`** and **`:254 formatElapsed(v, 'compact'\|'clock')`** | The duration ladders — `4s` / `2m 30s` / `1h 5m`, or zero-padded `MM:SS` / `HH:MM:SS`. **50 + 15 external call sites in 34 + 9 files**, the best-adopted helpers in the file. |
| **`display/AnimatedCounter.tsx`** / **`display/SpringCount.tsx`** | The animated figures. Both take a `formatFn` / `format` — **pass a locale-bound formatter into it**; `AnimatedCounter`'s default is `String(Math.round(v))`, which has no grouping at all. |
| **`overview/components/shared/KpiTile.tsx`** | Takes `language` and threads it into `formatCompactNumber` for the compact path. 12 of its 32 call sites pass it — the best `language` adoption of any component in the repo. |
| **`eslint-rules/prefer-numeric.cjs`** (`custom/prefer-numeric`, warn) | Flags `.toFixed()`/`.toLocaleString()` **rendered directly as a JSX child**. Correctly skips dates and JSX attribute values. Reports **5 warnings** repo-wide — see §7.B for why that number is not what it looks like. |

**Explicitly NOT primitives.** `Math.round(x * 100) / 100` (`personaHealthSlice.ts:224`) is a
seventh rounding idiom, not a formatter. `round(n, dp) => Number(n.toFixed(dp))`
(`sub_triage/findings/emitters.ts:35`) is an eighth. `new Intl.NumberFormat(undefined, …)`
(`ChartTooltip.tsx:18`) takes the **host** locale, not the app's. `RelativeTime` and `AbsoluteTime`
are the *date* primitives and belong to a different leaf — but note that they have made a **third
and fourth** locale policy (§7.G) and a row that renders all three side by side is internally
inconsistent by design.

---

## 4. Steps

1. **Name the quantity before you format it.** Money · percentage · ratio · count · magnitude that
   can outgrow its box · duration · byte size · multiplier. If it is SVG geometry or a CSS length,
   stop — write the arithmetic and move on.
2. **Get the locale.** `const { t, language } = useTranslation()`. This is the step 1,485 of 1,505
   translated files skip, and it is the root of §7.A. In a non-React module, take `language` as a
   parameter rather than reaching for a default.
3. **Render through `<Numeric>` with a `unit` and a `language`.** `unit` is the whole decision:
   `usd` for money, `percent` for a 0–100 magnitude, `ratio` for a 0–1 fraction, `count` for a
   quantity, `compact` for a KPI figure, `ms`/`s` for a duration, `plain` for a bare grouped number.
   **And then stop** — the primitive owns the separator, the grouping, the symbol position, the
   tabular figures and, for `compact`, the full-precision hover title.
4. **Let the primitive emit the glyph.** Do not write `$` before `<Numeric>` (10 sites do), do not
   write `%` after an interpolation (78 sites do), do not append `k`/`M` (7 sites do), do not weld a
   `-` in front for a negative (`AlertsPanel.tsx:57`). Every one of those is P3.
5. **For money, guard the zero and skip `precision`.** `{cost > 0 && <Numeric value={cost}
   unit="usd" language={language}/>}` — `LlmCallsTable.tsx:263` and `GlobalExecutionList.tsx:466`
   are the two files that do this. Passing `precision` alongside `unit="usd"`, `"ms"` or `"s"` is
   silently ignored (§7.D); if you need a fixed money precision, call
   `formatCost(usd, { precision: 2, language })` directly and pass the result as `children`.
6. **Outside JSX, call the formatter, not the method.** A chart `tickFormatter`, a `format={(v) =>
   …}` callback, a `_FORMATTER` const, a `.ts` helper — these are display code and they are exactly
   where the raw calls survive. `(v) => formatCost(v, { language })` is the same length as
   `` (v) => `$${v.toFixed(2)}` ``.
7. **For an animated figure, bind the locale into the callback.**
   `<AnimatedCounter value={n} formatFn={(v) => formatCompactNumber(v, { language })} title={…}/>`.
   The default `String(Math.round(v))` has no grouping in any locale.
8. **Put `language` in the dependency array** of any `useMemo` that builds columns or formatted
   strings. `LlmCallsTable.tsx:269` does (`[t, language, …]`); a file that omits it is correct on
   first paint and stale after a language switch, and nothing in this repo can see the difference.
9. **Ask the type question before you reach for a gate.** The single highest-leverage change in this
   document is not a call-site migration — it is making `language` impossible to forget. See the
   type-over-gate answer.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| `` `$${cost.toFixed(2)}` `` | The base case, and the most expensive. **22 of the 40 sites render a real sub-cent spend as `$0.00`.** `FactoryOverviewTab.tsx:284` uses `toFixed(0)`, so $0.49 of project spend reads as **`$0`**. The number is not merely ugly; it is wrong. |
| `$<Numeric value={cost} precision={4}/>` | **10 sites.** The primitive is imported and the currency semantics are still hand-rolled around it. `LlmTrackingCell.tsx:72` writes `precision={spend >= 1 ? 2 : 4}` — re-deriving `formatCost`'s `'auto'` ladder inline, at a different threshold. |
| `<Numeric value={n}/>` with no `language` | **206 of 215 sites.** Renders `1,234.56` in every one of the 14 languages. Silent, invisible in review, and the primitive's own docstring says to pass `i18n.language`. |
| `<Numeric value={c} unit="usd" precision={2}/>` | **9 sites.** `formatNumeric` hardcodes `precision: 'auto'` for `usd` and ignores the prop. The author stated a precision and got a different one, and the code reads as though they got what they asked for. |
| `{Math.round(x * 100)}%` | **78 sites.** Wrong in 5 of the 14 shipped languages — de/fr/cs want `42,5 %` (comma **and** a space before the sign); ar needs bidi marks. `formatPercent` gets all of that from Intl for free. |
| `` `${(n/1000).toFixed(1)}k` `` | **7 sites in 5 files.** Compact notation is not a suffix, it is a *locale-specific numbering system*: `1.2M` (en) · `1,2 Mio.` (de) · `123.5万` (zh) · `12.3 लाख` (hi). No concatenation reaches those. |
| `.toLocaleString()` with no argument | **10 number sites.** Takes the **operating system's** locale, so it disagrees with the language the user chose in the app — an en-US laptop shows `1,234` however the app is set. `ChartTooltip.tsx:18` does the same with `new Intl.NumberFormat(undefined, …)`. |
| `new Intl.NumberFormat(...)` at a call site | Bypasses the module-scope cache (`formatters.ts:71-91`), which exists because `AnimatedCounter` re-formats on every rAF tick. `BudgetRecoveryCard.tsx:34-35` constructs two per render. |
| A `format={(v) => …}` / `tickFormatter` callback with a raw `.toFixed()` | The class the lint rule was explicitly tuned to ignore as a "false positive" — and it is 100% display code. §7.B. |
| A local byte-size ladder | **10 files** hold an independent `KB`/`MB`/`GB` ladder, drifting on divisor spelling (`1024*1024` vs `1048576`), on precision (1dp vs 2dp), and on whether `GB` exists at all. There is no `bytes` unit to route them to — that is Gap 1, not laziness. |
| Rendering a duration/percent/count you did not measure the null case for | `formatCost(null)` at the default precision returns **`$0.00`** — "unknown" rendered as "free". At `precision: 4`/`'auto'` the same input returns `—`. One function, two answers, no test. |

---

## 6. Evidence

**The one site to copy: `src/features/overview/sub_activity/components/LlmCallsTable.tsx`.**
It is the only file in the repo that gets every step right at once, and it is also
[`i18n-string-authoring.md`](./i18n-string-authoring.md)'s exemplar — which is itself the finding
that the two leaves share a discipline:

- `:62` — `const { t, tx, language } = useTranslation()`, taking `language` **because it renders
  numbers**.
- `:235`, `:249` — `<Numeric value={e.input_tokens} unit="compact" language={language}
  align="right"/>` for token counts, so a 1.2M-token day is `1.2M` in en and `123.5万` in zh, with
  the exact figure on hover.
- `:263` — `<Numeric value={e.cost_usd} unit="usd" language={language} align="right"/>`, **guarded
  by `e.cost_usd > 0`** so a zero-cost row renders an em dash instead of `<$0.001`.
- `:269` — `t` and `language` are in the `useMemo` dependency array, so a language switch rebuilds
  the columns.

**For the locale-threaded table with a caveat:**
`src/features/overview/sub_observability/components/AthenaSpendSection.tsx:106-124` — `language` on
every `<Numeric>`, `unit="count"` and `unit="usd"` correctly chosen. It is included because its one
error is instructive: `precision={2}` at `:115` and `:136` is silently dropped by `formatNumeric`'s
`usd` branch, and nothing tells the author.

**For the money formatter itself:** `src/lib/utils/formatters.ts:102-136`. Read the
`precision: 2` branch and note the `if (usd < 0.01) return \`<${fmt(0.01, 2)}\`` line — that is the
sub-cent guard, and it is the whole reason `formatCost` beats `.toFixed(2)`. Then read the
`precision: 4` and `'auto'` branches and note that the same guard is written *without* the
`usd === 0` special case that precedes it at `:124`. That asymmetry is §7.C.

**For the `Intl` cache:** `formatters.ts:71-91`. The comment names the real cost (locale-data
resolution on a rAF hot path) and the cache key is exactly the option fields the app varies. This is
the right shape and it is why "just call `Intl` yourself" is wrong.

**For a locale-aware raw call, which is better than most `<Numeric>` sites:**
`AthenaUsageSection.tsx:110-111` — `Math.round(totals.inputTokens).toLocaleString(language)` and
`AthenaHealthPanel.tsx:38` — `const fmt = (n) => Math.round(n).toLocaleString(language)`. These
bypass the primitive and are *more* locale-correct than 96% of the sites that use it. Worth reading
precisely because it inverts the expected story.

**For the compact-with-title pairing:** `KpiTile.tsx:145-157` — `formatCompactNumber(v, {language})`
as the `formatFn` with the full-precision value as `title`. The only place in the app where an
animated figure is both abbreviated and recoverable.

---

## 7. Deviations found

### 7.0 Two of the brief's three hypotheses failed. Say so first.

**(a) The adoption hypothesis fails. `Numeric` is import-delivered and does NOT land in the
0.2–3.4% band.** [`design-token-usage.md` §7.A](./design-token-usage.md) measured every
import-delivered token in this repo at 0.2–3.4% adoption and every class-delivered token with a rule
at 94–99%. `Numeric` is import-delivered, it has a rule, and it measures:

Counted as *external* call sites — the formatters' own internal dispatch and the test files are
excluded, so nothing is double-counted through `formatNumeric`:

| Vocabulary | On-doctrine | Hand-rolled | Adoption |
| --- | ---: | ---: | ---: |
| Counts / grouping | `<Numeric>` `plain`+`count` 129, `formatCount` 4 | `.toLocaleString()` 13 | **91%** |
| Duration | `formatDuration` 50, `formatElapsed` 15, `<Numeric ms>` 6 | 28 `.toFixed` ladders | **72%** |
| Compact / abbreviation | `<Numeric compact>` 6, `formatCompactNumber` 2, `compactWithTitle` 1 | 7 in 5 files | **56%** |
| **Currency** | `<Numeric usd>` 32, `formatCost` 24 | `` `$${…}` `` 40, `$<Numeric>` 10, ad-hoc `Intl` 2 | **52%** |
| **Percent** | `<Numeric percent\|ratio>` 17, `formatPercent` 3 | **83** | **19%** |
| **Byte size** | — *(no `bytes` unit exists)* | 20 in 10 files | **0%** |

Overall the primitive-or-shared-formatter path carries **289 of 492 numeric renders — 59%.** That is
not the import-delivered band; it is an order of magnitude above it.

**The variable the token path attributed to *delivery format* is better explained by *a migration
campaign*.** `docs/refactor/shared-component-reuse.md:139-141` records that **~205 sites were
migrated across four subagent waves** in June 2026. `CARD_PADDING` never had one. So the honest
model is: *enforcement × a one-time sweep* predicts adoption, and delivery format is a smaller term
than the token path's data could separate. The token path's own counter-example supports this —
`typo-*` reached 99% here and 0% in `personas-web` with the identical artifact, which is an
enforcement difference, not a format difference.

**(b) The locale hypothesis holds, and is sharper than the brief states.** The brief predicted
"many numeric renders are locale-blind". Measured, the problem is not that renders *bypass*
`Numeric` — it is that **`Numeric` itself renders `en` by default and almost nobody overrides it**:

| | sites | pass a locale |
| --- | ---: | ---: |
| `<Numeric>` | 215 | **9** (3 files) |
| `<KpiTile>` | 32 | 12 |
| `<StatCard>` | 32 | 0 |
| `<AnimatedCounter>` | 17 | 0 |
| `<SpringCount>` | 2 | 0 |
| `<Stat>` | 62 | 0 |
| `formatCost()` | 24 | 4 |
| `formatPercent()` | 3 | **0** |
| Files calling `useTranslation()` | **1,505** | **20 destructure `language`** |

So `Numeric` **is** locale-*capable* — `formatCost`/`formatPercent`/`formatCount` all take a
`language` and all produce genuinely different output for it (verified by executing them across all
14 locales) — and it is **locale-blind in practice at 96% of its call sites**. The catalog line
"Canonical number/percent/count display — **locale** + precision + unit" is true of the primitive
and false of the app.

**(c) The cost hypothesis holds and is the most serious finding in the document.** §7.C.

### 7.A Every formatter is locale-capable; the default is `'en'` and the default is what ships

Executed against the real module. `formatCount(1234567.5, {language})`:

| en | de | fr / cs | hi |
| --- | --- | --- | --- |
| `1,234,567.5` | `1.234.567,5` | `1 234 567,5` | **`12,34,567.5`** |

`formatCost(1234.5, {language})`: `$1,234.50` (en) · `1.234,50 $` (de) · `1 234,50 $US` (fr) ·
`1 234,50 US$` (cs) · `US$1.234,50` (id) · `1.234,50 US$` (vi). **The symbol moves to the other end
of the string in six of the fourteen languages.** No `` `$${…}` `` can express that, and neither
can `$<Numeric/>`.

`formatCompactNumber(1234567, {language})`: `1.2M` (en) · `1,2 Mio.` (de) · `1,2 M` (fr) ·
`1,2 mil.` (cs) · `1.2 مليون` (ar) · `123.5万` (zh) · `123.5만` (ko) · `12.3 लाख` (hi). The Chinese,
Korean and Hindi forms are not translations of "M" — they are different *groupings* (万 = 10⁴,
लाख = 10⁵). A `/1000 + 'k'` ladder cannot approximate them.

`formatPercent(42.5, {language})`: `42.5%` (en) · `42,5 %` (de/fr/cs — note the space) ·
`42.5‎%‎` (ar, with bidi isolates).

All of this is available today, behind one parameter, and 20 files out of 1,505 pass it.

### 7.B The lint rule reports 5. The population is ~141. The rule was tuned to zero against a reclassified corpus.

`docs/refactor/shared-component-reuse.md:117` records the migration as
**"✅ Done 2026-06-19 — 0 across `src/features`, enforced (warn)."**
A full `npx eslint` run today measures **5** `custom/prefer-numeric` warnings, in 4 files. The rest
of the run reproduces `shared-facts.json` exactly (1,135 warnings, 0 errors, 246 of 4,829 files),
so the run is sound.

Measured population, from a classification of every one of the **212** non-comment, non-test
`.toFixed()` sites in **100 files** (plus 13 number `.toLocaleString()` sites):

| What the `.toFixed()` produces | matches |
| --- | ---: |
| currency | **39** |
| percent | **30** |
| duration | **28** |
| byte size | **20** |
| SVG path/points geometry — *legitimate, not a display number* | 33 |
| not inside any template (a computed value, a key, a comparison) | 28 |
| magnitude abbreviation (`k`/`M`) | 7 |
| multiplier (`×`, `σ`) | 7 |
| other display | 20 |

**~141 display-intent sites. The rule sees 5. Recall ≈ 3.5%.**

The cause is written in the rule's own source, and it is P6 exactly. `prefer-numeric.cjs:78-80`:

```js
let p = node.parent;
while (p) {
  if (p.type === 'CallExpression' || p.type === 'ArrowFunctionExpression' || p.type === 'FunctionExpression') return;
  …
```

**Any enclosing arrow function aborts the check.** So `` const COST_AXIS_FORMATTER = (v) => `$${v.toFixed(2)}` `` is invisible, and so is every `format={(v) => …}` on a `KpiTile`, every
`tickFormatter` on a chart, and every helper in a `.ts` file. The rule additionally returns on
JSXAttribute values and has no reach into `.ts` files at all (2,725 of the repo's 4,829 files).

The reclassification is documented as deliberate. `shared-component-reuse.md:139-141`:

> the true `Numeric` backlog was ~98 (not ~240; the rest were **dates**, SVG **coords/attr values**,
> and **formatter callbacks**)

Dates and SVG coordinates are correct exclusions — this sweep independently confirms 33 geometry
sites and the whole date family belong elsewhere. **"Formatter callbacks" is not.** A
`tickFormatter` renders on a chart axis; a `format={(v) => …}` renders inside a KPI tile. Those are
display sites by definition, and they are where the currency and percent formatting concentrated:
6 of the money sites and several of the percent sites are exactly this shape
(`AthenaUsageSection.tsx:16`, `LlmSpendSection.tsx:17`, `MetricsCharts.tsx:17` and `:18`,
`TrajectoryChart.tsx:10`, `ValueRollupSection.tsx:65`, `ExecutionMetricsDashboard.tsx:94`,
`ObservabilityDashboard.tsx:216` and `:218`, `DeploymentHealthSparkline.tsx:112`, four sliders in
`MediaStudioToolbar.tsx`).

And even at 5 warnings the rule enforces nothing: `npm run check` runs `eslint src/` with no
`--max-warnings` (`package.json:51`) and the pre-commit hook runs `--quiet --max-warnings 99999`
(`lefthook.yml:20`), where `--quiet` discards warnings before they can be counted. **A warn-level
rule enforces nothing at either gate, at any count.**

`personas-web` reached the same blindness by an unrelated route: its
`scripts/report-hardcoded-ui-strings.mjs` gates on `hasLetters(value)`, so a literal `%` or `$` can
never be reported. Two codebases, two mechanisms, one hole.

### 7.C Money — the highest-stakes finding, and it is a correctness bug in three places

**(i) 22 of the 40 `` `$${…}` `` sites render a real sub-cent spend as a displayed zero.** Measured
by extracting each interpolation and reading its precision and its guards. Three sites use
`toFixed(0)` and round to **whole dollars** — `FactoryOverviewTab.tsx:284` (per-project spend in the
Factory L2 overview), `islandStats.ts:67`, `statsMock.ts:23`. Nineteen use `toFixed(2)` with no
sub-cent guard, including every chart cost axis (`AthenaUsageSection.tsx:16`,
`LlmSpendSection.tsx:17`, `MetricsCharts.tsx:17`), the observability total-cost KPI tile
(`ObservabilityDashboard.tsx:216`) and the burn-rate alert copy (`personaHealthSlice.ts:222`). One
site — `MetricsCharts.tsx:18` — is `` (v) => `$${v}` ``, with **no precision at all**, so the raw
float reaches the axis. Four sites do it right and are the model:
`executionMetricsHelpers.ts:2` (`v < 0.01 ? '<$0.01' : …`), `QuickStatsBar.tsx:75`,
`comparisonHelpers.ts:31`, `islandStats.ts:67`.

**(ii) `formatCost` renders an exact zero as `"<$0.001"` at two of its three precisions.**
Executed, verbatim:

```
formatCost(0)                        "$0.00"      ← precision 2 has an explicit `usd === 0` guard
formatCost(0, {precision: 4})        "<$0.001"    ← it does not
formatCost(0, {precision: 'auto'})   "<$0.001"    ← nor does it
```

`formatters.ts:122` is `if (usd === 0) return fmt(0, 2);` and it sits **inside** the `precision === 2`
branch only. The `4` and `'auto'` branches open with `if (usd < 0.001) return '<$0.001'`, which a
zero satisfies. **`<Numeric unit="usd">` uses `'auto'`** (`formatters.ts:401`), so every one of its
**32** call sites renders "less than a tenth of a cent" for a run that cost nothing. Only **two**
call sites guard with `> 0` (`LlmCallsTable.tsx:263`, `GlobalExecutionList.tsx:466`); a third,
`TriggerExecutionHistory.tsx:75`, guards a different `<Numeric>`. **~29 sites are exposed**, and a
zero cost is the *normal* value for an execution that failed before its first model call.

**(iii) `formatCost(null)` returns `$0.00` at the default precision.** Unknown and free render
identically, which is P4. At `precision: 4`/`'auto'` the same input correctly returns `—`. One
function, two contradictory null policies, and no test distinguishes them because **`formatCost` is
never imported by `src/lib/utils/__tests__/formatters.test.ts`** — the money function is the only
one in the file with no `describe` block. It is exercised by exactly one indirect assertion,
`formatNumeric(1.5, 'usd') === '$1.50'`.

**(iv) Negatives are broken, and this one is latent — I looked for a live caller and did not find
one.** `formatCost(-12.3)` returns **`"<$0.01"`**, because `usd < 0.01` is true for every negative
number. At `'auto'` it returns `"<$0.001"`. A refund, a credit, a budget delta or a
cost-vs-baseline difference would render as "less than a cent" regardless of magnitude. **No current
call site passes a negative** — `AlertsPanel.tsx:57` renders a saving as a positive value with a
hand-welded `-` in front, and `fleetOptimizer.ts:198` computes its delta with a raw `.toFixed(2)`.
So this is a trap, not a live defect, and it is one signature change away from being live.
`personas-web` has the mirror-image bug: `format.ts:12` emits `$-0.0050` — the glyph on the wrong
side of the sign. Neither repo handles negative money; each is broken differently.

**(v) Money is a float everywhere, in all three repos.** `cost_usd REAL` in this repo's schema
(`incremental.rs:763,1453,5108,6380`), `number` in all **23** `cost_usd`-bearing ts-rs bindings,
`REAL` in `personas-cloud` (`db.ts:246,362,412`), plain `number` in `personas-web`. **No repo stores
money as an integer minor unit:** `cents` matches zero times in `personas-web` and
`personas-cloud`, and its only two appearances here are a comment and — pointedly — a connector
doc-string telling the reader that *Ramp's* API returns minor units and you must divide by 100
(`builtin_connectors.rs:1517`). For per-call LLM costs at $0.000003/token float is defensible; it is
recorded because it is the constraint that makes the sub-cent question load-bearing rather than
academic.

**(vi) Six money vocabularies coexist.** `<Numeric unit="usd">` (32) · `formatCost` (25) ·
`` `$${…}` `` (40) · `$<Numeric/>` (10) · a hand-built `Intl` currency formatter
(`BudgetRecoveryCard.tsx:34`, correctly locale-bound; `ChartTooltip.tsx:18`, bound to the host
locale) · and cents (`personaStats.ts:183` — `` `${(budget*100).toFixed(0)}¢` ``, the only `¢` in
the repo). Plus one non-USD path: `InkWallCell.tsx:123` renders
`` `${value.total} ${value.currency}` `` — **completely unformatted** — for any currency that is not
USD.

### 7.D `precision` is silently dropped for three of the eight units

`formatNumeric` (`formatters.ts:389-414`) destructures `precision` and then does not forward it:

```ts
case 'ms':  return formatDuration(value, { unit: 'ms' });   // drops precision AND language
case 's':   return formatDuration(value, { unit: 's'  });   // drops precision AND language
case 'usd': return formatCost(value, { precision: 'auto', language });  // hardcodes precision
```

**Nine `<Numeric unit="usd">` sites pass a `precision` that never arrives** —
`ActiveChainsBadge.tsx:104` (2), `ExecutionSummaryCard.tsx:129` (4),
`LabEconomicsPanel.tsx:78` (3), `RunDetailView.tsx:84` (2), `AthenaSpendSection.tsx:115,136` (2),
`PolicyProposalsSection.tsx:198` (4), `FactoryObservabilityTab.tsx:116,127` (2). That is **28% of
all money renders through the primitive**. The prop is typed, the call compiles, the value is
discarded. No `ms`/`s` site currently passes either option, so that half is latent.

`formatDuration` is also the one formatter with **no `language` parameter at all** — its output
(`4s`, `2m 30s`, `1h 5m`) is English-suffixed by construction, and its `'decimal'` mode uses a raw
`.toFixed(1)` internally, so `1.5s` never becomes `1,5 s`.

### 7.E Percent is the worst-adopted vocabulary, and there are five of it

**83 sites in 57 files** paste a `%` after a locally-rounded number, against **22** that route
through `formatPercent` or `<Numeric unit="percent"|"ratio">`. Five idioms in flight:

| idiom | example |
| --- | --- |
| `{Math.round(x * 100)}%` | `ExecutionMiniPlayer.tsx:74`, `ClusterPatternsModal.tsx:149`, ×40 more |
| `` `${(x * 100).toFixed(0)}%` `` | `AnomalyScorePanel.tsx:19`, `useRemediationEvaluator.ts:189` |
| `` `${x.toFixed(1)}%` `` on a pre-scaled magnitude | `KpiTile.tsx:178`, `leaderboardScoring.ts:155` |
| `` `${sign}${v.toFixed(0)}%` `` — sign hand-welded | `comparisonHelpers.ts:19` |
| `` (v) => `${v.toFixed(0)}%` `` as a chart/tile formatter | `ValueRollupSection.tsx:65`, `DeploymentHealthSparkline.tsx:112` |

Four files define their own `const pct = (v) => …` helper independently
(`HealingEffectivenessPanel.tsx:60`, `SkillScoreboard.tsx:108`, `AnomalyScorePanel.tsx:19`,
`useRemediationEvaluator.ts:189`), each with a different precision. `personas-web` has the identical
fragmentation at its own scale: 30 visible percent sites across 5 idioms, `Intl` percent style used
**zero** times.

### 7.F The number layer emits English words

Six helpers in `formatters.ts` return strings containing English prose, from a module the i18n
system cannot reach:

| helper | external call sites | output |
| --- | ---: | --- |
| `formatRelativeTime` (`:22`) | **65 in 51 files** | `just now` · `5s ago` · `3m ago` · `2h ago` · `4d ago` |
| `timeAgo` (`:54`) | 8 in 5 files | `Never` |
| `formatSignedOffset` (`:63`) | 1 | `2m before` / `1.5h after` |
| `formatInterval` (`:223`) | 7 in 6 files | `1 hour 1 minute` · `2 hours 30 minutes` (with hand-rolled `s` pluralisation) |
| `formatDuration` / `formatElapsed` / `formatCountdown` (`:444` / `:254` / `:234`) | 50 + 15 + 1 | `4s` · `2m 30s` · `1h 5m` |
| `formatSimpleStatus` (`:425`) | — | routes to `SIMPLE_MODE.STATUS.*.label` — English constants |

**`formatRelativeTime` alone is 65 call sites in 51 files rendering `2h ago` in all fourteen
languages** — a larger untranslated surface than most single features. These are this path's
primitive producing
[`i18n-string-authoring.md`](./i18n-string-authoring.md)'s **C2** condition (copy authored in a
module with no render context), and neither path's gate can see them: `frozen-ui-copy-constant`
keys on `label:`/`description:`/`hint:` properties, and these are `return` values. `en.json` has a
`common.time` section and none of these strings are in it. The plural rule
(`` `${hours} hour${hours !== 1 ? 's' : ''}` ``) is English-only pluralisation hand-rolled in a
codebase that ships an ICU-shaped `_one`/`_other` catalog with 19,112 keys.

### 7.G Four display primitives, four different locale policies

All four live in or beside `src/features/shared/components/display/`, and a single table row can
render all four:

| Primitive | Where the locale comes from | Result |
| --- | --- | --- |
| `Numeric` | optional `language` prop, **defaults to `'en'`** | `1,234.56` for everyone unless threaded (9/215 threaded) |
| `AbsoluteTime` (`:50`) | `new Intl.DateTimeFormat(undefined, …)` — the **host OS** | `24.05.26` on a German OS even in the English app |
| `RelativeTime` (`:35`) | none — hardcoded English in `formatRelativeTime` | `2h ago` in all 14 languages |
| `useFormattedDate` (`:36`) | optional `locale` param, defaults to the **host** | a fifth policy for the same question |

A row showing "created 2h ago · 24.05.26 · $1,234.50" is simultaneously English, German and en-US.
Each primitive is internally consistent, so no gate keyed on any one of them can see it. This is P7.

### 7.H Byte sizes — ten independent ladders and no primitive to route them to

`LogDiskUsageSection.tsx:11`, `artist/utils/format.ts:3`, `FleetProcessRow.tsx:8`,
`CloudSyncPanel.tsx:32`, `BundleExportDialog.tsx:526`, `StorageUsageSection.tsx:12`,
`n8nUploadTypes.ts:18`, `documentTabHelpers.ts:8`, `PreviewResults.tsx`, `freezeWatchdog.ts`. They
disagree on the divisor spelling (`1024 * 1024` vs `1048576`), on precision (1dp vs 2dp at the GB
step), and on whether a GB step exists at all — `BundleExportDialog` and `n8nUploadTypes` stop at
MB, so a 3 GB export reads as `3072.0 MB`. `NumericUnit` has no `bytes` member. **This is a genuine
gap, not laziness** (Gap 1); a census rule here would ratchet 20 sites toward a destination that
does not exist.

### 7.I The tests are 117 lines and never leave `en`

`formatters.test.ts` covers `formatPercent`, `formatCount`, `formatCompactNumber`,
`compactWithTitle` and `formatNumeric` — **23 assertions, none of which passes a `language`.**
`Numeric.test.tsx` has 9 tests and passes no `language` either. So the entire locale contract of the
numeric layer — the thing this document says is its point — is untested, and `formatCost`, the only
function that renders real money, has no suite at all. `personas-web` is in the same position: one
formatting test file (`slaFormat.test.ts`), and **no test asserts on money anywhere.**

---

## 8. Gaps in the primitives

1. **There is no `bytes` unit, and byte size is the one vocabulary at 0% adoption.** Ten independent
   ladders exist because there is nowhere to send them. **Fix:** add `'bytes'` to `NumericUnit` and
   a `formatBytes(n, { language, binary })` that routes through `Intl.NumberFormat` with
   `style: 'unit'` (which handles `unit: 'megabyte'` and its locale plurals). Then §7.H becomes a
   mechanical migration and gateable; today it is neither.
2. **`formatNumeric` drops `precision` for `usd`/`ms`/`s` and drops `language` for `ms`/`s`.**
   Nine live call sites are affected (§7.D). **Fix:** forward the options —
   `case 'usd': return formatCost(value, { precision: precision ?? 'auto', language })` — and give
   `formatDuration` a `language` parameter. This is a four-line change and it removes an entire
   anti-pattern row.
3. **`formatCost`'s zero/null/negative handling is three different policies in one function.**
   `0` → `$0.00` at precision 2 but `<$0.001` at 4 and `'auto'`; `null` → `$0.00` at precision 2 but
   `—` at 4 and `'auto'`; any negative → `<$0.01`. **Fix:** hoist the `usd === 0` guard above the
   precision switch, make `null` return `—` uniformly, and apply the sub-unit comparison to
   `Math.abs(usd)` with the sign restored by `Intl` (`signDisplay: 'auto'` already does this — the
   guard is what bypasses it). Then delete the `> 0` guards the two correct call sites carry, since
   the primitive would own the case.
4. **`Numeric`'s `language` prop is optional and defaults to `'en'`.** This is the root of §7.A and
   it is Gap 2's bigger sibling — see the type-over-gate answer, which argues this is the single
   highest-leverage change in the document. The obstacle is real and worth naming: `Numeric` lives
   in `shared/components/`, which by convention does not import `@/stores`
   ([`CLAUDE.md`](../../../.claude/CLAUDE.md) § "Reusing shared components"), so it cannot read
   `useI18nStore` the way `getActiveTranslations()` (`useTranslation.ts:310`) does. **The
   boundary rule is what makes the locale a prop, and the prop is what makes it forgotten.**
5. **Nothing tests that a language switch re-renders a number.** No test asserts that a `useMemo`
   building formatted columns rebuilds when `language` changes. `LlmCallsTable.tsx:269` gets it
   right; a file that omits `language` from its dependency array is correct on first paint and
   stale afterwards, and is indistinguishable from a correct file by every gate here.
6. **`AnimatedCounter`'s default formatter has no grouping in any locale.**
   `defaultFormat = (v) => String(Math.round(v))` (`AnimatedCounter.tsx:35`). Seventeen call sites,
   zero passing `language`. **Fix:** default to `formatCount`, or require `formatFn`.
7. **The number layer owns English prose it cannot translate** (§7.F). **Fix:** move the six
   English-emitting helpers' unit words into `en.json` under a `common.units` section and give each
   helper a `t`/`language` parameter — or, cheaper and more correct, replace `formatRelativeTime`'s
   ladder with `Intl.RelativeTimeFormat`, which is exactly this problem solved in the platform and
   is used **zero** times in any of the three repos.

---

## 9. The missing gate

**Manifestation layer.** Per [`golden-path-contract.md:34-60`](../golden-path-contract.md), what
follows is a *proxy* for a semantic condition, tuned to this repo's idiom. The conditions are stated
first so an adopting repo re-derives its own proxy. The risk is concrete and measured here: the
sibling that reinvented the `` `$${…}` `` idiom eleven times has **zero** `Intl.NumberFormat`, so a
signal keyed on "bypassed the Intl layer" would score zero there while the condition is universal;
and several of its percent renders are `{pct}%` on a pre-scaled integer, which the percent proxy
below does **not** match.

Everything in §7 shipped under a green `npm run check`, a green CI, and a documentation table that
records this migration as complete.

### Semantic conditions, stated stack-free

- **C1 — a monetary amount is composed at the call site from a hardcoded currency glyph plus a
  number the author rounded, so the rounding contract is re-decided per site, the glyph cannot move
  to the position the locale requires, and no other currency can ever be represented.** *Proxy
  here:* a literal `$` immediately followed by an interpolation, or by the shared numeric primitive.
  *Precondition:* this repo denominates everything in USD, stores it as a float, and spells a money
  render as a template literal opening with `$`.
- **C2 — a percentage is composed at the call site rather than requested from the number layer, so
  the decimal separator, the grouping and the spacing before the sign are frozen to one locale.**
  *Proxy here:* a `.toFixed()`/`Math.round()` closed by a literal `%`, excluding CSS lengths.
  *Precondition:* this repo writes both display percentages and layout percentages as template
  interpolation followed by an ASCII `%`, which is why the exclusion is spelled in CSS property
  names.

### Conditions deliberately NOT given a census rule

- **C3 — a numeric render that hardcodes one locale's conventions (206 of 215 `<Numeric>` sites).**
  This is the largest population in the document and it must **not** be gated. The legal fix at the
  call site is "thread `language` through 206 sites", and **the correct fix is one change to the
  primitive** (Gap 4 / the type-over-gate answer). A ratchet here would spend the gate's authority
  driving 206 edits that the right fix makes unnecessary — the same sequencing
  [`design-token-usage.md` C3](./design-token-usage.md#9-the-missing-gate) applied to
  `untokenized-primitive-radius`, for the same reason. **Gate it, if at all, only if the primitive
  change is rejected.**
- **C4 — a byte size formatted by a local ladder (20 sites / 10 files).** Blocked on Gap 1: there is
  no `bytes` unit to migrate to. Publish the unit first, then gate. Ratcheting toward a destination
  that does not exist is how a gate teaches people to add exemptions.
- **C5 — `precision` passed where `formatNumeric` discards it (9 sites).** A census rule would work
  and be 100% precise, but the condition is a **four-line bug in the dispatcher** (Gap 2), not a
  call-site habit. Fix the dispatcher; the 9 sites become correct without being touched.
- **C6 — `.toFixed()` in a display path, generally (~141 sites).** A rule already exists
  (`custom/prefer-numeric`) and this document's contribution is the measurement that it has ~3.5%
  recall (§7.B). **The right fix is an ESLint change, not a second counter:** delete the
  `ArrowFunctionExpression`/`FunctionExpression` abort at `prefer-numeric.cjs:80` and replace it
  with a check that the arrow is *not* itself passed to a `format*`/`tickFormatter` prop — which
  needs AST and `RuleTester` fixtures, ESLint's job and not the census's. C1 and C2 below carve out
  the two highest-value slices of this population in the meantime; a third counter for the whole
  thing would be a duplicate.
- **C7 — a duration or relative time rendered in hardcoded English.** Genuinely a defect (§7.F) and
  genuinely owned by [`i18n-string-authoring.md`](./i18n-string-authoring.md)'s C2 condition, whose
  `frozen-ui-copy-constant` rule already exists. It misses these because they are `return` values
  rather than `label:` properties — recorded here so the next composer widens *that* rule rather
  than adding a third one.
- **C8 — a `useMemo` building formatted values without `language` in its deps** (Gap 5). Not
  regex-shaped; it requires knowing what the memo body closes over. `react-hooks/exhaustive-deps`
  already sees this class and reports 9 warnings repo-wide.

### The rules — validated

Both were run against the working tree with
`node scripts/census/run-census.mjs --rules <scratch-file> --check` → **exit 0**, and both counts
were reproduced by an **independent second implementation** (a separate walker with its own line
indexer and its own comment filter, written without importing `lib/engine.mjs`) before baselining:
`hand-assembled-currency` 39 files / 50 matches by both; `locale-blind-percent` 57 files / 83
matches by both before the harness exclusion, 55 / 78 after. Every match of both rules was then read
individually: **50/50** and **78/78** are genuine instances of the stated condition.

```json
{
  "rules": [
    {
      "id": "hand-assembled-currency",
      "goldenPath": "docs/concepts/golden-paths/number-and-cost-formatting.md",
      "title": "A money amount assembled by welding a currency glyph onto a separately-formatted number",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "\\$\\$\\{|\\$\\s*<Numeric\\b",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a literal `$` glyph immediately followed by an interpolation (`` `$${x.toFixed(2)}` ``) or by the shared <Numeric> primitive (`$<Numeric value={x} precision={4}/>`). PROXY FOR the stack-free condition: a monetary amount is composed at the call site out of a hard-coded currency glyph plus a number that was rounded by whoever wrote that line, so (a) the rounding contract is re-decided per call site, (b) the glyph cannot move to the position the locale requires, and (c) no currency other than USD can ever be represented. Precision measured 50/50 on a full read of every match: every one is a real money render, zero test-fixture or non-money hits. Two of the 50 are non-UI destinations (analyticsMiddleware.ts:33 writes a Sentry breadcrumb; knowledgeMiddleware.ts:33 builds an LLM prompt) and are left in deliberately — the rounding argument applies to them too and excluding two lines would cost more than it buys. Measured consequences in this repo: of the 40 `$${…}` sites, 22 round a sub-cent amount to a displayed `$0.00` (or `$0` at toFixed(0)) — FactoryOverviewTab.tsx:284 renders per-project spend at toFixed(0), so $0.49 of real spend reads as `$0`; and the 5 distinct precisions in flight (0,1,2,3,4 decimals) mean the same cost_usd field renders differently on two screens. The 10 `$<Numeric …>` sites are the sharper shape: the primitive IS imported, and the caller still hand-rolls the currency semantics around it (LlmTrackingCell.tsx:72 re-derives formatCost's 'auto' precision inline as `precision={spend >= 1 ? 2 : 4}`). PRECONDITION (measured, must be re-derived per repo): this repo denominates all money in USD, stores it as a float, and spells a currency render as a template literal starting with `$`. A repo that formats through Intl currency style, or uses a non-`$` symbol, or stores integer cents, scores zero while the condition is present — and the sibling personas-web, which has the identical idiom 11 times, ALSO has 0 `Intl.NumberFormat`, so the condition is convergent while this exact proxy is not portable to a repo that had adopted Intl. LEGAL FIX: `formatCost(usd, { language })` from @/lib/utils/formatters, or `<Numeric value={usd} unit=\"usd\" language={language} />` — both emit the currency glyph through Intl, so it lands where the locale puts it (`$1,234.50` en / `1.234,50 $` de / `US$1.234,50` id), and both carry the `<$0.01` sub-cent guard the hand-rolled sites lack."
      },
      "baseline": { "files": 39, "matches": 50 },
      "floor": 4000
    },
    {
      "id": "locale-blind-percent",
      "goldenPath": "docs/concepts/golden-paths/number-and-cost-formatting.md",
      "title": "A percentage assembled by pasting a % glyph after a locally-rounded number",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "(?<!(?:width|height|left|right|top|bottom|inset|maxWidth|minWidth|flexBasis|strokeDasharray|translate|offset)\\s*:\\s*[`'\"]?[^;`'\"]{0,50})(?:\\.toFixed\\(\\s*\\d*\\s*\\)|Math\\.round\\((?:[^()]|\\([^()]*\\))*\\))\\s*\\}\\s*%",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a number rounded in place with .toFixed()/Math.round() and closed with a literal `%` glyph. PROXY FOR the stack-free condition: a percentage is composed at the call site rather than requested from the number layer, so the decimal separator, the digit grouping and the spacing between the figure and the percent sign are all frozen to one locale's convention. Concretely wrong in 5 of this app's 14 shipped languages: Intl renders `42.5%` for en but `42,5 %` for de/fr/cs (comma decimal AND a no-break space before the sign) and wraps the sign in bidi marks for ar. The negative lookbehind removes the large CSS-geometry false-positive class — `style={{ width: `${Math.round(x*100)}%` }}` is a layout percentage, not a display number, and there are ~195 of those; verified discriminating against ModelABCompare.tsx:217, PersonaCoachingTable.tsx:201, HealingEffectivenessPanel.tsx:106 and SkillContextsModal.tsx:68, all of which the pattern correctly declines. Precision after the lookbehind and the harness exclusion, on a full read of all 78 matches: 78/78 are user-visible percentages (they include chart labels, aria-labels, zoom/volume chrome and generated markdown reports — all rendered, none internal arithmetic). PRECONDITION (measured, must be re-derived per repo): this repo writes percentages as template-literal interpolation followed by an ASCII `%`, and expresses layout percentages the same way, which is why the exclusion list is spelled in CSS property names. A repo that renders `<Percent value/>`, or that uses styled-components/`clsx` arbitrary values, or that formats through Intl percent style, must re-derive. Sibling evidence that the CONDITION is universal and the SHAPE is not: personas-web has 30 user-visible percent sites across 5 different idioms and 0 uses of Intl percent style, but several are `{pct}%` on a pre-scaled integer, which this pattern does NOT match. LEGAL FIX: `formatPercent(value, { language })` (pass `fromRatio: true` for a 0-1 ratio) or `<Numeric value={v} unit=\"percent\"|\"ratio\" language={language} />`, both of which route through Intl percent style and get the separator, the spacing and the bidi marks right for free."
      },
      "exclude": [
        {
          "path": "src/lib/harness/**",
          "reason": "the UAT / test-automation harness — its progress and pass-rate percentages are read by the harness author in a run report, never rendered in the product UI, and the same carve-out is already precedent in i18n-string-authoring's frozen-ui-copy-constant rule"
        }
      ],
      "baseline": { "files": 55, "matches": 78 },
      "floor": 4000
    }
  ]
}
```

**Measured result:**

```
  rule                    files   base  matches   base  walked  floor
  OK   hand-assembled-currency     39     39       50     50    4829   4000
  OK   locale-blind-percent        55     55       78     78    4829   4000
  census OK — 2 rule(s), 9658 file-visits, 128 surviving violation(s) across 94 file(s).
```

Floors sit below the observed walk (4,829 `.ts`+`.tsx` under `src`) with margin, consistent with the
existing `raw-select`, `raw-web-storage` and `hand-rolled-disabled-state` rules that walk the same
tree.

**A note on the engine caveat.** Both patterns are single-line by construction — `\$\$\{` cannot
cross a newline, and the percent pattern's `[^;`'"]{0,50}` lookbehind and `\}\s*%` body cannot
either — so the comment-skip rewind (`engine.mjs:210`) has no multiline extent to eat. That was
checked rather than assumed: the independent implementation reproduces both counts exactly,
including the comment-skipped ones.

### How each fails loudly if its own precondition is absent

Not asserted — **executed.** Every failure mode was induced against the real working tree and the
exit code captured:

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified) | **0** | `census OK — 2 rule(s), 9658 file-visits, 128 surviving violation(s)` |
| R1 `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere. A census rule that finds nothing is a broken regex far more often than a finished migration.` |
| R1 `floor` → 9000 | **1** | `[structural] walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| R1 baseline inflated (a silent drop) | **1** | `[drift] files dropped 120 -> 39 (-81) without the baseline moving.` |
| R1 baseline deflated (a rise) | **1** | `[drift] files rose 20 -> 39 (+19). New violations of …number-and-cost-formatting.md` |
| R1 `roots` renamed away | **1** | `[structural] walked 0 files but floor is 4000` |
| R1 `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 4000` |
| **R1 POSITIVE CONTROL — pattern → the COMPLIANT form** | **1** | `[drift] files rose 39 -> 41 (+2)` — see below |
| R2 `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere.` |
| R2 `floor` → 9000 | **1** | `[structural] walked 4829 files but floor is 9000.` |
| R2 baseline inflated (a silent drop) | **1** | `[drift] files dropped 300 -> 55 (-245) without the baseline moving.` |
| R2 baseline deflated (a rise) | **1** | `[drift] files rose 30 -> 55 (+25).` |
| R2 `exclude` path renamed | **1** | `[structural] exclude "src/lib/harnessMOVED/**" matched no file. The exemption is stale` |
| R2 `exclude` `reason` removed | **1** | `exclude[0] ("src/lib/harness/**") needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| R2 `roots` renamed away | **1** | `[structural] walked 0 files but floor is 4000` |
| **R2 POSITIVE CONTROL — pattern → the COMPLIANT form** | **1** | `[drift] files dropped 55 -> 21 (-34)` — see below |
| R2 lookbehind removed (CSS geometry re-admitted) | **1** | `[drift] files rose 55 -> 58 (+3)` — the exclusion is load-bearing, not decorative |

**The positive control — proving the matcher discriminates rather than merely matches.** A rule that
fires on everything money-shaped would be worthless, and every fault above only proves the rule can
*break*. So each pattern was **inverted to the compliant spelling** and re-run against the same
baseline. Both fail, and the file sets are nearly disjoint:

| | violating pattern | compliant pattern | files matching **both** |
| --- | --- | --- | ---: |
| R1 | `$${…}` / `$<Numeric` → **39 files / 50 matches** | `formatCost(` / `<Numeric … unit="usd">` → **41 files / 61 matches** | **1** |
| R2 | rounded `}%` → **57 files / 83 matches** | `formatPercent(` / `<Numeric … unit="percent"\|"ratio">` → **21 files / 34 matches** | **3** |

R1's compliant form matches a *similar number of files* and almost none of the *same* files, which
is the strongest available demonstration: the two spellings are equally common in this codebase and
the matcher separates them cleanly. Under the census the substitution produces `[drift] files rose
39 -> 41` and `[drift] files dropped 55 -> 21` — **exit 1 in both directions**, so the gate cannot
be satisfied by pointing it at the right answer. (The four overlap files —
`ByomAuditLog.tsx`, `TrendIndicator.tsx`, `slaHelpers.ts`, `AnomalyScorePanel.tsx` — are files that
genuinely contain both a correct and an incorrect render, which is itself worth knowing.)

### Sequencing

1. **Fix `formatCost`'s zero/null/negative handling (Gap 3) before anything else.** It is a
   correctness bug in a money function, it is ~15 lines, and it is what makes `<Numeric unit="usd">`
   a safe destination for the 40 sites the census rule is about to point at. Add the `describe`
   block the file is missing while you are there.
2. **Forward `precision` and `language` in `formatNumeric` (Gap 2).** Four lines; retires 9 live
   deviations and one whole anti-pattern row without touching a call site.
3. **Make `Numeric` locale-correct by default (Gap 4 / the type answer).** This closes 206 of the
   215 sites in one edit and removes C3 from the backlog permanently. Sequence it here, before the
   census rules land, so the money migration in step 4 lands on a primitive that is already right.
4. **`hand-assembled-currency` immediately after steps 1–3.** 50 sites, one legal fix, a real
   destination, and the 22 sub-cent-to-zero renders are the highest-value correctness win in the
   document.
5. **`locale-blind-percent` immediately.** 78 sites, one legal fix (`formatPercent` /
   `<Numeric unit="percent">`), no precondition. Start with the four independent `const pct = …`
   helpers, which cover 4 files at one line each.
6. **Publish `formatBytes` + a `bytes` unit (Gap 1), then gate C4.** Ten ladders collapse to one.
7. **Widen `custom/prefer-numeric` (C6).** Replace the blanket arrow-function abort with a check for
   formatter-callback context. Do it *after* steps 4–5 so the count does not jump while the backlog
   is being burned.
8. **Move the six English-emitting helpers' unit words into the catalog, or adopt
   `Intl.RelativeTimeFormat` (Gap 7).** Coordinate with
   [`i18n-string-authoring.md`](./i18n-string-authoring.md) — it is that path's condition wearing
   this path's clothes.

---

## Type over gate — the answer

**Yes, decisively, and it is the highest-leverage finding in this document — but the type that
closes it is blocked by a different convention, which is why nobody has written it.**

**1. The largest deviation class is a default value, not a habit.** 206 of 215 `<Numeric>` renders
hardcode en-US, and the reason is one line:

```ts
/** BCP-47 locale for separators (default `'en'`). Pass `i18n.language` for locale-aware grouping. */
language?: string;
```

An optional prop with a silent default is the exact shape [the contract's *Prefer a type over a
gate*](../golden-path-contract.md#prefer-a-type-over-a-gate--checked-three-times) names:
`FacetedDecisionTable` makes `emptyTitle` **required** and gets 3/3 real copy where its
optional-prop siblings fall through to `"No data"` 5 times in 20. Here the ratio is **9 in 215**.
Two options, both making the wrong call unrepresentable:

```ts
// (a) required — a compile error at 206 sites, each fixed by one identifier
interface NumericProps { value?: number | null; language: string; … }

// (b) sourced — the primitive reads the active language itself, and the prop becomes an override
const active = useI18nStore((s) => s.language);
const content = children ?? formatNumeric(value, unit, { precision, language: language ?? active });
```

**(b) is the right answer and it fixes 206 sites in one edit.** The machinery already exists:
`getActiveTranslations()` (`useTranslation.ts:310`) does exactly this — `useI18nStore.getState()` —
for the string half of the problem.

**2. What blocks (b) is a different convention, and naming it is the point.** `Numeric` lives in
`src/features/shared/components/`, which
[`CLAUDE.md`](../../../.claude/CLAUDE.md) declares primitives-only: it should not import from
`@/stores`, and an advisory ESLint rule warns when it does. **That boundary rule is what forced the
locale to be a prop, and the prop is what made it forgotten.** So the deviation is not a discipline
failure — it is a boundary decision with an unpriced consequence, and this document is the price.
Three ways out, in order of preference:

- **A `NumericLocaleProvider` React context** set once in the app shell. Context is not a store
  import, so the boundary holds, the primitive gets a real default, and the prop stays as an
  override. This also gives `AbsoluteTime`, `RelativeTime` and `useFormattedDate` somewhere to agree
  (§7.G, P7) — one provider, four primitives, one locale policy.
- **Move `Numeric` to `src/features/shared/chrome/`**, the documented home for shared components
  that need app state. Honest, but it loses the catalog entry.
- **Accept the store import in this one primitive with a written reason.** The boundary is advisory,
  not enforced.

**3. A second type change closes the money class.** `formatNumeric` ignores `precision` for three of
its eight units (§7.D) because the option bag is one flat shape for units with incompatible
options. A discriminated union makes the discarded argument a compile error:

```ts
type NumericSpec =
  | { unit: 'usd';               precision?: 2 | 4 | 'auto' }
  | { unit: 'percent' | 'ratio'; precision?: number }
  | { unit: 'ms' | 's';          precision?: 'integer' | 'decimal' }
  | { unit?: 'count' | 'plain' | 'compact'; precision?: number };
```

Today `<Numeric unit="usd" precision={2}/>` compiles and is ignored at 9 sites. Under the union it
either works or does not compile — and the `'integer' | 'decimal'` arm surfaces the fact that
duration precision is a *different kind of thing*, which is currently invisible.

**4. Where no type can reach, and this is the leaf's real finding.** `` `$${cost.toFixed(2)}` ``
and `{Math.round(x * 100)}%` type-check perfectly. `.toFixed` returns `string`, template literals
accept `string`, and the result is rendered as a `ReactNode`. **The type system cannot distinguish a
number that has been formatted from a number that has been mangled, because both are `string`.**
The structural equivalent of a type here is a **branded return type** —
`formatCost(): FormattedNumber` where `type FormattedNumber = string & { __formatted: true }`, with
`Numeric`'s `children` typed to accept only `FormattedNumber | ReactElement` — which would make
`<Numeric>{`$${x.toFixed(2)}`}</Numeric>` a compile error while leaving the raw string usable
everywhere else. That is a real option and it is more invasive than it is worth for 26
children-mode call sites; it is recorded because it is the only construction that reaches the
dominant class, and because the census rules in §9 are precisely the admission that it was not
taken.

**5. The general rule, and it is the third variation on the same theme.**
[`design-token-usage.md`](./design-token-usage.md) found that the token vocabulary was open strings
and the fix was to **close it**. [`i18n-string-authoring.md`](./i18n-string-authoring.md) found the
vocabulary already closed by codegen, so the leverage was in making **every place copy can be
written accept a key instead of a string**. Here the vocabulary is a *format*, which cannot be
enumerated at all — so:

> **Make the correct rendering the one that requires no argument.** Every deviation in this
> document is a place where getting it right meant remembering to supply something — a `language`,
> a sub-cent guard, a `unit` — and getting it wrong meant supplying nothing. The primitive that
> reads its own locale, guards its own zero and owns its own glyph has no wrong call to make.
