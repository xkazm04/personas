# Test Mastery — Agent Lab & Versions
> Total: 7 findings (2 critical, 3 high, 1 medium, 1 low)

## 1. Version rollback / activation data-write path is untested (silent prompt loss)
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/execution/lab.rs:828-919 (`lab_rollback_version`), src-tauri/src/commands/execution/lab.rs:541-624 (`lab_accept_matrix_draft`)
- **Current test state**: none
- **Scenario**: `lab_rollback_version` overwrites the live persona's `structured_prompt`/`system_prompt` from a snapshot, then atomically demotes the current `production` version and promotes the target, all inside one transaction. `lab_accept_matrix_draft` writes an LLM-generated draft onto the persona AND auto-creates a new version row, gated by a conditional `UPDATE ... WHERE draft_accepted = 0` for idempotency. Both contain hand-written SQL with COALESCE fallbacks, a "two production rows" hazard, an incompleteness guard (reject snapshot with neither prompt), and a TOCTOU race. NONE of it is exercised — a regression that drops the demote step (two `production` versions), inverts the COALESCE (wipes `design_context`/`icon`), or breaks the `claimed == 0` idempotency check (duplicate version rows on a double-click) ships green.
- **Root cause**: These are `#[tauri::command]` async fns taking `State<AppState>`; there's no in-memory DB harness wired for command-level tests, so the data-mutation logic was never extracted to a pure/testable seam.
- **Impact**: A persona's prompt is its product. Silent rollback corruption (hybrid old-fields + new-prompt state), a duplicated/zeroed version, or two simultaneous `production` tags directly degrade every downstream run with no error surfaced to the user.
- **Fix sketch**: Add Rust integration tests against an in-memory rusqlite pool seeded with a persona + 2 prompt versions (one tagged `production`). Assert: (a) rollback to v1 makes v1 `production` and demotes the old one to `experimental` (exactly one production row); (b) rollback to a snapshot with `structured_prompt = None` AND blank `system_prompt` returns `Validation` and writes nothing; (c) double `lab_accept_matrix_draft` on the same run creates exactly ONE new version (idempotency). If a full command harness is too heavy, extract the transaction body into a `fn rollback_in_tx(tx, version) -> Result<()>` and test that.

## 2. Lab run status state machine (`validate_transition`) has zero tests — gates every run write
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/db/models/lab.rs:50-67 (`validate_transition`), enforced at src-tauri/src/db/macros.rs:448-451 and src-tauri/src/engine/process_session.rs:312
- **Current test state**: none
- **Scenario**: `LabRunStatus::validate_transition` is the single gatekeeper for EVERY status write to the arena/ab/eval/matrix run tables (the macro-generated `update_run_status` reads current status and rejects illegal transitions). It encodes business-critical invariants: terminal states (`Completed`/`Failed`/`Cancelled`) are immutable, and `Running -> Completed` is allowed only directly. A regression that (a) accidentally permits `Completed -> Running` lets a finished run reopen and overwrite trustworthy results; (b) over-tightens and rejects a legal `Generating -> Running` makes every status update return `Validation` and silently strand runs as perpetually "generating". `from_db` mapping unknown strings to `Failed` (lab.rs:31) is also untested.
- **Root cause**: Pure enum method with obvious unit-testability, but no `#[cfg(test)]` module exists in `db/models/lab.rs`.
- **Impact**: This FSM directly protects the "cancelled run can't be silently re-completed" guard (test_runner.rs:1792) and result integrity. A reweighted/loosened transition table corrupts run-state reporting fleet-wide.
- **Fix sketch**: LLM-generatable. Add `#[cfg(test)]` to lab.rs asserting the full transition matrix: every terminal state rejects ALL transitions; `Drafting->Generating->Running->Completed` is the only happy path; each non-terminal state allows `->Failed` and `->Cancelled`; illegal jumps (`Running->Generating`, `Completed->Running`) are `Err`. Invariant: **terminal states are absorbing; no skipping forward except into Failed/Cancelled.** Plus a `from_db` round-trip + unknown-string-is-Failed case.

