# Golden path — The second database

> Situation node: `data-persistence/storage-topology/second-database` ·
> [situation spine](../situation-spine.md) · recurrence 28 ·
> dimensions: **function · resilience · security · code-quality · cost**
> Composed 2026-08-15 against `master` @ `5108ff978`.
>
> **Sweep size.** 963 `.rs` files (exactly `rust.files` in
> [`shared-facts.json`](../shared-facts.json)). The load-bearing counts were
> taken by **two independent implementations** and are reported only where the
> two agreed: a comment-stripping, brace-balancing signature parser and a
> whole-file regex census both returned **47** functions carrying both pool
> handles across **20** files; `sqlite3` and `better-sqlite3` both returned
> 241/67 tables and 172/10 foreign keys. Every `CREATE TABLE` in the tree was
> resolved against the **live table list of each database file** to decide which
> store it belongs to — statements, not lines, with `#[cfg(test)]` separated
> from production.
>
> **Measured against running software.** The operator's `personas.db` (347 MB)
> and `personas_data.db` (17 MB) were copied and opened read-only, `ATTACH`ed to
> one connection so cross-file joins could be executed, and the app's own
> `backups/` directory was inventoried on disk. **The headline defect in this
> document was found by executing a query, not by reading code, and no amount of
> reading would have found it** — it compiles, it type-checks, it passes
> `npm run check`, and it has been dead in production for 16 days.
>
> A **convergence sweep** ran against `brainiac` (Rust · sqlx · **one Postgres**),
> `personas-cloud` and `vibeman` (**four** SQLite files). It is reported honestly
> in §6, including the clause it refuses to support.
>
> **A correction to the brief, up front.** This leaf is framed around two
> databases. **Personas ships three**: `personas.db`, `personas_data.db`, and
> `bench.db` (`src/bench/db.rs`). The third is small, has no production call
> site — and is the **only** one of the three with a real newtype, a schema
> version, and a written cross-store reference policy. That inversion is this
> document's best evidence and it is in §6 and in "Prefer a type over a gate".
>
> ### Sibling boundaries, settled in prose
>
> [**Transaction boundary**](./transaction-boundary.md) owns *the transaction* —
> `Immediate` vs deferred, the 152 open sites, `SQLITE_BUSY`. Its Gap 1 already
> states that no transaction can span the two files and names
> `vector_kb.rs:48` as the case. **That path owns what a transaction is and how
> to open one; this path owns what to do when the operation needs two stores and
> therefore cannot have one** — the write order, the compensating action, and
> the repair pass. It is the consumer of the ordering discipline defined here.
>
> [**Schema change**](./schema-change.md) owns *where DDL goes*. Its Step 1
> already says "decide which database" and its Gap 3 says the user database has
> no migration runner. **That path owns landing the statement in the right
> chain; this path owns the question upstream of it — which store the data
> belongs to, and what happens when the DDL lands in one store and the readers
> are wired to the other.** §7 P0 is that failure, live.
>
> [**Foreign-key policy**](./foreign-key-policy.md) owns the FK graph *within* a
> file. **An FK cannot cross a database file**, so this path owns the edges it
> cannot reach: the seven columns that name a row in the other store. Its numbers
> are confirmed below, with one reconciliation.
>
> [**Boot migration step**](./boot-migration-step.md) owns the boot sequence and
> already records that `init_user_db` gets no backup. **This path supplies the
> on-disk proof and the restore-side consequence.**
>
> [**Rust test fixtures**](./rust-test-fixtures.md) owns `init_test_db()` /
> `init_test_user_db()` and their 524 / 57 call sites. **This path adds the
> reason the second fixture is under-served: every optional store handle in the
> tree exists so a harness that builds only one of the two databases can call a
> production function.**
>
> [**Process-global command state**](./process-global-command-state.md) owns
> `AppState`'s 39 fields. **This path adds that `AppState` is not the only door
> to the second pool** — a `OnceLock` hands it to nine functions whose
> signatures say they touch one database (§7 P1-c).
>
> [**Delete semantics**](./delete-semantics.md) owns the delete operation and
> its blast radius. **This path adds the half its receipt cannot see: the rows
> in the other file.**
>
> The **Deviations** section is a fix backlog.

## 1 Trigger

- "Where should this table live?" / "Is this app data or user data?"
- "I need the pool — is it `state.db` or `state.user_db`?"
- "`no such table: <x>`, but I can see the table right there in the migration."
- "This operation writes a row here and a row there — can I wrap it in a transaction?"
- "I'm exporting / backing up / restoring the database." (Which one?)
- "The vector for this row lives somewhere else."
- "My test needs a pool." (Which pool? Both?)

If you are about to type `state.user_db`, `UserDbPool`, `init_user_db`,
`init_test_user_db`, `personas_data.db`, `KNOWLEDGE_BASE_SCHEMA`,
`COMPANION_SCHEMA`, or to add a `CREATE TABLE` whose readers live under
`src/companion/**` — you are in this situation.

**Not this path:** *how to open a transaction* is
[transaction-boundary](./transaction-boundary.md); *which migration file the
DDL statement goes in* is [schema-change](./schema-change.md); *what `ON DELETE`
to declare* is [foreign-key-policy](./foreign-key-policy.md).

## 2 The one way

**Put it in the primary store. The second store exists for exactly two things —
vector indexes that need the `vec0` extension, and the companion brain — and
adding to it costs you the migration runner, the backup, the transaction, the
foreign key, the repository layer and the fixture, all at once.** When you have
no choice, obey three rules in order. **First, the DDL and every reader of that
table must name the same pool**: a table created by `run_incremental` lives in
`personas.db` and can only be reached with `&DbPool`; a table created in
`init_user_db`'s `KNOWLEDGE_BASE_SCHEMA` / `COMPANION_SCHEMA` lives in
`personas_data.db` and can only be reached with `&UserDbPool` — and because
those two Rust types are **the same type**, nothing but your attention enforces
that pairing (§7 P0 is what happens when attention lapses). **Second, when one
logical operation must write both files, write the store that owns the durable
truth FIRST, commit it, then write the derived store best-effort — never with
`?`** — and give the gap a **named, idempotent repair** that runs at boot or on
a schedule; the residue of a crash must be a state that replaying the operation
fixes, not one it double-applies. `create_with_embedding`
(`db/src/repos/core/memories.rs:1850`) is the shape to copy and
`backlog_triage.rs:23` is the doc comment to copy. **Third, if the value you are
about to store names a row in the other file, say so on the column** — no
`REFERENCES` can be declared across a file boundary, so the only thing that
distinguishes a deliberate cross-store link from a forgotten foreign key is a
comment, and there are seven such columns here with none. Then stop: never
`ATTACH` (it is blocked at the only surface that could reach it, deliberately),
never open a transaction expecting it to cover both files, and never pass a
store handle as `Option<&Pool>` — an absent store must be a compile error, not a
runtime `(count, 0)`.

## 3 Mandated primitives

**Exist today — use them:**

- **`db/src/lib.rs:492` `init_user_db(&Path) -> Result<UserDbPool>`** — the only
  construction site for the second pool. It applies `KNOWLEDGE_BASE_SCHEMA`
  (`:665`) and `COMPANION_SCHEMA` (`:794`), then 19 `ALTER TABLE`, one
  `CREATE INDEX` and one `UPDATE` backfill. **All 21 through
  `let _ = conn.execute_batch(stmt)`.** Read it before adding anything.
