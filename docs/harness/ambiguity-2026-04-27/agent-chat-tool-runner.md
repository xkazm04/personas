# Ambiguity Audit — Agent Chat & Tool Runner

> Total: 12 findings (2 critical, 4 high, 5 medium, 1 low)
> Files read: ~22
> Scope: Chat UI, advisory/ops launchpads & dispatchers, tool runner, execution detail/replay views

## 1. Two `useToolRunner` hooks coexist with divergent persona-safety semantics

- **Severity**: critical
- **Category**: undocumented-decision
- **File**: src/features/agents/sub_tool_runner/useToolRunner.ts:1-117 vs src/features/agents/sub_tool_runner/libs/useToolRunner.ts:1-52
- **Scenario**: There are two implementations of `useToolRunner` with the same name and roughly the same shape. The top-level file (`sub_tool_runner/useToolRunner.ts`) carefully snapshots `personaId`, drops stale results when the user switches personas, applies a 120s IPC timeout, and surfaces a "no active persona" error. The `libs/` variant has none of that — it stores results keyed only by `toolId` (no `personaId` tag), silently no-ops when persona is missing, has no timeout, and uses a `runningRef` instead. `ToolRunnerPanel.tsx` imports from `../libs/useToolRunner` (i.e. the unsafe one). The top-level "good" version appears to be unused.
- **Root cause**: A migration/refactor left both copies in tree with no comment indicating which is canonical. The richer comments and protections in the top-level version suggest it was the intended replacement, but the import wiring still points at the older one.
- **Impact**: The active code path can leak a tool result from persona A into persona B's UI (same toolId, switched persona before the IPC resolves) and can leave `isRunning=true` forever on a hung Tauri call. The "fixed" version sits next to it dark, so future readers may believe the safety guards are live when they are not.
- **Fix sketch**:
  - Delete one copy and re-point imports to the survivor.
  - If `libs/useToolRunner.ts` is the canonical one, port the persona-snapshotting and timeout logic over and document why they were dropped (or preserved) at the top of the file.
  - Add an architectural comment explaining the `personaId` snapshotting requirement so the next refactor doesn't silently drop it again.

## 2. Polling fallback in experiment bridge cannot distinguish completed/failed/cancelled — but uses a 30s window during which the realtime listener may still arrive

- **Severity**: critical
- **Category**: edge-case
- **File**: src/features/agents/sub_chat/hooks/useExperimentBridge.ts:178-229
- **Scenario**: The bridge has a 30-second polling fallback that asks `lab_get_active_progress` and, if a tracked `runId` is no longer active, declares the experiment "finished-unknown". The runId is then added to `deliveredRunIds` and the entry removed from working memory, locking out the realtime "completed/failed" listener that may arrive moments later. There's no grace period — a run that finished 1 second before the poll fires races the listener against the poll, and whichever wins decides what the user sees.
- **Root cause**: The decision to deliver immediately on "no longer active" was made without a buffer for the realtime event to arrive. The comment acknowledges the ambiguity but the design still chooses to "deliver an ambiguous finished message" as soon as the API says inactive, which prevents a later truthful message.
- **Impact**: The user can see "Experiment Finished — open the Lab tab to see whether it completed/failed/cancelled" for runs that actually completed successfully or failed cleanly, when a 5-10 second delay would have let the authoritative event win. This silently degrades the UX of a feature the chat actively advertises.
- **Fix sketch**:
  - Add a "grace window" (e.g. 10-15s) between detecting "not active" and delivering the unknown-phase message; the realtime listener's `deliveredRunIds.add` will pre-empt during the wait.
  - Or: on each poll, capture the inactive-since timestamp and only deliver after N consecutive polls show inactive.
  - Document the trade-off with the chosen value at the constant.

## 3. 5-minute stream-idle watchdog hides streaming bubble but leaves orphaned `activeExecutionId`

