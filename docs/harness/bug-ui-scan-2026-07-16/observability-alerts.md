# Observability & Alerts — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Editing an alert rule silently rewrites it with form defaults
- **Severity**: High
- **Category**: bug
- **File**: src/features/overview/sub_observability/components/AlertRulesPanel.tsx:316
- **Scenario**: User clicks the pencil icon on an existing rule (e.g. "Prod cost critical: cost >= 50, critical, scoped to persona X"). The inline `RuleForm` appears **blank with defaults** (metric=error_rate, operator=>, threshold=10, severity=warning, scope=Global) because the edit branch never passes the `initial` prop that `RuleForm` supports (`initial ?? DEFAULT_FORM`, line 52). The user retypes only the name (Save is disabled until name is non-empty, so they must) and hits Save.
- **Root cause**: The edit render path (`editingId === rule.id`) constructs `<RuleForm key={rule.id} personas onSubmit onCancel />` without `initial={ruleToFormData(rule)}` — the component was designed for prefill but the caller forgot to wire it.
- **Impact**: Every field except the retyped name is silently overwritten: metric, operator, threshold, severity all reset to defaults and a persona-scoped rule becomes Global (`persona_id: null` is sent by `handleEdit`). A critical cost alert quietly becomes a "error_rate > 10, warning, global" rule — alerting coverage is destroyed with no error and no diff shown. Cooldown for the rule is also cleared (alertSlice.ts:257), so the mangled rule may immediately fire noise.
- **Fix sketch**: Pass `initial={{ name: rule.name, metric: rule.metric, operator: rule.operator, threshold: String(rule.threshold), severity: rule.severity, personaId: rule.persona_id }}` in the edit branch.

## 2. Failed alert-history load renders as "no alerts" (silent failure / success theater)
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/overview/sub_observability/components/AlertHistoryPanel.tsx:92 (root cause at src/stores/slices/overview/alertSlice.ts:221-223)
- **Scenario**: `list_fired_alerts` fails (DB lock, auth error, transient IPC failure) when the user opens the Observability tab. `fetchAlertHistory`'s `catch` block only flips `alertHistoryLoading` off — no error state, no toast, no retry cue. The panel renders the `EmptyState` ("no alerts") because it keys solely on `alertHistory.length === 0`.
- **Root cause**: The panel conflates three states (loading / load-failed / genuinely empty) into one, and the slice deliberately swallows the fetch error — unlike `fetchAlertRules`, which sets `alertRulesError` and toasts.
- **Impact**: A user monitoring incident history is told everything is quiet when the truth is "we couldn't read the history." For an alerting surface this is the worst failure mode: it looks identical to health. The `alertHistoryLoading` flag exists in the store but is never consumed, so the empty state also flashes during the initial fetch.
- **Fix sketch**: Mirror the rules path: store `alertHistoryError`, toast via `toastCatch`, and in the panel render a spinner while `alertHistoryLoading` and an error row (with retry) when the fetch failed instead of `EmptyState`.

## 3. Anomaly drilldown presents metric *drops* as spikes ("+-45%")
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/overview/sub_observability/components/AnomalyDrilldownPanel.tsx:174 (also :153)
- **Scenario**: The backend anomaly detector flags both directions — `if deviation_pct > upper_pct || deviation_pct < lower_pct` (src-tauri/src/db/repos/execution/metrics.rs:914) — so a day where cost or error_rate *fell* sharply arrives with `deviation_pct = -45`. User clicks that anomaly to drill down.
- **Root cause**: The header hardcodes the spike framing: badge text is `+{deviationPct}%` with a `+` prepended to an already-signed number, the subtitle says "spike on", and the badge/icon/gradient are unconditionally red.
- **Impact**: The badge literally renders "+-45%", and a *good* event (error rate dropped) is dressed as a red alarm titled "spike". Users learn to distrust the drilldown numbers; the double-sign string reads as a rendering bug in a numbers-focused panel.
- **Fix sketch**: Format with an explicit sign (`deviation_pct >= 0 ? '+' : ''`), switch label to spike/drop based on sign, and use a calmer (e.g. blue/emerald) treatment for downward deviations of "bad" metrics.

## 4. Raw i18n key shown as the rule-name placeholder, and placeholder is indistinguishable from typed text
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/overview/sub_observability/components/AlertRulesPanel.tsx:61-62
- **Scenario**: User clicks "Add rule". The name input displays the literal string `rule_name_placeholder` — `placeholder={"rule_name_placeholder"}` is a bare string literal, not `t.…` or `<DebtText>` (which can't be used for a placeholder attribute, but `debtText('…')` exists exactly for this). Additionally the input uses `placeholder:text-foreground`, styling placeholder text with the same full-strength foreground color as entered text.
- **Root cause**: A half-finished i18n migration left the key where the translation call should be, and the placeholder utility class copies the text color instead of a muted token.
- **Impact**: Visible debug-string in a primary creation flow of the panel (every user who adds a rule sees it, in all 13 locales); the non-muted placeholder makes the field look pre-filled, so users may not realize the name is empty until Save stays disabled.
- **Fix sketch**: Use `debtText('auto_rule_name_…')` (or a proper `t.overview.observability` key) for the placeholder and change the class to `placeholder:text-muted-foreground`.

## 5. Relative timestamps freeze: eval-health "Xs ago" and IPC "when" column never tick
- **Severity**: Low
- **Category**: ui
- **File**: src/features/overview/sub_observability/components/AlertRulesPanel.tsx:207 (EvalHealthIndicator), src/features/overview/sub_observability/components/IpcPerformancePanel.tsx:54 (ageLabel)
- **Scenario**: `EvalHealthIndicator` computes `Date.now() - lastEvalAt` once per render. If the evaluator stalls (the exact condition the indicator exists to expose — e.g. the metrics fetch loop dies so `evaluateAlertRules` stops running), no store update occurs, the component never re-renders, and the label stays frozen at "5s ago" with a green dot indefinitely. Same pattern for the IPC panel's "when" column, which only refreshes when a *new* IPC call bumps the metrics generation.
- **Root cause**: Relative-time strings derived from `Date.now()` at render time with no interval/re-render source; the health indicator's freshness signal depends on the very loop whose failure it should report.
- **Impact**: The staleness indicator can't indicate staleness — a dead evaluation loop looks permanently healthy and recent, which quietly defeats alerting. (Cosmetically, IPC ages also read younger than reality.)
- **Fix sketch**: Drive both from a 15–30s `setInterval` tick (or a shared `useNow(30_000)` hook), and have EvalHealthIndicator turn amber/red when age exceeds ~2× the expected eval interval even without a `lastError`.
