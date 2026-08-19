# Vector KB ingestion

> Situation node: `integrations-security / external-and-host-surfaces /
> vector-kb-ingestion` · [situation spine](../situation-spine.json)
> `sides: "client"` · `twoSided: true` · `fusedAcrossSides: false` ·
> `recurrence: 7` · `risk: medium` · `convergence: "mixed"`.
> Dimensions: **function · performance · ui · cost**.
> Spine `why`: *"Loading files, directories and pasted text into a
> per-credential vector store."*
>
> **Short form** (Mode 2 tiering: `risk: medium`, recurrence < 9). Prose is
> dropped; measurement is not.
>
> Composed 2026-08-17 against `master @ f81e2c1df`. Sweep: `src-tauri/src/commands/credentials/vector_kb.rs`
> (1,711 lines, 18 commands), `src-tauri/src/engine/kb_ingest.rs` (994),
> `src-tauri/db/src/vector_store.rs` (208), `src-tauri/db/src/embedder.rs` (264),
> the `ml`-gated regions of `src-tauri/db/src/repos/core/memories.rs`,
> `src-tauri/db/src/memory_recall.rs`, `src-tauri/src/lib.rs`'s
> `generate_handler!` block, the 17 files of `src/features/vault/shared/vector/**`,
> `src/api/vault/database/vectorKb.ts`, plus row counts replayed against **both**
> databases in **both** the pre-purge backup and the live files.

---

## §0 — Headline

**On 2026-08-17 the operator purged every persona. `persona_memories` went from
6,535 rows to 0. The vector store did not move by a single row: 5,158 vectors,
5,158 before and 5,158 after, of which 0 were orphaned before the purge and
5,158 — 100 % — are orphaned now. One `DELETE` crossed a database boundary the
foreign key could not, and nothing on the other side noticed.**

Measured against
`%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db` (pre-purge,
347,054,080 B) and the live `personas.db`, both joined against
`personas_data.db` (17,502,208 B — **byte-identical in the backup and live**,
because the purge never touched it):

| | `persona_memories` | vectors (`persona_memory_embedding_meta`) | orphan vectors | memories with no vector |
| --- | ---: | ---: | ---: | ---: |
| pre-purge (backup) | 6,535 | 5,158 | **0** | 1,377 (21.1 %) |
| post-purge (live) | **0** | **5,158** | **5,158 (100 %)** | 0 |

Two independent implementations, exact agreement: a cross-`ATTACH` SQL
`LEFT JOIN`, and a bespoke pass that loads both id sets into JS `Set`s and
computes the differences with no SQL join at all. Both also confirm the vector
id set is **byte-identical across the purge** (5,158 of 5,158 ids present in
both), so this is not "some cleanup ran late" — nothing ran.

**These row counts are historical as of 2026-08-17 and unreproducible from the
live database**, per the campaign's standing warning. Cite the backup by name.

Three structural facts explain it, and each is a separate finding:

1. **The relationship is a foreign key in the schema and a string across a file
   boundary in reality.** `persona_memories.persona_id REFERENCES personas(id)
   ON DELETE CASCADE` (`db/src/migrations/schema.rs:525`) is enforced by SQLite
   inside `personas.db`. `persona_memory_embedding_meta.memory_id`
   (`repos/core/memories.rs:1689-1693`) lives in `personas_data.db` and has no
   FK, cannot have one, and is never consulted by the cascade. A cascade is a
   *database engine* feature; it stops at the file.

