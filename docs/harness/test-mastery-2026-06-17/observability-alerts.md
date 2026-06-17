# Test Mastery — Observability & Alerts
> Total: 7 findings (1 critical, 4 high, 2 medium, 0 low)

## 1. Client-side alert evaluation engine (`evaluateRule` + `evaluateAlertRules`) is wholly untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src/stores/slices/overview/alertSlice.ts:52-116 (`evaluateRule`, `formatAlertMessage`), :338-500 (`evaluateAlertRules`)
- **Current test state**: none (grep for `evaluateRule`/`evaluateAlertRules`/`alertSlice` in `*.test.ts` → nothing; `src/api/__tests__/observability.test.ts` only mocks the IPC wrappers and asserts pass-through)
- **Scenario**: This is *the* code that decides whether an alert fires. A regression here means the system silently fails to warn operators about cost overruns, error spikes, or runaway executions — the entire business purpose of this context. Concretely-at-risk behaviors with no test today: (a) `error_rate`/`success_rate` use the *decided* denominator (`successful + failed`), not `totalExecutions` — the comment at :57-62 documents a prior bug where dividing by all statuses let an error_rate rule sit under threshold while the SLA card showed higher; nothing guards that regression from returning. (b) the per-operator comparison (`>`, `<`, `>=`, `<=`) at :100-105. (c) `cost_spike` swapping in `todayCost` vs `avgCostUsd` (:410-411, :77). (d) the 1-hour cooldown incl. the persisted-fired-alert fallback (:395-406) that stops a rule re-firing every cycle after reload. (e) the `never`-exhaustiveness default firing Sentry + returning `triggered:false` (:82-96).
- **Root cause**: pure decision logic lives inside a zustand slice closure; never extracted or exercised. The API test suite gives false confidence (it tests transport, not the metric→fire decision).
- **Impact**: a wrong denominator, flipped operator, or broken cooldown ships green and the product stops alerting — operators learn about a cost blowup or outage from the bill, not the app.
- **Fix sketch**: export `evaluateRule` (and ideally `formatAlertMessage`) and add a vitest table covering each metric × each operator at/above/below threshold, plus: zero-decided-runs → value 0 (no divide-by-zero fire), `cost_spike` with avg=0 → value 0, and `success_rate + error_rate` summing to 100 on the same snapshot. Add a slice-level test (zustand store + mocked `@/api/overview/observability`) asserting: a triggering enabled rule pushes one `FiredAlert` and sets cooldown; a second eval inside the cooldown window does NOT re-fire; a disabled rule is skipped; cooldown is honored via persisted `alertHistory.fired_at` after an in-memory reset. **Invariants**: error_rate = failed/(succ+failed)·100; success+error = 100; no fire when decided==0; cooldown suppresses repeat within `FIRED_COOLDOWN_MS`.

## 2. Heatmap insight derivation (`derive_heatmap_insights` + `quartile_thresholds`) has no test
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/execution/metrics.rs:2012-2110
- **Current test state**: none meaningful — the file's `#[cfg(test)]` module (2112-2163) only covers prompt-version increment and an empty summary
- **Scenario**: longest-streak, dormant-days, week-over-week %, peak day, and the 4 quartile color thresholds all derive from a `Vec<HeatmapDay>` via pure date-walk arithmetic. Edge cases that silently produce wrong UI today: previous_week==0 → WoW must be `None` (not Inf/NaN), an all-zero window → `dormant_days: None` + `intensity_thresholds: [1,1,1,1]`, a single active day → streak 1, and quartile `max()` monotonicity (q1≤q2≤q3≤q4) on tiny samples.
- **Root cause**: logic is pure and trivially unit-testable but was never split into a table test; the DB-shaped wrapper discouraged it.
- **Impact**: wrong streak/WoW numbers mislead users about fleet activity trends; a NaN WoW or non-monotonic thresholds break the heatmap render. Low blast radius on money, high on the dashboard's credibility.
- **Fix sketch**: `quartile_thresholds` is fully pure — LLM-generatable. Add cases: `[]`→`[1,1,1,1]`; `[5]`→all 5; ascending list → monotonic non-decreasing. For `derive_heatmap_insights`, construct `HeatmapDay` vecs with controlled relative dates (anchor off `Utc::now().date_naive()` like the impl) and assert streak/dormant/WoW/peak. **Invariants**: thresholds monotonic & ≥1; WoW None iff previous_week==0; dormant_days None iff total_executions==0; longest_streak ≤ window_days.

