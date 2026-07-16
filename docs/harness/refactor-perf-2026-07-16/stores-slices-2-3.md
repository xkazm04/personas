# stores/slices [2/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 4 medium / 0 low)
> Context group: Core Libraries & State | Files read: 18 | Missing: 0

## 1. Per-line store writes for streamed CLI output re-render subscribers on every line
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/stores/slices/system/devToolsTaskSlice.ts:129 (also src/stores/slices/system/artistSlice.ts:139,150)
- **Scenario**: A running dev-task (or creative session) streams output at tens of lines per second for up to ~10 minutes. Every line triggers one zustand `set()` — copying the ring array (up to 1000 elements once at capacity in `appendTaskOutput`), spreading the whole `taskOutputBuffers` record, and notifying every store subscriber — so any component subscribed to the buffer re-renders once per line. `artistSlice.appendCreativeSessionLine` is worse per line: it `map()`s the entire `creativeSessions` array and copies the matching session's output array for each appended line.
- **Root cause**: Line-granularity writes into an immutable store. The earlier fix bounded memory (the ring cap), but the write/notify frequency was left at one store transaction per streamed line.
- **Impact**: During chatty runs the renderer does O(lines) full subscriber notifications plus O(cap) array copies per line — measurable jank on the TaskRunner/ProcessLog surfaces exactly when the user is watching live output; batch auto-runs multiply it across tasks.
- **Fix sketch**: Buffer incoming lines in a module-level `Map<string, string[]>` and flush to the store on a ~50–100ms interval or `requestAnimationFrame` (`appendTaskOutputBatch(taskId, lines[])` applying the ring cap once per flush). One store write per frame instead of per line; same API for the event listeners. Apply the same batching to `appendCreativeOutput`/`appendCreativeSessionLine`.

## 2. recordTriggerFiring inline-duplicates the computeThrottled predicate
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/stores/slices/pipeline/triggerSlice.ts:201-204
- **Scenario**: The three-clause throttle predicate (cooldown active / window full / concurrency full) exists twice: as the pure `computeThrottled()` (line 90, the documented "single source of truth") and re-implemented inline inside `recordTriggerFiring` with raw `rl.*` snake_case fields.
- **Root cause**: `computeThrottled` was extracted for `recordTriggerComplete`/`getRateLimitSummary` but the pre-firing admission check was never rewired onto it.
- **Impact**: The comment on `computeThrottled` claims it is the single source of truth, yet a future rate-limit rule change (e.g. burst allowance) must be edited in two places; miss one and admission and dashboard status silently disagree.
- **Fix sketch**: Build `limits` first (it already exists a few lines below), then compute `const throttled = computeThrottled({ firingTimestamps: recentTimestamps, concurrentCount: prev.concurrentCount, cooldownUntil: prev.cooldownUntil }, limits, now);` and delete the inline three-clause expression. Behavior-identical — the clauses match term for term.

## 3. Dead ternary in healthCheckSlice finalise(): hasNonInfo branches to the same value
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/stores/slices/agents/healthCheckSlice.ts:166-174
- **Scenario**: `finalise()` computes `hasNonInfo` and then evaluates `issues.length > 0 ? (hasNonInfo ? 'partial' : 'partial') : 'ready'` — both arms of the inner ternary are `'partial'`, so `hasNonInfo` is effectively unused.
- **Root cause**: Leftover from an edit where info-only personas were presumably meant to map to a different status (likely `'ready'`) than personas with warnings/errors; the distinction was collapsed but the scaffolding kept.
- **Impact**: Confusing dead logic in the digest hot path; a persona whose only signal is an informational hint ("no telemetry yet") shows the same `'partial'` status as one with real warnings, which may not be the intended UX. Any future reader must reverse-engineer whether that is deliberate.
- **Fix sketch**: Decide the intent: if info-only should read as healthy, change the inner ternary to `hasNonInfo ? 'partial' : 'ready'`; if `'partial'` is deliberate, delete `hasNonInfo` and the ternary (`issues.length > 0 ? 'partial' : 'ready'`) with a one-line comment. Either way the dead branch goes.

## 4. researchLabSlice: six copy-pasted entity CRUD blocks (~180 duplicated lines)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/stores/slices/system/researchLabSlice.ts:92-267
- **Scenario**: Projects, sources, hypotheses, experiments, findings, and reports each repeat the identical fetch/create/delete triplet: `set({ loading: true })` → api list → `set({ list, loading: false })` / `logPassiveFetchFailure`; create → prepend; delete → filter. Only the state key names and api functions differ (sources' create has one dedup twist).
- **Root cause**: Each research entity family was added by copying the previous block instead of extracting a keyed sub-slice factory.
- **Impact**: ~180 lines of near-identical code; a fix to the shared pattern (e.g. the stale-list-on-project-switch behavior, or adding request sequencing like memorySlice's `fetchRequestId`) must be applied six times. Pure maintenance drag — no runtime cost.
- **Fix sketch**: Add a small generic helper `makeEntityActions<T>(cfg: { listKey, loadingKey, list, create, remove })` returning the fetch/create/delete trio via computed property names, and spread six instances into the slice. Keep `createResearchSource` bespoke for its dedup logic. Cuts the file roughly in half without changing the public slice interface.

## 5. Global executions "Load More" re-fetches the entire list with a grown limit
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: data-layer
- **File**: src/stores/slices/overview/overviewSlice.ts:196-241
- **Scenario**: Each Load More on Overview › Activity increments `limit` by 50 (50 → 100 → 150 … capped 500) and calls `listAllExecutions(limit, …)`, re-fetching and re-mapping every previously loaded row plus the new page; the whole `globalExecutions` array is then replaced, invalidating referential identity of all existing rows.
- **Root cause**: Limit-growth pagination instead of offset/keyset pagination — `globalExecutionsOffset` is even maintained in state (line 239) but never sent to the API.
- **Impact**: Paging to the 500-row cap transfers ~2,750 cumulative rows across the SQLite JOIN + IPC boundary instead of 500, and each click re-renders the full list because every row object is recreated. Bounded by the 500 cap, so cost is real but capped.
- **Fix sketch**: Pass `offset` to `listAllExecutions` (rusqlite query already ordered; add `LIMIT ? OFFSET ?`), append the new page to `globalExecutions` on non-reset calls (dedup by id against the existing `seen` set), and keep `hasMore = page.length >= GLOBAL_PAGE_SIZE`. Reset path unchanged.
