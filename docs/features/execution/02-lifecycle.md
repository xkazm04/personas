# Execution lifecycle

The four phases of `run_execution()` in
`src-tauri/src/engine/runner.rs`. Every execution — manual, scheduled,
chained, webhook-driven — goes through the same pipeline:

```
 Validate → Spawn → Stream → Finalize
```

Each phase has a `TraceSpan` in `execution_traces` so you can see
exactly where time was spent after the fact.

## 1. Validate

**Span**: `Pipeline: Validate`

### Steps

1. **Open log file** at `{log_dir}/{execution_id}.log` — a
   `tracing`-compatible logger that tee's all subsequent phase output
   here. The file is bounded (truncation on overflow) and flushed on
   every line so you can `tail -f` during a run.

2. **Resolve workspace defaults** (`engine/config_merge.rs`):
   - Check `persona.group_id` → fetch group config if set
   - Cascade: persona-level > workspace-level > global
   - Produces `effective_config` with `max_budget_usd`, `max_turns`,
     `model`, `provider`, `base_url`, `auth_token`,
     `prompt_cache_policy`
   - Workspace also supplies `shared_instructions` appended to the
     system prompt

3. **Capability contract pre-check** (`engine/capability_contract.rs`):
   - Walks declared dependencies (required credentials, upstream
     personas, tools) and flags anything missing
   - Logs warnings as trace events
   - Does NOT fail the execution — informational only

4. **Credential resolution** (`engine/runner.rs` line ~264):
   - For each tool in the tool list:
     - Match tool name → connector.services[].toolName (primary)
     - Fallback: tool.requires_credential_type → connector.name
     - Fallback: `cred_repo::get_by_service_type()` first match
   - For each matched credential:
     - Decrypt fields via `engine/crypto.rs`
     - For OAuth creds: refresh via `oauth_refresh.rs` with per-cred
       lock (prevents concurrent-refresh races)
     - Inject as env vars, sanitizing names (`GITHUB_TOKEN`, etc.),
       blocking known dangerous names (`PATH`, `HOME`, `AWS_*` allowlist)
   - Build `cred_hints` — human-readable list of connector names
     to inject into the system prompt

5. **Design context credentials** (`inject_design_context_credentials`):
   - Parse `persona.design_context` JSON
   - For each connector mentioned in `useCases[].connectors` or
     `summary.connectors`, inject credentials **even if no tool matches
     it by name** — this lets generic `http_request` tools access
     any connector the design declares

### Failure handling

- If credential decryption fails → mark execution `Failed`, emit
  event, save trace, return early
- If workspace config is malformed → log warning, fall back to global
- If `trust_level == Revoked` → fail at the IPC boundary before
  entering runner

## 2. Spawn

**Span**: `Pipeline: Spawn Engine`

### Steps

1. **Parse model profile** (from `persona.model_profile` JSON):
   ```json
   {
     "model": "claude-sonnet-4-20250514",
     "provider": "anthropic",
     "base_url": null,
     "auth_token": null,
     "prompt_cache_policy": "ephemeral"
   }
   ```
   Resolve Ollama / LiteLLM overrides from app settings if set.

2. **Assemble prompt** (`engine/prompt.rs::assemble_prompt`):
   - Start with `persona.system_prompt`
   - Append workspace `shared_instructions`
   - Append `## Tools` section with descriptions from tool catalog +
     guidance metadata
   - Append `## Connectors` section listing available credential
     connector names from `cred_hints` + `metadata.llm_usage_hint`
     per connector
   - **Memory injection** (unless this is a session resume):
     - Query `mem_repo::get_for_injection()`:
       - Core memories (always injected, no limit)
       - Top N active memories sorted by (importance desc, recency desc)
     - Format as `## Agent Memory — Core Beliefs` and
       `## Agent Memory — Recent Learnings`
     - Track access via `mem_repo::increment_access_batch()`
     - Run lifecycle transitions (promote/archive) via
       `mem_repo::run_lifecycle()`
   - Append user input as the final message

3. **Execution config snapshot** — at this point, all config is
   frozen into an `ExecutionConfig` JSON stored on the execution row.
   Used for deterministic replay and warm-session config-hash matching.

4. **Working directory setup**:
   - Path: `{TEMP}/personas-workspace/{persona_id}`
   - Persists across executions (context reuse, warm resume)
   - Install Claude Code hooks sidecar if `PERSONAS_HOOKS_SIDECAR=1`
     is set in env

5. **Provider failover chain** (`engine/failover.rs`):
   - Build candidate list: primary provider + fallbacks
   - Evaluate BYOM policy (`engine/byom.rs`) — allowed models for
     this persona's tier/sensitivity
   - Each candidate attempted in order until one succeeds or all fail

