# C2 — Template & AgentIr Audit

> Prepared for Phase C2 execution. Parallel to C1 (runtime foundation) which
> touches `prompt.rs` + `executions.rs`. This document's scope is **templates**
> and **AgentIr**.
>
> Scope: 107 templates under `scripts/templates/**/*.json`, the AgentIr v2
> gap, the migration script design, the adoption flow v2 branch, and the CLI
> build prompt rewrite.

## Section 1 — Template inventory

### Count

- **Total templates:** 107 (`scripts/templates/**/*.json` — matches plan's
  expected count).
- Spread across 14 category directories (`content`, `development`, `devops`,
  `email`, `finance`, `hr`, `legal`, `marketing`, `productivity`,
  `project-management`, `research`, `sales`, `security`, `support`).

### Sample (12 templates, diverse categories)

| Template | Flows | Triggers | Subs | Channels | AQs | Tools | Trigger types |
|---|---|---|---|---|---|---|---|
| `finance/financial-stocks-signaller` | 3 | 2 | 9 | 1 | 6 | 5 | schedule, manual |
| `support/customer-feedback-router` | 3 | 2 | 3 | 1 | 8 | 3 | polling, schedule |
| `development/autonomous-issue-resolver` | 3 | 3 | 4 | 2 | 8 | 3 | polling, schedule, schedule |
| `productivity/router` | 3 | 1 | 3 | 2 | 8 | 4 | webhook |
| `productivity/digital-clone` | 3 | 3 | 5 | 1 | 8 | 8 | polling, schedule, manual |
| `email/intake-processor` | 3 | 1 | 2 | 1 | 8 | 6 | polling |
| `devops/incident-logger` | 2 | 3 | 6 | 2 | 6 | 2 | manual, event, schedule |
| `content/newsletter-curator` | 2 | 1 | 4 | 2 | 5 | 3 | schedule |
| `hr/onboarding-tracker` | 2 | 3 | 5 | 3 | 6 | 5 | polling, schedule, schedule |
| `legal/contract-lifecycle-use-case` | 3 | 3 | 5 | 2 | 8 | 5 | webhook, schedule, schedule |
| `marketing/web-marketing` | 3 | 1 | 4 | 1 | 5 | 3 | schedule |
| `research/research-paper-indexer` | 2 | 3 | 3 | 2 | 5 | 4 | schedule, schedule, manual |
| `sales/sales-pipeline-autopilot` | 3 | 2 | 3 | 1 | 8 | 5 | polling, schedule |

### Aggregate field usage across all 107 templates

| Field | Populated templates |
|---|---|
| `payload.structured_prompt` | **107 / 107** (100%) |
| `payload.system_prompt` | **0 / 107** — never used (plan is correct to treat structured_prompt as canonical) |
| `payload.structured_prompt.identity` as **string** | **107 / 107** (all are strings, never objects) |
| `payload.use_case_flows[]` | **105 / 107** (missing: `youtube-content-pipeline`, `autonomous-cro-experiment-runner`) |
| `payload.suggested_triggers[]` | **100 / 107** (missing 7 templates — see below) |
| `payload.suggested_event_subscriptions[]` | **105 / 107** (missing: `codebase-health-scanner`, `ai-weekly-research`) |
| `payload.suggested_notification_channels[]` | **106 / 107** (missing: `ai-weekly-research`) |
| `payload.adoption_questions[]` | **104 / 107** (missing: `youtube-content-pipeline`, `reddit-trend-digest`, `website-conversion-audit`) |

### Count distribution (min / p25 / median / p75 / max / avg)

| Field | min | p25 | median | p75 | max | avg |
|---|---|---|---|---|---|---|
| `use_case_flows` per template | 0 | 2 | **3** | 3 | 3 | 2.54 |
| `suggested_triggers` per template | 0 | 1 | **2** | 2 | **6** | 1.87 |
| `suggested_event_subscriptions` | 0 | 3 | **3** | 4 | 9 | 3.51 |
| `suggested_notification_channels` | 0 | 1 | **1** | 2 | 3 | 1.49 |
| `adoption_questions` | 0 | 5 | **6** | 8 | 9 | 6.16 |

### Templates missing triggers (7 total)

`demo-recorder`, `feature-video-creator`, `social-media-designer`,
`youtube-content-pipeline`, `visual-brand-asset-factory`,
`website-conversion-audit`, `idea-harvester`.

These are likely manual-only templates; treat as `suggested_trigger: { type:
"manual" }` per capability during migration.

### `adoption_questions[].maps_to` — usage

- **29 of 659 total questions** have `maps_to` (≈4%).
- Remaining **630 questions** have no explicit field target.
- Target shapes observed:
  - `parameter.<key>` — most common (e.g. `parameter.strictness`,
    `parameter.target_niche`, `parameter.max_results`).
  - `config.<key>` — e.g. `config.tts_provider`, `config.image_model`,
    `config.url_column`.
  - `connector.<name>.<field>` — e.g.
    `connector.google_sheets.spreadsheet_id`, `connector.slack.channel`.
  - `trigger.schedule.cron` — one instance only.

