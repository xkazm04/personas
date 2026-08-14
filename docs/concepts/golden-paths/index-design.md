# Golden path — Index design

> Situation node: `data-persistence/query-performance/index-design` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 from a ground-truth sweep of `src-tauri/**` against `master`.
> Sweep size: **963 `.rs` files** (exactly `rust.files` in [`shared-facts.json`](../shared-facts.json)) ·
> **583 `CREATE INDEX` statements** and **408 `CREATE TABLE` statements over 313 distinct table names**
> parsed with a balanced-paren DDL parser · **1,655 SQL string literals** extracted from non-migration
> Rust, of which **1,441** resolve to a known table, yielding **1,498 predicate / sort / join checks**
> each tested against the parsed index set · **8 `DROP INDEX`** · **12 table-rebuild sites**.
> Every count was produced by a script run against the tree, and the two findings that drive §9 were
> cross-checked by a second independent implementation (the census regex and the DDL parser
> independently agree on 20 boolean-column indexes in 4 files).
>
> **This path is unusual in the corpus: a large part of it is measured against RUNNING SOFTWARE.**
> The operator's live `personas.db` (347 MB, 241 tables, 742 indexes, 363,205 rows) and
> `personas_data.db` (67 tables, 96 indexes) were copied and opened read-only, and every claim about
> whether an index is *used* comes from `EXPLAIN QUERY PLAN` and `sqlite_stat1` against that database
> rather than from reading DDL. Per the [model-effort guide](../../development/model-effort-guide.md),
> *a gate that asserts data is not a gate on behaviour* — so the behaviour was observed.
>
> Dimensions: **performance · cost · resilience · code-quality**.
> A **convergence sweep** ran against `brainiac` (Rust · sqlx · Postgres · 56 indexes / 46 tables) and
> `personas-cloud` (TS · better-sqlite3 · 19 indexes / 14 tables). **It inverted the brief's premise
> and one clause this document would otherwise have asserted** (§6).
>
> **Sibling boundaries, settled in prose.**
> [**Schema change**](./schema-change.md) owns *where DDL goes* — the `run_step` at
> `incremental.rs`, the `already_applied` probe, the registry joins, the phantom-table class. It
> already says "a new table's `CREATE TABLE` **plus every `CREATE INDEX`** go in one `ddl_step`
> batch". **This path owns which indexes those should be**, and why. When that path says "put the
> index in the migration", this one says which columns, in which order, and how you know it worked.
> [**Persisted model struct**](./persisted-model-struct.md) owns the struct↔column shape —
> `NOT NULL`, `Option<T>`, `CHECK IN`, the wire casing. It governs what a column *is*; this path
> governs what the database is asked to *find*. The one place they touch is the low-cardinality
> column: that path makes it a `CHECK IN (…)` enum, this path says do not index it alone.
> [**Paginated list query**](./paginated-list-query.md) owns the *query* — the clamp, the keyset
> cursor, the `(created_at DESC, id DESC)` order, the page struct. This path owns the *index that
> query needs*, and it corrects that path's Gap 3 with a measurement (§7 P1).
>
> The **Deviations** section is a fix backlog.

## 1 Trigger

- "This list got slow now that there are a few thousand rows"
- "Add an index for X" / "does this query have an index?"
- "I'm adding a `WHERE`/`ORDER BY`/`JOIN` on a column that's never been filtered before"
- "Should this be one composite index or two single-column ones?"
- "There's already an index on `status` — is that enough?"
- "This table is append-only and nobody prunes it"
- "I renamed/rebuilt a table — do I need to do anything about its indexes?"

If you are about to type `CREATE INDEX`, `ON <table>(`, `WHERE <new_column> =`, `ORDER BY` on a
column that is not already an index prefix, or `JOIN … ON` a column that is not a key — you are in
this situation.

**Not this path:** *whether the query is bounded at all* (a `LIMIT`, a cursor, a clamp) is
[paginated-list-query](./paginated-list-query.md). An unbounded query with a perfect index is still
unbounded. Bound the fetch first; index it second.

## 2 The one way

**An index is a claim about a query, so write the query down and then write the index that serves
it — in the same `ddl_step` batch as the table if the table is new, in a `run_step` guarded by
`has_index` if the table already ships.** Lead the column list with the **equality** predicates, in
any order, then the **range or sort** column last, with its `DESC` if the query sorts descending:
`WHERE persona_id = ? ORDER BY created_at DESC` gets `(persona_id, created_at DESC)` and **not** two
separate indexes — SQLite uses exactly one index per table per query, so a second narrow index over a
prefix of the first is never chosen and costs a b-tree write on every row change. Put the served
query in a `--` comment on the line above, in the exact shape
`-- WHERE persona_id = ? ORDER BY created_at DESC (listing, stats, cost)`; that comment is the only
artefact that lets the next person tell a live index from an abandoned one, and
`incremental.rs:1466-1512` is the band to copy. **Never index a boolean or a two-value column on its
own** — `enabled`, `is_read`, `is_active` — because half the table is not a narrower answer than the
whole table; if a query only ever wants one value, write a **partial** index
(`ON t(col) WHERE col = 1`) so the index holds only those rows. **Never give an index the name of an
index on another table**: SQLite index names are global, `CREATE INDEX IF NOT EXISTS` matches on the
*name*, and a collision makes your statement a silent no-op (§7 P0). And **never write `CREATE INDEX
IF NOT EXISTS` to *change* an existing index** — it will not; pair it with an explicit
`DROP INDEX IF EXISTS <name>;` first, as `idx_delib_one_active_per_team` does across its three
revisions. Then stop: no `ANALYZE` call (the app already runs `PRAGMA optimize` on idle), no
per-table index audit, no speculative index for a query nobody has written.

### Which clauses are physics, which are this house

Per the [contract](../golden-path-contract.md) and the
[portability test](../research/portability-test.md), a clause travels only if something else
reinvented it. Measured 2026-08-14 against `brainiac` and `personas-cloud`. Detail in §6.

