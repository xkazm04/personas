# Codebase Context Snapshot — personas

> Generated: 2026-04-07T21:44:39.938Z
> Source: dev_contexts table for project_id=07fe9de7-ef68-4ce6-a78e-551c09acbdce
> Total groups: 8, Total contexts: 34
> Git HEAD at generation: 52182a0 (Credentials - Updated toolbar)
>
> **DO NOT EDIT MANUALLY.** Re-run `/refresh-context` to regenerate.
> Consumed by `/research` for relevance scoring.

---

## How to Use This File

Each section below describes a feature area of the personas codebase, with:
- **Description** — what it does
- **Files** — paths under `personas/` that implement it
- **Entry points** — key functions/components/routes
- **Keywords** — searchable terms for relevance matching
- **API surface** — external endpoints/IPC commands exposed
- **Tech stack** — frameworks/libs used in this area

When `/research` extracts an idea, it scores the idea against the keywords
and descriptions here to find the most likely attachment point. If no group
matches, the idea is dropped as out-of-scope.

---

## Agent Identity & Configuration

> **Group type:** —
> **Color:** amber

### creation-wizard

A multi-step wizard that guides users through creating a new AI agent persona — selecting use cases, configuring tools and triggers, previewing the agent identity, and running a dry-run validation. It orchestrates a builder state machine with actions, helpers, and reducers to manage complex wizard state. The wizard produces a complete persona definition submitted to the backend.

**Files:**
- `src/features/agents/components/creation/CreationWizard.tsx`
- `src/features/agents/components/creation/CreationStepSwitcher.tsx`
- `src/features/agents/components/creation/designUtils.ts`
- `src/features/agents/components/creation/steps/builder/useBuilderOrchestration.ts`
- `src/features/agents/components/creation/steps/builder/builderReducer.ts`
- `src/features/agents/components/creation/steps/builder/builderActions.ts`
- `src/features/agents/components/creation/steps/builder/builderHelpers.ts`
- `src/features/agents/components/creation/steps/builder/designResultMapper.ts`
- `src/features/agents/components/creation/steps/builder/useDryRun.ts`
- `src/features/agents/components/creation/steps/builder/types.ts`
- `src/features/agents/components/creation/steps/BuilderActionComponents.tsx`
- `src/features/agents/components/creation/steps/BuilderPreview.tsx`
- `src/features/agents/components/creation/steps/DryRunPanel.tsx`
- `src/features/agents/components/creation/steps/IdentityPreviewCard.tsx`
- `src/features/agents/components/creation/pickers/use_cases/UseCaseBuilder.tsx`
- `src/features/agents/components/creation/pickers/use_cases/UseCaseCard.tsx`
- `src/features/agents/components/creation/pickers/triggers/TriggerPopover.tsx`
- `src/features/agents/components/creation/pickers/triggers/TriggerPresetPicker.tsx`

**Entry points:** src/features/agents/components/creation/CreationWizard.tsx, src/features/agents/components/creation/steps/builder/useBuilderOrchestration.ts

**Keywords:** wizard, creation, dry-run, use-case, picker, builder, preview, onboarding

**Tech stack:** React, TypeScript, Zustand

---

### persona-editor

Provides rich in-place editing of an existing persona's properties including system prompt, model parameters, connectors, and settings panels. Organized into tabbed sections (editor, settings, connectors) with banner notifications for unsaved changes or validation errors. Settings include per-persona overrides for rate limits, model selection, and execution behavior.

**Files:**
- `src/features/agents/sub_editor/index.ts`
- `src/features/agents/sub_settings/SettingsTab.tsx`
- `src/features/agents/sub_settings/SettingsTabContent.tsx`
- `src/features/agents/sub_settings/PersonaSettingsPanel.tsx`
- `src/features/agents/sub_settings/SettingsTabHelpers.ts`
- `src/features/agents/components/persona/PersonaOverviewActions.tsx`
- `src/features/agents/components/persona/PersonaOverviewBadges.tsx`
- `src/features/agents/components/persona/PersonaOverviewCells.tsx`
- `src/features/agents/components/persona/PersonaOverviewResponsive.tsx`
- `src/features/agents/components/persona/CompletenessRing.tsx`
- `src/features/agents/components/persona/PersonaHealthIndicator.tsx`
- `src/features/agents/components/preview/PreviewPanel.tsx`
- `src/features/agents/components/preview/PreviewSection.tsx`
- `src/features/agents/components/onboarding/OnboardingChecklist.tsx`
- `src/features/agents/components/onboarding/OnboardingTemplateStep.tsx`
- `src/features/agents/components/onboarding/ConfigurationPopup.tsx`
- `src/features/agents/components/onboarding/useOnboardingChecklist.ts`
- `src/lib/personas/personaHelpers.ts`
- `src/lib/personas/deploymentHelpers.ts`

**Entry points:** src/features/agents/sub_settings/SettingsTab.tsx, src/features/agents/components/preview/PreviewPanel.tsx

**Keywords:** editor, settings, system-prompt, model-parameters, completeness, onboarding, configuration

**Tech stack:** React, TypeScript, Zustand

---

### persona-management

Manages the full lifecycle of AI agent personas — creation, storage, retrieval, update, and deletion. Personas are the core entity of the application, each with a unique identity, model configuration, and capability set. The backend persists personas in SQLite via the repository pattern; the frontend exposes a paginated, filterable overview with batch actions.

