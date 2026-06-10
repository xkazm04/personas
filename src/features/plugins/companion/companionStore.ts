import { create } from 'zustand';
import type { CompanionState } from './types';
import type { StreamPhase } from './extractStreamPhase';
import type { TodoStep } from './operationalSteps';
import type { NarrationEntry, StoredNarration } from './narrationTimeline';
import {
  appendNarrationEntry as appendNarrationEntryPure,
  completeNarrationTool as completeNarrationToolPure,
  isTrailWorthKeeping,
} from './narrationTimeline';
import type { GuidanceWalkthrough } from './guidance/types';
import type { PendingDecision } from './decision/types';
import { ADHOC_TOPIC } from './guidance/walkthroughs';
import type {
  BackgroundJob,
  BrainKind,
  ChatCard,
  CompanionConnector,
  CompanionMessage,
  CompanionRecallPreview,
  CompanionTurnSummaryEvent,
  PendingApproval,
  PluginToggle,
  ProactiveMessage,
} from '@/api/companion';

/**
 * Stored per-turn dispatcher rollup, keyed by assistant episode id. Same
 * shape as `CompanionTurnSummaryEvent` minus the session/turn correlator
 * fields the chip doesn't need.
 */
export type StoredTurnSummary = Omit<
  CompanionTurnSummaryEvent,
  'sessionId' | 'turnId' | 'assistantEpisodeId'
>;

export type { CompanionMessage };

/**
 * Brain Viewer mode: hidden when null, otherwise a 3-step wizard:
 *   types → list → detail
 * The current cursor = (kind, id?). When `kind` is set but `id` is null,
 * we're on the list view for that kind. When both are set, we're on
 * detail. When kind is null, we're on the type picker.
 */
export interface BrainViewState {
  open: boolean;
  kind: BrainKind | null;
  id: string | null;
}

/**
 * Latest spoken-summary stashed for playback. Cleared as soon as the user
 * plays it (or hits Reset). Lives in the store rather than as component
 * state because the footer Play button (DesktopFooter) and the chat
 * panel both need to see it — and to coordinate so we don't double-play
 * when the panel is open and the footer button is clicked.
 *
 * `audioUrl` is set lazily on first play (the Blob URL for the decoded
 * MP3 bytes). Subsequent plays reuse the same URL so we don't re-hit
 * ElevenLabs every replay.
 */
export interface PendingPlayback {
  episodeId: string;
  ttsText: string;
  played: boolean;
  audioUrl: string | null;
}

/**
 * Lightweight "Athena has something new" cue surfaced above the footer
 * icon. Lives in the store rather than as component state because two
 * surfaces emit notices (streaming-finish in the footer icon itself, and
 * proactive deliveries that arrive via the always-mounted CompanionPanel
 * Tauri listeners) and one surface renders them. Cleared when the user
 * opens the panel, clicks the popover, or after a short auto-dismiss.
 *
 * `ttsSpoken` is flipped after the optional spoken announcement so the
 * effect doesn't fire twice if the component re-renders for unrelated
 * reasons (e.g., voice settings tweak mid-flight).
 */
export type FooterNoticeKind = 'analysis_complete' | 'proactive';

export interface FooterNotice {
  id: string;
  kind: FooterNoticeKind;
  subject: string;
  ttsSpoken: boolean;
  createdAt: number;
}

interface CompanionStore {
  // UI state
  state: CompanionState;
  // Init
  brainPath: string | null;
  initError: string | null;
  initialized: boolean;
  // Chat
  messages: CompanionMessage[];
  streaming: boolean;
  /** Live-accumulated assistant text for the current turn. */
  streamingText: string;
  /**
   * Live progress hint while a turn is streaming — what Athena is
   * currently doing (thinking, using a tool, etc.). Surfaces under the
   * streaming bubble so the user sees activity instead of a dead
   * "thinking…" placeholder when text hasn't arrived yet.
   *
   * Populated from `extractStreamPhase` on each CLI line. Cleared when
   * actual prose text starts arriving (the visible text IS the signal)
   * and again when the turn finishes / errors / is interrupted.
   */
  streamingPhase: StreamPhase | null;
  /**
   * Latest model-authored progress beat (`PROGRESS:` line) for the current
   * turn — Athena's own words narrating a long turn ("Reading the logs…").
   * Shown in the streaming bubble in preference to the derived phase, and
   * spoken aloud when voice is on (Variant B in
   * docs/features/companion/conversation-orchestration.md). Cleared on turn
   * start / finish.
   */
  streamingBeat: string | null;
  sendError: string | null;

  setState: (state: CompanionState) => void;
  setBrainPath: (path: string | null) => void;
  setInitError: (error: string | null) => void;
  setInitialized: (value: boolean) => void;

