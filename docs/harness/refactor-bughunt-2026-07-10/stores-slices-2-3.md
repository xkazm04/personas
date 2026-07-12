> Context: stores/slices [2/3]
> Total: 8
> Critical: 0  High: 0  Medium: 3  Low: 5

## 1. `finalise()` collapses to a no-op ternary — info-only personas reported as "partial"
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: correctness / dead-logic
- **File**: src/stores/slices/agents/healthCheckSlice.ts:166-174
- **Scenario**: A persona whose only digest issue is an `info` hint (e.g. `signal_inactive`, `signal_high_latency`, or the `signal_unknown` fallback pushed at line 160) returns `status: 'partial'`. `hasNonInfo` is computed (line 168) but the ternary is `hasNonInfo ? 'partial' : 'partial'` — both arms are identical, so the flag is inert.
- **Root cause**: A branch that clearly meant to distinguish info-only from warning-bearing results was flattened (probably one arm should be `'ready'`). Every persona that has produced any execution but has only soft hints is shown as degraded in the digest.
- **Impact**: UX — the health digest over-reports degraded/partial personas; the `hasNonInfo` variable is dead.
- **Fix sketch**: Decide the intended mapping — most likely `issues.length > 0 ? (hasNonInfo ? 'partial' : 'ready') : 'ready'` so an info-only persona reads as `ready`. Remove `hasNonInfo` entirely if `'partial'` for any issue is actually intended.

## 2. `reviewMemories` / `reflectMemories` return `null` typed as a non-null `MemoryReviewResult` on a concurrent call
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case / type-lie
- **File**: src/stores/slices/overview/memorySlice.ts:208-211, 238-239
- **Scenario**: First call sets `memoryReviewRunning=true, memoryReviewResult=null` and then awaits a multi-second CLI review (`reviewMemoriesWithCli` + `fetchMemories`). If any second caller invokes `reviewMemories()` during that window, the guard returns `get().memoryReviewResult as MemoryReviewResult` — which is still `null`. The declared return type is `Promise<MemoryReviewResult>` (non-null), so a caller doing `const r = await reviewMemories(); r.details.length` dereferences null → crash.
- **Root cause**: The re-entrancy guard casts a nullable field to the non-null result type to satisfy the signature, assuming a prior result always exists. On the very first review it does not.
- **Impact**: crash on a normal double-invoke (two components, or an effect firing twice under StrictMode).
- **Fix sketch**: Make the return type `Promise<MemoryReviewResult | null>` and have callers handle null, or have the guard `return` a rejected/undefined sentinel and let callers no-op when a review is already running.

## 3. Budget getters fire `set()`-bearing fetches during read calls
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: side-effect-in-read
- **File**: src/stores/slices/agents/budgetEnforcementSlice.ts:113-156
- **Scenario**: `getBudgetStatus` and `isBudgetBlocked` are read-style accessors returning a status/boolean, but on `budgetStale` or TTL-expiry they call `void get().fetchBudgetSpend()`, which synchronously does `set({ budgetEnforcementLoading: true })`. If a component calls `getBudgetStatus(id)` during render to paint a budget badge, that triggers a store mutation mid-render (React "cannot update during render" warning / extra render). Additionally, after TTL expiry every call returns `'stale'` / blocks until the async refetch lands, even though cached entries are still present — a brief fail-closed flap on each TTL boundary.
- **Root cause**: Passive-refresh convenience was folded into pure getters instead of a subscribed effect.
- **Impact**: UX/render-correctness — spurious re-renders and momentary "stale"/blocked flaps at TTL boundaries.
- **Fix sketch**: Keep the getters pure (return status from cache, treat missing/expired as `'stale'`) and move the passive refetch to a `useEffect`/interval or a dedicated `ensureFresh()` action callers invoke outside render.

