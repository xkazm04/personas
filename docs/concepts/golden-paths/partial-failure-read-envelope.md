# Golden path — Partial-failure read envelope

> Situation node: `client-runtime/data-fetching/partial-failure-read-envelope` ·
> [situation spine](../situation-spine.md) · recurrence 10 · risk **HIGH** ·
> sides: **client** (spine also carries `twoSided: true` — see §12.1) · convergence: **diverged** ·
> dimensions: **resilience · function · ui**
> Composed 2026-08-16 against `master` @ `629a914af`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` files under `src/`. Every `Promise.all` /
> `allSettled` / `race` / `any` call site — **179** — had its first argument extracted with a
> **balanced-paren parser over comment-and-string-blanked source**, then classified as a literal
> tuple, a collection fan-out, or a variable. Every `.catch(` in the tree — **825** — had its
> handler parsed and classified by *what it resolves to*. `useStatusPageData.ts`,
> `compositeHealthScore.ts`, `StatusPageView.tsx`, `useExecutionDashboardPipeline.ts`,
> `overviewSlice.ts`, `findings/sweep.ts`, `findings/verify.ts`, `sessionDelta.ts`,
> `useMorningBriefing.ts`, `useDirector.ts`, `CampaignReportPanel.tsx`, `useChainTrace.ts`,
> `ChainTraceView.tsx`, `UnifiedTable.tsx`, `ScenarioEmptyState.tsx` and `StalenessIndicator.tsx`
> read in full.
>
> **Measured by execution, not by reading.** The Status page's global health aggregate was
> **replayed end to end** against a read-only **copy** of the operator's live `personas.db`
> (347 MB, copied 2026-08-16 11:16 UTC; the app was running — `engine-leader.lock` was live — and
> the file was never opened for write). `get_sla_dashboard`'s SQL
> (`db/src/repos/communication/sla.rs:332-490`) and `computeCompositeHealth` +
> `computeGlobalScore`/`computeGlobalUptime` were transcribed **verbatim** into one script and run
> over 78 real personas / 59 real SLA rows / 205 real healing rows (179 open), under four
> source-failure scenarios. §0 publishes the number the user would see beside the number that is
> true. **One instrument caveat, stated rather than buried:** the literal 30-days-from-*now* window
> is empty on this install (last recorded execution `2026-06-26`), so the replay anchored the window at
> `MAX(created_at) − 30 days` to exercise real data instead of an empty set. That shifts *which*
> rows are in scope; it does not touch the defect, which is structural in `computeGlobalScore` and
> reproduces at any window size including an empty one.
>
> **The backend contract was swept too**, despite the leaf's `sides: client` (§12.1): all **963**
> `.rs` files across `src-tauri/{src,db,core,engine}` — the four are sibling *crates*, so a sweep
> scoped to `src/` alone misses 389 of them. All **192** commands that assemble a response from 2+
> independent sources were classified by what happens to source 2's failure.
> **`cargo` was not run.** Every Rust claim is static and traces to a file read during composition.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It confirmed the central defect as **physics
> across three repos**, produced one clause that had to be corrected *against* it (§12.3), and
> changed §2, §3 and §9.
>
> **Settles:** what the caller receives when 5 of 8 sources answered, what the user sees, and which
> of those two questions the type can answer.

---

## 0. The headline

**When one of the Status page's two sources fails, the page prints a health score computed from the
source that didn't answer — and when the *healing* source is the one that fails, the score goes
UP.** Replayed against the live database:

| scenario | what the header renders | what is true |
|---|---|---|
| **A** — both sources OK (ground truth) | `Score 79/100` · **DEGRADED** | 79, over 59 of 78 personas with data |
| **B** — `getSlaDashboard(30)` rejects | `Score 65/100` · **DEGRADED** | **`—` / unknown.** 0 of 78 personas have any data; **all 78 rows render `grade: 'unknown'`** while the number above them reads 65 |
| **C** — `listHealingIssues()` rejects | `Score 84/100` · **HEALTHY** | 79 · DEGRADED. **179 open healing issues stop being subtracted, so the score rises 5 points and the verdict chip flips from Degraded to Healthy** |
| **D** — `fetchExecutionDashboard` stale | `Score 79/100` · uptime `—` | 79 — and this one is **correct**, because uptime is the field that was made nullable |

`src/features/overview/sub_health/libs/useStatusPageData.ts:37-40`:

```ts
export function computeGlobalScore(entries: CompositeHealthEntry[]): number | null {
  if (entries.length === 0) return null;
  return Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length);
}
```

Rendered at `StatusPageView.tsx:74` as `Score {globalScore ?? '—'}/100`, and at `:52` it drives
`globalGrade`, which paints the page's single largest chip.

### The three defenses that exist, and the one place they didn't reach

This is not a file nobody thought about. The same 200 lines contain **three separate, deliberate,
commented honesty fixes** for exactly this failure mode:

| # | defense | where | does it survive a partial read? |
|---|---|---|---|
| 1 | `grade: hasSlaData ? computeGrade(score) : 'unknown'` | `compositeHealthScore.ts:417` | ✅ **yes** — all 78 rows correctly read `unknown` in scenario B |
| 2 | `uptimePercent = daysWithData > 0 ? … : null` | `compositeHealthScore.ts:391` + `computeGlobalUptime`'s `.filter(e => e.uptimePercent != null)` (`useStatusPageData.ts:49-51`) | ✅ **yes** |
| 3 | `computeGlobalScore` returns `null` when `entries.length === 0` | `useStatusPageData.ts:38` | ⚠️ **only for zero personas** — never for zero *data* |

**Defense 3 is the one that fires on the aggregate, and it guards the wrong emptiness.** It asks
"are there any rows?" when the question is "does any row have data?". In scenario B there are 78
rows and none of them has data.

### Why the fix landed on `uptimePercent` and not on `score` — the whole finding in one line

The two fields sit **14 lines apart in the same interface**, were written by the same hand, and are
consumed by two functions **12 lines apart in the same file**:

```ts
uptimePercent: number | null;   // compositeHealthScore.ts:53  — nullable
score: number;                  // compositeHealthScore.ts:20  — not nullable
```

`useStatusPageData.test.ts` has **three regression tests** pinning the no-data exclusion for
`computeGlobalUptime`, and its `makeEntry` helper hard-codes `hasSlaData: true` (`:25`) — so **not
one test in the file exercises a persona without data against `computeGlobalScore`.**

`number | null` forced every consumer to answer the question. `number` never asked it. That is the
type argument for this leaf, and it is a controlled experiment inside one file: same author, same
session, same concept, one field guarded and one not, and the only difference is nullability.

### Then look at the denominator

| | count | |
|---|---:|---|
| `Promise.*` combinator call sites in `src/` | **179** | 147 `all` · 26 `allSettled` · 6 `race` |
| of which literal tuples (arity ≥ 2) | **125** | |
| of which **multi-source reads** (≥ 2 read-shaped members) | **75** | the denominator of this leaf |
| — reject the whole tuple, nothing guarded | **49** (65%) | one source fails → the caller loses all of them |
| — ≥ 1 member `.catch`es into an **empty value** | **20** (27%) | the failure arrives as `[]`, `0` or `null` |
| — `allSettled` **with the rejected branch read** | **6** (8%) | the only compliant form |
| of the 20: guard only **some** members | **14** | still rejects on the unguarded ones *and* silently zeroes the guarded ones |
| reads anywhere in `src/` whose failure resolves to empty/zero/null | **68 in 32 files** | the census population (§9) |
| sites anywhere in `src/` that **name which source failed** | **31 in 5 files** | the positive control (§9) |

**69 of 75 multi-source reads in this app cannot express "5 of 8 answered."** The entire
disclosure surface of a 4,829-file application is **five files**.

### The backend half — one envelope, and it is a good one

The brief scopes this leaf `sides: client`. It is right that the client owns it, and wrong that the
backend has nothing to say: swept over 963 `.rs` files (see §12.1),

| | count |
|---|---:|
| commands assembling a response from 2+ independent sources | **192** |
| — `?` propagates; the frontend loses everything | **138** (72%) |
| — a failed source becomes an empty/zero value **inside an `Ok(...)`** | **54** (28%) |
| — the response carries a **per-source outcome** | **1** |

That one is `get_health_bundle` (`src-tauri/src/commands/communication/observability/metrics.rs:264-291`),
and it is the best implementation of this leaf in any of the six codebases surveyed — because it
answers the question the whole leaf turns on, in its own docstring:

> *"a `null` field means that source loaded cleanly; a `Some(reason)` means only that source failed
> … It also disambiguates `byom_policy: None` — **"no policy configured" (valid) is
> `byom_policy = null, errors.byom_policy = null`, whereas a load failure is
> `byom_policy = null, errors.byom_policy = Some(reason)`.**"*
> — `metrics.rs:262-269`

Its consumer completes the contract: `src/stores/slices/overview/personaHealthSlice.ts:267-333`
reads the per-source reasons, **retries only the sources that failed** through their individual
endpoints (`:300-325`), and publishes a `DataSourceStatusMap` of `{state, reason}` per source
(`:328-333`). **A live, two-sided, per-source read envelope with automatic per-source recovery —
n = 1, out of 192.**

### And the same `.unwrap_or(0.0)` runs the money gauge

`src-tauri/src/commands/execution/executions.rs:893-896`:

```rust
let monthly_spend = …::get_monthly_spend(&state.db, &persona_id).unwrap_or(0.0);
let budget_limit = persona.max_budget_usd.unwrap_or(0.0);
```

lands on `ExecutionPreview.monthly_spend: f64` (`src-tauri/engine/src/cost.rs:100` — a plain `f64`,
no `Option`, no flag), and the frontend divides it:

```ts
const budgetPct = preview.budget_limit > 0
  ? ((preview.monthly_spend + preview.estimated_total_cost) / preview.budget_limit) * 100 : 0;
const overBudget = budgetPct > 100;
const nearBudget = budgetPct > 80;
```
— `src/features/agents/sub_executions/components/runner/ExecutionPreviewPanel.tsx:72-75`

**A failed spend query renders "0% of budget used" and suppresses the over-budget warning on a
persona that may be at its cap** — and `0.0` is a legitimate value for a persona that has never run,
so neither the frontend nor the user can tell. The same `get_monthly_spend` predicate is the one
that *blocks* runs, so the gauge and the gate disagree exactly when it matters.

### Three more, in descending silence

**1 — The morning briefing tells the user "all quiet" when the reads failed.**
`src/features/home/sub_cockpit/briefing/useMorningBriefing.ts:76-81` awaits
`Promise.allSettled([...])` over **four** sources and **never binds the result**. Whatever landed in
the store is then counted by `buildSessionDelta` (`sessionDelta.ts:47-99`) into `runs`,
`failedRuns`, `alerts`, `approvalsWaiting`, and `deltaIsTrivial` (`:105-107`) asks
`d.runs === 0 && d.failedRuns === 0 && d.alerts === 0 && d.approvalsWaiting === 0`. All four
sources failing produces **byte-identical output to a genuinely quiet night** — `composeQuietBriefing`,
whose own docstring calls it *"the honest empty state"*. It is honest about the sample. It is a
statement of fact about the world.

**2 — A panel renders its "nothing here yet" state for a source that errored.**
`src/features/overview/sub_director/components/CampaignReportPanel.tsx:49-55, 81-83`:

```ts
Promise.allSettled([getDirectorCampaignReport(), listDirectorExperiments()]).then(([r, e]) => {
  if (r.status === 'fulfilled') setReport(r.value);
  if (e.status === 'fulfilled') setExperiments(e.value);
  setLoaded(true);                                   // <- unconditional
});
…
const isEmpty = loaded && (report?.experimentsTotal ?? 0) === 0 && pending.length === 0
                       && (report?.hypothesesEmitted ?? 0) === 0;
