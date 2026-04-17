# Persona data model

Everything a persona is, on disk. The `personas` table is the primary
row; a dozen join tables hang off `persona_id`.

## The `Persona` struct

`src-tauri/src/db/models/persona.rs` (line ~344). TS binding at
`src/lib/bindings/Persona.ts` (camelCase via `#[serde(rename_all =
"camelCase")]` in the JSON interchange path).

| Field | Type | Purpose |
|---|---|---|
| `id` | `String` | Primary key (UUID). |
| `project_id` | `String` | Logical isolation between projects (default: `"default"`). |
| `name` | `String` | Display name in the sidebar and gallery. |
| `description` | `Option<String>` | Markdown description shown in the persona editor. |
| `system_prompt` | `String` (NOT NULL) | The core Claude system prompt. Assembled at execution time with memory, tool guidance, and input context. |
| `structured_prompt` | `Option<String>` | JSON object with named subsections (see below). Parsed and formatted into the system prompt. |
| `icon` | `Option<String>` | Icon reference (`agent-icon:<id>` form after `normalize_agent_icon`). |
| `color` | `Option<String>` | Hex color for the UI chip. |
| `enabled` | `bool` | Master switch: false disables all triggers + manual invocation. |
| `sensitive` | `bool` | Marks personas that handle PII/financial/health data. Surfaces in audit logs, may gate auto-approval depending on org policy. |
| `headless` | `bool` | When true, tool calls auto-approve regardless of `trust_level`. For fully-automated personas with no human in the loop. |
| `max_concurrent` | `i32` | Max simultaneous executions (default 1 = serial). |
| `timeout_ms` | `i32` | Per-execution timeout (default 300_000 ms = 5 min). |
| `notification_channels` | `Option<String>` | **Encrypted JSON** array of channel configs (Slack, email, webhook, …). |
| `last_design_result` | `Option<String>` | JSON snapshot of the `AgentIr` that promoted this persona. Used by the Design tab to show the original template-level intent. |
| `model_profile` | `Option<String>` | JSON override for model/provider/base_url/auth. Falls back to workspace → global defaults. |
| `max_budget_usd` | `Option<f64>` | Optional hard cap on monthly cost. Executions fail fast if current spend ≥ this. |
| `max_turns` | `Option<i32>` | Optional cap on agentic loop iterations (tool calls) per execution. |
| `design_context` | `Option<String>` | JSON envelope (`DesignContextData`) with design files, credential links, use cases, twin pin, connector pipeline. |
| `group_id` | `Option<String>` | FK to `persona_groups` — organizes personas into collapsible UI groups (workspaces). |
| `source_review_id` | `Option<String>` | FK back to the `persona_design_reviews` row that created this persona via adoption. |
| `trust_level` | `PersonaTrustLevel` | `manual` \| `verified` \| `revoked` — gates tool-call auto-approval. |
| `trust_origin` | `PersonaTrustOrigin` | `builtin` \| `user` \| `system` — where trust was assigned. |
| `trust_verified_at` | `Option<String>` | ISO8601 timestamp of last trust verification. |
| `trust_score` | `f64` | 0.0–1.0 derived metric from execution history. |
| `parameters` | `Option<String>` | JSON array of `PersonaParameter` — user-tunable values that don't require a rebuild. |
| `gateway_exposure` | `PersonaGatewayExposure` | `local_only` \| `invite_only` \| `public` — external HTTP API visibility. |
| `created_at` / `updated_at` | `String` | ISO8601 timestamps. |

## The `personas` table

`src-tauri/src/db/migrations/schema.rs` (line ~22):

```sql
CREATE TABLE IF NOT EXISTS personas (
    id                      TEXT PRIMARY KEY,
    project_id              TEXT NOT NULL DEFAULT 'default',
    name                    TEXT NOT NULL,
    description             TEXT,
    system_prompt           TEXT NOT NULL,
    structured_prompt       TEXT,
    icon                    TEXT,
    color                   TEXT,
    enabled                 INTEGER NOT NULL DEFAULT 1,
    sensitive               INTEGER NOT NULL DEFAULT 0,
    max_concurrent          INTEGER NOT NULL DEFAULT 1,
    timeout_ms              INTEGER NOT NULL DEFAULT 300000,
    notification_channels   TEXT,
    last_design_result      TEXT,
    model_profile           TEXT,
    max_budget_usd          REAL,
    max_turns               INTEGER,
    design_context          TEXT,
    group_id                TEXT REFERENCES persona_groups(id) ON DELETE SET NULL,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
);
CREATE INDEX idx_personas_enabled ON personas(enabled);
CREATE INDEX idx_personas_group_id ON personas(group_id);
```

