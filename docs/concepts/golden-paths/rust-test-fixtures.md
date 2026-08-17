# Golden path — Rust test fixtures

> Situation node: `platform-delivery/testing-and-workflow/rust-test-fixtures` ·
> [situation spine](../situation-spine.md) · recurrence **60** ·
> dimensions: **function · code-quality · resilience · performance**
> Composed 2026-08-14 against `master` @ `e76646f7d`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri/` — exactly `rust.files` in
> [`shared-facts.json`](../shared-facts.json) — parsed **twice, by two independent
> implementations**: (A) a character-level Rust scanner that blanks comments without
> touching string literals, resolves `#[cfg(test)]` regions by brace matching, and
> extracts every `CREATE TABLE` with a paren-balanced column body; (B) a
> literal-extraction parser that pulls every Rust string literal first and parses SQL
> only inside them, deciding test-vs-production by a line-oriented brace tracker. They
> disagreed, twice, and both disagreements are reported below because each one is a
> finding.
>
> **Production truth is the running software, not the source.** The operator's live
> `personas.db` (347 MB) and `personas_data.db` (17 MB) were copied and opened
> **read-only**; every production column, index, UNIQUE and foreign key in this
> document comes from `PRAGMA table_info` / `index_list` / `foreign_key_list` against
> those files. Where the two source parsers disagreed about production, the database
> settled it — and it settled it against implementation B.
>
> **The fixture's own schema text was executed.** `KNOWLEDGE_BASE_SCHEMA` and
> `COMPANION_SCHEMA` are Rust `const &str`; SQLite is SQLite. Both were run into
> throwaway in-memory databases, once with `init_test_user_db()`'s ALTER list and once
> with `init_user_db()`'s, and both results diffed against the live user database.
> **The single most important finding in this document was produced that way and
> could not have been produced by reading.**
>
> **No `cargo` command was run** — a PreToolUse guard blocks concurrent cargo while the
> operator's app is running. Every claim requiring a compile is marked **unverified**
> where it appears. `src-tauri/target/**` and `.claude/worktrees/**` excluded.
>
> A **convergence sweep** ran against `../brainiac` (Rust · sqlx · **Postgres**) and
> `../personas-cloud` (TypeScript + Python). **It inverted the hypothesis this document
> was commissioned to confirm**, and the inversion is §Convergence.
>
> **Deviations** (§7) is a fix backlog.

---

## ⚠ Corrections to the brief that commissioned this path

1. **The corpus is bigger than the brief, and the brief's production baseline was
   source-derived where it should have been database-derived.** Re-measured against the
   live databases: **79** test-side `CREATE TABLE` statements naming a table that
   really exists in production, across **33** files and **45** tables (brief: 74 / 32 /
   40). Two of the 79 — `commands/infrastructure/schema_vocabulary.rs:224,225` — are
   DDL strings fed to a table-name parser under test, not fixtures, so the honest
   fixture figure is **77 sites / 32 files / 43 tables**. Every one is inside a
   `#[cfg(test)]` region; **zero** leak into production. Column-level, live-grounded:
   **48 of 79 are narrower** than the real table (brief: 47), **560** production columns
   absent in total (brief: 561), **25** omit a `NOT NULL`-no-default column (brief: 26),
   and **31** are column-identical (brief: 27).
2. **`obsidian_vault_tests.rs:23` gives `personas` 1 of 41 columns, not 1 of 42.** The
   live table has 41. A source-only parse that counts an `ALTER` for a column later
   removed reads 42. Small, but it is the difference between citing the source and
   citing the software.
3. **`init_test_db()` has 524 call sites, not 525; `init_test_user_db()` has 57, not
   62.** Both re-derived here with comments blanked; both agree exactly with
   [`foreign-key-policy.md`](./foreign-key-policy.md) §3, which measured them
   independently. The 525/62 figures count occurrences inside comments and doc text.
   *(The 8-file figure for `init_test_user_db` is correct and is still the story.)*
4. **"45 fixtures across 23 files still replay the whole migration chain" undercounts.**
   Inside `#[cfg(test)]` regions: **28** `migrations::run` calls in 24 files and **40**
   `run_incremental` calls in 20 files — **68 replay calls across 24 files**.
5. **"34 of 41 shadow tables have ZERO indexes where production has 77" — the shape is
   right, the numbers are low.** **41 of the 45** shadowed tables have no test-side
   index anywhere in the tree; the live databases carry **96 explicitly-created
   indexes** and **52 UNIQUE indexes** on those 45 tables. Only **4** fixture sites
   declare an index at all, and all four are inside migration-mechanics tests
   (`fk_hygiene.rs:947`, `incremental.rs:8870`, `:8943`, `:9360`) — i.e. **no fixture
   outside the migration files has ever declared an index.**
6. **"28 of 30 shadow-DDL files never mention the foreign-keys pragma" → 31 of 33.**
   And a sharper cut of the same condition: **9 `Connection::open_in_memory()` sites
   across 6 files, 8 of them in test code, and not one of the 6 files mentions
   `foreign_keys` anywhere.**
7. **"Two bypass rationales are stale" — REFUTED, and the refutation matters.** See
   §7 D. The rationale is not fabricated; it cites a real, dated, empirically-observed
   harness defect recorded at `docs/architecture/cloud-integration-bridge.md:339-372`,
   with an explicitly un-done follow-up. It never claimed a literal `DROP TABLE`
   statement. And it has **four** citing sites, not three.
8. **The convergence hypothesis is wrong.** "brainiac's schema lives in `.sql` files and
   therefore CANNOT be hand-rolled in Rust" is refuted three independent ways. The real
   cause is the database engine's deployment model, and brainiac reinvented the same
   failure in a different costume. §Convergence.

---

## Scope, and the boundary with `rust-unit-test-harness.md`, settled in prose

[`rust-unit-test-harness.md`](./rust-unit-test-harness.md) (recurrence 514) owns **how a
test runs**: which of the 4,360 tests each lane reaches, `--lib` / `--workspace` /
`--all-targets` / `--features desktop`, the `mt.exe` post-link manifest,
`#[ignore]`, `#[allow(dead_code)]`, and where a test module is placed.

**This path owns what a test is given to run against** — the schema, the constraints,
the indexes, the seed rows, and the connection posture that together decide whether a
change that breaks production also breaks the test.

The boundary is sharp everywhere except one primitive, and the overlap is worth stating
rather than pretending away. `init_test_db()` appears in both documents: that path
names it as *the thing to call*, and is authoritative on the crate-boundary mechanics
(`cfg(test)` does not cross a crate, so `db/Cargo.toml:35`'s `test-support` feature is
the door). **This path is authoritative on whether what it hands you is faithful** —
and §7 A2 is the finding that it is not, for the user database. Where that path's §4
answers *"can the primitive's signature make the wrong call impossible?"* with a newtype
on `DbPool`, that answer is endorsed here and extended, not repeated: a newtype
distinguishes *which builder made this pool*. It cannot distinguish *whether that
builder built the right shape*. Both are needed and they are different fixes.

| Question | Owned by |
|---|---|
| Which lane runs this test; what flags it needs | [`rust-unit-test-harness.md`](./rust-unit-test-harness.md) |
| **What schema, constraints and rows the test sees** | **here** |
| **Whether the sanctioned fixture matches production** | **here** |
| Where a new table or column is declared | [`schema-change.md`](./schema-change.md) |
| What an FK should say, and whether enforcement is on | [`foreign-key-policy.md`](./foreign-key-policy.md) |
| Whether a struct and its table agree | [`persisted-model-struct.md`](./persisted-model-struct.md) |

## 1. Trigger

- "I need a `persona` / a `dev_project` / a `companion_turn` row to test this."
- "The full migration chain is overkill — I only need three tables."
- "Minimal schema, just the tables this resolver probes."
- "`init_test_db()` doesn't have the table I need." / "the fixture is missing a column."
- "This test passes but the same INSERT fails in the app."
- "Why is this suite 90 seconds and all of it setup?"
- "It's an in-memory database, it doesn't need the pragmas."

If you are about to type `CREATE TABLE` inside a `.rs` file, `Connection::open_in_memory()`,
`Pool::builder()`, `execute_batch(` in a test, `migrations::run(&conn)` in a fixture, or
to copy a `test_pool()` helper out of a neighbouring module — you are in this situation.

