# Test Mastery — Execution Runner & Inspector
> Total: 7 findings (2 critical, 3 high, 1 medium, 1 low)

## 1. Protocol dispatch — quality-gate, policy drop & incident loop have ZERO behavioral coverage
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/dispatch.rs:209-991 (`dispatch()` fn)
- **Current test state**: exists-but-weak — the file's `mod tests` (1294-1623) only covers the *pure* helpers (`parse_generation_settings`, `pick_generation_policy`, `pick_capability_channels`); the 780-line `dispatch()` match arm itself is completely untested. One "test" (`test_dispatch_context_lifetime_compiles`) just calls `size_of` and asserts nothing about behavior. `test_user_message_builds_ctx_with_none_emit` constructs a struct and re-asserts a literal it set itself — pure success theater documented as a "grep check".
- **Scenario**: Today a regression where (a) a `memory.off`/`review.off` policy stops *dropping* and starts persisting, (b) the quality-gate `Reject` rule stops firing so spam memories/reviews flood the queue, (c) `trust_llm`/`auto_triage` stops auto-resolving and silently blocks the human queue, or (d) `RaiseIncident`/`ResolveIncident` mis-dedups or resolves the wrong incident — all slip through with green CI. These are the runtime data-write paths for every persona execution.
- **Root cause**: `dispatch()` needs a `DbPool` + repos, so it was deemed "untestable in a unit test" and only the JSON parsers were extracted. The decision side-effects (drop vs store vs auto-resolve, audit-event emission) were never given a seam.
- **Impact**: Capability owners who disabled memories/reviews silently start accumulating rows again (the exact bug the `memory_policy.enabled` fallback was added to fix — see the 2026-05-05 comment at :1158); auto_triage reviews block human queues; incident dedup breaks the resolution-continuation loop.
- **Fix sketch**: Use the existing in-process SQLite test pool (see `executions.rs` `mod tests` setup at :1640) to drive `dispatch()` with a tiny fake `ExecutionEventEmitter` + `ExecutionLogger`. Assert behavior, not logs: after dispatching `AgentMemory` with policy=off, `mem_repo` count == 0; with policy=on, count == 1 and `importance` is clamped to 1..=5; `category` "learning" normalized to "learned". For `ManualReview` trust_llm: the row exists AND its status == Resolved. For `RaiseIncident` twice with same execution_id: second call returns `Ok(None)` (dedup). For `ResolveIncident` with an ambiguous 8-char prefix: no incident closed.

## 2. Idempotency dedup & monthly-spend budget gate in `execute_persona_inner` are untested (double-spend / double-run risk)
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/execution/executions.rs:294-345 (budget gate + idempotency dedup); underlying repo src-tauri/src/db/repos/execution/executions.rs:420 (`create_with_idempotency`), :1417 (`get_monthly_spend`)
- **Current test state**: none — the repo `mod tests` has only `test_claim_for_instance_cas`, `test_claim_expired_is_reclaimable`, `test_execution_crud`. Neither `create_with_idempotency`, `get_by_idempotency_key`, nor `get_monthly_spend` has a test, and the command-level gate logic (re-run skip when `status != "queued"`, budget `monthly_spend >= budget` rejection) is entirely uncovered.
- **Scenario**: A timeout-retry sends the same `idempotency_key` twice. If `create_with_idempotency` regresses (e.g. the `get_by_idempotency_key` short-circuit breaks, or the unique index is dropped in a migration), the engine spawns a SECOND `claude` CLI for the same logical run — double the API spend and duplicate side effects. Separately, if `get_monthly_spend`'s status filter or month-boundary SQL regresses, the budget ceiling silently stops enforcing and a runaway persona burns through its monthly cap.
- **Root cause**: These are DB-touching paths guarded behind a Tauri command; no in-process integration test exercises the SQL invariants. The month-boundary (`datetime('now','start of month')`), the status-set inclusion (cancelled runs count toward spend), and the `_ops`-exclusion `NOT LIKE` clause are exactly the kind of SQL that drifts silently.
- **Impact**: Double-billing on every retry, or a defeated budget cap — direct revenue/cost-control failure with no signal.
- **Fix sketch**: Integration tests on the test pool: (1) insert a completed exec with cost 0.05 dated this month + one dated last month → `get_monthly_spend` == 0.05; insert an `_ops` exec → still 0.05; insert a `cancelled` exec with cost → it IS counted. (2) `create_with_idempotency(key=K)` twice → same row id returned, exactly one row in table. (3) A test for the gate predicate `monthly_spend >= budget` at the boundary (spend == budget rejects; spend == budget-0.01 admits).