  setMessages: (msgs: CompanionMessage[]) => void;
  appendMessage: (msg: CompanionMessage) => void;
  setStreaming: (value: boolean) => void;
  appendStreamingText: (chunk: string) => void;
  resetStreamingText: () => void;
  setStreamingPhase: (phase: StreamPhase | null) => void;
  setStreamingBeat: (beat: string | null) => void;
  setSendError: (err: string | null) => void;

  // Phase 3: approvals
  approvals: PendingApproval[];
  setApprovals: (a: PendingApproval[]) => void;
  removeApproval: (id: string) => void;

  // Quick-reply chips (Athena's offered presets for the current turn).
  // One-shot — cleared when the user sends any message or resets.
  quickReplies: string[];
  setQuickReplies: (q: string[]) => void;

  // Inline chat-cards emitted by `show_persona_overview` etc. One-shot, like
  // quickReplies — cleared on next send / reset. Rendered in the chat body
  // alongside ApprovalCards on the latest assistant turn.
  chatCards: ChatCard[];
  setChatCards: (cards: ChatCard[]) => void;

  // Brain Viewer state
  brainView: BrainViewState;
  setBrainView: (next: BrainViewState) => void;

  // Phase 4: self-improve loop state
  betaSelfImprove: boolean;
  setBetaSelfImprove: (v: boolean) => void;
  improving: boolean;
  setImproving: (v: boolean) => void;
  // In-transcript search (header toggle + query bar). Closing clears the query.
  chatSearchOpen: boolean;
  setChatSearchOpen: (v: boolean) => void;
  chatSearchQuery: string;
  setChatSearchQuery: (q: string) => void;

  // Phase E: proactive messages awaiting engagement (delivered or queued).
  proactive: ProactiveMessage[];
  setProactive: (msgs: ProactiveMessage[]) => void;
  appendProactive: (msg: ProactiveMessage) => void;
  removeProactive: (id: string) => void;

  // Phase F: connectors pinned in the chat sidebar.
  connectors: CompanionConnector[];
  setConnectors: (c: CompanionConnector[]) => void;

  // Phase F: plugin toggles (Dev Tools, future). Backend default is
  // off; the toolbar shows the live state and writes through on click.
  pluginToggles: PluginToggle[];
  setPluginToggles: (toggles: PluginToggle[]) => void;

  // Phase 4.5: voice playback
  pendingPlayback: PendingPlayback | null;
  setPendingPlayback: (p: PendingPlayback | null) => void;
  /** Cache the synthesized audio URL onto the active playback record. */
  setPlaybackAudioUrl: (audioUrl: string) => void;
  /** Mark the active playback as already heard (footer Play hides itself). */
  markPlaybackPlayed: () => void;

  // Footer notice — "Athena has something new" cue shown above the bot
  // icon. One slot, latest-wins. See FooterNotice docstring.
  footerNotice: FooterNotice | null;
  setFooterNotice: (notice: FooterNotice | null) => void;
  markFooterNoticeSpoken: () => void;
  clearFooterNotice: () => void;

  /**
   * One-shot prompt injected into the composer by external surfaces
   * (e.g. the message detail modal's "Play in chat" button). The
   * composer subscribes and consumes on every fresh value.
   *
   * - `text` — composer content.
   * - `autoSend` — if true, the composer fires `onSend` immediately
   *   instead of filling the draft and waiting for the user to click.
   *   Used by surfaces that have already shown the user the seed
   *   context (e.g. the message modal closes; user lands on the live
   *   reply) so a manual send-click would be redundant.
   */
  pendingPrompt: PendingPromptPayload | null;
  setPendingPrompt: (p: PendingPromptPayload | null) => void;
  consumePendingPrompt: () => PendingPromptPayload | null;

  /**
   * One-shot voice turn fired from outside the chat panel (the footer's
   * hold-to-talk affordance). Distinct from `pendingPrompt` on purpose:
   * `pendingPrompt` seeds the composer draft and is only consumed while
   * the panel — and therefore the Composer — is mounted. `voiceTurnRequest`
   * is consumed by an always-mounted effect in `CompanionPanel` so the
   * user can speak to Athena and hear her reply (via the existing TTS +
   * footer Play / notice pipeline) without ever opening the panel.
   *
   * Latest-wins; the consumer clears it before it calls `send()`.
   */
  voiceTurnRequest: string | null;
  setVoiceTurnRequest: (text: string | null) => void;

  /**
   * Monotonic nonce bumped each time a pre-composed message is forwarded to
   * Athena from an outside surface (e.g. the dashboard "Ask Athena" button).
   * The orb subscribes to it and fires a one-shot "message received" ack glow
   * (yellow) so the user gets immediate visual confirmation while the (often
   * long-running) turn spins up. Visual-only — the send itself rides
   * `voiceTurnRequest`.
   */
  forwardAckPulse: number;
  pulseForwardAck: () => void;

