# Code-Refactor + Perf-Optimizer Scan — Personas, 2026-07-16

> Dual-lens audit (code-refactor + perf-optimizer, max 3 findings/lens/context) over ALL 227 contexts / 12 groups (3,566 mapped files; 3,517 read, 49 missing due to post-map drift).
> 227 parallel subagent runs via workflow wf_b0c149db-fe4.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 227 contexts | 1 | 131 | 583 | 343 | **1058** |
| Share | 0.1% | 12.4% | 55.1% | 32.4% | 100% |

Counts verified two ways (header sum = severity-bullet sum = 1058).

---

## Per-context breakdown (sorted by criticals, then highs)

Only contexts with >=1 High shown here; full list in per-context reports.

| Context | Group | C | H | M | L | Total |
|---|---|---:|---:|---:|---:|---:|
| [recipes-playground](recipes-playground.md) | Templates & Recipes | 1 | 1 | 2 | 1 | 5 |
| [tauri-commands-infrastructure-1-3](tauri-commands-infrastructure-1-3.md) | Backend Data & Commands | 0 | 3 | 3 | 0 | 6 |
| [agents-use-cases-1-2](agents-use-cases-1-2.md) | Persona Authoring & Design | 0 | 2 | 3 | 1 | 6 |
| [hooks-utility-1-3](hooks-utility-1-3.md) | Core Libraries & State | 0 | 2 | 3 | 1 | 6 |
| [lib-utils-1-2](lib-utils-1-2.md) | Core Libraries & State | 0 | 2 | 3 | 1 | 6 |
| [plugins-artist-1-2](plugins-artist-1-2.md) | Plugins & Companion | 0 | 2 | 4 | 0 | 6 |
| [plugins-dev-tools-1-3](plugins-dev-tools-1-3.md) | Plugins & Companion | 0 | 2 | 3 | 1 | 6 |
| [plugins-dev-tools-2-3](plugins-dev-tools-2-3.md) | Plugins & Companion | 0 | 2 | 2 | 2 | 6 |
| [plugins-drive](plugins-drive.md) | Plugins & Companion | 0 | 2 | 2 | 2 | 6 |
| [schedules-misc](schedules-misc.md) | Execution & Orchestration | 0 | 2 | 3 | 1 | 6 |
| [tauri-commands-companion-1-2](tauri-commands-companion-1-2.md) | Backend Data & Commands | 0 | 2 | 3 | 1 | 6 |
| [tauri-commands-credentials-1-2](tauri-commands-credentials-1-2.md) | Backend Data & Commands | 0 | 2 | 2 | 2 | 6 |
| [tauri-companion-brain-1-2](tauri-companion-brain-1-2.md) | Plugins & Companion | 0 | 2 | 3 | 1 | 6 |
| [tauri-db-repos-1-6](tauri-db-repos-1-6.md) | Backend Data & Commands | 0 | 2 | 4 | 0 | 6 |
| [tauri-engine-1-10](tauri-engine-1-10.md) | Backend Engine & Runtime | 0 | 2 | 4 | 0 | 6 |
| [tauri-engine-2-10](tauri-engine-2-10.md) | Backend Engine & Runtime | 0 | 2 | 3 | 1 | 6 |
| [triggers-triggers-1-3](triggers-triggers-1-3.md) | Execution & Orchestration | 0 | 2 | 2 | 2 | 6 |
| [agents-connectors](agents-connectors.md) | Credentials & Connectors | 0 | 2 | 2 | 1 | 5 |
| [agents-design](agents-design.md) | Persona Authoring & Design | 0 | 2 | 2 | 1 | 5 |
| [overview-components](overview-components.md) | Observability & Monitoring | 0 | 2 | 2 | 1 | 5 |
| [overview-memories](overview-memories.md) | Observability & Monitoring | 0 | 2 | 2 | 1 | 5 |
| [tauri-db-misc](tauri-db-misc.md) | Backend Data & Commands | 0 | 2 | 2 | 1 | 5 |
| [tauri-engine-9-10](tauri-engine-9-10.md) | Backend Engine & Runtime | 0 | 2 | 1 | 2 | 5 |
| [teams-misc](teams-misc.md) | Execution & Orchestration | 0 | 2 | 3 | 0 | 5 |
| [templates-n8n-1-2](templates-n8n-1-2.md) | Templates & Recipes | 0 | 2 | 3 | 0 | 5 |
| [tauri-commands-obsidian-brain](tauri-commands-obsidian-brain.md) | Backend Data & Commands | 0 | 2 | 2 | 0 | 4 |
| [api-system](api-system.md) | Core Libraries & State | 0 | 2 | 0 | 1 | 3 |
| [tauri-utils-misc](tauri-utils-misc.md) | Core Libraries & State | 0 | 2 | 0 | 1 | 3 |
| [agents-components-1-2](agents-components-1-2.md) | Persona Authoring & Design | 0 | 1 | 4 | 1 | 6 |
| [agents-editor](agents-editor.md) | Persona Authoring & Design | 0 | 1 | 2 | 3 | 6 |
| [agents-executions-2-4](agents-executions-2-4.md) | Execution & Orchestration | 0 | 1 | 3 | 2 | 6 |
| [agents-lab-1-2](agents-lab-1-2.md) | Agent Lab & Evolution | 0 | 1 | 5 | 0 | 6 |
| [agents-misc](agents-misc.md) | Persona Authoring & Design | 0 | 1 | 3 | 2 | 6 |
| [home-cockpit](home-cockpit.md) | App Shell, Settings & Sharing | 0 | 1 | 4 | 1 | 6 |
| [hooks-misc](hooks-misc.md) | Core Libraries & State | 0 | 1 | 3 | 2 | 6 |
| [hooks-realtime](hooks-realtime.md) | Core Libraries & State | 0 | 1 | 2 | 3 | 6 |
| [overview-manual-review](overview-manual-review.md) | Observability & Monitoring | 0 | 1 | 4 | 1 | 6 |
| [overview-observability-1-2](overview-observability-1-2.md) | Observability & Monitoring | 0 | 1 | 3 | 2 | 6 |
| [overview-realtime](overview-realtime.md) | Observability & Monitoring | 0 | 1 | 5 | 0 | 6 |
| [plugins-companion-1-4](plugins-companion-1-4.md) | Plugins & Companion | 0 | 1 | 4 | 1 | 6 |
| [plugins-research-lab-1-2](plugins-research-lab-1-2.md) | Plugins & Companion | 0 | 1 | 4 | 1 | 6 |
| [shared-chrome](shared-chrome.md) | Shared UI & Design System | 0 | 1 | 4 | 1 | 6 |
| [shared-components-2-4](shared-components-2-4.md) | Shared UI & Design System | 0 | 1 | 4 | 1 | 6 |
| [tauri-commands-design-1-2](tauri-commands-design-1-2.md) | Backend Data & Commands | 0 | 1 | 3 | 2 | 6 |
| [tauri-commands-misc](tauri-commands-misc.md) | Backend Data & Commands | 0 | 1 | 4 | 1 | 6 |
| [tauri-companion-misc](tauri-companion-misc.md) | Plugins & Companion | 0 | 1 | 4 | 1 | 6 |
| [tauri-companion](tauri-companion.md) | Plugins & Companion | 0 | 1 | 3 | 2 | 6 |
| [tauri-engine-7-10](tauri-engine-7-10.md) | Backend Engine & Runtime | 0 | 1 | 4 | 1 | 6 |
| [tauri-engine-p2p](tauri-engine-p2p.md) | Backend Engine & Runtime | 0 | 1 | 4 | 1 | 6 |
| [tauri-mcp-server-misc](tauri-mcp-server-misc.md) | Core Libraries & State | 0 | 1 | 3 | 2 | 6 |
| [triggers-misc](triggers-misc.md) | Execution & Orchestration | 0 | 1 | 4 | 1 | 6 |
| [agents-deployment](agents-deployment.md) | Agent Lab & Evolution | 0 | 1 | 3 | 1 | 5 |
| [agents-lab-2-2](agents-lab-2-2.md) | Agent Lab & Evolution | 0 | 1 | 3 | 1 | 5 |
| [api-vault](api-vault.md) | Core Libraries & State | 0 | 1 | 2 | 2 | 5 |
| [fleet-monitor](fleet-monitor.md) | Observability & Monitoring | 0 | 1 | 2 | 2 | 5 |
| [home-welcome](home-welcome.md) | App Shell, Settings & Sharing | 0 | 1 | 3 | 1 | 5 |
| [hooks-design-1-2](hooks-design-1-2.md) | Core Libraries & State | 0 | 1 | 3 | 1 | 5 |
| [hooks-execution](hooks-execution.md) | Core Libraries & State | 0 | 1 | 3 | 1 | 5 |
| [hooks-utility-2-3](hooks-utility-2-3.md) | Core Libraries & State | 0 | 1 | 2 | 2 | 5 |
| [lib-execution](lib-execution.md) | Core Libraries & State | 0 | 1 | 3 | 1 | 5 |
| [lib-misc-2](lib-misc-2.md) | Core Libraries & State | 0 | 1 | 2 | 2 | 5 |
| [onboarding-components](onboarding-components.md) | App Shell, Settings & Sharing | 0 | 1 | 3 | 1 | 5 |
| [overview-incidents](overview-incidents.md) | Observability & Monitoring | 0 | 1 | 2 | 2 | 5 |
| [overview-usage](overview-usage.md) | Observability & Monitoring | 0 | 1 | 4 | 0 | 5 |
| [personas-misc](personas-misc.md) | Persona Authoring & Design | 0 | 1 | 3 | 1 | 5 |
| [plugins-companion-3-4](plugins-companion-3-4.md) | Plugins & Companion | 0 | 1 | 3 | 1 | 5 |
| [recipes-misc](recipes-misc.md) | Templates & Recipes | 0 | 1 | 2 | 2 | 5 |
| [schedules-components](schedules-components.md) | Execution & Orchestration | 0 | 1 | 3 | 1 | 5 |
| [stores-slices-2-3](stores-slices-2-3.md) | Core Libraries & State | 0 | 1 | 4 | 0 | 5 |
| [studio](studio.md) | Persona Authoring & Design | 0 | 1 | 2 | 2 | 5 |
| [tauri-cloud-misc](tauri-cloud-misc.md) | Core Libraries & State | 0 | 1 | 2 | 2 | 5 |
| [tauri-commands-core](tauri-commands-core.md) | Backend Data & Commands | 0 | 1 | 3 | 1 | 5 |
| [tauri-db-repos-3-6](tauri-db-repos-3-6.md) | Backend Data & Commands | 0 | 1 | 3 | 1 | 5 |
| [tauri-db-repos-4-6](tauri-db-repos-4-6.md) | Backend Data & Commands | 0 | 1 | 3 | 1 | 5 |
| [tauri-engine-10-10](tauri-engine-10-10.md) | Backend Engine & Runtime | 0 | 1 | 1 | 3 | 5 |
| [tauri-engine-6-10](tauri-engine-6-10.md) | Backend Engine & Runtime | 0 | 1 | 2 | 2 | 5 |
| [tauri-engine-project-tracking](tauri-engine-project-tracking.md) | Backend Engine & Runtime | 0 | 1 | 3 | 1 | 5 |
| [tauri-webbuild](tauri-webbuild.md) | Core Libraries & State | 0 | 1 | 2 | 2 | 5 |
| [teams-canvas-1-2](teams-canvas-1-2.md) | Execution & Orchestration | 0 | 1 | 2 | 2 | 5 |
| [templates-generated-2-5](templates-generated-2-5.md) | Templates & Recipes | 0 | 1 | 3 | 1 | 5 |
| [triggers-studio-1-3](triggers-studio-1-3.md) | Execution & Orchestration | 0 | 1 | 1 | 3 | 5 |
| [vault-credentials-2-4](vault-credentials-2-4.md) | Credentials & Connectors | 0 | 1 | 2 | 2 | 5 |
| [vault-credentials-3-4](vault-credentials-3-4.md) | Credentials & Connectors | 0 | 1 | 1 | 3 | 5 |
| [vault-databases-2-2](vault-databases-2-2.md) | Credentials & Connectors | 0 | 1 | 2 | 2 | 5 |
| [agents-executions-4-4](agents-executions-4-4.md) | Execution & Orchestration | 0 | 1 | 2 | 1 | 4 |
| [agents-glyph-2-2](agents-glyph-2-2.md) | Persona Authoring & Design | 0 | 1 | 2 | 1 | 4 |
| [agents-model-config](agents-model-config.md) | Persona Authoring & Design | 0 | 1 | 1 | 2 | 4 |
| [lib-harness](lib-harness.md) | Core Libraries & State | 0 | 1 | 3 | 0 | 4 |
| [overview-activity](overview-activity.md) | Observability & Monitoring | 0 | 1 | 2 | 1 | 4 |
| [overview-leaderboard](overview-leaderboard.md) | Observability & Monitoring | 0 | 1 | 2 | 1 | 4 |
| [tauri-commands-recipes](tauri-commands-recipes.md) | Backend Data & Commands | 0 | 1 | 1 | 2 | 4 |
| [teams-teamworkspace-2-2](teams-teamworkspace-2-2.md) | Execution & Orchestration | 0 | 1 | 1 | 2 | 4 |
| [api](api.md) | Core Libraries & State | 0 | 1 | 1 | 1 | 3 |
| [plugins-dev-tools-3-3](plugins-dev-tools-3-3.md) | Plugins & Companion | 0 | 1 | 2 | 0 | 3 |
| [plugins-fleet-2-2](plugins-fleet-2-2.md) | Plugins & Companion | 0 | 1 | 0 | 2 | 3 |
| [tauri-commands-design-2-2](tauri-commands-design-2-2.md) | Backend Data & Commands | 0 | 1 | 2 | 0 | 3 |
| [tauri-daemon-misc](tauri-daemon-misc.md) | Core Libraries & State | 0 | 1 | 1 | 1 | 3 |
| [tauri-db-models-2-4](tauri-db-models-2-4.md) | Backend Data & Commands | 0 | 1 | 1 | 1 | 3 |
| [tauri-validation-misc](tauri-validation-misc.md) | Core Libraries & State | 0 | 1 | 1 | 1 | 3 |
| [teams-canvas-2-2](teams-canvas-2-2.md) | Execution & Orchestration | 0 | 1 | 2 | 0 | 3 |
| [vault-misc](vault-misc.md) | Credentials & Connectors | 0 | 1 | 0 | 2 | 3 |
| [plugins-misc](plugins-misc.md) | Plugins & Companion | 0 | 1 | 1 | 0 | 2 |
| [tauri-db-models-3-4](tauri-db-models-3-4.md) | Backend Data & Commands | 0 | 1 | 1 | 0 | 2 |

