# Ambiguity Audit — Execution Engine (frontend)

> Total: 11 findings (1 critical, 4 high, 5 medium, 1 low)
> Files read: ~5
> Scope: Frontend execution shell (ExecutionMiniPlayer, PipelineDots, PreRunPreview) + Zustand `processActivitySlice` — assumptions about long-running ops, scheduler/queue behavior, and engine-state sync.

## 1. `enrichProcess` ignores `runId`, silently mutates the wrong process

- **Severity**: critical
- **Category**: edge-case
- **File**: src/stores/slices/processActivitySlice.ts:220-239
- **Scenario**: `enrichProcess(domain, updates)` calls `findProcessKey(state.activeProcesses, domain)` without ever forwarding a `runId`. When two runs share the same `domain` (e.g. two `"execution"` rows), the prefix-fallback in `findProcessKey` (line 135) returns the *first* `domain:*` key from `Object.keys`, which is iteration-order dependent.
- **Root cause**: Unlike `processEnded` (which uses the strict `findUniqueProcessKey` and refuses on ambiguity) and `updateProcessStatus` (which accepts `opts.runId`), `enrichProcess` has no signature path for the runId at all. The "fallback rules" comment on `findProcessKey` (line 121) acknowledges symmetry between the two but the call here bypasses the safety net.
- **Impact**: Cost/tool-call counters and `lastEvent` strings get attributed to whichever active run was inserted first — silent cross-attribution. Two concurrent executions look fine in the UI but their telemetry is scrambled, and the bug is undetectable from the activity dock.
- **Fix sketch**:
  - Add an optional `runId?: string` argument to `enrichProcess` and thread it through `findProcessKey`.
  - Adopt the `findUniqueProcessKey`-style refusal when the runId is omitted and >1 row matches.
  - Add a regression test covering "two executions, enrich one, the other's counters do not move."

## 2. `clearNonActive` wipes `recentProcesses` unconditionally — undocumented contract

- **Severity**: high
- **Category**: undocumented-decision
- **File**: src/stores/slices/processActivitySlice.ts:305-316
- **Scenario**: The doc-comment on `clearNonActive` (lines 75-85) describes only the `activeProcesses` filter ("removes every non-running entry"). The implementation also resets `recentProcesses: []` (line 314) — the "last 10 completed" history. A reader of just the interface contract would not expect history-erasure.
- **Root cause**: The contract advertises one behavior (filter active map) and the body silently performs a second (truncate recent history). No comment explains why both are tied together, or what UI gesture should keep them tied.
- **Impact**: A future caller adding "clear active dock" to a button (e.g. "Hide finished executions") will unknowingly destroy the recent-process audit trail. Conversely, anyone trying to preserve history while clearing active rows has no API to do so.
- **Fix sketch**:
  - Update the JSDoc to explicitly list both side-effects, or split into `clearNonActive()` + `clearRecent()`.
  - Add a test asserting `recentProcesses` is cleared so the coupling is intentional, not accidental.

## 3. `processQueued` clobbers `toolCallCount`/`costUsd` of an already-running process

- **Severity**: high
- **Category**: edge-case
- **File**: src/stores/slices/processActivitySlice.ts:262-283
- **Scenario**: `processQueued` writes a fresh entry at `key`, preserving `existing.startedAt` and `existing.label` but **resetting** `toolCallCount: 0` and `costUsd: 0` (lines 275-276). If an out-of-order event delivers `processQueued` *after* `processStarted` (network race, retry, replay), the running execution's accumulated metrics are zeroed.
- **Root cause**: The function assumes "queued" only ever precedes "running", but offers no guard (`if (existing?.status === 'running') return state;`). Nothing in the slice or its tests pins down the legal status transitions — it's tribal.
- **Impact**: Cost-budgeting telemetry resets mid-flight; `MAX_BUDGET` checks downstream make decisions on under-counted spend. Hard to reproduce because it requires an event-order anomaly.
- **Fix sketch**:
  - Add an FSM table (states × events → next state) as a doc-comment.
  - Guard `processQueued` against transitions from `running`/`completed`/`failed`/`cancelled` and warn.
  - Cover the race with a unit test that fires `started → queued` and asserts metrics are preserved.

