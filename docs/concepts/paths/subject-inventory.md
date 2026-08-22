# Golden Path inventory — fresh scan, 2026-08-18

**Status: RATIFIED BY THE OPERATOR 2026-08-18** (plan §7 step 3) — all 80 scanned
subjects approved, plus the amendments in the ratification section below (5 additions →
**85 subjects total**). This list is the authoritative forge backlog for sessions N+2+.

Produced by six parallel scanners
(five over the context map's 16 groups / 208 contexts, one over 7,429 commits and the
tooling surface), under the lock-in guard — no scanner read the situation spine or the
247-document corpus. ~160 raw entries merged into **71 core subjects + 9 candidates**.
The plan's plausible order of magnitude was 40–80; the operator trims, merges, or
promotes. Slugs are proposals per [`GRAPH.md`](./GRAPH.md) §7.

Each line: `slug` — **Name** — canonical exemplar. Technique candidates and full
manifestation lists live in the scanner reports (session transcript); the forge brief
for each subject re-derives techniques from expertise anyway (plan §3 phase 1), so this
inventory deliberately stays a naming layer.

## A. UI surfaces (21)

| slug | Subject | Canonical exemplar |
|---|---|---|
| `table` | **Table** *(pilot, forged this session)* | `src/features/shared/components/display/UnifiedTable.tsx` |
| `modal-stack` | Modal & overlay stack | `src/features/templates/sub_generated/gallery/modals/useModalStack.ts` |
| `form` | Form & field validation | `src/features/shared/components/forms/FormField.tsx` |
| `async-ui-states` | Async UI states (loading · empty · settled) | `UnifiedTable` cold-load contract + `docs/design/overview-loading.md` |
| `search` | Search (query parsing, full-text, facets, saved views) | `src-tauri/db/src/repos/execution/executions.rs` (FTS5) + structured-query chips |
| `app-shell` | App shell & navigation | `src/features/shared/chrome/sidebar/Sidebar.tsx` |
| `toasts-notifications` | Toast & notification feedback | `src/features/shared/chrome/ToastContainer.tsx` |
| `accessibility` | Accessibility | `src/features/shared/components/feedback/AriaLiveProvider.tsx` |
| `motion` | Motion system | `src/features/shared/components/display/motionPresets.ts` |
| `design-tokens` | Design tokens & theming | `src/lib/utils/designTokens.ts` + `src/stores/themeStore.ts` |
| `data-viz` | Charts & data visualization | `src/features/overview/sub_usage/components/MetricChart.tsx` + glyph system |
| `canvas-graph` | Canvas & node-graph editing | `src/features/teams/sub_mastermind/lib/CanvasShell.tsx` |
| `wizard-flows` | Wizards & guided steppers | `src/features/templates/sub_generated/adoption/questionnaire/QuestionnaireForm.tsx` |
| `guided-tours` | Guided tours & spotlight onboarding | `src/features/onboarding/components/TourSpotlight.tsx` |
| `chat-transcript` | Chat transcript rendering | `src/features/plugins/companion/NarrationThread.tsx` |
| `drag-drop` | Drag & drop | `src/features/shared/components/kanban/KanbanBoard.tsx` |
| `schema-driven-ui` | Schema-driven UI rendering | `src/features/shared/components/surface/SurfaceRenderer.tsx` + cockpit `widgetRegistry.ts` |
| `draft-editing` | Draft & dirty-state editing | `src/features/agents/sub_editor/libs/PersonaDraft.ts` |
| `undo-history` | Undo & history | `src/features/plugins/artist/sub_media_studio/hooks/useMediaStudio.ts` |
| `media-playback` | Media playback | `src/features/plugins/artist/sub_media_studio/hooks/useTimelinePlayback.ts` |
| `file-browsing` | File & asset browsing | `src/features/plugins/drive/hooks/useDrive.ts` |

## B. Client architecture (5)

| slug | Subject | Canonical exemplar |
|---|---|---|
| `client-state` | Client state management | `src/stores/slices/processActivitySlice.ts` |
| `client-fetch-cache` | Client data fetching & caching | `src/lib/utils/staleWhileRevalidate.ts` + `deduplicateFetch.ts` |
| `ipc-contract` | Frontend↔backend IPC contract | `src/lib/tauriInvoke.ts` + ts-rs bindings |
| `realtime-events` | Event bus & realtime subscriptions | `src/hooks/realtime/createSingletonListener.ts` ↔ `src-tauri/engine/src/event_registry.rs` |
| `i18n` | Localization | `src/i18n/useTranslation.ts` |

## C. LLM & agent engineering (19)

