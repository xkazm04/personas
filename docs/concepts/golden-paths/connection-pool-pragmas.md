# Golden path — Connection pool and pragmas

> Situation node: `data-persistence/schema-design/connection-pool-pragmas` ·
> [situation spine](../situation-spine.md) · recurrence 5 · risk **medium** ·
> sides: **server** · convergence: **converged**
> Composed 2026-08-17 against `master` @ `2edb8d694`. Mode 2 batch
> (`data-persistence/schema-design`), **short form** — §0, §2, §7, §9, §12.
> The quality core (two implementations per count, positive control, private
> registry, re-extraction, site-level overlap, hand verification) is
> tier-independent and was performed in full; the prose sections §1 / §3–§6 /
> §8 are what the short form drops.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri`
> (`shared-facts.json#rust.files`, re-verified with its recorded instrument at
> `2edb8d694` — no value changed). Every `Pool::builder()`, every
> `SqliteConnectionManager`, every `CustomizeConnection` impl and every
> `PRAGMA` in the tree was enumerated, with `#[cfg(test)]` ranges blanked by
> `scripts/census/lib/instruments/stripCfgTest.mjs` (line-preserving) so a
> production pool and a fixture pool are never confused. Live persistent state
> read from read-only copies of `personas.db` (331.0 MiB) and
> `personas_data.db` (16.7 MiB).
>
> **Measured by execution, not by reading.** `STANDARD_PRAGMAS` was applied
> verbatim, in order, to a fresh empty file and to an existing WAL file with a
> table, and each of the eight settings was read back before and after. The
> `foreign_keys`-inside-a-transaction no-op, the `page_size` immutability, the
> `SQLITE_OPEN_READ_ONLY` refusal set (including `ATTACH`), and
> `PRAGMA query_only`'s reversibility were each run rather than cited.
>
> **`cargo` was not run.** No live database was opened for write; the copies
> were deleted.

---

## 0 The headline: three pools, one pragma batch, eight settings — one of which cannot ever do anything, and nothing anywhere checks that the other seven took

**The good news first, because it is most of the story.** This repo has
**exactly three production pools**, and **all three go through the same
customizer**:

| pool | `db/src/lib.rs` | `max_size` | `connection_timeout` | customizer |
| --- | --- | --- | --- | --- |
| `personas.db` (app) | `:313` | **12** | 5 s | `CdcCustomizer` or `SqlitePragmaCustomizer` |
| `personas.db` re-attach (MCP sidecar) | `:383` (`open_pool_at`) | **4** | 5 s | `SqlitePragmaCustomizer` |
| `personas_data.db` (user) | `:510` | **8** | 5 s | `SqlitePragmaCustomizer` |

`STANDARD_PRAGMAS` (`lib.rs:201-208`) is a single `const`, and the two
customizers both delegate to `apply_standard_pragmas` (`:212`) rather than
hand-copying it — a drift this repo already had once and fixed (the comment at
`:194-200` names the incident). Each pool sets `journal_mode = WAL` once at
init, which is correct: `journal_mode` is persistent, so it does not belong in
the per-acquire batch, and it is not there.

**That is a better posture than the leaf's risk rating implies, and it should
be said plainly.** Sizing is reasoned in comments (`:307-312` explains why 12
and not 4; `:508-509` explains why 8 and not 2), the acquire timeout converts a
hang into a recoverable error rather than a frozen UI, and there is an idle
maintenance task (`:226-259`) that runs `PRAGMA optimize` +
`wal_checkpoint(TRUNCATE)` on both files every 300 s **only when
`ipc_in_flight() == 0`**. Live evidence that it works: the WAL files are
**820 KiB** and **4 KiB** against a 331 MiB database.

Four findings sit against that.

### 0.1 — `PRAGMA page_size = 4096` runs on every acquire and cannot ever have an effect

Executed, three ways:

```
fresh empty file        page_size 4096 -> 4096   (NO CHANGE — 4096 is SQLite's own default)
existing WAL + a table  page_size 8192 -> 8192   (NO CHANGE — silently ignored)
8192 db, set 4096, then VACUUM          -> 4096  (the ONLY way it takes)
```

`page_size` is settable only before the first table is created or across a
`VACUUM`. It is in a batch that runs on **`on_acquire`**, i.e. after the file
exists, on every one of up to 24 pooled connections, for the life of the
process. It is not harmful; it is a **statement that reads as a guarantee and
is a no-op by construction**, which is the same category of defect as a gate
that reports green while checking nothing. Live confirmation that it never
mattered: both databases are `page_size = 4096` because that is what SQLite
created them as.

