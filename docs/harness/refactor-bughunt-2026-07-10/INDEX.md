# Refactor + Bug-Hunt Dual-Lens Scan — Personas, 2026-07-10

> Dual-lens audit (bug-hunter + code-refactor) over a 69-context risk slice of the rebuilt 227-context map.
> 69 parallel subagent runs, ~5 findings per lens per context. Backend (Rust/Tauri) + frontend (React/TS), full-stack.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 69 contexts | 0 | 41 | 261 | 266 | **568** |
| Share | 0% | 7% | 46% | 47% | 100% |

Lens split: 298 bug-hunter / 270 code-refactor. Severity discipline was conservative — scanners reserved *critical* for proven data-loss/RCE and rated the security sinks below as **High**; several (SSRF, MCP auto-spawn, CRLF injection, auth-gaps) are critical-class by impact and are triaged first.

---

## Per-group breakdown

| Group | Contexts | High | Med | Low | Total |
|---|---:|---:|---:|---:|---:|
| Backend Data & Commands | 12 | 9 | 52 | 39 | 100 |
| Backend Engine & Runtime | 9 | 8 | 38 | 31 | 77 |
| Persona Authoring & Design | 3 | 5 | 12 | 13 | 30 |
| Observability & Monitoring | 6 | 5 | 20 | 25 | 50 |
| Plugins & Companion | 5 | 5 | 19 | 20 | 44 |
| Credentials & Connectors | 7 | 5 | 27 | 20 | 52 |
| Shared UI & Design System | 4 | 2 | 18 | 14 | 34 |
| Execution & Orchestration | 9 | 1 | 35 | 39 | 75 |
| Core Libraries & State | 10 | 1 | 30 | 39 | 70 |
| Templates & Recipes | 2 | 1 | 9 | 9 | 19 |
| App Shell, Settings & Sharing | 2 | 0 | 8 | 9 | 17 |

---

## Per-context breakdown

