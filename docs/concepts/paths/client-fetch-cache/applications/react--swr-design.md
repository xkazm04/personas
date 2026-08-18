---
layer: application
subject: client-fetch-cache
technique: swr-design
stack: react
---

# Stale-while-revalidate in this repo — the primitive family

The repo's canonical SWR primitive is
[`src/lib/utils/staleWhileRevalidate.ts`](../../../../../src/lib/utils/staleWhileRevalidate.ts)
(`createSWRFetcher`), and it demonstrates most of the technique in ~110
lines:

- **Fresh zone** — `now - cached.fetchedAt < ttlMs` returns the entry with
  no fetch (`{ data, fromCache: true }`). Default TTL 30s
  (`DEFAULT_TTL_MS`), overridable per fetcher — TTL is declared per cache,
  not inherited globally.
- **Stale zone** — a stale hit returns the cached value *synchronously*
  while the revalidation promise runs behind
  (`promise.catch(silentCatch(...)); return { data: cached.data, fromCache: true }`).
- **Fused dedup** — the `_inflight` map is checked before launching, so N
  stale readers in one paint share one background flight; entries are
  removed in `.finally()` (both settle paths). This is
  [in-flight-dedup](../techniques/in-flight-dedup.md) built directly into
  the SWR read path, as the technique requires.
- **Eviction** — `MAX_CACHE_ENTRIES = 500` with insertion-order eviction;
  the delete-then-set on write refreshes a key's position, approximating
  LRU. The header comment states the reason verbatim: "TTL only gates
  freshness, not retention" — expiry is not eviction.
- **Failure keeps stale truth** — a failed background refresh never
  touches `_cache`; the stale entry keeps serving, and the failure goes to
  the background-error door. Because the cache write lives in `.then()`,
  a failure also never stamps freshness — the retry window stays open.
- **Invalidation surface + hatch** — `invalidateSWRCache(key)` is the door
  a pushed event drives; `clearSWRCache()` is the test-reset hatch.

## The seam family around it

The technique's "one primitive per seam" rule is visible here as a
*documented* division of labor — and also as its failure mode:

- `invokeWithTimeout` (`src/lib/tauriInvoke.ts`) carries a 250ms in-flight
  auto-dedup at the IPC seam — same-tick burst collapse for every command,
  below any cache.
- [`src/lib/async/createCachedFetch.ts`](../../../../../src/lib/async/createCachedFetch.ts)
  is the slice-seam controller: in-flight collapse + a freshness timestamp
  for data whose *storage* is a Zustand slice. Its doc comment explicitly
  positions it against the transport auto-dedup, and it stamps freshness
  only on success ("a failed fetch is never cached — the next caller
  retries").
- [`src/lib/async/createTtlValueCache.ts`](../../../../../src/lib/async/createTtlValueCache.ts)
  is the value-holding variant for `useState`-resident data, with per-key
  `delete()` as its invalidation door.
- `deduplicateFetch.ts` / `deduplicateKeyedFetch` is bare keyed dedup with
  no freshness at all.

Four-plus primitives with adjacent remits is the proliferation the golden
path warns about: the legacy corpus sweep of this area
(`docs/concepts/golden-paths/shared-fetch-cache.md`) found **71**
cache-shaped module containers and discovered two of the five shared
primitives only *after* its counts were locked — even a deliberate audit
missed members of the family. The seams are individually well-documented;
the *set* has no single index, which is the residual gap.

## Deviations observed (standard kept; not fixed here)

- `createSWRFetcher` has **no stale ceiling**: any-aged entry within the
  500-entry cap serves as the instant answer. The technique requires a
  hard miss threshold so week-old data cannot paint as truth.
- The background-refresh failure is routed to the silent error door only;
  the caller's `fromCache` flag says "showing cache" but there is no
  "last refresh failed" fact exposed for a surface to report — the two
  facts the technique says must stay separately available are one fact
  and a log line here.
- `deduplicateKeyedFetch` derives keys via naive argument serialization
  (`JSON.stringify(args)`) — fine for today's scalar callers, but
  non-canonical for object arguments (field-order fragmentation) per
  [cache-key-discipline](../techniques/cache-key-discipline.md).
