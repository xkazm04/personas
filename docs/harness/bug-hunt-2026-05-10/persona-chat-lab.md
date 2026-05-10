# Bug Hunt — Persona Chat & Lab

> Group: Personas Workspace
> Files scanned: 10
> Total: 2C / 6H / 5M / 1L = 14 findings

---

## 1. Three lab modes share one lifecycle FSM — concurrent matrix/ab/eval runs corrupt each other's state

- **Severity**: critical
- **Category**: race-condition
- **File**: `src/stores/slices/agents/labSlice.ts:333-335`
- **Scenario**: User starts a Matrix run, switches the lab tab to A/B (or Eval) and starts a second run. `ab` and `eval_` are both built with `matrixLifecycle` (the same closure-bound `currentState` + `safetyTimeoutId`). When the second `wrapStart` calls `matrixLifecycle.markStarted(set)`, `tryTransition('running','running')` returns `'running'` (same-state allowed), so it proceeds — but it `clearSafetyTimeout()` followed by `scheduleSafetyTimeout()` cancels the matrix run's 30-min watchdog. Worse, `markStarted` writes `{ isMatrixRunning: true, matrixProgress: null }` regardless of the actually-started mode, so launching A/B nukes the matrix progress display, and finishing matrix while A/B is still running flips `isMatrixRunning:false` (cancel/launch UI for both modes is now wrong).
- **Root cause**: `createRunLifecycle` keeps `currentState` and `safetyTimeoutId` in module-level closures unique per lifecycle *instance*, but the slice intentionally shares one instance across three modes. The FSM has no concept of multiple parallel runs.
- **Impact**: Any user who runs more than one non-arena lab mode at the same time. Symptoms include vanished progress bars, frozen "running" state after one run finishes, missing safety timeouts, persona orbit dot glitches.
- **Fix sketch**: Give each mode its own `createRunLifecycle` instance (one per state-key pair), or refactor the FSM to track per-runId state. The cancel path also needs the per-mode lifecycle (it already does via `lc`, but A/B/eval all map to `matrixLifecycle`).

## 2. Stale persona guard is missing for the message-send path — content leaks across personas

- **Severity**: critical
- **Category**: race-condition
- **File**: `src/features/agents/sub_chat/ChatTab.tsx:217-239` and `src/stores/slices/agents/chatSlice.ts:158-216`
- **Scenario**: User has a session active, types a message, hits Enter. `handleSend` snapshots `sendPersonaId = personaId`, but the guard around persona-switching only fires inside the `if (!sessionId)` branch. When `activeChatSessionId` is already populated, control jumps straight to `sendMessage(sendPersonaId, sessionId, text)` with no re-check. Inside the slice, `createChatMessage` is awaited; during that await the user can switch persona. After the await, `set((s) => ({ chatMessages: [...s.chatMessages, userMsg] }))` *appends the previous persona's message into the freshly-loaded new persona's chatMessages* — because `s.chatMessages` is the new persona's array now. The user message will also reappear briefly in the wrong UI before the next fetch overwrites it.
- **Root cause**: The "snapshot personaId" pattern protects against creating sessions for the wrong persona but not against in-flight DB inserts updating the in-memory store.
- **Impact**: Visible cross-persona content bleed; chat audit logs no longer trustworthy because the in-memory list briefly conflates two personas; the DB row is correct but UI is not.
- **Fix sketch**: After every `await` in `sendChatMessage`, re-read `get().selectedPersona?.id` and bail (or at least skip the `set`) if it no longer matches `personaId`. Better: skip in-memory mutation entirely when `get().activeChatSessionId !== sessionId`.

## 3. Chat execution listeners replace the `chatExecCleanup` global on every send — losing the prior run's listeners forever