## 4. Mini-player drag clamp uses width=360 but layout reserves 380

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/execution/components/ExecutionMiniPlayer.tsx:179-217
- **Scenario**: The first-pin position uses `window.innerWidth - 380` (line 181). The drag-clamp uses `window.innerWidth - 360` (line 216). The element class is `w-[360px]` (line 260). Three numbers, two of them constants in code, one in a Tailwind class.
- **Root cause**: Width is hard-coded in three places without a shared constant. The `380` is presumably "width + a margin" but nothing says so.
- **Impact**: Changing the mini-player width requires hunting through three sites; missing one yields visual misalignment (overflow on first pin) or a jumpy first-drag. The "20 px gap" is unexplained.
- **Fix sketch**:
  - Extract `MINI_PLAYER_WIDTH = 360` and `MINI_PLAYER_RIGHT_INSET = 20` as named constants near the top of the file.
  - Use them in style/class via inline `style.width` or a CSS variable.

## 5. `handleStop` only stops the *foreground* execution; background array is unreachable

- **Severity**: medium
- **Category**: requirements-unclear
- **File**: src/features/execution/components/ExecutionMiniPlayer.tsx:231-235, 316-332
- **Scenario**: The header stop button calls `cancelExecution(activeExecutionId)` for the single foregrounded run. The background-executions strip (lines 316-332) renders status dots per `bg.executionId` but no UI lets the user cancel one. Tooltip is read-only; no click handler.
- **Root cause**: It's unclear whether background executions are *intentionally* uncancellable (design decision) or simply un-implemented. No comment, no roadmap pointer.
- **Impact**: Users with a runaway background run cannot stop it from the mini-player and have to navigate to the agent detail page. Future maintainers will guess the intent and risk implementing the wrong behavior.
- **Fix sketch**:
  - Document the decision: "background executions are managed from the agent detail view; mini-player only controls the foreground run."
  - Or add a click handler that calls `cancelExecution(bg.executionId)`.

## 6. `PreRunPreview` Enter key fires `onConfirm` regardless of focus or missing-credentials state

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/execution/components/PreRunPreview.tsx:52-59
- **Scenario**: A global `keydown` listener calls `onConfirm()` on `Enter` and `onCancel()` on `Escape` while the preview is mounted. There is no guard that focus is inside the dialog, no check on `check.missingCredentials.length > 0`, and no `e.preventDefault()`. The "Run Agent" button is not disabled when credentials are missing.
- **Root cause**: The keyboard shortcut treats the preview as a confirmation modal but ignores the warning state shown by `check.missingCredentials` (line 128) and the `check.reasons` block (line 143). Pressing Enter while typing in another field anywhere on the page (the listener is on `document`) triggers the agent run.
- **Impact**: User opens the preview, sees "needs credential", switches to another field to fix it, hits Enter — the agent runs with missing creds. Also: any form submission elsewhere in the page sees its Enter swallowed by this listener.
- **Fix sketch**:
  - Skip the handler when `e.target` is outside `panelRef.current`.
  - Disable confirm (and the Enter shortcut) when `check.missingCredentials.length > 0`, with a tooltip explaining why.
  - Call `e.preventDefault()` to prevent double-handling.

## 7. `PipelineDots` "isLast pulsing" assumes spans iterate in chronological order

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/execution/components/PipelineDots.tsx:13-28
- **Scenario**: `lastStage` is computed by iterating `trace.spans` and overwriting `last` on every iteration (line 24). The visual "blue pulsing dot" depends entirely on the *array order* of `spans` — not on `started_at`/`ended_at` timestamps.
- **Root cause**: The contract of `UnifiedTrace.spans` ordering is not stated here. If the engine ever emits spans out-of-order (parallel stages, retries, healing-event re-spans) the wrong dot pulses.
- **Impact**: Status-indicator misrepresents the active stage. Users debugging slow stages chase the wrong stage. The bug is silent — UI looks plausible.
- **Fix sketch**:
  - Sort by `started_at` (or filter to the latest non-completed pipeline-stage span) before picking `lastStage`.
  - Document the sort assumption, or move the responsibility into a `pipelineLatestStage(trace)` helper in `lib/execution/pipeline.ts`.

