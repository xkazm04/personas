# 03 — Runtime

> How the engine assembles the prompt, what persona/capability data it reads,
> and how the session cache stays correct. This is **Option A**: one persona
> prompt + dynamic Capabilities section.

## §1 — Prompt assembly (end-to-end trace)

Entry: `src-tauri/src/commands/execution/executions.rs::execute_persona`

New capability-aware flow (changes marked `NEW`):

```
execute_persona(personaId, triggerId?, inputData?, useCaseId?, ...)
  │
  ├── persona_repo::get_by_id(personaId)
  │
  ├── NEW: if useCaseId is Some:
  │     design_ctx = parse(persona.design_context)
  │     use_case = design_ctx.useCases.find(id == useCaseId)
  │     if use_case.is_none(): return Err("unknown use_case_id")
  │     if use_case.enabled == Some(false): return Err("capability disabled")
  │     auto_inject use_case JSON into input_data._use_case
  │     auto_inject use_case.time_filter into input_data._time_filter (if present)
  │     auto_inject use_case.model_override into execution's ModelProfile
  │         (falls back to persona.model_profile when None)
  │
  ├── tool_repo::get_tools_for_persona(personaId)          # all persona tools
  │
  ├── NEW: compute session cache key:
  │     hash(persona.system_prompt,
  │          persona.structured_prompt,                    # now included
  │          model_profile,
  │          tool_count,
  │          active_capability_fingerprint)                # NEW
  │
  │     active_capability_fingerprint =
  │       sorted(design_ctx.useCases.filter(enabled != false).map(|uc| uc.id + "@" + uc.title))
  │       .join("|").hash()
  │
  ├── session_pool.get_or_spawn(cache_key)
  │
  └── runner.start_execution(persona, tools, input_data, memories)
        │
        └── prompt::assemble_prompt(persona, tools, input_data, memories, ...)
              │
              # Existing sections retained:
              ├── header (name, description, execution_discipline)
              ├── structured_prompt sections (identity, voice [NEW], principles [NEW],
              │                               instructions, toolGuidance, examples,
              │                               errorHandling, customSections, webSearch)
              ├── workspace_instructions
              ├── tools_documentation
              ├── protocol_tools (emit_memory, emit_message, emit_event, request_review)
              ├── platform_env_guidance
              ├── credentials
              ├── connector_usage_hints
              ├── memories (core + learned scoped to this use_case_id if present)
              ├── communication_protocols
              ├── ambient_context
              │
              ├── NEW: "## Active Capabilities" section
              │     rendered from design_ctx.useCases.filter(enabled != false)
              │     for each capability: title, capability_summary (or description),
              │                          trigger_description, tool_hints summary
              │
              ├── NEW (if input_data._use_case present):
              │     "## Current Focus" section
              │     Emphasizes which capability this execution is scoped to
              │     Includes sample_input reference and notification_channels
              │
              ├── _use_case injection (existing; now always populated if useCaseId is set)
              ├── _time_filter injection
              ├── input_data rendering
              └── EXECUTE NOW block
```

Implementation hooks in `src-tauri/src/engine/prompt.rs`:

- The existing dead-code advisory block at ~line 1380 (`if let Some(ref dc_json) = persona.design_context { ... use_cases ... }`) is **promoted**: moved into the main `assemble_prompt` flow and filtered by `enabled != false`.
- A new helper `render_active_capabilities(design_context: &str) -> String` is the single renderer, shared between this section and any advisory/ops modes.
- The existing `_use_case` block at ~line 494-509 is kept as-is; it now gets richer input because the execution entry point pre-populates `input_data._use_case` from the use case row.

## §2 — Auto-injection of capability context

Until C1, the engine **expects** the caller to put `_use_case` in `input_data`.
Callers sometimes do this, sometimes not. The fix:

When `execute_persona` receives a `useCaseId`, the command handler expands it
into the full capability JSON and merges it into `input_data._use_case` before
calling the engine. This is **mandatory**, not optional. It closes the
attribution gap.

```rust
// src-tauri/src/commands/execution/executions.rs (pseudocode for the NEW block)

if let Some(uc_id) = use_case_id.as_ref() {
    let design_ctx = parse_design_context(&persona.design_context)?;
    let use_case = design_ctx
        .use_cases
        .iter()
        .find(|uc| &uc.id == uc_id)
        .ok_or(AppError::InvalidState("use_case not found"))?;

    if use_case.enabled == Some(false) {
        return Err(AppError::InvalidState("capability disabled"));
    }

    let mut data = parse_input_data(&input_data)?;
    // Inject only if caller hasn't already provided it (caller wins)
    data.entry("_use_case")
        .or_insert_with(|| serde_json::to_value(use_case).unwrap());
    if let Some(tf) = &use_case.time_filter {
        data.entry("_time_filter")
            .or_insert_with(|| serde_json::to_value(tf).unwrap());
    }
    input_data = Some(serde_json::to_string(&data)?);

    // Model override applies if present
    if let Some(mo) = &use_case.model_override {
        effective_model_profile = merge_model_profile(&persona.model_profile, mo);
    }
}
```

The trigger scheduler (`src-tauri/src/engine/background.rs`) already passes
`use_case_id` from the trigger row when spawning an execution. With this new
expansion, scheduled triggers, event-driven triggers, and manual executions
all behave identically.

## §3 — Session cache correctness

Current hash (`executions.rs:206-210`):

```rust
let mut hasher = DefaultHasher::new();
persona.system_prompt.hash(&mut hasher);
persona.model_profile.as_deref().unwrap_or("").hash(&mut hasher);
tools.len().hash(&mut hasher);
hasher.finish()
```

