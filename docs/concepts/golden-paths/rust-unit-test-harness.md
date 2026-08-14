# Golden path — Rust unit test harness

> Situation node: `platform-delivery/testing-and-workflow/rust-unit-test-harness` · [situation spine](../situation-spine.md)
> `sides: server` · recurrence **514** · Dimensions: **function · code-quality · resilience · performance · cost**.
> Composed 2026-08-14 against `master` @ `2a874e692` from a ground-truth sweep of all
> **963** `.rs` files under `src-tauri/` — every `#[test]` / `#[tokio::test]` attribute
> (**4,360** across **452** files), every `#[cfg(test)]` module (**504** across **443**
> files), every `CREATE TABLE` in Rust source (**428** occurrences, parsed
> column-by-column against the migration chain), all **5** workspace `Cargo.toml`s,
> `scripts/build/run-rust-tests.mjs`, all **7** GitHub workflows, `.gitlab-ci.yml`,
> `lefthook.yml` and `package.json`.
> **No cargo command was run** — a PreToolUse guard blocks concurrent cargo, and every
> claim that would need a compile is marked **unverified** where it appears.
> `src-tauri/target/**` and `.claude/worktrees/**` excluded from all counts.
> The **Deviations** section is a fix backlog.

> ### ⚠ Corrections to the brief that commissioned this path
>
> 1. **"CI's `cargo test` lacked `--workspace` until this wave" — TRUE and now fixed.**
>    `6cd8a87f0` (2026-08-13) added it; `ci.yml:275` now reads
>    `cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop`.
>    The commit body's estimate of "~770 tests in personas-db alone" is accurate to
>    within one: **771**.
> 2. **"30 INSERTs omitting a NOT NULL no-default column … 40 production tables have
>    shadow DDL in 32 non-migration files" — CONFIRMED, and it is bigger than that.**
>    Re-derived independently: **74** shadow `CREATE TABLE` sites in **32** files
>    covering **40** production tables, of which **2** (both in
>    `schema_vocabulary.rs`) are DDL *string literals fed to a parser under test*,
>    not fixtures. The honest fixture figure is **72 sites / 31 files / 38 tables**,
>    and **every single one is inside a `#[cfg(test)]` region** — zero leak into
>    production. Column-level comparison (new here): **47 of 74 fixtures are narrower
>    than the production table**, **561** production columns are absent across them,
>    and **26 sites omit at least one `NOT NULL`-no-default column**, which is the
>    mechanism behind the 30 INSERTs. This is the headline; see §7 A.
> 3. **"`npm run census:check` is wired into nothing" (asserted by the adjacent
>    `feature-flagged-compilation.md` Gap 8, composed hours earlier) — FALSE as of this
>    tree.** `package.json:51`'s `check` script runs `npm run census:check`, and
>    `ci.yml:111` runs `npm run check`. The census gate is live in CI. That sibling
>    path's Gap 8 should be struck.
> 4. **"`cargo test` exits 127 on Windows without an embedded manifest;
>    `npm run test:rust` embeds it post-link" — the local half is verified
>    (`run-rust-tests.mjs:92-120,194-199`), but the rationale comment is now wrong
>    about CI.** `run-rust-tests.mjs:15` says *"CI never caught it because CI runs the
>    Rust suite on Linux."* `ci.yml:186-205` runs the Rust suite on
>    **windows-latest, macos-latest AND ubuntu-24.04**, with a bare `cargo test` and
>    no manifest fixup. Either the Windows leg has been red since `6cd8a87f0` switched
>    the tests on, or the loader trap does not reproduce on that runner. **I could not
>    settle which without running cargo.** See §7 D1.
> 5. **"`validate_watch_path` has 15 assertions and no production caller" — the shape
>    is right, the numbers are low.** `engine/src/path_safety.rs` is 852 lines with
>    **48** `assert` occurrences, and **three** of its public functions are dead:
>    `validate_watch_path` (:82, whose only caller is itself dead),
>    `validate_file_watcher_paths` (:135, 0 production refs / 2 test refs) and
>    `validate_save_path` (:289, 0 production refs / **9** test refs). Repo-wide there
>    are **17** such tested-but-uncalled items; §7 E.
> 6. **A hypothesis of mine that DIED.** I scanned all 4,356 parseable test bodies for
>    tests with no assertion and no failure path — "a test that runs but cannot fail".
>    32 candidates; **every one I opened was a false positive** (delegation to an
>    `assert_*` helper, e.g. `db/src/repos/communication/events.rs:2973-3001`, or
>    `prop_assert!` inside a `proptest!{}` block, e.g.
>    `src/companion/proactive/quiet.rs:254-268`). There is **no evidence of
>    assertion-free tests in this repo**. Reported because a null result is a result.

## 1. Trigger

- "Where do I put the test for this?" / "how do I get a database in a test?"
- "`cargo test` exited 127 and printed nothing"
- "This test passes locally and fails in CI" — or the reverse
- "I need a `persona` row / a `dev_project` / a `companion_turn` to test against"
- "The test suite takes 90 seconds and it's all setup"
- "Why is clippy not complaining about this obviously-wrong test code?"
- "Is this test even running?"

If you are about to type `#[cfg(test)] mod tests`, `fn test_pool()`, `CREATE TABLE` inside
a `.rs` file, `Pool::builder()`, `Connection::open_in_memory()`, `#[ignore]`,
`#[allow(dead_code)]` above something a test calls, or any `cargo test` invocation —
you are in this situation.

### Scope, and the boundary with three adjacent paths

| Question | Owned by |
|---|---|
| How a test is written, and how it gets a database | **here** |
| Which lane actually executes it, and which lints it | **here** |
| Whether the code under test compiles at all in this build | [`feature-flagged-compilation.md`](./feature-flagged-compilation.md) |
| Where a new table/column is declared | [`schema-change.md`](./schema-change.md) |
| How a migration is applied safely at boot | [`boot-migration-step.md`](./boot-migration-step.md) |
| Whether a struct and its table agree | [`persisted-model-struct.md`](./persisted-model-struct.md) |

**Settling the overlap with `feature-flagged-compilation.md` explicitly**, because build
features and test invocation genuinely intersect. That path owns *what the flags do to
the compiled tree* — `--features desktop` being mandatory because
`capabilities/default.json:19` names `updater:default`, the `desktop` forwarding at
`Cargo.toml:39-55` that makes a bare `-p personas-db` run compile the mobile keychain
stub, and the `check-cargo-invocations.mjs` checker it specifies. **This path owns what
the flags do to the test POPULATION** — which of the 4,360 tests each lane reaches, and
the fact that `--lib` and a missing `--all-targets` silently shrink that population to
52% and 0% respectively. Two flags (`--workspace`, `--features desktop`) appear in both;
where they do, that path is authoritative on *why the flag exists* and this one on
*which tests it turns on*. §9 item 2 here does not specify a second script — it adds two
assertions to the one that path already specified. One checker, two owners.

