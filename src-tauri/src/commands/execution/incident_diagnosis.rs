//! Incident auto-diagnosis + the "handled autonomously" lane
//! (Autonomous NOC v1).
//!
//! On incident open (server-side alert evaluator) or on the user's explicit
//! "Diagnose" click, this module attaches a root-cause summary to an
//! `audit_incidents` row: it runs the existing healing analysis for the
//! persona, scans recent failures, and looks the failure pattern up in the
//! execution-knowledge graph ("has this been seen and what fixed it?").
//!
//! ## Hard safety line (v1)
//!
//! Diagnosis may PROPOSE a remediation — inserted as a PENDING
//! `companion_approval` row that the user approves/rejects in Athena's
//! Approvals. It NEVER auto-approves, never touches the autopilot allowlist,
//! and never schedules the healing retries the analysis pass returns (that
//! would be an autonomous action; the returned retries inform the summary
//! only). Caps:
//! - one diagnosis row per incident (`incident_id UNIQUE`; re-diagnosis
//!   returns the stored row unless the incident was reopened after being
//!   diagnosed — even then the proposal slot is NOT re-armed);
//! - at most ONE proposal per incident, ever (`approval_id` is set-once);
//! - the evaluator additionally caps auto-diagnoses per tick.

use std::sync::Arc;

use rusqlite::params;
use tauri::State;

use crate::db::models::{AuditIncident, IncidentDiagnosis};
use crate::db::repos::execution::audit_incidents as incident_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::knowledge as knowledge_repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

/// Severities that qualify for a remediation proposal. Lower severities get a
/// diagnosis but no pending approval — keep the approvals inbox for things
/// that matter.
const PROPOSAL_SEVERITIES: &[&str] = &["high", "critical"];

// ---------------------------------------------------------------------------
// Storage (incident_diagnoses table — see db migration `incident_diagnoses`)
// ---------------------------------------------------------------------------

fn row_to_diagnosis(row: &rusqlite::Row<'_>) -> rusqlite::Result<IncidentDiagnosis> {
    let evidence_raw: Option<String> = row.get(3)?;
    let evidence = evidence_raw
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default();
    Ok(IncidentDiagnosis {
        id: row.get(0)?,
        incident_id: row.get(1)?,
        summary: row.get(2)?,
        evidence,
        proposed_action: row.get(4)?,
        proposed_rationale: row.get(5)?,
        approval_id: row.get(6)?,
        confidence: row.get(7)?,
        diagnosed_at: row.get(8)?,
    })
}

const DIAGNOSIS_COLUMNS: &str = "id, incident_id, summary, evidence, proposed_action, \
     proposed_rationale, approval_id, confidence, diagnosed_at";