6. **Warm session check** (`session_pool`):
   - Compute `config_hash` from the frozen `ExecutionConfig`
   - Look up pool: any completed execution with matching hash?
   - If yes + session not expired → spawn with `--resume {session_id}`
     (reuses prompt cache, huge cost savings on repeated runs)
   - If no → fresh spawn

7. **Spawn Claude CLI** (`engine/cli_process.rs`):
   - `CliProcessDriver` wraps `tokio::process::Child`
   - Args: model, tools JSON, prompt, max_turns, optional `--resume`
   - Env: all resolved credentials + any MCP_* variables
   - stdin/stdout: streaming pipes
   - stderr: logged to execution log file

### Output of this phase

- A running child process ready to stream
- `execution.status = running` (atomic transition from `queued`)
- Tauri event `execution-status` emitted to frontend

## 3. Stream

**Span**: `Pipeline: Stream Output`

The CLI stdout is read line-by-line in an async loop. Each line is
parsed, dispatched, and optionally emitted as a Tauri event.

### Line processing

```
 line = read_line(stdout)
   │
   ▼
 Log to {execution_id}.log file
   │
   ▼
 Parse as JSON (tolerant — non-JSON lines pass through as user_message)
   │
   ▼
 parser::extract_protocol_message_from_value()
   │
   ▼
 Match ProtocolMessage enum:
```

### Protocol messages

Each parsed message routes through `engine/dispatch.rs`:

| Message | Fields | Effect |
|---|---|---|
| `user_message` | `content` | Append to `output_data` accumulator |
| `emit_event` | `event_type`, `source_type`, `source_id`, `target_persona_id?`, `payload?`, `use_case_id?` | Create `persona_events` row with `chain_trace_id` set — cascades to subscribers |
| `agent_memory` | `[{title, category, content, importance, tags?}]` | Persist to `persona_memories`; will be injected in future runs |
| `manual_review` / `request_review` | `title`, `description`, `severity`, `context_data?`, `suggested_actions?` | Create `persona_manual_reviews` row (status=pending); OS notification + `MANUAL_REVIEW_CREATED` Tauri event |
| `execution_flow` | JSON | Store in `execution.execution_flows` — frontend renders as a flow diagram |
| `outcome_assessment` | `accomplished`, `summary`, … | Influences post-run status semantics (partial success vs complete failure) |
| `knowledge_annotation` | `graph_id`, `node_id`, … | Persist to knowledge graph |
| `tool_call` | `name`, `args` | Record `ToolCallStep`, dispatch via `tool_runner` |
| `tool_result` | `name`, `result`, `duration_ms` | Update the matching `ToolCallStep` |

### Tool call execution (the inner loop)

When the CLI asks to call a tool:

1. `tool_runner::invoke_tool_direct()`:
   - Resolve credentials (same tiered resolution as pre-flight)
   - Detect kind: script / API / automation / built-in
   - **Script**: `npx tsx {script_path}` with JSON stdin/stdout
   - **API**: substitute `$VAR` in curl template, `Command::new("curl")`
     (no shell — prevents injection)
   - **Automation**: delegate to `automation_runner` → external platform
   - **Built-in**: auto-pass or dispatch to engine-native handler
2. Capture stdout + stderr + exit code
3. Increment `tool_usage` counters
4. Emit `tool-call-started` / `tool-call-completed` Tauri events

### Tauri events emitted during streaming

| Event | Frequency | Purpose |
|---|---|---|
| `execution-output` | Each line | Live log streaming to UI |
| `execution-status` | Phase transition | Status indicator updates |
| `tool-call-started` | Each tool call | UI tool-call list |
| `tool-call-completed` | Each tool result | With duration + success/failure |
| `event-created` | `emit_event` | Chain trigger notification |
| `manual-review-created` | `manual_review` | Approval prompt |
| `memory-created` | `agent_memory` | Knowledge update indicator |

## 4. Finalize

**Span**: `Pipeline: Finalize`

### Steps

1. **Collect metrics**:
   - `input_tokens` / `output_tokens` from Claude CLI stream footer
   - `cost_usd` from `engine/cost.rs` (per-model rates × token counts)
   - `duration_ms` from wall-clock elapsed
   - Tool call counts into `persona_tool_usage`

2. **Finalize trace** (`engine/trace.rs`):
   - End all open spans
   - Mark trace as completed
   - Persist to `execution_traces` table
   - If cascade: set `chain_trace_id` for correlation with upstream