(124 further contexts have Medium/Low findings only.)

---

## All 132 Critical + High findings, by theme

### A. Unbounded loops & runaway refetch (incl. the 1 Critical) — 10 findings

- **[CRITICAL]** **recipes-playground #1** [perf-optimizer/rerender] — Infinite setState loop in useRecipeTestRunner merge effect after LLM completion — `src/features/recipes/sub_playground/libs/useRecipeTestRunner.ts:27`
- **agents-design #1** [perf-optimizer/wasted-work] — Auto-start design effect cancels itself — compile never fires, orphaned conversation row per attempt — `src/features/agents/sub_design/libs/useDesignTabState.ts:66-96`
- **agents-model-config #1** [perf-optimizer/refetch-loop] — Infinite arena-results refetch loop after a comparison completes — `src/features/agents/sub_model_config/components/compare/ModelABCompare.tsx:33`
- **home-cockpit #1** [perf-optimizer/refetch-loop] — Unconditional metrics refetch on every `personas` change + potential IPC refetch loop on empty fleet — `src/features/home/sub_cockpit/CockpitPanel.tsx:65`
- **overview-activity #1** [perf-optimizer/fetch-loop] — `pendingExecutionFocus` fallback fetch can loop indefinitely when the target row never loads — `src/features/overview/sub_activity/components/GlobalExecutionList.tsx:181`
- **overview-leaderboard #1** [perf-optimizer/unbounded-retry] — Auto-load effect becomes an infinite refresh loop when the fleet is empty or health compute keeps failing — `src/features/overview/sub_leaderboard/components/LeaderboardPage.tsx:21`
- **teams-misc #4** [perf-optimizer/leak] — Deliberation `approveAction` can poll for up to 20 minutes after unmount with no cancellation — `src/features/teams/sub_deliberations/useTeamDeliberations.ts:184-211`
- **triggers-triggers-1-3 #1** [perf-optimizer/refetch-loop] — Infinite refetch loop when a webhook trigger has zero request logs — `src/features/triggers/sub_triggers/WebhookRequestInspector.tsx:198`
- **triggers-triggers-1-3 #2** [perf-optimizer/refetch-loop] — Same infinite refetch loop in TriggerExecutionHistory for triggers with no executions — `src/features/triggers/sub_triggers/TriggerExecutionHistory.tsx:152`
- **vault-credentials-3-4 #1** [perf-optimizer/fetch-loop] — Infinite blast-radius refetch loop while the delete dialog is open — `src/features/vault/sub_credentials/components/card/CredentialDeleteDialog.tsx:28`