> **Instrument caveat, disclosed because it nearly produced two more false
> findings.** The harness used to run this (`better-sqlite3`) sets
> `foreign_keys = ON` and `busy_timeout = 5000` itself at open, so those two
> also read "NO CHANGE" in the table above. **rusqlite does not** — SQLite's
> compiled default for `foreign_keys` is OFF. So only `page_size` is an
> unconditional no-op; `foreign_keys` and `busy_timeout` are load-bearing in
> production and read as inert only in the measuring instrument.

### 0.2 — nothing verifies that any pragma took effect, and the ancestor this code came from does

`vibeman`'s SQLite driver sets `journal_mode = WAL` and **reads it back**,
warning if it is not `wal`; sets `foreign_keys = ON` and **reads it back**,
warning if it is not `1`
(`../vibeman/src/app/db/drivers/sqlite.driver.ts:102-118`). Its comment is the
argument: *"If this silently fails to take effect, every ON DELETE CASCADE / FK
is a no-op and orphaned rows accumulate."*

`shared-facts.json#lineage.siblings.vibeman` records `vibeman` as
**`personas-ported-from-it`** — an ancestor, not a peer. So this is not two
repos disagreeing; it is **the port dropping the verification**, the same shape
as the doctrine's strongest oracle result (`personas-cloud`'s scheduler port
dropping the compare-and-set). And the predicted cost is present: this repo has
**1,030 orphaned rows** in the operator's live database
([`foreign-key-policy`](./foreign-key-policy.md) §7 P0-a). That is *not* proof
the pragma failed — the cascade findings elsewhere attribute the orphans to
code paths that bypassed the repo layer — but it is the exact class of bug the
dropped check exists to distinguish, and today **nothing in this repo can tell
the two apart**.

`execute_batch` returns `Result`, and `apply_standard_pragmas` propagates it,
so a *failing* pragma is caught. What is not caught is a pragma that **succeeds
and is ignored** — which is what `page_size` does on every acquire, and what
`foreign_keys` does inside a transaction (executed: `BEGIN; PRAGMA
foreign_keys = OFF;` leaves it at `1`, silently — the documented behaviour
`fk_hygiene.rs:185` already relies on and `FkDisabledGuard` must be constructed
outside a transaction to avoid).

### 0.3 — there is no read-only pool, and the one place a read-only handle exists is a browser's cookie file

`SQLITE_OPEN_READ_ONLY` appears **once** in 963 files:
`commands/credentials/auth_detect.rs:643-645`, opening a **copy of a Chrome
cookie database** — a foreign file, not a Personas one. **Zero of the three
production pools, and zero of the 56 test pools, open read-only.**

That matters because [`sql-console`](./sql-console.md) specified a read-only
pool as the answer a classifier cannot substitute for, and the specification
holds up under execution:

| statement, on a `SQLITE_OPEN_READ_ONLY` handle | result |
| --- | --- |
| `DELETE FROM t` | **REFUSED** — *attempt to write a readonly database* |
| `DROP TABLE t` | **REFUSED** |
| `CREATE TABLE z(a)` | **REFUSED** |
| `PRAGMA query_only = OFF` | *allowed, and inert* — the handle is still read-only |
| `ATTACH DATABASE 'other.db' AS other` | **allowed** |
| `DELETE FROM other.u` (on the attached file) | **REFUSED** |

And the rival, executed: `PRAGMA query_only = ON` on a read-write handle
refuses `DELETE`; `PRAGMA query_only = OFF` in the very next statement restores
it. **`query_only` is switchable from inside the statement stream and
`SQLITE_OPEN_READ_ONLY` is not** — which is precisely the claim
[`sql-console`](./sql-console.md) makes, now reproduced. One refinement to
carry back: **`ATTACH` is permitted from a read-only handle**, so a read-only
pool bounds *writes* but not *which files the connection can read*. If the
console's threat model includes reading a file the user did not name, the
handle needs `SQLITE_DBCONFIG_ENABLE_ATTACH` disabled or a URI with no
attach permission — a read-only open alone does not close it.

### 0.4 — the pragma set is one profile for two very different files, and three knobs are left at their defaults

`STANDARD_PRAGMAS` is applied identically to a **331 MiB** app database with
12 concurrent connections and to a **16.7 MiB** user database with 8.

- **`cache_size = -2000`** — 2 MiB of page cache, per connection, for a 331 MiB
  database. The ancestor sets **`-64000`** (64 MiB) for its main file and
  deliberately drops to `-16000` for its append-heavy hot-writes file, with the
  comment *"smaller than main DB"*. This repo has one number for both.
- **`journal_size_limit`** — **0 occurrences in 963 files.** The ancestor sets
  it on both its files (32 MiB / 64 MiB). Here the WAL is bounded only by the
  idle-maintenance `wal_checkpoint(TRUNCATE)`, which runs **only when IPC is
  idle** — so the bound is "the user stopped clicking", not a size.
