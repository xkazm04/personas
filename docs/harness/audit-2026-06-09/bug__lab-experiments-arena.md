# Bug Hunter — lab-experiments-arena
> Total: 6
> Severity: 2 critical, 3 high, 1 medium

## 1. Panicked / failed variant tasks are silently dropped, so partial runs are recorded as "completed"
- **Severity**: critical
- **Category**: silent-failure
- **File**: src-tauri/src/engine/test_runner.rs:1643-1693, 1726-1734
- **Scenario**: An arena/eval/A-B run fans out `scenario × model × variant` tasks via `tokio::spawn`. In the collection loop, a JoinError is handled with `tracing::error!("Lab task panicked: {e}"); continue;` (line 1647-1649). Inside the task, a DB write failure in `persist_result` is `let _ = ...create_result(...)` (e.g. eval line 2270, ab line 2190, matrix line 2393) — discarded. After the loop the run is unconditionally marked `LabRunStatus::Completed` (line 1726), as long as it wasn't cancelled. There is no check that the number of persisted results equals `total = scenario_count * model_configs.len() * variants.len()` (line 1551).
- **Root cause**: Completion is defined as "the loop finished", not "every fanned-out cell produced a persisted result". Per-task panics, JoinErrors, and per-row DB insert failures are caught-and-forgotten, never propagated to the run's terminal status.
- **Impact**: data loss / corruption — a run that lost half its variant cells (panic, pool exhaustion, disk full, RETURNING failure) is presented to the user as a finished, trustworthy comparison. `get_version_ratings` and the frontend leaderboards then average over a silently-incomplete sample and crown a "winner" from missing data.
- **Fix sketch**: Track `expected` vs `persisted_ok` counters across the loop; if `persisted_ok < expected` (or any JoinError/insert error occurred) finalize the run as `Failed`/partial with an error message recording how many cells were lost, instead of `Completed`. Make `persist_result` return `Result` and bubble failures.

