# Observability & Alerts — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: observability-and-alerts | Group: Observability & Analytics
> Total: 5 | Critical: 0 | High: 1 | Medium: 3 | Low: 1

## 1. Alert history panel silently hides every alert past the 50 newest
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-truncation / missed-alert
- **File**: src/features/overview/sub_observability/components/AlertHistoryPanel.tsx:97
- **Scenario**: A busy deployment accumulates undismissed alerts. The store keeps up to `MAX_ALERT_HISTORY = 200` (alertSlice.ts:36) and `list_fired_alerts` returns up to 200 (alert_rules.rs:234), but the panel renders `alertHistory.slice(0, 50)`. The "active" badge is computed over the **full** array (`alertHistory.filter(a => !a.dismissed)`, line 69), so the header can read e.g. "73" while only 50 rows are shown. Any undismissed alert at index 51+ is invisible AND individually un-dismissable — the only way to clear it is the global "Clear" button, which also deletes the 50 you can see and all *dismissed* history.
- **Root cause**: An arbitrary `slice(0, 50)` cap sits inside a container that already has `max-h-[400px] overflow-y-auto` (line 96), so the slice is not needed for scroll/perf — it just drops rows. The active-count and the rendered set are derived from two different lengths (200 vs 50).
- **Impact**: A critical, undismissed alert that is older than the 50 most recent is effectively missed by the operator — it never appears and can't be acknowledged. The badge/row mismatch also erodes trust in the panel.
- **Fix sketch**: Drop the `.slice(0, 50)` (let the scroll container page through all loaded alerts), or raise the cap to `MAX_ALERT_HISTORY` and add a "showing N of M" affordance. At minimum, render at least the undismissed alerts regardless of recency so every active alert stays dismissable.
- **Value**: impact=7 effort=1

## 2. `cost_spike` alert baseline includes the current day, so it under-fires (and can never fire on day 1)
- **Severity**: Medium
- **Lens**: bug-hunter + ambiguity-guardian
- **Category**: wrong-metric / missed-alert / unclear-semantics
- **File**: src/stores/slices/overview/alertSlice.ts:370 (and 76-77, 410-411)
- **Scenario**: `avgDailyCost` is the mean over **all** `chart_points`, including today (line 370-372). `evaluateRule` for `cost_spike` then computes `value = todayCost / avgCostUsd` (line 77) with `totalCostUsd` overridden to `todayCost` (line 411). Because the denominator's average already contains today's cost, the ratio is systematically pulled toward 1.0. With a single day of data, `avgDailyCost === todayCost`, so the spike ratio is **exactly 1.0** and a `cost_spike > 2x` rule can never trigger; with a few days, a genuine 3x spike is diluted below threshold.
- **Root cause**: The baseline mixes the observed value into its own reference window. The Rust rolling-anomaly detectors deliberately use only *preceding* points (`(start..i)`, metrics.rs:754); this client-side spike metric does not, and the "what is a spike measured against" contract is undocumented.
- **Impact**: Cost-spike alerts silently under-fire or never fire, defeating the rule the user configured to catch runaway spend.
- **Fix sketch**: Compute the baseline over `chart_points` **excluding** the last/current day (e.g. `chart_points.slice(0, -1)`), and document that `cost_spike` = today vs trailing-day average. Guard the still-undefined `avg == 0` case (line 77 currently yields `0`, which also never fires).
- **Value**: impact=6 effort=3

