import type { StateCreator } from "zustand";
import * as Sentry from "@sentry/react";
import type { SystemStore } from "../../storeTypes";
import { useToastStore } from "@/stores/toastStore";
import { en } from "@/i18n/en";

// -- Types --------------------------------------------------------------

export type TourStepId = string;

export type TourId = "getting-started" | "getting-started-simple" | "execution-observability" | "orchestration-events";

/**
 * The single source of truth for tour completion event keys.
 *
 * Tour completion is an invisible cross-file contract — a typo in any of
 * these strings used to fail open (no compile error, no runtime warning;
 * the step just never completed). Now both the producer side
 * (`emitTourEvent` callers + `storeBusWiring`) and the consumer side
 * (`TourStepDef.completeOn` + the timed-steps list in `GuidedTour`) share
 * the same union, so a typo turns into a build error.
 *
 * To add a new event:
 *   1. Add it to `TOUR_EVENTS` below.
 *   2. Use it as `completeOn` on a step.
 *   3. Emit it via `useSystemStore.getState().emitTourEvent('tour:my-key')`
 *      or from `storeBusWiring.ts`.
 */
export const TOUR_EVENTS = [
  // Getting Started
  'tour:appearance-changed',
  'tour:credentials-explored',
  'tour:persona-promoted',
  'tour:persona-draft-ready',
  // Execution & Observability
  'tour:dashboard-viewed',
  'tour:activity-explored',
  'tour:execution-complete',
  'tour:messages-explored',
  'tour:health-explored',
  'tour:lab-explored',
  // Orchestration & Events
  'tour:events-viewed',
  'tour:triggers-explored',
  'tour:chaining-understood',
  'tour:livestream-viewed',
] as const;

export type TourEventKey = (typeof TOUR_EVENTS)[number];

/**
 * Exploration steps — informational tour stops where there is no concrete
 * user action that can be detected in code (no setting change, no credential
 * interaction, no persona promotion). The user is meant to look around the
 * dashboard, activity, messages, health, lab, events canvas, etc.
 *
 * Historically these advanced via a hard-coded 5s `setTimeout` in
 * `GuidedTour.tsx` (no rationale, no countdown, no opt-out). Five seconds
 * is too short for a slow loader and too long for a power user, and Sentry
 * surfaced "it said complete but I never saw the page" complaints.
 *
 * We no longer auto-complete on a timer. Instead, the tour panel renders an
 * explicit "I've explored this" button for these events; the user decides
 * when they are done. Keep this set as the single source of truth — both
 * the panel (button visibility) and any future heuristics consult it.
 */
export const EXPLORATION_TOUR_EVENTS = new Set<TourEventKey>([
  // Execution & Observability
  'tour:dashboard-viewed',
  'tour:activity-explored',
  'tour:messages-explored',
  'tour:health-explored',
  'tour:lab-explored',
  // Orchestration & Events
  'tour:events-viewed',
  'tour:triggers-explored',
  'tour:chaining-understood',
  'tour:livestream-viewed',
]);

/** True when a step's completion is gated on the user clicking acknowledge rather than a real interaction. */
export function isExplorationTourEvent(eventKey: TourEventKey | undefined): boolean {
  return eventKey !== undefined && EXPLORATION_TOUR_EVENTS.has(eventKey);
}

/**
 * Allowed character set for `data-testid` values surfaced to
 * `TourSpotlight` via `tourHighlightTestId`. Mirrors the testid
 * convention used across the codebase ([a-zA-Z0-9_-]+).
 *
 * The spotlight builds a CSS selector with this string interpolated
 * inside double quotes:
 *   document.querySelector(`[data-testid="${id}"]`)
 *
 * A future caller passing a string with a quote, bracket, or backslash
 * (e.g. a templated id like `agent-${name}` for a persona named
 * `Joe "rocket" Smith`) would crash querySelector with SyntaxError and
 * kill the spotlight effect for the rest of the session. Keep the
 * pattern strict so the trust boundary lives at the slice setter, not
 * in every callsite.
 */
export const TOUR_TEST_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** True if `id` is safe to embed in a `[data-testid="…"]` selector. */
export function isSafeTourTestId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.length > 0 && TOUR_TEST_ID_PATTERN.test(id);
}

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
  completeOn: TourEventKey;
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

