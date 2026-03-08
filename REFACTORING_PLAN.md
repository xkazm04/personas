# Codebase Refactoring Plan

## Rules
1. **No file > 200 lines** — split large files into focused modules
2. **sub_ folder structure** — every `sub_*` directory follows:
```
sub_feature/
  index.ts              ← re-exports only (parent layout barrel)
  components/           ← .tsx UI components
  libs/                 ← hooks (use*.ts), utils, types, constants
```

## Classification Guide
| Suffix / Pattern | Target folder |
|---|---|
| `*.tsx` (renders JSX) | `components/` |
| `use*.ts` (React hooks) | `libs/` |
| `*Types.ts`, `*Constants.ts`, `*Utils.ts`, `*Helpers.ts` | `libs/` |
| `index.ts` | stays at sub_ root |

## Splitting Strategy for Files > 200 Lines
- **Extract sub-components**: large render blocks → named child components in `components/`
- **Extract hooks**: inline `useState`/`useEffect` clusters → custom hooks in `libs/`
- **Extract helpers**: pure functions, data transforms, constants → `libs/`
- **Extract types**: large type/interface blocks → `libs/types.ts`

---

# PHASE 1 — agents (16 sub_ folders)

## 1.1 sub_sidebar (under agents/components/)
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| PersonaContextMenu.tsx | 393 | **SPLIT** → extract menu sections into 2 components |
| DroppableGroup.tsx | 377 | **SPLIT** → extract group header + group body components |
| usePersonaFilters.ts | 316 | **SPLIT** → extract filter logic into `libs/usePersonaFilters.ts` + `libs/filterHelpers.ts` |
| SearchFilterBar.tsx | 213 | **SPLIT** → extract filter chips component |
| DraggablePersonaCard.tsx | 131 | → `components/` |
| UngroupedZone.tsx | 61 | → `components/` |

## 1.2 sub_connectors
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| AutomationSetupModal.tsx | 843 | **SPLIT** → extract step panels (TriggerStep, ActionStep, ConditionStep ~200 ea), extract `libs/useAutomationSetup.ts` hook |
| subscriptionLifecycle.ts | 379 | **SPLIT** → `libs/subscriptionLifecycle.ts` + `libs/subscriptionHelpers.ts` |
| ConnectorStatusCard.tsx | 296 | **SPLIT** → extract status badges + detail section |
| PersonaConnectorsTab.tsx | 249 | **SPLIT** → extract sections into child components |
| AutomationCard.tsx | 217 | **SPLIT** → extract card actions + card body |
| EventSubscriptionSettings.tsx | 212 | **SPLIT** → extract form section |
| NotificationChannelSettings.tsx | 209 | **SPLIT** → extract channel list component |
| AgentCredentialDemands.tsx | 194 | → `components/` |
| useConnectorStatuses.ts | 190 | → `libs/` |
| useUnfulfilledCredentials.ts | 166 | → `libs/` |
| NotificationChannelCard.tsx | 144 | → `components/` |
| AutomationsSection.tsx | 143 | → `components/` |
| AddSubscriptionForm.tsx | 129 | → `components/` |
| ToolsSection.tsx | 109 | → `components/` |
| UseCaseSubscriptionsSection.tsx | 96 | → `components/` |
| CredentialPicker.tsx | 95 | → `components/` |
| automationTypes.ts | 77 | → `libs/` |
| AddChannelButton.tsx | 56 | → `components/` |
| connectorTypes.ts | 50 | → `libs/` |
| index.ts | 12 | stays at root |

## 1.3 sub_design
**Already has components/ and libs/ subdirs — audit only**
| File | Lines | Action |
|---|---|---|
| useDesignTabState.ts | 290 | **SPLIT** → `libs/useDesignTabState.ts` + `libs/designStateHelpers.ts` |
| DesignConversationHistory.tsx | 272 | **SPLIT** → extract message list + message item |
| DesignTabPhaseContent.tsx | 238 | **SPLIT** → extract phase renderers |
| DesignPhasePanel.tsx | 221 | **SPLIT** → extract panel header + panel body |
| ExamplePairCollector.tsx | 206 | **SPLIT** → extract pair item + pair form |
| All remaining .tsx < 200 | — | → `components/` |
| All remaining .ts < 200 | — | → `libs/` |

## 1.4 sub_editor
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| PersonaEditor.tsx | 215 | **SPLIT** → extract editor body, keep layout in parent |
| EditorDocument.tsx | 196 | → `components/` |
| EditorBanners.tsx | 161 | → `components/` |
| useEditorSave.ts | 149 | → `libs/` |
| PersonaEditorHeader.tsx | 106 | → `components/` |
| PersonaDraft.ts | 94 | → `libs/` |
| EditorTabBar.tsx | 94 | → `components/` |
| useTabSection.ts | 77 | → `libs/` |
| editorTabConstants.ts | 45 | → `libs/` |
| useEffectivePersona.ts | 37 | → `libs/` |

