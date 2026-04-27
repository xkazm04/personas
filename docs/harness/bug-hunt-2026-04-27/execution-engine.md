# Bug Hunt — Execution Engine (frontend)

> Total: 13 | Critical: 1 | High: 5 | Medium: 5 | Low: 2

## 1. Mini-player position never recovers when window shrinks below stored coords

- **Severity**: high
- **Category**: edge-case
- **File**: `src/features/execution/components/ExecutionMiniPlayer.tsx:160-167`
- **Scenario**: User pins the mini-player at (1800, 900) on a wide monitor, closes the laptop lid, reopens on a 1366x768 display. The position-init `useEffect` only runs when `miniPlayerPosition.x === -1`, so the persisted (1800, 900) survives — placing the player off-screen with no way to drag it back since the drag header is invisible.
- **Root cause**: Position is stored persistently but never reconciled against the current viewport on mount or on `resize` events. The `-1` sentinel is treated as "first run only".
- **Impact**: User loses access to Stop/Unpin/Expand controls; they must clear localStorage or know to dispatch `setMiniPlayerPosition` from devtools to recover.
- **Fix sketch**: On mount/resize, clamp `x` to `[0, innerWidth-360]` and `y` to `[0, innerHeight-80]` (same bounds as the drag handler).

## 2. `cancelExecution` fires with a stale `activeExecutionId` after rapid completion

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/execution/components/ExecutionMiniPlayer.tsx:213-217`
- **Scenario**: Execution A finishes; React commits new state with `isExecuting=false` but the user already clicked Stop in the same React batch. The Stop button's render with `isExecuting && activeExecutionId` hid it — but if `cancelExecution` is also called from a queued event handler that captured the previous closure, it cancels the wrong (now-completed) ID, or worse, a freshly-promoted execution B that just took over `activeExecutionId`.
- **Root cause**: `handleStop` reads `activeExecutionId` from the closure but is not memoized; a new `cancelExecution(id)` for the wrong id is silently accepted by the store with no state-machine guard.
- **Impact**: User clicks Stop and the *next* execution gets cancelled instead of the visible one; or a no-op cancel is logged as success.
- **Fix sketch**: Have `cancelExecution` validate `(executionId === currentlyExecutingId && status === 'running')` before acting; show a transient "already finished" toast otherwise.

## 3. PreRunPreview Enter/Escape global handlers run for every keystroke in any input

- **Severity**: high
- **Category**: edge-case
- **File**: `src/features/execution/components/PreRunPreview.tsx:52-59`
- **Scenario**: User opens the run-preview popover, focuses an unrelated text input elsewhere on the page (e.g. a chat composer in a parent layout), and types a message. Pressing Enter to send the chat message instead fires `onConfirm()` — launching the agent run — because the keydown handler is bound to `document` with no target check or `e.defaultPrevented` guard.
- **Root cause**: Bare `document.addEventListener('keydown', ...)` ignores focus context. Same handler fires Escape from a modal dialog underneath, silently double-cancelling.
- **Impact**: Accidental agent runs (potentially costing money and triggering side-effecting tools) from chat-typing while preview is mounted.
- **Fix sketch**: Check `e.defaultPrevented`, and skip when `document.activeElement` is INPUT/TEXTAREA/contentEditable; or scope the listener to the panel ref with `tabIndex={-1}`/`autoFocus`.

## 4. `useClickOutside` + Escape handler double-fires `onCancel`, racing with `onConfirm`

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/execution/components/PreRunPreview.tsx:50,55`
- **Scenario**: User presses Enter to confirm. `onConfirm` triggers parent state changes that unmount the preview; meanwhile if the parent does anything that causes a synthetic blur/click (focus shift), `useClickOutside` fires `onCancel` after the unmount-in-flight, leading to "started then cancelled" depending on which effect wins.
- **Root cause**: Two independent dismissal paths (Escape, click-outside) plus a confirm path with no "already dismissing" guard. Parent passes raw callbacks; nothing prevents both running.
- **Impact**: An execution can briefly start and then be cancelled, or the parent state goes inconsistent (preview hidden but run aborted server-side).
- **Fix sketch**: Wrap with a `dismissedRef` flag; first handler to fire flips it and subsequent ones early-return.

