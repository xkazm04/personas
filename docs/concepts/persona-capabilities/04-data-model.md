# 04 — Data Model

> Schema changes, FK coupling points, and the before/after for every table
> the capability model touches. Greenfield — no backward-compat shims.

## Summary of schema changes

| Table | Change | Phase |
|---|---|---|
| `personas` | No column changes | — |
| `persona_triggers` | `use_case_id` already exists; tighten: semantic linkage in AgentIr v2 | C2 |
| `persona_event_subscriptions` | `use_case_id` already exists; unchanged | — |
| `persona_events` | `use_case_id` already exists; unchanged | — |
| `persona_automations` | `use_case_id` already exists; unchanged | — |
| `persona_executions` | Add `is_simulation BOOLEAN NOT NULL DEFAULT 0` | C3 |
| `persona_manual_reviews` | Add `use_case_id TEXT` | C5 |
| `persona_messages` | Add `use_case_id TEXT` | C5 |
| `persona_memories` | Add `use_case_id TEXT` | C5 |
| `persona_prompt_versions` | Add `use_case_id TEXT` (nullable; `NULL` means persona-wide version) | C6 |
| `design_context` (JSON on `personas`) | New optional field: `useCases[i].enabled` (default true via serde) | C1 |

Indexes added alongside columns: `idx_<table>_use_case` for each new `use_case_id`.

## Field-by-field — what each table stores

### personas

Unchanged. `structured_prompt` gets new **content fields** (`voice`,
`principles`, `constraints`, `decision_principles`, `verbosity_default`) —
see [01-behavior-core.md](01-behavior-core.md). Those are inside the JSON,
not new columns.

### personas.design_context (JSON envelope)

Existing shape continues, with one additive field on each use case entry:

```jsonc
{
  "designFiles": [...],
  "credentialLinks": {...},
  "useCases": [
    {
      "id": "uc_...",
      "title": "...",
      "description": "...",
      "category": "...",
      "enabled": true,              // NEW (optional, default true)
      "execution_mode": "e2e",
      "sample_input": {...},
      "input_schema": [...],
      "time_filter": {...},
      "suggested_trigger": {...},
      "event_subscriptions": [...],
      "notification_channels": [...],
      "model_override": {...},
      "test_fixtures": [...],
      "tool_hints": ["..."],        // NEW (optional)
      "capability_summary": "..."   // NEW (optional, fallback to description)
    }
  ],
  "twinId": "..."
}
```

### persona_triggers

Current:

```sql
CREATE TABLE persona_triggers (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  config TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  use_case_id TEXT,                          -- already added via incremental migration
  next_trigger_at TEXT,
  last_triggered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_pt_use_case ON persona_triggers(use_case_id);
```

No schema change in C1. What changes in C2: the **creation path** stops using
positional `use_cases[idx]` and starts reading `trigger.use_case_id` semantically
(requires AgentIr v2 — see [06-building-pipeline.md](06-building-pipeline.md)).

### persona_event_subscriptions

Already has `use_case_id` (incremental migration). Already populated
semantically via reverse lookup in `build_sessions.rs::create_event_subscriptions_in_tx`.

What changes in C3 (event bus dispatch): the matcher currently ignores
`use_case_id` when routing events. Post-C3 it will check: when an event matches
multiple subscriptions and one is `use_case_id`-scoped, prefer the scoped one.
(Non-scoped subscriptions remain valid — they mean "any capability.")

### persona_executions

Add column in C3:

```sql
ALTER TABLE persona_executions ADD COLUMN is_simulation INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_pe_simulation ON persona_executions(persona_id, is_simulation);
```

Simulation rows are filtered out of the global activity feed by default; the
Use Case tab shows them with a "SIMULATED" badge.

### persona_manual_reviews

Add in C5:

```sql
ALTER TABLE persona_manual_reviews ADD COLUMN use_case_id TEXT;
CREATE INDEX idx_pmr_use_case ON persona_manual_reviews(use_case_id);
```

Populated from the execution's `use_case_id` at review creation. No FK
constraint (use cases live in JSON, not a table).

### persona_messages

Add in C5:

```sql
ALTER TABLE persona_messages ADD COLUMN use_case_id TEXT;
CREATE INDEX idx_pmsg_use_case ON persona_messages(use_case_id);
```

Inherited from the emitting execution.

### persona_memories

Add in C5:

```sql
ALTER TABLE persona_memories ADD COLUMN use_case_id TEXT;
CREATE INDEX idx_pm_use_case ON persona_memories(use_case_id);
```

- `tier='core' AND use_case_id IS NULL` → cross-capability core memory
- `tier='active' AND use_case_id='uc_xxx'` → capability-scoped learned memory
- `tier='active' AND use_case_id IS NULL` → persona-wide learned memory (shared across all capabilities)

