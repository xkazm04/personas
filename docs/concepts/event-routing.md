# Reliable Event Routing in the Builder — Design Proposal

**Status:** Proposal
**Author:** Triggers Builder iteration
**Scope:** Persona build process, prompt assembly, event dispatch, Triggers Builder UI

## TL;DR

The Triggers Builder lets users wire personas to events with a click. Today that
click creates an `event_listener` trigger and the runtime fires the persona on
the matching event. **But the persona has no idea what just fired it, and its
prompt was never taught about the new event type.** This proposal closes the
gap with three concrete changes:

1. **Runtime context injection** — surface `event_type` (and source persona id)
   in the data the persona receives, so it can route on it.
2. **Structured `eventHandlers` section** in the persona's
   `structured_prompt` — declarative map from `event_type → handler instruction`.
   Runtime injects the matching handler text into the prompt for the
   currently-firing event.
3. **Builder write path goes through a `link_persona_to_event` command** that
   atomically: creates the trigger, appends an `eventHandlers` entry to the
   persona's structured prompt, marks the persona `prompt_dirty=false` (handler
   added cleanly with no LLM call needed). An optional **"Refine with LLM"**
   action lets the user upgrade the placeholder handler text to a domain-specific
   one.

This avoids a full LLM rebuild on every connection while still guaranteeing the
persona can actually react to the wired event.

---

## Part 1 — The gap, with file:line citations

### 1.1 Personas don't know which event_type triggered them

When an event fires, `engine/background.rs:786-801` extracts the matched
event's `payload` and starts the execution with **only the payload** as
`input_val`:

```rust
let input_val: Option<serde_json::Value> =
    m.payload.as_deref().and_then(|s| serde_json::from_str(s).ok());

engine.start_execution(app, pool, exec.id, persona, tools, input_val, None)
```

The `event_type`, `source_id`, `source_type`, and `target_persona_id` from
`PersonaEvent` are dropped on the floor. The persona only sees the payload.

`engine/runner.rs:402-414` then calls `prompt::assemble_prompt(persona, tools,
input_data, ...)`. The assembled prompt has these sections (`engine/prompt.rs:50-204`):

- `## Identity` — from `structured_prompt.identity` or `system_prompt`
- `## Instructions` — from `structured_prompt.instructions`
- `## Tool Guidance` — from `structured_prompt.toolGuidance`
- `## Examples`, `## Error Handling`, `## Custom Sections`, `## Web Search`
- `## Available Tools`, `## Protocol Tools`, `## Execution Environment`,
  `## Available Credentials`

**Nothing** in this prompt mentions the event_type that fired the persona, or
what the persona is supposed to do when a specific event type arrives.

The persona is invoked with the static text it was built with, plus a payload
that has no event-type label. **A persona subscribed to `webhook_received`,
`schedule_fired`, and `dbmon.anomaly.critical` cannot tell which one just
fired.** It has to guess from payload shape.

### 1.2 Templates declare events as `subscriptions` but mean publications

`scripts/templates/research/database-performance-monitor.json:138-160` lists
events under `suggested_event_subscriptions` with descriptions like
"Emitted when the baseline learning period finishes…". These are events the
persona **publishes** via `emit_event`, but the build session at
`build_sessions.rs:799-800` writes them to `persona_event_subscriptions` because
`direction` defaults to `"subscribe"`:

```rust
let direction = evt.direction.as_deref().unwrap_or("subscribe");
if direction != "subscribe" { continue; }
```

(See the `UnifiedRoutingView.tsx` header for the inference workaround already
in place. The runtime still treats these rows as listeners — they just never
fire because nothing publishes them. Dead listener rows.)

### 1.3 No update path for subscription/handler additions

`build_sessions.rs::create_event_subscriptions_in_tx` only runs during initial
build. There is no `update_persona_event_handlers`, `add_subscription_handler`,
or similar command to mutate the persona's prompt sections after the fact.
Adding a trigger via the Builder today **leaves the persona's prompt
unchanged**. The persona will fire on the new event but will respond as if
it doesn't know what to do — because it doesn't.

### 1.4 The combined effect

When a Builder user clicks "Add persona" on a row for `stock.signal.strong_buy`:

1. ✅ A trigger row is created
2. ✅ The runtime will dispatch the next strong_buy event to that persona
3. ❌ The persona's prompt has no `stock.signal.strong_buy` instructions
4. ❌ The persona doesn't even know `stock.signal.strong_buy` is the event_type
   firing it (only sees the payload)
5. **Result:** the persona generates a hallucinated/generic response, or hits
   its error handling path, or no-ops. Connection looks wired but doesn't work.

