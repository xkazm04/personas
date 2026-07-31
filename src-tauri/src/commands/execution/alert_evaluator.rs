//! Server-side alert evaluation — the authoritative NOC sensor loop
//! (Autonomous NOC v1).
//!
//! Ports the frontend `useGlobalAlertEvaluator` / `alertSlice.evaluateAlertRules`
//! rule loop into a Rust background task so alerts fire even with the UI
//! closed. On every tick it:
//!
//! 1. Loads the enabled alert rules and evaluates each against a fresh
//!    metrics snapshot (per-persona scoped when the rule has a `persona_id` —
//!    an upgrade over the client loop, which only ever saw the global
//!    snapshot).
//! 2. Applies the same 1-hour per-rule cooldown as the client, but against
//!    the PERSISTED `fired_alerts` history — restart-proof, and the same
//!    source the client's cooldown fallback reads, which is what keeps the
//!    two loops from double-firing (the client fetches history fresh each
//!    tick; a server-fired alert inside the window suppresses the client's
//!    copy, and vice versa).
//! 3. On fire: persists the `FiredAlert`, auto-opens an `audit_incidents`
//!    row via the existing promotion taxonomy (deduped by
//!    `fired_alerts:{alert_id}` + the repo's open-duplicate title guard, so
//!    the same persona-problem never stacks incidents), publishes an
//!    `alert_fired` persona event (which the webhook notifier relays to
//!    Slack/Discord/... — the "notification with UI closed" path) and emits
//!    it on the in-app event bus.
//! 4. Runs the auto-diagnosis pass on each freshly opened incident (capped
//!    per tick — the remediation-storm guard).
//!
//! Metric semantics mirror `alertSlice.evaluateRule`: error/success rate use
//! the DECIDED denominator (successful + failed), `cost`/`executions` read the
//! 1-day summary window, and `cost_spike` compares today's cost against the
//! 7-day average daily cost (the client's global loop only had a 1-day window,
//! which made spike ≈ 1.0 always; the server loop is the authority and uses a
//! meaningful baseline).

use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;

use crate::db::models::{
    AlertMetric, AlertOperator, AlertRule, AlertSeverity, CreateAuditIncidentInput,
    CreatePersonaEventInput, FiredAlert,
};
use crate::db::repos::communication::alert_rules as alert_repo;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::execution::audit_incidents as incident_repo;
use crate::db::repos::execution::metrics as metrics_repo;
use crate::engine::event_registry::emit_event_bus;
use crate::AppState;

/// Tick cadence — matches the frontend evaluator's 60s interval.
const EVAL_INTERVAL_SECS: u64 = 60;
/// Grace before the first tick so app startup (migrations, pools, seeds)
/// finishes before we hit the DB.
const STARTUP_DELAY_SECS: u64 = 30;
/// Per-rule cooldown — matches the frontend's `FIRED_COOLDOWN_MS` (1 hour).
const FIRED_COOLDOWN_SECS: i64 = 60 * 60;
/// Summary window for rate/cost/executions metrics (matches the frontend
/// global evaluator's `ALERT_EVAL_WINDOW_DAYS`).
const SUMMARY_WINDOW_DAYS: i64 = 1;
/// Chart window used to compute the `cost_spike` daily-average baseline.
const SPIKE_WINDOW_DAYS: i64 = 7;
/// Remediation-storm guard: at most this many incidents get the automatic
/// diagnosis pass per tick. The rest stay diagnosable manually from the
/// incident detail modal.
const MAX_AUTO_DIAGNOSES_PER_TICK: usize = 3;

/// The minimal metrics snapshot a rule is evaluated against.
#[derive(Debug, Clone, Copy, Default)]
pub struct MetricsSnapshot {
    pub total_executions: i64,
    pub successful_executions: i64,
    pub failed_executions: i64,
    pub total_cost_usd: f64,
    /// Average daily cost over the spike window (baseline).
    pub avg_daily_cost_usd: f64,
    /// Cost of the most recent chart day ("today").
    pub today_cost_usd: f64,
}

