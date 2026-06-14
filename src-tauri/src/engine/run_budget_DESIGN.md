# `run_budget` — aggregate cost ceiling for multi-spawn runs (P2)

Co-located design for `engine/run_budget.rs`. Status: **warn-only shipped; evolution + lab + pipeline wired**. Companion to the P1 cache-token capture (`parser.rs`) — P1 made per-spawn cost accurate; P2 accumulates it across a run.

## Problem

`--max-budget-usd` / `--max-turns` are enforced **per CLI spawn** only
(`prompt/cli_args.rs:132-145`). Several subsystems spawn the CLI **N times per one
logical operation** with no run-level ceiling:

| Subsystem | Spawns / op | Grouping id | Same persona? |
|---|---|---|---|
| **evolution** | variants × ≤3 scenarios × (run + eval) → ~15–25 | `evolution_cycles.id` | per-variant |
| **lab** arena/AB/matrix | 1 + scenarios×models → ~10–15 | `lab_*_runs.id` | no (model compare) |
| **pipeline** | N DAG nodes | `pipeline_runs.id` | no (per-node persona) |
| build_session | ≤12 turns (`--continue`) | `build_sessions.id` | yes |
| chain | 0 direct (async cascade) | none; `MAX_CHAIN_DEPTH=8` | — |

A misconfigured evolution policy or lab matrix can quietly cost N× a single run.

## Primitive

`RunBudgetLedger` — engine-global `LazyLock<RunBudgetLedger>` (house pattern:
`api_proxy.rs`, `bundle.rs`), `Mutex<HashMap<run_id, Entry>>`, also constructable
for unit tests. Global (not `AppState`) because deep async loops like
`run_evolution_cycle(pool, …)` don't carry `AppState`.

```
register(run_id, kind, ceiling_usd)   // 0 = unlimited (track-only)
record(run_id, cost_usd) -> RecordOutcome { exceeded_now }   // caller warns once
state(run_id) -> Option<RunBudgetState>                      // serializable snapshot
finish(run_id)                          // retained 30m for post-run reads, then swept
```

**Cost source:** the CLI `result` event `total_cost_usd` (`parser.rs`) — for
evolution, `output.cost_usd + scores.cost_usd` per scenario eval.

**Semantics, honest:** cost is known only *after* a spawn finishes, so the ceiling
is a **launch gate** ("don't start new spawns past X"), not a real-time kill. Each
spawn's own `--max-budget-usd` bounds the single in-flight call. Warn-only today:
crossing sets `exceeded` + one `tracing::warn!`; the run continues.

## First consumer — evolution

- `register(cycle_id, "evolution", evolution_ceiling_usd())` at cycle start.
- Ceiling from `PERSONAS_RUN_BUDGET_EVOLUTION_USD` env (default $2.00; 0 = unlimited)
  — also the test seam to force the exceed path cheaply.
- `record(cycle_id, output.cost_usd + scores.cost_usd)` per scenario in
  `evaluate_persona_on_scenarios`; warn on `exceeded_now`.
- Final `RunBudgetState` embedded into `EvolutionCycleSummary.budget` (already
  persisted to `summary_json` + surfaced by `evolution_list_cycles`) → visible in
  the cycle UI and assertable by the e2e **with no new command/bridge**.
- `finish(cycle_id)` after `complete_cycle`.

## Test suite

- **Unit** (`run_budget.rs` `#[cfg(test)]`, deterministic/free, mirrors
  `queue.rs`): accumulation, exceed-once, boundary `>=`, unlimited, unregistered
  no-op, clamps, re-register reset, finish, concurrent-record atomicity.
- **Integration** (`tools/test-mcp/e2e_budget_ledger.py`, reuses `lib` +
  `evolution_upsert_policy`/`evolution_trigger_cycle`/`evolution_list_cycles`):
  build+promote a persona, run a cycle, assert `summary.budget.spentUsd` /
  `spawnCount` tracked, cycle still `completed` (warn-only didn't abort), and with
  the tiny-ceiling env, `budget.exceeded == true`. Run the instance with
  `PERSONAS_RUN_BUDGET_EVOLUTION_USD=0.001` to exercise the exceed path.

## Staged follow-ups (not in this cut)

1. **~~Lab + pipeline consumers~~ DONE** — `register/record/finish` wired into
   `test_runner::run_test` (records `scores.cost_usd` per scenario×model; ceiling
   `PERSONAS_RUN_BUDGET_LAB_USD`, default $3) and `pipeline_executor::run_pipeline`
   (records each node's `execution.cost_usd`; ceiling
   `PERSONAS_RUN_BUDGET_PIPELINE_USD`, default $5). NOTE: lab spawns models
   **concurrently** (`tokio::spawn`), so a future enforce-mode needs a pre-launch
   *reservation* (estimate-then-reconcile) like `queue.rs::ConcurrencyTracker::admit`,
   not a sequential gate. Also fixed an evolution double-count this pass:
   `score_result` copies `output.cost_usd` into `scores.cost_usd`, so record once.
2. **~~Enforce mode~~ DONE (launch-gate)** — opt-in via `PERSONAS_RUN_BUDGET_ENFORCE`
   (default warn-only). `ledger.should_halt(run_id)` = `enforce && exceeded`;
   each consumer checks it at the top of its unit loop (evolution variants / lab
   scenarios / pipeline nodes) and `break`s — in-flight spawns finish, partial
   results are preserved, the run finalizes normally. Remaining refinement: a
   distinct `budget_exhausted` terminal status per subsystem (today the run
   completes and the ledger's `exceeded`/enforce state is the observable "why"),
   and a pre-launch *reservation* (estimate-then-reconcile) for the concurrent
   within-scenario lab spawns to bound overshoot tighter.
3. **DB persistence** — run-level cumulative cost columns on the grouping tables
   for historical/aggregate dashboards (today it lives in-memory + the cycle
   summary).
4. **chain** — would need a `cascade_id` propagated through `persona_events`;
   deferred (depth is already capped at 8).
