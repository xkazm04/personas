# Golden path — Repository CRUD surface

> Situation node: `data-persistence/repository-access/repository-crud-surface` ·
> [situation spine](../situation-spine.md) · recurrence **184** · convergence `mixed` · risk medium ·
> dimensions **code-quality · function · ui** · **two-sided** (`mergedFrom`: *Repository read/write
> functions* + *Error mapping at the repo boundary*).
> Composed 2026-08-14 from a ground-truth sweep against `master`.
>
> **Sweep size.** All **116 `.rs` files under `src-tauri/db/src/repos/`** parsed with a brace-matching
> scanner: **2,207 `fn` declarations**, of which **1,280 are `pub` and outside `#[cfg(test)]`** (930
> private, 616 inside test modules). Every one of the 1,280 had its first parameter, full parameter
> list, return type and complete body extracted and classified. Plus: all **308 `CREATE TABLE`
> names** in the tree joined to every `INSERT`/`UPDATE`/`DELETE` statement in `src-tauri/**` to
> establish table ownership; the `AppError` definition and its `Serialize` impl; the five CRUD macros
> in `db/src/macros.rs`; **1,806 `&state.db` call sites across 191 files**. Numbers shared with other
> paths are cited from [`shared-facts.json`](../shared-facts.json), not re-derived. `target/**` and
> `.claude/worktrees/**` excluded throughout. **Two independent parses agree on 308 tables** — mine
> and [persisted-model-struct](./persisted-model-struct.md)'s — which is the only reason to trust
> either.
>
> **A convergence sweep** ran read-only against `brainiac` (Rust · sqlx · Postgres — the strong
> oracle), `personas-cloud` (TS · better-sqlite3), `personas-web` (TS · Supabase), `vibeman`
> (TS · better-sqlite3) and `ascent` (TS · Prisma). **It corrected a premise in the brief, supplied
> the type-level fix for this leaf's worst defect, and contradicted the obvious reading of §7's
> headline finding.** Every load-bearing sibling claim below was re-measured by hand (§6).
>
> The **Deviations** section is a fix backlog.

## 1 Trigger

- "I'm adding a table — where do its reads and writes go?" / "make a repo module for X"
- "Should this be `get_` or `list_`?" / "what do I call the function that saves this?"
- "What should this return — the row, a bool, or nothing?"
- "The delete succeeded but the item is still there" / "Save said OK and nothing changed"
- "The toast says `Database error: Query returned no rows`"
- "Do I `map_err` this, or does `?` handle it?"

If you are about to type `pub fn <verb>_<thing>(pool: &DbPool, …) -> Result<…, AppError>` inside
`src-tauri/db/src/repos/`, a new file under that directory, `conn.execute("UPDATE … WHERE id = ?1")`,
`.map_err(AppError::Database)`, or `crud_get_by_id!(` — you are in this situation.

### Scope decision — the seam with `partial-update-semantics` and `upsert`

Two sibling leaves in this subdomain are unwritten: **`partial-update-semantics`** (149) and
**`upsert`** (106). **Both are genuinely separate procedures. This path absorbs neither, and the seam
is drawn on one question:**

> **Does the decision change what a caller sees without opening the function, or does it change one
> statement inside it?**

That is the same *kind* of seam [new-ipc-command](./new-ipc-command.md) drew with
[command-naming-placement](./command-naming-placement.md) on "does this decision have a wire
consequence", and it survives measurement here:

| | This path owns | The sibling owns |
|---|---|---|
| **`partial-update-semantics`** | that an update takes **one input struct, not 18 positional parameters** (`dev_tools.rs:1` `update_project` has 18; 74 pub fns take ≥8); that it **returns the refreshed entity** (52 of 93 `update_*` do, 30 return `()`); that a missing row is `NotFound` | how each field of that struct spells **leave-alone vs set-to-NULL**. The repo has **three unreconciled answers** and none is mine to pick: `Option<Option<T>>` (**238 sites / 30 files**), `COALESCE(?N, col)` (**109 sites**, 75 in repos), and a hand-written `merge_clearable` where `Some("")` means clear (`resources/notification_subscriptions.rs:155-163`). `push_field!` / `push_field_param!` (`macros.rs:15,:43`) **cannot express set-to-NULL at all** — that gap is theirs |
| **`upsert`** | that the verb is `upsert_` when the operation is insert-or-update (29 such fns), that it returns the row (13 do) and not `()` (12 do) | which SQL form and which conflict target: **68 `ON CONFLICT … DO UPDATE`**, 7 `DO NOTHING`, **2 with no conflict target at all**, **94 `INSERT OR IGNORE`**, 7 `INSERT OR REPLACE` — three mutually incompatible constructions across ~178 sites, plus the hazard that `INSERT OR REPLACE` deletes-then-inserts and therefore **fires `ON DELETE CASCADE`** ([delete-semantics](./delete-semantics.md)) |

**Neither is a facet of this one, and the test is empirical:** you can write a function whose name,
handle, error type, return type and location are all correct and still get both of them wrong, and
you can get both of them right inside a function that is otherwise malformed. `crud_update!`
(`macros.rs:249-296`) is the proof — it is this path's answer in macro form and it still cannot
express "clear this column", which is the sibling's whole subject. **The spine needs no edit; both
leaves stand.**

**Not this path either:** *whether the write is atomic with the next one* is
[transaction-boundary](./transaction-boundary.md). *What the mapper does with a row* is
[row-to-struct-mapping](./row-to-struct-mapping.md). *Which `AppError` variant a failure deserves and
how the frontend renders it* is [typed-error-contract](./typed-error-contract.md). *Whether the SQL
belongs in this crate at all* is [command-naming-placement](./command-naming-placement.md).

### Sibling boundaries, settled in prose

[**Row to struct mapping**](./row-to-struct-mapping.md) owns the `row_to_*` function and the
set-failure policy — *what happens to a row on the way out*. This path owns the **function that
wraps it**: its name, its handle, its error type, what it returns, and how a caller reaches it. The
two touch at exactly one point and do not overlap: that path says a mapper never decides anything;
this path says the *function* decides exactly one thing the mapper cannot — whether the row existed.

[**Persisted model struct**](./persisted-model-struct.md) owns the shape being read into. Its
`Option<T>`-iff-nullable rule governs fields; this path governs the `Result<…>` those fields arrive
inside. Where it says a `DEFAULT` without `NOT NULL` makes the *struct* a lie, this path says a
`Result<(), AppError>` on a targeted write makes the *function* a lie — the same defect family, one
layer apart.

[**Query latency instrumentation**](./query-latency-instrumentation.md) (composed today) owns
`timed_query!` and measurement. **Its type-level proposal and this path's are the same change seen
from two sides** — it wants `RepoPool::scope(table, op, |conn| …)` so the timer cannot be forgotten;
this path wants the connection in the signature so the transaction and the row count cannot be. They
must land as one `scope`, not two. Cited, not duplicated.

## 2 The one way

**Give the table one module under `src-tauri/db/src/repos/<area>/<table>.rs`, and write every public
function in it to the same five-part shape: `pub fn <verb>_<noun>(pool: &DbPool, …) -> Result<T,
AppError>`.** Reach for the generated function before writing one — `crud_get_by_id!`,
`crud_get_all!`, `crud_delete!`, `crud_update!` (`db/src/macros.rs:141,:179,:196,:249`) already encode
every rule below and cannot be written wrong. When you must hand-write it: **the verb names the
cardinality and the effect** — `get_` returns exactly one thing, `list_` returns a `Vec`, `create_`
returns the created entity, `update_` returns the refreshed one, `delete_` says whether a row went
away, `upsert_` returns the row. **The return type must be able to say "no such row."** A statement
whose `WHERE` clause is `id = ?1` affects zero or one row; `rusqlite`'s `execute` hands you which,
and `Result<(), AppError>` throws it away — so bind it and turn `0` into
`AppError::NotFound(format!("<Entity> {id}"))`, or return the refreshed entity and let the re-read do
it. **Absence has exactly one spelling per shape:** a lookup that may legitimately miss returns
`Result<Option<T>, AppError>` via `.optional()`; a lookup by an id the caller believes in returns
`Result<T, AppError>` and maps `rusqlite::Error::QueryReturnedNoRows` to `AppError::NotFound` —
never hand-match `QueryReturnedNoRows` a third way, and never let it escape. **Do not write
`.map_err(AppError::Database)?`** — `AppError::Database` is `#[from] rusqlite::Error`
(`core/src/error.rs:12-13`), so `?` already converts, and 196 of these in the tree are provably pure
noise. Then stop: no `pub use` facade, no second module for the same table, no SQL for this table
anywhere else in the app.