### B. Broken caches & stale/frozen data — 6 findings

- **agents-editor #1** [perf-optimizer/state-churn] — Draft-reset effect keyed on `selectedPersona` object identity — resets draft/baseline and wipes undo history on every store persona update — `src/features/agents/sub_editor/hooks/useEditorDraft.ts:81`
- **hooks-misc #1** [perf-optimizer/stale-cancellation] — One-way `cancelled` flag permanently kills the dashboard pipeline after the first filter change — `src/hooks/overview/useExecutionDashboardPipeline.ts:186-191`
- **hooks-realtime #1** [perf-optimizer/stale-memo] — `stats` memo has empty deps — realtime stats panel is frozen at the initial empty snapshot — `src/hooks/realtime/useRealtimeEvents.ts:143`
- **hooks-utility-2-3 #1** [perf-optimizer/refetch-storm] — useAppSetting reloads (and clobbers edits) on every render when callers pass inline validators — `src/hooks/utility/data/useAppSetting.ts:52`
- **plugins-research-lab-1-2 #1** [perf-optimizer/data-layer-staleness] — Stale-cache heuristic skips fetching sources for the active project, silently degrading AI hypothesis generation — `src/features/plugins/research-lab/sub_hypotheses/HypothesesPanel.tsx:36`
- **tauri-engine-9-10 #1** [perf-optimizer/broken-cache] — Warm session reuse is a permanent no-op — offer/take hash different inputs — `src-tauri/src/engine/session_pool.rs:69`