**Implication:** `maps_to` is not currently the primary answer-application
mechanism. The `substitute_variables` function in
`src-tauri/src/engine/adoption_answers.rs:56` substitutes `{{param.KEY}}`
placeholders everywhere. `maps_to` is metadata the LLM uses but the Rust
side ignores. In v2 we should keep it that way or formalize `maps_to` paths
into v2 use-case fields — the plan requires it for targeting
`use_cases[uc_id].sample_input.X`.

### `structured_prompt` structure — uniform across 107 templates

Every template has the shape:

```json
{
  "identity": "<multi-paragraph string>",
  "instructions": "<multi-paragraph string, often with step headings>",
  "toolGuidance": "<string, connector-specific API call examples>",
  "examples": "<string or JSON array>",
  "errorHandling": "<string>"
}
```

No template has `identity` as an object (critical for the plan — the doc's
v2 example shows `"identity": { "role": "...", ... }` which is an *upgrade*,
not a compatibility requirement).

### Structural variations & surprises

- **45 templates have `payload.suggested_parameters`** — a parallel array to
  `adoption_questions` with keys/labels/defaults/min/max/description for
  tunable configuration. These are numeric knobs (e.g. `min_sample_size`,
  `target_duration_minutes`) distinct from Q&A. The plan does not mention
  them; they should map to v2 `use_cases[i].input_schema` or survive as
  `persona.parameters[]` at the persona level. **Recommendation:** preserve
  as `persona.parameters` in v2 (persona-wide tunables).
- **1 template has `payload.parameters`** (no `suggested_` prefix) —
  `autonomous-cro-experiment-runner`. Same shape as `suggested_parameters`.
  Migration should normalize both into `persona.parameters`.
