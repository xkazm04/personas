import type { StateCreator } from "zustand";
import * as Sentry from "@sentry/react";
import type { SystemStore } from "../../storeTypes";
import { useToastStore } from "@/stores/toastStore";
import { en } from "@/i18n/en";
import { silentCatch } from '@/lib/silentCatch';


// -- Types --------------------------------------------------------------

export type TourStepId = string;

export type TourId =
  | "getting-started"
  | "getting-started-simple"
  | "execution-observability"
  | "orchestration-events"
  | "plugins-explorer"
  | "schedules-mastery"
  | "templates-recipes"
  | "teams-orchestration"
  | "obsidian-brain";

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
  // Plugins Explorer
  'tour:plugins-browse-explored',
  'tour:plugin-enabled',
  'tour:plugin-surface-visited',
  // Schedules Mastery
  'tour:schedules-page-viewed',
  'tour:schedules-view-toggled',
  'tour:schedule-attached',
  // Templates & Recipes
  'tour:templates-page-viewed',
  'tour:template-adopted',
  'tour:recipes-explored',
  // Teams & Orchestration — the hands-on pipeline (project → context → KPI →
  // team → orchestrate) then the model underneath.
  'tour:pipeline-project-explored',
  'tour:pipeline-context-explored',
  'tour:pipeline-kpis-explored',
  'tour:pipeline-team-explored',
  'tour:pipeline-orchestrate-explored',
  'tour:team-canvas-explored',
  'tour:team-chaining-understood',
  'tour:team-assignment-explored',
  'tour:team-memory-explored',
  // Obsidian Brain
  'tour:obsidian-detected',
  'tour:obsidian-vault-connected',
  'tour:obsidian-tab-explored',
  'tour:obsidian-memory-understood',
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
  // Plugins Explorer — all steps are walk-around stops; we can't reliably
  // observe "user understood this plugin". Acknowledge-button advances.
  'tour:plugins-browse-explored',
  'tour:plugin-enabled',
  'tour:plugin-surface-visited',
  // Schedules Mastery
  'tour:schedules-page-viewed',
  'tour:schedules-view-toggled',
  'tour:schedule-attached',
  // Templates & Recipes
  'tour:templates-page-viewed',
  'tour:template-adopted',
  'tour:recipes-explored',
  // Teams & Orchestration — all walk-around stops (acknowledge advances)
  'tour:pipeline-project-explored',
  'tour:pipeline-context-explored',
  'tour:pipeline-kpis-explored',
  'tour:pipeline-team-explored',
  'tour:pipeline-orchestrate-explored',
  'tour:team-canvas-explored',
  'tour:team-chaining-understood',
  'tour:team-assignment-explored',
  'tour:team-memory-explored',
  // Obsidian Brain — 'detected' auto-completes via the obsidian_available
  // probe when the binary is present; the acknowledge button is the manual
  // fallback after the user installs Obsidian mid-step. The tab walks and
  // the memory-dimensions stop are pure exploration.
  'tour:obsidian-detected',
  'tour:obsidian-tab-explored',
  'tour:obsidian-memory-understood',
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
  /**
   * Spoken narration for this step, written for the ear rather than the
   * eye — conversational, 1-3 sentences, distinct from the on-screen
   * `description`. When the companion's voice is configured
   * (`companionVoiceEnabled` + a usable engine/voice), `useTourNarration`
   * synthesizes this through Athena's live TTS (`companion_tts`) as the
   * step activates. Absent / undefined → the step is silent (the tour is
   * a normal text coach-mark, exactly as before voice was added).
   *
   * NOTE: like `title`/`description`, narration text currently lives
   * inline in English here pending the tracked tour-string i18n
   * extraction (see `src/features/onboarding/README.md`). Athena's TTS
   * engines are multilingual, so once these move to `en.json` the spoken
   * text localizes with the rest of the tour for free.
   */
  narration?: string;
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
    narration: "Welcome to Personas — I'm Athena, and I'll walk you through it. Let's start by making the app yours: pick a theme, nudge the text size, and set the brightness until it feels right. Change any one setting and we'll move on.",
  },
  {
    id: "credentials-intro",
    title: "Your Integration Hub",
    description: "Personas connects to 200+ services out of the box — databases, messaging platforms, dev tools, AI providers, and more.",
    hint: "Browse the categories and click a connector to see its details.",
    nav: { sidebarSection: "credentials" },
    completeOn: "tour:credentials-explored",
    narration: "This is your integration hub. Personas talks to over two hundred services right out of the box — databases, messaging, dev tools, and AI providers. Browse a category, then open any connector to see how it authenticates.",
    subSteps: [
      { id: "browse-categories", label: "Browse categories", hint: "Click different categories in the catalog.", highlightTestId: "credential-manager" },
      { id: "view-connector", label: "View a connector", hint: "Click any connector card to see its auth fields." },
      { id: "connection-types", label: "Connection types", hint: "Notice the different auth methods: API Keys, OAuth, MCP, Desktop Bridge." },
    ],
  },
  {
    id: "persona-creation",
    title: "Build Your First Agent",
    description: "Let's build your first agent on the Glyph. Describe what you want it to do — the build resolves eight sigils (Trigger, Task, Apps, Message, Review, Memory, Events, Errors) into a full specification, runs a built-in smoke test, and lets you promote when you're happy.",
    hint: "Describe your agent's purpose in the intent field.",
    nav: { sidebarSection: "personas" },
    completeOn: "tour:persona-promoted",
    panelWidth: 320,
    narration: "Now for the fun part — let's build your first agent on the Glyph. Describe what you want it to do in one line. I'll ask a few clarifying questions, then fill in the eight sigils that make up your agent — its trigger, task, apps, messages, review, memory, events, and error handling. After a quick smoke test, promote it and it goes live.",
    subSteps: [
      { id: "enter-intent", label: "Describe your agent", hint: "Type a one-line job description. Be concrete — \"summarize my GitHub PR reviews each morning\" beats \"helps with code\".", highlightTestId: "agent-intent-input" },
      { id: "answer-questions", label: "Answer follow-ups", hint: "I ask clarifying questions in-line. Each answer lights up another sigil on the Glyph." },
      { id: "review-draft", label: "Inspect the sigils", hint: "The Glyph's eight sigils are your agent's full specification — Trigger (when it runs), Task (what it does), Apps (its tools), Message (how it reports), Review (human approval), Memory, Events, and Errors. Each petal lights up as the build resolves it; click a sigil to refine it.", highlightTestId: "build-layout-prototype" },
      { id: "open-test-report", label: "Open the test report", hint: "Once the smoke test finishes, click here to see what passed and what to fix.", highlightTestId: "build-test-report-open" },
      { id: "promote", label: "Promote to production", hint: "When the test report is green, promote the build. Your agent goes live — then we'll run it together." },
    ],
  },
  {
    id: "first-execution",
    title: "Run Your Agent",
    description: "Your agent is live. Open its Use Cases tab in the Agents module and run it once by hand — that's how you trigger any agent on demand, separate from its schedules and events.",
    hint: "Open the agent's Use Cases tab and run a use case.",
    nav: { sidebarSection: "personas" },
    completeOn: "tour:execution-complete",
    narration: "Last step — your agent is live, so let's run it once by hand. I've opened its Use Cases tab in the Agents module. Pick a use case and hit Run Now. This is how you trigger any agent on demand, separate from its schedules and events. When the run finishes, you've completed the tour.",
    highlightTestId: "design-subtab-use-cases",
    subSteps: [
      { id: "open-use-cases", label: "Open Use Cases", hint: "Your new agent's editor is open on the Use Cases tab — it lists every capability the agent can run.", highlightTestId: "design-subtab-use-cases" },
      { id: "run-now", label: "Run it", hint: "Pick a use case and click \"Run Now\" to execute it manually. The run streams its result inline.", highlightTestId: "use-case-run-now" },
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
    description: "The Lab is where you sharpen a live agent: compare models head-to-head in Arena, A/B-test prompt variants, browse the full version history, and let AI optimize the agent for you — Improve, Breed, and Evolve — with a Regression guard that re-scores use-cases after every change.",
    hint: "Select an agent, open the Lab tab, and explore Arena mode.",
    nav: { sidebarSection: "personas" },
    completeOn: "tour:lab-explored",
    panelWidth: 360,
    subSteps: [
      { id: "select-agent", label: "Pick a promoted agent", hint: "Lab works on agents that already have a promoted build — click one in the list to open its editor." },
      { id: "open-lab", label: "Open the Lab tab", hint: "Click the flask icon in the editor tab bar. Lab is Team-tier and up.", highlightTestId: "editor-tab-lab" },
      { id: "arena-mode", label: "Run Arena", hint: "Arena pits multiple models against the same use-case in parallel. Pick 2–3 models and hit start to see side-by-side outputs." },
      { id: "ab-mode", label: "Try A/B mode", hint: "A/B compares two prompt variants on the same model. Useful when you're tightening copy rather than swapping providers." },
      { id: "ai-optimize", label: "AI optimization modes", hint: "Beyond Arena and A/B: Improve rewrites a weak prompt, Breed crosses two strong variants, Evolve iterates over generations, and Regression re-checks every use-case after a change so you don't ship a quiet regression." },
      { id: "versions", label: "Browse version history", hint: "Every promote creates a version. Diff any two, rollback, or send a pair to Arena to back up the rollback decision with data." },
    ],
  },
];

