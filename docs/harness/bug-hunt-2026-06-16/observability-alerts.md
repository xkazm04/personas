# Bug Hunter — Observability & Alerts

> Total: 5 findings (0 critical, 3 high, 2 medium, 0 low)
> Context: observability-alerts | Group: Observability & Analytics

## 1. Persona-scoped alert rules evaluate against global metrics — wrong alerts fire (or don't)
- **Severity**: High
- **Category**: Latent failure / correctness
- **File**: `src/stores/slices/overview/alertSlice.ts:384`
- **Scenario**: A user creates a rule "error_rate > 50% for persona A". Persona A is failing hard, but the rest of the fleet is healthy, so the aggregate `summary.failedExecutions / decided` sits at 8%. The rule never fires. Conversely, an unrelated noisy persona B pushes the global error rate over 50% and the persona-A rule fires for a persona that is perfectly healthy.
- **Root cause**: `evaluateAlertRules` builds one `MetricsSnapshot` from `state.observabilityMetrics.summary` and feeds the SAME snapshot to every rule in the loop (`for (const rule of state.alertRules)`). `rule.persona_id` is stored, serialized, and shown in the UI ("· Global / · PersonaName") but is never used to select a per-persona metric window. The snapshot only reflects the dashboard's *currently-selected* filter persona, which is unrelated to the rule's scope. Lines 230/248/412 are the only references to `persona_id`, and all are pass-through.
- **Impact**: Every persona-scoped rule produces false negatives and false positives. The scope dropdown is success theater — it looks like per-persona alerting works, but evaluation is global. Users trust alerts that are silently mis-scoped.
- **Fix sketch**: Either (a) fetch a per-persona metrics summary keyed by `rule.persona_id` and evaluate each rule against its own snapshot, or (b) until that exists, refuse to evaluate persona-scoped rules and surface "scope not yet supported" in the rule row rather than silently mis-firing.

## 2. In-memory-only cooldown re-fires every persisted alert on each reload
- **Severity**: High
- **Category**: Latent failure / duplicate alerts
- **File**: `src/stores/slices/overview/alertSlice.ts:181`
- **Scenario**: A "cost > $5" rule fires once and is persisted. The user keeps the app open or reopens it the next morning while the condition is still true (cost is cumulative over the window). On reload, `evaluateAlertRules` runs as soon as metrics arrive, sees an empty cooldown map, re-evaluates, and fires + persists a brand-new `FiredAlert` for the same already-known condition. Repeat on every app restart or HMR reload during a dev session.
- **Root cause**: `alertFiredCooldowns` is initialized to `{}` (line 181) and lives only in the ephemeral store — it is never hydrated from `alertHistory` or persisted. The 1h `FIRED_COOLDOWN_MS` guard (line 168) is therefore reset to empty on every load, while the underlying metric window (cost/executions over N days) stays above threshold for the whole window. There is no dedup against existing `fired_alerts` rows on the backend either (`create_fired_alert` blindly INSERTs, alert_rules.rs:264).
- **Impact**: Alert history fills with duplicate rows for the same persistent condition; the "active count" badge inflates; the cross-source incidents promoter (alert_rules.rs:287) gets duplicate incidents. Noise erodes trust and buries real new alerts.
- **Fix sketch**: On `fetchAlertHistory`, seed `alertFiredCooldowns` from the most recent `fired_at` per `rule_id`; or have `create_fired_alert` dedup on (rule_id, fired_at within cooldown) before inserting.

