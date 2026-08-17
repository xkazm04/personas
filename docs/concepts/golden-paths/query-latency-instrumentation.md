# Golden path — Query latency instrumentation

> Situation node: `data-persistence/query-performance/query-latency-instrumentation` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 from a ground-truth sweep of `src-tauri/**` and `src/lib/**` against `master`.
> Sweep size: **116 `.rs` files in `src-tauri/db/src/repos/`** (of the **963** in `rust.files`,
> [`shared-facts.json`](../shared-facts.json)) · **1,280 `pub`-visible fn declarations** parsed with a
> brace-matching scanner · **922 `timed_query!` blocks** · **4,027 rusqlite statement calls**
> (`query_row` / `query_map` / `execute` / `execute_batch` / `prepare` / `prepare_cached`, migrations
> excluded) each tested for whether it lies inside a timing wrapper · the frontend's parallel
> instrument (`tauriInvoke.ts`, `ipcMetrics.ts`, `IpcPerformancePanel.tsx`) · the tracing subscriber,
> the Sentry client options, and the r2d2 pool configuration.
>
> **A large part of this path is measured against RUNNING SOFTWARE.** Six days of the operator's real
> rolling tracing logs (`personas.2026-08-09.log` … `personas.2026-08-14.log`, in
> `%APPDATA%/com.personas.desktop/logs/`) were read to answer the question a source scan cannot:
> *does the threshold ever fire, and on what.* It fires **2,334 times in six days**. Per the
> [model-effort guide](../../development/model-effort-guide.md), *a gate that asserts data is not a
> gate on behaviour* — so the behaviour was observed.
>
> Dimensions: **performance · resilience · code-quality · cost**.
> A **convergence sweep** ran against `brainiac` (Rust · sqlx · Postgres), `personas-cloud`
> (TS · better-sqlite3) and `personas-web` (Next.js). **It inverted this document's central
> prescription** (§6) — the sibling evidence points at a *type*, not a macro, and the strongest
> version of that type already ships inside this repo's own frontend.
>
> **Sibling boundary, settled in prose.**
> [**Index design**](./index-design.md), composed 2026-08-13, owns **indexes** — which columns, in
> which order, whether the planner uses them, and the 583 `CREATE INDEX` statements. **This path owns
> measurement**: how a query's cost becomes a number, where that number goes, and what happens when it
> gets large. The boundary is clean and testable: *index-design tells you what to change; this path
> tells you how you would ever know you needed to.* Its §5 anti-pattern "indexing a boolean" and this
> path's log evidence meet at exactly one point — `personas::get_enabled` (the query
> `idx_personas_enabled` exists to serve) is the **second-largest producer of slow-query warnings in
> the operator's logs**, 497 canonical warns in six days. That is corroboration across two independent
> instruments, and it is recorded in §7 as a *lead*, not a diagnosis: the table holds 78 rows, so
> whatever costs 200 ms there is not the b-tree. Index-design's four measured claims are **confirmed,
> not assumed**, in §6.
> [**Paginated list query**](./paginated-list-query.md) owns bounding the fetch. An unbounded query
> that is perfectly measured is still unbounded.
> [**Command naming & placement**](./command-naming-placement.md) owns *where persistence code lives*,
> and its `persistence-handle-in-command-tree` census rule already counts 134 checkouts in the command
> tree. **That path is upstream of this one**: the 1,711 SQL statements outside `db/src/repos/` are
> unmeasurable *because* they are in the wrong layer, and the fix is theirs, not mine (§7).
>
> The **Deviations** section is a fix backlog.

## 1 Trigger

- "Is this slow, or does it just feel slow?"
- "This page got slower over the last few releases and I can't prove it"
- "I'm adding a repo function / a new table read"
- "Where do I put the timer?" / "should I log how long this took?"
- "Something is hanging and I don't know which query"
- "We have a slow-query warning — where does it go?"

If you are about to type `pool.get()`, `conn.prepare(`, `conn.execute(`, `stmt.query_map(` inside
`src-tauri/db/src/repos/`, or `let start = Instant::now()` anywhere near a database call — you are in
this situation.

**Not this path:** *whether the query has an index* is [index-design](./index-design.md). *Whether the
query is bounded* is [paginated-list-query](./paginated-list-query.md). *Whether the SQL should be in
this file at all* is [command-naming-placement](./command-naming-placement.md). Measure last; you
cannot instrument your way out of a full scan.

## 2 The one way

**Wrap the whole body of every repository function in `timed_query!("<table>", "<table>::<op>", { … })`
and write nothing else — no `Instant::now()`, no `elapsed_ms > 100` check, no `info!("took {}ms")`.**
The macro (`db/src/macros.rs:331-338`) starts a clock, evaluates your block, and hands the duration to
`perf::record_query`, which pushes a sample into a 2,048-entry ring (`db/src/perf.rs:52`), maintains
per-table avg / p95 / max, and emits `tracing::warn!("Slow DB query detected", table, operation,
duration_ms)` above `SLOW_QUERY_THRESHOLD = 100ms` (`perf.rs:53`) under a budget of five warns per
table per sixty seconds (`perf.rs:59-60`), closing each window with one consolidation line carrying the
suppressed count and the worst duration it hid. **The throttle is the whole point** — a retry storm
that emits three hundred warns a minute is indistinguishable from silence, and the operator's logs
show the budget doing its job 89 times in six days. Label the table with the **literal table name**
and the operation as **`<table>::<fn>`**, because the ring aggregates by the first argument and a
mislabelled sample lands in the wrong table's p95 forever; there are 127 distinct table labels today
and all 127 are string literals, which is the one respect in which this instrument is statically
auditable where indexes are not. **Do not put SQL outside `db/src/repos/`** — the macro only exists
there, 42.5% of the app's statements are outside it, and none of them are measured. Then stop: no
per-function threshold, no second timer, no `#[instrument]` for timing (46 exist in the repo layer and
none of them records a duration — `logging.rs:59-64` never sets `with_span_events`, so a span
contributes a context prefix and nothing more).

**And know what you have NOT bought.** `?` inside the macro's block returns from your *function*, not
from the block, so `record_query` never runs on the error path — **914 of the 922 blocks (99.1%)
contain a `?`**, which means the app measures successful queries and is structurally blind to failing
ones, including the 5-second pool-exhaustion stall at `db.get()?` that is the largest latency event it
can experience. The fix is not a discipline; it is a signature (see *Prefer a type over a gate*).

### Which clauses are physics, which are this house

Per the [contract](../golden-path-contract.md) and the
[portability test](../research/portability-test.md), a clause travels only if something else
reinvented it. Measured 2026-08-14 against `brainiac`, `personas-cloud` and `personas-web`.
Detail in §6.