## 3. `executionSlice` lifecycle (recovery, background-run routing, finish/cancel reset) has no tests
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/stores/slices/agents/executionSlice.ts:148-661 (recovery block :171-223, `executePersona` background routing :256-367, `finishExecution`/`cancelExecution` reset :369-501)
- **Current test state**: none — no `*.test.ts` exists beside the slice. (Sibling slices ARE tested: `labSlice.cancel.test.ts`, `networkSlice.test.ts`, `processActivitySlice.test.ts`, `tourSlice.test.ts`.) Only the thin API wrapper (`api/__tests__/executions.test.ts`) is covered, which asserts nothing about slice state.
- **Scenario**: The slice has hard-won, comment-documented invariants that protect against "phantom run pins isExecuting=true forever, forcing every future run into background mode" (:193-223, :488-494). A regression in the recovery reconcile (e.g. forgetting `markRecovered`, or clearing state when the backend is unreachable instead of setting `executionVerificationFailed`) would silently abandon a still-running, credit-consuming job — or strand the UI in a phantom-running state. None of this is guarded.
- **Root cause**: Zustand slices with `localStorage` + async reconcile + module-local FSM closure are awkward to set up; the safer pure pieces (`pipeline.ts`) got attention while the stateful slice did not.
- **Impact**: Silent regressions in run recovery → abandoned paid executions, or all runs forced to background (no terminal output) after one stuck recovery.
- **Fix sketch**: Vitest with a mocked `@/api/agents/executions` (project already has `@/test/tauriMock`). Tests: (a) `executePersona` while `isExecuting` already true → routes to `backgroundExecutions`, does NOT touch `activeExecutionId`/terminal output. (b) `executePersona` when `isBudgetBlocked` → returns null, sets budget error, no IPC call. (c) `finishExecution` → `isExecuting` is false, `lastExecutionId` set, `localStorage` key removed, `queuePosition`/`queueDepth` nulled. (d) recovery: seed `localStorage` with an active run + mock `getExecution` returning a terminal status → state cleared; mock it rejecting → `executionVerificationFailed` true and state NOT cleared.

## 4. `runLifecycle` FSM — safety-timeout auto-reset and rejected-transition guard are untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/stores/slices/agents/runLifecycle.ts:54-150
- **Current test state**: none. This factory is shared by executionSlice, testSlice AND labSlice — a single regression blasts all three run systems.
- **Scenario**: The 30-minute safety timeout (`scheduleSafetyTimeout`) is the only thing that auto-clears a stalled run; if `markStarted`/`markRecovered` stop arming it, or `markFinished`/`markCancelled` stop clearing it, a stalled run pins `isRunning` forever (the documented failure mode). Also, `tryTransition` must REJECT illegal edges (e.g. `idle → finished`) — the `markRecovered` seam exists precisely because that rejection bit them. No test pins either behavior.
- **Root cause**: Timers + a module-closure `currentState` are easy to skip; the FSM (`runLifecycleFSM`) may be tested separately but its *composition with the timeout* here is not.
- **Impact**: A subtle change re-introduces the phantom-run bug across execution, test, and lab runners simultaneously.
- **Fix sketch**: Vitest `vi.useFakeTimers()`. (a) `markStarted(set)` → set called with `isRunning:true`; advance 30min → set called with `isRunning:false` + a timeout error. (b) `markFinished` after `markStarted` → timer cleared (advance 30min → no further set). (c) `markFinished` from a fresh (idle) lifecycle → transition rejected, no set call (guards the recovered-run path). This is deterministic and isolates the highest-blast-radius shared primitive.