## 2. The one way

**Get your database from `personas_db::init_test_db()` (app DB) or
`init_test_user_db()` (user DB) and never write `CREATE TABLE` in a test.** Those two
functions build a database from the *real* production schema — `migrated_template()`
(`db/src/lib.rs:1899`) runs `migrations::run` + `run_incremental` + all three seed
functions **once per test process** into a template file behind a `OnceLock`, and each
call `std::fs::copy`s it, which is why a suite that used to spend ~24 CPU-minutes on
schema setup now spends milliseconds. They are reachable from every crate: `cfg(test)`
does not cross a crate boundary, so `db` exposes them behind a `test-support` feature
(`db/Cargo.toml:35`) that the desktop crate (`Cargo.toml:277`) and the engine crate
(`engine/Cargo.toml:129`) turn on through a **dev**-dependency, so it never reaches a
release build. Put the test in a `#[cfg(test)] mod tests` at the bottom of the file it
tests — 504 modules do, and it is the only placement both local lanes reach. Then make
sure a lane actually runs it: **run `npm run test:rust` and `npm run test:rust:crates`,
never a bare `cargo test`**, because on Windows a bare `cargo test` exits 127 before
`main()` (comctl32 v6 / `TaskDialogIndirect`) and the npm script exists solely to embed
the manifest post-link. If you are writing something that is not a lib unit test — an
integration test under `src-tauri/tests/`, a doctest, a test inside a `[[bin]]` — know
that **neither local lane will ever run it**, because both pass `--lib`; only CI's
`cargo test --workspace --features desktop` will, and even CI will not run the
`personas-daemon` bin's tests because they are behind `required-features = ["daemon"]`
that nothing test-builds. Finally, if you find yourself reaching for `#[allow(dead_code)]`
so a test can call something, stop: that is the compiler telling you the thing has no
production caller, and 17 items in this tree are in exactly that state.

## 3. Mandated primitives

- **`src-tauri/db/src/lib.rs:1939` — `init_test_db() -> Result<DbPool, AppError>`.**
  The app-database fixture. Copies the once-built migrated template, then proves the
  copy is openable with a `SELECT COUNT(*) FROM sqlite_master` before handing it over
  (`:1960-1965`) — a torn copy would otherwise surface as a baffling failure in
  whichever assertion touched the DB first. **525 call sites across 70 files.**
  This is the one to copy.
- **`src-tauri/db/src/lib.rs:1899` — `migrated_template()`.** The `OnceLock<Result<PathBuf,
  String>>` behind it. Keyed by `std::process::id()` so concurrent test binaries never
  share a template; removes a stale template from a crashed run first; drops the building
  connection before the first copy is taken, because an open handle can leave a rollback
  journal on disk. Its 20-line doc comment (`:1881-1898`) is the best statement in the
  repo of why this exists.
- **`src-tauri/db/src/lib.rs:1994` — `init_test_user_db() -> Result<UserDbPool, AppError>`.**
  The `personas_data.db` counterpart (knowledge base + Athena brain). Applies
  `KNOWLEDGE_BASE_SCHEMA` **and** `COMPANION_SCHEMA` plus the post-CREATE `ALTER`s
  `init_user_db` performs, so the fixture is shaped like production. Its doc comment
  (`:1969-1979`) already states this path's whole doctrine: *"a fixture whose columns
  differ from production is a test that proves the wrong thing."*
  **Only 62 call sites across 8 files** — this is the under-used half (§7 A).
- **`src-tauri/db/src/lib.rs:1989` — `companion_schema_for_test()`.** Hands a test the
  production schema *text* so it can prove re-executing it is idempotent. The right shape
  for "test the schema itself" — you get production's string, not a copy of it.
- **`src-tauri/db/src/repos/test_fixtures.rs:9,35` — `create_test_persona` /
  `create_test_persona_id`.** Row builders that go through the real repo
  (`personas::create`), so a required field added to `CreatePersonaInput` is a compile
  error in every test at once. The only shared row-factory in the tree; there should be
  dozens.
- **`src-tauri/db/Cargo.toml:35` — the `test-support` feature**, wired from
  `Cargo.toml:277` and `engine/Cargo.toml:129` as a `[dev-dependencies]` edge. The
  mechanism that lets a fixture cross a crate boundary without shipping. Its comment
  (`db/Cargo.toml:29-34`) explains the trap it solves.
- **`scripts/build/run-rust-tests.mjs` — the ONLY supported way to run Rust tests
  locally.** `ensureManifest()` (`:92`) inspects each produced test executable, and
  embeds `scripts/build/comctl32-v6.manifest` via the Windows SDK's `mt.exe` **only if**
  the PE actually imports `TaskDialogIndirect` from `comctl32.dll` (`:101-106`) — so the
  extracted crates' binaries, which do not, are left untouched. `:17-29` documents why
  this cannot live in `build.rs`. `:212-215` pins `TS_RS_EXPORT_DIR` to an absolute path
  because the script spawns the exe from the repo root.
- **`scripts/build/inspect-pe-imports.mjs`** — the diagnostic. `node
  scripts/build/inspect-pe-imports.mjs <exe>` reports imported DLLs and whether a
  manifest is embedded. Reach for this the moment a test binary exits 127.
- **`.github/workflows/ci.yml:275` — `cargo test --workspace --manifest-path
  src-tauri/Cargo.toml --features desktop`.** The only invocation anywhere that runs the
  whole population. Its 12-line preamble (`:262-274`) naming both flags and the failure
  each prevents is the model every cargo invocation in this repo should follow.
- **`src-tauri/tests/render_plan_proptest.rs`** — the proptest harness, and the one
  integration test with a documented run recipe (`:8-12`, including
  `PROPTEST_CASES=10000`). `proptest = "1"` is declared at `Cargo.toml:280`.

**Nothing else is a primitive.** There is no `#[rstest]`, no `serial_test`, no
`cargo-nextest` config, no `tempfile` crate, no shared assertion helpers module, and no
row factory beyond `test_fixtures.rs`'s two functions.

## 4. Steps

1. **Put the test where both lanes reach it.** A `#[cfg(test)] mod tests` at the bottom
   of the file under test, inside a **lib** target. 504 modules across 443 files do this.
   `src-tauri/tests/*.rs` is reached by no local lane; a `[[bin]]`'s tests are reached by
   no local lane and, for `personas-daemon`, by nothing at all.
2. **Get the database from the fixture, not from a pool builder.**
   ```rust
   #[cfg(test)]
   mod tests {
       use super::*;

       #[test]
       fn rejects_a_duplicate_slug() {
           let pool = personas_db::init_test_db().expect("test db");
           let id = personas_db::repos::test_fixtures::create_test_persona_id(
               &pool, "Alice", "you are alice",
           );
           // …assert against the REAL schema
       }
   }
   ```
   If you need the user database, `init_test_user_db()`. If you need both — the
   portability importer does — take both; that is what the second fixture exists for.