## 1.5 sub_executions ⭐ CRITICAL — largest files
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| PersonaRunner.tsx | 1060 | **SPLIT** → `components/RunnerHeader.tsx`, `components/RunnerInputPanel.tsx`, `components/RunnerOutputPanel.tsx`, `components/RunnerToolCalls.tsx`, `components/RunnerStreamView.tsx`, `libs/useRunnerState.ts`, `libs/useRunnerExecution.ts`, `libs/runnerHelpers.ts` |
| PipelineWaterfall.tsx | 605 | **SPLIT** → `components/WaterfallStage.tsx`, `components/WaterfallTimeline.tsx`, `components/WaterfallTooltip.tsx`, `libs/waterfallHelpers.ts` |
| ReplaySandbox.tsx | 579 | **SPLIT** → `components/ReplayControls.tsx`, `components/ReplayTimeline.tsx`, `components/ReplayStateView.tsx`, `libs/useReplayState.ts` |
| ExecutionComparison.tsx | 574 | **SPLIT** → `components/ComparisonTable.tsx`, `components/ComparisonMetrics.tsx`, `components/ComparisonDiff.tsx`, `libs/comparisonHelpers.ts` |
| ExecutionList.tsx | 561 | **SPLIT** → `components/ExecutionListItem.tsx`, `components/ExecutionListFilters.tsx`, `libs/useExecutionList.ts` |
| ExecutionDetail.tsx | 558 | **SPLIT** → `components/DetailHeader.tsx`, `components/DetailSteps.tsx`, `components/DetailMetadata.tsx`, `libs/useExecutionDetail.ts` |
| TraceInspector.tsx | 475 | **SPLIT** → `components/TraceTree.tsx`, `components/TraceNodeDetail.tsx`, `libs/traceHelpers.ts` |
| ExecutionInspector.tsx | 322 | **SPLIT** → `components/InspectorTabs.tsx`, `components/InspectorPayload.tsx` |
| ExecutionTerminal.tsx | 91 | → `components/` |

## 1.6 sub_health
**Minimal — just move**
| File | Lines | Action |
|---|---|---|
| HealthTab.tsx | 25 | → `components/` (or leave as index re-export) |

## 1.7 sub_lab
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| AbPanel.tsx | 399 | **SPLIT** → extract config form + results view + `libs/useAbTest.ts` |
| ArenaPanel.tsx | 388 | **SPLIT** → extract arena config + matchup view + `libs/useArena.ts` |
| EvalPanel.tsx | 374 | **SPLIT** → extract eval config + eval runner + `libs/useEval.ts` |
| EvalResultsGrid.tsx | 348 | **SPLIT** → extract grid row + grid header + `libs/evalGridHelpers.ts` |
| MatrixPanel.tsx | 314 | **SPLIT** → extract matrix config + matrix view |
| MatrixResultsView.tsx | 245 | **SPLIT** → extract cell renderer + legend |
| ArenaResultsView.tsx | 199 | → `components/` |
| AbResultsView.tsx | 197 | → `components/` |
| VersionsPanel.tsx | 192 | → `components/` |
| LabTab.tsx | 85 | → `components/` (or root layout) |
| DraftDiffViewer.tsx | 79 | → `components/` |
| LabProgress.tsx | 61 | → `components/` |
| labUtils.ts | 18 | → `libs/` |

## 1.8 sub_lab_shared
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| VersionItem.tsx | 200 | → `components/` (at limit — ok) |
| labPrimitives.ts | 158 | → `libs/` |
| DiffViewer.tsx | 57 | → `components/` |
| index.ts | 8 | stays |

## 1.9 sub_model_config
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| ModelABCompare.tsx | 627 | **SPLIT** → `components/CompareHeader.tsx`, `components/CompareMetrics.tsx`, `components/CompareResultsTable.tsx`, `libs/useModelCompare.ts`, `libs/compareHelpers.ts` |
| ModelSelector.tsx | 199 | → `components/` |
| CustomModelConfigForm.tsx | 111 | → `components/` |
| ProviderCredentialField.tsx | 92 | → `components/` |
| BudgetControls.tsx | 70 | → `components/` |
| OllamaCloudPresets.ts | 53 | → `libs/` |
| OllamaApiKeyField.tsx | 28 | → `components/` |
| CopilotTokenField.tsx | 28 | → `components/` |
| CopilotPresets.ts | 28 | → `libs/` |
| SaveConfigButton.tsx | 24 | → `components/` |
| LiteLLMConfigField.tsx | 15 | → `components/` |
| index.ts | 18 | stays |

## 1.10 sub_prompt
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| PersonaPromptEditor.tsx | 213 | **SPLIT** → extract section list + editor toolbar |
| PromptSectionSidebar.tsx | 145 | → `components/` |
| CustomSectionsPanel.tsx | 97 | → `components/` |
| index.ts | 1 | stays |

## 1.11 sub_prompt_lab
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| PerformanceCharts.tsx | 276 | **SPLIT** → extract individual chart components |
| PromptPerformanceCard.tsx | 253 | **SPLIT** → extract card sections |
| WeeklyPerformanceReport.tsx | 218 | **SPLIT** → extract report sections |
| AbTestPanel.tsx | 207 | **SPLIT** → extract test config + results |
| PromptLabTab.tsx | 195 | → `components/` |
| PromptPerformanceDashboard.tsx | 185 | → `components/` |
| PerformanceWidgets.tsx | 155 | → `components/` |
| usePromptPerformanceSummary.ts | 151 | → `libs/` |
| usePromptVersions.ts | 121 | → `libs/` |
| AutoRollbackSettings.tsx | 96 | → `components/` |
| performanceHelpers.ts | 60 | → `libs/` |
| promptLabUtils.ts | 50 | → `libs/` |

