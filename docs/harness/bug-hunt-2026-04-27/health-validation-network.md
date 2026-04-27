# Bug Hunt — Health, Validation & Network

> Total: 13 | Critical: 0 | High: 6 | Medium: 5 | Low: 2

## 1. Two parallel `useHealthCheck` instances → one persona reset wipes the other's result silently

- **Severity**: high
- **Category**: state-corruption
- **File**: `src/features/agents/sub_health/components/HealthTab.tsx:8` and `src/features/agents/sub_health/HealthTab.tsx:7`
- **Scenario**: The `sub_health` package exposes two `HealthTab` components (`./HealthTab.tsx` and `./components/HealthTab.tsx`). `index.ts` re-exports the latter, but `./HealthTab.tsx` is still importable. If both ever mount in the same screen (a debug overlay, a tab + sidebar, or a future split view) each owns its own `useHealthCheck()` state — yet they read **the same** `selectedPersona` from `useAgentStore`. The auto-refresh effect in `components/HealthTab.tsx` will re-fire `runHealthCheck` for one instance while the other is mid-scan and still presents stale `phase === 'done'` data.
- **Root cause**: Health-check state is hook-local, not store-bound, so there is no single-writer guarantee across multiple consumers viewing the same persona.
- **Impact**: Confusing flicker; the user sees a "completed" panel that disagrees with a still-running one; latch in `autoRefreshed.current` masks the issue (only one panel ever gets the auto-refresh).
- **Fix sketch**: Delete the orphan `sub_health/HealthTab.tsx` (or have it re-export `./components/HealthTab`). Better long-term: hoist health-check state into the `healthCheckSlice` keyed by personaId.

## 2. `markIssueResolved` race against in-flight `runHealthCheck` resurrects the resolved issue

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/agents/health/useHealthCheck.ts:362-374` & `:278-360`
- **Scenario**: User clicks "Apply fix" on issue X (calls `markIssueResolved(X)`), then immediately clicks "Re-run" before the persona-store mutation propagates. `runHealthCheck` increments `genRef`, runs the IPC, and ultimately calls `setResult(check)` with a *fresh* result built from `testDesignFeasibility` + `get_persona_config_warnings`. Because the backend may still report issue X (the proposal was applied client-side but the persona row hasn't round-tripped yet), the resolved issue reappears and the user re-applies the same fix — second time may now produce a doubled credential link or duplicate use-case.
- **Root cause**: "Resolved" is local UI state with no backend acknowledgement. `runHealthCheck` doesn't preserve client-side resolution flags.
- **Impact**: Duplicate credential links, duplicate `useCases` entries (see `useApplyHealthFix.ts:46`), or the inverse — fixed issues come back into the warning list and inflate the score penalty.
- **Fix sketch**: Either (a) await the persona refresh before allowing re-run, or (b) merge resolved-issue IDs from the prior result onto the new result before calling `setResult`.

## 3. `useApplyHealthFix` reads stale `selectedPersona` design context — apply-then-reapply double-writes

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/agents/health/useApplyHealthFix.ts:13-69`
- **Scenario**: Two issues both have `AUTO_MATCH_CREDENTIALS` proposals (e.g. "missing slack credential" and "missing gmail credential"). User clicks "Apply" on issue A; the callback parses `selectedPersona.design_context` (snapshot at time of `useCallback`) and calls `applyPersonaOp`. Before the persona store finishes dispatching the update, user clicks issue B. The B handler still sees the *original* `selectedPersona.design_context` (closure-captured), parses that pre-A version, and overwrites A's credential link with B's payload because both `updated` objects are derived from the same starting point.
- **Root cause**: `useCallback`'s `selectedPersona` dependency only changes when the persona reference changes, not when its underlying fields mutate via `applyPersonaOp`. The first `applyPersonaOp` doesn't await a re-render, so the closure used by the second click is stale.
- **Impact**: Silent loss of one of the two fixes; the toast still says "Applied fix: …" so the user has no idea half their work was overwritten.
- **Fix sketch**: Inside the callback, re-read the latest persona via `useAgentStore.getState()` rather than the closure capture, or queue applies through a serial mutation function in the store.