- **`wal_autocheckpoint`** — **0 occurrences**; the default 1000 pages (4 MiB)
  is in force on both files, untuned and unmentioned.
- **`application_id` / `user_version`** — both **0** on both live files.
  Nothing marks these files as this app's, and nothing versions them; see
  [`boot-migration-step`](./boot-migration-step.md) for why there is no
  migration ledger to hang `user_version` on.

**Convergence — the spine says `converged`; the honest verdict is
"corroborated only by the ancestor", and the independent cohort is 0.**
Established per-leaf at composition time across all five checkouts:
`personas-cloud` and `personas-web` are excluded by lineage
(`shared-facts.json#lineage.siblings`), and `personas-web` has no self-managed
store at all (`@supabase/supabase-js` only). `brainiac` is Postgres (`sqlx`
`PgPoolOptions`, `max_connections` 1 / 2 / 8) and `ascent` is Prisma over
Postgres/DSQL/pglite — **neither manages a SQLite connection, so neither can
corroborate a pragma clause.** `vibeman` does, and it is the ancestor. So:
`busy_timeout = 5000`, `synchronous = NORMAL` and `journal_mode = WAL` agree
between this repo and `vibeman` — and that agreement is an **inherited
constraint, not independent evidence**. The clauses on which the two *differ*
(verification, `journal_size_limit`, per-workload `cache_size`) are the ones
carrying information, and on all three the ancestor is ahead.

The **pool-sizing** clause has a cohort of 2: `brainiac` sizes per purpose
(1 for a lock holder, 2 for admin sweeps, 8 for the main pool) and documents a
case where two independent 2-connection pools were created for sequential work
(`brainiac/docs/harness/refactor-bughunt-2026-07-14/srv-http-auth-main.md:49`).
This repo does the same thing well — 12 / 8 / 4 with reasons in comments. That
clause is corroborated.

---

## 2 The one way (compact)

**Define one `const` holding the per-connection pragma batch, apply it from a
single `CustomizeConnection::on_acquire` that every pool shares, set the
persistent pragmas exactly once at init, and then read back the ones whose
silent failure would be invisible.** Concretely:

- **(a) One batch, one `const`, one applier.** `STANDARD_PRAGMAS` +
  `apply_standard_pragmas` is the pattern; every customizer delegates to it.
  Never hand-copy the batch into a second customizer — this repo did once and
  the two drifted.
- **(b) Per-connection vs persistent.** `foreign_keys`, `busy_timeout`,
  `synchronous`, `cache_size`, `mmap_size`, `temp_store`, `analysis_limit` are
  **per-connection** and belong in `on_acquire`. `journal_mode`, `page_size`,
  `auto_vacuum`, `application_id`, `user_version` and `journal_size_limit` are
  **persistent** and belong in `init`, run once, on one connection. **A
  persistent pragma in the per-acquire batch is either a no-op or a repeated
  write; `page_size` is the local proof.**
- **(c) Verify the two that fail silently.** After setting them, read
  `PRAGMA foreign_keys` and `PRAGMA journal_mode` back and log an error if they
  are not `1` and `wal`. This is four lines and it is the one thing the port
  dropped. A `foreign_keys` that did not take makes every `ON DELETE CASCADE`
  in the schema a no-op, and nothing else in the system would notice.
- **(d) `PRAGMA foreign_keys` is ignored inside a transaction.** Executed and
  confirmed. So `FkDisabledGuard` (`lib.rs:173`) must be constructed **before**
  a transaction opens, never inside one — its RAII drop restores the setting,
  but only if the set worked in the first place.
- **(e) Size the pool for the longest connection hold, not for the core
  count**, and write the reason in a comment beside the number. `lib.rs:307-312`
  and `:508-509` are the shape: name the workload that forced the number.
- **(f) Always set `connection_timeout`.** Without it a pool exhaustion is a
  hang; with it, it is an error the IPC layer can surface. `POOL_ACQUIRE_TIMEOUT`
  is 5 s and `acquire_logged` (`db/src/lib.rs:113-142`) already logs the slow
  and failed acquires. **Corrected 2026-08-21: this clause called that function
  `pool_get_logged`, and no such symbol exists in 963 `.rs` files.** It also has
  exactly one caller (`db/src/vector_store.rs:127`, behind the `ml` feature) and
  carries `#[allow(dead_code)]` because of it — so the timeout this clause wins
  is then discarded by 323 unwrapped checkouts. See §9's
  `pool-get-unwrapped`, which is the ratchet on that second half.