## 1.12 sub_settings
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| PersonaSettingsTab.tsx | 205 | **SPLIT** → extract settings sections |
| index.ts | 1 | stays |

## 1.13 sub_tests
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| PersonaTestsTab.tsx | 561 | **SPLIT** → `components/TestSuiteList.tsx`, `components/TestCaseEditor.tsx`, `components/TestResultsView.tsx`, `libs/useTestRunner.ts`, `libs/testRunnerHelpers.ts` |
| TestSuiteManager.tsx | 307 | **SPLIT** → `components/SuiteEditor.tsx`, `components/SuiteList.tsx` |
| TestComparisonTable.tsx | 216 | **SPLIT** → extract table row + table header |
| testUtils.ts | 3 | → `libs/` |

## 1.14 sub_tool_runner
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| ToolInvocationCard.tsx | 185 | → `components/` |
| useToolRunner.ts | 65 | → `libs/` |
| ToolRunnerPanel.tsx | 40 | → `components/` |
| index.ts | 3 | stays |

## 1.15 sub_tools
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| ToolCardItems.tsx | 275 | **SPLIT** → extract individual card item types |
| useToolImpactData.ts | 212 | **SPLIT** → `libs/useToolImpactData.ts` + `libs/impactHelpers.ts` |
| ToolCategoryList.tsx | 210 | **SPLIT** → extract category item + category header |
| ToolImpactPanel.tsx | 193 | → `components/` |
| useToolSelectorState.ts | 175 | → `libs/` |
| ToolSearchFilter.tsx | 136 | → `components/` |
| ToolSelector.tsx | 94 | → `components/` |
| index.ts | 1 | stays |

## 1.16 sub_use_cases
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| ScheduleBuilder.tsx | 697 | **SPLIT** → `components/ScheduleForm.tsx`, `components/SchedulePreview.tsx`, `components/CronExpressionInput.tsx`, `components/RecurrenceSelector.tsx`, `libs/useScheduleBuilder.ts`, `libs/scheduleHelpers.ts` |
| UseCaseDetailPanel.tsx | 332 | **SPLIT** → extract detail sections + `libs/useUseCaseDetail.ts` |
| UseCaseSubscriptions.tsx | 255 | **SPLIT** → extract subscription list + subscription form |
| PersonaUseCasesTab.tsx | 230 | **SPLIT** → extract tab layout + tab header |
| UseCaseFixtureDropdown.tsx | 227 | **SPLIT** → extract dropdown list + dropdown item |
| UseCaseModelOverride.tsx | 200 | → `components/` (at limit — ok) |
| UseCaseTestRunner.tsx | 193 | → `components/` |
| UseCaseActiveItems.tsx | 152 | → `components/` |
| useCaseDetailHelpers.ts | 132 | → `libs/` |
| DefaultModelSection.tsx | 127 | → `components/` |
| UseCaseModelDropdown.tsx | 111 | → `components/` |
| UseCaseTabHeader.tsx | 97 | → `components/` |
| UseCaseListPanel.tsx | 86 | → `components/` |
| UseCaseSubscriptionForm.tsx | 85 | → `components/` |
| UseCaseModelOverrideForm.tsx | 72 | → `components/` |
| UseCaseChannelDropdown.tsx | 57 | → `components/` |
| useCaseHelpers.ts | 37 | → `libs/` |
| index.ts | 12 | stays |

---

# PHASE 2 — overview (10 sub_ folders + 2 empty)

## 2.1 sub_analytics
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| AnalyticsDashboard.tsx | 601 | **SPLIT** → `components/AnalyticsCharts.tsx`, `components/AnalyticsFilters.tsx`, `components/AnalyticsSummaryCards.tsx`, `components/AnalyticsTable.tsx`, `libs/useAnalyticsData.ts`, `libs/analyticsHelpers.ts` |

## 2.2 sub_budget — EMPTY, skip

## 2.3 sub_cron_agents
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| CronAgentsPage.tsx | 208 | **SPLIT** → extract agent list + agent card |

## 2.4 sub_events
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| EventLogList.tsx | 376 | **SPLIT** → `components/EventLogItem.tsx`, `components/EventLogFilters.tsx`, `libs/useEventLog.ts` |

## 2.5 sub_executions
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| ExecutionMetricsDashboard.tsx | 467 | **SPLIT** → `components/MetricsCards.tsx`, `components/MetricsCharts.tsx`, `components/MetricsFilters.tsx`, `libs/useExecutionMetrics.ts` |
| GlobalExecutionList.tsx | 359 | **SPLIT** → `components/ExecutionRow.tsx` (merge with existing), `components/ExecutionFilters.tsx`, `libs/useGlobalExecutionList.ts` |
| ExecutionRow.tsx | 106 | → `components/` |

## 2.6 sub_knowledge
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| KnowledgeGraphDashboard.tsx | 388 | **SPLIT** → `components/GraphVisualization.tsx`, `components/GraphControls.tsx`, `components/NodeDetailPanel.tsx`, `libs/useKnowledgeGraph.ts` |

