# Golden path — Terminal state and recovery

> Situation node: `backend-runtime/background-work/terminal-state-and-recovery` ·
> [situation spine](../situation-spine.md) · recurrence 15 · risk **HIGH** ·
> sides: **server** · `twoSided: true` · convergence: **mixed** ·
> dimensions: **function · resilience · ui**
> merged from *Reaping stranded work*, *Boot crash recovery*, *Durable terminal-state persistence*.
> Composed 2026-08-15 against `master` @ `8766c6c41`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri` (matches
> [`shared-facts.json`](../shared-facts.json) `rust.files`), lexed with a
> string/comment-aware Rust tokenizer rather than grepped: **83,759** string
> literals, **5,229** of them SQL (**4,371** production, **858** inside
> **brace-matched** `#[cfg(test)]` ranges — never a line threshold, and
> `*_tests.rs` matched by filename because `dev_tools_backlog_tests.rs` carries
> no `#[cfg(test)]` attribute at all). Every one of the **130** production
> `status`/`state`/`phase` membership tests was extracted and classified;
> all **22** that bind to `persona_executions` were opened and read. On the
> client, **4,828** `src/**/*.{ts,tsx}` files scanned for hand-rolled terminal
> sets. Both reapers, all **11** boot/recovery entry points, `process_session.rs`
> (673 lines), `leadership.rs`, `daemon/lock.rs`, `daemon_bin.rs` and the whole
> `cleanup_tick` read by hand.
>
> **Measured by execution, not by reading.** Read-only **copies** of the live
> `personas.db` (347 MB) and `personas_data.db` were queried; the live files were
> never opened for write. Every reaper predicate and every terminal-set literal
> was replayed verbatim against real rows. The heartbeat timeline of all 20
> reaped executions was reconstructed from `started_at` / `last_heartbeat_at` /
> `completed_at`. The §9 rule was validated three times — a standalone lexer, a
> raw-offset scanner, and the census engine — and re-extracted from this finished
> document and re-run. **`cargo` was not run** (PreToolUse guard — the operator's
> app is running).
>
> ---
>
> ## The headline: one physical event, two terminal states, and only one of them counts
>
> When a unit of work dies without recording its own outcome, **two different
> reapers can notice, and they write two different terminal states.** Live, on
> the operator's database, 94 executions were abandoned by a dead process:
>
> | who noticed | writes | live rows | visible to the app's reliability metrics? |
> | --- | --- | ---: | --- |
> | `ExecutionEngine::recover_stale_executions` (`engine/mod.rs:703`) — next app boot | **`failed`** | **74 (79%)** | **yes**, everywhere |
> | `executions::sweep_zombie_executions` (`executions.rs:1773`) — every 5 min after 30 min of silence | **`incomplete`** | **20 (21%)** | **no**, nowhere |
>
> Same event. Same cause — "the process that owned this row is gone". Which
> terminal state you get depends on whether the app happened to restart within
> thirty minutes. And the choice is not cosmetic, because **`incomplete` is
> absent from 14 of the 22 terminal-set membership tests in the tree**, including
> every one that computes reliability:
>
> | query | site | terminal set it names |
> | --- | --- | --- |
> | per-persona success rate | `sla.rs:64` | `('completed','failed')` |
> | per-persona daily reliability | `sla.rs:109` | `('completed','failed')` |
> | SLA dashboard aggregate | `sla.rs:344` | `('completed','failed','cancelled')` |
> | P95 duration | `sla.rs:376` | `('completed','failed')` |
> | `sla_daily` rollup (the durable tail) | `sla.rs:651` | `('completed','failed','cancelled')` |
> | daily-trend fresh head | `sla.rs:764` | `('completed','failed','cancelled')` |
> | **breach signal** (consecutive-failure alarm) | `sla.rs:983` | `('completed','failed','cancelled')` |
> | **trust score** | `personas.rs:1469` | `('completed','failed')` |
> | recent error rate | `metrics.rs:354` | `('failed','error')` |
> | prompt performance | `metrics.rs:1022` | `('completed','failed')` |
> | execution dashboard | `metrics.rs:1192` | `('completed','failed')` |
> | trigger health map | `triggers.rs:1621` | `('failed','error')` |
> | Athena's fleet data prompt | `approval_exec_fleet.rs:71` | `('failed','error','timeout')` |
> | "did this run finish?" before posting output | `runner/mod.rs:3030` | `('completed','failed','cancelled')` |
>
> **A lost execution cannot lower a success rate, cannot raise an error rate,
> cannot trip a breach alarm, and cannot make a trigger look unhealthy.** Fifteen
> of 78 personas are affected; the global success rate moves **0.90 points** and
> per-persona up to **9.1 points** purely from which literal a query happened to
> spell. Two personas display **100.0%** while carrying lost runs.
>
> Meanwhile the one predicate that *is* hoisted to a shared constant —
> `MONTHLY_SPEND_PREDICATE` (`executions.rs:1732`), with a doc comment demanding
> that two call sites stay "in lock-step" — names **all four** terminal states.
> `compute_trust_score` does both, 32 lines apart in one function: success rate
> over `('completed','failed')` at `:1469`, monthly spend over the full set at
> `:1501`. **You are billed for a lost run, and it never counts against you.**
>
> Three more findings are sharper than the ratio.
>
> ### 1 — the signal that would tell a dead worker from a slow one is collected, indexed, queried, and read by nobody
>
> `persona_executions.last_heartbeat_at` is stamped by the runner
> (`touch_last_heartbeat`, `executions.rs:1461`) and is present on **2,056 of
> 2,188** live rows. `find_silent_running` (`:1481`) queries it.
> `silent_execution_tick` (`background.rs:3239`) runs every 5 minutes and emits
> `EXECUTIONS_SILENT_DETECTED` when a run has been quiet for 90 s. Its doc
> comment (`background.rs:3234-3238`) says the event exists *"so the UI can show
> it earlier than the hard kill, and so healing can proactively act before the
> watchdog terminates the run."*
>
> **`EXECUTIONS_SILENT_DETECTED` has zero listeners in 4,828 frontend files**,
> and no Rust consumer is possible (it is a Tauri event). Neither half of its
> stated purpose happens.
>
> And **`sweep_zombie_executions` — the function that actually writes the
> terminal status — never reads the column.** Its candidate query is
> `SELECT id, persona_id, status, started_at, created_at … WHERE status IN
> ('running','queued')` (`executions.rs:1787`); the age test is done in Rust
> against `started_at` and a hardcoded 30 minutes (`:1756`). Replayed against the
> 20 rows it reaped:
>
> | reaped execution | ran for | heartbeat silence at the moment of the reap |
> | --- | ---: | --- |
> | `1276b340…` (T: Security Sentinel) | **233.9 min** | **−0.09 s** — the reap timestamp is 93 ms *before* the last heartbeat |
> | `…` (T: QA Guardian) | **52.6 min** | **+0.1 s** |
> | 14 others | 0.5–9.5 min | 50–340 min (genuinely dead) |
> | 4 others | — | never heartbeated at all |
>
> **Two of twenty were alive.** The 233.9-minute run was heartbeating *at the
> instant* it was declared `"Execution stalled"`. Because
> `update_status_if_running` (`:916`) guards on `status = 'running'`, its own
> terminal write was then refused. All 20 reaped rows carry
> **`duration_ms` NULL, `output_data` NULL, 0 tokens, $0 cost** — and 19 of 20
> still carry a `claude_session_id`, so the session that could be resumed is
> named in the row and nothing resumes it.
>
> ### 2 — four unrelated definitions of "too long", and the one that writes the verdict is derived from nothing
>
> | constant | value | what it does |
> | --- | ---: | --- |
> | `SILENT_EXECUTION_THRESHOLD_SECS` (`background.rs:3229`) | 90 s | emits an event nobody hears |
> | `DEFAULT_EXECUTION_TIMEOUT_MS` (`runner/mod.rs:58`) | 11 min | per-execution stream timeout when unset |
> | `ENGINE_MAX_EXECUTION_SECS` (`core/src/limits.rs:15`) | 20 min | *"non-overridable safety net"* ceiling |
> | `DEFAULT_ZOMBIE_THRESHOLD_SECS` (`executions.rs:1756`) | **30 min** | **writes `incomplete` and voids the run** |
> | `QUEUED_ZOMBIE_THRESHOLD_SECS` (`:1763`) | **60 min** | same, for `queued` |
> | `daemon::lock::STALE_THRESHOLD` (`daemon/lock.rs:57`) | 90 s | *"three missed heartbeats before we declare the daemon dead"* |
>
> **None is derived from another.** Both runs that were reaped alive belonged to
> personas configured at `timeout_ms = 20 min` — exactly the engine ceiling — and
> ran 2.6× and 11.7× past it, so the runner's own timeout did not fire either.
>
> The repo already contains the correct way to pick this number, for a different
> work type. `automations::reap_stale_runs` (`automations.rs:564`) computes
> `max_attempts × timeout_ms + backoff_sum + grace` **from the work's own
> configuration**, and its doc comment (`:550-563`) explicitly rejects the
> constant-multiple heuristic: *"The previous heuristic (2× `timeout_ms`) could
> reap a run that was still legitimately inside its retry-backoff budget."*
> That is exactly the defect one file away, and it was written down before it was
> made.
>
> ### 3 — the claim, the lease, the instance id and the liveness lock all exist, and none of them is wired to the thing that reaps
>
> - `daemon/lock.rs` is a **heartbeat lease** with `pid`, `hostname`,
>   `started_at`, `heartbeat_at` and a 90-second stale threshold. It works: the
>   live `engine-leader.lock` holds all five fields.
> - `engine/leadership.rs` **generalises it** so *"any instance can hold engine
>   leadership — not just the daemon binary"* (`:12-15`), and mints a per-launch
>   `instance_id` UUID that *"distinguishes concurrent instances"* (`:70`).
> - `persona_executions` carries `claimed_by_instance` + `claim_expires_at`.
> - `claim_for_instance` (`executions.rs:954`) is a CAS with a TTL lease.
>
> **Repo-wide, `claim_for_instance` has the definition and five test call sites
> and nothing else. 0 of 2,188 executions and 0 of 12 `build_sessions` have ever
> been claimed.** `instance_id` is never passed to it. The one column that could
> tell "my dead process's row" from "another live process's row" is never
> written, which is why every recovery path in this document has to guess from a
> clock.
>
> That has a direct consequence. `recover_stale_executions` runs at
> **`lib.rs:815`**, and engine leadership is acquired at **`lib.rs:1250`** — 435
> lines later. `get_running_only` (`executions.rs:1320`) is
> `WHERE status = 'running'` with **no instance predicate**, and the write is an
> unguarded `update_status` behind a `let _ =` (`engine/mod.rs:711`). So a second
> Personas process booting — the daemon, a second window, a test instance, all of
> which `leadership.rs` exists to support — **marks every live execution of the
> current leader `failed` with "App restarted while execution was running"**,
> before it has any idea another leader exists.
>
> ### And nothing is recorded at shutdown, by either binary
>
> The only `RunEvent::Exit` handler in the tree (`lib.rs:3755-3762`) stops Bun
> dev servers. No execution, job, assignment or session status is written when
> the windowed app closes. The daemon is worse in one specific way: at
> `daemon_bin.rs:210` it logs
> `"draining — waiting for in-flight executions"`, then immediately drops the
> heartbeat channel, awaits the heartbeat task and releases the lock. **It does
> not drain, does not wait, and writes nothing.** Recovery is entirely
> after-the-fact, and the two after-the-fact paths disagree (see the headline).
>
> ### Sibling boundaries, settled in prose
>
> [**long-running-job-progress**](./long-running-job-progress.md) owns the
> *inventory* of boot recovery — its R1 enumerates **11 boot passes covering ~13
> of ~35 durable lifecycle tables** and lists the tables with none. **This path
> owns what a recovery pass WRITES**: which terminal state it picks, whether that
> state is legible to anything downstream, and whether its liveness signal is the
> right one. Both facts are needed and neither implies the other — `persona_executions`
> is one of the tables that *has* a boot pass, and it is the subject of every
> defect below.
>
> [**cancelling-in-flight-work**](./cancelling-in-flight-work.md) owns the
> *deliberate* stop: the Stop button, `ActiveProcessRegistry`, `kill_on_drop`,
> the cancel token. **This path owns the stop nobody asked for** — and inherits
> its unfinished business: that path read `process_session.rs` (673 lines) as
> cancellation surface; §7 D6 here reports that its `ProcessSession` trait, whose
> `transition_to` is the only code in the tree that refuses to leave a terminal
> state, has **zero implementors anywhere outside its own test module**.
>
> [**conditional-write**](./conditional-write.md) owns the CAS mechanism — the
> predicate in the `WHERE` clause and whether the caller reads the count.
> **This path owns what the predicate should be *about***: liveness. Its D1 (the
> zombie sweep discarding its CAS verdict) **has since been fixed** at
> `executions.rs:1862`; §12 records that.
>
> [**retention-and-pruning**](./retention-and-pruning.md) owns deleting rows that
> already reached a terminal state, and established that a positive status
> allowlist rots. **This path owns getting the row INTO a terminal state**, and
> extends that document's central finding from `DELETE` predicates to *read*
> predicates: the same allowlist rot costs 4,941 immortal events there and a
> laundered success rate here.
>
> [**background-loop**](./background-loop.md) owns the tick's scheduling and
> liveness. **This path owns the reap the tick performs.**
>
> [**scheduled-trigger-firing**](./scheduled-trigger-firing.md) owns when work
> starts. This path owns how it stops.
>
> The **Deviations** section is a fix backlog and contains **three live
> user-visible defects** (D1, D2, D4).

