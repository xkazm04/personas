# 06 — Building Pipeline

> How personas come into being. Covers: CLI build (from scratch), template
> adoption, and the template-v2 schema rewrite for the 107 existing templates.
>
> **This is Phase C2 — lands immediately after C1 runtime foundation.**

## Two entry points

1. **From scratch**: user describes intent in the Design tab. The CLI build
   session analyzes intent and produces an `AgentIr`. The user reviews, tests,
   promotes. Produces one persona.
2. **From template**: user picks a template from the catalog, answers adoption
   questions. The adoption flow applies answers to the template's pre-built
   `AgentIr` and promotes.

Both paths converge at `promote_build_draft` (`src-tauri/src/commands/design/build_sessions.rs:1173+`),
which writes the persona + triggers + subscriptions + design_context.

Both paths need to emit the **capability-aware** AgentIr v2 for the runtime
and UI to function.

## AgentIr v2

Current `src-tauri/src/db/models/agent_ir.rs` has:

```rust
pub struct AgentIr {
  pub name: Option<String>,
  pub system_prompt: Option<String>,
  pub structured_prompt: Option<serde_json::Value>,
  pub use_cases: Vec<AgentIrUseCase>,
  pub triggers: Vec<AgentIrTrigger>,
  pub events: Vec<AgentIrEvent>,
  pub tools: Vec<AgentIrTool>,
  pub required_connectors: Vec<AgentIrConnector>,
  pub full_prompt_markdown: Option<String>,
  ...
}

pub struct AgentIrTrigger {
  pub trigger_type: String,
  pub config: serde_json::Value,
  pub description: Option<String>,
  // NO use_case_id today — link is positional via vec index
}
```

**Changes for v2** (additive; old parser tolerates missing fields):

```rust
pub struct AgentIr {
  pub name: Option<String>,

  // Behavior core — persona-wide
  pub system_prompt: Option<String>,
  pub structured_prompt: Option<serde_json::Value>,  // v2 schema: identity, voice,
                                                     //   principles, constraints,
                                                     //   decision_principles,
                                                     //   instructions, toolGuidance,
                                                     //   examples, errorHandling,
                                                     //   customSections, webSearch,
                                                     //   verbosity_default

  // Capabilities with their full envelope
  pub use_cases: Vec<AgentIrUseCase>,

  // Triggers carry their capability attribution
  pub triggers: Vec<AgentIrTrigger>,   // now has `use_case_id: Option<String>`

  // Events (separate from per-use-case event_subscriptions on use_cases[])
  pub events: Vec<AgentIrEvent>,       // persona-wide event bindings

  // Shared tools
  pub tools: Vec<AgentIrTool>,

  // Connectors (persona-wide infrastructure)
  pub required_connectors: Vec<AgentIrConnector>,

  pub full_prompt_markdown: Option<String>,
  ...
}

pub struct AgentIrTrigger {
  pub trigger_type: String,
  pub config: serde_json::Value,
  pub description: Option<String>,
  pub use_case_id: Option<String>,     // NEW — semantic linkage
}
```

`AgentIrUseCaseData` already has `event_subscriptions`. Add fields to match
`DesignUseCase` v2:

```rust
pub struct AgentIrUseCaseData {
  pub id: String,
  pub title: String,
  pub description: String,
  pub category: Option<String>,
  pub execution_mode: Option<String>,
  pub sample_input: Option<serde_json::Value>,
  pub input_schema: Option<Vec<UseCaseInputField>>,
  pub time_filter: Option<UseCaseTimeFilter>,

  pub suggested_trigger: Option<UseCaseSuggestedTrigger>,   // embedded trigger hint
  pub event_subscriptions: Option<Vec<UseCaseEventSubscription>>,
  pub notification_channels: Option<Vec<NotificationChannel>>,
  pub model_override: Option<ModelProfile>,
  pub test_fixtures: Option<Vec<TestFixture>>,
  pub tool_hints: Option<Vec<String>>,                       // NEW
  pub capability_summary: Option<String>,                    // NEW
  pub enabled: Option<bool>,                                 // NEW (default true)
}
```

