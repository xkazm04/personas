import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";

// ── Types ──────────────────────────────────────────────────────────────

export type TourStepId =
  | "credentials-catalog"
  | "template-gallery"
  | "agent-execution"
  | "overview-messages";

export interface TourStepDef {
  id: TourStepId;
  title: string;
  description: string;
  hint: string;
  /** Navigation targets to reach this step's context */
  nav: {
    sidebarSection: string;
    subTab?: string;
    subTabSetter?: string;
  };
  /** Event key that, when emitted, marks this step complete */
  completeOn: string;
}

export const TOUR_STEPS: TourStepDef[] = [
  {
    id: "credentials-catalog",
    title: "Credential Catalog",
    description:
      "This is where all your integrations live. Browse built-in connectors for databases, messaging platforms, dev tools, and more. Each connector comes pre-configured with auth fields and health checks.",
    hint: "Explore the catalog to see what connectors are available. Click any category to filter.",
    nav: { sidebarSection: "credentials", subTab: "from-template", subTabSetter: "setCredentialTab" },
    completeOn: "tour:catalog-explored",
  },
  {
    id: "template-gallery",
    title: "Agentic Templates",
    description:
      "Templates are pre-built agent blueprints. Look for the 'AI Weekly Research' template — it's marked as Ready because it needs no external connectors. It combines LLM research, database storage, and messaging into one agent.",
    hint: "Find the 'AI Weekly Research' template and click 'Adopt' to create your first agent.",
    nav: { sidebarSection: "design-reviews", subTab: "generated", subTabSetter: "setTemplateTab" },
    completeOn: "tour:template-adopted",
  },
  {
    id: "agent-execution",
    title: "Your First Agent",
    description:
      "This is your newly created agent. From here you can review its prompt, connectors, and triggers. Let's run it manually to see it in action — click the play button in the Lab tab.",
    hint: "Navigate to the Lab tab and click 'Run' to execute your agent.",
    nav: { sidebarSection: "personas" },
    completeOn: "tour:execution-complete",
  },
  {
    id: "overview-messages",
    title: "Messages & Results",
    description:
      "After each execution, your agent produces messages visible here. This is your central hub for monitoring all agent outputs, execution history, and system events across your entire fleet.",
    hint: "Check the Messages tab to see the output from your research agent.",
    nav: { sidebarSection: "overview", subTab: "messages", subTabSetter: "setOverviewTab" },
    completeOn: "tour:messages-viewed",
  },
];

const TOUR_STORAGE_KEY = "guided-tour-state";

interface PersistedTourState {
  completed: boolean;
  dismissed: boolean;
  currentStepIndex: number;
  completedSteps: Record<TourStepId, boolean>;
}

function loadPersistedState(): PersistedTourState | null {
  try {
    const raw = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedTourState;
  } catch {
    return null;
  }
}

function persistState(state: PersistedTourState) {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full or unavailable
  }
}

// ── Slice interface ─────────────────────────────────────────────────────

export interface TourSlice {
  tourActive: boolean;
  tourCurrentStepIndex: number;
  tourCompleted: boolean;
  tourDismissed: boolean;
  tourStepCompleted: Record<TourStepId, boolean>;
  tourCreatedPersonaId: string | null;
  /** When set, the template gallery should prefill its search with this value. Consumed once. */
  tourSearchPrefill: string | null;

  startTour: () => void;
  advanceTour: () => void;
  completeTourStep: (stepId: TourStepId) => void;
  emitTourEvent: (eventKey: string) => void;
  setTourCreatedPersona: (personaId: string) => void;
  dismissTour: () => void;
  finishTour: () => void;
  resetTour: () => void;
  consumeTourSearchPrefill: () => string | null;
}

const INITIAL_STEP_STATUS: Record<TourStepId, boolean> = {
  "credentials-catalog": false,
  "template-gallery": false,
  "agent-execution": false,
  "overview-messages": false,
};

export const createTourSlice: StateCreator<
  PersonaStore,
  [],
  [],
  TourSlice
> = (set, get) => {
  const persisted = loadPersistedState();

  return {
    tourActive: false,
    tourCurrentStepIndex: persisted?.currentStepIndex ?? 0,
    tourCompleted: persisted?.completed ?? false,
    tourDismissed: persisted?.dismissed ?? false,
    tourStepCompleted: persisted?.completedSteps ?? { ...INITIAL_STEP_STATUS },
    tourCreatedPersonaId: null,
    tourSearchPrefill: null,

    startTour: () => {
      const s = get();
      if (s.tourCompleted || s.tourDismissed) return;
      set({ tourActive: true, tourCurrentStepIndex: 0 });
    },

    advanceTour: () => {
      const s = get();
      const nextIndex = s.tourCurrentStepIndex + 1;
      if (nextIndex >= TOUR_STEPS.length) {
        get().finishTour();
        return;
      }
      const nextStep = TOUR_STEPS[nextIndex];
      set({ tourCurrentStepIndex: nextIndex });
      // Prefill search when entering the template gallery step
      if (nextStep?.id === "template-gallery") {
        set({ tourSearchPrefill: "AI Weekly Research" });
      }
      persistState({
        completed: false,
        dismissed: false,
        currentStepIndex: nextIndex,
        completedSteps: get().tourStepCompleted,
      });
    },

    completeTourStep: (stepId) => {
      set((state) => {
        const updated = { ...state.tourStepCompleted, [stepId]: true };
        persistState({
          completed: false,
          dismissed: false,
          currentStepIndex: state.tourCurrentStepIndex,
          completedSteps: updated,
        });
        return { tourStepCompleted: updated };
      });
    },

    emitTourEvent: (eventKey) => {
      const s = get();
      if (!s.tourActive) return;
      const currentStep = TOUR_STEPS[s.tourCurrentStepIndex];
      if (currentStep && currentStep.completeOn === eventKey) {
        get().completeTourStep(currentStep.id);
      }
    },

    setTourCreatedPersona: (personaId) => {
      set({ tourCreatedPersonaId: personaId });
    },

    dismissTour: () => {
      set({ tourActive: false, tourDismissed: true });
      persistState({
        completed: false,
        dismissed: true,
        currentStepIndex: get().tourCurrentStepIndex,
        completedSteps: get().tourStepCompleted,
      });
    },

    finishTour: () => {
      set({ tourActive: false, tourCompleted: true });
      persistState({
        completed: true,
        dismissed: false,
        currentStepIndex: TOUR_STEPS.length - 1,
        completedSteps: Object.fromEntries(
          TOUR_STEPS.map((s) => [s.id, true]),
        ) as Record<TourStepId, boolean>,
      });
    },

    consumeTourSearchPrefill: () => {
      const val = get().tourSearchPrefill;
      if (val !== null) set({ tourSearchPrefill: null });
      return val;
    },

    resetTour: () => {
      set({
        tourActive: false,
        tourCompleted: false,
        tourDismissed: false,
        tourCurrentStepIndex: 0,
        tourStepCompleted: { ...INITIAL_STEP_STATUS },
        tourCreatedPersonaId: null,
        tourSearchPrefill: null,
      });
      localStorage.removeItem(TOUR_STORAGE_KEY);
    },
  };
};
