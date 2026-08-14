# Golden path — LLM spend accounting

> Situation node: `ai-agents/cost-and-budget/llm-spend-accounting` · [situation spine](../situation-spine.md)
> Composed 2026-08-14. **Recurrence 37.**
> Sweep: both of this repo's price tables (`engine/src/cost.rs`, `src/engine/http_engine/config.rs`) read in
> full; the CLI stream parser (`engine/src/parser.rs`) and the two independent `result`-event readers
> (`db/src/repos/llm_spend.rs`, `companion/turn_ledger.rs`) read in full; `core/src/run_budget.rs`,
> the monthly-budget gate at `commands/execution/executions.rs:352-364` and its scheduler mirror at
> `engine/background.rs:2475-2528`, `db/src/chain.rs`'s cascade cost ceiling, `engine/deliberation.rs`'s
> cost floor, and `stores/slices/agents/budgetEnforcementSlice.ts` read in full. Plus: a parse of every
> money-typed DDL column in all **963** Rust files (matching
> [`shared-facts.json`](../shared-facts.json) exactly); a census of every `SUM(cost)` re-aggregation vs
> every running money accumulator across `src` + `src-tauri`; **a read-only copy of the operator's live
> database** (`personas-20260814-202519-00.db`, 347 MB, 2,193 executions / 4,001 audit rows / $3,682 of
> real spend) queried for aggregate shapes only; and **293 real Claude-CLI `result` events** grepped out
> of the operator's own execution logs. Model list prices verified against the current Anthropic
> catalog during composition.
> Dimensions: **function · cost · resilience · code-quality · data**.
> **Settles:** whether the number the app reports as spend is correct, and whether a budget cap can rely on it.
>
> **Two of the brief's premises are corrected in §7.0, and one inherited finding is cleared outright.**
> Deviations become `violating` cells.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and every
clause carries its **warrant**, so an adopting repo can tell physics from local calibration. No file path,
primitive name or count appears below this line until the head ends.

> **P1 — physics.** A spend figure is a *measurement*, and every measurement has a provenance. The two
> provenances available are **the vendor told us** and **we multiplied a token count by a price we hold**.
> They are not interchangeable and they do not have the same error bars: the first is authoritative and
> arrives only at the end of the call; the second is available before the call and is wrong whenever the
> price table is stale, incomplete, or blind to a billing tier the vendor applies. A system that does not
> record which one produced a given number cannot audit that number later.
>
> **P2 — physics, and the sharpest clause here.** The authoritative cost exists only in the **terminal
> event** of a call. Therefore *every way a call can fail to reach its terminal event is a way for real
> money to be spent and recorded as zero* — a kill, a timeout, a crash, a dropped connection, a parser
> that reads a field the vendor does not emit. This is not an edge case: the calls that die before their
> terminal event are disproportionately the long, expensive ones.
>
> **P3 — physics.** *Unknown* and *free* are different facts, and a numeric type with no null state can
> only represent one of them. Where a money field's type makes absence unrepresentable, the system does
> not merely risk conflating the two — it is **structurally incapable** of distinguishing them, and no
> discipline downstream can recover the difference.
>
> **P4 — physics.** A total that is **re-aggregated from its rows on every read** is self-healing: correct
> a row, and every total that ever quoted it becomes correct. A total that is **incremented in place** is
> a second source of truth that drifts, cannot represent a deleted row, and cannot be repaired without
> a backfill. Prefer re-aggregation; where an incremented total is unavoidable, it must be reconcilable
> against the rows.
>
> **P5 — physics.** A cap that is checked *after* the money is spent is a report, not a cap. A cap that
> is checked *before* the next unit of work is a launch gate — it bounds the total but never a single
> in-flight call. A cap that bounds a single in-flight call must be enforced by whoever is holding the
> connection. These are three different mechanisms and a system needs all three to claim a spend ceiling;
> naming one of them "the budget" and stopping is how a ceiling becomes decorative.
>
> **P6 — physics.** A gate that reads its own input through a fallible call and substitutes a default on
> failure has inverted its own purpose: the failure mode of the *measurement* becomes a bypass of the
> *control*. For a spend gate the default that opens the gate is zero, and zero is exactly what an
> unavailable measurement looks like.
>
> **P7 — physics.** Spend is only meaningful against a dimension — which agent, which model, which
> feature. A ledger that records the amount but not the dimension answers "how much" and can never
> answer "why", which is the only question that leads to an action.
>
> **P8 — ergonomics.** A price table is a **dated snapshot of someone else's decision**. It is the one
> artifact in a codebase guaranteed to become wrong without anybody editing it, so it must carry the date
> it was verified, and a model it does not know must be a loud absence rather than a quiet default.
>
> **Scale condition.** P2, P3 and P6 are correctness at any scale — they are wrong on the first dollar.
> P4 and P7 begin to pay when more than one surface reports the same spend. P1, P5 and P8 pay the first
> time somebody is asked to defend the number.

**Warrant evidence — the sibling repos, censused independently.** `brainiac` (Rust/Postgres, meters an
LLM boundary), `personas-cloud` (Node/Fly.io orchestrator), `personas-web` (Next.js mirror). None has seen
this document.

- **P2 is convergent, and it is the single largest leak in two codebases at once.** `personas-cloud` reads
  cost from the same Claude-CLI `result` event this repo does (`packages/worker/src/parser.ts:50-53`), and
  guards the budget increment with
  `` if (msg.totalCostUsd && msg.totalCostUsd > 0) `` (`orchestrator/src/dispatcher.ts:474`). A run
  SIGTERM'd at its timeout never reaches the `result` event, so `totalCostUsd` is `undefined`, the monthly
  counter never moves, and **unlimited timed-out runs can never exhaust the cap.** This repo reaches the
  identical outcome by an unrelated route — it *kills the child process* on cancel — and the live data
  confirms it: **2 cancelled executions, both having run over 10 seconds (mean 103.9 s), both recorded at
  `$0.00`** (§7.C). Two teams, two mechanisms, one hole. **P2 is physics.**
- **P3 is convergent and the two repos hold opposite doctrines.** `brainiac`'s gateway states it in a
  comment — `// A missing 'usage' means "cost unknown", not "cost zero" — never silently`
  (`crates/brainiac-gateway/src/providers/openai.rs:196`) — and enforces it structurally by having **no
  dollar field at all** to falsify. `personas-cloud` writes the opposite into the database on the very
  line that feeds its budget gate: `costUsd: msg.totalCostUsd ?? 0` (`dispatcher.ts:461`). The repo with
  the strict doctrine has nothing to protect; the repo with money at risk has the loose one. This repo
  sits with `personas-cloud` (§7.C(iii)). **P3 is physics, and unknown-as-zero is a shared trap.**
- **P4 is convergent and everybody already gets it right on the read path.** `personas-web` re-aggregates
  in three SQL views plus four JS reductions and has **zero** money accumulators over real data;
  `personas-cloud` has four `SUM`/`AVG` expressions for analytics. This repo has **30+ `COALESCE(SUM(...))`
  re-aggregations against 3 money accumulators** (§7.D). **P4 is physics.**
- **P8 does NOT converge, and that inverts the expected story.** **None of the three siblings contains a
  model→price map at all.** `brainiac` has zero price constants across its Rust workspace and defers
  pricing to a downstream service; its own design note says so outright —
  *"There is no price table, no per-org accumulator, and no admission gate"*
  (`docs/harness/moonshot-2026-07-30/deploy-config.md:27`). `personas-cloud` and `personas-web` never
  compute a cost. **So a price table is this repo's local calibration, not doctrine** — and the honest
  reading is not that this repo is ahead, but that **its price table is a liability nobody else has taken
  on** (§7.A: three of its rows are wrong today by 3×–4×). The *principle* P8 is what generalises; the
  artifact does not.
- **Cache-token capture is this repo's genuine local strength.** `cache_read_input_tokens` and
  `cache_creation_input_tokens` appear **zero times** in all three siblings. This repo parses both, with a
  documented fallback chain for a CLI-version change (`parser.rs:346-370`), and its ledger holds **217.9 M
  cache-read tokens against 1.0 M billed output tokens** — a 200× ratio that is the whole reason a
  token×price estimate is worthless here (§7.B). Adopt the principle; note this repo already built the
  thing the others are missing.
- **Pre-flight refusal is rare everywhere, and this repo has more of it than any sibling.** Across all
  three siblings there is exactly **one** pre-call refusal (`personas-cloud`'s HTTP 402 at
  `orchestrator/src/httpApi.ts:1297`), covering **one route**; `brainiac`'s only ceiling counts *calls*,
  not dollars, and is per-chunk; `personas-web`'s `BUDGET_THRESHOLD` changes a bar to amber. This repo has
  two real pre-call gates that share a predicate constant (§6). **This is the part of the design worth
  copying outward.**