3. **Do not write `CREATE TABLE`.** If the table you need is missing from the fixture,
   that is a *migration* bug and belongs in `run_incremental`
   ([`schema-change.md`](./schema-change.md)), not in your test module. A hand-rolled
   fixture makes the bug invisible instead of fixing it — that is the entire §7 A
   backlog.
4. **Do not run the migration chain yourself.** `crate::migrations::run(&conn)` +
   `run_incremental(&conn)` in a fixture is the *slow* correct answer; `init_test_db()`
   is the fast correct answer and produces the identical schema. 45 call sites across
   23 files still pay the slow one.
5. **Run it with the npm script.** `npm run test:rust` for the desktop lib,
   `npm run test:rust:crates` for core/db/engine. Both accept a filter:
   `npm run test:rust -- healing::`. Never a bare `cargo test` on Windows, and never
   `cargo test -p personas-db` (the `desktop` feature is forwarded from the root package,
   so a bare `-p` run compiles the mobile keychain stub — see
   [`feature-flagged-compilation.md`](./feature-flagged-compilation.md) §5).
6. **If the compiler says something is dead, believe it.** `#[allow(dead_code)]` added so
   a test can reach an item converts "nothing calls this" into silence. Either wire the
   item into production or delete it and its tests.
7. **Stop.** No `#[ignore]` without a one-line reason in the attribute and a documented
   way to run it (12 of 15 have one; 3 do not). No new test-only public surface. No
   second fixture builder — if `init_test_db()` does not give you what you need, fix
   `init_test_db()`.

### Can the primitive's signature make the wrong call impossible? — answered

The contract asks this before §9. **Yes, and it is a small change with a large blast
radius**, because the root cause of §7 A is a single line of type aliasing.

- **`DbPool` and `UserDbPool` are type ALIASES, and that is the whole defect.**
  `core/src/pool.rs:14` — `pub type DbPool = Pool<SqliteConnectionManager>;` and
  `db/src/lib.rs:157` — `pub type UserDbPool = Pool<SqliteConnectionManager>;`. So the
  pool `init_test_db()` returns and the pool `Pool::builder().build(manager)` returns are
  **the same type**, and every repo function that takes `&DbPool` accepts both. There is
  no signature anywhere that can tell "a database built from the production schema" from
  "a database a test invented". Make each a **newtype** —
  `pub struct DbPool(Pool<SqliteConnectionManager>)` with a private field and
  constructors only in `init_db` / `init_test_db` — and all **54** hand-built pools
  across **51** files become compile errors at the point they are handed to a repo
  function. The migration is mechanical (`Deref`/`AsRef` covers most call sites) and it
  converts the entire §7 A backlog from a policy into a type error. This is the same move
  `brainiac` gets for free by never having a pool alias at all (§Convergence).
- **`test_fixtures.rs` should own the row builders, and required fields should be
  required.** `create_test_persona` (`:9`) already gets this property: it goes through
  `personas::create`, so a new `NOT NULL` field on `CreatePersonaInput` breaks every test
  at compile time. Two functions is not enough — the 40 shadow-DDL tables are exactly the
  tables with no factory. Adding a factory per hot table is cheaper than adding a gate,
  and unlike a gate it also fixes the INSERT-omits-a-column class in
  [`persisted-model-struct.md`](./persisted-model-struct.md) §259.
- **A gate cannot see "this test never ran"; only the invocation can.** No type helps
  here — `--lib`, a missing `--workspace` and a missing `--all-targets` are argv, not
  source. That half stays a checker (§9 item 2), which is the honest division of labour:
  **type for the fixture, checker for the lane.**

## 5. Anti-patterns

- **`CREATE TABLE` in a test module.** 72 sites. It buys a fast, hermetic fixture and
  pays with a test that certifies a schema no user will ever have: 47 of them are
  narrower than production, 26 omit a column the real table declares `NOT NULL` with no
  default, so **the INSERT under test would be rejected by the real database and the test
  is green**. `src/engine/kb_scan.rs:184` gives `knowledge_bases` 4 of its 13 columns;
  `src/mcp_server/obsidian_vault_tests.rs:23` gives `personas` **1 of 42**.
- **Writing "minimal schema — only the tables this resolver probes" as if it were a
  design note.** `src/commands/design/connector_readiness.rs:1288` says exactly that
  above six shadow tables. It reads like discipline and is the opposite: the resolver's
  behaviour on the *other* 30 columns of `dev_projects` is what the test was for.
- **Copying a bypass rationale you did not verify.** `db/src/repos/resources/external_api_keys.rs:216-223`
  justifies skipping `init_test_db` because the table is *"dropped during
  `run_incremental`"*; `api_key_audit.rs:88-90` and `broker_edges.rs:193-194` then cite
  **that file** rather than the code. I traced every `DROP TABLE` in the chain: the tables
  dropped are `persona_executions`, `mcp_gateway_members`, `n8n_transform_sessions`,
  `persona_triggers`, `chat_messages`, `persona_groups`, `credential_rotation_policies`,
  `dev_kpi_measurements`, `workspace_practice_adoption`, `persona_memories`,
  `team_memories` and the retired skills trio — **`external_api_keys` is not among them**,
  and `initial.rs:358` creates it unconditionally with all 12 columns. (Runtime behaviour
  **unverified** — I could not run the chain. But the cited mechanism is not in the
  source, and it has propagated to two more files.)
- **`Pool::builder()` in a test.** 54 calls across 51 files. Even where the schema ends up
  right, you have re-derived `max_size`, `connection_timeout` and — critically — the
  `SqlitePragmaCustomizer`, so your connections may not carry production's pragmas.
- **Replaying the migration chain per test.** 45 calls across 23 files. Correct and
  ~30× too slow: measured at `81aba23de`, the `dev_workspaces` suite went 89.22s → 59.44s
  from the template alone (its fixtures did not use `init_test_db`) and → **2.94s once
  they delegated**. The primitive's speedup only reaches you if you call the primitive.
- **A bare `cargo test` on Windows.** Exit 127 (`0xc0000139`), no output, before `main()`.
  It is the loader, not a test. `npm run test:rust`.
- **`cargo clippy` without `--all-targets`.** `ci.yml:283` — so **504 `#[cfg(test)]`
  modules containing 4,360 test functions are linted by nothing, on any platform, ever**.
  Test code is where `unwrap()`-on-`None`, dead helpers and copy-paste live.
- **`--lib` in a test invocation that claims to be "the Rust tests".** It silently
  excludes integration tests, bin tests and doctests. `.claude/CLAUDE.md` documents
  `npm run test:rust` as "Rust unit tests (app_lib, --features desktop)" — which is
  honest — but nothing tells you the 8 files in `src-tauri/tests/` are unreachable.
- **`#[allow(dead_code)]` so a test can call it.** 17 items. `engine/src/bus.rs:298`
  carries it on `match_event_listeners`, whose **7 references are all inside its own test
  module** — seven tests certifying an event-routing wrapper production does not use.