### The two-sided contract

The repository function's **return type is the contract**, because it decides what the UI is
physically able to say. `AppError`'s `Serialize` impl (`core/src/error.rs:159-215`) computes
`{ error, kind, category, auto_fixable, failover_eligible }` at the source, so:

| Repo returns | The frontend receives | What the UI can do |
|---|---|---|
| `Result<Entity, AppError>` + `NotFound` mapping | `kind: "not_found"`, `category: "provider_not_found"` | say *"this was deleted"*, drop it from the store, refetch |
| `Result<Option<Entity>, AppError>` | `null` | render an empty state; **no error** — correct only when absence is expected |
| `Result<(), AppError>`, count discarded | `undefined` — indistinguishable from success | **nothing.** The optimistic update stands, the toast says saved |
| a raw `QueryReturnedNoRows` propagated | `kind: "database"`, `category: "api_error"`, `error: "Database error: Query returned no rows"` | show a generic failure toast, and log an API error for a row that simply is not there |

**Row 4 is the one this repo produces by accident and the one no sibling produces at all** (§6).
Row 3 is the one it produces 82 times on purpose-by-omission. Choosing rows 1–2 is free at authoring
time and impossible to retrofit cheaply, because 863 call sites across 279 files already consume the
chosen type.

### Which clauses are physics, which are this house

Per the [contract](../golden-path-contract.md) and the
[portability test](../research/portability-test.md), a clause travels only if something else
reinvented it. Measured 2026-08-14 against five siblings; detail and citations in §6.

| Clause | Warrant | Evidence |
|---|---|---|
| **A write that can miss must return something that can say so** | **physics** | `brainiac` reserves `Result<()>` for **inserts** (where a miss is impossible) and returns `bool`/`u64` from ~23 write fns that can miss; `vibeman`'s factory returns `T \| null` from update and `boolean` from delete **by construction**; `ascent` *throws* `GOAL_CONFLICT` on `count === 0` (`plan.ts:360`). The one sibling that agrees with our defect — `personas-cloud`, `void` from **5 of 5** deletes — is the worst repo in the sweep |
| **A typed outcome enum when "missed" has more than one meaning** | **physics — independently invented twice** | `brainiac` `ExtendOutcome { Extended(ts), Superseded, NotFound }` (`memories.rs:624-639`) with the rationale written out: *"the old signature returned a bare `Option` and collapsed two materially different failures … so callers could not tell a 404 from a 409 and reported both as success"*; also `UpdateOutcome` (`library/standards.rs:299-312`), `ProposeOutcome`, `SkillProposeOutcome`. `ascent` reached the same shape as a string union: `"ok" \| "last_owner" \| "error" \| "db_error"` (`members.ts:150`). **This is the ceiling of the design space and Personas has no analogue** |
| **Reserve `get_` for cardinality one; a collection read gets its own verb** | **physics** | `brainiac` (`get_*` → `Option<T>` / `list_*` → `Vec<T>`, with `browse` / `search` / `facets` / `neighbors` minted rather than overloading `list`), `personas-cloud` (21 `get` vs 10 `list`, clean), `ascent` (61 vs 17). `vibeman` is the counterexample — 328 of ~700 methods are `get`, no `list` verb exists — and is measurably worse for it |
| **Absence has exactly ONE spelling** | **physics — by unanimity** | every sibling has precisely one mechanism: `brainiac` `Option` (44 `fetch_optional` : 23 `fetch_one`, **zero** `RowNotFound` matches), `personas-cloud` `undefined`, `vibeman` `null`, `ascent` a driver code mapped to 404 at the route boundary. **Personas is the only repo in the sweep with three** |
| **The driver's error must never be what a UI renders** | **physics by unanimous absence — and Personas is alone in violating it** | the two servers log instead of serializing; the two web apps map at the route boundary (`ascent` unit-tests that the raw error does not leak, `client.test.ts:698`). Nobody else ships `kind: "database"` to a screen |
| **The handle in the signature is the connection, not the pool** | **physics — Personas is the outlier** | `brainiac`: **139 `conn: &mut PgConnection` vs 40 `pool: &PgPool`**, 3.5:1 the other way, **one spelling**, zero `impl Executor` generics — and the rationale is a security invariant, not taste (`lib.rs:1-11`: every read/write runs inside `scoped_tx(principal)` which sets `app.org_id` LOCAL so RLS applies; *"there is no unscoped query path"*). Personas: 1,196 pool-first, 11 connection-taking across **six** naming spellings |
| **A shared/generated CRUD layer, adopted** | **ergonomics — and the adoption number is the whole finding** | `vibeman`'s `createGenericRepository` reaches **19 of 54 repository files (35%)**; Personas' five macros reach **33 of ~1,313 (2.6%)**. `ascent` gets 100% via an ORM. `brainiac` and `personas-cloud` have none |
| **A facade / barrel over the repo modules** | **ergonomics, threshold-dependent** | none at 23 modules (`brainiac`, which agrees with Personas); a barrel at 46 (`ascent`) and ~60 (`vibeman`). Personas has **107** modules and no facade — past the threshold both adopters crossed |
| **"All SQL behind the repository layer" is the win condition** | **CONTRADICTED — do not assert it** | `personas-cloud` has **perfect** ownership (110 `.prepare(` calls and 103 SQL statements, **all in one file**, zero elsewhere) and is nonetheless the worst repo in the sweep: 5/5 void deletes, 4 row-count checks in 63 writes, no error type, zero tests. `brainiac` is the inverse — best signatures, **131 raw `sqlx::query*` outside its own store across 20 production files**. **The axes are independent** (§6) |
| **The `_with_conn` / `_on_conn` suffix** | **house convention — and downstream of the handle choice** | nobody else needs a suffix, because nobody else has two handle types to distinguish. `brainiac`'s 139 connection params need zero disambiguation. Our six spellings are a symptom, not a convention |

## 3 Mandated primitives

**Exist today — use them:**

- **`db/src/macros.rs:141` `crud_get_by_id!(Model, "table", "Entity", row_to_x)`** — generates
  `get_by_id(pool, id) -> Result<Model, AppError>` and **maps `QueryReturnedNoRows` to
  `AppError::NotFound(format!("Entity {id}"))`**. This is the boundary error mapping, correct, in
  four lines you do not write. **15 invocations.**
- **`db/src/macros.rs:196` `crud_delete!("table")`** — generates `delete(pool, id) -> Result<bool,
  AppError>` ending in `Ok(rows > 0)`. **It is physically impossible to write this one blind.**
  **6 invocations.**
- **`db/src/macros.rs:179` `crud_get_all!`** (5 invocations, routes through `collect_rows`) ·
  **`:249` `crud_update!`** (2 invocations; re-checks existence via `get_by_id` first, builds a
  partial `SET`, returns the refreshed row) · **`:376` `lab_crud!`** (5 invocations × 7 functions).
  Together the five macros generate ~63 correct functions.
- **`db/src/macros.rs:100` `row_mapper!`** — 44 invocations. Owned by
  [row-to-struct-mapping](./row-to-struct-mapping.md); named here so you do not hand-write the mapper
  your module needs before its CRUD.
- **`db/src/macros.rs:331` `timed_query!("<table>", "<table>::<op>", { … })`** — wraps the body.
  922 blocks. Owned by [query-latency-instrumentation](./query-latency-instrumentation.md).
- **`rusqlite::OptionalExtension::optional()`** — the one-line "absent is not an error". Used in only
  **34** of 1,280 pub fns, against **101** that hand-match `QueryReturnedNoRows`.
- **`personas_core::error::AppError`** (`core/src/error.rs:10-98`) — 22 variants;
  `Database(#[from] rusqlite::Error)` and `Pool(#[from] r2d2::Error)` mean **`?` converts for free**.
  `NotFound(String)` and `Validation(String)` are the two variants a repository actually needs to
  construct.
- **`db/src/repos/resources/notification_subscriptions.rs` (298 lines) — copy this whole module.**
  See §6.

**Do not exist — this path names them:**

- **A `WriteOutcome` / typed write result.** `Result<(), AppError>` and `Result<bool, AppError>` are
  the only two shapes available for "did the row exist", and `bool` collapses *missing* into
  *unchanged*. `brainiac`'s `ExtendOutcome` / `UpdateOutcome` are the proven shape (§6).