## 2.7 sub_manual-review
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| ManualReviewList.tsx | 885 | **SPLIT** → `components/ReviewListItem.tsx`, `components/ReviewFilters.tsx`, `components/ReviewDetailPanel.tsx`, `components/ReviewActionBar.tsx`, `components/ReviewBulkActions.tsx`, `libs/useManualReview.ts`, `libs/reviewHelpers.ts` |

## 2.8 sub_memories
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| MemoryConflictReview.tsx | 427 | **SPLIT** → `components/ConflictCard.tsx`, `components/ConflictResolution.tsx`, `libs/useConflictReview.ts` |
| MemoriesPage.tsx | 369 | **SPLIT** → `components/MemoryListView.tsx`, `components/MemoryPageHeader.tsx`, `libs/useMemoriesPage.ts` |
| MemoryCard.tsx | 240 | **SPLIT** → extract card body + card actions |
| CreateMemoryForm.tsx | 227 | **SPLIT** → extract form fields + form actions |
| memoryConflicts.ts | 190 | → `libs/` |
| memoryActions.ts | 139 | → `libs/` |
| MemoryFilterBar.tsx | 114 | → `components/` |
| MemoryActionCard.tsx | 85 | → `components/` |

## 2.9 sub_messages
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| MessageList.tsx | 545 | **SPLIT** → `components/MessageItem.tsx`, `components/MessageFilters.tsx`, `components/MessageDetail.tsx`, `libs/useMessageList.ts` |

## 2.10 sub_observability
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| ObservabilityDashboard.tsx | 627 | **SPLIT** → `components/ObservabilityHeader.tsx`, `components/ObservabilityPanels.tsx`, `components/HealingTimeline.tsx`, `libs/useObservability.ts`, `libs/observabilityHelpers.ts` |
| HealingIssueModal.tsx | 247 | **SPLIT** → extract issue form + issue detail |
| IpcPerformancePanel.tsx | 212 | **SPLIT** → extract perf charts + perf table |
| MetricsCharts.tsx | 133 | → `components/` |
| OverviewStatCard.tsx | 132 | → `components/` |
| chartAnnotations.ts | 97 | → `libs/` |
| SpendOverview.tsx | 2 | → `components/` |

## 2.11 sub_realtime
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| EventBusVisualization.tsx | 654 | **SPLIT** → `components/BusVisualization.tsx`, `components/BusLaneGroup.tsx`, `components/BusControls.tsx`, `libs/useEventBus.ts`, `libs/busHelpers.ts` |
| EventBusFilterBar.tsx | 363 | **SPLIT** → `components/FilterBarControls.tsx`, `components/FilterPresets.tsx` |
| TimelinePlayer.tsx | 355 | **SPLIT** → `components/PlayerControls.tsx`, `components/PlayerTimeline.tsx`, `libs/useTimelinePlayer.ts` |
| RealtimeVisualizerPage.tsx | 147 | → `components/` |
| EventParticle.tsx | 142 | → `components/` |
| RealtimeStatsBar.tsx | 137 | → `components/` |
| EventDetailDrawer.tsx | 137 | → `components/` |
| eventBusFilterTypes.ts | 134 | → `libs/` |
| BusLane.tsx | 91 | → `components/` |
| useEventBusFilter.ts | 78 | → `libs/` |
| index.ts | 6 | stays |

## 2.12 sub_sla
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| SLADashboard.tsx | 352 | **SPLIT** → `components/SLACard.tsx`, `components/SLATable.tsx`, `components/SLAStatusBadge.tsx`, `libs/useSLAData.ts` |

## 2.13 sub_tier — EMPTY, skip

## 2.14 sub_usage
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| DashboardFilters.tsx | 249 | **SPLIT** → extract filter groups + filter chips |

## 2.15 sub_workflows
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| WorkflowsDashboard.tsx | 379 | **SPLIT** → `components/WorkflowList.tsx`, `components/WorkflowCard.tsx`, `libs/useWorkflows.ts` |

---

# PHASE 3 — pipeline (2 sub_ folders)

## 3.1 sub_canvas
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| DryRunDebugger.tsx | 558 | **SPLIT** → `components/DebuggerControls.tsx`, `components/DebuggerStepView.tsx`, `components/DebuggerVariables.tsx`, `libs/useDebugger.ts` |
| CanvasAssistant.tsx | 290 | **SPLIT** → extract assistant messages + assistant input |
| OptimizerPanel.tsx | 250 | **SPLIT** → extract optimizer results + optimizer controls |
| useCanvasReducer.ts | 224 | **SPLIT** → `libs/useCanvasReducer.ts` + `libs/canvasActions.ts` |
| useDerivedCanvasState.ts | 186 | → `libs/` |
| AlignmentGuides.tsx | 173 | → `components/` |
| PipelineControls.tsx | 165 | → `components/` |
| StickyNoteNode.tsx | 155 | → `components/` |
| PersonaNode.tsx | 155 | → `components/` |
| EdgeDeleteTooltip.tsx | 133 | → `components/` |
| TeamToolbar.tsx | 131 | → `components/` |
| ConnectionEdge.tsx | 115 | → `components/` |
| teamGraph.ts | 88 | → `libs/` |
| GhostEdge.tsx | 85 | → `components/` |
| NodeContextMenu.tsx | 73 | → `components/` |
| teamConstants.tsx | 69 | → `libs/` |
| ConnectionLegend.tsx | 39 | → `components/` |
| CanvasDragContext.tsx | 14 | → `libs/` (context provider) |

