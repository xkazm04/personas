# MCP Gateways & Tools — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. In-app MCP stdio client uses LSP Content-Length framing; spec-conformant MCP servers use newline-delimited JSON
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/mcp_tools.rs:1851 (write) and :1874-1910 (read)
- **Scenario**: User adds an MCP credential with `command = "npx -y @modelcontextprotocol/server-filesystem /tmp"` (or any server built on the official TS/Python SDKs) and clicks the healthcheck, or a persona calls `list_mcp_tools`/`execute_mcp_tool`.
- **Root cause**: `write_session_jsonrpc` frames every request as `Content-Length: N\r\n\r\n{json}` and `read_session_message` parses headers until a blank line — that is LSP framing. The MCP 2024-11-05 stdio transport (the very `protocolVersion` this client sends) is newline-delimited JSON: SDK servers split on `\n` and `JSON.parse` each line, so the `Content-Length: …` header line throws a parse error server-side and no response is ever produced; the client then blocks in the header loop until the 60s timeout (`Timeout reading headers from MCP server`). Telling cross-check: the repo's own sidecar server (`src-tauri/src/mcp_server/mod.rs:19`, `handle_jsonrpc(line, …)`) is newline-framed — the two halves of this codebase disagree, so this client could not even talk to personas-mcp. The integration only works against servers that happen to implement legacy LSP framing.
- **Impact**: The entire stdio MCP tool path (healthcheck preview, tools/list, tools/call, and every gateway member using stdio) fails or hangs 60–120s against standard MCP servers; users see opaque timeout errors and conclude the credential is wrong.
- **Fix sketch**: Switch framing to newline-delimited JSON (`serde_json::to_string(payload) + "\n"` on write; `read_line` + parse per message on read), keeping the size cap by limiting line length. Optionally sniff Content-Length on the first read for backward compatibility with legacy servers.