**Files:**
- `src-tauri/src/commands/core/personas.rs`
- `src-tauri/src/db/repos/core/personas.rs`
- `src-tauri/src/db/models/persona.rs`
- `src-tauri/src/validation/persona.rs`
- `src/api/agents/personas.ts`
- `src/stores/personaStore.ts`
- `src/features/agents/components/persona/PersonaOverviewPage.tsx`
- `src/features/agents/components/persona/PersonaOverviewCardList.tsx`
- `src/features/agents/components/persona/PersonaOverviewColumns.tsx`
- `src/features/agents/components/persona/PersonaOverviewFilters.tsx`
- `src/features/agents/components/persona/PersonaOverviewFilterHeader.tsx`
- `src/features/agents/components/persona/PersonaOverviewToolbar.tsx`
- `src/features/agents/components/persona/PersonaOverviewBatchBar.tsx`
- `src/features/agents/components/persona/PersonaOverviewRowMenu.tsx`
- `src/features/agents/components/persona/ViewPresetBar.tsx`

**Entry points:** src-tauri/src/commands/core/personas.rs, src/features/agents/components/persona/PersonaOverviewPage.tsx

**Keywords:** persona, agent, identity, crud, overview, filter, batch, model-config

**Tech stack:** React, TypeScript, Rust, SQLite, Zustand

---

### persona-matrix

The team matrix canvas allows configuring multiple agent personas across dimensions (connectors, workflows, credentials) in a spreadsheet-like grid. It supports drag-and-drop cell editing, credential gap analysis, health indicators per cell, and workflow import. The matrix is the primary visual interface for team-level persona orchestration.

**Files:**
- `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx`
- `src/features/agents/components/matrix/DimensionEditPanel.tsx`
- `src/features/agents/components/matrix/DimensionQuickConfig.tsx`
- `src/features/agents/components/matrix/BuildReviewPanel.tsx`
- `src/features/agents/components/matrix/ConnectorsCellContent.tsx`
- `src/features/agents/components/matrix/GhostedCellRenderer.tsx`
- `src/features/agents/components/matrix/MatrixCredentialPicker.tsx`
- `src/features/agents/components/matrix/SpatialQuestionPopover.tsx`
- `src/features/agents/components/matrix/WorkflowUploadZone.tsx`
- `src/features/agents/components/matrix/useMatrixLifecycle.ts`
- `src/features/agents/components/matrix/useMatrixBuild.ts`
- `src/features/agents/components/matrix/useMatrixCredentialGap.ts`
- `src/features/agents/components/matrix/useMatrixEditCallbacks.ts`
- `src/features/agents/components/matrix/useMatrixWorkflowImport.ts`
- `src/features/agents/components/matrix/useHealthyConnectors.ts`
- `src/features/agents/components/matrix/cellGlowColors.ts`
- `src/features/agents/components/matrix/cellStateClasses.ts`
- `src/features/agents/components/matrix/cellVocabulary.ts`
- `src/features/agents/sub_activity/MatrixTab.tsx`

**Entry points:** src/features/agents/components/matrix/UnifiedMatrixEntry.tsx, src/features/agents/components/matrix/useMatrixLifecycle.ts

**Keywords:** matrix, team, canvas, dimension, cell, credential-gap, workflow-import, spatial

**Tech stack:** React, TypeScript, Zustand, Framer Motion

---

## Credential & Security Vault

> **Group type:** —
> **Color:** red

### credential-discovery

Automatically detects and imports credentials from the OS environment, desktop keyring, browser cookies, and config files. The foraging module scans known locations (env vars, .env files, keychain) while auth-detect infers authentication schemes from API endpoints. Desktop bridges provide OS-level access to system credential stores (macOS Keychain, Windows Credential Manager).

**Files:**
- `src-tauri/src/commands/credentials/foraging.rs`
- `src-tauri/src/commands/credentials/auth_detect.rs`
- `src-tauri/src/commands/credentials/desktop.rs`
- `src-tauri/src/commands/credentials/desktop_bridges.rs`
- `src-tauri/src/commands/credentials/auto_cred_browser.rs`
- `src-tauri/src/commands/credentials/intelligence.rs`
- `src-tauri/src/commands/credentials/nl_query.rs`
- `src-tauri/src/commands/credentials/openapi_autopilot.rs`
- `src-tauri/src/engine/desktop_security.rs`
- `src-tauri/src/engine/desktop_bridges.rs`

**Entry points:** src-tauri/src/commands/credentials/foraging.rs, src-tauri/src/commands/credentials/auth_detect.rs

**Keywords:** foraging, discovery, keychain, env-var, auto-detect, browser-cookies, openapi, nl-query

**Tech stack:** Rust, Tauri, Playwright

---

### credential-rotation

Manages scheduled and on-demand rotation of credentials to minimize exposure of long-lived secrets. Rotation policies are stored per credential; the engine tracks rotation history, validates new secrets before swapping, and triggers downstream reconnects on success. Passphrase and API key rotation are supported with audit logging.

**Files:**
- `src-tauri/src/commands/credentials/rotation.rs`
- `src-tauri/src/engine/rotation.rs`
- `src-tauri/src/db/repos/resources/rotation.rs`
- `src-tauri/src/db/models/rotation.rs`
- `src-tauri/src/commands/credentials/api_proxy.rs`
- `src-tauri/src/commands/credentials/query_debug.rs`
- `src-tauri/src/commands/credentials/schema_proposal.rs`
- `src-tauri/src/commands/credentials/credential_design.rs`
- `src-tauri/src/commands/credentials/credential_recipes.rs`
- `src-tauri/src/db/models/credential_recipe.rs`
- `src-tauri/src/db/repos/resources/credential_recipes.rs`

**Entry points:** src-tauri/src/commands/credentials/rotation.rs, src-tauri/src/engine/rotation.rs

**Keywords:** rotation, passphrase, api-key, expiry, audit, schedule, secret-lifecycle

**Tech stack:** Rust, SQLite, Tokio

---

### credential-storage

Core credential CRUD backed by AES-256-GCM encryption with PBKDF2-HMAC-SHA256 key derivation and optional OS keyring integration. Each credential stores connection parameters, secrets, and metadata for external services. The frontend provides a full credential management UI with search, tagging, and vault unlocking.

