# Entry points — how an execution starts

Ten ways a `persona_executions` row gets created and an engine task
spawned. Each path converges on the same `engine.start_execution()`
call, but the pre-flight is different for each.

## The ten entry points

| Entry | Source | Frequency |
|---|---|---|
| **Manual** | User clicks "Run Now" in the UI | On-demand |
| **Schedule** | `persona_triggers` with `trigger_type = schedule` | Cron-driven |
| **Webhook** | HTTP POST to `/webhook/{trigger_id}` | External system |
| **Polling** | `persona_triggers` with `trigger_type = polling` checks a URL | Interval-driven |
| **Event listener** | Trigger fires when matching `PersonaEvent` arrives | Event-bus-driven |
| **Chain** | `source_persona_id` completes with condition met | Upstream execution |
| **File watcher** | Filesystem path changes (desktop) | OS-driven |
| **Clipboard** | Clipboard content changes (desktop) | Poll-driven |
| **App focus** | Target app comes to foreground (desktop) | Poll-driven |
| **Composite** | Multiple events within a time window | Aggregated |

All ten converge on `PersonaEvent` creation → event bus matches → fires
the subscribed persona via `engine.start_execution()`.

## Manual (UI button)

**Entry**: `invoke('execute_persona', { persona_id, input_data? })`
**Handler**: `src-tauri/src/commands/execution/executions.rs::execute_persona` (async Tauri command, line ~82)

### Pipeline stages

1. **Initiate** — create a `PipelineCtx` for tracing
2. **Validate**:
   - Fetch persona by ID
   - Check `trust_level != Revoked` (else fail)
   - Check `max_budget_usd` vs `get_monthly_spend()` (else fail)
   - Parse `model_profile` JSON
3. **CreateRecord**:
   - Call `repo::create_with_idempotency()` → `persona_executions` row
     with status `queued`
   - Idempotency key (optional) prevents duplicate spawns from retries
4. **SpawnEngine**:
   - Fetch tools + inject virtual automation tools
   - Parse input_data (JSON first; fall back to `{ user_input: s }`)
   - Check session pool for warm resume candidate
   - Call `engine.start_execution()` (async spawn into background)
   - Advance trigger schedule if `trigger_id` was supplied
5. **Return** — `PersonaExecution` row (frontend polls or subscribes)

### Dry run ("Test run")

**Entry**: `invoke('dry_run_persona', { persona_id, input_data?, use_case_id? })`
**Handler**: `src-tauri/src/commands/execution/executions.rs::dry_run_persona` → `src-tauri/src/engine/dry_run.rs::dry_run_persona`

The validate-only sibling of `execute_persona`. Runs the same pre-flight as the
manual path — fetch persona, run capability-contract pre-check, resolve
credentials (including OAuth refresh), parse model profile, assemble the full
prompt — and then stops. It does **not** create a `persona_executions` row,
does **not** call `engine.start_execution()`, and does **not** spawn a CLI
subprocess.

The result returns synchronously as a `DryRunReport` with the assembled
prompt, the planned tool surface, resolved/failed credentials, and capability
contract diagnostics. A log file is still written under the engine log dir
(name: `dryrun-<uuid>.log`) so the dry-run trace can be inspected the same
way real execution logs are.

Because no DB row is persisted, dry runs are invisible to every existing
metric query, dashboard, and activity feed — the simplest possible isolation
from "real execution metrics."

Surfaced in the UI via "Test run" buttons in `PersonaRunner` and
`ExecutionDetail`.

### Key params

- `persona_id` (required)
- `input_data` (optional) — serialized as JSON string; used as user message
- `trigger_id` (optional) — if this run is attributed to a specific trigger
- `use_case_id` (optional) — groups related runs for the UI
- `continuation` (optional) — resume a paused session
- `idempotency_key` (optional) — deduplicate retries

## Schedule (cron)

**Trigger type**: `schedule`

**Config shape**:
```json
{
  "cron": "0 9 * * 1-5",       // UNIX cron expression
  "interval_seconds": 3600,     // alt: fixed interval (if no cron)
  "event_type": "daily_report", // custom event type to emit
  "payload": { "tag": "daily" },
  "active_window": { "days": [1,2,3,4,5], "start_hour": 9, "end_hour": 18 }
}
```

**Fire path**:

1. Insert/update → `scheduler::compute_next_from_config()` sets
   `next_trigger_at` to the next ISO8601 fire time
2. `TriggerSchedulerSubscription.tick()` runs every ~10s in
   `background.rs`:
   - `SELECT * FROM persona_triggers WHERE enabled=1 AND next_trigger_at <= NOW()`
   - For each row:
     - Check active window (skip if outside)
     - Create a `persona_events` row (type from config, payload from config)
     - Advance `next_trigger_at` via `compute_next_from_config`
     - Update `last_triggered_at`
3. Event bus tick claims the event → matches subscriptions/listeners →
   fires the persona