/** Simplified tour for Simple (starter) mode — fewer steps, simpler language. */
const GETTING_STARTED_SIMPLE_STEPS: TourStepDef[] = [
  {
    id: "appearance-setup",
    title: "Pick Your Look",
    description: "Choose a color theme and text size that feels comfortable. Changes apply instantly — try a few!",
    hint: "Change any setting below to continue.",
    nav: { sidebarSection: "settings", subTab: "appearance", subTabSetter: "setSettingsTab" },
    completeOn: "tour:appearance-changed",
    subSteps: [],
    highlightTestId: "settings-appearance-panel",
  },
  {
    id: "credentials-intro",
    title: "Connect a Service",
    description: "Your agents need access to external services to be useful. Add a connection — like a Slack workspace, email account, or API key.",
    hint: "Click \"Add new\" and follow the steps.",
    nav: { sidebarSection: "credentials" },
    completeOn: "tour:credentials-explored",
    subSteps: [
      { id: "browse-categories", label: "Browse services", hint: "Scroll through the available services.", highlightTestId: "credential-manager" },
      { id: "view-connector", label: "Pick one", hint: "Click any service to see how to connect it." },
    ],
  },
  {
    id: "persona-creation",
    title: "Create Your First Agent",
    description: "Describe what you want your agent to do in plain language. The system will set everything up for you.",
    hint: "Type a simple description like \"Summarize my daily emails\" or \"Monitor Slack for urgent messages\".",
    nav: { sidebarSection: "personas" },
    completeOn: "tour:persona-promoted",
    panelWidth: 320,
    subSteps: [
      { id: "enter-intent", label: "Describe it", hint: "What should your agent do?", highlightTestId: "agent-intent-input" },
      { id: "review-draft", label: "Review", hint: "Check the agent looks right." },
      { id: "test-promote", label: "Try it out", hint: "Run a test to see it in action.", highlightTestId: "agent-test-btn" },
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
    id: "getting-started-simple",
    title: "Quick Setup",
    description: "Pick your look, connect a service, and create your first agent.",
    icon: "Sparkles",
    color: "violet",
    steps: GETTING_STARTED_SIMPLE_STEPS,
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

/**
 * Probe key separate from the real state key so a probe failure can't
 * corrupt persisted progress, and so the probe is non-destructive on
 * success (we delete it immediately).
 */
const TOUR_STORAGE_PROBE_KEY = "guided-tour-storage-probe";

/**
 * Set once per app session so the user gets exactly one toast about
 * persistence being unavailable, no matter how many tour transitions
 * happen afterwards. Surviving HMR via globalThis matches the pattern
 * used elsewhere (executionBuffers, eventBus).
 */
declare global {
  var __personasTourStorageProbed: boolean | undefined;
  var __personasTourStorageAvailable: boolean | undefined;
  var __personasTourStorageToastShown: boolean | undefined;
}

/**
 * Run a one-time `setItem`/`getItem`/`removeItem` round-trip against
 * `localStorage` and cache the result on `globalThis`. Subsequent calls
 * are a single property read.
 *
 * Why this matters: Safari private-mode, Firefox storage-full, NS_ERROR_FILE_CORRUPTED
 * on locked-down corporate Windows profiles, and a few mobile WebViews
 * all throw on the first write attempt. Previously `persistState()`
 * swallowed those errors silently, leaving the user with a tour that
 * resets every session and zero feedback. Now we probe at slice boot
 * (and the first call is guaranteed to be at boot via
 * `loadPersistedState()` and `createTourSlice()`), surface a one-time
 * toast, log a Sentry breadcrumb so support can correlate
 * "tour-restarting-on-launch" reports, and downgrade `persistState()`
 * to an in-memory no-op so the rest of the tour still works.
 */
function probeTourStorage(): boolean {
  if (typeof globalThis.__personasTourStorageProbed !== "undefined") {
    return globalThis.__personasTourStorageAvailable === true;
  }
  globalThis.__personasTourStorageProbed = true;

  let available = false;
  let errorMessage = "unknown";
  try {
    if (typeof localStorage === "undefined") {
      errorMessage = "localStorage is undefined (SSR/sandbox)";
    } else {
      localStorage.setItem(TOUR_STORAGE_PROBE_KEY, "1");
      const readBack = localStorage.getItem(TOUR_STORAGE_PROBE_KEY);
      localStorage.removeItem(TOUR_STORAGE_PROBE_KEY);
      available = readBack === "1";
      if (!available) errorMessage = "round-trip mismatch";
    }
  } catch (err) {
    available = false;
    errorMessage = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  globalThis.__personasTourStorageAvailable = available;

  if (available) {
    Sentry.addBreadcrumb({
      category: "tour.persistence",
      message: "Tour storage probe passed",
      level: "info",
    });
    return true;
  }

  // Persistence is broken. Surface it once.
  Sentry.addBreadcrumb({
    category: "tour.persistence",
    message: `Tour storage probe failed: ${errorMessage}`,
    level: "warning",
  });
  Sentry.captureMessage(
    `[tour] localStorage unavailable — tour progress will not persist (${errorMessage})`,
    "warning",
  );

  if (!globalThis.__personasTourStorageToastShown) {
    globalThis.__personasTourStorageToastShown = true;
    // Guard the toast call: in a unit-test harness the toast store may
    // not be initialized. We never want a probe-failure path to crash.
    try {
      useToastStore
        .getState()
        .addToast(en.onboarding.tour_storage_unavailable_toast, "error", 8000);
    } catch {
      // intentional: see comment above. The probe still records the
      // breadcrumb above so support has the diagnostic trail.
    }
  }

  return false;
}

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
  // Probe runs the first time we touch storage (slice construction).
  // If unavailable, treat the same as "no persisted state".
  if (!probeTourStorage()) return null;
  try {
    const raw = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedTourState;
    if (!parsed.version || parsed.version < TOUR_STATE_VERSION) {
      localStorage.removeItem(TOUR_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch (err) {
    // The data was on disk but failed to parse — JSON corruption or a
    // schema change we didn't anticipate. Distinct from "unavailable":
    // log it but don't toast (the user's not stuck — they just lose
    // this one session's persisted progress).
    Sentry.addBreadcrumb({
      category: "tour.persistence",
      message: `loadPersistedState parse failure: ${err instanceof Error ? err.message : String(err)}`,
      level: "warning",
    });
    return null;
  }
}

function persistState(state: Omit<PersistedTourState, 'version'>) {
  // Persistence-disabled mode: in-memory state is still authoritative
  // for the current session, but we don't try writes that we know will
  // throw (also avoids burning Sentry quota on QuotaExceededError every
  // step transition).
  if (!probeTourStorage()) return;
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify({ ...state, version: TOUR_STATE_VERSION }));
  } catch (err) {
    // The probe passed at boot but a later write failed (e.g. quota
    // filled up mid-session). Mark storage unavailable so we stop
    // retrying, log a breadcrumb, and surface the toast once.
    globalThis.__personasTourStorageAvailable = false;
    Sentry.addBreadcrumb({
      category: "tour.persistence",
      message: `persistState failed mid-session: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      level: "error",
    });
    Sentry.captureMessage(
      "[tour] persistState write failed mid-session — disabling further writes",
      "warning",
    );
    if (!globalThis.__personasTourStorageToastShown) {
      globalThis.__personasTourStorageToastShown = true;
      try {
        useToastStore
          .getState()
          .addToast(en.onboarding.tour_storage_unavailable_toast, "error", 8000);
      } catch {
        // see probeTourStorage(): toast may not be initialized in tests
      }
    }
  }
}

function getDefaultTourState() {
  return { completed: false, dismissed: false, currentStepIndex: 0, completedSteps: {} as Record<string, boolean>, subStepIndex: 0 };
}

/**
 * The Starter ("getting-started-simple") and Power ("getting-started")
 * tours share a step-id schema: `appearance-setup`, `credentials-intro`,
 * `persona-creation`. The Starter tour stops there; the Power tour adds
 * later steps. When a user changes tier mid-tour we want their progress
 * on those shared ids to carry over so they don't lose context after an
 * upgrade.
 *
 * This map is the single source of truth for which tours are migration
 * partners. If you ever add a third Starter-vs-Power split (e.g. a
 * separate tour for an Enterprise tier), extend this map AND the test
 * `migrates_completed_steps_when_switching_starter_to_power` in
 * `tourSlice.test.ts`.
 */
const TIER_PARTNER: Partial<Record<TourId, TourId>> = {
  "getting-started": "getting-started-simple",
  "getting-started-simple": "getting-started",
};

/**
 * Return shared step ids between the source and target tour, used to
 * carry completion state across a tier switch.
 */
function sharedStepIds(sourceId: TourId, targetId: TourId): Set<string> {
  const sourceSteps = new Set(getActiveTourSteps(sourceId).map((s) => s.id));
  const targetIds = getActiveTourSteps(targetId).map((s) => s.id);
  return new Set(targetIds.filter((id) => sourceSteps.has(id)));
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
  /** Jump directly to a step index, resetting sub-step + highlight. Out-of-range indices are ignored. */
  goToTourStep: (index: number) => void;
  completeTourStep: (stepId: TourStepId) => void;
  emitTourEvent: (eventKey: TourEventKey) => void;
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
    "getting-started-simple": persisted?.tours?.["getting-started-simple"]?.completed ?? false,
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
        ts.currentStepIndex = 0;
        ts.completedSteps = {};
        ts.subStepIndex = 0;
      }
      // Always un-dismiss when explicitly starting
      ts.completed = false;
      ts.dismissed = false;

      // Tier-switch migration. When a user upgrades from Starter to Power
      // (or downgrades) mid-tour, TourLauncher selects a different tourId
      // on the next click. Without migration, the user re-does steps they
      // already completed under the other tour id — paying customers see
      // "Restart your tour", lose context, churn. Policy (option 1 from
      // the requirement: auto-migrate via shared step ids) is documented
      // in `src/features/onboarding/README.md` ("Tier-switch policy").
      //
      // Carry over completed steps for any id that exists in both
      // registries. We do NOT overwrite work the target tour has already
      // recorded (treat completion as monotonic — once done, stays done).
      const partner = TIER_PARTNER[id];
      if (partner) {
        const partnerState = tours[partner];
        if (partnerState) {
          const shared = sharedStepIds(partner, id);
          if (shared.size > 0) {
            const merged: Record<string, boolean> = { ...ts.completedSteps };
            for (const stepId of shared) {
              if (partnerState.completedSteps[stepId]) merged[stepId] = true;
            }
            ts.completedSteps = merged;
          }
        }
      }

      const hasProgress = Object.values(ts.completedSteps).some(Boolean);

      // If migration brought in new completed steps, advance the cursor
      // so the user lands on their next *unfinished* step rather than
      // staring at a step they already did.
      const targetSteps = getActiveTourSteps(id);
      const firstUnfinished = targetSteps.findIndex((s) => !ts.completedSteps[s.id]);
      const resumeIndex =
        hasProgress && firstUnfinished >= 0
          ? Math.max(ts.currentStepIndex, firstUnfinished)
          : hasProgress
            ? ts.currentStepIndex
            : 0;

      // Persist the migrated state back to localStorage so a refresh
      // doesn't undo the merge.
      tours[id] = ts;
      persistState({ tours });

      set({
        tourActive: true,
        tourActiveTourId: id,
        tourCompleted: false,
        tourDismissed: false,
        tourCurrentStepIndex: resumeIndex,
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

    goToTourStep: (index: number) => {
      const s = get();
      const steps = getActiveTourSteps(s.tourActiveTourId);
      if (index < 0 || index >= steps.length) return;
      set({
        tourCurrentStepIndex: index,
        tourSubStepIndex: 0,
        tourHighlightTestId: steps[index]?.highlightTestId ?? null,
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

    setHighlightTestId: (testId) => {
      // Trust boundary: reject anything outside the testid convention so a
      // future caller can't smuggle quotes/brackets into the selector that
      // TourSpotlight builds. Clearing the highlight (null) is always allowed.
      if (testId !== null && !isSafeTourTestId(testId)) {
        if (typeof console !== "undefined") {
          console.warn(
            "[tourSlice] setHighlightTestId rejected unsafe testid; expected /^[a-zA-Z0-9_-]+$/",
            { received: testId },
          );
        }
        set({ tourHighlightTestId: null });
        return;
      }
      set({ tourHighlightTestId: testId });
    },

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