/// Fetch the stored diagnosis for an incident, if any.
pub fn get_for_incident(
    pool: &DbPool,
    incident_id: &str,
) -> Result<Option<IncidentDiagnosis>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {DIAGNOSIS_COLUMNS} FROM incident_diagnoses WHERE incident_id = ?1"
    ))?;
    match stmt.query_row(params![incident_id], row_to_diagnosis) {
        Ok(d) => Ok(Some(d)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

fn store(pool: &DbPool, diag: &IncidentDiagnosis) -> Result<(), AppError> {
    let conn = pool.get()?;
    let evidence_json = serde_json::to_string(&diag.evidence).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO incident_diagnoses
            (id, incident_id, summary, evidence, proposed_action,
             proposed_rationale, approval_id, confidence, diagnosed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(incident_id) DO UPDATE SET
            summary = excluded.summary,
            evidence = excluded.evidence,
            confidence = excluded.confidence,
            diagnosed_at = excluded.diagnosed_at,
            -- Proposal slot is set-once: keep the original approval if the
            -- update carries none (the remediation-loop cap).
            proposed_action = COALESCE(incident_diagnoses.proposed_action, excluded.proposed_action),
            proposed_rationale = COALESCE(incident_diagnoses.proposed_rationale, excluded.proposed_rationale),
            approval_id = COALESCE(incident_diagnoses.approval_id, excluded.approval_id)",
        params![
            diag.id,
            diag.incident_id,
            diag.summary,
            evidence_json,
            diag.proposed_action,
            diag.proposed_rationale,
            diag.approval_id,
            diag.confidence,
            diag.diagnosed_at,
        ],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Diagnosis core
// ---------------------------------------------------------------------------

/// Truncate a free-text error to one evidence-line-sized fragment.
fn clip(s: &str, max: usize) -> String {
    let cleaned = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.chars().count() <= max {
        cleaned
    } else {
        let clipped: String = cleaned.chars().take(max).collect();
        format!("{clipped}…")
    }
}

/// Compose the first-person, operational summary from the gathered evidence.
/// Pure — unit-tested below.
pub fn compose_summary(incident: &AuditIncident, evidence: &[String], has_known_fix: bool) -> String {
    let subject = incident
        .persona_name
        .as_deref()
        .or(incident.persona_id.as_deref());
    let mut out = match subject {
        Some(name) => format!("I looked into \"{}\" on {}.", clip(&incident.title, 90), name),
        None => format!("I looked into \"{}\".", clip(&incident.title, 90)),
    };
    if evidence.is_empty() {
        out.push_str(" I found no correlated failures or known patterns — this may be a threshold artifact or a one-off. Watch the next evaluation window.");
    } else {
        out.push_str(&format!(
            " I found {} corroborating signal{}.",
            evidence.len(),
            if evidence.len() == 1 { "" } else { "s" }
        ));
        if has_known_fix {
            out.push_str(" This matches a failure pattern I've seen before — the knowledge graph has a fix that worked.");
        }
    }
    out
}

/// Insert ONE pending `companion_approval` proposing a retry of the affected
/// persona. Mirrors `profile_synthesis::insert_identity_approval` (headless
/// insert, DEFAULT_SESSION_ID, status 'pending'). Direct inserts never pass
/// through the autopilot's `auto_resolve_if_allowed` (that only runs on
/// Athena's own dispatch turns), so this stays pending until the user acts.
fn insert_pending_retry_proposal(
    user_db: &crate::db::UserDbPool,
    persona_id: &str,
    rationale: &str,
) -> Result<String, AppError> {
    let id = format!("appr_{}", crate::companion::util::short_id(12));
    let payload = serde_json::json!({
        "action": "run_persona",
        "params": { "persona_id": persona_id },
        "rationale": rationale,
    })
    .to_string();
    let conn = user_db.get()?;
    conn.execute(
        "INSERT INTO companion_approval (id, session_id, kind, payload, status, human_review_id, created_at)
         VALUES (?1, ?2, 'op_execute', ?3, 'pending', NULL, datetime('now'))",
        params![id, crate::companion::session::DEFAULT_SESSION_ID, payload],
    )?;
    Ok(id)
}

/// Run the diagnosis pass for one incident and persist the result.
///
/// Returns the stored diagnosis unchanged when one already exists (idempotent
/// — the evaluator and the UI can both call this safely). `allow_proposal`
/// gates the pending-approval emission (severity- and persona-gated on top).
pub fn diagnose(
    state: &Arc<AppState>,
    incident_id: &str,
    allow_proposal: bool,
) -> Result<IncidentDiagnosis, AppError> {
    if let Some(existing) = get_for_incident(&state.db, incident_id)? {
        return Ok(existing);
    }
    let incident = incident_repo::get_by_id(&state.db, incident_id)?;

    let mut evidence: Vec<String> = Vec::new();
    let mut confidence: f64 = 0.2; // baseline: we at least looked
    let mut has_known_fix = false;

    if let Some(pid) = incident.persona_id.as_deref() {
        // 1. Healing analysis (existing engine pass). Retries it returns are
        //    deliberately NOT scheduled — proposal-only in v1.
        match crate::engine::healing_timeline::run_healing_analysis(&state.db, pid) {
            Ok((result, retries)) => {
                if result.failures_analyzed > 0 {
                    evidence.push(format!(
                        "Healing pass analyzed {} recent failure{} and recorded {} issue{}.",
                        result.failures_analyzed,
                        if result.failures_analyzed == 1 { "" } else { "s" },
                        result.issues_created,
                        if result.issues_created == 1 { "" } else { "s" },
                    ));
                    confidence += 0.15;
                }
                if !retries.is_empty() {
                    evidence.push(format!(
                        "Healing marked {} execution{} as retryable.",
                        retries.len(),
                        if retries.len() == 1 { "" } else { "s" },
                    ));
                    confidence += 0.1;
                }
            }
            Err(e) => {
                tracing::warn!(incident_id = %incident_id, error = %e, "incident_diagnosis: healing analysis failed");
            }
        }

        // 2. Recent failures — the concrete error lines.
        if let Ok(failures) = exec_repo::get_recent_failures(&state.db, pid, 5) {
            for f in failures.iter().take(3) {
                let err = f
                    .error_message
                    .as_deref()
                    .map(|m| clip(m, 140))
                    .unwrap_or_else(|| "no error message recorded".into());
                evidence.push(format!("Run {} failed: {}", clip(&f.id, 8), err));
            }
            if !failures.is_empty() {
                confidence += 0.15;
            }
        }

        // 3. Execution-knowledge lookup — has this pattern been seen, and did
        //    something fix it?
        if let Ok(entries) = knowledge_repo::list_for_persona(&state.db, pid, None, Some(5)) {
            for k in entries
                .iter()
                .filter(|k| k.failure_count > 0 || k.confidence >= 0.5)
                .take(2)
            {
                evidence.push(format!(
                    "Known pattern '{}' ({} success / {} failure, confidence {:.0}%).",
                    clip(&k.pattern_key, 60),
                    k.success_count,
                    k.failure_count,
                    k.confidence * 100.0,
                ));
                if k.success_count > 0 {
                    has_known_fix = true;
                }
            }
            if has_known_fix {
                confidence += 0.2;
            }
        }
    }

    let summary = compose_summary(&incident, &evidence, has_known_fix);

    // Proposal — pending approval only, once per incident, high/critical with
    // a persona to act on.
    let mut proposed_action: Option<String> = None;
    let mut proposed_rationale: Option<String> = None;
    let mut approval_id: Option<String> = None;
    if allow_proposal
        && PROPOSAL_SEVERITIES.contains(&incident.severity.as_str())
        && !evidence.is_empty()
    {
        if let Some(pid) = incident.persona_id.as_deref() {
            let rationale = format!(
                "I diagnosed incident \"{}\": {} Re-running the persona should tell us whether it clears.",
                clip(&incident.title, 90),
                clip(&summary, 220),
            );
            match insert_pending_retry_proposal(&state.user_db, pid, &rationale) {
                Ok(id) => {
                    proposed_action = Some("run_persona".into());
                    proposed_rationale = Some(rationale);
                    approval_id = Some(id);
                }
                Err(e) => {
                    tracing::warn!(incident_id = %incident_id, error = %e, "incident_diagnosis: failed to insert proposal approval");
                }
            }
        }
    }

    let diag = IncidentDiagnosis {
        id: uuid::Uuid::new_v4().to_string(),
        incident_id: incident.id.clone(),
        summary,
        evidence,
        proposed_action,
        proposed_rationale,
        approval_id,
        confidence: confidence.min(0.9),
        diagnosed_at: chrono::Utc::now().to_rfc3339(),
    };
    store(&state.db, &diag)?;
    Ok(diag)
}

// ---------------------------------------------------------------------------
// IPC commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_incident_diagnosis(
    state: State<'_, Arc<AppState>>,
    incident_id: String,
) -> Result<Option<IncidentDiagnosis>, AppError> {
    require_auth_sync(&state)?;
    get_for_incident(&state.db, &incident_id)
}

/// Manual "Diagnose" from the incident detail modal. Idempotent — returns the
/// stored diagnosis when one exists.
#[tauri::command]
pub async fn diagnose_audit_incident(
    state: State<'_, Arc<AppState>>,
    incident_id: String,
) -> Result<IncidentDiagnosis, AppError> {
    require_auth(&state).await?;
    diagnose(state.inner(), &incident_id, true)
}

/// The "handled autonomously" lane — incidents the system continued/handled
/// without a human. Sparse in v1 by design.
#[tauri::command]
pub fn list_autonomously_handled_incidents(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
) -> Result<Vec<AuditIncident>, AppError> {
    require_auth_sync(&state)?;
    incident_repo::list_handled_autonomously(&state.db, limit.unwrap_or(20))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn incident(severity: &str, persona: Option<&str>) -> AuditIncident {
        AuditIncident {
            id: "inc-1".into(),
            source_table: "fired_alerts".into(),
            source_id: "a-1".into(),
            dedup_key: "fired_alerts:a-1".into(),
            persona_id: persona.map(String::from),
            persona_name: persona.map(|_| "Scout".into()),
            execution_id: None,
            severity: severity.into(),
            kind: "alert.error_rate".into(),
            title: "Error rate is 25.0% (threshold: > 20%)".into(),
            detail: None,
            status: "open".into(),
            acknowledged_at: None,
            acknowledged_by: None,
            resolved_at: None,
            resolution_note: None,
            continued_at: None,
            created_at: "2026-07-30T00:00:00Z".into(),
        }
    }

    /// No evidence → the summary is honest about finding nothing (never
    /// fabricates a root cause).
    #[test]
    fn summary_is_honest_when_no_evidence() {
        let s = compose_summary(&incident("high", Some("p-1")), &[], false);
        assert!(s.contains("no correlated failures"), "{s}");
        assert!(s.starts_with("I looked into"), "Athena speaks first person: {s}");
    }

    #[test]
    fn summary_counts_evidence_and_flags_known_fix() {
        let ev = vec!["a".into(), "b".into()];
        let s = compose_summary(&incident("high", Some("p-1")), &ev, true);
        assert!(s.contains("2 corroborating signals"), "{s}");
        assert!(s.contains("seen before"), "{s}");
    }

    #[test]
    fn clip_truncates_and_collapses_whitespace() {
        assert_eq!(clip("a  b\n c", 10), "a b c");
        let long = "x".repeat(50);
        let c = clip(&long, 10);
        assert!(c.chars().count() == 11 && c.ends_with('…'));
    }
}
