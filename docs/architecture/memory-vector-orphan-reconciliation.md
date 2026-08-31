# Memory-vector orphan reconciliation

**Status:** implemented 2026-08-30 · **Register:** deferred-fixes #108 ·
**Registry:** `software-engineering/entity-lifecycle/orphan-reconciliation`
(negative specimen: the registry's `rust--orphan-reconciliation` application,
forged from this tree's 2026-08-17 purge incident).

## Current state (what the incident proved)

Persona memories live in `personas.db`; their embeddings live in a separate
vector database file (`persona_memory_embedding` vec0 table + the
`persona_memory_embedding_meta` sidecar, `db/src/repos/core/memories.rs:1806-1832`).
`persona_memories.persona_id` cascades inside `personas.db`
(`db/src/migrations/schema.rs:527`), but no cascade can cross the file
boundary — vector cleanup is an application-level reaper.

- **No reaper registry.** Of the 8 doors that delete a memory, 3 remember the
  vector companion (`batch_delete` :959, `merge` :1348, the archive path
  :1074) and 5 forget it (`crud_delete!("persona_memories")` :1154,
  `delete_non_core` :1162, `delete_all` :1180, the boot scrub
  `cleanup_orphan_rows` `db/src/lib.rs:481`, and the persona FK cascade via
  `personas::delete` `db/src/repos/core/personas.rs:1804`, which *cannot* call
  Rust). Each door remembers or forgets independently.
- **Failure is quiet.** `spawn_delete_memory_embeddings` (:1775) silently
  no-ops when the recall runtime or a tokio handle is absent, and logs an
  actual failure at *debug*. Nothing flows back to the door; no durable record
  of the owed cleanup exists.
- **Every sweep runs parent-first.** `gc_archived_memory_embeddings` (:2094),
  `backfill_memory_embeddings` (:2157), and `cleanup_orphan_rows` all
  enumerate the relational side. An orphan is by definition absent from that
  side. Measured result (2026-08-17): after an authorized purge,
  `persona_memories` = 0 rows while all **5,158 vectors survived — a 100%
  orphaned store** — and every sweep reported clean.

## Target shape (the technique, adapted)

One new module, `db/src/repos/core/memory_reaper.rs`, feature-gate-neutral
(plain SQL; only the *spawn* path needs the ml runtime):

1. **Reaper registry** — `MEMORY_REAPERS: &[ReaperEntry]`, one enumerable
   structure, one entry per dependent store (`vector_embeddings` today: chunked
   `DELETE` from `persona_memory_embedding` + `_meta`, idempotent, tolerant of
   an absent table). The cascade iterates it, the receipt/logs name entries by
   it, and the sweep derives its work from it. Adding a dependent store = one
   entry. The ml `delete_memory_embeddings` delegates to the same registry
   entry (one implementation of the delete).
2. **Durable orphan ledger** — `memory_reaper_ledger` table in the **main DB**,
   owned by the migration chain (`migrations/incremental/e15_memory_reaper_ledger.rs`
   — moved there from a lazy repo-layer CREATE during implementation, per the
   hand-rolled-fixture-ddl census rule: schema lives with the schema owners),
   carrying **no foreign keys** so no entity cascade can reach it: `memory_id PRIMARY KEY, display_name, pending`
   (JSON array of owed reaper names), `attempts, first_recorded_at,
   last_attempt_at`. Re-recording merges (upsert); an empty `pending` set
   resolves (row deleted). **Write-ahead adaptation:** because the reapers are
   fire-and-forget async, the door records the debt *before* spawning them
   (while the parent's id and title are still in scope) and the reaper task
   resolves its entry on success — strictly stronger than record-on-failure:
   it also survives a crash mid-reap and covers lite builds, where the reaper
   cannot run at all. Reaper failures log at **warn** with a constant message
   + fields, and leave the ledger row standing.
3. **The cascade door** — `run_memory_reapers(pool, victims)` replaces the
   three `spawn_delete_memory_embeddings` call sites and is added to the doors
   that had no companion: the hand-written `delete` (replacing the
   `crud_delete!` macro), `delete_non_core`, `delete_all` (which now captures
   the victim ids/titles before deleting), `personas::delete` (captures the
   persona's memory ids before the FK cascade destroys them), and
   `cleanup_orphan_rows` (records owed cleanup for the `persona_memories` rows
   it scrubs — record-only there; the sweep drains it). **Implementation
   deviation, deliberate:** the archive door runs the reapers *unledgered*
   (`run_memory_reapers_unledgered`) because its parent row SURVIVES — an
   orphan-ledger record would be resolved by the drain's existence check
   without deleting the vector; the parent-first archived-GC sweep is the
   correct repair direction when the relational row still exists. Each invocation first
   **piggybacks a bounded ledger drain** (existence-checked re-run of owed
   reapers) so transient outages self-heal on the next delete without a
   scheduler.
4. **Dependent-side sweep** — `reconcile_memory_vector_orphans(main_pool,
   vec_pool, mode, limit)`: enumerates the *dependent* store
   (`persona_memory_embedding` ∪ `persona_memory_embedding_meta` memory_ids)
   and asks, per id, whether `persona_memories` still holds its owner; also
   drains the ledger (a candidate whose parent exists is resolved without
   deleting — the existence check makes a recreated id safe). Modes:
   - **Report (default): deletes nothing**, returns and logs the full
     accounting **even when it is zero** (a reconciler whose only output is
     silence is indistinguishable from one that never ran — register #108).
   - **Apply**: runs the registry reapers over the orphaned ids; idempotent —
     a second run finds nothing.
   Boot (`src/boot/vector_kb.rs`, ml builds) runs the sweep in **report mode**
   and logs the orphan count. Nothing is ever removed by looking; apply mode
   over pre-ledger orphans (the standing 5,158) stays operator-invoked (the
   register's "why held" rule).

## Steps

1. Add `memory_reaper.rs`: registry, ledger (ensure/record/resolve/attempt/
   pending), `run_memory_reapers`, sweep, unit tests (plain-table stand-ins
   for the vec tables so the tests run without the ml feature).
2. Move the chunked two-table delete out of ml-gated
   `delete_memory_embeddings` into the registry entry; delegate.
3. Rewire the six memory-repo doors + `personas::delete` +
   `cleanup_orphan_rows`; delete `spawn_delete_memory_embeddings`.
4. Boot report-mode sweep in `boot/vector_kb.rs`.

## Out of scope

- Deleting the pre-existing 5,158 orphans (operator-invoked apply only).
- A Tauri command / UI surface for the sweep (follow-up; the boot report gives
  the visibility the register asked for first).
- Un-gating the ml embedding pipeline for lite builds (the ledger now records
  the debt lite builds cannot pay; an ml boot drains it).
- Other dependent stores (KB indexes have their own reconciler).

## Acceptance checks

- A memory deleted through **every** door (delete, delete_non_core,
  delete_all, batch_delete, merge, archive, persona delete) leaves either no
  vector rows or a pending ledger row naming `vector_embeddings` — witnessed
  by unit tests per door using plain-table vec stand-ins.
- Ledger: upsert merges; resolve on empty pending; a parent that still exists
  resolves without any delete.
- Sweep report mode returns the orphan count and deletes nothing; apply mode
  deletes exactly the orphans and is idempotent (second run = 0).
- `cargo check -p personas-db` clean; scoped `cargo test -p personas-db
  memory_reaper` green; census ratchet does not rise (constant-message
  tracing, `get_or_init` on once-cells).
