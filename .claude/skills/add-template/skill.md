# Add Persona Template to Catalog

You are creating a new persona template for the Personas Desktop template catalog. The user will describe their idea and you will guide them through a structured conversation to produce a complete, production-quality template JSON — matching the depth and quality of the 71 existing templates in `scripts/templates/`.

Templates define AI agent personas that orchestrate external services. Each template must cover: identity, instructions, tool guidance, triggers, connectors, notification channels, event subscriptions, error handling, use case flows, and design highlights.

## Input

Ask the user: **"What persona template would you like to create? Describe the agent's purpose, the services it connects, and the problem it solves."**

Wait for the user's response. Once you have the idea, proceed with the phases below.

---

## Architecture Awareness (read before Phase 1)

Before running the phases, anchor your generation in the platform's current design. The authoritative references live in `docs/concepts/persona-capabilities/` — scan `00-vision.md`, `02-use-case-as-capability.md`, `03-runtime.md`, `04-data-model.md`, and `C3-template-schema-v3.md` at minimum. The highlights below are load-bearing for template shape; verify against those docs if anything below conflicts with what you read.

### Schema v3 template shape (current)

Recent templates use `schema_version: 3` with a `payload.persona` object instead of the older flat `structured_prompt` block. The `persona` object contains:

- `goal` — one-sentence mission statement
- `identity` — `{ role, description }`
- `voice` — `{ style, output_format }`
- `principles[]` — inviolable rules
- `constraints[]` — hard "never do X" list
- `decision_principles[]` — how to resolve ambiguity
- `verbosity_default` — `silent` | `terse` | `normal` | `verbose`
- `trigger_composition`, `message_composition` — `per_use_case` or `shared`
- `operating_instructions` — multi-paragraph how-it-runs walkthrough
- `tool_guidance`, `error_handling`, `examples[]`
- `tools[]`, `connectors[]`
- `use_cases[]` — **the core composition primitive** (see below)

Older templates (`schema_version` missing or 2) use a flat `structured_prompt` with `identity`/`instructions`/`toolGuidance`/`examples`/`errorHandling` strings. **Prefer schema_version 3** for new work unless the user explicitly asks for v2 for parity with an older sibling template. Always read one recent schema_version-3 neighbor in the chosen category before generating.

### Use cases are the composition primitive — a persona is ONE agent with MANY capabilities

A persona hosts **one or more** `DesignUseCase` entries (aka capabilities). Each use case is a discrete, independently-triggerable, independently-toggleable job the persona can perform. This is NOT a separate persona per job — it is one persona that fans out to many capabilities.

Each use case has its own:

- `id`, `title`, `description`, `category`, `execution_mode`
- `sample_input`, `input_schema`, `time_filter`
- `suggested_trigger` — `schedule` | `polling` | `webhook` | (manual is always implicit)
- `event_subscriptions[]` — events this use case consumes
- `notification_channels[]` — where this use case's output lands
- `model_override` — optional per-capability model/effort
- `tool_hints[]` — tools most relevant to this capability
- `capability_summary` — one-line prompt-injected description

**When to design a multi-use-case persona (vs multiple personas):**
- The jobs share the same identity, principles, memory, and domain expertise
- They form a pipeline coordinated via events (see below)
- The user thinks of them as "the same agent doing different things"

**When to use separate personas instead:**
- The jobs have different voice/style requirements
- They need hard trust separation (one is read-only, another writes)
- They target different audiences (the user vs an external collaborator)

### Capabilities communicate via events (not direct calls)

Capabilities do not invoke each other directly. They publish/consume events through the platform event bus:

```
Use Case A         Event Bus         Use Case B
---------- emit -> ---------- route -> ----------
```

Conventions:
- Event type format: `entity.action.state` (e.g., `review_decision.approved`, `skill.update.issue_created`)
- Emitted via the `emit_event` persona protocol during execution
- Consumed via `event_subscriptions[]` on the receiving use case
- The platform auto-routes matching events to create an execution on the subscribing use case
- Filtering by `source_persona_id` on the consumer side is how you ensure a use case only reacts to its own persona's events (otherwise any persona's matching event triggers it)

