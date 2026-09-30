---
subject: background-jobs
evidence:
  - src-tauri/src/engine/background/        # the supervisor: unified roster (start_loops), startup sweeps, generation-bumped stop_loops, SubscriptionHealth
  - src-tauri/src/engine/subscription/      # the registration door (ReactiveSubscription) + run_single: panic boundary, adaptive 2s/10s cadence, wake-signal hybrid, panic backoff
  - src-tauri/src/engine/leadership.rs        # heartbeat-lease ownership claim across concurrent processes (engine-leader lock, stale takeover)
  - src/hooks/utility/timing/usePolling.ts    # client-side cadence: visibility pause, error backoff via predicate gate, shared coordinator heartbeat
  - src/features/plugins/obsidian-brain/sub_revitalize/useRevitalizeJob.ts  # job contract: snapshot re-attach, bounded log ring, id-filtered terminal events
counter_evidence:
  - src-tauri/src/engine/curation_scheduler.rs  # a recurring loop hosted OUTSIDE the roster (raw spawned sleep-loop at boot): no panic barrier, no health snapshot, no generation retirement
deviations:
  - w2-background-jobs   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Background Jobs - evidence

How this codebase measures against the [`background-jobs`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
