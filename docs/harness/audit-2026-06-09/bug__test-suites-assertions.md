# Bug Hunter — test-suites-assertions
> Total: 6
> Severity: 2 critical, 3 high, 1 medium

## 1. Every non-erroring scenario is recorded as "passed" regardless of score (false-green / success theater)
- **Severity**: critical
- **Category**: silent-failure
- **File**: src-tauri/src/engine/test_runner.rs:318-322
- **Scenario**: A persona is run against a saved suite. For one scenario the agent produces total garbage — `score_result` returns `tool_accuracy=0, output_quality=0, protocol_compliance=0` (e.g. confusion phrase matched, or LLM eval scored everything 0). The execution still returned `Ok(ExecutionOutput)` (the CLI ran fine), so `execute_scenario` succeeds and the match arm sets `status = "passed"`.
- **Root cause**: The `status` field is derived purely from whether `execute_scenario` returned `Ok` vs `Err` — i.e. "did the CLI process complete" — never from the numeric scores or from any `passed: Option<bool>` verdict the eval framework computes. There is no pass/fail threshold gate anywhere between scoring and persistence. `eval.rs` produces `passed` verdicts (e.g. `score >= 50`) that are computed and then thrown away; `score_result` never returns a pass/fail decision at all.
- **Impact**: corruption of validation semantics. A suite intended to gate persona promotion reports "passed" rows for scenarios the agent objectively failed. UI and any "promote if green" logic trust this status. Users ship broken personas believing they passed.
- **Fix sketch**: Make the runner compute a real verdict. Derive a per-scenario pass threshold from the composite score (`tool*0.4 + quality*0.4 + protocol*0.2 >= T`) AND honor `eval_confusion_detect`/LLM `verdict`; set `status` to `"passed"`/`"failed"` from that. Better: have `score_result` return an explicit `passed: bool` so "CLI succeeded" and "scenario passed" can never be conflated again.

## 2. Heuristic fallback fabricates high scores when LLM eval times out on under-specified scenarios
- **Severity**: critical
- **Category**: silent-failure
- **File**: src-tauri/src/engine/eval.rs:679-705 (with 180-185, 234-245)
- **Scenario**: A suite scenario has no `expected_tool_sequence` and no `expected_protocols` (very common for generated/imported suites). The LLM evaluator times out twice (`run_llm_eval`, 180s each → ~6 min). `eval_with_llm` falls back to `fallback_heuristic`. There: `eval_tool_accuracy` returns 100 ("no expected tools and no tools called"), `eval_protocol_compliance` returns 100 ("no protocol expectations"), and `eval_keyword_match` returns 50 when `expected_behavior` is empty. Composite ≈ 80.
- **Root cause**: The heuristic strategies return optimistic neutral/perfect scores for *absent* expectations (`100` for "nothing expected"). That is acceptable as a "no signal" sentinel, but it is then treated as a real measured score and combined into a high composite. Combined with finding #1, the scenario is stored "passed" with an 80 composite even though *no evaluation actually ran*.
- **Impact**: corruption — a total evaluation outage (LLM unreachable) presents as strong green scores instead of "could not evaluate". Regression testing silently stops working with no visible degradation beyond a `tracing::warn`.
- **Fix sketch**: When `eval_method != Llm`, do not let "no expectation" sentinels masquerade as passes — emit `passed: None`/lower confidence and surface `eval_method` (timeout/heuristic) as a non-pass status in the runner. Treat a scored result whose confidence is below a floor as "inconclusive", never "passed".

## 3. Byte-offset string slicing panics on multibyte LLM output
- **Severity**: high
- **Category**: panic
- **File**: src-tauri/src/engine/eval.rs:533-537 and src-tauri/src/engine/eval.rs:649-650
- **Scenario**: Agent output longer than 3000 bytes whose 3000th byte lands mid-glyph (emoji, CJK, em-dash, smart quote — routine in LLM output). `build_llm_eval_prompt` does `&input.output[..3000]`, which panics `byte index 3000 is not a char boundary`. Same class at line 649: `&trimmed[..trimmed.len().min(500)]` in the error path of `parse_llm_eval_response` panics when the malformed LLM response is truncated mid-glyph.
- **Root cause**: Raw byte-range slicing on `&str` of LLM-produced text. The codebase already has `truncate_chars` in test_runner.rs precisely for this reason, but `eval.rs` does not use it. The panic occurs inside the `tokio::spawn`ed scenario task; the `JoinError` is caught at test_runner.rs:352-354 and only logged (`tracing::error`), so that scenario silently produces *no result row* — the suite reports fewer results than scenarios with no error surfaced to the user.
- **Impact**: crash of the scoring task → lost scenario result counted as a non-result (partial suite). For finding-3-line-649, a panic while *building the parse-error message* masks the underlying LLM parse failure entirely.
- **Fix sketch**: Replace both byte slices with `truncate_chars(s, n)` (char-based) or `s.char_indices().nth(n)`-bounded slicing. Add a regression test with a 3000-byte string ending in a 4-byte emoji.

