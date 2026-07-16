# test (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 4 medium / 1 low)
> Context group: Core Libraries & State | Files read: 7 | Missing: 0

## 1. Three coexisting error-formatting helpers in bridge.ts

- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/test/automation/bridge.ts:34 (also :141, :1056)
- **Scenario**: Any bridge method author must pick between `unpackError` (line 34) and `_fmtBridgeErr` (line 141); methods use them inconsistently (e.g. `seedTwin`/`driveWriteText` use `_fmtBridgeErr`, most others `unpackError`), and `adoptTemplate` (line 1056) inlines a third hand-rolled copy of the same logic.
- **Root cause**: `_fmtBridgeErr` was added later with a doc comment restating the same Tauri-AppError-stringifies-to-`[object Object]` rationale as `unpackError`, instead of reusing it. `unpackError` is a strict superset (probes `.message`/`.error`/`.reason` and nested shapes before the JSON dump).
- **Impact**: Errors surfaced through `_fmtBridgeErr` paths lose the `.message`/`.error` probing, so structured errors dump as raw JSON while identical errors elsewhere come out human-readable; every new method perpetuates the fork.
- **Fix sketch**: Delete `_fmtBridgeErr` and the inline formatter in `adoptTemplate`; replace all call sites with `unpackError`. Behavior only improves (superset extraction), no callers depend on the raw-JSON-first shape.

## 2. TestBridge interface has drifted from the bridge implementation

- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/test/automation/bridge.ts:51
- **Scenario**: A reader (or a test script author) consults the `TestBridge` interface to learn a method's signature and gets wrong or missing information: `simulateBuild` is declared with 3 params (line 72) but implemented with 4 (`sessionId` added, line 832); dozens of implemented methods (`refreshPersonas`, `studioState`, `promoteBuildDraft`, `setBuildPersonaId`, `companionInspect`, `companionCaptureLastTurn`, `getOverviewCounts`, `forcePersonaModel`, all `smee*`/portability/discord helpers, …) are absent from the interface entirely.
- **Root cause**: The `[key: string]: unknown` index signature (line 130) makes the interface permanently satisfiable, so new methods stopped being declared and existing declarations stopped being updated — the compiler never flags the drift.
- **Impact**: The 80-line interface is now misleading documentation with zero type-safety payoff; wrong declared signatures (simulateBuild) actively deceive. This is the kind of drift that compounds in a 2,749-line god module.
- **Fix sketch**: Either (a) drop the explicit interface and derive it (`type TestBridge = typeof bridge` plus the index signature applied at the `window.__TEST__` assignment), so signatures can never drift, or (b) remove the index signature and let tsc enforce completeness. Option (a) is a small mechanical change. While there, consider splitting the object literal into per-domain spread modules (build, companion, drive, tour) — same runtime object, reviewable files.

## 3. tauriMock's mockInvoke silently replaces prior command mocks, contradicting its doc

- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/test/tauriMock.ts:21
- **Scenario**: A test calls `mockInvoke("list_personas", …)` then `mockInvoke("get_settings", …)`; because `vi.mocked(invoke).mockImplementation` *replaces* the whole implementation, the first command now resolves `undefined` again. The doc comment ("Adds a new implementation that checks the command name") tells the author the opposite of what happens.
- **Root cause**: Each helper installs a single-command implementation via `mockImplementation`, which is last-writer-wins; the comment describes an additive registry that was never built (`mockInvokeMap` exists for the multi-command case but nothing routes authors to it).
- **Impact**: Real test-authoring footgun — tests pass or fail depending on mock-call ordering, and failures manifest as mysterious `undefined` returns from a command that was "mocked". 22 files import these helpers.
- **Fix sketch**: Keep a module-level `Map<string, unknown>` registry; `mockInvoke`/`mockInvokeError` upsert into it and (re)install one shared implementation that consults the map; `resetInvokeMocks` clears the map. Alternatively just fix the comment to say "replaces any previous mockInvoke — use mockInvokeMap for multiple commands", which is a one-line honesty fix.

## 4. perfInstrument copies the entire 500-entry IPC ring buffer on every IPC call

- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender (observer-effect overhead in the measurement path)
- **File**: src/test/automation/perfInstrument.ts:107 (with src/lib/ipcMetrics.ts:55,58)
- **Scenario**: `recordIpcCall` notifies subscribers once per IPC record; the subscribed `ingestNewIpcRecords` calls `getIpcRecords()`, which allocates a full chronological copy of the ring (two `slice`s + spread, up to 500 entries) — then uses only the last 1 new record via `slice(-take)`. During an IPC-heavy perf capture (the exact workload this tool exists to measure), that is ~3 array allocations × ring size per call, i.e. O(n·RING) total, inside the instrument whose render/heap numbers are being trusted.
- **Root cause**: The `subscribeIpcMetrics` callback carries no payload, so the ingester re-derives "what's new" from scratch each notification instead of receiving the one new record.
- **Impact**: Measurement skew (GC pressure and JS time attributed to the app under test) that grows with IPC volume; `snapshot()` already re-drains via the same function (line 173), so the per-record subscription work is almost entirely redundant.
- **Fix sketch**: Cheapest: drop the eager per-record ingest — subscribe to nothing and rely on the existing drain in `snapshot()`/`reset()` (state only needs to be current at snapshot time). Alternatively, change `subscribeIpcMetrics` to pass the `IpcCallRecord` to listeners and ingest that single record directly, keeping React subscribers compatible (they can ignore the arg).

## 5. perfInstrument's IPC subscription leaks across HMR re-evaluations

- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/test/automation/perfInstrument.ts:139
- **Scenario**: In a dev session with HMR, each re-evaluation of perfInstrument.ts creates a fresh module instance whose `unsubscribeIpc` starts as `null`; the previous instance's listener stays registered in ipcMetrics' `listeners` Set forever, since nothing can reach its unsubscriber.
- **Root cause**: The comment claims idempotence via "a single unsubscriber on the module object", but the unsubscriber is module-*instance*-local state — a new eval cannot clean up the old instance's subscription. `attachIpcSubscription`'s guard only protects against double-attach within one instance.
- **Impact**: One orphaned listener per HMR cycle, each performing the finding-4 O(500) copy on every IPC call and mutating an unreachable stale `state` object. Dev-only and bounded by HMR count, hence Low — but it multiplies finding 4 over a long dev session.
- **Fix sketch**: Park the unsubscriber on a global (e.g. `(globalThis as any).__PERF_IPC_UNSUB__`), calling and replacing it in `attachIpcSubscription`; or use Vite's `import.meta.hot.dispose(() => unsubscribeIpc?.())` to tear down on module replacement. Fixing finding 4 by removing the subscription entirely also dissolves this one.
