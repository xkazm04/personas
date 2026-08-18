---
layer: application
subject: markdown-vault
technique: mirror-indexes
stack: rust
---

# Mirror indexes between app database and vault (Rust)

`src-tauri/src/commands/obsidian_brain/mod.rs` hosts both directional
contracts side by side over one ledger (`sync_state`, keyed
`(entity_type, entity_id)`): a one-way knowledge **projection** into the
vault, and two-way **sync** for memories/personas/connectors. The live
integration tests in `mirror_tests.rs` exercise the projection against a
real temp vault and migrated temp DB — no mocks.

## The projection lane (one-way)

`mirror_write_note` (`mod.rs:344-386`) is the hash-gated incremental
primitive: compute the content hash, compare against the ledgered hash for
this entity, skip when equal (`Ok(false)`), else `atomic_write` and upsert
the ledger plus a sync-log row. `mirror_tests.rs::mirror_write_note_is_incremental`
(`:68-87`) pins the contract: first write → created; unchanged → skipped;
changed → written.

`mirror_execution_knowledge_for_persona` (`:415-454`) shows the posture
around it: gated on the mirror toggle and a configured vault, and
**best-effort by declaration** — "errors are logged, never returned —
knowledge mirroring must never break the execution path" (`:410-414`). The
named rebuild exists as a first-class command:
`obsidian_mirror_backfill_execution_knowledge` (`:459-469`), invoked when
the user first enables the mirror so pre-existing rows appear without
waiting for each persona to run again — the derivation naming its
recomputation, wired to the moment doubt is highest.

The confessed gap is real here too: the skip-gate reads the ledger, not the
disk. A mirrored note deleted in Obsidian stays "current" in `sync_state`
and is skipped on every subsequent pass until the source row changes. The
projection tolerates this as disposable output; nothing yet reconciles
ledger against disk — the declared-or-reconciled fork the technique
requires is currently resolved by declaration only.

## The sync lane (two-way)

Push (`obsidian_brain_push_sync`, `:528+`) never overwrites blind: for each
tracked entity it loads the ledgered base hash and routes through
`classify_push` (`:837-850`), which reads the current vault file and runs
`three_way_compare` (`conflict.rs:36-81`) — base vs app content vs vault
content. Only-app-moved pushes; only-vault-moved defers to pull; both-moved
mints a `SyncConflict` row carrying both contents plus all three hashes,
persisted for the human to resolve (`obsidian_brain_resolve_conflict`,
`mod.rs:1258+`, which routes the chosen side back through the vault-path
funnel before writing).

The audit nicety the technique calls out is implemented literally:
`ThreeWayResult::ConvergedConflict` (`conflict.rs:15-30`) — both sides
changed *and* landed identical — is a distinct variant rather than
`NoChange`, "surfaced as a confirmation toast … so the audit trail records
'both sides edited X and ended up identical'", with a dedicated test
asserting it never collapses into no-change (`:116-134`).

Content hashes are the record identity throughout: `compute_content_hash`
(`markdown.rs:225-228`), SHA-256 with a `sha256:` prefix so the ledger's
values name their own algorithm.

## Same pattern, higher stakes, elsewhere in the repo

The companion brain runs the inverse topology — the durable store is the
database, with markdown as the human-facing surface — and layers provenance
discipline on top; that ground is documented under agent-memory's
applications rather than re-derived here. This file's lane is the vault-
authoritative direction: vault as the shared store, database rows as the
derived ledger.