**Not this path:** which lane runs the test, and with which flags, is
[`rust-unit-test-harness.md`](./rust-unit-test-harness.md).

## 2. The one way

**A test is given the production schema or it is given nothing you can trust: call
`personas_db::init_test_db()` for the app database and `init_test_user_db()` for the
user database, and never write `CREATE TABLE` to obtain a fixture of a production
table.** Those two build from the real chain — `migrated_template()`
(`db/src/lib.rs:1899`) runs `migrations::run` + `run_incremental` + all three seed
functions once per process behind a `OnceLock` and `fs::copy`s the file per call, so you
get every column, every `NOT NULL`, every `DEFAULT`, every index, every foreign key and
every seeded builtin connector for the price of a file copy. Take the rows the same way:
build them through the production writer (`repos::test_fixtures::create_test_persona`
goes through `personas::create`, so a new required field is a compile error in every
test at once), never through a hand-written `INSERT` whose column list you chose.
Obtain the connection from the pool the fixture hands you and nothing else —
`SqlitePragmaCustomizer` is what makes `PRAGMA foreign_keys = ON` true, and a
`Connection::open_in_memory()` you opened yourself has enforcement **off**, so every
constraint in whatever schema it holds is inert. **Do not "fix" a fixture by
hand-copying production's columns into it**: three files currently maintain all 20
columns of `companion_turn` by hand, correctly, with nothing keeping them correct — and
the sanctioned fixture hands out 16. There are exactly three situations where DDL in a
test is legitimate, and they share one property: **the DDL is not standing in for a
production table.** They are (1) a test whose *subject* is DDL parsing, where the SQL is
input data; (2) a sidecar store that exists in no migration, like `bench_*`; (3) a
migration-mechanics test that must construct a *pre*-state on purpose. Write which one
you are on the line above. Everything else is this path's backlog.

## 3. Mandated primitives

- **`db/src/lib.rs:1939` — `init_test_db() -> Result<DbPool, AppError>`.** The
  app-database fixture, and the one to copy. Copies the once-built migrated template and
  proves the copy is openable with `SELECT COUNT(*) FROM sqlite_master` before handing it
  over (`:1960-1965`). Installs `SqlitePragmaCustomizer`, so the pool carries production's
  pragma posture including `foreign_keys = ON`. **524 call sites across 70 files.**
- **`db/src/lib.rs:1899` — `migrated_template()`.** The `OnceLock` behind it, keyed on
  `std::process::id()`. Its 20-line doc comment (`:1881-1898`) is the best statement in
  the repo of why a fixture is built once and copied. Read it before writing any
  fixture. Note what its `build()` closure runs (`:1911-1919`): the chain **and**
  `seed_builtin_tools` + `seed_builtin_connectors` + `seed_builtin_shared_events` — the
  fixture is not only a schema, it is a *populated* one, and that half is invisible until
  you hand-roll around it.
- **`db/src/lib.rs:1994` — `init_test_user_db() -> Result<UserDbPool, AppError>`.** The
  `personas_data.db` counterpart. **57 call sites across 8 files.** Its doc comment
  (`:1969-1979`) states this whole path's doctrine in one sentence — *"a fixture whose
  columns differ from production is a test that proves the wrong thing"* — and **the
  function does not currently satisfy it** (§7 A2). Use it anyway; it is right for 51 of
  its 52 tables and the fix is nine lines.
- **`db/src/lib.rs:1989` — `companion_schema_for_test()`.** Hands a test production's
  schema *text*, so a test about the schema gets the real string rather than a copy of
  it. This is the correct shape for "test the schema itself" and the model for the fix in
  §Type-over-gate.
- **`db/src/repos/test_fixtures.rs:9,35` — `create_test_persona` /
  `create_test_persona_id`.** The only shared row factory in the tree, and the only place
  a test row is built through the production write path. 38 lines, two functions, one
  table. **There should be dozens** — §7 B.
- **`db/src/lib.rs:201` `STANDARD_PRAGMAS` + `:216-224` `SqlitePragmaCustomizer`.** The
  reason a pooled connection behaves like production. Both test pools install it. A
  connection you opened yourself does not have it. See
  [`foreign-key-policy.md`](./foreign-key-policy.md) §3.
- **`db/Cargo.toml:35` — the `test-support` feature**, wired as a `[dev-dependencies]`
  edge from `Cargo.toml:277` and `engine/Cargo.toml:129`. The mechanism that lets the
  fixture cross a crate boundary without shipping.
  [`rust-unit-test-harness.md`](./rust-unit-test-harness.md) §3 owns this; it is listed
  here only so nobody re-invents a second door.

**Do not exist — this path names them:**

- **A row factory for any table other than `personas`.** 45 shadowed tables, one factory.
- **Any assertion, anywhere, that a fixture's shape matches production's.** SQLite
  exposes `PRAGMA table_info` and `sqlite_master.sql`; `companion_schema_for_test()`
  already proves the pattern is reachable; nothing compares.
- **A shared constant for `init_user_db`'s post-`CREATE` ALTER list.** It is written
  twice, by hand, and the two copies have drifted (§7 A2).

## 4. Steps

1. **Ask what the test needs to observe.** If the answer involves a production table's
   behaviour — a query, a constraint, a cascade, an index, an INSERT — the fixture is
   `init_test_db()` / `init_test_user_db()` and the rest of these steps are about rows.
2. **Take the pool from the fixture.**
   ```rust
   let pool = personas_db::init_test_db().expect("test db");
   let id = personas_db::repos::test_fixtures::create_test_persona_id(
       &pool, "Alice", "you are alice",
   );
   ```
   If you need the user database, `init_test_user_db()`. If you need both, take both.
3. **Build rows through the production writer, not through a hand-written `INSERT`.**
   A repo `create`/`upsert` function carries the required-field list in its input type.
   A hand-written `INSERT INTO t (a, b) VALUES (?1, ?2)` carries whichever columns you
   remembered — which is how 30 schema-violating INSERTs
   ([`persisted-model-struct.md`](./persisted-model-struct.md) §259) came to pass green.
4. **If the table is missing from the fixture, that is a migration bug — fix the
   migration.** Not the test. See [`schema-change.md`](./schema-change.md). A
   hand-rolled table makes the bug invisible instead of fixing it, and the one place in
   this repo where that reasoning was written down honestly
   (`docs/architecture/cloud-integration-bridge.md:370`) recorded the root-cause fix as
   a follow-up and it has not happened in five weeks.
5. **Do not replay the chain by hand.** `migrations::run(&conn)` + `run_incremental(&conn)`
   in a fixture is the *slow correct* answer; `init_test_db()` is the *fast correct*
   answer and produces the identical schema. Measured at `81aba23de`: the
   `dev_workspaces` suite went 89.22s → 2.94s when its fixtures delegated. 68 calls
   across 24 files still pay the slow one.
6. **Never open your own connection.** `Connection::open_in_memory()` and
   `Pool::builder()` both skip `SqlitePragmaCustomizer`. 9 `open_in_memory` sites live in
   6 files and **none of those files mentions `foreign_keys`**, so every FK in whatever
   schema they hold is off. A cascade test against one of them proves nothing, loudly
   passing.
7. **If you must write DDL, say which of the three legitimate cases you are in**, on the
   line above, in the form `// DDL AS <parser-input | sidecar-store | migration-pre-state>: <why>`.
   The repo has three genuine instances and no marker, so they are indistinguishable
   from the 77 that are not.
8. **Stop.** No second fixture builder. No `test_pool()` helper copied from a neighbour —
   there are already 6 of them and they disagree. If `init_test_db()` does not give you
   what you need, that is a bug in `init_test_db()` and it is nine lines from the truth.

### Can the primitive's signature make the wrong call impossible? — answered

Per the [contract](../golden-path-contract.md), answered here, before §9. **Yes — and for
this leaf the answer is a shared constant, not a newtype, because the live defect is a
copied *list*, not a confused *handle*.**

**The one that fixes a live bug today.** `init_user_db` (`db/src/lib.rs:492`) applies
**19** post-`CREATE` `ALTER TABLE … ADD COLUMN` statements. `init_test_user_db`
(`:1994`) applies **7**, hand-copied. Executing both lists proves the consequence: the
fixture's `companion_turn` has **16** columns, production's and the operator's live
database both have **20**. Extract the list once —