This is how you decompose a "scan → propose → create issue" pipeline: one use case scans and surfaces a `manual_review`, the platform publishes `review_decision.approved` on user acceptance, and a second use case on the same persona subscribes to that event and does the follow-on work.

### 2-Phase Review — exact payload and the `context_data` caveat

When a human approves/rejects a manual review in the UI, the platform publishes `review_decision.approved` or `review_decision.rejected` with payload:

```json
{
  "review_id": "...",
  "execution_id": "...",
  "persona_id": "...",
  "title": "...",
  "decision": "approved | rejected",
  "reviewer_notes": "..."
}
```

**IMPORTANT GAP:** the event payload does NOT include the review's `context_data` field. If a downstream use case needs the full review body (diffs, proposal content, structured payload), it must fetch the review row via an IPC callback using `review_id`. Document this in your template's `error_handling` whenever a use case subscribes to `review_decision.*`.

The platform also handles Phase 2 automatically: each review decision becomes a learning memory (`category: "learned"`, importance 5, tags `["review", "approved|rejected"]`) that gets injected into future prompts. Templates get this for free — do NOT re-implement it, but DO shape `manual_review` titles/descriptions so the learnings compose meaningfully across runs.

### Multi-use-case checklist before you generate

- [ ] Is this genuinely one agent with many jobs, or multiple agents? (Default to multi-use-case if the domain is shared.)
- [ ] Does each use case have a distinct trigger (schedule / polling / webhook / event subscription)?
- [ ] Are events between use cases named `entity.action.state`?
- [ ] If a use case subscribes to `review_decision.*`, does `error_handling` mention the `context_data` fetch-back?
- [ ] Does `trigger_composition: per_use_case` (default) fit, or do multiple use cases share one trigger? Override to `shared` only when genuinely shared.
- [ ] Does `message_composition: per_use_case` (default) fit, or do all use cases write to one channel? Override to `shared` only when notifications are centralized.
- [ ] Are `tool_hints` populated per use case so the prompt renderer can scope tool visibility?

---

## Phase 1: Research & Service Discovery

Use WebSearch and WebFetch to research:

1. **Services involved** — Identify all external services/APIs the agent needs
2. **API documentation** — For each service, find:
   - API base URL
   - Authentication method (api_key, pat, oauth2, bot_token, basic, etc.)
   - Key endpoints the agent will use (5-8 per service)
   - Webhook/event capabilities
3. **Existing connectors** — Check which services already have connectors in `scripts/connectors/builtin/`. If a needed service is missing, note it for the user (they can use `/add-credential` later).
4. **Category fit** — Determine which category this template belongs to. Valid categories: `content`, `development`, `devops`, `email`, `finance`, `hr`, `legal`, `marketing`, `pipeline`, `productivity`, `project-management`, `research`, `sales`, `security`, `support`
5. **Similar templates** — Check `scripts/templates/` for existing templates that overlap. Read 1-2 of the closest matches to understand the quality bar and avoid duplication.

**Present your research findings to the user:**
```
Service Flow: [Service A] → [Service B] → [Service C]
Category: {category}
Connectors available: {list of existing connectors}
Connectors needed (not in catalog): {list or "none"}
Similar templates: {list or "none — this is novel"}
```

Ask the user to confirm or adjust before proceeding.

---

## Phase 2: Dimensional Q&A

Guide the user through structured questions covering every template dimension. Ask questions in **batches of 2-3** (not all at once) and adapt follow-ups based on their answers.

### Batch 1: Identity & Core Workflow

Ask:
1. **Identity**: What is this agent's role and authority? What does it replace or automate? (e.g., "You are the Incident Commander, replacing five separate automation workflows with unified reasoning")
2. **Core workflow steps**: Walk me through the main steps this agent performs, in order. What happens at each stage? (Aim for 5-8 major steps)
3. **State management**: What data does the agent need to persist between runs? (e.g., tracking IDs, history logs, pending queues)

