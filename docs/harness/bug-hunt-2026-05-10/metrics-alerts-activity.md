# Bug Hunt — Metrics, Alerts & Activity

> Group: Overview & Observability
> Files scanned: 10 (scoped paths did not exist verbatim — analyzed actual analogs:
> `sub_observability/components/MetricsCharts.tsx`, `AlertHistoryPanel.tsx`,
> `AlertRulesPanel.tsx`, `AlertToastContainer.tsx`, `useObservabilityData.ts`,
> `sub_activity/components/ExecutionMetricsDashboard.tsx`, `MetricsCharts.tsx`,
> `useExecutionMetrics.ts`, `stores/slices/overview/alertSlice.ts`,
> `stores/slices/processActivitySlice.ts`,
> `src-tauri/.../observability/metrics.rs`, `observability/alerts.rs`,
> `db/repos/communication/alert_rules.rs`)
> Total: 3C / 5H / 4M / 2L = 14 findings

---

## 1. Alert evaluator runs on every metrics fetch — bypasses cooldown via toast/persist storm on rapid refresh

- **Severity**: critical
- **Category**: race-condition
- **File**: `src/features/overview/sub_observability/libs/useObservabilityData.ts:69-71`
- **Scenario**: `useEffect(() => { if (observabilityMetrics) evaluateAlertRules(); }, [observabilityMetrics, evaluateAlertRules])`. The polling refresh in `refreshAll` calls `fetchObservabilityMetrics` which produces a *new object identity* on every poll (the chartData / summary are freshly constructed), so the effect fires on every poll tick (default 30s). The cooldown in the slice is per-rule `FIRED_COOLDOWN_MS = 1h`, but the *evaluator itself* has no debounce — combined with multi-tab usage and React 18 strict-mode double-invoke, an alert that briefly oscillates around the threshold (e.g. error_rate 9.9% / 10.1%) fires once, persists, and after the 1h cooldown elapses fires again immediately on the very next poll because the cooldown is checked, deleted, and the rule re-evaluated in the same tick — but no "still elevated since" smoothing exists.
- **Root cause**: Cooldown is a single timestamp gate, not a debouncer over the threshold-time integral. Coupling eval to fetch identity means any unrelated chart-point append (a single new execution row) re-runs the entire eval pipeline.
- **Impact**: User is woken by a toast every hour for a metric that never genuinely improved; after they `clearFiredAlerts` the row reappears within seconds because cooldown was wiped along with history.
- **Fix sketch**: Track `lastFiredValue` per rule and require the metric to *cross back* under threshold before re-arming. Also debounce eval to once per N seconds regardless of fetch identity.

## 2. `clearAlertHistory` does not clear cooldowns — UI shows "no alerts" while system silently suppresses real ones

- **Severity**: critical
- **Category**: alert-bypass
- **File**: `src/stores/slices/overview/alertSlice.ts:308-316`
- **Scenario**: User clears alert history. `alertHistory` is emptied and `pendingSyncAlertIds` reset, but `alertFiredCooldowns` retains all per-rule timestamps. Within the next hour, a genuine repeat threshold breach is *suppressed* because the cooldown gate (line 376-379) sees `firedTs != null && now - firedTs < FIRED_COOLDOWN_MS` and `continue`s. Severity is critical because the UI strongly implies the slate is clean ("Clear" button, empty state).
- **Root cause**: Cooldown lifetime decoupled from history lifetime — they should be coterminous from the user's perspective.
- **Impact**: Operator clears an alert storm to "start fresh", a real production incident hits in the next 60 minutes, no toast, no row, no Sentry signal — silent failure window of up to one hour.
- **Fix sketch**: In `clearAlertHistory`, also `set({ alertFiredCooldowns: {} })`. Document that "clear" means "rearm".

## 3. Optimistic fired-alert insert mutates UI but `pendingSyncAlertIds` retry loop is unbounded — memory leak + duplicate persistence

