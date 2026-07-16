# tauri:commands/execution — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 3 medium / 3 low)
> Context group: Backend Data & Commands | Files read: 15 | Missing: 0

## 1. Four near-identical `build_results_summary_*` helpers in lab.rs

- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/execution/lab.rs:1051
- **Scenario**: Any change to the improvement-prompt summary shape (adding a field, renaming a key) must be applied in four places; `build_results_summary_ab` (:1070) and `build_results_summary_eval` (:1111) are already byte-for-byte identical bodies over different result types.
- **Root cause**: All four lab result types share a `base` struct carrying the eight common fields, but each mode grew its own `Vec<Value>` mapper instead of one helper over `&LabResultBase` plus per-mode extras.
- **Impact**: ~80 lines of copy-paste; the AB/eval pair is guaranteed drift risk — a field added to one but not the other silently changes what the improvement LLM sees per mode.
- **Fix sketch**: Extract `fn base_summary(base: &LabResultBase) -> serde_json::Map<String, Value>` returning the shared eight keys, then each mode maps results as `base_summary(&r.base)` + inserts its extras (`version_id`/`version_number` or `variant`). Collapses four functions to one helper plus three tiny closures; AB and eval can share one generic function over a trait or a `(id, num)` accessor.

## 2. Cancel-then-wait wind-down loop duplicated between lab.rs and tests.rs

- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/execution/tests.rs:115
- **Scenario**: `delete_test_run` re-implements inline (10×50ms poll, force-unregister) exactly what `lab::cancel_active_run_before_delete` (lab.rs:40) already encapsulates — including identical comments. Separately, `lab_cancel_arena`/`lab_cancel_ab`/`lab_cancel_matrix`/`lab_cancel_eval` are four identical bodies differing only in the repo module.
- **Root cause**: The helper lives in `lab.rs` as a private fn, so `tests.rs` (same run domain, same `"test"` registry key) copy-pasted it; the four cancel commands were stamped per mode instead of parameterizing the status-update call.
- **Impact**: A future fix to the wind-down protocol (e.g. longer grace period, checking child PIDs) will be applied to one copy and missed in the other; the 4× cancel bodies are ~60 redundant lines.
- **Fix sketch**: Move `cancel_active_run_before_delete` to a shared location (e.g. `engine::process_registry` helper or a `commands::execution::run_lifecycle` module) and call it from `delete_test_run`. For the cancel commands, extract `fn cancel_lab_run(state, id, update: impl Fn(...) -> Result<...>)` or pass a `LabRunKind` enum that dispatches to the right `update_run_status`.

## 3. Leftover lock/drop of `child_pids` mislabeled `log_dir` in start_test_run

- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/commands/execution/tests.rs:58
- **Scenario**: `let log_dir = state.engine.child_pids.lock().await; drop(log_dir);` acquires the engine's child-PID mutex, does nothing, and releases it on every test-run start. The comment claims it "verifies engine is alive", but `state.engine` is an owned Arc field — locking a mutex proves nothing.
- **Root cause**: Leftover from an earlier version that presumably read the log dir or a liveness flag; the binding name (`log_dir`) no longer matches what it locks.
- **Impact**: Dead code that misleads readers and briefly contends the child-PID lock the engine uses on its hot spawn path; zero functional value.
- **Fix sketch**: Delete both lines. If an engine-alive precondition is genuinely wanted, add an explicit `state.engine.is_alive()`-style accessor instead of a side-effect-free lock.

## 4. Clipboard KB search over-fetches chunk content with per-row N+1 lookups

- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/execution/clipboard_intel.rs:81
- **Scenario**: The clipboard watcher calls `search_kb_for_error` on every detected error. For each ready KB it runs a vector search returning up to `limit` hits, then issues one `lookup_chunk_content` query per hit — before sorting and truncating to `limit` overall. With K knowledge bases the code executes up to K×limit single-row queries and fetches full chunk text for K×limit rows to keep only `limit`.
- **Root cause**: Content hydration happens inside the per-KB loop instead of after the global sort/truncate; each hydration is an individual `query_row` rather than a batched `IN (...)` select.
- **Impact**: Over-fetch factor equal to the KB count on a path triggered by ambient clipboard activity — wasted SQLite round-trips and string allocations for chunks that are discarded, plus the whole thing runs under `block_in_place` on the async runtime.
- **Fix sketch**: Collect `(kb_name, chunk_id, similarity)` tuples from all KBs first, sort by similarity, `truncate(limit)`, then hydrate only the surviving `limit` chunk ids with a single `SELECT ... WHERE c.id IN (?1..?n)` (or one prepared statement reused in a loop of exactly `limit` iterations). Cuts queries from K×limit to ≤limit and eliminates discarded-content fetches.

## 5. `bulk_resolve_audit_incidents` re-fetches each incident row after resolving

- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/execution/audit_incidents.rs:194
- **Scenario**: After `repo::bulk_resolve` flips N rows in one statement, the command loops the returned ids and calls `repo::get_by_id` once per id purely to build the `incident_resolved` event payload — N extra single-row queries for a bulk operation the UI offers on multi-selections.
- **Root cause**: `bulk_resolve` returns only ids, so the event publisher must re-read every row individually.
- **Impact**: Bounded by selection size (≤ the 500-row list cap), so cost is real but modest; still turns a one-statement bulk path into 1+N reads plus N event inserts.
- **Fix sketch**: Have `repo::bulk_resolve` return the resolved `Vec<AuditIncident>` (SQLite supports `UPDATE ... RETURNING *`), or add a `get_by_ids(&[String])` batched read; then feed the rows straight to `publish_incident_resolved`.

## 6. Forward pagination of execution logs re-scans the file from the top each page

- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: runtime-perf
- **File**: src-tauri/src/commands/execution/executions.rs:628
- **Scenario**: `get_execution_log_lines` with an `offset` reads and regex-filters every line from the start of the log before `.skip(offset)` takes effect. A frontend paging through a multi-MB log in 500-line pages performs O(pages²) total line parsing — page 10 re-reads and re-filters the first ~4500 matching lines just to discard them.
- **Root cause**: Line-number offsets over a plain text file have no index, so each call must re-scan the prefix; there is no byte-offset cursor returned to the caller.
- **Impact**: Bounded per call (single linear scan) and tail mode already uses a ring buffer, so this only bites on deep forward pagination of very large logs — measurable but not hot for typical replay use.
- **Fix sketch**: Return a continuation token alongside the lines (byte offset of the last consumed line via `BufReader::stream_position` or a manual byte counter) and accept it on the next call to `Seek` past already-served content. Keep the current offset path as fallback for old callers.
