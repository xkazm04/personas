---
subject: undo-history
evidence:
  - src-tauri/src/webbuild/versions.rs                                     # checkpoint exemplar: snapshot per turn, files-only restore that keeps history and commits forward
  - src/features/studio/StudioVersions.tsx                                 # the restore surface: browse turn snapshots, one-click non-destructive restore
  - docs/concepts/golden-paths/undo-persisted-operation.md                 # measured census of persisted-side reversibility: capture-bypass, unkeyed journal rows, unreachable undo
counter_evidence:
  - src-tauri/db/src/backup.rs   # boot-rotating 3-set backup: evicted every pre-incident snapshot within hours — retention with no thinning or pinning
deviations:
  - w7-undo-history   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Undo History - evidence

How this codebase measures against the [`undo-history`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
