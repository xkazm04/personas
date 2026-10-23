//! The orphanage's two charter doors (spark `mandate-lanes`, WP6): draft a
//! mandate for a project no mandate holds, or adopt that project into an
//! existing mandate. Each writes the new charter row and its act in ONE
//! immediate transaction, and each refuses a project that already has a
//! mandate in any live state (draft, active, suspended): one project, one
//! mandate, and never a second draft while one is open.

use rusqlite::{params, OptionalExtension, Transaction, TransactionBehavior};

use super::{envelope_act, read_in, require_sole_active, snapshot_of, writable_in, MANDATE_DOMAIN};
use crate::models::{
    CharterAct, CharterActor, EnvelopeChange, EnvelopeOp, EnvelopeSnapshot, MandateOrigin,
    MandateOriginKind, ResponsibilityStatus,
};
use crate::repos::core::charter_acts;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// What a draft is made from.
#[derive(Debug, Clone, PartialEq)]
pub struct OrphanDraft {
    pub project_id: String,
    pub steward_persona_id: String,
    pub title: String,
    pub orphans: u32,
    /// The orphan law's code that fired, when it fired.
    pub why: Option<String>,
    /// The sweep drafted it (recorded as a `router` act) or the operator did.
    pub automatic: bool,
}

/// A live mandate of the project, when there is one.
fn live_mandate_in(tx: &Transaction<'_>, project_id: &str) -> Result<Option<String>, AppError> {
    Ok(tx
        .query_row(
            "SELECT id FROM persona_responsibilities
             WHERE project_id = ?1 AND domain = ?2 AND status IN ('draft','active','suspended')
             LIMIT 1",
            params![project_id, MANDATE_DOMAIN],
            |r| r.get("id"),
        )
        .optional()?)
}

fn require_orphaned(tx: &Transaction<'_>, project_id: &str) -> Result<(), AppError> {
    let exists: Option<String> = tx
        .query_row(
            "SELECT id FROM dev_projects WHERE id = ?1",
            [project_id],
            |r| r.get("id"),
        )
        .optional()?;
    if exists.is_none() {
        return Err(AppError::NotFound(format!("Project {project_id}")));
    }
    if let Some(m) = live_mandate_in(tx, project_id)? {
        return Err(AppError::Validation(format!(
            "Project {project_id} already has a mandate ({m}); it is not an orphan"
        )));
    }
    Ok(())
}

/// Whether the persona already stewards a live mandate of ANOTHER project.
fn stewards_elsewhere(
    tx: &Transaction<'_>,
    persona_id: &str,
    project_id: &str,
) -> Result<bool, AppError> {
    let other: Option<String> = tx
        .query_row(
            "SELECT id FROM persona_responsibilities
             WHERE persona_id = ?1 AND domain = ?2 AND project_id IS NOT NULL
               AND project_id != ?3 AND status IN ('draft','active','suspended')
             LIMIT 1",
            params![persona_id, MANDATE_DOMAIN, project_id],
            |r| r.get("id"),
        )
        .optional()?;
    Ok(other.is_some())
}

fn new_id() -> String {
    format!("resp_{}", uuid::Uuid::new_v4().simple())
}

fn none_snapshot() -> EnvelopeSnapshot {
    EnvelopeSnapshot {
        status: "none".to_string(),
        ..Default::default()
    }
}