---

## 1 Trigger

- "The app crashed mid-run — what happens to that row on restart?"
- "How do I know this job is dead and not just slow?"
- "Something needs to clean up rows stuck in `running`."
- "What status do I write when we never found out how it ended?"
- "Is this run finished?" / "Give me the success rate over finished runs."
- "Can a failed run be retried, or does that make a new row?"

If you are about to type `status IN ('completed', …)`, `WHERE status = 'running'
AND … < ?`, `stale`, `stuck`, `zombie`, `orphan`, `reap`, `sweep`, `recover_`,
`is_terminal`, a new variant on a lifecycle enum, or a constant named
`*_THRESHOLD_SECS` — you are in this situation.

**Not this path:** *the user pressing Stop* is
[cancelling-in-flight-work](./cancelling-in-flight-work.md); *deleting rows that
are already terminal* is [retention-and-pruning](./retention-and-pruning.md);
*whether the caller reads a CAS's affected-row count* is
[conditional-write](./conditional-write.md); *the progress channel while work is
in flight* and *the census of which tables have a boot pass at all* is
[long-running-job-progress](./long-running-job-progress.md); *a panic inside a
detached task* is `panic-isolation`.

## 2 The one way

**Decide "is this dead?" from a liveness signal the worker itself writes, never
from the clock — and when you cannot tell, record a terminal state that says so
and make every reader see it.** Concretely: (a) **the worker claims the row**
with its `instance_id` and a lease (`claim_for_instance`), and refreshes a
heartbeat while it works; the reaper's predicate is `lease expired` or
`heartbeat older than 3× the heartbeat interval`, never `started_at older than a
constant you chose`. (b) **Derive the threshold from the work's own budget** —
`max_attempts × timeout + backoff + grace`, as `automations::reap_stale_runs`
does — so a legitimately long run is never reaped; a hand-picked constant is a
guess about someone else's workload and will be wrong the first time it matters.
(c) **Express the reaper's predicate negatively**: `status NOT IN (<terminal>)`,
so a lifecycle variant added later is swept by default rather than stranded
forever in silence — the same rule
[retention-and-pruning](./retention-and-pruning.md) §2(b) earned on the delete
side, for the same reason. (d) **Prefer recovery to termination, with a
budget** — return the row to its pre-claim state and increment an attempt
counter, and only terminalise when the counter is exhausted; a lease with no
rearm is worse than no lease, because the column and the doc comment both claim
the problem is solved. (e) **One work type gets ONE terminal state for "we lost
track of it"** — not `failed` from one reaper and `incomplete` from another;
pick it once, in the type, and make every recovery path write the same one.
(f) **Then make it legible**: never hand-write the terminal set in a query.
Derive it from the enum's `TERMINAL` const, because a subset spelled by hand is
a silent, permanent exclusion of exactly the rows you built the state for.
(g) **On the client, the same** — one `isTerminalState`, and a lost run must not
be collapsed into `failed`, because the whole point of a distinct state is that
the user can tell "it broke" from "we don't know".

If you must get one right first: **(f)**. (a)–(e) fail loudly the first time
someone looks; (f) fails silently forever, and it is why nobody looked.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `core/src/types.rs:41` `ExecutionState::TERMINAL` / `:48` `::ACTIVE` | the closed terminal set, guarded by `terminal_plus_active_covers_all_variants` (`:800`) which **fails the build** on an unclassified variant, `terminal_and_active_are_disjoint` (`:811`), and `terminal_set_matches_expected` (`:824`) which names the TS constant to update in the same commit. **Use it. It has 0 production callers today** (§7 D3) |
| `core/src/lifecycle.rs:70` `declare_lifecycle!` | generates the enum, `ALL_VARIANTS`, `can_transition_to`, `transition_to`, `as_str`, `Display`, `FromStr` from a declarative transition table. Three enums use it; every other status column is a free `TEXT` string |
| `db/src/repos/communication/events.rs:961` `reap_stuck_processing` | **the one site to copy.** See §6 |
| `src/engine/background.rs:1051` `partition_stuck_candidates` | two-consecutive-sightings liveness proxy for a table with no claim timestamp — and its doc comment says exactly that (`:932-935`). The honest fallback when (a) is unavailable |
| `db/src/repos/resources/automations.rs:564` `reap_stale_runs` | the threshold **derived from the work's own retry + backoff budget**, not a constant. Copy this arithmetic, not the number |
| `db/src/repos/core/build_sessions.rs:308` `expire_stale_non_terminal` | the **negative** predicate (`phase NOT IN (…terminal…)`), a documented-legal transition for every row it touches, an idle gate, and idempotence by construction |
| `db/src/repos/execution/executions.rs:954` `claim_for_instance` | CAS + TTL lease + `claimed_by_instance`. **Adopt it; do not rebuild it.** Needs the rearm in §7 D5 first |
| `src/engine/leadership.rs:100` `EngineLeadership` + `src/daemon/lock.rs:57` `STALE_THRESHOLD` | the working heartbeat-lease and the per-launch `instance_id`. This is the liveness signal §2(a) means |
| `db/src/repos/execution/executions.rs:1461` `touch_last_heartbeat` / `:1481` `find_silent_running` | the per-execution heartbeat, already written on 94% of rows. **Put it in the reaping predicate** |
| `db/src/repos/execution/executions.rs:916` `update_status_if_running` / `:999` `update_status_if_not_final` | the guarded terminal writes. `update_status_if_not_final`'s cancel branch (`:1017-1023`) is the model for "cancellation is a terminal sink" |
| `src/lib/execution/executionState.ts:42` `TERMINAL_STATES` / `:68` `isTerminalState` / `:91` `VALID_TRANSITIONS` / `:83` `parseExecutionState` | the client half, and it is good — `parseExecutionState` maps an unrecognised status to `'unknown'` **and not to `'failed'`**, *"so data corruption is visible in the UI instead of masquerading as a real failure"* (`:79-81`). That sentence is this whole path in one line |

**Do NOT build:** a second terminal state for "abandoned" beside an existing one
(§7 D1); a reaper whose predicate is `now - started_at > <constant>`; a lease
column without the sweep that rearms it; a `TERMINAL`-shaped array literal inside
a SQL string; a fourth hand-rolled `TERMINAL = new Set([...])` on the client
(there are 73 already); an `is<X>Status` helper in a feature folder
(`executionStatus.ts` is one, and it is wrong — §7 D4).

## 4 Steps

1. **Name the terminal states in the type first**, via `declare_lifecycle!`, and
   add `TERMINAL` / `ACTIVE` consts plus the three coverage tests from
   `types.rs:795-834`. Add a `CHECK(status IN (…))` to the column in the same
   migration — measured: the two enums with a CHECK are the two that have not
   rotted.