**Files:**
- `src-tauri/src/commands/credentials/crud.rs`
- `src-tauri/src/db/repos/resources/credentials.rs`
- `src-tauri/src/db/models/credential.rs`
- `src-tauri/src/db/models/credential_ledger.rs`
- `src-tauri/src/engine/crypto.rs`
- `src-tauri/src/engine/credential_negotiator.rs`
- `src-tauri/src/commands/credentials/shared.rs`
- `src-tauri/src/commands/credentials/connectors.rs`
- `src-tauri/src/db/models/connector.rs`
- `src/api/auth/connectors.ts`
- `src/api/vault/database/`
- `src/stores/credentialStore.ts`
- `src/features/credentials/`

**Entry points:** src-tauri/src/commands/credentials/crud.rs, src-tauri/src/engine/crypto.rs

**Keywords:** credential, vault, encryption, aes-256-gcm, pbkdf2, keyring, connector, secret

**Tech stack:** Rust, AES-256-GCM, SQLite, React, TypeScript

---

### oauth-flow

Handles the full OAuth 2.0 authorization code flow — launching the browser for user consent, capturing the redirect callback, exchanging codes for tokens, and storing encrypted tokens. A dedicated refresh lock prevents concurrent token refreshes from causing race conditions. Supports multiple OAuth providers via configurable connector definitions.

**Files:**
- `src-tauri/src/commands/credentials/oauth.rs`
- `src-tauri/src/engine/oauth_refresh.rs`
- `src-tauri/src/engine/oauth_refresh_lock.rs`
- `src-tauri/src/db/models/oauth_token_metric.rs`
- `src-tauri/src/db/repos/resources/oauth_token_metrics.rs`
- `src/api/auth/auth.ts`
- `src/api/auth/authDetect.ts`

**Entry points:** src-tauri/src/commands/credentials/oauth.rs, src-tauri/src/engine/oauth_refresh.rs

**Keywords:** oauth, token, refresh, authorization-code, redirect, bearer, callback, concurrency

**Tech stack:** Rust, Tokio, OAuth2

---

## Execution Engine

> **Group type:** —
> **Color:** blue

### execution-runner

The central agent execution orchestrator — receives execution requests, resolves credentials and context, dispatches to the appropriate LLM provider, manages the execution lifecycle (queued → running → completed/failed), and emits real-time events. Includes rate limiting, cost tracking, and IPC authentication for secure cross-process invocation.

**Files:**
- `src-tauri/src/engine/runner.rs`
- `src-tauri/src/engine/dispatch.rs`
- `src-tauri/src/engine/queue.rs`
- `src-tauri/src/engine/lifecycle.rs`
- `src-tauri/src/engine/process_session.rs`
- `src-tauri/src/engine/process_activity.rs`
- `src-tauri/src/engine/rate_limiter.rs`
- `src-tauri/src/engine/cost.rs`
- `src-tauri/src/engine/background.rs`
- `src-tauri/src/commands/execution/executions.rs`
- `src-tauri/src/db/repos/execution/executions.rs`
- `src-tauri/src/db/models/execution.rs`
- `src-tauri/src/ipc_auth.rs`
- `src/api/agents/executions.ts`
- `src/stores/execStore.ts`

**Entry points:** src-tauri/src/engine/runner.rs, src-tauri/src/engine/dispatch.rs

**Keywords:** execution, runner, queue, lifecycle, dispatch, rate-limit, cost, ipc, tokio

**Tech stack:** Rust, Tokio, SQLite

---

### execution-ui

Frontend for tracking, inspecting, and comparing agent executions. Displays a filterable execution list with status, duration, and cost; clicking into an execution shows a detailed inspector with traces, tool calls, and output diffs. Supports side-by-side comparison of two execution runs.

**Files:**
- `src/features/agents/sub_executions/executionStore.ts`
- `src/features/agents/sub_executions/types.ts`
- `src/features/agents/sub_activity/ActivityTab.tsx`
- `src/features/agents/sub_activity/ActivityFilters.tsx`
- `src/features/agents/sub_activity/ActivityHeader.tsx`
- `src/features/agents/sub_activity/ActivityList.tsx`
- `src/features/agents/sub_activity/ActivityModals.tsx`
- `src/features/agents/sub_activity/activityTypes.ts`
- `src/features/agents/sub_chat/ChatTab.tsx`
- `src/features/agents/sub_chat/ChatBubbles.tsx`
- `src/features/agents/sub_chat/OpsLaunchpad.tsx`
- `src/features/agents/sub_chat/SessionSidebar.tsx`
- `src/features/agents/sub_chat/libs/chatOpsDispatch.ts`
- `src/api/agents/chat.ts`
- `src/stores/chatStore.ts`

**Entry points:** src/features/agents/sub_activity/ActivityTab.tsx, src/features/agents/sub_chat/ChatTab.tsx

**Keywords:** execution, trace, activity, chat, inspector, comparison, ops-launchpad

**Tech stack:** React, TypeScript, Zustand

---

### pipeline-orchestration

Enables chaining multiple persona executions into pipelines with dependency graphs. The topology engine analyzes execution graphs for cycles and parallelization opportunities; composite executors handle fan-out/fan-in patterns. Pipeline state is persisted so interrupted runs can resume.

**Files:**
- `src-tauri/src/engine/pipeline.rs`
- `src-tauri/src/engine/pipeline_executor.rs`
- `src-tauri/src/engine/chain.rs`
- `src-tauri/src/engine/composite.rs`
- `src-tauri/src/engine/topology_graph.rs`
- `src-tauri/src/engine/topology_heuristic.rs`
- `src-tauri/src/engine/topology_types.rs`
- `src-tauri/src/engine/automation_runner.rs`
- `src-tauri/src/engine/connector_strategy.rs`
- `src-tauri/src/engine/config_merge.rs`
- `src-tauri/src/engine/compilation_pipeline.rs`
- `src/api/pipeline/groups.ts`
- `src/api/pipeline/workflows.ts`
- `src/stores/pipelineStore.ts`

