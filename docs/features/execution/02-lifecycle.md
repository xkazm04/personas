# Execution lifecycle

The four phases of `run_execution()` in
`src-tauri/src/engine/runner/mod.rs` (the runner was split from a flat
`runner.rs` into a module dir — `mod.rs` plus `credentials.rs`, `env.rs`,
`stages.rs`, `team_context.rs`, `globals.rs`). Every execution — manual,
scheduled, chained, webhook-driven, or a simulation — goes through the same
pipeline:

```
 Validate → SpawnEngine → StreamOutput → FinalizeStatus
```

Each phase has a `TraceSpan` in `execution_traces` (the four stage keys are
`validate` / `spawn_engine` / `stream_output` / `finalize_status`) so you can
see exactly where time was spent after the fact.

> **Before the pipeline: admission.** `execute_persona` → `execute_persona_inner`
> creates the row synchronously, then hands off to `start_execution` →
> `start_execution_with_priority`, which runs an **admission tracker**: the run
> either starts immediately or is **enqueued** with a priority under the
> persona's `max_concurrent`. A `queue-status` Tauri event surfaces backpressure.
> So "spawned a background task" is really "admitted or queued." Simulations
> (`simulate_use_case` → `is_simulation`) run the same pipeline but bypass the
> capability `enabled` gate and the `needs_credentials` setup gate, and flag the
> row so metrics/notifications skip it.

## 1. Validate

**Span**: `Pipeline: Validate`

### Steps

1. **Open log file** at `{log_dir}/{execution_id}.log` — a
   `tracing`-compatible logger that tee's all subsequent phase output
   here. The file is bounded (truncation on overflow) and flushed on
   every line so you can `tail -f` during a run.

2. **Resolve workspace defaults** (`engine/config_merge.rs`):
   - Check `persona.home_team_id` → fetch the home team's workspace config
     if set (replaced the retired `group_id`)
   - Cascade: persona-level > home-team workspace > global
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

4. **Credential resolution** (`engine/runner/credentials.rs`):
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
     "model": "claude-sonnet-4-6",
     "provider": "anthropic",
     "base_url": null,
     "auth_token": null,
     "prompt_cache_policy": "ephemeral"
   }
   ```
   Resolve Ollama / LiteLLM overrides from app settings if set. **Model
   resolution has three layers beyond this profile:** (a) a per-capability
   `model_override` on the active use case — either a tier slug (`haiku` /
   `opus`) or a full profile — resolved by `resolve_use_case_model_override`;
   (b) a `DEFAULT_CAPABILITY_MODEL` fallback (sonnet) when a capability sets no
   override; (c) a declarative persona-level routing cascade
   (`engine/model_routing.rs::resolve_for_persona`) applied only when no explicit
   model is set. See `engine/tier.rs` for the tier slugs.

2. **Assemble prompt** (`engine/prompt/mod.rs::assemble_prompt`):
   - Start with `persona.system_prompt` (with `{{param.KEY}}` placeholders
     resolved from `persona.parameters` by `prompt::variables::replace_variables`
     — the recipe-parameterization bridge, `engine/recipe_parameters.rs`)
   - Append home-team `shared_instructions` + the `team_context` alignment block
   - Append `## Tools` section with descriptions from tool catalog +
     guidance metadata
   - Append `## Connectors` section listing available credential
     connector names from `cred_hints` + `metadata.llm_usage_hint`
     per connector
   - **Memory injection** (unless this is a session resume):
     - Query `mem_repo::get_for_injection_v2()` — selects the `core` / `active`
       / `working` tiers (the 4th tier, `archive`, is never injected)
     - Also inject **team memory** via `team_memory_repo::get_for_injection`
       (home-team-scoped, top 15) when the persona has a `home_team_id`
     - Rendered under a `## Your Memory System` preamble (importance 1-5,
       auto-promotion `working → active → core`) — the old
       `## Agent Memory — Core Beliefs` / `— Recent Learnings` headers are gone
     - Track access via `mem_repo::increment_access_batch()`
     - Run lifecycle transitions (promote/archive) via
       `mem_repo::run_lifecycle()`
   - Append user input as the final message

3. **Execution config snapshot** — at this point, all config is
   frozen into an `ExecutionConfig` JSON stored on the execution row.
   Used for deterministic replay and warm-session config-hash matching. The
   `config_hash` now folds in `structured_prompt` + an
   `active_capabilities_fingerprint`, so toggling a capability invalidates a
   stale warm session rather than silently reusing it.

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

The CLI stdout is read line-by-line in an async loop. Each line becomes a
`StructuredExecutionEvent` (assistant text, tool-use, tool-result, run-result
footer) emitted over the **single `execution-event` channel**, and is also
scanned for protocol messages that drive DB writes.

Two dispatch mechanisms coexist:

- **Virtual-tool interception (primary).** The persona calls named tools
  `emit_memory` / `emit_message` / `emit_event` / `request_review` /
  `raise_incident` / `propose_backlog`; the runner intercepts these tool calls
  (`runner/mod.rs`) and routes them to the same DB writes below. This is the
  reliable path ("more reliable than JSON lines").