2. **Decide, once, what "we lost track of it" is called.** It is a *different*
   state from `failed`: `failed` means the work ran and produced a bad outcome;
   the lost state means nobody knows. Write down which one every recovery path
   must use, and make every recovery path use that one. **This is the step this
   repo skipped**, and §7 D1 is the price.
3. **Give the worker a claim and a heartbeat.** `claim_for_instance(pool, id,
   leadership.instance_id(), ttl)` on pickup; `touch_last_heartbeat` on each
   tick. Ask, before writing any reaper: *what does this row know about the
   process that owns it?* If the answer is "nothing", fix that before writing
   the sweep.
4. **Ask whether the signature can make the wrong reap impossible.** A repo
   function that takes a `LiveWorkers` handle (see *Prefer a type over a gate*)
   cannot be called with a clock. This is step 4, not step 9, deliberately.
5. **Derive the threshold.** `worst_case = max_attempts × timeout_ms +
   backoff_sum + grace`, from the row's own configuration. If you find yourself
   typing `30 * 60`, stop and go read `automations.rs:550-563`.
6. **Write the reaper as ONE guarded statement per row** whose predicate carries
   the current state — `WHERE id = ?1 AND status = 'running'` — so the owning
   worker always wins the race, and return the verdict (`RETURNING status`, or a
   bound `usize`). Never batch a reap across rows you cannot individually CAS.
7. **Make recovery the default and termination the bounded exception.**
   `SET retry_count = retry_count + 1, status = CASE WHEN retry_count + 1 >= ?
   THEN '<terminal>' ELSE '<pre-claim>' END` — one statement, one decision, a
   ceiling that stops a poisoned row cycling forever. If you write a lease, write
   the statement that returns a dead claimant's row to the pre-claim state **in
   the same commit**; a lease without a rearm is §7 D5.
8. **Express eligibility negatively.** `WHERE status NOT IN (<terminal>)`, not
   `WHERE status IN ('running','queued')`.
9. **Make the state legible everywhere before you ship it.** Grep every
   `status IN (` for the table and every client `=== 'failed'` chain, and add the
   new state. Then delete those literals and derive them from the const, or
   §7 D2 will happen to you: a state that exists, is written, and is counted
   nowhere.
10. **Log the reap as WARN with its counts**, and expose a counter
    (`SchedulerStats.events_reaped` is the model). A reap is evidence that
    workers are dying between claim and outcome; it must never be silent, and it
    must never be `info!`.
11. **And then stop.** Do not add a second reaper for the same table, and do not
    add an in-memory set of live ids as the source of truth.
    **On a shutdown drain, the honest answer is "second, and only if you can
    guarantee the grace period".** The recovery path must be correct regardless —
    a hook cannot run on `SIGKILL`, a power loss, or a panic — so build the
    reaper first. *But* `personas-cloud` drains for 60 s and then force-writes
    `failed`, and it is the best shutdown in the six-repo family; a drain
    converts an unbounded window of wrong data into a bounded one. The
    disqualifier is `brainiac`: correct SIGTERM handling with **no
    `stop_grace_period` anywhere in its compose or Dockerfile**, so the platform
    kills it at 10 s against a 300 s lease. **A drain you cannot guarantee time
    for is a comment.** What is never acceptable is `daemon_bin.rs:210` — a log
    line claiming a drain that does not exist (§7 D8).

## 5 Anti-patterns

- **Two reapers, two terminal states, for the same physical event.** *Failure:*
  the outcome of a lost run depends on who noticed, and any query that names one
  state and not the other silently partitions your data by a coincidence of
  timing. **Measured: 74 rows `failed`, 20 rows `incomplete`, one cause; a
  0.90-point global and 9.1-point per-persona swing in the number the product is
  judged by.**
- **Reaping on wall-clock age since start.** *Failure:* it cannot tell a dead
  worker from a slow one, in either direction — it holds a dead row for up to the
  full threshold, and it kills a healthy long run at the threshold and refuses
  the result the run then tries to write. **Measured: 2 of 20 reaped runs were
  heartbeating at the moment of the reap; one had been running 3.9 hours and its
  reap timestamp is 93 ms earlier than its last heartbeat. Both lost their
  entire output.**
- **Collecting a liveness signal and not putting it in the predicate.**
  *Failure:* the fix looks done. There is a column, an index-adjacent query, a
  tick, an event, a type in `eventRegistry.ts` — and the decision is still made
  by a constant. **Measured: 2,056 rows carry `last_heartbeat_at`; the reaper's
  `SELECT` does not name it, and the event that does has zero listeners.**
- **Hand-writing a subset of the terminal set in a query.** *Failure:* identical
  to the retention-allowlist failure and even quieter — the query succeeds,
  returns a number, and the number is wrong by exactly the rows you created the
  state for. **Measured: 14 of 22 membership tests on `persona_executions` name a
  strict subset; 62 distinct spellings tree-wide.**
- **Naming a status the column cannot hold.** *Failure:* a permanently-zero
  branch that reads like coverage. `('failed','error')` and
  `('failed','error','timeout')` appear in three production queries against a
  column whose `CHECK` admits neither `error` nor `timeout`. The author believed
  they were being thorough.
- **A terminal state the client collapses.** *Failure:* the backend distinguishes
  and the UI does not, so the distinction cannot be acted on by the only person
  who could. `usePersonaExecution.ts:317` maps every terminal state that is not
  `completed` or `cancelled` to `'failed'`.
- **A shutdown log line with no shutdown behind it.** *Failure:* the next reader
  believes the drain exists. `daemon_bin.rs:210` prints *"draining — waiting for
  in-flight executions"* and then does neither.
- **A boot recovery with no instance predicate.** *Failure:* in a repo that
  explicitly supports multiple processes on one database, "everything that says
  `running` is mine and is dead" is false, and the write is unguarded.
- **A lease whose predicate cannot match an expired claim.** *Failure:* worse
  than no lease, because the column and the comment both assert the problem is
  solved. §7 D5.
- **A reaper that only runs when someone opens the row.** *Failure:* the rows
  nobody opens are exactly the stuck ones. **Measured: 24 `team_deliberations`
  non-terminal for 50+ days, 3 of them at `action_running` on executions that
  completed 50 days ago — `reap_action` would resume them and is only called
  from a per-row tick and an on-demand command.**

## 6 Evidence

**The one site to copy: `db/src/repos/communication/events.rs:961-996`
`reap_stuck_processing`.** Read it as six decisions:

```sql
UPDATE persona_events
   SET retry_count = retry_count + 1,
       status = CASE WHEN retry_count + 1 >= ?1 THEN 'dead_letter' ELSE 'pending' END,
       error_message = CASE WHEN retry_count + 1 >= ?1 THEN ?2 ELSE ?3 END,
       processed_at  = CASE WHEN retry_count + 1 >= ?1 THEN ?4 ELSE NULL END
 WHERE id = ?5 AND status = 'processing'
RETURNING status
```

1. **Recovery is the default, termination is the bounded exception** — the `CASE`
   returns the row to `pending` until an attempt ceiling is reached. This is the
   half `sweep_zombie_executions` does not have.
2. **The retry counter is what stops the cycle**, and the doc comment says so
   (`:955-957`), so "requeue instead of terminalise" cannot become a livelock.
3. **One atomic statement guarded on the current state**, so *"a terminal write
   from the tick that actually owns the row always wins the race and the reaper
   reports `None`"* (`:952-954`) — and the caller treats `Ok(None)` as
   `raced += 1`, not as an error (`background.rs:1133-1136`).
4. **The verdict is the return value** (`RETURNING status` → a typed
   `StuckReapOutcome`), not a discarded `usize`.
5. **The liveness proxy is honest about being a proxy.** `list_processing_ids`'
   doc comment (`:932-935`) states plainly: *"A single snapshot cannot tell a
   stranded row from one a healthy tick is processing right now, and the row
   carries no claim timestamp to lean on."* So `partition_stuck_candidates`
   requires two consecutive sightings, and `STUCK_EVENT_REAP_INTERVAL`'s comment
   (`background.rs:1030-1038`) justifies 5 minutes **against every cadence that
   legitimately holds a claim** and adds *"Do not shorten this without a claim
   timestamp to lean on."*
