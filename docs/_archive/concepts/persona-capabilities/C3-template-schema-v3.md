# C3 — Template Schema v3 (current — reference)

> The canonical template authoring contract. **Wire version: `schema_version: 3`** (v3.1 and v3.2 are additive refinements that did not bump the wire format).
>
> Read this with [00-vision.md](00-vision.md), [01-behavior-core.md](01-behavior-core.md), [02-use-case-as-capability.md](02-use-case-as-capability.md), [04-data-model.md](04-data-model.md), and [06-building-pipeline.md](06-building-pipeline.md). The companion files are:
>
> - `C3-v3.1-authoring-lessons.md` — practical do/don't guidance from the first hand-authoring pass.
> - `C3-AUTHORING-PROGRESS.md` — migration status summary.
> - `C3-4-template-proposal.md` — vision-alignment proposal.
>
> Historical deltas (`C3-schema-v3.1-delta.md`, `C3-schema-v3.2-delta.md`, `C3-v3.1-impact-analysis.md`) live in `_archive/` for change-history lookup.

**Goal:** every template in `scripts/templates/**/*.json` expresses a persona as `behavior core + capability chain list`. The UI reads the structure directly. Adoption questions are scoped to capabilities; disabled capabilities drop their questions automatically.

---

## 1. Normative principles (product laws)

These are not authoring suggestions — every template, every UI surface, and every backend pass MUST satisfy them.

### P1 — Disabled use cases don't exist

If the user turns a use case off in the adoption picker, nothing downstream sees it. The use case contributes **zero** triggers, zero connectors, zero events, zero questions, zero matrix cells, zero flow nodes, zero prompt lines. It's not greyed out — it's gone.

### P2 — Triggers configure per use case with quick-setup + "when"

Each use case that has a trigger declares a default `suggested_trigger`. At adoption, the user accepts the default or reconfigures via a quick-setup picker (`daily | weekly | hourly | custom`). Weekly/daily collect the time-of-day or weekday. The template can set `trigger_composition: "shared"` so all use cases inherit one shared trigger — the picker collapses into a single choice.

### P3 — Messages configure per use case with compose-together option

Each use case declares its delivery. The user picks per-UC delivery or opts into "compose together" so the persona emits one combined message per tick. Template's `message_composition: "combined" | "per_use_case"` seeds the default.

### P4 — Connectors are shared across use cases

Connectors live in `persona.connectors[]`. Use cases reference them by name. Credentials configured once apply wherever referenced.

### P5 — Questions scope to N use cases (N ≥ 0)

A question links to zero, one, or many use cases via `use_case_ids: string[]`:

- Absent or `[]` — persona-level, always shown.
- `["uc_x", "uc_y"]` — shown if **at least one** referenced UC is enabled (any-enabled OR, not all-enabled AND).
- Hidden when every referenced UC is disabled.

Questions that duplicate the picker's enable/disable (e.g. "Track X?" when X is a selectable UC) MUST be removed — the picker IS the toggle.

### P6 — Use case flow is documentation, not execution

`use_case_flow` is a wireframe for humans (gallery, matrix, onboarding). The LLM executes from `operating_instructions` + `tool_guidance` + per-UC `capability_summary`. Flow nodes tell the story in ≤10 nodes; drop trivial action→action chains. Flow node text never enters the prompt.

### P7 — Events use `<domain>.<subdomain>.<action>` syntax

Three-part dotted namespace. First part is the domain (`stocks`, `harvester`, `issue`, `email`). Second is the subdomain (`signals`, `triage`, `backlog`). Third is the terminal action (`buy`, `new`, `accepted`, `delivered`). Cross-persona event subscribers rely on this shape; the backend doesn't enforce it — authoring does.

### P8 — Connectors are required-or-optional; adoption behaves accordingly

`persona.connectors[].required: true | false` (default `true`). At adoption:

- **Required + credentials present** → proceed normally.
- **Required + no credentials** → empty-state with "Create credential" CTA, deep-linked into vault. Adoption blocks until the credential exists.
- **Optional** → "Use {connector} or skip?" step. Skip sets a session flag the promote pipeline consumes (strips connector + verifies fallback).

Templates that reference an optional connector MUST have a working fallback documented in `operating_instructions` and per-UC `error_handling`. Running without it is a supported configuration, not a degraded mode.

---

## 2. File layout

