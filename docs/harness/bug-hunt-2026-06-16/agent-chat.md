# Bug Hunter — Agent Chat

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: agent-chat | Group: Persona & Agent Studio

## 1. Triple finalization path persists the assistant reply twice (duplicate message)
- **Severity**: Critical
- **Category**: Race condition / silent data corruption
- **File**: `src/stores/slices/agents/chatSlice.ts:256` (and `executionSlice.ts:435`, `executionSlice.ts:379`)
- **Scenario**: A chat message is sent (`chatStreaming = true`). The execution reaches a terminal state and fires one `EXECUTION_STATUS` event. That single event is observed by *both* the per-execution listener in `chatSlice` (`setupChatExecListeners`, line 427-440) and by `usePersonaExecution.handleStatusEvent` → `store.finishExecution` (`executionSlice.ts:393`) whenever any execution view is also mounted. Both branches independently see `chatStreaming === true` and call `finishChatStream(...)`. `cancelExecution` (line 376-380) is a third entry point.
- **Root cause**: `finishChatStream` has no idempotency guard. The `finalized` flag in `setupChatExecListeners` is closure-local and does not gate `finishExecution`'s copy of the logic. The only shared guard is the store flag `chatStreaming`, but it is flipped to `false` *after* an `await createChatMessage(...)` (line 262-272). Two callers entering before the first `await` resolves both read `chatStreaming === true` and both INSERT an `assistant` row.
- **Impact**: Duplicate assistant messages persisted to `chat_messages` and rendered (each with a fresh UUID, so React keys differ and both show). `claude_session_id` is captured/`upsert`ed twice; session summary written twice. Permanent DB corruption of the thread.
- **Fix sketch**: Add a re-entrancy guard inside `finishChatStream` itself: capture `if (!get().chatStreaming) return;` and synchronously `set({ chatStreaming: false })` as the *first* statement (before any await), so concurrent callers short-circuit. Optionally key the guard on `(sessionId, executionId)` to tolerate fast session switches.

## 2. Stale-closure session/persona binding finalizes a reply into the wrong (newly-switched) thread
- **Severity**: High
- **Category**: Race condition / lost & misattributed messages
- **File**: `src/stores/slices/agents/executionSlice.ts:431`
- **Scenario**: User sends a message in session A, then before A's stream completes switches to (or restores) session B. `restoreChatSession`/`startNewChatSession` overwrite `activeChatSessionId` and `chatMessages`. When A's terminal event lands, `finishExecution` reads `activeChatSessionId` *from the live store* (= B) and calls `finishChatStream(fullResponse_A, chatPersonaId, B, ...)`, persisting A's answer under session B.
- **Root cause**: The store-level finalizers (`finishExecution`, `cancelExecution`) re-read `activeChatSessionId`/`executionPersonaId` at finalize time instead of the values bound when the send started. The per-execution listener in `chatSlice` *does* close over the correct `sessionId`, but the `executionSlice` path does not, and there is no check that the terminal execution id still equals the session's owning execution.
- **Impact**: Answer appended to the wrong conversation; the originating session silently loses its reply (only the user turn survives), and B gets a non-sequitur assistant message. Also poisons B's summary/`claude_session_id`.
- **Fix sketch**: Bind `sessionId`+`personaId`+`executionId` at send time (the chatSlice listener already does). In `finishExecution`, only finalize chat if `get().activeExecutionId === <the execution that just terminated>` AND the session id matches the one recorded for that execution; otherwise defer to the per-execution listener exclusively.

