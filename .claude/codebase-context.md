# Codebase Context Snapshot — personas

> Generated: 2026-06-05T11:38:12.625Z
> Source: dev_contexts table for project_id=b0c1541f-af08-4912-818e-19ca94f7b6e9
> Total groups: 8, Total contexts: 41
> Git HEAD at generation: 91da41a0 (feat(quick-answer): pending-interactions hook + popover + cards + i18n)
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
## Agent Management

> **Group type:** —
> **Color:** amber

### agent-chat

Powers the real-time chat interface between the user and a selected persona. Messages are streamed from the LLM provider, rendered with markdown and code highlighting, and persisted for session continuity. The Rust side handles prompt assembly, streaming, and storing chat history.

**Files:**
- `src/api/agents/chat.ts`
- `src/features/agents/components/ChatThread.tsx`
- `src/features/agents/components/ChatMessageContent.tsx`
- `src-tauri/src/db/models/chat.rs`
- `src-tauri/src/db/repos/communication/chat.rs`
- `src-tauri/src/commands/core/chat.rs`
- `src-tauri/src/commands/core/validation.rs`

**Entry points:** src/features/agents/components/ChatThread.tsx, src-tauri/src/commands/core/chat.rs

**Keywords:** chat, message, streaming, conversation, prompt, LLM, markdown

**API surface:** Tauri IPC: send_chat_message, stream_response, get_chat_history

**Tech stack:** React, TypeScript, Rust, SQLite

---

### agent-testing

Provides structured test suites and output assertion infrastructure to validate agent behaviour against expected outcomes. Test runs capture inputs, outputs, and pass/fail verdicts; output assertions define fuzzy and exact match rules evaluated after each execution. Supports AI-synthesised review generation.

**Files:**
- `src/api/agents/tests.ts`
- `src/api/agents/testSuites.ts`
- `src/api/agents/outputAssertions.ts`
- `src-tauri/src/db/models/test_run.rs`
- `src-tauri/src/db/models/test_suite.rs`
- `src-tauri/src/db/models/output_assertion.rs`
- `src-tauri/src/db/repos/execution/test_runs.rs`
- `src-tauri/src/db/repos/execution/test_suites.rs`
- `src-tauri/src/db/repos/execution/assertions.rs`
- `src-tauri/src/commands/execution/assertions.rs`
- `src-tauri/src/commands/execution/test_suites.rs`
- `src-tauri/src/commands/execution/tests.rs`
- `src-tauri/src/commands/testing/synthesize_review.rs`
- `src-tauri/src/engine/output_assertions.rs`
- `src-tauri/src/engine/quality_gate.rs`

**Entry points:** src/api/agents/testSuites.ts, src-tauri/src/engine/output_assertions.rs

**Keywords:** test-suite, assertion, output-validation, quality-gate, test-run, synthesize-review, pass-fail

**API surface:** Tauri IPC: run_test_suite, create_assertion, list_test_runs, synthesize_review

**Tech stack:** Rust, TypeScript, SQLite

---

### agent-tools-automations

Manages the tool registry that agents can call during execution, plus per-agent automation rules that trigger agent runs based on events or schedules. Tools are defined with JSON schemas, audited on every call, and scoped to specific personas via capability contracts.

**Files:**
- `src/api/agents/tools.ts`
- `src/api/agents/automations.ts`
- `src-tauri/src/db/models/tool.rs`
- `src-tauri/src/db/models/tool_audit.rs`
- `src-tauri/src/db/models/tool_usage.rs`
- `src-tauri/src/db/models/automation.rs`
- `src-tauri/src/db/repos/resources/tools.rs`
- `src-tauri/src/db/repos/resources/automations.rs`
- `src-tauri/src/db/repos/resources/tool_audit_log.rs`
- `src-tauri/src/engine/tool_runner.rs`
- `src-tauri/src/commands/tools/automations.rs`
- `src-tauri/src/commands/tools/automation_design.rs`

**Entry points:** src-tauri/src/engine/tool_runner.rs, src/api/agents/tools.ts

**Keywords:** tool, automation, capability, json-schema, tool-audit, MCP, function-calling

**API surface:** Tauri IPC: list_tools, create_tool, run_tool, get_tool_audit_log

**Tech stack:** Rust, TypeScript, SQLite

---

### persona-crud

Handles the full lifecycle of creating, reading, updating, and deleting AI persona definitions. Personas are the core product unit — they hold system prompts, model configs, connector bindings, and metadata. The backend persists them in SQLite via a repository pattern, while the frontend provides a multi-card browser with filtering, sorting, and inline editing.

**Files:**
- `src/api/agents/personas.ts`
- `src-tauri/src/commands/core/personas.rs`
- `src-tauri/src/db/models/agent_ir.rs`
- `src-tauri/src/db/models/persona.rs`
- `src-tauri/src/db/repos/core/personas.rs`
- `src/api/agents/channelDelivery.ts`
- `src/api/agents/useCases.ts`
- `src/api/agents/annotations.ts`

**Entry points:** src-tauri/src/commands/core/personas.rs, src/api/agents/personas.ts

**Keywords:** persona, agent, system-prompt, model-config, crud, agent-ir, build

**API surface:** Tauri IPC: create_persona, update_persona, delete_persona, list_personas, get_persona

**Tech stack:** Rust, SQLite, TypeScript, React

---

### persona-evolution

Manages the genetic-algorithm-inspired evolution system for improving agent personas over time. Genomes encode agent behaviour as modifiable parameters; evolution cycles run evaluations and produce improved variants. The lab subsystem hosts A/B tests, arena battles, consensus scoring, and version history.

**Files:**
- `src/api/agents/genome.ts`
- `src/api/agents/evolution.ts`
- `src/api/agents/lab.ts`
- `src-tauri/src/db/models/genome.rs`
- `src-tauri/src/db/models/evolution.rs`
- `src-tauri/src/db/models/lab.rs`
- `src-tauri/src/db/repos/lab/genome.rs`
- `src-tauri/src/db/repos/lab/evolution.rs`
- `src-tauri/src/db/repos/lab/versions.rs`
- `src-tauri/src/db/repos/lab/ab.rs`
- `src-tauri/src/db/repos/lab/arena.rs`
- `src-tauri/src/db/repos/lab/consensus.rs`
- `src-tauri/src/db/repos/lab/eval.rs`
- `src-tauri/src/db/repos/lab/ratings.rs`
- `src-tauri/src/engine/evolutions.rs`

**Entry points:** src/api/agents/evolution.ts, src-tauri/src/db/repos/lab/evolution.rs

**Keywords:** genome, evolution, A/B-test, arena, fitness, version, lab, ratings, consensus

**API surface:** Tauri IPC: evolve_persona, run_arena, compare_versions, score_genome

**Tech stack:** Rust, TypeScript, SQLite

---

## Execution Engine

> **Group type:** —
> **Color:** emerald

### build-session

Manages the structured build-session lifecycle used when adopting a template or configuring a persona interactively. A build session tracks phases (draft → testing → ready → promoted) with blocking transitions and user approval gates. The frontend polls build state and the backend ensures phase ordering.

**Files:**
- `src/api/agents/buildSession.ts`
- `src-tauri/src/db/models/build_session.rs`
- `src-tauri/src/db/repos/core/build_sessions.rs`
- `src-tauri/src/engine/adoption_answers.rs`
- `src-tauri/src/commands/infrastructure/context_generation.rs`

**Entry points:** src/api/agents/buildSession.ts, src-tauri/src/db/models/build_session.rs

**Keywords:** build-session, draft, promote, adoption, phase-gate, readiness

**API surface:** Tauri IPC: start_build_session, advance_phase, promote_draft, get_build_session

**Tech stack:** Rust, TypeScript, SQLite

---

### execution-healing

Automatic error recovery system that detects execution failures, classifies them via error taxonomy, and attempts remediation strategies (retry, credential refresh, circuit break, rollback). Healing events are stored for audit and the timeline provides a UI for reviewing what was attempted and what succeeded.

**Files:**
- `src-tauri/src/engine/healing.rs`
- `src-tauri/src/engine/healing_orchestrator.rs`
- `src-tauri/src/engine/healing_timeline.rs`
- `src-tauri/src/engine/ai_healing.rs`
- `src-tauri/src/engine/auto_rollback.rs`
- `src-tauri/src/engine/auto_triage.rs`
- `src-tauri/src/engine/failover.rs`
- `src-tauri/src/engine/error_taxonomy.rs`
- `src-tauri/src/db/models/healing.rs`
- `src-tauri/src/db/repos/execution/healing.rs`
- `src-tauri/src/commands/execution/healing.rs`
- `src/api/overview/healing.ts`