const ORCHESTRATION_EVENTS_STEPS: TourStepDef[] = [
  {
    id: "events-intro",
    title: "The Event Bus",
    description: "Every action in Personas generates events — executions completing, webhooks arriving, schedules firing. The Overview > Events tab is the read-only log; the Events sidebar section is where you wire and inspect routing.",
    hint: "Browse the recent event log and try filtering by type.",
    nav: { sidebarSection: "overview", subTab: "events", subTabSetter: "setOverviewTab" },
    completeOn: "tour:events-viewed",
    highlightTestId: "overview-page",
    subSteps: [
      { id: "event-log", label: "Event log", hint: "Each row shows an event with its type, source, target agent, and outcome status." },
      { id: "event-types", label: "Filter by type", hint: "Try filtering: execution_completed, webhook_received, schedule_fired, manual_trigger, escalation, and the healing/incident events." },
      { id: "event-detail", label: "Inspect payload", hint: "Click any row to open the JSON payload viewer — that's exactly what listeners receive." },
    ],
  },
  {
    id: "trigger-types",
    title: "Trigger Types: Pull, Push & Compose",
    description: "Triggers define when an agent activates. PULL watches for changes (schedule, polling), PUSH receives signals (webhook, event_listener), COMPOSE chains agents (chain trigger). Every agent has at least one — set when you build it on the Glyph.",
    hint: "Look at how triggers are categorized, then see them wired on the Event Canvas.",
    nav: { sidebarSection: "personas" },
    completeOn: "tour:triggers-explored",
    panelWidth: 360,
    subSteps: [
      { id: "trigger-categories", label: "Three trigger families", hint: "Schedule/cron = Pull. Webhook/email/event_listener = Push. Chain = Compose. Each family answers \"what wakes this agent up?\"." },
      { id: "set-on-build", label: "Set on the Glyph", hint: "An agent's trigger is chosen during the build — the \"When\" row / Trigger sigil. Pick a schedule, a webhook, or an event to listen for; it's baked into the agent at promote time." },
      { id: "see-on-canvas", label: "See them on the canvas", hint: "The Events → Builder canvas (next step) shows every agent's triggers as a live routing graph — the clearest place to see what listens to what." },
    ],
  },
  {
    id: "event-chaining",
    title: "Chaining Agents Together",
    description: "The chain trigger is the key to multi-agent workflows. Agent A completes → emits execution_completed → Agent B's event_listener fires → Agent B runs. The Event Canvas visualises this graph and lets you wire new chains by dragging.",
    hint: "Look at the canvas — sources on the left, consumers on the right.",
    nav: { sidebarSection: "events", subTab: "builder", subTabSetter: "setEventBusTab" },
    completeOn: "tour:chaining-understood",
    highlightTestId: "triggers-page",
    subSteps: [
      { id: "chain-concept", label: "Chain concept", hint: "A→B chaining: A finishes → emits event → B's trigger matches → B executes. Chain B→C and you have a pipeline." },
      { id: "event-canvas", label: "Walk the canvas", hint: "Sources column (left) lists every event type emitters can produce. The middle shows fan-out edges. Consumers (right) are agents subscribed to those events." },
      { id: "source-filter", label: "Source filters", hint: "An event_listener with source_filter: \"persona-a\" only fires on events from persona-a. Without it, it fires on any agent emitting that event type." },
    ],
  },
  {
    id: "live-stream",
    title: "Live Event Stream",
    description: "The live-stream tab is the same event bus, but rendered in real-time. Use it to debug chains while they fire, watch a webhook propagate, or sanity-check rate-limits when something seems silently dropped.",
    hint: "Watch the stream tick. Trigger a manual execution to see the events arrive.",
    nav: { sidebarSection: "events", subTab: "live-stream", subTabSetter: "setEventBusTab" },
    completeOn: "tour:livestream-viewed",
    highlightTestId: "triggers-page",
    subSteps: [
      { id: "stream-watch", label: "Watch events", hint: "Events appear top-to-bottom as they're published. Color codes match the Overview log — green success, red failure, amber warning." },
      { id: "stream-filter", label: "Filter the stream", hint: "Filter by event type or persona to focus on a specific chain. Combine with the rate-limits tab when chains are dropping events." },
      { id: "dead-letter", label: "Check dead-letter", hint: "Events that exceeded retry caps land in dead-letter. The tab next to live-stream lists them — replay individually or in bulk after fixing the consumer." },
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
    narration: "Hi, I'm Athena — let's get you set up. First, pick a look you like: choose a color theme and a comfortable text size. Change anything and we'll keep going.",
  },
  {
    id: "credentials-intro",
    title: "Connect a Service",
    description: "Your agents need access to external services to be useful. Add a connection — like a Slack workspace, email account, or API key.",
    hint: "Click \"Add new\" and follow the steps.",
    nav: { sidebarSection: "credentials" },
    completeOn: "tour:credentials-explored",
    narration: "Your agents need access to the services you use to be helpful. Let's connect one — maybe a Slack workspace, an email account, or an API key. Pick a service and follow the steps.",
    subSteps: [
      { id: "browse-categories", label: "Browse services", hint: "Scroll through the available services.", highlightTestId: "credential-manager" },
      { id: "view-connector", label: "Pick one", hint: "Click any service to see how to connect it." },
    ],
  },
  {
    id: "persona-creation",
    title: "Create Your First Agent",
    description: "Describe what you want your agent to do in plain language. The system will draft it for you, run a quick test, and let you promote it live.",
    hint: "Type a simple description like \"Summarize my daily emails\" or \"Monitor Slack for urgent messages\".",
    nav: { sidebarSection: "personas" },
    completeOn: "tour:persona-promoted",
    panelWidth: 320,
    narration: "Time to create your first agent. Just describe what you'd like it to do in plain language — something like \"summarize my daily emails.\" I'll draft it, run a quick test, and you can promote it live when it looks good.",
    subSteps: [
      { id: "enter-intent", label: "Describe it", hint: "What should your agent do?", highlightTestId: "agent-intent-input" },
      { id: "review-draft", label: "Review the draft", hint: "Skim the matrix — each cell is a behavior the agent will follow." },
      { id: "open-test-report", label: "Open the test report", hint: "When the smoke test finishes, click it to see what passed.", highlightTestId: "build-test-report-open" },
      { id: "promote", label: "Promote it", hint: "When the test report looks good, hit promote. Your agent is live." },
    ],
  },
];

const PLUGINS_EXPLORER_STEPS: TourStepDef[] = [
  {
    id: "plugins-browse",
    title: "The Plugins Browser",
    description: "Plugins extend Personas with new surfaces — image generation, repository tooling, Obsidian sync, research workflows, voice cloning, observability, and an AI companion. This is the catalog: toggle a plugin on and it shows up in the Plugins sidebar.",
    hint: "Toggle one plugin on, then off — watch the sidebar nav react.",
    nav: { sidebarSection: "plugins", subTab: "browse" },
    completeOn: "tour:plugins-browse-explored",
    highlightTestId: "plugin-browse-page",
    panelWidth: 360,
    subSteps: [
      { id: "scan-catalog", label: "Scan the catalog", hint: "Each card shows what the plugin does in one line. Disabled cards are dimmed; enabled ones get a colored border." },
      { id: "toggle-plugin", label: "Toggle one on", hint: "Flip the switch on any plugin to add it to your workspace. The sidebar updates immediately." },
      { id: "tier-gating", label: "Tier gates", hint: "Some plugins require Team tier or higher; the catalog still shows them so you can see what's available. (Artist and Research Lab are dev-build-only and are hidden from the catalog in production.)" },
    ],
  },
  {
    id: "plugin-companion",
    title: "Companion — your AI sidekick",
    description: "Companion is an always-available chat panel that knows about your agents, executions, and recent activity. It can answer questions, draft persona descriptions, and propose actions you can run with one click.",
    hint: "Open the Companion panel (footer icon) and ask it about your fleet.",
    nav: { sidebarSection: "plugins", subTab: "companion" },
    completeOn: "tour:plugin-surface-visited",
    highlightTestId: "companion-panel",
    subSteps: [
      { id: "open-companion", label: "Open the panel", hint: "The companion icon lives in the footer. Click to expand the chat surface." },
      { id: "proactive-cards", label: "Proactive cards", hint: "Companion sometimes surfaces \"Did you know?\" cards inline. Engage or dismiss." },
      { id: "autonomous", label: "Autonomous mode", hint: "Toggle autonomous to let Companion act on its own when it has high-confidence suggestions. Manual review stays default." },
    ],
  },
  {
    id: "plugin-twin",
    title: "Twin — your AI identity",
    description: "Twin captures your communication style, knowledge, and voice so agents can speak as you. Train it on past emails, set tone profiles, and route channels (Slack, email) through your twin.",
    hint: "Open Twin and look at the eight sub-tabs.",
    nav: { sidebarSection: "plugins", subTab: "twin" },
    completeOn: "tour:plugin-surface-visited",
    highlightTestId: "twin-page",
    panelWidth: 360,
    subSteps: [
      { id: "twin-profiles", label: "Profiles", hint: "Each profile is a distinct identity — \"work me\", \"weekend me\". Agents can pick which one to channel." },
      { id: "twin-tone", label: "Tone & voice", hint: "The Tone tab teaches the system how you write. The Voice tab handles audio cloning (Team+)." },
      { id: "twin-channels", label: "Channel routing", hint: "Connect Slack/email so messages drafted by an agent get reviewed-as-you before sending." },
    ],
  },
  {
    id: "plugin-dev-tools",
    title: "Dev Tools — projects, ideas, runners",
    description: "Dev Tools is the workspace-management plugin. Track local projects, scan a repo for idea seeds, triage the backlog, dispatch task-runners, and watch your Claude Code sessions in the Fleet sub-tab. Useful when an agent's job is to wrangle code.",
    hint: "Open Dev Tools and skim its sub-tabs.",
    nav: { sidebarSection: "plugins", subTab: "dev-tools" },
    completeOn: "tour:plugin-surface-visited",
    highlightTestId: "dev-tools-page",
    subSteps: [
      { id: "dev-projects", label: "Projects", hint: "Register a local repo so agents can chat with its files, scan for issues, or run scripts." },
      { id: "dev-idea-scanner", label: "Idea scanner / triage", hint: "Scan a project for backlog candidates, then approve or reject them in Idea Triage. Approved ideas become tasks." },
      { id: "dev-task-runner", label: "Task runner", hint: "Dispatch tasks to remote workers (or Claude Code sessions). Watch progress with live logs." },
    ],
  },
  {
    id: "plugin-others",
    title: "The Rest of the Plugins",
    description: "Two more plugins round out the production catalog: Drive (file sync) and Obsidian Brain (note-vault indexing + graph). In dev builds you'll also find Artist (image/video generation) and Research Lab (literature → hypotheses → experiments). Fleet — multi-session Claude Code orchestration — lives as a sub-tab of Dev Tools, not a standalone plugin.",
    hint: "Browse each plugin from the catalog and enable any that look useful.",
    nav: { sidebarSection: "plugins", subTab: "browse" },
    completeOn: "tour:plugin-surface-visited",
    highlightTestId: "plugin-browse-page",
    panelWidth: 360,
    subSteps: [
      { id: "drive-obsidian", label: "Drive & Obsidian Brain", hint: "Drive syncs files; Obsidian Brain indexes your vault for knowledge retrieval and graph navigation." },
      { id: "dev-extras", label: "Dev-build extras", hint: "Artist (Leonardo + Blender + media studio) and Research Lab (structured literature reviews + experiments) ship in dev builds only — handy to know they exist." },
    ],
  },
];

const SCHEDULES_MASTERY_STEPS: TourStepDef[] = [
  {
    id: "schedules-page",
    title: "The Schedules Dashboard",
    description: "Schedules is the at-a-glance view of every cron- and interval-driven agent in your fleet. It shows what fires next, what's paused, and lets you flip the global scheduler engine on or off.",
    hint: "Browse the active and paused schedules.",
    nav: { sidebarSection: "schedules" },
    completeOn: "tour:schedules-page-viewed",
    highlightTestId: "schedules-page",
    subSteps: [
      { id: "engine-toggle", label: "Engine toggle", hint: "The green/red badge in the header is the global scheduler. Pause it during deploys; resume to bring everything back." },
      { id: "active-paused", label: "Active vs paused", hint: "Active triggers have a blue badge with the count. Paused ones sit grouped with a pause icon — useful when debugging chains." },
      { id: "filter-by-persona", label: "Filter by persona", hint: "Click a persona name in the sidebar to filter schedules to just that agent. The blue indicator shows when a filter is active." },
    ],
  },
  {
    id: "schedules-views",
    title: "Timeline vs Calendar",
    description: "Two views of the same data. Timeline groups by time window (now, today, this week, later) — great for \"what's about to fire?\". Calendar shows month/week grids — better for \"how dense is Tuesday?\".",
    hint: "Toggle between Timeline and Calendar views.",
    nav: { sidebarSection: "schedules" },
    completeOn: "tour:schedules-view-toggled",
    highlightTestId: "schedules-page",
    subSteps: [
      { id: "timeline-view", label: "Timeline view", hint: "Default view. Groups by relative time so the next-to-fire schedule is always at the top." },
      { id: "calendar-view", label: "Calendar view", hint: "Click the view-tabs to switch to month/week. Hover any event to see persona, trigger config, and next fire time." },
      { id: "backfill", label: "Backfill missed runs", hint: "If the engine was paused and you want missed runs to execute now, the Backfill modal on any schedule replays the window." },
    ],
  },
  {
    id: "schedules-attach",
    title: "Attach a Schedule to an Agent",
    description: "Schedules attach per use-case. Open an agent, go to its Use Cases tab, pick a use case, and add a schedule subscription — a cron expression or a fixed interval. It shows up here on the Schedules dashboard on the next refresh.",
    hint: "Open an agent's Use Cases tab and schedule one of its use cases.",
    nav: { sidebarSection: "personas" },
    completeOn: "tour:schedule-attached",
    panelWidth: 360,
    subSteps: [
      { id: "open-agent", label: "Open an agent", hint: "Pick any agent from the list to enter its editor." },
      { id: "open-use-cases", label: "Open the Use Cases tab", hint: "Each capability can run on its own schedule. The Use Cases tab is where you wire that up.", highlightTestId: "design-subtab-use-cases" },
      { id: "add-schedule", label: "Add a schedule", hint: "Open a use case and add a schedule subscription — choose cron or a fixed interval and set the frequency." },
      { id: "verify-in-list", label: "Verify on the dashboard", hint: "Navigate back to Schedules. Your new schedule appears with its next fire time and a fresh \"active\" badge." },
    ],
  },
];

const TEMPLATES_RECIPES_STEPS: TourStepDef[] = [
  {
    id: "templates-page",
    title: "Templates Gallery",
    description: "Templates are pre-built agents you can adopt with one click — the catalog covers ~200 patterns (research, monitoring, code review, support, etc). Adoption opens a guided form that asks only for credentials and parameters that template needs.",
    hint: "Browse the generated templates and the n8n importer.",
    nav: { sidebarSection: "design-reviews" },
    completeOn: "tour:templates-page-viewed",
    highlightTestId: "templates-page",
    subSteps: [
      { id: "generated-tab", label: "Generated templates", hint: "AI-curated patterns sorted by popularity and capability match. Each card shows required connectors as chips so you know what to set up first." },
      { id: "n8n-tab", label: "n8n importer", hint: "Got a working n8n workflow? Paste the JSON or drop the file — the importer translates nodes into a Personas agent draft." },
      { id: "recipes-tab", label: "Recipes tab", hint: "Recipes are reusable multi-step plays (not full agents). We'll dig in next." },
    ],
  },
  {
    id: "templates-adopt",
    title: "Adopting a Template",
    description: "Pick a template card → the adoption flow opens. It walks you through three things: credentials (which Vault connectors to attach), parameters (slots the template asks the user to fill), and review (final matrix before promoting).",
    hint: "Click any generated template to start its adoption flow.",
    nav: { sidebarSection: "design-reviews", subTab: "generated", subTabSetter: "setTemplateTab" },
    completeOn: "tour:template-adopted",
    panelWidth: 360,
    highlightTestId: "templates-page",
    subSteps: [
      { id: "pick-template", label: "Pick a template", hint: "Click the most relevant card. Filters at the top help narrow by capability." },
      { id: "connect-credentials", label: "Connect credentials", hint: "The adoption form lists required connectors. Click \"Add\" on each missing one to open the Vault picker inline." },
      { id: "fill-parameters", label: "Fill parameters", hint: "Template-specific slots (Slack channel, GitHub repo, etc.) live below credentials. They become part of the prompt." },
      { id: "promote", label: "Approve & promote", hint: "Review the rendered matrix → Approve. The agent goes live just like a hand-built one." },
    ],
  },
  {
    id: "recipes-tab",
    title: "Recipes — Reusable Plays",
    description: "Recipes are multi-step prompt sequences you can run against any agent: \"give it a code review checklist\", \"escalate to manager\", \"summarize the last 20 executions\". They live separately from templates because they're cross-cutting, not agent-shaped.",
    hint: "Switch to the Recipes tab and browse the catalog.",
    nav: { sidebarSection: "design-reviews", subTab: "recipes", subTabSetter: "setTemplateTab" },
    completeOn: "tour:recipes-explored",
    highlightTestId: "templates-page",
    subSteps: [
      { id: "recipes-list", label: "Browse recipes", hint: "Each card shows the recipe steps and inputs. Click to inspect the full prompt chain before running." },
      { id: "recipe-playground", label: "Recipe playground", hint: "Run a recipe against a real agent in a sandboxed playground — output is captured but not persisted to the agent's history." },
      { id: "recipe-attach", label: "Attach to an agent", hint: "Once tested, attach a recipe to an agent so it runs automatically as part of that agent's playbook." },
    ],
  },
];

const TEAMS_ORCHESTRATION_STEPS: TourStepDef[] = [
  // ── The hands-on pipeline: register a repo → map it → define success →
  //    assemble a team → put it to work. Each is a walk-around stop that rings
  //    the real action button, so a broken/missing step in the chain surfaces.
  {
    id: "pipeline-project",
    title: "1 · Register your repo",
    description: "The pipeline starts by making a local code repository a first-class object the app can reason about. In Dev Tools › Projects, create a project: pick the folder, then under Source control bind it to a team (or a GitHub PAT) and pick the repo. Leave \"Create Codebase connector\" on — it wires a Codebase — <project> connector to the repo so agents read the right code.",
    hint: "Click \"New project\" and walk the three-stage stepper: Project → Source control → Standards.",
    nav: { sidebarSection: "plugins", subTab: "projects", subTabSetter: "setDevToolsTab" },
    completeOn: "tour:pipeline-project-explored",
    panelWidth: 380,
    highlightTestId: "dev-project-new",
    narration: "Everything starts with a repo. Register your project here, point it at the folder, connect your source control, and it becomes something the whole fleet can read and reason about.",
    subSteps: [
      { id: "folder", label: "Pick the folder", hint: "The project name auto-fills from the folder; the field stays editable." },
      { id: "source", label: "Connect source control", hint: "Bind a team or a GitHub PAT, then pick the repo — this also provisions the Codebase connector." },
      { id: "standards", label: "Set standards (optional)", hint: "Pre-commit gates, PR base branch, and auto-merge — the policy the team's agents will respect at run time." },
    ],
  },
  {
    id: "pipeline-context",
    title: "2 · Map the codebase",
    description: "A context-map scan reads the repo and organizes it into business-domain groups and per-feature contexts — each with its files, entry points, keywords, and API/DB surface. This map is the shared understanding the KPI scan and every agent reason over; without it they're working blind. The scan runs in the background and streams progress.",
    hint: "On the Context Map tab, run the scan — then look at the groups and contexts it produced.",
    nav: { sidebarSection: "plugins", subTab: "context-map", subTabSetter: "setDevToolsTab" },
    completeOn: "tour:pipeline-context-explored",
    panelWidth: 380,
    highlightTestId: "context-scan-button",
    narration: "Next, map the code. The scan turns your repo into business-domain groups and per-feature contexts — the shared map your KPIs and your agents both read from.",
    subSteps: [
      { id: "scan", label: "Run the scan", hint: "It maps the repo in the background and notifies on completion — large codebases can take a few minutes." },
      { id: "groups", label: "Groups & contexts", hint: "Each context card shows its files, keywords, and coverage badges (goals + ideas it produced)." },
      { id: "rescan", label: "Keep it fresh", hint: "Re-scan (incremental) maps only changed files since last time; Plan update schedules a weekly automatic scan." },
    ],
  },
  {
    id: "pipeline-kpi",
    title: "3 · Define success with KPIs",
    description: "KPIs are the outcome layer above goals — what \"working\" actually means for the project. Scan for KPIs and Claude reads the context map to propose measurable metrics across technical / quality / traffic / value, grounded in the repo. Accept or adjust them. A KPI going off-track is what derives a goal for the team, so this is where you set the targets that steer the work.",
    hint: "In Teams › KPIs, run \"Scan for KPIs\" and review the proposals it files.",
    nav: { sidebarSection: "teams", subTab: "kpis", subTabSetter: "setTeamsTab" },
    completeOn: "tour:pipeline-kpis-explored",
    panelWidth: 380,
    highlightTestId: "kpi-scan-button",
    narration: "Now define what success means. Scan for KPIs and Claude proposes measurable metrics from your codebase. These are the targets — an off-track KPI is what tells a team there's work to do.",
    subSteps: [
      { id: "scan", label: "Scan for KPIs", hint: "Claude reads the context map + connectors and proposes measurable KPIs across four categories." },
      { id: "review", label: "Accept / adjust", hint: "Each proposal shows its measurement procedure + rationale; accept (optionally adjusting the target/cadence) or reject." },
      { id: "steer", label: "How they steer", hint: "When a KPI drifts off its target, the loop derives a goal for the team — outcomes drive the work, not activity." },
    ],
  },
  {
    id: "pipeline-team",
    title: "4 · Assemble a team from a preset",
    description: "Rather than wiring a team by hand, adopt a pre-wired preset — a best-practice roster with its connection graph already drawn (e.g. the Web Development Team). The blueprint graph is the include/exclude surface: tap a node to keep or drop a member, then adopt the subset in one pass. Pin the team to your project so every member reads the right repo.",
    hint: "Click \"Preset Team\" to open the preset studio, then adopt one (e.g. Web Development Team).",
    nav: { sidebarSection: "teams", subTab: "workspace", subTabSetter: "setTeamsTab" },
    completeOn: "tour:pipeline-team-explored",
    panelWidth: 380,
    highlightTestId: "team-preset-btn",
    narration: "You don't have to build a team from scratch. Adopt a preset — a best-practice roster already wired together — pick which members you want, and you've got a working team in one pass.",
    subSteps: [
      { id: "gallery", label: "Browse presets", hint: "Each preset is a pre-wired team of agents for a workflow (e.g. an SDLC web-dev team)." },
      { id: "blueprint", label: "Tune the blueprint", hint: "The connection graph is the hero — toggle members on/off; sequential vs feedback edges are distinguished." },
      { id: "bind", label: "Bind to the project", hint: "Adopting for your repo pins every member to it, so the whole team works the same codebase." },
    ],
  },
  {
    id: "pipeline-orchestrate",
    title: "5 · Put the team to work",
    description: "With a team in place, open its Orchestrate mode, give it a goal in plain language, and Assign & Run. The orchestrator decomposes the goal into a checklist, matches each step to the best-fit agent, and runs them in a parallel DAG — pausing for your review only on failure. Shared team memory and the project's KPIs keep the team converging instead of repeating itself. You set direction; the team does the work.",
    hint: "Open a team, switch to Orchestrate, type a goal, and Assign & Run — then watch the live checklist.",
    nav: { sidebarSection: "teams", subTab: "workspace", subTabSetter: "setTeamsTab" },
    completeOn: "tour:pipeline-orchestrate-explored",
    panelWidth: 380,
    highlightTestId: "team-goal-input",
    narration: "Finally, put the team to work. Give it a goal in your own words, hit Assign and Run, and it breaks the goal down, picks agents, and executes in parallel — pausing only when it needs you.",
    subSteps: [
      { id: "goal", label: "Describe the goal", hint: "Plain language — \"add tests for the billing module and open a PR\". The system decomposes it." },
      { id: "run", label: "Assign & run", hint: "Each step is matched to an agent (manual / embedding / LLM) and runs in a parallel DAG." },
      { id: "watch", label: "Watch + steer", hint: "The live checklist shows each step's status; failures pause only that assignment with Edit / Reassign / Skip." },
    ],
  },
  {
    id: "team-canvas-intro",
    title: "What a Team Is",
    description: "A team is a set of agents plus the wiring that decides who runs, when, and with what shared context. The Team Canvas is where you compose it — persona nodes, connection edges, and per-team defaults. Roster membership and the runtime 'home team' anchor are distinct: an agent is placed on a team's canvas, and separately anchored to a team for its shared instructions and memory.",
    hint: "Open a team and look at the canvas — nodes are agents, edges are handoffs.",
    nav: { sidebarSection: "teams" },
    completeOn: "tour:team-canvas-explored",
    panelWidth: 360,
    narration: "A team is more than a folder of agents. It's the wiring — who runs, when, and what context they share. This canvas is where you compose that.",
    subSteps: [
      { id: "nodes", label: "Nodes are agents", hint: "Each node is a persona; its role and model overrides live in the node config." },
      { id: "edges", label: "Edges are handoffs", hint: "A connection means one agent's output can hand off to the next — the basis of event-chains (next step)." },
      { id: "defaults", label: "Team defaults", hint: "Shared instructions, default model profile, and budget caps cascade from the team to every member at run time." },
    ],
  },
  {
    id: "team-chaining",
    title: "How Teams Run: Event-Chains",
    description: "The original orchestration mode, and how most teams run today. An agent finishes → emits an event → a subscribed agent runs. There is no central driver — work propagates through the event bus. This is reactive and cheap; the handoff graph you wired on the canvas is what actually fires.",
    hint: "Trace one chain: which agent kicks it off, and who listens for its completion?",
    nav: { sidebarSection: "teams" },
    completeOn: "tour:team-chaining-understood",
    panelWidth: 360,
    narration: "Most teams run as event-chains. One agent finishes, emits an event, and the next agent — listening for it — wakes up. No central conductor, just a relay.",
    subSteps: [
      { id: "emit", label: "Finish → emit", hint: "A completed execution publishes an event (e.g. execution_completed) with its output." },
      { id: "listen", label: "Listen → run", hint: "An agent with a matching event subscription fires next. Wiring this subscription is what makes the chain real — miss it and the chain silently no-ops." },
      { id: "condition", label: "Conditions", hint: "Chain conditions (Any / Success / Failure / JSONPath) let a handoff fire only when the upstream output matches." },
    ],
  },
  {
    id: "team-assignments",
    title: "Goal-Driven Assignments",
    description: "The newer mode: instead of pre-wiring every step, give the team a goal in plain language. The system decomposes it into a checklist, matches each step to an agent (manual / embedding / LLM), and runs them in a parallel DAG — pausing for your review only on failure. The orange ListChecks badge on the canvas opens it.",
    hint: "Open the assignments panel and read a goal → checklist breakdown.",
    nav: { sidebarSection: "teams" },
    completeOn: "tour:team-assignment-explored",
    panelWidth: 360,
    narration: "Sometimes you don't want to wire every step. Give the team a goal in plain language, and it breaks the goal into a checklist, picks the right agent for each part, and runs them in parallel.",
    subSteps: [
      { id: "goal", label: "Describe a goal", hint: "\"Review these PRs and draft a changelog\" — the decompose step turns it into ordered, editable steps." },
      { id: "match", label: "Match agents", hint: "Each step is matched to an agent: manual (you pin), embedding (local cosine), or llm_eval (a Sonnet call picks)." },
      { id: "parallel", label: "Parallel DAG + review", hint: "Up to max_parallel_steps run at once; failure pauses only that assignment, with inline Edit / Reassign / Skip." },
    ],
  },
  {
    id: "team-memory-goals",
    title: "Shared Memory, Goals & Oversight",
    description: "Teams accumulate shared memory — decisions and constraints that get injected into every member's context on its next run, so the team converges instead of repeating itself. Link a team to a goal to track progress, and let the Director score executions and the Attention queue surface only what needs you. This is the 'set the direction, stay high-level' loop.",
    hint: "Open the team-memory panel; note how decisions persist across runs.",
    nav: { sidebarSection: "teams" },
    completeOn: "tour:team-memory-explored",
    panelWidth: 360,
    narration: "Teams remember. Decisions land in shared memory and flow into every teammate's next run. Link the team to a goal, and you can stay high-level while it converges.",
    subSteps: [
      { id: "memory", label: "Shared team memory", hint: "A compact digest of the team's top decisions is injected into each member's prompt — shared context without manual hand-offs." },
      { id: "goal-link", label: "Link to a goal", hint: "Tie the team to a tracked goal so progress, due dates, and stalls are visible — instead of running untracked." },
      { id: "oversight", label: "High-level oversight", hint: "The Director scores runs and the Attention queue raises only what needs a human — so you set direction, not babysit." },
    ],
  },
];

const OBSIDIAN_BRAIN_STEPS: TourStepDef[] = [
  {
    id: "obsidian-install",
    title: "Get Obsidian Ready",
    description: "Obsidian Brain mirrors your agents' memory into an Obsidian vault — plain markdown notes you fully own, edit, and back up. This step checks whether the Obsidian desktop app is installed: if it is, the step completes by itself. If not, install it now — it's free.",
    hint: "If this step doesn't complete on its own, install Obsidian from obsidian.md, open it once to create a vault, then click \"I've explored this\".",
    nav: { sidebarSection: "plugins", subTab: "setup", subTabSetter: "setObsidianBrainTab" },
    completeOn: "tour:obsidian-detected",
    highlightTestId: "obsidian-setup-panel",
    narration: "Before anything else, let's make sure Obsidian itself is in place. I'm checking for it now — if you don't have it yet, grab it free from obsidian dot md, open it once to create a vault, and come right back.",
    subSteps: [
      { id: "auto-check", label: "Automatic check", hint: "Personas probes for the Obsidian desktop app the moment this step opens — when it's found, the step ticks itself off." },
      { id: "install-missing", label: "Install if missing", hint: "Download Obsidian free from obsidian.md (Windows / macOS / Linux), launch it once, and create or open any vault folder." },
      { id: "why-obsidian", label: "Why Obsidian?", hint: "Vendor-neutral memory: every agent memory becomes a readable markdown file in a folder you own — git it, Drive it, or read it in bed." },
    ],
  },
  {
    id: "obsidian-vault-connect",
    title: "Connect a Vault",
    description: "The Setup tab links a vault to Personas. Auto-detect scans the locations Obsidian itself knows about, Test verifies the folder is a real vault, and Save Configuration activates it. Already connected? This step completes by itself.",
    hint: "Auto-detect (or browse to) your vault, press Test, then Save Configuration.",
    nav: { sidebarSection: "plugins", subTab: "setup", subTabSetter: "setObsidianBrainTab" },
    completeOn: "tour:obsidian-vault-connected",
    highlightTestId: "obsidian-setup-panel",
    narration: "Now let's wire a vault in. Hit auto-detect — Personas reads the same registry Obsidian uses — then test the folder and save. Your vault list on the right remembers every vault you connect, so switching later is one click.",
    subSteps: [
      { id: "detect", label: "Auto-detect vaults", hint: "Scans Obsidian's own config for known vaults. You can also Browse to any folder manually.", highlightTestId: "obsidian-detect-vaults" },
      { id: "test", label: "Test the connection", hint: "Verifies the folder has a .obsidian directory and counts its notes." },
      { id: "options", label: "Pick sync options", hint: "Choose what syncs — memories, persona profiles, connectors — and whether Auto-Sync fires on every memory write." },
      { id: "save", label: "Save configuration", hint: "Persists the vault and adds it to the Saved Vaults list. This is what completes the step.", highlightTestId: "obsidian-save-config" },
    ],
  },
  {
    id: "obsidian-sync-tab",
    title: "Sync — Push & Pull Memories",
    description: "Sync is the two-way bridge. Push writes agent memories, profiles, and connectors into the vault as markdown; Pull reads your edits back into the app. When both sides changed the same note, a conflict card shows a line-level diff with Keep App / Keep Vault / Skip.",
    hint: "Look over the push selector, the pull button, and the sync log.",
    nav: { sidebarSection: "plugins", subTab: "sync", subTabSetter: "setObsidianBrainTab" },
    completeOn: "tour:obsidian-tab-explored",
    highlightTestId: "obsidian-sync-panel",
    narration: "This is the bridge itself. Push sends memories into the vault as markdown. Pull brings your edits back — and that's the magic: edit a note in Obsidian, pull, and your agent now reasons with your curated version.",
    subSteps: [
      { id: "push", label: "Push to vault", hint: "Pick which personas to push with the chip selector — created / updated / skipped counts land in a result card." },
      { id: "pull-conflicts", label: "Pull + conflicts", hint: "Pull parses frontmatter back into the app. Conflicting edits show a blue/violet line diff above Keep App / Keep Vault / Skip." },
      { id: "sync-log", label: "Sync log", hint: "Every action is recorded — created, updated, conflict, skipped — with timestamps and the entity it touched." },
    ],
  },
  {
    id: "obsidian-browse-tab",
    title: "Browse the Vault",
    description: "A read-only explorer for the vault, inside the app. The folder tree shows note counts, the preview renders markdown with frontmatter lifted into a Properties row, and Open in Obsidian deep-links straight to the note.",
    hint: "Open a few notes; try the filter box and Open in Obsidian.",
    nav: { sidebarSection: "plugins", subTab: "browse", subTabSetter: "setObsidianBrainTab" },
    completeOn: "tour:obsidian-tab-explored",
    highlightTestId: "obsidian-browse-panel",
    narration: "Browse is your window into the vault without leaving Personas. Click through the tree, preview any note, and jump to the real thing in Obsidian with one button.",
    subSteps: [
      { id: "tree", label: "Folder tree", hint: "Collapsible folders with note counts. The filter box narrows the tree by file name." },
      { id: "preview", label: "Note preview", hint: "Markdown rendered with tables and code; YAML frontmatter becomes a Properties chip row; word count in the header." },
      { id: "deep-link", label: "Open in Obsidian", hint: "Launches the Obsidian app at the selected note via an obsidian:// link." },
    ],
  },
  {
    id: "obsidian-graph-tab",
    title: "Graph — Search & Quick Capture",
    description: "The Graph tab is the vault's metrics-and-capture surface: aggregate stats (notes, links, orphans, Maps of Content), a relevance-ranked search, and quick capture into today's daily note or a structured meeting note. A file watcher keeps stats live while you edit in Obsidian.",
    hint: "Run a search, skim the orphan and MOC lists, try a journal capture.",
    nav: { sidebarSection: "plugins", subTab: "graph", subTabSetter: "setObsidianBrainTab" },
    completeOn: "tour:obsidian-tab-explored",
    highlightTestId: "obsidian-graph-panel",
    narration: "Graph is where the vault becomes navigable: search it, find orphan notes that need linking, and capture thoughts straight into today's daily note. Agents get these same tools through the Obsidian Memory connector.",
    subSteps: [
      { id: "stats", label: "Vault stats", hint: "Notes, links, orphans, MOCs, and daily-note counts — every result row opens the note in Obsidian." },
      { id: "search", label: "Search", hint: "Relevance-ranked full-text search over the vault — the same tool agents call as vault_search." },
      { id: "capture", label: "Quick capture", hint: "Append a section to today's daily note, or write a meeting note with attendees — straight into the vault." },
    ],
  },
  {
    id: "obsidian-cloud-tab",
    title: "Cloud — Back Up to Google Drive",
    description: "Optional off-site backup: push the vault's files to your own Google Drive under Personas/ObsidianSync/ — a free alternative to Obsidian Sync. Only changed files upload (content-hash diff), and the drive.file scope means Personas can only see files it created.",
    hint: "Note the sign-in flow and the Push / Pull to Drive buttons.",
    nav: { sidebarSection: "plugins", subTab: "cloud", subTabSetter: "setObsidianBrainTab" },
    completeOn: "tour:obsidian-tab-explored",
    highlightTestId: "obsidian-cloud-panel",
    narration: "Cloud is belt and suspenders: back the whole vault up to your own Google Drive. It only sees files it created, and only uploads what changed.",
    subSteps: [
      { id: "signin", label: "Sign in + connect", hint: "Sign in with Google, then Connect Google Drive — Personas requests the narrow drive.file scope only." },
      { id: "pushpull", label: "Push / Pull", hint: "Push uploads changed vault files; Pull downloads remote changes back into the local folder." },
      { id: "separate", label: "Independent layer", hint: "Drive backup treats the vault as an opaque file tree — it's separate from the app⇄vault memory sync." },
    ],
  },
  {
    id: "obsidian-revitalize-tab",
    title: "Revitalize — the Memory Sleep Cycle",
    description: "Revitalize runs Claude over your vault in the background, the way sleep consolidates memory: prune stale notes, merge duplicates into canonical notes, refresh links and structure. A pass is bounded, narrates itself live, and ends with a summary — notes removed, merged, updated, and estimated tokens saved.",
    hint: "Review the three goals, the live log area, and the Recent passes history.",
    nav: { sidebarSection: "plugins", subTab: "revitalize", subTabSetter: "setObsidianBrainTab" },
    completeOn: "tour:obsidian-tab-explored",
    highlightTestId: "obsidian-revitalize-panel",
    narration: "Memory needs sleep. Revitalize lets Claude tidy the vault in the background — pruning stale notes, merging duplicates, fixing links — while status dots track it in the sidebar. Every pass ends with a report of what got cleaned.",
    subSteps: [
      { id: "goals", label: "Pick goals", hint: "Prune stale notes, aggregate duplicates, refresh structure — plus optional free-form guidance.", highlightTestId: "revitalize-goal-prune" },
      { id: "background", label: "Runs in background", hint: "Start a pass and keep working — fuchsia dots on Plugins → Brain → Revitalize track it; re-opening the tab re-attaches.", highlightTestId: "revitalize-start" },
      { id: "history", label: "Summary + history", hint: "Each pass ends with a stats card, and the Recent passes table keeps the last 20 runs — when, which vault, what was cleaned." },
    ],
  },
  {
    id: "obsidian-memory-dimensions",
    title: "Where Vault Memory Pays Off",
    description: "The vault isn't a side feature — it plugs into the app's memory everywhere. Agents write memories you can curate in Obsidian; agents with the Obsidian Memory connector read the vault at runtime; opt-in mirrors copy Research Lab, execution knowledge, and Athena's brain into it; and the Director writes its coaching history there.",
    hint: "Skim the dimensions below, then flip on any Knowledge mirror toggles you want.",
    nav: { sidebarSection: "plugins", subTab: "setup", subTabSetter: "setObsidianBrainTab" },
    completeOn: "tour:obsidian-memory-understood",
    highlightTestId: "obsidian-knowledge-mirror",
    panelWidth: 480,
    narration: "Here's the payoff. Agent memories become notes you co-author — your edits flow back into how agents reason. Agents can search the vault live. Research, execution knowledge, and Athena's brain can mirror into it. And the Director keeps its coaching history there. One vault, every memory dimension of the app.",
    subSteps: [
      { id: "curation-loop", label: "Curated agent memory", hint: "Agents write memories → they land as notes → you edit, link, and prune them in Obsidian → the next Pull feeds your curated version back into the agent's reasoning." },
      { id: "runtime-tools", label: "Obsidian Memory connector", hint: "Attach the obsidian_memory connector to an agent and it can search the vault, walk wikilinks/backlinks, and append daily or meeting notes while it runs." },
      { id: "knowledge-mirror", label: "Knowledge mirror", hint: "Opt-in toggles (visible once a vault is connected): mirror Research Lab findings, per-persona execution knowledge, and Athena's brain into the vault as markdown.", highlightTestId: "obsidian-knowledge-mirror" },
      { id: "director-brain", label: "Director coaching history", hint: "With the Director's long-term memory enabled, every verdict it writes lands in a Director/ folder — a durable, human-readable coaching log per agent." },
      { id: "hygiene", label: "Memory hygiene", hint: "Revitalize keeps all of the above lean — stale notes pruned, duplicates merged — so retrieval stays sharp as the vault grows." },
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
  {
    id: "plugins-explorer",
    title: "Plugins Explorer",
    description: "Walk through every plugin in the catalog — Companion, Twin, Dev Tools, and the supporting cast.",
    icon: "Puzzle",
    color: "amber",
    steps: PLUGINS_EXPLORER_STEPS,
  },
  {
    id: "schedules-mastery",
    title: "Schedules Mastery",
    description: "Read the schedules dashboard, switch between timeline and calendar views, and attach a schedule to an agent.",
    icon: "CalendarClock",
    color: "emerald",
    steps: SCHEDULES_MASTERY_STEPS,
  },
  {
    id: "templates-recipes",
    title: "Templates & Recipes",
    description: "Adopt pre-built agents from the template gallery and reuse multi-step recipes across your fleet.",
    icon: "FlaskConical",
    color: "indigo",
    steps: TEMPLATES_RECIPES_STEPS,
  },
  {
    id: "teams-orchestration",
    title: "Teams & Orchestration",
    description: "Walk the whole pipeline: register a repo, map its codebase, define success with KPIs, assemble a team from a preset, and put it to work on a goal — then see the orchestration model underneath (event-chains, assignments, shared memory).",
    icon: "GitBranch",
    color: "emerald",
    steps: TEAMS_ORCHESTRATION_STEPS,
  },
  {
    id: "obsidian-brain",
    title: "Obsidian Brain & Memory",
    description: "Install and connect Obsidian, walk every Brain tab — Sync, Browse, Graph, Cloud, Revitalize — and see where vault memory plugs into the rest of the app.",
    icon: "Brain",
    color: "violet",
    steps: OBSIDIAN_BRAIN_STEPS,
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
const TOUR_STATE_VERSION = 4;

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
    } catch (err) { silentCatch("stores/slices/system/tourSlice:catch1")(err); }
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
      } catch (err) { silentCatch("stores/slices/system/tourSlice:catch2")(err); }
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
  /**
   * Set when a tour is resumed from a dismissed state (e.g. the footer Resume
   * button). While true, `GuidedTour` shows a "continue where you left off"
   * window and does NOT auto-navigate the route — the redirect happens only
   * after the user clicks Continue (which clears this). Prevents the jarring
   * instant route jump the footer resume used to cause.
   */
  tourResumePending: boolean;
  tourActiveTourId: TourId;
  tourCurrentStepIndex: number;
  tourCompleted: boolean;
  tourDismissed: boolean;
  tourStepCompleted: Record<string, boolean>;
  tourCreatedPersonaId: string | null;
  tourSearchPrefill: string | null;
  tourSubStepIndex: number;
  tourHighlightTestId: string | null;
  /**
   * True when the current step's `tourHighlightTestId` target can't be found on
   * screen (initial anchor-miss or anchored-then-gone). Driven entirely by
   * `TourSpotlight` from the highlight's mount state. The panel shows a
   * "not on screen yet" note off this — the tour stays alive either way.
   */
  tourHighlightMissing: boolean;
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
  /** Manually move the active sub-step pointer (clamped) — lets the user step
   *  through a step's sub-steps at their own pace rather than only on events. */
  goToSubStep: (index: number) => void;
  setHighlightTestId: (testId: string | null) => void;
  setHighlightMissing: (missing: boolean) => void;
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
    "plugins-explorer": persisted?.tours?.["plugins-explorer"]?.completed ?? false,
    "schedules-mastery": persisted?.tours?.["schedules-mastery"]?.completed ?? false,
    "templates-recipes": persisted?.tours?.["templates-recipes"]?.completed ?? false,
    "teams-orchestration": persisted?.tours?.["teams-orchestration"]?.completed ?? false,
    "obsidian-brain": persisted?.tours?.["obsidian-brain"]?.completed ?? false,
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
    tourResumePending: false,
    tourActiveTourId: defaultTourId,
    tourCurrentStepIndex: ps?.currentStepIndex ?? 0,
    tourCompleted: ps?.completed ?? false,
    tourDismissed: ps?.dismissed ?? false,
    tourStepCompleted: ps?.completedSteps ?? {},
    tourCreatedPersonaId: null,
    tourSearchPrefill: null,
    tourSubStepIndex: ps?.subStepIndex ?? 0,
    tourHighlightTestId: null,
    tourHighlightMissing: false,
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
        // Cleared by default; the footer Resume path re-sets it to true right
        // after calling startTour so the interstitial shows for that path only.
        tourResumePending: false,
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
        // End of the step list. finishTour() force-marks EVERY step complete and
        // sets the per-tour completion badge — so only call it when the steps are
        // genuinely all done. A "Skip" on the last incomplete step also lands
        // here; it must NOT silently record the whole tour as 100% complete.
        // In that case just close the tour, leaving completion honest.
        const allDone = steps.every((st) => s.tourStepCompleted[st.id]);
        if (allDone) {
          get().finishTour();
        } else {
          set({ tourActive: false, tourResumePending: false, tourHighlightTestId: null });
          persistCurrentTour();
        }
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
      set({ tourActive: false, tourResumePending: false, tourDismissed: true, tourHighlightTestId: null });
      persistCurrentTour();
    },

    finishTour: () => {
      const s = get();
      const steps = getActiveTourSteps(s.tourActiveTourId);
      const allComplete = Object.fromEntries(steps.map((st) => [st.id, true]));
      set({
        tourActive: false,
        tourResumePending: false,
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
          tourResumePending: false,
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

    goToSubStep: (index) => {
      const s = get();
      const steps = getActiveTourSteps(s.tourActiveTourId);
      const currentStep = steps[s.tourCurrentStepIndex];
      if (!currentStep || currentStep.subSteps.length === 0) return;
      const clamped = Math.max(0, Math.min(index, currentStep.subSteps.length - 1));
      set({
        tourSubStepIndex: clamped,
        tourHighlightTestId: currentStep.subSteps[clamped]?.highlightTestId ?? null,
      });
      persistCurrentTour();
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

    setHighlightMissing: (missing) => set({ tourHighlightMissing: missing }),

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
