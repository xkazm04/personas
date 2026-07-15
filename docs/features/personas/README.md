# Personas — Technical Documentation

> How a persona is stored, what fields enable which capabilities, and
> how trust + governance constrain what it's allowed to do. Start here
> when touching anything that reads or writes the `personas` table.

A **persona** is the in-app representation of an AI agent. Once a
template is adopted (see [templates](../templates/README.md)), a row
gets written to the `personas` table with the prompts, tools, triggers,
and other pieces the agent will use at runtime.

A persona is the **design-time entity** — static configuration. At
runtime it spawns an **execution** (see [execution](../execution/README.md)),
which is the dynamic thing you see running in the process drawer.

## Creating personas — Describe + persona core (2026-07)

The create surface (Agents → create, and the zero-personas first run) is
`CreatePersonaEntry` (`src/features/personas/sub_foundry/`). The three-step
**Compose (Foundry)** wizard was **retired 2026-07-07** — its one durable idea,
foundation selection (the mentality archetype), folded into the Describe surface
as a **persona-core configurator**, so creation is one flow:

1. **Describe it (default)** — the intent build (`UnifiedBuildEntry` →
   Dialogue+Cinema). Type what you want; the LLM resolves the spec with
   clarifying questions. Under the intent sits the **persona-core badge**
   (`sub_glyph/personaCore/`): the slot that replaced the redundant "What" leaf
   (the intent already IS the "what"). It opens the persona-core configurator
   (`sub_glyph/personaCore/`, the **Codex** layout — an ordered, icon-forward
   3-column grid: Character · Configuration · Mentality), rethought 2026-07-08
   against the real corpus. Three surfaces (Memory is deliberately NOT here — the
   build surface's memory dimension owns it):
   - **Disposition** — one Cautious↔Bold slider. (Collapsed from Risk+Speed,
     which are near-collinear across the 18 dial-carrying personas.)
   - **Character traits** — a clickable 20-trait palette in 5 axes (Rigor /
     Autonomy / Communication / Reliability / Temperament), distilled from the
     `principles`/`decision_principles`/`voice`/`stance` prose of all 120
     personas and ordered by corpus frequency (`catalog.ts`). This carries
     most of the character — 102/111 base templates have no numeric `core` at
     all. Plus a **conflict style** (challenger/analyst/pragmatist/harmonizer):
     same model + traits, different conflict style = different deliberation.
   - **Model** — tier (Haiku/Sonnet/Opus) **× reasoning effort** (low/medium/
     high/xhigh). Both are first-class, backend-wired (`--effort` on every run;
     `cli_args.rs`). Effort was previously UI-hidden outside Settings→Model
     Routing. There is no separate "Speed" knob — effort is the real compute axis.
   - **Mentality** — the 9 archetypes (`scripts/templates/_archetypes.json`,
     served by `list_archetypes`) as a snapshot column; picking one seeds
     disposition + conflict style **and preloads that archetype's dominant traits**
     (`ARCHETYPE_TRAITS` in `catalog.ts`) so a preset lands as a complete
     character.
   - The chosen core is appended to the launch intent as a directive block (same
     mechanism as the review toggles) — **prototype scope**: it does not yet write
     hard config (`model_profile`, `--effort`). Wiring those is the flagged
     next-leverage follow-up.
2. **Browse templates** — the gallery's fully pre-composed path.

Simple tier renders `UnifiedBuildEntry` directly (no tab strip; templates gated).

`core_profile` (the deliberation dials) is stamped on the adoption path since
2026-07-06 — previously the stamp read `persona_meta.core`, a field no template
on disk ever carried, making it dead code (the dials live at
`payload.persona.core`).

The system has three layers worth documenting separately:

| Doc | Scope | Read when… |
|---|---|---|
| [01-data-model.md](01-data-model.md) | `Persona` struct, `personas` table, associated join tables | Adding a field, migrating schema, debugging a missing column |
| [02-capabilities.md](02-capabilities.md) | What a persona can DO: tools, triggers, event subscriptions, memory, manual reviews, notifications, automations | Adding a new capability surface or debugging "why isn't my tool running" |
| [03-trust-and-governance.md](03-trust-and-governance.md) | Trust level, origin, score, sensitive flag, headless mode, budget, turn limits, gateway exposure | Touching approval flow, cost controls, API exposure, or audit requirements |

## TL;DR architecture

```
personas (table)
  │
  ├── system_prompt           ← core Claude instructions (NOT NULL)
  ├── structured_prompt       ← JSON { identity, instructions, toolGuidance, examples, errorHandling }
  ├── parameters              ← JSON array of runtime-adjustable PersonaParameter
  ├── design_context          ← JSON envelope { designFiles, credentialLinks, useCases, twinId }
  ├── last_design_result      ← JSON snapshot of the last AgentIr that built this persona
  ├── notification_channels   ← JSON array of channel configs (slack, email, webhook, …)
  │
  ├── trust_level             ← manual | verified | revoked
  ├── trust_origin            ← builtin | user | system
  ├── trust_score             ← 0.0–1.0
  ├── sensitive               ← flag for PII/financial workflows
  ├── headless                ← flag for auto-approve tool calls
  ├── max_concurrent          ← execution concurrency cap (default 1)
  ├── timeout_ms              ← per-execution timeout (default 5m)
  ├── max_budget_usd          ← optional monthly cost cap
  ├── max_turns               ← optional agentic-loop turn cap
  ├── gateway_exposure        ← local_only | invite_only | public
  └── cli_awareness_enabled   ← per-persona gate for Athena CLI session-resume awareness (Phase 5 v1, default OFF)

 Join tables (FK persona_id):
  ├── persona_tools + persona_tool_definitions      ← what the persona can CALL
  ├── persona_triggers                              ← how the persona gets INVOKED
  ├── persona_event_subscriptions                   ← what system events it REACTS TO
  ├── persona_automations + automation_runs         ← external workflow integration (n8n, Zapier, …)
  ├── persona_memories                              ← what it REMEMBERS between runs
  ├── persona_messages + persona_message_deliveries ← OUTBOUND notifications
  ├── persona_manual_reviews + review_messages      ← human APPROVAL gates
  ├── persona_executions + persona_tool_usage       ← run history + tool accounting
  └── persona_prompt_versions                       ← prompt version history
```

Rust surface:

```
src-tauri/src/db/models/persona.rs              (Persona + design context types)
src-tauri/src/db/models/agent_ir.rs             (AgentIr the template → persona pipeline uses)
src-tauri/src/db/models/tool.rs                 (PersonaToolDefinition, PersonaTool join)
src-tauri/src/db/models/trigger.rs              (PersonaTrigger + TriggerConfig enum)
src-tauri/src/db/models/memory.rs               (PersonaMemory — tiers, importance)
src-tauri/src/db/models/review.rs               (PersonaManualReview)
src-tauri/src/db/models/automation.rs           (PersonaAutomation + automation_runs)
src-tauri/src/db/repos/core/personas.rs         (CRUD + queries)
src-tauri/src/commands/core/personas.rs         (Tauri IPC: list, create, update, delete, list_personas_using_connector)
```

## Relation to other pillars

```
1. Templates  →→→→  2. Persona  →→→→  3. Execution
(static design)     (static config)    (dynamic run)

 JSON file in git     Row in personas    Row in persona_executions
 Adoption flow        Promoted from      Spawned by trigger or
 questionnaire +      AgentIr by         manual UI click
 vault matching       promote_build_     Streams tool calls,
                      draft              emits events, can
                                         chain to other personas
```

This doc set covers pillar 2. For pillar 1 see
[templates/](../templates/README.md). For pillar 3 see
[execution/](../execution/README.md).

## Persona lifecycle — draft · active · archived

Every persona row carries a first-class **`lifecycle`** column
(`draft` | `active` | `archived`, default `active`). It replaced a fragile
frontend heuristic (`!last_design_result && system_prompt === "You are a helpful
AI assistant."`) that could yank a *real* persona whose prompt merely resembled
the placeholder into build mode.

- **`draft`** — an eagerly-created build stub. The intent build (`UnifiedBuildEntry`
  → `createPersona({ lifecycle: "draft" })`) and the Companion `build_oneshot`
  stub both stamp `draft`. In the roster a draft shows a **Draft** badge and a
  click re-opens the build flow (keyed on `lifecycle === "draft"`, not the old
  prompt match). `promote_build_draft` flips it to `active` when the build
  finishes.
- **`active`** — a real, usable persona. The default for everything created
  outside the build-stub path, including template adoption and team synthesis
  (those produce ready personas, so they are never stranded as drafts).
- **`archived`** — retired but preserved. `archive_persona` moves a persona to
  `archived` **without any cascade** — executions, memories, messages all stay.
  `restore_persona` returns it to `active`. Archiving is blocked for
  system-origin personas (the Director). `enabled` stays orthogonal — it is the
  runtime-pause switch, not an off-state.

The roster's **Archived** toolbar toggle (`statusFilter === "archived"`) is the
one view that shows archived personas; every other view hides them. The
`list_personas` command takes an optional `lifecycle` filter
(`["active","draft"]` / `["archived"]`); `None` returns everything.

**A one-time backfill** on migration infers `draft` from the old heuristic
(placeholder/blank prompt AND no design result AND no design context, excluding
system personas), so existing stubs keep their draft affordance while a real
persona with a completed build stays `active`.

### Draft cleanup — bulk delete, cancel/fail GC, TTL sweep

- **`bulk_delete_personas(ids)`** deletes personas in **one** IPC and returns a
  per-id outcome (`deleted` | `protected` | `failed`). System personas are
  `protected`. The roster's batch-delete and "Delete drafts" buttons use it
  instead of N sequential `delete_persona` calls.
- **Build cancel** (`cancel_build_session`) deletes the eagerly-created draft it
  was building — but only via `delete_draft_if_safe`, which declines unless the
  persona is a `draft` with **no execution history** (a re-build of an active
  persona, or a draft that already produced work, survives).
- **TTL sweep** — the background `cleanup_tick` runs `sweep_stale_drafts` against
  the `draft_retention_days` setting: abandoned drafts (draft, no executions)
  older than the window are deleted through the same guard. **Default `0` =
  disabled (opt-in)** — deletion is destructive.

## The build session — how a Describe build runs

The **Describe** path (the intent build above) runs a live LLM **build
session**. `start_build_session` spawns a long-lived backend task that drives
the persona spec to completion; the surface is `UnifiedBuildEntry`, rendered as
`GlyphCinemaLayout` / `GlyphDialogueCinemaLayout` (the older `GlyphFullLayout` /
`GlyphPrototypeLayout` matrix surfaces were retired — `GlyphPrototypeLayout` is
gone and `GlyphFullLayout` survives only as GlyphCinemaLayout's internal compose
delegate). The session resolves the persona through the **v3 capability
chronology** — `behavior_core → capability_enumeration → per-capability
resolution → agent_ir` — asking **clarifying questions** when a gated dimension
needs your input. (The legacy "8 dimensions / 3×3 matrix" is now only a
back-compat mirror the v3 events are echoed into for the old matrix UI, not the
build model itself.)

**Interactive vs one-shot.** `start_build_session` takes a `mode`:
`"interactive"` (default) parks on clarifying questions and waits for
`answer_build_question`; `"one_shot"` runs autonomously — the LLM resolves every
gate itself, then the post-draft orchestrator tests each tool, runs a fix-pass
on failures (≤3 retries), and auto-promotes. A `context` parameter supplies
reference grounding (a writing sample, role/goal, or brand guide), and
`start_build_session_headless` is the Companion-driven variant.

**Where build state lives.** The whole session — phase, resolved cells, pending
question, `agent_ir`, adoption answers, mode, CLI pid — is checkpointed to the
`build_sessions` table on every event, so a build survives navigation and app
restart (`getActiveBuildSession` rehydrates it). The build LLM is pinned to
`claude-sonnet-4-6` on subscription auth. The seeded-adoption counterpart lives
in [templates/](../templates/README.md).

**Mid-build template suggestion** (glyph-convergence redesign, 2026-06-01). The
first time the build surfaces clarifying questions, a single dismissible card
appears above them (`BuildTemplateSuggestion`,
`src/features/agents/components/matrix/`). It runs the fast lexical matcher
(`companion_match_templates`, sub-second, no LLM) over your description and, if
a published template looks like a strong match, offers: *"<Template> looks like
a match — use it to skip these questions?"*

- **Use this template** → fetches the full design review (`get_design_review`),
  cancels the running generated build session (`cancel_build_session`), and
  swaps the build surface for the **inline** template-adoption flow (faster,
  pre-configured, tested). Nothing auto-routes — the user opts in.
- **Keep building** → dismisses the card and stays in the from-scratch build.
  The card re-arms when the next build session starts.

This replaced an earlier describe-first front-door launcher (the deleted
`PersonaCreator`): the suggestion now lives *mid-build* instead of gating the
entry, so the "type a description and start building" flow is unchanged.

Adoption reached this way renders **in-page**, not as a floating modal:
`AdoptionWizardModal` has an `inline` presentation mode that swaps only its
outer wrapper while keeping all lifecycle logic (reset, discard-confirm,
orphaned-draft cleanup) shared with the modal path. Adoption opened from the
**gallery** or **onboarding** still uses the floating modal — only the
mid-build accept path is in-page.

Both on-ramps converge at `buildPhase === "draft_ready"` and share the entire
back half (test → promote) and the same `matrixBuildSlice` state machine; the
only difference is the front: a *generated* build (the LLM resolves the
capabilities via clarifying questions) vs a *seeded* build (the template's
`agent_ir` arrives pre-populated and the questionnaire only binds parameters).
(The glyph-convergence design that introduced this shipped 2026-06-01; the
concept doc was retired once the feature landed.)

## Goal planning is a team concern, not a persona one

Defining a plain-language goal and decomposing it into work belongs to the
**orchestration layer** that coordinates *multiple* personas, not to a single
agent. It lives in **Team detail → Orchestrate** (`teamStudio/OrchestrationConsole`):
a split surface — match-strategy + parallelism options on the left, the goal
definition + routed-step preview on the right — that writes the goal to the
team-assignment orchestrator (`decompose_team_assignment_goal` →
`create_team_assignment` → `start_team_assignment`). The earlier agent-level
"Plan" tab + `sub_planner/` surface were removed in favour of this. See the
orchestration/teams docs for the assignment model.

## Editor UI — the Design hub

The per-persona editor surfaces are tabbed in `EditorTabBar`:
`Activity · Matrix · Design · Use Cases · Lab · Chat · Settings`.

**Share to the gallery.** The editor header (`PersonaEditorHeader`) carries a
**Share** button (`ShareAgentButton`) that publishes the persona to the public
web gallery via the `gallery_publish_persona` command — it builds the same
versioned `.persona.json` bundle the file-export uses (shared
`import_export::build_persona_bundle`) and POSTs it to personas-web
(`/api/personas/publish`, base overridable with `PERSONAS_WEB_URL`), returning a
`personas.ai/p/<slug>` link the user copies to share. Custom icons are
downgraded to a built-in at the publish boundary, same as every other export
path.

**One-click import (the receiving end).** Clicking **Open in Personas** on a
`/p/<slug>` page fires a `personas://import/<slug>` OS deep link; `lib.rs`'s
`on_open_url` handler emits `gallery-import-requested` to the frontend
(`eventBridge.ts`), which calls the `gallery_import_persona` command — it fetches
the shared bundle, imports it through the shared `import_persona_from_value` (the
same migrate → validate → write path the file importer uses), and best-effort
bumps the gallery install counter. Publish + import together close the viral
loop and record the `shared` / `imported` activation milestones (growth F5, see
`lib/analytics/activation.ts`).

**Invite a friend (referral).** The Share popover also offers a referral link
(`https://personas.ai/?ref=<installId>`). A `personas://ref/<code>` deep link
captures the referrer (`eventBridge.ts` → `captureReferrerOnce`); the credit is
recorded once the referred install reaches an activation milestone
(`recordReferralOnce` → `record_referral` → personas-web `/api/referrals`). The
desktop also surfaces the public **agent directory** at `personas.ai/gallery`
(growth F4).

The **Activity** tab opens with a GitHub-style 365-day execution heatmap (component: `ExecutionHeatmap`, sourced from `sub_analytics`) above the unified activity list. Hovering a cell reveals run count + cost; clicking a cell sets a date hash for downstream filtering.

The agent editor's **run history** (`sub_executions/components/list/ExecutionList`) is virtualized and paginated (load-more via `list_executions_summary`'s limit/offset), and each row surfaces the run's value verdict — Director score, business outcome, thinking-level badge, and a navigable "Retry of #…" link (`ExecutionValueBadges`). A completed run upserts into the list in place instead of refetching the whole history. Truncated logs carry an incomplete-log banner, and the Trace/Pipeline detail tabs no longer advertise data that doesn't exist. Runs that belong to a cross-persona chain get a **Chain** tab (`detail/chain/ChainTraceView`, backed by `get_chain_trace`) showing the ordered per-persona spans with status/cost/duration and click-through to each execution.

