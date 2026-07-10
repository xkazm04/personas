> Context: stores/slices [1/3]
> Total: 8
> Critical: 0  High: 0  Medium: 3  Low: 5

## 1. clearExecutionOutput fires cancelExecution without awaiting → Resume id lost + double teardown
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/stores/slices/agents/executionSlice.ts:673-685 (and cancelExecution 452-488)
- **Scenario**: `clearExecutionOutput` runs while a foreground run is live: `if (activeId && get().isExecuting) get().cancelExecution(activeId)` is called WITHOUT `await`. It then synchronously runs `markCancelled` + `set({ activeExecutionId: null, lastExecutionId is NOT set, ... })`. The un-awaited `cancelExecution` continues; when its `await cancelExecution(...)` resolves, its `finally` reads `lastId = get().activeExecutionId` — now `null` — and does `set({ lastExecutionId: lastId /* null */ })`, plus a second `markCancelled`, a second localStorage remove, a `fetchExecutions`, and (if a chat stream was live) a second `finishChatStream`.
- **Root cause**: Two independent teardown paths mutate the same execution state; `clearExecutionOutput` nulls `activeExecutionId` before the async `cancelExecution` reads it to preserve the Resume id.
- **Impact**: The just-cleared execution's id is lost for "Resume" (overwritten with null), FSM transition + fetch run twice. Data/UX correctness on the abandon-run path.
- **Fix sketch**: Either `await get().cancelExecution(activeId); return;` (let cancelExecution own the full teardown) or capture `lastExecutionId: activeId` inside `clearExecutionOutput` and have `cancelExecution` no-op when `activeExecutionId` is already null.

## 2. backgroundChatSlice.abortFeedbackChat is dead code AND never cancels the backend run
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/stores/slices/agents/backgroundChatSlice.ts:275-290
- **Scenario**: Grepped the whole `src/` tree for `abortFeedbackChat` — the only hit is this slice file (definition + interface). No UI, hook, or event wiring ever calls it, so it is unreferenced. Separately, its body only `releaseCleanup()`s the listeners and marks the slot `"failed"`; it never calls the backend `cancelExecution(cur.executionId, cur.personaId)`, so were it wired up the spawned execution would keep running orphaned (consuming API credits) exactly like the bug `executionSlice.clearExecutionOutput` was written to avoid.
- **Root cause**: Cancel affordance was stubbed for the feedback-chat drawer but the UI hook was never built; the stub also omits the backend cancel call.
- **Impact**: Maintainability (unused action carrying a misleading "abort" name); latent money/resource leak if adopted as-is.
- **Fix sketch**: Delete it, or if a cancel button is intended, wire it and add `await cancelExecution(cur.executionId, cur.personaId)` (guarded on `cur.executionId`) before marking failed.

## 3. Duplicated "extract assistant text from output" snippet in 5 places
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/stores/slices/agents/executionSlice.ts:469-470, 533-534; src/stores/slices/agents/chatSlice.ts:498-499, 519-520; src/stores/slices/agents/backgroundChatSlice.ts:375-376
- **Scenario**: The identical pipeline `output.filter((l) => classifyLine(l) === 'text').join('\n').trim()` is copy-pasted across cancelExecution, finishExecution, the chat status-listener, the chat watchdog, and the background-chat listener. Verified each site imports `classifyLine` and reproduces the same three-step transform.
- **Root cause**: No shared helper for "reduce a terminal output buffer to the assistant's text reply."
- **Impact**: Maintainability — a change to text classification (e.g. trimming rules, a new line class) must be made in 5 spots or they silently drift.
- **Fix sketch**: Add `extractTextResponse(output: string[]): string` next to `classifyLine` (src/lib/utils/terminalColors) and call it from all five sites.

