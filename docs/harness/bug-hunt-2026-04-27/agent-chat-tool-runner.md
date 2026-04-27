# Bug Hunt — Agent Chat & Tool Runner

> Total: 14 | Critical: 2 | High: 6 | Medium: 5 | Low: 1

## 1. Watchdog timer destroys live execution state on mid-stream silence

- **Severity**: critical
- **Category**: timing-bug
- **File**: `src/features/agents/sub_chat/ChatTab.tsx:119-131`
- **Scenario**: User sends a long-running message. The agent thinks for >60s without emitting a single line of text (e.g. extended reasoning, network slowness, a long tool call). At the 60s mark from the *last* `streamTextLines.length` change, the watchdog fires.
- **Root cause**: The "stuck stream" watchdog resets only when `streamTextLines.length` changes — it does NOT reset when `chatStreaming` toggles on, and crucially it cannot tell the difference between "stream truly hung" and "agent is busy on a slow tool call". On fire, it forcibly clears `chatStreaming`, `isExecuting`, `activeExecutionId`, and `executionPersonaId` — orphaning the actual backend execution that is still running.
- **Impact**: User sees the input unlock and the streaming bubble disappear, but the agent is still executing in the background. When real output finally arrives, it has no `activeExecutionId` to attach to (the structured stream subscription in `useStructuredStream(activeExecutionId)` is now subscribed to `null`), so TodoWrite and other events are silently dropped. The user may submit a second message that races the still-live first execution.
- **Fix sketch**: The watchdog should *query the engine* via Tauri to confirm the execution is actually dead before nuking client state; or it should only show a "Still working…" hint and a manual cancel button rather than auto-cancelling.

## 2. `personaIdRef` declared AFTER it is captured in `runTool` closure — TDZ-style stale read

- **Severity**: critical
- **Category**: race-condition
- **File**: `src/features/agents/sub_tool_runner/useToolRunner.ts:78-111`
- **Scenario**: Component first render: `useToolRunner(personaId="A")` runs. The `runTool` `useCallback` body references `personaIdRef.current` (lines 86, 95). The `useRef` declaration is at line 108 — *below* the `useCallback`. While JS hoists `let`/`const` differently than `var`, the ref *value* is initialised on the first call to `useRef` which occurs every render. On the **first render**, `personaIdRef` is fresh and equals `personaId`. On **subsequent renders**, `useEffect` at line 109 updates `.current` *after paint*. If a tool result resolves between commit and effect-flush (microtask vs macrotask interleaving), `personaIdRef.current` may still hold the *previous* personaId — meaning the stale-result guard `runPersonaId !== personaIdRef.current` either falsely accepts a stale write OR falsely rejects a valid one.
- **Root cause**: Effect-synchronised refs are an anti-pattern for cross-render comparison; the closure already captured `personaId` directly via the `useCallback` deps. The `personaIdRef` indirection adds a one-render-of-skew window.
- **Impact**: When the user switches personas at the moment a tool result resolves, the result may either land in the wrong persona's panel (cross-persona bleed — exactly what the comment claims to prevent) or be dropped from the correct persona. Reproducible under fast persona switching.
- **Fix sketch**: Drop the ref entirely. Compare `runPersonaId` against the latest `personaId` captured by re-creating the callback on every change (already happens — `personaId` is in the deps). Or use a `useSyncExternalStore`-style snapshot.