6. **It is loud.** `tracing::warn!` with `redelivered` / `dead_lettered` /
   `raced`, plus a `SchedulerStats.events_reaped` counter, *"so it is never
   silent"* (`background.rs:1141-1143`).

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `db/src/repos/resources/automations.rs:550-598` | the **derived** threshold, with the rejected heuristic named in the comment |
| `db/src/repos/core/build_sessions.rs:284-341` | the **negative** predicate + a comment proving the transition is legal for every row it touches + an idle gate + idempotence |
| `core/src/types.rs:795-834` | the three coverage tests that make a new variant a build failure, one of which names the TS constant to update |
| `src/daemon/lock.rs:50-118` | the heartbeat lease: `pid` + `hostname` + `heartbeat_at`, `is_stale()`, and a threshold justified as *three missed heartbeats* |
| `src/engine/leadership.rs:20-30` | a stale lease being **taken over** rather than waited on, with the follower re-attempting each tick |
| `src/lib/execution/executionState.ts:75-87` | `parseExecutionState` refusing to map an unknown status to `failed` |
| `src/engine/mod.rs:2216-2247` | the only *legal* exit from a terminal state in the tree: a `completed → incomplete` assertion downgrade, done as a CAS guarded on `status = 'completed'`, with a comment explaining why the ordinary guarded write cannot express it |
| `db/src/repos/execution/executions.rs:1726-1732` | `MONTHLY_SPEND_PREDICATE` — the *only* terminal-set predicate hoisted to a shared constant, with a doc comment naming the three axes two call sites must not drift on. The right instinct, applied to one of fifteen queries |

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`,
`../vibeman`, `../ascent`. **All five exist and all five were opened**; nothing
below is reported by omission. **The oracle inverted two clauses I expected to
go the other way** — noted inline, because they are the two that matter most.

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **A reaper exists for abandoned work** | **PHYSICS (4/5)** | `brainiac` `queue.rs` reap-at-claim + `sweeps.rs` (`RUNNING_STALE = "2 hours"`), `ascent` `org-watch.ts:209` lease takeover, `personas-cloud` `db.ts:1256` 5-min stale reset, `vibeman` two reapers. `personas-web` is the silence: **no reaper at all**, and its poller has no max-attempts and swallows errors — *"never gives up, never writes a state."* |
| 2 | **The liveness signal is a heartbeat/lease, not time-since-start** | **INVERTED — the DEFECT is physics, 3 of 5, and one is a direct port of this repo** | I expected a 2–3 split. It is worse. **`personas-cloud` sends a heartbeat every 30 s (`worker/src/connection.ts:15`), holds a 90 s timeout (`orchestrator/src/workerPool.ts:63`) — and reaps on `WHERE status='running' AND started_at < ?` at 5 minutes. `orchestrator/src/db.ts` contains ZERO occurrences of the word "heartbeat".** The two live in different memory spaces with nothing bridging them. `vibeman` does **both at once**: its sessions reaper uses the real heartbeat (correct), while `scanQueue.core.repository.ts:365` reaps on `started_at` *while its own `SET` clause maintains `updated_at`*, and its docstring mitigates the double-execution risk by **tuning the threshold** instead of reading the column it is already writing. **Personas is the third instance, not an outlier.** |
| 3 | **A distinct terminal state for "abandoned" vs "failed"** | **INVERTED — building it and then destroying it downstream is PHYSICS, 3 of 6** | I expected Personas to be alone. It is not. **`personas-web`'s DB admits `'incomplete'` (`scripts/setup-sync-db.sql:87`) and its read mapper collapses it: `if (s === "incomplete") return "failed";` (`src/lib/supabaseApi.ts:75`).** **`brainiac` documents `dead` vs `failed` in a 15-line module doc (`brainiac-store/src/queue.rs:16-30`), proves it in a test — and `brainiac-server/src/http.rs:1417` collapses it with `(Some(_), _) => "failed"`.** `personas-cloud` and `ascent` have no such state at all. **The distinction is the expensive part; three codebases paid for it and threw away the receipt.** Personas' version of the collapse is §7 D2 (SQL) and D4 (`usePersonaExecution.ts:317`). |
| 4 | **A closed type owns the terminal set and is USED in production** | **NO TRACE — 0 of 6 — and "declared but unused" is itself convergent** | Every repo spells its terminal set by hand at every site. Two went further and built the abstraction anyway: **`vibeman`'s 135-line "Status Algebra" (`src/lib/status.ts`) exports `isTerminal`/`isActive`/`isSuccess` and has ZERO production value-imports — all 14 imports in the repo are `import type`** — against ~73 hand-written literals. That is `ExecutionState::TERMINAL` (§7 D3), independently, in TypeScript. `ascent`'s `REC_STATUSES` is used 4×, all of them ingress validation or `<option>` rendering, against ~34 literals. **So the prescription is not observed practice anywhere — but the *failure mode* it addresses is, which is exactly qualification 3 and is why the type proposal below is designed to be unavoidable rather than merely available.** |
| 5 | **Identity: can recovery tell "my crash" from "another live instance"?** | **SILENCE, 5/5 — and one repo pays for it exactly as Personas does** | **Zero** instance/pid/generation/ownership columns on work rows in any sibling. `personas-cloud`'s boot reconciliation *"has no ownership column → steals peers' rows"* — §7 D7, independently. `vibeman` has 0 generation/lease columns. Report as silence; the hazard is universal and unsolved. |
| 6 | **A shutdown path that records in-flight work** | **RARE (1/5) — and my §4 step 11 needs the qualification** | Four are silence: `vibeman` has **11 shutdown hooks and 0 that terminalise**; `brainiac` handles SIGINT+SIGTERM and *writes nothing on exit*; `ascent` is serverless (correctly none); `personas-web` persists nothing. **But `personas-cloud` drains for 60 s and then force-writes `failed`, and it is the best shutdown in the set.** So "don't build a drain" is too strong — see the amended step 11. `brainiac` also supplies the counter-lesson: its SIGTERM handling is correct and **no compose/Dockerfile grants any `stop_grace_period`**, so Docker's 10 s default applies against a 300 s visibility window its own design says the grace *"must comfortably exceed"*. A drain is only as real as the grace period underneath it. |
| 7 | **Work can leave a terminal state** | **PHYSICS (4/5) — and unenforced in 3 of the 4** | `brainiac` is the exemplar: `requeue_dead` is guarded by `outcome IN ('failed','dead')` and a double-requeue is a **proven no-op** in test. The other three requeue in app code with no guard, and two **destroy evidence on the way back**: `personas-cloud`'s `failed → running` erases the error message; `ascent`'s `achieved → active` erases `achievedAt`. Personas' split answer (events requeue with a retry ceiling; executions cannot requeue at all) is inside the family's range. |
| 8 | **A state TRANSITION is validated before the write** | **SILENCE, 5/5 — universal** | **0 of 5 repos validate the legality of a move.** Every mechanism found guards the value *domain* (a `CHECK`, an ingress enum) or *concurrency* (`ascent` built optimistic concurrency instead), never legality. And `vibeman` has *"a Rust state machine — 0 callers"*, which is `ProcessSession` (§7 D6) reinvented. |

**Physics — keep as doctrine:** clauses 1, 3-as-a-defect, 7 (with brainiac's
guard as the model), and — the one that changed this document — **clause 2 as a
defect: collecting a liveness signal and reaping on start-time age anyway is
reinvented in three unrelated codebases.** §2(a) is therefore not local taste.
**Reported as silence:** clauses 5 and 8, and 4 in its positive form.
**Amended by the oracle:** §4 step 11 and clause 6.

> **The single strongest result is `personas-cloud`, and it is negative twice
> over.** It is a *port of this repo's engine*. It independently arrived at the
> same defect from the opposite direction — it built a real worker heartbeat
> (which Personas' execution path also has) and then wrote a reaper in a file
> that has never heard of it. And it has the family's only real drain, which
> Personas does not. **Two codebases descended from one design, each holding
> half of the correct answer, neither holding both.**

> **Counts caveat.** The literal counts above (~73, ~54, ~34, ≥29) are
> grep-derived and sensitive to pattern choice; treat them as magnitudes. The
> *structural* claims — 0 value-imports, a reaper predicate that omits a column
> the same file writes, a collapse site, a missing grace period — were verified
> by opening the files. One sibling docstring asserting *"the `getStale*` helpers
> have no callers"* was checked and found **stale** (`vibeman`
> `orphanReaper.ts:140` calls one); the same trap is live for anyone quoting a
> comment in this territory.

## 7 Deviations

Every entry is live on `master` @ `8766c6c41` and measured against a read-only
copy of the operator's database.

### D1 — the same event gets two terminal states, chosen by timing

`src/engine/mod.rs:703` writes `ExecutionState::Failed`;
`db/src/repos/execution/executions.rs:1838` writes `'incomplete'`. Both mean
"the process that owned this row is gone". Live: **74 `failed` / 20
`incomplete`**, and `incomplete` is invisible to every reliability query (D2).

**Fix:** pick one. `incomplete` is the better state — it is the one that carries
information — so `recover_stale_executions` should write
`ExecutionState::Incomplete` with `error_message = "App restarted while
execution was running"`. Land it **after** D2, or the fix moves 74 more rows out
of the metrics.

### D2 — `incomplete` is excluded from 14 of the 22 terminal-set membership tests

Full table in the headline. `db/src/repos/communication/sla.rs:64, 109, 344,
376, 651, 764, 983` · `db/src/repos/core/personas.rs:1469` ·
`db/src/repos/execution/metrics.rs:354, 1022, 1192` ·
`db/src/repos/resources/triggers.rs:1621` ·
`src/commands/companion/approvals/approval_exec_fleet.rs:71` ·
`src/engine/runner/mod.rs:3030`. The compliant 8 are
`personas.rs:1501`, `executions.rs:1929/1946/1964/2019`,
`policy_evidence.rs:45`, `baselines.rs:157`, `execution_review.rs:197`.

Live impact: 15 of 78 personas overstate their success rate, by up to **9.1
points**; two show **100.0%** while carrying lost runs; global spread **0.90
points**. `get_persona_breach_signal` (`sla.rs:983`) cannot see a lost run at
all, so a persona whose last N runs were all abandoned raises no alarm.
`sla_daily` — the durable tail that outlives execution retention — is written
from `sla.rs:651` and therefore bakes the exclusion in permanently.

**Fix:** derive the fragment from `ExecutionState::TERMINAL` (see *Prefer a type
over a gate*) and delete all 14 literals. Three of them
(`metrics.rs:354`, `triggers.rs:1621`, `approval_exec_fleet.rs:71`) additionally
name `'error'` / `'timeout'`, which the column's `CHECK` forbids — those
`SUM(CASE …)` branches have always evaluated to 0.

### D3 — `ExecutionState::TERMINAL` and `::ACTIVE` have zero production callers

`core/src/types.rs:41`, `:48`. **6 occurrences across 5 lines, all inside the
file's own `#[cfg(test)]` module** (`:791` onward): `:803` (both), `:812`,
`:814`, `:826`, `:840`. The consts are guarded by three tests including one that
fails the build on an unclassified variant — the strongest small piece of design
in this territory — and no production code has ever read them, against **108
production positive `status IN (…)` literals in 62 distinct spellings**, of
which the execution terminal set alone wears four.

The *predicate* fares better: `is_terminal()` has **20 production call sites**
(and `is_active()` 2), so the concept is used — just never the set. That is the
distinction to keep: what is missing is not a helper, it is a way to get the
set into SQL.

**Fix:** a `RetentionScope`-style constructor (see below) plus §9's ratchet.

### D4 — the client collapses "lost" into "failed", including in the primitive built to prevent that

- `src/hooks/execution/usePersonaExecution.ts:317` —
  `const mapped = status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed';`
  is inside an `isTerminalState(status)` branch (`:316`). It correctly identifies
  `incomplete` and `unknown` as terminal and then reports both as **failed**.
- `src/features/agents/sub_executions/libs/executionStatus.ts:10`
  `isFailedExecutionStatus` = `failed | cancelled | timeout` — omits
  `incomplete`, names a `timeout` that is not a legal `ExecutionState`. Its own
  doc comment (`:1-9`) says the file exists *"so a new terminal status only needs
  to be added in one place."* **It is the destination a §9 gate would route
  callers to, and it is wrong.** Its 8 call sites are the executions list's
  failed-count badge and the **"rerun failed" bulk filter**
  (`ExecutionList.tsx:292`, `:300`; `BulkRerunToolbar.tsx:42`;
  `BulkRerunReport.tsx:34-41`) — so **a user cannot bulk-rerun a lost
  execution**, because the filter does not consider it failed.