```rust
/// The post-CREATE ALTERs `init_user_db` performs. ONE list, so the fixture
/// cannot be a stale copy of the boot path.
pub(crate) const USER_DB_POST_CREATE_ALTERS: &[&str] = &[ /* 19 statements */ ];
```

— and have both functions iterate it. **The drift becomes unrepresentable**, and it is
the same move the repo already made twice and did not make a third time:
`STANDARD_PRAGMAS` is one const both pools install, and `companion_schema_for_test()`
hands tests the production schema *text* rather than a copy. Nine lines. No gate can
express this condition at all (§9 refusal 1), which is the strongest possible argument
for the type answer over the gate answer.

**The one that removes the whole deviation class.** A test cannot hand-roll a table it is
never given the chance to build. `test_fixtures.rs` already has the shape: because
`create_test_persona` goes through `personas::create`, a new `NOT NULL` field on
`CreatePersonaInput` is a **compile error in every test at once** — the exact property
this whole document is asking for, already working, for one table out of 45. Adding a
factory per hot table (`dev_projects`, `companion_turn`, `kb_documents`,
`persona_credentials`, `connector_definitions`) is cheaper than adding a gate and,
unlike a gate, it also fixes the INSERT-omits-a-column class in
[`persisted-model-struct.md`](./persisted-model-struct.md). **Give tests rows, not
tables.**

**Endorsed from the sibling path, not repeated.**
[`rust-unit-test-harness.md`](./rust-unit-test-harness.md) §4 proposes making `DbPool` a
newtype so the 59 `Pool::builder()` sites become compile errors. That is correct and it
is upstream of §7 C here. It is also **not sufficient for this leaf**: a newtype proves a
pool came from `init_test_db`, and `init_test_user_db` *is* `init_test_db`'s sibling and
still hands out a 16-column `companion_turn`. **A type can guarantee the door; only a
shared definition can guarantee what is behind it.**

**Where no type works.** Whether a fixture's *columns* match production is a
cross-artifact property — the fixture is in one file, the schema in another, the truth in
a `.db`. No Rust signature spans that. That half is §9 item 2: a test that asks the
database.

## 5. Anti-patterns

- **`CREATE TABLE` in a test module to stand in for a production table.** 77 sites.
  It buys a fast hermetic fixture and pays with a test that certifies a shape no user
  will ever have. Live-grounded: 48 are narrower than the real table, 560 production
  columns are absent, and **25 omit a column the real table declares `NOT NULL` with no
  default — so the INSERT under test would be rejected by the real database and the test
  is green.** `mcp_server/obsidian_vault_tests.rs:23` gives `personas` **1 of 41**
  columns.
- **Writing "minimal schema — only the tables the resolver probes" as if it were a design
  note.** `commands/design/connector_readiness.rs:1288` says exactly that, then declares
  six tables with **zero constraints between them**: `connector_definitions(3 of 15)`,
  `persona_credentials(3 of 10)`, `credential_fields(3 of 9)`, `dev_projects(2 of 23)`,
  `twin_profiles(1 of 13)`, `dev_standards(1 of 12)`. It reads like discipline and is the
  opposite: the resolver's behaviour on the other 62 columns is what the test was for.
  And because the fixture skipped `init_test_db()`, it also skipped
  `seed_builtin_connectors` — **a connector-readiness test with no connectors in it.**
- **"It's in-memory, it doesn't need the pragmas."** `Connection::open_in_memory()`
  starts with `foreign_keys` **OFF**. 6 files, 9 sites, 0 mentions of the pragma. Any
  cascade, orphan or constraint assertion against one of those connections is
  structurally incapable of failing.
- **Repairing a drifted fixture by hand-copying production's columns.**
  `companion/turn_ledger.rs:432` and `companion/session.rs:2814` each reproduce all 20
  columns of `companion_turn` — **more faithfully than `init_test_user_db()` does** —
  and nothing whatsoever keeps them that way. This is the trap in both directions: the
  copies are correct today and the primitive is not, so the lesson a reader takes is
  "hand-rolling works", which is true right up until the 21st column.
- **Copying a `test_pool()` helper out of a neighbouring module.** Six near-identical
  ones exist (`external_api_keys.rs`, `api_key_audit.rs`, `broker_edges.rs`,
  `management_api.rs`, plus two in `companion/`). Each re-derives `max_size`,
  `connection_timeout`, and omits the pragma customizer. **59 `Pool::builder()` calls
  across 52 files**, only 6 of them production.
- **Replaying the migration chain in a fixture.** 68 calls across 24 files. Schema-correct
  and ~30× too slow; the template's speedup only reaches you if you call the template.
- **A fixture with no index.** 41 of the 45 shadowed tables have no test-side index
  anywhere, against 96 explicit and 52 UNIQUE indexes live. So **no test on those tables
  can observe an index regression, a uniqueness violation, or a query-plan change** — and
  the last of those is the one that will show up as a 6.8-second delete in production
  ([`foreign-key-policy.md`](./foreign-key-policy.md) §7 P2).
- **Assuming the sanctioned fixture is faithful because it is sanctioned.** It is for the
  app database. It is not for the user database, by 4 columns, right now, and the doc
  comment above it asserts the opposite.

## 6. Evidence

**Adoption is genuinely good on the app side and worth naming: 524 `init_test_db()` call
sites across 70 files against 45 hand-rolled app-database fixture sites — ~92%. The hole
is one database wide.** `init_test_user_db()` has **57 sites in 8 files** while **18
files hand-roll 34 fixtures** around it, and §7 A2 explains why that is not laziness.

- **`db/src/lib.rs:1881-1967` — read this whole block.** The problem (576 call sites ×
  the full chain ≈ 24 CPU-minutes per suite), the mechanism (`OnceLock` + `fs::copy`), the
  safety argument (no WAL ⇒ one self-contained file; connection dropped before the first
  copy), the isolation key (pid), and the post-copy verification. Reference implementation
  *and* reference explanation.
- **`db/src/lib.rs:1969-1979`** — the doc comment on `init_test_user_db`, which contains
  the best one-line statement of this path's doctrine in the repo: *"a fixture whose
  columns differ from production is a test that proves the wrong thing."* Native, not
  imported. Quote it in code review.
- **`db/src/repos/test_fixtures.rs`** — 38 lines, two functions, and the only place in
  the tree where a test row is built through the production write path. **This is the
  file to extend.** Copy its shape for `dev_projects`, `companion_turn`,
  `kb_documents`, `persona_credentials`.
- **`db/src/repos/communication/sla.rs:1535-1538` and `:2016`** — the best *use* of a
  fixture in the repo: two test doc comments asserting that a migration step lives inside
  `run_incremental` *because* `init_test_db` builds from it, so a misplaced step is
  caught by a test rather than by a user. That property is unreachable from a hand-rolled
  fixture and it is the clearest argument for the doctrine.
- **`db/src/migrations/fk_hygiene.rs:947`** — the one fixture in the tree that hand-rolls
  DDL for a *correct* reason and shows what that looks like: it recreates
  `persona_memories` in its deliberate pre-FK shape to test the retrofit, it declares the
  indexes, and its module sets `PRAGMA foreign_keys = ON`. If you must write DDL, write
  it like this.
- **`commands/infrastructure/schema_vocabulary.rs:221-230`** — the legitimate
  parser-input case, and a good test: it deliberately feeds `names_of()` back-ticked,
  quoted, schema-qualified and `CREATE VIRTUAL TABLE` spellings because the parser must
  handle all of them. It is *not* a fixture and this path's rules do not apply to it.
- **`src/engine/management_api.rs:2420-2432`** — the most reasoned deviation in the tree.
  A deliberately *partial* migration chain (`initial::run`, no `run_incremental`) with
  twelve lines explaining exactly which tables it needs, why the full chain does not
  supply them, and where the underlying bug is filed. This is the shape an exception
  should take; it is a stopgap and it says so.

## 7. Deviations found

