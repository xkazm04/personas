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
src-tauri/src/commands/execution/annotations.rs  (IPC: add_annotation, list_execution_annotations, list_persona_annotations, delete_annotation)
src-tauri/src/db/repos/execution/annotations.rs  (persona_execution_annotations CRUD)
```

### Execution annotations (tags, note, star)

`persona_execution_annotations` is a thin write-rarely layer over
`persona_executions` that lets users mark a run as significant.

- One row per `(execution_id, author)` — re-saving overwrites in place. The
  default author is `"user"`; future agents/companion writers can register
  under different author keys without clobbering the human's view.
- Fields: `tags` (JSON array of free-form strings — `regression`, `golden-example`,
  `investigate`, …), `note` (short free-text), `starred` (boolean).
- Cascade-deletes with the parent execution row (FK ON DELETE CASCADE).
- Frontend reads via the `useExecutionAnnotations(personaId)` hook
  (`src/hooks/agents/useExecutionAnnotations.ts`) which loads all rows once
  per persona and indexes by `execution_id` — cheap enough to power the
  activity-feed chip strip without per-row IPC.
- Activity feed: tag-chip strip on `ActivityList` rows, plus `tagFilter` and
  `starredOnly` filters on `ActivityFilters`.
- Execution detail: side panel hosts `AnnotationEditor` for save / clear.
- Execution list: when ≥ 2 rows have annotations with `starred=true`, a
  "Compare starred" affordance auto-selects the two most recently starred
  executions and opens the comparison view.

### Bulk re-run with cohort report

When iterating on a fix, users often need to verify against the actual
failing population — not a single hand-picked retry. The execution list
exposes a **Bulk re-run** mode (multi-select checkboxes) alongside the
existing Compare mode:

- Frontend entry points (`src/features/agents/sub_executions/components/list/`):
  - `BulkRerunToolbar.tsx` — selection toolbar with "Select all failed",
    "Since fix…" (datetime picker), and "Re-run N" action. The "Since fix…"
    panel quick-fills from the latest `persona_execution_annotations`
    `updated_at` (handy when an annotation marks the fix attempt).
  - `BulkRerunStrip.tsx` — stacked progress strip rendered while the cohort
    runs (per-row dot grid + percent + cancel).
  - `BulkRerunReport.tsx` — auto-opens on cohort completion. Surfaces
    success rate, recovered/regressed counts, mean cost and duration deltas,
    and per-row drill-down that hands an (original, new) pair to the
    existing `ExecutionComparison` view.
- Driver hook: `useBulkRerun()` in `libs/useBulkRerun.ts` fans out via
  `execute_persona` with `MAX_CONCURRENT = 3` workers, hydrates
  `input_data` per row from `get_execution`, and stamps an idempotency key
  per attempt (`bulk-rerun-<originalId>-<ts>`) so the runner's idempotency
  layer dedupes accidental double-clicks.
- A cohort regression is `origStatus = completed` AND `newStatus ∈
  {failed, cancelled, timeout}`; a recovery is the inverse direction.
  Both lists render their own row strip in the report.

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
3a. **Cross-team bleed guard**: team adoption wires intra-team subscriptions
   with `source_filter = "*"` (any source), so a teammate's event reaches the
   subscriber. In a multi-team / multi-repo deployment that wildcard also lets
   one team's event (e.g. `ai-bookkeeper`'s `release.published`) wake **every**
   team's matching persona — which then refuses the off-repo work and burns a
   `precondition_failed` run. The dispatcher (`background.rs`) now suppresses a
   wildcard match that crosses a team boundary: when both the subscriber and the
   event's source persona are anchored to `home_team_id`s that differ, the match
   is dropped (`bus::is_cross_team_wildcard_bleed`). Same-team chains, explicit
   `source_filter`s, and teamless personas are untouched. Look for `cross-team
   wildcard bleed suppressed` in the log.
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

**Jenkins-style `H` jitter.** The cron parser accepts Jenkins's hash
token to spread schedules across the allowed range instead of piling
up at `:00`. `H/15 * * * *` runs every 15 minutes but starts at a
deterministic per-trigger offset (FNV-1a hash of `trigger.id` modulo
15). Two personas with the same `H/15` cron land on different
minutes. Supported forms: `H`, `H/N`, `H(lo-hi)`, `H(lo-hi)/N`.
Implemented in `engine/cron.rs::expand_h_tokens`; previews and the
calendar pass `trigger.id` as `seed` so the UI matches the runtime
fire time.

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
