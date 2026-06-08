# Bug Hunter Fix Wave 7 — Autonomous control / success-theater

> 5 commits, 5 findings closed (1 Critical, 4 High). 2 findings (twin #4 lost-update, execution #6 output interleaving) **deferred** — see `followups-2026-06-08.md`.
> Baseline preserved: `cargo check --features desktop,ml` 0 errors; `tsc --noEmit` 0 errors.
> Mid-wave the personas `node_modules` was completed via `npm install` (user-approved), so eslint/vitest/the lefthook pre-commit hook now run — every TS commit below passed `eslint-staged`.

## Commits

| # | Commit | Finding | Severity | File(s) |
|---|---|---|---|---|
| 1 | `f53e4474f` | companion #1 autonomous cancel race | Critical | `companion/session.rs` |
| 2 | `a4cd8dad8` | companion #5 approval auto-execute TOCTOU | High | `commands/companion/approvals.rs` |
| 3 | `4bcf7ba98` | recipes #1 playground double-instantiate | High | `recipes/sub_playground/*` (3 files) |
| 4 | `d1d900836` | twin #3 reply wrong-recipient | High | `twin/sub_channels/ReplyOutbox.tsx` |
| 5 | `de6722528` | execution #5 status-event teardown | High | `hooks/execution/usePersonaExecution.ts` |

## What was fixed (grouped)

**Loss of control / consent (#companion1, #companion5)**
1. **Autonomous cancel uses a generation token.** Cancellation was a global `AtomicBool` that `schedule_autonomous_tick` *reset* on every new schedule, so a "stop" whose reply also emitted `continue_autonomously` revived the originally-pending tick. Replaced with a monotonic `AtomicU64`: ticks capture the generation, cancel advances it, a tick aborts when they differ, and it's never reset — a stale tick can't be revived.
2. **Approval auto-execute validated value == executed value.** The Athena-owned guard checked the propose-time `params_json` but the executor ran the freshly-loaded payload (TOCTOU → a PTY write could hit the user's own terminal). The fresh params are now re-validated before execution; mismatch fails closed. (Residual: the owner check still keys on a renameable name sentinel — immutable spawn provenance is a follow-up.)

**Correlate to the originating run/context (#recipes1, #twin3, #execution5)**
3. **Playground shares one test-runner.** The modal and the tab each called `useRecipeTestRunner`, giving independent state, so the History tab/badge were always empty. The modal now owns the single instance and passes it down.
4. **Reply logged against its drafted context.** `handleApprove` read the live channel/contact selectors, not the ones the draft was generated for, mis-attributing the recorded send. The draft now freezes `{channel, contact}` at generation and records against that frozen tuple (and shows it in the header).
5. **Focused status events correlate by execution id.** `handleStatusEvent` trusted owner-alignment alone, so a stale terminal event for a prior run tore down the live run's UI. It now drops events whose `execution_id` differs from the active run's.

## Deferred this wave (see `followups-2026-06-08.md`)

- **twin #4 (High) — profile lost-update.** `update_profile` is a blind full-field overwrite; the fix (an `updated_at` precondition returning `Conflict`) must thread through the Tauri command, ts-rs bindings, store, and component — too broad for one safe commit.
- **execution #6 (Medium) — output-line interleaving.** `handleOutputLine` gets only the line text; correlating it needs `execution_id` plumbed through the `execution-output` event + handler. (The companion status-event half, #5, is fixed.)

## Verification

| Check | Result |
|---|---|
| `cargo check --features desktop,ml` errors | 0 |
| `tsc --noEmit` | 0 |
| `eslint` (per-commit hook) | clean on all TS commits |
| Files modified | 7 |

## Cumulative status (waves 1 + 3 + 4 + 5 + 6 + 7)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Crypto — fail closed | 5 (2C / 3H) |
| 3 | Trust-boundary input validation | 6 (2C / 3H / 1M) |
| 4 | Atomicity / TOCTOU | 5 (3C / 2H) |
| 5 | Data-loss (sync / dedup) | 4 (2C / 2H) |
| 6 | Panics & integrity | 5 (4C / 1H) |
| 7 | Autonomous control / success-theater | 5 (1C / 4H) |

**30 of 73 findings closed** (14 Critical, 15 High, 1 Medium). Deferred: execution slot-leak (C), sync cursor (C), 24h-resync (H), twin lost-update (H), execution output-interleave (M). Remaining unstarted: **Wave 2 (P2P / remote-control auth)** + the long tail of Mediums.

## Patterns established (catalogue items 24–27)

24. **Generation token over reset-flag for cancellation** — a shared cancel `bool` that gets reset when work re-arms can revive a stale operation. Use a monotonic generation: cancel advances it, workers capture-and-compare, never reset. *Grep:* an `AtomicBool` cancel paired with a `reset`/`store(false)` on (re)schedule.
25. **Validate the executed value, not a copy (TOCTOU)** — when a guard reads one copy (propose-time) and the executor reads another (freshly-loaded), they can diverge. Validate the exact value that will be acted on, right before acting. *Grep:* a guard on `x.params_json`/cached input followed by a `load`/re-read feeding the executor.
26. **One stateful hook, two call sites = split state** — calling a stateful React hook at two call sites yields independent `useState`, so one instance never sees the other's updates. Instantiate once and pass it down (or lift to a store). *Grep:* the same `useX()` hook imported+called in a parent and its child for shared data.
27. **Bind to the originating context/id, not live ambient state** — an async action (draft → approve) or a UI event handler must act against the context it was created for (frozen tuple / operation id), not whatever the live form/selection/owner shows at handling time. *Grep:* `handleApprove`/`handle*Event` reading live `useState`/`selectedX` instead of a captured value or comparing an event's `*_id` to the active one.

## What remains

Wave 2 (P2P / remote-control authentication — the largest, needs a signed-challenge handshake primitive) is the only unstarted themed wave. Plus the deferred set above and the remaining Medium-severity long tail per the INDEX.
