# Golden path — Destructive schema change

> Situation node: `data-persistence/migrations/destructive-schema-change` ·
> [situation spine](../situation-spine.md) · recurrence 19 · risk **HIGH** ·
> sides: **server** · convergence: **diverged** ·
> dimensions: **resilience · function · code-quality · performance · cost**
> Composed 2026-08-15 against `master` @ `e611c326d`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri` (exactly `rust.files`
> in [`shared-facts.json`](../shared-facts.json)), lexed rather than grepped:
> **83,764** string literals extracted with a string/comment-aware Rust
> tokenizer, **5,639** of them holding SQL — **4,718** production and **921**
> inside **brace-matched** `#[cfg(test)]` ranges, never a line threshold. Every
> `IncrementalMigration` literal was brace-matched and classified; the **124**
> guarded steps, the **20** table rebuilds and the **15** census matches were
> **each opened and read by hand**.
>
> **Measured by execution, not by reading.** A create-copy-drop-rename was
> deliberately failed at every stage — in a transaction, out of one, and by
> `SIGKILL` — against scratch copies of the operator's live 331 MB
> `personas.db`. The boot chain's group-retirement cycle was replayed verbatim
> and timed. The FK-guard's blast radius was measured by executing the unguarded
> form and counting the rows it destroyed. The live databases were **copied** and
> opened read-only; every destructive replay ran on a copy. **`cargo` was not
> run** (PreToolUse guard — the operator's app is running), so the Rust migration
> tests were not executed; their SQL was replayed directly instead.
>
> ---
>
> ## The headline: a destructive migration that finished nine weeks ago is undone and redone on every launch, and no test, log or gate can see it
>
> `retire_persona_groups` (`incremental.rs:3534`) drops `persona_memories.group_id`
> and `dev_projects.group_id`. It completed. On the operator's database both
> columns are gone and `persona_groups` does not exist.
>
> It runs again on the next boot, and every boot after, because **two additive
> steps 300 lines upstream put the columns back first**:
>
> | # | step | line | guard | what it does |
> | --- | --- | --- | --- | --- |
> | 1 | `persona_memories_group_id` | `:3168` | `has_column(persona_memories, group_id)` → **false** | re-adds the column **+ `idx_pm_group_id`** |
> | 2 | `dev_projects_group_id` | `:3210` | `has_column(dev_projects, group_id)` → **false** | re-adds the column **+ its index** |
> | 3 | `retire_persona_groups` | `:3534` | `\|_conn\| Ok(false)` — **always runs** | drops both indexes, then `DROP COLUMN` on both tables |
>
> All three live in the same `run_incremental` body, in that order. Replayed
> verbatim against a copy of the live database, twice:
>
> | statement | boot 1 | boot 2 |
> | --- | ---: | ---: |
> | `ALTER TABLE persona_memories ADD COLUMN group_id` + index | 42.1 ms | 40.2 ms |
> | `ALTER TABLE dev_projects ADD COLUMN group_id` + index | 7.0 ms | 6.7 ms |
> | 3 × `DROP INDEX IF EXISTS` | 1.5 ms | 2.2 ms |
> | **`ALTER TABLE persona_memories DROP COLUMN group_id`** | **108.0 ms** | **107.0 ms** |
> | `ALTER TABLE dev_projects DROP COLUMN group_id` | 27.1 ms | 24.9 ms |
> | `DROP TABLE IF EXISTS persona_groups` | 0.5 ms | 0.0 ms |
> | **total** | **186.1 ms** | **181.2 ms** |
>
> The residue after two boots is byte-for-byte the residue before: same columns,
> same 6,535 rows, same file size. **SQLite's `DROP COLUMN` is a full table
> rewrite**, so the third-largest table in the database (37 MB) is rewritten on
> every launch to remove a column that was added seconds earlier by the same
> function. The whole exchange is a no-op that costs 186 ms of the 4,615 ms
> `db_init` budget and never converges.
>
> Four independent mechanisms should have caught it and none can:
>
> - **The idempotency test asserts the fixed point, and the fixed point is
>   correct.** `migration_chain_is_idempotent_on_rerun` (`incremental.rs:8563`)
>   replays the whole chain three times and checks `integrity_check`,
>   `foreign_key_check`, and the executions CHECK clause. Its own comment says
>   the third replay exists to catch *"a step whose first replay mutates the
>   state its own `already_applied` check reads."* This is a step whose replay
>   mutates the state **another step's** guard reads — two wrongs converging —
>   and an end-state oracle is structurally blind to it.
> - **There is no ledger to consult.** `PRAGMA user_version` appears **0 times**
>   in 963 files; so do `schema_migrations` and `applied_migrations`.
>   `IncrementalMigration.id` — which reads exactly like a ledger key — is
>   dereferenced at **one** place in the tree: the `tracing::info!` field at
>   `incremental.rs:19`. A comment at `:3442-3444` says *"rely on `run_step`'s
>   id-tracking to run once"*. **`run_step` (`:12-24`) tracks nothing.**
> - **The log line that would say so is written to a discarding sink.**
>   `run_step` logs `"Applied incremental migration: …"` on every application.
>   The file layer is installed at `src/lib.rs:790`, at the `file_logging`
>   checkpoint — **5,133 ms** into setup per the app's own startup timing —
>   while `db_init` occupies **0 → 4,615 ms**. `logging.rs:48-49` states the
>   consequence in its own doc comment: *"everything emitted between `init()`
>   and `add_file_layer()` is dropped."* Six days of rolling logs contain **zero**
>   `"Applied incremental migration"`, **zero** `"Initializing database"` and
>   **zero** `"Pre-migration DB backup created"` lines — while three backup files
>   on disk prove the backup ran three times today.
> - **No gate in the repo has an opinion about migrations.** All 93 census
>   rules, `npm run check`, and CI are silent here.
>
> ### Three more results that only execution produced
>
> **1 — `ddl_step`'s transaction is real, and it is the only thing standing
> between a rebuild and a destroyed database.** The `persona_executions` rebuild
> was aborted at each stage against copies of the live file:
>
> | | `persona_executions` | staging | rows | indexes | triggers |
> | --- | --- | --- | ---: | ---: | ---: |
> | baseline | present | — | 2,188 | 14 | 3 |
> | abort inside the transaction (3 stages tested) | present | — | 2,188 | 14 | 3 |
> | **SIGKILL mid-transaction, reopened** | present | — | 2,188 | 14 | 3 |
> | autocommit, abort after COPY | present | **left behind** | 2,188 | 14 | 3 |
> | autocommit, abort after DROP | **GONE** | present | *no such table* | 0 | 0 |
> | autocommit, abort after RENAME | present | — | 2,188 | **0** | **0** |
>
> The last row is the dangerous one: the app starts, every query works, and the
> table has silently lost all 14 indexes and all 3 triggers — including the
> `executions_fts` sync triggers, so the search index stops updating with no
> error anywhere. **`DROP TABLE` takes the indexes and triggers with it, and a
> rebuild that does not replay them fails in a way nothing observes.**
>
> **2 — `PRAGMA foreign_keys = OFF` inside a transaction is a no-op, and the cost
> of getting that wrong is 5,015 rows.** Executed: `BEGIN; PRAGMA foreign_keys =
> OFF;` then reading the pragma back returns **1**. Dropping `persona_executions`
> in that state cascades:
>
> | child | ON DELETE | before | after |
> | --- | --- | ---: | ---: |
> | `persona_tool_usage` | CASCADE | 5,720 | **980** |
> | `persona_manual_reviews` | CASCADE | 194 | **0** |
> | `assertion_results` | CASCADE | 106 | **50** |
> | `policy_events` | CASCADE | 25 | **0** |
> | `team_assignment_steps` | SET NULL | 1,488 | 1,488 |
>
> The 980 `persona_tool_usage` survivors are exactly the **980 orphans (17.1%)**
> [retention-and-pruning](./retention-and-pruning.md) P4 counted — they survive
> because their parent was already gone. Two paths, two methods, one number.
>
> **3 — a hand-written replacement shape destroys columns while the row count
> stays right.** The `persona_triggers` rebuild at `:1088` copies an explicit
> 10-column list; the live table has **13** columns. Replayed against the live
> data: 351 rows in, 351 rows out, and `status`, `trigger_version` and
> `unattended_mode` — 351 non-null values each — gone. **A row-count assertion
> cannot see column loss**, and a row-count assertion is the only integrity check
> any rebuild in this file performs. Worse, `SELECT *` into a hand-written shape
> fails loudly on a column-count mismatch but **silently transposes values** on a
> reorder (executed: `execution_id` came back holding the metadata JSON).
>
> ### Sibling boundaries, settled in prose
>
> [**Schema change**](./schema-change.md) owns *where a new table or column
> goes* — the one legal home, the registries it must join, the model→repo→command
> chain. **This path owns the operation that cannot be expressed as an append**:
> removing, renaming or narrowing something that already holds data.
>
> [**Boot migration step**](./boot-migration-step.md) owns *how a step must
> behave the 400th time it runs* — guard design, `?` vs `tracing::error!`, phase
> ordering, the steady-state boot-work budget it measures at ~436 authorizations.
> **This path owns the subset where a wrong answer is unrecoverable**: an
> additive step that half-applies can be finished by hand; a destructive one has
> already destroyed its own source. Its §9 proposes two unbuilt instruments; §9
> here ships a census rule neither of them covers, and hands it a second one.
>
> [**Transaction boundary**](./transaction-boundary.md) owns *when to open a
> transaction*. **This path owns the one case where the answer is never in
> doubt** — and supplies, in the table above, the first executed measurement in
> the corpus of what the alternative actually leaves behind.
>
> [**Foreign-key policy**](./foreign-key-policy.md) owns the FK graph.
> **This path owns what a `DROP TABLE` does to it while enforcement is on**, and
> why the pragma that disables it must be set outside the transaction.
>
> [**Second database**](./second-database.md) owns the two-store topology.
> **This path adds that the second store has no destructive-migration capability
> at all** — no runner, no guard, no transaction, no backup (§8 Gap 6).
>
> [**Retention and pruning**](./retention-and-pruning.md) owns the *scheduled*
> delete. **This path owns the one-time delete of a structure**, and confirms its
> P6 finding on backup horizon from the other side: the 994 MB in `backups/`
> exists because a destructive chain replays on every boot.
>
> [**Rust test fixtures**](./rust-test-fixtures.md) owns `init_test_db()`.
> **This path adds the one thing no fixture can supply**: a database that has
> been through the *old* shape, which is the only population a destructive
> migration is written for.
>
> The **Deviations** section is a fix backlog.

---

## 1 Trigger

- "This column is dead — can I drop it?" / "Can we just delete this table?"
- "Rename this column." / "Make it NOT NULL." / "Widen this CHECK constraint."
- "SQLite says it can't do that." / "How do I change a primary key?"
- "This migration ran, but it keeps running." / "Why is boot slower than it used to be?"
- "What happens if the app dies during a migration?" / "Can we roll this back?"
- "The user's on an old build and the database is newer — what happens?"

If you are about to type `DROP TABLE`, `DROP COLUMN`, `RENAME TO`,
`CREATE TABLE <x>_new`, `INSERT INTO <x>_new SELECT`, `FkDisabledGuard`,
`PRAGMA foreign_keys = OFF`, or a `CREATE TABLE` that differs from the shape a
live install already has — you are in this situation.

**Not this path:** *where an additive change goes* is
[schema-change](./schema-change.md); *how any boot step's guard should be
written* is [boot-migration-step](./boot-migration-step.md); *what `ON DELETE`
to declare* is [foreign-key-policy](./foreign-key-policy.md); *the scheduled
delete of rows* is [retention-and-pruning](./retention-and-pruning.md).

## 2 The one way

**Never write the replacement shape yourself: read the table's own stored DDL,
change the one clause you came to change, and copy with `SELECT *` — then prove
the copy before you swap.** A destructive migration is a *swap under a
constraint you cannot restate*, because the live table's real shape is the sum
of every `ALTER` that ran since the rebuild was authored and you do not know
what that sum is. So: **(a)** take `SELECT sql FROM sqlite_master WHERE
type='table' AND name=?`, apply a single `replacen` for the clause you are
changing, and **bail with an error if the replacement did not change anything** —
a shape you do not recognise is a shape you must not rebuild
(`incremental.rs:130-134` and `:8247-8252` are the two spellings). **(b)** Take
`PRAGMA foreign_keys = OFF` through `FkDisabledGuard` **in autocommit, before
the transaction opens** — inside a transaction the pragma is a documented no-op
that reads back as `1`, and `DROP TABLE` then fires every `ON DELETE CASCADE`
pointed at the table (measured: 5,015 rows). **(c)** Capture the index and
trigger DDL from `sqlite_master` *before* the drop and replay it after the
rename; `DROP TABLE` takes them with it and nothing will tell you. **(d)** Put
the entire create-copy-drop-rename in **one** `ddl_step` transaction — executed,
that is the difference between a clean rollback and a database whose central
table does not exist. **(e)** Prove the swap *inside* the transaction before
`commit()`: assert the row count survived **and** that no declared column was
dropped, because a narrowed copy preserves the count exactly. **(f)** Make the
`already_applied` guard read the **postcondition you are creating**, not the
precondition you are removing — and check that no earlier step in the chain
re-creates what you dropped, because a guard that reads live schema shape is
only as idempotent as the rest of the chain agrees to be. **(g)** State in a
comment what an older build does with the new shape, because there is no schema
version and nothing will refuse to open. Then stop: no `let _ =` on a
destructive statement, no hand-written `CREATE TABLE <x>_new`, no second
transaction inside one step.

If you must pick one to get right first: **(a)**. It is the only one whose
failure is *silent, permanent and shaped exactly like success*.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `db/src/migrations/fk_hygiene.rs:163` `recreate_with_fk` | **the reference rebuild.** Idempotency from `pragma_foreign_key_list`; FK guard outside the transaction with the bug it fixes written down (`:184-190`); the column list derived from `pragma_table_info`, with any column the new shape never heard of re-added to staging so it rides along (`:232-259`); index/trigger DDL replayed from `sqlite_master`; **row count asserted before the swap** (`:275-280`); `pragma_foreign_key_check` asserted before commit (`:309-317`). Serves 9 tables. |
| `incremental.rs:33` `ddl_step(conn, sql)` | `unchecked_transaction` + `execute_batch` + `commit`. Executed: a failure or a `SIGKILL` at any stage rolls the whole rebuild back with zero residue. **Use it for the entire rebuild, once.** |
| `db/src/lib.rs:173` `FkDisabledGuard` | RAII `PRAGMA foreign_keys = OFF` … `ON`. Construct it **before** `ddl_step`, never inside. |
| `incremental.rs:104` `rebuild_executions_table_with_incomplete_status` | the in-file reference for *widening a CHECK*: stored DDL → one `replacen` → bail if unchanged → `SELECT *` → replay aux DDL → rebuild the FTS index (the bulk INSERT does not fire its triggers). |
| `incremental.rs:198` `repoint_mcp_gateway_members_fk` | the only rebuild in the file that **asserts the row count inside the transaction** (`:262-273`) and rolls back on mismatch. Copy that half. |
| `incremental.rs:4213` `retire_db_skills_system` | **the reference destructive step.** Guard is the conjunction of all three postconditions (`Ok(!has_table && !has_table && !has_table)`); the loop re-checks each table; it **counts rows and refuses to drop a non-empty table**, warning instead; children before parents. Its comment (`:4205-4207`) names the constraint it is working under: *"`already_applied` is schema-shape-based (no migration ledger)."* |
| `incremental.rs:5` `IncrementalMigration` / `:12` `run_step` | the step record and its runner. Know what it does **not** do: nothing is recorded, `id` is a log label. |
| `incremental.rs:40/49/76` `has_column` / `has_table` / `has_index` | the three legal guards. All read live schema. |
| `incremental.rs:65` `report_failed_group_id_drop` | the posture for a `DROP COLUMN` SQLite may legitimately refuse: log at `error!`, keep the dead column, do not brick the launch. |
| `incremental.rs:168` `dangling_fk_count` | the probe `PRAGMA foreign_key_check` cannot replace — it sees an FK whose parent table does not exist, which the standard check is blind to on an empty child. |
| `db/src/backup.rs:48` `backup_before_migrations` | the pre-migration snapshot, taken before any connection opens the file. **Personas is the only repo in the six-repo sample that has one** (§6 Convergence). |

**Do not exist — this path names them:**

- **A migration ledger.** No `user_version`, no `schema_migrations`. Four of five
  sibling repos have one (§6).
- **A schema version, and therefore any refusal to open a newer database with an
  older build.** The repo has three forward-compat version checks —
  `bench/db.rs:14`, `commands/artist/persistence.rs:47` + `classify`,
  `engine/team_preset_loader.rs:63` (which *errors* on a newer
  `schema_version`) — and **none of them guards a database**.
- **A restore path.** `backups/` is referenced by `backup.rs`, its own tests, and
  nothing else — **zero references in `src/` (frontend) and zero in the rest of
  `src-tauri/`**. The module doc (`backup.rs:8-10`) describes recovery as
  copying a file back by hand.
- **A `down` half.** No migration in the tree has one, and none of the five
  siblings does either — the one convergent result on this clause.
- **Any assertion that a rebuild preserved the column set.** One rebuild of 11
  asserts rows; none asserts columns.

## 4 Steps

1. **Ask whether you can avoid it.** A dead column costs a `NULL` per row and
   nothing else; a dead table costs a name. `personas.group_id` was
   deliberately kept for two releases for exactly this reason
   (`incremental.rs:3524-3529`), and that was the right call at the time.
   Removing it is an operation with no undo, on a machine you do not control,
   behind a backup horizon of three boots.
2. **If it must go, decide which shape of change it is.** `ALTER TABLE … DROP
   COLUMN` is native in SQLite 3.35+ and works here — but it **refuses while any
   index, trigger or view names the column** and it **rewrites every row**.
   Anything else — a CHECK, a foreign key, `NOT NULL`, a rename, a primary key —
   needs a full rebuild.
3. **For a rebuild, take the shape from the database, not from your editor.**
   `SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`, one
   `replacen` for the clause you are changing, and a **hard bail if the
   replacement was a no-op**. Then `replacen` the table name once more to point
   the CREATE at a staging name. If you cannot express the change as a single
   substitution on the stored DDL, use `recreate_with_fk`, which reconciles the
   column list instead.
4. **Capture what the drop will take with it, before you drop.**
   `SELECT type, name, sql FROM sqlite_master WHERE tbl_name = ? AND type IN
   ('index','trigger') AND sql IS NOT NULL`. Auto-indexes carry a NULL `sql` and
   are recreated implicitly; everything else is yours to replay. If the table has
   an external-content FTS index, `INSERT INTO <fts>(<fts>) VALUES('rebuild')` —
   the bulk copy does not fire the sync triggers.
5. **Construct `FkDisabledGuard` now, in autocommit.** Before `ddl_step`, not
   inside it. **Seven production sites do this correctly** (`fk_hygiene.rs:191`;
   `incremental.rs:105`, `:247`, `:465`, `:6931`, `:8234`, `:8390`) and each says
   why in a comment; copy `fk_hygiene.rs:184-190`, which is the one that names
   the incident.
6. **Build the whole batch and hand it to ONE `ddl_step`.** `DROP TABLE IF
   EXISTS <staging>` (a rolled-back earlier attempt cannot collide), the staged
   CREATE, `INSERT INTO <staging> SELECT * FROM <table>`, `DROP TABLE <table>`,
   `ALTER TABLE <staging> RENAME TO <table>`, the replayed index/trigger DDL,
   the FTS rebuild.
7. **Prove it inside the transaction.** Count rows before and after and refuse
   the swap on a mismatch (`repoint_mcp_gateway_members_fk` `:262-273`). **Then
   count columns too** — the count is preserved by a narrowing copy and 7 of this
   file's 11 rebuilds are narrowing candidates. `pragma_foreign_key_check` before
   commit if the table has children.
8. **Write the guard as the postcondition, and then read the rest of the chain.**
   `already_applied` must answer "the new shape is present", never "the old shape
   is absent" — and **grep the chain for anything upstream that re-creates what
   you dropped**. That one grep is the entire content of the headline defect.
   Never `|_conn| Ok(false)`; the two steps that use it run forever.
9. **If the step needs more than one transaction, it needs more than one
   guard.** A step whose `already_applied` names one object while its body
   commits N transactions records a failure between them as completion —
   permanently, and on a boot that then succeeds. Either fold everything into one
   `ddl_step`, or make the guard a conjunction over every object and re-check
   before each statement (`owned_devices_pairing_columns` `:4703` is the shape;
   its comment at `:4696-4698` states the requirement).
10. **Write a test that has been through the old shape.** `init_test_db()`
    builds the *new* shape, so a test over it proves nothing about the population
    this migration exists for. Hand-construct the legacy table with rows, run the
    chain, assert the rows and **the columns** survived —
    `legacy_mcp_gateway_members_fk_is_repaired_without_losing_rows`
    (`incremental.rs:9339`) and
    `a_blocked_group_id_drop_no_longer_takes_persona_groups_with_it`
    (`:8658`) are the two models.
11. **Then stop.** No `let _ =` on a destructive statement. No second
    `ddl_step` in the same step. No `PRAGMA foreign_keys` inside a transaction.
    No hand-written `CREATE TABLE <x>_new`.

## 5 Anti-patterns

- **Writing the replacement shape by hand.** *Failure:* the copy carries only
  the columns you remembered. **Measured: the `persona_triggers` rebuild at
  `:1088` copies 10 named columns into a table that now has 13 — replayed
  against live data it preserves all 351 rows and destroys `status`,
  `trigger_version` and `unattended_mode`, 351 non-null values each.** Nothing
  errors. 7 of this file's 11 rebuilds are written this way.
- **`INSERT INTO <staging> SELECT *` into a shape you wrote yourself.**
  *Failure:* a positional copy between two independently-authored shapes. One
  extra column raises `table … has 8 columns but 9 values were supplied` (loud,
  fine); the **same count in a different order silently transposes every value**
  (executed: `execution_id` came back holding the metadata JSON). `SELECT *` is
  correct **only** when the staging shape came from the source's own DDL.
- **A row-count assertion as the integrity check.** *Failure:* it passes for
  every column-loss case, which is the case hand-written shapes actually produce.
  Count columns as well, or derive the list.
- **`PRAGMA foreign_keys = OFF` inside the transaction.** *Failure:* documented
  no-op; executed, the pragma reads back `1` and `DROP TABLE persona_executions`
  destroys 5,015 rows across four child tables. `fk_hygiene.rs:184-190` records
  this exact incident.
- **Dropping the table and not replaying its indexes and triggers.** *Failure:*
  the app works. Queries are slow, and an external-content FTS index quietly
  stops updating because its sync triggers went with the table. Executed: the
  only observable difference is `sqlite_master`.
- **Two `ddl_step`s in one migration step.** *Failure:* a failure between them
  leaves the step half-applied, the boot aborts, the user restarts, the guard now
  answers "applied", and the missing half never lands. Executed on a copy of the
  live database: `dev_kpis.factory_calibration` (`:6105`) commits `warn_at`, then
  fails; on the next boot `has_column(dev_kpis, warn_at)` is true, the step is
  skipped, and `crit_at`/`manual_rating`/`assessment_pros`/`assessment_cons` are
  **permanently absent** — every reader gets `no such column: crit_at`, and the
  app starts fine. **The failure heals into a broken schema.** 15 steps have this
  shape (§9).
- **`already_applied: |_conn| Ok(false)`.** *Failure:* the step is not a
  migration, it is a boot-time job. Both of the two sites that use it are
  destructive, and one of them is the headline.
- **Guarding on the precondition you are removing rather than the postcondition
  you are creating.** *Failure:* the guard is a function of the old world, so
  anything that recreates the old world re-arms it. This is the mechanism behind
  the group_id cycle, and it is invisible to an end-state idempotency test.
- **`let _ =` on a destructive statement.** *Failure:* the error that says
  "SQLite refused because an index still names this column" is discarded, and the
  next statement — which assumed the drop succeeded — proceeds.
  `a_blocked_group_id_drop_no_longer_takes_persona_groups_with_it`
  (`incremental.rs:8658`) exists because that sequence once left `personas` with
  a `REFERENCES persona_groups(id)` clause pointing at nothing, breaking **every**
  `INSERT INTO personas`. **16 destructive statements still discard their
  Result** (§7 D5).
- **A test over `init_test_db()`.** *Failure:* the fixture builds the *new*
  shape, so the migration's guard short-circuits and the test asserts that a
  no-op is safe. The population a destructive migration is written for is the one
  no fixture produces.
- **Assuming an older build will refuse a newer database.** *Failure:* it will
  not. There is no version anywhere. It will run its own chain, whose additive
  steps will happily re-add columns a newer build dropped — which is not a
  hypothetical, it is what the headline defect does within a *single* build.

## 6 Evidence

**The ONE site to copy: `db/src/migrations/fk_hygiene.rs:163` `recreate_with_fk`.**

Read it as eight decisions: (1) idempotency from `pragma_foreign_key_list`, a
postcondition of the new shape; (2) `FkDisabledGuard` in autocommit with the
incident it prevents written down; (3) the live column list from
`pragma_table_info` — *"Every caller used to hand-write a `columns_csv`, which
meant the copy silently DROPPED any column a later migration had added"*
(`:140-150`); (4) columns the new shape does not declare are **re-added to
staging** (`add_column_ddl`, `:75`) with a `warn!` naming any constraint
`ALTER TABLE` could not express; (5) index/trigger DDL replayed from
`sqlite_master`, new-shape indexes first so they win a name collision;
(6) row count asserted before the swap, `AppError::Validation` on mismatch;
(7) `pragma_foreign_key_check` asserted before commit; (8) one transaction
around all of it. It serves nine tables and its `narrow_to_columns_csv` escape
hatch is `None` at every production call site.

Supporting exemplars, one property each:

| site | the property to copy |
| --- | --- |
| `incremental.rs:107-134` | stored DDL + one `replacen` + **bail if the substitution changed nothing** — *"bail rather than build a table that silently keeps the old constraint"* |
| `incremental.rs:8244-8252` | the sharper spelling of the same guard: `create_sql.matches("'simulation'").count() != 1` → refuse. A substitution is only safe if the token is unique |
| `incremental.rs:262-273` | row count asserted **inside** the transaction, `tx` dropped un-committed on mismatch |
| `incremental.rs:4213` `retire_db_skills_system` | conjunction guard; per-object re-check; **counts rows and refuses to drop a non-empty table**; children before parents |
| `incremental.rs:4703` `owned_devices_pairing_columns` | the multi-transaction step done right: guard is `Ok(has_ && has_ && has_)`, each statement re-checks. *"a partial of this step must be able to finish it"* |
| `incremental.rs:65` `report_failed_group_id_drop` | a refused `DROP COLUMN` is logged at `error!` and does not abort a launch — but is not swallowed |
| `incremental.rs:2255-2266` | the guard that replaced a permanent false positive — an INSERT-probe *"a permanent false-positive that rebuilt the whole table (an O(n) copy of all chat history) on every single launch"* (`:2261`), now a read of the stored CHECK |
| `incremental.rs:8415-8420` | the rename that accounts for `foreign_keys = OFF`: *"with foreign_keys OFF, SQLite does not rewrite REFERENCES clauses during a rename, so the clause has to be written as its final form up front"* |
| `db/src/backup.rs:64-73` | the backup counter that must be `max + 1`, not first-free, *"a reused low slot would make the NEWEST backup sort as the oldest"* |

### The population, measured

| | count |
| --- | ---: |
| `IncrementalMigration` steps (`run_incremental` 72 + `ensure_composite_fires_table` 52) | **124** |
| …of which contain destructive DDL (5 inline + 4 via a helper fn) | **9 (7.3%)** |
| …of which use `already_applied: \|_conn\| Ok(false)` | **2** — `retire_persona_groups` (destructive) and `groups_to_teams_data_migration` (an irreversible data migration) |
| guard kinds over the 124: `has_column` / `has_table` / custom `sqlite_master` probe / `has_index` / `Ok(false)` | 61 / 56 / 3 / 2 / 2 |
| production `ddl_step(` calls inside a guarded step / outside any | **160 / 217** |
| production `DROP TABLE` / `DROP COLUMN` / `ALTER…RENAME TO` statements | **22 / 15 / 12** |
| production `DROP INDEX` / `DROP TRIGGER` / `RENAME COLUMN` / `DROP VIEW` | 8 / 1 / **0** / **0** |
| **table rebuilds** (11 in `incremental.rs` + 1 generic helper serving 9 tables) | **20** |
| …shape derived from the table's own stored DDL | **4** |
| …shape hand-written in Rust source | **7** |
| …shape hand-written but the copy reconciled against `pragma_table_info` (`recreate_with_fk`) | **9** |
| …that assert the row count survived | **1 of 11** in-file (+ the helper) |
| …that assert the column set survived | **0** |
| rebuilds run under an ad-hoc `if <probe>` instead of a `run_step` | **4** (`:387`, `:458`, `:1067`, `:2275`) |
| destructive statements whose `Result` is discarded (`let _ = ddl_step`) | **16** |
| migration ledgers, schema versions, downgrade guards, restore paths | **0 / 0 / 0 / 0** |

### The live databases (read-only copies, 2026-08-15)

`personas.db` 331 MB (347,054,080 bytes), 241 tables, 745 indexes, 5 triggers.
`personas_data.db` 17 MB. Backups: **3 sets, 994 MB, all created today** (18:58,
19:36, 19:48 UTC — three boots in one evening under `MAX_BACKUPS = 3`), plus two
stray `personas-cleanbak-*.db` from June in the data root that no rotation rule
matches. A 331 MB `fs::copy` measured at **308–404 ms**, paid on every boot.

**The schema graveyard is small, and that is a real positive result.** Against
the app corpus (963 `.rs` + 4,828 `.ts`/`.tsx`, 46.6 MB) versus the six
schema-owning files (0.6 MB): **4 tables** nothing outside the migration chain
names (`budget_alert_rules`, `shared_event_analytics`, `research_citations`,
`research_report_sections` — all **0 rows**) and **9 columns**. **Zero foreign
keys point at a missing table.** One column — `persona_design_patterns.source_review_ids`
— is named **nowhere in the repository at all**, not even in the migration that
created it: a column whose creator was deleted from source while the column
survived in every installed database. Compare the 19 orphan ts-rs bindings the
brief cites: the schema has an orphan rate two orders of magnitude lower, because
`CREATE TABLE IF NOT EXISTS` at least keeps the DDL that produced it — and this
one column is the exception that shows what happens when it does not.

### The test suite is a genuine strength, and this is where it stops

21 test functions live in the brace-matched `#[cfg(test)]` range
(`incremental.rs:8450-9430`), including:

| test | what it proves |
| --- | --- |
| `milestone_item_description_rating_alter_is_safe_on_a_populated_db` (`:8500`) | an ALTER against rows, not an empty fixture |
| `migration_chain_is_idempotent_on_rerun` (`:8563`) | three full replays + `integrity_check` + `foreign_key_check` |
| `a_genuinely_failed_guarded_alter_is_no_longer_swallowed` (`:8620`) | a deliberate mid-chain failure, asserting **where** the chain stopped |
| `a_blocked_group_id_drop_no_longer_takes_persona_groups_with_it` (`:8658`) | a legacy shape with a composite index the migration's DROP list never heard of |
| `widening_the_measurement_source_preserves_rows_and_later_columns` (`:8844`) | rows **and** later-added columns survive a rebuild |
| `legacy_mcp_gateway_members_fk_is_repaired_without_losing_rows` (`:9339`) | a legacy FK repaired against seeded rows |
| `retire_db_skills_drops_empty_but_preserves_nonempty` (`:9154`) | a destructive step that refuses non-empty tables |
| `no_foreign_key_points_at_a_missing_table` (`:9229`) | the whole-schema dangling-FK sweep |

**Only 1 of 5 sibling repos has a single mid-migration-failure test and 0 of 5
run a destructive migration against rows. Personas has both, several times
over.** What none of them can see is the headline defect, because every one
asserts an *end state* and the defect lives in the *path* — the chain arrives at
the correct shape by adding and removing the same two columns on every launch.

### Convergence — 5 sibling repos, swept read-only

All five checkouts exist; nothing below is reported by omission.

| # | clause | personas-web | brainiac | personas-cloud | vibeman | ascent | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | a migration system at all | none — 2 re-appliable SQL scripts | 45 numbered `.sql` (sqlx) | 10-entry versioned TS array | 162 guarded `once()` steps | 30 Prisma dirs | **physics** (4/5) |
| 2 | **a ledger rather than a shape probe** | shape only | `_sqlx_migrations` + **per-file checksum** | `migration_version`, bootstrapped from shape | `_migrations_applied`, bootstrapped from shape | `_prisma_migrations` — **never applied** | **INVERTED — Personas is the only repo with no ledger of any kind** |
| 3 | destructive operations | 1 dedup DELETE | **1** DROP COLUMN in 45 | **0** | 15 rebuilds, 3 DROP COLUMN, 27 dropped tables | 2 widening ALTERs | Personas' 9 sits mid-pack |
| 4 | each destructive step in a transaction | accidental (one `client.query`) | yes, by the runner | yes, one tx for the batch | yes at the runner — **and broken from inside by 4 nested `BEGIN`s** | n/a | **physics** |
| 5 | **a backup because a migration is about to run** | **SILENCE** | **SILENCE** (daily 03:15 cron, not a pre-migration hook) | **SILENCE** | **SILENCE** — 4 stores, ~185 MB, none | **SILENCE** (1-day provider retention) | **SILENCE 5/5 — Personas is alone** |
| 6 | a `down` / rollback half | none | none | none | a rollback endpoint that guesses | none (Prisma has none) | **SILENCE 5/5** |
| 7 | a guard against an older build opening a newer DB | none | **yes**, inherited from sqlx | **explicit proceed** (`db.ts:202-205`) | none | none | **rare** (1/5) |
| 8 | a test that fails a migration halfway | **SILENCE** | **SILENCE** | **SILENCE** (1 test file in the monorepo) | **yes** (`migration-runonce.test.ts:75-86`) | **SILENCE** | **rare** (1/5) |
| 9 | a destructive migration tested against rows | **SILENCE** | incidental | **SILENCE** | empty-DB only | **SILENCE** | **SILENCE 5/5 — Personas is alone** |
| 10 | time-based backup rotation | n/a | `RETENTION_DAYS=14`, `find -mtime` | n/a | n/a | `BackupRetentionPeriod: 1` | count-based appears **nowhere else** |

**Physics — keep as doctrine:**

- **§2(d) one transaction per destructive step.** Independently arrived at in
  four stacks. `brainiac` documents it inside the SQL itself
  (`0006_hnsw_ann_index.sql:26-27` — *"sqlx wraps each migration in a
  transaction"*); `personas-cloud` wraps the whole batch and stamps the version
  inside it (`db.ts:212-225`); `vibeman` wraps at the runner
  (`migration.utils.ts:296-305`). No shared document.
- **§2(f) a ledger, or a guard bootstrapped from shape.** Two siblings
  independently invented the *same migration* out of shape-probing:
  `personas-cloud/db.ts:129-188` reconstructs a version by probing eight columns
  in descending order, and `vibeman/index.ts:142-165` pre-seeds four destructive
  migrations as applied if `tableExists(db,'ideas')`. Neither knew about the
  other. **That is the exact path Personas would take, discovered twice.**

**Silence — report as silence, do not dress it as consensus:**

- **A pre-migration backup: 5 of 5, absent.** `brainiac` has the only real backup
  story in the family — `pg_dump -Fc`, offsite, restore, and a restore *drill*
  whose script says *"An untested backup is a rumour"* (`restore-drill.sh:14`) —
  and it is a **daily cron**, with `migrate()` called unguarded from seven boot
  paths. **Personas is ahead of all five here and the practice is not
  convergence-validated; it rests on the local argument alone** (§2, and
  `backup.rs:15-17` states it: no schema-version counter means no cheap "will
  this boot change anything?" signal, so it backs up every time).
- **A `down` half: 5 of 5, absent.** Do not propose one. The convergent answer
  is forward-only + a snapshot, which is what this repo has.
- **A destructive migration exercised against rows: 5 of 5, absent.** Personas'
  four such tests are the only ones in the sample.

**The two negatives worth carrying, because both are Personas' own failure mode
in another dialect:**

- **`personas-cloud` ships a migration that can never run.**
  `LATEST_MIGRATION_VERSION = 9` is hand-maintained at `db.ts:37`; the array
  contains a **version 10**; `db.exec(SCHEMA)` runs first and already includes
  the column the shape-probe bootstrap looks for, so a **brand-new** database is
  stamped version 9 and `:202-205` returns early forever. Four call sites
  (`db.ts:1403`, `:1453`, `:1465`, `httpApi.ts:1294`) read columns that migration
  10 was supposed to add. **A hand-maintained ceiling plus a shape-probe
  bootstrap is two sources of truth for one number, and the array is the one that
  drifts** — the same class as Personas' guard reading a shape a different step
  controls.
- **`vibeman` ships a rollback button wired to a keyword guess.**
  `api/migrations/route.ts:33-56` infers "affected tables" from a 20-entry
  name→table map and `:78-88` emits `DROP TABLE IF EXISTS` for each. It does not
  fire today only because `recordMigration` is never called with its third
  argument and every migration is named `m001…m238`, so the DDL list comes out
  empty — after which `:174-181` still runs `DELETE FROM _migrations_applied`, so
  the migration re-runs next boot against a schema that still has its changes.
  **A rollback that guesses is worse than none**, and it is the strongest
  argument in the sweep for the forward-only + snapshot posture §2 prescribes.

## 7 Deviations

Every entry is live on `master` @ `e611c326d` and measured against the
operator's running database.

### D1 — `retire_persona_groups` is undone and redone on every launch

`incremental.rs:3168` + `:3210` re-add `persona_memories.group_id` and
`dev_projects.group_id`; `:3534` drops them again, guarded by `|_conn| Ok(false)`.
Measured cost **186 ms per boot**, including two full rewrites of a 37 MB /
6,535-row table. The comment at `:3544-3551` says *"`has_column` guard makes it
a no-op on fresh DBs and on re-run"* — **the re-run is not a no-op, because the
guard's precondition is restored upstream in the same function.**

*Fix, in order:* (1) delete steps `persona_memories_group_id` (`:3165-3180`) and
`dev_projects_group_id` (`:3207-3222`) — the concept was retired in Phase 5 and
their columns are dead by the retiring step's own doc comment; (2) give
`retire_persona_groups` a real postcondition guard —
`Ok(!has_table("persona_groups")? && !has_column("persona_memories","group_id")? && !has_column("dev_projects","group_id")?)`
— which is exactly the `postcondition_todo` [boot-migration-step](./boot-migration-step.md)'s
§9 allowlist already records for it; (3) keep the `report_failed_group_id_drop`
posture so a refused drop still retries.

### D2 — 7 of 11 in-file rebuilds hand-write the replacement shape

| line | table | copy | later `ADD COLUMN`s on that table |
| ---: | --- | --- | --- |
| 418 | `n8n_transform_sessions` | explicit 12 of 14 | — |
| 489 | `persona_triggers` | explicit 9 | `use_case_id@624`, `status@2175`, `trigger_version@2323`, `unattended_mode@2341` |
| 1088 | `persona_triggers` | explicit 10 | `status@2175`, `trigger_version@2323`, `unattended_mode@2341` |
| 2290 | `chat_messages` | **`SELECT *`** into a hand-written 8-column shape | — |
| 3760 | `credential_rotation_policies` | explicit 9 | — |
| 6045 | `dev_kpi_measurements` | explicit 7 | — |
| 6948 | `workspace_practice_adoption` | explicit 7 (**7,099 rows**) | — |

Each is safe *today* only because the chain runs in file order, so the columns
added later have not been added yet when the rebuild fires. That is a property of
the ordering, not of the code: **any future step inserted above one of these
rebuilds, or any legacy database whose shape probe fires late, silently loses the
columns the literal omits.** `chat_messages` is the sharpest: `SELECT *` into a
shape that is not derived from the source is a positional copy, and executed, a
same-count reorder transposes values with no error.

*Fix:* migrate all seven to the stored-DDL form (`:107-134` is 28 lines), or
route them through `recreate_with_fk` with `narrow_to_columns_csv: None`, which
reconciles the list from `pragma_table_info`.

### D3 — 15 migration steps record a partial failure as completion

Guard names one object; the body commits 2–5 independent `ddl_step`
transactions; nothing re-checks between them. **27 objects — 2 tables, 10
columns, 15 indexes — sit behind a guard that does not name them.** Executed
against a copy of the live database, a failure in transaction 2 of
`dev_kpis.factory_calibration` aborts the boot, and the *next* boot succeeds with
four columns permanently missing. Full list in §9.

**Live instance count: zero.** All 27 objects are present on the operator's
database. The class is real; the operator has not hit it.

*Fix:* one `ddl_step` per step (the 4 index-plus-table cases are a single batch),
or the `owned_devices_pairing_columns` (`:4703`) conjunction-guard shape.

### D4 — 4 rebuilds and 12 `DROP COLUMN`s run outside the guarded-step framework

`:387`, `:458`, `:1067`, `:2275` are table rebuilds under an ad-hoc
`if <shape probe> { ddl_step(…) }` rather than a `run_step` — no `id`, no
`description`, no log line, and nothing to put in an allowlist.

`drop_legacy_tool_calls_columns` (`:7645`) is worse: **12 `ALTER TABLE … DROP
COLUMN` statements, each `let _ = ddl_step(…)`, in a helper declared
`fn(&Connection)` with no `Result` at all**, called unconditionally from
`ensure_composite_fires_table` (`:5769`). Its doc comment says the
duplicate-column error on re-run *is* the success path — so every boot issues 12
statements that are expected to fail, and a statement that fails for any *other*
reason is indistinguishable. This is precisely the pattern
`a_genuinely_failed_guarded_alter_is_no_longer_swallowed` (`:8620`) was written
to eliminate; six sites were fixed and these twelve were not.
[boot-migration-step](./boot-migration-step.md)'s §9 names the same function as
one of two "migration helpers must be fallible" bugs.

### D5 — 16 destructive statements discard their Result

`:3540`, `:3541`, `:3542` (`DROP INDEX`), `:3593` (`DROP TABLE persona_groups`),
and the 12 inside `drop_legacy_tool_calls_columns` (`:7661`). The
`DROP TABLE persona_groups` one matters most: it is the last statement of the
step whose earlier statements the same function guards carefully, and the test at
`:8658` exists because an earlier version of exactly this sequence left
`personas` with a dangling FK and broke all persona creation.

### D6 — one rebuild of 11 verifies anything, and it verifies the wrong thing

`repoint_mcp_gateway_members_fk` (`:262-273`) is the only in-file rebuild that
asserts the row count. It is the right instinct and the wrong invariant for the
seven hand-written rebuilds, because **a narrowing copy preserves the row count
exactly** (measured: 351 → 351 while three columns died). `recreate_with_fk`
carries the same row-count assertion and does not need it, because it derives the
column list.

*Fix:* assert the column set — `pragma_table_info` before and after, and require
the new set to be a superset of the old minus anything the step declares it is
dropping.

### D7 — no restore path, and a three-boot horizon

`backup_before_migrations` is called once (`db/src/lib.rs:296`), for
`personas.db` only, on every boot. `backups/` currently holds **994 MB in three
sets, all created this evening** — `MAX_BACKUPS = 3` is a *count*, and three
restarts in one afternoon evict every older snapshot. **Nothing in the product
can restore one**: `backups` appears in `backup.rs`, its own tests, and nowhere
else in 963 Rust files or 4,828 TS files. The module doc (`:8-10`) describes the
recovery procedure as copying a file back by hand — a procedure the user has no
way to learn about and no UI to perform.

*Fix:* (a) make the horizon time-based, or skip the copy when no step will run
(which requires a schema version — see §8 Gap 1); (b) ship a restore command; (c)
`personas_data.db` gets no snapshot at all ([second-database](./second-database.md) P0).

### D8 — the only receipt a destructive migration leaves is discarded

`run_step` logs `"Applied incremental migration: <description>"` with a
`migration_id` field. The file log layer is installed at `src/lib.rs:790`
(`file_logging` checkpoint, **5,133 ms**); `db_init` runs **0 → 4,615 ms**.
Six days of rolling logs contain **zero** occurrences of that string, zero
`"Initializing database"`, and zero `"Pre-migration DB backup created"` — while
three backup files prove the backup ran three times today. **A destructive
schema change on a user's machine currently leaves no durable trace of any kind.**

*Fix:* move `logging::add_file_layer(&app_data_dir)` above `db::init_db_with_journal`
in the setup closure — the app data dir is already resolved at `src/lib.rs:645`,
before the pool is built, so the reordering is mechanical.

### D9 — a schema graveyard of 4 tables and 9 columns

`budget_alert_rules`, `shared_event_analytics`, `research_citations`,
`research_report_sections` — 0 rows each, named nowhere outside the migration
chain. Nine columns likewise, of which
**`persona_design_patterns.source_review_ids` is named nowhere in the repository
at all**, including the migration chain: its creating DDL was deleted from source
while the column persists in every installed database. There is no mechanism that
would ever notice.

### Structural

- **Every deviation above shipped under a green `npm run check`, a green CI, and
  a 21-test migration suite.** No script, lint rule or census rule in this repo
  has any opinion about a migration.
- `mod.rs:48-49` says `ensure_composite_fires_table` is *"Called from both run()
  and the engine directly"*. Measured: **one** call site,
  `initial.rs:286`. The `hand-rolled-fixture-ddl` census rule's exclude reason
  for `mod.rs` calls it *"the production migration chain's entry point and its
  own applied-migrations ledger table"* — **there is no ledger table**; that
  exemption's stated reason describes something that does not exist.

## 8 Gaps — what the primitives genuinely cannot do

1. **Schema shape is a lossy encoding of migration history, and it is the only
   encoding available.** `has_column` answers "is this column here now", never
   "did my step put it here". Two steps that disagree about the desired shape
   produce a stable oscillation that no guard can detect from inside. A ledger
   is the only fix, and adding one to an installed base needs the
   bootstrap-from-shape migration both sibling repos independently invented.
2. **SQLite cannot alter a CHECK, a foreign key, a `NOT NULL`, or a primary key
   in place.** Every one of those becomes a full table rebuild — a physical copy
   of the data, a window in which the table does not exist, and a manual replay
   of every index and trigger. `ALTER TABLE … DROP COLUMN` exists but refuses
   while any index/trigger/view names the column, and rewrites every row.
3. **`DROP TABLE` fires `ON DELETE CASCADE`, and the pragma that stops it is
   inert inside a transaction.** So the safe sequence is necessarily *pragma in
   autocommit → transaction → pragma restored after commit*, which means there is
   a window where FK enforcement is off on that connection and the guard's
   correctness depends on lexical scope. `FkDisabledGuard` handles it; nothing
   checks that it was used.
4. **Nothing in SQLite can assert that a rebuild preserved a column.**
   `PRAGMA integrity_check` and `foreign_key_check` both pass on a table that
   lost three columns; the row count is preserved by construction. The check has
   to be written by hand from `pragma_table_info`, and it is written nowhere.
5. **A migration that is correct today can be made wrong by inserting a step
   above it.** The seven hand-written rebuilds are safe purely because of
   statement order in a 9,430-line function, and nothing expresses that
   dependency.
6. **The second database has none of this.** `init_user_db` (`db/src/lib.rs:492`)
   applies its schema and 21 incremental statements through `let _ =
   conn.execute_batch(stmt)` — no runner, no step id, no guard, no transaction,
   no backup, and no destructive capability at all. The day something in
   `personas_data.db` needs a column dropped, none of §2 is available. See
   [second-database](./second-database.md).
7. **`init_test_db()` cannot produce the population a destructive migration
   targets.** It builds the current shape through the current chain, so every
   destructive step's guard short-circuits. The legacy shape must be
   hand-constructed per test, which is why only four such tests exist against
   nine destructive steps.
8. **A backup with no restore is a rumour.** The snapshot exists, is correct, and
   is unreachable from the product — and its horizon is three boots, which on the
   measured evidence is one evening.

## Prefer a type over a gate

Held against all seven qualifications. **The honest answer for this leaf is that
the strongest available "type" is not a Rust type at all — it is making the
replacement shape unspellable by hand — and that a real Rust type does exist for
the second-best fix, which is proving the swap.**

**Q1 — a required type carries only what it actually encodes.** The obvious
candidate is a newtype for the rebuild: `struct Rebuild { stored_ddl: String, … }`
constructible only from `sqlite_master`. It encodes "the new shape descends from
the old one" and nothing else — it does not prevent the missing backup, the
absent restore, the two-transaction step, the discarded `Result`, or the group_id
cycle. It prevents **exactly one** class, D2, and D2 is 7 of the 20 rebuilds.
Worth doing; not the headline.

**Q2 — requiredness is orthogonal to closedness.** `recreate_with_fk` already
*requires* a `new_create_sql: &str` from all nine callers and all nine hand-write
it. Requiredness bought nothing. What made it safe was **closing the column
list** — deriving it from `pragma_table_info` and re-adding anything the literal
omitted (`:232-259`). The doc comment says so directly: *"Every caller used to
hand-write a `columns_csv`, which meant the copy silently DROPPED any column a
later migration had added … Deriving the list from `pragma_table_info` closes all
nine at once."* **The repo has already run this experiment and won it.**

**Q3 — a type nobody constructs constrains nothing.** This is the qualification
that picks the design. The rebuild population is **20 sites**, and 9 of them
already go through one helper. A type at the *helper* boundary reaches 9; a type
that owns the *shape* reaches all 20, because every rebuild must obtain a
`CREATE TABLE` text from somewhere. So the constructor is the thing to close:

```rust
/// The replacement shape for a table rebuild. There is no constructor that
/// takes a `&str`: the only way to obtain one is to read the live table's own
/// DDL and substitute a single clause.
pub struct StagedShape { sql: String, source_columns: Vec<String>, staging: String }

impl StagedShape {
    /// Reads `sqlite_master`, applies exactly one substitution, and REFUSES if
    /// the pattern is absent or occurs more than once.
    pub fn from_live(conn: &Connection, table: &str, find: &str, replace: &str)
        -> Result<Self, AppError>;
    /// The copy statement. Always `SELECT *`, which is only sound because the
    /// staging shape descends from the source.
    pub fn copy_sql(&self) -> String;
    /// Asserts inside the caller's transaction that rows AND columns survived.
    pub fn verify(&self, tx: &Transaction) -> Result<(), AppError>;
}
```

**Q4 — a type anyone can construct authenticates nothing.** `StagedShape(pub String)`
is a comment. The field must be private and `from_live` the only constructor —
otherwise `StagedShape("CREATE TABLE x_new (…)".into())` reintroduces D2 with one
more character. The correct shape already exists in this repo:
`src/bench/db.rs:135` `pub struct BenchDbPool { conn: Mutex<Connection> }` —
private field, one accessor, one constructor. Copy it.

**Q5 — withholding beats requiring.** Do not add a `columns: &[&str]` parameter
and require callers to get it right; **withhold the ability to state a shape at
all**. `from_live(conn, table, find, replace)` gives the author no place to type
a column list. This is the same move `recreate_with_fk` made for the column list
and did not make for the CREATE text.

**Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is
*authoring a table definition that is supposed to equal one that already exists*.
The answer — which clause changes — stays fully available as `(find, replace)`.
Withholding the wrong half (say, the table name) would just break the feature.

**Q7 — withholding a requirement only helps when the requirement was forcing the
bad value.** Directly applicable, and it rules out the alternative a reader would
expect. Relaxing `new_create_sql: &str` to `Option<&str>` is inert: callers
supply the literal **voluntarily**, and the nine that do are correct only because
a *different* mechanism reconciles behind them. **Withhold the construction, not
the requirement.**

**Does the type reach the code?** For D2 and D6, **yes** — the SQL is a Rust
expression the compiler sees and `ddl_step` takes a `&str` that `StagedShape`
can produce. For the headline defect, **no, and the boundary is worth naming**:
D1 is a relationship between two steps 300 lines apart, each individually
well-formed. No type on either one can see the other. The only thing that can is
a **ledger** — a record of what ran, which is a *value in the database*, not a
type in the program. That is why §9's gate is a ratchet on one repairable shape
and the real fix for D1 is item (1) below.

**Recommended, in order:** (1) add a migration ledger, bootstrapped from shape
the way `personas-cloud` and `vibeman` each independently did, so `run_step`'s
`id` becomes the thing it already looks like; (2) `StagedShape` with a private
field and `from_live` as its only constructor, migrating the 7 hand-written
rebuilds; (3) `verify()` asserting columns as well as rows, called by all 20;
(4) move `add_file_layer` above `init_db` so any of this is observable; (5) keep
§9's ratchet until (2) lands, then delete it.

## 9 The missing gate

**The condition, stated stack-free:** *a destructive schema migration states the
replacement structure independently of the structure it is replacing, so
anything the live structure gained since the migration was authored is silently
discarded by an operation that reports success.*

An adopting repo must re-derive its own proxy. This one keys on SQLite's
create-copy-drop-rename spelled inside a Rust string literal. A repo on Prisma
or sqlx expresses the identical condition as a `migration.sql` that `CREATE TABLE
… ; INSERT … SELECT <named columns> …; DROP TABLE …; ALTER TABLE … RENAME`, and
this pattern scores a structural zero there while the condition is present at
scale — `vibeman` has **15** such rebuilds across 86 TypeScript migration files
and none of them would match a Rust-literal signal.

### Existing rules checked first, by reading each definition

I read all **93** rules in `scripts/census/rules.json` and `lib/engine.mjs`
before authoring, and checked these by name:

- **`hand-rolled-fixture-ddl`** (`rust-test-fixtures.md`, 37 files / 93 matches)
  — the nearest neighbour and the one real overlap risk. **It cannot collide by
  construction:** its `exclude` list names all six schema-owning files
  (`initial.rs`, `schema.rs`, `incremental.rs`, `mod.rs`, `fk_hygiene.rs`,
  `db/src/lib.rs`), which is exactly and only where this rule matches. The two
  are complements over the same token: that rule owns every `CREATE TABLE`
  *outside* the migration chain, this one owns a specific shape *inside* it.
- **`constraintless-table-declaration`** (`rust-test-fixtures.md`, 6/15) — keys
  on a `CREATE TABLE` whose column list reaches its closing paren with no
  `NOT NULL`; every one of my 7 matches carries several. No overlap, and it
  excludes `schema_vocabulary.rs`, the one file my pattern's earlier draft
  false-positived on.
- **`unatomic-sequence-rewrite`** (`drag-reorder.md`, 1/3) — structurally the
  closest template (N statements where one transaction belongs), but its verb is
  `UPDATE … SET <ordering column>` inside a `for` loop. No overlap. I considered
  reusing its shape for "a migration step issuing N `ddl_step`s" and that became
  the second rule below.
- **`retention-delete-by-status-allowlist`** (`retention-and-pruning.md`, 3/3) —
  requires a `DELETE` with a time cutoff. No `DELETE` in my population.
- **`blind-identity-write`** (`repository-crud-surface.md`, 35/82,
  `roots: ["src-tauri/db/src/repos"]`) — a different root entirely; the
  migration chain is not under `repos/`.
- **`undeclared-parent-fate`** (1/3), **`nullable-default-column`** (4/27),
  **`optional-store-handle`** (5/17), **`deferred-read-then-write`** (10/12),
  **`silent-row-skip`**, **`unverifiable-conflict-clause`** — checked, none keys
  on a rebuild, a drop, a rename, or a migration guard.

**Zero of the 93 rules mention** `DROP TABLE`, `DROP COLUMN`, `RENAME TO`,
`already_applied`, `ddl_step`, `run_step`, `migration`, `backup` or
`user_version`. **`boot-migration-step.md` — the sibling that owns this file —
has no census rule at all**; its §9 proposes a bespoke
`scripts/check-migration-steps.mjs` and a `Connection::authorizer` boot-work
budget, neither of which was built. The territory is open.

### The rule

Precision **7/7 — every match opened and read**, and it partitions the entire
rebuild population.

| | matches | files |
| --- | ---: | ---: |
| **violating** — staging shape written out in source | **7** | 1 |
| **compliant (control)** — staging shape derived from the live table's stored DDL | **4** | 1 |
| compliant, third form — hand-written shape whose *copy* is reconciled from `pragma_table_info` (`recreate_with_fk`, 9 callers) | not matched by either pattern, by design | 1 |

7 + 4 accounts for all **11** in-file rebuilds exactly; the twelfth site is the
generic helper, which is compliant for a reason neither regex can express and is
named in the description instead.

```json
{
  "rules": [
    {
      "id": "handwritten-rebuild-shape",
      "goldenPath": "docs/concepts/golden-paths/destructive-schema-change.md",
      "title": "A create-copy-drop-rename whose replacement shape is written out in source instead of derived from the table it replaces — so any column the live table gained since is silently discarded by an operation that reports success",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?[\"'`]?[A-Za-z_][A-Za-z0-9_]*_(?:new|tmp|temp|staging|v\\d)[\"'`]?\\s*\\((?:[^\"\\\\]|\\\\[\\s\\S])*?\\bRENAME\\s+TO\\b",
        "flags": "gi",
        "ignoreCommentLines": true,
        "description": "a SQL string literal that BOTH declares a staging table's full column list AND goes on to rename it over the original — i.e. the replacement shape for a table rebuild was authored in Rust source rather than read back from the table being replaced. PROXY FOR the stack-free condition: a destructive schema migration states the replacement structure independently of the structure it is replacing, so anything the live structure gained since the migration was authored is silently discarded by an operation that reports success. SQLite cannot ALTER a CHECK, a foreign key, a NOT NULL or a primary key in place, so every one of those changes becomes create-copy-drop-rename; the copy is the whole risk. EXECUTED, not argued (node:sqlite, 2026-08-15, statements transcribed verbatim from incremental.rs and replayed against a scratch COPY of the operator's live 331 MB personas.db): the persona_triggers rebuild at :1088 copies an explicit 10-column list into a hand-written shape; the live table has 13 columns; the replay preserved all 351 rows and DESTROYED status, trigger_version and unattended_mode - 351 non-null values each - with no error. The row count was identical before and after, which is why the one integrity check any rebuild in this file performs (repoint_mcp_gateway_members_fk :262-273, a row-count assertion) cannot see this failure at all. And `INSERT INTO staging SELECT *` into a hand-written shape is worse, not better: executed, a ninth column raises 'table chat_messages_new has 8 columns but 9 values were supplied' (loud, survivable) while the SAME column count in a different ORDER copies successfully and silently transposes every value (execution_id came back holding the metadata JSON). SELECT * is sound ONLY when the staging shape descends from the source's own DDL. MEASURED 2026-08-15 at e611c326d: 7 matches in 1 file, ALL SEVEN OPENED AND CONFIRMED (precision 7/7), commentMatchesSkipped 0 - incremental.rs:395 n8n_transform_sessions, :469 and :1071 persona_triggers (twice), :2279 chat_messages, :3741 credential_rotation_policies, :6029 dev_kpi_measurements, :6935 workspace_practice_adoption (7,099 live rows). POPULATION AND PARTITION: a whole-tree Rust lexer (string/comment aware, 83,764 literals, #[cfg(test)] removed as BRACE-MATCHED RANGES) finds 20 table rebuilds - 11 written inline in incremental.rs plus one generic helper in fk_hygiene.rs serving 9 tables. Of the 11 inline, 7 hand-write the shape (this rule) and 4 derive it from `SELECT sql FROM sqlite_master` + a single `replacen` (the positive control). 7 + 4 = 11 exactly, no third population inline. THE TWELFTH SITE IS COMPLIANT FOR A REASON NEITHER PATTERN CAN EXPRESS and is deliberately not matched: fk_hygiene::recreate_with_fk (:163) also takes a hand-written `new_create_sql` from each of its 9 callers, but derives the COPY's column list from pragma_table_info and re-declares onto the staging table any column the literal never heard of (:232-259) - its own doc comment at :140-150 records that hand-written column lists 'silently DROPPED any column a later migration had added' and that deriving 'closes all nine at once'. That is the repo running this experiment and winning it, which is why the golden path's fix is to derive the shape rather than to ban the literal. WHY THE 7 ARE NOT LIVE BUGS TODAY, STATED PLAINLY: the chain runs in file order, so a column added by a later step has not been added yet when the rebuild fires. That is a property of statement ordering inside a 9,430-line function, not of the code - inserting any new step above one of these rebuilds, or a legacy database whose shape probe fires late, loses the omitted columns immediately. The class is real and the live instance count is zero; I looked for it specifically. PRECISION ANCHOR: requiring the staging table name to carry a _new/_tmp/_temp/_staging/_vN suffix is what removes the tree's one true false positive, src/commands/infrastructure/schema_vocabulary.rs:225, a #[cfg(test)] fixture string containing `create table \"doc_status\" ... ALTER TABLE old_name RENAME TO new_name` - the census engine cannot express a brace-matched #[cfg(test)] exclusion, so the anchor was chosen to avoid needing one, and NO exclude entry is required. Requiring the CREATE and the RENAME to sit inside ONE string literal (the fill `(?:[^\"\\\\]|\\\\[\\s\\S])*?` cannot cross a quote) is what separates the hand-written form from the derived form, where the CREATE arrives from sqlite_master at runtime and only the DROP/RENAME are literals. DOES NOT OVERLAP `hand-rolled-fixture-ddl` (rust-test-fixtures.md, 37/93): that rule EXCLUDES all six schema-owning files by path - initial.rs, schema.rs, incremental.rs, mod.rs, fk_hygiene.rs and db/src/lib.rs - which is exactly and only where this rule matches. The two are complements over the same CREATE TABLE token: that one owns every table declaration outside the migration chain, this one owns one shape inside it. Nor `constraintless-table-declaration` (every match here carries several NOT NULLs), nor `unatomic-sequence-rewrite` (a for-loop over UPDATEs), nor `retention-delete-by-status-allowlist` (requires a DELETE with a time cutoff), nor `blind-identity-write` (rooted at src-tauri/db/src/repos). Zero of the 93 existing rules mention DROP TABLE, DROP COLUMN, RENAME TO, already_applied, ddl_step, run_step, backup or user_version. LEGAL FIX, in order: (1) read the table's own DDL - `SELECT sql FROM sqlite_master WHERE type='table' AND name=?` - apply ONE replacen for the clause you are changing, and BAIL if the substitution changed nothing or if the token was not unique (incremental.rs:130-134 and :8244-8252 are the two spellings shipped here); (2) or route the rebuild through fk_hygiene::recreate_with_fk with narrow_to_columns_csv: None, which reconciles the column list for you; (3) assert the COLUMN SET inside the transaction before committing, not only the row count. Do NOT 'fix' a match by splitting the CREATE and the RENAME into two adjacent string literals - that defeats this signal and preserves the defect exactly; the honest fix always removes the hand-authored column list. END OF LIFE: this rule is designed to reach zero. When it does the runner fails structurally on zero-matches, BY DESIGN - DELETE the rule then, do not baseline it at 0. CONVERGENCE: no sibling repo (personas-web, brainiac, personas-cloud, vibeman, ascent) gates this. vibeman carries 15 create-copy-drop-rename migrations across 86 TypeScript migration files with hand-written shapes throughout, zero backups of any of its four SQLite stores, and a rollback endpoint that infers which tables to DROP from a 20-entry keyword map of the migration's NAME (api/migrations/route.ts:33-88) - the same condition, one stack over, with none of the protection.",
        "$measured": "2026-08-15 @ e611c326d — 963 .rs files walked; two independent implementations (a standalone string/comment-aware Rust lexer and the census engine) returned 7/7 identically; the rule was validated in a composer-private scratch registry, then re-extracted from this document and re-run with the same result."
      },
      "baseline": { "files": 1, "matches": 7 },
      "floor": 900
    }
  ]
}
```

### The positive control (evidence, NOT a gate — carries no baseline)

```json
{
  "id": "handwritten-rebuild-shape-positive-control",
  "goldenPath": "docs/concepts/golden-paths/destructive-schema-change.md",
  "title": "POSITIVE CONTROL — not a gate. The compliant form: a rebuild whose replacement shape is derived from the live table's own stored DDL.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "SELECT\\s+sql\\s+FROM\\s+sqlite_master\\s+WHERE\\s+type\\s*=\\s*'table'(?:(?!\\bfn\\s)[\\s\\S]){0,3000}?\\.replacen\\s*\\(",
    "flags": "gi",
    "ignoreCommentLines": true,
    "description": "NOT A GATE - the shape-discrimination control for handwritten-rebuild-shape. It keys on the COMPLIANT construction of the same operation: read the table's own CREATE statement out of sqlite_master, then apply a bounded number of single substitutions to it, so the replacement shape descends from the shape being replaced and `SELECT *` is sound. The `(?!\\bfn\\s)` temper bounds the window to the enclosing function so a read in one helper cannot pair with a substitution in the next. MEASURED 2026-08-15 at e611c326d: 4 matches in 1 file versus the rule's 7 in 1 file - incremental.rs:108 (rebuild_executions_table_with_incomplete_status, widening the status CHECK), :201 (repoint_mcp_gateway_members_fk, repointing a foreign key), :8237 (widen_kpi_measurement_source_with_ai_compose), :8393 (dev_goals status CHECK). PARTITION: 7 + 4 = 11, which is EXACTLY the number of create-copy-drop-rename sites written inline in incremental.rs, so there is no third inline population - every inline rebuild is classified. Overlap by match: 0. The twentieth rebuild site, fk_hygiene::recreate_with_fk (:163) serving 9 tables, is compliant by a THIRD mechanism this pattern deliberately does not express - it takes a hand-written CREATE from each caller but derives the copy's column list from pragma_table_info and re-adds any column the literal omitted - and is named here so the partition is honest rather than tidy. This control's purpose is to demonstrate that the gate keys on WHERE THE SHAPE CAME FROM and not on the tokens CREATE TABLE, DROP TABLE or RENAME TO, all of which the compliant population also carries. If this control's count ever collapses toward zero the shared subject has moved and BOTH numbers are meaningless - that is the failure it exists to make visible. It is expected to RISE as the seven are migrated, which is precisely why it must never be baselined; scripts/census/lib/engine.mjs exempts a `-positive-control` id from the baseline requirement and merge-published-rules.mjs skips it by construction.",
    "$measured": "2026-08-15 @ e611c326d — validated standalone in registry-destructive-schema-change-composer.json, then re-extracted from this document and re-run; 4/4 both times."
  },
  "floor": 900
}
```

### A second, validated rule — handed to `boot-migration-step.md`

While measuring D3 I built and validated a second gate. **It is not published
here** because its condition is guard design, which is
[boot-migration-step](./boot-migration-step.md)'s territory and whose §9 has no
census rule; the orchestrator should merge it there. Full numbers so it does not
have to be re-derived:

> **`unresumable-migration-step`** — *a boot migration step whose has-this-run?
> probe observes ONE object while its body commits two or more independent DDL
> transactions, so a failure between them is recorded as completion.*
>
> ```
> pattern: already_applied:\s*\|conn\|\s*has_(?:column|table|index)\s*\([^()\n]*\)\s*,(?:(?!already_applied:|Ok\(\(\)\)|if\s+!has_)[\s\S])*?\bddl_step\s*\((?:(?!already_applied:|Ok\(\(\)\)|if\s+!has_)[\s\S])*?\bddl_step\s*\(
> flags: "g"   roots: ["src-tauri"]   extensions: [".rs"]   floor: 900
> baseline: { files: 1, matches: 15 }
> control (same head, EXACTLY one ddl_step before the closing Ok(())): 88 matches
> anchor (every one-line single-probe guard): 105.  15 + 88 = 103; the 2
> residuals are named: :3264 personas_home_team_id (two transactions but the
> guard names the LAST object created and the first is re-checked — genuinely
> resume-safe, and the reason the `if\s+!has_` temper is load-bearing) and
> :7371 genome_results_fitness_source (one transaction, returned as the
> closure's tail expression rather than followed by Ok(())).
> ```
>
> **Precision 15/15 — every match opened, and in every one the guarded object is
> the FIRST of the objects created.** 27 objects (2 tables, 10 columns, 15
> indexes) sit behind a guard that does not name them:
> `dev_kpis.context_id` `:6086`, `dev_kpis.factory_calibration` `:6105` (5 tx),
> `dev_kpis.skip_memory` `:6121`, `dev_goal_items.verify_kind` `:6246`,
> `dev_use_cases` `:6561` (4 tx, second table `dev_use_case_contexts`),
> `dev_kpis.use_case_id` `:6615`, `personas.lifecycle` `:6686`,
> `workspace_knowledge.categorization_axes` `:6859` (5 tx),
> `dev_milestones` `:6971` (4 tx, second table `dev_milestone_items`),
> `credential_consumer_edges` `:7234`, `autopilot_night_runs` `:7276`,
> `evolution_promotion_proposals` `:7391`, `automation_suggestions` `:7435`,
> `lab_ab_experiments` `:7483`, `policy_proposals` `:7530`.
> Validated through the real runner: **15 / 88, 963 walked, floor 900.**
> Live instance count zero — all 27 objects are present on the operator's
> database.

### Gates I measured and refused, with numbers

| candidate | violating | compliant | why refused |
| --- | ---: | ---: | --- |
| **a destructive statement whose `Result` is discarded** (`let _ = ddl_step(…DROP…)`) | 16 | 27 | `let _ = ddl_step` is **43 occurrences tree-wide** and is *correct* for the additive `ADD COLUMN` case, where "duplicate column name" is the success path. Separating the 16 destructive ones needs the verb inside the literal, and 12 of them are `let _ = ddl_step(conn, sql)` where `sql` is a **loop variable** — invisible to any matcher. Carried as D5. |
| **`already_applied: \|_conn\| Ok(false)`** | 2 | 122 | Already specified, with an allowlist and a `postcondition_todo` field, by [boot-migration-step](./boot-migration-step.md) §9. Duplicating it here would be a second opinion on one line. |
| **a migration step with no schema-version bump** | n/a | n/a | The census counts occurrences of a shape; it **cannot assert the absence** of a whole mechanism. "There is no ledger" has no signal. Carried as Gap 1 — and it is the largest finding in this document. |
| **an unreplayed index/trigger after `DROP TABLE`** | 0 | 20 | All 20 rebuilds replay them today. A gate that fires on nothing fails the runner structurally, and its positive control would be the entire population. Prescribed in §2(c) and §4.4, enforced by review. |
| **a rebuild with no row-count assertion** | 10 | 1 | Fires on 91% of the population with almost no compliant form to point at — a to-do list, not a ratchet. And per D6 the row count is **the wrong invariant**; gating it would ratchet the codebase toward a check that cannot see the defect. Carried as D6, and folded into `StagedShape::verify` instead. |

**The most important line in this section, stated plainly:** every one of this
document's largest findings — no ledger, no schema version, no downgrade guard,
no restore path, no column-set assertion, a log layer installed after the work it
would record — is an **absence**, and the census can ratchet a condition that is
present while saying nothing at all about one that is not. They were findable
only by running the software, which is how they were found.

### Verification of this gate's own preconditions

- `floor: 900` against **963** files actually walked, matching every other
  `src-tauri`-rooted rule so one root does not carry several opinions about what
  "the Rust tree is intact" means. A typo'd root walks 0 files and trips both
  `floor` and the zero-match structural failure.
- **No `exclude` entries.** The single false positive (`schema_vocabulary.rs:225`,
  a `#[cfg(test)]` fixture) is removed by the *pattern* — the `_new`/`_tmp`
  staging-suffix anchor — not by a path, so no stale exemption can accumulate.
- **Backtracking checked, not assumed.** Both patterns run in **< 100 ms** over
  the 9,430-line `incremental.rs` and the full 963-file walk completes in
  **0.9 s**. The nested-quantifier shape `(?:\s|//[^\n]*)*` that hung a previous
  composer's walk past 120 s is absent: the gate's fill is a single tempered
  alternation over a quote-bounded region, and the control's is bounded by
  `{0,3000}`.
- **The rule must reach zero and then be DELETED**, not baselined at 0 — the
  census cannot express "must be zero", and a rule pinned at 0 is a gate that can
  never fail.
- **Validated standalone first**, in a composer-private registry
  (`registry-destructive-schema-change-composer.json` — a filename unique to this
  composer because siblings share the scratchpad directory and have overwritten
  each other's files), through the real runner
  (`node scripts/census/run-census.mjs --rules <scratch>/…`), not a
  re-implementation. Then **re-extracted from this finished document, re-parsed
  and re-run**: `handwritten-rebuild-shape` **1 file / 7 matches / 963 walked /
  floor 900**, `handwritten-rebuild-shape-positive-control` **1 file / 4
  matches**, identical both times.
- Do **not** run `npm run census -- --update` against a registry containing the
  positive control; `updateBaselines` dereferences `baseline.files`
  unconditionally.

## 12 Corrections to the brief

The brief is the orchestrator's hypothesis. Six of its claims did not survive
measurement, and two of the corrections changed what this document says.

1. **"`already_applied` is the idempotency guard. What does it check — a table's
   existence, a column's existence, a migrations ledger?"** — **there is no
   ledger, anywhere, and the question is the finding.** `PRAGMA user_version`,
   `schema_migrations` and `applied_migrations` each appear **0 times** in 963
   files. The guard is always live schema shape: 61 `has_column`, 56 `has_table`,
   3 custom `sqlite_master` probes, 2 `has_index`, 2 `Ok(false)` — 124 exactly.
   `IncrementalMigration.id` reads
   like a ledger key and is dereferenced once, in a log line — and a production
   comment at `:3442-3444` explicitly relies on *"`run_step`'s id-tracking"*,
   which does not exist. The existing `hand-rolled-fixture-ddl` census rule's
   exclude reason likewise cites `mod.rs`'s *"own applied-migrations ledger
   table"*. Two independent places in the repo believe in a ledger that was never
   built.

2. **"Is each one in a transaction? … a non-transactional loop leaves duplicate
   `order_index` values."** — **every one of the 124 steps and all 20 rebuilds
   are transactional**, and the analogy does not transfer. The primitive
   (`ddl_step`, `:33`) is correct and universally used; executed, it survives an
   error at every stage *and* a `SIGKILL`, with zero residue. **The real hazard
   is one level up**: a *step* that opens **two** transactions, which 20 steps do
   and 17 of them do unsafely. The brief's framing would have had me audit
   transaction usage, which is clean, instead of transaction *granularity*, which
   is not.

3. **"`MAX_BACKUPS=3`, firing every boot, so three same-day copies of a 331 MB
   file evict any older one."** — **confirmed exactly**: 994 MB in three sets,
   timestamped 18:58, 19:36 and 19:48 UTC today. Two additions. The copy is
   cheap (measured 308–404 ms for 331 MB), so the cost is disk, not boot time.
   And the sharper defect is not the horizon but that **no restore path exists in
   the product at all** — `backups` has zero references in the frontend and zero
   in the rest of `src-tauri/`.

4. **"Are there migrations that reference tables or columns that no longer
   exist… a parallel graveyard in the schema: columns nothing reads, tables
   nothing writes?"** — **measured, and the answer is no, which is a positive
   result worth recording.** 4 dead tables (0 rows each) and 9 dead columns
   against 241 tables; **zero** foreign keys point at a missing table. Against
   the brief's 19 orphan ts-rs bindings the schema's orphan rate is two orders of
   magnitude lower. There is exactly one interesting case —
   `persona_design_patterns.source_review_ids`, named nowhere in the repository
   including the migration that created it.

5. **"`src-tauri/db/src/migrations/incremental.rs` is the main artery (it is
   ~9,400 lines)"** — 9,430 lines, and the framing understates the split.
   **`run_incremental` is only 4,663 of them (lines 280-4943) and holds 72 of the
   124 steps; `ensure_composite_fires_table` holds the other 52 across lines
   4946-7630 and runs in an EARLIER phase** (`initial.rs:286` calls it before
   `run_incremental`). Twelve `DROP COLUMN` statements and one of the two
   `Ok(false)` steps live on the far side of that boundary. Treating the file as
   one artery hides a phase ordering that
   [schema-change](./schema-change.md) already warns about 16 times.

6. **The brief's implicit premise that this territory is weak.** It is not,
   uniformly. `fk_hygiene::recreate_with_fk` is the best rebuild in the six-repo
   sample; the migration test suite (21 tests, including a populated-DB alter, a
   3× replay, a deliberate mid-chain failure, and two data-preservation tests) is
   **the strongest of the six repos and the only one that runs a destructive
   migration against rows**; the pre-migration backup exists in **exactly one of
   six repos** and this is it. The defects are concentrated somewhere the brief
   did not point: **the chain's steps do not know about each other**, and every
   instrument the repo owns — the guard, the idempotency test, the log line —
   observes one step in isolation.

**One methodological note, paid for in a killed process.** A first draft of the
§9 pattern tempered only on `already_applied:` and returned 17 matches; three of
them (`:4480`, `:5884`, `:7076`) were single-transaction steps whose "second"
`ddl_step` was a free-standing statement *between* two `run_step` calls. The
temper bounded the match to the next step but not to the end of the current one.
Adding `Ok(\(\)\)` — the terminator every `apply` closure actually has — took it
to 15/15. **A tempered fill is only as good as the terminator you can name**, and
the one that reads naturally (the next occurrence of the head) is usually not the
one that ends the construct.
