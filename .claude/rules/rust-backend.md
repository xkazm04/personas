---
paths:
  - "src-tauri/**"
---

# Rust backend conventions

> Extracted verbatim from `.claude/CLAUDE.md` on 2026-08-24 (added there 2026-08-20 by
> the rust-refactor campaign, W0). The machine-readable twin is `.claude/conventions.json`
> → `rustRules`; the campaign plan is `docs/plans/rust-refactor.md` (local, gitignored).
> Every number below was measured at `master` on 2026-08-20 — re-measure before citing.

**The one thing to internalise before writing any Rust here: this backend's
dominant defect is not missing abstractions, it is unadopted ones.** Nearly
every layer already contains a good primitive sitting beside hundreds of
hand-rolled copies of the thing it replaces:

| Primitive that already exists | Adopted | Hand-rolled neighbour |
|---|---|---|
| `#[requires(level)]` (`macros/src/lib.rs:57`) | 241 | **1,381** hand-written `require_*_sync` guards |
| `row_mapper!` (`db/src/macros.rs`) | 45 | **2,070** raw `row.get(`, of which 799 positional |
| `QueryBuilder` (`db/src/query_builder.rs`) | 16 files | ~114 repo files hand-concatenating WHERE/ORDER/LIMIT |
| `SHARED_HTTP` / `SSRF_SAFE_HTTP` (`core/src/http_clients.rs`) | 13 | **41** ad-hoc `reqwest::Client` in 28 files, none SSRF-guarded |
| `acquire_logged` (`db/src/lib.rs:113`) | ~1, `#[allow(dead_code)]` | **1,357** bare `pool.get()`, 141 of them `.unwrap()` |
| `cli_process.rs` (subprocess chokepoint) | 5 | **145** `Command::new` |
| `run_lanes` / `LaneOutcome<T>` | **0** | 5 copies of the same worker pool |
| `extract_panic_message` | copied **26×**, exported 0× | — |
| `ReactiveSubscription` (`src/engine/subscription.rs:69`) | **41 impls — the one success** | 22 perpetual loops, 0 stoppable |

So: **reach for the existing primitive first, and a NEW shared abstraction is
only justified when it retires ≥3 hand-rolled copies in the same change.**
Primitives built ahead of their callers is exactly how `run_lanes` ended up
with zero callers and `acquire_logged` ended up under `#[allow(dead_code)]`.

#### Crate placement — by reach, not by name

Five crates under `src-tauri/`: `core` (no Personas dependency) → `db` →
`engine` → `personas-desktop` (`app_lib`), plus the `macros` proc-macro crate.
Put a module in the **lowest crate whose reach closes**. Anything that touches
`AppState`, `AppHandle`, `tauri::`, notifications, tray, or a command entry
point belongs in `app_lib` and nowhere else.

Cargo enforces acyclicity for free — a path-dependency cycle fails resolution
before anything compiles. **Placement is what is unenforced**, and it is
deliberately invisible: `src/engine/mod.rs` re-exports `personas_core`,
`personas_db` and `pub use personas_engine::*` into one namespace, so
`crate::engine::X` spans four crates and a call site cannot tell which one it
reached. Two consequences worth holding: **`crate::db` IS `personas_db` and
`crate::error` IS `personas_core::error`** (`src/lib.rs:12,18`) — reaching them
is an import, not a layer crossing; and there are **two different `engine`s**
(`src/engine/` ~97k lines inside `app_lib`, `engine/src/` ~61k in
`personas-engine`) whose top-level module names do not collide at all, which is
what makes the wildcard re-export sound and the split invisible.

Check a module's closure before moving it:
`node scripts/build/crate-split-deps.mjs --closure <module>`.
Doctrine: [`crate-layering`](../../docs/concepts/golden-paths/crate-layering.md).

#### Errors — the type is settled; the payload is not

Every `#[tauri::command]` returns `Result<T, AppError>` and picks the variant
that names the failure's **cause** (`Auth`, `NetworkOffline`, `RateLimited`,
`Forbidden`, `NotFound`, `ProcessSpawn`, `Validation`). Reach for `Internal` /
`External` only for text you genuinely do not control, and then put the
operation in the message (`"ffprobe: {stderr}"`, not `"{stderr}"`).

**1,614 of 1,655 commands already comply, so the error type is not the debt.**
The debt is the payload: **~100 commands return an untyped
`serde_json::Value`**, and **387 sites** collapse a real cause into
`AppError::Internal(format!(..))`. Never write `Result<T, String>` (33 remain,
almost all in `commands/fleet/`), never `.map_err(|e| e.to_string())`.