```jsonc
{
  "id": "email-assistant",
  "schema_version": 3,
  "name": "Email Assistant",
  "description": "One-line persona blurb shown in the gallery card.",
  "icon": "Mail",
  "color": "#3b82f6",
  "category": ["productivity"],

  "payload": {
    // ─── BEHAVIOR CORE ───────────────────────────────────────────
    "persona": {
      "goal": "Transform an overwhelming inbox into a daily briefing.",   // unifying value statement (one line)

      "identity": {
        "role": "Email triage assistant",                                  // one sentence
        "description": "Transforms an overwhelming inbox into a briefing."
      },
      "voice": {
        "style": "Direct, calm, respectful of user attention.",
        "output_format": "Lead with the bottom line. Group by priority. Avoid jargon.",
        "tone_adjustments": []
      },
      "principles": [
        "Respect attention — every surfaced item must earn inclusion.",
        "Progressive personalization — learn sender patterns over time."
      ],
      "constraints": [
        "Never send emails on behalf of the user.",
        "Do not purge or archive without explicit approval."
      ],
      "decision_principles": [
        "When uncertain about importance, exclude and note in the footer.",
        "Prefer explicit signals (VIP list) over learned ones when they conflict."
      ],

      // Composition presets — user can override at adoption
      "trigger_composition": "per_use_case",                               // or "shared"
      "message_composition": "per_use_case",                               // or "combined"

      // Persona-wide tool pool
      "tools": ["gmail_search", "gmail_read"],

      // Persona-wide connector registry
      "connectors": [
        {
          "name": "gmail",
          "label": "Gmail",
          "auth_type": "oauth2",
          "role": "email",
          "required": true,                                                // default true
          "setup_instructions": "...",
          "credential_fields": [...]
        },
        {
          "name": "alpha_vantage",
          "label": "Alpha Vantage",
          "required": false,                                               // optional connector
          "fallback_note": "When absent, fall back to Yahoo Finance public endpoints — historical coverage is reduced but current-price checks still work."
        }
      ],

      // Fallback when a capability declares no notification_channels
      "notification_channels_default": [
        { "type": "built-in", "description": "In-app notification" }
      ],

      // Persona-wide prompt sections
      "operating_instructions": "...",                                     // optional paragraph
      "tool_guidance": "...",                                              // optional paragraph
      "error_handling": "...",                                             // optional paragraph

      // Output assertions — declarative post-execution checks
      "output_assertions": [
        {
          "name": "No silent PR abort",
          "type": "not_contains",
          "config": { "patterns": ["opening PR despite test failures"], "case_sensitive": false },
          "severity": "critical",
          "on_failure": "log",
          "enabled": true
        }
      ],
      "output_assertions_opt_out_baseline": false                          // opt out of auto-injected baseline
    },

    // ─── CAPABILITY CHAIN LIST ───────────────────────────────────
    "use_cases": [
      {
        "id": "uc_morning_digest",
        "title": "Morning Digest",                                         // no cadence words — composition step owns cadence
        "description": "Default daily 7am — fetches overnight email, ranks by importance, summarises.",
        "capability_summary": "Daily ranked digest of overnight email.",
        "category": "productivity",
        "enabled_by_default": true,
        "model_override": null,                                            // null inherits persona default

        // Chain artefacts — mirrors the PersonaChronology columns
        "suggested_trigger": {
          "trigger_type": "schedule",
          "config": { "cron": "0 7 * * *", "timezone": "local" },
          "description": "Default morning at 7:00 — final cadence set at the trigger-composition step."
        },
        "connectors": ["gmail"],                                           // names from persona.connectors
        "notification_channels": [
          { "type": "built-in", "description": "Deliver digest to in-app notifications" }
        ],
        "review_policy": { "mode": "never", "context": null },             // see §3.4
        "memory_policy": { "enabled": true, "context": "Persistent sender importance model" },
        "event_subscriptions": [                                           // capability-scoped events
          { "event_type": "email.digest.delivered", "direction": "emit", "notify_titlebar": false },
          { "event_type": "email.inbox.zero",       "direction": "emit", "notify_titlebar": true  },
          { "event_type": "email.digest.error",     "direction": "emit", "notify_titlebar": false }
        ],
        "error_handling": "On Gmail auth failure, notify user and skip cycle.",

        // Optional — UI-only flow visualization (≤10 nodes)
        "use_case_flow": { "nodes": [...], "edges": [...] },

        // Runtime contract
        "input_schema": [
          { "name": "lookback_hours", "type": "number", "default": 12 }
        ],
        "sample_input": { "lookback_hours": 12 },
        "sample_output": {                                                 // adoption Test Run target
          "title": "Daily digest: 3 urgent, 12 normal",
          "body": "### Urgent\n- CEO asked about Q3 numbers\n\n### Normal\n- 12 routine emails, auto-triaged.",
          "format": "markdown"
        },

        "tool_hints": ["gmail_search", "gmail_read"],
        "test_fixtures": [],

        // Per-UC additions to persona-level output assertions (optional)
        "output_assertions": []
      }
    ],

    // ─── SCOPED QUESTIONS ────────────────────────────────────────
    "adoption_questions": [
      {
        "id": "aq_delivery_time",
        "scope": "capability",
        "use_case_ids": ["uc_morning_digest"],                             // array — even for single UC
        "category": "configuration",
        "question": "What time should the morning digest be delivered?",
        "type": "select",
        "options": ["06:00", "07:00", "08:00", "09:00"],
        "default": "07:00",
        "maps_to": "use_cases[uc_morning_digest].suggested_trigger.config.cron_hour",
        "context": "Sets when the daily trigger fires.",
        "dimension": "triggers"
      },
      {
        "id": "aq_tone",
        "scope": "persona",
        "category": "domain",
        "question": "How formal should the digest read?",
        "type": "select",
        "options": ["Casual", "Neutral", "Formal"],
        "default": "Neutral",
        "maps_to": "persona.voice.style",
        "context": "Influences the summariser's register.",
        "dimension": "voice"
      }
    ]
  }
}
```

