---
subject: retry-backoff
evidence:
  - src-tauri/src/engine/failover.rs                          # per-provider + global breaker, documented precedence, persisted w/ 15-min TTL rehydration
  - src-tauri/db/src/repos/execution/scheduled_retries.rs     # durable retry-at schedule incl. provider-stated usage-limit reset windows
  - src-tauri/core/src/error_taxonomy.rs                      # single classification authority; Unknown lane counted, not misfiled
  - src-tauri/src/engine/polling.rs                           # per-key ladder in a TTL+LRU-bounded map with a stale-key sweep
counter_evidence:
  - src-tauri/src/engine/oauth_refresh.rs                     # the durable ladder with no attempt cap and no terminal state — durability without boundedness
deviations:
  - w2-retry-backoff   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Retry Backoff - evidence

How this codebase measures against the [`retry-backoff`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