- `src/features/plugins/research-lab/shared/runPersona.ts:6` —
  `TERMINAL = new Set(['completed','failed','cancelled','error','timeout'])`:
  two states that do not exist, and `incomplete` missing. A reaped run never
  satisfies the poll's exit condition and is returned as `kind: 'timeout'`, which
  the function's own doc comment (`:11-15`) says the caller *"MUST NOT persist as
  a failed run"* — so it is recorded as nothing at all.

**Structural:** `isTerminalState` / `TERMINAL_STATES` / `isActiveState` are used
at **11 real call sites** (18 hits, 7 of them inside the primitive module) against
**73 hand-rolled terminal sets in 18 distinct spellings** across production
`src/**`. The primitive is good; adoption is 13%.

**Fix:** delete `executionStatus.ts` and route its 8 call sites to
`isTerminalState` + an explicit `status === 'completed'`; fix `:317` to pass
`incomplete` through; make `runPersona.ts` import `TERMINAL_STATUS_SET`.

### D5 — the lease cannot rearm, and its doc comment says no reaper is needed

`db/src/repos/execution/executions.rs:938-940`: *"The TTL-in-`WHERE` doubles as
the stale-claim sweep: an expired claim is simply re-claimable, so no separate
reaper task is needed."* Replayed: the predicate (`:976-985`) requires
`status = 'queued'` **and** an expired lease. A claimant that dies leaves the row
at `running`, which the predicate can never match; `sweep_zombie_executions`
moves such a row to `incomplete`, which is terminal. **No production path
returns an execution to `queued`** — `ExecutionState::Queued` has exactly four
production references (a `Default` impl at `models/execution.rs:214`, the
`ACTIVE` const and `is_active` at `types.rs:50`/`:54`, and a tray label at
`tray.rs:222`), and the two `update_status(…, Queued)` call sites are both tests
(`executions.rs:2119`, `process_session.rs:585`).

`claim_for_instance` also has **0 production callers** (definition + 5 test
sites); **0 of 2,188** executions and **0 of 12** `build_sessions` carry
`claimed_by_instance`, though the same migration gave both tables the columns.

**Fix, as one unit:** (a) call `claim_for_instance(pool, id,
leadership.instance_id(), ttl)` on pickup; (b) have `sweep_zombie_executions`
**requeue** (`status = 'queued'`, `claimed_by_instance = NULL`, `retry_count + 1`)
when the row was claimed and the lease expired and the retry budget is not
exhausted, and terminalise only otherwise — the `CASE` from `reap_stuck_processing`
transcribed; (c) correct the doc comment.

### D6 — `ProcessSession` is a 382-line state machine with zero implementors

`src/engine/process_session.rs` is 673 lines; its `#[cfg(test)]` module starts at
`:383`. `SessionState::transition_to` (`:59-83`) is **the only code in the tree
that refuses to leave a terminal state**:

```rust
if self.is_terminal() {
    return Err(format!("{}: cannot transition from terminal state '{}' to '{}'", …));
}
```

`ProcessSession` and `ProcessContext` appear **nowhere in 963 `.rs` files
outside this one file** — verified by grep across the whole tree. The only
`impl ProcessSession` is `TestSession` at `:558`, inside the test module. Three
`SessionState` impls exist in production (`ExecutionState` `:255`,
`LabRunStatus` `:287`, `SessionStatus` `:318`) and feed a trait nobody
implements.

Meanwhile the DB write path has no transition validation at all:
`exec_status_update` (`executions.rs:830`) formats the status into the `SET`
clause and only the `WHERE` clause differs between `update_status` (unguarded),
`update_status_if_running` and `update_status_if_not_final`. `can_transition_to`
has 8 production call sites, none of them on the execution write path.

**Fix:** either wire `persona_executions` through `ProcessSession` (the trait was
built for exactly this) or delete the trait and keep only `SessionState`. Both
are honest; shipping neither is the current state, and it makes the 673-line
file read like enforcement to the next reader.

### D7 — boot recovery has no instance predicate and runs 435 lines before leadership

`src/engine/mod.rs:703-731` calls `get_running_only` (`executions.rs:1320`,
`WHERE status = 'running'`, no instance filter) and writes `Failed` through
unguarded `update_status` behind a **`let _ =`** (`:711`), so a lost race and a
database error are equally invisible. It is invoked at `src/lib.rs:815`; engine
leadership is acquired at `src/lib.rs:1250`.

`leadership.rs:6-10` exists precisely because *"Multiple processes can run
against one local device/DB at once: the windowed Tauri app, the
`personas-daemon` binary, and (future) instances spawned for parallel testing."*
Under that documented topology, a booting second process fails every live run of
the current leader.

**Fix:** (a) gate `recover_stale_executions` on `try_acquire()` having succeeded,
or (b) — better, and it composes with D5 — restrict it to rows whose
`claimed_by_instance` is absent or whose lease has expired. (c) In either case
bind the count: `update_status_if_running` already exists and returns
`Result<bool>`.

### D8 — the shutdown paths record nothing, and one of them says it does

`src/lib.rs:3755-3762` — the only `RunEvent::Exit` handler stops Bun servers.
`src/daemon_bin.rs:208-224` — logs `"draining — waiting for in-flight
executions"`, then drops the shutdown channel, awaits the heartbeat task and
releases the lock. No drain, no wait, no status write.
**Fix:** delete or implement the log line. Implementing a full drain is *not*
recommended (§4 step 11) — the recovery path must be correct regardless — so the
honest fix is one line of text plus a comment pointing at
`recover_stale_executions`.

### D9 — the heartbeat watchdog emits to nobody

`background.rs:3239` `silent_execution_tick` → `EXECUTIONS_SILENT_DETECTED`.
The event is declared in `core/src/events.rs:220` and typed in
`src/lib/eventRegistry.ts:214`/`:991`, and **has zero `listen`/bridge
registrations in 4,828 frontend files** (`ZOMBIE_EXECUTIONS_DETECTED`, by
contrast, is bridged at `src/lib/eventBridge.ts:326` and finishes the active
execution with a real message). `persona_executions` has 14 indexes and none
covers `last_heartbeat_at`.
**Fix:** the useful move is not to add a listener — it is D5(b), which makes the
heartbeat the reaping predicate. Then this event becomes a genuine early warning
rather than the only place the signal is used.

### D10 — reapers that only run when someone looks

Live: **24 `team_deliberations` non-terminal, every one of them 50+ days old**
(17 `awaiting_action`, 3 `open`, 3 `action_running`, 1 `tracking`). The three at
`action_running` point at executions that reached `completed` **50 days ago**;
`engine::deliberation::reap_action` (`:1422`) is exactly the function that would
post their output and resume the conversation, and it is called only from a
per-deliberation tick (`:868`) and an on-demand command
(`commands/teams/deliberations.rs:316`). Two `build_sessions` are stuck at
`test_complete` since 2026-05-25; `expire_stale_non_terminal` deliberately
exempts sessions on `draft` personas, and that exemption has no upper bound.
**Fix:** add a table-scoped sweep for `team_deliberations` in `cleanup_tick`
beside the others; bound the draft exemption at some multiple of
`STALE_SESSION_MIN_AGE_HOURS`.

### Structural — where the reapers are

Ten reapers exist in the tree: `sweep_zombie_executions`,
`reap_stuck_processing_events`, `automations::reap_stale_runs`,
`build_sessions::expire_stale_non_terminal`, `deliberation::reap_action`,
`manual_reviews::gc_stale_pending`, `dev_tools::archive_stale_ideas`, the
healing `auto_fix_pending` reset (`healing.rs:462`, `:548`),
`night_shift::expire_stale_proposed`, and the `companion_proactive_message`
expiry trio (`proactive/mod.rs:228`, `:241`, `:250`). **Seven of the ten express
their staleness test in SQL; two (`sweep_zombie_executions`,
`reap_stuck_processing_events`) do it in Rust; `reap_action` does not test
staleness at all.** Four of the ten use a negative predicate — all four are
`build_sessions`. Of the **33** status-bearing tables whose domain admits an
in-flight value, **most have no reaper**; the live orphans in D10 are the ones
that already have rows.

## 8 Gaps — what the primitives genuinely cannot do

1. **No type can reach inside a SQL string literal.** `ExecutionState` is an
   exhaustive enum with a compiler-checked `match` in `as_str`, and
   `AND status IN ('completed', 'failed')` is a sequence of characters. Adding
   `Incomplete` compiled cleanly at all 22 sites. The only closure is to
   *generate* the fragment — a discipline, not a guarantee — which is why §9 is
   the other half of the answer and not a fallback.
2. **Nothing relates a status literal to the column's `CHECK` constraint.** The
   constraint lives in a migration; the literal lives in a repo function. Three
   production queries name `'error'` / `'timeout'` against a column that cannot
   hold them, and neither `rustc` nor SQLite nor any gate here can join the two
   files. `foreign_key_check` has no analogue for value domains.
3. **A `#[derive]`d lifecycle enum cannot enforce its own transition table at the
   DB boundary.** `declare_lifecycle!` generates `can_transition_to`, and
   `exec_status_update` takes an `UpdateExecutionStatus` whose `status` field is
   any variant. The one construct that closes this — `ProcessSession::transition`
   — exists and is unimplemented (D6).
4. **`UpdateExecutionStatus::default()` resolves `status` to `Queued`** —
   the *start* state (`core/src/models/execution.rs:212-216`). Measured: all 42
   production literals set the field explicitly (5 apparent omissions are field
   shorthand), so this is latent rather than live. But the failure mode of
   forgetting a field is "silently move a finished run back to the queue", which
   is the one transition no production code performs.
5. **A lease is three things and only one is visible to a reviewer** — an expiry
   column, a predicate that admits expired rows, and a sweep that restores the
   pre-claim state. `claim_expires_at` is a `TEXT` column with no partner, and
   D5 is the direct consequence. Carried forward unchanged from
   [conditional-write](./conditional-write.md) Gap 3; nothing has closed it.
