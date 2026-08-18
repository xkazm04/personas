---
layer: application
subject: concurrency-guards
technique: cross-process-exclusion
stack: rust
---

# Cross-process exclusion in Personas (Rust + one process-level guard)

The repo runs multiple processes against one local database — the windowed
app, the `personas-daemon` binary, future parallel test instances — plus
multiple concurrent CLI agent sessions on one checkout. Three mechanisms
cover three distinct duplicate origins.

## 1. Heartbeat lease: `daemon.lock` and `engine-leader.lock`

`src-tauri/src/daemon/lock.rs` is the substrate: acquisition is an atomic
`OpenOptions::create_new` (`lock.rs:9,215`), the lock file carries holder pid
and `heartbeat_at`, the holder renews every `HEARTBEAT_INTERVAL` (30s,
`lock.rs:60`), and a contender treats a lock as dead when the heartbeat is
older than `STALE_THRESHOLD` (90s, `lock.rs:57`) — liveness asked as "has it
renewed lately," never "does the process exist," exactly the lease form of
the technique. The 3× headroom between renewal and staleness is the
pause-tolerance margin.

`src-tauri/src/engine/leadership.rs` generalizes the same lease into engine
leadership: any instance may hold `engine-leader.lock`; the holder is the
**leader** and runs the singleton background loops; everyone else is a
follower. `try_acquire` (`leadership.rs:123`) is follower-safe — a fresh lock
means follow, a stale one is taken over — and `tick` (`leadership.rs:168`)
does double duty: leaders renew the heartbeat (and *relinquish* leadership if
the renewal fails, rather than believing themselves leader on a lease they
can no longer prove), followers re-attempt acquisition, so takeover happens
within one stale window of a leader dying. The module doc names the duplicate
this kills: two instances each running their own scheduler "double-fire
schedulers, double-rotate OAuth tokens" — the database file survives
(journaling), the *behavior* is wrong, which is why this is a guard problem
and not a storage problem.

One measured gap against the technique's strict form: stale takeover is
`remove_file` then `create_new` (`lock.rs:185-215`), not an atomic
replace-if-unchanged. The exclusive `create_new` still arbitrates the final
winner, but a contender that read "stale" just before the new leader's file
landed can remove a *fresh* lock. The window is narrow and the cost is one
extra leadership bounce; it is a real instance of the "takeover must be
atomic" rule being approximated rather than met.

## 2. Population check: `guard-concurrent-cargo.mjs`

`scripts/build/guard-concurrent-cargo.mjs` guards a different process
population — concurrent agent sessions launching heavy builds on one
machine. It is the technique's **stateless population check**, and its header
documents every choice the technique says must be documented:

- *Why stateless*: "a lockfile needs a release path and a crashed run would
  leave a stale lock that blocks everything" (`guard-concurrent-cargo.mjs:16-19`)
  — the dead-holder question answered by refusing to hold anything; the
  evidence (a live `cargo.exe` process) disappears with the activity.
- *Fail direction, chosen from costs*: **fail-open, loudly**
  (`guard-concurrent-cargo.mjs:21-26`) — a false block stops all compilation,
  a false allow merely risks the CPU spike; every degraded path (empty stdin,
  unparseable payload, failed process enumeration) says so on stderr instead
  of silently allowing (`:44-59,:93-99`).
- *Race window accepted*: two commands checked in the same instant could both
  see zero cargo processes; the guard is advisory coarse exclusion of
  expensive work, which is exactly the technique's stated fit for population
  checks — and it also ignores processes younger than 5s because cargo
  re-execs itself (`:32-33`), a self-collision the naive check would trip on.

The concurrent-vcs path cites this same script for its shared-resource
arbitration between agent sessions; here it stands as the population-check
*variant* of cross-process exclusion — complement, not duplicate.

## 3. Claim-based dispatch (owned elsewhere)

The third duplicate origin — two loops both taking the same queued work item
— is handled by compare-and-swap claims in the database (`claim_pending`
transitions and `trigger_version` checks). That machinery is
[scheduling](../../scheduling/scheduling.md)'s ground (see its
[overlap-and-reentrancy](../../scheduling/techniques/overlap-and-reentrancy.md)
technique); it is listed here only to complete the map of which mechanism
answers which origin: lease for singleton *loops*, CAS claim for singleton
*items*, population check for advisory *machine-level* exclusion.
