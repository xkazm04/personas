# Golden path — Schema-inexpressible invariant

> Situation node: `data-persistence/schema-design/schema-inexpressible-invariant` ·
> [situation spine](../situation-spine.md) · recurrence 10 · risk **medium** ·
> sides: **server** · convergence: **diverged**
> Composed 2026-08-17 against `master` @ `2edb8d694`. Mode 2 batch
> (`data-persistence/schema-design`), full contract.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri`
> (`shared-facts.json#rust.files`, re-verified with its recorded instrument
> — `node scripts/docs/measure-shared-facts.mjs`, *no value changed* at
> `2edb8d694`), lexed rather than grepped with
> `scripts/census/lib/instruments/extractRustStrings.mjs`: **55,267** string
> literals in production source after `stripCfgTest` blanked every
> brace-matched `#[cfg(test)]` range (line-preserving; 25 files excluded
> outright by `isRustTestFile`), **3,633** of them holding SQL. Both live
> databases were copied and queried **read-only**: `personas.db` (331.0 MiB,
> 84,730 × 4,096-byte pages) and `personas_data.db` (16.7 MiB) — **244 + 71 =
> 315 tables, 2,581 + 425 = 3,006 columns**.
>
> **Measured by execution, not by reading.** Every CHECK claim in this document
> was proved by building a throwaway SQLite database from the **live DDL** and
> attempting the write. The two `persona_memories` triggers were re-installed
> verbatim from `sqlite_master` and probed at 0/1/3/5/6/99/−1/NULL on both the
> INSERT and the UPDATE path. The instrument carries its own positive control
> (a legal value must be accepted and an illegal one refused) and exits 2 if
> either fails.
>
> **`cargo` was not run** (the operator's app is live). Every Rust claim is
> static and traces to a file opened during composition. No live database was
> ever opened for write; the copies were deleted at the end.
>
> ---
>
> ## 0 The headline: the schema can express 73 things, and the repo's most carefully written invariant document has a clause about a column that no longer exists
>
> A schema-inexpressible invariant is not a rare event here. It is the **normal
> case**: of 3,006 columns across two SQLite files, **73 CHECK constraints on
> 51 tables** and **one** trigger-guarded rule are the entire set of invariants
> the store itself will refuse to break. Everything else that must be true is
> held up by a repository function, by a comment, or by nothing.
>
> | what enforces it | count | where |
> | --- | --- | --- |
> | `CHECK` constraint | **73**, naming **74** columns, on **51** tables | all in `personas.db`; **0** in `personas_data.db` |
> | `RAISE(ABORT)` trigger | **1 invariant, 2 triggers** | `persona_memories.importance ∈ 1..=5` |
> | FTS-sync trigger (not an invariant) | 3 + 3 | `executions_fts`, `kb_chunks_fts` |
> | `UNIQUE` index | 20 | `personas.db` |
> | a Rust `validate_transition` / `can_transition_to` | **9 call sites in 8 files** | see [`status-transition-rules`](./status-transition-rules.md) |
> | a numbered prose contract | **1** (`MEMORY CONTRACT`, 7 clauses) | `core/src/models/memory.rs:91` |
> | **nothing** | the remainder | **193 of 244** app tables carry no CHECK at all |
>
> Four findings are sharper than the ratio.
>
> **0.1 — The exemplar exists, it works, and it is the only one of its kind.**
> `MEMORY CONTRACT (4)` says `importance` must lie in `1..=5` and names its
> enforcement point: `migrations/helpers::install_persona_memory_invariants`
> (`helpers.rs:396-449`), two `BEFORE INSERT`/`BEFORE UPDATE OF` triggers that
> `RAISE(ABORT, 'persona_memories.importance must be in 1..=5 (MEMORY CONTRACT
> 4)')`. Rebuilt from `sqlite_master` and executed: `0`, `6`, `99` and `−1` are
> **REFUSED** on both paths; `1`, `3`, `5` accepted. The error string names the
> clause number, so a future reader of a stack trace can find the rule. **This
> is the best invariant artifact in the repo and it is a population of one.**
> Its one hole is disclosed by its own `WHEN NEW.importance IS NOT NULL` guard
> — `NULL` is accepted, and the column is `importance INTEGER DEFAULT 3`, i.e.
> nullable. Live: **0 of 6,535 rows** carry NULL, so the hole is real and
> unexercised.
>
> **0.2 — The contract outlived its column.** `MEMORY CONTRACT (5)` is a
> 12-line clause about `group_id` — *"a SECOND scope alongside `use_case_id`
> … Stage 1 (this column) ships the schema"*. **`persona_memories` has no
> `group_id` column.** `retire_persona_groups` (`incremental.rs:3534`, and see
> [`destructive-schema-change`](./destructive-schema-change.md) D1) dropped it;
> the contract was not touched. A clause describing the semantics of a column
> that does not exist is worse than no clause: it reads as current, it is
> cited by name elsewhere in the tree, and nothing — not the compiler, not a
> migration, not a test — can tell you it is dead. **This is the failure mode
> that makes prose-enforced invariants different in kind from CHECK-enforced
> ones: a CHECK cannot survive its column.**
>
> **0.3 — The registry lives inside a JSON array in a TEXT column, is spelled
> two ways, and its only reader sees 4 of 44 entries.** Every persona declares
> its use cases inside `personas.design_context`, a `TEXT` column holding JSON.
> **Eighteen columns across seventeen tables carry a `*use_case_id` that must
> name one of them; two have a foreign key and sixteen do not**, because no FK
> can point inside a blob. Parsed from the live database:
>
> | key spelling | personas | entries | distinct ids |
> | --- | --- | --- | --- |
> | `design_context.useCases[]` | **75** | 133 | **43** |
> | `design_context.use_cases[]` | **15** | 29 | **4** |
>
> The one Rust reader that mutates this registry —
> `commands/infrastructure/dev_tools.rs:191`,
> `.get("use_cases")… .any(|u| u.get("id") == Some("uc_pr_review"))` — reads
> **only the snake_case key**, so **40 of the 44 declared ids are invisible to
> it**. Both spellings live in the same column, and 15 personas carry both.
> No type reaches either one: the key is a string literal on one side of a
> serialization boundary and a JSON object key on the other.
>
> **0.4 — The second database expresses no invariant at all.** `personas_data.db`
> holds **71 tables and 425 columns** and carries **zero CHECK constraints** and
> **zero non-FTS triggers**. Its only structural guarantees are `PRIMARY KEY`,
> `NOT NULL` and `REFERENCES`. That is not an oversight of one table — it is the
> whole file, including the companion brain (`companion_node`, `companion_turn`,
> `companion_approval`, `companion_session`), which is where the app's
> longest-lived user data lives. See [`second-database`](./second-database.md)
> for why that store has no migration runner either; the two facts have the same
> cause and compound.
>
> ---

## Principle (stack-free head)

**Every invariant a store cannot express is a promise that something else has
to keep, so the design question is never "can the schema say this?" — it is
"which artifact keeps this promise, and what happens to the promise when that
artifact changes?"**

Rank the answers by how they fail:

1. **The store refuses the write** (a constraint, a trigger, a unique index).
   It cannot drift from the column, because it is attached to the column. It
   fails **loudly, at the write, for every writer including a human at a SQL
   console.**
2. **One function is the only door** and it checks. This holds exactly as long
   as it is the only door; it fails **silently the first time someone writes a
   second one**, and nothing in the type system counts doors.
3. **A named, numbered contract in prose**, each clause naming its enforcement
   point. This is a real artifact — it survives refactors, it can be cited, and
   a clause number in an error message closes the loop. It fails **silently when
   the thing it describes is deleted.**
4. **A comment beside the column.** Fails on the first copy-paste.
5. **Nothing.** The invariant is a belief held by whoever last read the code.

The prescription is not "always use (1)". Most interesting invariants are not
expressible as a CHECK — cross-row, cross-table, temporal, or referential
across a serialization boundary. The prescription is that **you must choose,
name the choice next to the column, and make the enforcement point findable
from the failure.** An invariant with no named keeper is not an invariant; it
is a hope.

---

## 1 Trigger

You are in this situation when you find yourself typing or saying:

- *"this column can only ever be one of these five values"* — and you are about
  to write `TEXT NOT NULL DEFAULT 'pending'` and stop there.
- *"the repo layer validates that before it writes"* / *"nothing else writes
  this column"* — a claim about the number of doors, which nothing counts.
- *"a use case / capability / tier / kind id, pointing at the one declared in
  the JSON blob"* — a foreign key that cannot be declared.
- *"exactly one row can be active at a time"* / *"at most one per persona"* —
  a uniqueness claim you are about to enforce in Rust.
- *"the two columns must agree"* (`status` and `enabled`, `count` and its
  children, `completed_at` and a terminal status).
- *"I'll write a comment so the next person knows"* — the moment to ask which
  of the five keepers above you are actually choosing.
- **The "if you are about to write X" test:** if you are about to write a
  `//` or `--` comment containing *must*, *always*, *never*, *only*, *exactly
  one*, or *at most one* about a column's values, you are in this situation and
  you have not yet chosen a keeper.

## 2 The one way

**Write the constraint into the DDL if SQLite can hold it, and if it cannot,
give the invariant a NUMBER, a named enforcement point, and a failure message
that carries the number — then make the enforcement point the only door by
withholding the raw value from every other caller.** Concretely: (a) if the
legal set is a fixed vocabulary, write `CHECK(col IN (…))` in the same
`ddl_step` as the column, and write `NOT NULL` beside it, because a CHECK
evaluates to NULL — not false — on a NULL and therefore does not constrain a
nullable column; (b) if the rule is a range, prefer `CHECK(col BETWEEN a AND
b)`, and if the column is legitimately nullable spell it `CHECK(col IS NULL OR
col BETWEEN a AND b)`, which is the form `dev_milestone_items.rating` already
uses correctly; (c) if the rule is cross-row or cross-table and SQLite cannot
state it, install a `BEFORE INSERT`/`BEFORE UPDATE OF <col>` trigger that
`RAISE(ABORT, '<table>.<col> <the rule> (<CONTRACT NAME> <n>)')` — copy
`install_persona_memory_invariants` (`helpers.rs:396`), including its
`triggers_present == 2` guard so boot does not rewrite `sqlite_master` on every
launch; (d) if not even a trigger can reach it — the parent lives inside a JSON
blob, the rule is about a process rather than a row, the check needs an
embedding — then add a **numbered clause** to the module's contract block in
`core/src/models/<domain>.rs`, name the single function that keeps it, make the
struct field's doc comment back-reference the clause number, and make the
keeper the only door by **not handing anyone else the raw value**
(`increment_access_batch` is the shape: one writer, named in the contract,
called from one place); and (e) whichever of (a)–(d) you chose, write the
choice in the DDL comment beside the column, because the next reader's first
question is *"what stops this from being wrong?"* and the answer must be one
line away.

**When two are available, take both.** A CHECK and a `validate_transition`
are not redundant — the CHECK is what protects you from the second door you
have not written yet, and the Rust validator is what gives the user an error
message. Measured across this repo: exactly **one** status column has both
(`evolution_cycles.status`), and it has never held a row.

## 3 Mandated primitives

- **`ddl_step(conn, sql)`** (`db/src/migrations/incremental.rs:33`) — the
  wrapper every schema change goes through. Your CHECK belongs in the same
  `ddl_step` as the column it constrains, at the end of `run_incremental`
  (`incremental.rs:4789`). See [`schema-change`](./schema-change.md).
- **`migrations::helpers::install_persona_memory_invariants`**
  (`db/src/migrations/helpers.rs:396-449`) — **the trigger-installation
  pattern to copy.** Three things it gets right and you must keep: a
  `sqlite_master` existence probe so it is a no-op when the table is absent; a
  `triggers_present == 2` early return so a fully-installed database does no
  `sqlite_master` write on boot; and a `RAISE(ABORT, …)` message naming the
  table, the column, the rule and the contract clause. Its own comment tells
  you the one operational rule: **if you change a trigger body, change the
  trigger name**, or existing databases keep the old definition forever.
- **The `MEMORY CONTRACT` block** (`core/src/models/memory.rs:91-235`) — the
  format for an invariant no constraint can hold: a numbered list, each clause
  naming its enforcement point, with individual struct fields back-referencing
  the clause number (`memory.rs:273`, `:280`, `:284`, `:287`, `:297`, `:309`).
  **This is the artifact to imitate.** It is also the artifact whose clause (5)
  is dead, which is the cost you are accepting.
- **`core/src/lifecycle.rs::declare_lifecycle!`** — where the invariant is
  "which value may follow which", this generates the closed enum, the
  transition table, `as_str`, `FromStr` and `ALL_VARIANTS` from one
  declaration. Three enums use it. See
  [`status-transition-rules`](./status-transition-rules.md) §3.
- **`core/src/models/json_column.rs`** — the typed-JSON-column helper
  (`from_str::<T>`). Where a TEXT column holds a structure, this is the door;
  a bare `serde_json::Value` plus `.get("key")` is not.
- **`db/src/lib.rs:1899` `migrated_template()` / `:1976` `init_test_db()`** —
  the fixture that runs the real migration chain, so a test sees your CHECK.
  A test pool built by hand does not. See
  [`rust-test-fixtures`](./rust-test-fixtures.md).

## 4 Steps

1. **Write the column, then immediately answer "what stops this from being
   wrong?"** in a comment on the next line. If the answer is "nothing", you
   have found a defect before shipping it, which is the entire point of asking.
2. **Ask whether SQLite can hold it.** A fixed vocabulary, a numeric range, a
   uniqueness claim over columns in one table, and a "not both NULL" rule are
   all expressible. Cross-table, cross-row and "only this function may write
   it" are not.
3. **If expressible, write it into the same `ddl_step`, with `NOT NULL`.**
   Verify by executing, not by reading: build the table in a scratch database
   from your own DDL and try the illegal value. Two minutes; the corpus has
   several cases where a constraint that looked right admitted the value.
4. **If a range on a nullable column, write `CHECK(col IS NULL OR …)`
   explicitly.** Do not rely on the reader knowing that a CHECK passes on NULL.
5. **If not expressible as a constraint but checkable per-row, write the
   trigger** — `install_persona_memory_invariants` verbatim, with a new name
   and a new message carrying the contract clause number.
6. **If not checkable at all, number it.** Add a clause to the module's
   contract block naming the invariant, the enforcement point, and — this is
   the part that makes it durable — **what a violation would look like in the
   data**, so a future reader can go and check whether it still holds.
7. **Then make the enforcement point the only door.** Not by asking callers to
   go through it, but by not giving them the value: a `pub(crate)` writer, a
   constructor that owns the dangerous field, a repo function that takes the
   closed enum rather than the string. See *Prefer a type over a gate* below.
8. **And then stop.** Do not add a client-side mirror of the rule; that is a
   third copy, and [`client-rule-mirroring`](./client-rule-mirroring.md)
   measured what happens to copies that test themselves.

## 5 Anti-patterns

- **`TEXT NOT NULL DEFAULT '<token>'` with no CHECK.** *130 sites in 11 files.*
  The name declares a vocabulary, the default is a member of it, and nothing
  refuses a non-member. **Two failures, not one:** an invalid value is accepted
  silently, and — because the column is `NOT NULL DEFAULT` — a writer that
  omits the field gets `'<token>'` rather than an error, so *"which rows chose
  this value"* becomes unanswerable. `persona_events.status` is the largest
  live case: 4,972 rows, default `'pending'`, no CHECK.
- **A CHECK on a nullable column.** A SQLite CHECK fails only on FALSE, and
  `NULL IN ('a','b')` is NULL. Executed: `INSERT INTO t(s) VALUES (NULL)` is
  **accepted** against `s TEXT CHECK(s IN ('a','b'))` and **refused** against
  `s TEXT NOT NULL CHECK(s IN ('a','b'))`. Live consequence:
  `change_journal.undo_status` carries `CHECK (undo_status IN ('undone',
  'conflict'))` and **228 of 228 rows are NULL** — the constraint has never
  been consulted on a single stored row.
- **Enforcing it in the repo function and saying so in the doc comment.** The
  claim is *"this is the only writer"*, and nothing counts writers. The
  MEMORY CONTRACT makes this claim for `access_count` / `last_accessed_at`
  (clause 3) and it currently holds — but it holds by inspection, and the next
  person to add a second writer will not read this file.
- **A foreign key you cannot declare, left undeclared and unmentioned.**
  16 of 18 `*use_case_id` columns. The right move is not to fake an FK; it is
  to say in the DDL comment *which* registry the value must be in and *where*
  that registry lives, because "use_case_id TEXT" tells a reader nothing and
  there turn out to be **two disjoint namespaces** with the same column name
  (`uc_pr_review`-style slugs in the JSON blob; UUIDs in `dev_use_cases`;
  **0 overlap**).
- **A key into a JSON blob written as a string literal at the read site.**
  `.get("use_cases")` vs a `useCases` writer is the whole `0.3` defect. If a
  blob has a shape, give it a struct and read it through
  `models/json_column.rs`; if it must stay `Value`, put the key in a `const`
  next to the writer so the two spellings cannot diverge silently.
- **Writing the invariant only in the frontend form.** MEMORY CONTRACT (4)
  lists "frontend forms clamp to 1..=5" as the *cheapest* of three layers,
  which is the correct framing — it is a UX affordance, not an invariant.
  Where it is the *only* layer, it is enforcement that a `curl` bypasses.
- **`#[serde(default)]` as a schema decision.** 898 occurrences. Each one
  makes an absent field legal on the wire; where the column is `NOT NULL`, the
  absent field silently becomes the Rust `Default`, which may not be the
  column's `DEFAULT`. **`deny_unknown_fields` appears 0 times in 963 files** —
  so an unknown field is silently dropped in every direction, and a renamed
  field reads as an absent one.

## 6 Evidence

**The one site to copy:** `db/src/migrations/helpers.rs:396-449`
(`install_persona_memory_invariants`), read together with its contract text at
`core/src/models/memory.rs:88-235`. Nothing else in the tree pairs a machine
enforcement point with a numbered prose clause and an error message that names
the clause.

Other exemplary sites, each for one clause of §2:

| site | what it gets right |
| --- | --- |
| `db/src/migrations/incremental.rs:5798-5803` (`team_assignments`) | `status`/`match_strategy`/`source` each `TEXT NOT NULL DEFAULT '…' CHECK(… IN (…))` — the full form, three columns in a row |
| `dev_milestone_items.rating` (live DDL) | `CHECK(rating IS NULL OR (rating BETWEEN 1 AND 5))` — the **only** CHECK in the tree that spells the NULL arm explicitly |
| `core/src/models/memory.rs:273` | `/// See MEMORY CONTRACT (4): bounds enforced at the DB layer via trigger.` — the field back-reference that makes a clause findable from the struct |
| `db/src/repos/resources/triggers.rs:1873-1892` (`set_status`) | takes `TriggerStatus`, writes **both** `status` and `enabled` derived from it, so the two columns cannot drift *through this door* |
| `core/src/models/json_column.rs` | `from_str::<T>` — the typed door into a TEXT column holding JSON |

**Convergence — the cohort, established for this leaf, is 2.** Checked all
five sibling checkouts. `personas-cloud` and `personas-web` are excluded by
lineage (`shared-facts.json#lineage.siblings`: port-of-personas), and
`personas-web` has no self-managed store at all (`@supabase/supabase-js` only).
That leaves `vibeman` — which `shared-facts.json` records as
**`personas-ported-from-it`**, i.e. an *ancestor*, so its agreement is an
inherited constraint rather than independent evidence — `brainiac`
(Postgres/sqlx) and `ascent` (Prisma/Postgres).

- **Physics, on the Postgres side:** `brainiac` gets constraint expression for
  free in a way SQLite cannot — the doctrine's own §1 records its
  `&mut PgConnection` vs `&PgPool` transaction-boundary type. That is evidence
  about the *engine*, not about this repo's discipline.
- **Silence, and it is the reportable result:** **no independent sibling has a
  numbered prose invariant contract.** `MEMORY CONTRACT` has no counterpart in
  any of the five. Personas is **ahead** here, and the finding is that the
  format is a house invention that has been applied exactly once.
- **Inversion worth carrying:** `vibeman`'s SQLite driver
  (`src/app/db/drivers/sqlite.driver.ts:112-118`) sets `foreign_keys = ON`
  **and reads it back**, warning if it did not take, with the comment *"If this
  silently fails to take effect, every ON DELETE CASCADE / FK is a no-op and
  orphaned rows accumulate."* This repo sets it and does not verify — and has
  1,030 orphaned rows in the operator's live database
  ([`foreign-key-policy`](./foreign-key-policy.md) §7 P0-a). **The ancestor
  kept the verification; the port dropped it.** Per the doctrine's §5, cost and
  failure beat agreement, and this is a cost.

**What this sweep CLEARED — say it, so nobody re-litigates it.**
The `persona_memories` importance triggers are *not* stale, *not* mis-guarded,
and *do* fire on both paths; the boot guard that skips re-creation is correct
and saves a `sqlite_master` write per launch. `MEMORY CONTRACT` clauses (1)
tier-semantics, (3) access-counter ownership, (6) decay ranking and (7)
task-relevant recall were each checked against the live data and the code and
all four **hold**. Clause (2)'s "no FK by design" is a deliberate, correctly
reasoned choice, not an omission.

## 7 Deviations

### D1 — `MEMORY CONTRACT (5)` describes a column that does not exist · executed

`core/src/models/memory.rs:170-183` specifies `group_id` semantics in 12 lines.
`PRAGMA table_info(persona_memories)` on the live database returns 18 columns
and `group_id` is not among them; `SELECT … WHERE group_id IS NOT NULL` errors
with *"no such column: group_id"*. The column was dropped by
`retire_persona_groups` (`incremental.rs:3534`). **Fix:** delete or
tombstone clause (5) — a struck-through clause with the removing migration
named is more useful than a deletion, because the clause is cited by number
elsewhere and the numbering must not shift.

### D2 — 130 closed-set columns declared with a default and no constraint · §9's population

`TEXT NOT NULL DEFAULT '<token>'` where the column name declares a vocabulary
(`status`, `state`, `phase`, `kind`, `type`, `mode`, `tier`, `severity`,
`category`, `source`, `role`, `scope`, `direction`, `visibility`, `origin`,
`level`) and no CHECK follows within 160 characters. **130 sites in 11 files**
against **37 compliant** ones — a clean partition of the same 167-site anchor.
By file: `incremental.rs` 47, `schema.rs` 34, `lib.rs` 21, `initial.rs` 12,
`fk_hygiene.rs` 10, and 6 in test DDL. Hand-verified 14 of 14. The largest
live populations are `persona_events.status` (4,972 rows),
`provider_audit_log.status` (4,001) and `persona_triggers.status` (351).

### D3 — the use-case registry is spelled two ways in the same column · executed

Measured above (§0.3): `useCases` on 75 personas / 43 ids, `use_cases` on 15
personas / 4 ids, **15 personas carrying both**, and the mutating reader at
`commands/infrastructure/dev_tools.rs:191` reads only the snake key. **40 of 44
declared ids are unreachable by it.** Consequence in the data: of **6,344**
non-NULL `*use_case_id` values across 18 columns, **297 (4.7%) resolve in
neither namespace** — and **294 of those 297 are in one column**,
`recipe_definitions.source_use_case_id` (297 of its 316 values, 94.0%).

> **Correction to my own first measurement, and it is the doctrine's warning
> verbatim.** The first pass read only `use_cases`, found 4 declared ids, and
> reported **39.0% orphans across 12 of 18 columns**. That number *agreed with
> the thesis I was writing*, which is exactly when to re-run it. The honest
> figure is **4.7% in 1 of 18 columns** — wrong by 8.3×, and in the direction
> that flattered the finding. The real defect turned out to be sharper than the
> false one: it is not that attributions dangle, it is that the registry has two
> spellings and its reader knows one.

### D4 — the second database carries no invariant of any kind · counted

`personas_data.db`: 71 tables, 425 columns, **0 CHECK constraints**, **0
non-FTS triggers**. Its schema is `KNOWLEDGE_BASE_SCHEMA` + `COMPANION_SCHEMA`
(`db/src/lib.rs:665`, `:551`) plus 17 defensive `ALTER TABLE … ADD COLUMN`
statements whose `Result` is discarded (`let _ =`, `lib.rs:545`, `:619`) —
because "duplicate column name" is the success path on every run after the
first, which also swallows every other error. Six of those 17 ALTERs add a
`TEXT NOT NULL DEFAULT '<token>'` closed-set column (`companion_session.status
DEFAULT 'active'`, `.origin DEFAULT 'user'`, …) and none can carry a CHECK,
because `ALTER TABLE ADD COLUMN` in SQLite cannot add a table constraint. **The
migration mechanism forecloses the invariant.** This is downstream of
[`second-database`](./second-database.md) and of the fact that the user DB has
no migration runner.

### D5 — `undo_status` has a CHECK, is nullable, and every row is NULL · executed

`change_journal.undo_status TEXT CHECK (undo_status IN ('undone','conflict'))`,
**228 rows, 228 NULL**. The constraint is correct and has never been evaluated
against a stored value. Two other nullable CHECKed columns hold live NULLs:
`workspace_knowledge.layer` (**1,189 of 1,306 rows NULL** against a two-value
CHECK — 91.0% of the table declines to say which layer it is) and
`dev_milestone_items.rating` (7 of 7, and that one is *correct* — its CHECK
spells the NULL arm). Of **74** CHECKed columns, **67 are `NOT NULL`** and
**7 are nullable**; the ratio is good, and the three exceptions are the
interesting ones.

### D6 — one value the code writes, the schema refuses · executed

Isolated per-column probe over all 69 distinct `(table, column, literal)`
triples the production SQL writes: **55 unguarded, 13 accepted, 1 REFUSED.**
`incremental.rs:2233` runs
`UPDATE n8n_transform_sessions SET status = 'interrupted', error = NULL WHERE
status = 'failed' AND error LIKE '%App closed during transform%'`, and the live
CHECK is `status IN ('draft','analyzing','transforming','awaiting_answers',
'editing','confirmed','failed')`. **`'interrupted'` is not a member.** The
statement's `Result` is `.unwrap_or(0)`, so on any database where a row matches
the predicate the migration silently reports zero migrated rows. Live: 2 rows,
both `'draft'`, so no row matches today — the defect is armed, not firing.

> **Instrument correction, disclosed because it changes a number by 5×.** The
> first implementation inserted a synthetic probe row into the *real* table and
> read "CHECK constraint failed" as *the status value was refused*. It reported
> **5** refusals. Four of them were a **different** CHECK on the same table
> rejecting the synthetic row's other columns. Rebuilding the probe as a
> one-column table carrying **only** the CHECK expression that names the column
> under test took it to **1**, and the isolated instrument carries a positive
> control (legal→accepted, illegal→refused) that exits 2 if it stops
> discriminating.

### D7 — `deny_unknown_fields` appears zero times · counted

963 files, **0 occurrences**, against **898** `#[serde(default)]`. Every
persisted struct in the app silently drops fields it does not recognise, in
both directions. Combined with D3 that is not hypothetical: a JSON blob whose
key is spelled `useCases` deserialises into a struct expecting `use_cases`
as *an empty use-case list, with no error*. **The census cannot gate this** —
the condition is an absence (see §9).

### D8 — the enforcement point is a comment on 5 of 6 stated rules · read

Sampling the DDL comments that state a rule (*must*, *never*, *always*,
*exactly one*, *at most one*) in `lib.rs`'s two schema constants: e.g.
`lib.rs:1430` — *"at most one set is `status='active'` at a time"* on
`companion_goal`. There is no unique index, no trigger and no CHECK; the rule
is kept by `companion/brain/daily_goals.rs` writing `'completed'` before
inserting a new set. **A partial-index uniqueness constraint would express this
exactly** — `CREATE UNIQUE INDEX … ON companion_goal(set_id) WHERE status =
'active'` — and SQLite supports it. This is the most common shape in the
"guarded by nothing" bucket: an invariant that *is* expressible, stated in
prose, and not written.

## 8 Gaps — what the primitives genuinely cannot do

1. **A CHECK cannot reference another table.** SQLite forbids subqueries in
   CHECK. Every referential invariant is therefore either an FK or nothing —
   and where the parent is inside a blob (D3) it cannot even be an FK.
2. **`ALTER TABLE … ADD COLUMN` cannot add a table constraint.** Every column
   added after a table ships is un-CHECKable without a full table rebuild
   ([`destructive-schema-change`](./destructive-schema-change.md)). Since this
   repo's schema-change path is *"append a `run_step` at the end"*
   ([`schema-change`](./schema-change.md) §2), **the normal way to add a column
   here is also the way that forecloses its constraint.** That is the single
   biggest structural cause of D2's 130.
3. **A trigger cannot be added to the user database by the current mechanism.**
   `COMPANION_SCHEMA` is re-executed on every launch as
   `CREATE TABLE IF NOT EXISTS`; a `CREATE TRIGGER IF NOT EXISTS` would work,
   but the `install_persona_memory_invariants` name-change discipline (§3) has
   no equivalent there, and no migration ledger exists to hang it on.
4. **No type reaches inside a serialized blob**, in either direction —
   established by [`ownership-verification`](./ownership-verification.md) §5.4
   and independently by
   [`selective-per-item-verdicts`](./selective-per-item-verdicts.md). D3 is
   this repo's largest instance: a registry, its 18 referring columns, and the
   two spellings of its key are all on the far side of one `TEXT` column.
5. **Prose cannot be invalidated by a compiler.** D1 is not a bug in the
   MEMORY CONTRACT format; it is the format's price. The mitigation is to make
   every clause state *what a violation looks like in the data*, so the clause
   can be re-checked by running something rather than by trusting it.
6. **The census cannot assert an absence** (doctrine §4). "No invariant guards
   this column" and "`deny_unknown_fields` appears nowhere" are absences. §9
   gates the one *presence* that stands in for them.

## Prefer a type over a gate

Held against all seven qualifications (doctrine §1).

- **Q1 (a required prop carries only what it encodes).** A closed
  `enum MemoryTier` makes `tier = "nonsense"` unrepresentable *in Rust*. It does
  not stop the SQL string at `incremental.rs:2200` from writing `'active'`, nor
  a human at a console. **The CHECK is what covers the writer the type does not
  see** — which is why §2 says take both when both are available.
- **Q2 (requiredness ≠ closedness).** `importance INTEGER DEFAULT 3` is the
  case. Making it `NOT NULL` closes the trigger's NULL hole; it does not close
  the range. Two different edits, and the trigger already does the second one.
- **Q3 (a type nobody constructs constrains nothing).** Counted before
  proposing: `core/src/models/json_column.rs`'s typed reader is used at **108**
  `from_str::<Struct>` sites in 75 files, against **3,770** `.get("key")`
  accesses into untyped `Value` in 249 files. The typed door exists and is
  outnumbered 35:1. **Proposing a new typed door here would be proposing a
  35th:1 door.** Route to the existing one.
- **Q4 (a type anyone can construct authenticates nothing).** A `UseCaseId`
  newtype with a public field is a comment. It would also be **downstream of
  where the value entered** — the ids arrive by JSON from a template seed and
  from the model, so the newtype is built *after* the untrusted string exists.
- **Q5 (withholding beats requiring).** The strongest available move, and it is
  already demonstrated in-tree: `triggers::set_status` takes `TriggerStatus`
  and **derives `enabled` from it**, so a caller of that door cannot desync the
  two columns. It is `set_enabled` — the sibling door that writes only
  `enabled` — that produced the 26 drifted rows
  ([`data-normalization-migration`](./data-normalization-migration.md) D1,
  reproduced here: 26 rows `enabled = 0` with `status = 'active'`). **The fix
  is not a better type on `set_status`; it is deleting `set_enabled`.**
- **Q6 (withhold the dangerous freedom, not the answer).** For D3, the
  dangerous freedom is the *key spelling*, not the id. Withholding the id
  breaks the feature; putting the key in one `const` beside the writer removes
  the freedom that caused the defect.
- **Q7 (relaxing a type is inert when the caller supplies the bad value
  voluntarily).** D2's writers are not forced to write an out-of-vocabulary
  token — they choose one. No signature change reaches them. **This is the
  case where the constraint genuinely beats the type**, and it is why §9 gates
  D2 rather than proposing a newtype.

**Net:** the type wins for the transition doors (see the sibling path), the
constraint wins for the closed-set columns, and for D3 neither wins — the
storage shape is upstream of every type you could add above it, exactly as the
doctrine records.

## 9 The missing gate

**The condition:** *a column whose name declares a closed vocabulary is given a
default drawn from that vocabulary and nothing that refuses a value outside
it.* The signal is a **manifestation** — it keys on this repo's DDL idiom
(SQL written as Rust string literals with the column name and `TEXT NOT NULL
DEFAULT '<token>'` on one line). A sibling repo adopting this path must
re-derive its own proxy for the same condition; a repo whose DDL lives in
`.sql` files, or that wraps columns in a builder, will match nothing.

**Why this signal and not the more obvious ones.** Three alternatives were
measured and rejected:

- *"an invariant stated in a comment with no enforcement point"* — the
  vocabulary-based form (`must`/`never`/`always`) has its recall bounded by the
  author's word list, and the doctrine's own case study is that the forgotten
  words are the interesting ones. Declined.
- *"`.get(\"key\")` into an untyped blob"* — 3,770 hits in 249 files, and the
  overwhelming majority are legitimate reads of genuinely dynamic payloads.
  A gate that fires on correct content is worse than no gate.
- *"`deny_unknown_fields` is absent"* — the census cannot assert an absence
  (doctrine §4), and a rule matching zero files fails structurally.

**Registered checks this was compared against, at SITE level, against the
FINAL pattern** (not a file-level count, and not an intermediate draft):
all **87** registered rules with a `src-tauri` root and `.rs` extensions.
Two overlap at all: `unresumable-migration-step` (**3 lines, 2.3% of mine**)
and `default-contradicted-by-backfill` (**2 lines, 1.5% of mine**). Both are
about the migration *step*, not the column declaration; the coincidence is that
a `ddl_step` string contains both. No merge is warranted.

**Validation performed** (private scratch registry, filename unique to this
composer; the full registry was NOT run):

- baselines reproduce exactly — `11 files / 130 matches`, control
  `3 files / 37 matches`, sum `167` = the unconditional anchor count;
- **positive control partitions the anchor** rather than reporting a ratio:
  every one of the 167 `TEXT NOT NULL DEFAULT '<token>'` declarations lands in
  exactly one of the two rules;
- hand-verified 14 sampled violating sites, 14/14 real;
- disclosed imprecision: **6 of 130** sites are DDL inside test fixtures, which
  the runner cannot exclude (doctrine §4);
- fault injections, all by exit code: baseline −1 (rise) → **1**; baseline +1
  (silent drop) → **1**; `floor: 99999` → **1**; pattern matching nothing →
  **1**; control given a `baseline` → **1**; stale `exclude` entry → **1**;
  unmodified `--check` → **0**;
- re-extracted from this finished document and re-run: identical.

**How it fails loudly if its own precondition is absent.** `floor: 900` against
963 walked `.rs` files: if the walk ever sees fewer, the run fails as *"the
matcher is broken, not the codebase clean"* rather than reporting zero. The
positive control is the second guard — if it ever drops toward zero while the
gate holds, the pattern has stopped discriminating and is matching on
formatting rather than on the constraint.

**Deletion condition:** this rule ratchets a population that *cannot* reach
zero, because Gap 2 makes every `ALTER TABLE ADD COLUMN` un-CHECKable without a
rebuild. It should be **re-scoped, not deleted**, if the repo ever adopts a
rebuild-on-constrain migration helper: at that point split it into
"declared in a `CREATE TABLE`" (gateable to zero) and "added by `ALTER`"
(permanently exempt, with the reason).

```json
{
  "id": "unchecked-closed-set-default",
  "goldenPath": "docs/concepts/golden-paths/schema-inexpressible-invariant.md",
  "title": "A closed-set column is declared TEXT NOT NULL DEFAULT '<token>' with no CHECK, so the legal value set exists only in the writer's head and the default is the one answer nobody chose.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b(?:[a-z_]*(?:status|state|phase|kind|type|mode|tier|severity|category|source|role|scope|direction|visibility|origin|level))\\s+TEXT\\s+NOT\\s+NULL\\s+DEFAULT\\s+'[a-z][a-z0-9_]*'(?![\\s\\S]{0,160}?CHECK\\s*\\()",
    "flags": "gi",
    "ignoreCommentLines": true,
    "description": "A column whose NAME declares a closed vocabulary (status/state/phase/kind/type/mode/tier/severity/category/source/role/scope/direction/visibility/origin/level), declared TEXT NOT NULL with a DEFAULT drawn from that vocabulary, and no CHECK within 160 characters. PROXY FOR the stack-free condition: a value set that the store will not refuse a non-member of, so the invariant lives only in whichever writer happened to be correct — and, because the column is NOT NULL DEFAULT, an omitting writer is given the default silently, which makes 'which rows chose this' unanswerable. EXECUTED, not argued: the acceptance of every literal this repo's SQL writes was probed against a throwaway table carrying only the relevant CHECK, built from the LIVE DDL, with a legal/illegal positive control that exits 2 if it stops discriminating. Anchor: 167 declarations of this shape; this rule takes 130 and its positive control takes the other 37, so the two partition the anchor exactly.",
    "note": "Disclosed imprecision: 6 of 130 sites are DDL inside test fixtures, which the runner cannot exclude. Site-level overlap against all 87 registered src-tauri/.rs rules: unresumable-migration-step 3 lines (2.3%), default-contradicted-by-backfill 2 lines (1.5%); no merge warranted."
  },
  "baseline": { "files": 11, "matches": 130 },
  "floor": 900
}
```

```json
{
  "id": "unchecked-closed-set-default-positive-control",
  "goldenPath": "docs/concepts/golden-paths/schema-inexpressible-invariant.md",
  "title": "CONTROL — the same declaration WITH a CHECK. Partitions the anchor: 130 violating + 37 compliant = 167 total declarations of this shape.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b(?:[a-z_]*(?:status|state|phase|kind|type|mode|tier|severity|category|source|role|scope|direction|visibility|origin|level))\\s+TEXT\\s+NOT\\s+NULL\\s+DEFAULT\\s+'[a-z][a-z0-9_]*'(?=[\\s\\S]{0,160}?CHECK\\s*\\()",
    "flags": "gi",
    "ignoreCommentLines": true,
    "description": "The COMPLIANT half of the same anchor — a closed-set column declared with a default AND a CHECK within 160 characters. Carries no baseline by design (the merger skips controls and validateRule rejects a control with a baseline). If this drops toward zero while the gate above holds, the gate has stopped discriminating on the constraint and is matching on formatting."
  },
  "floor": 900
}
```

**A second instrument, which the census cannot host.** D7's condition —
*no persisted struct opts into `deny_unknown_fields`* — is an absence, and the
runner fails structurally on a rule that matches nothing. The right instrument
is a check script in the shape of `scripts/check-csp-hosts.mjs`: enumerate
every struct carrying `#[derive(… Deserialize …)]` that is read out of a TEXT
column, assert the set is non-empty (exit 2 if not — that is the
"instrument measured nothing" guard the doctrine requires), and report the
share carrying `deny_unknown_fields`. Not written here; specified so the next
composer does not re-derive it.

## 12 Corrections to the brief, and to prior claims

1. **The brief said `deny_unknown_fields` appears 0 times. Confirmed** — 0 in
   963 files, against 898 `#[serde(default)]`. Carried into D7.
2. **The brief said "a `NOT NULL DEFAULT` column is an optional field with a
   hidden answer (26 trigger rows drifted)". Both halves confirmed, and the
   attribution corrected.** The 26 rows are real (`enabled = 0` with
   `status = 'active'`, reproduced on the live copy) — but they are already
   [`data-normalization-migration`](./data-normalization-migration.md) D1, and
   the *cause* is not the default. It is that `persona_triggers` has two write
   doors and only one of them (`set_status`, which takes the closed
   `TriggerStatus`) keeps both columns in step. That makes it a Q5 withholding
   finding, not a defaults finding; it is filed under *Prefer a type over a
   gate* above rather than claimed as new.
3. **The brief said "a JSON array in a TEXT column blocks any type (per-item
   verdicts)". Confirmed and extended.** This leaf's instance is larger than a
   verdict list: it is a **registry** — 44 declared ids inside
   `personas.design_context`, referenced by 18 columns in 17 tables, of which
   16 cannot declare an FK. And the failure is not the missing FK; it is that
   the blob's key has two spellings and the reader knows one.