- **Severity**: high
- **Category**: race-condition
- **File**: `src/stores/slices/agents/chatSlice.ts:415-492`
- **Scenario**: User sends message A → `setupChatExecListeners(execA, ...)` registers async listeners. Before the listeners actually attach (the `await listen()` is in flight), the user clicks Send for message B (e.g. by hitting Cancel + Enter quickly while `chatStreaming` momentarily false). Run B's `setupChatExecListeners` calls `chatExecCleanup?.()` which sets `aborted = true` for run A — but A's IIFE has *not yet* assigned `unlistenOutput`, so when its `listen()` resolves it tries `out()` early and bails. That part is correct. *However*, run A's listeners that *did* attach (say `unlistenOutput`) will never get unregistered because run B's `cleanup` overwrote the `chatExecCleanup` slot. If run A's listener fires in between, its handler is gated by `finalized` flag local to A's IIFE — but `finalized` is only set when *A's* status listener sees a terminal status, which now goes to B's executionId. Result: orphan listener for run A keeps firing on EVERY future execution status event.
- **Root cause**: A single mutable module-scoped `chatExecCleanup` cannot represent N concurrent listener setups. The IIFE's `aborted` check happens before each await but not between awaits and listener-attach assignment, and references between IIFEs are not coordinated.
- **Impact**: Memory leak; "stuck streaming" reports because old listeners append to old session's `executionOutput` slot but don't drive UI; under HMR the leak compounds. After ~10 rapid retries, every status event triggers many handlers.
- **Fix sketch**: Track listeners in a `Map<executionId, cleanup>` rather than a single slot. Clean up by id, not last-write-wins.

## 4. `inputValue` cleared before `sendMessage` finishes — typed message lost on failure

- **Severity**: high
- **Category**: optimistic-update
- **File**: `src/features/agents/sub_chat/ChatTab.tsx:238-239`
- **Scenario**: User types a message, hits send. `setInputValue('')` is called *before* `sendMessage`. Inside `sendMessage`, `createChatMessage` rejects (DB locked, IPC timeout, auth expired, etc.). `reportError` shows a toast, `chatStreaming` flips back to false, but the input is already empty — the user has to retype the entire prompt.
- **Root cause**: Early optimistic clear, no rollback on failure.
- **Impact**: Anyone sending a long prompt under flaky conditions. Re-typing a paragraph is enraging.
- **Fix sketch**: Clear `inputValue` only inside `sendChatMessage` after the DB insert succeeds, or restore it on the `catch`. Even simpler: don't clear until `chatStreaming` flips true.

## 5. `consumeChatPreloaded` race — second mount in a remount cycle restores stale session

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/agents/sub_chat/ChatTab.tsx:75-86` and `src/stores/slices/agents/chatSlice.ts:99-103`
- **Scenario**: ChatTab mount fires `useEffect` with `personaId`. It calls `fetchSessions(personaId)` (no await), then synchronously `consumeChatPreloaded()`, then conditionally `restoreSession(personaId)`. If React strict-mode (or fast re-mount) double-invokes the effect, the first invocation consumes the flag → `restoreSession` skipped; second invocation sees `wasPreloaded = false` → triggers default `restoreSession`, which races with the still-pending `fetchSessions` from the first invocation and may overwrite the explicitly-preloaded `chatMessages` / `chatSessionContext` set by the upstream caller (drawer / notifications) with the latest-session content instead.
- **Root cause**: The "consume" pattern doesn't distinguish "another caller already consumed it on this app boot" from "I had no preload". Combined with effect cleanup re-running, the flag is one-shot but the consumers are not.
- **Impact**: User clicks a feedback notification → ChatTab mounts → strict mode (or HMR / a parent re-render) remounts → the carefully restored feedback session jumps to the latest session.
- **Fix sketch**: Set `chatPreloaded` to a triple `{ flag: true, sessionId, personaId }` and let `consumeChatPreloaded(personaId)` only consume when the persona matches. Or skip the default restore whenever `chatMessages.length > 0 && activeChatSessionId` is set.

## 6. `finishChatStream` falls through after fetched `executionId` — claudeSessionId never persisted on session-context save error

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/stores/slices/agents/chatSlice.ts:243-281`
- **Scenario**: First chat turn completes. `finishChatStream` calls `getExecution(...)` to fetch `claude_session_id`. The follow-up `saveChatSessionContext({...claudeSessionId})` is *fire-and-forget* with `.catch(() => {/* best effort */})`. If that save fails (transient IPC error, DB lock), the next user turn enters `sendChatMessage` and reads `get().chatSessionContext?.claudeSessionId` — which was *only* updated by the in-flight Promise. Without successful persist + state set, `claudeSessionId` is `undefined`, the code takes the "first message" branch and re-injects `_advisory: true` plus full conversation context. The Claude session is silently restarted instead of resumed, doubling token cost and losing the diagnostic context warmed up in turn 1.
- **Root cause**: Continuation depends on an async best-effort write whose failure is swallowed.
- **Impact**: Quietly re-billed conversation; users see analyses that contradict turn 1 because the model has no memory; bug reports of "the bot forgot what we talked about".
- **Fix sketch**: `await` the context save before allowing the next turn, or persist `claudeSessionId` directly into a synchronous in-memory field (`set({ chatSessionContext: { ...prev, claudeSessionId } })`) immediately after fetching it, *before* the disk write returns.

