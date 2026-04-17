# Execution — Technical Documentation

> How a persona actually runs. From the moment a trigger fires (or a
> user clicks "Run"), through credential resolution, prompt assembly,
> CLI spawn, streaming output, chain cascades, and finalization —
> this pillar covers the runtime.

An **execution** is a single run of a persona. It's a row in the
`persona_executions` table, a subprocess spawned via the Claude CLI,
a log file on disk, and a tree of trace spans in `execution_traces`.
Executions can chain (one persona emits an event that triggers
another), pause for human approval, and accumulate cost and token
counts.

The system has four layers worth documenting separately:

| Doc | Scope | Read when… |
|---|---|---|
| [01-entry-points.md](01-entry-points.md) | The 10 ways an execution can start: manual, schedule, webhook, event, polling, chain, file/clipboard/app-focus, composite | Adding a new trigger type or debugging "why didn't my scheduled run fire" |
| [02-lifecycle.md](02-lifecycle.md) | Validate → Spawn → Stream → Finalize — the complete pipeline inside `run_execution` | Touching the engine, adding a pipeline stage, or debugging a failed execution |
| [03-chaining-and-approval.md](03-chaining-and-approval.md) | Event bus, chain triggers, cascade guards, manual review protocol | Building multi-persona workflows or adding a new approval flow |
| [04-observability.md](04-observability.md) | `persona_executions` table, log files, execution traces, tool usage, cost tracking | Debugging a failed run, analyzing cost, or building a metrics dashboard |

## TL;DR architecture

```
 Entry point
   │
   ▼
┌──────────────────────────────────────────────────────────────────┐
│  Tauri command: execute_persona                                   │
│  (or scheduler tick / webhook handler / event bus tick)           │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │  VALIDATE           │
                  │  • fetch persona    │
                  │  • check trust      │
                  │  • check budget     │
                  │  • resolve creds    │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │  SPAWN              │
                  │  • parse model      │
                  │  • assemble prompt  │
                  │  • inject memories  │
                  │  • spawn Claude CLI │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │  STREAM             │
                  │  • parse protocol   │
                  │  • emit events      │
                  │  • create reviews   │
                  │  • persist memory   │
                  │  • cascade triggers │────┐
                  └──────────┬──────────┘    │ emit_event →
                             │               │ spawns child executions
                             ▼               │
                  ┌─────────────────────┐    │
                  │  FINALIZE           │    │
                  │  • collect metrics  │    │
                  │  • save trace       │    │
                  │  • update record    │◀───┘
                  │  • emit Tauri evts  │
                  └─────────────────────┘
```

## Rust surface

```
src-tauri/src/commands/execution/executions.rs   (IPC: execute_persona, cancel, list, get, …)
src-tauri/src/engine/runner.rs                   (main execution pipeline: run_execution)
src-tauri/src/engine/background.rs               (scheduler + event bus background loops)
src-tauri/src/engine/bus.rs                      (event matching logic)
src-tauri/src/engine/webhook.rs                  (HTTP webhook server on port 9420)
src-tauri/src/engine/scheduler.rs + cron.rs      (trigger time computation)
src-tauri/src/engine/prompt.rs                   (prompt assembly + memory injection)
src-tauri/src/engine/cli_process.rs              (Claude CLI subprocess driver)
src-tauri/src/engine/parser.rs                   (protocol message extraction from stdout)
src-tauri/src/engine/dispatch.rs                 (protocol message → DB write)
src-tauri/src/engine/chain.rs                    (chain-trigger cascade evaluation)
src-tauri/src/engine/trace.rs                    (execution trace span tree)
src-tauri/src/engine/cost.rs                     (token → USD)
src-tauri/src/engine/config_merge.rs             (cascaded config resolution)
src-tauri/src/engine/tool_runner.rs              (tool dispatch: script/API/automation)
src-tauri/src/engine/automation_runner.rs        (external platform invocation)
src-tauri/src/db/repos/execution/executions.rs   (execution CRUD + queries)
```

## Relation to other pillars

```
1. Templates  →→→→  2. Persona  →→→→  3. Execution
(static design)     (static config)    (dynamic run)

 JSON in git         Row in personas    Row in persona_executions
 Adoption            Promoted from      Spawned by trigger or
 flow                AgentIr            manual UI
                                        
                                        ↓
                              Streams tool calls,
                              emits events, can
                              chain to other personas
```

This doc set covers pillar 3. For pillar 1 see
[templates/](../templates/README.md). For pillar 2 see
[personas/](../personas/README.md).