6. **The census can ratchet a presence and cannot assert an absence.** "No
   recovery path exists for this table", "this event has no listener", "the
   heartbeat is never in a reaping predicate" are the three largest findings
   above and none is expressible as a count. They were found by running the
   system, and only by running it.
7. **There is no test for any of this.** [long-running-job-progress](./long-running-job-progress.md)
   R4 measured that `src-tauri/tests/` contains **zero** matches for
   orphan / interrupted / recover / restart / zombie. Confirmed here for
   `sweep_zombie_executions` specifically: it has no test at all, and
   `test_claim_expired_is_reclaimable` (`executions.rs:2110-2130`) passes only
   because **the test performs the requeue itself** — it calls
   `update_status(…, Queued)` at `:2119`, the exact step production does not
   have.

## Prefer a type over a gate

Held against all seven qualifications. **The honest answer for this leaf is that
two different types are needed for two different halves, and one of them is
already written and unused.**

The measured facts to design against: `ExecutionState::TERMINAL` exists, has a
build-failing coverage test, and has **0 production references**; the terminal set
is hand-spelled at **22** sites on one table (14 of them wrong) and **108** times
tree-wide in **62** spellings; and the reaping decision is made from a constant
while the liveness column sits unread.

**Proposal A — withhold the string, for the SET.** Adapted from
[retention-and-pruning](./retention-and-pruning.md)'s `RetentionScope`, which is
the same shape for the delete side and should be the *same type*:

```rust
/// A terminal-status SQL fragment. No public field, no `From<&str>`,
/// no constructor that takes a status list.
pub struct TerminalSet { sql: String }
impl TerminalSet {
    pub fn of<S: Lifecycle>() -> Self { /* derived from S::TERMINAL */ }
    pub fn active_of<S: Lifecycle>() -> Self { /* derived from S::ACTIVE */ }
}
```

**Proposal B — withhold the clock, for the REAP.** This is the one that has no
precedent anywhere:

```rust
/// Evidence that a worker is (or is not) alive. Obtainable only from a lease
/// or a heartbeat — there is no constructor that takes a duration.
pub struct Liveness<'a> { column: &'static str, cutoff: &'a str }
impl<'a> Liveness<'a> {
    pub fn lease_expired(now: &'a str) -> Self { … }             // claim_expires_at < now
    pub fn silent_for(beats: u32, interval: Duration) -> Self { … } // last_heartbeat_at < now - beats*interval
}
pub fn reap_abandoned<S: Lifecycle>(pool: &DbPool, table: &str, l: Liveness<'_>, budget: RetryBudget)
    -> Result<ReapOutcome, AppError>;
```

Now the qualifications:

1. **A required prop carries only what it actually encodes.** ✔ and it is the
   reason there are two types. `TerminalSet` encodes "no further transitions"; it
   does **not** encode "safe to delete" (`DeadLetter` is terminal and must never
   be swept) and it does **not** encode "the worker is gone". Folding liveness
   into the terminal set would have the type carry a claim it cannot support —
   exactly the `successRateSource` failure.
2. **Requiredness is orthogonal to closedness.** ✔ Making `retention_days` or a
   status list a *required* parameter changes nothing; callers supply them
   happily and wrongly. What matters is that `persona_executions.status` carries
   a **closed** `CHECK` domain and `persona_events.status` does not — and the
   open one is the one that rotted (measured in
   [retention-and-pruning](./retention-and-pruning.md) P0). Closedness did the
   work.
3. **A type nobody constructs constrains nothing.** ✔ **This is the finding, it
   is the sharpest instance in the corpus, and the convergence sweep found it
   independently reinvented.** `ExecutionState::TERMINAL` is not a proposal — it
   is a shipped, tested, exemplary type with **zero production construction
   sites**, and the terminal set is hand-copied 108 times anyway.
   `ProcessSession` is the same failure at 382 lines. `claim_for_instance` is the
   same failure at the row level (5 test callers, 0 production, 0 of 2,188 rows).
   **Three primitives, all correct, all inert** — and `vibeman` has a fourth:
   a 135-line "Status Algebra" exporting `isTerminal`/`isActive` with **0
   production value-imports** (all 14 of its imports are `import type`) against
   ~73 literals, plus a Rust state machine with 0 callers. Two codebases, two
   languages, the same shape.
   So the qualification does not merely apply here — it *decides the design*: a
   type at the *repo-function* boundary would be constructed at the handful of
   sites that already behave, and would not reach the 14 that do not. Both
   proposals therefore live where the statement is assembled
   (`TerminalSet::of::<ExecutionState>()` is the only way to get the fragment)
   and where the reap is issued (`reap_abandoned` is the only door), not one
   level up. **The lesson the sibling supplies is that availability is not
   adoption**: `vibeman` made the right helper importable and got 0 uses, so a
   `TerminalSet` that merely *exists* beside the old `&str` path will land in the
   same place. It has to be the only door.
4. **A type anyone can construct authenticates nothing.** ✔ Both structs have
   private fields and no string constructor. `Liveness` is the load-bearing one:
   its whole value is that **there is no `Liveness::after(Duration)`**. If you
   could construct it from a duration, it would be `DEFAULT_ZOMBIE_THRESHOLD_SECS`
   with extra steps. Note the counter-example from the family: `brainiac`'s
   `queue::Job` hands the worker a struct with all-`pub` fields, which a caller
   can fabricate — a `Claimed<T>` token is weaker than withholding the
   constructor.
5. **Withholding beats requiring.** ✔ Requiring a reaper to take a threshold
   parameter is what the code already does in effect, and it produced four
   unrelated constants. Withholding the *ability to express a threshold at all*
   is the entire win.
6. **Withhold the dangerous freedom, not the answer.** ✔ The dangerous freedom is
   **deciding aliveness from elapsed time**, and **writing a status set as text**.
   Neither is the answer the caller needs: the answer — "which rows are
   abandoned", "which statuses are terminal" — remains fully available through
   `Liveness::lease_expired(now)` and `TerminalSet::of::<S>()`. Withholding
   `started_at`-based reaping does not break any legitimate reaper, because a
   legitimate reaper has a lease or a heartbeat; the two that do not
   (`reap_stuck_processing_events`, `expire_stale_non_terminal`) reap on
   *inactivity of the row itself*, which `Liveness` can express as a third
   constructor without admitting a raw duration.
7. **Withholding a requirement only helps when the requirement was forcing the
   bad value.** ✔ Directly applicable, and it rules out the obvious alternative.
   Nobody *forced* `sla.rs:64` to filter by status — it has no status parameter;
   the list is welded into a `prepare` literal inside the function body.
   Relaxing any signature is inert. **The construction is what must be
   withheld.** Same for the reaper: `sweep_zombie_executions` takes only a
   `&DbPool`; the 30 minutes is a `const` in the same file. There is no parameter
   to relax.

**Does the type reach the code?** *Partially, and the boundary is worth naming.*
`prepare_cached` takes `&str`, so `TerminalSet` can interpolate its fragment and
nothing stops the next author typing the literal directly — §9 is the half the
type cannot supply. `Liveness` reaches further: there are only ten reapers and a
`reap_abandoned` door would be a compile error to bypass at all ten. And one
thing **no type reaches at all**: the choice between `failed` and `incomplete`
(D1). Both are legal `ExecutionState` variants, both are terminal, both compile.
That decision is a *policy about meaning*, and the only instrument that can hold
it is a doc comment on the enum variant plus a test asserting that every recovery
path writes the same one.

**Fix order:** (1) D2 by hand — 14 one-line edits, because the metrics are wrong
today; (2) `TerminalSet` + the D1 unification; (3) `claim_for_instance` adoption
+ the requeue (D5), which makes `Liveness` constructible; (4) `reap_abandoned`;
(5) keep §9's rule as the ratchet until (2) lands, then delete it.

## 9 The missing gate

**The condition, stated stack-free:** *a query decides whether a unit of work is
finished by naming a hand-written SUBSET of its terminal states — so work that
ended in an unnamed terminal state is counted as neither finished nor unfinished,
and simply disappears from the answer.*

An adopting repo must re-derive its own proxy. This one keys on a
rusqlite/SQLite `status IN ('…')` membership test bound to `persona_executions`;
a repo on Prisma spells the identical condition as
`where: { status: { in: ['COMPLETED','FAILED'] } }` and a Mongo repo as
`$in`, and **this pattern scores a structural zero in all of them while the
condition is present at scale** — the sibling sweep found every one of the five
repos spelling its terminal set by hand at every site (clause 4).

**Where it runs:** `npm run census` / `npm run census:check`, which the
pre-push hook and `npm run check`'s successors invoke locally. Explicitly **not**
a CI-only gate: `ci.yml` has **0 successes in 260 all-time runs**, so a gate that
runs only there runs nowhere.

### Existing rules checked first, by reading each definition rather than its title

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| `retention-delete-by-status-allowlist` (`retention-and-pruning.md`, 3/3) | a **`DELETE`** whose eligibility is a positive status list **and** which carries a time cutoff | The nearest neighbour, and **disjoint by construction**: it requires `DELETE FROM`; all 14 matches here are `SELECT`/`INSERT…SELECT`. Verified: zero match-position overlap with the gate. Its `executions.rs:1964` match *does* coincide with one of my **positive control's** 8 — disclosed, and harmless, because a control is not a gate. |
| `blind-identity-write` (`repository-crud-surface.md`, 35/82) | a `Result<()>` repo fn reaching a write whose entire `WHERE` is `id = ?N` | Write-side, single-row, and about the affected-row count. No `SELECT`, no membership test. |
| `discarded-guard-verdict` (`conditional-write.md`, 7/11) | a guarded single-row `UPDATE` in statement position | About what happens to the `usize`. Disjoint verb and disjoint concern. |
| `unswept-job-registry-read` (`long-running-job-progress.md`, 6/9) | an in-memory `*_JOBS` map read without a sweep | The closest *conceptual* neighbour and it keys on an in-memory `HashMap`, not on SQL. No overlap in files or matches. |
| `unraced-loop-wait` (`background-loop.md`, 12/13) | a `loop { tick() }` with no cancellation race | Scheduling, not state. |
| `unverified-effect-dispatch` (`post-write-side-effects.md`, 60/162) | `let _ = …emit(…)` | Would catch D7's `let _ = update_status(…)` shape only if it were an emit. It is not. |
| `untimed-repo-query`, `silent-row-skip`, `unverifiable-conflict-clause`, `constraintless-table-declaration` | timing, row-mapping, INSERT conflicts, test DDL | Unrelated. |

