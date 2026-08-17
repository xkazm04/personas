# Golden path — Foreign-key policy

> Situation node: `data-persistence/schema-design/foreign-key-policy` ·
> [situation spine](../situation-spine.md) · recurrence 87 ·
> dimensions: **function · resilience · performance · code-quality**
> Composed 2026-08-14 against `master` @ `4d515e9ac`.
>
> **Sweep size.** 963 `.rs` files parsed (exactly `rust.files` in
> [`shared-facts.json`](../shared-facts.json)) with a comment-stripping,
> brace-and-paren-balancing DDL parser: **410 `CREATE TABLE` statements** over
> **43 files**, **199 production `REFERENCES` clauses**, **299 bare `*_id`
> columns**, every `PRAGMA foreign_keys` site classified production-vs-test.
> Statements, never lines: the parser removes `//` and `--` comment text before
> matching, and the census engine's `ignoreCommentLines` skipped 83 further
> prose matches in the token-only control.
>
> **Measured against running software.** The operator's live `personas.db`
> (347 MB, 244 tables) and `personas_data.db` (17 MB, 70 tables) were copied and
> opened read-only; a second working copy took writes so cascades could be
> executed and timed. Every claim about what the FK graph *does* comes from
> `pragma_foreign_key_list`, `PRAGMA foreign_key_check`, `EXPLAIN QUERY PLAN`
> and executed-then-rolled-back `DELETE`s — not from reading DDL. **The single
> most important number in this document was found that way and could not have
> been found any other way.**
>
> A **convergence sweep** ran against `brainiac` (Rust · sqlx · **Postgres**),
> `personas-cloud` (TS · better-sqlite3) and `vibeman`. It **inverted one clause
> this document was going to assert as universal**, and it found Personas ahead
> of all three siblings on four axes (§6).
>
> ### Sibling boundaries, settled in prose
>
> [**Schema change**](./schema-change.md) owns *where DDL goes* — the `run_step`,
> the `already_applied` probe, the registry joins, and the phantom-table class.
> It already says `REFERENCES <table>` resolves lazily and that a missing parent
> only bites on the first `INSERT`. **That path owns getting the declaration into
> the chain; this path owns what the declaration should say and whether the
> engine is in a state to honour it.**
>
> [**Entity deletion**](./delete-semantics.md) owns *the delete operation* — the
> transaction, the receipt struct, the blast radius, the confirm dialog, the risk
> ladder. It is the **consumer** of the graph this path defines. Where it says
> "declare the fate in the DDL", this path says which fate, why the omission is
> not neutral, and — the part it could not reach from the delete side — **whether
> the declared fate actually fires at runtime.** It states as a premise that
> `PRAGMA foreign_keys = ON` "**is** guaranteed on every pooled connection … so
> you may rely on declared cascades". That premise is true of the pool and
> **false of the database**, and §7 P0 is the 1,030-row consequence.
>
> [**Index design**](./index-design.md) owns *which indexes to create* and why.
> It measured 583 `CREATE INDEX` statements and 46 redundant indexes. This path
> borrows its machinery for one question it did not ask: **an FK's child column
> is read once per deleted parent row**, so an FK child column with no usable
> index is a scan the schema pays for on every cascade (§7, 25 of 172).
>
> [**Upsert**](./upsert.md) owns conflict resolution on write. Its composer ran
> `PRAGMA foreign_key_list` over all 308 tables in both databases and confirmed
> every `REFERENCES` target resolves except one. **That inventory is reproduced
> and extended here**; the "except one" is now zero (§6, verified repair).
>
> The **Deviations** section is a fix backlog.

## 1 Trigger

- "This table needs a `persona_id` / `project_id` / `execution_id` column."
- "Should this be `ON DELETE CASCADE` or should I just delete the children myself?"
- "Deleting X left rows behind" / "there are rows pointing at something that doesn't exist."
- "Why can't I delete this workspace?" / "`FOREIGN KEY constraint failed` and I didn't ask for a constraint."
- "I need to rebuild this table / drop and recreate it / turn foreign keys off for a minute."
- "I'm writing a script that touches `personas.db` directly."
- "This test builds its own table so it doesn't need the whole migration chain."

If you are about to type `REFERENCES`, `FOREIGN KEY (`, `ON DELETE`,
`PRAGMA foreign_keys`, `<something>_id TEXT NOT NULL`, `FkDisabledGuard`, or to
open a connection to `personas.db` from anything that is not the app's pool —
you are in this situation.

**Not this path:** *what the delete command does with the graph* (the
transaction, the receipt, the confirm) is [delete-semantics](./delete-semantics.md).
*Where the DDL statement lives* is [schema-change](./schema-change.md).

## 2 The one way

**A foreign key is two separate commitments, and shipping one without the other
is the entire failure surface of this leaf: the DDL commits to what the child
means, and the connection commits to enforcing it.** Declare the first by
writing `REFERENCES parent(id)` **with an explicit `ON DELETE`** on every column
that names a parent row — `CASCADE` when the child is owned and meaningless
without its parent, `SET NULL` (column nullable) when the child records
something that happened *to* the parent and must outlive it. **Never omit the
`ON DELETE` clause.** Omitting it is not "do nothing to the child"; it is
`NO ACTION`, which means **the parent's delete is refused** — verified against
the operator's real database, where `DELETE FROM dev_workspaces` on the one
workspace that has projects raises `FOREIGN KEY constraint failed` and the app
only works because a repo function hand-NULLs the child column first. If a
column genuinely must not carry an FK — a polymorphic reference like
`persona_events.source_id`, or an audit row that must survive its subject —
write the reason on the line above in the form
`-- RETAINED BY DESIGN: <why>`, because an absent FK and a forgotten FK are
indistinguishable and there are **299 bare `*_id` columns** here to prove it.
Honour the second commitment by obtaining every connection from the pool —
`STANDARD_PRAGMAS` (`db/src/lib.rs:201`) sets `PRAGMA foreign_keys = ON` on
every acquire, and that is the *only* thing making any of the above true. **The
pragma is per-connection, not per-database: the file carries no memory of it.**
So a second writer — another driver, a maintenance script, a hand-rolled test
fixture — starts from whatever *its* driver defaults to, and any parent it
deletes orphans its children permanently and silently, because SQLite validates
on write and never re-validates afterwards. When a rebuild genuinely requires
suspending enforcement, take `FkDisabledGuard` **in autocommit, before the
transaction opens** — `PRAGMA foreign_keys` is a documented no-op inside a
transaction, verified here — and never hand-write the `OFF`/`ON` pair. Then
stop: no manual `DELETE FROM child` beside a declared cascade, no `ON UPDATE`
(zero of 199 declarations here and zero across three sibling repos have ever
needed one), no `RESTRICT`.

**And one thing to do that nothing in this repo does today: run
`PRAGMA foreign_key_check` where a human will see the result.** It costs
**894 ms** over the whole 347 MB database and it is the only artifact that can
observe the damage of a broken second commitment.

## 3 Mandated primitives

**Exist today — use them:**

- **`db/src/lib.rs:201` `STANDARD_PRAGMAS`** — `PRAGMA foreign_keys = ON;` plus
  seven others, as one const. **The single source of truth for the enforcement
  posture**, and the only place in production Rust that turns FK checking on.
- **`db/src/lib.rs:213` `apply_standard_pragmas` + `:216-224`
  `SqlitePragmaCustomizer`** — the r2d2 `on_acquire` hook. Both `init_db`,
  `init_user_db` (`:492`), `open_pool_at` (`:378`), `init_test_db` (`:1939`) and
  `init_test_user_db` (`:1994`) install it, so **all four pools and both test
  pools share one posture.** `cdc::CdcCustomizer` delegates to the same function
  rather than copying the batch.
- **`db/src/lib.rs:173-192` `FkDisabledGuard`** — the scoped suspension. RAII:
  `Drop` restores `ON` even on early return or panic, so a pooled connection
  cannot leak back into the pool with checks off. **10 production call sites.**
  Its doc comment states the contract; read it before writing any rebuild.
