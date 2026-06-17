# Test Mastery Scan — personas, 2026-06-17

> Risk-weighted test-coverage & automated-suite-quality audit (test_mastery scanner).
> 52 parallel subagent runs across all 12 context groups, full-stack (TypeScript/vitest + Rust/cargo), batched in waves of 8.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 52 contexts | 77 | 162 | 98 | 44 | **381** |
| Share | 20% | 43% | 26% | 12% | 100% |

**Count verified two ways:** severity-bullets = 381, finding-headings = 381 (match). One report (`companion-runtime-chat`) omits the `0 low` term in its header line; bullet/heading counts confirm 7 findings.

---

## By context group (sorted by criticals)

| Group | Ctx | Critical | High | Medium | Low | Total |
|---|---:|---:|---:|---:|---:|---:|
| Credential Vault & Connectors | 5 | 10 | 14 | 10 | 3 | 37 |
| First-Party Plugins | 6 | 8 | 19 | 11 | 6 | 44 |
| Execution Engine | 5 | 8 | 14 | 10 | 5 | 37 |
| Teams & Fleet Orchestration | 4 | 7 | 12 | 6 | 4 | 29 |
| Data & Persistence | 3 | 7 | 10 | 3 | 2 | 22 |
| Observability & Analytics | 5 | 6 | 16 | 10 | 3 | 35 |
| Persona & Agent Studio | 4 | 6 | 12 | 7 | 4 | 29 |
| Templates & Recipes | 4 | 6 | 11 | 7 | 5 | 29 |
| Triggers & Events | 3 | 6 | 10 | 5 | 2 | 23 |
| Athena Companion | 4 | 5 | 13 | 9 | 2 | 29 |
| Platform Foundation | 5 | 4 | 17 | 11 | 4 | 36 |
| Onboarding, Home & Settings | 4 | 4 | 14 | 9 | 4 | 31 |

---

## Per-context breakdown (sorted by criticals, then total)

