# Bug Hunter — High/Medium/Low tail: phased resolution plan

> The 42 criticals are tracked separately (40 fixed in FIXES-WAVE-1..8; 2
> deferred with plans). This plan organizes the remaining **218** findings
> (105 High · 68 Medium · 45 Low) into themed phases, ordered by
> resolution priority. Each phase is several sessionable waves of ~5–7 fixes;
> within a phase, do High before Medium before Low. Same gates as the critical
> waves: `cargo check --features desktop` + `tsc` clean per fix, atomic commits.

## Phase overview (resolution order)

| # | Phase | High | Med | Low | Total |
|---:|---|---:|---:|---:|---:|
| 1 | Security & trust-boundary | 14 | 10 | 11 | 35 |
| 2 | Data integrity & loss (wrong/lost/overwritten data) | 16 | 8 | 3 | 27 |
| 3 | Concurrency / races / double-execution | 30 | 7 | 1 | 38 |
| 4 | Recovery, healing & execution-runtime | 10 | 10 | 8 | 28 |
| 5 | Scoring / aggregation correctness | 6 | 15 | 3 | 24 |
| 6 | Clock / timezone / scheduling | 2 | 2 | 2 | 6 |
| 7 | Success theater / swallowed errors | 23 | 12 | 7 | 42 |
| 8 | Resource leaks / unbounded growth | 0 | 1 | 3 | 4 |
| 9 | Validation & edge-case handling | 1 | 1 | 3 | 5 |
| 10 | UX, accessibility & feedback | 0 | 0 | 1 | 1 |
| 11 | Other / cross-cutting | 3 | 2 | 3 | 8 |
| | **Total** | 105 | 68 | 45 | **218** |

---

## Phases in detail

Within each phase the **High** items are listed in full (the wave-1 targets of that phase); Medium/Low are summarized by context. Each item: `[context] title — file`.

### Phase 1 — Security & trust-boundary  (14H / 10M / 11L)

