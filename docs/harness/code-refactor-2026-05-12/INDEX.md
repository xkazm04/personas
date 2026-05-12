# Code-Refactor Scan — Personas, 2026-05-12

> 23 parallel subagent runs across 9 context groups, batched in 3 waves of 8.
> Scan agent: `code-refactor` (dead code, duplication, structure, cruft).
> Scope: full-stack — src/ (TypeScript/React) + src-tauri/ (Rust).
> Side: both.

---

## Totals

| | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|
| Across 23 contexts | 56 | 116 | 77 | **249** |
| Share | 22.5% | 46.6% | 30.9% | 100% |

By category:

| Category | Count | Share |
|---|---:|---:|
| **Duplication** (3+ near-copies that drift in lockstep) | 117 | 47.0% |
| **Dead-code** (orphan modules / unused exports / unreachable branches) | 81 | 32.5% |
| **Cruft** (debug logs, stale TODOs, leftover commented code) | 31 | 12.4% |
| **Structure** (god-files, mis-placed modules, layering breaks) | 20 | 8.0% |

**Counts verified two ways**: 249 severity bullets across all reports vs 249 totals declared in per-context headers. ✓

---

## Per-context breakdown

Sorted by criticals (high) desc, then by total.

| # | Context (group) | H | M | L | Total | Report |
|---|---|---:|---:|---:|---:|---|
| 1 | Activity, Events & Realtime Bus (*Observability*) | 4 | 6 | 2 | 12 | [activity-events-realtime-bus.md](./activity-events-realtime-bus.md) |
| 2 | First-Party Plugins (*Companion & Plugin Ecosystem*) | 4 | 5 | 3 | 12 | [first-party-plugins-artist-drive-gitlab-obsidian-twin.md](./first-party-plugins-artist-drive-gitlab-obsidian-twin.md) |
| 3 | Trigger Studio & Webhooks (*Triggers/Schedules*) | 4 | 5 | 3 | 12 | [trigger-studio-webhooks.md](./trigger-studio-webhooks.md) |
| 4 | i18n & Shared Design (*Settings & System*) | 3 | 6 | 5 | 14 | [i18n-system-shared-design-components.md](./i18n-system-shared-design-components.md) |
| 5 | Execution Engine, Healing & Genome (*Execution*) | 3 | 7 | 3 | 13 | [execution-engine-healing-genome.md](./execution-engine-healing-genome.md) |
| 6 | Templates Catalog & n8n Adoption (*Templates*) | 3 | 5 | 4 | 12 | [templates-catalog-n8n-adoption.md](./templates-catalog-n8n-adoption.md) |
| 7 | Analytics, SLA, Usage & Leaderboard (*Observability*) | 3 | 6 | 2 | 11 | [analytics-sla-usage-leaderboard.md](./analytics-sla-usage-leaderboard.md) |
| 8 | Tests, Assertions & Quality Gates (*Execution*) | 3 | 6 | 2 | 11 | [tests-assertions-quality-gates.md](./tests-assertions-quality-gates.md) |
| 9 | Credential Vault & CRUD (*Vault*) | 3 | 4 | 3 | 10 | [credential-vault-crud.md](./credential-vault-crud.md) |
| 10 | Pipeline, Team Memory, Sharing & Network (*Companion*) | 3 | 5 | 2 | 10 | [pipeline-team-memory-sharing-network.md](./pipeline-team-memory-sharing-network.md) |
| 11 | Agent Chat & Sessions (*Persona/Agent Studio*) | 2 | 6 | 4 | 12 | [agent-chat-sessions.md](./agent-chat-sessions.md) |
| 12 | Lab, Use Cases, Tools & Connectors (*Persona/Agent Studio*) | 2 | 4 | 6 | 12 | [lab-use-cases-tools-connectors.md](./lab-use-cases-tools-connectors.md) |
| 13 | Build Sessions & PersonaMatrix (*Execution*) | 2 | 4 | 5 | 11 | [build-sessions-personamatrix.md](./build-sessions-personamatrix.md) |
| 14 | Connector Catalog, MCP & Recipes (*Vault*) | 2 | 4 | 5 | 11 | [connector-catalog-mcp-gateways-recipes.md](./connector-catalog-mcp-gateways-recipes.md) |
| 15 | Incidents, Manual Review, Memories & Knowledge (*Observability*) | 2 | 6 | 3 | 11 | [incidents-manual-review-memories-knowledge.md](./incidents-manual-review-memories-knowledge.md) |
| 16 | Automations & Deployment (*Triggers/Schedules*) | 2 | 5 | 3 | 10 | [automations-deployment.md](./automations-deployment.md) |
| 17 | Companion Runtime & Approvals (*Companion*) | 2 | 5 | 3 | 10 | [companion-runtime-approvals.md](./companion-runtime-approvals.md) |
| 18 | OAuth, Discovery, Foraging & API Proxy (*Vault*) | 2 | 5 | 3 | 10 | [oauth-discovery-foraging-api-proxy.md](./oauth-discovery-foraging-api-proxy.md) |
| 19 | Onboarding, Home & Simple Mode (*Settings & System*) | 2 | 5 | 1 | 8 | [onboarding-home-simple-mode.md](./onboarding-home-simple-mode.md) |
| 20 | Schedules & Cron Agents (*Triggers/Schedules*) | 2 | 3 | 3 | 8 | [schedules-cron-agents.md](./schedules-cron-agents.md) |
| 21 | Settings, BYOM & Engine Config (*Settings & System*) | 1 | 5 | 5 | 11 | [settings-byom-engine-config.md](./settings-byom-engine-config.md) |
| 22 | Persona CRUD & Editor (*Persona/Agent Studio*) | 1 | 5 | 4 | 10 | [persona-crud-editor.md](./persona-crud-editor.md) |
| 23 | Recipes (Use-Case Blueprints) (*Templates*) | 1 | 4 | 3 | 8 | [recipes-use-case-blueprints.md](./recipes-use-case-blueprints.md) |

