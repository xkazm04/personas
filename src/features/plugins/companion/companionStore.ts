import { create } from 'zustand';
import type { CompanionState } from './types';

export interface CompanionMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
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
}));