- **`db/src/migrations/fk_hygiene.rs:117+` `recreate_with_fk`** — the retrofit.
  SQLite has no `ALTER TABLE … ADD CONSTRAINT`, so this rebuilds
  create-insert-drop-rename, deriving the column list from `pragma_table_info`
  (never a hand-written CSV), replaying indexes and triggers from
  `sqlite_master`, gating idempotency on `pragma_foreign_key_list`, taking
  `FkDisabledGuard` in autocommit at `:191` **with the reason written out**, and
  refusing to commit if `pragma_foreign_key_check` is non-zero (`:306-317`).
  **Nine tables migrated (`run()` at `:16-26`). Extend this; never hand-roll a
  rebuild.**
- **`db/src/lib.rs:1939` `init_test_db()` / `:1994` `init_test_user_db()`** —
  test pools built from the real chain, carrying the real FKs and the real
  pragma. **524 and 57 call sites respectively.** Your fixture uses these.
- **`db/src/migrations/incremental.rs` ~`:9240`
  `no_foreign_key_points_at_a_missing_table`** — the `sqlite_master` ⋈
  `pragma_foreign_key_list` set-difference, as a Rust test, **with its instrument
  asserted before its result** (`table_count > 200`, `fk_count > 50`). This is
  schema-change.md §9's difference-set C, built. Copy this assert-the-instrument
  shape into anything you add.
- **`…/incremental.rs` ~`:9300`
  `mcp_gateway_members_accepts_an_insert_under_foreign_keys_on`** — the
  behavioural half. It reads `PRAGMA foreign_keys` and asserts it is `1` with the
  message *"test connection has FK enforcement off — proves nothing"* before
  testing anything. **It is the only assertion in the entire repo that FK
  enforcement is on.**
- **`personas.db` itself.** `PRAGMA foreign_key_check` answers "is the graph
  intact" in under a second. Nothing in the repo asks it; you can, in ten
  seconds, and it settles every argument in this document.

**Do not exist — this path names them:**

- **A boot-time or maintenance-time `foreign_key_check` with a visible result.**
  The one instance of the query in production code is buried inside a rebuild
  that short-circuits before reaching it (§7 P0-b). `vibeman` has the sibling
  practice this should copy (§6).
- **A `-- RETAINED BY DESIGN:` marker.** [delete-semantics](./delete-semantics.md)
  prescribes it; **zero occurrences exist in `src-tauri/`.** `brainiac` reached
  the same construction independently and writes it.
- **An `OwnedBy<Parent>`-style column type** that cannot be declared without a
  fate. See "Prefer a type over a gate".

## 4 Steps

1. **Decide whether this column names a parent row at all.** `source_id`
   (polymorphic), a remote/Supabase id, a token — these are not FKs and never
   will be. Everything else is.
2. **Choose the fate, and write it.** There are exactly two live answers here and
   in every sibling repo measured:

   | The child is… | Declare | Live count |
   |---|---|---:|
   | owned by the parent; meaningless without it | `REFERENCES p(id) ON DELETE CASCADE` | 149 |
   | a record of something that happened *to* the parent, and should outlive it | `REFERENCES p(id) ON DELETE SET NULL` (column nullable) | 21 |
   | an audit/history row that must survive, with no link semantics | **no FK**, plus `-- RETAINED BY DESIGN: <why>` | 0 marked |
   | you want the parent's delete refused | omit `ON DELETE` — **and say so in a comment**, because nothing else distinguishes this from a mistake | 2 |

   **`ON UPDATE` is not on this list.** Zero of 199 declarations here carry one,
   and zero across three sibling codebases. Ids are immutable in all four; a
   declaration nobody needs is noise. Same for `RESTRICT` — zero everywhere.
3. **Ask the type-over-gate question here**, before §9. See below: a required
   fate is expressible in a helper's signature in a way that a census rule can
   only count.
4. **Land the DDL** per [schema-change](./schema-change.md) — a new `run_step` at
   the end of `run_incremental`'s body, `CREATE TABLE IF NOT EXISTS` and its
   indexes in one `ddl_step` batch. **Spell the parent table right**: SQLite
   accepts `REFERENCES nonexistent(id)` at `CREATE TABLE` and only fails on the
   first `INSERT`, and `PRAGMA foreign_key_check` is blind to it while the child
   is empty — which a table whose every insert fails always is. That is not a
   hypothesis; it shipped, as `mcp_gateway_members`, and it is now guarded by the
   test named in §3.
5. **If the table already shipped without its FK**, add a `migrate_<table>`
   function to `fk_hygiene.rs` and call it from `run()`. Give it a
   `cleanup_orphans_sql` that removes or NULLs the rows the new constraint would
   reject — and read §7 P0-b first, because that helper's pre-commit
   `foreign_key_check` is **whole-database**, and this database currently has
   1,030 violations it did not create.
6. **Index the child column if the parent can be deleted and the child can grow.**
   SQLite resolves a cascade by querying the child for each deleted parent row.
   Measured: 25 of 172 FK constraints produce a `SCAN` of the child. Verify with
   `EXPLAIN QUERY PLAN SELECT 1 FROM <child> WHERE <fk_col> = ?` — **not by
   eyeballing the index list**, because a composite `PRIMARY KEY`'s auto-index
   serves a non-leading column via skip-scan, which is how a shape-based count of
   26 became a plan-based count of 25 during this sweep.
7. **Obtain your connection from the pool. Always.** `pool.get()`. If you are
   writing a Node script, a benchmark, an out-of-process companion, or a test
   fixture, you are outside `SqlitePragmaCustomizer` and you own the posture
   yourself — set `PRAGMA foreign_keys = ON` as the first statement, and read §5.
8. **For a test, call `init_test_db()`.** Do not hand-roll `CREATE TABLE`. Both
   test pools install the same customizer, so the fixture gets production's FKs
   *and* production's enforcement for free. **28 of the 30 files that hand-roll
   fixture DDL never mention the pragma at all**, so they run at their driver's
   default with constraints they mostly did not copy.
9. **Stop.** No manual `DELETE FROM child` beside a declared `CASCADE` — the
   pragma is on, the cascade fires, and the hedge teaches the next author that
   the graph cannot be trusted (three stale comments in this repo already do
   exactly that). No `PRAGMA foreign_keys = OFF` written by hand. No `ON UPDATE`.

## 5 Anti-patterns

- **Omitting `ON DELETE` and expecting it to mean "nothing happens".** It means
  `NO ACTION`, which means **the parent's `DELETE` is rejected**. Verified in
  isolation (a two-table fixture: `DELETE FROM p` → `FOREIGN KEY constraint
  failed`) and verified in production (`DELETE FROM dev_workspaces` on the
  workspace holding 6 projects → same error). The clause reads like an omission
  and behaves like a veto.
- **Writing `PRAGMA foreign_keys = OFF` inside a transaction.** It is a
  documented no-op. Verified: `BEGIN; PRAGMA foreign_keys = ON;` leaves the
  setting at `0`; the identical statement outside the transaction sets it to `1`.
  `fk_hygiene.rs:185-190` carries the incident report for this in a comment —
  the previous in-transaction `OFF` did nothing, so a `DROP TABLE` during a
  rebuild fired *other* tables' cascades and wiped child rows on legacy upgrades.
  **Take `FkDisabledGuard` in autocommit, before the transaction.**
- **Hand-writing the `OFF` … `ON` pair instead of taking the guard.** Eight test
  sites do. The guard exists because `Drop` runs on the panic path and a raw pair
  does not: a test that fails between the two statements returns a connection to
  a shared pool with enforcement off, and `init_test_db` pools hand out two.
- **Deleting a parent from outside the pool.** This is the one that actually cost
  data. `scripts/test/clean-env.cjs:57` sets `foreign_keys = OFF`, deletes 17
  operational tables including `persona_executions`, and turns it back on. Two
  tables that cascade off `persona_executions` are not in its list. **1,030 rows
  in the operator's live database are orphaned by exactly this** (§7 P0-a). The
  script's comment says *"FK off so order is safe"* — the reasoning is inverted:
  FK **on** is what makes order irrelevant.
- **Assuming an orphan will be noticed later.** It will not. Verified: an orphan
  created under `foreign_keys = OFF` survives every subsequent connection with
  `foreign_keys = ON` unchanged, because SQLite validates on write and never
  re-validates. The same connection will *reject a new* orphan insert while
  holding the old one. A database can therefore contain rows it would refuse to
  accept.