- **`db/src/lib.rs:157` `UserDbPool` / `core/src/pool.rs:14` `DbPool`** — the two
  handle types. **They are the same type.** Both are
  `Pool<SqliteConnectionManager>`; the aliases are transparent, so `&DbPool` and
  `&UserDbPool` are interchangeable to `rustc` with no error, no warning and no
  lint. This is the single most important fact in this document.
- **`db/src/lib.rs:216-224` `SqlitePragmaCustomizer`** — installed on *both*
  pools, so `PRAGMA foreign_keys = ON` and the seven other standard pragmas hold
  identically on either side. The one thing about the two files that is
  genuinely symmetric.
- **`db/src/repos/core/memories.rs:1850` `create_with_embedding`** — **the
  reference implementation of a two-store write.** Owning store first with `?`,
  derived store best-effort with a `tracing::warn!`, repair named in the message
  (`backfill_memory_embeddings`). Copy this shape.
- **`db/src/repos/core/memories.rs:2008` `backfill_memory_embeddings`** — the
  repair half. Idempotent, diffed against what is already present, bounded per
  batch, driven from `src/lib.rs:1069` on a delayed loop.
- **`src/commands/credentials/vector_kb.rs:1410`
  `reconcile_orphaned_kb_records`** — the only **bidirectional** reconciler in
  the tree: Case 1 sweeps a `knowledge_bases` row with no credential, Case 2
  sweeps a credential with no knowledge base. Boot-time, from `src/lib.rs:1092`.
- **`src/commands/companion/backlog_triage.rs:23-27`** — the module header that
  states the doctrine: *"There is no transaction spanning both, so the write
  order is fixed: ideas first, approval status last. A crash in between leaves
  the approval `pending` and replaying it is a no-op … The reverse order would
  lose verdicts silently."* **Nineteen words of prose that make the operation
  crash-safe.** It is the only such header in 963 files.
- **`db/src/lib.rs:1994` `init_test_user_db()`** — the fixture. 57 call sites in
  8 files. Use it; do not hand-roll the second database's tables.
- **The two database files themselves.** `ATTACH` a read-only copy of each to
  one `sqlite3` session and every question in this document is answerable in
  seconds. That is how P0 was found.

**Do not exist — this path names them:**

- **Distinct types for the two pools that matter.** The shape exists in-repo —
  `src/bench/db.rs:135` `pub struct BenchDbPool { conn: Mutex<Connection> }`,
  private field, `get()` accessor — applied to the one store with no production
  call site. See "Prefer a type over a gate".
- **A repository layer for the second store.** `db/src/repos/**` takes `&DbPool`
  **1,271 times across 107 files** and `&UserDbPool` **10 times in 1 file**. The
  second database's 301 handle-takers live in `src/companion/**` with inline SQL.
- **A migration runner, step id, or schema version for the second store.**
- **A backup of the second store.** Zero, verified on disk (§6).
- **Any assertion, anywhere, that a table named in a SQL literal exists in the
  database whose pool that literal is executed against.** §9 proposes it.

## 4 Steps

1. **Decide the store, and default to `personas.db`.** The second file buys you
   one thing: a connection where the `vec0` extension is registered
   (`db/src/lib.rs:497-507`). If your data is not a vector index and not
   companion brain state, it belongs in the primary store — where the migration
   runner, the backup, the repository layer, the FK graph and 524 fixture call
   sites already are.
2. **If it must be the second store, write the DDL where `init_user_db` can see
   it** — `KNOWLEDGE_BASE_SCHEMA` (`db/src/lib.rs:665`) or `COMPANION_SCHEMA`
   (`:794`), plus an `ALTER` in the array at `:540` or `:564` for a later column.
   **43 of the 46 production `CREATE TABLE` statements for this store are in
   that one file**; keep it that way. The three exceptions are `vec0` tables
   that cannot be created before the extension registers, so they are built
   lazily at first use (`memories.rs:1686`, `companion/brain/embeddings.rs`) —
   that is the only legitimate reason to create a table outside `init_user_db`.
3. **Type every reader and writer of that table `&UserDbPool`, and check the
   pairing by hand.** There is no compiler help. Grep the table name; every hit
   must be in a function whose pool parameter is the user pool. **Do this even
   though it feels redundant** — §7 P0 is a shipped feature that skipped it.
4. **Ask the type-over-gate question now**, before §9. The answer for this leaf
   is below and it is not the obvious one.
5. **If the operation writes both files, fix the order and write it down.**
   Owning store first, committed; derived store after, best-effort. State the
   residue in a module header the way `backlog_triage.rs:23` does: name what a
   crash between the two leaves behind, and why replaying is safe. **If you
   cannot make replay safe, you have the order backwards.**
6. **Give the gap a named repair.** Idempotent, diff-driven, boot- or
   schedule-triggered, and referenced by name in the best-effort branch's log
   message so the next reader can find it. A best-effort write with no named
   repair is a leak with a comment on it.
7. **If a column names a row in the other file, mark it.** No `REFERENCES` is
   possible; write `-- CROSS-STORE: <other file>.<table>(<col>), <fate>` on the
   line above. Six columns need this today and **zero have it**
   ([foreign-key-policy](./foreign-key-policy.md) prescribes the same marker
   shape, `-- RETAINED BY DESIGN:`, for the within-file case, and it also has
   zero adoption).
8. **Extend the delete path in both directions.** Whatever deletes the parent in
   the primary store must delete or NULL the dependants in the second store.
   The FK graph cannot do it for you across a file boundary — §7 P1-b lists the
   eight delete paths that forget.
9. **Take `init_test_user_db()` for the fixture. Take both fixtures if the code
   takes both pools.** Never hand-roll the second store's DDL; 19 files do, and
   that is more files than use the builder (8).
10. **Stop.** No `ATTACH`. No transaction expecting to span both. No
    `Option<&Pool>` on a store handle. No `let _ =` on the second write.

## 5 Anti-patterns

- **Creating the table in one store and reading it from the other.** This is not
  hypothetical and it is not rare enough to ignore: `companion_tours` was added
  to `run_incremental` (`incremental.rs:7189`, so `personas.db`) on 2026-07-30
  and every one of its four SQL statements executes on `&UserDbPool`. The
  feature has never written a row. **The failure mode is that everything
  compiles and the error arrives at runtime, in a code path nothing tests.**
- **Assuming `&DbPool` and `&UserDbPool` are different types.** They are two
  transparent aliases for `Pool<SqliteConnectionManager>`. The repo has already
  been bitten and left the scar tissue in a comment —
  `approval_exec_core.rs:1085`: *"Credentials live in `state.db` … NOT
  `state.user_db` … Using the wrong pool surfaces as 'no such table:
  persona_credentials' — caught during the 2026-05-27 tier-2 audit run."*
- **Opening a transaction and believing it covers the operation.**
  `vector_kb.rs:209` says *"Delete from user DB in a transaction for
  consistency"*; the transaction covers three statements in one file and the
  fourth statement — in the other file — is outside it. **Nine cross-pool
  functions open a transaction; all nine wrap exactly one file.**
- **Writing the derived store first.** `execute_register_project`
  (`approval_exec_core.rs:1117`) writes the companion registry at `:1132` and
  `create_project` on the primary store at `:1158`. A crash between leaves a
  companion project row naming a `dev_projects` row that does not exist, and
  replaying creates a second one. The correct order is the reverse, and
  `backlog_triage.rs` gets it right eleven files away.
- **Propagating the second write's error with `?` after the first has
  committed.** The caller sees `Err` and believes nothing happened; half the
  operation is durable. `import_athena_memory` documents the correct posture at
  `data_portability.rs:8242` — *"Never returns `Err` … an error here would
  report a failed import that in fact half-succeeded"* — and is the only
  function in the tree that says it.