**Entry points:** src-tauri/src/engine/healing_orchestrator.rs, src/api/overview/healing.ts

**Keywords:** healing, recovery, rollback, circuit-breaker, triage, failover, retry, error-taxonomy

**API surface:** Tauri IPC: get_healing_timeline, list_healing_events, force_rollback

**Tech stack:** Rust, TypeScript, SQLite

---

### execution-observability

Captures structured traces, metrics, and audit incidents from every execution for post-hoc analysis and operational alerting. Policy events allow governance rules to fire on abnormal patterns; provider audit tracks per-provider token spend. The overview UI surfaces this data as time-series charts and incident lists.

**Files:**
- `src-tauri/src/engine/trace.rs`
- `src-tauri/src/db/models/audit_incident.rs`
- `src-tauri/src/db/models/audit_log.rs`
- `src-tauri/src/db/models/policy_event.rs`
- `src-tauri/src/db/models/observability.rs`
- `src-tauri/src/db/repos/execution/traces.rs`
- `src-tauri/src/db/repos/execution/metrics.rs`
- `src-tauri/src/db/repos/execution/audit_incidents.rs`
- `src-tauri/src/db/repos/execution/policy_events.rs`
- `src-tauri/src/db/repos/execution/provider_audit.rs`
- `src-tauri/src/commands/execution/audit_incidents.rs`
- `src-tauri/src/commands/execution/policy_events.rs`
- `src-tauri/src/commands/communication/observability/mod.rs`
- `src/api/overview/observability.ts`
- `src/api/overview/healthcheckApi.ts`

**Entry points:** src-tauri/src/engine/trace.rs, src/api/overview/observability.ts

**Keywords:** traces, metrics, audit-incident, policy-event, provider-audit, token-spend, observability

**API surface:** Tauri IPC: list_incidents, get_metrics, list_policy_events, get_healthcheck

**Tech stack:** Rust, TypeScript, Recharts, SQLite

---

### execution-runtime

The core agent execution pipeline — receives a run request, assembles the prompt context, calls the LLM provider, streams the response, and persists the run record. The runner module in Rust coordinates stages (context build → provider call → output capture → post-processing) and emits progress events over the Tauri event bus.

**Files:**
- `src/api/agents/executions.ts`
- `src-tauri/src/engine/runner/mod.rs`
- `src-tauri/src/engine/pipeline.rs`
- `src-tauri/src/engine/pipeline_executor.rs`
- `src-tauri/src/engine/bus.rs`
- `src-tauri/src/engine/events.rs`
- `src-tauri/src/engine/protocol.rs`
- `src-tauri/src/engine/intent_compiler.rs`
- `src-tauri/src/engine/prepared_run_cache.rs`
- `src-tauri/src/engine/inflight_guard.rs`
- `src-tauri/src/db/models/execution.rs`
- `src-tauri/src/db/models/execution_annotation.rs`
- `src-tauri/src/db/repos/execution/executions.rs`
- `src-tauri/src/db/repos/execution/annotations.rs`

**Entry points:** src-tauri/src/engine/runner/mod.rs, src/api/agents/executions.ts

**Keywords:** execution, runner, pipeline, LLM-provider, streaming, run-record, stages, bus

**API surface:** Tauri IPC: run_persona, stream_execution, get_execution, list_executions

**Tech stack:** Rust, Tokio, TypeScript

---

### sla-alerting

SLA tracking and alert rule engine that monitors execution performance against user-defined thresholds. Alert rules fire on latency, error rate, or availability breaches and push notifications to the user. The manual review queue captures flagged runs that need human inspection before resolution.

**Files:**
- `src-tauri/src/db/models/sla.rs`
- `src-tauri/src/db/repos/communication/sla.rs`
- `src-tauri/src/db/repos/communication/alert_rules.rs`
- `src-tauri/src/db/repos/communication/manual_reviews.rs`
- `src-tauri/src/db/repos/communication/reviews.rs`
- `src-tauri/src/commands/communication/sla.rs`
- `src/api/overview/sla.ts`

**Entry points:** src/api/overview/sla.ts, src-tauri/src/commands/communication/sla.rs

**Keywords:** SLA, alert-rule, manual-review, threshold, latency, availability, notification

**API surface:** Tauri IPC: get_sla_summary, list_alert_rules, create_alert_rule, list_manual_reviews

**Tech stack:** Rust, TypeScript, SQLite

---

## Credential & Connection Hub

> **Group type:** —
> **Color:** blue

### connector-catalog

The built-in connector library containing 100+ pre-defined integrations (GitHub, GitLab, AWS, Postgres, Slack, Discord, etc.) as JSON seed files, plus the runtime connector model and explorer that resolves which connectors a persona needs and whether credentials are bound. Connector readiness gates agent execution.

**Files:**
- `src/api/auth/connectors.ts`
- `src-tauri/src/db/models/connector.rs`
- `src-tauri/src/db/repos/resources/connectors.rs`
- `src-tauri/src/engine/connector_strategy.rs`
- `src-tauri/src/commands/design/connector_explorer.rs`
- `src-tauri/src/db/builtin_connectors.rs`
- `scripts/generate-connector-seed.mjs`
- `scripts/connectors/builtin/github.json`
- `scripts/connectors/builtin/gitlab.json`
- `scripts/connectors/builtin/aws-cloud.json`
- `scripts/connectors/builtin/postgres.json`
- `scripts/connectors/builtin/slack.json`
- `scripts/connectors/builtin/discord.json`

**Entry points:** src-tauri/src/db/builtin_connectors.rs, src/api/auth/connectors.ts

**Keywords:** connector, integration, GitHub, Slack, builtin, connector-catalog, readiness, binding

**API surface:** Tauri IPC: list_connectors, get_connector, explore_connectors, check_connector_readiness

**Tech stack:** Rust, JSON, TypeScript

---

### credential-recipes

Bundles of credentials pre-configured for common setups (e.g. full AWS stack, GitHub + CI combo). Recipes are adopted as a unit, reducing the setup friction for credential-heavy personas. The foraging engine discovers which credentials already exist and fills gaps.

**Files:**
- `src/api/vault/credentialRecipes.ts`
- `src/api/vault/foraging.ts`
- `src-tauri/src/db/models/credential_recipe.rs`
- `src-tauri/src/db/repos/resources/credential_recipes.rs`
- `src-tauri/src/commands/credentials/credential_recipes.rs`
- `src-tauri/src/db/models/rotation.rs`
- `src-tauri/src/db/repos/resources/rotation.rs`
- `src/api/vault/rotation.ts`

**Entry points:** src/api/vault/credentialRecipes.ts, src-tauri/src/commands/credentials/credential_recipes.rs

**Keywords:** credential-recipe, foraging, rotation, bundle, setup-wizard, refresh

**API surface:** Tauri IPC: adopt_credential_recipe, list_credential_recipes, rotate_credential

**Tech stack:** Rust, TypeScript, SQLite

---

### credential-storage

Secure AES-256-GCM encrypted credential storage backed by the OS keyring (windows-native/apple-native). Credentials are bound to connectors and personas with a ledger tracking every create/update/delete. The negotiator resolves which credential to use for a given connector at runtime.

**Files:**
- `src/api/auth/credentials.ts`
- `src-tauri/src/commands/credentials/credentials.rs`
- `src-tauri/src/commands/credentials/shared.rs`
- `src-tauri/src/commands/credentials/desktop.rs`
- `src-tauri/src/db/models/credential.rs`
- `src-tauri/src/db/models/credential_ledger.rs`
- `src-tauri/src/db/repos/resources/credentials.rs`
- `src-tauri/src/engine/credential_negotiator.rs`
- `src-tauri/src/engine/credential_design.rs`
- `src/api/vault/negotiator.ts`
- `src/api/vault/credentials.ts`

**Entry points:** src-tauri/src/commands/credentials/credentials.rs, src/api/vault/credentials.ts

**Keywords:** credential, AES-256, keyring, ledger, vault, negotiator, secure-storage, encryption

**API surface:** Tauri IPC: store_credential, load_credential, delete_credential, list_credentials

**Tech stack:** Rust, AES-GCM, Keyring, SQLite