  /**
   * Screen-space center (viewport px) of the orb at the moment the user
   * tapped it to open the chat. Lets `CompanionPanel` animate its entrance
   * from the orb's position (and exit back toward it) for an orb→panel
   * morph. Null when the panel was opened from somewhere other than the orb
   * (e.g. the footer), in which case the panel uses its default entrance.
   */
  orbOpenOrigin: { x: number; y: number } | null;
  setOrbOpenOrigin: (origin: { x: number; y: number } | null) => void;

  /**
   * Per-turn recall preview surfaced from the backend's `recall-preview`
   * event. `streamingRecall` is the live, in-flight strip shown above the
   * streaming bubble; on the `finished` stream event it's moved into
   * `recallByEpisodeId` keyed by the assistant episode id so the strip
   * persists above the just-completed bubble. Both cleared on conversation
   * reset.
   *
   * Persistence is intentionally session-scoped: after an app restart,
   * older bubbles drop their strip (the underlying recall is ephemeral
   * working memory anyway). Stage 2 of this feature would persist + replay.
   */
  streamingRecall: CompanionRecallPreview | null;
  recallByEpisodeId: Record<string, CompanionRecallPreview>;
  setStreamingRecall: (preview: CompanionRecallPreview | null) => void;
  /** Promote the in-flight strip to the named assistant episode id. */
  attachRecallToEpisode: (episodeId: string) => void;
  clearAllRecall: () => void;

  /**
   * Per-turn dispatcher rollup, keyed by assistant episode id. Populated
   * from `companion://turn-summary` events; reset alongside the rest of
   * the conversation state. Same persistence model as `recallByEpisodeId`
   * — session-scoped, lost on app restart.
   */
  turnSummaryByEpisodeId: Record<string, StoredTurnSummary>;
  setTurnSummary: (episodeId: string, summary: StoredTurnSummary) => void;
  clearAllTurnSummaries: () => void;

  /**
   * Live state of every `connector_use` background job we've seen on the
   * `companion://job` channel, keyed by job id. The card subscribes to a
   * single job's status and re-renders as the worker transitions
   * queued → running → completed/failed.
   *
   * `pendingConnectorJobIds` collects jobs queued in the current
   * (streaming) turn before the assistant episode id is known; at
   * `finished` time they're promoted into `connectorJobIdsByEpisodeId`
   * so the cards pin under the right bubble.
   */
  jobsById: Record<string, BackgroundJob>;
  pendingConnectorJobIds: string[];
  connectorJobIdsByEpisodeId: Record<string, string[]>;
  upsertJob: (job: BackgroundJob) => void;
  attachPendingJobsToEpisode: (episodeId: string) => void;
  clearAllConnectorJobs: () => void;

  /**
   * Async-UX phase 4b — long in-turn tool calls surfaced as tasks. When a
   * tool_use block in Athena's CLI stream (WebFetch, Bash, a Task subagent,
   * any MCP tool) stays pending past a threshold, CompanionPanel synthesizes
   * a `BackgroundJob` here keyed by the tool_use id, so the slow call shows
   * in the activity tray + as an orb dot rather than as a frozen, silent
   * turn. These are NOT real `companion_background_job` rows (they live only
   * here, never in `jobsById`) and never pin in-chat — the streaming-phase
   * chip already covers the in-bubble view. Cleared at turn end.
   */
  inTurnToolJobs: Record<string, BackgroundJob>;
  upsertInTurnToolJob: (job: BackgroundJob) => void;
  completeInTurnToolJob: (id: string) => void;
  clearInTurnToolJobs: () => void;

  /**
   * Async-UX phase 4 — non-blocking conversation. Messages the user sent
   * while a turn was still streaming. Each is queued (FIFO) and drained
   * one-per-turn-completion by CompanionPanel. `mode` records how the
   * message was classified at send time: an `interrupt` also stopped the
   * in-flight turn; a `queue` simply waits its turn. The composer is never
   * disabled — this is where mid-turn input lands instead of being blocked.
   */
  queuedMessages: { id: string; text: string; mode: 'queue' | 'interrupt' }[];
  enqueueMessage: (text: string, mode: 'queue' | 'interrupt') => void;
  shiftQueuedMessage: () => { id: string; text: string; mode: 'queue' | 'interrupt' } | null;
  removeQueuedMessage: (id: string) => void;
  clearQueuedMessages: () => void;

  /**
   * The "operational thread": Athena's live TodoWrite plan, parsed from
   * TodoWrite tool calls in the stream. `streamingSteps` is the in-flight
   * checklist (latest TodoWrite call wins — each call re-sends the full
   * list); on `finished` it's promoted to `stepsByEpisodeId` keyed by the
   * assistant episode id so the checklist persists inline under the
   * completed bubble. Session-scoped, same model as recall/turn-summary.
   */
  streamingSteps: TodoStep[];
  stepsByEpisodeId: Record<string, TodoStep[]>;
  setStreamingSteps: (steps: TodoStep[]) => void;
  attachStepsToEpisode: (episodeId: string) => void;
  clearAllSteps: () => void;