| Context | Group | H | M | L | Total | Report |
|---|---|---:|---:|---:|---:|---|
| agents-use-cases-1-2 | Persona Authoring & Design | 3 | 4 | 3 | 10 | [md](agents-use-cases-1-2.md) |
| tauri-companion-misc | Plugins & Companion | 2 | 5 | 3 | 10 | [md](tauri-companion-misc.md) |
| overview-observability-1-2 | Observability & Monitoring | 2 | 3 | 4 | 9 | [md](overview-observability-1-2.md) |
| tauri-engine-6-10 | Backend Engine & Runtime | 2 | 3 | 3 | 8 | [md](tauri-engine-6-10.md) |
| agents-components-1-2 | Persona Authoring & Design | 1 | 4 | 5 | 10 | [md](agents-components-1-2.md) |
| agents-glyph-1-2 | Persona Authoring & Design | 1 | 4 | 5 | 10 | [md](agents-glyph-1-2.md) |
| fleet-monitor | Observability & Monitoring | 1 | 3 | 6 | 10 | [md](fleet-monitor.md) |
| tauri-commands-credentials-1-2 | Backend Data & Commands | 1 | 5 | 4 | 10 | [md](tauri-commands-credentials-1-2.md) |
| tauri-commands-infrastructure-1-3 | Backend Data & Commands | 1 | 5 | 4 | 10 | [md](tauri-commands-infrastructure-1-3.md) |
| templates-n8n-1-2 | Templates & Recipes | 1 | 5 | 4 | 10 | [md](templates-n8n-1-2.md) |
| vault-databases-1-2 | Credentials & Connectors | 1 | 7 | 2 | 10 | [md](vault-databases-1-2.md) |
| lib-utils-1-2 | Core Libraries & State | 1 | 4 | 4 | 9 | [md](lib-utils-1-2.md) |
| plugins-companion-1-4 | Plugins & Companion | 1 | 5 | 3 | 9 | [md](plugins-companion-1-4.md) |
| tauri-commands-design-1-2 | Backend Data & Commands | 1 | 4 | 4 | 9 | [md](tauri-commands-design-1-2.md) |
| tauri-engine-2-10 | Backend Engine & Runtime | 1 | 6 | 2 | 9 | [md](tauri-engine-2-10.md) |
| tauri-engine-3-10 | Backend Engine & Runtime | 1 | 5 | 3 | 9 | [md](tauri-engine-3-10.md) |
| tauri-engine-4-10 | Backend Engine & Runtime | 1 | 5 | 3 | 9 | [md](tauri-engine-4-10.md) |
| tauri-engine-build-session | Backend Engine & Runtime | 1 | 5 | 3 | 9 | [md](tauri-engine-build-session.md) |
| tauri-engine-misc-2 | Backend Engine & Runtime | 1 | 4 | 4 | 9 | [md](tauri-engine-misc-2.md) |
| overview-incidents | Observability & Monitoring | 1 | 3 | 4 | 8 | [md](overview-incidents.md) |
| shared-chrome | Shared UI & Design System | 1 | 4 | 3 | 8 | [md](shared-chrome.md) |
| shared-components-2-4 | Shared UI & Design System | 1 | 4 | 3 | 8 | [md](shared-components-2-4.md) |
| tauri-commands-core | Backend Data & Commands | 1 | 4 | 3 | 8 | [md](tauri-commands-core.md) |
| tauri-commands-misc-2 | Backend Data & Commands | 1 | 5 | 2 | 8 | [md](tauri-commands-misc-2.md) |
| tauri-commands-misc | Backend Data & Commands | 1 | 3 | 4 | 8 | [md](tauri-commands-misc.md) |
| tauri-companion-brain-1-2 | Plugins & Companion | 1 | 4 | 3 | 8 | [md](tauri-companion-brain-1-2.md) |
| tauri-db-models-1-4 | Backend Data & Commands | 1 | 3 | 4 | 8 | [md](tauri-db-models-1-4.md) |
| tauri-engine-misc | Backend Engine & Runtime | 1 | 3 | 4 | 8 | [md](tauri-engine-misc.md) |
| triggers-misc-2 | Execution & Orchestration | 1 | 4 | 3 | 8 | [md](triggers-misc-2.md) |
| vault-credentials-1-4 | Credentials & Connectors | 1 | 3 | 4 | 8 | [md](vault-credentials-1-4.md) |
| tauri-companion | Plugins & Companion | 1 | 2 | 4 | 7 | [md](tauri-companion.md) |
| tauri-db-misc | Backend Data & Commands | 1 | 4 | 2 | 7 | [md](tauri-db-misc.md) |
| vault-credentials-2-4 | Credentials & Connectors | 1 | 4 | 2 | 7 | [md](vault-credentials-2-4.md) |
| vault-shared-1-3 | Credentials & Connectors | 1 | 3 | 3 | 7 | [md](vault-shared-1-3.md) |
| overview-observability-2-2 | Observability & Monitoring | 1 | 3 | 2 | 6 | [md](overview-observability-2-2.md) |
| tauri-db | Backend Data & Commands | 1 | 2 | 3 | 6 | [md](tauri-db.md) |
| vault-catalog-2-5 | Credentials & Connectors | 1 | 4 | 1 | 6 | [md](vault-catalog-2-5.md) |
| plugins-dev-tools-1-3 | Plugins & Companion | 0 | 3 | 7 | 10 | [md](plugins-dev-tools-1-3.md) |
| shared-components-1-4 | Shared UI & Design System | 0 | 6 | 4 | 10 | [md](shared-components-1-4.md) |
| tauri-db-repos-1-6 | Backend Data & Commands | 0 | 8 | 2 | 10 | [md](tauri-db-repos-1-6.md) |
| triggers-misc | Execution & Orchestration | 0 | 4 | 6 | 10 | [md](triggers-misc.md) |
| home-cockpit | App Shell, Settings & Sharing | 0 | 5 | 4 | 9 | [md](home-cockpit.md) |
| overview-misc | Observability & Monitoring | 0 | 5 | 4 | 9 | [md](overview-misc.md) |
| tauri-commands-companion-1-2 | Backend Data & Commands | 0 | 4 | 5 | 9 | [md](tauri-commands-companion-1-2.md) |
| tauri-engine-1-10 | Backend Engine & Runtime | 0 | 5 | 4 | 9 | [md](tauri-engine-1-10.md) |
| teams-teamworkspace-1-2 | Execution & Orchestration | 0 | 6 | 3 | 9 | [md](teams-teamworkspace-1-2.md) |
| templates-generated-1-5 | Templates & Recipes | 0 | 4 | 5 | 9 | [md](templates-generated-1-5.md) |
| triggers-triggers-1-3 | Execution & Orchestration | 0 | 4 | 5 | 9 | [md](triggers-triggers-1-3.md) |
| agents-executions-1-4 | Execution & Orchestration | 0 | 3 | 5 | 8 | [md](agents-executions-1-4.md) |
| lib-1-2 | Core Libraries & State | 0 | 3 | 5 | 8 | [md](lib-1-2.md) |
| overview-misc-2 | Observability & Monitoring | 0 | 3 | 5 | 8 | [md](overview-misc-2.md) |
| settings-misc | App Shell, Settings & Sharing | 0 | 3 | 5 | 8 | [md](settings-misc.md) |
| shared-glyph-1-2 | Shared UI & Design System | 0 | 4 | 4 | 8 | [md](shared-glyph-1-2.md) |
| stores-slices-1-3 | Core Libraries & State | 0 | 3 | 5 | 8 | [md](stores-slices-1-3.md) |
| stores-slices-2-3 | Core Libraries & State | 0 | 3 | 5 | 8 | [md](stores-slices-2-3.md) |
| teams-factory-1-3 | Execution & Orchestration | 0 | 5 | 3 | 8 | [md](teams-factory-1-3.md) |
| teams-goals-1-2 | Execution & Orchestration | 0 | 4 | 4 | 8 | [md](teams-goals-1-2.md) |
| teams-misc | Execution & Orchestration | 0 | 3 | 5 | 8 | [md](teams-misc.md) |
| agents-executions-2-4 | Execution & Orchestration | 0 | 2 | 5 | 7 | [md](agents-executions-2-4.md) |
| api-misc-2 | Core Libraries & State | 0 | 3 | 4 | 7 | [md](api-misc-2.md) |
| api | Core Libraries & State | 0 | 3 | 4 | 7 | [md](api.md) |
| stores-slices-3-3 | Core Libraries & State | 0 | 4 | 3 | 7 | [md](stores-slices-3-3.md) |
| stores | Core Libraries & State | 0 | 3 | 4 | 7 | [md](stores.md) |
| tauri-db-repos-2-6 | Backend Data & Commands | 0 | 5 | 2 | 7 | [md](tauri-db-repos-2-6.md) |
| tauri-engine-5-10 | Backend Engine & Runtime | 0 | 2 | 5 | 7 | [md](tauri-engine-5-10.md) |
| vault-catalog-1-5 | Credentials & Connectors | 0 | 3 | 4 | 7 | [md](vault-catalog-1-5.md) |
| vault-catalog-3-5 | Credentials & Connectors | 0 | 3 | 4 | 7 | [md](vault-catalog-3-5.md) |
| api-misc | Core Libraries & State | 0 | 2 | 3 | 5 | [md](api-misc.md) |
| api-agents | Core Libraries & State | 0 | 2 | 2 | 4 | [md](api-agents.md) |

