# Golden path — Boot migration step

> Situation node: `data-persistence/migrations/boot-migration-step` · [situation spine](../situation-spine.md)
> Composed 2026-08-13 from a ground-truth sweep of the boot path (~45 tool calls,
> 14 files read in full or in part, 6 counting scripts, 3 empirical SQLite probes),
> against `master` @ `2a874e692`. `.claude/worktrees/**` excluded from all counts.
> Every number below was counted or measured, not estimated.
>
> Sibling leaf **[Schema change](./schema-change.md)** owns *designing and landing*
> a migration — where the DDL goes, the registries it must join, the model → repo →
> command → UI chain, the codegen. **This path owns the other half: what happens
> when that step runs, on every launch, on a database that already exists.** Guard
> design, failure posture, phase ordering, the pre-migration backup, and what
> "already applied" is actually allowed to mean. Read the sibling for *where to put
> the step*; read this one for *how the step must behave the 400th time it runs*.
> The **Deviations** section is a fix backlog.

## Trigger

- "Why is this migration running again on every launch?"
- "My `ALTER` already ran — how do I stop it re-running / how do I make it idempotent?"
- "Should this failure abort startup, or just log and keep going?"
- "The log says the migration applied but nothing was written."
- "The app takes longer to open than it used to." / "What does boot actually do?"
- "This column exists on a fresh install but not on mine" (or the reverse)

If you are about to type `already_applied:`, `let _ = ddl_step(`, `.ok()` on a
migration call, or to choose between `?` and `tracing::error!` inside an `apply`
closure — you are in this situation. Also if you are adding *any* statement to
`db/src/migrations/*.rs`, because there is no "run once" in this codebase: **every
statement you add executes on every launch of every install, forever, unless you
personally guard it.**

## The one way

**A boot migration step is a convergence operation, not a replay: write it as a
`run_step` whose `already_applied` probes the step's own observable postcondition,
so a fully-migrated database pays exactly one cheap probe and does no work.** There
is no ledger — no `schema_migrations` table, no `PRAGMA user_version`, zero
occurrences of either anywhere in `src-tauri/` — so `run_step`'s `id` is a log
field and nothing else, and **the guard is the only thing standing between your
step and 100% of its cost on 100% of launches.** Probe with `has_column` /
`has_table` / `has_index` when the postcondition is schema (the normal case); with
a `COUNT(*)` over the pre-migration row shape when it is data; never with
`|_conn| Ok(false)`. Put the whole change in one `ddl_step` so the batch is atomic,
and **propagate its `Result` with `?` — abort the boot — by default**: an unguarded
`let _ =` converts "this migration wrote nothing" into "success", and the repo layer
above will discover it as a runtime `no such column` weeks later. Downgrade to
log-and-continue only via the `report_failed_group_id_drop` shape
(`incremental.rs:65-74`): a named helper, a `tracing::error!` carrying the table and
the error, a written justification of why the residue is harmless, and — critically
— the *safe* branch taken for everything downstream of the failure. Put the step in
`run_incremental`, never in `ensure_composite_fires_table`, because that function
runs in an **earlier phase** than its position in the file suggests and 53 steps
already live there by accident. Finally, before you commit: cost the step against a
steady-state boot (a fully-migrated DB) and confirm the answer is "one probe" — the
chain currently re-prepares **436 SQL statements and runs 157 schema probes** on
every launch, and each of those was added by somebody who did not do this step.

## Mandated primitives

- **`db/src/migrations/incremental.rs:12-24`** — `run_step`. Calls `already_applied`; short-circuits or calls `apply`; logs `migration_id` + description on apply. **It records nothing and reads nothing back.** `migration.id` is consumed at exactly one place: the `tracing::info!` field at `:19`.
- **`…/incremental.rs:5-10`** — `struct IncrementalMigration { id, description, already_applied, apply }`.
- **`…/incremental.rs:33-38`** — `ddl_step(conn, sql)`. Opens `unchecked_transaction`, `execute_batch`, `commit`. **Atomic, not idempotent** — its own doc comment (`:31-32`) says so: "Idempotency stays the layer above". Verified empirically: a batch whose second statement fails leaves *neither* statement applied (SQLite DDL is transactional; the un-committed `Transaction` rolls back on drop).
- **`…/incremental.rs:40-47`** — `has_column(conn, table, col)`. Returns `Ok(false)` for a missing table (verified: `pragma_table_info('nonexistent')` yields zero rows, so `COUNT(*)` is 0, not an error). A typo'd guard therefore reads "not applied" and lets `apply` run and fail loudly — **provided you propagate**.
- **`…/incremental.rs:49-56`** — `has_table`. Matches `type IN ('table','view')` — verified: it returns true for a **view** of the same name.
- **`…/incremental.rs:76-83`** — `has_index`. `type = 'index'`.
- **`…/incremental.rs:65-74`** — `report_failed_group_id_drop`. **The only sanctioned log-and-continue shape in the chain.** Copy this signature (`fn report_x(context: &str, result: Result<(), AppError>)`) whenever a failure genuinely must not abort a launch.
- **`db/src/migrations/fk_hygiene.rs:172-182`** — the `pragma_foreign_key_list` count guard, `>= expected_fk_count`. **The reference guard for a non-column postcondition**, and the reference use of `>=` so a later FK addition does not re-trigger the rebuild.
- **`db/src/migrations/initial.rs:74-89`** — the `idx_lab_ratings_unique` existence guard. **The reference guard added purely for boot cost**: an index name used as a marker that a full-table dedupe pass already ran. Its comment names the defect it fixed — "previously it re-ran on every launch".
- **`db/src/backup.rs:48`** — `backup_before_migrations(app_data_dir, db_path)`. Called at `db/src/lib.rs:296`, before the pool opens the file. Returns `Option<PathBuf>`, never `Result`: **boot is never blocked by a failed backup.**
- **`db/src/lib.rs:1882`** — `init_test_db()`. Runs the real chain into a temp DB, propagating with `?`. Your boot test starts here, never from a hand-written fixture.
- **`db/src/migrations/incremental.rs:8412`** — `migration_chain_is_idempotent_on_rerun`. **The boot-safety test. Every new step must survive it**, and it replays three times specifically to catch a guard that survives exactly one replay.
- **`src/startup_timing.rs:73`** — `StartupTimer::checkpoint(name)`. The boot phase instrument; `db_init` is stamped at `src/lib.rs:658`. Report rendered into the boot log by `format_boot_log` (`startup_timing.rs:135`).