**Entry points:** src-tauri/src/engine/pipeline.rs, src-tauri/src/engine/topology_graph.rs

**Keywords:** pipeline, chain, topology, graph, fan-out, composite, dag, workflow

**Tech stack:** Rust, Tokio, Petgraph

---

### prompt-compilation

Compiles structured persona definitions, context rules, and tool descriptions into LLM-ready prompts. The intent compiler translates high-level user intent into executable prompt trees; the chunker handles large contexts; and the parser extracts structured data from LLM responses. Provider-specific prompt formatting is handled per-model.

**Files:**
- `src-tauri/src/engine/compiler.rs`
- `src-tauri/src/engine/prompt.rs`
- `src-tauri/src/engine/intent_compiler.rs`
- `src-tauri/src/engine/parser.rs`
- `src-tauri/src/engine/chunker.rs`
- `src-tauri/src/engine/context_rules.rs`
- `src-tauri/src/engine/platform_rules.rs`
- `src-tauri/src/engine/capability.rs`
- `src-tauri/src/engine/capability_contract.rs`
- `src-tauri/src/engine/workflow_compiler.rs`
- `src-tauri/src/engine/safe_json.rs`
- `src/lib/personas/promptHelpers.ts`
- `src/lib/personas/llmHelpers.ts`

**Entry points:** src-tauri/src/engine/compiler.rs, src-tauri/src/engine/prompt.rs

**Keywords:** prompt, compilation, intent, chunker, parser, context-rules, capability, llm

**Tech stack:** Rust, Tokio

---

### trigger-system

Manages all execution trigger types: webhooks (HTTP callbacks), cron schedules, file-system watchers, clipboard monitoring, polling loops, shared events, and cloud webhook relays via Smee.io. Each trigger type has its own engine module; triggers are stored in the database and evaluated by the runner to decide when to fire an agent. Includes SSRF protection and URL safety checks.

**Files:**
- `src-tauri/src/engine/webhook.rs`
- `src-tauri/src/engine/cron.rs`
- `src-tauri/src/engine/file_watcher.rs`
- `src-tauri/src/engine/polling.rs`
- `src-tauri/src/engine/clipboard_monitor.rs`
- `src-tauri/src/engine/cloud_webhook_relay.rs`
- `src-tauri/src/engine/smee_relay.rs`
- `src-tauri/src/engine/shared_event_relay.rs`
- `src-tauri/src/engine/subscription.rs`
- `src-tauri/src/engine/url_safety.rs`
- `src-tauri/src/engine/ssrf_safe_dns.rs`
- `src-tauri/src/commands/tools/triggers.rs`
- `src-tauri/src/db/repos/resources/triggers.rs`
- `src-tauri/src/db/models/trigger.rs`
- `src-tauri/src/validation/trigger.rs`
- `src/api/pipeline/triggers.ts`

**Entry points:** src-tauri/src/commands/tools/triggers.rs, src-tauri/src/engine/webhook.rs

**Keywords:** webhook, cron, trigger, file-watcher, polling, clipboard, smee, cloud-relay, ssrf

**Tech stack:** Rust, Tokio, SQLite

---

## AI Design & Build

> **Group type:** —
> **Color:** violet

### design-reviews

Automates peer-style design reviews of agent configurations — an AI reviewer evaluates the persona design for completeness, coherence, and potential issues. Reviews can be accepted or rejected by the human user; decisions are persisted as memory items for agent learning. Manual review queues handle cases requiring human escalation.

**Files:**
- `src-tauri/src/commands/design/reviews.rs`
- `src-tauri/src/db/repos/communication/reviews.rs`
- `src-tauri/src/db/repos/communication/manual_reviews.rs`
- `src-tauri/src/db/models/review.rs`
- `src/api/overview/reviews.ts`
- `src/api/agents/outputAssertions.ts`
- `src/api/agents/tools.ts`
- `src/stores/agentStore.ts`

**Entry points:** src-tauri/src/commands/design/reviews.rs

**Keywords:** review, design-review, accept, reject, manual-review, ai-feedback, quality

**Tech stack:** Rust, React, TypeScript

---

### design-sessions

AI-powered iterative design workflow where the user converses with the system to define and refine an agent's purpose, capabilities, and configuration. Design sessions go through phases (analysis, proposal, applying) and produce a structured build result that can be committed to create or update a persona. The frontend wizard guides users step by step with live AI feedback.

**Files:**
- `src-tauri/src/commands/design/build_sessions.rs`
- `src-tauri/src/commands/design/conversations.rs`
- `src-tauri/src/commands/design/analysis.rs`
- `src-tauri/src/commands/design/skills.rs`
- `src-tauri/src/commands/design/platform_definitions.rs`
- `src-tauri/src/commands/design/smart_search.rs`
- `src-tauri/src/db/repos/core/build_sessions.rs`
- `src-tauri/src/db/repos/core/design_conversations.rs`
- `src-tauri/src/db/models/build_session.rs`
- `src-tauri/src/db/models/design_conversation.rs`
- `src-tauri/src/engine/design.rs`
- `src-tauri/src/engine/build_session.rs`
- `src/features/agents/sub_design/DesignTab.tsx`
- `src/features/agents/sub_design/DesignTabHelpers.ts`
- `src/api/agents/buildSession.ts`
- `src/stores/designStore.ts`

**Entry points:** src-tauri/src/commands/design/build_sessions.rs, src/features/agents/sub_design/DesignTab.tsx

**Keywords:** design, build-session, conversation, ai-design, analysis, proposal, wizard, persona-build

**Tech stack:** React, TypeScript, Rust, SQLite

---

### n8n-transform

Transforms n8n workflow JSON definitions into PersonaMatrix-compatible agent configurations. Parses n8n node graphs, maps nodes to persona capabilities and connectors, generates prompt templates from workflow logic, and produces a structured design output. Also supports round-tripping back to n8n format for users migrating workflows.

