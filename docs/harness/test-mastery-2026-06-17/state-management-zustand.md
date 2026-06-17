# Test Mastery — State Management (Zustand)
> Total: 7 findings (0 critical, 4 high, 2 medium, 1 low)

> Scope note: the manifest paths `personaStore.ts` and `slices/{overview,vault,system}/index.ts` do not exist; the live equivalents are `src/stores/agentStore.ts`, `overviewStore.ts`, `vaultStore.ts`, `systemStore.ts` and the per-slice entry files. Findings below map to the real files. The store layer already has a healthy testing culture (race harness with `deferred()`, persist-merge/rehydrate tests that drive the *real* callbacks, `credentialSlice.race.test.ts` is exemplary). Gaps are concentrated in the activity-dock FSM, persona race-guards, and the overview review/exec-fetch paths.

## 1. processActivitySlice — runId disambiguation & FSM actions are entirely untested (only the `clearNonActive` predicate is)
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/stores/slices/processActivitySlice.ts:240-412 (actions); test only at src/stores/slices/processActivitySlice.test.ts:1-33
- **Current test state**: exists-but-weak
- **Scenario**: The slice's entire reason for existing is *correct run attribution* — its own doc-comments call out that the prefix-fallback "silently mutates the wrong process — scrambling cost and tool-call telemetry across runs with no UI signal" and that `processEnded` reaping the wrong row is "irrecoverable activity-dock corruption." The only test asserts `shouldSurviveClearNonActive`. Nothing exercises `processStarted` / `processEnded` / `enrichProcess` / `updateProcessStatus` / `processQueued` / `processPromoted` / `reapStaleRunning`. A refactor that re-loosens `findUniqueProcessKey` back to an arbitrary-pick prefix-fallback, or that drops the `existing.status !== "queued"` guard in `processPromoted`, passes CI green today.
- **Root cause**: The hard-won concurrency fixes (documented inline as past incidents — "29 running personas") were landed without behavioral regression tests; only the exhaustiveness predicate got one.
- **Impact**: Activity-dock and FleetActivityStrip show phantom/zombie runs, mis-attributed cost & tool-call telemetry, and a capacity gauge that lies — directly undermining the operator's trust in fleet state.
- **Fix sketch**: Use the file's own pure-function-friendly shape via a tiny `makeHarness()` (same pattern as `credentialSlice.race.test.ts`). Assert: (a) two concurrent `processStarted("execution", runA)` / `(..., runB)` then `enrichProcess("execution", {costUsd: 5}, {runId: runB})` mutates **only** runB; (b) `processEnded("execution")` with two `execution:*` rows active **returns state unchanged** (refusal path) and warns; (c) `processEnded` with the runId reaps the right row and pushes it to `recentProcesses` with the right status; (d) `reapStaleRunning(maxAgeMs)` only reaps `running` rows older than cutoff, records them as `failed`, and leaves `queued`/`input_required` alone; (e) `processPromoted` is a no-op unless status is exactly `queued`.

## 2. `activeProcessCount` derived-count invariant has no guard test
- **Severity**: high
- **Category**: missing-assertion
- **File**: src/stores/slices/processActivitySlice.ts:56,258,281,351,387,408
- **Current test state**: none
- **Scenario**: `activeProcessCount` is a hand-maintained mirror of `Object.keys(activeProcesses).length`, deliberately so the titlebar dock can subscribe to a primitive. Every mutating action must keep them in lockstep (some `+1`/`-1`, some recompute via `Object.keys(kept).length`). There is no test asserting the invariant `activeProcessCount === Object.keys(activeProcesses).length` after any action. A future action that forgets the increment (e.g. a new `processFailed` path) drifts the count silently; the dock badge then shows "3 running" with one row, forever.
- **Root cause**: The invariant lives only in prose ("Maintained in sync with the map"); nothing enforces it.
- **Impact**: Persistent wrong concurrency badge / capacity gauge — the exact class of "doesn't match reality" bug the `reapStaleRunning` comment was written to kill.
- **Fix sketch**: A single property-style test that, after a scripted sequence of every action (started ×2, queued, promoted, enrich, ended, clearNonActive, reapStaleRunning), asserts `count === Object.keys(activeProcesses).length`. Cheap, catches the whole class. Name the invariant explicitly in the test title.