## CLI build prompt changes (from-scratch path)

The CLI is asked to produce an AgentIr. The prompt wrapper in
`src-tauri/src/engine/build_session.rs` + any `cli_prompt.rs` / template
lives here. It needs updating to:

1. Describe the behavior-core vs capability split in the system prompt sent
   to the LLM.
2. Ask the model to emit capabilities as discrete `use_cases[]` entries with
   their triggers, event subscriptions, notification channels, and tool hints.
3. Ask the model to emit the **persona-level** `structured_prompt` with the
   v2 fields (voice, principles, constraints, decision_principles).
4. Ensure each trigger in `triggers[]` has a `use_case_id` referencing the
   capability it fires. The LLM is instructed to emit IDs like `uc_01`,
   `uc_02` that match `use_cases[i].id`.

Concretely, update the dimension framework prompt (`dimension_framework.md` or
equivalent if exists — audit `build_session.rs` for embedded prompt strings)
to distinguish:

- **Dimension: Persona Identity** → behavior core
- **Dimension: Capabilities** → list of capabilities, each with triggers,
  events, inputs, outputs, model preference

Current dimensions include `use-cases`, `connectors`, `triggers`, `messages`,
`human-review`, `memory`, `error-handling`, `events`. The reframe collapses
these:

- `use-cases` becomes the **primary dimension** (each capability has its own
  sub-columns for trigger / events / messages / model / review-gate / memory-tier)
- `connectors` stays persona-wide (tools shared)
- `triggers` and `events` become sub-fields of each capability row
- `messages` (notification_channels) becomes a sub-field of each capability
- `memory` is persona-wide by default, but the LLM is told that capability-specific
  learned memories are tagged with the capability's id
- `error-handling` stays in the persona's structured_prompt

The Matrix UI changes to reflect this (see [08-frontend-impact.md](08-frontend-impact.md)).

## Promotion flow (both entry points)

Updated `promote_build_draft_inner` in `build_sessions.rs`:

```
1. Extract AgentIr v2 from build session.
2. Apply adoption answers (variable substitution, config injection, credential binding).
3. Build design_context.useCases from ir.use_cases (include new fields).
4. BEGIN TRANSACTION
5. update_persona_in_tx:
     - system_prompt = ir.system_prompt
     - structured_prompt = ir.structured_prompt (now v2 shape)
     - design_context = serialized with new fields
     - last_design_result = full ir
6. create_triggers_in_tx (NEW semantic linkage):
     for each trigger in ir.triggers:
       use_case_id = trigger.use_case_id (NEW)
                  ?? positional_fallback(trigger_index, use_case_ids)
                  ?? None
       INSERT persona_triggers with use_case_id
7. create_event_subscriptions_in_tx (unchanged — already semantic)
8. create_tools_in_tx (unchanged)
9. create_version_snapshot (unchanged, tag='production')
10. COMMIT
```

**Positional fallback stays** for defensive resilience, but warns in logs
when hit. Post-migration all templates + CLI outputs should have semantic
`use_case_id` — positional fallback should go silent.

## Template v2 schema

Current template JSON (from `scripts/templates/**/*.json`):

```jsonc
{
  "id": "stock-analyst",
  "name": "Stock Analyst",
  "payload": {
    "service_flow": ["market_data_api", "news_api", "slack"],
    "structured_prompt": {
      "identity": "...",
      "instructions": "...",
      "toolGuidance": "...",
      "examples": [...],
      "errorHandling": "..."
    },
    "suggested_tools": ["http_request", "file_read", ...],
    "suggested_triggers": [
      { "trigger_type": "schedule", "config": {"cron": "0 8 * * 1"}, "description": "..." }
    ],
    "suggested_event_subscriptions": [...],
    "use_case_flows": [
      { "id": "flow_performance", "name": "Performance Analysis", "description": "...", "nodes": [...], "edges": [...] },
      { "id": "flow_gem", "name": "Gem Finder", ... },
      { "id": "flow_gov", "name": "Gov Tracker", ... }
    ],
    "adoption_questions": [...]
  }
}
```