**Files:**
- `src-tauri/src/commands/design/n8n_transform/prompts.rs`
- `src-tauri/src/commands/design/n8n_sessions.rs`
- `src-tauri/src/commands/design/team_synthesis.rs`
- `src-tauri/src/engine/workflow_compiler.rs`
- `src-tauri/src/commands/tools/n8n_platform.rs`
- `src-tauri/src/db/models/n8n_session.rs`
- `src-tauri/src/db/repos/resources/n8n_sessions.rs`
- `src/api/agents/mcpTools.ts`

**Entry points:** src-tauri/src/commands/design/n8n_sessions.rs, src-tauri/src/commands/design/n8n_transform/prompts.rs

**Keywords:** n8n, workflow, transform, node-graph, migration, automation, team-synthesis

**Tech stack:** Rust, React, TypeScript

---

### template-management

Manages a library of reusable persona templates that users can adopt as a starting point. Template adoption applies a template's configuration to a new or existing persona, with integrity verified via checksums. User feedback on templates is collected to improve the template library over time.

**Files:**
- `src-tauri/src/commands/design/template_adopt.rs`
- `src-tauri/src/commands/design/template_feedback.rs`
- `src-tauri/src/db/models/template_feedback.rs`
- `src-tauri/src/db/repos/communication/template_feedback.rs`
- `src-tauri/src/engine/template_checksums.rs`
- `src/api/templates/`
- `src/lib/personas/templateHelpers.ts`

**Entry points:** src-tauri/src/commands/design/template_adopt.rs

**Keywords:** template, adopt, checksum, library, feedback, preset, starter

**Tech stack:** Rust, React, TypeScript

---

## Observability & Health

> **Group type:** —
> **Color:** emerald

### dashboard-analytics

The application's main home dashboard aggregating cross-persona metrics, execution trends, traffic/error charts, and recent activity into an at-a-glance view. Supports saved views for custom filter/sort configurations. Notification center surfaces GitLab pipeline events and system alerts.

**Files:**
- `src/features/overview/components/dashboard/DashboardHome.tsx`
- `src/features/overview/components/dashboard/widgets/TrafficErrorsChart.tsx`
- `src/features/overview/sub_activity/components/GlobalExecutionList.tsx`
- `src/features/gitlab/components/NotificationCenter.tsx`
- `src/api/overview/events.ts`
- `src/api/overview/savedViews.ts`
- `src/api/system/dataPortability.ts`
- `src-tauri/src/commands/core/saved_views.rs`
- `src-tauri/src/commands/core/data_portability.rs`
- `src-tauri/src/db/repos/core/saved_views.rs`
- `src-tauri/src/db/models/saved_views.rs`
- `src/stores/homStore.ts`
- `src/stores/globalStore.ts`

**Entry points:** src/features/overview/components/dashboard/DashboardHome.tsx

**Keywords:** dashboard, analytics, traffic, error-chart, saved-views, notification, gitlab, data-portability

**Tech stack:** React, TypeScript, Recharts, Zustand

---

### execution-observability

Captures structured traces, metrics, and SLA compliance data for every agent execution. The trace engine records each LLM call, tool invocation, and latency milestone; metrics are aggregated by time bucket for charting. SLA definitions set expected completion windows and error thresholds, with violation reporting.

**Files:**
- `src-tauri/src/engine/trace.rs`
- `src-tauri/src/engine/logger.rs`
- `src-tauri/src/engine/bus.rs`
- `src-tauri/src/engine/event_registry.rs`
- `src-tauri/src/engine/digest.rs`
- `src-tauri/src/commands/communication/observability/metrics.rs`
- `src-tauri/src/commands/communication/sla.rs`
- `src-tauri/src/db/repos/execution/traces.rs`
- `src-tauri/src/db/repos/execution/metrics.rs`
- `src-tauri/src/db/models/observability.rs`
- `src-tauri/src/db/models/sla.rs`
- `src/features/observability/`
- `src/api/overview/observability.ts`
- `src/api/overview/sla.ts`
- `src/stores/observabilityStore.ts`

**Entry points:** src-tauri/src/engine/trace.rs, src-tauri/src/commands/communication/observability/metrics.rs

**Keywords:** trace, metrics, sla, latency, observability, event-bus, aggregation, violation

**Tech stack:** Rust, SQLite, React, TypeScript

---

### healing-recovery

Self-healing system that detects execution failures, classifies errors using a taxonomy, and automatically applies fixes (retries, credential refreshes, prompt adjustments, rollbacks). An AI-driven healing orchestrator proposes multi-step recovery plans; the timeline tracks all healing attempts per execution. Circuit breakers prevent cascading failures.

**Files:**
- `src-tauri/src/engine/healing.rs`
- `src-tauri/src/engine/healing_orchestrator.rs`
- `src-tauri/src/engine/healing_timeline.rs`
- `src-tauri/src/engine/auto_rollback.rs`
- `src-tauri/src/engine/ai_healing.rs`
- `src-tauri/src/engine/ai_helpers.rs`
- `src-tauri/src/engine/error_taxonomy.rs`
- `src-tauri/src/commands/execution/healing.rs`
- `src-tauri/src/db/repos/execution/healing.rs`
- `src-tauri/src/db/repos/execution/circuit_breaker.rs`
- `src-tauri/src/db/models/healing.rs`
- `src/api/overview/healing.ts`

**Entry points:** src-tauri/src/engine/healing_orchestrator.rs, src-tauri/src/engine/healing.rs

**Keywords:** healing, recovery, rollback, circuit-breaker, ai-healing, error-taxonomy, retry, resilience

**Tech stack:** Rust, Tokio, SQLite

---

### health-monitoring

Provides per-agent health scoring, digest generation, and issue detection. Health checks run on demand or on a schedule; each check produces a scored result with specific issues and suggested fixes. Digests aggregate health history into a human-readable summary. The frontend renders health rings, issue cards, and trending panels.