> **Second pass — what is upstream of all of this.** The deviations are not 77
> independent lapses. They reduce to one thing: **the repo has never once asked whether a
> fixture matches production, so nothing distinguishes a faithful fixture from a stripped
> one — including inside the primitive itself.** The app-side fixture is excellent and
> ~92% adopted. The user-side fixture is 4 columns short of production, and 18 files
> route around it. The route-arounds then drop 239 `NOT NULL`s, 187 `DEFAULT`s, 37
> foreign keys and every index, because once you are hand-writing DDL there is nothing to
> copy *from* and nothing to check *against*. Fix the primitive (nine lines), add the
> comparison (§9 item 2), and the other 76 sites become a mechanical backlog instead of a
> judgement call.

### A. The fixture is not the production schema — 3, and A2 is the headline

**A1 — 77 hand-rolled fixture sites, in 32 files, shadowing 43 production tables**
(raw signal 79 / 33 / 45; two are parser input). Every one inside `#[cfg(test)]`; zero in
production. Split by database, with production truth from the live files:

| | sites | files | tables | the primitive bypassed | its adoption |
|---|---:|---:|---:|---|---|
| **app DB** (`personas.db`) | 43 | 16 | 25 | `init_test_db()` | 524 sites / 70 files |
| **user DB** (`personas_data.db`) | 34 | 18 | 18 | `init_test_user_db()` | **57 sites / 8 files** |

Measured against the live schema: **48 of 79 narrower** (560 columns absent), **25 omit a
`NOT NULL`-no-default column**, **239 `NOT NULL` clauses dropped**, **187 `DEFAULT`
clauses dropped**, **37 `REFERENCES` clauses dropped across 29 sites**, **41 of 45 tables
with no test-side index against 96 live indexes and 52 live UNIQUE constraints**.

Worst by absolute column loss:

| Fixture | Table | cols | live |
|---|---|---:|---:|
| `src/mcp_server/obsidian_vault_tests.rs:23` | `personas` | 1 | 41 |
| `src/companion/jobs/operations_views.rs:268` | `personas` | 2 | 41 |
| `src/companion/prompt.rs:2475` | `personas` | 7 | 41 |
| `src/companion/dispatcher.rs:3845` | `personas` | 8 | 41 |
| `src/companion/jobs/operations_views.rs:269` | `persona_executions` | 7 | 38 |
| `src/commands/design/connector_readiness.rs:1295` | `dev_projects` | 2 | 23 |
| `src/commands/companion/observability.rs:591` | `companion_turn` | 4 | 20 |
| `src/companion/brain/profile_synthesis.rs:386` | `companion_turn` | 4 | 20 |
| `src/commands/design/connector_readiness.rs:1296` | `twin_profiles` | 1 | 13 |
| `src/engine/kb_scan.rs:188` | `kb_documents` | 3 | 15 |

**A2 — THE HEADLINE: `init_test_user_db()` is itself a hand-maintained copy of
production's boot sequence, and it has already drifted by four columns.** Measured by
executing both.

`init_user_db` (`db/src/lib.rs:492`) applies `KNOWLEDGE_BASE_SCHEMA`, then 4 ALTERs, then
`COMPANION_SCHEMA`, then 15 more ALTERs — **19 post-`CREATE` statements**.
`init_test_user_db` (`:1994`) applies the same two schema consts and **7** ALTERs,
hand-copied. Both lists were executed into throwaway databases and diffed against the
operator's live `personas_data.db`:

| | statements applied | `companion_turn` columns |
|---|---:|---:|
| `init_user_db` (production boot) | 101 | **20** |
| live `personas_data.db` | — | **20** |
| **`init_test_user_db` (the fixture)** | 97 | **16** |

Twelve ALTERs are absent from the fixture. **Eight are no-ops today** — executing them
against the current schema consts returns `duplicate column name`, because the const
caught up (`kb_chunks.source_page`, `.extraction_confidence`, `kb_documents.page_count`,
`.empty_pages`, `companion_proactive_message.scheduled_for`,
`companion_background_job.{short_title,parent_turn_id,conversation_id}`). **Four are
load-bearing, and all four are on `companion_turn`:** `prompt_blocks_json`,
`total_prompt_chars`, `prompt_block_hashes_json`, `error_reason`.

Three consequences, in ascending order of importance:

1. Any test that reaches those four columns through `init_test_user_db()` fails with
   `no such column` — loudly, which is the good case. *Unverified: I could not run the
   suite.* That nobody has hit it is evidence of how thin the fixture's 8-file adoption
   is.
2. **It is the mechanism behind the 18 files that hand-roll around it.** A fixture that
   cannot serve the write path you need is a fixture you route around, and the
   route-arounds are where the 239 dropped `NOT NULL`s live. The user-database half of
   this backlog is downstream of this defect.
3. **It is the [contract](../golden-path-contract.md)'s fifth §9 failure mode,
   instantiated.** `hand-rolled-fixture-ddl` fires correctly and routes people to
   `init_test_user_db()` — *"a gate on reaching a destination is only as good as the
   destination's defaults."* The destination is four columns short and the gate is green.

**And the inversion the brief should hear.** The brief calls the column-identical
fixtures "the trap, not the reassurance". They are a trap — nothing keeps them correct.
But right now **`companion/turn_ledger.rs:432` and `companion/session.rs:2814` are more
faithful to production than the sanctioned primitive is**, both declaring all 20 columns
including the four the fixture lacks. Three other `companion_turn` fixtures
(`observability.rs:591`, `profile_synthesis.rs:386`, `proactive/rollup.rs:234`) declare
4, 4 and 6. So the population is not "27 lucky copies" — it is two hand-maintained copies
that are ahead of the primitive and three that are far behind it, with no way to tell
which you are reading.

**A3 — the fixture's seed rows are invisible until you skip them.** `migrated_template()`
runs `seed_builtin_tools`, `seed_builtin_connectors` and `seed_builtin_shared_events`
(`db/src/lib.rs:1916-1918`), so `init_test_db()` hands back a *populated* database. 273
`seed_*` calls appear inside test regions, so this is well known — but every one of the
77 hand-rolled fixtures gets an empty database and nothing says so.
`connector_readiness.rs:1288` is the sharp case: a connector-readiness resolver tested
against `connector_definitions(name, metadata, category)` with no seeded connectors in it.

### B. There are two row factories for 306 tables — 1

**B1 — `db/src/repos/test_fixtures.rs` covers `personas` and nothing else.** Two
functions. The 43 shadowed tables are, without exception, tables with no factory — which
is the causal chain, not a coincidence: no factory ⇒ hand-written `INSERT` ⇒ you need a
table to insert into ⇒ hand-written `CREATE TABLE`. The fix is additive and mechanical
and it is the type-level half of §Type-over-gate.

### C. Tests that open their own database — 2

**C1 — 9 `Connection::open_in_memory()` sites across 6 files; not one file mentions
`foreign_keys`.** `commands/companion/observability.rs:589,601,772`,
`commands/design/connector_readiness.rs:1290`, `companion/brain/embeddings.rs:557,606`,
`companion/brain/episodic.rs:534`, `companion/brain/keyword.rs:130`
(`src/main.rs:48` is the production sqlite-availability probe and is fine). These
connections have FK enforcement **off**, so a fixture that faithfully copied every
constraint would still observe nothing.
[`foreign-key-policy.md`](./foreign-key-policy.md) §7 P1 reached the same conclusion from
the constraint side; this is the connection side of it, and it is the sharper signal
because a raw constructor is a *presence*, not an absence.

**C2 — 59 `Pool::builder()` calls across 52 files, 53 of them in test code.** So 52 files
have re-derived `max_size` and `connection_timeout` and, in nearly every case, omitted
`SqlitePragmaCustomizer` entirely. Six near-identical `test_pool()` helpers exist and
they disagree with each other.

### D. A bypass rationale that is NOT stale — 1 (a correction)

**D1 — the brief and [`rust-unit-test-harness.md`](./rust-unit-test-harness.md) §5/§7 A5
report that `db/src/repos/resources/external_api_keys.rs:216-223` cites "a `run_incremental`
DROP that a composer could not find in the source", and that two more files cite that
file. The citation chain is real and there are four sites, not three — but the rationale
is not fabricated, and calling it stale sends the reader to the wrong fix.**

What the comment actually says is that `init_test_db()` *"does not reliably leave
`external_api_keys` present in the test binary"*, with the parenthetical *"dropped during
`run_incremental`"* and a pointer to
`docs/architecture/cloud-integration-bridge.md`. That document exists, is dated
2026-07-05, and at `:339-372` records a **full table dump taken at the migration point**
showing eight tables absent from an otherwise ~127-table schema. It explicitly does *not*
claim a `DROP TABLE` statement — it says the tables are *"created by `initial::run` (or an
early `run_incremental` step) and then dropped/lost during `run_incremental` in the test
path"*, states that production is unaffected, and files the root cause as an owed
follow-up that has not been done.