`AppError`'s `Serialize` impl computes the whole taxonomy at the source and
ships `{ error, kind, category, auto_fixable, failover_eligible }` — the
frontend branches on `kind`/`category` and never on message text. If you find
yourself wanting `msg.includes(...)` on the TS side, the answer is a new
`AppError` variant here.
Doctrine: [`typed-error-contract`](../../docs/concepts/golden-paths/typed-error-contract.md).

#### Commands are adapters

A command validates, makes **one** call into engine or repo, and maps the
result. A body over ~40 lines is a service function sitting in the wrong file.
Return a named `#[derive(Serialize, TS)] #[ts(export)]` struct, never
`serde_json::Value`.

**A sync command must not touch rusqlite** — that blocks the IPC worker.
1,081 of 1,655 commands are sync today and **47 of them do DB work on the IPC
thread**, including 200–335-line bodies that also hit the filesystem. Use an
async command over `spawn_blocking`.

Copy the shape from `commands/infrastructure/dev_workspaces.rs` (33 commands
averaging ~11 lines, each `require_auth_sync(&state)? → repo::fn(&state.db, …)`)
or `commands/fleet/commands.rs` (structure only — its `Result<_, String>` is
the exception, not the model). The anti-shape is a command file that is really
a service library: `commands/core/data_portability.rs` is 12,771 lines with
**9 commands and 167 functions**.
Doctrine: [`new-ipc-command`](../../docs/concepts/golden-paths/new-ipc-command.md),
[`command-naming-placement`](../../docs/concepts/golden-paths/command-naming-placement.md).

#### Data layer

A repo fn is `pub fn verb_noun(pool: &DbPool, …) -> Result<T, AppError>` in
`db/src/repos/<area>/<table>.rs`. A get-by-id returns `Result<Option<T>>` so it
can say "no such row".

- **Atomicity.** No repo fn currently takes a `&Transaction` — **zero, out of
  ~1,272** — so every repo fn acquires its own pooled connection and **every
  cross-repo write is non-atomic by construction**. When a write must be atomic
  with another, add a `pub(crate) fn verb_noun_in(tx: &Transaction<'_>, …)`
  inner fn and let the pool fn open the transaction. Use
  `transaction_with_behavior(Immediate)` whenever a read informs a write — a
  deferred transaction fails `SQLITE_BUSY_SNAPSHOT` in 0 ms and ignores
  `busy_timeout`.
- **Row mapping.** `const COLUMNS` + `row_mapper!`. Never `SELECT *` (381 sites)
  and never positional `row.get(0)` (799 sites): together they mean any
  mid-table `ALTER TABLE ADD COLUMN` silently shifts every index, and the
  migration chain adds columns routinely.
- **Queries.** `QueryBuilder` for list/filter/paginate. Roughly 480 of the 1,272
  repo fns are one of five shapes (`list_*`, get-by-id, `delete_*`,
  `ON CONFLICT` upsert, paginate) — check whether yours is a sixth before
  writing it out longhand.
- **Migrations.** There is **no version table**; each step probes its own
  postcondition (`has_column` / `has_table` / `has_index`) and must be
  idempotent. Add to `run_incremental`, not to `ensure_composite_fires_table`.

Exemplars: `db/src/repos/lab/ratings.rs`, `db/src/repos/resources/remote_jobs.rs`.
Doctrine: [`repository-crud-surface`](../../docs/concepts/golden-paths/repository-crud-surface.md),
[`transaction-boundary`](../../docs/concepts/golden-paths/transaction-boundary.md),
[`boot-migration-step`](../../docs/concepts/golden-paths/boot-migration-step.md).

#### Concurrency, panics, and who waits

- **Every spawn decides who waits.** Either keep the `JoinHandle` and surface
  `is_panic()` as that work item's outcome, or run under
  `AssertUnwindSafe(..).catch_unwind()` with a **durable** write. Today there
  are 222 spawns, 31 retained handles and 7 aborts — **165 production spawns
  discard the handle**, and 274 places start work that can die while 1 can
  report it.
- **Never hold a `std::sync` guard across `.await`** (`clippy::await_holding_lock`
  is on). Use `tokio::sync::Mutex` only when the guard genuinely must span an
  await. Treat a poisoned lock on a *cache* as recoverable
  (`unwrap_or_else(|e| e.into_inner())`) and on an *invariant* as a panic report.