## 3.2 sub_teamMemory
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| MemoryTimeline.tsx | 297 | **SPLIT** → extract timeline item + timeline controls |
| TeamMemoryPanel.tsx | 293 | **SPLIT** → extract panel header + panel list |
| RunDiffView.tsx | 271 | **SPLIT** → extract diff header + diff content |
| TeamMemoryRow.tsx | 262 | **SPLIT** → extract row detail + row actions |
| AddTeamMemoryForm.tsx | 113 | → `components/` |
| memoryDiff.ts | 91 | → `libs/` |
| TeamMemoryBadge.tsx | 37 | → `components/` |
| memoryConstants.ts | 17 | → `libs/` |

---

# PHASE 4 — recipes (4 sub_ folders)

## 4.1 sub_editor
| File | Lines | Action |
|---|---|---|
| RecipeEditor.tsx | 188 | → `components/` (under 200 — ok) |

## 4.2 sub_list
| File | Lines | Action |
|---|---|---|
| LinkedRecipesSection.tsx | 159 | → `components/` |
| RecipeList.tsx | 119 | → `components/` |
| RecipePicker.tsx | 107 | → `components/` |
| RecipeCard.tsx | 105 | → `components/` |

## 4.3 sub_manager
| File | Lines | Action |
|---|---|---|
| RecipeManager.tsx | 173 | → `components/` |

## 4.4 sub_playground
| File | Lines | Action |
|---|---|---|
| RecipePlaygroundModal.tsx | 108 | → `components/` |
| useRecipeTestRunner.ts | 73 | → `libs/` |

---

# PHASE 5 — settings (7 sub_ folders)

## 5.1 sub_account
| File | Lines | Action |
|---|---|---|
| AccountSettings.tsx | 86 | → `components/` |

## 5.2 sub_admin
| File | Lines | Action |
|---|---|---|
| AdminSettings.tsx | 192 | → `components/` |

## 5.3 sub_appearance
| File | Lines | Action |
|---|---|---|
| AppearanceSettings.tsx | 171 | → `components/` |

## 5.4 sub_byom
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| ByomSettings.tsx | 615 | **SPLIT** → `components/ByomProviderList.tsx`, `components/ByomProviderForm.tsx`, `components/ByomTestPanel.tsx`, `libs/useByomSettings.ts`, `libs/byomHelpers.ts` |

## 5.5 sub_engine
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| EngineSettings.tsx | 226 | **SPLIT** → extract engine selector + engine config form |
| engineCapabilities.ts | 180 | → `libs/` |
| EngineCapabilityBadge.tsx | 64 | → `components/` |

## 5.6 sub_notifications
| File | Lines | Action |
|---|---|---|
| NotificationSettings.tsx | 192 | → `components/` |

## 5.7 sub_portability
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| DataPortabilitySettings.tsx | 438 | **SPLIT** → `components/ExportSection.tsx`, `components/ImportSection.tsx`, `components/PortabilityHistory.tsx`, `libs/useDataPortability.ts` |

---

# PHASE 6 — templates (2 sub_ folders)

## 6.1 sub_generated
**Already has nested structure (adoption/, gallery/, generation/, design-preview/, shared/). Apply components/ + libs/ within each sub-section.**

### adoption/
| File | Lines | Action |
|---|---|---|
| AdoptionWizardContext.tsx | 575 | **SPLIT** → `libs/AdoptionWizardContext.tsx` (context only ~100), `libs/useAdoptionWizard.ts`, `libs/adoptionTypes.ts`, `libs/adoptionHelpers.ts` |
| useAdoptReducer.ts | 468 | **SPLIT** → `libs/useAdoptReducer.ts` + `libs/adoptReducerActions.ts` |
| useAsyncTransform.ts | 453 | **SPLIT** → `libs/useAsyncTransform.ts` + `libs/transformHelpers.ts` |
| AdoptionWizardModal.tsx | 396 | **SPLIT** → `components/WizardHeader.tsx`, `components/WizardStepRenderer.tsx` |
| AdoptConfirmStep.tsx | 290 | **SPLIT** → extract confirm sections |
| templateVariables.ts | 151 | → `libs/` |
| index.ts | 21 | stays |

### adoption/steps/
| File | Lines | Action |
|---|---|---|
| InlineCredentialPanel.tsx | 637 | **SPLIT** → `CredentialForm.tsx`, `CredentialList.tsx`, `CredentialValidation.tsx` |
| DataStep.tsx | 533 | **SPLIT** → `DataSourcePicker.tsx`, `DataPreview.tsx`, `DataMapping.tsx` |
| TuneStep.tsx | 512 | **SPLIT** → `TuneForm.tsx`, `TunePreview.tsx`, `TuneAdvanced.tsx` |
| ConnectStep.tsx | 427 | **SPLIT** → `ConnectProviders.tsx`, `ConnectStatus.tsx` |
| CreateStep.tsx | 387 | **SPLIT** → `CreateForm.tsx`, `CreatePreview.tsx` |
| ChooseStep.tsx | 307 | **SPLIT** → `ChooseList.tsx`, `ChooseFilters.tsx` |
| BuildStep.tsx | 123 | → stays (under 200) |
| WizardSidebar.tsx | 139 | → stays (under 200) |
| UseCaseRow.tsx | 140 | → stays (under 200) |
| QuickAdoptConfirm.tsx | 87 | → stays |
| index.ts | 9 | stays |