## Steps

1. **Pick the phase, and know there are three.** On every launch `db::init_db_with_journal` (`db/src/lib.rs:279`) runs, in order: `backup_before_migrations` (`:296`) → pool build → `migrations::run` (`:332`) → `migrations::run_incremental` (`:333`) → `ensure_executions_fts` → seeds → orphan sweep. `migrations::run` is `initial::run`, and **`initial::run` calls `ensure_composite_fires_table` at `initial.rs:286`** — which is defined at `incremental.rs:4794`, i.e. *below* `run_incremental` (`:163-4791`) in the same file. **Text order is the reverse of execution order.** Your step goes in `run_incremental`, immediately before its closing `Ok(())`. Anything you place after line 4794 runs one phase *earlier* than everything above it.

2. **Write the guard first, as this step's postcondition.** Not "has this id run" — that question is unanswerable here. Ask: *what would be observably true if this step had already succeeded?* Four legal answers, in preference order:

   | Postcondition | Probe | Use when |
   |---|---|---|
   | A column exists | `has_column(conn, "t", "c")` | `ALTER … ADD COLUMN` (the 89 existing call sites) |
   | A table/view exists | `has_table(conn, "t")` | `CREATE TABLE` / `CREATE VIRTUAL TABLE` (66 sites) |
   | An index exists | `has_index(conn, "idx_x")` | `CREATE INDEX`, or an index used as a *marker* that a data pass ran (`initial.rs:74-89`) |
   | A structural property holds | a `COUNT(*)` over `pragma_foreign_key_list` / `sqlite_master` / the row shape | rebuilds and data migrations (`fk_hygiene.rs:174-182`) |

   For a **data** migration with no schema footprint, the postcondition is a row count: `SELECT COUNT(*) FROM t WHERE <pre-migration shape>` → `Ok(count == 0)`. That is always derivable; "there is no clean boolean marker" is a design failure, not a fact. If the batch adds several columns, guard on **one** of them and keep them in a single `ddl_step` so all-or-none holds (the model comment is at `incremental.rs:3476-3480`).

3. **Choose the failure posture before you write `apply`.** Three tiers, and only two are legal:

   | Tier | Shape | When |
   |---|---|---|
   | **Abort** (default) | `ddl_step(conn, sql)?;` | Anything the repo layer will later query. A missing column is a runtime error on every read; failing at boot is strictly better than failing at 3pm on a user's query. |
   | **Named report** | `report_x(table, ddl_step(conn, sql));` → `tracing::error!` with table + error, then **take the safe downstream branch** | Only when the residue is provably inert (a dead column nothing reads) *and* you have written down why. `incremental.rs:65-74` + `:3446-3463` is the whole pattern, including the `return Ok(())` that prevents the next statement from running on a failed precondition. |
   | **Swallow** | `let _ = ddl_step(…)` / `.ok()` | Never. It exists to absorb "duplicate column name", which a guard makes impossible — so after step 2 the only thing it can absorb is a real failure. |

   Note the asymmetry that makes "abort" heavier here than in a server: aborting boot means **the app does not start**, and there is **no restore-from-backup surface anywhere in the product** (Deviations D). So an abort you cannot justify strands the user with a dead app and a `backups/` directory nobody told them about. That raises the bar for tier 1 — it does not lower it to tier 3.

4. **Put the DDL in one `ddl_step` and propagate.**
   ```rust
   run_step(conn, IncrementalMigration {
       id: "persona_executions.foo",
       description: "Human sentence — this is the boot-log line",
       already_applied: |conn| has_column(conn, "persona_executions", "foo"),
       apply: |conn| {
           ddl_step(conn, "ALTER TABLE persona_executions ADD COLUMN foo TEXT;")?;
           Ok(())
       },
   })?;
   ```
   A closure that needs branching (probe, then conditionally DDL) is fine — `apply` is `fn(&Connection) -> Result<(), AppError>`, so a named function works too (`apply: rebuild_executions_table_with_incomplete_status`, `:3007`).

5. **Cost the step against a steady-state boot.** Open the guard and ask what a *fully-migrated* database executes. The correct answer for a new step is **one probe**. Write the answer in the commit message. This is the discipline the chain lost: today a steady-state boot re-prepares **436 SQL statements** across **215 unguarded `ddl_step` calls**, plus **157 helper probes** (89 `has_column`, 66 `has_table`, 2 `has_index`) and ~90 hand-rolled `sqlite_master`/`pragma_table_info` queries, plus 9 `pragma_foreign_key_list` probes in `fk_hygiene::run`. None of that changes anything; all of it is parsed every launch, and it grows monotonically with every migration ever shipped.

