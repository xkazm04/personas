---
subject: fleet-orchestration
evidence:
  - src-tauri/src/commands/fleet/registry.rs      # the one registry: guarded transition methods, output rings, lineage adoption
  - src-tauri/src/commands/fleet/types.rs         # closed state vocabulary + token round-trip (unknown token → skipped, never mislabelled)
  - src-tauri/src/commands/fleet/stale.rs         # staleness ticker: per-provenance activity signals, spurious-await revival, live-slot eviction
  - src-tauri/src/commands/fleet/persist.rs       # durable mirror piggybacking the two emit points; rehydrate + recover_after_restart
  - src-tauri/src/commands/fleet/run.rs           # harvest: run identity stamped at spawn, declared-summary-only aggregation
  - src/features/fleet/monitor/monitorModel.ts    # fleet-level derived view: priority-resolved read model over the registry vocabulary
counter_evidence:
  - src-tauri/src/commands/fleet/external.rs      # the deliberately non-addressable lane — handle dropped by written design; the exception that proves the registry rule
deviations:
  - w4-fleet-orchestration   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Fleet Orchestration - evidence

How this codebase measures against the [`fleet-orchestration`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
