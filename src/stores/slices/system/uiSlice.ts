import { startTransition } from "react";
import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import type { SidebarSection, HomeTab, EditorTab, DesignSubTab, TemplateTab, CloudTab, SettingsTab, DevToolsTab, AgentTab, PluginTab, EventBusTab, ResearchLabTab } from "@/lib/types/types";
import type { CompanionCockpitSpecBody } from "@/api/companion";

/**
 * Transient cockpit overlay set by surfaces like the Overview > Messages
 * detail modal. While set, `CockpitPanel` renders this spec instead of the
 * persistent LLM-composed one; clearing it restores the persistent view.
 * Never persisted — resets to null on each app launch.
 */
export interface ContextualCockpit {
  /** What triggered the overlay — drives the dismiss banner copy. */
  source: { kind: 'message'; messageId: string; messageTitle: string };
  /** Widget spec body — same shape Athena emits via compose_cockpit. */
  spec: CompanionCockpitSpecBody;
}
/** Snapshot of adoption wizard state saved when the user closes mid-adoption. */
export interface AdoptionDraft {
  reviewId: string;
  templateName: string;
  step: string;
  connectorSwaps: Record<string, string>;
  connectorCredentialMap: Record<string, string>;
  variableValues: Record<string, string>;
  savedAt: number;
  // Extended fields -- persisted for full session restore
  triggerConfigs?: Record<number, Record<string, string>>;
  requireApproval?: boolean;
  autoApproveSeverity?: string;
  reviewTimeout?: string;
  memoryEnabled?: boolean;
  memoryScope?: string;
  userAnswers?: Record<string, string>;
  /** Non-null when the user closed while a background transform was running. */
  backgroundAdoptId?: string | null;
  /** Persisted entity selections (Phase C -- Area #13) */
  selectedUseCaseIds?: string[];
}

export interface UiSlice {
  // State
  sidebarSection: SidebarSection;
  homeTab: HomeTab;
  templateTab: TemplateTab;
  agentTab: AgentTab;
  editorTab: EditorTab;
  /** Sub-tab inside the Design hub (absorbs former Prompt / Connectors / Health tabs). */
  designSubTab: DesignSubTab;
  cloudTab: CloudTab;
  settingsTab: SettingsTab;
  rerunInputData: string | null;
  isLoading: boolean;
  error: string | null;
  n8nTransformActive: boolean;
  templateAdoptActive: boolean;
  showDesignNudge: boolean;
  showCloudNudge: boolean;
  isCreatingPersona: boolean;
  autoStartDesignInstruction: string | null;
  rebuildActive: boolean;
  templateTestActive: boolean;
  connectorTestActive: boolean;
  templateGalleryTotal: number;
  pluginTab: PluginTab;
  devToolsTab: DevToolsTab;
  eventBusTab: EventBusTab;
  researchLabTab: ResearchLabTab;
  adoptionDraft: AdoptionDraft | null;
  contextScanActive: boolean;
  contextScanComplete: boolean;
  /** Pending category filter applied when the credentials catalog next mounts. */
  pendingCatalogCategoryFilter: string | null;
  /** Pending sub-tab applied when the Lifecycle page next mounts (e.g. jump-to-goals from a Task Runner goal pill). */
  pendingLifecycleSubTab: 'setup' | 'goals' | 'competitions' | 'tracking' | null;
  /** Pending task ID to scroll-into-view + highlight when TaskRunner next mounts (e.g. from a goal-spotlight task click). */
  pendingTaskFocusId: string | null;
  /** Pending goal ID to seed the Pulse variant of GoalConstellation on next mount (e.g. from a ContextMap goal-coverage badge click). */
  pendingGoalSpotlightId: string | null;

  // Canvas <-> Live Stream cross-linking
  canvasEdgeFocus: { edgeId: string; eventType: string; sourceFilter: string | null } | null;
  liveStreamHighlightEventId: string | null;