- **`Option<&UserDbPool>` on a production signature so a test can pass `None`.**
  Every optional store handle in this tree (17 of them, §9) exists for that
  reason, and `dispatcher.rs:589` says so outright: *"`sys_db: None` … the bench
  harness path, which builds only a user DB."* The cost is paid in production
  types and in coverage: `import_bundle` is called with `None` **33 times** and
  with `Some` **6 times**.
- **Returning `0` for "the store was absent".** `athena_tier_counts`
  (`data_portability.rs:1707`) returns `(core, 0)` when `user_db` is `None`;
  `describe_skill` (`dispatcher.rs:2944`) returns `Vec::new()`. Both report
  *empty* where the truth is *unknown*, and the UI cannot tell the difference.
- **Trusting the delete cascade across the boundary.** `delete_all_memories`
  (`db/src/repos/core/memories.rs:1052`) carries the comment *"No FK children"*.
  True inside `personas.db`; every deleted memory's vector and model stamp
  survive in `personas_data.db`. The same file warns about exactly this at
  `:1683-1685`.
- **Believing the orphan sweeper will catch it.** `cleanup_orphan_rows`
  (`db/src/lib.rs:447`) runs on the primary connection.
  `gc_archived_memory_embeddings` (`memories.rs:1928`) seeds its candidate list from
  `SELECT id FROM persona_memories WHERE tier = 'archive'` — **rows that still
  exist**. A hard-deleted memory has no row, so its vector is structurally
  invisible to the only collector that could remove it.
- **Restoring one file.** The `backups/` directory contains snapshots of
  `personas.db` and nothing else. Restoring one rolls the primary store back
  under a second store that was never rolled back with it.
- **Hand-rolling the second store's schema in a test.** 38 `CREATE TABLE`
  statements across 19 `#[cfg(test)]` modules build tables that
  `init_test_user_db()` already builds — and that fixture is itself a
  hand-maintained copy applying 7 of production's 19 ALTERs
  ([rust-test-fixtures](./rust-test-fixtures.md) A2). Two layers of drift.

## 6 Evidence

### The two stores, measured (read-only copies, 2026-08-15)

| | `personas.db` | `personas_data.db` |
|---|---:|---:|
| file size | 347 MB | 17 MB |
| tables (excluding `sqlite_*`) | **241** | **67** |
| indexes / triggers | 744 / 5 | 96 / 3 |
| FK constraints | **172** | **10** |
| child tables with ≥1 FK / distinct parents | 130 / 51 | 7 / 4 |
| rows | **363,211** | **25,480** |
| table names shared with the other file | **0** | **0** |

**Reconciliation with [foreign-key-policy](./foreign-key-policy.md).** That path
reports 244 and 70 tables; [upsert](./upsert.md) and
[index-design](./index-design.md) report 241 and 67. **Both are right and the
difference is exactly the three internal tables per file** —
`sqlite_stat1`, `sqlite_stat4`, `sqlite_sequence`. The FK counts (172 / 10) are
identical across the two independent measurements, which is the cross-check that
matters. Use 241 / 67 for "tables someone wrote".

### What is actually in the "user-facing" database

Classified by table-name family, with live row counts:

| Family | Tables | Rows | Is it user data? |
|---|---:|---:|---|
| `companion_*` — Athena's brain, approvals, budgets, goals, rituals | **46** | **9,971** | No — app state |
| `persona_memory_embedding*` — vectors + model stamps | 8 | 15,496 | No — derived from `personas.db` |
| `dev_tools_project_subscription`, `engine_cli_event`, `engine_project_pulse` | 3 | 10 | No — engine state |
| `knowledge_bases`, `kb_documents`, `kb_chunks`, `kb_entities`, `kb_extraction_runs` + FTS shadows | 10 | **3** | Yes — and all five real tables hold **0 rows** |

**49 of 67 tables (73%) and 9,981 of 25,480 rows are application state. The
declared purpose of the file — user content — holds zero rows.** The three
counted rows are FTS-internal config.

**The rule is written down four times and says two different things.**

- `db/src/lib.rs:154-156`: *"Separate connection pool for the user-facing
  database … completely isolated from the internal app database to prevent user
  queries from corrupting app state."*
- `db/src/lib.rs:490-491` and `src/lib.rs:371-373`: *"agents and users can freely
  read/write … without risk to the internal app database."*
- `db/src/lib.rs:1504` seeds the `personas_database` connector's description as
  *"Local SQLite database managed by Personas. **Safe for agent read/write
  operations.**"*
- versus [schema-change](./schema-change.md) Step 1 — *"`personas_data.db`
  (knowledge base + Athena brain) … Prefer the system DB unless the data is
  genuinely per-user brain state."*

**The data obeys the second reading and the security posture assumes the
first.** `execute_local_sqlite_conn` (`db_query.rs:2581-2607`) executes an
arbitrary write statement against this file behind a three-item denylist
(`ATTACH`, `DETACH`, `VACUUM INTO`) and **no table allowlist**;
`introspect_local_sqlite_tables` (`:2620`) lists every table in `sqlite_master`.
With write mode enabled — a user-facing toggle — `UPDATE companion_approval SET
status='approved'` is a legal query against the file documented as safe for
agents. The isolation is real and it is pointed the wrong way round.

### Where the handles live

Occurrences of a borrowed pool type, path-qualified forms included, 963 files:

| Layer | `&…UserDbPool` (files) | `&…DbPool` (files) |
|---|---:|---:|
| `db/src/repos` — the repository layer | **10 (1)** | **1,271 (107)** |
| `src/companion` | **301 (55)** | 86 (24) |
| `src/engine` | 57 (12) | 351 (69) |
| `src/commands` | 39 (12) | 176 (59) |
| `db/src` (schema + pools) | 1 (1) | 40 (11) |
| `engine` + `core` crates | **0 (0)** | 108 (39) |
| **total** | **408 (81)** | **2,072 (316)** |

**This is the controlled experiment.** Same engine, same driver, same pool
library, same team, one repository — and the second store has **1/127th** the
repository-layer coverage of the first. Every downstream asymmetry (no runner,
no backup, no fixture parity, no transaction discipline, no reconciler except
one) is downstream of the missing layer, not of the second file.

`AppState` field reads: `db` 1,979, `user_db` 250 by this sweep;
[process-global-command-state](./process-global-command-state.md) measures
`db` at 78.7% and `user_db` at 10.1% (254) of all field reads. Two independent
counts, same ratio.

**47 functions in 20 files carry both handles.** Two independent
implementations — a brace-balancing signature parser and a whole-file regex —
returned 47 and 47/20. *(A first pass returned 25/8 because both patterns
required a bare `&UserDbPool` and missed `&crate::UserDbPool`; the corrected
figure is 47. Path-qualified type names undercount by 47% if you forget them.)*

### DDL ownership — who decides

Every `CREATE TABLE` in `src-tauri` resolved against the live table lists:

| Store | statements | in the store's owned home | elsewhere |
|---|---:|---|---|
| `personas.db` | **288** | **245 (85%)** in `incremental.rs` (143), `schema.rs` (79), `initial.rs` (23) | 43, mostly `#[cfg(test)]` |
| `personas_data.db` | **84** | **43 of 46 production (93%)** in `db/src/lib.rs` | 3 production (`vec0`, created lazily by design) + **38 in `#[cfg(test)]` across 19 files** |