```

Both rejections are discarded — not logged, not toasted, not stored. `report` stays `null`,
`?? 0` turns it into a zero, `loaded` turns true anyway, and `isEmpty` becomes the panel's verdict.
`useDirector.ts:88-106` is the same shape over **four** sources with `setReady(true)` in a
`.finally()`.

**3 — The best envelope in the repo has three holes in its own file.**
`src/features/plugins/dev-tools/sub_triage/findings/sweep.ts` is the app's canonical partial-read
envelope: `skippedSensors: string[]`, `errors: string[]`, and a `probedOrigins: Set<string>` whose
consumer states the rule outright —

> *"HONESTY RULE 0: absence is only a win when the sensor actually looked."*
> — `findings/verify.ts:103-104`, with `probedOrigins` a **required** parameter *"so no call site
> can forget it"* (`:93`)

— and yet `sweep.ts:102`, `:122` and `:169` are three reads that `.catch(→ [])`. At `:102`,
`listStandards` failing yields `[]`, `emitStandardsFindings([], passport)` emits nothing, and
`probedOrigins.add('standards_finding')` **runs anyway** (`:107`). The sensor is marked as having
looked when it did not, and every existing `standards_finding` then verdicts `cleared`
(`verify.ts:111`) — *the loop fabricating its own wins*, which is the exact phrase the required
parameter was added to prevent. **The rule is enforced at the door it guards and defeated one
statement upstream.** Latent on this install (0 rows in `dev_ideas` carry those origins today;
`dev_standards` holds 17 real rows, so the sensor has live inputs).

### The composition defect with the neighbouring path — offered upward

[`bounded-parallel-fan-out`](./bounded-parallel-fan-out.md) §2(c) prescribes: *"give the mapper an
infallible signature by catching inside it … or at minimum a `.catch()` **inside** the map."* That
is correct — the combinator must not be able to reject. But it is silent on **what value you
substitute**, and the cheapest infallible signature in JavaScript is `.catch(() => [])`. Followed
literally on a *read* path, the neighbour's prescription **manufactures this leaf's central
defect**, 68 times.

The two paths are individually right and compose into a bug — doctrine §6, measured. The
reconciliation is one clause, and the fan-out path already names the primitive that satisfies both:
`eventBridge`'s `tryAttach` returns a **discriminated `AttachOutcome`**, not an empty array. So:
**catch inside the mapper — into a tagged outcome, never into an empty value.**

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path,
primitive name or count. Each clause names its warrant.

> **P1 — physics.** **A read that touches more than one source has more than two outcomes.**
> "Loaded" and "failed" are not a partition of the outcome space the moment N > 1; "loaded some"
> is a third state and it is the common one. A surface with a boolean `error` has already decided
> it cannot say what happened.
> *Warrant: 4 of 5 sibling repos independently grew a per-source envelope of some kind; the one
> with none is also the only one with no UI.*
>
> **P2 — physics, and the sharpest clause here.** **Never compute an aggregate over the sources
> that answered and render it as if all of them had.** A count, a total, an average, a rate, a
> percentage, a trend arrow, or a bare "N items" label computed over survivors is not
> approximately right — it is a confident assertion about data you do not have. Aggregates are
> where a partial read stops being a resilience question and becomes a **correctness** question,
> because the arithmetic launders provenance: a number carries no memory of its denominator.
> *Warrant: found live in 3 of 6 codebases, including a fabricated week-over-week trend arrow and a
> "0 comments · Live" badge on a failed fetch. Only 1 of 6 ships the disclosure beside the
> arithmetic.*
>
> **P3 — physics.** **Emptiness is a claim; a failed read cannot make it.** "The source returned
> nothing" and "the source did not return" must never become the same value. The moment a failure
> is converted into `[]`, `0`, `null` or `{}`, every consumer downstream — the empty state, the
> count, the "nothing to do" verdict — is reasoning about a world that was never observed, and no
> later code can recover the distinction.
> *Warrant: 68 sites here; the identical `.catch(() => ({ items: [] }))` shape in a sibling repo
> feeds a real percentage 50 lines later; three repos share the pattern with no shared code.*
>
> **P4 — physics.** **Disclose at the level of the thing that is wrong.** A banner at the top of
> the page does not fix a number in the middle of it. Whoever reads the number will not read the
> banner, and a screenshot of the number carries no banner at all. The marker belongs on the
> metric, the row, or the panel that is actually incomplete.
> *Warrant: the two best implementations in the whole cohort — one here, one in a sibling — have
> exactly this residual: correct panel-level disclosure, undisclosed numbers inside it.*
>
> **P5 — ergonomics, and the one that makes the rest survive.** **Put the absence in the type, not
> in a convention.** A field that can be unknown must be *typed* as possibly-unknown, all the way
> to the aggregate. A discipline applied at the row and not at the sum will be lost at the sum,
> because nothing asked.
> *Warrant: a controlled experiment in one 200-line file — the nullable field got three regression
> tests and the non-nullable sibling got zero, same author, same session.*
>
> **P6 — physics.** **A failure that reaches nobody is not handled.** Discarding the rejected
> branch of a settle-all is not error handling; it is error deletion with extra syntax. Choosing
> "settle all" and then reading only the fulfilled half is strictly worse than failing fast,
> because fail-fast at least tells the caller something happened.
> *Warrant: 9 of the 15 settle-all sites across five sibling repos discard rejections entirely,
> and it is the majority behaviour wherever the construct appears at all.*
>
> **P7 — ergonomics.** **A read that half-failed must not be cached as if it succeeded.** A
> memoisation window, a TTL, or a "last good" latch that cannot tell a partial run from a clean
> one will hold the hole for its full duration.
> *Warrant: this repo gets it right in exactly one place, and that place is the only one whose
> settle helper returns a boolean meaning "every source succeeded".*
>
> **P8 — ergonomics.** **Stale-and-shown beats blank, but only if it says so.** Keeping
> last-known-good data through a failed refetch is correct. Keeping it silently is how a user
> reads a two-hour-old outage as current.
> *Warrant: 3 of 6 repos deliberately retain stale data on a failed refresh; only 1 renders any
> marker, and its marker is a frozen clock the reader must notice.*
>
> **Scale condition.** P2, P3 and P6 are correctness on day one — they are wrong at N = 2. P1 and
> P5 bite the first time someone adds a third source. P4, P7 and P8 bite the first time a source is
> flaky rather than broken.

---

## 1. Trigger

- "This panel pulls from three places — what if one of them is down?"
- "Just `allSettled` it so one failure doesn't kill the rest."
- "I'll `.catch(() => [])` so the page doesn't blow up."
- "The dashboard says zero. Is that real, or did the fetch fail?"
- "It showed 'no data' but the data is definitely there."
- "Why is the health score green during an outage?"

**If you are about to write** an aggregate (`.length`, `.reduce`, a division, a percentage, a
`total`, an "N items" label) over anything assembled from **more than one** async read — or a
`.catch(` on a *read* whose handler returns `[]`, `0`, `null` or `{}` — **you are in this
situation.**

You are **not** in this situation for a single-source read (that is
[`page-loading`](./page-loading.md) plus [`error-surfacing-policy`](./error-surfacing-policy.md)), or
for `Promise.all` over independent **writes** (that is
[`post-write-side-effects`](./post-write-side-effects.md)).

### Boundaries with the adjacent leaves

- [**`bounded-parallel-fan-out`**](./bounded-parallel-fan-out.md) owns **how many run at once and
  what the combinator returns.** This path owns **what value a failed item carries** and what the
  screen does with it. Its §2(c) and this path's §2 must be read together — see §0 and §12.4.
- [**`page-loading`**](./page-loading.md) and [`docs/design/overview-loading.md`](../../design/overview-loading.md)
  own **loading → loaded**. This path owns the state their five laws do not have: **settled but
  incomplete** (§8 Gap 1).
- [**`empty-and-demo-states`**](./empty-and-demo-states.md) owns **what "nothing here" looks like.**
  This path owns **whether you are entitled to say it.**
- [**`metric-definition`**](./metric-definition.md) owns **what a number means** and already found
  the *confident zero* — an empty sample rendered as a real value. This path is its two-source
  sibling: a **partial** sample rendered as a complete one. Same defect, one more input.
- [**`error-surfacing-policy`**](./error-surfacing-policy.md) owns **whether a failure earns a toast
  or a banner.** This path owns **which of six things failed**, which that path's single-error model
  cannot express.
- [**`swallowed-error-telemetry`**](./swallowed-error-telemetry.md) owns **whether the operator
  learns.** This path owns **whether the user learns.** All 68 §9 sites call `silentCatch`, so they
  are *telemetry-clean and user-facing-silent* — that path's gate reports them green.
- [**`stale-response-guard`**](./stale-response-guard.md) owns **an out-of-order response.** This
  path owns **an absent one.**

## 2. The one way

**Decide, before you write the fetch, what each source's failure will look like to the pixel that
displays it — then carry that decision in the type all the way to the aggregate.** Concretely: (a)
**never resolve a failed read to an empty value** — no `.catch(() => [])`, no `?? 0`, no
`unwrap_or_default` on a read whose emptiness the UI will interpret; if you must catch inside the
mapper (and for a fan-out you must, see the neighbouring path), catch into a **tagged outcome**
(`{ ok: false, source, error }`), which is six lines and is already written here as `tryAttach`.
(b) **Keep the failures in a per-source map, not a scalar** — `Record<sourceName, string>` is the
shape this repo already ships as `pipelineErrors`, and it is the only shape that can answer "which
one". (c) **Make the per-item value carry its own absence in the type**: a metric that can be
unknown is `number | null`, never `number` with a sentinel, because the aggregate one function later
is where the convention gets dropped. (d) **Every aggregate over a possibly-incomplete set returns
`null`, or returns a pair** — the value *and* the coverage (`{ value, of, from }`) — and the render
site is what decides between "—", "≈", and a plain number; a `reduce` that cannot return `null` will
never tell you it should have. (e) **Read the rejected branch, always** — if you chose `allSettled`
for legibility, use the legibility; discarding rejections makes it strictly worse than
`Promise.all`. (f) **Disclose next to the number, not only at the top of the page** — a chip, a
suffix, a `title`, a dimmed style on the specific metric that is short; the banner is for the
banner's job. (f2) **If you also own the backend, put the envelope on the wire** — `Option<T>` per
payload beside a sibling `errors` struct of `Option<String>` per source, which is what lets the
client retry *only* what failed instead of re-paying for the sources that worked; never
`.unwrap_or_default()` a read inside an `Ok(...)`, because that erases the distinction one layer
below anything the client can see. (g) **Never memoise a partial run** — the helper that settles the wave returns
`true` only when every source succeeded, and the cache gate reads that boolean. (h) **When you keep
stale data through a failed refetch — and you should — render the staleness**; this repo has a
shared component for it and it is used on 5 of ~20 eligible surfaces. Then stop: do not add a
second scalar `error` beside the map, do not `try/catch` the whole wave, and do not "fix" it by
making the panel disappear.

If you must get one right first: **(d)**. (a), (b) and (e) produce a *visible* hole that a user can
report. (d) produces a number that looks exactly like the truth, and there is no later signal — not
a log, not a Sentry event, not a support ticket — by which anybody learns it was wrong.

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src/stores/slices/overview/overviewSlice.ts:74, :94, :197-211` — `pipelineErrors: Record<string,string>` + `pipelineFetchedAt: Record<string,number>` + `applyPipelineResults(results)` | **the per-source envelope.** One store write commits every source's outcome; success *deletes* its error and stamps a fetch time, failure keeps the message keyed by source name. This is the repo's answer and it is complete — errors, per-source freshness, and a single `set()`. |
| `src/hooks/overview/useExecutionDashboardPipeline.ts:62-90` — `settleAndReport(fetches, tag, signal)` | **the one site to copy.** Takes `{name, fn}[]` so every source has an identity, reads the rejected branch, builds one `{source, error}[]`, and **returns `true` only when every source succeeded** — which is what the memoisation gate at `:165` reads, so a partial run is never cached (P7). |
| `src/features/shared/components/feedback/StalenessIndicator.tsx:22` | **disclosure next to the data.** `fetchedAt` + `hasError` → an amber "N minutes ago · refresh failed" badge, rendering `null` when fresh and healthy. Shared, catalogued, i18n'd, props-only. **5 render sites, all in 2 files** — against 77 files under `src/features/`+`src/hooks/` that hold a `setInterval` and 11 `usePolling` call sites (§7 D7). |
| `src/features/overview/sub_observability/components/ObservabilityDashboard.tsx:37-60` — `PanelStatusChips` | **the per-panel form of P4** — one chip per declared source, keyed off `pipelineErrors[key] \|\| !pipelineFetchedAt[key]`, so "errored" and "never fetched" are two different chips. |
| `src/features/plugins/dev-tools/sub_triage/findings/sweep.ts:88-98` + `verify.ts:95-111` — `skippedSensors[]` / `errors[]` / `probedOrigins: Set<string>` | **the strongest statement of this leaf's principle in the tree**, and the only place a downstream *decision* is gated on it: `verdictFor(finding, fresh, probedOrigins)` takes the probe set as a **required** parameter, and absence-from-results is `cleared` only for a probed origin, `pending` otherwise. Copy the shape, and read §7 D5 for the three holes in its own file. |
| `src/lib/eventBridge.ts:169-175` — `tryAttach` → `AttachOutcome = {ok:true,…} \| {ok:false, reg, reason}` | **the infallible mapper done right.** Six lines. The combinator cannot reject and **every failure keeps its identity**. This is the value `.catch(() => [])` should have returned. |
| `src/features/agents/sub_executions/libs/useChainTrace.ts:10-22` + `ChainTraceView.tsx:107-109` | **an aggregate that ships beside its own partiality flag.** `partial: boolean` (*"only this run's trace is accessible"*) travels with `chainCostUsd`, and the view renders an `AlertCircle` banner. The nearest thing in the app to P2 — and see §7 D6 for the P4 residual. |
| `src/features/overview/sub_health/libs/useStatusPageData.ts:48-54` — `computeGlobalUptime` | **the correct aggregate.** `.filter(e => e.uptimePercent != null)` before the mean, `null` when the filtered set is empty. Three regression tests. Copy this function's shape, not its neighbour's. |
| `src-tauri/src/commands/communication/observability/metrics.rs:264-291` + `:381-388` — `HealthBundle` / `HealthBundleErrors` / `fn split<T>(r) -> (Option<T>, Option<String>)` | **the backend contract, and the shape every multi-source command should return.** Six `Option<T>` payloads beside a sibling `errors` struct with one `Option<String>` per source; `split()` is a **five-line** adapter from `Result<T, AppError>`. It is the only construction in 192 multi-source read commands that can say *"absent because unconfigured"* apart from *"absent because it failed"*. |
| `src/stores/slices/overview/personaHealthSlice.ts:267-333` | **the frontend half of that contract, and the only per-source *recovery* in the app.** Reads `bundle.errors.*` into a `Record<DataSourceName, string \| null>`, retries **only the failed names** through their standalone endpoints, clears each reason that the retry fixed, then publishes `DataSourceStatusMap` (`{state:'ok'\|'failed', reason}`). It also states which sources are deliberately *outside* the retry surface and why (`:281-283`). |
| `src-tauri/src/engine/healthcheck.rs:596-655` — `BulkHealthcheckSummary` + `summarize_probe_states` | **three buckets, not two** — `passed` / `failed` / **`unverifiable`**, tallied off a typed `HealthProbeState` rather than the legacy `success` boolean, with `failed` derived by subtraction so the buckets always conserve. Its comment is this leaf's thesis written in-repo: *"counting on `success` alone silently folds 'never probed' into 'passed' … a vault of entirely unprobed credentials would report 'N passed, 0 failed' and read as fully verified."* |

**Do NOT build:** a scalar `error: string \| null` for a surface with 2+ sources (§7 D3); a
`.catch(` on a read that returns `[]`/`0`/`null` (§7 D1, 68 sites); an `allSettled` whose rejected
branch you don't read (§7 D3); a `loaded`/`ready` flag set in a `.finally()` (§7 D3); a `?? 0`
between a possibly-failed source and an arithmetic operator (§7 D2); an aggregate whose return type
is `number` over a set that can be incomplete (§7 D2); a second "did anything fail" boolean beside
`pipelineErrors`.

## 4. Steps

1. **Name every source.** `{ name: 'slaDashboard', fn: () => getSlaDashboard(30) }`. A source
   without a name cannot appear in an error map, a chip, or a log line — and the array-destructuring
   form (`const [a, b] = await Promise.allSettled([...])`) is what makes 66 of this repo's 75
   multi-source reads nameless.
2. **Ask what the screen does with each source's absence, before writing the fetch.** For each one:
   does a panel disappear, a count change, or a verdict flip? The sources whose absence moves a
   *number* are the ones that need (4) and (5); the rest need only (3).
3. **Settle, and read the rejected branch.** `settleAndReport` if you are in Overview; otherwise the
   same eight lines. Never `try { await Promise.all([...]) } catch`.
4. **Type the per-item value so absence is representable.** `successRate: number | null`, not
   `number` with a 0 sentinel. Add the boolean discriminator too (`hasSlaData`) — but understand
   that the boolean protects the *row* and only the nullable type protects the *sum*.
5. **Ask whether the type can make the wrong aggregate impossible — before you write the gate.**
   Here it can, and the edit is one character (see *Type over gate* below). This is the step this
   repo skipped, and §0 is the cost.
6. **Make every aggregate return `null` or a pair.** `computeGlobalScore(entries): number | null`
   that filters on the discriminator; or `{ value, of, from }` when the coverage is worth showing
   ("avg over 5 of 8"). A `reduce` that returns `number` has already lost.
7. **Render the disclosure at the level of the wrong thing.** `StalenessIndicator` on the panel,
   a chip per source in the header, `'—'` (not `0`) on the metric. A page-level banner is *also*
   correct and is *not* sufficient (P4).
8. **Gate the cache on the boolean.** `if (allOk) lastRun = { key, at: Date.now() }`. Never stamp
   the cache in a `.finally()`.
9. **Test the partial case, not just the empty case.** One test with the discriminator false. The
   Status page has three tests for the nullable field and zero for the non-nullable one; that
   asymmetry *is* the bug.
10. **And then stop.** Do not add a second error flag, do not hide the surviving panels, do not
    retry silently in a loop, and do not convert the per-source map back into one string for
    convenience.

### Can the type make the wrong call impossible? — asked before §9

**For the aggregate: yes, and it is one character.** The bad state is not "a source failed" — it is
**"a number was produced from rows that have no data, and nothing in its type had to acknowledge
that."** Change `CompositeHealthEntry.score: number` (`compositeHealthScore.ts:20`) to
`score: number | null`, or make the entry a discriminated union
(`{ hasSlaData: true; score: number } | { hasSlaData: false; score: null }`), and
`computeGlobalScore`'s `reduce` **stops compiling** until somebody decides. Hold it against the
seven qualifications:

- **Q1** (a type carries only what it encodes) — holds: it encodes exactly *this metric may be
  unknown*, nothing about which source failed. That is why (b) — the per-source error map — is a
  separate mandate and not folded in.
- **Q2** (requiredness ≠ closedness) — this is the *closedness* edit, and it is the right one.
  `hasSlaData: boolean` is already required and it did not reach the aggregate; adding more
  required booleans would change nothing.
- **Q3** (a type nobody constructs constrains nothing) — safe: `CompositeHealthEntry` has **1**
  construction site (`computeCompositeHealth`) and every consumer already handles `null` for the
  sibling field. `Numeric` (`StatusPageView.tsx:78`) and `{globalScore ?? '—'}` (`:74`) take `null`
  today.
- **Q5/Q6** (withholding beats requiring; withhold the *dangerous freedom*) — the dangerous freedom
  is *summing a field that might be fabricated*, and `null` is precisely how you take it away
  without taking away the score.

**For the empty-value substitution: no, and that is the finding.** The dangerous freedom is
`.catch(handler)` accepting a handler that returns anything at all — and `.catch` is a language
builtin that cannot be withheld (Q5 has nothing to withhold). A lint rule can *see* the shape but
cannot know whether `[]` is a legitimate default for that particular read. **So the aggregate half
gets a type and the substitution half gets a ratchet, and §9 says so.**

**And one destination needs fixing before any gate points at it** (contract, fifth §9 failure mode).
`ScenarioEmptyState` — 70 render sites, the app's canonical "nothing here" — has **7 variants**
(`ScenarioEmptyState.tsx:9-17`) and **not one of them is "this source failed."** Routing callers to
the shared primitive is worthless while the primitive has no way to say the true thing. Add an
`errored` / `unavailable` variant, and give `UnifiedTable` an `error` prop, *first*.

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`reduce` over a set that can be incomplete, returning `number`** | The number is a confident assertion about unobserved data, and there is no downstream signal that it was wrong. Executed: the Status page prints **65/100 DEGRADED** when zero of 78 personas have data, and **84/100 HEALTHY — five points better than the truth** — when the healing source fails. §7 D2. |
| **`.catch(() => [])` / `.catch(() => 0)` on a read** | "The source failed" and "the source is empty" become the same value, permanently. **68 sites in 32 files.** The empty state, the count, and the "nothing to do" verdict downstream are all reasoning about a world nobody looked at. §7 D1. |
| **`allSettled` whose `rejected` branch is never read** | Strictly worse than `Promise.all`: same cost, same timing, and now nothing knows. `CampaignReportPanel.tsx:49` and `useDirector.ts:90` discard 6 rejections between them and set `loaded`/`ready` anyway. §7 D3. |
| **`await Promise.allSettled([...])` with the result unbound** | The construct's entire value is its return. `useMorningBriefing.ts:76` does this over four sources and then tells the user *"quiet night, nothing needs you."* §7 D4. |
| **A scalar `error: string \| null` on a multi-source surface** | It can hold one message and there are six sources; whichever assigns last wins, and no consumer can attribute. The compliant `Record<string,string>` exists 40 lines away in the same store. |
| **`loaded`/`ready` set in `.finally()` or unconditionally in `.then()`** | "The request finished" is asserted as "the data is here." Every emptiness check gated on it then fires on the failure path. §7 D3. |
| **`report?.field ?? 0` between a possibly-failed source and arithmetic** | The `??` is where provenance dies. It reads as defensive and is the opposite: it manufactures a value the source never produced. |
| **Disclosing only at the page level** | A banner does not fix a number, and a screenshot of the number carries no banner. Both of the cohort's two best implementations have exactly this residual. §7 D6. |
| **Caching or memoising a wave that partly failed** | The hole is now pinned for the TTL. One place in this repo gets it right (`useExecutionDashboardPipeline.ts:165`) and it is the only settle helper that returns a boolean. |
| **Marking a source "probed" before checking it answered** | Downstream logic that treats absence as evidence then fabricates its own conclusions. `sweep.ts:102 → :107` marks `standards_finding` probed after a failed read, and `verify.ts:111` turns that into `cleared`. §7 D5. |
| **Retaining stale data on a failed refetch without saying so** | Correct behaviour, silent. A two-hour-old outage reads as current. `StalenessIndicator` exists and reaches 5 surfaces. §7 D7. |
| **"I used `allSettled`, so it's handled"** | `allSettled` is a *reporting* construct. It hands you the failures; it does not handle them. 20 of this repo's 26 `allSettled` sites do less with their rejections than one `.catch` would. |

## 6. Evidence

**The one site to copy: `src/hooks/overview/useExecutionDashboardPipeline.ts:62-90` — `settleAndReport`.**

```ts
function settleAndReport(fetches: NamedFetch[], tag: string, signal?: { cancelled: boolean }): Promise<boolean> {
  return Promise.allSettled(fetches.map((f) => f.fn())).then((results) => {
    if (signal?.cancelled) return false;
    let allOk = true;
    const pipelineResults: Array<{ source: string; error: string | null }> = [];
    for (let i = 0; i < results.length; i++) {
      const name = fetches[i]!.name;                                  // <- every source has an identity
      const result = results[i]!;
      if (result.status === 'rejected') {                             // <- the rejected branch is READ
        allOk = false;
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        log.error(`[${tag}] ${name} failed:`, result.reason);
        pipelineResults.push({ source: name, error: msg });
      } else {
        pipelineResults.push({ source: name, error: null });          // <- success is also reported
      }
    }
    useOverviewStore.getState().applyPipelineResults(pipelineResults); // <- ONE commit
    return allOk;                                                     // <- the cache gate reads this
  });
}
```

Five decisions worth copying: (1) the input is `{name, fn}[]`, so a source is a *thing with a
name* rather than an array position; (2) both branches are recorded, so `applyPipelineResults` can
**clear** a stale error on recovery (`overviewSlice.ts:206`) — a failure log alone cannot; (3) the
return is `boolean` meaning *every source succeeded*, consumed at `:165` (`if (wave1Ok)
lastPipelineRun = …`) with the comment *"a partial failure should retry next mount"* — P7, in one
line; (4) success stamps `pipelineFetchedAt[source]`, so freshness is **per source** and
`StalenessIndicator` has something to render; (5) the hook's own docstring states the contract:

> *"Uses `Promise.allSettled()` so that a failure in one source does not block the others.
> Per-source errors are tracked in the store so widgets with valid data still render while only
> the failed source shows an error indicator."*
> — `useExecutionDashboardPipeline.ts:26-29`

**That paragraph is this golden path, written before it, by someone who then shipped it to one
feature area.** The rest of the app does not import it.

**When you also own the backend, copy this pair instead:**
`src-tauri/.../observability/metrics.rs:264-291, :373-390` + `src/stores/slices/overview/personaHealthSlice.ts:267-333`.

```rust
fn split<T>(r: Result<T, AppError>) -> (Option<T>, Option<String>) {   // metrics.rs:382-386
    match r { Ok(v) => (Some(v), None), Err(e) => (None, Some(e.to_string())) }
}
```

```ts
const failedNames = (Object.keys(reasons) as DataSourceName[]).filter((n) => reasons[n] !== null);
if (failedNames.length > 0) {
  await Promise.allSettled(failedNames.map(async (name) => {   // <- retry ONLY what failed
    try { switch (name) { /* … each source's standalone endpoint … */ }
          reasons[name] = null;                                 // <- a recovered source is clean again
    } catch (e) { reasons[name] = e instanceof Error ? e.message : String(e); }
  }));
}
```

Four decisions worth copying: (1) six independent `Option<T>` payloads with a **sibling** `errors`
struct rather than a nullable union, so adding a source is one field in two places; (2) `split()` is
five lines and turns any `Result` into the pair — the reusable part of the whole pattern; (3) the
docstring resolves the ambiguity that makes this leaf hard (`null` + `errors: null` = *configured
as absent*; `null` + `errors: Some(..)` = *failed*); (4) the client **retries only the failed
sources** through their standalone endpoints before raising any banner, which is the answer to the
cold-start IPC-token race — a whole-bundle retry would re-pay for the five that worked.

**Also exemplary:**

- **`findings/verify.ts:95-111`.** `probedOrigins: ReadonlySet<string>` as a **required** third
  parameter with the reason in the docstring — *"Required, so no call site can forget it"* — and a
  distinct `pending` verdict carrying `reason: 'sensor_not_probed'`. The only place in the tree
  where "we didn't look" is a *first-class value* rather than an absence.
- **`src/lib/eventBridge.ts:169-175`.** `AttachOutcome` — the six-line discriminated union that is
  the correct alternative to `.catch(() => [])`, with a docstring arguing why it beats `allSettled`
  here.
- **`useStatusPageData.ts:48-54` + `useStatusPageData.test.ts:40-57`.** `computeGlobalUptime`
  filters the no-data rows before averaging and returns `null` when none remain — pinned by three
  regression tests. It is its own file's counter-example.
- **`compositeHealthScore.ts:347-352, :414-417`.** `hasSlaData` and the grade short-circuit, with
  the incident in the comment: *"previously `successRate` defaulted to a fabricated 1.0 in that
  case, feeding a perfect success score into the weighted formula and painting a dormant persona
  'Operational'."* **This repo has already shipped this exact bug once, at the row level, and the
  fix did not reach the aggregate.**
- **`ObservabilityDashboard.tsx:42-60`.** `hasAnyIssue = PANEL_SOURCES.some(s => pipelineErrors[s.key] || !pipelineFetchedAt[s.key])`
  — errored and never-fetched are two distinct conditions, and the chip row says which.

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.**

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **A per-source error envelope gets independently invented** | **PHYSICS (4/5)** | `ascent/src/components/launch/fleetMapStars.ts:16-19` (`Constellation = {status:"loading"} \| {status:"error";message} \| {status:"done";repos}`); `vibeman/src/lib/tools/implementation-accept.ts:92` (`errors: Record<string,string>` keyed by item id); `personas-web/src/stores/eventStore.ts:232` (`{succeeded,failed,aborted,skipped}`); `brainiac/crates/brainiac-server/src/console.rs:327-356` (`BulkReviewRow{ok,status,error}` + `BulkReviewResponse{decided,failed,results}`). Silent: `personas-cloud` (headless, no UI). |
| 2 | **`brainiac` wrote the argument for it, unprompted** | **the cohort's best sentence on this leaf** | `console.rs`: *"A batch does not collapse these into one error, because they are not one error — '3 of 12 were not yours' is a different fact from 'the request failed', and only the per-row shape can say it."* No shared document with this one. |
| 2b | **…and Personas has the best *implementation*, on a read path, end to end** | **LOCAL (1/6) — this repo is ahead** | `HealthBundle`/`HealthBundleErrors` (`metrics.rs:264-291`) is the only envelope in the cohort that disambiguates *configured-absent* from *failed*, and `personaHealthSlice.ts:300-325` is the only **per-source retry** anywhere in six codebases — every sibling that discloses a partial read offers a whole-page retry or none. Reported as a Personas-ahead result, the same class as the DST-correct schedule evaluator. **n = 1 out of 192 commands**, so it is an achievement and an adoption problem at the same time. |
| 3 | **⚠ The rejected branch is discarded** | **PHYSICS AS A DEFECT — 9 of the 15 settle-all sites across all five siblings** | `vibeman` **8 of 12** (`useTaskRunnerBatchData.ts:74-78`; `useRequirements.ts:273-277`; `github/cachedClient.ts:191` awaits and never binds; **five near-identical `readFileContents` helpers** at `ideas/scan/route.ts:49`, `regenerate-group/route.ts:49`, `regenerate/route.ts:184`, `generate-metadata/route.ts:147`, `generate-description/route.ts:146` that drop unreadable files with no count — **the LLM downstream is then prompted on a silently truncated corpus**). `personas-web` 1 of 3 (`feature-voting/index.tsx:46-59`). |
| 4 | **⚠ THE SHARPEST — an aggregate over survivors, displayed as complete** | **PHYSICS AS A DEFECT (3 of 6, incl. this repo), and independently reinvented** | `vibeman/src/app/features/reflector/sub_Weekly/lib/weeklyApi.ts:66-74` — `.catch(() => ({ directions: [] }))` on two sources, then `:122-150` `calculateFilteredAcceptanceRate(...)` and `calculateTrend(overall.total, lastWeekTotal)` — a failed HTTP read becomes **a real acceptance percentage and a real week-over-week arrow**, comparing a crippled total against last week's intact one, with **no error channel out of the function at all**. `personas-web/src/components/sections/feature-voting/index.tsx:170,176,205` → `FeatureVotingSummary.tsx:18-20` renders *"{n} total votes · {n} comments"* plus the literal word **"Live"**, with `loaded` set unconditionally — a failed comments fetch asserts **"0 comments"** as fact. Plus `personas-web/src/lib/api.ts:245-268`. **`vibeman`'s shape and this repo's `.catch(→[])`-then-aggregate are the same construction with no shared code.** |
| 5 | **Someone ships the disclosure beside the arithmetic** | **MINORITY (1/5) — `ascent` only** | `ascent/src/components/launch/fleetMapDerive.ts:36-61` computes `repos`/`scanned`/`avg` over survivors **and carries `errored` + `settled` alongside**, rendered at `FleetMap.tsx:184-186` as *"fleet charted · N unreachable"*; `avg` is `null` (never 0) when `scanned === 0`. And `ScoringTab.tsx:73-77` **swaps the label out** rather than computing on partial data: *"Couldn't load history — showing this scan only."* |
| 6 | **P4 — the disclosure lands on the panel, not the number** | **PHYSICS as a RESIDUAL (2/2 of the best implementations)** | `ascent/FleetMap.tsx:164-170` — the `repos`/`scanned`/`avg` stat tiles carry **no per-tile marker**; only the adjacent pill discloses. **Identical residual here**: `ChainTraceView.tsx:69-72` renders `chainCostUsd` unmarked and the `partial` banner sits **38 lines below** at `:107`. Two codebases, no shared code, same last mile. |
| 7 | **Survivors + per-panel error is the UI answer** | **MINORITY (2/6) — and the brief-relevant correction** | The oracle found it **LOCAL to `ascent`** (`ConstellationField.tsx:63,197`; `ScoringTab.tsx:73`; `ReportPanels.tsx:30,52`). **Personas has it too and the oracle could not see it**, because it lives behind a store key rather than a prop: `pipelineErrors` + `PanelStatusChips` + `StalenessIndicator`. So it is **2 of 6**, and the two implementations are independent. |
| 8 | **Whole-page death on one source** | **PHYSICS (3/5)** | `personas-web/src/app/dashboard/knowledge/useKnowledgeData.ts:136-159` (`Promise.all` of 3 in one `try`, one scalar `error`, both panels lost); `ascent/src/app/org/[slug]/delivery/page.tsx:30-38` (server component, `Promise.all` of 4, no try/catch, no error boundary — **a known, documented, still-unfixed defect**, `docs/harness/bug-ui-scan-2026-06-16/people-delivery-analytics.md:6-14`); `vibeman/SystemHealthDashboard.tsx:414-427`. |
| 9 | **Survivors with NO indication** | **PHYSICS (4/5)** | incl. `vibeman/useArchitectureData.ts:284-292`, where 3 of 4 sources swallow their own failure and only the 4th reaches `setError`; and `vibeman/SystemHealthDashboard.tsx:414` whose `error && !data` guard means **a failed refetch with prior data renders nothing at all**. |
| 10 | **A stale-but-shown marker** | **MINORITY (2/5) and weak — Personas is AHEAD** | `vibeman` freezes a timestamp correctly (`SystemHealthDashboard.tsx:367` vs `:452`) but suppresses the error, so the only signal is a clock that stopped. `ascent/src/components/launch/mergeStars.ts:11` + `useFleetData.ts:80-82` **deliberately** retains stale stars on a failed refresh — *"blanking the constellation on a transient blip is far worse"* — with **no badge, no dim, no timestamp**. `personas-web` `keepPreviousData: true` + `catch { /* leave stale */ }`, comment only. **No sibling has a component that renders the staleness. Personas does** (`StalenessIndicator`), and uses it 5 times. |
| 11 | **A generic reusable partial-success type (`Loadable<T>`, `PartialResult<T>`, `Result`-per-item)** | **SILENCE — 0 of 6** | Not one of the six codebases has a reusable envelope. Every per-source type found is bespoke to one feature. `useQueries`/SWR array-of-status: **0 application call sites across all five siblings** — every hit was `node_modules`. Reported as silence. |
| 12 | **A per-source envelope that nobody constructs** | **noted, 1/5 — doctrine Q3 in the wild** | `vibeman/src/app/lib/polling/factories.ts:243-257` defines `{endpoint, status, data, error}` + `totalChecks/successfulChecks/failedChecks/failureRate` — **the best type in the cohort** — with **zero production call sites**; only a test, an `example-usage.tsx`, and a README. `brainiac`'s `BulkReviewRow` has 2 construction sites and a TS mirror, and **zero console UI reads `results[]` or `.failed`**. |

**Physics — keep as doctrine:** clauses 1, 3, 4, 6, 8, 9 (the last three as defects).
**Reported as silence:** clause 11 (*nobody has a reusable partial-success type; nobody uses
`useQueries`*).
**Personas is ahead of all five siblings** on clauses 2b (per-source retry) and 10 (a component
that renders staleness) — and on both, adoption is 1 and 5 sites respectively, so being ahead of
the cohort and being broken in 32 files are simultaneously true.
**Amended by the oracle:** clause 7 — its "LOCAL to ascent" verdict was wrong about Personas
(§12.3).

> **Corrected 2026-08-16 by [data-provenance-disclosure](./data-provenance-disclosure.md).**
> Clause 10 is **inverted**: `personas-web` has a `StalenessIndicator` of the same name with
> **7 render sites against our 5**, plus i18n, an error arm, and a tick that pauses while the tab
> is hidden. Personas is not ahead on it; it is behind.
>
> Two composers, hours apart, swept the same five repos and reached the same wrong conclusion —
> **because both searched for the mechanism rather than the component name.** That is the same
> blind spot as clause 7's (a sweep keyed on prop-threading missing a store-mediated
> implementation), arriving from the other direction. When a clause is about a *component*, search
> the name too.