## 8. `traceProgress` fraction is unevenly weighted but the bar implies linear progress

- **Severity**: medium
- **Category**: trade-off-hidden
- **File**: src/lib/execution/pipeline.ts:677-698 (consumed at ExecutionMiniPlayer.tsx:243-246, 89-94)
- **Scenario**: `fraction = (idx + 1) / PIPELINE_STAGES.length` treats all 7 stages as equal-width slices. In reality `stream_output` (the LLM call + tool loop) typically dominates wall-clock time — often >90%. The bar therefore jumps to ~71% almost immediately and lingers there for the actual work.
- **Root cause**: An unweighted average is being shown as a "progress bar" without acknowledging the model. No comment explains why this is acceptable, or what the user signal should be during the long stage.
- **Impact**: Simple-mode users see a near-full bar and assume the run is almost done — actual completion is many minutes later. Erodes trust in any future progress UX.
- **Fix sketch**:
  - Either weight stages (e.g. stream_output gets 0.6 of the bar) or switch to indeterminate mode while inside `stream_output` and use elapsed-time-vs-budget instead.
  - Document the chosen model so future devs don't innocently "fix" the apparent linearity.

## 9. `isLast` ignores `trace.completedAt` set on the wrong end

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/execution/components/PipelineDots.tsx:35
- **Scenario**: `isLast` is `true` when `lastStage === stage && trace && !trace.completedAt`. A trace that completes with an *error* mid-pipeline still sets the error flag on the span, but it's unclear whether `completedAt` is populated on cancellation/failure paths or only on graceful finish.
- **Root cause**: The contract of `UnifiedTrace.completedAt` (set only on success? on any terminal state?) is not documented at the call site. The error path collides with the pulsing path: a failed run could keep the last stage pulsing forever if `completedAt` stays null.
- **Impact**: A failed execution leaves a perpetually-pulsing dot in the mini-player after the run is over. Misleading state until the user navigates away.
- **Fix sketch**:
  - Read state from the parent: `isExecuting` is already passed to `StatusIndicator` — pass it (or a `isTerminal` flag) into `PipelineDots` and use it to suppress pulsing.
  - Document `UnifiedTrace.completedAt` semantics in `pipeline.ts`.

## 10. `recentProcesses` 10-item cap is invisible to consumers

- **Severity**: low
- **Category**: magic-number
- **File**: src/stores/slices/processActivitySlice.ts:89, 214
- **Scenario**: `MAX_RECENT = 10` lives in the slice and is enforced only inside `processEnded`. The `recentProcesses: ActiveProcess[]` interface comment (line 48) hand-waves "last 10 completed" — but this constant is private to the file.
- **Root cause**: A behavior consumers depend on (sized history) is enforced silently. A future contributor adding e.g. `processFailedFast` who pushes onto `recentProcesses` directly will break the cap with no compiler signal.
- **Impact**: Hard-to-spot bugs in audit-history UI; potential memory growth if the cap is bypassed in a new code path.
- **Fix sketch**:
  - Export `MAX_RECENT_PROCESSES` and reuse in any caller that mutates `recentProcesses`.
  - Wrap mutations in a single helper (`pushRecent`) that enforces the cap.

## 11. `processStarted` resets `toolCallCount`/`costUsd` even when re-entering an existing key

- **Severity**: high
- **Category**: edge-case
- **File**: src/stores/slices/processActivitySlice.ts:181-198
- **Scenario**: `processStarted` writes `toolCallCount: 0, costUsd: 0` unconditionally. It *does* preserve `label` and `navigateTo` from the prior entry (lines 189, 194), suggesting awareness of re-entry. Counters are not preserved.
- **Root cause**: The semantics of "what does it mean for `processStarted` to fire on a key that already has a `running` row?" is not specified. Is it idempotent (preserve all)? A restart (reset all)? A label refresh (preserve metrics)? The asymmetric preservation suggests no one decided.
- **Impact**: A reconnect/replay path that re-emits `processStarted` will silently zero in-flight metrics — same blast radius as finding #3 but on a different code path.
- **Fix sketch**:
  - Define and document the policy: probably "if `existing.status === 'running'`, no-op (return state)" — i.e. true idempotence.
  - Add a test for `started → started` preserving metrics.