### Batch 2: Triggers & Timing

Ask:
1. **Primary trigger**: What event starts this agent? Options (manual trigger is always available in the app — no need to define it):
   - `webhook` — real-time event from external service (specify path, method, source)
   - `schedule` — cron-based recurring task (specify frequency)
   - `polling` — periodic check for changes (specify interval and what to check)
2. **Secondary triggers**: Are there additional triggers? (e.g., a webhook for real-time + a scheduled reconciliation sweep, or a weekly report schedule)
3. **Trigger configuration**: For each trigger, what specific config is needed? (cron expression, webhook path, polling interval)

Note: Do NOT include `manual` triggers in `suggested_triggers` — manual execution is a built-in app capability.

### Batch 3: Human-in-the-Loop, Memory & Communication

Ask:
1. **Approval gates**: Does this agent need human approval before any actions? (e.g., before sending emails, before deploying, before making payments)

**Important — 2-Phase Review Pattern**: The platform supports a composable 2-phase pattern for human review. Templates can combine these phases as needed:

**Phase 1: Review → Event** (wired in platform):
When a human approves or rejects a manual review item, the platform automatically publishes a `review_decision.approved` or `review_decision.rejected` event to the event bus. Downstream personas can subscribe to these events. The event payload includes: `review_id`, `execution_id`, `persona_id`, `title`, `decision`, and `reviewer_notes`. Use this when review decisions should trigger other agents or create follow-on work items.

**Phase 2: Review → Memory → Recall** (wired in platform):
Agents save learnings as Memory items via the `agent_memory` protocol during execution. On future runs, the platform automatically injects the top 20 memories (by importance) into the agent's system prompt under "Agent Memory -- Prior Learnings". This creates a learning loop: the agent can recall what the user previously found valuable or invaluable and adapt its analysis accordingly. Use this when the agent should improve over time based on feedback.

**Composing both phases**: A template can use both — e.g., a triage agent presents findings for human review, the review decision emits an event (Phase 1) that downstream agents consume, AND the agent saves review patterns as memories (Phase 2) to improve its future analysis. Reports should always be delivered via the **Messages module** regardless of whether human review is configured.

When designing templates with human review, frame the review as evaluating "valuable / not valuable" findings. The accepted/rejected decisions become both events (for inter-agent coordination) and learning data (for self-improvement).
2. **Notification channels**: Where does the agent report results/status? Use generic architecture components (e.g., "messaging connector" for chat delivery, "email connector" for email) rather than naming specific services like Slack or Gmail. The user chooses their messaging platform when adopting the template.
3. **Alert severity**: Does the agent have different communication paths based on severity/importance? (e.g., critical → messaging channel, low → local log only)

### Batch 4: Error Handling & Resilience

Ask:
1. **Per-service failures**: What should happen if each external service is unavailable? (e.g., if Slack fails, queue messages; if the primary API fails, use cached data)
2. **Data integrity**: What are the edge cases? (duplicate events, missing fields, corrupted state, race conditions)
3. **Rate limits**: Which services have rate limits the agent should respect? What's the backoff strategy?

### Batch 5: Inter-Agent Communication

Ask:
1. **Events emitted**: Does this agent publish events that other personas could subscribe to? (e.g., `incident_opened`, `report_generated`, `approval_requested`). Use the pattern `entity.action.state`.
2. **Events consumed**: Does this agent subscribe to events from other personas? (e.g., listening for `deployment.completed` from a CI/CD agent)
3. **Memory**: Does the agent need to remember patterns across runs? (e.g., learning which alerts auto-heal, tracking user preferences)

---

## Phase 3: Template Generation

After collecting all answers, generate the complete template JSON. Follow this exact structure (reference existing templates in `scripts/templates/` for quality benchmarks):

### 3a. Determine metadata

