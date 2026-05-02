# Codebase Context Snapshot — personas

> Generated: 2026-05-02T08:43:53.777Z
> Source: dev_contexts table for project_id=b0c1541f-af08-4912-818e-19ca94f7b6e9
> Total groups: 8, Total contexts: 32
> Git HEAD at generation: 4560b79e (architect: refactor VideoLane onto MediaLaneShell)
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

## AI Agent Configuration

> **Group type:** —
> **Color:** blue

### agent-chat-interface

Provides the real-time chat UI for interacting with AI agents, including chat bubbles, session sidebar, and specialized launchpad panels for advisory and ops workflows. Dispatches advisory and ops commands through dedicated dispatch modules. New AdvisoryLaunchpad enables structured AI guidance within the chat context.

**Files:**
- `src/features/agents/sub_chat/ChatBubbles.tsx`
- `src/features/agents/sub_chat/ChatTab.tsx`
- `src/features/agents/sub_chat/AdvisoryLaunchpad.tsx`
- `src/features/agents/sub_chat/OpsLaunchpad.tsx`
- `src/features/agents/sub_chat/SessionSidebar.tsx`
- `src/features/agents/sub_chat/libs/chatAdvisoryDispatch.ts`
- `src/features/agents/sub_chat/libs/chatOpsDispatch.ts`
- `src/features/agents/sub_chat/hooks/useExperimentBridge.ts`

**Entry points:** src/features/agents/sub_chat/ChatTab.tsx, src/features/agents/sub_chat/AdvisoryLaunchpad.tsx

**Keywords:** chat, messages, advisory, ops, session, launchpad, bubbles

**Tech stack:** React, TypeScript

---

### agent-design-wizard

Drives the AI-assisted design tab within the persona editor, where the system proposes configuration improvements through a wizard flow. Manages design phase transitions and renders phase-specific content panels. Coordinates with the backend credential design engine for AI-generated suggestions.

**Files:**
- `src/features/agents/sub_design/components/DesignTabPhaseContent.tsx`
- `src/features/agents/sub_design/components/PhaseContentRenderers.tsx`
- `src/features/agents/sub_design/DesignTabHelpers.ts`
- `src/features/agents/sub_design/libs/designStateHelpers.ts`
- `src/features/agents/sub_design/libs/useDesignTabState.ts`
- `src/features/agents/sub_design/wizard/wizardCompiler.ts`
- `src/features/agents/sub_design/wizard/wizardSteps.ts`
- `src/features/agents/sub_design/index.ts`

**Entry points:** src/features/agents/sub_design/libs/useDesignTabState.ts, src/features/agents/sub_design/components/DesignTabPhaseContent.tsx

**Keywords:** design, wizard, AI suggestions, phase, configuration, proposal

**Tech stack:** React, TypeScript

---

### agent-matrix-build

Manages the persona matrix UI where agents are arranged in a grid with build states, credential gap indicators, and workflow import capabilities. Implements a cell state machine with visual glow effects and vocabulary per cell state. Drives the matrix build orchestration from the frontend through Tauri commands.

**Files:**
- `src/features/agents/components/matrix/useMatrixBuild.ts`
- `src/features/agents/components/matrix/useMatrixEditCallbacks.ts`
- `src/features/agents/components/matrix/useMatrixCredentialGap.ts`
- `src/features/agents/components/matrix/useMatrixWorkflowImport.ts`
- `src/features/agents/components/matrix/useHealthyConnectors.ts`
- `src/features/agents/components/matrix/cellGlowColors.ts`
- `src/features/agents/components/matrix/cellStateClasses.ts`
- `src/features/agents/components/matrix/cellVocabulary.ts`
- `src/features/agents/components/creation/steps/builder/useBuilderOrchestration.ts`
- `src/features/agents/components/creation/steps/builder/builderActions.ts`
- `src/features/agents/components/creation/steps/builder/builderReducer.ts`
- `src/features/agents/components/creation/steps/builder/builderHelpers.ts`
- `src/features/agents/components/creation/steps/builder/designResultMapper.ts`
- `src/features/agents/components/creation/steps/builder/types.ts`
- `src/features/agents/components/creation/steps/identityHelpers.ts`

**Entry points:** src/features/agents/components/matrix/useMatrixBuild.ts, src/features/agents/components/creation/steps/builder/useBuilderOrchestration.ts

**Keywords:** matrix, build, cell, state machine, credential gap, workflow import, persona grid

**Tech stack:** React, TypeScript, Tauri

---

### agent-persona-editor

Provides the rich text editor interface for configuring AI agent personas, including prompt editing, tabbed sections, and draft/save lifecycle. Uses a reducer-based draft system with debounced auto-save and guards against unsaved changes during navigation. Depends on agent store and credential connector data.