**The production DDL is centralised for both stores — this clears a claim I
expected to make.** What is missing on the second store is not a home; it is
everything around the home. `init_db` runs **125 guarded, id'd `run_step`
migrations**; `init_user_db` runs **21 statements through `let _ =`**, with no
id, no guard, no record, no log and no error propagation. Neither store has any
schema-version tracking (`user_version`, a `schema_migrations` table: zero
occurrences in `db/src`).

The test surface inverts: **19 files hand-roll the second store's tables versus
8 files that call `init_test_user_db()`.**

### Cross-file references — the edges no foreign key can hold

**Seven columns** in one store name a row in the other. Measured by `ATTACH`ing
read-only copies of both files to one connection and running the anti-join —
every row below is an executed query, not a reading of DDL:

| Edge (child → parent) | non-null values | dangling |
|---|---:|---:|
| `data`.`persona_memory_embedding_meta.memory_id` → `main`.`persona_memories.id` | 5,158 | **0** |
| `data`.`companion_persona_baseline.persona_id` → `main`.`personas.id` | 54 | **0** |
| `data`.`companion_dev_op.fleet_session_id` → `main`.`fleet_sessions.id` | 4 | **4** |
| `data`.`knowledge_bases.credential_id` → `main`.`persona_credentials.id` (NOT NULL) | 0 | 0 |
| `data`.`companion_approval.human_review_id` → `main`.`persona_manual_reviews.id` | 0 | 0 |
| `main`.`twin_profiles.knowledge_base_id` → `data`.`knowledge_bases.id` | 0 (of 1 row) | 0 |
| `main`.`research_sources.knowledge_base_id` → `data`.`knowledge_bases.id` | 0 (of 0 rows) | 0 |

**Five of the seven point outward from the second store and two point into
it** — the boundary is bidirectional, so neither file can be treated as the
dependent one.

**`companion_dev_op` is 4 of 4 dangling — and that is by design, not decay.**
`fleet_sessions` is a live registry that empties on exit (0 rows now); the
`companion_dev_op` rows are durable and all four read `status = 'interrupted'`.
It is a genuine cross-store link to an ephemeral parent, and it is exactly the
case a `-- CROSS-STORE:` marker exists to make legible. Nothing marks it.

**Zero declared parents dangle in either file** — confirming
[foreign-key-policy](./foreign-key-policy.md)'s finding on both.

### Behavioural probes, executed

1. **`companion_tours` does not exist in the file its code queries.** In
   `personas.db` the table exists with **0 rows**; in `personas_data.db`,
   `SELECT count(*) FROM companion_tours` returns
   `Error: no such table: companion_tours` — the exact error the app produces.
   §7 P0.
2. **The backup covers one store.** `%APPDATA%/com.personas.desktop/backups/`
   holds 9 files: three `personas-*.db` snapshots with their `-wal`/`-shm`
   sidecars. **Zero snapshots of `personas_data.db`.** One call site
   (`db/src/lib.rs:296`), one file.
3. **Restore skew is latent, not live.** Joining each backup snapshot against
   the live second store returns 0 dangling embeddings and 0 dangling baselines
   — the operator has not yet restored, and the affected tables have not moved.
   **The hazard is real and the instance count today is zero;** I looked for it
   specifically and did not find it.
4. **No torn vector writes exist today.** `persona_memory_embedding` holds 5,158
   vectors, `persona_memory_embedding_meta` holds 5,158 stamps, one distinct
   model. `embed_and_store_memory` (`memories.rs:1707`) performs four
   un-transacted statements, so a torn pair is possible and would be silently
   *grandfathered as current-model* by `apply_memory_model_guard` (`:1798-1800`).
   Zero instances live.
5. **21.1% of memories have no vector.** 1,377 of 6,535 `persona_memories` have
   no row in `persona_memory_embedding_meta`. This is the benign direction —
   `backfill_memory_embeddings` closes it — and it is the measurement that
   demonstrates the repair loop is real but not caught up.
6. **Nothing `ATTACH`es.** Zero runtime `ATTACH` in 963 files. The only
   occurrence is the guard that forbids it (`db_query.rs:2589`), hardened after
   a sandbox-escape finding because `starts_with("ATTACH ")` was bypassable via
   `ATTACH/**/DATABASE`. **The one mechanism SQLite offers for cross-file
   atomicity is not merely unused — it is deliberately blocked on the only
   surface that could reach it.**

### Portability, backup and reset — the whole-system operations

| Operation | Covers `personas.db` | Covers `personas_data.db` |
|---|---|---|
| pre-migration backup (`db/src/lib.rs:296`) | yes, with `-wal`/`-shm` | **no** |
| restore | **no path exists at all** — zero references to `backups` under `src/` | n/a |
| cloud sync (`src/cloud/sync/`, 11 tables) | yes | **no** — `UserDbPool` never appears in the module |
| export bundle | **53 entity kinds** | **12 entity kinds** |
| import | 1 transaction + 2 untransacted phases | 3 transactions, all post-commit |
| "delete all" commands (3) | yes | **none** |
| idle maintenance (`db/src/lib.rs:226`) | yes | yes — the one symmetric operation |

The import's ordering is **correct and deliberate** — the primary store commits
first so a rollback can never strand rows in a store the transaction could not
cover (`data_portability.rs:6660`, `:8075`). The unhandled direction is the
other one: a crash after `:6651` leaves every persona, team and project
committed with **no twin knowledge bases and no Athena brain**, and there is no
resume marker and no reconciler for that state.

### Convergence — what the siblings did without reading this

Run 2026-08-15 against `brainiac` (Rust · sqlx · Postgres) and `personas-cloud`.

**The result inverts part of this document's framing, and the inversion is the
most valuable thing in the sweep.** See the block below for the measured
detail; the headline is that **the entire class of defect this leaf describes is
structurally absent from a single-store sibling** — no split rule to write, no
handle to confuse, no cross-store column to mark, no compensating write order,
no half-covered backup — and it is absent because of a topology choice, not
because anyone was more careful. A path that reads as "be disciplined about your
two stores" should be read as "having two stores is the cost you are paying for
`vec0`".

| | `brainiac` | `personas-cloud` | `vibeman` | **Personas** |
|---|---|---|---|---|
| runtime SQL stores | **1** (Postgres) | 2 | **4** | **3** |
| handles distinguishable by type | **yes** — `Store` wraps the pool; raw `sqlx::PgPool` appears only as an `admin` handle in eval/test harnesses | different runtimes, accidentally | **no** — both accessors return `Database.Database` | **no** for the two that matter; **yes** for the one nobody runs |
| a written rule for what goes where | exhaustive, in `ARCHITECTURE.md` | none | good prose, zero enforcement | three comments, two of which contradict the data (§6) |
| cross-store references | **0** — 59 FKs, all enforced | 8 external + 15 unenforced | 6, and the trigger enforcing them is bound to the wrong file | **7, none marked** |
| backup coverage | **100%, one `pg_dump`** | none | none, ×4 | one of three |

**`brainiac`'s answer is topological, and that is the finding.** One Postgres. Its
embeddings live in the same database as the rows they describe, inside the same
transaction; its 59 foreign keys are all enforceable because there is no boundary
for one to cross; one `pg_dump` is a complete backup. **The entire class of
defect in §7 — the wrong-file table, the compensating write order, the
un-markable column, the half-covered backup, the fixture that builds one store —
is structurally absent there, and it is absent because of a topology choice, not
because anyone was more careful.** Every clause in §2 should be read as the price
of `vec0`, not as general wisdom.