- **(g) If a caller only reads, give it a pool opened with
  `SQLITE_OPEN_READ_ONLY`** — not `PRAGMA query_only`, which the caller's own
  next statement can switch off. Executed above. Note that `ATTACH` remains
  permitted; a read-only handle bounds writes, not reach.
- **(h) Bound the WAL by size, not only by idleness.** Set
  `journal_size_limit` at init. An idle-triggered `wal_checkpoint(TRUNCATE)` is
  a good optimisation and a poor bound: a user who never goes idle never
  truncates.
- **And then stop.** Do not build a second pool for a fixture — call
  `init_test_db()` / `init_test_user_db()`, which go through the same
  customizer. 52 of 56 hand-built test pools do not, and that is §9's
  population.

---

## 7 Deviations

### D1 — `PRAGMA page_size = 4096` in the per-acquire batch is a no-op by construction · executed

`lib.rs:203`. Measured three ways in §0.1. Runs on every acquire across up to
24 pooled connections. **Fix:** delete the line, or move it to `init` *before*
the first table is created, where it would at least be meaningful on a fresh
install. Behaviour-changing on neither path, but it is a fact about the file
rather than a per-connection setting and it does not belong in this batch.

### D2 — nothing reads back `foreign_keys` or `journal_mode` · read, and contrasted with the ancestor

Covered in §0.2. `execute_batch`'s `Result` catches a pragma that *errors*; it
cannot catch one that succeeds and is ignored. The ancestor's driver does the
read-back for exactly the two settings whose silent failure is invisible.
**Fix:** four lines in `apply_standard_pragmas` and in each `init_*` — a
`query_row("PRAGMA foreign_keys")` and a `query_row("PRAGMA journal_mode")`
with a `tracing::error!` on mismatch. Not applied here: it changes what the app
logs at boot while the operator is using it, and the runbook's line is that a
note costs a paragraph.

### D3 — no read-only pool exists · counted

Zero of 3 production pools and zero of 56 test pools use
`SQLITE_OPEN_READ_ONLY`. The single occurrence in the tree
(`auth_detect.rs:643`) opens a *copy of a browser cookie file*. This is the
concrete missing primitive behind [`sql-console`](./sql-console.md)'s
prescription: there is no `open_readonly_pool_at(path)` beside
`open_pool_at(path)` (`lib.rs:381`), so any surface that wants a read-only
handle today must construct one by hand and will not.

### D4 — 52 of 56 test pools bypass the customizer, so their connections have `foreign_keys` OFF · counted, two implementations

