# Bug Hunter — MCP Gateways & Tools

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: mcp-gateways-tools | Group: Credential Vault & Connectors

## 1. Pooled stdio sessions have no JSON-RPC id correlation — desynced session returns the wrong tool's result to the wrong caller
- **Severity**: Critical
- **Category**: Race condition / silent failure (response mismatch)
- **File**: `src-tauri/src/engine/mcp_tools.rs:1639` (`read_session_jsonrpc`), used by `execute_tool_on_session:991` and `fetch_tools_paginated_stdio:925`
- **Scenario**: A warm `PooledStdioSession` is keyed only by `credential_id`. Two agent executions (or an agent call + a UI `execute_mcp_tool`/`list_mcp_tools` preview) targeting the same credential run concurrently. `take_pooled_session` hands the live session to whichever task wins the `tokio::Mutex` first, but there is no guard that serializes a *whole request/response exchange* on one session, and the session pool mutex is released the moment a session is taken (`take_pooled_session` returns the owned struct). More dangerously, `read_session_jsonrpc` reads the *next* Content-Length-framed message off stdout and returns it with **zero check that its `id` matches the request's `id`**. `next_id` is incremented per request (line 988) precisely to correlate, but the response side ignores it. If a previous call timed out at the `MCP_SESSION_TIMEOUT` layer (line 842) the in-flight future is dropped *while the child keeps running*; the session is then killed only on the error path — but on a slow-but-eventually-successful server, a late response for request N can be sitting in the pipe when request N+1 reads, and N+1 happily parses N's payload.
- **Root cause**: Request/response correlation relies on strict FIFO ordering of a duplex pipe with no id verification and no single-flight lock around the exchange. MCP servers are permitted to emit notifications, log lines, or out-of-order responses; any extra framed message permanently shifts every subsequent read by one.
- **Impact**: Tool A's caller receives Tool B's result (cross-credential / cross-persona data leak and wrong-action execution), or every call on a poisoned warm session returns stale data until idle-eviction (45s). Because `is_error` is read from whatever JSON arrives, the mismatch is silent — logged as `success`.
- **Fix sketch**: After reading a response in `read_session_jsonrpc`/`execute_tool_on_session`, compare `resp["id"]` to the request id; on mismatch (or on any message lacking the expected id), drain/discard until it matches or kill the session and treat as `AppError::Internal` (forcing the stale-session retry path). Additionally serialize a full exchange per session, and on the `MCP_SESSION_TIMEOUT` path always `start_kill()` the session rather than returning it to the pool.

## 2. Gateway membership allows nested/cyclic gateways → unbounded recursion and stack overflow on tools/list and tools/call
- **Severity**: High
- **Category**: Edge case / latent failure (no recursion guard)
- **File**: `src-tauri/src/db/repos/resources/mcp_gateways.rs:45` (only self-ref blocked) → recursion at `src-tauri/src/engine/mcp_tools.rs:545` and `:668`
- **Scenario**: `add_member` rejects only `gateway_credential_id == member_credential_id`. Nothing prevents adding gateway B (itself `service_type == "mcp_gateway"`) as a member of gateway A, nor a cycle A→B→A. `list_tools` (line 541) and `execute_tool` (line 644) both detect the gateway connector and `Box::pin(recurse)` into each member's credential with no depth counter and no visited-set. A cycle recurses forever; a deep chain recurses to stack exhaustion.
- **Root cause**: The cycle/nesting invariant is enforced nowhere — not at insert time, not at traversal time. The recursion treats every member as a leaf credential.
- **Impact**: A privileged misconfiguration (or a compromised/over-eager admin flow) creating a gateway cycle hangs the worker thread and/or overflows the stack, crashing the tool-execution task; `list_mcp_tools` for that gateway never returns. Also unbounded fan-out amplifies one `tools/list` into N spawned MCP subprocesses.
- **Fix sketch**: In `add_member`, reject a member whose credential `service_type == "mcp_gateway"` (gateways may not nest), or pass a `visited: &mut HashSet<String>` / depth cap through the recursive `list_tools`/`execute_tool` calls and bail with `AppError::Validation` on revisit or depth > N.

