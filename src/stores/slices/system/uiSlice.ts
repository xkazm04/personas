import { startTransition } from "react";
import type { StateCreator } from "zustand";
import { storeBus, AccessorKey } from "@/lib/storeBus";
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
  /**
   * Selected release version on the Home → "What's New" surface. Driven by
   * the sidebar Level 3 release nav; the page-body `<ReleasesNavBar>` was
   * retired in favour of putting the release picker into the sidebar push
   * pane. Defaults to `'roadmap'` so first-launch lands on the roadmap
   * timeline view, matching the L2 entry users click to enter L3.
   */
  homeReleaseVersion: string;
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
  /** Pending sub-tab applied when the Lifecycle page next mounts. Goals
   *  lives in its own DevTools tab now, so any handoff that wants to
   *  surface goals should call setDevToolsTab('goals') directly. */
  pendingLifecycleSubTab: 'setup' | 'competitions' | 'tracking' | null;
  /** Pending task ID to scroll-into-view + highlight when TaskRunner next mounts (e.g. from a goal-spotlight task click). */
  pendingTaskFocusId: string | null;
  /** Pending goal ID to seed the Pulse variant of GoalConstellation on next mount (e.g. from a ContextMap goal-coverage badge click). */
  pendingGoalSpotlightId: string | null;

  // Canvas <-> Live Stream cross-linking
  canvasEdgeFocus: { edgeId: string; eventType: string; sourceFilter: string | null } | null;
  liveStreamHighlightEventId: string | null;

  /**
   * Whether the full-screen Persona Monitor overlay is open. Lifted to the
   * store (from local titlebar state) so the companion — Athena — can open
   * it via her `open_route` "monitor" pseudo-route when the user asks for a
   * fleet overview.
   */
  monitorOpen: boolean;

  /**
   * Whether the Monitor grid should be partitioned by PersonaGroup. Persisted
   * (via the SystemStore's persist middleware) so re-opening the Monitor
   * preserves the user's last view choice across the entire session and across
   * app restarts. `'none'` = flat grid (default); `'group'` = collapsible
   * sections per group + an Ungrouped bucket.
   */
  monitorGroupBy: 'none' | 'group';

  /**
   * Set of group ids the user has collapsed in the Monitor's group view.
   * Stored as a string[] (not Set<string>) because the persist middleware
   * uses JSON serialization and a Set would be stringified to "{}".
   * `'__ungrouped__'` is the sentinel id for the ungrouped section.
   */
  monitorCollapsedGroups: string[];

  /**
   * Ids of below-the-fold Home (Mission Control) sections the user has hidden
   * via the dashboard Customize popover. Stored as a string[] (not Set) so the
   * persist middleware can JSON-serialize it. Empty = every section visible.
   */
  homeHiddenSections: string[];

  // Actions
  setSidebarSection: (section: SidebarSection) => void;
  setMonitorOpen: (open: boolean) => void;
  setMonitorGroupBy: (mode: 'none' | 'group') => void;
  toggleMonitorGroupCollapsed: (groupId: string) => void;
  toggleHomeSection: (sectionId: string) => void;
  resetHomeSections: () => void;
  setHomeTab: (tab: HomeTab) => void;
  setHomeReleaseVersion: (version: string) => void;
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
  setPendingLifecycleSubTab: (tab: 'setup' | 'competitions' | 'tracking' | null) => void;
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
   * Most-recent-first stack of locations the user navigated *away from*.
   * Capped at {@link NAV_HISTORY_MAX} so memory pressure stays trivial.
   *
   * A {@link NavEntry} is module-aware: it pairs the sidebar section with the
   * selected persona id, so the back button can step back through agents the
   * user was viewing inside the Agents module — not just across sidebar
   * sections. `setSidebarSection` pushes the outgoing location on a section
   * change; the `persona:selected` storeBus handler pushes it on a persona
   * switch; `navigateBack` pops the head and restores both without re-pushing.
   */
  navigationHistory: NavEntry[];
  /** Append an outgoing location to the back stack (dedups the consecutive head). */
  pushNavEntry: (entry: NavEntry) => void;
  navigateBack: () => void;
}

/** A single back-history location — section + which persona was selected there. */
export interface NavEntry {
  section: SidebarSection;
  personaId: string | null;
}