### adoption/review/
| File | Lines | Action |
|---|---|---|
| TemplateReviewStep.tsx | 347 | **SPLIT** → `ReviewHeader.tsx`, `ReviewChecklist.tsx` |
| TriggerConfigPanel.tsx | 144 | → stays (under 200) |
| SelectionCheckbox.tsx | 39 | → stays |

### gallery/
| File | Lines | Action |
|---|---|---|
| GeneratedReviewsTab.tsx | 790 | **SPLIT** → `components/ReviewsHeader.tsx`, `components/ReviewsTable.tsx`, `components/ReviewsFilters.tsx`, `components/ReviewDetailModal.tsx`, `libs/useGeneratedReviews.ts` |
| TemplateCard.tsx | 452 | **SPLIT** → `components/CardHeader.tsx`, `components/CardBody.tsx`, `components/CardActions.tsx` |
| TemplateSearchBar.tsx | 379 | **SPLIT** → `components/SearchInput.tsx`, `components/SearchSuggestions.tsx` |
| TemplateDetailModal.tsx | 369 | **SPLIT** → `components/DetailHeader.tsx`, `components/DetailBody.tsx` |
| RebuildModal.tsx | 224 | **SPLIT** → extract form + preview |
| TemplatePreviewModal.tsx | 207 | **SPLIT** → extract preview sections |
| All files < 200 lines | — | → `components/` or `libs/` as appropriate |

### generation/
| File | Lines | Action |
|---|---|---|
| DesignReviewRunner.tsx | 576 | **SPLIT** → `components/ReviewSteps.tsx`, `components/ReviewResults.tsx`, `libs/useDesignReview.ts` |
| CreateTemplateModal.tsx | 514 | **SPLIT** → `components/CreateForm.tsx`, `components/CreatePreview.tsx`, `libs/useCreateTemplate.ts` |
| TemplateSourcePanel.tsx | 344 | **SPLIT** → `components/SourceSelector.tsx`, `components/SourcePreview.tsx` |
| useCreateTemplateReducer.ts | 204 | **SPLIT** → `libs/useCreateTemplateReducer.ts` + `libs/createTemplateActions.ts` |
| designRunnerConstants.ts | 129 | → `libs/` |
| index.ts | 21 | stays |

### design-preview/
All files < 200 lines — just restructure into `components/` + `libs/`

### shared/
| File | Lines | Action |
|---|---|---|
| DimensionRadial.tsx | 292 | **SPLIT** → extract radial chart + radial legend |
| ScanResultsBanner.tsx | 237 | **SPLIT** → extract banner content + banner actions |
| All files < 200 | — | → `components/` or `libs/` |

## 6.2 sub_n8n
**Restructure → components/ + libs/ (already has edit/, import/, reducers/)**
| File | Lines | Action |
|---|---|---|
| N8nUploadStep.tsx | 670 | **SPLIT** → `components/UploadDropzone.tsx`, `components/UploadPreview.tsx`, `components/UploadValidation.tsx`, `libs/useN8nUpload.ts` |
| N8nConfirmStep.tsx | 460 | **SPLIT** → `components/ConfirmSummary.tsx`, `components/ConfirmActions.tsx`, `libs/useN8nConfirm.ts` |
| useN8nWizard.ts | 386 | **SPLIT** → `libs/useN8nWizard.ts` + `libs/wizardHelpers.ts` |
| useN8nImportReducer.ts | 298 | **SPLIT** → `libs/useN8nImportReducer.ts` + `libs/importActions.ts` |
| N8nParserResults.tsx | 290 | **SPLIT** → extract result list + result detail |
| N8nSessionList.tsx | 278 | **SPLIT** → extract session item + session filters |
| useN8nTransform.ts | 267 | **SPLIT** → `libs/useN8nTransform.ts` + `libs/transformHelpers.ts` |
| useN8nSession.ts | 265 | **SPLIT** → `libs/useN8nSession.ts` + `libs/sessionHelpers.ts` |
| N8nImportTab.tsx | 259 | **SPLIT** → extract tab sections |
| N8nTransformChat.tsx | 249 | **SPLIT** → extract chat messages + chat input |
| N8nQuestionStepper.tsx | 224 | **SPLIT** → extract step item + step indicator |
| N8nEditStep.tsx | 219 | **SPLIT** → extract edit form + edit preview |
| StreamingSections.tsx | 218 | **SPLIT** → extract section renderers |
| All files < 200 | — | → `components/` or `libs/` as appropriate |

---

# PHASE 7 — vault (17 sub_ folders)

