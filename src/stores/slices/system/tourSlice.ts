import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";

// -- Types --------------------------------------------------------------

export type TourStepId = string;

export type TourId = "getting-started" | "execution-observability" | "orchestration-events";

export interface TourSubStepDef {
  id: string;
  label: string;
  hint: string;
  highlightTestId?: string;
}

export interface TourStepDef {
  id: TourStepId;
  title: string;
  description: string;
  hint: string;
  nav: {
    sidebarSection: string;
    subTab?: string;
    subTabSetter?: string;
  };
  completeOn: string;
  subSteps: TourSubStepDef[];
  panelWidth?: number;
  highlightTestId?: string;
}

export interface TourDef {
  id: TourId;
  title: string;
  description: string;
  icon: string; // lucide icon name
  color: string; // tailwind color key (e.g., "violet", "blue", "teal")
  steps: TourStepDef[];
}

// -- Tour Definitions ---------------------------------------------------

const GETTING_STARTED_STEPS: TourStepDef[] = [
  {
    id: "appearance-setup",
    title: "Make It Yours",
    description: "Before we begin, let's set up the app to feel right for you. Pick a theme, adjust text size, and set brightness to match your display. Changes take effect instantly.",
    hint: "Change at least one setting below to continue.",
    nav: { sidebarSection: "settings", subTab: "appearance", subTabSetter: "setSettingsTab" },
    completeOn: "tour:appearance-changed",
    subSteps: [],
    highlightTestId: "settings-appearance-panel",
  },
  {
    id: "credentials-intro",
    title: "Your Integration Hub",
    description: "Personas connects to 200+ services out of the box — databases, messaging platforms, dev tools, AI providers, and more.",
    hint: "Browse the categories and click a connector to see its details.",
    nav: { sidebarSection: "credentials" },
    completeOn: "tour:credentials-explored",
    subSteps: [
      { id: "browse-categories", label: "Browse categories", hint: "Click different categories in the catalog.", highlightTestId: "credential-manager" },
      { id: "view-connector", label: "View a connector", hint: "Click any connector card to see its auth fields." },
      { id: "connection-types", label: "Connection types", hint: "Notice the different auth methods: API Keys, OAuth, MCP, Desktop Bridge." },
    ],
  },
  {
    id: "persona-creation",
    title: "Build Your First Agent",
    description: "Let's build an AI agent together. Describe what you want it to do, and the system will design an 8-dimension specification.",
    hint: "Describe your agent's purpose in the intent field.",
    nav: { sidebarSection: "personas" },
    completeOn: "tour:persona-promoted",
    panelWidth: 320,
    subSteps: [
      { id: "enter-intent", label: "Describe your agent", hint: "Type what your agent should do.", highlightTestId: "agent-intent-input" },
      { id: "answer-questions", label: "Answer questions", hint: "The AI is asking clarifying questions to refine your agent." },
      { id: "review-draft", label: "Review the matrix", hint: "The 8-cell matrix shows your agent's full specification." },
      { id: "test-promote", label: "Test & promote", hint: "Run the test and promote to production.", highlightTestId: "agent-test-btn" },
    ],
  },
];