| Clause | Warrant | Evidence |
|---|---|---|
| **Declare the index in the same migration as its table** | **physics** | Personas **455 / 583 (78%)** co-located; `brainiac` **36 / 56 (64%)**; `personas-cloud` **12 / 19 (63%)**. Three codebases, three stacks, the same ~2/3–3/4 split, and all three have a "retrofit" migration for the rest (`brainiac/migrations/0033_list_indexes.sql` exists purely to add five indexes to queries that shipped without them) |
| **Write the served query as a comment above the index** | **physics — and the sibling does it 10× better** | `brainiac` **22 / 56 (39%)** carry a query-naming comment against Personas' **23 / 583 (3.9%)**. `brainiac/migrations/0033_list_indexes.sql:9-13` names the sort, the row count where it stops being free, and the consequence. This is the clause with the widest gap between what this repo knows and what it does |
| **Equality columns first, sort column last** | **physics** | Both siblings' composites are built this way (`memories (org_id, created_at desc, id)`; `persona_events(status, next_retry_at)`), and Personas' own commented band states the rule implicitly at every line |
| **Do not index a boolean alone; use a partial index** | **physics, and this repo is the outlier** | `brainiac` has **zero** single-column boolean indexes and **12 partial indexes (21% of its total)**; Personas has **20** boolean indexes and **17 partial (2.9%)**, of which **14 are UNIQUE constraints** — so only **3 partial indexes in the entire schema exist to make a read cheaper**, against `brainiac`'s ~9. `personas-cloud` has 3 low-cardinality indexes and **zero** partial indexes |
| **A narrow index that is a prefix of a composite is dead** | **physics** | `brainiac` 1 instance, `personas-cloud` 1 instance, Personas **38**. Every codebase does it; only this one does it at scale |
| **Maintain planner statistics** | **house — nobody else does it, and this repo is AHEAD** | Personas runs `PRAGMA analysis_limit = 1000` on every pooled connection (`db/src/lib.rs:207`) plus `PRAGMA optimize` in an idle-gated maintenance loop (`:226-259`); both live databases carry populated `sqlite_stat1` **and** `sqlite_stat4`. **`brainiac` has run `ANALYZE` zero times. `personas-cloud` has run `ANALYZE` zero times.** See §6 — this contradicted the sweep's own expectation |
| **Assert the plan (`EXPLAIN QUERY PLAN`) in a test** | **unvalidated — no oracle anywhere** | **Zero** executions in all three repos. `brainiac` mentions it once, in a comment declining to run it (`crates/brainiac-store/src/queue.rs:113`). §9 proposes it anyway, and marks it as unproven rather than doctrine |
| **Index the column a `JOIN` keys on** | **cannot be separated here** | Only **1** unindexed join key exists in this tree (§7), so the clause is unfalsifiable locally. Both siblings join through PKs. Stated, not warranted |

## 3 Mandated primitives

**Exist today — use them:**

- **`db/src/migrations/incremental.rs:1466-1512`** — the **reference band**, and the one site to copy.
  A single `ddl_step` carrying 15 indexes, each preceded by a `--` comment naming the query it
  serves, in the exact shape `-- WHERE persona_id = ? ORDER BY created_at DESC (listing, stats, cost)`.
  Its header states the policy: *"These cover the most frequent WHERE + ORDER BY combinations found
  across repository modules."*
- **`…/incremental.rs:2366-2401`** — the second such band, for `chat_messages`, `persona_memories`
  and `automation_runs`, including the only comment in the tree that names a *background* consumer
  (`-- reap_stale_runs: WHERE status = 'running' AND julianday(started_at) …`).
- **`…/incremental.rs:76-83`** — `has_index(conn, name)`. The `already_applied` probe for an
  index-only migration. **Used twice in production** (`:3253`, `:4469`) out of 583 index
  declarations; everything else relies on `IF NOT EXISTS`, which is fine for creation and **wrong for
  revision** (§5).
- **`…/incremental.rs:4466-4481`** — `dev_triage_page_indexes`. The model **index-only `run_step`**:
  unique id, human description, `has_index` guard, one `ddl_step`. Copy this shape whenever the table
  already exists.
- **`…/incremental.rs:3937,:3964,:3990`** — `DROP INDEX IF EXISTS <name>;` immediately before the
  `CREATE`. **The only correct way to change an index definition.** Three successive revisions of
  `idx_delib_one_active_per_team`, each dropping first; the live database carries the newest shape,
  which is the proof it works.
- **`db/src/migrations/fk_hygiene.rs:117-…`** — `recreate_with_fk`. Its doc comment (`:152-157`)
  states the index contract for a table rebuild: *"Indexes and triggers are likewise replayed from
  `sqlite_master` rather than only from `index_sqls`: `DROP TABLE` takes them with it."* This is
  correct and it is the shared helper behind 9 of the 12 rebuilds.
- **`db/src/lib.rs:201-208` `STANDARD_PRAGMAS`** — `PRAGMA analysis_limit = 1000` on every pooled
  connection. This is what makes `PRAGMA optimize` bounded and therefore safe to run.
- **`db/src/lib.rs:226-259` `spawn_idle_maintenance_task`** — `PRAGMA optimize; PRAGMA
  wal_checkpoint(TRUNCATE);` every 300s, **gated on `ipc_in_flight() == 0`** so it never competes
  with a user action. This is the repo's `ANALYZE`. **Do not call `ANALYZE` yourself.**
- **`db/src/macros.rs:331` `timed_query!`** + **`db/src/perf.rs`** — the measurement layer.
  `timed_query!("<table>", "<repo>::<op>", { … })` records into a 2,048-sample ring buffer
  (`perf.rs:52`), computes per-table avg / p95 / max (`:156-221`), and `tracing::warn!`s any query
  over `SLOW_QUERY_THRESHOLD = 100ms` (`perf.rs:53`) under a 5-per-table-per-60s budget
  (`:59-60`) so a retry storm cannot drown the signal. **922 of the 1,266 `pub fn`s in
  `db/src/repos/` (72.8%) are wrapped.** Wrap yours.
- **`personas.db` itself.** `EXPLAIN QUERY PLAN` and `sqlite_stat1` against the operator's real
  database are available in ten seconds and settle every question in this document. Use them before
  you argue about an index.

**Do not exist — this path names them:**

- **A `db::keyset::page(…)` helper that owns its index.** [paginated-list-query](./paginated-list-query.md)
  Gap 2 asks for it from the query side; this path asks that when it lands it take the index it
  requires as part of its plan, so a keyset page without a supporting index is unrepresentable rather
  than merely slow. See "Prefer a type over a gate".
- **A redundancy check over `sqlite_master`.** ~20 lines of SQL, finds all 38 prefix-redundant and
  all 8 constraint-shadowing indexes today, needs no query corpus. §9.

## 4 Steps

1. **Write the query first, in full, including its `ORDER BY`.** You cannot choose an index for a
   query you have not written. If the query is a paged read, finish
   [paginated-list-query](./paginated-list-query.md) first — the cursor predicate changes the answer.
2. **Ask whether the table can grow.** Measured on the operator's live database: **200 of the 473
   explicit indexes sit on tables holding zero rows**, and **152 of 241 tables hold ten rows or
   fewer**. Only **25 tables exceed 1,000 rows**. On a table that is bounded by construction — a
   seeded catalog, a config table, one row per persona — **an index is a cost with no benefit**, and
   a full scan of 40 rows is free. Do not add one. This is the step most often skipped, and it is why
   the schema carries 583 indexes for 25 tables that need them.
3. **Ask the type-over-gate question here.** If this is a keyset page, the index is not an
   optimization — it is part of the page's contract, and it belongs *with* the helper, not beside
   it. See "Prefer a type over a gate" below.
4. **Choose the column list: equalities first, range/sort last.**

   | The query | The index | Why |
   |---|---|---|
   | `WHERE a = ? ORDER BY b DESC` | `(a, b DESC)` | one index serves both the filter and the sort |
   | `WHERE a = ? AND b = ?` | `(a, b)` | order between the equalities does not matter to SQLite |
   | `WHERE a = ? AND b > ?` | `(a, b)` | the range column must be last; nothing after it can be used |
   | `WHERE a = ?` **and** `WHERE a = ? ORDER BY b` | `(a, b DESC)` **only** | the composite serves the bare `WHERE a = ?` too. A second `(a)` index is never chosen — verified, §6 |
   | `WHERE flag = 1` where `flag` has two values | `(flag) WHERE flag = 1`, or nothing | a plain `(flag)` index reads half the table through an extra b-tree. §5 |
   | `WHERE a = ? AND status IN ('x','y')` on a mostly-terminal table | `(a) WHERE status IN ('x','y')` | a partial index holds only the live rows |

