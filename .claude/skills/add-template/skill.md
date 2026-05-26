# Add Persona Template to Catalog

You are creating a new persona template for the Personas Desktop template catalog. The user will describe their idea and you will guide them through a structured conversation to produce a complete, production-quality template JSON — matching the depth and quality of the 100+ existing templates in `scripts/templates/`.

Templates define AI agent personas that orchestrate external services. Each template must cover: identity, instructions, tool guidance, triggers, connectors, notification channels, event subscriptions, error handling, use case flows, and design highlights.

## Input

Ask the user: **"What persona template would you like to create? Describe the agent's purpose, the services it connects, and the problem it solves."**

Wait for the user's response. Once you have the idea, proceed with the phases below.

---

## Architecture Awareness (read before Phase 1)

Before running the phases, anchor your generation in the platform's current design. The authoritative, current references live in **`docs/features/templates/`** — scan `01-template-format.md`, `02-catalog-loading.md`, `03-adoption-flow.md`, and `04-adoption-questionnaire.md` at minimum (and `08-team-presets.md` if bundling). The older `docs/concepts/persona-capabilities/*` design notes were archived to `docs/_archive/concepts/persona-capabilities/` — background only. The highlights below are load-bearing for template shape; the **"Schema v3 file shape + recipe seeds"** section further down is canonical for the actual file you write.

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

### 2-Phase Review — exact payload

When a human approves/rejects a manual review in the UI, the platform publishes `review_decision.approved` or `review_decision.rejected` with payload:

```json
{
  "review_id": "...",
  "execution_id": "...",
  "persona_id": "...",
  "title": "...",
  "decision": "approved | rejected",
  "reviewer_notes": "...",
  "context_data": "<stringified JSON or null>"
}
```

`context_data` carries the original review's structured payload (the surfacing persona writes it when calling `manual_review`). Downstream use cases subscribing to `review_decision.*` should read `payload.context_data` directly — no IPC fetch-back required. Keep a defensive `manual_review` fallback for the edge case where `context_data` is null (old events re-played, or the surfacing persona didn't populate it).

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

## Schema v3 file shape + recipe seeds — CANONICAL (follow this, not the v2 skeleton in Phase 3d/4)

> **Read first:** the authoritative, current reference is **`docs/features/templates/`**
> (`01-template-format.md`, `02-catalog-loading.md`, `03-adoption-flow.md`,
> `04-adoption-questionnaire.md`, `08-team-presets.md`). The older
> `docs/concepts/persona-capabilities/*` set has been archived to
> `docs/_archive/concepts/persona-capabilities/` — use it for background only.
>
> **Phase 3d's JSON skeleton and Phase 4a's validation checklist below describe
> the LEGACY v2 shape** (`payload.structured_prompt` + `design_highlights` +
> `use_case_flows` inline). **For `schema_version: 3` (the default for all new
> work) follow THIS section instead** — a correct v3 template has none of
> `structured_prompt` / `design_highlights` / inline `use_case_flows` at the
> payload top level, so the Phase 4a checks would wrongly fail it.

**Gold-standard v3 references to open before generating** (all current, all pass
checksums): `scripts/templates/development/qa-guardian.json`,
`scripts/templates/development/solution-architect.json`,
`scripts/templates/security/security-sentinel.json`.

### v3 top-level shape

```jsonc
{
  "id": "kebab-id",
  "schema_version": 3,
  "name": "...", "description": "...", "icon": "LucideIcon", "color": "#hex",
  "category": ["development"],          // 1-2 of: content, development, devops,
                                        // email, finance, hr, legal, marketing,
                                        // productivity, project-management,
                                        // research, sales, security, support
  "is_published": true,                 // REQUIRED — false ⇒ checksum gen + catalog
                                        // loader SKIP it (template never appears)
  "service_flow": ["Codebase", "Messages"],
  "payload": {
    "service_flow": [...],
    "persona": {
      "goal": "...", "identity": { "role": "...", "description": "..." },
      "voice": { "style": "...", "output_format": "..." },
      "principles": [...], "constraints": [...], "decision_principles": [...],
      "verbosity_default": "normal",     // deprecated (lint warns) — leave "normal" or ""
      "trigger_composition": "per_use_case", "message_composition": "per_use_case",
      "operating_instructions": "...", "tool_guidance": "...", "error_handling": "...",
      "examples": [],                    // deprecated — keep []
      "tools": ["http_request", "file_read", "file_write"],
      "connectors": [ /* see §connectors; every OPTIONAL connector NEEDS fallback_note */ ],
      "notification_channels_default": [ { "type": "messaging", "description": "..." } ],
      "core_memories": []
    },
    "use_cases": [                        // v3: recipe_refs ONLY, no inline use cases
      { "recipe_ref": { "id": "<recipe-uuid>", "version": "1.0.0", "bindings": {} } }
    ],
    "adoption_questions": [ /* see §adoption_questions */ ],
    "persona_meta": { "name": "T: <Name>", "icon": "LucideIcon", "color": "#hex" }
  }
}
```