## 3. Anomaly relevance + root-cause derivation (`compute_relevance`, `generate_root_cause_suggestions`) untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/execution/metrics.rs:1717-1723 (`compute_relevance`), :1726-1883 (`generate_root_cause_suggestions`), :1699-1714 (`compute_offset_seconds`)
- **Current test state**: none
- **Scenario**: the anomaly drill-down's whole value is ranking *which* event caused a cost/error spike. These pure functions decide ordering and confidence: relevance time-decay + persona boost (capped at 1.0), metric-match boosts (alert metric == anomaly metric +0.3, circuit-breaker +0.2), per-type confidence weights, and the "no correlated events → external factors @0.3" fallback. A flipped sign in `offset_seconds < 0.0` ("before"/"after"), a lost boost, or a broken confidence sort would mis-rank root causes and the user chases the wrong fix — with zero test to catch it.
- **Root cause**: deterministic ranking logic embedded next to SQL; never isolated.
- **Impact**: misattributed root cause wastes operator time during an incident and erodes trust in the drill-down feature. Also `compute_offset_seconds` unparseable-timestamp fallback (86400.0) is an untested data-quality guard.
- **Fix sketch**: unit-test `compute_relevance` (offset 0 → ~1.0; large offset → small; persona_matched adds ≤0.15; never exceeds 1.0). Feed `generate_root_cause_suggestions` a hand-built `Vec<CorrelatedEvent>` and assert: suggestions sorted by confidence desc, ranks reassigned 1..n, alert-metric-match raises confidence, empty input → single `external` suggestion @0.3. **Invariants**: confidence ∈ [0,1]; output sorted desc; ranks contiguous from 1; empty events ⇒ exactly one external suggestion.

## 4. IPC performance metrics (`ipcMetrics.ts` percentile/stats/summary) untested
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/lib/ipcMetrics.ts:61-143 (`percentile`, `computeCommandStats`, `getSlowestCalls`, `getGlobalSummary`) feeding IpcPerformancePanel.tsx
- **Current test state**: none (grep `computeCommandStats`/`ipcMetrics` in `*.test.ts` → nothing)
- **Scenario**: the IpcPerformancePanel surfaces p50/p95/p99 latency, timeout rate, and error rate — the operator's window into IPC health. The pure helpers have real edge logic: `percentile` empty→0 and `ceil((p/100)*len)-1` indexing; `timeoutRate` keying on `timedOut === true` *not* a duration heuristic (documented at :11-18 as a prior miscount bug); `errorRate` counting all `!ok`. A regression that miscounts timeouts as errors (or vice versa) hides real IPC instability behind a green panel.
- **Root cause**: module-level ring buffer + pure functions, never imported by a test; the ring's mutable global makes it feel awkward but `recordIpcCall` gives a clean seam.
- **Invariants to assert (LLM-generatable batch)**: percentile of `[10,20,30]` p50=20, p95/p99=30, empty=0; `timeoutRate` counts only `ok:false && timedOut:true`; `errorRate` counts all `ok:false`; `computeCommandStats` groups by command and sorts by p95 desc; `getSlowestCalls(n)` returns n records sorted by durationMs desc. Note: tests must reset the ring between cases (the buffer is global) — add a small reset helper or fill ≥RING_SIZE to control state; document this as the determinism requirement.

