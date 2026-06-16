# Bug Hunter Scan — personas, 2026-06-16

> Elite systems-failure analysis (bug-hunter scanner) across the full context map.
> 52 parallel subagent runs, batched in waves of ≤8, full-stack (src/ + src-tauri/), 5 findings per context.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 52 contexts | 42 | 105 | 68 | 45 | **260** |
| Share | 16.2% | 40.4% | 26.2% | 17.3% | 100% |

Counts verified two ways: sum of `> Total:` headers = 260; count of `**Severity**` bullets = 260; `## N.` headings = 260. ✓

---

## Per-context breakdown

Sorted by criticals desc, then by total.

| # | Context | Group | C | H | M | L | Total | Report |
|---:|---|---|---:|---:|---:|---:|---:|---|
| 1 | Agent Chat | Persona & Agent Studio | 1 | 2 | 1 | 1 | 5 | [agent-chat](./agent-chat.md) |
| 2 | Agent Lab & Versions | Persona & Agent Studio | 1 | 2 | 2 | 0 | 5 | [agent-lab-versions](./agent-lab-versions.md) |
| 3 | Approvals & Decisions | Athena Companion | 1 | 2 | 1 | 1 | 5 | [approvals-decisions](./approvals-decisions.md) |
| 4 | Artist Studio | First-Party Plugins | 1 | 2 | 1 | 1 | 5 | [artist-studio](./artist-studio.md) |
| 5 | Build Sessions & PersonaMatrix | Templates & Recipes | 1 | 2 | 1 | 1 | 5 | [build-sessions-personamatrix](./build-sessions-personamatrix.md) |
| 6 | Capabilities, Use Cases & Model Config | Persona & Agent Studio | 1 | 3 | 1 | 0 | 5 | [capabilities-use-cases-model-config](./capabilities-use-cases-model-config.md) |
| 7 | Cloud Sync & Deployment | Onboarding, Home & Settings | 1 | 2 | 1 | 1 | 5 | [cloud-sync-deployment](./cloud-sync-deployment.md) |
| 8 | Cockpit, Voice & Sensory | Athena Companion | 1 | 2 | 1 | 1 | 5 | [cockpit-voice-sensory](./cockpit-voice-sensory.md) |
| 9 | Companion Brain & Proactivity | Athena Companion | 1 | 2 | 1 | 1 | 5 | [companion-brain-proactivity](./companion-brain-proactivity.md) |
| 10 | Companion Runtime & Chat | Athena Companion | 1 | 2 | 1 | 1 | 5 | [companion-runtime-chat](./companion-runtime-chat.md) |
| 11 | Connector Catalog | Credential Vault & Connectors | 1 | 2 | 1 | 1 | 5 | [connector-catalog](./connector-catalog.md) |
| 12 | Credential Design & Negotiation | Credential Vault & Connectors | 1 | 2 | 1 | 1 | 5 | [credential-design-negotiation](./credential-design-negotiation.md) |
| 13 | Credential Vault CRUD | Credential Vault & Connectors | 1 | 2 | 1 | 1 | 5 | [credential-vault-crud](./credential-vault-crud.md) |
| 14 | Crypto & Secure Storage | Data & Persistence | 1 | 2 | 1 | 1 | 5 | [crypto-secure-storage](./crypto-secure-storage.md) |
| 15 | Database Schema & Migrations | Data & Persistence | 1 | 2 | 1 | 1 | 5 | [database-schema-migrations](./database-schema-migrations.md) |
| 16 | Design Reviews & Diagrams | Templates & Recipes | 1 | 2 | 1 | 1 | 5 | [design-reviews-diagrams](./design-reviews-diagrams.md) |
| 17 | Dev Tools & Context Map | First-Party Plugins | 1 | 2 | 1 | 1 | 5 | [dev-tools-context-map](./dev-tools-context-map.md) |
| 18 | Error Handling, Hooks & Utilities | Platform Foundation | 1 | 2 | 1 | 1 | 5 | [error-handling-hooks-utilities](./error-handling-hooks-utilities.md) |
| 19 | Execution Runner & Inspector | Execution Engine | 1 | 2 | 1 | 1 | 5 | [execution-runner-inspector](./execution-runner-inspector.md) |
| 20 | Fleet Control | Teams & Fleet Orchestration | 1 | 2 | 1 | 1 | 5 | [fleet-control](./fleet-control.md) |
| 21 | Genome & Evolution | Execution Engine | 1 | 2 | 1 | 1 | 5 | [genome-evolution](./genome-evolution.md) |
| 22 | Google Drive | First-Party Plugins | 1 | 2 | 1 | 1 | 5 | [google-drive](./google-drive.md) |
| 23 | Incidents & Manual Review | Observability & Analytics | 1 | 2 | 1 | 1 | 5 | [incidents-manual-review](./incidents-manual-review.md) |
| 24 | Knowledge Base & Memories | Observability & Analytics | 1 | 2 | 1 | 1 | 5 | [knowledge-base-memories](./knowledge-base-memories.md) |
| 25 | MCP Gateways & Tools | Credential Vault & Connectors | 1 | 2 | 1 | 1 | 5 | [mcp-gateways-tools](./mcp-gateways-tools.md) |
| 26 | Messages & Notifications | Triggers & Events | 1 | 2 | 1 | 1 | 5 | [messages-notifications](./messages-notifications.md) |
| 27 | OAuth, API Proxy & Foraging | Credential Vault & Connectors | 1 | 2 | 1 | 1 | 5 | [oauth-api-proxy-foraging](./oauth-api-proxy-foraging.md) |
| 28 | Obsidian Brain | First-Party Plugins | 1 | 2 | 1 | 1 | 5 | [obsidian-brain](./obsidian-brain.md) |
| 29 | Onboarding Tour | Onboarding, Home & Settings | 1 | 2 | 1 | 1 | 5 | [onboarding-tour](./onboarding-tour.md) |
| 30 | Persona Templates | Templates & Recipes | 1 | 2 | 1 | 1 | 5 | [persona-templates](./persona-templates.md) |
| 31 | Personas Twin | First-Party Plugins | 1 | 2 | 1 | 1 | 5 | [personas-twin](./personas-twin.md) |
| 32 | Pipeline & Agent Chains | Teams & Fleet Orchestration | 1 | 2 | 1 | 1 | 5 | [pipeline-agent-chains](./pipeline-agent-chains.md) |
| 33 | Recipes & Use-Case Blueprints | Templates & Recipes | 1 | 2 | 1 | 1 | 5 | [recipes-use-case-blueprints](./recipes-use-case-blueprints.md) |
| 34 | Research Lab | First-Party Plugins | 1 | 2 | 1 | 1 | 5 | [research-lab](./research-lab.md) |
| 35 | Self-Healing & Auto-Rollback | Execution Engine | 1 | 2 | 1 | 1 | 5 | [self-healing-auto-rollback](./self-healing-auto-rollback.md) |
| 36 | Settings & BYOM | Onboarding, Home & Settings | 1 | 2 | 1 | 1 | 5 | [settings-byom](./settings-byom.md) |
| 37 | Shared UI Component Library | Platform Foundation | 1 | 2 | 1 | 1 | 5 | [shared-ui-component-library](./shared-ui-component-library.md) |
| 38 | Tauri IPC Bridge & API | Platform Foundation | 1 | 2 | 1 | 1 | 5 | [tauri-ipc-bridge-api](./tauri-ipc-bridge-api.md) |
| 39 | Team Assignment & Handoff | Teams & Fleet Orchestration | 1 | 2 | 1 | 1 | 5 | [team-assignment-handoff](./team-assignment-handoff.md) |
| 40 | Team Builder & Workspace | Teams & Fleet Orchestration | 1 | 2 | 1 | 1 | 5 | [team-builder-workspace](./team-builder-workspace.md) |
| 41 | Triggers & Event Registry | Triggers & Events | 1 | 2 | 1 | 1 | 5 | [triggers-event-registry](./triggers-event-registry.md) |
| 42 | Webhooks & Channel Pollers | Triggers & Events | 1 | 2 | 1 | 1 | 5 | [webhooks-channel-pollers](./webhooks-channel-pollers.md) |
| 43 | Analytics, SLA & Usage | Observability & Analytics | 0 | 2 | 3 | 0 | 5 | [analytics-sla-usage](./analytics-sla-usage.md) |
| 44 | Dashboard & Mission Control | Observability & Analytics | 0 | 2 | 3 | 0 | 5 | [dashboard-mission-control](./dashboard-mission-control.md) |
| 45 | Director & Leadership | Execution Engine | 0 | 1 | 3 | 1 | 5 | [director-leadership](./director-leadership.md) |
| 46 | Home & Roadmap | Onboarding, Home & Settings | 0 | 2 | 3 | 0 | 5 | [home-roadmap](./home-roadmap.md) |
| 47 | Internationalization (i18n) | Platform Foundation | 0 | 2 | 2 | 1 | 5 | [internationalization-i18n](./internationalization-i18n.md) |
| 48 | Observability & Alerts | Observability & Analytics | 0 | 3 | 2 | 0 | 5 | [observability-alerts](./observability-alerts.md) |
| 49 | Persona Editor & CRUD | Persona & Agent Studio | 0 | 2 | 2 | 1 | 5 | [persona-editor-crud](./persona-editor-crud.md) |
| 50 | Repositories & Models | Data & Persistence | 0 | 1 | 3 | 1 | 5 | [repositories-models](./repositories-models.md) |
| 51 | Scheduler & Cron Agents | Execution Engine | 0 | 3 | 2 | 0 | 5 | [scheduler-cron-agents](./scheduler-cron-agents.md) |
| 52 | State Management (Zustand) | Platform Foundation | 0 | 2 | 2 | 1 | 5 | [state-management-zustand](./state-management-zustand.md) |

