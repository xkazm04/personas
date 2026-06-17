# Test Mastery — Genome & Evolution
> Total: 8 findings (2 critical, 3 high, 2 medium, 1 low)

## 1. Promotion compare-and-swap (lost-update guard) has no test
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/evolution.rs:577-620 (`promote_variant`)
- **Current test state**: none
- **Scenario**: A cycle snapshots `persona.updated_at` at start (line 207), spends minutes evaluating, then promotes via `UPDATE personas ... WHERE id = ?9 AND updated_at = ?10`. The 0-rows-affected branch (lines 614-618) is the only thing standing between "abandon promotion" and silently clobbering a concurrent user edit or a second cycle's promotion. If a refactor drops the `AND updated_at = ?` clause, removes the `rows == 0` check, or the column list drifts from the genome fields, a promotion would overwrite newer persona state (data loss on a user's live persona) and no test would fire.
- **Root cause**: The CAS write lives in a private fn reachable only through the async `run_evolution_cycle`; no direct unit test exercises the match/mismatch of `expected_updated_at`. The codebase already has the `test_pool()` in-memory-SQLite pattern (e.g. recipe_suggestions.rs:140) that makes this directly testable.
- **Impact**: Silent loss of a user's hand-edited prompt/config, or two cycles racing one incumbent — exactly the bug the CAS was added to prevent. A regression here is invisible until a customer reports their edits vanished.
- **Fix sketch**: Repo/engine test with a real pool: insert a persona, call `promote_variant` with the correct `updated_at` → assert rows updated + new prompt persisted; then mutate `updated_at` out-of-band and call again with the stale token → assert `Err(Validation)` and that the row is unchanged. Invariant: **promotion only applies when the incumbent is unchanged since cycle start.**

## 2. `genome_adopt_offspring` transaction + credential encryption + tool dedup untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/execution/genome.rs:291-433 (`genome_adopt_offspring`, `encrypt_profile_for_adoption`)
- **Current test state**: none
- **Scenario**: Adoption (a) wraps persona-insert + tool-assign + adoption-marker in one transaction (lines 335-391) so a partial failure can't orphan a persona; (b) dedups crossover-artifact tool IDs via a HashSet (lines 368-383); (c) calls `encrypt_profile_for_adoption`, which pulls `auth_token` out of `model_profile` JSON and AES-encrypts it into `auth_token_enc`/`auth_token_iv` (lines 398-433). A regression that commits the persona before a tool insert fails, that re-introduces duplicate `persona_tools` rows, or — worst — that writes the raw `auth_token` to the DB in cleartext would pass CI today.
- **Root cause**: The command is a `#[tauri::command]` and has never been exercised; `encrypt_profile_for_adoption` is a pure-ish helper (only dependency is `crypto::encrypt_for_db`) trivially unit-testable in isolation but has no test.
- **Impact**: A credential leak (plaintext auth token at rest) is a security incident; orphaned personas / duplicate tool rows are data-integrity bugs surfaced to users.
- **Fix sketch**: (1) Pure unit test on `encrypt_profile_for_adoption`: input with `auth_token` → assert output has NO `auth_token` key, HAS `auth_token_enc`+`auth_token_iv`, and the ciphertext != plaintext; input without a token → assert passthrough unchanged; invalid JSON → assert `Validation` error. Invariant: **no cleartext auth_token ever survives adoption.** (2) Repo-pool test: genome JSON with duplicate tool_ids → assert exactly one `persona_tools` row per distinct id and adoption marker set.

## 3. `compute_fitness` scoring math has no test
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/genome.rs:490-556 (`compute_fitness`)
- **Current test state**: exists-but-weak (only `test_fitness_score_defaults_for_no_data` constructs a struct literal — it never calls `compute_fitness`)
- **Scenario**: Fitness drives the breeding rank order and the reported incumbent fitness in every cycle summary. The normalization is load-bearing: `speed = 1 - duration/60_000`, `cost = 1 - cost/1.0`, `quality = success/(success+failure)`, all clamped, then weighted by the objective. A sign flip, a wrong divisor, or dropping a clamp would silently skew which variants look better and what users see, with zero test feedback. The empty-entries → all-zero early return (lines 500-507) is also unverified against the real fn.
- **Root cause**: The fn reads knowledge via `knowledge_repo::list_for_persona`, so it needs a pool — but the test_pool pattern already exists; the existing "test" sidesteps it with a struct literal (success theater).
- **Fix sketch**: Repo-pool test: seed `cost_quality` knowledge rows (e.g. 9 success / 1 failure, avg_cost 0.10, avg_duration 6_000ms) → assert `quality≈0.9`, `speed≈0.9`, `cost≈0.9`, and `overall` equals the exact weighted sum for a known objective. Add boundary cases: duration > 60s clamps speed to 0; cost > $1 clamps cost to 0; empty entries → all zeros. Invariants: **monotonic (lower cost/duration ⇒ higher component) and clamped to [0,1].**