- **103 of 107 templates have `payload.protocol_capabilities`** — a list of
  protocol advertisements (`manual_review`, `user_message`, `agent_memory`,
  `emit_event`, `propose_improvement`). This is authored for UI catalog
  filtering. Migration should preserve at `persona.protocol_capabilities` or
  drop (runtime doesn't read this field — verify before dropping).
- **`payload.suggested_connectors[].related_triggers`** — some templates
  reference triggers positionally (e.g. `related_triggers: [0]`). After
  migration the positional index is no longer meaningful because triggers
  move inside capabilities. Rewrite as `related_use_case_ids: ["uc_..."]`.
- **Flow/trigger count mismatches are the norm, not the exception.**
  65 of 100 trigger-bearing templates have `suggested_triggers.length !=
  use_case_flows.length`. The positional mapping baked into the plan would
  misalign on most templates (see Section 3 edge case #1).

### Plan drift (Section 1)

- Plan says "10/10 sampled templates mechanically convertible"
  (06-building-pipeline.md:388). Reality: **most sampled templates do not
  have a 1:1 flow-to-trigger relationship**. Three flows + one trigger is
  common (e.g. `documentation-freshness-guardian`, `devops-guardian`,
  `qa-guardian`). The migration algorithm must tolerate this.
- Plan assumes `structured_prompt.identity` can be either string or object
  (example at 06-building-pipeline.md:231 shows an object). Reality: **all
  107 are strings**. Migration needs to either (a) leave identity as a
  string and add siblings (`voice`, `principles`), or (b) convert identity
  to an object with a `role` subfield. Option (a) is less disruptive and
  matches the ESLint/runtime reality today.

---

## Section 2 — AgentIr v2 gap analysis

File: `src-tauri/src/db/models/agent_ir.rs` (334 lines, current).

### Required additions — `AgentIrTrigger`

Current struct (line 93):

```rust
pub struct AgentIrTrigger {
    #[serde(default)]
    pub trigger_type: Option<String>,
    #[serde(default)]
    pub config: Option<serde_json::Value>,
    #[serde(default)]
    pub description: Option<String>,
}
```

**Add after line 99 (inside the struct, before `}`):**

```rust
    /// Semantic linkage to a use case — populated by v2 templates and
    /// v2 CLI outputs. Falls back to positional when absent.
    #[serde(default)]
    pub use_case_id: Option<String>,
```

All additive; no existing consumer breaks.

### Required additions — `AgentIrUseCaseData`

Current struct (line 258, ends at line 271):

```rust
pub struct AgentIrUseCaseData {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub execution_mode: Option<String>,
    #[serde(default, alias = "events")]
    pub event_subscriptions: Vec<AgentIrUseCaseEvent>,
}
```

**Add before closing brace (after line 270):**

```rust
    /// Explicit stable id — v2 templates emit `uc_<slug>`. v1-derived IRs
    /// may leave this None; the promote path then generates `uc-<uuid>`.
    #[serde(default)]
    pub id: Option<String>,

    /// Per-capability notification channels. Schema matches the existing
    /// top-level `notification_channels` shape (Value to stay permissive).
    #[serde(default)]
    pub notification_channels: Option<serde_json::Value>,

    /// Per-capability model profile override. Value-typed because the
    /// `ModelProfile` shape is still evolving on the frontend.
    #[serde(default)]
    pub model_override: Option<serde_json::Value>,

    /// Named test fixtures for simulation. Value-typed for forward compat.
    #[serde(default)]
    pub test_fixtures: Option<serde_json::Value>,

    /// Tool names most relevant to this capability — prompt-renderer uses
    /// these as hints in the Active Capabilities section.
    #[serde(default)]
    pub tool_hints: Option<Vec<String>>,

    /// One-line capability description injected into the prompt.
    /// Falls back to `description` when absent.
    #[serde(default)]
    pub capability_summary: Option<String>,

    /// Runtime toggle. Absent = enabled (default true). Set to Some(false)
    /// to disable without rebuilding.
    #[serde(default)]
    pub enabled: Option<bool>,

    /// Optional workflow diagram carried over from v1 `use_case_flows[i]`
    /// (nodes + edges). Documentation-only; runtime does not read.
    #[serde(default)]
    pub use_case_flow: Option<serde_json::Value>,

    /// Input schema for structured capability input. Value-typed to match
    /// `DesignUseCase.input_schema` in persona.rs.
    #[serde(default)]
    pub input_schema: Option<serde_json::Value>,

    /// Canonical example payload.
    #[serde(default)]
    pub sample_input: Option<serde_json::Value>,

    /// Scheduling/polling/webhook/manual hint carried by the capability.
    /// Runtime does not fire this — it mirrors what `AgentIrTrigger` will
    /// contain. Kept for template authoring clarity.
    #[serde(default)]
    pub suggested_trigger: Option<serde_json::Value>,
```

All fields are `#[serde(default)]` + `Option<…>` or `Vec<…>` which deserializes empty. Existing IR blobs that omit these fields continue to parse cleanly.

### DesignUseCase parity (sanity check)

`src-tauri/src/db/models/persona.rs:241` (struct `DesignUseCase`) already has `enabled: Option<bool>` (line 265), `capability_summary: Option<String>` (line 269), `tool_hints: Option<Vec<String>>` (line 273). These were landed as part of C1. The v2 additions to `AgentIrUseCaseData` align the IR with `DesignUseCase`, so `build_structured_use_cases` in `build_sessions.rs:399` can pass these fields through to `design_context` verbatim.

### Plan drift (Section 2)

- Plan at 06-building-pipeline.md:92–115 lists the fields to add but does
  not mention `id`, `use_case_flow`, `input_schema`, `sample_input`, or
  `suggested_trigger` on `AgentIrUseCaseData`. Reality: these all exist on
  `DesignUseCase` already, and templates (v1) have them under
  `use_case_flows[]`. Adding them now avoids an awkward "third parse pass"
  later — the IR should be a full mirror of `DesignUseCase`. Flagged for
  the main session to confirm.
- Plan mentions `structured_prompt` staying as `serde_json::Value` for
  opaque consumption — this stays. No change to that field's type.

---

## Section 3 — Migration script design

File to create: `scripts/migrate_templates_v2.mjs` (per plan
09-implementation-plan.md:116). Node script, runs in place, Git diff review.

### High-level pseudocode

```js
#!/usr/bin/env node
// Walks scripts/templates/**/*.json and rewrites each to schema_version: 2.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'scripts/templates';
const SUMMARY = { migrated: 0, skipped: 0, warnings: [] };

for (const file of walk(ROOT, '.json')) {
  const v1 = JSON.parse(readFileSync(file, 'utf8'));
  if (v1.schema_version === 2) { SUMMARY.skipped++; continue; }

  const v2 = migrate(v1, file);
  writeFileSync(file, JSON.stringify(v2, null, 2) + '\n');
  SUMMARY.migrated++;
}

function migrate(v1, path) {
  const { payload: p = {} } = v1;
  const out = {
    id: v1.id,
    schema_version: 2,
    name: v1.name,
    description: v1.description,
    icon: v1.icon,
    color: v1.color,
    category: v1.category,
    is_published: v1.is_published,
    service_flow: v1.service_flow,              // top-level kept for catalog UI
    payload: {
      persona: buildPersona(p, v1),
      use_cases: buildUseCases(p, path),
      adoption_questions: rewriteMapsTo(p.adoption_questions || [], path),
    },
  };
  // Preserved-but-unstructured (catalog UI consumes these):
  if (p.design_highlights) out.payload.design_highlights = p.design_highlights;
  if (p.summary) out.payload.summary = p.summary;
  return out;
}

function buildPersona(p, v1) {
  return {
    description: v1.description,
    icon: v1.icon,
    color: v1.color,
    structured_prompt: {
      // Pre-v2 identity is ALWAYS a string — we do NOT convert it to an
      // object; we keep it as string and add sibling fields.
      identity: p.structured_prompt?.identity ?? '',
      instructions: p.structured_prompt?.instructions ?? '',
      toolGuidance: p.structured_prompt?.toolGuidance ?? '',
      examples: p.structured_prompt?.examples ?? '',
      errorHandling: p.structured_prompt?.errorHandling ?? '',
      customSections: p.structured_prompt?.customSections ?? {},
      // v2 hand-review fields — seeded empty, populated by humans.
      voice: '',                // TODO: hand-write from identity phrases
      principles: [],           // TODO
      constraints: [],          // TODO
      decision_principles: [],  // TODO
      verbosity_default: 'normal',
    },
    tools: p.suggested_tools ?? [],
    required_connectors: p.suggested_connectors ?? [],
    notification_channels_default: p.suggested_notification_channels ?? [],
    service_flow: p.service_flow ?? [],
    parameters: p.suggested_parameters || p.parameters || undefined,
    protocol_capabilities: p.protocol_capabilities,     // preserved
    full_prompt_markdown: p.full_prompt_markdown,       // preserved for catalog preview
  };
}

function buildUseCases(p, path) {
  const flows = p.use_case_flows ?? [];
  const triggers = p.suggested_triggers ?? [];
  const subs = p.suggested_event_subscriptions ?? [];
  const channels = p.suggested_notification_channels ?? [];

  // When there are no flows, synthesise a single default capability.
  if (flows.length === 0) {
    return [synthesiseFallbackCapability(p)];
  }

  return flows.map((flow, idx) => {
    const ucId = deriveUseCaseId(flow);
    const trigger = pickTriggerForFlow(flow, triggers, idx);
    return {
      id: ucId,
      title: flow.name || `Use case ${idx + 1}`,
      description: flow.description || '',
      capability_summary: '',       // TODO: hand-write one-liner
      category: inferCategory(flow),
      enabled_by_default: true,
      suggested_trigger: trigger,
      event_subscriptions: subsForFlow(flow, subs),
      notification_channels: channelsForFlow(flow, channels),
      model_override: null,
      input_schema: [],
      sample_input: null,
      tool_hints: [],               // TODO: hand-select subset from persona.tools
      use_case_flow: { nodes: flow.nodes, edges: flow.edges },
      test_fixtures: [],
    };
  });
}

function deriveUseCaseId(flow) {
  // Prefer flow.id if present, rewrite to uc_<slug> convention.
  if (flow.id) return flow.id.replace(/^flow_/, 'uc_');
  return 'uc_' + (flow.name || 'anon').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function pickTriggerForFlow(flow, triggers, idx) {
  // Positional match first (most templates are authored this way).
  if (triggers[idx]) return triggers[idx];
  // If only one trigger exists and multiple flows, return null; human review.
  return null;
}

function subsForFlow(flow, subs) {
  // Heuristic: find event_types referenced in flow.nodes (by label/detail).
  const matched = [];
  const unmatched = [...subs];
  for (const sub of subs) {
    const hit = flow.nodes?.some(n =>
      (n.label || '').includes(sub.event_type) ||
      (n.detail || '').includes(sub.event_type));
    if (hit) matched.push(sub);
  }
  return matched;
}

function channelsForFlow(flow, channels) {
  // Most templates have a single channel used by all flows. Attach all
  // channels to every flow, then human-trim.
  return channels;
}

function rewriteMapsTo(aqs, path) {
  return aqs.map(q => {
    if (!q.maps_to) return q;
    // v1 targets: parameter.X, config.X, connector.name.X, trigger.schedule.X
    // v2 targets: persona.X, use_cases[uc_id].X
    // Leave unchanged unless we can mechanically rewrite — the script warns
    // for each maps_to it can't migrate.
    return q;
  });
}
```

### Edge cases surfaced by the 107-template sample

#### Edge case 1 — `suggested_triggers.length != use_case_flows.length` (65/100)

**Examples from sample:**

- `documentation-freshness-guardian`: 3 flows, 1 trigger (schedule). The
  other two flows are documentation sub-processes triggered internally.
- `incident-logger`: 2 flows, 3 triggers (manual + event + schedule). The
  flows are high-level; triggers represent entry points.
- `workflow-error-intelligence`: 3 flows, 4 triggers.
- `client-portal-orchestrator`: 3 flows, 6 triggers.

**Resolution:** positional `pickTriggerForFlow` is correct only when counts
match. For mismatches:

- **Fewer triggers than flows** → attach the trigger to the first flow;
  remaining flows get `suggested_trigger: null` (or `type: "manual"`). The
  migration script logs one warning per unmatched flow.
- **More triggers than flows** → attach positionally for the first N; any
  overflow triggers become persona-level (attached to `persona.extra_triggers`
  for human triage) OR duplicated across flows if the script can infer
  (e.g. two schedule triggers with different crons = two distinct
  capabilities). **Recommendation:** flag for human triage, do not guess.

#### Edge case 2 — event subscriptions but no matching flow

**Example:** `customer-feedback-router` has
`suggested_event_subscriptions: ['credential_error', 'manual_review_response',
'high_volume_alert']`. None of these event_types are referenced in any
flow's nodes by name.

**Resolution:** the `subsForFlow` heuristic returns `[]` for all flows →
subscriptions orphaned. Fallback: place orphaned subscriptions on the
**first flow** or on `persona.event_subscriptions_default[]` (persona-wide,
inherited by all capabilities when they don't override). The plan at
06-building-pipeline.md:248 and `__04-data-model.md`__ implies
persona-wide subscriptions remain valid (nullable `use_case_id` means "any
capability"), so this is architecturally supported.

#### Edge case 3 — `structured_prompt.identity` string vs object

**Finding:** all 107 are strings. There is no object case in the current
corpus. Migration keeps identity as a string and adds `voice`, `principles`,
`constraints`, `decision_principles` as siblings. Humans hand-write those.

**What the plan describes** (06-building-pipeline.md:231): identity as an
object with `.role` sub-field. This is the *v2 vision* for new templates
going forward. Migration does not retroactively change 107 strings; it only
provides the sibling slots.

#### Edge case 4 — `suggested_tools[]` per-flow

**Finding:** zero templates have per-flow tools. Tools are always persona-wide
(`p.suggested_tools[]`). The per-flow `tool_hints` concept is new in v2 and
must be filled in by hand-review for each template.

#### Edge case 5 — templates without flows (2/107)

`youtube-content-pipeline` and `autonomous-cro-experiment-runner` have 0
flows. Migration synthesises a single fallback capability from the
template description + its triggers + subs. Both will need special manual
attention.

#### Edge case 6 — templates without triggers (7/107)

The 7 listed in Section 1. Migration synthesises
`{ type: "manual", description: "Run on demand" }` for each flow.

#### Edge case 7 — `suggested_connectors[].related_triggers: [int]`

Connector references triggers by positional index. After migration the
index is meaningless. Script should rewrite `related_triggers: [0]` → drop
or convert to `related_use_case_ids: [flows[0].id]`.

### Script deliverables

The script should also produce:

- `scripts/migrate_templates_v2.report.json` — list of per-template
  warnings: (flow_trigger_mismatch, orphaned_subs, orphaned_channels,
  missing_flows, missing_triggers, unresolved_maps_to).
- A git-diff-friendly output: one file rewrite per template, stable key
  ordering, newline-terminated.

---

## Section 4 — Per-template review checklist

For each of the 107 templates, after the script runs, a human must write:

### Required hand-fills — `payload.persona.structured_prompt.*`

| Field | Guidance | Realistic effort |
|---|---|---|
| `voice` | Tone + style descriptor: 2–3 sentences. Extract from the existing `identity` prose where it mentions "direct", "skeptical", "warm", etc. | 3–5 min |
| `principles` | Array of 4–6 one-liners. The existing `identity` usually has a "Core principles:" bullet list near the end — lift those. | 3–7 min |
| `constraints` | Array of "never do X / always disclose Y" statements. Extract from `errorHandling` + any "Never" phrasing in `identity`. | 3–5 min |
| `decision_principles` | 3–4 rules about how the agent makes calls. Often implicit in `instructions` — make explicit. | 5–10 min |

### Required hand-fills — per capability

| Field | Guidance | Realistic effort |
|---|---|---|
| `capability_summary` | One-line description for prompt injection. Distinct from `description`; this shows up in "## Active Capabilities" and must fit on one line. | 2–3 min × flows |
| `tool_hints` | Subset of `persona.tools[]` that this capability actually uses. Derive from mentions in the flow's nodes/detail text. | 3–5 min × flows |

### Effort estimation per template

- **Simple** (1 capability, minimal prose): **10–15 min**
  - `email-morning-digest`, `ai-weekly-research`, `knowledge-base-health-auditor`
- **Standard** (2–3 capabilities, full prompt): **25–40 min**
  - Majority of templates. Median case.
- **Complex** (3 capabilities + rich identity prose + many tools):
  **45–70 min**
  - `financial-stocks-signaller`, `dev-clone`, `digital-clone`,
    `client-portal-orchestrator`, `revenue-operations-hub`.

**Back-of-envelope total:** 30 min × 107 = **~54 person-hours** for hand
review. Treat as a separate committable pass (one category directory per
commit) so review is chunkable.

---

## Section 5 — Adoption flow v2 changes

File: `src-tauri/src/commands/design/template_adopt.rs` (1800 lines).

### Primary entry points

| Entry | Location | Purpose |
|---|---|---|
| `instant_adopt_template` | `template_adopt.rs:500` | Fast-path adoption (no LLM pass). Tauri command + inner at line 511. |
| `instant_adopt_template_inner` | `template_adopt.rs:511` | Callable from tests. **This is where the v2 branch lands.** |
| `start_template_adopt_background` | `template_adopt.rs:170` | Background job variant (for templates requiring Claude CLI adoption). Also needs v2 branch. |
| `confirm_template_adopt_draft` | `template_adopt.rs:444` | Final promotion step after CLI-assisted adoption. |

### Where the `schema_version` branch goes

**`instant_adopt_template_inner`** at `template_adopt.rs:511`:

After the JSON parse at line 528, before any field extraction:

```rust
let design: serde_json::Value = serde_json::from_str(&design_result_json)
    .map_err(|e| AppError::Validation(format!("Invalid design result JSON: {e}")))?;

// NEW v2 branch
let schema_version = design.get("schema_version").and_then(|v| v.as_u64()).unwrap_or(1);
if schema_version == 2 {
    return adopt_v2_inner(state, template_name, design);
}
if schema_version != 1 {
    return Err(AppError::Validation(format!(
        "Unsupported template schema_version: {schema_version}"
    )));
}
// ... existing v1 path ...
```

**Note:** the plan (06-building-pipeline.md:396) says "v1 returns an error".
Reality: the schema_version check should be read from the `payload` root of
the v2 template (`v1.schema_version = 2` in top-level JSON), but the
`design_result_json` passed into `instant_adopt_template_inner` is the
**payload**, not the full template envelope. **Plan drift:** the migration
writes `schema_version` at the **top-level** of the template JSON (sibling
of `payload`), but the backend only receives the `design_result_json`
(which is the payload or the full template — depends on caller). **Action
for main session:** verify the frontend (`templateCatalog.ts` loader)
passes the full template JSON or just the payload, then align where the
`schema_version` key lives.

### Helper functions — replace vs reuse

| Function | Role | Reuse? |
|---|---|---|
| `check_template_integrity` (line 27) | Checksum validation | **Reuse** — unchanged |
| `validate_json_field` (line 140) | Size + JSON syntax check | **Reuse** |
| `normalize_n8n_persona_draft` (n8n_transform/types.rs:47) | Defaults for name/icon/color | **Reuse** |
| `create_persona_atomically` (n8n_transform/confirmation.rs:45) | Transactional persona+triggers+tools insert | **Reuse** but see below |
| Building `N8nPersonaOutput` inline at line 619-634 | v1-specific field extraction | **Replace** with `build_v2_draft` |

### Per-capability triggers — current state

**Current behavior (v1 path, `instant_adopt_template_inner:571-580`):**

```rust
let triggers: Option<Vec<N8nTriggerDraft>> = design.get("suggested_triggers")
    .and_then(|v| v.as_array())
    .map(|arr| arr.iter().map(|t| {
        N8nTriggerDraft {
            trigger_type: ...,
            config: ...,
            description: ...,
            use_case_id: None,    // <-- always null on instant adopt path
        }
    }).collect());
```

**Critical finding:** the instant-adopt path has **zero use_case_id logic
today**. It creates triggers with `use_case_id: None` always. The
positional fallback exists only in the build-session promote path
(`build_sessions.rs:968-970`), not in template adoption.

**Also:** `create_persona_atomically` (`confirmation.rs:45`) does **not**
insert event subscriptions at all. Searching `confirmation.rs` for
`persona_event_subscriptions` returns zero hits. This is a **pre-existing
gap** — templates that declare `suggested_event_subscriptions[]` get them
persisted nowhere when instant-adopted. The C2 work should fix this in v2.

**For C2 v2 flow:** `adopt_v2_inner` should:

1. Read `payload.persona` and `payload.use_cases[]`.
2. Construct an `AgentIr` directly (no `N8nPersonaOutput` intermediate).
3. Call `promote_build_draft_inner`-like transactional path that handles
   triggers + subscriptions per capability.

**Recommendation:** refactor the v2 adoption to reuse
`promote_build_draft_inner` helpers (`create_triggers_in_tx`,
`create_event_subscriptions_in_tx`, `update_persona_in_tx`,
`create_version_snapshot_in_tx`) from `build_sessions.rs` rather than
invent a parallel transaction. The build-session path already handles both.
Extract those helpers into a shared module or export them.

### Plan drift (Section 5)

- Plan says "Pass into `promote_build_draft_inner`. All existing transaction
  logic works" (06-building-pipeline.md:415). Reality:
  `promote_build_draft_inner` requires a `build_sessions` row
  (`session.phase.validate_transition(BuildPhase::Promoted)` at
  `build_sessions.rs:1182`). Templates bypass build sessions. Options:
    - (a) Create a synthetic build session row for adoption (clean but extra
      writes).
    - (b) Extract the post-transaction steps into a helper that accepts
      `ir + persona_id + adoption_answers` directly (cleaner, matches the
      actual work). **Recommended.**

---

## Section 6 — CLI prompt changes

File: `src-tauri/src/engine/build_session.rs` (2094 lines).

### Where dimension prompt strings live

One large embedded prompt string, **lines 1485–1609** inside the
`build_session_prompt` function (defined at line 1381).

- Line 1485: `let result = format!(r###"You are a senior AI agent architect...`
- Line 1609: `"###);`

All 8 dimensions are described inline in one `format!` macro. Other
sections in the same file:

- Lines 1753–1775: template reference context builder.
- Lines 1583–1592: Protocol Message Integration section.

### What currently instructs the LLM about use-cases

Lines 1505–1512 define the `use-cases` dimension:

```
### 1. use-cases — WHAT it does (ALWAYS ask clarifying questions first)
Business logic only. No scheduling (that's triggers).
**CRITICAL:** The user's initial description is ALWAYS too vague ...
data format: {"items": ["..."], "use_cases": [{"title": "...", "description": "...", "category": "...", "execution_mode": "e2e"}]}
```

The dimension list at line 345:

```rust
let all_dims = ["use-cases", "connectors", "triggers", "messages",
                "human-review", "memory", "error-handling", "events"];
```

And the example agent_ir shape at line 1579:

```
{"agent_ir": {"name": "...", ..., "triggers": [...], ..., "use_cases": [...], ..., "events": []}}
```

**Critical:** nothing in the current prompt instructs the LLM to link
triggers to use-cases by id. Triggers and use-cases are independent top-level
arrays and are assumed positionally.

### What must change

1. **Dimension reframing.** Lines 1503–1551 should collapse the current
   flat 8-dimension list into:
   - Dimension 1: **Persona Identity** (behavior core; includes
     structured_prompt.voice/principles/constraints/decision_principles)
   - Dimension 2: **Capabilities** (primary — each with sub-fields:
     trigger, events, notification_channels, model_override, tool_hints,
     input_schema, sample_input)
   - Dimension 3: **Shared Tools & Connectors** (persona-wide pool)
   - Dimension 4: **Governance** (budget, turns, trust)
   - Dimension 5: **Error Handling** (persona-wide)
   - Dimension 6: **Memory** (persona-wide default + per-capability
     tagging)

   The Matrix UI reframe is per plan 08-frontend-impact.md and is **out of
   scope for C2** — prompt-level changes only.

2. **New `use_case_id` instruction.** After the agent_ir example at
   line 1579, add:

   > Each capability in `use_cases[]` MUST have a stable `id` like
   > `uc_<short_slug>`. Each trigger in `triggers[]` MUST carry
   > `use_case_id` referencing the capability that fires it. Each event
   > subscription MUST carry `use_case_id` on the capability it belongs
   > to (inside `use_cases[i].event_subscriptions[]`).

3. **v2 `structured_prompt` contract.** The example shape on line 1579
   shows `"structured_prompt": {"identity": "...", "instructions": "...",
   "toolGuidance": "...", "examples": "...", "errorHandling": "..."}`.
   Extend to:

   ```
   "structured_prompt": {
     "identity": { "role": "...", "tone": "..." },
     "voice": "...",
     "principles": ["..."],
     "constraints": ["..."],
     "decision_principles": ["..."],
     "instructions": "...",
     "toolGuidance": "...",
     "examples": "...",
     "errorHandling": "...",
     "verbosity_default": "normal"
   }
   ```

4. **Capability shape.** The data format on line 1512 becomes:

   ```
   "use_cases": [{
     "id": "uc_gem",
     "title": "Weekly Gem Finder",
     "description": "...",
     "capability_summary": "...",
     "category": "...",
     "execution_mode": "e2e",
     "suggested_trigger": {"type": "schedule", "config": {"cron": "..."}},
     "event_subscriptions": [{"event_type": "..."}],
     "notification_channels": [{"type": "slack", "config_hint": "..."}],
     "tool_hints": ["..."],
     "input_schema": [...],
     "sample_input": {...},
     "enabled_by_default": true
   }]
   ```

5. **Rule 11 / Rule 12 additions.** At lines 1604–1605 there are already
   Rules 10 and 11 (adversarial questioning, TDD guidance). Add:

   > **Rule 12 — Capability attribution:** Every trigger in `triggers[]`
   > must reference a `use_case_id` from `use_cases[].id`. Never emit an
   > orphan trigger.
   > **Rule 13 — Identity split:** The v2 `structured_prompt` separates
   > stable identity (voice, principles, constraints, decision_principles)
   > from runtime behavior (instructions, toolGuidance, examples,
   > errorHandling). Fill all sections.

### Plan drift (Section 6)

- Plan references `dimension_framework.md` or similar adjacent file
  (06-building-pipeline.md:134). **Reality: no such file exists.** The
  dimension framework is entirely inline in `build_session.rs:1485-1609`.
  The main session should edit the inline string, not look for an external
  file.
- Plan expects `cli_prompt.rs` to also exist. **Reality: no `cli_prompt.rs`
  anywhere in the repo.** The `build_session.rs` file is the single source
  of the CLI prompt.

---

## Section 7 — Concrete task breakdown

Each item below is a single committable step. Numbering matches the
suggested execution order. Every commit ends with `cargo check` + `npx tsc
--noEmit` green (and `cargo test -p personas` where tests change).

### Step 1 — AgentIr v2 fields

**Files:** `src-tauri/src/db/models/agent_ir.rs`

- Add `use_case_id: Option<String>` to `AgentIrTrigger` (after line 99).
- Add `id`, `notification_channels`, `model_override`, `test_fixtures`,
  `tool_hints`, `capability_summary`, `enabled`, `use_case_flow`,
  `input_schema`, `sample_input`, `suggested_trigger` to
  `AgentIrUseCaseData` (after line 270).
- Unit test: deserialize a v2 IR fixture, serialize back, round-trip
  invariant.

**Commit message:** `feat(agent-ir): add v2 fields for capability attribution`

### Step 2 — Semantic trigger linkage in promote

**Files:** `src-tauri/src/commands/design/build_sessions.rs`

- Update `create_triggers_in_tx` (line 953): prefer `trigger.use_case_id`
  from IR, fall back to positional `use_case_ids.get(idx)`. Log a warn on
  positional fallback.
- Update `build_structured_use_cases` (line 399): when
  `AgentIrUseCaseData.id` is present, use it as the stable id instead of
  generating `uc-<uuid>`.
- Add a unit test: v2 IR with explicit `use_case_id` on triggers — verify
  `persona_triggers.use_case_id` matches exactly.

**Commit message:** `feat(build): honor semantic use_case_id on triggers in promote`

### Step 3 — Instant adopt schema_version branch

**Files:** `src-tauri/src/commands/design/template_adopt.rs`,
`src-tauri/src/commands/design/n8n_transform/types.rs`

- Add `schema_version` detection in `instant_adopt_template_inner`
  (line 511 area).
- New `adopt_v2_inner` function: reads `payload.persona` and
  `payload.use_cases[]`, constructs `AgentIr` directly.
- Reuse helpers from `build_sessions.rs` — extract
  `create_triggers_in_tx`, `create_event_subscriptions_in_tx`, and
  `update_persona_in_tx` into a shared `src-tauri/src/commands/design/
  promote_shared.rs` module callable from both.

**Commit message:** `feat(adopt): v2 schema branch using shared promote helpers`

### Step 4 — Migration script

**Files:** `scripts/migrate_templates_v2.mjs` (new)

- Implement per Section 3 above.
- Produces `scripts/migrate_templates_v2.report.json` with warnings.
- Dry-run mode (`--dry`) prints diff without writing.

**Commit message:** `chore(scripts): add v2 template migration script`

### Step 5 — Migrate all 107 templates (bulk)

**Files:** `scripts/templates/**/*.json` (107 files)

- Run script.
- Commit the bulk diff as a single commit.
- Attach the report JSON to the commit body or a sibling doc.

**Commit message:** `chore(templates): migrate 107 templates to schema_version 2 (mechanical)`

### Step 6 — Template integrity regeneration

**Files:** `src-tauri/src/engine/template_checksums.rs` (and the script that
generates it — grep for `template_manifest` or the build-time embedding).

- Migrated templates will fail their checksum check (called at
  `template_adopt.rs:29`). Regenerate the manifest.

**Commit message:** `chore(templates): regenerate checksum manifest for v2`

### Step 7 — Per-template hand review — persona.structured_prompt

**Files:** `scripts/templates/**/*.json` (committed in category batches).

- One commit per category directory (14 commits).
- Fill `voice`, `principles`, `constraints`, `decision_principles` for
  each template.
- Regenerate checksum manifest after each batch.

**Commit message pattern:** `feat(templates:<category>): hand-fill v2 identity fields`

### Step 8 — Per-template hand review — capability fields

**Files:** same templates.

- One commit per category.
- Fill `capability_summary` and `tool_hints` per capability.

**Commit message pattern:** `feat(templates:<category>): hand-fill capability_summary and tool_hints`

### Step 9 — CLI build prompt v2

**Files:** `src-tauri/src/engine/build_session.rs`

- Edit the inline prompt at lines 1485–1609.
- Reframe dimensions (Persona Identity, Capabilities, Shared Tools,
  Governance, Error Handling, Memory).
- Add Rule 12 (capability attribution) and Rule 13 (identity split).
- Update example agent_ir shape (line 1579) to v2.
- Update dimension list (line 345) to reflect new grouping.

**Commit message:** `feat(build-session): v2 dimension framework and capability attribution`

### Step 10 — Integration tests

**Files:** `src-tauri/tests/phase_c2_templates.rs` (new)

- Adopt `stock-analyst` v2 → assert design_context.useCases has `enabled:
  true` on each, `capability_summary` populated, triggers have correct
  `use_case_id`.
- Adopt `customer-feedback-router` v2 → assert 3 triggers each tagged to
  the right capability, subscriptions attributed.
- Adopt `autonomous-issue-resolver` v2 → same checks.
- Build from CLI intent "stock analyst" → assert the IR emitted by the
  LLM shim has `use_case_id` on every trigger.

**Commit message:** `test(c2): integration tests for v2 template adoption and CLI build`

### Step 11 — Documentation updates

**Files:** `docs/concepts/persona-capabilities/README.md`,
`09-implementation-plan.md`

- Flip C2 status to "Shipped YYYY-MM-DD commit <sha>" per plan's handoff
  markers (09-implementation-plan.md:295).

**Commit message:** `docs(capabilities): mark C2 complete`

---

## Appendix A — Quick-access file references

| File | Purpose | Key lines |
|---|---|---|
| `src-tauri/src/db/models/agent_ir.rs` | AgentIr struct | 93 (Trigger), 258 (UseCaseData) |
| `src-tauri/src/db/models/persona.rs` | DesignUseCase struct | 241, 303 (design_context) |
| `src-tauri/src/commands/design/build_sessions.rs` | Promote transaction | 399 (build_structured_use_cases), 953 (create_triggers), 997 (create_event_subscriptions), 1173 (promote_inner) |
| `src-tauri/src/commands/design/template_adopt.rs` | Template adoption IPC | 170 (start_adopt), 444 (confirm), 500 (instant_adopt), 511 (instant_adopt_inner) |
| `src-tauri/src/commands/design/n8n_transform/confirmation.rs` | Atomic create | 45 (create_persona_atomically) |
| `src-tauri/src/commands/design/n8n_transform/types.rs` | N8nTriggerDraft | 22 (already has use_case_id) |
| `src-tauri/src/engine/build_session.rs` | CLI prompt & dimension framework | 345 (all_dims), 1381 (build_session_prompt), 1485-1609 (inline prompt) |
| `src-tauri/src/engine/adoption_answers.rs` | Variable substitution | 56 (substitute_variables) |
| `scripts/templates/**/*.json` | 107 templates | 14 category subdirs |

## Appendix B — Summary of Plan Drift

| Section | Claim in plan | Reality | Action |
|---|---|---|---|
| §1 | "10/10 mechanically convertible" | 65% have trigger/flow count mismatch | Migration script must emit warnings, not errors |
| §2 | identity may be object | 107/107 are strings | Keep as string, add siblings |
| §3 | Reuse `promote_build_draft_inner` | Requires build_sessions row | Extract shared helpers |
| §5 | `dimension_framework.md` or `cli_prompt.rs` | Neither exists | Edit inline prompt in build_session.rs |
| §5 | `create_persona_atomically` handles triggers | It does; but **not** event subscriptions | v2 must add subscription inserts |
| §5 | Instant adopt path has positional fallback | It doesn't; uses `use_case_id: None` unconditionally | v2 must introduce use_case_id propagation |
