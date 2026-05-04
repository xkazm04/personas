# 02 — Use Case as Capability

## Definition

A **capability** (represented by a `DesignUseCase` in code) is a discrete job
the persona performs. It is scoped, triggerable, simulatable, and toggleable
without touching the persona's identity.

## The DesignUseCase type (v2)

Current shape (existing fields preserved, additive changes marked `NEW`):

```typescript
// src/lib/types/frontendTypes.ts
// Mirror in src-tauri/src/db/models/persona.rs::DesignUseCase

interface DesignUseCase {
  // Identity
  id: string;                             // Stable UUID, cross-referenced everywhere
  title: string;                          // Human name: "Weekly gem finder"
  description: string;                    // One-sentence purpose
  category?: string;                      // Grouping tag in UI

  // Activation state (NEW)
  enabled?: boolean;                      // Default true via serde. Runtime toggle.

  // Execution metadata
  execution_mode?: "e2e" | "mock" | "non_executable";  // Existing
  sample_input?: Record<string, unknown> | null;       // Canonical example payload
  input_schema?: UseCaseInputField[];                  // Schema for structured input
  time_filter?: UseCaseTimeFilter;                     // "last 7 days" scoping

  // Trigger & events (semantic linkage, not positional)
  suggested_trigger?: UseCaseSuggestedTrigger;         // schedule | polling | webhook | manual
  event_subscriptions?: UseCaseEventSubscription[];    // Events that activate this capability

  // Delivery
  notification_channels?: NotificationChannel[];       // Where this capability's outputs go

  // Compute override
  model_override?: ModelProfile;                       // Per-capability model (optional)

  // Testing
  test_fixtures?: TestFixture[];                       // Named input bundles for simulation

  // (NEW, optional — authored by templates, consumed by prompt renderer)
  tool_hints?: string[];                               // Tool names most relevant to this capability
  capability_summary?: string;                         // One-liner for prompt injection. Defaults to `description` if absent.
}
```

## Capability lifecycle

```
        authored
  template  →  AgentIr v2  →  design_context.useCases[]
  author       (CLI output)    (stored verbatim on persona)
                                      │
                                      ▼
                  set_use_case_enabled(persona_id, use_case_id, enabled)
                                      │
                                      ▼
                  design_context.useCases[i].enabled = ?
                  persona_triggers.enabled          ← cascade
                  persona_event_subscriptions.enabled ← cascade
                  session_pool invalidated
                                      │
                                      ▼
                  next execution reads design_context.useCases
                  injects "## Active Capabilities" into prompt
                  (see 03-runtime.md)
```

## Runtime behavior — what changes when a capability is disabled

| Behavior | When enabled | When disabled |
|---|---|---|
| Capability appears in prompt's "Active Capabilities" section | yes | no |
| Linked triggers fire on schedule | yes | no (`enabled=0`) |
| Linked event subscriptions consume events | yes | no (`enabled=0`) |
| Manual "simulate" button still works | yes | yes (simulation bypasses enable gate) |
| Existing running execution | — | finishes (no mid-run kill) |
| Learned memories tagged to this capability | continue to load | not loaded |

Simulate deliberately bypasses the enable gate so users can test a capability
before activating it, or diagnose why a disabled capability misbehaves.

## Triggering a capability

Three paths:

1. **Scheduled trigger fires** — `persona_triggers` row with `use_case_id` set.
   Scheduler loads the row, creates an execution with `use_case_id`, injects
   the capability context into `input_data._use_case`.

2. **Event subscription matches** — `persona_event_subscriptions` row with
   `use_case_id` set. Event bus routes the event, creates an execution, again
   injecting capability context.

3. **Manual invocation** — user clicks the capability's Run button in the Use
   Case tab (post-C3). The UI calls `executePersona(persona_id, undefined,
   input, use_case_id)`. The existing API supports this.

In all three paths, the runtime auto-expands `use_case_id` into a full
capability JSON block on `input_data._use_case` before prompt assembly.
This is implemented in the execution entry point, not left to the caller.
(See [03-runtime.md](03-runtime.md) §2.)

## Simulation

A **simulation** is a real execution with these modifications:

- Input comes from `use_case.sample_input` or a selected `test_fixture`
- `execution.is_simulation = true` (NEW column)
- Notification dispatch is skipped (no real Slack messages sent)
- Message rows still recorded, tagged with `is_simulation`
- Result visible only in the Use Case tab's history, not in global activity feeds

The simulation command (`simulate_use_case`) is a thin wrapper over
`execute_persona`. Semantics: *everything real, outputs suppressed*.

## Cross-capability communication (emergent)

Capabilities do not call each other directly. They communicate the same way
templates already encode it:

- Capability A emits an event (e.g., `review_requested`) via the protocol.
- Capability B has that event in its `event_subscriptions`.
- The event bus routes it and Capability B fires.

This preserves the existing event-subscription mechanism and keeps capabilities
loosely coupled. No new composition primitive required in the first rollout.

A read-only graph visualization that renders this coupling is deferred (see
[10-deferred-backlog.md](10-deferred-backlog.md)).

## Enable/disable cascade — exactly what happens

```
set_use_case_enabled(persona_id, use_case_id, enabled) {
  BEGIN TRANSACTION;

  // 1. Patch design_context JSON (single row update on personas table)
  UPDATE personas
    SET design_context = json_set(design_context, '$.useCases[i].enabled', enabled),
        updated_at = now
    WHERE id = persona_id;

  // 2. Cascade triggers
  UPDATE persona_triggers
    SET enabled = enabled, status = (enabled ? 'active' : 'paused'), updated_at = now
    WHERE persona_id = persona_id AND use_case_id = use_case_id;

  // 3. Cascade subscriptions
  UPDATE persona_event_subscriptions
    SET enabled = enabled, updated_at = now
    WHERE persona_id = persona_id AND use_case_id = use_case_id;

  // 4. Cascade automations (if any)
  UPDATE persona_automations
    SET deployment_status = (enabled ? prev_status : 'paused'), updated_at = now
    WHERE persona_id = persona_id AND use_case_id = use_case_id;

  // 5. Bust session cache so next execution reassembles prompt without this capability
  session_pool.invalidate(persona_id);

  COMMIT;
}
```

All four UPDATEs are in one transaction — either all four flip or none do.
Session invalidation runs after commit, before returning.

## What a capability does NOT own

- The persona's identity, voice, principles — those stay in the behavior core.
- Tools — all persona tools are available to every capability. (Capability
  descriptions carry `tool_hints` so the model knows which are most relevant,
  but all tools are exposed.)
- Budget and turn limits — inherited from the persona.
- Trust level — inherited.
- Core memories — always injected.

## When to create a new capability vs extend an existing one

**New capability** if:

- It has a fundamentally different trigger pattern (manual request vs weekly schedule)
- It delivers to a different notification channel
- It requires materially different inputs
- It produces different outputs the user would ask about separately

**Extend an existing capability** if:

- The trigger and outputs are the same; the variation is only in the prompt
  behavior or input options (which belong inside the capability's prompt logic
  or sample inputs).

Rule of thumb: if a user would say "please disable X" as a sentence, X is a
capability. If they'd say "please stop doing the Tuesday case," that is still
one capability (the "weekly scan") with a day-of-week parameter.