> **The strongest external result is clause 4, and it is not agreement — it is the same bug written
> twice by strangers.** `vibeman/weeklyApi.ts:70` is `.catch(() => ({ directions: [] }))`, whose
> empty array is fed 50 lines later into `calculateFilteredAcceptanceRate` and
> `calculateTrend(overall.total, lastWeekTotal)`. This repo's 68 sites are the same move without
> the object wrapper. Two codebases, different stacks, different people, no shared document, and
> the identical decision: *convert a failed read into an empty collection, then do arithmetic on
> it.* That is the best evidence in this document that P3 is physics and not house taste.

> **The counter-example that keeps it honest is `brainiac`, and it is negative in an instructive
> way.** Its one multi-source read — hybrid vector + full-text retrieval — is
> **deliberately fail-together**: `crates/brainiac-store/src/retrieval.rs:377`
> `let (vector_hits, fts_hits) = tokio::try_join!(vector_fut, fts_fut)?;`. If the FTS leg errors the
> whole search errors, and that is **correct**: a half-fused reciprocal-rank result would silently
> degrade recall while looking like a normal result set. **Partial success is not always the right
> answer — it is the right answer when the consumer can act on a subset.** For a fused ranker it
> cannot, so the honest move is to fail. A doctrine that says "always settle all" would have
> made that code worse.