---

## All 41 High findings — one-line summaries (triage order)

### A. Security / trust boundary (8)
- **[tauri-commands-core]** 1. `generate_persona_icon` decrypts vault secrets and bills an external API with no auth gate  
  `src-tauri/src/commands/core/persona_icon_gen.rs:69-129 (also list_image_gen_credentials:69-84)`
- **[tauri-commands-credentials-1-2]** 1. `openapi_parse_from_url` is a server-side request forgery (SSRF) sink  
  `src-tauri/src/commands/credentials/openapi_autopilot.rs:640-682`
- **[tauri-commands-misc]** 1. Media-studio persistence commands lack the auth/privileged gate every sibling artist command carries  
  `src-tauri/src/commands/artist/persistence.rs:76-101, 106-147, 151-176, 234-243`
- **[tauri-companion-misc]** 1. Gmail send_message allows CRLF header injection via `to`/`subject`  
  `src-tauri/src/companion/jobs/connector_use.rs:697-709`
- **[tauri-engine-2-10]** 1. Bundle import hard-codes `signature_verified: true` and ignores `expected_bundle_hash` (TOCTOU mitigation not implemented in apply)  
  `src-tauri/src/engine/bundle.rs:166-168, 391-508 (esp. 396, 469-476)`
- **[tauri-engine-4-10]** 1. KPI procedure execution has no SSRF protection  
  `src-tauri/src/engine/kpi_binding.rs:286-317 (execute_procedure)`