## 5. Mouse-drag listeners can be orphaned if the component unmounts mid-drag

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/execution/components/ExecutionMiniPlayer.tsx:191-211`
- **Scenario**: User starts dragging the mini-player; while mid-drag, execution completes and `hasContent` flips false, so the `if (!miniPlayerPinned || !hasContent) return null;` short-circuit (line 231) unmounts the component. The `useEffect` cleanup runs and removes listeners — but `setIsDragging(false)` was never called, and `dragStart.current` retains stale coords. The next time the player remounts (next execution), `isDragging` is fresh-`false` so it's fine — *but* if the unmount happens after `mouseup` was missed for any other reason, the document gets stuck with `cursor-grabbing` styles via Tailwind's hover state propagation.
- **Root cause**: `isDragging` lifecycle is not coupled to mount lifecycle; cleanup removes listeners but doesn't reset state.
- **Impact**: Cursor jank, potential listener leak if the cleanup function captures an outdated `setIsDragging`.
- **Fix sketch**: Track drag state in a ref; on unmount-while-dragging, fire a synthetic mouseup. Add `pointercancel` listener.

## 6. `lastStage` calculation assumes spans are temporally ordered

- **Severity**: medium
- **Category**: latent-failure
- **File**: `src/features/execution/components/PipelineDots.tsx:14-28`
- **Scenario**: Pipeline trace events arrive out-of-order over IPC (common with parallel stages or async batching). The loop sets `last = ps` on every iteration, so `lastStage` reflects whichever pipeline span happened to be appended last to the array — not the actually-most-recent stage. The pulsing blue "currently running" dot lights up on the wrong stage.
- **Root cause**: No ordering by `startTime`/`endTime`; the code conflates "last in array" with "most recent in time".
- **Impact**: Misleading progress indication; users debugging perceive the wrong stage as stuck.
- **Fix sketch**: Sort spans by `startTime` (or filter to spans without `endTime` for "active") before deriving `lastStage`.

## 7. `Tooltip` wrapper receives `key` instead of the inner `<div>` getting it

- **Severity**: medium
- **Category**: state-corruption
- **File**: `src/features/execution/components/PipelineDots.tsx:38-52`
- **Scenario**: The `key={stage}` prop is set on the inner `<div>`, but the iteration root is the `<Tooltip>`. React's reconciliation keys the *list elements*, which here are the Tooltips — they all share an implicit array index. If `PIPELINE_STAGES` ever reorders (e.g. feature-flagged stage added), Tooltip state (open/closed, hover handlers) gets reassigned to the wrong dot.
- **Root cause**: `key` is on the wrong element. React warns at runtime ("each child in a list should have a key") because Tooltip is the iteration root.
- **Impact**: Console warning spam + potential tooltip showing wrong stage label after stage list mutation.
- **Fix sketch**: Move `key={stage}` onto `<Tooltip>`.

## 8. `useEffect` clipboard `setTimeout` leaks when component unmounts mid-toast

- **Severity**: low
- **Category**: cleanup-gap
- **File**: `src/features/execution/components/ExecutionMiniPlayer.tsx:50-56`
- **Scenario**: User clicks Copy, then unpins the mini-player within 2s. The `setTimeout` fires `setCopied(false)` on an unmounted component. React 19 silently no-ops state setters on unmounted components, but the timer still holds the closure and `executionOutput` array in memory until it fires.
- **Root cause**: Unmanaged `setTimeout` in a `useCallback`; no cleanup ref.
- **Impact**: Minor memory pressure; in dev mode, occasional "set state on unmounted" warnings.
- **Fix sketch**: Track the timer in a ref and clear on unmount.

## 9. `processEnded` prefix-fallback can reap the wrong row when domain has multiple runs

- **Severity**: critical
- **Category**: state-corruption
- **File**: `src/stores/slices/processActivitySlice.ts:127-139,169-186`
- **Scenario**: Two concurrent executions — `execution:abc123` and `execution:def456` — both running. A buggy caller fires `processEnded("execution", "completed")` *without* a `runId` (e.g. a generic "all done" event from a stale subscription). `findProcessKey` falls back to `Object.keys(...).find(k => k.startsWith("execution:"))`, which returns *whichever key JS hashing puts first* — almost always `execution:abc123`. The wrong run is marked completed and disappears from the dock, while the actually-finished run keeps showing as `running` forever.
- **Root cause**: Prefix fallback was intended to handle "callers that started without a runId then got enriched with one"; it provides no safety when multiple runs share a domain. The doc-comment acknowledges the leak it solved but doesn't address this inverse leak.
- **Impact**: Data corruption in activity dock — `running` row that never clears (the *real* completed run is gone, the still-running label says "completed" briefly then is purged). Compounds with #11 below.
- **Fix sketch**: When multiple `domain:*` keys exist and `runId` is missing, refuse the prefix fallback and warn — force callers to supply runId, or treat domain-level end as "end all matching".

## 10. `processStarted` resets `toolCallCount` and `costUsd` on restart, losing partial telemetry

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/stores/slices/processActivitySlice.ts:150-167`
- **Scenario**: A queued execution gets promoted via `processPromoted` (preserves cost/tool counts since they were 0 anyway). But if a caller fires `processStarted` for an existing key (e.g. retry after `failed`), the spread *replaces* `toolCallCount` and `costUsd` with 0 while preserving `label`/`navigateTo`. Partial costs already incurred during a previous run attempt are silently zeroed.
- **Root cause**: Asymmetric merge — some fields fall back to existing, others hard-reset, with no documented contract.
- **Impact**: Cost tracking under-reports; budget enforcement can be bypassed by triggering retries.
- **Fix sketch**: Either fully reset (new run = clean slate, drop old key first) or fully preserve telemetry across restart. Document which.

