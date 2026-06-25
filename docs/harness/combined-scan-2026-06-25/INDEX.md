# Combined Scan (Ambiguity Guardian + Bug Hunter) — personas, 2026-06-25

> Combined per-context audit through two lenses (🐛 bug-hunter reliability + 🌀 ambiguity-guardian clarity), top-5 highest-value findings per context.
> 52 parallel subagent runs, batched in 7 waves of ≤8, full-stack (client `src/` + Rust `src-tauri/`).

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 52 contexts | 6 | 81 | 152 | 21 | **260** |
| Share | 2.3% | 31.2% | 58.5% | 8.1% | 100% |

Lens split: **176 bug-hunter**, **84 ambiguity-guardian** (combined, ranked by value).

Baseline (pre-fix): `tsc` 0 errors · `vitest` 1972 pass / 7 pre-existing fails (5 files) · these 7 are the regression baseline.

---

## Per-group breakdown

| Group | C | H | M | L | Total |
|---|---:|---:|---:|---:|---:|
| Execution Engine | 1 | 9 | 15 | 0 | 25 |
| Credential Vault & Connectors | 1 | 8 | 15 | 1 | 25 |
| Templates & Recipes | 1 | 7 | 11 | 1 | 20 |
| Athena Companion | 1 | 6 | 12 | 1 | 20 |
| Onboarding, Home & Settings | 1 | 5 | 12 | 2 | 20 |
| Data & Persistence | 1 | 5 | 8 | 1 | 15 |
| Observability & Analytics | 0 | 9 | 14 | 2 | 25 |
| First-Party Plugins | 0 | 8 | 17 | 5 | 30 |
| Persona & Agent Studio | 0 | 7 | 12 | 1 | 20 |
| Triggers & Events | 0 | 7 | 7 | 1 | 15 |
| Platform Foundation | 0 | 5 | 16 | 4 | 25 |
| Teams & Fleet Orchestration | 0 | 5 | 13 | 2 | 20 |

---

## Per-context breakdown (sorted by criticals, then highs, then total)