## 3. personaSlice race/cascade guards (seq invalidation, dirty-switch, delete cascade) untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/stores/slices/agents/personaSlice.ts:190-242 (fetchDetail seq), 388-447 (delete cascade), 449-488 (selectPersona dirty guard)
- **Current test state**: exists-but-weak (personaStore.test.ts covers happy-path fetch/select/delete only)
- **Scenario**: Three documented correctness mechanisms are unverified: (1) `fetchDetail`/`fetchPersonaSummaries` `seq` guards that drop superseded responses — a stale late response must NOT overwrite newer state; (2) `selectPersona`'s dirty guard — when `isEditorDirty && id !== prev`, it must stash `pendingSelectPersonaId` and NOT call `fetchDetail` (the comment says this "eliminates the race where a late-arriving detail response overwrites reverted state"); (3) `deletePersona`'s cascade — bumping `fetchDetailSeq` to prevent resurrection and removing the persona's `buildSessions`. The existing delete test only checks list/selection removal. A regression that drops the seq bump or the dirty-bail compiles and passes today.
- **Root cause**: Module-closure counters (`fetchDetailSeq`, `prefetchInflight`) make these paths feel hard to test, so they were skipped.
- **Impact**: Editor shows a ghost/deleted persona, or a discarded edit silently reappears after a slow IPC resolves — data-integrity-of-the-edit regressions that look like flakiness to users.
- **Fix sketch**: Reuse `deferred()` from the credential race test. (a) Kick two `fetchDetail("p1")` calls with the first resolving last; assert the second wins (`selectedPersona` from the later response). (b) Set `isEditorDirty:true`, `selectedPersonaId:"p1"`, call `selectPersona("p2")`; assert `pendingSelectPersonaId==="p2"`, `selectedPersonaId` unchanged, and `getPersonaDetail` was NOT invoked. (c) Seed `buildSessions` tied to a persona, `deletePersona`; assert those sessions are gone and a concurrently-in-flight `fetchDetail` for the deleted id does not re-add it.

## 4. overviewSlice manual-review write + execution-fetch seq guards untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/stores/slices/overview/overviewSlice.ts:196-258 (fetch seq guards), 287-295 (updateManualReview write)
- **Current test state**: none (no `overviewSlice.test.ts` exists)
- **Scenario**: `updateManualReview` is a user-facing data write (resolves/annotates a review then re-fetches) — there is zero coverage. Separately, `fetchGlobalExecutions` and `fetchGlobalExecutionCounts` each carry a `seq` guard explicitly added because "rapidly switching the persona filter could let an older count request resolve last and overwrite the badges with the previous persona's totals." Neither guard is tested, so a refactor that drops `if (seq !== fetchGlobalCountsSeq) return;` re-introduces the cross-persona badge corruption invisibly.
- **Root cause**: Whole slice has no test file; the seq guards are documented but not pinned.
- **Impact**: Wrong execution counts shown for the selected persona (stale-overwrite); a broken `updateManualReview` silently fails to persist a reviewer's decision — a human-in-the-loop action lost.
- **Fix sketch**: New `overviewSlice.test.ts` with a `makeHarness` + mocked `@/api/agents/executions` & `@/api/overview/reviews`. (a) Fire two `fetchGlobalExecutionCounts(personaA)` / `(personaB)` with A resolving last; assert badges reflect B. (b) `updateManualReview(id, {status:'resolved', reviewer_notes})` calls `updateManualReviewStatus` with those exact args then triggers a re-fetch; assert error path sets `error` via `reportError` and does NOT clear the list.