### Recipe seeds — how `use_cases[].recipe_ref` actually resolves (DO NOT SKIP)

In v3, the use-case detail (sample_input, input_schema, review_policy,
memory_policy, event_subscriptions, use_case_flow, tool_hints, error_handling)
does **not** live inline — it lives in a **recipe row** in
`scripts/templates/_recipe_seeds.json`, and the template only references it by
`recipe_ref.id`. A `recipe_ref` whose id has no matching recipe row will not
hydrate at adoption. You MUST create the recipe rows:

1. Each recipe row: `{ id (uuid, == recipe_ref.id), source_template_id,
   source_use_case_id ("uc_<slug>"), source_use_case_name, source_version "1.0.0",
   name, description, category (null|string), prompt_template (a JSON **string**
   of the full hydrated use-case object), tool_requirements (null), tags
   ["<template-id>", "derived"] }`.
2. The `prompt_template` use-case object shape is the gold standard in any existing
   recipe — fields: `id, title, description, capability_summary, category,
   enabled_by_default, execution_mode, model_override, suggested_trigger,
   connectors, notification_channels, review_policy, memory_policy,
   event_subscriptions (each `{event_type, direction: emit|listen, description}`),
   error_handling, input_schema, sample_input, tool_hints, test_fixtures,
   use_case_flow ({nodes[], edges[]})`. `sample_input` values may use
   `{{param.<aq_variable>}}` tokens that adoption fills.
3. **Seeding is INSERT-ONLY**, keyed on `(source_template_id, source_use_case_id)`
   (matches the Rust seeder `src-tauri/src/engine/recipe_seed.rs`); re-running never
   overwrites. Write a small idempotent `scripts/seed-<id>-recipes.mjs` that appends
   your rows and bumps `recipe_count` — `scripts/seed-sdlc-recipes.mjs` is a
   worked example. (At adoption time `derive_recipes_from_template_inner` can also
   mint recipes, but shipping them in `_recipe_seeds.json` is the catalog default.)
4. `_recipe_seeds.json` is `include_str!`-embedded into the native binary →
   **a rebuild is required** before newly seeded recipes load at runtime.

### Registration: checksums + publish

After writing the template JSON (`is_published: true`) and seeding its recipes:

```bash
node scripts/generate-template-checksums.mjs
```

This regenerates BOTH manifests (correct paths):
- `src/lib/personas/templates/templateChecksums.ts` (frontend)
- `src-tauri/src/engine/template_checksums.rs` (backend)

The catalog is **directory-scanned** (no manifest index): a published template at
`scripts/templates/<category>/<id>.json` with a valid checksum loads automatically.
The loader is **fail-loud** — an ID collision, checksum mismatch, or schema-shape
failure blocks the whole catalog, so validate before rebuilding. Confirm with the
template vitest suite (`npx vitest run templates`).

### Team presets + persona→template

- A template can be **bundled into a team preset** at
  `scripts/templates/_team_presets/<id>.json`; preset members reference templates
  by `template_id` (see `docs/features/templates/08-team-presets.md`). If you author
  a set of templates meant to ship together, add a preset too.
- There is **no automated persona→template export** path. To turn an existing
  built persona into a template, author the JSON from the persona's
  `structured_prompt` + `design_context.useCases` (see `scripts/seed-sdlc-recipes.mjs`
  for the mapping). Generalize away deployment specifics into `adoption_questions`
  / `{{param.*}}` so the template is reusable.