6. **If `apply` writes rows, check whether the table is hooked.** Migrations run on a pooled connection, and `cdc::CdcCustomizer::on_acquire` (`db/src/cdc.rs:157-200`) has already registered both the CDC `update_hook` and the change-journal `preupdate_hook` on it. A write to any of the 9 `JOURNAL_TABLES` (`db/src/journal.rs:55-65`) or the 11 CDC-mapped tables (`cdc.rs:211-251`) fires per-row captures into bounded channels (512 / 2048) whose consumers are spawned **at `src/lib.rs:1332` and `:1345` — 676 lines after `init_db_with_journal` at `:656`.** During migrations nobody is draining. A large data migration therefore fills both channels and logs `"change journal: bounded channel full — … a permanent gap in the reversibility ledger"`. Twelve DML statements in the chain already target hooked tables. If yours does, say so in the step's comment.

7. **Test it as a replay, not as a fresh install.** Add your table/column to the allowlist in `fresh_schema_contains_latest_migration_artifacts` (`:8552`) — that proves it ran *at all* — and then confirm `migration_chain_is_idempotent_on_rerun` (`:8412`) still passes, which is what proves your guard holds. If the step is a rebuild, add the "did not re-fire" assertion in the shape of `:8455-8459` (exactly one `'incomplete'` in the stored DDL). If the step is data, assert the second replay is a no-op on the rows.

8. **Stop.** Do not bump a version counter (there is none). Do not write a ledger row (there is no table). Do not add a `backups/` interaction — `backup_before_migrations` already ran, unconditionally, before your step existed.

## Anti-patterns

- **`already_applied: |_conn| Ok(false)`.** Both existing instances (`:3317`, `:3408`) are justified by the comment at `:3314-3316`: *"rely on `run_step`'s id-tracking to run once."* **`run_step` has no id-tracking.** The failure mode is not theoretical: `retire_persona_groups` (`:3403`) therefore executes, on **every boot of every install including fresh ones**, three `DROP INDEX IF EXISTS` write transactions, three `has_column` probes, and one `DROP TABLE IF EXISTS` write transaction — four `BEGIN IMMEDIATE`/`COMMIT` pairs that take the write lock to accomplish nothing, forever.
- **Assuming a comment about the runner is true.** Two of them are not. The one above, and `mod.rs:45-50`, which says `ensure_composite_fires_table` is *"Called from both run() and the engine directly"* — a repo-wide grep finds **exactly one caller**, `initial.rs:286`. The function should be `pub(super)`.
- **Appending to the end of `incremental.rs`.** The file's tail is `ensure_composite_fires_table`, which runs in phase 1. **53 of the 124 `run_step` migrations (43%) are already in there** — including `personas.lifecycle`, `dev_kpis`, `dev_milestones`, `fleet_sessions`, `workspace_center_tables`, `incident_diagnoses`, `policy_proposals`. None of those are the "plugin tables" the function is documented to own. Fifteen warning comments in the file exist because of this. The concrete bill is at `:6536-6544`: `personas.lifecycle`'s backfill referenced `personas.trust_origin`, which `run_incremental` adds in phase 2, so on a fresh database it raised `no such column: trust_origin` and **bricked init on every fresh install and every `init_test_db()`** until it was guarded.
- **`let _ = ddl_step(…)` / `ddl_step(…).ok()`.** 41 and 13 instances in the migration body. Distribution matters: only 5 of the 41 are in `run_incremental`; 6 are in `ensure_composite_fires_table`; **30 are in the tail helper functions, 29 of them in `research_lab_align_columns`** — which is declared `fn research_lab_align_columns(conn: &Connection)` (`:7629`) with **no `Result` in its signature at all**, so its 26 statements *cannot* propagate even if a caller wanted them to. `drop_legacy_tool_calls_columns` (`:7495`, called at `:5607`) has the same shape. A function that cannot fail is a function whose failures you have decided not to learn about. All 13 `.ok()` sites (`:4966`–`:6121`) are in the phase-1 function.
- **Guarding with `has_table` when a view could collide.** `has_table` matches `type IN ('table','view')` (`:51`). A guard reading "the table exists" that a view satisfies will skip a `CREATE TABLE` forever.
- **Hand-rolling the probe.** ~90 schema probes in this file are raw `SELECT … FROM sqlite_master` / `pragma_table_info` SQL rather than the three helpers. Each is a place where the quoting, the `type` filter, or the missing-table behaviour can drift from the helpers' — and none of them is greppable as a guard.
- **Treating the backup as insurance.** `backup_before_migrations` returns `Option`, logs a warning on every failure path (`backup.rs:56`, `:90`, `:101`, `:107`) and **boot continues without a snapshot**. Fresh installs are skipped by design. So "we back up before migrating" is true only when the disk, the ACLs and the directory listing all cooperate, and nothing surfaces it to the user when they don't.
- **Adding a data migration without asking who is listening.** See step 6. `UPDATE personas SET …` at `:3350`, `:3445` and `:6555` all fire the CDC hook and the journal preupdate hook on a connection whose consumers do not exist yet.
- **Believing the fresh-schema test covers you.** `fresh_schema_contains_latest_migration_artifacts` (`:8552`) asserts a **hand-typed** list: 17 tables, 24 columns, 11 indexes. There are ~136 tables created in `incremental.rs`. It covers ~12%, and only what somebody remembered to type. Its own comment says "tail of `run_incremental`" while at least 8 of its 17 tables (`dev_kpis`, `dev_kpi_measurements`, `dev_kpi_bindings`, `dev_run_checkpoints`, `athena_wake_log`, `dev_goal_items`, `dev_use_cases`, `dev_milestones`) are created in phase 1.

