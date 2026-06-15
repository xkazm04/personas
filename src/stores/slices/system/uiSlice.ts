import { startTransition } from "react";
import type { StateCreator } from "zustand";
import { storeBus, AccessorKey } from "@/lib/storeBus";
import type { SystemStore } from "../../storeTypes";
import type { SidebarSection, HomeTab, GoalsTab, KpisTab, TeamsTab, EditorTab, DesignSubTab, TemplateTab, CloudTab, SettingsTab, DevToolsTab, AgentTab, PluginTab, EventBusTab, ResearchLabTab } from "@/lib/types/types";
import type { CompanionCockpitSpecBody } from "@/api/companion";

/**
 * Transient cockpit overlay set by surfaces like the Overview > Messages
 * detail modal. While set, `CockpitPanel` renders this spec instead of the
 * persistent LLM-composed one; clearing it restores the persistent view.
 * Never persisted — resets to null on each app launch.
 */
export interface ContextualCockpit {
  /** What triggered the overlay — drives the dismiss banner copy. */
  source:
    | { kind: 'message'; messageId: string; messageTitle: string }
    | {
        /** Athena's `explain_in_cockpit` op — the orb decision `0` flow. */
        kind: 'explain';
        decisionId: string;
        decisionTitle: string;
      };
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

/**
 * The header overlay surfaces that are mutually exclusive — only one can be
 * open at a time. `setHeaderOverlay` is the single source of truth that the
 * titlebar buttons, the Monitor mount, and the Notification center all read,
 * so opening one structurally closes the other.
 */
export type HeaderOverlay = 'none' | 'monitor' | 'notifications' | 'quick-answer';

export interface UiSlice {
  // State
  sidebarSection: SidebarSection;
  homeTab: HomeTab;
  goalsTab: GoalsTab;
  /** Sub-view within the KPIs hub (sidebar sub-items mirror GoalsTab). */
  kpisTab: KpisTab;
  /** L2 inside the Teams section: workspace (canvas/Studio) or the Goals hub. */
  teamsTab: TeamsTab;
  /**
   * Selected release version on the Home → "What's New" surface. Driven by
   * the in-content `ReleaseNavRail` (the left rail inside `HomeReleases`).
   * The earlier sidebar Level 3 push pane and the still-earlier page-body
   * `<ReleasesNavBar>` were both retired — selection now lives next to the
   * content it scopes. Defaults to `'roadmap'` so first-launch lands on the
   * roadmap timeline view. Persisted to `sessionStorage`
   * (`home-releases-selected-version`) for in-session continuity.
   */
  homeReleaseVersion: string;
  /**
   * The app version (from `getVersion()`) the user last acknowledged on the
   * "What's New" surface. `null` until the first launch records a baseline.
   * When this differs from the running version the "What's New" dot lights
   * up on the Home (L1) and Roadmap (L2) sidebar entries; viewing the page
   * or clicking the dot re-acknowledges the current version and clears it.
   * Persisted so the dot doesn't re-appear on every relaunch.
   */
  whatsNewSeenVersion: string | null;
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
   * Which header overlay is currently open — the mutually-exclusive controller
   * for the Monitor and Notifications surfaces (one enum can't hold two open
   * overlays). Transient (never persisted). Athena opens the Monitor through
   * the `setMonitorOpen(true)` shim for her `open_route` "monitor" pseudo-route.
   */
  headerOverlay: HeaderOverlay;

  /**
   * Whether `;` keyboard-nav mode is active. `KeyboardNavMode` owns the
   * toggle (`;` / Esc); surfaces that render key hints while the mode is on
   * (the title-bar dock) read it and register their own key handlers.
   * Transient — deliberately NOT in the persist partialize whitelist.
   */
  keyboardNavActive: boolean;
  setKeyboardNavActive: (active: boolean) => void;

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
   * Whether the live-mode corner pop-up layer is on — incoming team-channel
   * messages surface as bottom-right pop-ups app-wide (the `LiveChannelOverlay`
   * at App root). Persisted; surfaced as a toggle in the Channels → Timeline
   * view. Defaults on so the feature is discoverable.
   */
  monitorLiveMode: boolean;

  /**
   * Transient deep-link telling the Monitor which view to open into on its next
   * mount (or while already open). `'channels'` lands on the merged Timeline —
   * set by a live pop-up's "open in Timeline" click. Cleared once consumed.
   * Never persisted.
   */
  monitorInitialView: 'fleet' | 'channels' | null;

  /**
   * Ids of below-the-fold Home (Mission Control) sections the user has hidden
   * via the dashboard Customize popover. Stored as a string[] (not Set) so the
   * persist middleware can JSON-serialize it. Empty = every section visible.
   */
  homeHiddenSections: string[];

