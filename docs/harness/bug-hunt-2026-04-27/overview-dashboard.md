# Bug Hunt — Overview Dashboard

> Total: 16 | Critical: 1 | High: 7 | Medium: 7 | Low: 1

## 1. Trend computation splits time-series in half — fabricates trend from a single window

- **Severity**: high
- **Category**: latent-failure
- **File**: `src/features/overview/sub_observability/libs/useObservabilityData.ts:98-124`
- **Scenario**: User views Observability with `compareEnabled = false`. `chartData` contains `effectiveDays` points (NOT 2× period). The hook splits the same window in half and reports the latter half vs the earlier half as a "period-over-period" trend.
- **Root cause**: This `trends` derivation assumes the chartData was fetched at `2 × effectiveDays`, but `useObservabilityData` only fetches `effectiveDays` (no compareEnabled gate). `useExecutionMetrics` uses `previousPeriodDays` for fetching when compare is on; observability does not.
- **Impact**: The Summary cards always show fabricated trend percentages — users react to phantom up/down movement that has no statistical meaning. Decisions (e.g., "cost spiked 40%!") are based on splitting the same week, not comparing to the previous week.
- **Fix sketch**: Either fetch `2 × effectiveDays` when displaying trends, or compute trend off the `comparedChartData` produced by `mergePreviousPeriod`, or hide trend deltas when compare is disabled.

## 2. Discovered-source ring grows unbounded between prunes; ring sized off `events.length` is racy

- **Severity**: high
- **Category**: state-corruption
- **File**: `src/features/overview/sub_realtime/useEventBusState.ts:31-56` and `src/features/overview/sub_realtime/components/views/EventBusVisualization.tsx:26-37`
- **Scenario**: A long-running session receives a steady stream of events. `discoveredSourcesRef.current` is mutated inside `useEffect`, but `toolNodes`/`outerNodes` are memoized on `events.length` only. The ref gets larger, but React doesn't know — the position map and node ring stay stale until `events.length` changes.
- **Root cause**: Refs are mutated as a side effect, then read by a `useMemo` whose dep is `events.length` (a count, not the ref). When the session is paused or the buffer is full at a constant size, `length` doesn't change so the visualization never reflects the new sources. Conversely the EventBusVisualization variant in `components/views/` never prunes at all (no STALE_MS path), so the ref leaks forever.
- **Impact**: Either the visualization shows a stale topology while events keep arriving, or memory grows unbounded for any source-id explosion (e.g., webhook with random IDs).
- **Fix sketch**: Make the ref a `useState` (or store its size in state) so React re-derives, and centralize the prune logic with a hard cap that runs on every event batch.

## 3. Memory `avg_importance` drift on partial deletes can produce NaN/Infinity

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/stores/slices/overview/memorySlice.ts:42-50, 118-132`
- **Scenario**: User deletes a memory not in the current list (e.g., scoped to another persona) but it WAS counted in `memoryStats.total`. `statsAfterDelete` is only called when `state.memories.find(...)` succeeds. If the user holds an outdated `prev.total` from an old fetch and rapidly deletes/creates memories, the running average can drift; in extreme cases a delete with `prev.total = 0` (after race with another delete) causes `(0 - importance)/0 = NaN`.
- **Root cause**: Optimistic stats math `(prev.avg_importance * prev.total - importance) / newTotal` trusts that the deleted memory was counted in `prev.total` — there's no guard for `prev.total <= 0` before the multiplication or for the subtracted importance exceeding the cumulative sum.
- **Impact**: Avg-importance card flashes NaN; UI math downstream that sums against avg_importance produces nonsense.
- **Fix sketch**: Clamp to `Math.max(0, ...)` on the subtraction; if `newTotal === 0`, set avg to 0; refetch stats periodically to prevent drift.

## 4. `evaluateAlertRules` re-fires for stale historical data (chart_points last index is "today")

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/stores/slices/overview/alertSlice.ts:330-341`
- **Scenario**: `chartData[chartData.length - 1].cost` is treated as "today". When the user switches the day-range picker (e.g., from 7d to 30d) the last point in chartData may already be days-old depending on backend semantics, or repopulated from a cached window that ends mid-day. The cost-spike detector fires on yesterday's spike repeatedly each refresh until the 1-hour cooldown expires.
- **Root cause**: There is no assumption check that the last chart_point is "today" or that `chart_points` is sorted ascending. The averaging across `chartData` also includes the same "today" point — biasing the spike ratio when there are few points.
- **Impact**: False-positive alerts for old data; user trust degrades; "last alert at X" times look like spammy retriggers.
- **Fix sketch**: Tag points with date and only consider the latest point if its date is `today`; exclude today from the baseline mean; if `chart_points.length < 7` skip cost_spike entirely (insufficient baseline).