5. **Name it `idx_<table-abbrev>_<columns>` and check the name is not already taken.**
   `grep -rn "idx_your_name" src-tauri/db/src/` before you commit. Index names are **global**, not
   per-table; a collision silently discards your index (§7 P0).
6. **Land the DDL** per [schema-change](./schema-change.md):
   - **New table** → `CREATE TABLE IF NOT EXISTS` **plus every `CREATE INDEX`** in one `ddl_step`
     batch, so they commit together, inside the table's own `run_step`.
   - **Existing table** → a new `run_step` at `incremental.rs`, `already_applied: |conn|
     has_index(conn, "idx_your_name")`, one `ddl_step`. `dev_triage_page_indexes` (`:4466`) is the
     template.
   - **Changing an existing index** → `DROP INDEX IF EXISTS idx_x;` then `CREATE …`, in that order,
     in one `ddl_step`, guarded by something other than `has_index` (the name will still be there).
7. **Write the `--` comment above it, naming the query.** Not "index for performance". The literal
   predicate: `-- WHERE persona_id = ? ORDER BY created_at DESC (execution list, cost rollup)`.
   Three years from now this comment is the only way to know whether the query still exists.
8. **Wrap the repo fn in `timed_query!("<table>", "<table>::<op>", { … })`** if it is not already.
   That is what turns a future regression into a `Slow DB query detected` warn instead of a user
   complaint.
9. **Observe the plan.** Copy the operator's database and run it:
   ```
   EXPLAIN QUERY PLAN SELECT … ;
   ```
   `SEARCH <table> USING INDEX <your index>` is the answer you want. `SCAN <table>` means the index
   is not being used; `USE TEMP B-TREE FOR ORDER BY` means the sort is not covered even if the filter
   is. Both are things you can only learn by looking.
10. **Stop.** No `ANALYZE` (`PRAGMA optimize` already runs). No extra single-column index "just in
    case". No index on a table you have not seen exceed a few hundred rows.

## 5 Anti-patterns

- **A narrow index beside a composite that starts with the same column — 38 instances, and the
  planner has never once chosen one.** `idx_pe_persona ON persona_executions(persona_id)` sits next
  to `idx_pe_persona_created ON persona_executions(persona_id, created_at DESC)`. Verified against
  the live database: `EXPLAIN QUERY PLAN SELECT * FROM persona_executions WHERE persona_id = ? ORDER
  BY created_at DESC LIMIT 40` returns `SEARCH persona_executions USING INDEX idx_pe_persona_created`;
  the narrow one is never named. Same result for `persona_events(status)` vs `(status, created_at)`.
  Each of the 38 is pure write amplification: a b-tree page touched on every INSERT and on every
  UPDATE of its column, forever, in exchange for nothing.
- **Indexing a boolean — 20 instances, and they *are* used, which is worse than being ignored.**
  The actual distribution in the live database, for the exact query each index exists to serve:
  `WHERE enabled = 1` matches **76 of 78** `personas` rows (**97%**), **325 of 351** `persona_triggers`
  (**93%**), **95 of 102** `persona_event_subscriptions` (**93%**). The predicate is not a filter; it
  is a synonym for "all rows". And SQLite still picks the index —
  `SEARCH personas USING INDEX idx_personas_enabled (enabled=?)` — because the planner's estimate
  comes from `sqlite_stat1`, which stores the **average** rows-per-distinct-key (39 of 78, 176 of 351)
  and therefore never sees the 97/3 skew. So the app pays the write cost on every INSERT and UPDATE
  *and* takes a b-tree detour to read almost the whole table. The legitimate construction over the
  same column is a **partial** index — `idx_owned_devices_single_home ON owned_devices(is_home) WHERE
  is_home = 1` (`incremental.rs:4726`) is the one instance in the tree that does it right.