## 3. Gateway tool calls are rate-limited by name only — member prefix bypasses the per-tool limiter, and the limiter keys on attacker-influenced strings
- **Severity**: High
- **Category**: Silent failure / trust boundary (rate-limit evasion)
- **File**: `src-tauri/src/engine/mcp_tools.rs:617` (`rate_key = format!("mcp_tool:{tool_name}")`) vs gateway recursion at `:668`
- **Scenario**: For a gateway call the rate limiter runs once with `tool_name = "arcade::search"` (line 617), then `execute_tool` recurses (line 668) with `real_tool = "search"` — but the recursive call carries the same `rate_limiter` and re-checks under key `mcp_tool:search`. So a single logical call consumes *two* different limiter buckets, and conversely the same underlying tool reached via two different member display names (`arcadeA::search`, `arcadeB::search`) gets independent quotas, defeating the intent of limiting load on one backend. The bucket key is built from the fully user-controlled tool name with no namespacing by credential, so distinct credentials sharing a tool name (`search`) contend on one global bucket — one noisy credential starves others.
- **Root cause**: Rate-limit key is `tool_name` alone, applied both pre- and post-gateway-resolution, with no credential dimension and no awareness that the gateway path double-dips.
- **Impact**: Inconsistent throttling: legitimate cross-credential traffic gets falsely rate-limited (shared bucket), while a hostile persona spreads load across member aliases to exceed the intended cap on one backend MCP server. Wasted limiter slots and confusing `RateLimited` errors.
- **Fix sketch**: Key the limiter on `(credential_id, real_tool_name)` after gateway resolution, and apply the check exactly once (skip the limiter on the recursive gateway hop, or move the check below gateway resolution).

## 4. `parse_tool_result` and `list_tools_on_session` silently swallow malformed/oversized content blocks — success theater on garbage responses
- **Severity**: Medium
- **Category**: Silent failure (dropped/mismatched results)
- **File**: `src-tauri/src/engine/mcp_tools.rs:1733` (`parse_tool_result` content filter_map), `:957` and `:1097` (tools list `filter_map(... .ok())`)
- **Scenario**: `parse_tool_result` builds `content` via `filter_map(|item| serde_json::from_value(item.clone()).ok())` and falls back to `unwrap_or_default()` (empty vec). A server returning a result whose `content` blocks don't match `McpToolContent` (e.g. only `image`/`resource` blocks, or a typed-content variant) yields an **empty content vec with `is_error: false`** — the caller sees a successful tool call that returned nothing. Likewise `list_tools_on_session` drops any tool whose JSON fails to deserialize into `McpTool`, so a malformed entry makes a tool silently vanish from the list (and thus becomes "not found" at `extract_tool_schema:1240`, which the agent reads as the tool not existing).
- **Root cause**: Lossy `.ok()` filtering treats parse failures as "this element doesn't exist" rather than as an error or a degraded-but-flagged result. No diagnostic when blocks are dropped.
- **Impact**: Agents act on empty-but-"successful" tool results; non-text tool output is invisible; tools intermittently disappear from discovery with no log. Hard-to-diagnose "the tool did nothing" reports.
- **Fix sketch**: When `content` is non-empty in the raw JSON but every block fails to parse, surface `is_error: true` with a "tool returned unrepresentable content" message; at minimum `tracing::warn!` the count of dropped blocks/tools so the loss is observable.

## 5. `validate_url_safety` is bypassed for SSE pagination/initialize requests' redirects only by luck, and stderr from MCP child is discarded — failures are undiagnosable
- **Severity**: Low
- **Category**: Latent failure / observability gap
- **File**: `src-tauri/src/engine/mcp_tools.rs:1593` (`.stderr(Stdio::null())`); error reporting at `spawn_stdio_session:315-316` (init response discarded as `_init_resp`)
- **Scenario**: Spawned MCP processes get `stderr(Stdio::null())` (line 1593), so when a server crashes on startup or prints a fatal error (bad env var, missing package, auth failure) the only signal the user gets is a generic `"MCP process closed stdout unexpectedly"` (line 1656) or a 120s `MCP_SESSION_TIMEOUT`. The `initialize` response is read and dropped (`let _init_resp` at line 316) without checking for a JSON-RPC `error` object, so a server that refuses to initialize (e.g. protocol-version mismatch, returns `{"error":{...}}`) is treated as initialized; the failure only manifests later as a confusing `tools/list` error.
- **Root cause**: stderr is null-routed and the init handshake response is never validated, so the two richest diagnostic channels (child stderr, init error) are thrown away.
- **Impact**: Operators and the JIT-auth/preview flows get opaque timeouts/`closed stdout` errors with no root cause; misconfigured MCP servers are nearly impossible to debug from the app. A server that errors on `initialize` wastes a full handshake + first-call before failing.
- **Fix sketch**: Capture child stderr (piped) and include the tail in spawn/IO error messages; inspect `_init_resp` for a top-level `error` and fail fast with that message instead of proceeding to `notifications/initialized`.
