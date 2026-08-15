# Golden path — Conditional write

> Situation node: `data-persistence/repository-access/conditional-write` ·
> [situation spine](../situation-spine.md) · recurrence 18 · risk **HIGH** ·
> sides: **server** · convergence: **diverged**
> Composed 2026-08-15 against `master` @ `2a874e692`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri`, lexed rather than
> grepped: **83,762** string literals extracted with a string/comment-aware Rust
> tokenizer, **3,604** of them holding SQL (**3,029** production, **575** inside
> **brace-matched** `#[cfg(test)]` ranges — never a line threshold). Production
> writes: **538 UPDATE + 285 DELETE + 500 INSERT = 1,323**. Every conditional
> write's *statement with its consequent* was then classified by three
> independent implementations (statement-prefix, enclosing-function, and
> call-extent), reconciled by hand where they disagreed, and **every one of the
> 12 defect sites in §7 was opened and read.**
>
> **Measured by execution, not by reading.** Seven race shapes were reproduced
> against real SQLite on a scratch file (`node:sqlite`), each transcribed
> verbatim from this repo's own statements — the CAS double-fire, the
> `last_insert_rowid()` trap, `RETURNING` on a conflict, the claim lease, the
> scraper's read-then-write, `changes()` semantics, and `INSERT OR IGNORE`
> as a claim. Read-only copies of the live `personas.db` (347 MB) and
> `personas_data.db` were queried; the live database is what proved §7 D1.
>
> **`cargo` was not run** (PreToolUse guard — the operator's app is running).
> Every Rust claim is static and traces to a file read during composition.
>
> ---
>
> ## The headline: the guard is right 82% of the time, and the repo's best guard has never run
>
> Only **65 of 823** production UPDATE/DELETE statements (**7.9%**) are
> *guarded single-row writes* — `WHERE id = ?N AND <something about the row's
> state>`. That is the whole CAS population. The other 92% is 395 bare
> `WHERE id = ?` writes, 341 set-scoped writes and 22 with no `WHERE` at all.
>
> | | n | share |
> | --- | --- | --- |
> | guarded single-row (`WHERE id = ? AND …`) — **this path** | **65** | 7.9% |
> | bare single-row (`WHERE id = ?`) — [`blind-identity-write`](#9-the-missing-gate)'s territory | 395 | 48.0% |
> | set-scoped (no `id = ?` term) | 341 | 41.4% |
> | no `WHERE` at all | 22 | 2.7% |
>
> Of the 65 guarded writes, **53 (82%) surface the affected-row count** and
> **12 (18%) drop it**. That is a much better number than this leaf's "diverged"
> label predicts, and it is worth saying plainly: **when this repo builds a lock,
> it usually reads it.** The 12 that do not are listed in §7 and are all fixable
> in one line each.
>
> Three findings are sharper than the ratio.
>
> **1. The best conditional-write primitive in the repo has zero production
> callers.** `executions::claim_for_instance`
> (`db/src/repos/execution/executions.rs:887-921`) is a CAS *with a TTL lease
> inside the `WHERE` clause* — the design the convergence sweep found
> independently reinvented in two sibling repos. Repo-wide search returns the
> definition and **five test call sites, and nothing else**. The live database
> agrees: of **2,188** executions, **0** have ever carried
> `claimed_by_instance`, and `build_sessions` — which was given the same two
> columns by the same migration (`db/src/migrations/incremental.rs:3631-3644`) —
> has **0 of 12**. The idea landed; the adoption never did.
>
> **2. That lease cannot actually rearm, and the doc comment says it can.**
> `executions.rs:875-877` reads *"The TTL-in-`WHERE` doubles as the stale-claim
> sweep: an expired claim is simply re-claimable, so no separate reaper task is
> needed."* Replayed: the claim predicate requires `status = 'queued'` **and** an
> expired lease. A claimant that dies leaves the row at `running`, which the
> predicate can never match; the only thing that touches stale `running` rows is
> `sweep_zombie_executions` (`:1706`), which writes `incomplete` — terminal.
> **Nothing anywhere sets an execution back to `queued`** (verified: the string
> appears in the claim predicate and in `get_queued`'s SELECT, nowhere else). A
> lease without a requeue partner is a comment, not a mechanism.
>
> **3. The claim-before-work loop is reinvented verbatim twice *inside this
> repo*.** `companion/jobs/mod.rs:305-338` and `engine/persona_jobs.rs:201-228`
> are the same eleven lines — SELECT the oldest `queued`, CAS it to `running`,
> `if updated == 0 { return Ok(None) }`, hand back the row with its status
> patched in memory — against two different tables, in two different modules,
> with no shared helper. **Neither has a reaper or a lease.** A worker that dies
> mid-job leaves its row `running` forever. So does
> `deliberation_capability_claims`, whose only two statements repo-wide are an
> `INSERT OR IGNORE` and a `COUNT(*)` (`db/src/repos/resources/deliberation.rs:260`,
> `:444`) — a claim table with no release path at all.
>
> ### What the convergence oracle actually returned
>
> Swept read-only against `personas-web`, `brainiac`, `personas-cloud`,
> `vibeman`, `ascent`. Full table in §6. Headline: **conditional writes and
> claim-with-lease are physics; checking a `DO NOTHING` result is INVERTED
> everywhere including here; and a type-level answer has NO TRACE in any of the
> six repos, including this one.**
>
> ### Sibling boundaries, settled in prose
>
> [**scheduled-trigger-firing**](./scheduled-trigger-firing.md) owns the *schedule*
> — when a trigger becomes due, the zone, the backfill. **This path owns the
> mechanism it claims with**, and extends it: that path called `mark_triggered`'s
> CAS "the claim"; this one measures how many of the repo's 65 guards are built
> the same way and what happens when they are not.
>
> [**entity-draft-editing**](./entity-draft-editing.md) owns the *client's*
> half — the diff, the baseline, the payload. **This path owns the predicate the
> server puts in the `WHERE` clause**, and corrects that document's count of
> client-supplied preconditions (§12).
>
> [**upsert**](./upsert.md) owns insert-or-update as a *merge*.
> **This path owns insert-or-nothing as a *claim*** — the case where the
> uniqueness constraint is the lock and `changes == 1` means "you created it".
>
> [**transaction-boundary**](./transaction-boundary.md) owns `tx` vs `conn`.
> **This path owns the case where a transaction is the wrong answer**: a single
> guarded statement is cheaper and stronger than BEGIN…SELECT…UPDATE…COMMIT, and
> §2 says when.
>
> [**repository-crud-surface**](./repository-crud-surface.md) owns whether a
> write reports that the row existed. **This path owns whether it reports that
> the row was still what you thought it was** — a different question with a
> different answer, which is why `blind-identity-write` and §9's rule are
> disjoint by construction.
>
> The **Deviations** section is a fix backlog and contains **one live user-facing
> defect** (D1) and eleven one-line repairs.

---

## 1 Trigger

- "Two ticks could both pick this up — how do I make sure only one wins?"
- "Only mark it done if it's still pending." / "Only save if nobody else edited it."
- "I read the row, then I write it — is that safe?"
- "Claim this job before I spend money on it."
- "Insert it if it isn't there." / "How do I know whether my insert actually happened?"
- "The worker crashed. Who unsticks the row it was holding?"

If you are about to type `WHERE … AND status =`, `AND version =`,
`INSERT OR IGNORE`, `ON CONFLICT … DO NOTHING`, `expected_`, `claim`, `lease`,
or to write a `SELECT` whose result decides the shape of the `UPDATE` two lines
below it — you are in this situation.

**Not this path:** *when* a scheduled row becomes due is
[scheduled-trigger-firing](./scheduled-trigger-firing.md); *merging* two
versions of a row is [upsert](./upsert.md); *reporting that the row did not
exist* is [repository-crud-surface](./repository-crud-surface.md); *which*
uniqueness constraint an `INSERT OR IGNORE` is silently resolving is
`unverifiable-conflict-clause` and [upsert](./upsert.md).

## 2 The one way

**Put the precondition in the `WHERE` clause of the write itself, and make the
affected-row count the function's return value — because a guard whose verdict
the caller cannot see is not a guard, it is a comment.** Write one statement:
`UPDATE t SET … WHERE id = ?1 AND <the thing you believe>`, bind the `usize` that
`execute()` returns, and give the function a signature that carries it —
`Result<bool>` when the caller only needs win/lose, `Result<usize>` when it needs
the size, `Result<T>` with an `AppError::Validation` on zero when the caller is a
user-facing command. Never `Result<()>`: **the unit type physically cannot carry
the one bit the guard produced**, and 5 of this repo's 12 dropped verdicts are
`Result<()>` functions whose own doc comments explain why the guard matters.
**Do not open a transaction to do a compare-and-set** — `BEGIN; SELECT; UPDATE;
COMMIT` is slower, holds a lock, and is *weaker* than the single statement unless
the isolation is `IMMEDIATE`; the one-statement form is atomic by construction
and `changes()` is exact (executed: a matched row that writes an identical value
still counts 1, so `changes == 0` means *the predicate failed* and never "the
value was already right"). **On a lost swap, re-read and say who won** — a bare
`false` makes the caller invent a message; `retry_dead_letter`
(`db/src/repos/communication/events.rs:1027-1069`) and `decide_idea_cas`
(`db/src/repos/dev_tools.rs:4456-4497`) both re-read to name the actual state,
and the wording is a contract the frontend matches on. **If the precondition
belongs to a human's screen, take it from the wire** — an `expected_status` the
client saw catches a load-to-save conflict; a pre-image the server reads in the
same request catches only its own microseconds, and only **3** endpoints here
take one. **If you are claiming work rather than deciding a row, the claim needs
an expiry AND something that rearms it**: a `claim_expires_at` column whose
predicate can only match rows in the pre-claim state is inert. Then stop: do not
add a mutex, do not add a `HashSet` of in-flight ids, and do not "just re-check
after the write".

## 3 Mandated primitives

**Exist today — use them:**

- **`db/src/repos/resources/triggers.rs:1715` `mark_triggered(pool, id, next, expected_version) -> Result<bool>`** —
  the canonical CAS on a monotonic version column. `Ok(false)` means another tick
  won. The doc comment (`:1709-1714`) is the best short statement of the whole
  mechanism in the tree.
- **`:1750` `advance_schedule_pointer`** — the same CAS that deliberately does
  *not* move the watermark. Two functions, one predicate, different `SET` lists:
  the shape to copy when "skip" and "fire" must be told apart.
- **`db/src/repos/communication/events.rs:1027` `retry_dead_letter`** — **the one
  site to copy.** One guarded `UPDATE` closes a cap-check TOCTOU (`:1031-1035`
  says so), then `if rows == 0` re-reads and splits the loss into three distinct
  `AppError`s. The SQL is hoisted to a `const` (`RETRY_DLQ_SQL`, `:1008`) so the
  single and bulk paths cannot drift — `:1005-1007` states that as the reason.
- **`db/src/repos/communication/events.rs:239` `claim_pending` / `:266`
  `claim_pending_headless`** — claim and read in **one** `UPDATE … RETURNING *`.
  Strictly stronger than SELECT-then-claim: there is no window, and the returned
  set *is* the count.
- **`db/src/repos/dev_tools.rs:4456` `decide_idea_cas(pool, id, expected, …)`** and
  **`db/src/repos/dev_workspaces.rs:797` `decide_knowledge_cas(…, expected: Option<&str>)`** —
  the client-supplied-precondition pair. `decide_knowledge_cas`'s doc comment
  (`:775-796`) is the most complete account of this leaf anywhere in the tree,
  including an honest statement of what `expected: None` degrades to.
- **`db/src/repos/resources/recipes.rs:490` `accept_version(…, expected_updated_at: Option<&str>)`** —
  optimistic lock on a timestamp, `updated_rows == 0` → roll the whole
  transaction back (`:571-576`). The only place a *long* client-side window
  (an LLM generation) is guarded.
- **`db/src/repos/execution/executions.rs:887` `claim_for_instance`** — the CAS
  with a TTL lease. **Adopt it; do not rebuild it.** See §7 D2 for the two things
  it needs first.
- **`src/lib/decisions/rowWrites.ts`** — the client half. One door per decidable
  row type, every door rejects on a failed write, every door carries the status
  the caller *saw*, and `isDecisionConflict` (`:98`) tells "your write failed" apart
  from "someone else already decided this" by matching five backend phrasings
  pinned in `__tests__/rowWrites.test.ts`.
- **`db/src/repos/resources/deliberation.rs:250` `claim_capability`** —
  `INSERT OR IGNORE` used correctly *as a claim*: `Ok(n == 1)`, with the doc
  comment naming the PRIMARY KEY as the arbiter (`:246-249`).
- **`db/src/repos/resources/remote_jobs.rs:273`** —
  `UPDATE … SET last_seq = last_seq + 1 WHERE id = ?1 RETURNING last_seq`. Atomic
  allocation with no read at all. Copy this before you write a `SELECT MAX(…)+1`.
- **Reapers that exist, as models:** `events::reap_stuck_processing` (`:961`),
  `automations::reap_stale_runs` (`:564`), `executions::sweep_zombie_executions`
  (`:1706`), `deliberation::reap_action` (`src/engine/deliberation.rs:1422`).

**Do NOT build:** a mutex or `HashSet` of in-flight ids (the write is the lock —
`src/engine/background.rs:2185-2198` documents why an in-memory guard cannot work
across the fire/execute boundary); a `SELECT … FOR UPDATE` (SQLite has none); a
`BEGIN; SELECT; UPDATE; COMMIT` where one guarded statement suffices; a fourth
copy of `pop_next_queued`.

## 4 Steps

1. **Name the belief.** Write down, in words, the sentence "this write is only
   correct if the row is still ____". If you cannot finish it, you want a bare
   `WHERE id = ?` write and [repository-crud-surface](./repository-crud-surface.md).
2. **Put it in the `WHERE` clause, not in an `if` above it.** `WHERE id = ?1 AND
   status = 'pending'`. One statement. Do not open a transaction for this.
3. **Decide who supplies the expectation.** If a *human* looked at a screen and
   then acted, the expectation must come **from the wire** (`expected_status`,
   `expected_updated_at`) — that is the only window worth guarding. If the
   caller is a loop that just read the row, a server-read pre-image is honest
   but small: say so in the doc comment, and **do not write a user-facing error
   promising to catch edits "since you loaded the page"** (§6 — a sibling ships
   exactly that lie).
4. **Bind the count and put it in the signature.** `let rows = conn.execute(…)?;`
   then `Ok(rows > 0)`. **This is the step that fails**: all 12 deviations in §7
   are a correct `WHERE` clause with a `Result<()>` above it.
5. **Branch on zero, and re-read to say who won.** `if rows == 0 { let actual =
   get_by_id(…)?; return Err(AppError::Validation(format!("… already decided as
   '{}' by a concurrent action", actual.status))) }`. The phrase matters:
   `rowWrites.ts:80-85` matches on it.
6. **If you are claiming work, add the expiry to the predicate — and add the
   thing that rearms it.** `AND (claimed_by IS NULL OR claim_expires_at < ?now)`
   only fires on rows in the pre-claim state, so you also owe a sweep that
   returns a dead claimant's row to that state. A lease and a reaper are one
   feature; shipping half is §7 D2.
7. **For insert-or-nothing, use `ON CONFLICT(<key>) DO NOTHING RETURNING id` and
   read the rows.** Executed: on a conflict `RETURNING` yields **zero** rows, so
   `query_row` raises `QueryReturnedNoRows` and the caller *cannot* proceed as if
   the insert happened. `INSERT OR IGNORE` gives you the same information only in
   a `usize` you have to remember to read — and 42 of 70 call sites here do not.
8. **And then stop.** Do not add a post-write verification read, a retry loop, or
   an in-memory guard. If the count came back 0, the world moved; report it.

## 5 Anti-patterns

- **A guarded `UPDATE` inside a `Result<()>` function.** *Failure:* the guard
  works — the data is safe — and the caller reports success anyway, so the
  user-visible consequence fires on a write that did nothing.
  `executions::set_claude_session_id` (`:713-724`) guards on
  `status = 'running'` because a completed run must not be resurrected; when the
  guard fires, the session id is silently absent and the resume path has nothing
  to resume with. **5 of 12 deviations are this exact shape.**
- **`let _ = <guarded write>;`** *Failure:* discards the `Err` *and* the verdict
  in one token. `src/engine/background.rs:2462` and `:2522` do this to
  `advance_schedule_pointer` while `:2638` and `:2807` — the other two skip paths
  in the same function — branch on it, and `:2638`'s comment explains precisely
  why the return matters.
- **`SELECT`, then `UPDATE`, on a pooled connection.** *Failure:* two callers
  read the same pre-image and both write. Executed against
  `engine/src/scraper.rs:195-240`'s exact shape: two pollers each see hash `H10`,
  each `UPDATE … WHERE dataset = ? AND key = ?`, **both get `changes = 1` and
  both return `ChangeKind::Changed`** — one change, two change events. Adding
  `AND content_hash = ?` to the same statement makes it 1 and 0. The repo already
  has the corrected form for the sibling table:
  `triggers::mark_triggered_with_hash` (`triggers.rs:1815`).
- **A transaction used as a substitute for a predicate.** *Failure:* a deferred
  transaction (`BEGIN`, not `BEGIN IMMEDIATE`) takes its read snapshot on the
  first *statement*, so a `SELECT` then an `UPDATE` can still lose — that is
  `deferred-read-then-write`'s whole subject. A guarded single statement needs no
  transaction and cannot have the bug.
- **`INSERT OR IGNORE` followed by using the id.** *Failure:* executed —
  `changes` came back **0** while `last_insert_rowid()` still reported **2**, the
  rowid of an unrelated earlier insert on the same connection. Child rows attach
  to the wrong parent with no error. (This repo is safe today only because
  `last_insert_rowid` appears **0 times** in the tree; it mints UUIDs instead.
  That is a lucky property of the id strategy, not a guard.)
- **A claim with no expiry.** *Failure:* the row is held forever by a process
  that no longer exists. `companion/jobs/mod.rs:322` and
  `engine/persona_jobs.rs:213` both claim `queued → running` correctly and
  neither table has any reaper (searched: zero).
  `deliberation_capability_claims` has no release path at all.
- **An expiry with nothing that rearms it.** *Failure:* worse than no expiry,
  because the column and the doc comment both claim the problem is solved.
  §7 D2.
- **Two copies of the same claim loop.** *Failure:* a fix to one is not a fix to
  the other. Already true here: `persona_jobs::request_cancel` (`:180`) gained a
  two-stage `queued → canceled` / `running → cancel_requested` CAS pair;
  `companion/jobs` never did.

## 6 Evidence

**The one site to copy: `db/src/repos/communication/events.rs:1027-1069`** —
`retry_dead_letter`. Read it as five decisions: (1) the SQL is a `const` shared
with the bulk path so the guard cannot drift (`:1004-1005`); (2) the predicate
carries **both** the state and the cap (`WHERE id = ?1 AND status = 'dead_letter'
AND retry_count < ?2`), so the cap is enforced by the write rather than by a
check above it, and the comment at `:1031-1035` names the TOCTOU that closes;
(3) the count is bound; (4) `rows == 0` re-reads and splits into `NotFound` /
`RetryExhausted` / raced; (5) the success path returns the fresh row. No
transaction, no lock, no retry.

Runner-up, for the *client-supplied* half: `db/src/repos/dev_tools.rs:4456`
`decide_idea_cas` plus its wire route (`src/api/devTools/devTools.ts:1059` →
`src/commands/infrastructure/dev_tools.rs:605` → the `WHERE id = ?4 AND status = ?5`
at `:4477`). And `db/src/repos/dev_workspaces.rs:775-796` for the doc comment,
which states the degraded mode instead of hiding it.

For claim-and-read in one statement: `events.rs:239-256` `claim_pending`.

### Convergence — 5 sibling repos

| clause | verdict | evidence |
| --- | --- | --- |
| **A write may carry a precondition beyond the primary key** | **PHYSICS** | Independently present in 4 of 5, in three unrelated stacks: `brainiac` 13 of 89 writes (sqlx/Postgres), `vibeman` 17 of 113 (better-sqlite3), `ascent` 12 of 68 (Prisma), `personas-cloud` 4 of 30. No shared code, no shared author convention, and each repo re-derives the rationale in its own comments. |
| **The affected-row count is the lock and must be read** | **PHYSICS, unevenly** | 50 checked vs 10 discarded across the four. `brainiac` is near-perfect (28 `rows_affected()` bindings, ~0 discards) and its `console.rs:225-242` returns `409 CONFLICT` on `rows_affected() == 0` with a written argument at `:219-224` for re-asserting the predicate despite an upstream `FOR UPDATE`. Personas' 82% sits between `brainiac` and `vibeman`. |
| **Claim before the billable step, with a lease** | **PHYSICS** | 9 claim sites across 4 repos, 8 with a release path, via three independent mechanisms: TTL-in-the-claim (`ascent` `CLAIM_LEASE_MS = 15 min`, `src/lib/db/org-watch.ts:192`, claim at `:209-217` returning `res.count === 1`; `brainiac` `queue.rs:135-166` visibility lease), stale-reaper (`brainiac` `RUNNING_STALE = "2 hours"`, `sweeps.rs:46`; `personas-cloud` 5 min; `vibeman` 10/30 min), and an attempts ceiling. **`ascent`'s is the best design in the family: the lease and the schedule are the same column, so there is no reaper to forget to run.** |
| **A `DO NOTHING` result is checked** | **INVERTED, and Personas is on the same side** | Siblings: **7 of 29 (24%)**. Personas: **28 of 70 (40%)**. Both are minorities. `vibeman` `goal-dependency.repository.ts:27-32` runs `INSERT OR IGNORE` then `SELECT … WHERE id = <the id it just generated>` and casts the `undefined` to the row type; `hall-of-fame.repository.ts:40-46` fabricates the timestamp it returns. The three sibling sites that *do* check each wrote a paragraph justifying it — evidence the default is the opposite. |
| **Read-then-write where a CAS belongs** | **PHYSICS, as a defect** | ~9 sibling sites, 4 in `personas-cloud`. The sharpest is `personas-web` `api/votes/route.ts`, which serializes its **filesystem** path against TOCTOU at `:180` with the comment *"serialize to prevent TOCTOU"* and leaves the **SQL** path at `:123-153` unguarded — same function, same author, same hazard, reasoning that did not carry across the storage boundary. Personas' equivalent is `engine/src/scraper.rs:195`. |
| **A CLIENT-supplied precondition on the wire** | **NO TRACE in 4 of 5 — and Personas leads the family** | `personas-web` 0, `brainiac` 0, `personas-cloud` 0, `vibeman` 0 (its 17 `409`s are duplicate/already-running guards, never edit conflicts). Only `ascent` reinvented it, three times. **Personas has three** (`expectedUpdatedAt`, and `expectedStatus` on two surfaces) — one more than any sibling. |
| **A 409 that promises more than its pre-image can deliver** | **CONFIRMED in `ascent`, ABSENT here** | `ascent` `api/recommendations/[id]/route.ts:116-122` returns *"This recommendation changed since you loaded it"* while the pre-image is read at `scans-recommendations.ts:54`, **in the same request** — the window is line 54 to line 121, microseconds, not the user's session. Its own guard comment (`:106-108`) describes the two-member race it cannot catch. Personas' equivalent degraded mode is `decide_knowledge_cas(expected: None)`, and `dev_workspaces.rs:785-788` **documents** it: *"the swap then runs against the status read in this call."* Same mechanism, opposite honesty. |
| **A TYPE that makes an unguarded conditional write unspellable** | **NO TRACE — 0 in all six repos** | No branded/newtype/opaque guard type anywhere (the one `__brand` hit, `vibeman/…/requirementId.ts:41`, brands an id string). **`#[must_use]` appears 0 times in `brainiac`'s crates.** Prisma's `updateMany` returns `{count}` whether or not the `where` carried a precondition; `better-sqlite3`'s `RunResult.changes` is identical for both. **Every repo in the family enforces this entirely through prose**, and — measurably — where the prose exists the code is right, and the discards cluster exactly where nobody wrote any. |

**The strongest single piece of evidence in the corpus is still the port.**
`personas-cloud`'s `triggerScheduler.ts:87` says *"Ported from desktop
engine/background.rs::trigger_scheduler_tick()"*. Its advance is
`UPDATE persona_triggers SET last_triggered_at = ?, next_trigger_at = ?,
updated_at = ? WHERE id = ?` (`packages/orchestrator/src/db.ts:1047-1050`),
against the original's `… WHERE id = ?3 AND trigger_version = ?4` /
`Ok(rows > 0)` (`triggers.rs:1724-1731`). **It is three degradations, not one:**
no version predicate, a `void` return so even a 0-row result is unobservable,
and — verified by grep — **`trigger_version` does not exist anywhere in
`personas-cloud`**. The column was dropped in the port, so the CAS is not
disabled, it is *unspellable*. The read and the write sit ~80 lines apart
(`triggerScheduler.ts:132` → `:214`). A careful engineer copying a file by hand
did not carry across a mechanism that lives in a `WHERE` clause and looks like
bookkeeping.

## 7 Deviations

Every entry is live on `master` @ `2a874e692`. All twelve dropped-verdict sites
were opened and read.

**D1 — `sweep_zombie_executions` writes a CAS, discards the verdict, and fires
the user-facing consequence anyway.** `db/src/repos/execution/executions.rs:1767-1781`.
The comment immediately above the statement reads *"CAS on the row's CURRENT
status: a queued execution that started running (or a running one that
completed) between the read and here must not be clobbered."* It is correct, and
the row is protected. But `update_stmt.execute(…)?` is in statement position, and
`:1793-1804` then pushes the id into `surface_ids` **unconditionally**. So an
execution that *completed successfully* in the window between the SELECT and the
UPDATE is correctly left alone in the database and is still reported to the user
as `"Execution stalled"`. This is the leaf's thesis in one function: **the guard
protected the data and the ignored verdict corrupted the story.**
*Fix:* `if update_stmt.execute(…)? == 0 { continue; }` before the supersession
check — one line.

**D2 — the lease that cannot rearm, plus the primitive nobody calls.**
`db/src/repos/execution/executions.rs:887-921`.
- The predicate is `WHERE id = ?1 AND status = 'queued' AND (claimed_by_instance
  IS NULL OR claim_expires_at IS NULL OR claim_expires_at < ?4)`. Replayed: a
  claimant that dies leaves `status = 'running'`, which the predicate cannot
  match; `sweep_zombie_executions` moves such a row to `incomplete`, terminal.
  **No production path ever puts an execution back to `queued`** —
  `ExecutionState::Queued` reaches `update_status` at exactly two call sites in
  the tree and both are tests. The doc comment at `:875-877` asserts the opposite.
  *Fix:* have `sweep_zombie_executions` requeue (`status = 'queued'`,
  `claimed_by_instance = NULL`) instead of terminating, when the row was claimed
  and the lease has expired; keep `incomplete` for rows that were never claimed.
- **0 production callers** (5 test call sites, `:2002-2043`). **0 of 2,188 live
  executions** have ever been claimed; **0 of 12 `build_sessions`**, which carry
  the same two columns from the same migration. The queued→running handoff the
  ADR describes has never executed.

**D3 — five `Result<()>` functions whose guard the caller cannot see.**
`db/src/repos/execution/executions.rs`:
- `:663` `set_launch_model_info` — two branches (`:675`, `:681`), guard
  `status IN ('queued','running')`.
- `:694` `set_model_used_actual` (`:701`) and `:713` `set_claude_session_id`
  (`:716`) — guard `status = 'running'`. The doc comments (`:653-658`, `:690-693`)
  explain that the guard exists to stop a completed run being resurrected as a
  permanent zombie — i.e. **firing is the expected case**, and it is silent.
  A silently-absent `claude_session_id` is an un-resumable run with no log line.
*Fix:* return `Result<bool>` (matching `update_status_if_running`, `:849-867`,
in the same file) and `tracing::debug!` on `false` at the call sites.

**D4 — same file, same table, same predicate, opposite discipline, 34 lines
apart.** `src/companion/brain/daily_goals.rs`:
- `:217` `edit_goals` — `UPDATE companion_daily_goal SET title = ?1 WHERE id = ?2
  AND status = 'active'` in a loop, count dropped, function returns the fresh
  snapshot. Editing a goal that was completed by another surface reports success
  and changes nothing.
- `:251` `toggle_goal` — identical predicate, `if updated == 0 { return
  Err(AppError::Validation(…)) }`.
*Fix:* copy `:251`'s three lines into the loop at `:217`.

**D5 — three more dropped verdicts, one line each.**
- `src/engine/director.rs:1016` and `:1025` — `let _ = conn.execute(…)`, guards
  `(icon IS NULL OR icon = 'compass')` and `(model_profile IS NULL OR TRIM(…) = '')`.
  The second's comment (`:1020-1023`) says the guard exists so a *user's* explicit
  model choice is never overridden — so `false` is the interesting outcome and it
  is thrown away along with any `Err`.
- `src/companion/brain/semantic.rs:301` — `reinforce_fact` guards
  `AND kind = 'fact'`; reinforcing a node that is no longer a fact returns `Ok(())`.
- `src/companion/brain/sleep_cycle.rs:1319` — guards `AND supersedes_id IS NULL`
  ("without clobbering a supersede it already carries"), then increments
  `stats.supersedes_applied` at `:1325` regardless. Same shape as D1, smaller blast radius.
- `src/commands/infrastructure/skill_usage.rs:220` — monotonic
  `AND ?2 < first_seen_at`; benign, listed for completeness.
- `src/db/lib.rs:1574` — legacy credential rename guarded on the old name;
  benign, boot-path.

**D6 — `let _ =` on the scheduler's skip paths.** `src/engine/background.rs:2462`
and `:2522` discard `advance_schedule_pointer`'s `Result<bool>` entirely, so a
lost CAS **and a database error** are both invisible; the trigger stays overdue
and is re-evaluated every 5 s forever. `:2638` and `:2807` — the other two skip
paths in the same function — branch on it, and `:2630-2637` explains why.
*Fix:* mirror `:2807`.
> These 2 are the **only** dropped verdicts among **31 production call sites of
> the repo's 21 `Result<bool>` guarded-write functions** — a 94% read rate. The
> type works; the problem is that only 21 of 65 guarded writes have one.

**D7 — read-then-write where the repo already owns the CAS.**
`engine/src/scraper.rs:195-240` `upsert_record`: `pool.get()`, `SELECT
content_hash`, `match`, `UPDATE … WHERE dataset = ?1 AND key = ?2`. No
transaction, no hash in the predicate. Executed (§5): two pollers both report
`ChangeKind::Changed` for one change, and every downstream count is inflated.
The corrected form for the sibling table is 40 files away —
`triggers::mark_triggered_with_hash` (`triggers.rs:1815`), whose doc comment
(`:1806-1813`) describes this exact race.
*Fix:* add `AND content_hash = ?` to the `Some(_)` arm and return
`ChangeKind::Unchanged` on 0 rows.
`src/engine/director.rs:1002-1029` is the same shape (SELECT id, then two
guarded UPDATEs) and is safe only because it runs once at boot.

**D8 — claim-before-work reinvented twice in-repo, neither with a lease.**
`src/companion/jobs/mod.rs:305-338` and `src/engine/persona_jobs.rs:201-228` are
character-for-character the same eleven lines against different tables. Both are
*correct* CASes. Neither table has a reaper (searched: zero hits for stale /
stuck / orphan / timeout against `companion_background_job` or
`persona_background_job`), so a worker killed mid-job leaves `running` forever.
`deliberation_capability_claims` is worse: its only two statements repo-wide are
the `INSERT OR IGNORE` claim (`deliberation.rs:260`) and a `COUNT(*)` (`:444`).
*Fix:* extract one `pop_next_queued<T>` helper that takes the table name and a
lease, and add a `reap_stale_jobs` beside `automations::reap_stale_runs`.

**D9 — 42 of 70 conditional inserts drop the only signal they have.**
`INSERT OR IGNORE` (65) + `ON CONFLICT … DO NOTHING` (5); **28 read the count,
42 do not**. Not all 42 are bugs — many are genuinely idempotent seeds — but
the class is undifferentiated: nothing distinguishes "I don't care" from "I
assumed it worked". The two correct spellings are already in the tree:
`claim_capability`'s `Ok(n == 1)` (`deliberation.rs:266`) and the
`RETURNING` form (26 statements use `RETURNING`, none of them on a
`DO NOTHING`).

**Structural — where the guards are.** Of the 65 guard predicates, **45 name
`status`** (69%), 3 name `trigger_version`, and the remaining 17 are one-offs
(`updated_at`, `phase`, `tier`, `promoted`, `draft_accepted`, `supersedes_id`,
`claimed_by_instance`, …). **There is exactly one version column in the
application** (`persona_triggers.trigger_version`) and exactly one timestamp
lock (`recipe_definitions.updated_at`). Everything else guards on a status
string, which is why §9's rule and `blank-filled-update-payload` keep landing
on the same tables.

## 8 Gaps

1. **`Result<()>` is a legal return type for a guarded write, and the compiler
   is content.** Rust's `Result` is `#[must_use]`, but the `bool` *inside* it is
   not: once `?` unwraps the `Result`, dropping the verdict is silent. `#[must_use]`
   appears **0 times** in this repo's Rust and 0 times in `brainiac`'s. There is
   no language-level answer available without introducing a type (see below).
2. **There is no shared claim primitive.** `pop_next_queued` exists twice,
   `claim_for_instance` once (uncalled), `claim_capability` once,
   `claim_continuation` once, `claim_pending` twice. Five shapes, no helper, no
   trait, no lease convention. This is the single highest-value extraction in
   this document and it is ~30 lines.
3. **A lease is not expressible as a column.** `claim_expires_at` is a `TEXT`
   column with no partner: nothing schedules the rearm, nothing validates that
   the claim predicate can reach an expired row, and D2 is the direct
   consequence. A lease is *three* things — an expiry column, a predicate that
   admits expired rows, and a sweep that restores the pre-claim state — and only
   the first is visible to a reviewer.
4. **The census cannot see a `prepare_cached` form.** SQL held in
   `prepare_cached(…)` and executed through a later `stmt.execute(…)` splits the
   statement from its consequent across an arbitrary distance. §9's rule misses
   exactly one real defect this way (D1) and it is disclosed rather than papered
   over.
5. **The census cannot express "must be zero".** The condition this document
   most wants to assert — *no guarded write may reach a `Result<()>`* — is a
   property of a function signature, not of a text span, and the population it
   would gate (§9) is designed to reach zero. When it does, the rule must be
   **deleted**, not baselined at 0.
6. **Nothing relates a guard to the state machine it is guarding.** 45 of 65
   guards compare `status` to a string literal. `ManualReviewStatus::validate_transition`
   exists for one table; every other status guard is a hand-written literal that
   no tool checks against the set of statuses that table can hold. A typo in a
   guard predicate is a permanent silent no-op, and it is indistinguishable from
   a correct guard that keeps losing.
7. **The client half has no shared token.** `rowWrites.ts` is excellent and it
   covers five decidable row types. The other ~35 update surfaces send no
   expectation at all, and there is no type that would make them.

## Prefer a type over a gate

**Answered before §9 was written, held against all seven qualifications, and the
honest answer for this leaf is: `#[must_use]` on a newtype gets 11 of the 12,
and no type at all reaches the twelfth.**

The proposal is narrow and it is the smallest thing that works:

```rust
/// The verdict of a guarded write. Constructible only by `guarded_execute`.
#[must_use = "a guarded write's row count IS the guard — branching on it is the \
              whole point of putting a predicate in the WHERE clause"]
pub struct Swap(usize);
impl Swap { pub fn won(&self) -> bool { self.0 > 0 } pub fn rows(&self) -> usize { self.0 } }

pub fn guarded_execute(conn: &Connection, sql: &str, p: impl Params) -> Result<Swap, AppError>;
```

`Swap` has a private field, so the only way to obtain one is to perform the
write. `#[must_use]` makes `guarded_execute(…)?;` in statement position a
compiler warning at every one of the 11 sites §9 counts — and, unlike the
current `Result<bool>`, it survives the `?`.

Held against the seven qualifications:

1. **A required prop carries only what it actually encodes.** `Swap` encodes
   exactly "this write's predicate matched N rows". `Result<()>` encodes
   "something happened", and the 12 deviations are the cost of that.
2. **Requiredness is orthogonal to closedness.** `Swap` is not *required* of
   anyone — it is what you get back. What it closes is the *drop*: the value
   cannot be silently discarded. This leaf's win is entirely in must-use-ness,
   not in requiredness, and that distinction is what rules out the obvious
   alternative of making `expected_version` a required parameter (which would
   change nothing — `mark_triggered` already requires one, and its callers are
   already 94% compliant).
3. **A type nobody constructs constrains nothing.** This is the qualification
   that decides the design. The repo already has a `Result<bool>` convention and
   it works: **29 of 31 call sites read the bool.** The convention fails not
   because callers ignore it but because **only 21 of 65 guarded writes ever
   produce one** — 44 write the guard inline in a function returning something
   else. So `Swap` must be produced by the *statement*, not by the repository
   function; a type at the function boundary would be constructed at 21 sites
   and constrain nothing at the other 44. `guarded_execute` is on the hot path
   by construction.
4. **A type anyone can construct authenticates nothing.** `Swap(usize)` with a
   private field cannot be forged outside its module. It does not need to
   *authenticate* anything — it needs to be **unignorable**, and `#[must_use]`
   is the only mechanism in Rust that delivers that for a value that has already
   passed through `?`. Note what this means for the sibling proposal a reader
   might expect here: a `Claimed<T>` handed to the work function is **weaker**,
   because `brainiac`'s `queue::Job` (`queue.rs:36-42`) is exactly that and all
   four of its fields are `pub` on a `#[derive(Clone)]` struct — a caller can
   fabricate one. The convergence sweep found that and it is the reason this
   document proposes the smaller type.
5. **Withholding beats requiring.** `guarded_execute` adds no parameter. It
   withholds one freedom: the freedom to evaluate a guarded write for its side
   effect alone.
6. **Withhold the dangerous freedom, not the answer.** The answer — "how many
   rows matched" — is fully available via `.won()` / `.rows()`. What is withheld
   is *not looking*.
7. **Withholding a requirement only helps when the requirement was forcing the
   bad value.** Directly applicable and it is why the *other* candidate is
   rejected. Making `expected_version: i32` optional (`Option<i32>`, as
   `decide_knowledge_cas` and `accept_version` already do) is the relaxation this
   qualification warns about: the caller supplies the weak value **voluntarily**,
   and `decide_knowledge_cas(…, None)` degrades from a client-supplied lock to a
   server-read pre-image with no signal at the call site. Relaxing that type is
   inert-to-harmful. **Withhold the construction (`Swap`), not the requirement.**

**And — the test the brief demands — does the type reach the code?** For 11 of
the 12 deviations, **yes**: the SQL is an argument to `conn.execute(sql, params)`
and the return value is a Rust expression the compiler sees. Changing the
callee's return type is a compile error at every one of them. **For the twelfth,
no**, and the boundary is worth naming precisely: `sweep_zombie_executions`
(D1) splits `prepare_cached("UPDATE …")` from `update_stmt.execute(params)`, so
a type on the *statement* handle would have to survive an arbitrary distance and
an arbitrary number of executions — `stmt.execute` is legitimately called in a
loop, where dropping each individual count and accumulating is correct
(`sync_staging.rs:150` does exactly that). A `#[must_use]` there would be wrong
more often than right.

More importantly, **no type reaches the predicate itself.** The guard lives
inside a SQL string literal: `AND status = 'pending'` is a *word in a string*.
`rustc` will happily compile `AND status = 'pendign'`, and the result is a write
that silently never fires — indistinguishable, at runtime, from a guard that
keeps losing. This is the same wall a sibling path hit at its INSERT sites, and
it is the reason §9's rule is a **ratchet on the consequent, not a check on the
predicate**: the consequent is Rust and can be typed; the predicate is text and
cannot.

**So the fix order is: (1) ship `Swap` + `guarded_execute` and migrate the 12;
(2) extract the claim primitive (Gap 2) with a lease and a rearm as one unit;
(3) keep §9's rule as the ratchet until (1) lands, then delete it.**

## 9 The missing gate

**The condition, stated stack-free:** *a write carries a precondition that only
its own affected-row count can report on, and the caller evaluates the write for
its side effect alone — so "the guard held" and "the guard fired" become the same
observable outcome.*

An adopting repo must re-derive its own proxy. This one keys on rusqlite's
`recv.execute("UPDATE …")` returning a `usize` in Rust statement position; a repo
using Prisma spells the identical condition as `await prisma.x.updateMany({where:
{id, status}})` with the `{count}` unread, and this pattern scores a structural
zero there while the condition is present at scale (measured: `vibeman` has 3
such sites, each with a comment explaining the guard it then discards).

**Existing rules checked for overlap first, by reading each definition rather
than its title:**

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| `blind-identity-write` | a repo fn returning `Result<(), AppError>` reaching an `UPDATE`/`DELETE` whose **entire** `WHERE` is `id = ?N`, count discarded | **The exact complement.** It requires the bare column `id` as the whole clause; this rule requires `id = ?N` **plus** a further predicate. Disjoint by construction, and together they cover the single-row write space. It is also scoped to `src-tauri/db/src/repos`; **8 of this rule's 11 matches are outside that root.** |
| `unverifiable-conflict-clause` | `INSERT OR IGNORE`/`OR REPLACE`/`REPLACE INTO` — *which* conflict is being resolved | Says nothing about whether the caller reads the result. Its 71 matches and this rule's 11 are different statements entirely (INSERT vs UPDATE). |
| `unatomic-sequence-rewrite` | an N-row ordering rewrite issued as N statements on a pooled conn | About atomicity of a *set* of writes; this is about the verdict of *one*. |
| `deferred-read-then-write` | a DEFERRED transaction whose first `tx` use is a `SELECT` that informs a later write | Covers the TOCTOU shape **inside a transaction**. D7 (`scraper.rs`) is on a pooled connection with no transaction and is invisible to it. |
| `blank-filled-update-payload` | a **client** payload naming fields the user never edited | Client-side, and about the `SET` list; this is server-side and about the `WHERE` list. |
| `optional-store-handle` | `Option<&DbPool>` at a boundary | Unrelated. |
| `untimed-repo-query`, `silent-row-skip`, `hand-rolled-fixture-ddl` | timing, row-mapping, test DDL | Unrelated. |

**None covers a guard whose verdict is discarded. Proposing one.**

**Precision 11/11 — every match opened and read** (§7 D1 excepted; see recall).
The population is **65** guarded single-row writes; the anchor
(`.execute(` + a guarded single-row `UPDATE` literal) sees **57** of them, and
partitions cleanly:

| | matches | files |
| --- | --- | --- |
| **anchor** — every guarded single-row `UPDATE` reached through `.execute(` | **57** | 35 |
| ↳ **violating** (statement position / `let _ =`) | **11** | 7 |
| ↳ **compliant** (bound, branched, `Ok(`, `+=`, match arm) — the positive control | **43** | 27 |
| ↳ residual: `if let Err(e) = conn.execute(…)` — the *error* handled, the *verdict* not | 3 | 3 |

**The partition is the control**, which is stronger than a ratio: 11 + 43 + 3 =
57 accounts for every anchor match, and the 3 residuals are a named family
(`chat_cards.rs:254` `release_claim`, `engine/mod.rs:2234`, and
`build_sessions.rs:831`) — each of which reasons about the no-op in a comment.
**19% of this repo's guarded single-row updates drop the verdict; 81% do not.**

**Two false-positive families are excluded BY CONSTRUCTION, not by allowlist:**

1. **A block-tail expression that *is* the bound value.**
   `src/commands/design/build_sessions.rs:826-840` is
   `let claimed = { let conn = state.db.get()?; conn.execute(…)? }; if claimed != 1 {…}`
   — the `;` after `get()?` looks like a statement boundary to the anchor. It is
   removed by requiring the match to **terminate in `;`**, which the block-tail
   form does not (`)?` `\n` `}` `;`). This was the pattern's only false positive
   and the refinement took it to 11/11.
2. **A guarded write whose count is accumulated.**
   `report.relinked += conn.execute(…)?` (`dev_tools.rs:7623`) and
   `changed += stmt.execute(…)?` (`sync_staging.rs:150`) are correct; `+=` is in
   the compliant alternation.

**Two recall gaps, both disclosed with a number:**

1. **`prepare_cached` splits the statement from its consequent.** 8 of the 65
   guarded writes hold their SQL in `prepare_cached(…)`/`prepare(…)` and execute
   it later through a `stmt` handle. One of them is a real defect — **D1,
   `sweep_zombie_executions`** — so recall on the defect set is **11/12 (92%)**
   and the one miss is the *most* consequential entry in §7. Closing it needs
   dataflow, i.e. an ESLint-equivalent with type information (there is none for
   Rust here) or a clippy lint. **§7 D1 must therefore be fixed by hand; the gate
   will not remind anyone.**
2. **`DELETE` is not covered.** The population holds 2 guarded single-row
   DELETEs, both compliant today (`automation_suggestions.rs:245`, `:277`).
   Widening the pattern to `UPDATE|DELETE` adds no matches now and would make the
   count less legible; left out deliberately, stated here so the next author does
   not think it was missed.

**Fail-loud** is inherited from the runner: a walk below `floor: 900` (the tree
is 963 `.rs` files), a rule matching zero files, a stale `exclude`, a rise, **and
a silent drop** all exit non-zero.

**Zero matches sit inside `#[cfg(test)]`.** Verified by brace-matched range
against all 11 — and structurally: the lexer finds **0** guarded single-row
writes anywhere in the tree's 575 test-range SQL statements. The test-fixture
contamination that sank the sibling path's INSERT gate at 44% precision **does
not exist for this condition**, because tests here assert against helper
constructors rather than hand-writing guarded SQL.

**Validated standalone** in a composer-private registry
(`registry-conditional-write-composer.json`, a filename unique to this composer
because siblings share the scratchpad), then **re-extracted from this finished
document and re-run — both runs report `files 7 / matches 11` for the gate and
`files 27 / matches 43` for the control**, over 963 files against a floor of 900.

> **One thing learned building it, worth carrying forward.** The obvious spelling
> of "whitespace or comment lines" — `(?:\s|//[^\n]*)*` — is a nested-quantifier
> bomb: both branches can match the same span, and the engine hung past 120 s on
> the 963-file walk and had to be killed. The published form is
> `\s*(?://[^\n]*\n\s*){0,6}` — bounded, and unambiguous because `//` cannot be
> matched by `\s`. A census pattern must be checked for catastrophic backtracking,
> not only for precision.

### The rule

```json
{
  "rules": [
    {
      "id": "discarded-guard-verdict",
      "goldenPath": "docs/concepts/golden-paths/conditional-write.md",
      "title": "A single-row UPDATE carrying a state guard in its WHERE clause is executed in statement position, so the affected-row count that IS the guard's verdict is dropped",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "(?:[;{}]|\\blet\\s+_\\s*=)\\s*(?://[^\\n]*\\n\\s*){0,6}(?:[A-Za-z_]\\w*\\s*\\.\\s*)*[A-Za-z_]\\w*\\s*\\.\\s*execute\\s*\\(\\s*\\n?\\s*\"\\s*\\n?\\s*UPDATE\\s+[A-Za-z_]\\w*\\s+SET(?:[^\"\\\\]|\\\\[\\s\\S])*?\\bWHERE\\b(?:[^\"\\\\]|\\\\[\\s\\S])*?\\bid\\s*=\\s*\\?\\d+(?:[^\"\\\\]|\\\\[\\s\\S])*?\\bAND\\b(?:[^\"\\\\]|\\\\[\\s\\S])*?\"(?:[^;]{0,400}?)\\)\\s*(?:\\.\\s*map_err\\s*\\((?:[^()]|\\([^()]*\\))*\\)\\s*)?\\??\\s*;",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a rusqlite `<recv>.execute(\"UPDATE <table> SET ... WHERE ... id = ?N ... AND ...\", ..);` whose STATEMENT TERMINATES IN A SEMICOLON - i.e. the usize that execute() returns is evaluated for its side effect and dropped. PROXY FOR the stack-free condition: a write carries a precondition that only its own affected-row count can report on, and the caller evaluates the write for its side effect alone, so 'the guard held' and 'the guard fired' become the same observable outcome. THE SHAPE IS NOT AN ACCIDENT OF THE AUTHOR: `id = ?N` plus at least one FURTHER predicate is a deliberate compare-and-set - somebody wrote down a belief about the row's state and asked SQLite to enforce it - and rusqlite hands back the only evidence of whether it held. EXECUTED, not argued (node:sqlite, 2026-08-15, statements transcribed verbatim from this tree): replaying triggers.rs:1725's CAS with two ticks that both read trigger_version = 0 gives changes 1 and 0, so exactly one wins and a caller that ignores the count publishes twice; and `UPDATE t SET s='same' WHERE id=? AND s='other'` returns 0 while `UPDATE t SET s='same' WHERE id=?` on a row already holding 'same' returns 1 - so changes==0 means THE PREDICATE FAILED and never 'the value was already right', which is exactly what makes the count usable as a lock. MEASURED 2026-08-15 at 2a874e692: 11 matches across 7 of 963 .rs files, ALL ELEVEN OPENED AND CONFIRMED (precision 11/11), commentMatchesSkipped 0. Population and partition: a whole-tree Rust lexer (string/comment aware, #[cfg(test)] removed as BRACE-MATCHED RANGES) finds 823 production UPDATE/DELETE statements of which 65 are guarded single-row writes; this pattern's anchor sees 57 of them and splits them 11 violating / 43 compliant / 3 residual, the residual being `if let Err(e) = conn.execute(..)` which handles the ERROR but not the VERDICT (commands/companion/chat_cards.rs:254, engine/mod.rs:2234, commands/design/build_sessions.rs:831) - so 19% of this repo's guarded single-row updates drop the verdict and 81% do not. The 11: execution/executions.rs:675 and :681 (set_launch_model_info, both branches), :701 (set_model_used_actual), :716 (set_claude_session_id) - four Result<()> fns whose own doc comments at :653-658 and :690-693 say the status guard exists to stop a completed run being resurrected as a permanent zombie, i.e. FIRING IS THE EXPECTED CASE and it is silent, and a silently-absent claude_session_id is an un-resumable run with no log line; engine/director.rs:1016 and :1025 (`let _ =`, guards `icon IS NULL OR icon = 'compass'` and `model_profile IS NULL OR TRIM(..) = ''`, the second's comment at :1020-1023 saying the guard exists so a USER'S explicit model choice is never overridden - so false is the interesting outcome); companion/brain/daily_goals.rs:217 (edit_goals, `WHERE id = ?2 AND status = 'active'` in a loop) which is 34 lines from :251 (toggle_goal) where the IDENTICAL predicate is followed by `if updated == 0 { return Err(..) }` - same file, same table, opposite discipline; companion/brain/semantic.rs:301 (reinforce_fact, `AND kind = 'fact'`); companion/brain/sleep_cycle.rs:1319 (`AND supersedes_id IS NULL`, then increments stats.supersedes_applied at :1325 regardless); commands/infrastructure/skill_usage.rs:220 (monotonic `AND ?2 < first_seen_at`, benign); db/src/lib.rs:1574 (legacy credential rename, boot path, benign). NOT EVERY MATCH IS A LIVE BUG AND THE RULE DOES NOT CLAIM SO - two are benign and are carried so the count is a population rather than an opinion. TWO FALSE-POSITIVE FAMILIES EXCLUDED BY CONSTRUCTION, NOT BY ALLOWLIST: (a) a block-tail expression that IS the bound value - commands/design/build_sessions.rs:826-840 is `let claimed = { let conn = state.db.get()?; conn.execute(..)? }; if claimed != 1 {..}`, where the `;` after get()? reads as a statement boundary - removed by requiring the match to TERMINATE IN `;`, which the block-tail form (`)?` newline `}` `;`) does not; (b) an accumulated count - `report.relinked += conn.execute(..)?` at dev_tools.rs:7623 and `changed += stmt.execute(..)?` at companion/brain/sync_staging.rs:150 are correct, and `+=` sits in the positive control's alternation instead. TWO DISCLOSED RECALL GAPS: (1) 8 of the 65 guarded writes hold their SQL in prepare_cached(..)/prepare(..) and execute it later through a stmt handle, splitting the statement from its consequent - one of those is the single most consequential defect in the golden path (db/src/repos/execution/executions.rs:1767-1781, sweep_zombie_executions, whose comment says 'CAS on the row's CURRENT status ... must not be clobbered' and which then pushes the id into surface_ids UNCONDITIONALLY at :1804, so an execution that COMPLETED in the race window is correctly left alone in the database and still reported to the user as 'Execution stalled') - so recall on the defect set is 11/12 (92%) and that one must be fixed by hand; (2) DELETE is deliberately not covered - the population holds 2 guarded single-row DELETEs and both are compliant, so widening adds nothing today. ZERO MATCHES INSIDE #[cfg(test)], verified by brace-matched range against all 11 and structurally: the lexer finds 0 guarded single-row writes among the tree's 575 test-range SQL statements, because tests here assert through helper constructors rather than hand-writing guarded SQL - the test-fixture contamination that sank a sibling path's INSERT gate at 44% precision does not exist for this condition. DOES NOT OVERLAP `blind-identity-write`, WHICH IS ITS EXACT COMPLEMENT: that rule requires the ENTIRE WHERE clause to be the bare `id = ?N`, this one requires `id = ?N` PLUS a further predicate, so the two are disjoint by construction and together cover the single-row write space; it is also scoped to src-tauri/db/src/repos and 8 of these 11 matches are outside that root. Nor `unverifiable-conflict-clause` (INSERT-side, about WHICH conflict rather than whether the caller looked), nor `deferred-read-then-write` (the TOCTOU shape INSIDE a transaction; engine/src/scraper.rs:195's read-then-write is on a pooled connection and invisible to it), nor `unatomic-sequence-rewrite`, nor the client-side `blank-filled-update-payload`. PRECONDITION (must be re-derived per repo): this repo executes SQL through rusqlite's `.execute(sql, params)` with the statement as a string literal argument, spells its primary key `id`, and binds parameters as `?N`. A repo on Prisma spells the identical condition as `await prisma.x.updateMany({where:{id, status}})` with `{count}` unread and scores a structural zero here while having the condition at scale - vibeman has 3 such sites, each with a comment explaining the guard it then discards. A REGEX NOTE PAID FOR IN A KILLED PROCESS: the obvious spelling of the comment-tolerant gap, `(?:\\s|//[^\\n]*)*`, is a nested-quantifier bomb (both branches match the same span) and hung the 963-file walk past 120s; the published `\\s*(?://[^\\n]*\\n\\s*){0,6}` is bounded and unambiguous because `//` cannot be matched by `\\s`. LEGAL FIX, one line each: bind the count and branch on it - db/src/repos/communication/events.rs:1027-1069 (retry_dead_letter) is the shape to copy, and db/src/repos/execution/executions.rs:849-867 (update_status_if_running) is the minimal Result<bool> form in the same file as four of these matches. Do NOT silence a match by wrapping the call in a block whose value is bound but never read (that defeats the pattern without fixing anything) or by adding `.ok()` (which discards the Err too). END OF LIFE: this rule is designed to reach zero - all 11 are removable, and the golden path's 'Prefer a type over a gate' proposes a #[must_use] Swap(usize) newtype returned by a guarded_execute helper, which makes the shape a compiler warning at all 11 and deletes the rule's reason to exist. When the count reaches 0 the runner fails structurally on zero-matches BY DESIGN: DELETE the rule then, do not baseline it at 0."
      },
      "baseline": { "files": 7, "matches": 11 },
      "floor": 900
    }
  ]
}
```

### Positive control (evidence, NOT merged as a gate)

The same anchors pointed at the **compliant** form. It **partitions** the
anchor's 57 raw matches rather than merely producing a ratio: 11 violating + 43
compliant + 3 named residuals = 57, exactly.

```json
{
  "id": "discarded-guard-verdict-positive-control",
  "goldenPath": "docs/concepts/golden-paths/conditional-write.md",
  "title": "POSITIVE CONTROL - the same guarded single-row UPDATE whose affected-row count IS bound or branched on",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "(?:\\blet\\s+(?:mut\\s+)?(?!_\\s*=)[A-Za-z_]\\w*\\s*(?::[^=;]{0,40})?=|\\bif\\b|\\bmatch\\b|=>|\\bOk\\s*\\(|\\+=)\\s*(?://[^\\n]*\\n\\s*){0,6}(?:[A-Za-z_]\\w*\\s*\\.\\s*)*[A-Za-z_]\\w*\\s*\\.\\s*execute\\s*\\(\\s*\\n?\\s*\"\\s*\\n?\\s*UPDATE\\s+[A-Za-z_]\\w*\\s+SET(?:[^\"\\\\]|\\\\[\\s\\S])*?\\bWHERE\\b(?:[^\"\\\\]|\\\\[\\s\\S])*?\\bid\\s*=\\s*\\?\\d+(?:[^\"\\\\]|\\\\[\\s\\S])*?\\bAND\\b(?:[^\"\\\\]|\\\\[\\s\\S])*?\"",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL, not a gate. The IDENTICAL SQL-literal anchor as discarded-guard-verdict, preceded by a binding or a branch instead of a statement boundary: `let rows =`, `if`, `match`, a `=>` arm, `Ok(`, or `+=`. `(?!_\\s*=)` is load-bearing - without it `let _ = conn.execute(..)` matches BOTH rules and the partition leaks by exactly the two engine/director.rs sites that are the clearest violations in the set. Measured 2026-08-15 at 2a874e692: 43 matches across 27 files against the gate's 11 across 7. This is a PARTITION, not a ratio: an anchor counting every guarded single-row UPDATE reached through .execute( matches 57, and 11 + 43 + 3 = 57 exactly, where the 3 residuals are `if let Err(e) = conn.execute(..)` (chat_cards.rs:254 release_claim, engine/mod.rs:2234) plus the block-tail form at build_sessions.rs:831 - a named family that handles the ERROR but not the VERDICT, and every one of the three reasons about the no-op in a comment. So the gate discriminates on what happens to the usize, not on the token `execute` or on the word UPDATE: 81% of this repo's guarded single-row updates already read their verdict. If this control's count ever collapses toward the gate's, the shared anchor has broken and BOTH numbers are meaningless - that is the failure this control exists to make visible. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved; scripts/census/lib/engine.mjs:377 exempts a `-positive-control` id from the baseline requirement and merge-published-rules.mjs skips it by construction."
  },
  "floor": 900
}
```

### Refused: a gate on unchecked conditional INSERTs — with the numbers

The larger population is the INSERT side: **70 production
`INSERT OR IGNORE` / `ON CONFLICT … DO NOTHING` statements, of which 42 (60%)
discard the affected-row count.** It is not gated, for two measured reasons.

| candidate | matches | true positives | precision |
| --- | --- | --- | --- |
| **A** — `INSERT OR IGNORE` / `DO NOTHING` in statement position | 42 | **indeterminate** | — |
| **B** — A, restricted to statements followed within 400 chars by a use of the inserted row's id | 0 | 0 | n/a |

**Candidate A cannot be scored**, and that is the finding. Unlike the UPDATE
side — where a guard predicate is *always* deliberate, because nobody writes
`AND status = 'pending'` by accident — a discarded `INSERT OR IGNORE` count is
genuinely ambiguous: many of the 42 are idempotent seeds where "already there" is
the expected and correct outcome (`db/src/lib.rs:1767`, `:1804`, `:1855` seed
built-in catalogs on every boot). A rule that fires on all 42 would be right
about the *shape* and wrong about the *defect* more often than not, and the
contract rules that out.

**Candidate B returns zero, because the specific hazard is absent here.**
`last_insert_rowid` appears **0 times in 963 files** — this repo mints UUIDs
client-side, so the executed trap from §5 (`changes = 0` while
`last_insert_rowid()` reports an unrelated row) has no purchase. The sibling
repos are not so lucky: `vibeman`'s `goal-dependency.repository.ts:27-32` and
`idea-dependency.repository.ts:37-42` both `INSERT OR IGNORE` and then
`SELECT … WHERE id = <the id they just generated>`, casting the `undefined` to
the row type.

**Refused, with the measurement rather than an opinion.** What would make it
gateable, in order of preference:
1. **Make the correct spelling the only one.** `ON CONFLICT(<key>) DO NOTHING
   RETURNING id` read through `query_row` cannot be ignored — the miss arrives as
   `QueryReturnedNoRows`. If the repo migrated, the signal becomes "an
   `INSERT OR IGNORE` exists at all", which `unverifiable-conflict-clause`
   already counts (71 matches) for an adjacent reason. **The two gates would
   merge, which is the right outcome.**
2. Split the population by intent at the type level — a `seed_or_ignore` helper
   that returns `()` and a `claim_or_lose` helper that returns `Swap` — after
   which the shape alone carries the intent and a gate becomes trivial.

### What the census fundamentally cannot gate here

Two conditions in this document have no textual signal at all:

- **A guard predicate that can never match.** `AND status = 'pendign'` compiles,
  runs, affects 0 rows forever, and is indistinguishable at runtime from a guard
  that keeps losing. 45 of the 65 guards compare `status` to a string literal
  that nothing checks against the values that column can hold. Closing this needs
  a *runtime* instrument — a counter per guarded statement that raises when a
  guard has fired 100% of the time over N calls — not a matcher.
- **A claim with no rearm.** D2's defect is that three separate things (an expiry
  column, a predicate that admits expired rows, and a sweep that restores the
  pre-claim state) must all exist and agree. Two of the three are present and the
  code reads correct; the missing one is the *absence* of a statement elsewhere
  in the tree, and the census can only count presences. The honest instrument is
  a test: claim a row, advance the clock past the lease, assert a second claimer
  wins. `executions.rs:2022-2044` (`test_claim_expired_is_reclaimable`) writes
  exactly that test, and it passes — because **the test performs the requeue
  itself**, calling `update_status(…, ExecutionState::Queued)` between the
  expired claim and the fresh one, with the comment *"Re-queue it, then a fresh
  claim must win."* The test is honest about what it needs. **The step it
  hand-writes is the step production does not have**: `ExecutionState::Queued`
  reaches `update_status` at exactly two places in the tree and both are tests
  (`executions.rs:2037`, `process_session.rs:585`). A test that supplies its
  subject's missing precondition proves the statement and not the system, and
  no matcher can tell those two apart.