Fields added via migrations (see `incremental.rs`): `headless`,
`source_review_id`, `trust_level`, `trust_origin`, `trust_verified_at`,
`trust_score`, `parameters`, `gateway_exposure`.

## The `structured_prompt` JSON

When set, it's a JSON object with these canonical subsections:

```json
{
  "identity":      "Role, persona description, values, constraints",
  "instructions":  "Core logic, workflow steps, decision rules, protocol cues",
  "toolGuidance":  "How to use each available tool, when to use them, what to expect",
  "examples":      "Concrete input/output examples showing the persona in action",
  "errorHandling": "How to recover from tool failures, rate limits, API errors"
}
```

Assembly in `src-tauri/src/engine/prompt.rs` merges these into the
system prompt at execution time. Templates populate them during design
(see [templates/01-template-format.md](../templates/01-template-format.md)).

The adoption answer pipeline injects a `configuration` key too, with
the user's answers as a markdown list — see
[templates/07-adoption-answer-pipeline.md](../templates/07-adoption-answer-pipeline.md).

## The `design_context` envelope

`DesignContextData` in `persona.rs`:

```rust
pub struct DesignContextData {
    pub design_files: Option<DesignFilesSection>,     // { files[], references[] }
    pub credential_links: Option<HashMap<String, String>>, // connector → credential_id
    pub use_cases: Option<Vec<DesignUseCase>>,        // structured use-case specs
    pub summary: Option<String>,
    pub connector_pipeline: Option<Vec<ConnectorPipelineStep>>,
    pub twin_id: Option<String>,                      // pinned twin profile
}
```

**`DesignUseCase`** — each use case carries optional `suggested_trigger`,
`model_override`, `notification_channels`, `event_subscriptions`,
`input_schema`, `sample_input` so the UI can render a ready-to-run
template per use case.

**Two-format legacy handling**: `parse_design_context()` first tries
the new envelope, falls back to flat `{files, references}` form for
pre-envelope personas. Always use the helper — never parse raw SQL.

## Associated join tables

All join tables use `persona_id TEXT NOT NULL REFERENCES personas(id)
ON DELETE CASCADE` unless noted. Deleting a persona cascades cleanly.

### `persona_tools` + `persona_tool_definitions`

Two-table setup: definitions are shared catalog entries, the join
assigns a tool to a persona with optional per-persona config.

```sql
CREATE TABLE persona_tool_definitions (
    id                       TEXT PRIMARY KEY,
    name                     TEXT NOT NULL UNIQUE,
    category                 TEXT NOT NULL,
    description              TEXT NOT NULL,
    script_path              TEXT NOT NULL,
    input_schema             TEXT,
    output_schema            TEXT,
    requires_credential_type TEXT,   -- gates credential resolution
    implementation_guide     TEXT,   -- curl template for API tools
    is_builtin               INTEGER NOT NULL DEFAULT 0,
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL
);

CREATE TABLE persona_tools (
    id          TEXT PRIMARY KEY,
    persona_id  TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    tool_id     TEXT NOT NULL REFERENCES persona_tool_definitions(id),
    tool_config TEXT,  -- tool-specific JSON (overrides/specializes)
    created_at  TEXT NOT NULL,
    UNIQUE(persona_id, tool_id)
);
```

Three tool kinds by category + script_path:
- **Script tools**: `npx tsx {script_path}` with JSON I/O
- **API tools**: `curl` templated from `implementation_guide`
- **Automation tools**: virtual, bridged to `persona_automations`
  (category == `"automation"`, id format `auto_{automation_id}`)

### `persona_triggers`

