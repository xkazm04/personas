# Golden path — Schema change (adding a table or column)

> Situation node: `data-persistence/schema-design/schema-change` · [situation spine](../situation-spine.md)
> Composed 2026-08-13 from a ground-truth sweep of the migration chain (~135 tool
> calls incl. two sub-sweeps), against `master` @ `7bb572e2b`. `.claude/worktrees/**`
> excluded from all counts. Every number below was counted, not estimated.
> Sibling leaf **Boot migration step** owns *applying* a migration safely at boot
> (idempotency guards, abort-vs-log, the pre-migration backup); this path owns
> *designing and landing* the change. Read that one for the runtime contract.
> The **Deviations** section is a fix backlog.

## Trigger

- "Add a table for X" / "we need to persist Y"
- "Add a column to `personas` / `dev_projects` / `persona_executions`"
- "This needs a new field on the row so the UI can show it"
- "Store the result of Z instead of recomputing it"
- "Rename / widen / drop this column" (SQLite can do none of those in place — see Gaps #1)
- "Why doesn't my new column show up on my machine but works on a fresh install?"

If you are about to type `CREATE TABLE`, `ALTER TABLE … ADD COLUMN`, `CREATE INDEX`, `REFERENCES`, or open `src-tauri/db/src/migrations/*.rs` — you are in this situation.

## The one way

**Every schema change — new table, new column, new index — goes in exactly one place: a new `run_step(…)` appended to the END of `run_incremental`'s body, at `incremental.rs:4789` — immediately before its closing `Ok(())` on line 4790.** Not `schema.rs` (frozen — it is the *legacy* fresh-install shape and adding there splits your change across two files that drift), not `initial.rs`, and above all **not the physical end of `incremental.rs`** — the file's tail belongs to `ensure_composite_fires_table`, which `initial::run` calls *before* `run_incremental`, so "append to the end of the file" lands your migration in the wrong phase (16 comments in that one file exist to warn you; see Anti-patterns). `run_incremental` runs on fresh installs and upgrades alike, which is the whole convergence property: one home, one code path, both populations. Give the step a unique `id`, a human `description`, and an `already_applied` that probes the **real schema** via `has_table` / `has_column` / `has_index` — never `|_conn| Ok(false)`. Put the DDL inside `ddl_step` and **propagate its `Result` with `?`**; never `let _ =`, never `.ok()`. Then, before you write a line of Rust above the data layer, **join the cross-cutting registries** (§Steps 4) — a new table that isn't in them is invisible to change events, undo, orphan cleanup, sync and export, and nothing will tell you. Finally, if the change lives in the *user* database (`personas_data.db` — knowledge base + Athena brain), you are in a different, unprotected world: see Gaps #3.

## Mandated primitives

- **`db/src/migrations/incremental.rs:163-4791`** — `run_incremental`. **The only legal home for new DDL.** 4,628 lines, 71 `run_step`s.
- **`…/incremental.rs:5-10`** — `struct IncrementalMigration { id, description, already_applied, apply }`. The step record.
- **`…/incremental.rs:12-24`** — `run_step`. Calls `already_applied`; short-circuits or calls `apply`; logs `migration_id`. **Note what it does NOT do: it records nothing.** `migration.id` is read at exactly one place — the `tracing::info!` field at `:19`.
- **`…/incremental.rs:33-38`** — `ddl_step(conn, sql)`. Wraps a multi-statement batch in `BEGIN IMMEDIATE`/`COMMIT` so a CREATE+INDEX+INSERT script is atomic. Use it for **all** DDL.
- **`…/incremental.rs:40-47 / 49-56 / 76-83`** — `has_column(conn, table, col)` / `has_table` / `has_index`. The three legal `already_applied` probes. All read live schema; all return `Ok(false)` (not an error) for a missing table, so a typo'd guard reads as "not applied" and lets `apply` run and fail loudly — *provided you propagate*.
- **`…/incremental.rs:104-159`** — `rebuild_executions_table_with_incomplete_status`. **The reference table-rebuild**, for anything `ALTER TABLE` cannot express (CHECK, FK, NOT NULL, rename, drop). Recreates the table from its **own stored DDL** rather than a hand-written column list, so later-added columns survive. Copy this shape.
- **`db/src/migrations/fk_hygiene.rs:117-…`** — the generic rebuild helper behind 9 table rebuilds, idempotency-gated on `pragma_foreign_key_list`, with `cleanup_orphans_sql` run before the FK is enforced.
- **`db/src/lib.rs:1882-1902`** — `init_test_db()`. Builds a temp DB through the **full** chain, propagating with `?`. Called **369×** in `db/src/` and **129×** in `src/`. Your test uses this, never a hand-written fixture.
- **`db/src/backup.rs:48`** — `backup_before_migrations`. Runs before any connection opens `personas.db`.
- **`core/src/models/<domain>.rs`** — row structs. `#[derive(Debug, Clone, Serialize, Deserialize, TS)]` + `#[ts(export)]` + `#[serde(rename_all = "camelCase")]` (219 camelCase vs 41 snake_case across `core/src/models/`; the 41 are enum payloads pinned to stored strings). **Corrected 2026-08-14:** an independent attribute-block parser measures **212 carrying a `rename_all` and 198 carrying none at all** in `core/src/models/`. The original framing counted only the structs that declare a casing and so made the split look like a 219/41 choice between two conventions, when the largest group is the structs that declare nothing — which is now tracked by the `model-struct-without-rename-all` census rule.
- **`db/src/repos/<group>/<name>.rs`** — free fns `pub fn x(pool: &DbPool, …) -> Result<T, AppError>`, body wrapped in `timed_query!("<table>", "<repo>::<op>", { … })` (`db/src/macros.rs:331`), rows mapped by a private `fn row_to_x(r: &Row)` using **string column names** (110 hand-written vs 44 `row_mapper!`).
- **`src/commands/<feature>/<name>.rs`** — `#[tauri::command] pub fn`, first arg `state: State<'_, Arc<AppState>>`, `require_auth_sync(&state)?` (or `require_auth(&state).await?`) as the first statement, `Result<T, AppError>`.
- **`src/api/<group>/<name>.ts`** — `import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke'`, `import type { X } from '@/lib/bindings/X'`, camelCase arg keys. Enforced by `no-restricted-imports` at `eslint.config.js:73-82`.

## Steps

1. **Decide which database.** `personas.db` (system — everything the app owns) → this path. `personas_data.db` (knowledge base + Athena brain) → `KNOWLEDGE_BASE_SCHEMA` / `COMPANION_SCHEMA` in `db/src/lib.rs:665` / `:794`, plus a hand-appended `ALTER` in the array at `:539` or `:563`. That world has no migration runner, no step records, no backup, and no guards. Prefer the system DB unless the data is genuinely per-user brain state.
2. **Write the step at `incremental.rs:4789`**, immediately before `run_incremental`'s `Ok(())` — not at the end of the file.
   ```rust
   run_step(conn, IncrementalMigration {
       id: "persona_executions.foo",                 // "<table>.<column>" or "<table>"; 124 exist, all distinct
       description: "Human sentence — this is what shows in the boot log",
       already_applied: |conn| has_column(conn, "persona_executions", "foo"),
       apply: |conn| { ddl_step(conn, "ALTER TABLE persona_executions ADD COLUMN foo TEXT;")?; Ok(()) },
   })?;
   ```
   For a new table: `already_applied: |conn| has_table(conn, "foo")`, and put the `CREATE TABLE IF NOT EXISTS` **plus every `CREATE INDEX`** in one `ddl_step` batch so they commit together.
3. **Spell the table names right, and check them.** SQLite validates none of them: `ALTER TABLE nonexistent` only errors at run time (and only if you propagate), and `REFERENCES nonexistent(id)` **succeeds at CREATE and fails on the first INSERT** — verified empirically. The real names are `persona_executions`, `persona_credentials`, `persona_healing_issues`, `persona_prompt_versions` — **not** `executions`, `credentials`, `healing_issues`, `persona_versions`. All four short forms are live bugs in this repo (Deviations).
4. **Join the cross-cutting registries.** A new table is a member of none of these by default, and **18 of ~20 degrade silently**:

   | Register in | File:line | What breaks if you skip it |
   |---|---|---|
   | `table_to_event` | `db/src/cdc.rs:211-251` | No live UI update on write |
   | wake-sync `matches!` | `db/src/cdc.rs:359-362` | Writes don't nudge the cloud loop |
   | `JOURNAL_TABLES` | `db/src/journal.rs:55-65` | No undo / before-images |
   | `ORPHAN_TABLES` | `db/src/lib.rs:448-461` | Rows survive their parent persona |
   | sync-watermark indexes | `incremental.rs:7827-7840` | Every sync pass full-scans it |
   | `SYNC_TABLES` + `sync!` + `rows::fetch_*` | `src/cloud/sync/mod.rs:57-69`, `:307-323`, `rows.rs` | Never syncs (3 parallel lists, index-coupled) |
   | `PERSONA_SCOPED_TABLES` | `src/cloud/sync/mod.rs:341-349` | Cloud rows orphaned on persona delete |
   | fk-hygiene rebuild | `db/src/migrations/fk_hygiene.rs:16-26` | No CASCADE → orphans |
   | `DELETES` (project children) | `src/commands/core/data_portability.rs:6851-6878` | Stale rows survive a `replace` import |
   | `TWIN_CHILD_TABLES` | `…/data_portability.rs:7724-7732` | Same, for twins |
   | fresh-schema assert list | `incremental.rs:8558-8629` | Your migration can silently not run |

   If the table is deliberately out of a list, say so in a comment — `data_portability.rs:7721-7723` (excluding `twin_voice_profiles` as dead) is the model.
5. **Model → repo → command → UI, in that order.** `core/src/models/<x>.rs` (+ **both** the `mod x;` and `pub use x::*;` lines in `core/src/models/mod.rs`) → `db/src/repos/<group>/<x>.rs` (+ `pub mod x;` in the group `mod.rs`) → `src/commands/<feature>/<x>.rs` → **hand-add every command to the `invoke_handler` list in `src-tauri/src/lib.rs:1805+`** (1,585 entries, fully manual) → `src/api/<group>/<x>.ts`.
6. **Regenerate both codegen artifacts.**
   - `node scripts/generate-command-names.mjs` → `src/lib/commandNames.generated.ts`. Skip it and `invokeWithTimeout` rejects your command name at compile time; CI fails at `ci.yml:283-291`.
   - `cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings` → `src/lib/bindings/`. **`--workspace` and `--features desktop` are both load-bearing** and both are missing from the form in `.claude/CLAUDE.md:67`/`:116` and `.claude/conventions.json:63` — use the CI form (`ci.yml:363`). Commit the result; `ci.yml:365-372` diffs it.
7. **Write the test as an assertion on a fresh chain.**
   ```rust
   #[test] fn foo_exists_on_fresh_schema() {
       let pool = init_test_db().unwrap();
       let conn = pool.get().unwrap();
       conn.query_row("SELECT COUNT(*) FROM foo", [], |r| r.get::<_,i64>(0))
           .expect("foo must exist on a fresh schema");
   }
   ```
   `sla.rs:1540` is the canonical instance, and its doc comment (`:1534-1538`) states the property this proves: that the step is in `run_incremental` and not in the `ensure_composite_fires_table` tail. **Also add your table to the allowlist at `incremental.rs:8558`** — that test is the only mechanical coverage that exists, and it only covers names typed into it by hand.
8. **Stop.** No `PRAGMA user_version` bump (there is none), no ledger row (there is none), no entry in `schema.rs`, no second copy of the DDL anywhere.

## Anti-patterns

- **Appending to the end of `incremental.rs`.** The file's execution order is *inverted* against its text: `run_incremental` is lines 163–4791 and runs **second**; `ensure_composite_fires_table` is lines 4794–7480 and runs **first**, called from `initial.rs:286`. Sixteen comments in the file warn about this (`:2528`, `:3939`, `:3985`, `:4021`, `:4080`, `:4126`, `:4346`, `:4414`, `:4480`, `:4531`, `:4732`, `:6127`, `:6537`, `:8323`, plus the two definitions). Sixteen warnings is not a convention — it is a design defect with a documentation patch over it. It looks like a legitimate third home partly because `mod.rs:12` advertises it as "*plugin tables (pub for engine use)*" — **there is no engine caller**; the only call site in the tree is `initial.rs:286`. It should be `pub(super)` and its body folded into `run_incremental`.
- **`let _ = ddl_step(…)` / `ddl_step(…).ok()` / `let _ = conn.execute_batch(…)`** — the single largest defect generator here. It absorbs the "duplicate column name" you expect *and every other error with it*, so a migration that wrote nothing reports success. **145 of the 338 `ALTER … ADD COLUMN` statements in the whole chain (43%) discard their `Result`**: 98 of 291 in `incremental.rs`, **all 21** in `initial.rs`, **all 26** in the user database. Three of them have been provably dead since the day they shipped. The regression test at `:8470` (`a_genuinely_failed_guarded_alter_is_no_longer_swallowed`) exists precisely because of this — it fixed six sites, and **73 remain** (41 `let _ = ddl_step`, 32 `.ok()`).
- **`already_applied: |_conn| Ok(false)`** — declares "always run me" while the comment above it (`:3314-3316`) says *"rely on `run_step`'s id-tracking to run once."* **`run_step` has no id-tracking.** There is no ledger, no `PRAGMA user_version`, no `schema_migrations` table anywhere in `src-tauri/` (verified: zero occurrences). Both such steps replay their full data migration on every boot.
- **Putting a new table in `schema.rs`** — it is the fresh-install-only path. Existing installs never see it, so the two populations diverge. (`schema.rs` also still hosts 79 tables' worth of first-creation DDL; leave it alone, don't grow it.)
- **Mirroring the same DDL into two homes** — e.g. `dev_tasks.depth` (`:4957`) is in both the fresh schema and an incremental `ALTER`, which is why it needs `.ok()`, which is why a real failure there is invisible. One home, one statement.
- **Naming a helper for the first thing you put in it.** `research_lab_align_columns` (`:7629-8078`) now contains **11 tables that have nothing to do with the research lab** — `team_channel_messages`, `obsidian_revitalize_runs`, `scheduled_retries`, `memory_nodes`, `memory_edges`, `dev_project_env_connectors`, `workspace_practice_context_state`, `workspace_pattern_edges`, `workspace_playbooks`, `workspace_playbook_patterns`, `workspace_consult_log` — plus the 12-table cloud-sync watermark loop. The whole Project Memory Ledger and the whole Workspace Knowledge schema live inside a function whose name says it aligns research columns, and which swallows all 68 of its own ALTERs by design (`:7626-7628`).
- **`REFERENCES <table>` without checking the table exists.** SQLite resolves FK targets lazily. `CREATE TABLE` succeeds; the first `INSERT` under `foreign_keys = ON` (which `STANDARD_PRAGMAS`, `db/src/lib.rs:201`, sets on every pool acquire) raises `no such table: main.<parent>`. **`PRAGMA foreign_key_check` does not catch this on an empty table** — verified empirically — which is why the idempotency test's FK assertion (`:8435-8442`) passes over a live instance of the bug.
- **Hand-writing the column list in a table rebuild.** `widen_kpi_measurement_source_with_ai_compose` (`:8079`) documents why: a hand-written list silently DROPS any column a later migration added. Recreate from `sqlite_master.sql` like `:107-138` does.
- **Skipping the registries because "it's just an internal table."** Six real features are broken today by exactly this (Deviations → missing registrations).
- **Trusting `docs`/`CLAUDE.md` for the binding command.** Three separate documents give a form that regenerates nothing for `personas-core` types, which is where all row models live.

## Evidence

**Adoption:** 282 distinct tables/views across two databases — 238 in `personas.db` (79 first created in `schema.rs`, 23 in `initial.rs`, 136 in `incremental.rs`), 44 in `personas_data.db`. 124 recorded `run_step` migrations, all with unique ids.

- **`incremental.rs:3903-3946` band and the `sla_daily` step (`:3947`)** — a textbook `run_step`: unique id, `has_table` guard, single `ddl_step` batch carrying table + indexes, paired with a fresh-schema test.
- **`db/src/repos/communication/sla.rs:1540` — copy this test.** Three lines, proves both existence and correct phase placement, and its doc comment explains the failure it prevents.
- **`incremental.rs:104-159`** — `rebuild_executions_table_with_incomplete_status`. The reference rebuild: FK guard, DDL read from `sqlite_master`, index/trigger replay, FTS rebuild, bail-out when the DDL isn't the expected shape (`:130-134`) instead of silently building the old constraint.
- **`incremental.rs:687-710`** — the exemplary legacy-table ALTER: probe `sqlite_master` for the table, then probe `pragma_table_info` for the column, then a propagating `ddl_step`. Guards for both "fresh DB never had it" and "already applied".
- **`incremental.rs:2090-2100`** — the model comment for *why* a guard beats a swallow, written at the site that was converted.
- **`incremental.rs:65-74`** — `report_failed_group_id_drop`: the middle path when a failure genuinely must not abort boot. Log at `error!` with the table name; never `let _ =`.
- **`db/src/lib.rs:1978`** — `init_db_second_launch_reopens_and_preserves_data`: runs the real `init_db` twice on one data dir and asserts session-1 data survives. The upgrade-on-boot regression test.
- **`incremental.rs:8413`** — `migration_chain_is_idempotent_on_rerun`: replays the chain **three** times (the third catches guards that survive exactly one replay), then `integrity_check`.
- **`data_portability.rs:7721-7723`** — how to document a deliberate registry exclusion.
- **`core/src/models/deliberation.rs:19-22` → `db/src/repos/resources/deliberation.rs:52` → `src/commands/teams/deliberations.rs:52-59` → `src/lib.rs:2580` → `src/api/pipeline/teamDeliberations.ts:28` — the exemplary end-to-end chain.** Copy this one for the layers above the DDL.

## Deviations found

### P0 — shipped, user-facing, provably dead

| Path | What's wrong |
|---|---|
| `incremental.rs:4885-4886` | `mcp_gateway_members` declares `FOREIGN KEY … REFERENCES credentials(id)`. **There is no `credentials` table** (it is `persona_credentials`). `CREATE TABLE` succeeded, so it shipped. With `foreign_keys = ON`, `add_member`'s `INSERT` (`db/src/repos/resources/mcp_gateways.rs:62`) raises `no such table: main.credentials` — **every time**. The whole chain `GatewayMembersModal.tsx:132` → `api/credentials/mcpGateways.ts:53` → `commands/credentials/mcp_gateways.rs:20` → repo is a feature that has never once worked. Reads (`list_members`) work, so the UI shows an empty gateway and errors on add. |
| `incremental.rs:4903-4905` | `ALTER TABLE executions ADD COLUMN pending_auth_url / …_started_at / …_credential_id`. **There is no `executions` table** (it is `persona_executions`). All three are swallowed by `let _ = ddl_step(conn, stmt)` at `:4907`. Three columns that have never existed on any install, ever. |
| `db/src/lib.rs:460` | `ORPHAN_TABLES` contains `persona_versions`. No such table — it is `persona_prompt_versions`. The startup orphan sweep skips it and logs at `tracing::debug!` (`:478`), i.e. invisibly. 1 of 12 entries dead. |
| `db/src/cdc.rs:235, :244` | `table_to_event` maps `healing_issues` and `audit_log`. Neither exists (`persona_healing_issues`; and there is no `audit_log` at all — the seven real audit tables are `credential_audit_log`, `tool_execution_audit_log`, `settings_audit_log`, `provider_audit_log`, `healing_audit_log`, `api_key_audit`, `cli_session_read_audit`). **2 of 12 live-update events have never fired.** |
| `db/src/repos/execution/audit_incidents.rs:81` **and `:531`** | `CONTINUABLE_SOURCE_TABLES` contains `persona_blocker` — not a table but a synthetic `source_table` token written by `src/engine/dispatch.rs:742`. The same two values are hardcoded a second time inline in SQL at `:531`; a third continuable source needs both edited. |
| `src/commands/core/data_portability.rs:162` | `ATHENA_FORBIDDEN_NAMES` lists `athena_audit` — no such table. The real one, `athena_wake_log`, is already listed at `:170`, so the privacy assertion is one entry weaker than it reads. |

### Missing registrations — real tables absent from a list that should cover them (all silent)

| List | Missing | Consequence |
|---|---|---|
| `db/src/repos/lab/mod.rs:172-177` | `lab_consensus_runs` | An interrupted consensus run stays `status='generating'` forever. Doc comment at `:159` still says "the four `lab_*_runs` tables". |
| `db/src/repos/lab/mod.rs:117-141` | `lab_consensus_runs` | Live consensus progress never re-hydrates after a reload. |
| `incremental.rs:5322-5327` | `lab_consensus_results` | It has no `eval_method` column at all — the loop that adds it covers 4 of 5 result tables, under `let _ = ddl_step`. |
| `src/cloud/sync/mod.rs:341-349` | `synced_triggers` | Trigger rows orphaned in the cloud forever after a persona delete. In `SYNC_TABLES` but not in `PERSONA_SCOPED_TABLES`. |
| `db/src/cdc.rs:359-362` | 7 of the 11 synced tables | Writes to them never nudge the sync loop; they wait for the periodic tick. |
| `data_portability.rs:6851-6878` | `dev_project_env_connectors` | Stale env-connector rows survive a `replace` import — and it is not in the declared-exclusions comment either. |
| `fk_hygiene.rs:13` | — | Doc says "the 8 orphan-prone tables"; `run()` at `:16-26` calls **9**. The list already rotted. |

### Structural — the mechanism itself

- **No applied-migrations ledger and no `PRAGMA user_version`** — zero occurrences in `src-tauri/`. Consequences, each verified: (a) `run_step`'s `id` is decorative, read only by the log line at `:19`; (b) the comment at `:3314-3316` asserting id-tracking is false; (c) the two `already_applied: |_conn| Ok(false)` steps (`:3317` `groups_to_teams_data_migration`, `:3408` `retire_persona_groups`) replay their full data migration every boot; (d) `backup.rs:15-20` documents the absence as the reason it copies the entire database **on every launch**; (e) boot cost grows linearly with every migration ever shipped — 4,628 + 2,686 lines of schema re-probing per launch.
- **216 of 378 `ddl_step` calls in `incremental.rs` sit outside any `run_step`** — no id, no description, no declared guard. Idempotency for those rests on `IF NOT EXISTS` in the SQL (fine for CREATE) or on nothing (not fine for ALTER).
- **`incremental.rs` is 9,061 lines and hosts two functions that execute in reverse textual order.** See Anti-patterns. This is the proximate cause of both P0 phantom-table bugs: they sit at `:4885` and `:4903`, i.e. right at the top of the `ensure_composite_fires_table` tail — exactly where "append to the end" used to land.
- **`research_lab_align_columns` (`:7629-8078`)** — 11 unrelated tables plus 68 swallowed ALTERs behind a misleading name. See Anti-patterns.
- **`incremental.rs:7841`, `:7854`, `:7870`** — the sync-watermark index loop and the entire `memory_nodes`/`memory_edges` schema are created with `let _ = ddl_step`. A failure to create the Project Memory Ledger is indistinguishable from success.
- **`initial.rs` swallows 100% of its ALTERs** — all 21 `ALTER … ADD COLUMN` statements run under one of 13 `let _ = conn.execute_batch(…)` calls (`:14-32`, the `for col in &[…]` loop at `:92-100`, `:126`, `:163`, `:282`, `:295`, `:337`, `:400`), each with the comment `// ignore "duplicate column" error on re-run`. `initial::run` executes **before** `run_incremental`, so a phantom name here is the earliest and quietest possible failure.
- **`src/cloud/sync/mod.rs:307-323`** — `SYNC_TABLES` and the `sync!(N, rows::fetch_*)` dispatch are coupled by **hardcoded numeric index**. Reordering `SYNC_TABLES` silently pairs the wrong fetch function with the wrong remote table and cursor. The only guard (`:518-528`) asserts the *length* is 11, never the pairing.

### The user database (`personas_data.db`) — an unguarded parallel world

- **No migration runner.** `db/src/lib.rs:529-534` and `:557-562` say so explicitly.
- **All 26 `ALTER … ADD COLUMN` statements** (4 at `:539-546`, 16 at `:563-618`, plus the mirrored set in `init_test_user_db` at `:1946-1958`) apply through `let _ = conn.execute_batch(stmt)`. **Zero guards, zero propagation, 100% swallowed.** A forgotten or typo'd ALTER surfaces only as a runtime "no such column".
- **No pre-migration backup.** `backup_before_migrations` is called for `personas.db` only (`db/src/lib.rs:296`). The database holding the entire Athena brain and every knowledge base is mutated on every launch with no snapshot.
- No step ids, no descriptions, no boot log, no `run_step` equivalent.

## Gaps in the primitive

1. **SQLite cannot `ALTER` a CHECK, an FK, a `NOT NULL`, or drop an indexed/FK-constrained column.** Real, not laziness — it forces the create-copy-drop-rename rebuild at `incremental.rs:104` and `fk_hygiene.rs:117`. Consequence in this repo: `personas.group_id` is permanently dead-but-present (`:3396-3401`) because rebuilding the central `personas` table was judged too risky.
2. **`run_step` records nothing.** The `IncrementalMigration` struct has an `id` field and no table to write it to. This is upstream of at least five deviations: the false comment at `:3314`, both `Ok(false)` steps, the every-boot full-database backup, and the linear boot cost. A four-column `schema_migrations(id, applied_at, checksum, duration_ms)` table written inside `run_step`'s existing transaction boundary would close all five and cost one `INSERT` per step.
3. **The user database has no migration primitive at all.** Not a gap in `run_step` — a gap in coverage. `run_incremental` takes a `&Connection` and would work verbatim against the user pool; nothing but wiring is missing.
4. **`ddl_step` gives atomicity but not verification.** It commits or rolls back; it never checks that the statement affected the object it named. A `ddl_step_verified(conn, sql, expect: &[SchemaExpectation])` that re-probes after commit would have failed loudly on all three `executions` ALTERs.
5. **`has_table` / `has_column` guard the *migration*, never the *reference*.** Nothing validates a table name appearing inside a `REFERENCES`, an `INSERT INTO`, or a hardcoded registry list. All 10 phantom names in the Deviations section are instances of this one gap.
6. **`PRAGMA foreign_key_check` is structurally blind to a missing parent table on an empty child table** — verified empirically: it returns 0 rows, and only reports the violation once the child has rows, which for `mcp_gateway_members` can never happen. The idempotency test at `:8435-8442` therefore asserts a property it cannot fail.
7. **No `SCHEMA.md`, no generated schema snapshot, no ERD.** 282 tables and the only way to learn the shape is to read 15,285 lines of Rust across six files. There is no `docs/architecture/*` entry for the database at all.
8. **The registries are unrelatable.** Twelve hand-maintained lists with no shared type, no shared source, and no way to ask "which lists should this table be in?" `SYNC_TABLES` mixes remote and local names; `CONTINUABLE_SOURCE_TABLES` mixes table names with synthetic tokens; `ORPHAN_TABLES` is keyed on a column (`persona_id`) that some entries may not have.
9. **CI does not run the migration tests.** `ci.yml:258` is `cargo test --manifest-path src-tauri/Cargo.toml --features desktop` — **no `--workspace`**. The repo's own comment 90 lines below (`:351-358`) states the rule: *"`--manifest-path` alone selects only `personas-desktop`."* Every migration test — the fresh-schema allowlist, the three-replay idempotency test, the non-swallowing regression test, both `sla_*_exists_on_fresh_schema`, and the 369 `init_test_db()` call sites in `db/src/` — lives in `personas-db` and **never runs in CI**. The lesson was learned once, for the binding-drift job, and not carried across.
10. **Zero static gates.** `npm run check` covers TypeScript, ESLint, command contracts, tiers and Tauri configs. `lefthook.yml` covers ESLint, secrets and i18n. Neither touches the schema. Every deviation above shipped green.

## The missing gate

Two of the ten phantom names sit in DDL, five sit in Rust registry lists, and three are missing entries. No runtime test can catch the DDL ones — the FK is lazy, the ALTERs are swallowed, and the child table is always empty. **The gate must be static, and it must fail loudly when it can't find its own inputs.**

**Signal.** Every table name in this codebase appears as a string literal in one of a small number of syntactic positions, and the *set of real tables* is mechanically derivable from `CREATE (VIRTUAL )?TABLE (IF NOT EXISTS )?<name>` across six known files. That makes a set-difference the whole check. Three independent difference sets:

- **A. Dangling DDL references.** Table names in `ALTER TABLE <n>`, `REFERENCES <n>(`, `CREATE INDEX … ON <n>`, `CREATE TRIGGER … ON <n>`, `INSERT INTO <n>`, `UPDATE <n> SET`, `DELETE FROM <n>`, `DROP TABLE <n>` inside `db/src/migrations/*.rs` and `db/src/lib.rs`, minus the created set, scoped per database. Verified against the tree today: **exactly 5 true positives** (`executions` ×3, `credentials` ×2) and **1 legitimate exception** (`persona_groups`, correctly `sqlite_master`-guarded at `:687-700`) — a signal-to-noise ratio of 5:1 with a one-entry allowlist.
- **B. Dangling registry entries.** String literals inside the twelve enumerated lists (each identified by file + const/fn name, not by pattern-guessing), minus the created set. **5 true positives today** (`persona_versions`, `healing_issues`, `audit_log`, `persona_blocker`, `athena_audit`), 2 of which need allowlisting as intentional (`persona_blocker` is a synthetic token; `SYNC_TABLES`/`PERSONA_SCOPED_TABLES` hold remote names — allowlist those two lists wholesale as `namespace: remote`).
- **C. Dangling FK targets at runtime**, as the belt to A's braces — a one-query assertion that catches anything the parser misses, including DDL built by `format!`:
  ```sql
  SELECT m.name AS child, fk."table" AS parent
  FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) fk
  WHERE m.type = 'table'
    AND fk."table" NOT IN (SELECT name FROM sqlite_master WHERE type = 'table');
  ```
  Verified: returns the `credentials` row on an **empty** database, where `PRAGMA foreign_key_check` returns nothing.

**Mechanism.** Two artifacts, modelled on `scripts/check-event-registry.mjs` — the repo's own precedent for a static two-source parity check.

1. **`scripts/check-schema-refs.mjs`**, wired into `npm run check:contracts` (which already runs `check-command-contract.mjs && check-event-registry.mjs`) and into CI's `frontend-checks` job — deliberately **not** the Rust job, so it runs on every PR without a cargo build. Implements A and B, prints `path:line  <name>  (did you mean <closest-real-name>?)`, exits 1.
2. **A Rust test in `personas-db`** implementing C, appended to `migration_chain_is_idempotent_on_rerun` (`:8413`) where the empty post-chain database already exists — **plus fixing `ci.yml:258` to add `--workspace`.** The test is worth nothing until that flag lands; C without the flag is a fourth gate that runs nowhere.

**Allowlist**, in `scripts/schema-refs.allow.json`, each entry requiring a `reason`:
- `persona_groups` — legacy table, every reference `sqlite_master`-guarded (`incremental.rs:687`, `:3324`, `:3465`).
- `persona_skills`, `skill_components`, `skills` — retired 2026-07-17; the guarded drop at `:4095` and the two tests at `:8991`/`:9030` reference them *because* they must not exist.
- `src/cloud/sync/mod.rs` `SYNC_TABLES` + `PERSONA_SCOPED_TABLES` — remote Supabase namespace, not local.
- `audit_incidents.rs` `CONTINUABLE_SOURCE_TABLES` `persona_blocker` — synthetic `source_table` token. **And rename the const to `CONTINUABLE_SOURCES`**, since the current name is what made this look like a bug.

**How it fails loudly when its own precondition is absent.** This is the part `ci.yml` has repeatedly gotten wrong — a commit-lint dying on a bad ref, a `cargo test` aborting pre-compile, a secret scan exiting 0 without gitleaks. So the script asserts its inputs before it asserts anything about the tree, and **exits 1 on every one**:

- Each of the six DDL source files must exist and parse to a non-empty CREATE set. If `incremental.rs` yields zero tables, the regex has rotted against a refactor → **fail**, never "0 problems found".
- The created-table count is asserted against a **committed floor** (`>= 238` system, `>= 44` user, updated when tables are added). A parser that silently starts matching fewer names would otherwise turn every real table into a false positive *and* every phantom into a pass — the count is what distinguishes "the tree is clean" from "the parser is broken".
- Each of the twelve registry lists is located by an **exact anchor** (file + const name + expected entry count, all committed). A missing or renamed anchor → **fail with the anchor name**, so deleting `ORPHAN_TABLES` cannot quietly reduce coverage. Count drift → fail with old/new, forcing the author to acknowledge it.
- Empty allowlist entries, or allowlist entries that no longer match anything, → **fail** (stale suppression is how allowlists become the bug).
- The final line prints the audited totals in the shape `Schema refs OK (<N> tables, <M> registries, <R> references checked, <A> allowlisted)` — so a human reading a green CI log can see it checked something, and a collapsing count is visible in the diff of a build log. A gate whose success output is silence is a gate nobody notices going hollow.

The Rust half (C) fails loudly by construction: `init_test_db()` propagates, so a broken chain fails the test rather than skipping it. Its own precondition — that it runs at all — is exactly what the `--workspace` fix restores, and that fix is the highest-leverage single line in this document: it re-activates 369 existing test call sites that are currently dark.