/// Pure rule evaluation — mirrors `alertSlice.evaluateRule`.
/// Returns `(triggered, observed_value)`.
pub fn evaluate_rule(rule: &AlertRule, m: &MetricsSnapshot) -> (bool, f64) {
    let value = match rule.metric {
        AlertMetric::ErrorRate => {
            let decided = m.successful_executions + m.failed_executions;
            if decided > 0 {
                (m.failed_executions as f64 / decided as f64) * 100.0
            } else {
                0.0
            }
        }
        AlertMetric::SuccessRate => {
            let decided = m.successful_executions + m.failed_executions;
            if decided > 0 {
                (m.successful_executions as f64 / decided as f64) * 100.0
            } else {
                0.0
            }
        }
        AlertMetric::Cost => m.total_cost_usd,
        AlertMetric::CostSpike => {
            if m.avg_daily_cost_usd > 0.0 {
                m.today_cost_usd / m.avg_daily_cost_usd
            } else {
                0.0
            }
        }
        AlertMetric::Executions => m.total_executions as f64,
    };

    let triggered = match rule.operator {
        AlertOperator::Gt => value > rule.threshold,
        AlertOperator::Lt => value < rule.threshold,
        AlertOperator::Gte => value >= rule.threshold,
        AlertOperator::Lte => value <= rule.threshold,
    };
    (triggered, value)
}

/// Human-readable fire message — mirrors `alertSlice.formatAlertMessage`
/// (units per metric, threshold echoed). Stored on the FiredAlert row and
/// reused as the incident title, exactly like client-fired alerts.
pub fn format_alert_message(rule: &AlertRule, value: f64) -> String {
    let (label, unit) = match rule.metric {
        AlertMetric::ErrorRate => ("Error rate", "%"),
        AlertMetric::SuccessRate => ("Success rate", "%"),
        AlertMetric::Cost => ("Cost", "$"),
        AlertMetric::CostSpike => ("Cost spike", "x"),
        AlertMetric::Executions => ("Executions", ""),
    };
    let fmt_value = match unit {
        "$" => format!("${value:.2}"),
        "%" => format!("{value:.1}%"),
        "x" => format!("{value:.1}x"),
        _ => format!("{}", value.round() as i64),
    };
    let fmt_threshold = match unit {
        "$" => format!("${}", rule.threshold),
        "%" => format!("{}%", rule.threshold),
        "x" => format!("{}x", rule.threshold),
        _ => format!("{}", rule.threshold),
    };
    format!(
        "{label} is {fmt_value} (threshold: {op} {fmt_threshold})",
        op = rule.operator
    )
}

/// Most recent persisted fire timestamp for a rule, if any — the cooldown
/// source of truth shared with the frontend's history-fallback.
fn last_fired_at(pool: &crate::db::DbPool, rule_id: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let conn = pool.get().ok()?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT fired_at FROM fired_alerts WHERE rule_id = ?1 ORDER BY fired_at DESC LIMIT 1",
            rusqlite::params![rule_id],
            |row| row.get(0),
        )
        .ok();
    raw.and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

/// Build the snapshot for one persona scope (None = fleet-wide).
fn snapshot_for_scope(
    pool: &crate::db::DbPool,
    persona_id: Option<&str>,
) -> Result<MetricsSnapshot, crate::error::AppError> {
    let summary = metrics_repo::get_summary(pool, Some(SUMMARY_WINDOW_DAYS), persona_id)?;
    let chart = metrics_repo::get_chart_data(pool, Some(SPIKE_WINDOW_DAYS), persona_id)?;
    let points = &chart.chart_points;
    let avg_daily = if points.is_empty() {
        0.0
    } else {
        points.iter().map(|p| p.cost).sum::<f64>() / points.len() as f64
    };
    let today = points.last().map(|p| p.cost).unwrap_or(0.0);
    Ok(MetricsSnapshot {
        total_executions: summary.total_executions,
        successful_executions: summary.successful_executions,
        failed_executions: summary.failed_executions,
        total_cost_usd: summary.total_cost_usd,
        avg_daily_cost_usd: avg_daily,
        today_cost_usd: today,
    })
}

