# C3 — Template Authoring Handoff

> **Purpose**: Enable a dedicated CLI session to hand-author the remaining
> 103 templates to v3 shape plus translate every template's user-facing
> strings into all 14 supported languages. This doc is the single source
> of truth for the next session — read it top to bottom before touching
> any template.

---

## 1. Context

### 1.1 Goal

Every template in `scripts/templates/**/*.json` must end this phase as:

- `schema_version: 3`
- A **persona behavior core** (`payload.persona`) capturing WHO the
  agent is across every capability (identity, voice, principles,
  constraints, decision_principles).
- A list of **user-facing capabilities** (`payload.use_cases[]`), each
  nesting its own trigger, connectors, notification_channels, events,
  review_policy, memory_policy, flow diagram, input_schema,
  sample_input, tool_hints.
- **Scoped adoption questions** (`payload.adoption_questions[]`) with
  `scope`, `use_case_id`, and `maps_to` — so disabled capabilities drop
  their questions automatically and answers propagate to concrete
  fields.
- **Full i18n coverage**: every user-facing string (name, description,
  question text, capability_summary, placeholders, etc.) translated
  into the 14 supported languages.

### 1.2 Why v3 matters

v2 templates put chain artefacts (triggers, connectors, channels,
events) at the top of `payload` as flat arrays, disconnected from the
capability that owns them. The UI guessed at linkage via positional
fallbacks; the backend couldn't enforce per-capability
enable/disable cleanly. v3 makes linkage **explicit** — every artefact
lives inside the capability that owns it, so:

- Disabling a capability (via `UseCasePickerStep`) drops its trigger,
  events, channels, and questions cleanly in one operation.
- The chronology UI (`PersonaChronologyChain` /
  `PersonaChronologyWildcard`) reads presence deterministically — no
  guessing.
- The backend runtime attributes executions / memories / messages to
  their owning capability (C2 design).

### 1.3 Status at handoff

| State | Count | Notes |
|---|---|---|
| Hand-authored v3 (quality baseline) | **4** | email-morning-digest, financial-stocks-signaller, onboarding-tracker, youtube-content-pipeline |
| Remaining in v1/v2 | **103** | All need hand-authoring to v3 |
| Mechanical migration script exists | — | `scripts/migrate-templates-v3.mjs` but **do not use for final output** — it broke personas. Useful only as scaffolding starting point; every template still needs manual review & content authoring. |

### 1.4 Critical files already in place

- `docs/concepts/persona-capabilities/C3-template-schema-v3.md` — full
  schema reference + v2→v3 field mapping cheatsheet.
- `src-tauri/src/engine/template_v3.rs` — normalizes v3 payload →
  flat AgentIr at adoption time. Runs transparently; v2 templates are
  not affected. 11 passing unit tests.
- `src-tauri/src/commands/design/build_sessions.rs::create_adoption_session`
  — wired to call the v3 normalizer.
- `src/features/templates/sub_generated/adoption/chronology/useUseCaseChronology.ts`
  — reads v3 shape directly; v2 fallback still works.
- `src/lib/personas/templates/seedTemplates.ts` — extracts
  gallery-badge data (connectors_used, trigger_types, use_case_flows)
  from v3 with v2 fallback.

These are **done and working**. Don't re-implement; just author the
templates on top.

---

## 2. The v3 Schema (Quick Reference)

### 2.1 Top-level shell

```jsonc
{
  "id": "kebab-case-slug",              // matches filename
  "schema_version": 3,                  // always
  "name": "Human-readable name",        // i18n target
  "description": "One-line blurb",      // i18n target, gallery card
  "icon": "LucideIconName",             // PascalCase lucide name
  "color": "#HEXCODE",                  // brand/category color
  "category": ["primary", "optional_secondary"],
  "service_flow": ["App A", "App B"],   // legacy carried forward
  "is_published": true,                 // false hides from gallery
  "payload": {
    "service_flow": [...],              // mirror top-level for compat
    "persona": { ... },                 // SECTION 2.2
    "use_cases": [ ... ],               // SECTION 2.3
    "adoption_questions": [ ... ],      // SECTION 2.4
    "persona_meta": {                   // legacy, keep for naming
      "name": "T: <name>",
      "icon": "<icon>",
      "color": "<color>"
    }
  }
}
```

### 2.2 `payload.persona` — Behavior Core