| # | Context | Group | C | H | M | L | Total | Report |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | Cockpit, Voice & Sensory | Athena Companion | 1 | 2 | 2 | 0 | 5 | `cockpit-voice-and-sensory.md` |
| 2 | Crypto & Secure Storage | Data & Persistence | 1 | 2 | 2 | 0 | 5 | `crypto-and-secure-storage.md` |
| 3 | Persona Templates | Templates & Recipes | 1 | 2 | 2 | 0 | 5 | `persona-templates.md` |
| 4 | Scheduler & Cron Agents | Execution Engine | 1 | 2 | 2 | 0 | 5 | `scheduler-and-cron-agents.md` |
| 5 | Settings & BYOM | Onboarding, Home & Settings | 1 | 2 | 2 | 0 | 5 | `settings-and-byom.md` |
| 6 | OAuth, API Proxy & Foraging | Credential Vault & Connectors | 1 | 1 | 3 | 0 | 5 | `oauth-api-proxy-and-foraging.md` |
| 7 | Dashboard & Mission Control | Observability & Analytics | 0 | 3 | 2 | 0 | 5 | `dashboard-and-mission-control.md` |
| 8 | Webhooks & Channel Pollers | Triggers & Events | 0 | 3 | 2 | 0 | 5 | `webhooks-and-channel-pollers.md` |
| 9 | Agent Chat | Persona & Agent Studio | 0 | 2 | 2 | 1 | 5 | `agent-chat.md` |
| 10 | Agent Lab & Versions | Persona & Agent Studio | 0 | 2 | 3 | 0 | 5 | `agent-lab-and-versions.md` |
| 11 | Artist Studio | First-Party Plugins | 0 | 2 | 2 | 1 | 5 | `artist-studio.md` |
| 12 | Build Sessions & PersonaMatrix | Templates & Recipes | 0 | 2 | 3 | 0 | 5 | `build-sessions-and-personamatrix.md` |
| 13 | Capabilities, Use Cases & Model Config | Persona & Agent Studio | 0 | 2 | 3 | 0 | 5 | `capabilities-use-cases-and-model-config.md` |
| 14 | Companion Brain & Proactivity | Athena Companion | 0 | 2 | 3 | 0 | 5 | `companion-brain-and-proactivity.md` |
| 15 | Credential Design & Negotiation | Credential Vault & Connectors | 0 | 2 | 3 | 0 | 5 | `credential-design-and-negotiation.md` |
| 16 | Credential Vault CRUD | Credential Vault & Connectors | 0 | 2 | 2 | 1 | 5 | `credential-vault-crud.md` |
| 17 | Database Schema & Migrations | Data & Persistence | 0 | 2 | 2 | 1 | 5 | `database-schema-and-migrations.md` |
| 18 | Execution Runner & Inspector | Execution Engine | 0 | 2 | 3 | 0 | 5 | `execution-runner-and-inspector.md` |
| 19 | Genome & Evolution | Execution Engine | 0 | 2 | 3 | 0 | 5 | `genome-and-evolution.md` |
| 20 | Google Drive | First-Party Plugins | 0 | 2 | 3 | 0 | 5 | `google-drive.md` |
| 21 | Incidents & Manual Review | Observability & Analytics | 0 | 2 | 3 | 0 | 5 | `incidents-and-manual-review.md` |
| 22 | Knowledge Base & Memories | Observability & Analytics | 0 | 2 | 2 | 1 | 5 | `knowledge-base-and-memories.md` |
| 23 | MCP Gateways & Tools | Credential Vault & Connectors | 0 | 2 | 3 | 0 | 5 | `mcp-gateways-and-tools.md` |
| 24 | Messages & Notifications | Triggers & Events | 0 | 2 | 3 | 0 | 5 | `messages-and-notifications.md` |
| 25 | Recipes & Use-Case Blueprints | Templates & Recipes | 0 | 2 | 3 | 0 | 5 | `recipes-and-use-case-blueprints.md` |
| 26 | Self-Healing & Auto-Rollback | Execution Engine | 0 | 2 | 3 | 0 | 5 | `self-healing-and-auto-rollback.md` |
| 27 | Tauri IPC Bridge & API | Platform Foundation | 0 | 2 | 2 | 1 | 5 | `tauri-ipc-bridge-and-api.md` |
| 28 | Team Assignment & Handoff | Teams & Fleet Orchestration | 0 | 2 | 3 | 0 | 5 | `team-assignment-and-handoff.md` |
| 29 | Triggers & Event Registry | Triggers & Events | 0 | 2 | 2 | 1 | 5 | `triggers-and-event-registry.md` |
| 30 | Analytics, SLA & Usage | Observability & Analytics | 0 | 1 | 4 | 0 | 5 | `analytics-sla-and-usage.md` |
| 31 | Approvals & Decisions | Athena Companion | 0 | 1 | 3 | 1 | 5 | `approvals-and-decisions.md` |
| 32 | Cloud Sync & Deployment | Onboarding, Home & Settings | 0 | 1 | 4 | 0 | 5 | `cloud-sync-and-deployment.md` |
| 33 | Companion Runtime & Chat | Athena Companion | 0 | 1 | 4 | 0 | 5 | `companion-runtime-and-chat.md` |
| 34 | Connector Catalog | Credential Vault & Connectors | 0 | 1 | 4 | 0 | 5 | `connector-catalog.md` |
| 35 | Design Reviews & Diagrams | Templates & Recipes | 0 | 1 | 3 | 1 | 5 | `design-reviews-and-diagrams.md` |
| 36 | Dev Tools & Context Map | First-Party Plugins | 0 | 1 | 3 | 1 | 5 | `dev-tools-and-context-map.md` |
| 37 | Director & Leadership | Execution Engine | 0 | 1 | 4 | 0 | 5 | `director-and-leadership.md` |
| 38 | Fleet Control | Teams & Fleet Orchestration | 0 | 1 | 3 | 1 | 5 | `fleet-control.md` |
| 39 | Home & Roadmap | Onboarding, Home & Settings | 0 | 1 | 3 | 1 | 5 | `home-and-roadmap.md` |
| 40 | Internationalization (i18n) | Platform Foundation | 0 | 1 | 4 | 0 | 5 | `internationalization-i18n.md` |
| 41 | Observability & Alerts | Observability & Analytics | 0 | 1 | 3 | 1 | 5 | `observability-and-alerts.md` |
| 42 | Obsidian Brain | First-Party Plugins | 0 | 1 | 4 | 0 | 5 | `obsidian-brain.md` |
| 43 | Onboarding Tour | Onboarding, Home & Settings | 0 | 1 | 3 | 1 | 5 | `onboarding-tour.md` |
| 44 | Persona Editor & CRUD | Persona & Agent Studio | 0 | 1 | 4 | 0 | 5 | `persona-editor-and-crud.md` |
| 45 | Personas Twin | First-Party Plugins | 0 | 1 | 2 | 2 | 5 | `personas-twin.md` |
| 46 | Pipeline & Agent Chains | Teams & Fleet Orchestration | 0 | 1 | 4 | 0 | 5 | `pipeline-and-agent-chains.md` |
| 47 | Repositories & Models | Data & Persistence | 0 | 1 | 4 | 0 | 5 | `repositories-and-models.md` |
| 48 | Research Lab | First-Party Plugins | 0 | 1 | 3 | 1 | 5 | `research-lab.md` |
| 49 | Shared UI Component Library | Platform Foundation | 0 | 1 | 3 | 1 | 5 | `shared-ui-component-library.md` |
| 50 | State Management (Zustand) | Platform Foundation | 0 | 1 | 3 | 1 | 5 | `state-management-zustand.md` |
| 51 | Team Builder & Workspace | Teams & Fleet Orchestration | 0 | 1 | 3 | 1 | 5 | `team-builder-and-workspace.md` |
| 52 | Error Handling, Hooks & Utilities | Platform Foundation | 0 | 0 | 4 | 1 | 5 | `error-handling-hooks-and-utilities.md` |

