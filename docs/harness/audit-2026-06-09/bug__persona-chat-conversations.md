# Bug Hunter — persona-chat-conversations
> Total: 6
> Severity: 1 critical, 3 high, 2 medium

## 1. Stream listeners attach AFTER execution starts — fast/short executions lose all output and the chat hangs forever
- **Severity**: critical
- **Category**: race-condition
- **File**: src/stores/slices/agents/chatSlice.ts:213-218 (and :408-443); src/stores/slices/agents/backgroundChatSlice.ts:218-244 (and :353-372)
- **Scenario**: User sends a chat message. `executePersona` is `await`ed (a full IPC round-trip), and only *after* it resolves does `setupChatExecListeners` run, which then does *more* `await`s (`import("@tauri-apps/api/event")`, `import(eventRegistry)`, `import(executionState)`, `import(terminalColors)`) before finally calling `listen(EXECUTION_OUTPUT)` / `listen(EXECUTION_STATUS)`. The Rust side begins emitting `execution-output` and `execution-status` events the instant the process is spawned. For a cached/`--resume` turn, a refusal, or an immediate error, the terminal `execution-status` event can fire during this multi-`await` gap. The listener is registered too late, never sees it, `finalized` stays `false`, and `finishChatStream` is never called.
- **Root cause**: Listener registration is not established before the event source is armed. The design assumes events are durable/queued until a subscriber attaches, but Tauri `emit` is fire-and-forget — events emitted before `listen` resolves are dropped. There is no replay from the execution log or buffered-output fallback.
- **Impact**: UX degradation / apparent crash — `chatStreaming` and `isExecuting` stay `true` permanently, the composer stays disabled, the spinner spins forever, and the assistant reply (already produced) is never persisted into `chat_messages` (data loss of the turn). Same hang in the background feedback flow leaves the slot stuck in `running` and the process-activity row never resolves.
- **Fix sketch**: Make the subscribe-before-emit ordering impossible to get wrong: register the listeners (and pre-resolve the dynamic imports) *before* calling `executePersona`, filtering by the `clientRequestId`/idempotency key instead of the not-yet-known execution id; OR have the backend buffer per-execution output and replay it on first subscribe; OR after attaching listeners, reconcile by calling `getExecution(executionId)` once — if it is already terminal, synthesize the finalize path from the persisted log.

## 2. Terminal-status handler classifies ANY non-"fail" status as success — cancelled/timed-out turns are saved as real assistant replies
- **Severity**: high
- **Category**: silent-failure
- **File**: src/stores/slices/agents/backgroundChatSlice.ts:378; src/stores/slices/agents/chatSlice.ts:431-436
- **Scenario**: A feedback execution is cancelled, hits a budget/circuit-breaker cap, or times out but had already streamed partial text. The handler computes `succeeded = fullResponse.length > 0 && !terminalStatus.toLowerCase().includes("fail")`. Statuses like `cancelled`, `timeout`, `killed`, `error`, or `budget_exceeded` do not contain the substring "fail", so a partial/aborted output is persisted as a complete assistant message, a success notification is fired, and the session is marked `completed`. In the foreground slice it is even worse: `finishChatStream` is called for *every* terminal state with whatever text accumulated, with no success/failure distinction at all.
- **Root cause**: Success is inferred by substring-matching the status string instead of checking the canonical terminal-state taxonomy (`isTerminalState` already exists and could expose `isFailureState`/`isSuccessState`). Partial streamed text is treated as authoritative output.
- **Impact**: corruption / UX degradation — truncated or wrong answers stored as the persona's real reply, false "replied to your feedback" notifications, and `claude_session_id` captured from a broken turn so the *next* `--resume` continues from a corrupted context.
- **Fix sketch**: Replace the substring check with an explicit `isSuccessState(status)` from `executionState`. Only persist + capture `claude_session_id` on a genuine success terminal state; on cancel/timeout/error, mark failed and discard the partial buffer (or store it as an explicit error message, never as `role: "assistant"` success).