---

## Coordination — Active-Runs Ledger

Before writing the new template JSON or regenerating checksum manifests, register this session in `.claude/active-runs.md` per the convention in [`CLAUDE.md` → Concurrent CLI sessions](../../CLAUDE.md). Read the file's `## Active` section first; if any `started`-status entry overlaps your planned scope and is <2h old, surface the conflict to the user before proceeding. Overlap on `.claude/active-runs.md` itself is expected and is not a conflict.

**Declared paths for `/add-template`:**
- `scripts/templates/<category>/<id>.json` (the new template)
- `scripts/templates/_recipe_seeds.json` (recipe rows for the template's use_cases) + `scripts/seed-<id>-recipes.mjs` (the seeder)
- `src/lib/personas/templates/templateChecksums.ts` (regenerated)
- `src-tauri/src/engine/template_checksums.rs` (regenerated by `node scripts/generate-template-checksums.mjs`)
- Phase 5 only: Supabase `template_catalog` row (out-of-tree, but counts for awareness)
- Always: `.claude/active-runs.md`

**At session end** (Phase 6 summary, after Phase 5 publish or skip): move your entry to the top of `## Recently completed`. Update `Status` to `completed (commit: <sha>)` or `aborted (<reason>)`. Trim entries older than 14 days while you're there.

Full design rationale: [`docs/architecture/cli-coordination.md`](../../../docs/architecture/cli-coordination.md).

### Parallel-safety primitives (mandatory)

Per [`CLAUDE.md` → Parallel-safety primitives](../../CLAUDE.md), every CLI session must:

1. **Never `git stash`** other sessions' work — not even with `--keep-index`. Stash sweeps the entire working tree (and untracked files with `-u`) and silently relocates other sessions' in-flight edits. If your commit step needs a clean stage, use `git add <path>` per file (NOT `git add -A` / `git add .` / `git add -u`); leave everything else alone. The 2026-05-09 stash incident burned a `/research` run's working tree.
2. **Use a worktree for multi-file scope.** `/add-template` always touches multi-file scope (template JSON + frontend checksum + backend checksum + optional Supabase row). Default to:
   ```bash
   git worktree add .claude/worktrees/add-template-<id> -b worktree-add-template-<id>
   cd .claude/worktrees/add-template-<id>
   ```
3. **Atomic commits per task** — write the JSON, commit; regen checksums, commit; (Supabase publish if Phase 5 runs, commit). Never accumulate >30 min of uncommitted work.
4. **Clean up the worktree after merge.** Once the worktree's branch is in `git log master`, from the main checkout: `git worktree remove .claude/worktrees/add-template-<id>` and `git branch -D worktree-add-template-<id>`. Treat as part of the Phase 13 ledger ritual.

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
4. **Category fit** — Determine which category this template belongs to. Valid categories (each is a real dir under `scripts/templates/`): `content`, `development`, `devops`, `email`, `finance`, `hr`, `legal`, `marketing`, `productivity`, `project-management`, `research`, `sales`, `security`, `support`
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

**Required dimensional defaults — the persona must ship complete.**

Every v3 template MUST declare presets for the eight glyph dimensions so
the post-adoption UI (questionnaire centerpiece sigil + per-use-case
glyphs in the matrix) renders meaningful state on the first paint
instead of "everything is empty". Capture these in Phase 2 even when
the user says "default is fine" — record an explicit default rather
than leaving the field absent.

Per-use-case dimension presets (each `payload.use_cases[i]` row needs):

- `review_policy: { mode: "always" | "on_uncertainty" | "never", context: "..." }`
- `memory_policy: { enabled: true | false, context: "..." }`
- `notification_channels: [{ type, role, ... }]` (empty array = no channel for this UC)
- `event_subscriptions: [...]` (empty array = listens to no upstream events)
- `emit_events: [...]` (events this UC publishes)

Persona-level composition fields:

- `payload.persona.trigger_composition: "shared" | "per_use_case"` — when multiple use_cases run on one trigger tick vs. each on its own
- `payload.persona.message_composition: "combined" | "per_use_case"` — when outputs concatenate into one message vs. one message per UC
- `payload.persona.error_handling` — non-empty string describing per-service failure handling

If any of these are missing on a finished template, the centerpiece
sigil in the adoption questionnaire renders an "empty" petal for that
dimension and the user sees broken-looking pre-fill. **The skill must
collect these in Phase 2 and write them in Phase 3, full stop.**

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

#### 3c.0 — Dimensional preset checklist (run BEFORE writing the file)

Before serializing, verify the payload carries every dimension preset
collected in Batch 3. The adoption UI's centerpiece sigil + per-use-case
glyphs read these fields directly; a missing one renders as an "empty"
petal and degrades the perceived quality of the persona.

Walk this checklist:

- [ ] `payload.persona.trigger_composition` is `"shared"` or `"per_use_case"` (no default — pick explicitly).
- [ ] `payload.persona.message_composition` is `"combined"` or `"per_use_case"`.
- [ ] `payload.persona.error_handling` is a non-empty markdown string covering per-service failure modes.
- [ ] For every entry in `payload.use_cases[]`:
  - [ ] `review_policy.mode` set explicitly (`"always"` / `"on_uncertainty"` / `"never"`) with a one-sentence `context`.
  - [ ] `memory_policy.enabled` set to `true` or `false` with a one-sentence `context`.
  - [ ] `notification_channels: []` declared (empty is fine — must be present).
  - [ ] `event_subscriptions: []` declared.
  - [ ] `emit_events: []` declared (use the `entity.action.state` pattern from Batch 5).

If you wrote a v3 template using `recipe_ref` per use_case, the
**recipe** carries these fields, not the inline `use_cases[i]`. The
checklist still applies — open the recipe rows you reference and
confirm they're populated. Use the shipped templates as references:
`scripts/templates/security/ai-environment-posture-audit.json` is the
gold-standard example with full review_policy / memory_policy /
notification_channels declared per use_case.

#### 3c.1 — Other payload fields

- **Parameters (free, runtime-adjustable)**: Values users can change *without* triggering a rebuild — counts, thresholds, sources, websites, tone choices. Every persona should declare every concrete value its prompt mentions as a parameter. Two declaration paths converge into the same `personas.parameters` JSON column after adoption (handled by `populate_persona_parameters_from_design` in `template_adopt.rs`):

  **Path A — `suggested_parameters[]`**: Direct array of `PersonaParameter` objects on the payload. Use when the knob has an unambiguous default and you don't want to ask the user about it during adoption.
  ```json
  [
    {
      "key": "spending_threshold",
      "label": "Weekly Spending Threshold",
      "type": "number",
      "default_value": 500,
      "value": 500,
      "description": "Max acceptable weekly spend before the agent alerts.",
      "unit": "$", "min": 0, "max": 1000000
    }
  ]
  ```

  **Path B — adoption questions with `maps_to: persona.parameters[KEY]`**: A question in `adoption_questions[]` whose `maps_to` is shaped `persona.parameters[KEY]`. The question's `default`, `type`, `min`/`max`, `options`, and `context` become the parameter's schema; the user's answer (when present) becomes the live value. Use when the knob's right default depends on the user's situation. Same example, asked at adoption time:
  ```json
  {
    "id": "aq_spending_threshold",
    "scope": "persona",
    "category": "configuration",
    "question": "Weekly spending threshold above which the agent alerts?",
    "type": "number", "default": 500, "min": 0, "max": 1000000,
    "maps_to": "persona.parameters[spending_threshold]",
    "variable_name": "spending_threshold",
    "context": "Higher thresholds reduce noise but mask gradual creep."
  }
  ```

  Both paths populate the persona row's `parameters` column with the same JSON shape. When the same KEY appears in both, the questionnaire-derived definition wins (user answers override static defaults).

  **CRITICAL**: when authoring a parameter under either path, the persona's `operating_instructions`, `tool_guidance`, or `full_prompt_markdown` MUST reference the parameter via `{{param.KEY}}` rather than the literal default. Otherwise the runtime substitution layer (`engine/prompt/variables.rs`) has nothing to substitute and the "adjustable without rebuild" promise is empty. Lint your draft: every `suggested_parameters[i].key` and every `adoption_questions[].variable_name` (when `maps_to` is `persona.parameters[...]`) should appear at least once as `{{param.KEY}}` in the prompt text.

  **Examples of good parameter candidates** (from the active template catalog): number of items to extract per scan, lookback window in weeks/days, websites to research, knowledge-base IDs, output count, alert threshold, target audience type, tone preset.

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
    "category": "service_category",
    "requires_resource": "repositories"
  }
  ```

  **`requires_resource` (optional)** — pin this connector slot to credentials
  that have at least one pick under the named scoped-resource id. The string
  must match a `resources[].id` declared on the corresponding builtin
  connector (e.g. `"repositories"` for github/gitlab, `"voices"` for
  elevenlabs, `"channels"` for discord, `"projects"` for jira/sentry/linear/
  notion/posthog/azure-devops, `"databases"` for notion, `"folders"` for
  dropbox/google-drive/microsoft-outlook, `"workspaces"` for asana/clickup,
  `"calendars"` for google-calendar/microsoft-calendar, `"teams"` for
  microsoft-teams, `"sites"` for sharepoint, …).

  When set, the adoption questionnaire will only surface credentials whose
  `scoped_resources` blob has a non-empty array under that key — i.e. the
  user has actually completed the post-save scope picker. Use this when your
  template asks "Which X?" and you want to guarantee the answer is already
  narrowed by the user's scope choice rather than asking again.

  Slot-level `requires_resource` overrides any per-question
  `dynamic_source.requires_resource`. Prefer slot-level — the constraint
  lives next to the slot definition where authors expect it.

### Auto-fill from scoped resources (§4.1)

When a connector slot declares `requires_resource`, downstream questions can
auto-fill from the user's scoped picks instead of asking again. Add a
follow-up adoption question chained on the credential pick:

```jsonc
{
  "id": "aq_target_repository",
  "type": "select",
  "scope": "connector",
  "connector_names": ["github"],
  "dynamic_source": {
    "service_type": "source_control",
    "operation": "list_scope_picks",
    "source": "scope",
    "from_scope": "repositories",
    "from_credential_question": "aq_source_control"
  },
  "maps_to": "persona.connectors[github].credential_fields[repo].value",
  "variable_name": "target_repository"
}
```

Behavior:

1. Adoption hook reads `userAnswers["aq_source_control"]` (the chosen
   credential's `service_type`), resolves the matching vault credential, and
   surfaces `scopedResources["repositories"]` as the option list.
2. **Exactly one pick** → the answer is auto-set and shown with the
   "auto-detected" badge — the user doesn't see a question to confirm.
3. **Multiple picks** → rendered as a normal select; user picks which one.
4. **Zero picks** → friendly error pointing the user to the credential's
   scope picker.

Use whenever your template asks a follow-up question whose options the user
already pinned during scoping (repo, project, channel, calendar, …).

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

> **For `schema_version: 3` templates, 4a–4c below are the LEGACY v2 checks** —
> a correct v3 template has no `structured_prompt` / `design_highlights` / inline
> `use_case_flows`, so skip those specific assertions. For v3, validate instead per
> the "Schema v3 file shape + recipe seeds" section: valid JSON, `is_published: true`,
> every `use_cases[].recipe_ref.id` has a matching row in `_recipe_seeds.json`, every
> optional connector has a `fallback_note`, `node scripts/generate-template-checksums.mjs`
> succeeds, and `npx vitest run templates` passes.

### 4a. Structural validation (legacy v2)

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

Read the generated template and compare against an existing template of similar complexity (e.g., `scripts/templates/devops/devops-guardian.json`). Verify:
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

When generating templates, match the depth and style of current shipped templates.
**For schema_version 3 (default), read a v3 neighbor:**
- **Development**: `scripts/templates/development/qa-guardian.json` — memory-backed, multi-capability, codebase-grounded (the canonical v3 example)
- **Development**: `scripts/templates/development/solution-architect.json` — two memory-backed use cases + event handoff
- **Security**: `scripts/templates/security/security-sentinel.json` / `ai-environment-posture-audit.json`
- **DevOps**: `scripts/templates/devops/devops-guardian.json` / `release-manager.json`

Read one v3 neighbor in your chosen category before generating to calibrate quality
expectations. (The older v2 references some earlier versions of this doc cited —
e.g. `incident-commander.json` — no longer exist in the catalog.)