- **Loops** implement `ReactiveSubscription` (41 impls — the abstraction that
  worked) or race their wait against a shutdown token inside `tokio::select!`.
  A bare `tokio::time::sleep` as a loop's only wait is not a loop you can stop.
- **Never cache a `Result` in a `OnceLock`** — it freezes the first attempt's
  failure for the life of the process, turning a transient error permanent.
- **No `.unwrap()` / `.expect()` in production code.** Three exceptions: a
  `static` initialiser over a literal, a lock whose poisoning is deliberately a
  panic report, and a documented invariant carrying `// INVARIANT:` above it.
  Tests may unwrap freely (`clippy.toml` sets `allow-unwrap-in-tests`).

Doctrine: [`background-loop`](../../docs/concepts/golden-paths/background-loop.md),
[`panic-isolation`](../../docs/concepts/golden-paths/panic-isolation.md),
[`process-global-command-state`](../../docs/concepts/golden-paths/process-global-command-state.md).

#### Tests

Get the database from `personas_db::init_test_db()` / `init_test_user_db()`.
**Never write `CREATE TABLE` in a test** — a hand-built fixture is not the
production schema, and a self-opened `Connection::open_in_memory()` has
`foreign_keys` **off**. Put the test in a `#[cfg(test)] mod tests` at the bottom
of the file it covers.

Run `npm run test:rust` (or `npm run test:rust:crates` for core/db/engine only).
**Never bare `cargo test` on Windows** — the lib unit-test binary carries no
comctl32-v6 manifest and dies in the loader with exit 127 / `0xc0000139` before
`main()`; the npm script embeds the manifest post-link.
Doctrine: [`rust-unit-test-harness`](../../docs/concepts/golden-paths/rust-unit-test-harness.md),
[`rust-test-fixtures`](../../docs/concepts/golden-paths/rust-test-fixtures.md).

#### The gates that actually run

> **`cargo fmt --check` is GREEN and enforced** — a dedicated `rust-fmt` CI job
> plus a staged-files `rustfmt-staged` pre-commit hook. Keep it that way.
>
> **`cargo clippy -- -D warnings` is GREEN**, and the whole workspace is
> enforced at zero. It reached 523 findings at the start of the 2026-08-20
> refactor campaign and was never green before that. **`--features desktop`
> compiles ONE shape** — see the warning above; run `desktop-full` before you
> believe a clean clippy.

```bash
cargo fmt --all --check --manifest-path src-tauri/Cargo.toml
cargo clippy --workspace --manifest-path src-tauri/Cargo.toml --features desktop -- -D warnings
npm run test:rust:crates          # and a targeted `cargo test -p <crate> <module>` for what you touched
npm run census:check              # 97 of 201 census rules target src-tauri; a baseline fails on a rise AND on a silent drop
cd src-tauri && cargo deny check
```
**`--all-targets` is deliberately absent**, and this line said otherwise for a
few hours on 2026-08-20. CI does not pass it, so CI lints neither the four
binaries nor any test code. Measured: adding it takes the workspace from 217 to
**437** findings, 66 of them distinct (the rest are the same dead items
re-reported per test target) — and two of the new ones are
`clippy::await_holding_lock`, which this workspace now declares at `warn` and
which `-D warnings` therefore promotes to a hard error. Both are a deliberate
`static TEST_LOCK` held across an `.await` to serialise async tests, which is
correct code. So prescribing `--all-targets` here would have named a gate that
fails on the repository's own sanctioned pattern. Widening CI to `--all-targets`
is worth doing after the dead-code wave; it needs those two sites annotated
first.

> **⚠ `--features desktop` compiles ONE shape, and it is not the one that
> ships.** `desktop-full = desktop + ml + p2p` is what CI and production build,
> and **643 of the workspace's 701 `#[cfg(feature = …)]` mentions are never
> compiled by a `desktop` run**. On 2026-08-21 a deletion wave removed ~23
> symbols whose only consumers were `ml`-gated: every gate in the repository
> stayed green and `desktop-full` failed with **56 errors**. A `rust-features`
> CI matrix now compiles `desktop-full`, `desktop,scraper` and
> `desktop,test-automation`, plus a `rust-no-features` job for the three
> library crates. **If you delete Rust, run
> `cargo check --workspace --manifest-path src-tauri/Cargo.toml --features desktop-full`
> before you believe clippy.**

`--workspace` and `--features desktop` are load-bearing on both cargo lines:
without the feature the tauri build script aborts on the updater capability
before compiling anything, and without `--workspace` only the root package is
touched. The same pair is required for `export_bindings` — **without them zero
bindings regenerate**, which looks exactly like "already up to date".