Template v2 (breaking):

```jsonc
{
  "id": "stock-analyst",
  "schema_version": 2,                // NEW — adoption parser switches on this
  "name": "Stock Analyst",
  "payload": {
    // Behavior core — persona-wide
    "persona": {
      "description": "...",
      "icon": "...",
      "color": "...",
      "structured_prompt": {
        "identity": { "role": "Disciplined financial analyst", ... },
        "voice": { ... },
        "principles": [...],
        "constraints": [...],
        "decision_principles": [...],
        "instructions": "...",
        "toolGuidance": "...",
        "errorHandling": "...",
        "examples": [],
        "customSections": {},
        "verbosity_default": "normal"
      },
      "tools": ["http_request", "file_read"],        // full tool pool
      "required_connectors": [...],
      "notification_channels_default": [...],        // fallback when capability has none
      "service_flow": [...]
    },

    // Capabilities — first-class
    "use_cases": [
      {
        "id": "uc_performance",
        "title": "Performance Analysis",
        "description": "Analyze a ticker's price action, news context, technicals.",
        "capability_summary": "Deep-dive on a single ticker with price/news/technicals.",
        "category": "analysis",
        "enabled_by_default": true,

        "suggested_trigger": {
          "type": "manual",
          "description": "User provides a ticker symbol"
        },
        "event_subscriptions": [
          { "event_type": "ticker_analysis_requested", "source_filter": null }
        ],
        "notification_channels": [
          { "type": "email", "config_hint": "user's primary email" }
        ],
        "model_override": null,                          // inherit persona default
        "input_schema": [
          { "name": "ticker", "type": "string", "required": true }
        ],
        "sample_input": { "ticker": "NVDA" },
        "tool_hints": ["http_request"],
        "use_case_flow": { "nodes": [...], "edges": [...] },   // optional workflow diagram (from old use_case_flows)
        "test_fixtures": []
      },
      {
        "id": "uc_gem",
        "title": "Weekly Gem Finder",
        "description": "Scan news for underappreciated stocks in a sector.",
        "capability_summary": "Weekly sector-filtered screen for overlooked opportunities.",
        "category": "screening",
        "enabled_by_default": true,

        "suggested_trigger": {
          "type": "schedule",
          "config": { "cron": "0 8 * * 1" },
          "description": "Mondays at 8am"
        },
        "event_subscriptions": [],
        "notification_channels": [
          { "type": "email", "config_hint": "digest format" }
        ],
        "model_override": null,
        "input_schema": [
          { "name": "sector", "type": "string", "required": false }
        ],
        "sample_input": { "sector": "semiconductors" },
        "tool_hints": ["http_request"],
        "use_case_flow": { ... }
      },
      {
        "id": "uc_gov",
        "title": "Gov Investment Tracker",
        "description": "Alerts on notable government investment filings.",
        "capability_summary": "Monitors gov filings and surfaces signals to watch.",
        "category": "monitoring",
        "enabled_by_default": true,

        "suggested_trigger": {
          "type": "polling",
          "config": { "interval_seconds": 3600 },
          "description": "Hourly poll of gov filing feed"
        },
        "event_subscriptions": [
          { "event_type": "gov_filing_published" }
        ],
        "notification_channels": [
          { "type": "slack", "config_hint": "#stock-alerts" }
        ],
        "model_override": null,
        "input_schema": [],
        "sample_input": null,
        "tool_hints": ["http_request"]
      }
    ],

    "adoption_questions": [
      { "id": "email", "category": "setup", "question": "What email should digests go to?", "type": "text", "maps_to": "persona.notification_channels_default[0].config_hint" },
      { "id": "sectors", "category": "setup", "question": "Which sectors to scan for gems?", "type": "text", "maps_to": "use_cases[uc_gem].sample_input.sector" }
    ]
  }
}
```

Key changes:

- `use_case_flows[]` folds into `use_cases[].use_case_flow` (preserves the
  node/edge workflow diagram as optional documentation).
