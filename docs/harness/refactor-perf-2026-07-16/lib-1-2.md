# lib [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 2 medium / 3 low)
> Context group: Core Libraries & State | Files read: 18 | Missing: 0

## 1. Debounce timers in AUTH_STATE_CHANGED / PERSONA_HEALTH_CHANGED are not cleared on teardown
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/lib/eventBridge.ts:192-223 (also 760-777)
- **Scenario**: `teardownAllListeners()` runs (HMR, logout, test isolation) while an auth or persona-health debounce timer is pending (100ms / 300ms windows). The Tauri unlisten detaches the listener, but the already-scheduled `setTimeout` still fires and calls `useAuthStore.setState(...)` / `fetchPersonaSummaries()` into a store that was just reset.
- **Root cause**: These two registrations return only the Tauri `unlisten` handle; the closure's `debounceTimer` has no companion cleanup function. The NETWORK_SNAPSHOT_UPDATED registration (lines 745-752) was explicitly fixed to return a second unlistener that cancels its throttle timer and drops the pending payload — with a comment explaining exactly this "teardown must not mutate app state" contract — but the same fix was never applied to the two debounced listeners.
- **Impact**: Stale auth state committed after logout/teardown (ghost "authenticated" flicker), a spurious `fetchPersonaSummaries` IPC call firing into a torn-down app, and flaky test isolation — the identical bug class already diagnosed and fixed for network snapshots.
- **Fix sketch**: Mirror the network-snapshot pattern: return `[unlisten, () => { if (debounceTimer !== null) clearTimeout(debounceTimer); debounceTimer = null; }]` from both setups. No behavior change on the happy path; teardown becomes side-effect-free.

## 2. ipcMetrics notifies subscribers synchronously on every IPC call with no coalescing
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/lib/ipcMetrics.ts:44-56
- **Scenario**: A metrics/observability panel subscribes via `subscribeIpcMetrics` (typically wired to `useSyncExternalStore` or setState). Every single IPC settle then fires all listeners immediately; the panel re-derives `computeCommandStats()` / `getGlobalSummary()`, each of which copies the 500-entry ring, groups, and sorts durations per command. During cold-start bursts or the documented 50+ concurrent-call stampedes, that is hundreds of copy+sort passes per second on the main thread — precisely when the app is busiest.
- **Root cause**: `recordIpcCall` loops `for (const fn of listeners) fn();` inline with the IPC completion path; there is no batching, throttle, or dirty-flag between the ring write and subscriber notification.
- **Impact**: Re-render storms and redundant O(n log n) stat recomputation proportional to IPC rate whenever any subscriber is mounted; the instrumentation intended to diagnose stampedes amplifies them.
- **Fix sketch**: Coalesce notifications: set a dirty flag in `recordIpcCall` and flush listeners at most once per animation frame (or per ~250ms via `setTimeout`), e.g. `if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; for (const fn of listeners) fn(); }); }`. Stats consumers lose nothing — they already read a windowed snapshot.

## 3. silentCatch / silentCatchNull triplicate the log + breadcrumb + recordSwallow body, with a misplaced JSDoc
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/lib/silentCatch.ts:73-148
- **Scenario**: Anyone adjusting the swallow-telemetry contract (e.g. changing breadcrumb category, adding a field to `recordSwallow`) must edit two near-identical bodies (`silentCatch`, `silentCatchNull`) plus keep `toastCatch`'s variant aligned; a partial edit silently forks the app-wide error-swallow behavior.
- **Root cause**: `silentCatchNull` is a copy-paste of `silentCatch` differing only in `return null`. Additionally the JSDoc for `silentCatchNull` (lines 94-99, "Same as silentCatch but returns null…") is stranded above `toastCatch`, stacked directly on top of `toastCatch`'s own doc block, while `silentCatchNull` at line 134 has no doc at all.
- **Impact**: Drift risk in a helper used across the whole frontend, plus actively misleading hover-docs (an IDE shows the silentCatchNull description for toastCatch).
- **Fix sketch**: Extract `function reportSwallow(context: string, err: unknown): void` containing the log + breadcrumb + recordSwallow triple; implement `silentCatch = (ctx) => (err) => reportSwallow(ctx, err)` and `silentCatchNull = (ctx) => (err) => { reportSwallow(ctx, err); return null; }`. Move the stranded doc block down to `silentCatchNull`.

## 4. Single-use `tracing()` wrapper in eventBridge flattens structured logging
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/lib/eventBridge.ts:950-952
- **Scenario**: The SHARE_LINK_RECEIVED handler calls `tracing("[share-link-received]", url)`, which does `logger.info(args.map(String).join(" "))` — a leftover console.log-style shim from before the scoped-logger migration.
- **Root cause**: `tracing` is defined once, used exactly once, and defeats the structured `createLogger` contract used everywhere else in the file (message + context object) by string-concatenating its arguments.
- **Impact**: Dead abstraction plus a log line that can't be filtered/parsed like every other entry in this module; the raw URL lands in the message string instead of a context field.
- **Fix sketch**: Delete `tracing()` and call `logger.info("share link received", { url })` directly at line 788.

## 5. eventBridge tracks "attached" in two parallel variables
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/lib/eventBridge.ts:148 (also 969-974, 1153-1154)
- **Scenario**: `initAllListeners`/`teardownAllListeners` must keep the module-local `let attached` and the HMR-persistent `eventBridgeRuntime.attached` in lockstep — every write site sets both, and line 970 already has to consult the runtime copy (plus `unlisteners.length`) because the local one resets under HMR.
- **Root cause**: The HMR-survival refactor introduced `eventBridgeRuntime` as the source of truth but kept the pre-existing module-local flag alongside it instead of replacing it.
- **Impact**: Redundant state that invites divergence — a future edit that updates one flag but not the other reintroduces the double-attach/leak class of bug the runtime holder was added to fix.
- **Fix sketch**: Delete the module-local `attached` and read/write `eventBridgeRuntime.attached` everywhere (the guard at line 969 becomes `if (eventBridgeRuntime.attached) …` combined with the existing line-970 recovery branch). Same treatment is optionally applicable to the `retryGeneration` mirror, though that one is reassigned per init and is harder to remove.