### C. IPC chattiness — N+1, oversized payloads, missing caching — 18 findings

- **agents-misc #1** [perf-optimizer/duplicate-polling] — Quick Answer popover mounts the polling data layer twice — `src/features/agents/quick-answer/QuickAnswerPopover.tsx:24`
- **agents-use-cases-1-2 #4** [perf-optimizer/n-plus-one] — EventRenameModal fires up to 2 IPC listener-count queries per row on every keystroke — `src/features/agents/sub_use_cases/components/core/EventRenameModal.tsx:63`
- **api #1** [perf-optimizer/payload] — Drive file bytes cross IPC as JSON number arrays (`number[]` / `Array.from(Uint8Array)`) — `src/api/drive.ts:127-137`
- **fleet-monitor #1** [perf-optimizer/duplicate-polling] — useMonitorData is double-mounted by the Quick Answer popover — every poll cycle runs twice (thrice with the Monitor open) — `src/features/fleet/monitor/useMonitorData.ts:62`
- **overview-components #2** [perf-optimizer/wasted-queries] — Half of the health-check IPC calls fetch sections that are never rendered (environment/agents/subscriptions dropped by the 3-stub grid) — `src/features/overview/components/health/SystemHealthPanel.tsx:86`
- **plugins-companion-1-4 #1** [perf-optimizer/payload] — Brain Viewer type cards fetch the FULL item list for all 13 memory kinds just to show counts — `src/features/plugins/companion/BrainViewer.tsx:260-273`
- **plugins-companion-3-4 #1** [perf-optimizer/n-plus-one] — Full assignment-detail fetch on every TEAM_ASSIGNMENT_PROGRESS event, including step-level noise — `src/features/plugins/companion/useCompanionAssignmentBridge.ts:22`
- **plugins-dev-tools-2-3 #4** [perf-optimizer/duplicate-fetch] — MonitoringSection mounts useMonitoringPinpoints twice — duplicate credential fetch and a wasted full Sentry stats chain — `src/features/plugins/dev-tools/sub_llm_overview/MonitoringSection.tsx:29`
- **plugins-drive #2** [perf-optimizer/n-plus-one] — Multi-item move triggers a full refresh cascade per item (3N refetch IPC calls) — `src/features/plugins/drive/hooks/useDrive.ts:657`
- **schedules-misc #1** [perf-optimizer/n-plus-one] — useConflictPreview fires N parallel IPC calls per keystroke — no debounce, and unstable `existingEntries` in deps defeats the `sig` guard — `src/features/schedules/libs/useCronPreview.ts:387`
- **tauri-commands-companion-1-2 #4** [perf-optimizer/n-plus-one] — Brain Viewer episode list does up to 200 synchronous full-file disk reads per render — `src-tauri/src/commands/companion/brain.rs:288`
- **tauri-commands-core #1** [perf-optimizer/n-plus-one] — `get_export_stats` runs 2 queries per persona and fetches full test-suite rows (with scenario blobs) just to count them — `src-tauri/src/commands/core/data_portability.rs:308`
- **tauri-commands-design-2-2 #1** [perf-optimizer/payload] — list_design_conversations ships every conversation's full message history over IPC just to render a list — `src-tauri/src/db/repos/core/design_conversations.rs:23`
- **tauri-commands-misc #1** [perf-optimizer/missing-caching] — FFmpeg/ffprobe binary discovery re-runs full filesystem search on every command call — `src-tauri/src/commands/artist/ffmpeg.rs:88`
- **tauri-commands-obsidian-brain #1** [perf-optimizer/missing-caching] — Every graph command re-walks and re-reads the entire vault per invocation — `src-tauri/src/commands/obsidian_brain/graph.rs:96`
- **tauri-db-repos-1-6 #1** [perf-optimizer/n-plus-one] — Write-path memory dedup does a full per-persona table scan on every insert — `src-tauri/src/db/repos/core/memories.rs:879`
- **tauri-db-repos-4-6 #1** [perf-optimizer/payload] — append_single_message ships the full conversation back per appended message, defeating its own stated purpose — `src-tauri/src/db/repos/core/design_conversations.rs:149`
- **tauri-engine-1-10 #1** [perf-optimizer/n-plus-one] — `quota_cooldown_active` full-table LIKE scan runs synchronously on the async worker from ~10 subscription ticks — `src-tauri/src/engine/subscription.rs:1481`

### D. SQLite query efficiency & schema debt (Rust) — 4 findings

- **tauri-cloud-misc #1** [perf-optimizer/full-table-scan] — Non-sargable `datetime()` wrapper forces a full table scan on every sync pass, for every synced table — `src-tauri/src/cloud/sync/rows.rs:507`
- **tauri-db-misc #1** [perf-optimizer/startup-cost] — Entire migration chain re-executes on every app launch — no version stamp — `src-tauri/src/db/migrations/mod.rs:33`
- **tauri-db-models-3-4 #1** [code-refactor/stale-schema-reference] — MCP arena-results tool SELECTs columns the migration dropped — query always fails on migrated DBs — `src-tauri/src/mcp_server/tools.rs:2119`
- **tauri-db-repos-3-6 #1** [perf-optimizer/index-defeating-query] — Index-defeating `datetime()`/`strftime()` wrappers on `created_at` in team_channel queries — `src-tauri/src/db/repos/communication/team_channel.rs:88-92`

### E. Rust runtime hygiene — blocking calls, leaks, serial I/O — 13 findings