- **JSON-line protocol (legacy, still parsed).** Lines matching `PROTOCOL_KEYS`
  in `parser.rs` are extracted and dispatched. Both mechanisms end at
  `engine/dispatch.rs`.

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
| `manual_review` / `request_review` | `title`, `description`, `severity`, `context_data?`, `suggested_actions?` | Create `persona_manual_reviews` row (status=pending); OS notification (`dispatch.rs::notify_manual_review`) + `execution-review-request` Tauri event |
| `persona_action` | JSON | Record a structured persona action step |
| `execution_flow` | JSON | Store in `execution.execution_flows` — frontend renders as a flow diagram |
| `knowledge_annotation` | `graph_id`, `node_id`, … | Persist to knowledge graph |
| `raise_incident` / `resolve_incident` | `title`, … / incident id | File / close a blocker in the Incidents inbox |
| `propose_improvement` / `propose_backlog` | JSON | Queue a backlog idea (backpressure-capped) |
| `kpi_measurement` | JSON | Record a KPI datapoint |

`tool_call` / `tool_result` are **not** protocol messages — they arrive from the
CLI stream as `AssistantToolUse` / `Result` line types and are surfaced as
`StructuredExecutionEvent`s (which also feed the `ToolCallStep` accounting).
Similarly, `outcome_assessment` is parsed separately from the accumulated
assistant text via `parse_outcome_assessment` (`business_outcome` taxonomy:
`value_delivered` / `no_input_available`, unknown values rejected), not through
this dispatch table.

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
4. The tool-use and tool-result surface to the UI as `StructuredExecutionEvent`
   variants on the `execution-event` channel (there are no separate
   `tool-call-*` events)

### Tauri events emitted during streaming

The canonical event names live in `engine/event_registry.rs`. Tool calls,
tool results, assistant text, and the run-result footer are **all** delivered as
`StructuredExecutionEvent` variants over the single `execution-event` channel —
there are no per-tool or per-message Tauri events. The events actually emitted
during a run:

| Event | Frequency | Purpose |
|---|---|---|
| `execution-output` | Each line | Live log streaming to UI |
| `execution-status` | Phase transition + finalize | Status indicator updates |
| `execution-event` | Each structured event | Assistant text, tool-use, tool-result, run-result footer (see `terminalEvents.ts`) |
| `execution-progress` | Subagent / long-step progress | Progress ticks |
| `execution-heartbeat` | Periodic | Liveness while streaming |
| `execution-review-request` | `request_review` | Human-approval prompt |
| `execution-trace-span` / `execution-trace` | Span open/close + finalize | Live trace tree |
| `healing-event` | On failure | Drives auto-healing retry |

Chain fan-out is carried on the separate `event-bus` path, not a per-event Tauri
emit.

## 4. Finalize

**Span**: `Pipeline: Finalize Status`

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
   - `execution-status` with the terminal status + summary metrics
     (`duration_ms`, `cost_usd`) — there is no separate `execution-completed`
     event; the terminal `execution-status` IS the completion signal
   - a final `execution-event` (run-result footer) + `execution-trace` close
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

1. **Pre-run**: `get_for_injection_v2` fetches `core`/`active`/`working`
   memories to inject (plus home-team memory via `team_memory_repo`)
2. **During run**: an `emit_memory` virtual-tool call (or legacy `agent_memory`
   protocol message) persists a new memory (with `source_execution_id` set to
   this run)
3. **Post-run**: `run_lifecycle`:
   - `working`/`active` memories with `access_count >= threshold` → promote
   - Idle higher-tier memories → archive
   - Archive memories older than N days → hard delete

This means every execution both **reads** memories (injection) and
**writes** memories (emission + lifecycle), creating a feedback loop
where the persona becomes better at its job over time.

## Files

| File | Role |
|---|---|
| `src-tauri/src/engine/runner/mod.rs` | `run_execution` — the main loop |
| `src-tauri/src/engine/runner/credentials.rs` | Tiered credential resolution + OAuth refresh + env injection |
| `src-tauri/src/engine/runner/env.rs` | Execution env assembly (creds, `CODEBASE_ROOT_PATH`, …) |
| `src-tauri/src/engine/runner/stages.rs` | Pipeline stage span keys |
| `src-tauri/src/engine/cli_process.rs` | Claude CLI subprocess driver |
| `src-tauri/src/engine/prompt/mod.rs` | Prompt assembly, memory injection |
| `src-tauri/src/engine/recipe_parameters.rs` | `{{param.*}}` recipe-parameterization bridge |
| `src-tauri/src/engine/model_routing.rs` + `tier.rs` | Declarative model routing + tier slugs |
| `src-tauri/src/engine/parser.rs` | Protocol message extraction (`PROTOCOL_KEYS`) |
| `src-tauri/src/engine/dispatch.rs` | Protocol / virtual-tool message → DB writes |
| `src-tauri/src/engine/tool_runner.rs` | Tool dispatch (script/API/automation) |
| `src-tauri/src/engine/config_merge.rs` | Cascaded config resolution |
| `src-tauri/src/engine/failover.rs` | Provider failover chain |
| `src-tauri/src/engine/trace.rs` | Trace span tree |
| `src-tauri/src/engine/cost.rs` | Token → USD |
| `src-tauri/src/engine/crypto.rs` | Credential decrypt + env sanitize |
| `src-tauri/src/engine/oauth_refresh.rs` + `oauth_refresh_lock.rs` | OAuth refresh with per-cred locks |
| `src-tauri/src/db/repos/execution/executions.rs` | Execution CRUD |
| `src-tauri/src/db/repos/core/memories.rs` | Memory lifecycle (`get_for_injection_v2`) |
