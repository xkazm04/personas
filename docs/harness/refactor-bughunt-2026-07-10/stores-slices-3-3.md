> Context: stores/slices [3/3]
> Total: 7
> Critical: 0  High: 0  Medium: 4  Low: 3

## 1. Transient IPC error deletes a healing issue from the UI list
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/stores/slices/overview/healingSlice.ts:94-112
- **Scenario**: `subscribeHealingEvents` listens for `HEALING_ISSUE_UPDATED`. On each event it calls `getHealingIssue(issueId, personaId)`. The `catch` block assumes any failure means the issue "may have been deleted" and unconditionally removes it from `healingIssues`. If the fetch fails for a *transient* reason (IPC hiccup, lock contention, momentary permission read), a still-existing, unresolved issue silently vanishes from the panel until a full `fetchHealingIssues` reload.
- **Root cause**: Error handling conflates "not found / deleted" with "fetch failed for any reason" — no discrimination on the error kind.
- **Impact**: UX / trust — user loses visibility of a live failure they should act on; looks like the issue self-resolved.
- **Fix sketch**: Only remove on a definitive not-found signal (inspect the Tauri error `kind`/message for "not found"); otherwise leave the existing entry in place and log a warning.

## 2. Empty-string persona_id fallback in resolveHealingIssue with optimistic removal
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/stores/slices/overview/healingSlice.ts:61-72
- **Scenario**: `callerPersonaId = personaId ?? issue.persona_id ?? ''`. If the caller passes no personaId and the issue isn't in the loaded `healingIssues` (e.g. resolving from a deep-linked or already-filtered view), `updateHealingStatus(id, "resolved", "")` is sent with an empty scope. If the backend treats `''` as "no match" it silently no-ops, yet the UI has already optimistically filtered the issue out of state (line 68) — so it reappears on the next fetch, and the user believes it was resolved.
- **Root cause**: Fabricating a scoping key with `?? ''` instead of failing fast when persona_id is unknown.
- **Impact**: data/UX inconsistency — resolve appears to succeed but doesn't persist.
- **Fix sketch**: If no persona_id can be derived, return early (or surface an error) rather than calling the backend with `''`; only apply the optimistic removal after the call resolves, or reconcile via re-fetch on failure.

## 3. deleteAutomation leaves item removed from UI when personaId is falsy on failure
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/stores/slices/vault/automationSlice.ts:68-84
- **Scenario**: The list is optimistically filtered before the `await api.deleteAutomation(id)`. On failure the recovery path only re-fetches when `itemToDelete.personaId` is truthy. If `personaId` is null/empty (a not-yet-fully-associated or malformed automation), the failed delete is never rolled back — the row stays gone from the UI though it still exists in the backend. `reportError` shows a toast, but the list state is now divergent until a manual reload.
- **Root cause**: Rollback is gated on a field that may be absent; no unconditional state reconciliation.
- **Impact**: UI/DB divergence — user thinks the automation is deleted; it still runs on schedule.
- **Fix sketch**: Restore the removed item on failure regardless of personaId (keep `itemToDelete` and splice it back), or re-fetch by whatever scope is available; don't leave state silently divergent.

## 4. Rotation status cache never evicts deleted credentials and masks background changes
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/stores/slices/vault/rotationSlice.ts:60-86
- **Scenario**: `fetchAllRotationStatuses` returns early when `credentials.every(c => cached[c.id])`. Two consequences: (a) when a credential is deleted, its stale entry lingers in `rotationStatuses` forever (never pruned against the current credential set); (b) once every credential is cached, a status that changes on the backend (e.g. the rotation daemon marks a credential due/rotated) is never refreshed on panel remount — the guard permanently short-circuits.
- **Root cause**: "all present" is used as a proxy for "all fresh"; there is no TTL and no reconciliation of removed keys.
- **Impact**: stale badges / small memory leak of orphaned status entries.
- **Fix sketch**: Add a short TTL (like toolSlice's `_toolDefsCachedAt`) or key the guard on a credential-set hash; prune `rotationStatuses` entries whose id is no longer in `credentials`.

## 5. Dead exported helper: deriveConnectionPhase / DeployConnectionPhase
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/stores/slices/system/deployTarget.ts:90-106
- **Scenario**: `translateCloudError`, `translateGitLabError`, and `isAuthError` from this module are imported by cloudSlice/gitlabSlice/useCloudHealthMonitor. But `deriveConnectionPhase` and its `DeployConnectionPhase` type have zero references anywhere in the repo (grep across `src/` and tests returns only the definition). It was presumably intended to replace ad-hoc phase derivation in the deploy slices but was never wired up.
- **Root cause**: Leftover abstraction from a partial refactor.
- **Impact**: maintainability — dead export invites confusion and false "shared helper" assumptions.
- **Fix sketch**: Either delete `deriveConnectionPhase` + `DeployConnectionPhase`, or adopt it in cloudSlice/gitlabSlice where the phase is currently derived inline.

## 6. Duplicated "latest-wins" monotonic-counter pattern across slices
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/stores/slices/overview/cronAgentsSlice.ts:24-42, src/stores/slices/overview/certificationSlice.ts:34,89-101
- **Scenario**: `cronAgentsSlice` (`fetchRequestId`) and `certificationSlice` (`certDetailSeq`) each hand-roll the identical stale-response guard (increment a module-scoped counter, compare after await, drop if superseded), and the cronAgents comment notes `memorySlice.fetchMemories` is "the same shape". Meanwhile `eventSlice` uses a separate `deduplicateKeyedFetch` helper for a related concern — so the codebase has two parallel mechanisms for "don't let an older fetch overwrite a newer one".
- **Root cause**: No shared latest-wins utility; each slice reimplements it.
- **Impact**: maintainability — 3+ copies to keep correct; easy to get the comparison direction wrong in a new slice.
- **Fix sketch**: Extract a tiny `createLatestWins()` helper (returns `{ next(): token, isCurrent(token): boolean }`) and use it in cronAgents/certification/memory; consider unifying with `deduplicateKeyedFetch`'s intent.

## 7. Duplicated safety-timeout closure in runLifecycle markStarted / markRecovered
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/stores/slices/agents/runLifecycle.ts:91-99,118-126
- **Scenario**: `markStarted` and `markRecovered` schedule the safety timeout with a byte-for-byte identical `onTimeout` callback (warn log + `tryTransition('timed_out')` + the same `set({ [isRunningKey]: false, [progressKey]: null, error: <same template> })`). Only the log message text differs slightly.
- **Root cause**: Copy-paste when `markRecovered` was added.
- **Impact**: maintainability — the timeout-expiry behavior and its error string must be edited in two places.
- **Fix sketch**: Extract a private `armTimeout(set, reason: 'start' | 'recovered')` that builds the shared `onTimeout` and call it from both; keeps the timed-out state transition and error copy in one spot.