**Files:**
- `src/features/agents/health/HealthCheckPanel.tsx`
- `src/features/agents/health/HealthDigestPanel.tsx`
- `src/features/agents/health/HealthIssueCard.tsx`
- `src/features/agents/health/HealthScoreDisplay.tsx`
- `src/features/agents/health/types.ts`
- `src/features/agents/health/useApplyHealthFix.ts`
- `src/features/agents/health/useHealthCheck.ts`
- `src/features/agents/health/useHealthDigestScheduler.ts`
- `src-tauri/src/commands/communication/observability/digest.rs`
- `src-tauri/src/commands/communication/observability/alerts.rs`
- `src-tauri/src/engine/healthcheck.rs`
- `src-tauri/src/commands/infrastructure/system/health.rs`
- `src/api/overview/healthcheckApi.ts`
- `src/api/overview/healing.ts`

**Entry points:** src/features/agents/health/HealthCheckPanel.tsx, src-tauri/src/engine/healthcheck.rs

**Keywords:** health, score, digest, issue, alert, fix, monitoring, schedule

**Tech stack:** React, TypeScript, Rust, SQLite

---

## Knowledge & Memory

> **Group type:** —
> **Color:** indigo

### agent-memory

Stores and retrieves agent-specific episodic memories — facts the agent has learned, decisions made, and user preferences recorded during interactions. Memories are associated with a persona and can be retrieved by recency or relevance. The review/reject flow from design reviews feeds directly into this memory store.

**Files:**
- `src-tauri/src/commands/core/memories.rs`
- `src-tauri/src/db/repos/core/memories.rs`
- `src-tauri/src/db/models/memory.rs`
- `src-tauri/src/validation/memory.rs`
- `src/api/overview/memories.ts`
- `src/stores/personalMemoryStore.ts`

**Entry points:** src-tauri/src/commands/core/memories.rs

**Keywords:** memory, episodic, persona-memory, recall, fact, preference, learning

**Tech stack:** Rust, SQLite, React

---

### ambient-context

Captures ambient context from the user's environment — active window, clipboard contents, recent files, and screen state — and makes it available to agents as execution context. Context rules define which ambient data applies under which conditions. Includes OCR capabilities for extracting text from screen captures.

**Files:**
- `src-tauri/src/engine/ambient_context.rs`
- `src-tauri/src/commands/execution/ambient.rs`
- `src-tauri/src/commands/execution/clipboard_intel.rs`
- `src-tauri/src/engine/app_focus.rs`
- `src-tauri/src/engine/path_safety.rs`
- `src-tauri/src/commands/ocr/mod.rs`
- `src/api/ocr/index.ts`
- `src/api/system/ambientContext.ts`
- `src/lib/personas/executionHelpers.ts`

**Entry points:** src-tauri/src/engine/ambient_context.rs, src-tauri/src/commands/execution/ambient.rs

**Keywords:** ambient, context, clipboard, ocr, screen, app-focus, context-rules, environment

**Tech stack:** Rust, Tauri, Tesseract/OCR

---

### knowledge-base

Manages the vector-backed knowledge base that provides agents with long-term factual context. Documents are ingested, chunked, embedded, and stored in a vector store for semantic retrieval at execution time. Supports multiple knowledge bases per persona with relevance scoring and citation tracking.

**Files:**
- `src-tauri/src/engine/knowledge.rs`
- `src-tauri/src/engine/kb_ingest.rs`
- `src-tauri/src/engine/vector_store.rs`
- `src-tauri/src/engine/embedder.rs`
- `src-tauri/src/commands/execution/knowledge.rs`
- `src-tauri/src/db/repos/execution/knowledge.rs`
- `src-tauri/src/db/models/knowledge.rs`
- `src-tauri/src/db/models/knowledge_base.rs`
- `src/api/agents/genome.ts`
- `src/api/overview/intelligence/knowledge.ts`
- `src/api/overview/intelligence/smartSearch.ts`
- `src/api/overview/intelligence/teamSynthesis.ts`
- `src/stores/knowledgeStore.ts`

**Entry points:** src-tauri/src/engine/knowledge.rs, src-tauri/src/engine/kb_ingest.rs

**Keywords:** knowledge-base, vector-store, embedding, semantic-search, rag, ingestion, chunking

**Tech stack:** Rust, SQLite, Embeddings

---

### obsidian-integration

Integrates with an Obsidian vault as an external long-term knowledge graph. Syncs Obsidian markdown notes, resolves wikilinks, handles merge conflicts between vault and persona knowledge, and ingests vault content into the knowledge base. Used primarily for research workflows via the /research skill.

**Files:**
- `src-tauri/src/commands/obsidian_brain/conflict.rs`
- `src-tauri/src/commands/obsidian_brain/markdown.rs`
- `src-tauri/src/db/models/obsidian_brain.rs`
- `src-tauri/src/db/repos/resources/obsidian_brain.rs`
- `src/api/obsidianBrain/index.ts`

**Entry points:** src-tauri/src/commands/obsidian_brain/markdown.rs

**Keywords:** obsidian, vault, markdown, wikilink, knowledge-graph, sync, conflict-resolution

**Tech stack:** Rust, Markdown, TypeScript

---

## Lab & Testing

> **Group type:** —
> **Color:** orange

### agent-evolution

Implements evolutionary/genetic algorithms for automatically improving agent configurations over time. Each persona has a 'genome' (configuration gene set); evolution runs mutate genomes and evaluate fitness using test suites; successful mutations are promoted. The genome history tracks lineage and allows rollback to prior successful configurations.