An execution's cost inspector (`CostBreakdownBar`, `sub_executions/detail/inspector`) shows the input/output/total token cost at Anthropic API list prices. For **Claude models** — which run on the user's Claude subscription via the Claude Code CLI (`isSubscriptionModel`, `force_subscription_auth`) — it adds a note reframing that figure: "≈{cost} if billed to the Anthropic API — included on your Claude subscription." This is a reframe of the same estimate, not a second computation (so it never double-counts), and it is suppressed for external-API models (`gpt-*`, `gemini-*`), which are real per-token spend.

**Design is a hub, not a single view.** It exposes horizontal sub-tabs (plus
the inline health badge in `EditorTabBar`):

| Sub-tab | Component | Notes |
|---|---|---|
| Use Cases | `PersonaUseCasesTab` | the per-capability surface. The capability detail (`UseCaseDetailExpanded`) header has a **Save as recipe** action that promotes the capability into a reusable [recipe](../recipes/README.md) via `promote_use_case_to_recipe` (UAT F-CLIENT-OPERATOR-VIEW — build-once → reusable-recipe loop). When the persona has assigned tools, the tab-bar actions also expose **Run tool** — a modal (`ToolRunnerModal` wrapping `ToolRunnerPanel`) that invokes a single tool directly via `invoke_tool_direct` (no LLM), rendering the typed outcome contract: failure category, HTTP status when present, a retryable hint, and an output-truncated notice. |
| Properties | `DesignTab` (wizard / intent / phases / apply) | the design wizard + saved prompt/summary/feasibility (was "Prompt") |
| Parameters | `PersonaParametersCard` (via `DesignParametersPanel`) | the persona's live tunable `{{param.*}}` values |
| Connectors | `ConnectorsSection` (via `DesignConnectorsPanel`) | read-only view of the saved design's connectors + tools |
| Events & Triggers | `EventsSection` (via `DesignEventsPanel`) | read-only triggers + event subscriptions |
| Notifications | `MessagesSection` (via `DesignNotificationsPanel`) | read-only notification channels (was "Messaging") |