2. **Every reconciliation in this subsystem runs relational → vector. Nothing
   runs vector → relational.** `gc_archived_memory_embeddings`
   (`memories.rs:1928`) enumerates `tier = 'archive'` rows *in the main DB* and
   drops their vectors. `backfill_memory_embeddings` (`:2008`) enumerates
   memories and embeds the ones missing. `reconcile_orphaned_kb_records`
   (`vector_kb.rs:1410-1516`) — the one genuinely bidirectional reconciler in
   the tree — compares `knowledge_bases` against `persona_credentials`, i.e.
   **two relational tables in two databases**, and touches the vector store only
   via `drop_index(kb_id)` for a `kb_id` it learned from a relational row. **No
   code in 963 `.rs` files enumerates the vector store and asks whether each
   vector still has a parent.** An orphan is by definition absent from the
   relational side, so a relational-first sweep cannot see one. This is the
   doctrine's *"a diff-shaped gate cannot see an absence"* in a new costume: the
   sweep's direction is the bug.

3. **The cleanup that does exist is behind a cargo feature; the data is not.**
   `delete_memory_embeddings`, `gc_archived_memory_embeddings`,
   `spawn_delete_memory_embeddings` and `reconcile_orphaned_kb_records` are all
   `#[cfg(feature = "ml")]`. `npm run tauri:dev:lite` — the documented daily
   default — builds `desktop`, not `desktop-full`. **In a lite build the app
   cannot delete a single vector, ever, and the boot reconciler does not run** —
   while `personas_data.db` sits on disk unchanged. Measured tree-wide: **230
   cleanup/reconcile function declarations**, of which **3** are gated behind a
   cargo feature, and all 3 are these.

And the leaf's nominal subject — loading files, directories and pasted text into
a knowledge base — **has never stored a row on this machine**:
`knowledge_bases`, `kb_documents`, `kb_chunks`, `kb_entities` and
`kb_extraction_runs` are **0 in the backup as well as live**, so this is not
purge damage. Meanwhile the vault renders a built-in *"Local Vector DB"*
credential (`id: builtin-personas-vector-db`) with **20 consecutive successful
healthchecks** and `usage_count: 195`, whose modal opens to *"knowledge base not
found"* because its metadata carries no `kb_id` (§7.6).

---

## §2 — The one way (compact)

**Put the vector in the same store as the row it describes, and give it a
foreign key.** That is the whole prescription and everything else is a
consequence of not being able to follow it. When the vector genuinely cannot be
co-located — here, because `vec0` requires the `sqlite-vec` extension and the
extension is registered on the *user* pool — then you have taken on a
distributed-integrity problem and you must pay for it explicitly, in this order:

(a) **Name the invariant.** Write down, in the module that owns the vector
table, the sentence *"every `<vector>.<key>` has a row in `<db>.<table>`"*. It
is not a foreign key, so it will not enforce itself, and an invariant nobody
wrote down is an invariant nobody can check.

(b) **Make the cleanup unconditional.** A vector's lifecycle must not depend on
a build flag when the file it lives in does not. Compile the delete/GC/reconcile
functions in every profile; put the `#[cfg]` *inside the body* around the
extension-dependent call, exactly as
[`feature-flagged-compilation`](./feature-flagged-compilation.md) §2 prescribes
for IPC entry points. A `desktop` build should be able to delete rows from a
plain `_meta` table even if it cannot open a `vec0` virtual table.

(c) **Enumerate the derived side, not the source side.** A sweep that starts
from live parents finds *unembedded* rows; only a sweep that starts from the
vector store finds *orphans*. Both are needed and they are different queries.
Run the orphan direction at boot, bounded, and **log the count even when it is
zero** — a reconciler whose only output is silence is indistinguishable from one
that never ran. (`reconcile_orphaned_kb_records:1513` logs only when
`cleaned > 0`; it has therefore never printed a line on this machine.)

(d) **Count both sides at boot and store a fingerprint.** This is
[`derived-index-sync`](./derived-index-sync.md) §2's prescription verbatim
(*"count both sides at boot"*), and this pair is one of its twenty unchecked
derived structures. The check is two `COUNT(*)`s and a subtraction; the cost of
not having it is 5,158 orphans that nothing will ever notice.

(e) **Make the reader treat the index as advice.** Personas already does this
and it is the reason the purge caused no *correctness* incident: KNN returns
`memory_id`s, the caller lifts rows from the authoritative table, and an id with
no row simply drops out (`memory_recall.rs:343-346`). Keep that. But do not
mistake it for a fix — see §7.1 for what it costs.