## 4. `fetchGlobalExecutions` mutates `globalExecutionsLimit` before the supersede guard and never rolls it back
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition / state-drift
- **File**: src/stores/slices/overview/overviewSlice.ts:196-246
- **Scenario**: `set({ globalExecutionsLimit: limit })` runs at line 203 *before* the `await` and the `seq !== fetchGlobalSeq` checks. On a "load more" (`reset=false`) that then fails or is superseded (early-return at 208/243), the limit has already grown by a page but the visible rows didn't, so the next load re-requests an inflated window. Two rapid load-mores also compound the limit before either resolves.
- **Root cause**: Optimistic limit bump is committed eagerly rather than alongside the successful result write.
- **Impact**: UX — slightly wrong pagination window / redundant rows after a failed or raced load-more; not data loss.
- **Fix sketch**: Compute `limit` locally, pass it to `listAllExecutions`, and only fold `globalExecutionsLimit: limit` into the final success `set(...)` (after the seq check).

## 5. `updateSensoryPolicy` stale-guard leans on a variable only set by a different action
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/stores/slices/system/ambientContextSlice.ts:120-133
- **Scenario**: The guard `if (latestPolicyPersonaId !== null && latestPolicyPersonaId !== personaId) return;` depends on `latestPolicyPersonaId`, which is assigned only inside `fetchSensoryPolicy`. If the editor writes a policy for persona A without a preceding fetch (or after a fetch that set `latest` to a different persona), the optimistic `set({ ambientPolicy: policy })` can commit A's policy while B is selected — the exact cross-persona shadowing the other guards were added to prevent.
- **Root cause**: Write path reuses the read path's "latest requested id" sentinel instead of tracking its own.
- **Impact**: UX — brief display of the wrong persona's sensory policy after a mid-write persona switch.
- **Fix sketch**: Have `updateSensoryPolicy` set `latestPolicyPersonaId = personaId` at entry (as the fetch does), or compare against a store-derived "current persona" accessor rather than the fetch sentinel.

## 6. Six near-identical CRUD triplets in researchLabSlice invite a factory
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/stores/slices/system/researchLabSlice.ts:98-267
- **Scenario**: `fetchResearch{Projects,Sources,Hypotheses,Experiments,Findings,Reports}` are structurally identical (set loading → try → set data+loading:false → catch `logPassiveFetchFailure`), and the create/delete pairs repeat `set((s)=>({ X:[new, ...s.X] }))` / `filter(id)`. Verified by reading all six blocks — only the api fn, the state key, and the loading key differ.
- **Root cause**: Copy-paste per entity as the lab schema grew.
- **Impact**: maintainability — a fix to the fetch/error contract (like the passive-failure handling) must be edited in six places; drift risk.
- **Fix sketch**: Extract a `makeListResource(apiList, dataKey, loadingKey)` helper returning the fetch action, plus a `prependAction`/`removeByIdAction` factory. Keeps the special-cased `createResearchSource` dedup logic explicit while collapsing the rote five.

## 7. `loadPersistedOnboarding()` runs twice during slice construction
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication / minor-perf
- **File**: src/stores/slices/system/onboardingSlice.ts:137,141
- **Scenario**: `onboardingCompleted: loadPersistedOnboarding().completed` and `onboardingDismissedAtStep: loadPersistedOnboarding().dismissedAtStep` each read `localStorage` + `JSON.parse` the same key independently at init. Two disk reads + parses for one persisted blob.
- **Root cause**: Field-by-field initialization instead of destructuring one load.
- **Impact**: maintainability — trivial; also two chances for the parse to diverge if the stored shape changes.
- **Fix sketch**: `const persisted = loadPersistedOnboarding();` once above the return, then reference `persisted.completed` / `persisted.dismissedAtStep`.

## 8. `logPassiveFetchFailure` is defined in the middle of the import block
- **Lens**: code-refactor
- **Severity**: low
- **Category**: misplaced-code
- **File**: src/stores/slices/system/researchLabSlice.ts:7-31
- **Scenario**: The helper `logPassiveFetchFailure` (lines 15-22) sits between the `@sentry/react` import (line 2) and the type-only `import type { ResearchProject, ... }` block (lines 23-31), interleaving a runtime definition inside the module's import section.
- **Root cause**: Helper was inserted where it was first needed rather than after imports.
- **Impact**: maintainability/readability only.
- **Fix sketch**: Move the `logPassiveFetchFailure` definition below all imports, above the `ResearchLabSlice` interface.