## 3. Polling-mechanism delivers a "completed" message for FAILED experiments

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/agents/sub_chat/hooks/useExperimentBridge.ts:171-211`
- **Scenario**: A matrix experiment is started. The Tauri event listener misses the `lab-matrix-status` `failed` event (e.g. listener attached after the event fired during session restore). The 30s poll fires, sees the run is no longer in `lab_get_active_progress`, and unconditionally calls `deliverExperimentResult(exp, "completed", null, undefined)`.
- **Root cause**: "Not in active list" is conflated with "completed successfully". A failed/cancelled/errored experiment also drops out of the active list.
- **Impact**: The chat thread shows a celebratory "Experiment Complete" message when the experiment actually failed. The user may make decisions based on a non-existent successful result. No way for the user to discover this is a lie short of opening the Lab tab.
- **Fix sketch**: Either fetch the actual run status from a `lab_get_run_status(runId)` command before delivering, or deliver as "Experiment finished — open Lab tab for results" with no claim about success.

## 4. `deliveredRunIds` is a module-level Set with unbounded growth and no cleanup

- **Severity**: medium
- **Category**: latent-failure
- **File**: `src/features/agents/sub_chat/hooks/useExperimentBridge.ts:117-119`
- **Scenario**: Long-running app session. User runs hundreds of experiments over days. Each completed run id is added to `deliveredRunIds` and *never* removed. The Set grows monotonically.
- **Root cause**: Module-level `new Set<string>()` survives component unmount/remount and never shrinks. Worse, on app reload the set is empty — meaning experiments completed in a *previous* session are NOT deduplicated against the polling fallback, and completing-during-restore experiments may be re-delivered (the "delivered" flag lives in memory only, not in working memory).
- **Impact**: Slow memory leak (low impact at small scale); risk of duplicate "Experiment Complete" messages on app restart if working memory still references the run.
- **Fix sketch**: When removing the experiment from working memory, also remove its runId from `deliveredRunIds` (or skip dedup once removed); persist delivered state by removing from working-memory tracking instead.

## 5. JSON operation extraction silently drops huge payloads

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/agents/sub_chat/libs/chatAdvisoryDispatch.ts:127-130`
- **Scenario**: An advisory `edit_prompt` op contains a very large `content` string (>50KB — entirely plausible for a full prompt rewrite). The extractor starts accumulating multi-line JSON, exceeds the 50KB cap, and silently drops the operation with only a `console.warn`.
- **Root cause**: Hard cap with no surfacing to the user. `console.warn` is invisible in production. The user sees the assistant message in chat *without* the operation being applied — looks like the LLM lied about applying changes.
- **Impact**: User believes a major prompt change was applied. It silently wasn't. They may copy-paste the new content elsewhere, ship to production, etc.
- **Fix sketch**: When dropping a large op, inject a synthetic error result into the chat: "Operation `edit_prompt` was too large to parse; please retry with a shorter section." Or raise the cap and parse incrementally.

## 6. `extractOperations` regex `{"op"` matches inside markdown code fences after first toggle

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/agents/sub_chat/libs/chatAdvisoryDispatch.ts:90-104`
- **Scenario**: Assistant message contains a `\`\`\`json` block showing an *example* operation, followed by an actual operation. The accumulator is reset when entering a code block but `inCodeBlock` flips and stays true. The block's closing ``` flips it back to false. Now consider an *unbalanced* fence (LLMs frequently emit unmatched ``` inside long content): the rest of the message is treated as inside-code, so real operation lines after it are skipped.
- **Root cause**: Naive `inCodeBlock` toggle has no recovery for unbalanced fences. LLM output is adversarial input; an unmatched ``` inside a content string is realistic.
- **Impact**: User says "apply this change", LLM emits the operation correctly, but it's swallowed because of an earlier mismatched fence in the same response. Silent no-op.
- **Fix sketch**: Track fence language to detect closing pair (```json ... ``` only), or fall back to per-line operation extraction when the accumulator state seems inconsistent.

## 7. `startNewSession`/`sendMessage` race: persona switch between awaited create and send loses message

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/agents/sub_chat/ChatTab.tsx:142-162`
- **Scenario**: User on persona A clicks Send, no active session. `startNewSession` awaits — during the await the user clicks persona B. The guard at line 158 catches this and `return`s — *but the input was already cleared at line 160*… wait, no: input is cleared AFTER the guard. OK, that's fine. The bug is different: a NEW session was created on persona A's behalf (and is now the latest session for A), but the user message is silently dropped. The user sees their text clear (no — `setInputValue('')` is after the guard; input is preserved). But: the chat for persona A now has an empty session pre-created and no indication of why nothing happened.
- **Root cause**: Side-effect (session creation) cannot be rolled back when the post-await guard rejects the send. Also: `setInputValue('')` happens AFTER the early-return guard, but the user has no signal that the empty session was created.
- **Impact**: Stale empty sessions accumulate on persona A; user is confused why clicking Send did nothing. Lower-impact than initially feared (input is preserved) but still a UX paper cut and a session-list pollution source.
- **Fix sketch**: Either delete the just-created session on persona-switch detection, or surface a toast: "Persona switched — message not sent."