- **[tauri-engine-6-10]** 1. Project-local `.claude/settings.json` MCP servers are auto-spawned with no consent/allowlist  
  `src-tauri/src/engine/cli_mcp_config.rs:230-234, 259-290`
- **[vault-databases-1-2]** 1. Redis `TYPE ${key}` interpolates the key name raw into a command string  
  `src/features/vault/sub_databases/tabs/TablesTab.tsx:37`

### B. Crash / panic (4)
- **[tauri-companion]** 1. Byte-slice panic when truncating a persona failure message with multibyte UTF-8  
  `src-tauri/src/companion/observability.rs:222-227`
- **[tauri-engine-6-10]** 2. `body_preview` byte-slice panics on non-ASCII poll responses  
  `src-tauri/src/engine/polling.rs:305`
- **[tauri-engine-misc-2]** 1. Byte-boundary panic truncating persona prompt content in advisory mode  
  `src-tauri/src/engine/prompt/advisory.rs:50-54, 66-72`
- **[templates-n8n-1-2]** 1. N8nQuestionStepper crashes when the questions array shrinks under a stale activeIndex  
  `src/features/templates/sub_n8n/widgets/N8nQuestionStepper.tsx:68-70,132-171`

### C. Money / model correctness (3)
- **[agents-use-cases-1-2]** 1. Selecting the "Opus" model override silently runs Sonnet  
  `src/features/agents/sub_use_cases/libs/useCaseDetailHelpers.ts:25, 63-67`
- **[agents-use-cases-1-2]** 2. "Run now" on the capability tab bar double-spends and bypasses the budget gate  
  `src/features/agents/sub_use_cases/components/persona-layout/PersonaLayoutView.tsx:224-246`
- **[tauri-commands-infrastructure-1-3]** 1. Offline session breaks when a prior access token is still present  
  `src-tauri/src/commands/infrastructure/auth.rs:728-745 (with 91-101)`

### D. Persistence / state corruption (6)
- **[agents-glyph-1-2]** 1. useComposeConfig silently discards connector table-scope  
  `src/features/agents/sub_glyph/useComposeConfig.tsx:252-257 (connectors modal) + :123-128 (quick-config emit)`
- **[tauri-companion-brain-1-2]** 1. `ensure_vec_table` Once permanently swallows a first-call failure → whole-process retrieval silently returns nothing  
  `src-tauri/src/companion/brain/embeddings.rs:34-51 (impact at 98-125)`
- **[tauri-db-misc]** 1. persona_triggers chain-migration rebuild drops the table with FK enforcement ON — nulls every execution's trigger_id  
  `src-tauri/src/db/migrations/incremental.rs:309-337 (the `needs_chain_migration` block)`
- **[tauri-db-models-1-4]** 1. `parse_design_context` silently drops `dev_project_id` / `connector_pipeline` / `archetype_id` / `memory_strategy_id`  
  `src-tauri/src/db/models/persona.rs:642-715 (new-format guard at 649-659)`
- **[tauri-db]** 1. `AUTONOMOUS_DELIBERATION` key is read by the engine but absent from `ALLOWED_KEYS` — the feature can never be turned on  
  `src-tauri/src/db/settings_keys.rs:319-321, 538-606`
- **[tauri-engine-misc]** 1. Fallback credential resolution poisons `seen_connectors`, silently skipping later tools' connectors  
  `src-tauri/src/engine/runner/credentials.rs:70-171`

### E. Races / stale data (6)
- **[agents-use-cases-1-2]** 3. Concurrent policy toggles drop each other's change (lost update)  
  `src/features/agents/sub_use_cases/components/recipes-prototype/shared/usePolicyControls.ts:60-100`
- **[overview-incidents]** 1. In-flight guard silently drops a filter-change refetch (stale list for up to 30s)  
  `src/features/overview/sub_incidents/libs/useIncidentsData.ts:31-62`
- **[shared-components-2-4]** 1. AnimatedList re-creates its motion wrappers every render → children remount on every update  
  `src/features/shared/components/display/AnimatedList.tsx:90-113`
- **[tauri-commands-misc-2]** 1. `test_automation_webhook` bypasses both the runnable-status check and the in-flight guard  
  `src-tauri/src/commands/tools/automations.rs:170-192 (vs. 137-168)`
- **[triggers-misc-2]** 1. useSharedEvents.load has no stale-response guard — out-of-order loads clobber the catalog  
  `src/features/triggers/sub_shared/useSharedEvents.ts:25-45`