## 4. Existing genome crossover/mutate/breed tests assert presence, not behavior
- **Severity**: high
- **Category**: missing-assertion
- **File**: src-tauri/src/engine/genome.rs:715-758 (tests) covering `crossover`/`crossover_segments`/`mutate`/`breed_generation`
- **Current test state**: exists-but-weak
- **Scenario**: `test_crossover_produces_two_offspring` only asserts both children are non-empty — it never verifies a swap actually happened or that segment indices are re-sequenced 0..n. `crossover_segments` (lines 324-368) does index re-assignment that a regression could break (duplicate/garbled indices) and the test would still pass. `test_breed_generation_count` checks count (6) but not that `parent_ids` are populated/ordered or that offspring IDs are unique. `mutate` only asserts "≥1 segment survives" — the drop/swap/duplicate re-indexing invariant is unchecked.
- **Root cause**: Tests were written to cover the happy path's existence, not the structural invariants the crossover/mutation operators promise.
- **Fix sketch**: Deterministic structural assertions: after `crossover_segments(a,b,point)`, assert `child_a[..point]` come from A, `child_a[point..]` from B, and `segments[i].index == i` for all i (same for mutate's three actions). For `breed_generation`, assert every offspring's `parent_ids` matches its source pair and all `id`s are unique. Seed RNG or test the deterministic `crossover_segments` helper directly to avoid flakiness. Invariant: **segments are contiguous, re-indexed 0..n, and parentage is recorded.**

## 5. `parse_fitness_objective` fallback + validation — pure, untested, LLM-generatable
- **Severity**: high
- **Category**: llm-generatable
- **File**: src-tauri/src/engine/genome.rs:112-169 (`FitnessObjective::validate`, `parse_fitness_objective`)
- **Current test state**: none
- **Scenario**: This is the guard that turns a malformed/edited `fitness_objective` JSON (stored as a free-text column, settable via `evolution_upsert_policy`) into safe defaults + user-visible warnings instead of crashing or skewing a cycle. The negative-weight warning, the sum-drift (`|sum-1.0| > 0.05`) warning, and the parse-failure → defaults+warning path are all pure functions of input and entirely untested. A regression (e.g. tightening the 0.05 tolerance, or returning empty warnings on bad input) would silently change which cycles surface warnings.
- **Root cause**: Pure functions with no dependencies — easiest possible thing to test, simply skipped.
- **Fix sketch**: LLM-generatable batch (pure, no pool). Cases: valid `{speed,quality,cost}` summing to 1.0 → 0 warnings; sum=1.3 → exactly one sum-drift warning; a negative weight → negative-weight warning; non-JSON / wrong-shape string → returns `FitnessObjective::default()` AND a non-empty warning whose head includes the raw value (verify the `raw[..min(200)]` truncation doesn't panic on short input). Invariants to assert (not snapshot): **bad input never panics, always yields usable defaults, and validation warnings fire exactly at the defined thresholds.**

## 6. `should_evolve` cycle-trigger gate is untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/evolution.rs:627-652 (`should_evolve`)
- **Current test state**: none
- **Scenario**: This gate decides whether an (expensive, multi-CLI-spawn) auto-evolution cycle fires: disabled policy → false; else count `completed` executions since `last_cycle_at` vs `min_executions_between`. A regression that counts non-completed runs, ignores the `last_cycle_at` cutoff, or flips the comparison would either spam costly cycles or never evolve — both money/quality impacts, neither caught.
- **Root cause**: Needs a pool + seeded `persona_executions`, but that harness exists; simply never written.
- **Fix sketch**: Repo-pool test: disabled policy → false regardless of counts; enabled policy with N completed execs after `last_cycle_at`, where N == threshold → true, N == threshold-1 → false; rows with `status != 'completed'` or `created_at <= last_cycle_at` excluded from the count. Invariant: **a cycle fires iff enabled AND enough fresh completed runs accumulated.**

## 7. `dream_replay::build_dream_replay` (cycle detection, event ordering, cumulative cost) has no test
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/dream_replay.rs:110-261 (`build_dream_replay`, `compute_depth`)
- **Current test state**: none
- **Scenario**: This is pure, deterministic reconstruction from a `ExecutionTrace` (no pool, no LLM) — ideal to test, yet wholly uncovered. Load-bearing logic: the cycle-breaking depth computation (a self/circular `parent_span_id` must yield depth 0, not a stack overflow — lines 143-163); the event sort that places starts before ends at the same ms (line 124); cumulative cost/token accumulation on span-end only (lines 189-198); and root-total fallback to cumulative when the root span lacks totals (lines 239-246). A regression in any of these silently corrupts the replay UI or, in the cycle case, panics on a malformed trace.
- **Root cause**: Pure function over an in-memory struct; no harness needed; simply absent.
- **Fix sketch**: LLM-generatable batch building small `ExecutionTrace` fixtures. Cases: a 3-span nested trace → assert frame count == boundary count, depths 0/1/2, cumulative cost equals sum of ended spans; a trace with a circular `parent_span_id` → assert it returns (does NOT overflow) with depth 0; two spans ending at the same ms as another starts → assert start-before-end ordering; `evicted_span_count > 0` → assert `is_incomplete == true`. Invariants: **terminates on cyclic parent refs; cost/tokens accrue only on span-end; frames are time-ordered.**

## 8. `complete_cycle` policy-stat increments unverified
- **Severity**: low
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/lab/evolution.rs:294-342 (`complete_cycle`)
- **Current test state**: none (the entire `lab/evolution.rs` repo has no `#[cfg(test)]` module)
- **Scenario**: On cycle completion, the second UPDATE bumps `total_cycles + 1` and conditionally `total_promotions + 1` on the policy resolved via the cycle's `policy_id` subquery. Because `run_evolution_cycle` retries `complete_cycle` on failure (evolution.rs:478-501), a non-idempotent or mis-scoped increment could double-count or update the wrong policy, corrupting the promotion-rate stats shown to users.
- **Root cause**: Repo write with a subquery join; no test pins the increment semantics or the promoted/not-promoted branch.
- **Fix sketch**: Repo-pool test: create policy + cycle, call `complete_cycle(promoted=true)` → assert cycle row `status='completed'`, `promoted=1`, fitness fields set, and policy `total_cycles==1` / `total_promotions==1`; repeat with `promoted=false` on a fresh policy → assert `total_promotions==0`. Invariant: **each completed cycle increments total_cycles exactly once and total_promotions only when promoted.** (Note: a true idempotency test would require dedup logic that does not exist today — flag, don't fake it.)