  /**
   * Narration timeline (D2 in conversation-orchestration.md): the
   * turn-scoped log of Athena's `PROGRESS:` beats + tool calls.
   * `streamingNarration` accumulates while the turn runs (rendered as a
   * dimmed live log under the streaming bubble); on `finished` it's
   * promoted to `narrationByEpisodeId` so a collapsed "What I did" trail
   * persists under the completed bubble. Trivial trails (one fast step,
   * no beats) are dropped at attach time rather than pinned. Session-
   * scoped, same model as recall/steps.
   */
  streamingNarration: NarrationEntry[];
  streamingNarrationStartedAt: number | null;
  narrationByEpisodeId: Record<string, StoredNarration>;
  /** Reset the in-flight timeline at turn start. */
  beginNarration: () => void;
  appendNarrationEntry: (entry: NarrationEntry) => void;
  completeNarrationTool: (id: string) => void;
  /** Promote the in-flight timeline onto the persisted assistant episode. */
  attachNarrationToEpisode: (episodeId: string) => void;
  /** Drop the in-flight timeline without promoting (error/interrupt). */
  resetStreamingNarration: () => void;
  clearAllNarration: () => void;

  // Phase C2 — Athena-dispatched team assignments. Cards display inline
  // above the chat messages; each card is updated by the assignment
  // progress listener. Bounded to the 6 most-recent so the chat doesn't
  // get crowded by an old session's history.
  athenaAssignments: AthenaAssignmentRef[];
  upsertAthenaAssignment: (ref: AthenaAssignmentRef) => void;
  dismissAthenaAssignment: (assignmentId: string) => void;

  /**
   * Athena guided-walkthrough state (ephemeral, session-scoped). A walkthrough
   * is a registry-defined sequence of steps (see `guidance/walkthroughs.ts`);
   * Athena triggers one by topic (`startGuidance`) and the runner
   * (`guidance/useGuidanceRunner`) walks the steps, writing the per-step
   * highlight + orb target that the glow overlay (`orb/TrackedGlowRing`) and the
   * orb (`orb/AthenaOrb`) read.
   *
   *  - `activeWalkthrough` — topic id of the running walkthrough, or null.
   *  - `guidanceStepIndex` — current 0-based step.
   *  - `guidancePlaying` — false = paused (auto-advance suspended).
   *  - `guidanceHighlightTestId` — element the glow overlay rings this step.
   *  - `orbGuideTarget` — viewport-px top-left the orb glides to this step.
   *
   * The store is intentionally dumb: it holds raw state, the runner owns the
   * registry + per-step derivation. Cleared by `stopGuidance`.
   */
  activeWalkthrough: string | null;
  guidanceStepIndex: number;
  guidancePlaying: boolean;
  guidanceHighlightTestId: string | null;
  orbGuideTarget: { left: number; top: number } | null;
  /**
   * Runtime-composed walkthrough (Athena's `point_at` single step or
   * `compose_walkthrough` multi step), or null. Resolved by
   * `resolveWalkthrough` when `activeWalkthrough === ADHOC_TOPIC` — the runner
   * walks these steps exactly like a registry walkthrough.
   */
  adHocWalkthrough: GuidanceWalkthrough | null;
  startGuidance: (topic: string) => void;
  /** Start a runtime-composed walkthrough (sets `activeWalkthrough` to the ad-hoc sentinel). */
  startAdHocGuidance: (walkthrough: GuidanceWalkthrough) => void;
  setGuidanceStep: (index: number) => void;
  advanceGuidance: () => void;
  /** Step back one (clamped at 0). Pauses auto-advance — manual nav means the user has taken control. */
  previousGuidance: () => void;
  /** Jump to an arbitrary step (clamped ≥ 0). Pauses auto-advance, like `previousGuidance`. */
  jumpToStep: (index: number) => void;
  pauseGuidance: () => void;
  resumeGuidance: () => void;
  stopGuidance: () => void;
  setGuidanceHighlightTestId: (testId: string | null) => void;
  setOrbGuideTarget: (target: { left: number; top: number } | null) => void;
  /**
   * Proactive one-shot "look here" highlight — independent of walkthroughs.
   * Rings an element briefly (auto-clears after `ms`) when Athena navigates or
   * composes a surface, so the user's eye lands on what she just brought up. An
   * optional `label` rides as a small chip on the ring ("Just composed"). No
   * orb, no caption, fire-and-forget. Skipped while a walkthrough is active so
   * it never fights the guidance ring.
   */
  flashHighlightTestId: string | null;
  flashHighlightLabel: string | null;
  flashHighlight: (testId: string, opts?: { ms?: number; label?: string }) => void;