**Files:**
- `src-tauri/src/engine/evolution.rs`
- `src-tauri/src/engine/genome.rs`
- `src-tauri/src/commands/execution/evolution.rs`
- `src-tauri/src/commands/execution/genome.rs`
- `src-tauri/src/db/repos/lab/evolution.rs`
- `src-tauri/src/db/repos/lab/genome.rs`
- `src-tauri/src/db/repos/lab/versions.rs`
- `src-tauri/src/db/repos/lab/ratings.rs`
- `src-tauri/src/db/models/evolution.rs`
- `src-tauri/src/db/models/genome.rs`
- `src/api/agents/evolution.ts`
- `src/api/agents/genome.ts`

**Entry points:** src-tauri/src/engine/evolution.rs, src-tauri/src/commands/execution/evolution.rs

**Keywords:** evolution, genome, genetic-algorithm, mutation, fitness, lineage, versioning

**Tech stack:** Rust, SQLite

---

### quality-assurance

Output assertion engine that validates agent responses against user-defined rules (regex, semantic similarity, JSON schema, custom scripts). Quality gates enforce minimum assertion pass rates before an execution is considered successful. Supports the prompt lab for iterative prompt optimization against a fixed assertion set.

**Files:**
- `src-tauri/src/engine/output_assertions.rs`
- `src-tauri/src/engine/quality_gate.rs`
- `src-tauri/src/commands/execution/assertions.rs`
- `src-tauri/src/commands/communication/observability/prompt_lab.rs`
- `src-tauri/src/db/repos/execution/assertions.rs`
- `src-tauri/src/db/models/output_assertion.rs`
- `src/api/agents/outputAssertions.ts`

**Entry points:** src-tauri/src/engine/output_assertions.rs, src-tauri/src/commands/execution/assertions.rs

**Keywords:** assertion, quality-gate, output-validation, prompt-lab, regex, semantic-similarity, schema-validation

**Tech stack:** Rust, SQLite

---

### recipes

Agent recipe system for creating, versioning, and executing reusable multi-step agent workflows. Recipes are parameterized task templates that can be shared, cloned, and executed with different inputs. Recipe generation uses AI to propose recipes from observed execution patterns.

**Files:**
- `src-tauri/src/commands/recipes/crud.rs`
- `src-tauri/src/commands/recipes/recipe_execution.rs`
- `src-tauri/src/commands/recipes/recipe_generation.rs`
- `src-tauri/src/commands/recipes/recipe_versioning.rs`
- `src-tauri/src/db/repos/resources/recipes.rs`
- `src-tauri/src/db/models/recipe.rs`
- `src/features/agents/sub_recipes/RecipeGallery.tsx`
- `src/features/agents/sub_recipes/RecipeEditor.tsx`
- `src/features/agents/sub_recipes/RecipeTab.tsx`
- `src/api/agents/lab.ts`

**Entry points:** src-tauri/src/commands/recipes/crud.rs, src/features/agents/sub_recipes/RecipeGallery.tsx

**Keywords:** recipe, template, versioning, parameterized, workflow, ai-generation, reusable

**Tech stack:** React, TypeScript, Rust, SQLite

---

### test-lab

A dedicated lab environment for running structured test suites against agent personas. Supports defining test cases with input/expected-output pairs, running full suites, and viewing pass/fail results in an eval panel. The lab also hosts A/B testing (arena) for comparing two persona configurations head-to-head.

**Files:**
- `src/features/agents/sub_lab/LabDashboard.tsx`
- `src/features/agents/sub_lab/LabPanel.tsx`
- `src/features/agents/sub_lab/LabTab.tsx`
- `src/features/agents/sub_lab/LabTabContent.tsx`
- `src-tauri/src/commands/execution/lab.rs`
- `src-tauri/src/commands/execution/test_suites.rs`
- `src-tauri/src/commands/execution/tests.rs`
- `src-tauri/src/engine/test_runner.rs`
- `src-tauri/src/engine/eval.rs`
- `src-tauri/src/engine/dream_replay.rs`
- `src-tauri/src/db/repos/lab/ab.rs`
- `src-tauri/src/db/repos/lab/arena.rs`
- `src-tauri/src/db/repos/lab/eval.rs`
- `src-tauri/src/db/repos/execution/test_runs.rs`
- `src-tauri/src/db/repos/execution/test_suites.rs`
- `src-tauri/src/db/models/lab.rs`
- `src-tauri/src/db/models/test_run.rs`
- `src-tauri/src/db/models/test_suite.rs`
- `src/api/agents/testSuites.ts`
- `src/api/agents/tests.ts`
- `src/stores/labStore.ts`

**Entry points:** src/features/agents/sub_lab/LabTab.tsx, src-tauri/src/engine/test_runner.rs

**Keywords:** lab, test-suite, eval, a-b-testing, arena, dream-replay, assertion, pass-fail

**Tech stack:** React, TypeScript, Rust, SQLite

---

## Platform Integration

> **Group type:** —
> **Color:** pink

### automation-tools

Manages the tool registry — external integrations (APIs, scripts, browser actions) that agents can invoke during execution. Includes automation design (AI-generates tool configurations), deployment of automations to external platforms, and GitHub Actions integration. Tool audit logs track every invocation for compliance.

**Files:**
- `src-tauri/src/commands/tools/tools.rs`
- `src-tauri/src/commands/tools/automations.rs`
- `src-tauri/src/commands/tools/automation_design.rs`
- `src-tauri/src/commands/tools/deploy_automation.rs`
- `src-tauri/src/commands/tools/github_platform.rs`
- `src-tauri/src/engine/tool_runner.rs`
- `src-tauri/src/engine/api_proxy.rs`
- `src-tauri/src/engine/api_definition.rs`
- `src-tauri/src/db/repos/resources/tools.rs`
- `src-tauri/src/db/repos/resources/automations.rs`
- `src-tauri/src/db/repos/resources/tool_audit_log.rs`
- `src-tauri/src/db/models/tool.rs`
- `src-tauri/src/db/models/automation.rs`
- `src-tauri/src/db/models/tool_audit.rs`
- `src/api/agents/tools.ts`
- `src/stores/globalStore.ts`

