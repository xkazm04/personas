//! Incident → proactive trigger evaluator.
//!
//! Surfaces OPEN high/critical audit incidents so Athena can proactively
//! nudge the user about them — even while away/unattended. The nudge is
//! priority-ordered by severity (critical first) and count-aware.
//!
//! Audit incidents live in the **main app DB** (`audit_incidents`), not the
//! companion `user_db`, so this mirrors `triggers::dev_goal_nudges`: it takes
//! `sys_db` (the main app pool) and callers that have it (the manual
//! `companion_evaluate_proactive_now` + the desktop tick) pass the result as
//! `extra` candidates to [`super::evaluate_with_extra_candidates`], so the same
//! quiet-hours / budget / dedupe guards still apply.
//!
//! Engaging the nudge lands the user on the Overview → Incidents inbox
//! (frontend nav in `CompanionPanel`'s `onProactiveEngage`). Deep-linking to a
//! specific incident detail is a deliberate follow-up, not part of this trigger.

use crate::db::models::{AuditIncident, IncidentFilters};
use crate::db::repos::execution::audit_incidents;
use crate::db::DbPool;

use super::Nudge;

/// Cap on how many open incidents we pull for the count — well above any
/// realistic "needs attention now" set, while bounding the query.
const INCIDENT_SCAN_LIMIT: i64 = 200;

/// Returns true if a (normalized) severity string counts as high or critical.
/// `audit_incidents` severities are normalized at promotion time, but we
/// lower-case/trim defensively in case a raw value slips through.
pub fn is_high_or_critical(severity: &str) -> bool {
    let s = severity.trim().to_ascii_lowercase();
    s == "critical" || s == "high"
}

/// Severity ordering weight — lower sorts first (critical before high).
fn severity_weight(severity: &str) -> u8 {
    match severity.trim().to_ascii_lowercase().as_str() {
        "critical" => 0,
        "high" => 1,
        _ => 2,
    }
}

/// Pure core: build a single, count-aware, severity-ordered nudge from a slice
/// of open incidents. Filters to high/critical, sorts critical-first, anchors
/// `trigger_ref` on the most-severe incident's id (so dedupe + a future
/// deep-link can use it). Returns `None` when nothing qualifies.
///
/// Plain-English message text — matches the `dev_goal_nudges` convention
/// (proactive messages are stored as text; no token/label system).
pub fn build_incident_nudge(incidents: &[AuditIncident]) -> Option<Nudge> {
    let mut qualifying: Vec<&AuditIncident> = incidents
        .iter()
        .filter(|inc| is_high_or_critical(&inc.severity))
        .collect();
    if qualifying.is_empty() {
        return None;
    }
    // Stable severity ordering: critical first, then high.
    qualifying.sort_by_key(|inc| severity_weight(&inc.severity));

    let count = qualifying.len();
    let top = qualifying[0];
    let message = if count == 1 {
        format!(
            "A {} incident needs your attention: \"{}\". Want me to take you to the Incidents inbox?",
            top.severity.trim().to_ascii_lowercase(),
            top.title
        )
    } else {
        format!(
            "{count} high/critical incidents need your attention. Want me to take you to the Incidents inbox?"
        )
    };

    Some(Nudge {
        trigger_kind: "incident_blocker".into(),
        trigger_ref: Some(top.id.clone()),
        message,
    })
}

/// Incidents hub: scan the main-DB `audit_incidents` for OPEN high/critical
/// incidents and surface a single priority-ordered nudge. DB-shell around
/// [`build_incident_nudge`] — reuses `audit_incidents::list` (filtered to
/// `status='open'` and `severity in (high, critical)`) rather than raw SQL.
/// Errors degrade to no nudge (consistent with `dev_goal_nudges`).
pub fn incident_blocker_nudges(sys_db: &DbPool) -> Vec<Nudge> {
    let filters = IncidentFilters {
        statuses: Some(vec!["open".to_string()]),
        severities: Some(vec!["high".to_string(), "critical".to_string()]),
        source_tables: None,
        persona_id: None,
        since: None,
    };
    let incidents = match audit_incidents::list(sys_db, &filters, INCIDENT_SCAN_LIMIT, 0) {
        Ok(rows) => rows,
        Err(_) => return Vec::new(),
    };
    build_incident_nudge(&incidents).into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk(id: &str, severity: &str, title: &str) -> AuditIncident {
        AuditIncident {
            id: id.into(),
            source_table: "test".into(),
            source_id: id.into(),
            dedup_key: format!("test:{id}"),
            persona_id: None,
            persona_name: None,
            execution_id: None,
            severity: severity.into(),
            kind: "test".into(),
            title: title.into(),
            detail: None,
            status: "open".into(),
            acknowledged_at: None,
            acknowledged_by: None,
            resolved_at: None,
            resolution_note: None,
            continued_at: None,
            created_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn no_incidents_is_none() {
        assert!(build_incident_nudge(&[]).is_none());
    }

    #[test]
    fn only_low_medium_is_none() {
        let v = vec![mk("a", "low", "x"), mk("b", "medium", "y")];
        assert!(build_incident_nudge(&v).is_none());
    }

    #[test]
    fn single_high_is_singular_message() {
        let v = vec![mk("a", "high", "Disk full")];
        let n = build_incident_nudge(&v).unwrap();
        assert_eq!(n.trigger_kind, "incident_blocker");
        assert_eq!(n.trigger_ref.as_deref(), Some("a"));
        assert!(n.message.contains("Disk full"));
        assert!(n.message.contains("high"));
    }

    #[test]
    fn multiple_anchors_on_critical_first() {
        // "high" appears first in input but "critical" must win trigger_ref.
        let v = vec![mk("h1", "high", "h"), mk("c1", "critical", "c")];
        let n = build_incident_nudge(&v).unwrap();
        assert_eq!(n.trigger_ref.as_deref(), Some("c1"));
        assert!(n.message.contains("2 high/critical"));
    }

    #[test]
    fn severity_match_is_case_insensitive() {
        assert!(is_high_or_critical("CRITICAL"));
        assert!(is_high_or_critical(" High "));
        assert!(!is_high_or_critical("warning"));
        assert!(!is_high_or_critical("medium"));
    }
}
