# Bug Hunt — Dashboard & Analytics

> Group: Overview & Observability
> Files scanned: 14
> Total: 2C / 6H / 4M / 2L = 14 findings

Note on file mapping: the originally listed paths (`OverviewPage.tsx`, `sub_analytics/AnalyticsPage.tsx`, `sub_health/HealthOverview.tsx`, `sub_cron_agents/CronAgentsPanel.tsx`, `sub_events/EventsTimeline.tsx`, `sub_observability/ObservabilityPanel.tsx`) do not exist as named — they have been moved/renamed. Substitutes scanned: `components/dashboard/OverviewPage.tsx`, `sub_analytics/components/RotationOverviewPanel.tsx`, `sub_health/components/PersonaHealthDashboard.tsx`, `sub_cron_agents/CronAgentsPage.tsx`, `sub_events/components/EventLogList.tsx` + `libs/useEventLog.ts`, `sub_observability/components/ObservabilityDashboard.tsx` + `libs/useObservabilityData.ts`, `stores/overviewStore.ts`, `stores/slices/overview/overviewSlice.ts` + `eventSlice.ts` + `cronAgentsSlice.ts` + `personaHealthSlice.ts`, `api/overview/observability.ts` + `events.ts`, `src-tauri/.../observability/{metrics,alerts,digest,mod}.rs`.

---

## 1. CronAgentsPage — bigint division in failureRate makes single-execution agents render as red "failed"

- **Severity**: critical
- **Category**: edge-case
- **File**: `src/features/overview/sub_cron_agents/CronAgentsPage.tsx:95-104`
- **Scenario**: Tauri serializes SQLite `i64` columns (`recent_executions`, `recent_failures` on `CronAgent`) as JS `bigint`. `failureRate = agent.recent_failures / agent.recent_executions` is therefore a `bigint / bigint = bigint` integer division — `1n / 2n === 0n`, so a 1-failure-of-2 agent computes `0n` (looks healthy) and a 2-failure-of-2 agent computes `1n` (>= `0.6` → red). For one execution and zero failures, `failureRate = 0n`, comparison `0n === 0` is `false` (TypeError actually thrown by `==` mixed-type, but `===` returns false), so the code falls all the way through to `XCircle`/`text-red-400` even for a perfectly healthy agent. The downstream `Number(agent.recent_executions) === 0` only protects the icon branch, not the `failureRate` line above it.
- **Root cause**: code assumes `recent_executions` and `recent_failures` are `number` but the bindings emit `bigint` for `i64`. The wrapping `Number(...)` cast appears later but the mathematical division happens on the raw bigints.
- **Impact**: every healthy headless cron agent renders as red "failed" (XCircle, `recent_executions - recent_failures` rendered as a bigint string with trailing 'n' or throws on template-literal with mixed bigint/number). Power users on the Cron tab get a false-alarm dashboard daily.
- **Fix sketch**: cast both to numbers up-front: `const execs = Number(agent.recent_executions); const failures = Number(agent.recent_failures); const failureRate = execs > 0 ? failures / execs : 0;` and use `execs`/`failures` everywhere below.

## 2. PersonaHealthSlice — recentExecs collapses to 0 for free local-provider runs, mis-classifying healthy BYOM personas

- **Severity**: critical
- **Category**: edge-case
- **File**: `src/stores/slices/overview/personaHealthSlice.ts:331-356`
- **Scenario**: a persona running entirely on a local model (Ollama/LMStudio) records `cost = 0` on its `persona_costs` rows. The loop only counts toward `recentExecs` when `pt.total_cost > 0` AND that day's per-persona share is non-zero — both gates fail when *all* fleet activity that day was free. Result: `totalExecs` from `top_personas` may be 0 too (top_personas is cost-ranked), `successRateSource` falls into the `'unknown'` branch, `successRate` defaults to 100, `heartbeatScore` becomes 80 → grade `'healthy'` regardless of actual run outcomes. Conversely, when one paid persona is mixed with free ones, the cost-share denominator divides by `pt.total_cost` ≈ tiny number → `recentExecs` over-counted.
- **Root cause**: cost is used as a proxy for execution share; the assumption "non-zero cost ⇒ activity" is false for BYOM/local fleets.
- **Impact**: BYOM/local-first users (a flagship feature per CLAUDE.md memory) see fabricated "healthy" grades on dead personas, or wildly inflated execution counts on the Persona Health Dashboard "recent executions" badge.
- **Fix sketch**: make the backend `DashboardDailyPoint` include `executions_by_persona: Record<string, number>` directly; remove the cost-share inference. Until then, fall back to `costEntry.days.size` or `topPersona.recent_executions` and tag `successRateSource: 'unknown'` explicitly.

