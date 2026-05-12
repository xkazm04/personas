# Code-refactor scan — Tests, Assertions & Quality Gates

> Total: 11 findings (3 high, 5 medium, 3 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12

## 1. Orphan frontend assertion API — no UI to manage output assertions

- **Severity**: high
- **Category**: dead-code
- **File**: `src/api/agents/outputAssertions.ts:1`
- **Scenario**: The entire `src/api/agents/outputAssertions.ts` file exports six Tauri wrappers (`listOutputAssertions`, `getOutputAssertion`, `createOutputAssertion`, `updateOutputAssertion`, `deleteOutputAssertion`, `getAssertionResultsForExecution`, `getAssertionResultHistory`) but **no consumer in src/** imports any of them. A grep across the whole frontend returns zero callers (only the file itself and the `lib/bindings` types it imports). The Rust commands ARE registered in `src-tauri/src/lib.rs:1299-1305` and assertions are auto-created server-side in `commands/design/build_sessions.rs:2431`, so the backend works — but there is no slice in `src/stores/slices/` and no component anywhere referencing these APIs. Verified absence of `assertionSlice.ts` via `Glob C:/Users/mkdol/dolla/personas/src/stores/slices/**/assertion*` returning no files.
- **Root cause**: The assertion DSL backend (`engine/output_assertions.rs`, 730 LOC; `db/models/output_assertion.rs`; `db/repos/execution/assertions.rs`, 287 LOC) was built end-to-end with TS bindings and an IPC wrapper, but the management UI was never shipped. Frontend can only *observe* assertion outcomes through whatever populates `ExecutionAssertionSummary` (also unreferenced from src/).
- **Impact**: 57 LOC of dead TS API + ~6 unused Tauri commands surfaced through `invokeWithTimeout`. Users cannot create/edit assertions from the UI — the feature exists but is invisible. Misleads new contributors who assume the wrapper is wired up.
- **Fix sketch**: Either (a) delete `src/api/agents/outputAssertions.ts` and the six unused command registrations in `src-tauri/src/lib.rs:1299-1305` (keep `evaluate_assertions` which IS called from `engine/mod.rs:1595`), or (b) build the missing assertion management UI. Recommend (a) until the feature is genuinely scoped.

## 2. `run_consensus_test` + helpers — entire dormant lab mode

- **Severity**: high
- **Category**: dead-code
- **File**: `src-tauri/src/engine/test_runner.rs:1932`
- **Scenario**: `run_consensus_test` (lines 1932-2022, ~90 LOC) along with `compute_agreement_rate` (lines 2027-2066) and `build_consensus_summary` (lines 2070-2094) are all annotated `#[allow(dead_code)] // pending: consensus mode unwired in commands::execution`. A grep of the whole src-tauri tree confirms `run_consensus_test` is referenced only by its own definition and the dead helpers — no command, no test invokes it. The lab.rs commands surface only "eval | ab | arena | matrix | consensus" as a *string* in result_kind doc comments (lines 1139, 1156), but the consensus runner itself is never spawned.
- **Root cause**: A "consensus" mode was scaffolded (db repo `consensus.rs`, model `LabConsensusResult`, status emitter `lab-consensus-status`) but the IPC handler that would call `run_consensus_test` was never wired up in `commands/execution/lab.rs`. The comment in the dead code says "pending" but it has been pending across many waves.
- **Impact**: ~160 LOC of dormant code inside `test_runner.rs` (already 2624 lines) that nobody can reach. Every refactor of `LabCallbacks` / `LabVariant` / `run_lab_loop` must keep this dead path compiling. Hides the actual surface area of the file.
- **Fix sketch**: Delete `run_consensus_test`, `compute_agreement_rate`, `build_consensus_summary` from `test_runner.rs` along with the `consensus_repo` import. If the feature is revived, recover from git. Alternatively, wire it into `commands/execution/lab.rs::start_lab_run` as a real mode — but that should not happen as part of a refactor pass.

## 3. `scoreLabel` + `scoreBg` + `ScoreBar` triplicated across 3 lab result views (and one more in shared)

- **Severity**: high
- **Category**: duplication
- **File**: `src/features/agents/sub_lab/components/arena/ArenaResultsView.tsx:24`
- **Scenario**: The identical 5-bucket `scoreLabel` function (`>=80 Excellent / >=60 Good / >=40 Fair / >=20 Weak / Poor`) is defined in:
  - `src/features/agents/sub_lab/components/arena/ArenaResultsView.tsx:24`
  - `src/features/agents/sub_lab/components/ab/AbResultsView.tsx:47`
  - `src/features/agents/sub_lab/components/eval/EvalVersionCards.tsx:12`
  - `src/features/agents/sub_lab/components/shared/ScenarioDetailPanel.tsx:59` (variant accepts `number | null`)
  - `src/features/agents/sub_lab/libs/reportGenerator.ts:32`
  The exact same `scoreBg` (gradient classes for 4 score buckets) is duplicated in the first 3 files at lines :32 / :55 / :20. The `ScoreBar` React component (identical body, ~18 LOC) is in lines :39 / :62 / :27 of the same trio. Verified 4+ duplicate sites for `scoreLabel`, 3+ for `scoreBg` and `ScoreBar`.
- **Root cause**: When each lab mode (arena, ab, eval) got its own result view, the author copy-pasted the score-bucket helpers. The shared `evalFramework.ts` already exports `scoreColor` (lib/eval/evalFramework.ts:168) — the pattern was set, but never extended.
- **Impact**: ~90 LOC duplicated. Each visual tweak to score-bucket UI requires editing 3-4 files; the regression console variant has a 4th flavor. Bucket thresholds have already started drifting (`ScenarioDetailPanel.tsx` adds null-handling that the others lack).
- **Fix sketch**: Add `scoreLabel`, `scoreBg`, and `<ScoreBar />` (export as JSX component) to `src/lib/eval/evalFramework.ts`. Replace all 3-4 inline copies with imports. Make `scoreLabel(score: number | null)` to subsume the `ScenarioDetailPanel` variant.

## 4. Three duplicate "JSON-from-text" extraction blocks across test-runner / eval / output-assertions

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/engine/test_runner.rs:691`
- **Scenario**: Three near-identical code paths extract JSON from LLM output by trying direct parse, then falling back to a `find('{')..rfind('}')` slice:
  - `test_runner.rs:691-715` `parse_scenarios_from_output` (parses `Vec<TestScenario>` from `[...]`)
  - `test_runner.rs:2472-2508` `parse_draft_from_output` (parses object then extracts `structured_prompt` and `change_summary`)
  - `engine/eval.rs:629-651` `parse_llm_eval_response` (parses `LlmEvalResult`)
  Additionally inside `output_assertions.rs:246-273` and `:333-359`, the same "try parsing as JSON, else slice between first `{` and last `}`" appears twice (in `eval_json_path` and `eval_json_schema`) — so 5 sites total of the same extraction shape.
- **Root cause**: Every callsite that consumes LLM stdout independently reinvents brace-bracket recovery; no `engine::json_recover` utility exists.
- **Impact**: 5 duplicated sites; bugs (e.g. the bracket pair mismatch on `[...]` vs `{...}`, or matching the wrong outer brace inside a string) must be fixed in 5 places. ~40 LOC of repetition.
- **Fix sketch**: Add `engine/json_recover.rs` exposing two generics: `recover_json_array<T: DeserializeOwned>(raw: &str) -> Result<Vec<T>, String>` and `recover_json_object<T: DeserializeOwned>(raw: &str) -> Result<T, String>` that try direct parse then bracket-slice fallback with a consistent error message. Replace all 5 sites.

## 5. `create_result` (singular) in test_runs repo — test-only, duplicates batch path

- **Severity**: medium
- **Category**: dead-code
- **File**: `src-tauri/src/db/repos/execution/test_runs.rs:157`
- **Scenario**: `create_result` (lines 157-209, ~53 LOC) is invoked only from the `#[cfg(test)] test_result_crud` test (line 390 inside the same file). Production code (`engine/test_runner.rs:380`) uses `batch_create_results` (lines 213-270, ~58 LOC) which contains essentially the same INSERT + `write_tool_calls_child_rows` logic, just wrapped in a transaction loop. Verified by grepping every callsite of `repo::create_result` and `test_runs::create_result` — only the in-file test references it.
- **Root cause**: The batch path was added later for performance; the singular path was left intact "for tests" rather than refactoring the test to use the batch API with a one-element vec.
- **Impact**: 53 LOC of duplicated INSERT SQL maintained for one test. Any column change (the schema has already had `tool_calls_*` JSON columns moved to a child table per the ADR comment at line 167) must be applied in two places.
- **Fix sketch**: Delete `create_result`. Rewrite `test_result_crud` (test_runs.rs:386) to call `batch_create_results(&pool, &[CreateTestResultInput { … }])` and unwrap the first element. Saves ~50 LOC and removes a divergence risk.

## 6. `get_result_by_id` (test_runs) — dead, no callers

- **Severity**: medium
- **Category**: dead-code
- **File**: `src-tauri/src/db/repos/execution/test_runs.rs:272`
- **Scenario**: `get_result_by_id` (lines 272-285, 14 LOC of body + signature) has zero non-self references in the codebase. Grep `test_runs::get_result_by_id|get_result_by_id\(` finds only its own definition (and unrelated mentions in `db/macros.rs` which document a *generic* `get_result_by_id` macro, not a call). The function is also missing from `lib.rs` command registrations, so no IPC consumer exists.
- **Root cause**: Added speculatively alongside `get_results_by_run`; never demanded by a UI or command.
- **Impact**: 14 LOC of cruft, plus the `timed_query!` instrumentation it pulls in.
- **Fix sketch**: Delete the function. If a future "view single test result" UI needs it, it's 10 lines to recreate.

## 7. `TestSuiteScenario` / `TestSuiteMockTool` Rust types — defined but never used

- **Severity**: medium
- **Category**: dead-code
- **File**: `src-tauri/src/db/models/test_suite.rs:29`
- **Scenario**: `TestSuiteScenario` (lines 29-37) and `TestSuiteMockTool` (lines 42-46) are defined with `#[ts(export)]` (so they generate `src-tauri/bindings/TestSuiteScenario.ts` and `TestSuiteMockTool.ts`), but a grep across `src/` and `src-tauri/src/` finds zero non-definition references. The actual scenario type used everywhere is `TestScenario` / `MockToolResponse` from `engine/test_runner.rs:113-130`. The bindings are also generated into `src/lib/bindings/TestSuiteScenario.ts` but never imported.
- **Root cause**: Looks like a stillborn attempt to give `PersonaTestSuite.scenarios` (currently a JSON string column) a typed representation. The string-blob approach won, but the typed duplicates remained.
- **Impact**: Two unused Rust structs + four generated TS binding files (`src-tauri/bindings/` and `src/lib/bindings/` each have both). When `TestScenario` evolves, the dead duplicates silently drift.
- **Fix sketch**: Delete both structs from `test_suite.rs`. Delete the four binding files. Confirm `cargo build` and `tsc` pass.

## 8. Frontend `getTestSuite` — single API export with no callers

- **Severity**: low
- **Category**: dead-code
- **File**: `src/api/agents/testSuites.ts:8`
- **Scenario**: `getTestSuite` (line 8) is the only TS export with no consumer in `src/`. Grep `getTestSuite\b` matches only its own definition. Sibling exports (`listTestSuites`, `createTestSuite`, `updateTestSuite`, `deleteTestSuite`) are all consumed by `src/stores/slices/agents/testSlice.ts`.
- **Root cause**: Speculative add — the store always fetches the *list* and never a single suite by id.
- **Impact**: 3 LOC of cruft. The corresponding Rust command `commands/execution/test_suites::get_test_suite` (registered in `lib.rs:1294`) is similarly unused from the frontend.
- **Fix sketch**: Delete `getTestSuite` from the TS file. Consider deregistering the Rust command from `lib.rs:1294` and dropping the handler if no other code (e.g. data portability) calls it.

## 9. `compute_value_score` + arena ranking logic duplicated between `build_summary` and `build_arena_summary`

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/engine/test_runner.rs:1012`
- **Scenario**: The functions `build_summary` (lines 1012-1092, ~80 LOC) and `build_arena_summary` (lines 1755-1815, ~60 LOC) contain nearly identical bodies: both iterate per-model averages, call `compute_value_score`, build a `rankings` Vec of identical-shaped `serde_json!` objects, then sort by `composite_score` and pick `best_quality_model` + `best_value_model`. The only meaningful difference is that `build_summary` accepts a `Mutex<Vec<...>>` while `build_arena_summary` accepts a `HashMap`. Quality-gate caution acknowledged — verified by reading both functions side-by-side; they're not different scoring strategies, just one variant has slightly different input plumbing.
- **Root cause**: `build_summary` predates `run_lab_loop`. When arena mode was extracted to the generic loop, the original `run_test` summary builder was left alone and a near-copy was made under the new architecture.
- **Impact**: ~80 LOC of duplicate aggregation. The two paths can drift on rounding rules, key names, or sort order — and frontend code reading either should not need to branch.
- **Fix sketch**: Extract `build_ranked_summary(per_model_iter: impl Iterator<Item = (&str, &str, &[ResultTuple])>) -> serde_json::Value` and call it from both `build_summary` (after flattening the Mutex+Vec to per-model groups) and `build_arena_summary`. Removes ~60 LOC.

## 10. Per-mode `update_status` + `update_llm_summary` callback boxes — 5x near-identical `LabCallbacks` constructions

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/engine/test_runner.rs:1872`
- **Scenario**: Each lab-mode entry function (`run_arena_test:1872`, `run_consensus_test:1958` [dead, see #2], `run_ab_test:2127`, `run_eval_test:2207`, `run_matrix_test:2341`) builds a `LabCallbacks` struct with virtually the same boilerplate:
  ```rust
  update_status: Box::new(|pool, id, status, sc, sum, err, ca| {
      let _ = <mode>_repo::update_run_status(pool, id, status, sc, sum, err, ca);
  }),
  update_llm_summary: Box::new(|pool, id, text| {
      let _ = <mode>_repo::update_llm_summary(pool, id, text);
  }),
  ```
  The only difference is which `_repo` module is referenced. That is 4 active sites × ~6 LOC of identical box closures = ~24 LOC of cruft, plus the `persist_result` boxes which differ slightly more (eval/ab add version lookup) but share the `make_common_result_fields` + `create_result` + optional `events_repo::insert_events_batch` pattern.
- **Root cause**: `LabCallbacks` takes `Box<dyn Fn>` instead of an enum or trait object dispatched on mode, forcing every callsite to re-supply trivial pool-passing closures.
- **Impact**: Adding a new repo method (e.g. soft-delete) requires editing 4-5 callbacks. Each closure heap-allocates needlessly.
- **Fix sketch**: Replace `LabCallbacks` with a `LabMode` enum (or trait) that dispatches `update_status`/`update_llm_summary`/`persist_result` internally by matching on the mode. Each lab entry-point then constructs one enum variant instead of three boxed closures. Halves the LabCallbacks blocks.

## 11. `case_sensitive` toggle re-implemented in `eval_contains` and `eval_not_contains` in `output_assertions.rs`

- **Severity**: low
- **Category**: duplication
- **File**: `src-tauri/src/engine/output_assertions.rs:143`
- **Scenario**: Both `eval_contains` (lines 137-191) and `eval_not_contains` (lines 193-237) start with the same 5-line block lowercasing `output` when `!case_sensitive`, then loop over the phrase list, repeating the same lowercase-on-search logic (lines 143-148, 152-157 vs 199-204, 206-214). The shape `let search = if config.case_sensitive { phrase.clone() } else { phrase.to_lowercase() }` is identical, just with `phrases` vs `patterns` as the field name.
- **Root cause**: The two assertion types were written independently with copy-paste; never extracted because they look "trivially different".
- **Impact**: ~15 LOC of duplication; the moment we add `case_sensitive` to JSON-path-style assertions, we'll grow a third copy.
- **Fix sketch**: Add a helper `fn match_phrases(output: &str, phrases: &[String], case_sensitive: bool) -> (Vec<&str>, Vec<&str>) /* (found, missing) */` inside the same file. Both `eval_contains` and `eval_not_contains` consume the result and frame the explanation/passed verdict accordingly. Saves ~12 LOC and pre-empts the third copy.