- `suggested_triggers[]` at the payload level disappears. Each capability
  owns its `suggested_trigger`.
- `suggested_event_subscriptions[]` at the payload level disappears. Each
  capability owns its `event_subscriptions[]`.
- `suggested_notification_channels` moves into capabilities (with a
  `notification_channels_default` fallback at persona level).
- `suggested_tools[]` becomes `persona.tools[]`; each capability declares
  `tool_hints[]` which is a subset of the persona tools list.
- `structured_prompt` gains the v2 fields (voice, principles, constraints,
  decision_principles, verbosity_default).
- `adoption_questions[].maps_to` gets richer — can target fields inside
  `use_cases[id]` as well as persona-level fields.

## 107-template migration script

A Node/Python script walks `scripts/templates/**/*.json`, reads each v1 file,
produces v2, writes it back (or to a sibling file for diff review).

**Mapping rules:**

1. Copy `payload.structured_prompt` → `payload.persona.structured_prompt`,
   **without** v2 additions. A human reviews each template and hand-writes
   the `voice`, `principles`, `constraints`, `decision_principles`. Script
   can seed these from the existing `identity` and `instructions` using
   heuristic phrase extraction but a human must approve.
2. For each `use_case_flows[i]`:
   - Create a `use_cases[i]` entry with `id`, `title` (from `name`),
     `description`.
   - Find the positional `suggested_triggers[i]` if present → embed as
     `use_cases[i].suggested_trigger`.
   - Find matching `suggested_event_subscriptions` (by event_type referenced
     in the flow's nodes/edges) → embed as `use_cases[i].event_subscriptions`.
   - Find matching `suggested_notification_channels` (by convention or by
     node references) → embed as `use_cases[i].notification_channels`.
   - Preserve the flow diagram as `use_cases[i].use_case_flow`.
3. `suggested_tools[]` → `persona.tools[]` (unchanged).
4. `adoption_questions[].maps_to` rewritten where it targets per-use-case
   fields.

**Per-template review**: each template gets a diff review before merge. The
script reports unmapped `suggested_triggers` (if count of triggers ≠ count
of flows) and flags them for manual triage.

**Evidence from prior research**: 10/10 sampled templates mechanically
convertible. One template had a shared 15-min poller driving two flows —
script emits two triggers (one per capability, both polling every 15 min,
distinguished by `description` and the event they emit). Humans verify.

## Adoption flow v2

`src-tauri/src/commands/design/template_adopt.rs` gets a `schema_version`
branch:

```rust
if template.schema_version == 2 {
    adopt_v2(template, answers)
} else {
    return Err(AppError::Unsupported("v1 templates no longer supported"));
}
```

No v1 compat shim in the running app — all templates are migrated in one pass
before we cut over.

The v2 adoption:

1. Apply variable substitutions from `adoption_questions[].maps_to` paths.
2. Construct `AgentIr` directly (no LLM involvement — templates are pre-built):
   - `structured_prompt` ← `payload.persona.structured_prompt` (with adoptee answers patched in)
   - `tools` ← `payload.persona.tools`
   - `use_cases[]` ← `payload.use_cases[]` (with answers patched, `enabled = enabled_by_default`)
   - `triggers[]` ← per-capability `suggested_trigger`, each tagged with `use_case_id` = the capability's id
   - `events[]` ← per-capability `event_subscriptions` flattened with `use_case_id`
3. Pass into `promote_build_draft_inner`. All existing transaction logic works.

## Testing the pipeline

**Gate before C3 ships**: build + adopt three capability-heavy templates and
verify:

- Triggers persist with correct `use_case_id` (not positional).
- Subscriptions persist with correct `use_case_id`.
- `design_context.useCases[]` contains v2 shape with `enabled: true` defaults.
- An end-to-end run of the "stock analyst" persona triggers all three
  capabilities on their respective schedules.
- Toggling a capability off stops its triggers and stops its prompt presence
  (confirmed via `assemble_prompt` unit tests on sample data).

Write these as integration tests in `src-tauri/tests/`. Mark the whole
test suite `#[cfg(test)]` with a small fixture-based persona.
