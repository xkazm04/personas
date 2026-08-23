# Codebase Context Snapshot — personas

> Generated: 2026-08-06T20:23:09.821205800+00:00
> Source: context-map.json (single source of truth; rendered by scripts/context/render-codebase-context.mjs)
> Git HEAD at generation: d9f5643a4
> Total groups: 16 (DB) + hand-curated overrides · Total contexts: 208
>
> **DO NOT EDIT MANUALLY.** Re-run `node scripts/context/render-codebase-context.mjs`
> (or `/refresh-context`) to regenerate from context-map.json.
> Consumed by `/research` for relevance scoring.

---

## How to Use This File

Each section below describes a feature area of the codebase, with:
- **Description** — what it does
- **Files** — paths that implement it
- **Entry points** — key functions/components/routes
- **Keywords** — searchable terms for relevance matching
- **API surface** — external endpoints/IPC commands exposed
- **Tech stack** — frameworks/libs used in this area

When `/research` extracts an idea, it scores the idea against the keywords
and descriptions here to find the most likely attachment point. If no group
matches, the idea is dropped as out-of-scope.

---

## Agent Platform

> **Group type:** feature
> **Color:** violet

### agents-components-allpersonas

The top-level All Personas list view where users browse, filter and group their personas. Renders a paginated card/table with a toolbar, column-aware filter header, empty state, and constellation variant toggle. Drives the Zustand persona store and the context-map group drag rail. [Consolidated 2026-08-04: absorbed persona-overview-cards, persona-overview-director, persona-creation-flow]

**Files:**
- `src/features/agents/components/allPersonas/PersonaOverviewPage.tsx`
- `src/features/agents/components/allPersonas/PersonaOverviewToolbar.tsx`
- `src/features/agents/components/allPersonas/PersonaOverviewFilterHeader.tsx`
- `src/features/agents/components/allPersonas/PersonaOverviewFilters.tsx`
- `src/features/agents/components/allPersonas/PersonaOverviewEmptyState.tsx`
- `src/features/agents/components/allPersonas/PersonaOverviewVariantConstellation.tsx`
- `src/features/agents/components/allPersonas/viewConfig.ts`
- `src/features/agents/components/allPersonas/PersonaOverviewCardList.tsx`
- `src/features/agents/components/allPersonas/PersonaOverviewCells.tsx`
- `src/features/agents/components/allPersonas/PersonaOverviewColumns.tsx`
- `src/features/agents/components/allPersonas/PersonaOverviewActions.tsx`
- `src/features/agents/components/allPersonas/PersonaOverviewBadges.tsx`
- `src/features/agents/components/allPersonas/PersonaOverviewBatchBar.tsx`
- `src/features/agents/components/allPersonas/DirectorPanel.tsx`
- `src/features/agents/components/allPersonas/CompletenessRing.tsx`
- `src/features/agents/components/allPersonas/PersonaGroupDropRail.tsx`
- `src/features/agents/components/allPersonas/PersonaHealthIndicator.tsx`
- `src/features/agents/components/allPersonas/VerdictTrendCell.tsx`
- `src/features/agents/components/allPersonas/personaBuildStatus.ts`
- `src/features/agents/components/allPersonas/PersonaConfigPanel.tsx`
- `src/features/agents/components/create/useTemplateIntentMatch.ts`

**Entry points:** src/features/agents/components/allPersonas/PersonaOverviewPage.tsx, src/features/agents/components/allPersonas/PersonaOverviewCardList.tsx, src/features/agents/components/allPersonas/DirectorPanel.tsx

**Keywords:** personas, overview, list, filter, group, toolbar, constellation, browse, card, row, table, batch

**API surface:** list_personas, list_persona_groups

**Tech stack:** React 19, TypeScript, Zustand 5, Tailwind 4

---

### agents-deployment

Displays cloud execution history with filterable list (by persona, status, time period) and aggregated stats cards (total runs, success rate, total cost, average duration). Renders a DailyBreakdownChart for trend visualization, surfaces top error messages from stats, and shows expandable execution rows with full output via an LRU-cached output fetcher. Uses live polling to keep the history current. [Consolidated 2026-08-04: absorbed cloud-connection-form, cloud-deploy-panel, cloud-deployments-panel, cloud-health-monitor, cloud-oauth-panel, cloud-reconcile-banner, cloud-schedules-panel, cloud-status-panel, deployment-dashboard, deployment-health, deployment-table, deployment-test, deployment-types-core, unified-deployment-history, execution-mini-player]

**Files:**
- `src/features/agents/sub_deployment/components/cloud/CloudHistoryPanel.tsx`
- `src/features/agents/sub_deployment/components/cloud/CloudExecutionRow.tsx`
- `src/features/agents/sub_deployment/components/cloud/CloudHistoryHelpers.tsx`
- `src/features/agents/sub_deployment/components/cloud/StatCard.tsx`
- `src/features/agents/sub_deployment/components/cloud/DailyBreakdownChart.tsx`
- `src/features/agents/sub_deployment/components/cloud/CloudConnectionForm.tsx`
- `src/features/agents/sub_deployment/components/cloud/CloudDeployPanel.tsx`
- `src/features/agents/sub_deployment/components/cloud/CloudDeploymentsPanel.tsx`
- `src/features/agents/sub_deployment/components/cloud/DeploymentCard.tsx`
- `src/features/agents/sub_deployment/components/cloud/cloudDeploymentHelpers.ts`
- `src/features/agents/sub_deployment/components/cloud/ApiPlayground.tsx`
- `src/features/agents/sub_deployment/hooks/useCloudHealthMonitor.ts`
- `src/features/agents/sub_deployment/components/cloud/CloudOAuthPanel.tsx`
- `src/features/agents/sub_deployment/components/cloud/CloudReconcileBanner.tsx`
- `src/features/agents/sub_deployment/components/cloud/CloudSchedulesPanel.tsx`
- `src/features/agents/sub_deployment/components/cloud/CreateTriggerForm.tsx`
- `src/features/agents/sub_deployment/components/cloud/TriggerListItem.tsx`
- `src/features/agents/sub_deployment/components/cloud/cloudSchedulesHelpers.tsx`
- `src/features/agents/sub_deployment/components/cloud/CloudStatusPanel.tsx`
- `src/features/agents/sub_deployment/components/ExecutionProgressBar.tsx`
- `src/features/agents/sub_deployment/components/UnifiedDeploymentDashboard.tsx`
- `src/features/agents/sub_deployment/components/DeploymentFilters.tsx`
- `src/features/agents/sub_deployment/components/DeploymentSubComponents.tsx`
- `src/features/agents/sub_deployment/hooks/useDeploymentHealth.ts`
- `src/features/agents/sub_deployment/components/DeploymentTable.tsx`
- `src/features/agents/sub_deployment/components/DeploymentHealthSparkline.tsx`
- `src/features/agents/sub_deployment/components/BulkActionsToolbar.tsx`
- `src/features/agents/sub_deployment/hooks/useDeploymentTest.ts`
- `src/features/agents/sub_deployment/components/deploymentTypes.ts`
- `src/features/agents/sub_deployment/components/deploymentTypes.test.ts`
- `src/features/agents/sub_deployment/components/deploymentTokens.ts`
- `src/features/agents/sub_deployment/components/UnifiedDeploymentHistory.tsx`
- `src/features/agents/executionPlayer/ExecutionMiniPlayer.tsx`
- `src/features/agents/executionPlayer/PipelineDots.tsx`

**Entry points:** src/features/agents/sub_deployment/components/cloud/CloudHistoryPanel.tsx, src/features/agents/sub_deployment/components/cloud/CloudConnectionForm.tsx, src/features/agents/sub_deployment/components/cloud/CloudDeployPanel.tsx

**Keywords:** history, executions, stats, success rate, cost, duration, chart, output, LRU cache, polling, connection, cloud

**API surface:** cloudListExecutions, cloudExecutionStats, cloudGetExecutionOutput (Tauri IPC)

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### agents-editor

The main persona editor shell (tabbed surface) that developers and power users use to configure an agent across multiple domains. Hosts lazy-loaded tabs (connectors, design, lab, health, executions, use-cases, deployment, model config, settings) and manages the draft/save lifecycle, keyboard shortcuts, and tab navigation. The PersonaDraft abstraction tracks unsaved changes before committing via IPC. [Consolidated 2026-08-04: absorbed agent-activity]

**Files:**
- `src/features/agents/sub_editor/components/PersonaEditor.tsx`
- `src/features/agents/sub_editor/components/EditorBody.tsx`
- `src/features/agents/sub_editor/components/EditorTabBar.tsx`
- `src/features/agents/sub_editor/components/EditorTabContent.tsx`
- `src/features/agents/sub_editor/components/EditorLazyTabs.tsx`
- `src/features/agents/sub_editor/components/EditorBanners.tsx`
- `src/features/agents/sub_editor/components/EditorEmptyState.tsx`
- `src/features/agents/sub_editor/components/PersonaEditorHeader.tsx`
- `src/features/agents/sub_editor/components/PersonaChangeHistory.tsx`
- `src/features/agents/sub_editor/components/PersonaDecisionsFooter.tsx`
- `src/features/agents/sub_editor/components/QuickStatsBar.tsx`
- `src/features/agents/sub_editor/components/DeepFanoutToggle.tsx`
- `src/features/agents/sub_editor/components/ShareAgentButton.tsx`
- `src/features/agents/sub_editor/components/SubTabSurface.tsx`
- `src/features/agents/sub_editor/hooks/useEditorDraft.ts`
- `src/features/agents/sub_editor/hooks/useEditorKeyboard.ts`
- `src/features/agents/sub_editor/hooks/usePersonaSwitchGuard.ts`
- `src/features/agents/sub_editor/hooks/useQuickStats.ts`
- `src/features/agents/sub_editor/libs/EditorDocument.tsx`
- `src/features/agents/sub_editor/libs/PersonaDraft.ts`
- `src/features/agents/sub_editor/libs/editorTabConstants.ts`
- `src/features/agents/sub_editor/libs/useDebouncedSaveGroup.ts`
- `src/features/agents/sub_editor/libs/useEditorSave.ts`
- `src/features/agents/sub_editor/libs/useEffectivePersona.ts`
- `src/features/agents/sub_editor/libs/usePersonaReadiness.ts`
- `src/features/agents/sub_editor/libs/useTabSection.ts`
- `src/features/agents/sub_editor/index.ts`
- `src/features/agents/sub_activity/ActivityTab.tsx`
- `src/features/agents/sub_activity/ActivityList.tsx`
- `src/features/agents/sub_activity/ActivityHeader.tsx`
- `src/features/agents/sub_activity/ActivityFilters.tsx`
- `src/features/agents/sub_activity/ActivityModals.tsx`
- `src/features/agents/sub_activity/activityTypes.ts`

**Entry points:** src/features/agents/sub_editor/components/PersonaEditor.tsx, src/features/agents/sub_editor/libs/PersonaDraft.ts, src/features/agents/sub_activity/ActivityTab.tsx

**Keywords:** editor, tabs, draft, save, persona, keyboard, share, readiness, change-history, activity, log, events

**API surface:** update_persona, get_persona, persona_readiness

**Tech stack:** React 19, TypeScript, Zustand 5, Tauri 2

---

### agents-quick-answer

The full-app swipe deck that replaced the 576px anchored popover. Shows one card at a time from the unified queue with drag-to-decide physics ported from the existing `SwipeCard` / `BacklogFocusDeck` — reviewers already know the gesture. Includes the deck chrome (top bar with filter chips and progress, action bar with flanks, loading and cleared states), the `TriageCard` (draggable verdict card with markdown body, facts ledger, tags, alert banner, and branch buttons), and `QuestionPanel` (non-draggable, collects answers for build-question items). Keyboard: arrows decide, digit keys fire branches, Escape skips. [Consolidated 2026-08-04: absorbed quick-answer-legacy-rails, quick-answer-shell, triage-core, triage-tests, triage-unified-hook, quick-config-shared]

**Files:**
- `src/features/agents/quick-answer/triage/TriageDeckVariant.tsx`
- `src/features/agents/quick-answer/triage/deck/DeckActionBar.tsx`
- `src/features/agents/quick-answer/triage/deck/DeckChips.tsx`
- `src/features/agents/quick-answer/triage/deck/DeckStates.tsx`
- `src/features/agents/quick-answer/triage/deck/DeckTopBar.tsx`
- `src/features/agents/quick-answer/triage/deck/MetricBadgeRow.tsx`
- `src/features/agents/quick-answer/triage/deck/QuestionPanel.tsx`
- `src/features/agents/quick-answer/triage/deck/ReasonStrip.tsx`
- `src/features/agents/quick-answer/triage/deck/TriageCard.tsx`
- `src/features/agents/quick-answer/triage/deck/TriageCardBody.tsx`
- `src/features/agents/quick-answer/triage/deck/useDeckControls.tsx`
- `src/features/agents/quick-answer/QuickAnswerBody.tsx`
- `src/features/agents/quick-answer/QuickAnswerQuestionGroup.tsx`
- `src/features/agents/quick-answer/QuickAnswerReviewCard.tsx`
- `src/features/agents/quick-answer/QuickAnswerReviewStepper.tsx`
- `src/features/agents/quick-answer/QuickAnswerPopover.tsx`
- `src/features/agents/quick-answer/usePendingInteractions.ts`
- `src/features/agents/quick-answer/triage/triageTypes.ts`
- `src/features/agents/quick-answer/triage/triageQueue.ts`
- `src/features/agents/quick-answer/triage/triageDispatch.ts`
- `src/features/agents/quick-answer/triage/triageAdapters.ts`
- `src/features/agents/quick-answer/triage/triageReach.ts`
- `src/features/agents/quick-answer/triage/useTriageCopy.ts`
- `src/features/agents/quick-answer/triage/__tests__/triageAdapters.test.ts`
- `src/features/agents/quick-answer/triage/__tests__/triageDispatch.test.ts`
- `src/features/agents/quick-answer/triage/__tests__/triageFixtures.ts`
- `src/features/agents/quick-answer/triage/__tests__/triageQueue.test.ts`
- `src/features/agents/quick-answer/triage/__tests__/triageReach.test.ts`
- `src/features/agents/quick-answer/triage/__tests__/triageRenderCost.test.tsx`
- `src/features/agents/quick-answer/triage/__tests__/useDeckControls.test.ts`
- `src/features/agents/quick-answer/triage/useUnifiedTriage.ts`
- `src/features/agents/shared/quickConfig/quickConfigTypes.ts`
- `src/features/agents/shared/quickConfig/useHealthyConnectors.ts`

**Entry points:** src/features/agents/quick-answer/triage/TriageDeckVariant.tsx, src/features/agents/quick-answer/triage/deck/TriageCard.tsx, src/features/agents/quick-answer/triage/deck/useDeckControls.tsx

**Keywords:** triage-deck, swipe-card, keyboard-triage, drag-verdict, filter-chips, question-panel, reason-strip, metric-badge, deck-controls, framer-motion, review-card, question-group

**Tech stack:** React 19, TypeScript, framer-motion, Tailwind 4

---

### agents-use-cases

Use-case management tab for a persona: lists, creates, and details use-cases (discrete tasks a persona handles). Provides layout views, per-use-case detail panel with model/channel/fixture selection, a recipes-prototype tile grid for visual use-case composition, and hooks for toggling capabilities and manually triggering runs. [Consolidated 2026-08-04: absorbed agent-settings]

**Files:**
- `src/features/agents/sub_use_cases/components/core/PersonaUseCasesTab.tsx`
- `src/features/agents/sub_use_cases/components/core/UseCasesRefineCard.tsx`
- `src/features/agents/sub_use_cases/components/core/CapabilityDisableDialog.tsx`
- `src/features/agents/sub_use_cases/components/core/EventRenameModal.tsx`
- `src/features/agents/sub_use_cases/components/detail/UseCaseDetailPanel.tsx`
- `src/features/agents/sub_use_cases/components/detail/UseCaseDetailSections.tsx`
- `src/features/agents/sub_use_cases/components/detail/UseCaseChannelDropdown.tsx`
- `src/features/agents/sub_use_cases/components/detail/UseCaseModelDropdown.tsx`
- `src/features/agents/sub_use_cases/components/detail/UseCaseFixtureDropdown.tsx`
- `src/features/agents/sub_use_cases/components/detail/FixtureDropdownList.tsx`
- `src/features/agents/sub_use_cases/components/persona-layout/PersonaLayoutView.tsx`
- `src/features/agents/sub_use_cases/components/persona-layout/UseCaseLeftPanel.tsx`
- `src/features/agents/sub_use_cases/components/persona-layout/CapabilityTagBar.tsx`
- `src/features/agents/sub_use_cases/components/persona-layout/index.ts`
- `src/features/agents/sub_use_cases/components/recipes-prototype/shared/UseCaseDetailExpanded.tsx`
- `src/features/agents/sub_use_cases/components/recipes-prototype/shared/ConnectorDimCard.tsx`
- `src/features/agents/sub_use_cases/components/recipes-prototype/shared/NotificationsDimCard.tsx`
- `src/features/agents/sub_use_cases/components/recipes-prototype/shared/PersonaCrest.tsx`
- `src/features/agents/sub_use_cases/components/recipes-prototype/shared/TileModelStrip.tsx`
- `src/features/agents/sub_use_cases/components/recipes-prototype/shared/TilePolicyToggles.tsx`
- `src/features/agents/sub_use_cases/components/recipes-prototype/shared/MiniSigil.tsx`
- `src/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase.ts`
- `src/features/agents/sub_use_cases/components/recipes-prototype/shared/usePolicyControls.ts`
- `src/features/agents/sub_use_cases/libs/useCapabilityToggle.ts`
- `src/features/agents/sub_use_cases/libs/useCaseDetailHelpers.ts`
- `src/features/agents/sub_use_cases/libs/useCaseHelpers.ts`
- `src/features/agents/sub_use_cases/libs/useManualPersonaRun.ts`
- `src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts`
- `src/features/agents/sub_use_cases/libs/useUseCasesTab.ts`
- `src/features/agents/sub_settings/components/PersonaAssertionsSection.tsx`
- `src/features/agents/sub_settings/components/PersonaSettingsTab.tsx`
- `src/features/agents/sub_settings/components/SettingsStatusBar.tsx`
- `src/features/agents/sub_settings/index.ts`

**Entry points:** src/features/agents/sub_use_cases/components/core/PersonaUseCasesTab.tsx, src/features/agents/sub_use_cases/components/persona-layout/PersonaLayoutView.tsx, src/features/agents/sub_settings/components/PersonaSettingsTab.tsx

**Keywords:** use-case, capability, fixture, channel, manual-run, recipes, tile, policy, rename, settings, assertions, contracts

**API surface:** list_use_cases, update_use_case, run_persona

**Tech stack:** React 19, TypeScript, Zustand 5

---

### api-agents

Provides Tauri IPC wrappers for core persona CRUD operations — creating, updating, duplicating, deleting, and querying personas along with their use-case capability toggles, recipe parameter bindings, execution annotations, and custom icon upload/generation. It also exposes the archetype catalog (mentality archetypes and memory strategies) used by the Persona Foundry creation flow. All calls route through invokeWithTimeout to the Rust backend. [Consolidated 2026-08-04: absorbed build-session-api, genome-evolution-api, lab-testing-api, persona-execution-chat-api, persona-tools-automation-api, auth-session-api, connector-discovery-api, companion-athena-api, credential-scoping-api, research-obsidian-api]

**Files:**
- `src/api/agents/personas.ts`
- `src/api/agents/useCases.ts`
- `src/api/agents/personaParameters.ts`
- `src/api/agents/annotations.ts`
- `src/api/agents/personaIcons.ts`
- `src/api/archetypes.ts`
- `src/api/agents/buildSession.ts`
- `src/api/agents/outputAssertions.ts`
- `src/api/agents/genome.ts`
- `src/api/agents/evolution.ts`
- `src/api/agents/lab.ts`
- `src/api/agents/tests.ts`
- `src/api/agents/testSuites.ts`
- `src/api/agents/executions.ts`
- `src/api/agents/chat.ts`
- `src/api/agents/tools.ts`
- `src/api/agents/mcpTools.ts`
- `src/api/agents/automations.ts`
- `src/api/agents/channelDelivery.ts`
- `src/api/auth/auth.ts`
- `src/api/auth/externalApiKeys.ts`
- `src/api/auth/pairing.ts`
- `src/api/auth/cliCapture.ts`
- `src/api/auth/authDetect.ts`
- `src/api/auth/connectors.ts`
- `src/api/discovery/discovery.ts`
- `src/api/companion.ts`
- `src/api/companion/bridges.ts`
- `src/api/companion/projectTracking.ts`
- `src/api/credentials/mcpGateways.ts`
- `src/api/credentials/scopedResources.ts`
- `src/api/signing/index.ts`
- `src/api/researchLab/researchLab.ts`
- `src/api/obsidianBrain/index.ts`

**Entry points:** src/api/agents/personas.ts, src/api/agents/buildSession.ts, src/api/agents/genome.ts

**Keywords:** persona, archetype, use-case, capability, icon, parameters, annotations, create, delete, duplicate, build, session

**API surface:** Tauri commands: create_persona, update_persona, delete_persona, duplicate_persona, list_archetypes, update_persona_parameters, sync_capability_parameters, add_annotation, upload_persona_icon

**Tech stack:** Tauri 2, TypeScript, React 19

---

### commands-core

Core CRUD surface for AI persona records — create, list, archive, restore, update, and bulk-delete personas. Commands enforce auth, lifecycle validation, and blast-radius checks before mutations. The DB repo layer (`personas`) is the primary dependency, with cross-reads into executions and automations for referential integrity. [Consolidated 2026-08-04: absorbed persona-icons, persona-jobs, persona-memory, persona-portability]

**Files:**
- `src-tauri/src/commands/core/personas.rs`
- `src-tauri/src/commands/core/validation.rs`
- `src-tauri/src/commands/core/gallery.rs`
- `src-tauri/src/commands/core/saved_views.rs`
- `src-tauri/src/commands/core/export_types.rs`
- `src-tauri/src/commands/core/mod.rs`
- `src-tauri/src/commands/core/persona_icons.rs`
- `src-tauri/src/commands/core/persona_icon_gen.rs`
- `src-tauri/src/commands/core/persona_jobs.rs`
- `src-tauri/src/commands/core/use_cases.rs`
- `src-tauri/src/commands/core/chat.rs`
- `src-tauri/src/commands/core/memories.rs`
- `src-tauri/src/commands/core/memory_compile.rs`
- `src-tauri/src/commands/core/import_export.rs`
- `src-tauri/src/commands/core/data_portability.rs`
- `src-tauri/src/commands/core/composition_workflows.rs`

**Entry points:** src-tauri/src/commands/core/personas.rs, src-tauri/src/commands/core/persona_icons.rs, src-tauri/src/commands/core/use_cases.rs

**Keywords:** persona, lifecycle, archive, gallery, saved-views, crud, blast-radius, icon, avatar, upload, generate, leonardo

**API surface:** list_personas, get_persona_detail, create_persona, update_persona, archive_persona, restore_persona, bulk_delete_personas

**Tech stack:** Tauri 2, Rust, SQLite, ts-rs

---

### companion-chat-bubbles

Message rendering components for the Athena chat transcript. Bubble renders individual assistant/user messages with streaming state; ApprovalCard and InlineChatCard surface structured assistant responses; ProactiveCard handles proactive nudges; ConversationSwitcher and BrainViewer provide conversation management and brain knowledge browsing. Drives the chat body layout visible to the user. [Consolidated 2026-08-04: absorbed companion-voice-output, companion-fleet-bridge, companion-voice-input]

**Files:**
- `src/features/plugins/companion/Bubble.tsx`
- `src/features/plugins/companion/InlineChatCard.tsx`
- `src/features/plugins/companion/ApprovalCard.tsx`
- `src/features/plugins/companion/ProactiveCard.tsx`
- `src/features/plugins/companion/QueuedMessages.tsx`
- `src/features/plugins/companion/QuickReplies.tsx`
- `src/features/plugins/companion/TypingDots.tsx`
- `src/features/plugins/companion/ConversationSwitcher.tsx`
- `src/features/plugins/companion/BrainViewer.tsx`
- `src/features/plugins/companion/__tests__/Bubble.test.tsx`
- `src/features/plugins/companion/sub_voice/VoicePanel.tsx`
- `src/features/plugins/companion/sub_voice/KokoroVoicePanel.tsx`
- `src/features/plugins/companion/sub_voice/PocketVoicePanel.tsx`
- `src/features/plugins/companion/sub_voice/voiceEngineShared.tsx`
- `src/features/plugins/companion/BubbleReadAloud.tsx`
- `src/features/plugins/companion/voicePlayback.ts`
- `src/features/plugins/companion/useTtsSettings.ts`
- `src/features/plugins/companion/useTtsVoiceSelection.ts`
- `src/features/plugins/companion/__tests__/BubbleReadAloud.test.tsx`
- `src/features/plugins/companion/useFleetCompanionBridge.ts`
- `src/features/plugins/companion/useCompanionAssignmentBridge.ts`
- `src/features/plugins/companion/useAthenaAssignmentReconciliation.ts`
- `src/features/plugins/companion/CompanionAssignmentCards.tsx`
- `src/features/plugins/companion/FleetBoldnessDial.tsx`
- `src/features/plugins/companion/WakeCadence.tsx`
- `src/features/plugins/companion/__tests__/useFleetCompanionBridge.test.tsx`
- `src/features/plugins/companion/__tests__/useCompanionAssignmentBridge.test.tsx`
- `src/features/plugins/companion/useSpeechInput.ts`
- `src/features/plugins/companion/useDictation.ts`
- `src/features/plugins/companion/useLocalDictation.ts`
- `src/features/plugins/companion/useHoldToTalk.ts`
- `src/features/plugins/companion/VoiceControlPopover.tsx`
- `src/features/plugins/companion/sub_voice/SttPanel.tsx`
- `src/features/plugins/companion/sub_voice/audioToReferenceWav.ts`

**Entry points:** src/features/plugins/companion/Bubble.tsx, src/features/plugins/companion/ConversationSwitcher.tsx, src/features/plugins/companion/sub_voice/VoicePanel.tsx

**Keywords:** bubble, message, approval, proactive, quick-replies, brain-viewer, conversation, chat, tts, text-to-speech, kokoro, sherpa-onnx

**Tech stack:** React 19, TypeScript, framer-motion, Tauri 2

---

### companion-core-store

Central Zustand store and routing configuration for the Athena companion plugin. Manages all companion UI state including panel open/close, multi-conversation threads, live turn state (streaming text, phase, beat), connector jobs, recall previews, narration timelines, guidance walkthroughs, and the decision layer. Entry point for all other companion contexts. [Consolidated 2026-08-04: absorbed companion-chat-panel]

**Files:**
- `src/features/plugins/companion/companionStore.ts`
- `src/features/plugins/companion/types.ts`
- `src/features/plugins/companion/companionRoutes.ts`
- `src/features/plugins/companion/athenaLabels.ts`
- `src/features/plugins/companion/__tests__/decisionStore.test.ts`
- `src/features/plugins/companion/__tests__/liveTurns.test.ts`
- `src/features/plugins/companion/CompanionPanel.tsx`
- `src/features/plugins/companion/CompanionPluginPage.tsx`
- `src/features/plugins/companion/CompanionFooterIcon.tsx`
- `src/features/plugins/companion/CompanionToolbar.tsx`
- `src/features/plugins/companion/WelcomeHero.tsx`

**Entry points:** src/features/plugins/companion/companionStore.ts, src/features/plugins/companion/CompanionPanel.tsx, src/features/plugins/companion/CompanionPluginPage.tsx

**Keywords:** companion, athena, store, zustand, conversation, streaming, live-turn, multiconv, state, panel, chat, tauri-events

**Tech stack:** React 19, TypeScript, Zustand 5, Tauri 2

---

### companion-narration-ops

In-chat progress transparency components that show what Athena is doing during and after a turn. NarrationThread renders live PROGRESS beats and the collapsed post-turn trail; OperationalThread shows the TodoWrite task checklist; ActivityTray surfaces background connector jobs; TurnSummaryChip, RecallStrip, BrainLinksStrip, ConnectorCallCard, and TaskTag provide per-bubble metadata strips. [Consolidated 2026-08-04: absorbed companion-stream-processing, companion-composer]

**Files:**
- `src/features/plugins/companion/NarrationThread.tsx`
- `src/features/plugins/companion/OperationalThread.tsx`
- `src/features/plugins/companion/DevOpLedger.tsx`
- `src/features/plugins/companion/ActivityTray.tsx`
- `src/features/plugins/companion/TurnSummaryChip.tsx`
- `src/features/plugins/companion/RecallStrip.tsx`
- `src/features/plugins/companion/BrainLinksStrip.tsx`
- `src/features/plugins/companion/ConnectorCallCard.tsx`
- `src/features/plugins/companion/TaskTag.tsx`
- `src/features/plugins/companion/__tests__/ActivityTray.test.tsx`
- `src/features/plugins/companion/__tests__/TurnSummaryChip.test.tsx`
- `src/features/plugins/companion/__tests__/RecallStrip.test.tsx`
- `src/features/plugins/companion/__tests__/ConnectorCallCard.test.tsx`
- `src/features/plugins/companion/extractStreamPhase.ts`
- `src/features/plugins/companion/extractAssistantText.ts`
- `src/features/plugins/companion/narrationTimeline.ts`
- `src/features/plugins/companion/midTurnIntent.ts`
- `src/features/plugins/companion/operationalSteps.ts`
- `src/features/plugins/companion/parseBrainLinks.ts`
- `src/features/plugins/companion/chime.ts`
- `src/features/plugins/companion/audioLevel.ts`
- `src/features/plugins/companion/__tests__/extractStreamPhase.test.ts`
- `src/features/plugins/companion/__tests__/narrationTimeline.test.ts`
- `src/features/plugins/companion/__tests__/midTurnIntent.test.tsx`
- `src/features/plugins/companion/__tests__/parseBrainLinks.test.ts`
- `src/features/plugins/companion/Composer.tsx`
- `src/features/plugins/companion/SlashPalette.tsx`
- `src/features/plugins/companion/RefineChips.tsx`
- `src/features/plugins/companion/useChatScroll.ts`
- `src/features/plugins/companion/useConversationRoster.ts`
- `src/features/plugins/companion/useSeedAthenaComposer.ts`
- `src/features/plugins/companion/useForwardToAthena.ts`
- `src/features/plugins/companion/__tests__/SlashPalette.test.tsx`
- `src/features/plugins/companion/__tests__/RefineChips.test.tsx`

**Entry points:** src/features/plugins/companion/NarrationThread.tsx, src/features/plugins/companion/ActivityTray.tsx, src/features/plugins/companion/extractStreamPhase.ts

**Keywords:** narration, operational-thread, todo, activity-tray, turn-summary, recall, connector-job, progress, stream, parsing, phase, todo-write

**Tech stack:** React 19, TypeScript, framer-motion, Zustand 5

---

### core-validation

Input validation for the Tauri IPC boundary: HTML/XSS stripping via ammonia, persona field constraints (name length, system prompt size, timeout clamping against engine limits), trigger schedule and webhook validation, chat message validation, memory content checks, and build-session contract verification. All validations return `AppError::Validation` so the frontend receives structured error messages. [Consolidated 2026-08-04: absorbed memory-knowledge-models, webhook-relay-models, core-retrieval, core-utilities]

**Files:**
- `src-tauri/core/src/validation/mod.rs`
- `src-tauri/core/src/validation/persona.rs`
- `src-tauri/core/src/validation/trigger.rs`
- `src-tauri/core/src/validation/chat.rs`
- `src-tauri/core/src/validation/memory.rs`
- `src-tauri/core/src/validation/contract.rs`
- `src-tauri/core/src/models/memory.rs`
- `src-tauri/core/src/models/knowledge.rs`
- `src-tauri/core/src/models/knowledge_base.rs`
- `src-tauri/core/src/models/webhook_log.rs`
- `src-tauri/core/src/models/smee_relay.rs`
- `src-tauri/core/src/retrieval/mod.rs`
- `src-tauri/core/src/utils/mod.rs`
- `src-tauri/core/src/utils/text.rs`
- `src-tauri/core/src/utils/sanitization.rs`

**Entry points:** src-tauri/core/src/validation/mod.rs, src-tauri/core/src/validation/persona.rs, src-tauri/core/src/models/memory.rs

**Keywords:** validation, XSS, HTML-sanitization, persona-constraints, trigger-validation, IPC-boundary, ammonia, memory, knowledge, knowledge-base, vector-store, injection

**Tech stack:** Rust, ammonia

---

### db-repos-core

Repository for the core Persona entity — CRUD for AI agent persona definitions, settings, saved views, design conversations, and curation scheduling. Personas are the fundamental unit of the app, representing AI agents with configured tools, connectors, system prompts, and behavioral settings. [Consolidated 2026-08-04: absorbed agent-memory-repo, build-session-repo]

**Files:**
- `src-tauri/db/src/repos/core/personas.rs`
- `src-tauri/db/src/repos/core/settings.rs`
- `src-tauri/db/src/repos/core/saved_views.rs`
- `src-tauri/db/src/repos/core/design_conversations.rs`
- `src-tauri/db/src/repos/core/curation_schedule.rs`
- `src-tauri/db/src/repos/core/mod.rs`
- `src-tauri/db/src/repos/core/memories.rs`
- `src-tauri/db/src/repos/core/memory_claims.rs`
- `src-tauri/db/src/repos/core/memory_review_proposal.rs`
- `src-tauri/db/src/memory_recall.rs`
- `src-tauri/db/src/repos/core/build_sessions.rs`
- `src-tauri/db/src/repos/core/frontend_crashes.rs`

**Entry points:** src-tauri/db/src/repos/core/personas.rs, src-tauri/db/src/repos/core/memories.rs, src-tauri/db/src/memory_recall.rs

**Keywords:** persona, agent, CRUD, settings, saved-views, design, curation, memory, recall, claims, proposals, review

**Tech stack:** Rust, rusqlite

---

### glyph-definitions

Static glyph data definition files, one per feature area, that describe how each feature's capabilities map onto the 8 sigil dimensions. Each file exports a GlyphRow[] or similar structure consumed by GlyphCard and related components to populate the sigil for coaching, feeds, goals, KPIs, rate-limiting, relay, roadmap routes, roadmap waypoints, and scope maps.

**Files:**
- `src/features/shared/glyph/glyphs/coachingGlyph.ts`
- `src/features/shared/glyph/glyphs/feedsGlyph.ts`
- `src/features/shared/glyph/glyphs/goalsGlyph.ts`
- `src/features/shared/glyph/glyphs/kpisGlyph.ts`
- `src/features/shared/glyph/glyphs/ratelimitGlyph.ts`
- `src/features/shared/glyph/glyphs/relayGlyph.ts`
- `src/features/shared/glyph/glyphs/roadmapRouteGlyph.ts`
- `src/features/shared/glyph/glyphs/roadmapWaypointGlyph.ts`
- `src/features/shared/glyph/glyphs/scopeMapGlyph.ts`

**Entry points:** src/features/shared/glyph/glyphs/coachingGlyph.ts

**Keywords:** glyph definition, coaching, feeds, goals, KPIs, relay, roadmap, scope map, dimensions

**Tech stack:** TypeScript

---

### persona-glyph-layout

The persona detail page layout system built around the sigil: PersonaLayout (three-mode layout — view/adoption/scratch — with two responsive sidebars and a hero column), PersonaHero (name + sigil hero band), PersonaSigilSummary (compact summary in hero), CapabilityTabBar (dimension switcher), PetalRow and UseCaseRow (dimension/use-case list rows), AddCapabilityRow (CTA for adding capabilities), SigilEditModal and its per-dimension body variants.

**Files:**
- `src/features/shared/glyph/persona-layout/index.ts`
- `src/features/shared/glyph/persona-layout/PersonaLayout.tsx`
- `src/features/shared/glyph/persona-layout/PersonaHero.tsx`
- `src/features/shared/glyph/persona-layout/PersonaSigilSummary.tsx`
- `src/features/shared/glyph/persona-layout/CapabilityTabBar.tsx`
- `src/features/shared/glyph/persona-layout/PetalRow.tsx`
- `src/features/shared/glyph/persona-layout/UseCaseRow.tsx`
- `src/features/shared/glyph/persona-layout/AddCapabilityRow.tsx`
- `src/features/shared/glyph/persona-layout/SigilEditModal.tsx`
- `src/features/shared/glyph/persona-layout/sigilEditBodies.tsx`

**Entry points:** src/features/shared/glyph/persona-layout/PersonaLayout.tsx, src/features/shared/glyph/persona-layout/index.ts

**Keywords:** persona layout, adoption, capability, hero, sigil edit, use case, tab bar, petal row

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### persona-shared-ui

Cross-cutting persona UI primitives reused throughout the agent feature: chat thread and message rendering, persona avatar, icon picker (popup, modal, selector), persona selector/modal for cross-persona references, column filter, and the inline quick-edit panel. These are not globally shared components but are domain-shared within the agents feature.

**Files:**
- `src/features/agents/components/ChatMessageContent.tsx`
- `src/features/agents/components/ChatThread.tsx`
- `src/features/agents/components/IconSelector.tsx`
- `src/features/agents/components/PersonaAvatar.tsx`
- `src/features/agents/components/PersonaColumnFilter.tsx`
- `src/features/agents/components/PersonaIcon.tsx`
- `src/features/agents/components/PersonaIconPickerModal.tsx`
- `src/features/agents/components/PersonaSelector.tsx`
- `src/features/agents/components/PersonaSelectorModal.tsx`
- `src/features/agents/components/PopupIconSelector.tsx`
- `src/features/agents/components/QuickEditPanel.tsx`

**Entry points:** src/features/agents/components/PersonaSelector.tsx, src/features/agents/components/ChatThread.tsx

**Keywords:** avatar, icon, chat, thread, message, selector, picker, quick-edit, filter

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### plugins-companion-decision

Hands-free decision layer that surfaces single numbered-choice prompts above the orb for the user to resolve approvals, human-review items, and incidents without opening the full panel. useDecisionQueue aggregates sources and feeds items one-at-a-time; resolveDecision maps Tauri events to PendingDecision shapes; parseSpokenDecision extracts digit picks from voice input. DecisionsPanel is the manager tab for reviewing design decisions. [Consolidated 2026-08-04: absorbed companion-orb, companion-orchestration, companion-setup]

**Files:**
- `src/features/plugins/companion/decision/parseSpokenDecision.ts`
- `src/features/plugins/companion/decision/resolveDecision.ts`
- `src/features/plugins/companion/decision/types.ts`
- `src/features/plugins/companion/decision/useDecisionQueue.ts`
- `src/features/plugins/companion/sub_decisions/DecisionsPanel.tsx`
- `src/features/plugins/companion/sub_decisions/sharedBlocks.tsx`
- `src/features/plugins/companion/sub_decisions/useDesignDecisions.ts`
- `src/features/plugins/companion/__tests__/decisionExplain.test.ts`
- `src/features/plugins/companion/__tests__/parseSpokenDecision.test.ts`
- `src/features/plugins/companion/sub_decisions/__tests__/DecisionsPanel.test.tsx`
- `src/features/plugins/companion/orb/AthenaOrb.tsx`
- `src/features/plugins/companion/orb/AthenaOrbLayer.tsx`
- `src/features/plugins/companion/orb/AthenaGuideLayer.tsx`
- `src/features/plugins/companion/orb/TrackedGlowRing.tsx`
- `src/features/plugins/companion/orb/GuideCaption.tsx`
- `src/features/plugins/companion/orb/OrbDecisionBubble.tsx`
- `src/features/plugins/companion/AthenaAvatar.tsx`
- `src/features/plugins/companion/orchestration/LiveOpsStrip.tsx`
- `src/features/plugins/companion/orchestration/operativeMemoryStore.ts`
- `src/features/plugins/companion/orchestration/parseDigest.ts`
- `src/features/plugins/companion/orchestration/useOperativeMemoryBridge.ts`
- `src/features/plugins/companion/orchestration/__tests__/parseDigest.test.ts`
- `src/features/plugins/companion/__tests__/useOperativeMemoryBridge.test.tsx`
- `src/features/plugins/companion/sub_setup/BrowserBridgePanel.tsx`
- `src/features/plugins/companion/sub_setup/SensorySignalsModal.tsx`
- `src/features/plugins/companion/sub_setup/SetupPanel.tsx`
- `src/features/plugins/companion/sub_memory/ConsolidationReview.tsx`
- `src/features/plugins/companion/sub_memory/MemoryPanel.tsx`

**Entry points:** src/features/plugins/companion/decision/useDecisionQueue.ts, src/features/plugins/companion/sub_decisions/DecisionsPanel.tsx, src/features/plugins/companion/orb/AthenaOrb.tsx

**Keywords:** decision, approval, human-review, orb-bubble, spoken-decision, design-decisions, queue, orb, athena, floating, glow, walkthrough

**Tech stack:** React 19, TypeScript, Zustand 5

---

### plugins-companion-inbox

Data-shape adapters that normalize diverse backend event types (approval requests, execution outputs, healing events, messages) into the unified inbox item format. Shared utilities provide tone classification and grapheme counting for item rendering. The adapter index exports the full adapter registry consumed by useUnifiedInbox. [Consolidated 2026-08-04: absorbed companion-inbox-hooks, companion-guidance, companion-mcp]

**Files:**
- `src/features/plugins/companion/inbox/_shared/grapheme.ts`
- `src/features/plugins/companion/inbox/_shared/inboxKindIcon.ts`
- `src/features/plugins/companion/inbox/_shared/inboxTone.ts`
- `src/features/plugins/companion/inbox/hooks/adapters/approvalAdapter.ts`
- `src/features/plugins/companion/inbox/hooks/adapters/healingAdapter.ts`
- `src/features/plugins/companion/inbox/hooks/adapters/index.ts`
- `src/features/plugins/companion/inbox/hooks/adapters/messageAdapter.ts`
- `src/features/plugins/companion/inbox/hooks/adapters/outputAdapter.ts`
- `src/features/plugins/companion/inbox/hooks/adapters/types.ts`
- `src/features/plugins/companion/inbox/types.ts`
- `src/features/plugins/companion/inbox/hooks/adapters/outputAdapter.test.ts`
- `src/features/plugins/companion/inbox/hooks/useCockpitSummary.ts`
- `src/features/plugins/companion/inbox/hooks/useIllustration.ts`
- `src/features/plugins/companion/inbox/hooks/useInboxActions.ts`
- `src/features/plugins/companion/inbox/hooks/useUnifiedInbox.ts`
- `src/features/plugins/companion/inbox/utils/formatRelativeTime.ts`
- `src/features/plugins/companion/inbox/hooks/useCockpitSummary.test.ts`
- `src/features/plugins/companion/inbox/hooks/useIllustration.test.ts`
- `src/features/plugins/companion/inbox/hooks/useUnifiedInbox.test.ts`
- `src/features/plugins/companion/inbox/utils/formatRelativeTime.test.ts`
- `src/features/plugins/companion/guidance/anchorCatalog.ts`
- `src/features/plugins/companion/guidance/appActions.ts`
- `src/features/plugins/companion/guidance/composeAdHoc.ts`
- `src/features/plugins/companion/guidance/types.ts`
- `src/features/plugins/companion/guidance/useGuidanceRunner.ts`
- `src/features/plugins/companion/guidance/walkthroughs.ts`
- `src/features/plugins/companion/guidance/__tests__/guidance.test.ts`
- `src/features/plugins/companion/mcp/McpRequestPanel.tsx`
- `src/features/plugins/companion/mcp/mcpRequestStore.ts`
- `src/features/plugins/companion/mcp/useMcpRequestBridge.ts`
- `src/features/plugins/companion/mcp/__tests__/McpRequestPanel.test.tsx`
- `src/features/plugins/companion/__tests__/useMcpRequestBridge.test.tsx`

**Entry points:** src/features/plugins/companion/inbox/hooks/adapters/index.ts, src/features/plugins/companion/inbox/types.ts, src/features/plugins/companion/inbox/hooks/useUnifiedInbox.ts

**Keywords:** inbox, adapter, approval, healing, message, output, tone, grapheme, normalization, unified-inbox, cockpit-summary, illustration

**Tech stack:** TypeScript

---

### prompt-assembly-engine

Assembles the full system prompt injected into every Claude CLI execution, composing persona instructions, connector hints, memory, capabilities, runtime safety rules, and CLI arguments. Submodules handle: templates (base system-prompt sections), variables ({{param.KEY}} substitution), capabilities (tool/connector hints), advisory (policy advisory blocks), cli_args (flag construction), resume_prompt (session continuation context), and runtime_safety (guardrail injections).

**Files:**
- `src-tauri/engine/src/prompt/mod.rs`
- `src-tauri/engine/src/prompt/templates.rs`
- `src-tauri/engine/src/prompt/variables.rs`
- `src-tauri/engine/src/prompt/capabilities.rs`
- `src-tauri/engine/src/prompt/advisory.rs`
- `src-tauri/engine/src/prompt/cli_args.rs`
- `src-tauri/engine/src/prompt/resume_prompt.rs`
- `src-tauri/engine/src/prompt/runtime_safety.rs`

**Entry points:** src-tauri/engine/src/prompt/mod.rs

**Keywords:** prompt, system-prompt, assembly, variables, capabilities, CLI-args, safety, memory-injection

**Tech stack:** Rust

---

### recipe-build-models

Domain types for the Design & Build Studio: `RecipeDefinition` (parameterised action templates with input_schema and `{{param}}` interpolation), `RecipeSuggestion` (AI-proposed recipes from execution analysis), `BuildSession` and `BuildPhase` (LLM-driven persona construction state machine), `CompositionWorkflow` (multi-step composition orchestration), `DesignConversation` (structured design-time dialogue), and `TemplateFeedback` (user ratings on persona templates). [Consolidated 2026-08-04: absorbed persona-genome-models, automation-event-models, lab-quality-models, team-collaboration-models, core-model-primitives, execution-state-models]

**Files:**
- `src-tauri/core/src/models/recipe.rs`
- `src-tauri/core/src/models/recipe_suggestion.rs`
- `src-tauri/core/src/models/build_session.rs`
- `src-tauri/core/src/models/composition_workflow.rs`
- `src-tauri/core/src/models/design_conversation.rs`
- `src-tauri/core/src/models/template_feedback.rs`
- `src-tauri/core/src/models/persona.rs`
- `src-tauri/core/src/models/persona_change_log.rs`
- `src-tauri/core/src/models/genome.rs`
- `src-tauri/core/src/models/agent_ir.rs`
- `src-tauri/core/src/models/platform_definition.rs`
- `src-tauri/core/src/models/evolution.rs`
- `src-tauri/core/src/models/automation.rs`
- `src-tauri/core/src/models/trigger.rs`
- `src-tauri/core/src/models/event.rs`
- `src-tauri/core/src/models/shared_event.rs`
- `src-tauri/core/src/models/notification_subscription.rs`
- `src-tauri/core/src/models/lab.rs`
- `src-tauri/core/src/models/test_run.rs`
- `src-tauri/core/src/models/test_suite.rs`
- `src-tauri/core/src/models/output_assertion.rs`
- `src-tauri/core/src/models/sla.rs`
- `src-tauri/core/src/models/team.rs`
- `src-tauri/core/src/models/team_assignment.rs`
- `src-tauri/core/src/models/team_channel.rs`
- `src-tauri/core/src/models/team_memory.rs`
- `src-tauri/core/src/models/team_preset.rs`
- `src-tauri/core/src/models/mod.rs`
- `src-tauri/core/src/models/db_schema.rs`
- `src-tauri/core/src/models/json_column.rs`
- `src-tauri/core/src/models/serde_util.rs`
- `src-tauri/core/src/models/execution.rs`
- `src-tauri/core/src/models/execution_annotation.rs`
- `src-tauri/core/src/models/system_op.rs`

**Entry points:** src-tauri/core/src/models/recipe.rs, src-tauri/core/src/models/build_session.rs, src-tauri/core/src/models/persona.rs

**Keywords:** recipe, build-session, composition, design, template, parameter, workflow, persona-factory, persona, genome, evolution, breeding

**Tech stack:** Rust, serde, ts-rs

---

### shared-glyph

Core building blocks of the 8-petal sigil visual language: the root public API index, the canonical GlyphDimension/GlyphRow/GlyphPresence type system, CapabilitySigil (single-capability sigil with empty variant), InteractiveSigil (clickable/hoverable canvas wrapper), SigilPetal (individual SVG petal element), SigilLegend (dimension key), SVG pattern definitions for petal fill styles, layout helper math (stackOffset), dimensional metadata (DIM_META, PETAL_ANGLES), and the aura/glow art layer. [Consolidated 2026-08-04: absorbed glyph-card-display, glyph-utilities]

**Files:**
- `src/features/shared/glyph/index.ts`
- `src/features/shared/glyph/types.ts`
- `src/features/shared/glyph/CapabilitySigil.tsx`
- `src/features/shared/glyph/InteractiveSigil.tsx`
- `src/features/shared/glyph/SigilPetal.tsx`
- `src/features/shared/glyph/SigilLegend.tsx`
- `src/features/shared/glyph/dimPatterns.tsx`
- `src/features/shared/glyph/dimMeta.ts`
- `src/features/shared/glyph/helpers.ts`
- `src/features/shared/glyph/dimArt/DimAuras.tsx`
- `src/features/shared/glyph/GlyphCard.tsx`
- `src/features/shared/glyph/GlyphGrid.tsx`
- `src/features/shared/glyph/GlyphQuestionPanel.tsx`
- `src/features/shared/glyph/DimensionPanel.tsx`
- `src/features/shared/glyph/ChannelTotem.tsx`
- `src/features/shared/glyph/ConnectorTotem.tsx`
- `src/features/shared/glyph/ModelBadge.tsx`
- `src/features/shared/glyph/channels.ts`
- `src/features/shared/glyph/cron.ts`
- `src/features/shared/glyph/triggers.ts`

**Entry points:** src/features/shared/glyph/index.ts, src/features/shared/glyph/types.ts, src/features/shared/glyph/GlyphCard.tsx

**Keywords:** sigil, petal, dimension, glyph, SVG, pattern, aura, capability, interactive, glyph card, grid, totem

**Tech stack:** React 19, TypeScript, SVG

---

### stores-slices-agents

Slices supporting the Agent Lab feature for offline experimentation, A/B matrix builds, manual test runs, tool configuration, budget limits, and scheduled health checks. The lab slice fetches historical runs; matrix build slice coordinates multi-model variant generation. [Consolidated 2026-08-04: absorbed agent-chat-state, agent-execution-state]

**Files:**
- `src/stores/slices/agents/labSlice.ts`
- `src/stores/slices/agents/matrixBuildSlice.ts`
- `src/stores/slices/agents/testSlice.ts`
- `src/stores/slices/agents/toolSlice.ts`
- `src/stores/slices/agents/healthCheckSlice.ts`
- `src/stores/slices/agents/budgetEnforcementSlice.ts`
- `src/stores/slices/agents/__tests__/labSlice.fetchRuns.test.ts`
- `src/stores/__tests__/labSlice.cancel.test.ts`
- `src/stores/__tests__/matrixBuildSlice.test.ts`
- `src/stores/slices/agents/chatSlice.ts`
- `src/stores/slices/agents/backgroundChatSlice.ts`
- `src/stores/slices/agents/miniPlayerSlice.ts`
- `src/stores/slices/agents/executionSlice.ts`
- `src/stores/slices/agents/runLifecycle.ts`
- `src/stores/slices/agents/__tests__/runLifecycle.test.ts`

**Entry points:** src/stores/slices/agents/labSlice.ts, src/stores/slices/agents/matrixBuildSlice.ts, src/stores/slices/agents/chatSlice.ts

**Keywords:** lab, matrix, test, tool, healthCheck, budget, experiment, variants, abort, chat, session, message

**Tech stack:** Zustand 5, TypeScript, Tauri IPC

---

### stores-util

Top-level Zustand store that composes all agent-domain slices into a single persisted store. It wires persona selection, chat mode, and active chat session ID into localStorage via a deduped JSON storage adapter. Migration logic handles renamed chatMode values across releases. [Consolidated 2026-08-04: absorbed agent-persona-state]

**Files:**
- `src/stores/agentStore.ts`
- `src/stores/storeTypes.ts`
- `src/stores/__tests__/agentStore.merge.test.ts`
- `src/stores/util/dedupedStorage.ts`
- `src/stores/util/dedupedStorage.test.ts`
- `src/stores/util/latestWins.ts`
- `src/stores/slices/agents/personaSlice.ts`
- `src/stores/selectors/personaSelectors.ts`
- `src/stores/__tests__/personaStore.test.ts`

**Entry points:** src/stores/agentStore.ts, src/stores/storeTypes.ts, src/stores/slices/agents/personaSlice.ts

**Keywords:** zustand, store, persist, agent, slice, compose, chatMode, selectedPersonaId, persona, selectedPersona, detailCache, create

**Tech stack:** Zustand 5, TypeScript, React 19

---

## Execution Engine

> **Group type:** feature
> **Color:** emerald

### agents-executions-components

Paginated execution history list with filtering, bulk rerun, cost sparklines, and a side-by-side comparison view for two selected executions. The ExecutionList drives useExecutionList for data fetching; ComparisonTable/Diff/Metrics delegate to a Web Worker for heavy diff computation; BulkRerun manages multi-select requeue flows. [Consolidated 2026-08-04: absorbed execution-trace-primitives]

**Files:**
- `src/features/agents/sub_executions/components/list/ExecutionList.tsx`
- `src/features/agents/sub_executions/components/list/ExecutionListFilters.tsx`
- `src/features/agents/sub_executions/components/list/ExecutionListRow.tsx`
- `src/features/agents/sub_executions/components/list/ExecutionValueBadges.tsx`
- `src/features/agents/sub_executions/components/list/CostSparkline.tsx`
- `src/features/agents/sub_executions/components/list/ExecutionComparison.tsx`
- `src/features/agents/sub_executions/components/list/ComparisonTable.tsx`
- `src/features/agents/sub_executions/components/list/ComparisonDiff.tsx`
- `src/features/agents/sub_executions/components/list/ComparisonMetrics.tsx`
- `src/features/agents/sub_executions/components/list/BulkRerunStrip.tsx`
- `src/features/agents/sub_executions/components/list/BulkRerunToolbar.tsx`
- `src/features/agents/sub_executions/components/list/BulkRerunReport.tsx`
- `src/features/agents/sub_executions/libs/useExecutionList.ts`
- `src/features/agents/sub_executions/libs/useBulkRerun.ts`
- `src/features/agents/sub_executions/libs/comparisonHelpers.ts`
- `src/features/agents/sub_executions/libs/comparisonDiffWorkerClient.ts`
- `src/features/agents/sub_executions/libs/executionStatus.ts`
- `src/features/agents/sub_executions/trace/StageBar.tsx`
- `src/features/agents/sub_executions/trace/SubSpanBar.tsx`
- `src/features/agents/sub_executions/trace/SyntheticTrace.ts`
- `src/features/agents/sub_executions/trace/stageColors.ts`
- `src/features/agents/sub_executions/components/ActiveChainsBadge.tsx`
- `src/features/agents/sub_executions/components/AnnotationEditor.tsx`
- `src/features/agents/sub_executions/components/CancelledResumeFooter.tsx`
- `src/features/agents/sub_executions/components/CircuitBreakerIndicator.tsx`
- `src/features/agents/sub_executions/components/ExecutionLifecycleIcons.tsx`
- `src/features/agents/sub_executions/libs/traceHelpers.ts`
- `src/features/agents/sub_executions/libs/useChainTrace.ts`
- `src/features/agents/sub_executions/workers/comparisonDiff.worker.ts`
- `src/features/agents/sub_executions/index.ts`

**Entry points:** src/features/agents/sub_executions/components/list/ExecutionList.tsx, src/features/agents/sub_executions/libs/useExecutionList.ts, src/features/agents/sub_executions/trace/SyntheticTrace.ts

**Keywords:** execution, history, list, filter, comparison, bulk-rerun, cost, diff, sparkline, trace, span, stage

**API surface:** list_executions, rerun_executions

**Tech stack:** React 19, TypeScript, Zustand 5, Web Workers

---

### byom-provider-settings

Implements the 'Bring Your Own Model' policy layer for enterprise and power users: controls which AI providers (Anthropic Claude, Qwen, etc.) are allowed or blocked, manages per-provider API keys with credential storage, defines task-complexity-based routing rules (simple/complex task → specific provider), enforces workflow-tag compliance rules restricting which providers certain tagged workflows may use, and renders a provider audit log with usage sparklines and timeseries charts. State is managed by useByomSettings which batches IPC calls to the system/byom Rust module.

**Files:**
- `src/features/settings/sub_byom/index.ts`
- `src/features/settings/sub_byom/components/ByomApiKeyManager.tsx`
- `src/features/settings/sub_byom/components/ByomAuditLog.tsx`
- `src/features/settings/sub_byom/components/ByomComplianceRules.tsx`
- `src/features/settings/sub_byom/components/ByomProviderList.tsx`
- `src/features/settings/sub_byom/components/ByomRoutingRules.tsx`
- `src/features/settings/sub_byom/components/ByomSettings.tsx`
- `src/features/settings/sub_byom/libs/byomHelpers.ts`
- `src/features/settings/sub_byom/libs/useByomSettings.ts`

**Entry points:** src/features/settings/sub_byom/components/ByomSettings.tsx, src/features/settings/sub_byom/libs/useByomSettings.ts

**Keywords:** BYOM, provider, routing, compliance, API-key, Qwen, Anthropic, model-policy, audit-log, usage

**API surface:** getByomPolicy, setByomPolicy, deleteByomPolicy, listProviderAuditLog, getProviderUsageStats, getProviderUsageTimeseries, testProviderConnection; getQwenStatus, setQwenCredentials, clearQwenCredentials

**Tech stack:** React 19, TypeScript, Zustand 5, Tauri 2

---

### commands-execution

Lab, testing, and knowledge-management commands for persona execution experiments — prompt-variant experiments, assertion suites, test-suite management, and the persona knowledge base (retrieved context injected at execution time). Enables iterative prompt engineering and quality gating. [Consolidated 2026-08-04: absorbed eval-runs, execution-core, execution-healing]

**Files:**
- `src-tauri/src/commands/execution/lab.rs`
- `src-tauri/src/commands/execution/tests.rs`
- `src-tauri/src/commands/execution/test_suites.rs`
- `src-tauri/src/commands/execution/assertions.rs`
- `src-tauri/src/commands/execution/knowledge.rs`
- `src-tauri/src/commands/eval_runs.rs`
- `src-tauri/src/commands/execution/audit_incidents.rs`
- `src-tauri/src/commands/execution/annotations.rs`
- `src-tauri/src/commands/execution/clipboard_intel.rs`
- `src-tauri/src/commands/execution/executions.rs`
- `src-tauri/src/commands/execution/scheduler.rs`
- `src-tauri/src/commands/execution/ambient.rs`
- `src-tauri/src/commands/execution/mod.rs`
- `src-tauri/src/commands/execution/healing.rs`
- `src-tauri/src/commands/execution/evolution.rs`
- `src-tauri/src/commands/execution/genome.rs`
- `src-tauri/src/commands/execution/policy_events.rs`

**Entry points:** src-tauri/src/commands/execution/lab.rs, src-tauri/src/commands/eval_runs.rs, src-tauri/src/commands/execution/executions.rs

**Keywords:** lab, test, assertion, knowledge, experiment, prompt, variant, eval, evaluation, audit, incident, annotation

**API surface:** run_lab_experiment, list_test_suites, run_assertions, list_knowledge_entries

**Tech stack:** Tauri 2, Rust, SQLite

---

### db-repos-execution

Core repository for persona execution records — stores every run of a persona (status, token usage, cost, duration, tool calls, output), supports full-text search via FTS5, and provides the query surface for the executions dashboard and observability features. The most frequently read table in the system. [Consolidated 2026-08-04: absorbed audit-incidents-repo, healing-repo, testing-quality-repo, recipes-repo, identity-oauth-repo]

**Files:**
- `src-tauri/db/src/repos/execution/executions.rs`
- `src-tauri/db/src/repos/execution/traces.rs`
- `src-tauri/db/src/repos/execution/tool_usage.rs`
- `src-tauri/db/src/repos/execution/annotations.rs`
- `src-tauri/db/src/repos/execution/mod.rs`
- `src-tauri/db/src/repos/execution/audit_incidents.rs`
- `src-tauri/db/src/audit_incidents_promoter.rs`
- `src-tauri/db/src/repos/execution/policy_events.rs`
- `src-tauri/db/src/repos/execution/provider_audit.rs`
- `src-tauri/db/src/repos/execution/healing.rs`
- `src-tauri/db/src/repos/execution/circuit_breaker.rs`
- `src-tauri/db/src/repos/execution/scheduled_retries.rs`
- `src-tauri/db/src/repos/execution/chain_stop_reasons.rs`
- `src-tauri/db/src/repos/execution/test_suites.rs`
- `src-tauri/db/src/repos/execution/test_runs.rs`
- `src-tauri/db/src/repos/execution/assertions.rs`
- `src-tauri/db/src/quality_gate.rs`
- `src-tauri/db/src/repos/resources/recipes.rs`
- `src-tauri/db/src/repos/resources/recipe_suggestions.rs`
- `src-tauri/db/src/repos/resources/credential_recipes.rs`
- `src-tauri/db/src/repos/resources/identity.rs`
- `src-tauri/db/src/repos/resources/oauth_token_metrics.rs`

**Entry points:** src-tauri/db/src/repos/execution/executions.rs, src-tauri/db/src/repos/execution/audit_incidents.rs, src-tauri/db/src/audit_incidents_promoter.rs

**Keywords:** executions, runs, traces, tool-usage, FTS5, observability, cost, tokens, audit, incidents, policy, violations

**Tech stack:** Rust, rusqlite

---

### execution-detail-inspector

Deep-dive execution detail view presenting a waterfall trace inspector, subagent tree, tool-call cards, cost breakdown bar, span rows, log viewer, memory viewer, summary card, and chain-trace view for chained persona runs. ErrorExplanationCard surfaces Athena-generated explanations for failed executions. The TraceInspector is the primary entry point.

**Files:**
- `src/features/agents/sub_executions/detail/ExecutionDetail.tsx`
- `src/features/agents/sub_executions/detail/ExecutionDetailContent.tsx`
- `src/features/agents/sub_executions/detail/ExecutionDetailTabs.tsx`
- `src/features/agents/sub_executions/detail/ErrorExplanationCard.tsx`
- `src/features/agents/sub_executions/detail/executionDetailTypes.ts`
- `src/features/agents/sub_executions/detail/inspector/ExecutionInspector.tsx`
- `src/features/agents/sub_executions/detail/inspector/TraceInspector.tsx`
- `src/features/agents/sub_executions/detail/inspector/TraceSummary.tsx`
- `src/features/agents/sub_executions/detail/inspector/WaterfallBar.tsx`
- `src/features/agents/sub_executions/detail/inspector/SpanRow.tsx`
- `src/features/agents/sub_executions/detail/inspector/SubagentTree.tsx`
- `src/features/agents/sub_executions/detail/inspector/ToolCallCard.tsx`
- `src/features/agents/sub_executions/detail/inspector/HighlightedJsonBlock.tsx`
- `src/features/agents/sub_executions/detail/inspector/CostBreakdownBar.tsx`
- `src/features/agents/sub_executions/detail/inspector/inspectorShared.tsx`
- `src/features/agents/sub_executions/detail/inspector/inspectorTypes.ts`
- `src/features/agents/sub_executions/detail/inspector/traceInspectorTypes.ts`
- `src/features/agents/sub_executions/detail/inspector/useTraceData.ts`
- `src/features/agents/sub_executions/detail/views/ExecutionLogViewer.tsx`
- `src/features/agents/sub_executions/detail/views/ExecutionMemories.tsx`
- `src/features/agents/sub_executions/detail/views/ExecutionSummaryCard.tsx`
- `src/features/agents/sub_executions/detail/chain/ChainTraceView.tsx`
- `src/features/agents/sub_executions/detail/chain/ChainSpanRow.tsx`

**Entry points:** src/features/agents/sub_executions/detail/ExecutionDetail.tsx, src/features/agents/sub_executions/detail/inspector/TraceInspector.tsx

**Keywords:** trace, inspector, waterfall, span, subagent, tool-call, cost, chain, logs, memories

**API surface:** get_execution_trace, get_execution_detail

**Tech stack:** React 19, TypeScript, Tauri 2

---

### execution-replay

Time-scrubbing replay sandbox for reviewing a past execution as if it were happening live. Provides transport controls (play/pause/seek), a pipeline waterfall, terminal replay panel, tool panel, cost accrual overlay, and a cost replay panel. The ReplaySandbox orchestrates replay state via useReplayState.

**Files:**
- `src/features/agents/sub_executions/replay/ReplaySandbox.tsx`
- `src/features/agents/sub_executions/replay/ReplayTransportControls.tsx`
- `src/features/agents/sub_executions/replay/TimelineScrubber.tsx`
- `src/features/agents/sub_executions/replay/ReplayTerminalPanel.tsx`
- `src/features/agents/sub_executions/replay/ReplayToolPanel.tsx`
- `src/features/agents/sub_executions/replay/PipelineWaterfall.tsx`
- `src/features/agents/sub_executions/replay/PipelineSummary.tsx`
- `src/features/agents/sub_executions/replay/ReplayCostPanel.tsx`
- `src/features/agents/sub_executions/replay/CostAccrualOverlay.tsx`
- `src/features/agents/sub_executions/libs/useReplayState.ts`

**Entry points:** src/features/agents/sub_executions/replay/ReplaySandbox.tsx, src/features/agents/sub_executions/libs/useReplayState.ts

**Keywords:** replay, scrub, timeline, transport, waterfall, pipeline, terminal, cost, sandbox

**Tech stack:** React 19, TypeScript, Zustand 5

---

### hooks-execution

Core hooks for consuming live execution output from the Tauri backend as it streams. Handles persona-owned output filtering, correlated CLI stream pairing, structured stream parsing with typed handlers, execution scope detection, and per-execution summary aggregation. The primary integration point between the Tauri execution engine IPC and React UI components such as ChatTab and PersonaRunner. [Consolidated 2026-08-04: absorbed execution-monitoring-hooks]

**Files:**
- `src/hooks/execution/useExecutionStream.ts`
- `src/hooks/execution/useCorrelatedCliStream.ts`
- `src/hooks/execution/useStructuredStream.ts`
- `src/hooks/execution/usePersonaExecution.ts`
- `src/hooks/execution/useExecutionScope.ts`
- `src/hooks/execution/useExecutionSummary.ts`
- `src/hooks/execution/useActivityMonitor.ts`
- `src/hooks/execution/useFileChanges.ts`
- `src/hooks/execution/useSystemTrace.ts`
- `src/hooks/execution/useReasoningTrace.ts`
- `src/hooks/execution/useReplayTimeline.ts`
- `src/hooks/execution/useAiHealingStream.ts`

**Entry points:** src/hooks/execution/useExecutionStream.ts, src/hooks/execution/usePersonaExecution.ts, src/hooks/execution/useActivityMonitor.ts

**Keywords:** execution, streaming, CLI, output, structured, scope, summary, persona-runner, activity, file-changes, system-trace, healing

**Tech stack:** React 19, TypeScript, Tauri 2, Zustand 5

---

### hooks-realtime

Provides singleton Tauri event bus subscriptions shared across the UI so only one native listener is registered per channel. Covers the main PersonaEvent bus, run-scoped events, message-created events, animated event rendering, timeline replay, event coloring, Smee relay status, cloud webhook relay, and deployment event emission. Uses a createSingletonListener factory to avoid duplicate subscriptions when multiple components mount. [Consolidated 2026-08-04: absorbed agent-list-hooks, lab-testing-hooks, overview-dashboard-hooks, sidebar-chrome-hooks, theming-platform-hooks]

**Files:**
- `src/hooks/realtime/createSingletonListener.ts`
- `src/hooks/realtime/useEventBusListener.ts`
- `src/hooks/realtime/useRunEventListener.ts`
- `src/hooks/realtime/useMessageCreatedListener.ts`
- `src/hooks/realtime/useRealtimeEvents.ts`
- `src/hooks/realtime/useAnimatedEvents.ts`
- `src/hooks/realtime/useTimelineReplay.ts`
- `src/hooks/realtime/useEventPhaseProgressor.ts`
- `src/hooks/realtime/useEventColor.ts`
- `src/hooks/realtime/useSmeeRelayStatus.ts`
- `src/hooks/realtime/useCloudWebhookRelay.ts`
- `src/hooks/realtime/emitDeploymentEvent.ts`
- `src/hooks/agents/useRecentAgents.ts`
- `src/hooks/agents/useFavoriteAgents.ts`
- `src/hooks/agents/usePrefetchOnHover.ts`
- `src/hooks/agents/usePersonaPicklist.ts`
- `src/hooks/agents/useExecutionAnnotations.ts`
- `src/hooks/usePersonaNameMap.ts`
- `src/hooks/lab/useLabEvents.ts`
- `src/hooks/lab/useToggleSet.ts`
- `src/hooks/tests/usePersonaTests.ts`
- `src/hooks/overview/useExecutionDashboardPipeline.ts`
- `src/hooks/sidebar/useSidebarAgentActivity.ts`
- `src/hooks/sidebar/useCodebasePersonas.ts`
- `src/hooks/sidebar/useWhatsNewIndicator.ts`
- `src/hooks/sidebar/useBadgeCounts.ts`
- `src/hooks/navigation/useBreadcrumbTrail.ts`
- `src/hooks/theming/usePersonaVibe.ts`
- `src/hooks/utility/useDocumentVisibility.ts`
- `src/hooks/utility/useElementVisible.ts`
- `src/hooks/utility/useTerminalClassification.ts`
- `src/hooks/utility/useTimeOfDay.ts`

**Entry points:** src/hooks/realtime/createSingletonListener.ts, src/hooks/realtime/useEventBusListener.ts, src/hooks/realtime/useRealtimeEvents.ts

**Keywords:** event-bus, realtime, singleton, PersonaEvent, webhook, relay, smee, animated-events, timeline, deployment, persona, agent

**API surface:** Tauri event channel: event-bus, run-events, message-created

**Tech stack:** React 19, TypeScript, Tauri 2

---

### lib-execution

Implements and registers all pipeline middleware that run at specific stage boundaries: knowledge-graph guidance injection (validate stage), audit logging (create_record + finalize_status), Sentry telemetry capture (finalize_status), stage-timing persistence to localStorage (frontend_complete), storeBus notification emission (frontend_complete), budget-cache invalidation (frontend_complete), and design-drift detection comparing execution outcomes against persona design expectations (frontend_complete). The central index.ts wires all middleware in priority order at app startup. [Consolidated 2026-08-04: absorbed execution-pipeline-core]

**Files:**
- `src/lib/execution/knowledgeMiddleware.ts`
- `src/lib/execution/middleware/index.ts`
- `src/lib/execution/middleware/auditMiddleware.ts`
- `src/lib/execution/middleware/budgetMiddleware.ts`
- `src/lib/execution/middleware/driftMiddleware.ts`
- `src/lib/execution/middleware/notificationMiddleware.ts`
- `src/lib/execution/middleware/analyticsMiddleware.ts`
- `src/lib/execution/middleware/timingMiddleware.ts`
- `src/lib/execution/pipeline.ts`
- `src/lib/execution/executionState.ts`
- `src/lib/execution/executionSink.ts`
- `src/lib/execution/systemTrace.ts`

**Entry points:** src/lib/execution/middleware/index.ts, src/lib/execution/knowledgeMiddleware.ts, src/lib/execution/pipeline.ts

**Keywords:** middleware, drift-detection, budget, audit, analytics, telemetry, knowledge-injection, notification, stage-timing, sentry, pipeline, execution

**API surface:** getKnowledgeInjection API call; Sentry captureMessage; storeBus execution:completed event

**Tech stack:** TypeScript, Zustand 5, Sentry

---

### test-runner-lab

Generates LLM-driven test scenarios for personas and runs them against model variants in the Lab. The test_runner module spawns Claude CLI in headless mode to generate and execute test scenarios with TTL-based caching; eval drives structured evaluation runs; output_assertions checks execution outputs against declared assertions; verification_command provides a structured command type for post-execution verification steps. [Consolidated 2026-08-04: absorbed execution-queue-scheduler, execution-resilience, execution-telemetry, kpi-and-goals, persona-capability-blueprint, persona-evolution, skills-hooks-sidecar, bundle-and-sharing]

**Files:**
- `src-tauri/engine/src/test_runner.rs`
- `src-tauri/engine/src/eval.rs`
- `src-tauri/engine/src/output_assertions.rs`
- `src-tauri/engine/src/verification_command.rs`
- `src-tauri/engine/src/queue.rs`
- `src-tauri/engine/src/rate_limiter.rs`
- `src-tauri/engine/src/session_pool.rs`
- `src-tauri/engine/src/prepared_run_cache.rs`
- `src-tauri/src/engine/failover.rs`
- `src-tauri/src/engine/incident_continuation.rs`
- `src-tauri/src/engine/resource_governor.rs`
- `src-tauri/src/engine/circuit_breakers_integration_tests.rs`
- `src-tauri/engine/src/cost.rs`
- `src-tauri/engine/src/logger.rs`
- `src-tauri/engine/src/process_activity.rs`
- `src-tauri/engine/src/sla_breach.rs`
- `src-tauri/src/engine/kpi_eval.rs`
- `src-tauri/src/engine/kpi_binding.rs`
- `src-tauri/src/engine/kpi_derivation.rs`
- `src-tauri/src/engine/goal_advance.rs`
- `src-tauri/engine/src/api_definition.rs`
- `src-tauri/engine/src/capability_contract.rs`
- `src-tauri/engine/src/archetype_catalog.rs`
- `src-tauri/engine/src/adoption_answers.rs`
- `src-tauri/src/engine/evolution.rs`
- `src-tauri/src/engine/genome.rs`
- `src-tauri/src/engine/genome_critique.rs`
- `src-tauri/src/engine/auto_rollback.rs`
- `src-tauri/engine/src/skills_sidecar/mod.rs`
- `src-tauri/engine/src/hooks_sidecar.rs`
- `src-tauri/engine/src/skill_scratchpad.rs`
- `src-tauri/engine/src/connector_explorer/mod.rs`
- `src-tauri/src/engine/bundle.rs`
- `src-tauri/src/engine/share_link.rs`

**Entry points:** src-tauri/engine/src/test_runner.rs, src-tauri/engine/src/eval.rs, src-tauri/engine/src/queue.rs

**Keywords:** test, scenario, eval, assertion, lab, model-comparison, verification, headless, queue, concurrency, rate-limit, session

**Tech stack:** Rust, Tokio, ts-rs

---

## Automation & Pipelines

> **Group type:** feature
> **Color:** amber

### agents-connectors

Persona connectors tab showing which external integrations (APIs, tools) are bound to the persona, their readiness status, unfulfilled credential demands, and a verification panel. CredentialPicker lets users bind vault credentials to connector slots. useConnectorStatuses polls connector readiness; useUnfulfilledCredentials derives the gap list. [Consolidated 2026-08-04: absorbed connector-automation, notification-channels]

**Files:**
- `src/features/agents/sub_connectors/components/connectors/PersonaConnectorsTab.tsx`
- `src/features/agents/sub_connectors/components/connectors/ConnectorsTabSections.tsx`
- `src/features/agents/sub_connectors/components/connectors/ConnectorStatusCard.tsx`
- `src/features/agents/sub_connectors/components/connectors/ConnectorStatusBadges.tsx`
- `src/features/agents/sub_connectors/components/connectors/ConnectorVerificationPanel.tsx`
- `src/features/agents/sub_connectors/components/connectors/AgentCredentialDemands.tsx`
- `src/features/agents/sub_connectors/components/connectors/CredentialPicker.tsx`
- `src/features/agents/sub_connectors/components/connectors/ToolsSection.tsx`
- `src/features/agents/sub_connectors/libs/connectorTypes.ts`
- `src/features/agents/sub_connectors/libs/useConnectorStatuses.ts`
- `src/features/agents/sub_connectors/libs/useUnfulfilledCredentials.ts`
- `src/features/agents/sub_connectors/components/automation/AutomationsSection.tsx`
- `src/features/agents/sub_connectors/components/automation/AutomationCard.tsx`
- `src/features/agents/sub_connectors/components/automation/AutomationCardActions.tsx`
- `src/features/agents/sub_connectors/components/automation/AutomationSetupModal.tsx`
- `src/features/agents/sub_connectors/components/automation/AutomationTriggerStep.tsx`
- `src/features/agents/sub_connectors/components/automation/AutomationConditionStep.tsx`
- `src/features/agents/sub_connectors/components/automation/AutomationActionStep.tsx`
- `src/features/agents/sub_connectors/components/automation/AutomationReviewStep.tsx`
- `src/features/agents/sub_connectors/components/automation/AutomationStatusBadge.tsx`
- `src/features/agents/sub_connectors/libs/automationTypes.ts`
- `src/features/agents/sub_connectors/libs/useAutomationSetup.ts`
- `src/features/agents/sub_connectors/components/channels/ChannelList.tsx`
- `src/features/agents/sub_connectors/components/channels/NotificationChannelCard.tsx`
- `src/features/agents/sub_connectors/components/channels/NotificationChannelSettings.tsx`
- `src/features/agents/sub_connectors/components/channels/AddChannelButton.tsx`
- `src/features/agents/sub_connectors/components/channels/DeliveryHealthBadge.tsx`

**Entry points:** src/features/agents/sub_connectors/components/connectors/PersonaConnectorsTab.tsx, src/features/agents/sub_connectors/libs/useConnectorStatuses.ts, src/features/agents/sub_connectors/components/automation/AutomationsSection.tsx

**Keywords:** connector, credential, status, verification, readiness, tool, binding, demands, automation, trigger, condition, action

**API surface:** list_persona_connectors, verify_connector, get_connector_readiness

**Tech stack:** React 19, TypeScript, Zustand 5, Tauri 2

---

### commands-recipes

AI-powered recipe intelligence — LLM-driven generation of new recipes from natural language descriptions, derivation of variant recipes, semantic matching against existing recipes, suggestion logging for analytics, and versioning. Follows the ai_artifact_flow streaming pattern. [Consolidated 2026-08-04: absorbed recipe-core]

**Files:**
- `src-tauri/src/commands/recipes/recipe_derivation.rs`
- `src-tauri/src/commands/recipes/recipe_generation.rs`
- `src-tauri/src/commands/recipes/recipe_match.rs`
- `src-tauri/src/commands/recipes/recipe_suggestion_log.rs`
- `src-tauri/src/commands/recipes/recipe_versioning.rs`
- `src-tauri/src/commands/recipes/crud.rs`
- `src-tauri/src/commands/recipes/recipe_adoption.rs`
- `src-tauri/src/commands/recipes/recipe_eligibility.rs`
- `src-tauri/src/commands/recipes/recipe_execution.rs`
- `src-tauri/src/commands/recipes/mod.rs`

**Entry points:** src-tauri/src/commands/recipes/recipe_generation.rs, src-tauri/src/commands/recipes/crud.rs

**Keywords:** generate, derive, match, suggestion, version, llm, ai-artifact, recipe, adopt, eligibility, execute, template

**API surface:** generate_recipe, derive_recipe, match_recipes, log_recipe_suggestion

**Tech stack:** Tauri 2, Rust, Claude CLI

---

### commands-tools

CRUD and lifecycle management for tools (callable functions/integrations) and automation pipelines attached to personas. Covers automation design (AI-assisted generation), deployment, and trigger wiring. The triggers module manages event→automation bindings. [Consolidated 2026-08-04: absorbed platform-integrations]

**Files:**
- `src-tauri/src/commands/tools/tools.rs`
- `src-tauri/src/commands/tools/automations.rs`
- `src-tauri/src/commands/tools/automation_design.rs`
- `src-tauri/src/commands/tools/deploy_automation.rs`
- `src-tauri/src/commands/tools/triggers.rs`
- `src-tauri/src/commands/tools/mod.rs`
- `src-tauri/src/commands/tools/github_platform.rs`
- `src-tauri/src/commands/tools/n8n_platform.rs`

**Entry points:** src-tauri/src/commands/tools/automations.rs, src-tauri/src/commands/tools/github_platform.rs

**Keywords:** tool, automation, trigger, deploy, pipeline, webhook, event, github, n8n, platform, integration, workflow

**API surface:** list_tools, create_tool, list_automations, deploy_automation, list_triggers, create_trigger

**Tech stack:** Tauri 2, Rust, SQLite

---

### db-repos-communication

Repositories for human review workflows — manual review requests triggered when personas encounter uncertainty, chat review sessions for interactive oversight, and template feedback collection. Enables human-in-the-loop patterns where executions can pause for human approval before proceeding. [Consolidated 2026-08-04: absorbed communication-events-repo, messaging-alerts-repo]

**Files:**
- `src-tauri/db/src/repos/communication/reviews.rs`
- `src-tauri/db/src/repos/communication/manual_reviews.rs`
- `src-tauri/db/src/repos/communication/chat.rs`
- `src-tauri/db/src/repos/communication/template_feedback.rs`
- `src-tauri/db/src/repos/communication/events.rs`
- `src-tauri/db/src/repos/communication/shared_events.rs`
- `src-tauri/db/src/repos/communication/smee_relays.rs`
- `src-tauri/db/src/repos/communication/mod.rs`
- `src-tauri/db/src/repos/communication/messages.rs`
- `src-tauri/db/src/repos/communication/alert_rules.rs`
- `src-tauri/db/src/repos/communication/sla.rs`

**Entry points:** src-tauri/db/src/repos/communication/reviews.rs, src-tauri/db/src/repos/communication/events.rs, src-tauri/db/src/repos/communication/messages.rs

**Keywords:** reviews, manual, human-in-the-loop, approval, chat, feedback, template, events, shared-events, catalog, smee, webhook

**Tech stack:** Rust, rusqlite

---

### lib-personas

Enables importing external automation workflows (n8n, Zapier, Make, GitHub Actions) into the persona system. Detects the source platform from file content, routes to a platform-specific parser, and runs a shared extraction pipeline that outputs a normalized AgentIR (suggested tools, triggers, connectors, and structured prompt). Platform capability definitions (node-type maps, credential consolidation rules, protocol detection) live in platformDefinitions.ts and are consumed by the parsers. [Consolidated 2026-08-04: absorbed persona-scoring, structured-prompt, template-catalog]

**Files:**
- `src/lib/personas/parsers/githubActionsParser.ts`
- `src/lib/personas/parsers/makeParser.ts`
- `src/lib/personas/parsers/n8nParser.ts`
- `src/lib/personas/parsers/zapierParser.ts`
- `src/lib/personas/parsers/workflowDetector.ts`
- `src/lib/personas/parsers/workflowPipeline.ts`
- `src/lib/personas/parsers/workflowParser.ts`
- `src/lib/personas/platformDefinitions.ts`
- `src/lib/personas/personaThresholds.ts`
- `src/lib/personas/personaToken.ts`
- `src/lib/personas/utils.ts`
- `src/lib/personas/promptMigration.ts`
- `src/lib/personas/templates/templateCatalog.ts`
- `src/lib/personas/templates/validateTemplate.ts`
- `src/lib/personas/templates/templateOverlays.ts`
- `src/lib/personas/templates/templateChecksums.ts`
- `src/lib/personas/templates/seedTemplates.ts`
- `src/lib/personas/templates/useLocalizedTemplateCatalog.ts`
- `src/lib/personas/templates/__tests__/templateOverlays.test.ts`

**Entry points:** src/lib/personas/parsers/workflowParser.ts, src/lib/personas/parsers/workflowPipeline.ts, src/lib/personas/platformDefinitions.ts

**Keywords:** workflow, import, n8n, zapier, make, github-actions, parser, platform, AgentIR, connector, trigger, trust

**API surface:** parseWorkflowFile(content, fileName): WorkflowParseResult

**Tech stack:** TypeScript, js-yaml, React 19, Vite 8

---

### n8n-wizard-orchestration

Hooks that orchestrate the n8n import wizard: useN8nWizard is the top-level orchestrator composing session, transform, and test sub-hooks. Handler hooks decompose wizard actions into lifecycle, transform, and generic event handlers. useWorkflowImport calls the backend transform IPC and useN8nDesignData fetches the resulting design object.

**Files:**
- `src/features/templates/sub_n8n/hooks/useN8nWizard.ts`
- `src/features/templates/sub_n8n/hooks/useN8nWizardHandlers.ts`
- `src/features/templates/sub_n8n/hooks/useN8nWizardLifecycleHandlers.ts`
- `src/features/templates/sub_n8n/hooks/useN8nWizardTransformHandlers.ts`
- `src/features/templates/sub_n8n/hooks/useN8nSession.ts`
- `src/features/templates/sub_n8n/hooks/useN8nTransform.ts`
- `src/features/templates/sub_n8n/hooks/useN8nTest.ts`
- `src/features/templates/sub_n8n/hooks/useN8nImportReducer.ts`
- `src/features/templates/sub_n8n/hooks/useN8nDesignData.ts`
- `src/features/templates/sub_n8n/hooks/useWorkflowImport.ts`
- `src/features/templates/sub_n8n/hooks/useResolvedEntities.ts`
- `src/features/templates/sub_n8n/hooks/n8nTypes.ts`
- `src/features/templates/sub_n8n/hooks/n8nWizardTypes.ts`

**Entry points:** src/features/templates/sub_n8n/hooks/useN8nWizard.ts

**Keywords:** n8n orchestration, wizard hooks, transform, session, test, lifecycle, workflow import

**API surface:** invoke transform_n8n_workflow, get_n8n_design_data, test_n8n_workflow

**Tech stack:** React 19, TypeScript, Tauri 2

---

### recipes-playground

Interactive playground modal for testing recipes end-to-end. RecipePlaygroundModal hosts a four-tab shell (Overview, Test Runner, History, Versions). useRecipeTestRunner manages a two-phase execution: prompt rendering via the backend API, then LLM execution via the CLI stream, with run-id correlation to prevent cross-run output contamination. RecipeInputSection handles schema-driven or free-form input entry and mock-value management; RecipeOutputSection renders streaming terminal output and final results. [Consolidated 2026-08-04: absorbed recipe-versioning, recipe-navigation, recipe-shared, recipe-editor, recipe-list, recipe-persona-linking, recipe-manager-shell]

**Files:**
- `src/features/recipes/sub_playground/components/RecipePlaygroundModal.tsx`
- `src/features/recipes/sub_playground/tabs/RecipeTestRunnerTab.tsx`
- `src/features/recipes/sub_playground/tabs/RecipeInputSection.tsx`
- `src/features/recipes/sub_playground/tabs/RecipeOutputSection.tsx`
- `src/features/recipes/sub_playground/tabs/RecipeOverviewTab.tsx`
- `src/features/recipes/sub_playground/tabs/RecipeHistoryTab.tsx`
- `src/features/recipes/sub_playground/libs/useRecipeTestRunner.ts`
- `src/features/recipes/sub_playground/tabs/recipeTestHelpers.ts`
- `src/features/recipes/sub_playground/index.ts`
- `src/features/recipes/sub_playground/tabs/RecipeVersionsTab.tsx`
- `src/features/recipes/hooks/useRecipeViewFSM.ts`
- `src/features/recipes/shared/RecipePageFlipLoader.tsx`
- `src/features/recipes/shared/RecipeBookIllustration.tsx`
- `src/features/recipes/shared/PuzzlePieceIllustration.tsx`
- `src/features/recipes/shared/VersionTimelineIllustration.tsx`
- `src/features/recipes/shared/SchemaParseErrorBanner.tsx`
- `src/features/recipes/shared/recipeParseUtils.ts`
- `src/features/recipes/sub_editor/components/RecipeEditor.tsx`
- `src/features/recipes/sub_editor/components/SchemaFieldBuilder.tsx`
- `src/features/recipes/sub_editor/components/TagChipInput.tsx`
- `src/features/recipes/sub_editor/index.ts`
- `src/features/recipes/sub_list/components/RecipeList.tsx`
- `src/features/recipes/sub_list/components/RecipeCard.tsx`
- `src/features/recipes/sub_list/components/RecipePicker.tsx`
- `src/features/recipes/sub_list/index.ts`
- `src/features/recipes/sub_list/components/LinkedRecipesSection.tsx`
- `src/features/recipes/sub_manager/components/RecipeManager.tsx`
- `src/features/recipes/sub_manager/index.ts`

**Entry points:** src/features/recipes/sub_playground/components/RecipePlaygroundModal.tsx, src/features/recipes/sub_playground/libs/useRecipeTestRunner.ts, src/features/recipes/sub_playground/tabs/RecipeVersionsTab.tsx

**Keywords:** playground, test-runner, execute, recipe, prompt-rendering, LLM, streaming, history, mock-values, input-schema, versioning, AI-generated

**API surface:** executeRecipe, updateRecipe (sample_inputs patch) via @/api/recipes/recipes

**Tech stack:** React 19, TypeScript, Tauri 2, Framer Motion

---

### schedules-components

Calendar visualisation of scheduled agent fires in week and month layouts. Future fires are projected via cron_fire_times_in_range IPC (seeded with trigger id for H-spread accuracy); past cron slots are matched against real execution records within a 90s tolerance window so colour coding reflects actual outcomes rather than fabricated health. Detects and highlights scheduling conflicts within 5-minute windows. [Consolidated 2026-08-04: absorbed schedule-row-actions, schedule-run-history, schedule-timeline, schedule-tests]

**Files:**
- `src/features/schedules/components/ScheduleCalendar.tsx`
- `src/features/schedules/components/WeekView.tsx`
- `src/features/schedules/components/MonthView.tsx`
- `src/features/schedules/components/EventBlock.tsx`
- `src/features/schedules/components/EventTooltip.tsx`
- `src/features/schedules/libs/calendarHelpers.ts`
- `src/features/schedules/libs/useCronPreview.ts`
- `src/features/schedules/components/ScheduleRow.tsx`
- `src/features/schedules/components/FrequencyEditor.tsx`
- `src/features/schedules/components/BackfillModal.tsx`
- `src/features/schedules/libs/useScheduleActions.ts`
- `src/features/schedules/components/ScheduleRowHistoryPanel.tsx`
- `src/features/schedules/components/ScheduleRecentRuns.tsx`
- `src/features/schedules/index.ts`
- `src/features/schedules/components/ScheduleTimeline.tsx`
- `src/features/schedules/components/ScheduleGroupedList.tsx`
- `src/features/schedules/libs/scheduleHelpers.ts`
- `src/features/schedules/libs/scheduleListItems.ts`
- `src/features/schedules/libs/__tests__/matchPastSlotsToRuns.test.ts`
- `src/features/schedules/libs/__tests__/useCalendarEvents.test.ts`
- `src/features/schedules/libs/__tests__/scheduleListItems.test.ts`

**Entry points:** src/features/schedules/components/ScheduleCalendar.tsx, src/features/schedules/libs/calendarHelpers.ts, src/features/schedules/components/ScheduleRow.tsx

**Keywords:** calendar, week-view, month-view, conflict, projected, past-success, past-failure, cron-fire-times, slot-matching, overlap, backfill, skip

**API surface:** cronFireTimesInRange, listRecentScheduleRuns

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### teams-collaboration-repo

Repositories for team collaboration features — team definitions, team memory shared across personas, team channel configurations, notification subscriptions, and team-to-persona assignments for orchestration. Enables multi-agent coordination under shared team contexts. [Consolidated 2026-08-04: absorbed external-integrations-repo, plugins-resources-repo, persona-governance-repo, security-audit-repo, tools-connectors-repo, triggers-automations-repo, credentials-repo]

**Files:**
- `src-tauri/db/src/repos/resources/teams.rs`
- `src-tauri/db/src/repos/resources/team_memories.rs`
- `src-tauri/db/src/repos/resources/team_channel.rs`
- `src-tauri/db/src/repos/resources/notification_subscriptions.rs`
- `src-tauri/db/src/repos/orchestration/team_assignments.rs`
- `src-tauri/db/src/repos/orchestration/mod.rs`
- `src-tauri/db/src/repos/resources/mcp_gateways.rs`
- `src-tauri/db/src/repos/resources/n8n_sessions.rs`
- `src-tauri/db/src/repos/resources/owned_devices.rs`
- `src-tauri/db/src/repos/resources/playwright_procedures.rs`
- `src-tauri/db/src/repos/resources/ocr.rs`
- `src-tauri/db/src/repos/resources/artist.rs`
- `src-tauri/db/src/repos/resources/obsidian_brain.rs`
- `src-tauri/db/src/repos/resources/db_schema.rs`
- `src-tauri/db/src/repos/resources/deliberation.rs`
- `src-tauri/db/src/repos/resources/mod.rs`
- `src-tauri/db/src/repos/resources/persona_change_log.rs`
- `src-tauri/db/src/repos/resources/exposure.rs`
- `src-tauri/db/src/repos/resources/deployment_history.rs`
- `src-tauri/db/src/repos/resources/signing.rs`
- `src-tauri/db/src/repos/resources/api_key_audit.rs`
- `src-tauri/db/src/repos/resources/audit_log.rs`
- `src-tauri/db/src/repos/resources/settings_audit_log.rs`
- `src-tauri/db/src/repos/resources/rotation.rs`
- `src-tauri/db/src/repos/resources/tools.rs`
- `src-tauri/db/src/repos/resources/tool_audit_log.rs`
- `src-tauri/db/src/repos/resources/connectors.rs`
- `src-tauri/db/src/repos/resources/composition_workflows.rs`
- `src-tauri/db/src/repos/resources/triggers.rs`
- `src-tauri/db/src/repos/resources/automations.rs`
- `src-tauri/db/src/repos/resources/webhook_log.rs`
- `src-tauri/db/src/repos/resources/cloud_webhook_watermarks.rs`
- `src-tauri/db/src/repos/resources/credentials.rs`
- `src-tauri/db/src/repos/resources/external_api_keys.rs`

**Entry points:** src-tauri/db/src/repos/resources/teams.rs, src-tauri/db/src/repos/resources/mcp_gateways.rs, src-tauri/db/src/repos/resources/artist.rs

**Keywords:** teams, collaboration, memory, channels, notifications, orchestration, assignments, MCP, n8n, playwright, browser-automation, OCR

**Tech stack:** Rust, rusqlite

---

### templates-n8n-steps

UI steps for the multi-step n8n workflow import wizard: the root import tab (step orchestrator), parser results display with grouped sections, session list, persona entity summary, selection checkbox, step indicator widget, and wizard footer navigation. Surfaces the parsed n8n workflow nodes as reviewable entity groups before transformation. [Consolidated 2026-08-04: absorbed n8n-wizard-upload, n8n-connector-analysis, n8n-wizard-state]

**Files:**
- `src/features/templates/sub_n8n/steps/N8nImportTab.tsx`
- `src/features/templates/sub_n8n/steps/N8nParserResults.tsx`
- `src/features/templates/sub_n8n/steps/N8nParserResultsSections.tsx`
- `src/features/templates/sub_n8n/steps/N8nSessionList.tsx`
- `src/features/templates/sub_n8n/steps/PersonaEntitySummary.tsx`
- `src/features/templates/sub_n8n/steps/SelectionCheckbox.tsx`
- `src/features/templates/sub_n8n/steps/confirm/n8nConfirmTypes.ts`
- `src/features/templates/sub_n8n/widgets/N8nStepIndicator.tsx`
- `src/features/templates/sub_n8n/widgets/N8nWizardFooter.tsx`
- `src/features/templates/sub_n8n/steps/upload/N8nUploadStep.tsx`
- `src/features/templates/sub_n8n/steps/upload/n8nUploadTypes.ts`
- `src/features/templates/sub_n8n/steps/upload/PlatformLabels.tsx`
- `src/features/templates/sub_n8n/steps/upload/PreviewCard.tsx`
- `src/features/templates/sub_n8n/steps/upload/useFileUpload.ts`
- `src/features/templates/sub_n8n/steps/upload/usePasteImport.ts`
- `src/features/templates/sub_n8n/steps/upload/useUrlImport.ts`
- `src/features/templates/sub_n8n/edit/connectorMatching.ts`
- `src/features/templates/sub_n8n/edit/credentialGapAnalysis.ts`
- `src/features/templates/sub_n8n/edit/connectorHealth.ts`
- `src/features/templates/sub_n8n/edit/protocolParser.ts`
- `src/features/templates/sub_n8n/reducers/sessionReducer.ts`
- `src/features/templates/sub_n8n/reducers/navigationReducer.ts`
- `src/features/templates/sub_n8n/reducers/transformReducer.ts`
- `src/features/templates/sub_n8n/reducers/testReducer.ts`
- `src/features/templates/sub_n8n/colorTokens.ts`

**Entry points:** src/features/templates/sub_n8n/steps/N8nImportTab.tsx, src/features/templates/sub_n8n/steps/upload/N8nUploadStep.tsx, src/features/templates/sub_n8n/edit/connectorMatching.ts

**Keywords:** n8n import, wizard steps, parser results, session list, entity summary, step indicator, n8n upload, file upload, paste import, URL import, drag and drop, workflow JSON

**Tech stack:** React 19, TypeScript

---

### templates-recipes

Business logic for the recipe feature: type definitions, mock seed catalog, eligibility resolution (checks which connectors a recipe needs vs what the persona has), frontend shape adapter (RecipeDefinition → Recipe), staleness detection, binding substitution (replaces {{param}} tokens), category labels, and the useAdoption hook that writes a substituted DesignUseCase into the persona's design_context. [Consolidated 2026-08-04: absorbed recipe-catalog, template-page-shell, template-activity-diagrams]

**Files:**
- `src/features/templates/sub_recipes/types.ts`
- `src/features/templates/sub_recipes/eligibility.ts`
- `src/features/templates/sub_recipes/useEligibility.ts`
- `src/features/templates/sub_recipes/mockRecipes.ts`
- `src/features/templates/sub_recipes/index.ts`
- `src/features/templates/sub_recipes/libs/recipeAdapter.ts`
- `src/features/templates/sub_recipes/libs/recipeStaleness.ts`
- `src/features/templates/sub_recipes/libs/recipeStaleness.test.ts`
- `src/features/templates/sub_recipes/libs/substituteBindings.ts`
- `src/features/templates/sub_recipes/libs/categoryLabels.ts`
- `src/features/templates/sub_recipes/libs/useAdoption.ts`
- `src/features/templates/sub_recipes/libs/__tests__/recipeAdapter.test.ts`
- `src/features/templates/sub_recipes/RecipesPage.tsx`
- `src/features/templates/sub_recipes/components/RecipesBrowseList.tsx`
- `src/features/templates/sub_recipes/components/RecipesTableResults.tsx`
- `src/features/templates/sub_recipes/components/RecipeDetailPanel.tsx`
- `src/features/templates/sub_recipes/components/RecipeAdoptionModal.tsx`
- `src/features/templates/sub_recipes/components/EligibilityChip.tsx`
- `src/features/templates/sub_recipes/components/detail/RecipeDetailHeader.tsx`
- `src/features/templates/sub_recipes/components/detail/RecipeGuardrailsCard.tsx`
- `src/features/templates/sub_recipes/components/detail/RecipeHowItRuns.tsx`
- `src/features/templates/sub_recipes/components/detail/RecipeNeedsCard.tsx`
- `src/features/templates/components/DesignReviewsPage.tsx`
- `src/features/templates/components/ConfigureStep.tsx`
- `src/features/templates/components/SourceDefinitionInput.tsx`
- `src/features/templates/sub_diagrams/ActivityDiagramModal.tsx`
- `src/features/templates/sub_diagrams/activityDiagramTypes.ts`
- `src/features/templates/sub_diagrams/FlowDiagram.tsx`
- `src/features/templates/sub_diagrams/FlowNodeCard.tsx`
- `src/features/templates/sub_diagrams/NodePopover.tsx`
- `src/features/templates/sub_diagrams/PopoverPositioner.tsx`

**Entry points:** src/features/templates/sub_recipes/types.ts, src/features/templates/sub_recipes/eligibility.ts, src/features/templates/sub_recipes/libs/useAdoption.ts

**Keywords:** recipe types, eligibility, recipe adapter, staleness, binding substitution, category labels, use adoption, recipes, browse, adoption modal, eligibility chip, recipe detail

**Tech stack:** TypeScript, Zustand 5

---

### trigger-config

Configuration panels for every supported trigger type (webhook, polling, file-watcher, event-listener, app-focus, clipboard, composite). Includes the config dispatcher buildTriggerConfig and each type-specific form component, plus shared field-group layout. Used inside TriggerDetailDrawer and TriggerAddForm.

**Files:**
- `src/features/triggers/sub_triggers/TriggerConfig.tsx`
- `src/features/triggers/sub_triggers/TriggerConfigSection.tsx`
- `src/features/triggers/sub_triggers/configs/buildTriggerConfig.ts`
- `src/features/triggers/sub_triggers/configs/WebhookConfig.tsx`
- `src/features/triggers/sub_triggers/configs/PollingConfig.tsx`
- `src/features/triggers/sub_triggers/configs/FileWatcherConfig.tsx`
- `src/features/triggers/sub_triggers/configs/EventListenerConfig.tsx`
- `src/features/triggers/sub_triggers/configs/AppFocusConfig.tsx`
- `src/features/triggers/sub_triggers/configs/ClipboardConfig.tsx`
- `src/features/triggers/sub_triggers/configs/CompositeConfig.tsx`
- `src/features/triggers/sub_triggers/configs/TriggerFieldGroup.tsx`
- `src/features/triggers/sub_triggers/WebhookRequestInspector.tsx`
- `src/features/triggers/sub_triggers/JsonPayloadBlock.tsx`
- `src/features/triggers/sub_triggers/CompositePartialMatchIndicator.tsx`

**Entry points:** src/features/triggers/sub_triggers/TriggerConfig.tsx, src/features/triggers/sub_triggers/configs/buildTriggerConfig.ts

**Keywords:** webhook, polling, file-watcher, event-listener, composite, config, trigger-type

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### triggers-studio

Chain Studio — a visual patchbay UI for creating and managing event-routing rules between personas. Users compose draft 'patch cable' routes (source event → target persona), set run conditions (always/success/failure/output_match), and commit them as live trigger bindings. Supersedes the older builder + routes views. [Consolidated 2026-08-04: absorbed studio-commit-logic, studio-routing-state, studio-system-ops, trigger-operations-hook, live-stream, smee-relay]

**Files:**
- `src/features/triggers/sub_studio/TriggerStudioCanvas.tsx`
- `src/features/triggers/sub_studio/StudioPatchbay.tsx`
- `src/features/triggers/sub_studio/StudioRails.tsx`
- `src/features/triggers/sub_studio/studioChips.tsx`
- `src/features/triggers/sub_studio/StudioOptionCards.tsx`
- `src/features/triggers/sub_studio/useStudioComposer.ts`
- `src/features/triggers/sub_studio/StudioTriggerCommitModal.tsx`
- `src/features/triggers/sub_studio/libs/studioCommit.ts`
- `src/features/triggers/sub_studio/libs/studioDraftModel.ts`
- `src/features/triggers/sub_studio/libs/studioLabels.ts`
- `src/features/triggers/sub_studio/libs/triggerStudioConstants.ts`
- `src/features/triggers/sub_studio/libs/__tests__/studioCommit.test.ts`
- `src/features/triggers/sub_studio/routing/layouts/useRoutingState.ts`
- `src/features/triggers/sub_studio/routing/layouts/buildEventRows.ts`
- `src/features/triggers/sub_studio/routing/layouts/routingHelpers.tsx`
- `src/features/triggers/sub_studio/routing/layouts/AddPersonaModal.tsx`
- `src/features/triggers/sub_studio/routing/layouts/DisconnectDialog.tsx`
- `src/features/triggers/sub_studio/routing/layouts/RenameEventDialog.tsx`
- `src/features/triggers/sub_studio/system_ops/SystemEventAutomationsPanel.tsx`
- `src/features/triggers/sub_studio/system_ops/SystemOpOptionCard.tsx`
- `src/features/triggers/sub_studio/system_ops/useSystemOpStudio.ts`
- `src/features/triggers/sub_studio/system_ops/SystemEventCommitModal.tsx`
- `src/features/triggers/hooks/useTriggerOperations.ts`
- `src/features/triggers/hooks/useTriggerHistory.ts`
- `src/features/triggers/hooks/useTriggerDetail.ts`
- `src/features/triggers/lib/triggerError.ts`
- `src/features/triggers/lib/eventSourceTemplates.ts`
- `src/features/triggers/lib/canvas/gridUtils.ts`
- `src/features/triggers/sub_live_stream/LiveStreamTab.tsx`
- `src/features/triggers/sub_live_stream/EventDetailModal.tsx`
- `src/features/triggers/sub_live_stream/EventTypeChip.tsx`
- `src/features/triggers/sub_live_stream/HighlightedJson.tsx`
- `src/features/triggers/sub_live_stream/eventTypeMeta.ts`
- `src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx`

**Entry points:** src/features/triggers/sub_studio/TriggerStudioCanvas.tsx, src/features/triggers/sub_studio/StudioPatchbay.tsx, src/features/triggers/sub_studio/libs/studioCommit.ts

**Keywords:** studio, patchbay, routing, chain, draft, commit, event-routing, signal-source, output-match, route, binding, event-row

**API surface:** listAllTriggers, listEvents, createTrigger

**Tech stack:** React 19, TypeScript, Framer Motion, Zustand 5, Tailwind 4

---

### triggers-test

Shared / marketplace event feed catalog (Watchtower): displays curated external event feeds (e.g. API update notifications), lets users subscribe/watch individual feeds, and shows recent change-activity per feed with a history modal. Backed by useSharedEvents and useSubscribedFeeds hooks. [Consolidated 2026-08-04: absorbed trigger-test-tab]

**Files:**
- `src/features/triggers/sub_shared/SharedEventsTab.tsx`
- `src/features/triggers/sub_shared/useSharedEvents.ts`
- `src/features/triggers/sub_shared/useSubscribedFeeds.ts`
- `src/features/triggers/sub_shared/sharedEventsUi.tsx`
- `src/features/triggers/sub_shared/SubscribeControls.tsx`
- `src/features/triggers/sub_shared/EventHistoryModal.tsx`
- `src/features/triggers/sub_test/TestTab.tsx`

**Entry points:** src/features/triggers/sub_shared/SharedEventsTab.tsx, src/features/triggers/sub_shared/useSharedEvents.ts, src/features/triggers/sub_test/TestTab.tsx

**Keywords:** shared-events, marketplace, watchtower, feeds, subscribe, catalog, activity, test, fire, validate, dry-run, manual

**API surface:** listSharedEventCatalog, subscribe, unsubscribe, listFeedActivity

**Tech stack:** React 19, TypeScript, Zustand 5, Tailwind 4

---

### triggers-triggers

Per-persona trigger list UI: creating, viewing, toggling, deleting, and detail-drilling triggers. Includes the add form with NL input support, trigger rows, the detail drawer, quick templates, type/category selectors, and execution history per trigger. The core CRUD surface users interact with inside each persona. [Consolidated 2026-08-04: absorbed nl-trigger-parser, trigger-health-indicators, trigger-schedule, cloud-webhooks, dead-letter, rate-limit-dashboard]

**Files:**
- `src/features/triggers/sub_triggers/TriggerList.tsx`
- `src/features/triggers/sub_triggers/TriggerRow.tsx`
- `src/features/triggers/sub_triggers/TriggerListItem.tsx`
- `src/features/triggers/sub_triggers/TriggerAddForm.tsx`
- `src/features/triggers/sub_triggers/TriggerDetailDrawer.tsx`
- `src/features/triggers/sub_triggers/TriggerQuickTemplates.tsx`
- `src/features/triggers/sub_triggers/TriggerTypeSelector.tsx`
- `src/features/triggers/sub_triggers/TriggerCategorySelector.tsx`
- `src/features/triggers/sub_triggers/TriggerModeBadge.tsx`
- `src/features/triggers/sub_triggers/TriggerStatusSummary.tsx`
- `src/features/triggers/sub_triggers/TriggerExecutionHistory.tsx`
- `src/features/triggers/sub_triggers/triggerListTypes.ts`
- `src/features/triggers/sub_triggers/PendingTriggerApprovals.tsx`
- `src/features/triggers/sub_triggers/NlTriggerInput.tsx`
- `src/features/triggers/sub_triggers/nlTriggerParser.ts`
- `src/features/triggers/sub_triggers/__tests__/nlTriggerParser.test.ts`
- `src/features/triggers/sub_triggers/TriggerHealthSparkline.tsx`
- `src/features/triggers/sub_triggers/HealthDot.tsx`
- `src/features/triggers/sub_triggers/triggerArmState.ts`
- `src/features/triggers/sub_triggers/DryRunResultView.tsx`
- `src/features/triggers/sub_triggers/__tests__/triggerArmState.test.ts`
- `src/features/triggers/sub_triggers/TriggerScheduleConfig.tsx`
- `src/features/triggers/sub_triggers/TriggerSchedulePreview.tsx`
- `src/features/triggers/sub_triggers/TriggerCountdown.tsx`
- `src/features/triggers/sub_triggers/RadialCountdownRing.tsx`
- `src/features/triggers/sub_triggers/TimezoneSelect.tsx`
- `src/features/triggers/sub_triggers/ActiveHoursSection.tsx`
- `src/features/triggers/sub_triggers/UnattendedModeSection.tsx`
- `src/features/triggers/sub_triggers/RateLimitControls.tsx`
- `src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx`
- `src/features/triggers/sub_dead_letter/DeadLetterTab.tsx`
- `src/features/triggers/sub_speed_limits/RateLimitDashboard.tsx`

**Entry points:** src/features/triggers/sub_triggers/TriggerList.tsx, src/features/triggers/sub_triggers/TriggerAddForm.tsx, src/features/triggers/sub_triggers/NlTriggerInput.tsx

**Keywords:** trigger, list, create, delete, toggle, execution-history, detail-drawer, natural-language, NLP, schedule, parser, cron

**API surface:** createTrigger, updateTrigger, deleteTrigger, listTriggers

**Tech stack:** React 19, TypeScript, Zustand 5, Tailwind 4

---

### webhook-ingestion

Inbound webhook server stack that receives external HTTP POSTs (via the local axum server), relays cloud trigger firings polled from the cloud orchestrator, and bridges Smee.io SSE streams into the local event bus. Together these three paths let external systems trigger personas regardless of whether the desktop has a public URL. [Consolidated 2026-08-04: absorbed agent-session-replay, build-compilation-pipeline, cli-process-driver, event-subscriptions, execution-knowledge, oauth-token-management, project-autonomy, recipe-adoption, team-orchestration, tool-execution]

**Files:**
- `src-tauri/src/engine/webhook.rs`
- `src-tauri/src/engine/cloud_webhook_relay.rs`
- `src-tauri/src/engine/smee_relay.rs`
- `src-tauri/engine/src/git_checkpoint.rs`
- `src-tauri/engine/src/dream_replay.rs`
- `src-tauri/engine/src/context_fidelity.rs`
- `src-tauri/engine/src/compilation_pipeline.rs`
- `src-tauri/engine/src/template_v3.rs`
- `src-tauri/engine/src/template_checksums.rs`
- `src-tauri/engine/src/cli_process.rs`
- `src-tauri/engine/src/cli_capabilities.rs`
- `src-tauri/engine/src/cli_mcp_config.rs`
- `src-tauri/src/engine/subscription.rs`
- `src-tauri/src/engine/composite.rs`
- `src-tauri/src/engine/polling.rs`
- `src-tauri/src/engine/knowledge.rs`
- `src-tauri/src/engine/kb_scan.rs`
- `src-tauri/src/engine/memory_reflection.rs`
- `src-tauri/engine/src/google_oauth.rs`
- `src-tauri/engine/src/oauth_refresh_lock.rs`
- `src-tauri/engine/src/pairing.rs`
- `src-tauri/engine/src/autopilot.rs`
- `src-tauri/engine/src/autonomy.rs`
- `src-tauri/engine/src/optimizer.rs`
- `src-tauri/engine/src/recipe_eligibility.rs`
- `src-tauri/engine/src/recipe_matcher.rs`
- `src-tauri/engine/src/recipe_parameters.rs`
- `src-tauri/src/engine/team_assignment_orchestrator.rs`
- `src-tauri/src/engine/team_assignment_matching.rs`
- `src-tauri/src/engine/team_preset_adopter.rs`
- `src-tauri/src/engine/tool_runner.rs`
- `src-tauri/src/engine/mcp_tools.rs`
- `src-tauri/src/engine/dry_run.rs`

**Entry points:** src-tauri/src/engine/webhook.rs, src-tauri/src/engine/cloud_webhook_relay.rs, src-tauri/engine/src/git_checkpoint.rs

**Keywords:** webhook, inbound, HTTP server, axum, Smee, SSE, cloud relay, trigger, event ingestion, git, checkpoint, replay

**API surface:** POST /webhook/:persona_id/:secret (local HTTP), Smee.io SSE (outbound subscribe)

**Tech stack:** Rust, Tokio, axum, reqwest

---

## Team Collaboration

> **Group type:** feature
> **Color:** orange

### api-pipeline

IPC wrappers for persona trigger management (cron schedules, webhooks, event-based firings) and the background scheduler that orchestrates them. Triggers define when a persona runs autonomously; the scheduler controls start/stop/backfill and reports missed runs. Workflow job management (listing, cancelling, reading output of background CI-style jobs) is also included. [Consolidated 2026-08-04: absorbed team-communication-api, team-management-api]

**Files:**
- `src/api/pipeline/triggers.ts`
- `src/api/pipeline/scheduler.ts`
- `src/api/pipeline/workflows.ts`
- `src/api/pipeline/teamChannel.ts`
- `src/api/pipeline/teamDeliberations.ts`
- `src/api/pipeline/teamMemories.ts`
- `src/api/pipeline/teams.ts`
- `src/api/pipeline/assignments.ts`

**Entry points:** src/api/pipeline/triggers.ts, src/api/pipeline/scheduler.ts, src/api/pipeline/teamChannel.ts

**Keywords:** trigger, cron, webhook, schedule, backfill, scheduler, workflow, job, fire, pending, team channel, deliberation

**API surface:** Tauri commands: list_triggers, create_trigger, start_scheduler, backfill_missed_runs, get_workflows_overview, cancel_workflow_job

**Tech stack:** Tauri 2, TypeScript, React 19

---

### mastermind-popovers

Floating overlay components that appear on dimension cell clicks and tool actions: CategoryPopover (collapsed category drill-down), DimListPopover (stack-list items like datalinks/support), GoalListPopover (ongoing dev goals), KpiListPopover (per-project KPI status list), IdeaScanPopover (scan dispatch with agent/context/target controls), PersonaListPopover (running personas with navigation), FleetListPopover (live CLI sessions), and the base ListPopover. Also includes LinkEditor and NoteEditor for canvas annotation tools. [Consolidated 2026-08-04: absorbed mastermind-canvas-shell, mastermind-island-ui, mastermind-sidebars-panels]

**Files:**
- `src/features/teams/sub_mastermind/lib/CategoryPopover.tsx`
- `src/features/teams/sub_mastermind/lib/DimListPopover.tsx`
- `src/features/teams/sub_mastermind/lib/GoalListPopover.tsx`
- `src/features/teams/sub_mastermind/lib/KpiListPopover.tsx`
- `src/features/teams/sub_mastermind/lib/IdeaScanPopover.tsx`
- `src/features/teams/sub_mastermind/lib/PersonaListPopover.tsx`
- `src/features/teams/sub_mastermind/lib/FleetListPopover.tsx`
- `src/features/teams/sub_mastermind/lib/ListPopover.tsx`
- `src/features/teams/sub_mastermind/lib/LinkEditor.tsx`
- `src/features/teams/sub_mastermind/lib/NoteEditor.tsx`
- `src/features/teams/sub_mastermind/lib/CanvasShell.tsx`
- `src/features/teams/sub_mastermind/lib/CanvasToolbar.tsx`
- `src/features/teams/sub_mastermind/lib/useCanvasCamera.ts`
- `src/features/teams/sub_mastermind/lib/useIslandDrag.ts`
- `src/features/teams/sub_mastermind/lib/kbNav.ts`
- `src/features/teams/sub_mastermind/lib/ZoomBadge.tsx`
- `src/features/teams/sub_mastermind/lib/ZoomControls.tsx`
- `src/features/teams/sub_mastermind/lib/useEventCallback.ts`
- `src/features/teams/sub_mastermind/lib/hex.ts`
- `src/features/teams/sub_mastermind/lib/IslandBanner.tsx`
- `src/features/teams/sub_mastermind/lib/IslandMenu.tsx`
- `src/features/teams/sub_mastermind/lib/DimTile.tsx`
- `src/features/teams/sub_mastermind/lib/DimGlyph.tsx`
- `src/features/teams/sub_mastermind/lib/DimLegend.tsx`
- `src/features/teams/sub_mastermind/lib/StatColumns.tsx`
- `src/features/teams/sub_mastermind/lib/FleetBadges.tsx`
- `src/features/teams/sub_mastermind/lib/ProjectListSidebar.tsx`
- `src/features/teams/sub_mastermind/lib/ProjectSidebar.tsx`
- `src/features/teams/sub_mastermind/lib/MemorySection.tsx`
- `src/features/teams/sub_mastermind/lib/FleetPreviewPanel.tsx`
- `src/features/teams/sub_mastermind/lib/DispatchFleetModal.tsx`
- `src/features/teams/sub_mastermind/lib/DemoNotice.tsx`
- `src/features/teams/sub_mastermind/lib/DataHealthBar.tsx`

**Entry points:** src/features/teams/sub_mastermind/lib/IdeaScanPopover.tsx, src/features/teams/sub_mastermind/lib/CategoryPopover.tsx, src/features/teams/sub_mastermind/lib/CanvasShell.tsx

**Keywords:** popover, dimension, KPI, goals, idea scan, persona, fleet, link editor, note editor, category, canvas, camera

**Tech stack:** React 19, TypeScript

---

### mastermind-scene-store

Zustand store that is the batched data spine for the Mastermind canvas. Fetches and caches cross-project relations, idea scans, Sentry monitoring summaries, dev goals, and LLM spend with ≤1 IPC per family per load, tracks per-family fetch status for honest health reporting, and supports surgical per-project scan invalidation. Also provides island stat builders and deterministic mock stats for demo mode. [Consolidated 2026-08-04: absorbed mastermind-canvas-layers, mastermind-dimension-system, mastermind-layout-persistence, mastermind-scene-model, mastermind-canvas-variants]

**Files:**
- `src/features/teams/sub_mastermind/lib/sceneStore.ts`
- `src/features/teams/sub_mastermind/lib/liveState.ts`
- `src/features/teams/sub_mastermind/lib/islandStats.ts`
- `src/features/teams/sub_mastermind/lib/statsMock.ts`
- `src/features/teams/sub_mastermind/lib/llmSpend.ts`
- `src/features/teams/sub_mastermind/lib/fleetMeta.ts`
- `src/features/teams/sub_mastermind/lib/GroupLayer.tsx`
- `src/features/teams/sub_mastermind/lib/LinkLayer.tsx`
- `src/features/teams/sub_mastermind/lib/NoteLayer.tsx`
- `src/features/teams/sub_mastermind/lib/Route.tsx`
- `src/features/teams/sub_mastermind/lib/tidyLayout.ts`
- `src/features/teams/sub_mastermind/lib/dimRegistry.ts`
- `src/features/teams/sub_mastermind/lib/dimCategories.ts`
- `src/features/teams/sub_mastermind/lib/dimMeta.ts`
- `src/features/teams/sub_mastermind/lib/dimActions.ts`
- `src/features/teams/sub_mastermind/lib/ink.ts`
- `src/features/teams/sub_mastermind/lib/layoutStore.ts`
- `src/features/teams/sub_mastermind/lib/positions.ts`
- `src/features/teams/sub_mastermind/lib/groups.ts`
- `src/features/teams/sub_mastermind/lib/links.ts`
- `src/features/teams/sub_mastermind/lib/notes.ts`
- `src/features/teams/sub_mastermind/lib/types.ts`
- `src/features/teams/sub_mastermind/lib/deriveScene.ts`
- `src/features/teams/sub_mastermind/variants/MastermindHexMosaic.tsx`
- `src/features/teams/sub_mastermind/variants/MastermindInverseGrid.tsx`
- `src/features/teams/sub_mastermind/variants/MosaicIsland.tsx`
- `src/features/teams/sub_mastermind/variants/InverseIsland.tsx`

**Entry points:** src/features/teams/sub_mastermind/lib/sceneStore.ts, src/features/teams/sub_mastermind/lib/liveState.ts, src/features/teams/sub_mastermind/lib/GroupLayer.tsx

**Keywords:** scene store, zustand, monitoring, sentry, scans, goals, llm-spend, fleet, data family, live state, group, link

**API surface:** getCrossProjectMetadata, listAllGoals, listScans, loadMonitoringSummaries (devTools IPC)

**Tech stack:** TypeScript, Zustand 5, Tauri 2

---

### mastermind-tests

Unit and integration tests covering the Mastermind canvas's core logic: scene derivation (status, edges, live state, idea-scan freshness, unknown family states), sceneStore lifecycle, layoutStore persistence and migration, canvas camera interactions, tidy-tree layout algorithm, keyboard navigation, dimension action decoration, and category grouping. Includes a passportFactory test helper for constructing minimal AppPassport fixtures.

**Files:**
- `src/features/teams/sub_mastermind/__tests__/deriveScene.edges.test.ts`
- `src/features/teams/sub_mastermind/__tests__/deriveScene.ideas.test.ts`
- `src/features/teams/sub_mastermind/__tests__/deriveScene.live.test.ts`
- `src/features/teams/sub_mastermind/__tests__/deriveScene.status.test.ts`
- `src/features/teams/sub_mastermind/__tests__/deriveScene.unknown.test.ts`
- `src/features/teams/sub_mastermind/__tests__/sceneStore.test.ts`
- `src/features/teams/sub_mastermind/__tests__/layoutStore.test.ts`
- `src/features/teams/sub_mastermind/__tests__/persistence.test.ts`
- `src/features/teams/sub_mastermind/__tests__/useCanvasCamera.test.ts`
- `src/features/teams/sub_mastermind/__tests__/tidyLayout.test.ts`
- `src/features/teams/sub_mastermind/__tests__/kbNav.test.ts`
- `src/features/teams/sub_mastermind/__tests__/liveState.test.ts`
- `src/features/teams/sub_mastermind/__tests__/dimActions.test.ts`
- `src/features/teams/sub_mastermind/__tests__/dimCategories.test.ts`
- `src/features/teams/sub_mastermind/__tests__/passportFactory.ts`

**Entry points:** src/features/teams/sub_mastermind/__tests__/deriveScene.status.test.ts

**Keywords:** test, vitest, derive scene, layout store, camera, keyboard nav, tidy layout, dim actions, passport factory

**Tech stack:** TypeScript, Vitest

---

### team-memory

Provides a shared knowledge store for teams — a paginated CRUD panel for team memories with category/search/run filters, importance ratings, timeline view, and run-diff summaries. The hook useTeamMemories orchestrates IPC calls against the team memories API and exposes filter, load-more, and CRUD handlers to panel components.

**Files:**
- `src/features/teams/sub_teamMemory/TeamMemoryPane.tsx`
- `src/features/teams/sub_teamMemory/useTeamMemories.ts`
- `src/features/teams/sub_teamMemory/index.ts`
- `src/features/teams/sub_teamMemory/libs/memoryConstants.ts`
- `src/features/teams/sub_teamMemory/libs/memoryDiff.ts`
- `src/features/teams/sub_teamMemory/libs/useRunDiffSummaries.ts`
- `src/features/teams/sub_teamMemory/components/panel/AddTeamMemoryForm.tsx`
- `src/features/teams/sub_teamMemory/components/panel/MemoryPanelHeader.tsx`
- `src/features/teams/sub_teamMemory/components/panel/MemoryPanelList.tsx`
- `src/features/teams/sub_teamMemory/components/panel/MemoryRowActions.tsx`
- `src/features/teams/sub_teamMemory/components/panel/MemoryRowDetail.tsx`
- `src/features/teams/sub_teamMemory/components/panel/TeamMemoryBadge.tsx`
- `src/features/teams/sub_teamMemory/components/panel/TeamMemoryPanel.tsx`
- `src/features/teams/sub_teamMemory/components/panel/TeamMemoryRow.tsx`
- `src/features/teams/sub_teamMemory/components/diff/DiffContent.tsx`
- `src/features/teams/sub_teamMemory/components/diff/DiffHeader.tsx`
- `src/features/teams/sub_teamMemory/components/diff/RunDiffView.tsx`
- `src/features/teams/sub_teamMemory/components/timeline/MemoryTimeline.tsx`
- `src/features/teams/sub_teamMemory/components/timeline/TimelineControls.tsx`
- `src/features/teams/sub_teamMemory/components/timeline/TimelineItem.tsx`

**Entry points:** src/features/teams/sub_teamMemory/useTeamMemories.ts, src/features/teams/sub_teamMemory/TeamMemoryPane.tsx

**Keywords:** memory, knowledge store, timeline, diff, category, importance, run filter

**API surface:** listTeamMemories, createTeamMemory, deleteTeamMemory, updateTeamMemory, getTeamMemoryStats

**Tech stack:** React 19, TypeScript, Tauri 2, Tailwind 4

---

### teams-canvas

Pipeline control panel, toolbar, optimizer, and debug tooling for the legacy team DAG canvas. The debugger supports dry-run step-through with variable inspection; the assistant provides a conversational interface for canvas edits; the optimizer analyses the pipeline for bottlenecks. All sit above the canvas core reducers. [Consolidated 2026-08-04: absorbed team-canvas-core, team-canvas-nodes-edges, team-assignment-tracking, mastermind-canvas-page]

**Files:**
- `src/features/teams/sub_canvas/components/PipelineControls.tsx`
- `src/features/teams/sub_canvas/components/TeamToolbar.tsx`
- `src/features/teams/sub_canvas/components/OptimizerPanel.tsx`
- `src/features/teams/sub_canvas/components/OptimizerResults.tsx`
- `src/features/teams/sub_canvas/components/debugger/DebuggerControls.tsx`
- `src/features/teams/sub_canvas/components/debugger/DebuggerStepView.tsx`
- `src/features/teams/sub_canvas/components/debugger/DebuggerVariables.tsx`
- `src/features/teams/sub_canvas/components/debugger/DryRunDebugger.tsx`
- `src/features/teams/sub_canvas/components/assistant/AssistantInput.tsx`
- `src/features/teams/sub_canvas/components/assistant/AssistantMessages.tsx`
- `src/features/teams/sub_canvas/components/assistant/CanvasAssistant.tsx`
- `src/features/teams/sub_canvas/libs/useDebugger.ts`
- `src/features/teams/sub_canvas/libs/debuggerMocks.ts`
- `src/features/teams/sub_canvas/libs/debuggerTypes.ts`
- `src/features/teams/sub_canvas/index.ts`
- `src/features/teams/sub_canvas/libs/CanvasDragContext.tsx`
- `src/features/teams/sub_canvas/libs/canvasActions.ts`
- `src/features/teams/sub_canvas/libs/teamConstants.tsx`
- `src/features/teams/sub_canvas/libs/teamGraph.ts`
- `src/features/teams/sub_canvas/libs/useCanvasReducer.ts`
- `src/features/teams/sub_canvas/libs/useDerivedCanvasState.ts`
- `src/features/teams/sub_canvas/components/AlignmentGuides.tsx`
- `src/features/teams/sub_canvas/components/edges/ConnectionEdge.tsx`
- `src/features/teams/sub_canvas/components/edges/ConnectionLegend.tsx`
- `src/features/teams/sub_canvas/components/edges/EdgeDeleteTooltip.tsx`
- `src/features/teams/sub_canvas/components/edges/GhostEdge.tsx`
- `src/features/teams/sub_canvas/components/nodes/NodeContextMenu.tsx`
- `src/features/teams/sub_canvas/components/nodes/PersonaNode.tsx`
- `src/features/teams/sub_canvas/components/nodes/StickyNoteNode.tsx`
- `src/features/teams/sub_assignments/index.ts`
- `src/features/teams/sub_assignments/useAssignmentProgressListener.ts`
- `src/features/teams/sub_assignments/useGlobalAssignmentProgressListener.ts`
- `src/features/teams/sub_assignments/useAssignmentNotificationDispatcher.ts`
- `src/features/teams/sub_mastermind/MastermindPage.tsx`

**Entry points:** src/features/teams/sub_canvas/components/debugger/DryRunDebugger.tsx, src/features/teams/sub_canvas/libs/useDebugger.ts, src/features/teams/sub_canvas/libs/useCanvasReducer.ts

**Keywords:** debugger, dry-run, step, optimizer, assistant, toolbar, pipeline controls, canvas, dag, graph, reducer, drag

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### teams-teamworkspace

Provides the top-level team selection and workspace entry point. Renders a team list when no team is selected, and hands off to TeamStudioSplitVariant when a team is chosen. Also hosts the auto-team modal and blueprint preview for team composition. [Consolidated 2026-08-04: absorbed team-preset-studio, team-studio]

**Files:**
- `src/features/teams/sub_teamWorkspace/TeamCanvas.tsx`
- `src/features/teams/sub_teamWorkspace/TeamList.tsx`
- `src/features/teams/sub_teamWorkspace/TeamColorPicker.tsx`
- `src/features/teams/sub_teamWorkspace/CreateTeamForm.tsx`
- `src/features/teams/sub_teamWorkspace/AutoTeamModal.tsx`
- `src/features/teams/sub_teamWorkspace/useAutoTeam.ts`
- `src/features/teams/sub_teamWorkspace/networkGlyphData.ts`
- `src/features/teams/sub_teamWorkspace/BlueprintPreview.tsx`
- `src/features/teams/components/TeamReadinessChip.tsx`
- `src/features/teams/sub_teamWorkspace/presetStudio/PresetStudio.tsx`
- `src/features/teams/sub_teamWorkspace/presetStudio/PresetConnectionGraph.tsx`
- `src/features/teams/sub_teamWorkspace/presetStudio/PresetProcessBlueprint.tsx`
- `src/features/teams/sub_teamWorkspace/presetStudio/PresetProcessHost.tsx`
- `src/features/teams/sub_teamWorkspace/presetStudio/PresetGalleryShowcase.tsx`
- `src/features/teams/sub_teamWorkspace/presetStudio/presetBackground.ts`
- `src/features/teams/sub_teamWorkspace/presetStudio/presetStudioShared.tsx`
- `src/features/teams/sub_teamWorkspace/presetStudio/types.ts`
- `src/features/teams/sub_teamWorkspace/presetStudio/index.ts`
- `src/features/teams/sub_teamWorkspace/teamStudio/TeamStudioSplitVariant.tsx`
- `src/features/teams/sub_teamWorkspace/teamStudio/TeamWorkspacePane.tsx`
- `src/features/teams/sub_teamWorkspace/teamStudio/AssignmentReplay.tsx`
- `src/features/teams/sub_teamWorkspace/teamStudio/TeamPublishButton.tsx`
- `src/features/teams/sub_teamWorkspace/teamStudio/PublishPresetButton.tsx`
- `src/features/teams/sub_teamWorkspace/teamStudio/boardShared.tsx`
- `src/features/teams/sub_teamWorkspace/teamStudio/teamStudioShared.tsx`
- `src/features/teams/sub_teamWorkspace/teamStudio/useTeamStudioData.ts`

**Entry points:** src/features/teams/sub_teamWorkspace/TeamCanvas.tsx, src/features/teams/sub_teamWorkspace/TeamList.tsx, src/features/teams/sub_teamWorkspace/presetStudio/PresetStudio.tsx

**Keywords:** team, workspace, auto-team, roster, blueprint, readiness, pipeline, preset, gallery, team template, adoption, connection graph

**API surface:** pipelineStore.teams, pipelineStore.selectTeam

**Tech stack:** React 19, TypeScript, Zustand 5, Tailwind 4, Tauri 2

---

## Security & Credentials

> **Group type:** infrastructure
> **Color:** red

### api-key-management

Manages API keys that third-party MCP clients use to authenticate against the local HTTP management server (port 9420). Handles full key lifecycle: creation with scoped permissions and optional expiry, one-time plaintext reveal dialog, soft revocation with audit trail, hard deletion, stale-key detection, and per-key audit log drawer. Also manages origin-bound 'Connected Apps' (cloud application OAuth-style pairings) and an MCP server liveness status panel. Depends on the external_api_keys and pairing command modules in Rust.

**Files:**
- `src/features/settings/sub_api_keys/components/ApiKeyAuditDrawer.tsx`
- `src/features/settings/sub_api_keys/components/ApiKeysSettings.tsx`
- `src/features/settings/sub_api_keys/components/CreateApiKeyDialog.tsx`
- `src/features/settings/sub_api_keys/components/CreatedKeyDialog.tsx`
- `src/features/settings/sub_api_keys/components/ExecutePersonaPicker.tsx`
- `src/features/settings/sub_api_keys/components/McpServerInfoPanel.tsx`
- `src/features/settings/sub_api_keys/components/PairApprovalModal.tsx`
- `src/features/settings/sub_api_keys/libs/mcpServer.ts`

**Entry points:** src/features/settings/sub_api_keys/components/ApiKeysSettings.tsx

**Keywords:** api-key, MCP, authentication, token, revoke, pairing, scope, external-client, audit

**API surface:** createExternalApiKey, listExternalApiKeys, revokeExternalApiKey, deleteExternalApiKey, listApiKeyAudit; revokePairing; probeMcpServer (http://127.0.0.1:9420)

**Tech stack:** React 19, TypeScript, Tauri 2

---

### api-vault

IPC wrappers for the multiple pathways to acquire and populate credentials: OAuth gateway flows (Google, generic providers), automated browser-based credential capture (Chromium subprocess, 11-min timeout), AI-guided credential design, and credential recipe caching (connector → field prefill recipes ranked by usage). Together these minimize friction in getting a credential from zero to healthcheck-passing. [Consolidated 2026-08-04: absorbed credential-core-api, database-explorer-api, vault-intelligence-api]

**Files:**
- `src/api/vault/oauthGatewayApi.ts`
- `src/api/vault/autoCredBrowser.ts`
- `src/api/vault/credentialDesignApi.ts`
- `src/api/vault/credentialRecipes.ts`
- `src/api/vault/credentials.ts`
- `src/api/vault/rotation.ts`
- `src/api/vault/database/nlQuery.ts`
- `src/api/vault/database/dbSchema.ts`
- `src/api/vault/database/schemaProposal.ts`
- `src/api/vault/foraging.ts`
- `src/api/vault/negotiator.ts`
- `src/api/vault/database/vectorKb.ts`

**Entry points:** src/api/vault/oauthGatewayApi.ts, src/api/vault/autoCredBrowser.ts, src/api/vault/credentials.ts

**Keywords:** OAuth, browser automation, Chromium, credential recipe, AI design, token, Google OAuth, provider, acquisition, PKCE, credential, vault

**API surface:** Tauri commands: start_google_credential_oauth, start_auto_cred_browser, start_credential_design, get_credential_recipe, upsert_credential_recipe

**Tech stack:** Tauri 2, TypeScript, React 19

---

### commands-credentials

Authentication and credential acquisition flows — OAuth browser flow, CLI token capture, automatic credential detection from running processes, desktop keychain bridge, foraging (scanning local configs for existing keys), and negotiator (interactive step-by-step credential setup). These commands bring credentials in from the environment. [Consolidated 2026-08-04: absorbed connector-management, credential-intelligence, mcp-gateway]

**Files:**
- `src-tauri/src/commands/credentials/oauth.rs`
- `src-tauri/src/commands/credentials/auth_detect.rs`
- `src-tauri/src/commands/credentials/auto_cred_browser.rs`
- `src-tauri/src/commands/credentials/cli_capture.rs`
- `src-tauri/src/commands/credentials/desktop.rs`
- `src-tauri/src/commands/credentials/desktop_bridges.rs`
- `src-tauri/src/commands/credentials/negotiator.rs`
- `src-tauri/src/commands/credentials/foraging.rs`
- `src-tauri/src/commands/credentials/connectors.rs`
- `src-tauri/src/commands/credentials/credential_design.rs`
- `src-tauri/src/commands/credentials/credential_recipes.rs`
- `src-tauri/src/commands/credentials/discovery.rs`
- `src-tauri/src/commands/credentials/schema_proposal.rs`
- `src-tauri/src/commands/credentials/intelligence.rs`
- `src-tauri/src/commands/credentials/nl_query.rs`
- `src-tauri/src/commands/credentials/query_debug.rs`
- `src-tauri/src/commands/credentials/api_proxy.rs`
- `src-tauri/src/commands/credentials/ai_artifact_flow.rs`
- `src-tauri/src/commands/credentials/external_api_keys.rs`
- `src-tauri/src/commands/credentials/openapi_autopilot.rs`
- `src-tauri/src/commands/credentials/mcp_gateways.rs`
- `src-tauri/src/commands/credentials/mcp_tools.rs`
- `src-tauri/src/commands/credentials/vector_kb.rs`

**Entry points:** src-tauri/src/commands/credentials/oauth.rs, src-tauri/src/commands/credentials/connectors.rs, src-tauri/src/commands/credentials/ai_artifact_flow.rs

**Keywords:** oauth, browser, keychain, cli-capture, forage, negotiate, detect, connector, schema, design, discover, recipe

**API surface:** start_oauth_flow, capture_cli_credential, detect_existing_auth, negotiate_credential_setup

**Tech stack:** Tauri 2, Rust, OAuth 2.0, keyring

---

### lib-credentials

Defines the static catalog of builtin connectors (Airtable, GitHub, Notion, etc.) loaded from JSON seeds, plus cross-cutting metadata: functional role groupings (source_control, ci_cd, knowledge_base…), per-connector audience tags (developer/support/manager), and license tier classification (personal/paid/enterprise). Together these power the connector picker's filter, search, and role-interchange UI. Depends on connector JSON seeds under scripts/connectors/builtin/ and i18n types. [Consolidated 2026-08-04: absorbed connector-api-endpoints, connector-catalog-tests, credential-ledger-parsing, credential-recipe-registry, credential-remediation]

**Files:**
- `src/lib/credentials/builtinConnectors.ts`
- `src/lib/credentials/connectorRoles.ts`
- `src/lib/credentials/connectorAudiences.ts`
- `src/lib/credentials/connectorLicensing.ts`
- `src/lib/credentials/catalogApiEndpoints.ts`
- `src/lib/credentials/__tests__/builtinConnectors.test.ts`
- `src/lib/credentials/parseCredentialLedger.ts`
- `src/lib/credentials/credentialRecipeRegistry.ts`
- `src/lib/credentials/remediationBus.ts`
- `src/lib/credentials/remediationExecutor.ts`

**Entry points:** src/lib/credentials/builtinConnectors.ts, src/lib/credentials/catalogApiEndpoints.ts, src/lib/credentials/__tests__/builtinConnectors.test.ts

**Keywords:** connector, catalog, builtin, role, audience, license, tier, picker, integration, api, endpoint, openapi

**Tech stack:** TypeScript, React 19

---

### output-stream-parser

Parses the raw JSONL output stream from Claude CLI into typed protocol messages and stream line events. Handles tool use blocks, subagent fan-out attribution (P4), message chunking, safe JSON sanitization, and tool outcome classification. Forms the boundary between raw CLI bytes and typed execution events. [Consolidated 2026-08-04: absorbed outbound-notifications, ai-self-healing, api-proxy-access, credential-lifecycle, desktop-app-bridges, director-coaching, engine-shared-utilities]

**Files:**
- `src-tauri/engine/src/parser.rs`
- `src-tauri/engine/src/protocol.rs`
- `src-tauri/engine/src/chunker.rs`
- `src-tauri/engine/src/safe_json.rs`
- `src-tauri/engine/src/tool_outcome.rs`
- `src-tauri/src/engine/webhook_notifier.rs`
- `src-tauri/src/engine/shared_event_relay.rs`
- `src-tauri/src/engine/discord_poller.rs`
- `src-tauri/src/engine/slack_poller.rs`
- `src-tauri/src/engine/digest.rs`
- `src-tauri/engine/src/ai_healing.rs`
- `src-tauri/engine/src/healing_orchestrator.rs`
- `src-tauri/engine/src/healing_timeline.rs`
- `src-tauri/engine/src/fix_loop.rs`
- `src-tauri/src/engine/api_proxy.rs`
- `src-tauri/src/engine/capability.rs`
- `src-tauri/src/engine/resource_listing.rs`
- `src-tauri/src/engine/db_query.rs`
- `src-tauri/src/engine/rotation.rs`
- `src-tauri/src/engine/oauth_refresh.rs`
- `src-tauri/src/engine/connector_strategy.rs`
- `src-tauri/src/engine/healthcheck.rs`
- `src-tauri/engine/src/desktop_bridges.rs`
- `src-tauri/engine/src/desktop_discovery.rs`
- `src-tauri/engine/src/desktop_runtime.rs`
- `src-tauri/engine/src/bridge_manifest/mod.rs`
- `src-tauri/src/engine/director.rs`
- `src-tauri/src/engine/director_brain.rs`
- `src-tauri/src/engine/director_memory.rs`
- `src-tauri/src/engine/deliberation.rs`
- `src-tauri/engine/src/str_utils.rs`
- `src-tauri/engine/src/config_merge.rs`
- `src-tauri/engine/src/persona_icon.rs`
- `src-tauri/engine/src/lib.rs`

**Entry points:** src-tauri/engine/src/parser.rs, src-tauri/engine/src/protocol.rs, src-tauri/src/engine/webhook_notifier.rs

**Keywords:** parser, jsonl, stream, protocol, tool-use, subagent, chunk, message-type, webhook, notification, Slack, Discord

**Tech stack:** Rust, serde_json

---

### stores-slices-vault

Slices managing credential rotation policies, automation workflows tied to credentials, and catalog UI preferences (filters, sort order, view mode). The rotation slice tracks scheduled and on-demand rotation jobs; the rotationOverview selector derives summary stats for the catalog header. [Consolidated 2026-08-04: absorbed vault-credentials-state, vault-database-state]

**Files:**
- `src/stores/slices/vault/rotationSlice.ts`
- `src/stores/slices/vault/automationSlice.ts`
- `src/stores/slices/vault/catalogPrefsSlice.ts`
- `src/stores/selectors/rotationOverview.ts`
- `src/stores/slices/vault/credentialSlice.ts`
- `src/stores/slices/vault/credentialSlice.race.test.ts`
- `src/stores/__tests__/databaseSlice.test.ts`
- `src/stores/slices/vault/databaseSlice.ts`

**Entry points:** src/stores/slices/vault/rotationSlice.ts, src/stores/slices/vault/credentialSlice.ts, src/stores/slices/vault/databaseSlice.ts

**Keywords:** rotation, automation, catalog, prefs, policy, schedule, credential-lifecycle, credential, connector, healthcheck, encrypt, secret

**Tech stack:** Zustand 5, TypeScript, Tauri IPC

---

### vault-catalog-autocred-ui

Automated credential harvesting UI that drives a Playwright browser session to extract API keys from a service's developer portal. The wizard walks through Consent→Browser→Review steps; AutoCredPanel is the root; BrowserDetail shows the live Playwright session; AutoCredReview lets the user confirm extracted values before saving. [Consolidated 2026-08-04: absorbed vault-catalog-design-modal, vault-catalog-desktop]

**Files:**
- `src/features/vault/sub_catalog/components/autoCred/display/AutoCredCards.tsx`
- `src/features/vault/sub_catalog/components/autoCred/display/AutoCredErrorDisplay.tsx`
- `src/features/vault/sub_catalog/components/autoCred/display/AutoCredLogEntries.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/AutoCredBrowser.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/AutoCredBrowserError.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/AutoCredConsent.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/AutoCredModeBanner.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/AutoCredPanel.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/AutoCredReview.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/BrowserDetail.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/CatalogAutoSetup.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/index.ts`
- `src/features/vault/sub_catalog/components/autoCred/steps/ReviewActions.tsx`
- `src/features/vault/sub_catalog/components/autoCred/steps/SetupSteps.tsx`
- `src/features/vault/sub_catalog/components/design/CredentialDesignContext.tsx`
- `src/features/vault/sub_catalog/components/design/CredentialDesignModal.tsx`
- `src/features/vault/sub_catalog/components/design/CredentialDesignModalBody.tsx`
- `src/features/vault/sub_catalog/components/design/credentialDesignModalTypes.ts`
- `src/features/vault/sub_catalog/components/design/useCredentialDesignModal.ts`
- `src/features/vault/sub_catalog/components/design/phases/AnalyzingPhase.tsx`
- `src/features/vault/sub_catalog/components/design/phases/DonePhase.tsx`
- `src/features/vault/sub_catalog/components/design/phases/ErrorPhase.tsx`
- `src/features/vault/sub_catalog/components/design/phases/IdlePhase.tsx`
- `src/features/vault/sub_catalog/components/design/phases/IdleSuggestions.tsx`
- `src/features/vault/sub_catalog/components/design/phases/PreviewBanners.tsx`
- `src/features/vault/sub_catalog/components/design/phases/PreviewPhase.tsx`
- `src/features/vault/sub_catalog/components/design/phases/RecipeConfidenceBanner.tsx`
- `src/features/vault/sub_catalog/components/desktop/CapabilityApprovalCard.tsx`
- `src/features/vault/sub_catalog/components/desktop/DesktopAppCard.tsx`
- `src/features/vault/sub_catalog/components/desktop/DesktopDiscoveryPanel.tsx`
- `src/features/vault/sub_catalog/components/desktop/DiscoveryAppList.tsx`
- `src/features/vault/sub_catalog/components/desktop/DiscoveryMcpList.tsx`
- `src/features/vault/sub_catalog/components/desktop/McpServerCard.tsx`

**Entry points:** src/features/vault/sub_catalog/components/autoCred/steps/AutoCredPanel.tsx, src/features/vault/sub_catalog/components/autoCred/steps/CatalogAutoSetup.tsx, src/features/vault/sub_catalog/components/design/CredentialDesignModal.tsx

**Keywords:** autocred, playwright, browser, automated, harvest, extract, consent, design, AI, credential-design, phases, modal

**API surface:** Playwright MCP: playwright_navigate, playwright_snapshot, playwright_fill, playwright_click

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### vault-catalog-picker

The main connector catalog grid that lets users browse, search, and filter available connector types before adding a credential. CredentialPicker is the root; PickerGrid renders connector cards; CredentialPickerFilters provides role-based and category filtering; usePickerFilters drives filter state; useRecipeIndicators shows which connectors already have recipes. [Consolidated 2026-08-04: absorbed vault-catalog-design-orchestrator, vault-catalog-negotiator, vault-catalog-foraging]

**Files:**
- `src/features/vault/sub_catalog/components/picker/catalogRolePresets.ts`
- `src/features/vault/sub_catalog/components/picker/CliConnectionPanel.tsx`
- `src/features/vault/sub_catalog/components/picker/ConnectorCard.tsx`
- `src/features/vault/sub_catalog/components/picker/connectorCardConstants.ts`
- `src/features/vault/sub_catalog/components/picker/CredentialPicker.tsx`
- `src/features/vault/sub_catalog/components/picker/CredentialPickerFilters.tsx`
- `src/features/vault/sub_catalog/components/picker/PickerGrid.tsx`
- `src/features/vault/sub_catalog/components/picker/usePickerFilters.ts`
- `src/features/vault/sub_catalog/components/picker/useRecipeIndicators.ts`
- `src/features/vault/sub_catalog/components/design/CredentialDesignHelpers.ts`
- `src/features/vault/sub_catalog/components/design/orchestratorContext.ts`
- `src/features/vault/sub_catalog/components/design/orchestratorDerived.ts`
- `src/features/vault/sub_catalog/components/design/orchestratorTypes.ts`
- `src/features/vault/sub_catalog/components/design/useCredentialDesignOrchestrator.ts`
- `src/features/vault/sub_catalog/components/design/setup/InteractiveSetupInstructions.tsx`
- `src/features/vault/sub_catalog/components/design/setup/setupInstructionHelpers.tsx`
- `src/features/vault/sub_catalog/components/design/setup/setupMarkdownComponents.tsx`
- `src/features/vault/sub_catalog/components/design/setup/SetupStepCard.tsx`
- `src/features/vault/sub_catalog/components/negotiator/GuidingStepList.tsx`
- `src/features/vault/sub_catalog/components/negotiator/NegotiatorGuidingPhase.tsx`
- `src/features/vault/sub_catalog/components/negotiator/negotiatorMotion.ts`
- `src/features/vault/sub_catalog/components/negotiator/NegotiatorPanel.tsx`
- `src/features/vault/sub_catalog/components/negotiator/NegotiatorPhases.tsx`
- `src/features/vault/sub_catalog/components/negotiator/NegotiatorPlanningPhase.tsx`
- `src/features/vault/sub_catalog/components/negotiator/NegotiatorStepCard.tsx`
- `src/features/vault/sub_catalog/components/negotiator/NegotiatorStepCardHelpers.tsx`
- `src/features/vault/sub_catalog/components/negotiator/StepActions.tsx`
- `src/features/vault/sub_catalog/components/foraging/ForagingConsent.tsx`
- `src/features/vault/sub_catalog/components/foraging/ForagingPanel.tsx`
- `src/features/vault/sub_catalog/components/foraging/ForagingResultCard.tsx`
- `src/features/vault/sub_catalog/components/foraging/ForagingResults.tsx`
- `src/features/vault/sub_catalog/components/foraging/ForagingStatusPanels.tsx`
- `src/features/vault/sub_catalog/components/foraging/ForagingStepIndicator.tsx`

**Entry points:** src/features/vault/sub_catalog/components/picker/CredentialPicker.tsx, src/features/vault/sub_catalog/components/design/useCredentialDesignOrchestrator.ts, src/features/vault/sub_catalog/components/negotiator/NegotiatorPanel.tsx

**Keywords:** catalog, connector, picker, filter, grid, role, recipe, orchestrator, design, oauth, setup-instructions, markdown

**Tech stack:** React 19, TypeScript, Zustand 5, Tailwind 4

---

### vault-catalog-schemas

Connector schema-driven form rendering. CredentialSchemaForm renders a dynamic form from a connector's JSON auth schema; SchemaFormFields maps schema field types to React inputs; ExtraFieldRenderers handles non-standard field types; McpPrefilledForm pre-fills known MCP server fields; schemaConfigs centralizes per-connector field overrides. [Consolidated 2026-08-04: absorbed vault-catalog-forms, vault-catalog-autocred-session, vault-root-components]

**Files:**
- `src/features/vault/sub_catalog/components/schemas/CredentialSchemaForm.tsx`
- `src/features/vault/sub_catalog/components/schemas/ExtraFieldRenderers.tsx`
- `src/features/vault/sub_catalog/components/schemas/McpPrefilledForm.tsx`
- `src/features/vault/sub_catalog/components/schemas/schemaConfigs.tsx`
- `src/features/vault/sub_catalog/components/schemas/SchemaFormFields.tsx`
- `src/features/vault/sub_catalog/components/schemas/schemaFormTypes.ts`
- `src/features/vault/sub_catalog/components/forms/CodebaseProjectPicker.tsx`
- `src/features/vault/sub_catalog/components/forms/CredentialTemplateForm.tsx`
- `src/features/vault/sub_catalog/components/forms/CredentialTypePicker.tsx`
- `src/features/vault/sub_catalog/components/forms/ProjectList.tsx`
- `src/features/vault/sub_catalog/components/forms/TemplateFormBody.tsx`
- `src/features/vault/sub_catalog/components/forms/__tests__/TemplateFormBody.test.tsx`
- `src/features/vault/sub_catalog/components/autoCred/helpers/autoCredErrorConfig.ts`
- `src/features/vault/sub_catalog/components/autoCred/helpers/autoCredHelpers.ts`
- `src/features/vault/sub_catalog/components/autoCred/helpers/TauriPlaywrightAdapter.ts`
- `src/features/vault/sub_catalog/components/autoCred/helpers/types.ts`
- `src/features/vault/sub_catalog/components/autoCred/helpers/useAutoCredSession.ts`
- `src/features/vault/components/CredentialPickerCards.tsx`
- `src/features/vault/components/SetupStatusBadge.tsx`
- `src/features/vault/components/VaultConnectorPicker.tsx`

**Entry points:** src/features/vault/sub_catalog/components/schemas/CredentialSchemaForm.tsx, src/features/vault/sub_catalog/components/forms/CredentialTemplateForm.tsx, src/features/vault/sub_catalog/components/autoCred/helpers/useAutoCredSession.ts

**Keywords:** schema, form, dynamic, MCP, connector, field-type, auth-schema, template, credential-type, project, codebase, picker

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### vault-credentials-components-features

Credential intelligence panels displayed in the credential detail view. Covers anomaly score display, audit log table, scope section, event template configuration, and the CredentialIntelligence aggregate panel. These surfaces give operators visibility into credential usage patterns and abnormal activity detected by the backend. [Consolidated 2026-08-04: absorbed vault-credential-rotation, vault-credential-resource-picker, vault-credential-team-access]

**Files:**
- `src/features/vault/sub_credentials/components/features/AnomalyScorePanel.tsx`
- `src/features/vault/sub_credentials/components/features/AuditLogTable.tsx`
- `src/features/vault/sub_credentials/components/features/CredentialEventConfig.tsx`
- `src/features/vault/sub_credentials/components/features/CredentialIntelligence.tsx`
- `src/features/vault/sub_credentials/components/features/CredentialScopeSection.tsx`
- `src/features/vault/sub_credentials/components/features/EventConfigSubPanels.tsx`
- `src/features/vault/sub_credentials/components/features/EventTemplateCard.tsx`
- `src/features/vault/sub_credentials/components/features/IntelligenceStatCard.tsx`
- `src/features/vault/sub_credentials/components/features/CredentialRotationSection.tsx`
- `src/features/vault/sub_credentials/components/features/RotationActivePolicy.tsx`
- `src/features/vault/sub_credentials/components/features/RotationCountdownRing.tsx`
- `src/features/vault/sub_credentials/components/features/RotationNewPolicy.tsx`
- `src/features/vault/sub_credentials/components/features/RotationPolicyControls.tsx`
- `src/features/vault/sub_credentials/components/picker/ResourcePicker.tsx`
- `src/features/vault/sub_credentials/components/picker/ResourcePickerHost.tsx`
- `src/features/vault/sub_credentials/components/picker/resourcePickerStore.ts`
- `src/features/vault/sub_credentials/components/picker/usePostSaveResourcePicker.tsx`
- `src/features/vault/sub_credentials/components/gateway/GatewayMembersModal.tsx`
- `src/features/vault/sub_credentials/components/gateway/PendingAuthModal.tsx`
- `src/features/vault/sub_credentials/components/workspace/ProviderSection.tsx`
- `src/features/vault/sub_credentials/components/workspace/useWorkspaceConnect.ts`
- `src/features/vault/sub_credentials/components/workspace/WorkspaceConnectPanel.tsx`
- `src/features/vault/sub_credentials/components/workspace/workspaceProviders.ts`
- `src/features/vault/sub_credentials/components/workspace/WorkspaceSubComponents.tsx`

**Entry points:** src/features/vault/sub_credentials/components/features/CredentialIntelligence.tsx, src/features/vault/sub_credentials/components/features/CredentialRotationSection.tsx, src/features/vault/sub_credentials/components/picker/ResourcePicker.tsx

**Keywords:** anomaly, audit-log, intelligence, scope, events, health, credential, rotation, policy, countdown, schedule, secret

**API surface:** Tauri IPC: get_credential_audit_log, get_anomaly_score, list_credential_events

**Tech stack:** React 19, TypeScript, Zustand 5, Tailwind 4

---

### vault-credentials-components-forms

Credential creation and editing forms, covering auth-method tabs (API key, OAuth, basic, MCP), field capture rows, connection-test section, OAuth progress ring, and setup guide. ConnectorCredentialModal is the primary modal; CredentialEditForm handles the form state. Renders different field renderers depending on the connector's authentication schema. [Consolidated 2026-08-04: absorbed vault-credential-card-banners, vault-credential-import, vault-credentials-list]

**Files:**
- `src/features/vault/sub_credentials/components/forms/AuthMethodTabs.tsx`
- `src/features/vault/sub_credentials/components/forms/ConnectionTestSection.tsx`
- `src/features/vault/sub_credentials/components/forms/ConnectorCredentialModal.tsx`
- `src/features/vault/sub_credentials/components/forms/CredentialEditForm.tsx`
- `src/features/vault/sub_credentials/components/forms/EditFormFields.tsx`
- `src/features/vault/sub_credentials/components/forms/FieldCaptureHelpers.tsx`
- `src/features/vault/sub_credentials/components/forms/FieldCaptureRow.tsx`
- `src/features/vault/sub_credentials/components/forms/FormActions.tsx`
- `src/features/vault/sub_credentials/components/forms/HealthcheckResultDisplay.tsx`
- `src/features/vault/sub_credentials/components/forms/OAuthProgressRing.tsx`
- `src/features/vault/sub_credentials/components/forms/OAuthSection.tsx`
- `src/features/vault/sub_credentials/components/forms/SetupGuideSection.tsx`
- `src/features/vault/sub_credentials/components/forms/TemplateFormHeader.tsx`
- `src/features/vault/sub_credentials/components/card/badges/CompositeHealthDot.tsx`
- `src/features/vault/sub_credentials/components/card/banners/ReauthBanner.tsx`
- `src/features/vault/sub_credentials/components/card/banners/ScopeMismatchBanner.tsx`
- `src/features/vault/sub_credentials/components/card/banners/VaultErrorBanner.tsx`
- `src/features/vault/sub_credentials/components/card/CredentialDeleteDialog.tsx`
- `src/features/vault/sub_credentials/components/import/importHelpers.ts`
- `src/features/vault/sub_credentials/components/import/ImportInputPhase.tsx`
- `src/features/vault/sub_credentials/components/import/ImportPreview.tsx`
- `src/features/vault/sub_credentials/components/import/ImportSourcePicker.tsx`
- `src/features/vault/sub_credentials/components/import/ImportSyncConfig.tsx`
- `src/features/vault/sub_credentials/components/import/index.ts`
- `src/features/vault/sub_credentials/components/import/useCredentialImport.ts`
- `src/features/vault/sub_credentials/components/list/CredentialDetailModals.tsx`
- `src/features/vault/sub_credentials/components/list/CredentialList.tsx`
- `src/features/vault/sub_credentials/components/list/CredentialListColumns.tsx`
- `src/features/vault/sub_credentials/components/list/credentialListTypes.ts`
- `src/features/vault/sub_credentials/components/list/EmptyStateView.tsx`
- `src/features/vault/sub_credentials/components/list/useCredentialListFilters.ts`

**Entry points:** src/features/vault/sub_credentials/components/forms/ConnectorCredentialModal.tsx, src/features/vault/sub_credentials/components/forms/CredentialEditForm.tsx, src/features/vault/sub_credentials/components/card/banners/ReauthBanner.tsx

**Keywords:** credential-form, oauth, api-key, auth-method, connection-test, field-capture, banner, reauth, scope-mismatch, health-dot, delete, vault-error

**API surface:** Tauri IPC: save_credential, test_credential_connection, oauth_consent

**Tech stack:** React 19, TypeScript, Tailwind 4, Tauri 2

---

### vault-credentials-manager

Top-level credential manager shell that coordinates the full credential management workflow. Orchestrates the credential list, add-views, breadcrumb navigation, trust badge, rotate-all action, undo-delete, and re-auth banner. useCredentialManagerState drives the FSM (list / add / detail views) via a reducer dispatch; CredentialManagerViews renders the active view.

**Files:**
- `src/features/vault/sub_credentials/manager/CredentialManager.tsx`
- `src/features/vault/sub_credentials/manager/CredentialManagerHeader.tsx`
- `src/features/vault/sub_credentials/manager/CredentialManagerViews.tsx`
- `src/features/vault/sub_credentials/manager/HeaderActionButtons.tsx`
- `src/features/vault/sub_credentials/manager/useCatalogHandlers.ts`
- `src/features/vault/sub_credentials/manager/useCredentialManagerState.ts`
- `src/features/vault/sub_credentials/manager/useRotateAll.ts`
- `src/features/vault/sub_credentials/manager/VaultBreadcrumb.tsx`
- `src/features/vault/sub_credentials/manager/VaultTrustBadge.tsx`
- `src/features/vault/sub_credentials/manager/CredentialAddViews.tsx`

**Entry points:** src/features/vault/sub_credentials/manager/CredentialManager.tsx, src/features/vault/sub_credentials/manager/useCredentialManagerState.ts

**Keywords:** credential-manager, rotate-all, vault, breadcrumb, trust, FSM, undo-delete

**API surface:** Tauri IPC: rotate_all_credentials, fetch_credentials

**Tech stack:** React 19, TypeScript, Zustand 5, Tauri 2

---

### vault-dependency-graph

Interactive credential relationship graph showing how credentials are connected to personas, recipes, and other credentials. CredentialRelationshipGraph is the root; GraphCanvas renders a force-directed D3 layout; BlastRadiusPanel shows impact analysis when a credential is revoked; SimulationPanel and SimulationControls let the user model revocation scenarios; credentialGraph.ts contains the pure graph algorithms.

**Files:**
- `src/features/vault/sub_dependencies/BlastRadiusPanel.tsx`
- `src/features/vault/sub_dependencies/credentialGraph.ts`
- `src/features/vault/sub_dependencies/credentialGraph.test.ts`
- `src/features/vault/sub_dependencies/CredentialRelationshipGraph.tsx`
- `src/features/vault/sub_dependencies/GraphCanvas.tsx`
- `src/features/vault/sub_dependencies/graphConstants.ts`
- `src/features/vault/sub_dependencies/GraphControls.tsx`
- `src/features/vault/sub_dependencies/graphLayout.ts`
- `src/features/vault/sub_dependencies/NodeChip.tsx`
- `src/features/vault/sub_dependencies/NodeDetailPanel.tsx`
- `src/features/vault/sub_dependencies/SimulationControls.tsx`
- `src/features/vault/sub_dependencies/SimulationPanel.tsx`

**Entry points:** src/features/vault/sub_dependencies/CredentialRelationshipGraph.tsx, src/features/vault/sub_dependencies/credentialGraph.ts

**Keywords:** dependency-graph, blast-radius, revocation, force-directed, simulation, persona, relationship

**API surface:** Tauri IPC: get_credential_dependents

**Tech stack:** React 19, TypeScript, D3, Zustand 5, Vitest

---

### vault-shared-hooks

Cross-cutting React hooks shared by all vault sub-features. Covers credential OAuth flows (Google, universal), credential renaming, tag management, undo-delete, rotation ticker, vault status polling with module-level IPC cache, credential view FSM, navigation context, and the three-state health-check system (bulk healthcheck, per-credential health, and remediation evaluator). Acts as the primary shared hook library for vault UI state.

**Files:**
- `src/features/vault/shared/hooks/CredentialNavContext.tsx`
- `src/features/vault/shared/hooks/useCredentialOAuth.ts`
- `src/features/vault/shared/hooks/useCredentialRename.ts`
- `src/features/vault/shared/hooks/useCredentialTags.ts`
- `src/features/vault/shared/hooks/useCredentialViewFSM.ts`
- `src/features/vault/shared/hooks/useGoogleOAuth.ts`
- `src/features/vault/shared/hooks/useRotationTicker.ts`
- `src/features/vault/shared/hooks/useUndoDelete.ts`
- `src/features/vault/shared/hooks/useVaultStatus.ts`
- `src/features/vault/shared/hooks/health/useBulkHealthcheck.ts`
- `src/features/vault/shared/hooks/health/useCredentialHealth.ts`
- `src/features/vault/shared/hooks/health/useRemediationEvaluator.ts`

**Entry points:** src/features/vault/shared/hooks/useVaultStatus.ts, src/features/vault/shared/hooks/health/useCredentialHealth.ts

**Keywords:** oauth, healthcheck, rotation, rename, tags, vault-status, remediation, FSM, undo

**API surface:** Wraps IPC: vaultStatus, credential health, bulk healthcheck, OAuth consent

**Tech stack:** React 19, TypeScript

---

### vault-shared-playground

Tab views within the API playground modal: Overview (connector summary, health), API Explorer (endpoint list, request firing, response viewer), MCP Tools (list/invoke MCP tools per server), Executions (recent test runs), and recipe creation flow. useApiExplorerState manages the explorer tab's selected endpoint and response history. [Consolidated 2026-08-04: absorbed vault-api-playground-shell, vault-shared-utils]

**Files:**
- `src/features/vault/shared/playground/tabs/apiExplorerHelpers.ts`
- `src/features/vault/shared/playground/tabs/ApiExplorerSubComponents.tsx`
- `src/features/vault/shared/playground/tabs/ApiExplorerTab.tsx`
- `src/features/vault/shared/playground/tabs/ExecutionsTab.tsx`
- `src/features/vault/shared/playground/tabs/McpToolInputForm.tsx`
- `src/features/vault/shared/playground/tabs/McpToolResultDisplay.tsx`
- `src/features/vault/shared/playground/tabs/McpToolRow.tsx`
- `src/features/vault/shared/playground/tabs/McpToolsTab.tsx`
- `src/features/vault/shared/playground/tabs/OverviewSections.tsx`
- `src/features/vault/shared/playground/tabs/OverviewTab.tsx`
- `src/features/vault/shared/playground/tabs/RecipeCreateFlow.tsx`
- `src/features/vault/shared/playground/tabs/RecipeListItem.tsx`
- `src/features/vault/shared/playground/tabs/ResponseView.tsx`
- `src/features/vault/shared/playground/tabs/ToolDetail.tsx`
- `src/features/vault/shared/playground/tabs/useApiExplorerState.ts`
- `src/features/vault/shared/playground/BuilderParams.tsx`
- `src/features/vault/shared/playground/CredentialPlaygroundModal.tsx`
- `src/features/vault/shared/playground/EndpointRow.tsx`
- `src/features/vault/shared/playground/PlaygroundHeader.tsx`
- `src/features/vault/shared/playground/PlaygroundTabContent.tsx`
- `src/features/vault/shared/playground/prettyJson.ts`
- `src/features/vault/shared/playground/RequestBuilder.tsx`
- `src/features/vault/shared/playground/ResponseViewer.tsx`
- `src/features/vault/shared/playground/useApiTestRunner.ts`
- `src/features/vault/shared/utils/authMethodStyles.ts`
- `src/features/vault/shared/utils/credentialHealthScore.ts`
- `src/features/vault/shared/utils/credentialTags.ts`
- `src/features/vault/shared/utils/__tests__/credentialHealthScore.threestate.test.ts`

**Entry points:** src/features/vault/shared/playground/tabs/ApiExplorerTab.tsx, src/features/vault/shared/playground/tabs/McpToolsTab.tsx, src/features/vault/shared/playground/CredentialPlaygroundModal.tsx

**Keywords:** API-explorer, MCP-tools, executions, recipe, overview, tool-invoke, playground, API, test, request-builder, response, endpoint

**API surface:** Tauri IPC: invoke_mcp_tool, list_mcp_tools, list_credential_executions

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### vault-shared-vector

Vector knowledge base modal shell and tab surfaces for credentials that back a knowledge base (e.g. a file store). VectorKbModal is the root 4-tab modal (Documents, Search, Extract, Settings); tabs handle document listing, semantic search, entity extraction, settings configuration, and corpus overview; StatusBadge shows KB indexing state. [Consolidated 2026-08-04: absorbed vault-vector-kb-ingest]

**Files:**
- `src/features/vault/shared/vector/VectorKbModal.tsx`
- `src/features/vault/shared/vector/search/SearchResultCard.tsx`
- `src/features/vault/shared/vector/tabs/CorpusOverview.tsx`
- `src/features/vault/shared/vector/tabs/DocumentsTab.tsx`
- `src/features/vault/shared/vector/tabs/documentTabHelpers.ts`
- `src/features/vault/shared/vector/tabs/DocUploadArea.tsx`
- `src/features/vault/shared/vector/tabs/ExtractTab.tsx`
- `src/features/vault/shared/vector/tabs/SearchTab.tsx`
- `src/features/vault/shared/vector/tabs/SettingsTab.tsx`
- `src/features/vault/shared/vector/tabs/StatusBadge.tsx`
- `src/features/vault/shared/vector/extract/EntityTable.tsx`
- `src/features/vault/shared/vector/extract/SchemaEditor.tsx`
- `src/features/vault/shared/vector/ingest/IngestDirectoryPicker.tsx`
- `src/features/vault/shared/vector/ingest/IngestDropZone.tsx`
- `src/features/vault/shared/vector/ingest/IngestProgressBar.tsx`
- `src/features/vault/shared/vector/ingest/IngestTextModal.tsx`

**Entry points:** src/features/vault/shared/vector/VectorKbModal.tsx, src/features/vault/shared/vector/ingest/IngestDropZone.tsx, src/features/vault/shared/vector/extract/EntityTable.tsx

**Keywords:** vector, knowledge-base, documents, semantic-search, corpus, extract, embedding, ingest, drop-zone, chunking, entity-extraction, schema

**API surface:** Tauri IPC: get_knowledge_base, list_kb_documents, search_kb

**Tech stack:** React 19, TypeScript, Tailwind 4, Framer Motion

---

## Plugin Ecosystem

> **Group type:** integration
> **Color:** pink

### dev-tools-shell

Top-level shell for the Dev Tools plugin — routes between all sub-modules via a tab key from the system store. Hosts the page header, the shared project dropdown, and constant catalogs (idea categories, colors, badges, preset skills, scan agents) consumed across every sub-module. Acts as the single lazy-import boundary for all dev-tools pages.

**Files:**
- `src/features/plugins/dev-tools/DevToolsPage.tsx`
- `src/features/plugins/dev-tools/DevToolsPageHeader.tsx`
- `src/features/plugins/dev-tools/components/DevToolsProjectDropdown.tsx`
- `src/features/plugins/dev-tools/constants/ideaBadges.tsx`
- `src/features/plugins/dev-tools/constants/ideaCategories.ts`
- `src/features/plugins/dev-tools/constants/ideaColors.ts`
- `src/features/plugins/dev-tools/constants/presetSkills.ts`
- `src/features/plugins/dev-tools/constants/scanAgents.ts`
- `src/features/plugins/dev-tools/hooks/useDevToolsActions.ts`
- `src/features/plugins/dev-tools/hooks/useContextScanBackground.ts`

**Entry points:** src/features/plugins/dev-tools/DevToolsPage.tsx, src/features/plugins/dev-tools/hooks/useDevToolsActions.ts

**Keywords:** dev-tools, tab-routing, project-dropdown, idea-categories, preset-skills, scan-agents, plugin-shell

**Tech stack:** React 19, TypeScript, Zustand 5, Tauri 2, Vite 8

---

### mcp-server

Self-contained Obsidian vault search library used by the MCP sidecar without Tauri or the app's full command layer. Implements recursive markdown note walking, a lowercase alphanumeric tokenizer, smoothed Robertson TF-IDF scoring with title boosting, and a snippet extractor for search result previews. Integration tests exercise the full search and write path against a real temp vault and DB, including the Athena-toggle gate. [Consolidated 2026-08-04: absorbed mcp-auth-gate, mcp-client-install, mcp-protocol-dispatcher, mcp-tool-handlers]

**Files:**
- `src-tauri/src/mcp_server/vault.rs`
- `src-tauri/src/mcp_server/obsidian_vault_tests.rs`
- `src-tauri/src/mcp_server/auth.rs`
- `src-tauri/src/mcp_server/auth_tests.rs`
- `src-tauri/src/mcp_server/install.rs`
- `src-tauri/src/mcp_server/mod.rs`
- `src-tauri/src/mcp_server/db.rs`
- `src-tauri/src/mcp_server/tools.rs`

**Entry points:** src-tauri/src/mcp_server/vault.rs, src-tauri/src/mcp_server/auth.rs, src-tauri/src/mcp_server/install.rs

**Keywords:** obsidian, vault, tfidf, search, markdown, notes, athena, snippet, tokenize, walk-vault, capability-token, authentication

**API surface:** walk_vault(), tfidf_scores(), tokenize(), snippet_for() — used by obsidian_vault_search and obsidian_vault_write_note tools

**Tech stack:** Rust, std::fs

---

### observability-audit-models

Domain types for the full observability surface: `ObservabilityMetric` for aggregated operational metrics, `AuditLog` and `AuditIncident` for security and change audit trails, `SettingsAuditLog` for configuration change history, `LlmSpend` for per-execution cost attribution, `ToolUsage` and `ToolAudit` for tool call tracking, `PolicyEvent` for governance policy triggers, and `FrontendCrash` for renderer error capture. [Consolidated 2026-08-04: absorbed credential-connector-models, p2p-dev-misc-models, plugin-integration-models, chat-review-models]

**Files:**
- `src-tauri/core/src/models/observability.rs`
- `src-tauri/core/src/models/audit_log.rs`
- `src-tauri/core/src/models/audit_incident.rs`
- `src-tauri/core/src/models/settings_audit_log.rs`
- `src-tauri/core/src/models/llm_spend.rs`
- `src-tauri/core/src/models/tool_usage.rs`
- `src-tauri/core/src/models/tool_audit.rs`
- `src-tauri/core/src/models/policy_event.rs`
- `src-tauri/core/src/models/frontend_crash.rs`
- `src-tauri/core/src/models/credential.rs`
- `src-tauri/core/src/models/credential_ledger.rs`
- `src-tauri/core/src/models/credential_recipe.rs`
- `src-tauri/core/src/models/connector.rs`
- `src-tauri/core/src/models/external_api_key.rs`
- `src-tauri/core/src/models/oauth_token_metric.rs`
- `src-tauri/core/src/models/rotation.rs`
- `src-tauri/core/src/models/exposure.rs`
- `src-tauri/core/src/models/identity.rs`
- `src-tauri/core/src/models/signing.rs`
- `src-tauri/core/src/models/owned_device.rs`
- `src-tauri/core/src/models/dev_tools.rs`
- `src-tauri/core/src/models/saved_views.rs`
- `src-tauri/core/src/models/tool.rs`
- `src-tauri/core/src/models/artist.rs`
- `src-tauri/core/src/models/twin.rs`
- `src-tauri/core/src/models/obsidian_brain.rs`
- `src-tauri/core/src/models/n8n_session.rs`
- `src-tauri/core/src/models/gitlab.rs`
- `src-tauri/core/src/models/ocr.rs`
- `src-tauri/core/src/models/research_lab.rs`
- `src-tauri/core/src/models/chat.rs`
- `src-tauri/core/src/models/message.rs`
- `src-tauri/core/src/models/deliberation.rs`
- `src-tauri/core/src/models/review.rs`

**Entry points:** src-tauri/core/src/models/observability.rs, src-tauri/core/src/models/audit_log.rs, src-tauri/core/src/models/credential.rs

**Keywords:** observability, audit, incident, LLM-spend, tool-usage, policy-event, crash, cost-tracking, credential, connector, vault, OAuth

**Tech stack:** Rust, serde, ts-rs

---

### obsidian-brain

Obsidian vault integration — reads and writes markdown notes, traverses the vault graph, lints markdown quality, resolves conflicts between Personas-managed notes and user edits, revitalises stale notes, and mirrors test data. Acts as a persistent knowledge-management backend backed by a local Obsidian vault.

**Files:**
- `src-tauri/src/commands/obsidian_brain/conflict.rs`
- `src-tauri/src/commands/obsidian_brain/drive.rs`
- `src-tauri/src/commands/obsidian_brain/graph.rs`
- `src-tauri/src/commands/obsidian_brain/lint.rs`
- `src-tauri/src/commands/obsidian_brain/markdown.rs`
- `src-tauri/src/commands/obsidian_brain/mirror_tests.rs`
- `src-tauri/src/commands/obsidian_brain/mod.rs`
- `src-tauri/src/commands/obsidian_brain/revitalize.rs`
- `src-tauri/src/commands/obsidian_brain/semantic_lint.rs`
- `src-tauri/src/commands/obsidian_brain/vault_fs.rs`

**Entry points:** src-tauri/src/commands/obsidian_brain/vault_fs.rs

**Keywords:** obsidian, vault, markdown, graph, note, lint, conflict, revitalize

**API surface:** read_vault_file, write_vault_file, get_vault_graph, lint_vault, resolve_conflict

**Tech stack:** Tauri 2, Rust, Obsidian, Markdown

---

### plugins-artist-gallery

Image and 3D model gallery for browsing, managing, and tagging AI-generated or imported creative assets. Supports 2D/3D mode toggle, search, sort, date-based grouping, folder scanning, and a drag-to-reference-board handoff to Creative Studio. Assets can be bulk-selected, tagged, renamed, deleted, and sent to Media Studio. [Consolidated 2026-08-04: absorbed artist-3d-viewer]

**Files:**
- `src/features/plugins/artist/sub_gallery/GalleryPage.tsx`
- `src/features/plugins/artist/sub_gallery/Gallery2D.tsx`
- `src/features/plugins/artist/sub_gallery/Gallery3D.tsx`
- `src/features/plugins/artist/sub_gallery/AssetCard.tsx`
- `src/features/plugins/artist/sub_gallery/GallerySelectionBar.tsx`
- `src/features/plugins/artist/sub_gallery/TagEditorModal.tsx`
- `src/features/plugins/artist/sub_gallery/BulkAddTagModal.tsx`
- `src/features/plugins/artist/sub_gallery/groupByDay.ts`
- `src/features/plugins/artist/sub_gallery/tagOps.ts`
- `src/features/plugins/artist/sub_gallery/__tests__/AssetCard.test.tsx`
- `src/features/plugins/artist/sub_gallery/__tests__/BulkAddTagModal.test.tsx`
- `src/features/plugins/artist/sub_gallery/__tests__/GallerySelectionBar.test.tsx`
- `src/features/plugins/artist/sub_gallery/__tests__/groupByDay.test.ts`
- `src/features/plugins/artist/sub_gallery/__tests__/tagOps.test.ts`
- `src/features/plugins/artist/sub_gallery/ThreeViewer.tsx`

**Entry points:** src/features/plugins/artist/sub_gallery/GalleryPage.tsx, src/features/plugins/artist/sub_gallery/Gallery2D.tsx, src/features/plugins/artist/sub_gallery/ThreeViewer.tsx

**Keywords:** gallery, assets, images, 3d-models, tags, lightbox, bulk-select, sort, scan, folder, three.js, 3d

**API surface:** artistListAssets, artistScanFolder, artistImportAsset, artistDeleteAsset, artistRenameAsset, artistUpdateTags

**Tech stack:** React 19, TypeScript, Tauri 2, Three.js

---

### plugins-artist-hooks

React hooks for loading, scanning, importing, tagging, renaming, and deleting artist assets from the local file system via Tauri IPC. Manages loading/scanning state, syncs the default folder from Tauri, and provides local image data-URL resolution with module-level cache invalidation. [Consolidated 2026-08-04: absorbed artist-creative-hooks]

**Files:**
- `src/features/plugins/artist/hooks/useArtistAssets.ts`
- `src/features/plugins/artist/hooks/useLocalImage.ts`
- `src/features/plugins/artist/hooks/useGallerySelection.ts`
- `src/features/plugins/artist/hooks/__tests__/useArtistAssets.test.ts`
- `src/features/plugins/artist/hooks/__tests__/useGallerySelection.test.ts`
- `src/features/plugins/artist/hooks/useBlenderMcp.ts`
- `src/features/plugins/artist/hooks/useCreativeSession.ts`
- `src/features/plugins/artist/hooks/useCreativeConnectors.ts`
- `src/features/plugins/artist/hooks/useModelViewer.ts`

**Entry points:** src/features/plugins/artist/hooks/useArtistAssets.ts, src/features/plugins/artist/hooks/useGallerySelection.ts, src/features/plugins/artist/hooks/useBlenderMcp.ts

**Keywords:** assets, scan, import, tags, local-image, gallery-selection, range-select, shift-click, blender-mcp, creative-session, connectors, streaming

**API surface:** artistListAssets, artistScanFolder, artistImportAsset, artistDeleteAsset, artistRenameAsset, artistUpdateTags, artistGetDefaultFolder, artistEnsureFolders, artistReadLocalImage

**Tech stack:** React 19, TypeScript, Tauri 2, Zustand 5

---

### plugins-artist-media-studio

Visual timeline editor UI components: the scrollable multi-lane panel, per-lane strips (Video, Audio, Image, Text/Beat, Title), individual clip cards with drag-to-reposition, a ruler showing time markers, clip context menu for actions like split/duplicate/delete, and a transition picker between video clips. [Consolidated 2026-08-04: absorbed artist-composition-preview, artist-media-studio-core, artist-creative-studio]

**Files:**
- `src/features/plugins/artist/sub_media_studio/TimelinePanel.tsx`
- `src/features/plugins/artist/sub_media_studio/TimelineRuler.tsx`
- `src/features/plugins/artist/sub_media_studio/TimelineClip.tsx`
- `src/features/plugins/artist/sub_media_studio/VideoLane.tsx`
- `src/features/plugins/artist/sub_media_studio/AudioLane.tsx`
- `src/features/plugins/artist/sub_media_studio/ImageLane.tsx`
- `src/features/plugins/artist/sub_media_studio/TextLane.tsx`
- `src/features/plugins/artist/sub_media_studio/TitleLane.tsx`
- `src/features/plugins/artist/sub_media_studio/MediaLaneShell.tsx`
- `src/features/plugins/artist/sub_media_studio/ClipContextMenu.tsx`
- `src/features/plugins/artist/sub_media_studio/TransitionPicker.tsx`
- `src/features/plugins/artist/sub_media_studio/CompositionPreview.tsx`
- `src/features/plugins/artist/sub_media_studio/MediaStudioPage.tsx`
- `src/features/plugins/artist/sub_media_studio/types.ts`
- `src/features/plugins/artist/sub_media_studio/constants.ts`
- `src/features/plugins/artist/sub_media_studio/renderPlanHelpers.ts`
- `src/features/plugins/artist/sub_media_studio/FfmpegStatusBanner.tsx`
- `src/features/plugins/artist/sub_blender/CreativeStudioPanel.tsx`
- `src/features/plugins/artist/sub_blender/CreativeSessionHistory.tsx`
- `src/features/plugins/artist/sub_blender/ReferenceBoard.tsx`
- `src/features/plugins/artist/sub_blender/sessionMarkdown.ts`
- `src/features/plugins/artist/sub_blender/__tests__/sessionMarkdown.test.ts`

**Entry points:** src/features/plugins/artist/sub_media_studio/TimelinePanel.tsx, src/features/plugins/artist/sub_media_studio/TimelineClip.tsx, src/features/plugins/artist/sub_media_studio/CompositionPreview.tsx

**Keywords:** timeline, lane, video-clip, audio-clip, drag, trim, ruler, transition, beat, title, context-menu, preview

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### plugins-artist-media-studio-hooks

React hooks for Media Studio non-UI logic: composition state machine with 80-step undo/redo history and coalescing (useMediaStudio), file-persistence with MRU list and auto-thumbnail on save (useMediaStudioPersistence), FFmpeg binary detection (useFfmpegDetect), export progress tracking over IPC events (useMediaExport), media file picker via Tauri dialogs (useMediaFilePicker), audio waveform computation (useAudioWaveform), and video thumbnail generation (useVideoThumbnails). [Consolidated 2026-08-04: absorbed artist-playback, artist-render-plan, artist-toolbar-beat-sidebar]

**Files:**
- `src/features/plugins/artist/sub_media_studio/hooks/useMediaStudio.ts`
- `src/features/plugins/artist/sub_media_studio/hooks/useMediaStudioPersistence.ts`
- `src/features/plugins/artist/sub_media_studio/hooks/useMediaExport.ts`
- `src/features/plugins/artist/sub_media_studio/hooks/useFfmpegDetect.ts`
- `src/features/plugins/artist/sub_media_studio/hooks/useMediaFilePicker.ts`
- `src/features/plugins/artist/sub_media_studio/hooks/useAudioWaveform.ts`
- `src/features/plugins/artist/sub_media_studio/hooks/useVideoThumbnails.ts`
- `src/features/plugins/artist/sub_media_studio/hooks/__tests__/useMediaExport.test.ts`
- `src/features/plugins/artist/sub_media_studio/hooks/__tests__/useMediaStudioPersistence.test.ts`
- `src/features/plugins/artist/sub_media_studio/hooks/__tests__/normalizeProgress.test.ts`
- `src/features/plugins/artist/sub_media_studio/PlaybackControls.tsx`
- `src/features/plugins/artist/sub_media_studio/hooks/useTimelinePlayback.ts`
- `src/features/plugins/artist/sub_media_studio/hooks/useTimelineKeyboard.ts`
- `src/features/plugins/artist/sub_media_studio/hooks/useRenderPlan.ts`
- `src/features/plugins/artist/sub_media_studio/hooks/useTranscriptCache.ts`
- `src/features/plugins/artist/sub_media_studio/toolbar/MediaStudioToolbar.tsx`
- `src/features/plugins/artist/sub_media_studio/toolbar/fields.tsx`
- `src/features/plugins/artist/sub_media_studio/toolbar/IconPopover.tsx`
- `src/features/plugins/artist/sub_media_studio/BeatSidebar.tsx`
- `src/features/plugins/artist/sub_media_studio/VoiceoverButton.tsx`
- `src/features/plugins/artist/sub_media_studio/__tests__/BeatSidebar.test.tsx`

**Entry points:** src/features/plugins/artist/sub_media_studio/hooks/useMediaStudio.ts, src/features/plugins/artist/sub_media_studio/hooks/useMediaExport.ts, src/features/plugins/artist/sub_media_studio/hooks/useTimelinePlayback.ts

**Keywords:** composition, undo-redo, persistence, ffmpeg, export, file-picker, waveform, thumbnail, mru, playback, play, pause

**API surface:** artistSaveComposition, artistLoadComposition, artistListRecentCompositions, artistExportComposition, artistFfmpegStatus, artistProbeMedia, artistReadAudioWaveform, artistVideoThumbnail

**Tech stack:** React 19, TypeScript, Tauri 2

---

### plugins-dev-tools-context

Runtime layer for the Context Map: manages live codebase scanning state (ScanOverlay), computes KPI health per context, and resolves use-case associations. The useContextRuntime hook drives incremental scan updates via Tauri events; useUseCases fetches and caches use-case rows; UseCaseDetailModal surfaces per-use-case drill-down. Tests cover the runtime hook and the Coverage view. [Consolidated 2026-08-04: absorbed context-map-core]

**Files:**
- `src/features/plugins/dev-tools/sub_context/ScanOverlay.tsx`
- `src/features/plugins/dev-tools/sub_context/useContextRuntime.ts`
- `src/features/plugins/dev-tools/sub_context/contextKpiStatus.ts`
- `src/features/plugins/dev-tools/sub_context/useUseCases.ts`
- `src/features/plugins/dev-tools/sub_context/UseCaseDetailModal.tsx`
- `src/features/plugins/dev-tools/sub_context/useCaseKind.ts`
- `src/features/plugins/dev-tools/sub_context/__tests__/useContextRuntime.test.ts`
- `src/features/plugins/dev-tools/sub_context/__tests__/ContextCoverage.test.tsx`
- `src/features/plugins/dev-tools/sub_context/ContextMapPage.tsx`
- `src/features/plugins/dev-tools/sub_context/ContextLedger.tsx`
- `src/features/plugins/dev-tools/sub_context/contextLedgerShared.tsx`
- `src/features/plugins/dev-tools/sub_context/ContextGroupRowsStats.tsx`
- `src/features/plugins/dev-tools/sub_context/ContextDetail.tsx`
- `src/features/plugins/dev-tools/sub_context/GroupColorPicker.tsx`
- `src/features/plugins/dev-tools/sub_context/contextMapTypes.ts`

**Entry points:** src/features/plugins/dev-tools/sub_context/useContextRuntime.ts, src/features/plugins/dev-tools/sub_context/contextKpiStatus.ts, src/features/plugins/dev-tools/sub_context/ContextMapPage.tsx

**Keywords:** context-scan, scan-overlay, kpi-status, use-cases, runtime, tauri-events, context-map, codebase-contexts, context-group, ledger, context-detail, color-picker

**API surface:** getScanCodebaseStatus, cancelScanCodebase, listUseCases via devTools API

**Tech stack:** React 19, TypeScript, Tauri 2, Vitest

---

### plugins-dev-tools-lifecycle

Prompt competitions allow multiple prompt variants to race head-to-head, scored on quality and execution time, with a leaderboard and winner insight analysis. CompetitionList, CompetitionCard, CompetitionSlotRow, and RacingProgress form the live-race UI; StrategyLeaderboard and WinningGeneProfile surface post-race analysis; strategyPresets, qualityScore, and timeUtils provide domain logic; PromptDiffModal shows prompt diffs between competitors. [Consolidated 2026-08-04: absorbed lifecycle-setup]

**Files:**
- `src/features/plugins/dev-tools/sub_lifecycle/competitions/CompetitionList.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/competitions/CompetitionCard.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/competitions/CompetitionSlotRow.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/competitions/NewCompetitionModal.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/competitions/RacingProgress.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/competitions/StrategyLeaderboard.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/competitions/WinnerInsightDialog.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/competitions/WinningGeneProfile.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/competitions/PromptDiffModal.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/competitions/strategyPresets.ts`
- `src/features/plugins/dev-tools/sub_lifecycle/competitions/qualityScore.ts`
- `src/features/plugins/dev-tools/sub_lifecycle/competitions/timeUtils.ts`
- `src/features/plugins/dev-tools/sub_lifecycle/competitions/__tests__/PromptDiffModal.test.ts`
- `src/features/plugins/dev-tools/sub_lifecycle/LifecyclePage.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/LifecycleProjectPicker.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/CompetitionPage.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/useDevCloneAdoption.ts`
- `src/features/plugins/dev-tools/sub_lifecycle/setup/DevCloneAdoptionCard.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/setup/FlowSteps.tsx`
- `src/features/plugins/dev-tools/sub_lifecycle/tabs/SetupTab.tsx`

**Entry points:** src/features/plugins/dev-tools/sub_lifecycle/competitions/CompetitionList.tsx, src/features/plugins/dev-tools/sub_lifecycle/competitions/strategyPresets.ts, src/features/plugins/dev-tools/sub_lifecycle/LifecyclePage.tsx

**Keywords:** prompt-competition, leaderboard, quality-score, racing-progress, winning-gene, prompt-diff, strategy-presets, dev-clone, lifecycle, trigger-setup, review-event, persona-trigger

**API surface:** createCompetition, listCompetitions, getCompetitionSlots via devTools API

**Tech stack:** React 19, TypeScript, Tauri 2, Vitest

---

### plugins-dev-tools-llm-overview

Manages LLM observability connector assignments across projects via an AssignmentMatrix UI. Adapters in llmTracingAdapters normalise responses from different LLM monitoring connectors (Langfuse, Langsmith, etc.) into a unified LlmPinpoint shape consumed by the pinpoints layer. Tested by the adapter unit test. [Consolidated 2026-08-04: absorbed llm-monitoring-pinpoints]

**Files:**
- `src/features/plugins/dev-tools/sub_llm_overview/AssignmentMatrix.tsx`
- `src/features/plugins/dev-tools/sub_llm_overview/matrixShared.tsx`
- `src/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters.ts`
- `src/features/plugins/dev-tools/sub_llm_overview/__tests__/llmTracingAdapters.test.ts`
- `src/features/plugins/dev-tools/sub_llm_overview/LlmOverviewPage.tsx`
- `src/features/plugins/dev-tools/sub_llm_overview/MonitoringSection.tsx`
- `src/features/plugins/dev-tools/sub_llm_overview/useLlmPinpoints.ts`
- `src/features/plugins/dev-tools/sub_llm_overview/useMonitoringPinpoints.ts`

**Entry points:** src/features/plugins/dev-tools/sub_llm_overview/AssignmentMatrix.tsx, src/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters.ts, src/features/plugins/dev-tools/sub_llm_overview/LlmOverviewPage.tsx

**Keywords:** llm-tracing, observability, langfuse, assignment-matrix, connector-assignment, llm-monitoring, pinpoints, use-case-rollup, cost-tracking, latency, time-window

**API surface:** updateProject (llm_tracking_credential_id field)

**Tech stack:** React 19, TypeScript, Tauri 2, Vitest

---

### plugins-dev-tools-projects

The Project Manager surface lets operators create, edit, and organise dev projects, attach GitHub repos, preview team graphs, and manage cross-project metadata. ProjectManagerPage and ProjectManagerParts render the list/detail layout; ProjectModal handles create/edit forms; GitHubRepoSelector integrates repo-picker flow; TeamGraphPreview and ProjectTeamPreviewModal visualise agent assignments; CrossProjectMetadataModal handles shared metadata. [Consolidated 2026-08-04: absorbed project-pipeline]

**Files:**
- `src/features/plugins/dev-tools/sub_projects/ProjectManagerPage.tsx`
- `src/features/plugins/dev-tools/sub_projects/ProjectManagerParts.tsx`
- `src/features/plugins/dev-tools/sub_projects/ProjectModal.tsx`
- `src/features/plugins/dev-tools/sub_projects/projectManagerTypes.tsx`
- `src/features/plugins/dev-tools/sub_projects/TeamGraphPreview.tsx`
- `src/features/plugins/dev-tools/sub_projects/ProjectTeamPreviewModal.tsx`
- `src/features/plugins/dev-tools/sub_projects/GitHubRepoSelector.tsx`
- `src/features/plugins/dev-tools/sub_projects/CrossProjectMetadataModal.tsx`
- `src/features/plugins/dev-tools/sub_projects/pipeline/ProjectPipelineView.tsx`
- `src/features/plugins/dev-tools/sub_projects/pipeline/PipelineRail.tsx`
- `src/features/plugins/dev-tools/sub_projects/pipeline/ProjectStep.tsx`
- `src/features/plugins/dev-tools/sub_projects/pipeline/SourceControlStep.tsx`
- `src/features/plugins/dev-tools/sub_projects/pipeline/StandardsStep.tsx`
- `src/features/plugins/dev-tools/sub_projects/pipeline/pipelineTypes.ts`
- `src/features/plugins/dev-tools/sub_projects/pipeline/standardsConfig.ts`

**Entry points:** src/features/plugins/dev-tools/sub_projects/ProjectManagerPage.tsx, src/features/plugins/dev-tools/sub_projects/projectManagerTypes.tsx, src/features/plugins/dev-tools/sub_projects/pipeline/ProjectPipelineView.tsx

**Keywords:** project-manager, dev-project, github-repo, team-graph, cross-project, project-create, project-edit, pipeline, project-steps, source-control, standards, pipeline-rail

**API surface:** createProject, updateProject, deleteProject, listProjects via devTools API

**Tech stack:** React 19, TypeScript, Tauri 2, Zustand 5

---

### plugins-dev-tools-skills

The Skills Manager shows the workspace-global skill library alongside the active project's installed skills, enabling adopt, share, and dispatch operations. skillsManagerData fetches workspace passport data and resolves install/usage/coverage state; SkillsManagerBoard renders the dual-panel exchange UI; UseSkillDialog lets operators dispatch a skill with context and target (Fleet or clipboard). [Consolidated 2026-08-04: absorbed skills-analytics]

**Files:**
- `src/features/plugins/dev-tools/sub_skills/SkillsManagerPage.tsx`
- `src/features/plugins/dev-tools/sub_skills/SkillsManagerBoard.tsx`
- `src/features/plugins/dev-tools/sub_skills/skillsManagerBits.tsx`
- `src/features/plugins/dev-tools/sub_skills/skillsManagerData.ts`
- `src/features/plugins/dev-tools/sub_skills/UseSkillDialog.tsx`
- `src/features/plugins/dev-tools/sub_skills/UseSkillShared.tsx`
- `src/features/plugins/dev-tools/sub_skills/SkillActionConfirm.tsx`
- `src/features/plugins/dev-tools/sub_skills/SkillContextsModal.tsx`
- `src/features/plugins/dev-tools/sub_skills/analytics/SkillsAnalyticsTab.tsx`
- `src/features/plugins/dev-tools/sub_skills/analytics/CoveragePipeline.tsx`
- `src/features/plugins/dev-tools/sub_skills/analytics/SkillScoreboard.tsx`
- `src/features/plugins/dev-tools/sub_skills/analytics/SkillHistoryTable.tsx`
- `src/features/plugins/dev-tools/sub_skills/analytics/StaticScanCard.tsx`
- `src/features/plugins/dev-tools/sub_skills/analytics/StaticScanConfigModal.tsx`
- `src/features/plugins/dev-tools/sub_skills/analytics/useSkillsAnalytics.ts`

**Entry points:** src/features/plugins/dev-tools/sub_skills/SkillsManagerPage.tsx, src/features/plugins/dev-tools/sub_skills/skillsManagerData.ts, src/features/plugins/dev-tools/sub_skills/analytics/SkillsAnalyticsTab.tsx

**Keywords:** skills-manager, skill-library, adopt-skill, share-skill, dispatch-skill, workspace-skills, project-skills, skill-analytics, coverage-pipeline, skill-scoreboard, usage-history, static-scan

**API surface:** installSystemSkill, listSkills, adoptSkill, shareSkill via devTools API

**Tech stack:** React 19, TypeScript, Tauri 2, Zustand 5

---

### plugins-dev-tools-triage

The findings engine automates discovery and triage of development issues by sweeping multiple sensor sources (Sentry errors, off-track KPIs, context coverage gaps) and writing deduped FindingDraft records to dev_ideas. emitters produce typed drafts per sensor; dispatch persists them; verify re-measures shipped findings to clear or regress their status; sensorStats and healthIngest feed the Sensor Scoreboard UI. [Consolidated 2026-08-04: absorbed triage-rules]

**Files:**
- `src/features/plugins/dev-tools/sub_triage/findings/types.ts`
- `src/features/plugins/dev-tools/sub_triage/findings/findingConfig.ts`
- `src/features/plugins/dev-tools/sub_triage/findings/emitters.ts`
- `src/features/plugins/dev-tools/sub_triage/findings/dispatch.ts`
- `src/features/plugins/dev-tools/sub_triage/findings/verify.ts`
- `src/features/plugins/dev-tools/sub_triage/findings/sweep.ts`
- `src/features/plugins/dev-tools/sub_triage/findings/healthIngest.ts`
- `src/features/plugins/dev-tools/sub_triage/findings/sensorStats.ts`
- `src/features/plugins/dev-tools/sub_triage/findings/usePassportForProject.ts`
- `src/features/plugins/dev-tools/sub_triage/findings/SweepButton.tsx`
- `src/features/plugins/dev-tools/sub_triage/findings/FindingBadge.tsx`
- `src/features/plugins/dev-tools/sub_triage/findings/SensorScoreboard.tsx`
- `src/features/plugins/dev-tools/sub_triage/findings/__tests__/dispatch.test.ts`
- `src/features/plugins/dev-tools/sub_triage/findings/__tests__/emitters.test.ts`
- `src/features/plugins/dev-tools/sub_triage/findings/__tests__/sensorStats.test.ts`
- `src/features/plugins/dev-tools/sub_triage/findings/__tests__/verify.test.ts`
- `src/features/plugins/dev-tools/sub_triage/TriageRulesPanel.tsx`
- `src/features/plugins/dev-tools/sub_triage/EffortRiskFilter.tsx`
- `src/features/plugins/dev-tools/sub_triage/triageRuleSuggestions.ts`
- `src/features/plugins/dev-tools/sub_triage/__tests__/triageRuleSuggestions.test.ts`

**Entry points:** src/features/plugins/dev-tools/sub_triage/findings/sweep.ts, src/features/plugins/dev-tools/sub_triage/findings/types.ts, src/features/plugins/dev-tools/sub_triage/TriageRulesPanel.tsx

**Keywords:** findings, sweep, sensor, emitters, dedup, verify, health-ingest, sentry-issues, kpi-attention, triage-rules, effort-risk, finding-categories

**API surface:** createFinding, setVerifyState, sweepFindings via devTools API

**Tech stack:** React 19, TypeScript, Tauri 2, Vitest

---

### plugins-drive

Unit and component test suite for the Drive plugin. Covers designToken utilities (visual preset resolution, kind bucket ordering), component rendering for DriveEmptyHint and DropCountChip, the useDrive state hook (navigation, selection, mutations, search), and useScrollShadows behaviour. Also includes integration-level tests for image blob preview rendering. [Consolidated 2026-08-04: absorbed drive-browser-components, drive-detail-components, drive-knowledge, drive-navigation-state, drive-ocr, drive-page, drive-signing, drive-utility-hooks]

**Files:**
- `src/features/plugins/drive/__tests__/designTokens.test.ts`
- `src/features/plugins/drive/components/__tests__/DriveEmptyHint.test.tsx`
- `src/features/plugins/drive/components/__tests__/DropCountChip.test.tsx`
- `src/features/plugins/drive/hooks/__tests__/useDrive.test.ts`
- `src/features/plugins/drive/hooks/__tests__/useScrollShadows.test.ts`
- `src/features/plugins/drive/components/__tests__/ImagePreviewBlob.test.tsx`
- `src/features/plugins/drive/components/DriveToolbar.tsx`
- `src/features/plugins/drive/components/DriveSidebar.tsx`
- `src/features/plugins/drive/components/DriveFileList.tsx`
- `src/features/plugins/drive/components/DriveKindFilterBar.tsx`
- `src/features/plugins/drive/components/DriveTrashBanner.tsx`
- `src/features/plugins/drive/components/DriveDetailsPane.tsx`
- `src/features/plugins/drive/components/DriveContextMenu.tsx`
- `src/features/plugins/drive/components/DriveImageLightbox.tsx`
- `src/features/plugins/drive/components/DriveEmptyHint.tsx`
- `src/features/plugins/drive/components/DrivePrompt.tsx`
- `src/features/plugins/drive/components/DropCountChip.tsx`
- `src/features/plugins/drive/knowledge/useDriveKnowledge.ts`
- `src/features/plugins/drive/knowledge/KbPickerDialog.tsx`
- `src/features/plugins/drive/knowledge/DriveKnowledgeDrawer.tsx`
- `src/features/plugins/drive/hooks/useDrive.ts`
- `src/features/plugins/drive/ocr/useOcr.ts`
- `src/features/plugins/drive/ocr/DriveOcrDrawer.tsx`
- `src/features/plugins/drive/DrivePage.tsx`
- `src/features/plugins/drive/designTokens.ts`
- `src/features/plugins/drive/signing/useSigning.ts`
- `src/features/plugins/drive/signing/DriveSignDialog.tsx`
- `src/features/plugins/drive/signing/DriveSignaturesPanel.tsx`
- `src/features/plugins/drive/signing/DriveVerifyDialog.tsx`
- `src/features/plugins/drive/hooks/useScrollShadows.ts`
- `src/features/plugins/drive/hooks/useLazyImageThumb.ts`

**Entry points:** src/features/plugins/drive/hooks/__tests__/useDrive.test.ts, src/features/plugins/drive/components/DriveFileList.tsx, src/features/plugins/drive/components/DriveToolbar.tsx

**Keywords:** test, vitest, unit test, component test, design tokens, hook test, scroll shadows, image preview, toolbar, sidebar, file list, folder tree

**Tech stack:** Vitest, React Testing Library, TypeScript

---

### plugins-gitlab

Real-time pipeline monitor that lists recent pipelines for the selected project and shows job-level detail with expandable log output. Supports manual pipeline triggering and auto-refreshes running pipelines via visibility-aware polling. Dispatches desktop and in-app notifications on status transitions through usePipelineNotifications. [Consolidated 2026-08-04: absorbed gitlab-agent-management, gitlab-connection, gitlab-deploy, gitlab-deployment-history, gitlab-gitops-versioning, gitlab-panel-shell, gitlab-pipeline-notifications]

**Files:**
- `src/features/plugins/gitlab/components/GitLabPipelineViewer.tsx`
- `src/features/plugins/gitlab/components/PipelineRow.tsx`
- `src/features/plugins/gitlab/components/JobRow.tsx`
- `src/features/plugins/gitlab/components/pipelineHelpers.tsx`
- `src/features/plugins/gitlab/components/GitLabAgentList.tsx`
- `src/features/plugins/gitlab/components/GitLabConnectionForm.tsx`
- `src/features/plugins/gitlab/components/GitLabDeployModal.tsx`
- `src/features/plugins/gitlab/components/CiCdTemplatesPicker.tsx`
- `src/features/plugins/gitlab/data/cicdTemplates.ts`
- `src/features/plugins/gitlab/components/DeploymentHistoryTab.tsx`
- `src/features/plugins/gitlab/components/GitOpsVersionHistory.tsx`
- `src/features/plugins/gitlab/components/GitLabPanel.tsx`
- `src/features/plugins/gitlab/hooks/usePipelineNotifications.ts`
- `src/features/plugins/gitlab/components/PipelineNotificationPrefs.tsx`

**Entry points:** src/features/plugins/gitlab/components/GitLabPipelineViewer.tsx, src/features/plugins/gitlab/components/GitLabAgentList.tsx, src/features/plugins/gitlab/components/GitLabConnectionForm.tsx

**Keywords:** pipeline, jobs, log, trigger, polling, status, gitlab, ci, agents, duo, undeploy, redeploy

**API surface:** gitlabFetchPipelines, gitlabTriggerPipelineAction, gitlabRefreshPipeline, gitlabFetchJobLog (systemStore)

**Tech stack:** React 19, TypeScript, Zustand 5

---

### plugins-obsidian-brain

Entry point and routing layer for the Twin plugin. Manages tab routing across seven sub-pages, hydratesactive-twin data layers on twin change, and drives a readiness-celebration effect when a milestone closes. Depends on systemStore for active twin state and lazy-loads each sub-page for code splitting. [Consolidated 2026-08-04: absorbed obsidian-brain-shell, obsidian-cloud-sync, obsidian-graph-intelligence, obsidian-open-deep-link, obsidian-revitalize, obsidian-saved-vault-configs, obsidian-session-services, obsidian-vault-browse, obsidian-vault-setup, obsidian-vault-sync, artist-plugin-shell]

**Files:**
- `src/features/plugins/twin/TwinPage.tsx`
- `src/features/plugins/twin/useTwinReadiness.ts`
- `src/features/plugins/twin/useReadinessCelebration.ts`
- `src/features/plugins/twin/TwinEmptyState.tsx`
- `src/features/plugins/twin/CoachMark.tsx`
- `src/features/plugins/twin/useProfileDashboards.ts`
- `src/features/plugins/obsidian-brain/ObsidianBrainPage.tsx`
- `src/features/plugins/obsidian-brain/sub_cloud/CloudSyncPanel.tsx`
- `src/features/plugins/obsidian-brain/sub_graph/GraphPanel.tsx`
- `src/features/plugins/obsidian-brain/openInObsidian.ts`
- `src/features/plugins/obsidian-brain/sub_revitalize/RevitalizePanel.tsx`
- `src/features/plugins/obsidian-brain/sub_revitalize/RevitalizeProgress.tsx`
- `src/features/plugins/obsidian-brain/sub_revitalize/RevitalizeSummaryCard.tsx`
- `src/features/plugins/obsidian-brain/sub_revitalize/RevitalizeHistoryTable.tsx`
- `src/features/plugins/obsidian-brain/sub_revitalize/useRevitalizeJob.ts`
- `src/features/plugins/obsidian-brain/SavedConfigsSidebar.tsx`
- `src/features/plugins/obsidian-brain/useSavedVaultConfigs.ts`
- `src/features/plugins/obsidian-brain/useObsidianVaultRehydration.ts`
- `src/features/plugins/obsidian-brain/useVisibleConnectorDefinitions.ts`
- `src/features/plugins/obsidian-brain/sub_browse/BrowsePanel.tsx`
- `src/features/plugins/obsidian-brain/sub_browse/parseNote.ts`
- `src/features/plugins/obsidian-brain/sub_setup/SetupPanel.tsx`
- `src/features/plugins/obsidian-brain/sub_sync/SyncPanel.tsx`
- `src/features/plugins/obsidian-brain/sub_sync/SyncResultCard.tsx`
- `src/features/plugins/obsidian-brain/sub_sync/ConflictDiffView.tsx`
- `src/features/plugins/obsidian-brain/sub_sync/conflictDiff.ts`
- `src/features/plugins/artist/ArtistPage.tsx`
- `src/features/plugins/artist/types.ts`
- `src/features/plugins/artist/utils/format.ts`
- `src/features/plugins/artist/utils/__tests__/format.test.ts`

**Entry points:** src/features/plugins/twin/TwinPage.tsx, src/features/plugins/twin/useTwinReadiness.ts, src/features/plugins/obsidian-brain/ObsidianBrainPage.tsx

**Keywords:** twin, routing, readiness, milestone, hydration, tab, digital twin, activation, obsidian-brain, tab-router, lazy-panel, tour-anchor

**Tech stack:** React 19, TypeScript, Zustand 5, Tauri 2

---

### plugins-radio

Dual-engine audio controller that drives background music from the desktop footer. Manages an HTML5 `<audio>` element for SomaFM internet-radio streams and a hidden YouTube IFrame Player for curated video-track playlists, with crossfade, watchdog timeouts, a session blacklist for unplayable videos, and auto-resume on startup. Receives authoritative `radio:state` events from the Rust backend via Tauri `listen` and reports play-status back via `radio_report_status` IPC to keep persisted state in sync. [Consolidated 2026-08-04: absorbed radio-station-management, radio-ui-primitives]

**Files:**
- `src/features/plugins/radio/components/RadioFooter.tsx`
- `src/features/plugins/radio/hooks/useRadioState.ts`
- `src/features/plugins/radio/hooks/useYouTubePlayer.ts`
- `src/features/plugins/radio/hooks/useSomafmMetadata.ts`
- `src/features/plugins/radio/hooks/useStationPreview.ts`
- `src/features/plugins/radio/index.ts`
- `src/features/plugins/radio/components/RadioPage.tsx`
- `src/features/plugins/radio/components/RadioConsoleVariant.tsx`
- `src/features/plugins/radio/components/radioManageShared.tsx`
- `src/features/plugins/radio/components/NowPlayingCard.tsx`
- `src/features/plugins/radio/components/StationPicker.tsx`
- `src/features/plugins/radio/components/VolumePopover.tsx`
- `src/features/plugins/radio/components/TitleCrossfade.tsx`
- `src/features/plugins/radio/components/EqualizerBars.tsx`

**Entry points:** src/features/plugins/radio/components/RadioFooter.tsx, src/features/plugins/radio/hooks/useRadioState.ts, src/features/plugins/radio/components/RadioPage.tsx

**Keywords:** radio, playback, audio, youtube, somafm, stream, crossfade, watchdog, auto-resume, iframe-player, settings, station

**API surface:** Consumes: radio_play, radio_pause, radio_next, radio_prev, radio_set_station, radio_set_volume, radio_report_status, radio_track_ended, radio_fetch_somafm_metadata, get_radio_state, get_now_playing, list_stations; Listens: radio:state Tauri event

**Tech stack:** React 19, TypeScript, Tauri 2, YouTube IFrame API

---

### plugins-research-lab-reports

AI-powered research report generation and preview. A synthesis prompt builder serialises project hypotheses, experiments, and findings into a structured prompt; a persona runs it and the output is parsed tolerantly (JSON object or markdown headings) into abstract + discussion sections. ReportPreviewDrawer renders the compiled markdown report with a download-file action. [Consolidated 2026-08-04: absorbed research-lab-projects]

**Files:**
- `src/features/plugins/research-lab/sub_reports/ReportsPanel.tsx`
- `src/features/plugins/research-lab/sub_reports/AddReportForm.tsx`
- `src/features/plugins/research-lab/sub_reports/ReportPreviewDrawer.tsx`
- `src/features/plugins/research-lab/sub_reports/buildSynthesisPrompt.ts`
- `src/features/plugins/research-lab/sub_reports/compileReport.ts`
- `src/features/plugins/research-lab/sub_reports/parseSynthesis.ts`
- `src/features/plugins/research-lab/sub_projects/ResearchProjectList.tsx`
- `src/features/plugins/research-lab/sub_projects/ResearchProjectListCartograph.tsx`
- `src/features/plugins/research-lab/sub_projects/ResearchProjectListAtelier.tsx`
- `src/features/plugins/research-lab/sub_projects/ResearchProjectForm.tsx`

**Entry points:** src/features/plugins/research-lab/sub_reports/ReportsPanel.tsx, src/features/plugins/research-lab/sub_reports/buildSynthesisPrompt.ts, src/features/plugins/research-lab/sub_projects/ResearchProjectList.tsx

**Keywords:** report, synthesis, abstract, discussion, AI-generation, markdown, compile, download, research-project, project-list, project-form, cartograph

**Tech stack:** React 19, TypeScript, Zustand 5

---

### plugins-research-lab-shared

Literature source management with external search integration. Provides three panel variants (base, Atelier, Workbench), an arXiv Atom-feed search client, a Crossref REST client, and an ArxivSearchModal for discovering and adding papers. Users can add sources manually or via search and trigger ingestion (status flip: pending → ingesting → indexed). [Consolidated 2026-08-04: absorbed research-lab-shared-lib, research-lab-shared-primitives, research-lab-dashboard, research-lab-experiments, research-lab-findings, research-lab-graph, research-lab-hypotheses]

**Files:**
- `src/features/plugins/research-lab/sub_literature/LiteratureSearchPanel.tsx`
- `src/features/plugins/research-lab/sub_literature/LiteratureSearchPanelAtelier.tsx`
- `src/features/plugins/research-lab/sub_literature/LiteratureSearchPanelWorkbench.tsx`
- `src/features/plugins/research-lab/sub_literature/AddSourceForm.tsx`
- `src/features/plugins/research-lab/sub_literature/ArxivSearchModal.tsx`
- `src/features/plugins/research-lab/sub_literature/arxivClient.ts`
- `src/features/plugins/research-lab/sub_literature/crossrefClient.ts`
- `src/features/plugins/research-lab/shared/tokens.ts`
- `src/features/plugins/research-lab/shared/experimentConfig.ts`
- `src/features/plugins/research-lab/shared/runPersona.ts`
- `src/features/plugins/research-lab/shared/downloadFile.ts`
- `src/features/plugins/research-lab/shared/useIngestSource.ts`
- `src/features/plugins/research-lab/shared/ResearchLabFormModal.tsx`
- `src/features/plugins/research-lab/shared/SignalMeter.tsx`
- `src/features/plugins/research-lab/shared/FormField.tsx`
- `src/features/plugins/research-lab/shared/SectionHeader.tsx`
- `src/features/plugins/research-lab/shared/PrototypeTabs.tsx`
- `src/features/plugins/research-lab/shared/EmptyState.tsx`
- `src/features/plugins/research-lab/sub_dashboard/ResearchDashboard.tsx`
- `src/features/plugins/research-lab/sub_experiments/ExperimentsPanel.tsx`
- `src/features/plugins/research-lab/sub_experiments/AddExperimentForm.tsx`
- `src/features/plugins/research-lab/sub_experiments/ExperimentRunsDrawer.tsx`
- `src/features/plugins/research-lab/sub_findings/FindingsPanel.tsx`
- `src/features/plugins/research-lab/sub_findings/AddFindingForm.tsx`
- `src/features/plugins/research-lab/sub_graph/GraphPanel.tsx`
- `src/features/plugins/research-lab/sub_graph/ResearchNode.tsx`
- `src/features/plugins/research-lab/sub_graph/graphLayout.ts`
- `src/features/plugins/research-lab/sub_hypotheses/HypothesesPanel.tsx`
- `src/features/plugins/research-lab/sub_hypotheses/AddHypothesisForm.tsx`
- `src/features/plugins/research-lab/sub_hypotheses/GenerateHypothesesModal.tsx`
- `src/features/plugins/research-lab/sub_hypotheses/parseHypotheses.ts`

**Entry points:** src/features/plugins/research-lab/sub_literature/LiteratureSearchPanel.tsx, src/features/plugins/research-lab/sub_literature/arxivClient.ts, src/features/plugins/research-lab/shared/tokens.ts

**Keywords:** literature, arxiv, crossref, source, paper, ingestion, search, academic, tokens, domain-enum, status-color, experiment-config

**API surface:** GET https://export.arxiv.org/api/query, GET https://api.crossref.org/works

**Tech stack:** React 19, TypeScript, Zustand 5, Fetch API

---

### plugins-twin-shared

Shared presentational components and utility modules used across all Twin sub-pages. Includes the unified TwinHeaderBand (gradient hero band with KPI slots, readiness ribbon, and decoration prop), the ReadinessGapPopover and gap-ranking logic, a TwinPicker selector, channel palette definitions, gender-sigil helpers, and decorative SVG elements. [Consolidated 2026-08-04: absorbed twin-tests, twin-brain, twin-channels, twin-identity, twin-knowledge-memory, twin-variant-tabs]

**Files:**
- `src/features/plugins/twin/shared/TwinHeaderBand.tsx`
- `src/features/plugins/twin/shared/TwinReadinessRibbon.tsx`
- `src/features/plugins/twin/shared/TwinStat.tsx`
- `src/features/plugins/twin/shared/TwinPicker.tsx`
- `src/features/plugins/twin/shared/TwinWikiPanel.tsx`
- `src/features/plugins/twin/shared/WikiFreshnessPill.tsx`
- `src/features/plugins/twin/shared/ReadinessGapPopover.tsx`
- `src/features/plugins/twin/shared/readinessGaps.ts`
- `src/features/plugins/twin/shared/channels.ts`
- `src/features/plugins/twin/shared/decorations.tsx`
- `src/features/plugins/twin/shared/gender.ts`
- `src/features/plugins/twin/shared/__tests__/ReadinessGapPopover.test.tsx`
- `src/features/plugins/twin/__tests__/useTwinReadiness.test.ts`
- `src/features/plugins/twin/sub_brain/BrainPage.tsx`
- `src/features/plugins/twin/sub_brain/BrainAtelier.tsx`
- `src/features/plugins/twin/sub_brain/useBrainConnection.ts`
- `src/features/plugins/twin/sub_brain/RejectionPatternsPanel.tsx`
- `src/features/plugins/twin/sub_brain/DistilledFactsPanel.tsx`
- `src/features/plugins/twin/sub_brain/RecallPreviewPanel.tsx`
- `src/features/plugins/twin/sub_brain/ReflectionsPanel.tsx`
- `src/features/plugins/twin/sub_channels/ChannelsPage.tsx`
- `src/features/plugins/twin/sub_channels/ChannelsAtelier.tsx`
- `src/features/plugins/twin/sub_channels/ContactThread.tsx`
- `src/features/plugins/twin/sub_channels/SentReplies.tsx`
- `src/features/plugins/twin/sub_channels/ReplyOutbox.tsx`
- `src/features/plugins/twin/sub_channels/useChannelActivity.ts`
- `src/features/plugins/twin/sub_channels/__tests__/useChannelActivity.test.ts`
- `src/features/plugins/twin/sub_identity/IdentityPage.tsx`
- `src/features/plugins/twin/sub_identity/IdentityAtelier.tsx`
- `src/features/plugins/twin/sub_knowledge/KnowledgePage.tsx`
- `src/features/plugins/twin/sub_knowledge/KnowledgeAtelier.tsx`
- `src/features/plugins/twin/sub_knowledge/ContactsPanel.tsx`
- `src/features/plugins/twin/variants/TwinVariantTabs.tsx`

**Entry points:** src/features/plugins/twin/shared/TwinHeaderBand.tsx, src/features/plugins/twin/shared/readinessGaps.ts, src/features/plugins/twin/shared/channels.ts

**Keywords:** header band, readiness ribbon, gap popover, channel palette, gender sigil, wiki panel, decoration, twin picker, shared components, readiness, unit test, milestone

**Tech stack:** React 19, TypeScript, Framer Motion, Tailwind 4, Vitest

---

### plugins-twin-training

Interview-style training sessions that teach a twin how to respond by collecting Q&A pairs across six topic categories (background, opinions, communication, values, expertise, personal). An AI generates contextual follow-up questions; answers are saved as approved memories. Includes topic-coverage scoring, a momentum tracker, and a training studio for extended sessions. [Consolidated 2026-08-04: absorbed twin-profiles, twin-tone]

**Files:**
- `src/features/plugins/twin/sub_training/TrainingPage.tsx`
- `src/features/plugins/twin/sub_training/TrainingAtelier.tsx`
- `src/features/plugins/twin/sub_training/TrainingStudio.tsx`
- `src/features/plugins/twin/sub_training/NextMovesPanel.tsx`
- `src/features/plugins/twin/sub_training/useTrainingSession.ts`
- `src/features/plugins/twin/sub_training/useTrainingMomentum.ts`
- `src/features/plugins/twin/sub_training/topicCoverage.ts`
- `src/features/plugins/twin/sub_profiles/ProfilesPage.tsx`
- `src/features/plugins/twin/sub_profiles/ProfilesAtelier.tsx`
- `src/features/plugins/twin/sub_profiles/TwinHero.tsx`
- `src/features/plugins/twin/sub_profiles/CompleteTwinChecklist.tsx`
- `src/features/plugins/twin/sub_profiles/CreateTwinWizard.tsx`
- `src/features/plugins/twin/sub_tone/TonePage.tsx`
- `src/features/plugins/twin/sub_tone/ToneAtelier.tsx`
- `src/features/plugins/twin/sub_tone/ToneBaseline.tsx`
- `src/features/plugins/twin/sub_tone/ToneConsole.tsx`

**Entry points:** src/features/plugins/twin/sub_training/TrainingAtelier.tsx, src/features/plugins/twin/sub_training/useTrainingSession.ts, src/features/plugins/twin/sub_profiles/ProfilesAtelier.tsx

**Keywords:** training, interview, Q&A, topic, coverage, momentum, memory generation, follow-up, AI question generation, twin profile, create twin, wizard

**API surface:** AI question generation + memory save via twinApi

**Tech stack:** React 19, TypeScript, Framer Motion, Zustand 5, Tailwind 4

---

### project-overview

The Project Overview page consolidates health metrics, pipeline state, and standards scan results for the active dev project. It exposes a PulseGlyph animated health indicator, an editable pipeline view, and a standards scan card. Adapters normalise heterogeneous API shapes into the unified view model; overviewHelpers perform metric derivations tested in isolation.

**Files:**
- `src/features/plugins/dev-tools/sub_overview/ProjectOverviewPage.tsx`
- `src/features/plugins/dev-tools/sub_overview/OverviewParts.tsx`
- `src/features/plugins/dev-tools/sub_overview/EditableProjectPipeline.tsx`
- `src/features/plugins/dev-tools/sub_overview/PulseGlyph.tsx`
- `src/features/plugins/dev-tools/sub_overview/pulseGlyphData.ts`
- `src/features/plugins/dev-tools/sub_overview/StandardsScanCard.tsx`
- `src/features/plugins/dev-tools/sub_overview/adapters.ts`
- `src/features/plugins/dev-tools/sub_overview/overviewHelpers.ts`
- `src/features/plugins/dev-tools/sub_overview/pipelineFieldEditor.tsx`
- `src/features/plugins/dev-tools/sub_overview/useOverviewData.ts`
- `src/features/plugins/dev-tools/sub_overview/__tests__/overviewHelpers.test.ts`

**Entry points:** src/features/plugins/dev-tools/sub_overview/ProjectOverviewPage.tsx, src/features/plugins/dev-tools/sub_overview/useOverviewData.ts

**Keywords:** project-overview, health-metrics, pipeline-state, standards-scan, pulse-glyph, adapters

**API surface:** GET project overview, GET standards scan status

**Tech stack:** React 19, TypeScript, Tauri 2, Vitest

---

### run-desk

The Run Desk is the execution surface for dispatched dev tasks — a paged, event-driven task queue replacing the old Task Runner. It renders tasks grouped by status, supports retry/cancel, shows real streaming output via TaskOutputPanel, manages auto-run banners backed by dev_auto_runs, and surfaces a self-healing panel that recommends retries for failed tasks. PrBridge handles PR integration.

**Files:**
- `src/features/plugins/dev-tools/sub_runner/RunDeskPage.tsx`
- `src/features/plugins/dev-tools/sub_runner/RunDeskControls.tsx`
- `src/features/plugins/dev-tools/sub_runner/AutoRunBanner.tsx`
- `src/features/plugins/dev-tools/sub_runner/SelfHealingPanel.tsx`
- `src/features/plugins/dev-tools/sub_runner/TaskCard.tsx`
- `src/features/plugins/dev-tools/sub_runner/TaskModal.tsx`
- `src/features/plugins/dev-tools/sub_runner/TaskOutputPanel.tsx`
- `src/features/plugins/dev-tools/sub_runner/PrBridge.tsx`
- `src/features/plugins/dev-tools/sub_runner/useTaskQueue.ts`

**Entry points:** src/features/plugins/dev-tools/sub_runner/RunDeskPage.tsx, src/features/plugins/dev-tools/sub_runner/useTaskQueue.ts

**Keywords:** task-runner, run-desk, task-queue, auto-run, self-healing, retry, pr-bridge, task-status

**API surface:** createTask, cancelTaskExecution, retryTask, batchFromAcceptedIdeas

**Tech stack:** React 19, TypeScript, Tauri 2, Zustand 5

---

### scraper

Guided 5-step wizard modal for creating and editing scraper configurations. Steps cover Source (URLs + name), Extract (field rules via LLM builder or manual), Preview (dry-run), Output (dataset + key field), and Schedule (cron + enabled toggle). Form state is managed by `useScrapeForm`, which serialises to/from the wire `ScraperConfigInput` format; step completion is tracked for the progress rail. [Consolidated 2026-08-04: absorbed extraction-rules, scraper-control-room]

**Files:**
- `src/features/scraper/ScrapeEditorModal.tsx`
- `src/features/scraper/ScrapeEditorWizard.tsx`
- `src/features/scraper/EditorSteps.tsx`
- `src/features/scraper/useScrapeForm.ts`
- `src/features/scraper/FieldRuleRows.tsx`
- `src/features/scraper/LlmRuleBuilder.tsx`
- `src/features/scraper/PreviewResults.tsx`
- `src/features/scraper/ScraperPage.tsx`
- `src/features/scraper/ScraperControlRoom.tsx`
- `src/features/scraper/useScraperData.ts`

**Entry points:** src/features/scraper/ScrapeEditorModal.tsx, src/features/scraper/useScrapeForm.ts, src/features/scraper/LlmRuleBuilder.tsx

**Keywords:** wizard, scrape config, url, schedule, cron, dataset, editor, pipeline steps, form, css selector, regex, json pointer

**API surface:** saveScraperConfig, previewScraperExtract (via @/api/scraper)

**Tech stack:** React 19, TypeScript, Tauri 2

---

### workspace-knowledge

The Workspaces Knowledge Center organises practices and knowledge across a portfolio of workspaces. WorkspacesAtlas renders the workspace map; WorkspaceTabs and WorkspacePulse show workspace-level health and tabs; SwitcherBreadcrumb and useWorkspaceSwitch manage the active workspace; MoveToWorkspaceButton and WorkspaceEditMenu handle governance actions; workspaceStore persists active state.

**Files:**
- `src/features/plugins/dev-tools/sub_workspaces/WorkspacesPage.tsx`
- `src/features/plugins/dev-tools/sub_workspaces/WorkspacesAtlas.tsx`
- `src/features/plugins/dev-tools/sub_workspaces/WorkspaceTabs.tsx`
- `src/features/plugins/dev-tools/sub_workspaces/WorkspaceEditMenu.tsx`
- `src/features/plugins/dev-tools/sub_workspaces/SwitcherBreadcrumb.tsx`
- `src/features/plugins/dev-tools/sub_workspaces/MoveToWorkspaceButton.tsx`
- `src/features/plugins/dev-tools/sub_workspaces/useWorkspaceSwitch.ts`
- `src/features/plugins/dev-tools/sub_workspaces/workspaceStore.ts`
- `src/features/plugins/dev-tools/sub_workspaces/centerShared.tsx`

**Entry points:** src/features/plugins/dev-tools/sub_workspaces/WorkspacesPage.tsx, src/features/plugins/dev-tools/sub_workspaces/workspaceStore.ts

**Keywords:** workspace, knowledge-center, workspace-atlas, workspace-pulse, workspace-switch, portfolio

**API surface:** listWorkspaces, updateWorkspace via devTools API

**Tech stack:** React 19, TypeScript, Tauri 2, Zustand 5

---

## Platform Infrastructure

> **Group type:** infrastructure
> **Color:** indigo

### api-bridge-tests

Vitest unit tests for the `src/api` IPC bridge layer, covering the most critical command surfaces: credentials, enums, events, executions, memories, messages, observability, personas, settings, system, and triggers. These tests validate the typed wrappers and serialization contracts between the React frontend and Tauri backend without requiring a running desktop binary.

**Files:**
- `src/api/__tests__/credentials.test.ts`
- `src/api/__tests__/enums.test.ts`
- `src/api/__tests__/events.test.ts`
- `src/api/__tests__/executions.test.ts`
- `src/api/__tests__/memories.test.ts`
- `src/api/__tests__/messages.test.ts`
- `src/api/__tests__/observability.test.ts`
- `src/api/__tests__/personas.test.ts`
- `src/api/__tests__/settings.test.ts`
- `src/api/__tests__/system.test.ts`
- `src/api/__tests__/triggers.test.ts`

**Entry points:** src/api/__tests__/personas.test.ts, src/api/__tests__/executions.test.ts

**Keywords:** Vitest, unit test, IPC bridge, serialization, mock, invoke, credentials, executions, personas, observability

**Tech stack:** Vitest, TypeScript, React 19

---

### api-system

IPC wrappers for the AI-assisted persona design pipeline (start/refine/cancel design analysis, feasibility testing, compile-from-intent), template adoption (snapshot polling, answer submission for AI-guided questionnaire), n8n workflow import-and-transform (converting n8n workflow JSON into persona drafts), template rating/feedback, localized team presets, and platform definition management (custom node-type schemas for non-standard automation platforms). Together these power the full persona creation funnel from template or blank canvas. [Consolidated 2026-08-04: absorbed system-config-api, system-core-api, system-integrations-api]

**Files:**
- `src/api/design/design.ts`
- `src/api/templates/templateAdopt.ts`
- `src/api/templates/n8nTransform.ts`
- `src/api/templates/templateFeedback.ts`
- `src/api/templates/teamPresets.ts`
- `src/api/platforms/platformDefinitions.ts`
- `src/api/recipes/recipes.ts`
- `src/api/system/settings.ts`
- `src/api/system/tierUsage.ts`
- `src/api/system/dataPortability.ts`
- `src/api/system/byom.ts`
- `src/api/enums.ts`
- `src/api/system/system.ts`
- `src/api/system/systemMetrics.ts`
- `src/api/system/managementApiAuth.ts`
- `src/api/system/gitlab.ts`
- `src/api/system/qwen.ts`
- `src/api/system/cloud.ts`
- `src/api/system/desktop.ts`
- `src/api/system/apiProxy.ts`
- `src/api/system/ambientContext.ts`

**Entry points:** src/api/design/design.ts, src/api/templates/templateAdopt.ts, src/api/system/settings.ts

**Keywords:** design, template, adopt, n8n, feedback, rating, team preset, platform definition, feasibility, compile-from-intent, recipe, settings

**API surface:** Tauri commands: start_design_analysis, refine_design, start_adopt_template, get_adopt_snapshot, transform_n8n_workflow, rate_template, list_team_presets, list_platform_definitions, list_recipes

**Tech stack:** Tauri 2, TypeScript, React 19

---

### appearance-settings

Manages all visual customisation for the application: language/locale selection with lazy-chunked bundle loading, UI density (compact/comfortable/spacious), text size, timezone for relative timestamps, display brightness, WCAG-annotated theme selection with hover previews, and a full custom-theme palette editor. Theme choices and density/brightness overrides are persisted through the app_settings Tauri command layer. Provides the ThemePreview and AppearanceThemeHoverPreview components used inline by other settings surfaces.

**Files:**
- `src/features/settings/sub_appearance/components/AppearanceBrightnessSettings.tsx`
- `src/features/settings/sub_appearance/components/AppearanceDensitySettings.tsx`
- `src/features/settings/sub_appearance/components/AppearanceLanguageSettings.tsx`
- `src/features/settings/sub_appearance/components/AppearanceSettings.tsx`
- `src/features/settings/sub_appearance/components/AppearanceTextSizeSettings.tsx`
- `src/features/settings/sub_appearance/components/AppearanceThemeHoverPreview.tsx`
- `src/features/settings/sub_appearance/components/AppearanceThemeSwatch.tsx`
- `src/features/settings/sub_appearance/components/AppearanceThemingSection.tsx`
- `src/features/settings/sub_appearance/components/AppearanceTimezoneSettings.tsx`
- `src/features/settings/sub_appearance/components/AppearanceToggleRow.tsx`
- `src/features/settings/sub_appearance/components/ColorRow.tsx`
- `src/features/settings/sub_appearance/components/CustomThemeCreator.tsx`
- `src/features/settings/sub_appearance/components/ThemePreview.tsx`

**Entry points:** src/features/settings/sub_appearance/components/AppearanceSettings.tsx

**Keywords:** theme, language, locale, density, text-size, timezone, brightness, WCAG, dark-mode, custom-theme

**API surface:** getAppSetting / setAppSetting (theme, density, language, timezone, brightness)

**Tech stack:** React 19, TypeScript, Tailwind 4, Zustand 5

---

### core

The foundational type definitions and singletons that every other crate in the Personas desktop build depends on. Provides the execution state machine via the `declare_lifecycle!` macro, engine kind enum, hard execution ceilings, the SQLite connection-pool type alias, the IPC in-flight counter, event name constants, and the managed drive root cache. These primitives cannot depend on any other Personas crate — they sit at the very bottom of the dependency graph. [Consolidated 2026-08-04: absorbed core-crypto-redact, core-error-handling, core-http-safety, cron-scheduling, execution-evaluation, execution-tracing-budget, cloud-execution-runner, cloud-orchestrator-client, remote-command-approval, sensor-capture]

**Files:**
- `src-tauri/core/src/lib.rs`
- `src-tauri/core/src/lifecycle.rs`
- `src-tauri/core/src/types.rs`
- `src-tauri/core/src/limits.rs`
- `src-tauri/core/src/engine_kind.rs`
- `src-tauri/core/src/pool.rs`
- `src-tauri/core/src/drive_root.rs`
- `src-tauri/core/src/ipc_gauge.rs`
- `src-tauri/core/src/events.rs`
- `src-tauri/core/src/crypto.rs`
- `src-tauri/core/src/redact.rs`
- `src-tauri/core/src/healthcheck_ledger.rs`
- `src-tauri/core/src/error.rs`
- `src-tauri/core/src/error_taxonomy.rs`
- `src-tauri/core/src/http_clients.rs`
- `src-tauri/core/src/url_safety.rs`
- `src-tauri/core/src/cron.rs`
- `src-tauri/core/src/scheduler.rs`
- `src-tauri/core/src/digest_config.rs`
- `src-tauri/core/src/evolution_status.rs`
- `src-tauri/core/src/harvest_scopes.rs`
- `src-tauri/core/src/score_weights.rs`
- `src-tauri/core/src/topology_graph.rs`
- `src-tauri/core/src/trace.rs`
- `src-tauri/core/src/run_budget.rs`
- `src-tauri/src/cloud/runner.rs`
- `src-tauri/src/cloud/mod.rs`
- `src-tauri/src/cloud/config.rs`
- `src-tauri/src/cloud/client.rs`
- `src-tauri/src/cloud/remote_commands.rs`
- `src-tauri/src/commands/ocr/mod.rs`
- `src-tauri/src/commands/radio.rs`
- `src-tauri/src/commands/drive.rs`

**Entry points:** src-tauri/core/src/lib.rs, src-tauri/core/src/types.rs, src-tauri/core/src/lifecycle.rs

**Keywords:** execution-state, lifecycle, FSM, state-machine, engine-kind, IPC, event-names, crate-foundation, limits, pool, AES-256-GCM, RSA

**Tech stack:** Rust, serde, ts-rs, r2d2, r2d2-sqlite

---

### dev-tools-features

Sub-feature modules for Developer Tools — competition tracking, context management, git operations, goal management, milestone tracking, portfolio views, triage rules, and workspace management. Each module is a focused slice of the Dev Tools product surface, reusing the shared dev_tools repo.

**Files:**
- `src-tauri/src/commands/infrastructure/dev_tools/competitions.rs`
- `src-tauri/src/commands/infrastructure/dev_tools/contexts.rs`
- `src-tauri/src/commands/infrastructure/dev_tools/git_ops.rs`
- `src-tauri/src/commands/infrastructure/dev_tools/goals.rs`
- `src-tauri/src/commands/infrastructure/dev_tools/milestones.rs`
- `src-tauri/src/commands/infrastructure/dev_tools/portfolio.rs`
- `src-tauri/src/commands/infrastructure/dev_tools/triage.rs`
- `src-tauri/src/commands/infrastructure/dev_tools/workspace.rs`

**Entry points:** src-tauri/src/commands/infrastructure/dev_tools/milestones.rs

**Keywords:** milestone, goal, triage, portfolio, git, competition, context

**API surface:** dev_tools_list_milestones, dev_tools_create_goal, dev_tools_triage_backlog, dev_tools_git_checkpoint

**Tech stack:** Tauri 2, Rust, SQLite, git

---

### engine-core-infrastructure

Engine module root and cross-cutting infrastructure: the mod.rs re-export hub that surfaces personas_core and personas_engine crates; AI helper utilities for LLM output extraction; LLM topology prompt builder for multi-persona workflow composition; system-operation runtime (context_scan); management HTTP API (/api/*) for external tool control; recipe seed bootstrap; dynamic resource discovery for adoption questionnaires; background job framework for user-persona curation jobs; and the leadership module that coordinates which process instance owns singleton background loops. [Consolidated 2026-08-04: absorbed ambient-desktop-signals, team-topology, access-control, event-bus-routing]

**Files:**
- `src-tauri/src/engine/mod.rs`
- `src-tauri/src/engine/ai_helpers.rs`
- `src-tauri/src/engine/llm_topology.rs`
- `src-tauri/src/engine/system_ops.rs`
- `src-tauri/src/engine/management_api.rs`
- `src-tauri/src/engine/recipe_seed.rs`
- `src-tauri/src/engine/discovery.rs`
- `src-tauri/src/engine/curation_scheduler.rs`
- `src-tauri/src/engine/persona_jobs.rs`
- `src-tauri/src/engine/leadership.rs`
- `src-tauri/engine/src/ambient_context.rs`
- `src-tauri/engine/src/ambient_signal_repo.rs`
- `src-tauri/engine/src/app_focus.rs`
- `src-tauri/engine/src/clipboard_monitor.rs`
- `src-tauri/engine/src/clipboard_error_detector.rs`
- `src-tauri/engine/src/file_watcher.rs`
- `src-tauri/engine/src/context_rules.rs`
- `src-tauri/engine/src/workflow_compiler.rs`
- `src-tauri/engine/src/team_handoff.rs`
- `src-tauri/engine/src/team_preset_loader.rs`
- `src-tauri/engine/src/topology_heuristic.rs`
- `src-tauri/engine/src/topology_types.rs`
- `src-tauri/engine/src/optimizer.rs`
- `src-tauri/engine/src/scope_enforcement.rs`
- `src-tauri/engine/src/path_safety.rs`
- `src-tauri/engine/src/platform_rules.rs`
- `src-tauri/engine/src/tier.rs`
- `src-tauri/engine/src/desktop_security.rs`
- `src-tauri/engine/src/bus.rs`
- `src-tauri/engine/src/events.rs`
- `src-tauri/engine/src/event_registry.rs`
- `src-tauri/engine/src/event_vocabulary.rs`
- `src-tauri/engine/src/shared_event_local_relay.rs`

**Entry points:** src-tauri/src/engine/mod.rs, src-tauri/src/engine/management_api.rs, src-tauri/engine/src/ambient_context.rs

**Keywords:** engine, module root, management API, system ops, context scan, recipe seed, discovery, job framework, curation, leadership, ambient, clipboard

**API surface:** GET/POST /api/personas, /api/lab, /api/versions (management HTTP)

**Tech stack:** Rust, Tauri 2, Tokio, axum, SQLite (rusqlite)

---

### hooks-utility-data

Hooks for reading and persisting application settings: a generic app-setting accessor, granular density/layout-density preferences, engine capability detection, CLI readiness checks, auto-installer and auto-updater flows, formatted-date helpers, and settings-page utilities. These hooks wrap the settings Tauri commands and surface values from the settings store to components. [Consolidated 2026-08-04: absorbed data-collection-hooks]

**Files:**
- `src/hooks/utility/data/useSettings.ts`
- `src/hooks/utility/data/useAppSetting.ts`
- `src/hooks/utility/data/useDensity.ts`
- `src/hooks/utility/data/useEngineCapabilities.ts`
- `src/hooks/utility/data/useCliReadiness.ts`
- `src/hooks/utility/data/useAutoInstaller.ts`
- `src/hooks/utility/data/useAutoUpdater.ts`
- `src/hooks/utility/data/useFormattedDate.ts`
- `src/hooks/utility/data/__tests__/useSettings.test.ts`
- `src/hooks/utility/data/usePersonaMap.ts`
- `src/hooks/utility/data/useModuleSubscription.ts`
- `src/hooks/utility/data/usePersistedContext.ts`
- `src/hooks/utility/data/useFilteredCollection.ts`
- `src/hooks/utility/data/useLayeredList.ts`
- `src/hooks/utility/data/useBackgroundSnapshot.ts`
- `src/hooks/utility/data/__tests__/useLayeredList.test.ts`

**Entry points:** src/hooks/utility/data/useSettings.ts, src/hooks/utility/data/useAppSetting.ts, src/hooks/utility/data/usePersonaMap.ts

**Keywords:** settings, density, engine-capabilities, CLI-readiness, auto-installer, auto-updater, formatted-date, preferences, persona-map, module-subscription, persisted-context, filtered-collection

**API surface:** Tauri commands: get_setting, set_setting, check_cli_readiness, install_component

**Tech stack:** React 19, TypeScript, Tauri 2, Zustand 5

---

### hooks-utility-interaction

Hooks for UI motion, progressive disclosure, accessibility, and save-state feedback: a motion preference hook respecting prefers-reduced-motion, progressive reveal animations for list items, tracked element rect for anchor-positioned overlays, roving tab-index for keyboard navigation, async action state management, unsaved-change guards, save feedback toasts, settings-save toasts, and tier-gating checks. Shared across many feature surfaces. [Consolidated 2026-08-04: absorbed viewport-interaction-hooks]

**Files:**
- `src/hooks/utility/interaction/useMotion.ts`
- `src/hooks/utility/interaction/useProgressiveReveal.ts`
- `src/hooks/utility/interaction/useTrackedElementRect.ts`
- `src/hooks/utility/interaction/useRovingTabIndex.ts`
- `src/hooks/utility/interaction/useAsyncAction.ts`
- `src/hooks/utility/interaction/useUnsavedGuard.ts`
- `src/hooks/utility/interaction/useSaveFeedback.ts`
- `src/hooks/utility/interaction/useSettingsSaveToast.ts`
- `src/hooks/utility/interaction/useTier.ts`
- `src/hooks/utility/interaction/useToggleSet.ts`
- `src/hooks/utility/interaction/__tests__/useMotion.test.ts`
- `src/hooks/utility/interaction/__tests__/useProgressiveReveal.test.ts`
- `src/hooks/utility/interaction/__tests__/useTrackedElementRect.test.ts`
- `src/hooks/utility/interaction/useClickOutside.ts`
- `src/hooks/utility/interaction/useCopyToClipboard.ts`
- `src/hooks/utility/interaction/useKeyedCopyFlag.ts`
- `src/hooks/utility/interaction/useEndReached.ts`
- `src/hooks/utility/interaction/useIsCompact.ts`
- `src/hooks/utility/interaction/useMobilePreview.ts`
- `src/hooks/utility/interaction/useVirtualList.ts`
- `src/hooks/utility/interaction/useViewportClamp.ts`
- `src/hooks/utility/interaction/useScrollShadow.ts`
- `src/hooks/utility/interaction/useScrollRestoration.ts`
- `src/hooks/utility/interaction/__tests__/useScrollRestoration.test.ts`

**Entry points:** src/hooks/utility/interaction/useMotion.ts, src/hooks/utility/interaction/useAsyncAction.ts, src/hooks/utility/interaction/useProgressiveReveal.ts

**Keywords:** motion, animation, progressive-reveal, roving-tab-index, async-action, unsaved-guard, save-feedback, tier, toggle, accessibility, click-outside, clipboard

**Tech stack:** React 19, TypeScript

---

### i18n

Manages the English base translation bundle through a lazy-parse cache. `englishSections.ts` stores all sections as raw JSON strings (generated into `enSectionStrings.ts`) and parses each section on first access, eliminating the 500KB+ cold-parse cost. `en.ts` is a backward-compat Proxy shim so legacy imports of `{ en, type Translations }` continue to compile without per-file updates. [Consolidated 2026-08-04: absorbed error-analytics, i18n-debt-text, i18n-error-resolution, i18n-locale-registry, i18n-pseudo-locale, i18n-route-sections, i18n-token-resolution, i18n-translation-hook]

**Files:**
- `src/i18n/englishSections.ts`
- `src/i18n/en.ts`
- `src/i18n/generated/enSectionStrings.ts`
- `src/lib/silentCatch.ts`
- `src/lib/errors/errorRegistry.ts`
- `src/i18n/useTranslatedError.ts`
- `src/i18n/DebtText.tsx`
- `src/i18n/locales.manifest.ts`
- `src/i18n/pseudoLocale.ts`
- `src/i18n/routeSections.ts`
- `src/i18n/useSidebarTranslation.ts`
- `src/i18n/tokenMaps.ts`
- `src/i18n/useTranslation.ts`

**Entry points:** src/i18n/englishSections.ts, src/lib/silentCatch.ts, src/lib/errors/errorRegistry.ts

**Keywords:** English bundle, section cache, getEnglishSection, lazy parse, back-compat shim, enSectionStrings, sentry, error-registry, toast, crash, silent-catch, error-handling

**Tech stack:** TypeScript

---

### i18n-generated

Test suite and behavioral contract for the i18n system. `useTranslatedError.test.ts` pins the four-link error resolution fallback chain (translated → raw fallback → English friendly → generic). `chainStopReasons.parity.test.ts` enforces parity between the Rust backend's `stop_reason` string constants and the i18n `status_tokens.chain_stop` keys, catching untranslated tokens at build time. `CONTRACT.md` documents the four-layer translation contract (Rust codes → IPC → React → translators). [Consolidated 2026-08-04: absorbed i18n-type-system]

**Files:**
- `src/i18n/__tests__/useTranslatedError.test.ts`
- `src/i18n/__tests__/chainStopReasons.parity.test.ts`
- `src/i18n/generated/types.ts`

**Entry points:** src/i18n/__tests__/useTranslatedError.test.ts, src/i18n/generated/types.ts

**Keywords:** error fallback chain, stop reason parity, Vitest, i18n contract, chain stop reasons, translation coverage, Translations type, codegen, TypeScript types, type safety, autocomplete, gen-types

**Tech stack:** Vitest, TypeScript

---

### lib-analytics

Declarative navigation-usage analytics that auto-tracks every section and tab visit without a hand-maintained map. Subscribes to Zustand nav stores, emits structured `feature_visit` events through the pluggable `AnalyticsSink` abstraction, accumulates per-session counts, and flushes a single `session_summary` (visited + ignored) on `beforeunload`. The `navCatalog` drives coverage so adding a new tab to the store and listing it in the catalog is sufficient — no instrumentation code to write. [Consolidated 2026-08-04: absorbed analytics-activation]

**Files:**
- `src/lib/analytics/index.ts`
- `src/lib/analytics/navCatalog.ts`
- `src/lib/analytics/summary.ts`
- `src/lib/analytics/sink.ts`
- `src/lib/analytics/sink.test.ts`
- `src/lib/analytics/summary.test.ts`
- `src/lib/analytics/activation.ts`
- `src/lib/analytics/activation.test.ts`

**Entry points:** src/lib/analytics/index.ts, src/lib/analytics/sink.ts, src/lib/analytics/activation.ts

**Keywords:** analytics, telemetry, navigation, feature_visit, session_summary, sink, sentry, tab_switch, navCatalog, beforeunload, activation, funnel

**API surface:** AnalyticsSink interface (feature, interaction, session, conversion); setAnalyticsSink / applyTelemetrySink for runtime backend swap

**Tech stack:** TypeScript, Zustand 5, Sentry

---

### lib-utils-sanitizers

Unit tests for the shared utility layer, covering terminal line classification, formatter edge cases, safeInvoke command-not-found detection, URL sanitization, and prompt injection stripping. These tests act as a regression guard for security-sensitive primitives that have no higher-level integration tests. [Consolidated 2026-08-04: absorbed prompt-injection-defense, sensitive-data-masking, url-html-sanitization, connector-helpers, crypto-utils, model-pricing, platform-detection]

**Files:**
- `src/lib/utils/__tests__/terminalColors.test.ts`
- `src/lib/utils/__tests__/formatters.test.ts`
- `src/lib/utils/__tests__/safeInvoke.test.ts`
- `src/lib/utils/sanitizers/__tests__/sanitizeUrl.test.ts`
- `src/lib/utils/sanitizers/__tests__/promptInjection.test.ts`
- `src/lib/utils/sanitizers/promptInjection.ts`
- `src/lib/utils/sanitizers/variableSanitizer.ts`
- `src/lib/utils/sanitizers/workflowSanitizer.ts`
- `src/lib/utils/sanitizers/maskSensitive.ts`
- `src/lib/utils/sanitizers/sanitizeErrorForDisplay.ts`
- `src/lib/utils/sanitizers/sanitizeCloudReview.ts`
- `src/lib/utils/sanitizers/sanitizeUrl.ts`
- `src/lib/utils/sanitizers/sanitizeHtml.ts`
- `src/lib/utils/platform/connectors.ts`
- `src/lib/utils/platform/crypto.ts`
- `src/lib/utils/platform/pricing.ts`
- `src/lib/utils/platform/platform.ts`
- `src/lib/utils/platform/osNotification.ts`

**Entry points:** src/lib/utils/__tests__/formatters.test.ts, src/lib/utils/sanitizers/promptInjection.ts, src/lib/utils/sanitizers/maskSensitive.ts

**Keywords:** test, vitest, terminal, formatter, safeInvoke, sanitize, URL, prompt-injection, LLM, jailbreak, variable-substitution, workflow

**Tech stack:** TypeScript, Vitest

---

### p2p-lan-network

Full LAN peer-to-peer networking stack for the Invisible Apps system, providing mDNS discovery, QUIC transport, connection management, agent-to-agent messaging, and manifest sync. Compiled only with the p2p feature flag; the NetworkService struct orchestrates all sub-systems and exposes a typed API for persona canvas sharing and peer execution.

**Files:**
- `src-tauri/engine/src/p2p/mod.rs`
- `src-tauri/engine/src/p2p/connection.rs`
- `src-tauri/engine/src/p2p/manifest_sync.rs`
- `src-tauri/engine/src/p2p/mdns.rs`
- `src-tauri/engine/src/p2p/messaging.rs`
- `src-tauri/engine/src/p2p/periodic.rs`
- `src-tauri/engine/src/p2p/protocol.rs`
- `src-tauri/engine/src/p2p/transport.rs`
- `src-tauri/engine/src/p2p/types.rs`

**Entry points:** src-tauri/engine/src/p2p/mod.rs

**Keywords:** P2P, LAN, mDNS, QUIC, transport, messaging, discovery, network, peer

**Tech stack:** Rust, Tokio, Quinn (QUIC)

---

### p2p-network

Peer-to-peer networking and device management — mDNS/QUIC-based device discovery, enclave creation, network bundle management, exposure controls (which personas are visible on the network), device identity, and owned-device registry. Also includes the P2P signing module for cryptographic session verification. Gated behind the `p2p` Cargo feature.

**Files:**
- `src-tauri/src/commands/network/bundle.rs`
- `src-tauri/src/commands/network/discovery.rs`
- `src-tauri/src/commands/network/enclave.rs`
- `src-tauri/src/commands/network/exposure.rs`
- `src-tauri/src/commands/network/identity.rs`
- `src-tauri/src/commands/network/mod.rs`
- `src-tauri/src/commands/network/owned_devices.rs`
- `src-tauri/src/commands/signing/mod.rs`

**Entry points:** src-tauri/src/commands/network/discovery.rs

**Keywords:** p2p, mdns, quic, discovery, enclave, identity, device, signing

**API surface:** discover_peers, create_enclave, list_owned_devices, sign_session, set_exposure

**Tech stack:** Tauri 2, Rust, QUIC, mDNS

---

### resource-tracking

LLM spend tracking, tier usage enforcement, and memory ledger health. Monitors per-persona and per-session token costs, enforces subscription-tier limits, and audits the health of the companion brain's memory store. Feeds the billing and tier dashboards. [Consolidated 2026-08-04: absorbed research-tools, cloud-sync, skill-management]

**Files:**
- `src-tauri/src/commands/infrastructure/llm_spend.rs`
- `src-tauri/src/commands/infrastructure/tier_usage.rs`
- `src-tauri/src/commands/infrastructure/memory_ledger.rs`
- `src-tauri/src/commands/infrastructure/memory_health.rs`
- `src-tauri/src/commands/infrastructure/research_lab.rs`
- `src-tauri/src/commands/infrastructure/scraper.rs`
- `src-tauri/src/commands/infrastructure/qwen_engine.rs`
- `src-tauri/src/commands/infrastructure/idea_scanner.rs`
- `src-tauri/src/commands/infrastructure/cloud.rs`
- `src-tauri/src/commands/infrastructure/cloud_sync.rs`
- `src-tauri/src/commands/infrastructure/skill_files.rs`
- `src-tauri/src/commands/infrastructure/skill_usage.rs`

**Entry points:** src-tauri/src/commands/infrastructure/llm_spend.rs, src-tauri/src/commands/infrastructure/research_lab.rs, src-tauri/src/commands/infrastructure/cloud_sync.rs

**Keywords:** spend, token, tier, budget, memory, ledger, billing, research, scraper, qwen, idea, scan

**API surface:** get_llm_spend, get_tier_usage, audit_memory_health, list_memory_ledger

**Tech stack:** Tauri 2, Rust, SQLite

---

### settings-network

Handles resource exposure management and cryptographically signed bundle exchange over the P2P network. Operators control which personas, templates, and connectors are exposed at which access level (ExposureManager), generate signed shareable bundle archives with enclave verification (BundleExportDialog), and import bundles from peers with conflict preview, provenance badge display, enclave tamper detection, and import success celebration (BundleImportDialog, BundlePreviewContent, EnclaveVerificationView). ShareLinkHandler resolves incoming share-link deep links. [Consolidated 2026-08-04: absorbed network-peer-management, settings-shell, account-cloud-sync, settings-audit-admin, engine-capability-matrix, spend-limits, notification-settings]

**Files:**
- `src/features/settings/sub_network/components/BundleExportDialog.tsx`
- `src/features/settings/sub_network/components/BundleImportDialog.tsx`
- `src/features/settings/sub_network/components/BundlePreviewContent.tsx`
- `src/features/settings/sub_network/components/EnclaveVerificationView.tsx`
- `src/features/settings/sub_network/components/ExposureManager.tsx`
- `src/features/settings/sub_network/components/ImportSuccessCelebration.tsx`
- `src/features/settings/sub_network/components/InlineConfirm.tsx`
- `src/features/settings/sub_network/components/ProvenanceBadge.tsx`
- `src/features/settings/sub_network/components/ShareLinkHandler.tsx`
- `src/features/settings/sub_network/components/IdentitySettings.tsx`
- `src/features/settings/sub_network/components/NetworkDashboard.tsx`
- `src/features/settings/sub_network/components/NetworkIcons.tsx`
- `src/features/settings/sub_network/components/NetworkAccessScopeBadge.tsx`
- `src/features/settings/sub_network/components/PeerCard.tsx`
- `src/features/settings/sub_network/components/PeerDetailDrawer.tsx`
- `src/features/settings/sub_network/components/PeerList.tsx`
- `src/features/settings/components/SettingsPage.tsx`
- `src/features/settings/components/AppearancePickers.tsx`
- `src/features/settings/components/AmbientContextPanel.tsx`
- `src/features/settings/search/useSettingsSearchEntries.tsx`
- `src/features/settings/shared/RecentChangeChip.tsx`
- `src/features/settings/shared/useConfirmClick.ts`
- `src/features/settings/sub_account/components/AccountSettings.tsx`
- `src/features/settings/sub_account/components/CloudSyncCard.tsx`
- `src/features/settings/sub_history/components/SettingsHistoryTab.tsx`
- `src/features/settings/sub_admin/components/AdminSettings.tsx`
- `src/features/settings/sub_engine/components/EngineCapabilityBadge.tsx`
- `src/features/settings/sub_engine/components/EngineSettings.tsx`
- `src/features/settings/sub_engine/components/ModelRoutingSection.tsx`
- `src/features/settings/sub_engine/components/OperationRow.tsx`
- `src/features/settings/sub_engine/libs/engineCapabilities.ts`
- `src/features/settings/sub_limits/components/LimitsSettings.tsx`
- `src/features/settings/sub_notifications/components/NotificationSettings.tsx`
- `src/features/settings/sub_notifications/components/WebhookSubscriptionsPanel.tsx`

**Entry points:** src/features/settings/sub_network/components/ExposureManager.tsx, src/features/settings/sub_network/components/BundleExportDialog.tsx, src/features/settings/sub_network/components/NetworkDashboard.tsx

**Keywords:** bundle, export, import, enclave, provenance, exposure, share-link, signing, access-level, conflict, peer, P2P

**API surface:** ExposedResource CRUD (network/exposure); BundleImportPreview, NetworkAccessScope (network/bundle); EnclavePolicy, EnclaveVerifyResult (network/enclave)

**Tech stack:** React 19, TypeScript, Tauri 2, Zustand 5

---

### settings-portability

A prototype UI harness for granular selective export: a scope rail for choosing export categories (personas, teams, credentials, KPIs, etc.), a scrollable manifest cart showing selected items with counts, atom/panel/row primitives for the picker layout, and a useExportPicker hook that fetches live data from personas, credentials, teams, and KPI APIs to populate the selection UI. This is an experimental refinement of the ExportSelectionModal, kept isolated in the export-prototype sub-directory while it matures. [Consolidated 2026-08-04: absorbed data-portability-settings]

**Files:**
- `src/features/settings/sub_portability/components/export-prototype/ManifestCart.tsx`
- `src/features/settings/sub_portability/components/export-prototype/ScopeRail.tsx`
- `src/features/settings/sub_portability/components/export-prototype/atoms.tsx`
- `src/features/settings/sub_portability/components/export-prototype/panels.tsx`
- `src/features/settings/sub_portability/components/export-prototype/rows.tsx`
- `src/features/settings/sub_portability/components/export-prototype/types.ts`
- `src/features/settings/sub_portability/components/export-prototype/useExportPicker.ts`
- `src/features/settings/sub_portability/components/CredentialPortability.tsx`
- `src/features/settings/sub_portability/components/DataPortabilitySettings.tsx`
- `src/features/settings/sub_portability/components/ExportSection.tsx`
- `src/features/settings/sub_portability/components/ExportSelectionModal.tsx`
- `src/features/settings/sub_portability/components/StorageUsageSection.tsx`
- `src/features/settings/sub_portability/libs/useDataPortability.ts`

**Entry points:** src/features/settings/sub_portability/components/export-prototype/useExportPicker.ts, src/features/settings/sub_portability/components/export-prototype/ScopeRail.tsx, src/features/settings/sub_portability/components/DataPortabilitySettings.tsx

**Keywords:** export, picker, selective, manifest, scope, prototype, cart, KPI, credential, import, portability, backup

**API surface:** listPersonas, listCredentials, listTeams, listTeamMembers, listAllKpis

**Tech stack:** React 19, TypeScript, Jotai (atoms)

---

### stores

Top-level Zustand stores for cross-cutting app concerns: the system store composes UI, cloud, GitLab, onboarding, tour, dev-tools, fleet, network, and plugin slices. Satellite stores handle i18n locale selection, command palette state, toast notifications, and remote command dispatch. [Consolidated 2026-08-04: absorbed overview-store-root, pipeline-store-root, vault-store-root, creative-media-api, fleet-director-api, system-sync-api, app-state-hooks]

**Files:**
- `src/stores/systemStore.ts`
- `src/stores/i18nStore.ts`
- `src/stores/commandPaletteStore.ts`
- `src/stores/toastStore.ts`
- `src/stores/notificationCenterStore.ts`
- `src/stores/remoteCommandStore.ts`
- `src/stores/__tests__/systemStore.rehydrate.test.ts`
- `src/stores/__tests__/themeStore.rehydrate.test.ts`
- `src/stores/overviewStore.ts`
- `src/stores/improveActivityStore.ts`
- `src/stores/improveActivityStore.test.ts`
- `src/stores/pipelineStore.ts`
- `src/stores/vaultStore.ts`
- `src/stores/authStore.ts`
- `src/api/artist/index.ts`
- `src/api/radio.ts`
- `src/api/fleet/fleet.ts`
- `src/api/director.ts`
- `src/api/cloudSync.ts`
- `src/api/remoteCommands.ts`
- `src/api/liveRoadmap.ts`
- `src/hooks/useAttention.ts`
- `src/hooks/useStepProgress.ts`
- `src/hooks/useWizardReducer.ts`
- `src/hooks/useSliceError.ts`
- `src/hooks/useTauriEvent.ts`
- `src/hooks/index.ts`

**Entry points:** src/stores/systemStore.ts, src/stores/overviewStore.ts, src/stores/pipelineStore.ts

**Keywords:** system, i18n, locale, commandPalette, toast, notification, remote, compose, rehydrate, overview, dashboard, store

**Tech stack:** Zustand 5, TypeScript

---

### stores-slices-system

Slices powering the developer tools overlay — code context scanning, project indexing, task management, triage workflows, and the dev-tools scanner that maps file contexts. These slices back the DevInspector and context-scanning features used during active development sessions. [Consolidated 2026-08-04: absorbed fleet-orchestration-state, plugin-companion-state, plugin-obsidian-state, system-ambient-context-state, system-cloud-integration-state, system-onboarding-state, system-ui-theme-state]

**Files:**
- `src/stores/slices/system/devToolsSlice.ts`
- `src/stores/slices/system/devToolsContextSlice.ts`
- `src/stores/slices/system/devToolsProjectSlice.ts`
- `src/stores/slices/system/devToolsScannerSlice.ts`
- `src/stores/slices/system/devToolsTaskSlice.ts`
- `src/stores/slices/system/devToolsTaskSlice.test.ts`
- `src/stores/slices/system/devToolsTriageSlice.ts`
- `src/stores/slices/system/__tests__/devToolsTriageSlice.test.ts`
- `src/stores/slices/system/fleetSlice.ts`
- `src/stores/slices/system/fleetSlice.test.ts`
- `src/stores/remoteCommandStore.ts`
- `src/stores/slices/system/twinSlice.ts`
- `src/stores/slices/system/companionPluginSlice.ts`
- `src/stores/slices/system/artistSlice.ts`
- `src/stores/slices/system/researchLabSlice.ts`
- `src/stores/slices/system/radioSlice.ts`
- `src/stores/slices/system/__tests__/twinSlice.fetchTwinTones.test.ts`
- `src/stores/slices/system/obsidianBrainSlice.ts`
- `src/stores/slices/system/ambientContextSlice.ts`
- `src/stores/slices/system/cloudSlice.ts`
- `src/stores/slices/system/gitlabSlice.ts`
- `src/stores/slices/system/deployTarget.ts`
- `src/stores/slices/system/deployTarget.test.ts`
- `src/stores/slices/system/onboardingSlice.ts`
- `src/stores/slices/system/onboardingSlice.test.ts`
- `src/stores/slices/system/tourSlice.ts`
- `src/stores/slices/system/tourSlice.test.ts`
- `src/stores/slices/system/setupSlice.ts`
- `src/stores/slices/system/__tests__/tourAnchors.test.ts`
- `src/stores/__tests__/tourMockBuildSeam.test.ts`
- `src/stores/slices/system/uiSlice.ts`
- `src/stores/slices/system/uiSlice.test.ts`
- `src/stores/themeStore.ts`

**Entry points:** src/stores/slices/system/devToolsSlice.ts, src/stores/slices/system/devToolsScannerSlice.ts, src/stores/slices/system/fleetSlice.ts

**Keywords:** devTools, scanner, context, project, task, triage, overlay, inspect, fleet, session, headless, CLI

**Tech stack:** Zustand 5, TypeScript, Tauri IPC

---

### supabase-sync-pipeline

Incremental desktop-to-cloud sync writer that periodically (45s tick + event-driven dirty wakes) pushes secret-free projections of 11 local SQLite tables to the user's Supabase tenant via PostgREST upserts. `sync/mod.rs` orchestrates pass lifecycle, fault-isolated per-table syncing, tombstone-based delete propagation, and in-memory status snapshots; `sync/client.rs` is a thin PostgREST HTTP client (upsert/GET/PATCH/DELETE with 500-row chunking); `sync/cursor.rs` persists per-table RFC3339 watermarks + a stable device ID in `app_settings`; `sync/rows.rs` defines the secret-scrubbed row projections and the SQL that reads changed rows since each table's cursor, including AES-GCM payload decryption + secret-redaction for event payloads.

**Files:**
- `src-tauri/src/cloud/sync/mod.rs`
- `src-tauri/src/cloud/sync/client.rs`
- `src-tauri/src/cloud/sync/cursor.rs`
- `src-tauri/src/cloud/sync/rows.rs`

**Entry points:** src-tauri/src/cloud/sync/mod.rs, src-tauri/src/cloud/sync/rows.rs

**Keywords:** cloud-sync, Supabase, PostgREST, incremental-cursor, upsert, tombstone, delete-propagation, secret-scrubbing, device-heartbeat, RLS, dirty-flag

**API surface:** Supabase PostgREST: POST /rest/v1/{table} (upsert), GET /rest/v1/{table}?..., PATCH /rest/v1/{table}?..., DELETE /rest/v1/{table}?...

**Tech stack:** Rust, reqwest, rusqlite, Supabase, chrono, serde, tokio

---

### system-health

System health monitoring, MCP integration status, storage metrics, crash telemetry, and binary dependency detection (probing for FFmpeg, whisper, etc.). Provides the diagnostic layer that the app's health dashboard reads to surface capability gaps and system-level issues.

**Files:**
- `src-tauri/src/commands/infrastructure/system/binary_probe.rs`
- `src-tauri/src/commands/infrastructure/system/crash_telemetry.rs`
- `src-tauri/src/commands/infrastructure/system/health.rs`
- `src-tauri/src/commands/infrastructure/system/mcp_integration.rs`
- `src-tauri/src/commands/infrastructure/system/mod.rs`
- `src-tauri/src/commands/infrastructure/system/storage.rs`
- `src-tauri/src/commands/infrastructure/system_metrics.rs`
- `src-tauri/src/commands/infrastructure/system_ops.rs`

**Entry points:** src-tauri/src/commands/infrastructure/system/health.rs

**Keywords:** health, binary, probe, storage, crash, mcp, metrics, system

**API surface:** get_system_health, probe_binary, get_storage_usage, list_mcp_integrations

**Tech stack:** Tauri 2, Rust, Sentry

---

### timing-utility-hooks

Low-level timing and scheduling primitives: debounce for text input, debounced-save combining debounce with persist calls, elapsed timer for duration display, polling loops with configurable interval and backoff, RAF-coalesced callback scheduling to batch rapid updates into single animation frames, animated number interpolation for smooth counters, and a relative-time ticker for live 'X ago' labels.

**Files:**
- `src/hooks/utility/timing/useDebounce.ts`
- `src/hooks/utility/timing/useDebouncedSave.ts`
- `src/hooks/utility/timing/useElapsedTimer.ts`
- `src/hooks/utility/timing/usePolling.ts`
- `src/hooks/utility/timing/useRafCoalescedCallback.ts`
- `src/hooks/utility/timing/useAnimatedNumber.ts`
- `src/hooks/utility/timing/relativeTimeTicker.ts`
- `src/hooks/utility/timing/__tests__/relativeTimeTicker.test.ts`

**Entry points:** src/hooks/utility/timing/useDebounce.ts, src/hooks/utility/timing/usePolling.ts, src/hooks/utility/timing/useRafCoalescedCallback.ts

**Keywords:** debounce, polling, RAF, elapsed-timer, animated-number, relative-time, scheduling, timing

**Tech stack:** React 19, TypeScript

---

### workspace-governance

Codebase governance scanning — standards ruleset enforcement (linting rules against a configurable standards file), doc-rot detection (stale documentation finder), workspace divergence analysis, workspace harvesting (extracting structure from managed repos), and Git checkpoint/GitLab integration. [Consolidated 2026-08-04: absorbed context-scanning, app-settings, workflow-infrastructure, ai-director, kpi-intelligence, dev-tools-core]

**Files:**
- `src-tauri/src/commands/infrastructure/standards_scan.rs`
- `src-tauri/src/commands/infrastructure/doc_rot.rs`
- `src-tauri/src/commands/infrastructure/workspace_divergence.rs`
- `src-tauri/src/commands/infrastructure/workspace_harvest.rs`
- `src-tauri/src/commands/infrastructure/workspace_verify.rs`
- `src-tauri/src/commands/infrastructure/git_checkpoint.rs`
- `src-tauri/src/commands/infrastructure/gitlab.rs`
- `src-tauri/src/commands/infrastructure/context_generation.rs`
- `src-tauri/src/commands/infrastructure/context_audit.rs`
- `src-tauri/src/commands/infrastructure/context_map_export.rs`
- `src-tauri/src/commands/infrastructure/incremental_scan.rs`
- `src-tauri/src/commands/infrastructure/use_case_scan.rs`
- `src-tauri/src/commands/infrastructure/static_scan.rs`
- `src-tauri/src/commands/infrastructure/settings.rs`
- `src-tauri/src/commands/infrastructure/setup.rs`
- `src-tauri/src/commands/infrastructure/auth.rs`
- `src-tauri/src/commands/infrastructure/mod.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/commands/infrastructure/workflows.rs`
- `src-tauri/src/commands/infrastructure/task_executor.rs`
- `src-tauri/src/commands/infrastructure/bridge_manifest.rs`
- `src-tauri/src/commands/infrastructure/cli_stderr.rs`
- `src-tauri/src/commands/infrastructure/webbuild.rs`
- `src-tauri/src/commands/infrastructure/director.rs`
- `src-tauri/src/commands/infrastructure/autopilot.rs`
- `src-tauri/src/commands/infrastructure/byom.rs`
- `src-tauri/src/commands/infrastructure/twin.rs`
- `src-tauri/src/commands/infrastructure/kpi_scan.rs`
- `src-tauri/src/commands/infrastructure/kpi_compose.rs`
- `src-tauri/src/commands/infrastructure/kpi_sim.rs`
- `src-tauri/src/commands/live_roadmap.rs`
- `src-tauri/src/commands/infrastructure/dev_tools.rs`
- `src-tauri/src/commands/infrastructure/dev_tools_http.rs`
- `src-tauri/src/commands/infrastructure/dev_workspaces.rs`

**Entry points:** src-tauri/src/commands/infrastructure/standards_scan.rs, src-tauri/src/commands/infrastructure/context_generation.rs, src-tauri/src/commands/infrastructure/settings.rs

**Keywords:** standards, lint, doc-rot, divergence, harvest, git, gitlab, governance, context-map, scan, coverage, static-analysis

**API surface:** run_standards_scan, detect_doc_rot, harvest_workspace, verify_workspace, create_git_checkpoint

**Tech stack:** Tauri 2, Rust, git, GitLab API

---

## Overview Observability

> **Group type:** feature
> **Color:** blue

### agent-health

Per-persona health monitoring tab: runs a health check (useHealthCheck) that evaluates assertions and surfaces issues as HealthIssueCards, shows an overall health score, a digest panel with prefetching and scheduled digest refreshes, a watch toggle, and a one-click apply-fix action. gradeColors and statusConfig centralise severity presentation.

**Files:**
- `src/features/agents/sub_health/HealthCheckPanel.tsx`
- `src/features/agents/sub_health/HealthDigestPanel.tsx`
- `src/features/agents/sub_health/HealthIssueCard.tsx`
- `src/features/agents/sub_health/HealthScoreDisplay.tsx`
- `src/features/agents/sub_health/HealthWatchToggle.tsx`
- `src/features/agents/sub_health/gradeColors.ts`
- `src/features/agents/sub_health/statusConfig.ts`
- `src/features/agents/sub_health/types.ts`
- `src/features/agents/sub_health/useApplyHealthFix.ts`
- `src/features/agents/sub_health/useHealthCheck.ts`
- `src/features/agents/sub_health/useHealthDigestPrefetch.ts`
- `src/features/agents/sub_health/useHealthDigestScheduler.ts`
- `src/features/agents/sub_health/index.ts`

**Entry points:** src/features/agents/sub_health/HealthCheckPanel.tsx, src/features/agents/sub_health/useHealthCheck.ts

**Keywords:** health, check, score, grade, digest, watch, fix, assertion, issue, monitor

**API surface:** run_health_check, get_health_digest, apply_health_fix

**Tech stack:** React 19, TypeScript, Zustand 5, Tauri 2

---

### api-overview

IPC wrappers for the cross-cutting Overview audit surfaces: audit incidents inbox (filterable cross-source incident log), manual and design review queues (human-in-the-loop review of persona outputs and build outputs), eval certification status (team streak and verdict distribution from doc/test/runs/), persona memories (categories, dispute claims), execution messages, overview events, and saved views (persisted filter/column presets). These form the human review and audit trail layer. [Consolidated 2026-08-04: absorbed overview-health-api, overview-intelligence-api, overview-metrics-api, dev-projects-kpi-api, events-automation-api, peer-network-api, twin-api]

**Files:**
- `src/api/overview/incidents.ts`
- `src/api/overview/reviews.ts`
- `src/api/overview/certification.ts`
- `src/api/overview/memories.ts`
- `src/api/overview/messages.ts`
- `src/api/overview/events.ts`
- `src/api/overview/savedViews.ts`
- `src/api/overview/health.ts`
- `src/api/overview/healthcheckApi.ts`
- `src/api/overview/healing.ts`
- `src/api/overview/intelligence/knowledge.ts`
- `src/api/overview/intelligence/smartSearch.ts`
- `src/api/overview/intelligence/teamSynthesis.ts`
- `src/api/overview/observability.ts`
- `src/api/overview/sla.ts`
- `src/api/llmSpend.ts`
- `src/api/devTools/devTools.ts`
- `src/api/devTools/kpis.ts`
- `src/api/devTools/milestones.ts`
- `src/api/devTools/useCases.ts`
- `src/api/devTools/autopilot.ts`
- `src/api/devTools/workspaces.ts`
- `src/api/events/sharedEvents.ts`
- `src/api/events/notificationSubscriptions.ts`
- `src/api/systemOps.ts`
- `src/api/recipes/recipes.ts`
- `src/api/network/discovery.ts`
- `src/api/network/identity.ts`
- `src/api/network/enclave.ts`
- `src/api/network/exposure.ts`
- `src/api/network/bundle.ts`
- `src/api/twin/twin.ts`

**Entry points:** src/api/overview/incidents.ts, src/api/overview/reviews.ts, src/api/overview/health.ts

**Keywords:** incidents, audit, review, certification, memory, saved view, design review, manual review, messages, events, dispute, health

**API surface:** Tauri commands: list_audit_incidents, list_design_reviews, fetch_cert_status, list_memory_categories, list_saved_views

**Tech stack:** Tauri 2, TypeScript, React 19

---

### commands-communication

Execution dashboard metrics, anomaly drilldown, heatmaps, healing issue tracking, prompt lab analytics, and digest generation. Aggregates execution data into time-series charts, reliability rollups, and provider usage stats for the main overview dashboard. [Consolidated 2026-08-04: absorbed event-bus, messaging]

**Files:**
- `src-tauri/src/commands/communication/observability/alerts.rs`
- `src-tauri/src/commands/communication/observability/digest.rs`
- `src-tauri/src/commands/communication/observability/metrics.rs`
- `src-tauri/src/commands/communication/observability/mod.rs`
- `src-tauri/src/commands/communication/observability/prompt_lab.rs`
- `src-tauri/src/commands/communication/events.rs`
- `src-tauri/src/commands/communication/shared_events.rs`
- `src-tauri/src/commands/communication/mod.rs`
- `src-tauri/src/commands/communication/notifications.rs`
- `src-tauri/src/commands/communication/sla.rs`
- `src-tauri/src/commands/communication/messages.rs`
- `src-tauri/src/commands/communication/mock_seed.rs`

**Entry points:** src-tauri/src/commands/communication/observability/metrics.rs, src-tauri/src/commands/communication/events.rs, src-tauri/src/commands/communication/messages.rs

**Keywords:** metrics, dashboard, anomaly, heatmap, digest, alert, reliability, spend, event, notification, sla, subscribe

**API surface:** get_execution_dashboard, get_metrics_chart, get_anomaly_drilldown, generate_digest, list_alerts

**Tech stack:** Tauri 2, Rust, SQLite, chrono

---

### commands-companion

Athena's integration surface — fleet session bridging (Athena monitors and comments on fleet runs), MCP tool bridge (Athena can call MCP tools), plugin dispatching, template suggestions, connector awareness, project tracking context, browser testing assistance, and background job dispatching. [Consolidated 2026-08-04: absorbed companion-approvals, companion-core, companion-intelligence, companion-voice, media-studio]

**Files:**
- `src-tauri/src/commands/companion/fleet_bridge.rs`
- `src-tauri/src/commands/companion/mcp_bridge.rs`
- `src-tauri/src/commands/companion/plugins.rs`
- `src-tauri/src/commands/companion/templates.rs`
- `src-tauri/src/commands/companion/connectors.rs`
- `src-tauri/src/commands/companion/project_tracking.rs`
- `src-tauri/src/commands/companion/browser_test.rs`
- `src-tauri/src/commands/companion/jobs.rs`
- `src-tauri/src/commands/companion/approvals/mod.rs`
- `src-tauri/src/commands/companion/approvals/approval_autopilot.rs`
- `src-tauri/src/commands/companion/approvals/approval_exec_core.rs`
- `src-tauri/src/commands/companion/approvals/approval_exec_dev.rs`
- `src-tauri/src/commands/companion/approvals/approval_exec_fleet.rs`
- `src-tauri/src/commands/companion/approvals/approval_lifecycle.rs`
- `src-tauri/src/commands/companion/chat.rs`
- `src-tauri/src/commands/companion/conversation.rs`
- `src-tauri/src/commands/companion/brain.rs`
- `src-tauri/src/commands/companion/mod.rs`
- `src-tauri/src/commands/companion/proactive.rs`
- `src-tauri/src/commands/companion/sensory.rs`
- `src-tauri/src/commands/companion/observability.rs`
- `src-tauri/src/commands/companion/feedback.rs`
- `src-tauri/src/commands/companion/backlog_triage.rs`
- `src-tauri/src/commands/companion/consolidate.rs`
- `src-tauri/src/commands/companion/decisions.rs`
- `src-tauri/src/commands/companion/voice.rs`
- `src-tauri/src/commands/companion/stt.rs`
- `src-tauri/src/commands/artist/ffmpeg.rs`
- `src-tauri/src/commands/artist/mod.rs`
- `src-tauri/src/commands/artist/persistence.rs`
- `src-tauri/src/commands/artist/schema_policy.rs`
- `src-tauri/src/commands/artist/transcribe.rs`
- `src-tauri/src/commands/artist/voiceover.rs`

**Entry points:** src-tauri/src/commands/companion/fleet_bridge.rs, src-tauri/src/commands/companion/approvals/mod.rs, src-tauri/src/commands/companion/chat.rs

**Keywords:** fleet, mcp, plugin, template, connector, project, browser, bridge, approval, human-review, autopilot, action

**API surface:** companion_fleet_status, companion_call_mcp_tool, companion_suggest_template, companion_track_project

**Tech stack:** Tauri 2, Rust, MCP, Claude CLI

---

### commands-fleet

Fleet session lifecycle and transcript intelligence — transcript reading (incremental JSONL delta parse, token rollups), screen-activity monitoring, stale-session reaping, naming (LLM-generated session titles), and wait/synchronisation primitives for orchestrated multi-session flows. [Consolidated 2026-08-04: absorbed fleet-core, fleet-headless, fleet-hooks]

**Files:**
- `src-tauri/src/commands/fleet/transcript.rs`
- `src-tauri/src/commands/fleet/transcript_read.rs`
- `src-tauri/src/commands/fleet/screen_activity.rs`
- `src-tauri/src/commands/fleet/stale.rs`
- `src-tauri/src/commands/fleet/wait.rs`
- `src-tauri/src/commands/fleet/naming.rs`
- `src-tauri/src/commands/fleet/run.rs`
- `src-tauri/src/commands/fleet/registry.rs`
- `src-tauri/src/commands/fleet/commands.rs`
- `src-tauri/src/commands/fleet/persist.rs`
- `src-tauri/src/commands/fleet/mod.rs`
- `src-tauri/src/commands/fleet/types.rs`
- `src-tauri/src/commands/fleet/headless.rs`
- `src-tauri/src/commands/fleet/pty.rs`
- `src-tauri/src/commands/fleet/debug_log.rs`
- `src-tauri/src/commands/fleet/external.rs`
- `src-tauri/src/commands/fleet/process_scan.rs`
- `src-tauri/src/commands/fleet/hooks.rs`
- `src-tauri/src/commands/fleet/hook_install.rs`
- `src-tauri/src/commands/fleet/keys.rs`
- `src-tauri/src/commands/fleet/bench.rs`

**Entry points:** src-tauri/src/commands/fleet/transcript_read.rs, src-tauri/src/commands/fleet/registry.rs, src-tauri/src/commands/fleet/headless.rs

**Keywords:** transcript, jsonl, screen, stale, naming, wait, tokens, fleet, session, registry, dispatch, run

**API surface:** read_fleet_transcript, get_fleet_screen_activity, reap_stale_sessions, name_fleet_session

**Tech stack:** Tauri 2, Rust, Tokio

---

### overview-activity-metrics

Aggregated execution activity dashboard: global execution list, per-persona LLM spend, error category breakdown, value rollup, and Athena usage. useExecutionMetrics and useLlmSpend pull from execution history to drive KPI cards and time-series charts. This is the primary 'what did my agents spend today?' surface.

**Files:**
- `src/features/overview/sub_activity/index.ts`
- `src/features/overview/sub_activity/components/AthenaUsageSection.tsx`
- `src/features/overview/sub_activity/components/ErrorCategorySection.tsx`
- `src/features/overview/sub_activity/components/ExecutionMetricsDashboard.tsx`
- `src/features/overview/sub_activity/components/ExecutionRow.tsx`
- `src/features/overview/sub_activity/components/GlobalExecutionList.tsx`
- `src/features/overview/sub_activity/components/LlmCallsTable.tsx`
- `src/features/overview/sub_activity/components/LlmSpendSection.tsx`
- `src/features/overview/sub_activity/components/MetricsCards.tsx`
- `src/features/overview/sub_activity/components/MetricsCharts.tsx`
- `src/features/overview/sub_activity/components/ValueRollupSection.tsx`
- `src/features/overview/sub_activity/libs/executionMetricsHelpers.ts`
- `src/features/overview/sub_activity/libs/useAthenaUsage.ts`
- `src/features/overview/sub_activity/libs/useExecutionMetrics.ts`
- `src/features/overview/sub_activity/libs/useLlmSpend.ts`

**Entry points:** src/features/overview/sub_activity/components/ExecutionMetricsDashboard.tsx, src/features/overview/sub_activity/libs/useExecutionMetrics.ts

**Keywords:** execution-metrics, LLM-spend, error-category, value-rollup, Athena-usage, global-execution-list, activity, KPI

**API surface:** getExecutionMetrics, getLlmSpend, getAthenaUsage

**Tech stack:** React 19, TypeScript, Recharts, Zustand 5

---

### overview-components

The top-level Overview routing shell and dashboard home. OverviewPage lazy-loads each subtab on demand and mounts OverviewFilterContext for shared filter state. DashboardWithSubtabs hosts the home/analytics subtabs; widgets (DashboardChartCard, TopPerformersWidget, TrafficErrorsChart) are reusable dashboard card primitives. [Consolidated 2026-08-04: absorbed overview-system-health-panel, overview-cron-agents]

**Files:**
- `src/features/overview/components/dashboard/DashboardEmptyState.tsx`
- `src/features/overview/components/dashboard/DashboardHome.tsx`
- `src/features/overview/components/dashboard/DashboardWithSubtabs.tsx`
- `src/features/overview/components/dashboard/ExecutionsWithSubtabs.tsx`
- `src/features/overview/components/dashboard/HomeCustomizePopover.tsx`
- `src/features/overview/components/dashboard/OverviewFilterContext.tsx`
- `src/features/overview/components/dashboard/OverviewPage.tsx`
- `src/features/overview/components/dashboard/widgets/AnalyticsInserts.tsx`
- `src/features/overview/components/dashboard/widgets/DashboardChartCard.tsx`
- `src/features/overview/components/dashboard/widgets/DashboardRangeSwitch.tsx`
- `src/features/overview/components/dashboard/widgets/DetailModal.tsx`
- `src/features/overview/components/dashboard/widgets/MetricHelpPopover.tsx`
- `src/features/overview/components/dashboard/widgets/TopPerformersWidget.tsx`
- `src/features/overview/components/dashboard/widgets/TrafficErrorsChart.tsx`
- `src/features/overview/components/health/ConfigurationPopup.tsx`
- `src/features/overview/components/health/CrashLogsSection.tsx`
- `src/features/overview/components/health/FooterActions.tsx`
- `src/features/overview/components/health/healthPanelConstants.ts`
- `src/features/overview/components/health/InstallButton.tsx`
- `src/features/overview/components/health/LogDiskUsageSection.tsx`
- `src/features/overview/components/health/popupFieldConfigs.tsx`
- `src/features/overview/components/health/SectionCard.tsx`
- `src/features/overview/components/health/StatusIndicators.tsx`
- `src/features/overview/components/health/SystemHealthPanel.tsx`
- `src/features/overview/components/health/useHealthChecks.ts`
- `src/features/overview/sub_cron_agents/index.ts`
- `src/features/overview/sub_cron_agents/components/CronAgentCard.tsx`
- `src/features/overview/sub_cron_agents/components/CronAgentsPage.tsx`
- `src/features/overview/sub_cron_agents/libs/cronHelpers.ts`

**Entry points:** src/features/overview/components/dashboard/OverviewPage.tsx, src/features/overview/components/dashboard/DashboardWithSubtabs.tsx, src/features/overview/components/health/SystemHealthPanel.tsx

**Keywords:** overview-page, dashboard-shell, subtab-routing, filter-context, lazy-load, dashboard-widget, customize-popover, traffic-errors, system-health, crash-logs, disk-usage, configuration

**Tech stack:** React 19, TypeScript, Framer Motion, Zustand 5

---

### overview-empty-states

Prototype empty-state system for Overview tabs: IllustrationEmptyState renders a static illustration with CTA; MotionEmptyState wraps it in a Framer Motion entrance animation; motifs (ActivityMotif, KnowledgeMotif, MemoriesMotif) are SVG glyphs for themed empty states. Includes light/dark illustration asset pairs for approval, leaderboard, and messages tabs.

**Files:**
- `src/features/overview/shared/emptyStatePrototype/index.ts`
- `src/features/overview/shared/emptyStatePrototype/IllustrationEmptyState.tsx`
- `src/features/overview/shared/emptyStatePrototype/MotionEmptyState.tsx`
- `src/features/overview/shared/emptyStatePrototype/parts.tsx`
- `src/features/overview/shared/emptyStatePrototype/types.ts`
- `src/features/overview/shared/emptyStatePrototype/illustrations/index.ts`
- `src/features/overview/shared/emptyStatePrototype/motifs/index.ts`
- `src/features/overview/shared/emptyStatePrototype/motifs/ActivityMotif.tsx`
- `src/features/overview/shared/emptyStatePrototype/motifs/KnowledgeMotif.tsx`
- `src/features/overview/shared/emptyStatePrototype/motifs/MemoriesMotif.tsx`

**Entry points:** src/features/overview/shared/emptyStatePrototype/IllustrationEmptyState.tsx, src/features/overview/shared/emptyStatePrototype/MotionEmptyState.tsx

**Keywords:** empty-state, illustration, motion-empty-state, SVG-motif, dark-mode, light-dark-assets, activity-motif, knowledge-motif

**Tech stack:** React 19, TypeScript, Framer Motion

---

### overview-health

The Vitals Ledger (renamed from Heartbeats) displays per-execution heartbeat rows with row-level detail, healing effectiveness, and insight panels for alerts, burn rate, and cascade failures. VitalsLedger is the main table; InsightBand surfaces contextual recommendations based on detected patterns. [Consolidated 2026-08-04: absorbed overview-health-dashboard, overview-event-log, overview-sla]

**Files:**
- `src/features/overview/sub_health/components/heartbeats/HeartbeatsView.tsx`
- `src/features/overview/sub_health/components/heartbeats/VitalsLedger.tsx`
- `src/features/overview/sub_health/components/heartbeats/HealingEffectivenessPanel.tsx`
- `src/features/overview/sub_health/components/heartbeats/RowDetail.tsx`
- `src/features/overview/sub_health/components/heartbeats/SuccessSourceBadge.tsx`
- `src/features/overview/sub_health/components/heartbeats/primitives.tsx`
- `src/features/overview/sub_health/components/heartbeats/model.ts`
- `src/features/overview/sub_health/components/heartbeats/index.ts`
- `src/features/overview/sub_health/components/heartbeats/insights/AlertsPanel.tsx`
- `src/features/overview/sub_health/components/heartbeats/insights/BurnPanel.tsx`
- `src/features/overview/sub_health/components/heartbeats/insights/CascadePanel.tsx`
- `src/features/overview/sub_health/components/heartbeats/insights/data.ts`
- `src/features/overview/sub_health/components/heartbeats/insights/index.ts`
- `src/features/overview/sub_health/components/heartbeats/insights/InsightBand.tsx`
- `src/features/overview/sub_health/components/heartbeats/insights/InsightPanel.tsx`
- `src/features/overview/sub_health/components/HeartbeatIndicator.tsx`
- `src/features/overview/sub_health/components/PersonaHealthDashboard.tsx`
- `src/features/overview/sub_health/components/StatusPageView.tsx`
- `src/features/overview/sub_health/libs/compositeHealthScore.ts`
- `src/features/overview/sub_health/libs/compositeHealthScore.test.ts`
- `src/features/overview/sub_health/libs/useStatusPageData.ts`
- `src/features/overview/sub_health/libs/useStatusPageData.test.ts`
- `src/features/overview/sub_events/index.ts`
- `src/features/overview/sub_events/EventDetailModal.tsx`
- `src/features/overview/sub_events/HighlightedJson.tsx`
- `src/features/overview/sub_events/components/EventDetailContent.tsx`
- `src/features/overview/sub_events/components/EventLogList.tsx`
- `src/features/overview/sub_events/libs/eventTypeLabel.ts`
- `src/features/overview/sub_events/libs/useEventLog.ts`
- `src/features/overview/sub_sla/index.ts`
- `src/features/overview/sub_sla/components/SLACard.tsx`
- `src/features/overview/sub_sla/components/SLADashboard.tsx`
- `src/features/overview/sub_sla/libs/slaHelpers.ts`

**Entry points:** src/features/overview/sub_health/components/heartbeats/VitalsLedger.tsx, src/features/overview/sub_health/components/heartbeats/HeartbeatsView.tsx, src/features/overview/sub_health/components/PersonaHealthDashboard.tsx

**Keywords:** vitals-ledger, heartbeats, burn-rate, cascade, healing-effectiveness, InsightBand, row-detail, SuccessSource, health-score, composite-score, status-page, heartbeat

**API surface:** listHeartbeats, getHealingEffectivenessStats

**Tech stack:** React 19, TypeScript

---

### overview-incidents

The incidents inbox where operators triage system-level failures grouped by agent. Provides filtering, severity classification using incidentTaxonomy, column configuration, and a KPI header showing open/critical counts. Groups incidents by IncidentAgentGroup for a per-persona view of failure patterns. [Consolidated 2026-08-04: absorbed overview-incident-detail]

**Files:**
- `src/features/overview/sub_incidents/index.ts`
- `src/features/overview/sub_incidents/components/IncidentAgentGroup.tsx`
- `src/features/overview/sub_incidents/components/IncidentRow.tsx`
- `src/features/overview/sub_incidents/components/IncidentsFilterBar.tsx`
- `src/features/overview/sub_incidents/components/IncidentsInbox.tsx`
- `src/features/overview/sub_incidents/components/IncidentsInboxKpiHeader.tsx`
- `src/features/overview/sub_incidents/components/IncidentTableHeader.tsx`
- `src/features/overview/sub_incidents/libs/groupIncidents.ts`
- `src/features/overview/sub_incidents/libs/incidentColumns.ts`
- `src/features/overview/sub_incidents/libs/incidentFilterDefaults.ts`
- `src/features/overview/sub_incidents/libs/incidentTaxonomy.ts`
- `src/features/overview/sub_incidents/components/IncidentDetailBreakdown.tsx`
- `src/features/overview/sub_incidents/components/IncidentDetailModal.tsx`
- `src/features/overview/sub_incidents/libs/incidentDeepLink.ts`
- `src/features/overview/sub_incidents/libs/incidentDetail.ts`
- `src/features/overview/sub_incidents/libs/useIncidentActions.ts`
- `src/features/overview/sub_incidents/libs/useIncidentsData.ts`

**Entry points:** src/features/overview/sub_incidents/components/IncidentsInbox.tsx, src/features/overview/sub_incidents/libs/incidentTaxonomy.ts, src/features/overview/sub_incidents/components/IncidentDetailModal.tsx

**Keywords:** incidents, inbox, severity, triage, incident-filter, agent-group, KPI-header, failure-patterns, incident-detail, deep-link, resolution, escalate

**API surface:** listIncidents(IncidentFilterInput)

**Tech stack:** React 19, TypeScript

---

### overview-manual-review

The manual review inbox where operators see and act on items that require human decision: flagged executions, knowledge approvals, and pending actions. ManualReviewList is the entry point; useManualReviewQueue drives pagination and filter state; reviewHelpers normalises raw queue items into display shape. [Consolidated 2026-08-04: absorbed overview-review-backlog, overview-review-focus, overview-execution-analytics]

**Files:**
- `src/features/overview/sub_manual-review/index.ts`
- `src/features/overview/sub_manual-review/components/BulkActionBar.tsx`
- `src/features/overview/sub_manual-review/components/DecisionModeTabs.tsx`
- `src/features/overview/sub_manual-review/components/KnowledgeApprovalsPanel.tsx`
- `src/features/overview/sub_manual-review/components/ManualReviewList.tsx`
- `src/features/overview/sub_manual-review/components/ReviewDetailPanel.tsx`
- `src/features/overview/sub_manual-review/components/ReviewFilterTrailing.tsx`
- `src/features/overview/sub_manual-review/components/ReviewInboxPanel.tsx`
- `src/features/overview/sub_manual-review/components/ReviewListItem.tsx`
- `src/features/overview/sub_manual-review/hooks/useManualReviewQueue.ts`
- `src/features/overview/sub_manual-review/libs/reviewHelpers.ts`
- `src/features/overview/sub_manual-review/libs/__tests__/reviewHelpers.test.ts`
- `src/features/overview/sub_manual-review/components/backlog/AthenaVerdictCard.tsx`
- `src/features/overview/sub_manual-review/components/backlog/BacklogDetailLedger.tsx`
- `src/features/overview/sub_manual-review/components/backlog/BacklogDetailModal.tsx`
- `src/features/overview/sub_manual-review/components/backlog/BacklogFocusDeck.tsx`
- `src/features/overview/sub_manual-review/components/backlog/backlogLabels.ts`
- `src/features/overview/sub_manual-review/components/backlog/backlogModel.ts`
- `src/features/overview/sub_manual-review/components/backlog/BacklogPanel.tsx`
- `src/features/overview/sub_manual-review/components/backlog/BacklogTable.tsx`
- `src/features/overview/sub_manual-review/components/backlog/SwipeCard.tsx`
- `src/features/overview/sub_manual-review/components/backlog/useBacklogQueue.ts`
- `src/features/overview/sub_manual-review/components/backlog/__tests__/backlogModel.test.ts`
- `src/features/overview/sub_manual-review/components/ActionZone.tsx`
- `src/features/overview/sub_manual-review/components/AutoResolvedBadge.tsx`
- `src/features/overview/sub_manual-review/components/FocusedDecisionCard.tsx`
- `src/features/overview/sub_manual-review/components/ReviewFocusFlow.tsx`
- `src/features/overview/sub_manual-review/components/reviewFocusHelpers.tsx`
- `src/features/overview/sub_analytics/components/ExecutionHeatmap.tsx`
- `src/features/overview/sub_analytics/components/RotationOverviewPanel.tsx`
- `src/features/overview/sub_analytics/libs/analyticsHelpers.ts`

**Entry points:** src/features/overview/sub_manual-review/components/ManualReviewList.tsx, src/features/overview/sub_manual-review/hooks/useManualReviewQueue.ts, src/features/overview/sub_manual-review/components/backlog/BacklogPanel.tsx

**Keywords:** manual-review, review-queue, bulk-action, knowledge-approval, human-in-the-loop, review-filter, decision-mode, backlog, swipe-card, bulk-triage, Athena-verdict, backlog-table

**API surface:** listReviewQueue, approveReviewItem, rejectReviewItem

**Tech stack:** React 19, TypeScript, Vitest

---

### overview-memories

Write-side memory management: create new memories, review and resolve conflicts between competing memory claims, and inspect claims per memory. memoryConflicts computes pairwise conflicts; conflictHelpers provides merge/reject resolution actions; memoryVisualTokens maps memory categories to colour tokens. [Consolidated 2026-08-04: absorbed overview-memories-browser]

**Files:**
- `src/features/overview/sub_memories/components/ConflictCard.tsx`
- `src/features/overview/sub_memories/components/CreateMemoryForm.tsx`
- `src/features/overview/sub_memories/components/MemoryActionCard.tsx`
- `src/features/overview/sub_memories/components/MemoryClaimsSection.tsx`
- `src/features/overview/sub_memories/components/MemoryConflictReview.tsx`
- `src/features/overview/sub_memories/components/ReviewResultsModal.tsx`
- `src/features/overview/sub_memories/libs/conflictHelpers.tsx`
- `src/features/overview/sub_memories/libs/memoryActions.ts`
- `src/features/overview/sub_memories/libs/memoryConflicts.ts`
- `src/features/overview/sub_memories/libs/memoryVisualTokens.ts`
- `src/features/overview/sub_memories/index.ts`
- `src/features/overview/sub_memories/components/MemoriesPage.tsx`
- `src/features/overview/sub_memories/components/MemoriesPageDense.tsx`
- `src/features/overview/sub_memories/components/MemoriesPageGraph.tsx`
- `src/features/overview/sub_memories/components/MemoryCard.tsx`
- `src/features/overview/sub_memories/components/MemoryDetailModal.tsx`
- `src/features/overview/sub_memories/components/MemoryEmptyState.tsx`
- `src/features/overview/sub_memories/components/MemoryFilterBar.tsx`
- `src/features/overview/sub_memories/components/MemoryHeaderActions.tsx`
- `src/features/overview/sub_memories/components/MemoryTableHeader.tsx`

**Entry points:** src/features/overview/sub_memories/components/MemoryConflictReview.tsx, src/features/overview/sub_memories/libs/memoryConflicts.ts, src/features/overview/sub_memories/components/MemoriesPage.tsx

**Keywords:** memory-conflict, create-memory, conflict-resolution, memory-claims, merge, reject, memory-actions, visual-tokens, memories, memory-browser, memory-card, graph-view

**API surface:** createMemory, resolveMemoryConflict, listMemoryClaims

**Tech stack:** React 19, TypeScript

---

### overview-messages

Inbox of messages sent by personas to the operator, with channel delivery info, priority classification, and a detail modal. PriorityChip and ChannelDeliveryPill are inline display primitives; feedbackInstruction provides templated feedback copy surfaced in message threads.

**Files:**
- `src/features/overview/sub_messages/index.ts`
- `src/features/overview/sub_messages/components/ChannelDeliveryPill.tsx`
- `src/features/overview/sub_messages/components/MessageDetailModal.tsx`
- `src/features/overview/sub_messages/components/MessageList.tsx`
- `src/features/overview/sub_messages/components/PriorityChip.tsx`
- `src/features/overview/sub_messages/libs/chatSeed.ts`
- `src/features/overview/sub_messages/libs/feedbackInstruction.ts`
- `src/features/overview/sub_messages/libs/messageHelpers.ts`

**Entry points:** src/features/overview/sub_messages/components/MessageList.tsx

**Keywords:** messages, inbox, channel-delivery, priority, persona-message, feedback-instruction, message-detail

**API surface:** listMessages, getMessage, markMessageRead

**Tech stack:** React 19, TypeScript

---

### overview-observability

Alert rules management, alert history, real-time anomaly drilldown, and Athena health tracking. The global alert evaluator runs as a background hook that continuously evaluates rules against live metrics and emits toast notifications on violations. AnomalyDrilldownPanel lets operators drill into detected statistical outliers. [Consolidated 2026-08-04: absorbed overview-healing-monitor, overview-observability-traces, overview-execution-detail]

**Files:**
- `src/features/overview/sub_observability/components/AlertHistoryPanel.tsx`
- `src/features/overview/sub_observability/components/AlertRulesPanel.tsx`
- `src/features/overview/sub_observability/components/AlertToastContainer.tsx`
- `src/features/overview/sub_observability/components/AnomalyDrilldownPanel.tsx`
- `src/features/overview/sub_observability/components/AthenaHealthPanel.tsx`
- `src/features/overview/sub_observability/components/IssuesList.tsx`
- `src/features/overview/sub_observability/libs/useAnomalyDrilldown.ts`
- `src/features/overview/sub_observability/libs/useAthenaHealth.ts`
- `src/features/overview/sub_observability/libs/useGlobalAlertEvaluator.ts`
- `src/features/overview/sub_observability/components/AiHealingStreamOverlay.tsx`
- `src/features/overview/sub_observability/components/HealingIssueModal.tsx`
- `src/features/overview/sub_observability/components/HealingIssuesPanel.tsx`
- `src/features/overview/sub_observability/components/HealingIssueStatusBadge.tsx`
- `src/features/overview/sub_observability/components/HealingIssueSummary.tsx`
- `src/features/overview/sub_observability/components/HealingTimeline.tsx`
- `src/features/overview/sub_observability/libs/useHealingPanelState.ts`
- `src/features/overview/components/feedback/HealingToast.tsx`
- `src/features/overview/sub_observability/index.ts`
- `src/features/overview/sub_observability/components/ObservabilityDashboard.tsx`
- `src/features/overview/sub_observability/components/SystemTraceViewer.tsx`
- `src/features/overview/sub_observability/components/MetricsCharts.tsx`
- `src/features/overview/sub_observability/components/IpcPerformancePanel.tsx`
- `src/features/overview/sub_observability/libs/chartAnnotations.ts`
- `src/features/overview/sub_observability/libs/useAnnotationData.ts`
- `src/features/overview/sub_observability/libs/useObservabilityData.ts`
- `src/features/overview/ExecutionDetailModal/index.ts`
- `src/features/overview/ExecutionDetailModal/ExecutionDetailContent.tsx`
- `src/features/overview/ExecutionDetailModal/ExecutionDetailModal.tsx`
- `src/features/overview/ExecutionDetailModal/outputParser.ts`
- `src/features/overview/ExecutionDetailModal/OutputSections.tsx`
- `src/features/overview/ExecutionDetailModal/provenance.ts`
- `src/features/overview/ExecutionDetailModal/__tests__/provenance.test.ts`

**Entry points:** src/features/overview/sub_observability/components/AlertRulesPanel.tsx, src/features/overview/sub_observability/libs/useGlobalAlertEvaluator.ts, src/features/overview/sub_observability/components/HealingIssuesPanel.tsx

**Keywords:** alert-rules, anomaly-detection, alert-history, Athena-health, global-evaluator, drilldown, statistical-outlier, alert-toast, healing, self-healing, HealingTimelineEvent, chain-id

**API surface:** listAlertRules, getAthenaHealthStatus, getAnomalyData

**Tech stack:** React 19, TypeScript

---

### overview-patterns

The review surface for a single knowledge practice. The modal wrapper owns the state machine (decide action, keyboard queue navigation) while PracticeDetailLedger owns the ledger-style presentation (prose left, facts-and-actions margin rail). Supports queue walking with ←/→ keyboard shortcuts that advance to the next item after each decision. [Consolidated 2026-08-04: absorbed create-practice-modal, extraction-menu, harvest-dispatch-prompt, harvest-wave-logic, knowledge-library-host, knowledge-tree-table, library-view-model, patterns-panel-host, practice-rollout-modal, workspace-pulse-dashboard]

**Files:**
- `src/features/overview/sub_patterns/PracticeDetailModal.tsx`
- `src/features/overview/sub_patterns/PracticeDetailLedger.tsx`
- `src/features/overview/sub_patterns/practiceViewTypes.ts`
- `src/features/overview/sub_patterns/practiceAreaTheme.ts`
- `src/features/overview/sub_patterns/CreatePracticeModal.tsx`
- `src/features/overview/sub_patterns/ExtractionMenu.tsx`
- `src/features/overview/sub_patterns/useHarvestAutoIngest.ts`
- `src/features/overview/sub_patterns/practiceHarvestPrompt.ts`
- `src/features/overview/sub_patterns/harvestWave.ts`
- `src/features/overview/sub_patterns/__tests__/harvestWave.test.ts`
- `src/features/overview/sub_patterns/KnowledgeLibrary.tsx`
- `src/features/overview/sub_patterns/KnowledgeTree.tsx`
- `src/features/overview/sub_patterns/libraryModel.ts`
- `src/features/overview/sub_patterns/__tests__/libraryModel.test.ts`
- `src/features/overview/sub_patterns/PatternsPanel.tsx`
- `src/features/overview/sub_patterns/PracticeRolloutModal.tsx`
- `src/features/overview/sub_patterns/adoptPracticePrompt.ts`
- `src/features/overview/sub_patterns/WorkspacePulse.tsx`
- `src/features/overview/sub_patterns/libraryPulse.ts`
- `src/features/overview/sub_patterns/__tests__/libraryPulse.test.ts`

**Entry points:** src/features/overview/sub_patterns/PracticeDetailModal.tsx, src/features/overview/sub_patterns/CreatePracticeModal.tsx, src/features/overview/sub_patterns/ExtractionMenu.tsx

**Keywords:** practice detail, review, govern, adopt, reject, deprecate, keyboard navigation, ledger layout, area theme, create practice, manual authoring, proposed

**API surface:** decideWorkspaceKnowledge

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### overview-shared-libs

Shared utilities and display primitives used across all Overview sub-modules. dashboardGrid defines responsive grid layout constants; metricIdentity provides stable metric IDs for chart key stability; fleetOptimizer heuristics power the mission control fleet card; computeTrends and formatRelativeShort are display helpers. KpiTile and TrendIndicator are micro-components used in KPI header rows.

**Files:**
- `src/features/overview/libs/animations.ts`
- `src/features/overview/libs/computeTrends.ts`
- `src/features/overview/libs/dashboardGrid.ts`
- `src/features/overview/libs/fleetOptimizer.ts`
- `src/features/overview/libs/fleetOptimizer.test.ts`
- `src/features/overview/libs/formatRelativeShort.ts`
- `src/features/overview/libs/metricIdentity.ts`
- `src/features/overview/components/shared/KpiTile.tsx`
- `src/features/overview/components/shared/TrendIndicator.tsx`
- `src/features/overview/shared/eventVisuals.ts`

**Entry points:** src/features/overview/libs/dashboardGrid.ts, src/features/overview/libs/fleetOptimizer.ts

**Keywords:** dashboard-grid, fleet-optimizer, metric-identity, compute-trends, KPI-tile, trend-indicator, animations, event-visuals

**Tech stack:** React 19, TypeScript, Framer Motion, Vitest

---

### overview-usage-charts

Time-series token and tool usage charts with period comparison and pivot by tool. LazyChart defers Recharts bundle loading; MetricChart is the reusable chart primitive; pivotToolUsage aggregates raw usage rows into per-tool series; periodComparison computes period-over-period deltas.

**Files:**
- `src/features/overview/sub_usage/index.ts`
- `src/features/overview/sub_usage/components/ChartErrorBoundary.tsx`
- `src/features/overview/sub_usage/components/ChartGradientDefs.tsx`
- `src/features/overview/sub_usage/components/ChartTooltip.tsx`
- `src/features/overview/sub_usage/components/DayRangePicker.tsx`
- `src/features/overview/sub_usage/components/LazyChart.tsx`
- `src/features/overview/sub_usage/components/MetricChart.tsx`
- `src/features/overview/sub_usage/components/PersonaSelect.tsx`
- `src/features/overview/sub_usage/components/ToolPerformancePanel.tsx`
- `src/features/overview/sub_usage/libs/chartConstants.ts`
- `src/features/overview/sub_usage/libs/periodComparison.ts`
- `src/features/overview/sub_usage/libs/pivotToolUsage.ts`

**Entry points:** src/features/overview/sub_usage/components/MetricChart.tsx, src/features/overview/sub_usage/libs/pivotToolUsage.ts

**Keywords:** usage-charts, token-usage, tool-usage, period-comparison, LazyChart, chart-gradient, day-range-picker, pivot

**API surface:** getUsageMetrics(dateRange, personaId)

**Tech stack:** React 19, TypeScript, Recharts

---

### stores-slices-overview

Slices for real-time event streams, system messages, alert management, and process activity tracking. The event slice subscribes to Tauri backend events; alertSlice manages triggered alert conditions; processActivity tracks concurrently running background operations. [Consolidated 2026-08-04: absorbed overview-dashboard-state, overview-health-state, network-state, pipeline-recipes-state, pipeline-team-state, pipeline-triggers-state]

**Files:**
- `src/stores/slices/overview/eventSlice.ts`
- `src/stores/slices/overview/eventSlice.test.ts`
- `src/stores/slices/overview/messageSlice.ts`
- `src/stores/slices/overview/alertSlice.ts`
- `src/stores/selectors/activeAlertCount.ts`
- `src/stores/slices/processActivitySlice.ts`
- `src/stores/slices/processActivitySlice.test.ts`
- `src/stores/slices/overview/overviewSlice.ts`
- `src/stores/slices/overview/homeSpineSlice.ts`
- `src/stores/slices/overview/homeSpineWindows.ts`
- `src/stores/slices/overview/homeSpineWindows.test.ts`
- `src/stores/slices/overview/memorySlice.ts`
- `src/stores/slices/overview/cascadeStrength.test.ts`
- `src/stores/slices/overview/healingSlice.ts`
- `src/stores/slices/overview/personaHealthSlice.ts`
- `src/stores/slices/overview/certificationSlice.ts`
- `src/stores/slices/overview/cronAgentsSlice.ts`
- `src/stores/slices/overview/__tests__/personaHealthSlice.bundle.test.ts`
- `src/stores/slices/network/networkSlice.ts`
- `src/stores/slices/network/networkSlice.test.ts`
- `src/stores/slices/pipeline/recipeSlice.ts`
- `src/stores/slices/pipeline/teamSlice.ts`
- `src/stores/slices/pipeline/assignmentSlice.ts`
- `src/stores/slices/pipeline/channelSlice.ts`
- `src/stores/slices/pipeline/__tests__/channelSlice.test.ts`
- `src/stores/slices/pipeline/triggerSlice.ts`

**Entry points:** src/stores/slices/overview/eventSlice.ts, src/stores/slices/overview/alertSlice.ts, src/stores/slices/overview/overviewSlice.ts

**Keywords:** event, message, alert, process, activity, real-time, stream, notification, dashboard, overview, homeSpine, windows

**Tech stack:** Zustand 5, TypeScript, Tauri events

---

## Agent Quality & Governance

> **Group type:** feature
> **Color:** violet

### db-repos-lab

Repositories for persona version management, genome tracking (evolving prompt DNA), user ratings, and evolution history. Enables the Lab feature where users can track how a persona's prompt has evolved over time, rate versions, and roll back to previous configurations. [Consolidated 2026-08-04: absorbed lab-ab-testing-repo, lab-eval-repo]

**Files:**
- `src-tauri/db/src/repos/lab/versions.rs`
- `src-tauri/db/src/repos/lab/genome.rs`
- `src-tauri/db/src/repos/lab/ratings.rs`
- `src-tauri/db/src/repos/lab/evolution.rs`
- `src-tauri/db/src/repos/lab/ab.rs`
- `src-tauri/db/src/repos/lab/matrix.rs`
- `src-tauri/db/src/repos/lab/mod.rs`
- `src-tauri/db/src/repos/lab/eval.rs`
- `src-tauri/db/src/repos/lab/consensus.rs`
- `src-tauri/db/src/repos/lab/arena.rs`
- `src-tauri/db/src/repos/lab/events.rs`

**Entry points:** src-tauri/db/src/repos/lab/versions.rs, src-tauri/db/src/repos/lab/ab.rs, src-tauri/db/src/repos/lab/eval.rs

**Keywords:** versions, genome, evolution, ratings, history, rollback, prompt-DNA, lab, A/B testing, experiments, matrix, variants

**Tech stack:** Rust, rusqlite

---

### lab-arena

Lab Arena for head-to-head persona battles: an arena panel that runs two personas against the same prompt (ArenaPanelColosseum) and shows side-by-side results with a winner decision. ArenaHistory tracks past matches. Also includes the Lab use-case execution panel for running labelled use-case scenarios in mock or real mode.

**Files:**
- `src/features/agents/sub_lab/components/arena/ArenaPanel.tsx`
- `src/features/agents/sub_lab/components/arena/ArenaPanelColosseum.tsx`
- `src/features/agents/sub_lab/components/arena/ArenaResultsView.tsx`
- `src/features/agents/sub_lab/components/arena/ArenaHistory.tsx`
- `src/features/agents/sub_lab/use-cases/UseCasesList.tsx`
- `src/features/agents/sub_lab/use-cases/UseCaseRow.tsx`
- `src/features/agents/sub_lab/use-cases/UseCaseExecutionPanel.tsx`
- `src/features/agents/sub_lab/use-cases/UseCaseHistory.tsx`
- `src/features/agents/sub_lab/use-cases/MockModePanel.tsx`
- `src/features/agents/sub_lab/use-cases/StructuredField.tsx`
- `src/features/agents/sub_lab/use-cases/useUseCaseExecution.ts`

**Entry points:** src/features/agents/sub_lab/components/arena/ArenaPanel.tsx, src/features/agents/sub_lab/use-cases/UseCasesList.tsx

**Keywords:** arena, battle, a/b, colosseum, use-case, mock-mode, lab, scenario, compare

**API surface:** run_lab_eval, list_use_cases

**Tech stack:** React 19, TypeScript, Zustand 5

---

### lab-shared-primitives

Reusable Lab UI primitives used across arena, versions table, and use-case panels: result card, result modal, history table, progress strip, event stream, diff viewer, inline diff preview, quality badge, skeleton, stagger group, tab, and scenario detail panel. Also includes chart theme and utility functions shared within the Lab feature.

**Files:**
- `src/features/agents/sub_lab/components/shared/LabResultCard.tsx`
- `src/features/agents/sub_lab/components/shared/LabResultModal.tsx`
- `src/features/agents/sub_lab/components/shared/LabHistoryTable.tsx`
- `src/features/agents/sub_lab/components/shared/LabProgress.tsx`
- `src/features/agents/sub_lab/components/shared/LabEventStream.tsx`
- `src/features/agents/sub_lab/components/shared/LabEmptyState.tsx`
- `src/features/agents/sub_lab/components/shared/LabQualityBadge.tsx`
- `src/features/agents/sub_lab/components/shared/LabResultsSkeleton.tsx`
- `src/features/agents/sub_lab/components/shared/LabStaggerGroup.tsx`
- `src/features/agents/sub_lab/components/shared/LabTab.tsx`
- `src/features/agents/sub_lab/components/shared/ScenarioDetailPanel.tsx`
- `src/features/agents/sub_lab/components/shared/TimelineEntry.tsx`
- `src/features/agents/sub_lab/components/shared/UserRating.tsx`
- `src/features/agents/sub_lab/components/shared/VirtualizedTableBody.tsx`
- `src/features/agents/sub_lab/components/shared/DraftDiffViewer.tsx`
- `src/features/agents/sub_lab/components/shared/InlineDiffPreview.tsx`
- `src/features/agents/sub_lab/components/shared/ExportReportButton.tsx`
- `src/features/agents/sub_lab/components/shared/ImprovePromptButton.tsx`
- `src/features/agents/sub_lab/shared/DiffViewer.tsx`
- `src/features/agents/sub_lab/shared/chartTheme.ts`
- `src/features/agents/sub_lab/shared/labPrimitives.ts`
- `src/features/agents/sub_lab/shared/labUtils.ts`
- `src/features/agents/sub_lab/shared/index.ts`

**Entry points:** src/features/agents/sub_lab/shared/labPrimitives.ts

**Keywords:** lab, result, diff, quality, rating, skeleton, event-stream, chart, export, improve

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### lab-versions-eval

Version matrix and economics panel for the Lab tab: shows all persona versions in a table with per-version status, rating cell, row actions, and a post-activation reconcile dialog. LabEconomicsPanel aggregates cost and token metrics. Backed by evalAggregation, labAggregation, versionMatrixRows, and labFeedbackLoop libs.

**Files:**
- `src/features/agents/sub_lab/components/versions_table/LabVersionsTable.tsx`
- `src/features/agents/sub_lab/components/versions_table/LabEconomicsPanel.tsx`
- `src/features/agents/sub_lab/components/versions_table/PostActivationReconcileDialog.tsx`
- `src/features/agents/sub_lab/components/versions_table/VersionRatingCell.tsx`
- `src/features/agents/sub_lab/components/versions_table/VersionRowActions.tsx`
- `src/features/agents/sub_lab/components/versions_table/VersionStatusBadge.tsx`
- `src/features/agents/sub_lab/libs/evalAggregation.ts`
- `src/features/agents/sub_lab/libs/labAggregation.ts`
- `src/features/agents/sub_lab/libs/labFeedbackLoop.ts`
- `src/features/agents/sub_lab/libs/versionMatrixRows.ts`
- `src/features/agents/sub_lab/libs/reportGenerator.ts`
- `src/features/agents/sub_lab/libs/usePanelRunState.ts`
- `src/features/agents/sub_lab/index.ts`

**Entry points:** src/features/agents/sub_lab/components/versions_table/LabVersionsTable.tsx, src/features/agents/sub_lab/libs/evalAggregation.ts

**Keywords:** version, eval, aggregation, rating, economics, cost, feedback-loop, report, matrix

**Tech stack:** React 19, TypeScript, Zustand 5

---

### lib-harness

Defines the complete type system for the autonomous harness loop and exports the public library surface. Contains every interface (HarnessPlan, ModuleArea, ExecutorResult, VerificationReport, HarnessGuide, ScenarioDefinition, etc.) and the barrel re-exports that make the harness consumable as a module. This is the single source of truth for all data shapes flowing between orchestrator, executor, verifier, plan-builder, and guide-generator. [Consolidated 2026-08-04: absorbed harness-executor, harness-guide-generator, harness-orchestrator, harness-plan-builder, harness-scenario-runner, harness-verifier]

**Files:**
- `src/lib/harness/types.ts`
- `src/lib/harness/index.ts`
- `src/lib/harness/executor.ts`
- `src/lib/harness/guide-generator.ts`
- `src/lib/harness/orchestrator.ts`
- `src/lib/harness/plan-builder.ts`
- `src/lib/harness/scenario-parser.ts`
- `src/lib/harness/run-harness.ts`
- `src/lib/harness/verifier.ts`

**Entry points:** src/lib/harness/index.ts, src/lib/harness/executor.ts, src/lib/harness/guide-generator.ts

**Keywords:** harness, types, plan, area, feature-status, verification, guide, scenario, orchestrator, executor, claude-cli, spawn

**Tech stack:** TypeScript

---

### model-config

Model configuration tab allowing per-persona model selection, budget controls, prompt-cache controls, provider credential binding, and an A/B model comparison panel. useEffectiveConfig resolves inherited vs. overridden configuration from the persona and global defaults. Supports LiteLLM custom configs and Ollama local model presets.

**Files:**
- `src/features/agents/sub_model_config/components/ModelSelector.tsx`
- `src/features/agents/sub_model_config/components/BudgetControls.tsx`
- `src/features/agents/sub_model_config/components/PromptCacheControls.tsx`
- `src/features/agents/sub_model_config/components/ProviderCredentialField.tsx`
- `src/features/agents/sub_model_config/components/ConfigInheritanceBadge.tsx`
- `src/features/agents/sub_model_config/components/CustomModelConfigForm.tsx`
- `src/features/agents/sub_model_config/components/EffectiveConfigPanel.tsx`
- `src/features/agents/sub_model_config/components/LiteLLMConfigField.tsx`
- `src/features/agents/sub_model_config/components/OllamaApiKeyField.tsx`
- `src/features/agents/sub_model_config/components/SaveConfigButton.tsx`
- `src/features/agents/sub_model_config/components/compare/ModelABCompare.tsx`
- `src/features/agents/sub_model_config/components/compare/ModelDropdown.tsx`
- `src/features/agents/sub_model_config/components/compare/CompareMetrics.tsx`
- `src/features/agents/sub_model_config/components/compare/CompareOutputPreviews.tsx`
- `src/features/agents/sub_model_config/components/compare/CompareResultsTable.tsx`
- `src/features/agents/sub_model_config/hooks/useEffectiveConfig.ts`
- `src/features/agents/sub_model_config/libs/compareHelpers.ts`
- `src/features/agents/sub_model_config/libs/OllamaCloudPresets.ts`
- `src/features/agents/sub_model_config/index.ts`

**Entry points:** src/features/agents/sub_model_config/components/ModelSelector.tsx, src/features/agents/sub_model_config/hooks/useEffectiveConfig.ts

**Keywords:** model, config, budget, LiteLLM, Ollama, A/B, compare, cache, inheritance, credential

**API surface:** save_model_config, list_models, compare_models

**Tech stack:** React 19, TypeScript, Zustand 5, Tauri 2

---

### overview-certification

The Certification Command Center evaluates personas against standards using judge panels and eval runs. Surfaces certification status per team/persona, gate breakdowns, grounding tables, trajectory charts, and run history. useCertificationData drives deferred loading from the overviewStore certification slice.

**Files:**
- `src/features/overview/sub_certification/CertificationCommandCenter.tsx`
- `src/features/overview/sub_certification/useCertificationData.ts`
- `src/features/overview/sub_certification/components/CertOverview.tsx`
- `src/features/overview/sub_certification/components/CertPlaceholders.tsx`
- `src/features/overview/sub_certification/components/DimensionBars.tsx`
- `src/features/overview/sub_certification/components/GateBreakdown.tsx`
- `src/features/overview/sub_certification/components/GroundingTable.tsx`
- `src/features/overview/sub_certification/components/JudgePanel.tsx`
- `src/features/overview/sub_certification/components/RunDetailView.tsx`
- `src/features/overview/sub_certification/components/RunHistoryView.tsx`
- `src/features/overview/sub_certification/components/StandardsCard.tsx`
- `src/features/overview/sub_certification/components/TeamCertCard.tsx`
- `src/features/overview/sub_certification/components/TrajectoryChart.tsx`
- `src/features/overview/sub_certification/components/VerdictBadge.tsx`
- `src/features/overview/sub_certification/components/__tests__/VerdictBadge.test.tsx`

**Entry points:** src/features/overview/sub_certification/CertificationCommandCenter.tsx, src/features/overview/sub_certification/useCertificationData.ts

**Keywords:** certification, eval-runs, judge-panel, grounding, gate-breakdown, trajectory, cert-status, standards

**API surface:** refreshCertification, loadEvalRunDetail

**Tech stack:** React 19, TypeScript, Recharts, Vitest

---

### overview-director

The Director coaching tab UI: a per-persona coaching table, persona detail modals, attention triage bar, momentum summary, stale-sweep action, value-leak visualization, and scope management. Consumes useDirector and exposes the full Director command surface to the operator. [Consolidated 2026-08-04: absorbed overview-director-scoring, overview-knowledge, overview-mission-control]

**Files:**
- `src/features/overview/sub_director/index.ts`
- `src/features/overview/sub_director/DirectorCoachingTab.tsx`
- `src/features/overview/sub_director/DirectorSection.tsx`
- `src/features/overview/sub_director/components/AddToScopeModal.tsx`
- `src/features/overview/sub_director/components/AttentionTriageBar.tsx`
- `src/features/overview/sub_director/components/CategoryRollup.tsx`
- `src/features/overview/sub_director/components/MomentumSummary.tsx`
- `src/features/overview/sub_director/components/PersonaCoachingTable.tsx`
- `src/features/overview/sub_director/components/PersonaDetailModal.tsx`
- `src/features/overview/sub_director/components/ReviewFilteredAction.tsx`
- `src/features/overview/sub_director/components/StaleSweepButton.tsx`
- `src/features/overview/sub_director/components/ValueLeakBar.tsx`
- `src/features/overview/sub_director/attention.ts`
- `src/features/overview/sub_director/categoryMeta.ts`
- `src/features/overview/sub_director/directorScore.ts`
- `src/features/overview/sub_director/momentum.ts`
- `src/features/overview/sub_director/rosterFilter.ts`
- `src/features/overview/sub_director/ScoreSparkline.tsx`
- `src/features/overview/sub_director/useDirector.ts`
- `src/features/overview/sub_director/useSequentialReview.ts`
- `src/features/overview/sub_director/components/PeriodSelect.tsx`
- `src/features/overview/sub_director/components/ScoreDistribution.tsx`
- `src/features/overview/sub_knowledge/index.ts`
- `src/features/overview/sub_knowledge/components/AnnotateModal.tsx`
- `src/features/overview/sub_knowledge/components/KnowledgeGraphDashboard.tsx`
- `src/features/overview/sub_knowledge/components/KnowledgeRow.tsx`
- `src/features/overview/sub_knowledge/libs/knowledgeHelpers.ts`
- `src/features/overview/sub_knowledge/libs/KnowledgeTypeIcons.tsx`
- `src/features/overview/sub_missionControl/index.ts`
- `src/features/overview/sub_missionControl/DashboardHomeMissionControl.tsx`
- `src/features/overview/sub_missionControl/PaneHeader.tsx`
- `src/features/overview/sub_missionControl/cards/FleetOptimizationCard.tsx`
- `src/features/overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx`
- `src/features/overview/sub_missionControl/cards/VaultRecentChangesCard.tsx`

**Entry points:** src/features/overview/sub_director/DirectorCoachingTab.tsx, src/features/overview/sub_director/DirectorSection.tsx, src/features/overview/sub_director/useDirector.ts

**Keywords:** coaching, persona-roster, stale-sweep, value-leak, scope-management, triage, batch-review, DirectorVerdict, Director, portfolio-score, attention-triage, momentum

**API surface:** setPersonaStarred, getDirectorBrainEnabled, setDirectorBrainEnabled

**Tech stack:** React 19, TypeScript, Framer Motion

---

### overview-leaderboard

Ranks personas by composite performance score across multiple dimensions using a radar chart and matrix view. leaderboardScoring.ts computes per-dimension scores; leaderboardRanking.ts produces the final ordered list. Supports toggling between list and matrix layout views.

**Files:**
- `src/features/overview/sub_leaderboard/index.ts`
- `src/features/overview/sub_leaderboard/components/EmptyStates.tsx`
- `src/features/overview/sub_leaderboard/components/LeaderboardMatrixView.tsx`
- `src/features/overview/sub_leaderboard/components/LeaderboardPage.tsx`
- `src/features/overview/sub_leaderboard/components/leaderboardViewHelpers.ts`
- `src/features/overview/sub_leaderboard/components/leaderboardViewTypes.ts`
- `src/features/overview/sub_leaderboard/components/ScoreRadar.tsx`
- `src/features/overview/sub_leaderboard/libs/leaderboardRanking.ts`
- `src/features/overview/sub_leaderboard/libs/leaderboardScoring.ts`
- `src/features/overview/sub_leaderboard/libs/useLeaderboardData.ts`

**Entry points:** src/features/overview/sub_leaderboard/components/LeaderboardPage.tsx, src/features/overview/sub_leaderboard/libs/leaderboardScoring.ts

**Keywords:** leaderboard, ranking, radar-chart, matrix-view, composite-score, persona-performance, multi-dimension

**API surface:** getLeaderboardData

**Tech stack:** React 19, TypeScript, Recharts

---

## Factory & Projects

> **Group type:** feature
> **Color:** amber

### commands-design

n8n workflow transformation pipeline — converts Personas automation definitions into n8n JSON workflows via a streaming Claude CLI pass. Includes a prompt sanitiser, a streaming output parser, job-state machine, user-confirmation gate, and a CLI runner that drives the transformation end-to-end. Also manages n8n session persistence and rate-limit tracking. [Consolidated 2026-08-04: absorbed build-sessions, connector-design, persona-design-tools, template-library, team-communication, teams-core, agent-testing]

**Files:**
- `src-tauri/src/commands/design/n8n_sessions.rs`
- `src-tauri/src/commands/design/n8n_limits.rs`
- `src-tauri/src/commands/design/n8n_transform/mod.rs`
- `src-tauri/src/commands/design/n8n_transform/cli_runner.rs`
- `src-tauri/src/commands/design/n8n_transform/confirmation.rs`
- `src-tauri/src/commands/design/n8n_transform/job_state.rs`
- `src-tauri/src/commands/design/n8n_transform/prompt_sanitizer.rs`
- `src-tauri/src/commands/design/n8n_transform/prompts.rs`
- `src-tauri/src/commands/design/n8n_transform/streaming.rs`
- `src-tauri/src/commands/design/n8n_transform/types.rs`
- `src-tauri/src/commands/design/build_sessions.rs`
- `src-tauri/src/commands/design/build_simulate.rs`
- `src-tauri/src/commands/design/conversations.rs`
- `src-tauri/src/commands/design/reviews.rs`
- `src-tauri/src/commands/design/mod.rs`
- `src-tauri/src/commands/design/connector_explorer.rs`
- `src-tauri/src/commands/design/connector_readiness.rs`
- `src-tauri/src/commands/design/analysis.rs`
- `src-tauri/src/commands/design/platform_definitions.rs`
- `src-tauri/src/commands/design/team_presets.rs`
- `src-tauri/src/commands/design/team_synthesis.rs`
- `src-tauri/src/commands/design/template_adopt.rs`
- `src-tauri/src/commands/design/template_feedback.rs`
- `src-tauri/src/commands/design/smart_search.rs`
- `src-tauri/src/commands/design/archetypes.rs`
- `src-tauri/src/commands/teams/team_channel.rs`
- `src-tauri/src/commands/teams/team_memories.rs`
- `src-tauri/src/commands/teams/deliberations.rs`
- `src-tauri/src/commands/teams/teams.rs`
- `src-tauri/src/commands/teams/assignments.rs`
- `src-tauri/src/commands/teams/mod.rs`
- `src-tauri/src/commands/testing/mod.rs`
- `src-tauri/src/commands/testing/synthesize_review.rs`

**Entry points:** src-tauri/src/commands/design/n8n_transform/cli_runner.rs, src-tauri/src/commands/design/build_sessions.rs, src-tauri/src/commands/design/connector_readiness.rs

**Keywords:** n8n, transform, workflow, streaming, job, sanitize, confirm, build, session, wizard, simulate, review

**API surface:** start_n8n_transform, confirm_n8n_transform, get_n8n_session, check_n8n_limits

**Tech stack:** Tauri 2, Rust, Claude CLI, n8n API

---

### engine-project-tracking

Dev-project activity tracking subsystem that absorbs CLI signals (git commits, active-runs entries, Obsidian notes), maintains a capped raw event log, and runs an hourly Sonnet 4.6 consolidator that produces a stable per-project 'pulse' (narrative + named directions + tensions). The pulse is consumed by the companion brain and surfaced in chat. Includes the push accelerator for out-of-cadence consolidation triggered by a local HTTP POST from a skill or CLI. [Consolidated 2026-08-04: absorbed project-tracking-watchers, render-plan-ir, runner-credential-injection, runner-env-sanitization, runner-global-settings, runner-orchestrator, runner-team-context, cross-device-workspace-sync]

**Files:**
- `src-tauri/src/engine/project_tracking/mod.rs`
- `src-tauri/src/engine/project_tracking/subscription.rs`
- `src-tauri/src/engine/project_tracking/scheduler.rs`
- `src-tauri/src/engine/project_tracking/push.rs`
- `src-tauri/src/engine/project_tracking/events.rs`
- `src-tauri/src/engine/project_tracking/pulse.rs`
- `src-tauri/src/engine/project_tracking/consolidator.rs`
- `src-tauri/src/engine/project_tracking/watchers/mod.rs`
- `src-tauri/src/engine/project_tracking/watchers/git.rs`
- `src-tauri/src/engine/project_tracking/watchers/ledger.rs`
- `src-tauri/src/engine/project_tracking/watchers/obsidian.rs`
- `src-tauri/src/engine/render_plan/mod.rs`
- `src-tauri/src/engine/render_plan/compile.rs`
- `src-tauri/src/engine/render_plan/invariants.rs`
- `src-tauri/src/engine/render_plan/tests.rs`
- `src-tauri/src/engine/runner/credentials.rs`
- `src-tauri/src/engine/runner/env.rs`
- `src-tauri/src/engine/runner/globals.rs`
- `src-tauri/src/engine/runner/mod.rs`
- `src-tauri/src/engine/runner/stages.rs`
- `src-tauri/src/engine/runner/team_context.rs`
- `src-tauri/engine/src/workspace_sync/mod.rs`
- `src-tauri/engine/src/workspace_sync/crypto.rs`
- `src-tauri/engine/src/workspace_sync/merge.rs`
- `src-tauri/engine/src/workspace_sync/snapshot.rs`
- `src-tauri/engine/src/worktree_settings.rs`

**Entry points:** src-tauri/src/engine/project_tracking/mod.rs, src-tauri/src/engine/project_tracking/consolidator.rs, src-tauri/src/engine/project_tracking/watchers/mod.rs

**Keywords:** project tracking, pulse, consolidator, activity, CLI signal, narrative, directions, tensions, dev project, git watcher, ledger watcher, Obsidian watcher

**API surface:** POST /project-tracking/cli-event (local HTTP)

**Tech stack:** Rust, Tokio, SQLite (rusqlite), axum

---

### passport-wall-model

Domain model and data layer for the Passport Wall. passportModel.ts defines the AppPassport type; passportDerive.ts derives readiness scores; passportRows.ts produces the wall row shapes; passportHistory.ts provides trend data; usePassportData.ts is the IPC bridge. Also includes export, environment cost estimation, onboarding and populate dispatch helpers.

**Files:**
- `src/features/teams/sub_factory/passport/passportModel.ts`
- `src/features/teams/sub_factory/passport/passportDerive.ts`
- `src/features/teams/sub_factory/passport/passportRows.ts`
- `src/features/teams/sub_factory/passport/passportHistory.ts`
- `src/features/teams/sub_factory/passport/passportExport.ts`
- `src/features/teams/sub_factory/passport/usePassportData.ts`
- `src/features/teams/sub_factory/passport/actionConfirmCatalog.ts`
- `src/features/teams/sub_factory/passport/memoryBlock.ts`
- `src/features/teams/sub_factory/passport/onboardDispatch.ts`
- `src/features/teams/sub_factory/passport/populateDispatch.ts`
- `src/features/teams/sub_factory/passport/rowDirections.ts`
- `src/features/teams/sub_factory/passport/skillPlacement.ts`
- `src/features/teams/sub_factory/passport/techIcons.tsx`
- `src/features/teams/sub_factory/passport/wallConfig.ts`
- `src/features/teams/sub_factory/passport/index.ts`
- `src/features/teams/sub_factory/passport/__tests__/usePassportData.test.tsx`
- `src/features/teams/sub_factory/passport/coverRoadmap.test.ts`
- `src/features/teams/sub_factory/passport/passportEnvCost.test.ts`
- `src/features/teams/sub_factory/passport/passportHistory.test.ts`

**Entry points:** src/features/teams/sub_factory/passport/usePassportData.ts, src/features/teams/sub_factory/passport/passportModel.ts

**Keywords:** passport model, readiness, derive, history, export, env cost, populate, onboard

**Tech stack:** React 19, TypeScript, Tauri 2

---

### passport-wall-ui

The Passport Wall UI — a multi-project readiness dashboard where each project's passport is rendered as a row of dimension cells (ink-coloured by readiness). Includes the cover roadmap, actions row, populate scope picker, wall comparison table, overview grid, and action confirmation modals. Ink-based visual encoding communicates project health at a glance.

**Files:**
- `src/features/teams/sub_factory/passport/ProjectsPassportWall.tsx`
- `src/features/teams/sub_factory/passport/CoverBody.tsx`
- `src/features/teams/sub_factory/passport/CoverRoadmap.tsx`
- `src/features/teams/sub_factory/passport/ActionConfirmModal.tsx`
- `src/features/teams/sub_factory/passport/InkWallCell.tsx`
- `src/features/teams/sub_factory/passport/LlmTrackingCell.tsx`
- `src/features/teams/sub_factory/passport/PassportActionsRow.tsx`
- `src/features/teams/sub_factory/passport/passportFleet.tsx`
- `src/features/teams/sub_factory/passport/passportInk.tsx`
- `src/features/teams/sub_factory/passport/passportWidgets.tsx`
- `src/features/teams/sub_factory/passport/PopulateScopePicker.tsx`
- `src/features/teams/sub_factory/passport/ReadinessTrend.tsx`
- `src/features/teams/sub_factory/passport/RowSetupModal.tsx`
- `src/features/teams/sub_factory/passport/WallCompareTable.tsx`
- `src/features/teams/sub_factory/passport/WallOverviewGrid.tsx`
- `src/features/teams/sub_factory/passport/WarningBadge.tsx`

**Entry points:** src/features/teams/sub_factory/passport/ProjectsPassportWall.tsx, src/features/teams/sub_factory/passport/InkWallCell.tsx

**Keywords:** passport, wall, readiness, ink, dimension, cover, roadmap, populate

**Tech stack:** React 19, TypeScript, Tailwind 4, Tauri 2

---

### teams-factory

Factory page — the L1/L2/L3 KPI management hierarchy for dev projects. L1 renders project score-cards; L2 is a context × KPI matrix with micro-sparkline cells (TrendVariant); L3 drills into a KPI table and console. Uses live dev_tools data via FactoryDataProvider. Traffic-light colouring shows met/warn/crit/unmeasured KPI status. [Consolidated 2026-08-04: absorbed factory-kpi-actions]

**Files:**
- `src/features/teams/sub_factory/FactoryPage.tsx`
- `src/features/teams/sub_factory/FactoryShell.tsx`
- `src/features/teams/sub_factory/TrendVariant.tsx`
- `src/features/teams/sub_factory/FactoryBreadcrumb.tsx`
- `src/features/teams/sub_factory/ContextMatrix.tsx`
- `src/features/teams/sub_factory/ProjectsLayer.tsx`
- `src/features/teams/sub_factory/factoryPrimitives.tsx`
- `src/features/teams/sub_factory/GroupKpiLayer.tsx`
- `src/features/teams/sub_factory/KpiConsole.tsx`
- `src/features/teams/sub_factory/KpiProposalsPanel.tsx`
- `src/features/teams/sub_factory/KpiTable.tsx`
- `src/features/teams/sub_factory/factoryData.tsx`
- `src/features/teams/sub_factory/factoryModel.ts`
- `src/features/teams/sub_factory/AddKpiModal.tsx`
- `src/features/teams/sub_factory/addKpiPrimitives.tsx`
- `src/features/teams/sub_factory/MeasureSetupModal.tsx`
- `src/features/teams/sub_factory/useAddKpi.ts`
- `src/features/teams/sub_factory/composeTask.ts`

**Entry points:** src/features/teams/sub_factory/FactoryPage.tsx, src/features/teams/sub_factory/TrendVariant.tsx, src/features/teams/sub_factory/factoryData.tsx

**Keywords:** factory, kpi matrix, sparkline, traffic-light, context, project, score card, factory data, kpi add, measure setup, compose task, view model

**Tech stack:** React 19, TypeScript, Tailwind 4, Tauri 2

---

### teams-factory-l2

Ship tab within the Factory — a milestone convergence surface that shows release-readiness, velocity, and a planner. Derives milestones, velocity metrics, and criteria gates from the Factory data. Includes a Fleet dispatch integration so users can ship from the UI. Thoroughly tested with fixture-driven unit tests for derivation and velocity calculations. [Consolidated 2026-08-04: absorbed factory-project-tabs]

**Files:**
- `src/features/teams/sub_factory/l2/ship/FactoryShipTab.tsx`
- `src/features/teams/sub_factory/l2/ship/ShipContextDrawer.tsx`
- `src/features/teams/sub_factory/l2/ship/ShipDispatch.tsx`
- `src/features/teams/sub_factory/l2/ship/ShipLibraryTree.tsx`
- `src/features/teams/sub_factory/l2/ship/ShipMilestoneComposer.tsx`
- `src/features/teams/sub_factory/l2/ship/ShipPlannerTab.tsx`
- `src/features/teams/sub_factory/l2/ship/ShipVelocityNote.tsx`
- `src/features/teams/sub_factory/l2/ship/shipCriteria.ts`
- `src/features/teams/sub_factory/l2/ship/shipDerive.ts`
- `src/features/teams/sub_factory/l2/ship/shipModel.ts`
- `src/features/teams/sub_factory/l2/ship/shipRows.tsx`
- `src/features/teams/sub_factory/l2/ship/shipVelocity.ts`
- `src/features/teams/sub_factory/l2/ship/useShipData.ts`
- `src/features/teams/sub_factory/l2/ship/seedOnboarding.ts`
- `src/features/teams/sub_factory/l2/ship/__tests__/shipDerive.test.ts`
- `src/features/teams/sub_factory/l2/ship/__tests__/shipFixtures.ts`
- `src/features/teams/sub_factory/l2/ship/__tests__/shipVelocity.test.ts`
- `src/features/teams/sub_factory/l2/FactoryProjectTabs.tsx`
- `src/features/teams/sub_factory/l2/FactoryOverviewTab.tsx`
- `src/features/teams/sub_factory/l2/FactoryObservabilityTab.tsx`
- `src/features/teams/sub_factory/l2/factoryL2Data.ts`

**Entry points:** src/features/teams/sub_factory/l2/ship/FactoryShipTab.tsx, src/features/teams/sub_factory/l2/ship/shipDerive.ts, src/features/teams/sub_factory/l2/FactoryProjectTabs.tsx

**Keywords:** ship, milestone, velocity, planner, release, criteria, dispatch, project tabs, overview, observability, l2, factory drill-down

**Tech stack:** React 19, TypeScript, Tailwind 4, Tauri 2

---

### teams-factory-passport-improve

Business logic for the passport improvement engine. useImproveEngine coordinates the improvement plan derivation; improvePlan.ts computes actionable items per skill; goldenStandard.ts defines quality benchmarks; findingFix.ts maps scan findings to fix actions. Also includes provenance tracking, levels definitions, deploy actions, and connector resolution. [Consolidated 2026-08-04: absorbed passport-improve-ui]

**Files:**
- `src/features/teams/sub_factory/passport/improve/useImproveEngine.ts`
- `src/features/teams/sub_factory/passport/improve/ImproveContext.tsx`
- `src/features/teams/sub_factory/passport/improve/improvePlan.ts`
- `src/features/teams/sub_factory/passport/improve/goldenStandard.ts`
- `src/features/teams/sub_factory/passport/improve/findingFix.ts`
- `src/features/teams/sub_factory/passport/improve/skillsWorkbenchData.ts`
- `src/features/teams/sub_factory/passport/improve/skillTasks.ts`
- `src/features/teams/sub_factory/passport/improve/connectors.ts`
- `src/features/teams/sub_factory/passport/improve/deployActions.ts`
- `src/features/teams/sub_factory/passport/improve/levels.ts`
- `src/features/teams/sub_factory/passport/improve/provenance.ts`
- `src/features/teams/sub_factory/passport/improve/standards.ts`
- `src/features/teams/sub_factory/passport/improve/__tests__/skillsWorkbenchData.test.ts`
- `src/features/teams/sub_factory/passport/improve/goldenStandard.test.ts`
- `src/features/teams/sub_factory/passport/improve/SkillsWorkbench.tsx`
- `src/features/teams/sub_factory/passport/improve/SkillDetailPane.tsx`
- `src/features/teams/sub_factory/passport/improve/SkillListPane.tsx`
- `src/features/teams/sub_factory/passport/improve/workbenchChrome.tsx`
- `src/features/teams/sub_factory/passport/improve/ImproveCell.tsx`
- `src/features/teams/sub_factory/passport/improve/ImprovePlanPanel.tsx`
- `src/features/teams/sub_factory/passport/improve/ImprovePopover.tsx`
- `src/features/teams/sub_factory/passport/improve/DeployPopover.tsx`
- `src/features/teams/sub_factory/passport/improve/ConnectorSection.tsx`
- `src/features/teams/sub_factory/passport/improve/DataLinksPopover.tsx`
- `src/features/teams/sub_factory/passport/improve/GoldenGauge.tsx`
- `src/features/teams/sub_factory/passport/improve/LevelLadder.tsx`
- `src/features/teams/sub_factory/passport/improve/StandardsScan.tsx`

**Entry points:** src/features/teams/sub_factory/passport/improve/useImproveEngine.ts, src/features/teams/sub_factory/passport/improve/improvePlan.ts, src/features/teams/sub_factory/passport/improve/SkillsWorkbench.tsx

**Keywords:** improve engine, golden standard, finding fix, provenance, levels, deploy actions, skill tasks, improve, skills workbench, standards, golden gauge, deploy

**Tech stack:** TypeScript, React 19, Tauri 2

---

### teams-goals

Main goal-tracking surface for teams and projects. Renders goals as a kanban board, timeline, constellation map, and mission list. Supports creating and editing goals via a modal, detailed drawers, task tables, and a handoff panel for agent-to-human hand-offs. Scope can be all-projects or per-project, with the Done lane toggleable. [Consolidated 2026-08-04: absorbed goal-acceptance, team-collaboration-channels, team-deliberations]

**Files:**
- `src/features/teams/sub_goals/GoalsPage.tsx`
- `src/features/teams/sub_goals/GoalCard.tsx`
- `src/features/teams/sub_goals/GoalConstellation.tsx`
- `src/features/teams/sub_goals/GoalDetailDrawer.tsx`
- `src/features/teams/sub_goals/GoalEditorModal.tsx`
- `src/features/teams/sub_goals/GoalHandoffPanel.tsx`
- `src/features/teams/sub_goals/GoalKanban.tsx`
- `src/features/teams/sub_goals/GoalsEmptyGlyph.tsx`
- `src/features/teams/sub_goals/GoalsMissions.tsx`
- `src/features/teams/sub_goals/GoalsProgress.tsx`
- `src/features/teams/sub_goals/GoalsTimeline.tsx`
- `src/features/teams/sub_goals/GoalTaskTable.tsx`
- `src/features/teams/sub_goals/GoalViewExplainer.tsx`
- `src/features/teams/sub_goals/goalsTheme.tsx`
- `src/features/teams/sub_goals/progressShared.tsx`
- `src/features/teams/sub_goals/__tests__/GoalKanban.test.tsx`
- `src/features/teams/sub_goals/__tests__/partitionGoalTasks.test.ts`
- `src/features/teams/sub_goals/goalStatus.ts`
- `src/features/teams/sub_goals/GoalStatusBadge.tsx`
- `src/features/teams/sub_goals/goalAcceptanceModel.ts`
- `src/features/teams/sub_goals/GoalAcceptanceOverlay.tsx`
- `src/features/teams/sub_goals/GoalAcceptanceView.tsx`
- `src/features/teams/sub_goals/AcceptanceTriagePolished.tsx`
- `src/features/teams/sub_goals/acceptancePrimitives.tsx`
- `src/features/teams/sub_goals/GoalKpiLink.tsx`
- `src/features/teams/sub_goals/__tests__/goalAcceptanceModel.test.ts`
- `src/features/teams/sub_goals/__tests__/goalStatus.test.ts`
- `src/features/teams/sub_collab/ChannelDetailModal.tsx`
- `src/features/teams/sub_collab/collabRender.tsx`
- `src/features/teams/sub_collab/payloadView.ts`
- `src/features/teams/sub_collab/useChannelService.ts`
- `src/features/teams/sub_collab/useTeamChannel.ts`
- `src/features/teams/sub_collab/useTeamChannel.test.ts`
- `src/features/teams/sub_deliberations/useTeamDeliberations.ts`

**Entry points:** src/features/teams/sub_goals/GoalsPage.tsx, src/features/teams/sub_goals/GoalKanban.tsx, src/features/teams/sub_goals/goalAcceptanceModel.ts

**Keywords:** goal, kanban, timeline, mission, progress, constellation, task, handoff, acceptance, goal status, triage, kpi link

**Tech stack:** React 19, TypeScript, Zustand 5, Tailwind 4, Tauri 2

---

### teams-kpis

Full KPI management surface including the KPI dashboard, connect wizard, proposal queue, signal board, steering panel, sim control, and detail modal. Users connect data sources to KPIs, review AI-generated proposals, simulate projections, and steer via autopilot controls. Depends on kpi-math-models for calculations. [Consolidated 2026-08-04: absorbed kpi-math-models]

**Files:**
- `src/features/teams/sub_kpis/KPIsPage.tsx`
- `src/features/teams/sub_kpis/KPIDashboard.tsx`
- `src/features/teams/sub_kpis/KPIConnectWizard.tsx`
- `src/features/teams/sub_kpis/KPIProposalModal.tsx`
- `src/features/teams/sub_kpis/KPIProposalsQueue.tsx`
- `src/features/teams/sub_kpis/KpiDetailModal.tsx`
- `src/features/teams/sub_kpis/kpiDetailParts.tsx`
- `src/features/teams/sub_kpis/KpiSignalBoard.tsx`
- `src/features/teams/sub_kpis/KpiSteeringPanel.tsx`
- `src/features/teams/sub_kpis/KpiSimControl.tsx`
- `src/features/teams/sub_kpis/KpiSimSuggestions.tsx`
- `src/features/teams/sub_kpis/AutopilotControl.tsx`
- `src/features/teams/sub_kpis/useKpiDetail.ts`
- `src/features/teams/sub_kpis/__tests__/KPIDashboard.buildProjectGroups.test.ts`
- `src/features/teams/sub_kpis/kpiMath.ts`
- `src/features/teams/sub_kpis/kpiMeasurementProvenance.ts`
- `src/features/teams/sub_kpis/kpiMeta.ts`
- `src/features/teams/sub_kpis/kpiDistance.tsx`
- `src/features/teams/sub_kpis/describeMeasurement.ts`
- `src/features/teams/sub_kpis/kpiConvergence.ts`
- `src/features/teams/sub_kpis/kpiSimPrompt.ts`
- `src/features/teams/sub_kpis/__tests__/kpiConvergence.test.ts`
- `src/features/teams/sub_kpis/__tests__/kpiMeasurementProvenance.test.ts`
- `src/features/teams/sub_kpis/__tests__/kpiSimPrompt.test.ts`

**Entry points:** src/features/teams/sub_kpis/KPIsPage.tsx, src/features/teams/sub_kpis/KPIDashboard.tsx, src/features/teams/sub_kpis/kpiMath.ts

**Keywords:** kpi, dashboard, signal board, proposals, autopilot, sim, steering, connect wizard, kpi math, distance, convergence, provenance

**Tech stack:** React 19, TypeScript, Zustand 5, Tailwind 4, Tauri 2

---

### template-adoption-persona-layout

Matrix-style adoption surface that shows all 8 persona dimensions as a petal layout, letting the user review and edit each capability, error policy, schedule, and connector binding before creating. useAdoptionDimensionModel is the orchestration hook that maintains petal states, maps questionnaire answers to dimensions, and drives inline editing.

**Files:**
- `src/features/templates/sub_generated/adoption/persona-layout/PersonaLayoutAdoption.tsx`
- `src/features/templates/sub_generated/adoption/persona-layout/PersonaLayoutBuild.tsx`
- `src/features/templates/sub_generated/adoption/persona-layout/AdoptionLeftPanel.tsx`
- `src/features/templates/sub_generated/adoption/persona-layout/AdoptionAnswerCard.tsx`
- `src/features/templates/sub_generated/adoption/persona-layout/CapabilityTagSwitcher.tsx`
- `src/features/templates/sub_generated/adoption/persona-layout/ErrorPolicyCard.tsx`
- `src/features/templates/sub_generated/adoption/persona-layout/useAdoptionDimensionModel.tsx`
- `src/features/templates/sub_generated/adoption/persona-layout/personaLayoutAdoptionTypes.ts`
- `src/features/templates/sub_generated/adoption/persona-layout/adoptionDimHelpers.ts`
- `src/features/templates/sub_generated/adoption/persona-layout/adoptionImpact.ts`
- `src/features/templates/sub_generated/adoption/persona-layout/composerScheduleToTriggerSelection.ts`
- `src/features/templates/sub_generated/adoption/persona-layout/questionDimMap.ts`
- `src/features/templates/sub_generated/adoption/persona-layout/index.ts`

**Entry points:** src/features/templates/sub_generated/adoption/persona-layout/PersonaLayoutAdoption.tsx, src/features/templates/sub_generated/adoption/persona-layout/useAdoptionDimensionModel.tsx

**Keywords:** persona layout, petal, dimension model, capability, error policy, adoption impact, matrix

**Tech stack:** React 19, TypeScript, Zustand 5

---

### template-adoption-questionnaire

Multi-question interview UI that walks the user through configuring a template's 8 adoption dimensions. Each question maps to a glyph dimension and renders as a hero question with stacked options, a story thread, category rail, footer navigation, and keyboard shortcuts. Tracks category progress and surfaces blocked-credential CTAs when required connectors are missing.

**Files:**
- `src/features/templates/sub_generated/adoption/questionnaire/QuestionnaireForm.tsx`
- `src/features/templates/sub_generated/adoption/questionnaire/QuestionnaireHeaderBand.tsx`
- `src/features/templates/sub_generated/adoption/questionnaire/QuestionnaireCategoryRail.tsx`
- `src/features/templates/sub_generated/adoption/questionnaire/QuestionnaireHeroQuestion.tsx`
- `src/features/templates/sub_generated/adoption/questionnaire/QuestionnaireStackedOptions.tsx`
- `src/features/templates/sub_generated/adoption/questionnaire/QuestionnaireStoryThread.tsx`
- `src/features/templates/sub_generated/adoption/questionnaire/QuestionnaireFooterNav.tsx`
- `src/features/templates/sub_generated/adoption/questionnaire/QuestionnaireBlockedCredentialCta.tsx`
- `src/features/templates/sub_generated/adoption/questionnaire/QuestionnaireCenterpieceSigil.tsx`
- `src/features/templates/sub_generated/adoption/questionnaire/QuestionnaireKeyboardHint.tsx`
- `src/features/templates/sub_generated/adoption/questionnaire/questionnaireGlyphRow.ts`
- `src/features/templates/sub_generated/adoption/questionnaire/questionnaireHelpers.ts`
- `src/features/templates/sub_generated/adoption/questionnaire/types.ts`
- `src/features/templates/sub_generated/adoption/questionnaire/useQuestionnaireCategoryData.ts`
- `src/features/templates/sub_generated/adoption/questionnaire/useQuestionnaireKeyboardNav.ts`
- `src/features/templates/sub_generated/adoption/questionnaire/index.ts`
- `src/features/templates/sub_generated/adoption/questionnaireCategoryOrder.ts`

**Entry points:** src/features/templates/sub_generated/adoption/questionnaire/QuestionnaireForm.tsx

**Keywords:** questionnaire, adoption dimensions, glyph, interview, category rail, keyboard nav, credential blocker

**Tech stack:** React 19, TypeScript

---

### template-adoption-support

Supporting utilities and cross-cutting components for the adoption flow: vault-to-question credential matching (vaultAdoptionMatcher), dynamic question option resolution, hydrated design result loading, shared use-case trigger normalisation, composition x-ray inspector, messaging picker, pill selectors, questionnaire form grid, glyph animations, and the quick-add credential modal.

**Files:**
- `src/features/templates/sub_generated/adoption/glyph/PersonaChronologyGlyph.tsx`
- `src/features/templates/sub_generated/adoption/glyph/index.ts`
- `src/features/templates/sub_generated/adoption/CompositionXray.tsx`
- `src/features/templates/sub_generated/adoption/MessagingPickerShared.tsx`
- `src/features/templates/sub_generated/adoption/SelectPills.tsx`
- `src/features/templates/sub_generated/adoption/QuestionnaireFormGrid.tsx`
- `src/features/templates/sub_generated/adoption/QuestionnaireFormGridConfig.ts`
- `src/features/templates/sub_generated/adoption/QuestionnaireFormGridParts.tsx`
- `src/features/templates/sub_generated/adoption/QuickAddCredentialModal.tsx`
- `src/features/templates/sub_generated/adoption/useCasePickerShared.ts`
- `src/features/templates/sub_generated/adoption/useDynamicQuestionOptions.ts`
- `src/features/templates/sub_generated/adoption/useHydratedDesignResult.ts`

**Entry points:** src/features/templates/sub_generated/shared/vaultAdoptionMatcher.ts, src/features/templates/sub_generated/adoption/useCasePickerShared.ts

**Keywords:** vault matching, credential binding, dynamic options, composition xray, messaging picker, glyph animation, quick add credential

**Tech stack:** React 19, TypeScript, Zustand 5

---

### template-design-preview

Read-only preview of an AI-generated template's design result, broken into three sections: connectors pipeline, event subscriptions, and messaging channels. Also includes the design summary bar, a test-results panel that shows validation scores per dimension, and a checkbox to flag specific dimensions for re-generation.

**Files:**
- `src/features/templates/sub_generated/design-preview/DesignResultPreview.tsx`
- `src/features/templates/sub_generated/design-preview/DesignSummaryBar.tsx`
- `src/features/templates/sub_generated/design-preview/ConnectorsSection.tsx`
- `src/features/templates/sub_generated/design-preview/EventsSection.tsx`
- `src/features/templates/sub_generated/design-preview/MessagesSection.tsx`
- `src/features/templates/sub_generated/design-preview/DesignTestResults.tsx`
- `src/features/templates/sub_generated/design-preview/DesignCheckbox.tsx`
- `src/features/templates/sub_generated/design-preview/helpers.ts`

**Entry points:** src/features/templates/sub_generated/design-preview/DesignResultPreview.tsx

**Keywords:** design result, connectors, events, messages, test results, design preview, dimension scores

**Tech stack:** React 19, TypeScript

---

### template-gallery-modals

Modal layer for the template gallery: detail view, preview, rebuild, multi-template compare, recommended picks, credential quick-setup, and the use-cases tab. useModalStack manages a push/pop stack so modals can open sub-modals without losing their parent. TemplateModals is the root compositor that renders whichever modal is currently active.

**Files:**
- `src/features/templates/sub_generated/gallery/modals/TemplateModals.tsx`
- `src/features/templates/sub_generated/gallery/modals/TemplateDetailModal.tsx`
- `src/features/templates/sub_generated/gallery/modals/TemplatePreviewModal.tsx`
- `src/features/templates/sub_generated/gallery/modals/RebuildModal.tsx`
- `src/features/templates/sub_generated/gallery/modals/CompareModal.tsx`
- `src/features/templates/sub_generated/gallery/modals/RecommendedModal.tsx`
- `src/features/templates/sub_generated/gallery/modals/CatalogCredentialModal.tsx`
- `src/features/templates/sub_generated/gallery/modals/OverviewTab.tsx`
- `src/features/templates/sub_generated/gallery/modals/UseCasesTab.tsx`
- `src/features/templates/sub_generated/gallery/modals/useModalStack.ts`

**Entry points:** src/features/templates/sub_generated/gallery/modals/TemplateModals.tsx, src/features/templates/sub_generated/gallery/modals/useModalStack.ts

**Keywords:** template detail, template preview, compare modal, rebuild, credential modal, modal stack, recommended

**Tech stack:** React 19, TypeScript, Zustand 5

---

### template-gallery-search

Full search and filter bar for the template gallery: structured query chips, AI-powered autocomplete suggestions, connector/component/sort/density/admin filter dropdowns, and a filter chip row. useStructuredQuery converts free-text input into typed query chips (keyword, connector, tag, use-case) that the virtual list filters against.

**Files:**
- `src/features/templates/sub_generated/gallery/search/TemplateSearchBar.tsx`
- `src/features/templates/sub_generated/gallery/search/TemplateSearchBarTypes.ts`
- `src/features/templates/sub_generated/gallery/search/TemplateSearchFilterRow.tsx`
- `src/features/templates/sub_generated/gallery/search/filters/AdminToolsDropdown.tsx`
- `src/features/templates/sub_generated/gallery/search/filters/ComponentFilterDropdown.tsx`
- `src/features/templates/sub_generated/gallery/search/filters/ConnectorFilterDropdown.tsx`
- `src/features/templates/sub_generated/gallery/search/filters/DensityToggle.tsx`
- `src/features/templates/sub_generated/gallery/search/filters/FilterChips.tsx`
- `src/features/templates/sub_generated/gallery/search/filters/searchConstants.ts`
- `src/features/templates/sub_generated/gallery/search/filters/SortDropdown.tsx`
- `src/features/templates/sub_generated/gallery/search/suggestions/AiSearchStatusBar.tsx`
- `src/features/templates/sub_generated/gallery/search/suggestions/SearchAutocomplete.tsx`
- `src/features/templates/sub_generated/gallery/search/suggestions/SearchChipInput.tsx`
- `src/features/templates/sub_generated/gallery/search/suggestions/useStructuredQuery.ts`

**Entry points:** src/features/templates/sub_generated/gallery/search/TemplateSearchBar.tsx, src/features/templates/sub_generated/gallery/search/suggestions/useStructuredQuery.ts

**Keywords:** search, filters, autocomplete, query chips, connector filter, sort, density, AI search

**Tech stack:** React 19, TypeScript

---

### template-generation

Three-step AI wizard for creating a new template from scratch: Describe (name + description input), Generate (invokes the design runner via IPC and streams progress), and Review (shows the generated design result for approval). State is managed by a wizard reducer with snapshot persistence so the wizard can survive navigations.

**Files:**
- `src/features/templates/sub_generated/generation/modals/CreateTemplateModal.tsx`
- `src/features/templates/sub_generated/generation/modals/CreateTemplateModalFooter.tsx`
- `src/features/templates/sub_generated/generation/modals/CreateTemplateModalHeader.tsx`
- `src/features/templates/sub_generated/generation/modals/CreateTemplateSteps.tsx`
- `src/features/templates/sub_generated/generation/modals/createTemplateTypes.ts`
- `src/features/templates/sub_generated/generation/runner/DesignReviewRunner.tsx`
- `src/features/templates/sub_generated/generation/runner/DesignReviewTerminal.tsx`
- `src/features/templates/sub_generated/generation/runner/designRunnerConstants.ts`
- `src/features/templates/sub_generated/generation/runner/useDesignRunnerState.ts`
- `src/features/templates/sub_generated/generation/sources/BatchSourceView.tsx`
- `src/features/templates/sub_generated/generation/sources/CustomSourceView.tsx`
- `src/features/templates/sub_generated/generation/sources/ModeTabBar.tsx`
- `src/features/templates/sub_generated/generation/sources/TemplateSourcePanel.tsx`
- `src/features/templates/sub_generated/generation/sources/TemplateSourceTypes.ts`
- `src/features/templates/sub_generated/generation/useCreateTemplateActions.ts`
- `src/features/templates/sub_generated/generation/useCreateTemplateReducer.ts`
- `src/features/templates/sub_generated/generation/useCreateTemplateSnapshot.ts`

**Entry points:** src/features/templates/sub_generated/generation/modals/CreateTemplateModal.tsx, src/features/templates/sub_generated/generation/useCreateTemplateActions.ts

**Keywords:** template creation, AI generation, design runner, wizard, batch source, custom source, generate template

**API surface:** invoke run_design_review, save_design_review

**Tech stack:** React 19, TypeScript, Tauri 2, Zustand 5

---

### template-shared-primitives

Reusable building blocks shared across template sub-features: BaseModal overlay, ThinkingLoader spinner, TrustBadge scan indicator, ConnectorReadiness readiness chip, ConnectorPipeline visualisation, DimensionRadial chart, AdoptCelebration confetti, SandboxWarningBanner, ScanResultsBanner, TeamSynthesisPanel, and library utilities (adoptionReadiness, architecturalCategories, templateComplexity, vaultAdoptionMatcher).

**Files:**
- `src/features/templates/sub_generated/shared/BaseModal.tsx`
- `src/features/templates/sub_generated/shared/ThinkingLoader.tsx`
- `src/features/templates/sub_generated/shared/TrustBadge.tsx`
- `src/features/templates/sub_generated/shared/ConnectorReadiness.tsx`
- `src/features/templates/sub_generated/shared/ConnectorPipeline.tsx`
- `src/features/templates/sub_generated/shared/DimensionRadial.tsx`
- `src/features/templates/sub_generated/shared/AdoptCelebration.tsx`
- `src/features/templates/sub_generated/shared/SandboxWarningBanner.tsx`
- `src/features/templates/sub_generated/shared/ScanResultsBanner.tsx`
- `src/features/templates/sub_generated/shared/TabTransition.tsx`
- `src/features/templates/sub_generated/shared/TeamSynthesisPanel.tsx`
- `src/features/templates/sub_generated/shared/adoptionReadiness.ts`
- `src/features/templates/sub_generated/shared/architecturalCategories.ts`
- `src/features/templates/sub_generated/shared/templateComplexity.ts`
- `src/features/templates/sub_generated/shared/vaultAdoptionMatcher.ts`
- `src/features/templates/sub_generated/index.ts`

**Entry points:** src/features/templates/sub_generated/shared/BaseModal.tsx, src/features/templates/sub_generated/shared/adoptionReadiness.ts

**Keywords:** base modal, thinking loader, trust badge, connector readiness, dimension radial, adoption readiness, architectural categories

**Tech stack:** React 19, TypeScript

---

### templates-draft-editor

Multi-tab editor for reviewing and modifying an n8n-derived persona draft before it is committed. Provides Prompt, Settings, and JSON tabs that let operators tune the AI system prompt, persona metadata, and raw JSON payload. Accepts an N8nPersonaDraft shape and exposes update callbacks consumed by the n8n wizard's confirm step. [Consolidated 2026-08-04: absorbed template-explore-view, template-presets]

**Files:**
- `src/features/templates/draft-editor/DraftEditStep.tsx`
- `src/features/templates/draft-editor/DraftPromptTab.tsx`
- `src/features/templates/draft-editor/DraftSettingsTab.tsx`
- `src/features/templates/draft-editor/DraftJsonTab.tsx`
- `src/features/templates/draft-editor/DraftIdentityTab.tsx`
- `src/features/templates/draft-editor/DesignContextViewer.tsx`
- `src/features/templates/draft-editor/SectionEditor.tsx`
- `src/features/templates/draft-editor/index.ts`
- `src/features/templates/sub_explore/ExploreView.tsx`
- `src/features/templates/sub_explore/atlas/BentoGrid.tsx`
- `src/features/templates/sub_explore/exploreDomains.ts`
- `src/features/templates/sub_explore/level2/DomainLevel2.tsx`
- `src/features/templates/sub_explore/level2/DomainTable.tsx`
- `src/features/templates/sub_explore/useExploreCatalog.ts`
- `src/features/templates/sub_presets/PresetLibraryPage.tsx`
- `src/features/templates/sub_presets/PresetPreviewModal.tsx`
- `src/features/templates/sub_presets/PresetQuestionnaireForm.tsx`
- `src/features/templates/sub_presets/PresetGraphAdapter.tsx`
- `src/features/templates/sub_presets/usePresetAdoption.ts`
- `src/features/templates/sub_presets/index.ts`

**Entry points:** src/features/templates/draft-editor/DraftEditStep.tsx, src/features/templates/sub_explore/ExploreView.tsx, src/features/templates/sub_explore/useExploreCatalog.ts

**Keywords:** draft editing, system prompt, persona settings, JSON editor, n8n persona, adjustment, explore, bento grid, domain browsing, automation discovery, template catalog, team presets

**Tech stack:** React 19, TypeScript

---

### templates-generated-adoption-ucpicker

Core use-case picker shell that lets users select how a template will be activated (schedule, event, cockpit, forge). The panel hosts route toggles, a card-based selection grid, and the cockpit/power-rail views. useUcPickerState manages the picker's internal tab and selection state, and ucPickerHelpers provides normalization utilities. [Consolidated 2026-08-04: absorbed template-adoption-uc-picker-variants, template-adoption-chronology]

**Files:**
- `src/features/templates/sub_generated/adoption/ucPicker/ucPicker.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucPanel.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucCard.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucCardHeader.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucCockpitView.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucPowerRail.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucRouteToggle.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucPickerHelpers.ts`
- `src/features/templates/sub_generated/adoption/ucPicker/ucPickerTypes.ts`
- `src/features/templates/sub_generated/adoption/ucPicker/useUcPickerState.ts`
- `src/features/templates/sub_generated/adoption/ucPicker/index.ts`
- `src/features/templates/sub_generated/adoption/ucPicker/ucStampGlyph.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucAppNotificationGlyph.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucInAppMessageGlyph.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucClockVariant.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucDeliverCard.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucForgeEditor.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucPreviewModal.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucTimeCard.tsx`
- `src/features/templates/sub_generated/adoption/ucPicker/ucTimeControls.tsx`
- `src/features/templates/sub_generated/adoption/AdoptionWizardModal.tsx`
- `src/features/templates/sub_generated/adoption/ChronologyAdoptionView.tsx`
- `src/features/templates/sub_generated/adoption/chronology/ChronologyCommandHub.tsx`
- `src/features/templates/sub_generated/adoption/chronology/commandCenterParts.tsx`
- `src/features/templates/sub_generated/adoption/chronology/TestReportModal.tsx`
- `src/features/templates/sub_generated/adoption/chronology/useUseCaseChronology.ts`

**Entry points:** src/features/templates/sub_generated/adoption/ucPicker/ucPicker.tsx, src/features/templates/sub_generated/adoption/ucPicker/useUcPickerState.ts, src/features/templates/sub_generated/adoption/ucPicker/ucDeliverCard.tsx

**Keywords:** use case picker, cockpit, power rail, route toggle, persona activation, schedule, event trigger, notification glyph, stamp, in-app message, time card, forge editor

**Tech stack:** React 19, TypeScript

---

### templates-generated-gallery-cards

Interactive card-layer elements: the virtual scrolling list, row-level action menu, connector icon buttons, expanded row details, compare tray, review cache, and all hooks driving card data and comparison state. GeneratedReviewsTab is the root gallery host that wires together search, filters, virtual list, and modals. [Consolidated 2026-08-04: absorbed template-gallery-card-renderers, template-gallery-explore]

**Files:**
- `src/features/templates/sub_generated/gallery/cards/TemplateVirtualList.tsx`
- `src/features/templates/sub_generated/gallery/cards/ComfortableRow.tsx`
- `src/features/templates/sub_generated/gallery/cards/CompactRow.tsx`
- `src/features/templates/sub_generated/gallery/cards/CompareTray.tsx`
- `src/features/templates/sub_generated/gallery/cards/ConnectorIconButton.tsx`
- `src/features/templates/sub_generated/gallery/cards/ExpandedRowContent.tsx`
- `src/features/templates/sub_generated/gallery/cards/GeneratedReviewsTab.tsx`
- `src/features/templates/sub_generated/gallery/cards/ReviewExpandedDetail.tsx`
- `src/features/templates/sub_generated/gallery/cards/RowActionMenu.tsx`
- `src/features/templates/sub_generated/gallery/cards/reviewParseCache.ts`
- `src/features/templates/sub_generated/gallery/cards/useAdoptionCompletionNotifier.ts`
- `src/features/templates/sub_generated/gallery/cards/useGalleryActions.ts`
- `src/features/templates/sub_generated/gallery/cards/useTemplateCardData.ts`
- `src/features/templates/sub_generated/gallery/cards/useTemplateCompare.ts`
- `src/features/templates/sub_generated/gallery/cards/renderers/TemplateCard.tsx`
- `src/features/templates/sub_generated/gallery/cards/renderers/TemplateCardBody.tsx`
- `src/features/templates/sub_generated/gallery/cards/renderers/TemplateCardFooter.tsx`
- `src/features/templates/sub_generated/gallery/cards/renderers/TemplateCardHeader.tsx`
- `src/features/templates/sub_generated/gallery/cards/renderers/TemplateCardPreview.tsx`
- `src/features/templates/sub_generated/gallery/cards/renderers/templateCardTypes.ts`
- `src/features/templates/sub_generated/gallery/cards/ArchCategoryIcons.tsx`
- `src/features/templates/sub_generated/gallery/cards/TemplateCategoryPills.tsx`
- `src/features/templates/sub_generated/gallery/cards/buildComparison.ts`
- `src/features/templates/sub_generated/gallery/shared/deriveTemplateCategoryTags.ts`
- `src/features/templates/sub_generated/gallery/index.ts`
- `src/features/templates/sub_generated/gallery/explore/TrendingCarousel.tsx`
- `src/features/templates/sub_generated/gallery/explore/RecommendedCarousel.tsx`
- `src/features/templates/sub_generated/gallery/explore/RoleGroupCard.tsx`
- `src/features/templates/sub_generated/gallery/explore/AutomationOpportunitiesRail.tsx`
- `src/features/templates/sub_generated/gallery/explore/BackgroundBanners.tsx`
- `src/features/templates/sub_generated/gallery/explore/EmptyState.tsx`
- `src/features/templates/sub_generated/gallery/explore/useAutomationDiscovery.ts`

**Entry points:** src/features/templates/sub_generated/gallery/cards/GeneratedReviewsTab.tsx, src/features/templates/sub_generated/gallery/cards/TemplateVirtualList.tsx, src/features/templates/sub_generated/gallery/cards/renderers/TemplateCard.tsx

**Keywords:** virtual list, gallery actions, compare, row actions, connector icons, adoption notifier, review parse, template card, card renderer, category icons, density, comfortable row

**Tech stack:** React 19, TypeScript, Zustand 5

---

### test-bridge-core

Core HTTP harness that drives the real Tauri app via the test-automation server on port 17320. The CompanionBridge class wraps /query, /click-testid, /bridge-exec and other primitives into a typed API that all Playwright specs share. Also exports the ALL_TOUR_IDS registry and shared type definitions for panel state, brain counts, and tour snapshots. [Consolidated 2026-08-04: absorbed template-adoption-e2e, template-marathon-bridge, template-marathon-e2e]

**Files:**
- `tests/playwright/companion-bridge.ts`
- `tests/playwright/adoption-persona-layout.spec.ts`
- `tests/playwright/template-marathon-bridge.ts`
- `tests/playwright/template-marathon.spec.ts`

**Entry points:** tests/playwright/companion-bridge.ts, tests/playwright/adoption-persona-layout.spec.ts, tests/playwright/template-marathon-bridge.ts

**Keywords:** bridge, http, test-automation, 17320, CompanionBridge, bridgeExec, query, clickTestId, adoption, persona-layout, scroll, modal

**API surface:** POST /bridge-exec, /click-testid, /fill-field, /navigate, /query, /find-text, /eval, /wait; GET /health

**Tech stack:** Playwright, TypeScript, Node.js

---

## Design & Build Studio

> **Group type:** feature
> **Color:** violet

### agents-design

Conversational AI-driven design tab embedded in the persona editor. Guides the user through analysis, refining, previewing, and applying phases that generate or update a persona's prompt and parameters via an LLM conversation. Manages multi-phase state (analyzing, refining, preview, applied, error) and displays example input/output pairs. [Consolidated 2026-08-04: absorbed tool-runner]

**Files:**
- `src/features/agents/sub_design/DesignHub.tsx`
- `src/features/agents/sub_design/DesignTab.tsx`
- `src/features/agents/sub_design/DesignTabHelpers.ts`
- `src/features/agents/sub_design/DesignQuestionPanel.tsx`
- `src/features/agents/sub_design/IntentResultExtras.tsx`
- `src/features/agents/sub_design/PhaseIndicator.tsx`
- `src/features/agents/sub_design/components/ConversationMessageList.tsx`
- `src/features/agents/sub_design/components/DesignConversationHistory.tsx`
- `src/features/agents/sub_design/components/DesignSubtabPanels.tsx`
- `src/features/agents/sub_design/components/DesignTabPhaseContent.tsx`
- `src/features/agents/sub_design/components/PersonaParametersCard.tsx`
- `src/features/agents/sub_design/components/PhaseContentRenderers.tsx`
- `src/features/agents/sub_design/components/parameterEditing.tsx`
- `src/features/agents/sub_design/libs/designStateHelpers.ts`
- `src/features/agents/sub_design/libs/examplePairs.ts`
- `src/features/agents/sub_design/libs/useDesignTabState.ts`
- `src/features/agents/sub_design/phases/CompilationStepper.tsx`
- `src/features/agents/sub_design/phases/DesignPhaseAnalyzing.tsx`
- `src/features/agents/sub_design/phases/DesignPhaseApplied.tsx`
- `src/features/agents/sub_design/phases/DesignPhaseAppliedDetails.tsx`
- `src/features/agents/sub_design/phases/DesignPhaseApplying.tsx`
- `src/features/agents/sub_design/phases/DesignPhaseError.tsx`
- `src/features/agents/sub_design/phases/DesignPhasePanel.tsx`
- `src/features/agents/sub_design/phases/DesignPhasePanelSaved.tsx`
- `src/features/agents/sub_design/phases/DesignPhasePreview.tsx`
- `src/features/agents/sub_design/phases/DesignPhaseRefining.tsx`
- `src/features/agents/sub_design/index.ts`
- `src/features/agents/sub_tool_runner/components/ToolRunnerPanel.tsx`
- `src/features/agents/sub_tool_runner/components/ToolRunnerModal.tsx`
- `src/features/agents/sub_tool_runner/components/ToolInvocationCard.tsx`
- `src/features/agents/sub_tool_runner/libs/useToolRunner.ts`
- `src/features/agents/sub_tool_runner/index.ts`

**Entry points:** src/features/agents/sub_design/DesignTab.tsx, src/features/agents/sub_design/libs/useDesignTabState.ts, src/features/agents/sub_tool_runner/components/ToolRunnerPanel.tsx

**Keywords:** design, conversation, AI, phase, analyze, refine, preview, apply, parameters, prompt, tool, runner

**API surface:** run_design_session, apply_design

**Tech stack:** React 19, TypeScript, Zustand 5, Tauri 2

---

### capability-config-view

Capability-centric persona creation view used in the new-persona wizard. Organises capabilities into expandable rows (each with header, summary, and pane tabs for connectors, events, policies, and trigger) and provides a modal for adding new capabilities. The capabilityHelpers utility derives the row data from the raw capability definition.

**Files:**
- `src/features/agents/sub_new_persona/capabilityView/CapabilityAddModal.tsx`
- `src/features/agents/sub_new_persona/capabilityView/CapabilityChip.tsx`
- `src/features/agents/sub_new_persona/capabilityView/CapabilityRow.tsx`
- `src/features/agents/sub_new_persona/capabilityView/CapabilityRowHeader.tsx`
- `src/features/agents/sub_new_persona/capabilityView/CapabilityRowSummary.tsx`
- `src/features/agents/sub_new_persona/capabilityView/CapabilityRowTabs.tsx`
- `src/features/agents/sub_new_persona/capabilityView/capabilityHelpers.ts`
- `src/features/agents/sub_new_persona/capabilityView/panes/CapabilityConnectorsPane.tsx`
- `src/features/agents/sub_new_persona/capabilityView/panes/CapabilityEventsPane.tsx`
- `src/features/agents/sub_new_persona/capabilityView/panes/CapabilityPoliciesPane.tsx`
- `src/features/agents/sub_new_persona/capabilityView/panes/CapabilityTriggerPane.tsx`
- `src/features/agents/sub_new_persona/capabilityView/index.ts`

**Entry points:** src/features/agents/sub_new_persona/capabilityView/CapabilityRow.tsx

**Keywords:** capability, pane, connector, event, policy, trigger, wizard, new-persona

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### engine-build-session

Quality-gating layer inside build sessions: the Rule 16/17 state machine that enforces tool-test and connector-validation gates before promotion, the fix-pass that auto-patches failing steps, the LLM-driven pre-promote test runner, and the system prompt and template-context assemblers that give the build LLM its reference materials. Also includes the stream-JSON parser that translates raw CLI output into typed BuildEvents. [Consolidated 2026-08-04: absorbed build-session-lifecycle, a2a-gateway, cli-session-awareness, http-inference-engine, platform-adapters, ai-provider-layer]

**Files:**
- `src-tauri/src/engine/build_session/gates.rs`
- `src-tauri/src/engine/build_session/fix_pass.rs`
- `src-tauri/src/engine/build_session/tool_tests.rs`
- `src-tauri/src/engine/build_session/parser.rs`
- `src-tauri/src/engine/build_session/session_prompt.rs`
- `src-tauri/src/engine/build_session/templates.rs`
- `src-tauri/src/engine/build_session/reference.rs`
- `src-tauri/src/engine/build_session/mod.rs`
- `src-tauri/src/engine/build_session/runner.rs`
- `src-tauri/src/engine/build_session/orchestrator.rs`
- `src-tauri/src/engine/build_session/events.rs`
- `src-tauri/src/engine/build_session/fanout.rs`
- `src-tauri/src/engine/build_session/oneshot.rs`
- `src-tauri/engine/src/a2a/mod.rs`
- `src-tauri/engine/src/a2a/types.rs`
- `src-tauri/engine/src/cli_session_awareness/mod.rs`
- `src-tauri/engine/src/cli_session_awareness/discovery.rs`
- `src-tauri/engine/src/cli_session_awareness/render.rs`
- `src-tauri/engine/src/cli_session_awareness/transcript.rs`
- `src-tauri/engine/src/cli_session_audit_repo.rs`
- `src-tauri/src/engine/http_engine/mod.rs`
- `src-tauri/src/engine/http_engine/config.rs`
- `src-tauri/src/engine/http_engine/events.rs`
- `src-tauri/src/engine/http_engine/openai.rs`
- `src-tauri/src/engine/http_engine/secrets.rs`
- `src-tauri/src/engine/http_engine/tools.rs`
- `src-tauri/src/engine/platforms/mod.rs`
- `src-tauri/src/engine/platforms/deploy.rs`
- `src-tauri/src/engine/platforms/github.rs`
- `src-tauri/src/engine/platforms/n8n.rs`
- `src-tauri/src/engine/platforms/zapier.rs`
- `src-tauri/engine/src/provider/mod.rs`
- `src-tauri/engine/src/provider/claude.rs`

**Entry points:** src-tauri/src/engine/build_session/gates.rs, src-tauri/src/engine/build_session/session_prompt.rs, src-tauri/src/engine/build_session/mod.rs

**Keywords:** gate, promotion, tool tests, fix pass, system prompt, template, parser, build event, quality, build session, multi-turn, interactive

**API surface:** run_tool_tests (internal)

**Tech stack:** Rust, Tokio

---

### hooks-design

The central hooks powering AI-driven persona design: streaming Tauri output during analysis, compiling natural-language intent into persona configurations, running automation design, maintaining a playbook cache, managing multi-turn design conversations, and orchestrating background preview/rebuild cycles. useDesignAnalysis is the foundational hook; usePersonaCompiler wraps it with compiler-stage semantics; useTauriStream provides the raw streaming plumbing. [Consolidated 2026-08-04: absorbed credential-design-hooks, oauth-flow-hooks, template-recipe-hooks, database-explorer-hooks]

**Files:**
- `src/hooks/design/core/useDesignAnalysis.ts`
- `src/hooks/design/core/usePersonaCompiler.ts`
- `src/hooks/design/core/useAiSearch.ts`
- `src/hooks/design/core/useAutomationDesign.ts`
- `src/hooks/design/core/useDesignContextMutator.ts`
- `src/hooks/design/core/useDesignConversation.ts`
- `src/hooks/design/core/useAiArtifactTask.ts`
- `src/hooks/design/core/playbookCache.ts`
- `src/hooks/design/core/useTauriStream.ts`
- `src/hooks/design/core/useBackgroundPreview.ts`
- `src/hooks/design/core/useBackgroundRebuild.ts`
- `src/hooks/design/credential/useCredentialDesign.ts`
- `src/hooks/design/credential/useCredentialNegotiator.ts`
- `src/hooks/design/credential/useCredentialForaging.ts`
- `src/hooks/design/credential/applyDesignResult.ts`
- `src/hooks/design/credential/negotiatorStepGraph.ts`
- `src/hooks/design/oauth/useOAuthProtocol.ts`
- `src/hooks/design/oauth/useOAuthPolling.ts`
- `src/hooks/design/oauth/useOAuthConsent.ts`
- `src/hooks/design/oauth/useUniversalOAuth.ts`
- `src/hooks/design/template/useTemplateGallery.ts`
- `src/hooks/design/template/useGalleryQuery.ts`
- `src/hooks/design/template/useDesignReviews.ts`
- `src/hooks/design/template/useRecipeExecution.ts`
- `src/hooks/design/template/useRecipeGenerator.ts`
- `src/hooks/design/template/useRecipeVersioning.ts`
- `src/hooks/design/template/useAiArtifactFlow.ts`
- `src/hooks/design/template/useTemplatePerformance.ts`
- `src/hooks/design/__tests__/useDesignReviews.test.ts`
- `src/hooks/database/useTableIntrospection.ts`
- `src/hooks/database/sqlStatementSplitter.ts`
- `src/hooks/database/useSchemaProposal.ts`
- `src/hooks/database/useQueryDebug.ts`
- `src/hooks/database/__tests__/sqlStatementSplitter.test.ts`

**Entry points:** src/hooks/design/core/usePersonaCompiler.ts, src/hooks/design/core/useDesignAnalysis.ts, src/hooks/design/core/useTauriStream.ts

**Keywords:** persona-compiler, design-analysis, AI, streaming, playbook, automation-design, artifact, conversation, background-preview, credential, negotiator, foraging

**API surface:** Tauri commands: start_design_analysis, refine_analysis, apply_result, cancel_analysis

**Tech stack:** React 19, TypeScript, Tauri 2, Zustand 5

---

### persona-build-matrix

The build matrix panel where the system assembles a persona from capabilities, model config, and connectors into a runnable agent. Includes the unified build entry, behavior core editor, build context field, simulation preview, template confidence scoring, shared resources panel, and lifecycle/build hooks. Tests cover template matching confidence and the cancel-build flow.

**Files:**
- `src/features/agents/components/matrix/UnifiedBuildEntry.tsx`
- `src/features/agents/components/matrix/BehaviorCoreEditor.tsx`
- `src/features/agents/components/matrix/BuildContextField.tsx`
- `src/features/agents/components/matrix/BuildSimulatePanel.tsx`
- `src/features/agents/components/matrix/BuildTemplateSuggestion.tsx`
- `src/features/agents/components/matrix/buildTemplateMatchConfidence.ts`
- `src/features/agents/components/matrix/SharedResourcesPanel.tsx`
- `src/features/agents/components/matrix/useBuild.ts`
- `src/features/agents/components/matrix/useLifecycle.ts`

**Entry points:** src/features/agents/components/matrix/UnifiedBuildEntry.tsx, src/features/agents/components/matrix/useBuild.ts

**Keywords:** build, matrix, template, confidence, simulate, lifecycle, behavior, resources

**API surface:** build_persona, cancel_build, list_templates

**Tech stack:** React 19, TypeScript, Zustand 5, Tauri 2

---

### pipeline-and-automation

Runs multi-persona team pipeline graphs node-by-node (topological sort, predecessor tracking, conditional branching) and executes scheduled automation actions that are not persona executions. The pipeline executor auto-creates team memories from node outputs; the automation runner dispatches to platform-specific adapters (GitHub Actions, n8n, Zapier) on a schedule. [Consolidated 2026-08-04: absorbed credential-negotiation, failure-triage, knowledge-base-pipeline, local-ai-integrations, p2p-identity-enclave, persona-compilers, persona-design-engine]

**Files:**
- `src-tauri/src/engine/pipeline_executor.rs`
- `src-tauri/src/engine/automation_runner.rs`
- `src-tauri/engine/src/credential_design.rs`
- `src-tauri/engine/src/credential_negotiator.rs`
- `src-tauri/engine/src/failure_signature.rs`
- `src-tauri/engine/src/auto_triage.rs`
- `src-tauri/src/engine/kb_ingest.rs`
- `src-tauri/src/engine/kb_extract.rs`
- `src-tauri/engine/src/ollama.rs`
- `src-tauri/engine/src/scraper.rs`
- `src-tauri/engine/src/identity.rs`
- `src-tauri/engine/src/enclave.rs`
- `src-tauri/engine/src/compiler.rs`
- `src-tauri/engine/src/intent_compiler.rs`
- `src-tauri/engine/src/design.rs`
- `src-tauri/engine/src/design_context.rs`

**Entry points:** src-tauri/src/engine/pipeline_executor.rs, src-tauri/src/engine/automation_runner.rs, src-tauri/engine/src/credential_negotiator.rs

**Keywords:** pipeline, team, DAG, automation, scheduling, node, step, conditional, branch, credential, connector, negotiation

**API surface:** execute_pipeline_graph (internal)

**Tech stack:** Rust, Tokio, SQLite (rusqlite)

---

### studio

Multi-project lifecycle management: a browser-style tab strip (StudioTabBar) showing live status dots per open project with a picker for new/import/re-open, a vision-phase onboarding screen (StudioVisionStart) with prompt starters that seed the initial Athena build session, a version history panel (StudioVersions) that lists build-turn git snapshots and restores them safely, and a global attention pill (StudioAttention) that surfaces across the app when Athena is waiting for a decision in a Studio project the user isn't currently viewing. [Consolidated 2026-08-04: absorbed studio-build-controls, studio-chat, studio-core, studio-plan, triggers-page-shell]

**Files:**
- `src/features/studio/StudioTabBar.tsx`
- `src/features/studio/StudioVisionStart.tsx`
- `src/features/studio/StudioVersions.tsx`
- `src/features/studio/StudioAttention.tsx`
- `src/features/studio/StudioBuildSettings.tsx`
- `src/features/studio/StudioDesignKnobs.tsx`
- `src/features/studio/StudioChatInput.tsx`
- `src/features/studio/StudioMessages.tsx`
- `src/features/studio/StudioDecision.tsx`
- `src/features/studio/StudioQuickActions.tsx`
- `src/features/studio/studioStore.ts`
- `src/features/studio/studioHistory.ts`
- `src/features/studio/studioBuildModel.ts`
- `src/features/studio/StudioPage.tsx`
- `src/features/studio/StudioPlanDrawer.tsx`
- `src/features/studio/StudioChecklistStepper.tsx`
- `src/features/studio/PlanGlyph.tsx`
- `src/features/studio/planGlyphData.ts`
- `src/features/triggers/TriggersPage.tsx`

**Entry points:** src/features/studio/StudioTabBar.tsx, src/features/studio/StudioVisionStart.tsx, src/features/studio/StudioBuildSettings.tsx

**Keywords:** tabs, projects, version-history, restore, attention, vision, onboarding, import, scaffold, git, effort, style

**API surface:** webbuildListVersions, webbuildRestoreVersion, webbuildBunStatus, webbuildNextReady

**Tech stack:** React 19, TypeScript, Tauri 2, Zustand 5, Tailwind 4

---

## Shared UI Components

> **Group type:** shared
> **Color:** blue

### display-data-formatters

Read-only display primitives for time and numeric data: RelativeTime (live 'Xh ago', absolute on hover), AbsoluteTime (fixed date/time/datetime with relative hover), Numeric (canonical locale/precision/unit number renderer), UuidLabel, Tooltip (hover/focus), TruncateWithTooltip (overflow text + full value tooltip), and SectionLabel (uppercase section heading). These are the blessed alternatives to ad-hoc .toLocaleString() or title= calls. [Consolidated 2026-08-04: absorbed display-metrics-counters, display-collapse-inline, modal-overlay-dispatch, terminal-ui]

**Files:**
- `src/features/shared/components/display/RelativeTime.tsx`
- `src/features/shared/components/display/AbsoluteTime.tsx`
- `src/features/shared/components/display/Numeric.tsx`
- `src/features/shared/components/display/UuidLabel.tsx`
- `src/features/shared/components/display/Tooltip.tsx`
- `src/features/shared/components/display/TruncateWithTooltip.tsx`
- `src/features/shared/components/display/SectionLabel.tsx`
- `src/features/shared/components/display/__tests__/Numeric.test.tsx`
- `src/features/shared/components/display/StatCard.tsx`
- `src/features/shared/components/display/AnimatedCounter.tsx`
- `src/features/shared/components/display/SpringCount.tsx`
- `src/features/shared/components/display/ConfidenceArc.tsx`
- `src/features/shared/components/display/AnimatedList.tsx`
- `src/features/shared/components/display/RevealItem.tsx`
- `src/features/shared/charts/RechartsWrapper.tsx`
- `src/features/shared/components/display/Collapse.tsx`
- `src/features/shared/components/display/Collapse.test.tsx`
- `src/features/shared/components/display/InlineEditableText.tsx`
- `src/features/shared/components/display/connectorRunnability.ts`
- `src/features/shared/components/display/FieldHint.tsx`
- `src/features/shared/components/modals/index.ts`
- `src/features/shared/components/overlays/ConfirmDestructiveModal.tsx`
- `src/features/shared/components/overlays/FilterBar.tsx`
- `src/features/shared/components/overlays/FirstUseConsentModal.tsx`
- `src/features/shared/components/overlays/QuickEditPopover.tsx`
- `src/features/shared/components/overlays/UnsavedChangesModal.tsx`
- `src/features/shared/dispatch/DispatchChooser.tsx`
- `src/features/shared/components/terminal/CliOutputPanel.tsx`
- `src/features/shared/components/terminal/TerminalBody.tsx`
- `src/features/shared/components/terminal/TerminalHeader.tsx`
- `src/features/shared/components/terminal/TerminalSearchBar.tsx`
- `src/features/shared/components/terminal/TerminalStrip.tsx`

**Entry points:** src/features/shared/components/display/RelativeTime.tsx, src/features/shared/components/display/Numeric.tsx, src/features/shared/components/display/Tooltip.tsx

**Keywords:** time, relative time, numeric, tooltip, uuid, truncate, locale, format, stat, KPI, metric, counter

**Tech stack:** React 19, TypeScript

---

### display-table-primitives

Full suite of table and list layout primitives: UnifiedTable (standard sortable table), SortableHeader (clickable column with sort indicator), ColumnResize (drag handle), DataGrid (CSS-grid fraction layout), DragHandle (grip icon), DropIndicator (DnD position indicator), ScrollShadowContainer (overflow fade), FacetedDecisionTable (slash-path facet tree + toolbar + grid), GroupedVirtualList (virtualized sticky-header grouped list), and their pure model/grouping logic and tests. [Consolidated 2026-08-04: absorbed display-motion-empty, display-status-badges]

**Files:**
- `src/features/shared/components/display/UnifiedTable.tsx`
- `src/features/shared/components/display/SortableHeader.tsx`
- `src/features/shared/components/display/__tests__/SortableHeader.test.tsx`
- `src/features/shared/components/display/ColumnResize.tsx`
- `src/features/shared/components/display/DataGrid.tsx`
- `src/features/shared/components/display/DragHandle.tsx`
- `src/features/shared/components/display/DropIndicator.tsx`
- `src/features/shared/components/display/ScrollShadowContainer.tsx`
- `src/features/shared/components/display/FacetedDecisionTable.tsx`
- `src/features/shared/components/display/GroupedVirtualList.tsx`
- `src/features/shared/components/display/facetedTableModel.ts`
- `src/features/shared/components/display/__tests__/facetedTableModel.test.ts`
- `src/features/shared/components/display/grouping.ts`
- `src/features/shared/components/display/__tests__/grouping.test.ts`
- `src/features/shared/components/display/MotionizedGlyph.tsx`
- `src/features/shared/components/display/__tests__/MotionizedGlyph.test.tsx`
- `src/features/shared/components/display/motionPresets.ts`
- `src/features/shared/components/display/EmptyIllustration.tsx`
- `src/features/shared/components/display/IllustratedEmptyState.tsx`
- `src/features/shared/components/display/ChartEmptyState.tsx`
- `src/features/shared/components/display/HeroMesh.tsx`
- `src/features/shared/components/display/DensityToggle.tsx`
- `src/features/shared/components/display/DesignConnectorGrid.tsx`
- `src/features/shared/components/display/StatusBadge.tsx`
- `src/features/shared/components/display/StatusDot.tsx`
- `src/features/shared/components/display/StatusShape.tsx`
- `src/features/shared/components/display/ActivityDot.tsx`
- `src/features/shared/components/display/LiveStatusDot.tsx`
- `src/features/shared/components/display/Badge.tsx`
- `src/features/shared/components/display/BusinessOutcomeBadge.tsx`
- `src/features/shared/components/display/CategoryChip.tsx`
- `src/features/shared/components/icons/ActivityPulseIcon.tsx`

**Entry points:** src/features/shared/components/display/UnifiedTable.tsx, src/features/shared/components/display/FacetedDecisionTable.tsx, src/features/shared/components/display/GroupedVirtualList.tsx

**Keywords:** table, sort, drag, drop, virtual list, facet, column resize, grid, grouping, motion, animation, empty state

**Tech stack:** React 19, TypeScript

---

### feedback-primitives

All user-facing feedback and error-state components: LoadingSpinner (canonical spinner with a11y label), ErrorBoundary (React error boundary with dashboard recovery), ErrorBanner (inline/banner/panel with retry+dismiss), ErrorRecoveryBanner, InlineErrorBanner, Banner (info/warn/error), ConfirmDialog (confirm/cancel for destructive actions), SuspenseFallback, Reveal (fade+slide-up mount transition), StalenessIndicator, ScenarioEmptyState, DropZoneGlow, ConnectionStatusBadge, and AriaLiveProvider.

**Files:**
- `src/features/shared/components/feedback/LoadingSpinner.tsx`
- `src/features/shared/components/feedback/ErrorBoundary.tsx`
- `src/features/shared/components/feedback/ErrorBanner.tsx`
- `src/features/shared/components/feedback/ErrorRecoveryBanner.tsx`
- `src/features/shared/components/feedback/InlineErrorBanner.tsx`
- `src/features/shared/components/feedback/Banner.tsx`
- `src/features/shared/components/feedback/ConfirmDialog.tsx`
- `src/features/shared/components/feedback/SuspenseFallback.tsx`
- `src/features/shared/components/feedback/Reveal.tsx`
- `src/features/shared/components/feedback/StalenessIndicator.tsx`
- `src/features/shared/components/feedback/ScenarioEmptyState.tsx`
- `src/features/shared/components/feedback/DropZoneGlow.tsx`
- `src/features/shared/components/feedback/ConnectionStatusBadge.tsx`
- `src/features/shared/components/feedback/AriaLiveProvider.tsx`

**Entry points:** src/features/shared/components/feedback/LoadingSpinner.tsx, src/features/shared/components/feedback/ErrorBanner.tsx, src/features/shared/components/feedback/ConfirmDialog.tsx

**Keywords:** loading, error, empty state, spinner, banner, confirm, aria, reveal, suspense, stale

**Tech stack:** React 19, TypeScript, Tailwind 4

---

### lib-types

Shared type definitions for team configuration, design review workflows, and persona templates. teamConfigTypes.ts covers team goal structures and workspace settings; designTypes.ts defines the DesignReview lifecycle and scoring model; templateTypes.ts declares the template schema consumed by the Build Studio's template picker and recipe system. [Consolidated 2026-08-04: absorbed build-session-types, composition-workflow-types, core-persona-types, frontend-model-types, infrastructure-primitive-types, schedule-types]

**Files:**
- `src/lib/types/teamConfigTypes.ts`
- `src/lib/types/designTypes.ts`
- `src/lib/types/templateTypes.ts`
- `src/lib/types/buildTypes.ts`
- `src/lib/types/compositionTypes.ts`
- `src/lib/types/types.ts`
- `src/lib/types/frontendTypes.ts`
- `src/lib/types/tauriError.ts`
- `src/lib/types/timeRange.ts`
- `src/lib/types/terminalEvents.ts`
- `src/lib/types/schedule.ts`
- `src/lib/types/__tests__/schedule.test.ts`

**Entry points:** src/lib/types/teamConfigTypes.ts, src/lib/types/designTypes.ts, src/lib/types/templateTypes.ts

**Keywords:** team, design-review, template, goal, workspace, scoring, recipe, configuration, build, phase, capability, matrix

**Tech stack:** TypeScript

---

### lib-utils

Canonical cron preset list and day-of-week vocabulary shared across all scheduling UIs (agent use-cases, trigger configuration, schedule pickers). Consolidates three previously divergent copies with conflicting Mon=0 vs Mon=1 conventions. The triggerConstants module extends this with trigger-type icons, colors, and category taxonomy. [Consolidated 2026-08-04: absorbed animation-motion, crash-persistence, design-tokens, fetch-deduplication-cache, formatters-and-display, store-performance, tauri-ipc-utils]

**Files:**
- `src/lib/utils/cronPresets.ts`
- `src/lib/utils/dayOfWeek.ts`
- `src/lib/utils/platform/triggerConstants.ts`
- `src/lib/utils/rafAnimationEngine.ts`
- `src/lib/utils/animation/animationPresets.ts`
- `src/lib/utils/interaction/rafCoalescer.ts`
- `src/lib/utils/crashPersistence.ts`
- `src/lib/utils/designTokens.ts`
- `src/lib/utils/colorWithAlpha.ts`
- `src/lib/utils/deduplicateFetch.ts`
- `src/lib/utils/staleWhileRevalidate.ts`
- `src/lib/utils/formatters.ts`
- `src/lib/utils/terminalColors.ts`
- `src/lib/utils/parseJson.ts`
- `src/lib/utils/storePerf.ts`
- `src/lib/utils/tauri/safeInvoke.ts`
- `src/lib/utils/apiError.ts`

**Entry points:** src/lib/utils/cronPresets.ts, src/lib/utils/platform/triggerConstants.ts, src/lib/utils/rafAnimationEngine.ts

**Keywords:** cron, schedule, day-of-week, trigger, preset, frequency, webhook, polling, animation, RAF, framer-motion, spring

**Tech stack:** TypeScript, Lucide React

---

### progress-transform

Multi-phase progress and data-transform UI used during import and pipeline flows: AnalysisModeView and TransformModeView (the two phases of an import), TransformProgress and TransformStatusPanels (progress display and per-step status), EstimatedProgressBar (colour-ramp bar: primary at low %, accent near complete), WizardStepper (multi-step indicator), ContentLoader (generic loading state), a phase-detection pure-logic module, and shared transform progress types.

**Files:**
- `src/features/shared/components/progress/AnalysisModeView.tsx`
- `src/features/shared/components/progress/ContentLoader.tsx`
- `src/features/shared/components/progress/EstimatedProgressBar.tsx`
- `src/features/shared/components/progress/TerminalBody.tsx`
- `src/features/shared/components/progress/TransformModeView.tsx`
- `src/features/shared/components/progress/TransformProgress.tsx`
- `src/features/shared/components/progress/TransformStatusPanels.tsx`
- `src/features/shared/components/progress/WizardStepper.tsx`
- `src/features/shared/components/progress/phaseDetection.ts`
- `src/features/shared/components/progress/transformProgressTypes.ts`

**Entry points:** src/features/shared/components/progress/TransformProgress.tsx, src/features/shared/components/progress/phaseDetection.ts

**Keywords:** progress, transform, import, wizard, phase, pipeline, status panels, progress bar

**Tech stack:** React 19, TypeScript

---

### shared-chrome

Two-level collapsible sidebar with icon rail (L1) and label-level nav (L2), section badges, tier gates, and group nav. Persists collapsed state in localStorage and adapts for mobile. Section-specific sub-navs for Agents, Plugins, and Teams inject domain content into the L2 slot, while BadgeSlot and OrbitDots supply unread-count and active-item decoration. [Consolidated 2026-08-04: absorbed background-fleet-chrome, command-palette, footer-and-notifications, window-chrome]

**Files:**
- `src/features/shared/chrome/sidebar/Sidebar.tsx`
- `src/features/shared/chrome/sidebar/SidebarLevel1.tsx`
- `src/features/shared/chrome/sidebar/SidebarLevel2.tsx`
- `src/features/shared/chrome/sidebar/SidebarGroupNav.tsx`
- `src/features/shared/chrome/sidebar/SidebarIcons.tsx`
- `src/features/shared/chrome/sidebar/SidebarSubNav.ts`
- `src/features/shared/chrome/sidebar/BadgeSlot.tsx`
- `src/features/shared/chrome/sidebar/OrbitDots.tsx`
- `src/features/shared/chrome/sidebar/sidebarData.ts`
- `src/features/shared/chrome/sidebar/sections/AgentsSidebarNav.tsx`
- `src/features/shared/chrome/sidebar/sections/PluginsSidebarNav.tsx`
- `src/features/shared/chrome/sidebar/sections/TeamsSidebarNav.tsx`
- `src/features/shared/chrome/BackgroundServices.tsx`
- `src/features/shared/chrome/FleetActivityStrip.tsx`
- `src/features/shared/chrome/fleetStripModel.ts`
- `src/features/shared/chrome/fleetStripModel.test.ts`
- `src/features/shared/chrome/UpdateBanner.tsx`
- `src/features/shared/chrome/CliReadinessBanner.tsx`
- `src/features/shared/chrome/CommandPalette.tsx`
- `src/features/shared/chrome/CommandPaletteResults.tsx`
- `src/features/shared/chrome/commandPaletteUtils.ts`
- `src/features/shared/chrome/commandPaletteUtils.test.ts`
- `src/features/shared/chrome/DesktopFooter.tsx`
- `src/features/shared/chrome/FooterSectionNav.tsx`
- `src/features/shared/chrome/SystemLoadFooterIcon.tsx`
- `src/features/shared/chrome/__tests__/FooterSectionNav.test.tsx`
- `src/features/shared/chrome/notifications/NotificationCenter.tsx`
- `src/features/shared/chrome/ToastContainer.tsx`
- `src/features/shared/chrome/useToastTimer.ts`
- `src/features/shared/chrome/TitleBar.tsx`
- `src/features/shared/chrome/TitleBarAmbient.tsx`
- `src/features/shared/chrome/TitleBarDock.tsx`
- `src/features/shared/chrome/BreadcrumbTrail.tsx`
- `src/features/shared/chrome/useTitleBarTray.tsx`

**Entry points:** src/features/shared/chrome/sidebar/Sidebar.tsx, src/features/shared/chrome/sidebar/sidebarData.ts, src/features/shared/chrome/BackgroundServices.tsx

**Keywords:** sidebar, navigation, menu, collapse, badge, tier gate, agents, plugins, teams, sub-nav, fleet, background services

**Tech stack:** React 19, TypeScript, Zustand 5

---

### shared-components-forms

Specialized and design-system-specific form controls: DesignInput (styled design-system text input) and DesignInputAttachments, DirectoryPickerInput (Tauri native directory picker), ColorPicker and PopupColorPicker, SortableColumnHeader (draggable column management), TableSelector (table-based multi-select), ThemedSelect (styled select), ColumnDropdownFilter, SettingRow (label+description+toggle row for settings panels), SuccessCheck (animated SVG check), and positioning/portal hooks. [Consolidated 2026-08-04: absorbed form-input-controls, form-validation]

**Files:**
- `src/features/shared/components/forms/DesignInput.tsx`
- `src/features/shared/components/forms/DesignInputAttachments.tsx`
- `src/features/shared/components/forms/designInputHelpers.ts`
- `src/features/shared/components/forms/DirectoryPickerInput.tsx`
- `src/features/shared/components/forms/ColorPicker.tsx`
- `src/features/shared/components/forms/PopupColorPicker.tsx`
- `src/features/shared/components/forms/SortableColumnHeader.tsx`
- `src/features/shared/components/forms/TableSelector.tsx`
- `src/features/shared/components/forms/ThemedSelect.tsx`
- `src/features/shared/components/forms/ColumnDropdownFilter.tsx`
- `src/features/shared/components/forms/SettingRow.tsx`
- `src/features/shared/components/forms/SuccessCheck.tsx`
- `src/features/shared/components/forms/useAnchoredPortalPosition.ts`
- `src/features/shared/components/forms/FormField.tsx`
- `src/features/shared/components/forms/FormFieldGroup.tsx`
- `src/features/shared/components/forms/Listbox.tsx`
- `src/features/shared/components/forms/NumberStepper.tsx`
- `src/features/shared/components/forms/__tests__/NumberStepper.test.tsx`
- `src/features/shared/components/forms/Slider.tsx`
- `src/features/shared/components/forms/__tests__/Slider.test.tsx`
- `src/features/shared/components/forms/AccessibleToggle.tsx`
- `src/features/shared/components/forms/KeyValueEditor.tsx`
- `src/features/shared/components/forms/PasswordToggleField.tsx`
- `src/features/shared/components/forms/PillGroup.tsx`
- `src/features/shared/components/forms/FormErrorContext.tsx`
- `src/features/shared/components/forms/FormErrorSummary.tsx`
- `src/features/shared/components/forms/__tests__/FormErrorSummary.test.tsx`
- `src/features/shared/components/forms/CharBudget.tsx`
- `src/features/shared/components/forms/useAsyncFieldValidation.ts`
- `src/features/shared/components/forms/__tests__/useAsyncFieldValidation.test.ts`
- `src/features/shared/components/forms/useFieldValidation.ts`
- `src/features/shared/components/forms/useShakeError.ts`

**Entry points:** src/features/shared/components/forms/DesignInput.tsx, src/features/shared/components/forms/ColorPicker.tsx, src/features/shared/components/forms/FormField.tsx

**Keywords:** design input, color picker, directory picker, select, column filter, settings row, portal, anchored, form, input, dropdown, toggle

**Tech stack:** React 19, TypeScript, Tauri 2, Tailwind 4

---

### shared-components-layout

Core page and panel layout primitives: ContentLayout (standard content area shell), ActionRow (horizontal filter/status toolbar), PanelTabBar (in-panel tab bar), SegmentedTabs (pill tab switcher), SectionCard (card with header/status-border/collapse), SectionHeader (icon+title+badge+trailing actions), SectionHeading, FullScreenOverlay, ReasoningTrace (expandable AI reasoning display), VibeThemeProvider (persona-derived CSS custom properties), KanbanBoard (generic HTML5 drag-to-move status columns), and the systemLoad pure EMA/hysteresis module. [Consolidated 2026-08-04: absorbed layout-skeleton-settings, button-primitives, decision-review, editor-components]

**Files:**
- `src/features/shared/components/layout/ContentLayout.tsx`
- `src/features/shared/components/layout/ActionRow.tsx`
- `src/features/shared/components/layout/PanelTabBar.tsx`
- `src/features/shared/components/layout/SegmentedTabs.tsx`
- `src/features/shared/components/layout/SectionCard.tsx`
- `src/features/shared/components/layout/SectionHeader.tsx`
- `src/features/shared/components/layout/SectionHeading.tsx`
- `src/features/shared/components/layout/FullScreenOverlay.tsx`
- `src/features/shared/components/layout/ReasoningTrace.tsx`
- `src/features/shared/components/layout/VibeThemeProvider.tsx`
- `src/features/shared/components/layout/systemLoad.ts`
- `src/features/shared/components/layout/systemLoad.test.ts`
- `src/features/shared/components/kanban/KanbanBoard.tsx`
- `src/features/shared/components/layout/ContentHeaderSkeleton.tsx`
- `src/features/shared/components/layout/ListSkeleton.tsx`
- `src/features/shared/components/layout/TableSkeleton.tsx`
- `src/features/shared/components/layout/RouteChunkSkeleton.tsx`
- `src/features/shared/components/layout/DeferUntilIdle.tsx`
- `src/features/shared/components/layout/DeferUntilIdle.test.tsx`
- `src/features/shared/components/layout/settings/SettingsScaffold.tsx`
- `src/features/shared/components/layout/settings/useSectionScrollSpy.ts`
- `src/features/shared/components/buttons/Button.tsx`
- `src/features/shared/components/buttons/AsyncButton.tsx`
- `src/features/shared/components/buttons/CopyButton.tsx`
- `src/features/shared/components/buttons/index.ts`
- `src/features/shared/components/buttons/Button.test.tsx`
- `src/features/shared/components/decisions/DecisionActions.tsx`
- `src/features/shared/components/decisions/DecisionRow.tsx`
- `src/features/shared/components/decisions/decisionTypes.ts`
- `src/features/shared/components/editors/JsonEditor.tsx`
- `src/features/shared/components/editors/MarkdownRenderer.tsx`
- `src/features/shared/components/editors/PromptTabsPreview.tsx`
- `src/features/shared/components/editors/PromptTemplateRenderer.tsx`

**Entry points:** src/features/shared/components/layout/ContentLayout.tsx, src/features/shared/components/layout/SectionCard.tsx, src/features/shared/components/layout/PanelTabBar.tsx

**Keywords:** layout, tabs, card, section, kanban, overlay, reasoning trace, theme, vibe, system load, skeleton, loading placeholder

**Tech stack:** React 19, TypeScript, Tailwind 4

---

## Database Infrastructure

> **Group type:** infrastructure
> **Color:** blue

### db

Provides reusable query-builder helpers, shared macros for CRUD code generation, and row-mapper utilities that reduce boilerplate across all repository modules. Also includes performance measurement helpers for tracking query latency. These primitives are the foundation for the entire repository layer. [Consolidated 2026-08-04: absorbed builtin-connector-seed, chain-byom-repo, change-data-capture, credential-fields, db-backup, db-pool-init, model-routing, vector-store]

**Files:**
- `src-tauri/db/src/query_builder.rs`
- `src-tauri/db/src/macros.rs`
- `src-tauri/db/src/perf.rs`
- `src-tauri/db/src/builtin_connectors.rs`
- `src-tauri/db/src/builtin_shared_events.rs`
- `src-tauri/db/src/chain.rs`
- `src-tauri/db/src/byom.rs`
- `src-tauri/db/src/repos/execution/knowledge.rs`
- `src-tauri/db/src/cdc.rs`
- `src-tauri/db/src/credential_fields.rs`
- `src-tauri/db/src/settings_keys.rs`
- `src-tauri/db/src/backup.rs`
- `src-tauri/db/src/lib.rs`
- `src-tauri/db/src/model_routing.rs`
- `src-tauri/db/src/vector_store.rs`
- `src-tauri/db/src/embedder.rs`

**Entry points:** src-tauri/db/src/macros.rs, src-tauri/db/src/query_builder.rs, src-tauri/db/src/builtin_connectors.rs

**Keywords:** query-builder, macros, CRUD, row-mapper, performance, boilerplate, utilities, connectors, builtin, seed, templates, shared-events

**Tech stack:** Rust, rusqlite

---

### db-repos

Repositories for Athena's Developer Tools plugin — dev memories (long-term learnings about codebases), dev run checkpoints (state between multi-step CLI sessions), and the dev tools backlog (capability gaps and self-promises Athena tracks). Enables Athena to maintain context across multiple autonomous development sessions. [Consolidated 2026-08-04: absorbed companion-brain-repo, execution-metrics-repo, fleet-sessions-repo, repos-shared-utilities, workspace-taxonomy-repo, db-migrations-incremental, db-migrations-schema]

**Files:**
- `src-tauri/db/src/repos/dev_memories.rs`
- `src-tauri/db/src/repos/dev_memories_tests.rs`
- `src-tauri/db/src/repos/dev_run_checkpoints.rs`
- `src-tauri/db/src/repos/dev_tools.rs`
- `src-tauri/db/src/repos/dev_tools_backlog_tests.rs`
- `src-tauri/db/src/repos/dev_tools_page_tests.rs`
- `src-tauri/db/src/repos/twin.rs`
- `src-tauri/db/src/repos/research_lab.rs`
- `src-tauri/db/src/repos/execution/metrics.rs`
- `src-tauri/db/src/repos/llm_spend.rs`
- `src-tauri/db/src/repos/run_budget.rs`
- `src-tauri/db/src/repos/fleet_sessions.rs`
- `src-tauri/db/src/repos/fleet_decisions.rs`
- `src-tauri/db/src/repos/mod.rs`
- `src-tauri/db/src/repos/utils.rs`
- `src-tauri/db/src/repos/system_ops.rs`
- `src-tauri/db/src/repos/test_fixtures.rs`
- `src-tauri/db/src/repos/workspace_taxonomy.rs`
- `src-tauri/db/src/repos/dev_workspaces.rs`
- `src-tauri/db/src/migrations/incremental.rs`
- `src-tauri/db/src/migrations/fk_hygiene.rs`
- `src-tauri/db/src/migrations/helpers.rs`
- `src-tauri/db/src/migrations/schema.rs`
- `src-tauri/db/src/migrations/mod.rs`
- `src-tauri/db/src/migrations/initial.rs`

**Entry points:** src-tauri/db/src/repos/dev_tools.rs, src-tauri/db/src/repos/dev_memories.rs, src-tauri/db/src/repos/twin.rs

**Keywords:** dev-tools, memories, checkpoints, backlog, codebase, autonomous, sessions, Athena, companion, brain, memory, facts

**Tech stack:** Rust, rusqlite

---

### vault-database-shell

Core database connector explorer shell. DatabaseListView lists all database-type credentials; DatabaseCard renders a card per database with connection status; DBGrid is the main explorer host; SchemaManagerModal browses database schema; SqlEditor is the CodeMirror-based SQL input; introspectionQueries defines per-dialect schema queries; safeModeUtils and sqlTokenizers support safe-mode filtering.

**Files:**
- `src/features/vault/sub_databases/DatabaseCard.tsx`
- `src/features/vault/sub_databases/DatabaseListView.tsx`
- `src/features/vault/sub_databases/DBGrid.tsx`
- `src/features/vault/sub_databases/introspectionQueries.ts`
- `src/features/vault/sub_databases/QueryResultTable.tsx`
- `src/features/vault/sub_databases/safeModeUtils.ts`
- `src/features/vault/sub_databases/SchemaManagerModal.tsx`
- `src/features/vault/sub_databases/SqlEditor.tsx`
- `src/features/vault/sub_databases/sqlTokenizers.ts`
- `src/features/vault/sub_databases/hooks/useDbQueryRunner.ts`
- `src/features/vault/sub_databases/hooks/useQuerySafeMode.ts`

**Entry points:** src/features/vault/sub_databases/DBGrid.tsx, src/features/vault/sub_databases/DatabaseListView.tsx

**Keywords:** database, SQL, schema, introspection, safe-mode, query-runner, CodeMirror

**API surface:** Tauri IPC: run_db_query, introspect_schema, list_databases

**Tech stack:** React 19, TypeScript, CodeMirror, Tauri 2, Tailwind 4

---

### vault-database-tests

Test suite for the database explorer sub-feature. Covers ChatTab integration, ConnectorCapabilityNote rendering, DatabaseCard and DatabaseListView display, introspection query parity across dialects, introspection query correctness, QueryResultTable, SchemaManagerModal, and SqlEditor behavior.

**Files:**
- `src/features/vault/sub_databases/__tests__/ChatTab.test.tsx`
- `src/features/vault/sub_databases/__tests__/ConnectorCapabilityNote.test.tsx`
- `src/features/vault/sub_databases/__tests__/DatabaseCard.test.tsx`
- `src/features/vault/sub_databases/__tests__/DatabaseListView.test.tsx`
- `src/features/vault/sub_databases/__tests__/introspectionParity.test.ts`
- `src/features/vault/sub_databases/__tests__/introspectionQueries.test.ts`
- `src/features/vault/sub_databases/__tests__/QueryResultTable.test.tsx`
- `src/features/vault/sub_databases/__tests__/SchemaManagerModal.test.tsx`
- `src/features/vault/sub_databases/__tests__/SqlEditor.test.tsx`

**Entry points:** src/features/vault/sub_databases/__tests__/introspectionQueries.test.ts

**Keywords:** tests, database, introspection, parity, SQL, Vitest

**Tech stack:** Vitest, React Testing Library, TypeScript

---

### vault-databases-tabs

Table and column browser within the database explorer. TablesTab lists all tables; TableListSidebar provides sidebar navigation; TableDetailPanel shows column details and row preview; ColumnList renders columns with types; TableSearch enables fuzzy search; TableActions and TableContextMenu provide table-level operations; ConnectorCapabilityNote surfaces capability limitations. [Consolidated 2026-08-04: absorbed vault-database-chat, vault-database-query-editor]

**Files:**
- `src/features/vault/sub_databases/tabs/ColumnList.tsx`
- `src/features/vault/sub_databases/tabs/ConnectorCapabilityNote.tsx`
- `src/features/vault/sub_databases/tabs/TableActions.tsx`
- `src/features/vault/sub_databases/tabs/TableContextMenu.tsx`
- `src/features/vault/sub_databases/tabs/TableDetailPanel.tsx`
- `src/features/vault/sub_databases/tabs/TableListSidebar.tsx`
- `src/features/vault/sub_databases/tabs/TableSearch.tsx`
- `src/features/vault/sub_databases/tabs/TablesTab.tsx`
- `src/features/vault/sub_databases/tabs/AssistantSqlBlock.tsx`
- `src/features/vault/sub_databases/tabs/ChatInput.tsx`
- `src/features/vault/sub_databases/tabs/ChatMessages.tsx`
- `src/features/vault/sub_databases/tabs/ChatTab.tsx`
- `src/features/vault/sub_databases/tabs/ConsoleOutput.tsx`
- `src/features/vault/sub_databases/tabs/ConsoleTab.tsx`
- `src/features/vault/sub_databases/tabs/MutationConfirmBanner.tsx`
- `src/features/vault/sub_databases/tabs/QueriesTab.tsx`
- `src/features/vault/sub_databases/tabs/QueryEditorPane.tsx`
- `src/features/vault/sub_databases/tabs/QuerySidebar.tsx`
- `src/features/vault/sub_databases/tabs/QueryToolbar.tsx`
- `src/features/vault/sub_databases/tabs/ResultsTable.tsx`

**Entry points:** src/features/vault/sub_databases/tabs/TablesTab.tsx, src/features/vault/sub_databases/tabs/TableListSidebar.tsx, src/features/vault/sub_databases/tabs/ChatTab.tsx

**Keywords:** tables, columns, schema-browser, table-search, context-menu, capability, chat, AI, SQL, assistant, natural-language, code-block

**Tech stack:** React 19, TypeScript, Tailwind 4

---

## Home Dashboard

> **Group type:** feature
> **Color:** indigo

### cockpit-widget-tests

Vitest unit and integration tests for the cockpit widget library. Covers rendering, config-driven content, empty states, and interaction for the most complex widgets (decision log, design capabilities, model tier choice, observability plan, persona ready, persona walkthrough, recent decisions, template suggestions, trigger set, use-case set, and persona stats utility).

**Files:**
- `src/features/home/sub_cockpit/widgets/__tests__/ConnectorCallCard.test.tsx`
- `src/features/home/sub_cockpit/widgets/__tests__/DecisionLogWidget.test.tsx`
- `src/features/home/sub_cockpit/widgets/__tests__/DesignCapabilitiesWidget.test.tsx`
- `src/features/home/sub_cockpit/widgets/__tests__/ModelTierChoiceWidget.test.tsx`
- `src/features/home/sub_cockpit/widgets/__tests__/ObservabilityPlanWidget.test.tsx`
- `src/features/home/sub_cockpit/widgets/__tests__/PersonaReadyWidget.test.tsx`
- `src/features/home/sub_cockpit/widgets/__tests__/personaStats.test.ts`
- `src/features/home/sub_cockpit/widgets/__tests__/PersonaWalkthroughWidget.test.tsx`
- `src/features/home/sub_cockpit/widgets/__tests__/RecentDecisionsWidget.test.tsx`
- `src/features/home/sub_cockpit/widgets/__tests__/TemplateSuggestionsWidget.test.tsx`
- `src/features/home/sub_cockpit/widgets/__tests__/TriggerSetWidget.test.tsx`
- `src/features/home/sub_cockpit/widgets/__tests__/UseCaseSetWidget.test.tsx`

**Entry points:** src/features/home/sub_cockpit/widgets/__tests__/PersonaReadyWidget.test.tsx

**Keywords:** vitest, widget-test, cockpit, unit-test, decision-log, persona-ready, template-suggestions

**Tech stack:** Vitest, React 19, TypeScript

---

### home-cockpit-widgets

Cockpit widgets supporting Athena's persona-design and workflow-decomposition flows: model tier choice, observability planning, design capabilities catalog, persona walkthrough plans, persona-ready build summaries, creation offer CTAs, use-case decompositions, trigger-set breakdowns, template match suggestions, browser-test structured reports, and walkthrough offer cards. [Consolidated 2026-08-04: absorbed cockpit-decision-widgets, cockpit-explainer-widgets, cockpit-fleet-widgets]

**Files:**
- `src/features/home/sub_cockpit/widgets/ModelTierChoiceWidget.tsx`
- `src/features/home/sub_cockpit/widgets/ObservabilityPlanWidget.tsx`
- `src/features/home/sub_cockpit/widgets/DesignCapabilitiesWidget.tsx`
- `src/features/home/sub_cockpit/widgets/PersonaWalkthroughWidget.tsx`
- `src/features/home/sub_cockpit/widgets/PersonaReadyWidget.tsx`
- `src/features/home/sub_cockpit/widgets/PersonaCreationOfferWidget.tsx`
- `src/features/home/sub_cockpit/widgets/WalkthroughOfferWidget.tsx`
- `src/features/home/sub_cockpit/widgets/TriggerSetWidget.tsx`
- `src/features/home/sub_cockpit/widgets/UseCaseSetWidget.tsx`
- `src/features/home/sub_cockpit/widgets/TemplateSuggestionsWidget.tsx`
- `src/features/home/sub_cockpit/widgets/BrowserTestReportWidget.tsx`
- `src/features/home/sub_cockpit/widgets/DecisionsPanelWidget.tsx`
- `src/features/home/sub_cockpit/widgets/DecisionLogWidget.tsx`
- `src/features/home/sub_cockpit/widgets/LinkedDecisionsWidget.tsx`
- `src/features/home/sub_cockpit/widgets/LinkedMemoriesWidget.tsx`
- `src/features/home/sub_cockpit/widgets/RecentDecisionsWidget.tsx`
- `src/features/home/sub_cockpit/widgets/DecisionDrawer.tsx`
- `src/features/home/sub_cockpit/widgets/VerdictWidget.tsx`
- `src/features/home/sub_cockpit/widgets/FlowStepsWidget.tsx`
- `src/features/home/sub_cockpit/widgets/ComparisonCardsWidget.tsx`
- `src/features/home/sub_cockpit/widgets/TimelineWidget.tsx`
- `src/features/home/sub_cockpit/widgets/LogExcerptWidget.tsx`
- `src/features/home/sub_cockpit/widgets/TextCalloutWidget.tsx`
- `src/features/home/sub_cockpit/widgets/PersonaOverviewWidget.tsx`
- `src/features/home/sub_cockpit/widgets/ConnectedServicesWidget.tsx`
- `src/features/home/sub_cockpit/widgets/MetricSparkWidget.tsx`
- `src/features/home/sub_cockpit/widgets/StatGridWidget.tsx`
- `src/features/home/sub_cockpit/widgets/ExecutionFactsWidget.tsx`
- `src/features/home/sub_cockpit/widgets/MessageSummaryWidget.tsx`
- `src/features/home/sub_cockpit/widgets/IssueListWidget.tsx`
- `src/features/home/sub_cockpit/widgets/intentColors.ts`
- `src/features/home/sub_cockpit/widgets/personaStats.ts`

**Entry points:** src/features/home/sub_cockpit/widgets/PersonaReadyWidget.tsx, src/features/home/sub_cockpit/widgets/TemplateSuggestionsWidget.tsx, src/features/home/sub_cockpit/widgets/DecisionsPanelWidget.tsx

**Keywords:** model-tier, observability-plan, design-capabilities, persona-walkthrough, persona-ready, use-case, trigger-set, template-suggestions, browser-test, walkthrough-offer, decisions, decision-log

**API surface:** companion_match_templates (IPC)

**Tech stack:** React 19, TypeScript, Tauri 2

---

### home-learning

The 'What's New' / Roadmap tab: displays the live roadmap fetched from a remote endpoint (NOW/NEXT/LATER lanes with a hero in-progress item), falls back to bundled static roadmap items, and shows shipped release cards below. Includes a freshness pill with manual refresh, an i18n adapter that reshapes flat t.releases.* keys into the shape the view consumes, and a lazy-loaded empty-lane traced SVG glyph. [Consolidated 2026-08-04: absorbed home-learning-hub, home-power-moves]

**Files:**
- `src/features/home/sub_releases/HomeReleases.tsx`
- `src/features/home/sub_releases/roadmapItems.ts`
- `src/features/home/sub_releases/roadmapItems.test.ts`
- `src/features/home/sub_releases/useLiveRoadmap.ts`
- `src/features/home/sub_releases/LiveRoadmapStatusPill.tsx`
- `src/features/home/sub_releases/RoadmapLaneEmptyGlyph.tsx`
- `src/features/home/sub_releases/i18n/useReleasesTranslation.ts`
- `src/features/home/sub_learning/HomeLearning.tsx`
- `src/features/home/sub_learning/TourDetailModal.tsx`
- `src/features/home/sub_learning/data.ts`
- `src/features/home/sub_learning/illustrations/index.ts`
- `src/features/home/sub_learning/powerMoves/PowerMovesPanel.tsx`
- `src/features/home/sub_learning/powerMoves/PowerMoveRow.tsx`
- `src/features/home/sub_learning/powerMoves/powerMovesStore.ts`
- `src/features/home/sub_learning/powerMoves/registry.ts`
- `src/features/home/sub_learning/powerMoves/flashSpotlight.ts`
- `src/features/home/sub_learning/powerMoves/launchPowerMove.ts`

**Entry points:** src/features/home/sub_releases/HomeReleases.tsx, src/features/home/sub_releases/useLiveRoadmap.ts, src/features/home/sub_learning/HomeLearning.tsx

**Keywords:** roadmap, releases, whats-new, live-roadmap, now-next-later, changelog, bundled-releases, freshness, learning, guided-tours, tour-registry, completion

**API surface:** useLiveRoadmap (external HTTP fetch for live roadmap data)

**Tech stack:** React 19, TypeScript

---

### home-welcome

Business logic backing the Welcome surface: fleet health scoring, 'Since You Left' briefing (diffs activity since last session), navigation-card status chip derivation, vault credential availability check, and session resume context (last active persona/section). These hooks drive the status badges and briefing panel shown on the Welcome tab. [Consolidated 2026-08-04: absorbed home-welcome-surface, home-page-shell, cockpit-panel]

**Files:**
- `src/features/home/sub_welcome/lib/fleetHealth.ts`
- `src/features/home/sub_welcome/lib/fleetHealth.test.ts`
- `src/features/home/sub_welcome/lib/sinceLeftBriefing.ts`
- `src/features/home/sub_welcome/lib/sinceLeftBriefing.test.ts`
- `src/features/home/sub_welcome/lib/useNavCardStatus.ts`
- `src/features/home/sub_welcome/lib/useNavCardStatus.test.ts`
- `src/features/home/sub_welcome/lib/useVaultCredentials.ts`
- `src/features/home/sub_welcome/lib/connectorScope.ts`
- `src/features/home/sub_welcome/useResumeContext.ts`
- `src/features/home/sub_welcome/useResumeContext.test.ts`
- `src/features/home/sub_welcome/SinceYouLeftBriefing.tsx`
- `src/features/home/sub_welcome/ResumeBanner.tsx`
- `src/features/home/sub_welcome/HomeWelcome.tsx`
- `src/features/home/sub_welcome/WelcomeLayout.tsx`
- `src/features/home/sub_welcome/HeroHeader.tsx`
- `src/features/home/sub_welcome/WelcomeGetStarted.tsx`
- `src/features/home/sub_welcome/NavigationGrid.tsx`
- `src/features/home/sub_welcome/NavStatChips.tsx`
- `src/features/home/sub_welcome/LanguageSwitcher.tsx`
- `src/features/home/sub_welcome/SetupCards.tsx`
- `src/features/home/sub_welcome/__tests__/HeroHeader.test.tsx`
- `src/features/home/components/HomePage.tsx`
- `src/features/home/components/__tests__/HomePage.test.tsx`
- `src/features/home/lib/prefetch.ts`
- `src/features/home/lib/usePausableInterval.ts`
- `src/features/home/lib/usePausableInterval.test.ts`
- `src/features/home/sub_cockpit/CockpitPanel.tsx`
- `src/features/home/sub_cockpit/widgetRegistry.ts`
- `src/features/home/sub_cockpit/defaultCockpit.ts`
- `src/features/home/sub_cockpit/defaultCockpit.test.ts`

**Entry points:** src/features/home/sub_welcome/lib/useNavCardStatus.ts, src/features/home/sub_welcome/lib/sinceLeftBriefing.ts, src/features/home/sub_welcome/HomeWelcome.tsx

**Keywords:** fleet-health, since-you-left, briefing, nav-status, resume, vault-credentials, connector-scope, welcome, hero, greeting, navigation, nav-card

**Tech stack:** React 19, TypeScript, Zustand 5

---

### onboarding-components

The body content area of the tour panel, including step navigation, sub-step checklist, the 'Show me' focus-scroll affordance, step progress breadcrumbs, and the tour intro card shown on first entry. TourPanelBody dispatches between generic informational content (for tours 2+) and specialized interactive components (TourAppearanceContent, CredentialsTourContent, PersonaCreationCoach) for the Getting Started tour. TourHandoffOffer is a one-time card bridging the onboarding modal completion into the tour. [Consolidated 2026-08-04: absorbed guided-tour-engine, onboarding-modal-shell, onboarding-state-orchestration, onboarding-steps, tour-narration, tour-spotlight, tour-step-content]

**Files:**
- `src/features/onboarding/components/TourPanelBody.tsx`
- `src/features/onboarding/components/StepProgress.tsx`
- `src/features/onboarding/components/TourIntroCard.tsx`
- `src/features/onboarding/components/TourHandoffOffer.tsx`
- `src/features/onboarding/components/TourProgressArc.tsx`
- `src/features/onboarding/components/GuidedTour.tsx`
- `src/features/onboarding/components/TourLauncher.tsx`
- `src/features/onboarding/components/tourConstants.ts`
- `src/features/onboarding/components/OnboardingOverlay.tsx`
- `src/features/onboarding/components/StepIndicator.tsx`
- `src/features/onboarding/components/OnboardingProgressBar.tsx`
- `src/features/onboarding/components/useOnboardingState.ts`
- `src/features/onboarding/components/templateRecommendation.ts`
- `src/features/onboarding/components/AppearanceStep.tsx`
- `src/features/onboarding/components/DesktopDiscoveryStep.tsx`
- `src/features/onboarding/components/TemplatePickerStep.tsx`
- `src/features/onboarding/components/ExecutionStep.tsx`
- `src/features/onboarding/components/useTourNarration.ts`
- `src/features/onboarding/components/TourNarrationButton.tsx`
- `src/features/onboarding/components/__tests__/useTourNarration.test.ts`
- `src/features/onboarding/components/TourSpotlight.tsx`
- `src/features/onboarding/components/steps/TourAppearanceContent.tsx`
- `src/features/onboarding/components/steps/CredentialsTourContent.tsx`
- `src/features/onboarding/components/steps/PersonaCreationCoach.tsx`

**Entry points:** src/features/onboarding/components/TourPanelBody.tsx, src/features/onboarding/components/GuidedTour.tsx, src/features/onboarding/components/OnboardingOverlay.tsx

**Keywords:** tour-panel, step-progress, sub-steps, show-me, acknowledge, exploration-tour, tour-intro, guided-tour, coach-mark, tourSlice, navigateToStep, step-completion

**Tech stack:** React 19, TypeScript, Zustand 5

---

## Fleet & Orchestration

> **Group type:** feature
> **Color:** indigo

### fleet-monitor-channels

The multi-team channel workspace that lets operators watch several teams' activity streams in parallel. MonitorChannelGrid is the 3-zone layout (team filter rail · merged stream · Quick Answer sidebar); ConversationComposer lets the user assign goals to teams; ConversationSidebar and related components display the clustered conversation view where consecutive steps collapse into single assignment or deliberation rows; conversationModel contains the pure clustering algorithm that keeps the timeline readable. [Consolidated 2026-08-04: absorbed fleet-channel-lens-stream, fleet-channel-map, fleet-merged-feed, fleet-grid-view, fleet-live-overlay]

**Files:**
- `src/features/fleet/monitor/channels/MonitorChannelGrid.tsx`
- `src/features/fleet/monitor/channels/ConversationBriefing.tsx`
- `src/features/fleet/monitor/channels/ConversationCards.tsx`
- `src/features/fleet/monitor/channels/ConversationComposer.tsx`
- `src/features/fleet/monitor/channels/ConversationSidebar.tsx`
- `src/features/fleet/monitor/channels/DeliberationRail.tsx`
- `src/features/fleet/monitor/channels/ReviewsRail.tsx`
- `src/features/fleet/monitor/channels/VirtualConversation.tsx`
- `src/features/fleet/monitor/channels/conversationModel.ts`
- `src/features/fleet/monitor/channels/useConversation.ts`
- `src/features/fleet/monitor/channels/types.ts`
- `src/features/fleet/monitor/channels/index.ts`
- `src/features/fleet/monitor/channels/lensModel.ts`
- `src/features/fleet/monitor/channels/LensStream.tsx`
- `src/features/fleet/monitor/channels/Stream.tsx`
- `src/features/fleet/monitor/channels/StreamMemoryViews.tsx`
- `src/features/fleet/monitor/channels/StreamRow.tsx`
- `src/features/fleet/monitor/channels/useLensFeed.ts`
- `src/features/fleet/monitor/channels/map/ChannelMap.tsx`
- `src/features/fleet/monitor/channels/map/mapGlyphs.tsx`
- `src/features/fleet/monitor/channels/map/mapModel.ts`
- `src/features/fleet/monitor/channels/map/mapModel.test.ts`
- `src/features/fleet/monitor/channels/mergedFeed.tsx`
- `src/features/fleet/monitor/channels/MergedRow.tsx`
- `src/features/fleet/monitor/grid/FleetGridView.tsx`
- `src/features/fleet/monitor/grid/PersonaSquare.tsx`
- `src/features/fleet/monitor/grid/TeamBadge.tsx`
- `src/features/fleet/monitor/grid/fleetGridModel.ts`
- `src/features/fleet/monitor/live/LiveChannelOverlay.tsx`
- `src/features/fleet/monitor/live/LiveCommsStack.tsx`
- `src/features/fleet/monitor/live/liveDevHarness.ts`
- `src/features/fleet/monitor/live/liveModel.tsx`

**Entry points:** src/features/fleet/monitor/channels/MonitorChannelGrid.tsx, src/features/fleet/monitor/channels/conversationModel.ts, src/features/fleet/monitor/channels/LensStream.tsx

**Keywords:** channel workspace, team channel, conversation clustering, assignment, deliberation, goal assignment, Quick Answer, channel grid, lens filter, event stream, channel kind, event family

**API surface:** teamChannel IPC (via pipeline API)

**Tech stack:** React 19, TypeScript, Zustand 5, Tauri 2

---

### fleet-monitor-shell

The full-screen fleet monitor overlay that fuses all persona signals into one control surface. PersonaMonitor is the top-level view, hosting three switchable view modes (fleet columns, grid, channels) and a sliding triage drawer; monitorModel contains the pure state machine that derives card colour, pillar visuals, and fleet-wide rollup from live process/review/message data; useMonitorData polls reviews, messages, and health feeds and wires them into a single MonitorData object consumed by the view.

**Files:**
- `src/features/fleet/monitor/PersonaMonitor.tsx`
- `src/features/fleet/monitor/MonitorDrawer.tsx`
- `src/features/fleet/monitor/monitorModel.ts`
- `src/features/fleet/monitor/monitorModel.test.ts`
- `src/features/fleet/monitor/useMonitorData.ts`
- `src/features/fleet/monitor/MonitorCapabilities.tsx`
- `src/features/fleet/monitor/navigateToProcess.ts`
- `src/features/fleet/monitor/index.ts`

**Entry points:** src/features/fleet/monitor/PersonaMonitor.tsx, src/features/fleet/monitor/monitorModel.ts, src/features/fleet/monitor/useMonitorData.ts

**Keywords:** fleet monitor, persona card, exec state, pillar visual, fleet summary, drawer, review action, health, process activity

**API surface:** listManualReviews, updateManualReviewStatus, dispatchReviewAction, listMessages, markMessageRead (via api/overview)

**Tech stack:** React 19, TypeScript, Zustand 5, Framer Motion, Tauri 2

---

### fleet-session-grid

Primary Sessions tab showing the live list of Claude Code sessions with per-session controls (spawn, kill, hibernate, wake, broadcast). Manages the active-session selection, session list filtering by state, and the sub-panel that hosts the terminal pane, insights, or harvest report. Integrates the skill library drawer and Athena attention wiring. [Consolidated 2026-08-04: absorbed fleet-page-shell, fleet-session-status, fleet-terminal-overlay, fleet-footer-cluster, fleet-debug-tools, research-lab-shell]

**Files:**
- `src/features/plugins/fleet/sub_grid/FleetGridPage.tsx`
- `src/features/plugins/fleet/FleetSessionCard.tsx`
- `src/features/plugins/fleet/FleetSummaryPills.tsx`
- `src/features/plugins/fleet/FleetNeedsYouBanner.tsx`
- `src/features/plugins/fleet/FleetHooksPill.tsx`
- `src/features/plugins/fleet/fleetSessionScope.ts`
- `src/features/plugins/fleet/SkillLibraryDrawer.tsx`
- `src/features/plugins/fleet/SkillLibraryRow.tsx`
- `src/features/plugins/fleet/FleetPage.tsx`
- `src/features/plugins/fleet/FleetGridLayer.tsx`
- `src/features/plugins/fleet/FleetGridOverlayHost.tsx`
- `src/features/plugins/fleet/fleetGridLayout.ts`
- `src/features/plugins/fleet/FleetHotkeysHelp.tsx`
- `src/features/plugins/fleet/useFleetHotkeys.ts`
- `src/features/plugins/fleet/fleetAttention.ts`
- `src/features/plugins/fleet/fleetStateMeta.ts`
- `src/features/plugins/fleet/FleetStatusDots.tsx`
- `src/features/plugins/fleet/FleetStateSparkline.tsx`
- `src/features/plugins/fleet/FleetStatusLegend.tsx`
- `src/features/plugins/fleet/relativeAgo.ts`
- `src/features/plugins/fleet/FleetTerminalOverlay.tsx`
- `src/features/plugins/fleet/FleetOverlayTile.tsx`
- `src/features/plugins/fleet/FleetTileStatusBlock.tsx`
- `src/features/plugins/fleet/FleetTileAthenaBar.tsx`
- `src/features/plugins/fleet/useFleetOverlayActions.ts`
- `src/features/plugins/fleet/FleetAttentionLegend.tsx`
- `src/features/plugins/fleet/FleetFooterIcon.tsx`
- `src/features/plugins/fleet/FleetFooterPopover.tsx`
- `src/features/plugins/fleet/FleetLimitEtaChip.tsx`
- `src/features/plugins/fleet/FleetShipIcon.tsx`
- `src/features/plugins/fleet/FleetDebugLogButton.tsx`
- `src/features/plugins/fleet/FleetDebugLogFooterPill.tsx`
- `src/features/plugins/fleet/useFleetDebugLog.ts`
- `src/features/plugins/research-lab/ResearchLabPage.tsx`

**Entry points:** src/features/plugins/fleet/sub_grid/FleetGridPage.tsx, src/features/plugins/fleet/FleetPage.tsx, src/features/plugins/fleet/FleetGridLayer.tsx

**Keywords:** session list, spawn, kill, hibernate, wake, broadcast, filter, attention, skill library, fleet, tab, shell

**API surface:** fleet_spawn_session, fleet_headless_session, fleet_kill_session, fleet_hibernate_session, fleet_wake_session, fleet_write_input

**Tech stack:** React 19, TypeScript, Zustand 5, Tauri 2

---

### fleet-terminal-manager

Singleton xterm.js lifecycle manager keyed by session ID. Creates, parks (LRU up to 6), and disposes Terminal instances so switching sessions or opening the grid overlay re-attaches the same buffered terminal instead of rebuilding it. Handles PTY output hydration, WebGL renderer loading, copy-on-select, right-click paste, and per-session IPC subscription/unsubscription. [Consolidated 2026-08-04: absorbed fleet-session-operations, fleet-mobile-companion]

**Files:**
- `src/features/plugins/fleet/fleetTerminalManager.ts`
- `src/features/plugins/fleet/FleetTerminalPane.tsx`
- `src/features/plugins/fleet/useFleetTerminalConfig.ts`
- `src/features/plugins/fleet/FleetSpawnTaskModal.tsx`
- `src/features/plugins/fleet/FleetBroadcastModal.tsx`
- `src/features/plugins/fleet/useFleetOrphanScan.ts`
- `src/features/plugins/fleet/FleetMobilePreview.tsx`
- `src/features/plugins/fleet/FleetPairDevice.tsx`

**Entry points:** src/features/plugins/fleet/fleetTerminalManager.ts, src/features/plugins/fleet/FleetSpawnTaskModal.tsx, src/features/plugins/fleet/FleetBroadcastModal.tsx

**Keywords:** xterm, terminal, PTY, attach, detach, hydrate, WebGL, LRU, scrollback, copy-on-select, ring buffer, spawn

**API surface:** fleet_subscribe_terminal, fleet_unsubscribe_terminal, fleet_write_input, fleet_resize_session

**Tech stack:** React 19, TypeScript, @xterm/xterm, @xterm/addon-fit, @xterm/addon-webgl, @xterm/addon-web-links, @xterm/addon-unicode11, Tauri 2

---

### fleet-triage-columns

The default fleet view that organises personas into team-scoped project columns, showing only 'actionable' cards (failed, pending review, input-required, draft-ready). triageModel defines the isActionable predicate and derives the priority-ordered action badge set (review severity, input gate, draft ready, unread messages) for each persona card; MonitorProjectColumns renders the column grid and PersonaGlyph the per-card glyph in the compact pillar.

**Files:**
- `src/features/fleet/monitor/triage/MonitorProjectColumns.tsx`
- `src/features/fleet/monitor/triage/PersonaGlyph.tsx`
- `src/features/fleet/monitor/triage/triageModel.ts`

**Entry points:** src/features/fleet/monitor/triage/MonitorProjectColumns.tsx, src/features/fleet/monitor/triage/triageModel.ts

**Keywords:** triage, actionable, action badges, project columns, persona glyph, review severity, input required, draft ready

**Tech stack:** React 19, TypeScript, Tailwind 4, Lucide React

---

### plugins-fleet-tests

Vitest test suite for the fleet plugin covering attention classification logic, session scope ordering, status dot rendering, broadcast modal behavior, debug log controls, footer icon behavior, overlay rendering, skill library drawer, and harvest markdown generation. [Consolidated 2026-08-04: absorbed fleet-activity-feed, fleet-session-insights, fleet-harvest-reports, fleet-settings, fleet-skill-library]

**Files:**
- `src/features/plugins/fleet/__tests__/fleetAttention.test.ts`
- `src/features/plugins/fleet/__tests__/FleetBroadcastModal.test.tsx`
- `src/features/plugins/fleet/__tests__/FleetDebugLogButton.test.tsx`
- `src/features/plugins/fleet/__tests__/FleetDebugLogFooterPill.test.tsx`
- `src/features/plugins/fleet/__tests__/FleetFooterIcon.test.tsx`
- `src/features/plugins/fleet/__tests__/FleetNeedsYouBanner.test.tsx`
- `src/features/plugins/fleet/__tests__/fleetSessionScope.test.ts`
- `src/features/plugins/fleet/__tests__/FleetStatusDots.test.tsx`
- `src/features/plugins/fleet/__tests__/FleetTerminalOverlay.test.tsx`
- `src/features/plugins/fleet/__tests__/SkillLibraryDrawer.test.tsx`
- `src/features/plugins/fleet/sub_activity/__tests__/FleetActivityPage.test.tsx`
- `src/features/plugins/fleet/sub_grid/__tests__/FleetContextPill.test.tsx`
- `src/features/plugins/fleet/sub_grid/__tests__/FleetSessionInsights.test.tsx`
- `src/features/plugins/fleet/sub_grid/__tests__/FleetTokenSummaryBar.test.tsx`
- `src/features/plugins/fleet/sub_harvest/__tests__/fleetRunMarkdown.test.ts`
- `src/features/plugins/fleet/sub_settings/__tests__/FleetSettingsPage.test.tsx`
- `src/features/plugins/fleet/sub_skills/__tests__/SkillInstallModal.test.tsx`
- `src/features/plugins/fleet/sub_skills/__tests__/useSkillData.test.ts`
- `src/features/plugins/fleet/sub_activity/FleetActivityPage.tsx`
- `src/features/plugins/fleet/sub_grid/FleetSessionInsights.tsx`
- `src/features/plugins/fleet/sub_grid/FleetContextPill.tsx`
- `src/features/plugins/fleet/sub_grid/FleetTokenSummaryBar.tsx`
- `src/features/plugins/fleet/sub_harvest/FleetHarvestPanel.tsx`
- `src/features/plugins/fleet/sub_harvest/FleetRunSessionRow.tsx`
- `src/features/plugins/fleet/sub_harvest/fleetRunMarkdown.ts`
- `src/features/plugins/fleet/sub_settings/FleetSettingsPage.tsx`
- `src/features/plugins/fleet/sub_settings/FleetAutoHibernateSettings.tsx`
- `src/features/plugins/fleet/sub_settings/FleetLiveSlotSettings.tsx`
- `src/features/plugins/fleet/sub_settings/FleetStateCutoffSettings.tsx`
- `src/features/plugins/fleet/sub_settings/FleetTerminalSettings.tsx`
- `src/features/plugins/fleet/sub_settings/FleetProcessRow.tsx`
- `src/features/plugins/fleet/sub_settings/FleetProcessScanner.tsx`
- `src/features/plugins/fleet/sub_skills/SkillInstallModal.tsx`
- `src/features/plugins/fleet/sub_skills/useSkillData.ts`

**Entry points:** src/features/plugins/fleet/__tests__/fleetAttention.test.ts, src/features/plugins/fleet/sub_activity/FleetActivityPage.tsx, src/features/plugins/fleet/sub_grid/FleetSessionInsights.tsx

**Keywords:** vitest, test, fleet, attention, broadcast, overlay, session scope, harvest markdown, skill install, activity, transcript, recent

**Tech stack:** Vitest, React 19, TypeScript, @testing-library/react

---

## AI Companion

> **Group type:** feature
> **Color:** violet

### companion

Core infrastructure and integration layer for the Athena companion system. Covers disk path resolution (`~/.personas/companion-brain/`), shared utilities (SHA-256, slugify, excerpt, short-id), model routing (which Claude model variant to use per request type), observability/tracing, generated UI anchors for the companion panel, wake-window scheduling, and the top-level companion module declaration. Also includes integration shims connecting Athena to the rest of the app: dev-mode overlay, dev sessions, athena_reaction event handler, connector and plugin adapters, and project context. [Consolidated 2026-08-04: absorbed companion-session-orchestration]

**Files:**
- `src-tauri/src/companion/mod.rs`
- `src-tauri/src/companion/disk.rs`
- `src-tauri/src/companion/util.rs`
- `src-tauri/src/companion/brain/util.rs`
- `src-tauri/src/companion/brain/mod.rs`
- `src-tauri/src/companion/model_routing.rs`
- `src-tauri/src/companion/observability.rs`
- `src-tauri/src/companion/generated_anchors.rs`
- `src-tauri/src/companion/wake_window.rs`
- `src-tauri/src/companion/dev_mode.rs`
- `src-tauri/src/companion/dev_session.rs`
- `src-tauri/src/companion/athena_reaction.rs`
- `src-tauri/src/companion/connectors.rs`
- `src-tauri/src/companion/plugins.rs`
- `src-tauri/src/companion/projects.rs`
- `src-tauri/src/companion/session.rs`
- `src-tauri/src/companion/conversation.rs`
- `src-tauri/src/companion/turn_ledger.rs`
- `src-tauri/src/companion/prompt.rs`
- `src-tauri/src/companion/dispatcher.rs`

**Entry points:** src-tauri/src/companion/mod.rs, src-tauri/src/companion/disk.rs, src-tauri/src/companion/model_routing.rs

**Keywords:** disk, brain-root, model-routing, observability, wake-window, dev-mode, connectors, plugins, projects, utilities, athena, claude-cli

**Tech stack:** Rust, Tauri 2, rusqlite, tracing

---

### companion-brain

Contains Athena's fleet-awareness intelligence layer: pattern recognition over fleet execution history, user decision profiling, profile synthesis for generating insight reports, and recall synthesis for summarizing brain state into a natural-language digest. Also covers the dashboard/cockpit composition ops (compose_dashboard, compose_cockpit, explain_in_cockpit) that let Athena generate personalized observability surfaces and the decisions module that tracks operator decision history for behavioral profiling. [Consolidated 2026-08-04: absorbed companion-behavioral-memory, companion-episodic-memory, companion-hybrid-retrieval, companion-identity-doctrine, companion-memory-pipeline, companion-semantic-memory, companion-background-jobs, companion-fleet-orchestration]

**Files:**
- `src-tauri/src/companion/brain/fleet.rs`
- `src-tauri/src/companion/brain/fleet_patterns.rs`
- `src-tauri/src/companion/brain/profile_synthesis.rs`
- `src-tauri/src/companion/brain/recall_synthesis.rs`
- `src-tauri/src/companion/brain/decisions.rs`
- `src-tauri/src/companion/brain/dashboard.rs`
- `src-tauri/src/companion/brain/cockpit.rs`
- `src-tauri/src/companion/brain/procedural.rs`
- `src-tauri/src/companion/brain/goals.rs`
- `src-tauri/src/companion/brain/backlog.rs`
- `src-tauri/src/companion/brain/episodic.rs`
- `src-tauri/src/companion/brain/graph.rs`
- `src-tauri/src/companion/brain/retrieval.rs`
- `src-tauri/src/companion/brain/identity.rs`
- `src-tauri/src/companion/brain/doctrine.rs`
- `src-tauri/src/companion/brain/reflection.rs`
- `src-tauri/src/companion/brain/rituals.rs`
- `src-tauri/src/companion/templates/mod.rs`
- `src-tauri/src/companion/brain/consolidation.rs`
- `src-tauri/src/companion/brain/embeddings.rs`
- `src-tauri/src/companion/brain/oneshot.rs`
- `src-tauri/src/companion/brain/semantic.rs`
- `src-tauri/src/companion/jobs/mod.rs`
- `src-tauri/src/companion/jobs/scan_codebase.rs`
- `src-tauri/src/companion/jobs/curation_run.rs`
- `src-tauri/src/companion/jobs/operations_views.rs`
- `src-tauri/src/companion/jobs/connector_use.rs`
- `src-tauri/src/companion/orchestration/mod.rs`
- `src-tauri/src/companion/orchestration/operative_memory.rs`
- `src-tauri/src/companion/orchestration/mcp/mod.rs`
- `src-tauri/src/companion/orchestration/mcp/handlers.rs`
- `src-tauri/src/companion/orchestration/mcp/pending.rs`

**Entry points:** src-tauri/src/companion/brain/fleet.rs, src-tauri/src/companion/brain/profile_synthesis.rs, src-tauri/src/companion/brain/procedural.rs

**Keywords:** fleet, patterns, profile-synthesis, recall-synthesis, decisions, dashboard, cockpit, observability, intelligence, procedural, goals, backlog

**API surface:** Tauri event: navigate to Home→Cockpit

**Tech stack:** Rust, rusqlite, serde

---

### companion-proactive

Implements Athena's proactive outreach system — nudges she generates on her own initiative without a user prompt. A 5-stage pipeline: trigger evaluators scan brain state to produce `Nudge` candidates; a quiet-hours guard suppresses delivery during focus/sleep windows; a daily budget cap (default 3) prevents spam; dedup prevents restacking the same trigger; and persistence writes to `companion_proactive_message`. Specialized trigger modules handle execution review, incident alerting, fleet operation wrap-ups, backlog aging, rollup digests, message triage, and scheduled future check-ins. [Consolidated 2026-08-04: absorbed companion-voice-transcription, companion-voice-synthesis]

**Files:**
- `src-tauri/src/companion/proactive/mod.rs`
- `src-tauri/src/companion/proactive/triggers.rs`
- `src-tauri/src/companion/proactive/quiet.rs`
- `src-tauri/src/companion/proactive/budget.rs`
- `src-tauri/src/companion/proactive/rollup.rs`
- `src-tauri/src/companion/proactive/execution_review.rs`
- `src-tauri/src/companion/proactive/message_triage.rs`
- `src-tauri/src/companion/proactive/baselines.rs`
- `src-tauri/src/companion/proactive/backlog_triage.rs`
- `src-tauri/src/companion/proactive/fleet_triggers.rs`
- `src-tauri/src/companion/proactive/incident_triggers.rs`
- `src-tauri/src/companion/stt/mod.rs`
- `src-tauri/src/companion/stt/catalog.rs`
- `src-tauri/src/companion/stt/downloader.rs`
- `src-tauri/src/companion/stt/whisper.rs`
- `src-tauri/src/companion/tts/mod.rs`
- `src-tauri/src/companion/tts/kokoro.rs`
- `src-tauri/src/companion/tts/kokoro_catalog.rs`
- `src-tauri/src/companion/tts/kokoro_installer.rs`
- `src-tauri/src/companion/tts/pocket.rs`
- `src-tauri/src/companion/tts/pocket_installer.rs`
- `src-tauri/src/companion/tts/sherpa_engine.rs`

**Entry points:** src-tauri/src/companion/proactive/mod.rs, src-tauri/src/companion/proactive/triggers.rs, src-tauri/src/companion/stt/mod.rs

**Keywords:** proactive, nudge, quiet-hours, budget, daily-cap, trigger, incident, execution-review, fleet, scheduled, stt, speech-to-text

**API surface:** Tauri event: companion://proactive

**Tech stack:** Rust, rusqlite, Tauri 2, chrono

---

### companion-ui-controls

Specs for companion chat panel UI controls: autonomous mode toggle (A2), stop-button presence and click during streaming (A5), design cards rendering, stream-phase indicators (thinking/tool_use/reviewing), autonomous-marker rendering for system messages, and header control states. Uses bridge injection methods to avoid burning real LLM turns. [Consolidated 2026-08-04: absorbed twin-discord-e2e, artist-plugin-e2e, athena-guided-walkthrough, companion-backend-commands, companion-fleet-e2e, getting-started-tour-e2e, guided-tour-smoke, preset-adoption-e2e, sidebar-navigation-e2e, template-marathon-fixtures, adoption-bridge, artist-bridge, companion-build-workflow, companion-conversation, drive-plugin-e2e, fleet-plugin-e2e, performance-testing]

**Files:**
- `tests/playwright/companion-autonomous-mode.spec.ts`
- `tests/playwright/companion-stop-button.spec.ts`
- `tests/playwright/companion-header-controls.spec.ts`
- `tests/playwright/companion-autonomous-marker.spec.ts`
- `tests/playwright/companion-stream-phase.spec.ts`
- `tests/playwright/companion-design-cards.spec.ts`
- `tests/playwright/discord-twin-1-setup.spec.ts`
- `tests/playwright/discord-twin-2-replier.spec.ts`
- `tests/playwright/twin-cycle-features.spec.ts`
- `tests/playwright/artist-smoke.spec.ts`
- `tests/playwright/drive-cycle-features.spec.ts`
- `tests/playwright/athena-guided-walkthrough.spec.ts`
- `tests/playwright/athena-guided-walkthrough-topics.spec.ts`
- `tests/playwright/companion-backend-commands.spec.ts`
- `tests/playwright/message-modal-features.spec.ts`
- `tests/playwright/companion-fleet-integration.spec.ts`
- `tests/playwright/companion-fleet-orchestration.spec.ts`
- `tests/playwright/getting-started-tour.spec.ts`
- `tests/playwright/getting-started-tour-mock.spec.ts`
- `tests/playwright/tours-explore.spec.ts`
- `tests/playwright/tours-obsidian-brain.spec.ts`
- `tests/playwright/preset-questionnaire.spec.ts`
- `tests/playwright/preset-team-adoption.spec.ts`
- `tests/playwright/sidebar-navigation.spec.ts`
- `tests/playwright/team-functionality.spec.ts`
- `tests/playwright/template-marathon-fixtures.ts`
- `tests/playwright/__tests__/template-marathon-fixtures.test.ts`
- `tests/playwright/adoption-bridge.ts`
- `tests/playwright/artist-bridge.ts`
- `tests/playwright/companion-real-claude-workflow.spec.ts`
- `tests/playwright/athena-conversation.spec.ts`
- `tests/playwright/drive-smoke.spec.ts`
- `tests/playwright/fleet-smoke.spec.ts`
- `tests/playwright/perf-nav-walk.spec.ts`

**Entry points:** tests/playwright/companion-autonomous-mode.spec.ts, tests/playwright/companion-stop-button.spec.ts, tests/playwright/discord-twin-1-setup.spec.ts

**Keywords:** autonomous, stop-button, streaming, header, marker, design-cards, phase, companion, discord, twin, bot-token, credential

**Tech stack:** Playwright, TypeScript

---

### glyph-command-panel

The command panel inside the Glyph that lets users compose and dispatch a one-shot execution with full connector/event/schedule/messaging configuration. A multi-row panel (messaging, tools, when) leads into a composer sub-system with dedicated picker modals for connectors, events, schedules, and messaging channels. Recipe suggestions are surfaced when eligibility criteria are met.

**Files:**
- `src/features/agents/sub_glyph/commandPanel/index.tsx`
- `src/features/agents/sub_glyph/commandPanel/CommandPanelRow.tsx`
- `src/features/agents/sub_glyph/commandPanel/CommandPanelMessagingRow.tsx`
- `src/features/agents/sub_glyph/commandPanel/CommandPanelToolsRow.tsx`
- `src/features/agents/sub_glyph/commandPanel/CommandPanelWhenRow.tsx`
- `src/features/agents/sub_glyph/commandPanel/CommandPanelFooter.tsx`
- `src/features/agents/sub_glyph/commandPanel/CommandPanelComposeStep.tsx`
- `src/features/agents/sub_glyph/commandPanel/commandPanelHelpers.ts`
- `src/features/agents/sub_glyph/commandPanel/messagingChannelDefaults.ts`
- `src/features/agents/sub_glyph/commandPanel/types.ts`
- `src/features/agents/sub_glyph/commandPanel/composer/ComposerPickerShell.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/ComposerConnectorCard.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/ComposerConnectorsPickerModal.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/ComposerConnectorsSearchBar.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/ComposerBrandIcon.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/ComposerEventPickerModal.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/ComposerEventPersonaList.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/ComposerEventTemplateList.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/ComposerMessagingPickerModal.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/ComposerSchedulePickerModal.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/ComposerScheduleDetailForm.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/ComposerScheduleRhythmCard.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/ComposerRecipeSuggestion.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/ConnectorTableScopeRow.tsx`
- `src/features/agents/sub_glyph/commandPanel/composer/useRecipeSuggestionEligibility.ts`

**Entry points:** src/features/agents/sub_glyph/commandPanel/index.tsx, src/features/agents/sub_glyph/commandPanel/CommandPanelComposeStep.tsx

**Keywords:** command-panel, compose, connector, event, schedule, messaging, recipe, picker, dispatch

**Tech stack:** React 19, TypeScript, Zustand 5, Tailwind 4

---

### glyph-persona-card

The Glyph is the rich persona detail card surface used throughout the app (sidebar, overview, companion). It supports multiple layout modes (full, row strip, cinema, dialogue-cinema, edit face, sigil face, stage surface) and shows capability previews, activity strips, answer cards, dimension summaries, and a top bar. Layout state and compose config are managed by dedicated hooks.

**Files:**
- `src/features/agents/sub_glyph/GlyphFullLayout.tsx`
- `src/features/agents/sub_glyph/GlyphRowStrip.tsx`
- `src/features/agents/sub_glyph/GlyphCinemaLayout.tsx`
- `src/features/agents/sub_glyph/GlyphDialogueCinemaLayout.tsx`
- `src/features/agents/sub_glyph/GlyphEditFace.tsx`
- `src/features/agents/sub_glyph/GlyphSigilFace.tsx`
- `src/features/agents/sub_glyph/GlyphSigilCanvas.tsx`
- `src/features/agents/sub_glyph/GlyphStageSurface.tsx`
- `src/features/agents/sub_glyph/GlyphCoreContent.tsx`
- `src/features/agents/sub_glyph/GlyphTopBar.tsx`
- `src/features/agents/sub_glyph/GlyphMetadataPanel.tsx`
- `src/features/agents/sub_glyph/GlyphCapabilityPreview.tsx`
- `src/features/agents/sub_glyph/GlyphActivityStrip.tsx`
- `src/features/agents/sub_glyph/GlyphAnswerCard.tsx`
- `src/features/agents/sub_glyph/GlyphDimensionSummaryCard.tsx`
- `src/features/agents/sub_glyph/GlyphRefineComposer.tsx`
- `src/features/agents/sub_glyph/GlyphTestCompleteCore.tsx`
- `src/features/agents/sub_glyph/DialogueStageSurface.tsx`
- `src/features/agents/sub_glyph/DialogueComposePanel.tsx`
- `src/features/agents/sub_glyph/RecipeAlternativeModal.tsx`
- `src/features/agents/sub_glyph/cinemaShared.tsx`
- `src/features/agents/sub_glyph/glyphLayoutHelpers.ts`
- `src/features/agents/sub_glyph/glyphLayoutTypes.ts`
- `src/features/agents/sub_glyph/useGlyphLayoutState.ts`
- `src/features/agents/sub_glyph/useComposeConfig.tsx`
- `src/features/agents/sub_glyph/useRecipeStarters.ts`

**Entry points:** src/features/agents/sub_glyph/GlyphFullLayout.tsx, src/features/agents/sub_glyph/glyphLayoutTypes.ts

**Keywords:** glyph, persona-card, cinema, sigil, layout, compose, recipe, dialogue, activity, capability

**Tech stack:** React 19, TypeScript, Zustand 5, Tailwind 4

---

### persona-core-codex

The Persona Core Codex surface that displays and edits a persona's deep behavioral identity: archetype selection (9 archetypes with glyph data), polarity sliders, mentality card, trait grid, snapshot column, and a compact core badge. usePersonaCore manages saving and reading the personality snapshot; PersonaCoreModal is the full editing dialog.

**Files:**
- `src/features/agents/sub_glyph/personaCore/PersonaCoreModal.tsx`
- `src/features/agents/sub_glyph/personaCore/PersonaCoreCodex.tsx`
- `src/features/agents/sub_glyph/personaCore/PersonaCoreBadge.tsx`
- `src/features/agents/sub_glyph/personaCore/ConfigTiles.tsx`
- `src/features/agents/sub_glyph/personaCore/MentalityCard.tsx`
- `src/features/agents/sub_glyph/personaCore/PolaritySlider.tsx`
- `src/features/agents/sub_glyph/personaCore/TraitGrid.tsx`
- `src/features/agents/sub_glyph/personaCore/SnapshotColumn.tsx`
- `src/features/agents/sub_glyph/personaCore/SectionLabels.tsx`
- `src/features/agents/sub_glyph/personaCore/archetypeGlyphData.ts`
- `src/features/agents/sub_glyph/personaCore/catalog.ts`
- `src/features/agents/sub_glyph/personaCore/types.ts`
- `src/features/agents/sub_glyph/personaCore/usePersonaCore.ts`
- `src/features/agents/sub_glyph/personaCore/index.ts`

**Entry points:** src/features/agents/sub_glyph/personaCore/PersonaCoreModal.tsx, src/features/agents/sub_glyph/personaCore/usePersonaCore.ts

**Keywords:** persona-core, archetype, polarity, trait, mentality, snapshot, codex, identity, badge

**API surface:** update_persona_core, get_persona_core

**Tech stack:** React 19, TypeScript, Zustand 5

---

### webbuild

Provides the three preview-layer primitives for Athena Studio: (1) Next.js app-router route discovery by scanning `app/` for `page.*` files, used to populate the Studio navigation bar; (2) per-turn git snapshot commit and restore for the version history timeline; and (3) injection of the `AthenaPreviewAgent` TSX component into the generated project's root layout, enabling cross-origin `postMessage` element-location and route-reporting from inside the preview iframe back to the Studio host. [Consolidated 2026-08-04: absorbed webbuild-build-turn, webbuild-bun-runtime, webbuild-devserver, webbuild-project-scaffold]

**Files:**
- `src-tauri/src/webbuild/routes.rs`
- `src-tauri/src/webbuild/versions.rs`
- `src-tauri/src/webbuild/preview_agent.rs`
- `src-tauri/src/webbuild/plan.rs`
- `src-tauri/src/webbuild/mcp.rs`
- `src-tauri/src/webbuild/bun.rs`
- `src-tauri/src/webbuild/mod.rs`
- `src-tauri/src/webbuild/devserver.rs`
- `src-tauri/src/webbuild/project.rs`

**Entry points:** src-tauri/src/webbuild/preview_agent.rs, src-tauri/src/webbuild/routes.rs, src-tauri/src/webbuild/plan.rs

**Keywords:** preview, routes, app-router, page.tsx, version, git, snapshot, restore, postMessage, AthenaPreviewAgent, iframe, bounding rect

**API surface:** list_routes(dir); commit_snapshot(dir, summary); list_versions(dir); restore(dir, sha); preview_agent::ensure(dir)

**Tech stack:** Rust, serde, ts-rs, git CLI

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
git_head: d9f5643a48126465c288bdf83d6ca3617084834f
git_commit_count: 6965
generated_at: 2026-08-06T20:23:09.821205800+00:00
-->