---

## 3. Field reference

### 3.1 `payload.persona`

| Field | Required | Notes |
|---|---|---|
| `goal` | yes | One-line unifying value statement — rendered as the persona subtitle. |
| `identity.role` | yes | One sentence — "You are X." |
| `identity.description` | yes | One-line elaboration |
| `voice.style` | yes | Tone and posture |
| `voice.output_format` | yes | Formatting expectations |
| `voice.tone_adjustments` | optional | Per-channel tone overrides |
| `principles` | yes | 2–5 cross-cutting rules |
| `constraints` | yes | 2–5 hard limits |
| `decision_principles` | optional | Tiebreakers |
| `trigger_composition` | optional | `"per_use_case"` (default) or `"shared"` (P2) |
| `message_composition` | optional | `"per_use_case"` (default) or `"combined"` (P3) |
| `tools` | yes | String names — persona-wide tool pool |
| `connectors` | yes | Persona-wide connector registry — see §3.2 |
| `notification_channels_default` | yes | Fallback for capabilities without explicit channels |
| `operating_instructions` | optional | Persona-wide how-to-operate paragraph |
| `tool_guidance` | optional | Persona-wide tool-usage paragraph |
| `error_handling` | optional | Persona-wide error-recovery paragraph |
| `output_assertions` | optional | Declarative post-execution checks — see §3.7 |
| `output_assertions_opt_out_baseline` | optional | Default `false`. Set `true` for personas whose legitimate output collides with the baseline phrase set. |

### 3.2 `payload.persona.connectors[]`

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Stable slug. Use a category role name (`email`, `messaging`, `crm`, `storage`) for generic slots; use the brand name (`gmail`, `slack`) only when the persona's identity is bound to that tool. |
| `label` | yes | Display name |
| `auth_type` | yes | `"oauth2"` / `"api_key"` / `"basic"` / `"local"` / etc. |
| `role` | optional | Category role this connector fills |
| `required` | optional | Default `true` (P8). When `false`, `fallback_note` is required. |
| `fallback_note` | conditional | **Required when `required: false`** — short phrase explaining what the persona does without this connector. CI checksum linter errors if missing. |
| `setup_instructions` | yes | Markdown describing how to obtain credentials |
| `credential_fields` | yes | Array of field specs — same shape as the vault catalog |