---

## All 42 critical findings — one-line summary (grouped by theme)

### Success theater / swallowed errors (reports success, didn't do it) — 16 critical
1. **Approvals & Decisions — Orb decision clears BEFORE the approve/reject IPC resolves — failed consent action shown as done (success theater)** `src/features/plugins/companion/decision/resolveDecision.ts:31 (with src/features/plugins/companion/decision/useDecisionQueue.ts:101)`
2. **Companion Runtime & Chat — Stale-session retry replays the wrong text on autonomous / proactive / external turns** `src-tauri/src/companion/session.rs:556`
3. **Connector Catalog — Promote-time readiness is cached on the persona and never recomputed when a credential is deleted, rotated, or fails its healthcheck** `src-tauri/src/commands/design/build_sessions.rs:2725 (and :874, :2760); resolver in src-tauri/src/commands/design/connector_readiness.rs:251`
4. **Credential Design & Negotiation — Negotiator overwrites a richer Design recipe with an empty stub at session start** `src/hooks/design/credential/useCredentialNegotiator.ts:162`
5. **Design Reviews & Diagrams — Missing `nodes`/`edges` arrays in LLM-generated flow crash the diagram render** `src/features/templates/sub_diagrams/FlowDiagram.tsx:19 (also :30, :73, :83)`
6. **Fleet Control — Broadcast result is success-theater: full success is silent, full failure looks like a "delivery"** `src/features/plugins/fleet/FleetBroadcastModal.tsx:75`
7. **Genome & Evolution — Promotion compares two incompatible fitness scales** `src-tauri/src/engine/evolution.rs:377`
8. **Google Drive — `drive_copy` silently overwrites an existing destination file — paste/copy data loss** `src-tauri/src/commands/drive.rs:1228 (the file branch at :1251, std::fs::copy)`
9. **Knowledge Base & Memories — Conflict resolution picks the wrong winner — UI "keep" buttons mis-mapped for `superseded` conflicts** `src/features/overview/sub_memories/libs/memoryConflicts.ts:119 (and src/features/overview/sub_memories/components/MemoryConflictReview.tsx:49)`
10. **Onboarding Tour — Skipping the last step silently marks the WHOLE tour complete** `src/features/onboarding/components/GuidedTour.tsx:202 (and src/stores/slices/system/tourSlice.ts:1382)`
11. **Persona Templates — Backend integrity check can never match a real adoption — silently skipped in dev, hard-rejects every adoption in release** `src-tauri/src/commands/design/template_adopt.rs:28 (and call site :260), src-tauri/src/engine/template_checksums.rs:166`
12. **Personas Twin — Shared `twinPendingMemories` slice is status-filtered by whoever fetched last, silently corrupting the readiness score** `src/features/plugins/twin/useTwinReadiness.ts:90-94 (consumer); src/stores/slices/system/twinSlice.ts:469-479 (overwrite); src/features/plugins/twin/sub_brain/RejectionPatternsPanel.tsx:35 and src/features/plugins/twin/sub_knowledge/KnowledgeAtelier.tsx:103 (poisoning writers)`
13. **Pipeline & Agent Chains — Fan-in nodes silently drop all but one predecessor's output** `src-tauri/src/engine/pipeline_executor.rs:961 (resolve_node_input)`
14. **Recipes & Use-Case Blueprints — Scheduled curation never fires — date-format mismatch between writer and reader** `src-tauri/src/engine/curation_scheduler.rs:80-96`
15. **Research Lab — Report compiled from another project's data (cross-project store leak)** `src/features/plugins/research-lab/sub_reports/ReportPreviewDrawer.tsx:88-99 (and researchLabSlice.ts:131-258)`
16. **Self-Healing & Auto-Rollback — AI healing reports "completed" and schedules a real retry even when the healing run itself failed (success theater + bad-diagnosis retry)** `src-tauri/src/engine/mod.rs:3264 (and 3327, 3353)`