**Files:**
- `src/features/agents/sub_editor/components/PersonaEditor.tsx`
- `src/features/agents/sub_editor/components/EditorBanners.tsx`
- `src/features/agents/sub_editor/components/EditorLazyTabs.tsx`
- `src/features/agents/sub_editor/components/EditorTabBar.tsx`
- `src/features/agents/sub_editor/components/EditorTabContent.tsx`
- `src/features/agents/sub_editor/hooks/useEditorDraft.ts`
- `src/features/agents/sub_editor/hooks/useEditorKeyboard.ts`
- `src/features/agents/sub_editor/hooks/usePersonaSwitchGuard.ts`
- `src/features/agents/sub_editor/libs/EditorDocument.tsx`
- `src/features/agents/sub_editor/libs/PersonaDraft.ts`
- `src/features/agents/sub_editor/libs/useEditorSave.ts`
- `src/features/agents/sub_editor/libs/useEffectivePersona.ts`
- `src/features/agents/sub_editor/libs/useTabSection.ts`
- `src/features/agents/sub_editor/libs/editorTabConstants.ts`
- `src/features/agents/sub_editor/index.ts`

**Entry points:** src/features/agents/sub_editor/components/PersonaEditor.tsx, src/features/agents/sub_editor/hooks/useEditorDraft.ts

**Keywords:** persona, editor, prompt, draft, save, tabs, agent configuration

**Tech stack:** React, TypeScript

---

### agent-store-state

Central Redux store slices and selectors managing global agent state including the agent list, active persona, and chat session state. The agentStore and chatSlice coordinate cross-feature state sharing. The authStore holds user authentication and tier information.

**Files:**
- `src/stores/agentStore.ts`
- `src/stores/authStore.ts`
- `src/stores/slices/agents/chatSlice.ts`
- `src/stores/notificationCenterStore.ts`
- `src/stores/slices/system/uiSlice.ts`

**Entry points:** src/stores/agentStore.ts

**Keywords:** Redux, store, state management, agent store, auth, slices

**Tech stack:** React, TypeScript, Redux

---

## Credential & Integration Vault

> **Group type:** —
> **Color:** amber

### agent-connector-subscriptions

Manages the binding of credentials and automation connectors to agent personas, including dependency graph resolution and subscription lifecycle management. Tracks unfulfilled credential requirements and drives the setup flow. Serves as the bridge between the credential vault and agent configuration.

**Files:**
- `src/features/agents/sub_connectors/libs/automationSetupConstants.ts`
- `src/features/agents/sub_connectors/libs/automationTypes.ts`
- `src/features/agents/sub_connectors/libs/connectorTypes.ts`
- `src/features/agents/sub_connectors/libs/dependencyGraph.ts`
- `src/features/agents/sub_connectors/libs/subscriptionHelpers.ts`
- `src/features/agents/sub_connectors/libs/subscriptionLifecycle.ts`
- `src/features/agents/sub_connectors/libs/usePlatformData.ts`
- `src/features/agents/sub_connectors/libs/useUnfulfilledCredentials.ts`
- `src/features/agents/sub_connectors/index.ts`

**Entry points:** src/features/agents/sub_connectors/libs/subscriptionLifecycle.ts, src/features/agents/sub_connectors/libs/useUnfulfilledCredentials.ts

**Keywords:** connector, subscription, automation, dependency graph, credentials binding, platform

**Tech stack:** React, TypeScript

---

### credential-auto-setup

Automates credential acquisition through browser-driven flows using a Playwright adapter to interact with third-party login pages. Supports both vendor-specific and universal auto-cred flows with multi-step progress tracking, consent screens, and review/approval stages. The TauriPlaywrightAdapter bridges the Rust browser automation engine to the frontend.

**Files:**
- `src/features/vault/sub_catalog/components/autoCred/steps/AutoCredPanel.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/AutoCredBrowser.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/AutoCredBrowserError.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/AutoCredConsent.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/AutoCredReview.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/CatalogAutoSetup.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/ReviewActions.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/ReviewTable.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/SetupSteps.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/UniversalAutoCredInputPhase.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/UniversalAutoCredPanel.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/UniversalAutoCredRunningPhase.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/UniversalAutoCredReview.tsx`
- `src/features/vault/sub_catalog/components/autoCred/helpers/autoCredHelpers.ts`
- `src/features/vault/sub_catalog/components/autoCred/helpers/autoCredErrorConfig.ts`
- `src/features/vault/sub_catalog/components/autoCred/helpers/useAutoCredSession.ts`
- `src/features/vault/sub_catalog/components/autoCred/helpers/TauriPlaywrightAdapter.ts`
- `src/features/vault/sub_catalog/components/autoCred/display/AutoCredCards.tsx`
- `src/features/vault/sub_catalog/components/autoCred/display/AutoCredErrorDisplay.tsx`
- `src/features/vault/sub_catalog/components/autoCred/display/AutoCredLogEntries.tsx`

**Entry points:** src/features/vault/sub_catalog/components/autoCred/steps/CatalogAutoSetup.tsx, src/features/vault/sub_catalog/components/autoCred/helpers/TauriPlaywrightAdapter.ts

**Keywords:** auto credential, browser automation, playwright, consent, credential acquisition, universal setup

**Tech stack:** React, TypeScript, Playwright

---

### credential-design-ai