## 4. `useApplyHealthFix` swallows "no proposal" silently with no toast

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/agents/health/useApplyHealthFix.ts:14`
- **Scenario**: A consumer calls `handleApplyFix(issue)` with `issue.proposal === null` (e.g. the new info-severity "Could not fetch config warnings" injected by `useHealthCheck.ts:317`). Function early-returns with no UI feedback. Worse: `HealthIssueCard.handleApply` (line 34-37) also calls `onResolved(issue.id)` so the issue *visibly disappears* even though nothing was applied.
- **Root cause**: `onResolved` is invoked before `onApplyFix` has acknowledged the apply succeeded, conflating "user clicked button" with "fix applied".
- **Impact**: User believes a fix landed; no toast, no error, but the issue has been hidden. On next health check it returns and the cycle repeats.
- **Fix sketch**: Guard the button (don't render Apply when `!issue.proposal`); make `onApplyFix` return a success boolean and only call `onResolved` on `true`.

## 5. `HealthWatchToggle` — failed POST + race on toggle leaves UI desynced from server

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/agents/health/HealthCheckPanel.tsx:269-287`
- **Scenario**: User toggles health-watch ON — POST succeeds, `enabled=true`. They immediately toggle OFF — the second `toggle()` runs in parallel because `disabled={loading || !persona}` only blocks AFTER the first `setLoading(true)` has flushed (and React batches this). Both POSTs race to the server. If POST #2 arrives first and POST #1 second, the server ends up enabled but the UI shows disabled. There's no refetch to reconcile.
- **Root cause**: `setLoading(true)` is asynchronous; React 19 may batch the two click handlers. Also the optimistic `setEnabled(!enabled)` only runs on success, so failure of POST #1 silently leaves the toggle in the previous state without any visible error other than a toast — and the toast is the same string for both errors so the user can't tell which click failed.
- **Impact**: Persistent enabled/disabled mismatch between server and UI until next mount.
- **Fix sketch**: Track an in-flight ref and reject reentrancy; refetch the setting after each POST regardless of success.