- **`#[ignore]` with no reason string.** 3 of 15 (`src/engine/db_query.rs:3561,3578,3590`)
  say nothing; the sibling at `:3541` gets it right with `// Run with: cargo test --
  --ignored (requires Docker SRH)`.

## 6. Evidence

**Adoption of the fixture is genuinely good and worth naming: 525 call sites across 70
files use `init_test_db()`, against 72 hand-rolled DDL sites. The doctrine is ~88%
adopted for the app database.** The hole is one layer wide and it is the *user*
database.

- **`src-tauri/db/src/lib.rs:1881-1967` — read this whole block.** The doc comment states
  the problem (576 call sites × the full chain = ~24 CPU-minutes per suite), the
  mechanism (`OnceLock` template + `fs::copy`), the safety argument (no WAL ⇒ one
  self-contained file; connection dropped before the first copy), the isolation key
  (pid), and the post-copy verification. It is the reference implementation and the
  reference *explanation*.
- **`src-tauri/db/src/repos/test_fixtures.rs`** — 38 lines, two functions, and the only
  place in the tree where a test row is built through the production write path. Copy
  this pattern for `dev_projects`, `companion_turn`, `kb_documents` and the other 37
  shadow-DDL tables.
- **`src-tauri/db/src/repos/communication/sla.rs:1535-1538` and `:2016`** — the best
  *use* of the fixture: two test doc comments that assert a migration step lives inside
  `run_incremental` specifically *because* `init_test_db` builds from it, so a misplaced
  step is caught by a test rather than by a user. This is what a production-schema
  fixture buys you and it is unreachable from a hand-rolled one.
- **`scripts/build/run-rust-tests.mjs:1-45`** — 45 lines of header explaining a 3-line
  problem: the exact loader symptom, why `build.rs` cannot fix it (both cargo directives
  named, with the error each produces), and an explicit warning not to present `--crates`
  as a fast full-suite substitute. Every tool script in this repo should be this honest.
- **`scripts/build/run-rust-tests.mjs:205-215`** — the `TS_RS_EXPORT_DIR` note: spawning
  the exe from the repo root made ts-rs dump 419 stale bindings into a gitignored
  directory while `src/lib/bindings/` drifted 26 files behind. A test harness bug that
  corrupted a *build* artifact.
- **`.github/workflows/ci.yml:262-274`** — the invocation preamble. Two paragraphs, each
  naming a flag, the failure it prevents, and the measured consequence.
- **`.github/workflows/ci.yml:220-236`** — `sccache` health-check before use, because a
  cache outage took the entire Rust gate offline from 2026-07-27 and "a test-compilation
  regression reached master during the blackout." A gate that degrades instead of dying.
- **`src-tauri/tests/render_plan_proptest.rs:1-12`** — the only test file in the tree
  that documents its own acceptance criterion (≥1,000 cases per invariant) and how to
  bake it longer. It is also the one no local lane runs.

## 7. Deviations found

**Five categories, 23 individually-addressable items.** All ship green under
`npm run check`, `npm run test:rust`, `npm run test:rust:crates`, and all three Rust CI
jobs.

### A. The fixtures are not testing the real schema — 7 (the headline)

**A1 — 72 hand-rolled `CREATE TABLE` fixture sites, in 31 files, shadowing 38 production
tables.** (Raw signal: 74 sites / 32 files / 40 tables; two of those — `schema_vocabulary.rs:224,225`
— are DDL strings fed to a table-name parser under test, not fixtures.) Every one is
inside a `#[cfg(test)]` region; **zero** leak into production code. Split by database:

| | sites | files | tables | the primitive they bypass | its adoption |
|---|---|---|---|---|---|
| **app DB** (`personas.db`) | 38 | 14 | 21 | `init_test_db()` | 525 sites / 70 files |
| **user DB** (`personas_data.db`) | 34 | 19 | 17 | `init_test_user_db()` | **62 sites / 8 files** |

The user-database half is the real story: the fixture exists, is correct, applies
production's own `COMPANION_SCHEMA` text, and is used by eight files while nineteen
hand-roll around it.

**A2 — 47 of the 74 fixtures are NARROWER than the table they impersonate; 561
production columns are absent in total.** Worst offenders, measured column-by-column
against `migrations/` + `db/src/lib.rs` (including every `ALTER TABLE … ADD COLUMN`):

| Fixture | Table | cols | prod cols |
|---|---|---|---|
| `src/mcp_server/obsidian_vault_tests.rs:23` | `personas` | 1 | 42 |
| `src/companion/jobs/operations_views.rs:268` | `personas` | 2 | 42 |
| `src/companion/jobs/operations_views.rs:269` | `persona_executions` | 7 | 38 |
| `src/companion/prompt.rs:2475` | `personas` | 7 | 42 |
| `src/companion/dispatcher.rs:3845` | `personas` | 8 | 42 |
| `src/commands/design/connector_readiness.rs:1295` | `dev_projects` | 2 | 24 |
| `src/commands/infrastructure/schema_vocabulary.rs:224` | `dev_standards` | 1 | 12 |
| `src/commands/design/connector_readiness.rs:1296` | `twin_profiles` | 1 | 13 |
| `src/engine/kb_scan.rs:188` | `kb_documents` | 3 | 15 |
| `src/commands/companion/observability.rs:591` | `companion_turn` | 4 | 20 |

**A3 — 26 sites omit at least one `NOT NULL`-no-default production column.** This is the
mechanism behind the 30 schema-violating INSERTs
[`persisted-model-struct.md`](./persisted-model-struct.md):259 found: the fixture drops
the constraint, so the INSERT that the real table would **reject** passes. Examples:
`schema_vocabulary.rs:224` drops seven (`project_id, rule_key, category, title, status,
created_at, updated_at`); `connector_readiness.rs:1293` drops five on
`persona_credentials` (`name, encrypted_data, iv, created_at, updated_at`);
`kb_scan.rs:188` drops three on `kb_documents` (`source_type, title, content_hash`).

**A4 — the 27 that ARE column-identical today are the trap, not the reassurance.**
`src/companion/turn_ledger.rs:432` reproduces all 20 columns of `companion_turn`
including the four added by `ALTER` at `db/src/lib.rs:586-600`. It is correct *right
now*, by hand, in three separate files (`turn_ledger.rs:432`, `session.rs:2814`,
`athena_reaction.rs:1624`), and **nothing whatsoever keeps it correct** — the next
`ALTER TABLE companion_turn` updates production and none of the three.

**A5 — the bypass rationale in the `db` crate itself is stale (see §5).** Four sites in
three files (`external_api_keys.rs:240`, `api_key_audit.rs:104`, `broker_edges.rs:208,219,228`)
cite a `run_incremental` drop that I could not find in the source. *Runtime behaviour
unverified.*