- **id**: kebab-case derived from name (e.g., `incident-commander`, `sales-pipeline-autopilot`)
- **name**: Human-readable title
- **description**: 1-2 sentence elevator pitch covering what the agent does and which services it connects
- **icon**: Choose a Lucide icon name that best represents the agent's function. Common icons used in existing templates: `Siren`, `GitPullRequest`, `Mail`, `BarChart3`, `Shield`, `Calendar`, `Database`, `Bot`, `Workflow`, `Zap`, `Eye`, `Bell`, `FileText`, `Users`, `Rocket`, `Target`, `TrendingUp`, `Clock`, `Search`, `Lock`
- **color**: Choose a hex color that fits the domain (e.g., red for alerts, blue for analytics, green for automation, orange for DevOps)
- **category**: Array with 1-2 categories from the valid list

### 3b. Generate structured_prompt

This is the most critical section. Each sub-field must be detailed and technically accurate:

- **identity** (~100-300 words): Agent persona description. Include what it replaces, its authority scope, and core principles. Reference the specific services it orchestrates.

- **instructions** (~500-1500 words): Multi-section step-by-step execution guide with numbered steps. Use markdown headers (`## Step Name`). Cover:
  - Event/input processing
  - Data enrichment and context lookup
  - Decision logic with explicit criteria
  - Actions per decision branch
  - State updates and logging
  - Cleanup and post-processing

- **toolGuidance** (~300-800 words): Concrete API documentation per service. Format:
  ```
  ## http_request — {Service Name}
  Base: `{api_base_url}`
  - `METHOD /endpoint` — Description. Body: `{example}`
  Headers: `{auth_header}` injected from {connector_name} connector.
  ```
  Include real API endpoints from your Phase 1 research.

- **examples** (~200-500 words): 2-3 real-world scenarios showing agent reasoning. Format:
  ```
  ## Example N: {Scenario Title}
  **Input**: {what triggers this scenario}
  **Agent reasoning**: {how it decides what to do}
  **Actions taken**: {specific API calls and results}
  ```

- **errorHandling** (~200-500 words): Per-service failure handling, data integrity safeguards, rate limit strategies, and unexpected input handling.

- **customSections** (optional): Array of `{ title, content }` for domain-specific rules (field mappings, classification matrices, SLA definitions, etc.)

### 3c. Generate remaining payload fields

- **suggested_parameters**: Array of free parameter definitions. Parameters are runtime-adjustable values (thresholds, caps, limits) that users can change without triggering a rebuild. Templates should define parameters for any numeric threshold, limit, or configurable value referenced in the instructions. Parameters are injected into prompts via `{{param.key_name}}` syntax.
  ```json
  [
    {
      "key": "parameter_key",
      "label": "Display Label",
      "type": "number|string|boolean|select",
      "default_value": 100,
      "value": 100,
      "description": "What this parameter controls",
      "unit": "$|%|ms|items",
      "min": 0,
      "max": 10000,
      "options": ["option1", "option2"]
    }
  ]
  ```
  When generating instructions and prompt, reference parameters as `{{param.key}}` so they're substituted at runtime.

- **suggested_tools**: Typically `["http_request", "file_read", "file_write"]`.

- **suggested_triggers**: Array of trigger objects:
  ```json
  {
    "trigger_type": "webhook|schedule|polling",
    "config": { ... },
    "description": "Why this trigger exists"
  }
  ```

- **full_prompt_markdown**: Complete, self-contained system prompt in markdown. This should be a polished, readable version combining identity + instructions + tool guidance + examples + error handling. Use headers, tables, and code blocks. This is what the LLM actually receives at runtime.

- **summary**: One paragraph (~3-5 sentences) overview of the agent.

- **design_highlights**: Exactly 4 categories with 3-4 items each:
  ```json
  [
    { "category": "Category Name", "icon": "emoji", "color": "color-name", "items": ["Feature 1", "Feature 2", "Feature 3", "Feature 4"] }
  ]
  ```
  Common category themes: Intelligence, Reliability, Communication, Automation, Security, Analytics, Integration.

