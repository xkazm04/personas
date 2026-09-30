---
subject: embedded-db
evidence:
  - src-tauri/db/src/lib.rs                                      # pool construction (sized in a reasoned comment, 5s acquire timeout), acquire_logged instrumentation, STANDARD_PRAGMAS one-authority batch, gauge-gated idle maintenance task
  - src-tauri/db/src/perf.rs                                     # shared latency ring keyed by table, read-time p95, slow-query warn budget with suppression summary
  - src-tauri/db/src/vector_store.rs                             # extension auto-registration BEFORE pool creation, ordering rationale in the doc comment
  - src-tauri/src/commands/infrastructure/system/storage.rs      # usage report + dry-run-default prune with 24h age floor and terminal-state allowlist
  - src-tauri/db/src/backup.rs                                   # journal sidecars named in backup scope (SIDECAR_EXTENSIONS)
counter_evidence: []
deviations:
  - w9-embedded-db   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w1-migrations   # the second database operated without the first one's discipline — registered under migrations
---

# Embedded Db - evidence

How this codebase measures against the [`embedded-db`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
