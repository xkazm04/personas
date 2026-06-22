# Split Engine — Phase 3: the tool-execution bridge

Status: **Phase 3a implemented** · Phase 3b designed · 2026-06-22 · worktree `qwen-http-engine`

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

## Phase 3b — DESIGN (bridge the real MCP/connector tools)

Today the Claude CLI runs tools as **local MCP child processes** it owns
(`cli_mcp_config.rs` → `personas-mcp` + project MCP servers; credentials injected
as env). To give the remote model those same tools, **reuse that exact surface**
rather than re-implementing it:

1. **Spawn `personas-mcp` and speak MCP** (stdio JSON-RPC) from a small Rust MCP
   *client* (we only have the server today): `initialize` → `tools/list` →
   `tools/call`. This reuses every existing tool implementation + its DB/vault
   access verbatim. (Alternative — call the Rust tool impls in-process — couples
   the engine to internals and loses the process boundary; rejected.)
2. **Schema bridge:** convert each MCP tool's JSON-Schema into the OpenAI
   `tools[].function` shape; expose only the persona's declared/allowed tools.
3. **Credential boundary (the hard rule holds):** `personas-mcp` resolves
   credentials locally exactly as the CLI path does (`resolve_credential_env_vars`
   + `inject_design_context_credentials`). **Connector credentials never leave the
   machine** — only tool *args* and *results* cross to the model.
4. **Route:** model `tool_calls` → MCP `tools/call` → result → back to the model.

### Safety gates Phase 3b MUST add (not in 3a)
- **Remote-safe tool allowlist.** A prompt-injected remote model must not be able
  to call destructive tools (shell, file-write, repo push). Classify each tool
  `remote_safe: bool` (read-only/connector-scoped = yes; shell/fs/exec = no) and
  expose only safe ones to remote engines; dangerous tools stay on Claude or
  require the sandbox.
- **Sandbox for code-exec tools** (Firecracker/E2B/gVisor) — only when a tool
  actually runs untrusted code; out of scope until such a tool is exposed.
- **Egress allowlist** for http-type tools (extend 3a's SSRF guard to a per-team
  domain allowlist).
- **Per-run tool budget** (max calls / wall-time) on top of `MAX_TOOL_ITERS`.

### Data-residency note (decide per persona/team)
Even text-only Qwen already sends **prompt content** to Qwen's servers. Phase 3b
adds **tool args + tool results** to that flow. Connector *credentials* stay local.
Teams handling sensitive data should keep those personas on the local Claude
engine, or restrict which tools/results a remote engine may see.

## Files (3a)
- `engine/http_engine.rs` — `run_tool_loop`, `builtin_tool_schemas`,
  `execute_builtin_tool`, `http_get_guarded` + `is_blocked_ip`; dispatch in
  `run_http_execution`; `tools_enabled` param.
- `engine/runner/mod.rs` — seam passes `!tools.is_empty()`.