### Concurrency / missing-CAS double-execution (no in-flight guard) — 13 critical
17. **Agent Chat — Triple finalization path persists the assistant reply twice (duplicate message)** `src/stores/slices/agents/chatSlice.ts:256 (and executionSlice.ts:435, executionSlice.ts:379)`
18. **Artist Studio — Concurrent generations clobber the single shared session-tracking slot — second generate orphans the first** `src/features/plugins/artist/hooks/useCreativeSession.ts:33 (and src/stores/slices/system/artistSlice.ts:69,124)`
19. **Build Sessions & PersonaMatrix — `simulate_build_draft` clobbers `personas.design_context` with no restore — abandoned simulations corrupt the row, concurrent sims of one persona race** `src-tauri/src/commands/design/build_simulate.rs:248-254`
20. **Cockpit, Voice & Sensory — Main TTS reply playback has no handle — consecutive turns talk over each other** `src/features/plugins/companion/CompanionPanel.tsx:1620`
21. **Companion Brain & Proactivity — Wake gate is decided before the wake is logged → double-wake / duplicate autonomous CLI turns** `src-tauri/src/companion/wake_window.rs:67 (gate read) + src-tauri/src/companion/proactive/execution_review.rs:662 & 753 (gate→work→log_wake) + src-tauri/src/commands/companion/mod.rs:128-167 (tick has no in-flight guard)`
22. **Dev Tools & Context Map — Concurrent context scans of the same project can wipe the map mid-write** `src-tauri/src/commands/infrastructure/context_generation.rs:460 (launch_context_scan); destructive call at :916/:939`
23. **Error Handling, Hooks & Utilities — Auto-dedup returns a SHARED object/array reference to every concurrent caller — mutation by one corrupts the others** `src/lib/tauriInvoke.ts:279-318 (auto-dedup) and :97 (AUTO_DEDUP_TTL_MS = 250)`
24. **Execution Runner & Inspector — Queue stalls forever when a promoted execution's context is missing (lost drain → permanent starvation)** `src-tauri/src/engine/mod.rs:1899 (and the function drain_and_start_next, 1668–1905)`
25. **MCP Gateways & Tools — Pooled stdio sessions have no JSON-RPC id correlation — desynced session returns the wrong tool's result to the wrong caller** `src-tauri/src/engine/mcp_tools.rs:1639 (read_session_jsonrpc), used by execute_tool_on_session:991 and fetch_tools_paginated_stdio:925`
26. **Shared UI Component Library — ConfirmDialog has no in-flight guard — double-click confirms the action twice** `src/features/shared/components/feedback/ConfirmDialog.tsx:53 (confirm <button>)`
27. **Team Assignment & Handoff — Double-started assignment runs two tick loops → same step assigned & executed twice** `src-tauri/src/engine/team_assignment_orchestrator.rs:106 (run_assignment), :400 (in_flight), :540-583 (launch); gate doc at :103-105`
28. **Team Builder & Workspace — Double-submit on Enter creates two orphaned teams** `src/features/teams/sub_teamWorkspace/AutoTeamModal.tsx:44 (and useAutoTeam.ts:89)`
29. **Triggers & Event Registry — No cycle/depth guard on event-driven trigger chains — a self-emitting persona is an unbounded event amplifier** `src-tauri/src/engine/background.rs:799 (event_bus_tick), src-tauri/src/engine/bus.rs:147 (match_event)`