- **Hand-rolling fixture DDL for a table that has foreign keys.** Seven test
  files rebuild 12 production tables and drop **21 FK constraints** between them,
  and none of the seven enables enforcement — so even the constraints they kept
  would not fire. No test over those tables can observe an FK regression.
- **`ORPHAN_TABLES` as the safety net.** `cleanup_orphan_rows`
  (`db/src/lib.rs:447-461`) sweeps 12 tables and every query it builds is
  `WHERE persona_id NOT IN (SELECT id FROM personas)`. It is **structurally
  incapable** of seeing an orphan keyed on anything else — which all 1,030 of the
  live ones are (`execution_id`). Its own preamble at `:349-358` already admits
  *"We've still observed orphans accumulate in real installs"*; this is why.
- **A comment asserting FK enforcement is off.** `db/src/repos/dev_workspaces.rs:383-385`
  — *"SQLite FK cascade only fires with `PRAGMA foreign_keys=ON`, which we don't
  rely on here"* — sits directly above the manual `UPDATE dev_projects SET
  workspace_id = NULL` that is the only reason `delete_workspace` works. The
  premise is false (`STANDARD_PRAGMAS` sets it on every acquire); the workaround
  it justifies is load-bearing for a different reason (the FK is `NO ACTION`).
  Two errors that cancel, which is the worst kind to leave in place.
- **Declaring an FK on a column whose child table can grow, without an index.**
  The cascade probe runs once per deleted parent row. `DELETE FROM dev_projects`
  for a single project took **6,812 ms** on the operator's database.
- **Believing `PRAGMA foreign_key_check` proves the schema is sound.** It reports
  rows, so it is blind to a dangling *parent table* while the child is empty —
  verified: a child with `REFERENCES nonexistent_parent(id)` and zero rows
  returns nothing, and the `sqlite_master` set-difference returns the row. Both
  checks are needed; the repo now has the second one as a test.
- **Adding a table to `fk_hygiene::run()` without reading §7 P0-b.** The tenth
  table will run `recreate_with_fk`'s pre-commit whole-database
  `foreign_key_check`, find 1,030 pre-existing violations in two unrelated
  tables, return `AppError::Validation`, and **abort startup** — naming the wrong
  table in the error.

## 6 Evidence

### Adoption — the declared graph

Parsed from 963 `.rs` files, comments stripped, statements not lines:

| | Count |
|---|---:|
| `CREATE TABLE` statements | **410** in 43 files |
| …production | **329** (305 distinct table names) |
| …inside `#[cfg(test)]` | **81** (53 distinct names) |
| production `REFERENCES` clauses | **199** |
| … `ON DELETE CASCADE` | **176** |
| … `ON DELETE SET NULL` | **21** |
| … no `ON DELETE` at all | **2** |
| … `ON DELETE RESTRICT` / `SET DEFAULT` / explicit `NO ACTION` | **0 / 0 / 0** |
| … carrying any `ON UPDATE` | **0** |
| bare `*_id` columns with no `REFERENCES` (production `CREATE TABLE` bodies) | **299** (287 distinct) |
| `REFERENCES` in test DDL | **8** (7 CASCADE, 1 SET NULL) |

Production DDL by file: `incremental.rs` 146 · `schema.rs` 79 · `db/src/lib.rs`
43 · `initial.rs` 23 · `fk_hygiene.rs` 9 · `companion/dispatcher.rs` 9 ·
`bench/db.rs` 5 · `companion/brain/embeddings.rs` 4 · 7 more files with ≤2 each.

### Adoption — the live graph

`personas.db`, 347 MB, copied and opened read-only:

| | `personas.db` | `personas_data.db` |
|---|---:|---:|
| tables | 244 | 70 |
| FK constraints | **172** | **10** |
| child tables with ≥1 FK | 130 | 7 |
| distinct parent tables | 51 | 4 |
| `ON DELETE CASCADE` / `SET NULL` / `NO ACTION` | **149 / 21 / 2** | 9 / 1 / 0 |
| `ON UPDATE` other than `NO ACTION` | 0 | 0 |
| **FKs pointing at a table that does not exist** | **0** | **0** |
| `PRAGMA foreign_key_check` violations | **1,030** | **0** |
| FK child lookups that `SCAN` (by `EXPLAIN QUERY PLAN`) | **25 / 172** | 1 / 10 |

**199 declared vs 172 live is not a discrepancy to explain away — it is the
measurement.** Twenty-seven `CASCADE` declarations are duplicate DDL for tables
that ship in `schema.rs` and are re-declared by a later rebuild, or belong to
staging `_new` tables that never survive. `SET NULL` (21) and `NO ACTION` (2)
match exactly between source and database, which is the cross-check that the
parse is sound.

Top parents by child count: `personas` 38 · `dev_projects` 22 ·
`persona_credentials` 11 · `persona_teams` 9 · `twin_profiles` 8 ·
`persona_executions` 7 · `dev_goals` 6 · `workspace_knowledge` 6 ·
`research_projects` 5.

**The verified repair.** [`schema-change.md`](./schema-change.md) reported
`mcp_gateway_members` declaring `REFERENCES credentials(id)` against a table
that does not exist, making the gateway-membership feature dead on every install
since 2026-04-08. **It held.** `PRAGMA foreign_key_list(mcp_gateway_members)`
now returns two constraints, both `→ persona_credentials(id) ON DELETE CASCADE`.
The set-difference over all 244 tables returns **zero** dangling parents, and
the same query over `personas_data.db` returns zero. **No sibling case exists.**
Two regression tests guard it (§3), and — clearing another claim —
`ci.yml:275` now runs `cargo test --workspace --manifest-path
src-tauri/Cargo.toml --features desktop`, so unlike when
[`schema-change.md`](./schema-change.md) Gap 9 was written, **those tests do run
in CI**. (`npm run test:rust` still does not run them locally; use
`cargo test -p personas-db` or `npm run test:rust:crates`.)

### The cascade graph, walked

Transitive closure over `CASCADE` edges from each root, with live row counts:

| Root | 1st-order | tables reachable | max depth | rows in reach |
|---|---:|---:|---:|---:|
| `personas` | 35 | 48 | 2 | 15,902 |
| `dev_projects` | 22 | 30 | 2 | 279,769 |
| `persona_teams` | 7 | 10 | 2 | 11,200 |
| `dev_workspaces` | 3 | 8 | 2 | 263,903 |
| `persona_credentials` | 9 | 8 | 1 | 512 |
| `persona_executions` | 5 | 6 | 2 | 6,060 |

**Nothing goes deeper than two.** Thirteen tables sit at depth 2 from `personas`
(`automation_runs`, `evolution_cycles`, five `lab_*_results`, `memory_claims`,
`persona_message_deliveries`, `persona_team_connections`, `persona_test_results`,
`persona_version_tools`, `review_messages`); **zero at depth 3.** The graph is
shallow and wide, which is the good news and is worth stating: the reason a
persona delete is hard to reason about is fan-out, not chains.

Three self-referential FKs exist, all `SET NULL`, all correct:
`persona_teams.parent_team_id`, `research_hypotheses.parent_hypothesis_id`,
`dev_goals.parent_goal_id`. **No cascade cycle exists.**

**Cascades that reach an audit-shaped table** — the "deletes more than its
author expected" case, and there are five: `persona_credentials` →
`credential_events` and `credential_rotation_history`; `persona_teams` →
`team_assignment_events`; `personas` → `persona_metrics_snapshots` and
`policy_events`. Deleting a credential destroys its own rotation history. That
may be intended — but the neighbouring `credential_audit_log` (9,839 rows) has
**no FK at all** and survives, and nothing anywhere records which of the two
outcomes was chosen on purpose.

### Behavioural probes

Executed against a working copy, then rolled back:

1. **`PRAGMA foreign_keys` is a connection setting; the file carries no state.**
   The same database file reports `0` or `1` depending only on how the driver
   opened it.
2. **The pragma is a no-op inside a transaction.** `BEGIN; PRAGMA foreign_keys =
   ON;` → still `0`. Outside → `1`.
