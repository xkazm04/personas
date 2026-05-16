import { create } from 'zustand';
import type { CompanionState } from './types';
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
  setSendError: (sendError) => set({ sendError }),

  approvals: [],
  setApprovals: (approvals) => set({ approvals }),
  removeApproval: (id) =>
    set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) })),

  quickReplies: [],
  setQuickReplies: (quickReplies) => set({ quickReplies }),

  chatCards: [],
  setChatCards: (chatCards) => set({ chatCards }),

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

  pendingPrompt: null,
  setPendingPrompt: (pendingPrompt: PendingPromptPayload | null) => set({ pendingPrompt }),
  consumePendingPrompt: (): PendingPromptPayload | null => {
    const prompt = get().pendingPrompt;
    if (prompt !== null) set({ pendingPrompt: null });
    return prompt;
  },

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
}));
