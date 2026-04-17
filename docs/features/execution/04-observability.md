# Observability

How to inspect an execution after the fact: what ran, how long it
took, what it cost, why it failed. Four data sources work together:

```
persona_executions table  — the run record (status, tokens, cost, duration)
log file                  — chronological stdout/stderr text
execution_traces table    — structured trace tree (pipeline spans)
tool_usage table          — per-tool invocation counts
persona_events table      — event log (cascades, failures, DLQ)
```

All four share the same `execution_id` foreign key so you can join
across them freely.

## `persona_executions` table

The primary run record. Every execution writes one row, updated as
it transitions through phases.

```sql
CREATE TABLE persona_executions (
    id                      TEXT PRIMARY KEY,
    persona_id              TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    trigger_id              TEXT REFERENCES persona_triggers(id) ON DELETE SET NULL,
    use_case_id             TEXT,
    status                  TEXT NOT NULL DEFAULT 'queued',
                          -- queued | running | completed | failed | cancelled
    input_data              TEXT,        -- JSON user input
    output_data             TEXT,        -- JSON result (accumulated from user_message messages)
    claude_session_id       TEXT,        -- for warm resume
    log_file_path           TEXT,        -- path to execution log on disk
    execution_flows         TEXT,        -- JSON from execution_flow protocol messages
    model_used              TEXT,        -- e.g. "claude-sonnet-4-20250514"
    input_tokens            INTEGER DEFAULT 0,
    output_tokens           INTEGER DEFAULT 0,
    cost_usd                REAL DEFAULT 0,
    error_message           TEXT,
    duration_ms             INTEGER,
    tool_steps              TEXT,        -- JSON array of ToolCallStep
    retry_of_execution_id   TEXT,        -- if this is a healing retry
    retry_count             INTEGER DEFAULT 0,
    execution_config        TEXT,        -- frozen config snapshot
    log_truncated           INTEGER DEFAULT 0,
    started_at              TEXT,
    completed_at            TEXT,
    created_at              TEXT NOT NULL
);
CREATE INDEX idx_exec_persona ON persona_executions(persona_id, created_at DESC);
CREATE INDEX idx_exec_status ON persona_executions(status);
CREATE INDEX idx_exec_trigger ON persona_executions(trigger_id);
```

### Key queries

```sql
-- Last 10 executions of a persona
SELECT * FROM persona_executions
 WHERE persona_id = ?
 ORDER BY created_at DESC
 LIMIT 10;

-- Monthly spend (used by budget cap)
SELECT SUM(cost_usd) FROM persona_executions
 WHERE persona_id = ?
   AND created_at >= date('now', 'start of month');

-- Failed executions in the last hour (for alerting)
SELECT * FROM persona_executions
 WHERE status = 'failed'
   AND created_at >= datetime('now', '-1 hour');

-- Retry chains (healing history)
SELECT * FROM persona_executions
 WHERE retry_of_execution_id = ?
 ORDER BY retry_count ASC;
```

### Status lifecycle

```
queued → running → completed | failed | cancelled
            ↓
   Healing sees failed,
   spawns NEW execution with
   retry_of_execution_id = old.id
```

Terminal statuses are immutable. Retries get their own row.

### `tool_steps` JSON shape

Array of `ToolCallStep`:

```json
[
  {
    "name": "http_request",
    "args": { "url": "https://api.example.com/data", "method": "GET" },
    "result": "{\"ok\": true, \"data\": [...]}",
    "duration_ms": 1234,
    "success": true,
    "error": null,
    "started_at": "2026-04-17T10:30:00Z"
  },
  { ... }
]
```

Sorted chronologically. Useful for debugging "which tool call failed
and with what arguments".

### `execution_config` snapshot

The frozen config at execution start:

```json
{
  "model_profile": { "model": "claude-sonnet-4", ... },
  "engine": "cli",
  "max_budget_usd": 50.0,
  "max_turns": 30,
  "timeout_ms": 300000,
  "tool_names": ["http_request", "web_search", ...],
  "connector_names": ["github", "slack"],
  "continuation_mode": "fresh"
}
```