## 3. Stream death mid-flight leaves chat wedged with no recovery
- **Severity**: High
- **Category**: Latent failure / recovery gap
- **File**: `src/stores/slices/agents/chatSlice.ts:427`
- **Scenario**: The execution process crashes, the backend never emits a terminal `EXECUTION_STATUS` (e.g. CLI killed, IPC dropped, app backgrounded then the event is missed), or the only output was non-`text`-classified lines. The status listener never runs, so `chatStreaming`/`isExecuting` stay `true` forever; the composer remains disabled and the thinking indicator spins indefinitely.
- **Root cause**: There is no timeout/heartbeat watchdog on the chat stream and no handling for "terminal arrived but `fullResponse` is empty" beyond `finishChatStream` early-returning with `set({ chatStreaming:false })` (line 257-260) — that path drops the user's turn with zero feedback (no error, no retry). A missed terminal event has *no* fallback at all.
- **Impact**: Permanently stuck "thinking" UI; user cannot send a follow-up. On empty/whitespace response the turn silently vanishes (success theater — no message, no error banner, `onRetry` never surfaced).
- **Fix sketch**: Add a watchdog timer armed in `sendChatMessage` that, after N seconds without a terminal event, resets `chatStreaming/isExecuting` and surfaces a retryable error. In `finishChatStream`, when `fullResponse` is empty, set an `error` (so `ChatThread`'s `InlineErrorBanner` + `onRetry` appear) instead of silently clearing.

## 4. `--resume` continuation can attach to a deleted/foreign Claude session (id mismatch)
- **Severity**: Medium
- **Category**: Edge case / session-id mismatch
- **File**: `src/stores/slices/agents/chatSlice.ts:182`
- **Scenario**: A follow-up message reads `chatSessionId.claudeSessionId` and sends `Continuation::SessionResume`. But `chatSessionContext` is updated asynchronously and best-effort (`.then(...).catch(() => {})`, lines 146, 179, 292). After `clearChatSession`/external deletion + re-fetch, or when context load failed silently, `chatSessionContext` may be stale or `null` while `isFirstMessage` is `false` (messages were restored). The code then either resumes a Claude session that no longer maps to this thread, or falls into the "first message" branch and re-injects the full `_advisory` prompt mid-conversation.
- **Root cause**: The resume decision depends on `chatSessionContext?.claudeSessionId` and a derived `isFirstMessage = allMessages.length === 1` heuristic, with no validation that the captured Claude session id still corresponds to the current `sessionId`/persona. Context fetch failures are swallowed.
- **Impact**: LLM restarts diagnostic analysis instead of continuing (wasted tokens, jarring reply), or resumes against an unrelated/expired CLI session producing irrelevant output.
- **Fix sketch**: Gate resume on a freshly-confirmed context (await `getChatSessionContext(sessionId)` if `chatSessionContext` is null/stale) and verify its `sessionId` matches before using `claudeSessionId`. On resume failure, fall back to full-context send rather than silently mis-routing.

## 5. User message content rendered without markdown sanitization parity (and DB strips HTML it then displays raw)
- **Severity**: Low
- **Category**: Edge case / markdown & injection
- **File**: `src/features/agents/components/ChatThread.tsx:66`
- **Scenario**: User-role messages are rendered with `{msg.content}` in a `whitespace-pre-wrap` `<p>` (safe, plain text), while the Rust `create` (`chat.rs:101`) runs `strip_html_tags` on *all* content including user turns. A user who types `a < b && c > d` or pasted code with angle-bracket "tags" has substrings silently deleted by `strip_html_tags` before persistence, so their own message is stored/redisplayed altered. Separately, assistant content goes through `ReactMarkdown` + `rehypeHighlight`; `makeStreamSafe` (`ChatMessageContent.tsx:28`) only balances *line-start* fences (`/^```/gm`), so an indented or inline ``` opener is miscounted and can flash raw/garbled markup mid-stream.
- **Root cause**: HTML-stripping is applied indiscriminately to user content that is never HTML-rendered, mutating legitimate text; and the stream-safe fence heuristic is anchored to line starts only.
- **Impact**: Silent data loss/alteration of user-entered text containing `<...>`-shaped substrings; transient broken rendering of partial code blocks during streaming.
- **Fix sketch**: Skip `strip_html_tags` for `role = user` content (it is rendered as plain text), or store raw and sanitize only at assistant-render time. Harden `makeStreamSafe` to count fences not anchored to line start and to tolerate leading whitespace.