## 7.1 sub_autoCred
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| AutoCredBrowser.tsx | 578 | **SPLIT** → `components/BrowserFrame.tsx`, `components/BrowserControls.tsx`, `components/BrowserStepGuide.tsx`, `libs/useAutoCredBrowser.ts` |
| AutoCredPanel.tsx | 470 | **SPLIT** → `components/PanelHeader.tsx`, `components/PanelSteps.tsx`, `components/PanelResults.tsx`, `libs/useAutoCredPanel.ts` |
| AutoCredReview.tsx | 229 | **SPLIT** → extract review form + review summary |
| useAutoCredSession.ts | 227 | **SPLIT** → `libs/useAutoCredSession.ts` + `libs/sessionHelpers.ts` |
| CatalogAutoSetup.tsx | 174 | → `components/` |
| types.ts | 172 | → `libs/` |
| AutoCredConsent.tsx | 166 | → `components/` |
| TauriPlaywrightAdapter.ts | 147 | → `libs/` |

## 7.2 sub_card
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| CredentialCardHeader.tsx | 334 | **SPLIT** → extract header badges + header actions |
| CredentialCardDetails.tsx | 265 | **SPLIT** → extract detail sections |
| VaultStatusBadge.tsx | 171 | → `components/` |
| CredentialDeleteDialog.tsx | 123 | → `components/` |
| CredentialCardBody.tsx | 109 | → `components/` |
| RotationInsightBadge.tsx | 104 | → `components/` |
| OAuthActivityBadge.tsx | 93 | → `components/` |
| CredentialCard.tsx | 71 | → `components/` |
| ScopeMismatchBanner.tsx | 45 | → `components/` |
| VaultErrorBanner.tsx | 27 | → `components/` |

