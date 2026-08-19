# Golden path — OS process reconciliation

> Situation node: `backend-runtime/subprocess-and-io/os-process-reconciliation` ·
> [situation spine](../situation-spine.md) · recurrence **2** · risk **HIGH** ·
> `twoSided: true` · sides: **client** (**inverted** — see [§12.1](#121--sidesclient-is-inverted-not-incomplete)) ·
> convergence: **converged** (**not tested** — see [§12.6](#126--what-was-not-done)) ·
> dimensions: **security · resilience · function**
> Composed 2026-08-17 against `master` @ `cc27be561`. **Full contract** — nine sections plus §12.
>
> **Sweep size.** All **963** `src-tauri/**/*.rs` files walked by two independent matchers.
> Every PID storage site, every in-memory process registry, every boot-recovery function, every
> liveness check and every kill-by-stored-pid site opened by hand. `lib.rs`'s `.setup()` closure
> read end to end for its eleven recovery calls; `fleet/persist.rs`, `fleet/stale.rs`,
> `engine/mod.rs`'s recovery block, `daemon/lock.rs`, `webbuild/devserver.rs`,
> `dev_tools/competitions.rs` and `fleet/process_scan.rs` read in full or around every relevant site.
>
> **Measured by execution, not by reading.** The database schema was interrogated with
> `PRAGMA table_info` across **all 244 tables** rather than grepped for column names, and the
> recovery markers were counted with the actual queries the recovery functions leave behind.
>
> **⚠ Data is the 2026-08-17 PURGE BACKUP.**
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db` (347 MB), copied read-only;
> the live file was never opened for write and the copy was deleted at the end of composition.
> The 2,188 executions counted below were **deleted from the live database on 2026-08-17** by the
> operator-authorized purge. These figures are historical as of that date and are not reproducible
> against the live file. *A defect is not resolved by deleting the rows that exhibited it.*
>
> **`cargo` was not run** (session constraint). No process was killed, no directory removed, no row
> written.

---

## 0 The headline: nothing this app spawns can be found again, and the boot sweep does not look

Across **244 tables** in the real database there is **exactly one** column holding an operating
system process id:

```
build_sessions.cli_pid  INTEGER      →  12 rows,  0 non-null
```

It has never held a value. All three writers set it to nothing —
`build_session/mod.rs:196` (`cli_pid: None`), `build_session/runner.rs:1921` and
`build_session/events.rs:80` (both `cli_pid: Some(None)`, the "clear it" form). There is no site
anywhere in 963 files that writes `Some(Some(pid))`. The column is declared, migrated, selected,
mapped into a Rust struct and read back — and it is a hole with a name on it.

`fleet_sessions` — the table for the app's **longest-lived** children, the PTY-backed `claude`
sessions that can run for hours — has no pid column at all
(`src-tauri/db/src/migrations/incremental.rs:6603-6631`), and rehydration explicitly restores
`child_pid: None` (`src-tauri/src/commands/fleet/persist.rs:174`). Every other process registry in
the tree is in memory: `ActiveProcessRegistry` (`lib.rs:118-123`), `FleetRegistry`
(`fleet/registry.rs:488-499`), `DevServerRegistry` (`webbuild/devserver.rs:43-46`),
`DEV_SERVERS` (`competitions.rs:973-975`), `ExecutionEngine::child_pids`
(`engine/mod.rs:240`), the MCP `stdio_session_pool` (`engine/mcp_tools.rs:234-239`).

**So after a restart there is no PID left to kill by, and the app does not try.** What it does
instead, at `engine/mod.rs:703-733`:

```rust
Ok(stale) => {
    for exec in &stale {                       // exec_repo::get_running_only(pool)
        let _ = exec_repo::update_status(pool, &exec.id, UpdateExecutionStatus {
            status: ExecutionState::Failed,
            error_message: Some("App restarted while execution was running".into()),
            ..Default::default()
        });
    }
}
```

There is no liveness check in that loop, and there is nothing it could check with. It is a
**declaration**, not a reconciliation: the row is told it failed. Measured against the purge
backup, that declaration has been made **74 times** across the app's 2,188 recorded executions
(3.4%) — 74 runs whose real fate nobody established.

And the children are still there. `tokio::process::Child` does not kill on drop — this repo says so
itself, twice, in comments written by someone who had just been bitten
(`companion/brain/oneshot.rs:52-53`, `commands/fleet/external.rs:189-190`). **No struct that owns a
child process has a `Drop` impl** (all 25 `impl Drop for` sites in `src-tauri/` enumerated;
`DevServer`, `PooledStdioSession`, `CliProcessDriver` and the reaper-owned fleet child have none).
The one thing the app does at exit is:

```rust
if matches!(event, tauri::RunEvent::Exit) {
    if let Some(state) = app_handle.try_state::<Arc<AppState>>() {
        state.webbuild_servers.stop_all();      // lib.rs:3757-3762
    }
}
```

Bun dev servers, and nothing else. The `claude` children, the MCP stdio pool, the PTY sessions and
the competition dev servers get no teardown at all. **17** of **112** OS-command construction sites
set `kill_on_drop(true)`.

**The sharp edge is what happens next.** A PID is not an identity — the OS reissues it, and on
Windows it reissues it fast. This repo's *only* defence against that is name-shaped and lives in two
places: `webbuild/devserver.rs:266-289` (`pid_is_node`, a `tasklist`/`ps` name check) and
`FleetProcessScanner.tsx:65-75` on the **frontend**, which re-scans and requires
`p.pid === pid && p.cmd === target.cmd && p.cwd === target.cwd` before killing. Everywhere else the
pid is revived and acted on bare: **`start_time()` and `run_time()` appear zero times in 963 `.rs`
files**, and of the four `sysinfo` process lookups in the tree, **three act on the process without
reading a single identity field and zero read one first**.

The repo has already written the correct answer, once, with the reasoning, in
`src-tauri/src/daemon/lock.rs:29-32`:

> ```
> //! - No PID-based liveness check. Heartbeat freshness is the sole
> //!   liveness indicator. A hung daemon (not writing heartbeats) is
> //!   treated as dead, which is the correct behavior for our use case.
> ```

That module is the golden path. Nothing else in the app follows it.

---

## 1 Trigger

You are in this situation when you would say, or type, any of:

1. *"What happens to this child if the app is killed?"*
2. *"The row says running but the app just started."* / *"Why is this execution stuck at running?"*
3. *"Let me store the pid so I can kill it later."* — **if you are about to write a `pid` column,
   a `HashMap<String, u32>`, or `child.id()` into anything that outlives the process, you are here.**
4. *"Mark everything that was running as failed on boot."*
5. *"Is that process still alive?"* — and you are reaching for `sysinfo`, `tasklist`, or `kill -0`.
6. *"Resume the orphan"* / *"detect orphaned processes"* / *"kill the stale one."*

You are **not** here if the child's whole life fits inside one `await` in one function and you hold
the `Child` — that is [`spawning-a-cli-subprocess`](./spawning-a-cli-subprocess.md). You are not
here for stopping work you still have a handle on — that is
[`cancelling-in-flight-work`](./cancelling-in-flight-work.md). The distinguishing feature of *this*
leaf is that **the process outlived the thing that knew about it.**

---

## 2 The one way

**Do not persist a pid; persist a heartbeat, and let the child prove it is alive.** A pid is a
short-lived index into a table the OS reuses, so a stored pid is at best a hint and at worst an
instruction to kill a stranger. Concretely, in this order.

**(a) Make the child self-reporting.** The durable record is a row the child (or the task
supervising it) refreshes — `heartbeat_at`, `last_activity_ms`, a JSONL tail, a growing log — and
liveness is *freshness of that record against a threshold*, never the existence of a number.
`daemon/lock.rs` is the reference: `STALE_THRESHOLD = 90s`, `HEARTBEAT_INTERVAL` a third of it, and
`is_stale()` (`:107-113`) is the whole liveness question. This survives PID reuse, a hung child, a
machine reboot and a clock skew backwards (the same function guards a future-dated heartbeat), and
it needs nothing from the OS.

**(b) If you must record a pid, record an identity, not a number.** A pid alone is unforgeable only
for as long as the process lives. Store `(pid, start_time)` — the pair is unique for the lifetime of
the boot — or `(pid, exe_name, cwd)`, and **re-verify every field immediately before acting**. The
frontend already does exactly this (`FleetProcessScanner.tsx:65-75`); the backend never does.

**(c) At boot, do not declare — classify.** Rows whose process cannot be proven alive are
**unproven**, not failed. Give the state machine a third value and put the decision in front of the
user, because "the app restarted" and "the run failed" are different facts and only one of them is
true. `fleet/persist.rs:263-299` is this repo's good answer: it *parks* recovered sessions with a
human-readable reason (`"Recovered after an app restart — its live connection was lost. Resume to
reconnect, or close it."`) and its doc comment (`:259-262`) explains, correctly, why it refuses to
auto-kill:

> *"matching a process to a session by cwd is ambiguous when several share a directory — too risky
> to fire unattended."*

**(d) Reap what you can still reach, at exit, from one place.** Every registry that owns a child
registers a teardown with the single app-exit hook; a child you can still `kill()` at exit is a
child nobody has to reconcile at boot. `kill_on_drop(true)` is the per-child form of the same rule
and costs one builder call.

**(e) Give the user the last word, and give them the evidence.** Reconciliation cannot be complete —
a child started by a previous build of the app, on a machine that has since rebooted, is
unknowable. So the surface has to exist: enumerate candidate orphans with enough identity to
recognise them (`pid`, `cmd`, `cwd`), and let the user resume or kill. `fleet_detect_processes` /
`fleet_resume_orphan` / `fleet_kill_pid` (`fleet/process_scan.rs`, `api/fleet/fleet.ts:249-266`) are
that surface and they are the reason this leaf is `twoSided`.

**Where two answers are both correct**: reach for **(a)** first. **(b)** is what you fall back to
when the thing you are tracking is not yours to instrument — a `bun` tree, an `explorer` window, a
CLI you did not write.

---

## 3 Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| `src-tauri/src/daemon/lock.rs` — `LockFileContents::is_stale()` (`:106-113`), `STALE_THRESHOLD` (`:57`), `HEARTBEAT_INTERVAL` (`:59`) | The heartbeat protocol, with its non-goals written down. Copy the shape, not the file. |
| `commands::fleet::persist::recover_after_restart` (`:263-299`) + `registry::park_recovered` (`registry.rs:1302-1315`) | The classify-don't-declare boot pass, and a guard that refuses to park a session that still has a live `child_pid`. |
| `fleet_sessions.last_activity_ms` (`incremental.rs:6603-6631`) + `stale.rs`'s ticker (`:200-219`) | The durable freshness column and the loop that reads it. This is the app's working heartbeat, already built. |
| `commands::fleet::process_scan` — `fleet_detect_processes` (`:60-90`), `fleet_kill_pid` (`:128-137`), and the `FleetDetectedProcess { pid, name, cmd, cwd }` binding | The user-facing orphan surface, and the only struct in the tree that carries enough to *recognise* a process. |
| `src/features/plugins/fleet/sub_settings/FleetProcessScanner.tsx:65-75` | The re-verify-before-acting client half. The best identity check in the repo. |
| `.kill_on_drop(true)` on `tokio::process::Command` | Per-child reaping for free. 17 of 112 command sites use it. |
| `personas_core::limits` / a `Drop` guard (`build_session/runner.rs:109-146`) | The shape for tying a resource's life to a value's, when the resource is yours. |

**Do not invent** a second process registry, a `pid` column, or a bespoke "is it alive" helper.
There are already six registries and three liveness helpers
(`competitions::is_pid_alive` `:984-991`, `devserver::pid_is_node` `:266-289`,
`headless::PidKiller::kill` `:64-74`) that do not agree with each other.

---

## 4 Steps

1. **Decide what the durable record is, before you spawn.** If the child is yours, it is a row with
   a freshness column. Write the row *first*, so a crash between spawn and insert leaves an orphan
   process rather than an orphan row — an orphan process is findable; an orphan row is a lie.
2. **Spawn with `.kill_on_drop(true)`** unless the child is deliberately outliving you
   (`external.rs:189-190` is the one case in this repo that documents wanting that). This is one
   builder call and it removes the whole "the task died and the child didn't" class.
3. **Refresh the freshness column from the same task that reads the child's output.** Do not add a
   separate heartbeat timer: a timer proves the timer is alive, not the child.
4. **Register the teardown with the app-exit hook** (`lib.rs:3755-3763`) at the same time you
   register the child with its registry. One place, one list.
5. **At boot, run one classify pass, not N declare passes.** For each non-terminal row: is its
   freshness within threshold? → still running, rehydrate. Is it stale? → **unproven**, park it with
   a reason a human can act on. Never write `Failed` from a boot sweep.
6. **If you kill by pid, re-derive the identity in the same statement.** Scan, match every field you
   recorded, and abort loudly if it moved. Then stop — the primitive owns the rest.
7. **Expose the leftovers.** Anything the classify pass could not resolve goes on a surface with
   `pid`, `cmd` and `cwd` visible, and two buttons. **And then stop**: do not auto-resolve, and do
   not auto-kill. `persist.rs:259-262` already argued this and is right.

**Before writing the gate, ask whether the signature can make the mistake impossible.** For this
leaf it can, partially: a `struct ProcessIdentity { pid: u32, started_at_ms: i64 }` with a private
constructor that only a live scan can produce makes "kill by a number I read out of the database"
unspellable, because there is no way to build one from a `u32`. See §9.1 for how far that reaches
and where it stops.

---

## 5 Anti-patterns

**5.1 Storing a bare pid.** *Failure mode:* the OS reuses it and you kill a stranger. The window is
not theoretical on Windows, where pid reuse is fast and the app's own `taskkill /F /T` also takes
the whole process **tree** — so the blast radius of a wrong pid is not one process.
`competitions.rs:977-983` names this hazard in a doc comment and then guards with `is_pid_alive`,
which checks *existence*, which is the one property a recycled pid also has.

**5.2 Treating "the app restarted" as "the run failed".** *Failure mode:* the row says Failed while
the child is still running, still writing to the workspace, still spending tokens. Downstream, a
healing pass or a retry chain now reacts to a failure that did not happen.

**5.3 A liveness check that only asks whether the pid exists.** *Failure mode:* identical to 5.1,
one layer up. `sys.process(Pid::from_u32(pid)).is_some()` answers "does *a* process have this
number", which is not the question.

**5.4 A second registry.** *Failure mode:* the cancel path reads registry A and the boot path reads
registry B, and neither is wrong on its own. Six registries exist here; the two `child_pids` maps
(`engine/mod.rs:240` and `daemon_bin.rs:156`) are the same concept in two processes.

**5.5 Relying on `Drop` for a child.** *Failure mode:* `tokio::process::Child` does not kill on
drop. A future dropped at a `select!` boundary leaves the child running with nothing referencing it
— unfindable by construction.

**5.6 Reconciling only the rows you happen to own.** *Failure mode:* `recover_after_restart` guards
with `if !registry().is_athena_owned(&sid) { continue; }` (`persist.rs:289`). Every non-Athena
session that was `Running` at restart is left in whatever state `inner_from_row` gave it, with
`dozing: true` and `last_pty_output_ms: 0` (`:171`, `:189`) — the two fields that would let the
frozen-process check fire.

**5.7 A cleanup that runs only on the happy path.** *Failure mode:* the `%TEMP%` directory, the
sidecar config carrying a session token, and the registry entry all survive the one exit route you
did not write cleanup for. See [`agent-workspace-isolation`](./agent-workspace-isolation.md) §7.4,
where this is measured on the same driver type.

---

## 6 Evidence

**The one site to copy: `src-tauri/src/daemon/lock.rs`.** Read `:5-38` (the protocol and its three
explicit non-goals), then `:50-59` (the two constants and why 90s is three missed beats), then
`:106-113` (`is_stale`, including the negative-duration arm for a clock that moved backwards). It is
the only module in this repo that decides liveness without asking the OS, and the only one that
wrote down what it deliberately does not do.

Second: **`commands/fleet/persist.rs:147-193` + `:263-299`** — `inner_from_row` and
`recover_after_restart`. The state-mapping at `:151-153` (Exited/Spawning collapse to Stale), the
`state_reason` suffix at `:177-182` (`" · restored after restart"`), and the refusal to auto-resume
at `:259-262` are the classify-don't-declare pattern in production.

Third, and it is the client half: **`src/features/plugins/fleet/sub_settings/FleetProcessScanner.tsx:57-80`**.
The comment above the check is worth reading in full — it names PID recycling, names the repo rule
it is applying ("resolve against the live collection"), cites two sibling call sites, and then
aborts with a visible toast rather than killing whatever now holds the pid.

Counter-evidence, cited because it is the exemplar's mirror: **`engine/mod.rs:703-733`**, sixteen
lines that mark every running execution failed with no check of any kind, and
**`webbuild/devserver.rs:244-254`**, which reads a pid out of *another program's* JSON lock file
(`.next/dev/lock`) and kills its tree — guarded, to its credit, by `pid_is_node`.

---

## 7 Deviations

### 7.1 One pid column in 244 tables, and it has never held a value

`build_sessions.cli_pid` (`db/src/migrations/schema.rs:1489`). Backup DB: **12 rows, 0 non-null**.
Writers: `build_session/mod.rs:196`, `runner.rs:1921`, `events.rs:80` — all write nothing. It is
also not exported to TypeScript (`src/lib/bindings/PersistedBuildSession.ts` has no such field), so
no surface could show it if it were populated. Either populate it with an identity pair or drop the
column; a column that is read, mapped and always null is a permanent invitation to trust it.

### 7.2 `recover_stale_executions` declares failure it did not observe

`engine/mod.rs:703-733`. **74 of 2,188 executions** carry its marker. No liveness check, no
`unproven` state, no user surface. The sibling sweeps are the same shape:
`recover_interrupted_pipeline_runs` (`db/src/repos/resources/teams.rs:724-738`, `status='failed'`,
`'Interrupted by app restart'`), `recover_interrupted_lab_runs`, `persona_jobs::recover_orphans`
(`engine/persona_jobs.rs:257-272`, `' [orphaned by process restart]'`). **Five blind-fail passes;
one classify pass** (`recover_after_restart`), and the classify pass is the newest.

> Backup-DB counts for the other two markers are **0** (`pipeline_runs`, `persona_background_job`),
> which is not evidence they are safe — it is evidence they have not fired on this machine.

### 7.3 `start_time()` appears zero times in 963 Rust files

Verified by two matchers. Every liveness question in the backend is answered by pid existence
alone. `sysinfo` is present and its `Process::start_time()` is one call away.

### 7.4 Three of four `sysinfo` process lookups act without reading any identity field

`fleet/headless.rs:67` (`PidKiller::kill` → `p.kill()`),
`fleet/process_scan.rs:133` (`fleet_kill_pid` → `p.kill()`),
`dev_tools/competitions.rs:990` (`is_pid_alive` → `.is_some()`). The fourth,
`process_scan.rs:118`, reads memory and does not act. **Zero sites read `.name()` / `.cmd()` /
`.exe()` / `.start_time()` before acting** — measured, and it is why §9's positive control returns
0 (see §9.3).

### 7.5 Seven kill-by-raw-pid sites, two of them guarded, none by identity

`taskkill /F /T /PID`: `engine/mod.rs:1704`, `credentials/ai_artifact_flow.rs:572`,
`credentials/auto_cred_browser.rs:1590`, `dev_tools/competitions.rs:1184`,
`webbuild/devserver.rs:223`. `libc::kill(SIGTERM)`: `ai_artifact_flow.rs:582`,
`auto_cred_browser.rs:1600`. Guarded: `competitions.rs:1163` (existence only, via `is_pid_alive`)
and `devserver.rs:249` (name, via `pid_is_node` — the strongest backend guard in the tree). The
`/T` flag means each of these kills a **tree**.

### 7.6 No `Drop` on any child-owning struct; 17 of 112 command sites set `kill_on_drop`

Command construction sites: **112 in 56 files** (`Command::new` / `CommandBuilder::new`, comments
and `#[cfg(test)]` modules and `*_tests.rs` excluded). `kill_on_drop(true)`: **17**. The
neighbouring rule `unbound-child-lifetime`
([`cancelling-in-flight-work`](./cancelling-in-flight-work.md)) ratchets the piped-stdio subset at
12 files / 13 matches; this is the wider population.

### 7.7 The app-exit hook covers one of six child-owning registries

`lib.rs:3755-3763` → `webbuild_servers.stop_all()`. Not covered: `FleetRegistry`'s PTY children,
`ExecutionEngine::child_pids`, the MCP `stdio_session_pool`, `DEV_SERVERS` (competition dev
servers), `ActiveProcessRegistry`. Note that `RunEvent::Exit` does not fire on a hard kill anyway —
which is the argument for `kill_on_drop` and the heartbeat, not against the hook.

### 7.8 Fleet restart recovery is scoped to Athena-owned sessions

`persist.rs:289`. Every other session that was `Running` or `AwaitingInput` at restart is rehydrated
with `child_pid: None`, `dozing: true`, `last_pty_output_ms: 0` (`:171-189`) and never parked, so
its `state_reason` says *"Restored after restart — select to resume"* while nothing has established
whether the underlying `claude` is alive. The scoping looks deliberate; the asymmetry is not
documented as such.

### 7.9 `Cargo.toml`'s own comment contradicts the code

`src-tauri/Cargo.toml:136-138` trims `sysinfo` to the `system` feature because *"we only need the
'system' module (CPU usage + memory), and never enumerate processes."*
`fleet/process_scan.rs:60-62` enumerates the entire process table with
`ProcessRefreshKind::everything()`. A stale comment beside a dependency is how the next person
decides not to reach for `start_time()`.

### 7.10 A pid is read out of a foreign program's state file and its tree is killed

`webbuild/devserver.rs:244-254` parses `.next/dev/lock` and calls `kill_tree`. This is the only
place the app trusts a pid it did not produce. It is also, correctly, the place with the strongest
guard (`pid_is_node`) — worth noting because it shows the identity check was reachable and was
reached exactly where the author felt least safe.

---

## 8 Gaps — what the primitive genuinely cannot do

**8.1 Reconciliation is not decidable, and the gap is honest.** A child started by a previous build
of the app, on a machine that has since rebooted, cannot be matched to a row by any mechanism. This
is why §2(e) exists: the residue must reach a human. `persist.rs:259-262` reached this conclusion
independently.

**8.2 `cwd` is not an identity when sessions share a directory.** The repo says so
(`persist.rs:259-262`). This is the reason `fleet_resume_orphan` is a user action rather than a boot
step, and it does not have a better answer available.

**8.3 A `Drop` guard cannot be `async`.** A synchronous drop cannot await a child's exit, so the
RAII form that solves the *directory* half of this problem
([`agent-workspace-isolation`](./agent-workspace-isolation.md) §9.1) only half-solves the *process*
half. `kill_on_drop` is the tokio-provided answer and it is best-effort.

**8.4 `RunEvent::Exit` does not fire on SIGKILL, a power loss, or a Windows force-quit.** Any
exit-hook design is therefore a courtesy, and the durable record has to carry the load. This is not
a defect in the hook; it is the reason (a) outranks (d) in §2.

**8.5 The census cannot assert an absence, and three of this leaf's largest findings are absences** —
no pid identity anywhere, no `unproven` state, no exit teardown for five registries. See §9.3.

---

## 9 The missing gate

### 9.1 First: the type, and where it stops

**Make a bare pid unusable at the point of action.** A `ProcessIdentity` newtype with private fields
and a single constructor — one that takes a `&sysinfo::Process` and captures `(pid, start_time,
name)` — makes "kill by a number I read out of a database" unspellable, because a `u32` cannot
become one. `kill(identity: ProcessIdentity)` would refuse `kill(row.cli_pid)` at compile time.

Against the doctrine's seven qualifications this is a **partial** win and the qualifications say
where it stops:

- **Q4 (a type anyone can construct authenticates nothing)** is satisfied only if the field stays
  private and there is no `ProcessIdentity::from_pid`. The moment someone adds one for a test, the
  type is a comment.
- **Q3 (a type nobody constructs constrains nothing)** is the real limit here: there are **7**
  kill-by-pid sites and **4** sysinfo lookups. A type guarding 11 sites is worth much less than the
  same effort spent on §2(a), which removes the need to identify a process at all.
- **Where types cannot reach, item 5 (the far side of a serialization boundary)** applies directly:
  the pid the frontend sends to `fleet_kill_pid` arrives as a JSON number. A newtype at the Rust
  boundary is downstream of where the value entered. The client-side re-verification in
  `FleetProcessScanner.tsx:65-75` is doing the work a type cannot, and it is *advisory* — a caller
  that invokes `fleet_kill_pid` directly bypasses it entirely.
- **Where types cannot reach, item 2 (through a global)**: `child_pids` is an
  `Arc<Mutex<HashMap<String, u32>>>` reached without crossing a parameter.

**So the honest ranking is: heartbeat (§2a) ≫ identity type (§2b) > any gate.** The type is worth
proposing; it is not the answer.

### 9.2 The declined rule, with its numbers

I built the natural rule and **declined it**, because it cannot be published with a positive control
and the reason it cannot is the finding.

**Anchor:** every `sysinfo` process lookup in `src-tauri/**/*.rs` — `sys.process(…)` /
`system.process(…)`. **4 matches in 3 files.**

| | pattern | files | matches |
| --- | --- | ---: | ---: |
| violating | lookup → `.kill(` / `.is_some(` / `.map(` with **no** `.name()`/`.cmd()`/`.exe()`/`.start_time()`/`.cwd()` in between | 3 | **3** |
| positive control | lookup → identity field read before any `.kill(` | **0** | **0** |

`scripts/census/run-census.mjs` fails a rule that matches zero files, on purpose —
*"a census rule that finds nothing is a broken regex far more often than a finished migration"* —
so the control cannot ship, and doctrine §4 requires one. **A control returning zero means either
the pattern is not discriminating or the compliant form does not exist. Here it is provably the
second**: the pattern *does* discriminate within the anchor — it excludes `process_scan.rs:118`
(the memory read, which acts on nothing) and includes `:133` (the kill) — and
`.start_time()` occurs nowhere in the tree. The compliant form is absent, not unmatched.

A 4-site anchor is also too small to ratchet usefully: a single new `sysinfo` call moves it 25%.
Publishing a rule here would buy a number that mostly measures how often anyone touches
`process_scan.rs`.

The wider candidates were measured and are worse: `Pid::from_u32(` is **5 matches in 3 files** and
matches the compliant `memory_bytes_for` too; `"taskkill"` is **5 matches in 5 files** and the two
guarded sites are guarded by code in a *different function*, which no forward-scanning pattern can
see and which a variable-length lookbehind would find at the cost doctrine §2 forbids.

### 9.3 What the instrument should be instead

The condition this leaf needs enforced is **"no non-terminal row survives a boot without either a
liveness proof or a human-visible unproven state"**, and that is an **absence** — the census
ratchets presences by construction (doctrine §4). Two instruments would work and neither is a
census rule:

1. **A boot-time assertion, in the app.** After the classify pass, count rows still claiming a
   non-terminal state with a freshness column older than threshold and **no** `state_reason`. Emit
   it as a metric and fail the pass loudly at zero *rows scanned* — the precondition failure that
   `check-csp-hosts.mjs` had to learn twice. A gate that finds nothing because it looked at nothing
   is the failure mode this whole section exists to prevent.
2. **A schema check, in CI.** Assert that no column named `*pid*` exists without a sibling
   `*start*`/`*heartbeat*`/`*activity*` column in the same table. It is a five-line script over
   `PRAGMA table_info`, it fails loudly when it enumerates zero tables, and it would have caught
   `build_sessions.cli_pid` the day it was added. Today it would report exactly one finding.

Both are **deferred, not applied**: (1) changes what a running app writes at boot and (2) is a new
CI gate, and the standing rule is that this campaign writes those down rather than shipping them.

### 9.4 The rules I checked for overlap

`unbound-child-lifetime` (`cancelling-in-flight-work`; `Command::new` … `Stdio::piped()` … `spawn()`
without `kill_on_drop`; 12 files / 13 matches) is the closest neighbour and covers §7.6's subset —
it is the reason this path does not propose a `kill_on_drop` rule. `unswept-job-registry-read`
covers a different registry concern. Neither touches pid identity.

---

## 12 Corrections

### 12.1 `sides: "client"` is **inverted**, not incomplete

The spine says `client`. Every storage site, every registry, every boot sweep, every liveness check
and every kill is **server-side Rust**. The client contributes three `invoke` wrappers
(`api/fleet/fleet.ts:249-266`) and one component.

But this is not the doctrine's seventh-contradiction shape ("no client half at all"), and it is
worth separating: **the single best implementation of this leaf's core rule lives on the client.**
`FleetProcessScanner.tsx:65-75` is the only place in the entire codebase that re-derives a process's
identity before acting on it. So the label points at the wrong side for the *defect surface* and at
the right side for the *exemplar of one clause*. That is a new failure mode for the `sides` ledger:
not "incomplete", not "inverted", but **split by role** — the label named where the best answer is
and missed where all the problems are. Recorded here for the ledger; the current tally becomes
8 contradicted / 2 upheld for `client`, with this one flagged as a distinct mode.

### 12.2 The brief's spawn-site warning was right, and I reproduced the failure it warned about — in my second implementation

The brief said a hand-verified audit found 6 real spawn sites after a first matcher said 25, and
instructed me to re-derive every inherited spawn count with two implementations. I did, and **the
two disagreed: 112 sites in 56 files versus 104 in 53.** Per doctrine §2 the disagreement is the
finding, so I resolved it by hand rather than picking a number.

**The library-assisted implementation was right.** My bespoke blanker desynchronized on Rust **raw
strings** — it enters string mode on `"` and leaves on the next `"`, so `r#"…"#` closes early, the
trailing `#` is read as code, and the *next* `"` re-opens the string — after which real code is
blanked as string interior for the rest of the file. Its `#[cfg(test)]` stripper then brace-matched
across corrupted input and ate production code that happened to sit after a test module. Every one
of the 8 disputed sites was a genuine production `Command::new` at a line **before** the file's
`#[cfg(test)]` marker (`dev_mode.rs:643` vs `:1040`; `drive.rs:1437`/`:1445` vs `:1469`;
`auth_detect.rs:424` vs `:691`) plus `desktop_discovery.rs:580`, a production function placed
*after* the test module — the exact case the doctrine's mechanics note describes.

This is the case for `scripts/census/lib/instruments/`: `extractRustStrings.mjs`'s docstring records
this precise bug, in this precise repo, and my hand-rolled version rediscovered it four hours later.
**A second implementation is required to be independent, not to be naive.**

### 12.3 My first matcher for "process-start sites" said 301, and it was contaminated by `.status()`

Before anchoring on `Command::new`, I counted `.spawn()` / `.output()` / `.status()` and got
**301 sites in 101 files**. Roughly two thirds are not processes: `.status()` on an HTTP response
(`cloud/sync/client.rs`, `gitlab/client.rs`, `notifications.rs` — 18 in that file alone) and
`.status()` on an execution row (`engine/db_query.rs`, 16). Anchoring on the **constructor** rather
than the **verb** took it to 112. Same family as the brief's 25-vs-6: *a substring match answers
"does this text appear", never "is this a thing"*. I am recording it because 301 was the number I
would have published if the two implementations had happened to agree.

### 12.4 The brief said the operator's machine held 6 stale `fleet-mcp-*` directories. Today it holds **0**

Enumerated 2026-08-17 over all 87,149 entries of `%TEMP%`: `fleet-mcp-*` = **0**,
`build-session-*` = 0, `personas-exec-*` = 0, `personas-workspace` = 0. The brief itself says those
six were **removed on 2026-08-17**, so the evidence is consistent and simply no longer on disk. I
am naming it rather than silently reporting zero, because *a defect is not resolved by deleting the
artifacts that exhibited it* — the reaper closure that cleans `fleet-mcp-*` (`fleet/pty.rs:524-528`,
`headless.rs:258-262`) still does not run when the app is killed, and there is still no boot sweep.
The one nonzero runtime prefix today is `personas-capprobe-*` at **132**, which belongs to
[`agent-workspace-isolation`](./agent-workspace-isolation.md) §7.5.

### 12.5 The brief called PID reuse "the sharp edge". It is — but the blunter edge cuts more often

PID reuse needs a coincidence. **The failure that has already happened 74 times is 5.2**: the app
declares a run failed because it restarted, without knowing whether it failed. That number is
countable, dated, and sitting in the backup; the pid-reuse number is zero observed and unbounded in
consequence. Both belong in the path, and §0 leads with the one that has receipts.

### 12.6 What was NOT done

- **The convergence label was not tested.** `convergence: "converged"` stands untested against the
  five sibling checkouts. The doctrine's ledger (13 tested, 13 failed) is unchanged by this
  document. Recorded as a gap, not implied by silence.
- **`cargo` was not run.** Every Rust claim is from reading plus database and filesystem evidence.
- **No process was killed and no row was written.** The `fleet_kill_pid` / `fleet_resume_orphan`
  paths were read, not exercised.
- **Deferred fixes owed to the register** (append at the orchestrator's next free numbers):
  (a) `recover_stale_executions` writing an `unproven` state with a `state_reason` instead of
  `Failed`; (b) `kill_on_drop(true)` on the child-owning spawn sites that do not deliberately
  outlive the app; (c) registering the five uncovered registries with the `RunEvent::Exit` hook;
  (d) either populating `build_sessions.cli_pid` with an identity pair or dropping the column;
  (e) the `PRAGMA table_info` schema check from §9.3(2); (f) correcting the stale `sysinfo` comment
  at `Cargo.toml:136-138`.