---

### external-api-keys

Management of user-supplied LLM provider keys (OpenAI, Anthropic, Groq, etc.) and MCP gateway configurations that proxy tool calls. These are separate from connector credentials — they grant model-level access rather than data-source access. Scoped resources enforce per-persona access control.

**Files:**
- `src/api/auth/externalApiKeys.ts`
- `src-tauri/src/db/models/external_api_key.rs`
- `src-tauri/src/db/repos/resources/external_api_keys.rs`
- `src/api/credentials/mcpGateways.ts`
- `src/api/credentials/scopedResources.ts`
- `src-tauri/src/db/repos/resources/mcp_gateways.rs`
- `src-tauri/src/commands/credentials/vector_kb.rs`

**Entry points:** src/api/auth/externalApiKeys.ts, src-tauri/src/db/models/external_api_key.rs

**Keywords:** API-key, LLM-provider, MCP-gateway, scoped-resource, OpenAI, Anthropic, Groq

**API surface:** Tauri IPC: store_api_key, list_api_keys, delete_api_key, configure_mcp_gateway

**Tech stack:** Rust, TypeScript, SQLite

---

### oauth-management

Handles OAuth 2.0 authorisation flows including code-exchange, token storage, refresh-lock (prevents concurrent refresh races), and token-metric tracking. The gateway API proxies OAuth exchanges so client secrets are never exposed to the frontend; the smee relay forwards GitHub App webhook callbacks.

**Files:**
- `src/api/vault/oauthGatewayApi.ts`
- `src-tauri/src/engine/oauth_refresh_lock.rs`
- `src-tauri/src/db/models/oauth_token_metric.rs`
- `src-tauri/src/db/repos/resources/oauth_token_metrics.rs`
- `src-tauri/src/commands/credentials/auth_detect.rs`
- `src-tauri/src/commands/credentials/ai_artifact_flow.rs`
- `src/api/auth/authDetect.ts`
- `src/api/auth/cliCapture.ts`

**Entry points:** src-tauri/src/engine/oauth_refresh_lock.rs, src/api/vault/oauthGatewayApi.ts

**Keywords:** OAuth, token-refresh, authorization-code, smee, gateway, token-metrics, auth-detect

**API surface:** Tauri IPC: start_oauth_flow, exchange_code, refresh_token; GET /api/oauth/callback (gateway)

**Tech stack:** Rust, Reqwest, TypeScript

---

## Workflow & Orchestration

> **Group type:** —
> **Color:** violet

### composition-workflows

High-level workflow composition that sequences multiple agent executions into a named, versioned pipeline. Composition workflows define input/output contracts between steps, support branching, and store a full run history. The topology graph and heuristic engine optimise execution order.

**Files:**
- `src/api/pipeline/workflows.ts`
- `src/api/pipeline/assignments.ts`
- `src-tauri/src/db/models/composition_workflow.rs`
- `src-tauri/src/commands/core/composition_workflows.rs`
- `src-tauri/src/engine/topology_graph.rs`
- `src-tauri/src/engine/topology_heuristic.rs`
- `src-tauri/src/engine/topology_types.rs`
- `src-tauri/src/engine/optimizer.rs`
- `src-tauri/src/commands/infrastructure/workflows.rs`

**Entry points:** src/api/pipeline/workflows.ts, src-tauri/src/engine/topology_graph.rs

**Keywords:** composition, workflow, topology, branching, pipeline-step, optimizer, DAG

**API surface:** Tauri IPC: create_workflow, run_workflow, get_workflow_topology, optimize_workflow

**Tech stack:** Rust, TypeScript, SQLite

---

### pipeline-canvas

Visual node-graph editor for composing multi-agent workflows using @xyflow/react. Users drag persona nodes onto a canvas, connect them with typed edges, and run dry-run debugger sessions to step through the execution graph. The canvas state machine is managed by a custom reducer with derived state for alignment guides and ghost edges.

**Files:**
- `src/features/pipeline/sub_canvas/index.ts`
- `src/features/pipeline/sub_canvas/CanvasAssistant.tsx`
- `src/features/pipeline/sub_canvas/canvasActions.ts`
- `src/features/pipeline/sub_canvas/useCanvasReducer.ts`
- `src/features/pipeline/sub_canvas/useDerivedCanvasState.ts`
- `src/features/pipeline/sub_canvas/CanvasDragContext.tsx`
- `src/features/pipeline/sub_canvas/PipelineControls.tsx`
- `src/features/pipeline/sub_canvas/TeamToolbar.tsx`
- `src/features/pipeline/sub_canvas/nodes/PersonaNode.tsx`
- `src/features/pipeline/sub_canvas/nodes/StickyNoteNode.tsx`
- `src/features/pipeline/sub_canvas/edges/ConnectionEdge.tsx`
- `src/features/pipeline/sub_canvas/edges/GhostEdge.tsx`
- `src/features/pipeline/sub_canvas/debugger/DryRunDebugger.tsx`
- `src/features/pipeline/sub_canvas/OptimizerPanel.tsx`
- `src/features/pipeline/sub_canvas/teamGraph.ts`

**Entry points:** src/features/pipeline/sub_canvas/index.ts, src/features/pipeline/sub_canvas/useCanvasReducer.ts

**Keywords:** canvas, node-graph, drag-drop, dry-run, debugger, team-workflow, xyflow, pipeline

**API surface:** Internal canvas reducer; calls Tauri IPC: dry_run_pipeline, get_pipeline_topology

**Tech stack:** React, TypeScript, @xyflow/react, @dnd-kit/core

---

### scheduling

Cron-style scheduler that fires agent runs and curation cycles on time-based schedules. Schedules are parsed, stored, and evaluated by a background Tokio task. The curation schedule specifically governs how often the AI companion reviews and consolidates its memory.

**Files:**
- `src/api/pipeline/scheduler.ts`
- `src-tauri/src/db/repos/core/curation_schedule.rs`
- `src-tauri/src/background_job.rs`

**Entry points:** src-tauri/src/background_job.rs, src/api/pipeline/scheduler.ts

**Keywords:** scheduler, cron, curation, background-job, timer, periodic

**API surface:** Tauri IPC: create_schedule, list_schedules, delete_schedule

**Tech stack:** Rust, Tokio, TypeScript

---

### team-orchestration

Manages multi-agent teams where personas are assigned specialised roles (coordinator, reviewer, executor). Team presets encode common configurations (SDLC lifecycle, security review team) and can be adopted wholesale. Assignment tracking links team members to active work items.

**Files:**
- `src/api/pipeline/teams.ts`
- `src/api/templates/teamPresets.ts`
- `src-tauri/src/db/models/team.rs`
- `src-tauri/src/db/models/team_assignment.rs`
- `src-tauri/src/db/models/team_preset.rs`
- `src-tauri/src/db/repos/resources/teams.rs`
- `src-tauri/src/db/repos/orchestration/team_assignments.rs`
- `scripts/templates/_team_presets/sdlc-lifecycle.json`
- `scripts/seed-sdlc-recipes.mjs`

**Entry points:** src/api/pipeline/teams.ts, src-tauri/src/db/models/team.rs

**Keywords:** team, assignment, role, preset, SDLC, coordinator, multi-agent, team-preset

**API surface:** Tauri IPC: create_team, add_team_member, adopt_team_preset, get_team_assignments

**Tech stack:** Rust, TypeScript, SQLite, JSON

---

### trigger-automation

Event-driven trigger system that starts agent runs automatically when conditions are met (webhook received, schedule fired, file changed, shared event emitted). Triggers are stored as serialised condition trees; the engine evaluates them against incoming events and launches the appropriate persona.

**Files:**
- `src/api/pipeline/triggers.ts`
- `src-tauri/src/db/models/trigger.rs`
- `src-tauri/src/db/models/webhook_log.rs`
- `src-tauri/src/db/repos/resources/triggers.rs`
- `src-tauri/src/db/repos/resources/webhook_log.rs`
- `src-tauri/src/engine/automation_runner.rs`
- `src-tauri/src/engine/recipe_matcher.rs`
- `src-tauri/src/engine/recipe_eligibility.rs`
- `src-tauri/src/commands/communication/events.rs`

**Entry points:** src/api/pipeline/triggers.ts, src-tauri/src/engine/automation_runner.rs

**Keywords:** trigger, webhook, event-driven, automation, condition-tree, file-watch, schedule