/// One evaluation pass. Best-effort throughout: a single rule/persistence
/// failure is logged and never aborts the loop.
fn tick(app: &AppHandle, state: &Arc<AppState>) {
    let pool = &state.db;
    let rules = match alert_repo::list_alert_rules(pool) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "alert_evaluator: failed to load rules");
            return;
        }
    };
    let enabled: Vec<&AlertRule> = rules.iter().filter(|r| r.enabled).collect();
    if enabled.is_empty() {
        return;
    }

    let now = chrono::Utc::now();
    let mut fresh_incidents: Vec<String> = Vec::new();
    // Snapshot cache per persona scope so N rules on the same scope cost one
    // metrics query, not N.
    let mut snapshots: std::collections::HashMap<Option<String>, MetricsSnapshot> =
        std::collections::HashMap::new();

    for rule in enabled {
        // Cooldown against the persisted history (restart-proof, shared with
        // the client's fallback — this is the double-toast dedupe).
        if let Some(fired) = last_fired_at(pool, &rule.id) {
            if (now - fired).num_seconds() < FIRED_COOLDOWN_SECS {
                continue;
            }
        }

        let scope = rule.persona_id.clone();
        let snapshot = match snapshots.entry(scope.clone()) {
            std::collections::hash_map::Entry::Occupied(e) => *e.get(),
            std::collections::hash_map::Entry::Vacant(v) => {
                match snapshot_for_scope(pool, scope.as_deref()) {
                    Ok(s) => *v.insert(s),
                    Err(e) => {
                        tracing::warn!(rule_id = %rule.id, error = %e, "alert_evaluator: snapshot failed");
                        continue;
                    }
                }
            }
        };

        let (triggered, value) = evaluate_rule(rule, &snapshot);
        if !triggered {
            continue;
        }

        let alert = FiredAlert {
            id: uuid::Uuid::new_v4().to_string(),
            rule_id: rule.id.clone(),
            rule_name: rule.name.clone(),
            metric: rule.metric,
            severity: rule.severity,
            message: format_alert_message(rule, value),
            value,
            threshold: rule.threshold,
            persona_id: rule.persona_id.clone(),
            fired_at: now.to_rfc3339(),
            dismissed: false,
        };

        if let Err(e) = alert_repo::create_fired_alert(pool, &alert) {
            tracing::warn!(rule_id = %rule.id, error = %e, "alert_evaluator: failed to persist fired alert");
            continue;
        }
        tracing::info!(
            rule_id = %rule.id,
            metric = %rule.metric,
            value,
            threshold = rule.threshold,
            "alert_evaluator: alert fired"
        );

        // Auto-open the incident (idempotent: dedup_key + open-title guard).
        // Direct promotion — the server loop is the NOC authority, so it is
        // NOT gated behind PERSONAS_INCIDENTS_PROMOTION (that env gate keeps
        // covering the legacy client-created path inside the repo).
        match incident_repo::promote(
            pool,
            CreateAuditIncidentInput {
                source_table: "fired_alerts".into(),
                source_id: alert.id.clone(),
                persona_id: alert.persona_id.clone(),
                persona_name: None,
                execution_id: None,
                severity: severity_token(alert.severity).into(),
                kind: format!("alert.{}", alert.metric),
                title: alert.message.clone(),
                detail: Some(format!(
                    "Rule '{}' fired server-side: value {:.4} {} threshold {}",
                    alert.rule_name, alert.value, alert.metric, alert.threshold
                )),
            },
        ) {
            Ok(Some(incident_id)) => fresh_incidents.push(incident_id),
            Ok(None) => { /* already open — no new incident */ }
            Err(e) => {
                tracing::warn!(alert_id = %alert.id, error = %e, "alert_evaluator: incident promotion failed");
            }
        }

        // Publish to the persona event bus: the webhook notifier polls
        // persona_events, so this is what reaches Slack/Discord/... with the
        // UI closed. Best-effort.
        match event_repo::publish(
            pool,
            CreatePersonaEventInput {
                event_type: "alert_fired".into(),
                source_type: "fired_alerts".into(),
                source_id: Some(alert.id.clone()),
                target_persona_id: alert.persona_id.clone(),
                payload: Some(
                    serde_json::json!({
                        "rule_id": alert.rule_id,
                        "rule_name": alert.rule_name,
                        "metric": alert.metric.to_string(),
                        "severity": alert.severity.to_string(),
                        "message": alert.message,
                        "value": alert.value,
                        "threshold": alert.threshold,
                    })
                    .to_string(),
                ),
                project_id: None,
                use_case_id: None,
            },
        ) {
            Ok(event) => emit_event_bus(app, &event),
            Err(e) => {
                tracing::warn!(alert_id = %alert.id, error = %e, "alert_evaluator: failed to publish alert_fired event");
            }
        }
    }

    // Auto-diagnosis pass on freshly opened incidents, capped per tick.
    for incident_id in fresh_incidents.iter().take(MAX_AUTO_DIAGNOSES_PER_TICK) {
        match super::incident_diagnosis::diagnose(state, incident_id, true) {
            Ok(diag) => {
                tracing::info!(
                    incident_id = %incident_id,
                    confidence = diag.confidence,
                    proposed = diag.proposed_action.is_some(),
                    "alert_evaluator: incident auto-diagnosed"
                );
            }
            Err(e) => {
                tracing::warn!(incident_id = %incident_id, error = %e, "alert_evaluator: auto-diagnosis failed");
            }
        }
    }
}