## 3. `composite_from_parts` (Rust version-rating rollup) untested — silently diverges from the TS twin
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/lab/ratings.rs:90-112 (`composite_from_parts`), consumed by `get_version_ratings` lab.rs:1211
- **Current test state**: none (the TS twin `compositeScoreFromRow` is exhaustively tested in src/lib/eval/__tests__/evalFramework.test.ts; the Rust side that powers the "Versions & Ratings" table is not)
- **Scenario**: This is the Rust re-implementation of the null-aware renormalising composite that decides which (version, model) cell wins in the consolidated ratings table. It must (a) re-weight when a sub-score is missing rather than treating it as 0, (b) return `None` only when ALL three are absent. A regression here (e.g. treating `None` as 0, or not renormalising) makes a version scored only on `tool_accuracy=100` show `40` instead of `100` — exactly the bug the TS test (`does NOT bias toward zero`) guards against on the frontend, with no equivalent guard on the Rust source that the table actually reads.
- **Root cause**: Pure function, fully unit-testable, but no `#[cfg(test)]` in ratings.rs; the parallel TS contract was tested while the Rust one was not.
- **Impact**: The version leaderboard (which the user uses to pick & activate a production version) ranks versions by this composite. Wrong composites → wrong "best version" → user promotes an inferior prompt to production.
- **Fix sketch**: LLM-generatable. Add `#[cfg(test)]` mirroring the TS cases: all-None → `None`; single present metric → that metric value; `(100, None, None)` → `100.0` (NOT 40); all three present matches `ta*0.4 + oq*0.4 + pc*0.2`. Invariant: **missing sub-scores are renormalised away, never counted as zero — Rust and TS composites must agree.**

## 4. `verdict_status` (pass/fail/inconclusive gate) has no test despite anti-success-theater intent
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/test_runner.rs:777-792 (`verdict_status`), threshold const at :770
- **Current test state**: none
- **Scenario**: `verdict_status` is the explicit guard that stops a degraded evaluation from masquerading as a pass: when `eval_method` is `timeout`/`heuristic_fallback` it MUST return `"inconclusive"` (never `"passed"`), and otherwise it applies the `composite >= 50` threshold over the 0.4/0.4/0.2 weights. This is precisely the "an eval outage can't show green" business rule (per the doc comment), yet a regression — e.g. someone drops the `eval_method` check, or flips the threshold comparison — would let a total LLM-eval outage report every scenario as `passed`, the exact success-theater failure the function was written to prevent.
- **Root cause**: Private fn in a 2789-line module whose `#[cfg(test)]` only covers `truncate_chars`; the verdict logic was added without a paired test.
- **Impact**: Users trust the lab's pass/fail to gate which prompt/model to ship. A silent regression here turns the safety rail into a rubber stamp — failing personas ship as "passed".
- **Fix sketch**: LLM-generatable. Construct `ScoreResult` fixtures and assert: `eval_method = Some("timeout")` or `Some("heuristic_fallback")` → `"inconclusive"` regardless of scores; `eval_method = Some("llm")` with composite 49.9 → `"failed"`, with composite 50.0 → `"passed"`; `None` scores → `"failed"`. Invariant: **a non-LLM eval can never yield "passed".**

## 5. `compute_value_score` and `compute_agreement_rate` (ranking math) untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/test_runner.rs:1080-1088 (`compute_value_score`), test_runner.rs:2165-2204 (`compute_agreement_rate`)
- **Current test state**: none
- **Scenario**: `compute_value_score` decides the arena's `best_value_model` via an exponential cost-efficiency decay (`exp(-cost*10)`), with a free-model branch returning the raw composite. `compute_agreement_rate` buckets consensus samples (high/medium/low) and returns the dominant-bucket fraction. Both feed user-facing "winner" selections. Regressions slip through silently: a sign flip in the decay would rank the MOST expensive model as best value; an off-by-one in the bucket boundaries (`80..`, `50..=79`) would mis-score consistency; the `n <= 1.0` single-sample short-circuit returning `1.0` (perfect agreement) is an easy thing to break.
- **Root cause**: Pure functions, but `compute_agreement_rate`/`build_consensus_summary` are `#[allow(dead_code)]` ("consensus mode unwired") so they escaped scrutiny; `compute_value_score` is live but untested.
- **Impact**: Wrong `best_value_model` directly misleads the user's cost/quality tradeoff decision (the lab's core value prop). For consensus, an inflated agreement rate hides a flaky non-deterministic persona.
- **Fix sketch**: LLM-generatable. For `compute_value_score`: free model (cost 0) → composite unchanged; higher cost → strictly lower value (monotonic); result clamped to [0,100]; known points (cost $0.01 ≈ composite*0.90). For `compute_agreement_rate`: unanimous samples → 1.0; perfectly split (3 high / 3 low) → 0.5; single sample → 1.0; empty → 0.0; boundary scores 79 vs 80 land in different buckets. Invariants: **value is monotonically non-increasing in cost; agreement is the mean dominant-bucket share in [0,1].**