- **lib-harness #1** [perf-optimizer/redundant-work] — Full gate suite (including optional 3-minute `vite build`) reruns synchronously after every area iteration — `src/lib/harness/verifier.ts:144`
- **tauri-commands-credentials-1-2 #1** [perf-optimizer/blocking-in-async] — `blocking_lock()` on a tokio Mutex inside async KB-ingest commands (panic/thread-stall hazard) — `src-tauri/src/commands/credentials/vector_kb.rs:424`
- **tauri-commands-credentials-1-2 #2** [perf-optimizer/blocking-in-async] — Playwright availability check runs a blocking `npx` subprocess on the async runtime, uncached — `src-tauri/src/commands/credentials/auto_cred_browser.rs:1406`
- **tauri-commands-infrastructure-1-3 #4** [perf-optimizer/blocking-ipc] — dev_tools_start_competition runs `tsc --noEmit` and `cargo check` synchronously inside the IPC command — `src-tauri/src/commands/infrastructure/dev_tools/competitions.rs:27`
- **tauri-companion-brain-1-2 #1** [perf-optimizer/leak] — Timed-out one-shot Claude CLI child processes are never killed (orphaned process leak) — `src-tauri/src/companion/brain/recall_synthesis.rs:350`
- **tauri-daemon-misc #1** [perf-optimizer/churn-starvation] — Non-headless event ping-pong: daemon re-claims and releases the same events every 5s tick, and can starve headless events — `src-tauri/src/daemon/runtime.rs:76`
- **tauri-engine-2-10 #4** [perf-optimizer/resource-management] — Slack poller builds a fresh reqwest::Client per poll and per reply on a 5-second loop — `src-tauri/src/engine/slack_poller.rs:485`
- **tauri-engine-6-10 #1** [perf-optimizer/serial-io] — Polling triggers fetched strictly sequentially — one slow endpoint delays every other due trigger by up to 30s — `src-tauri/src/engine/polling.rs:184`
- **tauri-engine-9-10 #2** [perf-optimizer/resource-deadlock] — Verification command drains output only AFTER wait() — pipe-buffer deadlock on chatty commands — `src-tauri/src/engine/verification_command.rs:71`
- **tauri-engine-p2p #1** [perf-optimizer/leak] — MessageRouter inbox grows without bound on persona keys and is never drained — `src-tauri/src/engine/p2p/messaging.rs:153-175`
- **tauri-engine-project-tracking #1** [perf-optimizer/redundant-reprocessing] — Out-of-cadence consolidator re-feeds the full 24h event window, double-counting pulse deltas and re-billing Sonnet for already-consolidated events — `src-tauri/src/engine/project_tracking/push.rs:264`
- **tauri-utils-misc #1** [perf-optimizer/repeated-regex-compile] — `sanitize_secrets` recompiles 4 regexes on every call — `src-tauri/src/utils/sanitization.rs:20`
- **tauri-webbuild #1** [perf-optimizer/blocking-io] — Blocking dev-server health probe (up to ~2s) runs inside sync Tauri commands — main-thread UI stalls during boot polling — `src-tauri/src/webbuild/devserver.rs:193`

### F. Frontend render/stream churn & hot-path algorithms — 26 findings

- **agents-deployment #1** [perf-optimizer/rerender] — useDeploymentHealth effect loops forever: unstable array dep + unconditional setState — `src/features/agents/sub_deployment/hooks/useDeploymentHealth.ts:101`
- **agents-executions-2-4 #1** [perf-optimizer/rerender] — Replay terminal re-parses and re-highlights every visible line on every playback tick — `src/features/agents/sub_executions/replay/ReplayTerminalPanel.tsx:122`
- **agents-lab-2-2 #1** [perf-optimizer/broken-virtualization] — VirtualizedTableBody virtualization is wired to the wrong scroll element and breaks table layout when it kicks in — `src/features/agents/sub_lab/components/shared/VirtualizedTableBody.tsx:23`
- **hooks-design-1-2 #1** [perf-optimizer/rerender] — Identity useMemo does not stabilize `coverageServiceTypes` — heavy mount effect can refire every render — `src/hooks/design/template/useGalleryQuery.ts:113`
- **hooks-execution #1** [perf-optimizer/rerender] — Replay playback filters the full log array on every animation frame — `src/hooks/execution/useReplayTimeline.ts:112`
- **hooks-utility-1-3 #1** [perf-optimizer/rerender] — useDebouncedSave passes the `deps` array as a single effect dep — debounce restarts on every render — `src/hooks/utility/timing/useDebouncedSave.ts:68`
- **lib-execution #1** [perf-optimizer/rerender] — Normal-mode sink flush is unthrottled — rebuilds up to a 10k-line array and pushes a store update per output event — `src/lib/execution/executionSink.ts:130-135,`
- **lib-utils-1-2 #2** [perf-optimizer/allocation-hot-path] — `new Intl.NumberFormat` constructed on every format call — including per animation frame inside AnimatedCounter — `src/lib/utils/formatters.ts:76`
- **overview-incidents #1** [perf-optimizer/rerender] — Unstable `actions` + `focusedId` dependency re-render every incident row on every keypress — `src/features/overview/sub_incidents/components/IncidentsInbox.tsx:131`
- **overview-manual-review #1** [perf-optimizer/rerender] — Un-memoized `parseDecisions` JSON.parse on every render of ReviewFocusFlow — `src/features/overview/sub_manual-review/components/ReviewFocusFlow.tsx:96`
- **overview-memories #3** [perf-optimizer/quadratic-algorithm] — O(n²) conflict detection with per-pair bigram sets runs on the main thread — `src/features/overview/sub_memories/libs/memoryConflicts.ts:84`
- **overview-observability-1-2 #1** [perf-optimizer/rerender] — `useAnnotationComposer` memo is defeated every render, cascading into full Recharts re-renders — `src/features/overview/sub_observability/libs/useAnnotationData.ts:117`
- **plugins-artist-1-2 #4** [perf-optimizer/rerender] — Beat-anchor resolution effect floods the undo history and doubles renders on every anchored edit — `src/features/plugins/artist/sub_media_studio/MediaStudioPage.tsx:109`
- **plugins-dev-tools-1-3 #2** [perf-optimizer/rerender] — TaskRunnerPage re-renders the entire task queue on every streamed output line — `src/features/plugins/dev-tools/sub_runner/TaskRunnerPage.tsx:452`
- **recipes-misc #1** [perf-optimizer/rerender] — SchemaFieldBuilder row key derived from index + typed value causes remount (and focus loss) on every keystroke — `src/features/recipes/sub_editor/components/SchemaFieldBuilder.tsx:63`
- **recipes-playground #2** [perf-optimizer/unstable-effect-dep] — RecipeVersionsTab cleanup effect resets the active versioning stream on every progress line — `src/features/recipes/sub_playground/tabs/RecipeVersionsTab.tsx:55`
- **schedules-components #1** [perf-optimizer/rerender] — Every 30s poll re-renders the entire unvirtualized ScheduleRow list — `src/features/schedules/components/ScheduleTimeline.tsx:148`
- **schedules-misc #2** [perf-optimizer/quadratic-and-overcount] — detectConflicts double-counts events across overlapping sweep windows and does O(n^2) slice/Set allocation — `src/features/schedules/libs/calendarHelpers.ts:215-243`
- **shared-components-2-4 #1** [perf-optimizer/rerender] — AnimatedList creates new motion component types on every render, remounting the entire list — `src/features/shared/components/display/AnimatedList.tsx:90`
- **stores-slices-2-3 #1** [perf-optimizer/rerender] — Per-line store writes for streamed CLI output re-render subscribers on every line — `src/stores/slices/system/devToolsTaskSlice.ts:129`
- **studio #1** [perf-optimizer/rerender] — Every CLI stream delta triggers a full StudioPage re-render via wholesale `runtimes` subscription — `src/features/studio/StudioPage.tsx:52`
- **tauri-engine-7-10 #1** [perf-optimizer/quadratic-algorithm] — Dream replay builds O(n²) frame payload and does O(n²) depth resolution — `src-tauri/src/engine/dream_replay.rs:227`
- **templates-generated-2-5 #1** [perf-optimizer/repeated-parse] — Gallery difficulty/setup filters re-parse the full `design_result` JSON blob per template, per filter pass — up to 3× each — `src/features/templates/sub_generated/shared/templateComplexity.ts:53`
- **templates-n8n-1-2 #2** [perf-optimizer/hot-path-serialization] — DB-sync effect re-serializes the whole parse result on every dispatch, including per-line stream updates — `src/features/templates/sub_n8n/hooks/useN8nSession.ts:141`
- **triggers-misc #1** [perf-optimizer/rerender] — Per-event setState defeats the rAF ingest batching in LiveStreamTab — `src/features/triggers/sub_live_stream/LiveStreamTab.tsx:99-100`
- **vault-credentials-2-4 #1** [perf-optimizer/rerender] — Infinite dispatch/render loop after universal OAuth completes on catalog-form — `src/features/vault/sub_credentials/manager/useCatalogHandlers.ts:71-76`