Used for:
- **Deterministic replay**: recreate the exact run with the same tools
- **Warm session matching**: `config_hash = hash(execution_config)` → session pool key
- **Audit**: what capabilities did this run have?

## Log file

**Path**: `{log_dir}/{execution_id}.log` (where `log_dir` comes from
the app settings; default `{app_data}/logs/executions/`)

**Format**: line-based, chronological:

```
[2026-04-17T10:30:00.123Z] [INFO] validate: persona loaded (id=p_xxx)
[2026-04-17T10:30:00.145Z] [INFO] credentials resolved (hints=[github, slack])
[2026-04-17T10:30:00.201Z] [INFO] memory injected (5 memories: 3 core, 2 active)
[2026-04-17T10:30:00.250Z] [INFO] spawning Claude CLI (model=claude-sonnet-4)
[2026-04-17T10:30:00.520Z] [STDOUT] {"user_message": "Starting analysis..."}
[2026-04-17T10:30:01.100Z] [TOOL_CALL] http_request started
[2026-04-17T10:30:02.340Z] [TOOL_RESULT] http_request success (1240 ms)
[2026-04-17T10:30:02.500Z] [STDOUT] {"emit_event": {"event_type": "deploy_complete", ...}}
[2026-04-17T10:30:02.510Z] [INFO] event created (id=evt_yyy, chain_trace_id=T_zzz)
[2026-04-17T10:30:03.700Z] [INFO] finalize: tokens_in=1200, tokens_out=450, cost=$0.0081
[2026-04-17T10:30:03.720Z] [INFO] status: completed
```

**IPC access**:
- `get_execution_log(id)` → full text (string)
- `get_execution_log_lines(id, offset, limit)` → paginated lines

**Truncation**: if a log file exceeds the max size, older content is
dropped and `log_truncated = 1` is set on the execution row. The UI
shows a banner "log was truncated" with the truncation marker.

## Execution traces

**Table**: `execution_traces` (schema in `engine/trace.rs`)

A structured span tree for each execution. Unlike the flat log file,
traces let you see **time spent per pipeline stage** and
**parent/child nesting** of operations.

### Span types

```rust
pub enum SpanType {
    PipelineStage,         // Validate / Spawn / Stream / Finalize
    CredentialResolution,  // per-tool credential lookup
    PromptAssembly,        // prompt building substeps
    ToolExecution,         // individual tool call
    ProviderFailover,      // when primary provider fails
    MemoryInjection,       // memory fetch + format
    EventCascade,          // event bus child execution spawn
}
```

### Span structure

```rust
pub struct TraceSpan {
    span_id: String,
    parent_span_id: Option<String>,
    span_type: SpanType,
    name: String,
    started_at: String,
    ended_at: Option<String>,
    duration_ms: Option<u64>,
    status: String,        // running | ok | error
    error: Option<String>,
    metadata: Option<serde_json::Value>,
    children: Vec<TraceSpan>,
}
```

### Chain trace correlation

Executions in a cascade share `chain_trace_id`. Query:

```sql
SELECT * FROM execution_traces
 WHERE chain_trace_id = ?
 ORDER BY created_at ASC;
```

The IPC `get_chain_trace(chain_trace_id)` returns all traces in the
cascade. The UI renders them as a tree: root execution at top, child
executions nested under the events that spawned them.

**Trace continuity break counter**: `trace_continuity_breaks` is a
global counter incremented whenever a chain event's payload JSON
can't be parsed to extract `chain_trace_id`. Monitor this to detect
plumbing bugs.

### Finding slow executions

```sql
-- top 10 slowest pipeline stages
SELECT span_type, name, AVG(duration_ms) AS avg_ms, COUNT(*) AS n
  FROM execution_traces_flattened  -- materialized view flattening children
 WHERE started_at >= datetime('now', '-24 hours')
 GROUP BY span_type, name
 ORDER BY avg_ms DESC
 LIMIT 10;
```