| # | Context | Group | C | H | M | L | Total | Report |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | MCP Gateways & Tools | Credential Vault & Connectors | 3 | 3 | 1 | 1 | 8 | [`mcp-gateways-tools.md`](./mcp-gateways-tools.md) |
| 2 | OAuth, API Proxy & Foraging | Credential Vault & Connectors | 3 | 3 | 2 | 0 | 8 | [`oauth-api-proxy-foraging.md`](./oauth-api-proxy-foraging.md) |
| 3 | Crypto & Secure Storage | Data & Persistence | 3 | 3 | 1 | 0 | 7 | [`crypto-secure-storage.md`](./crypto-secure-storage.md) |
| 4 | Approvals & Decisions | Athena Companion | 2 | 3 | 2 | 1 | 8 | [`approvals-decisions.md`](./approvals-decisions.md) |
| 5 | Build Sessions & PersonaMatrix | Templates & Recipes | 2 | 3 | 2 | 1 | 8 | [`build-sessions-personamatrix.md`](./build-sessions-personamatrix.md) |
| 6 | Capabilities, Use Cases & Model Config | Persona & Agent Studio | 2 | 3 | 2 | 1 | 8 | [`capabilities-use-cases-model-config.md`](./capabilities-use-cases-model-config.md) |
| 7 | Genome & Evolution | Execution Engine | 2 | 3 | 2 | 1 | 8 | [`genome-evolution.md`](./genome-evolution.md) |
| 8 | Personas Twin | First-Party Plugins | 2 | 3 | 2 | 1 | 8 | [`personas-twin.md`](./personas-twin.md) |
| 9 | Pipeline & Agent Chains | Teams & Fleet Orchestration | 2 | 3 | 2 | 1 | 8 | [`pipeline-agent-chains.md`](./pipeline-agent-chains.md) |
| 10 | Repositories & Models | Data & Persistence | 2 | 4 | 1 | 1 | 8 | [`repositories-models.md`](./repositories-models.md) |
| 11 | Triggers & Event Registry | Triggers & Events | 2 | 3 | 2 | 1 | 8 | [`triggers-event-registry.md`](./triggers-event-registry.md) |
| 12 | Webhooks & Channel Pollers | Triggers & Events | 2 | 4 | 1 | 1 | 8 | [`webhooks-channel-pollers.md`](./webhooks-channel-pollers.md) |
| 13 | Agent Lab & Versions | Persona & Agent Studio | 2 | 3 | 1 | 1 | 7 | [`agent-lab-versions.md`](./agent-lab-versions.md) |
| 14 | Companion Brain & Proactivity | Athena Companion | 2 | 3 | 1 | 1 | 7 | [`companion-brain-proactivity.md`](./companion-brain-proactivity.md) |
| 15 | Credential Vault CRUD | Credential Vault & Connectors | 2 | 3 | 2 | 0 | 7 | [`credential-vault-crud.md`](./credential-vault-crud.md) |
| 16 | Database Schema & Migrations | Data & Persistence | 2 | 3 | 1 | 1 | 7 | [`database-schema-migrations.md`](./database-schema-migrations.md) |
| 17 | Execution Runner & Inspector | Execution Engine | 2 | 3 | 1 | 1 | 7 | [`execution-runner-inspector.md`](./execution-runner-inspector.md) |
| 18 | Knowledge Base & Memories | Observability & Analytics | 2 | 3 | 2 | 0 | 7 | [`knowledge-base-memories.md`](./knowledge-base-memories.md) |
| 19 | Messages & Notifications | Triggers & Events | 2 | 3 | 2 | 0 | 7 | [`messages-notifications.md`](./messages-notifications.md) |
| 20 | Obsidian Brain | First-Party Plugins | 2 | 3 | 1 | 1 | 7 | [`obsidian-brain.md`](./obsidian-brain.md) |
| 21 | Persona Templates | Templates & Recipes | 2 | 3 | 1 | 1 | 7 | [`persona-templates.md`](./persona-templates.md) |
| 22 | Self-Healing & Auto-Rollback | Execution Engine | 2 | 2 | 2 | 1 | 7 | [`self-healing-auto-rollback.md`](./self-healing-auto-rollback.md) |
| 23 | Settings & BYOM | Onboarding, Home & Settings | 2 | 3 | 1 | 1 | 7 | [`settings-byom.md`](./settings-byom.md) |
| 24 | Team Assignment & Handoff | Teams & Fleet Orchestration | 2 | 3 | 1 | 1 | 7 | [`team-assignment-handoff.md`](./team-assignment-handoff.md) |
| 25 | Team Builder & Workspace | Teams & Fleet Orchestration | 2 | 3 | 1 | 1 | 7 | [`team-builder-workspace.md`](./team-builder-workspace.md) |
| 26 | Cloud Sync & Deployment | Onboarding, Home & Settings | 1 | 4 | 2 | 1 | 8 | [`cloud-sync-deployment.md`](./cloud-sync-deployment.md) |
| 27 | Director & Leadership | Execution Engine | 1 | 3 | 3 | 1 | 8 | [`director-leadership.md`](./director-leadership.md) |
| 28 | Google Drive | First-Party Plugins | 1 | 4 | 2 | 1 | 8 | [`google-drive.md`](./google-drive.md) |
| 29 | Home & Roadmap | Onboarding, Home & Settings | 1 | 3 | 3 | 1 | 8 | [`home-roadmap.md`](./home-roadmap.md) |
| 30 | Shared UI Component Library | Platform Foundation | 1 | 3 | 3 | 1 | 8 | [`shared-ui-component-library.md`](./shared-ui-component-library.md) |
| 31 | Agent Chat | Persona & Agent Studio | 1 | 3 | 2 | 1 | 7 | [`agent-chat.md`](./agent-chat.md) |
| 32 | Analytics, SLA & Usage | Observability & Analytics | 1 | 3 | 2 | 1 | 7 | [`analytics-sla-usage.md`](./analytics-sla-usage.md) |
| 33 | Artist Studio | First-Party Plugins | 1 | 3 | 2 | 1 | 7 | [`artist-studio.md`](./artist-studio.md) |
| 34 | Companion Runtime & Chat | Athena Companion | 1 | 3 | 3 | 0 | 7 | [`companion-runtime-chat.md`](./companion-runtime-chat.md) |
| 35 | Connector Catalog | Credential Vault & Connectors | 1 | 2 | 3 | 1 | 7 | [`connector-catalog.md`](./connector-catalog.md) |
| 36 | Credential Design & Negotiation | Credential Vault & Connectors | 1 | 3 | 2 | 1 | 7 | [`credential-design-negotiation.md`](./credential-design-negotiation.md) |
| 37 | Dashboard & Mission Control | Observability & Analytics | 1 | 3 | 2 | 1 | 7 | [`dashboard-mission-control.md`](./dashboard-mission-control.md) |
| 38 | Design Reviews & Diagrams | Templates & Recipes | 1 | 3 | 2 | 1 | 7 | [`design-reviews-diagrams.md`](./design-reviews-diagrams.md) |
| 39 | Dev Tools & Context Map | First-Party Plugins | 1 | 3 | 2 | 1 | 7 | [`dev-tools-context-map.md`](./dev-tools-context-map.md) |
| 40 | Error Handling, Hooks & Utilities | Platform Foundation | 1 | 4 | 2 | 0 | 7 | [`error-handling-hooks-utilities.md`](./error-handling-hooks-utilities.md) |
| 41 | Fleet Control | Teams & Fleet Orchestration | 1 | 3 | 2 | 1 | 7 | [`fleet-control.md`](./fleet-control.md) |
| 42 | Incidents & Manual Review | Observability & Analytics | 1 | 3 | 2 | 1 | 7 | [`incidents-manual-review.md`](./incidents-manual-review.md) |
| 43 | Internationalization (i18n) | Platform Foundation | 1 | 3 | 2 | 1 | 7 | [`internationalization-i18n.md`](./internationalization-i18n.md) |
| 44 | Observability & Alerts | Observability & Analytics | 1 | 4 | 2 | 0 | 7 | [`observability-alerts.md`](./observability-alerts.md) |
| 45 | Persona Editor & CRUD | Persona & Agent Studio | 1 | 3 | 2 | 1 | 7 | [`persona-editor-crud.md`](./persona-editor-crud.md) |
| 46 | Recipes & Use-Case Blueprints | Templates & Recipes | 1 | 2 | 2 | 2 | 7 | [`recipes-use-case-blueprints.md`](./recipes-use-case-blueprints.md) |
| 47 | Research Lab | First-Party Plugins | 1 | 3 | 2 | 1 | 7 | [`research-lab.md`](./research-lab.md) |
| 48 | Scheduler & Cron Agents | Execution Engine | 1 | 3 | 2 | 1 | 7 | [`scheduler-cron-agents.md`](./scheduler-cron-agents.md) |
| 49 | Tauri IPC Bridge & API | Platform Foundation | 1 | 3 | 2 | 1 | 7 | [`tauri-ipc-bridge-api.md`](./tauri-ipc-bridge-api.md) |
| 50 | Onboarding Tour | Onboarding, Home & Settings | 0 | 4 | 3 | 1 | 8 | [`onboarding-tour.md`](./onboarding-tour.md) |
| 51 | Cockpit, Voice & Sensory | Athena Companion | 0 | 4 | 3 | 0 | 7 | [`cockpit-voice-sensory.md`](./cockpit-voice-sensory.md) |
| 52 | State Management (Zustand) | Platform Foundation | 0 | 4 | 2 | 1 | 7 | [`state-management-zustand.md`](./state-management-zustand.md) |

