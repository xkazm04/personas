---
subject: scheduling
evidence:
  - src-tauri/core/src/scheduler.rs          # next-run computation: one tz policy, anchored intervals, bounded slot enumeration
  - src-tauri/src/engine/background/       # reconciliation tick, overlap skip-with-signal, backfill claims, EventGateLedger
counter_evidence:
  - src/features/triggers/lib/eventReason.ts # non-fire reason vocabulary hand-duplicated from the backend enum ("keep in sync")
deviations:
  - scheduling-dup-nonfire-vocab      # anchors in docs/concepts/golden-path-deferred-fixes.md
  - scheduling-tz-fallback
  - scheduling-claims-without-identity
  - scheduling-subscription-health-volatile
---

# Scheduling - evidence

How this codebase measures against the [`scheduling`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