Parameters / Connectors / Events & Triggers / Notifications were split out of
the former monolithic Prompt sub-tab (they used to stack inside its saved
view); each section sub-tab renders the same read-only design-result section
(`useSavedDesignResult`-driven, `DesignSubtabPanels.tsx`) with a quiet empty
state when its dimension is empty. The Properties sub-tab passes
`hideConnectors`/`hideEvents`/`hideMessages` to `DesignResultPreview` so those
bodies aren't duplicated. The health badge lives in `EditorTabBar`; clicking it
re-runs `runHealthCheck()` in-place.

Wiring:

```
src/features/agents/sub_design/DesignHub.tsx         (hub shell)
src/features/agents/sub_design/components/
  DesignHubHeader.tsx                                (sub-tab nav + health badge)
src/features/agents/sub_editor/components/
  EditorLazyTabs.tsx                                 (DesignTab now lazy-loads DesignHub)
  EditorBody.tsx                                     (routes editorTab === 'design')
src/stores/slices/system/uiSlice.ts                  (designSubTab state + migration)
```

Legacy persisted values (`editorTab === 'prompt' | 'connectors' | 'health'`)
are migrated on rehydrate to `editorTab === 'design'` with the
appropriate `designSubTab`. The `setEditorTab` action also accepts
legacy IDs for back-compat with existing call sites.