**None of the 96 existing rules keys on a status membership test in a read
predicate.** Only three mention `DELETE`; none mentions `IN (`. Proposing one.

### Measurement

**Precision 14/14 — every match opened and read.** The population is the **22**
positive `status IN (…)` membership tests bound to `persona_executions`; the
anchor sees all 22 and partitions them **14 violating / 8 compliant, with no
residual** (14 + 8 = 22 exactly).

Three independent implementations:

| implementation | violating | compliant |
| --- | ---: | ---: |
| Rust lexer, literal-scoped, vocabulary-filtered | 14 | 8 |
| raw-offset scanner over whole file content, brace-matched `#[cfg(test)]` | 14 | — |
| the census engine, from the published pattern | **14** (6 files) | **8** (5 files) |

A **fourth** implementation — statement-scoped, requiring `persona_executions`
inside the enclosing `SELECT`/`UPDATE` — returned **11**, and the disagreement is
a finding: it missed `metrics.rs:354`, `triggers.rs:1621` and
`approval_exec_fleet.rs:71`, where the membership test sits in an outer
`SUM(CASE …)` and the table is named in a **subquery underneath it**. All three
are real, all three were hand-verified, and all three are the sites that
additionally name statuses the `CHECK` forbids. **The stricter instrument
under-counted by 21% and it lost exactly the worst cases** — the
vocabulary/scope lesson from the doctrine, reproduced.

**Contamination: zero.** All 14 verified against brace-matched `#[cfg(test)]`
ranges by an independent scanner, plus a `*_tests.rs` filename rule. Structural
reason: these are aggregate/reporting queries in repo and command modules; test
modules here build fixtures with `INSERT`, not with terminal-set membership
tests.

**Backtracking:** the fill is `[^"]{0,600}?` — a bounded lazy quantifier over a
single negated character class, with no nested quantifier. Full 963-file run:
**0.74 s**. Matched-span length min 80 / median 130 / max 445, against an
implicit bound of one Rust string literal (`[^"]` cannot cross one).

**Validated standalone** in a composer-private registry
(`registry-terminal-state-composer.json` — a filename unique to this composer,
because sibling composers share the scratchpad), then **re-extracted from this
finished document and re-run: `files 6 / matches 14` and `files 5 / matches 8`,
identical both times.**

### The rule

```json
{
  "rules": [
    {
      "id": "partial-terminal-status-set",
      "goldenPath": "docs/concepts/golden-paths/terminal-state-and-recovery.md",
      "title": "A query asks whether a unit of work is finished by hand-writing a SUBSET of its terminal states, so work that ended in an unnamed terminal state vanishes from the answer instead of counting.",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "(?:persona_executions[^\"]{0,600}?\\bstatus\\s+IN\\s*\\(\\s*(?:'(?:completed|failed|cancelled|error|timeout)'\\s*,\\s*){0,4}'(?:completed|failed|cancelled|error|timeout)'\\s*\\)|\\bstatus\\s+IN\\s*\\(\\s*(?:'(?:completed|failed|cancelled|error|timeout)'\\s*,\\s*){0,4}'(?:completed|failed|cancelled|error|timeout)'\\s*\\)[^\"]{0,600}?persona_executions)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A `status IN ('...')` membership test bound to persona_executions (in either order - the table may be named before the test, or below it in a subquery) whose value list is drawn ONLY from {completed, failed, cancelled, error, timeout} and therefore CANNOT contain 'incomplete'. PROXY FOR the stack-free condition: a query decides whether a unit of work is finished by naming a hand-written SUBSET of its terminal states, so work that ended in an unnamed terminal state is counted as neither finished nor unfinished and simply disappears from the answer. THE OMITTED STATE IS NOT ARBITRARY: ExecutionState::TERMINAL (core/src/types.rs:41) is {completed, failed, incomplete, cancelled}, the column's CHECK constraint admits exactly {queued, running} plus those four, and 'incomplete' is the state the zombie sweep writes (db/src/repos/execution/executions.rs:1838) when work is abandoned by a dead process - so every match is a query that is blind to precisely the rows the state was created for. MEASURED 2026-08-15 at 8766c6c41 against a READ-ONLY COPY of the operator's live personas.db: 14 matches across 6 of 963 .rs files, ALL FOURTEEN OPENED AND READ (precision 14/14), commentMatchesSkipped 0. Of 2188 live executions, 20 are 'incomplete' and EVERY ONE of them was written by sweep_zombie_executions ('Execution stalled: ...'), i.e. in this database 'incomplete' means exactly 'we lost track of it' and nothing else. The 14 matches are the app's ENTIRE reliability surface: sla.rs:64 (per-persona success rate), :109 (daily reliability), :344 (SLA dashboard aggregate), :376 (P95 duration), :651 (the sla_daily rollup that OUTLIVES execution retention, so the exclusion is baked in permanently), :764 (daily-trend fresh head), :983 (get_persona_breach_signal - the consecutive-failure ALARM, which therefore cannot see an abandoned run); personas.rs:1469 (compute_trust_score's success-rate half - whose OWN FUNCTION at :1501 uses the COMPLETE set for monthly spend 32 lines later, so a lost run is billed and never counted against the score); metrics.rs:354 (get_recent_error_rate), :1022 (prompt performance), :1192 (execution dashboard); triggers.rs:1621 (get_health_map - a trigger whose last three runs were all abandoned reports 'healthy'); approval_exec_fleet.rs:71 (the fleet numbers Athena reasons about); runner/mod.rs:3030 (the guard on posting a run's output message). LIVE IMPACT, replayed: global success rate reads 89.01% under ('completed','failed'), 88.93% under ('completed','failed','cancelled') and 88.12% under the complete set - a 0.90-point spread from the choice of literal alone; 15 of 78 personas are overstated, by up to 9.1 points, and two display 100.0% while carrying lost runs. THREE MATCHES ALSO NAME A STATUS THE COLUMN CANNOT HOLD: metrics.rs:354 and triggers.rs:1621 name 'error', approval_exec_fleet.rs:71 names 'error' AND 'timeout'; the CHECK constraint admits neither, so those SUM(CASE ...) branches have always evaluated to 0 - the author believed they were being thorough. POSITIVE CONTROL: partial-terminal-status-set-positive-control, the IDENTICAL anchor requiring all four terminal values, matches 8 files-5 / matches-8 with ZERO match overlap by construction (the two value alternations are disjoint: one cannot contain 'incomplete', the other requires it). 14 + 8 = 22 accounts for EVERY positive status-membership test bound to persona_executions in the tree - there is no third population, so the partition is exact rather than a ratio. FOUR INDEPENDENT IMPLEMENTATIONS: a string/comment-aware Rust lexer, a raw-offset scanner, and the census engine all returned 14; a fourth, statement-scoped implementation returned 11 and MISSED metrics.rs:354, triggers.rs:1621 and approval_exec_fleet.rs:71, where the membership test sits in an outer SUM(CASE ...) and the table is named in a subquery BELOW it - the stricter instrument under-counted by 21% and lost exactly the three worst cases, which is why the published pattern matches in BOTH directions. CONTAMINATION: zero of the 14 sit inside a #[cfg(test)] module, verified by an independent brace-matched range scanner plus a *_tests.rs filename rule (dev_tools_backlog_tests.rs carries no #[cfg(test)] attribute at all, so a range scan alone cannot see it). Test modules here build fixtures with INSERT, not with terminal-set membership tests. BACKTRACKING: the fill is [^\"]{0,600}? - a bounded lazy quantifier over a single negated class, no nesting; full 963-file run 0.74s; matched span min 80 / median 130 / max 445 chars against an implicit bound of one Rust string literal. DOES NOT OVERLAP retention-delete-by-status-allowlist, which requires DELETE FROM and a time cutoff - verified zero match-position overlap (its executions.rs:1964 hit coincides with one of this rule's POSITIVE CONTROL matches, which is not a gate). Nor blind-identity-write / discarded-guard-verdict (write-side, about the affected-row count), nor unswept-job-registry-read (an in-memory HashMap, not SQL), nor unverified-effect-dispatch (emit). None of the 96 existing rules keys on a status membership test in a READ predicate. LEGAL FIX, one line each: add 'incomplete' (and drop 'error'/'timeout'), or better, derive the fragment from ExecutionState::TERMINAL - which exists at core/src/types.rs:41 with a coverage test at :800 that FAILS THE BUILD on an unclassified variant, and which has ZERO production references (all 6 occurrences on 5 lines sit inside its own #[cfg(test)] module). Do NOT silence a match by splitting the list across two Rust string literals, by moving it into a const &str, or by renaming the column alias - all three preserve the defect exactly and merely hide it from this signal; the honest fix always removes the hand-written subset. PRECONDITION (must be re-derived per repo): this repo executes SQL through rusqlite with statements as string literals, spells the work table 'persona_executions', and spells its abandoned state 'incomplete'. All five sibling repos (personas-web, brainiac, personas-cloud, vibeman, ascent) spell their terminal set by hand at every site, so this pattern scores a structural zero in every one of them while the condition is present at scale - and TWO of them exhibit the exact defect through a different surface: personas-web's DB admits 'incomplete' and src/lib/supabaseApi.ts:75 collapses it with `if (s === \"incomplete\") return \"failed\"`, and brainiac documents dead-vs-failed in a 15-line module doc, tests it, then collapses it at brainiac-server/src/http.rs:1417. An adopting repo must key on its own read-mapper or ORM predicate, not on this SQL shape. END OF LIFE: this rule is designed to reach zero. When it does the runner fails structurally on zero-matches, BY DESIGN - DELETE the rule then, do not baseline it at 0.",
        "$measured": "2026-08-15 @ 8766c6c41 — 963 .rs files walked; four independent implementations, three agreeing at 14/14 and the fourth's 11 diagnosed above; every match hand-read; live counts replayed against a read-only copy of personas.db (2,188 executions, 20 incomplete, 74 boot-recovered failures)."
      },
      "baseline": { "files": 6, "matches": 14 },
      "floor": 900
    }
  ]
}
```

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "partial-terminal-status-set-positive-control",
  "goldenPath": "docs/concepts/golden-paths/terminal-state-and-recovery.md",
  "title": "POSITIVE CONTROL — the same membership test on the same table, naming the COMPLETE terminal set.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "(?:persona_executions[^\"]{0,600}?\\bstatus\\s+IN\\s*\\(\\s*(?:'(?:completed|failed|cancelled|incomplete)'\\s*,\\s*){3}'(?:completed|failed|cancelled|incomplete)'\\s*\\)|\\bstatus\\s+IN\\s*\\(\\s*(?:'(?:completed|failed|cancelled|incomplete)'\\s*,\\s*){3}'(?:completed|failed|cancelled|incomplete)'\\s*\\)[^\"]{0,600}?persona_executions)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL, not a gate. The IDENTICAL anchor as partial-terminal-status-set - the same table binding in both directions, the same membership test - with the value alternation changed to the four REAL terminal states and the repetition pinned at exactly four, so it matches only a COMPLETE terminal set. The two patterns are mutually exclusive BY CONSTRUCTION, not merely empirically: the gate's alternation cannot produce 'incomplete' and this one requires it. MEASURED 2026-08-15 at 8766c6c41: 8 matches across 5 files versus the gate's 14 across 6. PARTITION, NOT A RATIO: an anchor counting EVERY positive status-membership test bound to persona_executions matches 22, and 14 + 8 = 22 exactly, so every such test in the tree is classified and there is no unexamined third population. The 8 compliant sites are personas.rs:1501 (monthly spend inside compute_trust_score - 32 lines below that function's own VIOLATING success-rate query at :1469, which is the single sharpest artifact in this golden path: one function, one table, two spellings, and the complete one is the one that BILLS you), executions.rs:1929/1946/1964/2019 (cleanup_old_executions' retention scan and its siblings), policy_evidence.rs:45, baselines.rs:157 and execution_review.rs:197. Note that executions.rs:1964 is ALSO matched by retention-delete-by-status-allowlist; that is a control, not a gate, so no double-gating occurs. Its purpose is to demonstrate that the gate discriminates on WHICH statuses are named and not on the tokens `status`, `IN` or `persona_executions`, all of which the compliant population carries identically: 36% of this repo's terminal-set membership tests on this table are complete and 64% are not. If this control's count ever collapses toward zero while the gate's holds, the shared anchor has broken and BOTH numbers are meaningless - that is the failure this control exists to make visible. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved; the census engine exempts a `-positive-control` id from the baseline requirement and the registry merge skips it by construction.",
    "$measured": "2026-08-15 @ 8766c6c41 — validated standalone in a scratch registry, then re-extracted from this document and re-run; 5 files / 8 matches both times."
  },
  "floor": 900
}
```