So: tracing every `DROP TABLE` in the chain and not finding `external_api_keys` is
**true** and does **not** refute the rationale. It refutes a mechanism the rationale never
asserted. What I can add from the live database: of the eight named tables,
**`external_api_keys` (1,011 rows), `healing_audit_log` (27), `settings_audit_log` (15),
`team_deliberations` (142) and `deliberation_agenda` (220) are all present**, and the
other three (`skills`, `skill_components`, `persona_skills`) are absent **by design** —
`initial.rs:345-355` documents their retirement and `incremental.rs:4211-4240` drops them
if empty. `external_api_keys` is created unconditionally with `?` propagation at
`initial.rs:358`. **Whether the test-binary loss still reproduces is unverified — it
needs one `cargo test` run, which this composition could not do.**

The four citing sites: `external_api_keys.rs:216-223` (the original),
`api_key_audit.rs:88-90`, `broker_edges.rs:193-194`, and — the one the brief and the
sibling path both missed — **`src/engine/management_api.rs:2420-2432`**, which is the
best-reasoned of the four and is the only one that runs a partial chain
(`initial::run` alone) rather than hand-writing DDL. **The correct action here is not
"delete the stale comment"; it is "run the chain once and settle it", and if it
reproduces, fix the harness.** Three of the four bypasses become unnecessary the moment
it is fixed.

### E. Nothing compares a fixture to production — 1

**E1 — zero assertions anywhere in 963 files that a test's table matches the migrated
one.** SQLite exposes `PRAGMA table_info` and `sqlite_master.sql` for free;
`companion_schema_for_test()` already proves the repo knows how to hand a test
production's own text; `incremental.rs:~9240`'s
`no_foreign_key_points_at_a_missing_table` already proves the repo knows how to write a
schema-level assertion with its instrument asserted before its result. The three pieces
exist and have never been put together. This is Gap 1 and §9 item 2.

## 8. Gaps in the primitive

1. **There is no way to assert a fixture matches production, so a fixture can drift for
   years silently — including the primitive.** A2 is that gap firing on the primitive
   itself. Everything in §7 A is downstream.
2. **`init_test_user_db()` is not the user database's `init_test_db()`.** It applies
   schema text directly rather than through a once-per-process template, so it pays full
   setup per call, and it re-states `init_user_db`'s ALTER list rather than sharing it.
   The performance half explains why nobody built on it; the sharing half explains why it
   drifted. Both are fixed by the same refactor.
3. **`DbPool` and `UserDbPool` are `pub type` aliases** (`core/src/pool.rs:14`,
   `db/src/lib.rs:157`), so no signature in the tree can express "a pool built from the
   production schema". Owned and specified by
   [`rust-unit-test-harness.md`](./rust-unit-test-harness.md) §4; restated here only
   because it is upstream of §7 C.
4. **`PRAGMA foreign_keys` is per-connection and the file remembers nothing** — so a
   `Connection::open_in_memory()` cannot inherit the posture, ever. SQLite, not laziness;
   see [`foreign-key-policy.md`](./foreign-key-policy.md) Gap 1. Postgres has no
   equivalent hazard, which is §Convergence.
5. **`CREATE VIRTUAL TABLE` fixtures cannot be built from the chain.** `vec0` tables are
   created at runtime by design (`db/src/vector_store.rs:61`), so
   `companion/brain/embeddings.rs` genuinely has to declare something — and what it
   declares is `companion_embedding (node_id TEXT)`, a one-column stand-in for a vector
   index. There is no good answer available today; the honest move is to mark it.
6. **A fixture cannot be given a subset of production cheaply.** The whole template is
   ~300 tables and a `fs::copy`. That is fast, but a test that wants *only* three tables
   has no supported way to say so, which is the pressure every hand-rolled fixture is
   responding to. A `init_test_db_with(&["personas", "dev_projects"])` that *derives* the
   subset from the migrated template (rather than from a hand-typed string) would remove
   the pressure without removing fidelity. Nothing like it exists.
7. **The census engine cannot compare two artifacts.** "This table has fewer columns than
   that one" needs the production twin from another file and the runner reads one file at
   a time. §9 refusal 1.
8. **Nothing measures fixture fidelity over time.** A column added to a production table
   silently widens the gap in 79 places at once, and every one of those tests stays green.

## 9. The missing gate

Three items: one census rule (validated below, with a positive control), one Rust test —
**which is the primary mechanism, not the secondary one** — and two refusals.

### The semantic conditions, stated first

Per the [portability test](../research/portability-test.md), what follows are **one
repo's proxies**. An adopting repo inherits the sentences and derives its own signals.

> **(A)** A test is given a structure carrying the production structure's *name* but not
> its *integrity rules*, so a write the real store would reject is accepted.
>
> **(B)** The shape a test is given and the shape production has differ, and nothing ever
> compares them.
>
> **(C)** The sanctioned fixture is itself a hand-maintained copy of the production
> constructor, so the two can disagree.

**(A) is countable and is gated. (B) needs a test, not a rule. (C) cannot be gated at all
and is answered by a type — which is why §Type-over-gate sits above this section.**

### 1. Census rule — `constraintless-table-declaration`

`hand-rolled-fixture-ddl` (baseline 37 files / 93 matches, verified green at
`e76646f7d`) already counts that a fixture **exists**, and it is this leaf's rule by
subject. It is not duplicated here. Its stated scope limit is precise and correct: *it
cannot see what the fixture dropped*, because the production twin lives in another file.
This rule gates **the one form of dropping that is visible inside a single file** — a
declaration with no integrity in it at all.

The two counts move independently in the direction that matters: adding a *faithful*
fixture raises `hand-rolled-fixture-ddl` and not this one; repairing a stripped fixture
in place lowers this one and not that one.

**Precision, all 15 opened:** 14 are `#[cfg(test)]` fixtures shadowing a production table
and every one is materially narrower than its live twin; the 15th
(`db/src/migrations/incremental.rs:4511`, `dev_auto_runs`) is production DDL in which no
column is `NOT NULL` — a real instance of the same condition, kept in the baseline
because the rule's claim is about declarations, not about test code.

