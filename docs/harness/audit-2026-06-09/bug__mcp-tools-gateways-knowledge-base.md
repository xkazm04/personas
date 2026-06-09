# Bug Hunter — mcp-tools-gateways-knowledge-base
> Total: 6
> Severity: 1 critical, 3 high, 2 medium

## 1. SQLite sandbox-escape: ATTACH/DETACH/VACUUM deny-list bypassable with comment or tab separators
- **Severity**: critical
- **Category**: injection
- **File**: src-tauri/src/engine/db_query.rs:2176-2192 (deny-list), :155-187 (extract_first_keyword)
- **Scenario**: User enables write mode (`allow_mutation = true`) in the SQL explorer Console and runs `ATTACH/**/DATABASE 'C:\Users\victim\AppData\...\app.db' AS app` (or `ATTACH\tDATABASE ...`, or `ATTACH  DATABASE` with leading newline before the keyword). The intent of the deny-list is to keep queries confined to the user-facing DB and block attaching arbitrary files. The guard is `let upper = trimmed.to_uppercase(); for kw in ["ATTACH ", "DETACH ", "VACUUM INTO"] { if upper.starts_with(kw) {...} }`. Because the check requires a literal trailing space immediately after `ATTACH`, any other whitespace/comment between the verb and the next token (`ATTACH/**/`, `ATTACH\tDATABASE`, `ATTACH\nDATABASE`) defeats `starts_with("ATTACH ")`. `is_sqlite_read` returns `false` for `ATTACH` (it is not in the read keyword set), so control reaches the write branch, the deny-list misses it, and `conn.execute(trimmed, [])` attaches the foreign database file. The attacker can then `SELECT ... FROM app.<table>` to exfiltrate the internal app DB (credentials/secrets live in `state.db`, but the *user* DB and any path-reachable SQLite file become readable/writable), or `ATTACH` a brand-new file at an arbitrary filesystem path to write data out of the sandbox (path traversal). `VACUUM INTO '...'` (e.g. `VACUUM/**/INTO 'evil.db'`) likewise writes a full DB copy to an arbitrary path.
- **Root cause**: A keyword deny-list implemented with `starts_with("KW ")` over raw text instead of reusing the already-existing comment-stripping tokenizer (`extract_first_keyword`). Whitespace/comment normalization is applied for *classification* but not for the *deny-list*, so the two disagree.
- **Impact**: security (sandbox escape, cross-database read/exfiltration, arbitrary-path file write/path-traversal)
- **Fix sketch**: Derive the leading verb via `extract_first_keyword(trimmed)` and compare the normalized keyword against `{"ATTACH","DETACH","VACUUM"}` (and reject `VACUUM` whenever its body contains `INTO`). Make the deny-list operate on the same tokenized keyword the classifier uses so no separator trick can split them. Better still, set SQLite `PRAGMA` limits / open the user-db connection with extension+ATTACH disabled (e.g. `SQLITE_DBCONFIG_ENABLE_ATTACH` off / `SQLITE_LIMIT_ATTACHED = 0`) so the capability is structurally impossible rather than blacklist-filtered.

## 2. MCP stdio response not correlated to request id — pooled session desyncs, returns another call's result
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/engine/mcp_tools.rs:964-994 (execute_tool_on_session), :1639-1705 (read_session_jsonrpc), :237-271 (return_pooled_session)
- **Scenario**: `execute_tool_on_session` writes a `tools/call` with `session.next_id` then calls `read_session_jsonrpc`, which returns the *first* framed message on stdout without ever checking that its `id` matches the request just sent. Compliant MCP servers may interleave server-initiated notifications/requests (e.g. `notifications/message`, logging, `ping`, sampling/elicitation requests) on the same stdout. If such a message arrives first, it is consumed as "the response" (parsed by `parse_tool_result`, which treats a notification with no `result`/`error` as `is_error` or "No result"), and — worse — the *actual* tool result remains unread in the pipe. The session is then returned to the pool via `finish_session(..., success=true)` (it was an `Ok`), so the NEXT `tools/call` on that pooled session reads the previous call's leftover result. Persona A's KB/tool answer is silently delivered to Persona B.
- **Root cause**: A request/response transport built on "read the next frame" with no id matching and no draining of unsolicited messages; the pool then reuses a stream whose read cursor is misaligned. The cache/pool design assumes strict ping-pong framing that the MCP spec does not guarantee.
- **Impact**: corruption (cross-call/cross-persona data leakage), UX degradation (spurious tool errors)
- **Fix sketch**: Loop in `read_session_jsonrpc` until a frame whose `id` equals the request id arrives; skip/handle notifications (no `id`) and mismatched ids explicitly. On any unexpected/mismatched frame on a *pooled* session, do not return it to the pool — kill it (`start_kill`) so a desynced stream can never be reused.

