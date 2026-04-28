# Ambiguity Audit — Fix Wave 3: Cross-entity scoping

> 4 commits, 4 critical findings closed.
> Baseline preserved: tsc 0 errors → 0 errors; vitest 241 passed → 241 passed.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `12699bc9` | `execution-engine.md` #1 | critical | `stores/slices/processActivitySlice.ts` |
| 2 | `6b26fe92` | `agent-lab-matrix-builder.md` #4 | critical | `stores/slices/agents/matrixBuildSlice.ts` |
| 3 | `148f45cb` | `agent-chat-tool-runner.md` #2 | critical | `features/agents/sub_chat/hooks/useExperimentBridge.ts` |
| 4 | `1a9a4c96` | `agent-lab-matrix-builder.md` #3 | critical | `stores/slices/agents/matrixBuildSlice.ts` |

## What was fixed (grouped by sub-pattern)

1. **`enrichProcess` ignored runId, mutating the wrong concurrent run.** `processActivitySlice.enrichProcess(domain, updates)` had no `runId` parameter and called `findProcessKey(state.activeProcesses, domain)` with no runId. The prefix-fallback in `findProcessKey` returns the *first* `domain:*` key from `Object.keys` — iteration-order dependent — so when two runs share a domain (two `"execution"` rows running concurrently), telemetry meant for run B silently mutated run A's `toolCallCount`, `costUsd`, and `lastEvent`. Mirrored the `runId`-aware shape of `updateProcessStatus`: added an optional `opts?: { runId?: string }` parameter on the slice interface, forwarded `opts.runId` into `findProcessKey`, and documented the race in JSDoc on the slice surface so future callers are nudged toward providing the runId. No live callers exist today, so no consumer updates were needed — but the trap is now defused.

2. **`pickNextActiveSessionId` ignored personaId, flipping the editor to a different persona's draft.** The function sorted all remaining sessions by `createdAt` and picked the newest with no scoping. When the active session was removed (e.g. failed-launch cleanup at `UnifiedMatrixEntry.tsx:351-357`), the pick could flip the active session — and therefore the entire editor mirror — to a draft belonging to a completely different persona. Added an optional `preferPersonaId` argument; when supplied, only sessions for that persona are considered, and `null` is returned if no scoped sessions remain (caller should clear active rather than fall back to an unrelated persona's draft). `removeBuildSession` captures the removed session's personaId before the destructure and forwards it.

3. **Experiment poll fallback locked out the realtime listener.** The polling fallback (mechanism 2 in `useExperimentBridge`) declared "finished-unknown" the moment it observed a runId outside the active list, then `markDelivered`'d the runId — locking out the authoritative realtime event listener (mechanism 1) for any "completed/failed" payload that arrived seconds later. A run finishing 1 second before the 30 s poll fires would race the listener; whichever wrote first decided what the user saw. Added an `inactiveSinceMap` (parallel to `deliveredRunIds`) that records the FIRST time the poll observed each runId as inactive; the declaration only fires after `INACTIVE_GRACE_MS` (5 s) has elapsed since that first observation — comfortably longer than the realtime event-flush latency under normal load, and noticeably smaller than the 30 s poll interval so legitimate "finished-unknown" delivery for runs with no realtime event is delayed by at most one extra cycle. `markDelivered` cleans up the grace-window entry on either delivery path.

4. **`hydrateBuildSession` discarded transient lifecycle state on every re-hydration.** Hydration started from `emptySessionState(...)` and patched a curated subset from the persisted record. Test lifecycle state (`testId`, `testPassed`, `toolTestResults`, `testSummary`, `testConnectors`, `testOutputLines`, `testError`), `pendingAnswers`, `clarifyingQuestionV3`, and `editState`/`editDirty` were silently reset to defaults — even when re-hydrating a session ID the user was actively interacting with mid-test or mid-edit. `PersistedBuildSession` legitimately doesn't carry these fields (they're transient session state, not durable), so the fix is purely an in-memory state-merging policy: when an in-state session for the hydrated id already exists, preserve its transient fields; on first-time hydration the existing session is undefined and the empty defaults still apply. No new fields cross the persistence boundary.