- **Severity**: high
- **Category**: trade-off-hidden
- **File**: src/features/agents/sub_chat/ChatTab.tsx:108-136
- **Scenario**: A 5-minute timeout clears `chatStreaming` only, leaving `activeExecutionId`, `executionPersonaId`, and `isExecuting` set. The comment explains the rationale (don't orphan the structured-stream subscription that may receive late TodoWrite events). However, the user now sees an idle UI with the input enabled but `isExecuting` is still true — input is disabled by `handleSend`'s guard at line 149. Net effect: the bubble disappears but the user still cannot send a message until they click Cancel, and there is no visible indicator anywhere that the execution is "in zombie state".
- **Root cause**: The trade-off is documented but the resulting state is contradictory: chatStreaming=false (UI says "ready") + isExecuting=true (input still locked) with no recovery affordance.
- **Impact**: User stares at an enabled-looking textarea that won't accept input, with no tooltip/banner explaining why or how to recover. The 5-minute watchdog presents itself as a safety net but the actual recovery path (clicking Cancel) is invisible until they try and fail.
- **Fix sketch**:
  - When the watchdog fires, surface a banner/toast: "Streaming response timed out — execution may still be running. Click Cancel to send a new message."
  - Or: also clear `isExecuting` after a longer secondary timeout (e.g. 10 min).
  - At minimum, swap the placeholder text on the textarea so the user sees a clear cause.

## 4. `extractOperations` accumulator silently drops operations >50KB and dedupes on first 200 chars

- **Severity**: high
- **Category**: magic-number
- **File**: src/features/agents/sub_chat/libs/chatAdvisoryDispatch.ts:106, 127-130
- **Scenario**: The advisory dispatch parser dedupes operations using `accumulator.slice(0, 200)` as the key, and silently drops accumulators that grow past 50,000 characters. Two operations that share the same first 200 chars but diverge later (e.g. two `propose_change` ops with the same section/reason but different content bodies) will be deduped to one. Operations whose JSON exceeds 50KB are dropped with only a `console.warn`.
- **Root cause**: Both limits are bare numeric literals with no constant name and only a brief inline comment. The 200-char dedup window was likely picked to handle "content may vary" but is set without a recorded reason for why 200 was the right number.
- **Impact**: A user asking the advisor to "improve identity AND instructions" with similar-prefixed operations could see only one applied. A large `edit_prompt` for a long instructions section disappears with no UI feedback.
- **Fix sketch**:
  - Hash the full accumulator (cheap) and use that as the dedup key.
  - Surface dropped-operation warnings via the toast/error channel, not console.
  - Promote both limits to named constants with comments explaining the chosen value.

## 5. Operation-line filter assumes JSON ops always start at column 0

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/features/agents/sub_chat/ChatBubbles.tsx:159-169, 188-191
- **Scenario**: `stripOperationLines` filters by `line.trim().startsWith('{"op"')`. If the LLM emits the operation indented (Markdown code block, nested list, "  {\"op\": ...}") inside a wrapping context, the trim makes it a single-pass filter — but if the `{"op"` token appears mid-line (e.g. embedded in narrative text like "I'll emit `{\"op\": \"execute\"}`") the filter fires and removes the entire line, deleting commentary the user should see. Conversely, a code block containing op JSON is hidden from the user even though the assistant may have intended to show it.
- **Root cause**: The filter treats "starts with {\"op\"" as proxy for "is a dispatchable operation line" without coordinating with the dispatch extractor (which itself tracks code-fence state at chatAdvisoryDispatch.ts:92).
- **Impact**: Loss of legitimate assistant content; operation-shaped narrative is silently scrubbed. The streaming bubble at line 188-191 has the same logic and same hazard during typing.
- **Fix sketch**:
  - Share the extraction parser between display and dispatch — render only what the parser did NOT classify as an op.
  - Or: require ops to be on their own line AND the entire line is the JSON object (no trailing text).
  - Document the intended contract for "operation line" in one place and link both call sites to it.

## 6. Persona switch during `startNewSession` await guarded only on chat send — tool runner has the same race but different safeguards

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/features/agents/sub_chat/ChatTab.tsx:153-164
- **Scenario**: `handleSend` snapshots `personaId` and bails if the user navigates away during the async `startNewSession`. This pattern is well-commented and correct. However, the same persona-switch race exists in `useExperimentBridge` (working memory keyed by `chatSessionContext` for *current* session, not the session the experiment was started from), and the unused-but-kept `sub_tool_runner/useToolRunner.ts` has its own snapshot pattern with completely different guards. The chat snapshot pattern is documented; the equivalents elsewhere are not.
- **Root cause**: No central pattern for "snapshot persona at start of async op" — each callsite has reinvented the guard, sometimes with comments, sometimes without, sometimes correctly, sometimes (libs/useToolRunner.ts) not at all.
- **Impact**: A future developer touching persona switching may fix the chat path and miss the others, or may add a new async flow without realising the guard is required. Tribal knowledge instead of a shared utility.
- **Fix sketch**:
  - Extract a `withPersonaSnapshot(fn)` helper or a `usePersonaScopedAsync` hook that does the snapshot+abort once.
  - Add a code comment / docstring at the persona store level enumerating async paths that need this guard.

## 7. Cost accrual curve assumes 95% of cost during stream_output — undocumented split

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/agents/sub_executions/replay/CostAccrualOverlay.tsx:38-48
- **Scenario**: The cost accrual SVG shows ~95% of cost accruing during `stream_output` and the remaining 5% during `finalize_status`. There is no source for this split — no comment cites a measurement, no link to telemetry showing this is the actual distribution.
- **Root cause**: A magic ratio (`0.95`) chosen at some past point, possibly accurate, but with no recorded basis. Different model providers, different streaming behaviors, and tool-heavy executions will all distribute cost differently.
- **Impact**: Users reading the accrual curve will trust it as truth; if the ratio is wrong, they'll mis-time fork-points or mis-attribute cost to the wrong stage. Future tuning has no baseline ("is 0.95 better than 0.85?").
- **Fix sketch**:
  - If real per-stage cost data is available in the trace, compute accrual from it instead of estimating.
  - If not, name the constant `STREAMING_COST_RATIO` with a comment explaining why 0.95 was chosen and noting that it's a UI approximation.

## 8. `formatSummary` truncates at 1000 chars with no continuation indicator

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/agents/sub_chat/hooks/useExperimentBridge.ts:52-66
- **Scenario**: When delivering an experiment result into chat, `formatSummary` slices the JSON output at 1000 chars without an ellipsis or "view more" link. Lab summaries with full per-model breakdowns (multi-model arena tests) routinely exceed this.
- **Root cause**: 1000 was chosen to keep chat bubbles compact, but truncation is silent — JSON is cut mid-key/mid-value and rendered inside a code block that looks complete.
- **Impact**: User reads a malformed JSON object and may believe critical fields are missing entirely. Worse, since it lives inside a ```json block, it may be visibly broken (unbalanced braces).
- **Fix sketch**:
  - Append `\n... (truncated, open Lab tab for full summary)` when slicing.
  - Or: render a structured summary (best model, top-line metrics) instead of raw JSON dump.
  - Move the 1000 to a named constant.

## 9. Timeline scrubber `pointermove` listener never released if pointerup fires outside window

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/agents/sub_executions/replay/TimelineScrubber.tsx:28-46
- **Scenario**: `handlePointerDown` adds `pointermove`/`pointerup` to `window`. If the user drags out of the window and releases the mouse outside (e.g., on a different monitor / dev tools), `pointerup` may never fire and the listener leaks until the next pointerdown that succeeds. There is also no `pointercancel` handler, which fires when the OS interrupts the gesture.
- **Root cause**: Bare DOM listener pattern without a `pointercapture` strategy or `pointercancel` cleanup.
- **Impact**: Memory leak, plus the scrubber stays "tracking" — every mouse move anywhere on the window updates `currentMs` until the user clicks somewhere on the track again.
- **Fix sketch**:
  - Use `setPointerCapture` on the track element and listen on the element instead of window.
  - Add `pointercancel` cleanup.
  - On unmount of the component during a drag, clean up listeners.

## 10. `dotColor` thresholds (2s/10s) are hard-coded with no explanation

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/agents/sub_executions/runnerTypes.tsx:38-43
- **Scenario**: Tool-call status dots turn green (<2s), amber (<10s), or red (≥10s) based on duration. No comment explains why these thresholds were chosen, and they apply uniformly across all tool types — a Read of a small file and an MCP web fetch are judged on the same scale, so legitimately fast tools look "okay" and legitimately slow tools always look "red".
- **Root cause**: Default thresholds picked once for "feels right" without per-tool calibration.
- **Impact**: Misleads operators about tool health. Future tuning has no recorded baseline; future addition of "tool-aware thresholds" has to first deduce that this is the central function.
- **Fix sketch**:
  - Name the thresholds (`FAST_MS`, `WARN_MS`) and document the choice.
  - Consider per-tool-category thresholds (a network call vs a local read) or display the threshold legend in the UI so users can self-calibrate.

## 11. `restoreSession` skip path consumes a flag with no fallback if hydration silently fails

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/agents/sub_chat/ChatTab.tsx:70-81
- **Scenario**: The mount effect calls `consumeChatPreloaded()`, which atomically marks the preload as handled. If `wasPreloaded` is true, `restoreSession` is skipped. There is no verification that the preloaded session actually populated `chatMessages` / `activeChatSessionId` — if the upstream hydration was attempted but failed (network error, missing session), the user lands on an empty chat with no recovery.
- **Root cause**: The contract between "upstream hydrator sets the preload flag" and "ChatTab respects it" is implicit. Failure modes are not enumerated.
- **Impact**: User clicks a notification expecting to see a chat, sees an empty UI instead, and there's no signal about what went wrong or how to recover (refresh? click again?). The `consumeChatPreloaded` having already returned true means a later remount won't auto-restore either.
- **Fix sketch**:
  - After `consumeChatPreloaded()` returns true, verify `activeChatSessionId` is set; if not, fall through to `restoreSession`.
  - Document the contract (who sets the flag, who clears it, what state must be set before).
  - Add a toast on hydration failure.

## 12. `getExecutionTrace` listener missing `personaId` in dep array but uses it via closure

- **Severity**: low
- **Category**: implicit-assumption
- **File**: src/features/agents/sub_executions/detail/inspector/useTraceData.ts:16-46
- **Scenario**: The fetch effect depends only on `executionId` (line 36) but reads `personaId` from the closure. If a parent component swaps personaId without changing executionId, the effect won't re-fire, and the existing trace stays — which is probably intentional (the trace belongs to that execution regardless of caller persona). But it's not documented and ESLint exhaustive-deps would flag this.
- **Root cause**: Eslint comment / explicit `// eslint-disable-next-line react-hooks/exhaustive-deps` is absent, so it reads as an oversight rather than a deliberate choice.
- **Impact**: Future readers may "fix" the dep array, causing redundant trace refetches on every persona toggle and breaking the equality of the displayed trace data.
- **Fix sketch**:
  - Add an explicit comment: `// personaId is intentionally not a dep — trace is execution-scoped, not persona-scoped`
  - Or: capture `personaId` into a ref so the effect can read it without a dep entry.