  // Actions
  setSidebarSection: (section: SidebarSection) => void;
  /** Open / close / switch the active header overlay (mutually exclusive). */
  setHeaderOverlay: (overlay: HeaderOverlay) => void;
  /** Back-compat shim — maps to `setHeaderOverlay('monitor' | 'none')`. */
  setMonitorOpen: (open: boolean) => void;
  setMonitorGroupBy: (mode: 'none' | 'group') => void;
  toggleMonitorGroupCollapsed: (groupId: string) => void;
  setMonitorLiveMode: (on: boolean) => void;
  toggleMonitorLiveMode: () => void;
  setMonitorInitialView: (view: 'fleet' | 'channels' | null) => void;
  toggleHomeSection: (sectionId: string) => void;
  resetHomeSections: () => void;
  setHomeTab: (tab: HomeTab) => void;
  setGoalsTab: (tab: GoalsTab) => void;
  setKpisTab: (tab: KpisTab) => void;
  setTeamsTab: (tab: TeamsTab) => void;
  setHomeReleaseVersion: (version: string) => void;
  /** Record `version` as the acknowledged "What's New" version (clears the dot). */
  markWhatsNewSeen: (version: string) => void;
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
  /**
   * Optional top-most Back handler. When set, {@link navigateBack} (the
   * titlebar Back button) invokes it INSTEAD of closing a header overlay or
   * popping the nav history. Used by fullscreen surfaces that own the screen —
   * e.g. the Fleet terminal grid overlay — so Back dismisses them rather than
   * navigating the underlying page out from under them. Transient (never
   * persisted); the surface registers on mount and clears on unmount.
   */
  backInterceptor: (() => void) | null;
  setBackInterceptor: (fn: (() => void) | null) => void;
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
  headerOverlay: 'none' as HeaderOverlay,
  keyboardNavActive: false,
  setKeyboardNavActive: (active) => set({ keyboardNavActive: active }),
  monitorGroupBy: 'none' as const,
  monitorCollapsedGroups: [],
  monitorLiveMode: true,
  monitorInitialView: null,
  homeHiddenSections: [],
  homeTab: "welcome" as HomeTab,
  goalsTab: "board" as GoalsTab,
  kpisTab: "dashboard" as KpisTab,
  teamsTab: "workspace" as TeamsTab,
  homeReleaseVersion: "roadmap",
  whatsNewSeenVersion: null,
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

  // Opening a header overlay (Monitor / Notifications) while the Schedules
  // route is active also leaves Schedules — the overlay fully covers the page,
  // so keeping the calendar button lit underneath reads as "both open". Drop
  // back to home so only one surface is ever active. (Set both keys atomically;
  // routing through setSidebarSection would clobber the overlay we're opening.)
  setHeaderOverlay: (overlay) => set((state) => (
    overlay !== 'none' && state.sidebarSection === 'schedules'
      ? { headerOverlay: overlay, sidebarSection: 'home' as SidebarSection }
      : { headerOverlay: overlay }
  )),
  // Back-compat shim for callers that only open/close the Monitor (Athena's
  // open_route 'monitor', the Ctrl+M legacy path, FleetActivityStrip). Opening
  // switches the controller to 'monitor'; closing only clears it when the
  // Monitor is the one currently shown. Mirrors the Schedules-close behaviour
  // above so the Monitor opened via any path also dismisses Schedules.
  setMonitorOpen: (open) => set((state) => ({
    headerOverlay: open ? 'monitor' : (state.headerOverlay === 'monitor' ? 'none' : state.headerOverlay),
    sidebarSection: open && state.sidebarSection === 'schedules'
      ? ('home' as SidebarSection)
      : state.sidebarSection,
  })),
  setMonitorGroupBy: (mode) => set({ monitorGroupBy: mode }),
  setMonitorLiveMode: (on) => set({ monitorLiveMode: on }),
  toggleMonitorLiveMode: () => set((state) => ({ monitorLiveMode: !state.monitorLiveMode })),
  setMonitorInitialView: (view) => set({ monitorInitialView: view }),
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
    // Navigating any route dismisses an open header overlay (Monitor /
    // Notifications) — they float over content, so changing content closes them.
    // Idempotent — re-clicking the current section is a no-op for history.
    if (state.sidebarSection === section) return { sidebarSection: section, headerOverlay: 'none' };
    // While restoring a back-step, swap the section without recording it.
    if (navRestoring) return { sidebarSection: section, headerOverlay: 'none' };
    // Capture the full outgoing location (section + which persona was open).
    const entry: NavEntry = { section: state.sidebarSection, personaId: currentSelectedPersonaId() };
    const next = [entry, ...state.navigationHistory].slice(0, NAV_HISTORY_MAX);
    return { sidebarSection: section, navigationHistory: next, headerOverlay: 'none' };
  })),
  setHomeTab: (tab) => startTransition(() => set({ homeTab: tab })),
  setGoalsTab: (tab) => startTransition(() => set({ goalsTab: tab })),
  setKpisTab: (tab) => startTransition(() => set({ kpisTab: tab })),
  setTeamsTab: (tab) => startTransition(() => set({ teamsTab: tab })),
  setHomeReleaseVersion: (version) => startTransition(() => set({ homeReleaseVersion: version })),
  markWhatsNewSeen: (version) => set((state) =>
    state.whatsNewSeenVersion === version ? state : { whatsNewSeenVersion: version }
  ),
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

  backInterceptor: null,
  setBackInterceptor: (fn) => set({ backInterceptor: fn }),

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
    // A registered fullscreen surface (e.g. the Fleet terminal grid overlay)
    // intercepts Back first — it owns the screen, so dismissing it takes
    // priority over header overlays and section history.
    const interceptor = get().backInterceptor;
    if (interceptor) {
      interceptor();
      return;
    }
    // An open header overlay sits "above" the section history — Back closes it
    // first and leaves you on exactly the screen it floated over.
    if (get().headerOverlay !== 'none') {
      set({ headerOverlay: 'none' });
      return;
    }
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
