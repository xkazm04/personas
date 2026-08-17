# Golden path — Panic isolation

> Situation node: `backend-runtime/background-work/panic-isolation` ·
> [situation spine](../situation-spine.md) · recurrence 29 · risk **MEDIUM** ·
> sides: **server** · convergence: **diverged — and §6 says the spine is right,
> but for a reason the label does not carry (§12.1)** ·
> dimensions: **resilience · ui · code-quality**
> Composed 2026-08-16 against `master` @ `17d059b1f`.
>
> **Sweep.** All **963** `.rs` files under `src-tauri`. Every `spawn`-family call
> site in the tree located by a paren-matching scanner and classified — **289
> raw, 274 production** after a brace-matched `#[cfg(test)]` exclusion. All **49**
> production `catch_unwind` sites opened; all **3** `is_panic()` sites opened; all
> **26** definitions of `extract_panic_message` extracted and compared byte for
> byte. Read in full: `src/logging.rs` `install_crash_hook` / `read_crash_logs` /
> `prune_crash_logs` (lines 1–60, 226–375), `src/engine/subscription.rs`
> `run_single`'s panic arm (`:1313–1390`) and `run_blocking_tick` (`:112–131`),
> `src/engine/background.rs` `SubscriptionHealth` + `record_subscription_crash`,
> `src/engine/mod.rs`'s three panic arms (`:1140`, `:1857`, `:3799`),
> `src/companion/remote_jobs.rs:98–170`, `src/commands/fleet/wait.rs:150–200`,
> `src/commands/fleet/registry.rs:738–851`, `src/engine/api_proxy.rs:40–160`,
> `src/lib.rs` `RunGuard`, `src-tauri/Cargo.toml`'s four profiles.
>
> **Measured by executing, not by reading.**
>
> 1. **The operator's `crash_logs/` directory was opened and every file read** —
>    `%APPDATA%/com.personas.desktop/crash_logs`, **20 files**, 2026-06-03 →
>    2026-08-06. Every `Panic:` / `Location:` / `Thread:` line and every stack
>    frame counted. This is the instrument the brief asked about and, as far as
>    this repo's history shows, nobody had opened it.
> 2. **Read-only copies of both live SQLite files** (`personas.db` 347 MB,
>    `personas_data.db` 17.5 MB, copied 2026-08-16 18:00 local with their
>    `-wal`/`-shm`, opened `readOnly: true`). The live files were never opened for
>    write; `engine-leader.lock` was heartbeating at copy time. **The 20 panic
>    executions were joined to the crash files by timestamp**, which is how the
>    filename collision in §0.2 was found. **The copies were deleted afterwards.**
> 3. The §9 rule was measured by **two independent implementations** — a
>    comment/string-blanking Rust scanner with paren matching, and the census
>    engine — which agree on **211 of 211** sites with **zero** membership
>    disagreement and **one** classification disagreement, hand-verified and
>    reported below. **Fault-injected 18 ways.** Overlap-checked against **469
>    match sites** of the ten nearest existing rules (**1** collision, named).
>    Validated in a composer-private scratch registry, then **re-extracted from
>    this finished document and re-run** — identical. **The full registry was NOT
>    run**, per the doctrine.
> 4. **`cargo` was not run** (the operator's app is running) and **no second app
>    instance was started**. Every Rust claim is static and traces to a file
>    opened during composition.
> 5. All **five** sibling checkouts opened and swept (§6).

---

## 0 The headline: 274 places in this app start work that can die, and 1 of them can tell you it died

`src/companion/remote_jobs.rs:134-136` — the only site in 963 files that turns a
task's abrupt death into a value — says so itself:

```rust
// INNER spawn: its JoinHandle turns a panic into a value we can report,
// instead of a task that vanishes and a job that never finishes.
let inner = tokio::spawn(async move { run_turn(turn_app, instruction, turn_source).await });
```

That comment is this leaf's entire principle, written in this repo, by someone
who needed it. **It is 1 of 274.**

| the surface | count |
| --- | ---: |
| production `spawn`-family call sites (`tokio::spawn`, `tokio::task::spawn_blocking`, `tauri::async_runtime::spawn`, `std::thread::spawn`) | **274** |
| of those, **statement-position** — the `JoinHandle` is created and destroyed in the same statement | **210** (77%) |
| statement-position **and** carrying no panic boundary anywhere in the body | **165** |
| of those 165, spelled `let _ = spawn(…)` — the discard made explicit and still unobserved | **4** |
| sites that call `JoinError::is_panic()` | **3** |
| of those 3, sites that convert the panic into a value a caller can act on | **1** (`remote_jobs.rs:145`) |
| the other 2 | `resume_unwind` — they *re-raise* into an enclosing `catch_unwind` (`subscription.rs:128`, `pattern_miner.rs:390`) |
| sites that `.await` a handle and flatten `Result<_, JoinError>` with `.map_err(…)` | **40** |
| … with `.ok()` — a panic becomes `None`, indistinguishable from "no value" | **7** |
| sites that `.await.unwrap()` / `.await?` / `.await.expect(` a handle | **0** |

**Zero `.await.unwrap()` is the surprising cell.** Nobody in this codebase
promotes a child's panic into the parent. That is a real strength, and it is why
this leaf's failure mode is *silence* rather than cascade.

### 0.1 The live population: 28 recorded panic events in ten weeks, and where each one went

| | |
| --- | ---: |
| `persona_executions` rows whose `error_message` starts `Internal error (panic):` | **20** |
| share of all **258** failed + incomplete executions | **7.8%** · **8.4%** of the 238 `failed` |
| of those 20: rows with tokens / cost / `duration_ms` / `output_data` | **0 / 0 / 0 / 0** |
| of those 20: rows that had written a `last_heartbeat_at` or a `claude_session_id` first | **0 / 0** |
| median time from `started_at` to `completed_at` | **~1.0 s** |
| distinct panic messages behind all 20 | **1** |
| files in `crash_logs/` | **20** (`CRASH_LOG_RETENTION = 20`, `logging.rs:34` — the directory is *saturated*) |
| distinct crash files those 20 executions map to | **12** |
| crash files with **no** execution row at all | **8** |

**The 20 rows carry one message**, and it is not ours:

```
Internal error (panic): state() called before manage() for alloc::sync::Arc<app_lib::AppState>
Location: …\tauri-2.11.2\src\lib.rs:734:7
```

`app.state::<T>()` inside a spawned task, panicking because the `TypeId` asked
for is not the one `.manage()` was given —
[process-global-command-state](./process-global-command-state.md) measured that
**40 of 74 reach-ins use the panicking `state::<T>()` rather than `try_state`**,
and observed that *"in a spawned task, that panic is silent."* These 20 rows are
that sentence's price, paid.

The other 8 crash files are three of our own sites: `engine/eval.rs:534` and
`:649` (2026-06-13, both UTF-8 byte-slicing) and **`commands/fleet/wait.rs:176`
(2026-08-05 ×2, 2026-08-06 ×1)** — plus 3 more `state()` panics in tasks that
were not persona executions. **None of the 8 produced a row anywhere.** The only
artifact is a file.

> **All 20 crash reports are on a `tokio-rt-worker` thread. Not one is on the
> main thread.** In this app, "a panic" and "a panic in a spawned task" have been
> the same event, every single time, for ten weeks.

### 0.2 The crash log is the only universal panic observer — and it is lossy three separate ways

`std::panic::set_hook` (`logging.rs:245`) runs on **every** panic in the process,
including the ones `catch_unwind` goes on to recover. It is therefore the one
instrument that sees all of them. It fails at it three ways, all measured on
disk:

1. **Same-second overwrite.** The filename is
   `crash_{%Y%m%d_%H%M%S}.log` (`logging.rs:248-249`) and the write is
   `fs::write` — truncating. Joining the 20 panic executions to their crash files
   by timestamp: **the 20 events collapse onto 12 files. Eight reports (40%)
   were overwritten by a sibling panicking in the same second.** One boot produced
   5 panics inside one second and left one file. Concurrency is exactly the
   condition under which the reports matter most.
2. **No application frames.** The hook formats
   `std::backtrace::Backtrace::force_capture()` with `{}` (`logging.rs:280-283`),
   which is std's *short* style. **17 of the 20 files contain exactly 7 stack
   frames, of which the only `app_lib` frame is
   `app_lib::logging::install_crash_hook::closure$0` — the hook logging itself.**
   The other 3 (2026-08-05/06) carry 76 frames and name the real call chain
   (`wait::WaitHandle::diagnostics` ← `wait_for_running` ←
   `registry::write_text_line`), which is exactly how §0.3 below was found. And
   `Location:` does not rescue the other 17: for the 15 `state()` reports it
   points into `tauri-2.11.2/src/lib.rs`. **For 15 of 20 recorded panics there is
   nothing in the crash report that identifies a line of this repo.**
3. **The doc comment is wrong about what it is for.** `lib.rs:804` says *"Install
   panic crash hook that writes to `crash_logs/` **before aborting**"* — but
   `Cargo.toml:316` sets `panic = "unwind"` deliberately, and **20 of 20 files on
   this machine are panics the app survived.** Nothing in `crash_logs/` is a
   crash. The directory is a *recovered-panic* log wearing a crash log's name,
   which is why a saturated 20-file directory has never prompted anyone to look.

`get_crash_logs` → `read_crash_logs` (`logging.rs:305`) truncates to the newest
**10**, so the UI at `overview/components/health/CrashLogsSection.tsx` (rendered
by `SystemHealthPanel.tsx:117`) can show at most half of what is on disk. The
surface exists and works; there is no evidence it has been opened.

> **The retention asymmetry is the reason this leaf is worth writing.** The
> rolling tracing log keeps **7 days** (`TRACING_LOG_RETENTION`, `logging.rs:39`)
> — the directory today holds `personas.2026-08-11.log` … `2026-08-16.log`. The
> crash directory keeps **20 files** regardless of age, so it currently reaches
> back to **2026-06-03**. **For every panic older than a week, the crash report is
> the only surviving evidence, and for 15 of 20 it names no call site.**

### 0.3 The live bug, and it is the doctrine's own warning coming true

`src/commands/fleet/wait.rs:175-177`:

```rust
let tail = if snap.len() > RAW_TAIL_CAP {
    snap[snap.len() - RAW_TAIL_CAP..].to_string()   // byte index, not a char boundary
```

`snap` is raw PTY output. `RAW_TAIL_CAP = 2048` (`wait.rs:38`). Terminal
box-drawing runes are 3 bytes, so `len() - 2048` lands mid-character routinely.
It panicked **three times** (`'─'`, `'❯'`, `'─'`), and the 76-frame reports name
the whole chain:

```
alloc::string::index<RangeFrom<usize>>
app_lib::commands::fleet::wait::WaitHandle::diagnostics       <- wait.rs:176
app_lib::commands::fleet::wait::WaitHandle::miss
app_lib::commands::fleet::wait::wait_for_running
app_lib::commands::fleet::registry::write_text_line::async_block$1
tokio::runtime::task::harness::poll_future                    <- the task dies here
```

The containing task is `registry.rs:753`
`tauri::async_runtime::spawn(async move { … })` — **detached**. `write_text_line`
has already returned `Ok(())` at `:850`. The spawned task exists to confirm the
Enter keypress landed and to press it a second time if not (`:767 for attempt in
1..=2`), and to `warn!("fleet write_text_line: submit unconfirmed after 2 Enter
attempts")` at `:837` if it never does. **The panic skips all of it.** The
`JoinHandle` was dropped at the semicolon, so the `JoinError` goes nowhere. The
caller believes the line was submitted. There is no log line, no event, no row —
only a file in `crash_logs/`.

**And the class was already fixed once, elsewhere.** Commit `6734382bf`
*"fix(engine): char-boundary-safe truncation in eval — no more UTF-8 slice
panics"* closed `eval.rs` after the 2026-06-13 pair. `wait.rs:176` panicked
**seven weeks later** because it never contained the literal that pass searched
for. This is the doctrine's *"fixing every instance of a defect is not the same
as covering every place that needs the behaviour"*, reproduced end to end inside
one repo with dated evidence on both sides.

### 0.4 The primitive exists 26 times and is `pub` zero times

`fn extract_panic_message(panic: Box<dyn Any + Send>) -> String` is defined in
**26 different files**. Extracted and normalised, all **26 bodies are byte
identical**:

```rust
if let Some(s) = panic.downcast_ref::<&str>()   { return s.to_string(); }
if let Some(s) = panic.downcast_ref::<String>() { return s.clone(); }
"unknown panic".to_string()
```

Every one is a private `fn`. Four more open-coded copies of the same ladder live
in `engine/mod.rs:1141`, `:1858`, `:3800` and `subscription.rs:1325`, and a fifth
in the crash hook (`logging.rs:261-267`) — **31 copies of an 8-line function, in
one crate, none shared.** There is no primitive to route people to; the pattern
propagates only by copy-paste, and copy-paste is why it stops at the 45 sites
that got it and never reaches the 165 that did not.

### 0.5 What the supervised loops prove, and what they do not cover

`run_single` (`subscription.rs:1218`) is the good half of this app: an
`AssertUnwindSafe(sub.tick()).catch_unwind()` boundary (`:1319-1324`), a message
downcast, `record_subscription_crash`, a `subscription-crashed` Tauri event, and
exponential backoff past `PANIC_BACKOFF_THRESHOLD = 3` (`:1185`, ×2 per panic
capped at ×16). **All 39 production subscriptions inherit it.**

But it terminates at the supervisor:

| instrument | reads |
| --- | ---: |
| `SubscriptionHealth.consecutive_panics` — production readers in 963 `.rs` files | **1** (`health.rs:739`, → `HealthCheckStatus::Warn`) |
| `consecutivePanics` — reads in 4,828 `.ts`/`.tsx` files | **0** (only the generated binding `SubscriptionHealth.ts:31` and the registry declaration `eventRegistry.ts:1007`) |
| `subscription-crashed` — `listen(` consumers | **0** (confirming [background-loop](./background-loop.md) §Gaps) |
| after the loop exits, `mark_subscription_dead(name)` (`subscription.rs:1427`) — but `run_single` never `break`s on panics, so the only way out is a generation bump | n/a |

A subscription can panic every tick forever, backing off to ×16, and the entire
observable consequence is an amber dot on a health panel and 39 identical
`error!` lines a day.

### 0.6 The poisoned lock: where this path and its neighbour pull opposite ways

`panic = "unwind"` means a panic inside a `std::sync::Mutex` guard poisons it.
What the tree does about that, measured over 963 files with `#[cfg(test)]`
ranges excluded:

| treatment of a poisoned lock | matches | files |
| --- | ---: | ---: |
| **tolerate** — `unwrap_or_else(\|e\| e.into_inner())` | **270** | 54 |
| **propagate** — `.lock().unwrap()` (35) / `.lock().expect(` (19) | **54** | 17 |
| **refuse** — `clear_poison()` + reset the protected value + return an error | **3** | **1** (`engine/api_proxy.rs`) |

[process-global-command-state](./process-global-command-state.md) §2.8 prescribes
the middle row — *"Take poisoning as recoverable. `unwrap_or_else(|e|
e.into_inner())`"* — and it is right about the alternative it was arguing against
(`.unwrap()` propagates one command's bug to every later command, permanently).
**But `into_inner()` alone discards the only in-band evidence a panic ever
produces.** `api_proxy.rs:54-65` is the one place that does the whole job:

```rust
let mut guard = poisoned.into_inner();
*guard = None;                                     // the state a panic half-wrote is not state
CONNECTOR_CACHE.clear_poison();
return Err(AppError::Internal(
    "Connector cache state was lost after a prior panic; please retry.".into()));