| Clause | Warrant | Evidence |
|---|---|---|
| **Time at a chokepoint, not per call site** | **physics — three independent reinventions, and this repo holds one of them** | Personas' own frontend: `tauriInvoke.ts:513,:517` records every IPC call, on **both** the success and the failure path, from inside the single wrapper ESLint forces every caller through. `brainiac`'s `meter_op` (`crates/brainiac-gateway/src/providers/mod.rs:128-154`) is a generic `Future` wrapper you cannot get a provider result without passing through. `personas-web`'s `rows<T>()` (`src/lib/supabaseApi.ts:56-63`) and `orchestratorFetch` (`src/lib/api.ts:57-128`) are total-coverage chokepoints. Four codebases, four stacks, the same shape |
| **Record on the FAILURE path too** | **physics, and this repo is the outlier** | `tauriInvoke.ts:517` records `ok:false` with the elapsed time. Nothing else in the fleet does: `personas-web` throws `API request timed out: ${path}` (`api.ts:112-113`) carrying neither the elapsed nor the threshold; `personas-cloud`'s facade caps at 30 s (`facade/main.py:35`) and never looks at the clock; `brainiac` has no error-path timer. Personas' **backend** loses it in 914 of 922 blocks. **The one implementation in the fleet that gets this right is in this repo, in the other language** |
| **A budgeted / throttled warn, not a raw one** | **house — nobody else has one, because nobody else has a threshold** | `perf.rs:59-60,:87-115` — 5 per table per 60 s plus a rollover consolidation line. `brainiac`: **no duration threshold anywhere** (searched `SLOW_`, `_THRESHOLD`, `log_slow` — zero). `personas-cloud`: **no slow-query constant exists**. `personas-web`: none. Measured value in this tree: **89 rollover lines in six days**, i.e. the budget engaged 89 times |
| **Percentiles, not just a threshold** | **physics** | Personas backend p95 (`perf.rs:184-188`), Personas frontend p50/p95/p99 (`ipcMetrics.ts:70-74`), `personas-cloud` p50/p95/p99 (`metrics.ts:386-390`), `personas-web` p50/p95/p99 (`useLatencyData.ts:11-20`), `brainiac` p50/p95 in SQL (`retrieval_events.rs:124-147`). **Five independent `percentile()` implementations across four repos** — nearest-rank in three, linear-interpolated in one, `percentile_disc` in one. Nobody shares one and everybody needs one |
| **Keep a lifetime counter separate from the ring** | **physics — and the frontend already fixed the bug the backend still has** | `ipcMetrics.ts:36-42` carries never-evicted `totalRecords` / `totalTimeouts` / `totalErrors` with a comment stating exactly why deriving lifetime rates from a ring is wrong. `DbPerfSnapshot.total_queries` (`perf.rs:164-181,:214-220`) is summed **from ring residents**, so it silently caps at 2,048 while claiming to be a total. `personas-cloud` hit the same wall and solved it the same way (`metrics.ts:10` `LATENCY_WINDOW_SIZE`) |
| **Persist latency across restarts** | **unvalidated here; the one repo that does it gains nothing** | Personas: in-memory only, both instruments. `brainiac` writes every retrieval latency to a durable Postgres table (`retrieval_events.latency_ms`, `migrations/0043_retrieval_events.sql:68`) with no retention policy — and **no human ever reads it** (§6). Durability is not the missing piece |
| **Surface the number to a human** | **physics by unanimous failure — all four repos collect and none display** | Personas backend: `getDbPerformance` zero callers. Personas frontend: a finished panel, mounted nowhere. `brainiac`: p50/p95 reach the OpenAPI contract and the generated TS types and are **dropped by the client mapper** (`console/src/observatory/observatory-data.ts:35-51`). `personas-cloud`: Prometheus endpoint with no DB metric in it. `personas-web`: `tracesSampleRate: 0`. **Four for four.** This is the most replicated finding in the sweep |

## 3 Mandated primitives

**Exist today — use them:**

- **`db/src/macros.rs:331-338` `timed_query!`** — the wrapper. Three arguments: table literal, operation
  literal, block. Records unconditionally after the block evaluates. **This is the only thing you write.**
- **`db/src/perf.rs:241-278` `record_query`** — the sink. Threshold, per-table warn budget, rollover
  consolidation, ring push. Well built; do not call it directly (four macro-generated call sites already
  do, `macros.rs:159,:191,:218,:291`).
- **`db/src/perf.rs:156-221` `RingBuffer::snapshot`** — per-table avg / p95 / max / `last_slow_operation`,
  sorted by max descending. Correct nearest-rank p95.
- **`db/src/macros.rs:141-311` `crud_get_by_id!` / `crud_get_all!` / `crud_delete!` / `crud_update!`** and
  **`:376-559` `lab_crud!`** — **generate instrumented functions.** 28 CRUD invocations plus 5 `lab_crud!`
  (7 functions each) produce **63 timed repo functions that contain no `timed_query!` text**, so they are
  invisible to grep and to §9's rule, and they are not a gap. Reach for these before hand-writing CRUD.
- **`db/src/repos/communication/alert_rules.rs:35-59` `list_alert_rules`** — **the one site to copy.**
  Signature, `timed_query!` opening on the first line of the body, table literal matching the table,
  operation spelled `alert_rules::list_alert_rules`, whole body inside, nothing else.
- **`src/lib/tauriInvoke.ts:434-537` `_invokeCore`** — **the reference implementation of this entire
  doctrine, in the other language.** One clock, both paths recorded, no call site involved. Read it
  before you argue that per-call-site timing is the only option in a codebase this size.
- **`src/lib/ipcMetrics.ts`** — the frontend ring: 500 samples, p50/p95/p99 per command, lifetime
  counters kept separate from the window, and a subscriber list so a React surface can render live.
- **`src/lib/design/statusTokens.ts:200-205` `latencyToHealth`** — the shared four-band latency ladder
  (`<50ms` healthy · `<200ms` info · `<1s` warning · `≥1s` critical). **Use these bands** when you
  present a duration; do not invent a fifth threshold.
- **`src/features/overview/sub_observability/components/IpcPerformancePanel.tsx`** — 255 lines of
  finished latency UI: sortable `UnifiedTable`, band filter, p50/p95/p99, health-token colouring,
  i18n keys. It is the consumer `DbPerfSnapshot` needs, already written. It is also orphaned (§7).
- **`src-tauri/src/logging.rs:55-90`** — the sink of last resort. Default filter
  `info,personas_desktop=debug`, so a `WARN` **always** passes; stdout + a daily rolling file capped at
  **7 files** (`:40`); `sentry_tracing` maps `WARN` to a **breadcrumb**, `ERROR` to an event (`:76-80`).
- **`%APPDATA%/com.personas.desktop/logs/personas.<date>.log`** — the operator's real slow-query
  history. `grep "Slow DB query detected"` answers in one second what a week of reasoning cannot.

**Do not exist — this path names them:**

- **A timing chokepoint that cannot be bypassed.** A `RepoPool::scope(table, op, |conn| …)` that is
  the only way a repo function obtains a connection. See *Prefer a type over a gate* — this is the
  single highest-value item in the document, it repairs the error-path hole for free, and three
  sibling codebases plus this repo's own frontend have already built its shape.
- **Any consumer of `DbPerfSnapshot`.** One import line away (§7).
- **Any test of `perf.rs`.** The file contains **zero** `#[cfg(test)]` blocks. The p95 index arithmetic,
  the ring wraparound at 2,048, the warn budget and the rollover consolidation are all unasserted.

## 4 Steps

1. **Check you are in the repo layer.** If your SQL is in `src-tauri/src/commands/**`, stop and read
   [command-naming-placement](./command-naming-placement.md) first. Measurement is downstream of
   placement: **1,711 of the app's 4,027 statements (42.5%) sit outside `db/src/repos/` and not one is
   instrumented**, and no wrapper you add locally will change that.
2. **Ask whether the primitive already writes the function for you.** `crud_get_by_id!`,
   `crud_get_all!`, `crud_delete!`, `crud_update!`, `lab_crud!` emit instrumented bodies. 63 functions
   in the tree came from them. A hand-written `get_by_id` is both more code and a coverage risk.
3. **Ask the type-over-gate question here, before you write the wrapper.** If you are adding a *new*
   repo module rather than one function, the wrapper is the wrong unit — see below. The measured gap is
   **file-shaped, not function-shaped**: `twin.rs` is 38 of 39 uninstrumented, `research_lab.rs` 25 of
   25, `orchestration/team_assignments.rs` 24 of 24, while `executions.rs`, `events.rs` and
   `triggers.rs` are near-total. A module either adopted the macro or never met it. Nothing about a
   per-function habit fixes a per-module blind spot.
4. **Wrap the entire body**, first line to last:
   ```rust
   pub fn list_alert_rules(db: &DbPool) -> Result<Vec<AlertRule>, AppError> {
       timed_query!("alert_rules", "alert_rules::list_alert_rules", {
           let conn = db.get()?;
           …
           rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
       })
   }
   ```
   The `pool.get()` **must be inside** the block. Connection acquisition is latency; a timer that
   starts after the checkout measures the cheap half.