- **Severity**: critical
- **Category**: backpressure
- **File**: `src/stores/slices/overview/alertSlice.ts:327-344, 432-445`
- **Scenario**: Backend `create_fired_alert` is unavailable (e.g. DB lock). Each eval cycle (every poll) iterates over `pendingSyncAlertIds`, calling `api.createFiredAlert(alert)` *for every pending alert in parallel, every cycle*. There is no per-alert backoff and no "in flight" guard. After 30 minutes of backend downtime with 50 fired alerts pending, you have launched ~3000 concurrent IPC calls; once the backend comes back, every still-in-flight retry succeeds — the same alert id is INSERT'd repeatedly. `fired_alerts.id` lacks `ON CONFLICT` handling in `create_fired_alert` (alert_rules.rs:267) so the insert errors after the *first* succeeds, but during the racing window multiple concurrent inserts may both observe "no row exists" and complete the INSERT side-effect before the constraint fires (SQLite serializes, so usually only the first wins, but the *retry storm* itself stays).
- **Root cause**: No in-flight set, no exponential backoff. The pending set is also re-iterated on the same eval tick that schedules new alerts (line 433-444 schedules new alert persistence with the same fire-and-forget pattern).
- **Impact**: Unbounded outstanding IPC promises during backend downtime; on reconnection, log spam and (best case) constraint-error noise; (worst case) duplicate rows if the unique constraint isn't on `id`.
- **Fix sketch**: Track `inFlightAlertIds: Set<string>`, check before launching a retry, drop on settle. Add jittered backoff at the slice level (e.g. only retry every Nth eval cycle).

## 4. `cost_spike` rule evaluates current cost / *avg-of-current-window* — division by tiny numerator on first day of new window inflates spike

- **Severity**: high
- **Category**: divide-by-zero
- **File**: `src/stores/slices/overview/alertSlice.ts:354-365, 64`
- **Scenario**: `avgDailyCost = chartData.reduce(sum) / chartData.length`. Day 1 of a freshly opened account or after a clear-data action: chartData has one point, today's cost is $0.50, avg is $0.50, ratio = 1. Day 2: today $5.00, avg = (0.50 + 5.00)/2 = $2.75, ratio = 1.81. So far so good — but if `chartData.length === 0` the `> 0` guard returns `value = 0` and a `cost_spike < 1` rule (designed to catch *drops*, e.g. `<` operator) fires spuriously. Conversely, with `avgCostUsd > 0` but very small (e.g. $0.001 from a single test execution yesterday), today's $0.50 produces a 500x ratio that immediately fires *every* spike rule.
- **Root cause**: Average includes today in the denominator, then the comparison divides today by that mean. Should compare today vs. the *historical* mean (excluding today) and require a minimum baseline floor.
- **Impact**: First days after cache clear, weekend lulls, or low-traffic personas produce phantom spike alerts that crowd out real ones.
- **Fix sketch**: Compute `avgDailyCost` from `chartData.slice(0, -1)` and bail with `triggered: false` if baseline is below a $1.00 floor. Add a unit test for `[$0.001, $0.50]` series.

## 5. AlertToast `onDismiss` identity changes every render — auto-dismiss timer resets infinitely, toast never disappears

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/overview/sub_observability/components/AlertToastContainer.tsx:19-22, 53`
- **Scenario**: `useEffect(() => { const timer = setTimeout(onDismiss, 8000); return () => clearTimeout(timer); }, [onDismiss])`. Parent passes `onDismiss={() => dismissToast(alert.id)}` — a new arrow function every render. Whenever `activeToasts` mutates (e.g. another alert fires, or React re-renders for any reason), every existing toast's effect tears down its timer and starts a fresh 8s countdown. Under a steady stream of alerts (one every <8s), no toast ever auto-dismisses and they pile until the `slice(0, 5)` cap silently drops the older ones — but `activeToasts` itself grows unbounded in store state.
- **Root cause**: Inline function in JSX + effect dep on the function. Classic stale-closure / restart-timer bug.
- **Impact**: Memory growth in `activeToasts`, broken auto-dismiss UX, and the user's "5 most recent" view excludes older but still-active alerts.
- **Fix sketch**: `useEffect(() => { const t = setTimeout(() => dismissToast(alert.id), 8000); return () => clearTimeout(t); }, [alert.id, dismissToast])` — depend on stable id, not the closure.

## 6. `monthly_period_start_utc` uses *current* offset for *historical* month boundary — DST shifts misclassify month-end spend

- **Severity**: high
- **Category**: timezone
- **File**: `src-tauri/src/commands/communication/observability/metrics.rs:167-194`
- **Scenario**: User in Europe/Berlin runs query on Apr 1 03:00 local (CEST, UTC+2). The function computes "start of April in local TZ" as Apr 1 00:00+02:00 = Mar 31 22:00Z. Correct. Now run the same query on Mar 1 03:00 local — Berlin was still on CET (UTC+1) on Feb 28, but the function applies *today's* UTC+2 offset to a moment when the actual local offset was UTC+1. Result: month-start is computed 1h off. Executions logged Feb 28 23:00–24:00 UTC are incorrectly attributed to either Feb or Mar depending on rounding. Worst case is the southern-hemisphere DST flip at month boundary.
- **Root cause**: `FixedOffset` is wrong abstraction for a tz-aware boundary; using `chrono_tz::Tz::Europe__Berlin` would resolve. The code accepts only `utc_offset_minutes`, throwing away the historical context entirely.
- **Impact**: Monthly budget caps reset 1h early/late twice a year for any user in a DST-observing tz; month-boundary executions attributed to wrong month, tipping spend over `max_budget_usd` invisibly.
- **Fix sketch**: Accept IANA tz name from frontend; use `chrono_tz` crate; if not feasible, document the 1h boundary fuzz and align rule evaluation with the same fuzz.

## 7. `processEnded` strict-key refusal silently leaks `running` rows when caller forgets runId

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src/stores/slices/processActivitySlice.ts:159-180, 210-228`
- **Scenario**: `findUniqueProcessKey` returns `null` and `console.warn`s when 2+ `domain:*` rows exist and caller didn't supply runId. `processEnded` then `return state` — no removal, no error event, no UI signal. Two concurrent execution runs share `domain="execution"`; the legacy completion event handler emits `processEnded("execution")` for either run after a refactor; both rows sit `running` in the activity dock indefinitely until `clearNonActive` is invoked manually.
- **Root cause**: Defensive refusal is correct (per the doc-comment) but only `console.warn` notifies the developer — production users see ghost-running entries with no path to recovery.
- **Impact**: Activity dock leaks "running" rows whenever upstream emit-site forgets runId; over a session this masks the real running set and breaks "stop all" flows.
- **Fix sketch**: When refusing, also attach a Sentry breadcrumb and surface a "stuck process detected" toast with a "Clear stuck" CTA. Better: emit the event with runId at every call site (audit them).

