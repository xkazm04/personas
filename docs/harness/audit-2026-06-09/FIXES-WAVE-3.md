# Audit Fix Wave 3 — Success theater / silent failure

> 2 commits, 4 of 7 critical findings closed; 3 deferred (need backend infra + runtime validation).
> Theme: operations that report success/failure that doesn't match reality.
> Baseline preserved: `cargo check --features desktop` clean; `tsc --noEmit` 0; eslint clean on changed TS.
> Branch: `vibeman/audit-2026-06-09`.

## Commits

| Commit | Findings | Files |
|---|---|---|
| `c0dba70ba` | test-suites #1, test-suites #2, lab #1 | `engine/test_runner.rs` |
| `c18051915` | research-lab #2 | `research-lab/shared/runPersona.ts`, `sub_experiments/ExperimentsPanel.tsx` |

## What was fixed

1. **test-suites #1 — false-green status.** Scenario status was `"passed"` whenever `execute_scenario` returned `Ok` (i.e. "the CLI ran"), never the scores. An agent scoring 0/0/0 was stored `passed`, so suite-gated promotion trusted green rows for objectively-failed scenarios. A `verdict_status` helper now derives the status from a composite (`tool*0.4 + quality*0.4 + protocol*0.2 >= 50`) at both fan-out sites.
2. **test-suites #2 — heuristic masquerade.** When LLM eval timed out / fell back to heuristics, the "nothing-expected = 100" sentinels produced an ~80 composite that read as a pass. `verdict_status` now returns `"inconclusive"` when `eval_method` is `timeout`/`heuristic_fallback`, so a total eval outage can never present as green.
3. **lab #1 — partial run marked Completed.** A fan-out `scenario×model×variant` run was finalized `Completed` even when JoinError/panicked cells were silently `continue`d. A completeness gate finalizes the run `Failed` when `current < total` (with a lost-cell count in the log + emit) instead of presenting a partial sample as a trustworthy comparison.
4. **research-lab #2 — timeout recorded as failed.** `runPersonaAndWait` returned `passed:false` on BOTH a terminal failure and a poll timeout; `handleRun` then persisted a permanent `failed` run for an execution that may still be succeeding (later compiled into reports as counter-evidence). The result now carries `kind: 'terminal' | 'timeout'`; `handleRun` skips persistence on timeout (warns the user) and records only runs that reached a terminal status.

## Verification

| Gate | Result |
|---|---|
| `cargo check --features desktop` | clean, 0 errors |
| `tsc --noEmit` | 0 |
| `eslint` (staged TS) | clean (ran via lefthook on the research-lab commit) |
| `cargo test --lib` / `vitest` | pre-existing failures only, in untouched files (see Wave-1/2 docs) |

## Deferred (3 of 7) — need backend infra + runtime validation

- **research #1 — experiment result lost if app closes / poll > 120s.** The run row is created client-side *after* the long await. Proper fix: create the run row server-side *before* dispatch (status `running`, store `execution_id`), update on completion, and reconcile `running` rows against their execution's terminal status on startup. Needs a new/extended command + reconciliation. Wave-3's research #2 fix removes the *false-failed* record; this remaining piece is the *lost* record.
- **teams #2 — abort/pause don't cancel in-flight executions.** Detached step `tokio::spawn`s keep polling and write post-terminal `done`/`failed` under an aborted assignment (token spend + success theater). Needs a cancellation token threaded into `start_execution` and detached step tasks joined/aborted — same orchestrator surface as the deferred Wave-2 teams #1; do them together with runtime validation.
- **events #1 — webhook watermark advances past undelivered events.** A global cursor advances even when every delivery failed, dropping notifications forever. Entangled with deferred Wave-2 events #2 (re-delivery): both need a per-`(event_id, subscription_id)` delivery record + the cursor advanced only past delivered/abandoned events. Do as one delivery-tracking change with runtime validation.

## Patterns reinforced (catalogue, continued)

9. **A verdict must reflect measurement, not mechanics.** "The process returned Ok" ≠ "the thing passed". Derive pass/fail from the actual scores, and when evaluation didn't really run (timeout/fallback sentinels), report `inconclusive` — never let "no signal" read as success.
10. **Completion = every unit produced a result.** A fan-out is "completed" only if `persisted == expected`; dropped/panicked units make it `failed`/partial, never a trustworthy whole.
11. **Timeout ≠ failure.** Distinguish "didn't finish observing" from "finished and failed" (a discriminated result), and never persist a not-yet-terminal run as a terminal failure.

## Cumulative status (Tier-1, waves 1–3)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Lost-update writes | 8 / 8 |
| 2 | Transition guards & lock leaks | 5 / 7 |
| 3 | Success theater / silent failure | 4 / 7 |
| | **Tier-1 criticals fixed** | **17** |

Deferred Tier-1 (need tested infra): teams #1 + #2 (orchestrator guard + cancellation), events #1 + #2 (delivery tracking), composition #6 part b (approval channel), research #1 (durable run row). Remaining unstarted: Wave 4 orphaned processes (5), Wave 5 security (7), Wave 6 corruption loops (7). Then Tier-2 UI (19) and Tier-3 highs (169).