**A6 — 45 test fixtures across 23 files replay the full migration chain by hand** rather
than copying the template: `db/src/cdc.rs:655`, `repos/core/settings.rs:391`,
`repos/dev_tools.rs:6555`, `repos/dev_tools_page_tests.rs:27`, `repos/execution/policy_evidence.rs:150`,
`repos/lab/ratings.rs:336`, `repos/resources/owned_devices.rs:478`, `.../remote_jobs.rs:417`,
`.../persona_change_log.rs:331`, `.../recipe_suggestions.rs:150`, `.../settings_audit_log.rs:132`,
`engine/src/ambient_signal_repo.rs:151`, `engine/src/cli_session_audit_repo.rs:112`,
`engine/src/p2p/remote_jobs.rs:843`, `src/commands/infrastructure/dev_tools.rs:2649`,
`.../dev_tools/ship_ingest.rs:683`, `src/engine/management_api.rs:2445`,
`src/engine/recipe_seed.rs:330`, and five more. Schema-correct, ~30× slower — the exact
population the template was built for and did not reach.

**A7 — 54 `Pool::builder()` calls across 51 files** outside `db/src/lib.rs`, so 51 files
have re-derived pool configuration (`max_size`, `connection_timeout`) and, in most cases,
omitted `SqlitePragmaCustomizer` entirely.

### B. Tests that no lane runs — 4

**B1 — both local lanes pass `--lib`, so the 34 tests in `src-tauri/tests/` run in
neither.** Eight files: `render_plan_proptest.rs` (4), `render_plan_export_parity.rs`
(14), `render_plan_integration.rs` (8), `eval_runs_data.rs` (4),
`render_plan_fixtures.rs` (1), plus three `*_bindings_gen.rs` (1 each).
`render_plan_proptest.rs:8-12` documents its own run command — which is neither script.

**B2 — the 5 tests in `src/daemon_bin.rs` run in NO lane anywhere, CI included.** The
`[[bin]]` at `Cargo.toml:269-272` carries `required-features = ["daemon"]`, and
`daemon = ["desktop-full"]`; the only invocation that builds it in the whole repo is
`scripts/install-daemon-task.ps1:48`, which is a `build`, not a `test`. These tests have
never executed.

**B3 — the reachability matrix.** Every number below is a count of `#[test]` +
`#[tokio::test]` attributes.

| Target | tests | files | `npm run test:rust` | `test:rust:crates` | `ci.yml:275` |
|---|---|---|---|---|---|
| `app_lib` (root lib) | **2,266** | 266 | ✅ | ✗ | ✅ |
| `personas-engine` lib | **968** | 85 | ✗ | ✅ | ✅ |
| `personas-db` lib | **771** | 69 | ✗ | ✅ | ✅ |
| `personas-core` lib | **321** | 24 | ✗ | ✅ | ✅ |
| `src-tauri/tests/**` | **34** | 8 | ✗ | ✗ | ✅ |
| `personas-daemon` bin | **5** | 1 | ✗ | ✗ | **✗** |
| doctests | 73 fences / 27 files (36 marked `ignore`/`no_run`/non-Rust) | — | ✗ (`--lib`) | ✗ (`--lib`) | ✅ |
| **total** | **4,360** | **452** | 52% | 47% | 99.9% |

**B4 — 15 `#[ignore]` tests, 3 with no reason and no run recipe**
(`src/engine/db_query.rs:3561,3578,3590`). The other 12 are exemplary
(`http_engine/mod.rs:120,141,186`, `context_consolidate.rs:1246,1271,1309`).

### C. Nothing lints test code — 1

**C1 — `ci.yml:283`'s clippy carries `--workspace --features desktop` and NOT
`--all-targets`, so `cargo clippy` compiles only the lib/bin targets: 504 `#[cfg(test)]`
modules across 443 files, 4,360 test functions, the 8 integration-test files and all four
bin targets are linted by nothing.** No other clippy invocation exists in the repo except
`.gitlab-ci.yml:76`, which carries none of the three flags. `../brainiac`'s single clippy
line has `--all-targets` (§Convergence) — this is the one flag that came from the control
repo, not from the subject. **Cheapest fix in this document: one word.**

### D. The harness's own documentation is wrong about CI — 2

**D1 — `scripts/build/run-rust-tests.mjs:15` says *"CI never caught it because CI runs
the Rust suite on Linux."* `ci.yml:186-205` runs it on windows-latest, macos-latest AND
ubuntu-24.04**, with `run: cargo test --workspace …` and no manifest fixup, no
`continue-on-error`, and `fail-fast: false`. `git log -S 'os: windows-latest'` shows the
Windows leg has been in the matrix since the original CI commit; `--features desktop`
arrived at `4ae2587a1` and `--workspace` at `6cd8a87f0` (2026-08-13), whose own message
warns *"Expect CI to go redder before it goes green."* So one of these is true and I
could not determine which without running cargo: **(a)** the Windows leg has been failing
at exit 127 since the tests were switched on and nobody has looked, or **(b)** the loader
trap does not reproduce on `windows-latest` and the entire `run-rust-tests.mjs` rationale
is narrower than it claims. Either way the comment that teaches every developer why the
npm script exists is **factually false about the current `ci.yml`**, which is the part
that needs no compile to establish. *Marked unverified; resolve by reading one Windows
CI log.*

**D2 — the local lanes are documented as "the Rust unit tests" without naming what they
exclude.** `.claude/CLAUDE.md` lists `npm run test:rust` / `test:rust:crates` and says
nothing about `--lib`; `run-rust-tests.mjs:32-35` describes the two lanes accurately but
also omits it. A developer running both and seeing green has run 4,326 of 4,360 tests and
has no way to know.

### E. Tested but uncalled — 9 named, 17 total

Measured from all **210** `#[allow/expect(dead_code)]` sites (172 resolvable to a named
item, 169 searchable), classifying every reference in the tree as production or
`#[cfg(test)]`. **17 items have zero production references and at least one test
reference.** A further **42** are dead even in tests.

| Item | Test refs | Note |
|---|---|---|
| `engine/src/path_safety.rs:289` `validate_save_path` | 9 | security-relevant |
| `engine/src/bus.rs:298` `match_event_listeners` | 7 | event routing; all 7 refs are in its own test module (`:514-580`) |
| `db/src/byom.rs:475` `has_blocking_errors` | 6 | |
| `engine/src/queue.rs:473` `queued_ids` · `:464` `queue_position` · `:116` `with_max_queue_depth` | 6 / 4 / 1 | three dead members of one type |
| `src/companion/brain/sync_staging.rs:76` `insert_delta` | 6 | |
| `core/src/error_taxonomy.rs:374` `default_severity` | 3 | |
| `src/engine/build_session/gates.rs:406` `intent_is_simple_periodic_report` | 3 | |
| `engine/src/path_safety.rs:135` `validate_file_watcher_paths` | 2 | the only caller of `validate_watch_path` |
| `src/companion/brain/sleep_cycle.rs:684` `run_sleep_cycle` | 2 | |

