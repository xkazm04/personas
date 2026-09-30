---
subject: sync-replication
evidence:
  - src-tauri/src/cloud/sync/mod.rs                       # periodic tick + lossy wake + persistent dirty flag; per-table fault isolation; status snapshot; tombstone cascade with hold-on-failure
  - src-tauri/src/cloud/sync/cursor.rs                    # durable per-stream cursors in the settings store; bounded first backfill (epoch vs 90-day per table); peek vs get so "never synced" stays distinguishable
  - src-tauri/src/cloud/sync/rows.rs                      # secret-free projections (SELECTs structurally never read vault/encrypted columns); payload sanitization (key + value heuristics, size bound); tombstone reads
  - src-tauri/src/commands/obsidian_brain/conflict.rs     # three-way compare on content hashes; ConvergedConflict as a distinct outcome from NoChange, with the audit-trail rationale written down
  - src-tauri/engine/src/workspace_sync/merge.rs          # deterministic LWW scoped to same-user devices (total function: modified_at, tie by device id); tombstone as a first-class enum variant; generic over snapshot types
  - src-tauri/engine/src/workspace_sync/snapshot.rs       # allowlist-by-construction projection ("a secret field simply has no home on this struct"); content hash excludes the LWW timestamp
  - src-tauri/engine/src/workspace_sync/crypto.rs         # encrypted payloads: HKDF-derived shared key per device group, sealed snapshots for the untrusted transport
  - src-tauri/src/companion/brain/sync_staging.rs         # staged inbound changes: single consumer (the reconcile phase), mark-processed-not-delete, no force-write path into memory
counter_evidence:
  - src-tauri/src/cloud/sync/mod.rs                       # ALSO the key counter-example: process_tombstones advances its cursor from a clock read captured at tick start (the exact race the table path's own comment fixes 110 lines earlier) and discards the write's Result; and the tombstone table it reads has no producer — the whole delete cascade is dead code that reads as shipped
deviations:
  - w8-sync-replication   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Sync Replication - evidence

How this codebase measures against the [`sync-replication`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