3. **A FK-OFF parent delete orphans permanently.** Children survive; a later
   `foreign_keys = ON` does not clean them and does not complain; the same
   connection then *rejects* a new orphan insert.
4. **`foreign_key_check` is blind to a missing parent table on an empty child;
   the `sqlite_master` set-difference sees it.** Both confirmed in one fixture.
5. **An absent `ON DELETE` rejects the parent delete.** Confirmed twice —
   synthetic, and against `dev_workspaces` in production.
6. **The orphan mechanism, reproduced exactly.** `DELETE FROM persona_executions`
   with `foreign_keys = OFF` leaves `persona_tool_usage` at 5,735 rows. **The
   identical statement with `foreign_keys = ON` leaves it at 980** — which is,
   to the row, the orphan count `PRAGMA foreign_key_check` reports. Two
   independent methods, the same number. That is the proof that the 980 rows are
   the residue of a cascade that never fired, not a coincidence of counting.
7. **A single-project delete costs 6,812 ms** and removes 49 `dev_contexts`,
   57,036 `workspace_practice_context_state`, 1,187 `workspace_practice_adoption`,
   22 `dev_ideas`, 4 `dev_use_cases` and 1 `dev_goals` — 58,299 rows from one
   `DELETE … WHERE id = ?`, synchronously, on the IPC thread.
8. **`PRAGMA foreign_key_check` over the whole 347 MB database: 894 ms.**

### Convergence — what three sibling repos did without reading this

Run 2026-08-14 against `brainiac` (Rust · sqlx · **Postgres**), `personas-cloud`
(TS · better-sqlite3) and `vibeman`.

| Clause | Warrant | Evidence |
|---|---|---|
| **State `ON DELETE` explicitly** | **physics — but only on SQLite, and the sweep found a reasoned counter-example** | The three SQLite codebases measured sit at **97.5% / 100% / 97.1%** explicit. **Postgres `brainiac` sits at 57.6%** and `migrations/0034_projects_onboarding.sql:46-49` argues *for* the omission: *"Default NO ACTION means a project with live keys cannot be dropped — revoke first."* On Postgres the default is enforced from birth and using it as a guard is defensible; on SQLite the constraint is opt-in per connection and un-`ALTER`-able, so an unstated fate is a table rebuild away from being fixable. **The clause is real and it is stack-conditional.** |
| **Never declare `ON UPDATE`** | **physics** | **0 in all four repos**, across four stacks and two engines. |
| **Never use `RESTRICT`** | **physics** | **0 in all four repos.** Real FK policy is two-valued plus a documented refusal. |
| **Enforcement is per-connection and must be established once, centrally** | **physics — all three SQLite repos discovered it independently** | Every SQLite codebase in the fleet sets `PRAGMA foreign_keys = ON` somewhere. **Coverage is where two of three fail:** `vibeman` sets it in **1 of 8** connection constructors. Personas is the only one with a single shared customizer on every pool. |
| **Verify the pragma actually took effect** | **physics, and `vibeman` is ahead of us** | `vibeman`'s `sqlite.driver.ts:115-118` reads the pragma back after setting it and warns if it did not stick. Personas sets it and never checks — and has 1,030 orphans it has never noticed. **This is the single cheapest thing to copy in the whole sweep.** |
| **Build test databases from the real migrations** | **physics, and the repos sit on a spectrum** | `brainiac`: **zero** shadow DDL, 100% migration-built test databases, 64 call sites. Personas: 524 `init_test_db()` call sites **and** 21 FK clauses dropped across 12 tables in 7 hand-rolled fixture files. `vibeman`: **79 shadow tables, 40 FK constraints dropped, 23 files**, and its shared test helper carries neither the FKs nor the pragma. **Personas is in the middle and the direction of travel is clear.** |
| **A retrofit migration for tables that shipped FK-less is inevitable** | **physics** | Independently reinvented in 2 of 4 repos: `fk_hygiene.rs` here, and an equivalent in `vibeman`. Nobody gets the graph right the first time. |
| **A polymorphic column cannot carry an FK, and must say so** | **physics** | Both repos that hit the problem documented it in a comment. Personas does it at `schema.rs` on `persona_events.source_id`. |
| **`-- RETAINED BY DESIGN:` for a deliberately FK-free column** | **physics — reinvented once, adopted zero times here** | `brainiac/migrations/0028…:73-74` writes exactly this marker. [delete-semantics](./delete-semantics.md) prescribes it for Personas and **`src-tauri/` contains 0 occurrences.** Prescribed, converged-upon, unwritten. |
| **Index the FK child column** | **stated, and Personas is ahead** | `brainiac` (Postgres, where an unindexed child FK column makes every parent delete a sequential scan): **19 of 59 FK child columns have no index at all** — 52.5% covered. Personas: **25 of 172 SCAN** — 85.5% covered. |
| **A machine gate on FK integrity** | **no trace anywhere — local calibration** | **0 of 3 siblings** have any CI check, test, or script that verifies FK targets resolve, that enforcement is on, or that no orphans exist. §9 proposes one anyway, and marks it unproven. |
| **A type that makes a missing FK unrepresentable** | **no trace anywhere** | No ORM/type construct in any repo. `brainiac` enables sqlx's `macros` feature and uses `query_as!` **zero** times — the compile-time-checked path is available and unused, the same finding [index-design](./index-design.md) §8 reached from the query side. |

**Where Personas is ahead, plainly.** Four axes, and none of them was expected:
the only repo in the fleet with a test asserting FK enforcement is on; the only
one with a `foreign_key_check` gate anywhere in production code; the only one
with a dedicated FK-retrofit module; and the only one with a single shared pool
customizer instead of N hand-copied pragma batches. **The deficit is not in the
declarations — it is in the second writer.**

## 7 Deviations found

> **Second pass — what is upstream of all of this.** Every defect below reduces
> to one omission: **nothing ever asks the database whether its graph is intact.**
> The declarations are good (199 clauses, 197 with an explicit fate, zero
> dangling targets). The enforcement primitive is good (one customizer, one
> const, one RAII guard). What is missing is the third thing: an observation. The
> repo owns the query, it costs 894 ms, and the one place it is written is
> unreachable. Add the observation and P0-a becomes visible, P0-b becomes
> impossible, and the fixture gap becomes measurable.

### P0-a — 1,030 orphaned rows in the operator's live database, right now

| Path | What's wrong |
|---|---|
| `scripts/test/clean-env.cjs:57` | `db.pragma('foreign_keys = OFF')`, then `DELETE FROM persona_executions` (in the 17-table `CLEAR` list at `:49-56`), then `foreign_keys = ON` at `:65`. **`persona_tool_usage` and `assertion_results` are not in the list**, and both declare `execution_id … REFERENCES persona_executions(id) ON DELETE CASCADE`. The cascade that would have removed them was switched off. **Live result: 980 orphaned `persona_tool_usage` rows (17% of 5,735) and 50 orphaned `assertion_results` rows (47% of 106).** Orphan `created_at` runs 2026-05-25 → 2026-06-03, matching the `personas-cleanbak-2026-06-02…` / `-2026-06-03…` backups the script writes. The verification block at `:69-70` checks only that the cleared tables are empty; it never runs `foreign_key_check`. |
| `db/src/lib.rs:447-461` `cleanup_orphan_rows` | Every query it builds is `WHERE persona_id NOT IN (SELECT id FROM personas)` over 12 named tables. **It cannot see an `execution_id` orphan at all**, so it has run on every boot since June without touching any of the 1,030. Its own preamble (`:349-358`) says *"We've still observed orphans accumulate in real installs"* — this document supplies the count and the cause. |
| `db/src/repos/execution/executions.rs:1363`, `:1882`; `src/commands/infrastructure/system/storage.rs:127` | The three production paths that delete executions all go through the pool and cascade correctly. **The damage came entirely from outside the Rust process** — which is exactly why no amount of care in the Rust layer prevented it. |

The other Node writers are safe by driver default (`better-sqlite3` and
`node:sqlite` both enable foreign keys on open; verified). `clean-env.cjs` is the
only script that turns it off, and it is the only one that has caused damage.