| slug | Subject | Canonical exemplar |
|---|---|---|
| `prompt-assembly` | Prompt assembly & context budgeting | `src-tauri/engine/src/prompt/mod.rs` + `src-tauri/src/companion/prompt/` |
| `prompt-safety` | Input sanitization & prompt safety | `src-tauri/engine/src/prompt/runtime_safety.rs` |
| `streaming-output` | Streaming model output | `src/lib/execution/executionSink.ts` + `src-tauri/src/companion/session/` |
| `structured-output` | Structured model output & artifact extraction | `src-tauri/src/commands/credentials/ai_artifact_flow.rs` + companion `dispatcher.rs` |
| `model-routing` | Model routing & provider policy | `src-tauri/src/companion/model_routing.rs` + BYOM policy |
| `cost-metering` | Cost metering & budgets | `src-tauri/engine/src/cost.rs` + tier/spend ledgers |
| `agent-memory` | Agent long-term memory | `src-tauri/src/companion/brain/consolidation.rs` |
| `retrieval` | Retrieval & vector search | `src-tauri/src/companion/brain/retrieval.rs` |
| `subprocess-lifecycle` | Subprocess & CLI session lifecycle | `src-tauri/engine/src/cli_process.rs` + `session_pool.rs` |
| `terminal-multiplexing` | Terminal emulation & multiplexing | `src/features/plugins/fleet/fleetTerminalManager.ts` |
| `sidecar-provisioning` | Sidecar binaries & model provisioning | `src-tauri/src/companion/stt/downloader.rs` |
| `fleet-orchestration` | Agent fleet orchestration | `src-tauri/src/commands/fleet/registry.rs` |
| `agent-chaining` | Agent handoff & chaining | `src-tauri/engine/src/team_handoff.rs` |
| `hitl-approval` | Human-in-the-loop approval | `src-tauri/src/engine/build_session/gates.rs` + reviews repo |
| `proactive-nudges` | Proactive nudges & attention budgeting | `src-tauri/src/companion/proactive/mod.rs` |
| `voice-io` | Voice I/O | `src-tauri/src/companion/tts/mod.rs` |
| `mcp-tools` | Tool protocols (MCP) | `src-tauri/src/companion/orchestration/mcp/mod.rs` |
| `eval-harness` | Evaluation & benchmarking | `src-tauri/engine/src/test_runner/` + `evals/` |
| `tracing` | Tracing & span inspection | `src/features/agents/sub_executions/detail/inspector/TraceInspector.tsx` |

## D. Backend platform (18)

| slug | Subject | Canonical exemplar |
|---|---|---|
| `scheduling` | **Scheduling & triggers** *(pilot, forged this session)* | `src-tauri/core/src/cron.rs` + `src-tauri/src/engine/background/` |
| `background-jobs` | Background jobs & supervised loops | `src-tauri/src/engine/background/` |
| `webhook-ingestion` | Webhook ingestion | `src-tauri/src/engine/webhook.rs` |
| `delivery-guarantees` | Delivery guarantees & dead-letter | stuck-event reaper + `EventGateReason` ledger |
| `retry-backoff` | Retry, backoff & circuit breaking | `src-tauri/src/engine/failover.rs` |
| `rate-limiting` | Rate limiting | `src-tauri/engine/src/rate_limiter.rs` |
| `concurrency-guards` | Idempotency & in-flight guards | `src-tauri/engine/src/inflight_guard.rs` |
| `admission-queue` | Execution queue & admission control | `src-tauri/engine/src/queue.rs` + `resource_governor.rs` |
| `self-healing` | Self-healing & automated remediation | `src-tauri/engine/src/healing_orchestrator.rs` |
| `pipeline-dag` | Pipeline & DAG execution | `src-tauri/src/engine/pipeline_executor.rs` |
| `migrations` | Schema migrations | `src-tauri/db/src/migrations/mod.rs` |
| `data-access` | Repository & data-access layering | `src-tauri/db/src/query_builder.rs` |
| `embedded-db` | Embedded database operations | `src-tauri/db/src/perf.rs` + `core/src/pool.rs` |
| `sync-replication` | Sync, replication & conflict resolution | `src-tauri/src/cloud/sync/mod.rs` + obsidian `conflict.rs` |
| `error-handling` | Error taxonomy & handling | `src-tauri/core/src/error_taxonomy.rs` |
| `observability-telemetry` | Logging & crash telemetry | `src-tauri/src/logging.rs` |
| `metrics-rollups` | Time-series aggregation & rollups | `src-tauri/src/commands/communication/observability/metrics.rs` |
| `alerting` | Alerting & thresholds | `src/features/overview/sub_observability/libs/useGlobalAlertEvaluator.ts` |

## E. Operations & governance (9)