**False-positive floor, by construction:** 303 of this repo's 313 production `CREATE
TABLE` statements carry at least one `NOT NULL`. The pattern does not describe normal
DDL; it describes the 3% that declares nothing.

**On the two `exclude` entries.** `hand-rolled-fixture-ddl` deliberately keeps its
parser-input DDL in-baseline, arguing a file-level exclude would blind it to a real
fixture added to that file later. That argument does not apply here and the difference is
worth stating: **this rule is a narrower severity band inside territory the broader rule
still watches.** Excluding `ai_helpers.rs` and `schema_vocabulary.rs` here removes 9 of
24 matches (37% noise) while leaving both files fully covered by the rule next door. If
`hand-rolled-fixture-ddl` were ever retired, these excludes would have to go with it.

```json
{
  "rules": [
    {
      "id": "constraintless-table-declaration",
      "goldenPath": "docs/concepts/golden-paths/rust-test-fixtures.md",
      "title": "A table declaration that cannot reject anything — a CREATE TABLE whose entire column list carries no NOT NULL, so every write the real table would refuse succeeds against it",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?[\"'`]?[A-Za-z_][A-Za-z0-9_]*[\"'`]?\\s*\\((?:(?!NOT\\s+NULL|CREATE\\s+TABLE)[^;])*?\\)\\s*;",
        "flags": "gi",
        "ignoreCommentLines": true,
        "description": "a CREATE TABLE statement in Rust source whose entire column list reaches its closing paren without one NOT NULL. PROXY FOR the stack-free condition: a test is given a structure that has the production structure's NAME but not its integrity rules, so a write the real store would REJECT is accepted and the test goes green on data that can never exist. DISTINCT FROM hand-rolled-fixture-ddl, which counts that a fixture EXISTS: that rule cannot see what the fixture DROPPED, because the production twin lives in another file and a single-file matcher cannot reach it. This one keys on the one form of dropping that IS visible in one file - a declaration with no integrity at all - and the two counts move independently: adding a faithful fixture raises that rule and not this one, and repairing a stripped fixture in place lowers this one and not that one. Measured 2026-08-14 at e76646f7d: 15 matches in 6 files, all 15 opened. 14 are #[cfg(test)] fixtures shadowing a production table, and every one is materially narrower than its twin as measured against the operator's live 347 MB personas.db and 17 MB personas_data.db via PRAGMA table_info: commands/design/connector_readiness.rs:1292-1297 declares connector_definitions(3 of 15), persona_credentials(3 of 10), credential_fields(3 of 9), dev_projects(2 of 23), twin_profiles(1 of 13) and dev_standards(1 of 12) in one batch, under a comment reading 'Minimal in-memory schema - only the tables the resolver probes'; mcp_server/obsidian_vault_tests.rs:23,24 declares personas with 1 of its 41 columns and app_settings with 2 of 3; companion/jobs/operations_views.rs:268 declares personas with 2 of 41; companion/proactive/triggers.rs:738 declares companion_proactive_message with 4 of 9; companion/brain/embeddings.rs:497,529,560,608 declares companion_embedding with 1 column and companion_node with 2 of 12. The 15th, db/src/migrations/incremental.rs:4511 dev_auto_runs, is PRODUCTION DDL in which no column is NOT NULL - a real instance of the same condition, kept in the baseline rather than excluded because the rule's claim is about declarations, not about test code. ACROSS THE WHOLE TREE the constraint loss these 15 are the visible tip of: 239 NOT NULL clauses, 187 DEFAULT clauses and 37 REFERENCES clauses absent from the 79 test fixtures relative to their live twins, plus 96 explicitly-created indexes and 52 UNIQUE indexes on the 45 shadowed tables against 4 index declarations on the test side, all four of them inside migration-mechanics tests. FALSE-POSITIVE FLOOR, by construction: 303 of this repo's 313 production CREATE TABLE statements carry at least one NOT NULL, so the pattern is not describing normal DDL - it is describing the 3% that declares nothing. PRECISION ANCHOR: the trailing \\)\\s*; is load-bearing and was found so by disagreement between two independent implementations - a paren-balancing parser without it counted commands/credentials/schema_proposal.rs:397, which is the English sentence 'Use IF NOT EXISTS on all CREATE TABLE statements (or the {database_type} equivalent)' inside a prompt string. English prose is not terminated like a SQL statement; removing the anchor raises the count 15 -> 27. POSITIVE CONTROL: the identical head with the compliant tail (body reaches a NOT NULL) matches 373 times across 35 files, and the token-only form (the words CREATE TABLE, no shape) matches 407 across 45 files - so the shape anchors reject 392 of 407 and the rule discriminates on the body's contents, not on the keyword. LEGAL FIX, in order: (1) delete the fixture and call personas_db::init_test_db() (db/src/lib.rs:1939, 524 sites) or init_test_user_db() (:1994, 57 sites in 8 files), which build from the real migration chain and carry every constraint, index and seed row; (2) if the DDL is legitimately not standing in for a production table - parser input, a sidecar store like bench_*, or a migration pre-state - say which on the line above; (3) NEVER repair it by hand-copying production's constraints, which is how companion/turn_ledger.rs:432 and companion/session.rs:2814 came to maintain 20 columns of companion_turn by hand while init_test_user_db() hands out 16. CONVERGENCE (2026-08-14, brainiac / personas-cloud): brainiac has zero CREATE TABLE in any of its 148 .rs files and 43 of 43 database-touching test files call brainiac_store::migrate(), so this rule scores ZERO there while the underlying condition is present in a different costume - 25 divergent hand-maintained TRUNCATE table lists across those same 43 files, 5 production tables named in none of them, and the resulting bug documented in its own source at brainiac-server/tests/console_pg.rs:618. An adopting repo must re-derive the proxy against wherever its own schema and its own integrity rules live; the SENTENCE travels, the regex does not. PRECONDITION: this proxy assumes schema-as-SQL-text-in-source and integrity-as-inline-column-constraints. PERFORMANCE: the body scan is a lazy tempered class bounded by the next semicolon, which a CREATE TABLE body never contains; no variable-length lookbehind; 0.34 s over 963 files."
      },
      "exclude": [
        { "path": "src-tauri/src/engine/ai_helpers.rs", "reason": "the six CREATE TABLE strings here (:351,:354,:360,:363,:371,:378) are INPUT DATA to extract_fenced_block's own tests - fenced LLM output being parsed, never executed against any connection. hand-rolled-fixture-ddl still counts this file, so the territory is not blind: this exclude narrows a severity band, it does not remove coverage." },
        { "path": "src-tauri/src/commands/infrastructure/schema_vocabulary.rs", "reason": "the CREATE TABLE strings here (:224,:225,:226) are INPUT DATA to names_of()'s own test, whose subject IS DDL parsing - it deliberately includes back-ticked, quoted, schema-qualified and VIRTUAL spellings because the parser must handle them. Never executed. hand-rolled-fixture-ddl still counts this file, so the territory is not blind." }
      ],
      "baseline": { "files": 6, "matches": 15 },
      "floor": 900
    }
  ]
}
```

`floor: 900` matches every other `src-tauri`-rooted rule deliberately — several rules over
one root must not hold several opinions about what "the Rust tree is intact" means. The
walk reports **963**, exactly `rust.files` in [`shared-facts.json`](../shared-facts.json).

#### Validated standalone, before publishing

`node scripts/census/run-census.mjs --rules <scratch>/census-fixture-fidelity-7b2e91.json --check`
(scratchpad filename unique to this composition):

```
  rule                    files   base  matches   base  walked  floor
  OK   constraintless-table-declaration      6      6       15     15     963    900

  census OK — 1 rule(s), 963 file-visits, 15 surviving violation(s) across 6 file(s).