- **Giving an index a name that already belongs to another table's index.** `CREATE INDEX IF NOT
  EXISTS` matches on the **name**, globally. The statement becomes a no-op, returns `Ok`, logs
  nothing, and the index you wrote does not exist. Two live instances (§7 P0). This is the single
  quietest failure in this leaf, and no test in the tree can see it because every index-existence
  assertion checks `sqlite_master WHERE name = ?` — which finds the *other* table's index and passes.
- **Using `CREATE INDEX IF NOT EXISTS` to change an index.** Adding a column, adding a `WHERE`,
  flipping `DESC` — none of it happens. The name exists, so nothing runs. `idx_delib_one_active_per_team`
  is declared four times across `incremental.rs:3795, :3938, :3965, :3991` with three different
  definitions and the live database carries the newest one **only because each revision is preceded
  by `DROP INDEX IF EXISTS`** at `:3937, :3964, :3990`. Drop first, always.
- **Duplicating a `PRIMARY KEY` or a `UNIQUE` constraint with an explicit index — 8 instances.**
  SQLite already builds an index for both. `idx_engine_project_pulse_recent ON
  engine_project_pulse(project_id, day DESC)` (`db/src/lib.rs:1328`) duplicates
  `PRIMARY KEY (project_id, day)` declared three lines above (`:1325`); the `DESC` buys nothing because SQLite
  scans an index in either direction. Seven more non-unique indexes exactly restate a `UNIQUE`
  constraint (§7).
- **Adding an index because a table "feels big".** 200 of 473 explicit indexes are on tables with
  zero rows in the operator's real install. Look first.
- **Rebuilding a table without replaying its indexes.** `DROP TABLE` takes every index and trigger
  with it. Eleven of the twelve rebuild sites handle this — nine through `fk_hygiene.rs`'s
  `sqlite_master` capture, two by re-issuing `CREATE INDEX` after the `RENAME`. The twelfth
  (`incremental.rs:6923-6941`) does neither. It is harmless today only because its table has no
  indexes, which makes it the most dangerous thing in the file to copy.
- **Indexing to fix an unbounded query.** `list_all_executions` returns 200 full `PersonaExecution`
  records with prompts and outputs; no index makes that payload smaller.
  [paginated-list-query](./paginated-list-query.md) owns that, and it is upstream of this path.
- **Building the index name with `format!`.** Eighteen of the live database's explicit indexes have
  no `CREATE INDEX` anywhere in the source tree — twelve sync-watermark indexes generated by the loop
  at `incremental.rs:7995`, four `idx_lab_*_runs_active`, and two others. They are real, they work,
  and **no static analysis of this repo can see them**, including §9's. Prefer literal DDL.
- **Assuming `ORDER BY` is free because the `WHERE` has an index.** The `dev_ideas` triage page —
  the repo's own reference keyset implementation — produces
  `MULTI-INDEX OR / SEARCH dev_ideas USING INDEX idx_dev_ideas_triage / USE TEMP B-TREE FOR ORDER BY`.
  The index serves the filter; the composite cursor predicate `(created_at < ? OR (created_at = ? AND
  id < ?))` splits into an OR-union that SQLite must re-sort. §7 P1.

## 6 Evidence

**Adoption.** 583 `CREATE INDEX` across 6 files — **579 in the five migration/schema files, 4 in
`src/bench/db.rs`** (a genuinely separate `bench.db`, not a shadow of anything). 507 distinct index
names over 242 distinct tables. 184 composite (31.6%), 38 with three or more columns, 142 carrying a
`DESC` key, 25 `UNIQUE`, 17 partial (2.9%). 455 (78%) declared within 120 lines of their table's
`CREATE TABLE` in the same file. Of the 298 table names declared in a migration file, 15 are `_new`
rebuild-staging tables and 3 are virtual (FTS/vec0), leaving **280 real persistent tables — of which
42 carry no explicit index at all**. On
the live database: 241 tables, 473 explicit indexes + 269 auto-indexes, 363,205 rows.

- **`db/src/migrations/incremental.rs:1466-1512` — copy this one.** Fifteen indexes, each with the
  query it serves written above it, in a single atomic `ddl_step`, with a header stating the policy.
  It is 3.9% of the corpus and it is the whole doctrine. Read it before writing any index.
- **`…/incremental.rs:4466-4481` `dev_triage_page_indexes`** — the index-only `run_step`: `has_index`
  guard, human description naming both surfaces it serves ("the unified Backlog … and Run Desk"), one
  `ddl_step`.
- **`…/fk_hygiene.rs:152-157`** — the doc comment that states the rebuild contract for indexes, and
  the `index_sqls`-first / captured-objects-second precedence rule that makes a name collision
  resolve deterministically.
- **`…/incremental.rs:8648-8695` `a_blocked_group_id_drop_no_longer_takes_persona_groups_with_it`** —
  the one test in the tree written *about* an index. It exists because **SQLite refuses
  `ALTER TABLE … DROP COLUMN` while any index names that column**, and the migration's hand-written
  `DROP INDEX` list could not know about `idx_personas_group_and_name`, a composite that older
  installs acquired. The fixture recreates that exact index deliberately. This is the failure mode
  nobody predicts: an index blocking a schema change years later.
- **`…/incremental.rs:8766-8785`** — a fresh-schema assertion that eleven named indexes exist, with
  the failure message *"its incremental migration did not run"*. Add yours here.
- **`…/incremental.rs:9013-9023`** — `for idx in [...] assert!(has_index(&conn, idx), "{idx} was not
  replayed")`. The rebuild-replay assertion. Copy it whenever you rebuild a table.
- **`db/src/perf.rs:241-278` `record_query`** — the slow-query path: threshold, per-table warn budget,
  a rolled-over consolidation line carrying the suppressed count and the worst duration. This is a
  well-built instrument.

### Convergence — what two sibling repos did without reading this

Run 2026-08-14, read-only, against `brainiac` (Rust · sqlx · Postgres · 56 indexes over 46 tables,
67% of tables indexed) and `personas-cloud` (TS · better-sqlite3 · 19 indexes over 14 tables, 64% of
tables indexed). **It inverted the brief's premise and contradicted a clause this document was going
to assert.**

- **The brief's premise — "index definitions diverge between install paths the way table definitions
  do" — is wrong, and the measurement is unambiguous.** Production tables carrying shadow
  `CREATE TABLE` DDL in a non-migration file: **41**, in **32** files (this path's independent parse;
  [persisted-model-struct](./persisted-model-struct.md) Gap 8 reports 40 over the same 32 files — a
  one-table difference in table-name extraction, not a disagreement about the condition). **Indexes
  do not follow: 579 of 583 sit in the five migration files, and the other 4 belong to
  `src/bench/db.rs`'s separate `bench.db`.** There is not one instance of a production table's index
  being redeclared differently in a fixture. **The real finding is the opposite one, and it is
  worse:** 34 of those 41 shadow tables have production indexes — **77 of them** — and their fixture
  copies have **none**. The
  divergence is not "different index"; it is "no index". Every test that exercises `kb_documents`,
  `companion_node`, `companion_turn`, `companion_approval` and 30 more runs against an index-free
  table, so **no test in this repo can ever observe an index regression on those tables**, and none
  ever will while the fixtures hand-roll their own DDL. The fix is not an index-parity check; it is
  `init_test_db()`, which already exists and is already called 369 times.
- **Personas is AHEAD of both siblings on the thing that matters most, and this was not expected.**
  Planner statistics: Personas sets `PRAGMA analysis_limit = 1000` on every pooled connection and runs
  `PRAGMA optimize` on an idle-gated 300s loop; both live databases carry populated `sqlite_stat1`
  *and* `sqlite_stat4`. **`brainiac` has never run `ANALYZE`. `personas-cloud` has never run
  `ANALYZE`, and its SQLite planner runs on hard-coded defaults forever.** Query timing: Personas
  wraps 922 of 1,266 repo functions with per-table p95 and a 100 ms slow-query warn; `brainiac`
  measures at the *request* level only; `personas-cloud`'s 391-line `metrics.ts` collector measures
  Claude execution latency and contains **no database timer at all**. On this axis the sibling sweep
  found nothing to teach us, which is rare and worth saying plainly.
- **…and the sibling still beats us on the last mile.** `brainiac` surfaces its latency percentiles
  to a human — `retrieval_events.p50/p95_latency_ms` → `console.rs:1902-1903` → the console
  Observatory. **Personas measures and drops it on the floor:** `getDbPerformance` is exported at
  `src/api/system/system.ts:96` and **called from nowhere in `src/`**. A 2,048-sample ring buffer with
  per-table p95, reachable by an IPC command that no UI invokes. The only surviving channel is the
  `tracing::warn`. Measuring without surfacing is how a good instrument becomes a dead one.
- **The comment discipline is physics and we are the ones failing it.** `brainiac` 22/56 (39%) of
  indexes name the query they serve; Personas 23/583 (3.9%). And its comments are better than ours.
  `migrations/0033_list_indexes.sql:9-13`: *"The archive orders by (created_at DESC, id) and pages
  with LIMIT/OFFSET. That sort had no supporting index — fine at 80 rows, a full scan + sort at
  10k."* `migrations/0046_contradiction_sibling_lookup.sql:18-25` goes further than anything in this
  tree and reasons about the **planner rule**: *"Postgres can use a partial index only when the
  query's own predicate implies the index's, and both call sites … filter on `status = 'open'`
  explicitly."* That is what §4 step 7 is asking for.
- **The partial index as a read optimization is the construction this repo has not adopted.**
  `brainiac`: 12 partial indexes, 21% of its total, only 3 of which are unique — so ~9 exist purely
  to make a read cheaper (`idx_memory_feedback_open ON memory_feedback(memory_id) WHERE resolved_at
  IS NULL AND verdict IN ('wrong','outdated')`). Personas: 17 partial, **14 of them UNIQUE** ("at most
  one active X"), leaving **exactly 3** read-optimizing partial indexes across 298 tables. And
  `brainiac` has **zero** single-column boolean indexes while Personas has 20 — the same 20 the
  partial form would have replaced. This is the best-warranted fix in the document: the sibling
  reached the correct construction independently and uses it seven times as often.
- **The one structural move, and its honest limit.** `brainiac` makes "missing index" *unrepresentable*
  on exactly one axis: registering an embedding version and creating its ANN index are one operation
  (`crates/brainiac-store/src/memories.rs:138-148` → `ensure_hnsw_index_for_dim`, backed by a
  `SECURITY DEFINER` function and serialized by `pg_advisory_xact_lock`), so a new embedding dimension
  **cannot** be served by a sequential scan. It covers 1 of its 56 indexes and does not generalise;
  the other 53 are human judgment recorded in a comment. It is still the right shape, and
  "Prefer a type over a gate" below is the Personas version of it.
- **Nobody runs `EXPLAIN`.** Zero executions in Personas, zero in `brainiac` (one mention, in a
  comment declining to), zero in `personas-cloud`. §9's plan-assertion test is therefore **local
  calibration, not doctrine** — it is the right instrument and no one has built it, which is a reason
  for caution, not confidence.
- **Where the siblings are worse, plainly.** `personas-cloud` has **zero** comments on **zero of 19**
  indexes, zero partial indexes, one index that exactly duplicates a `UNIQUE` constraint declared 12
  lines above (`db.ts:402` vs `:390`), and six genuinely unindexed hot paths including
  `getDueTriggers` (`WHERE enabled = 1 AND next_trigger_at <= datetime('now')`, no index on
  `next_trigger_at`, runs every scheduler tick) and `getSubscriptionsByEventType` (the per-event
  dispatch fan-out, no index on `event_type`, mitigated only by a 60s in-process cache). Personas'
  equivalent surfaces are all indexed.

## 7 Deviations found

### P0 — an index that was written, shipped, and does not exist

| Path | Defect |
|---|---|
| `db/src/migrations/incremental.rs:1881` and `:1882` | `CREATE INDEX IF NOT EXISTS idx_pe_persona ON policy_events(persona_id)` and `idx_pe_created ON policy_events(created_at DESC)`. **Both names already belong to `persona_executions`**, created earlier at `schema.rs:130` and `:132`. SQLite index names are global; `IF NOT EXISTS` matched the name and made both statements silent no-ops. **Verified against the live database:** `policy_events` carries exactly `sqlite_autoindex_policy_events_1` and `idx_pe_execution` — nothing else — and `idx_pe_persona`/`idx_pe_created` both resolve to `tbl_name = 'persona_executions'`. `EXPLAIN QUERY PLAN SELECT * FROM policy_events WHERE persona_id = ? ORDER BY created_at DESC` returns `SCAN policy_events / USE TEMP B-TREE FOR ORDER BY`. **Honest severity:** the table holds 25 rows and its only production reader (`db/src/repos/execution/policy_events.rs:66`) filters by `execution_id`, which the surviving index covers — so this is a **latent** defect, not a live wound. It is P0 for the *mechanism*: nothing errored, nothing logged, no test can detect it (every index assertion in the tree checks `sqlite_master WHERE name = ?`, which finds the collision and passes), and the next collision may land on a table that matters. **Fix:** rename to `idx_polev_persona` / `idx_polev_created`, or delete them — `policy_events` is append-only and never read by persona. |

### P1 — the reference keyset page does not get an index-ordered read

`paginated-list-query.md` Gap 3 says *"Keyset indexes exist for exactly two tables… without these the
paged reads degrade to a full scan + sort on every page."* **Measured: the index prevents the scan and
does not prevent the sort.** Against the live database:

```
EXPLAIN QUERY PLAN
SELECT * FROM dev_ideas WHERE status = ?
  AND (created_at < ? OR (created_at = ? AND id < ?))
  ORDER BY created_at DESC, id DESC LIMIT 51;
-> MULTI-INDEX OR
->   SEARCH dev_ideas USING INDEX idx_dev_ideas_triage (status=? AND created_at<?)
->   SEARCH dev_ideas USING INDEX idx_dev_ideas_triage (status=? AND created_at=?)
-> USE TEMP B-TREE FOR ORDER BY
```

The composite cursor predicate — the very shape that path prescribes — is an `OR`, which SQLite
splits into a two-branch index union and then re-sorts. `idx_dev_ideas_triage(status, created_at DESC)`
is doing its job on the filter; the sort is paid every page regardless. This is not a defect in
either document's prescription — it is the cost of a correct keyset cursor on SQLite, and it is
bounded by the page size rather than the table. **It should be written down** so nobody adds a third
index chasing a sort that no index can eliminate, and so the correct expectation for a keyset page is
"index-served filter, temp-sorted page", not "fully index-ordered".

### Redundant indexes — 46 total, none of which the planner has ever chosen

| Class | Count | Where |
|---|---:|---|
| **Strict left-prefix of a composite on the same table** | **38** | `schema.rs` 18 · `incremental.rs` 11 · `fk_hygiene.rs` 8 · `initial.rs` 1. Densest: `persona_executions(persona_id)` under `(persona_id, is_simulation)` (`schema.rs:130`), `persona_executions(status)` under `(status, created_at DESC)` (`:131`), `persona_events(status)` and `(project_id)` (`fk_hygiene.rs:374,:375`), `persona_memories(persona_id)` under `(persona_id, importance DESC, created_at DESC)` (`:620`), all four `lab_*_results(run_id)` under their `_composite` siblings |
| **Non-unique index exactly restating a `UNIQUE` constraint** | **7** | `incremental.rs:1428` `recipe_versions(recipe_id, version_number DESC)` · `:1596` `credential_recipes(connector_name)` · `:4992` `obsidian_sync_state(entity_type, entity_id)` · `:5827` `team_assignment_steps(assignment_id, step_order)` · `initial.rs:185` `shared_event_catalog(slug)` · `initial.rs:376` `external_api_keys(key_hash)` · `schema.rs:1562` `evolution_policies(persona_id)` |
| **Index exactly restating a `PRIMARY KEY`** | **1** | `db/src/lib.rs:1328` `idx_engine_project_pulse_recent ON engine_project_pulse(project_id, day DESC)` vs `PRIMARY KEY (project_id, day)` at `:1325`. The `DESC` is not a difference — SQLite scans an index in either direction |
| **Two names for one (table, columns) pair** | **1** | `db/src/lib.rs:1261` `idx_companion_background_job_status` and `:1263` `idx_companion_job_status_created`, both `ON companion_background_job(status, created_at)`. Two identical b-trees |

Behavioural confirmation that all 46 are dead: SQLite uses at most one index per table per query, and
`EXPLAIN QUERY PLAN` names the composite in every case tested (`idx_pe_persona_created` over
`idx_pe_persona`; `idx_pev_status_created` over `idx_pev_status`).

### Low-cardinality indexes — 20 boolean + 7 more on a ≤3-value `CHECK`

The boolean twenty, with the live fraction of rows their own query matches: `personas(enabled)`
(`schema.rs:39`, **76/78 = 97%**), `persona_triggers(enabled)` (**325/351 = 93%**, declared
**three times**: `schema.rs:97`, `incremental.rs:493`, `:1092`), `persona_event_subscriptions(enabled)`
(`schema.rs:347`, **95/102 = 93%**), `persona_messages(is_read)`
(`schema.rs:269`, `fk_hygiene.rs:590`), `credential_events(enabled)` (`schema.rs:208`),
`persona_design_patterns(is_active)` (`schema.rs:394`), `credential_rotation_policies(enabled)`
(`schema.rs:732`, `incremental.rs:3753`), `evolution_policies(enabled)` (`schema.rs:1563`),
`alert_rules(enabled)` (`initial.rs:142`), `shared_event_subscriptions(enabled)` (`initial.rs:200`),
`discovered_peers(is_connected)` (`incremental.rs:1684`), `output_assertions(enabled)` (`:1845`),
`notification_subscriptions(enabled)` (`:2858`), `sla_breach_episodes(is_open)` (`:4123`),
`composition_workflows(enabled)` (`:5320`), `twin_profiles(is_active)` (`:5345`).

Seven more index a `CHECK (col IN (…))` column with two or three legal values:
`design_conversations(status)` (`:713`), `template_feedback(rating)` (`:1573`),
`pending_trigger_fires(status)` (`:2356`), `artist_assets(asset_type)` — `IN ('2d','3d')` — (`:4960`),
`twin_pending_memories(status)` (`:5408`), `credential_rotation_history(status)` (`schema.rs:750`),
`import_transactions(status)` (`schema.rs:917`).

### Predicates with no supporting index — 210 sites, and the important half is clean

Every `WHERE` / `ORDER BY` / `JOIN ON` in 1,441 non-migration SQL literals was tested against the
parsed index set **using the composite rule** (a column is supported when every index column before
it is an equality predicate of that same query — the naive "is it a leading column" test overcounts
by 30% and was discarded).

| | Count |
|---|---:|
| Predicate / sort / join checks performed | 1,498 |
| **Unsupported** | **210** (109 `WHERE`, 100 `ORDER BY`, **1 `JOIN`**) |
| Distinct (table, column, kind) | 133 |
| …falling on a table with **zero** explicit indexes | 27 sites / 19 pairs / 14 tables |

**The hypothesis that these concentrate on hot paths does not survive.** Cross-referencing the 36
tables `paginated-list-query.md` names as growing without bound: **33 carry at least one explicit
index.** The three that do not — `workspace_practice_adoption`, `companion_turn_sidecar`,
`schedule_missed_runs` — are each keyed by a `PRIMARY KEY` that every one of their queries uses, and
SQLite's auto-index serves them (verified: `SEARCH workspace_practice_adoption USING INDEX
sqlite_autoindex_workspace_practice_adoption_1 (practice_id=? AND project_id=?)` on a 7,099-row
table). The largest table in the operator's database, `workspace_practice_context_state` at **253,752
rows**, is correctly served by `idx_wpcs_project`. **`persona_executions`, `persona_events`,
`persona_messages`, `persona_memories` and `persona_manual_reviews` produce zero unsupported
predicates between them.** The hot path is indexed. That is the headline of this section and it
should not be softened into a warning.

Where the 210 actually sit — tables that are small today and would be a real cost only if the Factory
grows:

| Table | Unsupported sites | Explicit indexes | Live rows |
|---|---:|---:|---:|
| `dev_projects` (`name`, `workspace_id`, `status`, `created_at`, `updated_at`, `tech_stack`) | 32 | 2 | 14 |
| `personas` (`name` ×2 kinds, `icon`, `updated_at`) | 13 | 7 | 78 |
| `dev_contexts` (`name`, `pinned`) | 8 | 2 | 408 |
| `workspace_knowledge` (`title`, `status`, `dedup_key`) | 8 | 2 | 1,306 |
| `dev_ideas` (`risk`, `context_id`, `scan_type`) | 7 | 4 | 236 |
| `dev_scans`, `dev_triage_rules`, `dev_context_group_relationships`, `dev_workspaces` | 16 | **0 each** | 65 · **0** · **0** · 2 |

`EXPLAIN QUERY PLAN` confirms the shape for all of them:
`SCAN dev_projects / USE TEMP B-TREE FOR ORDER BY`. At 14 rows that is the correct plan and an index
would be slower. **The honest prescription is not "add 19 indexes" — it is "these are the tables to
watch, and the moment one of them is a per-project table on a fleet of 50 repos, index it."** The one
unindexed `JOIN` key in the whole tree is `dev_ideas.context_id` (`db/src/repos/dev_tools.rs:5919`,
`src/commands/infrastructure/context_consolidate.rs:652`).

### Structural

- **The one rebuild that does not replay indexes.** `incremental.rs:6923-6941` (widening
  `workspace_practice_adoption.state`'s `CHECK`) does `CREATE … _new; INSERT … SELECT; DROP TABLE;
  RENAME` with **no `sqlite_master` index capture and no `CREATE INDEX` after the rename**. Eleven
  sibling rebuilds do one or the other — nine via `fk_hygiene.rs`'s capture (`:152-157`), two by
  re-issuing the `CREATE INDEX` statements inline (`:419-422`, `:490-493`). It is harmless today
  because the table has no explicit indexes. It is a **template defect**: it is 19 lines, it reads
  like a complete rebuild, and copying it onto a table that *does* have indexes destroys them
  silently.
- **18 live indexes are invisible to source analysis.** Twelve sync-watermark indexes built by
  `format!` at `incremental.rs:7995`, four `idx_lab_*_runs_active`, `idx_lab_ratings_uniq` and
  `idx_pe_source_recipe`. That is **3.8% of the live explicit index set** that no grep, no census
  rule and no parser in this repo will ever see. Any claim of the form "all indexes are X" is wrong
  by construction.
- **34 shadow-DDL fixture tables run index-free while their production twins carry 77 indexes.**
  See §6. `init_test_db()` is the fix and it already exists.
- **Nothing consumes the perf snapshot.** `getDbPerformance` (`src/api/system/system.ts:96`) has zero
  callers. `DbPerfSnapshot`'s binding exists, the barrel exports it, and no component imports it.
  Also note the binding types `totalQueries` and `totalSlowQueries` as `bigint`
  ([persisted-model-struct](./persisted-model-struct.md) rule A) — so even a future consumer starts
  with a coercion.
- **Zero index gating.** `npm run check` (TypeScript, ESLint, contracts, tiers, Tauri configs,
  census), `lefthook.yml` (ESLint, secrets, i18n) and `cargo clippy -D warnings` have no opinion
  about SQL. Every deviation above shipped green.

## 8 Gaps in the primitive

1. **`CREATE INDEX IF NOT EXISTS` cannot express "this index, with this definition".** It matches a
   global name and nothing else, so it silently accepts both a collision with another table's index
   (P0) and a stale definition it was meant to replace. SQLite offers no `CREATE OR REPLACE INDEX`.
   The workaround — `DROP INDEX IF EXISTS` first — is correct, used at three sites, and unenforced.
2. **`has_index(conn, name)` checks a name, not a shape.** `incremental.rs:76-83` queries
   `sqlite_master WHERE type='index' AND name=?1`. It returns `true` for an index on a *different
   table* with the same name, which is exactly how P0 stays invisible: any test asserting
   `has_index("idx_pe_persona")` passes while `policy_events` has no such index. A
   `has_index_on(conn, table, name)` — one extra `AND tbl_name = ?2` — closes it, and would have
   caught the P0 at authoring time.
3. **Nothing connects a query to its index.** They live in different files, in different languages,
   joined only by a table name in a string literal. `rusqlite` compiles
   `"SELECT … WHERE unindexed_col = ?1"` happily; there is no `sqlx::query!` equivalent — and the
   convergence sweep found `brainiac` enables sqlx's `macros` feature and uses `query_as!` **zero**
   times, so the compile-time-checked path is unproven even where it is available. This is the same
   shape as [persisted-model-struct](./persisted-model-struct.md) Gap 3.
4. **`PRAGMA optimize` is invisible, and it is already drifting.** It runs on a 300s idle loop and
   logs at `tracing::debug!` (`db/src/lib.rs:241`); whether statistics are fresh, stale, or were never
   gathered because the app never idles is not observable from inside the app. **Measured drift:**
   `sqlite_stat1` records `persona_event_subscriptions` at **71 rows, 71 per distinct `enabled`
   value**; the table currently holds **102 rows split 95/7**. The planner is costing that index
   against a table shape that no longer exists. `sqlite_stat1` covers **404 of the 473 explicit
   indexes** — the other 69 have no row at all, so the planner falls back to built-in guesses for
   them. The database will answer both questions in one `SELECT` and nothing asks it.
5. **The perf ring buffer has no persistence and no consumer.** 2,048 samples in memory, cleared on
   every restart, exposed through one IPC command nobody calls. A regression that shows up as a p95
   climbing from 8 ms to 40 ms over three releases is measured, aggregated, and then discarded. The
   `tracing::warn` at 100 ms is the only durable channel, and it is a threshold, not a trend.
6. **No index is attributable to a query after the fact.** 560 of 583 indexes carry no statement of
   what they serve, and SQLite has no `pg_stat_user_indexes` equivalent — no `idx_scan` counter, no
   way to ask an index whether anyone has ever used it. Once the comment is missing, the only way to
   retire an index is to reconstruct every query that could use it. **This is why §4 step 7 is not
   optional: the comment is the only durable record that will ever exist.**
7. **A partial index's usability depends on the query's predicate implying the index's, and nothing
   checks that.** `brainiac` writes the rule out in a comment (§6); SQLite will simply not use the
   index if the implication does not hold, silently, with no diagnostic. A partial index whose
   `WHERE` drifts from its callers' is indistinguishable from an index that does not exist.
8. **Test fixtures are index-free and `init_test_db()` cannot be forced.** 34 production tables have
   hand-rolled fixture DDL with none of their 77 production indexes. Nothing prevents the next
   fixture from doing the same.
9. **Index names are a flat global namespace with no convention and no check.** 507 names, several
   abbreviation schemes (`idx_pe_*` means both `persona_executions` and `policy_events`), and
   collisions are silently accepted. A naming rule (`idx_<full_table>_<cols>`) plus a uniqueness
   assertion is trivially checkable and does not exist.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md) this must be answered explicitly. **For this leaf the
answer is "on one axis, yes; in general, no" — and the general no is a real finding, not a
concession.**

**Where a type works.** A keyset page is the one case where the index is not an optimization but part
of the contract: without `(filter…, created_at DESC, id DESC)` the page is a full scan on every
scroll, and the caller cannot tell. [paginated-list-query](./paginated-list-query.md) Gap 2 already
asks for a `db::keyset::page(…)` helper. **When it lands, it must take the index as part of its plan,
not beside it** — a `KeysetPlan { table, filter_cols, order_col, index: &'static str }` const that the
helper is constructed from, with one test that resolves every declared `KeysetPlan.index` against
`sqlite_master` on a fresh `init_test_db()`. That makes "a keyset page with no supporting index"
unrepresentable rather than counted, and it is exactly the shape `brainiac` reached independently for
its ANN indexes (`ensure_hnsw_index_for_dim` — registering a version and creating its index are *one
operation*, so a new embedding dimension cannot be sequentially scanned). That is the most valuable
thing the convergence sweep found, and it is worth copying.

A second, cheaper type-shaped fix closes the P0 permanently: **`has_index(conn, name)` should be
`has_index_on(conn, table, name)`.** One extra `AND tbl_name = ?2`. It makes a name collision fail its
own guard instead of passing it, and it costs one argument.

**Where a type cannot work, and why.** For the general condition — *this query has no index* — there
is no signature to change. The query is a `&str` (often built by `format!` at runtime, as the triage
page is), the index is DDL in another crate, and `rusqlite` addresses columns by string name.
Constraining that at the type level means adopting a compile-time-checked query macro, and the
convergence sweep found the one sibling that *has* that capability available uses it zero times out
of 332 queries. **This axis needs observation, not shape** — which is what §9 proposes.

Redundancy (the 38 + 8) and low cardinality (the 20) are likewise not type-preventable: both are
statements about a *set* of indexes, and no individual declaration is wrong on its own.

## 9 The missing gate

### The semantic conditions, stated first

Three, each stack-free:

> **(A)** An index is declared over a key whose distinct-value count cannot narrow a scan, so it
> costs a write on every row change and returns no read.
> **(B)** An index is declared whose every use is already served by another index, so it is written
> and never read.
> **(C)** A query filters or sorts on a key no index can serve, so its cost grows with the table.

Per the [portability test](../research/portability-test.md), what follows are **one repo's proxies**.
An adopting repo inherits the three sentences and re-derives its own signals against its own DDL
dialect and its own tooling.

### What is gated, and what is refused

**(A) is countable and is gated below.** **(B) and (C) are not countable by a census rule, and
refusing them is the honest outcome** — with the checker that *can* express each one specified
instead of a bad regex shipped.

### The one census rule — `boolean-column-index`

Keys on a non-partial, single-column `CREATE INDEX` whose only key is a boolean-shaped column.
Measured: **4 files / 20 matches**, and **two independent implementations agree** — the census regex
and the balanced-paren DDL parser (which reaches the same 20 by a completely different route: filter
all 583 parsed index records to `cols.length === 1 && !partial && name matches the vocabulary`). The
negative lookahead on `WHERE` is load-bearing and positive-controlled: the one partial index over the
same vocabulary in the tree, `idx_owned_devices_single_home ON owned_devices(is_home) WHERE is_home =
1` (`incremental.rs:4726`), is the **correct** construction and is correctly not reported.

```json
{"rules":[
  {
    "id": "boolean-column-index",
    "goldenPath": "docs/concepts/golden-paths/index-design.md",
    "title": "Single-column index on a boolean column, which cannot narrow a scan but is written on every row change",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "CREATE\\s+INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?[A-Za-z0-9_]+\\s+ON\\s+[A-Za-z0-9_]+\\s*\\(\\s*(?:is_[a-z_]+|enabled|active|starred|pinned|archived|dismissed|deleted|locked|hidden|approved|resolved|acknowledged)\\s*\\)\\s*(?!WHERE)",
      "flags": "gi",
      "ignoreCommentLines": true,
      "description": "a non-partial, single-column CREATE INDEX whose only key is a boolean-shaped column. PROXY FOR the stack-free condition \"an index is declared over a key whose distinct-value count cannot narrow a scan, so it costs a write on every row change and returns no read\". Measured against the live 347MB personas.db with planner statistics present (PRAGMA analysis_limit=1000 on every connection plus PRAGMA optimize in the idle maintenance loop, db/src/lib.rs:207,:237, and sqlite_stat1+sqlite_stat4 are both populated): the query each index exists to serve, WHERE enabled = 1, matches 76 of 78 personas rows (97%), 325 of 351 persona_triggers rows (93%), and 95 of 102 persona_event_subscriptions rows (93%) - the predicate is a synonym for \"all rows\", not a filter. EXPLAIN QUERY PLAN confirms SQLite still CHOOSES them (SEARCH personas USING INDEX idx_personas_enabled) because sqlite_stat1 stores only the AVERAGE rows-per-distinct-key (39 of 78, 176 of 351) and never sees the skew, so these are not dead indexes the planner ignores - they are live indexes that add a b-tree hop to a near-full scan and a write to every INSERT and UPDATE of the table. The negative lookahead on WHERE is load-bearing: a PARTIAL index (CREATE INDEX ... ON t(enabled) WHERE enabled = 1) over the same column is the CORRECT construction, indexing only the rows a query wants, and must not be reported - incremental.rs:4726 is the one instance in this tree and it is the positive control that proves the lookahead works. Convergence: brainiac has ZERO single-column boolean indexes and 12 partial indexes (21% of its total) where this repo has 20 and 17 (2.9%, and 14 of those 17 are UNIQUE constraints rather than read optimizations), so the sibling reached the correct construction independently and uses it seven times as often. PRECONDITION (must be re-derived per repo): this repo writes DDL as SQL string literals inside Rust and names boolean columns with an is_/enabled/active vocabulary. A repo whose booleans are typed BOOLEAN in an ORM schema DSL, or named differently, has the same condition wearing markup this pattern cannot see. LEGAL FIX, in order: (1) delete the index - the column is almost always read together with another predicate that already has one; (2) make it PARTIAL over the selective branch (WHERE enabled = 1) when the query only ever wants one value; (3) fold it into a COMPOSITE with the column actually filtered alongside it, leading with the selective column - incremental.rs:1466-1512 is the band that does this correctly and states each served query as a -- comment above its index."
    },
    "baseline": { "files": 4, "matches": 20 },
    "floor": 900
  }
]}
```

**Validated standalone before publishing** (`node scripts/census/run-census.mjs --rules
<scratch>/index-design-rules-candidate.json --check`):

```
  rule                    files   base  matches   base  walked  floor
  OK   boolean-column-index        4      4       20     20     963    900

  census OK — 1 rule(s), 963 file-visits, 20 surviving violation(s) across 4 file(s).
```

`963 walked` is exactly `rust.files` in [`shared-facts.json`](../shared-facts.json) — two
independently derived counts agreeing, which is the only reason to trust either. `floor: 900` matches
the four other `src-tauri`-rooted rules deliberately: several rules over one root must not hold
several opinions about what "the Rust tree is intact" means.

**Fault injection against the real tree**, because a gate that cannot fail is not a gate. Each row is
a single-field mutation of the validated rule, run with `--check`:

| Induced fault | Exit |
|---|---|
| baseline, unmutated | **0** |
| matcher matches nothing (`pattern` → `ZZZ_NEVER_MATCHES`) | **1** |
| floor above the walk (`floor: 5000` on a 963-file root) | **1** |
| silent drop (baseline claims 40 where 20 exist) | **1** |
| count rises (baseline claims 5 where 20 exist) | **1** |
| renamed root (`src-tauri` → `src-tauri-x`) | **1** |
| stale `exclude` entry (a path matching no file) | **1** |
| extension no longer describes the tree (`.rs` → `.zzz`) | **1** |

**No `exclude` entries.** The correct construction (a partial index) is excluded by the *pattern*, not
by a path, so there is no legitimate file-level exception and a stale exemption cannot accumulate.

**A note on the engine caveat.** The pattern's `\s+` runs cross newlines, so it is a multiline
pattern of the kind the 2026-08-14 comment-rewind fix was made for. Every match *starts* at `CREATE`,
which is never on a comment-only line, so `ignoreCommentLines` cannot rewind inside one — and the
independent DDL-parser count of 20 is the cross-check the caveat asks for.

### What this does NOT gate, and why — three refusals

1. **"This query lacks an index" is not expressible as a content match, and no regex should be
   shipped for it.** The condition is *relational*: it joins a parse of 583 DDL statements to a parse
   of 1,441 SQL literals in a different file set, then applies SQLite's composite-usability rule
   (a column is usable when every index column before it is an equality predicate **of that same
   query**). A census rule counts occurrences within one file and cannot express any of it. The naive
   single-file proxies were tried and rejected: keying on `ORDER BY` in a SQL literal matches 100
   sites of which the majority are correct, and the "is it a leading index column" heuristic —
   without the composite rule — reports **274** where the correct answer is **210**, a 30% false
   positive rate that would baseline mostly noise.

   **The checker that can express it is a Rust test that observes the plan.** On a fresh
   `init_test_db()`, for a committed list of named hot queries, run
   `EXPLAIN QUERY PLAN <sql>` and assert the output contains no bare `SCAN <table>` for any table in
   a committed growth list. This is behaviour, not shape — it survives `format!`-built SQL (which
   defeats every static approach, and which the reference keyset page uses), it survives the 18
   `format!`-built indexes no parser can see, and it fails loudly by construction because
   `init_test_db()` propagates. It must run under `cargo test --workspace` — `npm run test:rust`
   passes `--lib` against the root manifest, so a test in `personas-db` would be written, merged and
   never executed locally; `ci.yml:275` has the `--workspace` form, and locally use
   `cargo test -p personas-db`. **Mark honestly: no repo in this fleet has ever run `EXPLAIN` —
   Personas zero, `brainiac` zero, `personas-cloud` zero — so this is local calibration, not
   doctrine. It is the right instrument and it is unproven.**

2. **Redundancy (B) is a set property and needs SQL, not a regex — but it is the cheapest real gate
   available and it should be built.** "Index X is a strict left-prefix of index Y on the same table"
   cannot be seen from one file (the narrow index is in `fk_hygiene.rs` and the composite is in
   `schema.rs` for 8 of the 38), and it needs no query corpus at all. A `#[test]` on a fresh
   `init_test_db()` reading `pragma_index_list` / `pragma_index_info` for every table and asserting
   no index's column list is a proper prefix of another's finds **all 38 today**, plus the 8
   constraint-shadowing ones with one extra comparison against `pragma_table_info`'s PK and the
   `origin='u'` auto-indexes. It is ~20 lines, deterministic, and has no false positives by
   construction because the property is exact. Its failure list *is* the fix backlog in §7. **This is
   the highest-value single item in this document after the P0.**

3. **The index-name collision (the P0) is best fixed by a type, not gated.** `has_index_on(conn,
   table, name)` makes the guard reject a foreign-table match; a companion assertion that every
   `sqlite_master` index name is unique across the fresh schema — which it trivially is, since names
   are the primary key of that namespace — is not the check that matters. What matters is that
   `CREATE INDEX IF NOT EXISTS` silently *accepted* the collision, and the only artefact that can see
   that is the post-chain database. Fold it into refusal 2's test: for every declared index name in
   the source, assert `sqlite_master`'s `tbl_name` matches the table the source names. That is a
   two-source parity check modelled on `scripts/check-event-registry.mjs`, and it would have caught
   the P0 the day it shipped.

**How the census rule fails loudly when its own precondition is absent** is inherited from the runner
and demonstrated in the fault table: a zero-match run fails structurally rather than reporting a clean
tree; a walk below `floor` fails with *"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; a drop
without a baseline update fails; and the surviving count prints on success, so a green build log
distinguishes a clean run from one that checked nothing.

**On severity:** the census is a ratchet, not a severity ladder — it fails a run when a count moves.
No argument is made here from warning volume, and none could be: `npm run check` runs `eslint src/`
with no `--max-warnings` and the pre-commit hook runs `--quiet`, so a warn-level rule enforces nothing
at either gate at any count. The census rule enforces; a lint rule would not.

## See also

- [Schema change](./schema-change.md) — where the DDL goes, and the `run_step` that carries it.
- [Paginated list query](./paginated-list-query.md) — bound the query before you index it; and see
  §7 P1 for a measured correction to its Gap 3.
- [Persisted model struct](./persisted-model-struct.md) — the `CHECK (col IN (…))` vocabulary that
  tells you a column is low-cardinality before you index it.
- [Row to struct mapping](./row-to-struct-mapping.md) — what happens to the rows once an index has
  found them.