### G. UI/logic correctness & bundle weight — 13 findings

- **agents-glyph-2-2 #1** [perf-optimizer/bundle-payload] — 310KB archetypeGlyphData.ts is eagerly bundled into the compose-surface chunk but only needed after a modal click — `src/features/agents/sub_glyph/personaCore/archetypeGlyphData.ts:1`
- **agents-lab-1-2 #1** [code-refactor/cleanup] — Broken i18n interpolation in success toast — user sees the raw template string — `src/features/agents/sub_lab/components/shared/ImprovePromptButton.tsx:97`
- **onboarding-components #1** [code-refactor/duplication] — TourLauncher counts progress from whatever tour was last active, not the tour it launches — `src/features/onboarding/components/TourLauncher.tsx:27`
- **overview-components #1** [code-refactor/correctness] — IPC_FALLBACKS is missing the 'environment' entry — fallback path crashes and the health panel spins forever — `src/features/overview/components/health/useHealthChecks.ts:11-28`
- **personas-misc #1** [code-refactor/consistency] — CreatePersonaEntry uses raw React.lazy — the exact pattern the codebase documents as the 2026-06-07 "bricked section" incident — `src/features/personas/sub_foundry/CreatePersonaEntry.tsx:4`
- **plugins-dev-tools-1-3 #1** [code-refactor/broken-dynamic-tailwind] — StatCard in CrossProjectMetadataModal builds Tailwind classes from template strings — all five stat tiles render unstyled — `src/features/plugins/dev-tools/sub_projects/CrossProjectMetadataModal.tsx:476`
- **plugins-dev-tools-2-3 #1** [code-refactor/dynamic-tailwind-class] — RacingProgress builds Tailwind classes from template strings — milestone colors silently render unstyled — `src/features/plugins/dev-tools/sub_lifecycle/competitions/RacingProgress.tsx:71`
- **tauri-commands-infrastructure-1-3 #3** [code-refactor/consistency] — research_lab.rs is the only command module in the context with no auth guards — `src-tauri/src/commands/infrastructure/research_lab.rs:22`
- **tauri-commands-recipes #1** [code-refactor/cleanup] — Over-escaped braces in the versioning prompt render invalid guidance to the LLM — `src-tauri/src/commands/recipes/recipe_versioning.rs:57-64`
- **tauri-engine-2-10 #1** [code-refactor/cleanup] — Raw byte-index string slicing in LLM eval can panic on multi-byte UTF-8 output — `src-tauri/src/engine/eval.rs:543`
- **tauri-validation-misc #1** [code-refactor/fragmented-validation] — `validate_config` silently no-ops on unparseable JSON, and two caller paths rely on it alone — webhook_secret requirement bypassable — `src-tauri/src/validation/trigger.rs:71`
- **teams-canvas-1-2 #1** [code-refactor/impure-updater] — Impure nested state updaters in useDebugger.executeStep — `src/features/teams/sub_canvas/libs/useDebugger.ts:68-100`
- **teams-canvas-2-2 #1** [perf-optimizer/bundle] — Eager barrel import in PersonasPage pulls the whole canvas feature (incl. @xyflow/react runtime) into the initial bundle — `src/features/teams/sub_canvas/index.ts:1`

### H. Dead code (grep-verified deletes) — 23 findings