**API surface:** Tauri IPC: create_trigger, list_triggers, test_trigger; inbound webhooks via smee relay

**Tech stack:** Rust, TypeScript, SQLite

---

## AI Companion (Athena)

> **Group type:** —
> **Color:** pink

### companion-brain

The persistent memory and intelligence layer of the Athena AI companion. Episodic memory stores timestamped interactions, semantic memory indexes facts with vector embeddings, the knowledge graph links entities, and reflection/consolidation cycles distil insights. Goals, decisions, rituals, and backlog items shape proactive behaviour.

**Files:**
- `src-tauri/src/companion/brain/mod.rs`
- `src-tauri/src/companion/brain/identity.rs`
- `src-tauri/src/companion/brain/graph.rs`
- `src-tauri/src/companion/brain/episodic.rs`
- `src-tauri/src/companion/brain/semantic.rs`
- `src-tauri/src/companion/brain/procedural.rs`
- `src-tauri/src/companion/brain/goals.rs`
- `src-tauri/src/companion/brain/backlog.rs`
- `src-tauri/src/companion/brain/consolidation.rs`
- `src-tauri/src/companion/brain/reflection.rs`
- `src-tauri/src/companion/brain/recall_synthesis.rs`
- `src-tauri/src/companion/brain/decisions.rs`
- `src-tauri/src/companion/brain/doctrine.rs`
- `src-tauri/src/companion/brain/dashboard.rs`
- `src-tauri/src/companion/brain/embeddings.rs`

**Entry points:** src-tauri/src/companion/brain/mod.rs, src-tauri/src/companion/brain/identity.rs

**Keywords:** episodic-memory, semantic-memory, knowledge-graph, consolidation, reflection, goals, doctrine, backlog

**API surface:** Internal Rust — exposed via Tauri companion commands

**Tech stack:** Rust, Fastembed, ONNX, SQLite

---

### companion-mcp-orchestration

MCP (Model Context Protocol) bridge within the companion — handles in-flight tool call requests that Athena generates, routes them to the appropriate tool handler, and manages operative memory (short-term task context). Project tracking links companion activity to external project management.

**Files:**
- `src-tauri/src/companion/orchestration/mod.rs`
- `src-tauri/src/companion/orchestration/operative_memory.rs`
- `src-tauri/src/companion/orchestration/mcp/mod.rs`
- `src-tauri/src/companion/orchestration/mcp/pending.rs`
- `src-tauri/src/companion/orchestration/mcp/handlers.rs`
- `src-tauri/src/companion/prompt.rs`
- `src-tauri/src/companion/templates/mod.rs`
- `src-tauri/src/companion/templates/constitution.md`
- `src-tauri/src/companion/session.rs`
- `src-tauri/src/engine/cli_mcp_config.rs`
- `src/api/companion/projectTracking.ts`
- `src-tauri/src/commands/companion/project_tracking.rs`

**Entry points:** src-tauri/src/companion/orchestration/mcp/mod.rs, src-tauri/src/companion/prompt.rs

**Keywords:** MCP, operative-memory, tool-call, project-tracking, constitution, session, prompt-template

**API surface:** Internal companion orchestration; Tauri IPC: get_operative_memory, list_pending_mcp_requests

**Tech stack:** Rust, TypeScript

---

### companion-panel-ui

The primary user interface for interacting with Athena — a panel with chat bubbles, an activity tray showing queued messages and approvals, an orb animation, and inbox adapters for healing/output/message items. The composer accepts slash commands, voice input, and text. Approval flows let Athena request human confirmation before executing risky actions.

**Files:**
- `src/features/plugins/companion/CompanionPanel.tsx`
- `src/features/plugins/companion/ActivityTray.tsx`
- `src/features/plugins/companion/QueuedMessages.tsx`
- `src/features/plugins/companion/TaskTag.tsx`
- `src/features/plugins/companion/ChatThread.tsx`
- `src/features/plugins/companion/Bubble.tsx`
- `src/features/plugins/companion/Composer.tsx`
- `src/features/plugins/companion/SlashPalette.tsx`
- `src/features/plugins/companion/orb/AthenaOrbLayer.tsx`
- `src/features/plugins/companion/inbox/`
- `src/api/companion.ts`
- `src-tauri/src/commands/companion/approvals.rs`
- `src-tauri/src/commands/companion/chat.rs`
- `src-tauri/src/commands/companion/brain.rs`

**Entry points:** src/features/plugins/companion/CompanionPanel.tsx, src-tauri/src/commands/companion/approvals.rs

**Keywords:** companion-panel, chat-bubble, approvals, inbox, orb, slash-command, activity-tray

**API surface:** Tauri IPC: approve_action, reject_action, send_companion_message, get_companion_state

**Tech stack:** React, TypeScript, Framer Motion, Three.js

---

### companion-proactive

Drives Athena's proactive interruptions — scanning fleet activity, connector usage, and build events to identify moments worth surfacing to the user. Budget management throttles how often proactive messages are sent; quiet hours suppress interruptions during focus time.

**Files:**
- `src-tauri/src/companion/proactive/mod.rs`
- `src-tauri/src/companion/proactive/triggers.rs`
- `src-tauri/src/companion/proactive/fleet_triggers.rs`
- `src-tauri/src/companion/proactive/budget.rs`
- `src-tauri/src/companion/proactive/quiet.rs`
- `src-tauri/src/companion/brain/fleet.rs`
- `src-tauri/src/companion/brain/fleet_patterns.rs`
- `src-tauri/src/companion/dispatcher.rs`
- `src-tauri/src/companion/jobs/curation_run.rs`
- `src-tauri/src/companion/jobs/connector_use.rs`

**Entry points:** src-tauri/src/companion/proactive/mod.rs, src-tauri/src/companion/dispatcher.rs

**Keywords:** proactive, interrupt, budget, quiet-hours, fleet-triggers, curation, attention

**API surface:** Fires Tauri events to frontend; no direct IPC command surface

**Tech stack:** Rust, Tokio

---

### companion-voice

Full speech pipeline: STT (Whisper, local model) converts microphone input to text, TTS (ElevenLabs, Piper local) converts responses to audio. Models are downloaded on demand. The frontend exposes hold-to-talk, dictation, and audio-level visualisation hooks.

**Files:**
- `src-tauri/src/companion/stt/mod.rs`
- `src-tauri/src/companion/stt/whisper.rs`
- `src-tauri/src/companion/stt/catalog.rs`
- `src-tauri/src/companion/stt/downloader.rs`
- `src-tauri/src/companion/tts/mod.rs`
- `src-tauri/src/companion/tts/elevenlabs.rs`
- `src-tauri/src/companion/tts/piper.rs`
- `src-tauri/src/companion/tts/catalog.rs`
- `src-tauri/src/companion/tts/downloader.rs`
- `src/features/plugins/companion/useSpeechInput.ts`
- `src/features/plugins/companion/useHoldToTalk.ts`
- `src/features/plugins/companion/useDictation.ts`
- `src/features/plugins/companion/voicePlayback.ts`
- `src/features/plugins/companion/audioLevel.ts`

**Entry points:** src-tauri/src/companion/stt/mod.rs, src-tauri/src/companion/tts/mod.rs

**Keywords:** STT, TTS, Whisper, ElevenLabs, Piper, hold-to-talk, voice, audio

**API surface:** Tauri IPC: start_stt, synthesize_speech, list_tts_voices, download_stt_model

**Tech stack:** Rust, Whisper, ONNX, TypeScript, Web Audio API

---

## Knowledge & Intelligence

> **Group type:** —
> **Color:** indigo

### obsidian-brain

Integration with the user's Obsidian vault, treating it as a structured knowledge graph. Markdown files are parsed, links resolved into a graph, semantic lint checks surface quality issues, and conflicts between notes are detected. Drive integration allows syncing vault content with cloud storage.

**Files:**
- `src/api/obsidianBrain/index.ts`
- `src-tauri/src/db/models/obsidian_brain.rs`
- `src-tauri/src/db/repos/resources/obsidian_brain.rs`
- `src-tauri/src/commands/obsidian_brain/graph.rs`
- `src-tauri/src/commands/obsidian_brain/markdown.rs`
- `src-tauri/src/commands/obsidian_brain/lint.rs`
- `src-tauri/src/commands/obsidian_brain/semantic_lint.rs`
- `src-tauri/src/commands/obsidian_brain/conflict.rs`
- `src-tauri/src/commands/obsidian_brain/drive.rs`
- `src/api/drive.ts`