**`vibeman` is the empirical cost of the opposite choice, and it is worth
reading in full.** Four SQLite files. The split was introduced on 2026-02-28
inside an unrelated grab-bag commit whose entire message is *"Gemini CLI
addition, autowave"*. Since then: `behavioral_signals` exists in **two** files
(2,208 rows frozen the day before the split; 7,854 live), the cascade trigger
meant to enforce its references was `exec`'d on the wrong connection and has
never fired for a real deletion because the corpse table it bound to still
exists, and an aggregator with no watermark re-adds every raw row up to 288
times per retention window — producing a dashboard reading of **80,817,237 API
calls** for a single-user localhost app. **None of it announced itself.** Every
symptom was visible only by opening the files, which is the same way §7 P0 was
found here.

**Two clauses this document asserts are physics — reinvented independently.**
(1) *No transaction spans two files, so fix the write order.* `vibeman`'s
`observability.repository.ts:618` carries the identical comment shape —
`// Delete calls from hot-writes DB (separate DB, separate transaction)` —
reached with no shared document. (2) *A fixture that builds one store makes the
cross-store failure untestable.* `vibeman`'s three tests touching the second
store mock **both** accessors to return the same handle, so every test runs in a
single-file world where triggers and transactions work; that is precisely why
its wrong-file trigger shipped, and it is the same mechanism as this repo's 55
`None` fixtures (§7 P1-b). Two codebases, no contact, same defect.

**The clause convergence does NOT support, stated plainly.** "Prefer fewer
stores because it is simpler" loses the argument in practice. `vibeman`'s split
was audited deliberately — commit `13c39ae6` weighed file size, cache
configuration and migration risk, and **kept it**. The audit never mentioned
referential integrity, atomicity, backup coverage or type safety, all four of
which were already broken. So do not argue cost. **Argue that a second store
silently voids every store-wide guarantee the codebase already relies on** — FK
enforcement, transaction atomicity, trigger scope, backup coverage, migration
versioning and test fidelity — because that is the argument nobody has made and
the one the evidence supports.

**And the correction to this document's own premise.** The brief, and my first
draft, said Personas ships two databases. **It ships three.** `src/bench/db.rs`
opens a standalone `bench.db`, and it is the sharpest thing in the sweep:

- It is the **only** store in this repo behind a real newtype —
  `pub struct BenchDbPool { conn: Mutex<Connection> }` (`:135`), private field,
  `get()` accessor. Exactly the shape "Prefer a type over a gate" recommends.
- It is the **only** store with schema-version tracking — `SCHEMA_VERSION: i32
  = 1` (`:14`), written to a meta row and asserted on reopen (`:181`, `:208`).
- It is the **only** store that documents its cross-store reference policy —
  *"no cross-DB foreign keys (persona_id references are by string only, resolved
  at query time)"* (`:3-5`).
- And `open_pool` has **zero production call sites**: it is reachable only from
  its own tests.

**The one store nobody runs got every discipline; the two that hold all of the
user's data got none of them.** That is a controlled experiment inside one repo
— same language, same driver, same author — and it says the discipline was never
unavailable or unaffordable. It was simply not applied where it mattered.

*(A footnote on writers rather than files: `db::open_pool_at` opens `personas.db`
from the separate `personas-mcp` process (`mcp_server/db.rs:45`,
`mcp_bin.rs:87`). That is the second-writer hazard
[foreign-key-policy](./foreign-key-policy.md) Gap 1 owns, not a fourth store.)*

## 7 Deviations found

> **Second pass — what is upstream of all of this.** Every defect below reduces
> to one omission: **the second store has no repository layer.** The primary
> store's 1,271 `&DbPool` signatures in `db/src/repos/**` are where its
> migration discipline, its transaction discipline, its `crud_*!` macros, its
> timing instrumentation and its 524 fixture call sites attach. The second store
> has 10 signatures in 1 file, and its 301 remaining handle-takers are feature
> code in `src/companion/**` holding a pool and writing SQL inline. Every
> asymmetry below — the runner, the backup, the fixture, the missing reconciler,
> the wrong-pool bug — is a service the repository layer would have provided and
> does not exist to provide. **Build the layer and most of this list becomes
> unrepresentable rather than fixed.**

### P0 — a shipped feature that queries a table in the wrong database file

| Path | What's wrong |
|---|---|
| `db/src/migrations/incremental.rs:7189` | `run_step("companion_tours.table")` creates `companion_tours` — in **`personas.db`**, because `run_incremental` only ever runs against the primary pool. |
| `src/companion/tours.rs:223`, `:258`, `:302`, `:379` | `save_tour`, `list_tours` and the re-prove `UPDATE` all take `pool: &UserDbPool` and execute `INSERT/SELECT/UPDATE … companion_tours` on it. |
| `src/commands/companion/tours.rs:43`, `:51` | Both Tauri commands pass `&state.user_db`. |
| `src/companion/session.rs:1423` | The compose path passes `&user_db`. |

**Verified against the running installation:** `companion_tours` exists in
`personas.db` with **0 rows**; in `personas_data.db` the table does not exist and
the query returns `no such table: companion_tours`. Shipped **2026-07-30**
(`81fa5d0a1`); dead for 16 days.

Three things make this the leaf's canonical failure rather than a stray bug.
**It cannot fail to compile** — the two pool types are identical. **It cannot
fail a test** — the `#[cfg(test)]` module at `tours.rs:382` covers spec
validation only; no fixture builds the table, and grep confirms zero test
references to `companion_tours` anywhere. **It costs money before it fails**:
`compose_tour` runs a Claude one-shot, validates every step against the anchor
manifest, and *then* calls `save_tour`, so the user pays for the model call and
receives an error.

Fix: one word. Either move the `CREATE TABLE` into `COMPANION_SCHEMA`
(`db/src/lib.rs:794`) — consistent with every other `companion_*` table — or
retype the four functions `&DbPool`. Prefer the former; the table is brain state
and its neighbours are all in the second store.

### P0 — the second store has no snapshot and no restore

| Path | What's wrong |
|---|---|
| `db/src/lib.rs:296` | The sole `backup_before_migrations` call, with `db_path = app_data_dir.join("personas.db")`. `init_user_db` (`:492-662`) contains no backup call and mutates the file with 21 unguarded statements on every launch. |
| — | **Verified on disk:** `backups/` holds 3 snapshot sets, all `personas-*`. The Athena brain (9,971 rows) and 15,496 vector rows have never been snapshotted. |
| `src/` (frontend) | **Zero references to `backups`.** The snapshot that does exist is unreachable from the product — precisely when it is needed. |
| `src/lib.rs:656`, `:660` | Both inits use `?` in the same setup closure. If `init_user_db` fails, boot aborts **after `personas.db` has been irreversibly migrated**, with no snapshot of the second file to return to. |

### P0 — cross-store writes with no compensating repair

`create_knowledge_base` and `delete_knowledge_base` are the only pair in the
tree with a reconciler. Everything else in this class has none.

| Path | The window, and what it leaves |
|---|---|
| `src/commands/core/data_portability.rs:8182` → `:8189` | `import_twin_knowledge_base` commits the `knowledge_bases` row (with `credential_id` **NOT NULL**) to the second store, *then* inserts the credential into the primary store **with `let _ =`**. A failure or crash in the window leaves a NOT NULL column naming a row that does not exist. Nothing validates this reference, ever. |
| `data_portability.rs:6651` → `:6710` | `import_bundle` commits every persona/team/project/twin, then writes twin knowledge bases and Athena's brain post-commit. A crash between yields a workspace that looks fully imported with no knowledge bases and no brain. **No resume marker, no reconciler**; re-running conflicts on the already-committed entities. |
| `src/commands/companion/approvals/approval_exec_core.rs:1132` → `:1158` | `execute_register_project` writes the companion registry **first** and `dev_projects` second — the reverse of the safe order. Replay creates a duplicate. |
| `db/src/repos/core/memories.rs:843`, `:954`, `:1219` | `spawn_delete_memory_embeddings` is `handle.spawn(…)` after the primary commit. Fire-and-forget: process death between the two leaves a permanent orphan vector. |
| `db/src/repos/core/memories.rs:1707` | `embed_and_store_memory` runs four `conn.execute` calls with no transaction. A tear between the vector insert and the stamp insert produces a vector that `apply_memory_model_guard` (`:1798`) **grandfathers as the current model**, forever. |