## 4. Cancel races with in-flight scenario: partial results persisted, terminal-status update silently dropped
- **Severity**: high
- **Category**: race-condition
- **File**: src-tauri/src/commands/execution/tests.rs:131-150 and src-tauri/src/engine/test_runner.rs:269-283, 388-419
- **Scenario**: User clicks Cancel mid-run. `cancel_test_run` sets the atomic flag and immediately writes `status = Cancelled`. But the runner only checks the flag *between* scenarios (line 271) and *before* spawning each model task (line 295). A scenario already executing its concurrent model tasks (lines 287-345) finishes, then `batch_create_results` (line 388) writes its rows — *after* the run was marked Cancelled. The runner then re-checks the flag, calls `update_run_status(Cancelled)` at line 272, which hits `validate_transition` Cancelled→Cancelled = disallowed (lab.rs:55), returns `Err`, and the error is discarded by `let _ =`.
- **Root cause**: Cancellation is cooperative at coarse granularity, but result-writing is not gated on the cancel flag. The status state machine forbids same-state and post-terminal transitions, so any post-cancel status write is silently swallowed (`let _ =` everywhere in the runner). There is no "abort writes once cancelled" guard.
- **Impact**: corruption — a run displayed as Cancelled contains results for scenarios that ran after cancellation; counts (`current`/`total`) and summary may be inconsistent. Users believe they stopped the run before those scenarios executed.
- **Fix sketch**: Check the cancel flag immediately before `batch_create_results` and skip the write if set. Make terminal-status writes idempotent (treat X→X and post-terminal as no-op success, not Err) so the swallowed errors can be removed and real failures surface.

## 5. delete_run force-unregisters after 500ms while the run task may still be writing
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/commands/execution/tests.rs:113-129
- **Scenario**: User deletes an active run. `delete_run` cancels, polls up to 500ms for the task to unregister, then **force-unregisters and DELETEs the run row** regardless of whether the task actually stopped. A scenario whose model tasks were already executing (each can run up to 300s, test_runner.rs:1184) is still alive; it later calls `batch_create_results` (line 388) with a `test_run_id` whose parent row no longer exists, or `update_run_status` which now returns `NotFound`.
- **Root cause**: The 500ms wait is far shorter than a scenario's execution window (up to 5 minutes), and deletion proceeds unconditionally. There is no join on the background task and no FK/“is parent alive” check before writing results.
- **Impact**: corruption — orphaned `persona_test_results` rows if FK enforcement is off, or a hard insert error (swallowed) if on. The "force-unregister" comment claims "the task will no-op on next DB write," but the task does not check registration before writing; it only checks the cancel atomic between scenarios, so an in-progress scenario writes anyway.
- **Fix sketch**: Either (a) `await` the spawned task's `JoinHandle` (store it in the registry) before deleting, or (b) have the runner re-check `is_run_registered`/cancel flag immediately before every DB write and abort. Rely on `ON DELETE CASCADE` + a registration guard so a deleted run can never accumulate new rows.

## 6. Historical assertion summary always reports zero critical failures (false-green on read-back)
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/db/repos/execution/assertions.rs:218-246
- **Scenario**: An execution had a critical-severity assertion fail during live evaluation (`evaluate_assertions` correctly set `critical_failures=1` and downgraded the execution). Later the UI calls `get_assertion_results_for_execution`, which routes to `get_summary_by_execution`. That function recomputes `total/passed/failed` from stored rows but hardcodes `critical_failures: 0` and `first_critical_failure: None`.
- **Root cause**: Criticality is derived from the owning assertion's `severity`, which is *not* stored on the `assertion_results` row and *not* re-joined on read-back. The code comment acknowledges this and leaves it zeroed — but the same struct field that drives the live "downgrade to Incomplete" decision is now silently false on every historical view.
- **Impact**: UX degradation / false-green — any consumer that reads `critical_failures`/`first_critical_failure` from the persisted summary (notification center, audit views) sees "no critical failures" for an execution that actually had a critical assertion blocker.
- **Fix sketch**: Join `assertion_results` to `output_assertions` on `assertion_id` to recover `severity`, and recompute `critical_failures`/`first_critical_failure` from the joined rows — or denormalize `severity` onto `assertion_results` at insert time so read-back matches the live summary.
