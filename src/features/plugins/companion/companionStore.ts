import { create } from 'zustand';
import type { CompanionState } from './types';
import type { StreamPhase } from './extractStreamPhase';
import type { TodoStep } from './operationalSteps';
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

  // Phase C2 — Athena-dispatched team assignments. Cards display inline
  // above the chat messages; each card is updated by the assignment
  // progress listener. Bounded to the 6 most-recent so the chat doesn't
  // get crowded by an old session's history.
  athenaAssignments: AthenaAssignmentRef[];
  upsertAthenaAssignment: (ref: AthenaAssignmentRef) => void;
  dismissAthenaAssignment: (assignmentId: string) => void;
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
      // Only `connector_use` jobs are surfaced as inline cards. Other
      // kinds (scan_codebase, curation_run) flow through their own
      // dedicated UIs and shouldn't squat on the chat transcript.
      if (
        job.kind === 'connector_use' &&
        !s.pendingConnectorJobIds.includes(job.id) &&
        // Don't re-pend a job that's already pinned to an episode (e.g.
        // the late `completed` event arriving after `finished` already
        // promoted the pending list).
        !Object.values(s.connectorJobIdsByEpisodeId).some((ids) =>
          ids.includes(job.id),
        )
      ) {
        next.pendingConnectorJobIds = [...s.pendingConnectorJobIds, job.id];
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
}));