Orchestrates AI-driven credential schema design where the system analyzes an integration's API and proposes a credential schema through a multi-phase modal flow (idle, analyzing, preview, done). The RecipeConfidenceBanner surfaces confidence scores for generated recipes. State is managed by a dedicated orchestrator context with derived state helpers.

**Files:**
- `src/features/vault/sub_catalog/components/design/CredentialDesignModal.tsx`
- `src/features/vault/sub_catalog/components/design/CredentialDesignModalBody.tsx`
- `src/features/vault/sub_catalog/components/design/CredentialDesignContext.tsx`
- `src/features/vault/sub_catalog/components/design/CredentialDesignHelpers.ts`
- `src/features/vault/sub_catalog/components/design/credentialDesignModalTypes.ts`
- `src/features/vault/sub_catalog/components/design/useCredentialDesignModal.ts`
- `src/features/vault/sub_catalog/components/design/useCredentialDesignOrchestrator.ts`
- `src/features/vault/sub_catalog/components/design/orchestratorContext.ts`
- `src/features/vault/sub_catalog/components/design/orchestratorDerived.ts`
- `src/features/vault/sub_catalog/components/design/orchestratorTypes.ts`
- `src/features/vault/sub_catalog/components/design/phases/AnalyzingPhase.tsx`
- `src/features/vault/sub_catalog/components/design/phases/DonePhase.tsx`
- `src/features/vault/sub_catalog/components/design/phases/ErrorPhase.tsx`
- `src/features/vault/sub_catalog/components/design/phases/IdlePhase.tsx`
- `src/features/vault/sub_catalog/components/design/phases/IdleSuggestions.tsx`
- `src/features/vault/sub_catalog/components/design/phases/PreviewPhase.tsx`
- `src/features/vault/sub_catalog/components/design/phases/PreviewBanners.tsx`
- `src/features/vault/sub_catalog/components/design/phases/RecipeConfidenceBanner.tsx`
- `src/features/vault/sub_catalog/components/design/setup/InteractiveSetupInstructions.tsx`
- `src/features/vault/sub_catalog/components/design/setup/SetupStepCard.tsx`
- `src/features/vault/sub_catalog/components/design/setup/setupInstructionHelpers.tsx`

**Entry points:** src/features/vault/sub_catalog/components/design/CredentialDesignModal.tsx, src/features/vault/sub_catalog/components/design/useCredentialDesignOrchestrator.ts

**Keywords:** credential design, AI schema, recipe confidence, orchestrator, analyzing phase, preview

**API surface:** Tauri: credential_design commands

**Tech stack:** React, TypeScript

---

### credential-foraging

Implements intelligent credential discovery by scanning the user's environment for existing credentials and API keys. Renders a foraging panel with status panels, result cards, and a step indicator while the backend scans config files, environment variables, and keychains. Surfaces discovered credentials to reduce manual entry.

**Files:**
- `src/features/vault/sub_catalog/components/foraging/ForagingPanel.tsx`
- `src/features/vault/sub_catalog/components/foraging/ForagingResults.tsx`
- `src/features/vault/sub_catalog/components/foraging/ForagingResultCard.tsx`
- `src/features/vault/sub_catalog/components/foraging/ForagingStatusPanels.tsx`
- `src/features/vault/sub_catalog/components/foraging/ForagingStepIndicator.tsx`
- `src/api/vault/foraging.ts`

**Entry points:** src/features/vault/sub_catalog/components/foraging/ForagingPanel.tsx

**Keywords:** foraging, credential discovery, environment scan, keychain, auto-detect

**Tech stack:** React, TypeScript

---

### credential-negotiator

Implements an AI-guided negotiation flow for setting up complex credentials that require multi-step interactive guidance. Renders a planner phase followed by step-by-step guiding panels with action buttons. Acts as a higher-level orchestration layer on top of raw credential configuration for credentials that cannot be auto-provisioned.

**Files:**
- `src/features/vault/sub_catalog/components/negotiator/NegotiatorPanel.tsx`
- `src/features/vault/sub_catalog/components/negotiator/NegotiatorPhases.tsx`
- `src/features/vault/sub_catalog/components/negotiator/NegotiatorPlanningPhase.tsx`
- `src/features/vault/sub_catalog/components/negotiator/NegotiatorGuidingPhase.tsx`
- `src/features/vault/sub_catalog/components/negotiator/NegotiatorStepCard.tsx`
- `src/features/vault/sub_catalog/components/negotiator/NegotiatorStepCardHelpers.tsx`
- `src/features/vault/sub_catalog/components/negotiator/GuidingStepList.tsx`
- `src/features/vault/sub_catalog/components/negotiator/StepActions.tsx`

**Entry points:** src/features/vault/sub_catalog/components/negotiator/NegotiatorPanel.tsx, src/features/vault/sub_catalog/components/negotiator/NegotiatorPhases.tsx

**Keywords:** negotiator, guided setup, planning, step-by-step, credential wizard

**Tech stack:** React, TypeScript

---

### credential-picker