### 3.3 `payload.use_cases[i]`

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Stable slug `uc_<name>` — referenced from triggers, questions, channels, events |
| `title` | yes | Capability name. **Strip cadence words** — the composition step owns cadence (P2). Use "Personal Briefing" not "Daily Morning Briefing". |
| `description` | yes | 1–2 sentence purpose. Note default cadence here (e.g. "Default daily 7am — final cadence set at the trigger-composition step.") |
| `capability_summary` | yes | One-line version for prompt injection |
| `category` | optional | UI grouping hint |
| `enabled_by_default` | yes | Boolean. Disabled capabilities drop everywhere (P1). |
| `model_override` | optional | `null` inherits persona default. Bare string (`"haiku"`) or partial `ModelProfile` object. |
| `suggested_trigger` | optional | Single trigger object. `null` = manual-only capability. |
| `connectors` | optional | Array of connector names from `persona.connectors` |
| `notification_channels` | optional | Falls back to `persona.notification_channels_default` if absent |
| `review_policy` | optional | `{ mode, context }` — see §3.4 |
| `memory_policy` | optional | `{ enabled, context }` — see §3.5 |
| `event_subscriptions` | optional | Per-capability events — see §3.6 |
| `error_handling` | optional | One-paragraph per-capability override of persona `error_handling` |
| `use_case_flow` | optional | `{ nodes, edges }` — UI-only wireframe (≤10 nodes per P6). Never enters the prompt. |
| `input_schema` | optional | Typed fields the trigger delivers — see §3.8 |
| `sample_input` | optional | Canonical example payload |
| `sample_output` | optional | `{ title?, body?, format? }` — adoption Test Run target. See §3.9. |
| `tool_hints` | optional | Subset of `persona.tools` most relevant to this capability |
| `test_fixtures` | optional | Named test payloads for simulation |
| `output_assertions` | optional | Per-UC additions to persona-level assertions — see §3.7 |

### 3.4 `review_policy` — manual review dimension

```jsonc
"review_policy": {
  "mode": "never",                    // "never" | "on_low_confidence" | "always"
  "context": "When the digest would include a VIP email with low-confidence summary"
}
```

### 3.5 `memory_policy` — agent memory dimension

```jsonc
"memory_policy": {
  "enabled": true,
  "context": "Persistent sender importance model"
}
```

### 3.6 `event_subscriptions[]`

```jsonc
{
  "event_type": "stocks.signals.buy",   // <domain>.<subdomain>.<action> per P7
  "direction": "emit",                   // "emit" | "listen"
  "notify_titlebar": true                // emit-only; default false
}
```

`notify_titlebar: true` adds an entry to the TitleBar bell when this emit event fires. Default `false` (conservative opt-in). Recommended heuristic: execution-noise events (`*.error`, `*.delivered`, `*.completed`) → `false`; high-signal events (`*.at_risk`, `*.sector_shift`, `*.buy`, `*.sell`, `*.anomaly`) → `true`. The flag is silently ignored on `direction: "listen"`.

### 3.7 `output_assertions[]`

Declarative post-execution checks. Persona-level + per-UC entries are merged at normalize time into `suggested_output_assertions[]`, persisted at promote, evaluated by `output_assertions.rs::evaluate_assertions`. `critical`-severity failures downgrade execution status from `Completed` → `Incomplete`, which surfaces in the TitleBar bell as a warning.

```jsonc
{
  "name": "No silent PR abort",
  "description": "Fires when the LLM admits it opened a PR without green tests.",
  "type": "not_contains",                // regex | json_path | contains | not_contains | json_schema | length
  "config": {                            // shape depends on type
    "patterns": ["opening PR despite test failures"],
    "case_sensitive": false
  },
  "severity": "critical",                // info | warning | critical — only critical downgrades status
  "on_failure": "log",                   // log | review | heal
  "enabled": true                        // default true
}
```

**Baseline assertion** is auto-injected unless `persona.output_assertions_opt_out_baseline: true` — checks for prose blockers like *"credentials are not configured"*, *"cannot proceed without"*, *"skipping this step because"*, *"I don't have access to"*, *"is not available in this environment"*. Opt out only when the baseline collides with legitimate output (e.g. a security-audit persona that legitimately says "I don't have access to").

### 3.8 `input_schema[]`

```jsonc
{
  "name": "target_codebase",
  "type": "connector_ref",                // standard JSON-Schema-ish types + "connector_ref"
  "ui_component": "CodebaseSelector",     // optional — names a registered frontend component
  "connector": "codebase",                // required when type = "connector_ref"
  "required": true,
  "description": "Which codebase this capability analyzes."
}
```

`ui_component` is a string key. The questionnaire renderer looks it up in `src/features/templates/inputSchemaComponents.ts`; unknown keys fall back to the default renderer for the field's `type`.

### 3.9 `sample_output`

