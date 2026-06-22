# Split Engine — Phase 3: the tool-execution bridge

Status: **Phase 3a + 3b implemented** (connector tools pending) · 2026-06-22 · worktree `qwen-http-engine`

## Why

Phase 1/2 made Qwen a **text-only** engine. A tool-less agent can think, transform,
classify — but can't *act* (Slack, Sheets, GitHub, the web), so it can't produce
the n8n-like scenarios non-dev teams need. Phase 3 lets a remote (HTTP) model
**request a tool, have the desktop execute it locally, and feed the result back** —
keeping connector credentials on the machine while the model drives.

## The loop (provider-agnostic)

```
messages = [user: assembled prompt]
loop (bounded):
  resp = POST /chat/completions { messages, tools, tool_choice: auto }   # non-streaming
  if resp.message.tool_calls:
    append assistant(tool_calls) to messages
    for each call: result = EXECUTE LOCALLY(call.name, call.args); append tool(result)
    continue
  else:
    return resp.message.content        # final answer
```

The novel part is **"EXECUTE LOCALLY"**: the model is remote, the tools are not.
Credentials and tool side-effects stay on the desktop; only **tool args (model→)**
and **tool results (→model)** cross the wire (a data-residency fact, see below).

## Phase 3a — SHIPPED (proves the loop + the egress boundary)

`engine/http_engine.rs`:
- `run_tool_loop(...)` — the bounded loop above (`MAX_TOOL_ITERS = 6`), non-streaming,
  emits `🔧 tool(args)` / `↳ result` as `EXECUTION_OUTPUT`, sums cost across turns,
  honors cancellation, returns an `ExecutionResult` (caller persists it).
- Dispatch: `run_http_execution` runs the loop when the persona is tool-enabled
  (`tools_enabled = !tools.is_empty()` at the seam); pure-text personas keep the
  Phase-1 streaming path. (The Phase-1 "text-only" hard guard is removed.)
- **Built-in safe toolset** (credential-free):
  - `get_current_time` — trivial; proves the loop deterministically.
  - `http_get(url)` — fetch a **public https** URL, with **SSRF egress guards**:
    https-only; resolve the host and **reject loopback / private / link-local /
    unspecified / unique-local** addresses; 10s timeout; 16 KB response cap.
- Live-verified on real Qwen: `live_qwen_tool_loop` — the model calls
  `get_current_time` and reports the time.

This is intentionally a **fixed** toolset — it proves the bridge + the egress
control without yet exposing the full (dangerous) connector surface.

## Phase 3b — IMPLEMENTED (in-process MCP bridge)

The MCP tool implementations turned out to be **callable in-process**:
`mcp_server::tools::call_tool(name, args, &McpDbPool)` (+ `list_tools()` for
schemas) is a pure dispatcher with no Tauri/`crate::` deps. So instead of
spawning `personas-mcp` and writing a stdio MCP client, we **reuse the exact
tool impls directly** — far simpler, same reuse + same DB/credential handling.

What shipped:
1. **Expose the module from the lib.** `mcp_server` was compiled only into the
   `personas-mcp` binary (`mod mcp_server;` in `mcp_bin.rs`); added
   `pub mod mcp_server;` to `lib.rs` and `pub mod tools;` so the engine can call
   it. (No `crate::` deps → compiles cleanly in the lib.)
2. **Schema bridge.** `list_tools()` (`{name, description, inputSchema}`) → OpenAI
   `tools[].function {name, description, parameters}`, intersected with the
   remote-safe allowlist, appended to the built-in schemas.
3. **Route.** Qwen `tool_calls` → `mcp_server::tools::call_tool(...)` against a
   read connection to the same DB (`open_pool(default_data_dir()/personas.db)`),
   result flattened to text and fed back.
4. **Remote-safe allowlist** (`REMOTE_SAFE_MCP_TOOLS`): read-only DB / knowledge /
   context / arena queries + `obsidian_vault_search`. **Withheld**:
   `personas_execute`, `*_write_*`, `drive_*`, `llm_delegate`, and connector tools
   (`gmail_*`/`gdrive_*`/`gcalendar_*`). A prompt-injected remote model cannot
   reach write/exec tools.

Live-verified: `live_qwen_mcp_tool` — Qwen called `personas_health`, the desktop
ran it against the real local DB (`{personas:{enabled:76,total:78},…}`), and Qwen
reported the count.

### Connector tools — IMPLEMENTED (opt-in, default OFF)
Connector tools (`gmail_*`/`gdrive_*`/`gcalendar_*`) are now exposable to remote
engines, gated behind the `qwen_connector_tools` setting (default OFF):
- At startup the desktop process exports `PERSONAS_API_KEY` +
  `PERSONAS_BRIDGE_URL` (lib.rs, where the system key is already bootstrapped) —
  the same vars the CLI path injects into the sidecar — so the engine's
  in-process `call_tool` → `bridge_proxy` reaches the :9420 credential proxy.
- When the opt-in is on, `CONNECTOR_TOOLS` are added to the catalog + routing
  (`tool_allowed(name, connectors_on)`). **Credential boundary holds**: the proxy
  decrypts + forwards the OAuth call locally; only tool *args* and *results* cross
  to Qwen.
- **Default OFF on purpose** — enabling sends connector *results* (e.g. email
  bodies) to Qwen. That's a per-team data-residency decision.

> Verification note: unlike earlier phases, the connector round-trip can't be
> autonomously tested in `cargo test` — the :9420 proxy runs only in the live app
> and needs configured Google OAuth credentials. The gating/allowlist logic is
> unit-tested (`connector_tools_gated_and_disjoint`); the live Gmail/Drive call is
> verified in the running app with the opt-in enabled.

### Remaining work
- **A UI toggle** for `qwen_connector_tools` (today flip it via `set_app_setting`).
- **Per-persona tool scoping** — today the safe set is global; should be
  intersected with the persona's *declared* tools.
- **Sandbox for code-exec tools** (Firecracker/E2B/gVisor) — only when a shell/fs
  tool is ever exposed to a remote engine; out of scope here.
- **Egress allowlist** for `http_get` (extend the SSRF guard to per-team domains)
  and a **per-run tool budget** (max calls / wall-time) beyond `MAX_TOOL_ITERS`.

### Data-residency note (decide per persona/team)
Even text-only Qwen already sends **prompt content** to Qwen's servers. The bridge
adds **tool args + tool results** to that flow (e.g. `personas_health` output).
Connector *credentials* stay local. Teams handling sensitive data should keep
those personas on the local Claude engine, or restrict which tools a remote
engine may see.

## Files (3a)
- `engine/http_engine.rs` — `run_tool_loop`, `builtin_tool_schemas`,
  `execute_builtin_tool`, `http_get_guarded` + `is_blocked_ip`; dispatch in
  `run_http_execution`; `tools_enabled` param.
- `engine/runner/mod.rs` — seam passes `!tools.is_empty()`.
