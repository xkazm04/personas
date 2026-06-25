# MCP Gateways & Tools — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: mcp-gateways-and-tools | Group: Credential Vault & Connectors
> Total: 5 | Critical: 0 | High: 2 | Medium: 3 | Low: 0

## 1. Transient gateway-member failure caches a degraded/empty tool list for 60s (silent capability loss)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / caching
- **File**: src-tauri/src/engine/mcp_tools.rs:617 (skip path 603-612, cache write 617)
- **Scenario**: An agent lists tools on an MCP gateway with members `arcade` + `github`. `arcade`'s `tools/list` transiently fails (OAuth hiccup / cold start). The loop logs "skipping and continuing", builds `merged` from `github` only, and calls `set_cached_tools(gateway_id, merged)`. For the next 60s every `list_tools` on that gateway returns the cached partial set — `arcade`'s tools have silently vanished even after it recovers. If *all* members fail, `merged` is empty and an **empty** tool list is cached for 60s, so the whole gateway looks toolless until TTL expiry.
- **Root cause**: The fan-out treats a member error as "skip and continue" and then caches whatever succeeded with the same 60s TTL as a complete result. The cache cannot distinguish "gateway genuinely has these tools" from "gateway had these tools the one time a member happened to be down".
- **Impact**: The agent silently loses access to a connector's tools for up to a minute after any transient member error; the persona may conclude the capability doesn't exist and abandon the task. Reads as a healthy (smaller) capability set, not an error.
- **Fix sketch**: Track whether any enabled member errored during the merge; if so, skip caching (or cache with a short, e.g. 2-5s, TTL) and never cache an empty merge when members exist. Optionally surface a `partial: true` marker so callers know the list is incomplete.
- **Value**: impact=6 effort=2

## 2. Gateway tools cache is never invalidated on membership change; `invalidate_tools_cache` is dead code and the doc-comment claims otherwise
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: misleading-contract / stale-cache
- **File**: src-tauri/src/engine/mcp_tools.rs:180 (dead fn) + :552-554 (false comment); writers in src-tauri/src/commands/credentials/mcp_gateways.rs:45,61,81
- **Scenario**: An operator calls `add_mcp_gateway_member` / `set_mcp_gateway_member_enabled` / `remove_mcp_gateway_member`. None of these invalidate the cache. The comment at list_tools_guarded states the gateway merge is "cached as a single entry, invalidated when members change" — but `invalidate_tools_cache` is `#[allow(dead_code)]` and has **no callers** anywhere in the tree. So after enabling a member its tools don't appear for up to 60s; after disabling one, the removed member's tools keep showing in `tools/list` for up to 60s (a subsequent `execute_tool` on it then fails `NotFound`, since membership is re-checked at call time).
- **Root cause**: The invalidation hook was written but never wired into the gateway mutation commands, and the source comment documents the intended (never-implemented) behavior as if it were real — classic tribal-knowledge drift.
- **Impact**: Confusing 60s window where the advertised tool set disagrees with reality; "I enabled it but the agent can't see it" support churn; a just-disabled member still appears callable. Low blast radius but high frequency (every membership edit).
- **Fix sketch**: Call `invalidate_tools_cache(gateway_credential_id)` from `add_member`/`remove_member`/`set_member_enabled` (and ideally for the member id too). Update or delete the misleading comment.
- **Value**: impact=4 effort=2

## 3. Model→connector argument validation silently disabled when the tool's `input_schema` is absent or malformed
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: trust-boundary / input-validation
- **File**: src-tauri/src/engine/mcp_tools.rs:1359-1376 (skip on no-schema 1363-1366, skip on invalid-schema 1368-1375)
- **Scenario**: A gateway exposes a third-party connector's tools to the agent. The server (which the gateway operator may not fully trust) declares a tool with **no** `inputSchema`, or a syntactically-broken one. `validate_arguments_against_schema` returns `Ok(())` in both cases (no-schema = "allow any"; invalid-schema = log `warn!` and skip). Model-supplied `arguments` then flow straight to `tools/call` with only the structural guards (1 MB / depth 20) applied. The function's own doc-comment and `execute_tool`'s ("Validates arguments against ... declared `input_schema`") imply enforcement that does not happen for these tools.
- **Root cause**: Permissive-by-default validation combined with a contract that reads as strict. A server can *disable* client-side validation simply by shipping a malformed schema — the validation gate is server-controlled.
- **Impact**: Unvalidated, model-controlled arguments reach an external connector action; downstream tools relying on the gateway to pre-validate get garbage. Not itself injection (args are JSON, not shelled), but it removes a guard the callers believe exists.
- **Fix sketch**: At minimum, distinguish the cases in telemetry and the result (mark "schema-unvalidated"). Consider failing closed for *malformed* schemas on gateway-exposed members, or applying a conservative default (reject unknown top-level types) when no schema is declared. Tighten the doc-comments to say validation is best-effort.
- **Value**: impact=6 effort=3

