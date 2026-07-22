# tauri:commands/infrastructure [2/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. Job-type → manager dispatch duplicated three ways in workflows.rs
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/infrastructure/workflows.rs:52
- **Scenario**: Adding a sixth background-job manager (the file already aggregates five) requires editing three hand-maintained mappings: the `sources` vec in `get_workflows_overview` (lines 52–58), the `match job_type` in `get_workflow_job_output` (lines 109–121), and the `match job_type` in `cancel_workflow_job` (lines 139–164). Missing one silently produces a job that appears in the overview but 404s on output or cancel.
- **Root cause**: The (label, list_fn, cancel_fn) triple for each job source is spelled out inline at each call site instead of being declared once.
- **Impact**: Real drift hazard — the three lists already use three different code shapes (vec of tuples, match returning snapshots, match with inline `use` + cancel call), so a reviewer cannot diff-check them at a glance.
- **Fix sketch**: Introduce a single registry, e.g. `fn job_sources() -> &'static [JobSource]` where `JobSource { label: &'static str, list: fn() -> Vec<Snapshot>, cancel: fn(&AppHandle, &str) -> Result<(), AppError> }`. All three commands iterate/lookup that slice; unknown `job_type` handling collapses to one place.

## 2. Atomic config-write block copy-pasted between register/unregister MCP commands
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/infrastructure/system/mcp_integration.rs:124
- **Scenario**: `register_claude_desktop_mcp` (lines 124–131) and `unregister_claude_desktop_mcp` (lines 157–163) contain the identical serialize → write `.json.tmp` → rename sequence, including the same three error-message strings.
- **Root cause**: The temp-file-plus-rename atomicity pattern was inlined twice instead of extracted when the second command was added.
- **Impact**: ~15 duplicated lines; a future fix to the atomic-write discipline (e.g. fsync before rename, Windows rename-over-existing edge cases) has to be applied twice or the two paths diverge.
- **Fix sketch**: Extract `fn write_json_atomic(path: &Path, value: &serde_json::Value) -> Result<(), AppError>` in this module and call it from both commands. The read-and-parse preamble (read_to_string + permissive `from_str`) is also shared and could ride along as `read_config(path)`.

## 3. Static-scan findings inserted row-by-row with no wrapping transaction
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/infrastructure/static_scan.rs:125
- **Scenario**: `dev_tools_run_static_scan` loops over parsed findings and calls `repo::create_idea` once per finding (lines 125–148). Tools like knip/jscpd on a large repo routinely emit hundreds to thousands of findings; each insert is its own SQLite autocommit (one journal sync each) on the shared app pool.
- **Root cause**: The log-and-continue-per-row discipline (deliberate, per the comment) was implemented as N independent commits rather than batched writes with per-row error capture inside one transaction.
- **Impact**: Hundreds of fsyncs serialize the scan tail into multi-second stalls and hold the writer lock repeatedly, causing `database is busy` pressure on every other feature sharing `state.db` while a scan lands.
- **Fix sketch**: Add a repo function that takes the findings slice, opens one transaction (or chunks of ~100), performs the inserts with per-row `Result` collection (savepoints or plain per-statement error capture keep the log-and-continue semantics), and commits once. The existing failure-count → 'error' status logic is unchanged.

## 4. Workflows overview clones every job's full output buffer on each poll
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src-tauri/src/commands/infrastructure/workflows.rs:75
- **Scenario**: `get_workflows_overview` calls the five `list_*_jobs()` snapshot functions, each of which clones every job's complete `lines: Vec<String>` out of the in-memory managers — then the command uses only `lines.len()` and the last 20 lines (line 75). A UI that polls the overview while a chatty CLI job streams thousands of lines re-copies the entire multi-megabyte buffer on every tick.
- **Root cause**: The snapshot API returns full transcripts; the overview aggregator has no "tail-only" variant, so the full clone happens N-jobs × poll-rate times just to be truncated.
- **Impact**: Measurable allocation/copy churn on a hot polled path that grows linearly with job verbosity and retained-job count; the full transcripts are also serialized nowhere, i.e. pure waste.
- **Fix sketch**: Add a lightweight snapshot variant on each manager (e.g. `list_jobs_meta(tail: usize)` returning `line_count` + last-N lines without cloning the whole vec), and have `get_workflows_overview` consume that. `get_workflow_job_output` keeps the existing full-lines path for on-demand detail.

## 5. webbuild_next_ready issues one DB query per project id
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/infrastructure/webbuild.rs:129
- **Scenario**: The import picker passes its whole project list; the command runs `repo::get_project_by_id` once per id (each a pool checkout + SELECT) plus an `is_next_app` disk probe, all inside a synchronous command.
- **Root cause**: No batch lookup — the filter maps ids to rows one at a time instead of a single `WHERE id IN (...)` fetch.
- **Impact**: Bounded (project counts are small, tens at most), so cost today is milliseconds — but it is the textbook N+1 shape on a command whose input size the frontend controls, stacked with N filesystem checks on the sync IPC path.
- **Fix sketch**: Add `repo::get_projects_by_ids(&db, &ids)` returning rows in one query, then run the `is_next_app` disk checks over the result. Optionally make the command async and wrap the disk probes in `spawn_blocking` since they touch the filesystem per project.