```jsonc
"persona": {
  "identity": {
    "role": "One-sentence role.",                          // "You are X"
    "description": "One-line elaboration of purpose."
  },
  "voice": {
    "style": "Direct / calm / technical / warm / formal / ...",
    "output_format": "Lead with... Use... Avoid...",
    "tone_adjustments": [                                  // optional
      { "channel": "email", "tone": "formal" },
      { "channel": "slack", "tone": "casual" }
    ]
  },
  "principles": [                                          // 2-5 rules
    "Cross-cutting behavioral principle.",
    "Another one."
  ],
  "constraints": [                                         // 2-5 hard limits
    "Never do X.",
    "Always respect Y."
  ],
  "decision_principles": [                                 // 0-5 tiebreakers
    "When A and B conflict, prefer A because ..."
  ],
  "verbosity_default": "terse" | "normal" | "verbose",
  "operating_instructions": "Paragraph(s) covering how the persona runs across capabilities. Can contain step-by-step sections when the template has sequential stages.",
  "tool_guidance": "Per-tool usage notes, API endpoints, rate limits, auth patterns.",
  "error_handling": "Persona-wide error handling paragraph. Individual capabilities can override via use_cases[i].error_handling.",
  "examples": [],                                          // rarely used at persona level
  "tools": ["tool_name_1", "tool_name_2"],                 // shared tool pool
  "connectors": [                                          // persona-wide connector registry
    {
      "name": "gmail",
      "label": "Gmail",
      "auth_type": "oauth2" | "api_key" | "local",
      "role": "email" | "crm" | "calendar" | "market_data" | ...,
      "category": "email" | "finance" | "productivity" | ...,
      "api_base_url": "https://...",
      "scopes": [...],
      "credential_fields": [...],
      "setup_instructions": "Step-by-step setup"
    }
  ],
  "notification_channels_default": [                       // fallback when capability has none
    { "type": "built-in" | "messaging" | "email" | "slack", "description": "..." }
  ],
  "core_memories": []                                      // persona-wide always-injected memory
}
```

### 2.3 `payload.use_cases[i]` — A Capability

```jsonc
{
  "id": "uc_slug",                                         // stable, cross-referenced
  "title": "Human-readable capability name",
  "description": "1-2 sentence description of what this capability does.",
  "capability_summary": "One-line summary for prompt injection.",
  "category": "productivity" | "analysis" | "hr" | ...,
  "enabled_by_default": true,                              // users can toggle off at adoption
  "execution_mode": "e2e" | "mock" | "non_executable",
  "model_override": null,                                  // null = inherit persona default
  "suggested_trigger": {                                   // or null for pure-manual capability
    "trigger_type": "schedule" | "polling" | "webhook" | "manual" | "event_listener" | "file_watcher" | "app_focus",
    "config": { "cron": "...", "interval_seconds": ..., "timezone": "local" },
    "description": "When this fires."
  },
  "connectors": ["gmail", "notion"],                       // names, referencing persona.connectors[]
  "notification_channels": [                               // or [] to inherit persona default
    { "type": "messaging", "description": "Where outputs go for this capability" }
  ],
  "review_policy": {
    "mode": "never" | "on_low_confidence" | "always",
    "context": "When/why review triggers, or null"
  },
  "memory_policy": {
    "enabled": true | false,
    "context": "What memory persists for this capability, or null"
  },
  "event_subscriptions": [
    { "event_type": "ns.event_name", "direction": "emit" | "listen",
      "description": "What this means, payload shape" }
  ],
  "error_handling": "Per-capability error override, or empty string",
  "input_schema": [                                        // typed fields
    { "name": "lookback_hours", "type": "number", "default": 12, "min": 4, "max": 72, "description": "..." },
    { "name": "mode", "type": "enum", "options": ["a", "b"], "default": "a" }
  ],
  "sample_input": {                                        // canonical example — supports {{param.X}}
    "lookback_hours": 12,
    "max_items": "{{param.aq_max_items}}"                  // substituted at adoption
  },
  "tool_hints": ["tool_name_1"],                           // subset of persona.tools
  "test_fixtures": [],
  "use_case_flow": {                                       // optional workflow diagram
    "nodes": [
      { "id": "n1", "type": "start" | "action" | "connector" | "decision" | "event" | "error" | "end",
        "label": "Short label", "detail": "Longer explanation",
        "connector": "optional_connector_name" }
    ],
    "edges": [
      { "source": "n1", "target": "n2", "label": "optional", "variant": "yes" | "no" | "error" }
    ]
  }
}
```

### 2.4 `payload.adoption_questions[i]` — Scoped Questions

```jsonc
{
  "id": "aq_snake_case",
  "scope": "persona" | "capability" | "connector",
  "use_case_id": "uc_...",                 // REQUIRED when scope == "capability"
  "connector_names": ["gmail"],            // REQUIRED when scope == "connector"
  "category": "configuration" | "domain" | "boundaries" | "quality",
  "question": "Human-readable question text",   // i18n target
  "type": "select" | "text" | "number" | "boolean",
  "options": ["opt1", "opt2"],
  "default": "opt1",
  "maps_to": "use_cases[uc_slug].sample_input.field_name",
                                           // or "persona.voice.style"
                                           // or "persona.connectors[name].credential_fields[0].value"
  "variable_name": "snake_case_name",      // for {{param.aq_id}} substitution
  "context": "Help text shown under the question",   // i18n target
  "dimension": "triggers" | "connectors" | "messages" | "memory" | "voice" | "use-cases" | "error-handling"
}
```