## 5. `setOlderEvents` dedupe uses `e.created_at < oldest.created_at` — drops same-timestamp events

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/overview/sub_events/libs/useEventLog.ts:225-249`
- **Scenario**: Many events arrive with identical `created_at` (batched webhook ingest at 10ms resolution, or batched SQL inserts using `CURRENT_TIMESTAMP`). User clicks "Load older". The cursor `until: oldest.created_at` returns those events, but the `<` filter discards anything with equal timestamp.
- **Root cause**: Strict `<` cursor with equal-timestamp paging requires a tie-breaker (id or seq). The backend might return the events; the client throws them away and immediately sets `hasMoreOlder = false`.
- **Impact**: Pagination silently stops mid-page; user thinks they've seen all history when they haven't. Reproducible with batch-imported events.
- **Fix sketch**: Track `(timestamp, id)` cursor; allow `<=` with id-based dedupe via the `existing` set.

## 6. `lastPruneAt` captured in closure outside flush function — never updates across re-mounts

- **Severity**: low
- **Category**: cleanup-gap
- **File**: `src/features/overview/sub_realtime/useEventBusState.ts:141-199`
- **Scenario**: The flush rAF loop uses `let lastPruneAt = Date.now();` declared once at the start of the effect. The 300ms throttle works, but if the page is suspended (browser tab background), `requestAnimationFrame` pauses, and on resume `now - lastPruneAt` could be hours, then prune runs on the next frame which is correct — except the closure also holds the *previous* value of `pendingCompletionsRef.current` array reference. Nothing actually breaks here, but the rAF loop is started without checking if a prior loop is already running, so React Strict Mode's double-mount in dev creates two parallel rAF loops competing for the same refs.
- **Root cause**: No guard against double-start under StrictMode mount→unmount→mount.
- **Impact**: In dev mode, processing/return-flow updates run twice per frame; subtle visual glitches; minor CPU waste.
- **Fix sketch**: Check `rafRef.current !== null` before starting; or use a top-level `activeRef` toggle.

## 7. `personaCostShare.cost / pt.total_cost` divide-by-zero produces NaN in recentExecs

- **Severity**: high
- **Category**: edge-case
- **File**: `src/stores/slices/overview/personaHealthSlice.ts:316-318`
- **Scenario**: A daily point has `pt.persona_costs` with a persona present but `pt.total_cost === 0` (e.g., free-tier model executions logged with 0 cost, or a day where executions were attempted but cost wasn't recorded). The guard `pt.total_cost > 0` is correct here, but if `personaCostShare.cost > 0` and `pt.total_cost === 0` (impossible if backend is consistent, but possible if a persona has cost from cached pricing while global aggregate uses different source) → the entire branch is skipped, undercounting recentExecs.
- **Root cause**: Bigger issue: this entire `recentExecs` computation is an "approximation from global proportions" using cost ratios as a proxy for execution counts. A persona that runs many cheap executions while another runs few expensive ones gets its `recentExecs` count wildly understated.
- **Impact**: Leaderboard's `activityScore`, `costPerExec`, and "$X/exec" displays reflect cost-share not execution-share, making cost efficiency rankings invert reality. A leaderboard medal awarded based on these false numbers.
- **Fix sketch**: Backend should expose per-persona daily execution counts directly; until then mark recentExecs as "estimated" in the UI and avoid using it as a denominator for cost-per-exec.

## 8. Annotation debounce timer cleanup runs *after* fetch starts — race produces stale state

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/overview/sub_observability/libs/useAnnotationData.ts:27-99`
- **Scenario**: User rapidly toggles `selectedPersonaId`. The timeout fires, awaiting `Promise.all(...)`. Before that resolves, another deps change triggers cleanup → `controller.abort()` is called and `clearTimeout(timeoutId)` is called. The async function then checks `signal.aborted` and bails out — but `byPersona` already accumulated partial results. Combined with a pending "next" effect that completes first, the state can flip back to the older persona's annotations.
- **Root cause**: AbortController is checked AFTER async awaits, but `byPersona = await Promise.all(...)` doesn't itself check signal between iterations. Each individual fetch can complete and write to `byPersona` even while the controller fires abort. The race window between "newer effect fired" and "newer effect's promise resolved first" can leave the last-resolved-stale-effect winning.
- **Impact**: Chart annotations occasionally show data for a previously-selected persona; in production this is rare but user-visible, especially with slow IPC.
- **Fix sketch**: Use a monotonic request-id pattern (like `memorySlice.ts`) instead of AbortController, since `getPromptVersions` doesn't actually accept an `AbortSignal`.