This is what the user means by "Connecting persona via three-dotted menu might
not mean the persona will react."

---

## Part 2 — The proposal

### 2.1 Three coordinated changes

#### Change A — Runtime injects event context (backend, ~1 day)

In `engine/background.rs:786-801`, expand `input_val` to wrap the payload with
event metadata:

```rust
let input_val = serde_json::json!({
    "_event": {
        "event_type": event.event_type,
        "source_id": event.source_id,
        "source_type": event.source_type,
        "source_persona_id": event.source_id
            .as_ref()
            .filter(|id| persona_repo::exists(pool, id).unwrap_or(false)),
        "target_persona_id": event.target_persona_id,
    },
    "payload": parsed_payload_or_raw_string,
});
```

Then in `engine/prompt.rs:50` (`assemble_prompt`), read `_event.event_type` from
`input_data` and inject a new top-level section before `## Identity`:

```
## Triggering Event
event_type: stock.signal.strong_buy
source: persona_id=fc3d... (Financial Stocks Signaller)
```

This is a tiny, surgical change. Backwards compatible: legacy callers that pass
raw payloads still work because we look up `_event` defensively.

#### Change B — `eventHandlers` section in `structured_prompt` (backend, ~1 day)

Extend the `structured_prompt` JSON schema (consumed at `prompt.rs:95-186`) with
a new section:

```json
{
  "identity": "...",
  "instructions": "...",
  "toolGuidance": "...",
  "eventHandlers": {
    "stock.signal.strong_buy": "When this event fires, read payload.ticker and payload.price. Compose a concise alert email to the user listing the ticker, current price, and the buy signal strength. Use the email connector. Do not query the market — the payload already contains everything you need.",
    "schedule_fired": "Run the daily portfolio scan. Read tracked tickers from memory, fetch latest prices, and emit_event 'stock.signal.evaluated' for each.",
    "_default": "If the event_type is not in this list, log a manual_review with the event_type and payload, then exit."
  }
}
```

In `prompt.rs:assemble_prompt`, add a new section after `## Instructions`:

```rust
// Event Handlers
if let Some(handlers) = sp.get("eventHandlers").and_then(|v| v.as_object()) {
    let firing_event_type = input_data
        .and_then(|d| d.get("_event"))
        .and_then(|e| e.get("event_type"))
        .and_then(|t| t.as_str());

    prompt.push_str("## Event Handlers\n");

    if let Some(et) = firing_event_type {
        if let Some(handler) = handlers.get(et).and_then(|v| v.as_str()) {
            // CURRENT EVENT — bring its handler to the top
            prompt.push_str(&format!(
                "**Currently firing: `{et}`**\n\n{handler}\n\n",
            ));
        } else if let Some(default) = handlers.get("_default").and_then(|v| v.as_str()) {
            prompt.push_str(&format!(
                "**Currently firing: `{et}` (no specific handler)**\n\n{default}\n\n",
            ));
        }
    }

    // List all known handlers so the persona understands its full repertoire
    prompt.push_str("### All event types this persona handles\n");
    for (et, instr) in handlers {
        if et == "_default" { continue; }
        if let Some(text) = instr.as_str() {
            prompt.push_str(&format!("- **`{et}`**: {text}\n"));
        }
    }
    prompt.push_str("\n");
}
```

Why this design:

- **Declarative:** the handler text is plain English. No code, no LLM, no
  rebuild required to add one.
- **Routing-aware:** the prompt highlights *which* handler is firing right now,
  so the persona doesn't have to guess.
- **Self-documenting:** even when the persona is invoked manually (no
  triggering event), the full handler list reminds it what it can do.
- **Composable with existing fields:** handlers can reference tools listed in
  `## Available Tools` and credentials listed in `## Available Credentials`.

#### Change C — `link_persona_to_event` command (backend + frontend, ~1 day)

Replace the current frontend `createTrigger` call with a single backend command
that does the trigger + handler patch atomically:

```rust
#[tauri::command]
pub fn link_persona_to_event(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    event_type: String,
    handler_text: Option<String>, // optional custom; falls back to placeholder
) -> Result<LinkResult, AppError> {
    require_auth_sync(&state)?;
    let pool = &state.db;
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;

    // 1. Create the event_listener trigger
    let trigger_id = create_trigger_in_tx(&tx, persona_id, event_type, ...)?;

    // 2. Read the persona's current structured_prompt
    let mut sp: serde_json::Value = persona_repo::get_structured_prompt(&tx, &persona_id)?
        .unwrap_or_else(|| serde_json::json!({}));

    // 3. Insert the handler entry. If handlers section doesn't exist, create it.
    let handlers = sp
        .as_object_mut()
        .and_then(|o| {
            o.entry("eventHandlers")
                .or_insert_with(|| serde_json::json!({}))
                .as_object_mut()
        })
        .ok_or_else(|| AppError::Internal("structured_prompt is not an object".into()))?;

    let placeholder = format!(
        "When `{event_type}` fires, read the payload (available as `input_data.payload`), \
         decide what action this persona should take based on its identity and tools, \
         and produce the appropriate output. If you cannot determine a reasonable \
         action from the payload, request a manual_review.",
    );
    handlers.insert(
        event_type.clone(),
        serde_json::Value::String(handler_text.unwrap_or(placeholder)),
    );

    // 4. Write structured_prompt back
    persona_repo::update_structured_prompt(&tx, &persona_id, &serde_json::to_string(&sp)?)?;

    tx.commit()?;
    Ok(LinkResult { trigger_id })
}
```

The Builder's "Add persona" handler becomes:

```ts
await linkPersonaToEvent({
    persona_id: personaId,
    event_type: eventType,
    handler_text: null, // use placeholder
});
```

#### Change D (optional, polish) — "Refine handler with LLM" action

After the user adds a connection with the placeholder handler, show a small
"Refine ▾" action on the chip. Clicking it:

1. Calls a new `refine_event_handler` command
2. The backend reads the persona's full `structured_prompt` + the event_type +
   any sample payloads from `recent_events` for that type
3. Runs a small LLM call (one shot, no full rebuild) that returns a refined
   handler instruction
4. Atomically updates `structured_prompt.eventHandlers[event_type]`

This is opt-in. Most personas work fine with the placeholder because the
persona's identity + the runtime-injected event_type + the available tools are
usually enough for the model to figure out the right action.

### 2.2 Trigger config syntax (the contract)

A Builder-managed `event_listener` trigger looks like this:

```json
{
  "trigger_type": "event_listener",
  "config": "{
    \"listen_event_type\": \"stock.signal.strong_buy\",
    \"_managed_by\": \"builder\",
    \"_handler_key\": \"stock.signal.strong_buy\"
  }"
}
```

The two `_`-prefixed fields are advisory metadata:

- `_managed_by: "builder"` — flags this as a Builder-created connection so the
  Builder can offer disconnect (and so we don't disturb manually-coded
  triggers)
- `_handler_key` — the key in `structured_prompt.eventHandlers` that backs this
  connection. Usually equals `listen_event_type`, but can differ when one
  handler entry covers multiple wildcard event types.

The runtime ignores both fields (they don't break `validate_config` because
that function only checks `listen_event_type`, see `triggers.rs:602-616`).

### 2.3 Disconnect path

`unlink_persona_from_event(persona_id, trigger_id)` does the inverse:

1. Read the trigger, extract `_handler_key`
2. Delete the trigger
3. Remove the matching key from `structured_prompt.eventHandlers`
4. Commit