## 7. SessionSidebar delete confirmation auto-cancels on legitimate click

- **Severity**: high
- **Category**: edge-case
- **File**: `src/features/agents/sub_chat/SessionSidebar.tsx:66-76`
- **Scenario**: User clicks the trash icon → state flips to `confirmDeleteId = sessionId` → red "Confirm" button mounts with `autoFocus` and `onBlur={() => setConfirmDeleteId(null)}`. User clicks the same button to confirm. The mousedown on the button takes focus *out* of itself in some browsers/Tauri webviews when the click triggers a re-render that unmounts the button (because `clearSession` runs immediately and the parent `s.sessionId` row vanishes from `sessions`). When `onBlur` fires before `onClick` finishes (rare but observed in webkitGtk / older Edge WebView2), `setConfirmDeleteId(null)` runs but `clearSession` has already fired — duplicate prone, and worse, if user clicks anywhere else between trash → confirm (e.g. scroll the list, click a different session), the blur cancels confirmation silently. There is no visual hint that "click anywhere will cancel".
- **Root cause**: Treating focus loss as cancellation while the confirm button is the only thing that drives the destructive action invites timing dependent ordering.
- **Impact**: User reports "I clicked confirm and nothing happened" (intermittently). Worse: user thinks they confirmed and the row remains, then they double-tap and a second confirmation hits a different session.
- **Fix sketch**: Use an explicit "cancel" affordance (X button or Escape key) instead of `onBlur`. Or, on blur, defer the cancel via `setTimeout(0)` so any pending click event resolves first.

## 8. `fetchChatMessages` doesn't clear `chatTodos` — stale plan from previous session lingers

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/stores/slices/agents/chatSlice.ts:134-148`
- **Scenario**: User has session A active with a TodoWrite plan visible. They click session B in the sidebar. `fetchChatMessages` swaps `chatMessages` and `activeChatSessionId`, but does *not* reset `chatTodos`. The old plan from A's most recent execution remains on screen above session B's messages — completely unrelated content — until B's next execution emits a TodoWrite event (which may never happen). `restoreChatSession` properly clears it (line 356), `startNewChatSession` clears it (line 154), but the explicit-switch path doesn't.
- **Root cause**: Each session-mutation entry-point manages `chatTodos` independently; `fetchChatMessages` was missed.
- **Impact**: Confused users seeing tasks attributed to the wrong conversation. Less severe than data corruption but undermines trust.
- **Fix sketch**: Add `chatTodos: null` to the `set()` in `fetchChatMessages`.

## 9. `appendChatStreamLine` is a documented no-op but still on the slice — silent corruption if anyone calls it

- **Severity**: low
- **Category**: silent-failure
- **File**: `src/stores/slices/agents/chatSlice.ts:238-241`
- **Scenario**: A future caller (or an existing one — grep didn't catch one in this scan but the action is exported) invokes `appendChatStreamLine(line)`, expecting the line to land somewhere. Nothing happens. No error, no console warning. The "documented in comments" justification rots the moment readers skim.
- **Root cause**: Dead-code action kept on the slice for backward API surface.
- **Impact**: Low — but if a worker / Tauri command starts emitting through this expecting it to populate UI, debugging will be miserable.
- **Fix sketch**: Either remove from the slice and the type definition, or have it warn via `logger.warn` at runtime so callers learn.

## 10. AbPanelStudio reads `isLabRunning` (legacy) — can show "running" while another mode runs

- **Severity**: medium
- **Category**: stale-closure
- **File**: `src/features/agents/sub_lab/components/ab/useAbPanelState.ts:17` (and via AbPanelStudio:126)
- **Scenario**: User starts an Arena run. `isLabRunning` flips true (legacy combined flag set by `arena.wrapStart`). User opens the A/B tab. AbPanelStudio's CTA is hidden / cancel button shown because `isLabRunning` is true — but cancelling here calls `cancelAb` on `activeRunId` which is *the arena run's* id (or null). Confusing or destructive. Other panels (`MatrixPanel`, `ArenaPanel`) consume the per-mode flag, only AB still uses the legacy.
- **Root cause**: Migration to per-mode flags missed AbPanelStudio.
- **Impact**: A/B tab UI appears locked while arena runs; user clicks "Cancel A/B" and either nothing happens (null activeRunId) or arena gets cancelled.
- **Fix sketch**: Add `isAbRunning` to the slice (currently absent) and wire AbPanel to it; or at minimum read `isMatrixRunning` since A/B already uses `matrixLifecycle`.

## 11. ArenaPanel `champion.model` is parsed from JSON without provider context — "haiku" vs "ollama:haiku" collide

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/agents/sub_lab/components/arena/ArenaPanelColosseum.tsx:95-123`
- **Scenario**: A summary writes `best_quality_model: "haiku"` (Anthropic). Another writes `best_quality_model: "ollama:haiku"`. The tally treats them as separate models — fine. But heraldry lookup at line 1030 does `HERALDRY[champion.model] ?? heraldryFor(champion.model, 'unknown')`. If the backend ever emits a *display label* like `"Claude 3 Haiku"` (instead of the id), the tally key becomes a label, and the entire chronicle silently double-counts every flavor of Haiku as separate champions, displaying generic Sword sigil for the most-likely-winning model.
- **Root cause**: No schema validation on the `summary` JSON; the contract is implicit.
- **Impact**: Display anomaly — wrong sigil, possibly inflated/deflated standings.
- **Fix sketch**: Document the contract, or normalize via `ALL_MODELS.find` and skip if no match.

