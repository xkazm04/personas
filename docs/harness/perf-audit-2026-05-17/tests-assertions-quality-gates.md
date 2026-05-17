# Perf-Optimizer Scan — Tests, Assertions & Quality Gates

> Project: Personas (frontend-only)
> Scope: 4 paths in src/
> Total: 6 findings (1 critical / 2 high / 2 medium / 1 low)

## Scope notes

All 4 assigned files read in full. Cross-referenced consumers under `src/` via grep
on every exported API and every slice field/action.

Observed (informs all findings below):

- `testSlice` declares 5 data state shapes (`testRuns`, `activeTestResults`,
  `activeTestResultsRunId`, `testSuites`, plus the `isTestRunning` /
  `testRunProgress` pair) and 9 actions, but only 4 fields/actions are actually
  read by UI:
  - `isTestRunning`, `testRunProgress`, `startTest`, `cancelTest` consumed by
    `UseCaseDetailPanel` (via `useUseCaseDetail.ts`) and `UseCaseTestRunner.tsx`.
  - `setTestRunProgress`, `finishTestRun` consumed only by
    `src/hooks/tests/usePersonaTests.ts`.
- Crucially, `usePersonaTests` itself is **never imported or called** anywhere
  outside its own file (verified across `src/` and `lint-output.json`). That
  means the Tauri `test-run-status` listener is never mounted: `setTestRunProgress`
  / `finishTestRun` are unreachable in current shipped UI. Implications are
  called out in finding #1.
- `testRuns`, `activeTestResults`, `activeTestResultsRunId`, `testSuites`,
  `fetchTestRuns`, `fetchTestResults`, `fetchTestSuites`, `createTestSuite`,
  `deleteTestSuite`, `updateTestSuite`, `deleteTest` — zero consumers in `src/`.
- The entire `src/api/agents/outputAssertions.ts` module — `list/get/create/
  update/deleteOutputAssertion`, `getAssertionResultsForExecution`,
  `getAssertionResultHistory` — has zero consumers in `src/`.
- No polling intervals anywhere in scope (test progress is push-based via Tauri
  events, not setInterval). Listener cleanup in `useRunEventListener` is fine
  but it's never mounted, see #1.

## 1. `startTest` flips `isTestRunning=true` but no listener mounts to flip it back — UI gets stuck for 30 minutes
- **Severity**: critical
- **Category**: async-coordination
- **File**: `src/stores/slices/agents/testSlice.ts:70` (startTest), `src/hooks/tests/usePersonaTests.ts:5` (orphan hook), `src/stores/slices/agents/runLifecycle.ts:78` (30-min timeout)
- **Scenario**: User clicks the **Test** button in `UseCaseDetailPanel` /
  `UseCaseTestRunner`. `startTest` invokes `markStarted` which sets
  `isTestRunning=true` and schedules a 30-minute `setTimeout` "safety" reset.
  The intended close-out path is via the `test-run-status` Tauri event handled
  by `usePersonaTests`, which calls `setTestRunProgress` for each phase update
  and `finishTestRun` on terminal phases.