### persona_prompt_versions

Add in C6:

```sql
ALTER TABLE persona_prompt_versions ADD COLUMN use_case_id TEXT;
CREATE INDEX idx_ppv_use_case ON persona_prompt_versions(persona_id, use_case_id, version_number);
```

- `use_case_id IS NULL`: this version snapshots the **whole persona**
  (structured_prompt, system_prompt, design_context).
- `use_case_id IS NOT NULL`: this version snapshots a single capability's
  fragment (its description, capability_summary, tool_hints, notification_channels,
  model_override). Used when Lab refines a specific capability.

## FK & cascade matrix

| Parent | Child | FK | ON DELETE |
|---|---|---|---|
| personas | persona_triggers | persona_id | CASCADE |
| personas | persona_event_subscriptions | persona_id | CASCADE |
| personas | persona_automations | persona_id | CASCADE |
| personas | persona_executions | persona_id | CASCADE |
| personas | persona_manual_reviews | persona_id | CASCADE |
| personas | persona_messages | persona_id | CASCADE |
| personas | persona_memories | persona_id | CASCADE |
| personas | persona_prompt_versions | persona_id | CASCADE |
| persona_executions | persona_manual_reviews | execution_id | CASCADE |
| persona_triggers | persona_executions | trigger_id | SET NULL |

`use_case_id` is **not** a foreign key anywhere — use cases live in the
`design_context` JSON, not a separate table. This is deliberate: use cases
are persona-owned metadata, and their lifecycle is the persona's lifecycle.

**Orphaning**: if a use case is removed from `design_context.useCases`, rows
in the child tables keep their `use_case_id` pointing at a now-unknown id.
Queries filtering by `use_case_id` will return nothing for the removed id,
which is the correct behavior. The UI should handle "use_case_id references
unknown capability" gracefully (show it as "unknown / removed capability").

## Repository queries — what needs adding

Existing queries that take `persona_id` and need a `use_case_id`-aware sibling:

| Repo | Existing query | New query (Phase) |
|---|---|---|
| `triggers::` | `get_by_persona_id` | `get_by_use_case_id(persona_id, use_case_id)` — C4 |
| `events::` | `get_by_persona_id` for subscriptions | `get_by_use_case_id(persona_id, use_case_id)` — C4 |
| `executions::` | `get_by_persona_id`, `get_by_use_case_id` exists already | C3 adds `is_simulation` filter |
| `manual_reviews::` | `get_by_execution_id`, `get_by_persona_id` | `get_by_use_case_id(persona_id, use_case_id)` — C5 |
| `messages::` | `get_by_persona_id` | `get_by_use_case_id(persona_id, use_case_id)` — C5 |
| `memories::` | `get_for_injection(persona_id)` | `get_for_injection_v2(persona_id, use_case_id: Option<&str>)` — C4 (used by runtime) + C5 (column) |
| `versions::` | existing | `list_versions_for_use_case(persona_id, use_case_id)` — C6 |

## Data flow — write paths (who sets use_case_id)

| Write path | Source of use_case_id | Enforced at |
|---|---|---|
| Scheduled trigger fires | `persona_triggers.use_case_id` on the firing row | `background.rs` scheduler |
| Event matches subscription | `persona_event_subscriptions.use_case_id` | event bus dispatch |
| Manual execution from Use Case tab | Passed explicitly by frontend | `executePersona` IPC call |
| Manual execution from Chat (ad-hoc) | None (persona-wide run) | N/A |
| Simulate button | Explicit `use_case_id` | `simulate_use_case` IPC |
| Manual review created mid-execution | Inherited from `execution.use_case_id` | `review_repo::create` (post-C5) |
| Message emitted by execution | Inherited from `execution.use_case_id` | `message_repo::create` (post-C5) |
| Memory emitted by execution | Inherited from `execution.use_case_id` | `memory_repo::create` (post-C5, tier decides NULL vs scoped) |

## Orphaning & cleanup

When the user removes a capability from `design_context.useCases`:

- Dependent `persona_triggers` rows: **paused, not deleted**. The `enabled`
  cascade on disable already handles this; the removal UI should explicitly
  confirm "this will stop N triggers" and the same cascade runs.
- Dependent `persona_event_subscriptions` rows: **disabled, not deleted**.
- Historical executions / messages / reviews / memories: **retained** with
  their dangling `use_case_id`. The UI shows these as "unknown capability"
  and offers a bulk reattribute or purge action in admin mode. Deferred —
  see [10-deferred-backlog.md](10-deferred-backlog.md) §C.
