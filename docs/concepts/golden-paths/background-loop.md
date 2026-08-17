# Golden path — Background loop

> Situation node: `backend-runtime/scheduling-and-loops/background-loop` · [situation spine](../situation-spine.md)
> Composed 2026-08-15 against `master` @ `a385c159d`. Ground-truth sweep: all **963**
> `src-tauri/**/*.rs` files walked by the census runner (matches
> [`shared-facts.json`](../shared-facts.json) `rust.files: 963`); every `loop` and
> `while` in the tree brace-matched by two independent tools after blanking
> comments and string literals, yielding **51 production time-driven loops**, each
> read by hand; all **203** task-spawn sites (`tokio::spawn` /
> `tauri::async_runtime::spawn` / `thread::spawn`, `spawn_blocking` excluded)
> classified for JoinHandle retention; all **16** `tokio::time::interval`
> constructions; `subscription.rs` (3,436 lines) and `background.rs` (4,158 lines)
> read in full; all **38** `impl ReactiveSubscription` blocks enumerated; both
> binaries (`lib.rs` and `daemon_bin.rs`) read for shutdown handling; on the client,
> every consumer of `SchedulerStats`, `SubscriptionHealth` and the
> `subscription-crashed` event resolved individually across 4,829 `.ts` + 2,104
> `.tsx` files. Every number below came from reading source or running a matcher,
> not from estimation. **No `cargo` was run.**
> **Deviations** is a fix backlog; it migrates to `violating` cells on ingest.

**Adjacent leaves — cross-reference, do not absorb.**
[`polling-loop.md`](./polling-loop.md) owns the **client** cadence — `usePolling`,
the `PollingCoordinator`, `POLLING_CONFIG`, and the server read-cost half of a
polled command. That path's loops live in a React effect and die with the
component; this path's live in a tokio task and die with the process. Where the
two meet — a Rust loop that exists only to feed a client poll — that path owns
the cadence and this one owns the loop's stop, backoff and liveness.
[`cancelling-in-flight-work.md`](./cancelling-in-flight-work.md) owns stopping **one
run** a user pressed Stop on: the registries, the tree-kill, the five ordered acts.
This path owns stopping **the loop that keeps starting runs** — clause 1 of that
path's principle ("refuse to start more") is this leaf's whole subject, and this
path defers to it on everything about killing what a tick already spawned.
[`long-running-job-progress.md`](./long-running-job-progress.md) owns what one job
must be able to answer when polled. This path owns whether the *ticker* can answer
the same question about itself.
[`transaction-boundary.md`](./transaction-boundary.md) owns `BEGIN IMMEDIATE` and the
`deferred-read-then-write` census rule; §"Overlap" below cites it rather than
re-deriving the `SQLITE_BUSY_SNAPSHOT` hazard.
[`structured-logging.md`](./structured-logging.md) owns the shape of a tracing call;
this path owns the rule that a `tracing::warn!` is not a report.

---

## Principle

*Three sentences, no repo path, no primitive name, no count — the layer a sibling
repo on another stack can adopt as-is. Each clause carries its warrant, per the
[portability test](../research/portability-test.md)'s finding that unmarked local
calibration is what gets a whole document discarded.*

> **(physics)** A loop's wait must be raced against its stop signal, not merely
> followed by a check of it — a loop that sleeps first and checks after cannot be
> reached for the length of its own interval, and its interval is chosen for the
> work, never for how long a shutdown may block. **(physics)** A tick that failed
> must cost more than a tick that succeeded, or a broken dependency converts a
> schedule into a flood at exactly the moment the dependency can least afford one.
> **(ergonomics)** A loop that has stopped emits nothing, so its liveness has to be
> asserted from outside by something that notices silence — a log line is what the
> loop says while alive, and the failure mode is that it stops saying anything.
>
> *Scale condition:* clause 1 starts paying at the first loop that outlives a
> user-visible on/off switch; clause 2 at the first tick that calls a remote
> dependency; clause 3 at roughly the third loop, when "is it still running?" stops
> being answerable by reading one file. Below that, a bare sleep and a log line are
> honest.
> *Local calibration (do not port):* everything below this block.

---

## Trigger

- "Run this every N seconds" / "check for X in the background" / "add a watchdog for Y"
- "Poll the API for new messages and dispatch them"
- "Refresh the token before it expires" / "keep the session alive"
- "It stopped working and nobody noticed" / "the scheduler is stuck" / "triggers just silently stopped firing"
- "I turned the engine off and it's still doing things"
- "The app pegs a core when the network is down" / "we got rate-limited overnight"
- "The tick takes longer than the interval now"

If you are about to write `tokio::spawn(async move { loop {`, a
`tokio::time::interval(`, a `sleep(...).await` at the top or bottom of a `loop`, a
`std::thread::spawn(move || loop {`, a `spawn_*_loop()` / `spawn_*_ticker()`
function, or a `TICK_INTERVAL` constant — you are in this situation.

## The one way