---

## All 77 critical findings (themed)

Each links to its full entry in the per-context report.

### A. Security / auth / boundary guards (22)
1. **Build Sessions & PersonaMatrix** — promote_build_draft exclusion filtering (use_cases ↔ triggers alignment) is untested  ·  `src-tauri/src/commands/design/build_sessions.rs:2594-2646 (filter), build_structured_use_cases:1074-1168, create_triggers_in_tx:1977-2065`  ·  [report](./build-sessions-personamatrix.md)
2. **Build Sessions & PersonaMatrix** — test_build_draft / promote phase compare-and-set (concurrent-claim guard) has no test  ·  `src-tauri/src/commands/design/build_sessions.rs:702-726 (CAS claim), 2466-2469 + 2476-2499 (promote validate_transition + agent_ir retry)`  ·  [report](./build-sessions-personamatrix.md)
3. **Capabilities, Use Cases & Model Config** — Capability cascade rollback (`rename_event_listeners`, partial-write atomicity) has no test  ·  `src-tauri/src/commands/core/use_cases.rs:490-578 (also 427-462)`  ·  [report](./capabilities-use-cases-model-config.md)
4. **Crypto & Secure Storage** — Capability gate (`desktop_security.rs`) has ZERO tests — path-traversal / ADS / binary-allowlist bypass slips through  ·  `src-tauri/src/engine/desktop_security.rs:103-226, 384-395, 551-580`  ·  [report](./crypto-secure-storage.md)
5. **Crypto & Secure Storage** — Enclave `seal()` / `verify()` signature + content-integrity has ZERO tests — forged/tampered enclaves verify as valid  ·  `src-tauri/src/engine/enclave.rs:127-305`  ·  [report](./crypto-secure-storage.md)
6. **Crypto & Secure Storage** — Security-critical env-gated branches in `crypto.rs` (legacy-IPC reject, fallback-key deny, legacy-key migration) are untested  ·  `src-tauri/src/engine/crypto.rs:80-169, 442-459, 670-701, 929-951`  ·  [report](./crypto-secure-storage.md)
7. **Database Schema & Migrations** — Credential blob→field migration (secrets path) has no test  ·  `src-tauri/src/db/migrations/helpers.rs:9-195 (`migrate_blob_credentials_to_fields`, `clear_legacy_credential_blobs`, `assert_credential_blob_invariant`)`  ·  [report](./database-schema-migrations.md)
8. **Design Reviews & Diagrams** — `score_design_result` pass/fail gate has no tests  ·  `src-tauri/src/commands/design/reviews.rs:2470-2603`  ·  [report](./design-reviews-diagrams.md)
9. **Internationalization (i18n)** — Error-to-friendly-message resolution (`resolveErrorTranslated`) has no behavioral test — wrong match = wrong user guidance on revenue/auth/budget errors  ·  `src/i18n/useTranslatedError.ts:59-164 (ERROR_KEY_MAP + resolveErrorTranslated)`  ·  [report](./internationalization-i18n.md)
10. **MCP Gateways & Tools** — Tool-runner curl/script injection defenses (`resolve_placeholders`, `sanitize_input_value`, `validate_curl_args`) have ZERO tests  ·  `src-tauri/src/engine/tool_runner.rs:360-443 (and the whole file — 874 lines, no `#[cfg(test)]` module)`  ·  [report](./mcp-gateways-tools.md)
11. **MCP Gateways & Tools** — JIT-OAuth sentinel detector (`detect_authorization_required`) untested despite documented strict AND-conditions  ·  `src-tauri/src/engine/mcp_tools.rs:458-505`  ·  [report](./mcp-gateways-tools.md)
12. **Messages & Notifications** — Webhook dispatch watermark never advances past a failed delivery — untested  ·  `src-tauri/src/engine/webhook_notifier.rs:449-535 (`tick`)`  ·  [report](./messages-notifications.md)
13. **OAuth, API Proxy & Foraging** — OAuth refresh staleness/backoff decision logic untested — silent daily-401 regressions  ·  `src-tauri/src/engine/oauth_refresh.rs:34-99, 148-258, 315-344`  ·  [report](./oauth-api-proxy-foraging.md)
14. **Persona Editor & CRUD** — `is_valid_asset_id` path-traversal guard is the only thing standing between a crafted IPC call and arbitrary file delete/read — and it has zero tests  ·  `src-tauri/src/commands/core/persona_icons.rs:58-60 (guard), :164-208 (`list_persona_icons` / `delete_persona_icon`)`  ·  [report](./persona-editor-crud.md)
15. **Persona Templates** — Template integrity check (`check_template_integrity` / `compute_content_hash`) is the security trust boundary but has ZERO tests  ·  `src-tauri/src/engine/template_checksums.rs:28-217 (call site src-tauri/src/commands/design/template_adopt.rs:28-62, 265)`  ·  [report](./persona-templates.md)
16. **Persona Templates** — `populate_persona_parameters_from_design` + `coerce_answer_to_param_value` — adoption-answer → persona.parameters write has no test  ·  `src-tauri/src/commands/design/template_adopt.rs:1085-1234`  ·  [report](./persona-templates.md)
17. **Settings & BYOM** — CORS origin allowlist (`is_trusted_management_origin`) has no tests  ·  `src-tauri/src/engine/management_api.rs:147-157`  ·  [report](./settings-byom.md)
18. **Settings & BYOM** — `require_api_key` auth middleware is untested (missing/invalid/revoked token behavior)  ·  `src-tauri/src/engine/management_api.rs:167-197`  ·  [report](./settings-byom.md)
19. **Team Assignment & Handoff** — Cascade-skip / restore-skipped DAG logic is untested  ·  `src-tauri/src/engine/team_assignment_orchestrator.rs:284-320 (`restore_cascade_skipped_dependents`), :462-484 (cascade-skip in tick_loop), :940-943 (`parse_depends_on`)`  ·  [report](./team-assignment-handoff.md)
20. **Team Assignment & Handoff** — QA fix-loop "changes_requested" bounce + done-vs-failed verdict is untested  ·  `src-tauri/src/engine/team_assignment_orchestrator.rs:983-1069 (`step_emitted_changes_requested`, `trigger_qa_rework`), :825-916 (completed-execution verdict branch), :970-977 (MAX_QA_FIX_ROUNDS)`  ·  [report](./team-assignment-handoff.md)
21. **Webhooks & Channel Pollers** — Webhook HMAC enforcement & rejection paths are entirely untested above the byte-compare  ·  `src-tauri/src/engine/webhook.rs:268-512 (process_webhook); 514-539 (verify_hmac_sha256)`  ·  [report](./webhooks-channel-pollers.md)
22. **Webhooks & Channel Pollers** — `mark_triggered_and_publish` optimistic-concurrency (CAS) + atomic publish has no test  ·  `src-tauri/src/engine/webhook.rs:544-607`  ·  [report](./webhooks-channel-pollers.md)