const EXECUTION_OBSERVABILITY_STEPS: TourStepDef[] = [
  {
    id: "overview-dashboard",
    title: "Your Command Center",
    description: "The Overview dashboard gives you a bird's-eye view of all agent activity. See success rates, active agents, pending reviews, and recent executions at a glance.",
    hint: "Explore the dashboard cards and metrics.",
    nav: { sidebarSection: "overview" },
    completeOn: "tour:dashboard-viewed",
    subSteps: [
      { id: "stats-overview", label: "Quick stats", hint: "See success rate, active agents, and pending reviews at the top.", highlightTestId: "overview-page" },
      { id: "recent-activity", label: "Recent activity", hint: "The activity feed shows your latest executions with status colors." },
    ],
  },
  {
    id: "execution-activity",
    title: "Execution History & Metrics",
    description: "The Activity tab tracks every agent execution with status, duration, cost, and detailed logs. Toggle to Metrics view to see trends, cost anomalies, and success rates over time.",
    hint: "Browse your execution history and check the metrics toggle.",
    nav: { sidebarSection: "overview", subTab: "executions", subTabSetter: "setOverviewTab" },
    completeOn: "tour:activity-explored",
    subSteps: [
      { id: "execution-list", label: "Execution list", hint: "Each row shows an agent run with status (green = success, red = failed), duration, and cost." },
      { id: "metrics-view", label: "Metrics dashboard", hint: "Toggle to metrics view to see cost trends, success rates, and anomaly detection." },
    ],
  },
  {
    id: "messages-tab",
    title: "Agent Messages & Outputs",
    description: "After each execution, agents produce messages visible here. View them as a flat list or threaded conversations. Filter by priority and read status.",
    hint: "Switch between flat and threaded views to see agent outputs.",
    nav: { sidebarSection: "overview", subTab: "messages", subTabSetter: "setOverviewTab" },
    completeOn: "tour:messages-explored",
    subSteps: [
      { id: "message-list", label: "Message list", hint: "Messages show persona, priority (red = high), delivery status, and read state." },
      { id: "thread-view", label: "Threaded view", hint: "Switch to threaded view to see conversation chains between agents." },
    ],
  },
  {
    id: "health-monitoring",
    title: "Agent Health & Reliability",
    description: "Monitor your agent fleet's health with real-time scoring. Each agent gets a heartbeat score (0-100) with grades: Healthy (80+), Degraded (50-79), Critical (<50).",
    hint: "Check your agents' health grades and expand a card for details.",
    nav: { sidebarSection: "overview", subTab: "health", subTabSetter: "setOverviewTab" },
    completeOn: "tour:health-explored",
    subSteps: [
      { id: "health-cards", label: "Health cards", hint: "Each card shows a heartbeat score with color-coded health grades." },
      { id: "health-details", label: "Expand details", hint: "Click a card to see success rate, failure rate, cost projection, and latency." },
    ],
  },
  {
    id: "lab-arena",
    title: "Lab: Test & Optimize",
    description: "The Lab lets you compare AI models head-to-head, optimize prompts with AI assistance, and track version history. Select an agent and open the Lab tab to explore.",
    hint: "Select an agent, open the Lab tab, and explore Arena mode.",
    nav: { sidebarSection: "personas" },
    completeOn: "tour:lab-explored",
    panelWidth: 360,
    subSteps: [
      { id: "select-agent", label: "Select an agent", hint: "Click any agent in the list to open its editor." },
      { id: "open-lab", label: "Open Lab tab", hint: "Click the Lab tab (flask icon) to enter the testing environment.", highlightTestId: "tab-lab" },
      { id: "arena-mode", label: "Arena mode", hint: "Arena compares models head-to-head. Select models and run a test." },
      { id: "versions", label: "Version history", hint: "The Versions tab tracks all prompt changes. You can rollback or A/B test any pair." },
    ],
  },
];

const ORCHESTRATION_EVENTS_STEPS: TourStepDef[] = [
  {
    id: "events-intro",
    title: "The Event Bus",
    description: "Every action in Personas generates events — executions completing, webhooks arriving, schedules firing. The Events module lets you see, filter, and act on this real-time event stream.",
    hint: "Explore the event log and filter by type.",
    nav: { sidebarSection: "overview", subTab: "events", subTabSetter: "setOverviewTab" },
    completeOn: "tour:events-viewed",
    subSteps: [
      { id: "event-log", label: "Event log", hint: "Each row shows an event with type, source, target agent, and status." },
      { id: "event-types", label: "Event types", hint: "Filter by type to see: execution_completed, webhook_received, schedule_fired, and more." },
      { id: "event-detail", label: "Event details", hint: "Click any event to inspect its full JSON payload." },
    ],
  },
  {
    id: "trigger-types",
    title: "Trigger Types: Pull, Push & Compose",
    description: "Triggers define when and how agents activate. PULL triggers watch for changes (schedule, polling). PUSH triggers receive signals (webhook, event listener). COMPOSE triggers chain agents together.",
    hint: "Look at the trigger configuration on an agent.",
    nav: { sidebarSection: "personas" },
    completeOn: "tour:triggers-explored",
    panelWidth: 360,
    subSteps: [
      { id: "view-triggers", label: "View triggers", hint: "Select an agent and check its Connectors tab to see configured triggers." },
      { id: "trigger-categories", label: "Pull vs Push vs Compose", hint: "Schedule = Pull (watch), Webhook = Push (listen), Chain = Compose (combine)." },
    ],
  },
  {
    id: "event-chaining",
    title: "Chaining Agents Together",
    description: "The chain trigger is the key to orchestration. When Persona A completes, it emits 'execution_completed'. Persona B listens via an event_listener trigger and auto-executes. This creates powerful multi-agent workflows.",
    hint: "Understand how the chain trigger connects agents.",
    nav: { sidebarSection: "events", subTab: "builder", subTabSetter: "setEventBusTab" },
    completeOn: "tour:chaining-understood",
    subSteps: [
      { id: "chain-concept", label: "Chain concept", hint: "A→B chaining: Agent A finishes → emits event → Agent B's trigger fires → Agent B executes." },
      { id: "event-canvas", label: "Event canvas", hint: "The visual canvas shows event sources on the left and consuming agents on the right." },
      { id: "source-filter", label: "Source filters", hint: "Use source_filter to listen only to specific agents, e.g., 'persona-a'." },
    ],
  },
  {
    id: "live-stream",
    title: "Live Event Stream",
    description: "Watch events flow through your system in real-time. See which agents trigger which, track execution chains, and debug event routing. Events appear instantly as they're published.",
    hint: "Watch the live stream to see events arriving.",
    nav: { sidebarSection: "events", subTab: "live-stream", subTabSetter: "setEventBusTab" },
    completeOn: "tour:livestream-viewed",
    subSteps: [
      { id: "stream-watch", label: "Watch events", hint: "Events appear in real-time with type, source, target, and status." },
      { id: "stream-filter", label: "Filter events", hint: "Filter by event type or persona to focus on specific chains." },
    ],
  },
];