---

## All 6 Critical findings

1. **Cockpit, Voice & Sensory — Switching STT engine during an active capture strands a live mic and loses the transcript** — Engine = `whisper`. User holds-to-talk → `useLocalDictation.start()` acquires the mic and sets its internal `listening=true`. While still holding, the `compa... `src/features/plugins/companion/useSpeechInput.ts:17 (trigger: src/features/plugins/companion/sub_voice/SttPanel.tsx:54)` (`cockpit-voice-and-sensory.md` #1)
2. **Crypto & Secure Storage — Binary allowlist matches on basename suffix → planted-binary process-spawn bypass (code execution)** — A built-in manifest lists bare binary names (`"docker"`, `"code"`, `"powershell.exe"`, …). When the spawn path is anything other than a bare name (e.g. `/hom... `src-tauri/src/engine/desktop_security.rs:127 (whole fn 103-129)` (`crypto-and-secure-storage.md` #1)
3. **OAuth, API Proxy & Foraging — API-proxy SSRF DNS filter misses CGNAT (Tailscale 100.64.0.0/10) and IPv4-mapped-IPv6 private addresses** — `execute_api_request` sends every proxied call through `crate::SSRF_SAFE_HTTP` = `ssrf_safe_dns::build_ssrf_safe_client()`. That client's connect-time resolv... `src-tauri/src/engine/ssrf_safe_dns.rs:13,33 (filters with super::healthcheck::is_private_ip); root weakness at src-tauri/src/engine/healthcheck.rs:1279-1304` (`oauth-api-proxy-and-foraging.md` #1)
4. **Persona Templates — Backend template-integrity check is permanently inert — tampered templates are adopted with zero enforcement** — An attacker (or a corrupted sync) edits a shipped template JSON on disk — swaps the `system_prompt`, injects a malicious tool/connector, or rewrites `persona... `src-tauri/src/commands/design/template_adopt.rs:28-62 (false claim at :263-265)` (`persona-templates.md` #1)
5. **Scheduler & Cron Agents — Auto-backfill watermark is poisoned by skip-advances → missed runs silently never catch up** — A cron agent has `max_backfill: 24` so missed runs catch up after downtime. The persona hits its monthly budget cap. For each 5s tick over the next several d... `src-tauri/src/engine/background.rs:1810 (watermark read) ; src-tauri/src/engine/background.rs:1788 + :1735 + :1937 (skip-advances) ; src-tauri/src/db/repos/resources/triggers.rs:1678 (mark_triggered SQL)` (`scheduler-and-cron-agents.md` #1)
6. **Settings & BYOM — BYOM compliance rules never match — silent compliance bypass (fails open)** — An admin opens Settings → BYOM → Compliance and adds a rule "HIPAA workflows → only `claude_code`" with `workflow_tags: ["hipaa"]`. The policy saves cleanly ... `src-tauri/src/engine/byom.rs:483-507 (consumed at src-tauri/src/engine/runner/mod.rs:1271-1273)` (`settings-and-byom.md` #1)

---

## Triage themes (clustered across all 260 findings)

| Theme | C | H | M | L | Total |
|---|---:|---:|---:|---:|---:|
| B. Security & trust-boundary gaps | 5 | 14 | 21 | 2 | 42 |
| D. Watermark / cursor / sync data-flow | 1 | 10 | 12 | 1 | 24 |
| C. Races, atomicity & double-execution | 0 | 18 | 29 | 1 | 48 |
| E. Wrong metric / unit / threshold math | 0 | 14 | 25 | 7 | 46 |
| A. Silent failures & success-theater | 0 | 12 | 21 | 3 | 36 |
| J. Unclear intent & uncovered edge cases | 0 | 6 | 22 | 6 | 34 |
| H. Bounds, truncation & resource growth | 0 | 2 | 8 | 1 | 11 |
| F. Partial-state, atomicity & data-loss | 0 | 2 | 3 | 0 | 5 |
| I. Time, timezone & clock | 0 | 2 | 0 | 0 | 2 |
| G. Built-but-unwired / dead code | 0 | 1 | 11 | 0 | 12 |

---

## High-severity findings by theme (the wave-1–N working set)

### B. Security & trust-boundary gaps — 5C / 14H (of 42 total)
- **[Critical] Cockpit, Voice & Sensory #1** — Switching STT engine during an active capture strands a live mic and loses the transcript. `src/features/plugins/companion/useSpeechInput.ts:17`
- **[Critical] Crypto & Secure Storage #1** — Binary allowlist matches on basename suffix → planted-binary process-spawn bypass (code execution). `src-tauri/src/engine/desktop_security.rs:127`
- **[Critical] OAuth, API Proxy & Foraging #1** — API-proxy SSRF DNS filter misses CGNAT (Tailscale 100.64.0.0/10) and IPv4-mapped-IPv6 private addresses. `src-tauri/src/engine/ssrf_safe_dns.rs:13,33`
- **[Critical] Persona Templates #1** — Backend template-integrity check is permanently inert — tampered templates are adopted with zero enforcement. `src-tauri/src/commands/design/template_adopt.rs:28-62`
- **[Critical] Settings & BYOM #1** — BYOM compliance rules never match — silent compliance bypass (fails open). `src-tauri/src/engine/byom.rs:483-507`
- **[High] Agent Chat #1** — Foreground chat finalize ignores terminal status — failed/cancelled turns are persisted as a real assistant answer (or silently vanish). `src/stores/slices/agents/chatSlice.ts:468-481`
- **[High] Artist Studio #1** — Delete only removes the DB row — the file survives and a re-scan resurrects the "permanently deleted" asset. `src-tauri/src/db/repos/resources/artist.rs:82`
- **[High] Connector Catalog #1** — Substring strategy match mis-routes the API-key `google_gemini` connector to GoogleOAuthStrategy. `src-tauri/src/engine/connector_strategy.rs:231`
- **[High] Credential Design & Negotiation #2** — Healthcheck error message echoes the resolved URL — leaks secret field values templated into the endpoint. `src-tauri/src/commands/credentials/credential_design.rs:265-269`
- **[High] Credential Vault CRUD #1** — Editing a credential silently destroys every field the form did not re-submit. `src-tauri/src/db/repos/resources/credentials.rs:393`
- **[High] Credential Vault CRUD #2** — Field encryption is opt-out via an untrusted connector flag, with no secret-name backstop. `src-tauri/src/db/repos/resources/credentials.rs:89-100`
- **[High] Crypto & Secure Storage #2** — `is_path_allowed` prefix check lacks a separator boundary → sibling-directory scope escape. `src-tauri/src/engine/desktop_security.rs:218`
- **[High] Crypto & Secure Storage #3** — `validate_file_access_path` never canonicalizes → symlink escape out of the home sandbox. `src-tauri/src/engine/path_safety.rs:299-374`
- **[High] Database Schema & Migrations #2** — Non-atomic credential blob→field migration + unconditional blob clear → permanent secret loss on a mid-loop crash. `src-tauri/src/db/migrations/incremental.rs:905-915`
- **[High] Dev Tools & Context Map #1** — GitHub `owner`/`repo`/`base_branch` interpolated into API URLs with no validation or encoding. `src-tauri/src/commands/tools/github_platform.rs:44`
- **[High] MCP Gateways & Tools #4** — MCP env-name denylist enumerates specific vars but misses runner-config env families that re-introduce code-exec on the allowlisted runners. `src-tauri/src/engine/runner/env.rs:25-59`
- **[High] OAuth, API Proxy & Foraging #2** — Telegram `bot_token` (and other path-embedded secrets) leak via reqwest error strings. `src-tauri/src/engine/api_proxy.rs:538-541`
- **[High] Settings & BYOM #2** — Management API authenticates but never authorizes — scopes ignored, credential proxy reachable by any key. `src-tauri/src/engine/management_api.rs:167-197`
- **[High] Webhooks & Channel Pollers #1** — Smee relay `allowed_repos` origin gate is forgeable and HMAC is absent — anyone with the channel URL can inject arbitrary events. `src-tauri/src/engine/smee_relay.rs:384`

### D. Watermark / cursor / sync data-flow — 1C / 10H (of 24 total)
- **[Critical] Scheduler & Cron Agents #1** — Auto-backfill watermark is poisoned by skip-advances → missed runs silently never catch up. `src-tauri/src/engine/background.rs:1810`
- **[High] Cloud Sync & Deployment #1** — In-place mutations to rows older than the 24h resync window never reach the cloud (silent, permanent divergence). `src-tauri/src/cloud/sync/rows.rs:506`
- **[High] Companion Brain & Proactivity #2** — `delivered` nudges are never aged out — permanent dedupe starvation + unbounded table growth. `src-tauri/src/companion/proactive/mod.rs:175-217`
- **[High] Fleet Control #1** — Companion bridge silently no-ops — its only data source is refreshed solely by the Fleet page. `src/features/plugins/companion/useFleetCompanionBridge.ts:42-55`
- **[High] Messages & Notifications #1** — One persistently-failing webhook subscription pins the global watermark → unbounded duplicate re-delivery to healthy subscriptions + eventual loss of new notifications. `src-tauri/src/engine/webhook_notifier.rs:483-532`
- **[High] Obsidian Brain #1** — Drive cloud-sync round-trip silently drops every note that lives in a subfolder. `src-tauri/src/commands/obsidian_brain/drive.rs:493-519`
- **[High] Scheduler & Cron Agents #2** — User-initiated backfill has no idempotency and no rate cap → duplicate / cost-runaway runs. `src-tauri/src/commands/execution/scheduler.rs:98`
- **[High] Scheduler & Cron Agents #3** — Backfill replays in system-local time on an unparseable timezone while the live path refuses → wrong-hour runs. `src-tauri/src/engine/scheduler.rs:176-178`
- **[High] Triggers & Event Registry #1** — Live stream resets and drops its buffered events whenever the persona roster changes. `src/features/triggers/sub_live_stream/LiveStreamTab.tsx:61-71`
- **[High] Triggers & Event Registry #2** — Canvas-created event_listener triggers silently miss separator-variant events (matching asymmetry). `src-tauri/src/db/repos/resources/triggers.rs:1489-1496`
- **[High] Webhooks & Channel Pollers #3** — Slack poller skips messages on a burst larger than FETCH_LIMIT (cursor jumps to newest page, gap lost forever). `src-tauri/src/engine/slack_poller.rs:352-365`

### C. Races, atomicity & double-execution — 0C / 18H (of 48 total)
- **[High] Agent Lab & Versions #1** — A/B, Matrix and Eval share ONE run-lifecycle instance — concurrent runs clobber each other's "running" flag and progress. `src/stores/slices/agents/labSlice.ts:362`
- **[High] Agent Lab & Versions #2** — `activateVersion` is two non-atomic IPC calls — a failed model switch leaves the version rolled-in but the model stale. `src/stores/slices/agents/labSlice.ts:560`
- **[High] Build Sessions & PersonaMatrix #2** — simulate_build_draft's RAII `DesignContextRestore` clobbers a concurrent promote's design_context. `src-tauri/src/commands/design/build_simulate.rs:211-221,`
- **[High] Capabilities, Use Cases & Model Config #2** — Manual "Run" double-submits real paid executions on a fast double-click. `src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts:89-90`
- **[High] Cockpit, Voice & Sensory #3** — TTS/STT subprocess spawns have no concurrency guard — overlapping synth/transcribe can stack unbounded. `src-tauri/src/commands/companion/voice.rs:33`
- **[High] Companion Brain & Proactivity #1** — Wake gate is a non-atomic read — message_triage & channel_reactions lack the reentrancy guard exec_triage has, so concurrent reachability double-fires the autonomous CLI. `src-tauri/src/companion/proactive/message_triage.rs:261-304`
- **[High] Execution Runner & Inspector #1** — Idempotency key is regenerated every call, so the backend dedup never fires — a timed-out run, then a retry, double-spawns (double API spend). `src/stores/slices/agents/executionSlice.ts:307`
- **[High] Execution Runner & Inspector #2** — Switching personas (or startup recovery) drops the focused run's terminal status event — `isExecuting` stays pinned for up to 30 min, forcing every new run into background mode. `src/hooks/execution/usePersonaExecution.ts:29-34`
- **[High] Incidents & Manual Review #1** — Open-duplicate guard silently drops distinct concurrent blocked-execution incidents → abandoned work, no continuation. `src-tauri/src/db/repos/execution/audit_incidents.rs:167-187`
- **[High] Incidents & Manual Review #2** — team_assignments resume swallows a DB error as "no failed steps" AFTER claiming → parked assignment never resumes. `src-tauri/src/engine/incident_continuation.rs:110-133`
- **[High] Onboarding Tour #1** — Stale scheduled side effects fire after a rapid step change (timeouts only cleared on tour-end, not on step change). `src/features/onboarding/components/GuidedTour.tsx:194`
- **[High] Repositories & Models #1** — Idempotency check-then-insert is a TOCTOU race; concurrent same-key creates hard-error instead of deduping. `src-tauri/src/db/repos/execution/executions.rs:435`
- **[High] Research Lab #1** — `create_source` dedup is a check-then-insert race → duplicate sources. `src-tauri/src/db/repos/research_lab.rs:172-240`
- **[High] Self-Healing & Auto-Rollback #1** — AI healing and auto-rollback both mutate the live persona prompt with no shared lock; healing never snapshots a version, so rollback silently reverts heals. `src-tauri/src/engine/ai_healing.rs:373-385`
- **[High] Shared UI Component Library #3** — The canonical Button (and AsyncButton) has no synchronous double-submit guard, but the catalog implies AsyncButton "disables itself". `src/features/shared/components/buttons/Button.tsx:126`
- **[High] Tauri IPC Bridge & API #2** — Orphaned mutation on timeout — no invoke cancellation; post-timeout retry double-executes. `src/lib/tauriInvoke.ts:401`
- **[High] Team Assignment & Handoff #2** — Lost resume: single-flight slot is released only after the loop fully exits. `src-tauri/src/engine/team_assignment_orchestrator.rs:149–157`
- **[High] Webhooks & Channel Pollers #2** — Concurrent webhook deliveries to the same trigger return 500 and drop the event (optimistic-version conflict conflated with publish). `src-tauri/src/engine/webhook.rs:578`

### E. Wrong metric / unit / threshold math — 0C / 14H (of 46 total)
- **[High] Dashboard & Mission Control #1** — `overall_success_rate` is a 0..1 ratio but compared against `80` — "Fleet Running Smoothly" card is dead code. `src/features/overview/libs/fleetOptimizer.ts:271`
- **[High] Dashboard & Mission Control #3** — Per-persona success rate counts ALL healing issues (resolved + auto-fixed) as failed executions. `src/features/overview/libs/fleetOptimizer.ts:101-107`
- **[High] Database Schema & Migrations #1** — chat_messages role-CHECK probe is contaminated by FK enforcement → destructive table rebuild on every startup. `src-tauri/src/db/migrations/incremental.rs:2039-2070`
- **[High] Genome & Evolution #1** — Failed evolution cycles never advance `last_cycle_at`, causing an auto-trigger retry storm. `src-tauri/src/engine/evolution.rs:184-198,`
- **[High] Genome & Evolution #2** — Breeding pipeline is fitness "success theater": parent fitness computed-then-discarded, offspring fitness never computed, "top offspring" selection is arbitrary. `src-tauri/src/commands/execution/genome.rs:172-188`
- **[High] Home & Roadmap #2** — "Success rate" denominator counts non-terminal executions → misleading low green rate + suppressed failure spike. `src/features/home/sub_welcome/FleetHealthStrip.tsx:39-41`
- **[High] Knowledge Base & Memories #1** — Merge resolution silently deletes core-pinned memories and discards tier / use_case scope / persona attribution. `src/features/overview/sub_memories/components/MemoryConflictReview.tsx:72-76`
- **[High] Knowledge Base & Memories #2** — LLM memory review overwrites user-curated importance with a coarse score→importance map (runs automatically, includes core). `src-tauri/src/commands/core/memories.rs:549-573`
- **[High] Persona Editor & CRUD #1** — Auto-icon-assign gate checks `v1` but the migration writes `v2` — redundant `listPersonas()` + full store replacement on every load. `src/stores/slices/agents/personaSlice.ts:138`
- **[High] Persona Templates #2** — Recipe-ref hydration failure is swallowed → silent partial/empty adoption reported as success. `src-tauri/src/commands/design/template_adopt.rs:292-301`
- **[High] Personas Twin #1** — Brain milestone can never be `'empty'` — auto-generated `obsidian_subpath` permanently inflates every twin's readiness. `src/features/plugins/twin/useTwinReadiness.ts:75-77`
- **[High] Recipes & Use-Case Blueprints #1** — Suggestion threshold 0.90 is effectively unreachable — the recipe typeahead silently never fires. `src-tauri/src/engine/recipe_matcher.rs:33`
- **[High] Settings & BYOM #3** — Cost-routing rules for Simple/Critical silently no-op — executions run on the unintended provider/model. `src-tauri/src/engine/byom.rs:515-547`
- **[High] Team Assignment & Handoff #1** — Manual review "Edit"/"Reassign" never restores the cascade-skipped pipeline tail. `src-tauri/src/engine/team_assignment_orchestrator.rs:182,`

### A. Silent failures & success-theater — 0C / 12H (of 36 total)
- **[High] Agent Chat #2** — Background-chat success is decided by `status.includes("fail")` substring — incomplete/cancelled/unknown turns are reported as a real reply. `src/stores/slices/agents/backgroundChatSlice.ts:378`
- **[High] Approvals & Decisions #1** — Orb decision `run()` handlers swallow failures, defeating the documented "keep-pending-on-failure" safety net. `src/features/plugins/companion/decision/useDecisionQueue.ts:101-111`
- **[High] Capabilities, Use Cases & Model Config #1** — Budget UI/pause number is not the number the server actually enforces. `src/stores/slices/agents/budgetEnforcementSlice.ts:78-92`
- **[High] Cockpit, Voice & Sensory #2** — Local STT assumes the WebView honors `sampleRate: 16000`; no resample fallback, and the backend hard-rejects anything ≠16 kHz. `src/features/plugins/companion/useLocalDictation.ts:156`
- **[High] Companion Runtime & Chat #1** — "Ask Athena" / External user actions are silently dropped when any turn is in flight. `src-tauri/src/companion/session.rs:386`
- **[High] Dashboard & Mission Control #2** — UpcomingRoutinesCard fetches triggers once and never refetches — rows silently disappear over a session. `src/features/overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx:61-72`
- **[High] Director & Leadership #1** — `json_path` parser returns an intermediate numeric node when the path doesn't fully match. `src-tauri/src/engine/kpi_eval.rs:258-276`
- **[High] MCP Gateways & Tools #1** — Transient gateway-member failure caches a degraded/empty tool list for 60s (silent capability loss). `src-tauri/src/engine/mcp_tools.rs:617`
- **[High] Observability & Alerts #1** — Alert history panel silently hides every alert past the 50 newest. `src/features/overview/sub_observability/components/AlertHistoryPanel.tsx:97`
- **[High] Persona Templates #3** — Preset adoption silently drops every questionnaire answer that isn't a `persona.parameters[…]` mapping. `src-tauri/src/engine/team_preset_adopter.rs:357-364`
- **[High] Pipeline & Agent Chains #1** — Conditional skip does not propagate to non-conditional descendants — they run on the global pipeline input. `src-tauri/src/engine/pipeline_executor.rs:1066`
- **[High] Team Builder & Workspace #1** — Preset adoption silently produces a non-cascading team when handoff wiring fails. `src-tauri/src/engine/team_preset_adopter.rs:541`

### J. Unclear intent & uncovered edge cases — 0C / 6H (of 34 total)
- **[High] Credential Design & Negotiation #1** — Blast-radius severity ignores affected events → user told "safe to delete" a credential that still powers live event triggers. `src/features/vault/sub_dependencies/credentialGraph.ts:193`
- **[High] Design Reviews & Diagrams #1** — Activity-diagram footer crashes on the exact malformed flow FlowDiagram was built to survive. `src/features/templates/sub_diagrams/ActivityDiagramModal.tsx:130-133`
- **[High] Google Drive #2** — `AsyncColumnEntries` effect re-runs every render → looping `drive_list` IPC for uncached columns. `src/features/plugins/drive/components/DriveFileList.tsx:1045-1063`
- **[High] Messages & Notifications #2** — First notification subscription (or any created after a no-subscription gap) is flooded with the entire historical event backlog. `src-tauri/src/engine/webhook_notifier.rs:451-467,`
- **[High] State Management (Zustand) #2** — Design-context selectors claim `Object.is` ref-stability, but the underlying `parseDesignContext` LRU(1) is a shared global that other persona components evict every render. `src/stores/selectors/personaSelectors.ts:21-33`
- **[High] Tauri IPC Bridge & API #1** — TwinChannelKind enum drift: TS union is a superset Rust rejects at runtime. `src/api/enums.ts:40`

### H. Bounds, truncation & resource growth — 0C / 2H (of 11 total)
- **[High] Analytics, SLA & Usage #1** — Empty / low-activity SLA window renders a misleading red "0.0%" success rate. `src/features/overview/sub_sla/components/SLADashboard.tsx:95`
- **[High] Artist Studio #2** — Grid renders full-resolution base64 as "thumbnails" and caches them by count, not bytes — multi-hundred-MB to multi-GB renderer heap. `src/features/plugins/artist/hooks/useLocalImage.ts:10`

### F. Partial-state, atomicity & data-loss — 0C / 2H (of 5 total)
- **[High] Recipes & Use-Case Blueprints #2** — Eligibility is "vacuously Eligible" whenever tool_hints[] is absent and ignores connectors — a false green light that seeds a non-functional persona. `src-tauri/src/engine/recipe_eligibility.rs:126-134`
- **[High] Self-Healing & Auto-Rollback #2** — Auto-rollback's "known-good" target has no minimum-execution floor, so it can roll back onto a version whose 0% error rate is a single lucky run. `src-tauri/src/engine/auto_rollback.rs:242-266`

### I. Time, timezone & clock — 0C / 2H (of 2 total)
- **[High] Google Drive #1** — "Google Drive" context is actually a local sandbox filesystem; bundled OAuth file gates nothing. `src-tauri/src/commands/drive.rs:1-8`
- **[High] Internationalization (i18n) #1** — Arabic ships as a locale but RTL is never applied — `dir` is dead metadata. `src/stores/i18nStore.ts:54-66`

### G. Built-but-unwired / dead code — 0C / 1H (of 12 total)
- **[High] Build Sessions & PersonaMatrix #1** — WorkflowCompiler persists the *unvalidated* blueprint — validation runs on a throwaway clone (panic + dead drop-invalid recovery). `src-tauri/src/engine/workflow_compiler.rs:177-180,`


---

## Suggested fix-wave split

Each wave is one focused session (~5–7 atomic, finding-referenced commits, single mental model). Ordered by value: the 6 criticals are spread across Waves 1–4 so they land first, then the highest-value Highs by theme. Mediums (152) and Lows (21) form a follow-up tail after the C+H working set (87 items) is closed.

| Wave | Theme | Headline contents | ~Size |
|---|---|---|---:|
| **1** | Security — code-exec / SSRF / path-safety | Crypto binary-allowlist basename bypass **(C)**, SSRF DNS filter misses CGNAT/IPv4-mapped-v6 **(C)**, path_safety symlink + sibling-dir escapes (H,H), scope_enforcement fail-open (M) | 5 |
| **2** | Security — auth / trust-boundary bypass | Template-integrity check inert **(C)**, BYOM compliance fails open **(C)**, management-API ignores scopes (H), smee relay unauth event injection (H), GitHub owner/repo path interpolation (H) | 5 |
| **3** | Scheduler + watermark / sync data-flow | Cron backfill watermark poisoned **(C)**, user-backfill no-dedupe ×100 (H), webhook_notifier watermark pins → dup re-delivery (H), cloud-sync in-place mutations never resync (H), messages relay watermark drop (H) | 5 |
| **4** | Races, atomicity & double-execution | STT engine-switch strands mic **(C)**, idempotency-key regen double-spawn (H), repo idempotency TOCTOU hard-error (H), companion wake-gate non-atomic double-fire (H), "Ask Athena" try_lock drops user turn (H), shared Button double-submit (H) | 6 |
| **5** | Silent failures & success-theater | Genome failed-cycle retry storm (H), self-healing↔rollback prompt clobber (H), template-adoption swallow → partial persona (H), team-adoption swallow → silent partial team (H), incident dedup abandons executions (H), orb-decision swallow → false "done" (H) | 6 |
| **6** | Wrong metric / unit / threshold math | Intent-compiler /1K vs /1M = 1000× cost error (H), SLA 0% no-data conflation (H), dashboard ratio-vs-%% dead "Fleet Smoothly" card (H), connector `contains("google")` mis-route (H), recipe-eligibility false-green adopt (H), director json_path records wrong intermediate (H) | 6 |
| **7** | Execution / lifecycle reliability | Execution persona-switch drops terminal event (H), cancel abandons run on backend-fail (H), dead-letter persists empty Failed (H), lab shared matrixLifecycle clobber (H), activateVersion non-atomic (H) | 5–6 |
| **8** | Credential / vault data-loss & secrets | Vault edit DELETE-all wipes unsubmitted fields (H), decrypt empty-iv sentinel (H), blast-radius under-counts (H), credential-design URL echo leaks secret (H), Telegram bot_token in URL leaks via logs (H) | 5–6 |
| **9** | Companion / voice / fleet | STT sidecar concurrency (H), STT sampleRate hard-reject (H), fleet bridge records nothing unless tab open (H), pipeline conditional-skip mis-threads output (H), team-assignment manual-resolve skips cascade (H), lost-resume race (H) | 6 |
| **10** | Knowledge / memory / data integrity | Memory merge deletes pinned core memories (H), LLM review clobbers importance (H), webhooks Slack-poller burst skip (H), trigger event-type match mismatch (H), live-stream buffer wipe (H) | 5–6 |
| **11+** | Remaining Highs + UI/i18n/IPC | Arabic RTL never applied (H), TwinChannelKind enum drift (H), chat finalize ignores terminal status (H), Drive IPC list loop (H), artist delete leaks files (H), …and the rest of the 81 Highs not above | bal. |
| **tail** | Mediums (152) + Lows (21) | Per-context Med/Low — batch by file/theme after C+H working set closes | tail |

**Working set = 6 Critical + 81 High = 87 items** across ~11–13 waves. Suggested order honors: (1) criticals first, (2) security & data-loss before cosmetic, (3) one mental model per wave so fixes compound.

---

## How this scan was run

- **Scanners**: `ambiguity-guardian` + `bug-hunter` (Vibeman registry, `src/lib/prompts/registry/agents/`), combined per context.
- **Mode**: one subagent per context applied BOTH lenses and returned the top-5 highest-value findings (value = impact×likelihood ÷ effort), a mix of both lenses.
- **Scope**: all 52 contexts, full-stack (client `src/` + Rust `src-tauri/`), 402 declared file paths + subagent-followed dependencies.
- **Dispatch**: 7 waves of ≤8 parallel general-purpose subagents; orchestrator read only terse replies (not the reports) during scanning to keep context bounded.
- **Volume**: ~1,150 files read across all subagents (≈22/context incl. followed deps).
- **Verification**: findings counted two ways — `> Total:` headers sum = 260; `- **Severity**:` bullets = 260 (match).
- **Context-map drift noted** (stale paths self-corrected by subagents): `triggers/sub_builder/EventCanvas.tsx` → `sub_studio/routing/`; `stores/slices/overview/index.ts` → `overviewSlice.ts`; `api/fleet/index.ts` → `fleet.ts`; `api/twin/index.ts` → `twin.ts`; `api/researchLab/index.ts` → `researchLab.ts`; `engine/backend.rs` → `execution_engine/mod.rs`. Several files only resolve under `.claude/worktrees/*`.
- **Baseline**: `tsc` 0 errors; `vitest` 1972 pass / 7 pre-existing fails (commandPaletteUtils, shortcutRegistry, narrationTimeline×2, FleetBroadcastModal×3, useBuild) — the regression baseline for fix waves.
