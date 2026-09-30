---
subject: client-fetch-cache
evidence:
  - src/lib/utils/staleWhileRevalidate.ts                                        # SWR: fresh window, stale-serve + background revalidate, fused keyed dedup, 500-entry insertion-order eviction, invalidate door, test clear hatch
  - src/lib/utils/deduplicateFetch.ts                                            # keyed in-flight dedup; settle-time removal on success AND failure
  - src/lib/async/createCachedFetch.ts                                           # slice-seam dedup + TTL; freshness stamped only on success; declares its seam vs the transport-level auto-dedup
  - src/lib/async/createTtlValueCache.ts                                         # module-scoped value cache with TTL + per-key invalidation, extracted from two inline precedents
  - src/hooks/utility/data/useModuleSubscription.ts                              # createModuleCache: keyed module cache with TTL + maxSize eviction + invalidate/invalidateAll, paired useSyncExternalStore subscription hook; preferred for multi-entry value caches (added 2026-08-30, found late — see shared-fetch-cache.md §12.10)
  - src/features/plugins/dev-tools/sub_lifecycle/LifecyclePage.tsx               # warm-remount precedent (unkeyed, correct: data is app-global); always revalidates on mount
  - src/i18n/useTranslation.ts                                                   # intent prefetch with debounce delay + cancel; loads explicit, read path pure (render-storm lesson)
  - src/features/templates/sub_generated/gallery/cards/reviewParseCache.ts       # reference-keyed derive cache; weak map makes GC the reaper; lazy heavy tiers on expansion
  - src/features/agents/sub_deployment/components/cloud/CloudHistoryPanel.tsx    # TTL + cap output cache; expiry sweep on write, LRU via re-insertion
counter_evidence: []
deviations:
  - w10-client-fetch-cache   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Client Fetch Cache - evidence

How this codebase measures against the [`client-fetch-cache`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
