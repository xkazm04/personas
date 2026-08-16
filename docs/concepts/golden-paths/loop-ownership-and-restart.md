# Golden path — Loop ownership and restart

> Situation node: `backend-runtime/background-work/loop-ownership-and-restart` ·
> [situation spine](../situation-spine.md) · recurrence 8 · risk **HIGH** ·
> sides: **server** · convergence: **spine says CONVERGED — see §12.1, it does not hold** ·
> dimensions: **resilience · function · code-quality · cost**
> Composed 2026-08-16 against `master` @ `ec1bf0359`.
>
> **Sweep.** All **963** `.rs` files under `src-tauri`. Read in full:
> `src/engine/leadership.rs` (284 lines), `src/daemon/lock.rs` (497),
> `src/engine/subscription.rs` `run_single` + the `ReactiveSubscription` trait,
> `src/engine/background.rs` `start_loops`/`stop_loops`/`try_begin_start`,
> `src/lib.rs` `setup()` (the whole boot sequence, lines 700–1800), all **10**
> boot-recovery functions, `db/src/repos/execution/executions.rs`
> `get_running_only` / `update_status` / `update_status_if_running` /
> `exec_status_update` / `claim_for_instance`, `src/commands/fleet/stale.rs`,
> `src/companion/dev_mode.rs`. All **41** `ReactiveSubscription` impls counted
> (**39 production**, 2 in `subscription.rs`'s own `#[cfg(test)]` module);
> all **52** periodic loop bodies in the tree located by a brace-matching scanner
> and hand-classified; all **10** production leadership-gate call sites opened.
>
> **Measured by executing, not by reading.**
>
> 1. **The engine-leadership protocol was replayed**, transcribed line by line
>    from `daemon/lock.rs:175-248` and `leadership.rs:123-191`, against real
>    files on disk with a controllable clock. **The split brain reproduces in
>    five steps and is permanent.** The one-line fence that stops it was replayed
>    too. The boot-recovery statements were replayed verbatim against real
>    SQLite (`node:sqlite`), including the double-write that leaves a row reading
>    `completed` with a restart error message.
> 2. **Read-only copies of both live SQLite files** (`personas.db` 347 MB,
>    `personas_data.db` 17.5 MB, copied 2026-08-16 17:15 local with their
>    `-wal`/`-shm`, opened `readOnly: true`). The live files were never opened
>    for write; `engine-leader.lock` showed pid 22264 heartbeating at copy time.
> 3. **Six days of the app's own rolling tracing log** were read
>    (`personas.2026-08-11.log` … `personas.2026-08-16.log`) and every
>    leadership, acquire, release and stale-lock line counted. This is where the
>    two concurrent instances turned up.
> 4. The §9 rule was measured by **two independent implementations** (a
>    string/comment-aware Rust lexer and the census engine) that **disagreed
>    twice**; both disagreements were hand-verified and both were bugs in the
>    lexer (§9). Fault-injected **16 ways**, overlap-checked against **453 match
>    sites** of the eleven nearest existing rules (**0 collisions**), validated in
>    a composer-private scratch registry, then re-extracted from this finished
>    document and re-run. **The full registry was NOT run**, per the doctrine.
> 5. **`cargo` was not run** (the operator's app is running) and **no second app
>    instance was started**. Every Rust claim is static and traces to a file
>    opened during composition.
>
> ---
>
> ## 0 The headline: this app elects a leader 435 lines after it has already destroyed the previous leader's work — and it did that on 33 separate boots
>
> `lib.rs:815` fails every `running` execution in the database.
> `lib.rs:1250` finds out whether this process is allowed to touch them.
>
> ```
> lib.rs: 815   engine::ExecutionEngine::recover_stale_executions(&pool);
>        : 821   n8n_sessions::recover_interrupted_sessions(&pool)
>        : 842   teams::recover_interrupted_pipeline_runs(&pool)
>        : 854   lab::recover_interrupted_lab_runs(&pool)
>        : 864   companion::approvals::recover_interrupted_approvals(&user_db_pool)
>        : 909   engine.requeue_persisted_executions(...)     <- RE-RUNS queued work
>        :1250   let became_leader = state_arc.leadership.try_acquire();   <- HERE
>        :1375   engine::persona_jobs::recover_orphans(&pool)
>        :1388   if leadership_for_worker.is_leader() { ... }             <- 13 lines later
> ```
>
> Six destructive whole-table sweeps and one re-dispatch run **before** the
> election. `recover_orphans` at `:1375` runs **after** it and still ignores it,
> thirteen lines above the gate that protects the worker loop it exists to serve —
> the same shape [job-claim-and-lease](./job-claim-and-lease.md) D2 recorded from
> the claim side. Not one of the seven is scoped to an owner, a pid, a host, an
> instance id, or an age.
>
> ### It is not hypothetical. Two instances ran on this machine in the last six days.
>
> Every leadership line in ~4.3 MB of the app's own log, counted:
>
> | line | six-day count | what it means |
> | --- | ---: | --- |
> | `engine leadership: startup acquire` `leader=true` (`leadership.rs:1251`) | **34** | this process owns the loops |
> | `engine leadership: startup acquire` **`leader=false`** | **2** | **a second instance was already live** |
> | `Scheduler starting via unified subscription model` (`background.rs:478`) | **36** | 36 process starts in 6 days |
> | `removing stale daemon lock file` (`lock.rs:190`) | **36** | **every** boot evicted a lease nobody released |
> | `engine leadership released` (`leadership.rs:198`) | **0** | `EngineLeadership::release()` has **zero production call sites** |
> | `relinquishing leadership` (`leadership.rs:176`) | **0** | — |
>
> **`release()` exists, is tested (`leadership.rs:244`), and nothing calls it.**
> The single `RunEvent::Exit` handler in the app (`lib.rs:3758-3762`) stops Bun
> dev servers and nothing else. So every exit is an unclean exit as far as the
> lease is concerned, and the 36-for-36 stale-lock evictions are the proof.
>
> Those two `leader=false` boots each still ran all seven sweeps above, because
> the sweeps happen 435 lines before the process learns it is a follower.
>
> ### The live artefact: 74 executions killed by somebody else's boot
>
> | | |
> | --- | ---: |
> | `persona_executions` rows whose `error_message` is `'App restarted while execution was running'` | **74** |
> | share of **all 238** `failed` rows | **31%** |
> | rank among all failure causes | **#2**, behind only the persona's own `exit code 1` (97) |
> | distinct boot minutes that produced them | **33** |
> | of those 74: rows with tokens / cost / output / duration | **0 / 0 / 0 / 0** |
> | of those 74: rows that had written a `last_heartbeat_at` first | **61** |
> | `persona_executions` ever carrying `claimed_by_instance` | **0 of 2,188** |
>
> The zeros are the interesting column. Every one of the 74 was killed before it
> produced anything — which is what a *genuine* orphan of a real process exit
> looks like, and is the honest reading here, because this operator runs one
> instance at a time. The defect is that **the code cannot tell that case from
> the other one**, and the log says the other one happened twice this week.
>
> ### Split brain, replayed in five steps
>
> `EngineLeadership::is_leader()` (`leadership.rs:157-162`) is
> `self.lock.lock().map(|g| g.is_some())` — **an in-memory `Option`. It never
> re-reads `engine-leader.lock`.** `DaemonLock::heartbeat()` (`lock.rs:230-248`)
> writes a temp file and `fs::rename`s it over the path — **it never checks that
> the file it is overwriting is still its own.** Replayed with the protocol
> transcribed verbatim and a controllable clock:
>
> ```
> A.try_acquire -> true   A.is_leader -> true    lock file pid = 1001
> B.try_acquire -> false  B.is_leader -> false            (correct: one leader)
> >>> A stalls 91s (laptop sleep / a blocking query / a debugger breakpoint)
> B.tick()   -> B.is_leader -> true               lock file pid = 2002
>            -> A.is_leader -> true               A learned nothing
> A.tick()   -> heartbeat() renames pid=1001 over B's file
>
> >>> A.is_leader() = true    B.is_leader() = true     TWO LEADERS
> after 5 more 30-second heartbeat rounds:  A=true  B=true
> ```
>
> It is not a transient. Both processes keep heartbeating, so neither file is
> ever stale again, and neither process ever reads it. **Both pass the gate at
> `subscription.rs:1284-1290` forever**, double-firing all 39 singleton loops:
> the trigger scheduler, the event bus, OAuth rotation, the webhook notifier,
> the Slack/Discord pollers, the relays.
>
> The fence is one statement, and it was replayed too:
>
> ```
> A2 fenced heartbeat kept leadership? false
> A2.is_leader -> false   B2.is_leader -> true   file pid = 2002
> >>> exactly one leader, and the loser LEARNS it lost.
> ```
>
> `lock.rs:87-88` records `pid` and says in prose it is *"Recorded for
> diagnostics; NOT used for liveness"*. The value that would prevent this is in
> the file, and reading it is the fix.
>
> ### And the boot sweep can overwrite a live owner's result
>
> Replayed against real SQLite with both statements transcribed from this tree
> (`executions.rs:1357` `get_running_only`, `engine/mod.rs:711`
> `update_status(… Failed …)`):
>
> ```
> instance B boots. get_running_only() sees: [ 'live-run-of-instance-A' ]
> B fails it: 1 row -> { status: 'failed', error_message: 'App restarted while execution was running' }
> A finishes:  1 row -> { status: 'completed', error_message: 'App restarted while execution was running' }
> >>> the row reads completed WITH a restart error. Neither process can tell.
>
> the same sweep, scoped to the sweeper's own instance:
> B sweeps only rows it owns: 0 rows -> { status: 'running' }
> >>> zero. A's live run survives. One column in the WHERE clause.
> ```
>
> `recover_stale_executions` reaches `update_status` (`executions.rs:934`), whose
> `WHERE` is `id = ?12` and nothing else. **`update_status_if_running` — the same
> function with `AND status = 'running'` — is defined nineteen lines below at
> `:953`, and its doc comment describes this exact hazard:** *"This prevents the
> cancel safety-net from overwriting a final status that the spawned task already
> wrote."* The recovery pass calls the other one.
>
> ### "Restart" is not a concept in this repo
>
> Nothing anywhere records that a process restarted, whether it exited cleanly,
> how many times it has started, or when the last clean shutdown was. There is no
> `restart_count`, no shutdown marker written on exit and read on boot, no
> `unclean_shutdown` flag. **Restart is inferred, every time, from a `WHERE`
> clause** — "this row says `running` and I am starting, therefore its owner is
> dead". Seven functions carry that inference and one of them writes it into the
> user-visible error text of 74 rows.
>
> The single function in 963 files named for the concept —
> `commands/fleet/persist.rs:263` `recover_after_restart` — is also **the only
> one of the ten that does not terminalise.** It parks the session with a
> human-readable reason and leaves the process alone, and its doc comment says
> why: matching a process to a session by cwd is ambiguous, so *"too risky to
> fire unattended"*.
>
> ### The exemplar exists, and it exists because it broke in production
>
> `companion/dev_mode.rs:487-505` `recover_interrupted_dev_ops` is the only
> recovery pass in the tree that **checks whether the previous owner is actually
> gone** before rewriting its work:
>
> ```rust
> // Liveness check — live-caught defect 2026-07-04: companion_init can
> // re-run while a dispatched session is STILL WORKING (panel remount /
> // page reload re-invokes it), and the first sweep marked a 5-second-old
> // op `interrupted` mid-run. A session present in the fleet registry is
> // not an orphan, whatever the ledger row says.
> ```
>
> That last sentence is this leaf's entire principle, written in this repo, by
> someone who shipped the bug first. **It is 1 of 10.**
>
> ### A restart silently disarms four fleet policies
>
> `MAX_LIVE_SESSIONS` (`commands/fleet/stale.rs:151`) is
> `AtomicU64::new(0)`, and `0` means **unlimited / feature off** (`:145-147`).
> Its only writer is `fleet_set_live_slots`, a Tauri command
> (`commands/fleet/commands.rs:254`). The same is true of
> `AUTO_HIBERNATE_ENABLED` (`:128`, default `false`), `STALE_OVERRIDE_SECS` and
> `STALLED_OVERRIDE_SECS` (`:170-171`, default `0` = built-in). **There is no
> boot restore for any of them**: `app_settings` holds no key matching
> `%live%`, `%slot%`, `%hibernate%` or `%cutoff%`, and the frontend admits it in
> a comment at `stores/slices/system/fleetSlice.ts:222-224` —
>
> > *"Sync the persisted auto-hibernate policy to the always-on Rust ticker.
> > (Opening Fleet at least once per app session activates an enabled policy; a
> > startup-side push is a tracked follow-up.)"*
>
> So after every restart the process runs uncapped and never hibernates until a
> human opens one panel. `commands/infrastructure/overnight.rs:401` reads
> `live_slot_cap()` to size its dispatch, and `:143` treats `0` as "use
> `FALLBACK_NIGHT_LIVE_CAP`" — an overnight fleet wave sized off a value the
> restart zeroed.
>
> ### Sibling boundaries, settled in prose
>
> [**background-loop**](./background-loop.md) owns one loop's wait, cancellation
> and panic boundary. **This path owns who is allowed to run it at all**, and the
> `generation` counter (`background.rs:142`) is the in-process half of the same
> question — it is the only correct piece of ownership machinery in the tree
> (§6).
>
> [**stall-watchdog**](./stall-watchdog.md) owns whether a ticking loop produced
> anything. **This path owns whether it was ever the loop's turn to tick.** Its
> D2 (a watchdog disarmed by a flag with no record) and this path's D5 (a
> leadership gate that skips with no record) are the same anti-pattern at two
> different gates; its rule `outcomeless-tick` and this one share **0** match
> sites.
>
> [**job-claim-and-lease**](./job-claim-and-lease.md) owns taking one row and
> giving it back. **This path owns the process-level claim above it** — and the
> two are welded: `claimed_by_instance` is written by exactly one statement and
> read by none (that document's finding 3), so **the boot sweeps here have
> nothing to scope themselves to**. Its D1 fix and this path's D1 fix are the
> same commit.
>
> [**terminal-state-and-recovery**](./terminal-state-and-recovery.md) owns what a
> recovery pass writes and whether downstream can read it. **This path owns
> whether that pass had the right to run.** A perfectly-legible `failed` row is
> still wrong if the work is still going.
>
> [**process-global-command-state**](./process-global-command-state.md) owns
> in-process singletons. **This path owns what a restart does to them** — §0's
> fleet policies are the measured case.
>
> The **Deviations** section is a fix backlog and contains **one reproducible
> split-brain** (D1), **seven unscoped boot sweeps** (D2), and **one
> silently-disarmed safety cap** (D6).

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no
file path, primitive name or count. Each clause names its warrant, and the
warrants come from the six-repo sweep in §6 — which **inverted the spine's
`converged` label** (§12.1).

> **P1 — physics, and the whole subject.** *A background loop needs an owner, and
> the owner must be a fact in shared storage, not a fact in one process's
> memory.* Two processes on one store is the normal case, not the exotic one: it
> is produced by a restart, by a dev instance, by a headless daemon, by a second
> window, by a crash-and-relaunch. Any answer that lives only inside a process
> cannot survive the arrival of a second one.
>
> **P2 — physics, and the single most-reinvented defect in the family.** *Acquire
> is fenced; release and renew almost never are.* Taking ownership is one
> statement a reviewer can see, and every repo gets it right. Keeping it —
> proving on each heartbeat that you are still the owner before you write as the
> owner — is a second statement somewhere else, and **every repo in the family
> gets that wrong.** A renew that does not verify is not a renew; it is a
> silent takeover in the wrong direction.
>
> **P3 — physics.** *An ownership predicate must be re-evaluated at the moment of
> use, not cached at startup.* A boolean answering "am I the leader?" is a
> photograph of a fact that expires. The check and the act must be close enough
> together that nothing can move between them, or the check must carry a lease
> whose expiry the act re-tests.
>
> **P4 — physics, and the clause the whole leaf turns on.** *A recovery pass must
> address the work it is recovering by its OWNER, never by its state alone.*
> "Status says in-flight" is a statement about the row; "and its owner is gone"
> is the statement you actually need, and only the second one is safe. Where
> there is no owner column, the pass must consult a liveness registry — and where
> it can do neither, it must be gated behind proof that no other owner exists.
>
> **P5 — physics.** *Elect the owner before you act as the owner.* Ordering is
> the cheapest half of this entire subject: a recovery pass placed after the
> election, and gated on winning it, is correct even with every other clause
> unimplemented.
>
> **P6 — physics, reported as SILENCE 5/5 and therefore doctrine on absence
> rather than on practice.** *"Restarted" and "started" are different events, and
> nothing records the difference anywhere.* A process that cannot tell whether
> the last shutdown was clean will guess, and the guess is always "everything I
> find in flight is dead". Write a marker on clean exit; read it on boot; treat
> its absence as *unclean*, not as *nothing happened*.
>
> **P7 — ergonomics.** *Every ownership gate must say when it declined.* From
> outside, "I am not the leader", "there is nothing to do", and "this loop is
> dead" are the same observable: nothing. A bare `continue` on a leadership check
> makes an idle follower indistinguishable from a broken app for the entire life
> of the process.
>
> **P8 — house convention, flagged, and the oracle says the opposite.** *A
> concurrency cap whose "off" value is `0` will be off after every restart.*
> Prefer a floor (`max(1, …)`) and a durable value read at boot. Three sibling
> repos independently floor their caps and write down why; this repo's default-0
> is local, not physics — see §6 clause 7.
>
> **P9 — physics as a defect, 5/5.** *An ownership gate that fails OPEN turns a
> missing dependency into an extra owner.* When the state a gate consults is
> unavailable, "assume I am the owner" is the wrong default at exactly the moment
> the system is least able to tell.

---

## 1 Trigger

- "Can two copies of this app run at once? What happens if they do?"
- "This row says `running` but nothing is running — should I just fail it at startup?"
- "I'm adding a `tokio::spawn` with a `loop` in it."
- "Why did my execution die the moment I opened a second window / relaunched?"
- "Is it safe to sweep these on boot? They're obviously orphans."
- "The leader crashed — how long until someone else takes over?"

If you are about to type `is_leader()`, `try_acquire`, `instance_id`,
`heartbeat`, `STALE_THRESHOLD`, `recover_*`, `WHERE status = 'running'` in an
`UPDATE`, `[orphaned by process restart]`, `Interrupted by app restart`,
`static X: AtomicU64::new(0)` as a policy default, or a `tokio::spawn` whose body
is `loop { … sleep(…).await }` — you are in this situation.

**Not this path:** *one loop's wait, panic boundary and cancellation* is
[background-loop](./background-loop.md); *whether a ticking loop produced
anything* is [stall-watchdog](./stall-watchdog.md); *taking and releasing one
row* is [job-claim-and-lease](./job-claim-and-lease.md); *which terminal state a
recovery writes and whether the UI can read it* is
[terminal-state-and-recovery](./terminal-state-and-recovery.md); *the user
pressing Stop* is [cancelling-in-flight-work](./cancelling-in-flight-work.md).

## 2 The one way

**Elect the owner first, prove the election on every use, and never let a
recovery pass touch a row it cannot prove is unowned.** Concretely: (a) **acquire
ownership before any code that mutates shared work**, at the very top of boot —
every destructive recovery pass and every loop spawn goes strictly after it, and
this ordering alone fixes most of §7. (b) **The ownership check must re-read the
shared artifact, or carry a lease whose expiry it re-tests** — a cached `bool`
from startup is a photograph, and the process holding it will act on a lease it
lost minutes ago. (c) **Fence the renewal**: before a heartbeat rewrites the
ownership record, it must verify the record still names *it*; if it does not, the
correct action is to drop ownership loudly, not to overwrite. This is one `read
→ compare → write` and it is the difference between one leader and two forever.
(d) **Stamp the owner onto the work**, at claim time, in the same statement that
takes it — a process id, host and instance id, so a later sweep has something to
compare against. Without (d), (e) is unimplementable. (e) **Scope every recovery
pass**: `WHERE status = <in-flight> AND (owner = ?me OR owner_lease_expired)`,
or, where no owner column exists, consult a liveness registry before writing —
and where you can do neither, gate the pass on having *won* the election. (f)
**Record the shutdown**: write a marker on clean exit, read it on boot, and treat
its absence as an unclean stop worth logging — otherwise "restarted" and
"started" are the same event forever. (g) **Release ownership on exit**, so the
next process is a leader immediately instead of waiting out a stale window; and
know that this is a latency optimisation, never a substitute for (b)–(c),
because it does not run on `SIGKILL`. (h) **Log every ownership decline** with
the loop's own name at `info!` — a follower that is silently idle looks exactly
like a broken one. (i) **Re-read process-global policy from durable storage at
boot**, and floor any concurrency cap at 1 rather than letting `0` mean
"unlimited". Then stop: do not add a second lock file, do not add a per-loop
mutex, and do not add another reaper.

If you must get one right first: **(a)**. It is a code move, not a design, it
needs no schema, and it converts the six live defects in §7 D2 from
"double-executes another process's work" into "wastes a few milliseconds".
**(c) is second**, because it is the only one that fails silently and permanently.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src/engine/leadership.rs:100` `EngineLeadership` + `:123` `try_acquire()` + `:116` `instance_id()` | the repo's process-election answer. `instance_id` is a fresh UUID per launch and is the value every claim and every sweep should be scoped by. Adopt it — but land D1 first, because `is_leader()` (`:157`) is a cached `Option` |
| `src/daemon/lock.rs:57` `STALE_THRESHOLD` + `:60` `HEARTBEAT_INTERVAL` | **the one threshold to copy.** 90 s justified in prose as *three missed heartbeats* (`:52-56`), not chosen. The corpus has hunted for a derived threshold across five paths; this is it |
| `src/daemon/lock.rs:175` `acquire_named` | atomic acquire: `OpenOptions::create_new` (`CREATE_NEW` on Windows, `O_EXCL` on Unix) with an explicit note (`:211-212`) that it loses the race deliberately. The acquire half is correct and needs no change |
| `src/engine/background.rs:142` `generation: AtomicU64` + `:197` `try_begin_start` + `subscription.rs:1266` | **the best ownership machinery in the tree, and the only complete one.** A monotonic counter bumped on start *and* stop; each spawned loop captures it and compares against a fresh load every tick, so a loop orphaned by a stop-then-start retires itself. Its doc comment (`:139-141`) explains why a shared `bool` is unsafe here. This is P3 solved — in process |
| `src/engine/subscription.rs:98` `requires_leadership() -> true` | the gate as a **default**, not a call site: every one of the 39 production subscriptions inherits it and a genuinely per-instance loop must opt out. This is the shape the 10 hand-written gates should have had |
| `src/companion/dev_mode.rs:493-505` the fleet-registry liveness check | **the one recovery pass to copy.** Consults a live registry before writing anyone off, with the production incident that motivated it in the comment. §6 |
| `src/commands/fleet/persist.rs:263` `recover_after_restart` | recovery that **parks** rather than terminalises: the row is marked recoverable with a human-readable reason and the process is left alone. The right default when you cannot prove death |
| `db/src/repos/execution/executions.rs:953` `update_status_if_running` | the guarded settle. Returns `bool`, so a refused write is a verdict. Nineteen lines below the unguarded `update_status` the recovery pass actually calls |
| `db/src/repos/communication/events.rs:961` `reap_stuck_processing` + `background.rs:1101` the two-consecutive-sighting rule | the best sweep in the repo: a CAS guarded on the state it is leaving, `RETURNING` the verdict, a retry ceiling, and a *second sighting* required before acting. `events.rs:930-935` names the reason — *"a single snapshot cannot tell a stranded row from one a healthy tick is processing right now"* |
| `src/companion/proactive/mod.rs:228, :241, :250` | the compliant **sweep** shape when there is no owner column: three expiries, each scoped by an explicit age window rather than by status alone |
| `leadership.rs:78-85` `PERSONAS_FOLLOWER=1` | the escape hatch that makes a second instance safe to run beside a real leader. Use it for every test/dev instance; it is the reason this repo can have two processes at all |

**Do NOT build:** a second lock file; a `bool` snapshot of ownership consulted
later; a heartbeat that writes without reading; a boot pass whose predicate is a
status and nothing else; a recovery pass placed before the election; an
`AtomicU64::new(0)` policy default where 0 means "off"; a per-loop `is_leader()`
`if` when the loop could join the subscription registry and inherit the gate.

## 4 Steps

1. **Decide whether this loop is a singleton.** If two processes running it
   simultaneously would double-fire, double-charge, double-rotate or double-send
   — it is. In this repo the answer is yes 39 times out of 39, which is why
   `requires_leadership()` defaults to `true`.
2. **Put it in the subscription registry** (`background.rs:503-760`) rather than
   in a `tokio::spawn` in `lib.rs`. You inherit the leadership gate, the
   generation retirement, the panic boundary, the interval and the health record
   for free. **Ten loops in this tree hand-rolled the gate instead, and their
   only shared property is that each had to remember.**
3. **Acquire leadership at the top of boot**, before any code that mutates shared
   work. This is a code move. Everything below is cheaper once it lands.
4. **Gate every destructive boot pass on having won**, and pass the winner's
   `instance_id` into it. `fn recover_x(pool, owner: &InstanceId)` will not
   compile at the wrong place in `setup()` — see *Prefer a type over a gate*.
5. **Stamp the owner at claim time.** `claimed_by_instance` + `claim_expires_at`
   already exist on `persona_executions` and `build_sessions`
   (`incremental.rs:3623, :3640`) and are written by one statement and read by
   none. Wire them, per
   [job-claim-and-lease](./job-claim-and-lease.md) D1 — the sweep in step 6 has
   nothing to scope to until you do.
6. **Write the sweep predicate with an owner term or an age term, never a bare
   status.** `AND (claimed_by_instance = ?me OR claim_expires_at < ?now)`, or
   `AND started_at < ?cutoff` where the cutoff is derived from the work's own
   budget (`automations.rs:550-563` is the derivation to copy). If neither is
   available, consult a live registry (`dev_mode.rs:493`) or **park instead of
   terminalising** (`persist.rs:263`).
7. **Fence the heartbeat.** Read the ownership record, compare it to your own
   identity, and only then write. On mismatch, drop ownership and `warn!`. Four
   lines; it is the whole of D1(b).
8. **Release on exit and write a shutdown marker in the same handler.** Then a
   boot that finds no marker knows the last stop was unclean — and can say so.
9. **Log the decline.** `info!("<loop>: not engine leader — skipping tick")`.
   Then a follower's silence is a sentence instead of an absence.
10. **And then stop.** Do not add a second lock, a mutex beside the gate, or a
    reaper for the reaper. If you lost the election, you idle; that is the
    complete correct behaviour.

## 5 Anti-patterns

- **A recovery pass that runs before the election.** *Failure:* the process
  destroys the incumbent's live work and only afterwards discovers it was not
  entitled to. **Measured: seven passes at `lib.rs:815, :821, :842, :854, :864,
  :909, :1375` against an election at `:1250`; 2 of 36 boots in six days were
  followers; 74 executions carry the resulting error message.**
- **An ownership check that reads process memory.** *Failure:* it answers a
  question about the past. **Executed: after a 91-second stall and a legitimate
  takeover, `is_leader()` still returns `true` and never stops.**
- **A heartbeat that writes without reading.** *Failure:* the strictly worse
  half — it does not merely fail to notice the takeover, it **undoes** it.
  `lock.rs:246` `fs::rename(&tmp_path, &self.path)`. The `pid` needed to prevent
  it is in the file and in the struct, and `lock.rs:87-88` says in prose it is
  not used.
- **A sweep predicate that is a status and nothing else.** *Failure:* it cannot
  express the only question that matters. **Measured: 6 of the 30 production
  `UPDATE`s that rewrite in-flight state carry no owner, no id and no age (§9).**
- **A doc comment asserting that the dead-owner case is impossible.**
  *Failure:* it is the reason nobody re-checks. `db/src/repos/lab/mod.rs:164` —
  *"No lab task survives a restart, so it is always safe to fail these at
  startup"* — is true of one process and false of two, and the app ships
  `PERSONAS_FOLLOWER` precisely to support two.
- **A gate that fails open.** *Failure:* the moment the state is unavailable,
  every process is a leader. **Measured twice: `leadership.rs:215`
  `.unwrap_or(true)` and `subscription.rs:1288` `.unwrap_or(true)`.** Both are
  deliberate and documented as backward-compatibility, and both bias toward
  *more* owners at exactly the wrong moment.
- **A bare `continue` on the ownership check.** *Failure:* a follower is
  indistinguishable from a dead app for its whole life. **Measured: all 10
  production leadership gates are silent** (`subscription.rs:1290`,
  `remote_commands.rs:184`, `sync/mod.rs:460`, `discord_poller.rs:80`,
  `slack_poller.rs:112`, `team_slack_relay.rs:525`, `webhook_notifier.rs:781`,
  `project_tracking/scheduler.rs:68`, `lib.rs:1388`, `lib.rs:1445`) — and the
  same defect at the same gate is [stall-watchdog](./stall-watchdog.md) D2.
- **An in-process double-start guard whose comment names the cross-process
  hazard.** *Failure:* the guard is real and covers the wrong axis.
  `background.rs:473-481` refuses a second `start_loops` *within one process*
  because it *"would double-fire every trigger/webhook and duplicate OAuth
  refresh"* — the exact consequence the split brain produces across two.
- **A policy whose "off" value is its default and whose only writer is the UI.**
  *Failure:* every restart disarms it until a human opens a panel.
  **Measured: 4 atomics in `commands/fleet/stale.rs` (`:128`, `:131`, `:151`,
  `:170-171`), zero durable keys, and the frontend comment at
  `fleetSlice.ts:222-224` admitting the gap.**
- **Re-dispatching persisted work at boot without owning it.**
  `lib.rs:909` `requeue_persisted_executions` re-admits **every** `queued` row
  and starts running them. A second instance re-runs the first's queue.

## 6 Evidence

**The one site to copy: `src/companion/dev_mode.rs:487-505`.** Read it as four
decisions:

1. **It asks whether the owner is alive** before rewriting anything —
   `registry().list_dto()` into a `HashSet`, then `if live.contains(...) {
   continue; }`. Nothing else in the tree does this.
2. **It says why, and names the incident**: a 5-second-old op was marked
   `interrupted` mid-run on 2026-07-04 because `companion_init` re-ran on a
   panel remount. The comment ends with the sentence this whole path exists to
   generalise: *"A session present in the fleet registry is not an orphan,
   whatever the ledger row says."*
3. **It tries to save the work before writing it off** (`recover_uncommitted_work`,
   `:453`) and re-enters the normal lifecycle when it succeeds, rather than
   inventing a recovery-only state.
4. **It runs once per process** behind a `OnceLock` (`commands/companion/mod.rs:230`)
   *and* keeps the liveness check anyway — belt and braces, because the author
   had already been burned by the once-ness not holding.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `src/engine/background.rs:128-142`, `:197-205`, `subscription.rs:1263-1274` | the **generation counter**: bumped on start AND stop, captured at spawn, compared against a fresh load every tick. The only complete ownership mechanism in the tree, and the only one of its kind in six repos |
| `src/daemon/lock.rs:50-57` | a staleness threshold **derived as three missed heartbeats**, with the reasoning written down |
| `src/engine/subscription.rs:93-100` | the gate as a **trait default**, so 39 loops inherit it and an exception must be declared |
| `db/src/repos/communication/events.rs:961-996` + `background.rs:1101` | a sweep that is CAS-guarded, verdict-returning, ceiling-bounded, **and requires two consecutive sightings** before acting |
| `src/commands/fleet/persist.rs:263-297` | recovery that **parks** instead of terminalising, with the ambiguity that motivates it stated |
| `src/companion/proactive/mod.rs:228-256` | three sweeps, each scoped by an explicit **age window**, in a table with no owner column |
| `src/engine/leadership.rs:78-101` | `PERSONAS_FOLLOWER=1` — a documented, tested way to run a second instance safely (`:257-273` asserts the lock file is never even written) |

### Convergence — 5 sibling repos, all opened

Swept read-only against `../personas-web` (1,614 tracked), `../brainiac` (771),
`../personas-cloud` (51 — read exhaustively), `../vibeman` (2,570),
`../ascent` (1,710). **All five exist and all five were opened**; nothing below
is reported by omission.

> **Lineage caveat that governs the table.** `personas-cloud`'s
> `eventProcessor.ts:30` and `triggerScheduler.ts:87` both say *"Ported from
> desktop engine/background.rs"*. It is **not an independent witness** for
> anything it inherited from this repo.

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **A process is elected to own the singleton loops** | **SILENCE 5/5 — and PERSONAS IS ALONE IN HAVING ONE** | No leader election, lock file, advisory lock or process-owner concept in any of the five. `brainiac` gates on an argv flag (`--with-worker`); `vibeman` uses `globalThis` which is per-process; `ascent` is serverless. **What four of them reinvented instead is a per-ROW claim** — `brainiac/crates/brainiac-store/src/queue.rs:135-166` (`FOR UPDATE SKIP LOCKED`), `ascent/src/lib/db/org-watch.ts:209-217`, `vibeman/.../scanQueue.core.repository.ts:97-101`, `personas-cloud/.../db.ts:719-757`. **The row lock is the election, per job.** That is why nobody noticed there is no owner for the loop |
| 2 | **The owner's claim is re-verified before it acts / the renewal is fenced** | **PHYSICS AS A DEFECT (5/5 including this repo) — the strongest result in the sweep** | Every repo fences the *acquire* and none fences the *release or renew*. `ascent/src/lib/db/webhook-deliveries.ts:57` deletes by the GitHub delivery id, not a claim token; `ascent/.../org-watch.ts:229-232` drops the lease predicate on settle **80 lines below `:311-314`, where the same author token-fences the in-memory sibling and documents *"the classic expired-lease self-release footgun"***; `vibeman/.../lifecycleOrchestrator.ts:417-421` has no owner term and **no column that could carry one** (`208_lifecycle_locks.ts:15-20`); `brainiac/.../sweeps.rs:355-359` is a blind write. Personas' instance of the clause is `daemon/lock.rs:230-248` — and it is the only one where the unfenced write is a *heartbeat*, which is why it produces two permanent leaders rather than one lost update |
| 3 | **Every background loop is gated on the ownership check** | **PHYSICS AS A DEFECT (4/4) — and Personas is far ahead** | Gated/total: `personas-web` **0/2**, `brainiac` **1/6**, `personas-cloud` **0/9**, `vibeman` **1/17**. Personas: **39/39 by trait default** plus 10 hand-rolled. Nobody else is close, and the reason is clause 1 |
| 4 | **Boot recovery is scoped to an owner, and ordered after the election** | **PHYSICS AS A DEFECT 3/5** | `personas-cloud/.../db.ts:1249-1265` `UPDATE persona_executions SET status='queued' WHERE status='running' AND started_at < ?` — no owner term, run at `index.ts:74` before every loop; `:786-790` the same for events, at boot **and every 60 s**. `vibeman/.../scanQueue.core.repository.ts:387-399` — `WHERE status='running'`, no age, no owner. **`vibeman/src/lib/claude-terminal/orphanReaper.ts:65-105` is the worst artefact in the corpus**: it calls `isProcessAlive(pid)` at `:84` and **alive is what triggers the `SIGTERM`** at `:86`, then `clearAllPids()` at `:97` NULLs every pid globally — and it fires on any import of the DB barrel (`schema.postinit.ts:10` ← `db/index.ts:83`). `brainiac` and `ascent` have **no boot recovery at all** and are correct by abstention |
| 5 | **"Restarted" is distinguishable from "started"** | **SILENCE 5/5 — total, and the cleanest absence in the corpus** | No `restart_count`, no unclean-shutdown flag, no clean-shutdown marker checked at boot, in **any** of the five. Two near-misses worth copying: `vibeman/.../session.repository.ts:200-210` **deletes** the row on clean finish, so a surviving `running`+`pid` row *is* the crash record (state-as-presence — elegant, but it cannot tell "process 1 restarted" from "process 2 also started", and both get killed); and `ascent/src/lib/db/client.ts:534-538` marks a seeded token stale-now rather than fresh, for *"a frozen instance thawing past the TTL"* — the only line in five repos acknowledging the process may have restarted into a stale world, and it is about tokens, not work |
| 6 | **Ownership is released on exit** | **MINORITY (drain, 2/5); SIGKILL unhandled 5/5** | `brainiac` and `personas-cloud` drain in-flight work on shutdown but hold nothing to release. `vibeman` registers three handlers that are **inert on Windows**. `ascent` releases nothing **by design** — its claim is a TTL, which is the correct serverless answer. `personas-web`: silence. Personas is the only repo with something to release and it does not (§0) |
| 7 | **A concurrency cap whose default 0 means "unlimited/off"** | **INVERTED — 3 siblings do the opposite, with written reasons** | `brainiac/crates/brainiac-pipeline/src/worker.rs:73` `.max(1)`, floored **again** at the use site `:171`, so `BRAINIAC_WORKER_CONCURRENCY=0` yields 1. `vibeman/src/lib/config/envConfig.ts:336` `Math.max(1, … ?? 1)`, with a sibling comment at `:349-350` saying the floor exists *"so a misconfiguration can't spin the timer"*. `personas-cloud/.../db.ts:243` `max_concurrent INTEGER NOT NULL DEFAULT 1`. Only `ascent` has a genuinely unlimited default and it is a **connection pool**, not a work cap (`client.ts:82-83`, hazard documented at `:71-75`). **Personas' `MAX_LIVE_SESSIONS = AtomicU64::new(0)` is a local habit and it is on the wrong side.** Do not codify "0 = off"; codify the floor |
| 8 | **A generation/epoch counter retires a stale loop after a restart-in-place** | **MINORITY 1/6 — and the one is Personas** | `personas-web` has a client-side sequence number; the four server-side siblings have nothing. `ascent` has an identity-fence variant for its in-memory claim only. `background.rs:142` + `subscription.rs:1266` is the only true implementation in the family, and its test (`background.rs:3687-3710`) asserts exactly the property. **Report as Personas being ahead**, not as doctrine |
| 9 | **Something durably records who owns the loops right now** | **SILENCE 5/5** | And the sharpest sentence in the sweep: **every repo has the pid and none records it as ownership.** `personas-web/src/app/api/stats/route.ts:224` uses it as a temp-filename disambiguator; `brainiac/crates/brainiac-gateway/src/resilience.rs:63` XORs it into **jitter entropy**; `vibeman/src/lib/remote/deviceRegistry.ts:38-56` builds a complete `device_id` + `hostname` + `last_heartbeat_at` registry **for remote peers only, never turned inward on its own loops.** Personas writes pid + hostname + heartbeat to `engine-leader.lock` and then declares in a comment that pid is not used for liveness |

**Physics — keep as doctrine:** clauses 2, 3-as-a-defect, 4-as-a-defect, 5 (as an
absence). **Reported as silence:** clauses 1, 5, 9. **Inverted:** clause 7 — and
it inverts a premise the brief supplied. **Personas is ahead:** clauses 1, 3, 8.

> **The strongest sibling result is clause 2, because it is unanimous and
> because one repo proves it knows better in the same file.** `ascent`'s
> `org-watch.ts` token-fences its in-memory release at `:311-314` with a comment
> naming *"the classic expired-lease self-release footgun"*, and 80 lines earlier
> settles the **durable** claim with an unconditional `update({where:{id}})`.
> Same author, same file, opposite discipline, and the durable one is the
> unguarded half. Personas' version of that asymmetry is an atomic `create_new`
> acquire (`lock.rs:213`) and a blind `fs::rename` renew (`:246`) in the same
> struct.

> **The counter-example that keeps this honest is `personas-cloud`, and it is
> negative twice.** It is a *port of this repo's engine*. This repo's best sweep
> (`events.rs:961-996`, CAS + two-consecutive-sighting) became a blind bulk
> `UPDATE … WHERE status='running'` in the port (`db.ts:786-790`), losing both
> guards. And its trigger scheduler deliberately splits read from write *"to keep
> the exclusive write lock window as short as possible"* (`triggerScheduler.ts:129-131`),
> reopening the TOCTOU the desktop version closed — the same finding
> [conditional-write](./conditional-write.md) recorded from the CAS side. **The
> guard that survives a port is the one a type enforces; the guard that reads
> like bookkeeping does not.**

> **The best split-brain resolution found anywhere is
> `personas-cloud/packages/orchestrator/src/workerPool.ts:249-267`**, and it is
> exactly the fix D1 needs. A second connection claiming an existing `workerId`
> triggers a **live re-read of the incumbent** (`readyState` + heartbeat
> freshness) and is rejected with close code 4409 if the incumbent is alive;
> replacement happens only when the incumbent is provably dead. Every subsequent
> message is re-fenced (`:222-229`, `:529-538`). **Note the asymmetry: the
> orchestrator fences the entities it manages and never fences itself.**

## 7 Deviations

Every entry is live on `master` @ `ec1bf0359`, measured against read-only copies
of the operator's databases, the app's own six-day log, or by replay.

### D1 — two processes can hold engine leadership permanently, and each keeps overwriting the other's lease

Three lines, in two files:

- `leadership.rs:157-162` `is_leader()` returns `self.lock.lock().map(|g| g.is_some())` — the in-memory `Option`, never the file.
- `lock.rs:230-248` `heartbeat()` serialises `self.contents` and `fs::rename`s it over the path. **No read, no owner comparison.**
- `lock.rs:184-198` `acquire_named` correctly evicts a stale lease — which is what creates the second leader in the first place.

**Replayed** (§0): A stalls 91 s past `STALE_THRESHOLD`, B legitimately takes
over, A's next heartbeat renames its own pid back over B's file, and from that
moment both return `is_leader() == true` forever. Five further heartbeat rounds
change nothing. Both then pass `subscription.rs:1284-1290` and double-run all 39
singleton loops.

The existing tests cover the clean handoff (`leadership.rs:236-247`: leader
`release()`s, follower `tick()`s, follower wins) and never the
takeover-while-alive path — which is why it survived.

Two aggravations: both gates **fail open** (`leadership.rs:215`
`.unwrap_or(true)` and `subscription.rs:1288` `.unwrap_or(true)`), biasing toward
more owners; and `lib.rs:1246-1248` still says loop gating *"lands in a later
phase — for now this only establishes + advertises leadership"*, which has been
false since the gate landed at `subscription.rs:1284`.

**Fix (three parts, all small):** (a) `heartbeat()` re-reads the file and
compares `pid` + `hostname` before writing; on mismatch it drops the lock and
`warn!`s — replayed above, it yields exactly one leader and the loser learns.
(b) `is_leader()` becomes lease-aware: either re-read on a cadence, or have
`tick()`'s fenced heartbeat be the thing that can clear the `Option` (a is
sufficient for this). (c) add the takeover-while-alive test.

### D2 — seven boot passes rewrite in-flight work with no owner scope, and six of them run before the election

| # | pass | statement / predicate | `lib.rs` line | before the election? |
| --- | --- | --- | ---: | --- |
| 1 | `ExecutionEngine::recover_stale_executions` (`engine/mod.rs:703`) | `get_running_only` = `SELECT * … WHERE status = 'running'`, then `update_status` per row (`WHERE id = ?12`) | **815** | **yes, by 435 lines** |
| 2 | `n8n_sessions::recover_interrupted_sessions` (`:167`) | `UPDATE n8n_transform_sessions SET status = ?1 … WHERE status IN (?3, ?4, ?5)` | 821 | yes |
| 3 | `teams::recover_interrupted_pipeline_runs` (`:724`) | `WHERE status IN ('running', 'awaiting_approval')` | 842 | yes |
| 4 | `lab::recover_interrupted_lab_runs` (`:167`) | ×4 tables, `WHERE status NOT IN ('completed','failed','cancelled')` | 854 | yes |
| 5 | `approvals::recover_interrupted_approvals` (`:390`) | `UPDATE companion_approval SET status = ?1 WHERE status = ?2` | 864 | yes |
| 6 | `engine.requeue_persisted_executions` (`engine/mod.rs:745`) | `get_queued_only` = `WHERE status = 'queued'` — then **runs them** | 909 | yes |
| 7 | `persona_jobs::recover_orphans` (`:257`) | `WHERE status = 'running'` | **1375** | no — but **outside** the `is_leader()` gate 13 lines below |
| 8 | `companion::jobs::recover_orphans` (`:170`) | `WHERE status = 'running'` | `commands/companion/mod.rs:192` | n/a — invoked from `companion_init`, a frontend-callable command |
| 9 | `team_assignment_orchestrator::recover_orphaned_assignments` (`:454`) | `list_active()` then re-queue + re-spawn | `background.rs:483`, inside `start_loops` | `start_loops` itself is not leader-gated |
| 10 | `dev_mode::recover_interrupted_dev_ops` (`:487`) | **liveness-checked against the fleet registry** | `commands/companion/mod.rs:233` | **the exemplar — the only one** |

`#6` is the sharpest: it does not merely mislabel the incumbent's work, it
**re-executes** it. `#8` is worse than a boot pass — `companion_init` is a Tauri
command the frontend calls on panel mount, so it can fire while this same process
is running a job.

Live: **74 executions** carry `'App restarted while execution was running'`
across **33** distinct boot minutes (§0). **0 of 2,188** executions ever carried
`claimed_by_instance`, so there is currently nothing for any of these to scope
themselves to — which is why this D and
[job-claim-and-lease](./job-claim-and-lease.md) D1 are one commit.

**Fix:** move 1–6 below `:1250` and gate them on `became_leader`; add an
`owner`/age term to each predicate (§9's rule counts exactly the ones that lack
one); and switch `recover_stale_executions` from `update_status` to
`update_status_if_running` (`executions.rs:953`), which is nineteen lines away
and already returns the verdict.

### D3 — nothing releases leadership, so every boot in six days evicted a stale lease

`EngineLeadership::release()` (`leadership.rs:194-200`) has **zero production
call sites**. The app's only `RunEvent::Exit` handler (`lib.rs:3755-3762`) stops
Bun servers. Measured over six days: **36 starts, 36 `removing stale daemon lock
file`, 0 releases.**

The user-visible cost is a **90-second blind spot on every relaunch**: a restart
inside `STALE_THRESHOLD` of the previous exit makes the new process a follower
(`lock.rs:194` `AlreadyHeld`), and its `tick()` retries only every 30 s
(`HEARTBEAT_INTERVAL`), so up to ~120 s during which all 39 singleton loops
silently `continue`. **The log shows this happened twice** (`leader=false` ×2).

**Fix:** call `state.leadership.release()` in the `RunEvent::Exit` arm, and write
the shutdown marker (D4) in the same handler.

### D4 — "restart" has no representation anywhere in 963 files

No `restart_count`, no `unclean_shutdown`, no clean-shutdown marker written on
exit and read on boot. Seven functions *infer* a restart from a status predicate
and one writes that inference into user-visible error text. `lock.rs:151-152`
comes closest — *"An unclean crash leaves the file behind; the next daemon start
detects it as stale via heartbeat age"* — but the detection is used to evict the
file, never recorded, and `lock.rs:186-191`'s `info!` is the only trace it
happened.

**Fix:** in the `RunEvent::Exit` handler, write `{clean: true, at, instance_id}`
beside the lock; at boot, read it, log `startup: previous shutdown was
clean|UNCLEAN`, and delete it. Two writes and one read, and it is the
precondition for ever making D2's sweeps conditional.

### D5 — all ten leadership gates decline in silence

`subscription.rs:1284-1290` is a bare `continue`. The nine hand-rolled ones
(`remote_commands.rs:184`, `sync/mod.rs:460`, `discord_poller.rs:80`,
`slack_poller.rs:112`, `team_slack_relay.rs:525`, `webhook_notifier.rs:781`,
`project_tracking/scheduler.rs:68`, `lib.rs:1388`, `lib.rs:1445`) are bare
`if`/`continue`. Not one emits a log line, a metric, or a health item.

So a follower instance — which the log proves happens — is, from every
instrument this app owns, identical to an app whose engine is dead. This is
[stall-watchdog](./stall-watchdog.md) D2 at a different gate; ten sibling loops
in `subscription.rs` already log their *quota* early-return
(`:1607, :1820, :2165, …`) and the line to copy verbatim is `:1607`.

**Fix:** `tracing::info!(subscription = name, "not engine leader — skipping tick")`
at `subscription.rs:1290`, rate-limited to once per state change, and a
`HealthCheckStatus::Info` item naming the current leader's pid and host.

### D6 — four fleet safety policies reset to "off" on every restart

`commands/fleet/stale.rs`: `AUTO_HIBERNATE_ENABLED` (`:128`, `false`),
`AUTO_HIBERNATE_AFTER_SECS` (`:131`), `MAX_LIVE_SESSIONS` (`:151`, `0` =
unlimited, `:145-147`), `STALE_OVERRIDE_SECS` / `STALLED_OVERRIDE_SECS`
(`:170-171`, `0` = built-in default). All four are process-global atomics whose
only writers are Tauri commands (`commands/fleet/commands.rs:243, :254, :265`).

**No boot restore exists.** `app_settings` holds **zero** keys matching `%live%`,
`%slot%`, `%hibernate%`, `%cutoff%` or `%stale%`. The durable copy lives in the
frontend Zustand slice and is pushed only from `fleetRefresh`
(`fleetSlice.ts:226-228`), whose own comment admits the gap. Downstream,
`overnight.rs:401` sizes an unattended dispatch wave from `live_slot_cap()` and
`:143` maps `0` onto `FALLBACK_NIGHT_LIVE_CAP`.

Per §6 clause 7 this is **not** how the family does it: three siblings floor the
equivalent at 1 and two write down why.

**Fix:** persist the four values in `app_settings` when the command sets them,
read them in `setup()`, and floor the cap at 1 so `0` cannot mean "unlimited".

### D7 — `start_loops` guards the in-process double-start and names the cross-process hazard it does not guard

`background.rs:466-481`: `try_begin_start()` refuses a second concurrent start
and logs *"would double-fire every trigger/webhook and duplicate OAuth
refresh"*. That is precisely the consequence of D1, one axis over. The
in-process guard is a CAS on an `AtomicU64` generation; the cross-process guard
is a cached `bool`.

Also: `start_loops` is not itself leader-gated — only the individual
subscriptions are — so a follower still runs `recover_orphaned_assignments`
(`:483`) and `reconcile_signal_feeds` (`:499`) on every boot.

### Structural — where the ownership machinery is

Of **244 tables** in `personas.db`, **three columns** in the whole schema could
identify a process owner: `persona_executions.claimed_by_instance`,
`build_sessions.claimed_by_instance`, `build_sessions.cli_pid`. The first two are
written by one statement and read by none; live coverage is **0 of 2,188** and
**0 of 12**. `personas_data.db` (71 tables) has **none**. The only durable
ownership record in the product is a **JSON file**, `engine-leader.lock`, and its
`pid` field is documented as not used for liveness.

## 8 Gaps — what the primitives genuinely cannot do

1. **`is_leader()` cannot be made correct without a lease read, and the read is
   not free.** A file `stat` + parse on every tick of every loop is 39 reads per
   interval. The right shape is the one `personas-cloud/workerPool.ts:249-267`
   uses — verify on *contention* and on *renewal*, cache between — but that needs
   a version/epoch in the lock file, which is a format change.
2. **A sweep cannot be scoped to an owner that is never written.** Every fix in
   D2 depends on `claimed_by_instance` actually being stamped, which is
   [job-claim-and-lease](./job-claim-and-lease.md) D1, which has 0 production
   callers. **The ordering fix (§2a) is the only half of D2 that can land
   independently**, which is why it is step 3.
3. **A lock file cannot coordinate across hosts.** `lock.rs:36-38` states it: a
   data dir on OneDrive/iCloud produces false positives. `hostname` is recorded
   and never compared. This is a real limit, not laziness, and it is the reason
   the fence in D1 must compare `hostname` as well as `pid`.
4. **`PERSONAS_FOLLOWER` cannot protect the boot sweeps.** It makes
   `try_acquire()` return false (`leadership.rs:124`), which gates the loops —
   and the seven passes in D2 do not consult leadership at all. **The one lever
   the repo built for running a second instance safely does not cover the
   destructive half of startup.**
5. **The census can ratchet a presence and cannot assert an absence, and half
   this leaf is absences.** "Nothing releases the lease", "no marker
   distinguishes restart from start", "no boot restore exists for these four
   atomics", "`is_leader()` never re-reads the file" are four of this document's
   largest findings and **not one is expressible as a count of something
   present.** They were found by reading a log, copying a database, and replaying
   a protocol. §9 targets the one member of the family that *is* a presence.
6. **No test in the tree exercises two live instances.** `leadership.rs`'s five
   tests all construct two `EngineLeadership` objects in one process and drive
   them by hand; the one that matters — takeover while the incumbent is still
   alive and will heartbeat again — is absent, which is exactly the case D1
   describes. `src-tauri/tests/` contains zero matches for `follower`,
   `split-brain`, or `second instance`.
7. **A gate that fails open cannot be made to fail closed without a behaviour
   change.** `unwrap_or(true)` at `leadership.rs:215` and `subscription.rs:1288`
   exists so unit tests and very-early startup behave like a lone instance.
   Flipping it to `false` would silently disable every loop in any context where
   `AppState` is not yet managed. The honest fix is a third state
   (`Unknown`) that logs, not a flipped boolean.

## Prefer a type over a gate

**Make ownership a value the caller must hold, not a boolean it may consult:
`fn recover_stale_executions(pool: &DbPool, owner: &LeaderToken)`.**

Today `is_leader() -> bool` (`leadership.rs:157`) is a value with no provenance,
no expiry, and no relationship to the work it authorises — and the seven passes
in D2 do not even ask for it.

```rust
/// Proof that THIS process held engine leadership at `verified_at`, and the
/// identity every owner-scoped statement must be written against.
/// Constructible ONLY by `EngineLeadership::claim()`, which performs a FENCED
/// read of `engine-leader.lock`. No public fields, no `Default`, no `new`.
#[must_use = "hold the token across the work it authorises, or you are acting unowned"]
pub struct LeaderToken<'a> {
    instance_id: &'a str,
    verified_at: Instant,
}

impl EngineLeadership {
    /// The ONLY door. Re-reads the lock file, compares pid + hostname, and
    /// returns None if this process is not (or is no longer) the leader.
    pub fn claim(&self) -> Option<LeaderToken<'_>>;
}

// and the sweeps take it:
pub fn recover_stale_executions(pool: &DbPool, owner: &LeaderToken<'_>);
```

Held against all seven qualifications:

1. **A required prop carries only what it actually encodes.** ✔ `LeaderToken`
   encodes "a fenced read said this process owned the lease at `verified_at`" and
   nothing else. It deliberately does **not** encode "the previous owner is
   dead" — that is a different fact, and folding it in would repeat the
   `successRateSource` failure. §2(e) stays a separate predicate.
2. **Requiredness is orthogonal to closedness — and here requiredness is the
   whole win.** Today `bool` is not "unauthorised"; it is a definite answer the
   language hands you for free at every call site that does not ask. Adding the
   parameter withdraws the free answer: `recover_stale_executions(&pool)` at
   `lib.rs:815` **stops compiling**, and the only place a `LeaderToken` exists is
   after `:1250`. **The ordering defect becomes a compile error.** That is the
   discriminating property of this proposal and the reason it is worth more than
   the gate.
3. **A type nobody constructs constrains nothing.** ✔ and this is where the
   design is decided. The corpus has catalogued four inert primitives —
   `claim_for_instance` (0 production callers, 0 of 2,188 rows),
   `ExecutionState::TERMINAL` (0 production references), `ProcessSession` (0
   implementors), `vibeman`'s Status Algebra (0 value-imports). A `LeaderToken`
   that merely *exists* beside `recover_stale_executions(&pool)` lands in the
   same graveyard. **So it cannot be additive: the migration must change the
   seven signatures**, at which point `rustc` visits every call site and there
   are exactly seven.
4. **A type anyone can construct authenticates nothing.** ✔ private fields, no
   `new`, no `Default`, and `claim()` is the only constructor. The
   counter-example is measured in this family: `brainiac`'s `queue::Job`
   (`queue.rs:36-42`) is the obvious token shape and **all four fields are `pub`
   on a `#[derive(Clone)]` struct**, so a caller can fabricate one.
5. **Withholding beats requiring.** ✔ read correctly. The naive reading is that
   this clause is *requiring* a parameter and therefore weak. What is actually
   withheld is **the ability to run a destructive sweep without having asked**.
   The weak alternative — adding `instance_id: &str` to the sweeps — would be
   supplied happily and wrongly, because a caller at `lib.rs:815` would just pass
   `state_arc.leadership.instance_id()`, which is true and useless: it names this
   process without asserting this process won.
6. **Withhold the dangerous freedom, not the answer.** ✔ The dangerous freedom is
   **mutating shared work without having proved ownership**. The answer — "I am
   not the leader, so skip" — stays fully expressible: `claim()` returns
   `Option`, and `None` is the whole verdict. Nothing a follower legitimately
   needs is taken away.
7. **Withholding a requirement only helps when the requirement was forcing the
   bad value.** ✔ and it rules out the alternative I reached for first. Nothing
   *forces* `get_running_only` to omit an owner term — it omits it because the
   column is never populated. **Relaxing or widening any existing signature is
   inert here**; and adding `claimed_by_instance` to the predicate *alone* is
   inert too, because at the one moment the sweep could scope itself, no owner
   was ever stamped. The construction that must be withheld is the *unowned
   call*, and that lives in the parameter list.

**Does the type reach the code?** *For the ordering defect, completely. For the
split brain, not at all — and naming that boundary is the useful part.*

**Reaches:** all seven passes in D2 are ordinary Rust functions taking `&DbPool`;
adding `&LeaderToken` is a compile error at every one, and `lib.rs:815`'s only
legal repair is to move below `:1250`. It also reaches the ten hand-rolled loop
gates, which become `let Some(owner) = leadership.claim() else { continue };` —
and, because the token is a value the tick can carry, the `Skipped { why }` arm
[stall-watchdog](./stall-watchdog.md) proposes gets a real reason to report.

**Does not reach, and cannot:**
(a) **The predicate text.** `AND claimed_by_instance = ?` is a word in a SQL
string. `LeaderToken` can *supply* the value; nothing checks the `WHERE` uses it.
That is what §9 counts, and it is why the type and the ratchet are both needed.
(b) **The split brain itself.** `claim()` being the only door is what makes a
fenced read *possible*; it does not make the read *correct*. D1's fix is four
lines inside `heartbeat()` comparing `pid` + `hostname`, and no Rust type sits at
that boundary — the identity being compared lives in a JSON file, which is the
doctrine's "types cannot reach through a `OnceLock` or an ambient file" case in a
third form.
(c) **The absence of a release.** No type can require that `RunEvent::Exit`
calls `release()`. `#[must_use]` fires when a token is dropped unused in one
scope; it says nothing about a process that stops existing.

**Fix order:** (1) D1's fenced heartbeat — four lines, and the app currently
ships a reproducible split brain; (2) §2(a), move the six sweeps below the
election — a code move, no schema; (3) `LeaderToken` on the seven signatures,
which makes (2) permanent; (4) D3 + D4, release and shutdown marker, one handler;
(5) D5's log line; (6) D6's four settings keys; (7) stamp
`claimed_by_instance` ([job-claim-and-lease](./job-claim-and-lease.md) D1) and
then add the owner terms §9 counts; (8) delete §9's rule when it reaches zero.

## 9 The missing gate

**The condition, stated stack-free:** *a recovery pass rewrites the state of
in-flight work selecting the rows by their in-flight state alone — so it cannot
distinguish work abandoned by a dead owner from work a live owner is still
doing, and it will destroy the second while believing it is cleaning up the
first.*

An adopting repo must derive its own proxy. This one keys on a rusqlite SQL
string literal whose `WHERE` is exactly a status predicate and then ends. A repo
on Prisma spells the identical condition
`prisma.job.updateMany({ where: { status: 'running' }, data: { status: 'failed' }})`,
and a repo on raw `pg` as a template literal — **and this pattern scores a
structural zero in all five siblings while the condition is present in at least
three** (`personas-cloud/.../db.ts:1249-1265` and `:786-790`,
`vibeman/.../scanQueue.core.repository.ts:387-399`, §6 clause 4).

**Where it runs:** `npm run census:check`, invoked by the **`golden-path-census`
pre-push job** (`lefthook.yml:74-75`) and by `npm run check`
(`package.json:52`). Explicitly **not** CI-only: `ci.yml` runs its Rust suite but
is red on 10 pre-existing failures, so a gate that runs only there runs nowhere.

**Fail-loud**, inherited from the runner: a walk below `floor: 900` (the tree is
963 `.rs` files), a rule matching zero files, a stale `exclude`, a rise, or a
**silent drop** all exit non-zero.

### Existing rules checked first, by reading each definition rather than its title

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| `unfenced-work-outcome-write` (`job-claim-and-lease.md`, 6/11) | **the nearest neighbour.** An outcome-recording `UPDATE` whose `WHERE` is `id = ?N` and terminates there | **The exact complement, disjoint by construction.** It requires the predicate to be a row identity; this requires there is no identity at all. Its subject is *"was this row still mine"*; mine is *"was this row anybody's"*. **Verified: 0 shared match positions.** |
| `partial-terminal-status-set` (`terminal-state-and-recovery.md`, 6/14) | a `status IN (…)` membership over **terminal** statuses, in a **read** predicate | Opposite vocabulary (terminal vs in-flight) and opposite side (read vs write). Note `lab/mod.rs:179`'s `status NOT IN ('completed','failed','cancelled')` looks like a collision and is not — `\bstatus\s+IN` cannot match across the `NOT`. **Verified: 0 shared positions.** |
| `blind-identity-write` (`repository-crud-surface.md`, 35/82) | a repo fn returning `Result<()>` reaching a write whose `WHERE` is `id = ?N` | Identity-scoped writes, and scoped to `src-tauri/db/src/repos`; 3 of my 6 matches are outside that root. 0 shared positions. |
| `discarded-guard-verdict` (`conditional-write.md`, 7/11) | a guarded single-row `UPDATE` whose count is thrown away | Requires `id = ?N` **plus** a second predicate. Mine requires no id. 0 shared positions. |
| `retention-delete-by-status-allowlist` (`retention-and-pruning.md`, 3/3) | a `DELETE … WHERE status IN (…)` with a timestamp bound | `DELETE`, not `UPDATE`; retention, not recovery. Deliberately kept out of my anchor for this reason. 0 shared positions. |
| `unverifiable-conflict-clause` (40/71) · `unraced-loop-wait` (12/13) · `outcomeless-tick` (8/45) · `caller-asserted-owner` (11/16) · `silent-row-skip` (64/148) · `privately-reclassified-failure` (14/28) | insert conflicts · loop waits · tick return types · an entity-owner `if` in Rust · row iterators · reclassified errors | None keys on the `WHERE` clause of a state-rewriting write. `caller-asserted-owner` is the closest by *name* and is about a **user/tenant** id compared in Rust, not a process owner in SQL. 0 shared positions each. |

**None of the 122 existing rules keys on a state-rewrite whose predicate is a
status alone. Proposing one.** Verified mechanically: **453 match sites across
the eleven rules above, 0 collisions** with either this rule or its control.

### Measurement — an exact partition after two diagnosed disagreements

Two independent implementations: a string/comment-aware **Rust lexer** (literals
extracted by lexing, not grepping; `#[cfg(test)]` removed as **brace-matched
ranges**; `*_tests.rs` excluded by filename) and the **census engine** from the
published pattern.

| implementation | violating | compliant | population |
| --- | ---: | ---: | ---: |
| Rust lexer (first run) | 6 | 15 | 21 |
| census engine (first run) | **7** | 25 | — |
| **both, after reconciliation** | **7** raw / **6** after the exclude | **23** | **30** |

**They disagreed twice, and both times the census was right — which is the
finding.**

1. **The lexer missed `approval_lifecycle.rs:393`** (`UPDATE companion_approval
   SET status = ?1 WHERE status = ?2`), because its `WHERE` vocabulary required a
   quoted in-flight literal and this site binds both statuses as parameters from
   Rust constants. **The doctrine predicts exactly this — "a vocabulary-based
   signal's recall is bounded by its author's word list, and the misses cluster
   on the unusual cases" — and the missed site is the unusual one:** the only
   recovery pass in the tree that resets to `pending` instead of terminalising.
2. **The lexer called `proactive/mod.rs:250` unscoped** when it is age-scoped:
   `AND datetime(COALESCE(delivered_at, created_at)) < datetime('now', ?1)`. Its
   further-term detector looks for `column <op>` and **cannot see a column nested
   inside a SQL function call**. The census control, which only requires a second
   `AND` term, classified it correctly.
3. A third difference was a lexer **false positive**: `sla.rs:637` is an
   `INSERT … SELECT … ON CONFLICT DO UPDATE SET`, and the lexer's `UPDATE … SET`
   substring test has no table-name requirement. The census pattern requires
   `UPDATE <table> SET` and excludes it.

After reconciling both word lists (`dead_letter`, `delivered`, `proposed` added
to each), **widening the vocabulary added zero violating matches** — the gate
stayed at 7 raw across the same 7 files — while the control grew from 23 to 27
and then back to 23 once it too was narrowed to in-flight predicates. That
stability under vocabulary widening is the strongest single evidence the anchor
is discriminating on the `WHERE` shape and not on the word list.

**Partition: 7 + 23 = 30 = every production `UPDATE` in 963 `.rs` files that
rewrites the state of in-flight work.** The lexer independently finds 31 of the
same shape; the one extra is `sla.rs:637`, hand-verified as the lexer's bug. No
unexamined third population.

**Precision 7/7 — every match opened and read.** Six are the boot-recovery passes
of D2 (`lab/mod.rs:179`, `n8n_sessions.rs:193`, `teams.rs:729`,
`approval_lifecycle.rs:393`, `companion/jobs/mod.rs:174`, `persona_jobs.rs:261`).
The seventh, `migrations/incremental.rs:4504`, is **excluded by path with a
reason**: it is a schema-migration data correction against a status value
(`'pending'`) that was never part of the `dev_tasks` vocabulary, so it cannot
match work any live process owns — and, unlike the six, there is no owner it
could ever be scoped to, so leaving it in would pin this ratchet permanently
above zero and break the rule's end-of-life.

**Fault injection: 16 cases, 16 correct** — the bare status sweep → V · the same
+ `AND claimed_by_instance = ?` → C · + `AND started_at < ?` → C · +
`WHERE id = ?1 AND status = 'running'` → C · `NOT IN (terminal)` → V ·
`IN (?3, ?4, ?5)` → V · both statuses as params → V · a multi-line literal → V ·
a multi-statement migration batch ending in `;` → V · a `SELECT … WHERE
status='running'` → neither · a `DELETE … WHERE status IN (…)` → neither ·
`SET status='completed' WHERE status='running'` (a settle, not a reset) →
neither · `SET status='succeeded' WHERE status='running'` → neither ·
`WHERE status = other_status` → neither · `WHERE project_id = ?1` → neither ·
the same SQL inside a `//` comment → neither.

**Backtracking:** every fill is `(?:[^"\\]|\\[\s\S])*?` — a lazy alternation
bounded by one Rust string literal whose two branches are mutually exclusive
(`[^"\\]` cannot match a backslash), plus one bounded negated class inside the
`IN(...)` arm. No nested quantifier. Full 963-file run of rule + control: **0.37 s**,
measured three times (0.378 / 0.383 / 0.374).

**Validated standalone** in a composer-private registry
(`registry-loop-ownership-composer.json` — a filename unique to this composer,
because sibling composers share the scratchpad), then **re-extracted from this
finished document and re-run: `files 6 / matches 6` and `files 17 / matches 23`,
identical both times.**

### The rule

```json
{
  "rules": [
    {
      "id": "unowned-inflight-state-sweep",
      "goldenPath": "docs/concepts/golden-paths/loop-ownership-and-restart.md",
      "title": "A recovery pass rewrites the state of in-flight work selecting rows by their in-flight status alone, so it cannot tell work abandoned by a dead owner from work a live owner is still doing.",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "UPDATE\\s+(?:[A-Za-z_]\\w*|\\{[A-Za-z_]\\w*\\})\\s+SET\\s+(?:[^\\\"\\\\]|\\\\[\\s\\S])*?\\b(?:status|state|phase)\\s*=\\s*(?:'(?:failed|interrupted|pending|queued|cancelled|canceled|stale|abandoned|expired|incomplete|timeout|error|dead_letter)'|\\?\\d+)(?:[^\\\"\\\\]|\\\\[\\s\\S])*?\\bWHERE\\s+(?:status|state|phase)\\s*(?:=\\s*(?:'(?:running|queued|pending|processing|dispatched|in_progress|transforming|analyzing|matching|active|claimed|spawning|streaming|delivered|proposed)'|\\?\\d+)|(?:NOT\\s+)?IN\\s*\\((?:[^)\\\"\\\\]|\\\\[\\s\\S])*\\))\\s*;?\\s*\\\"",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "An UPDATE that REWRITES THE STATE OF IN-FLIGHT WORK - a reset/terminal status in the SET list - whose entire WHERE clause is an in-flight status predicate and nothing else (the match must terminate at the literal's closing quote immediately after the predicate, so any further AND term fails it). PROXY FOR the stack-free condition: a recovery pass rewrites the state of work it did not do, selecting the rows by their in-flight state alone, so it cannot distinguish work abandoned by a dead owner from work a live owner is still doing. THE SHAPE IS NOT AN ACCIDENT: a reset status written against rows chosen only by their in-flight state is a process asserting that whoever owned that work is gone - and this app explicitly supports two processes on one database (src-tauri/src/engine/leadership.rs:6-19, plus a PERSONAS_FOLLOWER=1 lever at :78-85 built for exactly that). MEASURED BY EXECUTION, not argued (2026-08-16 @ ec1bf0359). (1) The engine-leadership protocol was replayed with the statements transcribed verbatim from daemon/lock.rs:175-248 and leadership.rs:123-191: instance A acquires; A stalls 91s past the 90s STALE_THRESHOLD; B legitimately evicts the stale lease and becomes leader; A's next heartbeat() fs::renames its own pid back over B's file WITHOUT reading it (lock.rs:246), and from that moment is_leader() returns true in BOTH processes permanently, because leadership.rs:157 reads an in-memory Option and never the file. Adding a four-line read-compare-write fence to heartbeat() yields exactly one leader and the loser learns it lost. (2) The boot sweep was replayed against real SQLite (node:sqlite): get_running_only (db/src/repos/execution/executions.rs:1357, `SELECT * FROM persona_executions WHERE status = 'running'`) sees a LIVE run of another instance, recover_stale_executions (src/engine/mod.rs:703-731) stamps it 'failed' via update_status - whose WHERE is `id = ?12` and nothing else - and when the real owner finishes, the row ends up reading status='completed' WITH the error message 'App restarted while execution was running'. Adding `AND claimed_by_instance = ?me` to the sweep makes it touch 0 rows and the live run survives. (3) THE ORDERING IS THE DEFECT AND IT IS 435 LINES WIDE: recover_stale_executions runs at src-tauri/src/lib.rs:815 and engine leadership is acquired at lib.rs:1250. Six destructive sweeps and one re-dispatch (:815 :821 :842 :854 :864 :909) run BEFORE the election; a seventh (:1375) runs after it and outside it, 13 lines above the is_leader() gate at :1388. (4) LIVE EVIDENCE from six days of the app's own rolling tracing log: 36 process starts, 34 acquired leadership and 2 did NOT (leader=false), 36 `removing stale daemon lock file` lines, and ZERO `engine leadership released` lines - EngineLeadership::release() (leadership.rs:194) has no production call site. So two instances demonstrably ran on this machine this week, and each follower still executed all seven unscoped sweeps. (5) From a read-only copy of the operator's 347MB personas.db: 74 persona_executions rows carry error_message 'App restarted while execution was running' - 31% of ALL 238 failed rows and the second-largest failure cause in the database - spread over 33 distinct boot minutes; and 0 of 2,188 executions ever carried claimed_by_instance, so there is currently nothing for any sweep to scope itself to. MEASURED COUNTS: 7 raw matches across 7 of 963 .rs files, ALL SEVEN OPENED AND READ (precision 7/7), commentMatchesSkipped 0; 6 after the exclude below. THE SIX: db/src/repos/lab/mod.rs:179 (4 lab_* tables, `WHERE status NOT IN ('completed','failed','cancelled')`, whose doc comment at :164 asserts `No lab task survives a restart, so it is always safe to fail these at startup` - true of one process, false of two); db/src/repos/resources/n8n_sessions.rs:193; db/src/repos/resources/teams.rs:729; src/commands/companion/approvals/approval_lifecycle.rs:393 (the only one that resets to pending rather than terminalising); src/companion/jobs/mod.rs:174 and src/engine/persona_jobs.rs:261 (character-for-character twins, both appending the literal string ' [orphaned by process restart]' to the user-visible error). THE EXEMPLAR IS IN THIS TREE AND IT IS 1 OF 10: src/companion/dev_mode.rs:493-505 consults the live fleet registry before writing any dev op off, with the production incident that motivated it in the comment - 'live-caught defect 2026-07-04: companion_init can re-run while a dispatched session is STILL WORKING ... A session present in the fleet registry is not an orphan, whatever the ledger row says.' TWO INDEPENDENT IMPLEMENTATIONS, AND THEY DISAGREED TWICE, WHICH WAS THE FINDING: a string/comment-aware Rust lexer (literals extracted by lexing, #[cfg(test)] removed as BRACE-MATCHED RANGES, *_tests.rs by filename) first returned 6 to this pattern's 7 - it missed approval_lifecycle.rs:393 because its WHERE vocabulary required a quoted in-flight literal while that site binds both statuses as ?N parameters from Rust constants, landing on the unusual member exactly as the doctrine predicts; and it misclassified proactive/mod.rs:250 as unscoped because its further-term detector cannot see a column nested inside COALESCE(...). A third difference was a lexer false positive (sla.rs:637 is an INSERT..ON CONFLICT DO UPDATE SET, and this pattern's required table name excludes it). After reconciling both word lists, WIDENING THE VOCABULARY ADDED ZERO VIOLATING MATCHES - the gate stayed at 7 across the same 7 files - which is the strongest evidence the anchor discriminates on the WHERE shape and not on the status word list. PARTITION: 7 + 23 (the positive control) = 30 = every production UPDATE in 963 .rs files that rewrites the state of in-flight work, so there is no unexamined third population. FAULT-INJECTED 16 WAYS, all correct, including both-statuses-as-parameters, NOT IN, a format!'d table name, a multi-line literal, a migration batch ending in ';', a SELECT by status, a DELETE by status, a settle to a SUCCESS terminal, and the same SQL inside a // comment. BACKTRACKING: every fill is (?:[^\"\\\\]|\\\\[\\s\\S])*? - a lazy alternation bounded by one Rust string literal whose branches are mutually exclusive - plus one bounded negated class in the IN(...) arm; no nested quantifier; full 963-file run of rule + control 0.37s, measured three times (0.378/0.383/0.374). ZERO MATCH-POSITION OVERLAP with the eleven nearest existing rules, verified by re-running all eleven and comparing 453 sites: unfenced-work-outcome-write is the exact COMPLEMENT (it requires the WHERE to be a row identity and terminate; this requires there is no identity at all), partial-terminal-status-set is the opposite vocabulary on the opposite side (terminal statuses in a READ predicate - note lab/mod.rs:179's `status NOT IN ('completed','failed','cancelled')` looks like a collision and is not, because \\bstatus\\s+IN cannot match across the NOT), retention-delete-by-status-allowlist is DELETE not UPDATE, and caller-asserted-owner is the closest by name but concerns a user/tenant id compared in Rust rather than a process owner in SQL. LEGAL FIX, one clause each: add an owner term - `AND claimed_by_instance = ?me` once execution claims are actually stamped (docs/concepts/golden-paths/job-claim-and-lease.md D1) - or an age term derived from the work's own budget (db/src/repos/resources/automations.rs:550-563 is the derivation to copy), or consult a liveness registry the way dev_mode.rs:493 does, or PARK instead of terminalising the way commands/fleet/persist.rs:263 does. src/companion/proactive/mod.rs:228,:241,:250 are the compliant sweep shape in a table with no owner column: three expiries, each scoped by an explicit age window. Do NOT silence a match by moving the SQL into a const &str, by splitting the literal in two, by appending a tautological `AND 1=1`, or by moving the status filter into a preceding SELECT and updating by id - the last one preserves the defect exactly and is what recover_stale_executions already does. PRECONDITION (must be re-derived per repo): this repo executes SQL through rusqlite with statements as string literals and binds parameters as ?N. A repo on Prisma spells the identical condition prisma.job.updateMany({where:{status:'running'},data:{status:'failed'}}), and this SQL pattern scores a STRUCTURAL ZERO in all five sibling repos while the condition is present in at least three: personas-cloud/packages/orchestrator/src/db.ts:1249-1265 and :786-790 (both `WHERE status='running'` with no owner term, the first run at index.ts:74 before every loop), and vibeman/src/app/db/repositories/scanQueue.core.repository.ts:387-399. END OF LIFE: this rule is designed to reach zero - all six are one-clause fixes. When it does the runner fails structurally on zero matches, BY DESIGN: DELETE the rule then, do not baseline it at 0.",
        "$measured": "2026-08-16 @ ec1bf0359 — 963 .rs files walked, floor 900; two independent implementations reconciled at 7 raw / 23 compliant after two diagnosed disagreements and one lexer false positive; every match hand-read; 16 fault-injection cases; 0 overlap across 453 neighbour match sites; the leadership protocol and the boot sweep both replayed against real files and real SQLite; live counts from read-only copies of personas.db (244 tables, 2,188 executions, 0 ever claimed) and personas_data.db (71 tables), plus six days of the app's own tracing log (36 starts, 2 followers, 0 releases)."
      },
      "exclude": [
        {
          "path": "src-tauri/db/src/migrations/incremental.rs",
          "reason": "A schema-migration data correction, not a recovery pass. incremental.rs:4497-4505 rewrites dev_tasks rows whose status is the literal 'pending' — a value that was never part of that table's vocabulary (queued|running|completed|failed|cancelled) and was written only by a legacy writer that no longer exists, as its own comment states. It therefore cannot match work any live process owns, and unlike the six real recovery passes there is no owner it could ever be scoped to, so leaving it in would pin this ratchet permanently above zero and break the rule's designed end of life."
        }
      ],
      "baseline": { "files": 6, "matches": 6 },
      "floor": 900
    }
  ]
}
```

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "unowned-inflight-state-sweep-positive-control",
  "goldenPath": "docs/concepts/golden-paths/loop-ownership-and-restart.md",
  "title": "POSITIVE CONTROL — the same in-flight-state rewrite whose WHERE names WHICH work: a row id, an owner, or an age.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "UPDATE\\s+(?:[A-Za-z_]\\w*|\\{[A-Za-z_]\\w*\\})\\s+SET\\s+(?:[^\\\"\\\\]|\\\\[\\s\\S])*?\\b(?:status|state|phase)\\s*=\\s*(?:'(?:failed|interrupted|pending|queued|cancelled|canceled|stale|abandoned|expired|incomplete|timeout|error|dead_letter)'|\\?\\d+)(?:[^\\\"\\\\]|\\\\[\\s\\S])*?\\bWHERE\\b(?=(?:[^\\\"\\\\]|\\\\[\\s\\S])*?\\b(?:status|state|phase)\\s*(?:=\\s*(?:'(?:running|queued|pending|processing|dispatched|in_progress|transforming|analyzing|matching|active|claimed|spawning|streaming|delivered|proposed)'|\\?\\d+)|(?:NOT\\s+)?IN\\s*\\())(?:[^\\\"\\\\]|\\\\[\\s\\S])*?\\bAND\\b",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL, not a gate. The IDENTICAL SET-list anchor as unowned-inflight-state-sweep — the same reset-status alternation, the same table-name requirement — and the same requirement that the WHERE test an IN-FLIGHT status, with one difference: the WHERE must carry a further term. The two are mutually exclusive BY CONSTRUCTION, not merely empirically: the gate requires the string literal to END immediately after the status predicate; this requires an AND after it. MEASURED 2026-08-16 at ec1bf0359: 23 matches across 17 files versus the gate's 7 across 7. PARTITION, NOT A RATIO: 7 + 23 = 30 = every production UPDATE in 963 .rs files that rewrites the state of in-flight work, so every such statement in the tree is classified and there is no unexamined third population; an independent Rust lexer finds 31 of the same shape and the one extra is a hand-verified lexer false positive (sla.rs:637, an INSERT..ON CONFLICT DO UPDATE SET with no table name after UPDATE). The 23 compliant sites divide into three families, and naming them is the point: (a) ROW-SCOPED — events.rs:322 and :897, manual_reviews.rs:308, dev_tools.rs:4476 and :4481, dev_workspaces.rs:849, executions.rs:1874, evolution_proposals.rs:143, automations.rs:573, triggers.rs:321, twin.rs:511, approval_lifecycle.rs:328 and :356, chat_cards.rs:255, design/build_sessions.rs:833, backlog.rs:118, proactive/mod.rs:594, persona_jobs.rs:184 — each names WHICH unit of work it is settling; (b) AGE-SCOPED, which is the compliant form of a genuine SWEEP where no owner column exists — companion/proactive/mod.rs:228, :241 and :250 expire queued and delivered cards against explicit datetime windows, and automations.rs:573's threshold is DERIVED from the work's own retry + backoff budget with the constant-multiple heuristic rejected in the comment at :550-563; night_shift/mod.rs:463 expires proposed plans past PROPOSED_EXPIRY_HOURS; (c) ENTITY-SCOPED — core/build_sessions.rs:322 scopes by persona_id. NOTE WHAT THE LIST DEMONSTRATES: approval_lifecycle.rs holds BOTH forms — :328 and :356 are fenced and :393 is the boot sweep that is not — and persona_jobs.rs holds both at :184 and :261, so the gate is not discriminating on module, author, era or table; it is discriminating on whether THIS PARTICULAR STATEMENT says which work it means, and in two files the same author wrote both. 77% of this repo's in-flight-state rewrites say which work they mean and 23% do not, and the 23% are the boot-recovery passes. This control also caught a real defect in the reconciling implementation twice: on the first run it returned 25 rather than 23 because its lookahead accepted ANY status comparison rather than an in-flight one, sweeping in engine/mod.rs:2234 and incremental.rs:2233 whose predicates test terminal states; and adding dead_letter to the shared reset vocabulary moved events.rs:848 and :897 into it — the same vocabulary gap, on the same literal, that job-claim-and-lease's control hit. If this control's count ever collapses toward the gate's, the shared SET-list anchor has broken and BOTH numbers are meaningless; that is the failure this control exists to make visible. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved; the census engine exempts a `-positive-control` id from the baseline requirement and the registry merge skips it by construction.",
    "$measured": "2026-08-16 @ ec1bf0359 — validated standalone in a composer-private scratch registry, then re-extracted from this document and re-run; 17 files / 23 matches both times."
  },
  "floor": 900
}
```

### Gates I rejected, with numbers

| candidate | violating | compliant | why rejected |
| --- | ---: | ---: | --- |
| **an ownership check that reads process memory instead of the shared artifact** (D1's exact defect) | **1** | 0 | The single sharpest fact in this document and **unshippable as a ratchet**: `is_leader()` is one function in 963 files, and the defect is what it *fails* to do. A one-match rule dies structurally the moment it is fixed, and the runner correctly treats zero matches as a broken matcher. Carried as D1 with the fix replayed. |
| **a destructive call in `setup()` before `try_acquire()`** — the ordering, which is the leaf's core | **6** | **0** | The right condition and **there is no compliant form to point at**: not one call in `lib.rs`'s `setup()` is ordered after the election *and* gated on it, so a positive control is impossible by construction and the rule would be an unratchetable to-do list of six. Worse, "before line 1250" is a *position*, not a textual shape — a regex cannot see ordering. **This is precisely the case the type proposal exists for**, and after `LeaderToken` lands it is a compile error rather than a count. |
| **a periodic `tokio::spawn` loop with no leadership term in its body** | 41 | 11 | **Precision ~0.24.** Measured: 52 periodic loop bodies in the tree, 11 carrying a leadership term. Hand-classifying the 41 found the overwhelming majority are *per-work* loops (waiting on a child process, polling one execution to terminal, a cancellation poll) or legitimately per-process (`freeze_monitor.rs:84`, `resource_governor.rs:42`, `db/src/embedder.rs:211`). No regex separates "a loop that runs forever against shared state" from "a loop that waits for this one child to exit"; they are the same characters. **A gate firing on correct content at three-quarters is worse than no gate.** Carried as §4 step 2 and D7. |
| **`AtomicU64::new(0)` / `AtomicBool::new(false)` as a policy default** | 4 | — | The D6 condition, and it cannot be separated from the ~200 legitimate zero-initialised counters and latches in the tree by any textual signal — `MAX_LIVE_SESSIONS` and a tick counter are byte-identical. `self-disabling-money-ceiling` (8/8) already covers the money-shaped subset. Carried as D6 and P8. |
| **nothing releases the lease · no restart marker exists · `is_leader()` never re-reads · no boot restore for four atomics** | n/a | n/a | All four are **absences**. The census counts presences; "no call site anywhere invokes `release()`" has no textual signal. Found by reading six days of log, copying a database, and replaying a protocol. See below. |

### What the census fundamentally cannot gate here — and the instrument that can

**Ownership is a property of a running deployment, and the census reads source
text.** No rule can say that two instances ran on this machine on Tuesday, that
36 boots in a row evicted a lease nobody released, or that a stalled leader would
resume as a second leader. Those were found the only way they can be found — by
reading the app's own log and replaying the protocol.

So the honest second half of this §9 is a **test**, not a script, and unlike the
rule it belongs in `cargo test` where the protocol lives:

**`src-tauri/src/engine/leadership.rs` — `takeover_while_incumbent_is_alive`**:

1. Two `EngineLeadership` objects on one temp dir. A acquires.
2. Backdate A's on-disk `heartbeat_at` past `STALE_THRESHOLD` **without touching
   A's in-memory state** — this is the step the five existing tests never take,
   and it is the entire difference between the covered path and the live defect.
3. `B.tick()` → assert `B.is_leader()`.
4. `A.tick()` → **assert `!A.is_leader()`**. Today this fails.
5. Assert the lock file's `pid` is B's, and that A logged the relinquish.

It is ~25 lines, needs no new dependency (`tempfile` is already used at
`leadership.rs:221`), and it fails on `master` today — which is the property the
[contract](../golden-path-contract.md) asks of a gate and the reason a passing
suite is currently evidence of nothing on this leaf. Note the calibration
honestly: `cargo test` here runs via `npm run test:rust`, which is not in
`npm run check` and not in the pre-push hook, so **this test's home is weaker
than the census rule's** — it earns its place by being the only instrument that
can see the condition at all, not by where it runs.

## 12 Corrections to the brief

1. **The spine's `convergence: CONVERGED` label does NOT hold — and this is the
   sixth of six CONVERGED labels the campaign has tested and inverted.** Across
   nine clauses swept over five sibling repos (§6): **three are physics only as
   *defects*** (unfenced renewal 5/5, ungated loops 4/4, unscoped boot sweeps
   3/5); **three are SILENCE 5/5** (process election, restart-as-a-concept,
   a durable record of who owns the loops); **one is INVERTED** (the default-0
   cap — three siblings floor at 1 and write down why); and **on two clauses
   Personas is alone in the family with the right answer** (a process election
   at all; a generation counter that retires stale loops). A single label cannot
   carry that shape. The accurate label is **`diverged`, with three convergent
   failure modes** — the same verdict pattern the five earlier CONVERGED labels
   produced.
2. **"Leadership is acquired at `lib.rs:1250`, and `recover_stale_executions`
   runs at `lib.rs:815` — 435 lines earlier" — confirmed exactly, and the
   correction is that it is not one pass but SEVEN.** `:815, :821, :842, :854,
   :864, :909, :1375` (D2). The brief's `:1375` `recover_orphans` is the *least*
   bad of them, because it at least runs after the election — the six that run
   before it include `:909 requeue_persisted_executions`, which does not merely
   mislabel the incumbent's work but **re-executes it**.
3. **"A second process fails the leader's live runs" — confirmed by replay, and
   there is a worse path the brief did not name.** The second process does not
   only fail the leader's runs at boot; it can become a **permanent co-leader**
   and stay one. `leadership.rs:157` reads an in-memory `Option` and
   `daemon/lock.rs:246` `fs::rename`s over the lease without reading it, so a
   90-second stall by the incumbent produces two processes that both return
   `is_leader() == true` forever (§0, D1). **If you want one `file:line` for
   "a second process corrupts the first's state": `src-tauri/src/daemon/lock.rs:246`.**
4. **"`get_running_only` has no instance filter" — confirmed, and the sharper
   fact is what it feeds.** `executions.rs:1357` is
   `SELECT * FROM persona_executions WHERE status = 'running'`, and
   `recover_stale_executions` (`engine/mod.rs:703`) then calls **`update_status`**
   — whose `WHERE` is `id = ?12`. **`update_status_if_running`, the same function
   with `AND status = 'running'`, is defined nineteen lines below at `:953` and
   its doc comment describes this exact hazard.** The guarded form was written,
   documented, and not used by the one caller that most needs it.
5. **"39 production loops. 29 leave zero log lines in six days." — the 39 is
   confirmed (41 impls, 2 in `subscription.rs`'s `#[cfg(test)]`); the 29 is
   [stall-watchdog](./stall-watchdog.md)'s finding and is not re-derived here.
   What this leaf adds is *why* a loop might be silent that has nothing to do
   with throughput:** it may have been a follower for the whole process
   lifetime, and **all 10 leadership gates decline in silence** (D5). "Not the
   leader" is a third indistinguishable cause on top of the two that document
   already lists.
6. **"`MAX_LIVE_SESSIONS = AtomicU64::new(0)` — 0 means off, and that is the
   default" — confirmed, and it is worse and also less universal than implied.**
   Worse: it is one of **four** such atomics in the same file, none of them has
   a durable copy, `app_settings` contains zero keys for any of them, and the
   frontend comment at `fleetSlice.ts:222-224` documents the gap as a tracked
   follow-up (D6). Less universal: **the convergence oracle inverted the
   premise** — `brainiac`, `vibeman` and `personas-cloud` all floor the
   equivalent at 1, two of them with the reasoning written down (§6 clause 7).
   Do not carry "0 = off" forward as a pattern; carry the floor.
7. **"The execution plane has produced nothing since 2026-06-26 — 51 days" —
   confirmed at 51.9 days as of this composition, and this leaf declines to
   re-derive it.** It is [stall-watchdog](./stall-watchdog.md) §0's finding and
   belongs there. What this path contributes to it is a candidate mechanism the
   other document could not see: **the app has restarted 36 times in the last six
   days alone, twice as a follower, and every one of those boots ran seven
   unscoped sweeps.** Whether that is the cause is not established here.
8. **Two findings the brief did not anticipate, both live.** (a) **Nothing ever
   releases engine leadership** — `release()` has zero production call sites and
   the log shows 36 boots, 36 stale-lock evictions, 0 releases (D3), so every
   relaunch inside 90 seconds runs with all 39 singleton loops silently idle for
   up to two minutes. (b) **Both leadership gates fail OPEN** —
   `leadership.rs:215` and `subscription.rs:1288` are both `.unwrap_or(true)`,
   deliberately and for backward compatibility, and both bias toward *more*
   owners at exactly the moment the system cannot tell how many there are.
9. **One thing the brief implied is a defect and is not.** The
   `generation: AtomicU64` counter (`background.rs:128-142`, compared per tick at
   `subscription.rs:1266`) is **the best ownership mechanism in this repo and the
   only true implementation of its kind in six repos** (§6 clause 8). It solves
   restart-in-place completely, its doc comment explains why a shared `bool`
   would not, and it has a test that asserts the exact property
   (`background.rs:3687-3710`). The defect is not that this repo lacks a model
   for loop ownership — it is that **the model exists in memory, for one process,
   and was never extended across the file that two processes share.**