- **A repository module template or factory.** `db/src/repos/mod.rs` is **20 `pub mod` lines and
  nothing else** — no trait, no constructor, no `pub use`. A new table's module is created by making
  a file, and nothing about making a file suggests a shape. `vibeman`'s `createGenericRepository` is
  the working precedent at 13× the adoption (§6, and *Prefer a type over a gate*).

## 4 Steps

1. **Check the table does not already have a module.** `ls db/src/repos/<area>/`, then
   `grep -rn "FROM <table>" db/src/repos/`. 80 of 308 tables are written from *both* inside and
   outside the repo layer (§7); adding a second door makes it 81.
2. **Create one file per table** at `db/src/repos/<area>/<table>.rs` and add it to the area's
   `mod.rs`. Areas today: `communication`, `core`, `execution`, `lab`, `orchestration`, `resources`,
   plus eight top-level modules. Do not add a `pub use` — the repo has zero and callers write the
   full path (§7).
3. **Write the mapper first** (`row_mapper!` or `fn row_to_<entity>`), per
   [row-to-struct-mapping](./row-to-struct-mapping.md).
4. **Ask the type-over-gate question here, before you write any function body.** Three of them:

   | Instead of | Write | What it removes permanently |
   |---|---|---|
   | `pub fn delete(pool, id) -> Result<(), AppError>` | `crud_delete!("table")` | the blind delete — the macro ends in `Ok(rows > 0)` and cannot be written otherwise |
   | `pub fn get(pool, id) -> Result<T, AppError>` hand-written | `crud_get_by_id!(T, "table", "T", row_to_t)` | the `QueryReturnedNoRows` leak; the macro maps it to `NotFound` |
   | `pub fn set_x(pool, id, x) -> Result<(), AppError>` | `-> Result<T, AppError>` returning the refreshed row, or bind the count and raise `NotFound` on 0 | the silent no-op, for that function and for every future caller of it |

   **This is the highest-leverage step in the document.** 82 functions skipped it and are the census
   baseline in §9.
5. **Name by cardinality and effect.** `get_<noun>` → exactly one (`T` or `Option<T>`).
   `list_<noun>s` → `Vec<T>`. `create_` / `update_` / `delete_` / `upsert_` for the four writes.
   The repo has **186 distinct prefixes**; every one you invent is a 187th thing the next reader must
   learn. Do **not** name a `Vec`-returning function `get_*` — 134 already do, against 164 correctly
   named `list_*`.
6. **Handle and error type, verbatim:** `pool: &DbPool` first, `Result<T, AppError>` last. 1,196 and
   1,199 of 1,280 respectively already do. If the operation must compose inside a caller's
   transaction, take `conn: &rusqlite::Connection` and suffix the name `_with_conn` — four functions
   use that spelling and it is the plurality of six (§7). Read
   [transaction-boundary](./transaction-boundary.md) before choosing.
7. **Let `?` do the conversion.** `conn.execute(sql, params)?` is complete.
   `.map_err(AppError::Database)?` is a no-op — 196 exist. `.map_err(AppError::Database)` **without**
   `?`, as a tail expression, is fine (194 exist) though `.map_err(Into::into)` says the same thing.
8. **Construct exactly two error variants yourself.** `AppError::NotFound` when a row the caller
   named is absent; `AppError::Validation` when the input is bad, before touching the connection
   (`notification_subscriptions.rs:69-77` is the shape). Everything else is `?`. Do **not** reach for
   `AppError::Internal` — 1,371 uses tree-wide and only 54 are in the repo layer; that ratio is
   correct and should stay.
9. **Write the test that fails today.** `init_test_db()` (`db/src/lib.rs:1882`), insert, then call
   your write with an id that does not exist and assert the error. **53 of 116 repo files have a
   `#[cfg(test)]` module and 557 `#[test]` functions exist, but only 18 test-function names mention
   not-found/missing/nonexistent at all.** Name the test after the consequence, the way `ascent` does
   (§6): `delete_of_a_vanished_row_is_not_reported_as_success`.
10. **Stop.** No facade, no re-export, no second module for the table, no SQL for it in
    `src/commands/**`.

## 5 Anti-patterns

- **A targeted write that returns `()` — 120 of 146, and 82 of them keyed on the primary key.**
  `conn.execute("UPDATE t SET … WHERE id = ?1", …)?; Ok(())` throws away the one number that says
  whether the row existed. `resources/deliberation.rs:353-361` `get_agenda_item` and `:365-380`
  `resolve_agenda_item` are the pair to read: the first leaks `QueryReturnedNoRows` as a database
  error, the second resolves a nonexistent agenda item and reports success, and both fit in fifteen
  lines. `core/personas.rs:1208` `update_name` renames a persona that may not exist;
  `resources/triggers.rs:1856` `set_enabled` flips a trigger that may not exist and the UI renders
  the new state; `resources/deliberation.rs:306` `finalize` finalises a vanished deliberation.
  **`brainiac` names this exact failure in a code comment** (`governance.rs:193-196`): *"A 0-row
  update means the memory was deleted since the promotion was queued … the caller MUST treat that as
  a failure (not commit a phantom approval), which is why this reports it instead of silently
  returning Ok."*