Common offenders: `CredentialResolution` when OAuth refreshes are
serialized, `PromptAssembly` when memory queries are unindexed,
`ToolExecution` on slow external APIs.

## Tool usage

**Table**: `persona_tool_usage`

```sql
CREATE TABLE persona_tool_usage (
    id               TEXT PRIMARY KEY,
    execution_id     TEXT NOT NULL REFERENCES persona_executions(id),
    persona_id       TEXT NOT NULL REFERENCES personas(id),
    tool_name        TEXT NOT NULL,
    invocation_count INTEGER DEFAULT 1,
    created_at       TEXT NOT NULL
);
```

Per-execution, per-tool counts. Aggregated by analytics queries:

```sql
-- Most-used tools in the last week
SELECT tool_name, SUM(invocation_count) AS total
  FROM persona_tool_usage
 WHERE created_at >= datetime('now', '-7 days')
 GROUP BY tool_name
 ORDER BY total DESC;

-- Persona with unused tools (candidate for cleanup)
SELECT pt.persona_id, ptd.name
  FROM persona_tools pt
  JOIN persona_tool_definitions ptd ON pt.tool_id = ptd.id
  LEFT JOIN persona_tool_usage u
    ON u.persona_id = pt.persona_id AND u.tool_name = ptd.name
    AND u.created_at >= datetime('now', '-30 days')
 WHERE u.id IS NULL;
```

## Event log

**Table**: `persona_events`

```sql
CREATE TABLE persona_events (
    id                 TEXT PRIMARY KEY,
    event_type         TEXT NOT NULL,
    source_type        TEXT NOT NULL,  -- persona | webhook | trigger | system | external_api
    source_id          TEXT,
    target_persona_id  TEXT,           -- direct routing, bypasses fan-out
    payload            TEXT,           -- JSON context (includes chain_trace_id)
    status             TEXT NOT NULL DEFAULT 'pending',
                      -- pending | processing | completed | skipped | failed | dead_letter | discarded
    error_message      TEXT,
    processed_at       TEXT,
    retry_count        INTEGER DEFAULT 0,
    use_case_id        TEXT,
    created_at         TEXT NOT NULL
);
```

### Event status taxonomy

| Status | Meaning |
|---|---|
| `pending` | Waiting for the bus tick to claim |
| `processing` | Claimed by a tick, being matched |
| `completed` | At least one subscriber fired (or no subscribers, normal) |
| `skipped` | Matched but cascade-guarded (persona already running) |
| `failed` | Spawn failed; will retry if retry_count < MAX |
| `dead_letter` | Retries exhausted, manual intervention needed |
| `discarded` | Filter or policy rejected the event |

### Queries

```sql
-- Dead letter inspection
SELECT event_type, source_id, error_message, retry_count, created_at
  FROM persona_events
 WHERE status = 'dead_letter'
 ORDER BY created_at DESC;

-- Cascade fan-out for a single root event
SELECT e1.id AS root, e2.id AS child
  FROM persona_events e1
  JOIN persona_events e2 ON json_extract(e2.payload, '$.chain_trace_id')
                         = json_extract(e1.payload, '$.chain_trace_id')
 WHERE e1.source_id = ?;
```

## Cost accounting

**Calculation** (`engine/cost.rs`):

```
cost_usd = (input_tokens / 1000) * input_cost_per_1k
         + (output_tokens / 1000) * output_cost_per_1k
```

Per-model rates hardcoded in `cost.rs`. Cache hits are priced
separately (usually 10% of input rate) — warm resume via session
pool can drop cost dramatically.

**Monthly spend query** (used by budget cap):
```sql
SELECT SUM(cost_usd) FROM persona_executions
 WHERE persona_id = ?
   AND created_at >= date('now', 'start of month');
```