## 5. storeTypes.reportError — toast dedup window & scoped `sliceErrors` functional-merge untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/stores/storeTypes.ts:95-169 (reportError + clearSliceError)
- **Current test state**: none (consumed by many slice tests but never asserted directly)
- **Scenario**: `reportError` is the single error funnel for every slice. Two non-obvious behaviors are untested: (1) identical messages within `_toastCooldownMs` (5s) emit only one toast, then a third after the window emits again (module-level `Map` with eviction at size > 50); (2) with `options.action`, it must use the **functional** `set` form to merge into `sliceErrors[action]` *without clobbering sibling entries* — the type-cast at line 121 is fragile and a wrong shape would silently overwrite concurrent per-action errors. The `severity: "state" | "toast" | "both"` branching is also unverified.
- **Root cause**: It's a shared util buried in a types file; tests mock it away rather than asserting it.
- **Impact**: Toast-spam regression (a flapping IPC error fires a toast per tick), or concurrent per-action errors clobbering each other so an inline error shows against the wrong action.
- **Fix sketch**: Direct unit test with `vi.useFakeTimers()`. Stub the dynamic `@/lib/storeBus` import; spy on `storeBus.emit`. Assert: same message twice within 5s → one emit; advance 5001ms → second emit. For `sliceErrors`: call with `{action:'a'}` then `{action:'b'}` against a real merging `set`; assert both keys coexist. Cover `severity:'toast'` (no state write) and `'state'` (no emit). The dedup-window and sibling-preservation are the invariants to assert (not the message text).

## 6. Pure derivations in overviewSlice are LLM-generatable and currently unpinned
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/stores/slices/overview/overviewSlice.ts:106-128 (`selectDerivedChartPoints`, `safeTimestampToISO`)
- **Current test state**: none
- **Scenario**: `safeTimestampToISO` has real business edge logic: `0`/null → null, values `> 1e12` treated as ms else seconds, anything before `2000-01-01` (946684800000 ms) rejected as invalid. It feeds cloud-review `created_at`/`resolved_at` timestamps shown to users. `selectDerivedChartPoints` maps `daily_points` to chart points including `active_personas: persona_costs.length`. Both are pure and trivially unit-testable; a wrong unit-scaling or off-by-one in the year-2000 floor silently shows 1970-era or future dates on review cards.
- **Root cause**: Pure helpers tucked inside a slice file, never extracted into a tested pass.
- **Fix sketch**: LLM-generatable batch. Assert the **invariants**, not snapshots: (a) seconds-vs-ms boundary — `1700000000` (s) and `1700000000000` (ms) yield the same ISO instant; (b) `0`, `null`, `undefined`, and any value mapping to `< 946684800000` ms → `null`; (c) `selectDerivedChartPoints(null) === []` and per-point `success+failed ≤ executions` / `active_personas === persona_costs.length`. Avoid snapshotting `new Date().toISOString()` output verbatim — assert the relation, not the string.

## 7. dedupedStorage shared module-cache cross-store isolation is asserted only loosely
- **Severity**: low
- **Category**: test-structure
- **File**: src/stores/util/dedupedStorage.ts:12-37; test at dedupedStorage.test.ts
- **Current test state**: adequate (dedup + reset covered) — minor gap
- **Scenario**: The `lastWritten` cache is module-scoped and shared across *all* persisted stores ("multiple stores can share it safely (each persist key is unique per store name)"). The existing test covers single-key dedup but doesn't pin the cross-key-isolation claim — that a write to key `persona-ui-agents` never suppresses a same-value write to `persona-ui-system`. If someone "optimizes" the cache to key on value instead of key, two stores persisting the same partialized JSON would silently lose one write, and only one store rehydrates correctly.
- **Root cause**: The safety claim is in a comment; the test only exercises one key.
- **Fix sketch**: Add one case: two different keys, same value string — assert both reach the underlying `Storage.setItem` (mock storage, count calls per key). Also assert `removeItem(key)` only evicts that key's cache entry, not a sibling's.
