# Golden path — Transaction boundary

> Situation node: `data-persistence/repository-access/transaction-boundary` ·
> [situation spine](../situation-spine.md) · recurrence ~106 · dimensions:
> resilience · function · performance
> Composed 2026-08-14 from a ground-truth sweep of the Rust data layer against
> `master` @ `eafabdc6d` — **963 `.rs` files walked**, ~55 tool calls, two
> independent implementations of the deviation scan cross-checked against each
> other, and **one empirical SQLite probe** (SQLite 3.53.0 under this repo's own
> `STANDARD_PRAGMAS`) whose result is the substance of §2. `target/**` and
> `.claude/worktrees/**` excluded from every count; `#[cfg(test)] mod tests`
> bodies excluded unless stated. Shared counts cited from
> [`shared-facts.json`](../shared-facts.json), not re-derived.
>
> **Sibling leaves, read them for their halves:**
> [`schema-change.md`](./schema-change.md) owns *designing* a migration,
> [`boot-migration-step.md`](./boot-migration-step.md) owns *how a migration
> behaves on the 400th boot*, and [`delete-semantics.md`](./delete-semantics.md)
> owns *what a delete must reach*. This path owns the one question none of them
> settles: **which writes must land together, on which connection, opened with
> which lock, and who calls `commit`.**
>
> The **Deviations** section is a fix backlog.

## Principle

> *Every clause below is tagged with its warrant — **[physics]** (a property of
> the storage engine or of concurrency itself), **[ergonomics]** (a design that
> makes the physics hard to get wrong), or **[local]** (calibration to this
> repo). Only the first two travel. This tagging is
> [`research/portability-test.md`](../research/portability-test.md)
> recommendation #2, applied.*

1. **A transaction is a property of one connection, not of a pool.** A helper
   that receives a pool and acquires a connection twice cannot be atomic across
   those two acquisitions, no matter what it is named. **[physics]**
2. **A transaction that observes state before it mutates state must take its
   write lock up front.** Under snapshot isolation, a transaction that reads
   first and writes second can be invalidated by any writer that committed in
   between, and no amount of waiting repairs it. **[physics]**
3. **The set of writes that must be true together is the transaction.** It is
   decided by the invariant, never by which repository function you happened to
   be inside. **[physics]**
4. **A single conditional write beats a transaction.** If the invariant can be
   expressed as `UPDATE … WHERE <the state I saw>` and "zero rows affected"
   means "someone else won", you do not need a transaction at all — and the
   version that re-reads before writing is strictly worse. **[physics]**
5. **The function that opens the transaction is the function that commits it.**
   A helper that takes a connection handle and does not commit is composable; a
   helper that takes a pool and commits is a boundary. Say which one you are in
   the signature. **[ergonomics]**
6. **Hold the lock for writes only.** Compute, parse, encrypt, call the network
   — all of it happens outside the transaction. **[ergonomics]**

## Trigger

- "These two writes have to happen together." / "Make this atomic."
- "Two of these got created at once." / "The count is off after a concurrent run."
- "Why did this fail with `database is locked` when the timeout is 5 seconds?"
- "Read the row, bump the counter, write it back."
- "Delete the parent and its children." / "Insert the record and its audit row."
- "Claim this job so only one worker picks it up."
- "Should this repo function take the pool or the connection?"

If you are about to type `conn.transaction()`, `unchecked_transaction()`,
`pool.get()` a second time in one function, a `SELECT` whose result decides an
`INSERT`, or two `conn.execute` calls in a row — you are in this situation.

## The one way