## 2. Bridge API key and delegate Bearer token persisted in plaintext files inside the execution directory, never cleaned up
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/cli_mcp_config.rs:130-139, 175-180, 206-212, 238
- **Scenario**: A persona with connector tools (or a mixed-engine capability with an Ollama Cloud key) runs against a project directory. `install_mcp_sidecar` writes `PERSONAS_API_KEY` and `PERSONAS_DELEGATE_API_KEY` verbatim into `<exec_dir>/.claude/personas-mcp-config.json` and `<exec_dir>/.claude/settings.json`. The user later commits the repo, syncs it to Dropbox, or shares the folder.
- **Root cause**: Secrets that live encrypted in the credential vault are re-materialized as plaintext JSON on disk to hand them to a child process, and nothing in this module (or an execution-teardown path) deletes or redacts them afterward. The comment calls the bridge key "short-lived", but the file outlives the run indefinitely; the delegate API key is a durable third-party secret, not short-lived at all.
- **Impact**: Credential exfiltration: any later reader of the exec dir (git history, backup, another local user/process, a subsequent CLI run's own tools reading the workspace) obtains a live bridge key to the :9420 credential proxy and the user's hosted-LLM Bearer token — defeating the vault's encryption-at-rest guarantee.
- **Fix sketch**: Pass secrets via the spawned process's environment (the runner already controls the spawn) instead of the config file, or write the config to a per-run temp dir outside the project and delete it in execution teardown. At minimum, best-effort delete `personas-mcp-config.json` and scrub the env block from settings.json when the run finishes.

## 3. Gateway membership changes never invalidate the tools/list cache (the code's comment claims they do)
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/credentials/mcp_gateways.rs:45-87 (mutations); src-tauri/src/engine/mcp_tools.rs:201-206 (orphaned invalidator)
- **Scenario**: User lists a gateway's tools (populating the 60s cache), then disables or removes a member via `set_mcp_gateway_member_enabled`/`remove_mcp_gateway_member` — or adds a new one — and immediately lists tools again or lets a persona call one.
- **Root cause**: `list_tools_guarded` comments that the gateway cache entry is "invalidated when members change", but none of the four gateway mutation commands calls `invalidate_tools_cache` — the function is literally `#[allow(dead_code)]` with zero callers. The design assumed a wiring step that was never made.
- **Impact**: For up to 60s after a membership change, the tool surface lies: a removed/disabled member's tools are still advertised (calls then fail with `NotFound` because `execute_tool_guarded` re-reads members from the DB — listed-but-uncallable phantom tools handed to the LLM), and a newly added member's tools are invisible. In an agent loop this manifests as spurious tool-call failures right after the user "fixed" the gateway.
- **Fix sketch**: Call `crate::engine::mcp_tools::invalidate_tools_cache(&gateway_credential_id)` at the end of `add_mcp_gateway_member`, `remove_mcp_gateway_member`, and `set_mcp_gateway_member_enabled`, and drop the `#[allow(dead_code)]`.

## 4. Project-local mcpServers merge is a silent no-op — entries are written to a settings.json key Claude Code ignores
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/cli_mcp_config.rs:229-234 (merge target) vs :195-201 (the file's own CRITICAL comment)
- **Scenario**: User registers a project-local MCP server (e.g. `npx gitnexus setup` writes `mcpServers.gitnexus` into `<project>/.claude/settings.json`) and runs a persona against that project, expecting the docstring's promise that project-local servers are "surfaced" to the run.
- **Root cause**: `merge_project_local_mcp_servers` copies project entries into the exec-dir `settings.json` `mcpServers` map — but the CRITICAL comment 30 lines above states Claude Code does NOT load `mcpServers` from `.claude/settings.json`; only the `--mcp-config` file matters, and that file (built at :202-212) contains solely the `personas` entry. The feature was built against the abandoned load path and never moved when the `--mcp-config` fix landed.
- **Impact**: Project-local MCP servers silently never load: no error, no log at warn level, tests all pass (they test the merge helper, not the load path) — a classic built-but-unwired feature. Secondary caution for the eventual fix: these repo-controlled entries bypass `validate_mcp_command`'s binary allowlist/metacharacter checks, so wiring them into `--mcp-config` verbatim would let a cloned repo's `.claude/settings.json` execute arbitrary commands on every persona run; the merge must gain the same validation when it becomes live.
- **Fix sketch**: Merge project-local entries into the `mcp_config` object written to `personas-mcp-config.json` (personas entry inserted last so it still wins), and run each project entry's `command` through `validate_mcp_command`-equivalent screening before inclusion; otherwise delete the merge and its docstring claim.

## 5. Dead pooled session double-counts pool_misses, skewing pool metrics and average spawn latency
- **Severity**: Low
- **Category**: bug
- **File**: src-tauri/src/engine/mcp_tools.rs:250-254 (inside `take_pooled_session`) and :947-960 / :1014-1027 (callers)
- **Scenario**: A pooled MCP process exits while idle (crash, npx child recycled). The next `list_tools`/`execute_tool` finds the corpse: `take_pooled_session` hits the `try_wait` non-running arm, increments `pool_misses`, returns `None` — and the caller, seeing `None`, increments `pool_misses` again before spawning.
- **Root cause**: Miss accounting lives in two layers with no ownership convention: the helper counts the dead-process case, the callers count every `None`.
- **Impact**: `StdioPoolMetrics.pool_misses` is inflated (one real cold spawn counted twice) and `avg_spawn_latency_ms = total_spawn_us / misses` is correspondingly understated, so the observability panel this endpoint feeds under-reports spawn cost exactly when sessions are dying — the moment an operator most needs accurate numbers.
- **Fix sketch**: Make the callers the single owner of miss accounting: delete the `pool_misses.fetch_add` inside `take_pooled_session`'s dead-process arm (keep the kill), or count there exclusively and drop the caller increments.