## 6. `HealthWatchToggle` initial fetch has no cleanup — sets state on unmounted component

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/agents/health/HealthCheckPanel.tsx:261-267`
- **Scenario**: User opens an agent's settings (mounts toggle), then quickly switches to another agent before the `managementFetch` resolves. The promise resolves and calls `setEnabled(d.data.enabled)` on an unmounted instance — React 18+ no longer warns, but the new instance's effect for the new persona has already started a second fetch and the state from the first fetch can land into the new component if React reuses it. Worse: the catch handler `() => {}` swallows every error including 401/500, so genuine backend failures are invisible.
- **Root cause**: No AbortController, no `isCancelled` flag, no error surfacing.
- **Impact**: Stale `enabled` state when switching personas rapidly; silent backend failures.
- **Fix sketch**: Use AbortController on the fetch; report non-2xx via `addToast` (or at minimum log via `silentCatch`).

## 7. `useHealthDigestPrefetch` retries forever after a failed digest until tab close

- **Severity**: medium
- **Category**: latent-failure
- **File**: `src/features/agents/health/useHealthDigestPrefetch.ts:36-63`
- **Scenario**: `runFullHealthDigest()` fails (e.g. backend down). `runFullHealthDigest` returns `null` and resets `healthDigestRunning=false` via `reportError`. The prefetch hook has already set `ran.current = true`, so it won't retry — *good*. BUT: the hook is keyed on `personasLoaded`. If personas are reloaded (e.g. after import via `network:personas-changed` bus event), `personasLoaded` flips false→true and the effect re-runs. Since `ran.current` persists across renders only within the same hook instance, this works — UNTIL React StrictMode (dev) or HMR remounts the hook, at which point `ran.current` resets to false and the digest runs again. In production this can also happen if the parent component conditionally unmounts the prefetch (e.g. behind a route guard).
- **Root cause**: "Once per session" is enforced via a refs-only latch that doesn't survive remounts; no global guard.
- **Impact**: Repeated heavy `Promise.allSettled` digest runs (5 personas × `testDesignFeasibility` per batch) on every remount; in dev, runs twice on every mount via StrictMode.
- **Fix sketch**: Move the "ran this session" latch into the agent store (`healthCheckSlice.healthDigestPrefetched`) so it survives remounts.

## 8. `useHealthDigestScheduler` cleanup race — second mount may double-run digest in StrictMode

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/agents/health/useHealthDigestScheduler.ts:34-101`
- **Scenario**: Under React 19 StrictMode (dev) the effect mounts → cleanup → mounts. First mount sets `running.current = true` and starts the async IIFE. Cleanup runs `abort.abort()` AND `running.current = false` (because `ran.current` is still false — the async hasn't completed). Second mount sees `running.current === false` and `ran.current === false`, so it starts ANOTHER async IIFE. Now BOTH IIFEs are racing. The first one was aborted but the abort-checks only happen between awaits — once it passes the `if (digest) return; if (abort.signal.aborted) return;` window, the next line `setAppSetting(LAST_DIGEST_KEY, …)` runs unconditionally. So you get two `setAppSetting` calls and (depending on backend) two `send_app_notification` calls back-to-back.
- **Root cause**: The cleanup unconditionally clears `running.current` even when an async IIFE is still in-flight.
- **Impact**: Duplicate "Weekly Agent Health Digest" desktop notifications; double-write of `health_digest_last_run`.
- **Fix sketch**: Only clear `running.current` in cleanup if the IIFE has already exited (track via a separate `inflight.current` flag set inside the IIFE).

## 9. `useHealthDigestScheduler` — `if (!digest) return` permanently un-latches and re-runs forever every mount

- **Severity**: high
- **Category**: latent-failure
- **File**: `src/features/agents/health/useHealthDigestScheduler.ts:65-67,86-90`
- **Scenario**: If `runFullHealthDigest()` returns `null` (e.g. zero personas, or transient IPC failure caught inside), the IIFE returns early. The `finally` block does `if (!ran.current) running.current = false;`, leaving BOTH latches false. Next time the component re-renders for ANY reason (theme change, persona-store update, route change re-mount), the effect will see `!ran.current && !running.current` and run the entire scheduler again — including re-checking `enabledRaw`, re-checking `lastRunRaw`, deciding it's still overdue (because the timestamp was never written), and re-attempting the digest. This is a tight retry storm.
- **Root cause**: No backoff; failure path leaves both latches cleared forever.
- **Impact**: Repeated `testDesignFeasibility` calls every render until a digest succeeds. On a degraded backend, this hammers the IPC layer and kills app responsiveness.
- **Fix sketch**: Set `ran.current = true` even on failure, with a separate retry mechanism (e.g. retry once after 1 hour). Or write a "last attempt at" timestamp regardless of outcome and gate retries on it.

## 10. `parseFeasibilityToHealthResult` produces non-deterministic React keys → DOM remount on every render

- **Severity**: medium
- **Category**: state-corruption
- **File**: `src/features/agents/health/useHealthCheck.ts:116-122,238-248`
- **Scenario**: `makeIssueId()` uses `crypto.randomUUID()` per issue. Each call to `runHealthCheck` regenerates fresh UUIDs even when the underlying issue text is identical to the previous run. `HealthCheckPanel` renders `<HealthIssueCard key={issue.id}>` (line 233). When the user clicks "Re-run", every issue's key changes → React unmounts every card → any local card state (focus, hover-revealed details, animations in `animate-fade-slide-in`) resets. The user sees the full list flash in/out even when nothing changed.
- **Root cause**: IDs are regenerated rather than derived from a stable hash of (description, severity).
- **Impact**: Janky UX; loss of focus if user was reading or interacting with a card; `HealedBurst` animation (which only plays on resolved → unresolved transitions) won't fire correctly because the DOM nodes are torn down.
- **Fix sketch**: Hash `(description + severity)` for ID, OR carry forward IDs from `prevResult.issues` when descriptions match.

## 11. `runHealthCheck` doesn't validate issues array — `[null, undefined, null]` returns score 100 falsely

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/agents/health/useHealthCheck.ts:236-248`
- **Scenario**: Backend returns `{ overall: "ready", issues: [null, undefined, "", "   "], confirmed_capabilities: [] }`. `coerceIssueText` filters all entries (returns `null` for each), so `issues` is empty. `dryRunResult.status = 'ready'`, `score = 100`, "All healthy!" rendered. But the backend was actually trying to report 4 issues — they got dropped at the boundary because of upstream serialization bugs (e.g. a Rust `Option<String>` flattening to `null`).
- **Root cause**: Filter-on-error is silent. There's no diff between "backend reported 0 issues" and "backend reported 4 issues that we couldn't parse".
- **Impact**: Health score shows 100 / "ready" when the agent is actually broken. Users trust the score, ship the agent, and it crashes in production.
- **Fix sketch**: When `rawIssues.length > 0` but all coerce to `null`, push an info-severity issue ("Could not parse N issue entries — backend response malformed.") and downgrade status to `partial`.

## 12. Network slice — `connectToPeer`'s in-flight `Connecting` state is overwritten by a concurrent `fetchDiscoveredPeers`

- **Severity**: high
- **Category**: race-condition
- **File**: `src/stores/slices/network/networkSlice.ts:434-451`
- **Scenario**: User clicks "Connect" on peer P1 → slice sets `connectionStates[P1] = 'Connecting'` and awaits `discoveryApi.connectToPeer`. Simultaneously, a 5-second poller fires `fetchDiscoveredPeers()` which succeeds and resets `networkConsecutiveFailures` and `networkError` — but doesn't touch `connectionStates`, so P1 stays at "Connecting". Now `connectToPeer` succeeds and the slice does `set(s => ({ connectionStates: { ...s.connectionStates, [P1]: 'Connected' } }))`. THEN `await get().fetchDiscoveredPeers()` runs (line 443), which replaces `discoveredPeers` with the latest backend list. If the backend hasn't yet recorded the connection (eventual consistency), `is_connected` for P1 is still `false`. UI shows P1 as "Connected" via `connectionStates` but the row's `is_connected` flag from `discoveredPeers` says false → contradictory display state.
- **Root cause**: Two sources of truth for "is this peer connected" — `connectionStates` (client-driven) and `DiscoveredPeer.is_connected` (server-driven) — with no reconciliation.
- **Impact**: Inconsistent connection indicators; user may try to connect again to an already-connected peer.
- **Fix sketch**: Treat `DiscoveredPeer.is_connected` as the only source of truth; reduce `connectionStates` to a transient "in-flight" map keyed by ongoing operation, cleared after the next `fetchDiscoveredPeers`.

## 13. Network slice — failed `fetchNetworkSnapshot` doesn't preserve `discoveredPeers`, so a transient failure may show "no peers" even though they exist

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/stores/slices/network/networkSlice.ts:502-524`
- **Scenario**: A successful `fetchNetworkSnapshot` populates `discoveredPeers` from `snapshot.discoveredPeers`. Subsequent failures don't touch `discoveredPeers`, so previous data is preserved — *good*. BUT if `fetchDiscoveredPeers` (line 419) is called between snapshots and fails, it leaves `discoveredPeers` as the previous successful list, but increments the failure counter. After 3 mixed failures, `networkError = "Network backend unreachable"` is shown to the user — yet `discoveredPeers` still contains the old peers. UI may render those peers as live/connectable when they may have all dropped offline. There's no concept of "data staleness" alongside the error banner.
- **Root cause**: Failure path doesn't mark data as stale; UI consumers get error + apparently-fresh data.
- **Impact**: User clicks "Send message" to a peer that's been offline for 5 minutes; the action fails with a confusing error.
- **Fix sketch**: Track a `lastSuccessfulPollAt` timestamp; when `now - lastSuccess > 30s`, dim the peer list or label it "May be stale".

---

## Notes on what I did NOT flag

- The `silentCatch` pattern in `useHealthCheck` for config warnings is correctly documented and adds an info-issue — good design.
- `STALE_THRESHOLD = 3` shared-counter semantics for network polling are intentional and well-documented.
- `parseLastRunMs` correctly handles NaN and missing values.
- `validateSeverity` correctly defaults to 'warning' on unknown input.
- `Promise.allSettled` batching in `runFullHealthDigest` correctly isolates per-persona failures.
