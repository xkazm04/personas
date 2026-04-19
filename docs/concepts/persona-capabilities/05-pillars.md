# 05 — The Pillars

> How each pillar of the platform (triggers, events, executions, messages,
> reviews, memories, automations) rewires around capabilities.

## Triggers

**Current**: `persona_triggers` has `use_case_id` column, populated
**positionally** at promote time — trigger at index `i` is linked to
`use_cases[i]`. Fragile under any ordering change.

**Target (C2)**: linkage is **semantic**. `AgentIr.triggers` carries an
optional `use_case_id` field on each trigger; the CLI build prompt explicitly
asks the model to produce trigger objects with the correct `use_case_id`
referencing the capability they belong to. `build_sessions.rs::create_triggers_in_tx`
uses the semantic id first, falls back to positional only if `use_case_id` is
missing (tolerated during migration window; all migrated templates have it).

**Target (C3)**: the Trigger Builder UI wires triggers to capabilities. When
the user creates a new trigger, they pick:

1. Event source (cron expression, polling config, webhook URL, event type)
2. **Which capability this trigger activates** (dropdown populated from
   `design_context.useCases` where `enabled != false`)

A "persona-wide trigger" option remains (nullable `use_case_id`), used for
rare cases where a trigger should fire regardless of any specific capability.
For those, the execution runs the persona without a `_use_case` focus block.

**Scheduler**: `src-tauri/src/engine/background.rs::scheduler_tick` already
passes `use_case_id` into the created execution. No change needed there; C1's
auto-injection in `execute_persona` closes the loop.

## Events & subscriptions

**Current**: subscriptions have `use_case_id` populated semantically at
promote time. Events are routed by `(event_type, source_filter)` without
considering `use_case_id`.

**Target (C4 — stretch into C1 if trivial)**: event dispatch respects
`use_case_id`:

- If multiple subscriptions match an event and one is capability-scoped,
  route to the scoped one (creates an execution with that `use_case_id`).
- If none are capability-scoped, route to the persona-wide subscription
  (execution with `use_case_id = NULL`).
- If multiple scoped subscriptions match, all fire (one execution each,
  capabilities can be coactivated by the same event).

No schema change — all fields already present.

## Executions

**Current**: `execute_persona` accepts `use_case_id`, stores it on the row,
but the runtime doesn't use it for anything except history filtering.

**Target (C1)**: `execute_persona` **auto-expands** `use_case_id` into
`input_data._use_case` + `_time_filter` + model_profile override before
calling the engine. The engine's prompt assembler (already capability-aware
after C1) produces a capability-focused prompt.

**Target (C3)**: `is_simulation BOOLEAN` column added. Simulated executions:

- Run the full engine path (same prompt, same tools)
- Write the execution row with `is_simulation=true`
- Dispatcher sees `is_simulation` and skips real notification delivery
- Messages are still written (with `is_simulation=true` if the column exists)
- History UI for the capability shows simulations with a distinct badge

**Persona-wide manual execution** (the current Execute button use case):
**removed**. There is no longer a generic "run the persona" action. All
executions are either capability-targeted (C3 per-capability Run button) or
triggered by events/schedules. Chat remains the surface for ad-hoc interaction.

## Messages

**Current**: `persona_messages` has no `use_case_id`. Outbound messages
are attributed to the persona only.

**Target (C5)**: add `use_case_id TEXT` column. `message_repo::create`
inherits it from the emitting execution. Activity feeds gain a capability
filter. Notification dispatch uses the capability's `notification_channels`
(if present) before falling back to persona-wide `notification_channels`.

**Dispatch precedence** (post-C5):

```
resolve_channels_for_message(message, execution) {
  if execution.use_case_id is set:
    use_case = design_context.useCases[execution.use_case_id]
    if use_case.notification_channels is non-empty:
      return use_case.notification_channels
  return persona.notification_channels  // fallback
}
```

## Manual reviews

**Current**: `persona_manual_reviews` has no `use_case_id`, but inherits
scope implicitly via the `execution_id` FK.

**Target (C5)**: add `use_case_id TEXT` column, populated from execution at
review creation. Enables per-capability review queues ("all pending approvals
for my gem-finder capability").

Review UI gains a per-capability filter. No behavior change on the gating
side — reviews still block execution as before.

## Memories

**Current**: `persona_memories` has no `use_case_id`. The runtime memory
fetcher (`runner.rs:484`) pulls everything per persona.

**Target (C5)**: add `use_case_id TEXT` column. Memory model:

| Tier | use_case_id | Meaning |
|---|---|---|
| core | NULL | Cross-capability persistent facts (user preferences, constraints) |
| active | NULL | Persona-wide learned patterns (shared across capabilities) |
| active | `uc_...` | Learned by this specific capability |
| archive | any | Not injected (retention only) |

`mem_repo::get_for_injection_v2(persona_id, use_case_id: Option<&str>)`:

- Always returns `tier='core' AND use_case_id IS NULL`
- Returns `tier='active' AND (use_case_id IS NULL OR use_case_id = ?)` when
  `use_case_id` is Some
- Returns `tier='active' AND use_case_id IS NULL` when `use_case_id` is None

Write path: `emit_memory` tool call with `tier: 'active' | 'core'`. When
called inside a capability execution, the memory row inherits `use_case_id`
from the execution unless the tool call explicitly sets `tier: 'core'`
(user-level fact). Core memories are always unscoped.

## Automations (n8n / Zapier / webhooks)

**Current**: `persona_automations` has `use_case_id` (nullable). Automations
can already be capability-scoped at the schema level; the UI doesn't expose it.

**Target (C4)**: The automation card in the Use Case tab lets the user
attach automations to specific capabilities. The editor on `sub_connectors`
gets a "Applies to: [all | capability X]" dropdown. Runtime dispatch is
unchanged — automations registered as virtual tools for the persona, available
during execution regardless of capability, but the Capabilities section
in the prompt mentions which capability owns them ("Gem Finder's delivery
webhook: send_to_sheet").

## Summary — per-pillar state of readiness

| Pillar | Schema ready | Runtime honors use_case | UI surfaces it | Phase to finish |
|---|---|---|---|---|
| Triggers | yes (column exists) | no (positional linkage) | no | **C2 (linkage) → C4 (UI)** |
| Events | yes | partial (populated, not used in matching) | no | **C4** |
| Executions | yes (column exists) | no (auto-inject missing) | partial (history filters exist) | **C1** |
| Messages | no (column missing) | no | no | **C5** |
| Reviews | no (column missing) | no | no | **C5** |
| Memories | no (column missing) | no | no | **C5** |
| Automations | yes | yes (as virtual tool) | no | **C4 (UI)** |