**Problems:** `design_context` not included, so toggling a capability doesn't
invalidate. `structured_prompt` not included, so editing structured prompt
alone doesn't invalidate.

New hash (C1):

```rust
let mut hasher = DefaultHasher::new();
persona.system_prompt.hash(&mut hasher);
persona.structured_prompt.as_deref().unwrap_or("").hash(&mut hasher);   // NEW
persona.model_profile.as_deref().unwrap_or("").hash(&mut hasher);
tools.len().hash(&mut hasher);

// NEW: active capability fingerprint
let active: Vec<String> = parse_design_context(&persona.design_context)?
    .use_cases
    .iter()
    .filter(|uc| uc.enabled != Some(false))
    .map(|uc| format!("{}@{}", uc.id, uc.title))
    .collect();
let mut sorted = active;
sorted.sort();
sorted.join("|").hash(&mut hasher);

hasher.finish()
```

This means:

- Disabling a capability invalidates the cache → next run reassembles without it.
- Editing a capability's title invalidates the cache.
- Editing a capability's description alone does **not** invalidate (description
  is rendered in the capabilities section, but changing it is cheap and the
  model tolerates it). If we later decide description changes should invalidate,
  switch the fingerprint to `format!("{}@{}@{}", id, title, description_hash)`.

## §4 — Learned memory scoping

Current `runner.rs:484` calls `mem_repo::get_for_injection(persona_id)` with
no capability filter. Post C4:

```rust
let memories = mem_repo::get_for_injection_v2(
    &state.db,
    persona_id,
    use_case_id.as_deref(),    // NEW: when Some, return core + active-tier memories
                                //      filtered to use_case_id, plus core (unscoped)
                                //      memories.
                                //      When None, return core + active-tier (unscoped).
)?;
```

Core memories (`tier='core'`, `use_case_id IS NULL`) are always injected.
Active-tier learned memories are scoped:

- If `use_case_id` is provided: include only memories with that `use_case_id` or `IS NULL`.
- If no `use_case_id` (ad-hoc execution): include only unscoped memories.

This keeps user-level facts everywhere while letting capabilities learn in
isolation.

## §5 — Tool exposure

Unchanged in C1. All persona tools are exposed to every execution. The
Capabilities section in the prompt lists `tool_hints` per capability as
guidance:

> "For **Gem Finder**, use `news_api`, `market_screener`, `sector_index`."

The model picks. Hard tool restriction per capability is deferred (see
[10-deferred-backlog.md](10-deferred-backlog.md) §B).

## §6 — Simulation execution path

`simulate_use_case(personaId, useCaseId, inputOverride?)`:

```
1. Load persona + use case.
2. If use case.enabled == false: OK, simulation bypasses the gate (intentional).
3. Construct input_data:
     - inputOverride if provided
     - else use_case.sample_input if present
     - else {} with a sentinel _simulation_empty=true
4. Create execution row with is_simulation=true (NEW column).
5. Pass input_data with _use_case and _simulation=true injected.
6. Engine runs the same prompt assembly, same tools.
7. Dispatcher sees _simulation=true and skips real notification dispatch;
   messages are still recorded with is_simulation=true.
8. Return execution id for tailing.
```

## §7 — What the LLM sees

Example prompt fragment (abridged) for the stock analyst persona:

```
# Persona: Stock Analyst
(persona description)

## Identity
(from structured_prompt.identity)
You are a disciplined financial analyst...

## Voice
Direct, data-driven, skeptical of speculation.
Output format: Lead with the bottom line. Bullet lists for options. Data tables for comparisons.

## Principles
- Never give investment advice without disclosing uncertainty.
- Prefer primary sources over secondary.
...

## Instructions
You operate across multiple capabilities. Each run will be scoped to one capability...

## Active Capabilities
You have these active capabilities. Each has its own trigger and delivery; select the right one for the request:

- **Performance Analysis**: Analyze a ticker's price action, news context, and technicals. Trigger: manual or webhook `ticker-analysis-requested`. Notifications: email. Tools: market_data_api, news_api, technicals.
- **Weekly Gem Finder**: Scan news for underappreciated stocks in a user-chosen sector. Trigger: schedule (Mondays 8am). Notifications: email digest. Tools: news_api, market_screener, sector_index.
- **Gov Investment Tracker**: Alerts on notable government investment filings. Trigger: event `gov-filing-published`. Notifications: Slack #alerts. Tools: gov_api, filing_parser.

## Current Focus
This execution is scoped to: **Weekly Gem Finder**
- Sample input: {"sector": "semiconductors"}
- Time window: last 7 days
- Deliver to: email digest
- Suggested tools: news_api, market_screener, sector_index

(tools documentation, protocols, memories, etc.)

## Input Data
{"sector": "semiconductors"}

## EXECUTE NOW
(discipline directive, protocol requirements)
```

When called ad-hoc (no `useCaseId`), the Current Focus block is omitted and
the model chooses among Active Capabilities based on input.

## §8 — Drift and source of truth

With Option A, the persona's system prompt / structured prompt remains the
source of truth for identity, voice, and principles. The capability list is
regenerated on every execution from `design_context.useCases`. If a template
author or CLI initially bakes capability-specific language into the structured
prompt AND those capabilities are later disabled, the baked text persists but
the live Capabilities section contradicts it visibly. The model treats the
live section as authoritative (it is closer in the prompt, more recent, and
uses the "Active Capabilities" framing).

A stale-prompt lint (UI warning) is deferred — see
[10-deferred-backlog.md](10-deferred-backlog.md) §A.