(f) **Delete in the order that makes a crash recoverable.** `delete_knowledge_base`
(`vector_kb.rs:184-231`) is the right shape and should be the template: cancel
the in-flight ingest job first, `yield_now()` so the cancelled task observes the
token, drop the vector index (idempotent, cheapest to redo), then the user-DB
rows **in one transaction**, then the main-DB credential. Every intermediate
crash leaves a state the boot reconciler can name.

**If you can only do one thing: run the orphan-direction count at boot and log
it.** It is ten lines, it cannot delete anything, and it would have turned this
document's headline into a warning in the log on 2026-08-17.

---

## §7 — Deviations

**7.1 — The "inert" comment is right about safety and wrong about cost.**
`memories.rs:1638-1640` says a missed cleanup *"only leaves an orphan vector
whose id never matches a live candidate — inert for recall."* Safety: correct,
and I verified the mechanism (`memory_recall.rs:343-346`, `pack_by_budget_task_aware`
intersects hits with `candidates`). Cost: **the KNN `LIMIT k` is applied before
the intersection.** `search_similar_memories` (`memories.rs:1771-1774`) runs
`… WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2` and only then hands the
hits to the caller. `k = candidates.len() * 4, min 128`
(`memory_recall.rs:363`) — a margin sized against *other personas'* rows, which
the comment there explains carefully, and **not** against orphans, whose
population is unbounded. At today's ratio (5,158 orphans, 0 live memories) the
early return at `:356` makes it moot; at 100 live memories and 5,158 orphans,
k = 400 slots compete against a corpus that is 98 % dead. Recall degrades
smoothly and silently, in proportion to orphan share, with no error anywhere.
**A store that can only grow is the finding, and "inert" is what makes it
invisible.**

**7.2 — Only 3 of the 8 doors that delete a memory maintain its vector.**

| door | vector companion |
| --- | --- |
| `batch_delete` (`memories.rs:821`) | ✅ `spawn_delete_memory_embeddings(ids)` at `:843` |
| `merge` (`:1207`, `:1211`) | ✅ `:1220` |
| archive path / `update_tier` (`:954`) | ✅ `:954` |
| `crud_delete!("persona_memories")` → `delete` (`:1026`, expanded at `macros.rs:209-220`) | ❌ none |
| `delete_non_core` (`:1034`) | ❌ none |
| `delete_all` (`:1052`) | ❌ none |
| `fk_hygiene.rs:603` (`DELETE … WHERE persona_id NOT IN (SELECT id FROM personas)`) | ❌ none |
| `ON DELETE CASCADE` from `personas` (`schema.rs:525`) | ❌ **structurally impossible** |

The last row is the one that fired. Note the shape of the three that are
correct: each is a *hand-written* companion call in a repo function. Three
authors remembered; five did not; and the engine — the only participant that
sees all deletions — was never given the chance.

**7.3 — `spawn_delete_memory_embeddings` is best-effort three times over.**
`memories.rs:1642-1657` returns early if the recall runtime is unregistered
(`task_recall_runtime()` → `None`), returns early if there is no current tokio
runtime, and inside the spawned task logs any failure at `tracing::debug!`.
Three silent no-op paths, one of them (`debug!`) below the default log level. A
cleanup with three ways to do nothing quietly needs a counter, not a log line.

**7.4 — `reconcile_orphaned_kb_records` skips exactly the row that exists on
this machine.** Case 2 (`vector_kb.rs:1476-1482`) reads
`service_type = 'personas_vector_db'` credentials, parses `metadata.kb_id`, and
`continue`s when there is none. The one such credential here
(`builtin-personas-vector-db`) has no `kb_id`. So the reconciler runs at every
boot, examines it, and skips it — while `VectorKbModal.tsx:220-229`'s
`extractKbId` returns `null` for the same row and renders `kb_not_found`.

