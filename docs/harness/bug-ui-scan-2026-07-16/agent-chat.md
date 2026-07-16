# Agent Chat — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Thread switch mid-turn misattributes messages in the UI and persists a cross-session summary
- **Severity**: High
- **Category**: bug
- **File**: src/stores/slices/agents/chatSlice.ts:192 (also 195-203, 328-331, 345-351)
- **Scenario**: User sends a message in session A, then switches to session B (thread list click, or MonitorDrawer/NotificationCenter `restoreChatSession`, which are not gated on `chatStreaming`) while the turn is in flight. Two windows exist: (a) during the `await createChatMessage` at line 186, and (b) during the whole stream until `finishChatStream` resolves.
- **Root cause**: The slice pins `streamingChatSessionId` so *persistence* targets the right session, but every in-memory append uses the unguarded current list: `set((s) => ({ chatMessages: [...s.chatMessages, userMsg] }))` (line 192) and the identical append of `assistantMsg` in `finishChatStream` (line 328) never check `activeChatSessionId === sessionId`. Worse, `buildSummary(get().chatMessages)` (lines 195-203 and 345-351) then serializes session B's visible messages (plus the misappended A reply) and saves it as session **A**'s `summary` via `saveChatSessionContext` — persistent cross-session contamination that survives restart and is what a fresh (non-resume) turn sends as conversation context.
- **Impact**: Session A's reply appears inside session B's thread; session A's stored summary permanently contains session B's conversation; `isFirstMessage` (line 196) is computed against the wrong list, so title derivation and the resume-vs-full-context branch can misfire.
- **Fix sketch**: In both appends, only mutate `chatMessages` when `s.activeChatSessionId === sessionId`; build the summary from messages fetched/known for `sessionId` (e.g. capture the pre-send list plus the new rows) instead of `get().chatMessages`.

## 2. Aborting a feedback chat is success theater — the backend execution keeps running
- **Severity**: Medium
- **Category**: bug
- **File**: src/stores/slices/agents/backgroundChatSlice.ts:275-290
- **Scenario**: User starts a "respond with feedback" background chat, then cancels it from the ProcessActivityDrawer while the persona execution is mid-flight.
- **Root cause**: `abortFeedbackChat` only calls `releaseCleanup` (unhooks the Tauri listeners) and flips slice status to `failed/"Cancelled"`. It never calls the cancel-execution command, unlike real cancellation paths. The spawned Claude CLI process continues to completion.
- **Impact**: Tokens/CPU burn for minutes after the user "cancelled"; because the status listener was removed, the completed reply is never persisted, never notified, and the execution row ends `completed` while the drawer says cancelled — contradictory records. If the user re-submits feedback, two executions run concurrently.
- **Fix sketch**: Look up `executionId` in the slot and invoke the same cancel API the foreground path uses (`cancelExecution`/`stop_execution`) before releasing listeners; only then mark the slot cancelled.

## 3. Background chat has no watchdog — backend stream death leaves the row "running" forever
- **Severity**: Medium
- **Category**: bug
- **File**: src/stores/slices/agents/backgroundChatSlice.ts:331-498
- **Scenario**: A feedback chat is running and the sidecar/CLI process dies (crash, IPC drop) without ever emitting a terminal `EXECUTION_STATUS` event — exactly the failure mode the foreground chat's `CHAT_STREAM_WATCHDOG_MS` (chatSlice.ts:34, 515-529) was added to cover.
- **Root cause**: `setupBackgroundExecListeners` finalizes only from the status listener. There is no timeout fallback, so `finalized` stays false forever.
- **Impact**: The ProcessActivityDrawer row spins in "running" indefinitely, the bell notification never fires, the user message sits in the DB with no resolution, and the `activeCleanups` Map entry plus two live Tauri listeners leak for the life of the app (one pair per stuck chat).
- **Fix sketch**: Mirror the foreground watchdog: a `setTimeout(CHAT_STREAM_WATCHDOG_MS)` that, if not finalized, marks the slot failed ("no terminal status received"), ends the process-activity row, fires the failure notification, and releases the cleanup.

## 4. Long unbroken user input forces horizontal scrolling of the whole thread
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/agents/components/ChatThread.tsx:66
- **Scenario**: User pastes a long URL, JWT, or file path (any token wider than the pane) into the composer and sends it.
- **Root cause**: The user bubble is `whitespace-pre-wrap ... min-w-0` with no `break-words`/`overflow-wrap:anywhere`. `min-w-0` lets the flex item shrink, but an unbreakable token still overflows it, and the scroll container (line 32) is `overflow-y-auto`, which computes overflow-x to auto — so the overflow widens the entire thread.
- **Impact**: Every message in the conversation pans horizontally; on the mini-player's narrow width this is near-guaranteed for pasted links. Assistant markdown is mostly protected (code blocks have their own `overflow-x-auto`), making the asymmetry more visible.
- **Fix sketch**: Add `break-words` (or `[overflow-wrap:anywhere]`) to the user-message `<p>`; consider `overflow-x-hidden` on the thread container as a backstop.

## 5. Streamed replies, thinking state, and errors are invisible to screen readers
- **Severity**: Low
- **Category**: ui
- **File**: src/features/agents/components/ChatThread.tsx:32 (also 82-96, 100-109)
- **Scenario**: A screen-reader user sends a message. The thinking indicator appears, the assistant reply streams in, or the error card with its Retry button appears — none of it is announced; the user must manually re-scan the page to learn the turn finished or failed.
- **Root cause**: The message container is a plain `div` with no `role="log"`/`aria-live` region, the thinking row conveys state only via animated dots (`aria-hidden`) plus visual text, and the error banner is injected without a live region or focus move.
- **Impact**: Core chat feedback loop (pending → answer/error) is inaccessible; the Retry affordance is undiscoverable at the moment it matters.
- **Fix sketch**: Give the thread `role="log"` + `aria-live="polite"` (announcing completed messages, not per-token updates — e.g. announce on stream end), add `role="status"` to the thinking indicator, and render the error banner inside a `role="alert"` container.