**E1 — `engine/src/path_safety.rs` is a dead security module wearing a live one's name.**
852 lines, **48 assertions**. Its three watch/save-path validators — traversal blocking,
system-directory denial, "must be under your home directory" — have no production caller,
and `engine/src/file_watcher.rs` (the 710-LOC consumer) never references the module. Worse,
**two other files re-implemented the check locally rather than importing it**:
`engine/src/desktop_bridges.rs:644` and `src/commands/credentials/vector_kb.rs:274` each
define their own `fn validate_path_safety`. The parts of `path_safety` that *are* live
(`validate_relative_fragment`, `resolve_within_root`, `validate_file_access_path`,
`ALLOWED_OCR_EXTENSIONS`) are imported by `commands/ocr/`, `commands/signing/` and
`desktop_bridges.rs` — so the module is half-alive, which is why nobody noticed the other
half.

## 8. Gaps in the primitive

1. **The fixture and a hand-rolled pool are the same type.** `DbPool` and `UserDbPool` are
   `pub type` aliases for `Pool<SqliteConnectionManager>` (`core/src/pool.rs:14`,
   `db/src/lib.rs:157`). No signature in 963 files can express "a pool built from the
   production schema". This is upstream of every item in §7 A and §4 answers it.
2. **There is no way to assert a fixture matches production.** SQLite exposes
   `PRAGMA table_info` and `sqlite_master.sql`, and the repo already has
   `companion_schema_for_test()` proving the pattern is available — but nothing compares
   a test's table to the migrated one, so a fixture can drift for years silently.
3. **`init_test_user_db()` is not the user DB's `init_test_db()`.** It applies
   `KNOWLEDGE_BASE_SCHEMA` + `COMPANION_SCHEMA` directly rather than through a
   once-per-process template, so it pays full setup per call — the exact cost
   `migrated_template()` removed for the app DB. That is plausibly *why* nineteen files
   hand-roll around it: the fast path was never built for this database.
4. **There are two row factories for 299 tables.** `test_fixtures.rs` covers `personas`
   and nothing else, so every other table's fixture is bespoke — which is how 38 tables
   ended up with shadow DDL.
5. **`--lib` is load-bearing and there is no target-set that means "everything a
   developer should run locally".** Dropping `--lib` from `run-rust-tests.mjs:185` would
   pull in the integration tests but also the bins and doctests, changing the compile
   surface and the runtime; the script's manifest fixup would need to cover more
   executables. This is a real design question, not an oversight.
6. **Cargo cannot make a test binary carry a manifest.** `cargo:rustc-link-arg-tests`
   reaches only `tests/` integration targets; the catch-all `rustc-link-arg` also hits
   the app binary (`CVT1100: duplicate resource`) and the cdylib (`LNK1327`). Documented
   at `run-rust-tests.mjs:17-29`. The post-link `mt.exe` step is the only available
   answer, and it makes `npm run test:rust` a hard dependency on the Windows SDK.
7. **The census runner cannot see an invocation.** A missing `--all-targets` or a stray
   `--lib` is argv, not source text; `run-rust-tests.mjs:179-185` builds its argv as a
   **JavaScript array**, so the substring `cargo test` never appears. §9 item 2.
8. **Nothing measures test-population size over time.** A test deleted, a module removed
   from `mod.rs`, a `#[cfg(feature)]` wrapped around a test module — all reduce the suite
   silently, and a smaller green suite looks exactly like a faster one.

## 9. The missing gate

Three items: one census rule (validated below), two assertions bolted onto a checker an
adjacent path already specified, and one refusal. **The refusal is load-bearing** — the
most valuable gate for this leaf is not a source-pattern rule and the census runner
provably cannot host it.

### 1. Census rule — `hand-rolled-fixture-ddl`

**The condition (stack-free):** *a test constructs its own copy of a production structure
instead of obtaining it from the production builder, so the test certifies a shape no
user will ever have.*

**The proxy in this repo:** a `CREATE TABLE` statement in Rust source outside the six
files that own the schema. **PRECONDITION, and an adopting repo must re-derive its own:**
this works because Personas keeps its schema as SQL text in six known Rust files and
tests build fixtures by executing SQL. A repo whose schema lives in `.sql` migration
files (`brainiac`: **zero** `CREATE TABLE` in any `.rs`, all 46 in `migrations/*.sql`), or
in an ORM model class, or in a `schema.prisma`, scores **zero** here while the same
condition is present — the equivalent proxy there is "a test fixture that does not call
the shared migrate function" (`brainiac` would key on a `_pg.rs` file that never calls
`brainiac_store::migrate`).