- **A conditional write whose answer is discarded — the same defect, worse.**
  `execution/executions.rs:709` `set_claude_session_id` is
  `UPDATE persona_executions SET claude_session_id = ?1 WHERE id = ?2 AND status = 'running'` →
  `Ok(())`. The `AND status = 'running'` is a compare-and-swap; its result is the entire point and it
  is dropped. (The CAS *design* is [conditional-write](../situation-spine.md)'s leaf, unwritten; the
  **return type** is this path's.)
- **Five return types for one verb.** `delete_*`: `bool` ×56, `()` ×22, `usize` ×7, `u32` ×4, `i64`
  ×3. A caller cannot learn from the codebase what a delete returns; it must read each one. `update_*`
  is four-way split (struct ×52, `()` ×30, `bool` ×4, int ×1) and `upsert_*` is three-way (struct ×13,
  `()` ×12, int ×2). **Only `create_*` converged** — 98 of 103 return the created entity — which is
  the proof that convergence here is achievable and simply was not attempted for the other three.
- **Three spellings of "this row is absent."** `.optional()` in 34 functions, a hand-written
  `match … QueryReturnedNoRows` in 101, an `AppError::NotFound` construction in 135, and **none of
  the three in 1,087 of 1,280.** `notification_subscriptions.rs:262-278` writes the four-line
  hand-match where `.optional()?` would have been one line — in the module that is otherwise the
  reference implementation. Every sibling repo has exactly one mechanism (§6).
- **Letting `QueryReturnedNoRows` reach the frontend — 11 functions.**
  `resources/deliberation.rs:353` `get_agenda_item` is `query_row(… WHERE id = ?1,
  row_to_agenda).map_err(AppError::Database)`. A missing agenda item serialises as `kind: "database"`,
  `category: "api_error"`, `error: "Database error: Query returned no rows"`. The user is told the
  database failed. `AppError::NotFound` exists, maps to `category: "provider_not_found"`, and is one
  `match` arm away — `crud_get_by_id!` writes that arm for you.
- **`.map_err(AppError::Database)?` — 196 sites, every one provably redundant.**
  `AppError::Database` is `#[from] rusqlite::Error` (`core/src/error.rs:12-13`), so `?` already
  applies `From`. All 196 sit inside functions returning `Result<_, AppError>` (checked per-function,
  not by grep). Densest: `resources/triggers.rs` 29, `resources/teams.rs` 19, `dev_tools.rs` 17,
  `resources/deliberation.rs` 17. The harm is not the cycles — it is that a reader cannot tell the
  redundant 196 from the 194 tail-position uses that are load-bearing, so the idiom propagates by
  imitation.
- **Naming a `Vec`-returning function `get_*` — 134 sites.** `get_all`, `get_by_persona`,
  `get_recent`, `get_due`. Meanwhile 164 functions get it right with `list_*`, and only 2 `list_*`
  return a non-`Vec`. The convention is 55% adopted, i.e. it is not a convention.
  **And the repo's own generator disagrees with it:** `crud_get_all!` (`macros.rs:179`) emits
  `pub fn get_all(pool) -> Result<Vec<Model>, AppError>`. Fix the macro's emitted name before
  policing call sites (§9 refusal 1).
- **A write function with a positional parameter list instead of an input struct.** 74 pub fns take
  ≥8 parameters; `dev_tools.rs` `update_project` takes **18**, `create_context` and `create_idea` 15
  each, `update_goal` and `update_context` 14. Every one is a call site where two adjacent
  `Option<String>` arguments can be swapped and it still compiles. `crud_update!` takes an input
  struct precisely to close this.
- **A table with no module.** 79 of 308 tables have every write outside `db/src/repos/`; **all 35
  `companion_*` tables are named nowhere in the repo layer.** But read §6 before treating this as the
  headline: the sibling with *perfect* ownership is the worst repo in the sweep.
- **A second module for the same table.** 80 tables are written from inside *and* outside the repo
  layer; `personas` is written **24 times inside and 59 times outside**, across `commands` (33),
  `engine` (18), `companion` (4) and four more areas. There is no single place to add an invariant.

## 6 Evidence

**Adoption.** 116 files · 107 with a `pub fn` · **1,280 pub non-test fns** · **1,196 take
`pool: &DbPool`** (93.4%) · **1,199 return `Result<_, AppError>`** (93.7%) · 922 `timed_query!`
blocks · 44 `row_mapper!` · **33 CRUD-macro invocations** generating ~63 functions · 0 `pub use` ·
**863 `db::repos::` paths across 279 files** with 553 `use` lines · 1,806 `&state.db` call sites
across 191 files.

Ok-payload distribution across the 1,199 `Result<_, AppError>`: concrete struct **371**, `Vec<T>`
**352**, `()` **204**, `bool` **104**, integer **92**, `Option<T>` **57**, `String` 13,
`HashMap` 6.

- **`db/src/repos/resources/notification_subscriptions.rs` — copy this whole module.** 298 lines,
  ten public functions, and it is the only place in the tree where every clause of §2 holds at once:
  the mapper at `:10`; `list_all` / `list_enabled` at `:28,:46` (the verb matches the cardinality);
  `crud_get_by_id!` at `:64` (so `NotFound` is generated, not remembered); `create` at `:81`
  validating **before** it takes a connection, minting the id, and returning `get_by_id(pool, &id)`;
  `update` at `:135` calling `get_by_id(pool, id)?` **first**, so a missing row is `NotFound` before
  a single column is written, then returning the refreshed entity; and **`delete` at `:215`, six
  lines that are the whole doctrine**:
  ```rust
  let deleted = conn.execute("DELETE FROM notification_subscriptions WHERE id = ?1", params![id])?;
  if deleted == 0 {
      return Err(AppError::NotFound(format!("NotificationSubscription not found: {}", id)));
  }
  Ok(())
  ```
  It has two blemishes, named so nobody copies them: `get_watermark` (`:262`) hand-matches
  `QueryReturnedNoRows` where `.optional()?` is one line, and `record_delivery` (`:236`) is one of the
  82 blind writes.
- **`db/src/macros.rs:141-167` `crud_get_by_id!`** — the boundary error mapping, generated:
  `.map_err(|e| match e { QueryReturnedNoRows => AppError::NotFound(…), other => AppError::Database(other) })`.
  **The repo already knows the answer to its own worst read defect and applies it 15 times.**
- **`db/src/macros.rs:196-219` `crud_delete!`** — ends `Ok(rows > 0)`. Six invocations against 92
  hand-written deletes carrying five different return types.
- **`core/src/error.rs:12-13, :159-215`** — `Database(#[from] rusqlite::Error)` and the `Serialize`
  impl that turns it into `kind: "database"`, `category: "api_error"` on the wire. Read these
  eighteen lines before deciding what a repo function returns; they are the entire two-sided contract.
- **`src/lib.rs:370` `pub db: DbPool`** — why "how a caller gets one" has two answers.
  1,806 sites pass `&state.db` into a repo function (correct); 81 sites in `src/` call
  `state.db.get()` and write their own SQL. That second population is
  [command-naming-placement](./command-naming-placement.md)'s `persistence-handle-in-command-tree`
  rule (baseline 134/46 over `src/commands`) and is **not re-gated here**.

### Convergence — what five sibling repos did without reading this

Run 2026-08-14, read-only. **Every load-bearing number below was re-measured by hand after the sweep
reported it**; the re-measurements agree and are marked ✓.

- **✓ The handle belongs in the type, and Personas is the outlier.** `brainiac`'s store: **139
  `conn: &mut PgConnection` vs 40 `pool: &PgPool`, zero `impl Executor` generics** — verified by an
  independent parse. All 139 use **one** spelling; there is no `_with_conn` suffix anywhere, because
  there is nothing to disambiguate. And the reason is not style: `lib.rs:1-11` explains that every
  read and write runs inside `scoped_tx(principal)`, which sets `app.org_id`/`app.user_id` LOCAL so
  Postgres RLS applies, and that *"there is no unscoped query path"* — a function that takes a
  connection **cannot** silently open an unscoped one. Personas' 11 connection-taking functions wear
  **six** spellings (`_with_conn` ×4, `_on_conn` ×3, `_conn` ×1, `_on` ×1, no suffix ×2). **Our
  naming problem is downstream of our handle problem.**
- **✓ `brainiac` invented the typed write outcome, and wrote down why.** `memories.rs:624-639`:
  ```rust
  /// The old signature returned a bare `Option` and collapsed two materially
  /// different failures — "you cannot see this memory" and "this memory is
  /// superseded" — into one `None`, so callers could not tell a 404 from a 409
  /// and reported both as success.
  pub enum ExtendOutcome { Extended(DateTime<Utc>), Superseded, NotFound }
  ```
  Plus `UpdateOutcome { Updated { rev }, NotFound, Terminal { lifecycle } }`
  (`library/standards.rs:299-312`), `ProposeOutcome`, `SkillProposeOutcome`. `ascent` reached the
  same shape independently in TypeScript: `"ok" | "last_owner" | "error" | "db_error"`
  (`members.ts:150`). **Two repos, two languages, one idea, and Personas' 104 `Result<bool>` returns
  are the collapsed version of it.**
- **✓ `brainiac` does NOT structurally solve the row count — cite it correctly.** It reads
  `rows_affected` at 25 sites and asserts `== 1` rather than `> 0` (`governance.rs:203-206`), and
  `library/skills.rs:92` uses `rows_affected() == 0` as an early return guarding a *second dependent
  UPDATE*. But three of its UPDATEs discard the count and return `Ok(())` (`documents.rs:707`,
  `publishing.rs:70`, `queue.rs:187`). **Its advantage is 186 functions, not a mechanism.** Citing
  brainiac as proof that discipline suffices would be citing it backwards: at Personas' 1,280
  functions, that same discipline is precisely what already failed.
- **✓ `vibeman` is the only structural fix in the sweep, and the adoption number is the finding.**
  `src/app/db/repositories/generic.repository.ts` is a **factory**, not a base class:
  `const base = createGenericRepository<DbGoal>({ tableName: 'goals', … }); export const goalRepository = { ...base, …custom }`.
  Its `update` returns `null` when `result.changes === 0` (`:144`), its `deleteById` returns
  `result.changes > 0` (`:152`), its `deleteByProject` returns the count (`:161`) — **an adopter gets
  this path's §4 step 4 without knowing it exists.** Verified adoption: **19 of 54 `*.repository.ts`
  files (35%)**, against Personas' **33 invocations across ~1,313 functions (2.6%)**. The design
  detail that made 35% reachable is *spread-composition* — no `extends`, no `super`, no override
  ambiguity, and a repo keeps its domain methods in the same object literal.
- **✓ `vibeman` also turns table ownership into a compile error.** `repository.utils.ts:14-138` is a
  const array of 122 table names narrowed to `export type TableName = (typeof VALID_TABLE_NAMES)[number]`,
  and `GenericRepositoryConfig.tableName: TableName` — so a table with no registration cannot be
  written through the generic path at all. The runtime guard at `:206` even names the fix:
  *"Add it to VALID_TABLE_NAMES in repository.utils.ts."* This is §7's negative space, solved by the
  type system.
- **✓ The brief's premise about `personas-cloud` is wrong, and the correction inverts a conclusion.**
  The brief says it has "110 inline `.prepare()` calls, no chokepoint." Re-measured: **all 110
  `.prepare(` calls and all 103 SQL statements live in exactly one file**
  (`packages/orchestrator/src/db.ts`); **zero** SQL exists anywhere else in the repo. It has the
  **strictest table ownership of any repo in the sweep — 100%.** And it is the worst repo in the
  sweep: `void` from **5 of 5** delete functions (`db.ts:591,:684,:1004,:1082,:1468`), 4 `.changes`
  reads across 63 `.run()` calls, **no error type at all** (zero `class …Error` definitions), and
  **zero tests**. **Perfect ownership bought it nothing.** Anyone reading §7's "79 tables have no
  repository" as the headline should read this line first.
- **✓ …and `brainiac` is the inverse, which decouples the axes.** The repo with the best signatures
  has **131 raw `sqlx::query*` calls outside its own store, across 20 production files** — 72 in
  `brainiac-server/src/console.rs` alone, which is a second, undeclared data layer. Verified by an
  independent parse restricted to production crates. **Getting the signature right does not get
  ownership right, and vice versa. "Fix the repository layer" is not one project.**
- **Naming density, and the one axis where Personas beats a sibling.** Functions per distinct verb
  prefix: `brainiac` **1.9** (100 prefixes / 186 fns), `ascent` 2.9, `personas-cloud` 3.0,
  `vibeman` 5.5, **Personas 6.9** (186 prefixes / 1,280 fns). Three of four hold the `get`/`list`
  distinction; `vibeman` collapsed it entirely (328 of ~700 methods are `get`, no `list` verb exists)
  and is worse than Personas' coin flip. `brainiac`'s technique is worth stealing: it mints a
  *distinct verb per collection shape* — `browse`, `search`, `facets`, `neighbors`, `versions`,
  `flagged`, `expiring` — so `list` never has to mean two things.
- **Absence: every sibling has one mechanism; Personas has three.** `brainiac` never matches
  `sqlx::Error::RowNotFound` — **zero occurrences, verified** — because it never calls `fetch_one` on
  a query that can miss (**44 `fetch_optional` : 23 `fetch_one`**, the 23 being aggregates that always
  return a row). `personas-cloud` returns `T | undefined` everywhere. `vibeman` returns `T | null`.
  `ascent` lets Prisma's `P2025` escape one hop into a route handler that maps it to 404 —
  deliberately, and **unit-tested** (`org/goals/route.test.ts:212`, *"maps a Prisma P2025 to 404 (not
  500) on update"*). The finding is not that a sibling has a better mechanism. **It is that no
  sibling has three.**
- **The error type is the one axis with no oracle.** `brainiac` uses bare `anyhow::Result` with no
  bespoke error enum — **weaker typing than Personas' `AppError`** — mitigated by `.context()` chains
  and by being a server that logs rather than serialises. `personas-cloud` has no error type at all.
  `vibeman` has exactly one (`TableNotFoundError`, `repository.utils.ts:282`) and it is for a missing
  **table**, not a missing row. `ascent` is the most developed: not an enum but *classifier
  predicates* plus *combinators* — `isDbUnavailableError`, `isSerializationConflictError`,
  `dbReadSafe(fn, fallback)`, `withRetry`, `withDb` (`src/lib/db/client.ts:129,:157,:195,:228,:286,:599`)
  — with a test asserting the raw error does not leak (`client.test.ts:698`). **Personas' specific
  defect — the driver error reaching a UI as `kind: "database"` — has no analogue anywhere**, because
  the servers log and the web apps map at the boundary. Here there is only a gap, not a precedent.
- **`ascent` uses the row count as a concurrency primitive, not merely an existence check.**
  `src/lib/db/plan.ts:360` throws `GOAL_CONFLICT` when `updateMany({ where: {…expected prior values} })`
  returns `count === 0`; `credits.ts:348` makes a conditional decrement out of
  `where: { scanCredits: { gt: 0 } }` + `count === 0`, which is what prevents a negative balance.
  That is the strongest available answer to Personas'
  `WHERE id = ?2 AND status = 'running'` → `Ok(())` (§5).
- **Tests: three of five siblings test the data layer, and all three name invariants.**
  `ascent` 38 test files, `brainiac` 34 tests, `vibeman` 21. The one Personas is missing 92 times
  over is `ascent`'s `credits.test.ts:468` — **`"a non-existent org denies (ok:false, zero balance) —
  never a silent free scan"`** — and note its form: it names the *consequence* of the bug, not the
  mechanism. `brainiac`'s `unanswered_demand_becomes_exactly_one_gap_and_answering_it_closes_the_loop`
  and `vibeman`'s `"is a no-op when the item was cancelled mid-run — cancel is not clobbered"` do the
  same. Personas has 557 `#[test]` functions in the repo layer and **18** whose name mentions absence.

## 7 Deviations found

### The distribution — how a repository function is actually shaped

| Axis | Converged | Diverged |
|---|---:|---|
| First parameter | **1,196** `pool: &DbPool` (93.4%) | 30 `&str`, 11 `&Connection`/`&Transaction` **in six naming spellings**, 8 `Option<&str>`, 6 none, 6 `&Row`, 23 other |
| Return type | **1,199** `Result<_, AppError>` (93.7%) | 63 non-`Result`, 11 unit, 6 `rusqlite::Result`, 1 `Result<_, String>` |
| Verb vocabulary | — | **186 distinct prefixes.** get 286 · list 180 · create 118 · update 93 · delete 92 · set 46 · upsert 29 · mark 24 · insert 24 · record 19 · count 15 · …175 more |
| Read verb ↔ cardinality | 164 `list_*` → `Vec` · 2 `list_*` → non-`Vec` | **134 `get_*` → `Vec`** (7 of them literally `get_all`) |
| Create's return | **98 of 103** return the created entity | 2 `()`, 2 `Option`, 1 other |
| Update's return | 52 struct | **30 `()`** · 4 `bool` · 1 int · 1 `Option` |
| Delete's return | — | **five types**: `bool` 56 · `()` 22 · `usize` 7 · `u32` 4 · `i64` 3 |
| Upsert's return | — | struct 13 · `()` 12 · int 2 |
| Absence | — | `.optional()` 34 fns · hand-matched `QueryReturnedNoRows` 101 · `AppError::NotFound` 135 · **none of the three: 1,087** |
| Affected-row count | 194 of 561 write fns bind it (160 branch on it) | **367 discard it** |

### P0 — shipped, user-visible

| Path | Defect |
|---|---|
| **82 functions / 35 files** (§9 baseline) | A `pub fn … -> Result<(), AppError>` runs an `UPDATE`/`DELETE … WHERE id = ?N` and drops the affected-row count, so *"no such row"* returns `Ok`. Live instances: `resources/triggers.rs:1856` `set_enabled` (a trigger toggle whose target may not exist; the UI renders the new state), `resources/deliberation.rs:306` `finalize`, `core/design_conversations.rs:207` `delete`, `research_lab.rs:105,:267,:367,:424,:481,:531` (**all six research deletes**), `execution/knowledge.rs:250` `dismiss_annotation`, `dev_tools.rs:5147` `finish_auto_run`. |
| `db/src/repos/resources/deliberation.rs:353` + `:365` | `get_agenda_item` propagates `QueryReturnedNoRows` as `AppError::Database`, so a missing item reaches the user as **"Database error: Query returned no rows"** with `kind: "database"`; `resolve_agenda_item` four lines below resolves a nonexistent item and returns `Ok(())`. Both defects, in one twenty-line span, on one entity. |
| `db/src/repos/core/personas.rs:1208` `update_name` | Renames a persona inside an `IMMEDIATE` transaction with a TOCTOU-safe collision check — and then discards the `UPDATE`'s row count, so renaming a deleted persona succeeds. The careful half and the careless half are in the same function. |
| `db/src/repos/execution/executions.rs:709` `set_claude_session_id` | `WHERE id = ?2 AND status = 'running'` — a compare-and-swap whose outcome is the entire point of the predicate, returned as `Ok(())`. Four sibling `set_*` functions in the same file (`:150,:170,:662,:694,:728`) share the shape. |
| `db/src/repos/dev_tools.rs:861` `reorder_goals` | Loops over a caller-supplied id list issuing one blind `UPDATE … WHERE id = ?3` each, outside any transaction. A stale id silently leaves the ordering wrong, and a mid-loop failure leaves it half-applied ([transaction-boundary](./transaction-boundary.md) owns the second half). |

### The negative space — and what it does NOT mean

Of **308 declared tables**, **283 are written somewhere**:

| | Tables | % of written |
|---|---:|---:|
| Written **only** from `db/src/repos/**` — repository-owned | **124** | 43.8% |
| Written from inside **and** outside | **80** | 28.3% |
| Written **only** outside — no repository module exists | **79** | 27.9% |

The largest cluster is the AI companion: **35 `companion_*` tables, and not one of them is named
anywhere in `db/src/repos/`** — `companion_node` alone takes 38 writes across `src/companion/` (34),
`src/commands/` (3) and `db/` (1). The knowledge-base family (`kb_documents` 14, `knowledge_bases` 11,
`kb_chunks` 10) is written from `commands` and `engine` only. And the split population is worse than
the missing one: **`personas` is written 24 times inside the repo layer and 59 times outside**, across
`commands` (33), `engine` (18), `companion` (4), `core`, `db`, `mcp_server` and `ipc_auth`. There is no
one place to add an invariant to the app's central table.

> **Do not read this as the headline.** The sibling with **100% ownership** — `personas-cloud`, whose
> 110 `.prepare(` calls all live in one file and which has zero SQL elsewhere — is the **worst repo
> in the sweep** on every other axis in this document (§6). And `brainiac`, which has the best
> signatures in the sweep, has **131 raw queries outside its own store**. Ownership and shape are
> independent axes; closing one does not close the other, and the ordering that matters is shape
> first, because a repository module that reproduces the 82-site defect is not an improvement over no
> module. The remedy for placement belongs to
> [command-naming-placement](./command-naming-placement.md), whose `persistence-handle-in-command-tree`
> rule already ratchets 134 checkouts across 46 files.

### Structural

- **196 provably-redundant `.map_err(AppError::Database)?`**, checked per-function against the
  enclosing return type (all 196 are inside `Result<_, AppError>` functions, so all 196 are no-ops);
  194 further tail-position uses are legitimate. Densest in `resources/triggers.rs` (29),
  `resources/teams.rs` (19), `dev_tools.rs` (17), `resources/deliberation.rs` (17).
- **The repository layer has no facade and 107 modules.** `db/src/repos/mod.rs` is 20 `pub mod`
  lines; there are **zero `pub use` statements** in the entire directory tree. Callers write
  `crate::db::repos::resources::triggers as repo` — 553 such `use` lines and 863 path occurrences
  across 279 files. Both siblings that built a barrel did so at 46 and ~60 modules (§6); Personas is
  at 107.
- **The five CRUD macros encode every rule in §2 and are used 33 times.** `crud_get_by_id!` 15 ·
  `crud_delete!` 6 · `crud_get_all!` 5 · `lab_crud!` 5 · `crud_update!` 2. The adoption cost is the
  cause and it is measurable in the macro source: `crud_get_by_id!` hardcodes
  `SELECT * FROM <table> WHERE id = ?1`, so any module whose read needs a column list or a join
  cannot use it; `crud_update!` requires a purpose-built all-`Option` input struct **plus** a
  `fields: { name: clone, … }` kind list, which is more typing than the function it replaces.
  **Adopting the correct shape currently costs more than writing the wrong one** — the exact inverse
  of `vibeman`'s factory, which is a one-line spread (§6) and reaches 35%.
- **74 pub fns take ≥8 parameters**; `dev_tools.rs` `update_project` takes 18, `create_context` and
  `create_idea` 15, `update_goal` and `update_context` 14, `update_task` 12.
- **`db/src/repos/mod.rs` has no module doc and `.claude/conventions.json` has no entry** for
  `DbPool`, `AppError`, `crud_`, or repository naming. The rules in §2 are stated nowhere in the
  repository except inside the macros that implement them.
- **Test coverage of the boundary is near zero.** 53 of 116 files carry a `#[cfg(test)]` module and
  557 `#[test]` functions exist, but only **18** function names mention `not_found` / `missing` /
  `nonexistent`. Nothing anywhere asserts that a delete of an absent row is not reported as success —
  which is why the 82 sites accumulated silently.

### Second pass — what is upstream of all of it

Re-reading the deviations together: 186 verb prefixes, five delete return types, three absence
spellings, 82 blind writes, 196 redundant `map_err`s and 79 unowned tables are **not 500 independent
choices. They are 107 independent first-time authorings**, because:

> **There is no repository primitive to adopt. There is a directory.**

`db/src/repos/` offers a new module no trait to implement, no constructor to call, no facade to
register with, no template to copy and no doc comment to read. A module is created by making a file,
and nothing about making a file suggests a shape. The five macros that *do* encode the shape are
harder to adopt than to bypass. Every clause in §2 is therefore a decision each author made from
scratch, and the measured divergence is exactly what 107 independent decisions look like — including
the one place convergence *did* happen (`create_*`, 98 of 103), which is the case where the obvious
thing and the correct thing coincide.

This is the same shape [query-latency-instrumentation](./query-latency-instrumentation.md) found from
its own side ("the gap is **file-shaped**, not function-shaped — nine modules at 0%, others near
100%"). Two paths, two instruments, one root cause. It is why *Prefer a type over a gate* below
argues for a factory rather than for more rules.

## 8 Gaps in the primitive

1. **`Result<(), AppError>` and `Result<bool, AppError>` are the only shapes available, and `bool`
   collapses two different answers.** A delete returning `false` cannot distinguish *the row was
   never there* from *the row was there and something declined to remove it*; an update returning
   `false` cannot distinguish *no such row* from *the values were already equal* (SQLite reports 0
   affected rows for a no-change UPDATE only when the `WHERE` misses, but a CAS predicate makes the
   distinction real). `brainiac` solved this with a per-operation enum (`ExtendOutcome`,
   `UpdateOutcome`) and wrote the rationale in the doc comment (§6). Personas has 104
   `Result<bool, AppError>` returns and no enum.
2. **`crud_get_by_id!` hardcodes `SELECT *`.** Any table whose read needs an explicit column list, a
   join, or a redaction parameter cannot use the one primitive that gets the boundary error mapping
   right — so the modules with the most complex reads are exactly the ones that hand-roll the mapping,
   or skip it. This is why the macro sits at 15 uses.
3. **`crud_update!` cannot express set-to-NULL, and `push_field!` cannot either.** Both key on
   `Option::is_some`, so `None` always means *leave alone*. This is the whole subject of
   [`partial-update-semantics`](../situation-spine.md) and the reason the tree carries three
   incompatible workarounds (§1). Naming it here so the seam is visible rather than silent.
4. **Nothing makes the repository layer a boundary.** `AppState.db` is `pub` (`src/lib.rs:370`),
   `DbPool` is `Clone`, and `conn.prepare` is free — so 79 tables were written without a repository
   because nothing said there should be one. Rust's visibility system was never used to say it.
   The architectural fix is `command-naming-placement`'s; what belongs here is that **a convention
   cannot be enforced by documentation while the boundary is unenforced by the compiler**, and
   `vibeman` shows the type-level version is reachable (`TableName` union, §6).
5. **`rusqlite`'s `execute` returns `usize` and nothing requires you to look at it.** Rust's
   `#[must_use]` does not apply through `Result<usize>` once `?` unwraps it — `conn.execute(…)?;` as
   a statement is idiomatic, warning-free Rust that discards the count. No lint in the toolchain
   objects. This is the mechanical reason the 82 sites are the *cheapest* thing to type.
6. **There is no repository test harness.** `init_test_db()` (`db/src/lib.rs:1882`) builds the real
   chain and is excellent, but there is no shared helper for the assertion this path needs — *call
   the write with an absent id, assert `NotFound`* — so each of the 92 delete functions would need it
   written by hand. `ascent`'s 38 data-layer test files are the target shape (§6).
7. **The `_with_conn` convention has no home.** Four spellings of four, plus two functions with no
   suffix at all, and no doc anywhere states which is right. It cannot be fixed by convention while
   the pool remains the default handle; `brainiac` needs zero suffixes because the connection is its
   default (§6).
8. **No enforcement reaches `src-tauri/` for any of this.** `npm run check` is TypeScript + ESLint
   over `src/`; lefthook is eslint + secrets + i18n; `cargo clippy -D warnings` has no opinion about
   a discarded `usize` or a function's name. Every deviation above shipped green.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md), answered explicitly before §9 is written.
**Yes, three times, and two of the three already exist in working form outside this repo.**

1. **The write's return type is the type fix, and it is the one that matters.** A PK-targeted write
   that returns `()` makes "no such row" unrepresentable *in the wrong direction*. The minimal
   version is free — return `bool` from a delete (`crud_delete!` already does), return the refreshed
   entity from an update (52 of 93 already do), and the 82-site defect class becomes impossible for
   every future function. The full version is `brainiac`'s: a per-operation outcome enum when
   "missed" has more than one meaning, whose doc comment is the argument
   (*"callers could not tell a 404 from a 409 and reported both as success"*, `memories.rs:624-628`).
   Independently reinvented in `ascent` as a string union. **This is the best-warranted clause in the
   document.**
2. **A repository factory is the type fix for everything else, and `vibeman` has run the
   experiment.** `createGenericRepository` reaches **35%** adoption where Personas' functionally
   equivalent macros reach **2.6%**, and the difference is not discipline — it is that adopting the
   factory is one spread-composed line and cheaper than hand-writing, whereas adopting `crud_update!`
   requires an input struct and a field-kind list and is *more* work than the function it replaces
   (§7). A Personas-shaped version — one macro or builder emitting `get_by_id` / `list_all` /
   `create` / `update` / `delete` with the timing wrapper, the `NotFound` mapping and the row-count
   check already inside, taking a column list rather than hardcoding `SELECT *` (Gap 2) — converts
   §9's rule from a permanent gate into a migration counter that ratchets to zero and is deleted.
   `vibeman`'s `TableName` union additionally makes Gap 4 a compile error, which is the cheapest fix
   in this document that nobody has tried.
3. **The handle is the type fix for the transaction and the timer at once — and it is not mine to
   propose twice.** [query-latency-instrumentation](./query-latency-instrumentation.md)'s
   *Prefer a type over a gate* already specifies `RepoPool::scope(table, op, |conn| …)` with the
   inner pool made `pub(crate)`. `brainiac`'s 139-to-40 connection-first signature is the same change
   arrived at from the security direction. **They must land as one `scope`, not two**, and when it
   lands it also deletes the six `_with_conn` spellings (Gap 7) by removing the thing they
   disambiguate.

**Where a type cannot reach.** The 186-verb vocabulary is not expressible as a signature — a naming
convention needs a reviewer or a linter, and §9 refuses to be that linter for a reason it can show.
Neither is *whether a table got a module at all*; that is placement, and its gate already exists
elsewhere.

## 9 The missing gate

### The semantic condition, stated first

> **A write addressed at exactly one identified row completes without reporting whether that row
> existed, so "nothing happened" and "it worked" are the same value.**

Stack-free: every storage engine that reports an affected-row count can express it, and every
language can decide what "reporting" means (a non-void return, a thrown conflict, a typed outcome).
Per the [portability test](../research/portability-test.md) the *proxy* below does **not** travel;
an adopting repo inherits the sentence and re-derives its own signal against its own driver —
better-sqlite3's `result.changes`, Prisma's `count`, sqlx's `rows_affected()`, an ORM that raises.
A repo whose data layer already returns the updated row, or whose ORM throws on a zero-row update
(`ascent`, §6), has the condition designed out and needs no rule at all.

### Checked first: is this already gated?

All 37 rules in `scripts/census/rules.json` were read. Four are adjacent and **none covers this
condition**: `persistence-handle-in-command-tree` (46/134) counts a pool checkout *in the command
tree* — a placement condition, and §7 deliberately does not re-gate it; `untimed-repo-query`
(36/245) counts a *missing timer*; `silent-row-skip` (64/148) counts a discarded failure on the
**read** path; `deferred-read-then-write` (10/12) counts a transaction shape. This condition — a
discarded success signal on the **write** path — is ungated.

### The proxy, and what it keys on

A `pub fn` in `db/src/repos/` returning `Result<(), AppError>` that reaches an `UPDATE`/`DELETE`
whose **entire** `WHERE` clause is `id = ?N`, without ever binding the `usize` that `.execute()`
returns and without any existence probe.

**Precision, measured by reading.** **22 matches were opened and read** across the pattern's
refinement. The final pattern's set holds **20 verified true positives and zero verified false
positives**; the two false positives found on the way are excluded **by construction, not by an
allowlist**:

- `dev_workspaces.rs:1067` `sync_harvest_scopes` — `DELETE … WHERE project_id = ?1`, a scope-keyed
  bulk delete where zero rows is normal. Excluded by requiring the bare column `id`, which narrows
  the statement to *exactly one row*. (This cost 13 real matches — `assignment_outcomes.rs:146`
  `set_outcome_json` keyed on `assignment_id` is a genuine defect the rule now misses. **A ratchet
  does not need recall; it needs to be unable to rise.**)
- `rotation.rs:257` `mark_rotated` — calls `get_policy_by_id(pool, …)?` first, so existence is
  established. Excluded by the `\w*by_id\s*\(` guard, alongside guards for a bound count,
  `.optional()`, `QueryReturnedNoRows` and `AppError::NotFound` — any of which means the no-op is
  already observable.
- `INSERT` / `ON CONFLICT` are excluded because an upsert can never affect zero rows.

**Shape of the match set:** 82 matches, **all 82 distinct `(file, fn)` pairs** — no function
double-counted. Median matched span **377 characters**, maximum **2,355** against a 4,000 bound, so
the bound loses nothing and makes the count a floor. **Zero** matches sit inside a `#[cfg(test)]`
module (checked by a brace-matching scanner, not a heuristic). `commentMatchesSkipped: 0` — the
engine's comment-rewind path (`lib/engine.mjs:192-211`) is never exercised, because every match
begins at `pub fn`, which is never a comment-only line.

**Precondition, stated so it can be checked before porting:** this repo executes SQL through
`rusqlite`'s `.execute(sql, params)` inside functions declared `pub fn`, returns a unit-typed
`Result` from writes, and spells its primary key `id`. A repo whose driver returns a result object
the caller must destructure, or whose ORM raises on a zero-row update, has the same condition in
markup this pattern cannot see and scores zero.

### Mechanism — a census rule, not a script

Per the [contract](../golden-path-contract.md) §"Don't write a script", the ratcheting-baseline
mechanism already exists at [`scripts/census/`](../../../scripts/census/). This path publishes **one**
entry, merged by the orchestrator via `scripts/census/merge-published-rules.mjs` — never edited into
`rules.json` here:

```json
{"rules":[
  {
    "id": "blind-identity-write",
    "goldenPath": "docs/concepts/golden-paths/repository-crud-surface.md",
    "title": "Repository write targeted at one row by primary key whose affected-row count is discarded, so \"no such row\" is reported as success",
    "roots": ["src-tauri/db/src/repos"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "\\bpub\\s+fn\\s+[A-Za-z_]\\w*(?:(?!\\bpub\\s+fn\\b)[\\s\\S]){0,400}?->\\s*Result<\\s*\\(\\s*\\)\\s*,\\s*(?:personas_core::error::)?AppError\\s*>\\s*\\{(?:(?!\\bfn\\s+[A-Za-z_]|\\blet\\s+(?:mut\\s+)?[a-z_]\\w*\\s*(?::[^=;\\n]{0,40})?=\\s*[^;]{0,400}?\\.execute\\s*\\(|AppError::NotFound|QueryReturnedNoRows|\\w*by_id\\s*\\(|\\.optional\\s*\\()[\\s\\S]){0,4000}?\"[^\"]{0,400}?\\b(?:UPDATE|DELETE)\\b(?![^\"]{0,400}?\\b(?:INSERT|CONFLICT)\\b)[^\"]{0,400}?\\bWHERE\\b\\s+id\\s*=\\s*\\?\\d*\\s*\"",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a pub repository fn returning Result<(), AppError> that reaches an UPDATE or DELETE whose entire WHERE clause is `id = ?N` - a primary-key-targeted, exactly-one-row write - without ever binding the usize that .execute() returns and without any existence probe. PROXY FOR the stack-free condition: a write addressed at one identified row completes without reporting whether that row existed, so 'nothing happened' and 'it worked' are the same value. rusqlite's execute() returns the affected-row count; on a PK-targeted statement 0 means exactly one thing - no such row - and the unit return type physically cannot carry it. Measured 2026-08-14 at HEAD: 82 matches across 35 of 116 files, every match a distinct (file, fn) pair, median matched span 377 chars and max 2355 against a 4000 bound, zero matches inside a #[cfg(test)] module. 22 matches were opened and read during the pattern's refinement: the final pattern's set contains 20 verified true positives and the 2 verified false positives found on the way are excluded BY CONSTRUCTION rather than by an allowlist - a scope-keyed bulk DELETE (dev_workspaces.rs:1067 sync_harvest_scopes, WHERE project_id = ?1, where 0 rows is normal) is excluded by requiring the bare column `id`, and a function that probes existence first (rotation.rs:257 mark_rotated calls get_policy_by_id) is excluded by the `\\w*by_id\\s*\\(` guard. The other guards do the same work: a fn that already binds the count, maps QueryReturnedNoRows, constructs AppError::NotFound, or calls .optional() has made the no-op observable and does not match; INSERT/ON CONFLICT are excluded because an upsert can never affect zero rows. Live consequences in this tree: persona_triggers::set_enabled (triggers.rs:1856) flips a trigger that may not exist and the UI renders the new state; deliberation::finalize (deliberation.rs:306) finalizes a vanished deliberation; dev_goals::reorder_goals (dev_tools.rs:861) reorders stale ids one blind UPDATE at a time. PRECONDITION (must be re-derived per repo): this repo executes SQL through rusqlite's `.execute(sql, params)` inside functions declared `pub fn`, returns a unit-typed Result on writes, and spells its primary key `id`. A repo whose driver returns a result object the caller must destructure (better-sqlite3's {changes}), whose ORM raises on a zero-row update, or which returns the updated row via RETURNING has the SAME condition wearing different markup and this pattern scores zero against it. LEGAL FIX, in order: (1) bind the count and turn 0 into AppError::NotFound - resources/notification_subscriptions.rs:215 is the shape to copy, six lines; (2) return the refreshed entity instead of unit, which makes the absent row a NotFound from the re-read - resources/notification_subscriptions.rs:135 update is that shape; (3) reach for crud_delete! (macros.rs:196), which returns Ok(rows > 0) and cannot be written blind. Do NOT silence a match by widening the WHERE clause or by dropping the id predicate - that trades this condition for a worse one."
    },
    "baseline": { "files": 35, "matches": 82 },
    "floor": 100
  }
]}
```

**Validated standalone before publishing** (`node scripts/census/run-census.mjs --rules
<scratch>/rcs-rules-Q4mz.json --check`):

```
  rule                    files   base  matches   base  walked  floor
  OK   blind-identity-write       35     35       82     82     116    100

  census OK — 1 rule(s), 116 file-visits, 82 surviving violation(s) across 35 file(s).
```

`116 walked` is every `.rs` file under `db/src/repos/`, independently confirmed by the brace-matching
parser that produced §7's counts from the same tree. `floor: 100` is set to **match
`untimed-repo-query`**, the other rule rooted at this directory: two rules over one root must not
hold two opinions about what "the repository layer is intact" means, or the weaker keeps passing
while the stronger fires and a reader has to work out which to believe.

**Fault injection against the real tree**, because a gate that cannot fail is not a gate. Each row is
a single-field mutation of the validated rule, run with `--check`:

| Induced fault | Exit |
|---|---|
| baseline, unmutated | **0** |
| matcher matches nothing (`pattern` → `ZZZ_NEVER_MATCHES`) | **1** |
| floor above the walk (`floor: 5000` on a 116-file root) | **1** |
| silent drop (baseline claims 400 where 82 exist) | **1** |
| count rises (baseline claims 40 where 82 exist) | **1** |
| file count rises (baseline claims 10 files where 35 exist) | **1** |
| renamed root (`…/repos` → `…/repos-x`) | **1** |
| extension no longer describes the tree (`.rs` → `.zzz`) | **1** |
| stale `exclude` entry (a path matching no file) | **1** |
| **POSITIVE CONTROL — pattern inverted to the COMPLIANT form** | **1** |

**The positive control is the row that matters.** Pointing the same rule at the *correct*
construction — a unit-returning repo function that **does** bind the affected-row count — moves the
counts to **20 files / 30 matches** and fails on both drift metrics. Since the compliant and
non-compliant populations are disjoint and differently sized, the matcher is **discriminating between
the two forms**, not merely matching anything shaped like a repository function. A rule that matched
both would have reported ~50 files and passed nothing meaningful.

**No `exclude` entries.** Every candidate exemption is already handled by the pattern's own guards,
and a stale exemption is how an allowlist becomes the bug.

### What this does NOT gate, and why — four refusals

1. **The read verb ↔ cardinality convention (refused, and the reason is a finding).** `get_*`
   returning `Vec<T>` is countable at **134** with essentially perfect precision, and the fix is a
   compiler-assisted rename. Gate it anyway and you would fail the repo's own generator:
   **`crud_get_all!` (`macros.rs:179-195`) emits `pub fn get_all(pool) -> Result<Vec<Model>, AppError>`.**
   The primitive that this path tells you to prefer *is* the violation. Policing 134 call sites while
   the recommended macro manufactures more is the exact anti-pattern the contract warns about, and
   the correct fix is upstream and one word: rename the macro's emitted function to `list_all` and
   migrate its 5 invocations. Then, and only then, is the call-site count meaningful. **Refusing a
   high-precision, high-recall signal because the primitive disagrees with the convention is a real
   outcome, not a compromise.**
2. **The 196 redundant `.map_err(AppError::Database)?` (refused).** The signal is clean and the count
   is exact, but the fix is one mechanical deletion pass, after which the count goes to zero, the
   runner correctly fails on `zero-matches`, and it instructs you to delete the rule. Per the
   engine's own doctrine — *"If the migration really is complete, DELETE the rule rather than
   baselining it at zero"* — a rule with a one-commit lifetime should never be added. It is §5 and §7
   instead.
3. **"Absence has three spellings" (not countable).** This is a *relational* property — *the
   cardinality of the set of mechanisms used across the layer is greater than one* — and a census
   rule counts occurrences within one file. All three spellings are individually correct; only their
   coexistence is the defect. The checker that can express it is a **Rust test** that calls each
   `Result<Option<T>, _>` and `Result<T, _>` read against an absent id and asserts the outcome
   category — behaviour, not shape, per the model-effort guide's warning that *a gate that asserts
   data is not a gate on behaviour*. It must run under `cargo test --workspace`: `npm run test:rust`
   passes `--lib` against the root manifest, so a test in `personas-db` would be written, merged and
   never executed locally; use `cargo test -p personas-db` or `npm run test:rust:crates`.
   `ci.yml:275` is `cargo test --workspace … --features desktop`, so the lane is live in CI.
   **Mark honestly: three of five sibling repos test their data layer (§6) and Personas' 557 repo
   tests include 18 whose name mentions absence — so the instrument is proven elsewhere and unbuilt
   here.**
4. **"This table has no repository module" (not countable, and already routed).** It is relational
   across two trees — the `CREATE TABLE` name set joined to the repo directory — which no
   content-match can express. The adjacent condition is already ratcheted by
   `persistence-handle-in-command-tree` (owner:
   [command-naming-placement](./command-naming-placement.md), baseline 134/46), and a second rule
   over that population would be the duplication the contract warns about. **And the convergence
   sweep says gating it would be the wrong priority anyway:** `personas-cloud` has 100% ownership and
   is the worst repo in the sweep (§6). The type-level version — `vibeman`'s `TableName` union making
   an unregistered table a compile error — is the answer, and it belongs to the factory in
   *Prefer a type over a gate*, not to a counter.

**How the census rule fails loudly when its own precondition is absent** is inherited from the runner
and demonstrated in the fault table: a zero-match run fails structurally rather than reporting a clean
tree; a walk below `floor` fails with *"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; a drop
without a baseline update fails; and the surviving count prints on success, so a green build log
distinguishes a clean run from one that checked nothing.

**On severity:** the census is a ratchet, not a severity ladder — it fails a run when a count moves.
No argument is made anywhere in this document from warning volume, and none could be: `npm run check`
runs `eslint src/` with no `--max-warnings` and the pre-commit hook runs `--quiet`, so a warn-level
rule enforces nothing at either gate at any count. The census rule enforces; a lint rule would not.

## See also

- [Row to struct mapping](./row-to-struct-mapping.md) — the mapper this module's functions wrap.
- [Persisted model struct](./persisted-model-struct.md) — the shape they read into, and the
  `NOT NULL`/`Option` contract one layer down.
- [Query latency instrumentation](./query-latency-instrumentation.md) — `timed_query!`, and the
  `scope` proposal this path's handle fix must land with, not beside.
- [Transaction boundary](./transaction-boundary.md) — which writes must land together, and the
  `&Connection` parameter that makes composition possible.
- [Typed error contract](./typed-error-contract.md) — the `AppError` taxonomy this path maps *into*,
  and the frontend half of what `kind: "not_found"` buys.
- [Command naming & placement](./command-naming-placement.md) — where the SQL belongs, and the rule
  that already counts the 134 checkouts §7 deliberately does not re-gate.
- [Paginated list query](./paginated-list-query.md) — a `list_*` that is perfectly named and
  unbounded is still unbounded.
- [Delete semantics](./delete-semantics.md) — what a delete must *reach*; this path owns only what it
  *returns*.