## Verification table (before / after)

| Counter | Before Wave 3 | After Wave 3 |
|---|---:|---:|
| `tsc --noEmit` errors | 0 | 0 |
| Tests passing (stores + agents + settings + sharing) | 241 / 241 | 241 / 241 |
| Slice methods that key by `domain` only when `runId` is needed | 1 | 0 |
| Session-promotion paths that ignore `personaId` | 1 | 0 |
| Poll/realtime races without a grace window | 1 | 0 |
| State hydrations that silently discard in-flight transient state | 1 | 0 |

## Cumulative status (waves 1-3)

| Wave | Theme | Findings closed | Commits | Lines net |
|---|---|---:|---:|---:|
| 1 | Two-X-coexist (libs/ duplicates) | 3 critical | 3 | +123 / -148 |
| 2 | Silent failure / lying state | 6 critical (+1 already-fixed) | 6 + 1 docs | +114 / -342 |
| 3 | Cross-entity scoping | 4 critical | 4 | +109 / -20 |
| **Total** | | **13 critical** (+ 1 already-fixed) | **13 fixes + 3 wave summaries + 1 INDEX scope** | |

## Patterns established (additions to the catalogue, items 10-12)

10. **Slice methods that look up by entity must accept the full identity tuple** — when a method on a Zustand/Redux slice keys lookups by `domain` or `name`, and that domain CAN be shared across concurrent entities, the method must accept the disambiguating id (runId, personaId, teamId, sessionId) and forward it to the key-resolution function. JSDoc on the slice interface to nudge future callers; even if no current caller passes the id, the dead-code call surface still gets defused. Pairs with pattern 2 (personaId-snapshot on async actions) — that one is for closures over props; this one is for store-method signatures.

11. **Promotion / fallback policies must be entity-scoped** — when the active X is removed and the policy "promote the newest remaining X" needs to fire, it must be scoped to the same parent entity (persona, team, workspace) as the removed X. Promoting across entity boundaries is exactly what makes one user's cleanup silently pivot another user's UI. Default to `null`/cleared when no scoped candidate exists, rather than falling back to an unscoped pick.

12. **Two-mechanism delivery requires a grace window between mechanisms** — when a system has both a realtime channel (event listener) and a fallback channel (polling, retry, snapshot), and only one declaration may fire per entity, the fallback MUST defer for at least one full mechanism cycle before declaring. Track `firstSeenInactiveAt` per entity, declare only after the cycle window has elapsed, clean up the grace-window state when either mechanism delivers. Without this, the fallback wins races against the authoritative channel for events that occur within microseconds of the fallback's tick.

## What remains (after Wave 3)

The current session covered Waves 1-3 (criticals from themes A, B, C). The following remain documented in the per-context reports and INDEX.md but are intentionally out of scope this session:

- **Theme D — Validation/security gates** (6 criticals): replay bypasses validateTrigger, gitlabTier hardcoded, signing regex frontend-only with unverifiable backend allowlist, `AUTO_MATCH_CREDENTIALS` first-match-wins, dangerConfirmed shared between paths, setupRole/Tool instant-commit.
- **Theme E — State / cache invalidation** (4 criticals): cachedPublicKey forever, globalExecutionsTotal synthetic, successRate faked from fleet-wide, registerSave during render.
- **Theme F — Sanitization & cross-boundary contracts** (4 criticals): escapeSqlStringLiteral broken regex, Redis SCAN injection, ROLE_PRESETS no contract, auth_variants cast.
- **Theme G — Magic-number sweep** (~35 magic-number findings): polish, postpone unless explicitly requested.
- **Lower-priority criticals from theme B not done in Wave 2** (2 items): `recipes-pipelines.md #10` (pipeline events dropped on team-id mismatch), `deployment-sharing-plugins.md #2` (`dangerConfirmed` shared between distinct danger paths).

Resume in a future session by reading `INDEX.md`, picking a theme, and following the same per-fix loop documented in the vibeman skill: read the source finding, read the target code, apply the fix, run tsc + targeted tests, atomic commit with `Refs:` line.
