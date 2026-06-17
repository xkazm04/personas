# Test Mastery — MCP Gateways & Tools
> Total: 8 findings (3 critical, 3 high, 1 medium, 1 low)

## 1. Tool-runner curl/script injection defenses (`resolve_placeholders`, `sanitize_input_value`, `validate_curl_args`) have ZERO tests
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/tool_runner.rs:360-443 (and the whole file — 874 lines, no `#[cfg(test)]` module)
- **Current test state**: none
- **Scenario**: `invoke_api`/`execute_test_curl` build a `curl` argv from an LLM/template-supplied `Curl:` line plus user input and credential env vars. The injection defenses are all in pure functions: `resolve_placeholders` substitutes user input BEFORE env vars and `sanitize_input_value` escapes `$` so a user value `${API_KEY}` cannot expand to a real secret; `validate_curl_args` blocks `-o/--output/-K/--config/-T/--proto`. A regression that reverses the substitution order, drops the `$`-escape, lowercases-but-misses a flag variant, or fails to strip CRLF/U+2028 reintroduces credential exfiltration, header injection, or arbitrary-file-write — and nothing fails.
- **Root cause**: file was shipped with security-comment rationale but no test module; the functions are private so no external test reaches them.
- **Impact**: silent credential leak / SSRF / local file overwrite through a connector tool — the highest-blast-radius path in this context (it touches real stored secrets).
- **Fix sketch**: add `#[cfg(test)] mod tests` in tool_runner.rs. **LLM-generatable** batch over pure fns. Invariants to assert, NOT current output: (a) `sanitize_input_value("${API_KEY}")` contains no unescaped `$VAR` that `resolve_placeholders`' env pass would expand — feed `env_map={API_KEY:secret}` and assert the secret never appears in the resolved token; (b) `resolve_placeholders` applies input before env (user `{x:"${API_KEY}"}` stays literal); (c) CRLF / `\0` / U+2028 / U+0085 stripped; (d) `validate_curl_args` rejects `-o`, `--output=x`, `--OUTPUT`, `-K`, `--proto`, and accepts a plain `-H`/url; (e) `shell_tokenize` quote/backslash handling round-trips `-H 'Authorization: Bearer t'` to one token.