```

Exit `0`, 0.72 s wall.

**Counts verified through two independent implementations, and they disagreed.** A
paren-balancing parser that ignores the census engine entirely returned **16 statements
across 7 files**; the engine returned 15/6. The extra was
`src/commands/credentials/schema_proposal.rs:397` — the English sentence *"Use `IF NOT
EXISTS` on all CREATE TABLE statements (or the {database_type} equivalent)"* inside a
prompt string, where my parser read `statements` as the table name and
`(or the {database_type} equivalent)` as its column list. **The engine was right and my
second implementation was wrong**, and the disagreement identified which anchor earns its
place: the trailing `\)\s*;`, because English prose is not terminated like a SQL
statement. Without it the count rises 15 → 27. That is the argument for doing it twice —
a single implementation would have baselined 16 and enshrined a prose match.

#### The positive control

Required by the contract: inverting the pattern to the **compliant** form must also fail,
proving the matcher discriminates on shape rather than on a token.

| Pattern | Files | Matches |
|---|---:|---:|
| the rule — head + body with **no** `NOT NULL` | **6** | **15** |
| **positive control** — identical head + body that **reaches** `NOT NULL` | **35** | **373** |
| token-only — the words `CREATE TABLE`, no shape | 45 | 407 |

**Overlap: by match 0 (the two tails are mutually exclusive by construction); by file 2 of
6** — `incremental.rs` and `embeddings.rs` appear in both because each contains compliant
declarations *and* a constraintless one, which is exactly why a file-level signal would
be useless here. The shape anchors reject **392 of 407** token matches. Run as a gate
against the rule's baseline the control fails immediately (`files rose 6 → 35`,
`matches rose 15 → 373`).

Published as a rule-shaped block with **no `baseline`** and `positive-control` in the id
so the registry merge skips it. **Do not merge this into `rules.json`:**

```json
{
  "rules": [
    {
      "id": "constraintless-table-declaration-positive-control",
      "goldenPath": "docs/concepts/golden-paths/rust-test-fixtures.md",
      "title": "POSITIVE CONTROL — not a gate. The compliant form of constraintless-table-declaration, which the rule must NOT report.",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?[\"'`]?[A-Za-z_][A-Za-z0-9_]*[\"'`]?\\s*\\((?:(?!CREATE\\s+TABLE)[^;])*?NOT\\s+NULL",
        "flags": "gi",
        "ignoreCommentLines": true,
        "description": "NOT A GATE - the shape-discrimination control for constraintless-table-declaration. Identical head, compliant tail: a CREATE TABLE whose column list DOES reach a NOT NULL before the statement ends. Measured 2026-08-14: 35 files / 373 matches, against the rule's 6 files / 15 matches, with ZERO match-level overlap and 2 files of overlap (files that contain both compliant and constraintless declarations, which is why a file-level signal cannot express this condition). A token-only pattern - the bare words CREATE TABLE - matches 407 across 45 files, so the shape anchors reject 392 of 407. Its purpose is to demonstrate the rule keys on the ABSENCE of integrity in the body rather than on the keyword. Deliberately carries no baseline; the registry merge skips ids containing 'positive-control'."
      },
      "floor": 900
    }
  ]
}
```

> **A runner defect found by shipping this control — and independently found and fixed,
> mid-composition, by a parallel session.** `run-census.mjs:188` dereferenced
> `rule.baseline.files` unconditionally inside `report()`, so a **correctly shaped**
> positive control — no baseline, exactly as `validateRule` (`engine.mjs:377-387`) and
> `assertRule` (`:300-302`) require — crashed the runner with `TypeError: Cannot read
> properties of undefined (reading 'files')`. I hit it building the control above and
> took the measurements by driving `scanRule`/`assertRule` directly instead. A concurrent
> composer hit the same wall, and its fix (`run-census.mjs:187-205` in the working tree)
> records the part I had **not** measured and which is worse than what I saw: the throw
> landed *after* the loop printed `FAIL` and *before* the exit-code path ran, **so
> `run-census.mjs` exited 0** — a gate that died mid-report and reported success, inside
> the runner this whole corpus uses to prevent exactly that.
> `engine.mjs:293-299` had already recorded the same omission being fixed in three
> earlier layers (*"the merger, then validateRule, now this"*) with the right lesson —
> *"a convention introduced at the authoring layer has to be pushed through every layer
> that consumes the artifact"* — and `report()` was the fourth. **Three composers in a
> row have now surfaced one of these layers by following the instruction and reporting
> the wall rather than working around it.** With the fix present, the control block below
> runs through the real runner and prints `—` for its absent baseline.

#### Fault injection against the real tree

Each row is a single-field mutation of the validated rule, run through the same engine
the runner uses.

| Induced fault | Exit | What the runner said |
|---|:--:|---|
| baseline, unmutated | **0** | `f=6 m=15 walked=963`, clean, 0.34 s |
| matcher matches nothing | **1** | `[structural] matched zero files anywhere` + both `[drift] dropped` |
| floor above the walk (`5000`) | **1** | `THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| renamed root (`src-taurii`) | **1** | `walked 0 files but floor is 900` + zero-matches + **both** stale-excludes |
| extension no longer describes the tree (`.zzz`) | **1** | same three, `walked=0` |
| silent drop (baseline claims 40) | **1** | `matches dropped 40 -> 15 (-25) without the baseline moving` |
| count rises (baseline claims 8) | **1** | `matches rose 8 -> 15 (+7)` |
| file count drifts (`baseline.files` 2) | **1** | `files rose 2 -> 6 (+4)` |
| stale `exclude` entry | **1** | `the exemption is stale` |
| `exclude` with a one-character reason | **1** | shape-rejected: *"an unexplained exemption is how an allowlist becomes a place violations go to hide"* |
| grounding removed | **1** | shape-rejected: `missing grounding` |
| **`NOT NULL` discriminator removed** | **1** | `6 → 39 files, 15 → 378 matches` |
| **statement-terminator anchor removed** | **1** | `6 → 8 files, 15 → 27 matches` |
| **both `exclude`s removed** | **1** | `6 → 8 files, 15 → 24 matches` |

Fourteen mutations, one pass, thirteen failures, each with a distinct message. The last
three matter most: they show the discriminator, the precision anchor and the exemptions
are each load-bearing, and that removing any of them is detected as drift rather than
absorbed.

**And it is actually enforced.** `package.json:51` — `"check": "… && npm run census:check
&& tsc --noEmit && eslint src/"` — and `ci.yml:111` runs `npm run check`.

### 2. The Rust test that compares a fixture to production — the PRIMARY mechanism

The census rule finds declarations with no integrity. It cannot tell a faithful fixture
from a lying one, and **A2 proves that even the sanctioned primitive can lie.** The
durable gate is a test, gated on `test-support`, in `personas-db`:

```rust
#[test]
fn the_user_fixture_matches_the_production_builder() {
    // Both builders, into two throwaway databases.
    let fixture = init_test_user_db().expect("fixture");
    let production = build_user_db_the_way_init_user_db_does();

    // Assert the INSTRUMENT before the result: a builder that produced no
    // tables would make every comparison below vacuously true.
    let n = table_count(&production);
    assert!(n >= 50, "only {n} tables in the control — the builder is broken, not the fixture faithful");

    for table in tables_of(&production) {
        let want = columns_of(&production, &table);   // PRAGMA table_info
        let got  = columns_of(&fixture, &table);
        assert_eq!(want, got, "fixture `{table}` differs from what init_user_db builds");
    }
}
```

Today this fails on `companion_turn` (16 vs 20) and would have failed the day the fourth
ALTER was added to one list and not the other. **The equivalent for the app database is
the fixture-vs-shadow comparison**: read the real column set from `init_test_db()`, then
for each of the 43 shadowed table names (a `const` list, so adding one is a deliberate
act) execute the fixture's own `execute_batch` string into a scratch connection and diff.
**Fail on a missing `NOT NULL`-no-default column** (25 sites), **fail on a column the
fixture has and production does not**, warn on any other narrowing (48 sites). Same
fail-loud precondition: assert the control has ≥ 250 tables first.

This is the assertion that would have caught A2, and it is the only mechanism in this
document that can.

### 3. REFUSED — a census rule on fixture *narrowness*

The most valuable condition here is **(B)**: *this fixture has fewer columns than the
real table*. It is real (48 sites, 560 columns), it is quantified, and **it is not
expressible as a census rule**, for a reason worth stating precisely rather than
hand-waving: the condition is a **comparison between two artifacts in different files**,
and the engine reads one file at a time by construction (`engine.mjs:176-215` opens,
matches and closes each file independently). Every single-file proxy I built and measured
either over-counts by an order of magnitude — "a `CREATE TABLE` with fewer than N columns"
matches production's own small tables — or requires the production twin. **The checker
that can express it is item 2, and it is a test rather than a script because the
comparison it needs is a `PRAGMA`, not a regex.**

### 4. REFUSED — a census rule on the primitive's own drift

Condition **(C)** — *the sanctioned fixture is a hand-copy of the production constructor*
— is a **set difference between two lists in one file**. The census engine counts
occurrences; it has no notion of "these 19 strings should equal those 7". More decisively:
after the fix in §Type-over-gate there is only **one** list, and a rule counting it would
be counting compliant code, which the engine correctly refuses to baseline (a monotone
ratchet cannot track a population that should *grow*). **This one is a type, permanently.
That is not a gap in the runner; it is the runner being right about what a ratchet is
for.**

### On severity

The census is a ratchet, not a severity ladder: it fails a run when a count moves. **No
argument is made here from warning volume, and none could be** — `npm run check` runs
`eslint src/` with no `--max-warnings` (`package.json:51`) and the pre-commit hook runs
`--quiet --max-warnings 99999` (`lefthook.yml:20`), where `--quiet` discards warnings
before they can be counted, so a warn-level rule enforces nothing at either gate at any
count. The Rust analogue is exact: clippy without `-D warnings` is a warn-level rule.
`ci.yml:283` already has `-D warnings`; what it lacks is `--all-targets`, which is
[`rust-unit-test-harness.md`](./rust-unit-test-harness.md) §7 C1 and not this path's to
fix.

## Convergence — the oracle inverted this document's hypothesis

Checked 2026-08-14 against `../brainiac` (Rust · sqlx · **Postgres/pgvector**, 8 crates,
148 `.rs` files, 372 tests) and `../personas-cloud` (TypeScript workspace + Python
FastAPI). No `cargo` was run in either.

### Physics — independently reinvented, so these clauses travel