- **[vault-credentials-2-4]** 1. initialValues effect clobbers in-progress user edits  
  `src/features/vault/sub_credentials/components/forms/CredentialEditForm.tsx:71-74`

### F. Silent-failure / honesty (7)
- **[agents-components-1-2]** 1. Test marked "passed" when every tool was skipped (success theater)  
  `src/features/agents/components/matrix/useLifecycle.ts:143-152`
- **[fleet-monitor]** 1. Fabricated "Active goals" with fake progress shown as real data  
  `src/features/fleet/monitor/triage/triageModel.ts:70-102, src/features/fleet/monitor/triage/MonitorProjectColumns.tsx:114,146-163`
- **[lib-utils-1-2]** 1. JSON template variables are silently truncated to 2000 chars, producing malformed JSON  
  `src/lib/utils/sanitizers/variableSanitizer.ts:204-207, 288-347`
- **[overview-observability-1-2]** 2. Live healing stream listens on the wrong persona when "All personas" is selected  
  `src/features/overview/sub_observability/components/ObservabilityDashboard.tsx:95 ; src/features/overview/sub_observability/libs/useHealingPanelState.ts:33`
- **[shared-chrome]** 1. Command-mode keyboard selection executes the wrong row  
  `src/features/shared/chrome/CommandPalette.tsx:213-378 (esp. 218-223, 352-378) + CommandPaletteResults.tsx:78-87`
- **[tauri-commands-design-1-2]** 1. Large workflows are silently truncated to 50 KB before the LLM sees them  
  `src-tauri/src/commands/design/n8n_transform/prompt_sanitizer.rs:23, prompts.rs:307-309,414-424`
- **[tauri-companion-misc]** 2. STT model download finalizes a truncated file as "complete" (no size/integrity check)  
  `src-tauri/src/companion/stt/downloader.rs:158-201`

### G. UI correctness / other (7)
- **[overview-observability-1-2]** 1. Resolve button in issue list also opens the detail modal (event bubbles)  
  `src/features/overview/sub_observability/components/IssuesList.tsx:55-107`
- **[overview-observability-2-2]** 1. Alert toast auto-dismiss timer resets on every container re-render  
  `src/features/overview/sub_observability/components/AlertToastContainer.tsx:19-22, 52-54`
- **[plugins-companion-1-4]** 5. KokoroVoicePanel and PocketVoicePanel duplicate the entire setup/install/preview scaffold  
  `src/features/plugins/companion/sub_voice/KokoroVoicePanel.tsx:141-514 · src/features/plugins/companion/sub_voice/PocketVoicePanel.tsx:377-787`
- **[tauri-engine-build-session]** 1. Fan-out sub-agent lanes have no timeout and no mid-fan-out cancellation — a hung CLI stalls the whole multi-agent build forever  
  `src-tauri/src/engine/build_session/fanout.rs:108-183, 407-440, 727-767`
- **[vault-catalog-2-5]** 1. Setup-progress restore corrupts state when instructions change (e.g. on refine)  
  `src/features/vault/sub_catalog/components/design/setup/InteractiveSetupInstructions.tsx:37-63`
- **[vault-credentials-1-4]** 1. Chained resource picker keeps stale item list after a parent pick changes  
  `src/features/vault/sub_credentials/components/picker/ResourcePicker.tsx:121-142, 111-119`
- **[vault-shared-1-3]** 1. Remediation casing mismatch defeats fast-path skip and reason messages  
  `src/features/vault/shared/hooks/health/useRemediationEvaluator.ts:80,179-196`

---

## Triage themes (recurring cross-context patterns)