/** Cap on the back-history depth. */
export const NAV_HISTORY_MAX = 5;

/**
 * True while {@link UiSlice.navigateBack} is restoring a location. The
 * `persona:selected` storeBus handler consults this so the `selectPersona`
 * call it makes during a restore does NOT push a fresh history entry (which
 * would make "back" un-poppable). Module-scoped rather than store state so
 * cross-store wiring can read it without a circular import.
 */
let navRestoring = false;
export function isNavRestoring(): boolean {
  return navRestoring;
}

/** Current selected persona id, read via storeBus so uiSlice avoids importing agentStore. */
function currentSelectedPersonaId(): string | null {
  try {
    return storeBus.get<string | undefined>(AccessorKey.AGENTS_SELECTED_PERSONA_ID) ?? null;
  } catch {
    // Accessor not yet registered (e.g. unit tests, pre-initStoreBus boot).
    return null;
  }
}

export const createUiSlice: StateCreator<SystemStore, [], [], UiSlice> = (set, get) => ({
  sidebarSection: "home" as SidebarSection,
  monitorOpen: false,
  monitorGroupBy: 'none' as const,
  monitorCollapsedGroups: [],
  homeHiddenSections: [],
  homeTab: "welcome" as HomeTab,
  homeReleaseVersion: "roadmap",
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

  setMonitorOpen: (open) => set({ monitorOpen: open }),
  setMonitorGroupBy: (mode) => set({ monitorGroupBy: mode }),
  toggleHomeSection: (sectionId) =>
    set((state) => {
      const idx = state.homeHiddenSections.indexOf(sectionId);
      return idx >= 0
        ? { homeHiddenSections: state.homeHiddenSections.filter((_, i) => i !== idx) }
        : { homeHiddenSections: [...state.homeHiddenSections, sectionId] };
    }),
  resetHomeSections: () => set({ homeHiddenSections: [] }),
  toggleMonitorGroupCollapsed: (groupId) =>
    set((state) => {
      const idx = state.monitorCollapsedGroups.indexOf(groupId);
      return idx >= 0
        ? { monitorCollapsedGroups: state.monitorCollapsedGroups.filter((_, i) => i !== idx) }
        : { monitorCollapsedGroups: [...state.monitorCollapsedGroups, groupId] };
    }),

  setSidebarSection: (section) => startTransition(() => set((state) => {
    // Idempotent — re-clicking the current section is a no-op for history.
    if (state.sidebarSection === section) return { sidebarSection: section };
    // While restoring a back-step, swap the section without recording it.
    if (navRestoring) return { sidebarSection: section };
    // Capture the full outgoing location (section + which persona was open).
    const entry: NavEntry = { section: state.sidebarSection, personaId: currentSelectedPersonaId() };
    const next = [entry, ...state.navigationHistory].slice(0, NAV_HISTORY_MAX);
    return { sidebarSection: section, navigationHistory: next };
  })),
  setHomeTab: (tab) => startTransition(() => set({ homeTab: tab })),
  setHomeReleaseVersion: (version) => startTransition(() => set({ homeReleaseVersion: version })),
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
  enabledPlugins: new Set<PluginTab>([
    'dev-tools', 'artist', 'obsidian-brain', 'research-lab', 'drive', 'twin', 'companion',
  ]),
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

  pushNavEntry: (entry) => set((state) => {
    if (navRestoring) return state;
    const head = state.navigationHistory[0];
    // Dedup the consecutive head — repeated identical locations add no value.
    if (head && head.section === entry.section && head.personaId === entry.personaId) {
      return state;
    }
    return { navigationHistory: [entry, ...state.navigationHistory].slice(0, NAV_HISTORY_MAX) };
  }),

  navigateBack: () => startTransition(() => {
    const [head, ...rest] = get().navigationHistory;
    if (!head) return;
    navRestoring = true;
    try {
      // Restore persona selection first. selectPersona emits `persona:selected`,
      // which the storeBus handler turns into a section→personas swap; the
      // navRestoring guard keeps that from pushing a fresh entry. We then set
      // the section explicitly to the recorded one (which may not be personas).
      storeBus.emit('nav:select-persona', { personaId: head.personaId });
      set({ sidebarSection: head.section, navigationHistory: rest });
    } finally {
      navRestoring = false;
    }
  }),
});
