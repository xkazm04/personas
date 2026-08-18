---
layer: application
subject: background-jobs
technique: loop-supervision
stack: rust
---

# Loop supervision in the Rust engine

The repo's supervisor is the unified subscription model:
`src-tauri/src/engine/subscription.rs` (the door) plus
`src-tauri/src/engine/background.rs` (the roster and lifecycle). Every claim
of the technique has a concrete address here.

## The registration door

`ReactiveSubscription` (`subscription.rs:69-110`) is the one trait every
recurring loop implements: `name()` (stable label, keys health and logs),
`interval()` / `idle_interval()` (the cadence pair), `initial_delay()` (the
staggered first tick), `tick()` (the body), plus two supervision-relevant
extras — `requires_leadership()` (default `true`: every loop is a singleton
unless it opts out) and `wake_signal()` (optional push-wake). The module doc
at `subscription.rs:1-13` states the thesis outright: adding a new reactivity
source "only requires implementing the trait — no new `tokio::spawn` block
needed."

The roster is assembled in `start_loops` (`background.rs:441-696`): ~30
heterogeneous subscriptions — event bus, trigger scheduler, HTTP polling,
cleanup, OAuth refresh, credential healthchecks, watchdogs, a dozen
autonomy loops — pushed into one `Vec<Box<dyn ReactiveSubscription>>` and
spawned through `spawn_subscriptions` (`subscription.rs:1444-1457`), which
returns `JoinHandle`s that the scheduler retains
(`store_subscription_handles`, `background.rs:766`) "preventing silent task
drops."

`run_single` (`subscription.rs:1218-1429`) is the uniform envelope every loop
inherits: alive/dead registration bracketing the loop
(`mark_subscription_alive` at `:1230`, `mark_subscription_dead` at `:1427`),
panic boundary, cadence switching, slow-tick/overrun accounting — safety as a
property of the door, exactly as the technique prescribes.

## Startup admission is compare-and-swap

`start_loops` opens with `try_begin_start` (`background.rs:466-477`) — an
atomic CAS so two concurrent start calls cannot both spawn a full
subscription set; the loser gets a warning naming the consequence it
prevented ("would double-fire every trigger/webhook and duplicate OAuth
refresh").

## Epochal retirement — the generation counter

The standard's "stop signals must be epochal" clause is implemented, and the
field's doc comment (`background.rs:128-142`) is the best statement of the
reasoning anywhere in the tree: dropping a `JoinHandle` "does NOT abort the
underlying tokio task", so after a stop+restart a loop gating on the shared
`running` bool would find it `true` again and keep polling — "two live copies
of every trigger/webhook/schedule loop hammering the same DB." Instead,
`stop_loops` (`background.rs:908-921`) bumps `generation` as well as clearing
the bool, and each loop compares its spawn-time capture against a fresh load
every tick (`subscription.rs:1263-1274`), retiring itself when the world has
moved on.

## Ownership across processes — two heartbeat leases

Cross-process single-runner enforcement exists at two layers:

- **Engine leadership** (`src-tauri/src/engine/leadership.rs`): a lock file
  (`engine-leader.lock`) with a heartbeat, generalizing the daemon's proven
  lease. `run_single` gates every `requires_leadership()` loop on
  `leadership.is_leader()` (`subscription.rs:1284-1291`); a follower idles
  and re-checks each interval, taking over "within the lease's stale window
  if the leader dies."
- **Daemon handoff** (`background.rs:1785-1844`, `should_yield_to_daemon`):
  the windowed app yields a trigger to the headless daemon only when all
  three conditions hold — fresh `daemon.lock` heartbeat (< 90s), the daemon's
  `owns[]` list includes the trigger kind, and the persona is headless — with
  the stated fallback bias "better to double-fire than silently lose a
  trigger."

The heartbeat/staleness ratio matches the technique's slack rule (30s
heartbeat vs 90s stale threshold).

**Known deviation, reported not repaired here:** the legacy corpus document
`docs/concepts/golden-paths/loop-ownership-and-restart.md` (D1) replayed the
takeover-while-alive path and showed `heartbeat()` renames its own contents
over the file **without re-reading the owner**, while `is_leader()` consults
only the in-memory `Option` — so a late-but-alive old leader silently
re-claims over a legitimate takeover and both processes hold leadership
permanently. This is precisely the technique's "the loser must actually stop
/ verify ownership before acting" clause, violated; the same document also
records that both gates fail open (`.unwrap_or(true)`) and that `release()`
has zero production call sites (every relaunch eats a ~90s follower blind
spot).

## The counter-example in the same tree

`src-tauri/src/engine/curation_scheduler.rs` never registers. It is hosted as
a raw spawned sleep-loop in the boot sequence (`src-tauri/src/lib.rs`,
`curation_scheduler` block near `:1434-1462`): leadership-gated, but with no
panic boundary (a panicking tick kills the task silently), no
`SubscriptionHealth` entry, and no generation check (it survives
`stop_loops`). One roster away from inheriting all three — the swarm pattern
persisting inside a repo that already built the supervisor.