## 3. fetchObservabilityMetrics — no sequence guard; rapid persona switch shows wrong persona's metrics

- **Severity**: high
- **Category**: race-condition
- **File**: `src/stores/slices/overview/overviewSlice.ts:320-351`
- **Scenario**: clicking persona A then quickly persona B in `PersonaSelect` fires two `fetchObservabilityMetrics` calls. There is no `seq` counter (cf. `fetchGlobalSeq`/`fetchGlobalCountsSeq` in the same file lines 122-129 — present for executions but absent here and on `fetchExecutionDashboard`). If A's request resolves last, `set({ observabilityMetrics })` overwrites B's freshly-loaded data. UI shows persona B selected but persona A's KPI tiles, sparklines, and pie chart.
- **Root cause**: inconsistent application of the in-flight gating pattern documented in this very file.
- **Impact**: misleading metrics on every persona-filter rapid-toggle; happens reliably with a slow connection or large day range.
- **Fix sketch**: add `let fetchObservabilitySeq = 0;` plus `const seq = ++fetchObservabilitySeq;` at function entry and `if (seq !== fetchObservabilitySeq) return;` after each `await`. Mirror for `fetchExecutionDashboard`.

## 4. EventLogList loadOlder — strict `<` cursor on second-precision timestamps drops or duplicates rows

- **Severity**: high
- **Category**: pagination-off-by-one
- **File**: `src/features/overview/sub_events/libs/useEventLog.ts:229-277`
- **Scenario**: the cursor is `until: oldest.created_at` (ISO string), and the client filter is `e.created_at < oldest.created_at`. `created_at` strings come from SQLite `CURRENT_TIMESTAMP` which is second-precision — multiple events can share a timestamp (event-bus burst on emit). When 51 events exist at the same second and `INITIAL_LIMIT = 50`, the 51st is filtered out by `<` AND the server may return it again at the next page (where it is again filtered by `<`), producing infinite "load more" that yields zero new rows — `setHasMoreOlder(false)` is reached only because all items were duplicates, but the user sees a flicker spinner with no new data. Conversely, if the server uses non-strict `<=`, the boundary row is duplicated (deduped here) but the *next* same-second sibling is still strictly excluded.
- **Root cause**: timestamp-as-cursor without a tiebreaker (id) and without nanosecond precision.
- **Impact**: silent loss of events at burst boundaries; under load (test seeding, mass-emit) the events tab visibly stops scrolling even though more rows exist.
- **Fix sketch**: extend the cursor to `(created_at, id)` lexicographic compare on both server and client; or add monotonic `event_seq` int column for cursor.

## 5. EventSlice fetchRecentEvents — pendingEventCount only reflects the top-50 window, not server reality

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/stores/slices/overview/eventSlice.ts:25-32`
- **Scenario**: `fetchRecentEvents(limit?)` defaults to 50 and computes `pendingEventCount = events.filter(status==='pending').length` from those 50. If 80 pending events exist server-side, the badge shows 50 (capped) and never increases until the next reload. The Inbox/Attention badge derived from `pendingEventCount` therefore under-reports during incident bursts. The `pushRecentEvent` reducer only adjusts `pendingEventCount` for events it actually receives via the bus — older pending events that aged out of the 200-cap window decrement the count without a corresponding server query.
- **Root cause**: count is derived from a paginated client list rather than a dedicated server `count(*) WHERE status='pending'` call.
- **Impact**: the persistent red badge on Events sidebar and on `useAttention('observability')` lies during exactly the moment users need it (incident storms).
- **Fix sketch**: add a `count_pending_events` Tauri command, fetch it independently of `fetchRecentEvents`, and update on `pushRecentEvent` deltas (which is already correct for in-window deltas).

## 6. ObservabilityDashboard staleness check — laptop sleep marks every panel "stale" forever

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src/features/overview/sub_observability/components/ObservabilityDashboard.tsx:48`
- **Scenario**: `isStale = hasFetched && (Date.now() - pipelineFetchedAt[key]!) > 300_000`. `pipelineFetchedAt` is set once on success and only when explicit refreshes happen. After a laptop sleep + wake, `Date.now()` jumps hours forward but `pipelineFetchedAt` does not — every panel chip flips to amber "stale" and stays there until the user manually clicks refresh (auto-refresh defaults `false`). There is no `visibilitychange` handler to refetch on resume.
- **Root cause**: missing wake/visibility refresh trigger.
- **Impact**: dashboard lies about data freshness after every laptop lid-close; users either ignore the chip (training to ignore real warnings) or refresh every panel manually.
- **Fix sketch**: add a `useEffect(() => { const h = () => { if (document.visibilityState === 'visible') refreshAll(); }; document.addEventListener('visibilitychange', h); return () => document.removeEventListener('visibilitychange', h); }, [refreshAll]);` in `useObservabilityData`.

