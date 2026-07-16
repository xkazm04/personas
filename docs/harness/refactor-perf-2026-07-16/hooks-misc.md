# hooks (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 3 medium / 2 low)
> Context group: Core Libraries & State | Files read: 18 | Missing: 0

## 1. One-way `cancelled` flag permanently kills the dashboard pipeline after the first filter change
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: stale-cancellation
- **File**: src/hooks/overview/useExecutionDashboardPipeline.ts:186-191 (flag created at :127, checked at :164/:169)
- **Scenario**: User opens Overview (first refresh works), then changes the day range / persona / compare toggle. The debounce effect re-runs because `refresh` has a new identity, and its cleanup sets `mounted.current.cancelled = true` — on the one shared object created by `useRef({ cancelled: false })` that is never reset to `false`. Every subsequent `refresh()` in this mount sees `signal.cancelled === true`.
- **Root cause**: The cancellation object is per-hook-instance but mutated by per-effect-run cleanup. Effect cleanup fires on dependency change (not just unmount), and nothing flips the flag back on the next effect run.
- **Impact**: After any filter change: wave-2 fetches (`observabilityMetrics`, `healingIssues`) never run again, so those widgets show data for the OLD filter; `applyPipelineResults` bookkeeping is skipped so per-source error states go stale; `lastPipelineRun` is never written so the module-level memoization is defeated and every re-mount does a full refetch. Stale user-visible data plus wasted fetches on a hot dashboard path.
- **Fix sketch**: Make the cancellation token per-effect-run, not per-mount: inside the debounce effect create `const signal = { cancelled: false }` and pass it into `refresh(signal)` (or store it in a ref that the effect body resets to a fresh object before scheduling). Cleanup cancels only its own token. Then `refresh` reads that token instead of `mountedRef.current`.

## 2. Overview breadcrumb uses CommonJS `require()` that cannot work in the Vite/ESM bundle
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: broken-lazy-import
- **File**: src/hooks/navigation/useBreadcrumbTrail.ts:26-39 (deps gap at :200)
- **Scenario**: User navigates within the Overview section to a non-home tab. `getOverviewTab()` calls `require('@/stores/overviewStore')`; in the browser ESM build `require` is undefined, the call throws, and the catch returns `'home'` — so the breadcrumb renders the single root segment regardless of the actual tab. Even if the import worked, `overviewTab` is read via `getState()` and is not a dependency of the `useMemo`, so the trail would not update on tab change anyway.
- **Root cause**: A CJS lazy-load pattern (plus an eslint-disable to allow it) grafted onto an ESM app, and a non-reactive store read inside a memo.
- **Impact**: The overview branch of the breadcrumb is effectively dead code producing a wrong/stale trail; the `cachedOverviewStore` machinery and its comment are misleading maintenance weight.
- **Fix sketch**: Import `useOverviewStore` statically (the store is already in the main bundle via the overview feature) and subscribe: `const overviewTab = useOverviewStore((s) => s.overviewTab);`, add it to the memo deps, and delete `getOverviewTab`/`cachedOverviewStore`. If bundle-splitting is genuinely desired, use a top-level dynamic `import()` at module init instead of runtime `require`.

## 3. `splitSqlStatements` allocates `sql.slice(i)` per character — O(n²) on large scripts
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: quadratic-algorithm
- **File**: src/hooks/database/sqlStatementSplitter.ts:19 (also `current += ch` accumulation at :109)
- **Scenario**: A template or LLM-proposed schema of a few hundred KB is executed via `useSchemaProposal.executeSchema`. The main `while` loop runs once per character and each iteration does `const rest = sql.slice(i)` — copying the entire remaining script — even though `rest` is only needed for the `$`/`BEGIN`/`END` regex probes. 200 KB of SQL ≈ 2×10^10 characters copied, freezing the UI thread for seconds.
- **Root cause**: Per-iteration full-remainder substring used only to anchor `^`-regexes, plus char-by-char string concatenation into `current`.
- **Impact**: Bounded (schema execution is user-triggered, not a render loop) but the freeze is on the main thread of a desktop app and scales quadratically with script size.
- **Fix sketch**: Compute `rest` lazily and only a small window: for BEGIN/END test `sql.slice(i, i + 6)`; for dollar-quote tags match against `sql.slice(i, i + 64)` or use a sticky regex (`/\$[A-Za-z0-9_]*\$/y` with `lastIndex = i`) on the full string. Track a `segmentStart` index and push `sql.slice(segmentStart, i)` at split points instead of `current += ch`.

## 4. Favorite toggle refetches the entire persona list per click
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: over-fetch
- **File**: src/hooks/agents/useFavoriteAgents.ts:57-62
- **Scenario**: User stars/unstars an agent in the sidebar. `toggleFavorite` awaits `setPersonaStarred` then calls `fetchPersonas()`, re-querying and re-hydrating the full persona list (and re-notifying every subscriber of `personas`) to flip one boolean the frontend already knows.
- **Root cause**: No optimistic/targeted store patch; the DB write is followed by a full-list round trip as the only way to sync `persona.starred`.
- **Impact**: For each star click: one full-list IPC + SQLite query and a `personas`-array identity change that re-renders every persona-list consumer (sidebar nav, grids, activity dots). Noticeable jank with large rosters; also makes the star feel laggy since the UI updates only after the round trip.
- **Fix sketch**: Add a small `patchPersona(id, { starred })` action to the agent store and apply it optimistically before the IPC; on `setPersonaStarred` failure, revert (or fall back to `fetchPersonas()` as the error path only). The one-time legacy migration can keep its `fetchPersonas()`.

## 5. Legacy `window.__BUILD_CHANNEL_ACTIVE__` global has no readers
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/hooks/build/useBuildSession.ts:85-93
- **Scenario**: `markSessionActive`/`markSessionInactive` maintain a legacy boolean window global "for any external code that still checks it" — but a repo-wide grep finds no reader anywhere in src/ (the only hits are these two writes and a comment). The EventBridge now consults the per-session Set.
- **Root cause**: Kept defensively during the global-flag → per-session-Set migration; the last consumer has since been removed.
- **Impact**: Dead writes plus a misleading comment implying an external contract that no longer exists; future readers may re-couple to it.
- **Fix sketch**: Delete the two `__BUILD_CHANNEL_ACTIVE__` assignments and the "legacy global flag" comments. Verification: grep already covers src/; confirm no e2e/devtools script reads the global before removing (none found in the repo).

## 6. `useRecentAgents` returns a fresh `recentIds` array every render via a pointless useCallback
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/hooks/agents/useRecentAgents.ts:64-69
- **Scenario**: The hook wraps `entries.map(...)` in a `useCallback` and immediately invokes it in the return — the memoized function buys nothing, and `recentIds` gets a new array identity on every render even when `entries` (a stable `useSyncExternalStore` snapshot) hasn't changed. `AgentsSidebarNav.tsx:197` lists `recentIds` in a `useMemo` dep array, so that memo recomputes on every sidebar render.
- **Root cause**: `useCallback` used where `useMemo` was intended.
- **Impact**: Minor wasted recomputation in the sidebar (bounded at 5 entries) and a confusing pattern that defeats the caller's memoization.
- **Fix sketch**: Replace with `const recentIds = useMemo(() => entries.map((e) => e.id), [entries]);` and return it directly.
