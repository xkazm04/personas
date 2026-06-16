# Bug Hunter — Dashboard & Mission Control

> Total: 5 findings (0 critical, 2 high, 3 medium, 0 low)
> Context: dashboard-mission-control | Group: Observability & Analytics

## 1. Upcoming routines freeze at mount time — labels never tick, past runs never drop
- **Severity**: High
- **Category**: Latent failure / stale data (frozen clock)
- **File**: `src/features/overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx:57-80`
- **Scenario**: The card fetches triggers once on mount and computes `const now = Date.now()` inside a `useMemo` keyed only on `[triggers, personas]`. The dashboard (and this card, inside `DeferUntilIdle`) stays mounted for the whole session. A routine scheduled "2m" out still reads "2m" ten minutes later; once its fire time passes, the `row.nextAt >= now` filter (line 73) that is supposed to drop past runs never re-evaluates, so the stale row lingers as a future routine that already fired.
- **Root cause**: No ticking clock. `now` is captured once and there is no `setInterval`/`requestAnimationFrame` to force periodic recomputation, and no re-fetch of `next_trigger_at` (the scheduler advances it server-side but the client never re-reads it).
- **Impact**: "Upcoming Routines" silently shows wrong, increasingly-wrong relative times and may list runs that already happened — the exact "upcoming-routines showing past times" failure the panel exists to prevent.
- **Fix sketch**: Add a `setInterval` (e.g. every 30–60s) that bumps a `nowTick` state used as a memo dependency; clear it on unmount. Optionally re-fetch `listAllTriggers()` on the same cadence (or on a dashboard-refresh event) so `next_trigger_at` stays current. Guard the interval so it does not run while the tab is hidden.

## 2. Cost-anomaly "Cost Spike Detected" is not time-bounded — a 29-day-old spike shows as a live critical
- **Severity**: High
- **Category**: Silent failure / stale critical alert
- **File**: `src/features/overview/libs/fleetOptimizer.ts:151-172`
- **Scenario**: The code comment says "Check for cost anomalies (most urgent)" and names the array `recentAnomalies`, but the filter is purely `a.deviation_sigma >= 2.0` with no recency constraint. `dashboard.cost_anomalies` spans the full 30-day window. A spike that happened weeks ago keeps rendering as a `severity: 'critical'` "Cost Spike Detected" card at the very top of the dashboard for the rest of the window, outranking genuinely actionable current issues.
- **Root cause**: Missing date filter. "Recent" is asserted in the name/comment but never enforced against `worst.date`. The recommendation `id` is keyed on `worst.date`, so it is stable and never expires on its own.
- **Impact**: Success theater in reverse — a permanently-pinned critical alert for a long-past event trains users to ignore the highest-priority slot, and buries newer optimization recs (wasteful/downgrade/healing) which are gated behind the anomaly branch returning early.
- **Fix sketch**: Filter anomalies to the last N days (e.g. `Date.now() - new Date(a.date).getTime() <= 3*86_400_000`) before the `deviation_sigma` check, and/or de-prioritize anomalies older than a threshold so they fall below current persona-level recs.

## 3. Success-rate uses lifetime healing count against windowed executions → false "High Cost, Low Success"
- **Severity**: Medium
- **Category**: Edge case / divide-and-clamp misattribution
- **File**: `src/features/overview/libs/fleetOptimizer.ts:104-110` (with `healingSlice.ts:38-45`)
- **Scenario**: `derivePerPersonaPerformance` computes `failedEstimate = healing.total` and `successRate = (totalExecs - failedEstimate) / totalExecs * 100`. But `totalExecs` comes from the dashboard windowed to `days` (30), while `healingIssues` comes from `listHealingIssues()` which fetches **all** issues with no date window. A persona with 6 recent executions but 20 lifetime healing issues yields `(6 - 20)/6` → negative, clamped to `0%` success (line 108). That trips the `successRate < 60` "High Cost, Low Success" warning (line 177) on a persona that may currently be healthy.
- **Root cause**: Two data sources with mismatched time windows are combined as if 1 healing issue == 1 failed execution in the same period. The clamp hides the impossible (>100% failure) result instead of rejecting it.
- **Impact**: Dashboard's top optimization rec can accuse a fine persona of being expensive-and-broken, pushing the user to "investigate failures" / downgrade a model that does not need it.
- **Fix sketch**: Window healing issues to the dashboard period (filter by `created_at`/`updated_at >= cutoff`), or stop treating `healing.total` as the failure numerator — derive failures from `daily_points` (`failed` counts) and use healing issues only as a secondary reliability signal. Skip the success-rate heuristic when `failedEstimate > totalExecs`.

## 4. Certification run-detail fetch has no sequence guard — clicking two runs shows the wrong one
- **Severity**: Medium
- **Category**: Race condition (last-write-wins)
- **File**: `src/stores/slices/overview/certificationSlice.ts:84-94` (consumed at `CertificationCommandCenter.tsx:41-47`)
- **Scenario**: `handleSelectRun` flips `detailMode=true` and calls `loadEvalRunDetail(runId)`. If the user clicks run A then quickly run B (large bundles on disk, slow `fetchEvalRun`), both requests are in flight; whichever resolves last wins `set({ evalRunDetail })`. Unlike `fetchGlobalExecutions`/`fetchGlobalExecutionCounts` in `overviewSlice.ts`, which use `fetchGlobalSeq`/`fetchGlobalCountsSeq` to discard stale responses, this slice has no such guard.
- **Root cause**: No request-ordering token; the detail view trusts the latest resolution rather than the latest request.
- **Impact**: User opens run B but is shown run A's pass/fail results under run B's framing — wrong certification status presented as authoritative, with no error to signal the mismatch.
- **Fix sketch**: Add a module-scope `loadDetailSeq` counter; capture `const seq = ++loadDetailSeq` at call start and `if (seq !== loadDetailSeq) return;` before each `set()`. Optionally store the requested `runId` alongside the detail and ignore responses whose id no longer matches the active selection.

## 5. Empty-fleet "healthy" rec divides anomaly/persona data that may be zero-length and shows 0% as a status
- **Severity**: Medium
- **Category**: Edge case / missing-data defensive gap
- **File**: `src/features/overview/libs/fleetOptimizer.ts:244-256` (gate at `FleetOptimizationCard.tsx:249-252`)
- **Scenario**: The healthy-fleet branch reports `${dashboard.top_personas.length} agents with ${Math.round(dashboard.overall_success_rate)}% success rate`. When the backend returns `total_executions >= MIN_EXECUTIONS` (5) but `top_personas` is empty (e.g. cost rollup not yet computed, or all executions lack a persona join), the card states "5 executions across 0 agents with 0% success rate. No optimization needed." The card-level guard only suppresses healthy_fleet when `total_executions < 10`, so this contradictory message renders. `overall_success_rate` is trusted raw with no `Number.isFinite` sanitization — a NaN/null from the backend would render "NaN%".
- **Root cause**: The "healthy" string interpolates server fields (`top_personas.length`, `overall_success_rate`) without checking they are coherent/finite; the only defensive gate is a magic `< 10` execution threshold on the consumer side.
- **Impact**: At-a-glance dashboard states "0 agents, 0% success" while simultaneously claiming the fleet is healthy and needs no action — a trust-eroding contradiction, and a NaN%/Infinity% leak if numeric fields are malformed.
- **Fix sketch**: In the healthy branch, return `null` (no rec) when `top_personas.length === 0`; sanitize `overall_success_rate` with `Number.isFinite(x) ? Math.round(x) : 0` and clamp 0–100; phrase the count from a sanitized agent total rather than raw array length.