## 7. Deviations

Every entry is live on `master` @ `629a914af` and was verified by reading the file, by replay, or
against a read-only copy of the operator's database.

### D1 — 68 reads whose failure resolves to an empty value, in 32 files

The census population (§9). Every one calls `silentCatch`, so the operator sees a Sentry breadcrumb
and the user sees nothing at all. Measured by two independent implementations reconciling at 68
(§9). The pattern is monoculture: `.catch((e) => { silentCatch('ctx')(e); return [] as T[]; })`.

Worst by consequence:

- **`findings/sweep.ts:102, :122, :169`** — see D5; these three defeat the repo's own honesty rule.
- **`useExportPicker.ts:99-129`** — **eight** sources of an *export* picker, each `.catch(→ [])`.
  A failed `listCredentials()` means the user exports a bundle silently missing credentials, and
  the picker shows zero of them as if none existed.
- **`usePassportData.ts:150-158`** — five overview reads (`skills`, `usage`, `docRot`,
  `memoryHealth`, `credentials`) all `→ []`, feeding a *passport readiness* judgement.
- **`useMorningBriefing.ts:73`** — `companionListPendingApprovals().catch(silentCatchNull)` then
  `?? []` at `:82`; the approvals count is one of the four inputs to `deltaIsTrivial`. See D4.