export const TOUR_REGISTRY: TourDef[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    description: "Set up appearance, explore connectors, and build your first AI agent.",
    icon: "Compass",
    color: "violet",
    steps: GETTING_STARTED_STEPS,
  },
  {
    id: "execution-observability",
    title: "Execution & Observability",
    description: "Understand execution outputs, monitor agent health, and optimize with the Lab.",
    icon: "Activity",
    color: "blue",
    steps: EXECUTION_OBSERVABILITY_STEPS,
  },
  {
    id: "orchestration-events",
    title: "Orchestration & Events",
    description: "Chain agents together with events, triggers, and the visual event canvas.",
    icon: "Radio",
    color: "teal",
    steps: ORCHESTRATION_EVENTS_STEPS,
  },
];

/** Backward compat: the original tour steps (Tour 1) */
export const TOUR_STEPS = GETTING_STARTED_STEPS;

export function getTourById(id: TourId): TourDef | undefined {
  return TOUR_REGISTRY.find((t) => t.id === id);
}

export function getActiveTourSteps(tourId: TourId): TourStepDef[] {
  return getTourById(tourId)?.steps ?? [];
}

// -- Persistence --------------------------------------------------------

const TOUR_STORAGE_KEY = "guided-tour-state";
const TOUR_STATE_VERSION = 3;

interface PersistedTourState {
  version: number;
  /** Per-tour completion state */
  tours: Record<TourId, {
    completed: boolean;
    dismissed: boolean;
    currentStepIndex: number;
    completedSteps: Record<string, boolean>;
    subStepIndex: number;
  }>;
}