Provides the connector/credential browsing and selection interface with search, filtering by role presets, and recipe confidence indicators. Renders connector cards in a grid with per-connector setup guide modals. The useRecipeIndicators hook surfaces recipe adoption confidence scores per connector.

**Files:**
- `src/features/vault/sub_catalog/components/picker/CredentialPicker.tsx`
- `src/features/vault/sub_catalog/components/picker/ConnectorCard.tsx`
- `src/features/vault/sub_catalog/components/picker/PickerGrid.tsx`
- `src/features/vault/sub_catalog/components/picker/CredentialPickerFilters.tsx`
- `src/features/vault/sub_catalog/components/picker/usePickerFilters.ts`
- `src/features/vault/sub_catalog/components/picker/useRecipeIndicators.ts`
- `src/features/vault/sub_catalog/components/picker/catalogRolePresets.ts`
- `src/features/vault/sub_catalog/components/picker/connectorCardConstants.ts`
- `src/features/vault/sub_catalog/components/picker/SetupGuideModal.tsx`
- `src/features/vault/sub_catalog/components/schemas/CredentialSchemaForm.tsx`
- `src/features/vault/sub_catalog/components/schemas/SchemaFormFields.tsx`
- `src/features/vault/sub_catalog/components/schemas/ExtraFieldRenderers.tsx`
- `src/features/vault/sub_catalog/components/forms/CredentialTemplateForm.tsx`
- `src/features/vault/sub_catalog/components/forms/CredentialTypePicker.tsx`

**Entry points:** src/features/vault/sub_catalog/components/picker/CredentialPicker.tsx, src/features/vault/sub_catalog/components/picker/useRecipeIndicators.ts

**Keywords:** credential, connector, picker, catalog, recipe, filter, role preset

**Tech stack:** React, TypeScript

---

### desktop-app-discovery

Discovers locally-installed desktop applications and MCP servers that can be integrated as agent tools. Renders a discovery panel with separate lists for apps and MCP servers, plus capability approval cards for gating access. Provides the first step in enabling desktop-tool integrations without manual configuration.

**Files:**
- `src/features/vault/sub_catalog/components/desktop/DesktopDiscoveryPanel.tsx`
- `src/features/vault/sub_catalog/components/desktop/DesktopAppCard.tsx`
- `src/features/vault/sub_catalog/components/desktop/DiscoveryAppList.tsx`
- `src/features/vault/sub_catalog/components/desktop/DiscoveryMcpList.tsx`
- `src/features/vault/sub_catalog/components/desktop/McpServerCard.tsx`
- `src/features/vault/sub_catalog/components/desktop/CapabilityApprovalCard.tsx`

**Entry points:** src/features/vault/sub_catalog/components/desktop/DesktopDiscoveryPanel.tsx

**Keywords:** desktop, MCP, app discovery, local tools, capability approval, MCP server

**Tech stack:** React, TypeScript, Tauri

---

## Pipeline & Team Orchestration

> **Group type:** —
> **Color:** violet

### n8n-workflow-import

Handles importing and transforming n8n workflow definitions into the personas format, supporting file upload, URL import, and paste methods. A multi-step wizard manages session state through transform, navigation, session, and test reducers. Performs connector matching and credential gap analysis against the local vault.

**Files:**
- `src/features/templates/sub_n8n/hooks/useN8nSession.ts`
- `src/features/templates/sub_n8n/hooks/useN8nWizard.ts`
- `src/features/templates/sub_n8n/hooks/useN8nWizardHandlers.ts`
- `src/features/templates/sub_n8n/hooks/useN8nWizardLifecycleHandlers.ts`
- `src/features/templates/sub_n8n/hooks/useN8nWizardTransformHandlers.ts`
- `src/features/templates/sub_n8n/hooks/useN8nDesignData.ts`
- `src/features/templates/sub_n8n/hooks/useN8nTest.ts`
- `src/features/templates/sub_n8n/hooks/n8nTypes.ts`
- `src/features/templates/sub_n8n/hooks/n8nWizardTypes.ts`
- `src/features/templates/sub_n8n/reducers/transformReducer.ts`
- `src/features/templates/sub_n8n/reducers/sessionReducer.ts`
- `src/features/templates/sub_n8n/reducers/navigationReducer.ts`
- `src/features/templates/sub_n8n/reducers/testReducer.ts`
- `src/features/templates/sub_n8n/edit/connectorHealth.ts`
- `src/features/templates/sub_n8n/edit/connectorMatching.ts`
- `src/features/templates/sub_n8n/edit/credentialGapAnalysis.ts`
- `src/features/templates/sub_n8n/steps/upload/useFileUpload.ts`
- `src/features/templates/sub_n8n/steps/upload/usePasteImport.ts`
- `src/features/templates/sub_n8n/steps/upload/useUrlImport.ts`

**Entry points:** src/features/templates/sub_n8n/hooks/useN8nWizard.ts, src/features/templates/sub_n8n/hooks/useN8nSession.ts

**Keywords:** n8n, workflow import, transform, connector matching, credential gap, wizard

**Tech stack:** React, TypeScript

---

### team-management