### Security & trust-boundary (SSRF, injection, auth/CORS, path traversal, crypto) — 6 critical
30. **Credential Vault CRUD — `sanitize_secrets` is run over the entire ledger JSON on every metadata write, silently corrupting/erasing legitimate OAuth + custom ledger fields** `src-tauri/src/db/repos/resources/credentials.rs:829-835 (also :684-691, :757-758, :957-964)`
31. **Crypto & Secure Storage — Enclave signature verifies re-serialized struct, not signed bytes (pretty vs compact mismatch)** `src-tauri/src/engine/enclave.rs:157 (seal) vs src-tauri/src/engine/enclave.rs:214 (verify)`
32. **OAuth, API Proxy & Foraging — API-proxy HTTP client follows redirects with no SSRF guard — redirect to raw internal IP bypasses every check** `src-tauri/src/engine/ssrf_safe_dns.rs:57-63 (client) consumed by src-tauri/src/engine/api_proxy.rs:792`
33. **Obsidian Brain — Graph commands accept absolute paths and the containment guard silently disables itself on canonicalize failure** `src-tauri/src/commands/obsidian_brain/graph.rs:236 (guard) + :300, :342 (callers)`
34. **Settings & BYOM — Management-API CORS allows any origin (`allow_origin(Any)`) on a localhost server reachable from every visited web page** `src-tauri/src/engine/management_api.rs:122-125`
35. **Tauri IPC Bridge & API — PostgREST filter injection via unvalidated `id` in remote-command handlers** `src-tauri/src/cloud/remote_commands.rs:307 (also :233, :253, :105)`