function loadPersistedState(): PersistedTourState | null {
  try {
    const raw = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedTourState;
    if (!parsed.version || parsed.version < TOUR_STATE_VERSION) {
      localStorage.removeItem(TOUR_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistState(state: Omit<PersistedTourState, 'version'>) {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify({ ...state, version: TOUR_STATE_VERSION }));
  } catch { /* storage full or unavailable */ }
}

function getDefaultTourState() {
  return { completed: false, dismissed: false, currentStepIndex: 0, completedSteps: {} as Record<string, boolean>, subStepIndex: 0 };
}

// -- Slice interface -----------------------------------------------------

export interface TourSlice {
  tourActive: boolean;
  tourActiveTourId: TourId;
  tourCurrentStepIndex: number;
  tourCompleted: boolean;
  tourDismissed: boolean;
  tourStepCompleted: Record<string, boolean>;
  tourCreatedPersonaId: string | null;
  tourSearchPrefill: string | null;
  tourSubStepIndex: number;
  tourHighlightTestId: string | null;
  tourAppearanceBaseline: { themeId: string; textScale: string; brightness: string } | null;
  tourCredentialInteractions: { categoriesBrowsed: string[]; connectorsViewed: number };
  /** Per-tour completion tracking for Learning center */
  tourCompletionMap: Record<TourId, boolean>;

  startTour: (tourId?: TourId) => void;
  advanceTour: () => void;
  completeTourStep: (stepId: TourStepId) => void;
  emitTourEvent: (eventKey: string) => void;
  setTourCreatedPersona: (personaId: string) => void;
  dismissTour: () => void;
  finishTour: () => void;
  resetTour: (tourId?: TourId) => void;
  consumeTourSearchPrefill: () => string | null;
  advanceSubStep: () => void;
  setHighlightTestId: (testId: string | null) => void;
  captureAppearanceBaseline: (baseline: { themeId: string; textScale: string; brightness: string }) => void;
  recordCredentialInteraction: (type: 'category' | 'connector', id: string) => void;
  isTourCompleted: (tourId: TourId) => boolean;
}

export const createTourSlice: StateCreator<
  SystemStore,
  [],
  [],
  TourSlice
> = (set, get) => {
  const persisted = loadPersistedState();
  const defaultTourId: TourId = "getting-started";
  const ps = persisted?.tours?.[defaultTourId];

  // Build completion map from persisted state
  const completionMap: Record<TourId, boolean> = {
    "getting-started": persisted?.tours?.["getting-started"]?.completed ?? false,
    "execution-observability": persisted?.tours?.["execution-observability"]?.completed ?? false,
    "orchestration-events": persisted?.tours?.["orchestration-events"]?.completed ?? false,
  };

  function getPersistedTours(): PersistedTourState['tours'] {
    const existing = loadPersistedState();
    const tours: Record<string, ReturnType<typeof getDefaultTourState>> = {};
    for (const t of TOUR_REGISTRY) {
      tours[t.id] = existing?.tours?.[t.id] ?? getDefaultTourState();
    }
    return tours as PersistedTourState['tours'];
  }

  function persistCurrentTour() {
    const s = get();
    const tours = getPersistedTours();
    tours[s.tourActiveTourId] = {
      completed: s.tourCompleted,
      dismissed: s.tourDismissed,
      currentStepIndex: s.tourCurrentStepIndex,
      completedSteps: s.tourStepCompleted,
      subStepIndex: s.tourSubStepIndex,
    };
    persistState({ tours });
  }

  return {
    tourActive: false,
    tourActiveTourId: defaultTourId,
    tourCurrentStepIndex: ps?.currentStepIndex ?? 0,
    tourCompleted: ps?.completed ?? false,
    tourDismissed: ps?.dismissed ?? false,
    tourStepCompleted: ps?.completedSteps ?? {},
    tourCreatedPersonaId: null,
    tourSearchPrefill: null,
    tourSubStepIndex: ps?.subStepIndex ?? 0,
    tourHighlightTestId: null,
    tourAppearanceBaseline: null,
    tourCredentialInteractions: { categoriesBrowsed: [], connectorsViewed: 0 },
    tourCompletionMap: completionMap,

    startTour: (tourId?: TourId) => {
      const id = tourId ?? get().tourActiveTourId;
      const tours = getPersistedTours();
      const ts = tours[id] ?? getDefaultTourState();

      if (ts.completed) {
        // Allow restart — reset this tour's state
        ts.completed = false;
        ts.dismissed = false;
        ts.currentStepIndex = 0;
        ts.completedSteps = {};
        ts.subStepIndex = 0;
      }
      if (ts.dismissed) return;

      const hasProgress = Object.values(ts.completedSteps).some(Boolean);
      set({
        tourActive: true,
        tourActiveTourId: id,
        tourCompleted: false,
        tourDismissed: false,
        tourCurrentStepIndex: hasProgress ? ts.currentStepIndex : 0,
        tourStepCompleted: ts.completedSteps,
        tourSubStepIndex: hasProgress ? ts.subStepIndex : 0,
        tourCredentialInteractions: { categoriesBrowsed: [], connectorsViewed: 0 },
        tourAppearanceBaseline: null,
      });
    },

    advanceTour: () => {
      const s = get();
      const steps = getActiveTourSteps(s.tourActiveTourId);
      const nextIndex = s.tourCurrentStepIndex + 1;
      if (nextIndex >= steps.length) {
        get().finishTour();
        return;
      }
      set({
        tourCurrentStepIndex: nextIndex,
        tourSubStepIndex: 0,
        tourHighlightTestId: steps[nextIndex]?.highlightTestId ?? null,
      });
      persistCurrentTour();
    },

    completeTourStep: (stepId) => {
      set((state) => {
        const updated = { ...state.tourStepCompleted, [stepId]: true };
        return { tourStepCompleted: updated };
      });
      persistCurrentTour();
    },

    emitTourEvent: (eventKey) => {
      const s = get();
      if (!s.tourActive) return;
      const steps = getActiveTourSteps(s.tourActiveTourId);
      const currentStep = steps[s.tourCurrentStepIndex];
      if (currentStep && currentStep.completeOn === eventKey) {
        get().completeTourStep(currentStep.id);
      }
    },

    setTourCreatedPersona: (personaId) => set({ tourCreatedPersonaId: personaId }),

    dismissTour: () => {
      set({ tourActive: false, tourDismissed: true, tourHighlightTestId: null });
      persistCurrentTour();
    },

    finishTour: () => {
      const s = get();
      const steps = getActiveTourSteps(s.tourActiveTourId);
      const allComplete = Object.fromEntries(steps.map((st) => [st.id, true]));
      set({
        tourActive: false,
        tourCompleted: true,
        tourStepCompleted: allComplete,
        tourHighlightTestId: null,
        tourCompletionMap: { ...s.tourCompletionMap, [s.tourActiveTourId]: true },
      });
      persistCurrentTour();
    },

    consumeTourSearchPrefill: () => {
      const val = get().tourSearchPrefill;
      if (val !== null) set({ tourSearchPrefill: null });
      return val;
    },

    resetTour: (tourId?: TourId) => {
      const id = tourId ?? get().tourActiveTourId;
      const tours = getPersistedTours();
      tours[id] = getDefaultTourState();
      persistState({ tours });
      if (id === get().tourActiveTourId) {
        set({
          tourActive: false,
          tourCompleted: false,
          tourDismissed: false,
          tourCurrentStepIndex: 0,
          tourStepCompleted: {},
          tourCreatedPersonaId: null,
          tourSearchPrefill: null,
          tourSubStepIndex: 0,
          tourHighlightTestId: null,
          tourAppearanceBaseline: null,
          tourCredentialInteractions: { categoriesBrowsed: [], connectorsViewed: 0 },
          tourCompletionMap: { ...get().tourCompletionMap, [id]: false },
        });
      } else {
        set({ tourCompletionMap: { ...get().tourCompletionMap, [id]: false } });
      }
    },

    advanceSubStep: () => {
      const s = get();
      const steps = getActiveTourSteps(s.tourActiveTourId);
      const currentStep = steps[s.tourCurrentStepIndex];
      if (!currentStep) return;
      const nextSub = s.tourSubStepIndex + 1;
      if (nextSub < currentStep.subSteps.length) {
        set({
          tourSubStepIndex: nextSub,
          tourHighlightTestId: currentStep.subSteps[nextSub]?.highlightTestId ?? null,
        });
        persistCurrentTour();
      }
    },

    setHighlightTestId: (testId) => set({ tourHighlightTestId: testId }),

    captureAppearanceBaseline: (baseline) => set({ tourAppearanceBaseline: baseline }),

    recordCredentialInteraction: (type, id) => {
      const s = get();
      const interactions = { ...s.tourCredentialInteractions };
      if (type === 'category') {
        if (!interactions.categoriesBrowsed.includes(id)) {
          interactions.categoriesBrowsed = [...interactions.categoriesBrowsed, id];
        }
      } else {
        interactions.connectorsViewed = interactions.connectorsViewed + 1;
      }
      set({ tourCredentialInteractions: interactions });
      if (interactions.categoriesBrowsed.length >= 2 && interactions.connectorsViewed >= 1) {
        get().emitTourEvent('tour:credentials-explored');
      }
      const steps = getActiveTourSteps(s.tourActiveTourId);
      const currentStep = steps[s.tourCurrentStepIndex];
      if (currentStep?.id === 'credentials-intro') {
        if (type === 'category' && interactions.categoriesBrowsed.length === 1 && s.tourSubStepIndex === 0) {
          get().advanceSubStep();
        } else if (type === 'connector' && interactions.connectorsViewed === 1 && s.tourSubStepIndex <= 1) {
          set({ tourSubStepIndex: 1 });
          get().advanceSubStep();
        }
      }
    },

    isTourCompleted: (tourId) => get().tourCompletionMap[tourId] ?? false,
  };
};