Manages agent teams including group creation, team composition, shared memory pools, and scheduling of team-level tasks. Backend repos handle team and group CRUD with relational linking to individual agent personas. Frontend pipeline feature surfaces team configuration and task assignment workflows.

**Files:**
- `src/api/pipeline/teams.ts`
- `src/api/pipeline/groups.ts`
- `src/api/pipeline/scheduler.ts`
- `src/api/pipeline/teamMemories.ts`
- `src-tauri/src/commands/teams/mod.rs`
- `src-tauri/src/db/repos/core/teams.rs`
- `src-tauri/src/db/repos/core/groups.rs`

**Entry points:** src/api/pipeline/teams.ts, src-tauri/src/commands/teams/mod.rs

**Keywords:** team, group, shared memory, scheduling, multi-agent, orchestration

**Tech stack:** React, TypeScript, Rust, Tauri

---

### workflow-composition

Provides the visual workflow canvas for composing multi-agent pipelines by connecting nodes representing agent actions, triggers, and data transformations. Acts as the graphical entry point for pipeline design. Depends on team and agent data for node population.

**Files:**
- `src/features/composition/components/WorkflowCanvas.tsx`

**Entry points:** src/features/composition/components/WorkflowCanvas.tsx

**Keywords:** workflow, canvas, composition, pipeline, nodes, graph

**Tech stack:** React, TypeScript

---

## Event & Trigger Automation

> **Group type:** —
> **Color:** orange

### event-routing

Implements the frontend event bus that routes real-time backend events to UI components via a typed bridge pattern. The eventBridge module subscribes to Tauri events and dispatches them to registered handlers. The commandNames generated module provides type-safe event name constants for all backend commands.

**Files:**
- `src/lib/eventBridge.ts`
- `src/lib/commandNames.generated.ts`
- `src/stores/slices/system/uiSlice.ts`

**Entry points:** src/lib/eventBridge.ts

**Keywords:** event bridge, real-time, Tauri events, command names, pub-sub, reactive

**Tech stack:** TypeScript, Tauri

---

### notification-management

Manages in-app notifications including a notification center store for aggregating system events, agent alerts, and execution outcomes. The notification settings panel allows users to configure per-channel delivery preferences. Drives toast notifications surfaced from background operations.

**Files:**
- `src/stores/notificationCenterStore.ts`
- `src/features/settings/sub_notifications/components/NotificationSettings.tsx`
- `src/stores/slices/agents/chatSlice.ts`

**Entry points:** src/stores/notificationCenterStore.ts

**Keywords:** notifications, alerts, toast, notification center, delivery, channels

**Tech stack:** React, TypeScript

---

### trigger-configuration

Provides the UI for creating and configuring event triggers that launch agent workflows automatically. TriggerAddForm handles new trigger creation with connector-specific configuration panels, while TriggerConfig manages the complete trigger lifecycle. Integrates with the event bridge for real-time trigger state updates.

**Files:**
- `src/features/triggers/sub_triggers/TriggerAddForm.tsx`
- `src/features/triggers/sub_triggers/TriggerConfig.tsx`
- `src/api/pipeline/triggers.ts`
- `src-tauri/src/db/repos/core/triggers.rs`

**Entry points:** src/features/triggers/sub_triggers/TriggerAddForm.tsx, src/features/triggers/sub_triggers/TriggerConfig.tsx

**Keywords:** trigger, automation, event, webhook, schedule, cron, conditions

**Tech stack:** React, TypeScript, Rust

---

## Execution & Observability

> **Group type:** —
> **Color:** emerald

### agent-health-monitoring

Monitors the operational health of AI agents and their integrations, surfacing diagnostic results and enabling one-click fix application. Runs scheduled health digest checks and maintains health state in the agent store. Integrates with the notifications system to alert users on degraded agent status.

**Files:**
- `src/features/agents/health/HealthCheckPanel.tsx`
- `src/features/agents/health/useHealthCheck.ts`
- `src/features/agents/health/useApplyHealthFix.ts`
- `src/features/agents/health/useHealthDigestScheduler.ts`
- `src/features/agents/health/types.ts`
- `src/features/agents/health/index.ts`

**Entry points:** src/features/agents/health/HealthCheckPanel.tsx, src/features/agents/health/useHealthCheck.ts

**Keywords:** health, diagnostics, monitoring, fix, digest, agent status

**Tech stack:** React, TypeScript

---

### execution-engine-backend

The Rust execution engine processes agent runs including prompt templating, checksum verification, output assertions, and process activity monitoring. Manages the full lifecycle from execution start through result storage. The test runner handles automated test suite execution with assertion evaluation.

**Files:**
- `src-tauri/src/engine/prompt.rs`
- `src-tauri/src/engine/template_checksums.rs`
- `src-tauri/src/engine/test_runner.rs`
- `src-tauri/src/engine/process_activity.rs`
- `src-tauri/src/engine/output_assertions.rs`
- `src-tauri/src/engine/optimizer.rs`
- `src-tauri/src/engine/cost.rs`
- `src-tauri/src/engine/rate_limiter.rs`
- `src-tauri/src/commands/execution/executions.rs`
- `src-tauri/src/db/repos/execution/executions.rs`