The **Tool Runner** UI (inline invocation from the Connectors sub-tab)
has been descoped; the backend `run_tool` command remains for future
surfaces (Lab, test harnesses).

### Lab — the Versions & Ratings table

The **Lab** tab is a single table for prompt-version management and
measurement. It replaced an earlier 7-mode tab switcher (Arena · A/B ·
Improve · Breed · Evolve · Versions · Regression), which asked the user to
learn seven sub-tools to answer one question: *which version + model should
go live?*

**One row = one (prompt version × model) pair; exactly one row is the live
config** (the version tagged `production` at the persona's effective model).
Rows are the cartesian product of `persona_prompt_versions` and the models
each version has been measured on, plus a placeholder row for versions never
measured. Columns: **Version · Model · Rating · Δ baseline · Cost · Status ·
Actions**. The Rating is the weighted composite (`tool_accuracy·0.4 +
output_quality·0.4 + protocol·0.2`, the canonical `engine::eval::SCORE_WEIGHTS`)
averaged across every measurement of that pair; the ★ marks the best model per
version.

Per-row **actions**:

| Action | Effect |
|---|---|
| **Activate** | Rolls the version's prompt live + tags it `production`, **and** switches the persona's active model (`model_profile`) to the row's model. |
| **Measure** | Runs a version-scoped **Arena** across models — the only surviving panel from the old switcher; results populate the row's rating. |
| **Improve** | Opens the **Athena** companion with a pre-filled improvement brief (persona + version + weakest measured metric) and waits for the user to specify the focus. |
| **Diff** | Compares the version's prompt against the active version. |
| **Baseline** | Pins the row's version as the regression baseline; other rows then show **Δ vs baseline** on the same model (a drop ≥5 points is flagged). |
| **Archive** | Tags the version `archived`. |

What happened to the old modes:

- **A/B + Eval + Regression** — folded into the table (compare ratings across
  rows; Δ-vs-baseline is the regression signal).
- **Improve** — the row action seeds Athena instead of a dedicated panel.
- **Breed + Evolve** — descoped from the UI and exposed as **headless
  companion actions** (`companion_breed_personas` / `companion_evolve_persona`,
  approval-gated). The `genome_*` / `evolution_*` commands and engine are
  unchanged; Athena is now their only driver.

Backend: `lab_start_arena` takes an optional `version_id` (snapshots which
version it measured onto `lab_arena_runs` / `lab_arena_results`);
`lab_get_version_ratings` aggregates the (version, model) rollup across the
arena / eval / ab result tables.

Wiring:

```
src/features/agents/sub_lab/components/shared/LabTab.tsx        (renders the table)
src/features/agents/sub_lab/components/versions_table/          (table + cells + row actions)
src/features/agents/sub_lab/libs/versionMatrixRows.ts          (pure row builder)
src/stores/slices/agents/labSlice.ts                            (versionRatings, activateVersion)
src/features/plugins/companion/useSeedAthenaComposer.ts        (Improve → Athena composer seed)
src-tauri/src/commands/execution/lab.rs                         (version-aware arena, ratings rollup)
src-tauri/src/db/repos/lab/ratings.rs                          (get_version_ratings)
```

### Persona icons

A persona's `icon` column is a free-form string with four recognised
shapes, all classified in one place — `resolvePersonaIcon()`
(`src/lib/icons/resolvePersonaIcon.ts`). Both renderers, `PersonaIcon`
and `PersonaAvatar`, route through it so they never disagree:

| `icon` value | Kind | Source |
|---|---|---|
| `agent-icon:{id}` | built-in | curated 20-icon catalog (`agentIconCatalog.ts`), theme-aware sprite |
| `custom-icon:{sha256}` | custom | user-uploaded image file |
| `https://…` | url | remote image (SSRF-sanitized) |
| a short glyph | emoji | literal emoji text |

The Settings tab's icon picker (`PersonaIconPickerModal`) offers the
built-in catalog, **Upload image**, a **Your icons** library, and
**Generate with AI**.

Uploads go through `import_persona_icon`
(`src-tauri/src/commands/core/persona_icons.rs`): the source file is
size-gated, decoded, downscaled to ≤512 px, and re-encoded to PNG —
the round trip strips metadata and format-specific payloads. Files are
content-addressed and stored at `{app_data_dir}/persona-icons/{sha256}.png`;
the directory is the reusable icon library (no DB table).

**Generate with AI** (`persona_icon_gen.rs`) appears only when the vault
holds a credential for an image-generation connector (Leonardo AI or
Higgsfield — an explicit allowlist, since the `ai` connector category
also covers vision/analysis connectors). It runs the provider's async
generation job, downloads the result, and stores it through the *same*
upload pipeline — so a generated icon is an ordinary `custom-icon:` asset.

Custom icons are **local-only**. At every export boundary
(`data_portability.rs`, `import_export.rs`, `bundle.rs`)
`engine::persona_icon::export_safe_icon` downgrades a `custom-icon:` value
to a built-in `agent-icon:` inferred from the persona's `template_category`,
so a shared persona arrives with a sensible catalog icon rather than a dead
reference.

### Change history — who changed what, when

The Settings tab shows a read-only **Change history** list (`PersonaChangeHistory`,
`src/features/agents/sub_editor/components/`) answering "who changed my agent's
model / budget / prompt, and when". Every `update_persona` writes one row per
*changed* field to the append-only `persona_change_log` table
(`src-tauri/src/db/repos/resources/persona_change_log.rs`), computed from the
already-loaded persona row inside the same UPDATE transaction — no extra SELECT
on the autosave path. Each row carries the field name, truncated before→after
values, a `source` tag (`editor` · `header` · `fanout` · `other`, derived from
the optional `UpdatePersonaInput.source`), and a timestamp.

- **Secrets are never stored.** `model_profile` and `notification_channels`
  carry `auth_token`s; their values are redacted to `"(changed)"`.
- **Noise control.** Same-field edits within 30s coalesce into the prior row
  (keeping the original before-value); per-persona history is capped at 200 rows.
- Read via the `list_persona_change_log` IPC command. Restore/rollback is out of
  scope — this is an inspection surface only.

## Home team — workspace anchor

> **History:** the standalone **PersonaGroup** primitive (a `persona_groups`
> table + `personas.group_id` folder) was retired in the Groups→Teams
> consolidation (2026-05, ADR `2026-05-23-groups-into-teams`). The team is
> now the single workspace + orchestration primitive; what follows is the
> post-consolidation model.

`Persona.home_team_id` is an optional FK to `persona_teams`. It is the
persona's **workspace anchor** — the one team whose workspace settings and
shared injected memory apply to the persona at runtime. Two relationships
stay deliberately separate:

- **Membership** (`persona_team_members`, N:M) — orchestration: a persona
  can be on many teams.
- **Home team** (`personas.home_team_id`, 1:N) — workspace: exactly one
  team supplies the persona's defaults + injected memory.

A team carries the workspace facet that groups used to (ported onto
`persona_teams`, ts-rs binding `src/lib/bindings/PersonaTeam.ts`):

| Field | Purpose |
|---|---|
| `name`, `color`, `icon` | Display |
| `sharedInstructions` | Appended to every member persona's system prompt at runtime |
| `defaultModelProfile`, `defaultMaxBudgetUsd`, `defaultMaxTurns` | Workspace defaults (resolved by `config_merge` against the home team) |

**UI surface:** the **Teams** entry under Agents → sidebar L2 lists teams
(management table + Split Studio); the Studio's **Workspace** pane edits a
team's shared instructions + defaults (`TeamWorkspacePane`). A persona's
home team is set via the persona drop-rail / batch bar on the All-agents
overview (drag onto a team chip, or batch "Set home team"), and Monitor's
**By home team** toggle groups the grid by it.

### Home-team-scoped shared memory

`persona_memories.home_team_id` is an optional second injection scope
alongside `use_case_id`. A memory attributed to home team `T` is **shared
with every persona whose `home_team_id = T`** — when such a persona runs,
the injection path (`get_for_injection_v2`) OR-s in `home_team_id = T` rows
alongside the persona's own private memories. No FK by design (orphan
policy mirrors `use_case_id`). Attribution is populated by the
groups→teams data migration; there is no in-app "share to team" affordance
post-consolidation, so this surfaces migrated group-shared memory rather
than newly-authored team memory. See `MEMORY CONTRACT (5)` in
`src-tauri/src/db/models/memory.rs` for invariants.