- **suggested_connectors**: For each service, provide:
  ```json
  {
    "name": "service_name",
    "label": "Display Name",
    "auth_type": "api_key|pat|oauth2|bot_token|basic",
    "credential_fields": [
      { "key": "field_name", "label": "Label", "type": "password|text|url", "placeholder": "...", "helpText": "Where to find this", "required": true }
    ],
    "setup_instructions": "Step-by-step guide...",
    "related_tools": ["http_request"],
    "related_triggers": [0],
    "api_base_url": "https://...",
    "role": "functional_role",
    "category": "service_category"
  }
  ```

- **suggested_notification_channels**: Array of notification targets. Use generic architecture roles (e.g., `"type": "messaging"` not `"type": "slack"`) so the user can choose their platform during adoption:
  ```json
  { "type": "messaging|email|webhook", "description": "When used", "required_connector": "connector_name", "config_hints": { "channel": "#channel-suggestion" } }
  ```

- **suggested_event_subscriptions**: Events emitted/consumed:
  ```json
  { "event_type": "entity.action", "description": "What triggers this and who consumes it" }
  ```

- **use_case_flows**: 2-3 workflow diagrams as node-edge graphs. Each flow:
  ```json
  {
    "id": "flow_N",
    "name": "Flow Name",
    "description": "What this flow accomplishes",
    "nodes": [
      { "id": "nN", "type": "start|action|decision|connector|event|error|end", "label": "...", "detail": "..." }
    ],
    "edges": [
      { "id": "eN", "source": "nN", "target": "nN", "label": "optional", "variant": "yes|no|error" }
    ]
  }
  ```
  Node types:
  - `start`: Entry point
  - `action`: Internal processing step
  - `decision`: Branching logic (should have yes/no edges)
  - `connector`: External API call (include `"connector": "name"`)
  - `event`: Emitting an event for other agents
  - `error`: Error handling path
  - `end`: Terminal node

### 3d. Write the template file

Write the complete JSON to: `scripts/templates/{category}/{id}.json`

The JSON must be valid and properly formatted with 2-space indentation. The top-level structure is:
```json
{
  "id": "...",
  "name": "...",
  "description": "...",
  "icon": "...",
  "color": "...",
  "category": [...],
  "service_flow": [...],
  "payload": {
    "service_flow": [...],
    "structured_prompt": { ... },
    "suggested_tools": [...],
    "suggested_triggers": [...],
    "full_prompt_markdown": "...",
    "summary": "...",
    "design_highlights": [...],
    "suggested_connectors": [...],
    "suggested_notification_channels": [...],
    "suggested_event_subscriptions": [...],
    "suggested_parameters": [...],
    "use_case_flows": [...]
  }
}
```

---

## Phase 4: Validation

### 4a. Structural validation

Verify the generated JSON:
1. Valid JSON (parse it)
2. All required top-level fields present: `id`, `name`, `description`, `icon`, `color`, `category`, `service_flow`, `payload`
3. All required payload fields present: `structured_prompt`, `suggested_tools`, `suggested_triggers`, `full_prompt_markdown`, `summary`, `design_highlights`, `suggested_connectors`, `use_case_flows`
4. `structured_prompt` has all sub-fields: `identity`, `instructions`, `toolGuidance`, `examples`, `errorHandling`
5. `design_highlights` has exactly 4 entries with 3-4 items each
6. `use_case_flows` has at least 2 flows
7. Each flow has valid node types and edges that form a connected graph
8. All connector names in `suggested_connectors` are lowercase and use underscores

### 4b. Cross-reference validation

1. Every connector referenced in `suggested_notification_channels[].required_connector` exists in `suggested_connectors`
2. Every trigger index in `suggested_connectors[].related_triggers` is valid
3. Connector names referenced in flow nodes match `suggested_connectors` entries
4. No duplicate IDs in flow nodes or edges

### 4c. Quality check