```jsonc
"sample_output": {
  "title": "Daily digest: 3 urgent, 12 normal",
  "body": "### Urgent\n- CEO asked about Q3 numbers\n\n### Normal\n- 12 routine emails, auto-triaged.",
  "format": "markdown"                  // "markdown" | "plain" | "json" | "html"  (default "plain")
}
```

Consumed by the adoption Test Run button, the per-UC preview, and (when `message_composition === "combined"`) the combined-layout preview falls back to the first enabled UC's `sample_output`. All fields are optional. Unknown `format` values warn-and-coerce to `"plain"` at normalize time.

### 3.10 `payload.adoption_questions[]`

| scope | additional fields | meaning |
|---|---|---|
| `persona` | — | Configures behavior core (voice, identity, shared memory) |
| `capability` | `use_case_ids: string[]` **required** (P5) | Configures one or more capabilities |
| `connector` | `connector_names: string[]` **required** | Configures a connector |

`use_case_id` (singular) is **deprecated**. The normalizer auto-migrates it to `use_case_ids: [<id>]` for backward read. New templates MUST author the plural field. A `scope: "capability"` question with `use_case_ids: []` is a schema error flagged by the checksum tool.

**`maps_to`** is a dotted/bracketed path into `payload`. Adoption patches the template in-place before promoting:

```
persona.voice.style                                              // patches behavior core
use_cases[uc_morning_digest].suggested_trigger.config.cron       // patches capability
persona.connectors[gmail].credential_fields[0].value             // patches connector
```

Disabled capabilities skip all questions whose `use_case_ids` are entirely disabled (P5).

### 3.11 Persona `notification_channels` — runtime shape v2

This is the persona row's runtime shape (written at adoption, not declared by templates). Templates declare `persona.notification_channels_default` as a hint; the adoption flow translates the user's channel-picker selection into shape v2.

```jsonc
[
  { "type": "built-in",  "enabled": true, "use_case_ids": "*" },
  { "type": "titlebar",  "enabled": true, "use_case_ids": ["uc_stock_buy", "uc_risk_alert"], "event_filter": ["stock.signal.buy"] },
  { "type": "slack",     "enabled": true, "credential_id": "cred_xyz", "use_case_ids": ["uc_stock_buy"], "config": { "channel": "#alerts" } }
]
```

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `"built-in" \| "titlebar" \| "slack" \| "telegram" \| "email"`. `built-in` routes via the `personas_messages` connector; `titlebar` emits Tauri events. |
| `enabled` | optional | Default `true` |
| `credential_id` | conditional | Optional for `built-in` / `titlebar`; UI-required for external types |
| `use_case_ids` | yes | `"*"` matches all UCs; array matches listed IDs. Empty array `[]` is rejected by validator (`empty_use_case_ids`). |
| `event_filter` | optional | When present, only listed event types trigger external delivery. Gates `EmitEvent` fanout only — `UserMessage` and `ManualReview` always flow. |
| `config` | optional | Channel-specific (Slack `{channel}`, Telegram `{chat_id}`). Sensitive keys encrypted at rest. |

**Multi-instance allowed** — same `type` may appear multiple times (e.g. two Slack entries routed to different UCs).

### 3.12 Deprecated fields

| Field | Status | Reason |
|---|---|---|
| `persona.core_memories[]` | Do not author | No runtime consumer. Memory is sourced from the runtime `agent_memories` table. |
| `persona.examples[]` | Do not author | Hard-coded to empty in prompt composition. PII risk. Use adoption-flow dynamic substitution. |
| `persona.verbosity_default` | Do not author | No runtime consumer. Verbosity is governed by `ModelProfile.effort`. |
| `use_cases[i].execution_mode` | Reserved | Every template sets `"e2e"`; no other branch. Reserved for future "step" / "dry_run" mode. |
| `adoption_questions[i].use_case_id` | Use `use_case_ids: [...]` instead | Auto-migrated by normalizer for backward read. |

Serde silently ignores extras, so legacy templates with `core_memories: []` or `execution_mode: "e2e"` keep parsing. The checksum linter prints non-blocking warnings on deprecated fields and **errors** on missing `fallback_note` when `required: false`.

---

## 4. Adoption flow

### 4.1 UseCasePickerStep

Shown when `payload.use_cases.length > 1`. Single-UC templates skip the picker. The selection drives:

