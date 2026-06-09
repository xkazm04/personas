# Audit Fix Wave 2 — Status-transition guards & lock leaks

> 5 commits, 5 of 7 critical findings closed; 2 deferred (need tested infra — see below).
> Theme: unguarded status transitions, missing/leaked locks, and a hard-coded approval timeout.
> Baseline preserved: TypeScript 0 errors (no TS touched); `cargo check --features desktop` clean throughout.
> Branch: `vibeman/audit-2026-06-09`.

## Commits

| # | Commit | Finding | Files |
|---|---|---|---|
| 1 | `d5b461b40` | reviews #1 — manual-review double-approval re-dispatch | `db/repos/communication/manual_reviews.rs` |
| 2 | `b8f87e916` | execution #1 — cancel clobbered back to completed | `db/repos/execution/executions.rs` |
| 3 | `898c80d72` | evolution #1 — AI healing slot leaked forever | `engine/mod.rs` |
| 4 | `76e2f3d84` | companion #1 — concurrent turns race the session/brain | `companion/session.rs` |
| 5 | `b1c83b5c3` | composition #6 (part a) — 1-hour approval force-reject | `engine/pipeline_executor.rs` |

## What was fixed

**Atomic status transitions (single-winner CAS):**
1. **manual-review** — `update_status` did `get_by_id → validate_transition → UPDATE … WHERE id=?` with no status predicate. A user Approve racing Athena's `execute_resolve_human_review` (or a double-click / two windows) interleaved between read and write; both affected 1 row, so the command re-ran `react_to_review_decision` twice (re-resumed the held team step, re-dispatched the follow-up run). Now `WHERE id=? AND status=?old`; the loser gets 0 rows and a benign error its caller's `?` short-circuits before any side effect.
2. **execution cancel** — `update_status_if_not_final` used `WHERE status IN ('running','cancelled')` for *all* writes, so a success/failure landing just after the user clicks Stop overwrote the freshly-written `cancelled` row back to `completed`. The predicate is now split: a `cancelled` write may touch `running`/`cancelled` (to enrich the safety-net cancel with metrics); every other status may only advance a still-`running` row. Completion can never clobber a cancel.

**Lock ownership / mutual exclusion:**
3. **healing slot** — the command pre-acquired the `healing_personas` slot via `try_start_healing`, then `spawn_healing_chain` re-inserted the same id, hit its own already-in-progress guard, and early-returned *before* any cleanup — leaking the slot forever (healing bricked for that persona until restart). `spawn_healing_chain` now takes `slot_already_held`: the command path passes `true` (skip the re-acquire, still release on exit), the auto path passes `false` (acquires itself).
4. **companion turns** — `send_turn` had no mutual exclusion; a user message and a background proactive/autonomous tick could both `--resume` the same Claude session id and clobber each other's session-id write + interleave brain reads/writes. A const `TURN_LOCK` now serializes turns: user turns wait, background turns `try_lock` and skip so autonomous work never preempts the user.

**Don't fail a legitimate human-in-the-loop pause:**
5. **pipeline approval** — `poll_for_approval` polled `0..3600` and returned `TimedOut` after exactly 1 hour, which the runner turned into a node `rejected` + pipeline failure. An overnight/out-of-hours approval silently failed the whole run. The wait is now unbounded; only an explicit approve or a pipeline cancel exits. (`ApprovalOutcome::TimedOut` removed.)

## Verification

| Gate | Result |
|---|---|
| `cargo check --features desktop` | clean, 0 errors (ran after every fix) |
| `tsc --noEmit` | 0 (no TS changed this wave) |
| `cargo test --lib` / `vitest` | pre-existing failures only, in untouched files (see FIXES-WAVE-1.md and harness-learnings); this wave touched none of them |

## Deferred (2 of 7) — need tested infra, opened as follow-ups

- **teams #1 — concurrent tick loops duplicate-execute a step.** The clean fix is a per-`assignment_id` live-orchestrator guard (atomic insert in `run_assignment` + RAII `Drop` release inside the spawned task). The double-START case is safe, but the guard interacts with the pause→resume flow: a narrow window (the tick loop reading `paused` and dropping its guard *just as* `resume_assignment` re-inserts) could leave an assignment `running` with no live loop. Closing that safely needs the tick-loop exit/restart semantics validated at runtime (or a generation-token instead of a binary set). Single spawn point is `team_assignment_orchestrator.rs:119`; release must cover every exit.
- **events #2 — webhook re-delivery on crash/leadership-handoff.** No idempotency between the HTTP POST batch and `set_watermark` (`engine/webhook_notifier.rs:472-498`); a crash/leader-flip mid-tick re-POSTs the whole batch (80 messages instead of 40). Fix needs a delivery-record consult-before-send keyed `(event_id, subscription_id)` + an `Idempotency-Key` header + advancing the watermark from persisted delivery state rather than the in-memory loop var. `record_delivery` exists (`db/repos/resources/team_channel.rs`) but wiring consult-before-send + watermark-from-state needs runtime validation.

## Patterns reinforced (catalogue, continued from Wave 1)

5. **Status flips are single-winner CAS** — `UPDATE … WHERE id=? AND status=?expected`; a 0-row result means a concurrent caller won — abort and let the caller skip its side effects. App-code `validate_transition` against a separately-read value is advisory, not atomic.
6. **Terminal states are sinks** — once a row is `cancelled`/terminal, only a same-class write may touch it; a different status must require the prior non-terminal state in its `WHERE`. Prevents completed-over-cancel.
7. **One owner per lock + RAII release** — a slot/mutex must have a single acquisition owner; release via `Drop` (or a single-owner flag) so early returns and panics can't leak it. Two layers both "acquiring" the same set is a self-collision + leak.
8. **Human-in-the-loop waits are unbounded** — never turn elapsed wall-clock on a human approval into a failure; gate only on explicit approve/cancel (and persist the awaiting state so a restart resumes it).

## Cumulative status (Tier-1, waves 1–2)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Lost-update writes | 8 / 8 |
| 2 | Transition guards & lock leaks | 5 / 7 (2 deferred) |

Remaining Tier-1: Wave 3 success theater (7), Wave 4 orphaned processes (5), Wave 5 security (7), Wave 6 corruption loops & stream/graph integrity (7) + the 2 Wave-2 deferrals. Then Tier-2 UI (19) and Tier-3 highs (169).