**Do not write the loop. Write the tick, and hand it to the thing that already owns
loops.** Implement `ReactiveSubscription` — `name()`, `interval()`, optionally
`idle_interval()` / `initial_delay()` / `wake_signal()` / `requires_leadership()`,
and `async fn tick(&self)` — and push it into the `subscriptions` vec in
`background::start_loops`. You then get, without writing a line of it:
generation-based retirement so a scheduler stop or restart retires your loop instead
of leaving an orphan double-ticking the same DB (`subscription.rs:1262-1271`); a
`catch_unwind` panic boundary so one bad tick does not silently delete your loop
from the process (`:1319-1324`); exponential backoff after three consecutive panics,
capped at 16× (`:1349-1366`); an active/idle cadence switch; a leadership gate so two
instances on one shared database do not double-fire; a push-wake so the interval is
a heartbeat rather than your latency floor; tick-overrun and 80%-of-interval slow-tick
warnings (`:1400-1424`); and — the part nothing else in this repo gives you — a row in
the **`SubscriptionHealth`** registry, which is what makes the difference between a
loop that died and a loop that is merely quiet. Draw the cadence from the work's real
cost and set `idle_interval()` deliberately; a watchdog whose whole subject is
*silence* must **not** slow down when idle, and `FleetLivenessWatchdog:2965-2968`
writes that reasoning down. Bound the work one tick may do
(`QueueDrainWatchdog`'s `MAX_PROMOTE_PER_TICK = 16` plus a no-progress break,
`:3130-3143`) rather than trusting the interval to bound it, and self-throttle a
sub-cadence onto an existing tick instead of adding a second loop for it
(`reap_stuck_processing_events`, `background.rs:1081-1090`, which states this
explicitly: *"rather than a fresh `tokio::spawn`, layering on the existing
`EventBusSubscription` loop"*). **If — and only if — the trait genuinely cannot host
your loop** (you own an `mpsc::Receiver`, you must run before `AppState` is managed,
you are inside the `p2p` crate, you are a blocking OS thread), then write the loop by
hand in the one correct shape: take a stop handle at construction, **race the wait
against it inside `tokio::select!` rather than sleeping and checking afterwards**,
back off on consecutive failures, retain the `JoinHandle` and `await` it on shutdown.
`daemon_bin.rs:162-207` is that shape, in this repo, in full — and it is 45 lines.

## Mandated primitives

- **`src-tauri/src/engine/subscription.rs:69` — `ReactiveSubscription`.** The trait. `name()` (`:71`), `interval()` (`:74`), `idle_interval()` (`:78`, defaults to `interval()`), `initial_delay()` (`:83`, defaults to zero), `async fn tick(&self)` (`:89`), `requires_leadership()` (`:98`, defaults **true** — every loop in this registry is a singleton and double-running it against one shared DB is a bug), `wake_signal()` (`:105`, `Option<&'static Notify>`; the interval then becomes the degraded-mode heartbeat, not the latency). **36 production implementors.** The whole point: an implementor *cannot write a loop* — there is no place to put one.
- **`subscription.rs:1218` — `run_single`.** The supervisor. Read it before hand-rolling anything: initial delay (`:1234-1238`), select over interval-vs-wake (`:1253-1266`), generation retirement (`:1270-1279`), leadership gate (`:1289-1297`), idle/active interval swap (`:1300-1319`), `catch_unwind` (`:1319-1324`), crash record + `subscription-crashed` emit (`:1341-1347`), panic backoff (`:1349-1366`), latency record, overrun warn, slow-tick warn (`:1400-1424`), `mark_subscription_dead` on exit (`:1427`).
- **`subscription.rs:1444` — `spawn_subscriptions`.** Returns the `JoinHandle`s so the caller can retain them; its doc comment states the contract — *"the caller only needs to push a new `Box<dyn ReactiveSubscription>` to add a new reactivity source — no new `tokio::spawn` block required."*
- **`src-tauri/src/engine/background.rs:43` — `SubscriptionHealth`.** 14 fields per loop: `alive`, `started_at`, `interval_ms`, `last_tick_duration_ms`, `max_tick_duration_ms`, `overrun`, `tick_count`, `error_count`, `consecutive_panics`, `last_tick_at`, `avg_tick_duration_ms`, `overrun_count`, `slow_tick_count`. Populated by `mark_subscription_alive` (`:364`), `record_tick_latency` (`:296`), `record_subscription_crash` (`:256`), `mark_subscription_dead` (`:394`). **This is the answer to "how does it report that it is stuck", and it exists only for loops that go through `run_single`.**
- **`background.rs:441` — `start_loops`** / **`:908` — `stop_loops`.** `stop_loops` flips `running` *and bumps the generation*; its comment (`:909-919`) is the best statement in the repo of why: *"Dropping `subscription_handles`' JoinHandles does not abort the underlying tasks, so any loop spawned under the previous generation is still alive and ticking."* Read that before you assume dropping a handle stops anything.
- **`src-tauri/engine/src/p2p/periodic.rs:12` — `PeriodicTask`.** `new(name, interval, cancel)` / `with_dynamic_interval(name, get_interval, cancel)` / `.with_max_errors(n)` / `.with_backoff_multiplier(m)` / `.run(task_fn)`. Dynamic interval re-read each tick (hot config reload), `select!`-raced sleep vs `cancel.cancelled()` (`:94-100`), consecutive-error backoff capped at 60× (`:83-91`), and a "recovered" log on the transition back (`:111-117`). **The `Result<(), String>` tick signature is the thing to copy: `run_single`'s tick returns `()`, so a subscription's own errors are invisible to its supervisor — only panics are counted.** 5 call sites, all in `p2p/mod.rs` (`:178`, `:201`, `:224`, `:252`, `:280`), all behind the `p2p` feature.
- **`src-tauri/src/daemon_bin.rs:160-215` — the hand-rolled reference.** `mpsc::channel::<()>(1)` created at `:161`; the heartbeat loop races `interval.tick()` against `shutdown_rx.recv()` (`:166-179`); the main loop races `tick_interval.tick()` against the OS signal (`:190-206`); `drop(shutdown_tx)` then `heartbeat_task.await` (`:211-213`) recovers the lock handle and releases it. **If the trait cannot host you, this is the shape.**
- **`subscription.rs:2946` — `FleetLivenessWatchdog`** and **`:3102` — `QueueDrainWatchdog`.** The two loops whose subject is another loop's silence. `FleetLivenessWatchdog` treats two hours of zero execution starts *with work available* as a stall — and returns early when `quota_cooldown_active` explains the silence (`:2985-2987`), which is the difference between a watchdog and an alarm.
- **`background.rs:1081` — `reap_stuck_processing_events`** + **`:1051` — `partition_stuck_candidates`.** The compensating layer for work a dead tick abandoned: two consecutive sightings before touching anything, one atomic guarded UPDATE per row so the owning tick always wins the race, `retry_count` incremented per reap so a poisoned row dead-letters instead of cycling. `STUCK_EVENT_REAP_INTERVAL = 300s` (`:1038`), and its doc comment derives that number from every claiming cadence in the system.
- **`personas_core::ipc_gauge::ipc_in_flight()`** — the "is the app busy right now" gauge a maintenance tick can defer on (`db/src/lib.rs:230`). Useful, and **not** a stop signal; see Deviation S2.

## Steps

1. **Ask whether this is a loop at all.** If the work is triggered by a write this app makes, `db/src/cdc.rs` already emits on it — subscribe instead ([`backend-to-frontend-events`](./backend-to-frontend-events.md)). If it is a sub-cadence of an existing tick (every Nth pass of something that already runs), **self-throttle onto that tick** with a timestamp on `SchedulerState`, the way `reap_stuck_processing_events` does. A new loop is the last resort, not the first.
2. **Write the tick as a `struct` + `impl ReactiveSubscription`.** Put the state the tick needs in the struct's fields (`DbPool`, `AppHandle`, `Arc<ExecutionEngine>` — see the 36 existing ones for the shapes). The tick is a function of that state; it has no loop, no timer, no counters.
3. **Pick `interval()` from the work's cost, and `idle_interval()` from what the tick is *for*.** Cheap in-memory poll: seconds. DB scan: tens of seconds. Anything that shells out or calls a remote: minutes, and give it an `initial_delay()` so it is not competing with app startup. If the subscription exists to notice that nothing is happening, `idle_interval()` must equal `interval()` and you must say why in a comment (`FleetLivenessWatchdog:2965-2968`).
4. **If the tick does blocking DB work, wrap it in `run_blocking_tick`** (`subscription.rs:119`). rusqlite is synchronous; a slow query inside `async fn tick()` occupies a tokio worker for its whole duration. The helper re-propagates a panic so the supervisor's `catch_unwind` still counts it.
5. **Bound the work one tick may do, and break on no progress.** `for _ in 0..MAX_PER_TICK` with an early `break` when a pass promotes nothing. An unbounded tick turns a backlog into an overrun, and an overrun into a burst (Gap 4).
6. **Decide `requires_leadership()` deliberately.** The default is `true` and is almost always right. Override to `false` only for genuinely per-instance work, and write the reason next to it.
7. **Register it in `background::start_loops`** — one `subscriptions.push(Box::new(YourSubscription { .. }))`. **And then stop.** No `tokio::spawn`, no `interval`, no `sleep`, no stop flag, no panic guard, no retry counter, no health bookkeeping, no `JoinHandle`. `run_single` owns all seven.
8. **Make failure cost something.** `run_single` backs off on *panics*, not on `Err`. If your tick can fail against a remote dependency, hold the consecutive-failure count in your own struct (an `AtomicU32` field) and return early while it is hot — or model the tick as a `PeriodicTask`-style `Result` and take Gap 1's fix. A tick that logs `warn!` and returns `()` has told the supervisor it succeeded.
9. **Only if the trait genuinely cannot host you**, hand-roll — and copy `daemon_bin.rs:160-215` literally: take the stop handle **at construction**, put the wait **inside** `tokio::select!` alongside it, retain the `JoinHandle`, and `await` it on shutdown. Write, in a comment, the one reason the trait could not host it. Every one of the 22 hand-rolled loops in this repo has such a reason; not one of them wrote it down, and Gap 2 is the list of reasons reverse-engineered after the fact.
10. **Prove it can be seen.** Open the Overview → Health page and confirm your subscription appears (`health_check_subscriptions` → `useHealthChecks.ts:39`). If it does not appear, you did not register it — which is exactly the state the 22 hand-rolled loops are in.

### Prefer a type over a gate

Asked directly, per the contract: **could a background loop be made impossible to get
wrong? Yes — and unlike every other leaf that asks this, the type already exists and
already works.**

`ReactiveSubscription` is the answer in its strongest form. An implementor writes
`async fn tick(&self)`. There is **no syntactic position** in which they could write a
`loop`, a `sleep`, an `interval`, a stop check, a panic guard, a backoff counter or a
health registration — `run_single` owns all six and the trait's signature does not
expose them. This is the same shape the contract cites for `createLazySection`
(22/22 vs 2/31) and `FacetedDecisionTable` (3/3 vs 5/20), but stronger: those make a
*forgettable argument* mandatory, whereas this removes the dangerous construct from
the vocabulary entirely. Measured here: **36 of 36 supervised loops race their wait,
back off on panic, retire on a generation bump and report liveness. 0 of 22
hand-rolled loops do any of the four.** The type does not merely correlate with
correctness; nothing that goes through it can be incorrect in these four ways.

So the interesting question is not "what type would fix this" but **"why did 22 loops
route around a type that works?"** Each answer is a missing capability, and all five
are small:

1. **The trait requires an `AppHandle`, and four loops are spawned before one is
   available or want none.** `run_single` takes `app: AppHandle` unconditionally
   (`:1221`) to emit `subscription-crashed` and to read leadership. `db/src/lib.rs:226`
   lives in the `personas-db` crate, which cannot depend on `tauri` types at all.
   *Fix:* make the emit + leadership lookup an `Option<AppHandle>`, exactly as
   `run_single` already handles the missing-`AppState` case at `:1292-1296`
   (*"If AppState isn't available (e.g. unit tests), behave as leader"*).
2. **The trait cannot own a receiver.** `cdc.rs`'s drain, `auto_cred_browser.rs:115`'s
   frame flusher and `cloud/sync`'s wake-coalescer each hold an `mpsc`/`watch`
   receiver across ticks. `wake_signal()` gets you a `Notify` and nothing else.
   *Fix:* widen `wake_signal()` to return an owned future factory, or accept that a
   receiver-owning drain is a different situation and let it hand-roll — but then it
   must take the `daemon_bin` shape.
3. **`tick()` returns `()`, so a failing tick is indistinguishable from a working
   one.** `PeriodicTask` — the *other* harness, in the same repo — returns
   `Result<(), String>` and backs off on it. Every loop whose failure mode is a
   remote dependency (`slack_poller`, `discord_poller`, `webhook_notifier`,
   `auth.rs`'s token refresh) therefore had a real reason not to adopt: adopting
   would have removed the only backoff they could express. *Fix: change the trait's
   tick to `Result<(), String>` and lift `PeriodicTask`'s error ladder into
   `run_single`.* This is the single highest-value change in this document.
4. **There is no blocking-thread variant.** `obsidian_brain/graph.rs:778` is an OS
   thread, not a tokio task; nothing in the registry can host it.
   *Fix:* a `BlockingSubscription` sibling, or make that debounce a subscription tick
   with a `Notify` wake.
5. **`start_loops` is the only registration door and it runs once, after setup.** A
   loop that must start before it, or from a feature-gated crate, has nowhere to go.
   *Fix:* a `register_subscription(&AppHandle, Box<dyn ReactiveSubscription>)` that
   spawns immediately under the current generation.

**Propose the type changes as the fix; the §9 census rule is the ratchet that holds
the line until they land.** And note what the type does *not* fix: `run_single`'s own
`Interval` still defaults to `MissedTickBehavior::Burst` (Gap 4), and neither harness
can be reached by app exit (Deviation S1) — those are one-line and one-function fixes
respectively, not type problems.

## The contract (loop ↔ the rest of the app)

Six rules bind a background loop to the process it lives in. Every one is violated
somewhere in this repo.

1. **The wait is raced against the stop, never followed by a check of it.** A stop
   that arrives one millisecond after `sleep(300s)` begins is honoured 300 seconds
   later. `tokio::select!` costs one line. **8 loops race their wait; 13 open with a
   bare one** (§9's measured counts).
2. **A user-visible on/off switch must reach every loop it claims to control.**
   `stop_scheduler` (`commands/execution/scheduler.rs:52`) and the tray's
   `toggle_scheduler` (`tray.rs:148-151`) both call `stop_loops`, `SchedulerStats.running`
   flips to false, and `ScheduleTimeline.tsx:255-261` renders "engine stopped". **22
   loops keep running** — the Slack, Discord and webhook dispatchers, the cloud sync
   writer, the remote-command poll, the session-refresh loop, the persona-jobs worker,
   the curation scheduler, the companion night-shift scheduler and 14 more. The switch
   is honest about 36 of 58 loops and silent about the rest.
3. **The interval is a budget against the tick's cost, and an overrun must not
   compound.** A tick that takes longer than its interval is already reported
   (`run_single:1414-1421`) and then made worse: `tokio::time::interval`'s default
   `MissedTickBehavior::Burst` fires every missed tick back-to-back with zero delay
   once the slow tick returns. **13 of the repo's 16 `interval` constructions take the
   default**, including `run_single`'s, which drives all 36 supervised loops.
4. **A tick that failed must be reported as failed.** `run_single` counts panics and
   nothing else, so a tick that catches its own error and logs `warn!` increments
   `tick_count`, resets `consecutive_panics` and records a healthy latency. The health
   page then reports *"Healthy — 412 ticks, avg 8ms"* for a loop that has not
   succeeded at anything since launch. This is this leaf's version of
   [`query-latency-instrumentation.md`](./query-latency-instrumentation.md)'s finding,
   one layer up: not a warning nobody reads, but a warning the *supervisor* does not
   read.
5. **Liveness is asserted from outside, or it is not asserted.** The registry
   (`SubscriptionHealth`) is the assertion; a loop outside it has no liveness claim at
   all, and neither does a loop whose watchdog is itself a tick of the loop being
   watched.
6. **Whatever a tick spawns is not the loop's business, and must be somebody's.**
   Killing a loop does not kill the child processes its ticks started; that belongs to
   [`cancelling-in-flight-work.md`](./cancelling-in-flight-work.md). What belongs
   *here* is the requirement that a stopped loop's abandoned work reaches a terminal
   state — the reaper/lease layer, of which this repo has three
   (`reap_stuck_processing_events`, `automation_runs::reap_stale_runs`,
   `build_sessions::expire_stale_non_terminal`) and both sibling repos have one each.

## Anti-patterns

- **`loop { sleep(N).await; work(); }`.** The headline. For N seconds nothing can reach this loop: not app exit, not `stop_scheduler`, not a cancellation token, not the user. 13 matches across 12 files (§9). The fix is one line — `tokio::select! { _ = sleep(N) => {}, _ = stop.cancelled() => break }`.
- **Checking the stop flag *after* the sleep instead of racing it.** `pipeline_executor.rs:467` and `:736` do this at a 1-second granularity, which is defensible; the same shape at `auth.rs:821`'s 60 seconds or `db/src/lib.rs:229`'s 300 seconds is not. The granularity is invisible in the code — that is what makes it a pattern rather than a judgement call.
- **`tauri::async_runtime::spawn(async move { loop { … } });` as a bare statement.** **17 of the 20** spawn sites containing a timed loop discard the `JoinHandle`; 16 of those 17 use `tauri::async_runtime::spawn`, and all 3 that retain a handle use `tokio::spawn`. The idiom has quietly become "fire and forget" — and `background.rs:909-919` already records that retaining the handle would not have stopped the task anyway. The handle is not the stop; the stop is the stop. But discarding it means there is no `await` on shutdown either, so nothing can even *wait* for a drain.
- **A stop signal that only `continue`s.** `project_tracking/scheduler.rs:62-64` reads an `enabled` flag and `continue`s when false; `discord_poller.rs:80`, `slack_poller.rs:112`, `team_slack_relay.rs:524`, `webhook_notifier.rs:781`, `lib.rs:1369` and `lib.rs:1426` do the same with `is_leader()`. These are **gates, not stops** — the loop still wakes, still holds its captured `DbPool` and `AppHandle`, and still runs forever. A gate is correct; it is not a substitute for a stop, and reading it as one is the most common mistake in this file set.
- **Cancellation one level too low.** `smee_relay.rs` gives every child relay task a `CancellationToken` (`:723`), cancels them properly (`:564-580`), and then runs the supervisor that owns them in a `loop` whose tail `select!` (`:838-841`) races a notify against a 5-minute timeout and **has no shutdown arm at all**. The children can be stopped; the thing that keeps making children cannot.
- **A watchdog inside the loop it watches.** `reap_stuck_processing_events` rides the `EventBusSubscription` tick — correct and deliberate for *event* strandings, because the reaper's subject is rows, not the bus. It becomes an anti-pattern the moment the thing being watched is the tick itself: if the bus dies, its reaper dies with it. brainiac committed exactly this (`alerts.rs`'s alert sweep is dispatched by the worker loop it would report on) and named the failure mode in its own header — *"the central negative finding was not a crash; it was silence."*
- **A perpetual loop spawned per call.** `obsidian_brain/graph.rs:778` spawns a 500 ms OS thread inside `watch_vault`, with no break, no return, no flag and no channel. Calling `watch_vault` again replaces the `notify` watcher in the guard but leaves the previous debounce thread alive, holding an `Arc<Mutex<…>>` and an `AppHandle`, emitting `VAULT_CHANGED_EVENT` for the old vault path forever. Every re-watch leaks a thread.
- **A `tracing::warn!` as the failure report.** `slack_poller`, `discord_poller`, `team_slack_relay`, `webhook_notifier`, `remote_commands`, `auth` and `db/src/lib.rs` all end their error arm at `warn!`. Per [`query-latency-instrumentation.md`](./query-latency-instrumentation.md), that reaches stdout, a 7-day rolling file, and a Sentry breadcrumb that uploads only if an unrelated `error!` fires later. Nothing counts it, nothing surfaces it, and the loop's health row (if it has one) still says healthy.
- **Retrying an auth failure at a fixed cadence.** `auth.rs:821` is the lockout shape: 60 s forever, no backoff, no attempt ceiling, no staleness ceiling, no typed revocation — while the connector-side refresh path 1,000 lines away in `engine/oauth_refresh.rs` has all of those. Confirmed by reading both; see Deviation B1.
- **A precondition the loop's own failure makes permanently false.** `auth.rs:824-830` proceeds only when `auth.access_token.is_some()`. The offline path at `auth.rs:795-796` sets `auth.access_token = None`. After that the loop wakes 1,440 times a day and takes the `continue` branch every time, forever, with no path back to a refresh. Confirmed by reading both sites.
- **Reaching for a second harness because the first one cannot express failure.** There are two loop harnesses in this repo. `PeriodicTask` is the better one — it has a `Result` tick and error backoff — and it is confined to the `p2p` feature, which `npm run tauri:dev:lite` does not compile. `run_single` is the one everyone uses and it can only see panics. Nobody chose this; it is what happens when the harness with the right signature ships behind a feature flag.
- **Adding a loop for a sub-cadence.** If you need "every 5 minutes" inside a system that already ticks every 5 seconds, store a `last_ran_ms` on `SchedulerState` and early-return. `background.rs:1084-1090` is the 6-line version.

## Evidence

- **`src-tauri/src/engine/subscription.rs:1218-1428` (`run_single`) — copy nothing from this; *use* it.** It is the whole prescription implemented once. The doc comment at `:1204-1217` is the best explanation in the repo of why a bare `running` bool is unsafe as a stop and a generation is not: *"dropping a `JoinHandle` (all `stop_loops` used to do) doesn't abort this task, so a stop+restart flips `running` back to `true` while this loop is still alive, and it would wrongly conclude it's current and keep polling — producing a second live copy of every trigger/webhook/schedule loop against the same DB."* That paragraph is the reason this leaf is `diverged` rather than `absent`: the correct answer was worked out here, in detail, and then 22 loops were written next to it.
- **`src-tauri/src/daemon_bin.rs:160-215` — the exemplary hand-rolled loop, and the only complete shutdown in the repo.** Shutdown channel created before either loop; heartbeat races `interval.tick()` against `shutdown_rx.recv()` (`:167-178`); main loop races `tick_interval.tick()` against the OS signal (`:191-205`); an explicit drain step (*"draining — waiting for in-flight executions"*, `:209`); `drop(shutdown_tx)` then `heartbeat_task.await` (`:211-213`), and the task **returns the lock** so `lock.release()` can run on the recovered value. 45 lines, and it does everything the 22 hand-rolled loops in the app binary do not.
- **`src-tauri/engine/src/p2p/periodic.rs:12-142` (`PeriodicTask`) — the right tick signature.** `task_fn: FnMut() -> Future<Output = Result<(), String>>`, `consecutive_errors` incremented on `Err` and reset on `Ok`, `effective_interval = base * multiplier` past the threshold, capped at 60×, a distinct "backing off" log line, and a "recovered" line on the way back (`:111-117`). Compare `run_single`, which has the identical backoff ladder wired to **panics only**. Two harnesses, one repo, one of them can see failure.
- **`subscription.rs:2946-3010` (`FleetLivenessWatchdog`) — the exemplary "report that it is stuck".** Its subject is the absence of work: two hours of zero execution starts *with work available*. Two details make it the reference: `idle_interval()` deliberately equals `interval()` with the reason written down (*"'idle' is precisely the state this watchdog exists to interrogate"*, `:2965-2966`), and it returns early when `quota_cooldown_active` explains the silence (`:2985-2987`) — a watchdog that cannot distinguish "stuck" from "correctly waiting" becomes noise and then becomes muted.
- **`subscription.rs:3102-3145` (`QueueDrainWatchdog`) — bounding the work per tick.** `MAX_PROMOTE_PER_TICK = 16` with four early-break conditions including a no-progress break, and the comment says why: *"the no-progress break prevents spinning."*
- **`background.rs:1030-1150` (`reap_stuck_processing_events` + `partition_stuck_candidates`) — the compensating layer, done right.** Rides an existing tick rather than spawning (`:1079-1080`); two consecutive sightings before acting (`:1051-1063`); `STUCK_EVENT_REAP_INTERVAL = 300s` derived, in the comment, from every claiming cadence in the system (`:1030-1038`); one atomic guarded UPDATE per row so the owning tick always wins; `retry_count` incremented per reap so a poisoned row dead-letters. Its honesty is worth copying too: *"This is INSURANCE, not a realised loss — the operator's live DB has zero `processing` rows."*
- **`background.rs:908-920` (`stop_loops`).** Four lines of code and eleven of comment, and the comment is the load-bearing part. Read it before you write any loop in this repo.
- **`src-tauri/src/engine/oauth_refresh.rs:319-380` and `:625-686` — bounded retry done right, twice.** `MAX_PERSIST_ATTEMPTS = 3`, linear backoff `150ms × attempt`, a `warn!` per retry naming what would be lost, and a terminal `error!` that names the user-visible consequence (*"the rotated refresh_token could not be saved — credential may need re-authorization"*). This is what the same file's own subject — token refresh — looks like when someone bounded it, and it is the sharpest possible contrast with `auth.rs:821`.
- **`src-tauri/src/engine/automation_runner.rs:75-101` — the other bounded retry.** `max_attempts` ceiling, `MAX_BACKOFF_MS = 30_000` cap, and — uniquely in this repo — re-resolves auth headers on HTTP 401 *inside* the retry so a rotated credential is picked up rather than retried against.
- **`src-tauri/src/commands/execution/alert_evaluator.rs:358-368` — the one loop that thought about overrun.** `MissedTickBehavior::Delay` (`:361`) plus `spawn_blocking` for the synchronous DB tick (`:366`), with the reason in the comment (*"a slow query never stalls the async runtime"*). One of only 3 of 16 `interval` sites that set the behaviour at all.
- **`src-tauri/src/commands/infrastructure/system/health.rs:715-765` (`build_subscriptions_section`) → `src/features/overview/components/health/useHealthChecks.ts:39`.** The one working end-to-end path from a dead loop to a human: `alive == false` → `HealthCheckStatus::Error` with the crash count and last-active time; `consecutive_panics > 0` → Warn; `overrun` → Warn. It works, it is consumed, and it can only ever describe the 36 loops that go through `run_single`.
- **`src-tauri/db/src/cdc.rs:282-350` — the push spine that deletes loops.** Named here for the same reason [`polling-loop.md`](./polling-loop.md) names it: before adding a timer over a table this app writes, check whether CDC already emits on it.

## Deviations found

### The population

**51 production time-driven loops** across `src-tauri` (dedup'd to maximal spans, with
comments and string literals blanked; 2 further loops are inside `#[cfg(test)]`).
Split by kind:

| Kind | Count | Stoppable | Notes |
|---|---|---|---|
| Supervised subscription ticks (`run_single`) | 36 | **36** | generation retirement, panic backoff, health registry |
| Hand-rolled **perpetual** loops, app process | **22** | **0** | the deviation surface below |
| Hand-rolled perpetual loops, `daemon_bin` | 2 | 2 | the reference implementation |
| Hand-rolled perpetual loops, `p2p` feature | 7 | 7 | `PeriodicTask` ×5 + mdns browse + accept loop |
| Bounded wait-for-condition loops (deadline / attempt ceiling / channel close) | 20 | n/a | `director.rs:954,:982`, `management_api.rs:2104`, `fleet/wait.rs` ×3, `personas.rs:791`, `connector_readiness.rs:424`, `oauth_refresh.rs:321,:626`, `automation_runner.rs:77`, … |

**Adoption ratio: 36 / 58 ≈ 62%** of the app process's long-lived loops go through the
supervised primitive. That is materially better than [`polling-loop.md`](./polling-loop.md)'s
client-side 18% — but the 22 that route around it are not a random sample. They are the
token refresher, the WAL checkpointer, the cloud sync writer, the leadership heartbeat,
the persona-jobs worker, the curation scheduler, the companion night-shift scheduler
and every inbound-message poller.

**S1 — app exit stops one subsystem; the other 57 loops die by process termination.**
`lib.rs:3737-3744` handles `RunEvent::Exit` and calls exactly `state.webbuild_servers.stop_all()`.
There is no `ctrl_c` handler, no `SignalKind`, no shutdown channel and no
`on_window_event` anywhere in the app binary — `grep -rn "ctrl_c\|SignalKind" src-tauri`
returns **4 hits, all in `daemon_bin.rs`** plus two `libc::kill(.., SIGTERM)` calls that
are outbound kills, not handlers. `stop_loops` is never called from the exit path; its
only two callers are the IPC command (`scheduler.rs:55`) and the tray toggle
(`tray.rs:151`). This is the same finding as
[`cancelling-in-flight-work.md`](./cancelling-in-flight-work.md) T7, seen from the loop
side rather than the child-process side.

**S1a — the SIGTERM-aware helper the daemon needs is written and never called.**
`daemon_bin.rs:326` (`#[cfg(unix)]`) and `:343` (`#[cfg(not(unix))]`) define
`wait_for_shutdown()`, which races `ctrl_c()` against `SignalKind::terminate()` and has
a doc comment explaining that systemd/launchd need it. **Both variants have zero call
sites.** The main loop at `:200` uses `tokio::signal::ctrl_c()` inline instead, so on
Linux and macOS the daemon does not respond to SIGTERM at all. brainiac hit this exact
bug and fixed it — `main.rs:599-632`'s doc comment records that a ctrl_c-only future had
left the whole shutdown path dead code in its primary deploy target. Here the fix is
already written and orphaned.

**S2 — 22 perpetual loops with no stop path of any kind.** Not one holds a
`CancellationToken`, a `watch`/`mpsc` shutdown receiver, or a generation check. Seven
read a flag and `continue` (a gate, not a stop). All 22 keep ticking through
`stop_scheduler`.

| Loop | Cadence | Startup delay | What it does every tick with no way to stop it |
|---|---|---|---|
| `commands/infrastructure/auth.rs:821` | 60 s | — | Supabase session refresh. **B1 below.** |
| `db/src/lib.rs:229` | 300 s | 30 s | `PRAGMA optimize` + `PRAGMA wal_checkpoint(TRUNCATE)` on **both** pools |
| `engine/webhook_notifier.rs:776` | 5 s | 10 s | outbound webhook dispatch (leader-gated) |
| `engine/discord_poller.rs:75` | 5 s | 10 s | inbound Discord fetch + persona dispatch (leader-gated) |
| `engine/slack_poller.rs:107` | 5 s | 10 s | inbound Slack fetch + persona dispatch (leader-gated) |
| `engine/team_slack_relay.rs:522` | 5 s | 10 s | outbound Slack mirror + watermark advance (leader-gated) |
| `lib.rs:1367` | 5 s | 3 s | persona-jobs worker tick (leader-gated) |
| `lib.rs:1424` | 60 s | 8 s | curation scheduler enqueue (leader-gated) |
| `lib.rs:1244` | 30 s | — | leadership lease heartbeat |
| `commands/companion/mod.rs:127` | 3 s | 2 s | companion job worker; `catch_unwind` guard, no stop |
| `commands/companion/mod.rs:341` | 300 s | 30 s | companion proactive/night-shift scheduler; `catch_unwind` guard, no stop |
| `cloud/sync/mod.rs:451` | 45 s + wake | 10 s | cloud read-projection push (leader-gated); `select!`s the wake, **not** a shutdown |
| `cloud/remote_commands.rs:171` | 15 s | 12 s | remote-command poll (leader-gated) |
| `commands/execution/alert_evaluator.rs:362` | 60 s | yes | alert evaluation over SQLite |
| `commands/fleet/stale.rs:205` | 30 s | one tick | fleet rehydrate + orphan recovery + auto-forget |
| `commands/fleet/transcript.rs:54` | 60 s | — | waits for the projects dir; `return`s on success, spins forever if it never appears |
| `engine/project_tracking/scheduler.rs:59` | 3600 s | one tick | project-tracking pulse (enabled-gated, leader-gated) |
| `engine/resource_governor.rs:42` | 3 s | — | CPU/RAM sample → concurrency gate |
| `engine/smee_relay.rs:609` | notify + 300 s | 5 s | relay supervisor; children cancellable, supervisor not |
| `freeze_monitor.rs:84` | 10 s | 10 s | heap probe + freeze detection |
| `db/src/embedder.rs:211` | 60 s | — | idle model unload |
| `commands/obsidian_brain/graph.rs:778` | 500 ms | — | **OS thread**, spawned per `watch_vault` call, never joined, never stopped |

**S3 — 17 of 20 timed-loop spawn sites discard the `JoinHandle`.** Retained: 3
(`daemon_bin.rs:162`, `smee_relay.rs:726`, `auto_cred_browser.rs:109`). Discarded: 17,
of which 16 use `tauri::async_runtime::spawn`. Retaining the handle would not stop the
task — `background.rs:909-919` says so — but discarding it removes the ability to
`await` a drain, which is the step `daemon_bin.rs:213` shows is the point.

**S4 — the WAL-checkpoint loop is the one whose lack of a stop is architectural, not
cosmetic.** `db/src/lib.rs:226-260` gates on `ipc_in_flight() == 0`, which is a
*busyness* gauge and not a shutdown signal, then checks out a pooled connection from
each of two pools and runs `wal_checkpoint(TRUNCATE)`. Because it lives in the
`personas-db` crate it cannot see `AppState`, `SchedulerState`, or any Tauri type — it
is structurally unreachable from every stop mechanism the app has.

> **The brief is wrong about the consequence, and the correction matters.** The stated
> hazard was *"a loop holding a DB handle through shutdown is how a corrupt write
> happens."* It is not. `STANDARD_PRAGMAS` (`db/src/lib.rs:201-208`) sets
> `journal_mode = WAL` with `synchronous = NORMAL`; in WAL mode SQLite is durable
> against **process** termination by design, and an interrupted `wal_checkpoint`
> leaves a fully recoverable WAL. Killing this loop mid-checkpoint cannot corrupt the
> database. What it can do is leave the WAL untruncated (the checkpoint's whole
> purpose), and — the real cost — the loop is **immune to the engine's off switch**,
> so a user who stops the scheduler still has two pools being checkpointed every five
> minutes. The defect is reachability, not durability. Recorded here because a
> golden path that inherits an overstated hazard teaches the wrong lesson: the reason
> to give this loop a stop is that the user asked for one, not that SQLite is fragile.

### Backoff

**B1 — the 60 s session-refresh loop, confirmed against the brief.** `auth.rs:812-853`
(`spawn_session_refresh_loop`), read in full:

- `tokio::time::interval(60s)`, `loop { ticker.tick().await; … }` — **no backoff.** A refresh that fails at T fails again at T+60, T+120, … for the lifetime of the process.
- **No attempt ceiling and no staleness ceiling.**
- **No typed revocation.** The failure arm is `Err(e) => tracing::warn!(error = %e, "Proactive session refresh failed")` (`:851`) — one warn line, no state change, no `needs_reauth` marking, no event, no counter.
- **The precondition its own failure makes permanently false, confirmed.** The tick proceeds only when `auth.access_token.is_some()` (`:826`). The offline handler at `:795-796` sets `auth.access_token = None` — with a comment explaining that leaving the stale token in place caused a spurious mid-session logout. So the two behaviours are individually reasonable and jointly fatal: once offline clears the token, the loop wakes **1,440 times a day** and takes `continue` every time, forever, with no path back.
- **The comparison the brief drew is exact.** `engine/oauth_refresh.rs`, in the same subsystem, has: a bounded retry (`MAX_PERSIST_ATTEMPTS = 3`, `:319`/`:626`), linear backoff (`150ms × attempt`), a terminal `error!` naming the user-visible consequence, a staleness-ceiling guard on the proactive path (referenced at `:697-702`), `needs_reauth` / `needs_reauth_at` metadata cleared on success (`:605-607`), rotation-aware persistence, and `resolve_revocation_healing` on recovery (`:692`). Seven safeguards on one path; zero on the other; ~1,000 lines apart in the same crate.

**B2 — the backoff split is by loop *kind*, not by loop *author*.** Every bounded
retry of a unit of work in this repo has backoff: `oauth_refresh.rs:321`/`:626`,
`automation_runner.rs:77` (capped at 30 s), `smee_relay.rs`'s reconnect ladder,
`run_single`'s panic ladder, `PeriodicTask`'s error ladder. **Of the 22 perpetual
loops, exactly 0 back off on a failed tick.** They log and re-fire at the same
cadence: `discord_poller.rs:88`, `slack_poller.rs:120`, `team_slack_relay.rs:531`,
`webhook_notifier.rs:786`, `remote_commands.rs:178`, `auth.rs:851`,
`db/src/lib.rs:245`, `companion/mod.rs:146`. So when Slack is down, the app hits it
every 5 seconds forever, while an *execution* retry in the same process would have
backed off to 30 s and given up. **This split is reproduced independently in both
sibling repos** (Convergence 2) — it is the most convergent finding in this document.

**B3 — `run_single` backs off on panics, not on failures.** `ReactiveSubscription::tick`
returns `()`. A tick that catches its own error and logs increments `tick_count`,
resets `consecutive_panics` to 0 (`:1370-1377`) and records a normal latency — so the
health page reports it Healthy. The only tick outcome the supervisor can distinguish
is a panic, which is the outcome well-written Rust produces least often. `PeriodicTask`
in the same repo takes `Result<(), String>` and gets this right.

### Overlap

**O1 — 13 of 16 `tokio::time::interval` constructions take `MissedTickBehavior::Burst`,
including `run_single`'s.** Only `alert_evaluator.rs:361` (`Delay`),
`auto_cred_browser.rs:113` (`Skip`) and `runner/mod.rs:2086` (`Skip`) set it. The
consequence is specific and compounding: `run_single` *detects* an overrun and logs
*"Tick overrun: subscription tick took longer than its configured interval"*
(`:1414-1421`) — and then the `Interval` it detected the overrun on fires every missed
tick back-to-back with zero delay. A subscription at 2 s that takes 20 s once will run
nine more ticks immediately, each hitting the same slow dependency that caused the
overrun. The detection is right, the mechanism underneath it makes the problem worse,
and `Delay` is one line.

**O2 — a tick cannot overlap *itself*, and that is the one thing this repo gets right
structurally.** Every loop here awaits its tick inline, so the next wait does not begin
until the tick returns. There is no in-flight flag anywhere and none is needed. The
overlap risk is **across** loops, not within one: 22 unsupervised loops plus 36
supervised ones, several on 5-second cadences, all against the same two SQLite pools.

**O3 — the `busy_timeout` does not cover the case that matters.**
`db/src/lib.rs:202` sets `busy_timeout = 5000`, which retries `SQLITE_BUSY`. It does
**not** apply to `SQLITE_BUSY_SNAPSHOT` (517) — a deferred read transaction that tries
to upgrade to a write after another connection has moved the WAL fails immediately, and
no busy handler is invoked. That is exactly the shape a background tick wears: read,
decide, write. Owned by [`transaction-boundary.md`](./transaction-boundary.md) and
already gated there by the `deferred-read-then-write` census rule; named here only so
nobody sizes a tick's transaction posture from the `busy_timeout` value.

**O4 — the three reaper/lease layers are the real overlap protection, and they are
uneven.** `reap_stuck_processing_events` (300 s, two-sighting rule, retry-count
increment → dead-letter) is excellent. `automation_runs::reap_stale_runs` and
`build_sessions::expire_stale_non_terminal` (`STALE_SESSION_MIN_AGE_HOURS = 24`) are
coarser. Nothing reaps abandoned work for the 22 unsupervised loops, because none of
them claims anything a reaper could find.

### Observability

**O5 — the richest liveness record in the repo has zero readers.** `SubscriptionHealth`
carries 14 fields per loop and is computed on every tick of all 36 supervised
subscriptions. It leaves Rust by three doors:

| Door | Consumer | Status |
|---|---|---|
| `health_check_subscriptions` (`health.rs:217`) | `useHealthChecks.ts:39` | **works** — the Overview health page renders Dead / Unstable / Overrun / Healthy |
| `get_subscription_health` (`scheduler.rs:61`) | `api/pipeline/scheduler.ts:21` | **0 call sites.** `grep -rn "getSubscriptionHealth" src/` returns exactly one line: its own definition |
| `SchedulerStats.subscriptionHealth` (`background.rs:237`, `:433`) | `ScheduleTimeline.tsx:99` | fetched and discarded — the component reads only `.running` (`:255`) |

And the one **push** signal — the `subscription-crashed` event emitted on every caught
panic (`subscription.rs:1341-1347`) — is declared in `eventRegistry.ts:216` with
metadata at `:1004` and has **zero `listen(` consumers**. So a subscription panicking
three times in a row emits three events into the void, and the user learns about it
only if they happen to open Overview → Health.

**O6 — 22 loops contribute zero rows to that registry, by construction.**
`build_subscriptions_section` iterates `scheduler.subscription_health()`, which is
populated only by `run_single`. There is no surface — command, event, log query or
metric — from which anyone can learn that the Slack poller, the token refresher, the
WAL checkpointer or the companion night-shift scheduler has stopped. They stop by going
quiet, and quiet is also what they look like when everything is fine.

**O7 — the health page's verdict is only as good as B3.** Because a tick's own errors
never reach the supervisor, `HealthCheckStatus::Ok` with *"Healthy — N ticks, avg Xms"*
is reachable by a subscription that has failed every tick since launch. The page is
correct about *liveness* and cannot speak to *success*.

## Gaps in the primitives

1. **`ReactiveSubscription::tick` returns `()`.** The single highest-value change in this document. `PeriodicTask` proves the alternative works: `Result<(), String>`, `consecutive_errors`, an interval multiplier, and distinct "failed" / "backing off" / "recovered" log lines. Changing the trait's tick signature would give all 36 subscriptions real failure backoff and a truthful health verdict, and would remove the strongest reason four of the 22 hand-rolled loops had for not adopting.
2. **`run_single` requires an `AppHandle`.** It is used for the crash emit and the leadership read, and `run_single` already handles a missing `AppState` gracefully at `:1292-1296`. Making the handle `Option` unblocks the `personas-db`-crate loops and the pre-`AppState` startup loops.
3. **There is no `BlockingSubscription`.** `obsidian_brain/graph.rs:778` is an OS thread and the registry cannot host it. A blocking variant driven by `spawn_blocking` (the machinery already exists as `run_blocking_tick`, `:119`) would close that class.
4. **`run_single` does not set `MissedTickBehavior`.** One line (`interval.set_missed_tick_behavior(Delay)`), applied at `:1245` and again at `:1313` where the interval is rebuilt on the idle/active swap. Until then the supervisor amplifies every overrun it detects.
5. **`start_loops` is the only registration door.** It runs once, after setup, and takes 13 positional arguments. There is no `register_subscription(app, sub)` for a loop that starts later, so anything that must start earlier or from a feature-gated crate hand-rolls.
6. **Two harnesses, and the better one is behind a feature flag.** `PeriodicTask` is `#[allow(dead_code)]` on its impl block (`periodic.rs:25`) and lives under `#[cfg(feature = "p2p")]` (`engine/src/lib.rs:122-123`), so it does not compile in `desktop`/`desktop-full`-minus-p2p — which is what `npm run tauri:dev:lite`, the documented daily-work default, builds. The repo's best background-loop primitive is invisible to most of its development.
7. **`stop_loops` retires; it does not drain.** Bumping the generation means each loop exits *at the top of its next tick*, i.e. up to one full interval later — up to **3,600 seconds** for `project_tracking/scheduler.rs`. There is no `await` on `subscription_handles`, so nothing can wait for a clean stop, and `SchedulerStats.running` flips to false immediately while N loops are still mid-tick. `daemon_bin.rs:211-213` shows the drain that is missing.
8. **No subscription has a per-tick timeout.** Nothing wraps `sub.tick()` in `tokio::time::timeout`, so a tick that hangs on a network call hangs its loop forever. `run_single` will report the overrun once and then never tick again; `alive` stays `true` because `mark_subscription_dead` runs only after the loop *exits*. **A wedged subscription reports Healthy-but-overrun, indefinitely** — the one liveness state the registry cannot express.
9. **There is no acknowledgement that a loop stopped.** `stop_loops` returns `()` immediately. A caller cannot learn how many loops retired, how many are still draining, or whether any refused.
10. **Loop tests exist only for the supervisor's bookkeeping.** `background.rs`'s test module covers `record_subscription_crash`, `consecutive_panics` reset, `store_subscription_handles`, `stop_loops`' generation bump and the two-sighting reaper rule — good coverage of the *state machine*. There is no test that a loop actually stops, none for the panic backoff timing, none for the idle/active swap, and none at all for any of the 22 hand-rolled loops.
11. **`tauri::async_runtime::spawn` has become the fire-and-forget idiom.** 16 of 17 discarded-handle timed-loop spawns use it; all 3 retained-handle ones use `tokio::spawn`. Nothing enforces or documents the split; it is convention by accident, and it makes "was this handle deliberately discarded?" unanswerable at the call site.

## Convergence check — `brainiac` and `personas-cloud`

Read-only oracle sweep of `C:/Users/mkdol/dolla/brainiac` (Rust, 8-crate workspace,
axum + Postgres + in-process worker) and `C:/Users/mkdol/dolla/personas-cloud`
(npm-workspaces TypeScript monorepo — Node orchestrator + `ws` + `better-sqlite3`,
a Node worker, and a Python FastAPI facade). Per the contract's portability rule: a
mechanic reinvented there is physics; a clause with no trace there is suspected local
calibration.

**Independently reinvented — treat as physics:**

1. **Race the wait against the stop.** brainiac wrote this document's central
   prescription as a named helper with no shared document between the repos:
   ```rust
   // brainiac main.rs:649-661
   async fn sleep_or_shutdown(shutdown: &mut watch::Receiver<bool>, dur: Duration) -> bool {
       if *shutdown.borrow() { return true; }
       tokio::select! { _ = tokio::time::sleep(dur) => false, _ = shutdown.changed() => true }
   }
   ```
   Two call sites, **2 raced waits, 0 bare** in its worker loop, plus a loop-head
   re-check. This is the §9 positive control's shape, arrived at independently. The
   strongest confirmation available.
2. **Backoff belongs to work-retry and is missing from periodic ticks — in all three
   repos.** personas-cloud: 3 work-retry paths exponential (`dispatcher.ts:1433`,
   `db.ts:805`, `connection.ts:386`), **9 of 9 periodic ticks with none**. brainiac:
   worker loop exponential to a 30 s cap (`main.rs:746-748`), gateway jittered with a
   circuit breaker (`resilience.rs:229-234`), **sweeps none** — and its sweep claim
   advances `next_run_at` *before* knowing the outcome (`sweeps.rs:244`), so a
   permanently failing sweep re-fires at exactly its cadence forever. Personas: 5
   bounded retries with backoff, **0 of 22 perpetual loops with any**. Three
   independent codebases, same split, same direction. This is the most convergent
   finding in this document and B2 should be read as physics.
3. **Both SIGINT and SIGTERM, or the shutdown path is dead in production.** brainiac
   `main.rs:609-618` races both, and its doc comment records that a ctrl_c-only future
   *had left the whole path dead code in the primary deploy target*. personas-cloud
   registers both at `index.ts:161-162`. **Personas' desktop binary handles neither,
   and its daemon has the correct helper written and uncalled (S1a).** brainiac found
   and fixed the exact bug that is live here.
4. **A wall-clock lease stands in when a loop cannot be cancelled.** brainiac
   `sweeps.rs:46` (`RUNNING_STALE = "2 hours"`, *"a `running` row older than this is
   treated as crashed"*) and `queue.rs:114` (visibility timeout → dead-letter);
   personas-cloud `db.ts:786` (`recoverStaleProcessingEvents`, 5 minutes) plus a 90 s
   worker heartbeat timeout; personas `reap_stuck_processing_events` (300 s). Three
   reinventions of the same compensating layer.
5. **Bound the work per tick and break on no progress.** personas-cloud's
   `CLAIM_BATCH_SIZE = 50` and `MAX_MICROTASK_REENTRIES = 10`; brainiac's batch 8 /
   concurrency 4; personas' `MAX_PROMOTE_PER_TICK = 16`.

**The controlled-experiment shape — found three times, and once inside Personas.**
The brief asked for a sibling that treats two of its own surfaces differently. There
are three, and they all say the same thing:

- **brainiac, same binary, ~500 lines apart.** `worker_loop` (`main.rs:722`): raced
  wait ×2, exponential self-heal backoff, joined by the server on shutdown
  (`main.rs:519`), drains its in-flight batch. The sweep task it spawns
  (`sweeps.rs:261`): bare `tokio::spawn`, `JoinHandle` discarded, no shutdown receiver,
  no backoff, killed mid-flight on every deploy, un-wedged only by a 2-hour reaper.
- **personas-cloud, same function, ~40 lines apart.** `index.ts` captures
  `triggerSchedulerTimer` (`:122`) and clears it (`:152`), captures `eventProcessor`
  (`:108`) and stops it (`:151`) — then creates two more perpetual intervals at `:125`
  and `:135` that are never captured, never cleared and never `.unref()`'d. 2 clean, 2
  leaked, one `main()`.
- **personas-cloud again, one lesson learned and not propagated.**
  `useIngestFeed.ts:6-10` opens with a comment that reads as a post-mortem — *"an
  interval cannot (a) guarantee the previous request finished … or (b) back off when
  the feed is failing, which turned a down/erroring endpoint into an un-throttled
  request storm"* — while `NavDashboard.tsx:78` and `NavStatus.tsx:37`, polling the
  same endpoint, are exactly the naive `setInterval` that comment warns about.
- **Personas' own, and the sharpest of the four: two binaries, one crate.**
  `daemon_bin.rs` — shutdown channel, both loops raced, handle retained and awaited,
  explicit drain, a SIGTERM helper written (if uncalled). `lib.rs` — no signal handler,
  no shutdown channel, `RunEvent::Exit` reaching 1 subsystem, 22 loops with no stop and
  13 bare waits. Same tokio, same author, same repo. **The correct shape is not
  unknown here; it is unrouted.**

**Where convergence contradicts me — reported honestly.**

- **The liveness registry is NOT convergent, and by the oracle's letter it is local
  calibration.** Neither sibling has one. brainiac's `/health` (`http.rs:218`) returns a
  hardcoded `{"status":"ok"}` and would answer 200 with the worker stone dead; it has
  no heartbeat row, no `last_tick_at`, no crash counter — its own comment says the only
  liveness evidence is log volume (`main.rs:749-751`). personas-cloud's `/health`
  (`httpApi.ts:1583`) reports workers and executions and says nothing about the trigger
  scheduler or the event processor. **Personas is the only one of the three that built
  a `SubscriptionHealth` registry — and it does not read the richest half of it (O5).**
  Per the refinement that *convergence measures who audits, not who needs it*, I do not
  read this as evidence the requirement is unreal: brainiac's `alerts.rs:1-7` names the
  exact failure mode — *"the central negative finding was not a crash; it was
  silence"* — and then builds its detector **inside the loop that would go silent**.
  Two repos independently needed it, neither discovered it, one wrote down the need
  and then reinvented the bug. **Principle clause 3 is marked as a house convention
  whose siblings' own post-mortems argue it should be doctrine.** That is the honest
  characterisation, and it is weaker evidence than clauses 1 and 2.
- **`MissedTickBehavior` is local calibration and does not port.** brainiac has
  **zero** `tokio::time::interval` in the workspace — every wait is a `sleep`, so the
  burst-catch-up hazard cannot occur. personas-cloud's `setInterval` does not burst.
  O1 is a tokio-`Interval`-specific defect; a sibling on another stack must re-derive
  its own overlap question rather than inherit this one.
- **"Racing the wait" is not universal — it is *async*-specific, and the sibling shows
  the alternative.** personas-cloud's mechanism is *clear the timer*, not *race the
  wait*: a `setInterval` callback is not interruptible mid-body, so its raced-wait
  count is structurally 0/13 and the meaningful metric is 11/13 cleared, 2/13 leaked.
  A porting repo must ask "what is the interruption primitive on this stack?" before
  taking clause 1 literally. Personas' own Python-facade-equivalent case is
  personas-cloud's `facade/main.py:20-27`, where `asyncio` cancellation *does*
  interrupt the sleep — but the lifespan handler cancels without awaiting
  (`main.py:49-51`), so shutdown never confirms the loop stopped. Same clause, third
  spelling.
- **Harness adoption inverts in Personas' favour.** brainiac has no periodic harness at
  all (1 shared `sleep_or_shutdown` with 2 call sites, plus a genuine table-driven
  sweep registry for 5 jobs). personas-cloud has **none** — 13 hand-rolled
  `setInterval` sites across **4 competing lifecycle idioms**. Personas' 36/58 = 62%
  adoption of `ReactiveSubscription` is the best of the three by a wide margin. The
  deviations above should be read against that: this is a leaf where the repo is ahead
  of both siblings and still has 22 loops nobody can stop.

## The missing gate

Nothing gates any of this today. Every deviation above shipped under a green
`npm run check`, a green `cargo clippy -- -D warnings` and a green `cargo test`.
`conventions.json`'s `codeRules` say nothing about background loops; `CLAUDE.md`
mentions the night-shift heartbeat only as a memory entry; `ReactiveSubscription` and
`PeriodicTask` appear in no `docs/` page. **A developer following every documented rule
in this repo writes `tokio::spawn(async move { loop { sleep(60).await; … } })` and
passes review** — which is, measurably, what happened 22 times.

### The semantic condition

**Work that is scheduled to repeat, in a way no stop can reach.** It has three faces
here: a wait that is not raced against a stop (S2), a loop registered with no
supervisor so its silence is unobservable (O6), and a failure that costs the same as a
success (B2). Only the first is countable by a machine; see *The parts no census rule
can cover*.

**The signal below is a manifestation.** It keys on Rust's `tokio::select!` idiom
because that is what "an interruptible wait" looks like in this stack. **A sibling repo
must re-derive its own proxy for the same condition:** *what is the interruption
primitive on this stack, and does the loop's wait go through it?* In personas-cloud the
answer is not a raced wait at all — a `setInterval` callback cannot be interrupted, so
the equivalent proxy is *"the timer handle is captured and cleared on shutdown"*
(11/13 there, and the 2 misses at `index.ts:125`/`:135` are exactly what it would
catch). In brainiac the same signal would report a permanent **zero**, because
`sleep_or_shutdown` means every wait is already raced — which is what a correct repo
looks like from the outside, and why the runner's zero-match assertion is load-bearing.

**Preconditions this signal depends on, stated so they can be checked before porting:**
(a) the stack has a construct that races a wait against a signal (`tokio::select!`); (b)
loops are written with the wait as the loop's first statement, which is the idiom in
both this repo and brainiac; (c) `rustfmt` keeps `loop {` and its first statement on
separate lines, which it does. None of these is semantic — hence the `floor` and
zero-match assertions.

### Check first: is this already gated?

No. The adjacent rule is `unbound-child-lifetime`
([`cancelling-in-flight-work.md`](./cancelling-in-flight-work.md) §9), which matches
`Command::new(` → `Stdio::piped()` → `.spawn()` with no `kill_on_drop` — a **child
process** signal over a disjoint population (12 matches, all `Command` builder chains;
zero overlap with the 13 below, verified by comparing hit lists). `looping-framer-animation`
(`motion-and-reduced-motion.md`) is a frontend CSS/framer signal. Nothing in the 68-rule
registry keys on a tokio loop, an `Interval`, a `sleep`, or a task spawn.

### Census rule (validated)

Do **not** paste this into `scripts/census/rules.json` yourself — the orchestrator
merges it. Validated against the runner at commit `a385c159d`, using a scratch registry
at `scratchpad/rules-background-loop.json` and a standalone driver over
`scripts/census/lib/engine.mjs`.

```json
{
  "id": "unraced-loop-wait",
  "goldenPath": "docs/concepts/golden-paths/background-loop.md",
  "title": "Background loop whose time-wait is not raced against a stop signal",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\bloop\\s*\\{[ \\t]*\\r?\\n(?:[ \\t]*//[^\\n]*\\r?\\n)*[ \\t]*(?:(?:[A-Za-z_][A-Za-z0-9_]*\\s*\\.\\s*tick\\s*\\(\\s*\\)|(?:tokio::)?time::sleep\\s*\\([^;{}]{0,200}?\\))\\s*\\.\\s*await|(?:std::)?thread::sleep\\s*\\([^;{}]{0,200}?\\))\\s*;",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a `loop {` whose FIRST statement is a bare, un-raced time wait — an Interval tick, a tokio sleep, or a blocking thread::sleep awaited on its own rather than inside a `tokio::select!` that also arms a stop signal. For the whole interval nothing can reach the loop: app exit, a scheduler stop, a cancellation token and a user Stop all wait the timer out. PROXY FOR the stack-free condition 'a repeating unit of work no stop can reach'; the compliant form in this stack opens with `tokio::select!` racing the wait against a cancellation token, a shutdown receiver or an OS signal (`daemon_bin.rs:167`, `p2p/periodic.rs:94`)"
  },
  "baseline": { "files": 12, "matches": 13 },
  "floor": 900
}
```

**Positive control** — the same anchors pointed at the **compliant** shape. It carries
no `baseline` by design: a ratchet is monotone-downward, and a rule counting correct
code would fail the build every time adoption improved.

```json
{
  "id": "raced-loop-wait-positive-control",
  "goldenPath": "docs/concepts/golden-paths/background-loop.md",
  "title": "POSITIVE CONTROL — a loop that DOES race its wait. Must match; must never be baselined.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\bloop\\s*\\{[ \\t]*\\r?\\n(?:[ \\t]*//[^\\n]*\\r?\\n)*[ \\t]*tokio::select!\\s*\\{",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL for `unraced-loop-wait`: the same two anchors (`loop {` and its FIRST statement) pointed at the CORRECT form — a loop that opens by racing its wait inside `tokio::select!`. If the violation rule were keying on the token `loop` rather than on the SHAPE of its first statement, this control would return the same population. Measured 2026-08-15: 8 files / 9 matches, and the two hit lists are fully DISJOINT. Exists to be run, never to gate."
  },
  "floor": 900
}
```

**Measured.** 963 Rust files walked (matches `shared-facts.json` `rust.files: 963`
exactly), **12 files / 13 matches**, `--check` exits 0. The positive control returns
**8 files / 9 matches** over a **completely disjoint** set — no file appears in both —
which is the discrimination proof: the same `loop {` anchor, the same "first statement"
anchor, opposite populations, because the discriminator is the *shape of the wait*, not
the presence of a loop.

**Precision, hand-verified 13/13 — with the severity split stated rather than hidden.**
Eleven are unambiguous perpetual loops with no stop of any kind:
`commands/infrastructure/auth.rs:821` (the marquee — 60 s, no backoff, no ceiling),
`db/src/embedder.rs:211`, `cloud/remote_commands.rs:171`,
`commands/execution/alert_evaluator.rs:362`, `commands/fleet/stale.rs:205`,
`commands/fleet/transcript.rs:54`, `commands/obsidian_brain/graph.rs:778` (the OS
thread — the worst case, since no tokio-level shutdown could ever reach it),
`engine/project_tracking/scheduler.rs:59` (3,600 s — the longest un-interruptible wait
in the repo), `engine/resource_governor.rs:42`, `freeze_monitor.rs:84`, `lib.rs:1244`.
Two are **lower-severity but literally true**: `engine/pipeline_executor.rs:467` and
`:736` sleep 1 s and then check a cancellation flag on the next line. Their wait is
genuinely un-raced — cancellation latency is bounded only by the sleep — but at 1 s
that is a deliberate polled-cancel, and `:736`'s comment states the design (*"Wait
indefinitely for a human decision … The only exits are an explicit approve (flag) or a
pipeline cancel"*). Read strictly ("no reachable stop") precision is 11/13; read as
written ("the wait is not raced") it is 13/13. Both numbers are stated so a reviewer can
pick.

**No `exclude` entries.** `pipeline_executor.rs` is the only exemption candidate and
excluding a whole file to excuse two deliberate polled-cancels is how an allowlist
becomes a place violations hide — the contract's own warning. They stay counted, with
the reason written above. If they are ever fixed the baseline ratchets down.

**Verified through a second, independent implementation before baselining,** per the
contract — and the disagreements were the findings.

The second implementation brace-matches every `loop {` over comment-and-string-blanked
source, extracts the body's **first statement** (up to the first top-level `;` or the
first balanced block), and classifies it — no shared code with the regex. It reported
**15 bare** against the census's 12. Resolving all three disagreements:

- **Two are implementation-B bugs, and they are the same bug.** For
  `connector_readiness.rs:424` and `lib.rs:1068` B's first-statement extractor returned
  an entire `match { … }` block that *contained* a sleep, then matched the sleep inside
  it. The census is right: neither loop opens with a wait. **This is the "statement WITH
  its consequent" hazard in its exact documented form** — B counted the consequent as
  the statement.
- **One is a genuine recall gap in the census, and it was fixed before baselining.**
  B found `obsidian_brain/graph.rs:778`, a `std::thread::spawn(move || loop {
  std::thread::sleep(500ms); … })`. The original pattern covered only `tokio` waits. The
  pattern was widened to `(?:std::)?thread::sleep`, taking the count from 11/12 to
  12/13 — and the added case is the **worst** loop in the population, an OS thread that
  no async shutdown could reach even if one existed.
- **A fourth disagreement, on the control side, is itself a finding.** B reported only 2
  raced loops against the control's 8, because B's timer detector required an explicit
  `.await`. **Inside `tokio::select!` the timer arm has no `.await`** — `_ = interval.tick() => {}`.
  That is precisely why the compliant form must be anchored on `tokio::select!` rather
  than on "a wait", and it is why a naive "does this loop contain a stop check?" matcher
  under-reports correct code.

**Known recall limits, stated rather than hidden.** The signal catches **12 of the 22**
un-stoppable perpetual loops — **recall ≈ 55%**. It misses every loop whose first
statement is a *guard* rather than the wait, with the wait at the bottom of the body:
`db/src/lib.rs:229`, `lib.rs:1367`, `lib.rs:1424`, `discord_poller.rs:75`,
`slack_poller.rs:107`, `team_slack_relay.rs:522`, `webhook_notifier.rs:776`,
`companion/mod.rs:127`, `companion/mod.rs:341`, `smee_relay.rs:609`. A
`sleep-at-the-bottom` variant is expressible but needs brace matching to know where the
body ends, and an unbounded-window regex attributes matches across function boundaries —
the trade was made toward precision and is recorded here rather than papered over. The
ten misses are all named in Deviation S2's table, so the fix backlog is complete even
though the ratchet is not.

**How it fails loudly if its own precondition is absent** — all six verified by running
the runner, not asserted:

| Perturbation | Result | Exit |
|---|---|---|
| baseline `matches: 12` (real 13) | `[drift] matches rose 12 -> 13 (+1)` | **1** |
| baseline `matches: 14` (real 13) | `[drift] matches dropped 14 -> 13 (-1) without the baseline moving` | **1** |
| `floor: 5000` (walk sees 963) | `[structural] walked 963 files but floor is 5000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` | **1** |
| loop idiom renamed so the pattern matches nothing | `[structural] matched zero files anywhere` — fires in report mode too | **1** |
| `roots` narrowed to one crate (a moved crate) | `[structural] walked 115 files but floor is 900` **and** `[structural] matched zero files anywhere` | **1** |
| a `baseline` added to the positive control | `validateRule`: *"a positive control must NOT carry a baseline — it exists to fail"* | **1** |
| unperturbed, report mode and `--check` | 12 files / 13 matches, control 8/9 | **0** |

`floor: 900` against 963 walked leaves ~6.5% headroom — tight enough that deleting a
crate or breaking the `.rs` glob fails structurally rather than reporting a clean tree.
The zero-match case matters most here: the whole premise is a formatting idiom
(`rustfmt` putting `loop {` and its first statement on separate lines), and it must
scream rather than go green if that idiom moves.

### The parts no census rule can cover

Four of this leaf's most expensive defects are **relational or absential**, and a regex
cannot check that two things refer to each other, still less that a third thing is
missing.

1. **A loop that is not in the liveness registry** (O6, 22 loops). The condition is a
   *negative join*: does any code path from this `loop` reach `mark_subscription_alive`?
   No lexical signal exists, because the violation is the absence of a call the author
   never considered. The honest fix is the type: a loop that cannot be written outside
   `ReactiveSubscription` is registered by construction. **This is the strongest
   argument in the document for fixing Gaps 1–5 rather than adding a second rule.**
2. **An on/off switch that does not reach what it claims to** (contract rule 2). The
   check is "for every loop spawned in `setup`, is there a path from `stop_loops` to
   it?" — a call-graph reachability question. The right host is a Rust integration test
   that starts the engine, calls `stop_loops`, and asserts every registered loop's
   `alive` flips — which is impossible today for the 22 that register nothing.
3. **A tick whose failure is invisible to its supervisor** (B3). An AST rule could flag
   `async fn tick(&self)` bodies whose only error arm is a `tracing::` macro, but the
   real fix is the trait signature: make `tick` return `Result` and the compiler makes
   every swallowed error visible at the `?`. The precedent is in-repo — `PeriodicTask`
   already has it.
4. **`MissedTickBehavior` left at the default** (O1) *is* lexically expressible — "a
   `tokio::time::interval(` with no `set_missed_tick_behavior` within N lines" — but at
   13 of 16 sites it would be a rule whose baseline is almost the whole population, and
   the correct fix is one line in `run_single` covering 36 of them at once. **Per the
   contract's "prefer fixing the default over counting the callers": fix `run_single`,
   then re-measure; a rule seeded at 13 would ratchet a problem that one edit removes.**

The client half of this leaf — a React surface that renders whether a backend loop is
alive — is not a gate question at all. `SubscriptionHealth` is fully typed, fully
exported and fully unread (O5). No rule can require a component to exist. That is a
product decision, recorded here as the finding it is: **the app already computes the
answer to "is the background work still running?" for 36 of its 58 loops, and shows it
only to whoever opens Overview → Health.**
