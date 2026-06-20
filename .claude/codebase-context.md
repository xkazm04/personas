# Codebase Context Snapshot — personas

> Generated: 2026-06-20T08:03:57.785Z
> Source: dev_contexts table for project_id=b0c1541f-af08-4912-818e-19ca94f7b6e9
> Total groups: 9, Total contexts: 49
> Git HEAD at generation: 76b820539 (feat(studio): wire checklist to Athena's real build plan (P3 FE))
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

## Agent Platform

> **Group type:** —
> **Color:** violet

### agent-connectors

Manages the connections between personas and external services (MCP tools, APIs, database connectors). Handles connector discovery, credential binding, readiness validation, and the three-class connector model (builtin-local, builtin-remote, custom).

**Files:**
- `src/features/agents/sub_connectors/ConnectorsTab.tsx`
- `src/features/agents/sub_connectors/components/ConnectorCard.tsx`
- `src/features/agents/sub_connectors/hooks/useConnectorReadiness.ts`
- `src/api/agents/mcpTools.ts`
- `src/api/auth/connectors.ts`
- `src-tauri/src/commands/companion/connector.rs`
- `src-tauri/src/engine/connector_readiness.rs`
- `src-tauri/src/db/models/connector.rs`

**Entry points:** src/features/agents/sub_connectors/ConnectorsTab.tsx, src-tauri/src/engine/connector_readiness.rs

**Keywords:** connector, mcp, binding, credential, readiness, integration, tool, api-connection

**API surface:** invoke('get_connectors'), invoke('bind_credential'), invoke('check_connector_readiness')

**Tech stack:** React, TypeScript, Rust

---

### agent-design-wizard

Conversational design wizard that guides users through building a persona via structured phases (analyzing, refining, preview, applying). Uses LLM-driven suggestions and a wizard compiler to generate persona configurations from natural-language answers.

**Files:**
- `src/features/agents/sub_design/DesignTab.tsx`
- `src/features/agents/sub_design/DesignQuestionPanel.tsx`
- `src/features/agents/sub_design/DesignTabHelpers.ts`
- `src/features/agents/sub_design/components/DesignTabPhaseContent.tsx`
- `src/features/agents/sub_design/components/DesignConversationHistory.tsx`
- `src/features/agents/sub_design/components/PairItem.tsx`
- `src/features/agents/sub_design/phases/DesignPhaseAnalyzing.tsx`
- `src/features/agents/sub_design/phases/DesignPhaseApplied.tsx`
- `src/features/agents/sub_design/phases/DesignPhaseApplying.tsx`
- `src/features/agents/sub_design/phases/DesignPhaseError.tsx`
- `src/features/agents/sub_design/phases/DesignPhasePreview.tsx`
- `src/features/agents/sub_design/phases/DesignPhaseRefining.tsx`
- `src/features/agents/sub_design/wizard/wizardCompiler.ts`
- `src-tauri/src/commands/design/conversation.rs`

**Entry points:** src/features/agents/sub_design/DesignTab.tsx, src/features/agents/sub_design/wizard/wizardCompiler.ts

**Keywords:** wizard, design, phase, analyzing, refining, preview, applying, conversation, llm-driven

**API surface:** invoke('start_design_conversation'), invoke('apply_design_draft')

**Tech stack:** React, TypeScript, Rust

---

### agent-editor

Multi-tab editor for configuring an agent persona — identity, system prompt, model selection, connectors, use cases, and output assertions. Orchestrates the sub-design wizard and tab routing for the full persona authoring experience.

**Files:**
- `src/features/agents/sub_editor/components/EditorTabContent.tsx`
- `src/features/agents/sub_editor/components/PersonaEditor.tsx`
- `src/features/agents/sub_editor/components/EditorBanners.tsx`
- `src/features/agents/sub_editor/components/QuickStatsBar.tsx`
- `src/features/agents/sub_editor/hooks/usePersonaSwitchGuard.ts`
- `src/features/agents/sub_editor/libs/useEffectivePersona.ts`
- `src/features/agents/sub_editor/libs/useTabSection.ts`
- `src/features/agents/sub_model_config/ModelConfigTab.tsx`
- `src/features/agents/sub_settings/AgentSettingsTab.tsx`
- `src/features/agents/sub_use_cases/UseCasesTab.tsx`

**Entry points:** src/features/agents/sub_editor/components/PersonaEditor.tsx

**Keywords:** editor, system-prompt, model, use-case, tab, persona-config, identity, output-assertion

**API surface:** invoke('update_persona'), invoke('get_persona_use_cases')

**Tech stack:** React, TypeScript, Zustand

---

### agent-lab

Experimental sandbox for testing and evolving personas. Provides version-aware model-versus-model arena comparisons, rating tables, activation/rollback controls, and headless evolution via Improve/Breed/Evolve flows that delegate to the companion.

**Files:**
- `src/features/agents/sub_lab/LabTab.tsx`
- `src/features/agents/sub_lab/components/LabVersionRatingTable.tsx`
- `src/features/agents/sub_lab/components/LabArenaView.tsx`
- `src/features/agents/sub_lab/hooks/useLabVersions.ts`
- `src/api/agents/evolution.ts`
- `src/api/agents/tests.ts`
- `src/api/agents/testSuites.ts`
- `src/api/agents/outputAssertions.ts`
- `src-tauri/src/commands/core/lab.rs`
- `src-tauri/src/db/models/evolution.rs`
- `src-tauri/src/db/models/test_run.rs`

**Entry points:** src/features/agents/sub_lab/LabTab.tsx, src/api/agents/evolution.ts

**Keywords:** lab, arena, evolution, version, rating, test, activate, rollback, breed, improve

**API surface:** invoke('get_lab_versions'), invoke('activate_evolution'), invoke('run_lab_test')

**Tech stack:** React, TypeScript, Rust

---

### persona-management

Core CRUD and lifecycle management for AI personas (agents). Handles creation, editing, deletion, duplication, and the grid/list views that surface all personas to the user. Persona records are the central entity — everything else in the app attaches to them.

**Files:**
- `src/features/agents/components/allPersonas/CompletenessRing.tsx`
- `src/features/agents/components/allPersonas/PersonaHealthIndicator.tsx`
- `src/features/agents/components/allPersonas/PersonaOverviewEmptyState.tsx`
- `src/features/agents/components/allPersonas/PersonaOverviewFilterHeader.tsx`
- `src/features/personas/PersonasPage.tsx`
- `src/features/personas/PersonasGrid.tsx`
- `src/features/personas/PersonaCard.tsx`
- `src/api/agents/genome.ts`
- `src-tauri/src/commands/core/personas.rs`
- `src-tauri/src/db/models/persona.rs`
- `src-tauri/src/db/repos/personas.rs`

**Entry points:** src/features/personas/PersonasPage.tsx, src-tauri/src/commands/core/personas.rs

**Keywords:** persona, agent, crud, grid, list, create, delete, duplicate, health, completeness

**API surface:** invoke('get_personas'), invoke('create_persona'), invoke('delete_persona'), invoke('duplicate_persona')

**Tech stack:** React, TypeScript, Rust, SQLite

---

### template-system

Template library for bootstrapping new personas from pre-built seeds. Covers template discovery, adoption flow (structured setup_detail, typed blockers), mid-build suggestions, tier gating, and the Glyph build-session template suggestion system.

**Files:**
- `src/features/templates/TemplatesPage.tsx`
- `src/features/templates/TemplateCard.tsx`
- `src/features/templates/AdoptionModal.tsx`
- `src/features/templates/hooks/useTemplateAdoption.ts`
- `src-tauri/src/commands/design/templates.rs`
- `src-tauri/src/db/models/template.rs`
- `src-tauri/src/engine/build_session/adopter.rs`
- `src-tauri/src/engine/build_session/build_phase.rs`
- `src-tauri/src/engine/build_session/build_session.rs`
- `docs/features/templates/README.md`

**Entry points:** src/features/templates/TemplatesPage.tsx, src-tauri/src/engine/build_session/build_session.rs

**Keywords:** template, adoption, seed, bootstrap, build-session, glyph, tier-gate, setup-detail

**API surface:** invoke('get_templates'), invoke('adopt_template'), invoke('get_build_session_status')

**Tech stack:** React, TypeScript, Rust

---

## Execution Engine

> **Group type:** —
> **Color:** emerald

### director-meta-persona

The Director is a special meta-persona that evaluates other agents' runs and produces structured verdicts (DIRECTOR_VERDICT, DIRECTOR_SCORE 0-5). Runs via the standard runner; its Brain long-term memory, business-value rollup, and management UI are director-specific.

**Files:**
- `src-tauri/src/engine/director.rs`
- `src-tauri/src/db/models/director_verdict.rs`
- `src/features/overview/sub_observability/DirectorPanel.tsx`
- `src/features/overview/sub_observability/DirectorModal.tsx`
- `src/features/agents/sub_editor/components/DirectorBadge.tsx`

**Entry points:** src-tauri/src/engine/director.rs, src/features/overview/sub_observability/DirectorPanel.tsx

**Keywords:** director, meta-persona, verdict, score, brain, value-rollup, evaluator, starred

**API surface:** invoke('get_director_verdicts'), invoke('get_director_brain')

**Tech stack:** Rust, React, TypeScript

---

### execution-chaining

Enables sequential and parallel chaining of persona executions — one execution's output feeds the next. Manages chain definitions, runtime state, failure policies, and the visual chain builder in the UI.

**Files:**
- `src-tauri/src/engine/chain.rs`
- `src-tauri/src/engine/chain_types.rs`
- `src-tauri/src/commands/execution/chain.rs`
- `src-tauri/src/db/models/chain.rs`
- `src/features/agents/sub_executions/ChainBuilder.tsx`
- `src/features/agents/sub_executions/hooks/useChainExecution.ts`

**Entry points:** src-tauri/src/engine/chain.rs, src/features/agents/sub_executions/ChainBuilder.tsx

**Keywords:** chain, sequential, parallel, pipeline, output-feed, composition, chaining

**API surface:** invoke('create_chain'), invoke('execute_chain'), invoke('get_chain_status')

**Tech stack:** Rust, React, TypeScript

---

### execution-monitoring

Frontend observability for live and historical execution runs — real-time status updates via WebSocket/Tauri events, execution timeline, stage drill-down, and replay of past runs. Powers the executions tab inside the agent editor.

**Files:**
- `src/features/agents/sub_executions/ExecutionsTab.tsx`
- `src/features/agents/sub_executions/ExecutionDetailView.tsx`
- `src/features/agents/sub_executions/components/ExecutionRow.tsx`
- `src/features/agents/sub_executions/components/StageTimeline.tsx`
- `src/features/agents/sub_executions/hooks/useExecutionStream.ts`
- `src/features/overview/sub_observability/ObservabilityPage.tsx`
- `src/features/overview/sub_realtime/RealtimeView.tsx`

**Entry points:** src/features/agents/sub_executions/ExecutionsTab.tsx, src/features/overview/sub_realtime/RealtimeView.tsx

**Keywords:** execution, monitoring, realtime, stream, stage, timeline, replay, observability

**API surface:** Tauri event 'execution_update', invoke('get_execution_history')

**Tech stack:** React, TypeScript, Tauri Events

---

### execution-runner

Core engine that runs a persona against an input: spawns the execution task, manages the stage-by-stage pipeline (prompt → LLM → output → post-processing), and emits real-time progress events. Non-blocking — returns after spawn; callers poll for terminal state.

**Files:**
- `src-tauri/src/engine/runner/stage_runner.rs`
- `src-tauri/src/engine/runner/execution_dispatcher.rs`
- `src-tauri/src/engine/runner/output_collector.rs`
- `src-tauri/src/engine/execution_engine/engine.rs`
- `src-tauri/src/engine/execution_engine/spawn.rs`
- `src-tauri/src/engine/prompt/prompt_builder.rs`
- `src-tauri/src/engine/prompt/context_injector.rs`
- `src-tauri/src/commands/execution/execute.rs`
- `src-tauri/src/commands/execution/policies.rs`
- `src-tauri/src/db/models/execution.rs`
- `src-tauri/src/db/repos/executions.rs`
- `src/api/agents/genome.ts`
- `docs/features/execution/README.md`

**Entry points:** src-tauri/src/engine/execution_engine/engine.rs, src-tauri/src/commands/execution/execute.rs

**Keywords:** execution, runner, stage, spawn, pipeline, prompt, output, terminal-state, dispatch

**API surface:** invoke('execute_persona'), invoke('get_execution'), invoke('cancel_execution')

**Tech stack:** Rust, Tokio, SQLite

---

### healing-engine

Automatic failure detection and recovery for stalled or failed executions. Classifies failures (transient vs. permanent), applies recovery strategies (retry, skip, escalate), and surfaces healing events to the observability layer.

**Files:**
- `src-tauri/src/engine/healing.rs`
- `src-tauri/src/engine/healing_types.rs`
- `src-tauri/src/commands/communication/healing.rs`
- `src-tauri/src/db/models/healing.rs`
- `src/api/overview/healing.ts`
- `src/features/overview/sub_observability/HealingPanel.tsx`

**Entry points:** src-tauri/src/engine/healing.rs, src/api/overview/healing.ts

**Keywords:** healing, recovery, failure, retry, escalate, circuit-breaker, resilience, auto-repair

**API surface:** invoke('get_healing_history'), invoke('trigger_manual_healing')

**Tech stack:** Rust, React, TypeScript

---

### scheduler

Cron-based scheduler that fires persona executions on a time schedule. Manages schedule CRUD, the tick loop, missed-run recovery, and the UI for browsing scheduled runs and their histories.

**Files:**
- `src-tauri/src/engine/scheduler.rs`
- `src-tauri/src/commands/communication/schedules.rs`
- `src-tauri/src/db/models/schedule.rs`
- `src-tauri/src/db/repos/schedules.rs`
- `src/features/schedules/SchedulesPage.tsx`
- `src/features/schedules/ScheduleCard.tsx`
- `src/features/schedules/hooks/useSchedules.ts`
- `src/features/overview/sub_cron_agents/CronAgentsView.tsx`

**Entry points:** src-tauri/src/engine/scheduler.rs, src/features/schedules/SchedulesPage.tsx

**Keywords:** scheduler, cron, schedule, tick, recurring, time-based, missed-run, recovery

**API surface:** invoke('create_schedule'), invoke('delete_schedule'), invoke('get_schedules')

**Tech stack:** Rust, React, TypeScript, cron

---

### tool-runner

Executes tool calls emitted by LLM outputs — built-in tools (filesystem, web, code interpreter), MCP-routed tools, and custom function handlers. Manages tool call parsing, sandboxing, result injection back into the execution context.

**Files:**
- `src-tauri/src/engine/tool_runner.rs`
- `src-tauri/src/engine/tool_registry.rs`
- `src/features/agents/sub_tool_runner/ToolRunnerTab.tsx`
- `src/features/agents/sub_tool_runner/components/ToolCallCard.tsx`
- `src/features/agents/sub_tool_runner/hooks/useToolResults.ts`
- `src-tauri/src/commands/execution/tool_calls.rs`

**Entry points:** src-tauri/src/engine/tool_runner.rs, src/features/agents/sub_tool_runner/ToolRunnerTab.tsx

**Keywords:** tool, tool-call, mcp, function, sandbox, injection, result, built-in-tool

**API surface:** invoke('get_tool_calls'), invoke('replay_tool_call')

**Tech stack:** Rust, React, TypeScript

---

## Observability

> **Group type:** —
> **Color:** blue

### health-checks

Periodic health-check probes for external service endpoints attached to personas. Detects degraded connectors before they affect live executions; surfaces connector status badges across the UI.

**Files:**
- `src/api/overview/healthcheckApi.ts`
- `src-tauri/src/commands/infrastructure/health_checks.rs`
- `src-tauri/src/engine/healthcheck_runner.rs`
- `src/features/overview/sub_observability/HealthStatusPanel.tsx`

**Entry points:** src-tauri/src/engine/healthcheck_runner.rs, src/api/overview/healthcheckApi.ts

**Keywords:** health-check, probe, connector-status, degraded, endpoint, monitoring, availability

**API surface:** invoke('run_healthchecks'), invoke('get_connector_health')

**Tech stack:** Rust, React, TypeScript

---

### knowledge-base

Local vector knowledge base backed by SQLite-vec and ONNX fastembed embeddings. Lets users upload documents, chunk and embed them, and run semantic search. The companion brain uses this for RAG-style context injection.

**Files:**
- `src/features/overview/sub_knowledge/KnowledgeView.tsx`
- `src/features/overview/sub_knowledge/components/DocumentCard.tsx`
- `src/features/overview/sub_knowledge/hooks/useKnowledgeSearch.ts`
- `src/api/vault/database/vectorKb.ts`
- `src/api/vault/database/nlQuery.ts`
- `src-tauri/src/companion/brain/embeddings.rs`
- `src-tauri/src/companion/brain/graph.rs`

**Entry points:** src/features/overview/sub_knowledge/KnowledgeView.tsx, src-tauri/src/companion/brain/embeddings.rs

**Keywords:** knowledge-base, vector, embeddings, semantic-search, rag, fastembed, onnx, sqlite-vec, documents

**API surface:** invoke('index_document'), invoke('semantic_search'), invoke('get_kb_documents')

**Tech stack:** Rust, fastembed, ONNX, sqlite-vec, React

---

### memory-messages

Persists and surfaces agent-produced memories (episodic facts the agent writes to recall later) and the full message history of agent conversations. Used for continuity across executions and human review of what agents learned.

**Files:**
- `src/features/overview/sub_memories/MemoriesView.tsx`
- `src/features/overview/sub_memories/components/MemoryCard.tsx`
- `src/features/overview/sub_messages/MessagesView.tsx`
- `src/features/overview/sub_messages/components/MessageThread.tsx`
- `src-tauri/src/companion/brain/episodic.rs`
- `src-tauri/src/db/models/memory.rs`
- `src-tauri/src/db/models/message.rs`

**Entry points:** src/features/overview/sub_memories/MemoriesView.tsx, src-tauri/src/companion/brain/episodic.rs

**Keywords:** memory, episodic, messages, conversation, recall, history, continuity

**API surface:** invoke('get_memories'), invoke('get_messages'), invoke('delete_memory')

**Tech stack:** Rust, React, TypeScript, SQLite

---

### overview-analytics

Dashboard analytics layer — aggregates execution metrics, cost, throughput, model efficiency, and business-value rates into charts and KPI summaries. Provides the main Overview page with usage trends and cross-persona comparisons.

**Files:**
- `src/features/overview/OverviewPage.tsx`
- `src/features/overview/sub_analytics/AnalyticsView.tsx`
- `src/features/overview/sub_analytics/charts/ExecutionTrendChart.tsx`
- `src/features/overview/sub_analytics/charts/CostChart.tsx`
- `src/features/overview/sub_usage/UsageView.tsx`
- `src/features/overview/sub_usage/hooks/useTierUsage.ts`
- `src/api/system/tierUsage.ts`
- `src/api/overview/savedViews.ts`
- `src-tauri/src/commands/communication/analytics.rs`

**Entry points:** src/features/overview/OverviewPage.tsx, src/features/overview/sub_analytics/AnalyticsView.tsx

**Keywords:** analytics, dashboard, kpi, metrics, cost, throughput, trend, usage, business-value

**API surface:** invoke('get_analytics_summary'), invoke('get_usage_by_period')

**Tech stack:** React, TypeScript, Recharts

---

### overview-events

Event feed and filtering UI that surfaces system-wide events from executions, triggers, healings, and integrations. Supports saved filter views and real-time streaming of new events as they arrive.

**Files:**
- `src/features/overview/sub_events/EventsView.tsx`
- `src/features/overview/sub_events/components/EventFeed.tsx`
- `src/features/overview/sub_events/components/EventFilterBar.tsx`
- `src/features/overview/sub_events/hooks/useEventStream.ts`
- `src/api/events/sharedEvents.ts`
- `src-tauri/src/commands/communication/events.rs`
- `src-tauri/src/engine/shared_event_relay.rs`
- `src-tauri/src/db/models/event.rs`

**Entry points:** src/features/overview/sub_events/EventsView.tsx, src-tauri/src/engine/shared_event_relay.rs

**Keywords:** events, feed, filter, stream, realtime, system-events, saved-view, relay

**API surface:** Tauri event 'new_system_event', invoke('get_events'), invoke('save_event_filter')

**Tech stack:** React, TypeScript, Rust, Tauri Events

---

### sla-tracking

Service-level agreement monitoring for persona executions — defines SLA targets (latency, success rate, cost bounds), evaluates runs against them, and surfaces violations with severity badges in the overview.

**Files:**
- `src/features/overview/sub_sla/SLAView.tsx`
- `src/features/overview/sub_sla/components/SLATargetCard.tsx`
- `src/features/overview/sub_sla/hooks/useSLAMetrics.ts`
- `src/api/overview/sla.ts`
- `src-tauri/src/commands/communication/sla.rs`
- `src-tauri/src/db/models/sla.rs`

**Entry points:** src/features/overview/sub_sla/SLAView.tsx, src/api/overview/sla.ts

**Keywords:** sla, latency, success-rate, violation, target, severity, compliance, threshold

**API surface:** invoke('get_sla_configs'), invoke('get_sla_violations')

**Tech stack:** React, TypeScript, Rust

---

## Automation & Pipelines

> **Group type:** —
> **Color:** amber

### fleet-management

Fleet view for managing multiple agents as a group — bulk operations, per-tile insights, skill drawer, transcript intelligence, hibernate, and remote execution. Surfaces agent skills and cross-run patterns without requiring individual agent navigation.

**Files:**
- `src/features/overview/sub_realtime/FleetView.tsx`
- `src/features/overview/sub_realtime/components/FleetTile.tsx`
- `src/features/overview/sub_realtime/components/SkillDrawer.tsx`
- `src/features/overview/sub_realtime/hooks/useFleetState.ts`
- `src-tauri/src/commands/execution/fleet.rs`
- `docs/features/fleet.md`

**Entry points:** src/features/overview/sub_realtime/FleetView.tsx, src-tauri/src/commands/execution/fleet.rs

**Keywords:** fleet, bulk, group, skills, transcript, hibernate, remote, tile, multi-agent

**API surface:** invoke('get_fleet_state'), invoke('hibernate_agent'), invoke('bulk_execute')

**Tech stack:** React, TypeScript, Rust

---

### recipe-engine

Recipe system for parameterized, reusable execution blueprints. A recipe wraps a persona + configuration into a shareable unit that can be played back with different inputs. Covers recipe editor, versioning, playground for testing, and the generation pipeline.

**Files:**
- `src/features/recipes/sub_list/RecipesListPage.tsx`
- `src/features/recipes/sub_editor/RecipeEditor.tsx`
- `src/features/recipes/sub_playground/RecipePlayground.tsx`
- `src/features/recipes/sub_manager/RecipeManager.tsx`
- `src/features/recipes/sub_editor/components/RecipeStepBuilder.tsx`
- `src-tauri/src/commands/recipes/execute.rs`
- `src-tauri/src/commands/recipes/generation.rs`
- `src-tauri/src/commands/recipes/versioning.rs`
- `src-tauri/src/db/models/recipe.rs`
- `docs/features/recipes/README.md`

**Entry points:** src/features/recipes/sub_list/RecipesListPage.tsx, src-tauri/src/commands/recipes/execute.rs

**Keywords:** recipe, blueprint, parameterized, versioning, playground, reusable, generation, execution-template

**API surface:** invoke('create_recipe'), invoke('execute_recipe'), invoke('get_recipe_versions')

**Tech stack:** React, TypeScript, Rust

---

### trigger-system

Event-driven trigger system that fires persona executions based on external events (webhooks, GitHub, Slack, scheduled events). Manages trigger definitions, routing rules, event matching, and the trigger configuration UI.

**Files:**
- `src/features/triggers/TriggersPage.tsx`
- `src/features/triggers/TriggerCard.tsx`
- `src/features/triggers/TriggerEditor.tsx`
- `src/features/triggers/hooks/useTriggers.ts`
- `src-tauri/src/commands/communication/triggers.rs`
- `src-tauri/src/engine/event_registry.rs`
- `src-tauri/src/db/models/trigger.rs`
- `src-tauri/src/db/repos/triggers.rs`
- `docs/features/events/README.md`

**Entry points:** src/features/triggers/TriggersPage.tsx, src-tauri/src/engine/event_registry.rs

**Keywords:** trigger, webhook, event-driven, routing, github, slack, automation, event-matching

**API surface:** invoke('create_trigger'), invoke('test_trigger'), POST /webhook/:id

**Tech stack:** React, TypeScript, Rust, Axum

---

### workflow-automation

Visual workflow / n8n-style pipeline builder for connecting multiple personas and tools into automated multi-step flows. Manages node-graph editing, flow execution, and the cross-platform n8n integration bridge.

**Files:**
- `src-tauri/src/commands/design/n8n_workflows.rs`
- `src/api/pipeline/workflows.ts`
- `src/features/recipes/sub_editor/components/WorkflowCanvas.tsx`
- `src/features/recipes/sub_editor/hooks/useWorkflowNodes.ts`

**Entry points:** src/api/pipeline/workflows.ts, src-tauri/src/commands/design/n8n_workflows.rs

**Keywords:** workflow, pipeline, n8n, visual, node-graph, automation, multi-step, canvas

**API surface:** invoke('get_workflows'), invoke('save_workflow'), invoke('execute_workflow')

**Tech stack:** React, TypeScript, React Flow, Rust

---

## Team Collaboration

> **Group type:** —
> **Color:** orange

### companion-brain

Athena — the AI companion that lives across the app. Handles proactive nudges, interactive replies, explain-in-cockpit, autonomous goal creation, and long-term brain memory. Runs as the Director's evaluator and surfaces insights through the CompanionPanel. The brain module includes vector-based retrieval with a MAX_VECTOR_DISTANCE floor and a dedicated doctrine lane to prevent off-topic recall padding.

**Files:**
- `src/features/shared/components/layout/TitleBarDock.tsx`
- `src/features/shared/components/layout/useTitleBarTray.tsx`
- `src/features/shared/components/layout/FullScreenOverlay.tsx`
- `src-tauri/src/companion/brain/graph.rs`
- `src-tauri/src/companion/brain/episodic.rs`
- `src-tauri/src/companion/brain/embeddings.rs`
- `src-tauri/src/companion/brain/doctrine.rs`
- `src-tauri/src/companion/brain/retrieval.rs`
- `src-tauri/src/commands/companion/job.rs`
- `src-tauri/src/commands/companion/plugin.rs`
- `docs/concepts/README.md`

**Entry points:** src/features/shared/components/layout/TitleBarDock.tsx, src-tauri/src/companion/brain/doctrine.rs

**Keywords:** athena, companion, brain, proactive, nudge, doctrine, interactive-reply, cockpit, autopilot

**API surface:** invoke('queue_companion_job'), invoke('get_companion_replies'), Tauri event 'companion_reply'

**Tech stack:** Rust, React, TypeScript

---

### goals-kpi

Goal-setting and KPI tracking within teams. Users define goals linked to personas and track acceptance/completion via the GoalAcceptanceOverlay. Athena can create and evaluate goals autonomously; cross-references are visible in the cockpit.

**Files:**
- `src/features/teams/sub_goals/GoalsPage.tsx`
- `src/features/teams/sub_goals/GoalAcceptanceOverlay.tsx`
- `src/features/teams/sub_goals/components/GoalCard.tsx`
- `src/features/teams/sub_goals/hooks/useGoals.ts`
- `src-tauri/src/commands/core/goals.rs`
- `src-tauri/src/db/models/goal.rs`

**Entry points:** src/features/teams/sub_goals/GoalsPage.tsx, src-tauri/src/commands/core/goals.rs

**Keywords:** goal, kpi, acceptance, tracking, athena, autopilot, cross-ref, cockpit

**API surface:** invoke('get_goals'), invoke('create_goal'), invoke('evaluate_goal')

**Tech stack:** React, TypeScript, Rust

---

### home-dashboard

Home screen and simple-mode experience — shows a quick-start dashboard, release roadmap, and simplified agent creation for non-power users. Includes the roadmap viewer and release changelog components.

**Files:**
- `src/features/home/HomePage.tsx`
- `src/features/home/components/QuickStartSection.tsx`
- `src/features/home/components/releases/HomeRoadmapView.tsx`
- `src/features/home/components/releases/ReleaseDetailView.tsx`
- `src/features/home/components/releases/i18n/useReleasesTranslation.ts`
- `src/features/simple-mode/SimpleModeView.tsx`
- `docs/features/home.md`

**Entry points:** src/features/home/HomePage.tsx, src/features/simple-mode/SimpleModeView.tsx

**Keywords:** home, dashboard, simple-mode, roadmap, quickstart, releases, changelog

**API surface:** invoke('get_roadmap'), invoke('get_recent_activity')

**Tech stack:** React, TypeScript

---

### onboarding-tours

First-run guided-tour steps that walk new users through core features (persona creation, first execution, connecting credentials). Backed by a step registry, tour orchestrator, and spotlight component.

**Files:**
- `src/features/onboarding/OnboardingOrchestrator.tsx`
- `src/features/onboarding/TourStep.tsx`
- `src/features/onboarding/SpotlightOverlay.tsx`
- `src/features/onboarding/hooks/useTourProgress.ts`
- `src/features/onboarding/tourRegistry.ts`
- `src/stores/slices/ui/tourSlice.ts`
- `docs/features/onboarding.md`

**Entry points:** src/features/onboarding/OnboardingOrchestrator.tsx, src/features/onboarding/tourRegistry.ts

**Keywords:** onboarding, tour, spotlight, first-run, guide, step, progress, walkthroughs

**API surface:** invoke('get_tour_state'), invoke('advance_tour')

**Tech stack:** React, TypeScript, Framer Motion

---

### teams-management

Teams feature enabling multi-user grouping of personas, shared goals, and collaborative KPI tracking. Manages team CRUD, member assignment, and the Teams sidebar navigation.

**Files:**
- `src/features/teams/TeamsPage.tsx`
- `src/features/teams/TeamCard.tsx`
- `src/features/teams/hooks/useTeams.ts`
- `src/features/shared/components/layout/sidebar/sections/TeamsSidebarNav.tsx`
- `src-tauri/src/commands/core/teams.rs`
- `src-tauri/src/db/models/team.rs`

**Entry points:** src/features/teams/TeamsPage.tsx, src-tauri/src/commands/core/teams.rs

**Keywords:** team, group, member, shared, collaboration, sidebar-nav

**API surface:** invoke('get_teams'), invoke('create_team'), invoke('add_team_member')

**Tech stack:** React, TypeScript, Rust

---

## Security & Credentials

> **Group type:** —
> **Color:** red

### credential-negotiator

Auto-discovery and negotiation layer for credentials — scans the environment (browser profiles, OS credential stores, environment variables) to suggest matching credentials for a connector, reducing manual setup friction.

**Files:**
- `src/api/vault/negotiator.ts`
- `src/api/vault/autoCredBrowser.ts`
- `src/api/vault/foraging.ts`
- `src-tauri/src/commands/credentials/foraging.rs`
- `src/features/vault/components/AutoDetectPanel.tsx`

**Entry points:** src/api/vault/negotiator.ts, src-tauri/src/commands/credentials/foraging.rs

**Keywords:** negotiator, auto-discover, foraging, credential-detect, browser-profile, env-var, suggestion

**API surface:** invoke('forage_credentials'), invoke('get_credential_suggestions')

**Tech stack:** Rust, React, TypeScript

---

### credential-vault

Encrypted credential storage with AES-256-GCM. Manages secret creation, retrieval, OS keyring integration, and the vault catalog UI. All connector credentials flow through the vault; bindings are validated against connector requirements before execution.

**Files:**
- `src/features/vault/VaultPage.tsx`
- `src/features/vault/components/CredentialCard.tsx`
- `src/features/vault/components/AddCredentialModal.tsx`
- `src/features/vault/hooks/useVault.ts`
- `src-tauri/src/commands/credentials/vault.rs`
- `src-tauri/src/engine/crypto.rs`
- `src-tauri/src/db/models/credential.rs`
- `src-tauri/src/db/repos/credentials.rs`
- `src/api/vault/foraging.ts`
- `docs/features/connections/README.md`

**Entry points:** src/features/vault/VaultPage.tsx, src-tauri/src/commands/credentials/vault.rs, src-tauri/src/engine/crypto.rs

**Keywords:** vault, credential, secret, aes-gcm, encryption, keyring, binding, secure-storage

**API surface:** invoke('store_credential'), invoke('get_credential'), invoke('delete_credential')

**Tech stack:** Rust, aes-gcm, keyring, React, TypeScript

---

### oauth-gateway

OAuth 2.0 PKCE flow implementation for connecting third-party services. Manages authorization initiation, callback handling, token refresh with distributed locking, and the browser-side credential capture bridge.

**Files:**
- `src/api/vault/oauthGatewayApi.ts`
- `src-tauri/src/commands/credentials/oauth.rs`
- `src-tauri/src/commands/credentials/desktop_bridge.rs`
- `src-tauri/src/engine/oauth_refresh_lock.rs`
- `src/api/auth/authDetect.ts`
- `src/features/vault/components/OAuthConnectButton.tsx`

**Entry points:** src-tauri/src/commands/credentials/oauth.rs, src-tauri/src/engine/oauth_refresh_lock.rs

**Keywords:** oauth, pkce, token, refresh, authorization, callback, desktop-bridge, lock

**API surface:** invoke('start_oauth_flow'), invoke('handle_oauth_callback'), invoke('refresh_oauth_token')

**Tech stack:** Rust, Axum, React, TypeScript

---

## Plugin Ecosystem

> **Group type:** —
> **Color:** pink

### artist-plugin

Media generation plugin (Artist) that lets agents produce images, audio, and video using external AI APIs (Leonardo, Higgsfield). Covers the render-plan pipeline, artifact storage, and the in-app media studio UI.

**Files:**
- `src/features/plugins/artist/ArtistPage.tsx`
- `src/features/plugins/artist/components/MediaStudio.tsx`
- `src/features/plugins/artist/components/RenderPlanViewer.tsx`
- `src/features/plugins/artist/hooks/useArtistRender.ts`
- `src-tauri/src/commands/artist/render.rs`
- `src-tauri/src/commands/artist/artifacts.rs`
- `src-tauri/src/db/models/render_plan.rs`
- `docs/features/plugins/artist/README.md`

**Entry points:** src/features/plugins/artist/ArtistPage.tsx, src-tauri/src/commands/artist/render.rs

**Keywords:** artist, media, image, audio, video, render-plan, leonardo, higgsfield, artifact

**API surface:** invoke('create_render_plan'), invoke('execute_render'), invoke('get_artifacts')

**Tech stack:** Rust, React, TypeScript, Leonardo AI

---

### cloud-deployment

Cloud platform integration for deploying personas to managed cloud infrastructure. Handles cloud authentication, instance lifecycle (deploy, redeploy, teardown), tier-based quota enforcement, and the cloud management UI.

**Files:**
- `src/features/cloud/CloudPage.tsx`
- `src/features/cloud/components/DeploymentCard.tsx`
- `src/features/cloud/hooks/useCloudDeployment.ts`
- `src/api/system/cloud.ts`
- `src-tauri/src/cloud/client.rs`
- `src-tauri/src/cloud/config.rs`
- `src-tauri/src/commands/infrastructure/cloud.rs`
- `docs/features/deployment.md`

**Entry points:** src/features/cloud/CloudPage.tsx, src-tauri/src/cloud/client.rs

**Keywords:** cloud, deploy, instance, redeploy, teardown, tier, quota, managed-cloud

**API surface:** invoke('deploy_persona'), invoke('get_cloud_instances'), invoke('teardown_instance')

**Tech stack:** Rust, Reqwest, React, TypeScript

---

### database-connector

Natural-language query interface for SQL databases attached as connectors. Translates plain-English questions into SQL via LLM, proposes schema modifications, and supports vector-augmented queries. Part of the vault's database sub-feature.

**Files:**
- `src/api/vault/database/nlQuery.ts`
- `src/api/vault/database/schemaProposal.ts`
- `src/api/vault/database/vectorKb.ts`
- `src/features/vault/sub_database/DatabaseQueryView.tsx`
- `src/features/vault/sub_database/components/SchemaProposalPanel.tsx`
- `src-tauri/src/commands/credentials/database.rs`

**Entry points:** src/features/vault/sub_database/DatabaseQueryView.tsx, src/api/vault/database/nlQuery.ts

**Keywords:** database, nl-query, sql, schema-proposal, vector, natural-language, connector

**API surface:** invoke('run_nl_query'), invoke('propose_schema'), invoke('execute_sql')

**Tech stack:** Rust, React, TypeScript, SQLite

---

### gitlab-integration

GitLab integration plugin for triggering persona executions on GitLab events (MRs, pipelines, issues). Manages GitLab credential binding, webhook registration, event parsing, and issue/MR creation from agent outputs.

**Files:**
- `src/features/plugins/gitlab/GitLabPage.tsx`
- `src/features/plugins/gitlab/components/GitLabEventList.tsx`
- `src/features/plugins/gitlab/hooks/useGitLabConnection.ts`
- `src/api/system/gitlab.ts`
- `src-tauri/src/gitlab/client.rs`
- `src-tauri/src/gitlab/config.rs`
- `src-tauri/src/gitlab/types.rs`
- `src-tauri/src/commands/infrastructure/gitlab.rs`
- `docs/architecture/gitlab-integration.md`

**Entry points:** src/features/plugins/gitlab/GitLabPage.tsx, src-tauri/src/gitlab/client.rs

**Keywords:** gitlab, merge-request, pipeline, webhook, issue, event, ci-cd, integration

**API surface:** invoke('connect_gitlab'), invoke('get_gitlab_events'), invoke('create_gitlab_issue')

**Tech stack:** Rust, Reqwest, React, TypeScript

---

### mcp-protocol

Model Context Protocol (MCP) server and client implementation. Exposes persona tools as MCP-compatible endpoints for external LLM hosts, handles tool discovery, and routes MCP tool calls into the execution engine. The companion connects via MCP for Claude-Managed Agents.

**Files:**
- `src-tauri/src/mcp_server/server.rs`
- `src-tauri/src/mcp_server/tool_adapter.rs`
- `src-tauri/src/mcp_server/protocol.rs`
- `src-tauri/src/commands/companion/plugin.rs`
- `src/api/agents/mcpTools.ts`
- `src-tauri/src/commands/infrastructure/binary_probes.rs`
- `docs/architecture/mcp-desktop-integration.md`

**Entry points:** src-tauri/src/mcp_server/server.rs, docs/architecture/mcp-desktop-integration.md

**Keywords:** mcp, model-context-protocol, tool-exposure, claude-managed-agents, external-host, tool-discovery

**API surface:** MCP stdio protocol; invoke('get_mcp_tools'), invoke('register_mcp_server')

**Tech stack:** Rust, Axum, MCP SDK

---

### p2p-networking

LAN discovery and P2P execution via QUIC transport (Quinn) and mDNS-SD. Enables agents on different machines to discover each other and coordinate executions without a central server. Gated behind the 'p2p' Cargo feature.

**Files:**
- `src-tauri/src/engine/p2p/discovery.rs`
- `src-tauri/src/engine/p2p/transport.rs`
- `src-tauri/src/engine/p2p/peer_registry.rs`
- `src-tauri/src/engine/topology_types.rs`
- `src-tauri/src/commands/infrastructure/p2p.rs`

**Entry points:** src-tauri/src/engine/p2p/discovery.rs, src-tauri/src/engine/p2p/transport.rs

**Keywords:** p2p, quic, mdns, lan, discovery, peer, distributed, transport, networking

**API surface:** invoke('start_p2p_discovery'), invoke('get_peers'), invoke('connect_peer')

**Tech stack:** Rust, Quinn, mdns-sd, ed25519

---

### skills-system

Reusable skill definitions that agents can invoke — discrete capabilities like 'summarise', 'translate', or 'search' packaged as callable units with defined inputs/outputs. Skills can be discovered, composed into recipes, and exposed via MCP.

**Files:**
- `src/api/skills/skills.ts`
- `src-tauri/src/commands/companion/plugin.rs`
- `src-tauri/src/engine/skill_registry.rs`
- `src/features/agents/sub_editor/components/SkillsTab.tsx`

**Entry points:** src/api/skills/skills.ts, src-tauri/src/engine/skill_registry.rs

**Keywords:** skill, capability, compose, registry, mcp-tool, invoke, reusable, discrete

**API surface:** invoke('get_skills'), invoke('invoke_skill'), invoke('register_skill')

**Tech stack:** Rust, React, TypeScript

---

## Platform Infrastructure

> **Group type:** —
> **Color:** indigo

### app-layout-navigation

Top-level app shell, sidebar navigation, title bar dock (Athena tray), and layout orchestration. Routes between feature pages, manages sidebar section preloading, and hosts the TitleBarDock for companion interactions and fullscreen overlays. Nav analytics (navCatalog, analytics index) track which screens receive usage.

**Files:**
- `src/App.tsx`
- `src/main.tsx`
- `src/features/shared/components/layout/AppShell.tsx`
- `src/features/shared/components/layout/Sidebar.tsx`
- `src/features/shared/components/layout/TitleBarDock.tsx`
- `src/features/shared/components/layout/useTitleBarTray.tsx`
- `src/features/shared/components/layout/FullScreenOverlay.tsx`
- `src/features/shared/components/layout/sidebar/sections/TeamsSidebarNav.tsx`
- `src/lib/analytics/navCatalog.ts`

**Entry points:** src/App.tsx, src/features/shared/components/layout/AppShell.tsx

**Keywords:** layout, sidebar, navigation, title-bar, dock, routing, shell, section-preload, nav-catalog

**API surface:** React Router routes, SidebarSection enum

**Tech stack:** React, TypeScript, React Router, Tailwind CSS

---

### build-test-tooling

Build pipeline, code-generation scripts, tier-validation, test harness, and CI gates. Covers Vite config, Tauri build variants, codegen orchestration, the guide/tour UI test harness at port 17320, custom ESLint rules, and the bug-hunt harness documentation under docs/harness/.

**Files:**
- `vite.config.ts`
- `scripts/run-codegen.mjs`
- `scripts/check-build-cache.mjs`
- `scripts/ensure-ort-cache.mjs`
- `scripts/generate-command-names.mjs`
- `scripts/check-tiers.mjs`
- `scripts/docs/check-doc-sync.mjs`
- `eslint-rules/`
- `src-tauri/src/local_http/test_server.rs`
- `docs/development/build.md`
- `tests/`
- `.lefthook/`
- `docs/harness/bug-hunt-2026-06-16/INDEX.md`
- `docs/harness/bug-hunt-2026-06-16/manifest.json`
- `docs/harness/bug-hunt-2026-06-16/findings.json`

**Entry points:** vite.config.ts, scripts/run-codegen.mjs, src-tauri/src/local_http/test_server.rs

**Keywords:** build, codegen, vite, tauri, ci, test-harness, eslint-rules, tier-validation, 17320, guide-test

**API surface:** HTTP :17320 /eval, /click-testid, /bridge-exec, /screenshot, /query, /state, /find-text

**Tech stack:** Vite, Rust, Axum, Node.js, Vitest, Playwright

---

### database-layer

SQLite data persistence layer with r2d2 connection pooling, repository pattern, and versioned migrations. All app data (personas, executions, credentials, events) flows through this layer. Includes schema migration runner and query builders.

**Files:**
- `src-tauri/src/db/connection.rs`
- `src-tauri/src/db/migrations.rs`
- `src-tauri/src/db/schema.rs`
- `src-tauri/src/db/repos/personas.rs`
- `src-tauri/src/db/repos/executions.rs`
- `src-tauri/src/db/repos/credentials.rs`
- `src-tauri/src/db/repos/triggers.rs`
- `src-tauri/src/db/repos/schedules.rs`
- `src-tauri/src/db/repos/resources.rs`

**Entry points:** src-tauri/src/db/connection.rs, src-tauri/src/db/migrations.rs

**Keywords:** sqlite, migrations, repository, r2d2, schema, persistence, connection-pool, data-layer

**API surface:** Internal Rust repository trait pattern

**Tech stack:** Rust, rusqlite, r2d2, SQLite

---

### error-analytics

Error handling infrastructure: Sentry integration, the error registry that maps raw errors to i18n-friendly messages, toastCatch/silentCatch helpers, and frontend crash reporting to the Rust backend.

**Files:**
- `src/lib/silentCatch.ts`
- `src/lib/errors/errorRegistry.ts`
- `src/i18n/useTranslatedError.ts`
- `src-tauri/src/commands/core/crash_report.rs`
- `src-tauri/src/db/repos/core/frontend_crashes.rs`

**Entry points:** src/lib/silentCatch.ts, src/lib/errors/errorRegistry.ts

**Keywords:** sentry, error-registry, toast, crash, silent-catch, error-handling, i18n-error, breadcrumb

**API surface:** toastCatch(promise), silentCatch(fn), resolveError(rawError)

**Tech stack:** TypeScript, Sentry, Rust

---

### i18n-system

14-language internationalization with lazy per-section loading. English source in locales/en.json (~11,500 keys); codegen produces typed Translations, enSectionStrings, and per-language section chunks. Runtime uses a Proxy that loads chunks on first access.

**Files:**
- `src/i18n/useTranslation.ts`
- `src/i18n/en.ts`
- `src/i18n/routeSections.ts`
- `src/i18n/tokenMaps.ts`
- `src/i18n/useTranslatedError.ts`
- `src/i18n/locales/en.json`
- `src/i18n/generated/types.ts`
- `src/i18n/generated/enSectionStrings.ts`
- `scripts/i18n/gen-types.mjs`
- `scripts/i18n/split-locales.mjs`
- `scripts/i18n/check-coverage.mjs`

**Entry points:** src/i18n/useTranslation.ts, src/i18n/locales/en.json

**Keywords:** i18n, localization, translation, 14-languages, lazy-loading, section-locale, proxy, codegen, token

**API surface:** useTranslation() → { t, tx }; tokenLabel(t, category, key)

**Tech stack:** TypeScript, Vite, React

---

### settings-preferences

Application settings and user preferences — appearance (themes, density), language selection, model API keys, notification config, tier display, and the bring-your-own-model (BYOM) setup. Persisted in SQLite and surfaced through the Settings page.

**Files:**
- `src/features/settings/SettingsPage.tsx`
- `src/features/settings/tabs/AppearanceSettings.tsx`
- `src/features/settings/tabs/AccountSettings.tsx`
- `src/features/settings/sub_byom/ByomSettings.tsx`
- `src/features/settings/tabs/NotificationsSettings.tsx`
- `src-tauri/src/commands/core/settings.rs`
- `src-tauri/src/db/models/settings.rs`
- `docs/features/settings/README.md`

**Entry points:** src/features/settings/SettingsPage.tsx, src-tauri/src/commands/core/settings.rs

**Keywords:** settings, preferences, theme, language, byom, model-key, notifications, appearance

**API surface:** invoke('get_settings'), invoke('update_settings')

**Tech stack:** React, TypeScript, Rust

---

### shared-ui-components

173-component shared component library covering buttons, modals, feedback states, forms, display primitives, and layout shells. Auto-catalogued via gen:catalog; ESLint enforces reuse over hand-rolling. The canonical CATALOG.md lists every component with import paths.

**Files:**
- `src/features/shared/components/CATALOG.md`
- `src/features/shared/components/buttons/Button.tsx`
- `src/features/shared/components/buttons/AsyncButton.tsx`
- `src/features/shared/components/buttons/CopyButton.tsx`
- `src/features/shared/components/feedback/LoadingSpinner.tsx`
- `src/features/shared/components/feedback/EmptyState.tsx`
- `src/features/shared/components/feedback/ConfirmDialog.tsx`
- `src/features/shared/components/modals/BaseModal.tsx`
- `src/features/shared/components/display/Tooltip.tsx`
- `src/features/shared/components/display/RelativeTime.tsx`
- `src/features/shared/components/display/Numeric.tsx`
- `src/features/shared/components/forms/FormField.tsx`
- `src/features/shared/components/forms/AccessibleToggle.tsx`
- `src/features/shared/components/forms/Listbox.tsx`
- `src/features/shared/components/layout/PanelTabBar.tsx`
- `src/features/shared/components/layout/SegmentedTabs.tsx`

**Entry points:** src/features/shared/components/CATALOG.md, src/features/shared/components/modals/BaseModal.tsx

**Keywords:** shared-components, ui-library, button, modal, form, tooltip, spinner, empty-state, catalog, reusable

**API surface:** import from '@/features/shared/components/<category>/<Name>'

**Tech stack:** React, TypeScript, Tailwind CSS

---

### state-management

Zustand store with slice pattern for all frontend state — UI state, active personas, execution buffers, settings. Slices live in src/stores/slices/ and are composed in the root store. Uses useShallow for selective subscriptions.

**Files:**
- `src/stores/personaStore.ts`
- `src/stores/storeTypes.ts`
- `src/stores/slices/system/uiSlice.ts`
- `src/stores/slices/system/settingsSlice.ts`
- `src/stores/slices/agents/agentSlice.ts`
- `src/stores/slices/execution/executionSlice.ts`
- `src/stores/slices/ui/tourSlice.ts`
- `src/stores/slices/ui/alertSlice.ts`

**Entry points:** src/stores/personaStore.ts, src/stores/storeTypes.ts

**Keywords:** zustand, store, slice, state, useShallow, global-state, ui-slice, execution-buffer

**API surface:** usePersonaStore(), useShallow()

**Tech stack:** Zustand 5, TypeScript, React

---

### tauri-ipc-bridge

Frontend-to-backend IPC bridge using Tauri's typed command system. All frontend calls go through invokeWithTimeout wrappers; ESLint enforces no raw invoke() calls. Includes generated command-name constants and ts-rs type bindings.

**Files:**
- `src/lib/tauriInvoke.ts`
- `src/lib/bindings/`
- `src-tauri/src/lib.rs`
- `scripts/generate-command-names.mjs`
- `src-tauri/src/commands/mod.rs`

**Entry points:** src/lib/tauriInvoke.ts, src-tauri/src/lib.rs

**Keywords:** tauri, ipc, invoke, command, binding, ts-rs, timeout, bridge, type-safe

**API surface:** invokeWithTimeout('<command_name>', payload, timeoutMs)

**Tech stack:** Tauri 2, TypeScript, Rust, ts-rs

---

## Ungrouped

> **Group type:** —
> **Color:** #888888

### dev-inspector

Developer-only click-to-inspect overlay (arm with semicolon then 'i', or Ctrl+Shift+L) that resolves the clicked DOM element to its React source file and line number, then copies a Claude-Code-clickable `src/…:LINE` path to the clipboard. Works by having a Babel AST transform stamp every JSX host element with a `data-loc` attribute at build time; devLocate.ts walks the ancestor chain at click time and picks the call-site file over shared-library internals. Only active in `tauri:dev:inspect` mode.

**Files:**
- `src/lib/dev/DevInspector.tsx`
- `src/lib/dev/devInspectorUi.tsx`
- `src/lib/dev/devLocate.ts`
- `src/lib/dev/__tests__/devLocate.test.ts`
- `scripts/babel/dev-source-loc-vite-plugin.mjs`
- `scripts/babel/inject-source-loc.mjs`
- `docs/development/dev-inspector.md`

**Entry points:** src/lib/dev/DevInspector.tsx, scripts/babel/dev-source-loc-vite-plugin.mjs

**Keywords:** dev-inspector, source-location, data-loc, babel, click-to-copy, inspect, devtools, tauri-dev

**Tech stack:** TypeScript, React, Babel, Vite

---

### gallery-sharing-growth

Viral growth loop that lets users publish individual personas to a public web gallery and teams as community presets, then share the resulting link or invite URL. Implements a four-step activation funnel (imported → persona_created → execution_completed → shared) with per-install pseudonymous deduplication, referral attribution via deep-link codes, and a pluggable analytics sink so all conversion events flow through the same telemetry toggle. Backend commands in gallery.rs hit the personas.ai/api REST surface; bindings are ts-rs exported.

**Files:**
- `src-tauri/src/commands/core/gallery.rs`
- `src/features/agents/sub_editor/components/ShareAgentButton.tsx`
- `src/features/teams/sub_teamWorkspace/teamStudio/PublishPresetButton.tsx`
- `src/lib/analytics/activation.ts`
- `src/lib/analytics/activation.test.ts`
- `src/lib/analytics/index.ts`
- `src/lib/bindings/GalleryPublishResult.ts`
- `src/lib/bindings/PresetPublishResult.ts`
- `src/lib/bindings/ReferralStats.ts`

**Entry points:** src-tauri/src/commands/core/gallery.rs, src/lib/analytics/activation.ts, src/features/agents/sub_editor/components/ShareAgentButton.tsx

**Keywords:** gallery, share, publish, referral, activation, funnel, virality, install-id, deep-link, k-factor

**API surface:** POST personas.ai/api/personas/publish, GET personas.ai/api/personas/<slug>, POST personas.ai/api/presets/publish, POST personas.ai/api/referrals, GET personas.ai/api/referrals?referrer=<code>

**Tech stack:** Rust, TypeScript, React, reqwest, ts-rs

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
git_head: 76b820539966652a16e0e6e0999c74af8d5187a3
git_commit_count: 4655
generated_at: 2026-06-20T08:03:57.785Z
-->