## 4. Approving a twin memory doesn't refresh the readiness corpus
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/stores/slices/system/twinSlice.ts:516-528 (reviewTwinMemory) vs 507-514 (fetchTwinReadinessApproved)
- **Scenario**: `twinReadinessApproved` is deliberately isolated (per its doc comment) as the "approved-only" corpus the readiness score reads. `reviewTwinMemory(id, true, …)` updates only `twinPendingMemories` (maps the reviewed row). It never inserts the newly-approved memory into `twinReadinessApproved`. So right after a user approves a pending memory, the readiness milestone still counts the pre-approval set until `fetchTwinReadinessApproved` is independently re-run.
- **Root cause**: The two lists were split for isolation, but the approve mutation only writes one of them.
- **Impact**: UX — readiness score/milestone under-counts approvals until an unrelated refetch; looks like the approval "didn't take."
- **Fix sketch**: In `reviewTwinMemory`, when `approved === true` and the reviewed memory belongs to the active twin, append/replace it in `twinReadinessApproved` (or call `fetchTwinReadinessApproved(twinId)` after a successful review).

## 5. Failure-trend regression treats non-contiguous active days as evenly spaced
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/stores/slices/overview/personaHealthSlice.ts:146-179 (detectFailureTrend)
- **Scenario**: `dailyRates` is built by pushing a value only for days where the persona had activity (`hasActivity`), so idle days are skipped. The linear regression then uses `x = 0..n-1` over those *packed* indices and reports `slope` as "% change per day". `predictedFailureDays = ceil((currentRate-50)/|slope|)` is presented as calendar days. When active days are sparse (e.g. activity every 3rd day over a 14-day window), the slope is per-active-day, so the day count shown to the user is compressed and wrong.
- **Root cause**: Regression x-axis uses array position instead of the day's real offset within the window.
- **Impact**: UX/analytics — `failureTrend` and `predictedFailureInDays` shown in the health panel mislead on intermittently-active personas.
- **Fix sketch**: Key each rate to its day offset (index of `pt` within `recentPoints`) and regress against those real x-values, or gate the prediction on sufficiently dense activity.

## 6. handleBuildSessionStatus skips the phase-changed broadcast when session_id is absent
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:763-790
- **Scenario**: The state write uses `updateSessionInState(state, event.session_id, …)`, which falls back to `state.activeBuildSessionId` when `event.session_id` is null/empty — so the active session's `phase`/`progress` still update. But the post-commit broadcast reads `get().buildSessions[event.session_id]` directly (no fallback); with an absent `session_id` this is `undefined`, so `storeBus.emit('build:phase-changed', …)` never fires even though the phase actually changed. Downstream consumers (sidebar draft-phase indicators, tour `build:phase-changed` handlers) miss the transition.
- **Root cause**: The state update path and the emit path resolve the target session differently.
- **Impact**: UX — a phase change lands in state but isn't announced on the bus for the active session in the (defensive) no-session_id case; inconsistent with every other handler that keys on `event.session_id`.
- **Fix sketch**: Resolve the target once: `const targetId = event.session_id ?? get().activeBuildSessionId;` and use it for both the update and the emit lookup.

## 7. selectTeam / deleteTeam duplicate the full team-detail reset object
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/stores/slices/pipeline/teamSlice.ts:89-92, 144-152
- **Scenario**: Both `selectTeam` and `deleteTeam` inline the same 9-field reset (`teamMembers: [], teamConnections: [], teamMemories: [], teamMemoriesTotal: 0, teamMemoryStats: null, memoryFilterCategory: undefined, memoryFilterSearch: undefined, memoryFilterRunId: undefined`). A future field added to team-detail state must be remembered in both.
- **Root cause**: No named constant/helper for "clear the team-detail sub-state."
- **Impact**: Maintainability — easy to update one site and not the other, leaving stale detail state on delete-vs-select.
- **Fix sketch**: Extract `const TEAM_DETAIL_RESET = { … } as const;` (or a `clearTeamDetail()` partial) and spread it in both.

## 8. Recovered-execution "clear stale state" block triplicated
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/stores/slices/agents/executionSlice.ts:246-250, 736-740, 753-755
- **Scenario**: The sequence `logger.info(...); executionLifecycle.markFinished(set); set({ activeExecutionId: null, lastExecutionId: <id>, executionPersonaId: null, isExecuting: false }); try { localStorage.removeItem('personas:active-execution'); } catch …` appears in the store-init reconciliation, `retryExecutionVerification`, and `dismissVerificationFailure`.
- **Root cause**: No shared "finalize a recovered execution" helper.
- **Impact**: Maintainability — the localStorage key and the exact reset set must stay in sync across three copies.
- **Fix sketch**: Extract a closure-local `finalizeRecovered(execId: string)` and call it from all three sites.
