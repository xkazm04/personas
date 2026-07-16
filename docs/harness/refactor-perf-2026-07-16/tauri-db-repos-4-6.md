# tauri:db/repos [4/6] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. append_single_message ships the full conversation back per appended message, defeating its own stated purpose
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src-tauri/src/db/repos/core/design_conversations.rs:149
- **Scenario**: Every message appended to a design conversation (the hot chat path, wired at `commands/design/conversations.rs:70`) calls `get_by_id(pool, id)` after the JSON-side append and returns the whole `DesignConversation` — including the entire `messages` JSON blob (capped at 500 messages) — inside `AppendMessageResult`, which then crosses Tauri IPC.
- **Root cause**: The function's doc comment says it exists to "avoid transferring the full message history over IPC -- only the new message is sent", but that only holds inbound; the response path re-reads and re-serializes the full history on every append. It also does a separate `json_array_length` count query first, so each append is 3 statements + full-row fetch.
- **Impact**: Per-message cost grows O(total history): with long conversations this is hundreds of KB read from SQLite, serialized, and shipped over IPC for every single message — exactly the waste the API was created to eliminate.
- **Fix sketch**: Return only the metadata the frontend needs (`truncated`, `message_count`, `updated_at`, optionally the appended message echo) instead of the full conversation, and let the frontend keep its local copy authoritative. The count query can be folded into the UPDATE by reading `json_array_length(messages)` back via `RETURNING`. Also note the legacy full-history `append_message` (line 80) is still wired at `commands/design/conversations.rs:58` — check whether both entry points are still needed.

## 2. Manual row mappers duplicated 2–3× inside audit/history repos
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/repos/execution/provider_audit.rs:57
- **Scenario**: Adding or renaming a column in `provider_audit_log`, `tool_execution_audit_log`, or `deployment_history` requires editing 2–3 identical hand-written closures per file; a missed one silently misaligns positional indices.
- **Root cause**: `provider_audit.rs` inlines the same 13-field `ProviderAuditEntry` closure in both `list` (line 57) and `list_by_persona` (line 99); `tool_audit_log.rs` repeats an 11-field closure in `get_recent` (line 79) and `get_by_persona` (line 182); `deployment_history.rs` repeats a 12-field `GitLabDeploymentRecord` closure three times (lines 74, 117, 161). Sibling repos in the same directory already use the `row_mapper!` macro or a named `fn row_to_x`.
- **Impact**: ~120 lines of copy-paste across three files and a positional-index maintenance hazard on every schema change; no runtime cost, pure maintenance drag.
- **Fix sketch**: Extract one named mapper per file (`fn row_to_entry(row: &Row) -> rusqlite::Result<ProviderAuditEntry>` etc., or the existing `row_mapper!` macro where field order matches SELECT *) and pass it to each `query_map`, mirroring the pattern in `template_feedback.rs` / `api_key_audit.rs`.

## 3. Per-key audit trim DELETE runs on every authenticated API request
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: data-layer
- **File**: src-tauri/src/db/repos/resources/api_key_audit.rs:46
- **Scenario**: `insert` is called by the `require_api_key` middleware on every external API request; each call issues a second write — a `DELETE ... WHERE id NOT IN (SELECT ... ORDER BY at DESC LIMIT 500)` — that sorts the key's full history even when the row count is far below the cap.
- **Root cause**: The retention cap is enforced eagerly and unconditionally per insert instead of lazily/amortized.
- **Impact**: Doubles write-path statements and adds a 500-row sort + subquery per request on the hottest external-API path; bounded (≤~501 rows per key) so not unbounded growth, but pure steady-state waste — 99.8% of the DELETEs remove nothing.
- **Fix sketch**: Amortize the trim: run it only when `rowid % N == 0` (e.g. every 50th insert, keeping RETAIN slack at 500+N), or gate it behind a cheap `SELECT COUNT(*) ... LIMIT` check, or move trimming to a periodic maintenance sweep alongside other retention jobs. Keep the same SQL for the actual trim.

## 4. Five near-identical lab create_result functions with a stale ADR breadcrumb pasted into each
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/repos/lab/matrix.rs:116
- **Scenario**: Any change to the shared lab-result column set (e.g. finishing "step 7 of this ADR" that drops the parent-table JSON columns, or adding a metric) must be replicated across `matrix.rs:116`, `ab.rs:96`, `eval.rs:91`, `arena.rs:90`, and `consensus.rs:107` — five ~50-line INSERT blocks that differ only in table name and 1–2 variant columns.
- **Root cause**: `lab_crud!` already generates the shared get/update/delete surface, but `create_result` was left hand-rolled per mode. Each copy also carries the identical comment "The parent-table JSON columns are dropped in step 7 of this ADR / see write_tool_calls_child_rows below" — a stale breadcrumb (the fn lives in `super`, not below) duplicated five times. `consensus.rs` silently omits the `eval_method` column the other four insert, which may or may not be intentional — drift like this is exactly what the duplication invites.
- **Impact**: ~200 lines of parallel SQL that has already started to drift (eval_method asymmetry); every base-column change is a 5-file edit with positional params (`?1..?21`).
- **Fix sketch**: Add the base-column INSERT to the `lab_crud!` macro (parameterized by table + extra variant columns), or extract a helper that takes the table name, the mode-specific `(column, value)` prefix, and `&LabResultBaseInput` and builds the shared column tail once. Delete the five stale ADR comments (or keep one at the helper).

## 5. Dead export list_gateways_containing and a stale dead_code allow on a live function
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/db/repos/resources/mcp_gateways.rs:123
- **Scenario**: `list_gateways_containing` has zero callers anywhere in `src-tauri` (grep-verified); its doc comment claims it is "used by the credential delete flow", which is not true today.
- **Root cause**: The function was added speculatively for a confirmation UX that was never wired; `#[allow(dead_code)]` suppresses the compiler warning that would have flagged it. Meanwhile the same attribute on `set_member_enabled` (line 141) is stale — that function IS called from `commands/credentials/mcp_gateways.rs:81`.
- **Impact**: Misleading documentation plus a silenced dead-code warning that will keep hiding the drift; small but it actively lies about the delete flow's behavior.
- **Fix sketch**: Delete `list_gateways_containing` (Rust-side callers grep-verified absent; it is a `pub fn` in a non-command module so no frontend can reach it) or wire it into the credential-delete confirmation as documented. Remove the now-inaccurate `#[allow(dead_code)]` from `set_member_enabled`.
