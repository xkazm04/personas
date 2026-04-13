import { startTransition } from "react";
import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import type { SidebarSection, HomeTab, EditorTab, TemplateTab, CloudTab, SettingsTab, DevToolsTab, AgentTab, PluginTab, EventBusTab, ResearchLabTab } from "@/lib/types/types";
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
  /** Dormant field — preserved for legacy storeBus event handling until callers (storeBusWiring.ts, tests) are updated in a follow-up cleanup. */
  resumeDraftId: string | null;
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

  // Canvas <-> Live Stream cross-linking
  canvasEdgeFocus: { edgeId: string; eventType: string; sourceFilter: string | null } | null;
  liveStreamHighlightEventId: string | null;

  // Actions
  setSidebarSection: (section: SidebarSection) => void;
  setHomeTab: (tab: HomeTab) => void;
  setTemplateTab: (tab: TemplateTab) => void;
  setAgentTab: (tab: AgentTab) => void;
  setEditorTab: (tab: EditorTab) => void;
  setCloudTab: (tab: CloudTab) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  setRerunInputData: (data: string | null) => void;
  setError: (error: string | null) => void;
  setN8nTransformActive: (active: boolean) => void;
  setTemplateAdoptActive: (active: boolean) => void;
  setShowDesignNudge: (show: boolean) => void;
  setShowCloudNudge: (show: boolean) => void;
  setIsCreatingPersona: (creating: boolean) => void;
  setResumeDraftId: (id: string | null) => void;
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
}

export const createUiSlice: StateCreator<SystemStore, [], [], UiSlice> = (set) => ({
  sidebarSection: "home" as SidebarSection,
  homeTab: "welcome" as HomeTab,
  templateTab: "generated" as TemplateTab,
  agentTab: "all" as AgentTab,
  editorTab: "activity" as EditorTab,
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
  resumeDraftId: null,
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
  canvasEdgeFocus: null,
  liveStreamHighlightEventId: null,

  setSidebarSection: (section) => startTransition(() => set({ sidebarSection: section })),
  setHomeTab: (tab) => startTransition(() => set({ homeTab: tab })),
  setTemplateTab: (tab) => startTransition(() => set({ templateTab: tab })),
  setAgentTab: (tab) => startTransition(() => set({ agentTab: tab })),
  setEditorTab: (tab) => startTransition(() => set({ editorTab: tab })),
  setCloudTab: (tab) => startTransition(() => set({ cloudTab: tab })),
  setSettingsTab: (tab) => startTransition(() => set({ settingsTab: tab })),
  setRerunInputData: (data) => set({ rerunInputData: data }),
  setError: (error) => set({ error }),
  setN8nTransformActive: (active) => set({ n8nTransformActive: active }),
  setTemplateAdoptActive: (active) => set({ templateAdoptActive: active }),
  setShowDesignNudge: (show) => set({ showDesignNudge: show }),
  setShowCloudNudge: (show) => set({ showCloudNudge: show }),
  setIsCreatingPersona: (creating) => set({ isCreatingPersona: creating }),
  setResumeDraftId: (id) => set({ resumeDraftId: id }),
  setAutoStartDesignInstruction: (instruction) => set({ autoStartDesignInstruction: instruction }),
  setRebuildActive: (active) => set({ rebuildActive: active }),
  setTemplateTestActive: (active) => set({ templateTestActive: active }),
  setConnectorTestActive: (active) => set({ connectorTestActive: active }),
  setTemplateGalleryTotal: (total) => set({ templateGalleryTotal: total }),
  setAdoptionDraft: (draft) => set({ adoptionDraft: draft }),
  setPluginTab: (tab) => set({ pluginTab: tab }),
  setDevToolsTab: (tab) => set({ devToolsTab: tab }),
  setResearchLabTab: (tab) => startTransition(() => set({ researchLabTab: tab })),
  setEventBusTab: (tab) => set({ eventBusTab: tab }),
  setContextScanActive: (active) => set({ contextScanActive: active }),
  setContextScanComplete: (complete) => set({ contextScanComplete: complete }),
  setPendingCatalogCategoryFilter: (category) => set({ pendingCatalogCategoryFilter: category }),
  setCanvasEdgeFocus: (focus) => set({ canvasEdgeFocus: focus }),
  setLiveStreamHighlightEventId: (id) => set({ liveStreamHighlightEventId: id }),
  enabledPlugins: new Set<PluginTab>(['dev-tools', 'ocr', 'artist', 'obsidian-brain', 'research-lab', 'drive']),
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
});