### B. Data-write CAS / idempotency / migrations (19)
23. **Agent Chat** — Duplicate-assistant-message idempotency guard in finishChatStream is wholly untested  ·  `src/stores/slices/agents/chatSlice.ts:268-322 (guard at :277-278)`  ·  [report](./agent-chat.md)
24. **Agent Lab & Versions** — Version rollback / activation data-write path is untested (silent prompt loss)  ·  `src-tauri/src/commands/execution/lab.rs:828-919 (`lab_rollback_version`), src-tauri/src/commands/execution/lab.rs:541-624 (`lab_accept_matrix_draft`)`  ·  [report](./agent-lab-versions.md)
25. **Approvals & Decisions** — Approval state machine (load_pending / finalize_approval) has no CAS-race test  ·  `src-tauri/src/commands/companion/approvals.rs:499-574 (`load_pending`, `finalize_approval`)`  ·  [report](./approvals-decisions.md)
26. **Cloud Sync & Deployment** — Incremental sync cursor advancement (the data-loss watermark) is untested  ·  `src-tauri/src/cloud/sync/mod.rs:265-284 (`sync_table_inner`) + src-tauri/src/cloud/sync/cursor.rs:33-51`  ·  [report](./cloud-sync-deployment.md)
27. **Companion Brain & Proactivity** — Proactive dedupe + resolve lifecycle has zero persistence tests  ·  `src-tauri/src/companion/proactive/mod.rs:159-211 (`enqueue_if_new`), :420-458 (`resolve`)`  ·  [report](./companion-brain-proactivity.md)
28. **Credential Design & Negotiation** — credential_recipes::upsert MERGE-not-clobber has zero tests  ·  `src-tauri/src/db/repos/resources/credential_recipes.rs:51-97 (also increment_usage 100-114, delete_by_connector 117-130)`  ·  [report](./credential-design-negotiation.md)
29. **Database Schema & Migrations** — Incremental migration idempotency is completely untested (re-run / fresh-vs-legacy)  ·  `src-tauri/src/db/migrations/incremental.rs:145-4640 (`run_incremental`, ~80 steps); src-tauri/src/db/mod.rs:1260-1280 (`init_test_db`)`  ·  [report](./database-schema-migrations.md)
30. **Execution Runner & Inspector** — Idempotency dedup & monthly-spend budget gate in `execute_persona_inner` are untested (double-spend / double-run risk)  ·  `src-tauri/src/commands/execution/executions.rs:294-345 (budget gate + idempotency dedup); underlying repo src-tauri/src/db/repos/execution/executions.rs:420 (`create_with_idempotency`), :1417 (`get_monthly_spend`)`  ·  [report](./execution-runner-inspector.md)
31. **Genome & Evolution** — Promotion compare-and-swap (lost-update guard) has no test  ·  `src-tauri/src/engine/evolution.rs:577-620 (`promote_variant`)`  ·  [report](./genome-evolution.md)
32. **Genome & Evolution** — `genome_adopt_offspring` transaction + credential encryption + tool dedup untested  ·  `src-tauri/src/commands/execution/genome.rs:291-433 (`genome_adopt_offspring`, `encrypt_profile_for_adoption`)`  ·  [report](./genome-evolution.md)
33. **Knowledge Base & Memories** — Knowledge upsert running-average / confidence math is untested  ·  `src-tauri/src/db/repos/execution/knowledge.rs:36-140 (`upsert`)`  ·  [report](./knowledge-base-memories.md)
34. **Knowledge Base & Memories** — detectConflicts / textSimilarity have no tests and exist in two drifting copies  ·  `src/features/overview/sub_memories/libs/memoryConflicts.ts:47-129 and src/features/overview/sub_memories/hooks/memoryConflicts.ts:67-200`  ·  [report](./knowledge-base-memories.md)
35. **Messages & Notifications** — Shared-event relay dedup + cursor-hold (data-loss path) — zero tests  ·  `src-tauri/src/engine/shared_event_relay.rs:59-187 (`shared_event_relay_tick`); src-tauri/src/db/repos/communication/shared_events.rs:211-229 (`update_cursor`)`  ·  [report](./messages-notifications.md)
36. **Obsidian Brain** — Push/Pull/resolve-conflict sync engine (data-write path) has zero command-level coverage  ·  `src-tauri/src/commands/obsidian_brain/mod.rs:509-813 (push), 848-1072 (pull), 1239-1354 (resolve)`  ·  [report](./obsidian-brain.md)
37. **Repositories & Models** — Cancel-clobber / zombie-resurrection CAS guards are untested  ·  `src-tauri/src/db/repos/execution/executions.rs:831-912 (`update_status_if_not_final`), 706-775 (`update_status_if_running`), 593-630 (`set_claude_session_id`/`set_model_used_actual`/`set_cache_tokens`)`  ·  [report](./repositories-models.md)
38. **Repositories & Models** — Idempotency dedup on execution create is untested  ·  `src-tauri/src/db/repos/execution/executions.rs:420-491 (`create_with_idempotency`, `get_by_idempotency_key`)`  ·  [report](./repositories-models.md)
39. **Research Lab** — Experiment-run sequencing CAS has no regression test  ·  `src-tauri/src/db/repos/research_lab.rs:668-705 (`create_experiment_run`)`  ·  [report](./research-lab.md)
40. **Self-Healing & Auto-Rollback** — `auto_rollback_tick` decision logic is entirely untested — the highest-blast-radius path in the context  ·  `src-tauri/src/engine/auto_rollback.rs:34-395`  ·  [report](./self-healing-auto-rollback.md)
41. **Self-Healing & Auto-Rollback** — `perform_rollback` (auto) has diverged from the manual `rollback_prompt_version` it claims to mirror — and the atomic/anti-Frankenstein guarantee is untested  ·  `src-tauri/src/engine/auto_rollback.rs:405-473`  ·  [report](./self-healing-auto-rollback.md)