---

## All 56 high-severity findings — one-line summary

Grouped into themes for wave-based triage. Each item links to its full entry in the per-context report.

### Theme A — Orphan UI/module trees (delete whole files/dirs after verifying zero importers)

The biggest LOC win and lowest risk. Each one is a confirmed orphan that no caller references.

| # | Context | Finding (LOC) | Location |
|---|---|---|---|
| A1 | trigger-studio-webhooks | `sub_triggers/` UI tree (~3,790 LOC, 28 files) — only `TimezoneSelect` imported externally | `src/features/triggers/sub_triggers/` |
| A2 | i18n & shared-design | 11 orphan modules in `features/shared/components/*` (~1,150 LOC) | `src/features/shared/components/*` |
| A3 | onboarding-home-simple-mode | `SetupCards.tsx` (625 LOC) — referenced only in docs + own slice docstring | `src/features/home/setup/SetupCards.tsx` |
| A4 | templates-catalog-n8n-adoption | `template_adopt.rs` orphans (~550 LOC) — Stage A1 deleted the frontend boundary but left workers | `src-tauri/src/commands/.../template_adopt.rs` |
| A5 | pipeline-team-memory-sharing-network | `workflow_compiler.rs` + `compile_workflow` command (~440 LOC) — superseded by `suggestTopology` | `src-tauri/src/.../workflow_compiler.rs` |
| A6 | incidents-manual-review-memories-knowledge | `sub_memories/hooks/` (404 LOC, 4 files) — superseded by `libs/` siblings | `src/features/overview/sub_memories/hooks/` |
| A7 | incidents-manual-review-memories-knowledge | `TriagePlayer.tsx` (391 LOC) — only type leaks via `ManualReviewList.tsx:27` | `src/features/.../TriagePlayer.tsx` |
| A8 | lab-use-cases-tools-connectors | `sub_tool_runner/` (387 LOC) — `toolRunnerOpen` flag confirms abandoned wire-up | `src/features/agents/sub_tool_runner/` |
| A9 | analytics-sla-usage-leaderboard | `sub_usage/charts/` (271 LOC, 5 files) — duplicates `libs/` siblings + has known NaN bug | `src/features/overview/sub_usage/charts/` |
| A10 | schedules-cron-agents | Legacy `CronAgentsPage.tsx` (191 LOC) — `index.ts` re-exports newer `components/CronAgentsPage` | `src/features/overview/sub_cron_agents/CronAgentsPage.tsx` |
| A11 | activity-events-realtime-bus | `VisualizationNodes` + `VisualizationParticles` (~156 LOC) — superseded by `EventBus*Renderers.tsx` | `src/features/overview/sub_realtime/components/renderers/` |
| A12 | activity-events-realtime-bus | `parseEventQuery` + `matchesQuery` DSL (132 LOC) — sidebar uses 5-line inline filter instead | `src/features/overview/sub_realtime/libs/parseEventQuery.ts` |
| A13 | onboarding-home-simple-mode | `OnboardingProgressBar` (89 LOC) + `FleetHealthStrip` + `fleetHealth` lib (~133 LOC) | `src/features/home/` |
| A14 | analytics-sla-usage-leaderboard | `sub_usage/DashboardFilters.tsx` — superseded by 3 split files | `src/features/overview/sub_usage/DashboardFilters.tsx` |
| A15 | agent-chat-sessions | `ChatThread.tsx` (80 LOC) — fully orphaned | `src/features/agents/components/ChatThread.tsx` |