Live instance count for the last two: **zero** (probe 4). The classes are real;
the operator has not hit them.

### P1-a — no delete path crosses the boundary

Seven primary-store delete paths have no second-store counterpart:

| Deleted in `personas.db` | Left behind in `personas_data.db` |
|---|---|
| persona (`db/src/repos/core/personas.rs:1758`) | every one of its memories' vectors + stamps |
| memory — single (`memories.rs:1026`), `delete_non_core` (`:1034`), **`delete_all` (`:1052`)** | orphan vectors; `delete_all` is one click, workspace-wide |
| credential (`commands/credentials/crud.rs:256`) | KB rows + vec index until next boot (then swept by Case 1) |
| dev project (`db/src/repos/dev_tools.rs:497`) | `companion_known_project` and its three FK-cascading children |
| knowledge base (`vector_kb.rs:184`) | `twin_profiles.knowledge_base_id` and `research_sources.knowledge_base_id` dangle **permanently** — `unbind_knowledge_base` (`db/src/repos/twin.rs:421`) exists but only an explicit user unbind calls it |

**And the only collector cannot reach them.** `gc_archived_memory_embeddings`
(`memories.rs:1937`) seeds candidates from `SELECT id FROM persona_memories WHERE
tier = 'archive'` — rows that still exist. A hard-deleted row is structurally
invisible to it. Repair runs in exactly one direction: `backfill` adds missing
vectors; nothing removes extra ones.

### P1-b — 17 optional store handles, all of them to serve a half-built fixture

Measured: **17 named bindings** typed `Option<…Pool>` across 5 files
(`data_portability.rs` 9, `db_query.rs` 4, `dispatcher.rs` 2, `ai_helpers.rs` 1,
`capability.rs` 1). **Fifteen make the second store optional; two make the
first.** Against **2,454** required (`ident: &…Pool`) bindings that is 0.69%
overall — but it is not evenly spread. Normalised against each store's own
borrowed-handle population (408 for the second, 2,072 for the first), the
second store's handle is optional **3.4%** of the time and the first store's
**0.10%** — a **~35× difference in discipline between two stores under the same
team, the same driver and the same pool library.**

Production never passes `None` on the portability path (11 of 12 sites pass the
real handle). **Tests pass `None` 55 times against 16 `Some`** — `import_bundle`
33/6, `twin_bundle` 12/1, `build_export_bundle` 7/5. And `dispatcher.rs:589`
states the cause outright: *"the bench harness path, which builds only a user
DB."* The `Option` is a hole punched in production types to accommodate a
fixture that is half a system, and its cost is that the majority of the
export/import suite validates a bundle that structurally cannot contain the
second store.

### P1-c — the signature is not the boundary

`db/src/memory_recall.rs:47` holds the second pool in a `OnceLock`, registered
once from `src/lib.rs:1059`. **Nine functions whose only pool parameter is
`&DbPool` write `personas_data.db` through it** — `create` (`memories.rs:275`),
`batch_create` (`:447`), `update_content` (`:758`), `batch_delete` (`:821`),
`archive_by_ids` (`:909`), `merge` (`:1097`), `update_tier` (`:1227`),
`spawn_gc_archived_memory_embeddings` (`:1978`), `run_decay_forgetting`
(`memory_recall.rs:434`). In every one the primary transaction commits and the
second-store write is spawned outside it.

The design is defensible — threading the pool through `ExecutionEngine` →
`run_execution` for one optional enhancement is a large blast radius, and the
comment at `:35-42` says exactly that. **The consequence is not**: no reader of
those signatures, and no type-level fix applied to parameters, can see that
these functions are cross-store. This is the fact that decides the type answer
below.

### P1-d — seven cross-store columns, zero markers

`knowledge_bases.credential_id` (NOT NULL), `twin_profiles.knowledge_base_id`,
`research_sources.knowledge_base_id`, `persona_memory_embedding_meta.memory_id`,
`companion_persona_baseline.persona_id`, `companion_dev_op.fleet_session_id`,
`companion_approval.human_review_id`. None carries a comment saying its referent
lives in another file. An absent FK here is indistinguishable from a forgotten
one — and [foreign-key-policy](./foreign-key-policy.md) P2 already counts 299
bare `*_id` columns whose fate nobody can read.

### P2 — the fixture and the schema drift on the second store only

38 `CREATE TABLE` statements in `#[cfg(test)]` modules across **19 files** build
second-store tables by hand, versus **8 files** using `init_test_user_db()`.
That fixture is itself a hand-maintained copy: 7 of production's 19 ALTERs,
16 columns where production has 20
([rust-test-fixtures](./rust-test-fixtures.md) A2). The primary store's fixture
has 524 call sites and is built from the real chain.

### Structural

- **`companion_tours` is the only table whose family sits in the other file**,
  and it is P0. Every other `companion_*` table is in the second store; every
  `dev_*`/`persona_*` table except the vector sidecars is in the first. The
  boundary is otherwise clean.
- **Three engine tables live on the user side** —
  `dev_tools_project_subscription`, `engine_cli_event`, `engine_project_pulse`
  (`db/src/lib.rs:1272+`). They FK-cascade off `companion_known_project`, which
  is why they are there; it is a defensible placement that nothing states.
- **Every deviation above shipped under a green `npm run check`.** No script,
  lint rule, test or CI job in this repo has any opinion about which database a
  statement runs against.

## 8 Gaps in the primitive

1. **SQLite cannot transact across files, and `ATTACH` — the one mechanism that
   could — is blocked here for a good reason.** Two `Pool`s, two connections,
   two write-ahead logs. This is physics plus a deliberate security decision, and
   the correct answer is the compensating-write-order-plus-repair protocol in
   §2. What is missing is that the protocol is named in **one** module header
   (`backlog_triage.rs:23`) out of the 47 functions that carry both store handles.
2. **A foreign key cannot cross a file.** Seven columns need one and cannot have
   one. `PRAGMA foreign_key_check` is per-file and structurally blind to all seven.
3. **`init_user_db` has no runner.** Not a gap in `run_step` — a gap in
   coverage. `run_incremental` takes a `&Connection` and would work verbatim
   against the user pool. Same finding as [schema-change](./schema-change.md)
   Gap 3 and [boot-migration-step](./boot-migration-step.md) item 5; three paths
   reaching it independently is the signal to build it.
4. **`backup_before_migrations` takes one path.** Making it take two is a
   two-line change; the reason it hasn't happened is that nothing enumerates
   "the stores this app owns" anywhere — there is no list, in code or in docs.
5. **The vec0 tables genuinely cannot live in the migration chain.** They must be
   created after `sqlite3_auto_extension` registers, which happens inside
   `init_user_db`. This is the one legitimate reason a `CREATE TABLE` for the
   second store exists outside `db/src/lib.rs`, and it is why the second store
   exists at all.