**7.5 — An orphan `kb_vec_*` table is invisible by construction.** The KB vector
store is **one `vec0` virtual table per knowledge base**, named
`kb_vec_<uuid_with_underscores>` (`vector_store.rs:191-199`). Every consumer
derives that name from a `kb_id` it read out of a relational row. Nothing
enumerates `sqlite_master`. A `kb_vec_*` table whose `knowledge_bases` row died
by any path other than the two the reconciler handles is unreachable, forever,
by any query in the tree. (Population today: 0, because no KB was ever created —
so this is a latent defect, not a live one.)

**7.6 — A green healthcheck on a store with nothing in it.** The
`builtin-personas-vector-db` credential's metadata records **20 healthchecks
between 2026-07-25 and 2026-08-17, all `success: true`**, all with the message
*"Connection type does not support HTTP healthcheck -- credentials stored"*, and
`healthcheck_last_state: "unverifiable"`. The state field is honest; the boolean
is not, and the boolean is what the vault badge renders. Adjacent to deferred
fix **#9** (*"Eight unprobed credentials render green"*), same family, different
row.

**7.7 — 18 IPC commands exist only in `desktop-full`.**
`commands/credentials/mod.rs:31-32` gates `pub mod vector_kb`, and each of the
18 registrations in `lib.rs:3647-3682` carries its own `#[cfg(feature = "ml")]`.
This is the exact violation
[`feature-flagged-compilation`](./feature-flagged-compilation.md) §2 names
(*"never let a build switch decide whether an entry point exists"*) — and the
published `build-gated-ipc-entrypoint` rule already counts them (127 matches in
`lib.rs`), so I am citing, not re-reporting.

**7.8 — The frontend has no concept of the capability being absent.** A
tree-wide grep for `desktop-full`, `mlEnabled`, `hasMl`, `vectorAvailable`,
`embeddingAvailable`, or any `feature === 'ml'` test across 4,801 `.ts/.tsx`
files returns **zero** hits. So in the documented daily-default build,
`VectorKbModal` mounts, calls `getKnowledgeBase`, receives Tauri's generic
*command not found* rejection, `logger.error`s it (`VectorKbModal.tsx:51`), and
renders the same *"knowledge base not found"* screen a genuinely missing KB
produces. **A missing capability and a missing entity are the same pixel.**

**7.9 — 1,377 memories (21.1 % of 6,535) had no embedding pre-purge.** The
backfill runs at boot in a loop with a 10-second sleep between batches
(`lib.rs:1087-1102`) and stops permanently on error (*"next launch retries"*).
Whatever the cause, the steady state was one memory in five invisible to
task-aware recall, with the only signal a `tracing::warn`. `unfinishable-backfill-receipt`
already matches `backfill_memory_embeddings` at `:2008`.

**7.10 — `create_knowledge_base` writes three stores with no transaction across
them.** `vector_kb.rs:66-120`: `vs.create_index()`, then `knowledge_bases` in
the user DB, then `persona_credentials` in the main DB. The rollback path
(`:104-119`) is best-effort `let _ =` on three separate statements. It is
carefully written and it is still three uncoordinated writes; the boot
reconciler exists precisely because this cannot be made atomic.

---

## §9 — Decline, with numbers, and the instrument that would work

**I am not shipping a census rule for this leaf.** Three candidates were built
and measured; each failed for a reason worth recording.

**Candidate 1 — `feature-gated-cleanup-door`** (a `#[cfg(feature = "…")]`
immediately above a `fn` whose name begins `delete_|gc_|prune_|purge_|cleanup_|reconcile_|sweep_|evict_|drop_`).
Measured over 963 `.rs` files: **3 matches in 2 files** —
`memories.rs:1886` (`delete_memory_embeddings`), `memories.rs:1927`
(`gc_archived_memory_embeddings`), `engine/src/ambient_context.rs:1379`.
Positive control (the same anchors with no feature gate): **230 matches in 137
files**. The partition is beautiful — 3 of 233, 1.3 % — and the rule is still
wrong to ship: a ratchet whose entire population is three sites, all in the
subsystem the document is about, is a comment with a runner attached. It cannot
move except when someone edits these two files, and the census fails structurally
if it ever reaches zero. **The 230-vs-3 partition is the publishable output; the
rule is not.**