### Watermark / cursor advance-on-failure (permanent silent data loss) — 4 critical
36. **Cloud Sync & Deployment — Sync cursor advances to a watermark captured *before* the read snapshot, silently dropping rows committed during the pass** `src-tauri/src/cloud/sync/rows.rs:496 and src-tauri/src/cloud/sync/mod.rs:239`
37. **Database Schema & Migrations — FK-hygiene rebuild turns off foreign keys *inside* a transaction — a no-op that lets DROP TABLE cascade-wipe child rows on legacy upgrades** `src-tauri/src/db/migrations/fk_hygiene.rs:80-85`
38. **Messages & Notifications — Webhook watermark advances past events that failed to deliver — permanent silent delivery gap** `src-tauri/src/engine/webhook_notifier.rs:472`
39. **Webhooks & Channel Pollers — Outbound webhook delivery failures are silently dropped — watermark advances past them** `src-tauri/src/engine/webhook_notifier.rs:482`

### Other / cross-cutting — 2 critical
40. **Agent Lab & Versions — `activateVersion` writes the model to the *selected* persona, not the target persona** `src/stores/slices/agents/labSlice.ts:528`
41. **Capabilities, Use Cases & Model Config — Manual capability run bypasses budget enforcement entirely (real paid CLI spawn)** `src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts:106 (the executePersona(...) call inside handleManualRun)`

### Recovery & healing self-failure (the safety net is the bug) — 1 critical
42. **Incidents & Manual Review — Incident continuation re-runs work even when the originating execution was a simulation / its input is gone** `src-tauri/src/engine/incident_continuation.rs:190`

---

## Triage themes

Detected by clustering category + title/scenario keywords across all 260 findings. A theme is a "wave" because the fixes share one mental model and compound.