- **Root cause**: `usePersonaTests` is defined but never mounted by any
  component (verified by grep across all of `src/`; only self-reference + a
  lint-output dump). Therefore the event listener is never registered. Progress
  events arrive (they fire from Rust regardless) but nothing in the UI calls
  `setTestRunProgress` or `finishTestRun`. `isTestRunning` stays `true` until
  the 30-minute safety timeout fires (logged as "Safety timeout fired — run may
  have stalled"), at which point an error toast appears.
- **Impact**: Every test run leaves the **Test** button disabled and shows the
  spinner indefinitely (until 30 min). User cannot start another test on any
  use case for that session. The `setTimeout(..., 30*60*1000)` also keeps the
  closure (and `set` reference) alive for 30 min per unfinished run — minor
  memory leak that scales with click count. Cancel path works via
  `cancelTest` only because it directly calls `markCancelled`.
- **Fix sketch**: Mount `usePersonaTests()` once in a root persona shell
  component (e.g. somewhere `selectedPersona` is in scope, alongside other
  `useRunEventListener` consumers). Add a regression test that asserts
  `isTestRunning` returns to `false` after a synthetic `test-run-status`
  terminal event. Optionally, log a one-shot dev-only warning from the
  lifecycle if `markStarted` runs without a listener registration.

## 2. Components subscribe to whole `testRunProgress` object, re-rendering on every progress tick across siblings
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/agents/sub_use_cases/components/core/UseCaseTestRunner.tsx:22`, `src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts:19`
- **Scenario**: While a test is running, the `test-run-status` event (once the
  listener from #1 is mounted) fires every `executing` step — typically per
  scenario × per model. Each event triggers `set({ testRunProgress: { ... } })`,
  producing a brand-new object.
- **Root cause**: Both `useUseCaseDetail` and `UseCaseTestRunner` select
  `s.testRunProgress` whole. Because the object identity changes every tick,
  every parent re-renders. `UseCaseDetailPanel` consumes the return of
  `useUseCaseDetail` flat (no memo), so it re-renders too. The progress UI in
  `UseCaseTestRunner` only ever reads `phase`, `scenarioName`, `current`,
  `total` — yet it gets force-rendered on changes to `scores`, `summary`,
  `scenarios[]`, `runId`, `error`, etc. as well. With N use cases mounted under
  the same persona (use-case list page), every mounted `UseCaseTestRunner` /
  `UseCaseDetailPanel` re-renders on every tick.
- **Impact**: Tests page jank during runs, scaling linearly with mounted
  use-case cards. Also pulls `useUseCaseDetail` (a 230-line hook with many
  `useCallback` deps) into recompute on every tick, even though only the
  progress strip needs to update.
- **Fix sketch**: Replace `s.testRunProgress` with narrow selectors:
  `const phase = useAgentStore(s => s.testRunProgress?.phase)`,
  `const scenarioName = useAgentStore(s => s.testRunProgress?.scenarioName)`,
  `const current = useAgentStore(s => s.testRunProgress?.current)`,
  `const total = useAgentStore(s => s.testRunProgress?.total)`,
  `const runId = useAgentStore(s => s.testRunProgress?.runId)` (used for
  `canCancel`). Move the progress block into its own component subscribed to
  these primitives so the parent panel doesn't re-render at all during a run.

## 3. `mapRunStatusPayload` allocates a new `testRunProgress` object on every event tick, even when nothing visible changed
- **Severity**: medium
- **Category**: re-render
- **File**: `src/hooks/realtime/useRunEventListener.ts:26` (called by `src/hooks/tests/usePersonaTests.ts:19`), state shape declared at `src/stores/slices/agents/testSlice.ts:14`
- **Scenario**: Each `test-run-status` event maps every snake_case payload
  field — including `scenarios?: unknown[]` and `summary?: Record<string, unknown>`
  — into a fresh camelCase object and `set({ testRunProgress })`s it. If the
  Rust side re-emits the same `scenarios` array across ticks (or includes a
  large `summary` blob mid-run), every listener attached to `testRunProgress`
  re-renders because the reference is new.
- **Root cause**: No shallow equality check before `set`, no narrowing of
  payload fields, and `scenarios` is stored on `TestRunProgress` even though
  no UI consumer reads it.
- **Impact**: Combined with #2, this is the engine of per-tick re-renders.
  Even after fixing #2 with narrow selectors, eliminating allocations here
  reduces GC pressure during long runs (e.g. 100-scenario suites).
- **Fix sketch**: In `setTestRunProgress`, do a cheap field-by-field check
  against the previous progress and bail (`set` with no-op) when nothing
  changed. Alternatively, drop `scenarios` from the `TestRunProgress` shape if
  no UI displays it (verified: nothing reads `progress.scenarios`,
  `progress.summary`, `progress.scores`, or `progress.elapsedMs`), so the
  payload mapping can be a much smaller `{ runId, phase, current, total,
  scenarioName, modelId, status, error }`.

## 4. `cancelTest` always transitions to "cancelled" even when the IPC throws — state-machine lie
- **Severity**: high
- **Category**: async-coordination
- **File**: `src/stores/slices/agents/testSlice.ts:89`
- **Scenario**:
  ```ts
  cancelTest: async (runId) => {
    try { await cancelTestRun(runId); }
    catch (err) { reportError(err, "...", set); }
    finally { testLifecycle.markCancelled(set); }
  },
  ```
- **Root cause**: `markCancelled` runs in `finally`, so even if `cancel_test_run`
  throws (run already finished, db locked, IPC timeout from `invokeWithTimeout`,
  etc.), the slice declares the run cancelled, sets `isTestRunning=false`, and
  drops `testRunProgress`. Meanwhile the Rust side may still be executing —
  subsequent `test-run-status` events will arrive and the listener filter
  (`usePersonaTests` line 13: `if (!isTestRunning) return false`) silently
  drops them. Result: the real run keeps consuming model quota, the user sees
  "idle" UI, then a stale terminal event may eventually try (and fail to)
  re-trigger `finishTestRun`.
- **Impact**: Diverges store state from backend reality. Hidden cost: orphaned
  run completes in background, billable LLM calls keep firing, and the user
  can immediately start another run that contends with the lab harness. Pairs
  badly with #1 (no listener mounted) — but is independent of it.
- **Fix sketch**: Move `markCancelled` into the `try` branch (only after
  successful IPC). In `catch`, surface the failure to the user but keep
  `isTestRunning=true` and `testRunProgress` intact so the existing run
  remains accurate. Optionally add an "force-cancel" UI button that calls a
  separate `forceMarkCancelled` action when the user explicitly opts in.

## 5. Dead-code: `outputAssertions.ts` API, `testSuites` CRUD, and `testRuns`/`activeTestResults` state ship to the renderer with zero consumers
- **Severity**: medium
- **Category**: data-layer
- **File**: `src/api/agents/outputAssertions.ts` (entire file), `src/api/agents/testSuites.ts:11-44` (create/update/delete/getTestSuite), `src/stores/slices/agents/testSlice.ts:32-50` (testRuns/activeTestResults/testSuites state + fetch/CRUD actions), `src/api/agents/tests.ts:15-25` (listTestRuns/getTestResults/deleteTestRun)
- **Scenario**: Renderer bundles the full assertions IPC surface (7 functions,
  plus their TS bindings: `OutputAssertion`, `AssertionResult`,
  `ExecutionAssertionSummary`) and the test-history CRUD (5 functions),
  but no UI ever calls them. The slice keeps 3 always-empty arrays in store
  state and 6 unused action closures.
- **Root cause**: The "lab" tab (`setEditorTab('lab')` links from both
  use-case panels) does not actually surface test runs, results, or suites
  (verified — `src/features/agents/sub_lab/**` has zero references to
  `PersonaTestRun`/`PersonaTestResult`/`PersonaTestSuite`). The slice and APIs
  are scaffolding ahead of UI.
- **Impact**: Renderer bundle carries ~60 unused exported lines plus their type
  graph. More relevant for perf: `useAgentStore` includes 3 always-empty arrays
  in every snapshot; every persisted-store rehydrate iterates them; every
  `set((state) => ...)` for unrelated slices still has these references in
  the prev/next diff. Minor on its own, but the actions are reachable via
  `useAgentStore.getState().fetchTestRuns(...)` from anywhere, so a future
  consumer wiring could trigger #6 by accident.
- **Fix sketch**: Either (a) wire the lab tab to consume them and delete this
  finding, or (b) move the unused slice fields and CRUD actions out of the
  global store into a lazy hook used only by the lab tab when it lands.
  Either way, drop `outputAssertions.ts` from the renderer until UI ships.

## 6. `fetchTestRuns` returns full `PersonaTestRun[]` unbounded; default `limit` is undefined on the IPC and there is no client cap
- **Severity**: low
- **Category**: data-layer
- **File**: `src/api/agents/tests.ts:15`, `src/stores/slices/agents/testSlice.ts:61`
- **Scenario**: `listTestRuns(personaId)` is exposed with optional `limit`
  but the slice's `fetchTestRuns` never passes one (line 63:
  `await listTestRuns(personaId)`). Same for `getTestResults`, called by
  `finishTestRun → fetchTestRuns` (slice line 131) on every terminal event:
  the entire history grows and is shipped whole each time a run finishes.
- **Root cause**: No pagination, no client cap, and the call refires on every
  run completion. With heavy test usage (per-persona, accumulating across
  weeks), the IPC payload and `set({ testRuns: runs })` re-allocation grow
  linearly forever. Not a hot issue today (because of #5 — no UI reads
  `testRuns`), but the work still happens once #5 is fixed by wiring the lab
  tab.
- **Impact**: Future tests-page jank when wired up, on personas with many
  historical runs. Also wastes one IPC round-trip + JSON deserialization per
  test completion even though nothing renders the data.
- **Fix sketch**: Pass an explicit `limit` (e.g. 100) when fetching for the
  list view, with an explicit "load more" path. Skip the auto-`fetchTestRuns`
  in `finishTestRun` until/unless the lab tab is currently mounted (cheap
  check: `useSystemStore.getState().editorTab === 'lab'`). Alternatively,
  prepend the new run id locally instead of refetching the whole list.