## 8. `useStructuredStream` subscribed to `null` after activeExecutionId clears mid-flight

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src/features/agents/sub_chat/ChatTab.tsx:52-54` (combined with 113-117)
- **Scenario**: `chatStreaming` is true but `activeExecutionId` is null (per the recovery effect at 113). The `useStructuredStream(activeExecutionId, …)` subscription is then re-registered with `null`. If a TodoWrite event arrives (engine still running, just emitted a terminal event late), it has nowhere to go.
- **Root cause**: TodoWrite items captured by the *previous* execution remain in `chatTodos` until manually cleared, but *new* TodoWrite emissions during a recovery-cleared state are silently lost.
- **Impact**: The Plan panel shows stale items from the previous execution after the user starts a new task; or shows nothing for an execution that was force-recovered.
- **Fix sketch**: Clear `chatTodos` in the recovery effect alongside the streaming flags; or pause display when activeExecutionId is null.

## 9. `formatExecutionTable` corrupts data when fields contain whitespace (regex split on `\s{2,}`)

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/agents/sub_chat/libs/chatOpsDispatch.ts:370-391`
- **Scenario**: An execution timestamp formatted by `toLocaleString` like `"Apr 27, 02:15 PM"` contains *single* spaces. The padded text format combined via `padEnd` produces multi-space gaps between *some* fields but the timestamp itself contains commas + single spaces. The split on `/\s{2,}/` splits at the right boundaries — except when a status string is short enough that `padEnd(10)` adds <2 spaces (e.g. `"completed"` is 9 chars + 1 pad = 10 chars + 1 separator = 1 space gap → split fails).
- **Root cause**: Round-tripping data through padded text and back via regex is fragile. Status `"completed"` (9 chars) padded to 10 leaves a single space, then concatenation adds a single space, totalling 2 spaces — passes. But `"failed"` (6 chars) padded to 10 leaves 4 spaces + 1 = 5 → passes. Edge case: a future status name that's exactly 10 chars (e.g. `"processing"`) leaves zero padding chars + 1 separator = 1 space → row corrupts into adjacent column.
- **Impact**: Markdown table rows misalign or drop columns when a 10+-char status is added. Future-fragile.
- **Fix sketch**: Build the markdown table directly from the structured `execs` array rather than parsing the pre-formatted detail string.

## 10. ReplayTheater & ReplaySandbox arrow-key shortcuts hijack page scrolling

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/agents/sub_executions/replay/ReplayTheater.tsx:62-99` and `replay/ReplaySandbox.tsx:57-85`
- **Scenario**: User has scrolled down to view the replay theater, then clicks somewhere outside an `<input>`/`<textarea>` (e.g. the page background). They press ArrowDown to scroll the page — nothing happens because the listener `preventDefault`s for ArrowLeft/Right (not Down/Up, but Space is captured globally even when no replay is visible). When they press Space to scroll, it toggles play/pause instead.
- **Root cause**: Global `window.addEventListener('keydown')` with no scoping check — fires anywhere on the page when the theater is mounted. The input-element guard does NOT cover "clicked outside but theater not focused".
- **Impact**: Annoying UX hijack; pressing space in any non-input context plays/pauses replay. If two replays are open in nested routes both fire.
- **Fix sketch**: Scope shortcuts to a focus-within container ref, or only when the replay element is in viewport.

## 11. `handleFork` swallows JSON parse error with toast — then continues with empty parsedInput, masking real input data

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/agents/sub_executions/replay/ReplaySandbox.tsx:87-108` and `ReplayTheater.tsx:102-129`
- **Scenario**: An execution's `input_data` is non-JSON (corrupted, plaintext, or schema mismatch from an older run). User clicks Fork. Toast says "fork input parse error", but the function continues with `parsedInput = {}` and builds a fork payload that *loses the original input data entirely* — only `__fork_context` remains.
- **Root cause**: Catch falls through instead of aborting. Toast is informational only; user may not connect "I lost my data" to the small toast.
- **Impact**: User believes the fork preserved the original input; in reality, the fork executes against an empty object plus only the synthesized context. The forked execution diverges from the original far more than expected.
- **Fix sketch**: On parse failure, abort the fork (return early) and show a destructive-action confirmation toast: "Original input is not JSON — fork would discard it. Proceed?"