**Entry points:** src/api/obsidianBrain/index.ts, src-tauri/src/commands/obsidian_brain/graph.rs

**Keywords:** Obsidian, knowledge-graph, markdown, vault, lint, conflict-detection, drive-sync

**API surface:** Tauri IPC: sync_obsidian_vault, get_knowledge_graph, lint_vault, resolve_conflicts

**Tech stack:** Rust, TypeScript, Markdown

---

### research-lab

Dedicated research workspace where the AI companion conducts structured investigations — web searches, document analysis, synthesis — and persists findings as structured research artefacts. The lab separates exploratory research from production agent runs.

**Files:**
- `src/api/researchLab/researchLab.ts`
- `src-tauri/src/db/models/research_lab.rs`
- `src-tauri/src/db/repos/research_lab.rs`

**Entry points:** src/api/researchLab/researchLab.ts, src-tauri/src/db/models/research_lab.rs

**Keywords:** research, lab, investigation, synthesis, web-search, artefact

**API surface:** Tauri IPC: start_research_session, get_research_findings, list_research_sessions

**Tech stack:** Rust, TypeScript, SQLite

---

### smart-search-synthesis

Cross-source intelligent search that queries agents, messages, events, and KB simultaneously using semantic ranking. Team synthesis aggregates outputs from multiple personas into a coherent summary. The smart search feature powers saved views and discovery across the app.

**Files:**
- `src/api/overview/intelligence/smartSearch.ts`
- `src/api/overview/intelligence/teamSynthesis.ts`
- `src/api/overview/intelligence/knowledge.ts`
- `src-tauri/src/commands/design/smart_search.rs`
- `src-tauri/src/db/models/saved_views.rs`
- `src-tauri/src/db/repos/core/saved_views.rs`
- `src-tauri/src/commands/core/saved_views.rs`

**Entry points:** src/api/overview/intelligence/smartSearch.ts, src-tauri/src/commands/design/smart_search.rs

**Keywords:** smart-search, synthesis, saved-views, semantic-ranking, cross-source, discovery

**API surface:** Tauri IPC: smart_search, synthesize_team_output, save_view, list_saved_views

**Tech stack:** Rust, TypeScript, SQLite

---

### team-memory-management

Persistent team-level memory that accumulates shared context across all executions by a team. Individual agent memories feed into a team memory pool; the review proposal system surfaces candidate memories for consolidation. Memory is used by agents to maintain continuity across sessions.

**Files:**
- `src/api/pipeline/teamMemories.ts`
- `src/api/overview/memories.ts`
- `src-tauri/src/db/models/team_memory.rs`
- `src-tauri/src/db/models/memory.rs`
- `src-tauri/src/db/repos/resources/team_memories.rs`
- `src-tauri/src/db/repos/core/memories.rs`
- `src-tauri/src/db/repos/core/memory_review_proposal.rs`

**Entry points:** src/api/pipeline/teamMemories.ts, src-tauri/src/db/models/memory.rs

**Keywords:** team-memory, memory, consolidation, review-proposal, continuity, shared-context

**API surface:** Tauri IPC: store_memory, list_memories, propose_memory_review, consolidate_memory

**Tech stack:** Rust, TypeScript, SQLite

---

### vector-knowledge-base

Feature-gated (ml) vector knowledge base powered by sqlite-vec and fastembed ONNX embeddings. Documents are chunked, embedded, and indexed for semantic similarity search. Agents can query the KB to ground their responses with retrieved context. KB credentials scope per-persona access.

**Files:**
- `src/api/vault/database/vectorKb.ts`
- `src-tauri/src/db/models/knowledge.rs`
- `src-tauri/src/db/models/knowledge_base.rs`
- `src-tauri/src/db/repos/execution/knowledge.rs`
- `src-tauri/src/companion/brain/embeddings.rs`
- `src-tauri/src/engine/kb_index.rs`
- `src-tauri/src/engine/kb_ingest.rs`
- `src-tauri/src/engine/embedder.rs`
- `src-tauri/src/engine/vector_store.rs`
- `src-tauri/src/engine/chunker.rs`
- `src-tauri/src/commands/credentials/vector_kb.rs`

**Entry points:** src-tauri/src/engine/kb_ingest.rs, src/api/vault/database/vectorKb.ts

**Keywords:** vector-search, embeddings, semantic-search, fastembed, ONNX, sqlite-vec, RAG, chunking

**API surface:** Tauri IPC: ingest_document, search_kb, list_knowledge_bases

**Tech stack:** Rust, Fastembed, ONNX Runtime, sqlite-vec

---

## Template & Recipe Factory

> **Group type:** —
> **Color:** orange

### design-conversations

AI-assisted design conversation flow where users describe what they want an agent to do and the system generates a structured persona configuration through multi-turn dialogue. Design context management tracks the evolving specification; analysis tools evaluate the proposed design.

**Files:**
- `src/api/design/design.ts`
- `src-tauri/src/commands/design/conversations.rs`
- `src-tauri/src/commands/design/analysis.rs`
- `src-tauri/src/commands/design/skills.rs`
- `src-tauri/src/commands/design/platform_definitions.rs`
- `src-tauri/src/db/models/design_conversation.rs`
- `src-tauri/src/db/repos/core/design_conversations.rs`
- `src-tauri/src/engine/design_context.rs`
- `src-tauri/src/engine/context_rules.rs`

**Entry points:** src/api/design/design.ts, src-tauri/src/commands/design/conversations.rs

**Keywords:** design-conversation, guided-setup, persona-generation, context-rules, platform-definitions, analysis

**API surface:** Tauri IPC: start_design_conversation, advance_design, analyse_design, export_design

**Tech stack:** Rust, TypeScript, SQLite

---

### n8n-integration

Import bridge that converts n8n workflow JSON into Personas pipeline format, allowing users to migrate existing automations. N8N sessions track active import processes; the confirmation step resolves ambiguous node mappings. Limits enforcement caps the complexity of imported workflows.

**Files:**
- `src/api/templates/n8nTransform.ts`
- `src-tauri/src/commands/design/n8n_transform/confirmation.rs`
- `src-tauri/src/commands/design/n8n_sessions.rs`
- `src-tauri/src/commands/design/n8n_limits.rs`
- `src-tauri/src/db/models/n8n_session.rs`
- `src-tauri/src/db/repos/resources/n8n_sessions.rs`

**Entry points:** src/api/templates/n8nTransform.ts, src-tauri/src/commands/design/n8n_transform/confirmation.rs

**Keywords:** n8n, import, transform, workflow-migration, confirmation, limits

**API surface:** Tauri IPC: transform_n8n_workflow, confirm_n8n_mapping, get_n8n_session

**Tech stack:** Rust, TypeScript, JSON

---

### recipe-management

Automation recipes encode repeatable multi-step agent workflows that can be suggested, versioned, and executed. The recipe matcher identifies applicable recipes for the current context; eligibility rules gate which personas can run which recipes. Suggestion logs capture AI-generated recipe proposals.

**Files:**
- `src/api/recipes/recipes.ts`
- `src-tauri/src/commands/recipes/recipe_execution.rs`
- `src-tauri/src/commands/recipes/recipe_generation.rs`
- `src-tauri/src/commands/recipes/recipe_versioning.rs`
- `src-tauri/src/commands/recipes/recipe_match.rs`
- `src-tauri/src/commands/recipes/recipe_derivation.rs`
- `src-tauri/src/commands/recipes/recipe_eligibility.rs`
- `src-tauri/src/commands/recipes/recipe_suggestion_log.rs`
- `src-tauri/src/db/repos/resources/recipes.rs`
- `src-tauri/src/db/repos/resources/recipe_suggestions.rs`
- `src-tauri/src/engine/recipe_matcher.rs`
- `src-tauri/src/engine/recipe_eligibility.rs`
- `src-tauri/src/engine/recipe_seed.rs`

**Entry points:** src/api/recipes/recipes.ts, src-tauri/src/engine/recipe_matcher.rs

**Keywords:** recipe, suggestion, versioning, eligibility, matcher, derivation, execution

**API surface:** Tauri IPC: run_recipe, create_recipe, match_recipes, list_recipe_suggestions

**Tech stack:** Rust, TypeScript, SQLite

---

### template-catalog

