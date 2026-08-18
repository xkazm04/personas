---
layer: application
subject: perf-instrumentation
technique: ring-buffer-metrics
stack: react
---

# Ring-buffer metrics — the IPC call ring

`src/lib/ipcMetrics.ts` (~160 lines) is the technique nearly clause for
clause, in the **shared-ring-grouped-at-read** shape: one 500-record ring
for every IPC call the app makes, per-command statistics derived by
partitioning the window when a panel asks.

## The bound and the write path

```ts
const RING_SIZE = 500;
const ring: IpcCallRecord[] = [];
let writeIndex = 0;
```

`recordIpcCall` is constant-time — push-or-overwrite at `writeIndex`,
advance modulo `RING_SIZE`, bump counters, notify listeners. No sorting,
no formatting, no allocation beyond the record itself. It is called from
exactly one place: `src/lib/tauriInvoke.ts`'s `Promise.race` settlement
branches, i.e. the single chokepoint every measured call already flows
through (the ESLint `no-restricted-imports` rule that forces all IPC
through `invokeWithTimeout` is, incidentally, what guarantees the
instrument's coverage).

## Lifetime facts live outside the ring

The file documents the eviction-honesty rule in its own comment:

```ts
// Cumulative counters for LIFETIME rates. The ring only holds the last
// RING_SIZE calls, so deriving a global timeout/error rate from it is wrong
// once more than RING_SIZE calls have happened ...
let totalTimeouts = 0;
let totalErrors = 0;
```

`getGlobalSummary()` derives `timeoutRate`/`errorRate` from these
never-evicted counters against `totalRecords`, while the percentiles stay
windowed "by necessity: they need the retained duration samples" — the
two claims (lifetime rate, windowed percentile) kept separate exactly as
the technique demands.

## Statistics derived at read time, method stated

`percentile()` is nearest-rank on a sorted copy
(`Math.ceil((p/100) * n) - 1`), used for p50/p95/p99 in both
`computeCommandStats()` (per-command partition of the window) and
`getGlobalSummary()`. Nothing statistical is stored; everything is
recomputable from the ring — a new percentile or a new outcome filter is
a read-time change.

## The shared-window trade, visible in the UI

Because the ring is global, a chatty command can evict a quiet command's
samples — the per-key-window starvation the technique names as this
shape's cost. The mitigation is disclosure:
`IpcPerformancePanel.tsx` (`src/features/overview/sub_observability/components/`)
renders `count` as its own sortable column beside p50/p95/p99, and
subscribes via `useSyncExternalStore` keyed on `getIpcTotalCount()`, so
derivation runs only when the window actually changed and only while
someone is looking.

## Cross-layer confirmation

`src-tauri/db/src/perf.rs` is the same shape one layer down, arrived at
independently: a 2048-sample shared ring of query timings, grouped
per-table at `snapshot()` time, nearest-rank p95 on a sorted copy — and
it goes one disclosure further, exporting `buffer_capacity` and
`buffer_used` in the snapshot itself so the window predicate travels
with the data.