  // Actions
  setSidebarSection: (section: SidebarSection) => void;
  setHomeTab: (tab: HomeTab) => void;
  setTemplateTab: (tab: TemplateTab) => void;
  setAgentTab: (tab: AgentTab) => void;
  /** Accepts current EditorTab values plus legacy 'prompt' | 'connectors' | 'health', which are migrated to `design` with the matching sub-tab. */
  setEditorTab: (tab: EditorTab | "prompt" | "connectors" | "health") => void;
  setDesignSubTab: (tab: DesignSubTab) => void;
  setCloudTab: (tab: CloudTab) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  setRerunInputData: (data: string | null) => void;
  setError: (error: string | null) => void;
  setN8nTransformActive: (active: boolean) => void;
  setTemplateAdoptActive: (active: boolean) => void;
  setShowDesignNudge: (show: boolean) => void;
  setShowCloudNudge: (show: boolean) => void;
  setIsCreatingPersona: (creating: boolean) => void;
  setAutoStartDesignInstruction: (instruction: string | null) => void;
  setRebuildActive: (active: boolean) => void;
  setTemplateTestActive: (active: boolean) => void;
  setConnectorTestActive: (active: boolean) => void;
  setTemplateGalleryTotal: (total: number) => void;
  setAdoptionDraft: (draft: AdoptionDraft | null) => void;
  setPluginTab: (tab: PluginTab) => void;
  setDevToolsTab: (tab: DevToolsTab) => void;
  setEventBusTab: (tab: EventBusTab) => void;
  setResearchLabTab: (tab: ResearchLabTab) => void;
  setContextScanActive: (active: boolean) => void;
  setContextScanComplete: (complete: boolean) => void;
  setPendingCatalogCategoryFilter: (category: string | null) => void;
  setPendingLifecycleSubTab: (tab: 'setup' | 'goals' | 'competitions' | 'tracking' | null) => void;
  setPendingTaskFocusId: (id: string | null) => void;
  setPendingGoalSpotlightId: (id: string | null) => void;
  setCanvasEdgeFocus: (focus: { edgeId: string; eventType: string; sourceFilter: string | null } | null) => void;
  setLiveStreamHighlightEventId: (id: string | null) => void;
  // Plugin enable/disable
  enabledPlugins: Set<PluginTab>;
  togglePlugin: (plugin: PluginTab) => void;

  // Feedback-driven persona improvement
  feedbackImprovementPersonaId: string | null;
  feedbackImprovementComplete: boolean;
  setFeedbackImprovementPersonaId: (id: string | null) => void;
  setFeedbackImprovementComplete: (complete: boolean) => void;

  /** Transient contextual cockpit overlay — see {@link ContextualCockpit}. */
  contextualCockpit: ContextualCockpit | null;
  setContextualCockpit: (c: ContextualCockpit | null) => void;

  /**
   * Most-recent-first stack of sidebar sections the user navigated *away
   * from*. Capped at {@link NAV_HISTORY_MAX} so memory pressure stays
   * trivial. `setSidebarSection` pushes the previous section before
   * swapping; `navigateBack` pops the head and applies it without
   * re-pushing.
   */
  navigationHistory: SidebarSection[];
  navigateBack: () => void;
}

/** Cap on the back-history depth. */
export const NAV_HISTORY_MAX = 5;

