# C3 — Template Schema v3 (execution spec)

> This document pins the **final** template shape the persona builder will
> consume. It does not design from scratch — it builds on
> [00-vision.md](00-vision.md), [01-behavior-core.md](01-behavior-core.md),
> [02-use-case-as-capability.md](02-use-case-as-capability.md),
> [04-data-model.md](04-data-model.md), and
> [06-building-pipeline.md](06-building-pipeline.md). It commits the
> decisions those docs left open and scopes the migration work.
>
> **Goal:** every template in `scripts/templates/**/*.json` expresses a
> persona as `behavior core + capability chain list`. The UI
> (`PersonaChronologyChain` / `PersonaChronologyWildcard`) reads this
> structure directly. Adoption questions are scoped to capabilities;
> disabled capabilities drop their questions automatically.

---

## 1. Why v3 (and what's wrong with v2)

The v2 pilot (`email-morning-digest.json`) added `schema_version: 2`,
`capability_summary`, `tool_hints`, and `scope` tags on questions — but
left triggers, connectors, notification channels, and event subscriptions
as **payload-level arrays**. That's why the chronology UI has to guess
linkage via `use_case_id` and the extractor falls back to "shared across
all" in many templates.

v3 commits to the nested shape that [06-building-pipeline.md §Template
v2](06-building-pipeline.md) already prescribed but never landed. The
result: zero guessing. Every trigger, every channel, every event lives
inside the capability that owns it. Persona-wide items (shared tools,
connectors, core memories) live in `payload.persona`.