5. **Label it `("<table>", "<table>::<fn_name>")`.** The first argument is the ring's aggregation key.
   36 of the tree's literal-literal pairs disagree with this convention (`table="dev_kpi_measurements"`
   paired with `op="dev_kpis::list_kpi_measurements"`, `dev_tools.rs:6943`) — harmless for the table
   rollup, but it means an operation name no longer tells you which table's p95 it moved.
6. **Write nothing else.** No `Instant::now()`. No `if elapsed_ms > 100`. No `info!(duration_ms = …)`.
   Four functions in `personas.rs` broke this rule and it is measurably the worst thing in this leaf
   (§7 P0): **871 of the 2,334 slow-query warn lines in six days of real logs come from those four
   hand-rolled duplicates**, unthrottled, for queries the canonical instrument was already reporting.
7. **Decide nothing about the threshold.** 100 ms is set once, in `perf.rs:53`. If you believe your
   query deserves a different one, you are describing a *band*, and the bands already exist:
   `latencyToHealth` (`statusTokens.ts:200-205`).
8. **If you need the number in a UI, do not add a second IPC command.** `get_db_performance`
   (`commands/infrastructure/system/mod.rs:79`, registered `lib.rs:3020`) already returns the whole
   snapshot and is already bound (`src/api/system/system.ts:96`). It has never been called.
9. **Verify it fires.** Run the app, then:
   ```
   grep "Slow DB query detected" %APPDATA%/com.personas.desktop/logs/personas.*.log
   ```
   `table=<yours> operation=<yours>::<fn>` is the answer you want. Nothing is the *expected* answer for
   a fast query — which is why step 6 matters: a hand-rolled `if elapsed > x` warn is how you convince
   yourself the instrument works while actually testing your own copy of it.
10. **Stop.** No persistence layer for the samples. No dashboard. No new threshold. No `#[instrument]`
    added "for timing" — it does not time.

## 5 Anti-patterns

- **Hand-rolling a timer inside a `timed_query!` block — 4 sites, and they generate more log volume
  than the entire canonical instrument.** `personas.rs:697-707` starts a second `Instant`, computes
  `elapsed_ms`, emits a `debug!`, and then `if elapsed_ms > 100 { tracing::warn!(…) }` — the same
  threshold, hardcoded a second time, **outside the five-per-minute budget**. Measured in the
  operator's logs over six days: `personas::get_enabled` produced **497** canonical warns (throttled)
  and **852** hand-rolled ones (unthrottled). The duplicate is 1.7× louder than the mechanism it
  duplicates, and every one of those 852 lines is also a Sentry breadcrumb (`logging.rs:78`) competing
  for a bounded buffer with the breadcrumbs that would explain an actual crash. The failure mode is
  not "redundant code"; it is *the throttle you built gets defeated by the copy of it you forgot you
  wrote*.
- **Putting `?` in the block and believing the error path is measured.** `timed_query!`'s third
  argument is a **block**, not a closure, so `?` returns from the enclosing function and
  `record_query` is skipped entirely. **914 of 922 blocks (99.1%) contain one.** The consequence is not
  academic: `let conn = db.get()?` is the **first** line of nearly every block, `POOL_ACQUIRE_TIMEOUT`
  is 5 seconds (`db/src/lib.rs:94`), and pools are sized 12 / 8 / 4 / 2 (`:314,:511,:384,:1952`) — so
  the single worst latency event the app can produce, five seconds of pool starvation, is the one
  event this instrument is structurally incapable of recording. A closure boundary fixes it; a code
  review cannot.
- **Reading `DbPerfSnapshot.totalQueries` as a lifetime total.** It is summed from ring residents
  (`perf.rs:164-181`), so it saturates at 2,048 and then stops moving while the app keeps running.
  `totalSlowQueries` has the same shape. The frontend hit this exact bug, diagnosed it in a comment,
  and fixed it with never-evicted counters (`ipcMetrics.ts:36-42`) — **in the same repo, in the same
  wave, and the backend still carries it.** Both fields are also `bigint` in the binding
  (`src/lib/bindings/DbPerfSnapshot.ts:4`, [persisted-model-struct](./persisted-model-struct.md) rule
  A), so the first consumer starts with a coercion on a number that is wrong anyway.
- **Adding `#[instrument]` to time something.** 46 exist in `db/src/repos/`. `logging.rs:59-72` never
  calls `with_span_events`, so no span emits an open or close event and no duration is recorded. What
  they do produce is the `get_enabled:` prefix visible on the warn lines — real context, zero timing.
  A reader who sees 46 `#[instrument]` attributes and concludes the repo layer is traced is wrong, and
  the attribute gives no hint of it.
- **Timing the handler instead of the query.** `execution_metrics::get_summary`
  (`execution/metrics.rs:392-403`) wraps `timed_query!` around a call to
  `get_summary_with_conn(&conn, …)?` and adds an `info!(duration_ms = …)`. The number covers a
  connection checkout plus an arbitrary composite of reads. `brainiac` does exactly this at all three
  of its timed sites (`http.rs:373`→`:458` spans an embedding model call, a reranker, and four DB
  round-trips) and the result is a number from which a database regression cannot be extracted. One
  number per table per operation, or the p95 means nothing.
- **Writing SQL outside `db/src/repos/`.** 1,711 statements, 245 of them in `src/companion/brain`
  alone, 240 in `src/commands/core`. None measured, none measurable without moving them. This is
  [command-naming-placement](./command-naming-placement.md)'s deviation and its `persistence-handle-in-command-tree`
  rule already counts 134 of the checkouts. **It is named here because observability coverage is a
  downstream consequence of layer discipline, and 42.5% is the size of that consequence.**
- **Believing an instrument that nothing reads.** The most expensive way to be wrong about performance
  is to have a correct, well-throttled, per-table p95 that no human has ever seen. All four repos in
  this fleet do this. See §6, and note that the fix here is one import statement.