**56** `Pool::builder()` sites are in test scope, **52 with no
`connection_customizer`**, **48** of them in the single-chain form
`Pool::builder().max_size(N).build(manager)` which by construction cannot carry
one. rusqlite's default is `foreign_keys = OFF`, so those fixtures cannot
observe a cascade or an FK violation. The four that *do* attach the customizer
are `lib.rs:1988` / `:2036` (`init_test_db` / `init_test_user_db` — the
sanctioned fixtures, gated `#[cfg(any(test, feature = "test-support"))]`),
`cdc.rs:648` and `change_journal.rs:605`. This corroborates
[`foreign-key-policy`](./foreign-key-policy.md) §7 (*"21 FK constraints that no
test can ever observe"*) and
[`rust-test-fixtures`](./rust-test-fixtures.md) §7-A from the connection side:
the fixtures are not merely missing schema, their **connections are configured
differently from production**. §9 gates it.

### D5 — one pragma profile for two files with a 20× size difference · measured

`cache_size = -2000` (2 MiB) on a 331 MiB database with 12 connections and on a
16.7 MiB database with 8. `mmap_size = 268435456` (256 MiB) on both.
`temp_store = 2` (memory) on both. The ancestor runs 64 MiB on its main file
and deliberately drops to 16 MiB on its append-heavy one, with the reason in the
comment. **This is a tuning observation, not a defect** — no measurement here
shows the 2 MiB cache costing anything, and the idle `PRAGMA optimize` +
`analysis_limit = 1000` combination is a genuinely good pairing this repo has
and the ancestor does not. Recorded so the number is a decision rather than an
inheritance.

### D6 — `journal_size_limit` and `wal_autocheckpoint` are never set · counted

**0 occurrences of each in 963 files.** WAL growth is bounded only by the
default 1000-page autocheckpoint and by `spawn_idle_maintenance_task`'s
`wal_checkpoint(TRUNCATE)`, which is gated on `ipc_in_flight() == 0`. Live
WALs are healthy (820 KiB / 4 KiB), so this is latent rather than firing —
and the gate means the one path that truncates is exactly the path a busy
session never reaches.

### D7 — `open_pool_at` inherits WAL rather than asserting it · read

`lib.rs:381-389` builds the MCP sidecar's pool with the shared customizer but
never sets `journal_mode`. That is correct today — `journal_mode` is persistent
and the windowed app set it — and the doc comment states the precondition
("the caller is expected to have verified the schema already exists"). It is
listed because the precondition is *assumed and not checked*: if the sidecar
ever runs against a file the app has not opened, it gets a rollback-journal
database and cross-process WAL contention silently becomes cross-process
locking. One `query_row("PRAGMA journal_mode")` would make the assumption
observable.

### D8 — `application_id` and `user_version` are both 0 · measured

On both live files. `application_id` is the standard "this file belongs to
application X" marker and costs one statement at init; `user_version` is the
conventional migration counter this repo deliberately does not use
([`boot-migration-step`](./boot-migration-step.md) §2 — *"There is no ledger —
no `schema_migrations` table, no `PRAGMA user_version`"*, which is a reasoned
choice and is **not** re-litigated here). Only `application_id` is proposed.

---

## 9 The missing gate

**The condition:** *a database connection pool is constructed without the
shared connection customizer, so its connections run on the driver's defaults
rather than the application's — `foreign_keys` OFF included.*

The signal is a **manifestation**: it keys on the `r2d2` builder idiom in Rust
(`Pool::builder().max_size(N).build(manager)`). A repo using a different pool
library, or one whose pragmas are applied at `Connection::open`, must re-derive
its own proxy for the same condition — *this connection was not configured the
way production configures connections.*

**Why this signal.** It has **100% precision by construction**: the pattern
matches a builder chain that reaches `.build(` with nothing but `.max_size()`
in between, and such a chain provably cannot have attached a customizer or a
timeout. It is not a heuristic about formatting; the terminating `.build(` is
what makes it sound. Its positive control is the compliant half of the same
anchor — a `Pool::builder()` chain that *does* reach `.connection_customizer(`.

**Registered checks this was compared against, at SITE level, against the
FINAL pattern:** all **87** registered rules with a `src-tauri` root and `.rs`
extensions. One overlaps at all — `untimed-repo-query`, 6 lines, **0.1% of its
own matches** and 6.8% of mine, purely because a broad repo-function rule spans
lines a pool constructor also occupies. `optional-store-handle`
([`second-database`](./second-database.md)) is the nearest *conceptual*
neighbour and shares **0** sites: it is about `Option<DbPool>` in a signature,
this is about how a pool is built. No merge warranted.

**Validation performed** (private scratch registry, filename unique to this
composer; the full registry was NOT run):

- baselines reproduce exactly — `45 files / 48 matches`; positive control
  `3 files / 7 matches`;
- two independent implementations of the population agreed: the
  instrument-based pass (`stripCfgTest` + per-line classification) reported
  **3 production pools / 56 test pools, 52 without a customizer**, and the
  raw-text census pattern reported **48** single-chain sites — the 4-site
  difference is exactly the multi-line chains that carry a
  `connection_timeout` but no customizer, which the census pattern
  deliberately does not claim;
- hand-verified: all 3 production pools opened and read; all 7 customizer
  sites opened and read;
- fault injections, all by exit code: baseline −1 (rise) → **1**; baseline +1
  (silent drop) → **1**; `floor: 99999` → **1**; pattern matching nothing →
  **1**; control given a `baseline` → **1**; stale `exclude` → **1**;
  unmodified `--check` → **0**;
- re-extracted from this finished document and re-run: identical.

**How it fails loudly if its own precondition is absent.** `floor: 900` against
963 walked `.rs` files — if the walk shrinks, the run fails as *"the matcher is
broken, not the codebase clean"*. The positive control is the second guard: if
it ever falls toward zero while the gate holds, the customizer has been renamed
or removed and the gate is now measuring nothing while reporting a stable
count. **That is the failure this rule is most exposed to**, because its
compliant population is only 7 sites in 3 files.

**Deletion condition:** this rule **can reach zero** — every one of the 48 is a
fixture that should be calling `init_test_db()` / `init_test_user_db()`
instead. The census cannot express "must be zero", so at a count of 1, convert
the last site and **delete the rule** rather than baselining it at 0.

```json
{
  "id": "uncustomized-connection-pool",
  "goldenPath": "docs/concepts/golden-paths/connection-pool-pragmas.md",
  "title": "A pool built as Pool::builder().max_size(N).build(manager) in one chain, which by construction can carry no connection customizer — so its connections run on rusqlite's defaults, foreign_keys OFF included.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "Pool::builder\\(\\)\\s*\\.max_size\\(\\s*\\d+\\s*\\)\\s*\\.build\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "An r2d2 builder chain that reaches .build( with nothing but .max_size() in between, so it provably attaches neither a connection_customizer nor a connection_timeout. PROXY FOR the stack-free condition: a connection pool configured differently from the one production uses, so anything it proves is proved under different rules. CONCRETELY HERE: rusqlite's default is foreign_keys = OFF while every production pool runs STANDARD_PRAGMAS with foreign_keys = ON, so a fixture on such a pool cannot observe a cascade or an FK violation - which is the connection-side half of foreign-key-policy's '21 FK constraints that no test can ever observe'. Precision is 100% by construction: the terminating .build( is what makes the absence provable rather than heuristic. Anchor: 59 Pool::builder() sites; 3 are production and all 3 carry the customizer.",
    "note": "THIS RULE CAN REACH ZERO - every site should be calling init_test_db()/init_test_user_db(), which go through SqlitePragmaCustomizer. Delete it at 1 rather than baselining at 0 (the census cannot express must-be-zero). Site-level overlap against all 87 registered src-tauri/.rs rules: untimed-repo-query 6 lines (0.1% of theirs); optional-store-handle, the nearest conceptual neighbour, shares 0 sites."
  },
  "baseline": { "files": 45, "matches": 48 },
  "floor": 900
}
```

```json
{
  "id": "uncustomized-connection-pool-positive-control",
  "goldenPath": "docs/concepts/golden-paths/connection-pool-pragmas.md",
  "title": "CONTROL — a Pool::builder() chain that does attach a connection_customizer. The compliant half of the same anchor.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "Pool::builder\\(\\)[\\s\\S]{0,300}?\\.connection_customizer\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "The COMPLIANT half of the same anchor — a builder chain that reaches .connection_customizer( within 300 characters. Carries no baseline by design (the merger skips controls and validateRule rejects a control with a baseline). ITS POPULATION IS ONLY 7 SITES IN 3 FILES, so it is the more fragile of the pair: if the customizer is ever renamed, this control silently drops to zero while the gate above keeps reporting a stable count. A drop here means the pair has stopped discriminating, not that the codebase improved."
  },
  "floor": 900
}
```

### The second census rule — `pool-get-unwrapped`

§2 (f) is the clause that says a checkout can fail: *"Without it a pool
exhaustion is a hang; with it, it is an error the IPC layer can surface."*
Setting `connection_timeout` is only the first half of that sentence. The second
half is whether the **call site** does anything with the error the timeout now
produces — and 323 of them convert it straight back into a hang's louder cousin,
a panic, which is how the clause is defeated without touching the pool
configuration it prescribes.

**Three numbers make this a gate rather than an opinion.** The compliant shape
is present and dominant: **1,650 checkouts across 246 files propagate** (`?`,
`.map_err(`, `.await`) against **323 across 92** that `.unwrap()`/`.expect(`.
The *named* primitive, on the other hand, is a ghost. **§2 (f) above called it
`pool_get_logged`; there is no such symbol in 963 `.rs` files.** The real one is
`acquire_logged` (`db/src/lib.rs:113`), it carries `#[allow(dead_code)]`, and it
has exactly **one** caller — `db/src/vector_store.rs:127`, behind the `ml`
feature, so in a default build it is dead. A prescription that names its
primitive wrongly and whose primitive has one feature-gated caller is not a
convention anyone could have followed. (The `pool_get_logged` name is corrected
in §2 (f) as of this composition; it was wrong from the document's first draft.)

**Precision, hand-measured, 27/27.** The receiver vocabulary was enumerated
exhaustively rather than sampled — exactly **seven** identifiers ever carry a
no-argument `.get()` followed by an unwrap in this tree (`pool` 293, `target`
17, `target_user` 5, `user_db` 3, `sys` 2, `p` 2, `source` 1) — and **all 13
non-`pool` sites were opened individually**, plus a 14-site systematic sample of
the `pool` population. All 27 are `let conn = X.get().unwrap()` on a database
pool. The empty argument list is the whole discriminator: `Map::get` and
`Vec::get` always take a key.

**Two independent implementations agree at 92 files / 323 matches** — the census
engine, and a hand-written walker with its own directory recursion, its own
comment filter and its own line mapping, sharing no code with
`scripts/census/lib/`. The recovered-from-history figure was **327**; the
difference is real and is attributed exactly — `6c54af125` fixed two sites and
`4bf1845d7` (the 72-command deletion) removed two more, which also took the walk
from 969 files to 963. **The earlier description's own receiver breakdown did
not sum** (244 + 28 = 272, against a stated total of 327); it is recorded here
rather than reconciled, and the seven-identifier enumeration above is the one
that adds up.

```json
{
  "id": "pool-get-unwrapped",
  "goldenPath": "docs/concepts/golden-paths/connection-pool-pragmas.md",
  "title": "A connection-pool checkout is unwrapped, so pool exhaustion or an acquire timeout aborts the thread instead of surfacing as an error the caller can report",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*\\.get\\(\\)\\s*\\.\\s*(?:unwrap\\(\\)|expect\\()",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A no-argument .get() followed by .unwrap() or .expect( -- an r2d2 pool checkout whose failure is converted into a panic. PROXY FOR the stack-free condition: the one operation in a persistence layer that is EXPECTED to fail under load -- waiting for a free connection -- is written as if it cannot, so the system's response to saturation is a crash rather than backpressure or an error the caller can report. CONCRETELY HERE this is the second half of clause 2(f): POOL_ACQUIRE_TIMEOUT (db/src/lib.rs:94) is 5s and IS set on all three production pools (:315, :385, :511), so r2d2's get() returns Err rather than hanging -- and then 323 call sites turn that Err into a panic inside whatever thread reached it, which defeats the clause without touching the pool configuration the clause is about. COMPLIANT SHAPE, present and dominant: 1650 propagating checkouts across 246 files (`pool.get()?`, `.map_err(`, `.await`), e.g. every repo function in db/src/repos. VIOLATING SHAPE: `let conn = pool.get().unwrap();` -- commands/core/data_portability.rs:10659, companion/turn_ledger.rs:753, db/src/repos/execution/policy_evidence.rs:148 (`.expect(\"conn\")`). THE NAMED PRIMITIVE IS A GHOST, and this is the finding the count sits on: this document's clause 2(f) called it `pool_get_logged`, which does not exist in 963 .rs files; the real symbol is `acquire_logged` (db/src/lib.rs:113), it carries #[allow(dead_code)], and its ONLY caller is db/src/vector_store.rs:127 behind the `ml` feature -- dead in a default build. MEASURED 2026-08-21 at b7fba447f: 323 matches across 92 of 963 files. PRECISION 27/27 hand-verified: the receiver vocabulary was enumerated EXHAUSTIVELY rather than sampled -- exactly seven identifiers ever appear (pool 293, target 17, target_user 5, user_db 3, sys 2, p 2, source 1) -- and all 13 non-pool sites were opened individually plus a 14-site systematic sample of the pool population; every one is `let conn = X.get().unwrap()` on a database pool. The EMPTY ARGUMENT LIST is the whole discriminator and is what keeps collections out: Map::get and Vec::get always take a key. KNOWN FALSE-POSITIVE SURFACE, stated rather than papered over: OnceLock::get().unwrap() and Cell::get().unwrap() have the same shape and would count; neither appears in this tree today, and if one arrives the honest response is to anchor the receiver list, not to raise the baseline. 10 of the 92 files are named *_tests.rs; they are counted, because a fixture that panics on acquire hides the same saturation the product would. TWO INDEPENDENT IMPLEMENTATIONS agree at 92/323 -- the census engine and a hand-written walker with its own recursion, comment filter and line mapping. A THIRD, line-oriented grep scores 266, 57 fewer, and the entire gap is chains split across lines (pool.get() newline .unwrap()), which a line-oriented tool cannot see and this whole-file matcher can; that ~18% invisible fraction is the reason the engine matches whole files. HISTORY: an earlier measurement recorded 327 at f0bed7a96; 6c54af125 fixed two sites and 4bf1845d7 removed two more (and took the walk from 969 to 963), which accounts for the delta exactly. PRECONDITION (must be re-derived per repo): this repo checks connections out of an r2d2 pool by hand at the call site. A repo whose handler is HANDED an already-checked-out connection, or whose checkout lives inside one wrapper, has the condition designed out and scores zero. LEGAL FIX, in order: (1) propagate -- pool.get()? with From<r2d2::Error> for the local error type; (2) call acquire_logged(&pool, \"label\") so a slow or failed acquire is observable, and delete its #[allow(dead_code)] once it has more than one caller; (3) best, take the checkout out of the call site entirely and hand callers a connection the layer already owns. Do NOT silence a match with unwrap_or_else(|_| panic!(..)) -- same outcome, and the anchor stops firing."
  },
  "baseline": { "files": 92, "matches": 323 },
  "floor": 900
}
```

**Floor rationale, and why it is 900 again.** The walk reports **963** `.rs`
files, matching `rust.files` in [`shared-facts.json`](../shared-facts.json).
`floor: 900` is what all the other `src-tauri`-rooted rules use, including
`uncustomized-connection-pool` directly above; two rules over one root must not
hold two opinions about what "the Rust tree is intact" means.

**Deletion condition — unlike its neighbour, this rule cannot reach zero and
should not be expected to.** A test that deliberately asserts a panic, and a
`main`-adjacent site where there is genuinely no caller to report to, are
legitimate. It is a ratchet on the 323, not a march to nothing.

**A second instrument, which the census cannot host.** D2's condition — *no
code reads back a pragma it set* — is an absence, and a census rule that
matches nothing fails structurally (doctrine §4). The right instrument is a
**boot-time assertion**, not a static check: after `apply_standard_pragmas`,
`query_row("PRAGMA foreign_keys")` and `query_row("PRAGMA journal_mode")` and
`tracing::error!` on mismatch. That is the ancestor's design, it is four lines,
and — unlike a static gate — it observes the actual behaviour rather than the
presence of the statement that was supposed to cause it.

---

## 12 Corrections to the brief, and to prior claims

1. **The brief asked whether `foreign_keys` is ON, "because the CASCADE
   findings depend on it". It is ON for all three production pools and OFF for
   52 of 56 test pools — and the second half is the finding.** The cascade
   findings in [`foreign-key-policy`](./foreign-key-policy.md) and
   [`delete-semantics`](./delete-semantics.md) hold in production. What does
   not hold is the assumption that a test could have caught a cascade
   regression: most fixtures build their own pool, and rusqlite defaults FK
   enforcement OFF.
2. **The brief said "multiple pools exist (`UserDbPool`, the second pool
   handed through a `OnceLock`)". Partly corrected.** `UserDbPool` is a **type
   alias**, not a pool — `pub type UserDbPool = Pool<SqliteConnectionManager>`
   (`lib.rs:157`); it is the same r2d2 pool type as `DbPool`, which is
   [`second-database`](./second-database.md) §7 P1-c's point ("the signature is
   not the boundary"). And `memory_recall.rs:47`'s `OnceLock` does not
   construct a pool; it **holds a clone of the pool `init_user_db` built** so
   nine functions can reach it without a parameter. So the count is **three
   pool constructions, two databases, three handles**, not four pools.
3. **The brief asked whether a read-only pool exists. It does not — zero of 59
   `Pool::builder()` sites.** The single `SQLITE_OPEN_READ_ONLY` in the tree
   opens a copy of a browser cookie file, which a search for the flag alone
   would have counted as a hit. Naming what it opens is the difference between
   "the repo knows this flag" and "the repo uses it for its own data".
4. **[`sql-console`](./sql-console.md)'s claim about `PRAGMA query_only`
   is REPRODUCED, and extended in one place.** Executed: `query_only = ON`
   refuses `DELETE`; `query_only = OFF` in the next statement restores it;
   a `SQLITE_OPEN_READ_ONLY` handle refuses `DELETE`/`DROP`/`CREATE` and cannot
   be switched off from inside. **The extension: `ATTACH` is permitted from a
   read-only handle** (writes to the attached file are still refused). So a
   read-only pool bounds *what a statement can change*, not *what it can
   reach* — worth stating wherever the console's threat model includes reading
   an unnamed file.
5. **A sibling sweep run through `rg` in bash returned zero for all five
   repos, and the control search returned zero too — `rg` is not on `PATH` in
   this shell.** Had the control not been run, this document would have
   reported *"0 of 5 siblings set any pragma"*, a fabricated fleet-wide silence
   and one of the convergence oracle's named failure modes. Every sibling claim
   above was re-taken with the `Grep` tool.
6. **The spine's `convergence: converged` label is CONTRADICTED — cohort 0
   for the pragma clause.** Neither independent sibling (`brainiac`, `ascent`)
   manages a SQLite connection at all; the only corroborator is `vibeman`,
   which `shared-facts.json` records as this repo's **ancestor**. Per doctrine
   §5 that is one data point wearing two coats. This is the fourteenth-plus
   `converged` label tested and it fails in the *"the only corroborator was our
   own lineage"* mode — with the twist that here the lineage runs the other way
   (we are the port), so the ancestor's extra care is evidence of something
   **dropped in transit** rather than of something not yet learned. The
   **pool-sizing** clause is separable and *is* corroborated at cohort 2. A
   single enum field cannot carry a verdict that splits by clause — the same
   conclusion the doctrine already records for `cross-device-pairing`.
7. **Correcting my own measurement of `STANDARD_PRAGMAS`.** The first read-back
   showed `foreign_keys`, `busy_timeout` and `page_size` all unchanged and I
   was one sentence from reporting **three** no-ops. `better-sqlite3` sets the
   first two itself at open; rusqlite does not. Only `page_size` survives as an
   unconditional no-op, and it survives on an argument that does not depend on
   the harness at all (it is immutable after the first table, verified against
   an 8192-page database and a `VACUUM`). **A measurement whose instrument
   shares a default with the thing being measured cannot distinguish "already
   set" from "did nothing".**
