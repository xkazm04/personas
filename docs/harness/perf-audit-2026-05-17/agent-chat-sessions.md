# Perf-Optimizer Scan — Agent Chat & Sessions

> Project: Personas (frontend-only)
> Scope: 18 paths requested in src/ — 13 are missing from the codebase (see Scope notes)
> Total: 8 findings (0 critical / 4 high / 4 medium / 0 low)

## Scope notes

The assigned scope was framed around an `src/features/agents/sub_chat/` feature tree (ChatTab, ChatBubbles, SessionSidebar, AdvisoryLaunchpad, PlanPanel, OpsSidebar, five panels in `panels/`, `libs/chatAdvisoryDispatch.ts`, `hooks/useExperimentBridge.ts`). **None of these exist** — `find` returns zero hits, and `Grep` for the component names matches nothing outside this scan request. The only `ChatTab.tsx` in the repo is `src/features/vault/sub_databases/tabs/ChatTab.tsx`, unrelated to agent chat.

The cause is documented in `src/stores/slices/agents/chatSlice.ts:283-286`:
> "Advisory mode was wired to the in-editor chat UI, which has been retired in favour of companion chat. The slice still exists so legacy background sessions and execution-stream consumers don't break, but there is no longer a UI surface that drives advisory operations."

Files that **do** exist and were read in full:

- `src/api/agents/chat.ts`
- `src/features/agents/components/ChatThread.tsx` (orphaned — exported, never imported; only mentioned in `lib/harness/scenario-parser.ts:194`)
- `src/features/agents/components/ChatMessageContent.tsx` (referenced by ChatThread; read for context)
- `src/stores/slices/agents/chatSlice.ts`
- `src/stores/slices/agents/backgroundChatSlice.ts`
- `src/stores/slices/agents/miniPlayerSlice.ts`

Cross-referenced consumers:

- `src/features/shared/components/layout/ProcessActivityDrawer.tsx` (calls `restoreChatSession`)
- `src/features/overview/sub_messages/components/MessageDetailModal.tsx` (calls `startFeedbackChat`)
- `src/features/execution/components/ExecutionMiniPlayer.tsx` (consumes miniPlayerSlice + executionOutput)

Findings are targeted at the surviving slices and the orphaned `ChatThread` component (which would re-introduce all classic chat-list perf problems if revived).

## 1. ChatThread re-renders the entire message list on every streaming token

- **Severity**: high
- **Category**: re-renders / streaming
- **File**: `src/features/agents/components/ChatThread.tsx:46-74`
- **Scenario**: While an assistant message is streaming, `msg.content` of the last message mutates each chunk. Every chunk arrival re-runs the component, and because the entire `messages.map(...)` body is inline JSX (no memoized row component), React reconciles every prior bubble — including markdown rendering — on every token.
- **Root cause**: (1) Inline row body, not a memoized `ChatBubble` component. (2) `ChatMessageContent` performs `useMemo` on its `components` config keyed by `onSendToLab`, but the parent passes `onSendToLab` by prop without `useCallback` guarantee — every re-render re-creates the markdown components object. (3) `ReactMarkdown` re-parses the full markdown of *every* assistant bubble on every render because it is not memoized over `content`. (4) `rehypeHighlight` runs syntax highlighting from scratch on every render of every code block, not just the streaming one.
- **Impact**: With N assistant messages averaging M tokens of markdown, each streamed token triggers O(N × highlight(M)) work. Long threads visibly stutter mid-stream and pin a CPU core; `rehype-highlight` is the dominant cost.
- **Fix sketch**: Extract a `ChatBubble` wrapped in `React.memo` keyed on `(msg.id, msg.content, isStreaming)`. Memoize `ChatMessageContent` itself with `React.memo` and a custom compare that ignores `onSendToLab` identity (or wrap `onSendToLab` in `useCallback` in the parent). Wrap the `components` config in a module-level constant generator that only depends on `onSendToLab` — currently it lives in `useMemo` but is recreated whenever `ChatMessageContent` re-mounts. Only the actively-streaming bubble should ever re-render during stream; finalized bubbles render once.

## 2. `executionOutput` is consumed as raw array on every chunk, no rAF coalescing