## Evidence

**Adoption.** 124 `run_step` migrations, all ids distinct; 71 in `run_incremental`, 53 in `ensure_composite_fires_table`. 378 `ddl_step` call sites: 162 inside a `run_step` (305 SQL statements, skipped once guarded), **216 outside any `run_step`** (215 in the migration body carrying 436 SQL statements, 1 in tests). 157 helper probes. 1,286 SQL statements across the five migration files. `incremental.rs` is 9,061 lines; the non-test body is 8,300.

- **`db/src/migrations/fk_hygiene.rs:172-182` — copy this guard.** Nine tables share one rebuild helper, and idempotency is a single `SELECT COUNT(*) FROM pragma_foreign_key_list('<t>')` compared `>=` against the expected count. It is the postcondition, it is cheap, it is correct on fresh and legacy databases alike, and the `>=` makes it survive a future FK addition. This is what `already_applied` is supposed to look like when the postcondition is not a column.
- **`db/src/migrations/initial.rs:74-89`** — a guard whose *only* purpose is boot cost. The existence of `idx_lab_ratings_unique` stands in for "the dedupe pass already ran", turning a full-table `DELETE … WHERE rowid NOT IN (…)` scan into one `sqlite_master` lookup. The comment names the regression: "previously it re-ran on every launch".
- **`incremental.rs:65-74` + `:3444-3464` — the abort-vs-log reference.** `report_failed_group_id_drop` logs at `error!` with the table and the error; the call site at `:3446` goes further and `return Ok(())`s so the subsequent `DROP TABLE persona_groups` cannot run against a `personas` table that still carries the FK. The comment explains the exact user-visible breakage that would follow (`"no such table: persona_groups"` on every persona creation). **This is the shape to copy when a failure must not brick a launch**, and note how much justification it carries.
- **`incremental.rs:3476-3480`** — why a two-column `ALTER` batch is safe behind a one-column guard: "Both ALTERs run inside one `ddl_step` transaction, so the single-column `already_applied` guard is safe (both columns land or neither does)."
- **`incremental.rs:2090-2100`** — the model comment for choosing a guard over a swallow, written at the site that was converted.
- **`incremental.rs:104-159`** — `rebuild_executions_table_with_incomplete_status`: recreate from the table's own stored DDL, replay indexes/triggers from `sqlite_master`, rebuild FTS, and **bail with an error (`:130-134`) rather than build a table that silently keeps the old constraint.** The reference for "abort rather than converge to the wrong shape".
- **`incremental.rs:8412` — `migration_chain_is_idempotent_on_rerun`. The one test to keep green.** Its doc comment (`:8402-8411`) states the property better than any prose here: the boot path replays both phases on every launch, so a single non-idempotent step "bricks every existing install on its next launch, not just upgrades". It replays **three** times, then `PRAGMA integrity_check`, then asserts the executions rebuild did not re-fire.
- **`incremental.rs:8469` — `a_genuinely_failed_guarded_alter_is_no_longer_swallowed`.** Proves the abort posture by deleting a table so an `ALTER` cannot succeed, then asserting the chain **stops there** — using a marker table created by the very next step to pin *where* it stopped. Note the technique: assert the position of the failure, not just its existence.
- **`incremental.rs:8507` — `a_blocked_group_id_drop_no_longer_takes_persona_groups_with_it`.** The log-and-continue posture's test: rebuild the legacy shape (including a composite index the migration's hand-written `DROP INDEX` list has never heard of), assert the chain **does not** abort, and assert the safe branch was taken.
- **`db/src/lib.rs:1978` — `init_db_second_launch_reopens_and_preserves_data`.** The real `init_db`, twice, on one data dir; session-1 data must survive, a late-migration table must still exist, seeds must be re-upserted. The end-to-end boot regression test.
- **`db/src/lib.rs:2053`, `:2105`, `:2123`** — the backup's own tests: a second launch produces exactly one backup set, a fresh create produces none, and rotation keeps the newest three.
- **`src/startup_timing.rs:73` + `src/lib.rs:658`** — `db_init` is already a measured, named boot phase. The instrument for a boot budget exists; nothing consumes it (Gap 6).

## Deviations found

### A. Guard design — 7