**Entry points:** src-tauri/src/commands/execution/executions.rs, src-tauri/src/engine/test_runner.rs

**Keywords:** execution engine, prompt, test runner, assertions, process activity, rate limiting, cost

**API surface:** Tauri commands: run_execution, run_test_suite

**Tech stack:** Rust, Tauri, SQLite

---

### execution-list

Renders the paginated execution history list with filtering, comparison, and drill-down detail views. Supports side-by-side comparison of execution runs with diff views and metric charts. Each execution item links to a full execution inspector with step-level trace navigation.

**Files:**
- `src/features/agents/sub_executions/components/list/ExecutionList.tsx`
- `src/features/agents/sub_executions/components/list/ExecutionListItem.tsx`
- `src/features/agents/sub_executions/components/list/ExecutionListRow.tsx`
- `src/features/agents/sub_executions/components/list/ExecutionListFilters.tsx`
- `src/features/agents/sub_executions/components/list/ExecutionDetail.tsx`
- `src/features/agents/sub_executions/components/list/ExecutionComparison.tsx`
- `src/features/agents/sub_executions/components/list/ComparisonDiff.tsx`
- `src/features/agents/sub_executions/components/list/ComparisonMetrics.tsx`
- `src/features/agents/sub_executions/components/list/ComparisonTable.tsx`
- `src/features/agents/sub_executions/components/detail/ExecutionInspector.tsx`
- `src/features/agents/sub_executions/components/detail/DetailHeader.tsx`
- `src/features/agents/sub_executions/components/detail/DetailMetadata.tsx`
- `src/features/agents/sub_executions/components/detail/DetailSteps.tsx`
- `src/features/agents/sub_executions/components/detail/TraceInspector.tsx`
- `src/features/agents/sub_executions/components/detail/TraceTree.tsx`

**Entry points:** src/features/agents/sub_executions/components/list/ExecutionList.tsx, src/features/agents/sub_executions/components/detail/ExecutionInspector.tsx

**Keywords:** execution, history, comparison, trace, inspector, diff, metrics

**Tech stack:** React, TypeScript

---

### execution-replay

Provides an interactive replay sandbox for stepping through past agent executions with a waterfall timeline and tool panel. Users can scrub the timeline, expand individual tool steps, and view the healing overlay for auto-corrected actions. Enables post-hoc debugging of agent behavior without re-running executions.

**Files:**
- `src/features/agents/sub_executions/components/replay/ReplaySandbox.tsx`
- `src/features/agents/sub_executions/components/replay/ReplayControls.tsx`
- `src/features/agents/sub_executions/components/replay/ReplayTimeline.tsx`
- `src/features/agents/sub_executions/components/replay/ReplayToolPanel.tsx`
- `src/features/agents/sub_executions/components/replay/ReplayTracePanel.tsx`
- `src/features/agents/sub_executions/components/replay/PipelineWaterfall.tsx`
- `src/features/agents/sub_executions/components/replay/PipelineStageIndicator.tsx`
- `src/features/agents/sub_executions/components/replay/WaterfallStage.tsx`
- `src/features/agents/sub_executions/components/replay/WaterfallTimeline.tsx`
- `src/features/agents/sub_executions/components/replay/ExpandableToolStep.tsx`
- `src/features/agents/sub_executions/components/replay/HealingOverlay.tsx`

**Entry points:** src/features/agents/sub_executions/components/replay/ReplaySandbox.tsx, src/features/agents/sub_executions/components/replay/PipelineWaterfall.tsx

**Keywords:** replay, waterfall, timeline, tool steps, healing, debugging, sandbox

**Tech stack:** React, TypeScript

---

## Template & Recipe Library

> **Group type:** —
> **Color:** indigo

### template-adoption

Streamlined adoption flow for applying a template to create or configure an agent persona. The simplified AdoptionWizardModal replaced a large multi-step wizard; remaining components handle questionnaire forms, matrix glass/blueprint previews, and the matrix adoption view. Surfaces pre-adoption readiness state to the user.

**Files:**
- `src/features/templates/sub_generated/adoption/AdoptionWizardModal.tsx`
- `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx`
- `src/features/templates/sub_generated/adoption/PersonaMatrixBlueprint.tsx`
- `src/features/templates/sub_generated/adoption/PersonaMatrixGlass.tsx`
- `src/features/templates/sub_generated/adoption/QuestionnaireFormGrid.tsx`
- `src/features/templates/sub_generated/adoption/index.ts`
- `src/features/templates/sub_generated/shared/AdoptCelebration.tsx`
- `src/features/templates/sub_generated/shared/adoptionReadiness.ts`
- `src/features/templates/sub_generated/shared/BaseModal.tsx`
- `src/features/templates/sub_generated/shared/DimensionRadial.tsx`
- `src/features/templates/sub_generated/shared/TabTransition.tsx`
- `src/features/templates/sub_generated/shared/templateComplexity.ts`
- `src/features/templates/sub_generated/shared/ThinkingLoader.tsx`