## Gotchas that burn time

1. **`design_context` has two formats.** Old personas store a flat
   JSON with top-level `files` + `references`. New ones use the typed
   `DesignContextData` envelope (`designFiles`, `credentialLinks`,
   `useCases`, `twinId`). `parse_design_context()` in
   `src-tauri/src/db/models/persona.rs` handles both.
2. **`notification_channels` is encrypted JSON.** It's not a plain
   array. Writes go through the crypto layer; reads decrypt before
   parsing. Don't query it with raw SQL — use the repo helpers.
3. **Automations become virtual tools at execution time.** Tools with
   category `"automation"` and id `auto_{automation_id}` are injected
   into the tool list in `executions.rs` before prompt assembly. A
   persona with zero `persona_tools` rows can still have tools if it
   has active automations.
4. **Trust level gates tool-call auto-approval.** `Manual` means every
   tool call waits for user review. `Verified` auto-approves.
   `Revoked` blocks execution entirely. This is separate from the
   per-call manual_review protocol (which any persona can invoke).
5. **`headless: true` overrides the trust level for approvals.**
   Headless personas never pause for tool-call approval, even if
   `trust_level == Manual`. This is for fully-automated personas that
   run without a human in the loop.
6. **`parameters` vs template adoption answers are different.**
   `parameters` is a JSON array of `PersonaParameter` objects the user
   can tune at runtime (via the persona editor UI) without rebuilding.
   Adoption answers are set once during template adoption and baked
   into the prompt. See
   [templates/07-adoption-answer-pipeline.md](../templates/07-adoption-answer-pipeline.md).