| Path | Defect |
|---|---|
| `incremental.rs:3317` | `groups_to_teams_data_migration`: `already_applied: \|_conn\| Ok(false)`. Self-limits in practice — its `apply` opens with a `sqlite_master` count for `persona_groups` and early-returns (`:3324-3329`) — so on any install where Phase 5 succeeded it costs one query, not the 4-statement data migration. On a legacy DB where the drop was blocked, it **does** replay all four statements every boot. The hypothesis "replays its full data migration every boot" is true only in that branch. |
| `incremental.rs:3408` | `retire_persona_groups`: `already_applied: \|_conn\| Ok(false)` with **no early-out**. Every boot of every install, fresh ones included: 3 `DROP INDEX IF EXISTS` transactions + 3 `has_column` probes + 1 `DROP TABLE IF EXISTS` transaction. Four write-lock acquisitions to accomplish nothing, permanently. |
| `incremental.rs:3314-3316` | The comment that authorises both: *"rely on `run_step`'s id-tracking to run once."* No ledger, no `PRAGMA user_version`, no `schema_migrations` table exists — repo-wide, zero occurrences. |
| `incremental.rs` (215 sites) | 215 `ddl_step` calls in the migration body sit outside any `run_step` — no id, no description, no declared guard — carrying **436 SQL statements re-prepared on every boot**. 113 of them are loose in `run_incremental`, 68 in `ensure_composite_fires_table`, 29 in `research_lab_align_columns`. |
| `incremental.rs:51` | `has_table` matches `type IN ('table','view')`. Verified: returns true for a view. A guard named "has table" that a view satisfies. |
| `incremental.rs` (~90 sites) | ~90 schema probes written as raw `sqlite_master` / `pragma_table_info` SQL instead of the three helpers — ungreppable as guards, free to drift on quoting and missing-table behaviour. |
| `incremental.rs:8552-8634` | The only mechanical "did it run" coverage is a hand-typed allowlist: 17 tables of ~136 (~12%), 24 columns, 11 indexes. Its comment mislabels the phase for at least 8 of the 17. |

### B. Failure posture — 6

| Path | Defect |
|---|---|
| `incremental.rs` (41 sites) | `let _ = ddl_step(…)` in the migration body: 5 in `run_incremental`, 6 in `ensure_composite_fires_table`, 30 in the tail helpers. |
| `incremental.rs:4966`–`:6121` (13 sites) | `ddl_step(…).ok()` — all 13 inside `ensure_composite_fires_table`, the earliest phase, where a failure is quietest. |
| `incremental.rs:7629` (called `:5567`) | `fn research_lab_align_columns(conn: &Connection)` returns `()`. 29 `ddl_step` calls / 26 statements that **structurally cannot** propagate. The Project Memory Ledger schema and the Workspace Knowledge schema both live inside it. |
| `incremental.rs:7495` (called `:5607`) | `fn drop_legacy_tool_calls_columns(conn: &Connection)` — same `()`-returning shape. |
| `incremental.rs:3412-3414`, `:3465` | Inside the only sanctioned log-and-continue step, the three `DROP INDEX` calls and the final `DROP TABLE` are still `let _ =`. The dangerous ordering is handled (the `return Ok(())` at `:3462`); the three index drops are simply blind. |
| `db/src/lib.rs:539-546`, `:563-620` | `init_user_db`: **19 `ALTER … ADD COLUMN` statements, 100% swallowed** through two `for stmt in &[…] { let _ = conn.execute_batch(stmt); }` loops. No `run_step`, no guards, no ids, no boot log, no runner — the comment at `:532-534` states the exclusion outright. A forgotten or typo'd ALTER here surfaces only as a runtime `no such column`. |

### C. Phase ordering — 5

| Path | Defect |
|---|---|
| `incremental.rs:4794` | `ensure_composite_fires_table` hosts **53 of the 124 `run_step` migrations (43%)** and runs in phase 1, *before* `run_incremental`, despite sitting below it in the file. Its contents include `personas.lifecycle`, `dev_kpis*`, `dev_milestones*`, `fleet_sessions`, `workspace_*`, `incident_diagnoses`, `policy_proposals` — core product schema, not "plugin tables". |
| `mod.rs:45-50` | Doc claims it is "Called from both `run()` and the engine directly". Repo-wide grep: **one** caller, `initial.rs:286`. Should be `pub(super)`. |
| `incremental.rs:6536-6544` | The ORDERING FIX record: `personas.lifecycle`'s backfill referenced `trust_origin`, added in phase 2, and bricked init on every fresh install until guarded. The proof that the inversion costs real outages, not just confusion. |
| `incremental.rs` (15 comments) | Fifteen separate comments warn about the inversion (`:2528`, `:3294`, `:3939`, `:3985`, `:4021`, `:4080`, `:4126`, `:4346`, `:4414`, `:4480`, `:4531`, `:4732`, `:6127`, `:6537`, `:8323`) on top of the two function definitions. Fifteen warnings is a design defect with documentation stapled over it. |
| `incremental.rs:8557` | The fresh-schema test's own comment ("tail of `run_incremental`") is wrong for 8 of its 17 tables, so the test does not mean what a reader thinks it means. |

### D. Backup and recovery — 5