**Entry points:** src/features/templates/sub_generated/adoption/AdoptionWizardModal.tsx

**Keywords:** adoption, template, wizard, questionnaire, persona blueprint, readiness, onboarding

**Tech stack:** React, TypeScript

---

### template-diagram-viewer

Renders interactive activity and flow diagrams for visualizing template/workflow structures. The FlowDiagram component renders node graphs with popover detail panels. ActivityDiagramModal provides a full-screen diagram modal for complex template structures.

**Files:**
- `src/features/templates/sub_diagrams/FlowDiagram.tsx`
- `src/features/templates/sub_diagrams/FlowNodeCard.tsx`
- `src/features/templates/sub_diagrams/NodePopover.tsx`
- `src/features/templates/sub_diagrams/PopoverPositioner.tsx`
- `src/features/templates/sub_diagrams/ActivityDiagramModal.tsx`
- `src/features/templates/sub_diagrams/activityDiagramTypes.ts`

**Entry points:** src/features/templates/sub_diagrams/FlowDiagram.tsx, src/features/templates/sub_diagrams/ActivityDiagramModal.tsx

**Keywords:** diagram, flow, activity, nodes, visualization, graph

**Tech stack:** React, TypeScript

---

### template-gallery-browser

The primary template discovery interface presenting a filterable gallery of persona templates in card or matrix view with explore, search, and recommendation carousels. Supports adoption completion notifications and provides modal overlays for credential linking and preview. The PersonaMatrix renders a full connector×persona grid.

**Files:**
- `src/features/templates/sub_generated/gallery/cards/renderers/TemplateCard.tsx`
- `src/features/templates/sub_generated/gallery/cards/renderers/TemplateCardBody.tsx`
- `src/features/templates/sub_generated/gallery/cards/renderers/TemplateCardHeader.tsx`
- `src/features/templates/sub_generated/gallery/cards/renderers/TemplateCardFooter.tsx`
- `src/features/templates/sub_generated/gallery/cards/TemplateVirtualList.tsx`
- `src/features/templates/sub_generated/gallery/cards/CompactRow.tsx`
- `src/features/templates/sub_generated/gallery/cards/useGalleryActions.ts`
- `src/features/templates/sub_generated/gallery/cards/useTemplateCardData.ts`
- `src/features/templates/sub_generated/gallery/cards/GeneratedReviewsTab.tsx`
- `src/features/templates/sub_generated/gallery/cards/useAdoptionCompletionNotifier.ts`
- `src/features/templates/sub_generated/gallery/explore/ExploreView.tsx`
- `src/features/templates/sub_generated/gallery/explore/RecommendedCarousel.tsx`
- `src/features/templates/sub_generated/gallery/explore/TrendingCarousel.tsx`
- `src/features/templates/sub_generated/gallery/explore/AutomationOpportunitiesRail.tsx`
- `src/features/templates/sub_generated/gallery/explore/BackgroundBanners.tsx`
- `src/features/templates/sub_generated/gallery/matrix/PersonaMatrix.tsx`
- `src/features/templates/sub_generated/gallery/matrix/ConnectorEditCell.tsx`
- `src/features/templates/sub_generated/gallery/matrix/EditableMatrixCells.tsx`
- `src/features/templates/sub_generated/gallery/modals/TemplateModals.tsx`
- `src/features/templates/sub_generated/gallery/modals/TemplatePreviewModal.tsx`
- `src/features/templates/sub_generated/gallery/modals/CatalogCredentialModal.tsx`
- `src/features/templates/sub_generated/gallery/search/SearchAutocomplete.tsx`

**Entry points:** src/features/templates/sub_generated/gallery/explore/ExploreView.tsx, src/features/templates/sub_generated/gallery/matrix/PersonaMatrix.tsx

**Keywords:** template gallery, persona matrix, explore, recommended, trending, search, connector grid

**Tech stack:** React, TypeScript

---

### template-generation

Drives the AI-powered template generation flow where users describe an automation goal and the system produces a template definition. A design runner manages the streaming generation state through idle/running/done phases. Includes a design result preview with connector sections and event visualizations.

**Files:**
- `src/features/templates/sub_generated/generation/useCreateTemplateActions.ts`
- `src/features/templates/sub_generated/generation/useCreateTemplateReducer.ts`
- `src/features/templates/sub_generated/generation/useCreateTemplateSnapshot.ts`
- `src/features/templates/sub_generated/generation/runner/useDesignRunnerState.ts`
- `src/features/templates/sub_generated/generation/runner/designRunnerConstants.ts`
- `src/features/templates/sub_generated/generation/modals/createTemplateTypes.ts`
- `src/features/templates/sub_generated/generation/sources/TemplateSourceTypes.ts`
- `src/features/templates/sub_generated/design-preview/DesignResultPreview.tsx`
- `src/features/templates/sub_generated/design-preview/ConnectorsSection.tsx`
- `src/features/templates/sub_generated/design-preview/DesignTestResults.tsx`
- `src/features/templates/sub_generated/design-preview/EventsSection.tsx`
- `src/features/templates/sub_generated/design-preview/DesignCheckbox.tsx`
- `src/features/templates/sub_generated/design-preview/helpers.ts`

