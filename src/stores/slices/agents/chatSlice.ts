import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { ChatMessage } from "@/lib/bindings/ChatMessage";
import type { ChatSession } from "@/lib/bindings/ChatSession";
import type { ChatSessionContext } from "@/lib/bindings/ChatSessionContext";
import {
  listChatSessions,
  getChatMessages,
  createChatMessage,
  deleteChatSession,
  saveChatSessionContext,
  getChatSessionContext,
} from "@/api/agents/chat";
import { executePersona, getExecution } from "@/api/agents/executions";
import type { Continuation } from "@/lib/bindings/Continuation";

/** Active chat execution listener cleanup functions */
let chatExecCleanup: (() => void) | null = null;

export type ChatMode = 'ops' | 'agent';

export interface ChatSlice {
  // State
  chatSessions: ChatSession[];
  chatMessages: ChatMessage[];
  activeChatSessionId: string | null;
  chatStreaming: boolean;
  chatMode: ChatMode;
  chatSessionContext: ChatSessionContext | null;

  // Actions
  setChatMode: (mode: ChatMode) => void;
  fetchChatSessions: (personaId: string) => Promise<void>;
  fetchChatMessages: (personaId: string, sessionId: string) => Promise<void>;
  startNewChatSession: (personaId: string) => Promise<string>;
  sendChatMessage: (personaId: string, sessionId: string, content: string) => Promise<void>;
  clearChatSession: (personaId: string, sessionId: string) => Promise<void>;
  appendChatStreamLine: (line: string) => void;
  finishChatStream: (fullResponse: string, personaId: string, sessionId: string, executionId?: string) => Promise<void>;
  restoreChatSession: (personaId: string) => Promise<void>;
}

/** Maximum in-memory chat messages per session. Older messages are evicted FIFO. */
const MAX_CHAT_MESSAGES = 500;

/** Derive a short title from the first user message content. */
function deriveTitle(content: string): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (clean.length <= 60) return clean;
  return clean.slice(0, 57) + '...';
}

