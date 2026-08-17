# Golden path — Derived index sync

> **Topic path:** `data-persistence` › `query-performance` › `derived-index-sync`
> [situation spine](../situation-spine.md) · recurrence **5** · risk **HIGH** ·
> sides: **server** (upheld — see [§12.1](#121--sidesserver-upheld-and-the-mechanism-is-worth-naming)) ·
> convergence: **diverged** (tested — see [§10](#10-convergence)) ·
> dimensions: **function · performance · resilience · cost · ui**
> Composed 2026-08-17 against `master` @ `2a874e692`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri/` walked **four** times — twice by
> the census engine (rule + positive control) and twice by two independently-written
> scanners, one of which brace-matches `CREATE TRIGGER … END` spans so that a write *inside*
> a trigger body is structurally distinguishable from a hand-written one. Every table in
> both live databases was enumerated and counted (**244** in `personas.db`, **71** in
> `personas_data.db`), and every one of the **24** `*execution_id` columns in the schema was
> found by walking `pragma_table_info` over all 244 tables rather than by grepping for a
> name. All **11** production `INSERT INTO companion_node` statements and all **12**
> production `companion_fts` writes were classified by hand. `db/src/lib.rs:300-500`,
> `db/src/repos/core/memories.rs:1500-2050` + `:3100-3320`, `db/src/memory_recall.rs:300-430`,
> `db/src/repos/communication/sla.rs:600-760`, `db/src/repos/execution/tool_usage.rs`,
> `db/src/repos/execution/traces.rs`, `db/src/migrations/fk_hygiene.rs:1-350`,
> `src/companion/brain/doctrine.rs:460-615`, `src/companion/brain/keyword.rs:80-160` and
> `scripts/test/clean-env.cjs` read in full.
>
> **Measured by execution, not by reading.** Read-only **copies** of the operator's live
> `personas.db` (347,054,080 B) and `personas_data.db` (17,502,208 B) were taken
> 2026-08-17 14:53 with the app running; the live files were never opened for write, nothing
> was ever rebuilt or reindexed, and **the copies were deleted at the end of composition**.
> The June 3 `personas-cleanbak-*.db` was also copied and attached, which is what turned the
> orphan finding from a correlation into a causal chain (§0(b)). Every divergence number in
> §0's table is a `COUNT(*)` over both sides taken today, not an inference. `sla_daily`'s
> writer was **replayed verbatim at four candidate day-offsets**; the `vec0` vector counts
> were obtained twice, once from `_rowids` and once by popcounting the chunk **validity
> bitmap**; and `dev_context_file_hashes` was checked against the real filesystem by
> re-hashing **8,273** files.
>
> **`cargo` was not run** and no migration, repair, `REINDEX` or `rebuild` was executed
> against anything. Every Rust claim is static or replayed in SQL.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — lineage checked per leaf (§10).
>
> **Settles:** who maintains a structure that must agree with another one, how a failed
> refresh is made *visible*, what a reader is allowed to conclude from the index, and what
> asks — ever — whether the two still agree.

---

## 0. The headline

**Twenty-one derived structures. One of them is checked. That one is at zero divergence; of
the twenty that are not, eight are measurably diverged, one has no writer at all, and the
largest is 99.97% padding — and the one check exists only because someone noticed its
predecessor was comparing a number against itself.**

`db/src/lib.rs:409`, `executions_fts_drift`, is the repo's entire reconciliation surface:
one function, run once per boot, over one index. Its doc comment records that its
predecessor read the index size with `SELECT COUNT(*) FROM executions_fts` — which on an
**external-content** FTS5 table is answered from the *content* table, so the guard compared
the execution count against the execution count, could never differ, and the repair below it
**had never run on any launch since it was written**.

**The un-fixed twin is 209 lines away in the same file.** `lib.rs:646-649` guards the
`kb_chunks_fts` backfill with

```rust
let fts_count: i64 = conn.query_row("SELECT COUNT(*) FROM kb_chunks_fts", …).unwrap_or(0);
if chunk_count > 0 && fts_count < chunk_count {
```

`kb_chunks_fts` is also `content='kb_chunks'`, so `fts_count` **is** `chunk_count` and the
condition is `chunk_count < chunk_count` — **false at every size, forever.** It carries the
fixed defect *and* the `<`-instead-of-`!=` one its neighbour's comment specifically warns
about. Its own comment claims it "only rebuilds when the FTS row count is short of
`kb_chunks`", which is a behaviour that cannot occur. It is harmless today only because both
tables are empty. **The fix was applied to the instance that failed and not to the class** —
which is [doctrine §2](../golden-path-doctrine.md)'s *"fixing every instance of a defect is
not the same as covering every place that needs the behaviour"*, committed by the fix itself.

Everything else in the table below is maintained by hand and audited by nothing.

### The register

Source and index counted on the same copy, the same afternoon. "Divergence" is what a
`COUNT(*)` on each side says today, not what the code intends.

| # | derived structure | source | source rows | index rows | **divergence today** | maintained by | reconciler |
|---|---|---|---|---|---|---|---|
| 1 | `executions_fts` (fts5, external content) | `persona_executions` | 2,188 | **2,188** (`_docsize`) | **0** — id-exact, 0 orphan, 0 missing | **3 DB triggers** | `executions_fts_drift` (`lib.rs:409`) |
| 2 | `kb_chunks_fts` (fts5, external content) | `kb_chunks` | 0 | 0 | 0 (both empty — untested in anger) | **3 DB triggers** | backfill `lib.rs:645` — **guard can never fire**, D13 |
| 3 | `companion_fts` (fts5, own content) | `companion_node` | 1,554 | 1,550 | **4 nodes unsearchable** — 3 `backlog`, 1 `cockpit` | 12 hand-written statements | — none — |
| 4 | `companion_embedding` (vec0) | `companion_node` | 1,554 | **373** | 0 vs `embedding_model IS NOT NULL`; **1,181 nodes (76.0%) carry no vector** | app code + `content_hash` | `has_vec_entry` self-heal, doctrine kind only |
| 5 | `persona_memory_embedding` (vec0) | `persona_memories` | 6,535 | **5,158** | 0 vs `tier != 'archive'`; **1,377 archived rows have no vector** | 5 embed-on-write sites + boot loop | membership-only backfill |
| 6 | `persona_memory_embedding_meta` | ditto | 5,158 | 5,158 | **0**, id-exact both directions | same | model guard only |
| 7 | `sla_daily` (materialized rollup) | `persona_executions` | 2,168 terminal | 500 rows / 2,865 counted | **0 on all 403 recomputable buckets**; 697 executions survive *only* here | recompute-from-source upsert | **reader reconciles two sources** |
| 8 | `execution_knowledge` (EMA + counters) | `persona_executions` | 2,188 | 2,343 | **583 (24.9%) name a deleted execution**; counters not recomputable | `count = count + ?` | — none — |
| 9 | `persona_tool_usage` | `persona_executions` | 2,188 | 5,720 | **980 (17.1%) orphan** — under a declared `ON DELETE CASCADE` | insert-on-write | — none — |
| 10 | `execution_traces` | `persona_executions` | 2,188 | 2,942 | **880 (29.9%) orphan** — no FK declared | insert-on-write | — none — |
| 11 | `assertion_results` | `persona_executions` | 2,188 | 106 | **50 (47.2%) orphan** — under a declared `ON DELETE CASCADE` | insert-on-write | — none — |
| 12 | `persona_memories.source_execution_id` | `persona_executions` | 2,188 | 6,535 (all non-null) | **2,340 (35.8%) dangling** | write-time stamp | — none — |
| 13 | `provider_audit_log.execution_id` | `persona_executions` | 2,188 | 4,001 | **1,939 (48.5%) dangling** | write-time stamp | — none — |
| 14 | `persona_healing_issues.execution_id` | `persona_executions` | 2,188 | 205 | **76 (37.1%) dangling** | write-time stamp | — none — |
| 15 | `audit_incidents.execution_id` | `persona_executions` | 2,188 | 164 | **32 (19.5%) dangling** | write-time stamp | — none — |
| 16 | `obsidian_sync_state` (mirror ledger) | `execution_knowledge` | 2,343 | 2,981 | **656 (22.0%) orphan**; 18 entities never mirrored | mirror write | — none — |
| 17 | `dev_context_file_hashes` | the filesystem | 8,273 files | 8,273 | **1,204 changed + 43 gone = 15.1%** | scan | — none — |
| 18 | `doc_status` (staleness index) | git + `docs/` | 1,901 | 1,901 | **1,400 (73.6%) flagged dirty**, and the index itself is **24 days old** | scan | — none — |
| 19 | `workspace_practice_context_state` | 1,164 practices × 218 contexts | — | **253,752** | 0 orphans; **253,669 (99.97%) hold the default**; 142 practices unmaterialized | one-shot materialization | — none — |
| 20 | `shared_event_catalog.subscriber_count` | `shared_event_subscriptions` | 3 | 125 rows, all `0` | **3 of 3 subscriptions uncounted** | never incremented locally | — none — |
| 21 | `persona_metrics_snapshots` (rollup) | `persona_executions` | 2,188 | **0** | n/a — **no production writer exists in 963 `.rs` files** | nothing | n/a |

**Dangling references to `persona_executions` across rows 8–15: 6,880.** `PRAGMA
foreign_key_check` over the whole 244-table database reports **1,030** of them, across
exactly **2** edges. The other **5,850 are invisible to it**, because their column never
declared a `REFERENCES` clause.

### The three results that make the leaf

**(a) The only index at zero divergence is the only one the store maintains — and the
comparison is a controlled experiment inside one codebase.** Three FTS5 indexes, one
technology, two maintenance models:

| | `executions_fts` + `kb_chunks_fts` | `companion_fts` |
|---|---|---|
| write statements | **12, all inside `CREATE TRIGGER` bodies** | **12, all hand-written in Rust** |
| files holding them | 3 (`lib.rs`, `schema.rs`, `incremental.rs`) | 7 (`companion/brain/*`) |
| producers that must remember | **0** | **11** `INSERT INTO companion_node` sites |
| producers that did remember | n/a | **6 of 11** |
| divergence today | **0 of 2,188** | **4 of 1,554** |

The 24 raw FTS writes in the tree partition **exactly in half**, and the half that is
hand-written is the half that has drifted. The five producers that never index their node
are `backlog.rs:100`, `cockpit.rs:52`, `dashboard.rs:36`, `reflection.rs:76` and
`rituals.rs:127`. Two of those five have produced rows — `backlog` (3) and `cockpit` (1) —
and **those four rows are 100% of the measured divergence**. The other three are latent:
they will diverge the first time they write. This is not a metaphor for the census rule in
§9; it *is* the census rule, and the baseline and the divergence are the two halves of one
count.

The cost is not abstract. `companion/brain/keyword.rs:92-95` is the **only** keyword
retrieval lane over Athena's brain, and it reads the index, not the source:

```sql
SELECT companion_fts.node_id
  FROM companion_fts
  JOIN companion_node ON companion_node.id = companion_fts.node_id
 WHERE companion_fts MATCH ?1
```

A node missing from the index is not merely unranked — it is **unreachable**. The operator's
three backlog items and her cockpit node cannot be retrieved by keyword at all, and nothing
anywhere reports that.

**(b) A foreign key is not the fix, and the live database proves why in one comparison.**
The June 3 backup and the live file were attached side by side. The same operation that
deleted every execution before `2026-06-03T12:00`:

- left `executions_fts_docsize` **exactly equal** to `persona_executions` (138 = 138 in the
  backup; 2,188 = 2,188 today), because an `AFTER DELETE` trigger is *mechanism*;
- left **980** `persona_tool_usage` rows and **50** `assertion_results` rows orphaned,
  because `ON DELETE CASCADE` is *policy that a `PRAGMA` can switch off* — and
  `scripts/test/clean-env.cjs:73` switches it off by design (`db.pragma('foreign_keys =
  OFF')`) so that its hand-written table list can be deleted in any order.

**672 of the 980 were already orphans inside the June 3 backup**, so the population is
cumulative across at least two wipes. The script's own comment block (`clean-env.cjs:53-62`,
added 2026-08-14) diagnoses this precisely and names the same 1,030 figure this composition
measured independently. **The writer was fixed; the data was not.** All 1,030 rows are still
there today, and the two tables added to the `CLEAR` list closed 2 of the 8 leaking columns:
the inventory in §7 D1 shows **14 of 24** `*execution_id`-bearing tables still absent from
that hand-maintained list.

Nothing repairs it, because the repo's one orphan sweep is keyed on the wrong parent.
`cleanup_orphan_rows` (`db/src/lib.rs:447`) runs on every boot over 12 tables and issues
`DELETE FROM {table} WHERE persona_id NOT IN (SELECT id FROM personas)`. Measured:
`persona_tool_usage` has **0** orphaned `persona_id` and **980** orphaned `execution_id`. The
sweep is structurally blind to every row in the table below.

**(c) The reader decides how much a stale index can hurt you, and this repo contains all
three answers.** The same 347 MB database is read three ways:

| posture | site | what an ORPHAN index entry does | what a MISSING index entry does |
|---|---|---|---|
| **index is advisory; the source query is authoritative** | `memory_recall.rs:347-397` — SQL picks the candidates, KNN only supplies a *rank* | **nothing** — "hit ids not in the candidate set have no row to lift" | costs rank only; the memory is still eligible, and a total index failure degrades to `pack_by_budget`, byte-identical |
| **index is the result set** | `keyword.rs:92-95` — `FROM companion_fts JOIN companion_node` | dropped silently by the inner join | **the row is unreachable** |
| **index is read alone** | `tool_usage.rs:118-126` — `SELECT tool_name, SUM(invocation_count), COUNT(DISTINCT execution_id) FROM persona_tool_usage GROUP BY tool_name`, no join at all | **counted as real** | n/a |

The third posture is measurable in the UI, so it was measured. Replayed verbatim, the Tools
dashboard today reports **35 tools and 37,921 invocations**. Excluding rows whose execution
no longer exists: **27 tools and 33,464 invocations**. So **8 tools (22.9%) are displayed
that no surviving execution ever called**, every count is inflated by **+13.3%**, and the
daily series spans **25 days of which only 17** have a surviving execution — **8 phantom
days, 32% of the chart**.

**(d) The one structure whose staleness could be measured at all is 15.1% stale — and the
reason it could be measured is the reason it could be repaired.** `dev_context_file_hashes`
stores a `sha256` beside each file. Re-hashing all 8,273 files for this repo:
**7,026 unchanged, 1,204 changed, 43 gone.** Every other structure in the register stores
membership and nothing else, so the same question — *does this entry still describe its
source?* — is not merely unanswered but **unanswerable**, in principle, from the data.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) this head carries no file path,
primitive name or count, so a sibling project on another stack can adopt it. Each clause
names its warrant.

> **P1 — physics, and the leaf's centre.** **Whoever performs the write must not be the one
> who remembers to update the index.** Put maintenance where the write happens — in the
> store, beside the data — so that a new writer inherits it instead of having to know about
> it. Every call site you ask to remember is a coin flip you will lose eventually, and you
> will lose it silently.
> *Warrant: a controlled experiment inside one codebase — one index technology, 24 write
> statements, partitioned exactly in half between store-maintained and hand-maintained, with
> 100% of the measured divergence in the hand-maintained half and 5 of 11 producers having
> already forgotten.*
>
> **P2 — physics.** **A declared constraint is not a mechanism; it is a policy, and policy
> has an off switch.** Referential rules that the engine enforces *only when a runtime flag
> is set* will be off exactly when someone is doing something bulk, unusual and destructive
> — which is when the damage is largest.
> *Warrant: executed — one delete pass left a trigger-maintained index exact and 1,030
> constraint-protected child rows orphaned, because the pass disabled enforcement so its
> hand-written delete order would work.*
>
> **P3 — physics.** **Invalidate before you produce, so a failure becomes an absence.**
> Delete or mark the stale entry *first*, then compute the new one. A reconciler that tests
> membership can see a missing entry and can never see a wrong one, so the ordering decides
> whether your recovery path is capable of recovering.
> *Warrant: two implementations of the same operation in one repo, one directory apart. The
> one that deletes first has a self-heal that works; the one that computes first leaves the
> superseded value in place on failure, and its own documented recovery — a backfill keyed on
> "has no entry" — cannot see it.*
>
> **P4 — physics.** **Store a fingerprint of the source beside the derived value, or you
> have built something whose correctness is undecidable.** Membership answers "was this ever
> derived"; only a hash, a version, or a copy of the source's modification stamp answers "is
> this still true".
> *Warrant: measured across twenty derived structures in one database — exactly one carries a
> content hash, it is the only one whose staleness could be quantified (15.1%), and it is the
> only one a repair pass could target.*
>
> **P5 — resilience, and the cheapest clause here.** **Count both sides at startup and say
> when they disagree.** Two `COUNT(*)`s and a `!=` is the whole instrument. Compare the
> index's *own* size — not a number the index computes from the source — and prefer `!=` to
> `<`, because an index holding entries for rows that no longer exist returns phantom results,
> which is the same defect wearing the other sign.
> *Warrant: this exists once in the repo, and its previous version compared the source count
> against itself, so the repair beneath it had never run since it was written. One index has
> the check and zero divergence; nineteen do not and eight are measurably diverged.*
>
> **P6 — function.** **Let the source decide what is eligible and the index decide only what
> ranks.** When the index is the result set, a missing entry is an invisible row; when the
> index is advisory over an authoritative query, a missing entry costs rank and an orphan
> entry costs nothing.
> *Warrant: three readers of one database, measured — one whose orphans are provably inert
> and which degrades to its pre-index behaviour on total failure, one where four rows are
> unreachable, and one that publishes phantoms as facts (+13.3% on every figure, 22.9% of the
> listed entities not real).*
>
> **P7 — cost.** **A materialized default is not a fact.** If a derived row's value is the
> one a reader would have assumed from its absence, do not write it. A cross-product
> materialization of two growing sets costs the product of their sizes to store and the
> product to refresh, forever, for the sake of the cells that differ.
> *Warrant: the largest table in the database is 253,752 rows of which 83 (0.03%) carry
> information; the other 253,669 restate the default. It has no list surface and nothing
> checks it.*
>
> **Scale condition.** P1, P2, P3 and P6 are correctness on day one at any size. P4 and P5
> are invisible until the first failed refresh and permanent afterwards. P7 is free below a
> few hundred rows and grows with the product of two dimensions.

---

## 1. Trigger

You are in this situation when you say, or are about to type, any of these:

- *"Add a search index over this table."*
- *"Also embed it so semantic recall can find it."*
- *"Cache the count on the parent so the list doesn't have to aggregate."*
- *"Roll the daily totals up into a table so the chart is fast."*
- *"Don't forget to update the FTS table when you insert."*
- *"We'll write a backfill to catch up whatever the index missed."*
- *"It's fine, the foreign key will clean the children up."*

**If you are about to write** a second store of the same information — a row, a vector, a
counter, a bucket — that a *different* statement is responsible for keeping in step with the
first, you are here. Likewise if you are about to add a `_count` / `_total` column to a
parent, hand-write an `INSERT INTO …_fts`, or add a table name to a list of things some
cleanup routine must remember to delete.

**The distinguishing question against [`backfill-migration`](./backfill-migration.md):** *is
your question whether a one-time pass over the existing population finished, or whether the
two copies agree from now on?* The first is that path — it owns the pass, its bound, its
resume point and its receipt. This path owns the steady state: who maintains the agreement
after the backfill is done, what makes a lapse visible, and what a reader may conclude.
Concretely: `backfill_memory_embeddings` converging at 5,158/5,158 is *that* path's result;
the fact that its candidate test is `already.contains(&id)` and therefore cannot see a
**stale** vector is this one's.

**And against [`foreign-key-policy`](./foreign-key-policy.md):** that path asks what a child
row's declared fate is when its parent dies. This one asks what happens when the declaration
does not run, and what — if anything — ever notices. Its §9 named exactly this as its
condition **(C)** — *"the store contains rows whose declared parent does not exist, and
nothing ever asks"* — and correctly refused to gate it, because the census cannot express
"must be zero". §0(b) and §7 D1 are that condition, measured for the first time.

---

## 2. The one way

**Make the store maintain it; if the store cannot, invalidate before you produce, store a
fingerprint of the source beside the derived value, and count both sides at boot — and make
the reader treat the index as advice over an authoritative source query, never as the result
set.** Concretely: **(a)** if the derived structure is expressible as a trigger — an FTS
mirror, a denormalized column, a child tombstone — **declare it as a trigger** and stop; a
trigger costs one schema statement and removes the entire class, because no future writer
can fail to know about it. **(b)** When the derivation is not expressible in SQL (an
embedding, an external mirror), accept N call sites but **make the failure mode absence, not
staleness**: delete the old entry in a committed statement *before* you compute the new one,
so an embedder panic, a poisoned model or a dead network leaves a hole your recovery pass can
find (`doctrine.rs:511-538` is the reference and it is 27 lines). **(c)** Store a
**fingerprint** — a content hash is best, a copy of the source's `updated_at` is acceptable —
in the derived row, and make the refresh decision `hash != stored_hash`, never `row exists`;
`companion_node.content_hash` and `dev_context_file_hashes.sha256` are the two shapes to copy.
**(d)** Give the refresh a **three-state outcome** (`Inserted | Updated | Unchanged`), never a
bare integer, because "0 written" is returned by *converged*, *not applicable* and *the
producer is dead* alike — `UpsertOutcome` (`doctrine.rs:470-474`) is the enum. **(e)** Add a
**boot reconciler**: read the index's own size — its shadow/metadata table, not a `COUNT(*)`
that the query planner may answer from the source — compare it to the source count with `!=`,
and repair or alarm; `executions_fts_drift` (`lib.rs:409`) is 20 lines and is the only one in
the tree. **(f)** For a **rollup**, recompute the bucket from the source rather than
incrementing it — `INSERT … SELECT … GROUP BY … ON CONFLICT DO UPDATE SET total =
excluded.total` (`sla.rs:637-662`) is idempotent by construction, survives a missed tick, a
double tick and a restore, and it is why row 7 of the register is the only rollup at zero
divergence. **(g)** Make the **reader** join the source and let the source win:
`memory_recall.rs:347-397` uses SQL to decide *what is eligible* and the vector index only to
decide *which eligible entries rank*, so an orphan vector is provably inert and an index
outage degrades to the pre-index behaviour rather than to an empty screen. **(h)** Never
maintain a list of "children to clean up" by hand in application code — that list is a
private, unverifiable copy of the schema, and the schema is queryable
(`pragma_foreign_key_list`, or an explicit registry the writer and the sweeper share).
**(i)** And do not materialize a cell whose value equals the default a reader would assume
from its absence.

If you must get one right first: **(a)**. Every other clause is a way of surviving the
decision to hand-maintain, and (a) is the decision not to.

---

## 3. Mandated primitives

Real names, all read during composition.

| primitive | `file:line` | what it gives you |
|---|---|---|
| `executions_fts_drift` | `db/src/lib.rs:409` | the reconciler shape: source `COUNT(*)` vs the index's **`%_docsize` shadow table**, `!=` not `<`, `None` when the index size is unreadable so a bad read does not trigger a rebuild loop |
| `ensure_executions_fts` | `db/src/lib.rs:430` | the repair: `INSERT INTO <fts>(<fts>) VALUES('rebuild')`, called once per boot from `init_db` (`:338`) |
| the three `executions_fts_a[iud]` triggers | `db/src/migrations/schema.rs:141-153` | store-maintained FTS: `AFTER INSERT`, `AFTER DELETE`, and `AFTER UPDATE **OF** input_data, output_data, error_message` — the `OF` clause is what keeps an unrelated column write from re-indexing the row |
| `UpsertOutcome` | `src/companion/brain/doctrine.rs:470` | `Inserted \| Updated \| Unchanged` — the three-state refresh receipt |
| `upsert_chunk` | `src/companion/brain/doctrine.rs:476-575` | the hand-maintained reference: hash compare → short-circuit; **delete the vector, then embed**; `has_vec_entry` self-heal on the unchanged path |
| `has_vec_entry` | `src/companion/brain/doctrine.rs:578` | the membership probe used *in addition to* the hash, which is what makes (b)+(c) compose |
| `prune_orphans` | `src/companion/brain/doctrine.rs:589-615` | tears down node + FTS row + vector together for a source that has gone |
| `upsert_sla_daily_conn` | `db/src/repos/communication/sla.rs:631-666` | the rollup shape: recompute the whole bucket from the source, `ON CONFLICT … SET total = excluded.total` |
| `load_daily_trend` | `db/src/repos/communication/sla.rs:692-760` | the divergence-tolerant reader: merges the durable rollup and a fresh recompute, **keeping the higher-`total` source per day**, so neither a stale rollup nor a pruned source can win by being wrong |
| `pack_by_budget_task_aware` | `db/src/memory_recall.rs:347-397` | the advisory-index reader: SQL decides eligibility, KNN decides rank, failure degrades to `pack_by_budget` byte-identically |
| `embed_and_store_memory` | `db/src/repos/core/memories.rs:1707` | delete-then-insert on **both** the vector and its `_meta` row, so a re-embed cannot leave two rows for one id |
| `persona_memory_embedding_meta` | `personas_data.db` | the currency marker that exists: `(memory_id, embedding_model, embedding_dims)` lets recall exclude vectors from a since-swapped embedder |
| `cleanup_orphan_rows` | `db/src/lib.rs:447` | the boot orphan sweep — **cite it as the shape, and see §7 D2 for the key it uses** |
| `dev_context_file_hashes` | schema, `personas.db` | `(project_id, file_path) → sha256, size_bytes, last_extracted_at` — the fingerprint table shape |
| `assert_credential_blob_invariant` | `db/src/migrations/helpers.rs:271` | the boot-time invariant assertion this path's §9 extends |

**Do not reach for these:**

- `SELECT COUNT(*) FROM <fts_table>` as the index's size. On an external-content FTS5 table
  it is answered from the content table. Use `<fts_table>_docsize`.
- `COUNT(*)` on a `vec0` table's `_metadatatext00` shadow as the vector count. It **omits
  every row whose text metadata fits inline** (≤ 12 bytes). Measured: `companion_embedding`
  has 373 vectors and 349 `_metadatatext00` rows — the 24 missing are the episode ids, which
  are 11 characters. Use `_rowids`, or popcount the `_chunks.validity` bitmap. See §12.3.

---

## 4. Steps

1. **Name the source and the derived structure, and write down the key that joins them.**
   If you cannot write the join, you cannot write the reconciler, and you do not yet have a
   derived structure — you have a second source.
2. **Ask whether a trigger can do it.** An FTS mirror, a child tombstone, a denormalized
   column copied from a parent: yes. Anything requiring a model, a network call, or the
   filesystem: no. If yes — declare it, and **stop here**. Steps 3–7 exist only because the
   answer was no.
3. **Put a fingerprint column on the derived row** — `content_hash`, or the source's
   `updated_at`. Do this before the first write; adding it later means every existing row is
   permanently un-checkable.
4. **Write the refresh as: compare fingerprint → if equal, probe membership and self-heal →
   if different, delete the derived entry, commit, then produce.** The delete must land
   before the fallible step. Return `Inserted | Updated | Unchanged`.
5. **Write the reader so the source query decides the result set.** The index supplies rank,
   a score, or a filter *within* rows the source already returned. If the reader must read
   the index first, `LEFT JOIN` back and render the hole rather than dropping it.
6. **Write the boot reconciler**: index's own size vs source count, `!=`, log both numbers,
   repair or alarm. Twenty lines. Register it beside `executions_fts_drift`.
7. **Delete the source-side cleanup list you were about to hand-write.** Derive the child set
   from the schema, or put the sweep behind the same registry the reconciler uses.
8. **And then stop.** Do not write a backfill "to catch up whatever the index missed" as your
   maintenance strategy — that belongs to [`backfill-migration`](./backfill-migration.md) and
   it is a one-time pass, not a repair loop. A membership-keyed backfill cannot see a stale
   entry, so pairing it with a produce-then-invalidate refresh gives you a recovery path that
   is structurally incapable of recovering the failure it was written for.

---

## 5. Anti-patterns

- **`SELECT COUNT(*) FROM <fts>` as a drift check.** *Failure mode:* on an external-content
  table it reads the content, so the guard compares the source to itself, is always equal,
  and the repair under it never runs — for as long as it takes someone to open the shadow
  tables. This shipped here and is documented at `lib.rs:396-404`.
- **Produce, then invalidate.** *Failure mode:* the fallible step fails, the **old** derived
  value survives, and every recovery pass keyed on "does an entry exist" answers yes forever.
  The divergence is permanent and undetectable. (`memories.rs:1716-1730`.)
- **Membership as the currency test.** *Failure mode:* `if already.contains(&id) { continue }`
  is correct for "never derived" and blind to "derived from something else". It is the
  recovery path the write path's own comment nominates
  (`memories.rs:1614-1617`), and it cannot cover the failure that comment describes.
- **A hand-written list of children to clean up.** *Failure mode:* the list is a private copy
  of the schema, drifts from it silently, and the drift only surfaces as orphans months
  later. Measured: the list was short by two tables for roughly three months, cost 1,030
  orphan rows, and is still short by fourteen.
- **Relying on `ON DELETE CASCADE` for a bulk operation.** *Failure mode:* the enforcement
  flag is per-connection and the bulk pass is exactly the code that turns it off, because
  hand-ordering a multi-table delete is easier with it off. The constraint is present in the
  DDL, absent at runtime, and `PRAGMA foreign_key_check` — the one instrument that would
  notice — runs in this repo only inside the FK-hygiene rebuild of 9 specific tables
  (`fk_hygiene.rs:308-317`) and inside `#[cfg(test)]` (`incremental.rs:8590`).
- **Reading a derived table without joining its source.** *Failure mode:* phantoms are
  published as facts. Measured on one dashboard: 8 entities that do not exist, +13.3% on
  every number, 8 of 25 days entirely fictitious.
- **An incrementing counter as a derived aggregate.** *Failure mode:* a missed or duplicated
  write is unrecoverable, because there is no expression that recomputes the value; and when
  the source is subject to retention the counter outlives its own evidence.
  `execution_knowledge.success_count` (`knowledge.rs:100`) counts outcomes of executions of
  which **583 (24.9%) no longer exist**. Prefer the `sla_daily` form.
- **Materializing the default.** *Failure mode:* the table's size is the product of two
  dimensions and its information content is not. 253,752 rows; 83 of them say anything.
- **A staleness index with no staleness of its own.** *Failure mode:* the structure whose job
  is to report drift silently becomes the drifted thing. `doc_status` reports 1,400 dirty
  docs from a scan taken **24 days ago** and renders no scan date.

---

## 6. Evidence

**The one site to copy: `src/companion/brain/doctrine.rs:476-575` (`upsert_chunk`).** It is
the only refresh in the tree that gets all four hand-maintenance clauses right at once:

```rust
match existing {
    Some((id, prior_hash)) if prior_hash == chunk.content_hash => {
        // (c) fingerprint short-circuit — and (b') a membership self-heal on top,
        //     because a previous run may have updated the hash and then failed to embed.
        if !has_vec_entry(pool, &id).unwrap_or(true) { … embed_and_store(…) … }
        Ok(UpsertOutcome::Unchanged)          // (d) three-state receipt
    }
    Some((id, _)) => {
        { …UPDATE companion_node SET content_hash…; UPDATE companion_fts…;
          conn.execute("DELETE FROM companion_embedding WHERE node_id = ?1", …)?; }
        // (b) the delete is COMMITTED before the fallible producer runs, so a
        //     panicking embedder leaves an ABSENCE the branch above will heal.
        if let Err(e) = embeddings::embed_and_store(pool, embedder, &id, &chunk.content).await { … }
        Ok(UpsertOutcome::Updated)
    }
    None => { …insert node + fts…; embed best-effort…; Ok(UpsertOutcome::Inserted) }
}
```

Live proof that it holds: `companion_embedding` carries **373** vectors and
`companion_node` carries **373** rows with `embedding_model IS NOT NULL` — id-exact, verified
twice (from `_rowids`, and by popcounting the chunk validity bitmap). All 349 doctrine chunks
are embedded. It is the only vector index in either database whose refresh can survive a
producer failure without lying.

Other exemplary sites:

- **`db/src/lib.rs:409-440`** — the reconciler. Read the doc comment as well as the code:
  it names the defect it replaced, the reason `!=` beats `<`, and the test that pins it
  (`ensure_executions_fts_backfills_rows_the_index_never_saw`, `lib.rs:2347`). That test is
  worth copying too — it *removes the triggers*, inserts rows the index never saw, and
  asserts the reported count before and after, which is the only way to test a reconciler
  whose normal state is "nothing to do".
- **`db/src/migrations/schema.rs:141-153`** — the three triggers, including
  `AFTER UPDATE **OF** input_data, output_data, error_message`. Column-scoping the update
  trigger is why a status change or a token-count write does not churn the index.
- **`db/src/repos/communication/sla.rs:631-666`** — the rollup that recomputes. Its doc
  comment states the ordering constraint that makes the whole design work: the tick must call
  it **before** execution retention prunes, so the about-to-vanish day gets one last accurate
  bucket. Replayed at the machine's real day-offset: **403 of 403 buckets exact**.
- **`db/src/repos/communication/sla.rs:692-760`** — the reader that assumes both sources are
  partly wrong and picks the more complete one per day. 97 of its 500 rows are days whose raw
  executions are gone; **697 executions exist nowhere else**.
- **`db/src/memory_recall.rs:347-397`** — the advisory-index reader, including the sentence
  that is this leaf's P6 in the repo's own words: *"SQL scoping still decides WHAT is
  eligible; relevance only decides WHICH eligible entries win the budget."*
- **`db/src/repos/core/memories.rs:1227-1270`** (`update_tier`) — the asymmetry someone
  noticed and closed: archiving drops the vector, so un-archiving re-embeds, gated on the
  *prior* tier read before the update. Live: **0** live-tier memories lack a vector.
- **`src/commands/credentials/vector_kb.rs:1340-1362`** — the only place in the fleet (§10)
  where *would-desync* is a reason to **fail an operation**. If the vector store is
  unavailable, deleting a document's chunks would leave their vectors behind, so the
  transaction returns an error and rolls back rather than committing a half-delete. The
  comment states the consequence it is avoiding — *"`kb_search` would return orphaned vectors
  and silently shrink results"* — which is §0(c)'s third reader posture, refused at the
  write side. Copy this shape whenever a delete spans two stores.

---

## 7. Deviations

Fourteen, ordered by measured harm. Every one carries a live count.

**D1 — 6,880 dangling references to `persona_executions`, across 8 tables, and the schema
can only see 1,030 of them.** The inventory was built by walking `pragma_table_info` over all
244 tables, not by grepping:

| table.column | FK? | rows | dangling | in `clean-env.cjs` `CLEAR`? |
|---|---|---|---|---|
| `persona_memories.source_execution_id` | — | 6,535 | **2,340 (35.8%)** | no |
| `provider_audit_log.execution_id` | — | 4,001 | **1,939 (48.5%)** | no |
| `persona_tool_usage.execution_id` | CASCADE | 5,720 | **980 (17.1%)** | yes (since 2026-08-14) |
| `execution_traces.execution_id` | — | 2,942 | **880 (29.9%)** | yes |
| `execution_knowledge.last_execution_id` | — | 2,343 | **583 (24.9%)** | yes |
| `persona_healing_issues.execution_id` | — | 205 | **76 (37.1%)** | no |
| `assertion_results.execution_id` | CASCADE | 106 | **50 (47.2%)** | yes (since 2026-08-14) |
| `audit_incidents.execution_id` | — | 164 | **32 (19.5%)** | yes |
| 16 further `*execution_id` columns | 5 with FK | — | 0 | 10 of 16 absent from `CLEAR` |

**24 columns; 7 declare a FK; 14 of the 24 tables are absent from the hand-maintained
`CLEAR` list.** Not all dangling references are defects — `provider_audit_log` and
`change_journal` are audit records that should outlive their subject, and
[`foreign-key-policy`](./foreign-key-policy.md) §2's `SET NULL` arm is the right answer for
them. But no column in the table distinguishes the two cases, and **all eight are read
without a join** or with an inner join that hides them. *Fix:* declare `SET NULL` for the
ones meant to outlive, `CASCADE` for the ones not, and replace the hand list — see §9.
**Do not run a repair pass:** the app is in daily use, and this is the operator's own data.

**D2 — the boot orphan sweep is keyed on the one parent that has no orphans.**
`db/src/lib.rs:447-488` issues `DELETE FROM {t} WHERE persona_id NOT IN (SELECT id FROM
personas)` over 12 tables. Live: **0** rows in the entire database have a dangling
`persona_id`; **6,880** have a dangling `execution_id`, and `persona_tool_usage` — which has
a `persona_id` column, so the sweep *could* have visited it — is not in the list anyway. The
comment above it says it exists because "orphans accumulate in real installs". They did; it
cannot see them.

**D3 — `companion_fts` is written by 6 of the 11 files that create a `companion_node`.**
Missing: `backlog.rs:100` (kind `backlog`, **3 live rows, all unsearchable**),
`cockpit.rs:52` (kind `cockpit`, **1 live row, unsearchable**), `dashboard.rs:36`,
`reflection.rs:76`, `rituals.rs:127` (0 rows each so far — **latent**). `keyword.rs:92-95`
reads `FROM companion_fts JOIN companion_node`, so an unindexed node cannot be retrieved —
and this is worse than "one lane of two is blind": the module header (`keyword.rs:10-19`)
states that the vector lane is `ml`-gated and the shipped desktop build has no `ml` feature
(corroborated by `Cargo.toml:39,57,59` — `ml` is absent from `desktop` and present only in
`desktop-full`). **On that build `companion_fts` is the only query-dependent retrieval lane
there is**, so those four nodes are unreachable by any means. *Fix:* either one
`AFTER INSERT`/`AFTER UPDATE OF …`/`AFTER DELETE` trigger trio on `companion_node` — which
removes all 12 hand-written statements and all 5 omissions permanently — or brainiac's
unconditional-hook form (§10, `governance.rs:216-221`): route every node write through one
function so there is no caller left to forget. Deferred: it changes what Athena can retrieve
while the operator is using her.

**D4 — the Tools dashboard publishes phantoms.** `tool_usage.rs:118-126` and `:157-165`
aggregate `persona_tool_usage` with no join to `persona_executions`. Live: **35 tools
reported vs 27 real; 37,921 invocations vs 33,464 (+13.3%); 25 days on the chart vs 17 with
a surviving execution.** Eight tool names are visible in the product that no surviving
execution ever invoked. *Fix:* `WHERE EXISTS (SELECT 1 FROM persona_executions e WHERE e.id
= u.execution_id)` — but note this converts the defect into a silent undercount unless the
surface also discloses the excluded rows; see [`data-provenance-disclosure`](./data-provenance-disclosure.md).

**D5 — `embed_and_store_memory` produces before it invalidates, and its nominated recovery
cannot see the result.** `memories.rs:1716` awaits `embedder.embed_query(text)` and returns
early on error; the `DELETE FROM persona_memory_embedding` is at `:1724`, after it. So a
content edit whose re-embed fails leaves the **previous** vector in place. The write path's
own comment (`:1614-1617`) says failures are "left for `backfill_memory_embeddings`", and
that backfill's candidate test is `already.contains(&m.id)` (`:2029`) — membership. There
are **5** embed-on-write sites (`:360, :583, :781, :1219, :1265`) and all five inherit this.
*Fix:* move the two `DELETE`s above the `embed_query`, in their own committed statement — the
`doctrine.rs` order. This is a behaviour change under a running app; deferred to
[`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md).

**D6 — nothing can tell whether a memory vector still matches its memory.**
`persona_memory_embedding_meta` carries `(memory_id, embedding_model, embedding_dims)` — a
currency marker for the *embedder* (recall excludes vectors from a swapped model) and none
for the *content*. Live: **6,285 of 6,535 memories (96.2%) have `updated_at > created_at`.**
That figure conflates content edits with tier moves and access-count bumps, and it is the
best available precisely because no better one is derivable — which is the deviation.
*Fix:* add `source_hash TEXT` to the meta table and write it in `embed_and_store_memory`;
the backfill's candidate query then becomes recomputable.

**D7 — `execution_knowledge`'s counters cannot be recomputed and 24.9% of its deep links are
dead.** `knowledge.rs:96-101` does `ON CONFLICT … success_count = success_count + ?7,
failure_count = failure_count + ?8` with an EMA on the cost/duration columns. The EMA is a
deliberate, well-argued improvement over a cumulative mean (the comment at `:99-105` is
worth reading) — but it makes the row a **stateful accumulator with no closed form**, so
nothing can ever check it, and execution retention has since removed the evidence: **583 of
2,343 rows name a `last_execution_id` that does not exist** (565 of them `tool_sequence`).
*Fix:* none available for the historical rows; for new ones, keep the EMA but store the
sample count and the window's source key so a bucket can be re-derived.

**D8 — `obsidian_sync_state` holds 656 mirror records for entities that are gone.** 2,981
rows, all `entity_type = 'execution_knowledge'`, against 2,343 live entities: **656 (22.0%)
orphan, 18 entities never mirrored.** It carries `content_hash` and `synced_at` — the right
shape — and nothing prunes it, so the vault keeps notes for records the database has
forgotten. Last write `2026-06-26`.

**D9 — `doc_status` is a staleness index that is itself 24 days stale and does not say so.**
1,901 rows, **1,400 (73.6%) carrying a `dirty_since`**, every one `scanned_at` inside a
27-second window on `2026-07-24`. A reader cannot distinguish "1,400 docs are behind their
source" from "1,400 docs were behind their source three weeks ago". *Fix:* render
`scanned_at` beside the count — this is [`data-provenance-disclosure`](./data-provenance-disclosure.md)'s
territory and the fix belongs there.

**D10 — `workspace_practice_context_state` materializes 253,752 rows to record 83 facts.**
Exactly 1,164 practices × 218 contexts across 6 projects (the product is exact). By state:
176,380 `unverified`, 77,289 `na`, **74 `adopted`, 9 `violating`** — and precisely those 83
rows carry `evidence` and `verified_at`. It is the largest table in the database, it has **no
list surface**, nothing reads it for drift, and it is stale by construction: **142 of 1,306
practices have no row at all** and 2 contexts in covered projects were never materialized, so
the cross-product is neither complete nor self-repairing. Answering the brief's question
directly: **it is derived** — `na` is computed from applicability and `unverified` is a
placeholder — **and nothing checks it.** *Fix:* store only the 83 non-default rows and let
absence mean `unverified`; the `state` CHECK already enumerates the default.

**D11 — `shared_event_catalog.subscriber_count` is 0 on all 125 rows while 3 subscriptions
exist.** The column is cloud-cached (`cached_at` sits beside it) and no local write path
increments it, so a local subscribe leaves the catalog's own count contradicting the
subscription table in the same database. Low harm; included because it is the *other* failure
mode of a denormalized counter — not drift, but a counter nobody ever maintained.

**D12 — the drift-check defect that was found and fixed is still live 209 lines away, in the
same file, with an extra defect on top.** `db/src/lib.rs:646-649` reads `SELECT COUNT(*) FROM
kb_chunks_fts` — an external-content table, so it returns `kb_chunks`'s count — and compares
it with `fts_count < chunk_count`, i.e. `chunk_count < chunk_count`. **The guard is false at
every size**, the backfill under it can never run, and the `<` also means it could not see a
phantom entry even if the read were right, which is exactly what `executions_fts_drift`'s
comment (`lib.rs:406-408`) exists to warn about. Live impact today is zero — `kb_chunks` and
`kb_chunks_fts_docsize` are both 0 — so this is a **latent** defect that arms itself the first
time the operator ingests a document. *Fix (safe, non-behavioural at the current row counts,
but still a note per the campaign's standing rule):* `SELECT COUNT(*) FROM
kb_chunks_fts_docsize` and `!=`. Better: delete both hand-rolled guards and register the pair
in §9's registry.

**D13 — a rollup table with three indexes, an FK-hygiene rebuild, an orphan-sweep entry and
no writer.** `persona_metrics_snapshots` holds **0 rows**; the only `INSERT` in 963 `.rs`
files is a `#[cfg(test)]` fixture (`fk_hygiene.rs:823`). It is maintained by
`fk_hygiene.rs:442-473`, indexed at `incremental.rs:1512`, listed in `cleanup_orphan_rows`
(`lib.rs:458`) and carried by the cloud-sync lane. §10 dates it to vibeman
(`108_observability.ts`, 2026-02-16 — the day before this repo's first commit), where it is
**also** unwritten. *Fix:* drop it, or write it — but it is currently paying maintenance cost
in four subsystems for a structure that has never held a row.
[`sync-reconciliation-and-conflicts`](./sync-reconciliation-and-conflicts.md) already names
it at `:475` and `:722`; this is the same table seen from the derived-structure side.

**D14 — `PRAGMA foreign_key_check` exists in this repo and never runs over the whole
database.** Two sites: `fk_hygiene.rs:308-317`, which is production but scoped to the
transaction rebuilding **one** of nine specific tables and idempotently no-ops thereafter;
and `incremental.rs:8590`, which is inside `#[cfg(test)]` and asserts **zero violations after
a synthetic migration replay** on an empty database. That assertion passes today while the
operator's database holds 1,030. It is the doctrine's *"a gate that runs green while checking
nothing"* in its purest form: the instrument is correct, the fixture has no rows, and the
test's green tells you nothing about the only database that matters.

---

## 8. Gaps

Real limits, not laziness.

1. **SQLite has no materialized views.** Every rollup here is a table plus a writer, so
   "recompute the bucket" is a discipline rather than a guarantee. `sla_daily` is what the
   discipline looks like when someone holds it.
2. **A trigger cannot compute an embedding.** Clause (a) of §2 genuinely does not reach
   `persona_memory_embedding` or `companion_embedding` — which is exactly why clauses (b)–(e)
   exist. What a trigger *could* still do for them is write a **dirty flag**, converting
   "which rows need re-embedding" from an unanswerable question into a queryable one.
3. **`vec0` has no `updated_at` and its shadow tables are not a public interface.** The
   validity bitmap and `_rowids` are implementation details of sqlite-vec; a future version
   may change them. A fingerprint has to live in the app's own meta table (`_meta` already
   exists and has room).
4. **FTS5's `'rebuild'` is all-or-nothing.** There is no "reindex these 4 rows". A drift
   check that finds a 4-row discrepancy in a 250,000-row index must either rebuild everything
   or repair by hand. For `executions_fts` at 2,188 rows this is free; it is a real ceiling on
   applying the same reconciler to a large index.
5. **`PRAGMA foreign_key_check` cannot see a reference that was never declared.** It found
   1,030 of the 6,880 dangling references. The remaining 5,850 are only findable from an
   *inventory* of what should have been declared — the same shape as the orphan-bindings and
   unregistered-queue cases in the doctrine, and the reason §9 is an inventory check rather
   than a scan for a broken form.
6. **A boot-time check cannot repair what a running app is currently diverging.** All the
   reconcilers discussed here run once at startup. Nothing in the repo re-checks during a
   session, and the operator's sessions last days.
7. **`COUNT(*)` on an external-content FTS5 table is not a lie the type system can prevent.**
   It is valid SQL returning a correct answer to a different question. Nothing in Rust, ts-rs
   or the query builder can see inside the string. This is [doctrine §1 case 1](../golden-path-doctrine.md)
   — *inside a SQL string literal* — and it is why the reconciler needs a **test that removes
   the triggers**, which this repo has and which is the only reason the defect was ever found.

---

## 9. The missing gate

### The semantic conditions, stated first

Per the [contract](../golden-path-contract.md), §9 is a **manifestation**. What follows are
this repo's proxies; an adopting repo inherits the sentences and derives its own signals.

> **(A)** A structure that must agree with another one is kept in step by statements the
> author of the next write has to remember, rather than by the store.
>
> **(B)** No code anywhere compares the two sides and says whether they still agree.
>
> **(C)** A derived row carries no fingerprint of the source it was derived from, so
> "is this still true" is not a question the data can answer.

**(A) is countable and is gated below.** **(B) and (C) are refused**, and the instrument that
*can* express each is specified instead of a bad pattern shipped.

### Rules checked for overlap before proposing

`undeclared-parent-fate` (foreign-key-policy — requires `REFERENCES` to be **present**; my
condition is its absence, so **zero site overlap by construction**, verified: its 3 matches
are all `REFERENCES` clauses and none of mine contains that word),
`unfinishable-backfill-receipt` (backfill-migration — keys on a `fn` name containing
backfill/reembed/reindex; none of my 12 sites is inside such a function),
`handwritten-rebuild-shape`, `default-contradicted-by-backfill`,
`constraintless-table-declaration`, `discarded-sync-watermark-write`,
`unverifiable-conflict-clause`, `absent-entity-count-as-zero`, `unmeasurable-metric-tile`.
None matches an FTS write statement.

### The one census rule — `hand-synced-search-index`

**Signal:** an application statement that writes a full-text index table, where the write is
neither the FTS5 maintenance-command form nor inside a `CREATE TRIGGER` body.

Two negative lookaheads carry the whole precision:

- `(?!\s*\(\s*\1\b)` — a backreference to the captured table name. `INSERT INTO
  executions_fts(executions_fts) VALUES('rebuild')` is the FTS5 *command* form, i.e. the
  reconciler, and it is the compliant answer to (B). Without this, `lib.rs:437` — the one
  reconciler in the repo — is reported as the defect. It removes exactly 3 matches:
  `lib.rs:437`, `lib.rs:655`, `incremental.rs:154`.
- `(?![\s\S]{0,300}?\b(?:new|old)\.)` — the `new.`/`old.` row aliases exist **only** inside a
  trigger body, so this is a structural test for "the store is doing this" expressed as one
  forward scan. No lookbehind, no nested quantifier.

**Measured: 12 matches across 7 files, all in `src/companion/brain/`, all writing
`companion_fts` — the one index in the database with measured divergence. Precision 12/12,
every site opened.** Runtime ~2.7 s over 963 files.

**Positive control — `hand-synced-search-index-positive-control`.** Same anchors, same
extensions, same roots, the lookahead **inverted** so it selects the compliant half of the
identical raw match set: an FTS write whose values come from a trigger's row aliases.
**Measured: 12 matches across 3 files** — `db/src/lib.rs:738,741,744,745` (`kb_chunks_fts`),
`migrations/incremental.rs:298,302,306,308` and `migrations/schema.rs:142,146,150,152`
(`executions_fts`). The 24 FTS writes in the tree partition **12 / 12 into disjoint file
sets**, and the partition predicts the divergence exactly: the trigger-maintained side is at
0 of 2,188, the hand-maintained side at 4 of 1,554.

**Allowlist.** One exclude: `src-tauri/src/companion/brain/keyword.rs`, whose two
`companion_fts` writes are `#[cfg(test)]` fixtures building the retrieval lane's own
two-table schema. The census engine has no `#[cfg(test)]` exclusion and a fixture cannot
diverge in production.

**How it fails loudly.** The runner's own contract: zero matches anywhere is fatal
(`zero-matches`), a walk under `floor: 900` is fatal (963 `.rs` files exist under
`src-tauri`), a stale `exclude` is fatal, a rise is fatal, and a **silent drop** is fatal —
which matters here because the intended fix is to *delete* all 12 sites at once in favour of
a trigger. That drop must land with `npm run census -- --update` and a commit message saying
which trigger replaced them.

**End of life.** This rule is designed to reach zero. When `companion_fts` becomes
trigger-maintained the count goes to 0 and the runner fails structurally on `zero-matches`,
**by design — delete the rule then, do not baseline it at 0.**

```json
{"rules":[
  {
    "id": "hand-synced-search-index",
    "goldenPath": "docs/concepts/golden-paths/derived-index-sync.md",
    "title": "A search index kept in step by hand at N call sites instead of by the store",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "(?:INSERT\\s+(?:OR\\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK)\\s+)?INTO|DELETE\\s+FROM|UPDATE)\\s+[\"'`]?(\\w*_fts)\\b(?!\\s*\\(\\s*\\1\\b)(?![\\s\\S]{0,300}?\\b(?:new|old)\\.)",
      "flags": "gi",
      "ignoreCommentLines": true,
      "description": "An application statement that writes a full-text index table, where the write is NEITHER the FTS5 maintenance-command form `INSERT INTO t(t) VALUES('rebuild')` (excluded by the backreference lookahead — that form is the RECONCILER, and without the exclusion db/src/lib.rs:437, the repo's only drift repair, is reported as the defect) NOR inside a CREATE TRIGGER body (excluded by the `new.`/`old.` lookahead — those row aliases exist only inside a trigger, so this is a structural test for 'the store maintains this' written as one forward scan; no lookbehind, no nested quantifier). PROXY FOR the stack-free condition: a structure that must agree with another one is kept in step by statements the author of the next write has to remember, rather than by the store. MEASURED 2026-08-17 against the operator's live databases: the 24 raw FTS writes in this tree partition EXACTLY IN HALF — 12 hand-written (this rule) and 12 declared inside triggers (the positive control) — in disjoint file sets, and the partition predicts the divergence. The trigger-maintained indexes are at ZERO divergence (executions_fts: 2,188 docsize rows vs 2,188 persona_executions, id-exact, 0 orphan, 0 missing) and survived a bulk delete that orphaned 1,030 FK-protected child rows in the same transaction. The hand-maintained one has drifted: companion_fts holds 1,550 rows for 1,554 companion_node rows, and the 4 missing are exactly the kinds written by producers that forgot — 3 'backlog' (backlog.rs:100) and 1 'cockpit' (cockpit.rs:52). Only 6 of the 11 production `INSERT INTO companion_node` sites also write the index; dashboard.rs:36, reflection.rs:76 and rituals.rs:127 are latent, having produced no rows yet. The cost is not cosmetic: keyword.rs:92-95 is Athena's ONLY keyword retrieval lane and reads `FROM companion_fts JOIN companion_node`, so an unindexed node is unreachable, not merely unranked. PRECISION: 12 of 12 matches opened and confirmed hand-written maintenance. LEGAL FIX: declare AFTER INSERT / AFTER UPDATE OF <cols> / AFTER DELETE triggers on the source table (migrations/schema.rs:141-153 is the reference, and the `OF <cols>` clause on the update trigger is what stops an unrelated column write from churning the index), then delete all N hand-written statements. END OF LIFE: this rule is designed to reach zero; when it does the runner fails structurally on zero-matches, by design — DELETE the rule then, do not baseline it at 0."
    },
    "exclude": [
      {
        "path": "src-tauri/src/companion/brain/keyword.rs",
        "reason": "the only companion_fts writes in this file are #[cfg(test)] fixtures that build the retrieval lane's own two-table test schema; the census engine has no #[cfg(test)] exclusion, and a fixture cannot diverge in production"
      }
    ],
    "baseline": { "files": 7, "matches": 12 },
    "floor": 900
  },
  {
    "id": "hand-synced-search-index-positive-control",
    "goldenPath": "docs/concepts/golden-paths/derived-index-sync.md",
    "title": "CONTROL: the same write, declared inside a trigger so the store maintains it",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "(?:INSERT\\s+(?:OR\\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK)\\s+)?INTO|DELETE\\s+FROM|UPDATE)\\s+[\"'`]?(\\w*_fts)\\b(?=[\\s\\S]{0,300}?\\b(?:new|old)\\.)",
      "flags": "gi",
      "ignoreCommentLines": true,
      "description": "CONTROL for hand-synced-search-index: the COMPLIANT half of the identical raw match set — an FTS write whose row values come from a trigger's new./old. aliases, i.e. maintenance the store performs and no future writer can forget. Measured 2026-08-17: 12 matches across 3 files (db/src/lib.rs:738,741,744,745 for kb_chunks_fts; migrations/incremental.rs:298,302,306,308 and migrations/schema.rs:142,146,150,152 for executions_fts), disjoint from the rule's 7 files. A control near zero would mean the rule is discriminating on the word 'fts' rather than on who maintains the index; a 12/12 split in disjoint files is the partition the rule claims."
    },
    "floor": 900
  }
]}
```

### (B) is refused — and here is the instrument that expresses it, per the brief's §9 calibration

The census cannot assert an absence, and "nothing compares the two sides" is exactly an
absence. It also cannot express "must be zero", which is what a drift count should be.

**The brief asked whether the existing boot-time invariant assertion should be extended
rather than a new script written. It should, and the fit is close to exact.**
`assert_credential_blob_invariant` (`db/src/migrations/helpers.rs:271`) already establishes
the pattern this repo accepts: a cheap two-sided check run on every boot after migrations,
which logs loudly when the two sides disagree.
[`backfill-migration`](./backfill-migration.md) §9 specified extending it; this leaf is the
same shape one layer up, and the repo *already contains a second instance of it*
(`executions_fts_drift`, `lib.rs:409`) written independently, which is the strongest argument
that the mechanism is right and only its coverage is wrong.

So, concretely — **not a new script, and not a new mechanism**:

1. Move `executions_fts_drift`'s body behind a **registry**:
   `&[(derived: &str, size_expr: &str, source: &str, join: Option<&str>)]`, one row per
   structure in §0's register.
2. Have `init_db` call it once, beside `assert_credential_blob_invariant` and
   `cleanup_orphan_rows`, and `tracing::warn!` one line per disagreeing pair with **both
   counts**. Repair only where repair is safe and total (`'rebuild'` for FTS5); everything
   else warns.
3. **Fail loudly if it checks nothing:** the registry is a `const` array, and a
   `#[cfg(test)]` assertion pins `REGISTRY.len()` and requires every entry's `size_expr` to
   return a row on the test schema. A registry that silently shrinks to zero — the precise
   failure mode of the check it replaces — becomes a compile-visible constant and a red test.
4. The registry doubles as the fix for **D1/D2**: `cleanup_orphan_rows` and
   `scripts/test/clean-env.cjs` both consume it instead of their two hand-written lists, so
   the schema has one declared answer to "what depends on this table" rather than three
   private copies that have already drifted from each other.

**Why the test on the empty schema is not enough on its own, and what to add.** `incremental.rs:8590`
already asserts `PRAGMA foreign_key_check == 0` after a migration replay, and it passes today
against a live database holding 1,030 violations, because the replay database has no rows.
The registry test must therefore follow `ensure_executions_fts_backfills_rows_the_index_never_saw`
(`lib.rs:2347`) and **manufacture the divergence** — drop the triggers, insert rows the index
never saw, assert the checker reports the pair — rather than assert that a clean fixture is
clean.

### (C) is refused, and the fix is a column, not a gate

"No fingerprint" is not countable: the absence of a column is not a token. It is also the
cheapest thing in this document to fix — `ALTER TABLE persona_memory_embedding_meta ADD
COLUMN source_hash TEXT`, written in `embed_and_store_memory`, and
`backfill_memory_embeddings`' candidate query becomes a join on inequality instead of a set
difference. **Prefer the column over any gate here**: it converts D6 from unanswerable to a
one-line query, and no ratchet would move a single row.

---

## 10. Convergence

Six clauses tested against `personas-web`, `brainiac`, `personas-cloud`, `vibeman`, `ascent` —
all five present, all five opened, **lineage established per repo before any count was taken.**

### The cohort is 2, not 5

| sibling | verdict | why |
|---|---|---|
| **brainiac** | **independent** | first commit 2026-07-10, Rust/Postgres/pgvector, **zero** shared identifiers with this tree. A different substrate meeting the same question. |
| **ascent** | **independent** | first commit 2026-05-31, Next.js/Prisma, zero shared identifiers. Answers the leaf by *refusing the structure*. |
| **personas-web** | **partial** — counts on C1–C5, **not** on C6 | its mechanism (a Next.js JSON file cache) has no possible twin in a Tauri/SQLite app, but `StalenessIndicator` exists in both repos and this one is **three weeks earlier**. |
| **vibeman** | **partial** — counts only on its pre-extraction generation | two generations pointing opposite ways (below). |
| **personas-cloud** | **EXCLUDED** | not a sibling. It declares this repo's own tables (`personas`, `persona_executions`, `persona_events`, `persona_triggers`, `persona_credentials`), the desktop syncs rows into it (`src-tauri/src/cloud/sync/rows.rs`) and calls its API (`src-tauri/src/cloud/client.rs:762`). It is the **server half of the same product**, and the desktop declares neither `cloud_deployments` nor `trigger_firings`. A shared schema by construction is not agreement. |

**Effective independent cohort: 2 fully + 2 partially.**

**And the lineage check paid for itself twice.**

**(1) A trap that would have doubled one artifact into two.** `persona_metrics_snapshots`
exists in **both** vibeman and this repo with near-perfect textual identity — same name, same
13 columns in the same order, this repo dropping only `tools_used` — vibeman
`108_observability.ts:15-31` (**2026-02-16**) against `schema.rs:402-419`. vibeman's migration
predates this repo's **first commit** (2026-02-17), and its subject line already reads
`feat(personas): … observability backend`. Personas was extracted *from* vibeman.
**And the table is a dead rollup in both** — zero writers, zero readers in vibeman; in this
tree the only `INSERT` in 963 `.rs` files is a `#[cfg(test)]` fixture (`fk_hygiene.rs:823`),
and live it holds **0 rows** despite a schema, three indexes (`fk_hygiene.rs:472-473`,
`incremental.rs:1512`), an FK-hygiene rebuild (`:442`) and an entry in the boot orphan sweep
(`lib.rs:458`). Counting that as two repos independently building an unfilled rollup would
have been a **2× overcount of one artifact**.

**(2) A banked in-code claim that does not survive.** `StalenessIndicator.tsx` carries a
comment asserting that `personas-web` wrote the component independently. That comment was
added **during this campaign** (2026-08-16), and the chronology runs the other way: this repo
added its component 2026-03-28, `personas-web` on 2026-04-18 — with the same component name,
the same `fetchedAt` prop, the same four-bucket ladder, the same lucide icon and the same
`staleness.*` i18n namespace. Per the doctrine's *"a banked claim is a lead, not a finding"*,
`personas-web` is discounted on C6.

### The external cost — cited, not re-derived

Per the brief, `vibeman`'s two prior measurements stand as this leaf's price tag in a sibling
and were **not** re-measured: **an integrity trigger bound to a dead table**, and **a
watermark-less rollup reading 80,817,237 rows for a localhost app.** Both were confirmed still
present and located: the trigger at `137_cascade_delete_evidence_junction.ts:74-79`, firing on
`behavioral_signals`, which lives in a *different SQLite file* (`hot-writes.ts:58`) — the
migration admits it at `137:96-98`; the rollup declared at `hotWritesAggregator.ts:38-75` on a
5-minute interval, querying `observability.repository.ts:452-465` with no `WHERE` and no
watermark column anywhere.

Two things the sweep added, and they change what the cost *is*:

- **All three triggers are issued in one `db.exec()` batch** (`137:56-80`). The third throws,
  the wrapping transaction rolls back, and the *other two* die with it — so
  `cleanupOrphanedEvidence()` (`137:100-164`), that repo's only orphan-repair routine, is
  **unreachable dead code**, and the migration retries on every startup forever.
- The rollup's upsert **accumulates instead of replacing** (`observability.repository.ts:142-151`,
  `SET call_count = call_count + ?`) while raw calls are retained 24 h. Every raw call is
  therefore re-aggregated and re-added across ~288 cycles. **The rollup is not merely slow, it
  is arithmetically wrong** — inflating monotonically by roughly two orders of magnitude — and
  the read path `SUM()`s the corrupt values and feeds them to an LLM as grounding
  (`brainContext.ts:201`). That is the exact failure §2(f) prevents by recomputing the bucket
  from source instead of incrementing it, and it is the strongest available argument for that
  clause.

### Clause matrix

| | personas-web | brainiac | vibeman | ascent |
|---|---|---|---|---|
| **C1** a derived structure exists | 3 JSON files, no DB | tsvector + 2 vector tables + HNSW + 6 rollups | 14 structures; **no FTS, no embeddings** | 15 counters + 1 rollup; **no FTS, no embeddings, no matviews** |
| **C2** what maintains it | reader-is-writer; **0 triggers** | **0 trigger-maintained, 1 engine-generated, ~17 app** | 1 trigger-maintained, 12 app, 1 sweep, 1 nothing | **0 triggers, 22 app, 0 cron-recompute** |
| **C3** a reconciler | **absent** (TTL only) | CLI-only for embeddings; **real + alarmed** for `dirty_at` | **advisory-only**; its repair routine is unreachable | **absent** (and two things *named* reconciliation are not) |
| **C4** freshness marker | ✅ `cachedAt`, and it **gates the read** | ❌ derived row is 3 columns, 2 of which are the key | split — hash on Gen 2, none on Gen 1 | ✅ on the snapshot, ❌ on every counter |
| **C5** reader on disagreement | no join | **INNER JOIN driving FROM the derived table** | **no join at all** | **mostly computes from truth** |
| **C6** discloses staleness | primitive exists, **not applied to the cache** | absent for the index, complete for `dirty_at` | one family only | best "as of" in the fleet |

### PHYSICS — independently reinvented, and one of these reframes the document

**The strongest result, and it is 5 for 5: every repo establishes a
reconciliation-and-disclosure standard and applies it to exactly ONE structure, then never
generalises it.** brainiac instruments `documents.dirty_at` end to end — a reconciler, a 24-hour
SLA alarm (`alerts.rs:111-120`, *"the wiki is rotting"*), a dirty-count tab, a per-page badge —
and gives `memory_embeddings` a CLI command nobody schedules. `personas-web` builds a
`StalenessIndicator`, ships it on three dashboard panels, and does not put it on its stats
cache. `ascent` stamps `TeamStandingSnapshot.generatedAt` and renders it beautifully, then drops
`Repository.aiConformanceAt` before it reaches the UI. `vibeman` instruments its contexts family
and leaves both of its drifting structures bare. **And this repo gives `executions_fts` a boot
reconciler, a war-story comment and a trigger-removing test — and gives the other nineteen
structures in §0's register nothing.**

That is not carelessness and §0 should not be read as calling it that. It is the leaf's
physics: **the standard is discovered while fixing one incident, and nothing carries it to the
structures that have not had their incident yet.** The confound worth naming is that in
vibeman the pattern is chronological (Gen 2 learned what Gen 1 didn't); **in this repo it is
not — the instrumented structure is the older one.** So §9's prescription is a **registry**
rather than a better single check: the failure is not that anyone got the mechanism wrong, it
is that a mechanism attached to one structure has no way to reach the next.

**Also physics:**

1. **Trigger-maintenance is ~4% of the fleet.** brainiac **0**, ascent **0**, personas-cloud
   **0**, vibeman **1 structure**, Personas **2** — against 17 + 22 + 12 + 10 app-maintained
   write sites. Every repo with a real database independently landed on "application code at
   each write site". **Read carefully: this is the fleet converging on the *disease*, not on an
   answer** — the doctrine's tenth failure mode, and an oracle that only counts agreement would
   read it as the strongest possible confirmation of the status quo. The correct reading is
   that P1 is *hard*, universally skipped, and that the one repo which escaped it did so by not
   having a second copy at all (below).
2. **Where triggers are used, two independent repos reached for them as VALIDATORS, not
   maintainers.** This repo's `persona_memories_importance_insert/update`
   (`helpers.rs:431-445`, `RAISE(ABORT)`) and brainiac's `standards_attribution`
   (`0028_library_substrate.sql:104-107`, `RAISE EXCEPTION`). Non-obvious and convergent.
3. **Readers INNER JOIN from the derived table back to the source. Zero `LEFT JOIN`s in the
   entire fleet; zero divergence surfaces.** brainiac drives `FROM memory_embeddings JOIN
   memories`, so an un-embedded memory is *fully invisible to semantic recall* and nothing says
   so — while the same product knows how to disclose withholding elsewhere (*"{n} matching
   memory(ies) are withheld…"*, `mcp.rs:1100`). This repo does the same for all four of its
   FTS/vec structures. **§7 D3 is therefore the fleet norm, not this repo's aberration** — and
   `memory_recall.rs`'s advisory reader is the aberration, in the good direction.
4. **The freshness marker, where it exists at all, lives on the SOURCE row — never on the
   derived row.** brainiac: `content_hash` on `sources` and `extraction_cache`, nothing on
   `memory_embeddings`. Personas: `content_hash` on `companion_node`, nothing on
   `companion_embedding` or any FTS5 table. Two independent repos, same asymmetry. This
   sharpens **P4**: the fleet has learned to fingerprint *inputs* and has not learned to
   fingerprint *derivations*, which is precisely why "is this entry still true" is
   unanswerable in both.

### SILENCE — reported as silence, not promoted to convergence

5. **No repo discloses index coverage.** No "N of M indexed", no coverage percentage, no
   "index rebuilt N minutes ago" for any search or vector index, in any of the five. This repo
   ships three manual rebuild buttons and zero standing status — and its own knowledge-base
   hint, `en.json` → `vault.shared.reindex_hint`, ends *"…or to rebuild an index you suspect
   has drifted."* **The product asks the user to be the drift detector**, for a condition no
   surface in the product reports.
6. **Both repos that built a vector-index reconciler query declined to schedule it.**
   brainiac's `missing_embedding` (`memories.rs:237-247`) is CLI-only, deliberately
   (`docs/ARCHITECTURE.md:513-515`); this repo's `reembed_candidates`
   (`embeddings.rs:216-258`) is manual-trigger only. The capability exists in both and is
   unwired in both — a convergent silence, not a convergent answer.
7. **No repo recomputes a counter from its source and compares.** Not one. `ascent` is
   explicit about refusing to; `vibeman` has the comparison query sitting unused two dozen
   lines from the counter it would check; this repo has none for `evidence_count`,
   `subscriber_count` or `open_claim_count`.

### Personas-AHEAD

- **The boot-time drift check with automatic repair** (`lib.rs:409-440`). **No sibling has
  one.** And the war story above it — a check that ran every boot for months and was
  *structurally incapable of firing* — is the most transferable artifact in the sweep.
- **Refusing an operation that would desync** (`commands/credentials/vector_kb.rs:1340-1362`):
  the document delete rolls back rather than removing chunks whose vectors cannot be removed,
  because *"kb_search would return orphaned vectors and silently shrink results."* **The only
  place in the fleet where desync is a reason to fail an operation.**
- **The divergence-resolving rollup reader** (`sla.rs:692-760`), which merges the durable
  rollup with a fresh recompute and keeps the higher `total` per day. vibeman's equivalent
  `SUM()`s aggregates that its own accumulate-don't-replace upsert has inflated; ascent's
  snapshot is read only for its timestamp.
- **The advisory-index reader** (`memory_recall.rs:347-397`) — P6, and against a fleet that is
  unanimously on the other side of it.

### Personas-BEHIND — four adoptable answers

- **brainiac's engine-generated FTS.** `memories.content_fts tsvector GENERATED ALWAYS AS (…)
  STORED` (`0001_init.sql:77`) **cannot drift**, because it is not a second copy anyone
  maintains — it is a projection the engine recomputes. That is a strictly better answer than
  §2(a)'s trigger, and it is the escape from the fleet-wide app-maintenance convergence.
  SQLite has no generated-column equivalent for FTS5, so the trigger remains this repo's best
  available form — but the *principle* to import is "make it not a separate copy" before
  "make the store copy it".
- **brainiac's unconditional write-path hook** (`governance.rs:216-221`): *"Marking here
  (rather than in each caller) is what makes the guarantee unconditional: there is no way to
  change a memory's standing through the governance path and forget the wiki."* That is the
  direct structural answer to §7 D3's five forgetful producers, and it is available today —
  route every `companion_node` write through one function.
- **brainiac's read-path self-healing reconciler** (`resolve.rs:106-117`): any canonical entity
  missing an embedding is backfilled during resolution, so steady state finds none. This repo
  has no read-path self-heal anywhere.
- **ascent's read-from-truth default.** `prisma/schema.prisma:445-446` — *"progress is derived
  from the fleet's latest scans at read time (**no stored snapshot to drift**)"* — and
  `credits.ts:298-302`, a documented refusal to denormalize. Six major surfaces compute from
  source. It is the only repo in the cohort that answers this leaf by **not creating the
  structure**, and it is the right answer to §7 D10.

**Verdict on the spine label: `diverged` is upheld**, and it is upheld for a specific reason
worth recording — the fleet agrees on the *problem shape* and disagrees on nothing because
almost nobody has an answer. Four of six clauses are silences or convergence-on-the-disease.
Only clause 2 (triggers as validators) and clause 4 (fingerprints on the source) are
agreements about what to *do*.

---

## 12. Corrections to the brief

**12.1 — `sides: "server"` upheld, and the mechanism is worth naming.** This is the second
upholding of `sides: "server"` in the corpus. It holds for a structural reason: **the client
never sees the second copy.** The frontend receives whatever a repo function returns; it
cannot know that `persona_tool_usage` was aggregated without a join, that
`companion_fts` is short four rows, or that a vector predates its memory. Every one of §7's
twelve deviations, the exemplar, the census rule, its control and its floor are server-side
Rust. The single client-visible consequence — the Tools dashboard's +13.3% — is *rendered*
on the client and *caused* entirely on the server, and no client-side change could detect it.

**12.2 — I measured a 41× divergence that does not exist, and the trap is the column's
name.** `workspace_knowledge.evidence_count` has 1,151 non-null values summing to **4,315**
while `workspace_knowledge_evidence` holds **104** rows — 1,148 of 1,151 rows "disagreeing",
which was on its way into §0 as the largest divergence in the database. It is not a divergence.
`evidence_count` is a **prevalence** figure supplied by the harvester — *"how many sites"* —
documented as such at `incremental.rs:6861` and `workspace_harvest.rs:674`, and written from
at least four unrelated producers including `skill_lessons.rs:301`, where it is the **line
count of a lesson**. It counts something that is not rows and lives in no table. General
rule, earned: **a column named `<child>_count` is not necessarily a count of `<child>` — open
the writer before you call it drift.** The name is the entire trap, and it is the same shape
as the doctrine's warning about vocabularies chosen from imagination.

**12.3 — the brief's primed figure for the companion vector index is 6.4% low, and it is a
`vec0` shadow-table trap.** [`backfill-migration`](./backfill-migration.md) §0 row 4 records
`reembed_missing` at **"349 vectors"**. The true count is **373**, confirmed twice — from
`companion_embedding_rowids` and by popcounting the `_chunks.validity` bitmap. `349` is the
row count of `companion_embedding_metadatatext00`, and sqlite-vec stores a TEXT metadata value
**inline** when it fits in 12 bytes: the 349 doctrine ids are `doc_XXXXXXXXXX` (14 chars, so
external) and the missing 24 are episode ids `ep_XXXXXXXX` (11 chars, so inline). The
undercount is exactly the set of shorter identifiers. *Correction applied to the register
here; the neighbouring path's row 4 should be read as 373.*

**12.4 — my own first `sla_daily` measurement was a false positive of exactly the kind the
doctrine warns about, and it agreed with my thesis.** A first pass bucketed executions with
`substr(COALESCE(completed_at, created_at), 1, 10)` and reported **276 of 500 day-rows
disagreeing** with the rollup — a satisfying result for a document about drift. The writer
(`sla.rs:642`) buckets with `DATE(created_at, <local-day offset>)`. Replayed verbatim at four
offsets: at **+120 minutes — the machine's real offset — 403 of 403 recomputable buckets
match exactly, 0 higher, 0 lower.** At every *wrong* offset the disagreement reappears in a
plausible shape (74 higher / 78 lower at +60). **The `GROUP BY` that omits the scope key the
code carries produces a disagreement no amount of opening individual rows would refute**,
because every row in the result set is real. `sla_daily` is not a deviation; it is the
exemplar, and the 697-execution excess is the durable tail doing its job.

**12.5 — the brief's "a delete of 2,188 runs cascades to 4,376 FTS rows" needs a sign
correction, and the correction is the finding.** 4,376 is 2,188 content-table rows plus 2,188
`_docsize` rows; the FTS *write* amplification of a bulk delete is real (each delete appends a
tombstone into `_data`). But framing it as a cost of the trigger inverts what the measurement
shows: **the trigger is the only thing that came through that delete correct.** The June 3
backup has `executions_fts_docsize = persona_executions = 138`; the live file has
2,188 = 2,188; and the same pass left 1,030 rows orphaned behind declared `CASCADE`
constraints. The write amplification is the price of the property, and it is the cheapest
line item in §0's register.

**12.6 — "`persona_tool_usage` HAS `ON DELETE CASCADE` and orphaned 980 rows anyway — find
out why" has a two-part answer, and only one part is about foreign keys.** Part one:
`scripts/test/clean-env.cjs:73` sets `foreign_keys = OFF` so its hand-written table list can
be deleted in any order, and the list omitted `persona_tool_usage` and `assertion_results`
until 2026-08-14 — the script's own comment block now records the same 1,030 figure this
composition reached independently, and **672 of the 980 were already orphans in the June 3
backup**, so the population accumulated over at least two passes. Part two, and this is the
part a foreign key can never fix: **17 of the 24 `*execution_id` columns never declared one**,
carrying **5,850 further dangling references that `PRAGMA foreign_key_check` is structurally
blind to**. Adding a constraint would also not repair history — SQLite validates existing
rows only during the rebuild that adds the constraint, and that rebuild runs with enforcement
off by necessity. The fix is the registry in §9, not a `REFERENCES` clause.

**12.7 — the brief's "880 of 2,942 trace rows name an execution that no longer exists" is
confirmed, and it has a *different* cause from the 980.** The orphan `persona_tool_usage`
rows all predate the oldest surviving execution (latest orphan `2026-06-03T10:06`, oldest
surviving execution `2026-06-03T12:00`) — one cliff, one bulk pass. The orphan
`execution_traces` rows are **interleaved with the live ones** (orphans span
`2026-06-03T12:15 → 2026-06-20`, live rows `2026-06-03T12:11 → 2026-06-26`). They are not
wipe residue; they accumulate in ordinary operation, because `execution_traces` declares no
foreign key and the retention sweep (`executions.rs:2001`) deletes only the parent. **Two
tables, two orphan populations, two causes, and a single "add the FK" prescription would
address one of them.**

**12.8 — the oracle inverted my reading of §7 D3, and the inversion is the more useful
finding.** I drafted D3 (`companion_fts` read via an inner join, so an unindexed node is
unreachable) as this repo's aberration. **It is the fleet norm: zero `LEFT JOIN`s and zero
divergence surfaces across all four cohort members**, with brainiac driving its hybrid recall
`FROM memory_embeddings JOIN memories` so an un-embedded memory is silently invisible to the
semantic arm. The aberration is `memory_recall.rs:347-397`, in the *good* direction. P6 was
drafted as a repair and is really a **transfer**: this repo already owns the fleet's best
answer to the clause and applies it to one of its five indexed structures.

**12.9 — and the same oracle refuted the tone of my own §0.** I wrote the register as
twenty-one structures of which one is checked, and read that as neglect. **The sweep found the
identical shape in 5 of 5 repos**: every one establishes a reconciliation-and-disclosure
standard while fixing one incident and never carries it to the structures that have not had
their incident yet. That reframes the prescription. If it were neglect, the fix would be
diligence; because it is structural, the fix has to be a **registry** — a place where adding
the twenty-second structure forces the question — which is what §9(B) proposes instead of a
better single check. The confound is worth keeping in view: in `vibeman` the pattern is
chronological, in this repo it is not (the instrumented structure is the *older* one), so
"they'll get to it" does not explain the local case.

**12.10 — the brief primed P1 as "use a trigger", and the fleet says the better answer is one
step further back.** Trigger-maintenance is ~4% of the cohort's derived structures, and the
one repo that has no drift in its search index got there by making the index **not a separate
copy at all** — `content_fts tsvector GENERATED ALWAYS AS (…) STORED`. A generated column
cannot be forgotten because there is nothing to remember. SQLite offers no such form for
FTS5, so §2(a) still says "trigger" for this stack, but the *principle* is ordered: make it
not a second copy, then make the store copy it, then — only then — copy it yourself
carefully.

**12.11 — `workspace_practice_context_state` is derived, nothing checks it, and its size is
not the interesting number.** The brief asked both questions. Derived: yes — 1,164 practices
× 218 contexts, and the product is exact to the row. Checked: no — no reconciler, no list
surface, 142 practices never materialized. But the finding is not that it is large; it is
that **99.97% of it restates the value a reader would assume from an absent row**, and that
the 0.03% which carries information (74 `adopted` + 9 `violating`) is exactly the 83 rows with
`evidence` and `verified_at`. That is P7, and it is the only clause in this document whose
fix makes the database smaller.