**The negative control.** `personas-web` makes no model calls (no LLM SDK in `package.json`; its write
surface is a `pending_commands` insert plus `readOnly()` stubs). Its absence of spend accounting is
*structural*, which is what makes it a control rather than a counterexample. Its one real obligation —
not distorting what it displays — it partly breaches by coercing Postgres `numeric` to a JS float on read
(`src/lib/supabaseApi.ts:179`).

---

## 1. Trigger

- "how much did that run cost", "add spend to the dashboard", "show this month's LLM bill"
- "put a budget on this agent", "stop it after $N", "why didn't the cap fire"
- "estimate the cost before we run it", "show a cost preview"
- "add a new model", "we're switching to \<model\>", "update the pricing"
- **If you are about to write a `match`/`if` on a model name that returns a number, a `SUM(cost_usd)`, a
  `cost = cost + x`, a comparison of a spend total against a ceiling, or a `?? 0` / `unwrap_or(0.0)` on
  anything named `cost` or `spend`** — you are in this situation.
- If you are about to *kill*, *time out*, or *abandon* a model call, you are in this situation, because
  that is where the cost is lost (§2, P2).

You are **not** in this situation for: token budgets that bound context assembly rather than money
(`memory_recall.rs:212`, `retrieval.rs:361` — the word "budget" is overloaded); wall-clock ceilings; or
rate limits.

**Boundary with [`number-and-cost-formatting.md`](./number-and-cost-formatting.md), stated because the two
leaves touch the same field name.** That path owns **rendering** a cost: the glyph, the separator, the
rounding contract, the locale, the sub-cent guard. This path owns **computing, capturing, storing and
aggregating** one: where the number comes from, what type holds it, how totals are derived, and what a cap
reads. The seam is the moment a `f64`/`number` leaves the store and enters a component. Two consequences
of the seam are load-bearing:

- **`formatCost(null) → "$0.00"` is that path's defect; a `cost_usd` that is `Some(0.0)` when the truth is
  "unknown" is this path's.** They compose into the same wrong pixel and each is fixable alone.
- **This path is why that path's sub-cent finding has no live instances.** The smallest positive money
  value anywhere in the operator's database is **$0.0129**, because every call is a full CLI spawn against
  a large cached prompt. See §7.0(c) — the display defect is real in code and empty in data.

---

## 2. The one way