| slug | Subject | Canonical exemplar |
|---|---|---|
| `triage-queues` | Triage queues & operator inboxes | `src/features/agents/quick-answer/triage/useUnifiedTriage.ts` |
| `health-checks` | Health checks & probing | `src-tauri/src/engine/healthcheck.rs` + system `health.rs` |
| `entity-lifecycle` | Entity lifecycle (archive · delete · blast radius) | `src-tauri/src/commands/core/personas.rs` |
| `versioning-snapshots` | Versioning, snapshots & rollback | `src-tauri/db/src/repos/lab/versions.rs` |
| `audit-logging` | Audit logging | `src-tauri/db/src/repos/resources/audit_log.rs` |
| `settings` | Settings & preferences | `src/api/system/settings.ts` + `settings_keys.rs` |
| `scoring-rubrics` | Scoring rubrics & composite indices | `src/features/teams/sub_factory/passport/improve/goldenStandard.ts` |
| `usage-analytics` | Product usage analytics | `src/lib/analytics/index.ts` |
| `perf-instrumentation` | Performance instrumentation | `src/lib/ipcMetrics.ts` + `startup_timing.rs` |

## F. Security (6)

| slug | Subject | Canonical exemplar |
|---|---|---|
| `credential-vault` | Credential vault (encryption at rest · OAuth lifecycle · rotation · acquisition · brokered egress) | `src-tauri/core/src/crypto.rs` + `src-tauri/src/engine/credential_broker.rs` |
| `authorization` | Authorization & capability scoping | `src-tauri/src/ipc_auth.rs` + `scope_enforcement.rs` |
| `device-pairing` | Device pairing & trust | `src-tauri/engine/src/pairing.rs` |
| `signed-artifacts` | Signed artifacts & provenance | `src-tauri/src/commands/network/bundle.rs` |
| `supply-chain` | Supply-chain & secret hygiene | `scripts/secret-scan.mjs` + `deny.toml` + capabilities |
| `p2p-networking` | P2P device networking | `src-tauri/engine/src/p2p/mod.rs` |

## G. Integration (5)

| slug | Subject | Canonical exemplar |
|---|---|---|
| `connector-catalog` | Connector catalog & API adapters | `src/lib/credentials/builtinConnectors.ts` |
| `import-normalization` | Foreign-format import & normalization | `src/lib/personas/parsers/workflowPipeline.ts` |
| `templates-scaffolding` | Template & scaffolding systems | `src/features/templates/sub_generated/adoption/persona-layout/useAdoptionDimensionModel.tsx` |
| `web-scraping` | Web scraping & extraction rules | `src/features/scraper/useScrapeForm.ts` |
| `markdown-vault` | Markdown knowledge vault | `src-tauri/src/commands/obsidian_brain/lint.rs` |

## H. Engineering process (8)

| slug | Subject | Canonical exemplar |
|---|---|---|
| `release-pipeline` | Release pipeline (versioning · changelog · installers · size budgets · variant matrix) | `.github/workflows/release.yml` + `installer-test.yml` |
| `build-economics` | Build performance & economics | `src-tauri/Cargo.toml` workspace split + `cache-budget.mjs` |
| `codegen` | Generated-source pipelines | `scripts/run-codegen.mjs` (14 tasks) |
| `quality-gates` | Quality gates & ratchets | `lefthook.yml` + the `npm run check` chain |
| `test-harness` | Test harness architecture | `scripts/test/` + 6 vitest configs + :17320 bridge |
| `concurrent-vcs` | Concurrent-workspace version control | `scripts/worktree-gc.mjs` + isolated-index ritual |
| `codebase-scanning` | Codebase scanning & triage | `src/features/plugins/dev-tools/sub_triage/findings/sweep.ts` |
| `multi-project` | Multi-project workspace management | `src/features/teams/sub_factory/passport/ProjectsPassportWall.tsx` |

## Former candidates — ALL APPROVED into core (operator, 2026-08-18)

| slug | Subject | Note |
|---|---|---|
| `docs-sync` | Docs-as-code synchronization | promoted with corpus coverage (documentation-sync) |
| `session-resume` | Session resume & "what changed while away" | promoted with corpus coverage (session-delta-digest) |
| `diff-comparison` | Diff & comparison surfaces | promoted with corpus coverage (version-diff-view) |
| `time-travel-replay` | Time-travel replay | approved |
| `sql-console` | SQL console & schema browser | promoted with corpus coverage |
| `cicd-monitoring` | CI/CD pipeline monitoring | approved |
| `embedded-preview` | Embedded preview & cross-frame bridge | approved |
| `dead-code` | Dead-code & orphan elimination | approved |
| `outbound-notifications` | Outbound notification fan-out | approved as subject (not folded) |

## Ratification amendments (operator, 2026-08-18)

**Five subjects added:**

