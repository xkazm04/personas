# lib (misc 2) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: Core Libraries & State | Files read: 18 | Missing: 0

## 1. `autoProfile.ts` is dead code that monkey-patches `Promise.prototype.then` at import time
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/debug/autoProfile.ts:15
- **Scenario**: The module has zero importers (verified: `grep debug/autoProfile` across src/ matches only the file itself). If anyone ever imports it — e.g. copying the dev-diagnostics pattern from main.tsx — its top-level side effects fire unconditionally: it replaces `window.queueMicrotask`, patches `Promise.prototype.then` globally (line 27), and starts a perpetual self-reposting `MessageChannel` loop (lines 34–71) with no gate and no stop/unpatch API.
- **Root cause**: A one-off freeze-hunt diagnostic that was never wired into main.tsx (unlike its siblings freezeDetector/freezeWatchdog/storeMonitor) and never deleted. Unlike callbackTracker it isn't opt-in — everything runs at module evaluation.
- **Impact**: Today it's ~85 lines of dead weight; the latent hazard is that a single import adds a wrapper call to *every* `.then`/`await` in the app and a busy MessageChannel that fires between every macrotask, forever — exactly the "microtask storm" it was written to detect. React 19 scheduling is also known-sensitive to these patches (freezeDetector.ts:67–69 disabled callback patching for that reason).
- **Fix sketch**: Delete the file. If the microtask-storm counter is still wanted, fold it behind an explicit `start()/stop()` API gated on a localStorage flag like freezeDetector, and never patch `Promise.prototype` at import time.

## 2. `callbackTracker.patchAll()` has no callers — the tracker is effectively dead and `FreezeEvent.callback` is always null
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/debug/callbackTracker.ts:43
- **Scenario**: `patchAll` is exported but never called anywhere (verified by grep). freezeDetector deliberately disabled it ("patches ... can break React 19's internal scheduling", freezeDetector.ts:67–69) and only imports `unpatchAll` (a no-op, since `patched` is never true) and `currentCallback` (permanently `null`).
- **Root cause**: The patching path was disabled during the React 19 freeze investigation but the ~99-line module and freezeDetector's imports of it were left in place.
- **Impact**: Maintenance hazard: the file looks like live infrastructure (window.setTimeout/MutationObserver/ResizeObserver replacement classes) but does nothing; every `FreezeEvent` persisted to localStorage carries a `callback: null` field that can never be populated, which misleads anyone reading freeze dumps.
- **Fix sketch**: Delete callbackTracker.ts, drop the `unpatchAll()`/`currentCallback` imports in freezeDetector.ts (remove the `callback` field from `FreezeEvent` or hardcode a comment). If the capability might return, keep it in git history rather than shipping dead patch machinery.

## 3. Dev-mode watchdog scans the entire DOM (`querySelectorAll('*')`) 10× per second, every session
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: hot-loop
- **File**: src/lib/debug/freezeWatchdog.ts:117
- **Scenario**: freezeWatchdog auto-starts in every dev session (line 136, imported unconditionally from main.tsx under `import.meta.env.DEV`). Its heartbeat runs `document.querySelectorAll('*').length` every 100 ms — a full DOM traversal that materializes a static NodeList of every element, 10×/s, for the life of the app. storeMonitor (also auto-started in dev, main.tsx:283) adds another full scan every 2 s.
- **Root cause**: The heartbeat payload eagerly computes diagnostics (DOM node count, heap) on every beat instead of only when a freeze is suspected or at a coarser cadence.
- **Impact**: On the large DOMs this app produces (the freeze dumps themselves record tens of thousands of nodes), each scan is O(n) allocation + traversal on the main thread — steady background jank and GC pressure in exactly the environment used to diagnose jank, skewing every dev-mode perf measurement.
- **Fix sketch**: Beat every 100 ms with only `ts` (that is all freeze detection needs) and attach the expensive snapshot (DOM count, heap) at a slower cadence, e.g. every 10th beat. Use `document.getElementsByTagName('*').length` (live collection, no NodeList allocation) for the count. Alternatively make the watchdog opt-in via a localStorage flag like freezeDetector already is.

## 4. storeMonitor writes a JSON blob to localStorage every 2 s even when completely idle
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: hot-loop
- **File**: src/lib/debug/storeMonitor.ts:138
- **Scenario**: The dev-mode monitor's `tick` unconditionally serializes `{heapMB, domNodes, stores, alerts, history: last 5 snapshots}` and calls `localStorage.setItem('__store_monitor', …)` every 2 seconds for the whole session, even when `totalUpdates === 0` and there are no alerts (console logging is already gated on activity; persistence is not).
- **Root cause**: The "crash-safe persist" was written as always-on instead of piggybacking on the same activity gate used for the console summary.
- **Impact**: Synchronous main-thread localStorage writes (Tauri WebView localStorage is disk-backed) every 2 s, forever, in dev — small individually but pure waste at idle, and it adds noise to I/O traces during perf investigations.
- **Fix sketch**: Persist only when something changed since the last write (`totalUpdates > 0 || alerts.length > 0`), or at minimum skip the write when the serialized payload equals the previous one. Two-line change inside `tick`.

## 5. Deprecated `VIEW_MODES` alias block in uiModes.ts has zero consumers
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/constants/uiModes.ts:95
- **Scenario**: `VIEW_MODES`, `ViewMode`, `VIEW_MODE_CYCLE`, and `DEFAULT_VIEW_MODE` (lines 94–108, all `@deprecated`) are never imported anywhere — grep across src/ finds only the definitions. The `ViewMode` identifiers that do appear elsewhere (DeadLetterTab, useDrive) are unrelated local types.
- **Root cause**: Backward-compat aliases kept during the VIEW_MODES→TIERS migration; the migration finished and all call sites now use `TIERS`/`Tier` directly.
- **Impact**: ~15 lines of misleading API surface — a new call site could adopt the deprecated names, and the `SIMPLE/FULL/DEV` naming contradicts the current starter/team/builder tier model documented above it.
- **Fix sketch**: Delete the "Backward-compatible aliases" block (lines 90–108). Typecheck will confirm nothing breaks; no runtime consumers exist.