/// Draft a mandate for an orphaned project: `status = 'draft'`, `source =
/// 'athena'`, no scopes, merge `never`, no cap, rung 0 (signing delegates
/// decisions, not work). Refused when the project has any live mandate, so a
/// second draft for a project can never be opened while one is. Writes the
/// `drafted` act (by the router when the sweep drafted it, else the operator).
pub fn draft_for_orphans(
    pool: &DbPool,
    d: &OrphanDraft,
    origin_device: Option<&str>,
) -> Result<CharterAct, AppError> {
    timed_query!("persona_responsibilities", "mandates::draft_for_orphans", {
        let mut conn = pool.conn("mandates::draft_for_orphans")?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_orphaned(&tx, &d.project_id)?;
        let persona: Option<String> = tx
            .query_row(
                "SELECT id FROM personas WHERE id = ?1",
                [&d.steward_persona_id],
                |r| r.get("id"),
            )
            .optional()?;
        if persona.is_none() {
            return Err(AppError::NotFound(format!(
                "Persona {}",
                d.steward_persona_id
            )));
        }
        let origin = MandateOrigin {
            kind: MandateOriginKind::OrphanDraft,
            orphans: Some(d.orphans),
            why: d.why.clone(),
            from_charter_id: None,
            borrowed_steward: stewards_elsewhere(&tx, &d.steward_persona_id, &d.project_id)?,
            automatic: d.automatic,
        };
        let id = new_id();
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO persona_responsibilities
                (id, persona_id, title, domain, scope_rung, status, project_id, source, spec,
                 decide_scopes, merge_policy, envelope_version, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 0, 'draft', ?5, 'athena', ?6, '[]', 'never', 0, ?7, ?7)",
            params![
                id,
                d.steward_persona_id,
                d.title.trim(),
                MANDATE_DOMAIN,
                d.project_id,
                serde_json::json!({ "mandateOrigin": origin }).to_string(),
                now,
            ],
        )?;
        let row = read_in(&tx, &id)?
            .ok_or_else(|| AppError::Internal(format!("drafted charter {id} vanished")))?;
        let mut act = envelope_act(&row, "drafted", origin_device);
        act.reversible = false;
        if d.automatic {
            act.actor = CharterActor::Router;
        }
        act.shown_json = Some(
            serde_json::json!({ "orphans": d.orphans, "why": d.why, "projectId": d.project_id })
                .to_string(),
        );
        let change = EnvelopeChange {
            op: EnvelopeOp::Draft,
            change: None,
            before: none_snapshot(),
            after: snapshot_of(&row),
        };
        let created = charter_acts::insert_in(&tx, &act, 0, Some(&change))?;
        tx.commit()?;
        Ok(created)
    })
}

/// Adopt an orphaned project into an existing mandate: a new charter for the
/// project carrying the mandate's steward, envelope (signed as it was), rung,
/// refusals and spec, in the mandate's own status. The new charter is what
/// the router then routes the project's items to. Refused when the project
/// has a live mandate or the source mandate is retired. Writes the `adopted`
/// act (final: retire the adopted charter to undo it).
pub fn adopt_project(
    pool: &DbPool,
    project_id: &str,
    from_charter_id: &str,
    orphans: u32,
    origin_device: Option<&str>,
) -> Result<CharterAct, AppError> {
    timed_query!("persona_responsibilities", "mandates::adopt_project", {
        let mut conn = pool.conn("mandates::adopt_project")?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let from = writable_in(&tx, from_charter_id)?;
        if from.project_id.as_deref() == Some(project_id) {
            return Err(AppError::Validation(format!(
                "Mandate {from_charter_id} already holds project {project_id}"
            )));
        }
        require_orphaned(&tx, project_id)?;
        let origin = MandateOrigin {
            kind: MandateOriginKind::Adopted,
            orphans: Some(orphans),
            why: None,
            from_charter_id: Some(from.id.clone()),
            borrowed_steward: true,
            automatic: false,
        };
        let id = new_id();
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO persona_responsibilities
                (id, persona_id, title, domain, outcomes, objectives, scope_rung, refusal_classes,
                 approval_gates, owner, cadence, budget_monthly_usd, tenure, status, project_id,
                 source, created_at, updated_at, connectors, procedure, spec, workspace_id,
                 decide_scopes, merge_policy, envelope_version)
             SELECT ?1, persona_id, title, domain, outcomes, objectives, scope_rung, refusal_classes,
                 approval_gates, owner, cadence, budget_monthly_usd, tenure, status, ?2,
                 'operator', ?3, ?3, connectors, procedure,
                 json_set(CASE WHEN json_valid(spec) THEN spec ELSE '{}' END,
                          '$.mandateOrigin', json(?4)),
                 workspace_id, decide_scopes, merge_policy, envelope_version
             FROM persona_responsibilities WHERE id = ?5",
            params![
                id,
                project_id,
                now,
                serde_json::to_string(&origin)?,
                from.id,
            ],
        )?;
        let row = read_in(&tx, &id)?
            .ok_or_else(|| AppError::Internal(format!("adopted charter {id} vanished")))?;
        if row.status == ResponsibilityStatus::Active.as_str() {
            require_sole_active(&tx, &row)?;
        }
        let mut act = envelope_act(&row, "adopted", origin_device);
        act.reversible = false;
        act.shown_json = Some(
            serde_json::json!({ "fromCharterId": from.id, "orphans": orphans, "projectId": project_id })
                .to_string(),
        );
        let change = EnvelopeChange {
            op: EnvelopeOp::Adopt,
            change: None,
            before: none_snapshot(),
            after: snapshot_of(&row),
        };
        let created = charter_acts::insert_in(&tx, &act, row.envelope_version, Some(&change))?;
        tx.commit()?;
        Ok(created)
    })
}