## 5. No quality gate / new-code ratchet on observability analytics
- **Severity**: high
- **Category**: quality-gate
- **File**: vitest.config.ts (root) + src-tauri/src/db/repos/execution/metrics.rs
- **Current test state**: exists-but-weak — one thin Rust test module; no per-area coverage threshold; the only TS coverage is the IPC pass-through suite
- **Scenario**: the cost/anomaly/value-rollup/alert logic in this context directly informs spend decisions and incident response, yet nothing prevents new untested branches landing. Without even an advisory ratchet, findings #1–#4 will silently recur as the analytics grow.
- **Root cause**: no coverage threshold scoped to `src/stores/slices/overview/**`, `src/lib/ipcMetrics.ts`, or the metrics repo; no cargo-llvm-cov gate on the derived-analytics functions.
- **Impact**: coverage of business-critical alert/cost math drifts down unnoticed; regressions reach prod.
- **Fix sketch**: add an advisory (warn-not-block initially) per-path coverage threshold in `vitest.config.ts` for `src/stores/slices/overview/alertSlice.ts` and `src/lib/ipcMetrics.ts` (e.g. 80% lines/branches), and a new-code ratchet so PRs touching these can't lower it. For Rust, gate the pure helpers (`percentile`, `quartile_thresholds`, `compute_relevance`, `generate_root_cause_suggestions`, `derive_heatmap_insights`) via cargo-llvm-cov in CI. Calibrate to the pure-function set first to avoid noise from DB-bound code; expand once #2–#4 land.

## 6. Burn-rate / monthly-cost projection (linear-regression) untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/execution/metrics.rs:1315-1382 (projection block inside `get_execution_dashboard`); also `detect_rolling_anomalies` :735-792 and the >2σ cost-anomaly loop :1254-1295
- **Current test state**: none
- **Scenario**: `projected_monthly_cost` and `burn_rate` come from a hand-rolled least-squares fit over recent daily costs, clamped to ≥0, plus a >2σ cost-anomaly detector. Errors here mis-state projected spend (a number users budget against) or fire/miss cost-spike alerts. Risky branches with no test: `denominator==0` slope fallback (:1338-1343), `<2` points → `(None,None)` (:1379), and the anomaly detector's `std_dev==0`/`<3 preceding` skips and the `value==0`/`baseline==0` skips in `detect_rolling_anomalies`.
- **Root cause**: the projection math is inline in a large pool-bound function, making it hard to reach; it should be extracted to a pure helper taking `&[f64]` daily costs.
- **Impact**: wrong spend projection → bad budgeting decisions; false/missed cost anomalies → alert noise or blind spots. Medium because it's advisory rather than a hard money-write.
- **Fix sketch**: extract the regression into `project_costs(recent: &[f64]) -> (Option<f64>, Option<f64>)` and the deviation step in `detect_rolling_anomalies` into already-pure form; unit-test: flat costs → slope ~0, burn_rate == that level; rising series → positive slope, projection > spent-so-far; `[x]` → `(None,None)`; all-zero preceding → no anomaly; one >100% spike after a stable window → exactly one anomaly with correct baseline. **Invariants**: burn_rate ≥ 0; projection None iff <2 points; anomaly only when deviation crosses ±threshold and baseline≠0.

## 7. Value rollup denominators/divide-by-zero guards untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/execution/metrics.rs:465-566 (`get_value_rollup_with_conn`)
- **Current test state**: none
- **Scenario**: `value_delivered_rate = vd/assessed` and `cost_per_value_delivered = Some(cost/vd)` (None when vd==0) feed the dashboard value tile *and* the Director's evaluation context (a leadership decision input). `assessed` excludes `unknown`; `unknown = (total - assessed).max(0)`; simulations are excluded (`COALESCE(is_simulation,0)=0`). A regression that divides by `total` instead of `assessed`, drops the `vd==0 → None` guard (Inf), or stops excluding simulations would skew the value signal the Director acts on.
- **Root cause**: takes a `&Connection`, so it's directly testable with `init_test_db` (already used in the file's existing tests), but no test seeds executions and asserts the rollup.
- **Impact**: a wrong value-delivered rate or cost-per-value misleads both the user tile and automated Director scoring — quiet, compounding bad signal. Medium: read-path, but it drives downstream automated decisions.
- **Fix sketch**: using `init_test_db`, seed `persona_executions` rows with mixed `business_outcome` (value_delivered / partial / precondition_failed / no_input_available / NULL) plus one `is_simulation=1` row, then assert: `assessed` excludes unknowns and the simulation; `value_delivered_rate == vd/assessed`; `cost_per_value_delivered == None` when vd==0 and `Some(cost/vd)` otherwise; per-model breakdown ordered by cost desc with `unknown` model bucket for blank `model_used`. **Invariants**: rate ∈ [0,1]; cost_per_value None iff vd==0; total ≥ assessed; simulations never counted.