## 11. `processQueued` overwrites a running process with `queued` status

- **Severity**: high
- **Category**: state-corruption
- **File**: `src/stores/slices/processActivitySlice.ts:230-251`
- **Scenario**: Execution `exec:xyz` is `running`. A late-arriving "queued" event for the same `(domain, runId)` (e.g., from a stale scheduler retry, or out-of-order IPC) calls `processQueued("execution", "xyz", ...)`. The code unconditionally overwrites the entry with `status: "queued"`, `toolCallCount: 0`, `costUsd: 0`, wiping the running state and live telemetry.
- **Root cause**: No status-transition validation. The FSM allows `running → queued` even though that's nonsensical.
- **Impact**: A live execution suddenly shows as queued, loses its cost/tool counters, and the user may try to start it again. Combined with #9, this can corrupt the activity dock unrecoverably.
- **Fix sketch**: Reject the queued write if `existing.status === 'running' | 'completed' | 'failed' | 'cancelled'`. Add an exhaustive transition guard helper.

## 12. `clearNonActive` wipes `recentProcesses` even when only one process is running

- **Severity**: low
- **Category**: edge-case
- **File**: `src/stores/slices/processActivitySlice.ts:273-284`
- **Scenario**: User has one running execution and 9 recent completed in the history dock. They invoke "clear" (e.g. via dock UI). All 10 history rows vanish, but the doc-comment only mentions clearing non-`running` entries — the user expects history to remain visible since the running one is preserved.
- **Root cause**: `recentProcesses: []` is hardcoded — there's no separate "clear history" vs "clear non-active" distinction; the function name is misleading.
- **Impact**: Surprise data loss in UI. Forensics into recent runs becomes harder.
- **Fix sketch**: Either rename to `clearAllExceptRunning` or split into two actions and call the right one from the UI.

## 13. `executionOutput.map((line, i) => key={i})` re-keys on prepend, breaking copy-state

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/execution/components/ExecutionMiniPlayer.tsx:367-373`
- **Scenario**: `lastLines` is `executionOutput.slice(-30)` — a sliding window. As new output arrives, line at index 0 changes meaning (it's now a *different* line of text). React reconciles by index and reuses DOM nodes, but Tailwind classes from `TERMINAL_STYLE_MAP[classifyLine(line)]` change content while the user has text selected. The selection jumps or breaks; if the user is mid-copy, they get garbage.
- **Root cause**: Index-as-key on a sliding window. Each "line" should have a stable identity.
- **Impact**: Broken text selection in expanded terminal; selection-copy yields wrong text. Also makes `whitespace-pre-wrap break-all` reflows visible as flicker.
- **Fix sketch**: Track line IDs at append time (e.g., monotonic counter in the executionOutput slice) and use those as keys.