- **Assuming a warn is a durable record.** It is not. Stdout dies with the process; the file rolls
  after **7 days** (`logging.rs:40` — the operator's directory holds exactly 6); and the Sentry
  breadcrumb is transmitted only if some **later ERROR event** occurs in the same session, otherwise
  it is discarded at session end (`logging.rs:76-80`). A p95 that climbs from 8 ms to 40 ms over three
  releases crosses no threshold, produces no warn, and leaves no trace anywhere.

## 6 Evidence

**Adoption.** `922` `timed_query!` blocks in `db/src/repos/` (930 in `src-tauri` total; the other 8 are
in `macros.rs` — 1 definition and 7 inside `lab_crud!`). **918 distinct functions** contain at least
one, against **1,280 `pub`-visible fn declarations** (1,270 by a line-anchored `pub fn` count) —
**71.7 %**. Statement-level: **1,677 of the 2,316** rusqlite calls inside `db/src/repos/` lie within a
timing wrapper — **72.4 %**. Against the whole app's 4,027 non-migration statements: **41.6 %**.
Three independently derived denominators converging on ~72 % for the repo layer is the reason to
trust any of them. 63 further functions are instrumented by the CRUD macros and appear in none of
these counts. 127 distinct table labels, **all 127 string literals** — no `format!`-built label exists,
so unlike the 18 invisible indexes ([index-design](./index-design.md) §7), this instrument's vocabulary
is fully visible to static analysis.

- **`db/src/repos/communication/alert_rules.rs:35-59` — copy this one.** The canonical shape: wrapper
  on the first line of the body, `pool.get()` inside it, table and operation literals agreeing,
  nothing else in the function.
- **`db/src/perf.rs:241-278` `record_query`** — threshold, budget, rollover consolidation carrying the
  suppressed count and worst duration, then the ring push. The consolidation line is a design most
  logging code never reaches, and it is doing real work: **89 rollover lines in six days**.
- **`db/src/macros.rs:376-559` `lab_crud!`** — 7 pre-instrumented functions from one invocation, used
  5 times. The right answer to "how do I get coverage without remembering".
- **`src/lib/tauriInvoke.ts:441` / `:513` / `:517`** — `const start = performance.now()` at the top of
  the one call path, `recordIpcCall({ … ok: true })` in the resolve arm, `recordIpcCall({ … ok: false,
  timedOut })` in the reject arm. Coverage is 100 % and **cannot regress**, because `no-restricted-imports`
  forbids raw `invoke` (`.claude/CLAUDE.md` § Tauri IPC). This is the whole doctrine of this document,
  implemented, in this repo, in TypeScript.
- **`src/lib/ipcMetrics.ts:36-42`** — the comment explaining why a ring cannot produce a lifetime rate,
  and the three never-evicted counters that fix it. The backend has the bug this comment describes.
- **Six days of `personas.*.log`** — 1,374 `Slow DB query detected` + 89 rollover + 871 hand-rolled
  duplicates = **2,334 warn lines**. Duration distribution of the 1,374: **min 100 ms, p50 178 ms,
  p95 1,115 ms, max 12,066 ms**. By table: `persona_events` 600, `personas` 514, `dev_workspaces` 50,
  `persona_triggers` 45, `persona_credentials` 40. By operation: `persona_events::get_recent` **560**,
  `personas::get_enabled` **497**, `dev_workspaces::seed_practice_context_cells` 38. Daily counts range
  100–365. **The threshold fires roughly 230 times a day and no one has ever looked.**

### Confirming [index-design](./index-design.md)'s four claims about this territory

Verified independently, because the brief asked and because a number repeated is not a number checked.

| Claim | Verdict |
|---|---|
| `timed_query!` wraps **922 of 1,266 repo fns (72.8 %)** | **Confirmed with a correction to the units.** 922 is the count of `timed_query!` *blocks*, not functions — 918 distinct functions carry them. The denominator is 1,270 line-anchored `pub fn` (1,280 including `pub(crate)`), not 1,266. The ratio survives: **71.7–72.4 %** depending on whether you count functions or statements. Nothing rests on the fourth significant figure, and the corrected figure is if anything slightly worse |
| 2,048-sample ring, per-table p95, 100 ms warn | **Confirmed exactly.** `perf.rs:52`, `:184-188`, `:53`. The p95 is nearest-rank and correct. The 100 ms constant is *also* hardcoded four more times by hand (§7 P0), which index-design had no reason to see |
| **`getDbPerformance` has ZERO callers in `src/`** | **Confirmed, and it is worse than stated** — see below |
| `PRAGMA analysis_limit = 1000` + idle `PRAGMA optimize`; both siblings have run `ANALYZE` zero times | **Confirmed as present** (`db/src/lib.rs:207`, `:226-259`). The sibling half is index-design's measurement and this sweep found nothing contradicting it; my own sweep adds that `brainiac` has no query timer either, so it is behind on both axes |
| 18 live indexes built by `format!` are invisible to static analysis | **Their territory; not re-derived.** The analogous check in *mine* comes out the other way: 127 of 127 `timed_query!` table labels are literals, so no equivalent blind spot exists here |

### The `getDbPerformance` finding, characterised properly

The brief called this "the sixth sighting this wave of a better answer that already exists unused."
**That characterisation is wrong for this case, and the difference matters.** The other five are
*routing* failures — a good primitive exists and call sites do not reach for it. Here:

1. The **instrument** is complete: ring, per-table p95, threshold, throttle, consolidation line,
   `#[derive(TS)]` binding, a registered IPC command (`lib.rs:3020`), a typed frontend wrapper
   (`src/api/system/system.ts:96`).
2. A **consumer is also complete** — a different one. `IpcPerformancePanel.tsx` is 255 lines of
   finished latency UI with p50/p95/p99, a band filter, sorting, i18n keys and health tokens.
3. **And that panel is orphaned too.** Its only mount is `ObservabilityDashboard`, and
   `ObservabilityDashboard` **is not imported anywhere in `src/`** — the only references in the entire
   tree are its own barrel (`sub_observability/index.ts:1-2`), a README line, and two comments. One of
   those comments, `src/lib/analytics/navCatalog.ts:73`, asserts *"the ObservabilityDashboard component
   is mounted elsewhere"*. It is not. It is mounted nowhere.

So the class is not "an unused better answer". It is: **this repo built the same instrument twice —
once by discipline for the backend and once structurally for the frontend — finished the expensive
90 % of both, and shipped neither to a human. In both cases the last mile is a single import line.**
And the reason it stayed that way is structural, not cultural: a React component with zero importers
type-checks, lints, builds, passes every census rule and ships. **Nothing in this repo's pipeline
fails when a completed observability surface is never mounted** — which is exactly why the thing
being unobserved is the observability.

### Convergence — what three sibling repos did without reading this

Run 2026-08-14, read-only, against `brainiac` (Rust · sqlx · Postgres · 176 store functions),
`personas-cloud` (TS · better-sqlite3 · 110 `.prepare()` calls) and `personas-web` (Next.js).
**It contradicted this document's central prescription and I am changing the prescription rather than
the finding.**

- **The macro is NOT the physics. The chokepoint is.** This document was going to prescribe
  "wrap every repo function in `timed_query!`" as doctrine. Four codebases say the unit is wrong.
  `brainiac`'s `meter_op` (`providers/mod.rs:128-154`) is a generic `async fn(…, fut: F) -> Result<T>`
  that times any future and **cannot be forgotten**, because there is no other way to obtain a
  provider result. Its coverage of the LLM boundary is total. Its coverage of the *database* is
  **0 of 176 store functions**, because it was never applied there — brainiac proved the pattern and
  then did not reuse it. `personas-web` built `rows<T>()` (four lines, every Supabase read passes
  through it) and `orchestratorFetch` (all ~24 client methods) for **error normalisation**, and both
  sit one line from full latency coverage. Personas' own `_invokeCore` is the same shape and *does*
  take that line. **A convergent idiom can be a shared trap: all four repos independently discovered
  that a chokepoint is the right place to measure, and three of four independently declined to
  measure there.** The prescription that survives is not "remember the macro" — it is "own the
  handle".
- **Personas is genuinely, measurably ahead — and it is the only claim in this document where the
  sibling sweep found nothing to teach us.** Personas has 922 timed queries, a threshold, a throttle,
  per-table p95 and a rollover consolidation. `brainiac` has **zero** DB timers, **zero** thresholds
  of any kind, and its only per-statement timing in production is an *unchosen library default*:
  `crates/brainiac-store/src/lib.rs:85-86` sets `.log_statements(Debug)` and never calls
  `log_slow_statements`, so sqlx's own 1-second WARN applies — a threshold nobody picked, undocumented
  anywhere in that repo. `personas-cloud`'s `metrics.ts` is 390 lines and contains **no database timer
  at all**; its 110 `.prepare()` calls have no wrapper to add one to, and better-sqlite3's `profile`
  hook — which would hand it universal timing for free — is unused. `personas-web` has no owned DB.
  Instrumenting `personas-cloud` today costs 110 edits; instrumenting `personas-web` costs 3.
- **Capping the wait is universal; recording the wait is not.** Across the fleet: `personas-web`'s
  15 s `AbortController` (`api.ts:97-101`), `personas-cloud`'s 30 s httpx cap
  (`facade/main.py:35`) applied through a *true* universal proxy (`facade/proxy.py:9-33`) that has no
  clock in it, `brainiac`'s 15 s `AbortSignal.timeout` (`console/src/lib/api.ts:106`), Personas'
  90 s `Promise.race`. **Only Personas' `tauriInvoke` records the elapsed time when the cap trips**
  (`:517`, `timedOut: true`). `personas-web` throws `API request timed out: ${path}` — a message
  carrying neither the elapsed nor the limit. **"We cap the wait" and "we record the wait" are
  different capabilities and the fleet has thoroughly confused them.**
- **Nobody displays it. Four for four.** `brainiac` computes `p50_latency_ms`/`p95_latency_ms` in SQL
  (`retrieval_events.rs:124-147`), publishes them in `openapi.json:3546,3553`, generates TS types for
  them, fetches them in `console/src/lib/api.ts:213-214` — and **drops them in the client mapper**
  (`console/src/observatory/observatory-data.ts:35-51` maps seven other fields and not these two;
  `DemandView` has no latency field). `personas-cloud` exposes Prometheus summaries containing zero
  DB metrics. `personas-web` sets `tracesSampleRate: 0` in all three runtimes
  (`src/lib/sentry.ts:7`), registers no `browserTracingIntegration`, and documents the choice
  (`docs/features/infrastructure/error-monitoring-analytics.md:47`); its Performance tab charts
  *agent-execution* durations synced from the desktop app, and **the fetch that pulls those 2,000
  latency rows is itself untimed**. Personas measures twice and mounts neither panel. **A prescription
  reinvented four times and abandoned four times at the same step is not a taste — it is a structural
  hazard of the situation**, and §9 refuses to gate it while naming the two-line fix.
- **Persistence is not the missing piece.** `brainiac` is the only repo whose latency survives a
  restart — durable Postgres rows with, as far as this sweep could find, no retention policy — and it
  is no better off than the three in-memory rings, because the read path ends in a mapper that ignores
  the column. Worse, the p50/p95 query at `retrieval_events.rs:130-131` sorts `latency_ms`, which
  `migrations/0043` does not index: **the latency query is itself an unmeasured slow-query candidate.**
- **The error path is where this repo is unusually good and unusually bad at once.** `tauriInvoke.ts:517`
  is the *only* implementation in the fleet that records a duration for a failed call. Personas'
  own backend loses it in 99.1 % of blocks. The same repo holds the best and the worst answer to the
  same question, in two languages, ~300 metres apart in the file tree.
- **Where the siblings are worse, plainly.** `personas-cloud` persists one duration — event-processing
  ms, JSON-stringified into a free-text `event_audit_log.detail` column
  (`eventProcessor.ts:212,:285`) that nothing parses, aggregates or charts. `brainiac`'s three timed
  sites conflate an embedding call, a reranker call and four SQL round-trips into one number.
  `personas-web` has three total-coverage chokepoints and instruments none of them.

## 7 Deviations found

### P0 — a hand-rolled duplicate of the instrument, defeating its throttle, in live logs

| Path | Defect |
|---|---|
| `db/src/repos/core/personas.rs:446-455`, `:645-658`, `:697-707`, `:1438-1450` | Four functions open a **second** `Instant::now()` *inside* their `timed_query!` block, recompute `elapsed_ms`, and emit `tracing::warn!("<op> exceeded 100ms threshold")` from a hand-written `if elapsed_ms > 100`. The threshold duplicates `perf.rs:53`; the warn duplicates `perf.rs:259`; and because it does not route through `evaluate_warn`, it **bypasses the 5-per-table-per-60s budget entirely**. **Measured in the operator's real logs, 2026-08-09 → 2026-08-14:** `personas::get_enabled exceeded` **852** lines, `personas::get_all exceeded` 10, `personas::get_summaries exceeded` 9 — **871 total, against 1,374 lines from the entire canonical instrument across all 127 tables.** The duplicate is 63 % as loud as everything else combined, and for `get_enabled` alone it is **1.7× louder** than the throttled path reporting the identical event (852 vs 497). Every one of those 871 lines is also a Sentry breadcrumb (`logging.rs:78`) in a bounded buffer, evicting the breadcrumbs that would explain a real error. **Fix:** delete lines `453-455`, `656-658`, `705-707`, `1444-1450` and the four `Instant::now()` / `elapsed_ms` bindings that feed them. The canonical instrument already reports all three operations. This is four deletions and it removes 37 % of the app's warn volume. |

### P1 — the error path is not measured, in 99.1 % of instrumented queries

`timed_query!` (`macros.rs:332-337`) expands to `let _tq_start = …; let _tq_result = $body;
record_query(…); _tq_result`. `$body` is a **block**, so `?` inside it returns from the enclosing
*function* and `record_query` is never reached.

```
timed_query! blocks in db/src/repos/            922
…containing at least one `?` propagation        914  (99.1%)
```

Measured against the canonical example (`alert_rules.rs:36-58`): three `?` operators — `db.get()?`,
`conn.prepare(…)?`, `stmt.query_map(…)?` — each of which discards the measurement. The severity is
not "we lose some samples"; it is **specifically the slowest events that are lost**:
`POOL_ACQUIRE_TIMEOUT` is 5 s (`db/src/lib.rs:94`) on pools of 12 / 8 / 4 / 2
(`:314,:511,:384,:1952`), so a saturated pool produces a five-second stall at the block's first line
and records nothing. `SQLITE_BUSY` under WAL contention has the same shape. **The instrument's blind
spot is exactly the failure mode it exists to detect**, and no amount of care at the call site closes
it — see *Prefer a type over a gate*.

### P2 — the instrument reaches no human, and the UI that would show it is orphaned

| Path | Defect |
|---|---|
| `src/api/system/system.ts:96` | `getDbPerformance` — **zero callers in `src/`.** The only other occurrences of the symbol anywhere are its own definition, its type import at `:10`, and two lines of [index-design](./index-design.md). A 2,048-sample ring with per-table p95, reachable by a registered command (`lib.rs:3020`) that nothing invokes |
| `src/features/overview/sub_observability/components/ObservabilityDashboard.tsx` | **Not imported anywhere in `src/`.** Exported twice by `sub_observability/index.ts:1-2`; the barrel is never imported. It is the sole mount point of `IpcPerformancePanel`, so the frontend's *working, structurally-complete* latency instrument is also invisible |
| `src/lib/analytics/navCatalog.ts:73` | The comment states *"the ObservabilityDashboard component is mounted elsewhere"* as the justification for removing `observability` from `OverviewTab`. **It is mounted nowhere.** The comment is the only documentation of the component's status and it is false |
| `src/features/overview/README.md:47` | Lists `ObservabilityDashboard` and `IpcPerformancePanel` among the feature's panels, with no indication that neither renders |

**Fix, in order:** (1) restore an `observability` case in the Overview router, or mount
`IpcPerformancePanel` directly in an existing tab — one import plus one JSX line; (2) add a DB tab to
that panel fed by `getDbPerformance`, reusing `latencyToHealth` and `UnifiedTable`, which is where the
snapshot was always meant to go; (3) correct `navCatalog.ts:73`.

### P3 — `DbPerfSnapshot.totalQueries` is a window presented as a total

`perf.rs:164-181` accumulates `total_queries` by summing per-table counts **of ring residents**, and
`:214-220` returns it beside `buffer_capacity: 2048`. Past 2,048 queries — which the operator's
install passes within seconds of boot — the field stops growing while the app keeps running.
`total_slow_queries` is identically shaped, so the derived "slow rate" is a rate over the last 2,048
samples labelled as a lifetime figure. **The frontend already diagnosed and fixed this exact bug**
(`ipcMetrics.ts:36-42`, three never-evicted counters plus a comment explaining why the ring cannot
answer it). Fix: two `AtomicU64`s in `perf.rs` incremented in `record_query`, returned as
`lifetime_queries` / `lifetime_slow_queries`. Both fields are additionally `bigint` in the binding
(`src/lib/bindings/DbPerfSnapshot.ts:4`), so the first consumer inherits a coercion on a wrong number.

### Uninstrumented repo functions — 245 sites, and the gap is a module-level accident

Measured by two independent implementations that **reconcile exactly** (§9): a brace-matching parser
finds 234 `pub fn`s that hold SQL in their own body with no `timed_query!`; the census regex finds 245,
and the 11-match difference is precisely the spans where the SQL lives in a private helper declared
immediately below the matched `pub fn`.

| Table | Uninstrumented | Total `pub fn` |
|---|---:|---:|
| `db/src/repos/twin.rs` | **38** | 39 |
| `db/src/repos/research_lab.rs` | **25** | 25 |
| `db/src/repos/orchestration/team_assignments.rs` | **24** | 24 |
| `db/src/repos/resources/remote_jobs.rs` | 11 | 15 |
| `db/src/repos/dev_tools.rs` | 11 | 177 |
| `db/src/repos/resources/automation_suggestions.rs` | 10 | 10 |
| `db/src/repos/resources/owned_devices.rs` | 10 | 12 |
| `db/src/repos/dev_workspaces.rs` | 10 | 61 |
| `db/src/repos/system_ops.rs` | 9 | 9 |
| `db/src/repos/orchestration/assignment_outcomes.rs` | 9 | 9 |
| `db/src/repos/execution/policy_proposals.rs` | 7 | 7 |
| …26 more files | 81 | — |

**Every hypothesis about *why* these are the ones was tested and failed.**

- **Not age.** `git log --diff-filter=A` on the extremes: `executions.rs`, `events.rs` and
  `personas.rs` are the three oldest repo modules (**2026-02-19**) and are near-fully covered;
  `twin.rs` (2026-04-09) and `research_lab.rs` (2026-04-12) are older than several covered modules and
  have zero coverage; `automation_suggestions.rs` and `policy_proposals.rs` (both **2026-07-31**) are
  among the newest and have zero. The correlation is negative if anything.
- **Not hotness.** The six-day log shows the slow-query load concentrated on `persona_events` (600
  warns) and `personas` (514) — both in **covered** modules. Of the 36 uncovered files, exactly one
  (`dev_workspaces.rs`) appears in the warn distribution at all.
- **Not table size.** `twin_*`, `research_*` and `team_assignment_*` tables are small today.
- **What it actually is: file-shaped.** Nine of the 36 files are **100 % uninstrumented** and several
  covered files are 100 % instrumented. A module either met the macro or did not. That is an
  onboarding property of the primitive, not a discipline property of the authors — which is precisely
  the argument for making the handle own the timing instead of the author.

### Structural

- **42.5 % of the app's SQL is outside the instrumented layer.** 1,711 of 4,027 non-migration rusqlite
  statement calls live outside `db/src/repos/`: `src/companion/brain` 245, `src/commands/core` 240,
  `src/commands/infrastructure` 142, `src/commands/companion` 127, `src/commands/design` 88,
  `src/companion/proactive` 59, `src/mcp_server/tools.rs` 49, `db/src/lib.rs` 47. **Zero are
  instrumented** — `record_query` is referenced from exactly three files in the whole tree
  (`macros.rs`, `perf.rs`, `commands/infrastructure/system/mod.rs`). The remedy is
  [command-naming-placement](./command-naming-placement.md)'s, not this path's, and its
  `persistence-handle-in-command-tree` rule already ratchets 134 of the checkouts. **Named here so
  that nobody quotes "72 % coverage" as an app-level figure. The app-level figure is 41.6 %.**
- **`perf.rs` has zero tests.** No `#[cfg(test)]` block exists in the file. The nearest-rank p95, the
  ring wraparound at 2,048, the 5-per-60s budget, the rollover consolidation, and the
  `max_suppressed_ms` accounting are all unasserted, in a module whose output the app cannot check for
  itself.
- **36 label pairs disagree with their own convention.** `timed_query!("dev_kpi_measurements",
  "dev_kpis::list_kpi_measurements", …)` (`dev_tools.rs:6943` and 8 siblings),
  `("workspace_knowledge", "dev_workspaces::list_knowledge")` (`dev_workspaces.rs:568`), 24 more. The
  table rollup stays correct; the operation name stops identifying its own table.
- **46 `#[instrument]` attributes in the repo layer record no duration**, because `logging.rs:59-72`
  never enables span events. They look like timing to every reader and to every future maintainer.
- **A global mutex on the measurement path.** `record_query` takes `RING.lock()`
  (`perf.rs:224-237,:270`) on every instrumented query across a 12-connection pool. Not observed to be
  a problem, and unmeasurable from inside — the instrument cannot time itself.
- **Zero gating.** `npm run check`, `lefthook.yml` and `cargo clippy -D warnings` have no opinion about
  whether a query is measured. Every deviation above shipped green.

## 8 Gaps in the primitive

1. **`timed_query!` cannot see the error path, and no macro can.** `?` inside a block escapes to the
   enclosing function; only a closure or an `async` boundary converts it into a value the wrapper can
   observe. This is a property of Rust, not of the macro's author, and it is why the fix in
   *Prefer a type over a gate* is a signature change rather than a better macro.
2. **The macro is optional and therefore file-shaped.** Nothing about `pub fn f(pool: &DbPool)`
   suggests a timer belongs in it. Nine repo modules are 100 % uninstrumented; the primitive gives an
   author no moment at which its absence is noticeable.
3. **The ring has no persistence and no consumer.** 2,048 samples, cleared on every restart, exposed
   by one IPC command nobody calls. A p95 climbing 8 ms → 40 ms over three releases crosses no
   threshold, produces no warn, and leaves no artefact. `brainiac` shows durability alone does not
   solve this: it persists every sample forever and still shows nobody anything.
4. **The threshold is a scalar where the app already owns a ladder.** `SLOW_QUERY_THRESHOLD` is one
   binary cut at 100 ms; `latencyToHealth` (`statusTokens.ts:200-205`) is a four-band ladder the
   frontend already uses for the same quantity. A 12-second query and a 101 ms query produce the same
   log severity, and the operator's real distribution (p50 178 ms, p95 1,115 ms, max 12,066 ms) spans
   three of those bands.
5. **No sink is durable enough to answer a question later.** stdout dies with the process; the rolling
   file keeps **7 days** (`logging.rs:40`); the Sentry breadcrumb is uploaded only if an unrelated
   ERROR fires afterwards in the same session (`logging.rs:76-80`). There is no path by which "was
   this slow last month?" can be answered.
6. **The instrument cannot distinguish waiting for a connection from running a query.** Both live
   inside the block, deliberately and correctly — but the emitted record says `table=personas
   operation=personas::get_enabled duration_ms=200` for a table holding 78 rows, where the SQL is
   plainly not the cost. The label names a query; the number measures a query *plus a checkout*, and
   no consumer can separate them. A second field (`acquire_ms`) would, and the macro has nowhere to
   put it.
7. **`DbPerfSnapshot` has no clock.** No `window_start`, no `oldest_sample_at`. A consumer cannot tell
   whether a p95 covers the last ten seconds or the last ten hours, which makes the number unsafe to
   compare against itself.
8. **Nothing connects a slow warn to what the user was doing.** The 46 `#[instrument]` spans supply a
   context prefix (`WARN get_enabled: …`) but no execution id, no IPC command, no persona. The
   frontend's ring holds the IPC command name for the same instant and the two are never joined.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md) this must be answered explicitly. **For this leaf the
answer is an unqualified YES — and it is the strongest type-over-gate case the corpus has produced so
far, because the type is not hypothetical: three sibling codebases and this repo's own frontend have
each independently built its shape, and the one that built it completely has 100 % coverage that
cannot regress.**

**The evidence that the type works, from four places that never coordinated.**

| | Shape | Coverage |
|---|---|---|
| **Personas frontend** — `_invokeCore` (`tauriInvoke.ts:441,:513,:517`) | one function owns the clock; ESLint forbids the raw call | **100 %, both paths, cannot regress** |
| **`brainiac`** — `meter_op` (`providers/mod.rs:128-154`) | generic `Future` wrapper; no other way to get a result | 100 % of the LLM boundary; **0 of 176 DB functions** |
| **`personas-web`** — `rows<T>()` (`supabaseApi.ts:56-63`), `orchestratorFetch` (`api.ts:57-128`) | total-coverage chokepoints built for error normalisation | 100 % coverage of the *cap*; **0 % of the measurement** |
| **Personas backend** — `timed_query!` | a macro you must remember | **71.7 %, success path only** |

**The change.** `DbPool` is a bare `r2d2::Pool` alias, so every repo function checks a connection out
itself and the timer is a habit layered on top. Replace the habit with a handle:

```rust
// db/src/lib.rs — the only way the repo layer obtains a connection
impl RepoPool {
    pub fn scope<T>(
        &self,
        table: &'static str,
        op: &'static str,
        f: impl FnOnce(&Connection) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let start = Instant::now();
        let result = self.0.get().map_err(Into::into).and_then(|c| f(&c));
        crate::perf::record_query(table, op, start.elapsed());  // BOTH paths
        result
    }
}
```

This is the same construction as `_invokeCore` and the same construction as `meter_op`, and it does
four things a macro cannot:

1. **Coverage becomes structural.** A repo function with no timing requires reaching past `scope` for a
   raw checkout. Make the inner pool `pub(crate)` and it becomes unrepresentable outside `db/src/`.
   The 245-site, nine-whole-modules-at-zero gap stops being possible rather than being counted.
2. **The error path is repaired for free.** `f` is a **closure**, so `?` inside it returns a `Result`
   *to `scope`* instead of escaping to the caller. The five-second pool stall, the `SQLITE_BUSY`, the
   mapping failure — all recorded. **This is the decisive argument: P1 is not fixable by any amount of
   care at 922 call sites, and it disappears the moment the boundary is a closure.**
3. **The checkout becomes separately observable.** `scope` holds both instants; adding `acquire_ms`
   beside `duration_ms` closes Gap 6 in one place.
4. **The label pair cannot disagree with itself.** `scope` can take one `&'static str` table and derive
   the operation, or assert the prefix in a `debug_assert!`, removing all 36 mismatches by construction.

**Migration is mechanical and can be incremental.** `timed_query!` keeps working; `scope` is added
beside it and the 245 uninstrumented sites are converted first, since they are being edited anyway.
The census rule below is the ratchet that holds the line until `scope` lands — which is exactly the
contract's "propose the type as the fix and the gate as the ratchet".

**A second, cheaper type-shaped fix** closes P3 permanently: `DbPerfSnapshot`'s `total_queries` should
not be derivable from the ring at all. Two `AtomicU64`s incremented in `record_query` make "a lifetime
total that silently caps at the window size" unrepresentable, and the frontend's
`ipcMetrics.ts:36-42` is the working precedent in this repo.

**Where a type cannot reach.** *Whether anyone looks at the number* is not a type. Neither is *whether
a completed panel is mounted*. Both are §9 refusals.

## 9 The missing gate

### The semantic conditions, stated first

Three, each stack-free:

> **(A)** A persistence operation executes with no record of how long it took, so its cost can never
> be observed, compared across releases, or attributed when a surface gets slow.
> **(B)** A measurement is taken and then discarded before any human or alert can act on it.
> **(C)** A mechanism that exists once is re-implemented beside itself, so the guarantees of the
> original (throttling, aggregation, a single threshold) do not apply to the copy.

Per the [portability test](../research/portability-test.md), what follows is **one repo's proxy** for
(A). An adopting repo inherits the three sentences and re-derives its own signal against its own
driver and idiom — and a repo that has already made (A) unrepresentable, as this repo's frontend has,
needs no rule at all.

### What is gated, and what is refused

**(A) is countable and is gated below.** **(B) and (C) are not usefully countable, and refusing them
is the honest outcome** — with the checker that *can* express each one specified instead of a bad
regex shipped. This path also does **not** propose a rule for SQL outside the repo layer:
`persistence-handle-in-command-tree` (owner: [command-naming-placement](./command-naming-placement.md),
baseline 134/46) already counts that condition, and a second rule over the same population would be a
duplicate. Checked before writing.

### The one census rule — `untimed-repo-query`

Keys on a `pub fn` in the repository layer whose text reaches a rusqlite statement call without passing
through `timed_query!`. Measured: **245 matches across 36 of 116 files**, and **two independent
implementations reconcile exactly** — a brace-matching Rust parser counts **234** `pub fn`s holding SQL
in their own body with no wrapper, and the difference of **11** is precisely the spans where the SQL
belongs to a private helper declared immediately below the matched `pub fn` (`llm_spend.rs:30`
`pub fn record` → the untimed `INSERT` is in `fn try_record` at `:40`). So precision on the
**condition** is 245/245 and precision on the **attributed function name** is 234/245; every match is a
real untimed statement either way. Median matched span is **197 characters** and only **1 of 245**
approaches the 2,500-character bound, so the bound loses essentially nothing and makes the count a
floor. All 245 are distinct `(file, fn)` pairs — no function is double-counted. **Zero** matches sit
inside a `#[cfg(test)]` module (a naive after-the-marker heuristic flags 8; all 8 are production
functions declared below a mid-file test mod, checked individually).

```json
{"rules":[
  {
    "id": "untimed-repo-query",
    "goldenPath": "docs/concepts/golden-paths/query-latency-instrumentation.md",
    "title": "A repository function reaches a SQL statement without passing through the timing wrapper, so its cost is never recorded",
    "roots": ["src-tauri/db/src/repos"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "\\bpub\\s+fn\\s+[A-Za-z_][A-Za-z0-9_]*(?:(?!\\bpub\\s+fn\\b|timed_query!)[\\s\\S]){0,2500}?\\.\\s*(?:query_row|query_map|execute_batch|execute|prepare_cached|prepare)\\s*\\(",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a pub fn in the repository layer whose text reaches a rusqlite statement call (query_row / query_map / execute / execute_batch / prepare / prepare_cached) without passing through timed_query! first, and with no intervening pub fn. PROXY FOR the stack-free condition: a persistence operation executes with no record of how long it took, so its cost can never be observed, compared across releases, or attributed when a surface gets slow. Measured 2026-08-14 at HEAD: 245 matches across 36 of 116 files. Two independent implementations reconcile EXACTLY - a brace-matching Rust parser counts 234 pub fns that hold SQL in their own body with no timed_query!, and the 11-match difference is precisely the 11 spans where the SQL belongs to a private helper declared immediately after the matched pub fn (llm_spend.rs:30 pub fn record -> the untimed INSERT is in fn try_record at :40). So precision on the CONDITION is 245/245 and precision on the ATTRIBUTED FUNCTION NAME is 234/245; every match is a real untimed statement either way. Median matched span is 197 chars and only 1 of 245 approaches the 2500 cap, so the bound loses almost nothing and makes the count a floor rather than an estimate. Every match is a distinct (file, fn) pair - no function is double-counted. Zero matches sit inside a #[cfg(test)] module (a naive after-the-marker heuristic flags 8, and all 8 are production functions declared below a mid-file test mod). The gap is FILE-shaped, not function-shaped, which is why a per-function lint would read as noise: twin.rs is 38/39 uninstrumented, research_lab.rs 25/25, orchestration/team_assignments.rs 24/24, while executions.rs, events.rs and triggers.rs are near 100 percent covered - a module either adopted the macro or never heard of it. It does not correlate with age (the three oldest repo files, 2026-02-19, are covered; 2026-07-31 arrivals are not) and it does not correlate with hotness. PRECONDITION (must be re-derived per repo): this repo executes SQL through rusqlite method calls spelled query_row / query_map / execute / prepare inside functions declared pub fn, and its timing wrapper is a macro named timed_query! that must be written by hand. A repo whose driver is sqlx (.fetch_one(&pool).await), an ORM, or a query builder has the SAME condition wearing different markup and this pattern scores zero against it - brainiac is exactly that repo, and 0 of its 176 store functions are timed. A repo that times structurally at a chokepoint has the condition designed out and needs no rule at all: this repo's own frontend is that case, since src/lib/tauriInvoke.ts:513,:517 calls recordIpcCall on BOTH the success and the failure path of every IPC call, so its coverage is 100 percent by construction and cannot regress. LEGAL FIX, in order: (1) wrap the body in timed_query!(TABLE, TABLE::op, { ... }) - alert_rules.rs:35-59 is the shape to copy; (2) if the function is a thin wrapper over a private helper, wrap the helper, not the wrapper; (3) if the function genuinely runs no SQL of its own and only composes other repo functions, it needs no wrapper and the match is telling you a private sibling below it does - wrap that one. Do NOT silence a match by moving SQL out of the repo layer; that trades this condition for the one persistence-handle-in-command-tree counts."
    },
    "baseline": { "files": 36, "matches": 245 },
    "floor": 100
  }
]}
```

**Validated standalone before publishing** (`node scripts/census/run-census.mjs --rules
<scratch>/qli-rules-final-A7f3.json --check`):

```
  rule                    files   base  matches   base  walked  floor
  OK   untimed-repo-query         36     36      245    245     116    100

  census OK — 1 rule(s), 116 file-visits, 245 surviving violation(s) across 36 file(s).
```

`116 walked` is every `.rs` file under `db/src/repos/`, independently confirmed by the brace-matching
parser walking the same tree. `floor: 100` sits just under it — tight enough that a directory
reorganisation fails loudly, loose enough to survive a file being split or merged.

**Fault injection against the real tree**, because a gate that cannot fail is not a gate. Each row is a
single-field mutation of the validated rule, run with `--check`:

| Induced fault | Exit |
|---|---|
| baseline, unmutated | **0** |
| matcher matches nothing (`pattern` → `ZZZ_NEVER_MATCHES`) | **1** |
| floor above the walk (`floor: 5000` on a 116-file root) | **1** |
| silent drop (baseline claims 400 where 245 exist) | **1** |
| count rises (baseline claims 100 where 245 exist) | **1** |
| file count rises (baseline claims 10 files where 36 exist) | **1** |
| renamed root (`…/repos` → `…/repos-x`) | **1** |
| extension no longer describes the tree (`.rs` → `.zzz`) | **1** |
| stale `exclude` entry (a path matching no file) | **1** |
| inverted signal (`pattern` → `timed_query!`, i.e. keyed on the *correct* form) | **1** |

The last row is a positive control the other rules in the registry do not carry: pointing the same
rule at the compliant construction moves the counts to 918/82 and fails, which proves the matcher is
discriminating between the two forms rather than matching everything in the tree.

**No `exclude` entries.** The correct construction is excluded by the *pattern*'s negative lookahead,
not by a path, so no legitimate file-level exception exists and a stale exemption cannot accumulate.

**A note on the engine caveat.** This is a multiline pattern — its `[\s\S]` span crosses newlines
freely — and therefore exactly the shape the 2026-08-14 comment-rewind fix
(`lib/engine.mjs:192-211`) was made for. Two independent reasons it is safe here, both checked rather
than assumed: every match **starts** at `pub fn`, which is never on a comment-only line, so
`ignoreCommentLines` can never rewind inside one; and the runner reports
`commentMatchesSkipped: 0` for this rule, so the rewind path is not exercised at all. The independent
brace-matching parser is the second implementation the caveat asks for, and it reconciles to the
exact match.

### What this does NOT gate, and why — three refusals

1. **"The measurement is never looked at" (B) is not expressible as a content match, and the honest
   answer is that it needs no gate — it needs two lines of code.** The condition is *reachability*: a
   symbol is exported, typed, bound, registered, and has zero importers. A census rule counts
   occurrences within one file and cannot express "no other file references this". The naive proxies
   were considered and rejected: keying on `export default function` in a `components/` directory
   matches ~1,200 legitimate components; keying on `getDbPerformance` matches its own definition and
   pins at 1 forever, which the runner correctly treats as a gate that can never fail. **The checker
   that can express it already exists in this repo's toolchain**: `scripts/` carries a
   `check-unused-bindings` precedent, and an orphan-component sweep (walk `src/features/**/*.tsx`,
   resolve every import, report default exports with zero importers) is the general form. **That is a
   different leaf's condition — dead/unreachable UI — not this one's**, and claiming it here would be
   the duplication the contract warns about. What belongs here is the measurement, and it is
   damning: the condition is present in **four of four** repos in this fleet (§6), so it is physics,
   and the fix in this repo is one import line for the panel plus one tab for the snapshot.
2. **The hand-rolled duplicate (C) is countable at 4 sites, and gating it would be wrong.** The signal
   is clean — `Instant::now()` inside `db/src/repos/` yields 10 hits across 2 files (9 timers plus one
   `cached_at:` timestamp), and `if elapsed_ms > 100` yields exactly the 4 offending sites, all in
   `personas.rs`. But a ratchet whose entire purpose expires in one commit is not a ratchet: the fix
   is four deletions, after which the count goes to zero and the runner **correctly fails** on
   `zero-matches` and instructs you to delete the rule. Per the engine's own doctrine — *"If the
   migration really is complete, DELETE the rule rather than baselining it at zero"* — a rule with a
   one-commit lifetime should never be added. It is P0 in §7 with six days of log evidence instead,
   which is a stronger instrument than a count of 4: **871 warn lines, 63 % of the canonical
   instrument's entire output, from four `if` statements.** Re-introduction is guarded by §5 and by
   the fact that `scope` (above) removes the reason anyone would write one.
3. **"The error path is unmeasured" (P1) is countable at 914/922 and gating it would be actively
   harmful.** A rule keyed on `?` inside a `timed_query!` block would baseline at essentially the whole
   population, and its fix is a **single structural change** that drops it to zero in one commit —
   producing exactly the failure mode of refusal 2, amplified. Worse, the 914 call sites are *correct
   Rust*; the defect is in the macro's shape, so a per-site count blames the wrong party.
   **The checker that can express it is a Rust `#[test]`, and it does not exist**: on a fresh
   `init_test_db()`, call a repo function against a deliberately broken condition (a dropped table, a
   poisoned pool), then assert `perf::get_snapshot()` contains a sample for that table. That is
   behaviour, not shape; it fails loudly because a passing assertion requires the sample to be
   genuinely present; and it becomes the regression guard for the `scope` migration. It must run under
   `cargo test --workspace` — `npm run test:rust` passes `--lib` against the root manifest, so a test
   in `personas-db` would be written, merged and never executed locally; use
   `cargo test -p personas-db`. **Mark honestly: `perf.rs` has zero tests today, and no repo in this
   fleet asserts anything about its own latency instrumentation, so this is local calibration rather
   than doctrine. It is the right instrument and it is unproven.**

**How the census rule fails loudly when its own precondition is absent** is inherited from the runner
and demonstrated in the fault table: a zero-match run fails structurally rather than reporting a clean
tree; a walk below `floor` fails with *"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; a drop without
a baseline update fails; and the surviving count prints on success, so a green build log distinguishes
a clean run from one that checked nothing.

**On severity:** the census is a ratchet, not a severity ladder — it fails a run when a count moves. No
argument is made here from warning volume, and none could be: `npm run check` runs `eslint src/` with
no `--max-warnings` and the pre-commit hook runs `--quiet`, so a warn-level rule enforces nothing at
either gate at any count. The census rule enforces; a lint rule would not. (The one place volume *is*
argued in this document is §7 P0, and it is log volume in a running application, not lint volume — 871
real warn lines that evict real Sentry breadcrumbs.)

## See also

- [Index design](./index-design.md) — what to change once you know something is slow; and see §6 for
  four of its claims independently confirmed.
- [Paginated list query](./paginated-list-query.md) — bound the fetch before you measure it.
- [Command naming & placement](./command-naming-placement.md) — the 1,711 statements this path cannot
  reach, and the rule that already counts them.
- [Persisted model struct](./persisted-model-struct.md) — why `DbPerfSnapshot`'s counters arrive as
  `bigint`.
- [Swallowed error telemetry](./swallowed-error-telemetry.md) — the same failure one layer up: an
  event occurs, and the only record of it is destroyed at the site that handled it.