## 5. `executionState.ts` pure helpers — LLM-generatable batch closing the recovery-critical parse/transition invariants
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/lib/execution/executionState.ts:63-107 (`isActiveState`, `isTerminalState`, `parseExecutionState`, `canTransition`, `isExecutionState`)
- **Current test state**: none, despite being imported by the recovery + finish logic in executionSlice (`TERMINAL_STATUS_SET`, `isTerminalState`) and the detail UI (`isTerminalState` gates the Replay tab in `ExecutionDetailTabs.tsx:52`).
- **Scenario**: `parseExecutionState` encodes two deliberate business invariants: the legacy `'pending' → 'queued'` alias, and "unknown strings map to `'unknown'`, NOT `'failed'`, so DB corruption is visible instead of masquerading as a real failure" (:77-89). A refactor that maps unknown → `failed` (or drops the pending alias) would mis-render recovered runs and corrupt the Activity failed-count — with no test to catch it.
- **Root cause**: Pure functions that "look trivial" were skipped; but they gate recovery and a paid-feature tab.
- **Impact**: Recovered/legacy runs mis-classified; Replay tab wrongly shown/hidden; failure metrics polluted.
- **Fix sketch**: LLM-generatable table-driven batch. **Invariants to assert (not snapshot):** `parseExecutionState('pending') === 'queued'`; `parseExecutionState('garbage') === 'unknown'` (never `'failed'`); `parseExecutionState(null|undefined|'') === 'queued'`; `isTerminalState` true for completed/failed/incomplete/cancelled/unknown and false for queued/running; `canTransition('queued','running')` true but `canTransition('completed', X)` always false; every member of `TERMINAL_STATES` ∪ `ACTIVE_STATES` is a valid `ExecutionState`. Keep it behavior-coupled to the documented rules, not to current enum ordering.

## 6. `pipeline_executor` — fan-in input merge & approval-gate/cancellation paths under-tested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/pipeline_executor.rs:988-1013 (`resolve_node_input` fan-in), :658-683 (`poll_for_approval`), :925-952 (final-status / skip-label finalization)
- **Current test state**: exists-but-weak — `mod tests` (:1059-1247) thoroughly covers `evaluate_condition`, `build_predecessor_map`, `should_skip_node`, `NodeConfig` parsing, but the multi-predecessor fan-in merge — explicitly added to fix a "silently discarded the rest" data-loss bug (comment :978-987) — has NO test. Neither does the cancelled-vs-failed final-status selection.
- **Scenario**: A regression reverts fan-in to picking one arbitrary predecessor → an aggregator/reviewer node runs on one branch while the pipeline still reports success (the exact prior bug). Or the `was_cancelled ? "cancelled" : has_failure ? "failed" : "completed"` precedence flips, so a user-cancelled pipeline reports "failed" (misleading incident triage).
- **Root cause**: `resolve_node_input` is already pure and easily testable; it was just never given a test when the fan-in fix landed.
- **Impact**: Silent loss of predecessor outputs in multi-input topologies; mislabeled terminal status feeding dashboards/incidents.
- **Fix sketch**: Pure unit tests on `resolve_node_input`: 0 predecessors → pipeline input; 1 present → raw string (unchanged); 2+ present → `{"inputs":{pid:out,...}}` containing BOTH ids; some predecessors with `None` output → only present ones merged. (Cancellation/approval paths need an async harness — lower priority; at minimum extract the final-status selection into a pure `fn` and table-test it.)

## 7. `business_outcome` serde default + `PersonaExecution::state()` fallback unasserted
- **Severity**: low
- **Category**: missing-assertion
- **File**: src-tauri/src/db/models/execution.rs:86-88 (`default_business_outcome`), :205-222 (`state()`)
- **Current test state**: none in this model file.
- **Scenario**: `state()` deliberately maps an unrecognized DB status to `Failed` (with an error log) rather than panicking, and `business_outcome` defaults to `"unknown"` on deserialize of legacy rows. If a refactor changes the fallback (e.g. to `Completed`) old/corrupt rows would silently render as successes.
- **Root cause**: Trivial-looking model methods skipped; but the fallback is a deliberate fail-safe choice worth pinning.
- **Impact**: Minor — mislabeled status for corrupt/legacy rows; pollutes success metrics.
- **Fix sketch**: Two tiny tests: deserialize a `PersonaExecution` JSON missing `business_outcome` → field == "unknown"; construct one with `status:"bogus"` → `.state() == ExecutionState::Failed`. Cheap, behavior-pinning.