### Gates I rejected, with numbers

| candidate | violating | compliant | why rejected |
| --- | ---: | ---: | --- |
| **a reaper whose predicate is elapsed-time-since-start with no liveness term** | 9 | **1** | The condition is the *thesis* of this document and it is nearly unanimous, so there is almost no compliant form to point at — `claim_for_instance`'s lease predicate is the only one, and it has zero production callers. A gate firing on 90% of a 10-member population is a to-do list, not a ratchet, and its positive control would match one site and be one refactor from a structural zero. Carried as §2(a) and D5, enforced by review. |
| **`EXECUTIONS_SILENT_DETECTED` has no listener** | n/a | n/a | An **absence**. The census counts presences; "no file anywhere registers this event name" has no signal. Carried as D9. This is the same limit `retention-and-pruning` §9 recorded, and it bounds every largest finding in this document. |
| **a hand-rolled client terminal set** (`['completed','failed', …]`) | 73 | 11 | Precision is the problem, not volume: many of the 73 are legitimately about a *different* entity's lifecycle (build phases, task statuses, lab runs, remote jobs), each with its own correct terminal set, and no regex separates "a wrong execution-status set" from "a right build-phase set" — they are the same characters. A gate here would fire on correct content at scale. Carried as D4 with its call sites named. |
| **`ProcessSession` has no implementor** | 1 | 0 | One match, and it is an absence dressed as a presence. Carried as D6. |
| **a status literal naming a value the column's CHECK forbids** | 3 | — | The right condition and the census cannot express it: the `CHECK` lives in a migration file and the literal in a repo function, and Gap 2 explains why no regex can join them. Folded into the main rule instead — all three sites are already matched by it, for the adjacent reason. |

The second row is worth restating as the limit of this mechanism: **every one of
this document's three largest findings — the unread heartbeat, the unwired
claim, the two-reaper split — is a statement about something that does not
happen, and none is gateable by counting.** They were found by replaying the
system against its own data, which is the only instrument that sees them.

## 12 Corrections to the brief

The brief's primed leads came from [conditional-write](./conditional-write.md),
which was composed at `2a874e692`; `master` is now `8766c6c41`.

1. **"`sweep_zombie_executions` … discards the verdict and fires the user-facing
   consequence anyway" — FIXED, and the brief's own corpus fixed it.**
   `executions.rs:1862-1868` now reads `if swapped == 0 { … continue; }` with a
   comment that transcribes conditional-write's D1 almost verbatim. It landed in
   `e611c326d` ("batch 26"). Anyone re-citing that defect should stop.
2. **"`ExecutionState::TERMINAL` … has 5 references, all inside its own test
   module" — the count is off; the conclusion is stronger than stated.**
   Measured: `::TERMINAL` has **3** occurrences (`types.rs:803`, `:812`, `:826`)
   and `::ACTIVE` **3** (`:803`, `:814`, `:840`) — **6 occurrences on 5 distinct
   lines**, which is where "5" came from. All are inside the `#[cfg(test)]`
   module beginning at `:791`. **Production references: 0.** But the brief (and
   `retention-and-pruning`) framed this as "the concept is unused", and that is
   not right: `is_terminal()` has **20 production call sites** and `is_active()`
   2. What is unused is specifically **the set**, because there is no way to get
   a set into a SQL string. That distinction changes the fix (a fragment
   constructor, not a helper) and it is why *Prefer a type over a gate* proposes
   `TerminalSet` rather than "call `is_terminal` more".
3. **"106 production `status IN (…)` literals in 57 distinct spellings" — remeasured
   as 108 / 62, and the instrument matters.** A string/comment-aware Rust lexer
   restricted to SQL-shaped literals finds **108** positive membership tests plus
   **22** `NOT IN` (130 total production), in **62** distinct positive spellings.
   A looser raw-offset scanner over whole file content finds **114 / 63** — the
   extra 6 are occurrences inside comments and non-SQL literals. I report the
   lexer figure and disclose the disagreement; either way the brief's figures are
   in the right neighbourhood and slightly low.
4. **"three [spellings] for the execution set alone" — it is four, and the fourth
   is the interesting one.** `('completed','failed','incomplete','cancelled')` ×8,
   `('completed','failed','cancelled')` ×5 positive, `('completed','failed')` ×7,
   **and `('failed','error')` / `('failed','error','timeout')` ×3** — which name
   statuses the column's `CHECK` cannot hold. Those three sites were invisible to
   a spelling-count that only looked for real statuses.
5. **"the four reapers" — there are ten**, and the classification matters more
   than the count. Beyond `events::reap_stuck_processing`,
   `automations::reap_stale_runs`, `sweep_zombie_executions` and
   `deliberation::reap_action`, the tree has
   `build_sessions::expire_stale_non_terminal` (the only one with a *negative*
   predicate), `manual_reviews::gc_stale_pending`, `dev_tools::archive_stale_ideas`,
   the healing `auto_fix_pending` reset, `night_shift::expire_stale_proposed`,
   and the `companion_proactive_message` expiry trio. Also: `reap_action` is not
   a staleness reaper at all — it polls an execution and never tests age, which
   is why 3 deliberations have sat at `action_running` for 50 days (D10).
6. **"On restart, what reconciles rows that claim to be running…?" — the brief
   asks as though nothing does. Something does, and its existence is the
   finding.** `ExecutionEngine::recover_stale_executions` (`engine/mod.rs:703`)
   marks every `running` row `failed` at boot, and
   `requeue_persisted_executions` (`:748`) re-admits `queued` rows so scheduled
   work survives a restart — both good, both documented, both tested by nobody
   ([long-running-job-progress](./long-running-job-progress.md) R4). **The defect
   is not absence; it is that this path and the zombie sweep disagree about what
   to write** (D1), and that boot recovery has no instance predicate (D7).
7. **"the lease cannot rearm … `ExecutionState::Queued` reaches `update_status`
   at exactly two sites, both tests" — CONFIRMED exactly**, and one nuance is
   worth adding: `claim_for_instance`'s doc comment has since acquired a
   reference to a *"crash-recovery re-queue"* (`executions.rs:972`) describing a
   `running → queued → running` cycle. No such path exists;
   `requeue_persisted_executions` re-admits rows that were **already** `queued`
   and never writes that status. The comment now asserts the mechanism twice.
8. **"How does a user-visible surface distinguish 'failed' from 'we lost track of
   it'?" — the answer is "in one place, and not in the others."** The
   `ZOMBIE_EXECUTIONS_DETECTED` bridge (`eventBridge.ts:326`) finishes the
   *active* execution as `incomplete` with a real message; the *background*
   execution path (`usePersonaExecution.ts:317`) collapses it to `failed`; and
   the executions list's "rerun failed" filter cannot see it at all (D4). The
   client primitive that should settle this — `executionState.ts` — is genuinely
   good and is used at 13% of the sites that need it.
9. **The leaf is `twoSided: true`** in `situation-spine.json:1015`, though
   the brief carried only `sides: server`. Both halves are stated: the server owns
   *which* terminal state is written and from what evidence; the client owns
   whether that state survives to the user; the contract between them is
   `TERMINAL_STATES` in `executionState.ts:42` ≡ `ExecutionState::TERMINAL` in
   `types.rs:41`, pinned by `terminal_set_matches_expected` (`types.rs:824`) —
   the one place in this whole document where the two sides are actually held
   together, and it works.