  /**
   * Athena hands-free decision layer (P3, ephemeral — NOT persisted). A
   * `pendingDecision` is the single numbered-choice the orb bubble
   * (`orb/OrbDecisionBubble`) surfaces above Athena. The aggregator
   * (`decision/useDecisionQueue`) feeds approvals / human-reviews / incidents
   * in one-at-a-time when none is pending; the bubble renders the prompt +
   * digit-pickable options. `decisionExplained` tracks whether the user picked
   * `0` ("explain + recommend") so the bubble re-asks with the recommendation
   * shown above the still-present options.
   *
   *  - `setPendingDecision(d)` — show a decision (resets `decisionExplained`).
   *  - `clearPendingDecision()` — dismiss / resolved (also clears explained).
   *  - `markDecisionExplained()` — `0` was picked; keep the decision, show the
   *    recommendation. No-op when nothing is pending.
   */
  pendingDecision: PendingDecision | null;
  decisionExplained: boolean;
  setPendingDecision: (decision: PendingDecision) => void;
  clearPendingDecision: () => void;
  markDecisionExplained: () => void;

  /**
   * Explain-in-Cockpit composing state. True from the moment `0` escalates
   * into a `decision-explain` turn until either the `explain_in_cockpit`
   * event lands (CompanionPanel listener clears it) or the turn finishes
   * without emitting the op. Drives the orb's `composing` avatar clip and
   * the bubble's processing row. `explainComposeError` is a short token
   * (`'no-spec' | 'turn-failed'`) the bubble maps to a translated fallback
   * line; reset on the next decision / next `0`.
   */
  explainComposing: boolean;
  explainComposeError: string | null;
  setExplainComposing: (v: boolean) => void;
  setExplainComposeError: (v: string | null) => void;

  /**
   * Notify-only indicator for an autonomous fleet auto-decision (the "Notify
   * only" safety net). Set when Athena auto-fires a high-confidence
   * `fleet_send_input` into one of her own sessions; the orb flashes a brief
   * "Athena → {project}: {text}" pill that self-clears. Ephemeral / FYI — there
   * is no undo (the user opted out of an undo window), so this never blocks.
   */
  fleetAutoNotice: FleetAutoNotice | null;
  setFleetAutoNotice: (notice: FleetAutoNotice) => void;
  clearFleetAutoNotice: () => void;
}

/** One autonomous fleet auto-decision the orb briefly surfaces (notify-only). */
export interface FleetAutoNotice {
  /** Internal fleet session id Athena typed into. */
  sessionId: string;
  /** Project label for the session (falls back to empty string). */
  projectLabel: string;
  /** The exact text Athena auto-sent. */
  text: string;
  /** Monotonic-ish stamp (Date.now) used as a render key so repeats re-animate. */
  at: number;
}

/** Compact projection of an assignment + its current status, surfaced as
 *  a chat-side card. Populated by `useCompanionAssignmentBridge`. */
export interface AthenaAssignmentRef {
  assignmentId: string;
  teamId: string;
  title: string;
  goal: string;
  status: string;
  totalSteps: number;
  doneSteps: number;
  failedSteps: number;
  updatedAt: number;
}

export interface PendingPromptPayload {
  text: string;
  autoSend?: boolean;
}

/** Auto-clear timer for the proactive `flashHighlight` ring (module-scoped so a
 *  newer flash cancels the prior one's pending clear). */
let flashTimer: ReturnType<typeof setTimeout> | null = null;