**High (14) — wave-1 targets:**
- [capabilities-use-cases-model-config] Budget exceeded-ratio derives "ok" when spend is non-finite or maxBudget is non-positive — `src/stores/slices/agents/budgetEnforcementSlice.ts:71 (if (!maxBudget || maxBudget <= 0) return { ratio: 0, status: 'ok' })`
- [cockpit-voice-sensory] Main reply object URLs are never revoked — unbounded blob memory leak per turn — `src/features/plugins/companion/CompanionPanel.tsx:1618`
- [companion-runtime-chat] `INTERRUPTED_TURNS` entries leak when an interrupt targets a turn that never runs — `src-tauri/src/companion/session.rs:110 (request_interrupt), cleared only at :1377 (clear_interrupt inside run_cli)`
- [credential-vault-crud] Editing one field of a multi-field credential via `updateCredential` re-encrypts and DELETEs+reinserts every field; a mid-loop encryption failure or a dropped field silently revokes the rest — `src-tauri/src/db/repos/resources/credentials.rs:393-420; src-tauri/src/commands/credentials/crud.rs:138-157`
- [crypto-secure-storage] Enclave `verify()` returns advisory flags; caller never enforces signature/integrity/trust — `src-tauri/src/engine/enclave.rs:232 and src-tauri/src/commands/network/enclave.rs:39`
- [crypto-secure-storage] `validate_file_access_path` never canonicalizes — symlink/junction escape past home/system guards — `src-tauri/src/engine/path_safety.rs:299`
- [fleet-control] Killed/crashed tile can show stale "running" forever — exit emit is fire-and-forget with no client-side reconciliation — `src-tauri/src/commands/fleet/commands.rs:122`
- [oauth-api-proxy-foraging] `EnvResolver` imports every matching secret for a service, not the one the user approved — `src-tauri/src/commands/credentials/foraging.rs:745-763`
- [oauth-api-proxy-foraging] 401-retry re-resolves token outside the per-credential lock — stale/wrong token can be sent on retry — `src-tauri/src/engine/api_proxy.rs:849-869`
- [observability-alerts] Persona-scoped alert rules evaluate against global metrics — wrong alerts fire (or don't) — `src/stores/slices/overview/alertSlice.ts:384`
- [pipeline-agent-chains] Persona-node timeout leaves the CLI process running (zombie spawn + budget leak) — `src-tauri/src/engine/pipeline_executor.rs:472 (run_persona_node timeout branch)`
- [state-management-zustand] `goals` array clobbered when toggling project / all-projects scope (shared-array-overwrite) — `src/stores/slices/system/devToolsProjectSlice.ts:201 (fetchGoals) and :211 (fetchAllGoals); consumer src/features/teams/sub_goals/GoalsPage.tsx:109-111`
- [tauri-ipc-bridge-api] `remote_command_reject` runs on any device + skips device scoping (cross-device tampering) — `src-tauri/src/cloud/remote_commands.rs:297`
- [tauri-ipc-bridge-api] `system_ops_*` write/run commands are auth-gated only by a no-op guard — `src-tauri/src/commands/infrastructure/system_ops.rs:51,121,129,140`

**Medium (10) + Low (11) — by context:** database-schema-migrations (2), error-handling-hooks-utilities (2), internationalization-i18n (2), oauth-api-proxy-foraging (2), settings-byom (2), artist-studio (1), credential-design-negotiation (1), persona-templates (1), research-lab (1), agent-chat (1), credential-vault-crud (1), crypto-secure-storage (1), execution-runner-inspector (1), fleet-control (1), google-drive (1), webhooks-channel-pollers (1)

### Phase 2 — Data integrity & loss (wrong/lost/overwritten data)  (16H / 8M / 3L)

**High (16) — wave-1 targets:**
- [agent-lab-versions] A/B and Eval runs share one lifecycle flag — cancelling/finishing one clobbers the other — `src/stores/slices/agents/labSlice.ts:340`
- [build-sessions-personamatrix] `test_build_draft` TOCTOU on phase + per-persona report clobber under concurrent/double test — `src-tauri/src/commands/design/build_sessions.rs:582-710`
- [capabilities-use-cases-model-config] Automation credential requirement checks the wrong column — guaranteed false "unmet" — `src-tauri/src/engine/capability_contract.rs:210 (service_type: cred_id.clone())`
- [cloud-sync-deployment] Last-write-wins conflict resolution trusts client `updated_at` wall clocks, so a device with a skewed clock silently overwrites newer edits — `src-tauri/src/engine/workspace_sync/merge.rs:140 (last_writer_wins) / merge.rs:161 (compare_rfc3339)`
- [credential-design-negotiation] Concurrent design/negotiation starts race the registry guard and silently discard a result — `src-tauri/src/commands/credentials/negotiator.rs:66`
- [credential-vault-crud] Two metadata write mechanisms race on the same column: raw `json_set` (`record_usage`) vs. parse→reserialize (`append_healthcheck_metadata`/`update_ledger`), causing lost updates — `src-tauri/src/db/repos/resources/credentials.rs:845-869 vs :776-841 / :921-970`
- [dashboard-mission-control] Upcoming routines freeze at mount time — labels never tick, past runs never drop — `src/features/overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx:57-80`
- [database-schema-migrations] Incremental table rebuilds use `INSERT INTO ..._new SELECT *` — a silent corruption trap when column order/count drifted — `src-tauri/src/db/migrations/incremental.rs:337 (persona_triggers chain rebuild) and :931 (event_listener rebuild)`
- [database-schema-migrations] Migrations run statement-by-statement (no outer transaction) — a crash mid-`run_incremental` leaves a permanently half-migrated DB — `src-tauri/src/db/migrations/incremental.rs:33-38 (ddl_step) and mod.rs:230-234 (orchestration in init_db)`
- [director-leadership] Score-trend sparkline collapses to a single point — every Director cycle overwrites the SAME target execution row — `src-tauri/src/engine/director.rs:662`
- [messages-notifications] Cursor advances by guessed count even on partial publish failure — corrupted relay accounting + skipped firings — `src-tauri/src/engine/shared_event_relay.rs:143`
- [obsidian-brain] Daily-note / meeting-note writers are non-atomic with a read-modify-write race — `src-tauri/src/commands/obsidian_brain/graph.rs:497, :501, :522 (append_daily_note); :588 (write_meeting_note)`
- [obsidian-brain] Drive pull overwrites local edits with no conflict check and skips all nested folders — `src-tauri/src/commands/obsidian_brain/drive.rs:604 (subfolder skip), :627-:645 (overwrite + non-atomic write)`
- [self-healing-auto-rollback] Auto-rollback picks "previous" version by version number only — can roll back to a known-bad / corrupt baseline — `src-tauri/src/engine/auto_rollback.rs:136 (selection) and :270 (threshold)`
- [state-management-zustand] `fetchExecutions` `finally` unconditionally writes `executionsLoading:false`, racing a sibling persona fetch — `src/stores/slices/agents/executionSlice.ts:499 (fetchExecutions, finally at :544)`
- [team-assignment-handoff] Step failure inside a detached task can be lost, wedging the assignment forever — `src-tauri/src/engine/team_assignment_orchestrator.rs:562-583 (spawned step task), :449 (reap)`

**Medium (8) + Low (3) — by context:** repositories-models (2), approvals-decisions (1), dashboard-mission-control (1), execution-runner-inspector (1), persona-editor-crud (1), state-management-zustand (1), team-builder-workspace (1), build-sessions-personamatrix (1), recipes-use-case-blueprints (1), team-assignment-handoff (1)

### Phase 3 — Concurrency / races / double-execution  (30H / 7M / 1L)

**High (30) — wave-1 targets:**
- [agent-chat] Stale-closure session/persona binding finalizes a reply into the wrong (newly-switched) thread — `src/stores/slices/agents/executionSlice.ts:431`
- [artist-studio] Lightbox index races gallery mutation — wrong asset shown or deleted out from under the viewer — `src/features/plugins/artist/sub_gallery/Gallery2D.tsx:53-59,86,121`
- [capabilities-use-cases-model-config] Use-case auto-save reports success while a write is still queued/in-flight (success theater) — `src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts:45 (setIsDirty(false) right after await mutateSingleUseCase)`
- [cloud-sync-deployment] `notify_dirty()` wakes that arrive while a pass is running are coalesced into a single already-in-flight pass and lost — `src-tauri/src/cloud/sync/mod.rs:420 (loop) and mod.rs:139 (notify_dirty)`
- [cockpit-voice-sensory] STT `getUserMedia` permission prompt can leave the hold-to-talk UI stuck in "listening" — `src/features/plugins/companion/useLocalDictation.ts:117`
- [companion-runtime-chat] Concurrent user sends both pass the `!streaming` gate and double-fire turns — `src/features/plugins/companion/CompanionPanel.tsx:1657 (sendOrQueue) + :1548 (send)`
- [connector-catalog] Healthcheck-driven readiness ignores credential field staleness vs. last-success timestamp ordering — `src-tauri/src/commands/design/connector_readiness.rs:459 (credential_is_usable)`
- [design-reviews-diagrams] Rebuild reuses a deterministic job key — concurrent/repeat rebuilds of the same review collide — `src-tauri/src/commands/design/reviews.rs:660 (rebuild-{id}), :667 (insert_running)`
- [dev-tools-context-map] Patch-release CICD is not idempotent — concurrent/retried runs create duplicate or conflicting releases — `src-tauri/src/engine/platforms/github.rs:473 (create_patch_release); commands at src-tauri/src/commands/tools/github_platform.rs:37`
- [fleet-control] Broadcast targets a stale, store-cached session list that lags live Rust state — writes into dead PTYs — `src/features/plugins/fleet/FleetBroadcastModal.tsx:54`
- [genome-evolution] Concurrent evolution cycles for one persona — no in-flight guard — `src-tauri/src/engine/mod.rs:2213 (and commands/execution/evolution.rs:190)`
- [google-drive] Recursive-search results are a frozen snapshot with no in-flight cancellation — acts on deleted/renamed files & can resurrect cleared results — `src/features/plugins/drive/hooks/useDrive.ts:327 (runRecursiveSearch) + DriveFileList.tsx:1148 (RecursiveResultRow actions)`
- [home-roadmap] Fleet health strip mounts once, never refreshes, and writes state after unmount — `src/features/home/sub_welcome/FleetHealthStrip.tsx:24-48`
- [incidents-manual-review] Reopened persona_blocker incident can never re-continue (continued_at is never cleared) — `src-tauri/src/db/repos/execution/audit_incidents.rs:427`
- [incidents-manual-review] auto_triage evaluator races GC / human resolve; LLM verdict silently lost — `src-tauri/src/engine/auto_triage.rs:392`
- [mcp-gateways-tools] Gateway membership allows nested/cyclic gateways → unbounded recursion and stack overflow on tools/list and tools/call — `src-tauri/src/db/repos/resources/mcp_gateways.rs:45 (only self-ref blocked) → recursion at src-tauri/src/engine/mcp_tools.rs:545 and :668`
- [messages-notifications] Shared-event relay cursor uses bare `fired_at` timestamp with no id tiebreaker — duplicate or dropped firings — `src-tauri/src/engine/shared_event_relay.rs:144`
- [onboarding-tour] ExecutionStep can auto-complete on a pre-existing, unrelated execution — `src/features/onboarding/components/ExecutionStep.tsx:45`
- [persona-templates] Concurrent / double adoption produces duplicate teams and personas with no idempotency guard — `src-tauri/src/engine/team_preset_adopter.rs:244 (adopt_preset), src/features/templates/sub_presets/usePresetAdoption.ts:113 (adopt)`
- [personas-twin] `useReadinessCelebration` cross-twin baseline poisoning + missed celebration on slow hydration — `src/features/plugins/twin/useReadinessCelebration.ts:33-53`
- [personas-twin] Picker `onSelect` fires for the already-active twin and races concurrent selections with no in-flight guard — `src/features/plugins/twin/shared/TwinPicker.tsx:176,237; src/stores/slices/system/twinSlice.ts:383-392`
- [pipeline-agent-chains] Approval pre-arm race: approve/reject before the gate registers is lost forever — `src-tauri/src/engine/pipeline_executor.rs:651 (poll_for_approval), src-tauri/src/commands/teams/teams.rs:380 (approve_pipeline_node)`
- [recipes-use-case-blueprints] Curation scheduler can double-enqueue (and double-run) when `mark_run_now` fails after enqueue — `src-tauri/src/engine/curation_scheduler.rs:123-147; src-tauri/src/engine/persona_jobs.rs:101-118`
- [repositories-models] Persona name-uniqueness check is a TOCTOU race with no DB constraint behind it — `src-tauri/src/db/repos/core/personas.rs:593 (also update_name at :937)`
- [scheduler-cron-agents] Cron "next fire" is computed from system-LOCAL time but the UI hard-labels it "UTC", and two schedulers disagree on the zone — `src-tauri/src/engine/scheduler.rs:72 (next_fire_time_local) + src/features/overview/sub_cron_agents/components/CronAgentCard.tsx:73`
- [scheduler-cron-agents] Curation scheduler can enqueue duplicate runs when `mark_run_now` fails; relies on a different table's idempotency that doesn't apply — `src-tauri/src/engine/curation_scheduler.rs:123-156`
- [shared-ui-component-library] Rapid consecutive announce() calls collapse — intermediate messages dropped silently — `src/features/shared/components/feedback/AriaLiveProvider.tsx:34-43`
- [team-assignment-handoff] Persona running multiple steps concurrently can exceed its `max_concurrent` and collide on one repo — `src-tauri/src/engine/team_assignment_orchestrator.rs:538-583 (budget + launch loop)`
- [triggers-event-registry] CatalogCard subscribe/unsubscribe has no in-flight guard or error feedback — double-clicks and failed toggles silently desync — `src/features/triggers/sub_shared/CatalogCard.tsx:50-51`
- [webhooks-channel-pollers] webhook_notifier watermark uses strict `created_at >` — events sharing the boundary timestamp are dropped — `src-tauri/src/db/repos/communication/events.rs:397 (consumed by webhook_notifier.rs:457 + :497)`

**Medium (7) + Low (1) — by context:** agent-lab-versions (1), home-roadmap (1), incidents-manual-review (1), mcp-gateways-tools (1), personas-twin (1), scheduler-cron-agents (1), state-management-zustand (1), shared-ui-component-library (1)

### Phase 4 — Recovery, healing & execution-runtime  (10H / 10M / 8L)

**High (10) — wave-1 targets:**
- [agent-chat] Stream death mid-flight leaves chat wedged with no recovery — `src/stores/slices/agents/chatSlice.ts:427`
- [agent-lab-versions] `fetchResults` terminal-state cache short-circuit serves stale results forever — `src/stores/slices/agents/labSlice.ts:167`
- [error-handling-hooks-utilities] IPC timeout metric is detected by duration (`>= 29_000ms`) instead of by error type — short-timeout commands never count as timeouts; long ones miscount slow successes — `src/lib/ipcMetrics.ts:75 & :124 (durationMs >= 29_000) vs src/lib/tauriInvoke.ts:37 (DEFAULT_TIMEOUT_MS = 90_000) and InvokeTimeoutError at :67`
- [execution-runner-inspector] `queued` executions are never reaped — stuck forever during indefinite/aligned quota cooldowns — `src-tauri/src/db/repos/execution/executions.rs:1452 (sweep_zombie_executions); interacts with mod.rs:2023 (cooldown alignment) and queue.rs:343,391 (drains held during cooldown)`
- [execution-runner-inspector] Pipeline node poll times out at 600 s even while its execution is still legitimately `queued` — `src-tauri/src/engine/pipeline_executor.rs:411-483 (run_persona_node poll loop)`
- [observability-alerts] In-memory-only cooldown re-fires every persisted alert on each reload — `src/stores/slices/overview/alertSlice.ts:181`
- [observability-alerts] Alerts never fire unless the Observability tab is open — `src/features/overview/sub_observability/libs/useObservabilityData.ts:69`
- [persona-editor-crud] Icon-pick is draft-only — selecting/generating an icon is silently lost if the editor closes before the 800 ms debounce — `src/features/agents/sub_settings/components/PersonaSettingsTab.tsx:156 (onChange={(icon) => patch({ icon })}), feeding src/features/agents/sub_editor/libs/useEditorSave.ts:191-211`
- [self-healing-auto-rollback] AI-healing retry shares the same `retry_count` as the healing execution (off-by-one budget collision) — `src-tauri/src/engine/mod.rs:3167 vs :3365`
- [settings-byom] Routing rules with `Simple`/`Critical` complexity never fire — cost-routing contract is silently unfulfilled — `src-tauri/src/engine/runner/mod.rs:1259 (call site) + src-tauri/src/engine/byom.rs:445`

**Medium (10) + Low (8) — by context:** self-healing-auto-rollback (2), agent-chat (1), build-sessions-personamatrix (1), crypto-secure-storage (1), dashboard-mission-control (1), knowledge-base-memories (1), observability-alerts (1), repositories-models (1), scheduler-cron-agents (1), webhooks-channel-pollers (1), approvals-decisions (1), cloud-sync-deployment (1), dev-tools-context-map (1), pipeline-agent-chains (1), research-lab (1), state-management-zustand (1), triggers-event-registry (1)

### Phase 5 — Scoring / aggregation correctness  (6H / 15M / 3L)

**High (6) — wave-1 targets:**
- [analytics-sla-usage] SLA daily-trend bars render at zero height — the trend chart is silently blank — `src/features/overview/sub_sla/components/SLACard.tsx:132`
- [analytics-sla-usage] Heatmap day buckets are UTC on the server but local-time on the client — wrong-day attribution — `src/features/overview/sub_analytics/components/ExecutionHeatmap.tsx:77 (and server src-tauri/src/db/repos/execution/metrics.rs:1973)`
- [build-sessions-personamatrix] Promote/adoption silently swallow normalization + recipe-hydration errors, producing a structurally-broken persona — `src-tauri/src/commands/design/build_sessions.rs:2507-2521 (and create_adoption_session 236-255)`
- [connector-catalog] `connector_definitions.name` has no UNIQUE constraint — a custom connector can shadow a builtin and flip its classification/readiness — `src-tauri/src/db/migrations/schema.rs:495 (no UNIQUE on name); src-tauri/src/db/repos/resources/connectors.rs:71 (create does no name-existence check)`
- [home-roadmap] "Active agents" pill shows agents that executed today, not agents that are active — `src/features/home/sub_welcome/FleetHealthStrip.tsx:38 + src-tauri/src/db/repos/execution/metrics.rs:427`
- [knowledge-base-memories] Knowledge-graph `confidence` permanently overweights early outcomes — running average never reflects recent reality — `src-tauri/src/db/repos/execution/knowledge.rs:112–:116 (and avg_cost/avg_duration at :102–:111)`

**Medium (15) + Low (3) — by context:** analytics-sla-usage (3), director-leadership (3), genome-evolution (2), agent-lab-versions (1), credential-vault-crud (1), dashboard-mission-control (1), dev-tools-context-map (1), home-roadmap (1), observability-alerts (1), obsidian-brain (1), team-assignment-handoff (1), knowledge-base-memories (1), persona-templates (1)

### Phase 6 — Clock / timezone / scheduling  (2H / 2M / 2L)

**High (2) — wave-1 targets:**
- [approvals-decisions] Pending approvals never expire — an approval can be acted on long after its target is gone, with no consent freshness — `src-tauri/src/commands/companion/approvals.rs:123 (companion_list_pending_approvals) and :488 (load_pending)`
- [scheduler-cron-agents] Interval triggers accumulate unbounded drift — next fire is `now + interval`, not `scheduled + interval` — `src-tauri/src/engine/scheduler.rs:78-83 (compute_next_from_config, interval arm)`

**Medium (2) + Low (2) — by context:** companion-brain-proactivity (2), tauri-ipc-bridge-api (1), internationalization-i18n (1)

### Phase 7 — Success theater / swallowed errors  (23H / 12M / 7L)

**High (23) — wave-1 targets:**
- [approvals-decisions] resolve_human_review approval auto-fires no event-publish error to the user; an Athena-resolved review can silently lose its decision side effects — `src-tauri/src/commands/companion/approvals.rs:757`
- [artist-studio] `[Error]`/`failed` status event flips `running=false` but never finalizes the session record — `src/features/plugins/artist/hooks/useCreativeSession.ts:116-133`
- [companion-brain-proactivity] Autonomous exec/message triage ignores quiet hours entirely — `src-tauri/src/commands/companion/mod.rs:128-167 (triage calls) vs src-tauri/src/companion/proactive/quiet.rs:63 (is_quiet_now)`
- [companion-brain-proactivity] Empty / partially-edited quiet window silently turns "quiet" into "always awake" — `src-tauri/src/companion/proactive/quiet.rs:81-97`
- [dashboard-mission-control] Cost-anomaly "Cost Spike Detected" is not time-bounded — a 29-day-old spike shows as a live critical — `src/features/overview/libs/fleetOptimizer.ts:151-172`
- [design-reviews-diagrams] Duplicate node IDs from LLM output silently drop nodes and produce React key collisions — `src/features/templates/sub_diagrams/FlowDiagram.tsx:73 (nodeMap), :139 (key={node.id})`
- [dev-tools-context-map] `move_context_to_group` silently succeeds on a non-existent / wrong context — `src-tauri/src/db/repos/dev_tools.rs:2378 (move_context_to_group)`
- [error-handling-hooks-utilities] `silentCatch`/`extractMessage` drops the original Error cause and stack — every swallowed/logged failure loses its post-mortem trail — `src/lib/silentCatch.ts:19-58 (extractMessage returns err.message only; silentCatch logs only { error: msg })`
- [genome-evolution] Variant `prompt_segments` can be emptied → blank system prompt promoted/adopted — `src-tauri/src/engine/genome.rs:436 (mutate drop branch) and :216 (reassemble)`
- [internationalization-i18n] `interpolate()` crashes on a missing/undefined translation leaf — `src/i18n/useTranslation.ts:288`
- [knowledge-base-memories] KB ingest reports `status: "completed"` even when every document failed (success theater) — `src-tauri/src/engine/kb_ingest.rs:83 and :89–:98`
- [mcp-gateways-tools] Gateway tool calls are rate-limited by name only — member prefix bypasses the per-tool limiter, and the limiter keys on attacker-influenced strings — `src-tauri/src/engine/mcp_tools.rs:617 (rate_key = format!("mcp_tool:{tool_name}")) vs gateway recursion at :668`
- [persona-editor-crud] Deleting a shared custom icon in the picker silently breaks every *other* persona using it — `src/features/shared/components/forms/PersonaIconPickerModal.tsx:122-132 (handleDeleteCustom)`
- [persona-templates] Build-session adoption flow performs NO integrity check at all — `src-tauri/src/commands/design/build_sessions.rs:204 (create_adoption_session), :2441 (promote_build_draft_inner)`
- [recipes-use-case-blueprints] Recipe suggestion chip is mathematically unreachable for the shipped catalog — `src-tauri/src/engine/recipe_matcher.rs:23-33,114-127,169`
- [research-lab] AI synthesis is never persisted — lost silently on drawer close — `src/features/plugins/research-lab/sub_reports/ReportPreviewDrawer.tsx:48,143`
- [research-lab] arXiv "Added N sources" toast lies when sources are de-duplicated — `src/features/plugins/research-lab/sub_literature/ArxivSearchModal.tsx:90-113 + src-tauri/src/db/repos/research_lab.rs:172-223`
- [settings-byom] BYOM provider "Test connection" only probes a local CLI binary — it never validates the external model endpoint or API key (success theater) — `src-tauri/src/commands/infrastructure/byom.rs:132 (test_provider_connection) + ByomProviderList.tsx:160`
- [shared-ui-component-library] AriaLiveProvider unmount blindly nulls the global imperative handle — `src/features/shared/components/feedback/AriaLiveProvider.tsx:46-49`
- [team-builder-workspace] Auto-team reports connection count that overstates what actually persisted — `src/features/teams/sub_teamWorkspace/useAutoTeam.ts:148`
- [team-builder-workspace] Preset adoption can leave an empty team shell with all errors buried in a list — `src-tauri/src/engine/team_preset_adopter.rs:244 (team shell) + :296 (member loop)`
- [triggers-event-registry] Live-stream status updates are silently dropped — events freeze on their first-seen status — `src/features/triggers/sub_live_stream/LiveStreamTab.tsx:76 (with src-tauri/src/db/cdc.rs:252)`
- [webhooks-channel-pollers] Slack/Discord pollers silently skip messages when a burst exceeds FETCH_LIMIT between ticks — `src-tauri/src/engine/slack_poller.rs:352 (and discord_poller.rs:359)`

**Medium (12) + Low (7) — by context:** cockpit-voice-sensory (2), companion-runtime-chat (2), capabilities-use-cases-model-config (1), cloud-sync-deployment (1), connector-catalog (1), design-reviews-diagrams (1), google-drive (1), messages-notifications (1), pipeline-agent-chains (1), recipes-use-case-blueprints (1), shared-ui-component-library (1), triggers-event-registry (1), incidents-manual-review (1), obsidian-brain (1), onboarding-tour (1), personas-twin (1), tauri-ipc-bridge-api (1)

### Phase 8 — Resource leaks / unbounded growth  (0H / 1M / 3L)


**Medium (1) + Low (3) — by context:** fleet-control (1), artist-studio (1), messages-notifications (1), repositories-models (1)

### Phase 9 — Validation & edge-case handling  (1H / 1M / 3L)

**High (1) — wave-1 targets:**
- [internationalization-i18n] Manual plural ternary breaks for non-binary plural languages (ru/ar/cs/etc.) — `src/i18n/useTranslation.ts:288 (interpolate) + call sites, e.g. src/features/shared/components/layout/quick-answer/QuickAnswerQuestionGroup.tsx:84, src/features/vault/sub_dependencies/NodeChip.tsx:38`

**Medium (1) + Low (3) — by context:** persona-editor-crud (2), connector-catalog (1), mcp-gateways-tools (1)

### Phase 10 — UX, accessibility & feedback  (0H / 0M / 1L)


**Medium (0) + Low (1) — by context:** team-builder-workspace (1)

### Phase 11 — Other / cross-cutting  (3H / 2M / 3L)

**High (3) — wave-1 targets:**
- [credential-design-negotiation] `get_dependents` substring join inflates blast radius with false-positive dependents — `src-tauri/src/db/repos/resources/audit_log.rs:235`
- [google-drive] `pathCacheRef` is never invalidated on mutation — columns view & cached panes act on stale/deleted files — `src/features/plugins/drive/hooks/useDrive.ts:238 (cache) + :256 (only writer) and DriveFileList.tsx:1042 (AsyncColumnEntries seeds from it)`
- [onboarding-tour] Persisted `currentStepIndex` is hydrated unclamped — tour can vanish — `src/stores/slices/system/tourSlice.ts:1293`

**Medium (2) + Low (3) — by context:** home-roadmap (1), onboarding-tour (1), credential-design-negotiation (1), design-reviews-diagrams (1), director-leadership (1)

---

## How to run a phase

1. Pick the phase (this order is by blast radius; reorder if you prefer).
2. Re-read each finding's full entry in its `<context>.md` report before fixing.
3. Apply Phase 4.1b–d host-first / already-existed greps (auto-found findings drift).
4. Fix → `cargo check --features desktop` (Rust) / `tsc --noEmit` (FE) → atomic commit referencing the finding → wave verification vs. baseline.
5. One mental model per wave; ~5–7 fixes; pause between waves.

Findings source of truth: `findings.json` (machine-readable) + the 52 per-context `*.md` reports.