### P0-b — a latent boot failure armed by P0-a

`fk_hygiene.rs`'s `recreate_with_fk` runs `SELECT COUNT(*) FROM
pragma_foreign_key_check` inside its transaction before committing (`:306-317`)
and returns `AppError::Validation` if the count is non-zero. That pragma is
**whole-database**, not table-scoped. `fk_hygiene::run()` is called with `?` from
`incremental.rs:5775`, inside `run_incremental`, so the error aborts startup.

All nine current tables short-circuit on the idempotency check at the top of
`recreate_with_fk` and never reach the verification, which is the only reason the
operator's app still boots. **Add a tenth table to `fk_hygiene::run()` and the
next launch fails, with an error message naming the new table and 1,030
violations that belong to two tables it has nothing to do with.** Both halves are
measured: the check exists and fires on `> 0`; the database has 1,030.

**This is also the good news.** The repo already contains the right instrument in
the right place. It just runs at the wrong time — only during a rebuild that has
already been done.

### P1 — a foreign key nobody chose, that the app routes around

| Path | What's wrong |
|---|---|
| `incremental.rs:6834` | `ALTER TABLE dev_projects ADD COLUMN workspace_id TEXT REFERENCES dev_workspaces(id);` — **no `ON DELETE`**, so `NO ACTION`. Verified against the live database: `DELETE FROM dev_workspaces` on the workspace holding 6 projects → `FOREIGN KEY constraint failed`. One of the operator's two workspaces is undeletable by that statement. |
| `db/src/repos/dev_workspaces.rs:386-405` | `delete_workspace` works only because it runs `UPDATE dev_projects SET workspace_id = NULL WHERE workspace_id = ?1` first. That line is doing the job of an absent `ON DELETE SET NULL`. **Remove it trusting the FK and the delete starts failing** — and the doc comment at `:383-385` invites exactly that, by asserting *"SQLite FK cascade only fires with `PRAGMA foreign_keys=ON`, which we don't rely on here"*, which is false. |
| `incremental.rs:1569` | `FOREIGN KEY (review_id) REFERENCES persona_design_reviews(id)` on `template_feedback` — no `ON DELETE`. `delete_design_review` will fail with an FK violation the moment a feedback row exists. Currently latent: the table holds 0 rows. (Also reported by [delete-semantics](./delete-semantics.md); repeated here because it is one of only two live instances and the pair is the census baseline.) |

### P1 — 21 FK constraints that no test can ever observe

67 `CREATE TABLE` statements inside `#[cfg(test)]` shadow 44 production tables
across 30 files. Twenty of them shadow a table that has foreign keys in
production; **16 drop every one (13 distinct tables, 22 clauses); 4 keep them.**
One of the 16 is legitimate — `fk_hygiene.rs:947` deliberately rebuilds
`persona_memories` in its pre-FK shape to test the retrofit, and that file does
set `foreign_keys = ON`. **Excluding it: 7 files, 12 tables, 21 FK clauses.**

| File | Tables shadowed FK-free | Pragma posture |
|---|---|---|
| `src/commands/companion/approvals/approval_exec_ship.rs:384-397` | `dev_use_cases`(-2) `dev_goals`(-2) `dev_milestones`(-1) `dev_milestone_items`(-1) | **silent** |
| `src/companion/prompt.rs:2475-2483` | `personas`(-1) `dev_context_groups`(-1) `dev_contexts`(-2) | **silent** |
| `src/companion/jobs/operations_views.rs:268-269` | `personas`(-1) `persona_executions`(-2) | **silent** |
| `src/engine/kb_ingest.rs:870-878` | `kb_documents`(-1) `kb_chunks`(-2) | **silent** |
| `src/engine/kb_scan.rs:188-191` | `kb_documents`(-1) `kb_chunks`(-2) | **silent** |
| `src/commands/design/connector_readiness.rs:1294` | `credential_fields`(-1) | **silent** |
| `src/commands/infrastructure/schema_vocabulary.rs:224` | `dev_standards`(-1) | **silent** |

**"Silent" is the finding, not "dropped".** 28 of the 30 shadow-DDL files never
mention `PRAGMA foreign_keys` in any form, so they run at the driver default —
which means **a fixture that faithfully copied every constraint would still
observe nothing.** Fixing the DDL without fixing the posture buys zero. The fix
for both is one call: `init_test_db()`, which already has 524 call sites and
installs the same customizer production uses.

### P2 — 25 FK constraints that make a cascade scan the child

Measured by `EXPLAIN QUERY PLAN SELECT 1 FROM <child> WHERE <fk_col> = ?` — the
lookup SQLite runs once per deleted parent row. Ranked by live row count:

| Child.column → parent | Action | Rows |
|---|---|---:|
| `team_assignment_events.step_id` → `team_assignment_steps` | CASCADE | 8,486 |
| `workspace_practice_adoption.project_id` → `dev_projects` | CASCADE | 7,099 |
| `team_assignment_steps.execution_id` → `persona_executions` | SET NULL | 1,488 |
| `team_assignment_steps.assigned_persona_id` → `personas` | SET NULL | 1,488 |
| `persona_team_connections.{source,target}_member_id` → `persona_team_members` | CASCADE | 70 |
| `dev_scans.project_id` → `dev_projects` | CASCADE | 65 |
| `dev_use_cases.primary_context_id` → `dev_contexts` | SET NULL | 26 |
| `dev_projects.workspace_id` → `dev_workspaces` | NO ACTION | 14 |
| 17 more, all on tables currently holding ≤ 9 rows | | |

`team_assignment_steps` is the one to fix: **two** unindexed FK columns on a
1,488-row table, one of which points at `persona_executions`, which the prune
command deletes in bulk.

**A correction to my own method, kept because it matters.** A shape-based count
("is the FK column the leading column of some index or the PK?") returned 26 and
named `workspace_practice_context_state.context_id` — the 253,752-row table — as
the worst case. The plan disagrees: SQLite serves it by skip-scanning the
composite `PRIMARY KEY (practice_id, context_id)` auto-index. Adding a real index
on `context_id` cut a single-context cascade from **504 ms to 297 ms**, so the
index is not worthless — but the table is not unindexed, and a document asserting
it was would have sent someone to fix the wrong thing. **Measure the plan.**

### P2 — 299 columns that name a parent and say nothing

299 `*_id` columns (287 distinct) appear in production `CREATE TABLE` bodies with
no `REFERENCES`. [delete-semantics](./delete-semantics.md) P0 characterises this
population from the delete side (224 by its count, 113 naming a real table) and
owns its triage. This path adds one fact: **the marker it prescribes to
distinguish deliberate from forgotten — `-- RETAINED BY DESIGN:` — has zero
occurrences in `src-tauri/`.** A sibling repo writes the same marker
independently. Until it exists here, no reader and no machine can tell the
audit tables that must survive from the ~34 that are leaks.

### Structural