## 3. Alerts never fire unless the Observability tab is open
- **Severity**: High
- **Category**: Silent failure / alerts silently not firing
- **File**: `src/features/overview/sub_observability/libs/useObservabilityData.ts:69`
- **Scenario**: A user configures critical alerts ("error_rate > 50%", "cost > $20") and navigates away to the Personas or Events tab — or simply never opens the Observability sub-tab. Executions fail in droves; cost spikes. No alert ever fires, no toast appears, no history row is written. The user believes alerting is protecting them.
- **Root cause**: The only caller of `evaluateAlertRules` is the `useEffect` in `useObservabilityData` (line 70), which runs when `observabilityMetrics` changes. That hook lives in the observability dashboard component tree, so evaluation only happens while that view is mounted AND metrics are (re)fetched. There is no background timer, no app-level evaluation loop, and no backend-side evaluation. Auto-refresh (`autoRefresh`) defaults to `false` (useObservabilityData.ts:43), so even with the tab open, metrics — and thus evaluation — are static unless manually refreshed.
- **Impact**: Client-side, mount-gated evaluation means the alerting system is effectively a "view this panel to maybe see an alert" feature, not a monitor. This is the most dangerous silent failure: the feature appears configured and healthy (eval-health dot is green from the last time the panel was open) while firing nothing.
- **Fix sketch**: Move evaluation to an app-level interval (e.g. in a root provider) that fetches metrics + evaluates regardless of the active tab; ideally evaluate server-side on metric write so alerts fire headless.

## 4. IPC timeout/error rates divide cumulative count by a 500-cap window — rates wrong after 500 calls
- **Severity**: Medium
- **Category**: Silent failure / IPC perf numbers wrong
- **File**: `src/lib/ipcMetrics.ts:133`
- **Scenario**: A long session makes 10,000 IPC calls with 50 timeouts spread throughout. The ring buffer holds only the last 500 records. `getGlobalSummary` reports `totalCalls: 10000` (cumulative `totalRecords`) but computes `timeoutRate = timeouts / records.length` where `records.length` is capped at 500 and `timeouts` only counts timeouts *still in the 500-record window*. The displayed "calls" and the denominator behind the rate refer to different populations.
- **Root cause**: Mixing two counters: `totalCalls` uses the monotonic `totalRecords`, but `timeoutRate`/`errorRate`/percentiles use the bounded `records` array. Once `totalRecords > RING_SIZE` (500), the rate denominator and the headline count diverge. The rate becomes "rate over the most recent 500 calls" while presented next to a 10,000 call total, so a burst of old timeouts vanishes and a recent burst is over-weighted.
- **Impact**: The IPC performance panel's "X% timeouts / errors" badge (IpcPerformancePanel.tsx:194,250) is misleading for any non-trivial session — it under- or over-reports depending on when failures occurred. Operators chasing a perf regression get a number that silently drifts from reality.
- **Fix sketch**: Either report rates explicitly as "over last N calls" using `records.length` consistently for the count too, or maintain separate monotonic timeout/error counters alongside `totalRecords` and divide cumulative-by-cumulative.

## 5. `>=`/`<=` operators with a default threshold of 0 make "executions" and rate rules fire constantly
- **Severity**: Medium
- **Category**: Edge case / boundary (>= vs >)
- **File**: `src/stores/slices/overview/alertSlice.ts:99`
- **Scenario**: A user picks metric "executions", operator ">=", and leaves/sets threshold to 0 (the threshold input accepts 0 and the create command only rejects non-finite values — alerts.rs:25). On the very next eval, `value >= 0` is always true, so the rule fires immediately every cooldown window forever. Same with "success_rate <= 0" when there are zero decided executions: `evaluateRule` returns `value = 0` for an empty window (lines 64/69), and `0 <= 0` (or `0 >= 0`) is true — an empty/idle system trips a rate alert.
- **Root cause**: No semantic validation of threshold-vs-operator. `>=`/`<=` at the natural floor (0 executions, 0% rate) are trivially satisfiable. The empty-metric-window guard returns `0` rather than "no data / skip" (lines 63-65, 67-69), so a system with zero completed runs is treated as 0% success / 0% error and can satisfy `<=`/`>=` rules — firing alerts on a quiescent system that has no data at all.
- **Impact**: Constantly-firing rules flood history and toasts; rate rules fire on idle systems with no executions (false positive on "no data"). Combined with finding #2, this generates a duplicate every reload.
- **Fix sketch**: When the metric window has zero decided executions (rate metrics) or zero total executions, return `triggered: false` / skip rather than evaluating against a synthetic 0; optionally warn in the UI when a `>=`/`<=` rule is created at the metric's floor.
