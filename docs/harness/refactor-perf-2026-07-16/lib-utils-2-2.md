# lib/utils [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 1 medium / 3 low)
> Context group: Core Libraries & State | Files read: 11 | Missing: 0

## 1. `measureStoreAction` never clears Performance Timeline entries — unbounded growth in a long-lived desktop app
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/lib/utils/storePerf.ts:33
- **Scenario**: Every instrumented store action (`overviewSlice`, `eventSlice` via dedup, `certificationSlice`, `personaHealthSlice`) creates two `performance.mark()` entries plus one `performance.measure()` per invocation. Tauri is a long-running desktop app; dashboard fetches are re-run on navigation/refresh/polling, so entries accumulate for the entire session.
- **Root cause**: Marks and measures are appended to the global Performance Timeline buffer and are never removed — the helper omits `clearMarks`/`clearMeasures` after recording.
- **Impact**: Slow but unbounded memory growth of the performance entry buffer over multi-hour sessions, and an increasingly noisy DevTools timeline. Each entry is small, so this is waste rather than breakage, but it is the only unbounded accumulator in this context.
- **Fix sketch**: In the `finally` block, after `performance.measure(...)`, call `performance.clearMarks(startMark)` and `performance.clearMarks(endMark)`. Optionally also `performance.clearMeasures(label)` before creating a new measure (or keep measures if a PerformanceObserver consumes them — none exists today, so clearing both is safe).

## 2. Dead export: `requestNotificationPermission` has no callers
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/utils/platform/osNotification.ts:7
- **Scenario**: Repo-wide grep finds only the definition — no import anywhere in `src/` or `src-tauri/`. The "proactive permission request" path is never exercised.
- **Root cause**: `sendOsNotification` (the only used export) already performs its own lazy permission request on first call, so the proactive helper became redundant and was never wired into app startup.
- **Impact**: Dead API surface plus duplicated permission-request logic within the same 29-line file; future readers must reason about two entry points where one is live.
- **Fix sketch**: Delete `requestNotificationPermission` (verification: repo-wide grep shows zero callers; no dynamic invocation pattern applies to a plain named export). If a proactive prompt is ever wanted at startup, `sendOsNotification`'s inline request already covers first use.

## 3. Dead export: `getDesktopBridgeName` has no callers
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/utils/platform/connectors.ts:57
- **Scenario**: Repo-wide grep finds only the definition. Sibling helpers (`isDesktopBridge`, `getOAuthScopes`, `isGoogleOAuthConnector`, etc.) are all consumed by vault/credential code, but nothing reads the bridge name.
- **Root cause**: Helper added alongside `isDesktopBridge` for a bridge-name display/dispatch use case that either never landed or reads `metadata.bridge_name` directly at the call site.
- **Impact**: Unused export inflates the connector-helper API and duplicates the `connection_mode === 'desktop_bridge'` check already in `isDesktopBridge`.
- **Fix sketch**: Delete the function (zero callers repo-wide). If bridge-name access is needed later, reintroduce it implemented as `isDesktopBridge(c) ? … : null` to avoid re-duplicating the mode check.

## 4. `deduplicateFetch` and `deduplicateKeyedFetch` duplicate the same in-flight-map body
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/lib/utils/deduplicateFetch.ts:19
- **Scenario**: Any future change to the coalescing behavior (e.g. adding an error-specific eviction policy or max in-flight cap) must be made twice; the two wrappers differ only in how the map key is derived.
- **Root cause**: The zero-arg variant predates the keyed variant and was left as a parallel implementation instead of being expressed in terms of it.
- **Impact**: ~15 lines of duplicated get/set/finally-delete logic against the shared `_inflight` map — small but a classic drift hazard for a concurrency primitive.
- **Fix sketch**: Implement the unkeyed form via the keyed one: `export function deduplicateFetch<T>(key, fn) { const wrapped = deduplicateKeyedFetch<[], T>(key, fn); return () => wrapped(); }` — note `deduplicateKeyedFetch` with empty args produces key `` `${prefix}:[]` ``, so either accept the new key shape (keys are internal-only) or add an optional key-derivation parameter to the keyed variant.