- which questions render (P5),
- which matrix cells render (P1),
- which triggers/channels/events ship in the built persona (P1),
- which connector gates activate (P8 — only required connectors of still-enabled UCs).

### 4.2 Questionnaire step

```typescript
function shouldShowQuestion(q: AdoptionQuestion, enabledUcIds: Set<string>): boolean {
  if (!q.use_case_ids || q.use_case_ids.length === 0) return true;        // persona-level
  return q.use_case_ids.some(id => enabledUcIds.has(id));
}
```

Connector-scope questions additionally check that the named connector's owning UCs aren't all disabled.

### 4.3 Trigger / message composition step

Renders after UC selection when `trigger_composition` or `message_composition` is set (or default applies). For each enabled UC (or once, if `composition === "shared"`), shows a quick-setup widget (`daily | weekly | hourly | custom`) seeded from `suggested_trigger.config.cron`. Event-listen triggers hide the widget — they're not user-configurable. "Combined" message composition concatenates outputs before delivering.

### 4.4 Connector gate

Before rendering connector-scope questions:

- **Required connector + no credentials** → empty-state with `setup_instructions`, "Create credential" CTA. Adoption blocks.
- **Optional connector** → pick-or-skip. Skip flag flows to promote, which strips the connector and confirms fallback exists in the prompt.

### 4.5 Matrix view

`PersonaMatrixBlueprint` / `PersonaChronologyChain` filter rendered cells by the enabled set. Shared-composition triggers render one cell with a "shared across X capabilities" affordance.

---

## 5. Prompt contract

- **`Active Capabilities`** section lists ONLY enabled UCs (P1). Disabled UCs are invisible.
- **`Operating Instructions`** filtered to drop steps scoped to disabled UCs. Authors should write `operating_instructions` with explicit per-UC sub-sections so filtering is clean.
- **Per-UC `error_handling`** renders as an indented `_Error handling:_ …` line under each enabled UC bullet in the active-capability section. Persona-wide `error_handling` is the baseline.
- **`use_case_flow.nodes[].label/detail`** never enter the prompt (P6).

---

## 6. Backend contract

### 6.1 `AgentIr` carry-through

```rust
pub struct AgentIrUseCaseData {
  pub connectors: Option<Vec<String>>,
  pub review_policy: Option<ReviewPolicy>,
  pub memory_policy: Option<MemoryPolicy>,
  pub error_handling: Option<String>,                  // per-UC override
  pub model_override: Option<ModelOverride>,           // bare string or partial ModelProfile
  pub sample_output: Option<SampleOutput>,
  pub event_subscriptions: Option<Vec<EventSubscription>>,
  pub output_assertions: Option<Vec<OutputAssertion>>,
}

pub struct AgentIr {
  pub goal: Option<String>,
  pub operating_instructions: Option<String>,
  pub tool_guidance: Option<String>,
  pub error_handling_persona: Option<String>,
  pub trigger_composition: Option<String>,
  pub message_composition: Option<String>,
  pub output_assertions: Option<Vec<OutputAssertion>>,
}

pub struct ReviewPolicy { pub mode: String, pub context: Option<String> }
pub struct MemoryPolicy { pub enabled: bool, pub context: Option<String> }
```

### 6.2 Normalizer (`src-tauri/src/engine/template_v3.rs::normalize_v3_to_flat`)

Idempotent. Calling it twice on any payload produces identical output.

| Pass | Purpose |
|---|---|
| `migrate_question_use_case_id` | Singular `use_case_id` → `use_case_ids: [<id>]` (P5) |
| `preserve_connector_required` | Default missing `required` to `true`; pass through to flat IR (P8) |
| `preserve_composition` | Pass `trigger_composition` / `message_composition` through (P2/P3) |
| `hoist_output_assertions` | Merge persona + per-UC assertions; auto-inject baseline `NotContains` unless opted out |
| `hoist_sample_outputs` | Apply `format: "plain"` default; warn-and-coerce unknown formats |
| `hoist_notify_titlebar_flags` | Default `notify_titlebar: false` on `direction: "emit"`; ignore on `direction: "listen"` |

`use_case_flow` is preserved on the chronology-view IR but stripped from the prompt-builder view (P6).

### 6.3 Adoption (`template_adopt.rs::adopt_v3`)

