# personas (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: Persona Authoring & Design | Files read: 2 | Missing: 0

## 1. CreatePersonaEntry uses raw React.lazy — the exact pattern the codebase documents as the 2026-06-07 "bricked section" incident
- **Severity**: High
- **Lens**: code-refactor
- **Category**: consistency
- **File**: src/features/personas/sub_foundry/CreatePersonaEntry.tsx:4
- **Scenario**: One failed chunk fetch for `UnifiedBuildEntry` (dev-server restart, post-deploy stale chunk) permanently caches the rejected import promise inside raw `lazy`; every subsequent mount of the create surface re-throws the same rejection until a full page reload.
- **Root cause**: PersonasPage.tsx:29-33 explains at length why every lazy declaration must go through `lazyRetry` (raw lazy caches a rejected import forever), yet this file — loaded *by* one of those lazyRetry declarations — re-lazy-loads UnifiedBuildEntry with raw `lazy`, re-introducing the hazard one level down.
- **Impact**: The outer ErrorBoundary reset / remount that `lazyRetry` exists to make work is defeated: the retry re-imports sub_foundry successfully but the inner cached rejection bricks the create flow anyway. This is the app's front-door surface when zero personas exist.
- **Fix sketch**: Replace `lazy(...)` with `lazyRetry(...)` from `@/lib/lazyRetry` (same then-shim for the named export). Better yet, delete the inner lazy entirely per finding 2.

## 2. Nested lazy waterfall: CreatePersonaEntry is a one-div wrapper that chains two sequential chunk loads for the same component
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: chunk-waterfall
- **File**: src/features/personas/PersonasPage.tsx:35
- **Scenario**: Opening the create flow (or first launch with zero personas) triggers `import('sub_foundry')`, which evaluates, mounts CreatePersonaEntry, and only *then* triggers `import('UnifiedBuildEntry')` — two sequential dynamic-import round-trips where one would do.
- **Root cause**: CreatePersonaEntry's tab strip was retired (its own doc comment says so); what remains is a `<div>` + testid + Suspense around a lazy UnifiedBuildEntry. PersonasPage already declares its own lazyRetry for UnifiedBuildEntry at line 38, so the same module has two lazy wrappers and the sub_foundry hop adds pure latency.
- **Impact**: Doubled time-to-interactive on the persona-creation entry (chunk fetch + eval twice, serialized), plus two lazy identities for one component. Bites hardest on the empty-state first run, the one path where perceived speed matters most.
- **Fix sketch**: In PersonasPage lines 246/249, render the already-declared `UnifiedBuildEntry` lazyRetry directly (wrap in the `data-testid="create-persona-entry"` div if tests need it), then delete CreatePersonaEntry.tsx and the sub_foundry re-export — it has no other callers (verified by grep). This also moots finding 1.

## 3. Shell subscribes to the full `personas` array just to test emptiness — whole-page re-render on every persona mutation
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/personas/PersonasPage.tsx:105-107
- **Scenario**: Any agentStore update that replaces the `personas` array (fetch refresh, status change, edit save) changes the array identity, so `useShallow` sees a new slice and re-renders PersonasPage — the app shell containing Sidebar, DesktopFooter, and the whole `renderContent()` router.
- **Root cause**: The component only uses `personas.length === 0` (line 245) but selects the array itself; shallow equality compares the array reference, not its length.
- **Impact**: Every persona list refresh re-renders the entire shell subtree, re-running the router closure and un-memoized children. On a store that refreshes via bridges/events (fleet bridge refreshes on mount and registry/state events), this is a recurring hot-path cost that grows with UI under the shell.
- **Fix sketch**: Select the derived boolean in the useShallow slice: `hasNoPersonas: s.personas.length === 0` (or `personaCount: s.personas.length`), and use that at line 245. Primitive values keep the shallow comparison stable across array replacements with unchanged length.

## 4. Startup retry banner re-runs the full startup sequence including already-succeeded waves
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: redundant-fetch
- **File**: src/features/personas/PersonasPage.tsx:117-153
- **Scenario**: If only `recipes` failed during startup, clicking Retry on the ErrorBanner (line 346) re-fetches personas, tools, credentials, recipes, and teams — four redundant IPC round-trips plus the deliberate 100ms yield — and re-triggers `gitlabInitialize`.
- **Root cause**: `runStartup` tracks per-wave failures into `failed[]` for the error message but discards that information for retry; `onRetry={runStartup}` always replays everything.
- **Impact**: Bounded (user-initiated, ~5 fetches) but exactly the IPC stampede the staggered startup comments try to avoid, on a machine that just demonstrated it is struggling. Also re-entrant: a retry racing a slow first run can double-fire the same store fetches.
- **Fix sketch**: Keep the last `failed` list in a ref and have retry re-run only the failed fetchers (map label → thunk); fall back to full `runStartup` if the ref is empty. Two small changes: build the wave list from a `[label, thunk][]` table and filter it on retry.

## 5. Duplicate CreatePersonaEntry render branches
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/personas/PersonasPage.tsx:245-250
- **Scenario**: Two adjacent `if` blocks return byte-identical JSX (`ErrorBoundary` + `Suspense` + `CreatePersonaEntry`), differing only in condition.
- **Root cause**: The empty-state gate and the explicit `isCreatingPersona` gate were added separately and never merged.
- **Impact**: Pure maintenance drag — a future edit (e.g. the finding-2 inline swap) must be applied twice or the branches drift.
- **Fix sketch**: Merge into one branch: `if (isCreatingPersona || (personasFetched && !isLoading && !error && personas.length === 0)) return <...>;` — one JSX site, same behavior.
