---
subject: client-state
evidence:
  - src/stores/slices/processActivitySlice.ts                  # keyed status FSM: exhaustive vocabulary, per-run keying, separator guard, stale reaper
  - src/stores/agentStore.ts                                   # sliced composition + persistence allowlist (partialize) + in-band shape migration
  - src/stores/util/latestWins.ts                              # the latest-wins token guard, centralized so the comparison direction is right once
  - src/lib/utils/deduplicateFetch.ts                          # in-flight dedup keyed by argument; entry removed on settle (success AND failure)
  - src/stores/util/dedupedStorage.ts                          # storage write dedup: compare serialized payload before writing
  - src/lib/execution/executionSink.ts                         # generation counter making stale singleton copies inert (module const, no global)
  - src/features/teams/sub_mastermind/lib/sceneStore.ts        # per-family status FSM incl. stale-on-failed-reload; surgical invalidation; refetch floors
  - src/stores/slices/agents/matrixBuildSlice.ts               # domain drafts persisted to the app's real datastore, not client storage
  - docs/concepts/golden-paths/hmr-safe-singletons.md          # measured singleton census: 25 global keys / 13 state slots; refcount-vs-latch discriminator
counter_evidence:
  - src/stores/slices/system/tourSlice.ts                      # slice hand-rolls its own storage key beside the store's persist layer — two writers for one persisted state
deviations:
  - w3-client-state   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Client State - evidence

How this codebase measures against the [`client-state`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