**Theme A subtotal**: ~7,800+ LOC of confirmed orphan code (frontend + Rust).

### Theme B — Dead code in active modules (helpers/structs reachable from the file but never invoked)

Higher verification cost than Theme A — these are individual functions inside live modules, not whole files. Each needs a grep before deletion.

| # | Context | Finding | Location |
|---|---|---|---|
| B1 | execution-engine-healing-genome | Eight unused exports in `pipeline.ts` (~150 LOC) | `src/lib/execution/pipeline.ts:602,633,647,655,669,661,215` |
| B2 | settings-byom-engine-config | Six version-check helpers in `provider/mod.rs` (~145 LOC, `#[allow(dead_code)]`) — runner re-implements inline | `src-tauri/src/.../provider/mod.rs` |
| B3 | tests-assertions-quality-gates | `run_consensus_test` + helpers — entire dormant lab mode, `#[allow(dead_code)]` | `src-tauri/src/.../test_runner.rs` |
| B4 | tests-assertions-quality-gates | Orphan frontend assertion API — `src/api/agents/outputAssertions.ts` (57 LOC) has zero consumers | `src/api/agents/outputAssertions.ts` |
| B5 | companion-runtime-approvals | `execute_use_connector` (54 LOC) — unreachable since `dispatcher.rs` → `connector_use.rs` was added | `src-tauri/src/commands/companion/approvals.rs:1101-1155` |
| B6 | agent-chat-sessions | `system_prompt_hash` plumbed through models, repo SQL, migration, ts-rs, JS — but no caller ever writes it | `src-tauri/src/db/models/chat.rs:104,121` (+ 5 more sites) |
| B7 | build-sessions-personamatrix | Three `gate_seed_for_intent` overloads — bare + `_with_registry` variants unused | `src-tauri/src/engine/build_session/gates.rs:747,763,787` |

### Theme C — Broken frontend wrappers (calls non-existent backend commands)

These are **shipped bugs** masquerading as "dead-code." Calls would fail at runtime if anyone tried to use them. Decision needed: delete the wrappers OR wire up the backend.

| # | Context | Finding | Location |
|---|---|---|---|
| C1 | automations-deployment | 3 Zapier API wrappers (`zapier_list_zaps`, `_create_zap`, `_trigger_webhook`) — backend has zero `#[tauri::command]` registrations | `src/api/agents/automations.ts:79-86` |
| C2 | automations-deployment | n8n CRUD frontend wrappers — 4 functions, paired Rust commands exist but no UI route | `src/api/agents/automations.ts:62-75` |

### Theme D — Repo/DB-layer duplication (schema-drift risk: same SQL written by hand in 3+ places)

**Highest schema-drift risk in the codebase.** Every column added must be edited at N sites; some are already drifting.