4. **The brief asked me to "quantify how many invariants are guarded by
   nothing". That number cannot be honestly produced, and saying so is the
   finding.** A count of unguarded invariants requires an inventory of
   invariants, and an invariant that nobody wrote down leaves no trace — the
   doctrine's own "a thing that was never declared" case. What *can* be counted
   is the guarded side and one well-defined unguarded population: **73 CHECKs +
   1 trigger-guarded rule + 20 unique indexes + 9 validator call sites + 1
   numbered contract**, against **130 closed-set columns with a default and no
   constraint** and **193 of 244 app tables with no CHECK at all**. I have
   reported those and refused the total.
5. **My own first measurement of D3 was wrong by 8.3× and agreed with my
   thesis.** Recorded in D3 rather than hidden, because it is the doctrine's
   §2 warning reproduced exactly: I read one key spelling, got 39.0% orphans,
   and it *supported the point I was making*. Re-run across both spellings and
   both namespaces: 4.7%, concentrated in one column.
6. **My first CHECK-acceptance instrument over-reported refusals 5×.** An
   unrelated CHECK on the same table rejected the synthetic probe row and was
   read as the status value being refused (D6). Fixed by isolating each CHECK
   into a one-column table, and the fixed instrument carries a legal/illegal
   control.
7. **A sibling sweep run through `rg` in bash returned zero for all five
   repos, and `rg` is not on `PATH` in this shell.** The control search
   (`rg -l "import" vibeman`) also returned nothing, which is what caught it.
   Had I trusted the first result I would have published *"0 of 5 siblings set
   any pragma or constraint"* — a false fleet-wide silence, which the doctrine
   names as one of the oracle's six failure modes. Every sibling claim in §6
   was re-taken with the `Grep` tool, and the convergence cohort for this leaf
   was established at **2 independent** (`brainiac`, `ascent`) before any of
   them was counted.
8. **Two implementations of the D2 count disagreed at first, and the
   disagreement was mine.** The violating pattern used a same-line negative
   lookahead while its control used a 160-character positive one that spans
   lines — and this repo's own style puts `CHECK` on the *next* line. The
   asymmetric pair reported 164 : 36 (sum 200) against an anchor of 167. Made
   symmetric, it is 130 : 37 = 167 exactly, which is what makes the partition
   claim checkable rather than asserted.
9. **The spine's `convergence: diverged` label is UPHELD for this leaf, and
   for a reason worth naming.** Divergence here is not sloppiness spread across
   the fleet — it is that **only two of five siblings manage a schema at all**,
   one of them in Postgres where the question is different, and the artifact
   this repo is proudest of (`MEMORY CONTRACT`) has no counterpart anywhere.
   Per the doctrine's ledger this is the *fourteenth* convergence label tested;
   the previous thirteen `converged` labels all failed. A `diverged` label
   holding is a weaker result than a `converged` one holding — divergence is
   the easier hypothesis — but it is a result, and it is reported as one.