7. **Deleting a persona shows a blast radius — including team membership.**
   `persona_blast_radius` (`db/repos/core/personas.rs`) is the pre-delete
   impact summary the All Personas delete-confirm modal renders. It now
   includes a `team` impact ("Member of team(s): … — will be removed from
   them") so removing an agent that belongs to a team warns first. The
   `persona_team_members` rows cascade on delete; the warning is informational.
8. **The Constellation list layout caps at 200 rendered personas.**
   This All-Personas layout is unvirtualized — each node is an SVG subtree — so
   very large fleets are capped at `PERSONA_RENDER_CAP = 200` with a "Showing
   200 of N — narrow with search or filters" notice. The default **table**
   layout (DataGrid) is virtualized and shows all sizes; users with 200+
   personas should use it or filter. True windowing for the Constellation layout
   is a tracked follow-up — see the architect perf scan (Phase E render-cap
   guardrail). _(The uniform-card **Grid** layout was retired 2026-06-20.)_
9. **The All-Personas page has a top-level view switcher: _Personas_ vs _Configuration_.**
   _Personas_ is the list (the Table / Constellation layouts above).
   _Configuration_ (`allPersonas/PersonaConfigPanel.tsx`, migrated out of the old
   Settings → Config Resolution tab) is the per-persona **effective model-config**
   table: for every persona it resolves model / provider / budget / turns / cache
   through the agent → workspace → global → default cascade
   (`resolve_effective_config_bulk`, `engine/config_merge.rs`) and tags each cell
   with the tier that supplied it. When no tier sets the **Model** field (the
   common case, since model tiering lives on use-cases rather than persona-level
   `model_profile`), the Model cell surfaces the **distinct per-capability models**
   the persona's use-cases declare via `model_override` — shown in violet with a
   _Per capability_ tag (parsed client-side from `design_context`) instead of a
   bare `--`. Other fields with no tier value still read `--` with a `DEFAULT`
   badge. Each persona row is **expandable** (chevron in the Agent column): it
   reveals one indented sub-row per capability, surfacing that capability's
   **model** (from `model_override`) and its **provider**. Since bare-string
   overrides carry no provider, the provider is **derived from the model name**
   via a brand mapping (`haiku`/`sonnet`/`opus`/`claude` → Anthropic, `gpt`/`o#`
   → OpenAI, `gemini` → Google, `llama`/`qwen`/… → Ollama) and rendered with the
   provider's brand icon (an explicit override provider wins). The collapsed
   parent row mirrors this — its **Provider** cell shows the distinct brand
   icon(s) derived across the persona's capabilities when no tier supplies a
   provider. A muted `—` means
   the capability inherits the persona/default; budget/turns/cache are
   persona-level so they read `—` on sub-rows. A name filter and an "Overrides
   only" toggle isolate personas that have escaped workspace/global defaults.