| # | Context | Finding | Location |
|---|---|---|---|
| D1 | credential-vault-crud | `INSERT INTO credential_fields` body duplicated across 5 callsites | `src-tauri/src/db/repos/resources/credentials.rs:265,408,1181,1221` + 1 more |
| D2 | execution-engine-healing-genome | Three near-identical `update_status*` functions (~200 LOC) — differ only in WHERE-clause guard | `src-tauri/src/db/repos/execution/executions.rs:510,584,661` |
| D3 | credential-vault-crud | `classify_field_type` duplicated 3× verbatim | `src-tauri/src/db/repos/.../credentials.rs:1354` + 2 more |
| D4 | credential-vault-crud | `update_with_fields` re-implements `save_fields` inside its transaction | `src-tauri/src/db/repos/resources/credentials.rs:388-418` |
| D5 | execution-engine-healing-genome | `PersonaExecution` vs `GlobalExecutionRow` struct + row-mapper duplication (~100 LOC) | `src-tauri/src/db/models/execution.rs:11-57,107-149` |
| D6 | connector-catalog-mcp-gateways-recipes | Three near-identical cancel handlers (recipe execution/generation/versioning, ~75 LOC each) | `src-tauri/src/commands/recipes/crud.rs:212,291,...` |
| D7 | connector-catalog-mcp-gateways-recipes | `accept_version` and `revert_to_version` mirror each other (~80 LOC each) | `src-tauri/src/db/repos/resources/recipes.rs:452,535` |
| D8 | persona-crud-editor | Duplicated cloud auto-sync block in `update_persona` and `update_persona_parameters` (~55 LOC, **already drifted** — neither forwards `parameters`/`gateway_exposure`) | `src-tauri/src/commands/core/personas.rs:118-177, 226-281` |
| D9 | lab-use-cases-tools-connectors | Lab command CRUD duplicated across 4 modes | `src-tauri/src/commands/execution/lab.rs` |

### Theme E — UI presentation duplication (formatters, badges, modals)

Lower-risk than Theme D — pure presentation code. High-impact because there are user-visible inconsistencies between copies.

| # | Context | Finding | Location |
|---|---|---|---|
| E1 | activity-events-realtime-bus | Three `HighlightedJson` JSON-syntax-highlighter implementations (+1 inline 4th copy, ~210 LOC) — only one has sanitization | `src/features/overview/sub_events/HighlightedJson.tsx` + 3 more |
| E2 | activity-events-realtime-bus | Three `EventDetailModal`-equivalents rendering the same fields (~370 LOC) | `src/features/overview/sub_events/EventDetailModal.tsx` + 3 more |
| E3 | analytics-sla-usage-leaderboard | `fmtCost` re-implemented 4 times across hot paths | `src/features/overview/sub_activity/libs/executionMetricsHelpers.ts` + 3 |
| E4 | build-sessions-personamatrix | v3 `BuildEvent` dispatch switch duplicated verbatim across Channel + EventBridge — 10-arm switch, no compile-time link | `src/hooks/build/useBuildSession.ts:211-254` + `src/lib/eventBridge.ts:386-417` |
| E5 | schedules-cron-agents | `CRON_PRESETS` duplicated across 5 separate cron-preset arrays | `src/features/.../cron*` |
| E6 | companion-runtime-approvals | Three-way duplication of sidebar route allowlist | `src-tauri/src/companion/dispatcher.rs:150-160` + 2 more |
| E7 | pipeline-team-memory-sharing-network | `snapToGrid` / `GRID_SIZE` redefined in pipeline canvas, ignoring shared util | `src/features/pipeline/...` |
| E8 | pipeline-team-memory-sharing-network | Relative-time formatter re-implemented 4 times | `src/features/sharing` + `pipeline` |
| E9 | tests-assertions-quality-gates | `scoreLabel`/`scoreBg`/`ScoreBar` triplicated across 3 lab result views | `src/features/agents/sub_lab/...` |
| E10 | templates-catalog-n8n-adoption | Duplicate `N8nQuestion` renderer logic across List + Stepper widgets | `src/features/.../n8n` |
| E11 | templates-catalog-n8n-adoption | Duplicate filter-dropdown shell across gallery search filters | `src/features/templates/...` |

