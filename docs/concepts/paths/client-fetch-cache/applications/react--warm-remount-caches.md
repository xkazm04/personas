---
layer: application
subject: client-fetch-cache
technique: warm-remount-caches
stack: react
---

# Warm remount caches in this repo — the loading-v2 law 4 precedents

The app's sections are lazy routes that unmount fully on navigation, so
"warm remount" is codified as law 4 of the loading doctrine
(`docs/design/overview-loading.md`): *a view that fully unmounts on
nav-away keeps its last fetch in a module-scoped cache keyed by entity so
a remount paints warm, not a re-ghost.* Two precedents carry it:

## CompetitionList — the keyed single slot

[`src/features/plugins/dev-tools/sub_lifecycle/competitions/CompetitionList.tsx`](../../../../../src/features/plugins/dev-tools/sub_lifecycle/competitions/CompetitionList.tsx)
is the technique's "minimal honest form" — a single slot plus the key it
belongs to:

```ts
let cachedProjectId: string | null = null;
let cachedCompetitions: DevCompetition[] = [];
```

- **Warm paint**: `useState(() => warmForProject ? cachedCompetitions : [])`
  seeds the first render synchronously; `loading` starts `false` on a warm
  return so cards paint on frame 1.
- **Key comparison carries correctness**: `warmForProject` requires
  `activeProjectId === cachedProjectId` — the comment states the rule as
  the technique does: "project A's list must never flash under project B."
- **Always revalidates**: the mount effect refetches regardless; the warm
  data only bridges the gap, and `loading` "only ever gates the
  ghost/empty branch, never the cards already on screen."

## LifecyclePage — the unkeyed slot, correctly unkeyed

[`src/features/plugins/dev-tools/sub_lifecycle/LifecyclePage.tsx`](../../../../../src/features/plugins/dev-tools/sub_lifecycle/LifecyclePage.tsx)
caches `cachedDevClone` / `cachedTriggers` with no key. That is *correct*
here, not an omission: the dev-clone persona is located by an app-global
search (`listPersonas()` + name match), not a per-project query, so there
is no scope axis to key by. Same always-revalidate shape: `refresh()` runs
on every mount; the cache seeds `useState` and `everLoaded` so only a
first-ever visit sees the cold ghost.

## The extracted primitive

[`src/lib/async/createTtlValueCache.ts`](../../../../../src/lib/async/createTtlValueCache.ts)
is the pattern promoted to a shared primitive — module-scoped `{ value, at }`
per key, freshness-gated `get`, per-key `delete` as the invalidation door,
`clear()` as the reset hatch. Its doc comment names its own lineage (the
inline `configCache` and `lastPipelineRun` precedents) and the division of
labor: it exists precisely for `useState`-resident data that dies with the
view, where a timestamp-only gate would skip the refetch *and* have no data
to show — the exact failure the technique's "ageless latch" warning
describes.

## The second extracted primitive — the one for the map, not the slot

The technique above notes that the single-slot form is deliberate, and to
"reach for the map only when the working set genuinely holds several scopes
at once." [`src/hooks/utility/data/useModuleSubscription.ts`](../../../../../src/hooks/utility/data/useModuleSubscription.ts)'s
`createModuleCache` is that map's shared primitive — found late (added to
this evidence base 2026-08-30; see `shared-fetch-cache.md` §12 item 10 for
how the earlier sweep missed it). It is a stronger fit than
`createTtlValueCache` for the multi-entry case specifically because it
satisfies the "Keyed and bounded" obligation above in one construction:
`{ ttlMs, maxSize }` at creation gives both a freshness window *and* an
eviction order (expired entries first, then least-recently-written), where
`createTtlValueCache` has no `maxSize` and must not be used for a key
population that grows with every entity the user visits. It also pairs a
`useModuleSubscription`/`useModuleCacheSubscription` hook
(`useSyncExternalStore`-based) so a component re-renders on `notify()`
without a manual re-render kick — useful when several components read the
same cache and one mutation needs to reach all of them.

**Division of labor going forward:** `createTtlValueCache` remains correct
for an existing single/few-key adopter; a *new* module-scoped cache whose
key space is an entity id (project, credential, file, …) should be built on
`createModuleCache` with an explicit `maxSize`, not a hand-rolled `Map`.

## Deviations observed (standard kept; not fixed here)

- The hand-rolled slots (both files above) revalidate on every mount —
  good — but expose **no invalidation door and no test-reset hatch**: a
  deletion event elsewhere cannot drop the cached list, and module state
  leaks between test cases. The extracted primitive has both doors; the
  precedents predate it.
- `useCertificationData.ts` (the idle-defer precedent for
  [prefetch-and-defer](../techniques/prefetch-and-defer.md)) guards its
  deferred first load with an **ageless latch**
  (`certLastRefreshedAt || certStatus.length > 0` — truthiness, not age):
  within a session the tab never refetches on remount unless something
  else invalidates the slice. The technique requires the guard to be a
  freshness check, not "has this ever loaded."
- `reviewParseCache.ts` (the derive-cache precedent) memoizes
  `verification` and `readinessScore` against ambient inputs (installed
  connectors, credential sets) that are **not part of the key** — a
  hidden-axis case per
  [parse-and-derive-caches](../techniques/parse-and-derive-caches.md);
  the scores go stale if those sets change while the review object lives.
  Its `WeakMap` keying, on the other hand, is the technique's
  GC-as-reaper form working as designed.
