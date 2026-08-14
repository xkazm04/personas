# Golden path — Upsert

> Situation node: `data-persistence/repository-access/upsert` ·
> [situation spine](../situation-spine.md) · recurrence **106** · convergence `mixed` · risk medium ·
> dimensions **function · code-quality** · sides **server** (not two-sided).
> Composed 2026-08-14 from a ground-truth sweep against `master`.
>
> **Sweep size.** All **963 `.rs` files under `src-tauri/`** (exactly `rust.files` in
> [`shared-facts.json`](../shared-facts.json); `target/` and `.claude/worktrees/` excluded) parsed with
> a Rust string-literal extractor that handles raw strings, escapes and comments, then split into
> **779 `INSERT` statements**, of which **143 carry conflict handling**. Every one was classified by
> form, target table, conflict target, whether its affected-row count is bound, and whether it returns
> the row. Joined against a balanced-paren DDL parse of **306 `CREATE TABLE` names** (396 statements),
> **585 `CREATE INDEX`** and every `FOREIGN KEY … ON DELETE` clause in the tree. `INSERT OR IGNORE`
> and `ON CONFLICT` counts were reconciled **exactly** against a second, independent implementation
> (the census regex, §9) — 71 and 71.
>
> **Part of this path is measured against RUNNING SOFTWARE, not source.** The operator's live
> `personas.db` (347 MB, **241 tables**) and `personas_data.db` (**67 tables**) were copied and opened
> read-only to confirm the real foreign-key graph, and **every claim below about what SQLite actually
> does was executed** against `node:sqlite` rather than inferred from documentation. Per the
> [model-effort guide](../../development/model-effort-guide.md), *a gate that asserts data is not a
> gate on behaviour* — so the behaviour was observed. **No `cargo` was run.**
>
> **A convergence sweep** ran read-only against `brainiac` (Rust · sqlx · Postgres — the strong
> oracle), `personas-cloud` (TS · better-sqlite3) and `vibeman` (TS · better-sqlite3). It **cleared
> this brief's headline hypothesis in all three siblings as well as here**, independently reinvented
> three of this path's clauses, and found the repo's most-cited merge idiom has **zero trace
> anywhere**. Every load-bearing sibling quote was re-opened and re-read by hand (§6).
>
> The **Deviations** section is a fix backlog.

## ⚠ Correction to the brief — the numbers, and the headline

**Every count I was handed is a raw `grep` line count with comments included, and the arithmetic
reconciles exactly once you exclude prose.**

| Handed to me | Measured (statement-level) | The difference |
|---|---:|---|
| `ON CONFLICT DO UPDATE` — 68 | **67** | 1 Rust comment (`credential_recipes.rs:59`) |
| `ON CONFLICT DO NOTHING` — 7 | **5** | 2 Rust comments (`executions.rs:564`, `exposure.rs:134`) |
| `ON CONFLICT` with **no target** — 2 | **0** | the *same two comment lines*, counted a second time |
| `INSERT OR IGNORE` — 94 | **68** | 25 Rust comment lines + 1 `--` SQL comment inside a literal |
| `INSERT OR REPLACE` — 7 | **3** | 4 Rust comment lines |
| **total ~178** | **143** | |

One more grep artefact worth naming, because it will bite the next sweep: a case-insensitive
`ON\s+CONFLICT` matches the word **"versi*on conflict*"**, which is why `src/engine/webhook.rs`
appeared in the census and contains no upsert at all.

**And the headline hypothesis is disproven.** The brief predicted that some of the
`INSERT OR REPLACE` sites would sit on a table that is the target of an `ON DELETE CASCADE` foreign
key, and asked for a P0 if so. **They do not — none of the three, in either live database.**

- `dev_auto_runs`, `companion_active_connector` and `credential_fields` have **zero** FK children:
  verified three ways — `grep -rn "REFERENCES (dev_auto_runs|companion_active_connector|credential_fields)"`
  returns nothing; the DDL parse finds no child; and `PRAGMA foreign_key_list` over all **308** live
  tables in both shipped databases finds no child either.
- The mechanism is nonetheless **real and armed**: `PRAGMA foreign_keys = ON` is set on every pooled
  connection (`db/src/lib.rs:201` `STANDARD_PRAGMAS`), the live schema carries **158 `ON DELETE
  CASCADE` foreign keys across 52 distinct parent tables**, and the cascade fires exactly as feared —
  §6 shows it emptying a child table in a live SQLite session.
- **The convergence sweep cleared it in all three siblings too**: zero REPLACE-semantics writes land
  on a cascading-FK parent in `brainiac` (which has no `REPLACE` at all — Postgres has no such
  statement), `personas-cloud` (zero) or `vibeman` (3 `INSERT OR REPLACE`, all on leaf/cache tables,
  confirmed by grep for `REFERENCES` at each).

So: **four codebases, zero instances.** That is a cleared claim, and it is worth as much as a
confirmed one — but the correct conclusion is *not* "`INSERT OR REPLACE` is fine here". §6 shows two
**other** losses it causes with no foreign key involved at all, one of which is live at
`data_portability.rs:9471`.

**What the brief asked third — "does any upsert silently discard the caller's data because the
conflict target does not match a real unique index?" — has a structural answer: no, and it cannot.**
All **72** targeted conflict clauses resolve to a real uniqueness constraint (52 primary keys, 16
`UNIQUE` constraints, 1 unique index, 1 *partial* unique index). That is not discipline. SQLite
**rejects a mismatched conflict target when it prepares the statement** (§6), so the defect is
unshippable. That fact is the spine of this whole document.

## 1 Trigger

- "Save this if it's new, update it if it isn't" / "make this idempotent"
- "The importer ran twice and I got duplicates" — or the inverse, "the importer ran twice and the
  second run's values didn't land"
- "Two pollers raced and one blew up with a UNIQUE constraint error"
- "Should this be `INSERT OR IGNORE` or `ON CONFLICT`?"
- "I re-imported and it kept the old row" / "I re-imported and it wiped the linked rows"
- "The function is called `upsert_` — what does it return when it updated instead of inserting?"

If you are about to type `INSERT OR IGNORE`, `INSERT OR REPLACE`, `ON CONFLICT(`, `DO UPDATE SET`,
`DO NOTHING`, a `SELECT` whose only purpose is to decide between an `UPDATE` and an `INSERT`, or a
`match err { … ConstraintViolation => Ok(None) }` — you are in this situation.

### Scope — the seam, stated in prose, not re-litigated

[**repository-crud-surface**](./repository-crud-surface.md) drew the seam and it holds. That path owns
a repository function's **exterior** — its verb (`upsert_`), its handle (`pool: &DbPool`), its error
type (`AppError`), and what it returns. [**partial-update-semantics**](./partial-update-semantics.md)
owns how each field of a patch spells **leave-alone versus set-to-NULL**. Neither is re-argued here.

**This path owns the one statement in the middle: which SQL construction expresses "insert or
update", and which constraint it names.** The test is the same empirical one `repository-crud-surface`
used, and it survives: `db/src/repos/resources/credential_recipes.rs:51` gets the exterior right
(`pub fn upsert(pool: &DbPool, …) -> Result<CredentialRecipe, AppError>`) *and* gets this path right
(`ON CONFLICT(connector_name) DO UPDATE … RETURNING *`), while `db/src/repos/execution/healing.rs:638`
`upsert_knowledge` has the identical correct exterior and, inside it, a racy `UPDATE`-then-`INSERT`
that no signature can express. The two decisions are independent, and each can be right while the
other is wrong.

The seam with `partial-update-semantics` is sharper still and worth stating precisely, because the
two paths' constructions look alike: that path decides **which columns move**; this one decides
**whether a second write happens at all**. `COALESCE(?1, col)` is theirs (leave-alone in an `UPDATE`);
`COALESCE(excluded.col, col)` is **mine** (merge-not-clobber inside a `DO UPDATE`). Same function,
different question — 97 sites of the first form, 6 of the second, and no site is both.

**Not this path:** whether the write reported that a row existed is
[repository-crud-surface](./repository-crud-surface.md). Whether the conflict target has an index at
all, and whether that index is the right one, is [index-design](./index-design.md) — this path
*consumes* its unique indexes. Whether the upsert lands atomically with the next write is
[transaction-boundary](./transaction-boundary.md). What a rejected write should say is
[typed-error-contract](./typed-error-contract.md). Where the column's nullability is decided is
[schema-change](./schema-change.md).

## 2 The one way

**Write one statement, and name the constraint you mean:
`INSERT INTO <table> (…) VALUES (…) ON CONFLICT(<the exact columns of the uniqueness constraint>) DO
UPDATE SET <only the columns that should move>` — or `DO NOTHING` when the intent is genuinely "skip
if present".** Never reach for `INSERT OR IGNORE` or `INSERT OR REPLACE`: both are statement-wide
conflict-resolution clauses that name *nothing*, so the database has nothing to check and applies
behaviours you did not ask for. `OR IGNORE` silently swallows `NOT NULL` and `CHECK` violations along
with the duplicate you meant to tolerate, and drops the row; `OR REPLACE` **deletes** the conflicting
row before inserting, which fires every `ON DELETE CASCADE` pointed at it, resets every column the
statement does not list to that column's `DEFAULT`, and re-keys the row if you mint a fresh id. The
targeted form has neither behaviour, and — the reason this is a prescription and not a preference —
**SQLite verifies it for you: a conflict target that is not a real `PRIMARY KEY`/`UNIQUE` constraint
fails when the statement is prepared** (§6). If the constraint is a *partial* unique index, repeat
its predicate in the clause (`ON CONFLICT(k) WHERE k IS NOT NULL`) or the statement will not prepare
at all. **In the `DO UPDATE SET` list, move only what should move**: omit `created_at` and the row's
id (all 67 sites correctly do), and guard any column a stub caller might blank with
`COALESCE(excluded.x, x)` / `NULLIF(excluded.x, '')`. **Then decide what the caller learns.** For
`DO UPDATE` the affected-row count is always 1 and carries no information, so return the row — add
`RETURNING *` and `query_row`, one round trip, no re-select. For `DO NOTHING` the count *is* the
signal: bind it, and turn 0 into whatever "already there" means for this caller (`Ok(None)`,
`AppError::Validation`, or a re-select of the winning row). **And do not hand-roll it**: a `SELECT`
that decides between an `UPDATE` and an `INSERT` is a lost race waiting to happen — three exist here,
none inside a transaction (§7).