- **One production `PRAGMA foreign_keys = ON` that matters.** Two sites in
  `db/src/lib.rs` (`:188` the guard's restore, `:201` `STANDARD_PRAGMAS`), plus
  `src/bench/db.rs:163` for the separate `bench.db`. **All 27 other `= ON` sites
  are test-only** (24 inline, plus 3 in `#[cfg(test)] #[path]` sibling files —
  `dev_memories_tests.rs:20`, `dev_tools_backlog_tests.rs:23`,
  `dev_tools_page_tests.rs:26`, which an in-file `#[cfg(test)]` scan misclassifies
  as production and which I did until I checked their parent modules). The
  centralisation is genuinely good; the count of tests that have to re-establish
  it by hand is the tell that `init_test_db()` is under-used.
- **Exactly one assertion, anywhere, that FK enforcement is on** —
  `incremental.rs` ~`:9305`. Every other test that depends on a cascade firing
  assumes it.
- **`PRAGMA foreign_key_check` appears in production code once**, unreachable
  (P0-b). It appears in `migration_chain_is_idempotent_on_rerun`
  (`incremental.rs:8599`) over a **fresh, empty** test database, where it is
  structurally incapable of failing — the same false-confidence shape
  [schema-change](./schema-change.md) Gap 6 identified for the dangling-parent
  case.
- **No `VACUUM`, and a 6.8-second cascade.** Deleting one dev project removes
  58,299 rows synchronously. [delete-semantics](./delete-semantics.md) notes the
  absent `VACUUM`; this path adds that the delete itself is long enough to be a
  UI event, and nothing about it is cancellable or reported.
- **Zero static gates on any of this.** `npm run check` (contracts, tiers, Tauri
  configs, corpus, doc-map, census, `tsc`, ESLint) and `lefthook.yml` have no
  opinion about foreign keys. Every deviation above shipped green.

## 8 Gaps in the primitive

1. **`PRAGMA foreign_keys` is per-connection and the database cannot remember
   it.** This is SQLite, not laziness: there is no `SQLITE_DEFAULT_FOREIGN_KEYS`
   stored in the file, no schema-level `ENFORCE` flag. Every process, driver and
   language binding that opens the file starts from its own default. Postgres has
   no equivalent hazard — `brainiac` needs no pragma, no customizer and no guard,
   and **the absence of this whole failure class there is structural, not
   discipline.** Consequence here: correctness depends on a property of *callers*,
   forever, and 1,030 rows already paid for it.
2. **SQLite cannot `ALTER TABLE … ADD CONSTRAINT` or change an `ON DELETE`.**
   Every fix to an FK's fate is a create-copy-drop-rename rebuild. That is why
   `fk_hygiene.rs` exists and why getting the clause right at `CREATE` time
   matters more here than on a server database.
3. **`PRAGMA foreign_key_check` sees rows, not schema.** Blind to a dangling
   parent table while the child is empty (verified). The `sqlite_master ⋈
   pragma_foreign_key_list` set-difference covers that half. **Neither is run
   anywhere except in tests.** Two complementary queries, both cheap, both
   unscheduled.
4. **`FkDisabledGuard` protects one connection, not the database.** It cannot
   know whether another pooled connection, another process, or a Node script is
   mid-write. On a WAL database with `max_size(8)` on the user pool, a rebuild
   under the guard is genuinely racy and nothing expresses that.
5. **Nothing reports what still needs an FK.** `fk_hygiene.rs` migrates a
   hardcoded list of nine and holds every read needed to enumerate the rest
   (`pragma_table_info` + `pragma_foreign_key_list`). It never does.
   [delete-semantics](./delete-semantics.md) Gap 9 says the same from the other
   side; two paths reaching it independently is the signal that it should be
   built.
6. **An FK cannot express a polymorphic reference.** `persona_events.source_id`
   means a persona, a trigger or `'system'` depending on `source_type`. Real
   limitation, documented in this repo and in a sibling. The cost is that the
   *absence* of an FK is overloaded: it means "impossible", "deliberate" and
   "forgotten", with no way to tell them apart — which is what the
   `-- RETAINED BY DESIGN:` marker exists to fix and why its zero adoption
   matters.
7. **The declared fate is invisible from Rust.** A row struct over a child table
   carries no trace of whether its parent link cascades; `rusqlite` addresses
   columns by string name. Nothing at the type level connects
   `PersonaToolUsage.execution_id` to the constraint that governs it — the same
   shape as [index-design](./index-design.md) Gap 3 and
   [persisted-model-struct](./persisted-model-struct.md) Gap 3.
8. **`ON DELETE SET NULL` cannot be verified against nullability at declaration
   time.** SQLite will accept `SET NULL` on a `NOT NULL` column and fail at
   delete time. Not measured as a live defect here; noted because the failure
   surfaces at the worst possible moment.
9. **An orphan, once created, is permanent and silent.** SQLite validates on
   write and never re-validates. There is no `VALIDATE CONSTRAINT` (Postgres has
   one), no repair, no background check. The only remedy is a query nobody runs.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md), answered explicitly. **For this
leaf: yes for the declaration, no for the enforcement — and the split is the
whole point.**

**Where a type works — the fate.** "This column names a parent" and "here is
what happens when the parent dies" should be one decision, not two, and the
second should be impossible to skip. Today they are separate strings in one SQL
literal and the second is optional. The shape that fixes it is a small helper in
the migration layer:

```rust
enum ParentFate { Cascade, SetNull, RetainedByDesign(&'static str) }
fn parent_link(col: &str, parent: &str, fate: ParentFate) -> String
```

`parent_link("execution_id", "persona_executions", ParentFate::Cascade)` emits
`execution_id TEXT NOT NULL REFERENCES persona_executions(id) ON DELETE
CASCADE`. There is **no variant that emits a `REFERENCES` without an `ON
DELETE`**, and `RetainedByDesign` requires the reason as a value, so it emits the
column plus the `-- RETAINED BY DESIGN:` comment the repo has prescribed and
never written. That makes both of this leaf's declaration defects — the 2
unstated fates and the 299 unmarked bare columns — *unrepresentable* rather than
counted, and it is the same move `brainiac` made for its ANN indexes and
`FacetedDecisionTable` made for `emptyTitle`. It also composes with
[schema-change](./schema-change.md)'s `ddl_step`: the helper produces a string,
so nothing about where DDL lives changes.

A second, one-line type fix: **`FkDisabledGuard::new` should take the connection
*and* assert it is in autocommit**, returning `Err` inside a transaction. The
guard's whole purpose is defeated by a transaction and the guard cannot currently
tell. `rusqlite::Connection::is_autocommit()` exists. One `if !conn.is_autocommit()
{ return Err(...) }` makes the documented no-op — the one that already wiped
child rows on legacy upgrades once — a loud failure instead of a silent one.

**Where a type cannot work, and this is the honest half — the enforcement.**
`PRAGMA foreign_keys = ON` is a property of a *connection at a moment in time*,
established by whichever driver, in whichever language, in whichever process
opened the file. A Rust newtype can constrain Rust callers; it has no reach over
`scripts/test/clean-env.cjs`, over a future `personas-mcp` build, over a
`sqlite3` shell, or over the operator running a one-off query. **The 1,030 live
orphans were created by a Node script, and no signature in the Rust tree could
have prevented them.** This axis is not shapeable; it is only observable — which
is why §9 proposes an observation as its primary mechanism and a census rule only
for the half that *is* shapeable.

## 9 The missing gate

### The semantic conditions, stated first

Three, each stack-free. Per the [portability test](../research/portability-test.md),
what follows are **one repo's proxies**; an adopting repo inherits the sentences
and re-derives its own signals.

> **(A)** A child row declares which parent it belongs to without declaring what
> becomes of it when that parent is destroyed, so the store picks a behaviour the
> author never chose.
>
> **(B)** A writer reaches the store through a door that does not establish
> referential-integrity enforcement, so constraints that are declared do not run.
>
> **(C)** The store contains rows whose declared parent does not exist, and
> nothing ever asks.

### What is gated, what is refused

**(A) is countable and is gated below.** **(B) and (C) are refused, with the
checker that *can* express each one specified instead of a bad regex shipped** —
and (C) is refused for a structural reason worth stating plainly: **the census
engine cannot express "must be zero".** A rule that matches nothing fails as
`zero-matches`, by design, because a silent zero is a broken matcher far more
often than a finished migration. "There must be no orphans" is exactly a
must-be-zero condition. **It needs a test, not a census rule.**

### The one census rule — `undeclared-parent-fate`

Keys on a `REFERENCES parent(col)` clause with no `ON DELETE` after it, in either
spelling this repo uses (a column definition and a `FOREIGN KEY (…)` table
constraint). Measured: **1 file / 3 matches**, all three opened and confirmed —
`incremental.rs:1569` (`template_feedback.review_id`, live `NO ACTION`),
`:6834` (`dev_projects.workspace_id`, live `NO ACTION`, the P1 above), and
`:8686` (`personas.group_id` in a `#[cfg(test)]` fixture recreating the retired
`persona_groups` shape). **The live database carries exactly 2 `NO ACTION`
constraints of 172** — two independent routes to the same pair, and the third
match is precisely the one a live-schema check *cannot* see, which is the
argument for a static rule beside a runtime one rather than instead of it.