/// Map an alert severity onto the incident severity vocabulary explicitly
/// (mirrors `normalize_severity`'s treatment of the alert convention:
/// info → low, warning → medium, critical → critical).
fn severity_token(sev: AlertSeverity) -> &'static str {
    match sev {
        AlertSeverity::Info => "low",
        AlertSeverity::Warning => "medium",
        AlertSeverity::Critical => "critical",
    }
}

/// Spawn the evaluator loop. Called once from app setup.
pub fn spawn_evaluator(app: AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECS)).await;
        let mut interval = tokio::time::interval(Duration::from_secs(EVAL_INTERVAL_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            // The tick is synchronous DB work; run it on a blocking thread so
            // a slow query never stalls the async runtime.
            let app2 = app.clone();
            let state2 = state.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || tick(&app2, &state2)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(metric: AlertMetric, operator: AlertOperator, threshold: f64) -> AlertRule {
        AlertRule {
            id: "r-1".into(),
            name: "Test rule".into(),
            metric,
            operator,
            threshold,
            severity: AlertSeverity::Warning,
            persona_id: None,
            enabled: true,
            created_at: "2026-07-30T00:00:00Z".into(),
            updated_at: "2026-07-30T00:00:00Z".into(),
        }
    }

    fn snapshot() -> MetricsSnapshot {
        MetricsSnapshot {
            total_executions: 20,
            successful_executions: 12,
            failed_executions: 4,
            total_cost_usd: 3.5,
            avg_daily_cost_usd: 1.0,
            today_cost_usd: 2.5,
        }
    }

    /// Error rate uses the DECIDED denominator (successful + failed), not
    /// total_executions — parity with the SLA repo and alertSlice.
    #[test]
    fn error_rate_uses_decided_denominator() {
        let (fired, value) = evaluate_rule(
            &rule(AlertMetric::ErrorRate, AlertOperator::Gt, 20.0),
            &snapshot(),
        );
        assert!((value - 25.0).abs() < 1e-9, "4/(12+4) = 25%, got {value}");
        assert!(fired);
    }

    #[test]
    fn success_rate_and_lt_operator() {
        let (fired, value) = evaluate_rule(
            &rule(AlertMetric::SuccessRate, AlertOperator::Lt, 80.0),
            &snapshot(),
        );
        assert!((value - 75.0).abs() < 1e-9);
        assert!(fired);
    }

    #[test]
    fn cost_spike_is_today_over_daily_average() {
        let (fired, value) = evaluate_rule(
            &rule(AlertMetric::CostSpike, AlertOperator::Gte, 2.0),
            &snapshot(),
        );
        assert!((value - 2.5).abs() < 1e-9);
        assert!(fired);
    }

    /// Zero decided runs → rates evaluate to 0, never NaN, and a `>` rule
    /// does not fire.
    #[test]
    fn empty_window_never_fires_rate_rules() {
        let empty = MetricsSnapshot::default();
        let (fired, value) = evaluate_rule(
            &rule(AlertMetric::ErrorRate, AlertOperator::Gt, 0.5),
            &empty,
        );
        assert_eq!(value, 0.0);
        assert!(!fired);
        // cost_spike with zero baseline is 0, not infinity.
        let (fired, value) = evaluate_rule(
            &rule(AlertMetric::CostSpike, AlertOperator::Gt, 1.0),
            &empty,
        );
        assert_eq!(value, 0.0);
        assert!(!fired);
    }

    /// Message format matches the frontend's units-per-metric convention so
    /// server- and client-fired alerts read identically in history.
    #[test]
    fn message_format_mirrors_frontend() {
        let msg = format_alert_message(&rule(AlertMetric::ErrorRate, AlertOperator::Gt, 20.0), 25.0);
        assert_eq!(msg, "Error rate is 25.0% (threshold: > 20%)");
        let msg = format_alert_message(&rule(AlertMetric::Cost, AlertOperator::Gte, 5.0), 7.25);
        assert_eq!(msg, "Cost is $7.25 (threshold: >= $5)");
    }
}