**Candidate 2 — a cross-store delete without a companion call.** The honest
signal is *"a `DELETE FROM persona_memories` in a function that does not also
call `spawn_delete_memory_embeddings`"* — an **absence**, which per doctrine §4
the census cannot express by construction. It ratchets a count of something
present; it cannot assert that a function omits something. Declined on
expressiveness, not on precision.

**Candidate 3 — reuse `hand-synced-search-index`** (published by
[`derived-index-sync`](./derived-index-sync.md)). I ran it: **12 matches in 7
files**, and **neither `repos/core/memories.rs` nor `commands/credentials/vector_kb.rs`
is among them** — its pattern keys on `INSERT|DELETE|UPDATE` against a
search-index table name shape that the `vec0` tables do not match. So there is
no overlap to decline for; there is a **recall gap**, reported to that path in
§12.3 rather than patched from here.

**What would actually work, and it is not a regex.** The condition is *"every
key in the derived store has a row in the source store"*, which is a **query,
not a pattern**. Specification, for whoever writes it:

```
scripts/check-derived-store-orphans.mjs   (specified, NOT written)
  for each declared (source_db.table.pk → derived_db.table.fk) pair:
      SELECT COUNT(*) FROM derived LEFT JOIN source ON … WHERE source.pk IS NULL
  exit 2 if the pair list is empty            (the instrument measured nothing)
  exit 2 if either table is missing           (the schema moved)
  exit 1 if any pair reports orphans          (the invariant broke)
  print every pair's count on success         (a zero that was actually checked)
```

The `exit 2` arms are the load-bearing ones, per the contract's fail-loud
requirement and the `check-csp-hosts.mjs` precedent — an orphan checker with no
pairs registered reports a clean bill of health forever. The declared pairs
today would be exactly two:
`personas.db:persona_memories.id → personas_data.db:persona_memory_embedding_meta.memory_id`
and `personas_data.db:knowledge_bases.id → kb_vec_<id>`.