## 3. `claude_session_id` resume path keys on `isFirstMessage` from in-memory count — FIFO eviction silently downgrades long sessions to full-context resends
- **Severity**: high
- **Category**: state-corruption
- **File**: src/stores/slices/agents/chatSlice.ts:172, 188-208
- **Scenario**: In a long-lived session, `chatMessages` is capped at `MAX_CHAT_MESSAGES = 500` (FIFO eviction at :168, :270) and also re-sliced to the last 500 on restore (:140, :317, :342). `isFirstMessage` is computed as `allMessages.length === 1`. The resume branch requires `claudeSessionId && !isFirstMessage`. After a restore where the persisted context loads fine, this works — but consider a session whose `claude_session_id` was never captured (turn 1 failed to write it, see finding #2 / silent catch at :282) yet has many messages: every subsequent turn falls into the `else` branch and resends the *entire* `allMessages` transcript as `conversation`, re-injecting `_advisory: true` and causing the LLM to restart its analysis each turn. Conversely, if `claudeSessionId` is stale/expired on the CLI side, the resume is attempted blindly with no fallback to full context.
- **Root cause**: Two independent sources of truth for "should I resume" (presence of a captured CLI session id vs. an in-memory message count) that can disagree after eviction/restore/partial-failure, with no validation that the resume target still exists.
- **Impact**: UX degradation / cost blowup — silent re-analysis loops, token cost spikes (full transcript every turn), or a resume against a dead CLI session that errors out (then hits finding #1's hang).
- **Fix sketch**: Derive resume-vs-fresh solely from the persisted `chatSessionContext.claudeSessionId` (not message count). On a `SessionResume` failure, detect the "no such session" error and automatically retry once with full-context mode, then re-capture the new id.

## 4. Design-conversation full-overwrite append (`append_message`) is a lost-update race against the O(1) `append_single_message`
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/commands/design/conversations.rs:50-59; src-tauri/src/db/repos/core/design_conversations.rs:79-102
- **Scenario**: `append_message` does a blind `UPDATE ... SET messages = ?2` with a client-supplied full array — it overwrites whatever is in the DB. The newer `append_single_message` path (used by `useDesignConversation.enqueueAppend`) serializes appends via a JS promise chain *within one hook instance*, but that serialization is purely client-side and per-component. If two surfaces touch the same conversation (e.g. the design panel using `append_single_message` while any caller of the still-exported `append_message`/`appendDesignConversationMessage` writes a stale snapshot), the full-array writer clobbers all messages appended since it read. The client-side queue gives a false sense of safety; the DB has no row-version/optimistic-concurrency guard.
- **Root cause**: Two append strategies (read-modify-write of the entire JSON blob vs. server-side `json_insert`) coexist on the same column with no DB-level concurrency control. The promise-chain mitigation lives in one React hook and does not span tabs, components, or the legacy command.
- **Impact**: data loss — silently dropped conversation turns (user answers / AI questions) when two writers interleave; truncated history.
- **Fix sketch**: Retire `append_message`/`appendDesignConversationMessage` entirely (force all writers through the atomic server-side `append_single_message`), or add an optimistic-concurrency token (compare-and-set on `updated_at`/a version column) so a stale full-array write is rejected rather than applied.

## 5. `setChatMode` persists optimistically but never reverts on failure — UI and DB diverge
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/stores/slices/agents/chatSlice.ts:107-118
- **Scenario**: User toggles advisory ↔ agent. `set({ chatMode: mode })` updates the UI immediately, then `saveChatSessionContext({...chatMode})` is fired with `.catch(() => {})`. If the IPC fails (timeout, lock contention, validation), the UI shows the new mode but the DB still has the old one. On next restore the mode silently reverts, and any turn sent in the meantime is wrapped with the wrong prompt protocol (`_advisory` vs `_chat`), changing model behavior without the user knowing.
- **Root cause**: Optimistic local update with a swallowed-error remote write and no rollback — "success theater". Mode is also behavior-critical (it selects the prompt), not cosmetic.
- **Impact**: UX degradation / wrong-mode execution — message sent under a mode the user thinks they changed away from.
- **Fix sketch**: Await the save and revert `chatMode` to the prior value on failure with a toast; or gate the mode toggle on a confirmed persisted context so local and remote can't diverge.

## 6. Message ordering relies on RFC3339 string sort with no tiebreaker — interleaved/replayed turns can render out of order
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/db/repos/communication/chat.rs:34-44, 107-121
- **Scenario**: `get_session_messages` orders strictly by `ORDER BY created_at` (string comparison of `chrono::Utc::now().to_rfc3339()`), with no secondary key. If two messages land in the same session within the same instant — e.g. a fast assistant finalize racing a user re-send, the background-chat user seed (:190) plus an adopted follow-up, or any clock non-monotonicity / DST-free-but-NTP-stepped wall clock — they sort by content tie equally and SQLite returns them in undefined order. The "last 500" window (`LIMIT ?3` over `DESC` then re-`ASC`) can also drop the wrong message at the boundary when timestamps tie.
- **Root cause**: Wall-clock timestamp used as the sole ordering key for a strictly-sequential conversation; no monotonic sequence column and no `id`/insertion tiebreaker.
- **Impact**: UX degradation / corruption — user and assistant turns shown swapped, or the `buildSummary`/`conversation` context resent to the LLM in the wrong order (poisoning resume context).
- **Fix sketch**: Add a monotonic per-session sequence (autoincrement rowid or explicit `seq`) and order by `(created_at, rowid)` — or order by `rowid` alone — so insertion order is the source of truth regardless of clock resolution.