**Cron parsing**: bitfield approach in `engine/cron.rs`. Standard 5-
field format (`m h dom mon dow`). Seconds-precision not supported
(use `interval_seconds` for sub-minute schedules, but mind the ~10s
scheduler tick).

**Active window**: the full shape is in
[../personas/02-capabilities.md](../personas/02-capabilities.md#triggers).
Skipped fires advance `next_trigger_at` to the next in-window slot
rather than piling up.

**Overdue recovery**: on app startup, `recover_overdue_triggers` runs
once and fires all triggers with past `next_trigger_at`. Prevents
missed fires when the app was closed during the scheduled time.

**Automatic backfill**: when a schedule's config sets `max_backfill > 1`,
the scheduler tick path enumerates every cron/interval slot strictly
between `last_triggered_at` and `now` and publishes a catch-up event for
each (capped at `BACKFILL_HARD_CAP = 100` per tick — `limits.rs`). Each
catch-up event is marked with `backfill_slot: true` in its payload so
downstream listeners can distinguish from the live fire. Implementation
lives in `background.rs::trigger_scheduler_tick_counted` →
`compute_missed_backfill_slots` + `synthesize_backfill_payload`.

**User-initiated backfill**: the Schedules UI exposes a per-row Backfill
action (`History` icon) that lets the user pick an arbitrary `[start, end]`
window and replay every slot inside it via the
`backfill_schedule` Tauri command (`commands/execution/scheduler.rs`).
This is independent of `max_backfill` — it's for retroactive catch-up
after a long downtime, manual re-runs of a specific day's slots, etc.
Bounded by `BACKFILL_MAX_SLOTS_PER_REQUEST = 100`; the response includes
`capped: true` when truncated so the UI can warn the user. Slots are
synthesised with both `backfill_slot: true` and `user_backfill: true`
markers so the auto-backfill path and the user path remain
distinguishable in event payloads.

## Webhook

**Trigger type**: `webhook`

**Endpoint**: `POST http://localhost:9420/webhook/{trigger_id}`
**Implementation**: Axum HTTP server in `src-tauri/src/engine/webhook.rs`

**Config shape**:
```json
{
  "webhook_secret": "shared-secret-hex",  // for HMAC-SHA256 verification
  "event_type": "github_push",
  "payload": { "template": "for-this-trigger" },
  "active_window": { ... }
}
```

**Handler flow** (`webhook.rs`):

1. Verify trigger exists and `trigger_type == "webhook"`
2. Check active window (if set): return HTTP 422 `Retry-After` if
   outside
3. Verify HMAC signature header `X-Signature-HMAC-SHA256` against
   `webhook_secret` (if set)
4. Rate-limit via `WEBHOOK_TRIGGER_WINDOW` (sliding window per
   trigger)
5. Parse body as JSON → merge into `payload` (body takes precedence)
6. Create `persona_events` row and return HTTP 202 Accepted
7. Log to `webhook_logs` for audit

**The event bus picks it up on the next tick** (~1s).

**Smee relay**: for external services that can't reach localhost, the
`engine/smee_relay.rs` module relays from smee.io → local handler.
Configured in settings.

## Polling

**Trigger type**: `polling`

**Config shape**:
```json
{
  "url": "https://api.example.com/status",
  "headers": { "Authorization": "Bearer ..." },
  "content_hash": "sha256:abc123...",  // last seen hash
  "interval_seconds": 300,
  "event_type": "status_changed",
  "payload": {}
}
```

**Fire path** (`PollingSubscription.tick`):

1. `SELECT * FROM persona_triggers WHERE trigger_type='polling' AND enabled=1`
2. For each due row (based on `last_triggered_at + interval_seconds`):
   - GET the URL with headers
   - Compute SHA256 of response body
   - Compare to `content_hash` in config
   - If different: emit event, update `content_hash`, update
     `last_triggered_at`
   - If same: skip (just update `last_triggered_at`)

**Tick cadence**: ~30s when all polling triggers are idle, ~5s when
any polling trigger has fired in the last minute (avoids slow
reaction while being nice to backend under steady-state).

## Event listener

**Trigger type**: `event_listener`

**Config shape**:
```json
{
  "listen_event_type": "deploy_complete",
  "source_filter": "prod-*"   // optional wildcard on event.source_id
}
```

**Matching rules** (`engine/bus.rs::match_event`):

1. Event `event_type` must equal `listen_event_type`
2. If `source_filter` is set:
   - Exact: `event.source_id == source_filter`
   - Wildcard: `event.source_id.starts_with(prefix)` (e.g. `prod-*`)
3. If event has `target_persona_id`:
   - Only matches if `target == persona_id` (direct routing bypasses
     all other subscriptions)
4. Both trigger and persona must be `enabled`

**Event source types**: `persona` (emitted by `emit_event`),
`webhook`, `trigger`, `system`, `external_api`, …

Listeners complement the legacy `persona_event_subscriptions` table;
both are matched in the same tick. Prefer triggers going forward.

## Chain

**Trigger type**: `chain`

**Config shape**:
```json
{
  "source_persona_id": "persona-A",
  "condition": {
    "condition_type": "success",  // any | success | failure | jsonpath
    "status": null                 // optional raw status filter
  },
  "event_type": "a_finished",
  "payload": {}
}
```

**Fire path** (`engine/chain.rs`):

When persona A's execution finalizes (`status` transitions to
`completed` / `failed` / `cancelled`), the chain evaluator:

