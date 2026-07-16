# hooks/utility [1/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 3 medium / 1 low)
> Context group: Core Libraries & State | Files read: 18 | Missing: 0

## 1. useDebouncedSave passes the `deps` array as a single effect dep — debounce restarts on every render
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/hooks/utility/timing/useDebouncedSave.ts:68
- **Scenario**: Every real call site passes a freshly-built array (`useEditorSave.ts:209/219` does `SETTINGS_KEYS.map((k) => draft[k])` inline, and `useTabSection` forwards it). The effect dep list is `[isDirty, cancel, delay, deps]`, so React compares the array by identity — which is new on every render. While `isDirty` is true, ANY re-render of the editor (ticker updates, polling ticks, unrelated state) tears down and restarts the 800ms timer.
- **Root cause**: The contract says "dependency list that resets the debounce (same semantics as useEffect deps)", but wrapping the list in one array element compares reference, not contents.
- **Impact**: Auto-save is postponed as long as the component re-renders faster than `delay`; a frequently re-rendering editor can defer the save indefinitely until the unmount flush. Also constant setTimeout churn on a hot path (the persona editor).
- **Fix sketch**: Spread the caller deps into the effect list: `useEffect(..., [isDirty, cancel, delay, ...deps])` with a targeted `react-hooks/exhaustive-deps` disable, or derive a stable signature (`deps.map(String).join('\x1f')`) like `useSettings` does. Verify `useTabSection`'s default `deps = []` still behaves (it creates a new `[]` per render today, so it currently resets every render too).

## 2. useBackgroundJobPolling is an unused rewrite; the deprecated hook duplicates its entire polling engine
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/hooks/utility/data/useBackgroundSnapshot.ts:74
- **Scenario**: Grep across `src/` shows `useBackgroundJobPolling` has ZERO consumers (only the barrel `hooks/index.ts` re-export), while all three real consumers (`useBackgroundRebuild`, `useN8nTransform`, `useCreateTemplateSnapshot`) call the `@deprecated` `useBackgroundSnapshot`. The section header at line 182 says "Legacy useBackgroundSnapshot (delegates to useBackgroundJobPolling)" — but it does not delegate: lines 218–348 re-implement the same ~90 lines of backoff/pause/terminal/session-loss machinery verbatim.
- **Root cause**: The generic refactor was written but the migration never happened, leaving two full copies of the polling state machine (MIN/MAX backoff, notFound counter, pause-once flag, timer lifecycle) in one file.
- **Impact**: Any fix to the polling logic (e.g. the backoff math or the pause semantics) must be applied twice or silently diverges; the "new" API is dead weight shipped in the bundle. Verification needed only for dynamic use, but both symbols are plain hook calls — no dynamic dispatch observed.
- **Fix sketch**: Make `useBackgroundSnapshot` actually delegate: call `useBackgroundJobPolling<SnapshotLike>` with `getStatus: s => s.status`, `pauseOnStatuses: ['awaiting_answers']`, and an `onSnapshot` that fans out to `onLines`/`onSections`/`onPhase`/`onDraft`/`onQuestions` (the questions-delivered-once guard moves into the wrapper). Alternatively, if no migration is planned, delete `useBackgroundJobPolling` and drop the deprecation notices.

## 3. useSettings claims microtask coalescing but issues its own bulk invoke per hook instance
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: missing-batching
- **File**: src/hooks/utility/data/useSettings.ts:146
- **Scenario**: A settings panel mounting several components that each call `useSettings([...])` in the same render tick issues one `get_app_settings_bulk` IPC per hook instance — plus one more per instance on every matching `settings-changed` event.
- **Root cause**: The doc comment (lines 104–107) says the read "is shared with any concurrent `useAppSetting` calls in the same microtask via getAppSettingCoalesced", but `fetchAll` calls `getAppSettingsBulk(stableKeys)` directly, bypassing the coalescer defined 60 lines above in the same file.
- **Impact**: N mounted readers → N Tauri invokes where 1 would do; the coalescer's whole purpose (documented at lines 22–36) is defeated for the multi-key hook. Bounded cost, but it is the hot mount path for the Settings surface.
- **Fix sketch**: Implement `fetchAll` as `Promise.all(stableKeys.map(getAppSettingCoalesced))` so all `useSettings`/`useAppSetting` reads landing in one microtask flush as a single `get_app_settings_bulk`. Error fan-out already rejects every waiter, so the catch branch keeps working.

## 4. useTerminalClassification re-clones and re-classifies the whole line buffer on every append
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-squared
- **File**: src/hooks/utility/useTerminalClassification.ts:59
- **Scenario**: Terminal output is append-only and can reach thousands of lines during a CLI run. Each new chunk changes the `lines` identity, and the effect posts the ENTIRE array to the worker (structured-clone of every string, every time) and the worker re-classifies all of them; cumulative work is O(n²) over a run. The `useState` initializer also classifies the full buffer synchronously on the main thread at mount.
- **Root cause**: The request protocol is whole-buffer: there is no memo of already-classified lines, so prior results are discarded on each message.
- **Impact**: Growing serialization + regex cost on the hottest streaming path; main-thread jank comes from the postMessage clone even though classification itself is off-thread. Bounded per-run, hence Medium rather than High.
- **Fix sketch**: Keep a ref of the last classified results and, when `lines` starts with the previously-sent prefix (the append-only common case), post only `lines.slice(prevLen)` and concatenate the response with the cached prefix. Fall back to full reclassification when the prefix does not match (buffer reset/filter change). Same incremental guard applies to the sync fallback.

## 5. useAsyncAction recreates `execute` whenever callers pass inline `options`
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/hooks/utility/interaction/useAsyncAction.ts:76
- **Scenario**: The hook advertises itself as the canonical replacement for hand-rolled loading state ("~70% of component fetches"). `execute` lists `fn` and `options` as deps; both are object/function literals at typical call sites, so `execute` gets a new identity every render, invalidating any `React.memo`/`useCallback` chain it feeds and re-running effects that depend on it.
- **Root cause**: Callback/options are captured in `useCallback` deps instead of the latest-ref pattern the same directory already uses (`useDebouncedSave`'s `saveFnRef`, `useLayeredList`'s `fetchPageRef`).
- **Impact**: For a hook explicitly intended for app-wide adoption, unstable `execute` quietly defeats downstream memoization everywhere it is used. Cost per site is small; breadth makes it worth fixing once here.
- **Fix sketch**: Hold `fn` and `options` in refs updated each render (`fnRef.current = fn`) and make `execute` a `useCallback(..., [])` reading through the refs. Behavior is unchanged; identity becomes stable for the component's lifetime.

## 6. Viewport clamp math duplicated verbatim between the two hooks
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/hooks/utility/interaction/useViewportClamp.ts:36
- **Scenario**: `useViewportClampFixed` (lines 36–52) and `useViewportClampAbsolute` (lines 84–100) contain the same 16-line dx/dy overflow computation (right → left → bottom → top against `VIEWPORT_MARGIN`), differing only in what they do with the result.
- **Root cause**: The absolute variant was added by copying the fixed variant's measurement block instead of extracting the pure math.
- **Impact**: A margin/ordering tweak (e.g. handling elements taller than the viewport) must be made twice; drift risk only, no runtime cost.
- **Fix sketch**: Extract `function clampDelta(rect: DOMRect): { dx: number; dy: number }` at module scope and have both hooks call it; each keeps its own state application (`setPos` vs `setOffset`).
