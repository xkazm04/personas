# lib/execution — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: Core Libraries & State | Files read: 11 | Missing: 0

## 1. Normal-mode sink flush is unthrottled — rebuilds up to a 10k-line array and pushes a store update per output event
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/lib/execution/executionSink.ts:130-135, 225
- **Scenario**: During a long streaming execution, every stdout event schedules a microtask flush (`append` → `queueMicrotask`). Tauri events arrive as separate tasks, so the microtask batching only coalesces lines within a single synchronous burst — in practice flush frequency ≈ event frequency. Once the ring is full, each flush calls `ring.toArray()` on a dirty ring (full O(10,000) array rebuild) and hands a fresh array identity to the Zustand store, re-rendering the terminal view.
- **Root cause**: Tail mode (post-truncation) is throttled to 500 ms via `scheduleTailFlush`, but normal mode has no throttle at all — the `toArray()` cache is invalidated by every `pushMany`, so it never helps on the hot path.
- **Impact**: At tens-to-hundreds of output lines/sec with a large buffer, this is repeated 10k-element array construction plus a React re-render of a 10k-line terminal per event burst — sustained CPU/GC churn exactly when the app is busiest.
- **Fix sketch**: Apply the same throttling discipline to normal mode that tail mode already has: after the first immediate flush, coalesce subsequent flushes into a `requestAnimationFrame` or a ~100–250 ms `setTimeout` window (reuse the `lastTailFlushTime`/`scheduled` pattern, generation-guarded). The visibility-gating logic in `scheduleTailFlush` can be shared. UI freshness at 4–10 Hz is indistinguishable for a scrolling terminal.

## 2. Six exported pipeline utilities have no callers anywhere in src/
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/execution/pipeline.ts:618, 649, 658, 663, 671, 685
- **Scenario**: `removeMiddleware`, `nextStage`, `stageIndex`, `hasPassedStage`, `traceDuration`, and `engineSpans` are exported but a repo-wide grep finds only their definitions (the `stageIndex` hits elsewhere are unrelated local variables in usePersonaCompiler/useAutomationSetup). No test files reference them either.
- **Root cause**: The "documentation-as-code" pipeline module accumulated speculative utility exports during the UnifiedTrace migration that never found consumers.
- **Impact**: ~60 lines of unused API surface in an already 715-line module; readers must assume these are load-bearing, and refactors must keep them working for nothing.
- **Fix sketch**: Delete the six functions (verify no dynamic access first — none found). If `removeMiddleware` is kept as the symmetric counterpart to `addMiddleware` for future HMR cleanup, keep only that one and drop the other five. Note: the `@deprecated` aliases `PipelineTrace`/`PipelineTraceEntry` (lines 278, 283) are NOT dead — 5 files still import them; either finish that rename or remove the deprecation markers.

## 3. ExecutionSink.reset() and clear() are byte-identical, and clear()'s doc comment is wrong
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/lib/execution/executionSink.ts:143-172
- **Scenario**: Both methods bump the generation, zero the batch/byte/tail state, unsubscribe visibility, and clear both rings — 14 identical lines each. `clear()` is documented as "Clear everything and notify the store", but it never calls `onFlush`; the caller (executionSlice.ts:739) does its own store update.
- **Root cause**: `clear()` was presumably meant to differ (flush an empty snapshot) but ended up a copy of `reset()`; the doc comment survived the divergence-that-never-happened.
- **Impact**: Any future change to reset semantics (e.g. a new field) must be applied twice; the misleading comment invites a caller to rely on a notification that never fires.
- **Fix sketch**: Keep one private `resetInternal()` and make `reset()`/`clear()` both delegate to it — or simply alias `clear = reset` and fix the doc comment. If store notification on clear is actually desired, add an explicit `this.onFlush?.([], 0)` and keep the two methods distinct for real.

## 4. onSystemTraceChange supports exactly one subscriber — a second subscription silently disconnects the first
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/lib/execution/systemTrace.ts:204-212
- **Scenario**: `_onSessionChange` is a single mutable slot. If two components each call `useSystemTrace` (which subscribes via `onSystemTraceChange`, src/hooks/execution/useSystemTrace.ts:18), the second mount overwrites the first callback; the first component's trace view silently stops updating. The first component's later unsubscribe is a no-op (`if (_onSessionChange === callback)` fails), which is correct but leaves the asymmetry hidden.
- **Root cause**: The registry was written for a single TraceInspector consumer and hard-codes that assumption into the subscription API instead of using a listener set.
- **Impact**: Latent breakage the moment a second trace-consuming surface mounts (e.g. a mini trace widget alongside the inspector); the failure mode is "UI just doesn't refresh", which is painful to diagnose.
- **Fix sketch**: Replace the slot with `const _listeners = new Set<() => void>()`; `onSystemTraceChange` adds to the set and returns `() => _listeners.delete(callback)`; every `_onSessionChange?.()` call site becomes `for (const l of _listeners) l()` (or a small `notify()` helper). Zero behavior change for the current single consumer.

## 5. timingMiddleware rescans all of localStorage and JSON.parses every timing entry on every execution completion
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: data-layer
- **File**: src/lib/execution/middleware/timingMiddleware.ts:68-87
- **Scenario**: `_pruneTimingEntries(50)` runs on every `frontend_complete`: it iterates the full `localStorage` keyspace (all app keys, not just timing keys), and for each of up to ~51 timing entries does a synchronous `getItem` + `JSON.parse` just to read `recordedAt`, then sorts.
- **Root cause**: Prune-by-scan instead of maintaining a small index; `recordedAt` is buried inside the JSON payload rather than being recoverable from the key.
- **Impact**: Bounded (≤51 parses + one keyspace walk) and on a cold-ish path, so cost is milliseconds — but it is synchronous main-thread work repeated after every execution, and it grows with unrelated localStorage usage.
- **Fix sketch**: Cheapest: only prune when a counter/every-Nth completion fires, or defer via `requestIdleCallback`. Better: keep a single `personas:stage-timings:index` JSON array of `{executionId, recordedAt}` maintained on write, so pruning reads one key and removes the overflow without parsing every entry.
