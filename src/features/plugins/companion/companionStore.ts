import { create } from 'zustand';
import type { CompanionState } from './types';
import type { BrainKind, PendingApproval } from '@/api/companion';

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

export interface CompanionMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
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

  // Brain Viewer state
  brainView: BrainViewState;
  setBrainView: (next: BrainViewState) => void;

  // Phase 4: self-improve loop state
  betaSelfImprove: boolean;
  setBetaSelfImprove: (v: boolean) => void;
  improving: boolean;
  setImproving: (v: boolean) => void;

  // Phase 4.5: voice playback
  pendingPlayback: PendingPlayback | null;
  setPendingPlayback: (p: PendingPlayback | null) => void;
  /** Cache the synthesized audio URL onto the active playback record. */
  setPlaybackAudioUrl: (audioUrl: string) => void;
  /** Mark the active playback as already heard (footer Play hides itself). */
  markPlaybackPlayed: () => void;
}

export const useCompanionStore = create<CompanionStore>((set) => ({
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

  brainView: { open: false, kind: null, id: null },
  setBrainView: (brainView) => set({ brainView }),

  betaSelfImprove: false,
  setBetaSelfImprove: (betaSelfImprove) => set({ betaSelfImprove }),
  improving: false,
  setImproving: (improving) => set({ improving }),

  pendingPlayback: null,
  setPendingPlayback: (pendingPlayback) => set({ pendingPlayback }),
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
}));