## 12. `useTraceData` race: `executionId` change while in-flight fetch resolves writes wrong trace

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/agents/sub_executions/detail/inspector/useTraceData.ts:16-36`
- **Scenario**: User clicks execution A. Fetch starts. Before it resolves, user clicks execution B. The cleanup sets `cancelled = true` for the A fetch — good. But the second `useEffect` at line 39-46 (`'execution-trace'` listener) and line 49-69 (`'execution-trace-span'` listener) re-register with B's executionId. Meanwhile the *Tauri event subscriptions* `unlisten` calls happen via `unlisten.then(fn => fn())` — which is fire-and-forget, racing the new `listen()` setup. If event emission happens during the 1-2 ms window between B's `listen()` registering and A's old `unlisten` resolving, A's listener may also receive B's event and call `setTrace` with B's data into A's filtered state (no — listener filters on executionId match). Actual bug: the `executionId` in the deps of the fetch effect is missing `personaId` (line 36 `[executionId]` only). If `personaId` changes while `executionId` stays the same (rare), the wrong trace is fetched.
- **Root cause**: Stale closures from missing dep + fire-and-forget `unlisten`. The lint rule for exhaustive deps would flag the `personaId` omission.
- **Impact**: Trace inspector may show data from a different persona's execution if persona changes without execution change. Span events from old subscription could fire briefly during teardown — usually filtered, but adds load.
- **Fix sketch**: Add `personaId` to deps; await `unlisten` resolution by storing the promise and awaiting in cleanup.

## 13. `useExperimentBridge` polling effect re-creates interval on every workingMemory keystroke equivalent

- **Severity**: medium
- **Category**: timing-bug
- **File**: `src/features/agents/sub_chat/hooks/useExperimentBridge.ts:171-211`
- **Scenario**: `workingMemory` is the dep on this effect. Every time the user adds, removes, or modifies *anything* in working memory (any chat message, any context update that touches the JSON), the effect tears down the existing interval and creates a fresh one. The "run immediately on mount" call also re-runs every change.
- **Root cause**: Coarse-grained dep — the effect only really needs to re-evaluate when the *experiments* array within working memory changes, not every byte of working memory.
- **Impact**: `lab_get_active_progress` Tauri command called more often than needed; possible amplification under busy chat sessions. The 30s interval is also reset on each change, meaning a very chatty session could *never* hit the 30s polling interval.
- **Fix sketch**: Memoize a derived `experimentRunIds` string and use it as the dep, or check inside the interval body without re-creating on every workingMemory change.

## 14. `setTimeout` chain in `markCopied` leaks if component unmounts mid-2s window

- **Severity**: low
- **Category**: cleanup-gap
- **File**: `src/features/agents/sub_chat/ChatBubbles.tsx:35-38`
- **Scenario**: User clicks Copy on a chat bubble, then navigates away from the chat tab within 2 seconds. The `setTimeout(() => setCopied(false), 2000)` fires after unmount, calling `setState` on an unmounted component. React 18+ no longer warns but the timer still runs.
- **Root cause**: No cleanup ref tracking. Combined with: the `markCopied` is a `useCallback` with empty deps — but timer handle is not stored. If user clicks Copy twice in quick succession, two timers race; the first reverts to "not copied" while the second is still pending its own 2s window — UI flickers.
- **Impact**: Brief UI flicker on rapid double-click; minor memory hold of the timer callback; harmless setState-after-unmount no-op.
- **Fix sketch**: Store the timer handle in a ref, clear on new copy and on unmount.