```sql
CREATE TABLE persona_triggers (
    id                TEXT PRIMARY KEY,
    persona_id        TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    trigger_type      TEXT NOT NULL CHECK(trigger_type IN
                        ('manual', 'schedule', 'polling', 'webhook', 'chain',
                         'event_listener', 'file_watcher', 'clipboard',
                         'app_focus', 'composite')),
    config            TEXT,              -- type-specific JSON
    enabled           INTEGER NOT NULL DEFAULT 1,
    last_triggered_at TEXT,
    next_trigger_at   TEXT,              -- pre-computed for the scheduler loop
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
```

`TriggerConfig` variants and their config shapes are documented in
[02-capabilities.md](02-capabilities.md#triggers) and in
[execution/01-entry-points.md](../execution/01-entry-points.md).

### `persona_event_subscriptions`

```sql
CREATE TABLE persona_event_subscriptions (
    id            TEXT PRIMARY KEY,
    persona_id    TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    event_type    TEXT NOT NULL,
    source_filter TEXT,                  -- wildcard: "prod-*"
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
```

Subscriptions are a **legacy path** parallel to `event_listener`
triggers. The event bus matches against both in the same tick. New
work prefers triggers for consistency; subscriptions linger on older
personas.

### `persona_automations` + `automation_runs`

External workflow integration (n8n, Zapier, GitHub Actions, custom
webhook). Stored in `incremental.rs`:

```sql
CREATE TABLE persona_automations (
    id                     TEXT PRIMARY KEY,
    persona_id             TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    use_case_id            TEXT,
    name                   TEXT NOT NULL,
    description            TEXT DEFAULT '',
    platform               TEXT NOT NULL,   -- n8n | github_actions | zapier | custom
    platform_workflow_id   TEXT,
    platform_url           TEXT,
    webhook_url            TEXT,
    webhook_method         TEXT DEFAULT 'POST',
    platform_credential_id TEXT REFERENCES persona_credentials(id),
    credential_mapping     TEXT,             -- JSON: inputs → credential fields
    input_schema           TEXT,             -- JSON Schema
    output_schema          TEXT,
    timeout_ms             INTEGER DEFAULT 30000,
    retry_count            INTEGER DEFAULT 1,
    fallback_mode          TEXT DEFAULT 'connector',  -- connector | fail | skip
    deployment_status      TEXT DEFAULT 'draft',      -- draft | active | paused | error
    last_triggered_at      TEXT,
    last_result_status     TEXT,
    error_message          TEXT,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL
);

CREATE TABLE automation_runs (
    id                TEXT PRIMARY KEY,
    automation_id     TEXT NOT NULL REFERENCES persona_automations(id) ON DELETE CASCADE,
    execution_id      TEXT REFERENCES persona_executions(id),
    status            TEXT DEFAULT 'pending',
    input_data        TEXT,
    output_data       TEXT,
    platform_run_id   TEXT,
    platform_logs_url TEXT,
    duration_ms       INTEGER,
    error_message     TEXT,
    started_at        TEXT DEFAULT (datetime('now')),
    completed_at      TEXT
);
```

An active automation gets injected as a **virtual tool** into the
tool list at execution start. See
[02-capabilities.md](02-capabilities.md#automations).

### `persona_memories`

```sql
CREATE TABLE persona_memories (
    id                  TEXT PRIMARY KEY,
    persona_id          TEXT NOT NULL,
    title               TEXT NOT NULL,
    content             TEXT NOT NULL,
    category            TEXT DEFAULT 'fact',
    source_execution_id TEXT,
    importance          INTEGER DEFAULT 3,     -- 1–5
    tags                TEXT,                  -- JSON array of strings
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now'))
);
```

Extended model (in `memory.rs`) adds `tier` (`core` | `active` |
`archive`), `access_count`, `last_accessed_at`. Lifecycle transitions
(promote/archive) run on every execution — see
[execution/02-lifecycle.md](../execution/02-lifecycle.md#memory-injection).

### `persona_manual_reviews` + `review_messages`

Human-approval protocol. Every review row represents one
"please-approve-this" request emitted by the persona during execution.

```sql
CREATE TABLE persona_manual_reviews (
    id                TEXT PRIMARY KEY,
    execution_id      TEXT NOT NULL REFERENCES persona_executions(id),
    persona_id        TEXT NOT NULL REFERENCES personas(id),
    title             TEXT NOT NULL,
    description       TEXT,
    severity          TEXT DEFAULT 'info',    -- info | warning | critical
    context_data      TEXT,
    suggested_actions TEXT,                    -- JSON array of strings
    status            TEXT DEFAULT 'pending',  -- pending | approved | rejected | resolved
    reviewer_notes    TEXT,
    resolved_at       TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE TABLE review_messages (
    id         TEXT PRIMARY KEY,
    review_id  TEXT NOT NULL REFERENCES persona_manual_reviews(id),
    role       TEXT DEFAULT 'user',   -- user | assistant | system
    content    TEXT NOT NULL,
    metadata   TEXT,
    created_at TEXT NOT NULL
);
```

See [execution/03-chaining-and-approval.md](../execution/03-chaining-and-approval.md).

### `persona_messages` + `persona_message_deliveries`

Outbound notifications. A single `persona_messages` row fans out to
one or more delivery rows (one per channel).

```sql
CREATE TABLE persona_messages (
    id           TEXT PRIMARY KEY,
    persona_id   TEXT NOT NULL,
    execution_id TEXT,
    title        TEXT,
    content      TEXT NOT NULL,
    content_type TEXT DEFAULT 'text',    -- text | markdown | json
    priority     TEXT DEFAULT 'normal',  -- low | normal | high | critical
    is_read      INTEGER DEFAULT 0,
    metadata     TEXT,
    thread_id    TEXT,                    -- groups related messages
    created_at   TEXT NOT NULL,
    read_at      TEXT
);

CREATE TABLE persona_message_deliveries (
    id            TEXT PRIMARY KEY,
    message_id    TEXT NOT NULL,
    channel_type  TEXT NOT NULL,          -- slack | email | webhook | sms | …
    status        TEXT DEFAULT 'pending',
    error_message TEXT,
    external_id   TEXT,                    -- e.g. Slack message TS
    delivered_at  TEXT,
    created_at    TEXT NOT NULL
);
```

### `persona_executions` + `persona_tool_usage`

Execution history. `persona_executions` stores the run record; join
with `persona_tool_usage` for per-tool invocation counts.

See [execution/04-observability.md](../execution/04-observability.md)
for the full field list — the execution table lives in the execution
pillar because that's where it gets written.

### `persona_prompt_versions`

Prompt version history for A/B testing and rollback:

```sql
CREATE TABLE persona_prompt_versions (
    id                TEXT PRIMARY KEY,
    persona_id        TEXT NOT NULL,
    version_number    INTEGER NOT NULL,
    structured_prompt TEXT,
    system_prompt     TEXT,
    change_summary    TEXT,
    tag               TEXT DEFAULT 'experimental',  -- experimental | production | archived
    created_at        TEXT DEFAULT (datetime('now'))
);
```

Written by `promote_build_draft_inner` on every promotion. The Lab
Matrix uses this to A/B test prompt variants.

## Enums summary

```rust
PersonaTrustLevel:    Manual | Verified (default) | Revoked
PersonaTrustOrigin:   Builtin (default) | User | System
PersonaGatewayExposure: LocalOnly (default) | InviteOnly | Public
ParamType:            Number | String | Boolean | Select
DesignFileKind:       ApiSpec | Schema | McpConfig | Other
HealthStatus:         Healthy | Degraded | Failing | Dormant
```

All `#[serde(rename_all = "snake_case")]` except `DesignFileKind` which
uses `kebab-case`.

## Files

| File | Role |
|---|---|
| `src-tauri/src/db/models/persona.rs` | `Persona` struct + enums + `DesignContextData` envelope |
| `src-tauri/src/db/models/tool.rs` | Tool definitions and persona-tool join |
| `src-tauri/src/db/models/trigger.rs` | `PersonaTrigger` + `TriggerConfig` enum |
| `src-tauri/src/db/models/memory.rs` | Memory with tiers and access tracking |
| `src-tauri/src/db/models/review.rs` | Manual review types |
| `src-tauri/src/db/models/automation.rs` | External automation models |
| `src-tauri/src/db/migrations/schema.rs` | Base CREATE TABLE statements |
| `src-tauri/src/db/migrations/incremental.rs` | Added-column migrations per feature |
| `src-tauri/src/db/repos/core/personas.rs` | CRUD + queries |
| `src-tauri/src/commands/core/personas.rs` | Tauri IPC for persona CRUD |
