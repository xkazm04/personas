//! Per-source promoters that turn audit-table inserts into incidents-inbox rows.
//!
//! See `src/features/overview/sub_incidents/DESIGN.md` Section 4 ("Where
//! promotion fires") for the architecture and the per-source rules.
//!
//! ## Safety
//!
//! Every promoter is **best-effort**: errors are logged via `tracing::warn`
//! and swallowed. Promotion failure must NEVER fail the parent audit insert.
//! This mirrors the pattern already used by `hooks_sidecar` and
//! `claude_md_projection`.
//!
//! ## Opt-in via env
//!
//! Behavior is gated behind `PERSONAS_INCIDENTS_PROMOTION=1`. When unset,
//! every promoter is a complete no-op. This keeps production behavior
//! unchanged during the bake-in window. Same pattern as
//! `PERSONAS_HOOKS_SIDECAR` and `PERSONAS_CLAUDE_MD_PROJECTION`.
//!
//! ## Test-run guard (forward-looking)
//!
//! The Hermes-run rule from the skill iteration log requires that any
//! runner-attached hook writing to learning/memory/recipe artifacts MUST
//! NOT fire during test/lab/eval/evolution/arena executions. The current
//! audit insertion sites (alerts, healing, credentials, tools, providers,
//! policy events) are NOT exclusively runner-attached — most fire on
//! day-to-day app activity unrelated to evaluation. The blanket env gate
//! is the v1 mitigation; a finer-grained context-aware guard lands when
//! the lab/eval team verifies which streams need exclusion.

use crate::db::models::{
    CreateAuditIncidentInput, CredentialAuditEntry, FiredAlert, HealingAuditEntry,
    PersonaHealingIssue, PolicyEvent, ToolExecutionAuditEntry,
};
use crate::db::repos::execution::audit_incidents as repo;
use crate::db::DbPool;
use crate::engine::byom::ProviderAuditEntry;

/// Env var that gates incident promotion. Unset → every promoter is a no-op.
pub const PROMOTION_ENV: &str = "PERSONAS_INCIDENTS_PROMOTION";

/// Returns true when promotion should run. Pure read — no side effects.
fn enabled() -> bool {
    std::env::var(PROMOTION_ENV).ok().as_deref() == Some("1")
}

/// Convenience wrapper: log on error but never propagate.
fn try_promote(pool: &DbPool, source_table: &str, input: CreateAuditIncidentInput) {
    match repo::promote(pool, input) {
        Ok(Some(id)) => {
            tracing::debug!(
                incident_id = %id,
                source_table,
                "promoted audit row to incident"
            );
        }
        Ok(None) => {
            // Already promoted — idempotent no-op. Not even debug-logged
            // because this path fires on every retry.
        }
        Err(e) => {
            tracing::warn!(
                error = %e,
                source_table,
                "audit_incidents_promoter: promotion failed (non-fatal)"
            );
        }
    }
}

// -- 1. fired_alerts ----------------------------------------------------------

/// Promotion rule: every `fired_alerts` row becomes an incident. Severity
/// passes through (the alert rule defines the severity intent).
pub fn promote_fired_alert(pool: &DbPool, alert: &FiredAlert) {
    if !enabled() {
        return;
    }
    try_promote(
        pool,
        "fired_alerts",
        CreateAuditIncidentInput {
            source_table: "fired_alerts".into(),
            source_id: alert.id.clone(),
            persona_id: alert.persona_id.clone(),
            persona_name: None, // FiredAlert doesn't carry the name; UI joins lazily
            execution_id: None,
            severity: alert.severity.to_string(),
            kind: format!("alert.{}", alert.metric),
            title: alert.message.clone(),
            detail: Some(format!(
                "Rule '{}' fired: value {} {} threshold {}",
                alert.rule_name, alert.value, alert.metric, alert.threshold
            )),
        },
    );
}

// -- 2. tool_execution_audit_log ---------------------------------------------

/// Promotion rule: only rows where `result_status = 'error'` become incidents.
/// Severity defaults to `medium` — a tool error is recoverable in most cases
/// (the persona retries via the failover chain), but worth surfacing.
pub fn promote_tool_audit(pool: &DbPool, entry: &ToolExecutionAuditEntry) {
    if !enabled() {
        return;
    }
    if entry.result_status != "error" {
        return;
    }
    let title = format!("Tool '{}' returned an error", entry.tool_name);
    let detail = entry.error_message.clone().or_else(|| {
        Some(format!(
            "tool_id={}, type={}",
            entry.tool_id, entry.tool_type
        ))
    });
    try_promote(
        pool,
        "tool_execution_audit_log",
        CreateAuditIncidentInput {
            source_table: "tool_execution_audit_log".into(),
            source_id: entry.id.clone(),
            persona_id: entry.persona_id.clone(),
            persona_name: entry.persona_name.clone(),
            execution_id: None,
            severity: "medium".into(),
            kind: "tool_error".into(),
            title,
            detail,
        },
    );
}