- **agents-components-1-2 #1** [code-refactor/dead-code] — ViewPresetBar component is dead code — file survives only as a type/constant carrier — `src/features/agents/components/allPersonas/ViewPresetBar.tsx:69`
- **agents-connectors #1** [code-refactor/dead-code] — Dead feature cluster: DependencyGraphPanel + dependencyGraph lib (~610 LOC, zero importers) — `src/features/agents/sub_connectors/components/connectors/DependencyGraphPanel.tsx:157`
- **agents-connectors #2** [code-refactor/dead-code] — Dead hook cluster: useSubscriptionManager + subscriptionHelpers (~340 LOC, zero consumers) — `src/features/agents/sub_connectors/libs/subscriptionLifecycle.ts:41`
- **agents-design #2** [code-refactor/dead-code] — Entire wizard + example-input surface is dead code (~850 LOC across 5 files) — `src/features/agents/sub_design/wizard/DesignWizard.tsx:18`
- **agents-executions-4-4 #1** [code-refactor/dead-code] — Two dead helper files that are byte-level duplicates of live modules — with drift already underway — `src/features/agents/sub_executions/libs/inspectorHelpers.ts:1`
- **api-system #1** [code-refactor/dead-code] — desktopBridges.ts is entirely dead — zero importers anywhere in src/ — `src/api/system/desktopBridges.ts:1`
- **api-vault #1** [code-refactor/duplication] — Abandoned module split: dbSchemaExec/dbSchemaQueries/dbSchemaTables fully duplicate dbSchema.ts with zero importers — `src/api/vault/database/dbSchemaExec.ts:1`
- **home-welcome #1** [code-refactor/dead-code] — Dead default export: the LanguageSwitcher dropdown component is never imported — `src/features/home/sub_welcome/LanguageSwitcher.tsx:105`
- **hooks-utility-1-3 #2** [code-refactor/duplication] — useBackgroundJobPolling is an unused rewrite; the deprecated hook duplicates its entire polling engine — `src/hooks/utility/data/useBackgroundSnapshot.ts:74`
- **lib-misc-2 #1** [code-refactor/dead-code] — `autoProfile.ts` is dead code that monkey-patches `Promise.prototype.then` at import time — `src/lib/debug/autoProfile.ts:15`
- **overview-memories #1** [code-refactor/dead-code] — Entire `hooks/` directory is a dead, stale duplicate of `libs/` — `src/features/overview/sub_memories/hooks/memoryConflicts.ts:1`
- **overview-realtime #1** [code-refactor/dead-code] — Entire sub_realtime feature is orphaned — zero importers outside the folder — `src/features/overview/sub_realtime/index.ts:1`
- **overview-usage #1** [code-refactor/dead-code] — DashboardFilters.tsx is a dead 254-line file triplicating three live components — `src/features/overview/sub_usage/DashboardFilters.tsx:1`
- **plugins-artist-1-2 #1** [code-refactor/dead-code] — Drag-and-drop media import is a dead code path — `File.path` never exists in the webview — `src/features/plugins/artist/sub_media_studio/MediaStudioPage.tsx:211`
- **plugins-fleet-2-2 #1** [code-refactor/dead-code] — Dead preview tier: `FleetTilePreview` + `useFleetTilePreviews` + `terminalPreviews` IPC path unused anywhere — `src/features/plugins/fleet/FleetTilePreview.tsx:17`
- **plugins-misc #1** [code-refactor/dead-code] — PluginAccentLayer.tsx and pluginTheme.ts are dead files (~100 LOC, no consumers) — `src/features/plugins/PluginAccentLayer.tsx:11`
- **tauri-commands-design-1-2 #1** [code-refactor/dead-code] — Orphaned LLM adopt-transform pipeline (~800 lines) in template_adopt.rs has zero callers — `src-tauri/src/commands/design/template_adopt.rs:1611`
- **tauri-mcp-server-misc #1** [code-refactor/dead-code] — `personas_list` group_id filter is dead code that silently returns an empty list — `src-tauri/src/mcp_server/tools.rs:1618`
- **teams-misc #1** [code-refactor/dead-code] — `useTeamChannel()` hook and `parseDeliveries` are dead — their only callers were deleted — `src/features/teams/sub_collab/useTeamChannel.ts:112`
- **teams-teamworkspace-2-2 #1** [code-refactor/dead-code] — Orphaned sub_canvas subtree (~30 files) kept alive by a context provider nobody reads — `src/features/teams/sub_teamWorkspace/TeamCanvas.tsx:11`
- **templates-n8n-1-2 #1** [code-refactor/dead-code] — Orphaned transform/edit/confirm UI subtree (~14 files) after the wizard was cut down to upload+analyze — `src/features/templates/sub_n8n/steps/N8nImportTab.tsx:156`
- **triggers-studio-1-3 #1** [code-refactor/dead-code] — Entire Dispatch-console subtree (RoutingView tree) is unreachable dead code — `src/features/triggers/sub_studio/routing/EventCanvas.tsx:17`
- **vault-misc #1** [code-refactor/dead-code] — VaultConnectorPicker empty state is unreachable dead code (sentinel card makes `items.length === 0` impossible) — `src/features/vault/components/VaultConnectorPicker.tsx:115-174`

### I. Duplication with drift (highest-regression theme) — 19 findings