## 2. MCP cross-credential response correlation (`read_session_response`) and result parsing (`parse_tool_result`) untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/mcp_tools.rs:1815-1841 (`read_session_response`), 1843-1884 (`parse_tool_result`)
- **Current test state**: none (the file's only test module covers `validate_mcp_command`)
- **Scenario**: warm pooled stdio sessions are reused across tool calls. `read_session_response` MUST skip notifications (no `id`) and discard stale/mismatched ids, returning only the matching `expected_id` — the in-code comment states that without this a desynced session returns "the wrong tool's result to the wrong caller (cross-credential/persona data leak), logged as success." If the id-correlation loop or its `MAX_MCP_DRAIN` bound regresses (e.g. accepts first message, or never errors on desync), one persona's MCP result silently leaks into another's execution.
- **Root cause**: the function reads from a `BufReader<ChildStdout>`, perceived as hard to unit-test, so it was left uncovered despite carrying the leak-prevention invariant.
- **Impact**: cross-tenant/persona data leakage delivered as a successful tool result — a confidentiality breach that audit logging would record as success.
- **Fix sketch**: extract the correlation decision into a pure helper (e.g. `match_or_skip(msg: &Value, expected_id) -> Match|SkipNotification|SkipStale`) and unit-test it directly; OR drive `read_session_response` with an in-memory `BufReader` over a hand-framed `Content-Length` byte stream containing [notification, stale id=N-1, target id=N] and assert it returns id=N, and that >`MAX_MCP_DRAIN` non-matching frames returns `Err`. Separately test `parse_tool_result` (pure): JSON-RPC `error` → `is_error=true`; `result.isError=true`; missing `result` → `Err`; content array filtering of malformed blocks.

## 3. JIT-OAuth sentinel detector (`detect_authorization_required`) untested despite documented strict AND-conditions
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/mcp_tools.rs:458-505
- **Current test state**: none
- **Scenario**: this function decides whether a failed tool result is converted into a typed `AppError::AuthorizationRequired` (driving the consent modal) vs. treated as a normal error. Its docstring spells out 4 conjoined conditions (is_error AND parseable-JSON AND (code==-32001 OR kind=="authorization_required") AND an `http(s)` `authorize_url`). A false NEGATIVE breaks every gateway (Arcade) JIT-auth flow — users can never grant consent; a false POSITIVE lets a hostile MCP server smuggle an arbitrary `authorize_url` into the consent modal (open-redirect / phishing surface).
- **Root cause**: pure function with no test module; the conservative AND-layering is exactly the kind of logic that silently drifts on edit.
- **Impact**: either the gateway consent feature is dead (revenue/UX) or it becomes a phishing vector (security) — both business-critical and both invisible without assertions.
- **Fix sketch**: **LLM-generatable** table-driven test over `McpToolResult` fixtures. Assert the invariant "returns Some(url) iff ALL four conditions hold": positive cases (top-level `authorize_url`+code, nested `error.data.authorize_url`+code, top-level `kind`); negatives that must return None — `is_error=false`, non-JSON text, code present but `authorize_url` missing, `authorize_url` with a `javascript:`/`file:` scheme, url present but no code/kind sentinel.

## 4. Gateway tool-name separator invariant + routing parse untested (`add_mcp_gateway_member`, `parse_gateway_tool_name`)
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/credentials/mcp_gateways.rs:20-52; src-tauri/src/engine/mcp_tools.rs:521-526
- **Current test state**: none
- **Scenario**: gateway tools are exposed as `<display_name>::<tool>` and routed back by splitting on the first `::` (mcp_tools.rs:735-750). The boundary guard in `add_mcp_gateway_member` rejects empty / `::`-containing display names (the in-code comment ties this to bug-hunt 2026-06-07 mcp #5: a crafted name dispatches a call to the wrong member/credential). The validation is inline in the command, and `parse_gateway_tool_name` splits on `split_once` (first separator). Neither is tested, so a regression that loosens trimming or switches to `rsplit_once` silently re-enables mis-routing to the wrong credential.
- **Root cause**: validation lives in a `#[tauri::command]` async fn (awkward to call) and the split helper is private with no test module.
- **Impact**: a gateway tool call routed to the wrong member credential = wrong API key used / cross-connector action — a security + correctness regression in a paid-connector path.
- **Fix sketch**: extract the display-name check into a pure `validate_gateway_display_name(&str) -> Result<&str, AppError>` and unit-test (empty, whitespace-only, `"a::b"`, leading/trailing space trimmed, valid `arcade`). Add pure tests for `parse_gateway_tool_name`: `"arcade::search"`→`(Some("arcade"),"search")`, unprefixed→`(None,…)`, and the multi-`::` case `"a::b::c"`→`(Some("a"),"b::c")` to pin the first-separator contract.

## 5. Argument structural limits untested — `json_depth` / `validate_argument_structure` (DoS guard)
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/mcp_tools.rs:1291-1319
- **Current test state**: none
- **Scenario**: every tool call passes through `validate_argument_structure`, which rejects arguments over `MAX_ARGUMENT_BYTES` (1 MB) or `MAX_ARGUMENT_DEPTH` (20) — a guard against a hostile/buggy persona blowing the stack or memory during MCP arg handling. `json_depth` is recursive over arbitrary JSON and is itself a stack-risk if the limit is computed wrong (off-by-one means a 21-deep payload either slips through or a legitimate 20-deep one is rejected).
- **Root cause**: pure functions, no test module.
- **Impact**: DoS / resource exhaustion on the agent runtime if the cap regresses; or false rejection of legitimate nested tool args (feature breakage).
- **Fix sketch**: **LLM-generatable**. Assert invariants: `json_depth(scalar)==0`, `json_depth([[[]]])` matches nesting count, depth of exactly `MAX_ARGUMENT_DEPTH` passes and `+1` errors with a depth-mention message; a >1 MB string value errors with a size-mention message; a normal small object passes. Build the deep value programmatically (loop) rather than hard-coding.

## 6. Schema validation gate untested (`validate_arguments_against_schema`, `extract_tool_schema`)
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/mcp_tools.rs:1326-1392
- **Current test state**: none
- **Scenario**: before forwarding `tools/call`, args are validated against the tool's declared JSON Schema. The function is deliberately permissive in two ways that need pinning: no schema → allow; **invalid** schema → log + allow (fail-open). `extract_tool_schema` resolves `inputSchema` OR `input_schema` and errors when the tool is absent. A regression that makes invalid schemas fail-closed would brick every tool with a sloppy schema; one that drops the `iter_errors` aggregation would let malformed args reach the server.
- **Root cause**: pure functions wrapping the `jsonschema` crate; no tests assert the fail-open vs. reject contract.
- **Impact**: either broad tool breakage (fail-closed regression) or invalid args silently forwarded to a real connector (data-integrity).
- **Fix sketch**: **LLM-generatable**. Invariants: valid args vs. a `{required:[x]}` schema → Ok; missing required field → Err with the field path in the message; `schema=None` → Ok; structurally-invalid schema (e.g. `{"type": 123}`) → Ok (fail-open, document the choice); `extract_tool_schema` finds `inputSchema`, falls back to `input_schema`, returns `Ok(None)` when present-but-schemaless, and `Err` when the tool name is absent.

## 7. `handle_jsonrpc` protocol dispatch (sidecar MCP server) untested for malformed / unknown / notification inputs
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/mcp_server/mod.rs:19-67
- **Current test state**: exists-but-weak — `obsidian_vault_tests.rs` exercises `call_tool` for two vault tools, but the JSON-RPC envelope dispatcher itself (parse-error → -32700, unknown method → -32601, `notifications/initialized` → `None`, `initialize` serverInfo shape, id echo) has no test.
- **Root cause**: tests went straight to the tool layer; the thin dispatcher was assumed trivial, but it owns the protocol contract the Claude CLI depends on.
- **Impact**: a malformed-input or unknown-method regression breaks the sidecar handshake for every persona run that uses `personas_*`/`drive_*` tools, surfacing as opaque "MCP tools unavailable".
- **Fix sketch**: pure unit tests (no DB needed for the error paths): invalid JSON line → response has `error.code == -32700` and `id == null`; unknown method → `-32601`; `notifications/initialized` → `None`; `initialize` → result carries `serverInfo.name == "personas-mcp"` and echoes the request `id`. (Use a temp `McpDbPool` only for the `tools/call` happy path if included.)

## 8. `install_mcp_sidecar` precedence (personas-MCP wins over project-local) and `find_mcp_binary` untested
- **Severity**: low
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/cli_mcp_config.rs:33-56 (`find_mcp_binary`), 75-252 (`install_mcp_sidecar`)
- **Current test state**: exists-but-weak — `merge_project_local_mcp_servers` is well-tested (5 cases incl. shadowing), but the top-level `install_mcp_sidecar` ordering invariant ("personas entry overwrites a project-local entry of the same name", line 234) and the env-var assembly (bridge key only when `api_key` Some, delegate vars only when delegate Some) are not directly asserted; `find_mcp_binary` is uncovered.
- **Root cause**: `install_mcp_sidecar` touches `current_exe()`/`primary_db_path()` global state, so it's harder to test end-to-end; only the easily-isolated helper got coverage.
- **Impact**: low — the merge helper already pins the security-relevant shadowing rule; this is defense-in-depth on env assembly and the binary-probe fallback. A regression mainly degrades to "tools unavailable" rather than a leak.
- **Fix sketch**: refactor the env-map and server-entry assembly into a pure `build_server_entry(drive_root, api_key, dev_project_id, delegate) -> Value` and assert: bridge URL+key present iff `api_key.is_some()`; delegate vars present iff `delegate.is_some()` and `PERSONAS_DELEGATE_API_KEY` omitted for blank keys; `alwaysLoad == true`. Leave `find_mcp_binary` as an advisory note unless the probe-order is changed.