**Entry points:** src-tauri/src/commands/tools/tools.rs, src-tauri/src/engine/tool_runner.rs

**Keywords:** tool, automation, api-proxy, github-actions, tool-registry, invocation, audit

**Tech stack:** Rust, TypeScript, React

---

### gitlab-integration

Integrates with GitLab CI/CD pipelines — converts persona execution results into GitLab pipeline status updates, pulls pipeline events for the notification center, and supports triggering pipelines from persona executions. The cloud module handles deployment of personas to hosted infrastructure.

**Files:**
- `src-tauri/src/gitlab/client.rs`
- `src-tauri/src/gitlab/config.rs`
- `src-tauri/src/gitlab/converter.rs`
- `src-tauri/src/gitlab/types.rs`
- `src-tauri/src/gitlab/mod.rs`
- `src-tauri/src/commands/infrastructure/gitlab.rs`
- `src-tauri/src/cloud/client.rs`
- `src-tauri/src/cloud/config.rs`
- `src-tauri/src/cloud/runner.rs`
- `src-tauri/src/cloud/mod.rs`
- `src-tauri/src/commands/infrastructure/cloud.rs`
- `src-tauri/src/db/repos/resources/deployment_history.rs`
- `src/api/system/gitlab.ts`
- `src/api/system/cloud.ts`
- `src/features/gitlab/components/NotificationCenter.tsx`

**Entry points:** src-tauri/src/gitlab/client.rs, src-tauri/src/cloud/runner.rs

**Keywords:** gitlab, ci-cd, pipeline, cloud, deployment, notification, webhook

**Tech stack:** Rust, GitLab API, React

---

### mcp-integration

Implements the Model Context Protocol (MCP) server and client, allowing personas to expose and consume tools via the standardized MCP interface. The MCP server runs as a sidecar binary; tools are installed and managed through the mcp_server module. Agents can discover and invoke MCP tools from other servers on the local network.

**Files:**
- `src-tauri/src/mcp_server/tools.rs`
- `src-tauri/src/mcp_server/install.rs`
- `src-tauri/src/mcp_server/db.rs`
- `src-tauri/src/mcp_server/mod.rs`
- `src-tauri/src/mcp_bin.rs`
- `src-tauri/src/engine/mcp_tools.rs`
- `src-tauri/src/commands/credentials/mcp_tools.rs`
- `src-tauri/src/commands/infrastructure/system/mcp_integration.rs`
- `src/api/agents/mcpTools.ts`

**Entry points:** src-tauri/src/mcp_bin.rs, src-tauri/src/mcp_server/tools.rs

**Keywords:** mcp, model-context-protocol, tool-server, sidecar, tool-install, local-network

**Tech stack:** Rust, MCP Protocol, TypeScript

---

### p2p-network

Peer-to-peer networking layer enabling multiple Personas desktop instances to discover each other via mDNS, sync agent manifests, and exchange encrypted messages. The identity module manages each node's keypair for signing; exposure controls what is shared with peers. Used for collaborative multi-agent scenarios and team-level persona sharing.

**Files:**
- `src-tauri/src/engine/p2p/connection.rs`
- `src-tauri/src/engine/p2p/manifest_sync.rs`
- `src-tauri/src/engine/p2p/mdns.rs`
- `src-tauri/src/engine/p2p/messaging.rs`
- `src-tauri/src/engine/p2p/periodic.rs`
- `src-tauri/src/engine/p2p/protocol.rs`
- `src-tauri/src/engine/p2p/transport.rs`
- `src-tauri/src/engine/p2p/types.rs`
- `src-tauri/src/commands/network/bundle.rs`
- `src-tauri/src/commands/network/discovery.rs`
- `src-tauri/src/commands/network/enclave.rs`
- `src-tauri/src/commands/network/exposure.rs`
- `src-tauri/src/commands/network/identity.rs`
- `src-tauri/src/engine/bundle.rs`
- `src-tauri/src/engine/enclave.rs`
- `src-tauri/src/engine/identity.rs`
- `src-tauri/src/engine/share_link.rs`
- `src-tauri/src/db/models/exposure.rs`
- `src-tauri/src/db/models/identity.rs`
- `src/features/network/`
- `src/api/network/`
- `src/stores/networkStore.ts`

**Entry points:** src-tauri/src/engine/p2p/connection.rs, src-tauri/src/commands/network/discovery.rs

**Keywords:** p2p, mdns, discovery, identity, enclave, manifest-sync, bundle, exposure, share-link

**Tech stack:** Rust, mDNS, P2P, TypeScript

---

### provider-management

Abstracts LLM provider integrations (Claude/Anthropic, OpenAI Codex) behind a uniform interface with automatic failover and circuit breaking. BYOM (Bring Your Own Model) allows users to configure custom API-compatible endpoints. Provider selection uses topology analysis to route executions to the optimal available model.

**Files:**
- `src-tauri/src/engine/provider/claude.rs`
- `src-tauri/src/engine/provider/codex.rs`
- `src-tauri/src/engine/provider/mod.rs`
- `src-tauri/src/engine/failover.rs`
- `src-tauri/src/engine/llm_topology.rs`
- `src-tauri/src/commands/infrastructure/byom.rs`
- `src-tauri/src/engine/byom.rs`
- `src-tauri/src/engine/tier.rs`
- `src-tauri/src/commands/infrastructure/tier_usage.rs`
- `src/api/system/byom.ts`
- `src/stores/settingsStore.ts`

**Entry points:** src-tauri/src/engine/provider/claude.rs, src-tauri/src/engine/failover.rs

**Keywords:** llm, provider, claude, openai, byom, failover, model-selection, tier

**Tech stack:** Rust, Tokio, Anthropic SDK, OpenAI API

---


<!-- snapshot-meta
git_head: 52182a0a66a8cb4c5c37cbee834110390a0df04e
git_commit_count: 318
generated_at: 2026-04-07T21:44:39.938Z
-->