**Decide the invariant first, then pick exactly one of three shapes, and never
mix them.** (a) If the invariant is expressible as one statement — including
`INSERT … ON CONFLICT DO UPDATE`, `UPDATE … WHERE <expected state>`, or
`DELETE … WHERE`— write that one statement, take no transaction, and treat
`rows_affected == 0` as "a concurrent actor won", not as an error;
`decide_idea_cas` (`db/src/repos/dev_tools.rs:4456`) and `claim_continuation`
(`db/src/repos/execution/audit_incidents.rs:549`) are the two shapes to copy,
and note that the CAS predicate carries **the state the caller saw**, never a
fresh re-read. (b) If two or more statements must land together, take **one**
connection with `let mut conn = pool.get()?` and open
`conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?`
**whenever any read inside that transaction informs any write inside it** —
which is nearly always — because `conn.transaction()` and
`conn.unchecked_transaction()` both emit a bare `BEGIN` (deferred), and a
deferred transaction that reads before it writes fails its lock upgrade with
`SQLITE_BUSY_SNAPSHOT` **in 0 ms, without consulting `busy_timeout` at all** —
measured, below. Deferred is correct for exactly two cases: a batch that only
writes, and a multi-statement *read* snapshot. (c) If the writes span two
repository functions, do **not** open a transaction in each: pass
`tx: &rusqlite::Transaction<'_>` down and let the caller commit — the shape
`insert_credential_and_fields_tx` (`db/src/repos/resources/credentials.rs:241`,
*"Does NOT commit — the caller owns the transaction lifecycle"*) and the whole
import path in `src/commands/core/data_portability.rs` already use. Then
**stop**: do all parsing, encryption, JSON merging and network work before
`BEGIN`; never call `pool.get()` again inside the transaction; never open a
transaction across `personas.db` and `personas_data.db` (two files, two pools —
it is not possible, see Gaps #1); and never name a function `*_atomic` unless it
holds the write lock for the whole read-modify-write.

## Mandated primitives

- **`rusqlite::Connection::transaction_with_behavior(TransactionBehavior::Immediate)`** — emits `BEGIN IMMEDIATE`, taking the write lock before the first statement. **The default choice for any read-then-write.** 17 sites today, each with a written rationale (§Evidence).
- **`rusqlite::Connection::transaction()`** — emits `BEGIN` (deferred; verified at `rusqlite-0.38.0/src/transaction.rs:415-417` → `self.transaction_behavior`, default `Deferred`, rendered at `:121`). Takes `&mut self`, so the borrow checker forbids a second live transaction on the same connection. **Correct for write-only batches and for read-only snapshots.**
- **`rusqlite::Connection::unchecked_transaction()`** — the same deferred `BEGIN` via `&self` (`:465-467`). It exists only to escape the `&mut` borrow when the connection is behind a shared reference. **Prefer `transaction()`; `unchecked_transaction()` gives up rusqlite's nesting check for nothing** (`delete-semantics.md:84` reaches the same conclusion independently).
- **`db/src/lib.rs:201-208` — `STANDARD_PRAGMAS`.** `foreign_keys = ON`, **`busy_timeout = 5000`**, `synchronous = NORMAL`, `page_size = 4096`, `mmap_size = 268435456`, `temp_store = 2`, `analysis_limit = 1000`, `cache_size = -2000`. Applied on **every** pool acquire by both customizers via `apply_standard_pragmas` (`:212`). Read this before reasoning about any lock.
- **`db/src/lib.rs:322` / `:519` — `PRAGMA journal_mode = WAL`.** Database-wide, set once. WAL is what makes a reader and a writer coexist — and what makes rule 2 of the Principle bite.
- **`db/src/lib.rs:313-314` — `Pool::builder().max_size(12)`** for `personas.db`; **`:510-511` `max_size(8)`** for `personas_data.db`. **Twelve connections is twelve independent transaction scopes.** This number is the entire reason this path exists.
- **`db/src/repos/core/personas.rs:826` — the reference `BEGIN IMMEDIATE`.** Read the comment at `:818-825`; it states the race, the TOCTOU, the absent unique constraint and why IMMEDIATE closes it. **Copy this one.**
- **`db/src/repos/resources/credentials.rs:241` — `insert_credential_and_fields_tx(pool, tx, …)`.** The composition signature: takes both, commits neither.
- **`db/src/repos/dev_tools.rs:4456` — `decide_idea_cas`.** The compare-and-swap reference, including the doc comment explaining why `expected` is the caller's observation and not a re-read.
- **`db/src/repos/execution/audit_incidents.rs:549` — `claim_continuation`.** The one-statement claim: `UPDATE … WHERE id = ?1 AND continued_at IS NULL`, `Ok(rows > 0)`.
- **`src/engine/incident_continuation.rs:105-130`** — the *caller* half of a claim: a transient DB error must never be read as "I lost the race". Its comment names the outage this caused.
- **`db/src/lib.rs:1882` — `init_test_db()`.** The only sanctioned way to build a pool in a test; it runs the real chain.
- **`rusqlite::Connection::rollback_hook`** (available today — `hooks` is already enabled at `db/Cargo.toml:45`). **Not registered anywhere in `src-tauri/`.** See Gaps #3.

## Steps

1. **Write down the invariant as a sentence**, in the form "after this call, X and Y are both true or neither is". If you cannot write that sentence, you do not need a transaction — you have two independent writes.
2. **Try to collapse it to one statement.** `INSERT … ON CONFLICT DO UPDATE` (`db/src/repos/twin.rs:365`), `UPDATE … WHERE <expected>` (`dev_tools.rs:4477`), a `DELETE` with a subquery (`dev_tools.rs:2929`). If it collapses, take **no** transaction, return `rows_affected`, and go to step 8. **This is the fastest and the most concurrent answer, and it is under-used here.**
3. **Otherwise, decide the lock mode by asking one question: does anything I read inside the transaction decide anything I write inside it?**

   | Inside the transaction | Open with | Why |
   |---|---|---|
   | reads only (a consistent multi-table snapshot) | `conn.transaction()` | deferred is correct; no lock to take. `src/commands/execution/lab.rs:236` is the model, and says so |
   | writes only (a batch of independent inserts) | `conn.transaction()` | the first write takes RESERVED; there is no upgrade to lose |
   | **a read that informs a write** | **`transaction_with_behavior(Immediate)`** | deferred loses the upgrade to any concurrent committer — unrecoverably (§Anti-patterns) |
   | a write, then a read of what you wrote | `conn.transaction()` | the write already took the lock |

4. **Acquire the connection exactly once**, at the top: `let mut conn = pool.get()?;`. Everything from here uses `tx`. If you find yourself typing `pool.get()` again, or passing `pool` to a helper that will, you have left the transaction — that helper is running on a *different* connection and its writes will not roll back with yours.
5. **Do all non-database work before `BEGIN`.** Encryption (`crypto::encrypt_field`), JSON parsing/merging, `chrono` formatting, `uuid` generation, and every network call. The transaction holds the database's single write lock; `busy_timeout = 5000` means every other writer in the process is spending your latency budget.
6. **Write, in dependency order, and propagate every `Result` with `?`.** A dropped `Transaction` rolls back — that is the safety net, and `let _ =` disarms it by turning a failure into a partial commit.
7. **`tx.commit()?` exactly once, in the function that opened it.** If a helper needs to participate, give it `tx: &rusqlite::Transaction<'_>` and document *"does NOT commit"*, as `credentials.rs:239-240` does.
8. **Read back outside, or not at all.** `RETURNING *` inside the transaction is free and consistent; a second `pool.get()` afterwards for a read-back is a different connection observing a different moment (`db/src/repos/twin.rs:378`, `let conn2 = pool.get()?`).
9. **Test it as a race, not as a sequence.** `init_test_db()` gives a pool; take two connections from it and interleave them. The repo has **56 functions with `rollback`/`atomic`/`partial` in the name and exactly one concurrency test** (`db/src/repos/communication/events.rs:2726`, `test_claim_pending_atomicity`).

## Anti-patterns

- **`conn.transaction()` around a read-then-write.** The failure is not "it might interleave" — it is **worse and louder**: SQLite invalidates the whole transaction. Measured on this repo's exact pragma set (SQLite 3.53.0, WAL, `busy_timeout = 5000`, two pooled connections):

  | Scenario | Other writer | This transaction's write |
  |---|---|---|
  | `BEGIN` (deferred), **SELECT then INSERT** | commits in 1 ms | **`SQLITE_BUSY_SNAPSHOT` after 0 ms** |
  | `BEGIN` (deferred), INSERT only | commits in 2 ms | ok, 0 ms |
  | `BEGIN IMMEDIATE`, SELECT then INSERT | **blocked 5,428 ms, then plain `SQLITE_BUSY`** | **ok, 16 ms** |

  Three things follow, and all three are counter-intuitive. (1) **`busy_timeout` does not apply.** It returned in **0 ms**, not 5,000 — because more waiting can never fix a stale snapshot, so SQLite does not invoke the busy handler at all. Every `busy_timeout` in this codebase is protection this shape does not receive. (2) **`BEGIN IMMEDIATE` does not make your transaction slower; it moves the waiting to the loser**, who then gets an ordinary retryable `SQLITE_BUSY` after honest waiting. `db/src/repos/resources/recipes.rs:501-504` had already worked this out: *"busy_timeout (5s) makes the loser wait for the winner to commit, then it reads the updated max."* (3) **A deferred write-only batch is fine.** The rule is about the *upgrade*, not about deferred.

- **Believing the function name.** Four functions in this repo document atomicity their `BEGIN` does not provide, and each was written by someone who understood the requirement:

  | Site | The doc says | The code does |
  |---|---|---|
  | `db/src/migrations/incremental.rs:26-27` vs `:34` | *"Wrap a DDL batch in BEGIN IMMEDIATE / COMMIT"* | `conn.unchecked_transaction()` → bare `BEGIN` |
  | `db/src/repos/resources/credentials.rs:761-763` vs `:774` | *"Atomically read the current …, increment it, … and write both back"* | `conn.transaction()` |
  | `src/commands/execution/lab.rs:971-972` vs `:969` | *"the write is serialized with the prompt rollback"* | `conn.transaction()` |
  | `db/src/repos/communication/manual_reviews.rs:574-575` vs `:549` | *"no concurrent writer can sneak in between"* | `conn.transaction()` |

  A comment asserting serialization is not serialization. Grep the `BEGIN`.

- **A helper that takes `&DbPool` and calls `pool.get()` twice.** Two acquisitions are two connections are two transaction scopes; nothing spans them. **18 functions do this** (§Deviations). The tell is a signature taking a pool and a body containing more than one `.get()`. `db/src/repos/twin.rs:348-390` is the clearest: `conn` performs the UPSERT, `conn2` reads the result back, and the row it returns may be someone else's.
- **Passing `pool` to a helper from inside a transaction.** Same defect, one layer down and much harder to see, because the signature you are looking at takes `&tx`. `db/src/repos/resources/credentials.rs:242` gets this right by taking **both** `pool` (for a lookup that is genuinely independent) and `tx` (for the writes).
- **Re-reading before a compare-and-swap.** `UPDATE … WHERE status = (SELECT status FROM …)` is not a CAS; it is a tautology. The predicate must carry the value the *caller* saw, which is exactly what `decide_idea_cas`'s doc comment (`dev_tools.rs:4442-4444`) insists on: *"`expected` is the status the CALLER SAW, not a re-read: that is the whole point."*
- **`conn.execute_batch("DELETE …; DELETE …;")` as a substitute for a transaction.** `execute_batch` runs the batch through one call, but without an explicit `BEGIN` each statement commits on its own. It is a syntax convenience, not an atomicity primitive. (Measured: 8 such multi-DML batches exist outside `db/src/migrations/`, and all 8 are in test fixtures — so this trap is currently theoretical here. Do not make it real.)
- **Holding the lock across a network call or an encryption pass.** With `max_size(12)` and one write lock, a transaction that awaits an OAuth refresh stalls every other writer in the process for the duration.
- **`unchecked_transaction()` by default.** 44 sites. It buys nothing over `transaction()` except the loss of a compile-time check; use it only where the connection is genuinely behind `&self` (`db/src/journal.rs:367`, inside the hook drain, is a legitimate case).
- **Naming a function `*_atomic` to document intent.** Two of the three `*_atomic` repository functions are deferred (`credentials.rs:764`, `:743` via `patch_metadata_on_conn`). The name is now anti-information.

## Evidence

**Adoption, measured across 963 `.rs` files (tests excluded):** 152 transaction-open sites — **17 `transaction_with_behavior(Immediate)` (11%)**, 91 `.transaction()`, 44 `unchecked_transaction()` — i.e. **135 deferred (89%)**. 24 functions take a `&Transaction` and compose; **2,133 signatures take `&DbPool`/`&UserDbPool`** and cannot. Zero `busy_handler` registrations, zero `rollback_hook` registrations, and **no retry-on-`SQLITE_BUSY` anywhere** in the data layer.

**The 17 IMMEDIATE sites are the strongest evidence in this document, because every one of them carries a hand-written explanation of the race it closes.** The doctrine was discovered here seventeen times and codified zero times:

- **`db/src/repos/core/personas.rs:818-826` — copy this one.** Persona creation: the name-uniqueness probe and the `INSERT` under one `BEGIN IMMEDIATE`. The comment records the audit that found five identically-named personas, names the TOCTOU, and explains that there is no unique constraint behind it. It is the complete argument in nine lines.
- **`db/src/repos/execution/knowledge.rs:53-60`** — a read-modify-write of a JSON column, and the clearest statement of the pool rule anywhere in the tree: *"a SELECT on one pooled connection followed by an INSERT…ON CONFLICT on another races concurrent executions … IMMEDIATE takes the write lock up front so the read + write land as one atomic step."*
- **`db/src/repos/resources/rotation.rs:130-137` and `:191-195`** — the single-active-policy invariant: disable-others + insert-enabled. The comment spells out the interleaving that produces two active policies, and `:191` explicitly back-references `:130` instead of restating it.
- **`db/src/repos/resources/connectors.rs:104-113`** and **`db/src/repos/resources/teams.rs:373-382`** — uniqueness enforced in code because the column has no `UNIQUE` constraint. Both comments say so. **When the database cannot hold the invariant, `BEGIN IMMEDIATE` is what holds it.**
- **`db/src/repos/resources/recipes.rs:498-504`** — `MAX(version_number) + 1` against a real `UNIQUE(recipe_id, version_number)`. The only comment in the repo that reasons about `busy_timeout` explicitly, and it is right.
- **`src/commands/core/use_cases.rs:43-48`** — read-modify-write of `personas.design_context`, contending with *the frontend's own write queue*. The only site that names a non-Rust competitor for the lock.
- **`db/src/repos/core/personas.rs:1216`, `db/src/repos/resources/team_memories.rs:197`, `db/src/repos/resources/teams.rs:531`/`:779`, `db/src/repos/research_lab.rs:181`/`:644`, `src/commands/execution/lab.rs:562`** — the remaining eight.

**Composition, done right:**
- **`src/commands/core/data_portability.rs:5929-7737`** — one import is one transaction. Eleven helpers take `tx: &rusqlite::Transaction<'_>` (`:6744`, `:6750`, `:6769`, `:6792`, `:6848`, `:6890`, `:7081`, `:7560`, `:7596`, `:7712`, `:7737`) and none of them commits. **This is the repo's proof that the composable shape scales**; it is also the largest deferred read-then-write in the tree (Deviations).
- **`db/src/repos/resources/credentials.rs:239-241`** — the signature and the one-line contract: *"Does NOT commit — the caller owns the transaction lifecycle."*
- **`db/src/repos/communication/events.rs:1555-1622` — `create_subscription_with_trigger`.** A genuine dual-write (trigger + subscription) in one write-only transaction. Correctly deferred.
- **`db/src/repos/core/personas.rs:1172-1191`** — the persona `UPDATE` and its change-log rows in one transaction, with an explicit decision that an audit-write failure must **not** sink the edit (log and continue *inside* the transaction). Note the shape: the audit is in-scope, the failure policy is not.

**Compare-and-swap, done right (no transaction, and none needed):**
- **`db/src/repos/dev_tools.rs:4456-4497`** — `decide_idea_cas`. One `UPDATE … WHERE id = ?1 AND status = ?5`; `rows == 0` re-reads only to *name* the winner in the error. The doc comment is a design document: it explains why reversing a decision you can see is legitimate and overwriting one you never saw is data loss, and it pins the error string as a cross-language contract with `src/lib/decisions/rowWrites.ts`.
- **`db/src/repos/execution/audit_incidents.rs:549-560`** — `claim_continuation`. Four lines, exactly-once, no transaction.
- **`src/engine/incident_continuation.rs:66-73` and `:105-130`** — the caller's obligation, learned the hard way: an `Err` from the lookup must skip **without claiming**, because a swallowed transient error plus a stamped claim permanently strands the work. This is the missing half of every CAS in the codebase and only this one site has it.

**Read-only snapshots, done right:**
- **`src/commands/execution/lab.rs:233-236`** — *"Snapshot persona, versions, and tools in a single read transaction to prevent a concurrent persona update from creating a hybrid base+version state."* Deferred is the correct mode here, and this is the only site that says why.

## Deviations found

### A. Deferred transaction wrapping a read-then-write — 13 sites

The `SQLITE_BUSY_SNAPSHOT` shape. **Counted twice, by independent implementations** (a brace-scanning Rust-function parser and the whole-file regex proposed in §9); they agree on 12, each finds one the other misses, union 15. The regex's baseline is 13 across 11 files.

| Path | Function | The read-then-write |
|---|---|---|
| `db/src/repos/resources/credentials.rs:774` | `increment_refresh_backoff_atomic` | `SELECT metadata` → parse ledger → `UPDATE metadata`. **Named `_atomic`.** Contends with the OAuth refresh loop |
| `db/src/repos/resources/credentials.rs:832` | `append_healthcheck_metadata` | Same column, same table, different background loop. The two race each other |
| `db/src/repos/resources/credentials.rs:975` | — | Third writer of the same JSON ledger |
| `src/commands/execution/lab.rs:969` | `activate_version_atomic` | `SELECT model_profile` → merge → `UPDATE personas`. **Named `_atomic`**; comment claims serialization |
| `db/src/repos/communication/manual_reviews.rs:549` | `gc_stale_pending` | `SELECT` the pending set → `UPDATE` them. Comment at `:575` claims *"no concurrent writer can sneak in between"* |
| `db/src/repos/core/memory_claims.rs:83` | `file_claim` | Existence probe → `INSERT` claim → `UPDATE open_claim_count`. The module doc (`:11-12`) makes this table's counter *depend* on the atomicity |
| `db/src/repos/resources/triggers.rs:960` | `delete_orphaned_triggers` | `SELECT` orphan ids → per-id `DELETE` |
| `db/src/repos/dev_workspaces.rs:983` | `roll_up_topic_doctrine` | `SELECT` the whole knowledge set → compute in Rust → write `governing_id` links |
| `src/commands/core/use_cases.rs:155` | — | Second transaction in a file whose *first* one (`:48`) is correctly IMMEDIATE and explains why |
| `src/commands/credentials/vector_kb.rs:1322` | — | |
| `src/companion/brain/consolidation.rs:482` | `discard_run` | Existence probe → bulk `UPDATE`. On the **user** pool (`max_size(8)`) |
| `src/engine/kb_ingest.rs:646` | — | |
| `db/src/migrations/incremental.rs:261` | `repoint_mcp_gateway_members_fk` | `COUNT(*)` → rebuild → `COUNT(*)`. **Benign by phase** — migrations run at `db/src/lib.rs:332-333`, before any other consumer holds a connection. The §9 allowlist entry |
| `src/commands/core/data_portability.rs:5929` | import | Found by the scanner, missed by the regex (gap > 1,200 chars). The largest transaction in the repo; the read-then-write is real |

Add one more that neither scan can see, because the read and the write live in a helper: **`db/src/repos/resources/credentials.rs:743` `patch_metadata_atomic`** opens `conn.transaction()` and delegates to `patch_metadata_on_conn` (`:685-712`), which does `SELECT metadata` then `UPDATE`. **The lexical count is a floor.**

### B. Multi-statement writes with no transaction at all — 6 deletes + 4 others

The **delete** half is already a fix backlog in [`delete-semantics.md:215`](./delete-semantics.md); do not duplicate it. Two corrections to that list, from this sweep:

- **It misses two.** `src/commands/credentials/vector_kb.rs:1410` `reconcile_orphaned_kb_records` fires three `DELETE`s per orphan (`kb_chunks`, `kb_documents`, `knowledge_bases`) **each behind `let _ =`**, so a partial cleanup is indistinguishable from a complete one. `engine/src/scraper.rs:773` `deregister_signal_feeds` fires two `DELETE`s (`shared_event_subscriptions`, `shared_event_catalog`) per polarity, four total — a crash between them leaves a catalog entry with no subscription.
- **It contains one false positive.** `db/src/repos/resources/cloud_webhook_watermarks.rs:50` `prune` has two `DELETE`s on **mutually exclusive branches** (`if active_ids.is_empty()` returns early). Exactly one ever runs. Its two `pool.get()` calls are on those same exclusive branches, so it is also not a §C deviation.

Non-delete multi-writes with no transaction, verified by reading:

| Path | What is not atomic |
|---|---|
| `db/src/repos/dev_tools.rs:2906` `clear_project_context_map` | 3 `DELETE` + 2 `UPDATE`. The final two UPDATEs exist *because* the deletes dangled `dev_ideas.context_id` / `dev_goals.context_id` (its own comment, `:2932-2935`) — so the repair is the invariant, and it is not in a transaction with the damage. One `DELETE`'s result is discarded at `:2926` |
| `engine/src/desktop_security.rs:354-381` `approve` | N `INSERT OR IGNORE` in a loop, then an in-memory `RwLock` cache update. A failure at capability *k* leaves the database with a partial grant set and the cache with none — a **security** surface where the two halves disagree |
| `src/companion/brain/doctrine.rs:477` `upsert_chunk` | 5 DML across `companion_node`, `companion_fts` and `companion_embedding`, on **3 separate `pool.get()`s** |
| `src/commands/infrastructure/skill_usage.rs:141` `reconcile_scope` | 6 DML across `skill_registry` and its children |

### C. Functions that take a pool and acquire twice — 18

Each cannot be atomic across its two acquisitions, by construction.

`src/companion/dispatcher.rs:592` `dispatch_with_sys` (**6** acquisitions, 4 DML) · `db/src/repos/resources/triggers.rs:1415` `backfill_auto_listeners` (3) · `src/companion/brain/consolidation.rs:145` `run_consolidation` (3) · `src/companion/brain/doctrine.rs:477` `upsert_chunk` (3) · `db/src/repos/communication/events.rs:1556` · `db/src/repos/dev_workspaces.rs:512` `import_local` · `db/src/repos/resources/triggers.rs:328` `update` · `:837` `initialize_event_handlers_for_persona` · `db/src/repos/twin.rs:348` `upsert_tone` · `db/src/repos/resources/cloud_webhook_watermarks.rs:49` *(exclusive branches — not a defect)* · `engine/src/desktop_security.rs:354` · `engine/src/team_handoff.rs:62` · `src/companion/brain/cycle_report.rs:174` · `src/companion/proactive/mod.rs:381` · `src/engine/background.rs:2406` · `src/engine/deliberation.rs:1258` · `src/engine/kpi_derivation.rs:312` · `src/engine/runner/team_context.rs:332`.

Severity varies sharply and the list should be triaged, not swept: `upsert_tone`'s second acquisition is a read-back (a stale return value), while `dispatch_with_sys`'s six span an `INSERT` + an `UPDATE personas` + two more `INSERT`s that plainly want to be one unit.

### D. Structural

- **`unchecked_transaction()` at 44 sites** where `transaction()` would compile. It surrenders rusqlite's `&mut` nesting check for no benefit. Concentrated in `src/companion/brain/**` (17 sites across 8 files) — a whole subsystem that adopted the weaker form by copy.
- **Zero retry on `SQLITE_BUSY`.** No `busy_handler`, no retry wrapper, no backoff. `busy_timeout = 5000` is the entire strategy, and §Anti-patterns shows it does not cover the shape that actually fails. When a deferred read-then-write loses, the error surfaces to the user as a raw `AppError::Database`.
- **One concurrency test in the whole data layer** — `db/src/repos/communication/events.rs:2726` `test_claim_pending_atomicity`. Against 56 functions whose names contain `atomic`/`rollback`/`partial` and 152 transaction sites. **Nothing in CI would notice if every `Immediate` in the tree were deleted.**
- **The doctrine exists 17 times and is written down zero times.** Neither `.claude/CLAUDE.md`, nor `.claude/conventions.json`, nor `docs/architecture/**` mentions transaction behaviour, `BEGIN IMMEDIATE`, or the pool-connection rule. Every one of the 17 rationale comments was rediscovered from scratch.

## Gaps in the primitive

1. **No transaction can span `personas.db` and `personas_data.db`.** Two files, two `Pool`s (`db/src/lib.rs:313` and `:510`), no `ATTACH`. Real, not laziness — but it is unowned: `src/commands/credentials/vector_kb.rs:48` `create_knowledge_base` writes a credential to one and a KB row to the other, and `reconcile_orphaned_kb_records` (`:1409`) exists **solely to clean up after that impossibility**, on a schedule, with `let _ =` on every statement. The compensating-action pattern is the correct answer to this gap; nothing names it as such, so it reads as cleanup rather than as the second half of a protocol.
2. **There is no way to ask "am I already in a transaction?"** rusqlite offers `Connection::is_autocommit()`, and it is used **zero times** in `src-tauri/`. A helper taking `&Connection` cannot tell whether its caller has already opened one, which is exactly why the codebase settled on two incompatible conventions (`&DbPool` for 2,133 signatures, `&Transaction` for 24) instead of one.
3. **The CDC and journal hooks are not transaction-aware.** `cdc.rs:166` registers `update_hook` and `journal.rs` registers `preupdate_hook` on every pooled connection; both fire **per row change, inside the write transaction** (`cdc.rs:5`, `:51` say so). Neither is unwound by a rollback, and **`rollback_hook` — available under the already-enabled `hooks` feature — is registered nowhere.** So a transaction that rolls back has already pushed CDC events that drive live UI updates and journal captures that drive undo. No test covers this; it is a reasoned consequence of the registration site, not a measured one, and that is itself the finding.
4. **`timed_query!` wraps the function, not the transaction.** Every repo function is instrumented at `db/src/macros.rs:331` with a table name and an operation name, so the repo has per-query timing and **no lock-hold timing at all**. The one number that would let anyone triage §Deviations by impact — how long each transaction holds the write lock — is not collected, and the instrumentation to collect it already surrounds every call site.
5. **`AppError` cannot express "you lost a race, retry".** Both CAS sites encode it as `AppError::Validation` with a **prose string** that the frontend regex-matches (`src/lib/decisions/rowWrites.ts`, `isDecisionConflict`, pinned by `rowWrites.test.ts`). A `AppError::Conflict` variant would make lost swaps a type, and would give the missing `SQLITE_BUSY` retry layer somewhere to report to. This is a genuine gap in the error contract, and it belongs to [`typed-error-contract.md`](./typed-error-contract.md) as much as here.
6. **Twelve connections with no write-lock queue.** `max_size(12)` plus one SQLite write lock plus `busy_timeout = 5000` means the twelfth writer waits behind eleven. Nothing meters the wait, nothing bounds transaction duration, and `spawn_idle_maintenance_task` (`db/src/lib.rs:226`) — which takes a connection and runs `wal_checkpoint(TRUNCATE)` — defers on IPC activity but not on an open transaction.

## The missing gate

**The semantic condition this gate proxies for:** *a transaction that observes
state before it mutates state, opened without acquiring the write lock first.*
That condition is stack-general — it is the same defect in Postgres when a
`SELECT` under READ COMMITTED decides an `UPDATE` with no `FOR UPDATE`. **The
signal below is not.** It keys on `rusqlite`'s method names and on this repo's
`let tx = …` idiom, and an adopting repo must re-derive its own proxy: in
`sqlx`/Postgres the equivalent signal is a `begin()` whose first statement is a
`SELECT` on the same `&mut *tx` with no `FOR UPDATE` clause. Do not port the
regex. Port the sentence.

### Half 1 — the census rule (the regression ratchet)

An entry in [`scripts/census/rules.json`](../../../scripts/census/rules.json).
No new script: the ratcheting-baseline mechanism, the fail-loud preconditions
and the stale-exclude check are already built there.

```jsonc
{
  "id": "deferred-read-then-write",
  "goldenPath": "docs/concepts/golden-paths/transaction-boundary.md",
  "title": "Deferred transaction whose first statement is a SELECT that informs a later write",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\.\\s*(?:unchecked_transaction|transaction)\\s*\\(\\s*\\)(?:(?!\\btx\\s*\\.\\s*(?:execute|execute_batch|commit)\\b)[\\s\\S]){0,1200}?\\btx\\s*\\.\\s*(?:query_row|query_map|prepare|prepare_cached)\\s*\\(\\s*(?:&?format!\\s*\\(\\s*)?r?#*\"\\s*\\n?\\s*SELECT[\\s\\S]{0,3000}?\\btx\\s*\\.\\s*(?:execute|execute_batch)\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a DEFERRED transaction (BEGIN, not BEGIN IMMEDIATE) whose first use of `tx` is a literal SELECT and which later writes through the same `tx` — the SQLITE_BUSY_SNAPSHOT shape"
  },
  "exclude": [
    { "path": "src-tauri/db/src/migrations/**",
      "reason": "migrations run inside init_db_with_journal (db/src/lib.rs:332-333) before any other consumer holds a pooled connection, so there is no concurrent writer to lose the snapshot to; the boot-migration-step golden path owns this phase" }
  ],
  "baseline": { "files": 10, "matches": 12 },
  "floor": 900
}
```

**This rule was run against the real runner before being written down**, not
just designed on paper. `node scripts/census/run-census.mjs --rules <this> --check`
reports `OK deferred-read-then-write  files 10/10  matches 12/12  walked 963
floor 900`, with the `exclude` matching 6 real files (so it is not stale), and
exits 0. Seeded with a baseline of `{files: 11, matches: 13}` it exits **1** with
`matches dropped 13 -> 12 without the baseline moving` — i.e. the ratchet
demonstrably fires in the direction that most often means "the matcher broke",
not just in the direction that means "someone added a bug".

**Three properties of this pattern, each learned by getting it wrong first** —
the contract asks for a second implementation before baselining, and it earned
its keep:

- **The read must be a *literal* `SELECT`.** rusqlite's `query_row` and
  `prepare` are the normal way to run `INSERT … RETURNING` and to prepare a
  write. Matching on the method name alone scored **24 matches / 20 files, of
  which at least 4 were writes misread as reads** (`db/src/journal.rs:367`
  prepares an `INSERT`; `db/src/repos/execution/test_runs.rs:219` runs
  `INSERT … RETURNING` through `query_row`; `db/src/vector_store.rs:104` and
  `db/src/repos/core/personas.rs:1176` likewise). Requiring the keyword costs
  recall on dynamically-built SQL and buys the precision that makes a ratchet
  usable.
- **A write must actually follow.** Without the trailing `tx.execute` clause the
  pattern flags read-only snapshot transactions, which are **correct** deferred
  usage — it flagged `src/commands/execution/lab.rs:236`, the best example of the
  right thing in the repo. 14 → 13 matches.
- **Match against whole file content.** Every one of these spans lines.

**Cross-check:** an independent brace-scanning implementation over the same tree
found 13 sites; the regex finds 13 (11 files); they agree on 12. The regex misses
`src/commands/core/data_portability.rs:5929` (a > 1,200-character gap) and the
scanner misses `db/src/repos/communication/manual_reviews.rs:549`. Recall is
therefore ~92%, not 100%, and the baseline is honest about that: it is a
regression ratchet, not a census.

**Fail-loud** is inherited from the runner and is real here: `floor: 900` against
963 walked files (a walk that stops finding `.rs` files fails rather than
reporting clean), zero-match-anywhere fails, a stale `exclude` fails, and the
baseline fails in **both** directions — so fixing `credentials.rs:774` without
updating the baseline is a red build that names the fix.

**A second rule is deliberately NOT proposed.** The obvious one — count every
`unchecked_transaction`/`transaction()` open (135 today) — would be a bad gate:
89% of those sites are write-only or read-only and legitimately deferred, and the
census treats *any* rise as fatal, so it would block correct new code and train
people to edit the baseline reflexively. A ratchet is only honest over a
population where every member is a defect.

### Half 2 — the Rust test (the premise, pinned)

The census rule catches new instances of the shape. It cannot catch the
*premise* moving — if someone sets `journal_mode = DELETE`, raises
`busy_timeout`, or drops `max_size` to 1, the entire argument in §2 changes and
every deviation above silently reclassifies. So pin the primitive's behaviour
against the repo's own configuration:

```rust
// db/src/tx.rs  (new module, or beside init_test_db in db/src/lib.rs)
#[test]
fn a_deferred_read_then_write_loses_the_lock_upgrade_and_busy_timeout_does_not_help() {
    // Precondition 1: the pragma set this doctrine rests on is still in force.
    assert!(crate::STANDARD_PRAGMAS.contains("busy_timeout = 5000"),
            "the busy_timeout premise moved — re-read transaction-boundary.md §2");

    let pool = crate::init_test_db().unwrap();
    let a = pool.get().unwrap();
    let b = pool.get().unwrap();

    // Precondition 2: WAL. Without it the failure mode is plain SQLITE_BUSY and
    // the whole deferred-vs-immediate argument changes shape.
    let mode: String = a.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
    assert_eq!(mode.to_lowercase(), "wal", "not in WAL — this test proves nothing");

    a.execute_batch("BEGIN").unwrap();
    let _: i64 = a.query_row("SELECT COUNT(*) FROM personas", [], |r| r.get(0)).unwrap();
    b.execute("INSERT INTO personas (id, name, created_at, updated_at) \
               VALUES ('tx-probe','p',datetime('now'),datetime('now'))", []).unwrap();

    let t = std::time::Instant::now();
    let err = a.execute("UPDATE personas SET name = 'x' WHERE id = 'tx-probe'", [])
               .expect_err("a deferred read-then-write must lose the upgrade");
    let waited = t.elapsed();
    let _ = a.execute_batch("ROLLBACK");

    // The instrument, asserted before the result.
    assert!(matches!(&err, rusqlite::Error::SqliteFailure(e, _)
                          if e.extended_code == rusqlite::ffi::SQLITE_BUSY_SNAPSHOT),
            "expected SQLITE_BUSY_SNAPSHOT, got {err:?}");
    assert!(waited < std::time::Duration::from_millis(500),
            "busy_timeout was consulted ({waited:?}) — the doctrine's core claim moved");
}

#[test]
fn an_immediate_read_then_write_wins_and_makes_the_other_writer_wait() { /* mirror, asserting Ok */ }
```

**Which lane it runs in — and the trap.** This test belongs in **`personas-db`**,
because that is where `init_test_db()` and the pool live. Therefore:

- ✅ `npm run test:rust:crates` — runs it (the extracted-crates lane).
- ✅ CI, via the `--workspace` flag now present in `ci.yml`.
- ❌ **`npm run test:rust` does NOT run it.** That script passes `--lib` against
  the **root** manifest, which selects only `personas-desktop`. An agent that
  writes this test, runs `npm run test:rust`, sees green and ships has verified
  nothing. This is the same dark-crate hazard
  [`boot-migration-step.md:299`](./boot-migration-step.md) calls its most
  leveraged finding, and it applies verbatim here: the whole of `personas-db`'s
  suite is invisible to the command most sessions reach for first.

The test fails loudly by construction — it asserts the pragma, then the journal
mode, then that the error actually occurred, and only then its identity. A run
where nothing raced would fail at `expect_err`, not pass quietly.

## Convergence check — is this physics or house style?

Per the contract, a clause a sibling codebase reinvented independently is
physics; one with no trace anywhere else is local calibration. Checked against
**`brainiac`** (`C:/Users/mkdol/dolla/brainiac`) — Rust, but `sqlx` + Postgres,
no SQLite, no r2d2, no shared code and no shared document with this repo.

| Clause | Independently reinvented there? |
|---|---|
| **A transaction is per-connection; a pool cannot hold one** | **Yes, and reasoned about in prose.** `crates/brainiac-store/src/test_support.rs:66-69`: a session advisory lock needs a dedicated 1-connection pool because *"a shared pool could check the locking connection back out to something else … silently releasing the lock."* And `retrieval.rs:162-228` handles the same problem structurally: parallel retrievers run on *different* pooled connections, so the transaction-local scope is read back off the caller's transaction and re-stamped on each new one |
| **Repository writes take a connection, not a pool, so callers compose** | **Yes, as the dominant convention.** **139** store functions take `conn: &mut PgConnection`; the **45** taking `&PgPool` are exactly the non-tenant subsystems. Documented at `crates/brainiac-store/src/lib.rs:9-11` (*"Every read/write goes through such a transaction; there is no unscoped query path"*), at `retrieval_events.rs:418` (*"Runs inside the caller's RLS-scoped transaction. The caller commits."*), and again in its `CLAUDE.md:147-152`. **This is Principle #5, arrived at from a completely different motivation (row-level security) and enforced by the type system rather than by review** |
| **Take the lock before the read that informs the write** | **Yes — 18 `SELECT … FOR UPDATE` sites**, the Postgres analogue of `BEGIN IMMEDIATE`. `governance.rs:253-261` locks two rows *in id order* to prevent a cycle. `console.rs:668-672` reasons explicitly about READ COMMITTED re-evaluating the predicate once the lock is granted. They chose row locks over isolation levels deliberately: `SERIALIZABLE`/`REPEATABLE READ` appear **zero** times repo-wide |
| **CAS: `rows_affected == 0` means someone else won** | **Yes — 28 sites.** `console.rs:219-242` re-asserts `reviewed_at IS NULL` in the `WHERE` *"so a promotion already decided by a concurrent approve … updates 0 rows"* → HTTP 409, explicitly *"never a last-writer-wins reviewer"*. That is `decide_idea_cas`'s doc comment, rewritten by someone who never read it |
| **Parent + children + audit row in one transaction** | **Yes** — `library/standards.rs:37-73` (row + version + N provenance rows), `governance.rs:289-327` (5 statements) |
| **…and the deliberate counter-case** | **Yes, and it is the sharpest thing in either repo.** `pipeline/worker.rs:485-493` writes the audit row in its **own** short transaction *after* the job transaction settles, *"precisely so a rolled-back job leaves an audit trail"* — with a test (`pipeline_pg.rs:427-520`) asserting the memories vanished and the audit row survived. **Personas has the same decision at `db/src/repos/core/personas.rs:1183-1189` and resolves it the other way** (audit in-scope, failure logged) — both are defensible, and the existence of the fork in two repos is evidence that *"is the audit row inside the boundary?"* is a real question this path should force you to answer, not a detail |
| **A test that asserts nothing partial landed** | **Yes** — `pipeline_pg.rs:520` (*"rolled-back job left no memory behind"*), `contradictions_pg.rs:294-311` (a refusal must roll back), `store_pg.rs:1053-1105` (8 concurrent readers, 40 jobs, no double-claim). **Personas has one such test.** This is the largest gap the comparison exposes |
| `BEGIN IMMEDIATE` specifically | **No trace** — Postgres has no such mode. **Correctly local:** it is this stack's *manifestation* of the portable clause "take the lock before the read that informs the write" |
| `busy_timeout` / `SQLITE_BUSY_SNAPSHOT` | **No trace.** SQLite-specific by definition |

**Verdict: the head is physics.** Six of the eight substantive clauses were
reinvented in a different database, a different driver and a different problem
domain, and two of them (the connection-not-pool signature convention, and the
audit-row-outside-the-boundary counter-case) are stated there *more* explicitly
than anywhere in this repo. The two clauses with no sibling trace are exactly the
two that name SQLite primitives — which is what the manifestation layer is
supposed to look like.

The most useful thing the comparison shows is not agreement but **enforcement
posture**: brainiac made the boundary a *type* (`&mut PgConnection` vs `&PgPool`
is a compile error to confuse), so its 139-to-45 split needs no gate at all.
Personas made it a *convention* (2,133 pool-taking signatures, 24 transaction-
taking), so it needs §9. That is the real lesson to carry: **the census rule
above is a patch over a signature decision.** If this repo ever wants the
deviation class to stop recurring, the fix is not a better regex — it is moving
the multi-write repository functions to `&Transaction` and letting `rustc` hold
the line.