```

One file in 68 treats a poison flag as what it is — a panic that already
happened. See §6 *Interaction with neighbouring prescriptions*.

### 0.7 Sibling boundaries, settled in prose

[**background-loop**](./background-loop.md) owns the supervised periodic tick and
its `catch_unwind`. **This path owns every spawned unit that is not one** — 274
sites against its 36, and the 165 with no boundary are all outside its reach.

[**long-running-job-progress**](./long-running-job-progress.md) owns the
*registered* job — `insert_running` → terminal write, "15 of 16 job files
`catch_unwind`". **This path owns the 165 spawns that register nothing**, where
there is no row to leave stuck and therefore nothing to sweep either. Its
prescription (Drop guard > panic arm) is the right one and this path adopts it
verbatim (§2c).

[**stall-watchdog**](./stall-watchdog.md) owns whether a ticking loop produced
anything. **This path owns whether the thing that was going to produce it is
still alive.** Its `outcomeless-tick` and this rule share **0** match sites.

[**terminal-state-and-recovery**](./terminal-state-and-recovery.md) owns what a
recovery pass writes; it already points here for *"a panic inside a detached
task"* (`:248-249`). **This path owns making the panic visible in the first
place** — an age-based sweep can only *guess* that a task died.

[**process-global-command-state**](./process-global-command-state.md) owns the
statics. **This path owns what a panic does to them** — §0.6 and §0.1's 20 rows
are both its measured cases.

The **Deviations** section is a fix backlog and contains **one live panic on
`master`** (D1), **one unattributable crash instrument** (D2), and **161
unobservable tasks** (D4).

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no
file path, primitive name or count. Each clause names its warrant, and the
warrants come from the six-repo sweep in §6.

> **P1 — physics, and the whole subject.** *A unit of work that can die
> abruptly must be started in a way that lets somebody find out.* The decision is
> made at the moment of dispatch, not afterwards: if the dispatch discards the
> only object that could carry the failure, no amount of downstream diligence can
> recover it. Detaching is a choice; make it deliberately and rarely.
>
> **P2 — physics.** *An abrupt death and a quiet success are the same observable
> unless something makes them different.* Nothing about "the task is no longer
> running" distinguishes finished, crashed, and cancelled. The difference has to
> be written down by the code that learns it, at the moment it learns it.
>
> **P3 — physics, and the clause the whole leaf turns on.** *A crash is only
> isolated when it has been converted into an outcome on the work item.*
> Containing the blast — the process survives, the other tasks keep running — is
> the easy half and every runtime gives it to you. The hard half is that the job
> the dead task was doing now has a state, and somebody is waiting on it.
> Isolation without conversion is just a quieter stall.
>
> **P4 — physics.** *Cleanup that is written as a statement after the work does
> not run when the work dies; cleanup bound to a scope does.* A slot released, a
> flag cleared, a registry entry removed, a lock unlocked — anything a failure
> path must undo belongs to a scope-bound guard, not to a line further down.
> This is the one clause where the language does the work for you, and it is the
> only clause you cannot forget once you have used it.
>
> **P5 — physics as a defect (5/5, this repo included).** *Nobody handles the
> lock that a crash left behind.* A crash mid-mutation leaves shared state
> half-written, and every mechanism that could tell you so is treated as noise to
> be stepped over. Where the platform hands you that signal, spend it: reset the
> value to something known and refuse the current call, rather than continuing on
> top of a half-write.
>
> **P6 — physics, reported as SILENCE 5/5 and therefore doctrine on absence.**
> *A crash report that does not name a line of your code is a receipt, not a
> diagnosis.* Capture the failing frame — not the frame of the reporter — and
> give the report an identity that survives two of them arriving at once. A
> timestamp at one-second resolution is not an identity.
>
> **P7 — ergonomics, and the reason the surface stays broken.** *If the
> conversion from "it died" to "here is the outcome" has no shared name, it will
> exist only where somebody pasted it.* Give it one home, exported, so a reviewer
> can see it is missing.
>
> **P8 — economics, and the honest limit.** *Not every detached unit deserves an
> outcome; every detached unit deserves a decision.* The cost of P1–P3 is real,
> and a cache invalidation that dies is genuinely fine. The defect is not
> detaching — it is detaching **by default**, so that the ones which mattered are
> indistinguishable from the ones which did not.

---

## 1 Trigger

- "This job never finished and there's nothing in the logs. Where did it go?"
- "Can a panic in one background task take the whole app down?"
- "I'm about to `tokio::spawn` something and not await it."
- "What happens to this `running` row if the code that owns it panics?"
- "Something in `crash_logs/` — is that a crash? Did the app restart?"
- "The mutex is poisoned. Can I just `into_inner()` it?"

If you are about to type `tokio::spawn(async move {` and end the statement with
`;`, `tauri::async_runtime::spawn`, `spawn_blocking`, `catch_unwind`,
`AssertUnwindSafe`, `is_panic()`, `resume_unwind`, `downcast_ref::<&str>()`,
`std::panic::set_hook`, `.lock().unwrap()`, `unwrap_or_else(|e| e.into_inner())`,
`s[i..]` on a `String` inside a spawned body, or `app.state::<T>()` anywhere
other than a command's argument list — you are in this situation.

**Not this path:** *a supervised periodic tick's own boundary* is
[background-loop](./background-loop.md); *a registered job's terminal write* is
[long-running-job-progress](./long-running-job-progress.md); *whether a ticking
loop produced anything* is [stall-watchdog](./stall-watchdog.md); *which terminal
state a recovery writes* is
[terminal-state-and-recovery](./terminal-state-and-recovery.md); *who is allowed
to run the loop at all* is
[loop-ownership-and-restart](./loop-ownership-and-restart.md); *the user pressing
Stop* is [cancelling-in-flight-work](./cancelling-in-flight-work.md); *routing a
caught `Err` to Sentry* is
[swallowed-error-telemetry](./swallowed-error-telemetry.md).

## 2 The one way

**Decide at the spawn whether anyone is waiting on this work, and if anyone is,
keep the handle and turn its abrupt death into that work item's outcome.**
Concretely: (a) **do not end a `spawn` statement with a semicolon** when a row, a
job, a user, or a caller is waiting — bind the `JoinHandle`, `.await` it, and
match on `Err(join) if join.is_panic()`; that arm writes the same terminal state
the failure path would have written, in the caller's own vocabulary
(`remote_jobs.rs:145` is the whole pattern in nine lines). (b) **If the work
genuinely cannot be awaited** — the dispatcher must return immediately — put the
boundary *inside* the task: wrap the body in
`AssertUnwindSafe(async { … }).catch_unwind().await` and give the `Err` arm a
durable write, not just a `tracing::error!`. Reach for (a) first: it needs no
`AssertUnwindSafe` reasoning, it composes with a timeout, and it is one `match`.
(c) **Put every undo in a `Drop` guard, never in a statement after the work.**
A slot, a flag, a registry entry, an in-flight counter — bind the guard *before*
the fallible work and move it into the task; then the panic arm has nothing left
to remember and cannot forget it. This is the only clause the compiler enforces
for you. (d) **Never take the panicking accessor inside a spawned body**:
resolve `State<'_, T>` in the command's signature and move the clone in;
`app.state::<T>()` in a task is a panic whose only witness is a file. (e) **Do
not slice a `String` by a computed byte index inside a task** — the three
recorded panics from our own code are all this, and two of them were fixed once
already in a different file. (f) **When a lock comes back poisoned, treat it as
the panic report it is**: recover the guard, reset the protected value to a known
state, and return an error naming the prior panic — do not silently continue.
(g) **Give the crash report an identity that survives concurrency and a
backtrace that names your frame**, or accept that it will not tell you where.
(h) **Export the panic-payload decoder once.** Then stop: do not add a second
panic hook, do not `resume_unwind` past a boundary you own, do not `.await` a
handle only to `.unwrap()` it, and do not add a sweep to compensate for a panic
you could have reported.

If you must get one right first: **(c)**. It is the only clause that survives
being forgotten, it is already implemented here 32 times, and it converts the
worst version of this defect — a leaked slot that bricks a feature until restart
— into nothing. **(a) is second**, because it is the only one that produces an
outcome rather than merely preventing damage.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src/companion/remote_jobs.rs:128-160` — the bound inner handle | **the one site to copy.** `let inner = tokio::spawn(…); let abort = inner.abort_handle();` then a four-arm `match tokio::time::timeout(T, inner).await` that separates `Ok(Ok(_))` / `Ok(Err(app))` / `Ok(Err(join))` / `Err(elapsed)` — and gives the *panic* arm its own user-facing sentence. Panic, error, timeout and cancellation become four different strings |
| `src/lib.rs:353-366` `RunGuard` + `:337` `register_run_guarded` | the RAII answer, with the instruction in its own doc comment: *"Move this into a `tokio::spawn` block to guarantee cleanup on both normal completion and task panic."* **15 call sites.** Prefer it to any panic arm that exists only to release something |
| `src/engine/build_session/mod.rs:73-93` `HandleDropGuard` | the same, plus a generation check so a stale guard cannot evict a newer handle. The strongest guard in the tree |
| `src/engine/subscription.rs:1218` `run_single` | the supervised path. If the work is periodic, **do not spawn it** — implement `ReactiveSubscription` and inherit the boundary, the backoff and the health record. See [background-loop](./background-loop.md) |
| `src/engine/subscription.rs:112-131` `run_blocking_tick` | the correct use of `resume_unwind`: a blocking closure's panic is re-raised onto the async tick so the *enclosing* boundary still counts it. Copy this shape whenever you cross `spawn_blocking` inside something already supervised — and only then |
| `src/engine/mod.rs:1075` + `:1140-1165` | the reference panic arm for a job that owns a row: `AssertUnwindSafe(async { … })` → `catch_unwind().await` → `persist_status_if_not_final(Failed, "Internal error (panic): …")` → **then unconditional cleanup** (concurrency slot, task map, cancel flags, completion waiters). The order matters: the cleanup is outside the `if let Err`, so it runs on both paths |
| `src/commands/infrastructure/kpi_scan.rs:585-600` | the same shape for a *job manager* job: durable `update_scan(status="error")` **and** `set_status(…, "failed")` **and** `emit_line("[Error] …")` — the panic reaches the database, the in-memory registry and the user's console |
| `src/engine/api_proxy.rs:54-65`, `:138-158` | **the only poison handling in the repo.** `into_inner()` → reset the value → `clear_poison()` → `Err("… state was lost after a prior panic; please retry.")`. The three `clear_poison` sites in 963 files are all here |
| `try_state::<T>()` (Tauri) | the non-panicking accessor. The 20 live panic rows are `state::<T>()` in a spawned task; `try_state` turns each into an `Option` you can report |
| `src/logging.rs:228` `install_crash_hook` | the process-wide last resort. Already installed — **do not add a second one**; `set_hook` is process-global and a second install would displace this one. Fix it (D2) rather than duplicating it |

**Do NOT build:** a second `std::panic::set_hook`; a `catch_unwind` whose `Err`
arm only logs; a `.await.unwrap()` on a `JoinHandle` (it converts a contained
panic into an uncontained one); a private `extract_panic_message` — there are
already 26; a stale-row sweep introduced *because* a task can panic (that is
[terminal-state-and-recovery](./terminal-state-and-recovery.md)'s job and it
should be the backstop, not the mechanism); a `panic = "abort"` profile (the ORT
DLL boundary at `Cargo.toml:314-316` depends on unwinding).

## 4 Steps

1. **Ask who is waiting.** A row in a status table, a `RemoteJobHandle`, a
   caller holding a `oneshot`, a user watching a spinner — if any of those exist,
   this task is *not* fire-and-forget and steps 2–4 apply. If genuinely nobody is
   waiting (a cache invalidation, a metrics ping), say so in a one-line comment
   at the spawn. **That comment is the deliverable of this step**, because the
   165 sites in §7 D4 are indistinguishable from each other today.
2. **Bind everything the failure path must undo into a guard, before the
   spawn.** `let (cancelled, run_guard) = registry.register_run_guarded(domain,
   &id);` then move `run_guard` into the task. Do not write the release anywhere
   else.
3. **Keep the handle.** `let h = tokio::spawn(async move { … });` — and then
   actually consume it: `match tokio::time::timeout(BUDGET, h).await { … }`.
   Four arms, four different outcomes. `remote_jobs.rs:139-159` is the template.
4. **Write the outcome in the panic arm, in the caller's vocabulary.** Not
   `format!("{join}")`. The user-facing string for a panic is *"The assistant
   crashed while working on that."*, not *"task 41 panicked"*. If the work owns a
   row, the arm must reach a durable write (`persist_status_if_not_final`,
   `update_scan`, `update_run_status`) — a `tracing::error!` is not an outcome.
5. **Only if the dispatcher must return immediately**, move the boundary inside:
   `let work = AssertUnwindSafe(async { … }); if let Err(p) = work.catch_unwind().await { … }`,
   with the unconditional cleanup placed *after* the `if let`, not inside it
   (`engine/mod.rs:1165-1180`).
6. **Resolve state and handles outside the task.** `State<'_, AppState>` in the
   command signature; `.clone()` what you need; move the clones in. Never
   `app.state::<T>()` inside a spawned body.
7. **If the task is periodic, delete it and register a subscription instead**
   (`background.rs::start_loops`). You inherit `run_single`'s boundary, the
   3-panic backoff and the health record, and you stop being this path's problem.
8. **And then stop.** Do not add a reaper for the task you just made
   observable, do not install a second panic hook, and do not add a `.catch` at
   the top of `main` to "make sure". If the handle is consumed and the guard is
   held, the work is done.

## 5 Anti-patterns

- **A `spawn` statement ending in a semicolon when something is waiting.**
  *Failure:* the `JoinHandle` — the only object in the language that can carry
  `is_panic()` — is constructed and destroyed in the same statement, so the
  failure is unrepresentable from that instant on. **Measured: 210 of 274
  production spawn sites (77%); 165 of them carry no boundary of any kind.**
- **`catch_unwind` whose `Err` arm only logs.** *Failure:* the process survives
  and the work item does not exist any more, which is the stall this path is
  named for. The compliant sites all reach a durable write in the same arm
  (`engine/mod.rs:1159`, `kpi_scan.rs:594`, `lab.rs:143`).
- **`app.state::<T>()` inside a spawned body.** *Failure:* Tauri resolves state
  by `TypeId`, so `AppState` and `Arc<AppState>` are different types and the
  mismatch is a panic, not an error. **Measured: this is the sole cause of all 20
  live panic executions**, and `try_state` is one identifier away.
- **A cleanup statement written after the work instead of a `Drop` guard.**
  *Failure:* `panic = "unwind"` skips it. `engine/mod.rs:3455-3459` documents the
  price in its own comment — a re-entrant healing acquire *"early-returns BEFORE
  the cleanup paths, leaking the slot forever (healing then silently bricked for
  that persona until restart)"*. The repo has **22 production `impl Drop`
  guards** (plus 4 in `#[cfg(test)]` modules); the
  pattern is native here and under-used at the spawn boundary.
- **`.await` on a handle followed by `.map_err(…)` or `.ok()`.** *Failure:* it
  is a *narrower* defect than dropping the handle but the same shape — the panic
  becomes a generic message or a `None`, and `is_panic()` was the only thing that
  could have said "this was a bug, not a refusal". **Measured: 40 `.map_err`,
  7 `.ok()`, versus 3 `is_panic()` in the whole tree.**
- **A crash report keyed by a one-second timestamp.** *Failure:* the reports
  overwrite each other precisely when several tasks fail together, which is the
  case you needed them for. **Measured: 20 panic executions → 12 files; 8 reports
  (40%) lost.**
- **Capturing the backtrace inside the panic hook and printing it with `{}`.**
  *Failure:* the capture starts at the reporter, and short-style formatting can
  truncate above every application frame. **Measured: 17 of 20 files contain 7
  frames, the only `app_lib` one being the hook itself.**
- **`unwrap_or_else(|e| e.into_inner())` as the complete answer to poisoning.**
  *Failure:* it is right about not re-panicking and wrong about what the flag
  means — the guarded value may be half-written by the panic that set it.
  **Measured: 270 sites tolerate, 54 propagate, 3 (one file) reset and refuse.**
- **A doc comment that describes a mechanism the profile disabled.**
  *Failure:* nobody looks. `lib.rs:804` says the crash hook writes *"before
  aborting"*; `Cargo.toml:316` is `panic = "unwind"`; the directory is 20 for 20
  survived panics.
- **Fixing the panic where it was reported instead of everywhere it can
  happen.** *Failure:* `6734382bf` fixed `eval.rs`'s byte-index slice and
  `wait.rs:176` panicked seven weeks later with the same message.

## 6 Evidence

**The one site to copy: `src/companion/remote_jobs.rs:128-160`.** Read it as
five decisions:

1. **It refuses to detach the part that matters.** The outer dispatch *is*
   detached (`:107`, and `:105`'s doc comment says why: *"Runs on the inbound
   dispatch task — returns immediately, always"*), and the inner unit of work is
   bound. Detaching the dispatcher and keeping the worker is the correct
   decomposition, and it is the only instance of it in the tree.
2. **It says why, in the comment quoted in §0** — *"instead of a task that
   vanishes and a job that never finishes."*
3. **It separates four outcomes**: application error, panic, cancellation,
   timeout — with `abort.abort()` on the timeout arm so the orphan does not
   outlive its verdict.
4. **The panic arm is user-facing copy**, not a `Debug` format: *"The assistant
   crashed while working on that."*
5. **`run_assignment`'s doc comment states the invariant the structure buys**:
   *"Every exit path — success, turn error, panic, timeout — ends in exactly one
   `complete` or `fail`."*

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `src/lib.rs:353-366` `RunGuard` · `build_session/mod.rs:73-93` `HandleDropGuard` | **cleanup that cannot be forgotten**, with the instruction written into the type's own doc comment. 16 `register_run_guarded` call sites |
| `src/engine/mod.rs:1075-1180` | a panic arm that writes a **terminal row**, followed by cleanup placed *outside* the `if let Err` so both paths run it |
| `src/commands/infrastructure/kpi_scan.rs:585-600` | one panic → **three** surfaces: durable status, in-memory job registry, user console line |
| `src/engine/subscription.rs:112-131` `run_blocking_tick` | the disciplined `resume_unwind`: re-raise across `spawn_blocking` **only** to reach a boundary you already own, with the reason in the doc comment |
| `src/engine/api_proxy.rs:54-65` | the only poisoned-lock handler in the repo: recover, **reset**, `clear_poison`, refuse with a message that names the prior panic |
| `src/engine/subscription.rs:1319-1366` | the supervised boundary: downcast, count, emit, back off at 3 consecutive panics, reset on recovery |
| `src/companion/remote_jobs.rs:141` | `tokio::time::timeout` **wrapping** the handle rather than beside it, so a hung task and a dead task are one `match` |

### Convergence — 5 sibling repos, all opened

Swept read-only against `../personas-web` (1,614 tracked), `../brainiac` (771),
`../personas-cloud` (51), `../vibeman` (2,570), `../ascent` (1,710). **All five
exist and all five were opened**; nothing below is reported by omission. Only
`brainiac` is Rust, so clauses about `JoinHandle` were re-expressed as "the
detached async unit and its rejection" for the four TypeScript repos before
being counted — a mechanism-keyed sweep would have scored a false silence, which
is the doctrine's named trap.

| # | clause | verdict | evidence |
| --- | --- | --- | ---: |
| 1 | **A process-level crash/panic handler is installed by the app itself** | **SILENCE 5/5 — Personas is alone** | No `panic::set_hook`, no `process.on('uncaughtException')`, no `unhandledRejection`, no `window.onerror` in any of the five. `personas-web`'s only regex hit is an `<audio>` element `addEventListener("error")` (`src/hooks/useTourAudio.ts:112`) — hand-checked and discarded. **4 of the 5 do carry Sentry** (`personas-web` 35 files, `brainiac` 9, `vibeman` 1, `ascent` 2), whose SDK installs such a handler *as a dependency side effect* — so four repos have the behaviour and **none of them chose it**. That is the finding: the handler is the kind of thing you inherit, not the kind of thing you write |
| 2 | **A crash report is persisted as a durable artifact** | **SILENCE 5/5 — Personas is alone, and it is ahead** | Zero `crash_log` / `crashReport` artifacts in any sibling. Personas writes a file, prunes it, ships an IPC command pair and renders it in a health panel. **The whole apparatus exists and is the best in the family; §0.2's three defects are the price of being the only one to try** |
| 3 | **The detached unit's abrupt death becomes an outcome on the work item** | **PHYSICS AS A DEFECT — 5/5** | `brainiac/crates/brainiac-server/src/sweeps.rs:261` is the sharpest independent rediscovery: a row is claimed by `UPDATE … RETURNING kind`, then `tokio::spawn(async move { execute(admin, provider, kind).await });` — **detached, and `execute` is where the outcome is written**, so a panic leaves the row `running` until the `RUNNING_STALE` interval reaps it. Same shape, different language family, different author, no shared document. `vibeman/src/lib/supabase/goalSync.ts:316-330` `fireAndForgetSync` is the TS twin — an explicit fire-and-forget helper whose `catch` writes a log line and nothing else, called through `Promise.allSettled` at `api/goals/route.ts:127-139`. `ascent` has **284** `.catch(` sites against 50 detached units and `personas-cloud` 8 against 13 |
| 4 | **The dispatcher is detached while the unit of work is kept** | **MINORITY 1/6 — and the one is Personas** | `remote_jobs.rs:107` + `:136`. No sibling separates the two; each either awaits everything (`brainiac`'s `worker_loop`) or detaches everything. **Report as Personas being ahead**, once, in one file |
| 5 | **Cleanup is scope-bound rather than statement-bound** | **PHYSICS 5/5 — universal** | *Files* containing `impl Drop for` or `finally {`: `vibeman` **153**, `ascent` **57**, `personas-web` **30**, `brainiac` **5**, `personas-cloud` **4**. Personas' comparable figures: **24** Rust files (22 production `impl Drop` sites, 4 more in `#[cfg(test)]`) and **353** `src/` files with `finally {`. Every repo reinvents it and nobody argues about it — **this is the clause to lean on, and it is why §2c is the "get one right first"** |
| 6 | **A poisoned lock is treated as evidence of a prior panic** | **SILENCE 5/5 — and one repo made it unrepresentable** | `brainiac` has **zero** `.lock().unwrap()` and uses `.lock().expect("token cache")` / `.expect("breaker lock")` at 5 sites — named, but still propagating. Its other 4 lock sites are `tokio::sync::Mutex`, **which has no poisoning at all**: the whole class does not exist there. The four TS repos have no locks. **The best answer found anywhere is a type that deletes the question**, which is §8 Gap 3 |
| 7 | **A panic-payload / rejection decoder has one exported home** | **INVERTED 2/5 — the siblings do it better** | `vibeman` centralises through a logger + `fireAndForgetSync`; `ascent` funnels `.catch(e => …)` through shared helpers. Personas has **26 byte-identical private copies**. This one is not physics and not house calibration — it is a plain regression against two neighbours |

**Physics — keep as doctrine:** clauses 3-as-a-defect and 5. **Reported as
silence:** clauses 1, 2, 6. **Personas ahead:** clauses 2, 4. **Inverted:**
clause 7 — and it inverts nothing the brief supplied; it is the composer's own
first instinct ("the repo surely shares this helper") that the measurement
overturned.

> **The strongest sibling result is clause 3, because the rediscovery is exact
> and the author clearly thought about failure.** `brainiac`'s sweep claims its
> row with a `FOR UPDATE`-style conditional `UPDATE … RETURNING` — the most
> careful claim in the family — and then hands the claimed work to a task whose
> death it cannot observe. **The claim was fenced; the completion was not.** That
> is the same asymmetry [loop-ownership-and-restart](./loop-ownership-and-restart.md)
> §6 clause 2 found for acquire-vs-renew, at a different joint, and it suggests
> the general form: *engineers fence the moment they take responsibility and
> forget the moment they lose it.*

> **The counter-example that keeps this honest is `brainiac`'s lock story.**
> It has zero poisoning handling and zero poisoning *bugs*, because four of its
> seven lock sites are `tokio::sync::Mutex`, which cannot poison. Personas has
> 96 `tokio::sync` and 102 `std::sync` declarations and therefore has to have an
> opinion 324 times. **The sibling did not solve the problem better; it chose a
> type where the problem does not arise.** See §8 Gap 3 and *Prefer a type over a
> gate*.

### Interaction with neighbouring prescriptions (doctrine §6)

Two live interactions, both found by reading the adjacent paths' §2 rather than
their §7:

1. **With [process-global-command-state](./process-global-command-state.md)
   §2.8.** It prescribes `unwrap_or_else(|e| e.into_inner())` — correct against
   `.unwrap()`, and adopted at 270 sites. **Followed alone it makes a panic
   invisible at the one place the runtime hands it to you for free.** This path's
   §2f is not a contradiction but a completion: `into_inner()` *and* reset *and*
   refuse, as `api_proxy.rs` does. Someone following both paths should read
   §2.8's `into_inner()` as "do not re-panic", not as "do not react".
2. **With [stall-watchdog](./stall-watchdog.md) §2a.** It prescribes giving a
   periodic cycle a `Result` return so the supervisor can record what it
   produced. Landing that against `run_single` creates two failure channels into
   one supervisor, and **`run_single` reads only one**: it backs off on panics
   (`subscription.rs:1356`) and treats an `Err` tick as a success that resets
   `consecutive_panics` to 0 (`:1378-1384`) — the defect
   [background-loop](./background-loop.md) B3 already named. **Do the two edits in
   one commit**, or the outcome type will silently make failures *less* visible
   than panics.

## 7 Deviations

Every entry is live on `master` @ `17d059b1f`, measured against the operator's
own `crash_logs/` directory, read-only copies of the live databases, or the
census rule in §9.

### D1 — `wait.rs:176` panics on any multi-byte character in the last 2 KB of terminal output, and the task that dies is detached

`src/commands/fleet/wait.rs:175-177` slices a `String` at
`snap.len() - RAW_TAIL_CAP` — a byte offset with no `is_char_boundary` /
`floor_char_boundary` / `char_indices` guard. **Three recorded panics** on
2026-08-05 (×2) and 2026-08-06, on `'─'`, `'❯'` and `'─'`. The containing task is
`commands/fleet/registry.rs:753`, detached, and its purpose is the Enter-submit
confirmation and retry (`:759-849`) — so the failure mode is that a fleet session
is told a line was submitted when the confirmation never ran.

**Fix (two parts):** clamp with `floor_char_boundary` (or take the tail with
`char_indices().rev()`), *and* bind `registry.rs:753`'s handle so the next one is
not silent. The first alone leaves 160 other tasks in the same position; the
second alone leaves the panic. **The same class was closed in `eval.rs` by
`6734382bf` and this site was not enumerated** — when fixing it, grep for
byte-range indexing of a `String`, not for the old literal.

### D2 — the crash instrument cannot attribute, cannot survive concurrency, and calls survived panics "crashes"

| # | `logging.rs` | defect | measured |
| --- | --- | --- | --- |
| a | `:248-249` | filename is `crash_{%Y%m%d_%H%M%S}.log` and the write is truncating `fs::write` | **8 of 20** panic events overwritten; one second held 5 |
| b | `:280-283` | `Backtrace::force_capture()` formatted `{}` (short) from *inside* the hook | **17 of 20** files have 7 frames; the only `app_lib` frame is the hook |
| c | `:270-277` | `Location:` is the panic's own location — for a dependency panic that is the dependency | **15 of 20** point into `tauri-2.11.2/src/lib.rs:734` |
| d | `lib.rs:804` | doc comment says *"before aborting"*; `Cargo.toml:316` is `panic = "unwind"` | **20 of 20** files are panics the app survived |
| e | `:305, :329` | `read_crash_logs` truncates to 10 while `CRASH_LOG_RETENTION` is 20 | the UI can never show half the directory |
| f | `:245` vs `lib.rs:805` | the hook is installed ~250 lines into `setup()`, after `db_init`, migrations and the connector snapshot refresh | any panic during boot before `:805` writes no file |

**Fix:** append a short random suffix or a monotonic counter to the filename
(a); print with `{:#}` and additionally record `std::thread::current().name()`
plus the panic's `payload` *and* the innermost `app_lib` frame (b, c); correct the
comment and rename the directory concept to what it is — a recovered-panic log
(d); align the read cap with the retention cap (e); move `install_crash_hook`
to immediately after `logging::init()` (f). (a) and (d) are the cheap ones and
(a) is the one that loses data today.

### D3 — the 20 live panic rows are one avoidable call, and the guard is one identifier away

All 20 are `app.state::<Arc<AppState>>()` resolving a `TypeId` that was never
`.manage()`d, inside a spawned task.
[process-global-command-state](./process-global-command-state.md) §Deviations G
counts **40 of 74** reach-ins using the panicking form. **Fix:** `try_state` at
every reach-in inside a spawned body, and resolve state in the command signature
wherever the site is a command. This is the single highest-yield edit in the
path: it removes 100% of the observed panic population.

### D4 — 165 production spawns discard the only object that could report their death

The §9 rule counts them; the top of the distribution:

| file | matches | what dies with it |
| --- | ---: | --- |
| `src/lib.rs` | 17 | boot-time work: `requeue_persisted_executions` (`:906`), 14 further `setup()` tasks |
| `src/engine/subscription.rs` | 12 | 8 production (the loop spawns themselves — supervised one frame deeper, see below) + 4 `#[cfg(test)]` |
| `src-tauri/engine/src/p2p/mod.rs` | 8 | the `p2p` feature's `PeriodicTask` spawns |
| `src/commands/core/personas.rs` | 5 | pool invalidation, cache refresh |
| `src/commands/infrastructure/auth.rs` | 5 | auth detection probes |
| `src/engine/mod.rs` | 5 | incl. `:3460` — the healing chain (a false positive, §9) |
| `src/commands/fleet/transcript_read.rs` | 4 | transcript ingest |
| `src/engine/runner/mod.rs` | 4 | runner side-work |
| `src/freeze_monitor.rs` | 1 | **a perpetual `loop` inside a detached task** — the freeze monitor's own death is undetectable, by the monitor |
| `src/commands/fleet/registry.rs` | 1 | **D1** |
| `src/companion/remote_jobs.rs` | 1 (`:481`) | outbound episode append — in the file that contains the exemplar |

**Not all 165 need an outcome** (P8). The deliverable is a *decision* per site,
and the cheapest form of that decision is step 4.1's one-line comment. Start
with the ~30 in `commands/**` that already own a job row, then `lib.rs`.

### D5 — the panic-payload decoder is copied 26 times and exported zero times

26 byte-identical private `fn extract_panic_message`, plus 5 open-coded copies
(`engine/mod.rs:1141`, `:1858`, `:3800`, `subscription.rs:1325`,
`logging.rs:261`). **Fix:** one `pub fn` (it belongs beside `AppError`, or in
`core`), delete 30 copies, and *then* a reviewer can see the sites that never had
one. This is a prerequisite for D4, not a tidy-up: a pattern with no name cannot
be asked for in review.

### D6 — a poisoned lock is stepped over 270 times and interrogated 3 times, all in one file

270 `unwrap_or_else(|e| e.into_inner())` in 54 files; 54 propagating
(`.lock().unwrap()` 35 / `.lock().expect(` 19) in 17 files; **3 `clear_poison()`,
all in `engine/api_proxy.rs`.** **Fix:** for any lock guarding state that a
partial write would corrupt, adopt `api_proxy.rs:54-65`'s three-step shape. For
the rest, prefer `tokio::sync::Mutex` where the guard is already held across an
`.await` — it has no poisoning to have an opinion about (§6 clause 6, §8 Gap 3).

### D7 — the subscription crash signal is emitted and consumed by nobody

`subscription-crashed` is emitted at `subscription.rs:1345` with the panic
message and the consecutive count, declared at `eventRegistry.ts:216` with
metadata at `:1004`, and has **0 `listen(` consumers**. `consecutivePanics` has
**0 reads** across 4,828 `.ts`/`.tsx` files. The only path from a panicking loop
to a human is `health.rs:739` → an amber dot. **Fix:** either wire a toast/alert
to the event or delete the event and the field from the binding — an emitted
event with no consumer is a maintenance cost that looks like coverage.
(Confirms [background-loop](./background-loop.md) §Gaps; recorded here because
this path owns the panic half of that signal.)

### D8 — a detached task that holds a `Drop` guard is safer than it looks and still reports nothing

`db/src/embedder.rs:204-206` builds an `ActiveFlagGuard` and moves it into a
detached task; `build_session/mod.rs:313-315` does the same with
`HandleDropGuard`. **The flag and the handle are panic-safe. The work is not.**
Five of the 165 are in this state. **Fix:** treat the guard as evidence that
somebody thought about failure here, and finish the thought — these five are the
cheapest sites in D4 to convert, because the state question is already answered.

## 8 Gaps

1. **`catch_unwind` cannot see everything a task can do.** It catches unwinds;
   it does not catch `abort`, a stack overflow, an OOM kill, or the process being
   terminated. `remote_jobs.rs`'s `timeout` + `abort_handle` covers the hang case
   and nothing covers the rest — which is exactly why
   [terminal-state-and-recovery](./terminal-state-and-recovery.md)'s age-based
   sweep must remain as the backstop. **This path makes the sweep rare, not
   unnecessary.**
2. **A `Drop` guard cannot write an outcome that needs `.await`.** `Drop` is
   synchronous; a durable status write is async here. The tree's guards therefore
   release in-memory state only (`RunGuard`, `HandleDropGuard`, `ActiveFlagGuard`)
   and the durable write is left to the panic arm — which is why P4 and P3 are
   two clauses rather than one. A `Drop` that spawns a detached writer would land
   right back in D4.
3. **Rust hands you a poison flag only for `std::sync` locks — and the codebase
   is split 102/96 between `std::sync` and `tokio::sync` declarations.** A
   process-wide answer to D6 is impossible while both flavours are in use; the
   choice of flavour is usually made for `Send`-across-`.await` reasons that have
   nothing to do with panics. `brainiac` gets a free pass here by having almost
   no `std::sync` locks at all, not by being more careful.
4. **The panic hook is process-global and `set_hook` is last-writer-wins.** The
   crash hook takes `take_hook()` at `lib.rs:805` and chains to whatever Sentry
   installed at `main.rs:28`, which works — but there is exactly one slot, so a
   test, a dependency, or a second install silently displaces the chain. There is
   no way to *observe* the current hook, so this cannot be asserted, only
   conventionally protected.
5. **In debug builds nothing leaves the machine.** `main.rs:82-86` sets
   `dsn: None` under `cfg!(debug_assertions)` — deliberately. So on the
   operator's own dev builds, `crash_logs/` is not the *best* record of a panic,
   it is the **only** one, which raises the stakes on D2 considerably.
6. **`is_panic()` cannot tell you *where*.** `JoinError` carries the payload,
   not a backtrace. A `match` arm can say "it crashed"; only the hook can say
   where — so D2 and D4 are complementary, and fixing only one leaves half the
   diagnosis.
7. **The census cannot see the compliant route that lives one function deeper.**
   `remote_jobs.rs:107` detaches a dispatcher whose *callee* holds the boundary,
   and no textual signal can follow that call. §9's window heuristic happens to
   exclude it, which is luck, not analysis. **Any count of this condition is an
   over-count by however many sites push the boundary into a helper**, and the
   only exact instrument is a call-graph pass.

## 9 The missing gate

**What the signal is a proxy for:** *the object that can report a task's abrupt
death is destroyed in the same statement that creates the task.* Not "detaching
is wrong" — detaching is often right (P8) — but that a statement-position
`spawn` with no boundary anywhere in its body makes the outcome
**unrepresentable**, and the repo has no way to tell the deliberate ones from the
165 that were never considered.

**Where it executes.** `npm run census:check`, which runs in three places:
inside `npm run check` (`package.json:52`), as the **`golden-path-census`
pre-push job** (`lefthook.yml:74-75`), and in CI. Per the §9 calibration: the
pre-push hook is the one that actually runs — `ci.yml` is red on 10 pre-existing
failures and a gate that only runs in CI runs nowhere. **`npm run census -- --update`
is required to move the baseline, which lands in the diff.**

**How it fails loudly if its own precondition is absent.** The census engine
fails — not warns — when the walk sees fewer than `floor` (900) files, when the
rule matches zero files anywhere, when an `exclude` goes stale, on a rise, and on
an unratcheted drop. This rule adds nothing bespoke; that is the point of using
the shared runner.

**Two independent implementations.** A comment/string-blanking Rust scanner with
paren matching and brace-matched `#[cfg(test)]` exclusion, and the census engine.
They agree on **211 of 211** sites — zero membership disagreement — and on the
violating/compliant classification of **210 of 211**. The one disagreement is
`engine/mod.rs:3461`, hand-verified: it *is* guarded, 4,619 characters into a
16,324-character body, past the window. It is the rule's single false positive
and it is left in the baseline rather than excluded, because an exclusion would
be a claim about a body length rather than about a file.

**Precision, stated as an audit.** Of the **169** matches:

| | |
| --- | ---: |
| true production violations (statement-position, inline body, no boundary) | **159** |
| `#[cfg(test)]` sites the engine structurally cannot exclude by range | **9** (`subscription.rs:3325,3379,3393,3407`, `cli_process.rs:852,882,902`, `test_runner.rs:3042`, `deliberation.rs:471`) |
| false positives | **1** (`engine/mod.rs:3461`) |
| **precision** | **159/169 = 94.1%**; against the population the engine can reach, **159/160 = 99.4%** |
| false negatives (window spilled past a short body into a neighbouring guard) | **2** — `db/src/embedder.rs:92`, and `companion/remote_jobs.rs:109` where the spill is *semantically correct* (§8 Gap 7) |
| **recall gap the anchor cannot close** | **4** — `let _ = tokio::spawn(…)` puts `=` before the path, so `[;{}]` never fires: `alert_evaluator.rs:368`, `kpi_compose.rs:375`, `session.rs:1637`, `session.rs:1718`. All four are genuine violations. **Widening the anchor to accept `=` would swallow every `let h = spawn(…)`, i.e. the entire compliant population — the recall gap is the price of the partition being exact, and it is 4 sites** |

`src/test_automation.rs:1488` is counted as a **production** violation, not
contamination: it is `pub mod test_automation;` at `lib.rs:43`, a shipped module
behind a cargo feature. (My first scanner's filename heuristic `/(^|\/)test_/`
called it a test file — the mirror image of the hazard the doctrine names for
`dev_tools_backlog_tests.rs`, and worth recording: **a filename rule mis-files in
both directions.**)

**The positive control is an exact partition, by construction.** The identical
anchor with the negative lookahead inverted to a positive one matches **42** sites
in 30 files, **zero** overlap with the rule, and **169 + 42 = 211** accounts for
every statement-position `spawn` with an inline body in the tree. A ratio would
have been a claim; a partition is an accounting.

**Fault-injected 18 ways**, all correct: a bound handle (`let h = …`), a
`handles.push(…)`, a `fn spawn(` definition, a `Command::new(…).spawn()`, a
function-call body instead of an inline block, `tokio::task::spawn`,
`spawn_local`, `std::thread::spawn`, `async {` without `move`, a CRLF file, an
interposed `//` comment, a guard placed 3,000 characters in (correctly *not*
excluded), and a nested guarded inner spawn.

**Backtracking:** the fill is a bounded `[\s\S]{0,2500}?` inside a **zero-width**
lookahead — no nesting, no variable-length lookbehind. Full 963-file run:
**319 ms** for rule + control together.

**Overlap:** re-ran the ten nearest existing rules and compared **469** match
sites against these 211. **One** line-level collision: `test_automation.rs:1486`,
also matched by `unverified-effect-dispatch` (an `app.emit` on the line above the
spawn). Nine of the ten collide zero times, including `outcomeless-tick`, with
which this rule shares 4 files and 0 lines.

**Legal fix — and the three ways to fake it.** Bind the handle and match
`is_panic()`; or wrap the body in `AssertUnwindSafe(…).catch_unwind()` with a
durable `Err` arm; or move a periodic task into the subscription registry. Do
**not** silence a match by (i) assigning to `let _ = tokio::spawn(…)` — that is
the same discard and the anchor still catches the `;`/`{` before it; (ii) moving
the body into a helper `async fn` so the call site has no inline block — the
match disappears and the defect does not (§8 Gap 7 is the honest limit here, and
the reviewer's job); (iii) adding an unused `AssertUnwindSafe` import near the
top of the body. All three preserve the condition.

**Precondition, which must be re-derived per repo.** This signal keys on Rust
statement position and on this repo spelling detached work as `tokio::spawn` /
`tauri::async_runtime::spawn` with an inline `async move {`. A TypeScript repo
spells the identical condition as an unawaited promise (`fireAndForgetSync(…)`,
`Promise.resolve().then(…)`, `void fn()`), and **all four TS siblings score a
structural zero against this pattern while the condition is present at scale** —
`vibeman` 114 detached units against 27 observed, `ascent` 50 against 9. The
adopting repo inherits P1–P8 and writes its own signal.

**End of life:** this rule is expected to *fall*, not to reach zero — P8 says a
population of deliberate detached tasks is correct. If it ever does reach zero,
delete it rather than baselining at 0.

```json
{
  "id": "unobservable-detached-task",
  "goldenPath": "docs/concepts/golden-paths/panic-isolation.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "[;{}]\\s*(?://[^\\n]*\\n\\s*)*(?:tokio::(?:task::)?spawn(?:_blocking|_local)?|tauri::async_runtime::spawn(?:_blocking)?|(?:std::)?thread::spawn)\\s*\\(\\s*(?:async\\s+move\\s*\\{|async\\s*\\{|move\\s*\\|\\||\\|\\|\\s*\\{)(?![\\s\\S]{0,2500}?(?:AssertUnwindSafe|catch_unwind|is_panic))",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A spawn-family call in STATEMENT POSITION (preceded by ; { or }, so its JoinHandle is created and destroyed in the same statement) whose body is an INLINE async block or closure, and which contains no panic boundary (AssertUnwindSafe / catch_unwind / is_panic) within 2500 characters. PROXY FOR the stack-free condition: the only object that can report a task's abrupt death is discarded at the moment the task is created, so 'finished', 'crashed' and 'cancelled' become one observable — nothing. MEASURED 2026-08-16 at 17d059b1f over 963 .rs files: 169 matches across 86 files, commentMatchesSkipped 0. TWO INDEPENDENT IMPLEMENTATIONS — a comment/string-blanking Rust scanner with paren matching and brace-matched #[cfg(test)] exclusion, and the census engine — agree on 211 of 211 sites (ZERO membership disagreement) and on 210 of 211 classifications. AUDIT OF THE 169: 159 true production violations, 9 #[cfg(test)] sites the engine cannot exclude by range (subscription.rs:3325,3379,3393,3407 / cli_process.rs:852,882,902 / test_runner.rs:3042 / deliberation.rs:471 — carried in the baseline exactly as outcomeless-tick carries 2 and silent-row-skip carries 4), and 1 false positive (engine/mod.rs:3461, genuinely guarded 4619 chars into a 16324-char body, past the window; left in rather than excluded because an exclusion would be a claim about a body length, not about a file). PRECISION 159/169 = 94.1%; against the population the engine can reach, 159/160 = 99.4%. TWO FALSE NEGATIVES where the window spilled past a short body: db/src/embedder.rs:92, and companion/remote_jobs.rs:109 where the spill is SEMANTICALLY CORRECT — that dispatcher's callee holds the boundary (a call-graph fact no textual signal can follow; see the path's Gap 7, so any count here over-counts by however many sites push the boundary into a helper). test_automation.rs:1488 is counted as PRODUCTION (pub mod at lib.rs:43, shipped behind a cargo feature) — the first scanner's /(^|\\/)test_/ filename heuristic mis-filed it, the mirror image of the dev_tools_backlog_tests.rs hazard. CONSEQUENCE, MEASURED AGAINST THE OPERATOR'S OWN crash_logs/ DIRECTORY AND READ-ONLY COPIES OF THE LIVE DATABASES: 274 production spawn sites, 210 statement-position, 165 carrying no boundary at all (the [;{}] anchor reaches 161 of the 165 — the other 4 are spelled `let _ = spawn(..)`, listed in the path's Section 9); JoinError::is_panic() appears 3 times in 963 files and only ONE of those converts the panic into a value a caller can act on (companion/remote_jobs.rs:145, whose comment says 'instead of a task that vanishes and a job that never finishes'); 40 sites flatten the JoinError with .map_err and 7 with .ok(); ZERO use .await.unwrap(), .await.expect() or .await?. 20 persona_executions rows carry 'Internal error (panic):' — 7.8% of all 258 failed+incomplete — all with 0 tokens, 0 cost, 0 duration, 0 output. All 20 crash reports on disk are on a tokio-rt-worker thread and all 20 are panics the app SURVIVED, despite lib.rs:804 describing the hook as writing 'before aborting' (Cargo.toml:316 is panic = \"unwind\"). The 20 executions map to only 12 crash files — 8 reports (40%) lost to a one-second-resolution filename plus a truncating fs::write — and 17 of the 20 files contain zero application frames. commands/fleet/wait.rs:176 slices a String at a computed byte index and panicked 3 times inside the DETACHED task at commands/fleet/registry.rs:753, silently skipping the Enter-submit confirmation; the same defect class was closed in eval.rs by 6734382bf seven weeks earlier and this site was never enumerated. POSITIVE CONTROL: unobservable-detached-task-positive-control, the IDENTICAL anchor with the negative lookahead inverted, matches 30 files / 42 sites with ZERO overlap; 169 + 42 = 211 accounts for EVERY statement-position spawn with an inline body in the tree, so the partition is exact rather than a ratio. FAULT-INJECTED 18 WAYS, all correct, including a bound handle, handles.push(...), a `fn spawn(` definition, Command::new(..).spawn(), a function-call body, spawn_local, async { without move, CRLF, an interposed // comment, and a guard placed 3000 chars in (correctly NOT excluded). BACKTRACKING: the fill is a bounded [\\s\\S]{0,2500}? inside a ZERO-WIDTH lookahead — no nesting, no variable-length lookbehind; full 963-file run of rule + control 319 ms. OVERLAP-CHECKED against 469 match sites of the ten nearest rules (unraced-loop-wait, outcomeless-tick, unbound-child-lifetime, unpinned-billing-account-spawn, unowned-inflight-state-sweep, unverified-effect-dispatch, anonymous-deadline, silent-row-skip, unswept-job-registry-read, start-marker-before-admission): ONE collision, test_automation.rs:1486, shared with unverified-effect-dispatch (an app.emit on the line above the spawn); outcomeless-tick shares 4 files and 0 lines. LEGAL FIX: bind the handle and match on JoinError::is_panic(); or wrap the body in AssertUnwindSafe(..).catch_unwind() with a DURABLE Err arm; or move a periodic task into the subscription registry (background.rs::start_loops) and inherit run_single's boundary. Do NOT silence a match with `let _ = tokio::spawn(..)` (same discard, anchor still fires), by hoisting the body into a helper async fn so the call site has no inline block (the match disappears, the defect does not), or by adding an unused AssertUnwindSafe import near the top of the body. PRECONDITION (must be re-derived per repo): this repo spells detached work as tokio::spawn / tauri::async_runtime::spawn with an inline `async move {`. A TypeScript repo spells the identical condition as an unawaited promise, and all four TS siblings score a structural ZERO against this pattern while the condition is present at scale (vibeman 114 detached units vs 27 observed; ascent 50 vs 9). END OF LIFE: this rule is expected to FALL, not to reach zero — a population of deliberately detached tasks is correct (principle P8). If it ever does reach zero the runner fails structurally, BY DESIGN — DELETE the rule then, do not baseline it at 0."
  },
  "baseline": { "files": 86, "matches": 169 },
  "floor": 900
}
```

```json
{
  "id": "unobservable-detached-task-positive-control",
  "goldenPath": "docs/concepts/golden-paths/panic-isolation.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "[;{}]\\s*(?://[^\\n]*\\n\\s*)*(?:tokio::(?:task::)?spawn(?:_blocking|_local)?|tauri::async_runtime::spawn(?:_blocking)?|(?:std::)?thread::spawn)\\s*\\(\\s*(?:async\\s+move\\s*\\{|async\\s*\\{|move\\s*\\|\\||\\|\\|\\s*\\{)(?=[\\s\\S]{0,2500}?(?:AssertUnwindSafe|catch_unwind|is_panic))",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL for unobservable-detached-task — the COMPLIANT half of the same partition, and no baseline by design. The identical anchor with the negative lookahead inverted: a statement-position spawn with an inline body that DOES carry a panic boundary within 2500 characters. MEASURED 2026-08-16 at 17d059b1f: 30 files / 42 matches, ZERO match-position overlap with the rule. 169 + 42 = 211 accounts for every statement-position spawn with an inline body in the tree, so the two are mutually exclusive AND jointly exhaustive BY CONSTRUCTION — a lookahead and its negation cannot both hold at one position, and every such spawn is one or the other. That makes this an accounting rather than a ratio: if the pair ever stops summing to the scanner's site count, the matcher moved, not the codebase. The population is the background-job pattern under src/commands/** (lab.rs 4, task_executor.rs 3, companion/mod.rs 2, oauth.rs 2, vector_kb.rs 2, reviews.rs 2, tests.rs 2, idea_scanner.rs 2, kpi_compose.rs 2, and 20 single sites) plus db/src/embedder.rs:88 — every one of which decodes the payload with its own private copy of extract_panic_message (26 byte-identical definitions in 26 files, exported zero times)."
  },
  "floor": 900
}
```

---

## 10 Prefer a type over a gate

Held against the doctrine's seven qualifications, the honest answer is **one type
wins outright, one is disqualified, and the gate earns its place for the rest.**

**The type that wins: the RAII guard, for P4.** `RunGuard` (`lib.rs:353-366`),
`HandleDropGuard`, `ActiveFlagGuard`, `IpcInFlightGuard`, `CycleGuard` — **22
production `impl Drop` in the tree**, and the sibling sweep found the pattern
universal (§6 clause 5: 153 files in `vibeman`, 57 in `ascent`). It passes **Q5** — it *withholds*
the ability to forget rather than requiring you to remember — and it passes **Q6**,
because what it withholds is the dangerous freedom (a release statement that can
be skipped) and not the answer. The correct edit at 5 of the 165 sites is not a
panic arm at all; it is moving the release into a guard.
`process-global-command-state` §5 already reached the same conclusion from the
IPC-flag side, independently.

**The type that is disqualified: a `SupervisedSpawn` newtype or a
`spawn_supervised(…)` wrapper.** It fails **Q3** — *a type nobody constructs
constrains nothing*. Nothing forces a caller through it: `tokio::spawn` is one
`use` away and is already at 274 call sites, and the codebase demonstrates
exactly this failure mode at scale, since `PeriodicTask`
(`engine/src/p2p/periodic.rs:12`) is a strictly better loop harness with a
`Result` tick that has **5 call sites, all behind the `p2p` feature**, while
`run_single` gets everything. Withholding the dangerous entry point
(`call_claude_text`'s 8/8 result) is not available here — `tokio::spawn` is
someone else's public API and cannot be taken away.

**Where the type cannot reach at all.** The panic payload is
`Box<dyn Any + Send>` by the runtime's own signature; the poison flag is a
`Result` the caller may discard; and — the case that decides it — **§8 Gap 7:
whether a detached dispatcher's callee holds the boundary is a call-graph fact,
and no signature at the spawn site encodes it.** That is the doctrine's *"if the
honest answer is that no type reaches the condition, say so"*, and it is why §9
ships a ratchet rather than a refactor.

**One thing the type discussion should not obscure**, per the contract's
fifth failure mode: routing everyone to `catch_unwind` is a gate whose
destination has a forgettable argument. `catch_unwind` returns a `Result` and
**`Err(_) => { tracing::error!(…) }` type-checks perfectly**. The 45 compliant
sites are compliant because each author also wrote a durable write; nothing in
the primitive required it. So §2b's prescription is deliberately "the `Err` arm
writes an outcome", not "wrap it in `catch_unwind`" — the wrapper is the cheap
half.

---

## 11 Verification for the D-list

- **D1** — the fix is testable without the app: a unit test that feeds
  `WaitHandle::diagnostics` a 3 KB string ending in `'─'` and asserts no panic.
  **It must fail today.**
- **D2a** — write two crash files in the same second in a `#[test]` over
  `prune_crash_logs`'s directory and assert both survive. **Fails today.**
- **D3** — a grep-level assertion is enough: zero `app.state::<` inside a spawn
  body. The census rule for the general form is
  `process-global-command-state`'s to own.
- **D4** — the ratchet in §9; the baseline is expected to fall as sites acquire
  a decision, and to fall in `commands/**` first.
- **D6** — a `#[test]` that poisons `CONNECTOR_CACHE` and asserts the next call
  returns `Err`, not a stale value. It passes today, for that one lock, and is
  the template for the others.

---

## 12 Corrections to the brief

**12.1 — "convergence: diverged" is right, and the label hides why.** The
sweep found the *practice* diverged (§6 clause 3: five repos, five ways of losing
a detached unit's death) but the *absence* converged perfectly: **no repo in the
family installs a process-level crash handler of its own (5/5), and no repo
persists a crash artifact (5/5).** The label reads as "everyone does it
differently"; the measurement is closer to "nobody does it, and Personas is the
only one that tried". Those imply opposite postures — the second says *keep and
repair the apparatus you have*, which is D2, not *pick a winner from the
siblings*.

**12.2 — `install_crash_hook` does not write "before aborting".** The brief
inherited `lib.rs:804`'s comment. `Cargo.toml:316` sets `panic = "unwind"`
deliberately (for the ORT DLL boundary), so the hook runs and the process
continues. **All 20 files in the operator's `crash_logs/` are panics the app
survived; not one is a crash.** This is not pedantry — it is why a directory
saturated at its 20-file cap has never prompted anyone to look.

**12.3 — "find out what actually reaches it" has a sharper answer than
expected, in both directions.** *Everything* reaches it — `set_hook` fires for
caught panics too, so the hook sees the 20 that became job errors as well as the
8 that vanished. And *almost nothing useful* survives the trip: 40% of the events
are overwritten by same-second siblings and 85% of the files name no line of this
repo. The instrument's coverage is total and its yield is near zero, which is a
different problem from the one "what reaches it" suggests.

**12.4 — "20 of 258 execution failures are panics" is exact, and the population
is narrower than it looks.** 20 rows, all `status='failed'`, 7.8% of the 258
failed+incomplete. But **all 20 carry one message and one root cause**
(`state::<T>()` in a spawned task) across 12 crash seconds in ten days. It is not
20 classifiable failures; it is one bug, 20 times, and D3 removes the whole
population.

**12.5 — `consecutive_panics` has exactly one reader, and it is not the
interesting number.** `health.rs:739` → `Warn`; zero frontend reads. But the
count that matters for this leaf is that **`consecutive_panics` only exists for
the 39 subscriptions.** For the 274 spawn sites there is no counter at all, no
health record, and no name — a panicking one-shot task is not merely
under-reported, it is *unnamed*, so there is nothing for a reader to read.

**12.6 — the brief's `catch_unwind` / `JoinHandle` question has a two-order
answer, and the smaller number is the important one.** 49 production
`catch_unwind` sites is a respectable population. **3 `is_panic()` sites, of
which 2 are `resume_unwind` and 1 converts, is the real state of the art.** The
repo has learned to *contain* panics (49 boundaries) and has learned to *report*
one exactly once. Containment without conversion is P3, and the gap between 49
and 1 is this document's reason to exist.

**12.7 — the composer's own first instinct was wrong, and the measurement said
so.** Going in, `extract_panic_message` looked like the shared primitive to route
people to (§Composing rules: *"prefer the primitive that exists"*). It is defined
**26 times, privately, byte-identically**, plus 5 open-coded copies. **A
primitive that exists 31 times exists zero times.** Checking that assumption cost
one script and overturned §3's shape; per the contract, the catalog and the
codebase both had to be opened before believing either.
