---
layer: application
subject: job-coordination
technique: lease-renewal
stack: rust
---

# Heartbeat leases: the daemon lock and engine leadership

The repo's canonical lease is **runner-scoped** (the technique's "per
runner" scope): a JSON lock file with a periodic heartbeat, arbitrating
which process instance hosts the engine machinery at all.

## Sizing, exactly per the rule

`src-tauri/src/daemon/lock.rs` writes the sizing rationale into the
constants: `HEARTBEAT_INTERVAL = 30s` (`:60`) and `STALE_THRESHOLD = 90s`
(`:57`), with the comment doing the technique's arithmetic — "90s gives
three missed heartbeats before we declare the daemon dead… conservative
enough to avoid false positives from brief GC pauses or I/O stalls, short
enough that a crashed daemon doesn't block a fresh start for more than
~1.5 minutes." TTL sized to detection latency and tolerant of missed
renewals; job duration appears nowhere in the math, because it is
irrelevant. `is_stale` (`:107`) even treats a future-dated heartbeat as
suspect rather than trusting it.

## Two-way renewal and takeover

`EngineLeadership` (`src-tauri/src/engine/leadership.rs`) generalizes the
same lock into an election. `tick` (`:168-191`) is the technique's two-way
channel in twenty lines:

- **Leader:** refresh the heartbeat — and if the *write fails*,
  relinquish leadership on the spot (`:173-179`). The renewal result is
  read and acted on; a leader that cannot prove liveness stops claiming
  it, instead of working on as a zombie.
- **Follower:** re-attempt acquisition each tick, so a dead leader's
  lease is taken over within one stale window (`:187-190`).

`release` (`:194-200`) deletes the lease on clean shutdown so a successor
need not wait out the 90s — the stale window is paid only for crashes.
`try_acquire` is idempotent, logs both outcomes with the holder's pid and
heartbeat age, and a `forced_follower` mode exists for processes that must
never win (`:124-126`) — tested down to
follower-takes-over-released-lease (`:236-246`).

## What the per-job layer has, and lacks

Individual executions carry the evidence half of a lease:
`persona_executions.last_heartbeat_at` is stamped by the runner
(`src-tauri/db/src/repos/execution/executions.rs:1498`) and
`find_silent_running` (`:1518`) is the watchdog's stale-heartbeat query —
silence made queryable, per the technique. But the *event* pipeline's
claims record no holder, timestamp, or lease at all (`claim_pending` sets
only `status`), which forces the degraded two-snapshot reaper documented
in delivery-guarantees' stuck-reaping — the registered deviation
`#w2-background-jobs` in `docs/concepts/golden-path-deferred-fixes.md`.
The contrast inside one codebase is the technique's argument compressed:
where lease evidence exists (lock file, heartbeat column), expiry is
affirmative and takeover is immediate; where it does not, staleness is
folklore defended by comments about worst-case cadences.