## 9. `executionDashboardLoading` not gated on superseded request — late-arriving fetch overwrites fresh data

- **Severity**: high
- **Category**: race-condition
- **File**: `src/stores/slices/overview/overviewSlice.ts:331-346`
- **Scenario**: User changes day range from 30 → 7 → 30 quickly. Three `fetchExecutionDashboard` calls in flight. Whichever resolves last wins, regardless of which day range is currently selected in the UI. With variable backend latency the displayed `executionDashboardDays = 7` may overwrite the chart with 30-day data, then `executionDashboardDays` reads 30 — but the chart shows 7 days.
- **Root cause**: Unlike `fetchGlobalExecutions` (which uses `fetchGlobalSeq`) and `fetchMemories` (which uses `fetchRequestId`), the central execution-dashboard fetch has no sequence guard. Callers in `useExecutionDashboardPipeline` and `useExecutionMetrics.load()` can race.
- **Impact**: Wrong day range chart displayed; KPI cards show numbers from a different period than the picker shows; sparkline lengths mismatch.
- **Fix sketch**: Add monotonic seq counter; discard set() if `seq !== fetchSeq` (matches the pattern used elsewhere in the same slice).

## 10. `pushRecentEvent` accepts late-arriving "old" events that overwrite newer state

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/stores/slices/overview/eventSlice.ts:39-72`
- **Scenario**: A backend CDC notification arrives for event X with status=processing AFTER the user has already received the completed status via emit_event_to_frontend (network reordering / multiple subscriptions). `pushRecentEvent` blindly overwrites the newer "completed" with the older "processing", and pendingDelta flips from -1 to +1 incorrectly.
- **Root cause**: No timestamp comparison between `oldEvent` and incoming `event`. The fact that `eventIndex.has(id)` triggers replacement assumes incoming is fresher.
- **Impact**: Pending count can drift and never recover; events can flicker backwards through their lifecycle in the log.
- **Fix sketch**: Compare `event.updated_at`/`created_at`/version with `oldEvent` and skip update if incoming is older.

## 11. `ReturnFlow` cleanup interval keeps last expired flow indefinitely

- **Severity**: low
- **Category**: cleanup-gap
- **File**: `src/features/overview/sub_realtime/components/views/EventBusVisualization.tsx:120-128`
- **Scenario**: After a burst of events, the cleanup interval is gated on `hasReturnFlows`. When all flows expire, the filter call removes them all, the effect cleanup runs `clearInterval`. If a single flow spawns and the interval hasn't ticked yet, then component unmounts, the spawned timeout in line 107 still fires — inserting a return flow into a now-unmounted setReturnFlows call. React warns about "Can't perform a state update on an unmounted component" and the flow leaks in stale closures.
- **Root cause**: `setProcessingSet`/`setReturnFlows` inside `setTimeout` callback are not aborted in the unmount cleanup (only `clearTimeouts()` is — but wait, `useEffect(() => () => { clearTimeouts(); }, [clearTimeouts])` only runs once on the cleanup path, but the timeout map is rebuilt every animatedEvents change... the unmount cleanup may execute before pending timeouts fire — but the timeout map is mutated by both. Edge case: timeoutRef.current.delete(animationId) inside the timeout callback runs after the map cleared.
- **Impact**: Console warnings; minor memory leak.
- **Fix sketch**: Track an `isMountedRef` and bail in the timeout callback.

## 12. `evaluateAlertRules` retry loop fires before reading current state, persisting stale alerts

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/stores/slices/overview/alertSlice.ts:303-321`
- **Scenario**: Multiple alerts failed to persist in a previous cycle. When `evaluateAlertRules()` is called again, all pending alerts are re-POSTed concurrently. If the user already manually dismissed one of them via `dismissAlert`, the dismiss happens in alertHistory but the *re-creation* goes through, creating a duplicate fired-alert row in the backend.
- **Root cause**: The retry doesn't check whether the alert is still in `alertHistory` AND not dismissed before resending. Also fires N parallel POSTs without any backoff — a flapping IPC layer can DoS itself.
- **Impact**: Duplicate persisted alerts; backend store bloat; user dismisses an alert and it "comes back" on next eval.
- **Fix sketch**: Check `!alert.dismissed` before retry, and serialize retries with concurrency limit (e.g., 1).

## 13. Overview tab key-based remount discards in-flight state on every navigation