- **`PersonaLayoutView.tsx:90`** — `getMemoryCount(personaId).catch(→ 0)`. A count is rendered
  directly; **failed and zero are pixel-identical.**
- **`triggers/sub_test/TestTab.tsx:45,:49` and `sub_studio/StudioPatchbay.tsx:86`** — the event and
  subscription lists that a user reasons about routing with.

Two are arguably correct product decisions: `ProjectsLayer.tsx:104`
(`getProjectFavicon → null` → a dot fallback) and `useAiSearch.ts:65`. Precision on the *stated
condition* is 68/68; precision on *"this is a defect"* is ~66/68.

**Fix, per site:** return a tagged outcome (`tryAttach`'s shape) or let it reject and settle it at
the wave. Where the empty value is genuinely right, the *surface* must still be told — the read is
not the place to decide the panel's copy.

### D2 — the Status page's global score, computed over sources that didn't answer

`src/features/overview/sub_health/libs/useStatusPageData.ts:37-40` (`computeGlobalScore`) and
`StatusPageView.tsx:52, :74`. Full replay in §0.

Mechanics, for the fix: when `getSlaDashboard(30)` rejects, `slaStats` keeps its prior value (`[]`
on first load, or **the last successful fetch's** on a refresh — a second, subtler failure). Every
persona then gets `hasSlaData=false`, `successRateScore=0`, but `p95LatencyMs ?? 0` →
`scoreLatency(0)` = **100** and `consecutive_failures ?? 0` → `scoreStability(0)` = **100**. The
weighted sum therefore **floors at 40** (`0×0.30 + 100×0.15 + 100×0.25`) from absence alone, plus
whatever the two surviving sources contribute — which on this data is 25 more.
**The absence of data scores 65**, and if the healing source were absent too it would score 70.
Every missing input is scored as "nothing bad to report".

The banner does fire — `combinedError = error ?? slaError ?? healingError` (`:193`) feeds
`InlineErrorBanner` (`StatusPageView.tsx:59-61`), and the per-source errors were added by an earlier
pass whose comment (`:68-74`) describes this exact class of bug. **The disclosure was fixed and the
arithmetic was not.**

**Fix:** `score: number | null` on `CompositeHealthEntry` (§4 *Type over gate*); `computeGlobalScore`
filters on `hasSlaData` and returns `null` when none qualify — three lines, mirroring its own
sibling `computeGlobalUptime` twelve lines below. Add one test with `hasSlaData: false`.

### D3 — `allSettled` used as decoration: rejections discarded, `loaded` set anyway

- **`CampaignReportPanel.tsx:49-55, :81-83`** — two rejections discarded; `setLoaded(true)`
  unconditional; `isEmpty` computed from `report?.experimentsTotal ?? 0` where `report` is `null`
  *because the fetch failed*. The panel renders its **"nothing here yet"** state for an errored
  source. There is no error state in the component at all.
- **`useDirector.ts:88-106`** — four sources (`portfolio`, `verdicts`, `brainEnabled`,
  `obsidianAvailable`), four `if (x.status === 'fulfilled')` with no `else`, `setReady(true)` in
  `.finally()`. A failed `getDirectorPortfolio` leaves `portfolio: null` and `ready: true`.

**Fix:** both are five-line conversions to `settleAndReport`'s shape — a named `{source, error}[]`
and a `ready` flag gated on `allOk`.

### D4 — the morning briefing reports "nothing happened" from a read that didn't happen

`useMorningBriefing.ts:76-81` + `sessionDelta.ts:47-107`. Detailed in §0. Four sources, `allSettled`
result unbound, plus a fifth (`companionListPendingApprovals`) that `.catch`es to `null → ?? []`.
`deltaIsTrivial` then returns `true` for both "quiet night" and "the app could not read anything",
and the user is shown *"quiet night, nothing needs you."*

This is the **highest-visibility** instance in the app: it runs once per session, on launch, and it
is the first thing the user reads.

**Fix:** bind the `allSettled` result; count rejections; when any source failed, take the
`composeFallbackBriefing` path (which already exists, `sessionDelta.ts:11-13`) with a "couldn't
check N of 5" line — never the quiet path. The quiet claim requires a complete read.

### D5 — `HONESTY RULE 0` is defeated one statement upstream of itself

`findings/sweep.ts:100-114` (and the same shape at `:116-135`, `:162-196`).

```ts
const standards = await listStandards(project.id).catch((e) => {
  silentCatch('findings/sweep:listStandards')(e);
  return [];                                    // <- the read failed; it now looks empty
});
drafts.push(...emitStandardsFindings(standards, passport));
probedOrigins.add('standards_finding');         // <- "the sensor looked" — it did not
```

`verify.ts:104` reads `probedOrigins.has(origin)` to decide between `pending` and **`cleared`**, and
`:111` writes `cleared` on absence. So a network blip on `listStandards` marks every open
standards finding as **resolved**. The comment at `sweep.ts:93-97` describes precisely the hazard
that this `.catch` reintroduces, and the *required* `probedOrigins` parameter — doctrine Q5's
withholding, done correctly at the consumer — cannot help, because the caller hands it a set that
is already wrong.

Latent on this install: `dev_ideas` holds 236 rows, none with the `standards_finding` /
`sentry_spike` / `llm_cost` origins and none with a `verify_state`, so the sweep has not run here.
`dev_standards` holds **17** rows, so the sensor has real inputs the moment it does.

**Fix:** three lines. `let standards; try { standards = await listStandards(...) } catch (e) {
silentCatch(...)(e); skippedSensors.push('standards'); }` and only `probedOrigins.add(...)` on the
success path. The file already has `skippedSensors` and pushes to it eleven times.

### D6 — the two best implementations in the cohort both disclose at the panel and not at the number

`ChainTraceView.tsx:69-72` renders `formatCost(chainCostUsd)` — *"Summed cost (USD) of every
**accessible** trace in the chain"* (`useChainTrace.ts:21`) — with no marker, while the `partial`
banner sits at `:107-109`, **38 lines below**. The number and its caveat are not adjacent, and a
user reading the cost has no reason to scroll.

The same residual is in `ascent/src/components/launch/FleetMap.tsx:164-170` (§6 clause 6). Two
independent codebases, same last mile — which is why P4 is stated as physics rather than polish.

**Fix:** `{partial && <sup title={e.chain_partial}>*</sup>}` beside the cost, or render
`≈ {formatCost(...)}`. Two lines.

### D7 — `StalenessIndicator` reaches 5 sites; 77 files hold a refresh timer

`src/features/shared/components/feedback/StalenessIndicator.tsx` is shared, catalogued, i18n'd,
props-only, renders `null` when fresh, and shows *"N minutes ago · refresh failed"* otherwise. It
has **5 render sites**, all inside `DashboardHomeMissionControl.tsx` and
`ObservabilityDashboard.tsx` — i.e. exactly the two files that already consume `pipelineErrors`.

For scale: **77** files under `src/features/` + `src/hooks/` contain a `setInterval`, there are
**11** `usePolling` call sites, and exactly **2** files render any hand-rolled last-refresh label at
all. Nearly every auto-refreshing surface in the app keeps its previous data through a failed
refetch — correctly, per loading law 1 — and says nothing about it.

Meanwhile `pipelineFetchedAt` — the per-source freshness map it needs — is populated by
`applyPipelineResults` for every source the pipeline owns, and read by nobody else.
**The data is already there for surfaces that don't render it.**

**Fix:** it is a props-only component; every surface that keeps data through a failed refetch can
adopt it in one line. Start with the Status page (which auto-refreshes every 60s,
`useStatusPageData.ts:125`, and today shows only a hand-rolled `lastRefreshLabel` at
`StatusPageView.tsx:42-47` that **stamps on every settle, including a partial one**).

### D8 — the execution-preview budget gauge reads a failed spend query as "0% used"

`src-tauri/src/commands/execution/executions.rs:895` → `engine/src/cost.rs:100` →
`ExecutionPreviewPanel.tsx:72-75`. Full chain in §0. Three compounding facts:

- `.unwrap_or(0.0)` converts a DB failure into a legitimate-looking value **before** the type could
  have carried it.
- `ExecutionPreview.monthly_spend: f64` has no `Option`, no companion flag — so even if the
  command wanted to disclose, the wire type could not.
- The consumer does not just display it, it **divides** by `budget_limit` and gates two warnings
  (`overBudget`, `nearBudget`) on the result. A failed read therefore *removes* a safety warning.

The same function zero-fills a second source (`:883-885`, memory count → `0`), and its sibling
`build_advisory_context` (`:917-1016`) drops a failed source **out of the JSON map entirely** across
five `if let Ok(..)` arms — the advisory context silently shrinks and the model is prompted on less
than it was meant to see.

**Fix:** `monthly_spend: Option<f64>` on `ExecutionPreview` and let `budgetPct` be `null`, matching
what [`llm-spend-accounting`](./llm-spend-accounting.md)'s `unknown-money-as-zero` already
prescribes on the accounting side — this is that rule's condition arriving through a `.unwrap_or`
on a *read* rather than on a total.

### D9 — 54 backend commands return a zero-filled source inside a successful response

Measured across the 192 multi-source read commands. The sharpest, because it does not merely lose
information — it **asserts a different fact**: `src-tauri/src/commands/design/team_synthesis.rs:918-920`
resolves a persona name with `.unwrap_or_else(|_| "(persona removed)")`, so a transient database
error is rendered to the user as **a claim that the persona was deleted**.

Others worth naming: `portfolio.rs:656` (goals `.unwrap_or_default()` → `"goals": {"total": 0}` in a
project summary, while contexts and groups two lines above use `?` — inconsistent inside one
function); `competitions.rs:306, :385` (`get_task_by_id(..).ok()` → `"task": null`, identical to
deleted); `reviews.rs:2701-2704` (two percentage scores whose numerators count only
`is_some_and(...)` dimensions, so *missing* and *failing* score the same).

The compliant counter-example lives in the same tree and is worth copying for its *sign*:
`healthcheck.rs:677-679` swallows a failed connector enumeration into an empty set **deliberately**,
with the reason written down — *"If connector enumeration fails, fall back to probing all rather
than silently skipping everything"* (`:672-676`) — so the empty set means *probe everything*, and
the swallow fails **open**. A swallow with a stated direction is a decision; a bare
`.unwrap_or_default()` is not.

### D10 — 49 multi-source reads reject the whole tuple with nothing guarded

The majority case (65% of 75). `useObservabilityData.ts:56` (4 sources), `ReportPreviewDrawer.tsx:74`
(4), `useTeamDeliberations.ts:82` (4), `factoryL2Data.ts:75` (3), `useRadioState.ts:56` (3),
`ProjectTeamPreviewModal.tsx:99` (3), `useTeamMemories.ts:38` (3), and 42 more.

These are **the least bad** of the three shapes — a rejection is at least visible — and they are
still wrong: one flaky source blanks a panel that had five working ones. Notably `useTeamMemories.ts:38`
fans out `listTeamMemories` + `getTeamMemoryCount` + `getTeamMemoryStats` together, so a failure in
*the stats query* takes down *the list*.

**Fix:** not urgent per-site; the structural fix is that `settleAndReport` (or its 8-line
equivalent) should be reachable outside `src/hooks/overview/`. See §8 Gap 3.

### D11 — 14 tuples where only some members are guarded

The worst of both shapes: the unguarded members still reject the whole tuple, *and* the guarded ones
silently zero. `useExportPicker.ts:98` guards 2 of 8. `GoalDetailDrawer.tsx:122` guards 1 of 6.
`useProjectRegistry.ts:72` guards 1 of 5. `ActivityTab.tsx:47` guards 2 of 5.

**Fix:** make the guarding uniform *and* tagged. A tuple with mixed guarding is a decision nobody
made.

## 8. Gaps

1. **The loading doctrine has three states and this leaf needs four.**
   [`docs/design/overview-loading.md`](../../design/overview-loading.md)'s five laws and
   `UnifiedTable`'s documented contract (`UnifiedTable.tsx:13-25`) give: `isLoading && empty` →
   ghost; `!isLoading && empty` → **settled empty state**; rows → cascade. **A cold partial failure
   lands in state 2**, and the primitive renders `emptyTitle` — "No executions yet" — as settled
   fact. Law 1 (*"a fetch never hides rendered rows"*) is correct and does not reach this case,
   because on a cold failure there are no rows to protect. `UnifiedTable` has **no `error` prop**;
   17 render sites, 9 pass `isLoading`. **This is the single highest-leverage fix in this
   document**: one prop on one primitive gives every table a fourth state.
2. **`ScenarioEmptyState` cannot say "this failed."** 7 variants
   (`ScenarioEmptyState.tsx:9-17`), 70 render sites, and every variant is a first-use or
   filtered-to-zero scenario. There is no `errored` / `unavailable` / `partial` variant. Per the
   contract's fifth §9 failure mode, **a gate routing callers here would point at a broken
   destination** — arriving at the shared primitive does not let you tell the truth. Fix the
   variant set before ratcheting the callers.
3. **`settleAndReport` is not exported, and `pipelineErrors` lives in three files.** The best answer
   in the repo is a **module-private function** (`useExecutionDashboardPipeline.ts:62` — `function
   settleAndReport(`, no `export`), inside a hook with exactly **one** real importer
   (`OverviewPage.tsx:5`), writing to a store slice whose `pipelineErrors` key is read by exactly
   **two** components. Nothing outside `src/features/overview/` can reach any of it, so every other
   surface must re-derive it — which is why 69 of 75 do something else. The extraction is small (a
   generic `settleNamed(fetches): Promise<{ ok: boolean; errors: Record<string,string> }>` plus a
   local `useState`) and no such primitive exists in `src/lib/` or `src/features/shared/`.
4. **No reusable partial-success type exists in any of six codebases** (§6 clause 11), and this
   repo's own backend proves it is a *one-off* rather than a contract: **every partial-expressive
   read type in 963 `.rs` files has a construction count of exactly 1** — `HealthBundleErrors`
   (`metrics.rs:381-388`), `BulkHealthcheckSummary` (`healthcheck.rs:722`), `LabVersionRating`'s
   `partial_coverage`/`cost_unknown`/`degraded_count` (`db/src/repos/lab/ratings.rs:222`). There is
   no `LaneOutcome`, no `PartialResult<T>`, no `Loadable<T>`; `Vec<Result<T, E>>` appears **zero**
   times as a command return type. The five-line `split<T>(r) -> (Option<T>, Option<String>)` at
   `metrics.rs:382-386` is the whole reusable part and it is private to one file. Any prescription
   for a *generic* type would be an invention, so §2 mandates the **shape** (a per-source map + a
   nullable aggregate) rather than a named type — but `split()` deserves to be `pub` in a shared
   module, which is a one-line change.
5. **`Numeric` has no "incomplete" affordance.** `display/Numeric` (**216** render sites) renders
   `null` as an em dash — good — but has no way to render *"84, over 5 of 8 sources"*. P4 currently
   has to be satisfied with a hand-rolled `sup`/`title`/chip at each site. A `coverage?: {of, from}`
   prop on `Numeric` would make the disclosure as cheap as the number, across 216 call sites, in
   one edit.
6. **A partial read cannot be told apart from a stale one at the store layer.** `pipelineFetchedAt`
   stamps only on success, which is right — but a consumer reading `executionDashboard` from the
   store has no way to know whether the value is from this wave or the last one, unless it also
   reads `pipelineErrors` and `pipelineFetchedAt` by source name and knows the name. The names are
   string literals with no registry (`'alertRules'`, `'alertHistory'`, `'executionDashboard'`, …),
   so a typo in a consumer is silent. A `const PIPELINE_SOURCES` union type would close it;
   `ObservabilityDashboard.tsx` declares its own local `PANEL_SOURCES` and the store does not know
   about it.

## 9. The missing gate

**The condition:** *a read whose failure is delivered to the caller as a value meaning "there is
none", so "the source failed" and "the source is empty" become the same value — and every count,
rate, or emptiness verdict computed downstream is wrong without looking wrong.*

**The signal (a proxy, and stated as one):** a call to a read-named function whose `.catch(`
handler resolves to `[]`, `0`, `null`, or `silentCatchNull`. This keys on the shape the condition
wears **in this repo**, where reads are named `listX`/`getX`/`fetchX` and the house style is
`.catch((e) => { silentCatch('ctx')(e); return [] as T[]; })`. **An adopting repo must re-derive its
own proxy** — `vibeman` wears the identical condition as
`.then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] }))`, which this pattern would
not match at all.

**The mechanism: a census rule.** The runner already exists (`scripts/census/`) and implements the
fail-loud contract, so this path does not write a script.

**Where it executes:** `npm run census:check` is part of **`npm run check`** (`package.json`), which
the agent runs before opening a PR. That matters here: `ci.yml` is currently red on 10 pre-existing
Rust failures and `frontend-checks` is red on a platform-incomplete lockfile, so **a gate that only
runs in CI effectively runs nowhere.** This one runs on the developer's machine, before the branch
leaves it.

**Precision, hand-verified 68/68 on the stated condition.** Every one of the 68 matches was read:
all 68 are a read call whose failure resolves to an empty/zero/null value. On the stricter question
*"is this a defect"* the count is ~66/68 — `ProjectsLayer.tsx:104` (a favicon → a dot fallback) and
`useAiSearch.ts:65` are arguably correct product decisions, and are **listed on purpose**, because
separating them would require knowing what the surface does with the value, which no matcher can
see. One knowingly-listed acceptable site is better than a heuristic that guesses.

**Two independent implementations reconcile at 68, with one named disagreement.** Implementation #1
is a balanced-paren parser over comment-and-string-blanked source that classifies **all 825**
`.catch(` sites in the tree by *what the handler resolves to* (`void: 704`, `empty: 85`,
`value: 36`) and then filters to read-named callees → **69 in 33 files**. Implementation #2 is the
census regex → **68 in 32 files**. They agree on **68**; the parser's extra site is
`src/features/agents/sub_health/useHealthCheck.ts:406`, whose handler body contains a nested `{…}`
that the regex's `[^{}]{0,240}` cannot cross. **That bound is load-bearing** — the first draft used
a permissive `[\s\S]{0,240}?` window, which ran past the closing paren of the `.catch` and matched a
`return null;` on an unrelated `if` four lines later (`AgentCredentialDemands.tsx:39`). Trading one
false positive for one false negative was the right trade; both are documented rather than hidden.

**The recall bound is the word list, and the misses cluster where the doctrine says they will.**
Of the 85 empty-resolving `.catch` sites, **16** have a callee outside the verb vocabulary, and
**6 of those are genuine reads** with a namespaced or unusual name: `memorySkillContexts`,
`memorySkillCoverage`, `skillVersionTimeline`, `artistDefaultSaveDir`, `companionMcpResolveRequest`,
`githubCheckPermissions`. True recall is ≈68/74 ≈ **92%** of read sites. The vocabulary was widened
once already (adding the `namespaceVerb` camelCase form took it from 62 to 68, picking up
`githubListRepos`, `cloudListTriggers`, `companionListPendingApprovals`,
`gitlabListPersonaVersions`, `gitlabListDeploymentHistory`).

**The positive control partitions the app, and its number is the finding.** Pointed at the
**compliant** form over the same roots and extensions — a read failure routed into a *named*
per-source disclosure (`applyPipelineResults` / `setPipelineError` / `pipelineErrors[…]` /
`<StalenessIndicator` / `skippedSensors.push` / `probedOrigins.add|has`) — it returns **31 matches
in 5 files**. So the population is **68 laundered-into-empty (32 files) : 31 disclosed (5 files)**,
and the two rules must move in opposite directions as the codebase improves. If
`read-failure-as-empty-value` falls and the control does **not** rise, a read was deleted rather
than disclosed.

**The intersection of the two file sets is exactly one file, and it is the interesting one:**
`findings/sweep.ts` carries **18** of the 31 disclosure sites *and* **3** of the 68 violations
(§7 D5). The file with the best partial-read envelope in the repo is also the file that bypasses
it.

**How it fails loudly if its own precondition is absent:** `floor: 3000` against a live walk of
4,829 `src/**/*.{ts,tsx}` files, so a broken glob or a moved root fails rather than reporting zero;
a rule matching zero files anywhere is a structural failure in the runner; and a **drop** without
`--update` is fatal, because a silent drop is a broken matcher more often than it is fixed code.

**What the gate cannot do, stated so nobody trusts it further than it goes:**
- **It cannot see the aggregate at all.** `computeGlobalScore` — the §0 headline, the worst defect
  in this document — contains no `.catch` and matches nothing. The census *ratchets the input
  shape*; only the **type** (§4) reaches the arithmetic. That asymmetry is why this §9 has two
  halves and why the type is named first.
- **It cannot see the backend at all.** The Rust half is 192 multi-source read commands with 54
  zero-fills (§7 D9) — a population large enough to ratchet, but the shapes are
  `.unwrap_or_default()` / `.ok()` / `if let Ok(..)`, of which there are **962 / 601 / many**
  tree-wide with the overwhelming majority legitimate. A signal keyed on them would fire on correct
  content, which is worse than no gate. The honest backend answer is the **type** —
  `HealthBundle`'s `(Option<T>, Option<String>)` pair — not a count.
- It cannot see the 49 unguarded tuples (§7 D10) or the 6 discarded-rejection sites (§7 D3): those
  have no `.catch` and no empty literal. They were classified by hand via the balanced-paren
  parser.
- It counts a *substitution*, not a *judgement*. It cannot know that `[]` is wrong for
  `listCredentials` and fine for `getProjectFavicon`.
- **It is defeated by hoisting.** `const xs = await listX().catch(() => []);` matches;
  `let xs = []; try { xs = await listX(); } catch {}` does not, and is the same defect. That second
  form is already counted by [`swallowed-error-telemetry`](./swallowed-error-telemetry.md)'s
  `bindingless-catch-on-io` (84 files / 122 matches) — **which is a different condition** (no error
  binding, therefore no telemetry) that happens to overlap in shape. The 68 sites here all *have* a
  binding and all *do* call `silentCatch`, so they are invisible to that rule by construction. The
  two are complementary, not duplicative: one asks *"can the operator learn?"*, this one asks
  *"can the user tell?"*

**Existing rules checked for overlap before proposing this one — file overlap re-measured, not
assumed** (each neighbour's own pattern was re-run over `src/` and its file set intersected with
this rule's 32):

| neighbour rule | its files | overlap with my 32 | why it is a different condition |
|---|---:|---:|---|
| `empty-sample-as-confident-zero` (`metric-definition.md`) | — | **0 (0%)** | roots `src-tauri/**`, extension `.rs`. The nearest neighbour *semantically* and it cannot see a single line of this leaf. See §12.5 — the two cannot be merged. |
| `local-empty-state` (`empty-and-demo-states.md`) | 40 | **0 (0%)** | counts *authored* empty-state components, not the reads that feed them a lie. |
| `unknown-money-as-zero` (`llm-spend-accounting.md`) | 13 | **1 (3%)** | same idea on one domain noun (`cost`/`spend`) and one operator family (`?? 0`, `unwrap_or`); no match of mine is a money identifier and no match of its is a `.catch`. |
| `bindingless-catch-on-io` (`swallowed-error-telemetry.md`) | 87 | **2 (6%)** | same roots and extensions, **disjoint by construction**: it requires `catch {` with *no binding*; all 68 of mine have a binding and **0 of 68 lack a telemetry call** (verified). It asks *"can the operator learn?"*; this asks *"can the user tell?"* |
| `widthless-collection-fanout` (`bounded-parallel-fan-out.md`) | 35 | **5 (16%)** | counts fan-out **width**. Its anchor is `Promise.all(xs.map(` over a runtime-length collection; mine is a named read followed by `.catch`. Adjacent leaves, adjacent files, orthogonal signals. |

The largest overlap is 16%, well under the 83% that got a previous gate correctly declined.

```json
{
  "id": "read-failure-as-empty-value",
  "goldenPath": "docs/concepts/golden-paths/partial-failure-read-envelope.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\b(?:list|get|fetch|load|read|count|search|probe|resolve|[a-z][A-Za-z0-9_$]{1,20}(?:List|Get|Fetch|Load|Read|Count|Search|Probe))[A-Za-z0-9_$]{0,32}\\([^()]{0,160}\\)\\s{0,4}\\.\\s{0,2}catch\\s*\\(\\s*(?:silentCatchNull\\b|\\(?\\s*[A-Za-z_$][\\w$]*(?:\\s*:\\s*unknown)?\\s*\\)?\\s*=>\\s*(?:\\{[^{}]{0,240}?return\\s+(?:\\[\\s*\\]|0(?![.\\d])|null\\b)|\\[\\s*\\]|0(?![.\\d])|null\\b))",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A call to a READ-named function (list|get|fetch|load|read|count|search|probe|resolve, or a camelCase namespaced form like githubListRepos / cloudListTriggers / companionListPendingApprovals) whose `.catch(` handler RESOLVES TO an empty collection, a zero, or a null — including the bare `.catch(silentCatchNull)` form. PROXY FOR the stack-free condition: 'the source failed' and 'the source has none' are delivered to the caller as THE SAME VALUE, so every count, rate, empty-state and nothing-to-do verdict computed downstream is reasoning about a world nobody observed, and no later code can recover the distinction. WHAT THE MATCH COSTS, executed rather than reasoned: the Status page's global health aggregate was replayed verbatim (get_sla_dashboard's SQL from db/src/repos/communication/sla.rs:332-490 plus computeCompositeHealth and computeGlobalScore) against a READ-ONLY COPY of the operator's live 347MB personas.db over 78 real personas / 59 SLA rows / 205 healing rows. With both sources healthy the header renders 'Score 79/100 DEGRADED'. With getSlaDashboard REJECTED it renders 'Score 65/100 DEGRADED' while ALL 78 persona rows correctly render grade:'unknown' — zero personas have data and the number above them is 65. With listHealingIssues REJECTED the score RISES to 84 and the verdict chip flips to HEALTHY, because 179 open healing issues stop being subtracted: A FAILED READ IS RENDERED AS GOOD NEWS. PRECISION 68/68 on the stated condition, every match hand-read; ~66/68 on 'this is a defect' (ProjectsLayer.tsx:104 getProjectFavicon->null and useAiSearch.ts:65 are arguably correct product decisions and are LISTED ON PURPOSE, because separating them needs knowledge of what the surface does with the value, which no matcher has). TWO INDEPENDENT IMPLEMENTATIONS RECONCILE AT 68: this regex (68 in 32 files) and a balanced-paren parser that classifies ALL 825 `.catch(` sites in the tree by what the handler resolves to (void 704 / empty 85 / value 36) and then filters to read-named callees (69 in 33 files). The one disagreement is src/features/agents/sub_health/useHealthCheck.ts:406, whose handler body contains a nested {…} that `[^{}]{0,240}` cannot cross — a KNOWN, DELIBERATE recall miss: the first draft used a permissive [\\s\\S]{0,240}? window which escaped the .catch's closing paren and matched an unrelated `return null;` four lines later (AgentCredentialDemands.tsx:39), so one false positive was traded for one false negative. RECALL is bounded by the verb vocabulary exactly as the doctrine predicts: of the 85 empty-resolving catches, 16 have a callee outside the word list and 6 of those are genuine reads (memorySkillContexts, memorySkillCoverage, skillVersionTimeline, artistDefaultSaveDir, companionMcpResolveRequest, githubCheckPermissions) -> true recall ~68/74 ~92%. LEGAL DESTINATIONS the pattern leaves unmatched by construction: (1) letting the read reject and settling it at the wave with a named per-source error (settleAndReport, src/hooks/overview/useExecutionDashboardPipeline.ts:62-90); (2) catching into a TAGGED outcome rather than an empty value (src/lib/eventBridge.ts:169-175 `tryAttach` -> AttachOutcome, six lines); (3) pushing to a skipped-sensor list (findings/sweep.ts:88). WHAT THIS RULE CANNOT SEE, stated so nobody trusts it further: it does NOT see the aggregate — computeGlobalScore, the worst defect in this path, contains no .catch and matches nothing; the aggregate half is a TYPE (score: number|null), not a ratchet. It also cannot see `let xs = []; try { xs = await listX() } catch {}` — the same defect hoisted — which belongs to swallowed-error-telemetry's bindingless-catch-on-io (a DIFFERENT condition: no error binding, therefore no telemetry; all 68 sites here DO call silentCatch and are invisible to it by construction). PORTABILITY WARNING, earned from the convergence sweep: vibeman wears this identical condition as `.then(r => r.ok ? r.json() : { directions: [] }).catch(() => ({ directions: [] }))` at src/app/features/reflector/sub_Weekly/lib/weeklyApi.ts:66-74, feeding calculateFilteredAcceptanceRate and calculateTrend fifty lines later — a real percentage and a real week-over-week arrow built from a failed HTTP read. This pattern matches NONE of it. An adopting repo must re-key on its own read idiom. Do NOT silence a match by hoisting the read into a try/catch or by widening the return type to `T[] | undefined` and then `?? []` at the consumer — that is moving the lie, not removing it."
  },
  "exclude": [],
  "baseline": { "files": 32, "matches": 68 },
  "floor": 3000
}
```

```json
{
  "id": "read-failure-as-empty-value-positive-control",
  "goldenPath": "docs/concepts/golden-paths/partial-failure-read-envelope.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\bapplyPipelineResults\\s*\\(|\\bsetPipelineError\\s*\\(|\\bpipelineErrors\\s*[\\[.]|<\\s*StalenessIndicator\\b|\\bskippedSensors\\s*\\.\\s*push\\s*\\(|\\bprobedOrigins\\s*\\.\\s*(?:add|has)\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL — the COMPLIANT form of the same condition, over the same roots and extensions: a read failure routed into a NAMED per-source disclosure rather than substituted with an empty value. Six doors, all of them primitives that already exist in this repo: applyPipelineResults / setPipelineError / pipelineErrors[…] (the per-source error map at src/stores/slices/overview/overviewSlice.ts:74,:94,:197-211), <StalenessIndicator (the shared 'N minutes ago · refresh failed' badge at src/features/shared/components/feedback/StalenessIndicator.tsx:22), skippedSensors.push (the findings sweep's named-skip list, findings/sweep.ts:88) and probedOrigins.add|has (the honesty-rule probe set consumed as a REQUIRED parameter at findings/verify.ts:95-111). Returns 31 matches in 5 files, against the violating rule's 68 in 32 — so the population PARTITIONS 68 laundered-into-empty : 31 disclosed, and the two counts must move in OPPOSITE directions as the codebase improves. If read-failure-as-empty-value falls while this stays flat, a read was DELETED rather than disclosed, and the ratchet would otherwise have recorded that as progress. THE NUMBER IS ITSELF THE FINDING: the entire per-source disclosure surface of a 4,829-file application is FIVE FILES (findings/sweep.ts 18, ObservabilityDashboard.tsx 7, DashboardHomeMissionControl.tsx 4, useExecutionDashboardPipeline.ts 1, findings/verify.ts 1), and the intersection with the violating rule's 32 files is exactly ONE — findings/sweep.ts, which carries the best partial-read envelope in the repo AND three reads that bypass it (see §7 D5). Carries no baseline by construction — a ratchet is monotone-downward and would fail the build every time adoption improved. NOTE it counts only the disclosure vocabulary that EXISTS today; if the §8 Gap 3 extraction lands (a generic settleNamed in src/lib/), add its symbol here or the control will under-report adoption."
  },
  "exclude": [],
  "floor": 3000
}
```

Validated standalone via `node scripts/census/run-census.mjs --rules <private scratch registry>`,
never against the shared `rules.json`; the runner reports **68 matches / 32 files** for the rule and
**31 / 5** for the control, over **9,658 file-visits** (2 × 4,829). **Re-extracted from this document
and re-run, with identical counts.**

### The type, alongside the ratchet

The gate counts the **input shape**. The **arithmetic** is a type, and it is one character:

- **`CompositeHealthEntry.score: number` → `number | null`** (`compositeHealthScore.ts:20`), with
  `computeGlobalScore` filtering on `hasSlaData`. `computeGlobalUptime` twelve lines below already
  does exactly this and has three regression tests; `computeGlobalScore` has none. **One
  construction site, and every render site already handles `null` for the sibling field.** This is
  the edit that would have prevented §0, and no ratchet would have moved it.
- **Fix the destinations before ratcheting the callers** (contract: *a gate on reaching a
  destination is only as good as the destination's defaults*). `UnifiedTable` needs an `error`
  prop — 17 render sites inherit a fourth state from one edit — and `ScenarioEmptyState` needs an
  `errored` variant, because today the app's canonical "nothing here" component (70 render sites)
  is **incapable of saying the true thing**.

## 12. Corrections to the brief

1. **The spine says `sides: "client"` and `twoSided: true` in the same leaf, and the evidence says
   `twoSided` is the correct field.** The two contradict — the contract requires a `twoSided` leaf
   to carry both halves and the contract between them, while `sides: client` says there is no
   backend half. I swept the backend anyway, and the single best implementation of this leaf in six
   codebases turned out to be **a backend type and a frontend consumer that only work as a pair**:
   `HealthBundle` + `HealthBundleErrors` (`metrics.rs:264-291`) is inert without
   `personaHealthSlice.ts:267-333`, which is the only per-source *recovery* in the app; and the
   sharpest money defect (§7 D8) is a `.unwrap_or(0.0)` in Rust whose damage is only visible in a
   `budgetPct` computed in TypeScript three files away. **A client-only reading of this leaf would
   have missed both.** Recommend flipping `sides` to `both`. (`fusedAcrossSides: false` beside
   `twoSided: true` suggests the flag was inherited from one of the two merged leaves —
   `Partial failure envelope` / `Partial-failure disclosure` — rather than chosen.)
2. **"`Result<Vec<()>, AppError>` cannot express '5 of 8 landed'" — confirmed, and the brief pointed
   at the wrong half of the problem for this leaf.** It is true, and
   [`bounded-parallel-fan-out`](./bounded-parallel-fan-out.md) §7 D2 already owns it (the two
   `try_join_all` sites that push credentials to GitLab). But those are **writes**. On the *read*
   path the type does not forbid the true answer — it is never asked for it, because the failure has
   already been converted to `[]` **before** the combinator sees it, 68 times. **The dominant
   client-side shape is not a type that cannot express partiality; it is a value that has already
   erased it.** Which is why §9's signal is a `.catch`, not a return type.
3. **"convergence: diverged" — confirmed, but the oracle's first pass got Personas backwards on the
   UI clause, and the correction matters.** Sweeping the five siblings for "survivors + per-panel
   error" found it **only in `ascent`** and would have had this document report Personas as
   non-adherent. Personas **has** it — `pipelineErrors` + `PanelStatusChips` + `StalenessIndicator`
   — and the sweep missed it because ascent's version travels as a **prop** (`histError`) while this
   one travels as a **store key**. Two independent inventions, so the clause is 2 of 6, not 1 of 6.
   **A convergence sweep keyed on prop-threading cannot see an implementation that went through a
   store**, and I only caught it because the positive control forced me to name the compliant form
   before I trusted the oracle's verdict.
4. **"Check whether the five laws have an answer for [partial failure]" — they do not, and the
   sharper finding is that the neighbouring path's prescription *causes* the defect.**
   [`bounded-parallel-fan-out`](./bounded-parallel-fan-out.md) §2(c) says *"or at minimum a
   `.catch()` inside the map"* — correct for the combinator, and the cheapest way to satisfy it on a
   read is `.catch(() => [])`, which is this leaf's central defect 68 times over. That is doctrine
   §6 (*"two individually-correct golden paths can compose into a defect"*) measured on a live pair,
   and the reconciliation is one clause that fits in the neighbour's existing sentence: **catch into
   a tagged outcome, never into an empty value** — which its own named exemplar (`tryAttach`)
   already does. Offered upward rather than filed as a deviation here.
5. **"A prior path found the 'confident zero' shape … a partial read rendered as a complete one is
   the same defect wearing different clothes" — confirmed, and the clothes are load-bearing.**
   `empty-sample-as-confident-zero` (`metric-definition.md`) is **Rust-only** (`.rs`,
   `src-tauri/**`) and keys on `if n > 0 { a as f64 / b } else { 0.0 }`. The client-side form has no
   guard at all to key on — `entries.reduce(...) / entries.length` divides by a length that is
   nonzero and meaningless. **Zero file overlap, and the two rules cannot be merged**, because the
   Rust form is *a guard with the wrong else-branch* and the TypeScript form is *no guard at all*.
6. **"whether any aggregate is computed over a partial set and displayed as if complete — that last
   one is the sharpest, because it is silent" — confirmed, and it is worse than silent.** It is
   **directionally optimistic**: replayed, losing the healing source moved the score from 79 to
   **84** and the verdict from Degraded to **Healthy**. A read failure did not make the app look
   broken; it made the app look **better than it is**. That asymmetry is structural, not
   coincidental — every sub-score in this formula penalises *the presence of bad news*
   (`100 - openIssues*20`, `100 - anomalies*33`, `100 - failures*20`), so any source that fails to
   deliver bad news is scored as if the news were good. **Any composite built from "start at 100 and
   subtract problems" inverts a partial read into a health improvement.** That is a general result
   and it belongs in [`metric-definition`](./metric-definition.md) as well as here.
7. **A note on the shared denominator, so the next composer does not read a drift as a
   disagreement.** [`bounded-parallel-fan-out`](./bounded-parallel-fan-out.md), composed hours
   earlier at `c81519610`, reports **181** `Promise.*` combinator call sites and **122** literal
   tuples. At `629a914af` I measure **179** and **125** with an independently written parser, and
   the merged `rules.json` baseline for its rule reads **43** where its document says **44**. These
   are not contradictions — the tree moved between the two commits and the registry was ratcheted
   after the document was written. **A count in a golden path is a measurement at a commit, not a
   constant**, and both documents name their commit for exactly this reason. I re-measured rather
   than inheriting, and recommend the next composer do the same rather than citing either figure.
8. **A correction to my own instrument, offered because the doctrine asks for it.** The first
   version of the §9 pattern used a permissive `[\s\S]{0,240}?` window between `.catch(` and the
   empty literal. It reported 63 matches — a number I would have baselined — and one of them,
   `AgentCredentialDemands.tsx:39`, was a `.catch(toastCatch(...))` whose window had escaped the
   closing paren and matched `return null;` on an unrelated `if` four lines below. The fix was to
   temper the window to `[^{}]` so it cannot leave the handler's block, which cost one true positive
   (`useHealthCheck.ts:406`, a handler with a nested object literal). **The permissive matcher was
   not merely imprecise — it was reading a different file region than the one it claimed to.**
   Two implementations were what caught it: the balanced-paren parser could not produce that match
   at all, and the disagreement was the signal.