export const useCompanionStore = create<CompanionStore>((set, get) => ({
  state: 'collapsed',
  brainPath: null,
  initError: null,
  initialized: false,
  messages: [],
  streaming: false,
  streamingText: '',
  streamingPhase: null,
  streamingBeat: null,
  sendError: null,

  setState: (state) => set({ state }),
  setBrainPath: (brainPath) => set({ brainPath }),
  setInitError: (initError) => set({ initError }),
  setInitialized: (initialized) => set({ initialized }),

  setMessages: (messages) => set({ messages }),
  appendMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),
  setStreaming: (streaming) => set({ streaming }),
  appendStreamingText: (chunk) =>
    set((s) => ({ streamingText: s.streamingText + chunk })),
  resetStreamingText: () => set({ streamingText: '' }),
  setStreamingPhase: (streamingPhase) => set({ streamingPhase }),
  setStreamingBeat: (streamingBeat) => set({ streamingBeat }),
  setSendError: (sendError) => set({ sendError }),

  approvals: [],
  setApprovals: (approvals) => set({ approvals }),
  removeApproval: (id) =>
    set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) })),

  quickReplies: [],
  setQuickReplies: (quickReplies) => set({ quickReplies }),

  chatCards: [],
  setChatCards: (chatCards) => set({ chatCards }),

  athenaAssignments: [],
  upsertAthenaAssignment: (ref) =>
    set((s) => {
      const next = s.athenaAssignments.filter((a) => a.assignmentId !== ref.assignmentId);
      next.push(ref);
      next.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      return { athenaAssignments: next.slice(0, 6) };
    }),
  dismissAthenaAssignment: (assignmentId) =>
    set((s) => ({
      athenaAssignments: s.athenaAssignments.filter((a) => a.assignmentId !== assignmentId),
    })),

  brainView: { open: false, kind: null, id: null },
  setBrainView: (brainView) => set({ brainView }),

  betaSelfImprove: false,
  setBetaSelfImprove: (betaSelfImprove) => set({ betaSelfImprove }),
  improving: false,
  setImproving: (improving) => set({ improving }),
  chatSearchOpen: false,
  setChatSearchOpen: (chatSearchOpen) =>
    set(
      chatSearchOpen
        ? { chatSearchOpen }
        : { chatSearchOpen: false, chatSearchQuery: '' },
    ),
  chatSearchQuery: '',
  setChatSearchQuery: (chatSearchQuery) => set({ chatSearchQuery }),

  connectors: [],
  setConnectors: (connectors) => set({ connectors }),

  pluginToggles: [],
  setPluginToggles: (pluginToggles) => set({ pluginToggles }),

  proactive: [],
  setProactive: (proactive) => set({ proactive }),
  appendProactive: (msg) =>
    set((s) => {
      // Dedupe by id — the scheduler can re-fire if the user reopens
      // the app while a message is already loaded from the listing.
      if (s.proactive.some((m) => m.id === msg.id)) return s;
      return { proactive: [msg, ...s.proactive] };
    }),
  removeProactive: (id) =>
    set((s) => ({ proactive: s.proactive.filter((m) => m.id !== id) })),

  pendingPlayback: null,
  setPendingPlayback: (pendingPlayback) =>
    set((s) => {
      // Revoke the prior blob URL on replacement / clear so long chat
      // sessions don't accumulate ~50KB-per-reply of un-GC'able blob
      // memory. Skip when the URL is unchanged (e.g. setPlaybackAudioUrl
      // routes through this setter is not the case — that uses its own
      // setter — but defensive equality check costs nothing).
      const prior = s.pendingPlayback?.audioUrl;
      const next = pendingPlayback?.audioUrl ?? null;
      if (prior && prior !== next) {
        URL.revokeObjectURL(prior);
      }
      return { pendingPlayback };
    }),
  setPlaybackAudioUrl: (audioUrl) =>
    set((s) =>
      s.pendingPlayback
        ? { pendingPlayback: { ...s.pendingPlayback, audioUrl } }
        : s,
    ),
  markPlaybackPlayed: () =>
    set((s) =>
      s.pendingPlayback
        ? { pendingPlayback: { ...s.pendingPlayback, played: true } }
        : s,
    ),

  footerNotice: null,
  setFooterNotice: (footerNotice) => set({ footerNotice }),
  markFooterNoticeSpoken: () =>
    set((s) =>
      s.footerNotice
        ? { footerNotice: { ...s.footerNotice, ttsSpoken: true } }
        : s,
    ),
  clearFooterNotice: () => set({ footerNotice: null }),

  pendingPrompt: null,
  setPendingPrompt: (pendingPrompt: PendingPromptPayload | null) => set({ pendingPrompt }),
  consumePendingPrompt: (): PendingPromptPayload | null => {
    const prompt = get().pendingPrompt;
    if (prompt !== null) set({ pendingPrompt: null });
    return prompt;
  },

  voiceTurnRequest: null,
  setVoiceTurnRequest: (voiceTurnRequest) => set({ voiceTurnRequest }),

  forwardAckPulse: 0,
  pulseForwardAck: () => set((s) => ({ forwardAckPulse: s.forwardAckPulse + 1 })),

  orbOpenOrigin: null,
  setOrbOpenOrigin: (orbOpenOrigin) => set({ orbOpenOrigin }),

  streamingRecall: null,
  recallByEpisodeId: {},
  setStreamingRecall: (streamingRecall) => set({ streamingRecall }),
  attachRecallToEpisode: (episodeId) =>
    set((s) => {
      if (!s.streamingRecall || !episodeId) {
        return { streamingRecall: null };
      }
      return {
        streamingRecall: null,
        recallByEpisodeId: {
          ...s.recallByEpisodeId,
          [episodeId]: s.streamingRecall,
        },
      };
    }),
  clearAllRecall: () =>
    set({ streamingRecall: null, recallByEpisodeId: {} }),

  turnSummaryByEpisodeId: {},
  setTurnSummary: (episodeId, summary) =>
    set((s) => ({
      turnSummaryByEpisodeId: {
        ...s.turnSummaryByEpisodeId,
        [episodeId]: summary,
      },
    })),
  clearAllTurnSummaries: () => set({ turnSummaryByEpisodeId: {} }),

  jobsById: {},
  pendingConnectorJobIds: [],
  connectorJobIdsByEpisodeId: {},
  upsertJob: (job) =>
    set((s) => {
      const next: Partial<CompanionStore> = {
        jobsById: { ...s.jobsById, [job.id]: job },
      };
      // Pin tasks spawned by a turn under the spawning bubble (in-chat
      // tags). `connector_use` is always pinned (it only auto-fires
      // mid-turn) and renders as the rich ConnectorCallCard; any other
      // kind enqueued while a turn is streaming (scan_codebase,
      // memory_curation_run, …) is pinned too and renders as the compact
      // TaskTag. Approval-click tasks fire while idle (streaming=false) →
      // they stay out of the transcript and surface only in the tray.
      const shouldPin = job.kind === 'connector_use' || s.streaming;
      const alreadyAttached = Object.values(s.connectorJobIdsByEpisodeId).some(
        (ids) => ids.includes(job.id),
      );
      if (shouldPin && !s.pendingConnectorJobIds.includes(job.id) && !alreadyAttached) {
        // Late-arrival attach: a `connector_use` job event can land AFTER
        // the turn's `finished` event already ran `attachPendingJobsToEpisode`
        // and cleared the pending list. In that case the job would sit
        // orphaned in `pendingConnectorJobIds` forever (and its
        // ConnectorCallCard would never render under the bubble that
        // spawned it, or worse, attach to the NEXT turn). When we're not
        // streaming and there's a most-recent assistant episode, pin the
        // job straight onto it instead of staging it as pending.
        const lastAssistant = [...s.messages]
          .reverse()
          .find((m) => m.role === 'assistant');
        if (!s.streaming && job.kind === 'connector_use' && lastAssistant) {
          const existing = s.connectorJobIdsByEpisodeId[lastAssistant.id] ?? [];
          next.connectorJobIdsByEpisodeId = {
            ...s.connectorJobIdsByEpisodeId,
            [lastAssistant.id]: [...existing, job.id],
          };
        } else {
          next.pendingConnectorJobIds = [...s.pendingConnectorJobIds, job.id];
        }
      }
      return next;
    }),
  attachPendingJobsToEpisode: (episodeId) =>
    set((s) => {
      if (!episodeId || s.pendingConnectorJobIds.length === 0) {
        return { pendingConnectorJobIds: [] };
      }
      const existing = s.connectorJobIdsByEpisodeId[episodeId] ?? [];
      return {
        pendingConnectorJobIds: [],
        connectorJobIdsByEpisodeId: {
          ...s.connectorJobIdsByEpisodeId,
          [episodeId]: [...existing, ...s.pendingConnectorJobIds],
        },
      };
    }),
  clearAllConnectorJobs: () =>
    set({
      jobsById: {},
      pendingConnectorJobIds: [],
      connectorJobIdsByEpisodeId: {},
    }),

  inTurnToolJobs: {},
  upsertInTurnToolJob: (job) =>
    set((s) => ({ inTurnToolJobs: { ...s.inTurnToolJobs, [job.id]: job } })),
  completeInTurnToolJob: (id) =>
    set((s) => {
      const existing = s.inTurnToolJobs[id];
      if (!existing) return {};
      return {
        inTurnToolJobs: {
          ...s.inTurnToolJobs,
          [id]: { ...existing, status: 'completed', completedAt: new Date().toISOString() },
        },
      };
    }),
  clearInTurnToolJobs: () => set({ inTurnToolJobs: {} }),

  queuedMessages: [],
  enqueueMessage: (text, mode) =>
    set((s) => ({
      queuedMessages: [
        ...s.queuedMessages,
        { id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text, mode },
      ],
    })),
  shiftQueuedMessage: () => {
    const [first, ...rest] = get().queuedMessages;
    if (!first) return null;
    set({ queuedMessages: rest });
    return first;
  },
  removeQueuedMessage: (id) =>
    set((s) => ({ queuedMessages: s.queuedMessages.filter((m) => m.id !== id) })),
  clearQueuedMessages: () => set({ queuedMessages: [] }),

  streamingSteps: [],
  stepsByEpisodeId: {},
  setStreamingSteps: (streamingSteps) => set({ streamingSteps }),
  attachStepsToEpisode: (episodeId) =>
    set((s) => {
      if (s.streamingSteps.length === 0 || !episodeId) {
        return { streamingSteps: [] };
      }
      return {
        streamingSteps: [],
        stepsByEpisodeId: {
          ...s.stepsByEpisodeId,
          [episodeId]: s.streamingSteps,
        },
      };
    }),
  clearAllSteps: () => set({ streamingSteps: [], stepsByEpisodeId: {} }),

  streamingNarration: [],
  streamingNarrationStartedAt: null,
  narrationByEpisodeId: {},
  beginNarration: () =>
    set({ streamingNarration: [], streamingNarrationStartedAt: Date.now() }),
  appendNarrationEntry: (entry) =>
    set((s) => {
      const next = appendNarrationEntryPure(s.streamingNarration, entry);
      if (next === s.streamingNarration) return {};
      return {
        streamingNarration: next,
        // Defensive: an entry arriving without a prior beginNarration
        // (e.g. a backend-initiated turn racing the `started` handler)
        // still gets a usable start anchor.
        streamingNarrationStartedAt: s.streamingNarrationStartedAt ?? Date.now(),
      };
    }),
  completeNarrationTool: (id) =>
    set((s) => {
      const next = completeNarrationToolPure(s.streamingNarration, id, Date.now());
      return next === s.streamingNarration ? {} : { streamingNarration: next };
    }),
  attachNarrationToEpisode: (episodeId) =>
    set((s) => {
      const cleared = {
        streamingNarration: [] as NarrationEntry[],
        streamingNarrationStartedAt: null,
      };
      if (
        !episodeId ||
        s.streamingNarrationStartedAt == null ||
        !isTrailWorthKeeping(s.streamingNarration)
      ) {
        return cleared;
      }
      return {
        ...cleared,
        narrationByEpisodeId: {
          ...s.narrationByEpisodeId,
          [episodeId]: {
            startedAt: s.streamingNarrationStartedAt,
            endedAt: Date.now(),
            entries: s.streamingNarration,
          },
        },
      };
    }),
  resetStreamingNarration: () =>
    set({ streamingNarration: [], streamingNarrationStartedAt: null }),
  clearAllNarration: () =>
    set({
      streamingNarration: [],
      streamingNarrationStartedAt: null,
      narrationByEpisodeId: {},
    }),

  activeWalkthrough: null,
  guidanceStepIndex: 0,
  guidancePlaying: false,
  guidanceHighlightTestId: null,
  orbGuideTarget: null,
  adHocWalkthrough: null,
  startGuidance: (topic) =>
    set({
      activeWalkthrough: topic,
      adHocWalkthrough: null,
      guidanceStepIndex: 0,
      guidancePlaying: true,
      guidanceHighlightTestId: null,
      orbGuideTarget: null,
      flashHighlightTestId: null,
      flashHighlightLabel: null,
    }),
  startAdHocGuidance: (walkthrough) =>
    set({
      activeWalkthrough: ADHOC_TOPIC,
      adHocWalkthrough: walkthrough,
      guidanceStepIndex: 0,
      guidancePlaying: true,
      guidanceHighlightTestId: null,
      orbGuideTarget: null,
      flashHighlightTestId: null,
      flashHighlightLabel: null,
    }),
  setGuidanceStep: (guidanceStepIndex) => set({ guidanceStepIndex }),
  advanceGuidance: () =>
    set((s) => ({ guidanceStepIndex: s.guidanceStepIndex + 1 })),
  previousGuidance: () =>
    set((s) => ({
      guidanceStepIndex: Math.max(0, s.guidanceStepIndex - 1),
      guidancePlaying: false,
    })),
  jumpToStep: (index) =>
    set({ guidanceStepIndex: Math.max(0, index), guidancePlaying: false }),
  pauseGuidance: () => set({ guidancePlaying: false }),
  resumeGuidance: () => set({ guidancePlaying: true }),
  stopGuidance: () =>
    set({
      activeWalkthrough: null,
      adHocWalkthrough: null,
      guidanceStepIndex: 0,
      guidancePlaying: false,
      guidanceHighlightTestId: null,
      orbGuideTarget: null,
    }),
  setGuidanceHighlightTestId: (guidanceHighlightTestId) =>
    set({ guidanceHighlightTestId }),
  setOrbGuideTarget: (orbGuideTarget) => set({ orbGuideTarget }),
  flashHighlightTestId: null,
  flashHighlightLabel: null,
  flashHighlight: (testId, opts) => {
    // A walkthrough owns the ring while it runs — don't fight it.
    if (get().activeWalkthrough) return;
    if (flashTimer) clearTimeout(flashTimer);
    set({ flashHighlightTestId: testId, flashHighlightLabel: opts?.label ?? null });
    flashTimer = setTimeout(() => {
      flashTimer = null;
      // Only clear if this flash is still the active one (a newer flash wins).
      if (get().flashHighlightTestId === testId) {
        set({ flashHighlightTestId: null, flashHighlightLabel: null });
      }
    }, opts?.ms ?? 2400);
  },

  pendingDecision: null,
  decisionExplained: false,
  setPendingDecision: (decision) =>
    set({ pendingDecision: decision, decisionExplained: false, explainComposeError: null }),
  clearPendingDecision: () =>
    set({ pendingDecision: null, decisionExplained: false, explainComposeError: null }),
  markDecisionExplained: () =>
    set((s) => (s.pendingDecision ? { decisionExplained: true } : s)),

  explainComposing: false,
  explainComposeError: null,
  setExplainComposing: (explainComposing) => set({ explainComposing }),
  setExplainComposeError: (explainComposeError) => set({ explainComposeError }),

  fleetAutoNotice: null,
  setFleetAutoNotice: (fleetAutoNotice) => set({ fleetAutoNotice }),
  clearFleetAutoNotice: () => set({ fleetAutoNotice: null }),
}));