- **Severity**: medium
- **Category**: latent-failure
- **File**: `src/features/overview/components/dashboard/OverviewPage.tsx:28-31`
- **Scenario**: User is on Observability tab while a slow `fetchExecutionDashboard` is in flight. They click Events. The `key={overviewTab}` causes the entire OverviewContent subtree to remount, but the `fetchExecutionDashboard` promise continues — its `.then` writes to a now-mounted-elsewhere store. Then user clicks back to Observability — the dashboard remounts AGAIN, calling `useExecutionDashboardPipeline()` which fires *another* fetch. Multiple overlapping fetches with no dedup.
- **Root cause**: `key` remounting is intended to reset local state but combined with pipeline hooks that fire on mount it triggers redundant fetches. No dedup/in-flight guard at the pipeline hook level.
- **Impact**: Redundant IPC traffic, occasional out-of-order writes (see #9), slower perceived navigation.
- **Fix sketch**: Pipeline hook should check `executionDashboardLoading` before re-firing; debounce or use TTL to skip if just-fetched.

## 14. `chartAnomalies` uses `chart_points` date as React key — duplicate dates crash

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/overview/sub_observability/components/MetricsCharts.tsx:83-86, 64-66`
- **Scenario**: `costAnomalies.map(a => <ReferenceLine key={`anomaly-${a.date}`} />)` — backend returns two cost anomalies for the same date (e.g., one for AM spike, one for PM spike) or `chart_points` aggregates daily but anomaly detection runs hourly. React throws duplicate-key warning and the second `ReferenceLine` may not render or may be replaced.
- **Root cause**: Anomaly identity is not (date) alone; need (date+metric+timestamp) for uniqueness. Same applies to annotations using only date+type+label combos that may legitimately collide.
- **Impact**: Missing anomaly markers; dropdown drilldown opens wrong record on click.
- **Fix sketch**: Include index or include all anomaly fields in the key.

## 15. Healing-issue-resolved optimistic delete races with subscribeHealingEvents

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/stores/slices/overview/healingSlice.ts:61-72, 94-114`
- **Scenario**: User clicks "Resolve" on an issue. `resolveHealingIssue` removes from `healingIssues`. Meanwhile a `HEALING_ISSUE_UPDATED` event fires for that issue (status update from backend). `subscribeHealingEvents` calls `getHealingIssue(issueId)` → succeeds → `state.healingIssues.map(...)` finds nothing → no-op. BUT if the IPC for `getHealingIssue` returns the still-not-yet-resolved row (race), the `.map` no-ops since the optimistic delete already removed it. Reverse case: getHealingIssue throws → catch block also calls .filter, no-op. So far OK.
- The actual bug: if the `HEALING_ISSUE_UPDATED` arrives BEFORE the click but after fetch, the mapped update writes the issue back; if `updateHealingStatus` then succeeds and the optimistic filter removes the issue, but then a *second* event for the same issue fires after — since the issue isn't in the list, the catch path again `.filter`s it out (already not there), ok. But if the failure case in resolveHealingIssue triggers (catch path runs `reportError` only, no rollback), the user sees the issue removed but the backend still has it open.
- **Root cause**: No rollback on error in `resolveHealingIssue`. The `reportError` only sets an error string, doesn't restore the removed issue.
- **Impact**: User sees "resolved" UI but issue remains open in backend; reload reveals discrepancy.
- **Fix sketch**: Capture `prevIssues = get().healingIssues` and restore on error; or use a pessimistic update.

## 16. SLA refresh on `useStatusPageData` mount uses empty deps array — never reruns on store changes

- **Severity**: critical
- **Category**: cleanup-gap
- **File**: `src/features/overview/sub_health/libs/useStatusPageData.ts:65-68`
- **Scenario**: User mounts the health/status page. `useEffect(() => { void loadData(); }, []);` fires once. User then changes time-range or persona elsewhere; `executionDashboard` updates from another component's pipeline fetch. The status page's `entries` memo recomputes (good) — BUT the SLA stats and healing issues fetched at mount remain stale forever. User must remount to refresh.
- **Root cause**: ESLint disabled or missing dep — `loadData` is excluded from the dep array. The `useCallback` for `loadData` depends on `fetchExecutionDashboard` so adding it as a dep would cause re-fetch on every store change. The right fix is a TTL or visibilitychange-triggered refresh.
- **Impact**: Status page becomes a stale snapshot; user troubleshooting an outage sees stale "all green" while real issues exist. Critical because this is the *status page* — its entire purpose is freshness.
- **Fix sketch**: Add interval-based refresh (e.g., every 60s when visible) using `usePolling`; or invalidate when relevant store slices change with explicit deps.
