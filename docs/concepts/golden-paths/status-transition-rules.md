# Golden path — Status transition rules

> Situation node: `data-persistence/schema-design/status-transition-rules` ·
> [situation spine](../situation-spine.md) · recurrence 8 · risk **medium** ·
> sides: **server** · convergence: **diverged**
> Composed 2026-08-17 against `master` @ `2edb8d694`. Mode 2 batch
> (`data-persistence/schema-design`), full contract.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri`
> (`shared-facts.json#rust.files`, re-verified with its recorded instrument at
> `2edb8d694` — no value changed), lexed with
> `scripts/census/lib/instruments/extractRustStrings.mjs` after
> `stripCfgTest` blanked every brace-matched `#[cfg(test)]` range:
> **55,267** production string literals, **3,633** holding SQL. Both live
> databases were copied and queried read-only: **108 status-bearing columns**
> (89 in `personas.db`, 19 in `personas_data.db`) across 315 tables, every one
> classified for CHECK presence, live cardinality and live value distribution.
>
> **Measured by execution, not by reading.** Every claim about what a
> constraint accepts was proved by rebuilding the table from its **live DDL** in
> a throwaway SQLite file and running the write. `pause_assignment`'s exact
> value was replayed against the real `team_assignments` DDL; so was every one
> of the 69 distinct `(table, column, literal)` triples the production SQL
> writes, each against a one-column probe table carrying **only** the CHECK
> expression naming that column, with a legal/illegal positive control that
> exits 2 if the instrument stops discriminating.
>
> **`cargo` was not run.** No live database was opened for write; the copies
> were deleted.
>
> ---
>
> ## 0 The headline: the repo built a complete FSM framework, wired three enums to it, and then wrote the transition rules 108 times somewhere else
>
> **Of 108 status-bearing columns, exactly ONE is guarded on both sides — and
> it has never held a row.**
>
> | | columns | live rows in those tables |
> | --- | --- | --- |
> | **both** a CHECK *and* a Rust transition validator | **1** (`evolution_cycles.status`) | **0** |
> | a CHECK only | 23 | 264,857 |
> | a transition validator only | 11 | 5,182 |
> | **neither** | **73** | — |
>
> The 11 validator-only tables include the two largest live status populations
> reached by any validator: `persona_events` (**4,972 rows**) and
> `persona_manual_reviews` (194). Neither table has a CHECK on `status`. The
> 23 CHECK-only columns include `persona_executions.status` (2,188 rows),
> `team_assignment_steps.status` (1,488), `workspace_practice_context_state.state`
> (253,752) and `workspace_practice_adoption.state` (7,099) — none of which any
> code consults a transition table for.
>
> **0.1 — The framework exists and is good.** `core/src/lifecycle.rs`'s
> `declare_lifecycle!` generates, from one declarative transition table: the
> enum with `Serialize/Deserialize/TS`, `can_transition_to`, `transition_to`
> returning a typed `InvalidTransition`, `as_str`, `Display`, `FromStr`, and
> `ALL_VARIANTS`. It supports alias arms for legacy spellings. It is 210 lines
> and there is nothing wrong with it.
>
> **It has three users.** `TriggerStatus` and `AutomationDeployStatus`
> (`lifecycle.rs:228`, `:271`) and `ExecutionState` (`core/src/types.rs:24`).
> Two implementations agree at 3 (a grep for `pub enum … entity =` and a count
> of `declare_lifecycle! {` less the macro's own three recursive arms).
>
> **0.2 — The transition table is consulted 9 times in 963 files.**
> `.can_transition_to(` / `.validate_transition(` appear at **9 production call
> sites in 8 files** — one of which is `db/src/macros.rs:450`, a `lab_crud!`
> arm expanded at **5** invocation sites (`lab/{ab,arena,consensus,eval,matrix}.rs`),
> so the effective count is **13 validated doors over 12 tables**. Against that:
> **296** function parameters named `status`/`state`/`phase` typed as a bare
> `&str` or `String` across 140 files, and **86** SQL statements that write a
> status column with a hardcoded literal across 37 files.
>
> **`TriggerStatus`'s transition table has zero production consumers.** Its
> four states and eight legal edges are exercised only by
> `lifecycle.rs`'s own `#[cfg(test)]` block. The one production door,
> `triggers::set_status` (`repos/resources/triggers.rs:1873`), takes
> `TriggerStatus` — which is the right shape — and calls `as_str()` directly
> without ever asking `can_transition_to`. **The enum is used as a spelling
> checker, not as a state machine.**
>
> **0.3 — A shipped feature writes a value the schema refuses, and the value
> never reaches the SQL as a literal.** `pause_assignment`
> (`engine/team_assignment_orchestrator.rs:538`) calls
> `update_assignment_status(pool, id, "paused", None)`. Executed against the
> live `team_assignments` DDL:
>
> ```
> UPDATE team_assignments SET status='paused'  -> REFUSED
>     CHECK constraint failed: status IN ('queued','running','awaiting_review','done','failed','aborted')
> UPDATE team_assignments SET status='running' -> ACCEPTED
> UPDATE team_assignment_steps SET status='paused' -> REFUSED
> ```
>
> The mechanism is the whole point of this leaf: `"paused"` is a **bare `&str`
> argument**, so it is invisible to a type, invisible to a grep for status
> literals in SQL (the statement binds `?1`), and invisible to the CHECK until
> the row is written. The feature's failure is already documented as
> [`multi-step-orchestration`](./multi-step-orchestration.md) D2 with the
> ledger evidence (0 of 8,486 events is `status_paused`); what this path adds
> is the **class**: the value crossed a parameter boundary as a string, and
> every mechanism that could have caught it was on the other side.
>
> **0.4 — The declared type and the constraint agree exactly, and no code uses
> either.** `TeamAssignmentStatus` (`core/src/models/team_assignment.rs:31`) is
> a closed enum whose six variants match the live CHECK's six values
> byte-for-byte; `TeamAssignmentStepStatus` matches its seven. Both are exported
> to TypeScript (`src/lib/bindings/TeamAssignmentStatus.ts`). **Neither is
> named anywhere in `src-tauri` outside its own declaration** — the
> orchestrator's `terminal_step_status(s: &str)`
> (`team_assignment_orchestrator.rs:1084`) is `matches!(s, "done" | "skipped" |
> "failed")`, a hand-rolled subset test against three of the seven. Confirmed
> as [`multi-step-orchestration`](./multi-step-orchestration.md) D1 and cited,
> not re-claimed.
>
> ---

## Principle (stack-free head)

**A status column is a state machine, and a state machine has three parts —
the set of states, the set of legal edges, and the writer that moves between
them. Put each part in exactly one place, and make the store and the code
disagree impossible rather than merely unlikely.**

The set of states belongs in the **schema**, because the schema is the only
artifact every writer must pass — including a migration, a repair script and a
human at a console. The set of legal edges belongs in a **closed type**,
because an edge is a relation between two states and no store can express it
cheaply. The writer belongs in **one door** that takes the closed type, reads
the current state, asks the type whether the edge is legal, and performs the
write as a **single conditional statement** whose affected-row count it
returns.

Three consequences follow, and they are the whole prescription:

1. **A CHECK without a validator lets an illegal edge through**; the row lands
   in a legal state by an illegal route, which is worse than a rejection
   because nothing looks wrong afterwards.
2. **A validator without a CHECK is one door away from irrelevance**; the
   second writer — a migration, a GC pass, a repair — will use raw SQL, and it
   will be right about the value and wrong about the route.
3. **A status passed as a string is neither.** It defeats the type at the
   parameter and reaches the constraint only at the write, so the first
   feedback is a runtime error in production — if the constraint exists at all,
   which for 73 of 108 columns here it does not.

## 1 Trigger

- *"set this row to `'approved'` / `'failed'` / `'paused'`"* — you are about to
  choose one of the three shapes above, whether or not you notice.
- *"which statuses count as finished?"* — you are about to hand-write a
  terminal subset, which is [`terminal-state-and-recovery`](./terminal-state-and-recovery.md)'s
  leaf and this one's cause.
- *"add a new state to this workflow"* — the moment at which the CHECK, the
  enum, the bindings, the `tokenLabel` map and every hand-written subset test
  must all move together.
- *"the repo function validates the transition"* — a claim about door count.
- **The "if you are about to write X" test:** if you are about to type
  `status: &str` in a function signature, or `SET status = '<literal>'` in a
  SQL string, you are in this situation. Both are the deviation, not the path.
- You are reading a `matches!(s, "a" | "b" | "c")` over a status string.

## 2 The one way

**Declare the states once with `declare_lifecycle!`, mirror that exact set into
a `CHECK(col IN (…))` on a `NOT NULL` column, and give the table one write door
that takes the enum — never a `&str` — reads the current state, asks
`transition_to`, and writes with the old state in the `WHERE` clause so the
affected-row count is the verdict.** Concretely: (a) write the transition table
in `core/src/lifecycle.rs` as a `declare_lifecycle!` block, `entity = "<thing>"`,
one arm per state with its legal targets, and use the `aliases { … }` arm for
any legacy spelling still in the data rather than widening the state set;
(b) in the same change, write `status TEXT NOT NULL DEFAULT '<initial>'
CHECK(status IN (…))` listing **the same strings the enum's `as_str` emits** —
a CHECK on a nullable column does not constrain a NULL, and a CHECK whose list
drifts from `as_str` is the defect this path exists to prevent; (c) write one
`pub fn update_<thing>_status(pool, id: &str, status: <Thing>Status) ->
Result<bool>` — the parameter is the enum, the return is *whether the row
moved*; (d) inside it, read the current value, `FromStr` it, call
`current.transition_to(next)?`, and perform the write as
`UPDATE t SET status = ?1, <timestamps> WHERE id = ?2 AND status = ?3` binding
the **old** state, so a concurrent writer loses rather than clobbers (see
[`conditional-write`](./conditional-write.md)); (e) return `rows_affected == 1`
and make the caller handle `false` — a lost compare-and-swap is information,
not an error to swallow; and (f) **do not add a second door.** If a GC pass or
a migration needs to move rows, it calls this function in a loop, or it is the
one documented exception and says so in a comment naming why the transition is
safe to skip.

**If you can only do one of the two, do the CHECK.** The validator protects the
door you wrote; the constraint protects the door you have not written yet, and
the measurement in §0 says the second door always arrives.

## 3 Mandated primitives

- **`declare_lifecycle!`** (`core/src/lifecycle.rs:69-210`) — the FSM
  generator. Give it `pub enum <Name>, entity = "<thing>"` and one
  `Variant("string") => [LegalTargets]` arm per state. You get
  `can_transition_to`, `transition_to` (which returns `Ok(self)` for a
  self-transition — deliberate, and the reason idempotent re-writes do not
  error), `as_str`, `Display`, `FromStr`, and `ALL_VARIANTS`. Use the
  `aliases { "old" => New }` arm for legacy data.
- **`personas_core::lifecycle::InvalidTransition`** — the error type, carrying
  `entity`, `from`, `to`. Map it to `AppError::Validation`; its `Display` is
  already user-legible (*"Invalid trigger transition: 'disabled' -> 'paused'"*).
- **`db/src/repos/communication/manual_reviews.rs:267-300` `update_status`** —
  **the reference door.** Takes `ManualReviewStatus`, fetches current, calls
  `validate_transition`, derives `resolved_at` from the target with an
  exhaustive `match` (no `_` arm, so a new variant is a compile error), and
  writes with `AND status = ?6` as a single-winner CAS. Its comment explains
  the double-fire it prevents. Copy this file.
- **`db/src/macros.rs:376` `lab_crud!`** — where five tables share one
  lifecycle, generate the door instead of copying it. Its `update_run_status`
  arm is the validated-door shape, expanded 5×.
- **`db/src/repos/resources/triggers.rs:1873` `set_status`** — the door that
  takes the enum and derives **every** dependent column from it
  (`status.as_str()` *and* `status.is_enabled() as i32`), so the two cannot
  drift through it. This is the Q5 shape; see *Prefer a type over a gate*.
- **`ddl_step(conn, sql)`** (`db/src/migrations/incremental.rs:33`) — where the
  CHECK goes, in the same step as the column. See
  [`schema-change`](./schema-change.md).
- **`src/i18n/tokenMaps.ts::tokenLabel(t, 'execution', row.status)`** — the
  client half. A status token is a machine identifier; never render it. The
  categories are enumerated in `.claude/CLAUDE.md`.

## 4 Steps

1. **Write the state set down once, as a `declare_lifecycle!` block.** Before
   the column, before the repo function. If the set is not yet stable, that is
   an argument for writing it down, not against.
2. **Copy `as_str`'s strings into the CHECK.** Literally copy them. The two
   lists are a parity pair, and [`client-rule-mirroring`](./client-rule-mirroring.md)
   measured what happens to parity pairs that test themselves — so do not write
   a test asserting they match; write them adjacent and cite each from the
   other.
3. **Declare the column `NOT NULL DEFAULT '<initial>'`.** Executed: a CHECK on
   a nullable column accepts NULL, because `NULL IN (…)` is NULL and a CHECK
   fails only on FALSE. 7 of 74 CHECKed columns in this repo are nullable and
   3 of those hold live NULLs.
4. **Write exactly one door, taking the enum.** Not `&str`. Not `impl
   Into<String>`. The enum.
5. **Read-validate-write inside the door, with the old state in the `WHERE`.**
   Return `rows_affected == 1`.
6. **Derive every dependent column from the enum inside the door** — the
   terminal timestamp, the legacy boolean, the `error_message` reset. If a
   caller can set the status without setting the timestamp, they will.
7. **Then stop.** Do not add a client-side copy of the transition table; the
   client renders `tokenLabel(...)` and calls the command. Do not add a
   `matches!(s, …)` subset test anywhere — ask the enum.
8. **When you later add a state**, the compiler will find the exhaustive
   `match` arms for you; it will *not* find the CHECK, the hand-written
   subsets, or the `tokenLabel` entry. Grep for the new state's siblings once,
   in the same commit.

## 5 Anti-patterns

- **`fn update_<thing>_status(…, status: &str)`.** *15 doors in 12 files*
  against **9** taking a closed enum. This is the single highest-leverage
  defect in the leaf: the parameter is where the whole state set could have
  been enforced for free, and it is where a `"paused"` gets in. §9 gates it.
- **A status literal inside the SQL string.** *86 statements in 37 files.* The
  value is now inside a string literal, where — per the doctrine's *where types
  cannot reach* item 1 — no type reaches it. Nine of these write a value the
  schema does not even constrain, because 55 of the 69 distinct
  `(table, column, value)` triples target a column with no CHECK at all.
- **A hand-rolled terminal-set test.** `terminal_step_status(s: &str)`
  (`team_assignment_orchestrator.rs:1084`) is
  `matches!(s, "done" | "skipped" | "failed")` — three of
  `TeamAssignmentStepStatus`'s seven, hardcoded, beside a closed enum with the
  same seven. When a state is added, this function silently classifies it as
  non-terminal and the orchestrator loops on it. Same shape, different table:
  [`terminal-state-and-recovery`](./terminal-state-and-recovery.md)'s
  `partial-terminal-status-set`.
- **A raw-SQL status write in a GC or migration pass.** `gc_stale_pending`
  (`manual_reviews.rs:542-590`) writes `SET status = 'resolved'` in a
  transaction, bypassing the `validate_transition` its sibling `update_status`
  performs 270 lines earlier. **The value it writes is legal** — `Pending =>
  Approved | Rejected | Resolved` — so this is a *structural* bypass, not a live
  violation. It is still an anti-pattern, because the guarantee is now "the
  author checked once" rather than "the door checks".
- **A CHECK whose list drifts from the enum's `as_str`.** The one live instance:
  `n8n_transform_sessions` — `incremental.rs:2233` writes `'interrupted'`,
  a value the CHECK's seven do not include. Executed: REFUSED. The statement's
  `Result` is `.unwrap_or(0)`, so on a database where a row matches the
  predicate it reports zero migrated rows and continues.
- **Treating `status` as free text.** `scraper_configs.last_status` holds
  `"ok — 1 new, 0 changed, 0 unchanged, 0 error(s)"` and
  `api_key_audit.status` holds the integer `200`. Both are named `status` and
  neither is a lifecycle; a column that carries a sentence or an HTTP code
  should be named for what it is, because the name is what makes a reader
  reach for this path.
- **A CHECK on a nullable status column.** `change_journal.undo_status`
  `CHECK (undo_status IN ('undone','conflict'))`, **228 of 228 rows NULL** —
  the constraint has never been evaluated against a stored value.
- **Rendering the token.** A status is a machine identifier in 14 locales;
  `tokenLabel()` exists for exactly this.

## 6 Evidence

**The one site to copy:** `db/src/repos/communication/manual_reviews.rs:267-300`.
It is the only door in the tree that does all four of: takes the closed enum,
validates the transition, derives the dependent column with an exhaustive
`match`, and writes as a single-winner CAS with the old state in the `WHERE`.

| site | what it demonstrates |
| --- | --- |
| `core/src/lifecycle.rs:216-234` | the `declare_lifecycle!` declaration form, with the transition table restated in the doc comment above it |
| `core/src/lifecycle.rs:95-105` | the `aliases` arm — how to accept a legacy spelling **without** widening the state set |
| `db/src/macros.rs:425-470` (`lab_crud!`) | one validated door generated for five tables |
| `db/src/repos/resources/triggers.rs:1873-1892` | the door that derives *every* dependent column from the enum |
| `db/src/repos/execution/audit_incidents.rs:395-440` | a hand-written `can_transition` + `apply_transition` pair — not using `declare_lifecycle!`, but the only place a transition table was written for a table the framework does not cover |
| `db/src/repos/communication/events.rs:838-900` | the door whose doc comment names the **missing** edge (`Processing -> DeadLetter`) and the code path that works around it — a deviation documented at its site |

**Convergence — cohort 2, and the label is CONTRADICTED, in a way worth
naming.** Established per-leaf at composition time. `personas-cloud` and
`personas-web` are excluded by lineage (`shared-facts.json#lineage.siblings`:
port-of-personas); `vibeman` is excluded as an **ancestor**
(`personas-ported-from-it`). That leaves `brainiac` and `ascent`.

- **The fleet converged on the *disease*, which the doctrine names as
  convergence-oracle failure mode two.** Neither independent sibling has a
  transition table for any status column. `brainiac` is Postgres and could
  express one as a trigger or a domain type; it does not. `ascent` is Prisma
  and could express the state set as an `enum` in `schema.prisma` — the
  cheapest possible version of clause (b) — and does not. **Perfect agreement
  on an omission is evidence the situation is universal and evidence AGAINST an
  answer existing to adopt.**
- **So Personas is ahead, and the spine's `diverged` label points the wrong
  way.** `declare_lifecycle!` is a better artifact than anything in the cohort;
  the leaf's problem is adoption (3 enums, 13 doors, 108 columns), not
  ignorance. A brief scoped by "diverged" would look for a fleet answer to
  import. There isn't one. **Report: `convergence` contradicted, fourteenth
  test, and the direction is backwards rather than the label merely wrong.**
- **One cost signal, from the ancestor.** `vibeman`'s SQLite driver verifies
  that `foreign_keys` actually took effect and warns if not
  (`src/app/db/drivers/sqlite.driver.ts:112-118`); this repo does not. Not a
  transition finding, but the same discipline — *check that the guarantee you
  configured is in force* — and it is the discipline missing from all 73
  unguarded columns here.

**What this sweep CLEARED.** `declare_lifecycle!` itself is correct: the
transition tables are right, `transition_to` handles self-transitions
deliberately, the `aliases` arm is a good answer to legacy data, and the
generated `FromStr` errors rather than defaulting. `ExecutionState`'s
integration through `engine/process_session.rs` is real and used.
`manual_reviews::update_status`'s CAS is correct and its comment is accurate.
The `lab_crud!` macro is not a smell — it is the right response to five tables
sharing one lifecycle.

## 7 Deviations

### D1 — 73 of 108 status columns are guarded by neither a CHECK nor a validator · counted

The full 2×2 is in §0. The eleven validator-only tables (`persona_events`,
`persona_manual_reviews`, `persona_test_runs`, `genome_breeding_runs`,
`persona_automations`, `build_sessions`, and the five `lab_*_runs`) hold
**5,182** live rows between them and not one CHECK on the status column. The
one table with both, `evolution_cycles`, holds **0**.

### D2 — 15 transition doors take a bare `&str` · §9's population

`fn update|set|mark|transition|advance|apply_*_(status|phase|state)(…, status:
&str …)`. **15 declarations in 12 files** against **9** taking a closed enum —
a 62 : 38 split of the same 24-door anchor. The list includes
`team_assignments::update_assignment_status` (`:444`) and
`team_assignments::update_step_status` (`:483`), which are the doors
`pause_assignment` walks through, and `dev_tools::set_auto_run_status`,
`dev_workspaces::update_playbook_status`, `healing::update_status`,
`smee_relays::set_status`, `research_lab::update_source_status`,
`design_conversations::update_status` and `dev_tools::set_kpi_binding_status`.

### D3 — `pause` writes a value the CHECK rejects, and no artifact could have said so · executed

Covered in §0.3. The addition this path makes to
[`multi-step-orchestration`](./multi-step-orchestration.md) D2 is the
**generalisation**: `"paused"` is passed as `&str` through `update_assignment_status`,
which binds it as `?1`. It is therefore absent from every SQL literal in the
tree, so the 86-site status-literal sweep does not see it, the closed enum that
would have rejected it is not in the signature, and the CHECK is the first and
only thing that ever objects — at write time, in production. **Three
independent mechanisms existed and all three were on the wrong side of the
parameter.**

### D4 — the transition table is consulted 13 times against 296 stringly-typed status parameters · counted

`can_transition_to`/`validate_transition`: 9 literal call sites in 8 files,
13 after macro expansion. `status`/`state`/`phase` parameters typed `&str` or
`String`: **296 in 140 files** (against 217 typed as a closed enum in 94 files
— note this wider count includes struct fields, not only doors; the door-only
figures are D2's 15 : 9). The ratio is the finding: the framework is not
disliked, it is **unreachable from where most status writes happen**.

### D5 — `TriggerStatus`'s eight transition edges have zero production consumers · counted

`TriggerStatus` is referenced at 8 production sites (`chain.rs:681`,
`models/trigger.rs:519-522`, `repos/resources/triggers.rs:1876`, and the
`lifecycle.rs` impl block). Every one uses `as_str`, `from_enabled`,
`is_enabled` or `parse`. **`can_transition_to` is called only from
`lifecycle.rs`'s `#[cfg(test)]` block.** So the four states are enforced as a
vocabulary and the eight edges are enforced by nothing — including the edge the
transition table explicitly forbids (`Disabled -> Paused`, asserted false at
`lifecycle.rs:378`).

### D6 — `persona_triggers` has two doors and only one of them keeps both columns in step · executed

`set_status` takes `TriggerStatus` and writes `status` **and** `enabled`
derived from it. `set_enabled` writes only `enabled`. Live: **26 of 351 rows
have `enabled = 0` with `status = 'active'`** — reproduced on a read-only copy,
and already published as
[`data-normalization-migration`](./data-normalization-migration.md) D1. Cited
here for its *cause*: not the migration and not the default, but a second door
that can express half a transition. **The fix is deleting `set_enabled`, not
improving `set_status`.**

### D7 — `gc_stale_pending` bypasses the validator it sits beside · read

`manual_reviews.rs:579` writes `SET status = 'resolved'` as raw SQL inside a
transaction, 300 lines below `update_status`'s `validate_transition`. **The
value is legal from `pending`**, so nothing is corrupt today. The defect is
structural: the guarantee has silently changed from "the door checks" to "the
author checked once", and the next GC pass added to this file inherits the
precedent rather than the door.

### D8 — 86 status writes carry the value as a SQL literal · counted, two implementations reconciled

**86 `UPDATE … SET <status-ish> = '<literal>'` statements in 37 files**, against
85 that bind a parameter. Concentrated in `companion/brain/consolidation.rs`
(7), `repos/communication/events.rs` (6), `engine/persona_jobs.rs` (6),
`repos/execution/audit_incidents.rs` (5), `repos/execution/healing.rs` (5).
Of the 69 distinct `(table, column, value)` triples these produce, executed
against probe tables built from the live DDL: **55 unguarded, 13 accepted,
1 refused** (D9).

> **The two implementations disagreed at 86 vs 108 and the reconciliation is
> the finding.** The bespoke implementation matched `SET … status = '…'` over
> raw file text and over-counted by 25: **18 status *predicates*** (`WHERE id =
> ?2 AND status = 'running'` — the same bytes as a write, on the other side of
> the `WHERE`), **6 prose comments**, and **1 SQL `--` comment** inside a DDL
> string. Reconciled to 83, then hand-verified at each of the remaining
> contested sites, all of which resolved in favour of 86 — the bespoke
> reconciler's 14-line back-walk crossed statement boundaries on multi-line
> `SET` lists. **A status predicate and a status write are textually identical;
> only the `WHERE` boundary separates them, and a matcher that does not respect
> it reports a guard as a defect.**

### D9 — one status literal the schema refuses · executed

`incremental.rs:2233`, `n8n_transform_sessions.status = 'interrupted'` against
a CHECK admitting seven other values. Live table holds 2 rows, both `'draft'`,
so no row matches the migration's predicate today; the statement is armed, not
firing, and its `.unwrap_or(0)` means it would report success either way.

### D10 — `change_journal.undo_status`: a CHECK that has never seen a value · executed

228 rows, 228 NULL, against `CHECK (undo_status IN ('undone','conflict'))` on
a nullable column. The two literals the code writes (`change_journal.rs:352`,
`:361`) are both legal; they have simply never been written.

### D11 — two closed enums matching the live CHECK exactly, with zero consumers · cited

`TeamAssignmentStatus` / `TeamAssignmentStepStatus`. Established as
[`multi-step-orchestration`](./multi-step-orchestration.md) D1 and re-verified
here against the live DDL (6/6 and 7/7 value match). Not re-claimed.

## 8 Gaps — what the primitives genuinely cannot do

1. **`declare_lifecycle!` cannot reach a column that is not read into it.**
   The macro produces a type; a type constrains a value that passes through a
   parameter. 86 status writes put the value inside a SQL string and 296
   parameters accept it as `&str`. This is doctrine §1 *where types cannot
   reach* item 1, and it is why §2 asks for the CHECK **as well**.
2. **A SQLite CHECK cannot express an edge.** `CHECK(status IN (…))` is a
   vocabulary. There is no cheap way to say "only from `queued`" without a
   trigger comparing `OLD.status` to `NEW.status` — which is expressible
   (`install_persona_memory_invariants` is the local precedent) and which
   nothing in this repo does for any status column.
3. **`ALTER TABLE … ADD COLUMN` cannot add a CHECK.** Most status columns here
   arrived by ALTER, per this repo's schema-change path
   ([`schema-change`](./schema-change.md) §2). So the *normal* way to add a
   status column is also the way that forecloses its constraint — the
   structural cause of D1's 73. See
   [`schema-inexpressible-invariant`](./schema-inexpressible-invariant.md)
   Gap 2 and [`destructive-schema-change`](./destructive-schema-change.md) for
   the rebuild that would be required.
4. **The census cannot assert that a CHECK and an enum agree.** That is a
   cross-artifact parity claim, and per doctrine §2 a test that lives beside
   one of the two artifacts is a third copy, not a check. What *could* work is
   a runtime assertion at boot: for each `declare_lifecycle!` enum, read
   `sqlite_master` for the bound table and compare `ALL_VARIANTS.map(as_str)`
   against the CHECK's parsed list. Not written here; specified so it is not
   re-derived.
5. **`transition_to` returning `Ok(self)` on a self-transition means a
   no-op write cannot be distinguished from a legal move by the type alone.**
   That is the right default (it makes retries idempotent), and it is why §2
   clause (e) asks for the affected-row count as the actual verdict.

## Prefer a type over a gate

- **Q1 (a required prop carries only what it encodes).** A closed
  `TeamAssignmentStatus` on `update_assignment_status` makes `"paused"` a
  compile error — which is exactly the D3 defect, so here the type does reach
  the failure. It does **not** reach the 86 in-SQL literals, and it does not
  say anything about *edges*; `Done -> Queued` type-checks fine.
- **Q2 (requiredness ≠ closedness).** The status parameter is already required
  at all 15 `&str` doors. Requiredness buys nothing; closedness is the entire
  win. This is the textbook case for the distinction.
- **Q3 (a type nobody constructs constrains nothing).** Counted before
  proposing, and the answer is uncomfortable: `TeamAssignmentStatus` has
  **zero** construction sites. But the fix does not require anyone to construct
  it voluntarily — changing the parameter type makes construction mandatory at
  every call site, which is precisely the difference between this and a
  newtype nobody reaches for.
- **Q4 (a type anyone can construct authenticates nothing).** Not a concern
  here: the enum is a *closed vocabulary*, not a capability. `FromStr` is the
  only construction from untrusted input and it errors on an unknown value.
- **Q5 (withholding beats requiring).** The strongest form available, and it
  has a live proof in-tree: `triggers::set_status` **withholds** the `enabled`
  boolean — the caller cannot supply it, it is derived — and through that door
  the two columns cannot drift. The 26 drifted rows came through `set_enabled`,
  the door that hands the dangerous value back. **The prescription is: derive
  every dependent column inside the door, and delete the door that lets a
  caller set half a transition.**
- **Q6 (withhold the dangerous freedom, not the answer).** The dangerous
  freedom is *which string*, not *which row*. Taking the enum removes exactly
  that and nothing else.
- **Q7 (relaxing a type is inert when the caller supplies the bad value
  voluntarily).** Applies to D8's 86 in-SQL literals: no signature change
  reaches a string literal inside a SQL statement. Those need the CHECK.

**Net: this leaf is one of the corpus's clearest type-beats-gate cases for the
doors (15 signatures, one mechanical edit each, and D3 becomes a compile
error), and one of its clearest gate-beats-type cases for the 86 in-SQL
literals and the 73 unguarded columns.** §9 gates the door population, because
that is the one where a ratchet and a permanent fix point at the same 15 sites.

## 9 The missing gate

**The condition:** *the function that moves a row between lifecycle states
accepts the target state as an unconstrained string, so the legal state set is
a convention re-derived at every call site and first checked — if at all — by
the store, at write time, in production.*

The signal is a **manifestation**: it keys on this repo's Rust idiom
(`fn update_<thing>_status(pool, id, status: &str)`). A repo whose repository
layer is a query builder, or whose doors are methods on a struct, will match
nothing and must re-derive its own proxy for the same condition — *the write
door's state parameter is not a closed type*.

**Why the declaration and not the call site.** The obvious signal — a bare
status literal at a transition call site — is **already registered** as
`untyped-lifecycle-transition` (owner:
[`multi-step-orchestration`](./multi-step-orchestration.md), baseline
26 files / 152 matches). Measuring site-level overlap against **all 87**
registered `src-tauri`/`.rs` rules, against my **final** pattern (not an
intermediate draft), the overlap with that rule is **0 lines**. The two are
complementary by construction: it counts the 152 places the convention is
*exercised*, this counts the **15 places it could be abolished**. Fixing one
declaration retires roughly ten of its matches. The only non-zero overlaps are
incidental line-span collisions with two very broad rules — `untimed-repo-query`
(13 lines, 0.2% of theirs) and `blind-identity-write` (11 lines, 1.1% of
theirs) — both of which span whole repo functions, so any signal keyed on a
repo function's signature will brush them.

**Validation performed** (private scratch registry, filename unique to this
composer; the full registry was NOT run):

- baselines reproduce exactly — `12 files / 15 matches`; positive control
  `11 files / 11 matches`;
- **the control is the compliant half of the same anchor** — the same door
  shape with a closed `*Status`/`*State`/`*Phase` parameter — so a drop toward
  zero on the control means the pattern has stopped discriminating on the
  parameter type;
- hand-verified all 15 violating sites and all 9 enum-typed doors by opening
  each signature; the control's 11 vs my bespoke 9 differ by two struct-field
  matches inside a signature span, disclosed rather than tuned away;
- fault injections, all by exit code: baseline −1 (rise) → **1**; baseline +1
  (silent drop) → **1**; `floor: 99999` → **1**; pattern matching nothing →
  **1**; control given a `baseline` → **1**; stale `exclude` → **1**;
  unmodified `--check` → **0**;
- re-extracted from this finished document and re-run: identical.

**How it fails loudly if its own precondition is absent.** `floor: 900` against
963 walked `.rs` files. If a future refactor moves the repo layer out of
`src-tauri`, the walk shrinks and the run fails as *"the matcher is broken"*
rather than reporting a clean zero.

**Deletion condition:** unlike most census rules, **this one can and should
reach zero** — every one of the 15 is a mechanical signature change. The census
cannot express "must be zero" (doctrine §4), so when the count reaches 1,
convert the last site to the enum and **delete the rule** rather than
baselining it at 0. Record the deletion in this section.

```json
{
  "id": "stringly-typed-transition-door",
  "goldenPath": "docs/concepts/golden-paths/status-transition-rules.md",
  "title": "The door that writes a row's lifecycle status accepts it as &str, so the legal state set is a convention the compiler never sees and every caller re-derives it.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\bfn\\s+(?:update|set|mark|transition|advance|apply)_[a-z0-9_]*(?:status|phase|state)\\s*(?:<[^>]{0,80}>)?\\s*\\((?:[^)]{0,400}?)\\b(?:new_|next_|target_)?(?:status|phase|state)\\s*:\\s*&\\s*(?:'[a-z]+\\s+)?str\\b",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A lifecycle-transition function DECLARATION (update_/set_/mark_/transition_/advance_/apply_ + status|phase|state) whose state parameter is a bare string slice. PROXY FOR the stack-free condition: the single write door for a row's lifecycle takes an unconstrained value, so the legal state set is enforced nowhere the compiler can see it and the store is the first thing that ever objects. EXECUTED, not argued: pause_assignment's exact value was replayed against the live team_assignments DDL and REFUSED by the CHECK ('paused' is not among queued/running/awaiting_review/done/failed/aborted), while 'running' and 'awaiting_review' were accepted - and the value never appears as a SQL literal anywhere, because it crosses this parameter as a &str and binds as ?1. Anchor: 24 doors of this shape; this rule takes 15 and its positive control takes the enum-typed remainder.",
    "note": "COMPLEMENTARY TO untyped-lifecycle-transition (multi-step-orchestration), not overlapping: measured at SITE level against the FINAL pattern over all 87 registered src-tauri/.rs rules, overlap with that rule is 0 lines. It counts the 152 places the convention is exercised; this counts the 15 places it can be abolished. THIS RULE CAN REACH ZERO - every site is a mechanical signature change. Delete it at 1 rather than baselining at 0 (the census cannot express must-be-zero)."
  },
  "baseline": { "files": 12, "matches": 15 },
  "floor": 900
}
```

```json
{
  "id": "stringly-typed-transition-door-positive-control",
  "goldenPath": "docs/concepts/golden-paths/status-transition-rules.md",
  "title": "CONTROL — the same transition door taking a closed *Status/*State/*Phase enum. The compliant half of the same 24-door anchor.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\bfn\\s+(?:update|set|mark|transition|advance|apply)_[a-z0-9_]*(?:status|phase|state)\\s*(?:<[^>]{0,80}>)?\\s*\\((?:[^)]{0,400}?)\\b(?:new_|next_|target_)?(?:status|phase|state)\\s*:\\s*(?:&\\s*)?(?:Option<\\s*)?[A-Z][A-Za-z0-9]*(?:Status|State|Phase)\\b",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "The COMPLIANT half of the same anchor — a transition door whose state parameter is a closed enum. Carries no baseline by design (the merger skips controls and validateRule rejects a control with a baseline). If this trends toward zero while the gate above holds, the pattern has stopped discriminating on the parameter TYPE and is matching on the function name alone."
  },
  "floor": 900
}
```

**A second instrument, which the census cannot host.** Gap 4's parity check —
for every `declare_lifecycle!` enum, compare `ALL_VARIANTS.map(as_str)` against
the bound table's CHECK list read from `sqlite_master`. It must be a **boot-time
or test-time assertion over the real database**, not a fixture comparison,
because per doctrine §2 a fixture living beside one of the two artifacts is a
third copy. It must exit non-zero if it finds **zero** enums to check — that is
the "instrument measured nothing" guard. It would have caught D9 and would
catch the next `n8n_transform_sessions`.

## 12 Corrections to the brief, and to prior claims

1. **The brief said `gc_stale_pending` "writes `'resolved'` as raw SQL
   bypassing `validate_transition`" — true, and the implied severity is wrong.**
   `ManualReviewStatus::validate_transition` allows `Pending -> Resolved`
   (`core/src/models/review.rs:41`), so the bypass writes a **legal** value.
   The finding is structural (D7), not a live corruption, and saying so is the
   difference between a fix backlog and a false alarm.
2. **The brief said `TeamAssignmentStatus`/`TeamAssignmentStepStatus` have 0
   consumers and that `terminal_step_status` passes "21 bare literals".
   Confirmed on the enums; the literal count is not re-asserted.** My own count
   of status-token literals in that file is 79 across 14 distinct tokens, which
   measures a different thing (all status strings anywhere in the file, not
   arguments to one function). Rather than publish a third number for a
   neighbour's finding, I cite
   [`multi-step-orchestration`](./multi-step-orchestration.md) D1/D2 and add
   only the class-level generalisation (D3).
3. **The brief said `"paused"` is one of the literals the CHECK rejects.
   Confirmed by execution — and the *mechanism* is the opposite of what a
   literal-sweep would suggest.** `"paused"` is **not** a SQL literal anywhere;
   it is a `&str` argument that binds as `?1`. My 86-site literal sweep did not
   and could not find it. That inverts the gate design: the countable signal is
   the **parameter**, not the literal, which is why §9 gates declarations.
4. **The brief framed this leaf as "how transitions are expressed vs
   enforced". The measured answer is that they are expressed in three places
   and enforced in two, and the three barely intersect** — 3 lifecycle enums,
   24 CHECK-constrained status columns, 13 validated doors, over 108 columns,
   with an intersection of exactly **1** (`evolution_cycles`, 0 rows).
5. **A second implementation of the CHECK-presence classification disagreed
   with the first on `evolution_cycles`, and the second was wrong for a reason
   the doctrine already records.** The disagreeing implementation was written
   into a bash heredoc and used `` new RegExp(`\b${col}\b`) `` — inside a JS
   **template literal**, `\b` is U+0008 (backspace), not a word boundary, so
   the test matched nothing and reported *no CHECK*. That is the doctrine's
   §2 mechanics rule (*"Regex patterns go in a file, never in bash argv and
   never in a heredoc"*) earning a second case, in a new costume: the mangling
   was JavaScript's, not MSYS's, but the symptom — a silently non-matching
   pattern that reads as a clean negative — was identical. **A second earning
   case for an existing doctrine rule is worth reporting as loudly as a new
   one**, because it establishes the rule generalises past its original cause.
6. **`convergence: diverged` is CONTRADICTED, and backwards.** Cohort
   established at **2 independent** (`brainiac`, `ascent`; the other three
   excluded by lineage). Neither has a transition table for any status column,
   in a language where one is cheap. So the fleet has converged on the
   *absence*, Personas owns the fleet's best artifact, and the leaf's real
   problem is adoption. Per the doctrine's ledger this is one more label test;
   the `sides: "server"` label, by contrast, **held** — the exemplar, all
   eleven deviations, the census rule, its control and its floor are all
   server-side Rust, and the client's only role is `tokenLabel()`.
7. **The 86 vs 108 disagreement between my two implementations was
   informative and is recorded in D8 rather than smoothed over.** 18 of the
   difference are status *predicates* (a guard reported as a defect), 7 are
   prose. Hand-verification at every contested site settled it at 86.