Read the generated template and compare against an existing template of similar complexity (e.g., `scripts/templates/devops/incident-commander.json`). Verify:
1. `instructions` section has at least 5 numbered steps
2. `toolGuidance` has real API endpoints (not placeholder URLs)
3. `examples` has at least 2 concrete scenarios
4. `errorHandling` covers per-service failures
5. Flow diagrams have at least 5 nodes each

Fix any issues found before proceeding.

---

## Phase 5: Publish to Supabase Catalog

After writing the local template file, publish it to the public Supabase template catalog.

### 5a. Determine catalog metadata

Ask the user:
1. **Complexity**: Is this template `simple` (1-2 services, basic workflow), `medium` (2-3 services, conditional logic), or `advanced` (4+ services, complex orchestration)?
2. **Featured**: Should this template be featured/highlighted in the catalog? (default: no)
3. **Tags**: Suggest 3-5 searchable tags based on the template content (e.g., `["incident-response", "monitoring", "alerting", "devops", "pagerduty"]`)

### 5b. Insert into Supabase

Use the Supabase service role key from `.env` (`SUPABASE_SERVICE_ROLE_KEY`) and the project URL derived from the anon key JWT ref (`pvfwxilvzjzzjhdcpucu`):

```bash
# Read values from .env
SUPABASE_URL="https://pvfwxilvzjzzjhdcpucu.supabase.co"
# Use SUPABASE_SERVICE_ROLE_KEY from .env
```

Insert the template via PostgREST:
```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/template_catalog" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{template_catalog_payload}'
```

The payload maps from the template JSON to the catalog columns:
- `id` → `id`
- `name` → `name`
- `description` → `description`
- `icon` → `icon`
- `color` → `color`
- `category` → `category` (text array)
- `service_flow` → `service_flow` (text array)
- `payload.structured_prompt` → `structured_prompt` (jsonb)
- `payload.full_prompt_markdown` → `full_prompt_markdown`
- `payload.summary` → `summary`
- `payload.suggested_tools` → `suggested_tools` (text array)
- `payload.suggested_triggers` → `suggested_triggers` (jsonb)
- `payload.suggested_connectors` → `suggested_connectors` (jsonb)
- `payload.suggested_notification_channels` → `suggested_notification_channels` (jsonb)
- `payload.suggested_event_subscriptions` → `suggested_event_subscriptions` (jsonb)
- `payload.use_case_flows` → `use_case_flows` (jsonb)
- `payload.design_highlights` → `design_highlights` (jsonb)
- Plus catalog-specific fields: `tags`, `complexity`, `is_featured`, `is_published: true`, `author: "personas-team"`

### 5c. Verify publication

Query the catalog to confirm the template is accessible:
```bash
curl -s "$SUPABASE_URL/rest/v1/template_catalog?id=eq.{template_id}&select=id,name,category,is_published" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"
```

---

## Phase 6: Summary

Print a completion summary:

```
Template Created: {name}
  ID:          {id}
  Category:    {category}
  Services:    {service_flow joined with " → "}
  Triggers:    {trigger count} ({types listed})
  Connectors:  {connector count} ({names listed})
  Flows:       {flow count} use case flows
  Complexity:  {complexity}

Files created:
  + scripts/templates/{category}/{id}.json

Supabase catalog:
  Published: {yes/no}
  Featured:  {yes/no}
  Public URL: {SUPABASE_URL}/rest/v1/template_catalog?id=eq.{id}

{If any connectors are not in the builtin catalog:}
Missing connectors (run /add-credential for each):
  - {connector_name}: {service_label}
```

---

## Quality Reference

When generating templates, match the depth and style of these reference templates:
- **DevOps**: `scripts/templates/devops/incident-commander.json` — 726 lines, 3 services, 3 triggers, 3 flows
- **Sales**: `scripts/templates/sales/sales-pipeline-autopilot.json` — complex CRM orchestration
- **Content**: `scripts/templates/content/cms-sync-use-case.json` — multi-service content sync
- **Productivity**: `scripts/templates/productivity/appointment-orchestrator.json` — scheduling automation

Read one of these before generating to calibrate quality expectations.