### C. Budget / billing / metering gates (7)
42. **Analytics, SLA & Usage** — Token/cost projection engine (`cost.rs`) has zero tests  ·  `src-tauri/src/engine/cost.rs:11-142`  ·  [report](./analytics-sla-usage.md)
43. **Capabilities, Use Cases & Model Config** — Frontend budget enforcement (fail-closed gate) is entirely untested  ·  `src/stores/slices/agents/budgetEnforcementSlice.ts:70-156`  ·  [report](./capabilities-use-cases-model-config.md)
44. **OAuth, API Proxy & Foraging** — Token-bucket rate limiter has no test — the throttle that bounds API spend  ·  `src-tauri/src/engine/api_proxy.rs:177-306`  ·  [report](./oauth-api-proxy-foraging.md)
45. **Personas Twin** — `validateKeyFactsJson` trust-boundary cap is untested  ·  `src/api/twin/twin.ts:165-214`  ·  [report](./personas-twin.md)
46. **Pipeline & Agent Chains** — Pipeline node runner, budget-halt, and approval-gate orchestration are untested  ·  `src-tauri/src/engine/pipeline_executor.rs:728-993 (run_pipeline), :320-511 (run_persona_node), :679-704 (poll_for_approval)`  ·  [report](./pipeline-agent-chains.md)
47. **Scheduler & Cron Agents** — User-initiated `backfill_schedule` skips budget / hourly-cap / active-window guards the auto path enforces  ·  `src-tauri/src/commands/execution/scheduler.rs:98-209 (publish loop 156-187)`  ·  [report](./scheduler-cron-agents.md)
48. **Triggers & Event Registry** — Bulk DLQ partial-failure semantics + batch cap untested  ·  `src-tauri/src/db/repos/communication/events.rs:790-913 (bulk_retry_dead_letter, bulk_discard_dead_letter); src-tauri/src/commands/communication/events.rs:224-253 (MAX_BULK_DLQ_BATCH guard)`  ·  [report](./triggers-event-registry.md)