## 2. Duplicate version_number across selected versions mismatches eval/A-B results to the wrong version
- **Severity**: critical
- **Category**: state-corruption
- **File**: src-tauri/src/engine/test_runner.rs:2162-2169, 2257-2279 (eval); 2177-2199 (ab)
- **Scenario**: `run_eval_test`/`run_ab_test` build each variant's label as `format!("v{}", num)` from the version_number, then in `persist_result` resolve the version back with `version_lookup.iter().find(|(_, num)| format!("v{}", num) == variant.label)` and write `version_id: src.0`. Version numbers are allocated by a non-atomic `SELECT COALESCE(MAX(version_number),0)+1 ... INSERT` (src-tauri/src/db/repos/execution/metrics.rs:101-114), so two versions of the same persona can legitimately share a version_number (concurrent creation, or matrix auto-version at lab.rs:606-618 racing another writer). When two selected eval versions share a number, `.find()` returns the FIRST match for BOTH variants — version B's results are persisted under version A's `version_id`, and the tracker key `format!("{}:{}", label, model.id)` (line 1655-1659) merges their scores.
- **Root cause**: A non-unique, display-oriented value (version_number) is used as the join key between a variant and its persisted identity, instead of the unique `version_id`.
- **Impact**: corruption — the ratings rollup attributes one prompt's quality to a different prompt; the user activates/ships the wrong version believing it scored well.
- **Fix sketch**: Key the variant by its unique `version_id` (or the variant's index `vi`) end-to-end; never round-trip through version_number. Carry `version_id` directly on `LabVariant` so `persist_result` needs no lookup. Separately, make version_number allocation atomic.

## 3. lab_cancel_* returns a hard error when the run already reached a terminal state
- **Severity**: high
- **Category**: edge-case
- **File**: src-tauri/src/commands/execution/lab.rs:191-205 (arena), 400-414 (ab), 525-539 (matrix), 773-787 (eval); transition guard at src-tauri/src/db/macros.rs:449-451
- **Scenario**: User clicks Cancel on a run that completed milliseconds earlier (common with fast/cached scenarios). `lab_cancel_arena` calls `update_run_status(.., Cancelled, ..)?`. The macro reads current status and calls `validate_transition`, which returns `Err` for `Completed|Failed|Cancelled -> Cancelled` (src-tauri/src/db/models/lab.rs:55). The `?` propagates `AppError::Validation`, so the cancel IPC fails. In labSlice `cancelRun` the catch reports the error as a toast, but `finally { lc.markCancelled(set) }` still flips UI state — the user sees a scary "Failed to cancel" error for a no-op race they cannot avoid.
- **Root cause**: Cancel is treated as a state transition subject to the same strict guard as forward progress, rather than an idempotent best-effort request that is a no-op once terminal.
- **Impact**: UX degradation — spurious error toasts on a benign race; also double-cancel (cancel twice) always errors the second time.
- **Fix sketch**: In the cancel commands, treat `validate_transition` rejection from an already-terminal state as success (fetch current status first, or swallow the specific Validation error when current status `is_terminal()`).

## 4. Arena/Eval start: empty version set or all-error scenarios still completes with a fabricated "best" winner
- **Severity**: high
- **Category**: edge-case
- **File**: src-tauri/src/engine/test_runner.rs:1826-1838 (build_arena_summary), src/features/agents/sub_lab/libs/labAggregation.ts:110-122
- **Scenario**: If every variant cell errors (CLI unavailable, all timeouts) the tracker still contains rows with `None` scores; `avg_scored(...).unwrap_or(0.0)` (test_runner.rs:1792-1794) makes every model's composite 0, and `rankings.first()` (line 1826) names an arbitrary model `best_quality_model`. On the frontend `bestModelId: aggregates[0]?.modelId` (labAggregation.ts:121) and eval `winnerId: aggs[0]?.versionId` (evalAggregation.ts:155) likewise return the first after a `b.compositeScore - a.compositeScore` sort where all composites are 0 — a tie broken by insertion order, presented as a real winner with no tie indication.
- **Root cause**: "no signal" (all-zero / all-unscored) is not distinguished from "genuine winner at 0". Success theater: a winner is always produced even when no cell scored.
- **Impact**: UX degradation / misleading results — user trusts a "best model/version" that was chosen by array order among total failures.
- **Fix sketch**: Return `bestModelId/winnerId = null` (and suppress the winner badge) when every aggregate has `count===0` of scored samples or all composites are equal; surface "no scored results" instead of a phantom champion.

## 5. Matrix combinatorial fan-out and consensus sample count are unbounded / weakly bounded — no cap on scenario×model×variant spawns
- **Severity**: high
- **Category**: recovery-gap
- **File**: src-tauri/src/engine/test_runner.rs:1551, 1572-1640
- **Scenario**: `run_lab_loop` spawns one `tokio::spawn` per `(model, variant)` for every scenario, with no concurrency limiter. Eval accepts an unbounded `version_ids` list (commands/execution/lab.rs:651 only enforces `>= 2`) and an unbounded `models` list; `total = scenario_count * models * variants` (line 1551). A user selecting, say, 8 versions × 8 models × 5 generated scenarios spawns 320 concurrent CLI child processes / HTTP calls at once, exhausting the DB pool, file handles, and provider rate limits — which then manifests as finding #1 (mass task failure recorded as "completed"). Consensus clamps samples to 2..20 (line 1989) but still fans all out simultaneously.
- **Root cause**: Fan-out width is `O(scenarios × models × variants)` with no upper bound and no bounded-parallelism semaphore; the design assumes small N.
- **Impact**: crash / resource exhaustion → cascades into silent partial completion.
- **Fix sketch**: Add an explicit cap on `versions × models` (reject oversized matrices at the command boundary with an actionable message) and gate the inner spawns behind a `tokio::sync::Semaphore` with a fixed permit count so only K cells run concurrently.

## 6. Consensus agreement-rate tie-breaking conflates a 3-way split with consensus
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/engine/test_runner.rs:2097-2107 (compute_agreement_rate)
- **Scenario**: Agreement is `dominant / n` where `dominant = max bucket count` over three quality tiers. With 3 samples landing one-each in low/medium/high, every bucket is 1, `max = 1`, agreement = `1/3 ≈ 0.33` — reported as "33% agreement" rather than "no agreement / fully split". With 2 samples in different tiers, `dominant=1`, agreement=0.5, indistinguishable from genuine partial consensus. Ties between buckets are resolved by `iter().max()` taking the first max with no tie awareness, and a single-sample scenario is hard-coded to `1.0` agreement (line 2092-2095) — inflating the rate. (Note: consensus is currently `#[allow(dead_code)]` / unwired, so impact is latent.)
- **Root cause**: Plurality (largest single bucket) is used as the agreement metric, which never reaches 0 for n≥1 and rewards an even split; tie/degenerate cases are not special-cased.
- **Impact**: UX degradation — when wired, the consistency score systematically overstates agreement and can't express "the model is non-deterministic across this scenario".
- **Fix sketch**: Use a metric that bottoms out at true disagreement (e.g. pairwise-agreement proportion, or `(dominant-1)/(n-1)` so an even split → 0); exclude single-sample scenarios from the average instead of scoring them 1.0; flag bucket ties explicitly.