Library of pre-built persona templates (code-reviewer, solution-architect, docs-steward, security-sentinel, release-manager, etc.) stored as JSON with SHA-256 checksums to detect tampering. Template adoption walks users through a guided setup, binding connectors and credentials. The add-template skill codifies how to contribute new templates.

**Files:**
- `src/api/templates/templateAdopt.ts`
- `src/api/templates/templateFeedback.ts`
- `src-tauri/src/commands/design/template_adopt.rs`
- `src-tauri/src/engine/template_checksums.rs`
- `src-tauri/src/db/models/template_feedback.rs`
- `src-tauri/src/db/repos/communication/template_feedback.rs`
- `scripts/templates/development/code-reviewer.json`
- `scripts/templates/development/docs-steward.json`
- `scripts/templates/development/solution-architect.json`
- `scripts/templates/devops/release-manager.json`
- `scripts/templates/security/security-sentinel.json`
- `scripts/generate-templates.mjs`
- `scripts/generate-template-checksums.mjs`
- `scripts/templates/_recipe_seeds.json`

**Entry points:** src-tauri/src/commands/design/template_adopt.rs, src/api/templates/templateAdopt.ts

**Keywords:** template, adoption, checksum, code-reviewer, solution-architect, preset, guided-setup

**API surface:** Tauri IPC: adopt_template, list_templates, get_template_checksum, submit_template_feedback

**Tech stack:** Rust, JSON, TypeScript

---

### twin-digital

Digital twin capability that creates a mirror model of an agent's behaviour over time, enabling simulation of how it would respond to novel situations without live execution. The twin is trained from execution history and can be queried for predicted outcomes.

**Files:**
- `src/api/twin/twin.ts`
- `src-tauri/src/db/models/twin.rs`
- `src-tauri/src/db/repos/twin.rs`

**Entry points:** src/api/twin/twin.ts, src-tauri/src/db/models/twin.rs

**Keywords:** digital-twin, simulation, prediction, mirror-model, behaviour-replay

**API surface:** Tauri IPC: create_twin, query_twin, update_twin, get_twin_state

**Tech stack:** Rust, TypeScript, SQLite

---

## Platform Infrastructure

> **Group type:** —
> **Color:** red

### cloud-settings

Cloud execution client, deployment history, tier management (starter/team/builder gates), app settings persistence, and management API authentication. Tier enforcement runs at command dispatch time and gates feature access. Settings are persisted in SQLite with an audit log for changed keys.

**Files:**
- `src/api/system/cloud.ts`
- `src/api/system/settings.ts`
- `src/api/system/tierUsage.ts`
- `src/api/system/managementApiAuth.ts`
- `src/api/system/byom.ts`
- `src/api/system/dataPortability.ts`
- `src-tauri/src/cloud/mod.rs`
- `src-tauri/src/cloud/client.rs`
- `src-tauri/src/cloud/config.rs`
- `src-tauri/src/cloud/runner.rs`
- `src-tauri/src/engine/tier.rs`
- `src-tauri/src/engine/tier_usage.rs`
- `src-tauri/src/db/settings_keys.rs`
- `src-tauri/src/db/repos/core/settings.rs`
- `src-tauri/src/db/repos/resources/deployment_history.rs`
- `src-tauri/src/db/repos/resources/settings_audit_log.rs`

**Entry points:** src-tauri/src/cloud/mod.rs, src-tauri/src/engine/tier.rs

**Keywords:** cloud, tier, settings, deployment, BYOM, data-portability, management-API, audit-log

**API surface:** Tauri IPC: get_settings, update_settings, check_tier, deploy_to_cloud

**Tech stack:** Rust, TypeScript, SQLite, Reqwest

---

### database-foundation

SQLite database layer providing connection pooling (r2d2), a migration runner, change data capture, and query builder utilities. The persona.db and persona_data.db files are kept separate for isolation. All domain repositories are organised under db/repos/ by subdomain and depend on this foundation.

**Files:**
- `src-tauri/src/db/mod.rs`
- `src-tauri/src/db/perf.rs`
- `src-tauri/src/db/query_builder.rs`
- `src-tauri/src/db/settings_keys.rs`
- `src-tauri/src/db/cdc.rs`
- `src-tauri/src/db/builtin_connectors.rs`

**Entry points:** src-tauri/src/db/mod.rs

**Keywords:** SQLite, r2d2, connection-pool, migration, CDC, repository-pattern, schema

**API surface:** Internal Rust — DbPool passed as AppState to all Tauri commands

**Tech stack:** Rust, rusqlite, r2d2, SQLite

---

### event-messaging

Cross-cutting event and notification infrastructure: shared events broadcast state changes across modules (and to listening CLI agents), notification subscriptions deliver user-visible alerts, and webhook logs capture inbound/outbound webhook traffic. The smee relay forwards GitHub App events to the local server.

**Files:**
- `src/api/events/sharedEvents.ts`
- `src/api/events/notificationSubscriptions.ts`
- `src-tauri/src/db/models/shared_event.rs`
- `src-tauri/src/db/models/event.rs`
- `src-tauri/src/db/models/notification_subscription.rs`
- `src-tauri/src/db/models/smee_relay.rs`
- `src-tauri/src/db/models/webhook_log.rs`
- `src-tauri/src/db/repos/communication/shared_events.rs`
- `src-tauri/src/db/repos/resources/notification_subscriptions.rs`
- `src-tauri/src/db/repos/resources/webhook_log.rs`
- `src-tauri/src/db/repos/communication/smee_relays.rs`
- `src-tauri/src/engine/shared_event_relay.rs`
- `src-tauri/src/commands/communication/shared_events.rs`
- `src-tauri/src/commands/communication/notifications.rs`
- `src-tauri/src/notifications.rs`

**Entry points:** src-tauri/src/engine/shared_event_relay.rs, src/api/events/sharedEvents.ts

**Keywords:** shared-event, notification, webhook, smee-relay, broadcast, subscription, CDC

**API surface:** Tauri IPC: subscribe_to_events, list_notifications, get_webhook_log; inbound: smee relay

**Tech stack:** Rust, TypeScript, Tauri Events

---

### mcp-server

Model Context Protocol server that exposes Personas personas as MCP tools to external Claude sessions and Claude Code. The server binary (`mcp_bin.rs`) runs as a sidecar, reads the SQLite DB directly, and serves tool definitions. The tools.rs file maps Personas commands to MCP tool schemas.

**Files:**
- `src-tauri/src/mcp_bin.rs`
- `src-tauri/src/mcp_server/tools.rs`
- `src-tauri/src/engine/cli_mcp_config.rs`
- `src/api/skills/mcpTools.ts`
- `src/api/skills/skills.ts`
- `src-tauri/src/db/models/skill.rs`
- `src-tauri/src/db/repos/resources/skills.rs`
- `scripts/mcp-server/test-live.mjs`
- `scripts/mcp-server/test-tools.mjs`

**Entry points:** src-tauri/src/mcp_bin.rs, src-tauri/src/mcp_server/tools.rs

**Keywords:** MCP, tool-schema, sidecar, Claude-Code, skill, protocol, JSON-RPC

**API surface:** MCP stdio protocol: list_tools, call_tool (persona execution, settings read)

**Tech stack:** Rust, TypeScript, MCP protocol, JSON-RPC

---

### media-signing

Media processing pipeline (FFmpeg, Whisper transcription, OCR via xcap screen capture) for the Artist plugin, plus digital signing and identity verification for distributing artefacts. OCR converts screenshots to text for agent processing; signing creates tamper-evident hashes of exported personas.

**Files:**
- `src/api/artist/index.ts`
- `src/api/ocr/index.ts`
- `src/api/signing/index.ts`
- `src-tauri/src/commands/artist/ffmpeg.rs`
- `src-tauri/src/commands/artist/transcribe.rs`
- `src-tauri/src/commands/artist/persistence.rs`
- `src-tauri/src/commands/artist/schema_policy.rs`
- `src-tauri/src/commands/signing/mod.rs`
- `src-tauri/src/db/models/ocr.rs`
- `src-tauri/src/db/models/signing.rs`
- `src-tauri/src/db/repos/resources/ocr.rs`
- `src-tauri/src/db/repos/resources/signing.rs`

**Entry points:** src-tauri/src/commands/artist/ffmpeg.rs, src/api/artist/index.ts

**Keywords:** FFmpeg, transcription, OCR, screen-capture, signing, artefact, media-processing

**API surface:** Tauri IPC: run_ffmpeg, transcribe_audio, run_ocr, sign_artefact, verify_signature

