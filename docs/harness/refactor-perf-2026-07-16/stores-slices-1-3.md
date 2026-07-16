# stores/slices [1/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Core Libraries & State | Files read: 18 | Missing: 0

## 1. ~950 lines of static tour content embedded in the tour store slice (plus a dead back-compat export)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/stores/slices/system/tourSlice.ts:228
- **Scenario**: Anyone editing tour copy, narration, or step wiring must open a 1,579-line Zustand slice where ~60% of the file is static data (9 tour definitions, sub-steps, and spoken narration strings from line 228 to ~971) and only the tail is actual state logic. Content edits and state-machine edits collide in the same file, and the pending i18n extraction (noted in the file itself) will make the data block churn further.
- **Root cause**: `GETTING_STARTED_STEPS` … `OBSIDIAN_BRAIN_STEPS` and `TOUR_REGISTRY` are pure declarative content but were grown in place inside the store slice instead of a data module. Additionally, `export const TOUR_STEPS = GETTING_STARTED_STEPS` (line 974) is labeled "backward compat" and has zero importers anywhere in `src/` (verified by grep) — dead export.
- **Impact**: Maintenance hazard on a file that several onboarding surfaces depend on; every content tweak produces a large diff in state-management code. The dead `TOUR_STEPS` export suggests the compat window closed and invites accidental reuse of a stale alias.
- **Fix sketch**: Move the step arrays + `TOUR_REGISTRY` (and `getTourById`/`getActiveTourSteps`) into e.g. `src/features/onboarding/tourDefinitions.ts` (or `src/stores/slices/system/tourDefinitions.ts` to avoid an import-direction change), re-export the types from the slice for existing consumers, and delete `TOUR_STEPS`. Pure mechanical move — no behavior change; also positions the tracked i18n extraction to touch only the data module.

## 2. Chat execution-listener plumbing duplicated between chatSlice and backgroundChatSlice — and the copies have diverged (background copy lacks the watchdog)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/stores/slices/agents/backgroundChatSlice.ts:331
- **Scenario**: `setupChatExecListeners` (chatSlice.ts:440) and `setupBackgroundExecListeners` (backgroundChatSlice.ts:331) implement the same machine: dynamic-import `listen`/`EventName`/`isTerminalState`/`classifyLine`, attach EXECUTION_OUTPUT + EXECUTION_STATUS listeners keyed by execution id, extract text lines on terminal status, persist the assistant message, and clean up — with a setup-failure fallback in both. The foreground copy gained a 20-minute `CHAT_STREAM_WATCHDOG_MS` safety net for backend stream death (chatSlice.ts:515); the background copy never did. If the engine dies mid-run without emitting a terminal status, a feedback chat stays "running" in the ProcessActivityDrawer forever, its `activeCleanups` entry and Tauri listeners leak for the session, and the notification never fires.
- **Root cause**: The background flow was forked from the foreground listener code before the watchdog fix landed; there is no shared helper, so the hardening applied to one copy silently missed the other.
- **Impact**: Classic fix-one-copy divergence — a reliability guarantee the codebase already decided it needs exists on only one of two structurally identical paths, and future fixes (e.g. status parsing changes) must be applied twice.
- **Fix sketch**: Extract a shared `attachExecutionTerminalListeners({ executionId, onOutputLine?, onTerminal, watchdogMs })` helper (e.g. `src/lib/execution/execListeners.ts`) that owns the dynamic imports, listener wiring, watchdog, aborted-setup guard, and cleanup; have both slices pass their finalize callbacks. At minimum, port the watchdog (finalize as `'incomplete'`) into `setupBackgroundExecListeners`.

## 3. Text-response extraction snippet duplicated at 5 call sites
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/stores/slices/agents/executionSlice.ts:515
- **Scenario**: `output.filter((l) => classifyLine(l) === 'text').join('\n').trim()` appears verbatim in executionSlice.cancelExecution (:515), executionSlice.finishExecution (:580), chatSlice status listener (:498), chatSlice watchdog (:519), and backgroundChatSlice terminal handler (:375). This expression IS the contract for "what text becomes the persisted assistant reply", so all five must stay identical.
- **Root cause**: The extraction was inlined each time a new finalize path was added instead of being named once.
- **Impact**: A future change to line classification or joining (e.g. preserving markdown blocks, filtering tool echoes) must be found and applied in five places; missing one silently diverges what gets saved as the chat answer on that path.
- **Fix sketch**: Add `export function extractTextResponse(lines: string[]): string` next to `classifyLine` in `src/lib/utils/terminalColors.ts` (or in `src/lib/execution/executionState.ts`) and replace the five inline copies.

## 4. handleBuildProgress commits a full store update per streamed output line — build output has no batching, unlike executions
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:740
- **Scenario**: During an active agent build, every `progress` event (one per CLI output line — these stream continuously for the duration of a multi-minute build) runs `handleBuildProgress`, which copies the session's `outputLines` array (up to 500 entries), allocates a new session object, a new `buildSessions` record, and a fresh 32-key `ScalarsProjection`, then notifies every subscriber of the agent store. Any component selecting `buildOutputLines` (or any non-primitive scalar mirror) re-renders per line.
- **Root cause**: Execution output solved this exact problem with `executionSink` (batched flushes into the store); build-session output writes through the generic `updateSessionInState` path with no coalescing, so each line is a discrete store commit plus the mirror-projection rebuild that the no-op short-circuit (line 504) cannot skip, since the session genuinely changed.
- **Impact**: Sustained allocation + subscriber-notification churn on a hot streaming path while the user is watching the build UI (the moment perceived responsiveness matters most); cost scales with output rate × number of scalar-mirror consumers (~50 files per the file's own note).
- **Fix sketch**: Coalesce progress lines before committing: buffer `{sessionId → pendingLines[]}` module-locally and flush via a ~50–100 ms `setTimeout`/rAF into one `updateSessionInState` call (mirroring the executionSink pattern), keeping `activity`/`percent` updates in the flush. Alternatively route build output through a second `executionSink`-style instance. No API change for consumers.

## 5. Fired-alert persistence retry has no in-flight guard — pending alerts re-POST every eval cycle
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: data-layer
- **File**: src/stores/slices/overview/alertSlice.ts:345
- **Scenario**: When `api.createFiredAlert` fails (or is merely slow), the alert id stays in `pendingSyncAlertIds`, and the next `evaluateAlertRules` cycle fires `createFiredAlert` again for every pending alert. The id is only removed when a promise resolves — nothing marks an attempt as in flight — so with a slow/backed-up IPC each eval cycle stacks another concurrent `createFiredAlert` call per pending alert, and if the backend does not upsert by client-generated id, duplicate fired-alert rows land in history.
- **Root cause**: The retry loop at the top of `evaluateAlertRules` iterates `pendingSyncAlertIds` and issues fire-and-forget calls without an inflight set or backoff.
- **Impact**: Redundant IPC amplification exactly when the backend is struggling (N pending × M overlapping cycles), plus possible duplicate persisted alerts; bounded by MAX_ALERT_HISTORY and eval cadence, hence Low.
- **Fix sketch**: Keep a module-local `inflightAlertSyncIds: Set<string>`; skip ids already in flight, add before calling `createFiredAlert`, and delete in both `.then` and `.catch`. Optionally cap retries per alert (e.g. give up after 5 cycles and drop from pending with a breadcrumb).