- **Severity**: high
- **Category**: streaming / event coalescing
- **File**: `src/stores/slices/agents/chatSlice.ts:238-241` and `:422-428`
- **Scenario**: `appendChatStreamLine` is a documented no-op (line 238) — the chat reads `executionOutput` directly. In `setupChatExecListeners`, the `EXECUTION_OUTPUT` Tauri event handler calls `get().appendExecutionOutput(event.payload.line)` for every emitted line (line 411). On the executionSlice side this calls `set({ executionOutput, executionOutputBytes })` via `executionSink.bind` (executionSlice.ts:145-146). Every line emission causes a Zustand state mutation and a notification to every subscriber that selected `executionOutput` (e.g. `ExecutionMiniPlayer` at line 139 and 230).
- **Root cause**: No throttle / rAF batching between Tauri event arrival and Zustand `set`. Claude CLI emits dozens of lines per second during tool calls; each one triggers a full render pass through subscribers. `ExecutionMiniPlayer` then does `useMemo(() => executionOutput.slice(-30), [executionOutput])` — the memo invalidates on every line.
- **Impact**: During a streaming response, the entire React subtree subscribed to `executionOutput` re-renders 30-60 times per second. With `ExecutionMiniPlayer` mounted (always-on when pinned), this is constant during streams. Combined with finding #1 (if any chat UI is restored), this is the dominant streaming jank source.
- **Fix sketch**: Coalesce in `executionSink` — accumulate lines into a pending buffer and flush via `requestAnimationFrame` (drop subsequent rAF schedules while one is pending). Alternative: debounce via `flushSync` boundary at 16ms. The sink already centralises the flush (`bind` callback), so the throttle is a one-line addition on the sink, no consumer changes.

## 3. `buildSummary` rebuilds the full assistant summary on every user message

- **Severity**: medium
- **Category**: algorithmic / async coordination
- **File**: `src/stores/slices/agents/chatSlice.ts:80-85`, `:171-177`, `:275-281`
- **Scenario**: Every `sendChatMessage` call invokes `buildSummary(allMessages)` which slices the last 20, maps each one to a 300-char snippet, and joins. The result is then passed to `saveChatSessionContext` via `invoke`. Same again in `finishChatStream` for the assistant turn. After the `MAX_CHAT_MESSAGES=500` cap, that's up to 20 string slices + JSON serialisation per turn even though only one message changed.
- **Root cause**: Pure recomputation with no caching; results are sent via IPC to be persisted. The IPC round-trip itself is the larger cost — every turn does a `save_chat_session_context` invoke whose body grows linearly with summary length, even when the summary diff is just one entry.
- **Impact**: Adds ~6KB JSON IPC per send/finish on long threads; for a 100-message session, the summary is rewritten 100 times during the session. Not user-perceptible per-turn, but burns IPC bandwidth and disk writes, and the `set({ chatSessionContext })` after each `then` (line 144, 177, 281) re-renders any subscriber that selects `chatSessionContext`.
- **Fix sketch**: Memoize `buildSummary` keyed on the message-id tail (last 20 ids + total length); skip the IPC `saveChatSessionContext` when the summary is byte-identical to the last persisted value. Backend likely supports a "touch" call without payload — call that for follow-ups and only resend `summary` when actually rotating the window.

## 4. `executionOutput.filter(classifyLine === 'text')` runs over the full buffer at terminal status

- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/stores/slices/agents/chatSlice.ts:422-425` and `src/stores/slices/agents/backgroundChatSlice.ts:377-378`
- **Scenario**: When `EXECUTION_STATUS` terminal arrives, both slices reach for the *entire* output array and call `output.filter((l) => classifyLine(l) === 'text')` then `join('\n')`. `classifyLine` runs regex matching per line. For a long-running execution with thousands of output lines (file edits, tool calls, reasoning), this is an O(N × regex) sync pass on the main thread.
- **Root cause**: `classifyLine` is invoked on lines that were already classified once in the UI (terminal colorers do the same). The work isn't memoized, and the filter+join happens synchronously inside the status event handler before any other work continues.
- **Impact**: 50-200ms blocking pause at execution end on long sessions, visible as a UI freeze right at the moment the user expects "done". Only happens once per turn but always at the worst time (transition animations).
- **Fix sketch**: Classify lines as they arrive in the sink and store only the text-class subset in a parallel buffer; at terminal time the response is already pre-filtered. Or: do the filter+join in a microtask (`await Promise.resolve()` then process) so the status event handler returns immediately and the UI can paint the "completed" state first.

## 5. Background chat status updates rewrite `backgroundChats` map on every event

- **Severity**: medium
- **Category**: re-renders
- **File**: `src/stores/slices/agents/backgroundChatSlice.ts:233-242`, `:280-288`, `:409-425`, `:482-496`
- **Scenario**: Every state transition in `setupBackgroundExecListeners` calls `set((s) => ({ backgroundChats: { ...s.backgroundChats, [feedbackId]: {...cur, ...patch} } }))`. Each update spreads the entire map. Subscribers using `useAgentStore((s) => s.backgroundChats)` get a new reference per transition; consumers selecting individual entries by id (e.g. `ProcessActivityDrawer`, `NotificationCenter`) still re-render because the parent reference changed even though their slot is identical.
- **Root cause**: Map-of-records pattern with full spread, no per-entry stable identity. There's no `shallow` comparator wired in at consumer sites either.
- **Impact**: With N concurrent feedback chats, every status flip causes all N consumers (drawer rows, notification badges, miniplayer background dots) to reconcile. The output-line listener (line 367) does NOT update the map (writes to a closure-local `outputLines` array, good), so the cost is bounded to ~3-5 transitions per chat, but the cost scales with concurrent feedback chats × subscribers.
- **Fix sketch**: Either (a) consumers select by id with `useAgentStore((s) => s.backgroundChats[feedbackId], shallow)`, or (b) split state to `backgroundChatIds: string[]` + `backgroundChatById: Record<string, BG>` and only spread the touched entry's record. Document the selector convention on the slice.

## 6. `restoreChatSession` does two sequential round-trips when persisted active id exists

- **Severity**: medium
- **Category**: async coordination
- **File**: `src/stores/slices/agents/chatSlice.ts:320-335`
- **Scenario**: When `activeChatSessionId` is non-null on restore, the code first awaits `listChatSessions`, then if `stillExists` awaits `getChatMessages`. Two sequential IPC round-trips for the common case.
- **Root cause**: Validation depends on the sessions list, but the message fetch is independent — for the common case (session still exists), both could run in parallel and the messages discarded if validation fails. The "specific session id" branch (line 298) already uses `Promise.all` correctly; the auto-restore branch missed the same optimization.
- **Impact**: ~50-150ms extra latency on every app boot / persona switch before the chat is visible, scaling with IPC RTT. Easy win.
- **Fix sketch**:
  ```ts
  const [sessions, messages, ctx] = await Promise.all([
    listChatSessions(personaId),
    getChatMessages(personaId, activeChatSessionId),
    getChatSessionContext(activeChatSessionId),
  ]);
  if (sessions.some(s => s.sessionId === activeChatSessionId)) {
    set({ chatSessions: sessions, chatMessages: messages.slice(-MAX_CHAT_MESSAGES), chatSessionContext: ctx });
    return;
  }
  // fall through; we already have `sessions` to derive latest
  ```

## 7. `chatSessions.reduce` for latest session is O(N) on every restore; no index

- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/stores/slices/agents/chatSlice.ts:338-345`
- **Scenario**: `sessions.reduce((a, b) => a.lastMessageAt > b.lastMessageAt ? a : b)` on every restore. Then a second `Promise.all` for that session's messages + context. If `listChatSessions` returns sessions already sorted by `lastMessageAt` desc (typical for chat list queries — would need to verify the backend), `sessions[0]` is enough.
- **Root cause**: Defensive code that doesn't trust backend ordering. The reduce isn't expensive in isolation (sessions are bounded), but combined with finding #6 it's the second sequential pass over the same data.
- **Impact**: Minor in absolute terms (microseconds for typical N<200), but reveals that the slice doesn't trust or document its inputs. Mostly a clarity/maintainability cost; perf cost is real only at very high session counts.
- **Fix sketch**: If the backend orders by `lastMessageAt DESC`, use `sessions[0]`; otherwise document and keep the reduce. Either way, fold into the parallel `Promise.all` from finding #6 so there's exactly one round-trip set.

## 8. `ExecutionMiniPlayer` uses 14 separate `useAgentStore` selectors — one subscription per slice field

- **Severity**: medium
- **Category**: re-renders
- **File**: `src/features/execution/components/ExecutionMiniPlayer.tsx:131-149`
- **Scenario**: The miniplayer (which is one of the few remaining consumers of `miniPlayerSlice` + chat-adjacent state) subscribes to 14 different store fields with separate `useAgentStore((s) => s.X)` calls. Each subscription registers an independent listener with Zustand. Every store change pings all 14 listeners (Zustand uses `Object.is` per-subscriber, so only the changed field returns a fresh value — the comparison itself is cheap).
- **Root cause**: Idiomatic Zustand selector-per-field pattern. Not strictly a bug, but during streaming (finding #2) `executionOutput` mutates per line and triggers two `useMemo` recomputations downstream: `lastLines = executionOutput.slice(-30)` (line 230) and consumers of `executionOutput.length` for the lines counter (line 347).
- **Impact**: Tied to finding #2 — if streaming events get coalesced via rAF, this becomes a non-issue. Without that fix, every line emission re-runs the lastLines memo and re-renders the terminal pane (line 369-379) which maps over 30 lines each frame.
- **Fix sketch**: After fixing #2 this becomes irrelevant. Independently: the `lastLines` array could be derived inside the sink (keep a separate "tail" ring of 30 lines published as its own store field), so consumers subscribe to the tail and not the full array. The `executionOutputBytes` field already shows the pattern of publishing derived state alongside the buffer.
