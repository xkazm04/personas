# Chaining and human approval

How executions link together (event cascades, chain triggers,
automations) and how they pause for human decisions (manual review
protocol). This is the "multi-persona workflows and governance" layer
on top of the single-execution pipeline.

## Chaining overview

Three mechanisms let one execution cause another:

| Mechanism | How it's declared | Coupling |
|---|---|---|
| **Event bus** | `emit_event` in output + `event_listener` trigger | Loose — emitter doesn't name recipients |
| **Chain trigger** | `trigger_type: chain` with `source_persona_id` | Tight — B explicitly watches A |
| **Automation** | Virtual tool calls external workflow | Tight — persona directly delegates |

All three preserve `chain_trace_id` so you can query the whole cascade
tree later via `get_chain_trace(trace_id)`.

## Event bus (the primary chaining path)

### Emission

Persona emits in its output:

```json
{
  "emit_event": {
    "event_type": "deploy_complete",
    "source_type": "persona",
    "source_id": "persona-A",
    "target_persona_id": null,
    "payload": { "deployment_id": "123", "env": "prod" },
    "use_case_id": "uc_1"
  }
}
```

Parsed by `engine/parser.rs` → dispatched via `engine/dispatch.rs`
which calls `event_repo::create_event`:

```sql
INSERT INTO persona_events
  (id, event_type, source_type, source_id, target_persona_id,
   payload, status, chain_trace_id, use_case_id, retry_count, created_at)
  VALUES (?, ?, 'persona', ?, ?, ?, 'pending', ?, ?, 0, ?)
```

The `chain_trace_id` is **inherited from the emitting execution's
trace ID**, so every event in a cascade shares the same correlation
ID.

### Propagation

The **event bus tick** runs every ~1s in `engine/background.rs`:

```
event_bus_tick():
  │
  ▼ claim_pending(limit=N) — atomic update to status=processing
  │
  ▼ batch-fetch subscriptions for claimed event types (1 query)
  │
  ▼ batch-fetch event_listener triggers for claimed types (1 query)
  │
  ▼ for each event:
       match against every sub/listener via match_event()
       for each match:
         cascade guard check
         engine.start_execution()
  │
  ▼ for matched events: status = completed
  ▼ for unmatched events: status = completed (or skipped)
  ▼ for errored spawns: increment retry_count, status = pending (retry)
                         OR status = dead_letter if retries exhausted
```

### Matching logic

`engine/bus.rs::match_event(event, subscription_or_listener)`:

1. **Event type**: exact match required (no wildcards here)
2. **Source filter**: optional
   - Exact: `event.source_id == filter`
   - Prefix wildcard: `source_id.starts_with(filter_prefix)` when
     filter ends in `*` (e.g. `"prod-*"`)
3. **Target routing**: if `event.target_persona_id` is set, only
   matches listeners on that persona — bypasses normal fan-out
4. **Enabled**: both the event owner and the subscription/listener
   must have `enabled=true`
5. **Active window**: for `event_listener` triggers with an
   `active_window` config, skip out-of-hours events

### Cascade guard

Before spawning a child execution, check:

```rust
let running = exec_repo::count_running_for_persona(persona_id)?;
if running >= persona.max_concurrent {
    log::info!("cascade guard: {persona_id} already at capacity, skipping");
    return Ok(());
}
```

Prevents infinite loops in A→B→A cascades. Events that miss the guard
don't go to dead letter — they're dropped silently because the state
didn't warrant a run.

### Dead-letter handling

`persona_events` retry state machine:

```
 pending → processing → completed (success)
                     → pending (retry if spawn failed, retry_count++)
                     → dead_letter (retry_count ≥ MAX_RETRIES)
                     → discarded (explicitly filtered out)
```

Dead-letter events stay queryable for audit. UI surfaces them in the
"Event Log" drawer with a retry button.

### Chain trace correlation

Every execution has a `trace_id`. When a persona emits an event, that
trace_id becomes the `chain_trace_id` on the event. Child executions
inherit the `chain_trace_id`. Result:

```sql
SELECT * FROM execution_traces WHERE chain_trace_id = ?;
-- returns every execution in the cascade
```

The UI "Chain View" renders this as a tree: root execution at top,
child executions nested under the events they spawned.

**Trace continuity break**: if the payload JSON fails to parse (so the
`chain_trace_id` field can't be extracted), the `trace_continuity_breaks`
counter increments. Monitoring this tells you how many cascades are
losing correlation.

## Chain triggers (explicit persona-to-persona)

A `persona_triggers` row with:

```json
{
  "trigger_type": "chain",
  "config": {
    "source_persona_id": "persona-A",
    "condition": {
      "condition_type": "success",
      "status": null
    },
    "event_type": "a_finished",
    "payload": {}
  }
}
```

**Condition types**:
- `any` — fire on every completion of A
- `success` — fire only when `execution.status == completed`
- `failure` — fire only when `execution.status == failed`
- `jsonpath` — evaluate JSONPath expression on `execution.output_data`

Evaluated in `engine/chain.rs` at the Finalize phase of A's
execution:

```rust
let chain_triggers = trigger_repo::get_chain_triggers_for_source(&A.persona_id)?;
for trigger in chain_triggers {
    if evaluate_condition(&trigger.config.condition, &A.execution) {
        emit_chain_event(&trigger, &A.execution.trace_id);
    }
}
```

The emitted event flows through the normal event bus path. Difference
vs event listener: chain trigger is **active** (A's Finalize emits),
event listener is **passive** (waits for any emit_event).

## Automations (external workflow chaining)

When a persona calls an automation tool, it's a synchronous delegation
to an external platform (n8n, Zapier, GitHub Actions, custom webhook):

```
persona A executes
  │
  ▼ tool_call to "run_deploy_workflow" (virtual automation tool)
  │
  ▼ automation_runner resolves platform_credential_id
  ▼ POST to webhook_url with input data
  │
  ▼ platform executes (may take seconds to hours)
  │
  ▼ persona A receives output OR hits timeout_ms
  ▼ automation_runs row records platform_run_id, output_data, duration
```

Automations do NOT emit events to the event bus by default. The
persona receives the output synchronously and continues its agentic
loop.

**Fallback modes** when the platform fails:
- `connector` — fall back to a matching native connector tool if one
  exists
- `fail` — propagate the failure up the agent loop (tool returns
  error)
- `skip` — return a "(skipped)" success marker so the loop continues

## Memory as implicit chaining

Memories written in one execution are injected into the next. This
isn't a trigger mechanism — there's no event — but it creates
**knowledge continuity**:

```
Execution #1 of persona P
  │
  ▼ emits agent_memory {title: "X", importance: 4}
  ▼ memory persisted
  │
Execution #2 of persona P (hours/days later)
  │
  ▼ get_for_injection fetches memories
  ▼ "X" appears in system prompt under "Active Learnings"
  ▼ P's behavior shifts based on what it learned last time
```

See [../personas/02-capabilities.md](../personas/02-capabilities.md#memory)
for importance/category semantics.

## Human approval — the manual review protocol

### Why

Some persona actions are too consequential for full automation:
transfers above a threshold, public posts, production database writes,
data exports. The manual review protocol lets the persona **pause and
ask** for human approval mid-run.

### Emission

Persona emits:

```json
{
  "manual_review": {
    "title": "Approve payment transfer",
    "description": "Transfer $10,000 to vendor account **4521",
    "severity": "critical",
    "context_data": {
      "amount_usd": 10000,
      "recipient": "ACME Corp",
      "invoice_id": "inv_XXX"
    },
    "suggested_actions": ["approve", "reject", "request_info"]
  }
}
```

### Persistence

`engine/dispatch.rs` creates a row:

```sql
INSERT INTO persona_manual_reviews
  (id, execution_id, persona_id, title, description, severity,
   context_data, suggested_actions, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
```

Side effects:
- OS notification fires (desktop only, via `notify-rust`)
- Tauri event `manual-review-created` emitted with review_id
- UI shows the review in a prominent panel

### Severity taxonomy

| Severity | Visual | Typical use |
|---|---|---|
| `info` | Blue chip | Notable but not blocking — "logging this decision for the record" |
| `warning` | Amber chip | Worth a human check — "reasonably confident but want confirmation" |
| `critical` | Red chip | Must not proceed without approval — "real-world consequences" |

The frontend uses severity to prioritize the review queue and choose
notification modality (critical → OS notification + Slack, info →
in-app only).

### Review conversation

Threaded messages in `review_messages` let reviewer and agent
exchange context:

```sql
review_messages:
  id, review_id, role (user|assistant|system), content, metadata, created_at
```

Typical flow:
1. Persona creates the review (one `user` message = initial request)
2. Reviewer adds an `assistant` message: "what's this transfer for?"
3. Persona (via continuation) adds an `assistant` message with the
   invoice details
4. Reviewer marks approved/rejected, final `system` message records
   the decision

### Status transitions

```
  pending → approved   ──┐
         ↘ rejected   ──┼─► resolved
         ↘ resolved   ──┘
```

`approved` and `rejected` are intermediate states — they record the
decision. `resolved` is terminal; no further edits. Notes can be
attached at any transition.

### Current blocking model

**Today**: the execution does NOT block waiting for the review. The
persona emits the review and continues its loop. The decision
happens out-of-band and the **NEXT** execution (or a session resume)
sees the outcome.

**Why**: blocking requires pausing the CLI subprocess, which means
either keeping the process alive (ties up a slot for potentially
hours) or serializing state and respawning (wasted prompt cache).

**Workaround**: templates use the pattern "emit review, then end the
turn". Next invocation starts fresh, injects the resolved review via
memory or input, and acts on the decision.

**Future**: `status = awaiting_approval` on the execution + session
continuation via `--resume` is in the design notes. It'll require
changes to `execute_persona` (to accept continuation inputs), the CLI
driver (to exit cleanly mid-conversation), and the frontend (to hand
the reviewer's decision back in).

### Trust level interaction

`persona.trust_level == Manual` flips EVERY tool call into a review
request automatically. The persona doesn't need to emit `manual_review`
explicitly — the engine wraps each tool call with an implicit review.

This is the "watch everything" mode. Set `trust_level = Manual` on a
brand-new persona for the first N runs, then demote to `Verified` once
you've validated it.

`persona.headless == true` bypasses the Manual-level wrapping — for
automations that run with no user. See
[../personas/03-trust-and-governance.md](../personas/03-trust-and-governance.md#headless-mode).

## IPC commands (frontend ↔ backend)

| Command | Purpose |
|---|---|
| `list_manual_reviews` | Fetch pending (or filtered) reviews |
| `get_manual_review` | Fetch a single review with full message thread |
| `approve_manual_review` | Status → approved, append reviewer notes |
| `reject_manual_review` | Status → rejected, append reviewer notes |
| `resolve_manual_review` | Status → resolved (terminal) |
| `append_review_message` | Add an `assistant` or `user` message to the thread |
| `get_chain_trace` | Fetch every execution in a cascade by chain_trace_id |

## Files

| File | Role |
|---|---|
| `src-tauri/src/engine/bus.rs` | Event matching + cascade loop |
| `src-tauri/src/engine/chain.rs` | Chain-trigger condition evaluation |
| `src-tauri/src/engine/dispatch.rs` | Protocol → DB writes (events, memories, reviews) |
| `src-tauri/src/engine/parser.rs` | Stdout → protocol messages |
| `src-tauri/src/engine/automation_runner.rs` | External workflow invocation |
| `src-tauri/src/db/repos/communication/events.rs` | Event CRUD, claim_pending, dead letter |
| `src-tauri/src/db/repos/communication/manual_reviews.rs` | Review CRUD + message threads |
| `src-tauri/src/db/repos/resources/memories.rs` | Memory lifecycle |
| `src-tauri/src/commands/execution/executions.rs` | `get_chain_trace` IPC |