```json
{
  "rules": [
    {
      "id": "hand-rolled-fixture-ddl",
      "goldenPath": "docs/concepts/golden-paths/rust-unit-test-harness.md",
      "title": "A test builds its own copy of a production table instead of getting the schema from the production builder, so it certifies a shape no user will ever have",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?[\"'`]?[A-Za-z_]",
        "flags": "gi",
        "ignoreCommentLines": true,
        "description": "a CREATE TABLE statement in Rust source outside the six schema-owning files. PROXY FOR the stack-free condition: a test constructs its own copy of a production structure instead of obtaining it from the production builder. Measured 2026-08-14: 93 matches in 37 files; 72 of them are #[cfg(test)] fixtures shadowing 38 tables the migration chain already owns, 47 are NARROWER than the production table (561 production columns absent in total) and 26 omit a NOT NULL-no-default column, so an INSERT the real database would REJECT passes green — the mechanism behind the 30 schema-violating INSERTs in persisted-model-struct.md. Zero of the 74 sit in production code. The legal destination is personas_db::init_test_db() (db/src/lib.rs:1939, 525 call sites) for the app database and init_test_user_db() (:1994, only 62 sites in 8 files) for the user database; both build from the real migration chain via a once-per-process OnceLock template. KNOWN BLIND SPOT, deliberate: CREATE VIRTUAL TABLE is excluded because sqlite-vec tables cannot live in static schema text and production legitimately creates them at runtime (db/src/vector_store.rs:61, db/src/repos/core/memories.rs:1687); that hides 2 real test-side vec0 fixtures (companion/brain/embeddings.rs:559, companion/brain/keyword.rs:141). KNOWN IMPRECISION, quantified: 21 of the 93 name a table with no production counterpart — scratch tables in a SQL-generation test (src/engine/ai_helpers.rs, 6), a benchmark harness's own tables (src/bench/db.rs, 5), and DDL strings fed to the table-name parser under test (src/commands/infrastructure/schema_vocabulary.rs, 4). They are left IN the baseline on purpose: they are the same construct, a file-level exclude would blind the rule to a real fixture added to that same file later, and a new scratch table costs one `--update`. PRECONDITION: this proxy assumes schema-as-SQL-text-in-source. A repo whose schema lives in .sql migration files, an ORM model, or a schema DSL scores zero here while the condition is present at full scale — re-derive against the local schema home."
      },
      "exclude": [
        { "path": "src-tauri/db/src/migrations/initial.rs", "reason": "the production schema itself — migrations::run's first step, the thing every fixture is supposed to be built FROM" },
        { "path": "src-tauri/db/src/migrations/schema.rs", "reason": "the production schema itself — the frozen legacy fresh-install table set applied by migrations::run" },
        { "path": "src-tauri/db/src/migrations/incremental.rs", "reason": "the production migration chain — run_incremental's ddl_step/run_step bodies, replayed verbatim by the fixture" },
        { "path": "src-tauri/db/src/migrations/mod.rs", "reason": "the production migration chain's entry point and its own applied-migrations ledger table" },
        { "path": "src-tauri/db/src/migrations/fk_hygiene.rs", "reason": "the production migration chain — table rebuilds for foreign-key hygiene, also replayed by the fixture" },
        { "path": "src-tauri/db/src/lib.rs", "reason": "KNOWLEDGE_BASE_SCHEMA and COMPANION_SCHEMA — the production text for the user database, executed verbatim by init_user_db AND by the init_test_user_db fixture" }
      ],
      "baseline": { "files": 37, "matches": 93 },
      "floor": 900
    }
  ]
}
```

**Counts verified through two independent implementations before baselining, and they
disagreed.** A standalone Node parser that balances parentheses and compares each
fixture's column list against the migration chain returned **94**; the census engine
returned **93**. The difference resolved to exactly the engine's
`commentMatchesSkipped: 1` — a `CREATE TABLE` on a comment-only line that my parser
counted and the engine correctly did not. After that reconciliation the two agree
exactly. A second disagreement was found and fixed on the way: my column parser split a
column off at a comma **inside a SQL comment**
(`-- proactive trigger kind, or headless leg label`), losing the following column and
manufacturing a phantom "fixture declares a column production lacks" on `companion_turn`
in three files. Stripping `--` comments before splitting removed it. **Both disagreements
were in my implementation, not the engine's** — which is the argument for doing it twice.

Per the engine caveat, this pattern is **single-line by construction** (no `[^\]]*` or
other newline-crossing class), so the comment-skip rewind that used to eat multiline
matches cannot affect it; the one skipped match was verified to be a genuine comment.

**Fault injection against the real tree** (`node scripts/census/run-census.mjs --check
--rules <file>`), from a scratchpad file named `census-testfixture-8f3c1d.json` unique to
this composition:

| Fault | Exit | What it printed |
|---|---|---|
| clean run | **0** | `census OK — 1 rule(s), 963 file-visits, 93 surviving violation(s) across 37 file(s).` |
| matcher matches nothing (`NoSuchFixtureXYZ`) | **1** | `[structural] matched zero files anywhere…` + both `[drift] dropped` to 0 |
| floor above walk (`floor: 5000`) | **1** | `[structural] walked 963 files but floor is 5000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (`roots` → `src-tauri/db`) | **1** | `walked 144 … floor is 900` + `files 37→4`, `matches 93→6` |
| count rises (baseline lowered to 80) | **1** | `[drift] matches rose 80 -> 93 (+13)` |
| renamed root (`src-taurii`) | **1** | `walked 0 files but floor is 900` + `matched zero files anywhere` + **all six** `stale-exclude` + both drops |
| stale `exclude` (`migrations/gone.rs`) | **1** | `[structural] exclude "…/gone.rs" matched no file. The exemption is stale…` |

All seven behave as the contract requires, including the case a ratchet most needs to
catch: a *drop* is fatal, so "somebody deleted the fixtures instead of fixing them" and
"somebody broke the matcher" both go red.

**And unlike every other rule in the corpus, this one is actually enforced.**
`package.json:51` — `"check": "… && npm run census:check && tsc --noEmit && eslint src/"` —
and `ci.yml:111` runs `npm run check`. (`feature-flagged-compilation.md` Gap 8 asserts
the opposite; it is stale.)

### 2. Two assertions added to `check-cargo-invocations.mjs` — NOT a second script

[`feature-flagged-compilation.md`](./feature-flagged-compilation.md) §9 item 2 already
specifies a ~50-line `scripts/check-cargo-invocations.mjs` that reads cargo invocations as
**structured data** (YAML `steps[].run` / `script[]`, `package.json` scripts, and the argv
arrays passed to `spawn`/`spawnSync`/`execFileSync` — the only way `run-rust-tests.mjs` is
visible at all) and asserts `--features desktop` + `--workspace`. **Do not write a second
script.** Add two assertions to that one:

- **Every `cargo clippy` invocation must carry `--all-targets`.** Today: 0 of 3 do
  (`ci.yml:283`, `.gitlab-ci.yml:76`, plus the `install-daemon-task.ps1` build). This is
  §7 C1 and it is one word.
- **A `cargo test` invocation carrying `--lib` must be accompanied, in the same
  `package.json` script graph, by an invocation that does not.** Today no such
  invocation exists locally, which is §7 B1/B2. Report the excluded target count so the
  message is actionable: *"`npm run test:rust` runs the lib target only — 34 tests in
  src-tauri/tests/ and 5 in src/daemon_bin.rs are unreachable from any local script."*

Both assertions need the same fail-loud precondition the sibling path specifies: assert
the structured walk found **≥ 8 cargo compile invocations across ≥ 4 files** before
asserting anything about them, and print the audited totals on success.

Independently of the script, the **cheapest first win in this whole document** is adding
`--all-targets` to `ci.yml:283`. One word, and 504 `#[cfg(test)]` modules containing
4,360 test functions come under clippy for the first time.

### 3. A Rust test that compares every fixture to production (≈40 lines) — the durable fix

The census rule counts fixtures; it cannot tell a faithful one from a lying one. Add one
test in `personas-db`, gated on `test-support`, that closes Gap 2:

- Build a control database with `init_test_db()`; read every table's real column set from
  `PRAGMA table_info`.
- For each of the 38 shadowed table names (a `const` list, so adding one is a deliberate
  act), open the fixture's own DDL — obtainable by executing the fixture's `execute_batch`
  string into a scratch in-memory connection — and diff the column sets.
- **Fail on a missing `NOT NULL`-no-default column** (26 sites today), warn on any other
  narrowing (47 sites), and fail on a column the fixture has and production does not.
- Fail-loud precondition: assert the control database has **≥ 250 tables** before
  comparing anything (295 parse today). A `PRAGMA` that returns nothing must be a red
  test, not a green one.

This is the assertion that would have caught A4 — the three hand-maintained copies of
`companion_turn` that are correct today and have nothing keeping them so.

### 4. REFUSED — a census rule on tested-but-uncalled code