6. **A process-global can hand any pool to any function.** `OnceLock` defeats
   every parameter-level type discipline (P1-c). No newtype, no wrapper and no
   lint on signatures can reach through it;
   [process-global-command-state](./process-global-command-state.md) owns the
   general form of this hazard.
7. **The frontend has no name for the second store.** `connectorMeta.tsx:91`
   labels it *"Local Database"*; `introspectionQueries.ts:23` maps
   `personas_database` to the `sqlite` family. Nothing in the UI distinguishes
   the two files, so a user reasonably assumes "the Local Database" is the
   application's database. **The two-sided contract is broken on the naming
   alone**, before any behaviour is considered.
8. **Nothing can observe that the two files agree.** `PRAGMA foreign_key_check`
   is per-file; `cleanup_orphan_rows` is per-connection;
   `reconcile_orphaned_kb_records` covers one pair of tables. There is no
   whole-system integrity query, and unlike the within-file case
   ([foreign-key-policy](./foreign-key-policy.md) §2) SQLite does not supply one
   — it would have to be written, and it would have to `ATTACH`, which the repo
   forbids elsewhere for good reason.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md), answered explicitly, and tested
against the five qualifications this corpus has earned. **The obvious candidate
is distinct newtypes for the two pool handles — `AppDb` and `UserDb` — so
passing the wrong one cannot compile. My answer is: do it, it is cheap, and it
is not the fix. Build the repository layer instead.**

**Qualification 1 — a required type carries only what it actually encodes.** A
newtype encodes *which file*, and nothing else. Test it against this document's
own defects: it does not prevent the missing backup, the un-transacted import,
the seven one-sided deletes, the seven unmarked cross-store columns, or the torn
vector write. It prevents **exactly one class** — passing the wrong handle — and
that class has produced **one** live defect (P0). Worth fixing; not the
headline.

**Qualification 2 — requiredness is orthogonal to closedness.** Newtyping the
handles and de-`Option`-ing them (P1-b) are two independent edits. Doing the
first does not do the second, and `Option<UserDb>` would be exactly as wrong as
`Option<&UserDbPool>` is now.

**Qualification 3 — a type nobody constructs constrains nothing.** This one
*passes*: each pool is constructed at exactly one production site (`init_db`,
`init_user_db`) plus one fixture each. A newtype would be constructed in the
four right places, and the 19 files that hand-roll a user pool would be forced
through `init_test_user_db()` — a real, welcome side effect.

**Qualification 4 — a type anyone can construct authenticates nothing.**
`pub struct UserDb(pub Pool<…>)` is worthless: `UserDb(state.db.clone())`
compiles and reintroduces the bug with one more character. The field must be
private with construction reachable only from `init_user_db` /
`init_test_user_db`. **If you cannot make the field private, do not ship the
newtype** — it will read as a guarantee it does not provide. **The correct shape
is already in this repo**: `src/bench/db.rs:135`
`pub struct BenchDbPool { conn: Mutex<Connection> }` — private field, `get()`
accessor, one constructor. Copy it; do not design a new one.

**The in-repo control, which is the strongest evidence in this document.** Of
the three SQLite stores Personas opens, `bench.db` is the only one with a
newtype, the only one with a schema version (`SCHEMA_VERSION`, `bench/db.rs:14`,
written to a meta row and asserted on reopen), and the only one whose comment
states its cross-store reference policy — and `open_pool` has **zero production
call sites.** Same language, same driver, same author, same repo. The discipline
was never unavailable and never expensive; it was applied to the store where
nothing was at stake and skipped on the two holding all of the user's data.
Whatever explanation you reach for, it cannot be capability or cost.

**Qualification 5 — withholding beats requiring, and this is the one that
decides it.** The strongest version of this fix is not to hand out the second
pool at all. `src/companion/**` holds `&UserDbPool` **301 times** and writes SQL
inline against it; `db/src/repos/**` holds it **10 times**. The primary store
solved this years ago — 1,271 signatures behind a repository layer, which is why
`persistence-handle-in-command-tree` can already gate 134 stray checkouts in the
command tree and find the compliant alternative *dominant* (1,096 `repo::`
delegations). **Give the second store the same layer and the newtype becomes
almost unnecessary**, because feature code stops holding either handle. That
also fixes what the newtype cannot: a repository module is where the write
order, the compensating action, the delete counterpart and the fixture attach.

**And the honest limit on all of it, which is P1-c.** `db/src/memory_recall.rs:47`
hands the second pool to nine functions through a `OnceLock`. **No
parameter-level type discipline reaches through a process global.** Those nine
are the hottest memory write paths in the app and they are cross-store today
with single-store signatures. A newtype would leave every one of them exactly as
it is — which is the clearest possible demonstration that the type answer here
is a real improvement with a bounded reach, not a solution.

**Recommended, in order:** (1) build `db/src/repos/companion/**` and move the
301 handle-takers behind it; (2) newtype the handles with private constructors,
which is then a mechanical change; (3) remove the 17 `Option`s, which the
fixture work in (1) makes possible; (4) keep §9's ratchet until (3) lands.

## 9 The missing gate

### The semantic conditions, stated first

Three, each stack-free. Per the [portability test](../research/portability-test.md),
what follows are **one repo's proxies**; an adopting repo inherits the sentences
and re-derives its own signals.

> **(A)** A handle to one of the system's persistent stores is made optional at a
> boundary, so an operation can run with that store absent and report its
> contents as empty rather than as unknown.
>
> **(B)** A structure is defined in one store and read from another, and nothing
> in the type system, the tests or the build can tell — because the two stores'
> handles are the same type.
>
> **(C)** The system's whole-system operations — backup, export, reset, restore —
> cover a proper subset of the stores the system owns.

### What is gated, what is refused

**(A) is countable and is gated below.** **(B) and (C) are refused, with the
checker that *can* express each one specified instead of a bad regex shipped.**

**Why (B) — the P0 condition, the most valuable one — cannot be a census rule.**
Deciding it requires joining two facts that live in different files: the store a
`CREATE TABLE` lands in (a property of which migration function contains it) and
the store a SQL literal executes against (a property of the enclosing function's
pool parameter, often several call frames away, and in nine cases a process
global). A single-file regex has neither. **It needs a test, and the test is
cheap and should be built:**

> `no_sql_literal_names_a_table_from_the_other_store` — build both fixtures
> (`init_test_db()` + `init_test_user_db()`), read each one's `sqlite_master`,
> then for every function in `src/companion/**` and `src/commands/companion/**`
> whose pool parameter is `&UserDbPool`, extract the table names from its SQL
> literals and assert each exists in the **user** fixture, not the app one.
> **Assert the instrument before the result** — `app_tables > 200 &&
> user_tables > 60` — the shape
> [foreign-key-policy](./foreign-key-policy.md) §3 built for the dangling-parent
> case. Run today, it fails on `companion_tours`.

**Why (C) cannot be a census rule.** "Every store the app owns is backed up" is a
must-be-**complete** condition, and the census engine can only count occurrences
of a bad shape. There is no bad shape to count — the defect is an *absence*, one
missing call. The right mechanism is a one-line assertion beside the backup:
enumerate the store paths from a single constant and assert the snapshot set has
one entry per store. **That constant does not exist**, which is Gap 4, and
creating it is the fix and the gate at once.

### The one census rule — `optional-store-handle`