## 12. ChatTab idle-timeout watchdog re-arms on every line — never fires for slow steady streams

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/agents/sub_chat/ChatTab.tsx:135-152`
- **Scenario**: The 5-min idle watchdog deps array is `[chatStreaming, streamTextLines.length]`. Every new text line bumps `streamTextLines.length`, which clears the previous timer and starts fresh. So a stream that emits one token every 4 minutes will *never* hit the idle timeout — but is also clearly stuck. Conversely, the description in the comment says "5-minute idle watchdog on streamTextLines growth" implying it should fire when growth STOPS. That part works. But the converse — a stream emitting only operation-protocol JSON lines that get filtered by `classifyLine` to non-text — those *don't* increment `streamTextLines.length`, so the timer doesn't reset and fires even though the stream is healthy.
- **Root cause**: `streamTextLines.length` is a filtered count, not a "any activity" count. It can underestimate liveness during heavy tool-use phases.
- **Impact**: Tool-heavy executions (lots of tool-call blocks, no text) trip a false 5-min timeout, hiding the streaming bubble while the run is alive — user thinks it died and cancels.
- **Fix sketch**: Use raw `executionOutput.length` (any line), not the text-filtered count, to reset the watchdog.

## 13. Experiment-bridge polling clears `inactiveSinceMap` only via grace path — leak when working memory is cleared mid-grace

- **Severity**: medium
- **Category**: memory-leak
- **File**: `src/features/agents/sub_chat/hooks/useExperimentBridge.ts:237-273`
- **Scenario**: An experiment is in the inactive grace window (`inactiveSinceMap` populated). Before the grace expires, the user explicitly removes the experiment from working memory (e.g. by deleting the chat session). The for-loop no longer iterates over that runId, so `inactiveSinceMap.delete(exp.runId)` never runs and `markDelivered` never runs. The entry sits in the Map forever (well, until app restart). Repeat over many sessions and the Map grows unbounded.
- **Root cause**: Cleanup of `inactiveSinceMap` is conditional on the experiment still being in working memory.
- **Impact**: Slow memory growth in long-lived sessions; not catastrophic but noticeable in dev tools after hours of use.
- **Fix sketch**: Periodically prune `inactiveSinceMap` for runIds no longer present in any active workingMemory, or scope it to a `useRef` Map per hook instance.

## 14. CopyBtn `text` captured at render time — copies stale assistant content if message edited after stream

- **Severity**: low
- **Category**: stale-closure
- **File**: `src/features/agents/sub_chat/ChatBubbles.tsx:38-91`
- **Scenario**: `<CopyBtn text={message.content} />` (line 148) bakes content into the closure when the bubble first renders. If `chatMessages` is later updated in place (e.g., a moderation/redaction layer rewrites historical content, or the Sentry sanitizer scrubs PII post-hoc), the bubble re-renders with new `message.content` but the `handleCopy` callback memoized via `useCallback([text, ...])` rebuilds on `text` change so it should pick up. *But* if a Promise to `clipboard.writeText` is in-flight (clicked just before the prop change), the in-flight copy uses the old text. Edge case but possible during streaming finalization where `fullResponse` may differ from final stored content (operation lines stripped).
- **Root cause**: Async copy operation captures arg by value; UI assumes single-shot.
- **Impact**: Rare; user copies pre-strip content. Cosmetic.
- **Fix sketch**: Read `text` from a ref at click time, or invalidate copied state on prop change.