## Gotchas that burn time

1. **`execute_persona` creates the execution row synchronously but
   spawns the engine asynchronously.** The Tauri command returns a
   `PersonaExecution` with status `"queued"` almost immediately. The
   actual CLI work happens in a background task. Frontend polls via
   `get_execution` or subscribes to `execution-status` events.
2. **The scheduler tick runs every ~10s, the event bus tick every ~1s.**
   If your schedule trigger looks like it fires up to 10s late, that's
   why. Raise the frequency in `background.rs` if you need tighter
   cadence (but watch for lock contention).
3. **Cascades have a guard**: if a persona is already running, an event
   that would trigger it again gets **skipped**. This prevents
   runaway loops when persona A emits events that B listens to and B
   emits events that A listens to. Check the log for `cascade guard`
   messages if a trigger mysteriously doesn't fire.
4. **Dead-letter queue for failed events**: `persona_events.status`
   moves `pending → processing → completed/failed/dead_letter` with a
   retry counter. Events hit `dead_letter` after too many retries.
   Query `WHERE status = 'dead_letter'` to find stuck events.
5. **Trace IDs correlate chains**: every execution has a `trace_id`;
   events in a cascade share a `chain_trace_id` so you can query the
   whole cascade tree. Use `get_chain_trace` IPC to pull it.
6. **Warm session reuse**: if `config_hash` matches a previous
   completed execution's `claude_session_id`, the CLI is invoked with
   `--resume {session_id}` to reuse the prompt cache. Huge cost
   savings on repeated runs with identical config. See `session_pool`
   handling in `runner.rs`.

## Common operations

### Fire an execution manually

Frontend: `invoke('execute_persona', { persona_id, input_data })`.

Backend path: `executions.rs::execute_persona` →
`engine.start_execution` → background task runs `run_execution`.

### Schedule a recurring run

1. Create a `persona_triggers` row with `trigger_type = 'schedule'`
   and `config = { "cron": "0 9 * * 1-5" }`.
2. The scheduler loop sets `next_trigger_at` on insert.
3. Every ~10s, `TriggerSchedulerSubscription.tick()` claims all
   overdue rows and fires them.

### Chain persona B after persona A

1. Create a `persona_triggers` row on persona B with
   `trigger_type = 'chain'` and
   `config = { "source_persona_id": "<A>", "condition": { "condition_type": "success" } }`.
2. When A's execution completes, the chain evaluator finds matching
   chain triggers and emits events that fire B.

Alternative (looser coupling): persona A emits a custom event type;
persona B has an `event_listener` trigger on that type. Same result,
but A doesn't need to know about B.

### Cancel a running execution

Frontend: `invoke('cancel_execution', { id, caller_persona_id })`.

Backend: marks execution as `cancelled`, sends SIGTERM to the CLI
subprocess, rolls back any in-progress DB updates.

## Anti-patterns

1. **Don't call the Claude CLI directly from a Tauri command.** Always
   go through `execute_persona`. The command path does credential
   resolution, budget checks, trust validation, idempotency
   deduplication, trace creation, session pool integration, and
   healing event emission — none of which you want to reimplement.

2. **Don't persist state in the persona's working directory.** The
   `{TEMP}/personas-workspace/{persona_id}` dir **persists across
   executions** intentionally (for context reuse and warm resumption),
   but is NOT durable storage. Cleanups can wipe it. Use
   `persona_memories` for knowledge and `persona_messages` /
   explicit DB writes for anything that must survive restart.

3. **Don't poll executions tightly**. The frontend should subscribe
   to `execution-status` / `execution-output` Tauri events instead of
   calling `get_execution` in a loop. Polling works but wastes IPC
   and misses sub-second updates.

4. **Don't bypass the event bus for persona-to-persona signalling.**
   Directly invoking persona B from persona A's handler breaks the
   trace correlation (no `chain_trace_id`), skips cascade guards, and
   makes the flow invisible in the observability surfaces. Emit an
   event, use a chain trigger, or add an event_listener.

## Related docs

- [../templates/07-adoption-answer-pipeline.md](../templates/07-adoption-answer-pipeline.md)
  — where adoption answers get applied to the AgentIr before it
  becomes a persona (happens in the promote phase, before execution).
- [../personas/02-capabilities.md](../personas/02-capabilities.md) —
  what each persona capability surface means at runtime.
- [../personas/03-trust-and-governance.md](../personas/03-trust-and-governance.md)
  — how trust level, budget, and turn caps gate execution.