**Breakdown by tool** (useful for cost attribution):
```sql
-- (join tool_usage with execution cost, prorate by invocation count)
SELECT tu.tool_name,
       COUNT(DISTINCT e.id) AS runs,
       SUM(e.cost_usd * tu.invocation_count /
           (SELECT SUM(invocation_count) FROM persona_tool_usage WHERE execution_id = e.id))
         AS attributed_cost
  FROM persona_executions e
  JOIN persona_tool_usage tu ON tu.execution_id = e.id
 WHERE e.created_at >= datetime('now', '-30 days')
 GROUP BY tu.tool_name
 ORDER BY attributed_cost DESC;
```

## Tauri events (real-time observability)

Frontend subscribes to these during execution:

| Event | Payload | Frequency |
|---|---|---|
| `execution-output` | `{ execution_id, line }` | Each stdout line |
| `execution-status` | `{ execution_id, status, error?, duration_ms?, cost_usd? }` | Phase transitions + finalize |
| `execution-completed` | `{ execution_id, status, duration_ms, cost_usd }` | Once per execution |
| `tool-call-started` | `{ execution_id, tool_name, args }` | Each tool call |
| `tool-call-completed` | `{ execution_id, tool_name, result, duration_ms, success }` | Each tool result |
| `manual-review-created` | `{ review_id, execution_id, title, severity }` | Review emitted |
| `event-created` | `{ event_id, event_type, source_id }` | Event emitted |
| `healing-event` | `{ execution_id, issue_id, title, severity, suggested_fix }` | Failure detected |
| `memory-created` | `{ memory_id, persona_id, title, category }` | Memory persisted |

## IPC commands (post-run observability)

| Command | Returns | Purpose |
|---|---|---|
| `get_execution(id)` | `PersonaExecution` | Full record |
| `list_executions(persona_id, limit?)` | `Vec<PersonaExecution>` | Persona history |
| `list_all_executions(limit?, status?, persona_id?)` | `Vec<GlobalExecutionRow>` | Global filter |
| `get_execution_log(id)` | `Option<String>` | Full log text |
| `get_execution_log_lines(id, offset?, limit?)` | `Vec<String>` | Paginated log |
| `get_execution_trace(id)` | `Option<ExecutionTrace>` | Structured trace |
| `get_chain_trace(chain_trace_id)` | `Vec<ExecutionTrace>` | Entire cascade |
| `get_dream_replay(id)` | `Option<DreamReplaySession>` | Frame-by-frame replay |
| `get_circuit_breaker_status()` | `CircuitBreakerStatus` | Provider health |
| `preview_execution(persona_id, input?)` | `ExecutionPreview` | Pre-run cost estimate |

## Healing integration

Failed executions emit `healing-event` with:
- `issue_id` — links to `healing_issues` table
- `severity` — info / warning / critical
- `suggested_fix` — optional LLM-generated remediation

The healing orchestrator (`engine/healing_orchestrator.rs`) listens,
analyzes the failure via `engine/ai_healing.rs`, and may spawn a
retry execution with adjusted config (different model, longer
timeout, relaxed budget). Retry executions set
`retry_of_execution_id` to the original.

## Files

| File | Role |
|---|---|
| `src-tauri/src/db/models/execution.rs` | `PersonaExecution`, `UpdateExecutionStatus`, `ToolCallStep` |
| `src-tauri/src/db/repos/execution/executions.rs` | CRUD + `get_monthly_spend` + idempotency |
| `src-tauri/src/db/repos/resources/tool_usage.rs` | Tool usage counters |
| `src-tauri/src/db/repos/communication/events.rs` | Event CRUD + dead letter |
| `src-tauri/src/engine/trace.rs` | `ExecutionTrace` + `TraceSpan` + trace persistence |
| `src-tauri/src/engine/cost.rs` | Token → USD calculation |
| `src-tauri/src/engine/logger.rs` | Execution log file rotation + truncation |
| `src-tauri/src/engine/ai_healing.rs` | Failure analysis + remediation suggestions |
| `src-tauri/src/engine/healing_orchestrator.rs` | Auto-retry coordination |