**Take the number from the vendor, keep it nullable end to end, and never let a total you gate on be
anything other than a re-aggregation of the rows that produced it.** Concretely: capture the provider's
own `total_cost_usd` from the terminal `result` event and store it as a **nullable** column, so a call
that never produced a terminal event stores `NULL` and not `0`. Read token counts from the event's `usage`
object — never from a top-level field you assumed exists — and store `cache_read_input_tokens` and
`cache_creation_input_tokens` alongside them, because a token×price recomputation that ignores cache tiers
is off by nearly an order of magnitude on this repo's own data (§7.B). **Do not build a second spend total
by incrementing**: every figure a user or a gate reads must be `COALESCE(SUM(cost_usd), 0)` over a stated
predicate, and that predicate must live in **one exported constant** shared verbatim by the gate and by
every surface that displays the same number. Enforce the cap as a **launch gate before the call**, never
as an observation after it, and let the vendor's own per-call flag bound the single in-flight call — those
are two mechanisms and you need both. When the gate's own query fails, **fail closed**: `unwrap_or(0.0)` on
a spend read converts a database error into an unlimited budget (§7.E). Keep a price table only for
*preview* — never for the recorded figure — give it a `verified_at` date, and make an unknown model return
`None` that the caller must handle, not a default price and not a silent `0`. Finally, **stamp the
dimension**: a spend row without a model and an owner answers "how much" and can never answer "why", and
60% of this repo's recorded spend is currently unattributable (§7.F).

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`src-tauri/engine/src/parser.rs:337-403`** — the `StreamLineType::Result` arm | The single place the Claude CLI's terminal event is decoded. `total_cost_usd` is read here and is the **only** source of every recorded dollar in this app. Its cache-token extraction (`:346-370`) is the model to copy: `usage` first, top-level second, then the `cache_creation` ephemeral breakdown, with a CLI version named in the comment. |
| **`src-tauri/db/src/repos/llm_spend.rs:83-111`** — `parse_result_line(ctx, line)` | The **correct** `result`-event reader. Reads `usage.input_tokens` / `usage.output_tokens` / `usage.cache_read_input_tokens` / `usage.cache_creation_input_tokens`, `total_cost_usd`, `num_turns`, `is_error`, and prefers the CLI-reported `model` over the caller's pin. Every field is `Option`. Copy this, not `parser.rs`'s token half (§7.B). |
| **`src-tauri/core/src/models/llm_spend.rs:20-38`** — `LlmSpendInsert` | The right *shape* for a spend row: every measured field is `Option<T>`, plus `source` / `trigger_kind` tier tags and soft `persona_id` / `project_id` refs that survive deletion of their subject. This is the only money struct in the repo that models "unknown". |
| **`src-tauri/db/src/repos/execution/executions.rs:1652-1686`** — `MONTHLY_SPEND_PREDICATE` + `get_monthly_spend` | The exemplar of the whole path. One exported `&'static str` predicate — status set, UTC month boundary, ops-chat exclusion — shared **verbatim** by the gate that blocks runs and by the UI feed that shows the number, with a doc comment naming all three axes that must not drift. The total is `COALESCE(SUM(cost_usd), 0.0)`; nothing is incremented. |
| **`src-tauri/src/commands/execution/executions.rs:352-364`** | The pre-call launch gate: `budget > 0.0` → `get_monthly_spend` → refuse with a typed `AppError::Validation` **before** the execution row is created. This is P5's launch-gate half. |
| **`src-tauri/src/engine/background.rs:2045-2053` — `schedule_over_budget`** | The scheduler's mirror of that gate, extracted as a pure function so it is unit-testable, with a docblock naming the three rules the previous bespoke inline SQL got wrong (`0.0` means unlimited; terminal statuses only; ops-chat excluded). Copy this pattern when a second surface needs the same decision. |
| **`src-tauri/engine/src/prompt/cli_args.rs:132-136`** | The per-call ceiling: `--max-budget-usd` handed to the vendor's own CLI, which is the only actor holding the connection and therefore the only one that can stop a call mid-flight. P5's third mechanism. |
| **`src-tauri/db/src/chain.rs:158-200, :320-368`** — the cascade cost ceiling | The best fail-closed reading of a configured limit in the repo. `CostCeilingReading` distinguishes **unset** from **corrupt**, and a corrupt stored value *halts the cascade* rather than resolving to "disabled" — `tracing::error!` + a recorded `stop_reason::COST_CEILING_CORRUPT`. This is P6 done right, in the one place it is done right. |
| **`src-tauri/db/src/repos/communication/sla.rs:636-666`** — `upsert_sla_daily_conn` | The right shape for a materialised rollup: a full `INSERT … SELECT … GROUP BY` with `ON CONFLICT DO UPDATE SET x = excluded.x`, so every touched bucket is recomputed from rows rather than incremented. (Its predicate has drifted from the gate's — §7.D — but the *mechanism* is correct.) |
| **`src/stores/slices/agents/budgetEnforcementSlice.ts`** | The frontend half, and it is genuinely good: `deriveStatus` at 0.8/1.0 thresholds, a 60 s TTL, and **fail-closed on staleness** — `budgetStale`, a missing entry after first fetch, or an expired TTL all block, and only an explicit per-persona session override unblocks. Its own header states the contract: frontend gating is advisory, the backend gate is authoritative. |
| **`src-tauri/core/src/run_budget.rs`** | The run-level aggregate ledger for multi-spawn operations (evolution / lab / pipeline), with `register` → `record` → `should_halt` → `finish`, a `RETENTION` sweep, and 12 unit tests including a concurrency test. **It is warn-only by default and has never persisted a row** (§7.G) — mandated as the shape to extend, not as a working control. |

**Explicitly NOT primitives.** `src-tauri/engine/src/cost.rs`'s `input_cost_per_million` /
`output_cost_per_million` are a **preview estimator**, not a pricing authority — do not reach for them to
value a real call (§7.A). `src/engine/http_engine/config.rs:33` `cost_of()` is a *second*, unrelated price
table with the opposite unknown-model policy. `ExecutionMetrics` (`core/src/types.rs:408-418`) is the
carrier struct and its `cost_usd: f64` is the defect at the centre of this document (§7.C, and the
type-over-gate answer).

---

## 4. Steps

1. **Name the provenance before you write the number.** Vendor-reported or locally computed? If vendor-
   reported, the only correct action is to plumb it through untouched. If locally computed, you are
   building an *estimate* and it must be labelled one at every point it is stored or displayed.
2. **Read the terminal event through its documented shape, and prove the shape.** Take token counts from
   `usage.*`, not from a top-level field. *Verify against a real captured event* — `grep` an actual log,
   do not trust the field name in a hand-written test fixture. This repo's parser has read a field the CLI
   has never emitted, in **293 of 293** real events, since it was written (§7.B).
3. **Type the money as `Option<f64>` / `number | null` from the parse site to the column.** Not at the
   column only — the *carrier struct in between* is where the null gets destroyed. `NULL` means "we never
   learned"; `0.0` means "the vendor told us it was free". These are both real states and you need both.
4. **Capture cache tokens in the same breath as the regular ones.** They are 200× the volume here and they
   price differently. A schema without them cannot ever reconstruct or audit a cost.
5. **Stamp the dimensions**: model (as the vendor reported it, not as you pinned it), owner, and the
   call-site tier. A spend row without these is unactionable — 60% of this repo's dollars are in that state.
6. **Never increment a money total you will gate on.** Write rows; derive totals with
   `COALESCE(SUM(cost_usd), 0)`. If a rollup table is genuinely needed for read performance, recompute the
   whole bucket from its rows (`INSERT … SELECT … ON CONFLICT DO UPDATE SET x = excluded.x`) rather than
   adding a delta — and know that even this cannot represent a bucket whose rows were all deleted (§7.D).
7. **Put the spend predicate in one exported constant.** Status set, time boundary, and every exclusion.
   Import it into the gate and into every display query. **And then stop** — the moment a second query
   spells the predicate out longhand, the badge and the block diverge and nothing will notice.
8. **Enforce three ways, and know which is which.** (a) a **launch gate** before the next unit of work,
   reading the re-aggregated total; (b) the **vendor's own per-call flag** for the in-flight call; (c) an
   **aggregate ledger** for multi-spawn runs. Naming only one of these "the budget" is how a ceiling
   becomes decorative.
9. **Fail closed on the gate's own inputs.** A spend query that errors must refuse, not default to zero. A
   configured ceiling that is unparseable must halt, not read as "disabled" — `chain.rs:320-344` is the
   worked example.
10. **Account for the call you killed.** Before you `kill_process`, decide what the cost row says. Today it
    says `$0.00` for a run that burned 104 seconds. There are three honest options — record `NULL`, keep
    the last observed partial, or estimate and mark it as estimated — and *silently zero* is not one.
11. **If you keep a price table, date it and make a miss loud.** `verified_at` in the type, `None` for an
    unknown model, and the caller obliged to handle it. Never a default price; never a bare `0`.
12. **Ask the type question before you reach for a gate.** The largest class in this document is one struct
    field that cannot hold `None`. See the type-over-gate answer.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| Killing the child process and recording whatever metrics happen to be populated | The vendor's cost lives only in the terminal event, which a killed process never emits. **Live: 2/2 cancelled executions, mean runtime 103.9 s, recorded `$0.00`.** The budget predicate deliberately *includes* cancelled rows "because cancelled rows may have consumed API credits" — and they carry no credits to count. The gate includes the row and excludes the money. |
| `cost_usd: f64` on the struct that carries a measurement | Makes "we never learned the cost" unrepresentable. The only value available for it is `0.0`, and `Some(0.0)` is then written to a **nullable** column that was ready to hold the truth. One field erases a distinction the schema already supports. |
| `get_monthly_spend(...).unwrap_or(0.0)` | **2 sites.** A database error becomes "$0 spent this month", which opens the cap. The failure mode of the measurement is a bypass of the control — P6, exactly. |
| `SUM(cost_usd)` over a table whose rows are deleted, as a budget's input | Deleting execution history refunds the budget. **Live: 1,935 audit rows carrying $1,637.96 have no surviving execution** — 44% of audited spend is invisible to the gate. |
| A materialised rollup that is upserted per touched bucket | An upsert cannot represent a bucket whose rows all went away, so the stale total survives forever. **Live: `sla_daily` reports $2,865.04 against a maximum possible $2,044.29 — over by $820.75 (40%) — and counts 2,870 executions where 2,173 exist.** |
| A second spend predicate written longhand | `sla_daily` counts `('completed','failed','cancelled')` and does not exclude ops-chat; the gate counts those **plus `'incomplete'`** and does. Two totals over one table that can never agree, with no test asserting they should. |
| A price table with no verification date | It is a dated snapshot of someone else's decision and it rots without anyone editing it. **This repo's is wrong on three of its eight rows today** (§7.A). |
| Unknown model → a default price | `cost.rs:34` returns Sonnet pricing for anything it does not recognise, so a model 3× more expensive is silently valued at a third. |
| Unknown model → `0.0` | `config.rs:36` and `openai.rs:176` stamp `$0` for an unpriced SKU. The comment says "configure when the price is confirmed"; the behaviour says "this call was free". Convergent with `personas-cloud`'s `?? 0`. |
| `cost = cost + ?` in SQL as a budget meter | `deliberation.rs:197` increments `cost_spent_usd`, and `floor_breach` gates a $5 default ceiling on it. A second source of truth, unreconcilable against rows, gating real money. |
| A token count parsed from a field name you never verified | `parser.rs:340-341` reads `total_input_tokens` / `total_output_tokens`. **0 of 293 real CLI `result` events contain either field.** Every one of 2,193 execution rows has `input_tokens = 0`. |
| A test fixture that hand-writes the shape you assumed | `parser.rs:1095` constructs `"total_input_tokens":1500` at the top level — a line the vendor does not emit — and asserts the parser reads it. Green test, dead field, four years of zeroes. |
| Estimating a multi-turn agentic run as one request/response | `build_preview` models one round trip at 3.8 chars/token with output = 40% of input and no cache tier. Against real data the token×price form lands at **0.128× actual**. It is shown to the user as a budget-consumption projection. |
| Recording spend without a model | **Live: `model_used` is `NULL` in 1,184 of 2,193 execution rows carrying $1,227.45, and in 4,001 of 4,001 audit rows carrying $3,682.25.** The app cannot answer which model cost it money. |

---

## 6. Evidence

**The one site to copy: `src-tauri/db/src/repos/execution/executions.rs:1652-1686`.** It is the only place
in the repo where the *whole* discipline appears at once, and it is worth reading before writing any new
spend surface:

- `:1667` — `MONTHLY_SPEND_PREDICATE` is a `pub const &'static str`, so the gate and the UI feed cannot
  spell it differently. Its doc comment names the three axes that must stay in lock-step (status set, UTC
  month, ops-chat exclusion) and cross-references the invariant in `engine/background.rs`.
- `:1655-1660` — the reason `'cancelled'` is in the status set is written down: *"Cancelled rows may have
  consumed API credits before the process was killed."* The intent is exactly right; §7.C is the finding
  that the implementation does not deliver it.
- `:1678` — `COALESCE(SUM(cost_usd), 0.0)`. Re-aggregation, not a stored total.
- `commands/communication/observability/metrics.rs:185-196` — the UI feed importing the same constant,
  with a comment naming the gate it must not drift from.

**For the pre-call gate:** `src-tauri/src/commands/execution/executions.rs:352-364`. `budget > 0.0` (so
`0.0` legitimately means unlimited), then `get_monthly_spend`, then `pipeline.fail_stage` + a typed
`AppError::Validation` — **before** `create_with_idempotency` writes a row. This is a real refusal, and
across all three sibling repos there is exactly one other (`personas-cloud`'s HTTP 402, on one route).

**For fail-closed configuration reading:** `src-tauri/db/src/chain.rs:158-200` and `:320-344`. The
`CostCeilingReading` enum distinguishes `Unset` from `Corrupt`, and the `Corrupt` arm halts the cascade
with `tracing::error!` and a recorded `COST_CEILING_CORRUPT` stop reason rather than silently dropping the
only brake on runaway spend. Read the comment at `:322-325`; it is the argument for P6 in four lines.

**For the correct terminal-event reader:** `src-tauri/db/src/repos/llm_spend.rs:83-111`. Every field
`Option`, tokens from `usage`, cost from `total_cost_usd`, `is_error` captured, model preferred from the
CLI over the caller's pin. This is the one to copy — and the fact that `parser.rs` reads the same event
differently, 30 lines of code apart in the same workspace, is §7.B.

**For the fail-closed frontend:** `src/stores/slices/agents/budgetEnforcementSlice.ts:133-152`.
`isBudgetBlocked` blocks on `budgetStale`, on TTL expiry, and on a missing entry after the first
successful fetch — three separate fail-closed branches, each requiring an explicit user override. The
header comment (`:23-26`) correctly declares itself advisory and names the backend gate as authoritative.

**For the correct rollup mechanism:** `src-tauri/db/src/repos/communication/sla.rs:636-666`. A full
`INSERT … SELECT … GROUP BY … ON CONFLICT DO UPDATE SET x = excluded.x`. Every touched bucket is recomputed
from rows. Read it for the mechanism; §7.D is why the mechanism alone is not enough.

**Live-data reconciliation worth knowing, because it is a clean bill of health:** joining
`provider_audit_log` to `persona_executions` on `execution_id` yields 2,066 pairs, and **0 of them differ**
in `cost_usd` (both sides sum to $2,044.2899 exactly). The two ledgers do not double-count and do not
disagree. The problem is entirely the 1,935 audit rows with no surviving execution — see §7.D.

---

## 7. Deviations found

### 7.0 Two of the brief's premises are corrected, and one inherited finding is cleared

**(a) The "silent 0 for an unknown model" shape is real but is not where the money is.** The brief
predicted a price-table miss stamping `$0`. That exists — `config.rs:36` and `openai.rs:176` — and it is a
true instance. But **no recorded dollar in this app has ever passed through a price table.** All 4,001
audit rows are `engine_kind = 'claude_code'`, and every one of them takes its figure from the CLI's
`total_cost_usd`. The shape that actually bites is one layer earlier and more general: **a silent `0` for
an *unobserved result*, whatever the model.** The price table's failures are latent; the terminal-event
failure is live and has 2 rows and 104 seconds of real compute behind it.

**(b) The float-money finding is confirmed as a fact and rejected as a defect — and "integer cents" would
make it worse.** Measured: **36 money-typed DDL columns across 963 Rust files, 100% `REAL`, zero integer
minor-unit columns.** Convergent with all three siblings (`REAL` in `personas-cloud`, `numeric`-coerced-to-
float in `personas-web`, no money column at all in `brainiac`). But the live values decide the argument:
**1,974 of 1,974 positive costs fail an exact-cent round-trip** — real stored values are
`0.3869232`, `1.8919089`, `0.1791999` — and the smallest positive value anywhere in the database is
`$0.0129`. Per-token prices run to eight decimal places. **Cents is the wrong integer unit for this
domain**; the correct fixed-point unit would be micro-dollars (`1e-6`) or smaller. So the convergent idiom
is a *shared correct choice made for the wrong reason*, and the real gap is not the type but the absence of
any stated rounding contract at the storage boundary. This is a **cleared claim**, and it is as valuable as
a confirmed one.

**(c) The inherited sub-cent finding has zero live instances, and I could not make it fire.** The
[number-and-cost-formatting](./number-and-cost-formatting.md) path measured 22 of 40 hand-assembled `$`
sites rounding sub-cent spend to a displayed zero. That is a correct reading of the *code*. Measured
against the *data* it is currently unreachable:

| table.column | rows | values in (0, $0.01) | values in (0, $0.001) | min non-zero |
| --- | ---: | ---: | ---: | ---: |
| `persona_executions.cost_usd` | 2,193 | **0** | 0 | $0.15928 |
| `provider_audit_log.cost_usd` | 4,001 | **0** | 0 | $0.02018 |
| `dev_llm_spend.cost_usd` | 88 | **0** | 0 | $0.15456 |
| `lab_arena_results.cost_usd` | 58 | **0** | 0 | $0.03350 |
| `execution_knowledge.avg_cost_usd` | 2,343 | **0** | 0 | $0.10508 |
| `team_deliberations.cost_spent_usd` | 142 | **0** | 0 | $0.01292 |
| `sla_daily.cost_sum_usd` | 500 | **0** | 0 | $0.24725 |

Every call this app makes is a full CLI spawn against a large cached prompt, so the floor is ~1–2 cents,
not a fraction of one. The display defect is real and should still be fixed — a future per-token or
embedding path would land straight in it — but **its blast radius on today's data is zero rows**, and the
neighbouring path's severity ordering should say so. The `toFixed(0)` site remains genuinely exposed:
per-*project* aggregates under $1 do occur.

### 7.A The price table is unversioned, wrong on three of eight rows, and there are two of them

`src-tauri/engine/src/cost.rs:15-60` prices by substring match on the model name. Checked against the
current Anthropic catalog during composition:

| Table branch | Table says (in/out per 1M) | Current list price | Error |
| --- | --- | --- | --- |
| `contains("opus")` | $15 / $75 | Opus 5 and Opus 4.8: **$5 / $25** | **3× over** |
| `contains("sonnet")` | $3 / $15 | Sonnet 5: $3 / $15 | correct |
| `contains("haiku")` | $0.25 / $1.25 | Haiku 4.5: **$1 / $5** | **4× under** |
| *(no branch)* → `else` | $3 / $15 | Fable 5: **$10 / $50** | **3.3× under** |

The `else` arm is the sharpest: a model whose name contains neither "opus" nor "sonnet" nor "haiku" is
priced as Sonnet. `claude-fable-5` and `claude-mythos-5` are exactly that shape. And the `opus` row is not
hypothetical — **`claude-opus-4-8[1m]` appears on 152 live execution rows carrying $193.24**, and would be
valued at 3× by this table if anything ever asked it to.

Three structural problems behind the numbers:

1. **No `verified_at`.** `cost.rs:14` says only *"These are approximate list prices — actual pricing may
   vary by contract."* Nothing dates it, so nothing can flag it as stale. `config.rs:23` is the
   counter-example and gets it right: *"Per-1M-token USD pricing (verified Sep-2025 SKUs)"* — a date, in a
   comment, in the other table.
2. **No cache tiers at all.** Cache-read and cache-creation tokens price differently from fresh input, and
   this app's traffic is 200× cache-read (§7.B). A table with two numbers per model cannot express the
   bill.
3. **Two tables, opposite unknown-model policies.** `cost.rs:34` defaults to Sonnet (silently wrong, never
   zero). `config.rs:29` returns `None`, which `cost_of` and `openai.rs:174` turn into `0.0` (silently
   free). Same repo, same question, opposite answers, and neither caller can tell which it got.

**The mitigation, and it is real:** no recorded dollar comes from either table. `cost.rs` feeds only
`build_preview`; `config.rs` feeds only the Qwen/DashScope HTTP engine, which has **0 rows** in the live
database. This is latent, not live — but `ExecutionPreview.estimated_total_cost` **is** user-facing, and
`ExecutionPreviewPanel.tsx:73` renders `(monthly_spend + estimated_total_cost) / budget_limit * 100` as a
projected budget consumption.

### 7.B Token counts are structurally zero in every execution row, and a test certifies them

**Measured: `input_tokens = 0` and `output_tokens = 0` in 2,193 of 2,193 `persona_executions` rows.** Not
mostly — all of them.

The cause is one field name. `parser.rs:340-341`:

```rust
let total_input_tokens  = value.get("total_input_tokens").and_then(|t| t.as_u64());
let total_output_tokens = value.get("total_output_tokens").and_then(|t| t.as_u64());
```

Six lines later, the *cache* fields are read correctly — `usage` first, top-level as fallback, with a CLI
version named in the comment (`:346-370`). The regular token counts got no such treatment.

**Verified against the vendor, not assumed.** Grepping the operator's own execution logs: **293 log files
contain a `"type":"result"` event; 0 of them contain the string `total_input_tokens`.** A real event looks
like this (`215dabb6-…log`, verbatim):

```json
"total_cost_usd":0.44946480000000005
"usage":{"input_tokens":9,"cache_creation_input_tokens":37905,"cache_read_input_tokens":401576,"output_tokens":6769,…}
```

Three things follow. First, `total_cost_usd` **is** top-level, which is why cost works and tokens do not.
Second, `usage.input_tokens` is **9** against 401,576 cache-read tokens — so even the correct field would
be a ~44,000× understatement of the real prompt if anyone priced from it. Third, `llm_spend.rs:100-103`
reads `usage` and gets real numbers: **1,012,226 tokens across 88 rows**, against 0 across 2,193. **Two
readers of the same event, in the same workspace, disagree — and the one with 25× the traffic is the wrong
one.**

**The test is the reason nobody noticed.** `parser.rs:1095` hand-writes a fixture containing
`"total_input_tokens":1500` at the top level, and `:1110` asserts the parser extracts it. The fixture is a
shape the vendor has never emitted. It is a green gate over a dead field — the exact failure the
[contract](../golden-path-contract.md#why-a-gate-is-required-at-all) names, in a unit test rather than in CI.

**Consequence for accounting:** the recorded cost is *unverifiable by construction*. You cannot recompute
$2,044 from tokens, because the tokens are zero. And the quantitative case against ever trying is in the
one ledger that does have tokens — pricing `dev_llm_spend`'s sonnet rows with `cost.rs`'s formula:

| Method | Result |
| --- | ---: |
| `cost.rs` token×price, cache ignored | **$15.08** |
| the same, plus list cache-read/creation prices | $99.56 |
| CLI-reported actual | **$118.07** |
| naive / actual | **0.128×** |

The naive form recovers one eighth of the real bill. Cache-aware it reaches 0.84×, and the residue is
multi-turn: these are agentic sessions, not single round trips. **A token×price recomputation is not a
viable audit of this app's spend at any level of care** — which is exactly why the vendor-reported figure
must be preserved rather than reconstructed.

### 7.C Cancelling a run zeroes its cost, and the type makes that unavoidable

**(i) Measured, live.** Two cancelled executions. Both ran over 10 seconds; mean duration **103.9 s**. Both
recorded **`$0.00`**. Also 20 `incomplete` (zombie-swept) rows at $0, and 197 of 239 `failed` rows at $0
against 42 that carry $53.48 between them.

**(ii) The mechanism, traced.** `engine/mod.rs:1209-1295` `cancel_execution`: step 2 writes a bare
`Cancelled` status, step 3 **kills the child OS process** ("to stop API credit consumption" — the comment
is right about the intent), step 4 gives the spawned task a 5-second grace period to "finish writing
metrics". But `metrics.cost_usd` is only ever assigned from the `result` event
(`parser.rs:733-735`, an assignment, not an accumulation), and a killed CLI emits no `result` event. The
metrics written after a kill are `ExecutionMetrics::default()` — cost `0.0`.

**(iii) The type is why there is no third option.** `core/src/types.rs:416`:

```rust
pub struct ExecutionMetrics {
    …
    pub cost_usd: f64,     // <- not Option<f64>
}
```

`runner/mod.rs:2891` then writes `cost_usd: Some(metrics.cost_usd)` into an `UpdateExecutionStatus` whose
field **is** `Option<f64>`, into a column (`cost_usd REAL`, `incremental.rs:1453`, `:6380`) that **is**
nullable. Both ends of the pipe can express "unknown"; the struct in the middle cannot, so `Some(0.0)` —
a definite claim of zero — is written where `None` was available and true. Note the contrast inside the
same repo: `LlmSpendInsert.cost_usd` is `Option<f64>`, and `dev_llm_spend` correctly holds 3 zero-cost rows
alongside 85 real ones with the distinction intact.

**(iv) The gate includes the row and excludes the money.** `MONTHLY_SPEND_PREDICATE` deliberately counts
`'cancelled'`, with a comment explaining that such rows "may have consumed API credits before the process
was killed". They may indeed — and they carry `$0.00`, so including them buys the gate nothing. The intent
is documented, correct, and unimplemented.

**(v) Convergent, by a different mechanism.** `personas-cloud` loses the same money to the same physics: a
SIGTERM'd run never reaches the `result` event, `dispatcher.ts:461` writes `costUsd: msg.totalCostUsd ?? 0`,
and `dispatcher.ts:474`'s `if (msg.totalCostUsd && > 0)` skips the budget increment entirely — so timed-out
runs, the most expensive class, never advance the cap. Two codebases, two routes, one hole. **This is the
strongest convergence signal in the document.**

### 7.D Spend that the gate cannot see, and a rollup that over-reports by 40%

**(i) 1,935 orphan audit rows carrying $1,637.96.** Joining the two ledgers on `execution_id`:

| | rows | USD |
| --- | ---: | ---: |
| `provider_audit_log` total | 4,001 | $3,682.25 |
| … matching a surviving execution | 2,066 | $2,044.29 |
| … **orphaned (execution deleted)** | **1,935** | **$1,637.96** |
| executions with no audit row | 127 | $0.00 |

44.4% of the audit rows and 44.5% of the audited dollars describe spend whose execution row no longer
exists. `get_monthly_spend` reads `persona_executions`, so **deleting execution history silently refunds
the budget.** This is the direct answer to the brief's question: *no, a cap cannot rely on this number
across a retention boundary.* (Two mitigations worth stating: the join agrees exactly where it exists —
0 of 2,066 pairs differ — and the 127 audit-less executions carry $0, so nothing is lost the other way.)

**(ii) `sla_daily` over-reports by $820.75.** Stored total $2,865.04, against a maximum possible $2,044.29
from the rows it summarises — and it counts **2,870** executions where only **2,173** exist in those
statuses. **This is offset-independent**, so it is not a timezone artifact.

*I tried to disprove this and partly succeeded, which is worth recording.* My first pass compared
`sla_daily` rows against a UTC recompute and found 291 of 500 mismatched. But `upsert_sla_daily_conn` uses
`DATE(created_at, ?1)` with a local-day modifier, so I re-ran across offsets:

| offset | mismatched rows / 500 |
| --- | ---: |
| −480 min | 389 |
| −60 min | 328 |
| +0 (UTC) | 291 |
| +60 min | 265 |
| **+120 min (CEST — the operator's zone)** | **92** |

So the day boundary explains roughly two thirds of the per-row mismatch, and **92 rows remain wrong at the
best offset**, alongside the offset-immune $820.75 total. The mechanism is structural: an
`INSERT … SELECT … GROUP BY … ON CONFLICT DO UPDATE` only touches `(persona_id, day)` pairs that *still have
source rows*. A day whose executions were all deleted is never visited, and keeps its old total forever.
**An upsert-based rollup cannot represent deletion.**

**(iii) Two spend predicates over one table.** The gate counts
`('completed','failed','incomplete','cancelled')` and excludes ops-chat. `sla_daily` counts
`('completed','failed','cancelled')` and excludes nothing. `'incomplete'` (20 live rows) is in one and not
the other. No test asserts the two agree, and the doc comment that protects the gate/UI pair does not
extend to this third reader.

**(iv) Running money accumulators — 3 in the repo, and one of them gates real money.** Against 30+
`COALESCE(SUM(cost_usd), …)` re-aggregations:

- `repos/resources/deliberation.rs:197` — `SET cost_spent_usd = cost_spent_usd + ?2`. This is the input to
  `engine/deliberation.rs:167`'s `floor_breach`, which pauses a deliberation at
  `DEFAULT_COST_BUDGET_USD = 5.0`. **Live: 142 deliberations, all with `cost_budget_usd` NULL (so all on
  the $5 default), $138.35 total, max single deliberation $4.73** — within 6% of the floor, which has
  therefore never fired. A drifting incremented total is the only thing standing between that and a stop.
- `core/src/run_budget.rs:193` — `entry.state.spent_usd += cost_usd.max(0.0)`; in-memory and transient,
  which is defensible, and it clamps negatives.
- `repos/execution/knowledge.rs:108` — `avg_cost_usd = avg_cost_usd * 0.8 + ?9 * 0.2`, an EWMA. Not a
  total, but it is a money value that can never be reconstructed from rows.

### 7.E Four ways a budget cap can be bypassed, and one way it has never been tested

The monthly gate is well built (§6). These are the holes around it.

1. **A failed spend query opens the cap.** `background.rs:2510` and `engine/mod.rs:2778` both call
   `get_monthly_spend(...).unwrap_or(0.0)`. A pool exhaustion, a lock timeout, a corrupt page — any DB
   error reads as "$0 spent", and `schedule_over_budget(Some(50.0), 0.0)` is `false`. P6 exactly. Compare
   `chain.rs:320-344`, which faces the same question about a *configured* value and halts.
2. **A cancelled call's cost is zero** (§7.C), so a cap can be approached but never crossed by runs that
   are killed.
3. **Deleting execution history refunds the budget** (§7.D(i)) — $1,637.96 of real spend is currently
   outside the gate's reach.
4. **Only `trigger_type == "schedule"` is gated in the scheduler.** `background.rs:2489` opens
   `if trigger.trigger_type == "schedule"`. Event-driven and webhook trigger firings reach the same
   execution path without the budget branch. (The manual/API path at
   `commands/execution/executions.rs:352` *is* gated, so this is a coverage gap in one dispatcher, not a
   general absence.)

**And a fifth thing, which is not a bypass but is the reason none of the above has been noticed: the cap
has never been set.** Live: **78 personas, `max_budget_usd` NULL on all 78.** Zero rows with a positive
cap. The `run_budgets` table is **empty** — the aggregate ledger has never persisted a row — and
`PERSONAS_RUN_BUDGET_ENFORCE` defaults off, so `should_halt` is unconditionally `false`
(`run_budget.rs:233-235`). The entire spend-ceiling apparatus is untested in production because nothing has
ever opted into it.

### 7.F 60% of recorded spend cannot be attributed to a model

| ledger | rows | rows with a model | dollars unattributed |
| --- | ---: | ---: | ---: |
| `persona_executions` | 2,193 | 1,009 (2 distinct) | **$1,227.45 of $2,044.29 (60%)** |
| `provider_audit_log` | 4,001 | **0** | **$3,682.25 of $3,682.25 (100%)** |
| `build_sessions` | 12 | — | `total_cost_usd` NULL in **12 / 12** |

`provider_audit_log` has a `model_used TEXT` column, an insert that binds it (`provider_audit.rs:24`), and
it is `NULL` on every one of 4,001 rows. `build_sessions.total_cost_usd` is documented as *"Summed
`total_cost_usd` across the build CLI's stream-json `result`"* (`build_session.rs:302`) and has never been
written. `persona_executions` does better — the two models it does record are `claude-sonnet-4-6` (857 rows,
$623.61) and `claude-opus-4-8[1m]` (152 rows, $193.24) — but the plurality is `NULL`. P7: the app can say
how much and not why, which is the only version of the question that leads to a decision.

`lab_arena_results` shows the other end of the same problem: its `model_id` values are the bare strings
`"opus"`, `"sonnet"`, `"haiku"` — tier slugs, not model IDs — so even where a dimension is recorded it
cannot be joined to a price or a release.

### 7.G The run-level aggregate ledger is warn-only, unpersisted, and consulted once

`core/src/run_budget.rs` is 416 lines with 12 unit tests including a concurrency test, `RunBudgetRecord` is
ts-rs-exported, and the `run_budgets` table exists. Measured:

- **`run_budgets` has 0 rows.** No consumer has ever called the persistence path.
- `enforce_enabled()` reads `PERSONAS_RUN_BUDGET_ENFORCE` and **defaults off** (`:77-82`), so
  `should_halt` returns `false` for every run regardless of ceiling.
- **One live consumer**: `engine/evolution.rs:437` calls `ledger().is_exceeded(&cycle_id)`. The lab and
  pipeline ceilings (`DEFAULT_LAB_CEILING_USD`, `DEFAULT_PIPELINE_CEILING_USD`) are defined, exported, and
  called by nothing.

The module's own header is honest about this — *"Warn-only (today) … Hard-abort enforcement, lab/pipeline
consumers, and DB persistence of run-level cost are staged follow-ups"*. Recorded here because the fan-out
it was written to bound is precisely the case where a per-spawn cap does not help.

### 7.H `max_budget_usd` carries two different units

One `Option<f64>` field on the persona is read as:

- a **monthly ceiling in dollars-per-month** — `commands/execution/executions.rs:355` compares it against
  `get_monthly_spend`, and `background.rs:2051` does the same;
- a **per-spawn ceiling in dollars-per-call** — `engine/prompt/cli_args.rs:132-136` passes the identical
  value to the CLI as `--max-budget-usd`.

So a $50/month budget silently authorises a single $50 call, and a $0.50/month budget makes *every* call
fail at $0.50. `validate_max_budget_usd` (`validation/persona.rs:287`) checks only finiteness and `>= 0`,
because there is no second field to validate. The frontend slice's header states the intended model
correctly — *"the backend budget (max_budget_usd per execution) still hard-caps individual runs"* — while
the same field is simultaneously the monthly cap, which is the collision in one sentence.

### 7.I Nothing tests any of this

- **No Rust integration test references `cost_usd`.** `src-tauri/tests/` has zero matches.
- `run_budget.rs`'s 12 tests are the only money tests in the backend, and they exercise an in-memory
  ledger with no live consumer for two of its three ceilings.
- `MONTHLY_SPEND_PREDICATE`'s three axes — the thing the doc comment says must never drift — have no test.
- No test asserts that a cancelled execution records a non-zero or null cost.
- No test asserts `sla_daily` reconciles with `persona_executions`.
- The one money test that *does* exist certifies a field the vendor does not emit (§7.B).
- On the display side, [`number-and-cost-formatting.md` §7.I](./number-and-cost-formatting.md) records that
  `formatCost` — the only function that renders real money — has no `describe` block at all. **Both halves
  of the money path are untested, independently.**

---

## 8. Gaps in the primitives

1. **`ExecutionMetrics.cost_usd` is `f64` and cannot hold "unknown".** This is the root of §7.C and the
   single highest-leverage change in the document. **Fix:** `Option<f64>`, and let `None` flow to the
   already-nullable column. See the type-over-gate answer. The same applies to `input_tokens` /
   `output_tokens` / the two cache fields, which are `u64` for the same reason.
2. **There is no `Usd` type, so nothing states the rounding contract at the storage boundary.** Every
   money value is a bare `f64` from parse to column to binding. **Fix:** a newtype that owns the
   representation decision and its documentation. Micro-dollars (`i64`) would be exact and is what the
   data actually needs (§7.0(b)); a documented `f64` newtype is the cheaper honest option. Either beats
   an undocumented primitive.
3. **The price table has no `verified_at` and no cache tiers, and its two implementations disagree on the
   unknown-model policy.** **Fix:** one table, one type — `struct ModelPrice { input_per_m, output_per_m,
   cache_read_per_m, cache_write_per_m, verified_at: &'static str }` — `Option<ModelPrice>` for a lookup,
   and a compile-time or CI assertion that `verified_at` is under N months old. Delete the `else`
   fall-through in `cost.rs`.
4. **The preview estimator models a single round trip.** `build_preview` (`cost.rs:106-142`) uses 3.8
   chars/token, projects output at 40% of input, and has no notion of turns or cache. Measured at 0.128×
   actual (§7.B). **Fix:** either label the number as a lower bound in the type
   (`estimated_total_cost_lower_bound`) and in the UI, or derive the estimate from this persona's own
   historical `cost_usd` percentiles — which the app already computes for anomaly detection
   (`companion/proactive/baselines.rs` holds `p50_cost` / `p95_cost` / `declared_cost_usd`).
5. **There is no reconciliation between the two ledgers or between rows and rollups.** `provider_audit_log`
   and `persona_executions` agree perfectly where they join and are $1,637.96 apart in total; `sla_daily`
   is $820.75 high. Nothing computes either delta. **Fix:** a periodic reconciliation that reports
   orphaned audit rows and rollup drift as healing issues — the `persona_healing_issues` machinery already
   exists and `background.rs` already writes to it for schedule failures.
6. **A rollup table cannot represent deletion, and the upsert shape hides it.** **Fix:** either delete
   `sla_daily` buckets whose source rows have gone (a `DELETE … WHERE NOT EXISTS` pass alongside the
   upsert), or make the rollup a view. Recomputing only touched buckets is a correctness bug, not a
   performance optimisation.
7. **The budget field means two things** (§7.H). **Fix:** split into `monthly_budget_usd` and
   `per_call_budget_usd`, defaulting the second from the first only with an explicit divisor the operator
   can see.
8. **The census engine cannot express "must be zero".** The must-never-happen condition here — *a
   budget-gated call whose cost is unknown yet counted as $0* — has no regex form and no ratchet form,
   because a rule pinned at zero can never fail (`engine.mjs:264-273` says so explicitly). **This
   condition needs a test, not a gate** — see §9.

---

## 9. The missing gate

**Manifestation layer.** Per [`golden-path-contract.md:34-60`](../golden-path-contract.md), what follows is
a *proxy* for a semantic condition, tuned to this repo's idiom. The condition is stated stack-free first
so an adopting repo re-derives its own proxy. Everything in §7 shipped under a green `npm run check`, a
green `cargo test`, and — in §7.B's case — under a *passing unit test that asserts the defect*.

**On severity: this is a census rule, not a lint level.** The census runner is fatal under `--check` by
design and has nothing to do with ESLint's warn/error axis. No argument from warning volume is made or
needed here; per the repo's own measurement, a warn-level rule enforces nothing at either gate at any count.

### Semantic conditions, stated stack-free

- **C1 — a monetary quantity whose value is unknown is materialized as the number zero, so a total that
  omits a call is indistinguishable from a total that includes a free one, and any ceiling computed from
  that total silently rises.** *Proxy here:* an identifier naming money (`cost`/`Cost`/`spend`/`Spend`)
  collapsed to the literal `0` by a zero-default operator (`unwrap_or(0`, `unwrap_or_default()`, `?? 0`,
  `|| 0`). *Precondition:* this repo names money with those four tokens, expresses absence as Rust
  `Option` / TS `null | undefined`, and spells the collapse with those four operators. A repo that names
  money `amount`/`price`/`charge`, or that uses a `Money` type with a total function, scores zero while the
  condition is present.
- **C2 — a spend total that a control reads is derived by incrementing rather than by re-aggregating the
  rows it claims to summarize.** Deliberately **not** gated below; see the refusals.

### Conditions deliberately NOT given a census rule

- **C2 — an incremented money total (3 sites).** Two of the three are legitimate in context (an in-memory
  transient ledger; an EWMA that is not a total), so a rule matching all three would fire on correct
  content at a 2:1 rate — the contract's stated worst case. The one that matters
  (`deliberation.rs:197`) is a **single line**, and the right response to a single line is to fix it, not
  to ratchet it.
- **C3 — money stored as `REAL` (36 sites, 100% of them).** A rule here would fire on **every** money
  column in the repo, all of which are correct for this domain (§7.0(b)). A gate that fires on correct
  content is worse than no gate, and this one would fire on nothing else.
- **C4 — a price table with no `verified_at` (2 tables).** Two sites. The fix is Gap 3, a type change; a
  counter would spend its authority on a population of two. Worth a CI *staleness* check once the type
  exists — a different mechanism, keyed on the date rather than on the absence of one.
- **C5 — the must-never-happen condition: a budget-gated call whose cost is unknown yet counted as `$0`.**
  **This one is a refusal with a reason, and it is the most important line in this section.** The right
  gate would assert a count of **zero** — no cancelled/killed execution may carry `Some(0.0)` — and
  `engine.mjs:264-273` refuses a zero baseline by design: *"a rule pinned at 0 is a gate that can never
  fail."* The engine is correct and the condition is real, so the census is the wrong host. **The right
  host is a Rust test**, and it does not exist:

  ```rust
  // src-tauri/src/engine/mod.rs — owed, alongside cancel_execution
  #[test]
  fn cancelled_execution_does_not_record_zero_cost() {
      // Given a running execution whose CLI is killed before any `result` event,
      // the persisted row must carry cost_usd = NULL (unknown), never Some(0.0).
      // Live data 2026-08-14: 2/2 cancelled rows, mean runtime 103.9s, all $0.00.
  }
  ```

  A second owed test pins §7.B's field-name defect against a **captured real event** rather than a
  hand-written fixture: assert that `update_metrics_from_result` extracts non-zero tokens from a verbatim
  CLI `result` line. Both are assertions about a *shape*, which is what a test is for and what a ratchet
  is not.
- **C6 — a spend predicate written longhand instead of importing the shared constant (§7.D(iii)).** Real,
  but the population is one query and the fix is one import. Recorded so the next composer widens the
  constant's reach rather than adding a counter.

### The rule — validated

Run against the working tree with
`node scripts/census/run-census.mjs --rules <scratch-file> --check` → **exit 0** in 0.92 s, and the counts
were reproduced by an **independent second implementation** (a separate walker with its own line indexer
and comment filter, written without importing `lib/engine.mjs`): **21 files / 25 matches by both.** Every
one of the 25 was then read individually: **25/25** are genuine instances of the stated condition.

*One near-miss worth recording, because it is the exact failure the contract warns about.* The first draft
of this pattern was case-insensitive, which matched **`ha`|`sPend`|`ing`** — six `hasPending = (…?.length ?? 0)`
sites in the glyph components were counted as money defects. Making the money nouns case-sensitive
(`cost|Cost|spend|Spend`, no `i` flag) removes the whole class without a lookbehind. The pattern is
single-line by construction (`[^\n]{0,48}?`), so `engine.mjs:210`'s comment-skip rewind has no multiline
extent to eat.

```json
{
  "rules": [
    {
      "id": "unknown-money-as-zero",
      "goldenPath": "docs/concepts/golden-paths/llm-spend-accounting.md",
      "title": "A monetary amount whose value is unknown is materialized as the number zero",
      "roots": ["src", "src-tauri/src", "src-tauri/core", "src-tauri/db", "src-tauri/engine"],
      "extensions": [".ts", ".tsx", ".rs"],
      "signal": {
        "pattern": "(?:cost|Cost|spend|Spend)[A-Za-z_0-9$]*(?:[^\\n]{0,48}?\\.\\s*unwrap_or(?:_default\\(\\)|\\(\\s*0)|\\s*\\)?\\s*(?:\\?\\?|\\|\\|)\\s*0(?![.\\d]))",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "an identifier naming a monetary quantity (cost/Cost/spend/Spend) collapsed to the literal 0 by a zero-default operator (`unwrap_or(0`, `unwrap_or_default()`, `?? 0`, `|| 0`). PROXY FOR the stack-free condition: *unknown* and *free* are rendered as the same value, so a total that omits a call is indistinguishable from one that includes a free call, and any ceiling computed from that total silently rises. Precision measured 25/25 on a full read of every match. The two highest-severity are engine/background.rs:2510 and engine/mod.rs:2778, both `get_monthly_spend(...).unwrap_or(0.0)` — a database error there reads as '$0 spent this month' and OPENS the monthly budget cap, so the failure mode of the measurement becomes a bypass of the control. Seven more are DB row-mappers (`row.get::<_, Option<f64>>(\"cost_usd\")?.unwrap_or(0.0)`) that destroy a NULL the nullable column was holding correctly; the remainder are TS reducers and adapters where a span, day-bucket or dashboard field of unknown cost contributes 0 to a displayed or gated total (ChainSpanRow/useChainTrace feed the chain-cost accumulator that CHAIN_MAX_COST_USD gates). CASE-SENSITIVITY IS LOAD-BEARING: an `i` flag matches `haSPENDing`, admitting six `hasPending = (x?.length ?? 0)` false positives in src/features/agents/sub_glyph — do not add it. PRECONDITION (measured, must be re-derived per repo): this repo names money with the tokens cost/spend, expresses absence as Rust `Option` or TS `null|undefined`, and spells the collapse with `unwrap_or`/`??`/`||`. A repo naming money `amount`/`price`/`charge`, or using a Money newtype with a total function, scores zero while the condition is present — and the sibling `personas-cloud` has the identical defect spelled `costUsd: msg.totalCostUsd ?? 0` (dispatcher.ts:461) feeding its own budget gate, while `brainiac` refuses it in a comment (providers/openai.rs:196) and has no dollar field to falsify. LEGAL FIX: keep the money `Option<f64>` / `number | null` from the parse site to the column (both ends already are — it is the carrier struct in between that destroys it), and make the consumer handle absence explicitly. For a spend read that gates a budget, fail CLOSED: propagate the error rather than substituting 0."
      },
      "baseline": { "files": 21, "matches": 25 },
      "floor": 4000
    }
  ]
}
```

**Measured result:**

```
  rule                    files   base  matches   base  walked  floor
  OK   unknown-money-as-zero        21     21       25     25    5782   4000
  census OK — 1 rule(s), 5782 file-visits, 25 surviving violation(s) across 21 file(s).
```

The floor sits below the observed walk (5,782 `.ts`+`.tsx`+`.rs` across the six roots) with margin,
consistent with the existing `hand-assembled-currency` and `raw-select` rules that walk the `src` subset.

### The positive control

**DO NOT MERGE this block into `rules.json`** — it carries no `baseline` and is a *discriminator proof*,
not a ratchet.

**And it surfaced a half-landed fix in the census engine itself, which is worth more than the control.**
`validateRule` was taught about positive controls on 2026-08-14 — `engine.mjs:362-371` detects a
`positive-control` id and *requires* the absence of a baseline, with a comment explaining that a composer
who followed the brief "could not validate the artifact the instruction demanded". Measured today, that
fix reaches only half the runner:

| step | correctly-shaped control (no baseline) | control given a baseline |
| --- | --- | --- |
| `validateRule` | **0 errors** — accepted | `a positive control must NOT carry a baseline …` — refused |
| `scanRule` | **OK** — 53 files / 71 matches / 5,782 walked | (not reached) |
| `assertRule` | **`TypeError: Cannot read properties of undefined (reading 'files')`** at `engine.mjs:292` | (not reached) |

`assertRule` still does `const base = rule.baseline;` and dereferences `base[metric]` unconditionally
(`:289-292`), so `run-census.mjs:130` **crashes on the exact artifact the validator was just taught to
accept.** The fix is a one-line guard (`if (!base) return problems;` after the structural checks, or
skipping the drift loop when the rule is a control). Recorded here rather than patched, because this
document does not edit `scripts/census/`.

**Consequence for this section:** the discrimination below was proved by the route that *does* run —
substituting the compliant pattern under the violating rule's baseline, which produces
`[drift] files rose 21 -> 53 (+32)`, exit 1. That is the stronger demonstration anyway, because it shows
the gate cannot be satisfied by pointing it at the right answer.

```json
{
  "rules": [
    {
      "id": "unknown-money-as-zero-positive-control",
      "goldenPath": "docs/concepts/golden-paths/llm-spend-accounting.md",
      "title": "POSITIVE CONTROL — the COMPLIANT spelling: a money field that preserves its null state",
      "roots": ["src", "src-tauri/src", "src-tauri/core", "src-tauri/db", "src-tauri/engine"],
      "extensions": [".ts", ".tsx", ".rs"],
      "signal": {
        "pattern": "(?:cost|Cost|spend|Spend)[A-Za-z_0-9$]*\\s*:\\s*(?:Option<|number \\| null)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "The INVERTED form of unknown-money-as-zero: a money-named field whose declared type can represent absence (`Option<f64>`, `Option<Option<f64>>`, `number | null`). Run standalone to prove the violating matcher DISCRIMINATES rather than merely matching money-shaped text. Not a ratchet: it has no baseline, so the runner refuses it — by design."
      },
      "floor": 4000
    }
  ]
}
```

**Both populations and their overlap**, measured by the independent implementation:

| | pattern | files | matches |
| --- | --- | ---: | ---: |
| Violating | money → `unwrap_or(0` / `?? 0` / `\|\| 0` | **21** | **25** |
| Compliant | money → `Option<…>` / `number \| null` | **53** | **71** |
| **Files matching both** | | **1** | |

The single overlap is `src-tauri/core/src/models/lab.rs`, which declares `cost_usd: Option<f64>` on one
struct (`:538` region) and collapses a different one with `unwrap_or(0.0)` in a row mapper (`:140`) — a file
that genuinely contains both spellings, which is itself worth knowing. **The compliant population is 2.5×
larger and 96% disjoint**: the two spellings are both common in this codebase and the matcher separates
them cleanly. Substituting the compliant pattern under the violating rule's baseline produces
`[drift] files rose 21 -> 53 (+32)` — **exit 1** — so the gate cannot be satisfied by pointing it at the
right answer.

### How it fails loudly if its own precondition is absent

Not asserted — **executed** against the real working tree, exit code captured:

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified) | **0** | `census OK — 1 rule(s), 5782 file-visits, 25 surviving violation(s) across 21 file(s).` |
| `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere. A census rule that finds nothing is a broken regex far more often than a finished migration.` |
| `floor` → 9000 | **1** | `[structural] walked 5782 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| baseline inflated (a silent drop) | **1** | `[drift] files dropped 120 -> 21 (-99) without the baseline moving.` |
| baseline deflated (a rise) | **1** | `[drift] files rose 5 -> 21 (+16). New violations of …llm-spend-accounting.md` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 4000` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 4000` |
| grounding (`goldenPath`) removed | **1** | `missing grounding — a rule needs "goldenPath" … or "principle"` |
| `exclude` path renamed | **1** | `[structural] exclude "src/lib/harnessMOVED/**" matched no file. The exemption is stale` |
| `exclude` `reason` shortened to `"x"` | **1** | `exclude[0] … needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| **POSITIVE CONTROL — pattern → the COMPLIANT form** | **1** | `[drift] files rose 21 -> 53 (+32)` |

### Sequencing

1. **Make `ExecutionMetrics.cost_usd` an `Option<f64>` (Gap 1) before anything else.** It is the root of
   §7.C, both ends of the pipe already accept `None`, and it removes ~7 of the census rule's 25 matches by
   making the collapse unnecessary rather than merely discouraged.
2. **Fix the two `get_monthly_spend(...).unwrap_or(0.0)` sites.** Two lines, and they are the difference
   between a budget cap and a suggestion.
3. **Fix the token field name** (`total_input_tokens` → `usage.input_tokens`) **and replace the fixture
   with a captured real event.** Two lines plus a test, and it restores the only quantity that could ever
   audit the cost. Do this before anyone reasons about tokens.
4. **Write the two owed tests** (C5): cancelled-execution cost, and real-event token extraction. These are
   the must-never-happen assertions the census cannot express.
5. **Land `unknown-money-as-zero` immediately after 1–3.** 25 sites, one legal fix, a destination that is
   already correct at both ends.
6. **Stamp the model on `provider_audit_log`** (Gap — §7.F). One binding, and it converts $3,682 of
   unattributable spend into an answerable question.
7. **Reconcile the ledgers and the rollup** (Gap 5/6), reporting drift as a healing issue.
8. **Split `max_budget_usd`** (Gap 7) and **date the price table** (Gap 3). Both are schema changes and
   both are safe to sequence last, because neither is load-bearing today: no persona has a cap set, and no
   recorded dollar comes from a price table.

---

## Type over gate — the answer

**Yes, decisively, and unusually cleanly: the dominant defect in this document is one struct field's
type, both ends of its pipe already have the right type, and changing it is a one-word edit.**

**1. The largest class is a missing `Option`, not a habit.** `core/src/types.rs:416`:

```rust
pub struct ExecutionMetrics {
    pub model_used: Option<String>,     // <- nullable
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cost_usd: f64,                  // <- NOT nullable. This is the defect.
    pub session_id: Option<String>,
}
```

Every neighbour that could be absent *is* an `Option`. The one field that carries money is not. And the
consequence is not a style issue — it is that `ExecutionMetrics::default()` has a **definite** cost of
`$0.00`, which is what a killed process writes. Both ends of the pipe are already correct:
`UpdateExecutionStatus.cost_usd` is `Option<f64>`; the column is `cost_usd REAL` (nullable at
`incremental.rs:1453`, `:6380`). **The carrier struct in the middle is the only thing destroying the
distinction**, and `runner/mod.rs:2891` faithfully re-wraps the destroyed value as `Some(0.0)`.

```rust
pub cost_usd: Option<f64>,   // the whole fix
```

The compiler then finds every site that must decide: the five `Some(metrics.cost_usd)` call sites become
`metrics.cost_usd`, and the cancel path is *forced* to answer the question §7.C says nobody answered.
**This is the contract's `FacetedDecisionTable` pattern exactly** — a required decision beats an optional
one that silently defaults — except here the "required prop" already exists at both ends and one struct
opted out. The repo's own counter-example proves the point: `LlmSpendInsert.cost_usd` **is** `Option<f64>`,
and `dev_llm_spend` holds 3 genuinely-zero-cost rows alongside 85 real ones with the distinction intact.

**2. A second type change closes the price-table class.** `Option<ModelPrice>` where
`ModelPrice { input_per_m, output_per_m, cache_read_per_m, cache_write_per_m, verified_at }` makes three
of §7.A's problems unrepresentable at once: a table entry without a verification date does not compile, a
model without cache pricing does not compile, and a lookup miss is a `None` the caller must handle rather
than a silent Sonnet default. This is strictly better than a census rule over price tables, which is why
C4 above is a refusal.

**3. A third — and this one I recommend *against*, with reasons.** The obvious move is
`struct Usd(i64 /* micro-dollars */)`, making the float question unrepresentable. It would be correct:
§7.0(b) shows the data needs 7 decimal places and that "cents" is the wrong unit. But it is the wrong
trade here. There are **36 money columns and 23 `cost_usd`-bearing ts-rs bindings**, every one of which
would change its serialized shape; the arithmetic that would drift is *summation of values around $0.5*,
where `f64` has ~15 significant digits of headroom and the rounding error over 4,001 rows is far below a
micro-dollar; and every total that matters is re-aggregated on read (P4) rather than accumulated, which is
the actual defence against drift. **The type that would help is the nullable one, not the fixed-point
one.** Recorded because the convergent "everyone uses floats for money" finding invites the reflex, and
the reflex is wrong for a domain whose atomic unit is a millionth of a dollar.

**4. Where no type can reach, and this is the leaf's real finding.** No signature can express *"this
number came from the vendor's terminal event"* versus *"this number was never observed"* versus *"this
number is our estimate"* — all three are `f64`, and `Option<f64>` only separates the second. The
structural equivalent would be a provenance-carrying enum:

```rust
enum Spend {
    Reported(f64),        // the vendor's own total_cost_usd
    Estimated(f64, &'static str),  // computed from a dated price table
    Unobserved,           // the call never reached its terminal event
}
```

which would make `build_preview`'s output impossible to store in a column that expects a measurement, and
would make the cancel path's answer visible in the type rather than buried in a `0.0`. **That is the
correct model and it is more invasive than it is worth today** — one execution table, one estimator, one
consumer. It is recorded because it is the only construction that reaches P1, and because §9's census rule
is precisely the admission that it was not taken.

**5. The general rule, and it is the third variation on a theme this library keeps finding.**
[`number-and-cost-formatting.md`](./number-and-cost-formatting.md) found a primitive that *accepted* the
locale and *defaulted* it, so the default shipped. [`design-token-usage.md`](./design-token-usage.md) found
an open vocabulary and closed it. Here:

> **Make absence representable at every hop, not just at the ends.** A pipeline whose source and sink both
> model "unknown" but whose carrier does not has not preserved the distinction — it has laundered it. The
> nullable column is worthless if a non-nullable struct passes through it, and the difference between a
> $0 run and an unmeasured one is exactly the difference between a budget cap and a decoration.
