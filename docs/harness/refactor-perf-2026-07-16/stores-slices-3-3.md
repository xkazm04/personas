# stores/slices [3/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 2 medium / 3 low)
> Context group: Core Libraries & State | Files read: 17 | Missing: 0

## 1. Dead exports: `deriveConnectionPhase` + `DeployConnectionPhase` never imported anywhere
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/stores/slices/system/deployTarget.ts:92
- **Scenario**: A repo-wide grep of `src/` shows `deriveConnectionPhase` and its `DeployConnectionPhase` type appear only at their definition (deployTarget.ts:92-106); neither cloudSlice, gitlabSlice, nor any component imports them. They are described in the module doc as part of the shared connection-state abstraction, implying an API that was never adopted.
- **Root cause**: The DeployTarget abstraction shipped a "connection state helpers" section speculatively; the two consumer slices kept their own inline phase logic.
- **Impact**: ~15 LOC of dead exported surface that readers must assume is live (it is exported), and a misleading module doc claiming it "unifies connection state management". Static-only usage, so removal is safe once confirmed no test files import it.
- **Fix sketch**: Delete `DeployConnectionPhase` and `deriveConnectionPhase` (grep tests/ first), or actually wire them into cloudSlice/gitlabSlice selectors if the unification is still wanted. While there, un-export `CLOUD_ERROR_RULES`/`CLOUD_ERROR_PREFIX`/`GITLAB_ERROR_RULES`/`GITLAB_ERROR_PREFIX` — they are only consumed inside this module via `translateCloudError`/`translateGitLabError`.

## 2. recipeSlice refetches the full recipe list after every mutation
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: refetch-after-mutate
- **File**: src/stores/slices/pipeline/recipeSlice.ts:50
- **Scenario**: `createRecipe`, `updateRecipe`, and `deleteRecipe` each `await get().fetchRecipes()` — a full `listRecipes()` IPC round-trip — before resolving. A user renaming three recipes in the manager pays three full-list fetches, and each mutation's UI feedback is blocked on the list fetch completing.
- **Root cause**: Mutations rebuild state from the backend instead of patching the local `recipes` array, unlike sibling slices (automationSlice, databaseSlice) which splice/map locally.
- **Impact**: One extra full-list IPC per mutation plus added latency on every save/delete in the recipe editor; grows with catalog size. Bounded (desktop IPC, list-sized payload), hence Medium.
- **Fix sketch**: `createRecipe` already receives the created record — append it: `set(s => ({ recipes: [...s.recipes, created] }))`. For update/delete, map/filter the array locally (have `updateRecipe` API return the updated row, or merge `input` over the existing item). Keep a `fetchRecipes()` fallback only in catch paths if drift is a concern.

## 3. `triggerAutomation` refetches all automations to refresh one row
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: refetch-after-mutate
- **File**: src/stores/slices/vault/automationSlice.ts:86
- **Scenario**: Triggering a single automation fires `fetchAutomations(personaId)` (full list IPC) just to pick up that automation's updated `last_triggered_at`.
- **Root cause**: No single-automation read path is used; the slice reuses the list fetch as a coarse cache-refresh.
- **Impact**: One redundant full-list round trip per trigger. Fire-and-forget (not awaited) so no UI latency, and per-persona lists are small — bounded cost.
- **Fix sketch**: Patch the one row locally: `set(s => ({ automations: s.automations.map(a => a.id === id ? { ...a, lastTriggeredAt: run.startedAt ?? new Date().toISOString() } : a) }))`, or have the backend `triggerAutomation` return the updated automation alongside the run.

## 4. Duplicated safety-timeout callback in `markStarted` / `markRecovered`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/stores/slices/agents/runLifecycle.ts:91
- **Scenario**: The two timeout closures (lines 91-99 and 118-126) are byte-for-byte identical apart from the log message; a future tweak to the timed-out state shape (e.g. also clearing an activeRunId) must be made twice and will silently diverge if one site is missed.
- **Root cause**: `markRecovered` was added later by copy-pasting `markStarted`'s timeout block instead of extracting it.
- **Impact**: Pure maintenance hazard in shared infrastructure used by three run systems (execution/test/lab); no runtime cost.
- **Fix sketch**: Extract `function fireTimeout(set, logMsg)` (or pass the message into `scheduleSafetyTimeout`) containing the `logger.warn` + `tryTransition('timed_out')` + `set({...})` body, and call it from both sites.

## 5. `fetchToolUsage` reports the same failure twice (logger.warn + reportError)
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/stores/slices/agents/toolSlice.ts:126
- **Scenario**: On any tool-usage fetch failure the catch block first `logger.warn(...)` then calls `reportError(...)`, which itself captures to Sentry (storeTypes.ts:112) and surfaces the error — producing double telemetry for one failure.
- **Root cause**: A local debug log was left in place when the catch was upgraded to the shared `reportError` helper; no other action in this context keeps both.
- **Impact**: Noise only — duplicate log/telemetry entries make failure counts look inflated; trivial to clean.
- **Fix sketch**: Delete the `logger.warn("fetchToolUsage failed", ...)` line and keep `reportError`. If the `logger` then has no remaining callers in this file, drop the `createLogger("tool")` setup and import too.