// -- 3. credential_audit_log -------------------------------------------------

/// Promotion rule: failure-shaped operations become incidents. Severity is
/// elevated to `high` because credential issues block downstream work.
///
/// Operations considered failures: contains `failure`, `error`, or `denied`.
pub fn promote_credential_audit(pool: &DbPool, entry: &CredentialAuditEntry) {
    if !enabled() {
        return;
    }
    let op = entry.operation.to_ascii_lowercase();
    let is_failure = op.contains("failure") || op.contains("error") || op.contains("denied");
    if !is_failure {
        return;
    }
    try_promote(
        pool,
        "credential_audit_log",
        CreateAuditIncidentInput {
            source_table: "credential_audit_log".into(),
            source_id: entry.id.clone(),
            persona_id: entry.persona_id.clone(),
            persona_name: entry.persona_name.clone(),
            execution_id: None,
            severity: "high".into(),
            kind: format!("credential.{}", entry.operation),
            title: format!(
                "Credential '{}' — {}",
                entry.credential_name, entry.operation
            ),
            detail: entry.detail.clone(),
        },
    );
}

// -- 4. healing_audit_log ----------------------------------------------------

/// Promotion rule: only rows where `event_type` denotes an unrecoverable
/// healing miss become incidents. Routine healing successes never surface.
///
/// Promoted event types: `*_error`, `ai_heal_unknown_*`, `ai_heal_section_missing`.
pub fn promote_healing_audit(pool: &DbPool, entry: &HealingAuditEntry) {
    if !enabled() {
        return;
    }
    let kind = entry.event_type.as_str();
    let promote = kind.ends_with("_error")
        || kind.starts_with("ai_heal_unknown_")
        || kind == "ai_heal_section_missing";
    if !promote {
        return;
    }
    try_promote(
        pool,
        "healing_audit_log",
        CreateAuditIncidentInput {
            source_table: "healing_audit_log".into(),
            source_id: entry.id.clone(),
            persona_id: entry.persona_id.clone(),
            persona_name: None,
            execution_id: entry.execution_id.clone(),
            severity: "medium".into(),
            kind: format!("healing.{kind}"),
            title: entry.message.clone(),
            detail: entry.detail.clone(),
        },
    );
}

// -- 5. provider_audit_log ---------------------------------------------------

/// Promotion rule: only failover events surface (`was_failover = 1`). Severity
/// is `low` — failover is informational, not actionable, but visible so the
/// user can audit which routes the engine is choosing.
pub fn promote_provider_audit(pool: &DbPool, entry: &ProviderAuditEntry) {
    if !enabled() {
        return;
    }
    if !entry.was_failover {
        return;
    }
    let model = entry
        .model_used
        .clone()
        .unwrap_or_else(|| "(unknown model)".into());
    try_promote(
        pool,
        "provider_audit_log",
        CreateAuditIncidentInput {
            source_table: "provider_audit_log".into(),
            source_id: entry.id.clone(),
            persona_id: Some(entry.persona_id.clone()),
            persona_name: Some(entry.persona_name.clone()),
            execution_id: Some(entry.execution_id.clone()),
            severity: "low".into(),
            kind: "provider_failover".into(),
            title: format!("Provider failover ({} → {})", entry.engine_kind, model),
            detail: entry
                .routing_rule_name
                .clone()
                .or_else(|| entry.compliance_rule_name.clone()),
        },
    );
}

// -- 6. policy_events --------------------------------------------------------

/// Promotion rule: only `action='dropped'` policy events become incidents.
/// Auto-resolves and aliases are tracked but not surfaced as needing
/// attention. Severity is `low` because drops are configuration-driven.
pub fn promote_policy_event(pool: &DbPool, event: &PolicyEvent) {
    if !enabled() {
        return;
    }
    if event.action != "dropped" {
        return;
    }
    let title = match &event.payload_title {
        Some(t) if !t.trim().is_empty() => format!("Policy drop: {t}"),
        _ => format!("Policy drop ({})", event.policy_kind),
    };
    try_promote(
        pool,
        "policy_events",
        CreateAuditIncidentInput {
            source_table: "policy_events".into(),
            source_id: event.id.clone(),
            persona_id: Some(event.persona_id.clone()),
            persona_name: None,
            execution_id: Some(event.execution_id.clone()),
            severity: "low".into(),
            kind: format!("policy.{}", event.policy_kind),
            title,
            detail: event.reason.clone(),
        },
    );
}

// -- 7. persona_healing_issues -----------------------------------------------

