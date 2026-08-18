---
layer: application
subject: test-harness
technique: fixture-economics
stack: rust
---

# `migrated_template()` — build-once-copy-per-test in the Rust backend

The canonical realization is `migrated_template()` + `init_test_db()` at
`src-tauri/db/src/lib.rs:1937-2005`, shipped in `81aba23de`
("build the migrated database once, copy it per test (89s -> 2.9s)").

## The economics, measured

Before: `init_test_db()` ran the **entire** migration chain per call — initial
schema, 124 `run_steps`, 378 `ddl_step` calls, three seed functions — against a
temp file, at ~576 call sites. Measured cost: ~24 CPU-minutes of pure schema
setup per suite before a single assertion, on every core at once (cargo
defaults `--test-threads` to the core count). Two concurrent suites made the
developer machine unusable.

After: the chain runs **once per test process** into a template file and each
call `std::fs::copy()`s it — a few milliseconds against seconds. Suite setup:
**89s → 2.9s**, the one-to-two-orders-of-magnitude ratio the technique names
as its health metric.

## How each rule of the technique lands in the code

- **Build once**: the template lives behind a `static TEMPLATE: OnceLock`
  (`lib.rs:1939`) — schema, incremental migrations, and the three seeders
  (`seed_builtin_tools/connectors/shared_events`) run inside `get_or_init`.
  Seeds go through the same functions production startup runs — the
  seeded-data-honesty rule (production write path, not raw inserts).
- **Copy does no logic**: `init_test_db()` (`lib.rs:1979`) is
  `std::fs::copy(&template, &tmp)` to a `Uuid::new_v4()`-named file. Not
  `:memory:` — the comment records why: the pool hands out multiple
  connections and each in-memory connection would get its own empty database.
- **Reaper + stale capital**: the template path is keyed by
  `std::process::id()` so concurrent cargo test binaries never share a file,
  and `remove_file(&path)` runs *before* building — a stale template from a
  crashed run is reaped at startup, exactly the "crashed run's reaper never
  fired" case.
- **Torn-copy hardening, both halves**: the building connection is
  `drop(conn)`-ed before any copy ("an open handle can leave the rollback
  journal on disk, and a copy taken then is torn", `lib.rs:1957-1958`) — safe
  only because the standard pragma set does **not** enable WAL, so the
  database is one self-contained file with no `-wal`/`-shm` sidecar. And every
  copy is **proved usable at handoff**: a `SELECT COUNT(*) FROM sqlite_master`
  probe (`lib.rs:1994-2001`) so a torn copy fails loudly in setup instead of
  as "a baffling failure in whichever assertion touched the database first."
- **Discard whole, never truncate**: each test owns its uuid-named copy and no
  test maintains a cleanup table-list. The counter-example the technique cites
  is real and adjacent: the sibling repo `../brainiac` truncates instead — 60
  hand-maintained TRUNCATE lists across 43 files, 25 distinct variants, 5
  production tables in nobody's list, and a documented cross-test
  contamination bug (`console_pg.rs:618`) rooted in one of the gaps. Full
  audit in `docs/concepts/golden-paths/rust-test-fixtures.md` §Convergence.

## The gate boundary

`migrated_template()` is compiled only under
`#[cfg(any(test, feature = "test-support"))]` — the fixture machinery provably
does not exist in shipping builds. Fixture rows themselves are created through
`test_fixtures.rs::create_test_persona` and friends, which call the production
repos rather than hand-writing INSERTs (some files deliberately skip
migrations and hand-write `CREATE TABLE`; `api_key_audit.rs:87` documents why
— the exception carries its justification, per the technique).