### Theme F — Twin plugin pattern collapse (cross-cutting plugin shape)

A single plugin family with deep internal duplication — best handled in one focused pass.

| # | Context | Finding | Location |
|---|---|---|---|
| F1 | first-party-plugins | Seven near-identical `TwinVariantTabs` wrapper page files | `src/features/plugins/twin/sub_*/Page.tsx` × 7 |
| F2 | first-party-plugins | CRUD-action boilerplate triplicated across twin slice (15+ try/catch shapes) | `src/stores/slices/system/twinSlice.ts:155-442` |
| F3 | first-party-plugins | `ToneForm`/`ChannelMeta`/`DraftForm` declared identically in each twin variant | `src/features/plugins/twin/sub_tone/*` |

### Theme G — Type-binding (ts-rs) drift

Hand-rewritten TS types that have silently diverged from the authoritative `ts-rs`-generated bindings. **Critical correctness bug for at least one (DriveStatus.storageUsedBytes: `number` here, `bigint` in binding — truncates drives >9 PB).**

| # | Context | Finding | Location |
|---|---|---|---|
| G1 | first-party-plugins | Hand-rewritten ~25 DTOs in `api/obsidianBrain/`, `api/drive.ts`, `api/artist/` — drift confirmed | `src/api/obsidianBrain/index.ts:8-88, 160-258` |

### Theme H — Cross-cutting taxonomy / parser duplication

| # | Context | Finding | Location |
|---|---|---|---|
| H1 | oauth-discovery-foraging-api-proxy | Two parallel OpenAPI/Swagger parsers (~120 LOC, already drifting in `required` defaults) | `src-tauri/src/engine/api_definition.rs:49` + `src-tauri/src/commands/credentials/openapi_autopilot.rs:141` |
| H2 | oauth-discovery-foraging-api-proxy | Three near-duplicate Google OAuth consent hooks share one backend pair | `src/hooks/design/oauth/{useOAuthConsent,useGoogleOAuth,useCredentialOAuth}` |
| H3 | trigger-studio-webhooks | Triple-registered trigger-type taxonomy across 3 files | `src/features/triggers/...` |
| H4 | i18n & shared-design | Triplicate language list (manifest + switcher + onboarding all redefine; onboarding missing bn/id/vi) | `src/i18n/...` |

### Theme I — God-files (deferred — needs careful refactor)

| # | Context | Finding | Location |
|---|---|---|---|
| I1 | trigger-studio-webhooks | `commands/tools/triggers.rs` god-file (1,801 LOC, 27 commands) | `src-tauri/src/commands/tools/triggers.rs` |
| I2 | trigger-studio-webhooks | `db/repos/resources/triggers.rs` god-file (3,012 LOC, 34 functions) | `src-tauri/src/db/repos/resources/triggers.rs` |

### Theme J — i18n locale parity (NOT a code-refactor task — flagged for separate triage)

| # | Context | Finding | Location |
|---|---|---|---|
| J1 | i18n & shared-design | **312 keys missing in every non-English locale** (13 × 312 ≈ 4,056 untranslated strings, CI gate failing but non-blocking) | `locales/*` |

### Theme K — RecipePlaygroundModal state-split bug (structural)

| # | Context | Finding | Location |
|---|---|---|---|
| K1 | recipes-use-case-blueprints | `RecipePlaygroundModal` calls `useRecipeTestRunner` **twice** — modal and tab have independent state copies; History tab is permanently empty | `src/features/recipes/RecipePlaygroundModal.tsx` + `RecipeTestRunnerTab.tsx` |

---

## Triage themes (wave-split recommendation)