/// Promotion rule: only rows where `status = 'open'` and `severity ≥ medium`
/// surface as incidents. The native `HealingIssuesPanel` covers the deep
/// per-issue UX; the inbox row is a cross-source pointer for triage. Source
/// row's severity passes through (already on the four-step scale).
pub fn promote_healing_issue(pool: &DbPool, issue: &PersonaHealingIssue) {
    if !enabled() {
        return;
    }
    if issue.status != "open" {
        return;
    }
    if !matches!(issue.severity.as_str(), "medium" | "high" | "critical") {
        return;
    }
    try_promote(
        pool,
        "persona_healing_issues",
        CreateAuditIncidentInput {
            source_table: "persona_healing_issues".into(),
            source_id: issue.id.clone(),
            persona_id: Some(issue.persona_id.clone()),
            persona_name: None,
            execution_id: issue.execution_id.clone(),
            severity: issue.severity.clone(),
            kind: format!("healing_issue.{}", issue.category),
            title: issue.title.clone(),
            detail: Some(issue.description.clone()),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn fired_alert(id: &str, severity: &str) -> FiredAlert {
        use std::str::FromStr;
        FiredAlert {
            id: id.into(),
            rule_id: "r-1".into(),
            rule_name: "Latency".into(),
            metric: crate::db::models::AlertMetric::ErrorRate,
            severity: crate::db::models::AlertSeverity::from_str(severity)
                .expect("test severity must be one of info|warning|critical"),
            message: "Latency spike".into(),
            value: 1500.0,
            threshold: 1000.0,
            persona_id: Some("p-1".into()),
            fired_at: "2026-04-30T12:00:00Z".into(),
            dismissed: false,
        }
    }

    fn tool_entry(id: &str, status: &str) -> ToolExecutionAuditEntry {
        ToolExecutionAuditEntry {
            id: id.into(),
            tool_id: "tool-1".into(),
            tool_name: "http_get".into(),
            tool_type: "connector".into(),
            persona_id: Some("p-1".into()),
            persona_name: Some("Test".into()),
            credential_id: None,
            result_status: status.into(),
            duration_ms: Some(120),
            error_message: Some("403 Forbidden".into()),
            created_at: "2026-04-30T12:00:00Z".into(),
        }
    }

    fn policy_event(id: &str, action: &str) -> PolicyEvent {
        PolicyEvent {
            id: id.into(),
            execution_id: "e-1".into(),
            persona_id: "p-1".into(),
            use_case_id: None,
            policy_kind: "review.off".into(),
            action: action.into(),
            payload_title: Some("review payload".into()),
            reason: Some("Capability declared review.off".into()),
            created_at: "2026-04-30T12:00:00Z".into(),
        }
    }

    #[test]
    fn promoters_are_noop_when_env_unset() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var(PROMOTION_ENV);

        let pool = init_test_db().unwrap();
        promote_fired_alert(&pool, &fired_alert("a-1", "warning"));
        promote_tool_audit(&pool, &tool_entry("t-1", "error"));
        promote_policy_event(&pool, &policy_event("pe-1", "dropped"));

        let s = repo::summary(&pool).unwrap();
        assert_eq!(
            s.open, 0,
            "no incidents should be created when env is unset"
        );
    }

    #[test]
    fn fired_alert_promotes_with_normalized_severity() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var(PROMOTION_ENV, "1");

        let pool = init_test_db().unwrap();
        promote_fired_alert(&pool, &fired_alert("a-1", "critical"));
        std::env::remove_var(PROMOTION_ENV);

        let rows = repo::list(&pool, &Default::default(), 50, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].severity, "critical");
        assert_eq!(rows[0].source_table, "fired_alerts");
    }

    #[test]
    fn tool_audit_only_promotes_errors() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var(PROMOTION_ENV, "1");

        let pool = init_test_db().unwrap();
        promote_tool_audit(&pool, &tool_entry("t-ok", "success"));
        promote_tool_audit(&pool, &tool_entry("t-err", "error"));
        std::env::remove_var(PROMOTION_ENV);

        let rows = repo::list(&pool, &Default::default(), 50, 0).unwrap();
        assert_eq!(rows.len(), 1, "only error rows should promote");
        assert_eq!(rows[0].source_id, "t-err");
        assert_eq!(rows[0].severity, "medium");
    }

    #[test]
    fn policy_event_only_promotes_drops() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var(PROMOTION_ENV, "1");

        let pool = init_test_db().unwrap();
        promote_policy_event(&pool, &policy_event("pe-resolved", "auto_resolved"));
        promote_policy_event(&pool, &policy_event("pe-dropped", "dropped"));
        promote_policy_event(&pool, &policy_event("pe-aliased", "aliased"));
        std::env::remove_var(PROMOTION_ENV);

        let rows = repo::list(&pool, &Default::default(), 50, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source_id, "pe-dropped");
    }

    #[test]
    fn idempotent_when_promoter_called_twice() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var(PROMOTION_ENV, "1");

        let pool = init_test_db().unwrap();
        let alert = fired_alert("a-1", "warning");
        promote_fired_alert(&pool, &alert);
        promote_fired_alert(&pool, &alert);
        promote_fired_alert(&pool, &alert);
        std::env::remove_var(PROMOTION_ENV);

        let rows = repo::list(&pool, &Default::default(), 50, 0).unwrap();
        assert_eq!(rows.len(), 1, "second/third promote must be a no-op");
    }
}
