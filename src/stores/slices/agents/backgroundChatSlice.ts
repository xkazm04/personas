/**
 * Background chat slice — runs Lab-style chat sessions without occupying
 * the foreground ChatTab state. Used by the "respond with feedback" flow on
 * persona messages: the user submits feedback on a message, a new advisory
 * chat session is started against that message's persona, and the execution
 * runs in the background with live-tracking in the ProcessActivityDrawer.
 *
 * Isolation goal: the user's currently-open Lab chat must NOT be clobbered
 * when they submit feedback on a message. Each background chat is keyed by
 * a feedbackId and lives in its own state slot. When the user later opens
 * the chat (via ProcessActivityDrawer row or TitleBar notification), the
 * background entry is "adopted" — promoted into the main chatSlice so the
 * user can continue the conversation natively.
 *
 * The turn itself is the desktop's ONE chat turn (`start_chat_turn` ->
 * `chat_turn::start` in Rust, the same path as the foreground chat and a
 * paired phone's `chat_send`): it inserts the user row, saves the session
 * context (named after the report through `title`), builds the advisory input,
 * starts the run and writes the assistant row when the run completes - also
 * when this webview has reloaded in between. This slice
 * only drives the display: the slot's status, the reply preview, the
 * activity row and the notifications.
 */
import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { startChatTurn } from "@/api/agents/chat";
import { sendAppNotification } from "@/api/system/system";
import { useNotificationCenterStore } from "@/stores/notificationCenterStore";
import { createLogger } from "@/lib/log";
import { silentCatch } from '@/lib/silentCatch';


const logger = createLogger("background-chat");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackgroundChatStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "adopted";

export interface BackgroundChatState {
  feedbackId: string;
  personaId: string;
  personaName?: string;
  sessionId: string;
  executionId?: string;
  sourceMessageId: string;
  instructionPreview: string;
  status: BackgroundChatStatus;
  startedAt: number;
  completedAt?: number;
  assistantReplyPreview?: string;
  errorMessage?: string;
}

export interface StartFeedbackChatOpts {
  personaId: string;
  personaName?: string;
  sourceMessageId: string;
  instruction: string;
  title: string;
}

export interface BackgroundChatSlice {
  backgroundChats: Record<string, BackgroundChatState>;

  startFeedbackChat: (opts: StartFeedbackChatOpts) => Promise<string>;
  abortFeedbackChat: (feedbackId: string) => void;
  adoptBackgroundChat: (feedbackId: string) => { personaId: string; sessionId: string } | null;
  clearBackgroundChat: (feedbackId: string) => void;
}

// ---------------------------------------------------------------------------
// Active listener cleanup tracking (per feedbackId)
// ---------------------------------------------------------------------------

const activeCleanups: Map<string, () => void> = new Map();

function registerCleanup(feedbackId: string, cleanup: () => void) {
  activeCleanups.get(feedbackId)?.();
  activeCleanups.set(feedbackId, cleanup);
}