| Theme | Total | Critical | High | Why it's a wave |
|---|---:|---:|---:|---|
| Success theater / swallowed errors (reports success, didn't do it) | 98 | 16 | 37 | Largest bucket. Each reports success while dropping work; fix = surface real errors + only claim success on confirmed effect. |
| Concurrency / missing-CAS double-execution (no in-flight guard) | 64 | 13 | 37 | Same fix shape everywhere: a real CAS / single-flight guard on the status transition instead of look-before-leap. |
| Security & trust-boundary (SSRF, injection, auth/CORS, path traversal, crypto) | 19 | 6 | 6 | One hardening pass; several are the *same* class (canonicalize-fails-open, missing redirect/auth re-check) the codebase already fixed elsewhere but didn't back-port. |
| Watermark / cursor advance-on-failure (permanent silent data loss) | 10 | 4 | 3 | All advance a cursor/watermark before confirming delivery; fix = advance only on success + (id,ts) tiebreak. |
| Other / cross-cutting | 21 | 2 | 5 | Cross-cutting items that don't cluster; triage individually. |
| Recovery & healing self-failure (the safety net is the bug) | 9 | 1 | 5 | Recovery code that fails silently; gate retries/rollbacks on actual success + verify the target is healthy. |
| Scoring & aggregation correctness (NaN/÷0/wrong-scale, KPI/SLA/fitness) | 12 | 0 | 4 | Numeric correctness: guard ÷0/NaN, stop comparing incompatible scales, don't substitute sentinels for missing data. |
| Clock / timezone / drift (cron, DST, frozen now(), expiry) | 11 | 0 | 4 | Consistent time policy: store UTC, render local, tiebreak cursors, tick the clock, schedule off slots not tick-time. |
| Resource leaks / unbounded growth (no retention, orphans, blob leaks) | 9 | 0 | 4 | Add retention sweeps, revoke blobs, release devices, stop sharing mutable cached references. |
| Malformed-input / edge-case handling (empty, boundary, untrusted LLM JSON) | 5 | 0 | 0 | Defensive parsing at trust boundaries: validate LLM/untrusted JSON shape before deref; handle empty/boundary. |
| Data-loss on write (overwrite, partial/non-atomic, last-write-wins) | 1 | 0 | 0 | Atomic / transactional writes + existence checks before overwrite; no last-write-wins on user data. |
| Shared store-slice overwrite (sibling panels clobber one array) | 1 | 0 | 0 | One Zustand pattern: scope/seq-guard fetches so a slow sibling fetch can't clobber a fresh one. |

---

## Suggested next-phase split (fix waves)

42 criticals + 105 highs is far more than one session. Recommended ordering — **criticals first, grouped so one mental model covers the wave** (5–7 fixes each):

1. **Wave 1 — Security & trust-boundary criticals** (highest blast radius): SSRF redirect bypass (oauth-api-proxy), CORS `Any` on management API (settings-byom), PostgREST filter injection (tauri-ipc), path-traversal canonicalize-fails-open (obsidian-brain, crypto path_safety), enclave signature mismatch (crypto).
2. **Wave 2 — Concurrency / double-execution criticals**: missing-CAS double-start (team-assignment, team-builder, build-sessions), wake-gate re-entry (companion-brain), artist/creative session id clobber, ConfirmDialog double-confirm (shared-ui).
3. **Wave 3 — Watermark/cursor & sync data-loss**: sync cursor pre-snapshot watermark (cloud-sync), notification/webhook watermark-on-failure (messages, webhooks), shared-event relay cursor.
4. **Wave 4 — Recovery/healing & execution-runtime criticals**: healing success-theater + retry off bad diagnosis (self-healing), drain-and-start stranded queue (execution-runner), fan-in predecessor drop (pipeline), incident continuation with None input.
5. **Wave 5 — Foundation multipliers**: tauriInvoke dedup shared mutable reference + ipc error mapping (error-handling), i18n interpolate throw blanking panels, credential-ledger regex-wipe + ledger races (credential-vault-crud).
6. **Wave 6 — Scoring/correctness & shared-store-overwrite**: evolution fitness scale mismatch (genome), director score clobber, SLA/leaderboard math, goals/kpis scope-toggle clobber (state-management), twin readiness slice overwrite.
7. **Wave 7+ — remaining criticals + high-severity sweeps** per theme (chat double-persist, persona-templates checksum-dead, recipes curation-never-fires, dev-tools concurrent-scan-corruption, connector stale-readiness, etc.), then highs.

Each wave should: read the source finding → read target file(s) → fix → `cargo check`/`tsc` → atomic commit referencing the finding → wave verification vs. baseline.

---

## How this scan was run

- **Scanner**: bug-hunter (`src/lib/prompts/registry/agents/bug-hunter.ts`, scanType `bug_hunter`) — elite systems-failure analyst prompt (latent failures, race conditions, edge cases, silent failures).
- **Date**: 2026-06-16. **Scope**: all 52 contexts, full-stack (src/ frontend + src-tauri/ Rust backend), 5 findings/context.
- **Method**: one general-purpose subagent per context (read-only), batched in 7 waves of ≤8 parallel. Each read its context's files (+ cross-referenced callers), wrote one structured report, replied with terse stats. Orchestrator never read full reports during scanning (Pipeline B discipline).
- **Files read by subagents**: ~520+ total (avg ~10/context, incl. cross-referenced files beyond the context's declared set).
- **Verification**: 260 findings confirmed three ways (header sum / severity bullets / heading count all = 260).
- **Health baseline (for fix waves)**: `tsc --noEmit` = 0 errors at scan time. `cargo check` + `vitest` to be captured before Wave 1.
- **Note**: several subagents flagged context-map drift (manifest file paths that no longer exist — e.g. `stores/personaStore.ts`, `api/pipeline/index.ts`, `api/fleet/index.ts`) and located the real files; worth a `refresh_context` pass. A few also *ruled out* candidate bugs already hardened (SLA ÷0 guards, twin SSRF, dead-letter retry CAS, credentials upsert) — those are noted in-report, not counted.