## 6. `parse_scenarios_from_output` / `parse_draft_from_output` / `parse_model_configs` JSON parsing untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src-tauri/src/engine/test_runner.rs:740-764 (`parse_scenarios_from_output`), test_runner.rs:2610-2646 (`parse_draft_from_output`), test_runner.rs:90-110 (`parse_model_configs`)
- **Current test state**: none
- **Scenario**: These parse untrusted LLM/CLI stdout into typed structs. They implement a "direct parse, then extract between first `{`/`[` and last `}`/`]`" fallback — a forgiving parser whose edge cases (prose wrapping the JSON, markdown fences, an empty array, the array-vs-object distinction, a draft missing `structured_prompt`) decide whether scenario generation silently yields zero scenarios or errors cleanly. `parse_model_configs` is the trust-boundary validator that rejects an empty/invalid model list. The empty-result cache-poisoning hazard (generate_scenarios.rs:574 — "never cache empty") depends on the parser returning `Ok(vec![])` vs `Err`, which is exactly the kind of contract that drifts unnoticed.
- **Root cause**: Pure `&str -> Result<T>` functions ideal for table tests, but no `#[cfg(test)]` covers them (only `truncate_chars` is tested).
- **Impact**: A parser regression makes scenario generation appear to succeed with no scenarios (run completes green, tests nothing) or rejects valid wrapped JSON (every run fails). Both are silent quality losses on the lab's first step.
- **Fix sketch**: LLM-generatable table tests. `parse_scenarios_from_output`: clean array, array wrapped in prose, markdown-fenced, empty `[]` → `Ok(empty)`, garbage → `Err`. `parse_draft_from_output`: object with `structured_prompt` + missing `change_summary` (defaults), object lacking `structured_prompt` → `Err`. `parse_model_configs`: empty list → `Validation`, one bad entry → `Validation`, valid passes through. Invariant: **assert the parsed field values, not just `is_ok()` — pin that `expected_tool_sequence`/`structured_prompt` survive extraction.**

## 7. DiffViewer renders no test for its identical-sections / empty-prompt branches
- **Severity**: low
- **Category**: coverage-gap
- **File**: src/features/agents/sub_lab/shared/DiffViewer.tsx:12-59 (the `diffStrings`/`getSectionSummary` engine in labPrimitives.ts is the real risk)
- **Current test state**: none for DiffViewer; the underlying `diffStrings` LCS engine in labPrimitives.ts is also untested
- **Scenario**: DiffViewer is presentational, so the component itself is low-risk — but it delegates to `diffStrings` (labPrimitives.ts:113), a real LCS word-diff with a `MAX_DP_CELLS` guard and a line-level fallback for large prompts. A bug in the prefix/suffix strip or the fallback boundary would mis-render version diffs (showing a changed section as identical, hiding a prompt change from the user comparing versions). The component's own "all sections identical → show no_structural_diff" branch is a cheap render assertion.
- **Root cause**: `diffStrings` is a non-trivial pure algorithm with a documented large-input fallback path that has never been exercised by a test.
- **Impact**: Mostly cosmetic, but a wrong diff can mislead a user into thinking two prompt versions are the same when they differ (or vice versa) before they pick one to activate.
- **Fix sketch**: LLM-generatable unit tests on `diffStrings` (not the component): identical strings → all `same`; pure insertion → `added` only; pure deletion → `removed` only; a small word change → correct add/remove around a stable middle; reconstructing `added`+`same` tokens yields string B and `removed`+`same` yields string A (round-trip invariant). Optionally one RTL render asserting `no_structural_diff` shows when both versions have equal sections.