export const createUiSlice: StateCreator<SystemStore, [], [], UiSlice> = (set) => ({
  sidebarSection: "home" as SidebarSection,
  homeTab: "welcome" as HomeTab,
  templateTab: "generated" as TemplateTab,
  agentTab: "all" as AgentTab,
  editorTab: "activity" as EditorTab,
  designSubTab: "use-cases" as DesignSubTab,
  cloudTab: "unified" as CloudTab,
  settingsTab: "account" as SettingsTab,
  rerunInputData: null,
  isLoading: false,
  error: null,
  n8nTransformActive: false,
  templateAdoptActive: false,
  showDesignNudge: false,
  showCloudNudge: false,
  isCreatingPersona: false,
  autoStartDesignInstruction: null,
  rebuildActive: false,
  templateTestActive: false,
  connectorTestActive: false,
  templateGalleryTotal: 0,
  pluginTab: "browse" as PluginTab,
  devToolsTab: "projects" as DevToolsTab,
  eventBusTab: "live-stream" as EventBusTab,
  researchLabTab: "dashboard" as ResearchLabTab,
  adoptionDraft: null,
  contextScanActive: false,
  contextScanComplete: false,
  pendingCatalogCategoryFilter: null,
  pendingLifecycleSubTab: null,
  pendingTaskFocusId: null,
  pendingGoalSpotlightId: null,
  canvasEdgeFocus: null,
  liveStreamHighlightEventId: null,

  setSidebarSection: (section) => startTransition(() => set((state) => {
    // Idempotent — re-clicking the current section is a no-op for history.
    if (state.sidebarSection === section) return { sidebarSection: section };
    const next = [state.sidebarSection, ...state.navigationHistory].slice(0, NAV_HISTORY_MAX);
    return { sidebarSection: section, navigationHistory: next };
  })),
  setHomeTab: (tab) => startTransition(() => set({ homeTab: tab })),
  setTemplateTab: (tab) => startTransition(() => set({ templateTab: tab })),
  setAgentTab: (tab) => startTransition(() => set({ agentTab: tab })),
  setEditorTab: (tab) => startTransition(() => {
    // Migrate legacy tab IDs → design hub with the matching sub-tab.
    if (tab === "prompt") return set({ editorTab: "design", designSubTab: "prompt" });
    if (tab === "connectors") return set({ editorTab: "design", designSubTab: "connectors" });
    if (tab === "health") return set({ editorTab: "design", designSubTab: "prompt" });
    // Use Cases moved from a top-level tab into the Design hub.
    if (tab === "use-cases") return set({ editorTab: "design", designSubTab: "use-cases" });
    set({ editorTab: tab });
  }),
  setDesignSubTab: (tab) => startTransition(() => set({ designSubTab: tab })),
  setCloudTab: (tab) => startTransition(() => set({ cloudTab: tab })),
  setSettingsTab: (tab) => startTransition(() => set({ settingsTab: tab })),
  setRerunInputData: (data) => set({ rerunInputData: data }),
  setError: (error) => set({ error }),
  setN8nTransformActive: (active) => set({ n8nTransformActive: active }),
  setTemplateAdoptActive: (active) => set({ templateAdoptActive: active }),
  setShowDesignNudge: (show) => set({ showDesignNudge: show }),
  setShowCloudNudge: (show) => set({ showCloudNudge: show }),
  setIsCreatingPersona: (creating) => set({ isCreatingPersona: creating }),
  setAutoStartDesignInstruction: (instruction) => set({ autoStartDesignInstruction: instruction }),
  setRebuildActive: (active) => set({ rebuildActive: active }),
  setTemplateTestActive: (active) => set({ templateTestActive: active }),
  setConnectorTestActive: (active) => set({ connectorTestActive: active }),
  setTemplateGalleryTotal: (total) => set({ templateGalleryTotal: total }),
  setAdoptionDraft: (draft) => set({ adoptionDraft: draft }),
  setPluginTab: (tab) => set({ pluginTab: tab }),
  setDevToolsTab: (tab) => set({ devToolsTab: tab }),
  setResearchLabTab: (tab) => startTransition(() => set({ researchLabTab: tab })),
  setEventBusTab: (tab) => startTransition(() => set({ eventBusTab: tab })),
  setContextScanActive: (active) => set({ contextScanActive: active }),
  setContextScanComplete: (complete) => set({ contextScanComplete: complete }),
  setPendingCatalogCategoryFilter: (category) => set({ pendingCatalogCategoryFilter: category }),
  setPendingLifecycleSubTab: (tab) => set({ pendingLifecycleSubTab: tab }),
  setPendingTaskFocusId: (id) => set({ pendingTaskFocusId: id }),
  setPendingGoalSpotlightId: (id) => set({ pendingGoalSpotlightId: id }),
  setCanvasEdgeFocus: (focus) => set({ canvasEdgeFocus: focus }),
  setLiveStreamHighlightEventId: (id) => set({ liveStreamHighlightEventId: id }),
  enabledPlugins: new Set<PluginTab>(['dev-tools', 'artist', 'obsidian-brain', 'research-lab', 'drive', 'twin', 'companion']),
  togglePlugin: (plugin) => set((state) => {
    const next = new Set(state.enabledPlugins);
    if (next.has(plugin)) {
      next.delete(plugin);
      // Reset to browse if the disabled plugin was active
      if (state.pluginTab === plugin) return { enabledPlugins: next, pluginTab: 'browse' as PluginTab };
    } else {
      next.add(plugin);
    }
    return { enabledPlugins: next };
  }),
  feedbackImprovementPersonaId: null,
  feedbackImprovementComplete: false,
  setFeedbackImprovementPersonaId: (id) => set({ feedbackImprovementPersonaId: id }),
  setFeedbackImprovementComplete: (complete) => set({ feedbackImprovementComplete: complete }),

  contextualCockpit: null,
  setContextualCockpit: (contextualCockpit) => set({ contextualCockpit }),

  navigationHistory: [],
  navigateBack: () => startTransition(() => set((state) => {
    const [head, ...rest] = state.navigationHistory;
    if (!head) return state;
    return { sidebarSection: head, navigationHistory: rest };
  })),
});