/** Build a condensed summary from recent messages (last ~20) for context restoration. */
function buildSummary(messages: ChatMessage[]): string {
  const recent = messages.slice(-20);
  return recent
    .map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content.slice(0, 300)}`)
    .join("\n\n");
}

export const createChatSlice: StateCreator<AgentStore, [], [], ChatSlice> = (set, get) => ({
  chatSessions: [],
  chatMessages: [],
  activeChatSessionId: null,
  chatStreaming: false,
  chatMode: 'ops' as ChatMode,
  chatSessionContext: null,

  setChatMode: (mode) => {
    set({ chatMode: mode });
    // Persist mode change to session context if we have an active session
    const { activeChatSessionId, chatSessionContext } = get();
    if (activeChatSessionId && chatSessionContext) {
      saveChatSessionContext({
        sessionId: activeChatSessionId,
        personaId: chatSessionContext.personaId,
        chatMode: mode,
      }).catch(() => {/* best-effort */});
    }
  },

  fetchChatSessions: async (personaId) => {
    try {
      const sessions = await listChatSessions(personaId);
      const activeId = get().activeChatSessionId;
      // Clear the active session if it no longer exists in the persisted list
      const activeGone =
        activeId && sessions.length > 0 && !sessions.some((s) => s.sessionId === activeId);
      set({
        chatSessions: sessions,
        ...(activeGone ? { activeChatSessionId: null, chatMessages: [], chatSessionContext: null } : {}),
      });
    } catch (err) {
      reportError(err, "Failed to fetch chat sessions", set);
    }
  },

  fetchChatMessages: async (personaId, sessionId) => {
    try {
      const messages = await getChatMessages(personaId, sessionId);
      // Cap in-memory messages to prevent unbounded growth in long sessions
      set({ chatMessages: messages.slice(-MAX_CHAT_MESSAGES), activeChatSessionId: sessionId });
      // Touch session context to update last-accessed timestamp
      saveChatSessionContext({
        sessionId,
        personaId,
        chatMode: get().chatMode,
      }).then((ctx) => set({ chatSessionContext: ctx })).catch(() => {/* best-effort */});
    } catch (err) {
      reportError(err, "Failed to fetch chat messages", set);
    }
  },

  startNewChatSession: async (_personaId) => {
    // Sessions are derived from chat_messages grouped by session_id —
    // no backend call needed. The session materialises when the first message is sent.
    const sessionId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set({ activeChatSessionId: sessionId, chatMessages: [], chatSessionContext: null });
    return sessionId;
  },

  sendChatMessage: async (personaId, sessionId, content) => {
    // 1. Persist user message
    const userMsg = await createChatMessage({
      personaId,
      sessionId,
      role: "user",
      content,
    });
    set((s) => ({ chatMessages: [...s.chatMessages, userMsg].slice(-MAX_CHAT_MESSAGES) }));

    // 2. Save/update session context (title from first message, mode, summary)
    const allMessages = get().chatMessages;
    const isFirstMessage = allMessages.length === 1;
    saveChatSessionContext({
      sessionId,
      personaId,
      chatMode: get().chatMode,
      ...(isFirstMessage ? { title: deriveTitle(content) } : {}),
      summary: buildSummary(allMessages),
    }).then((ctx) => set({ chatSessionContext: ctx })).catch(() => {/* best-effort */});

    // 3. Determine if we can --resume an existing Claude session
    const claudeSessionId = get().chatSessionContext?.claudeSessionId;
    const isOps = get().chatMode === 'ops';

    let conversationInput: string;
    let continuation: Continuation | undefined;

    if (claudeSessionId && !isFirstMessage) {
      // Follow-up message: use --resume to continue the Claude session natively.
      // Only send the new message as input — Claude already has full context.
      conversationInput = JSON.stringify({
        ...(isOps ? { _ops: true } : { _chat: true }),
        latest_message: content,
      });
      continuation = { type: "SessionResume", value: claudeSessionId };
    } else {
      // First message or no session ID yet: send full conversation context
      const contextLines = allMessages.map(
        (m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`,
      );
      contextLines.push(`Human: ${content}`);
      conversationInput = JSON.stringify({
        ...(isOps ? { _ops: true } : { _chat: true }),
        conversation: contextLines.join("\n\n"),
        latest_message: content,
      });
    }

    // 4. Start execution — set executionPersonaId so useExecutionStream can match output
    set({ chatStreaming: true, executionPersonaId: personaId, executionOutput: [], isExecuting: true });
    try {
      const exec = await executePersona(personaId, undefined, conversationInput, undefined, continuation, crypto.randomUUID());
      if (exec?.id) {
        set({ activeExecutionId: exec.id });
        // Register Tauri event listeners for this execution's output + status.
        // These are needed because the Chat tab doesn't mount usePersonaExecution.
        setupChatExecListeners(exec.id, personaId, sessionId, set, get);
      }
    } catch (err) {
      reportError(err, "Failed to send chat message", set, { stateUpdates: { chatStreaming: false, isExecuting: false } });
    }
  },

  clearChatSession: async (personaId, sessionId) => {
    try {
      await deleteChatSession(personaId, sessionId);
      set((s) => ({
        chatSessions: s.chatSessions.filter((cs) => cs.sessionId !== sessionId),
        chatMessages: s.activeChatSessionId === sessionId ? [] : s.chatMessages,
        activeChatSessionId: s.activeChatSessionId === sessionId ? null : s.activeChatSessionId,
        chatSessionContext: s.activeChatSessionId === sessionId ? null : s.chatSessionContext,
      }));
    } catch (err) {
      reportError(err, "Failed to clear chat session", set);
    }
  },

  appendChatStreamLine: (_line) => {
    // Streaming lines are accumulated and displayed in real-time via executionOutput
    // This is a no-op; the ChatTab reads executionOutput directly from the store
  },

  finishChatStream: async (fullResponse, personaId, sessionId, executionId) => {
    if (!fullResponse.trim()) {
      set({ chatStreaming: false });
      return;
    }
    try {
      const assistantMsg = await createChatMessage({
        personaId,
        sessionId,
        role: "assistant",
        content: fullResponse,
        executionId,
      });
      set((s) => ({
        chatMessages: [...s.chatMessages, assistantMsg].slice(-MAX_CHAT_MESSAGES),
        chatStreaming: false,
      }));

      // Capture claude_session_id from the execution for --resume on next message
      let capturedClaudeSessionId: string | null = null;
      if (executionId) {
        try {
          const exec = await getExecution(executionId, personaId);
          if (exec.claude_session_id) {
            capturedClaudeSessionId = exec.claude_session_id;
          }
        } catch {
          // Non-critical — fall back to full-context mode on next message
        }
      }

      // Update session context with latest summary and claude_session_id
      const updatedMessages = get().chatMessages;
      saveChatSessionContext({
        sessionId,
        personaId,
        summary: buildSummary(updatedMessages),
        ...(capturedClaudeSessionId ? { claudeSessionId: capturedClaudeSessionId } : {}),
      }).then((ctx) => set({ chatSessionContext: ctx })).catch(() => {/* best-effort */});

      // Ops mode: extract and dispatch operations from assistant output
      if (get().chatMode === 'ops') {
        const { extractOperations, dispatchOperations, formatResults } = await import(
          "@/features/agents/sub_chat/libs/chatOpsDispatch"
        );
        const ops = extractOperations(fullResponse);
        if (ops.length > 0) {
          const results = await dispatchOperations(ops, personaId);
          const resultText = formatResults(results);
          if (resultText) {
            const resultMsg = await createChatMessage({
              personaId,
              sessionId,
              role: "assistant",
              content: resultText,
            });
            set((s) => ({
              chatMessages: [...s.chatMessages, resultMsg].slice(-MAX_CHAT_MESSAGES),
            }));
          }
        }
      }
    } catch {
      set({ chatStreaming: false });
    }
  },

  restoreChatSession: async (personaId) => {
    try {
      const { activeChatSessionId } = get();

      // Fetch sessions once — reused for both validation and latest-session lookup
      const sessions = await listChatSessions(personaId);
      set({ chatSessions: sessions });

      if (activeChatSessionId) {
        // Validate the persisted session still exists and load its messages
        const stillExists = sessions.some((s) => s.sessionId === activeChatSessionId);
        if (stillExists) {
          const messages = await getChatMessages(personaId, activeChatSessionId);
          set({ chatMessages: messages.slice(-MAX_CHAT_MESSAGES) });
          return;
        }
        // Session was deleted externally - fall through to find latest
      }

      // Derive the latest session from the already-fetched list instead of a second query
      if (sessions.length > 0) {
        const latest = sessions.reduce((a, b) =>
          a.lastMessageAt > b.lastMessageAt ? a : b,
        );
        const [messages, latestCtx] = await Promise.all([
          getChatMessages(personaId, latest.sessionId),
          getChatSessionContext(latest.sessionId),
        ]);
        set({
          activeChatSessionId: latest.sessionId,
          chatMessages: messages.slice(-MAX_CHAT_MESSAGES),
          chatSessionContext: latestCtx,
          chatMode: (latestCtx?.chatMode === 'agent' ? 'agent' : 'ops') as ChatMode,
        });
      }
    } catch {
      // Silent failure - user can still start a new session
    }
  },
});