- **agents-use-cases-1-2 #1** [code-refactor/duplication] — Manual-run money-path logic duplicated between PersonaLayoutView and useUseCaseDetail — `src/features/agents/sub_use_cases/components/persona-layout/PersonaLayoutView.tsx:229`
- **api-system #2** [code-refactor/duplication] — cloud.ts hand-writes SmeeRelay and CloudWebhookRelayStatus that duplicate — and have drifted from — the ts-rs bindings — `src/api/system/cloud.ts:165`
- **lib-utils-1-2 #1** [code-refactor/duplication] — Prompt-injection sanitization pipeline duplicated between variableSanitizer and workflowSanitizer — and already drifted — `src/lib/utils/sanitizers/variableSanitizer.ts:38`
- **plugins-dev-tools-3-3 #1** [code-refactor/duplication] — Two competing parsers for the same persisted `standards_config` field, with divergent defaults — `src/features/plugins/dev-tools/sub_projects/pipeline/standardsConfig.ts:26`
- **plugins-drive #1** [code-refactor/duplication] — Drag-move payload handling copied 4×, and one copy already lost the ancestor-guard — `src/features/plugins/drive/components/DriveFileList.tsx:363`
- **shared-chrome #1** [code-refactor/duplication] — Toast auto-dismiss RAF timer duplicated verbatim in both toast items — `src/features/shared/chrome/ToastContainer.tsx:81`
- **tauri-commands-companion-1-2 #1** [code-refactor/duplication] — Dev-project resolution block copy-pasted five times in approvals.rs — `src-tauri/src/commands/companion/approvals.rs:1492`
- **tauri-commands-infrastructure-1-3 #1** [code-refactor/duplication] — Headless Claude CLI spawn envelope duplicated ~7× — copies have already drifted on subscription-auth forcing — `src-tauri/src/commands/infrastructure/idea_scanner.rs:625`
- **tauri-commands-obsidian-brain #2** [code-refactor/duplication] — Five near-identical vault walkers and three wikilink extractors duplicated across the module — `src-tauri/src/commands/obsidian_brain/graph.rs:96`
- **tauri-companion-brain-1-2 #2** [code-refactor/duplication] — Claude one-shot CLI harness triplicated across consolidation / reflection / recall_synthesis — `src-tauri/src/companion/brain/consolidation.rs:821`
- **tauri-companion-misc #1** [code-refactor/duplication] — Installer machinery duplicated verbatim between kokoro_installer.rs and pocket_installer.rs — `src-tauri/src/companion/tts/pocket_installer.rs:45`
- **tauri-companion #1** [code-refactor/duplication] — Whole-function `#[cfg(feature = "ml")]` / `#[cfg(not(...))]` body duplication, already drifting — `src-tauri/src/companion/dev_session.rs:111`
- **tauri-db-misc #2** [code-refactor/duplication] — `classify_field_type` is triplicated — divergence changes what gets stored as a secret — `src-tauri/src/db/migrations/helpers.rs:434`
- **tauri-db-models-2-4 #1** [code-refactor/duplication] — Three-state (omit/clear/set) update semantics silently broken on most `Option<Option<T>>` fields — only 4 team fields use the `double_option` deserializer — `src-tauri/src/db/models/team.rs:60`
- **tauri-db-repos-1-6 #2** [code-refactor/duplication] — Hand-rolled two-list dynamic UPDATE pattern duplicated across repos despite existing macros — `src-tauri/src/db/repos/dev_tools.rs:322`
- **tauri-engine-1-10 #2** [code-refactor/duplication] — `run_test` is a hand-rolled duplicate of `run_lab_loop` and has already drifted (no completeness gate, no cancellation-overwrite guard) — `src-tauri/src/engine/test_runner.rs:187`
- **tauri-engine-10-10 #1** [code-refactor/duplication] — Two divergent SSRF-safe client builders (and two resolver structs) — the widely-used one is missing the redirect hardening and silently degrades to an unprotected client — `src-tauri/src/engine/ssrf_safe_dns.rs:57`
- **tauri-utils-misc #2** [code-refactor/duplication] — `truncate_on_char_boundary` is duplicated verbatim in `engine/str_utils.rs` and hand-rolled at ~18 call sites — `src-tauri/src/utils/text.rs:11`
- **vault-databases-2-2 #1** [code-refactor/duplication] — Safe-mode execution block duplicated between ConsoleTab and QueryEditorPane — and the copies have already drifted — `src/features/vault/sub_databases/tabs/QueryEditorPane.tsx:66`

---

## Triage themes

| Theme | C+H count | Why this is a wave |
|---|---:|---|
| A. Unbounded loops & runaway refetch (incl. the 1 Critical) | 10 | One mental model: effect-dependency loops + missing retry/backoff guards. Small fixes; together they stop CPU/IPC burn and one app-freezing Critical. |
| B. Broken caches & stale/frozen data | 6 | Caches that never hit, memos frozen at mount, guards that cancel valid work — silent feature degradation; fixes share the stale-dep/sequence-token pattern. |
| C. IPC chattiness — N+1, oversized payloads, missing caching | 18 | Chatty IPC: count queries instead of full payloads, batching, debounce, memoized discovery. Every fix cuts real latency on hot user paths. |
| D. SQLite query efficiency & schema debt (Rust) | 4 | Sargable predicates, version-stamped migrations, stored computed columns — same SQLite mental model throughout. |
| E. Rust runtime hygiene — blocking calls, leaks, serial I/O | 13 | Tokio discipline: kill_on_drop, spawn_blocking, concurrent fan-out, drain-before-wait, bounded queues. Backend stability & responsiveness. |
| F. Frontend render/stream churn & hot-path algorithms | 26 | Per-line/per-frame re-render storms and O(n^2) main-thread work; memoize/throttle/virtualize patterns repeat across features. |
| G. UI/logic correctness & bundle weight | 13 | User-visible breakage from lint-invisible bugs: template-string Tailwind, broken i18n, missing fallbacks, eager 310KB chunks. |
| H. Dead code (grep-verified deletes) | 23 | Thousands of LOC of verified-orphan code across ~50 files; deletes with grep-verification by IMPORT PATH, zero runtime risk when verified. |
| I. Duplication with drift (highest-regression theme) | 19 | Consolidations where copies HAVE drifted (SSRF client, spawn envelope, double_option, classify_field_type). Highest regression risk — one consolidation per commit. |

---

## Suggested wave split (C+H first; 926 M/L stay as backlog tail)

| Wave | Theme | Size | Notes |
|---|---|---:|---|
| 1 | A — loops & runaway refetch | 10 | Contains the only Critical (recipes-playground infinite setState). Do first. |
| 2 | B — broken caches & stale data | 6 | Includes session-pool warm-reuse no-op (every run cold-starts). |
| 3 | C — IPC chattiness | 18 | Split into C1 (frontend callers) / C2 (Rust command shape) if needed. |
| 4 | D — SQLite efficiency | 4 | Includes migration-chain version stamp (startup cost) + broken arena tool. |
| 5 | E — Rust runtime hygiene | 13 | Split E1 (blocking/deadlock/leak) / E2 (serial IO, churn, wasted work). |
| 6 | F — render/stream churn | 26 | Split F1 (streaming sinks/stores) / F2 (component memoization). |
| 7 | G — UI/logic correctness | 13 | Tailwind template classes, i18n, IPC fallbacks, bundle splits. |
| 8 | H — dead code | 23 | Grep-verify by IMPORT PATH before each delete (see harness-learnings). |
| 9 | I — duplication w/ drift | 19 | Highest regression; one consolidation per commit, dedicated sessions. |

---

## How this scan was run

- Scanner roles: vibeman registry code-refactor (dead code/duplication/structure/cleanup) + perf-optimizer (rerender/N+1/leaks/algorithms), one dual-lens subagent per context, cap 3 findings/lens.
- Scope: all 227 contexts (user choice), both sides (src/ + src-tauri/).
- Baseline at scan time: tsc 0 errors; vitest 2303-2304/2304 (known flaky: src/hooks/design/__tests__/useDesignReviews.test.ts); cargo check --features desktop,ml clean.
- Overlap note: 69 contexts were previously scanned by code-refactor on 2026-07-10 (docs/harness/refactor-bughunt-2026-07-10/, ~160 duplication findings still open there); expect overlap in themes H/I — cross-check before fixing.
- Master drifted since context map build (R13-R16 cockpit/factory commits): 49 mapped files missing; new files NOT covered by this scan.