Keys on a **named binding** (parameter or struct field) whose type is an
`Option` of a connection pool, in either store's alias and in any path-qualified
form. Measured: **5 files / 17 matches**, all seventeen opened and confirmed as
the same shape — nine on the portability path
(`data_portability.rs:1607,1707,2221,2349,3902,4460,5924,8248,11128`), four on
the agent-facing query path (`db_query.rs:464,505,699,764`), two on the
companion dispatcher (`dispatcher.rs:594,2944`), one forwarding
(`ai_helpers.rs:220`), one struct field (`capability.rs:113`). **Precision 17/17.**

The `[A-Za-z_]\w*\s*:\s*` head is load-bearing: it restricts the match to a
*binding* and so removes the tree's one true false positive,
`fn pool_of(app: &AppHandle) -> Option<DbPool>` (`commands/fleet/persist.rs:63`),
where the `Option` encodes a genuinely unknowable state — `AppState` is not yet
managed during early boot — and is correct content. Dropping the head raises the
count from 17 to 18 and reports that function as a defect.

No variable-length lookbehind: one forward scan. Runtime under a second over
963 files.

```json
{"rules":[
  {
    "id": "optional-store-handle",
    "goldenPath": "docs/concepts/golden-paths/second-database.md",
    "title": "A persistent store's handle made optional at a boundary, so the store can be absent at runtime instead of at compile time",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "[A-Za-z_][A-Za-z0-9_]*\\s*:\\s*Option\\s*<\\s*&?(?:'[a-z]+\\s+)?(?:[A-Za-z_][A-Za-z0-9_]*::)*(?:User)?DbPool\\s*>",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a named binding (fn parameter or struct field) whose type is Option<[&]Pool> for either of this app's two SQLite stores. PROXY FOR the stack-free condition: a handle to one of the system's persistent stores is made optional at a boundary, so an operation can run with that store absent and report its contents as EMPTY rather than as UNKNOWN. This app opens two SQLite files - personas.db (primary, DbPool, core/src/pool.rs:14) and personas_data.db (UserDbPool, db/src/lib.rs:157) - and both aliases resolve to the same Pool<SqliteConnectionManager>, so nothing at the type level distinguishes them. MEASURED 2026-08-15 at 5108ff978: 17 matches in 5 files, ALL SEVENTEEN OPENED AND CONFIRMED (precision 17/17) - data_portability.rs 9, db_query.rs 4, dispatcher.rs 2, ai_helpers.rs 1, capability.rs 1. Fifteen of the 17 make the SECOND store optional and two make the first. Against 2,454 required (ident: &Pool) bindings that is 0.69% overall, but it is not evenly spread: normalised against each store's own borrowed-handle population (408 for the second store, 2,072 for the first) the second store's handle is optional 3.4% of the time and the primary store's 0.10%, a ~35x difference in discipline between two stores under the same team, the same driver and the same pool library. WHY IT IS A DEFECT AND NOT A DEGRADED MODE: the None arm does not report absence, it reports emptiness. athena_tier_counts (data_portability.rs:1707) returns (core, 0) when the store is missing; describe_skill (dispatcher.rs:2944) returns Vec::new(). A caller cannot distinguish 'this store holds nothing' from 'this store was not passed'. WHY THE OPTION EXISTS: every instance serves a test or bench harness that builds only one of the two databases - dispatcher.rs:589 says so outright ('sys_db: None keeps every other arm working ... the bench harness path, which builds only a user DB'). The cost is paid in coverage: import_bundle is invoked with None 33 times and Some 6 times, build_export_bundle 7 vs 5, twin_bundle 12 vs 1 - so 55 of 71 test invocations of the portability surface validate a bundle that structurally cannot contain the second store. PRECISION ANCHOR: the leading [A-Za-z_]\\w*\\s*:\\s* restricts the match to a BINDING and removes the tree's one true false positive, commands/fleet/persist.rs:63 `fn pool_of(app: &AppHandle) -> Option<DbPool>`, where the Option encodes a genuinely unknowable state (AppState is not yet managed during early boot) and is correct content; without the head the count is 18 and that function is reported as a defect. Path-qualified forms (Option<&crate::db::DbPool>, Option<crate::db::UserDbPool>) are covered - omitting the (?:ident::)* segment undercounts this family by 4 of 17, and undercounts the bare-handle census by 47%. POSITIVE CONTROL: the identical binding head pointed at the REQUIRED form (`ident: &[path::]DbPool`) matches 2,454 times across 368 files, so the rule discriminates on the Option wrapper rather than on the token DbPool - 0.7% of pool bindings are optional and 99.3% are not. LEGAL FIX, in order: (1) make the parameter required (&UserDbPool) and give the test init_test_user_db() (db/src/lib.rs:1994, 57 sites in 8 files) instead of None; (2) if the operation genuinely cannot reach the store, return Result and let the caller decide, never a zero count; (3) the durable fix is a repository layer for the second store so feature code never holds either pool - see the golden path. DO NOT 'fix' this by widening to Option<T> generally: the condition is about a STORE handle, and a store the code cannot see is a store the code will silently under-report. END OF LIFE: this rule is designed to reach zero. When it does the runner fails structurally on zero-matches, by design - DELETE the rule then, do not baseline it at 0."
    },
    "baseline": { "files": 5, "matches": 17 },
    "floor": 900
  },
  {
    "id": "optional-store-handle-positive-control",
    "goldenPath": "docs/concepts/golden-paths/second-database.md",
    "title": "POSITIVE CONTROL for optional-store-handle — the same binding head pointed at the REQUIRED form",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "[A-Za-z_][A-Za-z0-9_]*\\s*:\\s*&(?:'[a-z]+\\s+)?(?:[A-Za-z_][A-Za-z0-9_]*::)*(?:User)?DbPool\\b",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "NOT A GATE - a control, and it carries no baseline by design. Same binding head, same path-qualifier handling, same two pool aliases as optional-store-handle, but pointed at the COMPLIANT shape: a required borrowed pool. Measured 2026-08-15 at 5108ff978: 2,454 matches across 368 files, versus the rule's 17 across 5. That 144:1 ratio is the evidence that optional-store-handle discriminates on the `Option<` wrapper and not on the token `DbPool` - if the rule were keying on the type name it would match here too and report the entire data layer as violating. Run both together whenever the rule's pattern is edited: if this control's count collapses, the anchors were broken, not the codebase fixed. It is expected to RISE as adoption improves, which is exactly why it must never be baselined."
    },
    "floor": 900
  }
]}
```

**No `exclude` entries.** The single false positive is removed by the *pattern*
(the binding head), not by a path, so there is no legitimate file-level exemption
and a stale suppression cannot accumulate.

**`floor: 900`** matches the other `src-tauri`-rooted rules deliberately —
several rules over one root must not hold several opinions about what "the Rust
tree is intact" means. The walk reports **963**, exactly `rust.files` in
[`shared-facts.json`](../shared-facts.json).

**On severity.** The census mechanism's own semantics are the severity: drift is
fatal under `npm run census:check` and reporting-only under `npm run census`.
That is correct for this rule and no argument from warning volume is offered or
would be valid. The rule is a **ratchet held until the repository layer lands**,
not the fix; the fix is in "Prefer a type over a gate", and the P0-catching
instrument is the Rust test specified above, not this.

### Validated standalone, before publishing

Both rules were written to a scratchpad registry unique to this composer and run
through the real runner — `node scripts/census/run-census.mjs --rules
<scratch>/rules-second-database-probe.json` — not a re-implementation. Results:
`optional-store-handle` **5 files / 17 matches / 963 walked / floor 900**, every
matching line listed and opened; `optional-store-handle-positive-control`
**368 files / 2,454 matches**, no baseline, no structural problems. The rule
block above was then re-extracted from this finished document, re-parsed, and
re-run to confirm the published JSON is the validated JSON.