function releaseCleanup(feedbackId: string) {
  const fn = activeCleanups.get(feedbackId);
  if (fn) {
    fn();
    activeCleanups.delete(feedbackId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newFeedbackId(): string {
  return `fb-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function newSessionId(): string {
  return `bgchat-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Short preview for UI — first ~120 chars of the instruction, single line. */
function shortPreview(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "\u2026" : clean;
}

/** First meaningful line of an assistant response, for notification bodies. */
function firstLine(text: string, max = 160): string {
  const trimmed = text.trim();
  const nl = trimmed.indexOf("\n");
  const line = nl > 0 ? trimmed.slice(0, nl) : trimmed;
  return line.length > max ? line.slice(0, max - 1) + "\u2026" : line;
}

/**
 * OS notifications fire only when the app window is not focused. The
 * in-app TitleBar bell entry always fires — that's the persistent record
 * the user can come back to.
 */
async function sendOsNotificationIfNotFocused(title: string, body: string): Promise<void> {
  try {
    const { IS_DESKTOP } = await import("@/lib/utils/platform/platform");
    if (!IS_DESKTOP) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const focused = await win.isFocused().catch((err) => {
      silentCatch("stores/slices/agents/backgroundChatSlice:catch6")(err);
      return true;
    });
    if (focused) return;
    await sendAppNotification(title, body).catch(silentCatch("stores/slices/agents/backgroundChatSlice:catch7"));
  } catch (err) { silentCatch("stores/slices/agents/backgroundChatSlice:catch1")(err); }
}

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

export const createBackgroundChatSlice: StateCreator<
  AgentStore,
  [],
  [],
  BackgroundChatSlice
> = (set, get) => ({
  backgroundChats: {},

  startFeedbackChat: async ({ personaId, personaName, sourceMessageId, instruction, title }) => {
    const feedbackId = newFeedbackId();
    const sessionId = newSessionId();
    const startedAt = Date.now();

    // Seed the slice state
    set((s) => ({
      backgroundChats: {
        ...s.backgroundChats,
        [feedbackId]: {
          feedbackId,
          personaId,
          personaName,
          sessionId,
          sourceMessageId,
          instructionPreview: shortPreview(instruction),
          status: "starting" as BackgroundChatStatus,
          startedAt,
        },
      },
    }));

    // Register a process-activity row so the user sees progress in the drawer.
    // ProcessActivitySlice lives on overviewStore, not agentStore.
    try {
      const { useOverviewStore } = await import("@/stores/overviewStore");
      useOverviewStore.getState().processStarted(
        "feedback-chat",
        feedbackId,
        title,
        {
          section: "personas",
          tab: "chat",
          personaId,
          chatSessionId: sessionId,
        },
      );
    } catch (err) { silentCatch("stores/slices/agents/backgroundChatSlice:catch2")(err); }

    try {
      // The whole turn, in Rust: the user row (discoverable via
      // listChatSessions once adopted), the session context in advisory mode
      // and named after the report, the `_advisory` first-turn input (on
      // follow-up turns after adoption chatSlice resumes the Claude session),
      // the run, and the assistant row when it completes.
      const turn = await startChatTurn({
        personaId,
        sessionId,
        message: instruction,
        chatMode: "advisory",
        title,
      });
      const executionId = turn.executionId;
      if (!executionId) {
        throw new Error("start_chat_turn did not return an execution id");
      }

      set((s) => {
        const cur = s.backgroundChats[feedbackId];
        if (!cur) return s;
        return {
          backgroundChats: {
            ...s.backgroundChats,
            [feedbackId]: { ...cur, status: "running", executionId },
          },
        };
      });

      // 5. Install isolated per-execution listeners writing into this
      //    background slot, NOT global chatSlice state.
      setupBackgroundExecListeners(feedbackId, personaId, sessionId, executionId, set, get);

      return feedbackId;
    } catch (err) {
      logger.error("Failed to start feedback chat", { feedbackId, error: err });
      set((s) => {
        const cur = s.backgroundChats[feedbackId];
        if (!cur) return s;
        return {
          backgroundChats: {
            ...s.backgroundChats,
            [feedbackId]: {
              ...cur,
              status: "failed",
              completedAt: Date.now(),
              errorMessage: err instanceof Error ? err.message : "Failed to start feedback chat",
            },
          },
        };
      });

      try {
        const { useOverviewStore } = await import("@/stores/overviewStore");
        useOverviewStore.getState().processEnded("feedback-chat", "failed", feedbackId);
      } catch (err) { silentCatch("stores/slices/agents/backgroundChatSlice:catch3")(err); }

      reportError(err, "Failed to start feedback chat", set);
      return feedbackId;
    }
  },

  abortFeedbackChat: (feedbackId) => {
    releaseCleanup(feedbackId);
    set((s) => {
      const cur = s.backgroundChats[feedbackId];
      if (!cur) return s;
      return {
        backgroundChats: {
          ...s.backgroundChats,
          [feedbackId]: { ...cur, status: "failed", completedAt: Date.now(), errorMessage: "Cancelled" },
        },
      };
    });
    void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
      useOverviewStore.getState().processEnded("feedback-chat", "cancelled", feedbackId);
    });
  },

  /**
   * Promote a background chat into a regular (foreground) chat session. The
   * caller should then call restoreChatSession(personaId, sessionId) to load
   * it into the main chatSlice. Returns null if the feedbackId is unknown.
   */
  adoptBackgroundChat: (feedbackId) => {
    const cur = get().backgroundChats[feedbackId];
    if (!cur) return null;
    // Mark as adopted so it's no longer shown in "pending background" lists.
    set((s) => ({
      backgroundChats: {
        ...s.backgroundChats,
        [feedbackId]: { ...s.backgroundChats[feedbackId]!, status: "adopted" },
      },
    }));
    return { personaId: cur.personaId, sessionId: cur.sessionId };
  },

  clearBackgroundChat: (feedbackId) => {
    releaseCleanup(feedbackId);
    set((s) => {
      const { [feedbackId]: _removed, ...rest } = s.backgroundChats;
      return { backgroundChats: rest };
    });
  },
});

// ---------------------------------------------------------------------------
// Per-execution event listeners (isolated from the foreground chatSlice)
// ---------------------------------------------------------------------------

type SetFn = (partial: Partial<AgentStore> | ((s: AgentStore) => Partial<AgentStore>)) => void;
type GetFn = () => AgentStore;

/**
 * Installs listeners that accumulate output for a background chat execution
 * and finalize it when the execution reaches a terminal state. Does NOT touch
 * global chat state (chatStreaming, executionOutput, activeExecutionId, etc.).
 */
function setupBackgroundExecListeners(
  feedbackId: string,
  personaId: string,
  sessionId: string,
  executionId: string,
  set: SetFn,
  get: GetFn,
) {
  let unlistenOutput: (() => void) | null = null;
  let unlistenStatus: (() => void) | null = null;
  let finalized = false;
  const outputLines: string[] = [];

  const cleanup = () => {
    unlistenOutput?.();
    unlistenStatus?.();
    unlistenOutput = null;
    unlistenStatus = null;
  };

  registerCleanup(feedbackId, cleanup);

  (async () => {
   try {
    const { listen } = await import("@tauri-apps/api/event");
    const { EventName } = await import("@/lib/eventRegistry");
    const { isTerminalState, parseExecutionState } = await import("@/lib/execution/executionState");
    const { classifyLine } = await import("@/lib/utils/terminalColors");

    unlistenOutput = await listen<{ execution_id: string; line: string }>(
      EventName.EXECUTION_OUTPUT,
      (event) => {
        if (event.payload.execution_id !== executionId || finalized) return;
        outputLines.push(event.payload.line);
      },
    );

    unlistenStatus = await listen<{ execution_id: string; status: string }>(
      EventName.EXECUTION_STATUS,
      async (event) => {
        if (event.payload.execution_id !== executionId || finalized) return;
        if (!isTerminalState(event.payload.status)) return;
        finalized = true;

        const textLines = outputLines.filter((l) => classifyLine(l) === "text");
        const fullResponse = textLines.join("\n").trim();
        const terminalStatus = event.payload.status;
        const succeeded = parseExecutionState(terminalStatus) === "completed" && fullResponse.length > 0;

        // The reply row is not written here: the Rust turn's completion
        // hook writes it from the execution's output, so a reload of this
        // webview cannot lose it. The streamed lines only feed the preview
        // and the notification.

        // Update slice state
        set((s) => {
          const cur = s.backgroundChats[feedbackId];
          if (!cur) return s;
          return {
            backgroundChats: {
              ...s.backgroundChats,
              [feedbackId]: {
                ...cur,
                status: succeeded ? "completed" : "failed",
                completedAt: Date.now(),
                assistantReplyPreview: succeeded ? firstLine(fullResponse) : undefined,
                errorMessage: succeeded ? undefined : `Execution ended: ${terminalStatus}`,
              },
            },
          };
        });

        // Update the process-activity row.
        try {
          const { useOverviewStore } = await import("@/stores/overviewStore");
          useOverviewStore.getState().processEnded(
            "feedback-chat",
            succeeded ? "completed" : "failed",
            feedbackId,
          );
        } catch (err) { silentCatch("stores/slices/agents/backgroundChatSlice:catch5")(err); }

        // Fire notifications — OS only if app unfocused, bell always.
        const cur = get().backgroundChats[feedbackId];
        const personaName = cur?.personaName ?? "Agent";
        if (succeeded) {
          const title = `${personaName} replied to your feedback`;
          const body = firstLine(fullResponse);
          void sendOsNotificationIfNotFocused(title, body);
          useNotificationCenterStore.getState().addProcessNotification({
            processType: "feedback-chat",
            personaId,
            personaName,
            status: "success",
            title,
            summary: body,
            redirectSection: "personas",
            redirectTab: "chat",
            chatSessionId: sessionId,
          });
        } else {
          const title = `Feedback chat failed`;
          const body = cur?.errorMessage ?? `Execution ended: ${terminalStatus}`;
          void sendOsNotificationIfNotFocused(title, body);
          useNotificationCenterStore.getState().addProcessNotification({
            processType: "feedback-chat",
            personaId,
            personaName,
            status: "failed",
            title,
            summary: body,
            redirectSection: "personas",
            redirectTab: "chat",
            chatSessionId: sessionId,
          });
        }

        releaseCleanup(feedbackId);
      },
    );
   } catch (err) {
    // Listener-setup failure: record as failed so the chat row resolves and
    // the activeCleanups entry doesn't leak. Without this, the slice stays in
    // "starting"/"running" forever and the Map grows by one closure per call.
    logger.error("Failed to install background chat listeners", { feedbackId, executionId, error: err });
    if (!finalized) {
      finalized = true;
      set((s) => {
        const cur = s.backgroundChats[feedbackId];
        if (!cur) return s;
        return {
          backgroundChats: {
            ...s.backgroundChats,
            [feedbackId]: {
              ...cur,
              status: "failed",
              completedAt: Date.now(),
              errorMessage: err instanceof Error ? err.message : "Listener setup failed",
            },
          },
        };
      });
    }
    releaseCleanup(feedbackId);
   }
  })();
}