// ---------------------------------------------------------------------------
// Chat execution event listeners — registered per-execution in sendChatMessage
// ---------------------------------------------------------------------------

type SetFn = (partial: Partial<AgentStore> | ((s: AgentStore) => Partial<AgentStore>)) => void;
type GetFn = () => AgentStore;

function setupChatExecListeners(
  executionId: string,
  personaId: string,
  sessionId: string,
  set: SetFn,
  get: GetFn,
) {
  // Clean up any previous listeners
  chatExecCleanup?.();
  chatExecCleanup = null;

  let unlistenOutput: (() => void) | null = null;
  let unlistenStatus: (() => void) | null = null;
  let finalized = false;

  const cleanup = () => {
    unlistenOutput?.();
    unlistenStatus?.();
    unlistenOutput = null;
    unlistenStatus = null;
  };

  (async () => {
    // Dynamic imports to avoid breaking store initialization
    const { listen } = await import("@tauri-apps/api/event");
    const { EventName } = await import("@/lib/eventRegistry");
    const { isTerminalState } = await import("@/lib/execution/executionState");
    const { classifyLine } = await import("@/lib/utils/terminalColors");

    unlistenOutput = await listen<{ execution_id: string; line: string }>(
      EventName.EXECUTION_OUTPUT,
      (event) => {
        if (event.payload.execution_id !== executionId || finalized) return;
        get().appendExecutionOutput(event.payload.line);
      },
    );
    unlistenStatus = await listen<{ execution_id: string; status: string }>(
      EventName.EXECUTION_STATUS,
      (event) => {
        if (event.payload.execution_id !== executionId || finalized) return;
        if (!isTerminalState(event.payload.status)) return;
        finalized = true;
        const output = get().executionOutput;
        const textLines = output.filter((l) => classifyLine(l) === 'text');
        const fullResponse = textLines.join('\n').trim();
        void get().finishChatStream(fullResponse, personaId, sessionId, executionId);
        set({ isExecuting: false, activeExecutionId: null, executionPersonaId: null });
        cleanup();
        chatExecCleanup = null;
      },
    );
  })();

  chatExecCleanup = cleanup;
}
