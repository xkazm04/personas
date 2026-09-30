---
subject: table
evidence:
  - src/features/shared/components/display/UnifiedTable.tsx   # canonical table primitive: chrome/body split, three-state body, identity keys, windowing
  - docs/design/overview-loading.md                           # the five loading laws this subject's state model matches
  - src-tauri/db/src/repos/orchestration/team_assignments.rs  # keyset pagination with composite (created_at, id) tiebreaker
counter_evidence:
  - src/features/settings/sub_byom/components/ByomAuditLog.tsx  # the canonical primitive retyped by hand — the drift the standard exists to prevent
deviations:
  - table-no-error-state              # anchors in docs/concepts/golden-path-deferred-fixes.md
  - table-default-sort-comparator
  - table-forbidden-split-unguarded
  - table-recent-slice-tiebreaker
---

# Table - evidence

How this codebase measures against the [`table`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