The condition is real (17 items, §7 E, including a 48-assertion security module with no
production caller) and it is **not gateable by content matching**: "no production
reference" is a whole-program property, and every text proxy I tried
(`#[allow(dead_code)]` adjacency, `pub fn` referenced only below the first `#[cfg(test)]`)
either over-counts by 12× or requires the cross-file reference graph the census engine
does not build. `feature-flagged-compilation.md` §9 item 4 refused the same rule from the
other direction. **The gate that can see it already exists and is one flag away:**
`cargo clippy --all-targets -D warnings` makes `dead_code` a build failure and makes
every `#[allow(dead_code)]` a visible, greppable exemption. `../brainiac` runs exactly
that and has **zero** `#[allow(dead_code)]` in 8 crates (§Convergence) — the suppression
count is not a cultural difference, it is a direct consequence of the flag. Fix §7 C1 and
this category becomes self-enforcing.

### On severity, if any of this ships as an ESLint rule

Ship it at `"error"`. Not because warnings drown in a large baseline — the baseline is
**1,135** ([`shared-facts.json`](../shared-facts.json)). The count-independent argument is
the only one that holds: `npm run check` runs `eslint src/` with **no `--max-warnings`**
(`package.json:51`), and the pre-commit hook runs `--quiet --max-warnings 99999`
(`lefthook.yml:20`), where `--quiet` discards warnings before they can be counted. **A
warn-level rule enforces nothing at either gate, at any count.** The Rust analogue is
exact: clippy without `-D warnings` is a warn-level rule, and `ci.yml:283` already has
`-D warnings` — it is the *target set* that is missing, not the severity.

## Convergence — what travels, and where the oracle contradicts me

Checked against `../brainiac` (Rust workspace, 8 crates, Postgres/pgvector),
`../personas-cloud` (Node orchestrator + FastAPI facade) and `../personas-web`
(Next.js). **`personas-cloud` has no Rust and no test runner at all; `personas-web` has
no Rust.** So for Rust-specific mechanics the oracle has exactly **one** comparison
point, and I say so rather than dressing a single sighting up as convergence.

**Physics — independently reinvented, so these clauses travel:**

- **"A test's schema comes from the production migration chain, never from hand-written
  DDL."** This is §2's whole prescription and **both Rust repos invented it
  independently, against different databases, with different mechanisms.** Personas:
  `migrated_template()` runs `migrations::run` + `run_incremental` + seeds once per
  process behind a `OnceLock` and `fs::copy`s the file (`db/src/lib.rs:1899-1967`), 525
  call sites. brainiac: `brainiac_store::migrate()` is `sqlx::migrate!("../../migrations")`
  — a compile-time embed of the real `migrations/` directory
  (`crates/brainiac-store/src/lib.rs:46,54`) — called **57 times from 43 test files**,
  always as `brainiac_store::migrate(&url).await.expect("migrate")`. SQLite file-copy vs
  Postgres advisory-locked truncate; same doctrine. **Two independent rediscoveries in two
  languages of database is as strong as this oracle gets with the fleet available.**
- **The DIVERGENCE is adherence, not doctrine, and it is stark.** brainiac has **0**
  `CREATE TABLE` in any `.rs` file (all 46 live in `migrations/*.sql`; the single DDL
  keyword hit in Rust is a comment at `crates/brainiac-store/src/memories.rs:143`).
  Personas has **72** fixture sites. Same prescription, 100% vs ~88% adoption — and the
  structural reason is visible: brainiac's schema *cannot* be hand-rolled in Rust because
  it does not live in Rust.
- **`--all-targets` is physics and Personas is the outlier.** brainiac's CI is
  `cargo clippy --workspace --all-targets -- -D warnings` (`.github/workflows/ci.yml:38`)
  and `cargo test --workspace` (`:40`) — no `--lib`, no feature flags, nothing to forget.
  Every Personas clippy invocation omits `--all-targets`. Downstream consequence,
  measured: brainiac has **0** `#[allow(dead_code)]` across 8 crates and **0**
  `#[ignore]`; Personas has **210** and **15**. That is not culture, it is the flag.
- **"A green run that checked nothing" recurs in every repo.** brainiac's `_pg.rs` tests
  self-skip with `eprintln!("SKIP: DATABASE_URL not set …")` when Postgres is absent
  (`crates/brainiac-store/tests/store_pg.rs:33-37`), so a local `cargo test --workspace`
  can be green having verified no data plane — its `CLAUDE.md:135-136` warns about this
  explicitly, and CI is what saves it. `personas-cloud`'s `packages/shared/src/bus.test.ts`
  is a 406-line hand-rolled harness with 49 cases that **nothing runs**: no `test` script
  in `package.json:10-18`, no `.github/` at all, and no file references it. Personas'
  `src-tauri/tests/` (34 tests, no local lane) and `src/daemon_bin.rs` (5 tests, no lane
  anywhere) are the same species. Three repos, three shapes, one failure.
- **Test binaries need cross-process serialization once they share a resource.**
  Personas keys its template on `std::process::id()` (`db/src/lib.rs:1906-1909`);
  brainiac holds a Postgres session advisory lock plus an in-binary `tokio::sync::Mutex`
  (`crates/brainiac-store/src/test_support.rs:38,49,54,81`), adopted uniformly — 89
  `serial_guard` calls across all 43 test files. Different mechanisms, same forced
  discovery, both with the failure that motivated it written into the header comment.

**Where the oracle CONTRADICTS this document — report it honestly:**

- **"A shared `test-support` feature is the way to cross a crate boundary" is local
  calibration, not doctrine.** brainiac solved the same problem by making the fixture
  data a **real workspace member** (`crates/brainiac-fixtures`, listed at `Cargo.toml:5`,
  taken as a plain `[dev-dependencies]` by four crates) and by putting `test_support.rs`
  in the *library* with a comment stating it is inert in production
  (`test_support.rs:26-29`). No feature flag, no `cfg` gymnastics. Personas' `test-support`
  feature exists because `init_test_db` lives inside the production crate; a fixtures
  crate would need no feature at all. **The §3 primitive is correct for this repo and
  should not be exported as doctrine.**
- **`--features desktop` is not a law, it is a self-inflicted axis.** brainiac's workspace
  has **zero** `[features]` tables and **zero** `cfg(feature` occurrences, so its CI has
  nothing to forget. Every Personas test invocation carrying `--features desktop` is a
  ratchet on a dependency graph choice. (This restates
  [`feature-flagged-compilation.md`](./feature-flagged-compilation.md)'s finding from the
  test side; both sweeps reached it independently.)
- **The `mt.exe` post-link manifest step has no trace anywhere else in the fleet, and
  never will.** It is a Windows-plus-tauri-plus-rfd artefact. Treat §3's
  `run-rust-tests.mjs` primitive as a **house convention**: the transferable clause is
  *"if your platform makes `cargo test` behave differently from `cargo run`, wrap it in a
  script and put the reason in the header,"* not the manifest itself.
- **`--lib` narrowing appears in no sibling.** brainiac never uses it; `personas-web`'s
  equivalent under-scoping is `vitest.config.ts:32` including only `src/**/*.test.ts` and
  excluding `.tsx`. So the *category* (an invocation that quietly tests a subset) is
  physics — three repos have one — but Personas' specific `--lib` is its own invention.