| slug | Subject | Why |
|---|---|---|
| `status-vocabulary` | Status vocabularies & display formatting (DB CHECK → IPC token → label catalog → badge; numbers, timestamps, untrusted content) | largest corpus residue (~660 recurrence), incl. the one unmappable doc |
| `feed` | Feed | GRAPH.md's own shared-technique example; `chronological-feed.md` re-homes here |
| `ui-controls` | UI controls & primitives (button, tooltip, copy-to-clipboard) | currently scattered across form/toasts/modal-stack |
| `job-coordination` | Job coordination (claim/lease, progress, terminal states & recovery) | the corpus treated it as one discipline; restored |
| `packaging` | Desktop packaging & installers (multi-OS, per-arch acceptance, sidecar/DLL presence) | operator addition — pulled out of `release-pipeline` where the merge pass had buried it |

**Charter directives binding on the forge briefs:**

- `agent-memory` covers the **whole memory system** — working/operative memory, episodic,
  semantic/procedural tiers, decay, recall injection — not long-term storage alone.
- `voice-io` must master **speech-to-text as fully as synthesis** — STT is not an appendix.
- `subprocess-lifecycle` and `fleet-orchestration` must carry this app's **parallelism
  methods** as first-class techniques (concurrent session supervision, disjoint write
  sets, single-flight, fan-out discipline).
- `mcp-tools` forges against the **official MCP architectural update of 2026-07-28**
  (https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) — the expert
  draft should reflect that architecture, not pre-update lore.
- `hitl-approval` owns a dedicated **consent-gates technique** (machine-asks-human
  before acting: first-use consent, informed consent, autonomy gating) — the inverse
  flow of review, same subject.

## Corpus coverage cross-check (run after the scan; results 2026-08-18)

All 247 legacy documents mapped into this inventory (**246 mapped / 1 unmapped** at
draft time; the final mapping is 247/247 in [`corpus-map.json`](./corpus-map.json),
which superseded the draft). Largest receivers:
data-access 13 · credential-vault 11 · app-shell 9 · authorization 9 · table 8.
**16 subjects received zero legacy documents** (file-browsing, prompt-safety,
agent-memory, agent-chaining, proactive-nudges, eval-harness, p2p-networking,
web-scraping, markdown-vault, codebase-scanning, multi-project + 5 candidates) — the
fresh scan found real subjects the corpus never covered, which is the v2 sourcing thesis
confirmed. Four candidates DID receive documents and argue for promotion: docs-sync,
session-resume, diff-comparison, sql-console.

**Amendment proposals from the residue (operator decides at the gate):**

1. **`status-vocabulary` (new subject)** — closed display vocabularies end to end (DB
   CHECK → IPC token → label catalog → badge). The spine's `copy-and-vocabulary`
   cluster (~660 combined recurrence incl. `status-and-severity-badges.md`, the one
   unmapped file) has no home in the inventory. Strongest residue signal.
2. **`feed` (new subject)** — GRAPH.md §3 itself uses Feed as the shared-technique
   example; `chronological-feed.md` currently shelters under `table`.
3. **`ui-controls` (new subject)** or an explicit widening of `form`'s charter — button,
   copy-to-clipboard, tooltip currently scatter across form/toasts/modal-stack.
4. **consent-gates** — first-use/informed-consent/autonomy-gating are the inverse flow
   of hitl-approval (machine asks before acting); at minimum an owned technique there.
5. **job-coordination** — the corpus treated claim/lease + progress + terminal-state as
   one discipline; the inventory splits it across concurrency-guards / background-jobs /
   pipeline-dag. Defensible either way; flagged.

## Merge decisions worth recording

- **Search is one subject** — query-chip parsing, FTS5 ranking, faceting, saved views and
  the command palette are techniques of Search, not separate subjects.
- **Credential vault absorbs** encryption-at-rest, OAuth token lifecycle,
  rotation/remediation, acquisition automation, API-key issuance, and the brokered egress
  proxy as techniques — matching the plan's calibration where "Credential vault" is one
  Golden Path.
- **Retry/backoff, rate limiting, idempotency guards, and admission queues stay
  separate** — each has an independent canonical implementation and independent decision
  rules; folding them into one "resilience" node would repeat the v1 altitude collapse
  in the other direction.
- **Client and backend event plumbing are one subject** (`realtime-events`): the repo's
  own design couples them through a single mirrored event registry.
- **Products are not subjects**: scanners consistently rejected "Athena", "Mastermind",
  "Dev Tools", "Obsidian plugin", "Lab" as nodes and redistributed their engineering
  content — that discipline held across all six reports.
- **Cross-cutting laws stayed out**: candidates like "module boundaries" and
  "one-registry-mirrored-two-ways" read as laws, not subjects; they live in
  [`_laws.md`](./_laws.md).