**Tech stack:** Rust, FFmpeg, Whisper, xcap, TypeScript

---

### p2p-networking

Feature-gated (p2p) LAN discovery and communication layer using mDNS-SD for peer discovery, QUIC transport for data, and Ed25519 identity keys for authentication. Devices can expose themselves to peers, bundle artefacts for transfer, and participate in a private enclave. Owned device registry tracks known peers.

**Files:**
- `src/api/network/enclave.ts`
- `src/api/network/discovery.ts`
- `src/api/network/identity.ts`
- `src/api/network/exposure.ts`
- `src/api/network/bundle.ts`
- `src-tauri/src/db/models/owned_device.rs`
- `src-tauri/src/db/models/identity.rs`
- `src-tauri/src/db/repos/resources/owned_devices.rs`
- `src-tauri/src/db/repos/resources/exposure.rs`
- `src-tauri/src/db/repos/resources/identity.rs`
- `src-tauri/src/engine/enclave.rs`
- `src-tauri/src/engine/discovery.rs`
- `src-tauri/src/commands/network/discovery.rs`
- `src-tauri/src/commands/network/exposure.rs`
- `src-tauri/src/commands/network/identity.rs`

**Entry points:** src-tauri/src/engine/discovery.rs, src/api/network/discovery.ts

**Keywords:** P2P, mDNS, QUIC, LAN-discovery, enclave, Ed25519, owned-device, exposure

**API surface:** Tauri IPC: start_discovery, expose_device, get_owned_devices, create_bundle

**Tech stack:** Rust, Quinn, mdns-sd, Ed25519, TypeScript

---

---

<!--
  Hand-curated overrides appended to .claude/codebase-context.md by the
  /refresh-context skill (see .claude/skills/refresh-context/skill.md
  Phase 3.5).

  This file is the source of truth for context groups that must survive
  DB regeneration but are not yet (or never will be) populated by the
  Personas app's "Scan Codebase" feature.

  How to extend:
    - Add new groups as `## Group Name` sections below.
    - Each group's sub-contexts use `### context-id` headers and follow the
      same shape as DB-rendered contexts (Files, Entry points, Keywords,
      Tech stack).
    - The whole content of this file is appended verbatim to the rendered
      codebase-context.md, before the snapshot-meta footer.

  How to retire:
    - When a hand-curated group becomes obsolete (e.g. the Personas app
      finally scans shared/ and writes real rows into dev_contexts), delete
      the corresponding section here and run /refresh-context.
-->

## Shared UI Primitives

> **Group type:** —
> **Color:** slate
>
> ✳ **Hand-curated section.** Source: `.claude/codebase-context-overrides.md`. Appended to this file by `/refresh-context` after DB-derived groups. Edit the override file (not this one) to update — direct edits here will be wiped on next refresh. See ADR `2026-05-01-durable-shared-ui-context`.

### shared-buttons-display

The primitive layer of buttons, badges, icons, and display components shared across all features. `Button` is the canonical clickable primitive (variants: primary/secondary/ghost/danger/accent/link; sizes xs–lg + icon variants). Display includes `Badge`, `StatusBadge`, `Tooltip`, `TruncateWithTooltip`, `PersonaIcon`, `PersonaAvatar`, `EmptyIllustration`, `CategoryChip`, `ConnectorMeta`, `RelativeTime`, `UuidLabel`, `Collapse`, `AnimatedCounter`. Tables: `DataGrid`, `UnifiedTable`. Top-level barrel `@/features/shared` re-exports the most-used.

**Files:**
- `src/features/shared/components/buttons/Button.tsx`
- `src/features/shared/components/buttons/CopyButton.tsx`
- `src/features/shared/components/display/Badge.tsx`
- `src/features/shared/components/display/StatusBadge.tsx`
- `src/features/shared/components/display/Tooltip.tsx`
- `src/features/shared/components/display/PersonaIcon.tsx`
- `src/features/shared/components/display/EmptyIllustration.tsx`
- `src/features/shared/components/display/DataGrid.tsx`
- `src/features/shared/components/display/UnifiedTable.tsx`
- `src/features/shared/components/display/ConnectorMeta.tsx`
- `src/features/shared/components/display/RelativeTime.tsx`
- `src/features/shared/components/display/index.ts` (barrel)
- `src/features/shared/components/buttons/index.ts` (barrel)
- `src/features/shared/index.ts` (top-level barrel)

**Entry points:** src/features/shared/index.ts, src/features/shared/components/buttons/Button.tsx

**Keywords:** button, badge, tooltip, icon, avatar, primitive, shared, ui, display, datagrid, table, status badge

**Tech stack:** React, TypeScript, Tailwind CSS 4

---

### shared-modals-overlays

Canonical modal and overlay layer. `BaseModal` (focus trap + ESC + backdrop dismiss + portal stacking-context escape) is non-negotiable for all dialogs — ESLint `enforce-base-modal` flags raw `role="dialog"` without it. Lives in `@/lib/ui/BaseModal` and is re-exported from `@/features/shared/components/modals` for discoverability. Overlays surface higher-level patterns: `CommandPalette` (global ⌘K), `ConfirmDestructiveModal` + `useConfirmDestructive` (destructive-action confirmation), `UnsavedChangesModal`, `FirstUseConsentModal`, `FilterBar`, `QuickEditPanel`.

**Files:**
- `src/lib/ui/BaseModal.tsx`
- `src/features/shared/components/modals/index.ts`
- `src/features/shared/components/modals/ExecutionDetailModal/ExecutionDetailModal.tsx`
- `src/features/shared/components/overlays/CommandPalette.tsx`
- `src/features/shared/components/overlays/ConfirmDestructiveModal.tsx`
- `src/features/shared/components/overlays/UnsavedChangesModal.tsx`
- `src/features/shared/components/overlays/FirstUseConsentModal.tsx`
- `src/features/shared/components/overlays/FilterBar.tsx`
- `src/features/shared/components/overlays/QuickEditPanel.tsx`
- `src/features/shared/components/overlays/commandPaletteUtils.ts`
- `src/features/shared/components/overlays/index.ts` (barrel)
- `eslint-rules/enforce-base-modal.cjs`

**Entry points:** src/lib/ui/BaseModal.tsx, src/features/shared/components/overlays/CommandPalette.tsx

**Keywords:** modal, dialog, overlay, command palette, base modal, focus trap, confirm, unsaved changes, consent

**Tech stack:** React, TypeScript

---

### shared-feedback

User-feedback primitives: loading, error, empty, toast, banner, error boundary. `LoadingSpinner` is the default loading indicator (171 callers). `ToastContainer` is the singleton toast surface mounted at app root. `EmptyState` (default export) and `EmptyIllustration` cover empty-state shapes. Error surfaces: `ErrorBanner`, `InlineErrorBanner`, `ErrorRecoveryBanner`, `InlineErrorRecovery`, `ErrorBoundary`. `AriaLiveProvider` + `useAnnounce` provide accessible live-region announcements. `ConnectionStatusBadge`, `StalenessIndicator`, `UpdateBanner` cover system-state surfaces.

**Files:**
- `src/features/shared/components/feedback/LoadingSpinner.tsx`
- `src/features/shared/components/feedback/SuspenseFallback.tsx`
- `src/features/shared/components/feedback/ToastContainer.tsx`
- `src/features/shared/components/feedback/EmptyState.tsx`
- `src/features/shared/components/feedback/ErrorBanner.tsx`
- `src/features/shared/components/feedback/InlineErrorBanner.tsx`
- `src/features/shared/components/feedback/ErrorRecoveryBanner.tsx`
- `src/features/shared/components/feedback/ErrorBoundary.tsx`
- `src/features/shared/components/feedback/AriaLiveProvider.tsx`
- `src/features/shared/components/feedback/ConnectionStatusBadge.tsx`
- `src/features/shared/components/feedback/StalenessIndicator.tsx`
- `src/features/shared/components/feedback/UpdateBanner.tsx`
- `src/features/shared/components/feedback/index.ts` (barrel)

**Entry points:** src/features/shared/components/feedback/LoadingSpinner.tsx, src/features/shared/components/feedback/ToastContainer.tsx

**Keywords:** loading, spinner, toast, error banner, empty state, error boundary, suspense, aria live, announce, healing toast, recovery

**Tech stack:** React, TypeScript

---

### shared-forms