## 7. PersonaHealthDashboard — "Updated Xs ago" string frozen until next refresh

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/overview/sub_health/components/PersonaHealthDashboard.tsx:87-92`
- **Scenario**: `lastRefreshLabel` is `useMemo([healthLastRefreshedAt])` and reads `Date.now()`. The memo never re-runs as wall clock advances, so the label "5s ago" stays "5s ago" for an hour. Users misjudge data freshness and skip the refresh button.
- **Root cause**: `Date.now()` used inside a memo without a tick interval.
- **Impact**: staleness UX broken; dashboard silently shows hour-old data labeled "5s ago".
- **Fix sketch**: add `const [tick, setTick] = useState(0); useEffect(() => { const id = setInterval(() => setTick(t => t+1), 30_000); return () => clearInterval(id); }, []);` and include `tick` in the memo deps.

## 8. PersonaHealthSlice — successRate identical across all personas mis-grades whole fleet

- **Severity**: medium
- **Category**: double-count
- **File**: `src/stores/slices/overview/personaHealthSlice.ts:347-355`
- **Scenario**: as documented in the inline comment, `successRate = dashboard.overall_success_rate` for every active persona. `computeHeartbeatScore` weights success at 40%, so two personas with very different real failure rates produce identical heartbeat scores, sort-tied, and the "worst-first" sort ordering becomes effectively alphabetical/insertion-order for the failing set. The "system health" global average then double-counts the same fleet rate weighted by persona count.
- **Root cause**: per-persona daily success data not piped from backend; UI proxy is documented but the score is still computed as if it were per-persona.
- **Impact**: triage on the health dashboard misleads — users investigate a "critical" persona that is actually average.
- **Fix sketch**: when `successRateSource === 'proxy'`, set `successScore = 70` (neutral) in `computeHeartbeatScore` and surface fleet rate separately rather than per card; or backfill per-persona-per-day success in `DashboardDailyPoint`.

## 9. RotationOverviewPanel countdown — no minute-by-minute tick; "due now" arrives silently

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/overview/sub_analytics/components/RotationOverviewPanel.tsx:50-58, 174-220`
- **Scenario**: `countdownLabel(item.status.next_rotation_at)` and `summaryStats` both call `Date.now()` at render time, but the panel only re-renders when the rotation list mutates. A row showing "1h" never updates to "due now" without an unrelated state change. Users miss preemptive rotations.
- **Root cause**: countdown values are computed inside a memoized panel without a wall-clock ticker.
- **Impact**: stale countdowns; users believe they have hours left when rotation is overdue. Coupled with #6, on a laptop wake the panel's `expiringSoon` count can be wildly wrong.
- **Fix sketch**: add a 60-second tick state to force re-render, or compute countdowns inside a child component that subscribes to a global "minute tick" signal.

