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

## Editor UI — the Design hub

The per-persona editor surfaces are tabbed in `EditorTabBar`:
`Activity · Matrix · Design · Use Cases · Lab · Chat · Settings`.

The **Activity** tab opens with a GitHub-style 365-day execution heatmap (component: `ExecutionHeatmap`, sourced from `sub_analytics`) above the unified activity list. Hovering a cell reveals run count + cost; clicking a cell sets a date hash for downstream filtering.

**Design is a hub, not a single view.** It absorbs three former tabs
via horizontal sub-tabs + an inline health badge:

| Sub-tab | Component | Absorbed from |
|---|---|---|
| Design | `DesignTab` (wizard / intent / phases / apply) | existing Design tab |
| Prompt | `PersonaPromptEditor` (structured sections + custom) | former standalone Prompt tab |
| Connectors & Tools | `PersonaConnectorsTab` (connectors, tools, automations) | former standalone Connectors tab |

The former **Health tab** is collapsed into the badge in the Design
hub header (`DesignHubHeader`). Clicking the badge re-runs
`runHealthCheck()` in-place; `HealthCheckPanel` is still available
and can be reopened if needed.

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

## Persona Groups — workspace grouping

`Persona.group_id` is an optional FK to `persona_groups`. A group is a
**lightweight workspace folder**, not an execution-time construct: it
exists to organize personas in the UI and to carry a small set of
group-level defaults that the editor surfaces as a one-stop-edit.

`PersonaGroup` fields (`src-tauri/src/db/models/persona_group.rs`,
ts-rs binding `src/lib/bindings/PersonaGroup.ts`):

| Field | Purpose |
|---|---|
| `name`, `color`, `description` | Display |
| `sortOrder`, `collapsed` | Sidebar ordering / expand state |
| `sharedInstructions` | Appended to every member persona's system prompt at runtime |
| `defaultModelProfile`, `defaultMaxBudgetUsd`, `defaultMaxTurns` | Defaults inherited by new personas added to the group |

**UI surface** (Power tier — `TIERS.TEAM` gate, lifted out of dev-only on
2026-05-22): the **Groups** entry under Agents → sidebar L2 opens
`GroupManagerPage` (`src/features/pipeline/components/groups/`). The page
lists groups with a persona count derived from
`personas.filter(p => p.group_id === group.id)`, an Ungrouped chip for
the rest, and a modal editor for name/color/description/sharedInstructions.
Heavier defaults (model profile, budget, turn cap) are exposed by
`groupSlice.updateGroup()` but not yet wired into the editor — Stage 2
work.

Groups are distinct from **Teams** (`PersonaTeam`, sibling concept under
the same sidebar block): teams are an *execution-time* construct with a
member graph, edges, pipeline runs, and a canvas editor. A persona can
belong to at most one group (folder semantics) but participate in many
teams (pipeline semantics).

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