## 7.3 sub_databases
**Already has tabs/, __tests__ subdirs. Add components/ + libs/**
| File | Lines | Action |
|---|---|---|
| SqlEditor.tsx | 358 | **SPLIT** → `components/EditorToolbar.tsx`, `components/EditorPane.tsx`, `libs/useSqlEditor.ts` |
| DatabaseListView.tsx | 182 | → `components/` |
| SchemaManagerModal.tsx | 166 | → `components/` |
| QueryResultTable.tsx | 151 | → `components/` |
| introspectionQueries.ts | 72 | → `libs/` |
| DatabaseCard.tsx | 62 | → `components/` |

## 7.4 sub_design
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| CredentialDesignModal.tsx | 429 | **SPLIT** → `components/DesignModalHeader.tsx`, `components/DesignModalBody.tsx`, `components/DesignModalFooter.tsx`, `libs/useCredentialDesign.ts` |
| useCredentialDesignOrchestrator.ts | 363 | **SPLIT** → `libs/useCredentialDesignOrchestrator.ts` + `libs/orchestratorHelpers.ts` |
| CredentialDesignHelpers.ts | 303 | **SPLIT** → `libs/designHelpers.ts` + `libs/designValidation.ts` |
| PreviewPhase.tsx | 261 | **SPLIT** → extract preview sections |
| IdlePhase.tsx | 204 | **SPLIT** → extract idle content |
| InteractiveSetupInstructions.tsx | 186 | → `components/` |
| AnalyzingPhase.tsx | 163 | → `components/` |
| setupMarkdownComponents.tsx | 143 | → `components/` |
| ErrorPhase.tsx | 135 | → `components/` |
| setupInstructionHelpers.tsx | 119 | → `libs/` |
| DonePhase.tsx | 116 | → `components/` |
| CredentialDesignContext.tsx | 73 | → `libs/` |
| SetupStepCard.tsx | 60 | → `components/` |

## 7.5 sub_desktop
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| DesktopDiscoveryPanel.tsx | 501 | **SPLIT** → `components/DiscoveryHeader.tsx`, `components/DiscoveryResults.tsx`, `components/DiscoveryActions.tsx`, `libs/useDesktopDiscovery.ts` |

## 7.6 sub_features
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| CredentialIntelligence.tsx | 318 | **SPLIT** → `components/IntelligenceCards.tsx`, `components/IntelligenceChart.tsx` |
| RotationPolicyControls.tsx | 217 | **SPLIT** → extract policy form + policy list |
| CredentialEventConfig.tsx | 203 | **SPLIT** → extract config form + config list |
| EventConfigSubPanels.tsx | 196 | → `components/` |
| CredentialRotationSection.tsx | 117 | → `components/` |
| AnomalyScorePanel.tsx | 81 | → `components/` |

## 7.7 sub_foraging
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| ForagingPanel.tsx | 299 | **SPLIT** → `components/ForagingControls.tsx`, `components/ForagingResults.tsx`, `libs/useForaging.ts` |
| ForagingResultCard.tsx | 140 | → `components/` |

## 7.8 sub_forms
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| CredentialTemplateForm.tsx | 309 | **SPLIT** → extract form fields + form actions |
| CredentialEditForm.tsx | 306 | **SPLIT** → extract edit fields + validation section |
| ConnectorCredentialModal.tsx | 229 | **SPLIT** → extract modal body + modal actions |
| FieldCaptureRow.tsx | 193 | → `components/` |
| CredentialTypePicker.tsx | 163 | → `components/` |
| HealthcheckResultDisplay.tsx | 60 | → `components/` |

## 7.9 sub_graph
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| CredentialRelationshipGraph.tsx | 500 | **SPLIT** → `components/GraphCanvas.tsx`, `components/GraphLegend.tsx`, `components/GraphNodeTooltip.tsx`, `libs/useGraphLayout.ts` |
| credentialGraph.ts | 188 | → `libs/` |

## 7.10 sub_import
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| importTypes.ts | 356 | **SPLIT** → `libs/importTypes.ts` + `libs/importValidation.ts` |
| ImportPreview.tsx | 216 | **SPLIT** → extract preview table + preview actions |
| useCredentialImport.ts | 163 | → `libs/` |
| ImportInputPhase.tsx | 77 | → `components/` |
| ImportSourcePicker.tsx | 71 | → `components/` |
| index.ts | 5 | stays |

## 7.11 sub_list
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| CredentialList.tsx | 497 | **SPLIT** → `components/ListItem.tsx`, `components/ListFilters.tsx`, `components/ListHeader.tsx`, `libs/useCredentialList.ts` |
| CredentialPicker.tsx | 285 | **SPLIT** → `components/PickerDropdown.tsx`, `components/PickerItem.tsx` |
| SetupGuideModal.tsx | 143 | → `components/` |

## 7.12 sub_manager
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| CredentialManager.tsx | 612 | **SPLIT** → `components/ManagerHeader.tsx`, `components/ManagerList.tsx`, `components/ManagerActions.tsx`, `components/ManagerFilters.tsx`, `libs/useCredentialManager.ts` |
| BulkHealthcheckSummary.tsx | 96 | → `components/` |
| HealthStatusBar.tsx | 89 | → `components/` |

## 7.13 sub_negotiator
**Restructure → components/ + libs/**
All files < 200 — just move:
| File | Lines | Action |
|---|---|---|
| NegotiatorStepCard.tsx | 198 | → `components/` |
| NegotiatorPanel.tsx | 188 | → `components/` |
| NegotiatorStepCardHelpers.tsx | 185 | → `libs/` |
| NegotiatorGuidingPhase.tsx | 164 | → `components/` |
| NegotiatorPlanningPhase.tsx | 65 | → `components/` |

## 7.14 sub_playground
**Already has tabs/ subdir. Add components/ + libs/**
| File | Lines | Action |
|---|---|---|
| CredentialPlaygroundModal.tsx | 378 | **SPLIT** → `components/PlaygroundTabs.tsx`, `components/PlaygroundResults.tsx`, `libs/usePlayground.ts` |
| RequestBuilder.tsx | 247 | **SPLIT** → extract builder form + builder preview |
| useApiTestRunner.ts | 230 | **SPLIT** → `libs/useApiTestRunner.ts` + `libs/testRunnerHelpers.ts` |
| EndpointRow.tsx | 196 | → `components/` |
| ResponseViewer.tsx | 137 | → `components/` |

## 7.15 sub_schemas
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| CredentialSchemaForm.tsx | 263 | **SPLIT** → extract schema fields + schema preview |
| schemaConfigs.tsx | 243 | **SPLIT** → `libs/schemaConfigs.ts` + `libs/schemaDefaults.ts` |
| ExtraFieldRenderers.tsx | 161 | → `components/` |
| schemaFormTypes.ts | 96 | → `libs/` |
| McpPrefilledForm.tsx | 40 | → `components/` |

## 7.16 sub_wizard
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| WizardDetectPhase.tsx | 333 | **SPLIT** → `components/DetectResults.tsx`, `components/DetectControls.tsx`, `libs/useDetectPhase.ts` |
| WizardBatchPhase.tsx | 232 | **SPLIT** → `components/BatchList.tsx`, `components/BatchProgress.tsx` |
| ProvisioningWizard.tsx | 145 | → `components/` |
| WizardServiceSelect.tsx | 115 | → `components/` |

## 7.17 sub_workspace
**Restructure → components/ + libs/**
| File | Lines | Action |
|---|---|---|
| WorkspaceConnectPanel.tsx | 264 | **SPLIT** → `components/ConnectForm.tsx`, `components/ConnectStatus.tsx` |
| useWorkspaceConnect.ts | 163 | → `libs/` |
| workspaceProviders.ts | 91 | → `libs/` |

---

# Execution Order & Priority

| Priority | Phase | Sub_ folders | Files > 200 | Estimated splits |
|---|---|---|---|---|
| P0 | 1 — agents | 16 | ~40 | ~60 |
| P1 | 7 — vault | 17 | ~25 | ~40 |
| P2 | 2 — overview | 13 | ~15 | ~25 |
| P3 | 6 — templates | 2 (deep) | ~25 | ~35 |
| P4 | 3 — pipeline | 2 | ~8 | ~12 |
| P5 | 5 — settings | 7 | ~3 | ~5 |
| P6 | 4 — recipes | 4 | 0 | ~0 (move only) |

**Total: ~57 sub_ folders, ~116 files to split, ~177 new component/lib files to create**

---

# Import Update Strategy

After each sub_ folder restructure:
1. Update barrel `index.ts` at sub_ root to re-export from `components/` and `libs/`
2. Run `grep -r` for old import paths and update all consumers
3. Verify build passes before moving to next folder

# Naming Conventions
- Components: PascalCase `.tsx`
- Hooks: `use*.ts` in `libs/`
- Helpers/utils: camelCase `.ts` in `libs/`
- Types: `*Types.ts` or `types.ts` in `libs/`
- Constants: `*Constants.ts` or `constants.ts` in `libs/`