**Rule**: `variable_name` matters — the backend's
`substitute_variables` pipeline replaces `{{param.<question_id>}}`
tokens in all template strings with the user's answer. For fields where
you want runtime propagation via `{{param.X}}`, place the placeholder
directly in `sample_input` or `voice.style` etc.

---

## 3. Methodology — The 10-Step Process

For each template, follow this sequence. Plan on 30-60 minutes per
template depending on complexity (Tier A single-capability: 20-30 min;
Tier C multi-capability with complex policies: 60-90 min).

### Step 1 — Read the v1/v2 template completely

Open `scripts/templates/<category>/<name>.json`. Read:
- `name`, `description`, `category`
- `payload.structured_prompt.identity` (the big identity blob)
- `payload.structured_prompt.instructions` (the step-by-step operating instructions)
- `payload.suggested_triggers[]` and their descriptions
- `payload.use_case_flows[]` (the flow diagrams)
- `payload.adoption_questions[]`
- `payload.protocol_capabilities[]` (look for manual_review, agent_memory, emit_event)

Understand what the persona actually does before touching structure.

### Step 2 — Identify the real user-facing capabilities

**Do not 1:1 map `use_case_flows[]` → `use_cases[]`.** Many v1 templates
have flow diagrams for internal mechanisms (error recovery, attention
escalation) that aren't capabilities — they're implementation details.

**A capability is something a user would say "turn X off" about.**

Ask:
1. Does it have a distinct trigger? (daily at 8am vs manual vs webhook)
2. Does it deliver a distinct artefact? (report vs alert vs simulation)
3. Would a user reasonably want to enable some but not others?

Examples from the 4 done templates:

| Template | v1 flow count | v3 capability count | Merge decisions |
|---|---|---|---|
| email-morning-digest | 1 | 1 | One user-facing job |
| financial-stocks-signaller | 3 | 2 | `flow_error_recovery` + `flow_attention_escalation` were internal; collapsed into the weekly analysis capability. Kept `uc_strategy_backtest` separate (distinct manual trigger). |
| onboarding-tracker | 4 (Mode A/B/C/D) | 3 | Modes B and D share a daily scan trigger — merged into `uc_deadline_check` (which also handles completion detection). |
| youtube-content-pipeline | 5 (implicit pipeline) | 5 | Each stage has distinct manual trigger and IO — kept separate even though they chain. |

### Step 3 — Decompose the identity blob into the behavior core

The v1 `structured_prompt.identity` is usually a long prose blob mixing:
- Role (1 sentence)
- Operating philosophy (paragraph)
- Principles
- Constraints
- Warnings / "you never" / "you always"

Split it:
- **First "You are X" sentence** → `persona.identity.role` (trimmed)
- **First paragraph's purpose statement** → `persona.identity.description`
- **"You are NOT a..."** / **"Never..."** / **"Do not..."** → `persona.constraints`
- **"Operate on the principle..."** / **"Always..."** / **"Every X must..."** → `persona.principles`
- **"When X and Y conflict..."** / **"Prefer X over Y because..."** → `persona.decision_principles`
- **Tone / style hints** → `persona.voice.style` + `persona.voice.output_format`
- **Step-by-step instructions** → `persona.operating_instructions`
- **Per-tool usage notes** → `persona.tool_guidance`
- **Error handling prose** → `persona.error_handling`

**Ceiling**: Principles + constraints combined should be 4-10 items.
Not 20. If the v1 has a huge list, cut to what's most cross-cutting.

### Step 4 — Assign the persona-wide tools & connectors

Move `payload.suggested_tools[]` → `payload.persona.tools[]` (as
string array).