1. `SELECT * FROM persona_triggers WHERE trigger_type='chain' AND
   config.source_persona_id = 'persona-A'`
2. For each row, evaluate condition:
   - `any` → always fire
   - `success` → fire if `execution.status == completed`
   - `failure` → fire if `execution.status == failed`
   - `jsonpath` → evaluate JSONPath on `execution.output_data`
3. If condition met: create `persona_events` row with `chain_trace_id`
   set to A's trace ID (for correlation)

Chain triggers are the **most explicit** form of persona-to-persona
coupling. For looser coupling, use `emit_event` + `event_listener`.

## File watcher, clipboard, app focus (desktop-only)

These live behind `#[cfg(not(target_os = "ios"))]` in `background.rs`
and poll the OS:

### File watcher (`trigger_type: file_watcher`)
```json
{
  "watch_paths": ["/path/to/dir"],
  "events": ["created", "modified", "deleted", "renamed"],
  "recursive": true,
  "glob_filter": "**/*.md"
}
```
Uses `notify` crate for efficient OS-level notifications. Emits event
on matching filesystem change.

### Clipboard (`trigger_type: clipboard`)
```json
{
  "content_type": "text",
  "pattern": "^https://github.com/",
  "interval_seconds": 5
}
```
Polls clipboard every `interval_seconds`. Fires when contents change
and match `pattern` (regex).

### App focus (`trigger_type: app_focus`)
```json
{
  "app_names": ["Cursor", "Code"],
  "title_pattern": "my-project",
  "interval_seconds": 5
}
```
Polls `active-win` for foreground app. Fires when a named app gains
focus (optionally with matching window title).

## Composite

**Trigger type**: `composite`

**Config shape**:
```json
{
  "conditions": [
    { "event_type": "deploy_complete", "source_filter": "prod-*" },
    { "event_type": "smoke_test_passed" }
  ],
  "operator": "and",           // and | or
  "window_seconds": 300,        // fire when conditions met within window
  "event_type": "prod_ready",
  "payload": {}
}
```

Matches when multiple events satisfy the condition set within
`window_seconds`. `and` requires all, `or` requires any.

The composite matcher is stateful — it tracks which conditions have
been seen inside a rolling window. Implementation in `bus.rs`
composite handler.

## Convergence

All ten paths create a `persona_events` row with status `pending`.
The next event bus tick (~1s) processes pending events:

```
persona_events (status=pending)
    │
    ▼
event_bus_tick() — claims pending rows atomically, sets status=processing
    │
    ▼
Batch-fetch subscriptions + triggers for claimed event types
    │
    ▼
For each event: match_event() against each sub/listener
    │
    ▼
For each match:
  - Cascade guard: skip if persona already running (max_concurrent)
  - Check enabled, trust_level, budget
  - Create execution record
  - engine.start_execution()  ← spawn background task
    │
    ▼
persona_events row moves to status=completed | failed | dead_letter
```

**Retry semantics**: if the execution fails to spawn, `retry_count`
increments. After N retries the event moves to `dead_letter` — still
queryable but won't retry automatically.

**Cascade guard**: when an event matches persona P but P is already
running (counted from `persona_executions.status IN ('queued',
'running')` ≥ `max_concurrent`), the match is skipped and logged.
Prevents runaway cascades where A→B and B→A would infinite-loop.

## Files

| File | Role |
|---|---|
| `src-tauri/src/commands/execution/executions.rs` | Manual entry (`execute_persona`) |
| `src-tauri/src/commands/execution/scheduler.rs` | Scheduler engine on/off + user-initiated `backfill_schedule` |
| `src-tauri/src/engine/background.rs` | All subscription loops (scheduler, polling, event bus, desktop) |
| `src-tauri/src/engine/bus.rs` | Event matching logic |
| `src-tauri/src/engine/scheduler.rs` | `compute_next_from_config` + `compute_slots_in_range` for schedule triggers |
| `src-tauri/src/engine/cron.rs` | Cron expression parsing |
| `src-tauri/src/engine/webhook.rs` | HTTP webhook server (port 9420) |
| `src-tauri/src/engine/chain.rs` | Chain-trigger evaluation |
| `src-tauri/src/db/models/trigger.rs` | `PersonaTrigger` + `TriggerConfig` enum |
| `src-tauri/src/db/repos/resources/triggers.rs` | Trigger CRUD |
| `src-tauri/src/db/repos/communication/events.rs` | Event CRUD + subscription queries |