The forward-anchored preceding-token class `(?:\)|[A-Za-z0-9_])\s+` is
load-bearing and removes the tree's only two false positives:
`incremental.rs:211-212`, where the bare string literals
`"REFERENCES credentials(id)"` and `"REFERENCES persona_credentials(id)"` are the
arguments of the `.replace()` that **repaired** the `mcp_gateway_members`
phantom-parent bug. Without the anchor, the fix is reported as the defect.

No variable-length lookbehind: the whole pattern is one forward scan with a
trailing negative lookahead. Runtime **308 ms** over 963 files.

```json
{"rules":[
  {
    "id": "undeclared-parent-fate",
    "goldenPath": "docs/concepts/golden-paths/foreign-key-policy.md",
    "title": "A foreign key that names its parent but never says what happens when that parent is deleted",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "(?:\\)|[A-Za-z0-9_])\\s+REFERENCES\\s+[\"'`]?[A-Za-z_][A-Za-z0-9_]*[\"'`]?\\s*\\(\\s*[\"'`]?[A-Za-z_][A-Za-z0-9_]*[\"'`]?\\s*\\)(?!\\s*(?:ON\\s+DELETE|ON\\s+UPDATE|DEFERRABLE))",
      "flags": "gi",
      "ignoreCommentLines": true,
      "description": "a REFERENCES clause, in a column definition or a FOREIGN KEY table constraint, with no ON DELETE action after it. PROXY FOR the stack-free condition: a child row declares which parent it belongs to without declaring what becomes of it when that parent is destroyed, so the store picks a behaviour the author never chose. VERIFIED BEHAVIOURALLY against SQLite (node:sqlite, 2026-08-14), not inferred: with a parent row and one child row present, DELETE FROM parent under an omitted ON DELETE is REJECTED with `FOREIGN KEY constraint failed`, and pragma_foreign_key_list reports the clause as `NO ACTION`. The omission does not mean 'do nothing to the child' - it means 'refuse the delete', which is the opposite of what the two live instances' authors intended. Confirmed against the operator's real 347 MB personas.db: DELETE FROM dev_workspaces on the one workspace that has projects is refused outright, and the app only works because delete_workspace (db/src/repos/dev_workspaces.rs:386-405) hand-NULLs dev_projects.workspace_id first - under a doc comment whose stated reason ('SQLite FK cascade only fires with PRAGMA foreign_keys=ON, which we do not rely on here') is false, since STANDARD_PRAGMAS sets it on every pooled acquire (db/src/lib.rs:201, :216-224). The live schema carries exactly 2 NO ACTION constraints out of 172 total (149 CASCADE, 21 SET NULL); this pattern finds those 2 plus 1 inside a #[cfg(test)] fixture that recreates the retired persona_groups shape, which a live-schema check cannot see - that complementarity is why this is a static rule beside a runtime test rather than instead of one. PRECISION: 3 of 3 matches opened and confirmed. The forward-anchored preceding-token class is load-bearing and removes the tree's only two false positives, incremental.rs:211-212, where the bare string literals \"REFERENCES credentials(id)\" and \"REFERENCES persona_credentials(id)\" are the arguments of the .replace() that REPAIRED the mcp_gateway_members phantom-parent bug - without the anchor the fix is reported as the defect. POSITIVE CONTROL: the identical head with the compliant tail (ON DELETE) matches 209 times across 6 files and the token-only form (REFERENCES <name>, no shape) matches 254 across 29 files including English prose in prompt strings, so the rule discriminates on the trailing shape rather than on the word REFERENCES. Multi-column REFERENCES t(a,b) does not occur in this tree (measured: 0), so the single-column form has full coverage. No variable-length lookbehind - one forward scan, 308 ms over 963 files. CONVERGENCE (2026-08-14, brainiac / personas-cloud / vibeman): stating ON DELETE explicitly is physics ON SQLITE and only there - the three SQLite codebases measured sit at 97.5% / 100% / 97.1% explicit, while Postgres brainiac sits at 57.6% and its migrations/0034_projects_onboarding.sql:46-49 argues FOR the omission ('Default NO ACTION means a project with live keys cannot be dropped - revoke first'). That is a reasoned counter-example and it is why this rule is scoped to a SQLite tree: on Postgres the implicit default is enforced from birth, whereas on SQLite the constraint is opt-in per connection and un-ALTER-able, so an unstated fate is a full table rebuild away from being fixable. Also universal across all four repos: ON UPDATE = 0 and explicit RESTRICT = 0, so the only real choices are CASCADE, SET NULL, or a documented refusal. LEGAL FIX, in order: (1) ON DELETE CASCADE when the child is owned by the parent; (2) ON DELETE SET NULL when the child records something that happened TO the parent and should outlive it, with the column nullable; (3) keep the omission ONLY when refusing the parent delete is the intent, and then write that reason in a comment on the line above - brainiac 0034:46-49 is the exemplar. Dropping the FK entirely and relying on a hand-written DELETE is what produced this repo's 1,030 live orphan rows; see the golden path. END OF LIFE: this rule is designed to reach zero. When it does the runner fails structurally on zero-matches, by design - DELETE the rule then, do not baseline it at 0."
    },
    "baseline": { "files": 1, "matches": 3 },
    "floor": 900
  }
]}
```

**No `exclude` entries.** The two false positives are removed by the *pattern*,
not by a path, so there is no legitimate file-level exemption and a stale
suppression cannot accumulate.

**`floor: 900`** matches the other `src-tauri`-rooted rules deliberately —
several rules over one root must not hold several opinions about what "the Rust
tree is intact" means. The walk reports **963**, exactly `rust.files` in
[`shared-facts.json`](../shared-facts.json): two independently derived counts
agreeing, which is the only reason to trust either.

### Validated standalone, before publishing

`node scripts/census/run-census.mjs --rules <scratch>/foreign-key-policy-rules-candidate.json --check`:

```
  rule                    files   base  matches   base  walked  floor
  OK   undeclared-parent-fate      1      1        3      3     963    900

  census OK — 1 rule(s), 963 file-visits, 3 surviving violation(s) across 1 file(s).
