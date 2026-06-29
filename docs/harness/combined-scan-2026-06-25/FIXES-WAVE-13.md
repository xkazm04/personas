# Combined-Scan Fix Wave 13 — Backend orchestration

> 6 atomic fix-commits, 6 findings closed (all High) — no deferrals (genome's per-offspring measured-eval deferred). All backend Rust.
> Baseline preserved + improved: **cargo workflow_compiler 7/0 (the renamed self-loop test now passes — it was 1 of the 19 pre-existing fails, so the Rust full-suite baseline is now 18), genome 25/0, team_assignment 14/0, incident 34/0, build_simulate 15/0 + full compile**. No FE → no tsc/vitest (genome doc-only binding regen folded in).

## Commits

| # | Commit | Finding |
|---|---|---|
| 1 | `9535d51d9` | build-sessions #1 (persist unvalidated → panic) |
| 2 | `627460e46` | build-sessions #2 (simulate clobbers design_context) |
| 3 | `be8726074` | genome #2 (fitness success-theater) |
| 4 | `376ca79e0` | incidents #2 (resume swallows DB error) |
| 5 | `d7949fe81` | team-assignment #2 (lost-resume slot) |
| 6 | `89e9d1040` | self-healing #2 (rollback min-execution floor) |

## What was fixed

1. **Persist-unvalidated panic.** `persist_blueprint` validated a clone then iterated the raw blueprint, so an out-of-bounds edge index panicked the command and a self-loop was silently persisted (with `dropped_connections` hardcoded 0). Now iterates the validated clone and reports the real dropped count + warnings.
2. **Simulate clobbers a concurrent promote.** The dry-run's RAII restore blindly wrote the prior `design_context` back, overwriting a `design_context` a concurrent Promote had just committed (broken persona shipped). Now compare-and-restore: only restores if the column still equals the snapshot it wrote.
3. **Genome fitness theater.** `parent_fitness` was computed-then-discarded, offspring fitness never computed, multi-gen selection by emission order. Now parent fitness seeds gen 1 + ranks selection; offspring get a predicted inherited fitness; docs corrected to "predicted, not measured" (real per-offspring eval deferred).
4. **Resume swallows a DB error.** The continuation tick claimed (stamped `continued_at`) then read failed-steps with `.ok().unwrap_or_default()`, so a transient SQLITE_BUSY became "no failed steps" and the assignment was permanently parked. The lookup now returns a `Result` and runs before the claim; on error it skips without claiming (retryable next tick).
5. **Lost-resume slot.** A resume landing in the tick loop's slot-release window was dropped as a duplicate, leaving a `pending` step under status `running` with no ticker. After releasing the slot, the wrapper re-reads and respawns once when there's runnable work (two guards prevent an infinite respawn).
6. **Rollback onto a one-sample version.** The rollback target had no minimum-execution floor, so a version whose window held one lucky success was treated as known-good. Applied the same `>= 3` execution floor to the target.

## Pattern catalogue (items 38–40)

38. **Validate-a-clone-then-use-the-original** — validating a copy and persisting/iterating the raw input makes the validation dead and can panic/persist the very data it dropped. Operate on the validated value and report the delta.
39. **Blind RAII restore of a shared persistent value** — restoring a captured prior value unconditionally clobbers a concurrent writer. Compare-and-restore (only if unchanged) or take the same lock as the other writer.
40. **Permanent claim before a fallible check** — stamping "handled" before a fallible lookup that you then treat as empty-on-error makes a transient failure a permanent skip. Do the fallible check first, or un-claim on error.

## Cumulative status (Waves 1–13)

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1–12 | security → FE metric/lifecycle | 68 (6C/62H, 2C mitigated) |
| 13 | Backend orchestration | 6 (6H) |

**Total: 74 findings addressed across ~90 commits, 0 regressions** (+1 pre-existing Rust test fixed). 6/6 scan Criticals fixed-or-mitigated; **68 of 81 Highs closed.**
**Remaining: ~13 High** (plugins + FE tail): artist file-leak + thumbnail-OOM, google-drive sandbox + IPC-loop, design-reviews crash, capabilities budget, i18n RTL, persona-templates questionnaire, personas-twin milestone, recipes threshold, state-mgmt selector, tauri-ipc enum-drift + timeout. Next: Wave 14 — plugins/FE.