## 3. Rolling anomaly detector skips drops-to-zero, hiding total-collapse anomalies
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / silent-failure
- **File**: src-tauri/src/db/repos/execution/metrics.rs:749
- **Scenario**: `detect_rolling_anomalies` does `if value == 0.0 { continue; }` before computing deviation. The detector is explicitly two-sided — it flags spikes (`> upper_pct`) *and* drops (`< lower_pct`, e.g. -50% for cost/error_rate/latency, metrics.rs:789/838). A day where the metric collapses to exactly 0 (cost → \$0 because executions stopped, or latency → 0) is the most extreme possible drop, yet it is skipped entirely and never surfaces in the `MetricAnomaly` list that feeds `AnomalyDrilldownPanel`.
- **Root cause**: The `value == 0.0` early-continue was added to avoid a divide-by-zero in the *baseline* (`baseline == 0.0` is already guarded separately at line 759). It over-reaches by also discarding zero *observations*, conflating "no baseline" with "value is zero".
- **Impact**: A complete outage / cessation (the signal an operator most wants) produces no anomaly and no drill-down — a silent miss on the highest-severity drop.
- **Fix sketch**: Only skip when the *baseline* can't be formed; allow `value == 0.0` through so a 0-vs-positive-baseline computes `deviation_pct == -100%` and trips the drop threshold. Keep the existing `baseline == 0.0` guard.
- **Value**: impact=6 effort=2

## 4. `create_fired_alert` is a non-idempotent INSERT; the persist-retry loop can poison the pending set permanently
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race / silent-failure / latent
- **File**: src-tauri/src/db/repos/communication/alert_rules.rs:267
- **Scenario**: When alerts fire, the slice adds their UUIDs to `pendingSyncAlertIds` and persists each via `api.createFiredAlert` (alertSlice.ts:460-472); a top-of-cycle retry block re-sends every still-pending alert on the **next** eval (alertSlice.ts:348-358). `evaluateAlertRules` runs on a timer and `createFiredAlert` is async, so the retry block can fire a second insert for the same id while the first is still in flight. The DB op is a plain `INSERT` against a primary key, so the duplicate (or a retry after a lost-but-successful first insert) hits a UNIQUE/PK violation → the promise rejects → the alert is **never** removed from `pendingSyncAlertIds` → it is retried every cycle forever, each time logging a warning and burning an IPC round-trip.
- **Root cause**: At-least-once retry semantics on the client paired with exactly-once (`INSERT`) semantics on the server. There is no idempotency key handling.
- **Impact**: A permanently stuck pending entry that re-fails every evaluation (minutely), plus duplicate-insert error noise. The user-visible history row is fine, but the sync state never reconciles.
- **Fix sketch**: Make the insert idempotent — `INSERT OR IGNORE` (id is the PK) — and treat a no-op insert as success so the client clears the pending id. Optionally de-dupe the two retry paths so a single in-flight persist isn't double-submitted.
- **Value**: impact=5 effort=2

## 5. "Always-true rule" validation is incomplete — `<=`/`<` rules at the metric ceiling and threshold-only edits slip through
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: uncovered-edge / unclear-contract
- **File**: src-tauri/src/commands/communication/observability/alerts.rs:17 (and 59-72)
- **Scenario**: `reject_always_true_rule` only rejects `>= 0` / `> negative`. It does not cover the symmetric always-true cases against the known metric ceilings: `success_rate <= 100` or `error_rate <= 100` (rates are bounded 0–100) fire on every evaluation, as does any `<` above the ceiling. Separately, the update path only re-validates when **both** operator and threshold are supplied (line 69) — a threshold-only edit that sets, say, `>= 0` while the stored operator is `>=` bypasses the guard entirely (acknowledged in the code comment).
- **Root cause**: The "always-true" contract is specified only for the lower-bound `>=0` case and is enforced unevenly between create and partial-update. The metric upper bounds (100% for rates) are tribal knowledge not encoded in validation.
- **Impact**: A user can create or edit a rule that fires every cycle, spamming alert history (one entry per rule per `FIRED_COOLDOWN_MS`/hour, indefinitely) — the exact noise the guard was meant to prevent.
- **Fix sketch**: Extend `reject_always_true_rule` to reject `<=`/`<` at/above each metric's known ceiling (100 for the rate metrics), and on a threshold-only update, load the existing operator first so the degenerate combination is re-checked.
- **Value**: impact=3 effort=3