**Entry points:** src/features/templates/sub_generated/generation/useCreateTemplateActions.ts, src/features/templates/sub_generated/generation/runner/useDesignRunnerState.ts

**Keywords:** template generation, AI design, design runner, streaming, preview, create template

**Tech stack:** React, TypeScript

---

## Deployment & Sharing

> **Group type:** —
> **Color:** red

### deployment-config

Handles agent deployment configuration including cloud deployment settings, publishing flows, and platform-specific build targets. Provides the frontend UI for configuring where and how agents are deployed. Coordinates with the cloud client for remote deployment operations.

**Files:**
- `src/api/system/cloud.ts`
- `src-tauri/src/cloud/client.rs`
- `src-tauri/src/cloud/config.rs`
- `src-tauri/src/cloud/runner.rs`
- `src-tauri/src/cloud/mod.rs`

**Entry points:** src/api/system/cloud.ts, src-tauri/src/cloud/client.rs

**Keywords:** deployment, cloud, publish, build, platform, release

**Tech stack:** Rust, TypeScript, Tauri

---

### network-exposure

Manages peer-to-peer networking and secure agent endpoint exposure for cross-network access. The P2P engine handles messaging, protocol, and transport layers. Enclave management provides isolated execution environments, while the identity and exposure modules handle endpoint registration and discovery.

**Files:**
- `src-tauri/src/engine/p2p/mod.rs`
- `src-tauri/src/engine/topology_graph.rs`
- `src/api/network/enclave.ts`
- `src/api/network/exposure.ts`
- `src/api/network/identity.ts`
- `src/api/network/bundle.ts`
- `src/api/network/discovery.ts`

**Entry points:** src/api/network/exposure.ts, src-tauri/src/engine/p2p/mod.rs

**Keywords:** P2P, exposure, enclave, identity, networking, endpoint, discovery

**Tech stack:** Rust, TypeScript, Tauri

---

### sharing-features

Enables sharing of agent configurations and templates between users through export/import and data portability flows. Manages signed artifact creation for verifiable sharing. The data portability API handles export formats and import validation.

**Files:**
- `src/api/system/dataPortability.ts`
- `src/api/signing.ts`
- `src-tauri/src/commands/infrastructure/dev_tools.rs`

**Entry points:** src/api/system/dataPortability.ts

**Keywords:** sharing, export, import, data portability, signing, artifact

**Tech stack:** TypeScript, Rust

---

## Platform Administration

> **Group type:** —
> **Color:** pink

### onboarding-flow

Guides new users through initial platform setup with an overlay-based onboarding checklist that tracks completion of key configuration milestones. The useOnboardingChecklist hook drives step completion state. The overlay renders progressively as users complete each milestone.

**Files:**
- `src/features/onboarding/components/OnboardingOverlay.tsx`
- `src/features/agents/components/onboarding/useOnboardingChecklist.ts`

**Entry points:** src/features/onboarding/components/OnboardingOverlay.tsx, src/features/agents/components/onboarding/useOnboardingChecklist.ts

**Keywords:** onboarding, checklist, first-run, setup, overlay, milestones

**Tech stack:** React, TypeScript

---

### plugin-dev-tools

Provides developer tooling for plugin and agent lifecycle management, including the lifecycle page for inspecting plugin state, start/stop controls, and dev_tools backend commands. Supports the development workflow for building and testing agent integrations locally.

**Files:**
- `src/features/plugins/dev-tools/sub_lifecycle/LifecyclePage.tsx`
- `src-tauri/src/commands/infrastructure/dev_tools.rs`
- `src-tauri/src/db/repos/dev_tools.rs`
- `src-tauri/src/db/builtin_connectors.rs`

**Entry points:** src/features/plugins/dev-tools/sub_lifecycle/LifecyclePage.tsx, src-tauri/src/commands/infrastructure/dev_tools.rs

**Keywords:** dev tools, plugin, lifecycle, connectors, builtin, development

**Tech stack:** React, TypeScript, Rust

---

### settings-management

Provides user-facing settings panels for account configuration, API key management, notification preferences, and quality gate thresholds. Each settings sub-panel is independently mounted with its own local state. Settings are persisted through the system settings Tauri command and surfaced through the auth store.

**Files:**
- `src/features/settings/sub_account/components/AccountSettings.tsx`
- `src/features/settings/sub_notifications/components/NotificationSettings.tsx`
- `src/features/settings/sub_quality_gates/components/QualityGateSettings.tsx`
- `src/api/system/settings.ts`
- `src/stores/authStore.ts`

**Entry points:** src/features/settings/sub_account/components/AccountSettings.tsx

**Keywords:** settings, account, API keys, quality gates, preferences, configuration

**Tech stack:** React, TypeScript

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


<!-- snapshot-meta
git_head: 4560b79e45765a7e0b73a7bf84e2f120be8566f9
git_commit_count: 1144
generated_at: 2026-05-02T08:43:53.777Z
-->