### D. Data-loss: watermark / cursor / fan-in (4)
49. **Execution Runner & Inspector** — Protocol dispatch — quality-gate, policy drop & incident loop have ZERO behavioral coverage  ·  `src-tauri/src/engine/dispatch.rs:209-991 (`dispatch()` fn)`  ·  [report](./execution-runner-inspector.md)
50. **Home & Roadmap** — Roadmap merge & blank-protection logic (`buildDisplayItems`) is entirely untested  ·  `src/features/home/sub_releases/HomeRoadmapView.tsx:185-220 (also fromLive 134-148, fromBundled 116-131)`  ·  [report](./home-roadmap.md)
51. **Pipeline & Agent Chains** — Fan-in input merge (`resolve_node_input`) has zero tests despite being a fixed data-loss bug  ·  `src-tauri/src/engine/pipeline_executor.rs:999-1034`  ·  [report](./pipeline-agent-chains.md)
52. **Triggers & Event Registry** — Dead-Letter Queue retry/recovery path has zero tests  ·  `src-tauri/src/db/repos/communication/events.rs:603-961 (publish_dead_letter, move_to_dead_letter, retry_dead_letter, discard_dead_letter, bulk_retry_dead_letter, bulk_discard_dead_letter, increment_retry_or_dead_letter, get_dead_letter_events, count_dead_letter, get_retry_eligible)`  ·  [report](./triggers-event-registry.md)

### E. Orchestration / state-machine / merge fallback (4)
53. **Agent Lab & Versions** — Lab run status state machine (`validate_transition`) has zero tests — gates every run write  ·  `src-tauri/src/db/models/lab.rs:50-67 (`validate_transition`), enforced at src-tauri/src/db/macros.rs:448-451 and src-tauri/src/engine/process_session.rs:312`  ·  [report](./agent-lab-versions.md)
54. **Director & Leadership** — `advance_goal` step-building & double-advance guard is entirely untested  ·  `src-tauri/src/engine/goal_advance.rs:56-252`  ·  [report](./director-leadership.md)
55. **Incidents & Manual Review** — `incident_continuation` decision branches are entirely untested  ·  `src-tauri/src/engine/incident_continuation.rs:71-297`  ·  [report](./incidents-manual-review.md)
56. **Team Builder & Workspace** — Team-preset adoption orchestration has zero coverage of its data-write & partial-failure semantics  ·  `src-tauri/src/engine/team_preset_adopter.rs:207-521 (`adopt_preset`), 539-805 (`retry_failed_members`)`  ·  [report](./team-builder-workspace.md)