3. **Update execution record** via `persist_status_update()` with
   exponential backoff (3 retries):
   ```rust
   UpdateExecutionStatus {
       status: Completed | Failed,
       output_data: Some(json_result),
       error_message: Option<error_string>,
       duration_ms: Some(elapsed),
       log_file_path: Some(path),
       execution_flows: Some(flows_json),
       input_tokens, output_tokens, cost_usd,
       tool_steps: Some(vec![ToolCallStep, ...]),
       claude_session_id: Option<for_resume>,
       execution_config: Some(frozen_snapshot),
       log_truncated: false,
   }
   ```

4. **Emit final events**:
   - `execution-status` with terminal status
   - `execution-completed` with summary metrics
   - `healing-event` if failed (drives auto-healing retry system)

5. **Session pool**:
   - If CLI provided a `claude_session_id` AND status is `completed`:
     - Stash in `session_pool` keyed by `config_hash`
     - TTL: ~1 hour (configurable)
   - Next execution with matching hash reuses the session → prompt
     cache hit → huge cost + latency win

### Status transitions

```
  queued
     │
     ▼
  running
     │
     ├─► completed (normal exit, no error)
     │
     ├─► failed (CLI error, timeout, tool failure with no retry, …)
     │
     └─► cancelled (user clicked cancel OR shutdown signal)
```

Terminal statuses are immutable. If a `Failed` execution needs a
retry, a NEW execution row is created with
`retry_of_execution_id` pointing at the original and `retry_count`
incremented.

## Cascades inside this pipeline

Events emitted during the `Stream` phase:

```
 Stream phase
   │
   ▼ emit_event parsed
   │
   ▼ persona_events row created (status=pending, chain_trace_id=THIS_TRACE_ID)
   │
   ▼ [continue streaming THIS execution]
   │
   ▼ Finalize phase
   │
   ─────────────────────────────────────
   │
   [asynchronously, ~1s later]
   │
   ▼ event_bus_tick claims pending events
   ▼ matches subscribers + listeners
   ▼ engine.start_execution() for each matched persona
   │
   ▼ child executions inherit chain_trace_id
```

The chain trace links every execution in the cascade. Use
`get_chain_trace(chain_trace_id)` IPC to pull the whole tree.

## Timeout + cancellation

**Timeout**: `tokio::time::timeout(persona.timeout_ms, ...)` wraps the
entire `run_execution` call. On expiry:
- Send SIGTERM to CLI subprocess
- Await clean exit up to 5s
- SIGKILL if still running
- Mark execution `Failed` with error `"Timeout"`
- Emit `healing-event` so the auto-healer can retry

**Cancellation**: `cancel_execution` IPC sets a cancel flag on the
`SessionHandle`. The main loop checks it between stream reads and
exits cleanly. Partial `output_data` is preserved.

## Memory lifecycle (in-pipeline)

1. **Pre-run**: `get_for_injection` fetches memories to inject
2. **During run**: any `agent_memory` protocol message persists a new
   memory (with `source_execution_id` set to this run)
3. **Post-run**: `run_lifecycle`:
   - Active memories with `access_count >= threshold` → promote to core
   - Core memories with `last_accessed_at < idle_threshold` → archive
   - Archive memories older than N days → hard delete

This means every execution both **reads** memories (injection) and
**writes** memories (emission + lifecycle), creating a feedback loop
where the persona becomes better at its job over time.

## Files

| File | Role |
|---|---|
| `src-tauri/src/engine/runner.rs` | `run_execution` — the main loop |
| `src-tauri/src/engine/cli_process.rs` | Claude CLI subprocess driver |
| `src-tauri/src/engine/prompt.rs` | Prompt assembly, memory injection |
| `src-tauri/src/engine/parser.rs` | Protocol message extraction |
| `src-tauri/src/engine/dispatch.rs` | Protocol message → DB writes |
| `src-tauri/src/engine/tool_runner.rs` | Tool dispatch (script/API/automation) |
| `src-tauri/src/engine/config_merge.rs` | Cascaded config resolution |
| `src-tauri/src/engine/failover.rs` | Provider failover chain |
| `src-tauri/src/engine/trace.rs` | Trace span tree |
| `src-tauri/src/engine/cost.rs` | Token → USD |
| `src-tauri/src/engine/crypto.rs` | Credential decrypt + env sanitize |
| `src-tauri/src/engine/oauth_refresh.rs` | OAuth refresh with per-cred locks |
| `src-tauri/src/db/repos/execution/executions.rs` | Execution CRUD |
| `src-tauri/src/db/repos/resources/memories.rs` | Memory lifecycle |