- **"A test's schema comes from the production migration chain."** Both Rust repos
  invented it independently, against different engines, with different mechanisms.
  Personas: `migrated_template()` runs the chain once per process behind a `OnceLock` and
  `fs::copy`s the file, 524 call sites. brainiac: `brainiac_store::migrate()` is
  `sqlx::migrate!("../../migrations")`, a compile-time embed of the real migrations
  directory (`crates/brainiac-store/src/lib.rs:46-59`), called from **43 of the 43
  database-touching test files — 100%, with zero exceptions.** Two rediscoveries in two
  database engines is as strong as this oracle gets.
- **"A shared row factory must go through the production writer."** brainiac's
  `store_pg.rs:80-106` seeds through `orgs::upsert_org` / `upsert_team` / `upsert_user` /
  `upsert_member` rather than raw SQL — the same discipline as
  `test_fixtures.rs::create_test_persona`. Reinvented, so §4 step 3 is doctrine.
- **"A fixture whose shape is hand-maintained will drift."** This is the finding, and it
  is the one that makes this leaf universal — see below.

### The hypothesis this document was commissioned to confirm, and why it is wrong

The brief proposed: *both repos invented the same doctrine, but adherence is 100% vs 88%
**structurally**, because brainiac's schema lives in `.sql` files and therefore cannot be
hand-rolled in Rust — so the fix is a file format, not a convention.*

**Refuted, three independent ways.**

1. **Nothing prevents it.** All 43 brainiac test files hold a raw admin `PgPool` (60
   `PgPool::connect` sites) connected as the table-owner role and already use it for
   arbitrary DDL — `TRUNCATE`, and `DROP INDEX` at `store_pg.rs:470`. A
   `sqlx::query("CREATE TABLE …")` would compile and run today. **The file format of the
   schema has no bearing on what a Rust string literal may contain.**
2. **brainiac already hand-rolls production schema knowledge in Rust, and it has already
   drifted.** Every test file hand-maintains its own `TRUNCATE` list: **60 sites across 43
   files, 25 distinct list variants**, union 41 tables against 46 in production, with
   **5 production tables named in nobody's list** (`identities`, `knowledge_gaps`,
   `retrieval_event_memories`, `retrieval_events`, `sweep_schedules`). The resulting bug
   is documented in brainiac's own source at
   `crates/brainiac-server/tests/console_pg.rs:618`: *"`sweep_schedules` is global config
   (not in the TRUNCATE list), so a prior run of this test may have armed it."* **The
   migration chain hands tests the tables; nothing hands them the list of tables.** The
   failure this leaf is about did not disappear — it moved from DDL to cleanup
   enumeration, where it is less visible and equally drift-prone.
3. **There is no convention either.** `brainiac/CLAUDE.md` says nothing about test DDL;
   `migrations/README.md` covers append-only numbering and RLS grants and nothing about
   tests. No lint, no CI check. The adherence is emergent, not governed.

**And the tooling hypothesis is dead too.** sqlx's compile-time-checked macros —
`query!`/`query_as!`/`query_scalar!` — are used **zero** times; there is no `.sqlx/`
directory and no `SQLX_OFFLINE` anywhere; all **501** queries are runtime `sqlx::query(`.
So brainiac has **no type-level schema gate at all**, and — importantly for us — nothing
in its approach depends on a capability rusqlite lacks.

**What actually causes the 100%: the database engine's deployment model.** Postgres has no
in-process or `:memory:` mode. A brainiac test cannot *manufacture* a database; it can
only attach to one that already exists (`store_pg.rs:33-37` self-skips when
`DATABASE_URL` is unset). Once attached, `migrate()` is simply the cheapest way to be at
head — and because all 43 binaries share **one** database, a privately-created table would
leak into the next binary's run, which is the entire reason
`crates/brainiac-store/src/test_support.rs` exists. SQLite is the opposite: `:memory:` and
a temp file are *free*, so you get an empty database and filling it becomes your problem.
**That is a property of the engine, not of the file format. Move brainiac's schema into a
Rust `const` tomorrow and adherence would not move.**

So the transferable prescription is not *"put your schema in `.sql` files"* — it is
**"make the migrated database the only thing a test can obtain, and make obtaining it one
line."** Personas already has that line, with a *better* implementation than brainiac's
(one built template copied per test, versus 57 repeated `migrate()` calls). **The 8% is
a discoverability and enforcement gap, not a missing mechanism** — and, per §7 A2, on the
user-database half it is a *fidelity* gap in the mechanism itself.

### Where Personas is ahead, and where the oracle contradicts other claims

- **Personas leads on row factories.** brainiac has **zero** shared row builders and **36
  duplicated per-file `setup()`/`seed()` helpers**. `brainiac-fixtures` is not a
  row-builder crate — its `Cargo.toml` has no database dependency at all; it loads an eval
  corpus from YAML. **Do not hold brainiac up as the model here.** Personas' two shared
  functions are thin but they are shared, and §Type-over-gate is the right direction.
- **Postgres makes low-fidelity fixtures fail loudly, for free.** FK enforcement is on
  from the moment `REFERENCES` is declared; there is no session switch (and
  `session_replication_role` appears nowhere in brainiac). So the *entire* class of
  "the test passed and production would have rejected the write" is structurally absent
  there. On SQLite it is opt-in per connection, which is why §7 C1 exists and why 9
  `open_in_memory()` sites with no pragma is the sharpest live defect in this document.
- **The strict rule costs a capability, and brainiac pays it.** There are **zero**
  references to `_sqlx_migrations`, `Migrator` or `MigrateDatabase` in any brainiac test:
  every test runs the chain to head, so **brainiac cannot test a migration in isolation at
  all.** Personas can, and does — `fk_hygiene.rs:947` builds a deliberate pre-FK state to
  test the retrofit. That is why §2 carves out migration-pre-state DDL explicitly instead
  of banning `CREATE TABLE` outright.
- **`personas-cloud` offers no positive model, and one perfect negative one.** No Rust, no
  test database, no CI, and exactly one test file (`packages/shared/src/bus.test.ts`, 406
  lines, 49 cases) that **nothing runs** — no `test` script, no runner dependency, no
  `.github/`. Its fixtures are hand-built literals (`makeEvent`, `makeSub`, `:9-43`)
  mirroring TS interfaces (`types.ts:93-127`) that mirror a hand-written
  `better-sqlite3` `SCHEMA` (`orchestrator/src/db.ts:232`, 14 tables) that mirrors
  personas' Rust migration chain (78 tables in `schema.rs` alone). **Four hand-maintained
  layers, nothing comparing any pair, verified by a suite no automation invokes.** That is
  this leaf's anti-pattern in its final form, in a sibling repo describing the same domain
  objects — and it is why the clause "give tests rows through the production writer"
  matters more than any regex in §9.
- **"A green run that checked nothing" recurs everywhere.** brainiac's `_pg.rs` tests
  self-skip with `eprintln!("SKIP: DATABASE_URL not set")` when Postgres is absent, so a
  local `cargo test --workspace` can be green having verified no data plane at all — its
  own `CLAUDE.md:135-136` warns about this. Three repos, three shapes, one failure.

**Verdict on convergence, stated plainly.** The *doctrine* is physics — two Rust repos
invented it independently. The *proposed cause of adherence* is not; it is the engine's
deployment model, and the sibling that "achieved" 100% relocated the same failure into a
list it also maintains by hand. **A hand-maintained copy of production shape is the
recurring defect across all three codebases, in three different costumes: DDL here,
TRUNCATE lists in brainiac, four stacked type layers in personas-cloud. That is the
clause to export, not the regex.**

## See also

- [Rust unit test harness](./rust-unit-test-harness.md) — how a test *runs*; the lanes,
  the flags, the manifest. Its §4 newtype proposal is upstream of §7 C here and is
  endorsed, not repeated.
- [Schema change](./schema-change.md) — where a new table or column is declared. §4 step 4
  hands off to it.
- [Foreign-key policy](./foreign-key-policy.md) — what an FK must say and whether
  enforcement is on. Its §7 P1 (21 FK clauses no test can observe) and this path's §7 C1
  (9 pragma-less connections) are two sides of one defect.
- [Persisted model struct](./persisted-model-struct.md) — the 30 schema-violating INSERTs
  that §7 A1's dropped `NOT NULL`s make invisible.
- [Golden-path contract](../golden-path-contract.md) — §9's fifth failure mode ("a gate
  that points at a broken destination") is instantiated by §7 A2 and should cite it.