| Path | Defect |
|---|---|
| `backup.rs:15-20` | The every-boot full-file copy is justified by the absent version signal: *"There is no schema-version counter in this codebase … so there is no cheap 'will this boot actually change the schema?' signal."* One sequential `fs::copy` of the entire system database on every launch of an existing install. The missing signal is the root cause; the copy is the symptom. |
| `backup.rs:106-116` | The copy is never verified. Nothing opens the result and runs `PRAGMA integrity_check` or even `SELECT COUNT(*) FROM sqlite_master`. A copy that succeeded byte-wise but captured a torn WAL state is indistinguishable from a good one. |
| repo-wide | **No restore path exists.** Zero Tauri commands, zero UI, zero documentation reference the `backups/` directory outside `backup.rs` and its tests. The safety net is written to disk on every launch and cannot be used from inside the product — which is precisely the situation (app won't start) in which it is needed. |
| `db/src/lib.rs:492` | `init_user_db` gets **no backup at all**. `backup_before_migrations` is called once, for `personas.db` (`:296`). `personas_data.db` — the entire knowledge base and the whole Athena brain — is mutated on every launch with no snapshot and no runner. |
| `backup.rs:48-116` | Every failure path returns `None` after a `tracing::warn!` and boot proceeds. A user whose backups have been silently failing for a month has no signal until the day they need one. |

### E. Boot-time side effects — 2

| Path | Defect |
|---|---|
| `src/lib.rs:650-656` vs `:1332`, `:1345` | Migrations run on a connection carrying both the CDC `update_hook` and the journal `preupdate_hook` (`cdc.rs:157-200`), but `spawn_cdc_drain_task` and `spawn_journal_writer` are called **676 and 689 lines later**. Any migration write to a hooked table pushes into an undrained bounded channel (512 / 2048); overflow is logged as *"a permanent gap in the reversibility ledger"* (`journal.rs:92-96`). |
| 12 sites | Twelve DML statements in the chain target hooked tables: `incremental.rs:801` (`persona_event_subscriptions`), `:1000` (`persona_triggers`), `:2052`, `:2086`, `:3350`, `:3367`, `:3445`, `:6555` (`personas`/`persona_memories`); `fk_hygiene.rs:354`, `:570`, `:603`; `helpers.rs:249`. All are currently guarded or bounded, so none overflows today — but nothing marks them, and the next data migration will not know. |

### F. Performance and observability — 3

| Path | Defect |
|---|---|
| chain-wide | A steady-state boot re-prepares **436 SQL statements** and runs **157 helper probes + ~90 raw probes + 9 FK probes**, all to conclude that nothing needs doing. The number is monotonic in the number of migrations ever shipped; nothing decays out. |
| `src/startup_timing.rs` | The instrument exists (`db_init` checkpoint, `StartupTimingReport`, `format_boot_log`) and **nothing asserts a budget**. No threshold, no test, no CI job. |
| `src/lib.rs:522` + `src/lib/bindings/StartupTimingReport.ts` | `get_startup_timing` is a live Tauri command with a generated binding and **zero frontend call sites** — the report is reachable and unread. |

**28 deviations: 7 guard design · 6 failure posture · 5 ordering · 5 backup/recovery · 2 boot-time side effects · 3 performance/observability.**

### What is upstream of all of them

Two root causes account for the whole list, and they interact.

**(1) There is no notion of "a boot with nothing to do."** No ledger, no version counter, no fast path — a fully-migrated database still walks all 124 steps. So the *only* lever anyone has on boot behaviour is the individual guard, and each individual guard saves microseconds nobody can perceive. That is why guards rot silently, why 215 calls have none at all, and why the every-boot full-database copy in `backup.rs` was the reasonable local decision (its comment says so explicitly). Categories A, D and F are all this.

**(2) The phase inversion does not just cause ordering bugs — it causes swallowing.** Counting the swallows in the two main functions (excluding the tail helpers): **19 of 24 sit in `ensure_composite_fires_table`**, which holds 43% of the steps. All 13 `.ok()` calls are there; `run_incremental` has zero. That is not coincidence. An author who appends "to the end of the file" lands in a phase they did not choose, cannot reason about which tables exist yet, and hedges the uncertainty with `let _ =`. Fixing the ordering (fold the tail into `run_incremental`, make it `pub(super)`) removes the reason the hedge feels necessary — which is why the phase-placement rule in the gate below matters more than its 53-item allowlist suggests.

## Gaps in the primitive

1. **`run_step` records nothing.** `IncrementalMigration` has an `id` field and no table to write it to. Everything in category A is downstream of this: the false comment, both `Ok(false)` steps, and — via `backup.rs:15-20` — the every-boot full-database copy. A four-column `schema_migrations(id, applied_at, duration_ms, checksum)` written inside `run_step`'s existing control flow would close all of it for one `INSERT` per applied step. **But note what it would *not* close:** a ledger answers "did this id run", while a schema probe answers "is the world in the desired state". The probe is strictly stronger for DDL — it survives a restore-from-backup, a hand-edited database, and a half-applied batch. The right design is *both*: keep probes as the guard, add the ledger as the **version signal** the backup and the boot budget need.
2. **`run_step` gives no cheap "is anything to do at all?" answer.** Even with perfect guards, the chain must walk 124 steps and 157 probes to discover it has no work. A single monotonic counter (`PRAGMA user_version`, an O(1) header read — verified default `0`) bumped once per shipped migration would let `run_incremental` return in one read on the overwhelmingly common path, and would give `backup_before_migrations` its missing signal. Retrofitting it onto 124 existing steps is the real cost, and it is a one-time cost.
3. **`ddl_step` verifies nothing after it commits.** It is atomic and silent about outcome: it never checks that the statement affected the object it named. A `ddl_step_verified(conn, sql, &[Expect::Column("t","c")])` re-probing after commit would turn a whole class of "applied successfully, wrote nothing" into a loud failure.
4. **There is no log-and-continue primitive.** `report_failed_group_id_drop` is a one-off named for its single call site. A generic `tolerate(context: &str, why: &str, result: Result<(), AppError>)` that *requires* the justification string would make the tier-2 posture greppable, countable, and reviewable — and would make `let _ =` visibly the thing that has no justification attached.
5. **The user database has no migration primitive at all.** Not a gap in `run_step` — a gap in coverage. `run_incremental` takes a `&Connection`; nothing but wiring stands between it and `personas_data.db`. Until then, 19 unguarded swallowed ALTERs run against the Athena brain on every launch with no snapshot.
6. **Nothing turns the boot instrument into a gate.** `StartupTimer` measures `db_init`; `format_boot_log` prints it; no threshold exists. Worse, wall-clock time is a poor gate signal — it is machine- and disk-dependent, so a CI threshold would be flaky. The gateable quantity is **work**, not time (see below).
7. **The backup is a one-way door.** Snapshot without restore is not a recovery mechanism; it is a hope. The missing half is small: list `backups/*.db`, `PRAGMA integrity_check` the candidate, copy it over `personas.db` — but it must be reachable when the app cannot boot, which means a CLI subcommand or a pre-setup failure screen, not a settings page.
8. **No test asserts steady-state cost.** Every existing boot test asserts *correctness* under replay (`:8412` idempotency, `:8469` non-swallowing, `:8507` safe-branch, `lib.rs:1978` reopen). None asserts *cheapness* under replay, which is why 436 statements accumulated without a single test going red.

## The missing gate

Every deviation above shipped under a green `npm run check` and a green CI. The categories split cleanly by what can catch them, and only one of the two halves is novel.

### Half 1 — static: `scripts/check-migration-steps.mjs`

**Signal.** The dangerous shapes in this chain are all exact, greppable syntax in five known files, and each has a tiny true-positive set today:

| Rule | Pattern | Occurrences now | Allowlist |
|---|---|---|---|
| No always-run guard | `already_applied: \|_conn\| Ok(false)` | **2** | both, with a `reason` and a `postcondition_todo` field, forcing the author to name the row-count query that would replace it |
| Propagate DDL results | `let _ = ddl_step(` / `ddl_step(…).ok()` / `let _ = conn.execute_batch(` | 41 / 13 / 18 (13 `initial.rs` + 5 `db/src/lib.rs`, 0 `incremental.rs`) | ratcheted floor (see below) |
| Migration helpers must be fallible | `^fn <name>(conn: &Connection) {` in `migrations/*.rs` | **2** (`research_lab_align_columns`, `drop_legacy_tool_calls_columns`) | none — both are bugs |
| New `run_step`s land in phase 2 | a `run_step(` call site with line number > the `ensure_composite_fires_table` definition line | **53** | frozen at 53; any 54th fails |

**Mechanism.** A Node script modelled on `scripts/check-event-registry.mjs` (the repo's existing static two-source parity check), wired into `npm run check:contracts` — which already chains `check-command-contract.mjs && check-event-registry.mjs` — and therefore into the `frontend-checks` CI job, so it runs on every PR **without a cargo build**. Enforcement is a **ratchet**, not a ban: each rule carries a committed count in `scripts/migration-steps.baseline.json`, and the script fails if a count goes **up**. A count going *down* fails too, with a one-line "update the baseline to N" — so the baseline can never silently drift upward behind a stale file, and every reduction is recorded in a diff.

**Allowlist**, in `scripts/migration-steps.allow.json`, each entry requiring `reason` and, for the guard rule, `postcondition_todo`:
- `incremental.rs:3317` `groups_to_teams_data_migration` — reason: no schema footprint; postcondition_todo: `SELECT COUNT(*) FROM personas WHERE group_id IS NOT NULL AND home_team_id IS NULL`.
- `incremental.rs:3408` `retire_persona_groups` — reason: destructive multi-object drop retried until it succeeds; postcondition_todo: `NOT has_table("persona_groups") AND NOT has_column("personas","group_id")`.
- The 53 phase-1 `run_step`s — reason: historical placement, frozen; migration to phase 2 tracked as a separate refactor.

### Half 2 — behavioural: a steady-state boot-work budget

This is the one that matters, and the repo already has every piece of it.

**Signal.** *The number of mutating actions SQLite is asked to authorize during a replay of the chain on an already-migrated database.* On a correct chain that number is **zero** — every step's guard short-circuits and the only work is probes (`SELECT`/`PRAGMA` reads). Today it is ~436. This is a direct, machine-readable measurement of the exact property this golden path is about: what "already applied" means in practice. It is machine-independent (a count, not a duration), so unlike a wall-clock threshold it will not flake in CI.

**Mechanism.** `Connection::authorizer` — available today under the `hooks` feature already enabled in `db/Cargo.toml:45`, no new dependency and no new feature flag. `AuthAction` carries `CreateTable{table_name}`, `CreateIndex`, `AlterTable`, `Insert`, `Update`, `Delete`, `DropTable`, `DropIndex` with names attached. A Rust test in `personas-db`, appended next to `migration_chain_is_idempotent_on_rerun` (`incremental.rs:8412`) where the fully-migrated database already exists:

```rust
#[test]
fn a_steady_state_boot_does_no_work() {
    let pool = crate::init_test_db().unwrap();     // launch 1: fresh install
    let conn = pool.get().unwrap();
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = seen.clone();
    conn.authorizer(Some(move |ctx: AuthContext| {
        if let Some(desc) = mutating(&ctx.action) {  // None for reads/pragmas
            sink.lock().unwrap().push(desc);
        }
        Authorization::Allow
    })).unwrap();

    let changes_before = conn.total_changes();
    crate::migrations::run(&conn).unwrap();         // launch 2
    run_incremental(&conn).unwrap();
    conn.authorizer::<fn(AuthContext) -> Authorization>(None).unwrap();

    let acts = seen.lock().unwrap();
    assert!(!acts.is_empty(), "authorizer never fired — the probe is broken, not the chain");
    assert!(acts.len() <= BOOT_WORK_BUDGET, "…{} mutating actions, budget {BOOT_WORK_BUDGET}…", acts.len());
    assert_eq!(conn.total_changes(), changes_before, "a steady-state boot wrote rows");
}
```

Two numbers, deliberately: the authorizer count is *statements re-prepared* (parse cost — where the 436 live), and `total_changes()` is *rows actually written* (where the data-migration replays live). They fail differently and both are needed; `total_changes` is core rusqlite with no feature gate. `BOOT_WORK_BUDGET` starts at the measured current value and only ever moves down — a new step that adds to it fails the test with the step's own table name printed from `AuthAction`, which is the diagnostic the author needs.

**How each half fails loudly when its own precondition is absent.** This repo's CI is a museum of gates that ran green while checking nothing — commit-lint dying on a bad ref, `cargo test` aborting pre-compile, a secret scan exiting 0 without gitleaks. So:

- The static script **asserts its inputs before it asserts anything about the tree**: each of the five migration files must exist and yield a non-zero `run_step` count; if `incremental.rs` parses to zero `run_step`s the regex has rotted against a refactor → **exit 1**, never "0 problems found". The `ensure_composite_fires_table` definition line must be locatable — if the function is renamed or removed, the phase rule cannot be evaluated and the script **fails with the anchor name** rather than passing vacuously.
- Baseline counts fail in **both directions** (see above). A stale baseline is the standard way a ratchet turns into a no-op.
- Allowlist entries that match nothing → **exit 1**. Stale suppression is how allowlists become the bug.
- Success prints the audited totals — `Migration steps OK (124 steps, 71 phase-2 / 53 phase-1, 378 ddl_step, 54 swallowed [budget 54], 2 unguarded [allowlisted])` — so a human reading a green CI log can see it checked something, and a collapsing count is visible in the diff of a build log.
- The Rust half fails loudly by construction, and the `assert!(!acts.is_empty())` line is the load-bearing one: an authorizer that never fires would otherwise report a perfect score of zero. It asserts the *instrument* before it asserts the *result*.

### Half 0 — the census rule this section was missing

Added 2026-08-15, built and validated by the `destructive-schema-change`
composer, which measured it in this territory and handed it here rather than
publishing it under its own leaf. It is narrower than either half above and it
exists today, so it goes in first.

**The condition.** A boot migration step whose has-this-run? probe observes ONE
object while its body commits two or more independent DDL transactions — so a
failure between them is recorded as completion. 27 objects (2 tables, 10
columns, 15 indexes) currently sit behind a guard that does not name them; in
all 15 matches the guarded object is the *first* created, which is the worst
ordering.

Precision 15/15, every match opened. The control — same head, exactly one
`ddl_step` before the closing `Ok(())` — matches 88, and 15 + 88 = 103 against
an anchor of 105 one-line single-probe guards. The two residuals are named
rather than excluded: `:3264` guards on the LAST object created and re-checks
the first (genuinely resume-safe, and the reason the `if\s+!has_` temper is
load-bearing), and `:7371` returns the closure's tail expression rather than
following it with `Ok(())`.

Timed before adoption, per the doctrine's backtracking rule: the two tempered
dots are lazy and anchored on a rare head, so the whole 963-file walk is **95
ms**. Reproduced 15/1 independently.

```json
{
  "rules": [
    {
      "id": "unresumable-migration-step",
      "goldenPath": "docs/concepts/golden-paths/boot-migration-step.md",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "already_applied:\\s*\\|conn\\|\\s*has_(?:column|table|index)\\s*\\([^()\\n]*\\)\\s*,(?:(?!already_applied:|Ok\\(\\(\\)\\)|if\\s+!has_)[\\s\\S])*?\\bddl_step\\s*\\((?:(?!already_applied:|Ok\\(\\(\\)\\)|if\\s+!has_)[\\s\\S])*?\\bddl_step\\s*\\(",
        "flags": "g",
        "description": "A boot migration step whose already_applied probe observes ONE object while its body commits two or more independent DDL transactions. A crash between them leaves the later objects missing and the step recorded as applied, so it never runs again. Precision 15/15, every match hand-read; in all 15 the guarded object is the FIRST created. Control (same head, exactly one ddl_step before Ok(())) = 88; 15 + 88 = 103 of a 105 anchor, with the 2 residuals named in the golden path rather than excluded. Fix: guard on the LAST object created, or fold the body into a single ddl_step, or use the conjunction-guard shape at incremental.rs:4703."
      },
      "baseline": { "files": 1, "matches": 15 },
      "floor": 900
    }
  ]
}
```

**One precondition neither half controls, and it is fatal.** `ci.yml:258` runs `cargo test --manifest-path src-tauri/Cargo.toml --features desktop` with **no `--workspace`**, which selects only `personas-desktop`. **Every test named in this document — `migration_chain_is_idempotent_on_rerun`, `a_genuinely_failed_guarded_alter_is_no_longer_swallowed`, `a_blocked_group_id_drop_no_longer_takes_persona_groups_with_it`, `fresh_schema_contains_latest_migration_artifacts`, `init_db_second_launch_reopens_and_preserves_data`, and all three backup tests — lives in `personas-db` and does not run in CI.** The boot-work budget would be the ninth dark test in that crate. Adding `--workspace` to that one line is the highest-leverage change available here; without it, half 2 is a gate that runs nowhere, which is worse than no gate at all.