### F. Other critical untested paths (21)
57. **Approvals & Decisions** — fleet autonomous PTY guards (Athena-owned + cwd containment) are untested  ·  `src-tauri/src/commands/companion/approvals.rs:3078-3086 (`fleet_send_input_targets_athena_session`), 3257-3289 (`validate_fleet_cwd`)`  ·  [report](./approvals-decisions.md)
58. **Artist Studio** — `artist_read_image_base64` security guards have no test despite an explicit hardening history  ·  `src-tauri/src/commands/artist/mod.rs:337-399`  ·  [report](./artist-studio.md)
59. **Companion Brain & Proactivity** — Wake gate (`wake_window::gate`) decides autonomy and is untested  ·  `src-tauri/src/companion/wake_window.rs:53-72 (`gate`), :17 (`QUEUE_CAP`)`  ·  [report](./companion-brain-proactivity.md)
60. **Companion Runtime & Chat** — `use_connector` dispatch — connector-call gating & approval routing is untested  ·  `src-tauri/src/companion/dispatcher.rs:1335-1507`  ·  [report](./companion-runtime-chat.md)
61. **Connector Catalog** — `simulateRevocation` is entirely untested — revenue/executions-loss numbers shown to users carry zero assertions  ·  `src/features/vault/sub_dependencies/credentialGraph.ts:246-318`  ·  [report](./connector-catalog.md)
62. **Credential Vault CRUD** — `is_mutation` SQL safe-mode classifier has no direct coverage of its keyword set  ·  `src-tauri/src/engine/db_query.rs:274-294 (also the `classify_db_query` IPC command at src-tauri/src/commands/credentials/db_schema.rs:139-142 and the write-mode guard at db_query.rs:367)`  ·  [report](./credential-vault-crud.md)
63. **Credential Vault CRUD** — `create_credential` "healthcheck_passed is a UX hint, not proof" security fix is untested  ·  `src-tauri/src/commands/credentials/crud.rs:57-102 (the whole `commands/credentials/crud.rs` has no `#[cfg(test)]`)`  ·  [report](./credential-vault-crud.md)
64. **Dashboard & Mission Control** — Fleet optimization recommendation engine is entirely untested  ·  `src/features/overview/libs/fleetOptimizer.ts:141-257 (whole `generateFleetRecommendation` + `derivePerPersonaPerformance`)`  ·  [report](./dashboard-mission-control.md)
65. **Dev Tools & Context Map** — `finalizeContextScan` outcome → notification routing is entirely untested  ·  `src/features/plugins/dev-tools/sub_context/ContextMapPage.tsx:47-119`  ·  [report](./dev-tools-context-map.md)
66. **Error Handling, Hooks & Utilities** — `extractMessage` / `toastCatch` / `silentCatch` — zero tests on the app-wide error-surfacing helpers  ·  `src/lib/silentCatch.ts:19-129`  ·  [report](./error-handling-hooks-utilities.md)
67. **Fleet Control** — `companion_record_fleet_event` lifecycle dispatch + exit reconciliation is entirely untested  ·  `src-tauri/src/commands/companion/fleet_bridge.rs:55-165, 446-457`  ·  [report](./fleet-control.md)
68. **Google Drive** — drive_copy / drive_move overwrite-guards & "folder inside itself" have no test  ·  `src-tauri/src/commands/drive.rs:1187-1284 (drive_move, drive_copy), 1019-1107 (drive_delete / move_to_trash)`  ·  [report](./google-drive.md)
69. **MCP Gateways & Tools** — MCP cross-credential response correlation (`read_session_response`) and result parsing (`parse_tool_result`) untested  ·  `src-tauri/src/engine/mcp_tools.rs:1815-1841 (`read_session_response`), 1843-1884 (`parse_tool_result`)`  ·  [report](./mcp-gateways-tools.md)
70. **OAuth, API Proxy & Foraging** — API-proxy base-URL resolution + header allow/block list is wholly untested  ·  `src-tauri/src/engine/api_proxy.rs:536-672, 559-595, 813-833`  ·  [report](./oauth-api-proxy-foraging.md)
71. **Observability & Alerts** — Client-side alert evaluation engine (`evaluateRule` + `evaluateAlertRules`) is wholly untested  ·  `src/stores/slices/overview/alertSlice.ts:52-116 (`evaluateRule`, `formatAlertMessage`), :338-500 (`evaluateAlertRules`)`  ·  [report](./observability-alerts.md)
72. **Obsidian Brain** — `vault_note_filename` collision-safety has no test — the exact bug it fixes can silently regress  ·  `src-tauri/src/commands/obsidian_brain/mod.rs:487-507`  ·  [report](./obsidian-brain.md)
73. **Personas Twin** — `set_active_profile` single-active invariant is untested  ·  `src-tauri/src/db/repos/twin.rs:239-253`  ·  [report](./personas-twin.md)
74. **Recipes & Use-Case Blueprints** — `curation_scheduler::tick()` has zero behavioral coverage — double-run / no-fire regressions slip through  ·  `src-tauri/src/engine/curation_scheduler.rs:61-181`  ·  [report](./recipes-use-case-blueprints.md)
75. **Shared UI Component Library** — ConfirmDialog has no test for its double-fire guard on destructive actions  ·  `src/features/shared/components/feedback/ConfirmDialog.tsx:37-55`  ·  [report](./shared-ui-component-library.md)
76. **Tauri IPC Bridge & API** — `coerceArgs` undefined→null coercion (Rust `Option<T>` wire contract) is wholly untested  ·  `src/lib/tauriInvoke.ts:162-195 (`coerceArgs` / `isPlainRecursable`); contract at 215-242`  ·  [report](./tauri-ipc-bridge-api.md)
77. **Team Builder & Workspace** — Single-pipeline-per-team concurrency guard (`create_pipeline_run`) is untested  ·  `src-tauri/src/db/repos/resources/teams.rs:714-753 (`create_pipeline_run`), 686-696 (`has_running_pipeline`)`  ·  [report](./team-builder-workspace.md)

---

## Triage themes (by category, all severities)