## 8. `processStarted` clobbers in-flight `costUsd` and `toolCallCount` if the same `(domain, runId)` re-emits

- **Severity**: high
- **Category**: aggregation-loss
- **File**: `src/stores/slices/processActivitySlice.ts:191-208`
- **Scenario**: Backend re-emits `process_started` (e.g. retry, reconnect, hot-reload of the listener) for an execution already running with `toolCallCount: 47, costUsd: 0.83`. The reducer rebuilds the object with `toolCallCount: 0, costUsd: 0` while preserving only `label` and `navigateTo` from the existing row. Subsequent `enrichProcess` updates *replace* whatever cumulative count the next event carries (the IPC payload usually sends current totals, but if it sends deltas, the lost prefix is permanent).
- **Root cause**: Reducer uses object-literal that doesn't spread `existing`. Treats start as authoritative reset rather than idempotent.
- **Impact**: Cost telemetry rolls back to zero mid-run; users observing the activity dock see lying numbers; budget alerts that reference these counters under-report.
- **Fix sketch**: If `state.activeProcesses[key]?.status === "running"`, preserve `toolCallCount`, `costUsd`, `lastEvent` rather than overwriting; only reset on transition from a terminal state.

## 9. `MAX_ALERT_HISTORY = 200` truncation is applied client-side after merge — fired alerts that fell off the client list are still in `pendingSyncAlertIds`

- **Severity**: medium
- **Category**: backpressure
- **File**: `src/stores/slices/overview/alertSlice.ts:35, 411-415`
- **Scenario**: After a burst of >200 alerts, `alertHistory.slice(0, MAX_ALERT_HISTORY)` drops the oldest. Their ids however remain in `pendingSyncAlertIds`. Next eval cycle, the retry loop at line 329-344 filters `alertHistory.filter(a => pendingSyncAlertIds.has(a.id))` — the alert is no longer in `alertHistory`, so retry is silently skipped, but the id stays in the pending set forever. Set grows unbounded over a long session even after the alerts are forgotten.
- **Root cause**: Two truncation strategies — bounded list, unbounded id set — get out of sync.
- **Impact**: Memory growth proportional to alerts ever fired; `pendingSyncAlertIds` serialization in any future persistence becomes a hidden bloat vector.
- **Fix sketch**: When slicing `alertHistory`, also `pending.delete(droppedId)` for every alert removed from the tail.