## 2. File layout (final)

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
      "identity": {
        "role": "Email triage assistant",                    // one sentence
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
      "verbosity_default": "normal",

      // Shared across capabilities — the pool the runtime exposes.
      "tools": ["gmail_search", "gmail_read"],
      "connectors": [
        {
          "name": "gmail",
          "label": "Gmail",
          "auth_type": "oauth2",
          "role": "email",
          "setup_instructions": "...",
          "credential_fields": [...]
        }
      ],

      // Fallback when a capability declares no notification_channels.
      "notification_channels_default": [
        { "type": "built-in", "description": "In-app notification" }
      ],

      // Persona-wide core memories (always injected). Optional.
      "core_memories": []
    },

    // ─── CAPABILITY CHAIN LIST ───────────────────────────────────
    "use_cases": [
      {
        "id": "uc_morning_digest",
        "title": "Morning Email Digest",
        "description": "Fetches overnight email, ranks by importance, summarises.",
        "capability_summary": "Daily ranked digest of overnight email.",
        "category": "productivity",
        "enabled_by_default": true,
        "execution_mode": "e2e",
        "model_override": null,

        // ─── Chain artefacts — mirrors the PersonaChronology columns ───
        "suggested_trigger": {
          "trigger_type": "schedule",
          "config": { "cron": "0 7 * * *", "timezone": "local" },
          "description": "Every morning at 7:00 local time."
        },
        "connectors": ["gmail"],                             // names from persona.connectors
        "notification_channels": [
          { "type": "built-in", "description": "Deliver digest to in-app notifications" }
        ],
        "review_policy": {                                   // manual_review capability
          "mode": "never",                                   // "never" | "on_low_confidence" | "always"
          "context": null
        },
        "memory_policy": {                                   // agent_memory capability
          "enabled": true,
          "context": "Persistent sender importance model"
        },
        "event_subscriptions": [                             // capability-scoped events
          { "event_type": "digest_delivered", "direction": "emit" },
          { "event_type": "inbox_zero", "direction": "emit" },
          { "event_type": "digest_error", "direction": "emit" }
        ],
        "error_handling": "On Gmail auth failure, notify user and skip cycle.",

        // Optional — supports the UI's expanded flow view.
        "use_case_flow": {
          "nodes": [...],
          "edges": [...]
        },

        // Runtime contract — what the capability expects and a canned example.
        "input_schema": [
          { "name": "lookback_hours", "type": "number", "default": 12 }
        ],
        "sample_input": { "lookback_hours": 12 },

        "tool_hints": ["gmail_search", "gmail_read"],
        "test_fixtures": []
      }
    ],

    // ─── SCOPED QUESTIONS ────────────────────────────────────────
    "adoption_questions": [
      {
        "id": "aq_delivery_time",
        "scope": "capability",
        "use_case_id": "uc_morning_digest",
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

## 3. Field decisions — what's final

### 3.1 `payload.persona` (behavior core)

Every field required unless marked optional.

| Field | Required | Notes |
|---|---|---|
| `identity.role` | yes | One sentence — "You are a X." |
| `identity.description` | yes | One-line elaboration |
| `voice.style` | yes | Tone and posture |
| `voice.output_format` | yes | Formatting expectations |
| `voice.tone_adjustments` | optional | Per-channel tone overrides |
| `principles` | yes | 2-5 cross-cutting rules |
| `constraints` | yes | 2-5 hard limits |
| `decision_principles` | optional | Tiebreakers |
| `verbosity_default` | yes | `"terse"` \| `"normal"` \| `"verbose"` |
| `tools` | yes | String names, persona-wide tool pool |
| `connectors` | yes | Persona-wide connector registry |
| `notification_channels_default` | yes | Fallback for capabilities without explicit channels |
| `core_memories` | optional | Always-injected memory entries |

### 3.2 `payload.use_cases[i]` (capabilities)

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Stable slug `uc_<name>` — cross-referenced everywhere |
| `title` | yes | Human-readable capability name |
| `description` | yes | 1-2 sentence purpose |
| `capability_summary` | yes | One-line version for prompt injection |
| `category` | optional | UI grouping hint |
| `enabled_by_default` | yes | Boolean — disabled capabilities dropped at adoption |
| `execution_mode` | optional | `"e2e"` \| `"mock"` \| `"non_executable"`, default `"e2e"` |
| `model_override` | optional | `null` inherits persona default |
| `suggested_trigger` | optional | Single trigger object. `null` = manual-only capability. |
| `connectors` | optional | Array of connector names from `persona.connectors` |
| `notification_channels` | optional | Falls back to `persona.notification_channels_default` if absent |
| `review_policy` | optional | `{ mode, context }` — see §3.3 |
| `memory_policy` | optional | `{ enabled, context }` — see §3.4 |
| `event_subscriptions` | optional | Per-capability events (direction: `emit` \| `listen`) |
| `error_handling` | optional | One-paragraph per-capability override of persona error_handling |
| `use_case_flow` | optional | `{ nodes, edges }` — visual workflow diagram for UI expansion |
| `input_schema` | optional | Typed fields the trigger delivers |
| `sample_input` | optional | Canonical example payload |
| `tool_hints` | optional | Subset of `persona.tools` most relevant to this capability |
| `test_fixtures` | optional | Named test payloads for simulation |

### 3.3 `review_policy` — the "Human Review" dimension

Replaces the `protocol_capabilities[].type='manual_review'` pattern with
a per-capability declaration:

```jsonc
"review_policy": {
  "mode": "never",              // or "on_low_confidence", "always"
  "context": "When the digest would include a VIP email with low-confidence summary"
}
```

### 3.4 `memory_policy` — the "Memory" dimension

Replaces `protocol_capabilities[].type='agent_memory'`:

```jsonc
"memory_policy": {
  "enabled": true,
  "context": "Persistent sender importance model"
}
```

### 3.5 `adoption_questions[]`

Scope rules (final):

| scope | additional fields | meaning |
|---|---|---|
| `persona` | — | Configures behavior core (voice, identity, shared memory) |
| `capability` | `use_case_id` **required** | Configures one capability |
| `connector` | `connector_names: string[]` **required** | Configures a connector |

**`maps_to` is a dotted/bracketed path** into `payload`. Adoption patches
the template in-place before promoting:

```
persona.voice.style                                  // patches behavior core
use_cases[uc_morning_digest].suggested_trigger.config.cron   // patches capability
persona.connectors[gmail].credential_fields[0].value          // patches connector
```

Disabled capabilities (user unchecked in `UseCasePickerStep`) skip all
questions with `scope: "capability"` pointing at their `use_case_id`.
Already implemented in `MatrixAdoptionView.filteredAdoptionQuestions`.

## 4. What drops from v1/v2

All of these **disappear** from the top of `payload`:

- `suggested_triggers[]`           — moves into `use_cases[i].suggested_trigger`
- `suggested_connectors[]`         — moves into `persona.connectors[]`, per-capability uses become `use_cases[i].connectors: string[]`
- `suggested_notification_channels[]` — moves into `use_cases[i].notification_channels[]` or `persona.notification_channels_default[]`
- `suggested_event_subscriptions[]` — moves into `use_cases[i].event_subscriptions[]`
- `suggested_tools[]`              — moves into `persona.tools[]`
- `suggested_parameters[]`         — moves into the relevant `use_cases[i].input_schema[]` or `persona.core_memories`
- `protocol_capabilities[]`        — split into per-capability `review_policy` / `memory_policy` + capability-scoped `event_subscriptions`
- `structured_prompt`              — promoted to `persona.structured_prompt` OR decomposed into `persona.identity`/`voice`/`principles`/`constraints` (see §5)
- `use_case_flows[]`               — folds into `use_cases[i].use_case_flow`
- `service_flow[]`                 — not propagated (was legacy n8n carryover)
- `design_highlights[]`            — drops; gallery card reads from `description` + capability count

## 5. `structured_prompt` decomposition

v2 keeps `structured_prompt` as an opaque blob with `identity`,
`instructions`, `toolGuidance`, `examples`, `errorHandling`. v3
decomposes it so each section has a semantic home:

| v2 field | v3 home |
|---|---|
| `identity` (blob prose) | split into `persona.identity.role` + `persona.identity.description` |
| `instructions` (how the persona operates in general) | `persona.operating_instructions` (NEW — optional paragraph) |
| `instructions` (per-capability steps) | `use_cases[i].steps[]` or `use_cases[i].use_case_flow.nodes` |
| `toolGuidance` | `persona.tool_guidance` (NEW — optional paragraph) |
| `examples` | drops to `use_cases[i].test_fixtures` or `sample_input` when capability-specific; persona-wide examples stay in `persona.examples` |
| `errorHandling` | `persona.error_handling` (plus optional per-capability override) |

The runtime prompt assembler (`src-tauri/src/engine/prompt.rs`) reads
these individual fields directly. Existing consumers continue to read
`structured_prompt` during a deprecation window — the migration script
emits a **composed** `structured_prompt` alongside the decomposed fields
so old runtime code still works.

## 6. Backend contract

### 6.1 AgentIr alignment

`AgentIr` already carries `use_case_id` on triggers and v2 fields on
`AgentIrUseCaseData` (confirmed in `src-tauri/src/db/models/agent_ir.rs`).
v3 adds the following fields to `AgentIrUseCaseData` (additive, default
absent):

```rust
pub struct AgentIrUseCaseData {
  // existing v2 fields ...
  pub connectors: Option<Vec<String>>,               // NEW
  pub review_policy: Option<ReviewPolicy>,           // NEW
  pub memory_policy: Option<MemoryPolicy>,           // NEW
  pub error_handling: Option<String>,                // NEW (per-capability override)
}

pub struct ReviewPolicy {
  pub mode: String,                                   // "never" | "on_low_confidence" | "always"
  pub context: Option<String>,
}

pub struct MemoryPolicy {
  pub enabled: bool,
  pub context: Option<String>,
}
```

`AgentIr` itself adds optional persona-level decomposed fields:

```rust
pub struct AgentIr {
  // existing ...
  pub operating_instructions: Option<String>,        // NEW
  pub tool_guidance: Option<String>,                 // NEW
  pub error_handling_persona: Option<String>,        // NEW (distinct from per-use-case)
}
```

### 6.2 Adoption path

`src-tauri/src/commands/design/template_adopt.rs` gains a v3 branch:

```rust
match template.schema_version {
  3 => adopt_v3(template, answers),
  2 => adopt_v2(template, answers),  // transitional
  _ => Err(AppError::Unsupported("Template schema pre-v2 no longer adoptable")),
}
```

`adopt_v3` constructs the AgentIr directly (no LLM):

1. Copy `payload.persona` → `AgentIr.structured_prompt` (composed) + the new decomposed fields.
2. Copy `payload.persona.tools` → `AgentIr.tools`.
3. Copy `payload.persona.connectors` → `AgentIr.required_connectors`.
4. For each enabled `payload.use_cases[i]`:
   - Build an `AgentIrUseCaseData` with all v3 fields.
   - If `suggested_trigger` present: push an `AgentIrTrigger` with `use_case_id = use_cases[i].id`.
   - If `event_subscriptions` present: push `AgentIrEvent` entries (for `direction: listen`) or capability `event_subscriptions` (for `emit`).
5. Apply `adoption_answers` via each question's `maps_to` path — JSON Pointer style write into the IR.
6. Filter out disabled capabilities: remove their entries, triggers, and subscriptions before promoting.
7. Pass to `promote_build_draft_inner`. Existing transaction writes triggers with `use_case_id` semantically.

### 6.3 CLI from-scratch path

Separate work. Not blocking the template migration. Tracked in
[06-building-pipeline.md §CLI build prompt changes](06-building-pipeline.md).
The build-session prompt gains a dimension-framework section describing
the behavior-core / capability split so the LLM emits v3-shaped IR.

## 7. Frontend contract

### 7.1 Chronology data helper

`src/features/templates/sub_generated/adoption/chronology/useUseCaseChronology.ts`
is updated to read v3 first, fall back to v2 shape:

```ts
function buildChronology(designResult): ChronologyRow[] {
  if (designResult.schema_version >= 3) return buildFromV3(designResult);
  return buildFromV2(designResult);  // existing behaviour
}
```

v3 makes presence resolution deterministic — every dimension is either
defined on the capability (`linked`) or inherits from persona
(`shared`) or is absent (`none`). No guessing.

### 7.2 PersonaMatrix editors

The Matrix editor UI (legacy `PersonaMatrix` + adoption variants) reads
the AgentIr through the existing `extractDimensionData` helper. That
helper already filters by `selectedUseCaseIds` (confirmed in
`MatrixAdoptionView.tsx`). v3 simply makes the extraction total — per-
capability triggers/connectors/channels come directly from the nested
structure without the old positional heuristics.

### 7.3 Question scoping in the UI

`QuestionnaireFormFocus` already scopes per capability via
`filteredAdoptionQuestions`. v3 changes nothing in the UI; it just makes
every template consistently use `scope` + `use_case_id`.

## 8. Migration strategy

### 8.1 Per-template cost

Not mechanical enough for a pure script. For each template:

- **Mechanical (scripted, ~1 min/template):**
  - Reshape JSON — move `suggested_*` arrays into capabilities.
  - Positional matching when `count(triggers) == count(use_case_flows)`.
  - Seed empty `persona.voice` / `principles` / `constraints` with
    `"# TODO: fill"` markers.
- **Hand pass (~15-30 min/template):**
  - Author `voice`, `principles`, `constraints`, `decision_principles`.
  - Rewrite `identity` to be voice-first.
  - Fill `capability_summary` per use case.
  - Decide which v1 `suggested_parameters` become `adoption_questions`
    vs. `sample_input`.
  - Tag questions with scope + use_case_id.

### 8.2 Execution order

1. **Now (in-session):**
   - Write this spec. ✓
   - Produce **one fully-hand-authored v3 pilot**
     (`email-morning-digest.json`) to prove the shape end-to-end.
   - Update `useUseCaseChronology.ts` to read v3.
   - Stop — user reviews the pilot.

2. **After pilot approval:**
   - Write the mechanical migration script (`scripts/migrate_templates_v3.mjs`).
   - Bulk-run it with `--dry-run` — emit a report, no file changes.
   - Bulk-run for real — each template gets scaffolded v3 with TODO
     markers.
   - Hand pass tier 1 (3-5 flagship templates) — validate that
     hand-authored content reads well in the UI.
   - Hand pass tier 2 (per-category flagships) — 1-2 per category.
   - Hand pass tier 3 (bulk remainder) — can be parallelised across
     sessions.

3. **Backend landing:**
   - Extend `AgentIrUseCaseData` with `connectors`, `review_policy`,
     `memory_policy`, `error_handling`.
   - Add `adopt_v3` branch in `template_adopt.rs`.
   - Add the `adopt_v3` unit/integration tests in `src-tauri/tests/`.
   - Sweep harness re-run — expect subscriptions_attributed to jump from
     5 → ~60 and grade A count to jump as capability summaries get
     populated.

### 8.3 Merge policy

Templates with duplicate personas merge into one v3 template with
multiple capabilities. Candidates (from
[C2-execution-plan.md §Planned consolidations](C2-execution-plan.md)):

- **Email Assistant** ← email-morning-digest, email-follow-up-tracker, email-task-extractor, intake-processor
- **Sales Operations** ← contact-enrichment-agent, contact-sync-manager, crm-data-quality-auditor, sales-pipeline-autopilot, sales-deal-tracker
- **Codebase Guardian** ← qa-guardian, devops-guardian, documentation-freshness-guardian, codebase-health-scanner

**Policy:** merged templates ship as new archetypes *alongside* the
originals. Originals flip `is_published=false` once the archetypes prove
useful (post-C3 decision, requires adoption telemetry). This avoids
losing single-capability entry points while the archetypes mature.

## 9. Success criteria

Before declaring v3 done:

- [ ] `email-morning-digest.json` is a fully v3 template with every chain
      artefact nested under `use_cases[0]`.
- [ ] `useUseCaseChronology.ts` reads v3 without fallbacks kicking in
      for that template.
- [ ] Adoption of the pilot produces a persona whose `design_context`
      reflects the v3 shape (verified via the live-harness
      `/persona-detail` endpoint).
- [ ] `adopt_v3` path in `template_adopt.rs` exists and is unit-tested.
- [ ] Mechanical migration script produces a scaffolded v3 file for
      every v1/v2 template without manual intervention (but with TODO
      markers flagging hand-passes).
- [ ] At least 10 templates are hand-authored to v3 quality (Tier 1 + 3
      mid-tier).
- [ ] Sweep harness (`tools/test-mcp/e2e_c2_sweep.py`) adapted to the
      v3 checks from
      [C2-execution-plan.md §Test per-template rubric](C2-execution-plan.md).
- [ ] Zero sweep regressions vs. the pre-migration baseline.

## 10. Explicit non-goals

- Not redesigning the CLI from-scratch build path in this pass (the LLM
  prompt changes are [06-building-pipeline.md §CLI build prompt changes](06-building-pipeline.md)).
- Not introducing a DAG / flow-composition primitive between capabilities.
- Not scoping tools per capability — all persona tools remain available
  to every capability; `tool_hints` is advisory only.
- Not migrating historical personas (already promoted from v1/v2) —
  they keep their current shape; only new adoptions use v3.

---

## Appendix A — v2 → v3 field mapping cheatsheet

| v2 field | v3 home |
|---|---|
| `payload.structured_prompt.identity` | `payload.persona.identity.description` (+ `role` extracted) |
| `payload.structured_prompt.instructions` | `payload.persona.operating_instructions` |
| `payload.structured_prompt.toolGuidance` | `payload.persona.tool_guidance` |
| `payload.structured_prompt.errorHandling` | `payload.persona.error_handling` |
| `payload.structured_prompt.examples` | `payload.persona.examples` or per-capability `test_fixtures` |
| `payload.suggested_tools` | `payload.persona.tools` |
| `payload.suggested_connectors` | `payload.persona.connectors` |
| `payload.suggested_triggers[i]` | `payload.use_cases[j].suggested_trigger` (where j matches trigger's `use_case_id`) |
| `payload.suggested_notification_channels` | `payload.use_cases[j].notification_channels` (per capability) or `payload.persona.notification_channels_default` |
| `payload.suggested_event_subscriptions` | `payload.use_cases[j].event_subscriptions` |
| `payload.suggested_parameters[i]` | `payload.use_cases[j].input_schema[i]` or `payload.persona.core_memories` |
| `payload.protocol_capabilities[type=manual_review]` | `payload.use_cases[j].review_policy` |
| `payload.protocol_capabilities[type=agent_memory]` | `payload.use_cases[j].memory_policy` |
| `payload.protocol_capabilities[type=emit_event]` | implicit — declared via `use_cases[j].event_subscriptions[direction=emit]` |
| `payload.use_case_flows[i]` | `payload.use_cases[i]` with `nodes/edges` under `use_case_flow` |
| `payload.design_highlights` | dropped — replaced by capability-level `capability_summary` |
| `payload.service_flow` | dropped — n8n legacy |

## Appendix B — Worked example

See `scripts/templates/productivity/email-morning-digest.json` after
this doc is accepted. It is the reference v3 template. Every other
template should converge on that shape.