1. Copy `payload.persona` → `AgentIr.structured_prompt` (composed) + decomposed fields.
2. Copy `persona.tools` → `AgentIr.tools`.
3. Copy `persona.connectors` → `AgentIr.required_connectors`.
4. For each enabled UC: build `AgentIrUseCaseData` with all v3 fields; push triggers tagged with `use_case_id`; push event subscriptions with the UC's id.
5. Apply `adoption_answers` via each question's `maps_to` path.
6. Filter out disabled capabilities — remove their entries, triggers, event subs, channels before promoting.
7. Pass to `promote_build_draft_inner`. The transaction inserts triggers, output assertions, and event subscriptions tagged with `use_case_id`.

### 6.4 Build pipeline (CLI from-scratch)

`src-tauri/src/engine/build_session.rs::run_session` enforces a state-machine gate that suppresses out-of-order `capability_resolution` events for `suggested_trigger` / `connectors` / `review_policy` / `memory_policy` until a clarifying question for that field has been asked and answered. When the LLM skips the gate, a clarifying question is synthesized locally — UI surfaces don't depend on LLM cooperation.

Per-capability gates (`Closed | Pending | Open`) auto-open when intent heuristics unambiguously name a value (e.g. `"incoming"` → event trigger, `"stateless"` → memory disabled). `agent_ir` cannot promote while any gate is closed.

---

## 7. Backward compatibility

`schema_version: 3` covers v3, v3.1, and v3.2 simultaneously. The wire format never bumped.

- Templates without v3.1/v3.2 fields normalize byte-for-byte identical to their pre-refinement output.
- Templates with the new fields normalize with defaults applied; new fields survive to flat IR and promote.
- Persona-row `notification_channels` shape A (preferences object), shape B (channels array without `use_case_ids`), and shape v2 all dispatch through their own parser branches with zero rewrites.
- `encrypt_notification_channels` / `decrypt_notification_channels` bodies are unchanged.

Pre-v3.2 persona rows that need re-editing in the v2 agent-editor render as "Legacy — re-save to edit" read-only. Dispatch path for those rows is untouched.

---

## 8. Worked example — Financial Stocks Signaller

**Unifying goal:** provide valuable data for investment decisions.

```jsonc
"persona": {
  "goal": "Provide valuable data for investment decisions.",
  "trigger_composition": "shared",                                         // all UCs fire on the same weekly tick
  "message_composition": "combined",                                       // one weekly briefing, not three
  "connectors": [
    { "name": "market_data",   "required": true,  ... },
    { "name": "quiver_quant",  "required": true,  ... },                   // congressional disclosures
    { "name": "alpha_vantage", "required": false, "fallback_note": "When absent, fall back to Yahoo Finance public endpoints — historical coverage reduced but current-price checks still work." },
    { "name": "messaging",     "required": true,  ... }
  ]
}
```

Three use cases:

1. **`uc_signals`** — Weekly signal fetcher. RSI/MACD/momentum on user-selected tickers. `review_policy: always` (reviewed decisions persist as simulated trades). Emits `stocks.signals.{buy,sell,hold}`. Linked questions: `aq_tickers`, `aq_signal_weighting`.
2. **`uc_congressional_scan`** — Congressional disclosure scan. `review_policy: always`. Emits `stocks.congress.{disclosure,sector_shift}`. Linked: `aq_sector_interest` (shared with `uc_gems`).
3. **`uc_gems`** — Sector gem discovery. Under-covered names with strong signals. `review_policy: always`. Emits `stocks.gems.{discovered,filtered_out}`. Linked: `aq_sector_interest`.

Adoption questions (5):

```
- aq_tickers           — use_case_ids: [uc_signals]
- aq_signal_weighting  — use_case_ids: [uc_signals]
- aq_sector_interest   — use_case_ids: [uc_congressional_scan, uc_gems]
- aq_message_channel   — use_case_ids: [] (persona-level)
- aq_alpha_vantage_pick — scope: connector, connector_names: [alpha_vantage]
                          — pick-or-skip per P8
```

Removed from earlier authoring: `aq_lookback_hours` (rolled into `suggested_trigger.config`), `aq_max_digest_items` (lives in prompt), `aq_strategy_backtest_enabled` (use case removed).

---

## 9. Explicit non-goals

- Not introducing a DAG / flow-composition primitive between capabilities.
- Not scoping tools per capability — all persona tools remain available to every capability; `tool_hints` is advisory only.
- Not migrating historical personas (already promoted from v1/v2) — they keep their current shape; only new adoptions use v3.
