# Persona data model

Everything a persona is, on disk. The `personas` table is the primary
row; a dozen join tables hang off `persona_id`. A persona also carries a
**manifest** (`manifest.md` on disk, mirrored into `core_profile`), a set of
**charters** (`persona_responsibilities`) that are what it can do, a **brain**
(episode log + consolidated memories with provenance and tombstones), and a
**per-persona disk root** under `~/.personas/personas/<id>/`.

## The `Persona` struct

`src-tauri/core/src/models/persona.rs` (line ~700; the models live in
the extracted `personas-core` crate). TS binding at
`src/lib/bindings/Persona.ts` (camelCase via `#[serde(rename_all =
"camelCase")]` in the JSON interchange path).

| Field | Type | Purpose |
|---|---|---|
| `id` | `String` | Primary key (UUID). |
| `project_id` | `String` | Logical isolation between projects (default: `"default"`). |
| `name` | `String` | Display name in the sidebar and gallery. |
| `description` | `Option<String>` | Markdown description shown in the persona editor. |
| `system_prompt` | `String` (NOT NULL) | The core Claude system prompt. Assembled at execution time with memory, tool guidance, and input context. |
| `structured_prompt` | `Option<String>` | JSON object with named subsections (see below). Formatted into the system prompt **only for a persona with no manifest**: once `core_profile` holds manifest markdown, the manifest and the charter roster are the persona's word and none of these subsections render. |
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
| `design_context` | `Option<String>` | JSON envelope (`DesignContextData`) with design files, credential links, twin pin, connector pipeline. Its `use_cases` array is legacy: still parsed, never written. |
| `home_team_id` | `Option<String>` | FK to `persona_teams` — the persona's workspace anchor (the one team whose shared instructions + defaults + injected memory apply at runtime). Replaced the retired `group_id`/PersonaGroup in the Groups→Teams consolidation. |
| `source_review_id` | `Option<String>` | FK back to the `persona_design_reviews` row that created this persona via adoption. |
| `trust_level` | `PersonaTrustLevel` | `manual` \| `verified` \| `revoked` — gates tool-call auto-approval. |
| `trust_origin` | `PersonaTrustOrigin` | `builtin` \| `user` \| `system` — where trust was assigned. |
| `trust_verified_at` | `Option<String>` | ISO8601 timestamp of last trust verification. |
| `trust_score` | `f64` | 0.0–1.0 derived metric from execution history. |
| `parameters` | `Option<String>` | JSON array of `PersonaParameter` — user-tunable values that don't require a rebuild. |
| `gateway_exposure` | `PersonaGatewayExposure` | `local_only` \| `invite_only` \| `public` — external HTTP API visibility. |
| `starred` | `bool` | Durable star: marks the persona as in the Director's coaching scope (promoted from a localStorage favorite). |
| `setup_status` | `String` | Adoption/build execute-gate: `ready` (default) or `needs_credentials`. A `needs_credentials` persona shows a "Setup required" badge and is skipped by auto-execution until its connector bindings resolve. Set by `instant_adopt_template_inner` / `promote_build_draft_inner`. |
| `setup_detail` | `Option<String>` | JSON `PersonaSetup` (adoption-honesty redesign) — typed connector blockers, wired trigger types, and a human-readable readiness preview. `setup_status` is the coarse gate; this carries the detail the UI routes on. |
| `last_test_report` | `Option<String>` | JSON report from the most recent `test_build_draft` / `run_tool_tests` run (per-tool / per-connector results). `None` if never tested. Read by the editor's TestReportModal. |
| `template_category` | `Option<String>` | Lowercase category (`"development"`, `"finance"`, …) inferred at template adoption. Drives Simple-mode illustration + the export-safe icon fallback. |
| `cli_awareness_enabled` | `bool` | Per-persona gate (default `false`) for the Athena CLI session-resume awareness block. |
| `disabled_dims_json` | `Option<String>` | JSON `{ [use_case_id]: GlyphDimension[] }` of per-capability dims disabled in the View-mode SigilEditModal. Durable across rebuilds + runs; the runtime executor skips actions bound to disabled dims. `NULL` = none. |
| `lifecycle` | `String` | Lifecycle state string (default `'active'`; column added by the fleet/workspaces migration). |
| `core_profile` | `Option<String>` | The **manifest mirror**: `manifest.md` verbatim, as markdown (see [The manifest](#the-manifest-and-its-mirror-core_profile) below). A persona whose manifest has never been touched may still hold the legacy `PersonaCore` JSON here; the seeder folds that JSON's prose into the manifest on first access and overwrites the column. `None` before either. |
| `created_at` / `updated_at` | `String` | ISO8601 timestamps. |

The mutation counterpart `UpdatePersonaInput` carries `core_profile:
Option<Option<String>>` (double-option, so the mirror is clearable). The
manifest module is the only thing that should write it, and it does so with
`source: "manifest"` so the change log records where the edit came from.

## The manifest and its mirror (`core_profile`)

A persona's core document is **`manifest.md`**, a markdown file on disk at
`~/.personas/personas/<persona_id>/manifest.md`. The full text is mirrored
into `personas.core_profile` after every successful write, so the runtime
and every read-only surface can reach it without touching disk. Writer:
`src-tauri/src/engine/persona_brain/manifest.rs`.

**Two authors, told apart by the `# ` heading.**

| Kind | Headings | Who writes it | Through what door |
|---|---|---|---|
| LAW | `# Mandate`, `# Boundaries`, `# Operation defaults` | the operator, only | `update_law` (`update_persona_manifest_law`) |
| SELF-MODEL | `# My work`, `# My self-reads` | the agent, only | anchored diffs in a `self_model_diff` proposal, applied by a human (`propose_diffs` → `apply_approved`) |

The split is enforced in both directions. `update_law` refuses any heading
that is not one of the three law sections, refuses content that would
introduce a `# ` heading of its own (that would mint a section), and caps a
section at `MAX_CORE_PROFILE_BYTES` (16 KB). The diff path refuses a diff whose
section path lands under a law heading **at the propose door and again at the
apply door**, so a proposal minted around the first door still cannot land.
Constants: `LAW_SECTIONS` / `SELF_SECTIONS` in `manifest.rs`.

**Seeding, and what happens to a legacy Core.** `manifest::ensure` is
idempotent and runs on first access:

- The **law seed** is rendered from the persona row: `# Mandate` gets the
  persona's name and description plus a line per active
  `domain='software_engineering'` charter title; `# Boundaries` and
  `# Operation defaults` get the persona's constraints and configured
  notification-channel types, or an explicit "nothing recorded yet" line.
- If `core_profile` still holds the legacy **`PersonaCore` JSON**, its prose
  is folded into that seed (identity / motivation / stance / north-star /
  voice / principles / decision principles into `# Mandate`, constraints into
  `# Boundaries`) and the original JSON is kept beside the manifest as
  `core.legacy.json` before the mirror overwrites the column. Nothing is lost.
- If the persona already has a pre-rebase **`identity.md`**, its body becomes
  the self-model half under the freshly seeded law sections and the old file
  is renamed `identity.migrated.md`. Otherwise the self-model is seeded
  generically ("What I own", "How I work best", "What I've learned about my
  craft"; "What I've gotten wrong", "Open questions"). A persona models its
  work and its self-reads, never a human.

**The mirror is a persona update.** `write_and_mirror` writes disk first, then
calls the persona repo's `update()` with `source: "manifest"`, so a manifest
change lands in the persona change log and auto-versions into
`persona_prompt_versions.core_profile` (added by `e16_living_agent`) exactly
like any other prompt-shaping edit. `create_prompt_version_if_changed`
(`src-tauri/db/src/repos/execution/metrics.rs`) diffs both the structured
prompt and `core_profile` and versions when either changed, so a manifest edit
with an untouched prompt still lands in history and an unchanged manifest
never produces version churn.

**Seed-if-absent still guards the adoption/promote stamp.** Template adoption
(`src-tauri/src/commands/design/template_adopt.rs`) and build-session promote
(`src-tauri/src/commands/design/build_sessions.rs`) stamp
`payload.persona.core` into `core_profile` under a guard that is the SQL
itself, not application logic:

```sql
UPDATE personas SET core_profile = ?1, updated_at = ?2
 WHERE id = ?3 AND (core_profile IS NULL OR core_profile = '')
```

so an existing manifest mirror is never overwritten by a re-adopt. That stamp
is a **seed for the manifest seeder to read**, not a runtime value.

**The reader's view.** `get_persona_manifest` returns a `PersonaManifestView`
(`content`, `lawSections`, `selfSections`, `updatedAt`, `pendingProposals`),
seeding on first access. `get_persona_identity` is the same file's read-only
text accessor, kept under its pre-rebase name.

### The legacy `PersonaCore` JSON

`PersonaCore` (`src-tauri/core/src/models/deliberation.rs`; ts-rs binding
`src/lib/bindings/PersonaCore.ts`) is still the shape of a `core_profile`
value that begins with `{`. It survives so historical rows and
`persona_prompt_versions` snapshots keep round-tripping, and **every field on
it defaults deliberately**: a required field would make a prose-only blob fail
to parse, which does not surface as an error but silently drops the whole
`## Manifest` prompt section for that persona.

Its prose fields (`motivation`, `stance`, `north_star_commitment`, and the
additive `identity`, `voice`, `principles`, `constraints`,
`decision_principles`) are what the seeder folds into the manifest and what
the prompt renders for a persona that has not been migrated yet.

**Its four dials reach nothing.** `risk_tolerance`, `speed_vs_quality`,
`deference` and `conflict_style` no longer reach any prompt: the band table
that turned those numbers into prose was deleted, and the creation codex
stopped authoring them (it composes manifest seed **prose** instead). Nothing
consumes them; they are kept on the struct so old JSON still parses.

At execution time the assembler renders the manifest as a `## Manifest` prompt
section, verbatim. See
[02-capabilities.md](02-capabilities.md#the-assembled-prompt).

## The `personas` table

`src-tauri/db/src/migrations/schema.rs` (the schema lives in the
extracted `personas-db` crate):

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
    home_team_id            TEXT REFERENCES persona_teams(id) ON DELETE SET NULL,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
);
CREATE INDEX idx_personas_enabled ON personas(enabled);
CREATE INDEX idx_personas_home_team_id ON personas(home_team_id);
```

Fields added via migrations (see
`src-tauri/db/src/migrations/incremental/`): `headless`,
`source_review_id`, `trust_level`, `trust_origin`, `trust_verified_at`,
`trust_score`, `parameters`, `gateway_exposure`, `starred`,
`last_test_report`, `template_category`, `cli_awareness_enabled`,
`setup_status`, `setup_detail`, `disabled_dims_json`, `lifecycle`
(`c03_fleet_and_workspaces`), and `core_profile`
(`e07_deliberation_and_scoring`, step id `personas.core_profile`).

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

Assembly in the engine prompt module merges these into the system
prompt at execution time (see
[02-capabilities.md](02-capabilities.md#the-assembled-prompt)).
Templates populate them during design (see
[templates/01-template-format.md](../templates/01-template-format.md)).

The adoption answer pipeline injects a `configuration` key too, with
the user's answers as a markdown list — see
[templates/07-adoption-answer-pipeline.md](../templates/07-adoption-answer-pipeline.md).

**None of it renders for a persona that has a manifest.** `structured_prompt`
is a template-side artifact (the design pipeline composes it); once the
persona's `core_profile` holds manifest markdown, the manifest plus the charter
roster are the persona's word and the assembler skips every subsection above.
The tunable parameters the adoption pipeline injected here are re-derived from
the charters' `spec.inputSchema` instead, as `## Capability Parameters`. The
column is still written and still travels with prompt versions, so a rollback
onto a pre-manifest persona keeps working.

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

**`use_cases` is legacy, read-only.** Nothing writes it any more: adoption and
promote mint `persona_responsibilities` charters, and the `e19_agent_manifest`
migration minted one charter per use case for every persona that already had
some. The field stays on the envelope so a persona the migration has not
touched (a dry-run snapshot, a build draft that was never persisted, a row
written by an older binary) still parses. Everything below describes the shape
of those surviving rows and where each part went.

**`DesignUseCase`** — each use case carries optional `suggested_trigger`,
`model_override`, `notification_channels`, `event_subscriptions`,
`input_schema`, `sample_input`/`sample_output` so the UI can render a
ready-to-run template per use case. It also carries `execution_mode` (the
strategy discriminant read at dispatch), recipe provenance
(`source_recipe_id` / `source_recipe_version` / `adopted_at` from recipe
adoption), `tool_hints`, and `generation_settings` (stored as raw JSON so new
per-capability config can be added without a migration). Every one of those
fields has a home on the charter: `connectors` and the summary/description
became first-class columns, and the rest became keys of the typed
[`ResponsibilitySpec`](#persona_responsibilities-charters).

**`engine_mode`** (per use case, optional) — `"mixed"` arms the execution's
personas-mcp sidecar with the `llm_delegate` tool: Claude stays the
orchestrator and offloads simple self-contained subtasks (summarize,
extract, classify, reformat) to a local Ollama model, saving premium-model
capacity. Unset/`"claude"` = full Claude (default). Toggle lives in the
use-case detail panel's Transform column; delegate endpoint/model come from
the `delegate_base_url` / `delegate_model` settings (default
`http://localhost:11434`, `auto` = first installed model). Design:
`docs/plans/mixed-engine-byom.md`.

**Two-format legacy handling**: `parse_design_context()` first tries
the new envelope, falls back to flat `{files, references}` form for
pre-envelope personas. Always use the helper — never parse raw SQL.

## Associated join tables

All join tables use `persona_id TEXT NOT NULL REFERENCES personas(id)
ON DELETE CASCADE` unless noted. Deleting a persona cascades cleanly
(with one deliberate exception: memory tombstones, below).

### `persona_responsibilities` (charters)

The living-agent employment contract, and **the persona's capability surface**:
WHAT a persona owns, how it carries it out, at what authority, on what cadence,
at what cost. Created by the `e16_living_agent` migration and extended by
`e19_agent_manifest`, which folded design-context use cases into it:

```sql
CREATE TABLE persona_responsibilities (
    id                 TEXT PRIMARY KEY NOT NULL,
    persona_id         TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    title              TEXT NOT NULL,
    domain             TEXT NOT NULL DEFAULT 'general',
    outcomes           TEXT NOT NULL DEFAULT '[]',   -- [{id, statement, success_criteria[]}]
    objectives         TEXT NOT NULL DEFAULT '[]',   -- measurable ledger (see below)
    scope_rung         INTEGER NOT NULL DEFAULT 0,   -- 0-2; rung 3+ refused at intake
    refusal_classes    TEXT NOT NULL DEFAULT '[]',   -- JSON array of class ids
    approval_gates     TEXT NOT NULL DEFAULT '[]',
    owner              TEXT NOT NULL DEFAULT '',
    cadence            TEXT NOT NULL DEFAULT '{}',   -- attention_enabled, interval_minutes,
                                                     -- quiet_hours, max_runs_per_day
    budget_monthly_usd REAL,
    tenure             TEXT NOT NULL DEFAULT '{}',   -- hired_at, probation_*, review cadence,
                                                     -- retire_criteria[]
    status             TEXT NOT NULL DEFAULT 'active'
                       CHECK(status IN ('draft','active','suspended','retired')),
    project_id         TEXT,
    source             TEXT NOT NULL DEFAULT 'operator'
                       CHECK(source IN ('operator','kp-hire','migration','agent-proposed')),
    -- added by e19_agent_manifest:
    connectors         TEXT NOT NULL DEFAULT '[]',   -- connector ids this charter's runs may reach
    procedure          TEXT NOT NULL DEFAULT '',     -- how the persona carries the charter out
    spec               TEXT NOT NULL DEFAULT '{}',   -- ResponsibilitySpec (the runtime envelope)
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);
```

Rust model `PersonaResponsibility` +
`ResponsibilityOutcome`/`ResponsibilityObjective`/`ResponsibilityCadence`/`ResponsibilityTenure`/`ResponsibilitySpec`
in `src-tauri/core/src/models/responsibility.rs`; repo at
`src-tauri/db/src/repos/core/responsibilities.rs` (JSON columns parse
leniently — a corrupt charter degrades to defaults with a warning, it
never makes the roster unreadable). The **objectives ledger** entries
carry `key`, `label`, `baseline`, `target`, `unit`, `direction`
(`up`/`down`), `window_days`, `last_measured_at`, `source` — the
measurable side of the charter's outcomes.

**`connectors`** is an allowlist: the connector ids this charter's runs may
reach. `[]` means "whatever the persona holds".

**`spec` (`ResponsibilitySpec`)** is the runtime envelope: the half of a
capability that is not about *what the persona owns* but about *how a run of it
is shaped*. Every field is optional, so a hand-authored charter carries `{}`
and a migrated one carries only what its source had:

| Field (camelCase on the wire) | Carries |
|---|---|
| `inputSchema` / `sampleInput` | the run's parameters, and an example |
| `modelOverride` | a bare model id for this capability |
| `engineMode` | the legacy `execution_mode` discriminant |
| `notificationChannels` | channel type names for this capability's reports |
| `eventSubscriptions` | cross-persona events it reacts to |
| `errorPolicy` | `{incident, lab, escalateAfter}` post-error routing |
| `errorHandling` | free-prose error guidance, kept separate rather than guessed into booleans |
| `reviewPolicy` | the human-gate mode (`auto_triage` skips the review queue) |
| `memoryPolicy` | what a run of it is allowed to remember |
| `generationSettings` | the v3 envelope (`memories`/`reviews`/`events`/`event_aliases`), preferred over the two policies above when present |
| `timeFilter`, `testFixtures` | window and fixture data |
| `sourceRecipeId` / `sourceRecipeVersion` | recipe provenance |
| `toolHints` | tool identifiers the source declared |
| `modelRationale`, `useCaseFlow`, `enabledByDefault` | authored context kept as evidence |
| `suggestedTrigger` | the trigger the source proposed |
| `migratedFromUseCaseId` | the design-context use case this charter was minted from |

`update_persona_responsibility` **replaces** the whole `spec` column rather
than patching it, so every caller must merge onto the charter's current spec
and send the whole thing back.

**Statuses move through one door.** `set_persona_responsibility_status` takes
any of `draft` · `active` · `suspended` · `retired`;
`retire_persona_responsibility` is the narrow special case of it, so the two
agree by construction. The general door exists because `draft` would otherwise
be a one-way trap: an agent-proposed charter is minted as a `draft` and
nothing could ever activate it.

**`source` says who authored the charter.** `operator` (the create command
stamps it; the wire input cannot claim it), `kp-hire`, `migration` (minted by
`e19` from a use case, or by the legacy-mandate boot migration), and
`agent-proposed` (minted on approval of a `responsibility_draft` proposal, with
source and status forced server-side).

**The App-master mandate is a software-domain profile of a charter.**
A project's mandate = its newest `status='active'` charter with
`domain='software_engineering'` and a non-NULL `project_id`
(`src-tauri/engine/src/responsibility.rs`; `to_mandate_record` /
`from_mandate_record` are lossless in both directions). The legacy
`app_settings` storage (`app_master_mandate:` keys in
`src-tauri/engine/src/app_master.rs`) was migrated away: the boot
migration `migrate_legacy_mandates` (`responsibility.rs`, line ~582,
driven by `src-tauri/src/boot/migrations.rs`) moves each legacy row
into `persona_responsibilities` with `source='migration'` and deletes
the setting, before any mandate reader starts.

Governance semantics (scope rungs, refusal classes, budgets, tenure)
are covered in
[03-trust-and-governance.md](03-trust-and-governance.md#charters-scope-rungs-refusal-classes-tenure).

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
    -- added by migrations, not in the base DDL:
    use_case_id       TEXT,              -- e01; legacy, superseded by responsibility_id
    responsibility_id TEXT,              -- e19; the charter this trigger fires (nullable, no FK)
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX idx_pt_responsibility ON persona_triggers(responsibility_id);
```

**`responsibility_id`** names the charter a trigger fires. It is deliberately
FK-less, the same orphan-tolerance posture `use_case_id` had, and `use_case_id`
is left exactly as it was rather than dropped. Adoption and promote stamp the
charter id on the trigger rows they create; the `e19_agent_manifest` migration
remapped existing rows by joining each trigger's `use_case_id` against the
`spec.migratedFromUseCaseId` of the charters minted for the same persona.

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
webhook). Stored in the incremental migrations:

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
`working` | `archive`), `access_count`, `last_accessed_at`, plus optional
`use_case_id` (capability scope) and `home_team_id` (team scope). Injection at
runtime uses `get_for_injection_v2` (core/active/working); lifecycle transitions
(promote/archive) run on every execution — see
[execution/02-lifecycle.md](../execution/02-lifecycle.md#memory-injection).

**`fact_key`** (added by `e16_living_agent`, step id
`persona_memories.fact_key`) is the stable identity of a consolidated
fact. `create_consolidated` (`src-tauri/db/src/repos/core/memories.rs`,
line ~576) checks the tombstone first, then updates the existing live
row in place when a non-archive row already carries the key — so a fact
evolves under one identity instead of accumulating near-duplicates.
Rows written by consolidation always land at tier `'working'` with
episode provenance (below); see
[03-trust-and-governance.md](03-trust-and-governance.md#the-write-lane-law)
for the full write contract.

### The brain tables (living-agent memory)

All created by the `e16_living_agent` migration
(`src-tauri/db/src/migrations/incremental/e16_living_agent.rs`).

#### `persona_episodes`

The raw experience log — one row per recorded episode, doubled by a
markdown file on disk:

```sql
CREATE TABLE persona_episodes (
    id                TEXT PRIMARY KEY NOT NULL,
    persona_id        TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    execution_id      TEXT,
    responsibility_id TEXT,
    role              TEXT NOT NULL,      -- run | channel | operator | system
    source            TEXT NOT NULL DEFAULT '',
    body_excerpt      TEXT NOT NULL,      -- capped excerpt for consolidation
    file_path         TEXT,               -- disk markdown, or NULL
    content_hash      TEXT NOT NULL,      -- sha256 of the full markdown
    chars             INTEGER NOT NULL,   -- original body char count
    created_at        TEXT NOT NULL
);
```

The full markdown (YAML front-matter + complete body) lives at
`~/.personas/personas/<id>/episodes/YYYY/MM/DD/pep_<short>_<role>.md`;
the index row keeps a capped `body_excerpt` and the `content_hash`
tying the two together. The disk write is deliberately **best-effort**
(unlike the companion brain): on failure it warns and inserts the row
with `file_path = NULL`, so consolidation keeps working off the
excerpt. Writer: `src-tauri/src/engine/persona_brain/episodes.rs`.

#### `persona_memory_sources` (provenance)

```sql
CREATE TABLE persona_memory_sources (
    memory_id  TEXT NOT NULL REFERENCES persona_memories(id) ON DELETE CASCADE,
    episode_id TEXT NOT NULL,
    PRIMARY KEY(memory_id, episode_id)
);
```

Every consolidated memory records WHICH episodes it was derived from
(`create_consolidated` inserts here on every write, and unions
provenance on in-place fact updates). A consolidated memory without
provenance cannot exist.

#### `persona_memory_tombstone`

```sql
CREATE TABLE persona_memory_tombstone (
    persona_id TEXT NOT NULL,
    fact_key   TEXT NOT NULL,
    reason     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY(persona_id, fact_key)
);
```

A forgotten fact stays forgotten: consolidation checks
`is_forgotten(persona_id, fact_key)` before writing, so a tombstoned
fact can never be silently re-derived from old episodes.
**Deliberately FK-less** — a tombstone is the durable record that a
fact must NOT come back, so no entity's deletion may cascade away the
record of its own forgetting (the migration's own test asserts
tombstones outlive their persona). `tombstone_fact` is idempotent and
keeps the first reason.

#### `persona_attention_ledger`

```sql
CREATE TABLE persona_attention_ledger (
    id                TEXT PRIMARY KEY NOT NULL,
    persona_id        TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    responsibility_id TEXT,
    kind              TEXT NOT NULL CHECK(kind IN ('attention','consolidation')),
    lane              TEXT,
    verdict           TEXT NOT NULL,      -- 'started' → acted | noop | refused | failed
    reason            TEXT NOT NULL DEFAULT '',
    consumed_through  TEXT,               -- episode watermark
    stats_json        TEXT,
    cost_usd          REAL,
    started_at        TEXT NOT NULL,
    completed_at      TEXT
);
```

Every attention-loop pass and consolidation run is ledgered — including
the ones that refused to run and why. Repo:
`src-tauri/db/src/repos/core/attention_ledger.rs`; surfaced by the
`list_attention_ledger` command. See
[02-capabilities.md](02-capabilities.md#the-attention-loop) for the
loop itself.

#### `persona_memory_review_proposal.kind`

The review-proposal table (from the earlier memory-review feature) gained a
`kind` column in `e16_living_agent`, and `e19_agent_manifest` widened its CHECK
to a third value. The effective constraint:

```sql
kind TEXT NOT NULL DEFAULT 'memory_curation'
  CHECK(kind IN ('memory_curation','self_model_diff','responsibility_draft'))
```

**One table, one human gate, three proposal families.** Every kind is filed by
the agent and applied only by a person, through the same
`apply_persona_memory_review_proposal` / `discard_persona_memory_review_proposal`
doors, which fan out to the owning module by `kind`:

- `memory_curation` — the classic proposal: an array of memory edits.
- `self_model_diff` carries anchored diffs against the persona's **manifest**
  self-model sections, proposed by consolidation and by operator chat, applied
  by `manifest::apply_approved`
  (`src-tauri/src/engine/persona_brain/manifest.rs`). A diff aimed at a law
  section is refused at both the propose and the apply door.
- `responsibility_draft` is a charter the agent proposes for itself, filed by
  the attention loop's improve lane and applied by
  `growth::apply_responsibility_draft`
  (`src-tauri/src/engine/persona_brain/growth.rs`), which mints the charter with
  `source = 'agent-proposed'` and `status = 'draft'` **forced server-side** and
  the owning persona taken from the proposal row, never from the payload.

Every apply door checks the kind first, verifies the proposal is still
`pending_review`, and compare-and-swaps the row to `applied` **before** writing
anything, so a concurrent double-apply loses and errors with nothing written.
See [03-trust-and-governance.md](03-trust-and-governance.md#the-write-lane-law).

Both inboxes are visible in the editor: `memory_curation` and `self_model_diff`
render in Design → Brain's proposal inbox, and `responsibility_draft` in
Design → Responsibilities' draft inbox, next to the charters it would join.

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
-- + core_profile TEXT (e16_living_agent): the manifest mirror travels with
--   every version, so a rollback restores the persona's word and its prompt
--   together.
```

Written by `promote_build_draft_inner` on every promotion, and by
`create_prompt_version_if_changed` whenever the structured prompt OR
`core_profile` changes (see
[The manifest](#the-manifest-and-its-mirror-core_profile)). Because the
manifest writer goes through the persona repo's `update()`, a law edit or an
applied self-model diff versions itself. The Lab uses this history to A/B test
prompt variants.

## The per-persona disk root

`~/.personas/personas/<persona_id>/` (resolver: `persona_root` in
`src-tauri/src/engine/persona_brain/mod.rs`; honors the
`PERSONAS_HOME` override for tests):

| Path | Contents |
|---|---|
| `manifest.md` | The persona's **core document**: operator-authored law sections (`# Mandate`, `# Boundaries`, `# Operation defaults`) and agent-authored self-model sections (`# My work`, `# My self-reads`), under a YAML front-matter carrying `type: manifest` and an `updated:` stamp. Seeded on first access; mirrored into `personas.core_profile` after every write. |
| `manifest.bak-<ts>-<uuid>.md` | Automatic backup taken before each law edit and each applied self-model diff. |
| `identity.migrated.md` | A pre-rebase `identity.md` after its body was carried into `manifest.md`. Kept rather than deleted: it was the only copy of a self-model the agent grew. |
| `core.legacy.json` | The legacy `PersonaCore` JSON found in `core_profile` at seed time, kept before the mirror overwrote the column. |
| `episodes/YYYY/MM/DD/pep_<short>_<role>.md` | Full episode markdown (front-matter + body); the DB keeps the index + excerpt. |

The manifest's **law** sections have exactly one writer, the operator door. Its
**self-model** sections are never edited directly by any loop: changes arrive
only as anchored diffs through approved `self_model_diff` proposals, and there
is deliberately no full-content replacement op, so every change is reviewable
per claim (see
[03-trust-and-governance.md](03-trust-and-governance.md#the-write-lane-law)).

## The `build_sessions` table (build lifecycle)

Not a `persona_id` join table — this is the durable checkpoint store for a
**live build session** (the Describe path), written *before* a persona row
exists. `start_build_session` inserts a row at phase `initializing`; the backend
build task updates it on every event so the build survives navigation and app
restart (`getActiveBuildSession` / `get_build_status` rehydrate it).

Columns (`build_session.rs`): `phase` (the persisted `BuildPhase`:
`initializing → analyzing → awaiting_input → resolving → draft_ready →
testing → test_complete → promoted`, plus `completed`/`failed`/`cancelled`),
`resolved_cells` (per-cell JSON accumulator), `pending_question`, `agent_ir`
(the final IR promote reads), `adoption_answers`, `intent`, `error_message`,
`cli_pid`, `mode` (`interactive` | `one_shot`), `companion_session_id`,
`disabled_dims_json`, `workflow_json`, `parser_result_json`. On promote,
`promote_build_draft_inner` reads `agent_ir` and fans it out into
`persona_responsibilities` / `persona_tool_definitions` / `persona_tools` /
`persona_triggers` / `persona_event_subscriptions` / `persona_prompt_versions`
and the persona row itself, including the seed-if-absent `core_profile` stamp
the manifest seeder later reads (see
[README](README.md#the-build-session--how-a-describe-build-runs)).

**Capabilities land as charters, not as `design_context.useCases`.** Promote
and template adoption both mint one `persona_responsibilities` row per capability
in the IR, then stamp each minted charter's id onto the trigger rows created for
it (`persona_triggers.responsibility_id`). The mint runs before the persona is
visible: if it fails, the partially-created persona is deleted rather than left
with no capabilities.

## Enums summary

```rust
PersonaTrustLevel:    Manual | Verified (default) | Revoked
PersonaTrustOrigin:   Builtin (default) | User | System
PersonaGatewayExposure: LocalOnly (default) | InviteOnly | Public
ParamType:            Number | String | Boolean | Select
DesignFileKind:       ApiSpec | Schema | McpConfig | Other
HealthStatus:         Healthy | Degraded | Failing | Dormant
ResponsibilityStatus: Draft | Active (default) | Suspended | Retired
EpisodeRole:          Run | Channel | Operator | System
```

All `#[serde(rename_all = "snake_case")]` except `DesignFileKind` which
uses `kebab-case`.

## Files

| File | Role |
|---|---|
| `src-tauri/core/src/models/persona.rs` | `Persona` struct + enums + `DesignContextData` envelope |
| `src-tauri/core/src/models/deliberation.rs` | `PersonaCore`, the legacy `core_profile` JSON shape |
| `src-tauri/core/src/models/responsibility.rs` | `PersonaResponsibility` + outcome/objective/cadence/tenure/spec models |
| `src-tauri/core/src/models/brain.rs` | `PersonaEpisode`, `AttentionLedgerEntry`, `PersonaManifestView`, `PersonaBrainDashboard` |
| `src-tauri/core/src/models/tool.rs` | Tool definitions and persona-tool join |
| `src-tauri/core/src/models/trigger.rs` | `PersonaTrigger` + `TriggerConfig` enum |
| `src-tauri/core/src/models/memory.rs` | Memory with tiers and access tracking |
| `src-tauri/core/src/models/review.rs` | Manual review types |
| `src-tauri/core/src/models/automation.rs` | External automation models |
| `src-tauri/db/src/migrations/schema.rs` | Base CREATE TABLE statements |
| `src-tauri/db/src/migrations/incremental/` | Added-column migrations per feature (`e07` the `core_profile` column, `e16` living-agent tables, `e19` charter dimensions + the use-case → charter mint) |
| `src-tauri/db/src/repos/core/personas.rs` | CRUD + queries + Core auto-versioning on update |
| `src-tauri/db/src/repos/core/responsibilities.rs` | Charter CRUD |
| `src-tauri/db/src/repos/core/episodes.rs` | Episode index CRUD |
| `src-tauri/db/src/repos/core/memories.rs` | Memory CRUD + `create_consolidated` + tombstones |
| `src-tauri/db/src/repos/core/attention_ledger.rs` | Attention/consolidation ledger |
| `src-tauri/src/engine/persona_brain/manifest.rs` | `manifest.md`: seed + lazy migration, the law door, self-model diff propose/apply, the `core_profile` mirror |
| `src-tauri/src/engine/persona_brain/growth.rs` | The OP-line grammar and its two propose-only doors (self-model diffs from chat, charter drafts from the improve lane) + `apply_responsibility_draft` |
| `src-tauri/src/engine/persona_brain/dashboard.rs` | The Brain dashboard aggregate |
| `src-tauri/src/engine/persona_brain/` | Episodes on disk, sleep cycle |
| `src-tauri/engine/src/responsibility.rs` | Charter validation, domain class sets, mandate round-trip |
| `src-tauri/src/commands/core/personas.rs` | Tauri IPC for persona CRUD |
| `src-tauri/src/commands/core/responsibilities.rs` | Tauri IPC for charter CRUD, the status ladder, and the attention ledger |
| `src-tauri/src/commands/core/persona_brain.rs` | Tauri IPC for the manifest (`get_persona_manifest`, `update_persona_manifest_law`, `propose_persona_manifest_diffs`), episodes, and `get_persona_brain_dashboard` |
