# Golden path — Job claim and lease

> Situation node: `backend-runtime/job-coordination/job-claim-and-lease` ·
> [situation spine](../situation-spine.md) · recurrence 13 · risk **HIGH** ·
> sides: **server** · convergence: **mixed** ·
> dimensions: **function · resilience · cost**
> merged from *Idempotent claim and lease*, *Atomic job claim*.
> Composed 2026-08-15 against `master` @ `bbb1a8864`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri` (agrees with
> [`shared-facts.json`](../shared-facts.json) `rust.files`), lexed with a
> string/comment-aware Rust tokenizer rather than grepped: **83,759** string
> literals — byte-identical to the count
> [terminal-state-and-recovery](./terminal-state-and-recovery.md) reported, which
> is the instrument agreeing with a sibling composer's before either number was
> used. **5,711** of those literals hold SQL (**4,850** production, **861** inside
> **brace-matched** `#[cfg(test)]` ranges — never a line threshold — plus a
> `*_tests.rs` filename rule, because `dev_tools_backlog_tests.rs` carries no
> `#[cfg(test)]` attribute at all). Every one of the **53** production
> state-transition CAS statements was extracted by a **vocabulary-free** second
> implementation and classified by hand; all **8** durable claim sites, all **15**
> `InflightGuard` statics, `inflight_guard.rs`, `oauth_refresh_lock.rs`,
> `daemon/lock.rs`, `leadership.rs`, `cloud/remote_commands.rs`,
> `cloud/sync/client.rs` and both `pop_next_queued` copies were opened and read
> in full.
>
> **Measured by execution, not by reading.** **Eight** claim shapes were replayed
> against a real scratch SQLite file (`node:sqlite`), every statement transcribed
> **verbatim** from this tree: the two-worker double-claim, the crash-mid-claim,
> the TTL lease's failure to rearm, the one-word fix that makes it rearm, the
> `INSERT OR IGNORE` claim under contention, the one-way latch, the read-then-write
> across the network boundary, and the `changes()` semantics that make any of it
> work. Read-only **copies** of the live `personas.db` (347 MB) and
> `personas_data.db` were queried — copied first, `readOnly: true`, the live files
> never opened for write while the app was running (`engine-leader.lock`'s
> heartbeat was 30 s old at copy time).
>
> **`cargo` was not run** (the operator's app is running). Every Rust claim is
> static and traces to a file read during composition.
>
> ---
>
> ## The headline: this repo takes work correctly 8 times out of 8, and can give it back once
>
> There are **8 durable claim sites**. Every one of them is a real
> compare-and-set, and **every one of them reads its own verdict** — 8/8, 100%.
> That deserves saying first, because it is better than three of the five sibling
> repos and it means the hard part is already right here.
>
> Then look at the other three columns.
>
> | # | claim site | mechanism | reads verdict | **lease** | **release on failure** | **rearm after the claimant dies** |
> | --- | --- | --- | :-: | :-: | :-: | :-: |
> | 1 | `events.rs:243` `claim_pending` | `UPDATE … RETURNING` | ✅ the set *is* the count | ❌ | ✅ | ✅ requeue + retry ceiling |
> | 2 | `events.rs:270` `claim_pending_headless` | `UPDATE … RETURNING` | ✅ | ❌ | ✅ | ✅ |
> | 3 | `executions.rs:976` `claim_for_instance` | CAS **+ TTL lease** | ✅ `Ok(rows > 0)` | ✅ | ❌ | ❌ **cannot** (§7 D1) |
> | 4 | `chat_cards.rs:224` `claim_for_dispatch` | CAS | ✅ `changed == 1` + re-read | ❌ | ✅ `release_claim` | ❌ |
> | 5 | `jobs/mod.rs:324` `pop_next_queued` | SELECT → CAS | ✅ `updated == 0` | ❌ | ❌ | ❌ boot-only, terminalises |
> | 6 | `persona_jobs.rs:214` `pop_next_queued` | SELECT → CAS | ✅ `updated == 0` | ❌ | ❌ | ❌ boot-only, terminalises |
> | 7 | `deliberation.rs:260` `claim_capability` | `INSERT OR IGNORE` | ✅ `Ok(n == 1)` | ❌ | ❌ | ❌ **no statement exists** |
> | 8 | `audit_incidents.rs:554` `claim_continuation` | one-way latch | ✅ `Ok(rows > 0)` | ❌ | ❌ | ❌ human-only |
> | | **totals** | | **8/8** | **1/8** | **3/8** | **2/8** |
>
> **The exclusivity is solid and the reversibility is not.** Taking work is a
> single statement a reviewer can see; giving it back is a *second statement in
> another function that may not exist*, and a reviewer cannot see an absence.
> Every defect in §7 is on the right-hand side of that table.
>
> Five findings are sharper than the ratio.
>
> ### 1 — the lease cannot rearm, and one word fixes it
>
> `claim_for_instance` (`executions.rs:954-991`) is the only lease in the tree.
> Its doc comment (`:944-946`) reads *"The TTL-in-`WHERE` doubles as the
> stale-claim sweep: an expired claim is simply re-claimable, so no separate
> reaper task is needed."* **Replayed against real SQLite, transcribed verbatim:**
>
> ```
> instance-A claims:                                   changes = 1   (wins)
> instance-B claims while the lease is live:           changes = 0   (correct)
> >>> instance-A dies. Advance the clock past the lease.
> instance-C re-claims the EXPIRED lease:              changes = 0   <-- ZERO
> ```
>
> The predicate requires `status = 'queued'`; a dead claimant leaves `running`,
> which it can never match. The claim is not merely unswept — it is **unreachable**.
> Then, changing exactly one term:
>
> ```
> ... AND status IN ('queued','running') ...            (the one-word fix)
> instance-B while the lease is LIVE:                  changes = 0   (still no double-claim)
> instance-A dies, lease expires, instance-B claims:   changes = 1   <-- REARMS
> ```
>
> **The mechanism that was missing was one word in a string, not a reaper.** That
> is the same wall every path in this territory hits from the other side: the
> safety lives in a `WHERE` clause and reads like bookkeeping.
>
> ### 2 — the lease has *four* legs, and this repo has one
>
> [conditional-write](./conditional-write.md) Gap 3 states that a lease is three
> things — an expiry column, a predicate that admits expired rows, and a sweep
> that restores the pre-claim state. Measuring the renewal path adds a fourth, and
> it is the one nobody names:
>
> | leg | present? | evidence |
> | --- | :-: | --- |
> | an expiry column | ✅ | `claim_expires_at` (`incremental.rs:3623`), also on `build_sessions` (`:3640`) |
> | a predicate that admits an expired claim | ❌ | replayed above — `status = 'queued'` excludes every dead claimant |
> | a sweep that restores the pre-claim state | ❌ | **nothing in production writes `status = 'queued'`** |
> | **a renewal that extends the lease while work continues** | ❌ | `touch_last_heartbeat` (`executions.rs:1461`) has **exactly one caller** (`runner/mod.rs:2122`) and **does not touch `claim_expires_at`** |
>
> The fourth leg matters because fixing only the second creates a new bug: with
> `status IN ('queued','running')` and no renewal, any run longer than the TTL is
> stolen from a *healthy* worker. **The rearm and the renewal are one change.**
>
> ### 3 — the fencing token is written by one statement and read by none
>
> `claimed_by_instance` occurs **12 times** in 963 files. Four are migrations, two
> are schema DDL, three are doc comments, one is a cloud-sync denylist test — and
> **two are inside `claim_for_instance`'s own statement**, one in the `SET` and one
> in its own predicate (`claimed_by_instance IS NULL`).
>
> **No write anywhere asks "am I still the claimant?"** `update_status_if_running`
> guards on `status = 'running'` and nothing else (`:931`). So the moment a lease
> *can* be stolen (finding 1's fix), the previous owner can still finish and stamp
> its result over the new owner's. The column that would prevent that exists, is
> indexed by the same migration, and has never been read. Live: **0 of 2,188**
> executions and **0 of 12** `build_sessions` have ever carried it.
>
> This is not a local omission. The convergence sweep found fencing reinvented
> **once in six repos**, in memory, by `ascent` — which documents it as *"the
> fencing-token guard against the classic expired-lease self-release footgun"* —
> and **absent from every durable claim in all six**, including `ascent`'s own.
>
> ### 4 — the double-claim guard the app actually relies on is a `HashSet` in RAM
>
> `InflightGuard` (`engine/src/inflight_guard.rs`) is the **most adopted claim
> primitive in the repo by an order of magnitude**: 15 statics, 18 `.guard()` call
> sites, RAII release on `Drop`, and a test that proves the key is released on a
> **panic unwind**. It is genuinely good and it is the right answer *within one
> process*. `claim_for_instance` — the only durable claim with a lease — has **0**
> production callers.
>
> **The repo's best claim primitive cannot survive a restart, and its most correct
> one has never run.**
>
> Where that boundary is crossed it is a live defect. `cloud/remote_commands.rs`
> polls a **remote** `pending_commands` queue every 15 s and its entire
> exclusivity guard is `static SURFACED: LazyLock<Mutex<HashSet<String>>>`
> (`:30`, inserted at `:159`, **never removed**). The row itself stays `pending` in
> the shared store. §7 D5.
>
> ### 5 — the transport cannot express a claim, so no caller can write one
>
> `remote_command_approve` (`remote_commands.rs:246-266`) reads the remote row,
> checks `if cmd.status != "pending"` **in Rust**, then PATCHes
> `pending_commands?id=eq.{id}` — **with no status filter** — and then spends money
> running an agent. Replayed:
>
> ```
> approval #1 GET -> 'pending'; the Rust check PASSES
> approval #2 GET -> 'pending'; the Rust check PASSES
> approval #1 PATCH -> 1 row -> execute_persona_inner(...) RUNS
> approval #2 PATCH -> 1 row -> execute_persona_inner(...) RUNS AGAIN
> ```
>
> Adding `&status=eq.pending` to the path makes it `1` and `0`. **But the caller
> could not read that either**: `SyncClient::patch`
> (`cloud/sync/client.rs:117-141`) hardcodes `Prefer: return=minimal` and returns
> `Result<(), AppError>`. The affected-row count is **structurally unavailable to
> every caller of the door**. This is the contract's fifth §9 failure mode —
> *a gate that points at a broken destination* — in its purest form: routing a
> developer to the shared transport hands them a door that **cannot spell a
> claim**. **0 of 7** production PostgREST mutating paths carry a state
> precondition.
>
> ### Sibling boundaries, settled in prose
>
> [**conditional-write**](./conditional-write.md) owns the CAS *mechanism* — the
> predicate in the `WHERE` clause and whether the caller reads the count. On that
> axis this leaf scores **8/8** and has nothing to add. **This path owns
> everything that must exist BESIDES the claim**: the lease, its renewal, the
> release, the rearm, and the fence. It confirms that document's D2/D8 by
> execution, extends its Gap 3 from three legs to four (finding 2), and corrects
> two of its factual claims (§12).
>
> [**terminal-state-and-recovery**](./terminal-state-and-recovery.md) owns *what a
> recovery pass writes* and how legible that state is. **This path owns what the
> worker wrote when it took the row**, which is what makes recovery possible or
> impossible. Its D5 and this document's D1 are the same defect seen from the two
> ends: it asks "why is the reaper guessing from a clock?", this asks "why is
> there nothing for the reaper to read?" The answer to both is the unwired claim.
>
> [**background-loop**](./background-loop.md) owns the tick's scheduling and
> cancellation. **This path owns what the tick does in its first three lines.**
>
> [**cancelling-in-flight-work**](./cancelling-in-flight-work.md) owns the
> deliberate stop. **This path owns the claim a stop must not strand.**
>
> [**upsert**](./upsert.md) owns insert-or-update as a merge; **this path owns
> `INSERT OR IGNORE` as an arbiter** — where the PRIMARY KEY elects the winner and
> `n == 1` means "you own it" (`deliberation.rs:266`, and the loser must be able to
> stop owning it).
>
> The **Deviations** section is a fix backlog and contains **three live
> user-visible defects** (D3, D4, D5) and one that costs money.

---

## 1 Trigger

- "Two workers could both pick this up — how do I make sure only one does?"
- "What happens to this job if the app is killed while it's running?"
- "How long should a worker hold this before someone else can take it?"
- "I claimed it, the work failed — how do I put it back?"
- "Can I just keep a set of in-flight ids?"
- "The other instance is doing this already, right?"

If you are about to type `claim`, `lease`, `_expires_at`, `claimed_by`,
`locked_by`, `owner`, `visible_at`, `pop_next`, `INSERT OR IGNORE` into a table
whose name ends in `_claims`, `SET status = 'running' … WHERE … = 'queued'`, or
`static X: LazyLock<Mutex<HashSet<String>>>` — you are in this situation.

**Not this path:** *whether the caller reads the affected-row count* is
[conditional-write](./conditional-write.md); *which terminal state a recovery
pass writes and whether anything downstream can see it* is
[terminal-state-and-recovery](./terminal-state-and-recovery.md); *the loop that
calls the claim* is [background-loop](./background-loop.md); *the user pressing
Stop* is [cancelling-in-flight-work](./cancelling-in-flight-work.md); *merging
two versions of a row* is [upsert](./upsert.md).

## 2 The one way

**Write the claim and its undo in the same commit, and make the undo something a
clock can perform without you.** Concretely: (a) **claim with one statement, not
two** — `UPDATE t SET status='running', claimed_by=?, claim_expires_at=? WHERE
id=? AND (status='queued' OR (status='running' AND claim_expires_at < ?now))
RETURNING *`; the `RETURNING` set *is* your verdict and there is no window
between choosing a row and taking it. (b) **The predicate that grants the claim
must be able to match a claim the predicate itself granted** — if you can write a
state your own claim cannot re-enter, you have built a latch, not a lease, and
the executed proof is finding 1. (c) **A lease you do not renew is a deadline you
will miss**: extend `claim_expires_at` from the same heartbeat that already
proves the worker is alive, or the fix in (b) starts stealing rows from healthy
workers. (d) **Fence the settle** — every write that records the outcome must
carry `AND claimed_by = ?me` (or at minimum the in-flight status), because the
whole point of a lease is that ownership can move, and a claimant that lost its
lease must not be able to stamp its result over the new owner's. (e) **Bound the
requeue with an attempt counter incremented ON CLAIM, not on failure** — a
crash-redelivery and a clean failure consume the same budget, and only the
claim-time increment sees both (`brainiac` `queue.rs:5-14, :137` writes this
argument down; nothing here does). (f) **An in-memory guard is legitimate for
in-process re-entrancy and for nothing else** — use `InflightGuard`, never a bare
`HashSet`, and never let it be the only thing standing between a user and a
duplicate charge. (g) **On the failure path, release explicitly** — an
`if let Err(_) = … { release() }` is better than nothing but it does not run on
`SIGKILL`, so the lease in (b) is what actually has to work. Then stop: do not
add a second reaper, do not add a mutex beside the write, and do not open a
transaction — the guarded statement is already atomic.

If you must get one right first: **(b)**. (a), (d), (e) fail loudly the first
time two workers race; (b) fails silently and permanently, and its own doc
comment will tell the next reader it is solved.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `db/src/repos/communication/events.rs:239` `claim_pending` / `:266` `claim_pending_headless` | **the one claim to copy.** `UPDATE … WHERE id IN (SELECT … WHERE status='pending' ORDER BY created_at LIMIT ?1) RETURNING *` — selection and claim in ONE statement, so there is no window and the returned set *is* the verdict |
| `db/src/repos/communication/events.rs:961` `reap_stuck_processing` | the only **rearm** in the tree: one `CASE` returns the row to `pending` until `retry_count` hits a ceiling, guarded on `status='processing'`, `RETURNING status` so the owning tick always wins the race. Copy the `CASE`, not just the idea |
| `db/src/repos/execution/executions.rs:954` `claim_for_instance` | the only **lease**. Adopt it — but land §7 D1's two-line fix and a renewal first, or you are adopting a latch |
| `src/engine/leadership.rs:100` `EngineLeadership` + `:70` `instance_id()` | the per-launch identity a claim needs. `is_leader()` is the coarse claim the job workers already use (`lib.rs:1387`) and it works |
| `src/daemon/lock.rs:57` `STALE_THRESHOLD` | a **working** heartbeat lease — `pid` + `hostname` + `heartbeat_at`, three missed beats to declare death. Live on disk right now. This is the shape `claim_expires_at` was supposed to have |
| `engine/src/inflight_guard.rs:70` `InflightGuard::guard()` | in-**process** exclusivity done right: RAII `Drop`, idempotent release, poison-recovering, and a test proving release on a **panic unwind** (`:116-127`). 15 statics, 18 call sites |
| `src/commands/companion/chat_cards.rs:222` `claim_for_dispatch` + `:253` `release_claim` | the only claim/release **pair** in the tree, and the release is itself guarded (`AND status='dispatched' AND result_json IS NULL`) so it cannot un-claim a settled row |
| `db/src/repos/resources/deliberation.rs:250` `claim_capability` | `INSERT OR IGNORE` used correctly *as an arbiter* — `Ok(n == 1)`, with the PRIMARY KEY named as the referee in the doc comment (`:246-249`). It needs a release (§7 D3) |
| `db/src/repos/execution/audit_incidents.rs:549` `claim_continuation` | the one-way latch done honestly: the claim is taken **before** any work, its `find_continuation_candidates` doc (`:523-525`) states the query may over-return *because* the claim arbitrates |
| `db/src/repos/resources/automations.rs:564` `reap_stale_runs` | the threshold **derived from the work's own retry + backoff budget**, with the constant-multiple heuristic rejected in the comment (`:550-563`). If you are typing a number, read this first |

**Do NOT build:** a bare `static X: LazyLock<Mutex<HashSet<String>>>` as a
single-flight guard (use `InflightGuard`); a third copy of `pop_next_queued`
(§7 D2); a claim table with no `DELETE` (§7 D3); a lease column without the
renewal and the rearm in the same commit (§7 D1); a `SELECT … FOR UPDATE`
(SQLite has none); a `BEGIN; SELECT; UPDATE; COMMIT` where one `UPDATE …
RETURNING` suffices; a settle write with an identity-only `WHERE` on a row you
claimed (§9).

## 4 Steps

1. **Decide whether the work outlives the process.** If it does not (a
   double-click, a re-entrant tick, an install), you want `InflightGuard` and you
   are done — go to step 8. If it does, you need a durable claim, and an
   in-memory set is not one. **Getting this wrong in the safe direction costs a
   little concurrency; wrong in the other direction costs a duplicate agent run
   (§7 D5).**
2. **Write the claim as ONE statement with `RETURNING`.** Copy
   `events.rs:243`. Do not `SELECT` a candidate and then claim it — that is two
   statements on a pooled connection, and the second copy of it in this repo was
   written by hand rather than shared (§7 D2).
3. **Put the lease in the same statement**, and write the predicate so it can
   match a row your own claim produced: `(status='queued' OR (status='running'
   AND claim_expires_at < ?now))`. **Replay it before you ship it** — claim,
   advance the clock, claim again, assert the second wins. That test is four
   lines and it is the one this repo does not have (§8 Gap 5).
4. **Ask whether the signature can make the wrong call impossible** — before you
   write the reaper, not after. See *Prefer a type over a gate*: a claim function
   that will not compile without a lease and an owner is cheaper than a rule that
   counts the ones that lack them.
5. **Wire the renewal to the liveness signal you already have.** If the worker
   heartbeats, the heartbeat extends the lease. If it does not heartbeat, the
   lease must be longer than the slowest legitimate run and you must say so in a
   comment, as `brainiac` does (`worker.rs:33-35`).
6. **Increment the attempt counter in the claim statement**, and terminalise only
   when it is exhausted — `SET retry_count = retry_count + 1, status = CASE WHEN
   retry_count + 1 >= ?N THEN '<terminal>' ELSE '<pre-claim>' END`. That is
   `reap_stuck_processing` transcribed, and it is what stops a poisoned row
   cycling forever.
7. **Fence every settle.** `UPDATE … WHERE id = ?1 AND claimed_by = ?2` — and
   read the count, so a refused settle is a `warn!` and not silence. **This is
   the step that fails**: 11 of this repo's 26 outcome writes are identity-only
   (§9).
8. **Write the release on the failure path in the same function** — and know
   what it does not cover. `if let Err(_) = … { release_claim() }` does not run on
   `SIGKILL`, a power loss, or a panic in another thread. It is a latency
   optimisation over the lease, never a substitute for it.
9. **And then stop.** Do not add a second reaper for the same table, do not add
   an in-memory set beside the durable claim, and do not open a transaction. If
   the claim came back zero, someone else has it; say so and move on.

## 5 Anti-patterns

- **A lease whose predicate cannot match an expired claim.** *Failure:* strictly
  worse than no lease, because the column, the migration and the doc comment all
  assert the problem is solved. **Executed: a re-claim of an expired lease
  returns `changes = 0`; the row is unreachable, not merely unswept.** §7 D1.
- **A claim column nothing reads.** *Failure:* the moment ownership can move, the
  old owner overwrites the new one, and the value that would have prevented it is
  sitting in the row. **Measured: `claimed_by_instance` appears in a `WHERE`
  clause exactly once, inside its own claim's predicate.**
- **A claim table with no `DELETE`.** *Failure:* a claimant that dies — or merely
  fails — suppresses the capability forever, for everyone. **Executed: the winner
  cannot even re-enter its own claim. Live: 10 claim rows, 3 held by
  deliberations that never reached a terminal state, the oldest 50+ days.** §7 D3.
- **A release only a human can pull.** *Failure:* it looks like a release path in
  review and it is not one. `audit_incidents` resets `continued_at` on `reopen`
  and `in_progress` (`:463`, `:486`) with an excellent comment explaining why —
  and nothing resets it when the continuation itself fails, which
  `incident_continuation.rs:313-320` logs and then walks away from. **Live: 33 of
  65 resolved incidents carry the latch.**
- **A boot pass standing in for a reaper.** *Failure:* a worker that dies without
  the process dying leaves the row in flight indefinitely, and a *second* process
  booting terminalises the *first's* live work. `recover_orphans` runs at
  `lib.rs:1375` — **13 lines before the leadership-gated worker loop it protects,
  and outside the gate** — and writes `failed`, never `queued`, so the job is lost
  rather than retried. §7 D2.
- **An in-memory set as the exclusivity guard for durable work.** *Failure:* it
  is empty after every restart and it does not exist on the other device.
  `SURFACED` (`remote_commands.rs:30`) guards a queue row that stays `pending` in
  a store shared across devices. §7 D5.
- **A state check in the host language above an unguarded write.** *Failure:* the
  check and the write are not atomic and never were. **Executed: two approvals
  both pass `if cmd.status != "pending"` and both PATCH successfully, and each one
  starts a real agent run.** §7 D4.
- **Two hand-written copies of one claim loop.** *Failure:* a fix to one is not a
  fix to the other, and it has already happened — `persona_jobs::request_cancel`
  (`:180`) gained a two-stage `queued → canceled` / `running → cancel_requested`
  pair; `companion/jobs` never did. §7 D2.
- **A loser that gives up instead of trying the next row.** *Failure:* throughput
  collapses under contention for no reason. **Executed: worker2 loses the CAS on
  `job_A`, returns `Ok(None)`, and the tick ends with `job_B` still queued.**
  `vibeman` `scanQueue.core.repository.ts:97-111` gets this right with a
  `for candidate of candidates` retry loop; both copies here do not.

## 6 Evidence

**The one site to copy: `db/src/repos/communication/events.rs:239-256`
`claim_pending`, read together with `:961-996` `reap_stuck_processing`.** They are
one design in two functions and neither is complete alone:

```sql
-- the claim (:243) — selection and taking in ONE statement
UPDATE persona_events SET status = 'processing'
 WHERE id IN (SELECT id FROM persona_events WHERE status = 'pending'
              ORDER BY created_at ASC, id ASC LIMIT ?1)
RETURNING *

-- the rearm (:961) — recovery is the default, termination is the bounded exception
UPDATE persona_events
   SET retry_count = retry_count + 1,
       status = CASE WHEN retry_count + 1 >= ?1 THEN 'dead_letter' ELSE 'pending' END,
       …
 WHERE id = ?5 AND status = 'processing'
RETURNING status
```

Five decisions worth copying: (1) there is **no window** between choosing and
taking, so nothing can be chosen twice; (2) the verdict is the returned set, not
a `usize` someone must remember to read; (3) the rearm returns the row to the
**pre-claim** state, so the work is retried rather than lost; (4) a **ceiling**
stops a poisoned row cycling forever; (5) the rearm is guarded on
`status='processing'`, so *"a terminal write from the tick that actually owns the
row always wins the race and the reaper reports `None`"* (`:952-954`). Live
proof that it works: **0 rows stuck in `processing`** across 4,972
`persona_events`.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `src/commands/companion/chat_cards.rs:217-262` | the claim/release **pair**, and the guarded release (`AND result_json IS NULL`) that cannot un-claim a settled row |
| `src/commands/companion/approvals/approval_exec_fleet.rs:1839-1845` | **where** to claim: *after* validation, *before* the irreversible step, with a comment saying why (`"Validation errors above are safe to retry, so they must not burn the card"`) |
| `engine/src/inflight_guard.rs:56-79` | RAII release, plus `:116-127` — a test asserting the key is released on a **panic unwind**. The only claim in the tree tested against an abnormal exit |
| `src/daemon/lock.rs:50-118` | a lease that actually works: `pid`, `hostname`, `heartbeat_at`, `is_stale()`, threshold justified as three missed beats |
| `db/src/repos/execution/audit_incidents.rs:479-489` | a release that resets the latch when the entity leaves the state that armed it, with the failure it prevents spelled out in the comment |
| `db/src/repos/resources/automations.rs:550-598` | the **derived** threshold, with the rejected heuristic named |

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`,
`../vibeman`, `../ascent`. **All five exist and all five were opened.** The
oracle **inverted one clause and corrected two facts carried in from the
adjacent paths** — flagged inline.

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **Work is claimed before it is done** | **PHYSICS (5/5)** | `brainiac` 2 (`queue.rs:135` with `FOR UPDATE SKIP LOCKED`, `sweeps.rs:240`), `ascent` 4 durable, `vibeman` 5, `personas-web` 1 (`votes/route.ts:160`, `ON CONFLICT DO NOTHING` on a unique key), `personas-cloud` 2. Independently reinvented in four stacks. |
| 2 | **The claim carries a lease/TTL** | **MINORITY — 3 of 6, and the three disagree about where it lives** | `brainiac` `queue.jobs.visible_at`, 300 s (`worker.rs:43`). `ascent` `Repository.nextScanAt` 15 min + `WebhookDelivery.expiresAt` 24 h. Personas `claim_expires_at` (unused). **`personas-cloud`, `vibeman` and `personas-web` have NO lease column of any kind** — `personas-cloud` runs a 30 s worker heartbeat that lives in a JS `Map` and reaps on `started_at`, and its `orchestrator/src/db.ts` contains **zero** occurrences of the word "heartbeat". |
| 3 | **The claimant's verdict is read** | **PHYSICS (4/6) and Personas is in the top group** | `brainiac` every site; `ascent` every site; **Personas 8/8**; `personas-web` absorbs it in the constraint. `vibeman` **3 of 6** — `cross-task.repository.ts:201` and `BaseAnalysisRepository.ts:85` both write a correct CAS and throw the count away, and `api/cross-task/[id]/route.ts:110` returns `success: true` to the loser, which then runs the analysis anyway. `personas-cloud`'s job path: **0** — the claim is `Array.shift()` on an in-RAM queue and the DB write is `WHERE id = ?` inside a `catch {}`. |
| 4 | **Something returns a DEAD claimant's row to its pre-claim state** | **PHYSICS as an ASPIRATION, RARE as an implementation (2/6)** | Only `brainiac` (the lease lapsing + `fail()` pushing `visible_at` forward, with `MAX_ATTEMPTS = 5`) and `ascent` (every claim self-expires) actually rearm. Personas rearms for **one** of eight tables. `personas-cloud` has a requeue — **but ⚠ it runs ONCE, AT BOOT** (`dispatcher.ts:1148` ← `index.ts:74`), so a worker dying while the orchestrator lives strands the row indefinitely. `personas-web` has **no reaper at all**, confirmed: zero server-side intervals outside a rate-limit GC. |
| 5 | **`ascent`'s lease IS the schedule column** | **CONFIRMED MECHANICALLY — and it is the best design in the family** | `org-watch.ts:209-217`. `Repository.nextScanAt` is the *only* scheduling state — no `claimedAt`, no `lockedBy`, no status. The claim writes `now + 15 min` into it; the due predicate is `nextScanAt <= now()`; **the claimer's `where` is byte-identical to the scheduler's**. Release = writing the same column further out (`now + cadence`). **A dead claimant leaves no residue a reaper could even be pointed at** — at T+15 min the row is bit-for-bit indistinguishable from one that was merely due. Contrast `brainiac`'s `sweep_schedules`, whose claim writes a *second* piece of state (`last_status='running'`) the schedule column does not govern, and which therefore needs the `RUNNING_STALE` escape hatch. |
| 6 | **⚠ CORRECTION — `brainiac`'s `RUNNING_STALE` is a 2-hour reaper** | **REFUTED** | `sweeps.rs:46` `RUNNING_STALE = "2 hours"` is **conjoined** with `next_run_at <= now()`, and the claim already pushed `next_run_at` forward a **full cadence** (`:244`). A dead claimant waits `max(cadence, 2 h)` — for the `library` sweep (7-day cadence) that is **a week**. `RUNNING_STALE` prevents a permanent wedge, not a stale one. Both this brief and [conditional-write](./conditional-write.md)'s table carry the 2-hour framing; it is wrong. |
| 7 | **The attempt counter is incremented ON CLAIM, not on failure** | **NO TRACE — 1 of 6, and it is the only repo that reasons about it** | `brainiac` `queue.rs:137-138` bumps `attempts` in the claim itself, and `:5-14` explains why: a crash-redelivery and a clean failure must consume the same budget, and only a claim-time increment sees both. **`ascent` has no attempt counter anywhere** (its `lastScanAttemptAt` is a display field no predicate reads), `vibeman` none, `personas-cloud`'s ceiling is an in-RAM counter that resets on restart, Personas has one for `persona_events` only. Report as near-silence. |
| 8 | **A settle write is FENCED against a claim that has moved** | **SILENCE, 6/6 for durable claims — reinvented ONCE, in memory** | `brainiac` `sweeps.rs:348-367` `record_result` is an unconditional `WHERE kind = $1`. `ascent` `advanceToFullCadence` (`:229-232`) is an unconditional `update({where:{id}})` — **while its in-memory sibling `releaseRepoScan` (`:311-314`) IS token-fenced and documents *"the fencing-token guard against the classic expired-lease self-release footgun"***. Same file, same author, opposite discipline, and the durable one is the unguarded half. Personas' equivalent is §9's 11 matches. **The hazard is universal and solved nowhere.** |
| 9 | **Claim logic is extracted into ONE shared helper** | **INVERTED — duplication is PHYSICS (6/6)** | `ascent` **8 hand-rolled mechanisms, 0 shared helper**, three of them independently reimplementing "TTL Map + opportunistic GC + test-and-set" and cross-referencing each other in comments. `vibeman` 6 copies / 3 shapes, its one extraction (`BaseAnalysisRepository`) defaulting to the **non-CAS** branch. `brainiac` 2. `personas-cloud` 2. Personas 8, including two that are character-for-character identical. **Only `personas-web` has one helper for all five of its lock users** — the smallest repo wins the clause. |
| 10 | **An in-process guard stands in for a durable claim** | **PHYSICS as a DEFECT (4/6)** | `personas-cloud`'s job claim **is** `this.queue.shift()`. `ascent`'s `/api/org/scan` and `/api/org/import` spend real credits guarded only by a module-global `Map`, and the file is candid: *"process-local… NOT a cross-instance distributed lock"* (`:272-276`). `personas-web`'s `withWriteLock` is a per-process promise chain over a filesystem store. Personas' is `SURFACED`. Only `brainiac` has **zero** — no `Mutex`/`HashSet`/`DashMap` is used as a work claim anywhere in its workspace. |
| 11 | **A claim table with NO release path** | **PHYSICS (4/6)** | `brainiac` `identities` (INSERT-as-claim + SELECT, the only two statements in the workspace, permanent **by design** and documented at `:86-89`). `ascent` `CreditLedger.externalId` (append-only, correct for a ledger). `vibeman` `lifecycle_locks` — **the sharpest sibling defect in this territory**: a durable `locked=1` with a `locked_at` column **no query ever reads** and no reaper, released only in a `finally`; `kill -9` the server mid-cycle and every future cycle for that project throws *"A cycle is already in progress"* permanently. Personas' is `deliberation_capability_claims` (§7 D3). **The distinguishing question is not whether the table has a release — it is whether permanence was INTENDED. `brainiac` and `ascent` wrote that down; `vibeman` and Personas did not.** |
| 12 | **A claim is held across an `await` or a process boundary** | **PHYSICS (5/5) — it is the normal case, and the lease is the only thing that makes it safe** | `brainiac` holds a job claim across the whole LLM chain (bounded by the 300 s lease, stated at `worker.rs:26-29`) **and** hands a sweep claim to a detached `tokio::spawn` whose `JoinHandle` is dropped and which shutdown never awaits. `ascent` holds a 24-hour webhook claim across Next's `after()` — **the work runs after the 200 is already sent** — and documents the exact bug that cost it: *"a bare `return` here is INSIDE the try, so the catch's `forgetDelivery` never runs and the delivery stays claimed… GitHub only redelivers on a non-2xx, and we already 2xx'd."* Ten `forgetDelivery` call sites are the price. **This clause is why (b) and (c) in §2 are not optional: if claims were not held across awaits, a lease would be a luxury.** |

**Physics — keep as doctrine:** clauses 1, 4 (as an aspiration), 9-inverted,
10-as-a-defect, 11 and 12. **Reported as silence:** clauses 7 and 8 — and clause
8 is the one to carry forward, because *fencing is absent from every durable
claim in all six repos while one of them proves it knows how.*
**Amended by the oracle:** clause 6 (a factual correction to the brief and to a
sibling path) and §2(e), which exists only because `brainiac` wrote the argument
down.

> **The strongest single result is `ascent` clause 5, and it is positive — which
> is rare in this corpus.** Every other repo, including this one, treats the
> claim as *extra state layered on top of* the scheduling state, and therefore
> owes a mechanism to clean that extra state up. `ascent` collapses the two into
> one column and the obligation disappears. **Personas can have this almost for
> free**: `claim_expires_at` is already a timestamp, and finding 1's one-word fix
> makes the expiry — not the status — the thing that grants the claim.

> **The counter-example that keeps it honest is `personas-cloud`, and it is
> negative twice.** It is a *port of this repo's engine*. The trigger scheduler's
> port dropped the compare-and-set ([conditional-write](./conditional-write.md)
> §6); the job path never had one to drop — its claim is an in-memory
> `Array.shift()` and its durable write is `WHERE id = ?` with the result
> discarded inside a `catch {}`. **Its event lane got a real periodic reaper
> (`eventProcessor.ts:12`, 60 s) and its job lane got a boot-only one.** Two lanes,
> one codebase, one author, opposite outcomes — which is the best available
> evidence that this is a thing people get right when they are looking at it and
> wrong when they are not.

## 7 Deviations

Every entry is live on `master` @ `bbb1a8864` and was verified against a
read-only copy of the operator's database or by replay against real SQLite.

### D1 — the lease cannot rearm, has no renewal, and its own comment asserts both are handled

`db/src/repos/execution/executions.rs:938-991`.

- **The predicate excludes every dead claimant.** `WHERE id = ?1 AND status =
  'queued' AND (claimed_by_instance IS NULL OR claim_expires_at IS NULL OR
  claim_expires_at < ?4)`. Executed: re-claiming an expired lease returns
  `changes = 0`. The doc comment at `:944-946` says the opposite.
- **The comment now asserts the mechanism twice.** `:972` additionally describes a
  *"crash-recovery re-queue"* producing a `running → queued → running` cycle. No
  such path exists: **nothing in production writes `status = 'queued'`**, and the
  two `update_status(…, Queued)` call sites in the tree are both tests.
- **There is no renewal.** `touch_last_heartbeat` (`:1461`) has one caller
  (`runner/mod.rs:2122`) and does not touch `claim_expires_at`. Fixing the
  predicate without adding renewal converts "never rearms" into "steals rows from
  healthy long runs".
- **0 production callers** (definition + 5 test sites). Live: **0 of 2,188**
  executions and **0 of 12** `build_sessions` carry `claimed_by_instance`, though
  the same migration gave both tables the columns.

**Fix, as one unit:** (a) `AND status IN ('queued','running')` — executed above,
it rearms; (b) extend `claim_expires_at` from `touch_last_heartbeat`, which is
already called on the runner's tick; (c) add `AND claimed_by_instance = ?` to
`update_status_if_running` so a stolen claim cannot be settled by its former
owner; (d) delete both false sentences from the doc comment.

### D2 — `pop_next_queued` is written twice, character for character, and both are boot-recoverable only

`src/companion/jobs/mod.rs:305-339` and `src/engine/persona_jobs.rs:201-228` are
the same eleven lines against different tables. Both are *correct* CASes that read
their verdict. What they lack:

- **A lease.** A worker that dies without the process dying leaves `running`
  forever. Executed: the row is invisible to the pop `SELECT` and a direct
  re-CAS returns 0.
- **A rearm.** `recover_orphans` (`jobs/mod.rs:170`, `persona_jobs.rs:257`) writes
  **`failed`**, not `queued` — the job is lost, not retried — and runs **only at
  process start** (`commands/companion/mod.rs:192`, `lib.rs:1375`).
- **An instance predicate.** `WHERE status = 'running'` with no owner term, and at
  `lib.rs:1375` it runs **outside** the `leadership.is_leader()` gate that guards
  the worker loop 13 lines below it. A second Personas process booting — which
  `leadership.rs:6-10` exists to support — marks the leader's live jobs `failed`.
  Then the leader finishes and `mark_completed`'s identity-only write (§9) stamps
  `completed` back over it, with no guard in either direction.
- **A retry on a lost race.** Executed: the loser returns `Ok(None)` and the tick
  ends with the next queued row untouched.

Live: `persona_background_job` holds 2 rows (both `completed`),
`companion_background_job` is empty — so this is **latent, not currently
firing**. It is listed at this severity because `companion::jobs::worker_tick` is
**not** leader-gated (`commands/companion/mod.rs:124`), unlike its twin.

**Fix:** extract one `pop_next_queued(table, lease)` helper returning
`Option<Claimed<T>>` (see *Prefer a type over a gate*), give it the lease from D1,
and make `recover_orphans` requeue with a ceiling instead of terminalising.

### D3 — `deliberation_capability_claims` has one production statement, and a failed capability suppresses itself forever

`db/src/repos/resources/deliberation.rs:250-268`. The claim is correct. The
problem is everything else:

- **Repo-wide, the table has exactly ONE production statement** — the
  `INSERT OR IGNORE`. (The `COUNT(*)` at `:444` that
  [conditional-write](./conditional-write.md) lists as the second is a test
  helper inside `mod claim_capability_tests`; see §12.) No `DELETE`, no `UPDATE`,
  no expiry column, and nothing ever reads the claim.
- **The failure path does not release.** `src/commands/teams/deliberations.rs:228`
  claims, `:258` runs the capability, and the `Err` branch (`:285-298`) posts
  *"Couldn't run … Continuing discussion"* and clears the pending action — **and
  leaves the claim**. The capability never ran and can never be run again for
  that group.
- Executed: the winner cannot even re-enter its own claim.
- **Live: 10 claim rows; 3 are held by deliberations that never reached a terminal
  state** (2 `action_running`, 1 `tracking`) — and per
  [terminal-state-and-recovery](./terminal-state-and-recovery.md) D10 those three
  `action_running` deliberations point at executions that **completed 50 days
  ago**. Three capabilities have been suppressed for their whole groups for fifty
  days by work that finished.

**Fix:** delete the claim row in the `Err` branch, and add
`DELETE FROM deliberation_capability_claims WHERE deliberation_id = ?` to the
deliberation's terminal transition. If permanence is actually intended for the
success path, say so in the doc comment — `brainiac`'s `identities` does exactly
that and is therefore not a defect.

### D4 — a remote run-request can be approved twice, and each approval starts a real agent run

`src/cloud/remote_commands.rs:246-266`. `remote_command_approve` reads the row,
checks `if cmd.status != "pending"` in Rust, then PATCHes
`pending_commands?id=eq.{id}` with **no status filter**, then calls
`execute_persona_inner`. Executed (§5): both approvals pass the check, both PATCH
successfully, both run. **Two agent runs, two bills, one request.**

Two aggravations in the same file:
- The poll's auto-expire (`:144-149`) PATCHes to `expired` with the same
  filterless path, so a command approved between the poll's `GET` and its `PATCH`
  is marked expired **while it executes**.
- `remote_command_reject` (`:318-324`) is the same shape.

**Fix:** append `&status=eq.pending` to all three paths — PostgREST applies it
server-side — and read the result, which requires D6.

### D5 — the exclusivity guard for a cross-device queue is a `HashSet` in RAM

`src/cloud/remote_commands.rs:30` `static SURFACED: LazyLock<Mutex<HashSet<String>>>`,
inserted at `:159`, **never removed anywhere**. The `pending_commands` row itself
is never claimed — it stays `pending` in the shared store until a human approves
or the hour-long expiry fires. So the same request re-surfaces after any restart,
and `spawn_poll_loop`'s `state.leadership.is_leader()` gate (`:173`) is the only
real exclusivity in the path — a process-level lease standing in for a row-level
claim. The set is also unbounded.

**Fix:** claim the row in the poll (`PATCH …?id=eq.X&status=eq.pending` →
`surfaced`), which makes `SURFACED` redundant and deletable. Absent that, keep
the leadership gate and document that it *is* the claim.

### D6 — the shared cloud transport cannot express or report a conditional write

`src/cloud/sync/client.rs:117-141`. `SyncClient::patch` hardcodes
`Prefer: return=minimal` and returns `Result<(), AppError>`; `post` (`:73`) and
`delete` (`:150`) are the same. **No caller can learn whether a write matched a
row**, so a compare-and-set over this door is unwritable even by someone who
wants one. **0 of 7** production PostgREST mutating paths carry a state
precondition — there is no compliant example to copy because the transport
forbids one.

**Fix:** add `patch_conditional(path, body) -> Result<u64, AppError>` sending
`Prefer: return=representation` (or `count=exact` and reading `Content-Range`)
and returning the affected-row count. This is the cheapest fix in this document
and it unblocks D4 and D5.

### D7 — eleven outcome writes are unfenced, and two files disagree with themselves

The §9 population. Of 26 writes that record the outcome of work, **11 carry an
identity-only `WHERE`**:
`companion/brain/consolidation.rs:392, :439, :861` ·
`engine/persona_jobs.rs:234, :246, :340` · `companion/jobs/mod.rs:345, :357` ·
`db/src/repos/execution/audit_incidents.rs:468` ·
`db/src/repos/lab/evolution.rs:316` ·
`src/commands/infrastructure/overnight.rs:600`.

Two of them are the sharpest artifacts here, because the correct form is in the
same file:
- `consolidation.rs:392` / `:439` set `'applied'` with `WHERE id = ?3`, while
  `:453` and `:496` set `'rejected'` with `AND status = 'pending'`.
- `persona_jobs.rs:234` / `:246` / `:340` are identity-only, while `:184` and
  `:261` in the same file carry `AND status = 'queued'` / `AND status = 'running'`.

`overnight.rs:600` compounds it with `let _ = conn.execute(…)`, so a lost race and
a DB error are equally invisible.

**Fix:** add the in-flight status (or, after D1, `AND claimed_by = ?`) to each
`WHERE` and log when the count comes back 0 — a refused settle means ownership
moved, which is exactly what you want to know.

### D8 — `InflightGuard`'s own module documents a limit nobody restated

`engine/src/inflight_guard.rs` is excellent within its scope and its scope is
never stated in the type. 15 statics and 18 call sites hold keys that are
sometimes durable entity ids (`REVIEW_GUARD.guard(target_persona_id)`,
`ADOPT_INFLIGHT.guard(preset_id)`, `REBUILD_INFLIGHT.guard(&id)`). Every one of
those is correct *today* because the guarded work is re-entrant and cheap to
repeat — but nothing marks the boundary, and `remote_commands` (D5) is what
crossing it looks like. The one place the boundary IS written down is
`background.rs:2185-2198`, which explains in nine lines why the scheduler's
overlap check is a DB query and not an `InflightGuard`. That comment is the best
statement of this leaf's central distinction in the tree and it is invisible from
`inflight_guard.rs`.

**Fix:** cross-reference `background.rs:2189` from the module doc, and rename or
newtype the key so an entity id cannot be passed without a second thought.

### Structural — where the claims are

Of **53** production state-transition CAS statements, **6** are claims (a
pre-claim → in-flight transition); two more claim without a status change
(`INSERT OR IGNORE`, and the `continued_at IS NULL` latch). **8 total.** The
other 45 are decisions on rows, which is
[conditional-write](./conditional-write.md)'s territory. Of the 8, **7 sit in a
different file from any release**, and the one that does not (`chat_cards.rs`)
is the only claim/release pair in the repo.

## 8 Gaps — what the primitives genuinely cannot do

1. **A lease is four things and a reviewer sees one.** An expiry column, a
   predicate that admits an expired claim, a renewal, and a rearm. Only the
   column is visible in a diff; the other three are properties of statements
   elsewhere. This extends [conditional-write](./conditional-write.md) Gap 3 by
   the leg that document did not measure — **renewal** — and D1 shows why fixing
   the predicate alone makes things worse.
2. **No type reaches inside the predicate.** `AND status = 'queued'` is a word in
   a string. A `'queeud'` typo compiles, claims nothing forever, and is
   indistinguishable at runtime from a claim that keeps losing. Same wall every
   path in this territory hits.
3. **The census can ratchet a presence and cannot assert an absence.** "This
   table has no `DELETE`", "nothing writes `queued`", "this lease is never
   renewed" are three of this document's five headline findings and **not one is
   expressible as a count.** They were found by replaying the system and by
   enumerating every statement against a table — which is a *program*, not a
   matcher. §9's gate deliberately targets the one member of this family that IS
   a presence: the unfenced settle.
4. **There is no shared claim primitive, and the extraction is ~30 lines.**
   Carried forward from [conditional-write](./conditional-write.md) Gap 2 and
   still true, now with the sibling evidence that makes it doctrine rather than
   taste: **duplication is 6/6 across the family** (clause 9), so this will not
   fix itself.
5. **No test exercises a crash between claim and settle.** `src-tauri/tests/`
   contains zero matches for orphan / interrupted / recover / restart / zombie.
   `test_claim_expired_is_reclaimable` (`executions.rs:2106`) passes **because the
   test performs the requeue itself** — it calls `update_status(…, Queued)`
   between the expired claim and the fresh one, the exact step production does not
   have. A test that supplies its subject's missing precondition proves the
   statement and not the system.
6. **`InflightGuard` cannot express its own scope.** Its key is a `&str`; nothing
   distinguishes "a UI button id" from "a row that outlives this process". D8.
7. **The cloud transport structurally forbids the correct call.** D6. This is the
   one gap where the *primitive's default* — not any caller — is the whole
   defect, and it is the contract's fifth §9 failure mode: a door developers are
   correctly routed to that cannot do the job.

## Prefer a type over a gate

Held against all seven qualifications. **The honest answer is that a type gets
the claim side almost entirely and reaches the release side not at all — and
naming that boundary precisely is the useful part.**

The measured facts to design against: 8 claim sites, 8 hand-written, 0 shared
helper, 1 with a lease; `claimed_by_instance` written by one statement and read
by none; 11 of 26 settles unfenced; duplication 6/6 across the sibling family.

**The proposal — withhold the unfenced settle by making the claim hand you the
fence:**

```rust
/// Proof that THIS process holds a live claim on row `id` of `table`.
/// Constructible ONLY by `claim`, which is the only function that performs the CAS.
#[must_use = "a claim you do not settle or release is a row nobody can pick up again"]
pub struct Claim<'a> { table: &'static str, id: String, owner: &'a str, expires_at: String }

impl<'a> Claim<'a> {
    /// The ONLY way to obtain one. No `Claim::new`, no public fields.
    pub fn take(pool: &DbPool, table: &'static str, owner: &'a str, lease: Duration)
        -> Result<Option<Claim<'a>>, AppError>;
    /// Extends the lease. Wired to the same tick that heartbeats.
    pub fn renew(&mut self, pool: &DbPool) -> Result<bool, AppError>;
    /// Records the outcome. Emits `WHERE id = ?1 AND claimed_by = ?2` — the fence
    /// is not a parameter the caller can omit, it is inside the method.
    pub fn settle(self, pool: &DbPool, status: &str) -> Result<bool, AppError>;
    /// Returns the row to its pre-claim state, incrementing the attempt counter.
    pub fn release(self, pool: &DbPool) -> Result<(), AppError>;
}
```

1. **A required prop carries only what it actually encodes.** ✔ `Claim` encodes
   "this process won a CAS on this row and the lease has not been observed to
   expire". It does **not** encode "the worker is alive" — that is a heartbeat's
   job — and it must not, or it becomes the `successRateSource` failure: a tag
   whose truth lives in a value beside it. `renew` is separate for exactly that
   reason.
2. **Requiredness is orthogonal to closedness.** ✔ Making `lease: Duration` a
   *required* parameter of a free function changes nothing — `claim_for_instance`
   already requires `ttl_secs` and it is the one site with a lease and zero
   callers. What matters is that `settle` is **closed** over the fence: there is
   no overload that omits it.
3. **A type nobody constructs constrains nothing.** ✔ **This qualification
   decides the design, and the evidence that it bites is in this very
   territory.** `claim_for_instance` is a correct, tested, exemplary function with
   **0 production callers**; `ExecutionState::TERMINAL` and `ProcessSession` are
   the same failure at two other layers; `vibeman` has a 135-line status algebra
   with 0 value-imports. **Availability is not adoption.** So `Claim` cannot be
   an alternative to the existing 8 hand-rolled loops — the migration has to
   delete them, and `settle`/`release` must be the only way to write a terminal
   status on a claimable table. A `Claim` that merely *exists* beside
   `conn.execute("UPDATE … WHERE id = ?")` lands exactly where
   `claim_for_instance` did.
4. **A type anyone can construct authenticates nothing.** ✔ Private fields, no
   `new`. And the counter-example is measured in this family: `brainiac`'s
   `queue::Job` (`queue.rs:36-42`) is the `Claimed<T>` a reader would expect here
   and **all four of its fields are `pub` on a `#[derive(Clone)]` struct** — a
   caller can fabricate one, so it proves nothing about ownership. The value of
   `Claim` is not that it is a token; it is that **`settle` is a method on it**,
   so the fence cannot be reached without the proof.
5. **Withholding beats requiring.** ✔ The withheld freedom is *writing an outcome
   without demonstrating you own the row*. Note the contrast with the alternative
   a reader would reach for first — adding a required `claimed_by: &str`
   parameter to the existing settle functions. That is *requiring*, and the
   caller would supply `job.id`'s owner from the row it read, which is the value
   the fence exists to distrust.
6. **Withhold the dangerous freedom, not the answer.** ✔ The answer — "did my
   settle land?" — is returned as a `bool` from `settle`. What is withheld is
   issuing the settle **unfenced**. `Claim::take` returning `Option` also
   withholds nothing the caller needs: `None` is "someone else has it", which is
   the whole verdict.
7. **Withholding a requirement only helps when the requirement was forcing the
   bad value.** ✔ Directly applicable, and it rules out the obvious alternative.
   Nobody *forced* `mark_completed(pool, id, result)` to write an identity-only
   `WHERE` — it takes no status parameter at all; the predicate is welded into a
   literal in the function body. **Relaxing any existing signature is inert. The
   construction is what must be withheld.**

**Does the type reach the code?** *On the claim side, almost entirely; on the
release side, not at all — and the boundary is the finding.*

Reaches: all 8 claim sites and all 11 unfenced settles are ordinary Rust the
compiler sees; making `settle` the only door is a compile error at every one.
`Claim::take` also makes the lease unforgettable, because there is no constructor
without one — which is the D1 fix expressed as a type rather than as a fix.

**Does not reach, and cannot:** (a) **the predicate text** — `Claim::take` builds
its own SQL, so a typo inside it is one bug instead of eight, but nothing checks
that `'queued'` is a state the column can hold (Gap 2); (b) **the absence of a
release** — no Rust type can require that *some other function elsewhere* deletes
a row from `deliberation_capability_claims`. `#[must_use]` fires when a `Claim`
value is dropped unused in one scope; it says nothing about a claim taken in one
request and abandoned by a process that no longer exists. **That is the whole
subject of this leaf and it is a runtime property, which is why (b) in §2 matters
more than any type: a lease is the only mechanism that enforces release without a
live process to enforce it.**

**Fix order:** (1) D6, one method, unblocks D4 and D5; (2) D1's four-part lease
fix, which is what makes `Claim` constructible at all; (3) `Claim` + migrate the
8 sites, deleting both `pop_next_queued` copies (D2); (4) D3's release; (5) keep
§9's rule as the ratchet until (3) lands, then delete it.

## 9 The missing gate

**The condition, stated stack-free:** *a worker records the outcome of a unit of
work it claimed, addressing the row by identity alone — so a worker whose claim
is no longer valid overwrites whatever the row's current owner wrote, and neither
worker can tell.*

An adopting repo must re-derive its own proxy. This one keys on a rusqlite SQL
literal whose `WHERE` is exactly `id = ?N`. A repo on Prisma spells the identical
condition as `prisma.job.update({ where: { id } , data: { status: 'completed' }})`
— note that Prisma's `update` **cannot take a compound predicate at all**, so the
correct form there is `updateMany` with the fence in `where` — and this SQL
pattern scores a **structural zero** in all five siblings while the condition is
present in at least three (`brainiac` `sweeps.rs:348-367`, `ascent`
`org-watch.ts:229-232`, `vibeman` `cross-task.repository.ts:196-201`).

**Where it runs:** `npm run census` / `npm run census:check` — local, and invoked
by the pre-push hook. Explicitly **not** a CI-only gate: `ci.yml` has **0
successes in 260 all-time runs** and its `frontend-checks` job is red on a
platform-incomplete lockfile, so a gate that runs only there runs nowhere.

### Existing rules checked first, by reading each definition rather than its title

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| `blind-identity-write` (`repository-crud-surface.md`, 35/82) | **the nearest neighbour.** A repo fn returning `Result<(), AppError>` reaching a write whose entire `WHERE` is `id = ?N`, count discarded | Two independent disjunctions. (1) **Root:** it is scoped to `src-tauri/db/src/repos`; **9 of this rule's 11 matches are outside that root**. (2) **Condition:** it keys on the *function's return type* discarding the count; this keys on the *statement's `SET` list* recording a work outcome. Verified: **zero match-position overlap.** Its concern is "did the row exist"; mine is "was it still mine". |
| `discarded-guard-verdict` (`conditional-write.md`, 7/11) | a guarded single-row `UPDATE` in statement position — `id = ?N` **plus** a further predicate | **The exact complement.** That rule requires a second predicate; this one requires there is none. Disjoint by construction. Verified: zero overlap in the 11 vs 11 match positions (`overnight.rs:600` is a `let _ =` and is still invisible to it, because its `WHERE` is identity-only). |
| `partial-terminal-status-set` (`terminal-state-and-recovery.md`, 6/14) | a `status IN (…)` membership test in a **read** predicate on `persona_executions` | Read-side, `SELECT`, one table. Mine is write-side, `UPDATE`, table-agnostic. No shared match. |
| `unswept-job-registry-read` (`long-running-job-progress.md`, 6/9) | an in-memory `*_JOBS` map read without a sweep | The closest *conceptual* neighbour — an in-memory registry — and it keys on `HashMap` + `lock()`, not on SQL. It would not see `SURFACED` (D5) either, which is why D5 is carried as prose. |
| `module-scope-install-latch` (`hmr-safe-singletons.md`, 13/13) | a TS module-scope `let x = false` set true and never reset | Different language, different root (`src`), different shape (a bool, not a set). I measured the Rust analogue — a process-global set inserted into and never removed — and **rejected it**; see below. |
| `deferred-read-then-write` (`transaction-boundary.md`, 10/12) | a DEFERRED transaction whose first `tx` use is a `SELECT` informing a later write | Covers the TOCTOU shape **inside a transaction**. Both `pop_next_queued` copies are on a pooled connection with no transaction and are invisible to it. |
| `unverified-effect-dispatch`, `unraced-loop-wait`, `unverifiable-conflict-clause`, `untimed-repo-query` | emits, loop waits, INSERT conflicts, timing | Unrelated. |

**None of the 98 existing rules keys on the `WHERE` clause of an outcome-recording
write. Proposing one.**

### Measurement

**Precision 11/11 — every match opened and read.** The population is the **27**
production writes that record a work outcome (a terminal status literal **and** a
completion timestamp in the same `SET` list). The anchor sees all 27 and
partitions them **11 violating / 15 compliant / 1 excluded**, with no residual:
11 + 15 + 1 = 27 exactly.

Two independent implementations, and **they disagreed, which was the finding**:

| implementation | violating | compliant |
| --- | ---: | ---: |
| Rust lexer, statement-scoped, `#[cfg(test)]` as brace-matched ranges | 11 | **15** |
| the census engine, from the published pattern (first draft) | **11** | **13** |

The gate agreed at 11 on the first run; **the control was short by 2**. Cause:
`dead_letter` was in the lexer's terminal-status list and not in the regex's, so
`events.rs:848` and `:897` — `SET status = 'dead_letter' … WHERE id = ?3 AND
status = 'failed'` — fell through, the engine backtracking onto the `'failed'` in
the *`WHERE`* clause and then finding no timestamp after it. **A vocabulary
difference between two implementations of the same idea, landing exactly where
the doctrine says it will: on the unusual member.** Both lists now carry
`dead_letter` and both implementations return 11 / 15.

**Contamination: zero.** The lexer excludes brace-matched `#[cfg(test)]` ranges
and `*_tests.rs` by filename; the census engine does neither, and **both returned
the same 11**, which is a stronger check than either alone. Structurally, test
modules here build fixtures with `INSERT` and assert through repo functions
rather than hand-writing outcome SQL.

**Backtracking:** every fill is `(?:[^"\\]|\\[\s\S])*?` — a bounded-by-a-string-
literal lazy alternation whose two branches are mutually exclusive (`[^"\\]`
cannot match `\`), so there is no nested-quantifier ambiguity. Full 963-file run:
**0.35 s**, measured three times (0.35 / 0.34 / 0.36).

**Validated standalone** in a composer-private registry
(`registry-job-claim-lease-composer.json` — a filename unique to this composer,
because sibling composers share the scratchpad), then **re-extracted from this
finished document and re-run: `files 6 / matches 11` and `files 11 / matches 15`,
identical both times.**

### The rule

```json
{
  "rules": [
    {
      "id": "unfenced-work-outcome-write",
      "goldenPath": "docs/concepts/golden-paths/job-claim-and-lease.md",
      "title": "A worker records the OUTCOME of a claimed unit of work addressing the row by identity alone, so a claimant whose claim is no longer valid overwrites whatever the current owner wrote.",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "UPDATE\\s+[A-Za-z_]\\w*\\s+SET\\s+(?:[^\"\\\\]|\\\\[\\s\\S])*?\\b(?:status|state|phase)\\s*=\\s*'(?:completed|failed|canceled|cancelled|succeeded|errored|timeout|aborted|incomplete|dead_letter|expired|resolved|applied|declined|discarded|rejected|archived|delivered|skipped|done)'(?:[^\"\\\\]|\\\\[\\s\\S])*?\\b(?:completed_at|resolved_at|finished_at|ended_at|processed_at|delivered_at|failed_at|closed_at)\\s*=\\s*(?:[^\"\\\\]|\\\\[\\s\\S])*?\\bWHERE\\s+(?:[A-Za-z_]\\w*\\s*\\.\\s*)?id\\s*=\\s*\\?\\d+\\s*\"",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "An UPDATE that RECORDS THE OUTCOME OF WORK - a terminal status literal AND a completion timestamp in the SAME SET list - whose WHERE clause is the bare row identity and nothing else (the match must terminate at the literal's closing quote immediately after `id = ?N`, so any further `AND` term fails it). PROXY FOR the stack-free condition: a worker records the outcome of a unit of work it claimed, addressing the row by identity alone, so a worker whose claim is no longer valid overwrites whatever the row's current owner wrote and neither worker can tell. THE SHAPE IS NOT AN ACCIDENT: a terminal status plus a completion timestamp is a worker saying 'this unit of work has ended', which only ever happens on a row somebody took; and this repo takes work 8 times and can hand it back twice, so the row under such a write is exactly the kind whose ownership can move. EXECUTED, not argued (node:sqlite, 2026-08-15, statements transcribed verbatim from this tree): replaying claim_for_instance (db/src/repos/execution/executions.rs:976-985) shows a second claimant correctly loses (changes 0) while the lease is live, and shows that after the claimant DIES the row is stuck at 'running' so a re-claim of the EXPIRED lease also returns 0 - the predicate requires status='queued' and a dead claimant can never satisfy it; changing that one term to `status IN ('queued','running')` makes the identical statement rearm (changes 1) while still refusing a live claim (changes 0). So ownership CAN move the moment that one-word fix lands, and at that moment every identity-only settle in this rule's population becomes a live lost-update. Also executed: `UPDATE t SET s='running' WHERE id=? AND s='running'` returns 1 on a row already holding 'running', so changes==0 always means THE PREDICATE FAILED and never 'the value was already right' - which is what makes a fenced settle readable as a verdict. MEASURED 2026-08-15 at bbb1a8864: 11 matches across 6 of 963 .rs files, ALL ELEVEN OPENED AND READ (precision 11/11), commentMatchesSkipped 0. Population and partition: a whole-tree Rust lexer (string/comment aware, #[cfg(test)] removed as BRACE-MATCHED RANGES plus a *_tests.rs filename rule, because dev_tools_backlog_tests.rs carries no #[cfg(test)] attribute at all) finds 27 production outcome-recording writes; this pattern's anchor sees all 27 and splits them 11 violating / 15 compliant / 1 excluded, and 11 + 15 + 1 = 27 exactly, so there is no unexamined third population. THE ELEVEN: companion/brain/consolidation.rs:392 and :439 (status='applied', resolved_at, WHERE id = ?3) which sit in the SAME FILE as :453 and :496 where the identical table is written with `AND status = 'pending'` - same file, same table, opposite discipline; consolidation.rs:861 (mark_failed on the parent consolidation run); engine/persona_jobs.rs:234 (mark_completed), :246 (mark_failed) and :340 (mark_canceled), which sit in the same file as :184 and :261 where the CAS form IS used - and this is the file whose pop_next_queued at :214 claims the row in the first place, so the claim is fenced and the settle is not; companion/jobs/mod.rs:345 and :357, the character-for-character twin of the persona_jobs pair; db/src/repos/execution/audit_incidents.rs:468 (the resolve transition - the weakest member, carried so the count is a population rather than an opinion); db/src/repos/lab/evolution.rs:316 (complete_cycle, inside a transaction that correctly makes its TWO writes atomic while fencing neither); src/commands/infrastructure/overnight.rs:600, which compounds it with `let _ = conn.execute(..)` so a lost race and a database error are equally invisible. NOT EVERY MATCH IS A LIVE BUG TODAY AND THE RULE DOES NOT CLAIM SO: claimed_by_instance is written by exactly one statement in 963 files and read in a WHERE clause by none, so ownership cannot currently move - which is D1, not an argument that these writes are safe. They are the reason D1 cannot be fixed alone. ONE EXCLUSION, BY PATH WITH A REASON, NOT BY WEAKENING THE PATTERN: src/commands/testing/synthesize_review.rs:119 CREATES a persona_executions row and immediately stamps it 'completed' so audit dashboards see a finished run; its own comment at :112-115 says the write is 'purely cosmetic'. It never claimed the row from anyone, so there is no claim to fence. POSITIVE CONTROL: unfenced-work-outcome-write-positive-control, the IDENTICAL SET-list anchor with the WHERE requiring a further term, matches 15 across 11 files. TWO INDEPENDENT IMPLEMENTATIONS, AND THEY DISAGREED, WHICH WAS THE FINDING: a statement-scoped Rust lexer and the census engine both returned 11 for the gate on the first run, but the control came back 15 vs 13 - `dead_letter` was in the lexer's terminal-status list and not in the regex's, so events.rs:848 and :897 (`SET status = 'dead_letter' .. WHERE id = ?3 AND status = 'failed'`) fell through, the engine backtracking onto the 'failed' in the WHERE clause and then finding no timestamp after it. A vocabulary difference between two implementations of one idea, landing on the unusual member exactly as the doctrine predicts. Both lists now carry dead_letter and both implementations return 11 / 15. CONTAMINATION: zero - the lexer excludes brace-matched #[cfg(test)] ranges and the census engine excludes neither, and both returned the same 11, which is a stronger check than either alone; test modules here build fixtures with INSERT and assert through repo functions rather than hand-writing outcome SQL. BACKTRACKING: every fill is (?:[^\"\\\\]|\\\\[\\s\\S])*? - a lazy alternation bounded by one Rust string literal whose two branches are mutually exclusive ([^\"\\\\] cannot match a backslash), so there is no nested-quantifier ambiguity; full 963-file run 0.35s, measured three times (0.35/0.34/0.36). DOES NOT OVERLAP blind-identity-write, its nearest neighbour, for TWO independent reasons: that rule is scoped to src-tauri/db/src/repos and 9 of these 11 matches are outside that root, and it keys on the enclosing FUNCTION returning Result<()> with the count discarded whereas this keys on the STATEMENT's SET list recording a work outcome - verified zero match-position overlap. Nor discarded-guard-verdict, which is the exact complement (it REQUIRES a second predicate beyond `id = ?N`; this requires there is none) - verified zero overlap across the two 11-match sets, and note overnight.rs:600 is a `let _ =` that is still invisible to it because its WHERE is identity-only. Nor partial-terminal-status-set (read-side, SELECT, one table), nor unswept-job-registry-read (an in-memory HashMap, not SQL), nor deferred-read-then-write (the TOCTOU shape INSIDE a transaction; both pop_next_queued copies are on a pooled connection and invisible to it). LEGAL FIX, one line each: add the in-flight status to the WHERE - `AND status = 'running'` - or, once claim_for_instance is adopted, `AND claimed_by_instance = ?`, and branch on the count so a refused settle is a warn! rather than silence. db/src/repos/communication/events.rs:961-996 (reap_stuck_processing) is the shape to copy: guarded on the current state, RETURNING the verdict, with a retry ceiling. Do NOT silence a match by moving the SQL into a `const &str`, by splitting it across two Rust string literals, or by dropping the completion timestamp from the SET list - all three preserve the defect exactly and merely hide it from this signal. PRECONDITION (must be re-derived per repo): this repo executes SQL through rusqlite with statements as string literals, spells its primary key `id`, and binds parameters as ?N. A repo on Prisma spells the identical condition as prisma.job.update({where:{id}, data:{status:'completed'}}) - and note Prisma's `update` CANNOT take a compound predicate at all, so the correct form there is updateMany with the fence in `where`, a different signal entirely. This SQL pattern scores a structural zero in all five siblings while the condition is present in at least three: brainiac sweeps.rs:348-367 (record_result, unconditional WHERE kind = $1), ascent org-watch.ts:229-232 (advanceToFullCadence, unconditional update({where:{id}}) - in the same file as releaseRepoScan at :311-314, which IS token-fenced and documents 'the fencing-token guard against the classic expired-lease self-release footgun'), and vibeman cross-task.repository.ts:196-201. Fencing a settle is absent from every durable claim in all six repos in this family while one of them proves it knows how. END OF LIFE: this rule is designed to reach zero - all 11 are one-line fixes - and the golden path's 'Prefer a type over a gate' proposes a Claim<'a> whose settle() method emits the fence internally, which deletes the rule's reason to exist. When the count reaches 0 the runner fails structurally on zero-matches, BY DESIGN: DELETE the rule then, do not baseline it at 0.",
        "$measured": "2026-08-15 @ bbb1a8864 — 963 .rs files walked, floor 900; two independent implementations reconciled at 11/15 after a diagnosed vocabulary gap; every match hand-read; eight claim shapes replayed against real SQLite; live counts from read-only copies of personas.db (2,188 executions, 0 ever claimed) and personas_data.db."
      },
      "exclude": [
        {
          "path": "src-tauri/src/commands/testing/synthesize_review.rs",
          "reason": "a simulation fixture that CREATES a persona_executions row and immediately stamps it 'completed' so audit dashboards see a finished run (its own comment at :112-115 calls the write 'purely cosmetic'). It never claimed the row from anyone, so there is no claim to fence and the identity-only WHERE is correct."
        }
      ],
      "baseline": { "files": 6, "matches": 11 },
      "floor": 900
    }
  ]
}
```

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "unfenced-work-outcome-write-positive-control",
  "goldenPath": "docs/concepts/golden-paths/job-claim-and-lease.md",
  "title": "POSITIVE CONTROL — the same outcome-recording write whose WHERE clause carries a further term (the fence).",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "UPDATE\\s+[A-Za-z_]\\w*\\s+SET\\s+(?:[^\"\\\\]|\\\\[\\s\\S])*?\\b(?:status|state|phase)\\s*=\\s*'(?:completed|failed|canceled|cancelled|succeeded|errored|timeout|aborted|incomplete|dead_letter|expired|resolved|applied|declined|discarded|rejected|archived|delivered|skipped|done)'(?:[^\"\\\\]|\\\\[\\s\\S])*?\\b(?:completed_at|resolved_at|finished_at|ended_at|processed_at|delivered_at|failed_at|closed_at)\\s*=\\s*(?:[^\"\\\\]|\\\\[\\s\\S])*?\\bWHERE\\b(?:[^\"\\\\]|\\\\[\\s\\S])*?\\b(?:status|state|phase|claimed_by\\w*|claim_expires_at|created_at|started_at|result_json)\\s*(?:=|IN|IS|<|>)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL, not a gate. The IDENTICAL SET-list anchor as unfenced-work-outcome-write - the same terminal-status alternation, the same completion-timestamp requirement - with the WHERE clause requiring at least one further column term instead of terminating at `id = ?N`. The two are mutually exclusive BY CONSTRUCTION, not merely empirically: the gate requires the literal to END immediately after the identity term, this one requires a further term after WHERE. MEASURED 2026-08-15 at bbb1a8864: 15 matches across 11 files versus the gate's 11 across 6. PARTITION, NOT A RATIO: the anchor sees all 27 production outcome-recording writes in the tree and 11 + 15 + 1 excluded = 27 exactly, so every such write is classified. The 15 compliant sites are db/src/repos/communication/events.rs:848, :897 and :1023 (the dead-letter transitions, each guarded on the state it is leaving), manual_reviews.rs:579, executions.rs:1837 (the zombie sweep's CAS), healing.rs:413, automations.rs:573 (whose threshold is DERIVED from the work's own retry+backoff budget), teams.rs:729, consolidation.rs:453 and :496, companion/jobs/mod.rs:174, night_shift/mod.rs:463, proactive/mod.rs:572, and engine/persona_jobs.rs:184 and :261. Note what that list demonstrates: FOUR of the 15 sit in the same file as one of the gate's 11 (consolidation.rs, jobs/mod.rs, persona_jobs.rs), so the gate is not discriminating on module, author, era or table - it is discriminating on whether THIS PARTICULAR STATEMENT carries a fence, and in three files the same author wrote both forms. 58% of this repo's outcome-recording writes are fenced and 42% are not. If this control's count ever collapses toward the gate's, the shared SET-list anchor has broken and BOTH numbers are meaningless - that is the failure this control exists to make visible, and it already caught one: on the first run the control returned 13, not 15, because `dead_letter` was missing from the regex's terminal-status alternation while the reconciling lexer had it, so events.rs:848 and :897 were silently dropped. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved; the census engine exempts a `-positive-control` id from the baseline requirement and the registry merge skips it by construction.",
    "$measured": "2026-08-15 @ bbb1a8864 — validated standalone in a scratch registry, then re-extracted from this document and re-run; 11 files / 15 matches both times."
  },
  "floor": 900
}
```

### Gates I rejected, with numbers

| candidate | violating | compliant | why rejected |
| --- | ---: | ---: | --- |
| **a durable claim with no lease** — the leaf's own thesis | **7** | **1** | The compliant form is `claim_for_instance`, which has **0 production callers** and, per D1, does not work. A gate firing on 7 of 8 members whose single positive example is both unused and broken is a to-do list, not a ratchet, and its positive control would be one match away from a structural zero. Carried as §2(b) and D1/D2/D3. |
| **a process-global id registry inserted into and never removed** (the Rust analogue of `module-scope-install-latch`) | 6 | 6 | **Precision 0/6.** Measured: 39 production `LazyLock<Mutex<Set\|Map>>` statics, 12 that insert, 6 with no removal — and all six are **caches or log-once dedupes** (`SCENARIO_CACHE`, `OPENAPI_SPEC_CACHE`, `mcp_tools::CACHE`, `SIDECAR_MISSING_LOG`, `WARNED`), not claims. No regex separates a cache from a claim; they are the same characters. Worse, the detector **missed the one true positive** (`SURFACED`, D5) because the insert goes through a local binding rather than the static's name. Two independent reasons to refuse. Carried as D5 and D8. |
| **a mutating cloud write with no state precondition** | **7** | **0** | The right condition (D4/D6) and **there is no compliant form to point at** — `SyncClient` cannot express one, so a positive control is impossible by construction and the rule would be an unratchetable list of 7. The honest instrument is the fix itself: ship `patch_conditional` (D6), after which the signal becomes "a mutating path without `&status=eq.`" and a control exists. Carried as D4/D5/D6. |
| **a queue pop split into a SELECT and a separate claim CAS** | 4 | 2 | Population 6, and **one of the 4 is the exemplar** — `reap_stuck_processing` deliberately lists candidates and then CASes each one, counting the losers as `raced`. Precision 3/4 at best over a 6-member population. Carried as §4 step 2 and D2. |
| **a lease column no query outside its own writer reads** | 1 | 0 | The single sharpest fact in this document (finding 3) and it is an **absence** dressed as a presence — `claimed_by_instance` occurs 12 times and the question is what does *not* occur. n=1. Carried as D1. |
| **a claim table with no DELETE** | 1 | — | An absence. "No statement anywhere deletes from this table" has no textual signal; it was found by enumerating every statement against the table, which is a program, not a matcher. Carried as D3, and it is the same limit `retention-and-pruning` and `terminal-state-and-recovery` both recorded. |

The pattern across those six rejections is worth stating plainly, because it is
the shape of this whole leaf: **taking work is a statement and giving it back is
the absence of one.** The census counts presences. So the gate lands on the one
member of the family that *is* a presence — the settle that forgot its fence —
and the other five findings are held by §7, by the type proposal, and by the
four-line replay test in §4 step 3 that this repo does not yet have.

## 12 Corrections to the brief

1. **"`companion/jobs/mod.rs` and `engine/persona_jobs.rs` … neither with a
   reaper" — WRONG, and the correction sharpens the defect rather than softening
   it.** Both have `recover_orphans` (`jobs/mod.rs:170`, `persona_jobs.rs:257`),
   both are called (`commands/companion/mod.rs:192`, `lib.rs:1375`), and both
   contain the word "orphan" beside the table name — so the "searched: zero hits
   for stale / stuck / orphan / timeout" in
   [conditional-write](./conditional-write.md) D8 was a failed search, not an
   absent function. What they actually have is a **boot pass that terminalises**:
   it writes `failed` rather than `queued` (the job is lost, not retried), it
   cannot run while the app is up, and at `lib.rs:1375` it runs **outside** the
   leadership gate that protects the worker loop 13 lines below. That is a worse
   finding than "no reaper", and it is the same defect
   [terminal-state-and-recovery](./terminal-state-and-recovery.md) D7 found for
   executions, now confirmed on two more tables.
2. **"`deliberation_capability_claims` … its only two statements repo-wide are an
   `INSERT OR IGNORE` and a `COUNT(*)`" — the `COUNT(*)` is a TEST HELPER.**
   `deliberation.rs:444` is `fn count_rows` inside `mod claim_capability_tests`
   (opens `:434`). **Production surface: one statement.** The table is written and
   never read by the application. Also new: the claim's single production caller
   (`commands/teams/deliberations.rs:228`) does **not** release it when the
   capability fails to start (`:285-298`), so a capability that never ran is
   suppressed for its whole group permanently.
3. **"There are ten reapers, not four" — accurate, and one more belongs on the
   list.** `companion::jobs::recover_orphans` and
   `persona_jobs::recover_orphans` make twelve if boot passes count — and whether
   they count is precisely the distinction this leaf turns on. **Seven of the
   twelve return work to a runnable state; five terminalise it.** Only
   `reap_stuck_processing` does so with an attempt ceiling.
4. **"`ascent`'s design is the best in the family — the lease IS the schedule
   column, so there is no reaper to forget" — CONFIRMED mechanically, and it is
   the strongest positive result in this sweep.** `org-watch.ts:209-217`,
   `CLAIM_LEASE_MS` at `:192`, `res.count === 1` at `:216` — all three line
   numbers land. The mechanism is in §6 clause 5. **Three caveats the brief
   omitted, in descending severity:** (a) the settle path
   (`advanceToFullCadence`, `:229-232`) has **no fencing token** and is an
   unconditional `update({where:{id}})`, unreachable today only because
   `maxDuration = 300` is shorter than the 15-minute lease — an undocumented
   invariant; (b) `vercel.json` runs the cron **daily**, so "re-qualifies on the
   next pass" is true of the *state*, not the *latency*; (c) there is **no attempt
   counter anywhere in ascent** — `lastScanAttemptAt` is a display field no
   predicate reads.
5. **"`brainiac` … a stale-`running` reaper (`RUNNING_STALE = "2 hours"`)" —
   REFUTED.** `sweeps.rs:46`'s constant is **conjoined** with `next_run_at <=
   now()`, and the claim already advanced `next_run_at` by a full cadence
   (`:244`), so a dead claimant waits `max(cadence, 2 h)` — **a week** for the
   7-day `library` sweep. `RUNNING_STALE` prevents a permanent wedge, not a stale
   one. This also corrects the "stale-reaper" cell in
   [conditional-write](./conditional-write.md) §6.
6. **"`automations::reap_stale_runs` … one file away from four unrelated
   hardcoded thresholds" — accurate and independently reinforced.** `brainiac`
   supplies the argument this repo is missing entirely: `queue.rs:5-14` and
   `:137-138` increment the attempt counter **on claim**, because a crash
   redelivery and a clean failure must consume the same budget. Personas
   increments on failure (`reap_stuck_processing`) or not at all. That is now
   §2(e), and it is the one prescription in this document sourced from a sibling
   rather than from here.
7. **"whether any claim is held across an `await` or a process boundary that
   outlives it" — yes, routinely, and the framing needs inverting.** Both
   `worker_tick`s hold a durable claim across the whole job; `chat_cards`'
   claim outlives the command that took it, because
   `execute_fleet_spawn` starts detached CLI sessions. But the convergence sweep
   found this in **5 of 5** siblings, including `brainiac` holding a claim across
   an entire LLM chain **by design** and `ascent` holding one across Next's
   `after()` — *past the HTTP response*. **Holding a claim across an await is not
   the defect; it is the normal case, and it is the reason a lease is mandatory
   rather than optional.** The defect is holding one across an await with no
   lease, which is 7 of this repo's 8 sites.
8. **Two findings the brief did not anticipate, both live.** (a)
   `remote_command_approve` is a read-then-write across a **network** boundary
   whose guard is a Rust `if` — executed, it double-runs and double-bills (D4).
   (b) `SyncClient::patch` hardcodes `Prefer: return=minimal` and returns
   `Result<()>`, so **no caller of the shared cloud transport can write a
   conditional write at all** (D6). The second is the contract's fifth §9 failure
   mode — a gate pointing at a broken destination — and it is the cheapest fix in
   this document.
9. **The leaf's `convergence: mixed` label survives, unusually.** Claiming is
   physics (5/5); leases are a minority (3/6); rearms are rarer (2/6); fencing is
   silence (0/6 durable); duplication is unanimous (6/6). A single label cannot
   carry that, which is what "mixed" should mean — and it is the first leaf in
   this batch whose spine label the oracle did not have to invert.
