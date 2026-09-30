---
subject: concurrency-guards
evidence:
  - src-tauri/engine/src/inflight_guard.rs                     # the reusable keyed in-flight set: atomic acquire, RAII handle, panic-unwind release proven by test, poison recovery — adopted by 14 statics
  - src-tauri/src/lib.rs                                       # ActiveProcessRegistry::try_begin — atomic claim per flow-kind domain, clear_id_if verified release, begin_run supersede-with-fresh-token
  - src-tauri/src/commands/credentials/ai_artifact_flow.rs     # panic-safe wrapper (catch_unwind → clear_id_if + failure event); incumbency check get_id != task_id before applying results
  - src-tauri/src/engine/leadership.rs                         # cross-process heartbeat lease (engine-leader.lock): stale takeover, follower re-attempt per tick
  - scripts/build/guard-concurrent-cargo.mjs                   # stateless population check over live processes; fail-open LOUDLY, direction documented in the header
  - src/lib/utils/deduplicateFetch.ts                          # join-the-result single-flight keyed by args; release bound to promise settle via finally
  - src-tauri/engine/src/oauth_refresh_lock.rs                 # per-entity queue-behind policy (await the twin) where both refreshes must eventually run exactly once each
counter_evidence: []
deviations:
  - w9-concurrency-guards   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Concurrency Guards - evidence

How this codebase measures against the [`concurrency-guards`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