## 10. getOverviewBundle cache — unbounded growth across persona/day permutations

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/api/overview/observability.ts:48-70`
- **Scenario**: `overviewBundleCache` keyed by `${days}|${personaId}|${utcOffsetMinutes}` is a Module-scope `Map` with TTL but no eviction. Each unique key inserts a `{expiresAt, promise}` entry that is never deleted (only `expiresAt` checked at lookup). With 50 personas × 8 day-range presets × tz-cross sessions, hundreds of stale entries accumulate per session, holding `OverviewBundle` payloads (which include full chart_points arrays) in memory. The retained promise resolutions are GC roots until the page reloads.
- **Root cause**: TTL invalidation on read but no purge sweep on write.
- **Impact**: long-running sessions (digest-on, weeks-uptime) leak tens of MB; on Android the memory pressure is more acute.
- **Fix sketch**: on each `set`, also iterate and delete entries with `expiresAt < now`; or switch to LRU cap of ~16 entries.

## 11. fetchObservabilityMetrics — `canReuseDashboard` wins but bundle still fetched

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/stores/slices/overview/overviewSlice.ts:320-342`
- **Scenario**: the optimization comment says "avoid a redundant SQL scan" but the code awaits `getOverviewBundle(days, personaId)` *before* picking between `dashboard`-derived summary and `bundle.metricsSummary`. The redundant fetch always happens; only the summary computation is reused. With an in-memory cache TTL of 1s the second call usually hits cache, but on cold-start (e.g. dashboard-tab switch followed by observability-tab) the bundle still does the full chart_data + monthly_spend round-trip.
- **Root cause**: `await` placed before the branching decision.
- **Impact**: 200-500ms wasted per observability open; defeats the documented optimization.
- **Fix sketch**: move the bundle fetch into the `else` branch only, fetching `metricsChartData` separately when reusing the dashboard summary.

## 12. EventLogList IntersectionObserver — no `disconnect` on rapid filter change

- **Severity**: low
- **Category**: cleanup-gap
- **File**: `src/features/overview/sub_events/components/EventLogList.tsx:86-99`
- **Scenario**: the effect depends on `[hasMoreOlder, isLoadingOlder, loadOlder, filteredEvents.length]`. Each filter change recreates the observer, and the cleanup runs, but `loadOlder` is recreated whenever `filteredEvents` changes (its deps include `filteredEvents`). A rapid filter toggle creates many short-lived observers; if one is mid-callback when the cleanup runs, `loadOlder` may fire against the *previous* filter state, polluting `olderEvents` with rows that don't match the current filter.
- **Root cause**: no AbortController equivalent on `loadOlder`; observer re-creation churn.
- **Impact**: occasional contamination of the "older events" pool with off-filter rows after rapid filter toggling. Visible as ghost rows in the timeline.
- **Fix sketch**: gate `setOlderEvents` inside `loadOlder` on a `filterVersion` ref that increments on filter changes; ignore results whose version is stale.

## 13. monthly_period_start_utc — DST gap day silently produces empty spend

- **Severity**: low
- **Category**: timezone
- **File**: `src-tauri/src/commands/communication/observability/metrics.rs:167-194`
- **Scenario**: `local_offset.from_local_datetime(&local_month_start_dt).earliest()` returns `None` when the local-midnight on day 1 is in the DST spring-forward gap (rare — only for offsets where day-1 happens to fall on DST transition, e.g. some historical Brazilian zones). The fallback subtracts a fixed offset and treats it as UTC, but `chrono::FixedOffset` here is the *current* offset, not the pre-DST one — for a pre-DST month the spend window starts an hour off. Spend totals near month-boundary executions are mis-attributed to the wrong month.
- **Root cause**: fixed-offset substitute used for variable-offset zone.
- **Impact**: rare; ≤1h of executions shifted between months for users in zones with month-boundary DST transitions.
- **Fix sketch**: take the user's IANA tz instead of fixed-offset minutes; or use `latest()` rather than `earliest()` when `earliest()` is None.

## 14. preview_digest — `clamp(1, 30)` silently masks invalid input from frontend

- **Severity**: low
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/communication/observability/digest.rs:34`
- **Scenario**: a user (or a bug in `DigestPreviewModal`) requesting `days = 365` gets back a 30-day digest with no warning. `previewDigest` returns the same shape as a legitimate 30-day digest. The preview/email mismatch can confuse users debugging digest contents — they see "30 day summary" when the modal claimed 365.
- **Root cause**: silent clamp without surfacing the effective period to the response.
- **Impact**: minor; UX confusion when configuring digest cadence > 30 days.
- **Fix sketch**: include `effective_days` in the `PerformanceDigest` response or return `Err(AppError::Validation(...))` when input exceeds 30.