| Category | Count | Why it is its own wave |
|---|---:|---|
| coverage-gap | 258 | Business-critical paths with no test that would catch a regression — the core of this scan. |
| llm-generatable | 57 | Pure functions (parsers/validators/mappers/scorers) where a generated test batch closes a gap fast AND pins a business invariant. |
| missing-assertion | 29 | Tests that run code without verifying behavior (success theater) — false confidence to remove. |
| quality-gate | 17 | Per-area coverage thresholds / new-code ratchets so these gaps cannot silently recur. |
| test-structure | 10 | Test-code health: right-sizing, shared fixtures, behavior-over-impl assertions. |
| flaky-nondeterministic | 9 | Time/locale/order/shared-state nondeterminism that erodes trust in the whole suite. |
| coverage-gap (with flaky-nondeterministic risk if written naively) | 1 |  |

---

## Suggested fix-wave split

In a test-mastery run, "fixes" = **authoring test suites + adding calibrated quality gates**, not patching product code. This is additive (very low regression risk) but substantial. Waves are ordered by business risk so the suites compound. Each wave ~6-8 findings.

| Wave | Theme | Focus | Approx |
|---|---|---|---:|
| 1 | Security / auth / boundary | mgmt-API auth+CORS (settings-byom), webhook auth-rejection branches, desktop capability gate (path-traversal/NTFS-ADS), enclave seal/verify, crypto fail-closed, persona-icon traversal, template anti-tamper hash parity | 7 |
| 2 | Data-write CAS / idempotency | execution status CAS (cancel-clobber), genome `promote_variant`, lab rollback/matrix-accept, build-draft promote, repo dedup (double-bill), agent-chat duplicate-INSERT | 7 |
| 3 | Migrations / persistence integrity | `run_incremental` idempotency, credential-blob→field secrets migration, db startup rebuild/orphan-cleanup, cloud-sync cursor advance, knowledge upsert running-average | 6 |
| 4 | Budget / billing / metering | capability fail-closed budget gate, scheduler `backfill_schedule` caps, cost/price projection, build capability-exclusion filter, execution idempotency dedup | 6 |
| 5 | Data-loss: watermark / cursor / fan-in | notifier watermark-hold, shared-event relay cursor, trigger DLQ retry, pipeline `resolve_node_input` fan-in | 6 |
| 6 | Orchestration / state-machines | goal-advance, incident-continuation safety guards, self-healing auto-rollback, proactive dedupe/resolve, team-assignment cascade-skip, fleet→Athena memory bridge | 7 |
| 7 | Surface criticals + remainder | home-roadmap merge fallback, error normalizer (~454 sites), IPC `coerceArgs`, i18n error-classification, ConfirmDialog double-fire, alert decision engine, fleetOptimizer | 7 |
| 8+ | Quality gates + LLM-generatable batches | establish per-area coverage ratchet (new-code, higher on business-critical dirs) + generate the 57 llm-generatable pure-function batches asserting real invariants | cross-cutting |

That covers all 77 criticals across W1-7; the High/Medium tail + the gate/ratchet infrastructure follow in W8+.

---

## Dominant patterns observed

- **Coverage stops exactly at the boundary.** Pure helpers (validators, parsers, HMAC compare, FSM predicates) are well-tested; the **orchestration / DB-write / auth-gate / HTTP-bound** layer that *uses* them is repeatedly untested. The risk lives one layer above where the tests stop.
- **Success theater.** Several existing tests pass without asserting behavior — genome crossover/mutate assert only "non-empty"; API tests mock IPC transport so they prove nothing about the gate; a chat test source-greps instead of executing.
- **Frontend largely untested despite mature infra.** vitest + Testing Library + `tauriMock`/`init_test_db` harnesses exist and are used in a few places, yet most stores/slices/components/hooks have zero tests — so these gaps are low-friction to close.
- **57 LLM-generatable batches** — pure functions feeding a hard gate (cost projection, cron formatters, fitness/topology scorers, slugify, coercion helpers) are ideal for generated tests that assert an invariant, not a snapshot. Several need a one-line `export` first.
- **No per-area coverage gate** anywhere — nothing stops these gaps from silently recurring; a new-code ratchet is the cheapest durable fix.

## Context-map drift noted during scan

- `dashboard-mission-control`: manifest lists `src/stores/slices/overview/index.ts` (does not exist); live state is `overviewStore.ts` + `certificationSlice.ts`.
- `state-management-zustand`: manifest `personaStore.ts` and `slices/*/index.ts` do not exist; mapped to live `agentStore.ts`/`overviewStore.ts` etc.
- `cloud-sync-deployment` / `team-builder-workspace`: several manifest files are thin facades with no production caller; subagents redirected weight to the live code path (e.g. `cloud/sync/*`).

## How this scan was run

- **Scanner:** `test_mastery` (Vibeman in-app scan type; role: risk-weighted coverage, honest assertions, LLM-generatable batches, quality gates, suite health).
- **Scope:** all 52 contexts in 12 groups, full-stack (TS + Rust `src-tauri/`).
- **Method:** 52 isolated `general-purpose` subagents, ≤8 parallel (7 waves), each read its files via `_manifest.json`, wrote one report, replied terse. Orchestrator read only replies + report headers — never full reports during scanning.
- **Verification:** severity-bullets (381) == finding-headings (381).
- **Read-only:** no product code modified; baseline (tsc/cargo/vitest) to be captured precisely before any fix wave.