### Which clauses are physics, which are this house

Per the [contract](../golden-path-contract.md) and the
[portability test](../research/portability-test.md), a clause travels only if something else
reinvented it. Measured 2026-08-14 against three siblings; detail and citations in §6.

| Clause | Warrant | Evidence |
|---|---|---|
| **Name the constraint: `ON CONFLICT(cols)` is the default form** | **physics — 3 of 3 siblings** | `brainiac` 30 statements, `vibeman` 9, `personas-cloud` 5. Every conflict target that could be checked *was* checked and matched (6/6 in brainiac, 5/5 in personas-cloud, 6/7 in vibeman) — because the engine enforces it |
| **`INSERT OR IGNORE` silently discards the caller's payload, and that is a bug when the caller meant to update** | **physics — independently rediscovered, in production, after a failure** | `vibeman/src/app/db/migrations/migration.utils.ts:228-233`, verbatim: *"Upsert to 'applied' rather than INSERT OR IGNORE: if a prior run left a status='failed' row for this name, OR IGNORE would no-op and leave it 'failed', so isMigrationApplied() returns false next boot and the migration re-runs — non-idempotent DDL (ADD COLUMN, table rebuild) then hard-fails."* A different team, a different language, the same conclusion, reached the expensive way |
| **A read-then-write upsert is a race and the fix is a unique constraint + `ON CONFLICT`** | **physics — and the sibling wrote the migration and forgot the call site** | `vibeman/src/app/db/migrations/138_file_watch_config_unique_project.ts:4-11`: *"upsertFileWatchConfig uses a check-then-act pattern (SELECT then INSERT/UPDATE) which can produce duplicate rows under concurrent access… Recreate the table with a UNIQUE constraint on project_id so that INSERT … ON CONFLICT(project_id) DO UPDATE can be used atomically."* The index shipped; the call site never migrated. Personas has the identical shape at `healing.rs:638` — over a `UNIQUE(service_type, pattern_key)` that already exists |
| **A partial unique index's predicate must be repeated in the conflict target** | **physics — 2 repos, 3 sites, 3 correct** | `brainiac` `governance.rs:58` and `divergence.rs:287` both repeat their index's `WHERE`; Personas' `executions.rs:547` repeats `WHERE idempotency_key IS NOT NULL`. Neither SQLite sibling has a partial unique index at all. **This is the one clause every repo that faced it got right, because the alternative does not run** |
| **A no-op-on-conflict's affected-row count is the signal and must be read** | **physics — and it is a convergent TRAP; Personas is the BEST of the four** | discarded in `brainiac` 10/15, `personas-cloud` 2/3, `vibeman` 8/10 — **20 of 28 (71%)**. Personas: **40 of 73 (55%)**. Three of four repos wrote the rationale down exactly once and then failed to propagate it (`brainiac/identities.rs:86`, `vibeman/context-group-relationship.repository.ts:82`, Personas `dev_memories.rs:78`) |
| **Return the row from the upsert (`RETURNING`) instead of re-selecting** | **physics as a defect — nobody does it, everybody pays** | `RETURNING` on an upsert: `brainiac` 2/30, `personas-cloud` 0/5, `vibeman` 0/12, **Personas 1/143**. All four then issue a separate `SELECT`. `vibeman/standup.repository.ts:144` even documents the round trip it is forced into. **Four codebases, 190 upserts, 3 that return the row** |
| **Merge, don't clobber: guard the `DO UPDATE SET` against a stub caller** | **weak — reinvented once, in a different spelling** | `brainiac/publishing.rs:125` `COALESCE(EXCLUDED.external_ref, document_publications.external_ref)`, and `brainiac/retrieval_events.rs:498` uses a `WHERE` on the `DO UPDATE`. But **`NULLIF(excluded.x, '')` has zero occurrences in any sibling**, and unguarded blanket clobber is the majority everywhere (brainiac 11/13, vibeman 6/8, Personas 61/67). Take the *idea* as doctrine and the *spelling* as local calibration |
| **`INSERT OR IGNORE` / `INSERT OR REPLACE` as a construction at all** | **a SQLite gravity well, not a Personas quirk — but it is not universal** | `vibeman` (the only other SQLite repo) reinvented both: 9 `OR IGNORE`, 3 `OR REPLACE`. `brainiac` has **zero, structurally** — Postgres has no such statement, so the entire defect class is unrepresentable there. **The absence in the Postgres sibling is the strongest argument in this document**: a whole family of silent failures simply does not exist in a dialect that forces you to name the constraint |
| **A written rule for which form to reach for** | **nobody has one — this document is the first** | 0 of 3 siblings. `brainiac`'s `CLAUDE.md`: zero matches for upsert / on conflict / idempoten. `vibeman`'s `CLAUDE.md` and `docs/DATABASE.md`: nothing. `personas-cloud`: nothing anywhere. What exists in all three is *post-mortem* prose filed where the next author will not look (`vibeman/docs/harness/…/FIXES-WAVE-6.md:29`). Personas matches them: **no entry in `.claude/conventions.json`** for `upsert`, `ON CONFLICT`, or `INSERT OR` |
| **A tri-state upsert outcome (inserted / updated / suppressed)** | **exists once in the world, and SQLite cannot express it** | `brainiac/retrieval_events.rs:499` `RETURNING (xmax = 0) AS inserted`, with the rationale at `:484-486`. `xmax` is a Postgres system column; **SQLite has no equivalent**, so no SQLite repo — including this one — can distinguish an insert from an update in one statement. See Gap 1 |

## 3 Mandated primitives

**Exist today — use them:**

- **`ON CONFLICT(<cols>) DO UPDATE SET …` — SQLite's own upsert, and the closest thing this leaf has
  to a type.** 67 statements. The conflict target is **checked against the schema when the statement
  is prepared** (§6), so a target that does not name a real uniqueness constraint cannot ship. There
  is no macro, no helper, and none is needed: the dialect is the primitive.
- **`ON CONFLICT(<cols>) DO NOTHING` + the bound affected-row count.** 5 statements. The only correct
  spelling of "skip if present" — it tolerates exactly the constraint you named and still rejects
  everything else.
- **`RETURNING *` with `conn.query_row(…, row_to_x)`.** Supported by the bundled SQLite; used on
  **30** statements tree-wide and on exactly **one** upsert
  (`db/src/repos/resources/credential_recipes.rs:63`). It is the whole answer to "what do I return
  from an upsert" and it costs one round trip fewer than the re-select every other site does.
- **`db/src/repos/resources/credential_recipes.rs:51-106` `upsert` — copy this whole function.**
  See §6. It is the only site in the tree where every clause of §2 holds at once.
- **`db/src/repos/lab/ratings.rs:31-57` `upsert_rating` — copy this when identity must survive.**
  A conflict target over an **expression** index (`COALESCE(result_id, '')`), a `DO UPDATE SET` of
  exactly two columns, and the comment that states the invariant: *"On conflict we preserve the
  original id and created_at; only rating/feedback move."*
- **`db/src/repos/execution/executions.rs:544-580` — copy this for idempotency under a race.**
  `DO NOTHING` against a **partial** unique index with the predicate repeated, `rows_changed` bound,
  and a re-select of the winner on 0. The comment block at `:530-537` is the best explanation of a
  conflict target in the repo.
- **`rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE`** — when you must catch the violation in Rust rather
  than resolve it in SQL, this is the only correct discriminator.
  `db/src/repos/dev_tools.rs:7419` is the one site that uses it; three others use
  `ErrorCode::ConstraintViolation`, which is the *primary* code shared by `NOT NULL`, `CHECK`,
  `FOREIGN KEY` and `UNIQUE` alike (§7).

**Do not exist — this path names them:**

- **A `crud_upsert!` macro.** `db/src/macros.rs` generates `crud_get_by_id!`, `crud_get_all!`,
  `crud_delete!`, `crud_update!` and `lab_crud!` — and **nothing for insert-or-update**, which is why
  all 143 of these statements are first-time authorings (§7, second pass).
- **Any way to learn whether an upsert inserted or updated.** SQLite reports 1 for both. `brainiac`
  gets it from Postgres' `xmax`; there is no SQLite analogue (Gap 1).
- **An entry in `.claude/conventions.json`.** Zero matches for `upsert`, `ON CONFLICT`, `INSERT OR`
  or `idempoten` — and that file is what a subagent reads
  ([`feedback_machine_readable_repo_gates`](../../../CLAUDE.md)).

## 4 Steps