```

Exit `0`. The baseline reproduces exactly.

### The positive control

The contract requires that inverting the pattern to the **compliant** form must
also fail, proving the matcher discriminates on shape and not on a token. It
does, and the populations are worth reporting because their sizes are the
argument:

| Pattern | Files | Matches |
|---|---:|---:|
| the rule — head + `(?!ON DELETE…)` | **1** | **3** |
| **positive control** — identical head + `\s*ON\s+DELETE` (the compliant form) | **6** | **209** |
| token-only — `REFERENCES <name>`, no shape at all | 29 | 254 |

**Overlap: by file 1, by match 0.** `incremental.rs` appears in both populations
because it contains 99 compliant declarations and 3 unstated ones — but no single
match belongs to both, because the two tails are mutually exclusive by
construction. Running the positive control as a rule against this baseline fails
immediately (`files rose 1 -> 6`, `matches rose 3 -> 209`); the same block is the
last row of the fault table below.

The token-only row is the third leg: keying on the *word* `REFERENCES` would
report **254 matches across 29 files**, including English prose inside prompt
strings (`engine/src/design.rs`, `companion/prompt.rs`, `render_plan/invariants.rs`
and 20 more). 3 + 209 = 212 against 254, so **42 matches are things that are not
FK declarations at all** — the shape anchors reject every one.

Published as a rule-shaped block for the record, with **no `baseline`** and an id
containing `positive-control` so the registry merge skips it. **Do not merge
this into `rules.json`:**

```json
{"rules":[
  {
    "id": "undeclared-parent-fate-positive-control",
    "goldenPath": "docs/concepts/golden-paths/foreign-key-policy.md",
    "title": "POSITIVE CONTROL — not a gate. The compliant form of undeclared-parent-fate, which the rule must NOT report.",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "(?:\\)|[A-Za-z0-9_])\\s+REFERENCES\\s+[\"'`]?[A-Za-z_][A-Za-z0-9_]*[\"'`]?\\s*\\(\\s*[\"'`]?[A-Za-z_][A-Za-z0-9_]*[\"'`]?\\s*\\)\\s*ON\\s+DELETE",
      "flags": "gi",
      "ignoreCommentLines": true,
      "description": "NOT A GATE - the shape-discrimination control for undeclared-parent-fate. Identical head, compliant tail. Measured 2026-08-14: 6 files / 209 matches, versus the rule's 1 file / 3 matches, with zero match-level overlap. Its purpose is to demonstrate that the rule keys on the ABSENCE of an ON DELETE tail and not on the token REFERENCES - a token-only pattern matches 254 times across 29 files including English prose in prompt strings. Deliberately carries no baseline; the registry merge skips ids containing 'positive-control'."
    },
    "floor": 900
  }
]}
```

### Fault injection against the real tree

A gate that cannot fail is not a gate. Each row is a single-field mutation of the
validated rule, run with `--check` against the actual repository:

| Induced fault | Exit | What the runner said |
|---|---|---|
| baseline, unmutated | **0** | `f=1 m=3 walked=963` |
| matcher matches nothing (`pattern` → `ZZZ_NEVER_MATCHES`) | **1** | *matched zero files anywhere* |
| floor above the walk (`floor: 5000` on a 963-file root) | **1** | *THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN* |
| silent drop (baseline claims 9 where 3 exist) | **1** | *dropped 9 → 3 (−6) without the baseline moving* |
| count rises (baseline claims 1 where 3 exist) | **1** | *rose 1 → 3 (+2)* |
| file count drifts (`baseline.files` 4 where 1 exists) | **1** | *dropped 4 → 1 (−3)* |
| renamed root (`src-tauri` → `src-tauri-x`) | **1** | floor failure, `walked=0` |
| extension no longer describes the tree (`.rs` → `.zzz`) | **1** | floor failure, `walked=0` |
| stale `exclude` entry (a path matching no file) | **1** | *the exemption is stale* |
| `exclude` with a one-character reason | **1** | *needs a real "reason"* |
| grounding removed (no `goldenPath`, no `principle`) | **1** | *missing grounding* |
| **negative lookahead removed — the discriminator** | **1** | *rose 1 → 6 files, 3 → 212 matches* |
| **preceding-token anchor removed — the precision guard** | **1** | *rose 3 → 5 matches* (the two `.replace()` false positives return) |

Thirteen mutations, one pass, twelve failures, each with a distinct message. The
last two rows are the ones that matter: they show the rule's precision and its
discrimination are each load-bearing, and that removing either is detected as
drift rather than absorbed.

### What this does NOT gate, and why — two refusals

1. **(B) "a writer reached the store without establishing enforcement" is not
   expressible as a content match, and the honest population is too small to
   ratchet.** I built and measured the obvious proxy — every
   `PRAGMA foreign_keys = OFF`, in Rust and in JS/TS (`db.pragma('…')`,
   `enableForeignKeyConstraints: false`) across `src-tauri` and `scripts` — and
   it returns **6 files / 10 matches**, of which **one is the sanctioned
   `FkDisabledGuard` implementation itself** (`db/src/lib.rs:181`) and eight are
   test fixtures. It cannot be excluded by shape, only by path, and a path
   exclusion over the file that *defines* the compliant primitive is a
   suppression that will silently cover any future violation added to that file.
   More decisively: the condition is not "the pragma is written `OFF`" but "a
   connection was opened and enforcement was never established", which is a
   file-level *absence* — and a census rule counts occurrences within a file and
   cannot express an absence at all. **The checker that can express it is
   `vibeman`'s, and we should copy it**: read the pragma back after setting it
   and warn if it did not stick (`sqlite.driver.ts:115-118`), plus a Rust test on
   a fresh `init_test_db()` asserting `PRAGMA foreign_keys == 1` on a pooled
   connection — the assertion that already exists at `incremental.rs:9305` and is
   the only one in the repo. For the second-writer half there is no static
   answer: **`scripts/test/clean-env.cjs` should call `PRAGMA foreign_key_check`
   after its clear and refuse to exit 0 on a non-zero count.** That is five lines
   in the script that caused the damage, and it is the highest-value single fix
   in this document.

2. **(C) "no orphans exist" is a must-be-zero condition, and the census engine
   cannot express it.** A rule matching zero fails structurally by design. So
   this is a test, and it is the one to build first:

   ```rust
   #[test] fn the_graph_has_no_orphans() {
       let pool = init_test_db().unwrap();
       let conn = pool.get().unwrap();
       // Assert the instrument BEFORE the result — a database with no FKs
       // produces an empty violation list and a false pass.
       let fks: i64 = conn.query_row(
           "SELECT COUNT(*) FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) fk
             WHERE m.type = 'table'", [], |r| r.get(0)).unwrap();
       assert!(fks > 150, "only {fks} foreign keys — the pragma join is broken, not the schema");
       let v: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
       assert_eq!(v, 0, "{v} foreign-key violations after the migration chain");
   }
   ```

   On a fresh chain this passes today and is nearly vacuous — which is honest to
   say, and is exactly why it must be paired with the **runtime** half that the
   test cannot reach: a `foreign_key_check` run against the *real* database, at
   boot or in `spawn_idle_maintenance_task` (`db/src/lib.rs:226-259`), whose
   result reaches a human. It costs **894 ms** on a 347 MB database with 244
   tables and 1,030 violations, it is idle-gated infrastructure that already
   exists, and it is the only artifact in any design that would have surfaced
   P0-a. Log the count and the top offending `(child → parent)` pairs at
   `tracing::warn!` when non-zero, and surface it in the system health panel.
   **Do not auto-delete the rows** — an orphan is evidence, and this document is
   the argument that we currently destroy that evidence by never looking at it.

   The complementary schema-level half — the `sqlite_master` set-difference for a
   dangling *parent table*, blind to `foreign_key_check` — **already exists** as
   `no_foreign_key_points_at_a_missing_table` and now runs in CI. Nothing to
   build there; it is the model for the assert-the-instrument-first shape above.

**On severity.** The census is a ratchet, not a severity ladder: it fails a run
when a count moves. No argument is made here from warning volume, and none could
be — `npm run check` runs `eslint src/` with no `--max-warnings` and the
pre-commit hook runs `--quiet`, so a warn-level rule enforces nothing at either
gate at any count. The census rule enforces; a lint rule would not.

### A note on an adjacent published rule

`hand-rolled-fixture-ddl` (baseline 37 files / 93 matches) is the closest
existing rule to this leaf's fixture finding, and this sweep measured its
territory by an independent route. Two things worth recording:

- **A measured disagreement.** Its description states *"72 of them are
  `#[cfg(test)]` fixtures shadowing 38 tables the migration chain already owns"*.
  This sweep's parser — which resolves `#[cfg(test)]` by brace-matched byte
  ranges and matches names against the parsed production table set — reports
  **67 shadow statements over 44 distinct production tables in 30 files**. Same
  condition, different extraction, a 6-table gap. This is the same class of
  one-off `index-design` recorded between its DDL parser and
  `persisted-model-struct` (41 vs 40 tables). Neither is obviously wrong; the
  disagreement should be resolved before either number is quoted as authoritative.
- **A scope limit, by construction.** The rule counts that a fixture *exists*. It
  cannot see what the fixture *dropped*, because that requires the production
  twin from another file. So `hand-rolled-fixture-ddl` at 93 is fully compatible
  with the 21 lost FK constraints in §7 being invisible — it is not a recall gap
  in its pattern, it is the boundary of what a single-file matcher can express,
  and it is precisely why refusal 1 above declines to write a second regex for
  the same territory. Its pattern also anchors on `CREATE\s+TABLE` and so would
  not match `CREATE VIRTUAL TABLE`; **I did not measure whether any fixture uses
  that form**, so this is flagged, not claimed.

## See also

- [Entity deletion](./delete-semantics.md) — the consumer of this graph; and see
  §2 above for the one premise of its "the one way" that this path corrects.
- [Schema change](./schema-change.md) — where the DDL goes; its Gap 9
  (`--workspace` missing from CI) is now **cleared**, see §6.
- [Index design](./index-design.md) — the index an FK child column needs, and the
  measure-the-plan-not-the-shape discipline this path had to apply to itself.
- [Upsert](./upsert.md) — whose FK-target inventory over 308 tables this path
  reproduces and extends.
- [Boot migration step](./boot-migration-step.md) — the runtime contract for the
  chain in which `fk_hygiene::run()` aborts startup (§7 P0-b).