The **better** answer, which outranks any gate (contract §"Prefer a type over a
gate"), is to remove the boundary. See §12.2.

---

## §12 — Corrections

**12.1 — To my brief, on which vectors are orphaned.** The brief said
`personas_data.db` *"still holds 5,158 vectors that were deliberately not purged
because deleting them needs the `sqlite-vec` extension"*, framed as this leaf's
subject. The count is exactly right and the attribution is not: those 5,158 are
**persona-memory** vectors (`persona_memory_embedding`), not **knowledge-base**
vectors. The KB store — the leaf's actual subject per the spine's `why` — holds
**0 vectors, 0 documents, 0 chunks, 0 knowledge bases, in the backup as well as
live**. The two live in the same file and share the `vec0` mechanics, the same
`UserDbPool`, the same `ml` gate and the same orphaning structure, which is why
the confusion is natural and why I have documented them together — but a reader
who goes looking for 5,158 KB chunks will not find them. Separately: the "needs
`sqlite-vec` to delete" reason holds for the `vec0` table and **not** for
`persona_memory_embedding_meta`, which is a plain table any build can `DELETE`
from — that is §7's point (b).

**12.2 — To [`second-database`](./second-database.md) §2, and it is the
substantive one.** That path prescribes *"Put it in the primary store"* and
carves out an exception: *"The second store exists for exactly two things —
vector indexes that need the `vec0` extension, and the companion brain."* **The
exception is what produced this leaf's defect.** The moment the vector left
`personas.db`, `persona_memories`' `ON DELETE CASCADE` stopped reaching it, and
one authorized purge orphaned 100 % of the corpus. The exception is not wrong —
`vec0` really is registered on the user pool — but it is stated as a cost-free
carve-out, and it is not. Suggested amendment: *"…and when you take the
exception, you have accepted a cross-store integrity obligation that no foreign
key will discharge; write the invariant down and check it at boot."*

**12.3 — To [`derived-index-sync`](./derived-index-sync.md), twice.** (a) Its
§0 counts *"twenty-one derived structures, one of them is checked"*. This pair —
`persona_memories` → `persona_memory_embedding` — is one of the twenty, and it
is now the first with a **measured divergence of 100 %**, which is worth adding
to that path's evidence. (b) Its census rule `hand-synced-search-index` does not
reach either vector store (12 matches / 7 files, none of them
`memories.rs` or `vector_kb.rs`). Its §2 prescription — *"count both sides at
boot"* — is exactly right for this pair and is the specification in §9 above.

**12.4 — To the spine: `convergence: "mixed"` is contradicted, and the cohort is
5 → 1.** I swept all five siblings (`personas-web` 1,088 files, `brainiac`
1,071, `personas-cloud` 48, `vibeman` 2,060, `ascent` 950) for `vec0`/`sqlite-vec`,
`pgvector`, embedding writes, and orphan/reconcile sweeps.

- `vec0`/`sqlite-vec`: **0 of 5**. `personas-web`'s single hit is marketing copy
  in `src/data/connectors.ts`.
- orphan/reconcile sweep: **0 of 5**.
- Persistent vector store with a parent relationship: **1 of 5** — `brainiac`.
  `vibeman`'s `src/lib/brain/embeddings.ts` is a *cache* in front of OpenAI or
  Ollama with no durable parent relationship, and `vibeman` is this repo's
  **ancestor** (dated twice by earlier composers), so it would not corroborate
  anyway.

So the effective cohort is **one independent sibling**, and it does not mix — it
**inverts**. `brainiac/migrations/0001_init.sql:104-109`:

```sql
CREATE TABLE memory_embeddings (
    memory_id             uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    embedding_version_id  int NOT NULL REFERENCES embedding_versions(id),
    embedding             vector NOT NULL,
    PRIMARY KEY (memory_id, embedding_version_id)
);
```

Same logical relationship as ours, expressed as **a foreign key in the same
database**. Orphaning is *unrepresentable* there. It needs no reconciler, no GC
sweep, no boot count, no cargo feature and no gate — and it has none of those
things, which is what the absence of a reconcile sweep in that repo actually
means. This is the strongest evidence shape the oracle produces (doctrine §5:
*cost, failure and inversion stay strongest*; agreement is weakest), and it is
not agreement — it is one independent codebase, in a different language, on a
different engine, **not having the problem because it did not take the
exception**. Report `convergence` for this leaf as **contradicted**: the label
says mixed, the measurement says one witness and it points the other way.

**12.5 — Against myself, on the second implementation.** My two orphan counts
agreed exactly (5,158 / 5,158 / 0 / 1,377), which per doctrine is *not*
soundness. I therefore ran a third check the two shared no code for: comparing
the vector id **sets** across the backup and live copies, which showed 5,158 of
5,158 ids identical. That is what rules out the rival hypothesis ("cleanup ran
and rewrote the table") that both count-based implementations would have been
blind to. Agreement between two counts is one measurement wearing two coats;
the set comparison is a different question.

**12.6 — A number I nearly published wrong.** `persona_memory_embedding_rowids`
has 5,158 rows and `SELECT COUNT(DISTINCT id)` returns **0** on it. That looks
like a corruption finding. It is not: `vec0`'s shadow `_rowids` table carries a
nullable `id` column that this schema does not populate (the table is declared
`vec0(memory_id TEXT, embedding float[384])` and keyed by rowid), and the app's
own mapping lives in the `_meta` sidecar. Read the writer before treating a
column name as a contract — doctrine §2, and it very nearly caught me.