## 10. `formatAlertMessage` misformats whole-number thresholds for non-unit metrics — message lies about the rule

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/stores/slices/overview/alertSlice.ts:96-103`
- **Scenario**: Rule `metric: 'executions', operator: '>=', threshold: 1500.5` (a fractional threshold permitted by `step="any"` in the form). Message renders `String(rule.threshold)` → "1500.5" — but `value` is rendered as `Math.round(value)` → e.g. "1501" rounded from 1500.7. The user sees "executions is 1501 (threshold: >= 1500.5)" where the rounded display value contradicts the literal trigger comparison done on the raw value (1500.7 >= 1500.5 → triggered, but UI suggests it was 1501 vs 1500.5).
- **Root cause**: Display rounding inconsistency between value and threshold.
- **Impact**: Confusing alert text; harder to reproduce the trigger; user-reported bug "alert fired at threshold X but value shown is Y".
- **Fix sketch**: Use `value.toLocaleString(undefined, { maximumFractionDigits: 2 })` consistently for both `value` and `threshold`.

## 11. `EvalHealthIndicator` `agoText` rounds 30s to "0s ago" via `Math.round(age/60_000)` cliff at 60s

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/overview/sub_observability/components/AlertRulesPanel.tsx:200-208`
- **Scenario**: At `age = 30000` ms, branch 1 fires: `Math.round(30000/1000) = 30` → "30s ago". OK. At `age = 30 * 60_000 = 1800000`, branch 2 fires: `Math.round(1800000/60_000) = 30` → "30m ago". OK. But the indicator never re-renders unless the parent re-renders — there's no `setInterval` to tick the relative time. Run the eval once, leave the panel idle 90 minutes; the indicator still says the original "30s ago" until something else triggers a re-render. User believes evaluation just ran when in fact it stalled.
- **Root cause**: Stale-time bug — relative-age display without periodic re-render.
- **Impact**: Health dot stays green showing "1s ago" while the eval engine has been silently dead for an hour; defeats the purpose of the indicator.
- **Fix sketch**: `useEffect(() => { const t = setInterval(forceUpdate, 30_000); return () => clearInterval(t); }, [])` or use a `useNow()` hook.

## 12. `LIMIT ?1` accepts user-passed limit but `clamp(1, 1000)` allows 1000 rows in a single IPC — UI never asks for more than 200

- **Severity**: medium
- **Category**: backpressure
- **File**: `src-tauri/src/db/repos/communication/alert_rules.rs:234-261`
- **Scenario**: `MAX_ALERT_HISTORY = 200` in the slice, but the Tauri command accepts up to 1000. Any caller (a future "export all" flow, a Leon Devtools panic) passing 1000 ships a 1000-row IPC payload of `FiredAlert` objects across the bridge each fetch. Each row contains a free-form `message` string that has no length cap on the Rust side either — a malicious alert rule name + crafted `formatAlertMessage` could yield large strings. Combined with the auto-refresh polling, this is a steady drip of large IPC payloads.
- **Root cause**: Mismatched limits between client expectation and server contract.
- **Impact**: Memory bloat in renderer process if any future caller bumps the limit; serialization cost on every poll.
- **Fix sketch**: Lower server clamp to 200, or paginate. Add a length cap to message column.

## 13. `costAnomalies.find((a) => a.date === date)` in MetricsCharts iterates per-click — quadratic with anomaly count and ignores duplicates

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/overview/sub_observability/components/MetricsCharts.tsx:49-53, 47`
- **Scenario**: When the backend returns multiple anomalies for the same `date` (cost+latency on the same day, or two rollups merged), `find` returns only the first match. Click handler ignores the others — the drill-down panel always shows the first variant.
- **Root cause**: Anomaly identity assumes uniqueness on date, but the type allows multiple metrics per date and the `costAnomalies` filter doesn't dedupe.
- **Impact**: Latency anomaly hidden behind cost anomaly on same date; user clicks the marker, drilldown loads cost-only context.
- **Fix sketch**: Key by `(metric, date)` or render multiple ReferenceLines stacked. Add a "+N more" indicator if duplicates exist.

## 14. `clearNonActive` drops `recentProcesses` even when only history is being cleared — kills "last 10 completed" forever

- **Severity**: low
- **Category**: cleanup-gap
- **File**: `src/stores/slices/processActivitySlice.ts:317-328`
- **Scenario**: Doc-comment says "drops every non-running entry plus all recent history" — reasonable for "clear all" but there is no API for "clear only recent" or "clear only stuck non-running". A user who clicks "Clear" wanting to dismiss a single failed entry wipes the entire recent history (last 10) including useful completed ones they were about to re-open.
- **Root cause**: Single coarse "clear" action rather than per-row dismiss.
- **Impact**: User loses access to recent execution navigation context; needs to re-open them from main execution list.
- **Fix sketch**: Add `dismissRecent(key)` for single-row removal; keep `clearNonActive` for the "nuke everything" use case.

