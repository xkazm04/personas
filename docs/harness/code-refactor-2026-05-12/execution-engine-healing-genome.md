# Code-refactor scan — Execution Engine, Healing & Genome

> Total: 13 findings (3 high, 7 medium, 3 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12

## 1. Three near-identical `update_status*` functions in executions repo
- **Severity**: high
- **Category**: duplication
- **File**: `src-tauri/src/db/repos/execution/executions.rs:510`, `:584`, `:661`
- **Scenario**: `update_status`, `update_status_if_running`, and `update_status_if_not_final` are three ~70-LOC functions whose bodies are byte-identical except for the WHERE clause suffix (`WHERE id = ?12`, `WHERE id = ?12 AND status = 'running'`, `WHERE id = ?12 AND status IN ('running', 'cancelled')`). Each repeats the same 16-column COALESCE UPDATE, the same param tuple, the same `started_at`/`completed_at` computation, and the same `timed_query!` wrapper.
- **Root cause**: New CAS variants were added by copy-paste rather than extracting a shared helper that accepts a status guard expression.
- **Impact**: ~200 LOC of mechanical duplication. Adding a new column to `persona_executions` requires updating three SQL strings and three param tuples in lockstep; missing one creates a silent data-loss bug.
- **Fix sketch**: Extract a private `update_status_with_guard(pool, id, input, guard_sql: &str) -> Result<u64, AppError>` that runs the UPDATE and returns rows-changed. The three public wrappers shrink to ~10 LOC each by supplying `""`, `" AND status = 'running'"`, or `" AND status IN ('running', 'cancelled')"`.

## 2. Eight unused exported functions/constants in `pipeline.ts`
- **Severity**: high
- **Category**: dead-code
- **File**: `src/lib/execution/pipeline.ts:602`, `:633`, `:647`, `:655`, `:669`, `:661`, `:215`
- **Scenario**: `removeMiddleware` (line 602), `nextStage` (633), `hasPassedStage` (647), `traceDuration` (655), and `engineSpans` (669) are exported but have zero call sites across `src/`. `pipelineSpans` (661) is only referenced internally by `traceProgress`. Additionally, in `executionState.ts:27,42,54,73,83,94,105`, eight exports (`EXECUTION_STATES`, `TERMINAL_STATES`, `ACTIVE_STATES`, `isExecutionState`, `isActiveState`, `parseExecutionState`, `VALID_TRANSITIONS`, `canTransition`) have zero external consumers — only `TERMINAL_STATUS_SET` and `isTerminalState` are imported.
- **Root cause**: Speculative API surface added during the pipeline-trace consolidation. The unified-span model exposed both backend and frontend helpers, but only `mergeBackendSpans`, `traceProgress`, `isPipelineStage`, `isSystemOperation`, and the data types are actually consumed.
- **Impact**: ~150 LOC of dead exports, plus they enlarge the import autocompletion surface and obscure which helpers are load-bearing. Hot reload bundles include them in every page build.
- **Fix sketch**: Delete the five pipeline utilities, drop `pipelineSpans` from `export` (keep internal), and delete the eight executionState exports. Reduces module to ~30 LOC. If `removeMiddleware` is reserved for an HMR cleanup path, document the intent or remove.

## 3. Massive `PersonaExecution` vs `GlobalExecutionRow` struct + row-mapper duplication
- **Severity**: high
- **Category**: duplication
- **File**: `src-tauri/src/db/models/execution.rs:11-57`, `:107-149`; mapper at `src-tauri/src/db/repos/execution/executions.rs:11-46` and inline at `:190-227`
- **Scenario**: `PersonaExecution` (47 LOC) and `GlobalExecutionRow` (43 LOC) are identical structs except `GlobalExecutionRow` adds three persona-metadata fields (`persona_name`, `persona_icon`, `persona_color`). The row-mapper for `GlobalExecutionRow` (`executions.rs:190-227`, 38 LOC) is a near-copy of `row_to_execution` (`:11-46`) plus three extra `.get()` calls. Adding a column to `persona_executions` requires editing two structs, the TS-rs bindings, and two row mappers.
- **Root cause**: When the JOIN-with-persona variant was added to dodge N+1 queries (`get_all_global`), the team forked the row type instead of composing it (e.g. `struct GlobalExecutionRow { exec: PersonaExecution, persona_name, persona_icon, persona_color }` or a tuple return).
- **Impact**: ~100 LOC of duplicated struct + mapper. Two of the existing fields (`tool_steps`, `execution_flows`) carry `Json<...>` and have repeatedly been a source of TS-binding drift bugs.
- **Fix sketch**: Either (a) embed `PersonaExecution` inside `GlobalExecutionRow` and add a separate `persona_meta: PersonaMeta` field, or (b) keep separate types but extract `fn read_execution_columns(row: &Row) -> rusqlite::Result<PersonaExecution>` and call it from both mappers. Reduces both mappers to ~10 LOC.

## 4. Four lab_cancel_* commands with identical bodies
- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/commands/execution/lab.rs:156`, `:358`, `:477`, `:718`
- **Scenario**: `lab_cancel_arena`, `lab_cancel_ab`, `lab_cancel_matrix`, `lab_cancel_eval` are four 14-LOC functions whose bodies differ only in which `*_repo` is called. Each: `require_auth_sync`, `cancel_run("test", &id)`, build `now`, call `repo::update_run_status(... LabRunStatus::Cancelled, None, None, None, Some(&now))`.
- **Root cause**: Lab modules (arena/ab/matrix/eval) were modeled as parallel hierarchies of repos; cancel was forked per repo instead of dispatched on a `LabRunKind` enum.
- **Impact**: ~60 LOC. Future cancel-side logic (e.g. emitting an event, also writing to audit log) requires 4 edits.
- **Fix sketch**: Add `enum LabRunKind { Arena, Ab, Matrix, Eval }` and `fn lab_cancel_run(state, kind, id)` that dispatches to the right repo. Public commands become 3-line wrappers.

## 5. Four near-identical `build_results_summary_*` JSON builders
- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/commands/execution/lab.rs:986`, `:1005`, `:1026`, `:1046`
- **Scenario**: Each function maps over a different `LabXResult` type and produces a JSON array with the same 8 shared keys plus 0-2 type-specific keys (`version_id`/`variant`). 90% of each ~20-LOC body is identical.
- **Root cause**: No shared "base" trait/struct extracted for the JSON shape — each result type has `.base: LabResultBase`, but the JSON conversion was copy-pasted.
- **Impact**: ~70 LOC duplication. A change to the JSON contract (e.g. renaming `tool_accuracy`) requires 4 edits.
- **Fix sketch**: Extract `fn base_summary_entry(b: &LabResultBase) -> serde_json::Map<String, Value>` returning the 8 common keys; each `build_results_summary_*` then maps and merges the type-specific keys. Cuts ~40 LOC.

## 6. `ExecutionSink.reset()` and `clear()` are near-identical
- **Severity**: medium
- **Category**: duplication
- **File**: `src/lib/execution/executionSink.ts:143-156` and `:159-172`
- **Scenario**: `reset()` and `clear()` have byte-identical bodies — same 10 field assignments, same two `.clear()` calls. The only conceptual difference (per file comments) is that `clear()` is supposed to "notify the store" but the actual code doesn't differ in that respect; the flush side-effect happens elsewhere.
- **Root cause**: A second method was added to express intent without a behavioral difference.
- **Impact**: 28 LOC duplicated. Bug fixes in one (e.g. resetting `tailFlushScheduled`) must be mirrored.
- **Fix sketch**: Either delete `clear()` and have callers use `reset()`, or have `clear()` call `reset()`. If genuine intent is to also push an empty array to the store, document that and add the extra call after `reset()`.

## 7. Inline row-mapper closure duplicated across `traces.rs` get-by-execution / get-by-chain
- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/db/repos/execution/traces.rs:49-63` and `:89-104`
- **Scenario**: The closure that constructs an `ExecutionTrace` (8 fields with custom span-json parsing and u64 casting) is copy-pasted into both `get_by_execution_id` and `get_by_chain_trace_id`. The two closures are byte-identical.
- **Root cause**: Inline closure pattern instead of named `row_to_trace` helper.
- **Impact**: ~30 LOC. Changes to the trace shape (e.g. adding `provider_id`) require two edits.
- **Fix sketch**: Extract `fn row_to_trace(row: &Row) -> rusqlite::Result<ExecutionTrace>` near the top of the file and reuse.

## 8. `provider_audit.rs` row-mapping closure duplicated across `list` / `list_by_persona`
- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/db/repos/execution/provider_audit.rs:56-72` and `:98-113`
- **Scenario**: Two consecutive functions each carry an identical 17-line `query_map(|row| { Ok(ProviderAuditEntry { ... }) })` closure with 13 positional `.get()` calls. The boolean conversion (`row.get::<_, i32>(6)? != 0`) is repeated verbatim.
- **Root cause**: Positional `.get(idx)` discourages reusable mappers (versus named-column `row.get("name")`).
- **Impact**: ~34 LOC. Adding a new column requires updating both index sequences in lockstep — a known source of off-by-one bugs.
- **Fix sketch**: Switch to named-column `.get("...")` and extract a `fn row_to_provider_audit(row: &Row) -> rusqlite::Result<ProviderAuditEntry>` shared by both.

## 9. Deprecated type aliases `PipelineTrace` / `PipelineTraceEntry` actively imported
- **Severity**: medium
- **Category**: cruft
- **File**: `src/lib/execution/pipeline.ts:278`, `:283`; consumers at `executionSlice.ts:8,105`, `SyntheticTrace.ts:2,8`, `PipelineSummary.tsx:2,12`, `CostAccrualOverlay.tsx:2,16`, `StageBar.tsx:2,20`
- **Scenario**: The two `@deprecated` aliases were left in place as a "migration aid" but no migration ever happened — they are still imported by the live execution slice and four trace UI components. The deprecation comment is misleading.
- **Root cause**: Migration scaffolding never completed; the rename to `UnifiedTrace`/`UnifiedSpan` stopped at the lib boundary.
- **Impact**: Two type identities (`PipelineTrace` and `UnifiedTrace`) for the same shape — readers must check the deprecation comment each time. Static analyzers like `eslint-plugin-deprecation` flag every consumer.
- **Fix sketch**: Either (a) complete the migration: codemod the 5 consumer files to use `UnifiedTrace`/`UnifiedSpan` and delete the aliases, or (b) drop the `@deprecated` JSDoc since the rename is not happening.

## 10. `ambient.rs` and `clipboard_intel.rs` misplaced under `commands/execution/`
- **Severity**: medium
- **Category**: structure
- **File**: `src-tauri/src/commands/execution/ambient.rs:1-15` (315 LOC), `src-tauri/src/commands/execution/clipboard_intel.rs` (150 LOC); registered at `commands/execution/mod.rs:1-6`
- **Scenario**: `ambient.rs` exposes ambient-context CRUD, sensory policies, and context rules — none of which relate to "execution" (per the module's own docstring: "ambient context fusion system and context rule engine"). `clipboard_intel.rs` similarly handles clipboard analytics. Both are conditionally compiled (`#[cfg(feature = "desktop")]`) and have no callers inside the execution pipeline.
- **Root cause**: Convenience: someone needed a Tauri command home for "things the desktop feature does" and the execution module was already wired up.
- **Impact**: New contributors searching `commands/execution/` for execution-related code wade through 465 LOC of unrelated commands. The module name has stopped describing its contents.
- **Fix sketch**: Move both files to `commands/ambient/mod.rs` (creating the directory) and re-register under that name. Mechanical move, no behavior change. If the desktop-feature gating is the real coupling, group all desktop-only modules under `commands/desktop/`.

## 11. `get_summary` vs `get_summary_with_conn` (and `get_chart_data` / `_with_conn`) trivial wrappers
- **Severity**: low
- **Category**: structure
- **File**: `src-tauri/src/db/repos/execution/metrics.rs:387` + `:409`; `:453` + `:475`
- **Scenario**: Each pair has a public `_with_conn` variant that does the actual work, plus a public wrapper that calls `pool.get()` then forwards. The wrapper adds logging that the inner version lacks — but no caller of `_with_conn` is visible inside the scope, and `get_summary` (the wrapper) is the only one used by commands.
- **Root cause**: Variant retained "just in case" a transaction-scoped variant is needed later. Currently the `_with_conn` variants are unused externally.
- **Impact**: ~60 LOC of forwarding/logging boilerplate. Two public surface APIs that both target the same DB read.
- **Fix sketch**: Audit cross-module callers; if `_with_conn` is unused, fold its body into the public function. If it is needed for transaction reuse, document the intent and mark the wrapper as the canonical entry-point so reviewers don't extend both.

## 12. Knowledge-injection middleware mutates `inputData` but downstream path is brittle
- **Severity**: low
- **Category**: structure
- **File**: `src/lib/execution/knowledgeMiddleware.ts:75-83`, `src/stores/slices/agents/executionSlice.ts:286-294`
- **Scenario**: The middleware returns a new payload with `inputData` set to either `${payload.inputData}\n\n${guidance}` (string concat) or just `guidance`. In `executionSlice.ts:290`, the consumer falls back to the original JSON-stringified input if `validateResult.inputData` is null. The result is that knowledge guidance gets concatenated onto a JSON-stringified blob (`{"key":"value"}\n\n[Knowledge Graph Guidance]...`) which is then sent to the backend as `input_data` — the prompt assembler then tries to parse this as JSON in `executions.rs:323-331` and falls back to wrapping plain text.
- **Root cause**: The middleware contract treats `inputData` as opaque text, but the upstream sender treats it as JSON. Knowledge injection silently produces malformed JSON inputs.
- **Impact**: Knowledge-injected runs almost certainly fall through the `json::from_str(...).unwrap_or_else(|_| json!({ "user_input": s }))` fallback — the carefully-extracted JSON structure becomes a single user_input string. No errors, just lost structure.
- **Fix sketch**: Either (a) change the middleware to attach `guidance` as a separate metadata field on `payload` and let the backend prompt-assembler merge it, or (b) have the middleware parse `inputData` as JSON, inject `_knowledge_guidance` into the object, and re-stringify.

## 13. `tailVisibilityUnsubscribe` cleanup duplicated across `reset()` / `clear()` (and could leak)
- **Severity**: low
- **Category**: cruft
- **File**: `src/lib/execution/executionSink.ts:152-153`, `:168-169`, `:258-263`
- **Scenario**: The `tailVisibilityUnsubscribe` cleanup pattern (`this.tailVisibilityUnsubscribe?.(); this.tailVisibilityUnsubscribe = null;`) is repeated in `reset()`, `clear()`, and inside `scheduleTailFlush`. If a future caller forgets the pair, a stale `unsubscribe` callback leaks.
- **Root cause**: Cleanup is an ad-hoc pair rather than a method.
- **Impact**: ~6 LOC of repetition plus a real foot-gun for future maintainers.
- **Fix sketch**: Add `private clearVisibilityListener(): void { this.tailVisibilityUnsubscribe?.(); this.tailVisibilityUnsubscribe = null; }` and call it from all three sites. (Bundles with finding #6 if both refactors land together.)