Move `payload.suggested_connectors[]` → `payload.persona.connectors[]`
(keep full object; strip `use_case_id` and `related_triggers` / `related_tools`
since we're going semantic now).

Move `payload.suggested_notification_channels[]` — if they have no
`use_case_id` tag and describe a general delivery channel → push into
`persona.notification_channels_default`. If they're obviously
capability-specific → push into that capability's `notification_channels[]`
at Step 5.

### Step 5 — Build each capability

For each real capability identified in Step 2:

1. **id** — stable `uc_<slug>` matching the flow diagram if it existed.
2. **title / description / capability_summary** — write fresh, don't copy from v1 description. The capability_summary goes into the prompt's Active Capabilities section at runtime.
3. **suggested_trigger** — pick the matching v1 trigger by purpose (not index). If v1 had 4 triggers and 3 capabilities, one capability might have 2 triggers (then pick the primary one; note the secondary in `operating_instructions`). If a capability has no scheduled trigger, use `{ "trigger_type": "manual", "config": {}, "description": "..." }`.
4. **connectors** — which names from `persona.connectors[]` this capability uses. Usually deducible from the flow diagram's `connector: ...` node fields.
5. **notification_channels** — per-capability delivery. Empty array inherits persona default.
6. **review_policy** — look at v1 `protocol_capabilities[type=manual_review]` AND the operating instructions. When does human approval matter for THIS capability?
   - Automation-heavy (reports, scans): `mode: "never"`
   - Judgment calls (topic picks, content drafts, at-risk flags): `mode: "always"` or `"on_low_confidence"`
7. **memory_policy** — does THIS capability benefit from persistent learning?
   - Reporters that don't learn: `enabled: false`
   - Personalizers (voice models, importance scores, user preferences): `enabled: true` with specific `context`
8. **event_subscriptions** — per-capability events. Split by direction:
   - `direction: "emit"` — events this capability fires (e.g., `report.delivered`)
   - `direction: "listen"` — events this capability consumes (rarer; most capabilities are triggered by their own schedule/webhook/manual, not cross-capability events)
9. **error_handling** — only if this capability has a materially different error posture from the persona default. Otherwise empty string.
10. **input_schema + sample_input** — derive from v1 `suggested_parameters[]` + the adoption questions that target this capability. Use `{{param.<aq_id>}}` placeholders in `sample_input` for answers you want propagated at runtime.
11. **tool_hints** — subset of `persona.tools` most relevant here (advisory; all tools remain available at runtime).
12. **use_case_flow** — usually copy from v1 `use_case_flows[i]` but simplify. Prune trivial edges. Keep nodes that tell the story visually.

### Step 6 — Scope the adoption questions

For each v1 question, decide scope:

- **`scope: "persona"`** — affects voice, identity, cross-cutting behavior.
  Examples: tone selection, formality, verbosity.
- **`scope: "capability"`** — affects one specific capability.
  REQUIRED: `use_case_id`. Examples: "what time should the digest fire?",
  "how many emails max per digest?"
- **`scope: "connector"`** — configures a connector.
  REQUIRED: `connector_names: [...]`. Examples: "Gmail categories to include",
  "Slack channel to post to".

Set `maps_to` for answers you want to actually propagate. The path
syntax:
- `persona.voice.style`
- `persona.core_memories[0].content`
- `use_cases[uc_slug].sample_input.field_name`
- `use_cases[uc_slug].suggested_trigger.config.cron`
- `persona.connectors[gmail].credential_fields[0].value`

Set `variable_name` to match the placeholder you use in `sample_input`
etc. (the `{{param.<question_id>}}` token uses the question id, not the
variable_name — the variable_name is for human reference).

### Step 7 — Add `{{param.X}}` placeholders where answers should land

In `sample_input`, `voice.style`, or anywhere else the answer should
flow into the prompt at runtime:

```jsonc
"sample_input": {
  "max_emails": "{{param.aq_max_emails}}",
  "cron_hour": 7        // hardcoded
}
```

At promote time, `substitute_variables` walks the entire IR and
replaces `{{param.aq_max_emails}}` with the user's answer.

### Step 8 — Validate JSON + regenerate checksums

```bash
node -e "JSON.parse(require('fs').readFileSync('scripts/templates/<path>','utf8')); console.log('valid')"
node scripts/generate-template-checksums.mjs
```

### Step 9 — Adopt the template in the running app, end to end

Launch `npx tauri dev --features test-automation`, go through adoption:

1. Gallery shows the template card with correct badges (icon, service flow chips).
2. Adoption opens the `UseCasePickerStep` (when capabilities > 1). All capabilities listed with correct titles.
3. Questionnaire renders questions scoped correctly (disabled capabilities' questions disappear).
4. Answers submit cleanly, matrix view shows populated dimensions.
5. `Test agent` produces output.
6. `Approve and promote` creates the persona without crash.
7. Check persona detail (`/persona-detail` endpoint via live harness, or navigate in UI) — verify:
   - `design_context.useCases[]` contains the v3 capabilities with correct ids.
   - Triggers persist with correct `use_case_id` attribution.
   - Event subscriptions persist with correct `use_case_id`.

### Step 10 — Mark done, move on

Update `docs/concepts/persona-capabilities/C3-AUTHORING-PROGRESS.md`
(create it the first time) with:

```markdown
| Template | Status | Capabilities | Questions | Notes |
|---|---|---|---|---|
| productivity/email-morning-digest | ✓ | 1 | 7 | Reference template |
| finance/financial-stocks-signaller | ✓ | 2 | 6 | Merged 3 flows → 2 capabilities |
```

---

## 4. Patterns & Pitfalls (from the 4 hand-authored templates)

### 4.1 Flow-diagram → capability count: common failure modes

| Template pattern | Wrong approach | Right approach |
|---|---|---|
| Error-recovery flow diagram | Treat as capability | Collapse into the user-facing capability's `error_handling` prose |
| Attention-escalation flow | Treat as capability | Capture as events emitted by the main capability + review_policy trigger |
| Setup/initialization flow | Treat as capability | Inline into `operating_instructions` ("On first run, verify …") |
| Pipeline stages (research → script → edit) | Merge into 1 | Keep separate when each has distinct trigger + IO (exception: 5 capabilities in `youtube-content-pipeline`) |
| Multiple schedules (hourly + daily + weekly) | 1 capability with 3 triggers | 3 capabilities each with 1 schedule |

### 4.2 Review policy decisions

Match `review_policy.mode` to what decisions the capability makes:

- **`"never"`**: Pure reporters, digests, monitors that just surface data.
- **`"on_low_confidence"`**: Capabilities that can produce outputs of varying quality (drafts, classifications). Review triggers when confidence is low.
- **`"always"`**: Creative or judgment-heavy work where the human picks from AI-produced options (topic picking, script voice approval, at-risk hire intervention).

### 4.3 Memory policy decisions

Enable memory only when the capability actually learns something:

- **Disabled**: Stateless reporters, one-shot backtests, pure transformations.
- **Enabled with specific context**: Personalizers (sender importance scores, voice profiles, sender learning), cross-run accumulators (paper trade portfolios, completion analytics).

If memory is enabled, write `context` as what *specifically* persists — not "Memory enabled".

### 4.4 Events — split by direction, not flatten

v1 had a flat `suggested_event_subscriptions[]` where "direction" was
inferred. v3 makes it explicit:

- **`direction: "emit"`** — this capability fires this event. Most common.
  Used for cross-persona coordination (other personas subscribe).
- **`direction: "listen"`** — this capability is triggered by this event.
  Rare; usually only appears when a persona has capabilities that react
  to other personas' events.

### 4.5 Voice tone

Don't write "Friendly, approachable, helpful". Write what makes THIS
persona distinctive. Examples from the 4 done:

- Email Morning Digest: *"Direct, calm, respectful of user attention.
  Reads like a thoughtful briefing officer, not a notification firehose."*
- Financial Stocks Signaller: *"Precise, skeptical, numerically grounded.
  Reads like a Bloomberg Terminal briefing — never marketing copy, never
  hype. Flags uncertainty explicitly."*
- Onboarding Tracker: *"Warm but rigorous. Professional HR voice —
  celebrates milestones, flags risks without blame."*
- YouTube Pipeline: *"Creator-operations: pragmatic, data-driven,
  no-bullshit. Quotes median view counts, cut seconds, word counts.
  Never marketing speak. Respects the creator's time."*

Each is 1-2 sentences. Each is specific enough that a human can tell it
apart from the others. Aim for that.

### 4.6 Principles vs constraints

- **Principles** — what the persona does by default / prefers.
  *"Respect attention — every surfaced item must earn inclusion."*
- **Constraints** — hard limits. Breaking them is a bug.
  *"Never send emails on behalf of the user."*

If you're unsure which category something belongs in: if breaking it
would be a bug or a safety issue, it's a constraint. Otherwise principle.

### 4.7 Decision principles are for tiebreakers

These come into play when two principles / signals / data sources
disagree:

- *"When RSI and MACD disagree, report both signals and flag the
  conflict rather than averaging."* (tiebreaker for financial)
- *"Explicit VIP flags outrank learned sender scores when they conflict."*
  (tiebreaker for email)
- *"When a duplicate is detected with status 'failed', retry with the
  same Notion page_id if it still exists — don't orphan a half-created
  checklist."* (tiebreaker for onboarding)

Not every template needs decision_principles. 0-3 is typical.

### 4.8 Review policy context is load-bearing

When `mode != "never"`, the `context` string tells the runtime WHEN to
trigger review. Be specific:

- Bad: `"context": "Review when needed"`
- Good: `"context": "Overdue alert #3 escalates to HR via manual_review. At-risk hires with 3+ overdue tasks also route to review."`

The context is what the runtime reads to decide if a given situation
warrants review.

### 4.9 `maps_to` paths that don't exist yet

`maps_to` paths are structural hints for future enhancement. The
current backend uses `{{param.<question_id>}}` placeholder substitution
as the propagation mechanism. The path is documentation + forward
compatibility.

For now: **always set `maps_to`**, **also** put a `{{param.<id>}}`
placeholder where the value should land. When the Rust `apply_maps_to`
pipeline ships, the placeholder fallback will still work.

---

## 5. Translation (i18n)

### 5.1 The problem

Templates contain long English prose (identity descriptions, operating
instructions, question text, capability_summaries). 14 languages × 107
templates × ~30 translated fields = **~45,000 translation units**. This
is a real scope.

### 5.2 Recommended approach

**Separate language bundles per template, not inline keys.**

For each translated template, create sibling files:

```
scripts/templates/productivity/email-morning-digest.json        (English / canonical)
scripts/templates/productivity/email-morning-digest.cs.json
scripts/templates/productivity/email-morning-digest.de.json
scripts/templates/productivity/email-morning-digest.es.json
...
```

Non-English files override only the user-facing string fields. Keep
structural fields (ids, schema_version, connector names, event types,
cron expressions, maps_to paths) identical — never translate those.

### 5.3 Fields to translate

| Field path | Translate? | Why |
|---|---|---|
| `name` | ✓ | Gallery card |
| `description` | ✓ | Gallery card + adoption modal |
| `payload.persona.identity.role` | ✓ | Prompt-visible |
| `payload.persona.identity.description` | ✓ | Prompt-visible |
| `payload.persona.voice.style` | ✓ | Prompt-visible |
| `payload.persona.voice.output_format` | ✓ | Prompt-visible |
| `payload.persona.principles[]` | ✓ | Prompt-visible |
| `payload.persona.constraints[]` | ✓ | Prompt-visible |
| `payload.persona.decision_principles[]` | ✓ | Prompt-visible |
| `payload.persona.operating_instructions` | ✓ | Prompt-visible |
| `payload.persona.tool_guidance` | ✓ | Prompt-visible |
| `payload.persona.error_handling` | ✓ | Prompt-visible |
| `payload.persona.connectors[].label` | ✓ | UI label |
| `payload.persona.connectors[].setup_instructions` | ✓ | User-visible setup |
| `payload.persona.connectors[].credential_fields[].label` | ✓ | UI label |
| `payload.persona.connectors[].credential_fields[].helpText` | ✓ | UI help |
| `payload.persona.notification_channels_default[].description` | ✓ | UI label |
| `payload.use_cases[].title` | ✓ | UI (capability picker) |
| `payload.use_cases[].description` | ✓ | UI |
| `payload.use_cases[].capability_summary` | ✓ | Prompt-visible |
| `payload.use_cases[].suggested_trigger.description` | ✓ | UI |
| `payload.use_cases[].notification_channels[].description` | ✓ | UI |
| `payload.use_cases[].event_subscriptions[].description` | ✓ | UI (chronology tooltips) |
| `payload.use_cases[].review_policy.context` | ✓ | Prompt-visible |
| `payload.use_cases[].memory_policy.context` | ✓ | Prompt-visible |
| `payload.use_cases[].error_handling` | ✓ | Prompt-visible |
| `payload.use_cases[].input_schema[].description` | ✓ | UI hint |
| `payload.use_cases[].use_case_flow.nodes[].label` | ✓ | UI (flow diagram) |
| `payload.use_cases[].use_case_flow.nodes[].detail` | ✓ | UI tooltips |
| `payload.adoption_questions[].question` | ✓ | UI |
| `payload.adoption_questions[].options[]` | ✓ | UI picks |
| `payload.adoption_questions[].default` | ✓ (match options) | UI |
| `payload.adoption_questions[].context` | ✓ | UI help |
| `payload.adoption_questions[].placeholder` | ✓ | UI |

| Field path | DO NOT translate | Why |
|---|---|---|
| `id`, `schema_version` | — | Structural |
| `icon`, `color` | — | Structural |
| `category[]`, `service_flow[]` | — | Structural (match catalog) |
| `payload.persona.tools[]` | — | Tool names are code identifiers |
| `payload.persona.connectors[].name` | — | Code identifier |
| `payload.persona.connectors[].auth_type`, `role`, `category` | — | Code enum |
| `payload.persona.connectors[].api_base_url`, `scopes[]` | — | URLs + OAuth scopes |
| `payload.persona.connectors[].credential_fields[].key` | — | Code identifier |
| `payload.persona.connectors[].credential_fields[].placeholder` | — | Often real example values |
| `payload.persona.connectors[].credential_fields[].type` | — | Code enum |
| `payload.use_cases[].id` | — | Cross-referenced everywhere |
| `payload.use_cases[].category`, `enabled_by_default`, `execution_mode` | — | Structural |
| `payload.use_cases[].suggested_trigger.trigger_type`, `config` | — | Code enum + cron |
| `payload.use_cases[].connectors[]` | — | References to connector names |
| `payload.use_cases[].event_subscriptions[].event_type`, `direction` | — | Code identifiers |
| `payload.use_cases[].input_schema[].name`, `type`, `options[]` | — | Code identifiers |
| `payload.use_cases[].tool_hints[]` | — | Tool name references |
| `payload.use_cases[].use_case_flow.nodes[].id`, `type`, `connector` | — | Structural + references |
| `payload.adoption_questions[].id`, `scope`, `use_case_id`, `variable_name`, `maps_to` | — | All structural identifiers |
| `payload.adoption_questions[].type`, `dimension`, `category` | — | Code enums |
| `persona_meta.name` | — | Internal prefix marker |

### 5.4 Translation workflow recommendation

For each template, **after English is hand-authored**:

1. Write once in English as the canonical version.
2. Run each non-English bundle through a translator (human or LLM with
   translation instructions pinned to the language file).
3. Spot-check each language by setting `i18nStore.languageCode` and
   loading the persona — verify natural reading in the matrix editor,
   chronology view, questionnaire.
4. **Critical**: any string with `{{param.X}}` tokens must preserve
   those tokens verbatim — they're substituted at adoption time.

### 5.5 Bundle loader (to build)

The frontend + backend currently read `scripts/templates/**/*.json`.
To support per-language variants, one of:

- **Runtime merge**: at template-load time, read the canonical file
  + the `{lang}.json` sibling if present + deep-merge user-facing
  fields. Easy; keeps structural integrity.
- **Build-time expansion**: `generate-template-checksums.mjs` extended
  to produce per-language bundles that the UI loads directly.

The runtime merge approach is simpler and keeps structural fields
single-sourced.

**Important**: this loader is **not yet built**. The next session should
either:
- Land the English-only v3 rewrite first, ship to users.
- Design + implement the language bundle loader.
- Then do the translation pass on all templates.

Don't try to do all three in parallel — coordination breaks.

---

## 6. Priority Queue

### 6.1 Tier 1 flagships (remaining — do first)

Already done: `email-morning-digest`, `financial-stocks-signaller`,
`onboarding-tracker`, `youtube-content-pipeline`.

Still to do:

1. `development/autonomous-issue-resolver` — complex dev workflow, validates capability split on engineering patterns
2. `sales/sales-pipeline-autopilot` — multi-capability CRM flow, exercises review + memory policies
3. `productivity/digital-clone` — cross-domain persona, tests general-purpose behavior core authoring
4. `development/autonomous-cro-experiment-runner` — experiment lifecycle with multiple triggers
5. `project-management/client-portal-orchestrator` — coordination-heavy, tests notification fan-out patterns

### 6.2 Tier 2 — per-category flagship (one per category)

For each remaining category, pick the most-representative template and
do it as the category reference. Other templates in that category can
follow its patterns more mechanically.

Counts: sales (14), research (14), development (13), content (13),
productivity (12), finance (12), support (6), marketing (5), devops (5),
project-management (4), security (3), legal (3), hr (2), email (1).

### 6.3 Tier 3 — bulk remainder

Work through each category systematically. Within a category, often
multiple templates share the same connector + same domain prose, so
behavior core can be copied with tweaks.

### 6.4 Merge candidates (decide before authoring)

Per `C2-execution-plan.md §6.2`:

- **Email Assistant archetype** ← merge email-morning-digest +
  email-follow-up-tracker + email-task-extractor + intake-processor
- **Sales Operations** ← merge contact-enrichment-agent +
  contact-sync-manager + crm-data-quality-auditor +
  sales-pipeline-autopilot + sales-deal-tracker
- **Codebase Guardian** ← merge qa-guardian + devops-guardian +
  documentation-freshness-guardian + codebase-health-scanner

**Policy**: Before authoring a template that's a merge candidate, decide
whether to:
- (a) Author it standalone (keeps catalog granular, ships the individual user).
- (b) Mark it `is_published: false` and fold into the archetype later.

Default (a). The archetypes can come in a second wave after individual
templates are solid.

### 6.5 Duplicates to retire

- `sales/website-conversion-auditor` vs
  `marketing/website-conversion-audit` — keep one, set the other
  `is_published: false`.

---

## 7. Validation per Template

After hand-authoring, run all of these:

```bash
# JSON parse
node -e "JSON.parse(require('fs').readFileSync('scripts/templates/<cat>/<name>.json','utf8'))"

# Regenerate checksums (whole catalog)
node scripts/generate-template-checksums.mjs

# Type check
npx tsc --noEmit

# Rust unit tests (should stay green)
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features desktop-full,test-automation --lib engine::template_v3::

# Live adoption in the running app
npx tauri dev --features test-automation
# ... adopt template in UI, verify no crash on approve, verify persona detail has the v3 shape
```

Expected checks in the live adoption:

- Gallery card shows correct icon + color + service_flow chips.
- Adoption modal opens; UseCasePickerStep (if >1 capability) lists all capabilities correctly.
- Questionnaire renders only enabled-capability questions + persona-scope questions.
- Matrix view (Chain or Wildcard) shows correct per-capability dimension presence.
- Test + Approve work without crash.
- `design_context.useCases[]` on the promoted persona contains the correct ids, titles, triggers with `use_case_id`.

### 7.1 The live harness

For batch verification after hand-authoring a category:

```bash
# In one terminal
npx tauri dev --features test-automation

# In another
uvx --with httpx python tools/test-mcp/e2e_c2_sweep.py --category <category>
```

The sweep adopts every template in the category and asserts the
v3 shape lands correctly. Grade A/B expected for every hand-authored
template.

---

## 8. Common Pitfalls & How to Avoid Them

### 8.1 Forgetting to regenerate checksums

The Rust backend verifies templates against `template_checksums.rs` at
load time. After ANY template change, run:

```bash
node scripts/generate-template-checksums.mjs
```

If you forget, the app rejects adoption with a "template integrity
verification failed" error.

### 8.2 Mismatched `use_case_id` between questions and capabilities

The adoption questionnaire filters questions by selected use cases. If
a question's `use_case_id` doesn't match any capability's `id`, the
question will never appear. Double-check the id string is identical.

### 8.3 Placeholder not substituting

If `{{param.aq_foo}}` shows up verbatim in the final persona, one of:

- Question id doesn't match (`aq_foo` vs `aq_bar` — case sensitive)
- Placeholder is inside a field serde doesn't walk (unlikely but possible)
- `save_adoption_answers` wasn't called before promote (check session.adoption_answers in DB)

### 8.4 Flow diagram too dense

Don't port every v1 node into v3. 10-15 nodes per capability is plenty.
Prune trivial "action → action" chains; keep decision points and
connector calls.

### 8.5 Persona voice copy-paste

Each template's `voice.style` should be distinctive. If two templates
end up with identical voice strings, it's a sign the authoring was
mechanical. Rewrite.

### 8.6 Missing `persona_meta`

The `persona_meta.name` field is used for the promoted persona's default
name (prefixed with "T:"). Don't drop it during rewrite.

### 8.7 Review policy "always" without context

`mode: "always"` without a `context` explaining WHEN triggers is a
half-done authoring. The runtime needs the context to decide what's
routed to review.

### 8.8 Connector credential_fields[].placeholder deleted

When simplifying the template, don't remove credential_field placeholders
— they help users identify the right format (e.g., "ntn_xxx..." for
Notion tokens). Keep them.

---

## 9. Tooling Cheatsheet

### 9.1 Files to know

- `scripts/templates/**/*.json` — the templates
- `scripts/generate-template-checksums.mjs` — regen after every change
- `scripts/migrate-templates-v3.mjs` — **DO NOT USE for final output**. Scaffold only.
- `docs/concepts/persona-capabilities/C3-template-schema-v3.md` — schema spec
- `src-tauri/src/engine/template_v3.rs` — backend normalizer + unit tests (reference)
- `src/features/templates/sub_generated/adoption/chronology/useUseCaseChronology.ts` — UI reader

### 9.2 Reference templates (to copy patterns from)

- `scripts/templates/productivity/email-morning-digest.json` — single-capability
- `scripts/templates/finance/financial-stocks-signaller.json` — 2-capability, merged internal flows
- `scripts/templates/hr/onboarding-tracker.json` — 3-capability, multi-schedule
- `scripts/templates/content/youtube-content-pipeline.json` — 5-capability pipeline

### 9.3 Live harness (live verification)

```bash
# launch
npx tauri dev --features test-automation

# wait for port 17320
curl http://127.0.0.1:17320/health

# adopt one
uvx --with httpx python tools/test-mcp/e2e_c2_sweep.py --template "<name>"

# adopt category
uvx --with httpx python tools/test-mcp/e2e_c2_sweep.py --category finance

# adopt all (slow)
uvx --with httpx python tools/test-mcp/e2e_c2_sweep.py

# inspect promoted persona
curl -s -X POST http://127.0.0.1:17320/persona-detail \
  -H "Content-Type: application/json" \
  -d '{"persona_id":"<uuid>"}' | python -m json.tool
```

### 9.4 Type checking

```bash
npx tsc --noEmit
```

### 9.5 Rust checking

```bash
cargo check --manifest-path src-tauri/Cargo.toml --no-default-features --features desktop-full,test-automation
```

---

## 10. Session Cadence Recommendation

For the dedicated authoring CLI, a sustainable cadence:

- **30-60 min per template** for quality hand-authoring
- **3-5 templates per session** (batch by category — shared connectors + domain)
- **Commit after each template** (or at most after each category) so progress is durable
- **Stop, verify in the app, resume** — don't batch 20 template edits without testing
- **Maintain `C3-AUTHORING-PROGRESS.md`** so future sessions know what's done

To finish the catalog:
- Tier 1 flagships (5 remaining): 1-2 sessions
- Tier 2 per-category (13 categories): 3-5 sessions
- Tier 3 bulk (85+ templates): 15-25 sessions
- Translation (after English-only v3 stable): separate tranche, ~10-15 sessions

**Total estimated**: 30-50 focused sessions to finish English v3 + 14
languages. Could parallelize across 2-3 agents working different
categories if coordination is tight.

---

## 11. Open Questions to Resolve with the User

Decide before starting the dedicated session:

1. **Translation loader**: runtime-merge or build-time expansion? (§5.5)
2. **Merge archetypes vs standalone**: authoring all individual templates
   first, or starting with archetypes? (§6.4)
3. **Duplicate retire**: delete `marketing/website-conversion-audit` or
   just `is_published: false`? (§6.5)
4. **`maps_to` backend**: keep `{{param.X}}` as the answer propagation
   mechanism, or implement `apply_maps_to` JSON-Pointer substitution
   in Rust? (§4.9)
5. **Tone of voice strings**: are LLM-translated voice strings
   acceptable, or does each language need a human translator with
   domain knowledge (finance, HR, content) to preserve nuance?

---

## 12. One-Paragraph TLDR

Read `C3-template-schema-v3.md` for the schema. Then for each template:
read v1, identify real capabilities (not flow diagrams), decompose the
identity blob into a behavior core (role / voice / principles /
constraints / decision_principles), build each capability with its own
trigger / connectors / channels / policies / events / flow, scope the
adoption questions with `use_case_id` and `maps_to`, add `{{param.X}}`
placeholders where answers should land at runtime, validate, regenerate
checksums, adopt it live and verify, move on. 30-60 min per template.
Four reference templates already done — copy patterns from them.
Translation comes after all 107 are hand-authored in English and the
language bundle loader ships.