| Wave | Theme | High findings | Mental model | Risk | Est. LOC closed |
|---|---|---:|---|---|---:|
| **1** | A — Whole-module orphan deletion | 15 | "Verify zero importers, delete file" | **Lowest** | ~7,800 |
| **2** | D — Repo/DB-layer CRUD collapse | 9 | "Extract one helper per duplicated SQL block" | Medium | ~1,500 |
| **3** | B — Dead code in active modules + C — Broken wrappers | 9 | "Grep proves unreachable → delete" | Medium | ~700 |
| **4** | E — UI presentation duplication | 11 | "Move to shared/components, re-export" | Low-medium | ~1,200 |
| **5** | F — Twin plugin pattern + G — ts-rs drift + H — Taxonomy parsers | 8 | "Pattern collapse across plugin tree" | Medium-high | ~800 |
| **6** | I — God-file decomposition (deferred) | 2 | "Carve by domain into ≤500-LOC modules" | High | — |
| **7** | K — RecipePlaygroundModal state bug | 1 | One-off structural fix | Low | ~20 |
| **(separate)** | J — i18n locale parity | 1 | Translation work, not refactor | — | — |

Total high findings closed across waves 1-5: **51 of 56**. Plus the ~116 medium-severity findings hanging off these themes get cleaned up incidentally — many medium findings in the per-context reports are smaller instances of the same patterns and can be picked up while the mental model is hot.

### Why this wave order

- **Wave 1 first** because orphan deletion is the lowest-risk, highest-LOC payoff. A clean codebase makes every subsequent wave easier to navigate. No semantic changes, just `git rm`.
- **Wave 2 second** because schema-drift in the repo layer is the highest *correctness* risk — three of the duplications (`update_status*`, persona auto-sync, credential_fields INSERT) are **already drifting**. Each schema column added has 3-5x the maintenance cost until collapsed.
- **Wave 3** consolidates remaining backend dead-code + the broken wrappers — same mental model (grep, verify unreachable, delete).
- **Wave 4** is presentation work. Lower risk; deferring until the bigger surface is cleaned.
- **Wave 5** is the trickiest theme (cross-cutting plugin pattern + type-binding drift) — leave it until the codebase has been pruned so the targets are clearer.
- **Wave 6 & 7** are either deferred (god-files need careful refactor) or one-off (recipe modal state bug).

---

## Path-drift footnote (important context for the next wave session)

**Every single Wave-2 and Wave-3 subagent reported significant path drift between the Vibeman context `filePaths` and the actual repository layout.** The naming in the context manager is stale — most listed paths don't exist as written. The subagents adapted (grep for feature name → scan actual location → document drift at top of each per-context report), but this means:

1. **Every per-context report has a "Path drift" block at the top** noting where the real code lives.
2. **The Vibeman context filePaths need a refresh pass.** This is a project-management task, not a code-refactor finding — but it's worth flagging because future audits will keep re-discovering it.
3. **Two key cross-cutting layout facts** observed by multiple subagents:
   - **Observability dashboards** all live under `src/features/overview/sub_*` (NOT `src/features/{analytics,sla,usage,...}`).
   - **Communication & resources are split** in src-tauri: `commands/communication/` for events/SLA, `db/repos/resources/` for triggers/recipes/credentials, `db/repos/communication/` for events/chat.

---

## How this scan was run

- **Scanner**: `code-refactor` agent prompt from `vibeman/src/lib/prompts/registry/agents/code-refactor.ts` (focus: dead code, duplication, structure, cruft).
- **Date**: 2026-05-12.
- **Project**: Personas (Tauri 2 desktop app, React + TypeScript + Rust, ~1500 source files).
- **Dispatch**: 23 parallel `general-purpose` subagents (1 per Vibeman context, "x" context skipped as garbage), in 3 waves of 8/8/7. Each subagent ran in isolation, wrote one `.md` file, and replied with a terse <150-word summary.
- **Files read by subagents**: ~600+ across all reports (per-subagent range: 14–50 files in detail + targeted greps).
- **Verification**: findings count cross-checked two ways (`^- \*\*Severity\*\*:` bullets vs `^> Total:` header sums) — both = 249. ✓
- **Baseline preserved**: `tsc --noEmit` 0 errors, `cargo check` 0 errors, lint 0 errors (warnings unchanged). See [BASELINE.md](./BASELINE.md).
