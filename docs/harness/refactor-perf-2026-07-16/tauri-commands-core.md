# tauri:commands/core — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: Backend Data & Commands | Files read: 15 | Missing: 0

## 1. `get_export_stats` runs 2 queries per persona and fetches full test-suite rows (with scenario blobs) just to count them
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/core/data_portability.rs:308
- **Scenario**: Every time the user opens the export dialog, the stats preview loops `for p in &personas` calling `memory_repo::get_total_count(...)` and `suite_repo::list_by_persona(...)` per persona, plus `team_memory_repo::get_total_count(...)` per team. With a 100+ persona workspace that is 200+ sequential SQLite queries before the dialog can render. Worse, `list_by_persona(pool, &p.id)?.len()` deserializes complete `test_suites` rows — including the `scenarios` column, which this same file caps at 500 KB (`MAX_SCENARIOS_LEN`) — only to throw everything away for a `.len()`.
- **Root cause**: The stats path was never given the batch treatment `build_export_bundle` already received (it uses `get_by_persona_ids` / `list_by_persona_ids` batch fetches, which already exist in the repos, e.g. `test_suites::list_by_persona_ids`). Counting is done in Rust instead of SQL.
- **Impact**: Measurable dialog-open latency on real workspaces and avoidable multi-MB row materialization on a UI-preview path that only needs 8 integers.
- **Fix sketch**: Replace the loops with aggregate queries: `SELECT COUNT(*) FROM persona_memories`, `SELECT COUNT(*) FROM test_suites`, `SELECT COUNT(*) FROM team_memories` (one query each — the stats are workspace-wide, so no per-id filtering is needed at all), and a `COUNT(*) ... WHERE status IN ('active','paused')` for KPIs instead of `list_all_kpis(...).filter(...).count()`. Eight scalars, ~6 queries total, no row hydration.

## 2. `memory_compile.rs` re-implements ~150 lines of the memories.rs CLI pipeline, and the shared wrapper meant to fix this is dead code
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/core/memory_compile.rs:179
- **Scenario**: `compile_persona_memories` steps 3–5 (CLI arg building, `CREATE_NO_WINDOW`, `CLAUDECODE`/`CLAUDE_CODE`/`CLI_SUBSCRIPTION_RESERVED_ENV` stripping, stdin write, BufReader line loop, 180 s timeout + kill/wait, empty-output check) are a byte-level mirror of `run_memory_review_pipeline` steps 3–5 in memories.rs:441–520. `extract_json_array` (memory_compile.rs:347) is an identical copy of memories.rs:1288 — the comment even admits it ("Mirror of the helper in `commands::core::memories`"). Meanwhile memories.rs:651 exports `pub(crate) fn extract_json_array_from` explicitly "for cross-module reuse (F-DRY)" — and grep shows it has **zero callers** anywhere in `src-tauri/src`: the dedup seam was built and then never used.
- **Root cause**: The compile command was written as a "near-mirror of review_memories_with_cli" (its own module doc) instead of extracting the shared spawn/read/parse core; the F-DRY wrapper was added later but the duplicate was never rewired to it.
- **Impact**: The env-stripping block is billing/security-relevant (it prevents API-account billing) — a fix applied to one copy silently misses the other. Two identical JSON-array parsers with two identical test suites also double the maintenance surface.
- **Fix sketch**: Add a `run_claude_cli_prompt(prompt: &str, timeout: Duration) -> Result<String, AppError>` helper in `engine::cli_process` (which already owns `claude_cli_invocation` and `CLI_SUBSCRIPTION_RESERVED_ENV`) and call it from both commands. Move `extract_json_array` next to it (or into a small `llm_output` util), delete the copy in memory_compile.rs and the dead `extract_json_array_from` wrapper. While there, drop the no-op leftover `let _ = Uuid::new_v4(); // reserved for future link-table id` at memory_compile.rs:330.

## 3. `update_persona` and `update_persona_parameters` duplicate a ~55-line fire-and-forget cloud-sync closure
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/core/personas.rs:180
- **Scenario**: Both commands end with an identical `tauri::async_runtime::spawn` block: lock cloud_client → `list_deployments` → check `persona_id` match → `get_tools_for_persona` → `assemble_prompt` → build the same 15-field `serde_json::json!` body → `upsert_persona` with mirrored warn/info logs (personas.rs:180–232 vs 287–336). Only the log strings differ.
- **Root cause**: The parameter-only update path was cloned from the full update path and the sync tail was copy-pasted rather than extracted.
- **Impact**: The cloud body schema is defined twice — adding a field (as `homeTeamId` was) must be done in two places or desktop/cloud state silently diverges depending on which editor the user touched. ~110 lines where ~60 would do.
- **Fix sketch**: Extract `fn spawn_cloud_persona_sync(state: &AppState, persona: Persona, context: &'static str)` that owns the deployment check, prompt assembly, body construction, and logging; both commands call it after their `repo::update`. The session-pool invalidation spawn could ride along in the same helper.

## 4. Standalone `export_credentials` duplicates the encrypt-envelope logic of `build_encrypted_credentials`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/core/data_portability.rs:2393
- **Scenario**: `export_credentials` (lines 2393–2458) repeats the exact collect-entries → audit-log-decrypt → serialize → random salt/nonce → PBKDF2 derive → AES-GCM encrypt → base64 envelope sequence already implemented in `build_encrypted_credentials` (lines 2153–2222). The only behavioral difference is the builtin-connector skip and the audit-log context string.
- **Root cause**: The unified-export path grew its own helper later; the older standalone command was never refactored onto it.
- **Impact**: Crypto parameters (iterations, salt/nonce sizes, envelope format) are maintained in two places; a future hardening change (e.g. bumping `PBKDF2_ITERATIONS` semantics or switching KDF) can drift between the embedded and standalone `.enc` formats, which share `CREDENTIAL_EXPORT_FORMAT`.
- **Fix sketch**: Give `build_encrypted_credentials` a small options struct (skip-builtins flag + audit context) or a credential-filter closure, and have `export_credentials` call it, keeping only the file-dialog/write tail locally. ~60 lines removed, one crypto path.

## 5. `build_export_bundle` issues per-row queries for KPI measurements and team sub-entities inside loops
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/core/data_portability.rs:978
- **Scenario**: The persona side of the export was explicitly batched ("5 queries instead of 5*N", line 720), but the same function still runs `dev_tools_repo::list_kpi_measurements(pool, &k.id, ...)` once per KPI (up to `MAX_KPIS = 200` queries) and, per team, `get_members` + `get_connections` + `team_memory_repo::get_all` (up to 50 × 3 queries). A full export of a large workspace pays ~350 sequential queries where a handful of `WHERE ... IN` batches would do.
- **Root cause**: The KPI and team export arms were added after the persona batching pass and reused the per-id repo functions.
- **Impact**: Bounded (caps exist) but user-visible: the export dialog blocks while the bundle builds, and this dominates its DB time on KPI/team-heavy workspaces. Same shape the codebase already fixed once for personas.
- **Fix sketch**: Add `list_kpi_measurements_by_kpi_ids(pool, &ids, per_kpi_limit)` (single query with a window function `ROW_NUMBER() OVER (PARTITION BY kpi_id ORDER BY measured_at DESC)` to keep the newest-N-per-KPI cap) and `get_members_by_team_ids` / `get_connections_by_team_ids` batch fetches, then group into HashMaps exactly as the persona path does.
