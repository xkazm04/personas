# tauri:db/models [3/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 2 findings (0 critical / 1 high / 1 medium / 0 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. MCP arena-results tool SELECTs columns the migration dropped — query always fails on migrated DBs
- **Severity**: High
- **Lens**: code-refactor
- **Category**: stale-schema-reference
- **File**: src-tauri/src/mcp_server/tools.rs:2119 (root: src-tauri/src/db/migrations/incremental.rs:5423)
- **Scenario**: Any MCP client calls `arena_get_results`. `handle_arena_get_results` prepares `SELECT … tool_calls_expected, tool_calls_actual … FROM lab_arena_results`, but `drop_legacy_tool_calls_columns` (invoked unconditionally at incremental.rs:4544) has already dropped both columns from every lab result table, so `conn.prepare` returns "no such column" and the tool errors 100% of the time.
- **Root cause**: The lab_tool_calls child-table ADR (see the retirement comment in `db/models/test_run.rs:36-38` and the DROP COLUMN batch at incremental.rs:5423-5434) swept the models, repos, and Tauri commands but missed this raw-SQL MCP handler, which still reads the pre-ADR column list.
- **Impact**: A whole MCP tool is dead — every `arena_get_results` call fails with a query error on any DB where migrations have run (i.e., all real installs). Silent because it only surfaces to external MCP callers.
- **Fix sketch**: Remove `tool_calls_expected, tool_calls_actual` from the SELECT and the two `row.get` lines (shift the remaining indices down by 2). If tool-call data should still be exposed over MCP, join/fetch from `lab_tool_calls` keyed by `result_id` with `result_kind='arena'`, mirroring the `labGetToolCalls` IPC path.

## 2. PlatformDefinition family is the only frontend-facing model without ts-rs export — hand-maintained TS mirror invites drift
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/models/platform_definition.rs:16
- **Scenario**: `get_platform_definition` (commands/design/platform_definitions.rs:46) returns the full `PlatformDefinition` to the frontend, but the struct (and its 5 nested types) derives only Serialize/Deserialize — no `TS`/`#[ts(export)]` like every other model in this module. The frontend consumes it via a hand-written `export interface PlatformDefinition` in src/lib/personas/platformDefinitions.ts:36 (plus a second hand-written `PlatformDefinitionSummary` in src/api/platforms/platformDefinitions.ts:8).
- **Root cause**: The struct was added as an internal engine config type and later exposed over IPC without joining the ts-rs codegen convention the rest of db/models follows.
- **Impact**: Two parallel type definitions for the same wire shape; adding/renaming a field on the Rust side (e.g. a new rule list) compiles fine but silently desyncs the TS interface — exactly the failure mode ts-rs exists to prevent. Bounded because the shape changes rarely.
- **Fix sketch**: Add `TS` + `#[ts(export)]` to `PlatformDefinition`, `NodeTypeMapping`, `CredentialConsolidationRule`, `NodeRolePattern`, `ProtocolMapRule`, and `PlatformFormat` (and to `PlatformDefinitionSummary` in the command file), regenerate bindings, then replace the hand-written interfaces in src/lib/personas/platformDefinitions.ts and src/api/platforms/platformDefinitions.ts with imports of the generated types.

## Notes (not findings)
- `CreateTestResultInput.tool_calls_expected/actual` in test_run.rs looked like leftovers post-ADR, but they are the live dual-write inputs to the `lab_tool_calls` child table (db/repos/lab/mod.rs:71, execution/test_runs.rs:204) — correctly kept.
- Perf lens: these 18 files are pure struct/DTO definitions with no loops, queries, or allocation-heavy logic; the only executable code (`ExternalApiKey::parsed_scopes`, `is_expired_at`, `RecipeSuggestionEventType::as_str`) is trivially cheap. No perf findings reported rather than padding.