## 3. Gateway tool routing collides when two enabled members share a display_name → calls dispatched to the wrong credential
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/commands/credentials/mcp_gateways.rs:18-52 (add_member), src-tauri/src/engine/mcp_tools.rs:644-678 (execute_tool gateway path)
- **Scenario**: `add_mcp_gateway_member` validates that a display_name is non-empty and contains no `::`, but never enforces uniqueness within a gateway. Two members can be added with the same `display_name` (e.g. both "github"). At list time both contribute tools named `github::<tool>`; at call time `execute_tool` resolves the member with `members.into_iter().find(|m| m.enabled && m.display_name == member_prefix)` — i.e. the FIRST match. A persona that meant to call the second "github" member (different credential/account/scope) silently hits the first member's credential, executing an action against the wrong account, or reading data the persona shouldn't reach.
- **Root cause**: The display_name is used as a routing key but is only checked for format, not for uniqueness; `find` masks the ambiguity by picking arbitrarily.
- **Impact**: security / corruption (wrong-credential dispatch, cross-account action), silent UX wrongness
- **Fix sketch**: Enforce a UNIQUE constraint on `(gateway_credential_id, display_name)` at the DB layer and reject duplicates in `add_member`/rename with a clear error. Defensively, have the execute path error on >1 enabled match rather than silently taking the first.

## 4. Embedding model poisoned permanently after a single transient load failure
- **Severity**: high
- **Category**: recovery-gap
- **File**: src-tauri/src/engine/embedder.rs:101-167 (ensure_loaded), :29 (poisoned flag)
- **Scenario**: First KB ingest/search triggers `ensure_loaded`, which on first run downloads ~23MB. Any failure of `TextEmbedding::try_new` — a transient network blip during the model download, a half-written cache file, a temporary out-of-disk, or a slow mirror — is treated identically to a fatal ONNX DLL panic: `self.poisoned.store(true)`. Once poisoned, *every* future call (for the entire process lifetime) returns "Embedding model permanently unavailable" with no retry, even after the network/disk recovers. The whole knowledge-base subsystem (ingest, search, KB creation which reads `embedder.dimensions()`) is dead until the user fully restarts the app, with no surfaced "retry" path.
- **Root cause**: Conflating recoverable load errors (download/IO) with the genuinely-unrecoverable panic case (incompatible system onnxruntime.dll). The poison latch was added to stop repeated *panics* from leaking memory, but it now latches on ordinary `Err` too.
- **Impact**: UX degradation (entire KB feature disabled for the session after one transient hiccup), recovery gap
- **Fix sketch**: Only set `poisoned` on the `catch_unwind` panic branch (true DLL incompatibility). For the `Err(...)` (download/IO) branch, return the error WITHOUT latching so the next call retries; optionally add bounded backoff/attempt counting rather than a permanent latch.

## 5. KB ingest reports "completed" even when every file failed; per-file errors are swallowed
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/engine/kb_ingest.rs:68-100 (ingest_files loop)
- **Scenario**: In `ingest_files`, each `ingest_single_file` error is logged with `tracing::warn!` and the loop continues; the error is never accumulated into `progress.error` or surfaced. After the loop, `progress.status = "completed"` and `KB_INGEST_COMPLETE` is emitted unconditionally — even if all N files failed (unreadable encoding, embedding error, chunker failure). The `spawn_ingest_job` wrapper only emits `KB_INGEST_ERROR` when the whole job returns `Err`, which it never does here. The user sees "completed", `documents_done = N`, but `chunks_created` may be 0 and nothing was indexed. Later searches return empty with no explanation.
- **Root cause**: "Continue on per-file error" was implemented as "discard per-file error," and final status is hard-coded to success regardless of outcome.
- **Impact**: silent failure (empty KB presented as successfully ingested), UX degradation/erosion of trust
- **Fix sketch**: Track `documents_failed` and collect the last/first error message; set final status to `"completed_with_errors"` (or `"failed"` when failures == total) and populate `progress.error`. Emit a result the UI can distinguish from a clean success.

## 6. Client/server mutation classifiers diverge (CTE verbs) — write-mode confirmation gate can be skipped
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/vault/sub_databases/safeModeUtils.ts:24 (MUTATION_VERBS_RE), src-tauri/src/engine/db_query.rs:194-196 (CTE_MUTATION_VERBS)
- **Scenario**: The frontend safe-mode gate (`useQuerySafeMode` → `isMutationQuery`) decides whether to show the destructive-action confirmation dialog before executing. For `WITH`-led queries it scans the body with `MUTATION_VERBS_RE = /\b(DELETE|UPDATE|INSERT|MERGE|REPLACE|TRUNCATE|UPSERT)\b/i`, which omits `DROP` and `ALTER` — both present in the Rust `CTE_MUTATION_VERBS` source of truth. A data-modifying CTE that reaches DDL via the body, or any future verb only added on one side, classifies as read-only on the client, so the confirmation modal is skipped and `runQuery(text, /*allowMutation*/ false)` is sent. The backend then *correctly* rejects it as a mutation — but the user gets a confusing hard error instead of the intended "confirm to run as a write?" prompt, and the two lists will keep drifting.
- **Root cause**: Two hand-maintained copies of the mutation-verb set with no shared origin; the JS copy is a subset of the Rust copy.
- **Impact**: UX degradation (confusing rejection where a confirm dialog was expected); latent correctness drift between the two classifiers
- **Fix sketch**: Generate the verb list (and ideally the whole classifier) from a single source — e.g. export the Rust `CTE_MUTATION_VERBS`/read-keyword sets via ts-rs or a generated constants module the frontend imports — so the two can never diverge. At minimum, add `DROP`/`ALTER` to the JS regex and add a test asserting parity.