## 4. MCP env-name denylist enumerates specific vars but misses runner-config env families that re-introduce code-exec on the allowlisted runners
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: command-execution / defense-completeness
- **File**: src-tauri/src/engine/runner/env.rs:25-59 (BLOCKED_ENV_NAMES) consumed by src-tauri/src/engine/mcp_tools.rs:1421 (parse_env_vars) → :1694 (cmd.env)
- **Scenario**: `validate_mcp_command` carefully blocks command-arg RCE (`npx https://evil`, `docker --privileged`, …) precisely because npx/uv/bun/deno are "universal code-execution gateways". But the parallel `env_vars` channel is filtered only by name against a fixed denylist. The list blocks `NODE_OPTIONS`/`NODE_PATH`/`PYTHONPATH`/etc., yet omits runner-*config* env families that map back to those same vectors — notably `NPM_CONFIG_NODE_OPTIONS` (npm reads `npm_config_*` case-insensitively and forwards `--node-options` to the spawned node), plus `UV_*`, `BUN_*`, `DENO_*`, `CARGO_*` knobs on the other allowlisted runners. A credential (or a raw-field `healthcheck_mcp_preview` call, which never even persists) with `command: "npx legit-pkg"` + `env_vars: {"npm_config_node_options":"--require=/tmp/x.js"}` can thus re-arm the very `NODE_OPTIONS` vector the denylist exists to stop.
- **Root cause**: The denylist is an allowlist-by-omission for env names — any code-exec env that isn't individually enumerated is forwarded. `sanitize_env_name` only uppercases + strips punctuation; it has no notion of runner-config prefixes.
- **Impact**: Potential arbitrary code execution on the host using only an "allowed" runner, bypassing the command allowlist. Gated behind privileged credential/preview config, and the precise npm forwarding needs runtime confirmation — but it directly defeats a defense the code treats as load-bearing. (Critical if `NPM_CONFIG_*`/`UV_*`/`BUN_*` forwarding is confirmed.)
- **Fix sketch**: Switch env handling toward an allowlist (only forward names the connector schema declares), or extend the denylist to cover prefix families (`NPM_CONFIG_`, `UV_`, `BUN_`, `DENO_`, `PIP_`, `CARGO_`) and re-check after uppercasing. Add a test asserting `npm_config_node_options` is dropped.
- **Value**: impact=8 effort=4

## 5. Healthy warm pooled session is killed on any non-I/O (e.g. schema-validation) error, defeating pooling and causing spawn churn
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: resource-management / robustness
- **File**: src-tauri/src/engine/mcp_tools.rs:970-992 (match arms) + :1110 (finish_session)
- **Scenario**: A warm session is taken from the pool (`from_pool=true`) for a `tools/call`. The model's arguments fail `validate_arguments_against_schema` inside `execute_tool_on_session`, returning `AppError::Validation` *before/around* a pristine session (no `tools/call` bytes written). `is_io_error` only matches `AppError::Internal`, so the `(Err, true)` case falls to the `_ =>` arm → `finish_session(session, _, false)` → the perfectly healthy child process is dropped and killed. The next call is a cold spawn (~200-500ms). A model that alternates valid/invalid args, or spams invalid args (bounded only by the rate limiter), never benefits from the pool and drives continuous spawn/kill churn.
- **Root cause**: Pool-return is keyed on "did the call succeed" rather than "is the process still healthy". Validation failures (and other non-I/O errors) leave the process fully usable but are treated like a broken session.
- **Impact**: Loss of the pool's entire reason for existing under adversarial/buggy tool args; extra subprocess churn (CPU + handles) on the hot path. Not a data-leak — each session is exclusively owned, so no cross-talk.
- **Fix sketch**: Validate arguments *before* acquiring the pooled session, or in the match, return the session to the pool for non-I/O errors (the process is healthy) — only kill on `is_io_error`. Equivalent to adding an arm: `(Err(e), true) if !is_io_error(e) => { finish_session(session, cid, true).await; result }`.
- **Value**: impact=3 effort=3