Form primitives shared across feature modules: `FormField` (label + error wrapper), `ThemedSelect` (filterable, icon-aware), `AccessibleToggle`, `Listbox`, `PillGroup`, `KeyValueEditor`, icon/color pickers (`IconSelector`, `PopupIconSelector`, `ColorPicker`, `PopupColorPicker`), `PersonaSelector` + modal variant, `DirectoryPickerInput` (Tauri filesystem dialog), `SourceDefinitionInput` (multi-source picker for local/codebase/database). Hooks: `useFieldValidation`, `useShakeError`. ~85 import sites across the app.

**Files:**
- `src/features/shared/components/forms/FormField.tsx`
- `src/features/shared/components/forms/ThemedSelect.tsx`
- `src/features/shared/components/forms/AccessibleToggle.tsx`
- `src/features/shared/components/forms/Listbox.tsx`
- `src/features/shared/components/forms/PillGroup.tsx`
- `src/features/shared/components/forms/KeyValueEditor.tsx`
- `src/features/shared/components/forms/IconSelector.tsx`
- `src/features/shared/components/forms/ColorPicker.tsx`
- `src/features/shared/components/forms/PersonaSelector.tsx`
- `src/features/shared/components/forms/DirectoryPickerInput.tsx`
- `src/features/shared/components/forms/SourceDefinitionInput.tsx`
- `src/features/shared/components/forms/useFieldValidation.ts`
- `src/features/shared/components/forms/useShakeError.ts`
- `src/features/shared/components/forms/index.ts` (barrel)

**Entry points:** src/features/shared/components/forms/FormField.tsx, src/features/shared/components/forms/ThemedSelect.tsx

**Keywords:** form, input, select, toggle, listbox, pill, key value, icon picker, color picker, persona selector, directory picker, source definition, validation, shake

**Tech stack:** React, TypeScript

---

### shared-layout

Page-level layout shells, section primitives, sidebar, footer, theme provider. `ContentLayout` (`ContentBox` + `ContentHeader` + `ContentBody`) is the canonical content shell with scroll-aware shadow and icon-color palette. `SectionCard`, `SectionHeader`, `SectionHeading` group content. `SegmentedTabs`, `PanelTabBar` for tabbed UIs. `TitleBar` + `BreadcrumbTrail` + `DesktopFooter` for chrome. `Sidebar` orchestrates nav (with `SidebarLevel1`/`Level2`, custom `SidebarIcons`, section adapters). `VibeThemeProvider`, `BackgroundServices` for app-level providers. `DeferUntilIdle` defers heavy children until idle.

**Files:**
- `src/features/shared/components/layout/ContentLayout.tsx`
- `src/features/shared/components/layout/SectionCard.tsx`
- `src/features/shared/components/layout/SectionHeader.tsx`
- `src/features/shared/components/layout/SectionHeading.tsx`
- `src/features/shared/components/layout/SegmentedTabs.tsx`
- `src/features/shared/components/layout/PanelTabBar.tsx`
- `src/features/shared/components/layout/TitleBar.tsx`
- `src/features/shared/components/layout/BreadcrumbTrail.tsx`
- `src/features/shared/components/layout/DesktopFooter.tsx`
- `src/features/shared/components/layout/VibeThemeProvider.tsx`
- `src/features/shared/components/layout/DeferUntilIdle.tsx`
- `src/features/shared/components/layout/sidebar/Sidebar.tsx`
- `src/features/shared/components/layout/sidebar/SidebarLevel1.tsx`
- `src/features/shared/components/layout/sidebar/SidebarLevel2.tsx`
- `src/features/shared/components/layout/sidebar/SidebarIcons.tsx`
- `src/features/shared/components/layout/sidebar/sidebarData.ts`
- `src/features/shared/components/layout/index.ts` (barrel)

**Entry points:** src/features/shared/components/layout/ContentLayout.tsx, src/features/shared/components/layout/sidebar/Sidebar.tsx

**Keywords:** layout, sidebar, footer, title bar, content shell, section, segmented tabs, breadcrumb, theme provider, defer until idle

**Tech stack:** React, TypeScript

---

### shared-progress-terminal

Progress, terminal, and use-case primitives. Progress: `WizardStepper`, `EstimatedProgressBar`, `ContentLoader` (skeleton), `TransformProgress`/`TransformModeView`/`TransformStatusPanels`, `AnalysisModeView`, `ConfigureStep`, plus phase-detection helpers (`detectTransformPhase`, `detectAnalysisPhase`). Terminal: `TerminalBody` (ANSI-aware), `TerminalHeader`, `TerminalSearchBar` + `useTerminalFilter`, `TerminalStrip`, `CliOutputPanel`. Use-cases: `UseCasesList`, `UseCaseRow`, `UseCaseHistory`, `UseCaseExecutionPanel`, `MockModePanel`, `useUseCaseExecution`. Editors: `JsonEditor`, `MarkdownRenderer`, draft-editor sub-system.

**Files:**
- `src/features/shared/components/progress/WizardStepper.tsx`
- `src/features/shared/components/progress/EstimatedProgressBar.tsx`
- `src/features/shared/components/progress/ContentLoader.tsx`
- `src/features/shared/components/progress/TransformProgress.tsx`
- `src/features/shared/components/progress/AnalysisModeView.tsx`
- `src/features/shared/components/progress/phaseDetection.ts`
- `src/features/shared/components/terminal/TerminalBody.tsx`
- `src/features/shared/components/terminal/TerminalHeader.tsx`
- `src/features/shared/components/terminal/TerminalSearchBar.tsx`
- `src/features/shared/components/terminal/CliOutputPanel.tsx`
- `src/features/shared/components/use-cases/UseCasesList.tsx`
- `src/features/shared/components/use-cases/UseCaseRow.tsx`
- `src/features/shared/components/use-cases/useUseCaseExecution.ts`
- `src/features/shared/components/editors/MarkdownRenderer.tsx`
- `src/features/shared/components/editors/JsonEditor.tsx`
- `src/features/shared/components/editors/draft-editor/index.ts`
- `src/features/shared/components/progress/index.ts` (barrel)
- `src/features/shared/components/terminal/index.ts` (barrel)
- `src/features/shared/components/use-cases/index.ts` (barrel)

**Entry points:** src/features/shared/components/terminal/TerminalBody.tsx, src/features/shared/components/use-cases/UseCasesList.tsx

**Keywords:** progress, wizard, stepper, transform, terminal, ansi, cli output, use case, markdown, json editor, draft editor, content loader

**Tech stack:** React, TypeScript

---

### shared-glyph-domain

Persona capability-dimension visualization kit (domain-specific, not a generic primitive). Tightly scoped to the 8-dimension model: trigger, task, connector, message, review, memory, event, error. Components render persona capabilities as glyphs with sigils, totems, dimension panels, and content auras. `GlyphCard` is the headline composition. `dimMeta` is the typed metadata registry (icon, color, labelKey, optional custom SVG art per dimension). `cron.ts` includes a cron humanizer used by trigger-displaying surfaces.

**Files:**
- `src/features/shared/glyph/GlyphCard.tsx`
- `src/features/shared/glyph/GlyphGrid.tsx`
- `src/features/shared/glyph/InteractiveSigil.tsx`
- `src/features/shared/glyph/SigilPetal.tsx`
- `src/features/shared/glyph/ChannelTotem.tsx`
- `src/features/shared/glyph/ConnectorTotem.tsx`
- `src/features/shared/glyph/DimensionPanel.tsx`
- `src/features/shared/glyph/GlyphQuestionPanel.tsx`
- `src/features/shared/glyph/types.ts`
- `src/features/shared/glyph/dimMeta.ts`
- `src/features/shared/glyph/dimContent.tsx`
- `src/features/shared/glyph/dimArt/DimAuras.tsx`
- `src/features/shared/glyph/channels.ts`
- `src/features/shared/glyph/triggers.ts`
- `src/features/shared/glyph/cron.ts`
- `src/features/shared/glyph/index.ts` (barrel)

**Entry points:** src/features/shared/glyph/GlyphCard.tsx, src/features/shared/glyph/dimMeta.ts

**Keywords:** glyph, sigil, dimension, capability, persona visual, totem, aura, cron humanizer

**Tech stack:** React, TypeScript

---


---

<!-- snapshot-meta
git_head: 91da41a0805f9e4c20b7d133efba91382ad02035
git_commit_count: 3640
generated_at: 2026-06-05T11:38:12.625Z
-->