| Theme | Approx | Why it's a wave |
|---|---:|---|
| SSRF-guard / auth-gate inconsistency | ~8 High | Outbound HTTP + privileged Tauri commands each have a *safe* sibling and an *unguarded* one (openapi_parse, KPI exec, fetch_share_link, share redirect, IPv6-loopback bypass; generate_persona_icon, artist persistence, test_automation_webhook). One consistent guard closes the class. |
| UTF-8 byte-slice truncation panics | ~10 (H+M) | `&s[..n]` slices by bytes across engine/companion/advisory/openai/tools. A char-safe helper already exists in `transcript.rs` — route all callers to it. |
| `Once`/`OnceLock` caches transient failure | 2+ High | crypto.rs keychain + embeddings ensure_vec_table both record 'ran' not 'succeeded' → permanent silent brick. Same fix shape. |
| Duplicated JSON/brace extractors | ~8 | 5+ divergent brace-balanced JSON scanners across engine modules; consolidate to one. |
| ts-rs enum casing drift (Pascal vs snake) | several | Frontend string-compares against Rust-serialized enums (Remediation, healing severity) — fast-paths silently never fire. |
| UTC-stored timestamp parsed/compared as local | ~6 | fleet factoryData, companion digests, incidents, teams — 'Xh ago'/'last N days' skew at day boundary; sibling code already uses julianday()/UTC. |
| Stale-response / in-flight guard missing | ~8 | overview-incidents, triggers useSharedEvents, vault pickers — a sibling hook has the `alive`/latch guard the buggy one lacks. |
| Silent-failure / success-theater | 70 (cat) | Swallowed errors, hardcoded success flags, fabricated data shown as real (fleet goals), health 'passed' without test. |
| Duplication (code-refactor) | 161 (cat) | Largest category: duplicated mappers, formatters, panels, CLI-spawn scaffolds, status-color scales. Consolidation waves. |
| Dead code | 96 (cat) | Unwired components, dead exports, orphaned dirs (schedule/, sub_cron_agents dup). Some hide latent bugs / security drift. |

---

## Suggested fix-wave split

| Wave | Scope | Approx findings |
|---|---|---:|
| Wave 1 — Security & trust boundary | Close the SSRF/auth-gate/injection class: unify outbound HTTP behind the SSRF-safe client (openapi_parse, KPI exec, share redirect, IPv6-loopback); add the missing `#[requires(privileged)]`/sandbox to generate_persona_icon + artist persistence + test_automation_webhook; fix Gmail CRLF header injection + Redis raw-key interpolation + driveRename `..`; gate the auto-spawned `.claude/settings.json` MCP servers; stop hardcoding `signature_verified:true`. | ~12 |
| Wave 2 — Crash / panic elimination | Route every `&s[..n]` truncation to the char-safe helper in transcript.rs; fix the `Once`-swallows-failure pattern (crypto + ensure_vec_table); N8nQuestionStepper / DimensionPanel remount + clamp crashes. | ~12 |
| Wave 3 — Persistence & state integrity | persona_triggers FK-on migration nulls trigger_id; ALLOWED_KEYS missing AUTONOMOUS_DELIBERATION; parse_design_context dropped fields; table-scope over-grant; connector `seen` poisoning; credential migration gaps. | ~10 |
| Wave 4 — Money & model correctness | Opus-override-runs-Sonnet; Run-now double-spend + budget bypass; executePersona idempotency; cost-sigma mislabel; token/cost formatters. | ~7 |
| Wave 5 — Races & stale data | Add the missing `alive`/in-flight guards (incidents, useSharedEvents, vault pickers, cloud-sync poll); timezone UTC-vs-local skew across fleet/companion/incidents; optimistic-update rollback gaps. | ~12 |
| Wave 6 — Silent-failure / honesty | Fabricated fleet goals; success-theater test/health flags; swallowed errors with no UI; workflow 50KB/2000-char silent truncation. | ~10 |
| Wave 7+ — Duplication & dead-code consolidation | The 161 duplication + 96 dead-code findings: shared truncation/JSON/formatter helpers, unify DataGrid/UnifiedTable, delete orphaned dirs (schedule/, dup sub_cron_agents), consolidate status-color scales. Batchable by module. | ~250 |

---

## How this scan was run

- **Scanners**: bug-hunter + code-refactor (Vibeman prompt registry), run as one dual-lens subagent per context.
- **Scope**: 69-context risk slice (backend engine/db/commands/vault + frontend stores/api/hooks/teams/shared/triggers/overview) of the rebuilt 227-context map. ~1,300 files, ~480 kLOC.
- **Map rebuild**: the prior 22-context map (2026-05-23) covered ~8% of source with 24 dead refs; replaced with 227 contexts / 12 groups / 100% of 3,566 non-generated source files. Audit: 0 uncategorized / 0 overlap / 0 missing / 0 stale.
- **Findings**: 568 total (0C / 41H / 261M / 266L), verified two ways (header-sum == severity-bullet-count == 568).
- **Dates**: converted to absolute where given. Reports in this directory, one per context.