If the user has multiple Builder-managed triggers for the same persona/event
combo (shouldn't happen, but be defensive), we keep the handler entry until
the last trigger is removed.

### 2.4 Migration of existing personas

Existing personas built before this proposal have:

- A `system_prompt` blob with embedded event mentions (template-baked)
- Maybe a `structured_prompt` without `eventHandlers`
- Subscriptions in `persona_event_subscriptions` (some real listeners, some
  template-default emitter declarations — see the `UnifiedRoutingView` header)

Migration is opt-in and lazy:

1. **Don't auto-touch existing personas** — they keep working as today.
2. When the Builder user clicks "Add persona" on a row for an existing persona
   that has no `eventHandlers` section, `link_persona_to_event` creates the
   section on first use. The persona's existing `instructions` are not
   modified — the new section is purely additive.
3. **Optional one-time backfill command** the user can run from the Builder
   ("Initialize event handlers for all personas"). It reads each persona's
   subscriptions, creates a corresponding `eventHandlers` entry per event_type
   with the placeholder text. Templates' dead-listener subscriptions become
   visible in the prompt, which makes the inverted-direction problem
   self-evident to the user — they can refine or delete from there.

---

## Part 3 — Why this beats the alternatives

### Alternative 1: Full LLM rebuild on every Builder change

Run the full `build_session` flow with the new event added to `agent_ir.events`.
The LLM regenerates `structured_prompt` from scratch.

**Why we reject it:**
- 30s+ wall time per click → terrible Builder UX
- Non-deterministic — small unrelated prompt changes leak through
- Expensive (full structured prompt regeneration is the most token-heavy
  build_session step)
- Difficult to roll back — no clean diff
- Doesn't solve the runtime gap (event_type still not injected)

### Alternative 2: Force users to edit the persona prompt manually

Show a "this persona's prompt doesn't mention this event — edit it" warning
and link to the persona settings.

**Why we reject it:**
- Defeats the point of a Builder UI
- Breaks the "click to connect" interaction the rest of the page promises
- Most users won't have the patience or domain knowledge to write handler
  prose by hand

### Alternative 3: Generic event router everyone gets for free

Every persona prompt automatically includes "When you receive an event, look
at the event_type in input_data._event and try to handle it sensibly." No
explicit handlers section.

**Why we reject it:**
- Personas hallucinate. Without an explicit handler-per-event the persona
  invents fake business logic for events it's never seen.
- Doesn't solve the template `agent_memory` style problem — the persona still
  receives events it shouldn't be handling at all.
- No durable record of "what this persona does for what event," so the Builder
  has no way to show it.

### Why the proposed approach wins

- **Deterministic by default** — placeholder handler text is the same every
  time, no LLM needed for the click action.
- **One backend tx** — trigger + prompt patch are atomic. No drift.
- **Visible in the persona** — the `eventHandlers` section is part of
  `structured_prompt`, so users editing the persona see exactly what was
  wired by the Builder.
- **Reversible** — disconnect undoes both pieces in one tx.
- **Backwards compatible** — personas without `eventHandlers` work as today.
  Runtime injection of `_event` is also backwards compatible because old
  prompts simply don't reference it.
- **LLM optional** — the "Refine with LLM" action exists for users who want
  domain-specific prose, but it's never required for connection to function.

---

## Part 4 — Implementation slices (each independently mergeable)

| Slice | Files touched | Risk | What unblocks |
|---|---|---|---|
| **S1.** Inject `_event` into `input_data` at dispatch | `engine/background.rs`, `engine/prompt.rs` (read `_event` and render `## Triggering Event` block) | Low — additive | Personas can finally distinguish event types at runtime |
| **S2.** `eventHandlers` section in `structured_prompt` rendered by `prompt::assemble_prompt` | `engine/prompt.rs`, `db/models/agent_ir.rs` (extend AgentIr if we want build flow to write it too) | Low — additive | New build_sessions can write handlers; runtime renders them |
| **S3.** `link_persona_to_event` / `unlink_persona_from_event` commands | `commands/tools/triggers.rs`, `db/repos/resources/triggers.rs`, frontend `linkPersonaToEvent` API | Medium — touches both layers | Builder click reliably wires a working handler |
| **S4.** Builder uses new commands instead of `createTrigger` / `deleteTrigger` | `src/features/triggers/sub_builder/layouts/UnifiedRoutingView.tsx` | Low | Builder UX delivers on its promise |
| **S5.** Lazy backfill / "Initialize event handlers" action | `commands/tools/triggers.rs` (one-shot command), Builder toolbar button | Medium — operates on user data | Existing personas opt into the new model |
| **S6.** "Refine handler with LLM" action (optional) | New backend command, Builder chip menu | Medium — LLM call | Power-user polish |

S1+S2 are foundational. S3+S4 deliver the user-visible improvement. S5+S6 are
quality-of-life.

---

## Part 5 — Open questions

1. **Should `eventHandlers` live in `structured_prompt` or in a new
   `persona_event_handlers` table?** Storing in `structured_prompt` keeps
   handlers versioned with the rest of the persona's behavior (no separate
   migration path). A separate table would be easier to query/filter but
   forces dual-write. **Recommendation:** start in `structured_prompt`,
   promote to a table only if we need cross-persona queries.

2. **What about wildcard handlers (`stock.signal.*`)?** The current spec
   matches handlers by exact `event_type`. Wildcards would require pattern
   matching at runtime. **Recommendation:** defer until we have a concrete user
   request. Personas can use the `_default` key today as an escape hatch.

3. **What about chain triggers?** Chain triggers already publish events with
   well-defined event types — they slot into the same `eventHandlers` model
   without changes. The Builder's chain badge stays as-is.

4. **Direction inference cleanup.** Once the backfill command runs and
   handlers exist for real listener subscriptions, the inferred-direction
   workaround in `UnifiedRoutingView.tsx` becomes unnecessary for migrated
   personas. We can phase it out gradually as `_managed_by: "builder"`
   triggers replace template-default subscriptions. The inference stays as
   the fallback for personas that never got backfilled.

5. **Should `link_persona_to_event` also write to
   `persona_event_subscriptions`?** Currently `create_subscription_with_trigger`
   does a dual write. The Builder doesn't need the legacy subscription row
   because it relies on event_listener triggers for routing. **Recommendation:**
   skip the legacy write — keep new connections clean and let
   `delete_subscription` migrations clean up old rows over time.