1. **Find the uniqueness constraint you are conflicting on, and read it.**
   `grep -n "CREATE TABLE IF NOT EXISTS <table>" src-tauri/db/src/migrations/` and
   `grep -n "UNIQUE INDEX.*ON <table>" src-tauri/db/src/migrations/`. If there is no `PRIMARY KEY`,
   `UNIQUE(…)` or unique index covering the columns that define "the same row", **stop — you do not
   have an upsert, you have a race** ([index-design](./index-design.md) owns creating it, and
   `vibeman`'s migration 138 is the precedent for creating it *and then migrating the call site*).
2. **Ask the type-over-gate question here, before you write the statement.** Three of them:

   | Instead of | Write | What it removes permanently |
   |---|---|---|
   | `INSERT OR IGNORE INTO t (…)` | `INSERT INTO t (…) ON CONFLICT(<key>) DO NOTHING` | the swallowed `NOT NULL`/`CHECK` violation — the targeted form still raises those (verified, §6) — **and** the unverifiable intent, because SQLite checks the target and cannot check an `OR` clause |
   | `INSERT OR REPLACE INTO t (…)` | `INSERT INTO t (…) ON CONFLICT(<key>) DO UPDATE SET …` | the cascade delete, the reset of every unlisted column to its `DEFAULT`, and the re-keying of the row (all three verified, §6) |
   | `SELECT …; if exists { UPDATE } else { INSERT }` | one `ON CONFLICT` statement | the lost race, the second round trip, and ~40 lines |

   **This is the highest-leverage step in the document.** All 71 of §9's baseline skipped it.
3. **Write the conflict target as the constraint's exact column list**, in any order, and **repeat a
   partial index's `WHERE`** — `ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL`
   (`executions.rs:547`). If you get this wrong the statement does not prepare; that is the feature.
4. **Write the `DO UPDATE SET` list as the columns that should move, and nothing else.** Never
   `created_at`, never the id (0 of 67 sites break this — it is the one thing this repo converged on).
   Prefer `excluded.<col>` (40 sites) over re-binding `?N` (12 sites): `excluded` cannot drift from
   the `VALUES` list when someone adds a column.
5. **Guard any column a partial caller could blank.** If two different code paths write this row and
   one of them knows less, `COALESCE(excluded.x, x)` for a nullable column and
   `COALESCE(NULLIF(excluded.x, ''), x)` for a text one. `credential_recipes.rs:75-89` is the shape,
   and its comment names each column's failure mode. Only **6 of 67** sites do this today.
6. **Decide what the caller learns, and make the return type carry it.**
   `DO UPDATE` → `RETURNING *` + `query_row` → `Result<Entity, AppError>`.
   `DO NOTHING` → bind the count → `Result<Option<Entity>, AppError>` (`dev_memories.rs:94-98` is
   four lines) or `AppError::Validation` when a duplicate is a user error (`exposure.rs:153-157`).
   **Do not return `Result<(), AppError>`** — 11 of 28 `upsert_*` functions do, and a caller cannot
   tell what happened.
7. **If you must catch the violation in Rust instead**, match on
   `err.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE` (`dev_tools.rs:7419`), never on
   `ErrorCode::ConstraintViolation` — that primary code is 19 for every constraint class
   (`SQLITE_CONSTRAINT_UNIQUE` 2067, `_NOTNULL` 1299, `_CHECK` 275, `_FOREIGNKEY` 787 all reduce to
   19), so the imprecise match reports a `NOT NULL` bug as a duplicate.
8. **Write the test that fails today, and name it after both halves.**
   `db/src/repos/resources/owned_devices.rs:520` `register_is_idempotent_and_updates_name` is the
   model: it asserts the row is not duplicated **and** that the new values landed. A test that only
   asserts `len() == 1` passes for `INSERT OR IGNORE` too, which is exactly how
   `mcp_gateways.rs:233` misses a live bug in the function it covers (§7). Put it where it runs:
   `npm run test:rust` passes `--lib` against the root manifest, so use `npm run test:rust:crates`
   for `personas-db`.
9. **Stop.** One statement. No pre-check `SELECT` "for clarity" — `slack_poller.rs:1093`
   `message_already_logged` is a `SELECT COUNT(*)` that reads as if it were the guarantee, sitting
   next to an `INSERT OR IGNORE` that already provides one.

## 5 Anti-patterns

- **`INSERT OR REPLACE` — 3 sites, and it is three different losses at once.** It is `DELETE` +
  `INSERT`, not `UPDATE`. Verified in a live SQLite session (§6): it emptied a cascading child table,
  it reset a column the statement did not list back to its `DEFAULT`, and it re-keyed the row.
  `src/commands/core/data_portability.rs:9471` is the live instance — it supplies a **freshly minted
  UUID** as `id` while the real conflict is on `UNIQUE(credential_id, field_key)`, so re-importing a
  credential bundle changes each field row's primary key and resets its `created_at` to now
  (42 such rows exist in the live database).
- **`INSERT OR IGNORE` as a synonym for "upsert" — 68 sites.** It never updates. When the caller
  meant to save new values, they are discarded and nothing says so. `db/src/repos/twin.rs:860` is
  literally named `upsert_contacts_from_communications` and cannot update anything — correctly, as
  its comment explains, but the name says otherwise. **The far worse property is that `OR IGNORE` is
  not scoped to the conflict you meant**: it swallows `NOT NULL` and `CHECK` violations too
  (verified, §6), where the same statement written `ON CONFLICT(<key>) DO NOTHING` still raises them.
  **64 of the 68 sites target a table with a `NOT NULL`-without-`DEFAULT` or `CHECK` column**, so 64
  can silently drop a malformed row and report success.
- **Returning a minted id from a statement that may not have inserted.**
  `db/src/repos/resources/mcp_gateways.rs:48` `add_member` runs `INSERT OR IGNORE`, discards the
  count, and returns `Ok(id)` — **an id that is not in the database** when the pair already existed.
  The IPC command `add_mcp_gateway_member` hands that straight to the frontend. Its own doc comment
  promises idempotency and its own test asserts the row count is 1 while `.unwrap()`-ing the return
  value away. This is the insert-path twin of
  [repository-crud-surface](./repository-crud-surface.md)'s `blind-identity-write`.
- **A `SELECT` that decides between `UPDATE` and `INSERT` — 3 functions, 0 in a transaction.**
  `execution/healing.rs:638` `upsert_knowledge` (`UPDATE`, then `INSERT` if 0 rows) over a table that
  **already has `UNIQUE(service_type, pattern_key)`** — so the lost race does not merely duplicate,
  it surfaces to the user as `Database error: UNIQUE constraint failed`. `lab/evolution.rs:30`
  `upsert_policy` and `engine/src/scraper.rs:195` `upsert_record` have the same shape.
  All three collapse to one `ON CONFLICT` statement; `healing.rs`'s is 45 lines that become 8.
- **Catching `ErrorCode::ConstraintViolation` — 3 sites, and the repo knows better.**
  `dev_tools.rs:4049` (`create_idea_deduped` → `Ok(None)`), `dev_workspaces.rs:3000` (→ *"A playbook
  with slug '…' already exists"*), `build_sessions.rs:2036`. That code is 19 for **every** constraint
  class, so a `NOT NULL` bug is reported as a duplicate — or, at `dev_tools.rs:4049`, as a successful
  no-op and the idea vanishes. `dev_tools.rs:7419` in the same file matches
  `extended_code == SQLITE_CONSTRAINT_UNIQUE` and is correct.
- **Blanket clobber in `DO UPDATE SET` — 61 of 67 sites carry no merge guard.** Every column set from
  `excluded.*` unconditionally. It is only a bug when two callers write the same row with different
  knowledge, but when it is, it is silent. `credential_recipes.rs:71-89` is the counter-example, and
  its comment is the incident report: *"The negotiator caches a STUB on session start … Its ON
  CONFLICT update must not wipe a richer, verified Design recipe."*
- **Discarding the count on a `DO NOTHING` / `OR IGNORE` — 40 of 73.** For `DO UPDATE` the count is
  always 1 and means nothing; for these two it is the only way to know whether the row was new. Note
  honestly: a good share of the 40 are legitimate "ensure this row exists" seeds
  (`companion/proactive/budget.rs:200`, whose comment says exactly that). The defect is the subset
  where the caller then behaves as though the insert happened — `add_member` above, and
  `skill_usage.rs:459`, which increments `events_added` from a statement that returns 0 for a
  duplicate row and for a `CHECK`-rejected row alike.
- **Two mechanisms in one file — 8 files.** `src/engine/slack_poller.rs` writes its cursor twice with
  `ON CONFLICT(persona_id, channel_id) DO UPDATE` (`:1068`, `:1081`) and then logs the message with
  `INSERT OR IGNORE` (`:1114`), 30 lines apart. `src/commands/infrastructure/skill_usage.rs` has all
  three forms inside one function body (`:459`, `:474`, `:489`). A reader cannot learn the convention
  from the file, because the file holds two.
- **`INSERT OR REPLACE` in a comment above an `ON CONFLICT` statement.**
  `db/src/repos/execution/knowledge.rs:91` reads *"// Use INSERT OR REPLACE with computed running
  averages"* above a statement that is `ON CONFLICT(persona_id, knowledge_type, pattern_key) DO
  UPDATE`. The code is right and the comment recommends the dangerous form to the next reader.

## 6 Evidence

**Distribution — all 143 conflict-handling `INSERT` statements in `src-tauri/**.rs`.**

| Form | Statements | Distinct tables | Files | Count bound |
|---|---:|---:|---:|---:|
| `ON CONFLICT(<cols>) DO UPDATE` | **67** | 45 | — | 8 |
| `INSERT OR IGNORE` | **68** | 46 | — | 29 |
| `ON CONFLICT(<cols>) DO NOTHING` | **5** | 5 | — | 4 |
| `INSERT OR REPLACE` | **3** | 3 | — | 0 |
| `ON CONFLICT` with **no** conflict target | **0** | — | — | — |
| bare `REPLACE INTO` | **0** | — | — | — |
| **total** | **143** | 92 | **83** | 41 |

Plus **636 plain `INSERT`s** with no conflict handling (779 `INSERT` statements in all), **3**
read-then-write upserts, and **4** Rust-level catch-the-violation sites.

Conflict-target provenance, all **72** targeted clauses: **52** resolve to the `PRIMARY KEY`, **16**
to a table-level or column-level `UNIQUE`, **1** to a `CREATE UNIQUE INDEX`, **1** to a *partial*
unique index (`idx_pe_idempotency`, predicate correctly repeated). **Zero mismatches** — see the
behavioural note below for why that number could not have been anything else. One target is an
**expression** (`ratings.rs:41`, `COALESCE(result_id, '')`).

`DO UPDATE SET` shape across the 67: **40** use `excluded.<col>`, **12** re-bind `?N`, **6** use a
`COALESCE`/`NULLIF` merge guard, **0** carry a `WHERE` on the `DO UPDATE`, and **0** set
`created_at`. `RETURNING` appears on **1** of the 143.

`pub fn upsert*`: **28** in `db/src/repos/`, 33 tree-wide. Return types: **11 `Result<(), AppError>`**,
9 a concrete struct, 2 `usize`, the rest mixed — the three-way split
[repository-crud-surface](./repository-crud-surface.md) §7 measured from its side, confirmed.

### Verified against a running SQLite — every claim in §2, executed

Run 2026-08-14 through `node:sqlite` against a schema built to mirror this repo's shapes. **These are
observations, not readings of the documentation.**

| Statement | Result |
|---|---|
| `INSERT OR REPLACE INTO parent(id,label) VALUES('p1','v2')` with a child `REFERENCES parent(id) ON DELETE CASCADE` and `PRAGMA foreign_keys = ON` | **child rows 1 → 0**, and `note` reset from `'important'` to its `DEFAULT 'kept'` |
| the same conflict via `ON CONFLICT(id) DO UPDATE SET label=excluded.label` | **child rows stay 1**, `note` stays `'important'` |
| `INSERT OR REPLACE` on a `UNIQUE(cred,fkey)` with a fresh `id` | row rewritten `id-A` → **`id-B`**, `created_at` `2020-01-01` → `2026-01-01` |
| `INSERT OR IGNORE`, duplicate PK / `NOT NULL` violation / `CHECK` violation | **OK, changes=0** for **all three** — the two malformed rows silently vanish |
| `INSERT OR IGNORE`, `FOREIGN KEY` violation | **ERR** `FOREIGN KEY constraint failed` (SQLite's conflict clauses do not apply to FK constraints) |
| the same three via `ON CONFLICT(id) DO NOTHING` | duplicate → **OK, changes=0**; `NOT NULL` → **ERR `NOT NULL constraint failed`**; `CHECK` → **ERR `CHECK constraint failed`** |
| `ON CONFLICT(payload)` where `payload` is not unique | **ERR** `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint` — *at prepare time* |
| `ON CONFLICT(nope)` | **ERR** `no such column: nope` |
| `ON CONFLICT(k)` against a **partial** `UNIQUE INDEX … WHERE k IS NOT NULL`, predicate omitted | **ERR** `…does not match any PRIMARY KEY or UNIQUE constraint` |
| the same with `ON CONFLICT(k) WHERE k IS NOT NULL` | **OK** |

Two conclusions follow, and they are the reason this document prescribes rather than suggests:
**`ON CONFLICT(cols) DO NOTHING` is strictly narrower than `INSERT OR IGNORE`** — it tolerates the
duplicate you named and still rejects everything else — and **the targeted form is machine-checked
while the `OR` clause is not.** §6's "72 of 72 conflict targets match a real constraint" is not
evidence of care; it is evidence that the alternative cannot ship.

### The live databases

`personas.db` (347 MB, **241 tables**) and `personas_data.db` (**67 tables**), copied and opened
read-only. **172 + 10 = 182 foreign keys, of which 149 + 9 = 158 carry `ON DELETE CASCADE`, across
48 + 4 = 52 distinct parent tables.** (The source-tree parse counts 174 cascading FKs over 55
parents across 306 declared tables; the gap is tables the migration chain declares that this
particular installation has not materialised. Both are honest; the live figure is the authority for
what can actually fire.) `PRAGMA foreign_key_list` over all 308 live tables confirms **no FK child
for any of the three `INSERT OR REPLACE` targets**. `credential_fields` holds **42** rows, so the
re-keying defect above is live-reachable, not theoretical.

### The sites to copy

- **`db/src/repos/resources/credential_recipes.rs:51-106` `upsert` — the reference implementation.**
  Every clause of §2 in one function: a targeted conflict on a real `UNIQUE`
  (`ON CONFLICT(connector_name)`), a `DO UPDATE SET` that moves exactly what should move, per-column
  merge guards with the reason for each written out, `RETURNING *` so the row comes back in one round
  trip, and `Result<CredentialRecipe, AppError>`. The guard block is the argument:
  ```sql
  -- MERGE, never clobber. The negotiator caches a STUB on session start (empty
  -- instructions/summary, and often a NULL healthcheck_json / oauth_type …).
  -- Its ON CONFLICT update must not wipe a richer, verified Design recipe.
  --   * healthcheck_json NULL  → verification would be silently skipped
  --   * oauth_type NULL        → an OAuth recipe demoted to plain fields
  --   * fields_json empty      → configured fields lost
  oauth_type       = COALESCE(excluded.oauth_type, oauth_type),
  fields_json      = COALESCE(NULLIF(excluded.fields_json, ''), fields_json),
  source = CASE WHEN NULLIF(excluded.setup_instructions,'') IS NOT NULL
                  OR NULLIF(excluded.summary,'') IS NOT NULL
                THEN excluded.source ELSE source END,
  ```
  One blemish, named so nobody copies it: `:100` maps `QueryReturnedNoRows` to
  `AppError::Internal("Failed to upsert credential recipe")`. With `RETURNING *` on an upsert that
  row always exists, so the arm is unreachable — but it reads as if absence were possible.
- **`db/src/repos/lab/ratings.rs:31-57` `upsert_rating` — the identity-preserving shape.**
  `ON CONFLICT(run_id, scenario_name, COALESCE(result_id, ''))` over a UNIQUE **expression** index,
  `DO UPDATE SET rating = excluded.rating, feedback = excluded.feedback`, and the invariant stated in
  a comment: *"On conflict we preserve the original id and created_at; only rating/feedback move."*
  This is the exact property `INSERT OR REPLACE` destroys.
- **`db/src/repos/execution/executions.rs:544-580` — the idempotency shape.** `DO NOTHING` against
  the partial `idx_pe_idempotency` with `WHERE idempotency_key IS NOT NULL` repeated, `rows_changed`
  bound, and `if rows_changed == 0 { … get_by_idempotency_key … }` returning the winner's row so a
  double-delivered webhook is transparently idempotent. Its comment block explains why a NULL key can
  never conflict.
- **`db/src/repos/dev_memories.rs:78-101` `record` — the four lines that make `DO NOTHING` honest.**
  `let affected = conn.execute(…)?; if affected == 0 { return Ok(None); }` and a return type of
  `Result<Option<DevMemory>, AppError>`. (It uses `INSERT OR IGNORE`, so it is in §9's baseline; the
  *outcome handling* is nonetheless the model.)
- **`db/src/repos/resources/owned_devices.rs:520` `register_is_idempotent_and_updates_name`** — the
  test name to copy, because it asserts both halves.

### Convergence — what three sibling repos did without reading this

Run 2026-08-14, read-only. Every load-bearing quote below was re-opened and re-read by hand
afterwards; all three verified verbatim and are marked ✓.

- **✓ The hypothesis is cleared everywhere, which makes the clearing worth something.** Zero
  REPLACE-semantics writes land on a cascading-FK parent in any of the four codebases. `brainiac`
  cannot have the defect (Postgres has no `INSERT OR REPLACE`); `personas-cloud` has zero such
  statements at all; `vibeman`'s three (`goal_signal_summaries`, `insight_effectiveness_cache`,
  `optimizer_cache`) are all leaf/cache tables with no FK pointing at them, and its one genuine
  table-rebuild-on-a-cascade-parent (`migrations/143_fix_ideas_effort_constraint.ts`) issues
  `PRAGMA foreign_keys = OFF` **before** `BEGIN TRANSACTION`, which is the correct order — the pragma
  is a no-op inside a transaction. **Four repos, zero instances. Report it as cleared.**
- **✓ …and `brainiac` shows the delete-then-insert hazard is real in a different costume.**
  `practice_divergences` was once rebuilt by delete-all-then-insert, and `standard_provenance.ref_id`
  (`migrations/0028_library_substrate.sql:79`) points at those ids **with no declared FK** — so
  nothing cascaded, and the references silently dangled instead.
  `migrations/0042_divergence_identity.sql:11-13` records the damage: *"Every already-ratified
  standard's `standard_provenance` row pointed at an id that no longer existed — the provenance trail
  from a rule back to the evidence that justified it was dangling."* **A cascade is not the only way
  a replace loses data; it is only the loud way.**
- **✓ `vibeman` rediscovered §2's `INSERT OR IGNORE` prohibition after a production failure.**
  `src/app/db/migrations/migration.utils.ts:228-233`, read by hand: *"Upsert to 'applied' rather than
  INSERT OR IGNORE: if a prior run left a status='failed' row for this name, OR IGNORE would no-op
  and leave it 'failed', so isMigrationApplied() returns false next boot and the migration re-runs —
  non-idempotent DDL (ADD COLUMN, table rebuild) then hard-fails."* The fix is the exact statement
  §2 prescribes. **This is the single strongest warrant in the document**, because it is the same
  conclusion reached independently, in another language, by paying for it.
- **✓ `vibeman` also built the fix for the read-then-write race and forgot to apply it.**
  `migrations/138_file_watch_config_unique_project.ts:4-11`, read by hand, names the check-then-act
  pattern, names the duplicate-rows consequence, and ships a `UNIQUE` constraint *"so that
  INSERT … ON CONFLICT(project_id) DO UPDATE can be used atomically."* The call site
  (`fileWatch.repository.ts:36-97`) still does `SELECT` then `UPDATE`-or-`INSERT`. **Personas is in
  the identical position at `healing.rs:638`, over a `UNIQUE(service_type, pattern_key)` that already
  exists** — so the migration half of the work is already done here too.
- **✓ `brainiac` has the sharpest "when NOT to upsert" rule anywhere**, and it is a security
  argument. `crates/brainiac-store/src/memories.rs:42-47`, read by hand: *"Plain INSERT —
  deliberately NO `ON CONFLICT`: under RLS, an ON CONFLICT arbiter makes Postgres additionally apply
  the SELECT policy to the new row, so a principal writing a memory for a team it does not belong to
  (the pipeline case) fails with an RLS violation even though the INSERT policy allows it.
  Idempotency is the caller's job."* Personas has no RLS and therefore no analogue — but the *form*
  of the rule (a documented refusal, at the call site, naming the mechanism) is what this repo is
  missing at all 143 of its sites.
- **The count-discarding trap is convergent, and Personas is the least bad.** Discarded at a
  no-op-on-conflict site: `brainiac` 10/15, `personas-cloud` 2/3, `vibeman` 8/10 — **20 of 28
  (71%)**; Personas **40 of 73 (55%)**. Three of the four wrote the rationale exactly once and did
  not propagate it: `brainiac/identities.rs:86` (*"ON CONFLICT DO NOTHING + rows_affected is the race
  guard: two first sign-ins … both reach here, and the PK lets exactly one win"*),
  `vibeman/context-group-relationship.repository.ts:82`, Personas `dev_memories.rs:78`. In `vibeman`
  the failure to propagate is measurable: `goal-dependency.repository.ts:30` and
  `idea-dependency.repository.ts:40` discard `changes` and then `SELECT … WHERE id = ?`, returning
  `undefined` from a function typed to return a row.
- **The `RETURNING` gap is universal.** Upserts that return the row: `brainiac` 2/30,
  `personas-cloud` 0/5, `vibeman` 0/12, **Personas 1/143**. **3 of 190.** All four then pay for a
  separate `SELECT`; `vibeman/standup.repository.ts:144` documents the round trip it believes it
  needs (*"On conflict the original id is kept; fetch by the natural key to handle both paths"*) —
  which `RETURNING *` would have answered in the same statement.
- **The merge guard is nearly absent everywhere, so take the idea and not the spelling.** Unguarded
  `DO UPDATE`: `brainiac` 11/13, `vibeman` 6/8, `personas-cloud` 1/2 (its other is a *tenancy* guard,
  `db.ts:515`, whose rejection is unobservable because the caller never checks `changes`). Exactly
  one sibling site uses `COALESCE(EXCLUDED.x, x)` (`brainiac/publishing.rs:125`) and **`NULLIF` has
  zero occurrences in any sibling**. Personas' 6 guarded sites are the most in the sweep, and
  `credential_recipes.rs`'s `NULLIF(excluded.x, '')` is **local calibration** — mark it as a house
  refinement of a doctrine-grade idea.
- **The tri-state outcome exists once in the world and SQLite cannot have it.**
  `brainiac/crates/brainiac-store/src/retrieval_events.rs:499` `RETURNING (xmax = 0) AS inserted`,
  with `:484-486`: *"`xmax = 0` is Postgres' idiom for 'this upsert INSERTed'; the `status = 'open'`
  guard makes a conflict on a terminal row return no row at all, which is the third outcome
  (suppressed)."* There is no `xmax` in SQLite. See Gap 1.
- **Nobody has a standing rule. This document is the first in the set.** `brainiac`'s `CLAUDE.md`:
  zero matches for upsert / on conflict / idempoten. `vibeman`'s `CLAUDE.md` and `docs/DATABASE.md`:
  nothing. `personas-cloud`: nothing anywhere. The only prescriptive prose in existence is filed in
  post-mortems (`vibeman/docs/harness/bug-test-2026-06-19/FIXES-WAVE-6.md:29`) and code comments.
  Personas matches them exactly: **no `.claude/conventions.json` entry**.
- **Tests: Personas is the best-covered of the four, and it is still thin.** Files containing an
  upsert that also carry an idempotency/dedup test: **25 of 83**, 40 tests. `brainiac` 6 (against a
  real Postgres, and its `rescan_preserves_divergence_identity_and_provenance` is the direct
  upsert-vs-clobber assertion), `vibeman` 2, **`personas-cloud` 0 — it has exactly one test file in
  the entire repository.** Nobody in any repo tests a *concurrent* insert.

## 7 Deviations found

### P0 — shipped, user-visible

| Path | Defect |
|---|---|
| `db/src/repos/resources/mcp_gateways.rs:48` `add_member` | `INSERT OR IGNORE INTO mcp_gateway_members (…)` then `Ok(id)` — **returns the freshly minted UUID unconditionally**, so adding an existing gateway member hands the IPC caller (`src/commands/credentials/mcp_gateways.rs:45`, a `#[requires(privileged)]` command) an id that is **not in the database**. The new `display_name` and `sort_order` are silently discarded too, so "rename a gateway member" via this path does nothing. Its doc comment promises idempotency; its test (`:233 add_member_is_idempotent_on_the_same_pair`) asserts `list_members().len() == 1` and `.unwrap()`s the return value away, so the phantom is untested. |
| `src/commands/core/data_portability.rs:9471` | `INSERT OR REPLACE INTO credential_fields (id, credential_id, field_key, …)` with `id = Uuid::new_v4()` and `created_at = ?8` (now), while the real conflict is `UNIQUE(credential_id, field_key)`. Re-importing a credential bundle therefore **deletes each existing field row and re-inserts it under a new primary key with a reset `created_at`** — verified as a mechanism in §6 (`id-A` → `id-B`), and live-reachable against the 42 rows in the operator's database. `ON CONFLICT(credential_id, field_key) DO UPDATE SET encrypted_value = excluded.encrypted_value, iv = excluded.iv, …, updated_at = ?8` preserves both. |
| `db/src/repos/execution/healing.rs:638` `upsert_knowledge` | `UPDATE … WHERE service_type = ?4 AND pattern_key = ?5`, then `INSERT` when 0 rows changed — **outside any transaction**, on a table that carries `UNIQUE(service_type, pattern_key)`. Two healing events for the same pattern race, both see 0, both insert, and the loser surfaces to the user as `Database error: UNIQUE constraint failed`. 45 lines that are one `ON CONFLICT(service_type, pattern_key) DO UPDATE SET occurrence_count = occurrence_count + 1, …`. Same shape at `db/src/repos/lab/evolution.rs:30` `upsert_policy` and `engine/src/scraper.rs:195` `upsert_record`. |
| `db/src/repos/dev_tools.rs:4049` `is_dedup_unique_violation` | Matches `e.code == rusqlite::ErrorCode::ConstraintViolation`, the **primary** code shared by `UNIQUE` (2067), `NOT NULL` (1299), `CHECK` (275) and `FOREIGN KEY` (787) — all of which reduce to 19. `create_idea_deduped` therefore reports a genuine `NOT NULL`/`CHECK` failure as `Ok(None)` — "already deduped" — and the idea is silently lost. The correct discriminator is used **in the same file** at `:7419`: `err.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE`. Same imprecision at `db/src/repos/dev_workspaces.rs:3000` (a `NOT NULL` failure is reported to the user as *"A playbook with slug '…' already exists"*) and `src/commands/design/build_sessions.rs:2036`. |

### P1 — silent, latent, or wrong-by-luck

- **64 of the 68 `INSERT OR IGNORE` sites target a table with a `NOT NULL`-without-`DEFAULT` or
  `CHECK` column**, so any of them can drop a malformed row and report success. Two with named
  consequences: `src/commands/infrastructure/skill_usage.rs:459` writes `skill_usage_events`, whose
  `event` and `source` columns carry `CHECK` constraints, and increments `summary.events_added` from
  a count that is 0 for a duplicate and for a rejected row alike; `src/engine/slack_poller.rs:1114`
  writes `slack_inbound_messages` (`NOT NULL` on `persona_id` and `credential_id`) and a message
  missing either is dropped while the poller reports success.
- **`INSERT OR IGNORE` carrying an `updated_at` column — 19 sites.** A column whose only purpose is
  to record a modification, on a statement that can never modify. It is not by itself proof of intent
  (the column is often `NOT NULL` and must be supplied on insert), which is why §9 does not key on
  it — but it is where to look first when auditing whether a site meant `DO UPDATE`.
- **Eight files hold both constructions.** `db/src/repos/dev_workspaces.rs` (5 legacy at
  `:497,:914,:1772,:1926,:2425` vs 5 targeted at `:1083,:1199,:1272,:2759,:2868`),
  `db/src/repos/dev_tools.rs` (3 vs 3), `src/commands/infrastructure/skill_usage.rs` (2 vs 1, all
  within 30 lines), `db/src/repos/orchestration/assignment_outcomes.rs`, `db/src/repos/twin.rs`,
  `src/companion/projects.rs`, `src/engine/discord_poller.rs`, `src/engine/slack_poller.rs`.
- **A redundant pre-check `SELECT` that reads as the guarantee.**
  `src/engine/slack_poller.rs:1093` `message_already_logged` runs `SELECT COUNT(*) FROM
  slack_inbound_messages WHERE channel_id = ?1 AND message_ts = ?2` next to an `INSERT OR IGNORE` on
  the same composite primary key. The atomic guarantee is already in the statement; the `SELECT` is a
  round trip that only makes the race window visible. `credential_recipes.rs:59` documents having
  removed exactly this — *"a pre-check SELECT was redundant — removed to save a DB roundtrip"* — and
  is the precedent.
- **`db/src/repos/twin.rs:860` `upsert_contacts_from_communications`** is named `upsert_` and is an
  `INSERT OR IGNORE … SELECT` that can never update. The behaviour is correct and its comment says
  why (*"without overwriting any user-edited alias/notes"*); the **name** is the deviation, and
  `insert_missing_contacts_from_communications` would say it.
- **`db/src/repos/execution/knowledge.rs:91`** — a comment recommending `INSERT OR REPLACE` above a
  correct `ON CONFLICT` statement. The next author reads the comment.

### Structural

- **11 of 28 `upsert_*` functions in `db/src/repos/` return `Result<(), AppError>`** — the caller
  learns nothing, not even whether the row existed. 9 return the entity (correct), 2 return `usize`.
- **1 of 143 upserts uses `RETURNING`.** Every other site that needs the row pays for a second
  `SELECT` — `healing.rs:668,:687`, `ratings.rs:47`, `evolution.rs:…`, and 40-odd more.
- **6 of 67 `DO UPDATE SET` lists carry a merge guard**; **0** carry a `WHERE` on the `DO UPDATE`,
  which is the other available way to make a conflict conditional (and the shape `ascent` and
  `brainiac` both use for compare-and-swap).
- **No `crud_upsert!`.** `db/src/macros.rs` has five CRUD generators and none for insert-or-update.
- **No `.claude/conventions.json` entry** for `upsert`, `ON CONFLICT`, or `INSERT OR` — zero matches.
  The rule exists nowhere in the repository except inside the statements that follow it.
- **25 of 83 upsert-bearing files carry an idempotency/dedup test** (40 tests). Best in the sweep,
  and still 58 files with an upsert and no assertion that it upserts. **Zero tests anywhere exercise
  a concurrent insert**, which is the failure mode three of this section's P0s share.

### Second pass — what is upstream of all of it

Re-reading the deviations together: four SQL forms, two Rust-level forms, 186-way return divergence,
eight files holding two answers, and one `RETURNING` in 143 statements are not 143 independent
mistakes.

> **There is no upsert primitive, and the one construction that a machine *can* check is the one
> nobody was told to use.**

`db/src/macros.rs` generates the read, the list, the delete and the update — and stops. So "what
happens on conflict" is decided from scratch at every call site, and the decision has no artefact:
`INSERT OR IGNORE` records the author's intent nowhere, cannot be checked against the schema, and
compiles identically whether the author meant "skip duplicates", "tolerate a race" or "save these
values". `ON CONFLICT(<cols>)` records the intent **in the statement**, and SQLite refuses to prepare
it if the intent does not match the schema (§6). The tree is split almost exactly in half — **71
statements that the database can verify, 71 it cannot** — and the eight files that hold both are what
that split looks like from inside.

This is the same root cause [repository-crud-surface](./repository-crud-surface.md) §7 found ("there
is no repository primitive to adopt, there is a directory") and
[partial-update-semantics](./partial-update-semantics.md) found ("one chokepoint that owns the
predicate"), arriving from a third direction. The difference, and the reason *Prefer a type over a
gate* below is unusually cheap, is that **this leaf's primitive already exists — in the SQL dialect.**

## 8 Gaps in the primitive

1. **SQLite cannot tell you whether an upsert inserted or updated.** `execute()` returns 1 for both,
   and there is no `RETURNING`-visible discriminator — `brainiac` gets it from Postgres' `xmax`
   (`retrieval_events.rs:499`), which has no SQLite analogue. So a caller that must distinguish
   "created" from "refreshed" (an audit event, a "welcome" side effect, a counter) has to either
   `SELECT` first — reintroducing the race — or infer it from a sentinel column. **No repo in the
   sweep solved this on SQLite; two did not try.**
2. **`ON CONFLICT` cannot be used across two uniqueness constraints.** A table with both a primary
   key and a natural `UNIQUE` (e.g. `credential_fields`: `id` PK plus `UNIQUE(credential_id,
   field_key)`) can only name one conflict target per statement, so a caller that might collide on
   either has no single-statement answer. This is precisely why `data_portability.rs:9471` reached
   for `INSERT OR REPLACE` — it collides on the natural key while minting a new `id` — and why the
   fix has to also stop minting the id.
3. **There is no `crud_upsert!`, and writing one is harder than the other four.** The conflict
   target, the `SET` list, the merge guards and the `RETURNING` projection are all table-specific, so
   a macro would need a column list plus a conflict-key list plus a moves-on-conflict list — which is
   the same adoption-cost trap `crud_update!` fell into (2 invocations against 93 hand-written
   updates). A *lint* that routes authors to the right statement is cheaper than a generator that
   writes it, which is why §9 is a ratchet and not a factory.
4. **`rusqlite` surfaces the constraint class only through `extended_code`, and nothing points you
   there.** `ErrorCode::ConstraintViolation` is the ergonomic match, it is in the public prelude, and
   it is wrong for this purpose. The correct discriminator requires reaching into `rusqlite::ffi`.
   Three of four sites took the ergonomic path.
5. **A partial unique index's predicate must be duplicated by hand in every statement that targets
   it.** `executions.rs:547` repeats `WHERE idempotency_key IS NOT NULL` verbatim from
   `idx_pe_idempotency`. Nothing keeps the two in sync; changing the index silently breaks every
   statement that named it, and the breakage is a runtime prepare error rather than a compile error.
6. **Nothing relates a `DO UPDATE SET` list to the columns a caller actually knows.** The
   merge-vs-clobber decision depends on *which call paths write this row*, which is not expressible
   in the statement, the schema, or any type. `credential_recipes.rs`'s guards are correct because a
   human traced two callers; there is no instrument that would find the next such pair. **This is the
   highest-value unbuilt check in this document, and §9 refuses to approximate it.**
7. **No enforcement reaches `src-tauri/` for any of this.** `npm run check` is TypeScript + ESLint
   over `src/`; lefthook is eslint + secrets + i18n; `cargo clippy -D warnings` has no opinion about
   a conflict clause. Every deviation above shipped green.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md), answered explicitly before §9 is written.
**Yes — and unusually, the type already exists and costs nothing to adopt: it is the SQL dialect's
own targeted conflict clause.**

1. **`ON CONFLICT(<cols>)` *is* the type, and SQLite is the type-checker.** A conflict target that
   does not name a real `PRIMARY KEY`/`UNIQUE` constraint fails at prepare time with
   `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint` (verified, §6). That is
   why **72 of 72** targeted clauses in this tree resolve to a real constraint and why the brief's
   third question — "does any upsert silently discard the caller's data because the conflict target
   does not match a real unique index?" — is structurally answerable *no*. `INSERT OR IGNORE` and
   `INSERT OR REPLACE` name nothing, so nothing is checked, and the author's intent is recorded
   nowhere. **Migrating a statement from the `OR` clause to a named target moves it from "policed by
   a reviewer" to "checked by the engine on every run", which is the whole of this doctrine.** It is
   also the cheapest fix in any golden path so far: a per-statement edit with no new abstraction, no
   new file, and no migration of callers.
2. **The return type is the second type fix, and it is `repository-crud-surface`'s change seen from
   this side.** 11 of 28 `upsert_*` functions return `Result<(), AppError>`; `RETURNING *` +
   `query_row` makes `Result<Entity, AppError>` free, and a bound count makes
   `Result<Option<Entity>, AppError>` free for `DO NOTHING`. Neither needs a new primitive — 1 of 143
   sites has already done it. **Do not propose a `WriteOutcome` enum here**: SQLite physically cannot
   populate its third variant (Gap 1), and a type whose variants cannot be constructed is worse than
   the `Option`.
3. **A unique constraint is the type fix for the read-then-write race, and half of it already
   shipped.** `healing_knowledge` already carries `UNIQUE(service_type, pattern_key)`; the racy
   `SELECT`-then-branch at `healing.rs:638` simply predates it. `vibeman` is in the identical
   position and wrote the migration explaining exactly this (§6). **Where the constraint exists, the
   race is one statement from being impossible; where it does not,
   [index-design](./index-design.md) owns creating it.**
4. **Where a type cannot reach.** Whether a `DO UPDATE SET` should merge or clobber depends on which
   callers write the row (Gap 6) — no signature, constraint or dialect feature can express it, and
   §9 refuses to gate it for a reason it can show. Nor can any type say whether "skip if present" was
   what the author meant; that is the judgement §9's ratchet exists to keep from growing.

## 9 The missing gate

### The semantic condition, stated first

> **An insert-or-update declares *what to do* on conflict without declaring *which* conflict — so the
> store silently applies resolutions the author never asked for, and no machine can check that the
> author's intent matches the schema.**

Stack-free: every store that resolves write conflicts offers both a broad, unnamed resolution and a
targeted one keyed to a specific constraint, and only the targeted one can be verified. Per the
[portability test](../research/portability-test.md) the *proxy* below does **not** travel — an
adopting repo re-derives its own signal against its own dialect: a MySQL
`INSERT IGNORE`/`REPLACE INTO`, a Postgres `ON CONFLICT DO NOTHING` with the target omitted, a Prisma
`upsert` whose `where` is not a unique input, a Mongo `replaceOne` with `upsert: true`. **In Postgres
the condition is structurally unrepresentable** — there is no `INSERT OR IGNORE` — which is why
`brainiac` scores a hard zero against this pattern while having the condition's *consequences*
(§6, the dangling-provenance incident) all the same.

### Checked first: is this already gated?

All **44** rules in `scripts/census/rules.json` were read. **None keys on a conflict clause, an
`INSERT OR` prefix, or `ON CONFLICT` at all.** The five adjacent rules and why each misses:

- `blind-identity-write` (35/82, same subdomain, owner
  [repository-crud-surface](./repository-crud-surface.md)) — whether a PK-targeted write reported
  that the row **existed**. It explicitly **excludes `INSERT`/`ON CONFLICT`** ("an upsert can never
  affect zero rows"), so the insert path is negative space it deliberately left. This rule fills it.
- `nullable-default-column` (4/27) and `nullable-text-primary-key` (29/299) — **DDL** conditions
  about what a column may hold. Upstream: they decide what the constraint *is*; this decides which
  constraint a statement *names*.
- `boolean-column-index` (4/20, owner [index-design](./index-design.md)) — whether an index is worth
  having. Orthogonal: a perfect index does not stop `INSERT OR IGNORE` from ignoring it.
- `deferred-read-then-write` (10/12) — a `BEGIN`-not-`BEGIN IMMEDIATE` transaction whose first `tx`
  use is a `SELECT`. The nearest miss: it would catch a read-then-write upsert **that is in a
  transaction**, and all three of this repo's are not, so it scores zero against them.

**This condition is ungated.**

### The proxy, and what it keys on

An `INSERT` whose conflict resolution is SQLite's statement-wide `OR IGNORE` / `OR REPLACE` clause
(or a bare `REPLACE INTO`), rather than a targeted `ON CONFLICT(<cols>) DO UPDATE|NOTHING`.

**Precision comes from requiring `INTO <table>`, and that is the whole design.** The tree contains
**29 comment lines** discussing `INSERT OR IGNORE` / `INSERT OR REPLACE` in prose — *"Catalog rows
upsert like connectors (INSERT OR IGNORE + UPDATE-on-upgrade…)"*, *"// Use INSERT OR REPLACE with
computed running averages"*, *"-- The seed vocabulary. `INSERT OR IGNORE` keyed on the UNIQUE `tag`"*
— and **not one of them is followed by `INTO` and a table name**, so all 29 are excluded **by
construction**, not by the comment filter and not by an allowlist. This matters more than it looks:
`ignoreCommentLines` only skips `//`-prefixed lines, and one of the 29 is a `--` SQL comment *inside*
a string literal, which the filter cannot see. `commentMatchesSkipped: 0` — the filter is never
exercised, because it never needs to be.

**Shape of the match set:** **71 matches across 40 of 963 files** — 68 `INSERT OR IGNORE`, 3
`INSERT OR REPLACE`, 0 bare `REPLACE INTO`. Every match is a distinct `(file, line)` pair. The count
**reconciles exactly** with the independent string-literal + statement parser that produced §6's
143-statement classification — two implementations, one number, which is the only reason to trust
either.

**Stated honestly: not every match is a live bug, and the rule does not claim so.** `OR IGNORE` is a
defensible spelling of "ensure this row exists" — 11 of the 68 carry only key columns, and
`companion/proactive/budget.rs:200` says so in a comment. **This is a ratchet on an unverifiable
construction, not a bug count.** What makes the 71 migratable rather than noise is that every one has
an exact targeted equivalent that is *strictly narrower* and schema-checked: the fix is mechanical
and per-statement, which is precisely the property `partial-update-semantics` §9 refusal 3 found
missing when it declined to gate `COALESCE`.

**Precondition, stated so it can be checked before porting:** this repo speaks SQLite and writes its
SQL as Rust string literals, so both constructions are visible as text. A Postgres repo has no
`INSERT OR IGNORE` and scores a structural zero. A repo whose ORM emits the statement (Prisma
`upsert`, Drizzle `onConflictDoUpdate`) has the same decision in markup this pattern cannot see.

### Mechanism — a census rule, not a script

Per the [contract](../golden-path-contract.md) §"Don't write a script", the ratcheting-baseline
mechanism already exists at [`scripts/census/`](../../../scripts/census/). This path publishes **one**
entry, merged by the orchestrator — **never edited into `rules.json` here**:

```json
{"rules":[
  {
    "id": "unverifiable-conflict-clause",
    "goldenPath": "docs/concepts/golden-paths/upsert.md",
    "title": "An insert-or-update picks its conflict behaviour with a statement-wide INSERT OR IGNORE / INSERT OR REPLACE clause instead of naming the constraint it means to handle, so the database cannot check the author's intent",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "\\bINSERT\\s+OR\\s+(?:IGNORE|REPLACE)\\s+INTO\\s+[A-Za-z_]\\w*|\\bREPLACE\\s+INTO\\s+[A-Za-z_]\\w*",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "an INSERT that resolves conflicts with SQLite's statement-wide `OR IGNORE` / `OR REPLACE` clause (or a bare `REPLACE INTO`) rather than with a targeted `ON CONFLICT(<uniqueness key>) DO UPDATE|NOTHING`. PROXY FOR the stack-free condition: an insert-or-update declares WHAT TO DO on conflict without declaring WHICH conflict, so the store applies behaviours the author never asked for and no machine can check that the author's intent matches the schema. VERIFIED BEHAVIOURALLY against SQLite (node:sqlite, 2026-08-14), not inferred - each claim was run: (1) `INSERT OR IGNORE` silently swallows NOT NULL and CHECK violations as well as the uniqueness one (changes=0, no error, row gone), where the SAME statement written `ON CONFLICT(pk) DO NOTHING` dedups the duplicate but still RAISES `NOT NULL constraint failed` and `CHECK constraint failed` - the targeted form is strictly narrower; (2) `INSERT OR REPLACE` DELETEs the conflicting row before inserting, so with `PRAGMA foreign_keys = ON` (this repo's every pooled connection, db/src/lib.rs:201 STANDARD_PRAGMAS) it fires ON DELETE CASCADE and takes child rows with it (child count 1 -> 0), and it resets every column the statement does not list to that column's DEFAULT (`note` 'important' -> 'kept'), while `ON CONFLICT(id) DO UPDATE` preserved both; (3) `INSERT OR REPLACE` also churns identity - replacing on a UNIQUE(a,b) with a freshly minted primary key rewrote id-A to id-B and reset created_at, which is exactly the shape of src/commands/core/data_portability.rs:9471; (4) by contrast SQLite REJECTS `ON CONFLICT(<not-a-unique-key>)` at prepare time with `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`, which is why all 72 targeted conflict clauses in this tree resolve to a real uniqueness constraint - that is the engine checking, not the authors being careful. Measured 2026-08-14 at HEAD: 71 matches across 40 of 963 .rs files (68 `INSERT OR IGNORE`, 3 `INSERT OR REPLACE`, 0 bare `REPLACE INTO`), reconciled EXACTLY with an independent Rust string-literal + SQL-statement parser that classified all 143 conflict-handling INSERTs in src-tauri. commentMatchesSkipped 0 - and the `INTO\\s+<table>` requirement is what makes prose unmatchable, so the 29 comment lines in this tree that discuss `INSERT OR IGNORE` / `INSERT OR REPLACE` without an INTO are excluded BY CONSTRUCTION rather than by the comment filter or an allowlist. NOT EVERY MATCH IS A LIVE BUG and the rule does not claim so: `OR IGNORE` is a defensible spelling of \"ensure this row exists\" (11 of the 68 carry only key columns). It is a RATCHET on an unverifiable construction - every one of the 71 has an exact targeted equivalent that is strictly narrower and schema-checked, which is what makes them migratable rather than noise. Live consequences in this tree: db/src/repos/resources/mcp_gateways.rs:48 add_member runs `INSERT OR IGNORE` and then returns the freshly minted uuid unconditionally, so a duplicate add hands the IPC caller an id that is not in the database and silently drops the new display_name and sort_order; src/commands/infrastructure/skill_usage.rs:459 inserts into skill_usage_events, whose `event` and `source` columns carry CHECK constraints, and counts `events_added` from a statement that reports 0 for a rejected row and a duplicate row alike; src/engine/slack_poller.rs:1114 drops an inbound message whose NOT NULL persona_id/credential_id is missing and reports success. PRECONDITION (must be re-derived per repo): this repo speaks SQLite and writes its SQL as Rust string literals, so both the legacy and the targeted form are visible as text. Postgres has no `INSERT OR IGNORE`/`INSERT OR REPLACE` at all - the whole condition is unrepresentable there and this pattern scores a structural zero, as it does against brainiac. A repo whose ORM emits the statement (Prisma `upsert`, Drizzle `onConflictDoUpdate`) has the same decision wearing markup this pattern cannot see. LEGAL FIX: replace with `ON CONFLICT(<the exact columns of the uniqueness constraint>) DO NOTHING` when the intent is \"skip if present\", or `DO UPDATE SET <only the columns that should move>` when the intent is \"insert or update\" - db/src/repos/resources/credential_recipes.rs:63 is the shape to copy (targeted conflict, COALESCE/NULLIF merge guards so a stub cannot clobber a richer row, RETURNING * so the caller gets the row either way), and db/src/repos/lab/ratings.rs:39 is the shape for preserving id and created_at across a conflict. Do NOT silence a match by widening the uniqueness constraint or by dropping the conflict handling - that trades this condition for a duplicate-row condition."
    },
    "baseline": { "files": 40, "matches": 71 },
    "floor": 900
  }
]}
```

**Validated standalone before publishing** (`node scripts/census/run-census.mjs --rules
<scratch>/ups-final-rule-Zr9x.json --check`). Per the tooling note the pattern was written to a
**file** by a script and never passed through bash argv, where MSYS mangles backslashes:

```
  rule                    files   base  matches   base  walked  floor
  OK   unverifiable-conflict-clause     40     40       71     71     963    900

  census OK — 1 rule(s), 963 file-visits, 71 surviving violation(s) across 40 file(s).
```

`963 walked` is every `.rs` file under `src-tauri` and is exactly `rust.files` in
[`shared-facts.json`](../shared-facts.json). `floor: 900` matches the seven other rules rooted at
`src-tauri` (`deferred-read-then-write`, `silent-row-skip`, `nullable-default-column`,
`boolean-column-index`, `truncated-uuid-id`, `nullable-text-primary-key`, `hand-rolled-fixture-ddl`),
so no two rules over one root hold different opinions about whether that tree is intact. **Merged
with the live registry the run stays green at 45 rules / 119,879 file-visits / 7,622 surviving
violations, and this rule contributes ~1.4s** — no variable-length lookbehind, per the performance
note that cost a sibling path 73 seconds.

**Fault injection against the real tree**, because a gate that cannot fail is not a gate. Each row is
a single-field mutation of the validated rule, run with `--check`:

| Induced fault | Exit | Reported as |
|---|---|---|
| baseline, unmutated | **0** | — |
| matcher matches nothing (`pattern` → `ZZZ_NEVER_MATCHES_ZZZ`) | **1** | `[structural] matched zero files anywhere` |
| floor above the walk (`floor: 5000` on a 963-file root) | **1** | `THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (baseline claims 400 where 71 exist) | **1** | `[drift] matches dropped 400 -> 71` |
| count rises (baseline claims 40 where 71 exist) | **1** | `[drift] matches rose 40 -> 71` |
| file count rises (baseline claims 10 files where 40 exist) | **1** | `[drift] files rose 10 -> 40` |
| renamed root (`src-tauri` → `src-tauri-x`) | **1** | walked 0, below floor |
| extension no longer describes the tree (`.rs` → `.zzz`) | **1** | walked 0, below floor |
| stale `exclude` entry (a path matching no file) | **1** | `the exemption is stale` |
| **POSITIVE CONTROL — pattern inverted to the COMPLIANT form** | **1** | `[drift] files rose 40 -> 51` |

**The positive control, the two populations, and an honest coincidence.** Pointing the same rule at
the same root at the *correct* construction — `INSERT INTO <table> … ON CONFLICT(<cols>) [WHERE …]
DO UPDATE|NOTHING` — moves the counts to **71 matches across 51 files** and fails the run on the
`files` metric.

| | Violating (this rule) | Compliant (positive control) |
|---|---|---|
| matches | **71** | **71** |
| files | **40** | **51** |
| **match-level overlap** | \_\_ | **zero** |
| **file-level overlap** | \_\_ | **8 files** |
| top files | `data_portability.rs` (10), `db/src/lib.rs` (6), `incremental.rs` (5) | `dev_workspaces.rs` (5), `dev_tools.rs` (3), `exposure.rs` (3), `triggers.rs` (3) |

**The match counts being equal is a coincidence and I am reporting it rather than hiding it** — the
codebase happens to be split almost exactly in half between the two constructions. It weakens the
"differently sized populations" argument, so the discrimination rests on the two stronger facts:
**match-level overlap is zero** (no line is claimed by both patterns — the constructions are mutually
exclusive at the statement level, not merely at the token level), and the file distributions differ
(40 vs 51, with the violating population concentrated in importers and seeders and the compliant one
in the repository layer). A matcher keyed on "anything shaped like an INSERT" would have reported one
merged population of ~143 matches across ~83 files and proved nothing. **And the 8 overlapping files
are the finding in miniature**: `dev_workspaces.rs` holds five of each, `skill_usage.rs` holds both
inside one function body.

One disclosure about the control, not the rule: its `\([^)]{1,200}\)` conflict-target group cannot
cross a nested paren, so it misses `ratings.rs:39`'s `ON CONFLICT(run_id, scenario_name,
COALESCE(result_id, ''))` — 71 rather than the parser's 72. The control is a measuring instrument,
not a shipped gate, and the one it misses is the exemplar §3 tells you to copy.

**No `exclude` entries.** Every candidate exemption — prose, doc comments, SQL comments — is already
excluded by the pattern's own `INTO <table>` requirement, and a stale exemption is how an allowlist
becomes the bug.

### What this does NOT gate, and why — four refusals

1. **`INSERT OR IGNORE` that *meant* `DO UPDATE` (refused — not decidable, and this is the honest
   one).** This is the defect the brief asked about most directly, and it is the one a counter cannot
   see. `OR IGNORE` carrying a mutable payload is suspicious — **53 of 64** parseable statements do,
   and **19** carry an `updated_at` column, which is a column whose purpose contradicts the statement
   — but neither is proof: `updated_at` is frequently `NOT NULL` and must be supplied on the *insert*
   path, and a seed row legitimately carries its payload the first time. Deciding requires knowing
   what the caller believed, which is not in the statement, the schema, or any type (Gap 6). A rule
   flagging all 53 would be majority-noise against a baseline nobody could ratchet. **The rule above
   deliberately claims something weaker and true — that the construction is unverifiable — rather
   than something stronger and wrong.**
2. **Blanket clobber in `DO UPDATE SET` (refused — undecidable for the same reason, and the
   convergence sweep says so too).** 61 of 67 sites carry no merge guard, and whether that matters
   depends on whether two callers with different knowledge write the row. Every sibling is in the
   same state (brainiac 11/13, vibeman 6/8), and the one guarded Personas site got there by a human
   tracing two callers after an incident. **The instrument this needs is a call-graph question, and
   building it is worth more than approximating it with a count.**
3. **The blind affected-row count on a no-op-on-conflict (refused — already half-owned, and partly
   legitimate).** 40 of 73 discard it, but a large share are correct "ensure this row exists" seeds.
   The *shape* that is always wrong — a function that mints an id, runs a conflict-swallowing insert,
   and returns the id regardless — is exactly **one** site today (`mcp_gateways.rs:48`), and per the
   engine's own doctrine *"a rule with a one-commit lifetime should never be added"*: fix it, and the
   rule fails on `zero-matches`. It is a P0 in §7 instead. The general condition on the *write* path
   is already ratcheted by `blind-identity-write` (35/82).
4. **`INSERT OR REPLACE` alone (refused as a separate rule — folded into the one above).** It is the
   sharper signal (3 matches, and unlike `OR IGNORE` there is no context in which its cascade-delete
   and default-reset semantics are what an author wanted), but a baseline of 3 has a one-commit
   lifetime: fix all three and the runner correctly fails on `zero-matches` and instructs you to
   delete the rule. Folded into `unverifiable-conflict-clause`, the same three statements are
   ratcheted inside a population with a real migration ahead of it. **The owed follow-up this
   refusal names is not a second census rule but a Rust test** — assert that no table which is the
   target of an `ON DELETE CASCADE` foreign key is ever written by a `REPLACE`-semantics statement.
   That is a *relational* property across two trees (the FK graph joined to the statement set), which
   no content-match can express, and it is the check that would have made this brief's hypothesis
   permanently answerable instead of answerable once. It must run under `cargo test --workspace`:
   `npm run test:rust` passes `--lib` against the root manifest, so use `npm run test:rust:crates`;
   `ci.yml:275` runs `--workspace` and the lane is live.

**How the census rule fails loudly when its own precondition is absent** is inherited from the runner
and demonstrated in the fault table: a zero-match run fails structurally rather than reporting a
clean tree; a walk below `floor` fails with *"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; a drop
without a baseline update fails; and the surviving count prints on success, so a green build log
distinguishes a clean run from one that checked nothing.

**On severity:** the census is a ratchet, not a severity ladder — it fails a run when a count moves.
No argument is made anywhere in this document from warning volume, and none could be: `npm run check`
runs `eslint src/` with no `--max-warnings` and the pre-commit hook runs `--quiet`, so a warn-level
rule enforces nothing at either gate at any count. That is also why refusal 4 routes to a **`cargo
test` assertion** rather than a lint: `cargo test --workspace` fails; a warning does not.

## See also

- [Repository CRUD surface](./repository-crud-surface.md) — the exterior of the function whose one
  statement this path owns, and the `blind-identity-write` rule that deliberately excluded `INSERT`
  and `ON CONFLICT` so this one could fill it.
- [Partial update semantics](./partial-update-semantics.md) — `COALESCE(?N, col)` is theirs;
  `COALESCE(excluded.col, col)` is mine. Same function, different question.
- [Index design](./index-design.md) — the unique index this path's conflict target must name, and
  the partial-index predicate it must repeat.
- [Transaction boundary](./transaction-boundary.md) — whether the upsert lands atomically with the
  next write, and the `BEGIN IMMEDIATE` that the three read-then-write upserts also lack.
- [Delete semantics](./delete-semantics.md) — what an `ON DELETE CASCADE` reaches, which is what
  `INSERT OR REPLACE` fires without saying so.
- [Persisted model struct](./persisted-model-struct.md) — the `NOT NULL` and `CHECK` constraints that
  `INSERT OR IGNORE` silently swallows.
- [Typed error contract](./typed-error-contract.md) — the `AppError` a rejected upsert should carry,
  and why `ErrorCode::ConstraintViolation` is the wrong discriminator.
- [Schema change](./schema-change.md) — where the uniqueness constraint is declared in the first
  place.
